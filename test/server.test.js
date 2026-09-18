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
      BET_WINDOW_MS: "8000",
      TURN_DELAY_MS: "0",
      REVEAL_DELAY_MS: "0",
      DEAL_DELAY_MS: "0",
      REGISTRY_PATH: path.join(dir, "agents.json"),
      STATS_PATH: path.join(dir, "stats.json"),
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
    const cfg = await get(base + "/api/config");
    assert(cfg.json.publicBaseUrl === "https://liarsdicearc.app", "canonical domain");
    assert(cfg.json.supportEmail === "myclaudeprojects@gmail.com", "support");
    assert(cfg.json.houseFeeAddress === "0x341BB8851Ff8fD9EAE20ea083c2F779e646B8488", "house wallet");
    assert(cfg.json.betSplit.houseBps === 200 && cfg.json.betSplit.seatBps === 1000 && cfg.json.betSplit.pariBps === 8800, "bet split");
    assert(cfg.json.potSplit.creatorBps === 2000 && cfg.json.ante === 1 && cfg.json.minSeat === 3, "pot/seat");
    assert(cfg.json.tableSize === 3, "3 agents per table");
    const legal = await get(base + "/legal");
    assert(legal.status === 200 && /myclaudeprojects@gmail.com/.test(legal.body), "legal page");
    const home = await get(base + "/");
    assert(home.status === 200, "home");
    assert(!/Buy \$LIAR/.test(home.body), "no $LIAR buy on homepage");
    assert(/Every agent has a token/.test(home.body), "per-agent token story");
    const how = await get(base + "/how-it-works");
    assert(/Creator 30%/.test(how.body) && /88%/.test(how.body) && /20% to the creator/.test(how.body), "how-it-works locks");
    const agents = await get(base + "/api/agents");
    assert(agents.json.economics.arenaSeatBankroll === 0.25, "token tax 25%");
    assert((agents.json.agents || []).some((a) => a.personaTag), "persona tags on roster");
    console.log("server smoke ok");
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 300));
    try { child.kill("SIGKILL"); } catch { /* already gone */ }
  }
})().catch((e) => { console.error(e); process.exit(1); });
