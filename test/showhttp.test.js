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
        if (home.status === 200 && /Who's got this|Watch & pick|Liar's Dice Arena/.test(home.body) && /data-tab="watch"/.test(home.body) && /id="sound"/.test(home.body)) {
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
    assert(snap.cashValue === 0 && snap.custody === false && snap.realMoney === false, "not a real-money book");
    assert(snap.partner && snap.partner.status === "not_contracted" && snap.partner.realMoney === false, "partner not contracted");
    assert(snap.upcoming && snap.upcoming.length === 4 && snap.upcoming[0].matchId !== snap.live.matchId, "upcoming slate");
    const booked = [...snap.live.seats.map((s) => s.id), ...snap.upcoming.flatMap((u) => u.seats.map((s) => s.id))];
    assert(new Set(booked).size === booked.length, "slate does not double-book");
    assert(snap.live.seats.length === 2, "two characters");
    assert(snap.brands && snap.brands.dracula && snap.brands.dracula.title === "The Gambler", "snapshot publishes the cast brands");
    assert(snap.live.seats.every((s) => s.brand && s.brand.title && s.brand.emblemUrl && s.brand.brandVersion === "v1"), "live seats carry brand v1");
    assert(!snap.live.seed && snap.live.rngCommitment && snap.live.rngCommitment.indexOf("sha256:") === 0, "commitment is public before the match");
    assert(snap.live.configurationHash && snap.live.integrityStatus === "PENDING", "config is frozen before the match");
    const health = await req("GET", base + "/health");
    assert(health.json && health.json.ok && health.json.mode === "show", "health");
    const me = await req("POST", base + "/api/show/predictors", { id: "httpfan01" });
    assert(me.status === 200 && me.json.predictor.credits === 1000, "test credits");
    const seat = snap.live.seats[0];
    assert(snap.live.market && snap.live.market.props && snap.live.market.props.length >= 4, "live book lists props");
    const duration = snap.live.market.props.find((p) => p.type === "duration_under");
    assert(duration && duration.yesPrice > 0 && duration.noPrice > 0, "duration price is public");
    const buy = await req("POST", base + "/api/show/markets/" + snap.live.matchId + "/buy", {
      predictorId: "httpfan01", agentId: seat.id, side: "yes", stake: 50,
    });
    assert(buy.status === 200 && buy.json.position.stake === 50, "bought yes");
    const propBuy = await req("POST", base + "/api/show/markets/" + snap.live.matchId + "/props/" + encodeURIComponent(duration.id) + "/buy", {
      predictorId: "httpfan01", side: "yes", stake: 25,
    });
    assert(propBuy.status === 200 && propBuy.json.position.stake === 25, "bought a prop over HTTP");
    assert(propBuy.json.credits === 925, "winner stake and prop stake both leave the balance");
    const lockedOut = await req("POST", base + "/api/show/test/play");
    assert(lockedOut.status === 200 && lockedOut.json.match.oracle.resultHash, "played and hashed");
    assert(lockedOut.json.match.oracle.realMoney === false, "oracle is not a cashier");
    assert(lockedOut.json.match.winnerId, "winner");
    const after = await req("GET", base + "/api/show/predictors/httpfan01");
    assert(after.json.predictor.picks === 2, "winner and prop both recorded");
    const viewed = await req("GET", base + "/api/show?predictor=httpfan01");
    const settledBook = viewed.json.live.market;
    const settledProp = settledBook.props.find((p) => p.id === duration.id);
    assert(settledBook.props.every((p) => p.status === "settled"), "props settle with the match");
    assert(settledProp.result === "yes" && settledProp.you && settledProp.you.won, "duration prop resolves from the match");
    assert(settledBook.you && settledBook.you.settled, "winner position is settled");
    const expected = Math.round((925 + (settledBook.you.payout || 0) + settledProp.you.payout) * 10000) / 10000;
    assert(Math.abs(after.json.predictor.credits - expected) < 0.02, "winner and prop payouts both hit the ledger");
    const replay = await req("GET", base + "/api/show/matches/" + snap.live.matchId + "/replay");
    assert(replay.json.events.length > 0 && replay.json.oracle.resultHash === lockedOut.json.match.oracle.resultHash, "replay is the same result");
    assert(replay.json.share && replay.json.share.text, "replay carries the share card");
    assert(replay.json.share.href === "#replay=" + encodeURIComponent(snap.live.matchId), "share href is the replay hash");
    assert(replay.json.matchId === snap.live.matchId, "replay names the match");
    assert(replay.json.brands && replay.json.seats.every((s) => replay.json.brands[s.id] && replay.json.brands[s.id].title), "replay keeps the brand from the match");
    const cast = await req("GET", base + "/api/show/agents");
    assert(cast.json.agents.length === 12 && cast.json.agents.every((a) => a.brand && a.brand.emblem && a.brand.title), "agents list carries brands");
    const dracula = await req("GET", base + "/api/show/agents/dracula/brand");
    assert(dracula.status === 200 && dracula.json.brand.agentId === "dracula" && dracula.json.brand.visualIdentity.emblem === "BAT_CROWN", "brand document");
    const draft = await req("POST", base + "/api/show/agents/brand/create", {});
    assert(draft.status === 400 && draft.json.ok === false, "create requires a name and description");
    const created = await req("POST", base + "/api/show/agents/brand/create", {
      name: "Vesper",
      shortDescription: "A quiet closer who spends one lie and waits.",
      archetype: "ASSASSIN",
      aggression: 0.42,
      bluffing: 0.66,
      discipline: 0.8,
      chaos: 0.2,
    });
    assert(created.status === 200 && created.json.agent && created.json.identity && created.json.identity.title, "create returns a first-pass identity");
    assert(created.json.identity.visualIdentity && created.json.identity.visualIdentity.primaryColor, "create returns visual DNA");
    const concepts = await req("POST", base + "/api/show/agents/" + created.json.agent.id + "/brand/concepts", { count: 4 });
    assert(concepts.status === 200 && concepts.json.concepts.length >= 3 && concepts.json.concepts.length <= 5, "concepts are 3 to 5");
    assert(concepts.json.concepts.every((c) => c.emblemSvg && c.pfp && c.pfp.prompt && c.pfpSvg && c.pfpSvg.includes('data-engine="local"') && c.title && c.tagline && c.visualIdentity), "concept cards carry a local portrait, title, and palette");
    const portraits = await req("POST", base + "/api/show/agents/" + created.json.agent.id + "/brand/pfp-concepts", { count: 4, vary: "all" });
    assert(portraits.status === 200 && portraits.json.concepts.length >= 3 && portraits.json.concepts.length <= 5, "pfp concepts are 3 to 5");
    const locked = await req("POST", base + "/api/show/agents/" + created.json.agent.id + "/brand/pfp-select", {
      conceptId: portraits.json.concepts[0].id,
    });
    assert(locked.status === 200 && locked.json.brand.brandVersion === "v1" && locked.json.brand.generation.status === "READY", "select locks brand v1");
    assert(locked.json.brand.primaryPfpAssetId && locked.json.brand.assets.pfpPortrait && locked.json.brand.pfpStyleVersion === "v1", "canonical pfp slot is stored");
    const castAfter = await req("GET", base + "/api/show/agents");
    const made = castAfter.json.agents.find((a) => a.id === created.json.agent.id);
    assert(made && made.roster === "user" && made.brand && made.brand.title && made.playable, "agents list exposes the new competitor");
    assert(castAfter.json.agents.filter((a) => a.roster !== "user").length === 12, "house cast stays 12");
    const emblem = await req("GET", base + "/api/show/agents/" + created.json.agent.id + "/emblem.svg");
    assert(emblem.status === 200 && emblem.body.includes("<svg"), "emblem is an svg, not an image model");
    const assets = await req("POST", base + "/api/show/agents/" + created.json.agent.id + "/brand/assets", {});
    assert(assets.status === 200 && assets.json.assetType === "PFP_PORTRAIT" && assets.json.assets.avatar48.includes("size=48") && assets.json.assets.avatar96.includes("size=96"), "assets derives avatar sizes");
    assert(assets.json.assets.heroPortrait == null && assets.json.deferred.includes("HERO_ART"), "hero cards stay deferred");
    const face = await req("GET", base + "/api/show/agents/" + created.json.agent.id + "/pfp.svg?size=96");
    const faceSmall = await req("GET", base + "/api/show/agents/" + created.json.agent.id + "/pfp.svg?size=48");
    assert(face.status === 200 && face.body.includes("neon-competitive") && face.body.includes('data-engine="local"'), "pfp route draws a local portrait");
    assert(faceSmall.status === 200 && faceSmall.body.includes("<svg"), "small size is the same local portrait");
    assert(!face.body.includes("neon-noir"), "served portrait is not neon noir");
    const houseFace = await req("GET", base + "/api/show/agents/dracula/pfp.svg?size=48");
    assert(houseFace.status === 200 && houseFace.body.includes("neon-competitive") && houseFace.body.includes("#F43B5F"), "house cast portrait needs no key");
    const unknownFace = await req("GET", base + "/api/show/agents/nobody/pfp.svg?size=48");
    assert(unknownFace.status === 404 && unknownFace.json && unknownFace.json.code === "unknown_agent", "unknown agent stays a letter");
    const brandDoc = await req("GET", base + "/api/show/agents/" + created.json.agent.id + "/brand");
    assert(brandDoc.json.brand.primaryPfpAssetId && brandDoc.json.brand.assets.canonicalPfp.includes("pfp.svg"), "brand document publishes the portrait");
    const appJs = await req("GET", base + "/static/app.js");
    assert(appJs.status === 200 && appJs.body.includes("Create agent") && appJs.body.includes("/api/show/agents/brand/create"), "agents UI exposes create");
    assert(!/usdc|wallet|\$/i.test(replay.json.share.text), "share text is not a cash pitch");
    const linked = await req("GET", base + "/?match=" + encodeURIComponent(snap.live.matchId));
    assert(linked.status === 200 && /static\/app\.js/.test(linked.body) && /data-tab="history"/.test(linked.body), "match query serves the show app");
    const verified = await req("GET", base + "/api/verify-match/" + snap.live.matchId);
    assert(verified.status === 200 && verified.json.integrityStatus === "VALID" && verified.json.signature, "verify endpoint");
    assert(verified.json.realMoney === false && verified.json.cashValue === 0, "verify payload is play money");
    assert(verified.json.rngSeedReveal && verified.json.rngSeedReveal.indexOf("hex:") === 0, "seed revealed after the match");
    assert(verified.json.rngCommitment === snap.live.rngCommitment, "commitment is unchanged");
    assert(!verified.json.sealedSeed && verified.body.indexOf("BEGIN PRIVATE") < 0, "verify response has no secrets");
    const replayed = await req("POST", base + "/api/verify-match/" + snap.live.matchId);
    assert(replayed.status === 200 && replayed.json.replay && replayed.json.replay.diceVerified && replayed.json.replay.signatureVerified, "verify replay");
    const viaShow = await req("GET", base + "/api/show/matches/" + snap.live.matchId + "/verification");
    assert(viaShow.status === 200 && viaShow.json.resultHash === verified.json.resultHash, "show verification route");
    const missing = await req("GET", base + "/api/show/matches/no-such-match/replay");
    assert(missing.status === 404, "unknown replay is a miss");
    console.log("show http ok");
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 200));
    try { child.kill("SIGKILL"); } catch { /* gone */ }
  }
})().catch((e) => { console.error(e); process.exit(1); });
