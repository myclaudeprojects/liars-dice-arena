// server.js — Live arena. Serves the spectator UI, streams every event over
// SSE, and runs the betting window -> match -> settlement cycle.
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
const { runMatch } = require("./src/arena");
const { BettingPool, impliedMultipliers } = require("./src/betting");
const llm = require("./src/llm");
const { Stats } = require("./src/stats");
const stats = new Stats();
const TABLE_SIZE = Number(process.env.TABLE_SIZE || 3);
const registry = new Registry({ allowLocal: process.env.ALLOW_LOCAL_AGENTS === "1" || !process.env.RENDER });

const PORT = process.env.PORT || 3000;
const TURN_DELAY_MS = Number(process.env.TURN_DELAY_MS || 1400);
const REVEAL_DELAY_MS = Number(process.env.REVEAL_DELAY_MS || 4200); // time for the flip sequence to play out
const DEAL_DELAY_MS = Number(process.env.DEAL_DELAY_MS || 1500);
const BET_WINDOW_MS = Number(process.env.BET_WINDOW_MS || 30000);
const ANTE = Number(process.env.ANTE || 5);

// ---- world state --------------------------------------------------------
const wallet = makeWallet(process.env.CIRCLE_API_KEY ? {
  provider: "circle", apiKey: process.env.CIRCLE_API_KEY,
  entitySecret: process.env.CIRCLE_ENTITY_SECRET, blockchain: process.env.CIRCLE_BLOCKCHAIN || "ARC-TESTNET",
} : { startingBalance: 100 });

const clients = new Set();
let state = { phase: "idle", matchNo: 0, seats: [], pool: null, bets: [], multipliers: {}, betCloseAt: null };
let pool = null;
let houseWallet = null;
const spectatorWallets = {}; // bettorId -> wallet (mock: auto-funded)

function broadcast(ev) {
  const line = `data: ${JSON.stringify(ev)}\n\n`;
  for (const res of clients) res.write(line);
}

// LLM provider for prompt-type agents (community personas). Optional.
const llmComplete = process.env.ANTHROPIC_API_KEY ? llm.anthropic() : process.env.OPENAI_API_KEY ? llm.openaiCompatible() : null;

async function ensureWallet(rec) {
  // Mock wallets live in memory, so re-create after a restart; Circle wallets persist.
  if (rec.wallet && (wallet.kind === "circle" || wallet.balances?.has(rec.wallet.walletId))) return rec.wallet;
  const w = await wallet.createSeatWallet(rec.name); registry.setWallet(rec.id, w); return w;
}

