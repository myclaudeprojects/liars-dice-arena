// server.js — Live arena. Serves the spectator UI, streams every event over
// SSE, and runs many parallel tables (betting window → match → settlement).
//   node server.js            (mock agents + mock wallet, zero keys)
//   USE_LLM=1 node server.js  (real models via ANTHROPIC_API_KEY / OPENAI_API_KEY)

// Load .env for local dev (Node 21+). On Render, env vars come from the dashboard.
try { process.loadEnvFile(require("path").join(__dirname, ".env")); } catch {}

const http = require("http");
const fs = require("fs");
const path = require("path");
const { MockAgent, LLMAgent, RemoteAgent } = require("./src/agents");
const { Registry } = require("./src/registry");
const { makeWallet } = require("./src/wallet");
const { impliedMultipliers } = require("./src/betting");
const llm = require("./src/llm");
const { Stats } = require("./src/stats");
const argus = require("./src/argus");
const { resolvePublicFile, shouldReleaseTxClaim } = require("./src/httputil");
const { TableManager, TABLE_ID_RE } = require("./src/tables");
const stats = new Stats();
const TABLE_SIZE = Math.max(2, Math.min(4, Math.round(Number(process.env.TABLE_SIZE) || 3)));
const TABLE_COUNT = Math.max(1, Math.min(24, Math.round(Number(process.env.TABLE_COUNT) || 3)));
const registry = new Registry({ allowLocal: process.env.ALLOW_LOCAL_AGENTS === "1" || !process.env.RENDER });

// Env numbers: tolerate "1600ms", " 30000 ", "0.1 USDC" etc.; fall back to the default on garbage.
function envNum(name, dflt) { const m = String(process.env[name] ?? "").match(/-?\d+(\.\d+)?/); const v = m ? Number(m[0]) : NaN; return Number.isFinite(v) ? v : dflt; }
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const TURN_DELAY_MS = envNum("TURN_DELAY_MS", 1000);
const REVEAL_DELAY_MS = envNum("REVEAL_DELAY_MS", 3000); // time for the flip sequence to play out
const DEAL_DELAY_MS = envNum("DEAL_DELAY_MS", 1000);
const BET_WINDOW_MS = envNum("BET_WINDOW_MS", 30000);
const ANTE = envNum("ANTE", 5);
const MIN_STAKE = envNum("MIN_STAKE", 0.05);

// ---- world state --------------------------------------------------------
// Money adapter: MOCK=1 always wins (local previews). Else self-custodied
// hot key > Circle stub (not wired — ops throw TODO) > in-memory mock.
const wallet = makeWallet(process.env.MOCK === "1" ? { startingBalance: 100 } : process.env.HOUSE_PRIVATE_KEY ? {
  provider: "evm", privateKey: process.env.HOUSE_PRIVATE_KEY,
  rpcUrl: process.env.ARC_RPC_URL || "https://rpc.mainnet.arc.io", chainId: Number(process.env.ARC_CHAIN_ID || 5042),
  explorer: process.env.ARC_EXPLORER || "https://explorer.arc.io",
} : process.env.CIRCLE_API_KEY ? {
  provider: "circle", apiKey: process.env.CIRCLE_API_KEY,
  entitySecret: process.env.CIRCLE_ENTITY_SECRET, blockchain: process.env.CIRCLE_BLOCKCHAIN || "ARC-TESTNET",
} : { startingBalance: 100 });
const LIVE_CHAIN = wallet.kind === "evm";

const spectatorWallets = {}; // bettorId -> wallet (mock: auto-funded)

function parseReq(req) {
  const u = new URL(req.url, "http://local");
  return { path: u.pathname, q: u.searchParams };
}

// LLM provider for prompt-type agents (community personas). Optional.
const llmComplete = process.env.ANTHROPIC_API_KEY ? llm.anthropic() : process.env.OPENAI_API_KEY ? llm.openaiCompatible() : null;

async function ensureWallet(rec) {
  // Mock wallets live in memory, so re-create after a restart; Circle wallets persist.
  if (rec.wallet && (wallet.kind === "circle" || wallet.balances?.has(rec.wallet.walletId))) return rec.wallet;
  const w = await wallet.createSeatWallet(rec.id); registry.setWallet(rec.id, w); return w;
}

