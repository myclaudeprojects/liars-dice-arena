// Boots the Phase 1 server and walks pick → play → settle.
const { spawn } = require("child_process");
const http = require("http");
const os = require("os");
const path = require("path");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }

function req(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
      headers: data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {},
      timeout: 8000,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch { /* html */ }
        resolve({ status: res.statusCode, body: text, json });
      });
    });
    r.on("error", reject);
    r.on("timeout", () => { r.destroy(); reject(new Error("timeout " + url)); });
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  const port = 21000 + (process.pid % 1000);
  const child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: {
      ...process.env,
      MOCK: "1",
      PORT: String(port),
      HOST: "127.0.0.1",
      SHOW_LOOP: "0",
      SHOW_TEST_HOOK: "1",
      SHOW_BOOTSTRAP: "1",
      SHOW_DATA_PATH: path.join(os.tmpdir(), `lda-show-http-${process.pid}.json`),
      PICK_WINDOW_MS: "60000",
      TURN_DELAY_MS: "0",
      REVEAL_DELAY_MS: "0",
      HOUSE_PRIVATE_KEY: "",
      CIRCLE_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { out += d; });
  const base = `http://127.0.0.1:${port}`;
  const t0 = Date.now();
  let snap = null;
  try {
    while (Date.now() - t0 < 15000) {
      if (!/phase 1 show/.test(out) && Date.now() - t0 < 8000) {
        await new Promise((r) => setTimeout(r, 40));
        continue;
      }
      try {
        const home = await req("GET", base + "/");
        if (home.status === 200 && /Who's got this|Watch & pick|Liar's Dice Arena/.test(home.body) && /data-tab="watch"/.test(home.body)) {
          const s = await req("GET", base + "/api/show");
          if (s.json && s.json.live && s.json.live.phase === "pick") { snap = s.json; break; }
        }
      } catch { /* not up */ }
      await new Promise((r) => setTimeout(r, 80));
    }
    if (!snap) {
      child.kill("SIGKILL");
      throw new Error("show did not open a pick window: " + out.slice(-800));
    }
    assert(snap.cashValue === 0 && snap.custody === false, "not a real-money book");
    assert(snap.partner && snap.partner.status === "not_contracted" && snap.partner.realMoney === false, "partner not contracted");
    assert(snap.upcoming && snap.upcoming.length >= 1 && snap.upcoming[0].matchId !== snap.live.matchId, "upcoming slate");
    assert(snap.live.seats.length === 2, "two characters");
    const health = await req("GET", base + "/health");
    assert(health.json && health.json.ok && health.json.mode === "show", "health");
    const me = await req("POST", base + "/api/show/predictors", { id: "httpfan01" });
    assert(me.status === 200 && me.json.predictor.credits === 1000, "test credits");
    const seat = snap.live.seats[0];
    const buy = await req("POST", base + "/api/show/markets/" + snap.live.matchId + "/buy", {
      predictorId: "httpfan01", agentId: seat.id, side: "yes", stake: 50,
    });
    assert(buy.status === 200 && buy.json.position.stake === 50, "bought yes");
    const lockedOut = await req("POST", base + "/api/show/test/play");
    assert(lockedOut.status === 200 && lockedOut.json.match.oracle.resultHash, "played and hashed");
    assert(lockedOut.json.match.oracle.realMoney === false, "oracle is not a cashier");
    assert(lockedOut.json.match.winnerId, "winner");
    const after = await req("GET", base + "/api/show/predictors/httpfan01");
    assert(after.json.predictor.picks === 1, "pick recorded");
    const won = lockedOut.json.match.winnerId === seat.id;
    if (won) assert(after.json.predictor.credits > 950, "settled win pays the book");
    else assert(after.json.predictor.credits === 950, "settled loss keeps the stake");
    const replay = await req("GET", base + "/api/show/matches/" + snap.live.matchId + "/replay");
    assert(replay.json.events.length > 0 && replay.json.oracle.resultHash === lockedOut.json.match.oracle.resultHash, "replay is the same result");
    console.log("show http ok");
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 200));
    try { child.kill("SIGKILL"); } catch { /* gone */ }
  }
})().catch((e) => { console.error(e); process.exit(1); });
