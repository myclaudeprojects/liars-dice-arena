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
    const lb = await get(base + "/api/leaderboard");
    assert(lb.status === 200 && Array.isArray(lb.json.agents) && lb.json.totals, "leaderboard api");
    assert(Array.isArray(lb.json.tippers), "tippers board");
    const cfg = await get(base + "/api/config");
    assert(cfg.json.publicBaseUrl === "https://liarsdicearc.app", "canonical domain");
    assert(cfg.json.supportEmail === "myclaudeprojects@gmail.com", "support");
    assert(cfg.json.houseFeeAddress === "0x341BB8851Ff8fD9EAE20ea083c2F779e646B8488", "house wallet");
    assert(cfg.json.tipSplit.seatBps === 10000 && cfg.json.tipSplit.houseBps === 0, "tips 100% seat");
    assert(!cfg.json.betSplit, "no spectator bet split");
    assert(cfg.json.potSplit.creatorBps === 2000 && cfg.json.potSplit.seatBps === 8000, "20/80 pot");
    assert(cfg.json.minSeat === 3, "min seat 3");
    assert(cfg.json.ante === 1 && cfg.json.unit === "USDC", "USDC ante");
    assert(cfg.json.noSpectatorPool === true, "no spectator pool");
    assert(cfg.json.tableSize === 3, "3 agents per table");
    assert(Array.isArray(cfg.json.influences) && cfg.json.influences.length === 4, "four influences");
    assert(cfg.json.entitlesWinnings === false, "config: never entitled");
    const legal = await get(base + "/legal");
    assert(legal.status === 200 && /myclaudeprojects@gmail.com/.test(legal.body), "legal page");
    assert(/cannot stake into a win pool/i.test(legal.body), "legal: no win pool");
    assert(/min(?:imum)? 3 USDC/i.test(legal.body), "legal: min seat");
    assert(/20%/.test(legal.body) && /80%/.test(legal.body), "legal: pot split");
    assert(/21\+/.test(legal.body), "21+");
    forbiddenCopy(legal.body, "legal");
    const terms = await get(base + "/terms");
    assert(terms.status === 200 && /not gambling/i.test(terms.body), "terms");
    assert(/never entitled to winnings/i.test(terms.body), "terms: never entitled");
    assert(/seat/i.test(terms.body), "terms: seat");
    forbiddenCopy(terms.body, "terms");
    const privacy = await get(base + "/privacy");
    assert(privacy.status === 200 && /myclaudeprojects@gmail.com/.test(privacy.body), "privacy");
    forbiddenCopy(privacy.body, "privacy");
    const home = await get(base + "/");
    assert(home.status === 200, "home");
    assert(!/Buy \$LIAR/.test(home.body), "no $LIAR buy on homepage");
    assert(/Every agent has a token/.test(home.body), "per-agent token story");
    assert(/cannot stake into a win pool/i.test(home.body), "homepage documents no win pool");
    forbiddenCopy(home.body, "home");
    const how = await get(base + "/how-it-works");
    assert(/Creator 30%/.test(how.body) && /100%/.test(how.body) && /seat/i.test(how.body), "how-it-works locks");
    assert(/cannot stake into a win pool/i.test(how.body), "how: no win pool");
    assert(/20%/.test(how.body) && /80%/.test(how.body), "how: pot split");
    assert(!/pari-mutuel/i.test(how.body), "how: no bet math");
    assert(/never entitled to winnings/i.test(how.body), "how: never entitled");
    forbiddenCopy(how.body, "how");
    const arena = await get(base + "/arena?table=t-1");
    forbiddenCopy(arena.body, "arena");
    assert(/never entitled to winnings/i.test(arena.body), "arena never entitled");
    assert(!/Place bet/i.test(arena.body), "arena no place-bet");
    const agents = await get(base + "/api/agents");
    assert(agents.json.economics.arenaSeatBankroll === 0.25, "token tax 25% seat bankroll");
    assert(agents.json.economics.platformPrizeTreasury == null, "no prize treasury tax");
    assert(agents.json.noSpectatorPool === true, "agents list flags");
    assert((agents.json.agents || []).some((a) => a.personaTag), "persona tags on roster");

    const created = await post(base + "/api/agents", {
      name: "Tip Me", type: "heuristic", owner: "alice",
      ownerAddress: "0x" + "22".repeat(20),
    });
    assert(created.status === 201 && created.json.ok && created.json.agent.id, "register");
    assert(created.json.fundingAddress, "seat funding address");
    assert(created.json.balance >= 3, "mock seat funded");
    const tipMissing = await post(base + "/api/agents/" + created.json.agent.id + "/tip", { from: "spec-1", amount: 1 });
    assert(tipMissing.status === 400 && /influence/i.test(tipMissing.json.error), "tip requires influence");
    const tip = await post(base + "/api/agents/" + created.json.agent.id + "/tip", { from: "spec-1", amount: 1, influence: "aggressive" });
    assert(tip.status === 200 && tip.json.ok && tip.json.gift, "tip ok");
    assert(tip.json.amount === 1 && tip.json.seatBps === 10000 && tip.json.houseBps === 0, "tip 100% seat");
    assert(tip.json.influence === "aggressive", "tip stores influence");
    assert(tip.json.entitlesWinnings === false, "tip never entitles winnings");
    assert(tip.json.toSeat === true && tip.json.toPot === false, "tip to seat not pot");
    const after = await get(base + "/api/agents/" + created.json.agent.id);
    assert(after.json.holdings.seatBalance >= 100, "seat got the tip on top of mock fund");
    assert(after.json.influence && after.json.influence.dominant === "aggressive", "influence applied");
    assert(after.json.tip && after.json.tip.choices && after.json.tip.choices.length === 4, "tip meta has four choices");
    const lb2 = await get(base + "/api/leaderboard");
    assert(lb2.json.totals.tips >= 1 && lb2.json.totals.tipsUsdc >= 1, "tips on leaderboard");

    const tre = await post(base + "/api/agents/" + created.json.agent.id + "/bankroll", { amount: 7, source: "token_tax" }, { authorization: "Bearer test-bankroll" });
    assert(tre.status === 200 && tre.json.ok && tre.json.extra === true, "bankroll top-up");

    const goneBet = await post(base + "/api/bet", { agentId: "x", amount: 1 });
    assert(goneBet.status === 404, "/api/bet gone");
    const gonePool = await get(base + "/api/pool");
    assert(gonePool.status === 404, "/api/pool gone");
    const goneTableBet = await post(base + "/api/tables/t-1/bet", { amount: 1 });
    assert(goneTableBet.status === 404, "table bet gone");
    console.log("server smoke ok");
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 300));
    try { child.kill("SIGKILL"); } catch { /* already gone */ }
  }
})().catch((e) => { console.error(e); process.exit(1); });
