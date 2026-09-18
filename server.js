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
const avatar = require("./src/avatar");
const { resolvePublicFile, shouldReleaseTxClaim, timingSafeEqualString } = require("./src/httputil");
const { TableManager, TABLE_ID_RE } = require("./src/tables");
const econ = require("./src/economics");
const stats = new Stats();
const TABLE_SIZE = Math.max(2, Math.min(4, Math.round(Number(process.env.TABLE_SIZE) || econ.DEFAULT_TABLE_SIZE)));
const TABLE_COUNT = Math.max(1, Math.min(24, Math.round(Number(process.env.TABLE_COUNT) || econ.DEFAULT_TABLE_COUNT)));
const registry = new Registry({ allowLocal: process.env.ALLOW_LOCAL_AGENTS === "1" || !process.env.RENDER });

// Env numbers: tolerate "1600ms", " 30000 ", "0.1 USDC" etc.; fall back to the default on garbage.
function envNum(name, dflt) { const m = String(process.env[name] ?? "").match(/-?\d+(\.\d+)?/); const v = m ? Number(m[0]) : NaN; return Number.isFinite(v) ? v : dflt; }
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const TURN_DELAY_MS = envNum("TURN_DELAY_MS", 1000);
const TURN_TIMEOUT_MS = envNum("TURN_TIMEOUT_MS", 6000);
const REVEAL_DELAY_MS = envNum("REVEAL_DELAY_MS", 3000); // time for the flip sequence to play out
const DEAL_DELAY_MS = envNum("DEAL_DELAY_MS", 1000);
const BET_WINDOW_MS = envNum("BET_WINDOW_MS", 30000);
const ANTE = envNum("ANTE", econ.DEFAULT_ANTE);
const MIN_SEAT = envNum("MIN_SEAT", econ.MIN_SEAT);
const MIN_STAKE = envNum("MIN_STAKE", econ.MIN_STAKE);

// ---- world state --------------------------------------------------------
// Money adapter: MOCK=1 always wins (local previews). Else self-custodied
// hot key > Circle stub (not wired — ops throw TODO) > in-memory mock.
const wallet = makeWallet(process.env.MOCK === "1" ? { startingBalance: 100 } : process.env.HOUSE_PRIVATE_KEY ? {
  provider: "evm", privateKey: process.env.HOUSE_PRIVATE_KEY,
  rpcUrl: process.env.ARC_RPC_URL || "https://rpc.mainnet.arc.io", chainId: Number(process.env.ARC_CHAIN_ID || 5042),
  explorer: process.env.ARC_EXPLORER || "https://explorer.arc.io",
} : process.env.CIRCLE_API_KEY ? {
  provider: "circle", apiKey: process.env.CIRCLE_API_KEY,
  entitySecret: process.env.CIRCLE_ENTITY_SECRET, blockchain: process.env.CIRCLE_BLOCKCHAIN || "ARC",
} : { startingBalance: 100 });
const LIVE_CHAIN = wallet.kind === "evm";

const spectatorWallets = {}; // bettorId -> wallet (mock: auto-funded)
const mockTokenBuys = {}; // agentId -> mock purchases (demo only; not on chain)

function parseReq(req) {
  const u = new URL(req.url, "http://local");
  return { path: u.pathname, q: u.searchParams };
}

// LLM provider for prompt-type agents (community personas). Optional.
function pickLlm() {
  if (process.env.ANTHROPIC_API_KEY) return llm.anthropic();
  if (process.env.GROQ_API_KEY) {
    return llm.openaiCompatible({
      apiKey: process.env.GROQ_API_KEY,
      baseUrl: "https://api.groq.com/openai/v1",
      defaultModel: process.env.LLM_MODEL || "llama-3.1-8b-instant",
    });
  }
  if (process.env.OPENAI_API_KEY || process.env.LLM_BASE_URL) {
    return llm.openaiCompatible({
      apiKey: process.env.OPENAI_API_KEY || process.env.LLM_API_KEY,
      baseUrl: process.env.LLM_BASE_URL || "https://api.openai.com/v1",
      defaultModel: process.env.LLM_MODEL || "gpt-4o-mini",
    });
  }
  return null;
}
const llmComplete = pickLlm();

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
      allowLocal: registry.allowLocal, timeoutMs: TURN_TIMEOUT_MS,
      onResult: (ok) => ok ? registry.recordSuccess(rec.id) : registry.recordFailure(rec.id) });
  } else if (rec.type === "prompt" && llmComplete) {
    ag = new LLMAgent({ ...base, persona: rec.persona, complete: llmComplete, timeoutMs: TURN_TIMEOUT_MS });
  } else if (rec.house && process.env.USE_LLM && llmComplete && llm.PERSONAS[rec.persona]) {
    ag = new LLMAgent({ ...base, persona: llm.PERSONAS[rec.persona], complete: llmComplete, timeoutMs: TURN_TIMEOUT_MS });
  } else {
    ag = new MockAgent({ ...base, aggression: rec.aggression ?? 0.5 });
  }
  ag.owner = rec.owner;
  if (rec.ownerAddress) ag.creatorWallet = { address: rec.ownerAddress };
  else if (rec.house) ag.creatorWallet = { address: econ.HOUSE_FEE_ADDRESS };
  ag.ownerAddress = rec.ownerAddress || null;
  ag.personaTag = llm.personaTag(rec);
  return ag;
}

