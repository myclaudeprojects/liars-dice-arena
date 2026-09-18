// server.js — Live arena. Serves the spectator UI, streams every event over
// SSE, and runs many parallel tables (crowd → lock → partner market → credit match → settlement).
// Spectators watch, tip creators (USDC gifts), and buy agent tokens.
// Agents play with free Arena Credits. Platform USDC prizes go to creators.
// There is no spectator wagering pool and no USDC ante pot.
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
const { TipBook, assertTipAmount } = require("./src/tips");
const { CreditBook } = require("./src/credits");
const { prizeRules } = require("./src/prizes");
const { InfluenceBook, assertInfluence, influenceList } = require("./src/influence");
const { OracleBook, assertTipsOpen, matchIdFor, parseMatchId, PHASES } = require("./src/lifecycle");
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
const START_DELAY_MS = envNum("CROWD_DELAY_MS", envNum("START_DELAY_MS", 8000));
const MARKET_DELAY_MS = envNum("MARKET_DELAY_MS", 4000);
const ANTE = econ.assertAnteCredits(envNum("ANTE_CREDITS", envNum("ANTE", econ.DEFAULT_ANTE_CREDITS)));
const MIN_TIP = envNum("MIN_TIP", envNum("MIN_STAKE", econ.MIN_TIP));
const PREDICTION_VENUE = String(process.env.PREDICTION_VENUE || "placeholder");

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

const spectatorWallets = {}; // mock tipperId -> wallet (auto-funded demo balances)
const mockTokenBuys = {}; // agentId -> mock purchases (demo only; not on chain)
const tips = new TipBook();
const credits = new CreditBook();
const influence = new InfluenceBook();
const oracle = new OracleBook();

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
  ag.influenceOf = () => influence.snapshot(rec.id);
  return ag;
}

const tables = new TableManager({
  wallet, registry, stats, credits, influence, oracle, instantiate,
  ante: ANTE, tableSize: TABLE_SIZE, tableCount: TABLE_COUNT, liveChain: LIVE_CHAIN,
  startDelayMs: START_DELAY_MS, crowdDelayMs: START_DELAY_MS, marketDelayMs: MARKET_DELAY_MS,
  turnDelayMs: TURN_DELAY_MS, revealDelayMs: REVEAL_DELAY_MS,
  dealDelayMs: DEAL_DELAY_MS, minTip: MIN_TIP, shouldReleaseTxClaim,
  predictionVenue: PREDICTION_VENUE,
  staggerMs: Math.max(1500, Math.round(START_DELAY_MS / Math.max(1, TABLE_COUNT)) * 4),
});

function lobbyState() {
  const feat = tables.featured();
  return {
    ...(feat ? feat.publicState() : { phase: "idle", matchNo: 0, seats: [], startCloseAt: null, unit: "credits" }),
    tables: tables.list(),
    tableCount: tables.tables.length,
    ante: ANTE, unit: "credits", minTip: MIN_TIP,
    walletKind: wallet.kind, live: LIVE_CHAIN,     startDelayMs: START_DELAY_MS, crowdDelayMs: START_DELAY_MS, marketDelayMs: MARKET_DELAY_MS,
    noSpectatorPool: true, noUsdcPot: true,
    ldaDoesNotCustodyBets: true, ldaPaysWinnersFromLosers: false,
    tipSplit: { creatorBps: econ.TIP_CREATOR_BPS, houseBps: econ.TIP_HOUSE_BPS },
    prize: prizeRules(),
    influences: influenceList(),
    entitlesWinnings: false,
    phases: PHASES,
    predictionVenue: PREDICTION_VENUE,
    tipsOpen: feat ? feat.tipsOpen() : false,
  };
}

function chainView() {
  return wallet.chainInfo ? wallet.chainInfo() : null;
}

function tipMeta(rec, table) {
  const creator = rec?.ownerAddress || (rec?.house ? econ.PRIZE_WALLET : null);
  const t = table || tables.findTableFeaturing(rec.id);
  const open = t ? t.tipsOpen() : false;
  return {
    gift: true,
    notABet: true,
    toCredits: false,
    toPrize: false,
    toPot: false,
    toSeat: false,
    entitlesWinnings: false,
    minTip: MIN_TIP,
    creatorBps: econ.TIP_CREATOR_BPS,
    houseBps: econ.TIP_HOUSE_BPS,
    creatorAddress: creator,
    fundingAddress: creator,
    choices: influenceList(),
    current: influence.snapshot(rec.id),
    tipsOpen: open,
    phase: t ? t.phase : "build",
    matchId: t ? t.matchId : null,
    crowdOnly: true,
  };
}