function instantiate(rec) {
  const base = { id: rec.id, name: rec.name };
  let ag;
  if (rec.type === "endpoint") {
    ag = new RemoteAgent({ ...base, endpoint: rec.endpoint, sign: (body) => registry.signature(rec, body),
      allowLocal: registry.allowLocal,
      onResult: (ok) => ok ? registry.recordSuccess(rec.id) : registry.recordFailure(rec.id) });
  } else if (rec.type === "prompt" && llmComplete) {
    ag = new LLMAgent({ ...base, persona: rec.persona, complete: llmComplete });
  } else if (rec.house && process.env.USE_LLM && llmComplete && llm.PERSONAS[rec.persona]) {
    ag = new LLMAgent({ ...base, persona: llm.PERSONAS[rec.persona], complete: llmComplete });
  } else {
    ag = new MockAgent({ ...base, aggression: rec.aggression ?? 0.5 });
  }
  ag.owner = rec.owner; return ag;
}

const tables = new TableManager({
  wallet, registry, stats, instantiate, ensureWallet,
  ante: ANTE, tableSize: TABLE_SIZE, tableCount: TABLE_COUNT, liveChain: LIVE_CHAIN,
  betWindowMs: BET_WINDOW_MS, turnDelayMs: TURN_DELAY_MS, revealDelayMs: REVEAL_DELAY_MS,
  dealDelayMs: DEAL_DELAY_MS, minStake: MIN_STAKE, shouldReleaseTxClaim,
  staggerMs: Math.max(1500, Math.round(BET_WINDOW_MS / Math.max(1, TABLE_COUNT))),
});

function lobbyState() {
  const feat = tables.featured();
  return {
    ...(feat ? feat.publicState() : { phase: "idle", matchNo: 0, seats: [], bets: [], multipliers: {}, betCloseAt: null, poolTotal: 0 }),
    tables: tables.list(),
    tableCount: tables.tables.length,
    ante: ANTE, walletKind: wallet.kind, live: LIVE_CHAIN, betWindowMs: BET_WINDOW_MS,
  };
}

function poolView(table) {
  return {
    tableId: table?.id || null,
    walletKind: wallet.kind, live: LIVE_CHAIN,
    poolAddress: table?.pool?.poolWallet?.address || null,
    open: !!(table && table.pool && table.pool.open),
    closeAt: table?.betCloseAt || null,
    matchNo: table?.matchNo || 0,
    chain: wallet.chainInfo ? wallet.chainInfo() : null,
    minStake: MIN_STAKE, betWindowMs: BET_WINDOW_MS,
  };
}