const tables = new TableManager({
  wallet, registry, stats, instantiate, ensureWallet,
  ante: ANTE, minSeat: MIN_SEAT, tableSize: TABLE_SIZE, tableCount: TABLE_COUNT, liveChain: LIVE_CHAIN,
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
    houseFeeBps: econ.HOUSE_FEE_BPS, seatFeeBps: econ.SEAT_FEE_BPS,
    houseFeeAddress: econ.HOUSE_FEE_ADDRESS,
    oneBetPerTable: true,
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
    const who = address || bettorId;
    if (who && pool.hasBettor(who)) throw new Error("One bet per table — you can still bet at other tables.");
    pool.claimTx(txHash);
    try {
      const dep = await wallet.verifyDeposit(txHash, pool.poolWallet.address);
      const amt = dep.amount;
      if (!(amt >= MIN_STAKE) || amt > 1000) throw new Error(`Stake must be between ${MIN_STAKE} and 1000 USDC.`);
      if (Number.isFinite(claimedAmt) && Math.abs(dep.amount - claimedAmt) > 0.000001) {
        throw new Error(`Transfer was ${dep.amount} USDC, not ${claimedAmt}.`);
      }
      if (address && dep.from.toLowerCase() !== String(address).toLowerCase()) throw new Error("Transfer came from a different wallet.");
      if (pool.hasBettor(dep.from)) throw new Error("One bet per table — you can still bet at other tables.");
      if (!pool.open && !(dep.timestamp <= (pool.closeAt || 0) + 3000 && table.phase === "playing" && !pool.settledAt)) {
        const rtx = await wallet.settle(pool.poolWallet, { address: dep.from }, dep.amount);
        throw new Error(`Betting had closed — refunded ${dep.amount} USDC to your wallet (tx ${rtx.slice(0, 10)}…).`);
      }
      pool.recordExternal({ bettorId: dep.from, address: dep.from, agentId, amount: amt, txHash, claimed: true });
      table.bets = pool.bets;
      table.multipliers = impliedMultipliers(pool.bets, table.seats.map((s) => s.id), { houseBps: pool.houseFeeBps, seatBps: pool.seatFeeBps });
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
  if (pool.hasBettor(bettorId)) throw new Error("One bet per table — you can still bet at other tables.");
  if (!spectatorWallets[bettorId]) spectatorWallets[bettorId] = await wallet.createSeatWallet("spectator:" + bettorId);
  const r = await pool.placeBet({ bettorId, bettorWallet: spectatorWallets[bettorId], agentId, amount: amt });
  table.bets = pool.bets;
  table.multipliers = impliedMultipliers(pool.bets, table.seats.map((s) => s.id), { houseBps: pool.houseFeeBps, seatBps: pool.seatFeeBps });
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
  "/legal": "legal.html",
};
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".txt": "text/plain" };
function sendFile(res, file) {
  const full = resolvePublicFile(PUBLIC, file);
  if (!full) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "content-type": MIME[path.extname(full)] || "application/octet-stream", "cache-control": file.endsWith(".html") ? "no-cache" : "public, max-age=3600" });
  fs.createReadStream(full).pipe(res);
}

function json(res, code, obj) { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-cache" }); res.end(JSON.stringify(obj)); }
function readBody(req, max = 20000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    let done = false;
    const finish = (fn, v) => { if (done) return; done = true; fn(v); };
    req.on("data", (c) => {
      n += c.length;
      if (n > max) { req.destroy(); finish(reject, new Error("Body too large.")); return; }
      chunks.push(c);
    });
    req.on("end", () => finish(resolve, Buffer.concat(chunks).toString("utf8")));
    req.on("error", (e) => finish(reject, e));
  });
}
function bearer(req) { const h = req.headers.authorization || ""; return h.startsWith("Bearer ") ? h.slice(7) : null; }

