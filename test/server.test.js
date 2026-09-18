// Boots the HTTP server long enough to prove routes the rewrite must not drop.
const { spawn } = require("child_process");
const http = require("http");
const os = require("os");
const fs = require("fs");
const path = require("path");

function assert(cond, msg) { if (!cond) throw new Error(msg); }

function get(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 4000 }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(body); } catch { /* html */ }
        resolve({ status: res.statusCode, body, json });
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout " + url)); });
  });
}

function post(url, obj, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(obj || {});
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method: "POST",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data), ...headers },
      timeout: 4000,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(body); } catch { /* html */ }
        resolve({ status: res.statusCode, body, json });
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout " + url)); });
    req.end(data);
  });
}

function forbiddenCopy(body, label) {
  const hits = [];
  if (/pari-mutuel/i.test(body)) hits.push("pari-mutuel");
  if (/\bracetrack\b/i.test(body)) hits.push("racetrack");
  if (/\bwager/i.test(body)) hits.push("wager");
  if (/\bodds\b/i.test(body)) hits.push("odds");
  if (/Buy \$LIAR/i.test(body)) hits.push("$LIAR");
  if (/Back an agent before the deal/i.test(body)) hits.push("back-before-deal");
  if (/(?<!not )win if (the )?agent wins/i.test(body)) hits.push("win-if-agent-wins");
  if (/LMSR AMM/i.test(body)) hits.push("lmsr-amm");
  if (/first-party USDC prediction/i.test(body)) hits.push("first-party-amm");
  if (hits.length) throw new Error(`${label} still has forbidden copy: ${hits.join(", ")}`);
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lda-srv-"));
  const port = 19000 + (process.pid % 1000);
  const child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: {
      ...process.env,
      MOCK: "1",
      PORT: String(port),
      HOST: "127.0.0.1",
      TABLE_COUNT: "1",
      TABLE_SIZE: "3",
      START_DELAY_MS: "8000",
      CROWD_DELAY_MS: "8000",
      MARKET_DELAY_MS: "8000",
      TURN_DELAY_MS: "0",
      REVEAL_DELAY_MS: "0",
      DEAL_DELAY_MS: "0",
      REGISTRY_PATH: path.join(dir, "agents.json"),
      STATS_PATH: path.join(dir, "stats.json"),
      BANKROLL_WEBHOOK_SECRET: "test-bankroll",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { out += d; });
  const t0 = Date.now();
  while (!/Liar's Dice Arena/.test(out) && Date.now() - t0 < 10000) {
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!/Liar's Dice Arena/.test(out)) {
    child.kill("SIGKILL");
    throw new Error("server did not start: " + out.slice(0, 500));
  }
  const base = `http://127.0.0.1:${port}`;
  try {
    const health = await get(base + "/health");
    assert(health.status === 200 && health.json && health.json.ok, "health");
    const cfg = await get(base + "/api/config");
    assert(cfg.json.publicBaseUrl === "https://liarsdicearc.app", "canonical domain");
    assert(cfg.json.supportEmail === "myclaudeprojects@gmail.com", "support");
    assert(cfg.json.houseFeeAddress === "0x341BB8851Ff8fD9EAE20ea083c2F779e646B8488", "house wallet");
    assert(cfg.json.tipSplit.creatorBps === 10000 && cfg.json.tipSplit.houseBps === 0, "tips 100% creator");
    assert(!cfg.json.betSplit, "no spectator bet split");
    assert(!cfg.json.potSplit, "no USDC pot split");
    assert(cfg.json.ante === 1 && cfg.json.unit === "credits", "credits ante");
    assert(cfg.json.noSpectatorPool === true, "no spectator pool");
    assert(cfg.json.firstPartyMarkets === false && cfg.json.ldaIsTheExchange === false, "not the exchange");
    assert(cfg.json.custody === false, "no prediction custody");
    assert(cfg.json.tokenTax.creatorFunds === 1, "100% creator tax");
    assert(cfg.json.tokenFeeSplit.platformTreasuryBps === 5000, "50/50 router");
    const legal = await get(base + "/legal");
    assert(legal.status === 200 && /myclaudeprojects@gmail.com/.test(legal.body), "legal page");
    assert(/cannot stake into a win pool/i.test(legal.body) || /not the exchange/i.test(legal.body), "legal: no LDA sportsbook");
    assert(/21\+/.test(legal.body), "21+");
    forbiddenCopy(legal.body, "legal");
    const terms = await get(base + "/terms");
    assert(terms.status === 200 && /not gambling/i.test(terms.body), "terms");
    assert(/never entitled to winnings/i.test(terms.body), "terms: never entitled");
    assert(/DCM/i.test(terms.body) || /not the exchange/i.test(terms.body), "terms: DCM");
    forbiddenCopy(terms.body, "terms");
    const privacy = await get(base + "/privacy");
    assert(privacy.status === 200 && /myclaudeprojects@gmail.com/.test(privacy.body), "privacy");
    forbiddenCopy(privacy.body, "privacy");
    const home = await get(base + "/");
    assert(home.status === 200, "home");
    assert(!/Buy \$LIAR/.test(home.body), "no $LIAR buy on homepage");
    forbiddenCopy(home.body, "home");
    const how = await get(base + "/how-it-works");
    assert(/Creator 100%/.test(how.body) && /fee router/i.test(how.body), "how: token tax");
    assert(/50% platform treasury/.test(how.body) && /50% persona creator/.test(how.body), "how: 50/50");
    assert(/not the exchange/i.test(how.body), "how: native UI ≠ exchange");
    assert(/Arena Credits/i.test(how.body), "how: credits");
    assert(/awaiting DCM/i.test(how.body), "how: awaiting DCM");
    assert(/never entitled to winnings/i.test(how.body), "how: never entitled");
    forbiddenCopy(how.body, "how");
    const arena = await get(base + "/arena?table=t-1");
    forbiddenCopy(arena.body, "arena");
    assert(/awaiting DCM/i.test(arena.body) || /WHO WINS/i.test(arena.body), "arena book UI");
    assert(!/Place bet/i.test(arena.body), "arena no place-bet");
    const agents = await get(base + "/api/agents");
    assert(agents.json.economics.creatorFunds === 1, "token tax 100% creator");
    assert((agents.json.economics.arenaSeatBankroll || 0) === 0, "no seat-bankroll tax");
    assert(agents.json.noSpectatorPool === true, "agents list flags");
    assert(agents.json.firstPartyMarkets === false, "agents: not first-party markets");

    const created = await post(base + "/api/agents", {
      name: "Tip Me", type: "heuristic", owner: "alice",
      ownerAddress: "0x" + "22".repeat(20),
    });
    assert(created.status === 201 && created.json.ok && created.json.agent.id, "register");
    assert(created.json.token.spec.recipients.feeRecipientKind === "fee_router_contract", "fee recipient kind");
    const tipMissing = await post(base + "/api/agents/" + created.json.agent.id + "/tip", { from: "spec-1", amount: 1 });
    assert(tipMissing.status === 400 && /influence/i.test(tipMissing.json.error), "tip requires influence");
    const tip = await post(base + "/api/agents/" + created.json.agent.id + "/tip", { from: "spec-1", amount: 1, influence: "aggressive" });
    assert(tip.status === 200 && tip.json.ok && tip.json.gift, "tip ok");
    assert(tip.json.amount === 1 && tip.json.creatorBps === 10000 && tip.json.toCreator === true, "tip 100% creator");
    assert(tip.json.toSeat === false && tip.json.entitlesWinnings === false, "tip not seat, never entitled");

    const mktBuy = await post(base + "/api/tables/t-1/market/buy", { amount: 1, agentId: "x" });
    assert(mktBuy.status === 409 && /does not custody/i.test(mktBuy.json.error), "no LDA custody buy");
    const goneBet = await post(base + "/api/bet", { agentId: "x", amount: 1 });
    assert(goneBet.status === 404, "/api/bet gone");
    const gonePool = await get(base + "/api/pool");
    assert(gonePool.status === 404, "/api/pool gone");
    console.log("server smoke ok");
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 300));
    try { child.kill("SIGKILL"); } catch { /* already gone */ }
  }
})().catch((e) => { console.error(e); process.exit(1); });
