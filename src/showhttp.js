// showhttp.js — JSON + SSE for the Phase 1 spectator app.
// Test credits only. No wallet routes.

const { ERROR_TEXT, DEFAULT_STAKE, THEORY_TAGS } = require("./simmarket");

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-cache",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on("data", (c) => {
      n += c.length;
      if (n > 20000) { reject(new Error("body_too_large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch { reject(new Error("bad_json")); }
    });
    req.on("error", reject);
  });
}

function fail(res, e) {
  const code = e.code || e.message || "error";
  let status = code === "no_market" || code === "unknown_predictor" || code === "unknown_agent" || code === "unknown_concept" ? 404 : 400;
  if (Number.isInteger(e.status) && e.status >= 400 && e.status < 600) status = e.status;
  send(res, status, { ok: false, error: e.publicMessage || ERROR_TEXT[code] || code, code });
}

async function handleShow(req, res, url, query, show) {
  if (url !== "/api/show" && !url.startsWith("/api/show/")) return false;
  const path = url.slice("/api/show".length) || "/";
  const predictor = query && query.get ? (query.get("predictor") || "") : "";
  try {
    if (!show.ready && path !== "/events") {
      send(res, 200, { ok: true, starting: true, phase: show.phase });
      return true;
    }
    if (req.method === "GET" && path === "/") {
      send(res, 200, { ok: true, ...show.snapshot(predictor) });
      return true;
    }
    if (req.method === "GET" && path === "/events") {
      show.subscribe(req, res);
      return true;
    }
    if (req.method === "GET" && path === "/agents") {
      send(res, 200, { ok: true, agents: show.agentList() });
      return true;
    }
    const brandGet = path.match(/^\/agents\/([^/]+)\/brand$/);
    if (req.method === "GET" && brandGet) {
      send(res, 200, { ok: true, brand: show.brandView(decodeURIComponent(brandGet[1])) });
      return true;
    }
    const emblemGet = path.match(/^\/agents\/([^/]+)\/emblem\.svg$/);
    if (req.method === "GET" && emblemGet) {
      const svg = show.emblemSvgFor(decodeURIComponent(emblemGet[1]));
      if (!svg) { send(res, 404, { ok: false, error: "No emblem for that agent.", code: "unknown_agent" }); return true; }
      res.writeHead(200, {
        "content-type": "image/svg+xml; charset=utf-8",
        "cache-control": "no-cache",
      });
      res.end(svg);
      return true;
    }
    if (req.method === "GET" && path === "/agents/brand/options") {
      send(res, 200, { ok: true, ...show.creatorOptions() });
      return true;
    }
    if (req.method === "POST" && path === "/agents/brand/create") {
      const body = await readBody(req);
      send(res, 200, { ok: true, ...show.createAgent(body) });
      return true;
    }
    const concepts = path.match(/^\/agents\/([^/]+)\/brand\/concepts$/);
    if (req.method === "POST" && concepts) {
      const body = await readBody(req);
      send(res, 200, { ok: true, ...show.generateConcepts(decodeURIComponent(concepts[1]), body) });
      return true;
    }
    const select = path.match(/^\/agents\/([^/]+)\/brand\/select$/);
    if (req.method === "POST" && select) {
      const body = await readBody(req);
      send(res, 200, { ok: true, ...show.selectConcept(decodeURIComponent(select[1]), body.conceptId) });
      return true;
    }
    if (req.method === "POST" && /^\/agents\/([^/]+)\/brand\/(assets|rebrand)$/.test(path)) {
      send(res, 501, { ok: false, error: "not_implemented", status: "DRAFT" });
      return true;
    }
    if (req.method === "GET" && path.startsWith("/agents/")) {
      const id = decodeURIComponent(path.slice("/agents/".length));
      send(res, 200, { ok: true, agent: show.agentDetail(id) });
      return true;
    }
    if (req.method === "GET" && path === "/history") {
      send(res, 200, { ok: true, matches: show.historyList() });
      return true;
    }
    if (req.method === "GET" && path === "/leaderboard") {
      send(res, 200, { ok: true, leaders: show.market.leaderboard(), unit: "test-credits", cashValue: 0 });
      return true;
    }
    const verify = path.match(/^\/matches\/([^/]+)\/verification$/);
    if ((req.method === "GET" || req.method === "POST") && verify) {
      const view = show.verification(decodeURIComponent(verify[1]), { replay: req.method === "POST" });
      if (!view) { send(res, 404, { ok: false, error: "No such match." }); return true; }
      send(res, 200, { ok: true, ...view });
      return true;
    }
    const matchReplay = path.match(/^\/matches\/([^/]+)\/replay$/);
    if (req.method === "GET" && matchReplay) {
      const row = show.matchDetail(decodeURIComponent(matchReplay[1]));
      if (!row) { send(res, 404, { ok: false, error: "No such match." }); return true; }
      send(res, 200, {
        ok: true,
        matchId: row.matchId,
        oracle: row.oracle || null,
        events: row.engineLog || [],
        story: row.story || null,
        share: row.share || null,
        seats: row.seats || [],
        brands: show.brandsForSeats(row.seats),
      });
      return true;
    }
    const matchGet = path.match(/^\/matches\/([^/]+)$/);
    if (req.method === "GET" && matchGet) {
      const row = show.matchDetail(decodeURIComponent(matchGet[1]));
      if (!row) { send(res, 404, { ok: false, error: "No such match." }); return true; }
      send(res, 200, { ok: true, match: row.engineLog ? row : show.publicMatch(row, predictor) });
      return true;
    }
    if (req.method === "POST" && path === "/predictors") {
      const body = await readBody(req);
      const view = show.market.openPredictor(body.id);
      send(res, 200, { ok: true, predictor: view, defaultStake: DEFAULT_STAKE, cashValue: 0 });
      return true;
    }
    const predGet = path.match(/^\/predictors\/([^/]+)$/);
    if (req.method === "GET" && predGet) {
      const view = show.market.publicPredictor(show.market.requirePredictor(decodeURIComponent(predGet[1])));
      const liveId = show.current && show.current.matchId;
      send(res, 200, {
        ok: true,
        predictor: view,
        position: liveId ? show.market.positionFor(liveId, view.id) : null,
        matchId: liveId,
      });
      return true;
    }
    const theory = path.match(/^\/predictors\/([^/]+)\/theory$/);
    if (req.method === "POST" && theory) {
      const body = await readBody(req);
      const view = show.market.setTheory(decodeURIComponent(theory[1]), body.agentId, body.tags);
      send(res, 200, { ok: true, predictor: view, tags: THEORY_TAGS });
      return true;
    }
    const quote = path.match(/^\/markets\/([^/]+)\/quote$/);
    if (req.method === "POST" && quote) {
      const body = await readBody(req);
      const result = show.market.quote({
        matchId: decodeURIComponent(quote[1]),
        predictorId: body.predictorId,
        outcomeId: body.outcomeId,
        agentId: body.agentId,
        side: body.side || "BUY",
        shares: body.shares,
      });
      send(res, 200, { ok: true, ...result, cashValue: 0, realMoney: false });
      return true;
    }
    const trade = path.match(/^\/markets\/([^/]+)\/trade$/);
    if (req.method === "POST" && trade) {
      const body = await readBody(req);
      const result = show.market.executeQuote({
        matchId: decodeURIComponent(trade[1]),
        predictorId: body.predictorId,
        quoteId: body.quoteId,
        clientRequestId: body.clientRequestId,
      });
      send(res, 200, { ...result, cashValue: 0, realMoney: false });
      return true;
    }
    const sell = path.match(/^\/markets\/([^/]+)\/sell$/);
    if (req.method === "POST" && sell) {
      const body = await readBody(req);
      const result = show.market.sell({
        matchId: decodeURIComponent(sell[1]),
        predictorId: body.predictorId,
        agentId: body.agentId,
        outcomeId: body.outcomeId,
        side: body.side || "yes",
        shares: body.shares,
        clientRequestId: body.clientRequestId,
      });
      send(res, 200, { ...result, cashValue: 0, realMoney: false });
      return true;
    }
    const propBuy = path.match(/^\/markets\/([^/]+)\/props\/([^/]+)\/buy$/);
    if (req.method === "POST" && propBuy) {
      const body = await readBody(req);
      const result = show.market.buyProp({
        matchId: decodeURIComponent(propBuy[1]),
        propId: decodeURIComponent(propBuy[2]),
        predictorId: body.predictorId,
        side: body.side || "yes",
        stake: body.stake == null ? DEFAULT_STAKE : body.stake,
        expectedPrice: body.expectedPrice,
        clientRequestId: body.clientRequestId,
      });
      send(res, 200, { ...result, cashValue: 0, realMoney: false });
      return true;
    }
    const buy = path.match(/^\/markets\/([^/]+)\/buy$/);
    if (req.method === "POST" && buy) {
      const body = await readBody(req);
      const result = show.market.buy({
        matchId: decodeURIComponent(buy[1]),
        predictorId: body.predictorId,
        agentId: body.agentId,
        outcomeId: body.outcomeId,
        side: body.side || "yes",
        stake: body.shares == null && body.stake == null ? DEFAULT_STAKE : body.stake,
        shares: body.shares,
        expectedPrice: body.expectedPrice,
        clientRequestId: body.clientRequestId,
      });
      send(res, 200, { ...result, cashValue: 0, realMoney: false });
      return true;
    }
    if (show.testHook && req.method === "POST" && path === "/test/play") {
      const archived = await show.playOpen();
      send(res, 200, { ok: true, match: archived, snapshot: show.snapshot(predictor) });
      return true;
    }
    send(res, 404, { ok: false, error: "Unknown show route." });
  } catch (e) {
    if (!res.headersSent) fail(res, e);
  }
  return true;
}

function handleVerifyMatch(req, res, url, show) {
  const match = String(url || "").match(/^\/api\/verify-match\/([^/]+)\/?$/);
  if (!match) return false;
  if (req.method !== "GET" && req.method !== "POST") {
    send(res, 405, { ok: false, error: "Use GET to read the record or POST to replay it." });
    return true;
  }
  try {
    const view = show.verification(decodeURIComponent(match[1]), { replay: req.method === "POST" });
    if (!view) { send(res, 404, { ok: false, error: "No such match." }); return true; }
    send(res, 200, { ok: true, ...view });
  } catch (e) {
    if (!res.headersSent) fail(res, e);
  }
  return true;
}

module.exports = { handleShow, handleVerifyMatch };