function resolveTipDest(rec) {
  if (rec.ownerAddress) return { address: rec.ownerAddress };
  if (rec.house) return { address: econ.PRIZE_WALLET };
  throw new Error("This agent has no creator wallet to tip.");
}

async function placeTip(rec, body = {}) {
  const tableId = body.tableId || null;
  const dest = resolveTipDest(rec);
  const tipperId = String(body.from || body.address || body.tipperId || "spectator").slice(0, 64);
  const claimedAmt = Number(body.amount);
  const inf = assertInfluence(body.influence);
  const t = tables.findTableFeaturing(rec.id, tableId);
  assertTipsOpen(t ? t.phase : "build");

  const broadcastTip = (row, extra = {}) => {
    const t = tables.findTableFeaturing(rec.id, tableId);
    if (!t) return;
    t.broadcast({
      type: "tip",
      from: row.from, agentId: rec.id, agentName: rec.name,
      amount: row.amount, influence: row.influence,
      tx: extra.tx || row.txHash,
      explorer: extra.explorer || (row.txHash ? wallet.explorerUrl(row.txHash) : null),
      tableId: t.id, gift: true, creator: dest.address,
      creatorBps: econ.TIP_CREATOR_BPS, houseBps: econ.TIP_HOUSE_BPS,
      entitlesWinnings: false,
      influenceSnapshot: extra.snap || influence.snapshot(rec.id),
      ...t.publicState(),
    });
    tables.notifyLobby();
  };

  if (body.txHash && wallet.verifyDeposit) {
    tips.claimTx(body.txHash);
    try {
      const dep = await wallet.verifyDeposit(body.txHash, dest.address);
      const amt = assertTipAmount(dep.amount, MIN_TIP);
      if (Number.isFinite(claimedAmt) && Math.abs(dep.amount - claimedAmt) > 0.000001) {
        throw new Error(`Transfer was ${dep.amount} USDC, not ${claimedAmt}.`);
      }
      if (body.address && dep.from.toLowerCase() !== String(body.address).toLowerCase()) {
        throw new Error("Transfer came from a different wallet.");
      }
      const row = tips.record({
        from: dep.from, agentId: rec.id, amount: amt, txHash: body.txHash,
        tableId: tableId || null, creator: dest.address, influence: inf, mock: false,
      });
      const snap = influence.apply(rec.id, inf, amt);
      stats.recordTip({ from: dep.from, agentId: rec.id, amount: amt });
      broadcastTip(row, { tx: body.txHash, explorer: wallet.explorerUrl(body.txHash), snap });
      return {
        ok: true, gift: true, amount: amt, agentId: rec.id,
        influence: inf, influenceSnapshot: snap,
        creatorAddress: dest.address, tx: body.txHash,
        explorer: wallet.explorerUrl(body.txHash),
        creatorBps: econ.TIP_CREATOR_BPS, houseBps: econ.TIP_HOUSE_BPS,
        entitlesWinnings: false, toCredits: false, toPrize: false, toPot: false,
        note: "Crowd-phase gift to the creator wallet. It shifts pre-lock persona weights and does not fund credits or prizes. You are never entitled to winnings.",
      };
    } catch (e) {
      if (shouldReleaseTxClaim(e)) tips.releaseTx(body.txHash);
      throw e;
    }
  }

  const amt = assertTipAmount(claimedAmt, MIN_TIP);
  if (LIVE_CHAIN) throw new Error("On a live chain, tip from your own wallet (send USDC to the creator address and include txHash).");
  if (!spectatorWallets[tipperId]) spectatorWallets[tipperId] = await wallet.createSeatWallet("spectator:" + tipperId);
  const fromW = spectatorWallets[tipperId];
  const tx = await wallet.ante(fromW, dest, amt);
  const row = tips.record({ from: tipperId, agentId: rec.id, amount: amt, txHash: tx, tableId, creator: dest.address, influence: inf, mock: true });
  const snap = influence.apply(rec.id, inf, amt);
  stats.recordTip({ from: tipperId, agentId: rec.id, amount: amt });
  broadcastTip(row, { tx, explorer: wallet.explorerUrl(tx), snap });
  const bal = await wallet.getBalance(fromW.walletId);
  return {
    ok: true, gift: true, mock: true, amount: amt, agentId: rec.id,
    influence: inf, influenceSnapshot: snap,
    creatorAddress: dest.address, tx, explorer: wallet.explorerUrl(tx),
    balance: bal, creatorBps: econ.TIP_CREATOR_BPS, houseBps: econ.TIP_HOUSE_BPS,
    entitlesWinnings: false, toCredits: false, toPrize: false, toPot: false,
    note: "Demo crowd-phase tip: 100% to the creator (mock wallets, not on chain). Pre-lock influence only. Not credits, not a prize, not a match stake. You are never entitled to winnings.",
  };
}