function instantiate(rec) {
  const base = { id: rec.id, name: rec.name };
  let ag;
  if (rec.type === "endpoint") {
    ag = new RemoteAgent({ ...base, endpoint: rec.endpoint, sign: (body) => registry.signature(rec, body),
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

async function buildAgents() {
  // Seat community agents that can cover the ante; house fills the rest.
  const funded = new Set();
  for (const a of registry.list()) {
    if (a.house || a.status !== "active") continue;
    try { const w = await ensureWallet(registry.get(a.id)); if ((await wallet.getBalance(w.walletId)) >= ANTE) funded.add(a.id); } catch {}
  }
  const recs = registry.pickSeats(TABLE_SIZE, { eligible: (a) => funded.has(a.id) });
  const agents = [];
  for (const rec of recs) { const ag = instantiate(rec); ag.walletInfo = await ensureWallet(rec); agents.push(ag); }
  registry.markPlayed(recs.map((r) => r.id));
  return agents;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cycle() {
  if (!houseWallet) houseWallet = await wallet.createSeatWallet("house");
  while (true) {
    const agents = await buildAgents();
    state.matchNo++;
    state.seats = agents.map((a) => ({ id: a.id, name: a.name, kind: a.kind, owner: a.owner || "house" }));

    // 1) betting window
    pool = new BettingPool({ wallet, houseFeeBps: 200 });
    await pool.init();
    state.phase = "betting"; state.bets = []; state.multipliers = impliedMultipliers([], agents.map(a => a.id), 200);
    state.betCloseAt = Date.now() + BET_WINDOW_MS;
    broadcast({ type: "phase", ...publicState() });
    await sleep(BET_WINDOW_MS);
    pool.close();

    // 2) match
    state.phase = "playing";
    broadcast({ type: "phase", ...publicState() });
    const result = await runMatch({
      agents, wallet, ante: ANTE, seed: Date.now(),
      onEvent: async (ev) => { broadcast(ev); if (ev.type === "turn") await sleep(TURN_DELAY_MS); else if (ev.type === "reveal") await sleep(REVEAL_DELAY_MS); else if (ev.type === "hand_start") await sleep(DEAL_DELAY_MS); else if (ev.type === "ante") await sleep(500); },
    });

    stats.recordMatch({ matchNo: state.matchNo, seats: state.seats, winnerId: result.winnerId, potTotal: result.potTotal,
                        ante: ANTE, log: result.log, poolTotal: pool.bets.reduce((s, b) => s + b.amount, 0), seed: result.seed });

    // 3) spectator settlement
    const settlement = await pool.settle(result.winnerId, houseWallet);
    stats.recordBets(pool.bets, result.winnerId, settlement.payouts);
    state.phase = "settled";
    broadcast({ type: "pool_settled", winnerId: result.winnerId, winnerName: result.winnerName, ...settlement, ...publicState() });
    await sleep(8000);
  }
}

function publicState() {
  return { phase: state.phase, matchNo: state.matchNo, seats: state.seats, bets: state.bets,
           multipliers: state.multipliers, betCloseAt: state.betCloseAt, poolTotal: state.bets.reduce((s, b) => s + b.amount, 0), ante: ANTE, walletKind: wallet.kind };
}

// ---- http ---------------------------------------------------------------
const PUBLIC = path.join(__dirname, "public");
const PAGES = { "/": "landing.html", "/arena": "index.html", "/leaderboard": "leaderboard.html", "/how-it-works": "how.html", "/agents": "agents.html" };
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".txt": "text/plain" };
function sendFile(res, file) {
  const full = path.join(PUBLIC, file);
  if (!full.startsWith(PUBLIC) || !fs.existsSync(full)) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "content-type": MIME[path.extname(full)] || "application/octet-stream", "cache-control": file.endsWith(".html") ? "no-cache" : "public, max-age=3600" });
  fs.createReadStream(full).pipe(res);
}

function json(res, code, obj) { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-cache" }); res.end(JSON.stringify(obj)); }
function readBody(req) { return new Promise((r) => { let b = ""; req.on("data", (c) => { b += c; if (b.length > 20000) req.destroy(); }); req.on("end", () => r(b)); }); }
function bearer(req) { const h = req.headers.authorization || ""; return h.startsWith("Bearer ") ? h.slice(7) : null; }

async function agentsApi(req, res, url) {
  const parts = url.split("/").filter(Boolean); // api, agents, :id?, :action?
  const lb = stats.leaderboard(); const eloById = Object.fromEntries(lb.agents.map((a) => [a.id, a]));
  const decorate = (a) => ({ ...a, elo: eloById[a.id]?.elo ?? 1200, won: eloById[a.id]?.won ?? 0, matches: eloById[a.id]?.played ?? 0 });

  try {
    if (parts.length === 2 && req.method === "GET") return json(res, 200, { agents: registry.list().map(decorate), ante: ANTE, tableSize: TABLE_SIZE, promptAgentsEnabled: !!llmComplete, allowLocal: registry.allowLocal });

    if (parts.length === 2 && req.method === "POST") {
      const body = JSON.parse(await readBody(req) || "{}");
      if (body.type === "prompt" && !llmComplete) throw new Error("Prompt agents need a model key on this server — choose heuristic or endpoint for now.");
      const rec = registry.register(body);
      const w = await ensureWallet(rec);
      broadcast({ type: "agent_joined", id: rec.id, name: rec.name, owner: rec.owner });
      return json(res, 201, { ok: true, agent: decorate(registry.publicView(rec)), key: rec.key, fundingAddress: w.address,
        balance: await wallet.getBalance(w.walletId), note: wallet.kind === "circle" ? `Send at least ${ANTE} USDC on Arc to the funding address to be seated.` : "Mock wallet auto-funded with 100 USDC for local play." });
    }

    const rec = registry.get(parts[2]); if (!rec) return json(res, 404, { ok: false, error: "No such agent." });

    if (parts.length === 3 && req.method === "GET") {
      const w = rec.wallet ? await wallet.getBalance(rec.wallet.walletId).catch(() => null) : null;
      return json(res, 200, { ok: true, agent: decorate(registry.publicView(rec)), balance: w });
    }

    // Everything below needs the owner's key.
    if (!registry.auth(rec.id, bearer(req))) return json(res, 401, { ok: false, error: "Wrong or missing agent key." });

    if (parts[3] === "test" && req.method === "POST") {
      if (rec.type !== "endpoint") return json(res, 200, { ok: true, skipped: true, message: "Only endpoint agents need a test." });
      const view = { you: { id: rec.id, name: rec.name, dice: [3, 3, 1, 5, 6] }, table: [{ id: rec.id, name: rec.name, diceCount: 5, alive: true }, { id: "shark", name: "The Shark", diceCount: 4, alive: true }, { id: "degen", name: "Degen", diceCount: 5, alive: true }], totalDice: 14, currentBid: { count: 4, face: 3, byId: "degen" }, onesWild: true, whoseTurn: rec.id };
      let ok = true, why = null;
      const ag = new RemoteAgent({ id: rec.id, name: rec.name, endpoint: rec.endpoint, sign: (b) => registry.signature(rec, b), onResult: (o, w) => { ok = o; why = w; } });
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
  const url = req.url.split("?")[0];
  if (PAGES[url]) return sendFile(res, PAGES[url]);
  if (url === "/health") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ ok: true, phase: state.phase, matchNo: state.matchNo, wallet: wallet.kind, clients: clients.size })); }
  if (url === "/api/leaderboard") { res.writeHead(200, { "content-type": "application/json", "cache-control": "no-cache" }); return res.end(JSON.stringify(stats.leaderboard())); }
  if (url === "/api/state") { res.writeHead(200, { "content-type": "application/json", "cache-control": "no-cache" }); return res.end(JSON.stringify(publicState())); }
  if (url.startsWith("/static/")) return sendFile(res, url.slice("/static/".length));
  if (url.startsWith("/api/agents")) return agentsApi(req, res, url);

  if (url === "/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.write(`data: ${JSON.stringify({ type: "phase", ...publicState() })}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  if (url === "/api/bet" && req.method === "POST") {
    let body = ""; req.on("data", (c) => body += c);
    req.on("end", async () => {
      try {
        const { bettorId, agentId, amount } = JSON.parse(body);
        if (!pool || !pool.open) throw new Error("Betting is closed — wait for the next match.");
        if (!state.seats.find((s) => s.id === agentId)) throw new Error("Unknown seat.");
        const amt = Number(amount);
        if (!(amt > 0) || amt > 1000) throw new Error("Stake must be between 0 and 1000 USDC.");
        // Mock: hand every spectator an auto-funded wallet. Real: the spectator
        // transfers from THEIR wallet to pool.poolWallet.address (Gateway / connected wallet).
        if (!spectatorWallets[bettorId]) spectatorWallets[bettorId] = await wallet.createSeatWallet(bettorId);
        const r = await pool.placeBet({ bettorId, bettorWallet: spectatorWallets[bettorId], agentId, amount: amt });
        state.bets = pool.bets;
        state.multipliers = impliedMultipliers(pool.bets, state.seats.map((s) => s.id), pool.houseFeeBps);
        broadcast({ type: "bet", bettorId, agentId, amount: amt, tx: r.tx, explorer: r.explorer, ...publicState() });
        const bal = await wallet.getBalance(spectatorWallets[bettorId].walletId);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, tx: r.tx, explorer: r.explorer, balance: bal, poolAddress: pool.poolWallet.address }));
      } catch (e) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  if (url.startsWith("/api/balance/")) {
    const id = decodeURIComponent(url.split("/").pop());
    const w = spectatorWallets[id];
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ balance: w ? await wallet.getBalance(w.walletId) : null }));
  }

  res.writeHead(404, { "content-type": "text/plain" }); res.end("not found");
});

server.listen(PORT, () => {
  console.log(`Liar's Dice Arena → http://localhost:${PORT}   (wallet: ${wallet.kind}, agents: ${process.env.USE_LLM ? "llm" : "mock"})`);
  cycle().catch((e) => { console.error("cycle crashed:", e); process.exit(1); });
});