async function placeBetOnTable(table, body) {
  if (!table) throw new Error("Unknown table.");
  const { bettorId, agentId, amount, txHash, address } = body;
  if (!table.seats.find((s) => s.id === agentId)) throw new Error("Unknown seat.");
  const claimedAmt = Number(amount);
  const pool = table.pool;

  if (txHash && wallet.verifyDeposit) {
    if (!pool) throw new Error("No match is open.");
    pool.claimTx(txHash);
    try {
      const dep = await wallet.verifyDeposit(txHash, pool.poolWallet.address);
      const amt = dep.amount;
      if (!(amt >= MIN_STAKE) || amt > 1000) throw new Error(`Stake must be between ${MIN_STAKE} and 1000 USDC.`);
      if (Number.isFinite(claimedAmt) && Math.abs(dep.amount - claimedAmt) > 0.000001) {
        throw new Error(`Transfer was ${dep.amount} USDC, not ${claimedAmt}.`);
      }
      if (address && dep.from.toLowerCase() !== String(address).toLowerCase()) throw new Error("Transfer came from a different wallet.");
      if (!pool.open && !(dep.timestamp <= (pool.closeAt || 0) + 3000 && table.phase === "playing" && !pool.settledAt)) {
        const rtx = await wallet.settle(pool.poolWallet, { address: dep.from }, dep.amount);
        throw new Error(`Betting had closed — refunded ${dep.amount} USDC to your wallet (tx ${rtx.slice(0, 10)}…).`);
      }
      pool.recordExternal({ bettorId: dep.from, address: dep.from, agentId, amount: amt, txHash, claimed: true });
      table.bets = pool.bets;
      table.multipliers = impliedMultipliers(pool.bets, table.seats.map((s) => s.id), pool.houseFeeBps);
      table.broadcast({ type: "bet", bettorId: dep.from, agentId, amount: amt, tx: txHash, explorer: wallet.explorerUrl(txHash), ...table.publicState() });
      tables.notifyLobby();
      return { ok: true, tx: txHash, explorer: wallet.explorerUrl(txHash), payoutTo: dep.from, amount: amt, tableId: table.id };
    } catch (e) {
      if (shouldReleaseTxClaim(e)) pool.releaseTx(txHash);
      throw e;
    }
  }

  const amt = claimedAmt;
  if (!(amt >= MIN_STAKE) || amt > 1000) throw new Error(`Stake must be between ${MIN_STAKE} and 1000 USDC.`);
  if (!pool || !pool.open) throw new Error("Betting is closed — wait for the next match.");
  if (LIVE_CHAIN) throw new Error("On a live chain, bet from your own wallet (send USDC to the pool and include txHash).");
  if (!spectatorWallets[bettorId]) spectatorWallets[bettorId] = await wallet.createSeatWallet("spectator:" + bettorId);
  const r = await pool.placeBet({ bettorId, bettorWallet: spectatorWallets[bettorId], agentId, amount: amt });
  table.bets = pool.bets;
  table.multipliers = impliedMultipliers(pool.bets, table.seats.map((s) => s.id), pool.houseFeeBps);
  table.broadcast({ type: "bet", bettorId, agentId, amount: amt, tx: r.tx, explorer: r.explorer, ...table.publicState() });
  tables.notifyLobby();
  const bal = await wallet.getBalance(spectatorWallets[bettorId].walletId);
  return { ok: true, tx: r.tx, explorer: r.explorer, balance: bal, poolAddress: pool.poolWallet.address, tableId: table.id };
}

// ---- http ---------------------------------------------------------------
const PUBLIC = path.join(__dirname, "public");
const PAGES = {
  "/": "landing.html", "/arena": "index.html", "/tables": "tables.html",
  "/leaderboard": "leaderboard.html", "/how-it-works": "how.html", "/agents": "agents.html",
};
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".txt": "text/plain" };
function sendFile(res, file) {
  const full = resolvePublicFile(PUBLIC, file);
  if (!full) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "content-type": MIME[path.extname(full)] || "application/octet-stream", "cache-control": file.endsWith(".html") ? "no-cache" : "public, max-age=3600" });
  fs.createReadStream(full).pipe(res);
}