// ---- http ---------------------------------------------------------------
const PUBLIC = path.join(__dirname, "public");
const PAGES = {
  "/": "landing.html", "/arena": "index.html", "/tables": "tables.html",
  "/leaderboard": "leaderboard.html", "/how-it-works": "how.html", "/agents": "agents.html",
  "/legal": "legal.html", "/terms": "terms.html", "/privacy": "privacy.html",
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

async function agentsApi(req, res, urlPath, q) {
  const parts = urlPath.split("/").filter(Boolean); // api, agents, :id?, :action?
  const lb = stats.leaderboard(); const eloById = Object.fromEntries(lb.agents.map((a) => [a.id, a]));
  const seated = tables.seatedIndex();
  const decorate = (a) => {
    const st = eloById[a.id] || {};
    return {
      ...a,
        elo: st.elo ?? 1200, won: st.won ?? 0, matches: st.played ?? a.played ?? 0,
        played: st.played ?? a.played ?? 0,
        creditsWon: st.creditsWon ?? 0, creditsLost: st.creditsLost ?? 0,
        net: +((st.creditsWon || 0) - (st.creditsLost || 0)).toFixed(2),
        prizesUsdc: st.prizesUsdc ?? 0, tipsUsdc: st.tipsUsdc ?? 0,
        form: st.form || [],
        personaTag: a.personaTag || llm.personaTag(a),
        seatedAt: seated[a.id] || [],
        unit: "credits", redeemable: false,
      buy: argus.buyView(a.token, { house: a.house, name: a.name, id: a.id }),
    };
  };
  const holdingsOf = (rec) => ({
    credits: credits.balance(rec.id),
    unit: "credits",
    redeemable: false,
    startingCredits: econ.STARTING_CREDITS,
    creatorAddress: rec.ownerAddress || (rec.house ? econ.PRIZE_WALLET : null),
    fundingAddress: rec.ownerAddress || (rec.house ? econ.PRIZE_WALLET : null),
    ante: ANTE,
    sidelined: rec.status === "sidelined",
    sidelineReason: rec.sidelineReason || null,
  });

  try {
    if (parts.length === 2 && req.method === "GET") {
      return json(res, 200, {
        agents: registry.list().map(decorate), ante: ANTE, unit: "credits", tableSize: TABLE_SIZE, tableCount: TABLE_COUNT,
        startingCredits: econ.STARTING_CREDITS, creditTiers: econ.CREDIT_TIERS,
        promptAgentsEnabled: !!llmComplete, allowLocal: registry.allowLocal, walletKind: wallet.kind, live: LIVE_CHAIN,
        economics: argus.AGENT_TOKEN_ECONOMICS,
        tipSplit: { creatorBps: econ.TIP_CREATOR_BPS, houseBps: econ.TIP_HOUSE_BPS, houseAddress: econ.HOUSE_FEE_ADDRESS },
        prize: prizeRules(), prizeWallet: econ.PRIZE_WALLET,
        noSpectatorPool: true, noUsdcPot: true,
        influences: influenceList(),
        entitlesWinnings: false,
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
      const creditBal = credits.ensure(rec.id);
      let token = null;
      try {
        const launched = await argus.onAgentRegistered({
          agent: rec, ownerAddress: rec.ownerAddress,
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
        ? "Demo: token spec stored (30/35/25 prize treasury/10). No chain call — Argus has no public create API."
        : (token?.status === "webhook_posted"
          ? "Operator webhook accepted the token spec. Creator = your connected wallet."
          : (token?.message || "Argus has no public create API. Spec is stored; finish launch on argus.world (creator = you)."));
      return json(res, 201, { ok: true, agent: decorate(registry.publicView(rec)), key: rec.key,
        creatorAddress: rec.ownerAddress,
        credits: creditBal, unit: "credits", redeemable: false,
        token, economics: argus.AGENT_TOKEN_ECONOMICS,
        tablesUrl: `/tables?agent=${encodeURIComponent(rec.id)}`,
        agentUrl: `/agent/${encodeURIComponent(rec.id)}`,
        buy: argus.buyView(token, { house: false, name: rec.name, id: rec.id }),
        mock: wallet.kind === "mock", live: LIVE_CHAIN,
        note: `Granted ${econ.STARTING_CREDITS} free Arena Credits. Credits are not purchased and not redeemable for USDC. Tips go to your creator wallet.`,
        launch: {
          mock: wallet.kind === "mock", live: LIVE_CHAIN,
          status: token?.status || "unknown",
          argusUrl: argus.tokenPageUrl(token),
          message: launchMsg,
          steps: [
            { id: "register", ok: true, label: "Agent registered" },
            { id: "credits", ok: true, label: `Granted ${econ.STARTING_CREDITS} free Arena Credits (not redeemable)` },
            { id: "token", ok: tokenOk, status: token?.status || null, label: tokenOk ? "Argus token queued (30/35/25 prize treasury/10, creator = you)" : "Token hook failed — spec still saved" },
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
      const table = tables.findTableFeaturing(rec.id, q.get("table"));
      return json(res, 200, {
        ok: true, agent: decorate(registry.publicView(rec)),
        credits: credits.balance(rec.id), unit: "credits", redeemable: false,
        holdings: holdingsOf(rec),
        tables: tables.featuring(rec.id),
        buy: argus.buyView(rec.token, { house: rec.house, name: rec.name, id: rec.id }),
        tip: tipMeta(rec, table),
        influence: influence.snapshot(rec.id),
        influences: influenceList(),
        live: LIVE_CHAIN,
        mockPurchases: LIVE_CHAIN ? undefined : (mockTokenBuys[rec.id] || []),
        economics: argus.AGENT_TOKEN_ECONOMICS,
        tipSplit: { creatorBps: econ.TIP_CREATOR_BPS, houseBps: econ.TIP_HOUSE_BPS },
        prize: prizeRules(),
        noSpectatorPool: true, noUsdcPot: true,
        ldaDoesNotCustodyBets: true,
        market: table ? table.market : null,
        matchId: table ? table.matchId : null,
        phase: table ? table.phase : "build",
        lockedConfigHash: table && table.lockedConfig ? table.lockedConfig.lockedConfigHash : null,
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
      if (!(amt >= MIN_TIP) || amt > 1000) throw new Error(`Amount must be between ${MIN_TIP} and 1000 USDC.`);
      const quote = argus.quoteMockBuy(amt, { symbol: buy.symbol || rec.name });
      const purchase = { ...quote, buyer: String(body.buyer || "spectator").slice(0, 64), at: Date.now(), agentId: rec.id };
      (mockTokenBuys[rec.id] ||= []).push(purchase);
      return json(res, 200, { ok: true, mock: true, live: false, purchase, buy, agentId: rec.id });
    }

    if (parts[3] === "tip" && req.method === "POST") {
      const body = JSON.parse(await readBody(req) || "{}");
      return json(res, 200, await placeTip(rec, body));
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
      registry.reactivate(rec.id);
      credits.ensure(rec.id);
      return json(res, 200, { ok: true, credits: credits.balance(rec.id), unit: "credits" });
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
      ante: ANTE, unit: "credits", minTip: MIN_TIP, tableSize: TABLE_SIZE, tableCount: TABLE_COUNT,
      startingCredits: econ.STARTING_CREDITS, creditTiers: econ.CREDIT_TIERS,
      walletKind: wallet.kind, live: LIVE_CHAIN,
      publicBaseUrl: siteOrigin(), supportEmail: econ.SUPPORT_EMAIL,
      houseFeeAddress: econ.HOUSE_FEE_ADDRESS, prizeWallet: econ.PRIZE_WALLET,
      tipSplit: { creatorBps: econ.TIP_CREATOR_BPS, houseBps: econ.TIP_HOUSE_BPS },
      prize: prizeRules(),
      tokenTax: argus.AGENT_TOKEN_ECONOMICS,
      turnTimeoutMs: TURN_TIMEOUT_MS,
      startDelayMs: START_DELAY_MS,
      crowdDelayMs: START_DELAY_MS,
      marketDelayMs: MARKET_DELAY_MS,
      noSpectatorPool: true, noUsdcPot: true,
      ldaDoesNotCustodyBets: true,
      ldaPaysWinnersFromLosers: false,
      influences: influenceList(),
      entitlesWinnings: false,
      phases: PHASES,
      predictionVenue: PREDICTION_VENUE,
      chainId: wallet.chainId || null,
      chain: chainView(),
    });
  }
  if (url === "/api/treasury" && req.method === "POST") {
    try {
      const secret = process.env.TREASURY_WEBHOOK_SECRET || process.env.BANKROLL_WEBHOOK_SECRET;
      if (!secret || !timingSafeEqualString(bearer(req), secret)) {
        return json(res, 401, { ok: false, error: "Wrong or missing treasury secret." });
      }
      const body = JSON.parse(await readBody(req) || "{}");
      const entry = stats.recordTreasury({
        amount: body.amount, txHash: body.txHash || null,
        source: body.source || "token_tax_prize_treasury",
      });
      return json(res, 200, {
        ok: true, fundsPlay: false, extra: false, entry,
        prizeWallet: econ.PRIZE_WALLET,
        note: "Token-tax 25% is platform prize treasury. It never funds Arena Credits or match pots.",
      });
    } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
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
  if (url.startsWith("/api/agents")) return agentsApi(req, res, url, q);

  if (url === "/api/tables" && req.method === "GET") {
    return json(res, 200, {
      tables: tables.list({ agent: q.get("agent"), owner: q.get("owner"), q: q.get("q") }),
      tableCount: tables.tables.length, tableSize: TABLE_SIZE, ante: ANTE, unit: "credits",
      walletKind: wallet.kind, live: LIVE_CHAIN, startDelayMs: START_DELAY_MS,
      noSpectatorPool: true, noUsdcPot: true, prize: prizeRules(),
      ldaDoesNotCustodyBets: true, predictionVenue: PREDICTION_VENUE,
    });
  }

  if (url === "/api/oracle" && req.method === "GET") {
    const tid = q.get("table");
    const matchNo = q.get("match");
    if (tid && matchNo) {
      const rec = oracle.get(matchIdFor(tid, matchNo));
      if (!rec) return json(res, 404, { ok: false, error: "No such match." });
      return json(res, 200, { ok: true, ...rec });
    }
    return json(res, 200, { ok: true, matches: oracle.list({ tableId: tid || undefined }), oracleVersion: 1 });
  }

  if ((url.startsWith("/api/oracle/") || url.startsWith("/api/matches/")) && req.method === "GET") {
    const id = decodeURIComponent(url.split("/").slice(3).join("/") || url.split("/").pop());
    const parsed = parseMatchId(id);
    const rec = oracle.get(id) || (parsed ? oracle.get(matchIdFor(parsed.tableId, parsed.matchNo)) : null);
    if (!rec) return json(res, 404, { ok: false, error: "No such match." });
    return json(res, 200, { ok: true, ...rec });
  }

  const tableParts = url.split("/").filter(Boolean); // api, tables, t-1, events
  if (tableParts[0] === "api" && tableParts[1] === "tables" && tableParts[2] && TABLE_ID_RE.test(tableParts[2])) {
    const table = tables.get(tableParts[2]);
    if (!table) return json(res, 404, { ok: false, error: "No such table." });
    const action = tableParts[3] || "";
    if (!action && req.method === "GET") {
      return json(res, 200, {
        ok: true, table: table.summary(), state: table.publicState(),
        oracle: table.matchId ? oracle.get(table.matchId) : null,
        market: table.market,
      });
    }
    if (action === "events" && req.method === "GET") return table.subscribe(req, res);
    if (action === "oracle" && req.method === "GET") {
      const rec = table.matchId ? oracle.get(table.matchId) : null;
      if (!rec) return json(res, 404, { ok: false, error: "No oracle record yet." });
      return json(res, 200, { ok: true, ...rec });
    }
    return json(res, 404, { ok: false, error: "Unknown table endpoint." });
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
  console.log(`Liar's Dice Arena → http://${HOST}:${PORT}   (wallet: ${wallet.kind}, live: ${LIVE_CHAIN}, tables: ${TABLE_COUNT}×${TABLE_SIZE}, ante: ${ANTE} credits, start delay: ${START_DELAY_MS}ms, turn delay: ${TURN_DELAY_MS}ms, turn timeout: ${TURN_TIMEOUT_MS}ms)`);
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