function sendAvatarBytes(res, { buf, mime, generated }) {
  res.writeHead(200, {
    "content-type": mime,
    "cache-control": generated ? "public, max-age=86400" : "public, max-age=3600",
    "content-length": buf.length,
    "x-content-type-options": "nosniff",
  });
  res.end(buf);
}

function siteOrigin() { return process.env.PUBLIC_BASE_URL || process.env.SITE_ORIGIN || econ.PUBLIC_BASE_URL; }

function stampTokenImage(rec, image) {
  const tok = rec?.token;
  if (!tok?.spec?.metadata) return tok;
  tok.spec.metadata.image = image;
  if (tok.spec.metadata.argusForm) tok.spec.metadata.argusForm.image = image;
  return tok;
}

async function agentsApi(req, res, urlPath) {
  const parts = urlPath.split("/").filter(Boolean); // api, agents, :id?, :action?
  const lb = stats.leaderboard(); const eloById = Object.fromEntries(lb.agents.map((a) => [a.id, a]));
  const seated = tables.seatedIndex();
  const decorate = (a) => {
    const st = eloById[a.id] || {};
    return {
      ...a,
        elo: st.elo ?? 1200, won: st.won ?? 0, matches: st.played ?? a.played ?? 0,
        played: st.played ?? a.played ?? 0,
        usdcWon: st.usdcWon ?? 0, usdcLost: st.usdcLost ?? 0,
        net: +((st.usdcWon || 0) - (st.usdcLost || 0)).toFixed(2),
        form: st.form || [],
        personaTag: a.personaTag || llm.personaTag(a),
        seatedAt: seated[a.id] || [],
      buy: argus.buyView(a.token, { house: a.house, name: a.name, id: a.id }),
    };
  };
  const holdingsOf = async (rec, balance) => ({
    seatBalance: balance,
    fundingAddress: rec.wallet?.address || null,
    creatorAddress: rec.ownerAddress || null,
    minSeat: MIN_SEAT,
    ante: ANTE,
    sidelined: rec.status === "sidelined",
    sidelineReason: rec.sidelineReason || null,
    bankroll: registry.bankrollSummary(rec),
    potSplit: { creatorBps: econ.POT_CREATOR_BPS, seatBps: econ.POT_SEAT_BPS },
  });

  try {
    if (parts.length === 2 && req.method === "GET") {
      return json(res, 200, {
        agents: registry.list().map(decorate), ante: ANTE, minSeat: MIN_SEAT, tableSize: TABLE_SIZE, tableCount: TABLE_COUNT,
        promptAgentsEnabled: !!llmComplete, allowLocal: registry.allowLocal, walletKind: wallet.kind, live: LIVE_CHAIN,
        economics: argus.AGENT_TOKEN_ECONOMICS,
        betSplit: { houseBps: econ.HOUSE_FEE_BPS, seatBps: econ.SEAT_FEE_BPS, pariBps: econ.PARI_BPS, houseAddress: econ.HOUSE_FEE_ADDRESS },
        potSplit: { creatorBps: econ.POT_CREATOR_BPS, seatBps: econ.POT_SEAT_BPS },
        supportEmail: econ.SUPPORT_EMAIL,
        publicBaseUrl: siteOrigin(),
        onboarding: {
          live: LIVE_CHAIN, mock: wallet.kind === "mock", walletKind: wallet.kind,
          injected: true,
          walletConnect: false,
          todos: ["TODO(wallet): WalletConnect v2 + Arc is not wired — use an injected wallet (MetaMask/Rabby in-app) or mock demo connect"],
        },
      });
    }

    if (parts.length === 2 && req.method === "POST") {
      const body = JSON.parse(await readBody(req) || "{}");
      const persona = String(body.persona || "").trim();
      if (!body.type) body.type = (persona.length >= 20 && llmComplete) ? "prompt" : "heuristic";
      if (body.type === "prompt" && !llmComplete) throw new Error("Prompt agents need a model key on this server — choose heuristic or endpoint for now.");
      const rec = registry.register(body);
      // Optional image URL at create — never fail the happy path if ingest dies.
      let imageWarning = null;
      if (body.imageUrl) {
        try {
          const av = await avatar.ingestFromUrl(rec.id, body.imageUrl, { allowLocal: registry.allowLocal });
          registry.setAvatar(rec.id, av);
          rec.avatar = av;
        } catch (e) {
          imageWarning = String(e.message || e).slice(0, 180);
        }
      }
      const w = await ensureWallet(rec);
      let token = null;
      try {
        const launched = await argus.onAgentRegistered({
          agent: rec, seatWallet: w, ownerAddress: rec.ownerAddress,
          deployerAddress: wallet.house?.address || process.env.HOUSE_ADDRESS || null,
          houseAddress: wallet.house?.address || process.env.HOUSE_ADDRESS || null,
          siteOrigin: siteOrigin(),
        });
        token = argus.publicTokenView(launched);
        registry.setToken(rec.id, token);
      } catch (e) {
        token = { status: "hook_failed", error: String(e.message || e).slice(0, 200) };
        try { registry.setToken(rec.id, token); } catch {}
      }
      tables.notifyLobby();
      const tokenOk = token && token.status && token.status !== "hook_failed" && token.status !== "webhook_failed";
      const launchMsg = wallet.kind === "mock"
        ? "Demo: token spec stored (30/35/25/10). No chain call — Argus has no public create API."
        : (token?.status === "webhook_posted"
          ? "Operator webhook accepted the token spec. Creator = your connected wallet."
          : (token?.message || "Argus has no public create API. Spec is stored; finish launch on argus.world (creator = you)."));
      return json(res, 201, { ok: true, agent: decorate(registry.publicView(rec)), key: rec.key, fundingAddress: w.address,
        balance: await wallet.getBalance(w.walletId), token, economics: argus.AGENT_TOKEN_ECONOMICS,
        tablesUrl: `/tables?agent=${encodeURIComponent(rec.id)}`,
        agentUrl: `/agent/${encodeURIComponent(rec.id)}`,
        buy: argus.buyView(token, { house: false, name: rec.name, id: rec.id }),
        mock: wallet.kind === "mock", live: LIVE_CHAIN,
        note: wallet.kind === "mock" ? "Mock wallet auto-funded with 100 USDC for local play." : `Send at least ${MIN_SEAT} USDC on Arc to the funding address to be seated (ante is ${ANTE}; below ${MIN_SEAT} sidelines the agent).`,
        launch: {
          mock: wallet.kind === "mock", live: LIVE_CHAIN,
          status: token?.status || "unknown",
          argusUrl: argus.tokenPageUrl(token),
          message: launchMsg,
          steps: [
            { id: "register", ok: true, label: "Agent registered" },
            { id: "seat", ok: true, label: wallet.kind === "mock" ? "Demo seat wallet funded" : "Seat wallet created" },
            { id: "token", ok: tokenOk, status: token?.status || null, label: tokenOk ? "Argus token queued (30/35/25/10, creator = you)" : "Token hook failed — spec still saved" },
          ],
        },
        imageWarning,
      });
    }

    const rec = registry.get(parts[2]); if (!rec) return json(res, 404, { ok: false, error: "No such agent." });

    if (parts[3] === "avatar" && req.method === "GET") {
      const up = avatar.readUpload(rec.avatar);
      if (up) {
        const buf = fs.readFileSync(up.full);
        return sendAvatarBytes(res, { buf, mime: up.mime, generated: false });
      }
      const svg = avatar.svg({ name: rec.name, id: rec.id });
      return sendAvatarBytes(res, { buf: Buffer.from(svg, "utf8"), mime: "image/svg+xml; charset=utf-8", generated: true });
    }

    if (parts.length === 3 && req.method === "GET") {
      const w = rec.wallet ? await wallet.getBalance(rec.wallet.walletId).catch(() => null) : null;
      return json(res, 200, {
        ok: true, agent: decorate(registry.publicView(rec)), balance: w,
        holdings: await holdingsOf(rec, w),
        tables: tables.featuring(rec.id),
        buy: argus.buyView(rec.token, { house: rec.house, name: rec.name, id: rec.id }),
        live: LIVE_CHAIN,
        mockPurchases: LIVE_CHAIN ? undefined : (mockTokenBuys[rec.id] || []),
        economics: argus.AGENT_TOKEN_ECONOMICS,
        betSplit: { houseBps: econ.HOUSE_FEE_BPS, seatBps: econ.SEAT_FEE_BPS, pariBps: econ.PARI_BPS },
      });
    }

    if (parts[3] === "buy" && req.method === "POST") {
      const body = JSON.parse(await readBody(req) || "{}");
      const buy = argus.buyView(rec.token, { house: rec.house, name: rec.name, id: rec.id });
      if (rec.house) {
        return json(res, 200, { ok: true, mock: false, live: LIVE_CHAIN, delegated: true, buy,
          message: buy.message });
      }
      if (LIVE_CHAIN) {
        return json(res, 200, {
          ok: true, mock: false, live: true, delegated: true, buy,
          buyUrl: buy.argusUrl,
          message: buy.address
            ? "Open Argus to buy this agent's token on Arc. In-app swap is not wired."
            : "Token is queued at registration — launch on Argus, then the CA will show here.",
        });
      }
      const amt = Number(body.amount);
      if (!(amt >= MIN_STAKE) || amt > 1000) throw new Error(`Amount must be between ${MIN_STAKE} and 1000 USDC.`);
      const quote = argus.quoteMockBuy(amt, { symbol: buy.symbol || rec.name });
      const purchase = { ...quote, buyer: String(body.buyer || "spectator").slice(0, 64), at: Date.now(), agentId: rec.id };
      (mockTokenBuys[rec.id] ||= []).push(purchase);
      return json(res, 200, { ok: true, mock: true, live: false, purchase, buy, agentId: rec.id });
    }

    if (parts[3] === "bankroll" && req.method === "POST") {
      const body = JSON.parse(await readBody(req) || "{}");
      const secret = process.env.BANKROLL_WEBHOOK_SECRET;
      const authed = registry.auth(rec.id, bearer(req)) || (secret && timingSafeEqualString(bearer(req), secret));
      if (!authed) return json(res, 401, { ok: false, error: "Wrong or missing agent key." });
      const amt = Number(body.amount);
      if (!(amt > 0) || !Number.isFinite(amt)) throw new Error("bad_amount");
      if (LIVE_CHAIN && wallet.verifyDeposit) {
        if (!body.txHash) throw new Error("Live bankroll top-up needs the deposit txHash to the seat address.");
        const seat = rec.wallet?.address;
        if (!seat) throw new Error("Agent has no seat wallet yet.");
        const dep = await wallet.verifyDeposit(body.txHash, seat);
        if (Math.abs(dep.amount - amt) > 0.000001) throw new Error(`Transfer was ${dep.amount} USDC, not ${amt}.`);
      } else if (wallet.kind === "mock" && rec.wallet && wallet.credit) {
        await wallet.credit(rec.wallet, amt);
      }
      const entry = registry.recordBankrollTopUp(rec.id, { amount: amt, txHash: body.txHash || null, source: body.source || "token_tax" });
      const bal = rec.wallet ? await wallet.getBalance(rec.wallet.walletId).catch(() => null) : null;
      if (bal != null && bal >= MIN_SEAT && rec.status === "sidelined") registry.reactivate(rec.id);
      return json(res, 200, {
        ok: true, extra: true, entry, balance: bal,
        status: registry.get(rec.id).status,
        note: "Token-tax 25% bankroll is an extra seat top-up — it does not replace creator funding.",
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
    if (parts[3] === "avatar" && req.method === "POST") {
      const body = JSON.parse(await readBody(req, 450000) || "{}");
      let recAvatar;
      if (body.kind === "generated" || body.reset) {
        recAvatar = { kind: "generated", updatedAt: Date.now() };
      } else if (body.image) {
        const { buf, mime } = avatar.decodeDataUrl(body.image);
        recAvatar = avatar.saveUpload(rec.id, buf, mime);
      } else if (body.imageUrl) {
        recAvatar = await avatar.ingestFromUrl(rec.id, body.imageUrl, { allowLocal: registry.allowLocal });
      } else {
        throw new Error("Send an image data URL, imageUrl, or kind=generated.");
      }
      registry.setAvatar(rec.id, recAvatar);
      const fresh = registry.get(rec.id);
      const image = avatar.publicUrl(rec.id, recAvatar, { siteOrigin: siteOrigin() });
      const tok = stampTokenImage(fresh, image);
      if (tok) registry.setToken(rec.id, tok);
      return json(res, 200, {
        ok: true,
        avatar: registry.publicView(registry.get(rec.id)).avatar,
        imageUrl: image,
        todos: ["TODO(argus): if the live create form only accepts a file, GET this image URL and attach it — no Argus image API is documented"],
      });
    }
    if (parts[3] === "retire" && req.method === "POST") { registry.retire(rec.id); return json(res, 200, { ok: true }); }
    if (parts[3] === "reactivate" && req.method === "POST") {
      const w = rec.wallet ? await wallet.getBalance(rec.wallet.walletId).catch(() => 0) : 0;
      if (!rec.house && w < MIN_SEAT) return json(res, 400, { ok: false, error: `Seat needs ${MIN_SEAT} USDC to sit (has ${w}).` });
      registry.reactivate(rec.id);
      return json(res, 200, { ok: true, balance: w });
    }
    return json(res, 404, { ok: false, error: "Unknown agents endpoint." });
  } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
}

const server = http.createServer(async (req, res) => {
  const { path: url, q } = parseReq(req);
  if (PAGES[url]) return sendFile(res, PAGES[url]);
  if (url.startsWith("/agent/")) {
    const rest = url.slice("/agent/".length);
    if (!rest.includes("/")) return sendFile(res, "agent.html");
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
  if (url === "/api/leaderboard" && req.method === "GET") {
    return json(res, 200, stats.leaderboard());
  }
  if (url === "/api/config" && req.method === "GET") {
    return json(res, 200, {
      ante: ANTE, minSeat: MIN_SEAT, minStake: MIN_STAKE, tableSize: TABLE_SIZE, tableCount: TABLE_COUNT,
      walletKind: wallet.kind, live: LIVE_CHAIN,
      publicBaseUrl: siteOrigin(), supportEmail: econ.SUPPORT_EMAIL,
      houseFeeAddress: econ.HOUSE_FEE_ADDRESS,
      betSplit: { houseBps: econ.HOUSE_FEE_BPS, seatBps: econ.SEAT_FEE_BPS, pariBps: econ.PARI_BPS },
      potSplit: { creatorBps: econ.POT_CREATOR_BPS, seatBps: econ.POT_SEAT_BPS },
      tokenTax: argus.AGENT_TOKEN_ECONOMICS,
      turnTimeoutMs: TURN_TIMEOUT_MS,
      chainId: wallet.chainId || null,
    });
  }
  if (url === "/api/state") { res.writeHead(200, { "content-type": "application/json", "cache-control": "no-cache" }); return res.end(JSON.stringify(lobbyState())); }
  if (url.startsWith("/static/")) return sendFile(res, url.slice("/static/".length));
  if (url === "/api/avatars/preview" && req.method === "GET") {
    const name = String(q.get("name") || "Agent").slice(0, 24);
    const id = String(q.get("id") || "").slice(0, 40);
    const svg = avatar.svg({ name, id });
    res.writeHead(200, {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff",
    });
    return res.end(svg);
  }
  if (url.startsWith("/api/agents")) return agentsApi(req, res, url);

  if (url === "/api/tables" && req.method === "GET") {
    return json(res, 200, {
      tables: tables.list({ agent: q.get("agent"), owner: q.get("owner"), q: q.get("q") }),
      tableCount: tables.tables.length, tableSize: TABLE_SIZE, ante: ANTE, minSeat: MIN_SEAT,
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
  console.log(`Liar's Dice Arena → http://${HOST}:${PORT}   (wallet: ${wallet.kind}, live: ${LIVE_CHAIN}, tables: ${TABLE_COUNT}×${TABLE_SIZE}, ante: ${ANTE}, bet window: ${BET_WINDOW_MS}ms, turn delay: ${TURN_DELAY_MS}ms, turn timeout: ${TURN_TIMEOUT_MS}ms)`);
  if (wallet.kind === "circle") {
    console.warn("CircleArcWallet is a stub (TODO(circle) on every money call). Set HOUSE_PRIVATE_KEY for live Arc, or MOCK=1 for local play.");
    if (/TESTNET/i.test(wallet.blockchain || "")) {
      console.warn("CIRCLE_BLOCKCHAIN is testnet — money paths are specified as Arc mainnet only. Default is ARC.");
    }
  }
  if (LIVE_CHAIN && wallet.chainId && Number(wallet.chainId) !== 5042) {
    console.warn(`ARC_CHAIN_ID=${wallet.chainId} is not Arc mainnet (5042).`);
  }
  tables.start().catch((e) => { console.error("tables start crashed (unrecoverable):", e); });
  process.on("unhandledRejection", (e) => console.error("unhandledRejection:", e));
  process.on("uncaughtException", (e) => console.error("uncaughtException:", e));
});