function json(res, code, obj) { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-cache" }); res.end(JSON.stringify(obj)); }
function readBody(req) { return new Promise((r) => { let b = ""; req.on("data", (c) => { b += c; if (b.length > 20000) req.destroy(); }); req.on("end", () => r(b)); }); }
function bearer(req) { const h = req.headers.authorization || ""; return h.startsWith("Bearer ") ? h.slice(7) : null; }

async function agentsApi(req, res, urlPath) {
  const parts = urlPath.split("/").filter(Boolean); // api, agents, :id?, :action?
  const lb = stats.leaderboard(); const eloById = Object.fromEntries(lb.agents.map((a) => [a.id, a]));
  const seated = tables.seatedIndex();
  const decorate = (a) => ({ ...a, elo: eloById[a.id]?.elo ?? 1200, won: eloById[a.id]?.won ?? 0, matches: eloById[a.id]?.played ?? 0, seatedAt: seated[a.id] || [] });

  try {
    if (parts.length === 2 && req.method === "GET") {
      return json(res, 200, {
        agents: registry.list().map(decorate), ante: ANTE, tableSize: TABLE_SIZE, tableCount: TABLE_COUNT,
        promptAgentsEnabled: !!llmComplete, allowLocal: registry.allowLocal, walletKind: wallet.kind, live: LIVE_CHAIN,
        economics: argus.AGENT_TOKEN_ECONOMICS,
      });
    }

    if (parts.length === 2 && req.method === "POST") {
      const body = JSON.parse(await readBody(req) || "{}");
      if (body.type === "prompt" && !llmComplete) throw new Error("Prompt agents need a model key on this server — choose heuristic or endpoint for now.");
      const rec = registry.register(body);
      const w = await ensureWallet(rec);
      let token = null;
      try {
        const launched = await argus.onAgentRegistered({ agent: rec, seatWallet: w, ownerAddress: rec.ownerAddress });
        token = argus.publicTokenView(launched);
        registry.setToken(rec.id, token);
      } catch (e) {
        token = { status: "hook_failed", error: String(e.message || e).slice(0, 200) };
        try { registry.setToken(rec.id, token); } catch {}
      }
      tables.notifyLobby();
      return json(res, 201, { ok: true, agent: decorate(registry.publicView(rec)), key: rec.key, fundingAddress: w.address,
        balance: await wallet.getBalance(w.walletId), token, economics: argus.AGENT_TOKEN_ECONOMICS,
        tablesUrl: `/tables?agent=${encodeURIComponent(rec.id)}`,
        note: wallet.kind === "mock" ? "Mock wallet auto-funded with 100 USDC for local play." : `Send at least ${ANTE} USDC on Arc to the funding address to be seated.` });
    }

    const rec = registry.get(parts[2]); if (!rec) return json(res, 404, { ok: false, error: "No such agent." });

    if (parts.length === 3 && req.method === "GET") {
      const w = rec.wallet ? await wallet.getBalance(rec.wallet.walletId).catch(() => null) : null;
      return json(res, 200, {
        ok: true, agent: decorate(registry.publicView(rec)), balance: w,
        tables: tables.featuring(rec.id),
      });
    }

    // Everything below needs the owner's key.
    if (!registry.auth(rec.id, bearer(req))) return json(res, 401, { ok: false, error: "Wrong or missing agent key." });

    if (parts[3] === "test" && req.method === "POST") {
      if (rec.type !== "endpoint") return json(res, 200, { ok: true, skipped: true, message: "Only endpoint agents need a test." });
      const view = { you: { id: rec.id, name: rec.name, dice: [3, 3, 1, 5, 6] }, table: [{ id: rec.id, name: rec.name, diceCount: 5, alive: true }, { id: "shark", name: "The Shark", diceCount: 4, alive: true }, { id: "degen", name: "Degen", diceCount: 5, alive: true }], totalDice: 14, currentBid: { count: 4, face: 3, byId: "degen" }, onesWild: true, whoseTurn: rec.id };
      let ok = true, why = null;
      const ag = new RemoteAgent({ id: rec.id, name: rec.name, endpoint: rec.endpoint, sign: (b) => registry.signature(rec, b), allowLocal: registry.allowLocal, onResult: (o, w) => { ok = o; why = w; } });
      const t0 = Date.now(); const result = await ag.act(view); const ms = Date.now() - t0;
      if (ok) registry.reactivate(rec.id);
      return json(res, 200, { ok, ms, result, error: why, sentView: view, status: registry.get(rec.id).status });
    }
    if (parts[3] === "retire" && req.method === "POST") { registry.retire(rec.id); return json(res, 200, { ok: true }); }
    if (parts[3] === "reactivate" && req.method === "POST") { registry.reactivate(rec.id); return json(res, 200, { ok: true }); }
    return json(res, 404, { ok: false, error: "Unknown agents endpoint." });
  } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
}

const server = http.createServer(async (req, res) => {
  const { path: url, q } = parseReq(req);
  if (PAGES[url]) return sendFile(res, PAGES[url]);
  if (url.startsWith("/agent/")) {
    const id = decodeURIComponent(url.slice("/agent/".length).split("/")[0] || "");
    res.writeHead(302, { location: `/tables?agent=${encodeURIComponent(id)}` });
    return res.end();
  }
  if (url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({
      ok: true, tables: tables.health(), tableCount: tables.tables.length,
      wallet: wallet.kind, clients: tables.clientCount(),
      house: wallet.houseBalance ? await wallet.houseBalance().catch(() => null) : null,
      lastError: tables.tables.map((t) => t.lastError).find(Boolean) || null,
    }));
  }
  if (url === "/api/leaderboard") { res.writeHead(200, { "content-type": "application/json", "cache-control": "no-cache" }); return res.end(JSON.stringify(stats.leaderboard())); }
  if (url === "/api/state") { res.writeHead(200, { "content-type": "application/json", "cache-control": "no-cache" }); return res.end(JSON.stringify(lobbyState())); }
  if (url.startsWith("/static/")) return sendFile(res, url.slice("/static/".length));
  if (url.startsWith("/api/agents")) return agentsApi(req, res, url);

  if (url === "/api/tables" && req.method === "GET") {
    return json(res, 200, {
      tables: tables.list({ agent: q.get("agent"), owner: q.get("owner"), q: q.get("q") }),
      tableCount: tables.tables.length, tableSize: TABLE_SIZE, ante: ANTE,
      walletKind: wallet.kind, live: LIVE_CHAIN, betWindowMs: BET_WINDOW_MS,
    });
  }

  const tableParts = url.split("/").filter(Boolean); // api, tables, t-1, events|pool|bet
  if (tableParts[0] === "api" && tableParts[1] === "tables" && tableParts[2] && TABLE_ID_RE.test(tableParts[2])) {
    const table = tables.get(tableParts[2]);
    if (!table) return json(res, 404, { ok: false, error: "No such table." });
    const action = tableParts[3] || "";
    if (!action && req.method === "GET") return json(res, 200, { ok: true, table: table.summary(), state: table.publicState() });
    if (action === "events" && req.method === "GET") return table.subscribe(req, res);
    if (action === "pool" && req.method === "GET") return json(res, 200, poolView(table));
    if (action === "bet" && req.method === "POST") {
      try { return json(res, 200, await placeBetOnTable(table, JSON.parse(await readBody(req) || "{}"))); }
      catch (e) { return json(res, 400, { ok: false, error: e.message }); }
    }
    return json(res, 404, { ok: false, error: "Unknown table endpoint." });
  }

  if (url === "/api/pool") {
    const table = tables.findTableForBet({ tableId: q.get("table"), agentId: q.get("agent") });
    return json(res, 200, poolView(table));
  }

  if (url === "/events") {
    const tid = q.get("table");
    if (tid) {
      const table = tables.get(tid);
      if (!table) return json(res, 404, { ok: false, error: "No such table." });
      return table.subscribe(req, res);
    }
    return tables.subscribeLobby(req, res);
  }

  if (url === "/api/bet" && req.method === "POST") {
    try {
      const body = JSON.parse(await readBody(req) || "{}");
      const table = tables.findTableForBet({ tableId: body.tableId || q.get("table"), agentId: body.agentId });
      return json(res, 200, await placeBetOnTable(table, body));
    } catch (e) {
      return json(res, 400, { ok: false, error: e.message });
    }
  }

  if (url.startsWith("/api/balance/")) {
    const id = decodeURIComponent(url.split("/").pop());
    if (!spectatorWallets[id]) spectatorWallets[id] = await wallet.createSeatWallet("spectator:" + id);
    const w = spectatorWallets[id];
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-cache" });
    return res.end(JSON.stringify({ balance: await wallet.getBalance(w.walletId), address: w.address, explorer: wallet.addressUrl?.(w.address) || null, kind: wallet.kind }));
  }

  res.writeHead(404, { "content-type": "text/plain" }); res.end("not found");
});

server.listen(PORT, HOST, () => {
  console.log(`Liar's Dice Arena → http://${HOST}:${PORT}   (wallet: ${wallet.kind}, live: ${LIVE_CHAIN}, tables: ${TABLE_COUNT}×${TABLE_SIZE}, ante: ${ANTE}, bet window: ${BET_WINDOW_MS}ms, turn delay: ${TURN_DELAY_MS}ms)`);
  if (wallet.kind === "circle") {
    console.warn("CircleArcWallet is a stub (TODO(circle) on every money call). Set HOUSE_PRIVATE_KEY for live Arc, or MOCK=1 for local play.");
  }
  tables.start().catch((e) => { console.error("tables start crashed (unrecoverable):", e); });
  process.on("unhandledRejection", (e) => console.error("unhandledRejection:", e));
  process.on("uncaughtException", (e) => console.error("uncaughtException:", e));
});
