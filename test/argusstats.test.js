// Profile market stats: pool FDV from an Arc eth_call, holders from Arcscan.
// The provider is a mock. Nothing here talks to Arc.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");
const ethers = require("ethers");
const { Show } = require("../src/showrunner");
const { handleShow } = require("../src/showhttp");
const launch = require("../src/argus/launch");
const {
  STATS_TTL_MS,
  PARTIAL_TTL_MS,
  portalIface,
  erc20Iface,
  stateViewIface,
  clearArgusStatsCache,
  marketCapQuoteRaw,
  formatMarketCapLabel,
  formatHolderLabel,
  readArgusStats,
} = require("../src/argus/stats");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }
function eq(a, b, m) { if (a !== b) throw new Error((m || "eq") + `: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }

const CREATOR = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x2222222222222222222222222222222222222222";
const HOOK = "0x3333333333333333333333333333333333333333";
const LOCKER = "0x4444444444444444444444444444444444444444";
const SPLITTER = "0x5555555555555555555555555555555555555555";
const STATE_VIEW = "0x6666666666666666666666666666666666666666";
const TX = "0x" + "ab".repeat(32);
const BLOCK = "0x" + "cd".repeat(32);
const POOL = "0x" + "12".repeat(32);
const Q96 = 1n << 96n;
const SUPPLY = 10_000_000_000n;

function boot(file) {
  return new Show({
    dataPath: file,
    sleep: async () => {},
    pickWindowMs: 0,
    turnDelayMs: 0,
    revealDelayMs: 0,
    settleHoldMs: 0,
    bootstrapCount: 0,
    loopEnabled: false,
    marketsEnabled: false,
  });
}

function iface() {
  return new ethers.Interface(launch.loadAbi());
}

function eventLog(name, args) {
  const encoded = iface().encodeEventLog(iface().getEvent(name), args);
  return { address: launch.PORTAL7, topics: encoded.topics, data: encoded.data };
}

function receipt() {
  return {
    status: "0x1",
    transactionHash: TX,
    blockHash: BLOCK,
    from: CREATOR,
    to: launch.PORTAL7,
    logs: [
      eventLog("TokenCreated", [TOKEN, CREATOR, "Vesper", "VESPER", POOL, "", "", "", ""]),
      eventLog("PartsDeployed", [TOKEN, LOCKER, HOOK, SPLITTER]),
    ],
  };
}

function mockReq(method) {
  const req = new EventEmitter();
  req.method = method;
  req.destroy = () => {};
  process.nextTick(() => req.emit("end"));
  return req;
}

function mockRes() {
  return {
    headersSent: false,
    statusCode: 0,
    body: "",
    json: null,
    writeHead(code) { this.statusCode = code; },
    end(payload) {
      this.body = payload;
      this.headersSent = true;
      this.json = JSON.parse(payload);
    },
  };
}

function selectors() {
  return {
    launches: portalIface.encodeFunctionData("launches", [TOKEN]).slice(0, 10),
    stateView: portalIface.encodeFunctionData("stateView").slice(0, 10),
    totalSupply: erc20Iface.encodeFunctionData("totalSupply").slice(0, 10),
    poolIdFor: portalIface.encodeFunctionData("poolIdFor", [TOKEN, HOOK, launch.QUOTE_ASSET]).slice(0, 10),
    getSlot0: stateViewIface.encodeFunctionData("getSlot0", [POOL]).slice(0, 10),
  };
}

function chainResults(overrides) {
  const body = overrides || {};
  const sel = selectors();
  const hook = body.hook == null ? HOOK : body.hook;
  const sqrt = body.sqrt == null ? Q96 * 2n : body.sqrt;
  return {
    [sel.launches]: portalIface.encodeFunctionResult("launches", [
      CREATOR, 405400, false, LOCKER, hook, SPLITTER, 500, 500, 1, 376400, launch.QUOTE_ASSET,
    ]),
    [sel.stateView]: portalIface.encodeFunctionResult("stateView", [STATE_VIEW]),
    [sel.totalSupply]: erc20Iface.encodeFunctionResult("totalSupply", [body.supply == null ? SUPPLY : body.supply]),
    [sel.poolIdFor]: portalIface.encodeFunctionResult("poolIdFor", [POOL]),
    [sel.getSlot0]: stateViewIface.encodeFunctionResult("getSlot0", [sqrt, 1, 0, 10000]),
  };
}

function mockFetch(opts) {
  const body = opts || {};
  const calls = [];
  const fn = async (url, opts) => {
    calls.push(String(url));
    if (String(url).includes("api.arc-scan.org")) {
      if (body.holders === "down") return { ok: false, status: 503, json: async () => ({}) };
      return { ok: true, json: async () => ({ holders: body.holders == null ? 5 : body.holders }) };
    }
    if (body.rpc === "down") return { ok: false, status: 503, json: async () => ({}) };
    const data = JSON.parse(opts.body).params[0].data;
    const result = (body.results || chainResults())[data.slice(0, 10)];
    if (!result) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result }) };
  };
  fn.calls = () => calls.slice();
  return fn;
}

(async () => {
  const Q192 = 1n << 192n;
  eq(marketCapQuoteRaw({ sqrtPriceX96: Q96, tokenIsToken0: true, totalSupply: 1_000_000n }), 1_000_000n, "price 1 token0");
  eq(marketCapQuoteRaw({ sqrtPriceX96: Q96, tokenIsToken0: false, totalSupply: 1_000_000n }), 1_000_000n, "price 1 token1");
  eq(marketCapQuoteRaw({ sqrtPriceX96: Q96 * 2n, tokenIsToken0: true, totalSupply: 1000n }), 4000n, "4x when token is token0");
  eq(marketCapQuoteRaw({ sqrtPriceX96: Q96 * 2n, tokenIsToken0: false, totalSupply: 1000n }), 250n, "1/4 when quote is token0");
  eq(marketCapQuoteRaw({ sqrtPriceX96: 0n, tokenIsToken0: false, totalSupply: 1000n }), null, "uninitialized pool");
  // Observed on Arc for the house LIAR token: token is token1, supply 1e9 × 1e18.
  const liarSqrt = 47540638634446891099328421985980697843n;
  const liarSupply = 1000000000000000000000000000n;
  const liarRaw = (liarSupply * Q192) / (liarSqrt * liarSqrt);
  eq(marketCapQuoteRaw({ sqrtPriceX96: liarSqrt, tokenIsToken0: false, totalSupply: liarSupply }), liarRaw, "liar fdv matches the raw formula");
  eq(liarRaw, 2777340610n, "liar fdv is the Arc quote observed for that sqrt");
  eq(formatMarketCapLabel(2_500_000_000n, 6), "$2,500.00", "opening-size market cap");
  eq(formatMarketCapLabel(2777340610n, 6), "$2,777.34", "liar label");
  eq(formatMarketCapLabel(27_440_000_000_000n, 6), "$27.44M", "million compact");
  eq(formatMarketCapLabel(0n, 6), "$0.00", "zero cap");
  eq(formatMarketCapLabel(1_000n, 6), "$0.001", "sub-dollar cap");
  eq(formatHolderLabel(5), "5", "small holder count");
  eq(formatHolderLabel(1234), "1,234", "grouped holder count");
  eq(formatHolderLabel(null), null, "missing holders");

  clearArgusStatsCache();
  const fetchImpl = mockFetch();
  const argus = {
    tokenAddress: TOKEN,
    portal: launch.PORTAL7,
    symbol: "VESPER",
    argusUrl: "https://argus.world/token/" + ethers.getAddress(TOKEN),
  };
  const first = await readArgusStats(argus, { fetchImpl, rpcUrls: ["https://rpc.test/1"], now: 1_000 });
  eq(first.cached, false, "first read hits the chain");
  eq(first.symbol, "VESPER", "ticker comes from the mint record");
  eq(first.marketCap.label, "$2,500.00", "fdv label");
  eq(first.marketCap.usdc, "2500", "fdv usdc");
  eq(first.holders.count, 5, "holder count");
  eq(first.holders.label, "5", "holder label");
  eq(fetchImpl.calls().length, 6, "five eth_calls plus arcscan");
  const again = await readArgusStats(argus, { fetchImpl, rpcUrls: ["https://rpc.test/1"], now: 1_000 + STATS_TTL_MS - 1 });
  eq(again.cached, true, "a fresh quote is not fetched again");
  eq(fetchImpl.calls().length, 6, "cache skips arc");
  const later = await readArgusStats(argus, { fetchImpl, rpcUrls: ["https://rpc.test/1"], now: 1_000 + STATS_TTL_MS });
  eq(later.cached, false, "the fresh window expires");
  eq(fetchImpl.calls().length, 12, "expiry reads arc again");

  clearArgusStatsCache();
  const partialFetch = mockFetch({ rpc: "down" });
  const partial = await readArgusStats(argus, { fetchImpl: partialFetch, rpcUrls: ["https://rpc.test/1", "https://rpc.test/2"], now: 5_000 });
  eq(partial.marketCap, null, "rpc failure omits market cap");
  eq(partial.holders.count, 5, "holders still return");
  eq(partial.cached, false, "partial is stored");
  const partialHit = await readArgusStats(argus, { fetchImpl: partialFetch, rpcUrls: ["https://rpc.test/1"], now: 5_000 + PARTIAL_TTL_MS - 1 });
  eq(partialHit.cached, true, "a partial answer is reused briefly");
  eq(partialHit.marketCap, null, "cached partial does not invent a cap");

  clearArgusStatsCache();
  const quiet = mockFetch({ holders: "down", rpc: "down" });
  const none = await readArgusStats(argus, { fetchImpl: quiet, rpcUrls: ["https://rpc.test/1"], now: 9_000 });
  eq(none.marketCap, null, "both sources down omit cap");
  eq(none.holders, null, "both sources down omit holders");
  eq(none.argusUrl, argus.argusUrl, "the argus link still comes back");

  clearArgusStatsCache();
  const unlaunched = mockFetch({ results: chainResults({ hook: ethers.ZeroAddress }) });
  const noPool = await readArgusStats(argus, { fetchImpl: unlaunched, rpcUrls: ["https://rpc.test/1"], now: 11_000 });
  eq(noPool.marketCap, null, "a token with no portal launch has no invented cap");
  eq(noPool.holders.count, 5, "holders are independent of the pool");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lda-argus-stats-"));
  const show = boot(path.join(dir, "show.json"));
  show.ready = true;
  const created = show.createAgent({
    name: "Vesper",
    shortDescription: "A quiet closer who spends one lie and waits.",
    archetype: "ASSASSIN",
  });
  const id = created.agent.id;
  const plain = mockRes();
  const prevFetch = global.fetch;
  const httpFetch = mockFetch();
  global.fetch = httpFetch;
  clearArgusStatsCache();
  try {
    await handleShow(mockReq("GET"), plain, "/api/show/agents/" + id + "/argus/stats", new URLSearchParams(), show);
    eq(plain.statusCode, 200, "unminted stats are not an error");
    eq(plain.json.ok, true, "unminted ok");
    eq(plain.json.minted, false, "unminted flag");
    eq(plain.json.marketCap, null, "unminted has no market cap");
    eq(plain.json.holders, null, "unminted has no holders");
    eq(httpFetch.calls().length, 0, "unminted does not call arc");

    const house = mockRes();
    await handleShow(mockReq("GET"), house, "/api/show/agents/dracula/argus/stats", new URLSearchParams(), show);
    eq(house.statusCode, 200, "house agent stats");
    eq(house.json.minted, false, "house agent has no token");
    eq(httpFetch.calls().length, 0, "house agent does not call arc");

    show.attachArgusMint(id, launch.decodeLaunchReceipt(receipt()));
    const saved = mockRes();
    await handleShow(mockReq("GET"), saved, "/api/show/agents/" + id + "/argus/stats", new URLSearchParams(), show);
    eq(saved.statusCode, 200, "minted stats " + saved.body);
    eq(saved.json.minted, true, "minted flag");
    eq(saved.json.symbol, "VESPER", "http ticker");
    eq(saved.json.marketCap.label, "$2,500.00", "http market cap");
    eq(saved.json.holders.label, "5", "http holders");
    assert(saved.json.argusUrl.startsWith("https://argus.world/token/"), "http argus url");
    const cached = mockRes();
    await handleShow(mockReq("GET"), cached, "/api/show/agents/" + id + "/argus/stats", new URLSearchParams(), show);
    eq(cached.json.cached, true, "http reuses the server cache");
    eq(httpFetch.calls().length, 6, "second profile view does not hit arc again");

    clearArgusStatsCache();
    global.fetch = mockFetch({ rpc: "down" });
    const soft = mockRes();
    await handleShow(mockReq("GET"), soft, "/api/show/agents/" + id + "/argus/stats", new URLSearchParams(), show);
    eq(soft.statusCode, 200, "rpc failure still answers");
    eq(soft.json.minted, true, "rpc failure keeps the token");
    eq(soft.json.marketCap, null, "rpc failure has no cap");
    eq(soft.json.holders.count, 5, "rpc failure still has holders");
    assert(soft.json.argusUrl.includes(ethers.getAddress(TOKEN).toLowerCase()) || soft.json.argusUrl.includes(ethers.getAddress(TOKEN)), "link survives a failed quote");

    const missing = mockRes();
    await handleShow(mockReq("GET"), missing, "/api/show/agents/no-such-agent/argus/stats", new URLSearchParams(), show);
    eq(missing.statusCode, 404, "unknown agent");
    eq(missing.json.code, "unknown_agent", "unknown agent code");
  } finally {
    global.fetch = prevFetch;
    clearArgusStatsCache();
  }

  const app = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  const statsSrc = fs.readFileSync(path.join(__dirname, "..", "src", "argus", "stats.js"), "utf8");
  eq(app.match(/ARGUS_STATS_FRESH_MS = (\d+)/)[1], String(STATS_TTL_MS), "profile fresh window matches the server");
  eq(app.match(/ARGUS_STATS_RETRY_MS = (\d+)/)[1], String(PARTIAL_TTL_MS), "profile retry window matches the server");
  assert(app.includes("/argus/stats"), "profile asks the server for stats");
  assert(app.includes("Market cap"), "profile names market cap");
  assert(app.includes("Holders"), "profile names holders");
  assert(app.includes("Unavailable"), "missing stats fail soft in the page");
  assert(app.includes("Buy on Argus"), "argus link stays");
  assert(app.includes("Launch on Argus"), "unminted offer stays");
  assert(app.includes("data-argus-stats"), "minted block is marked");
  assert(statsSrc.includes("api.arc-scan.org/v1/tokens/"), "holders use arcscan");
  assert(statsSrc.includes("getSlot0"), "market cap uses the pool spot");
  const mintedAt = app.indexOf("data-argus-stats");
  const launchAt = app.indexOf("Launch on Argus", mintedAt);
  assert(mintedAt > 0 && launchAt > mintedAt, "launch offer remains after the minted block");

  console.log("argus stats ok");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
