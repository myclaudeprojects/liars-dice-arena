// Live-ish market stats for a minted Portal #7 token.
//
// Market cap is the Uniswap v4 pool spot price times total supply, quoted in
// Arc USDC. That is the same definition Argus uses (price × supply from public
// chain data). The read goes through the Arc JSON-RPC list already used to
// confirm launches. One answering endpoint is enough; this is not the two-host
// mint check.
//
// Holder count is not an eth_call. Arcscan indexes every non-zero balance on
// Arc mainnet from block 0 and publishes it as `holders` on
// GET /v1/tokens/{address}. Arcscan does not publish market cap.
//
// A full answer is reused for STATS_TTL_MS. A partial or failed answer is
// reused for PARTIAL_TTL_MS so a dead endpoint is not retried on every profile
// paint. Callers still render the Argus link when a figure is missing.

const ethers = require("ethers");
const { activePortal, PORTAL7, QUOTE_ASSET } = require("./launch");
const { rpcUrls } = require("./verify");
const { isPortal8, STATE_VIEW, poolIdFor } = require("./portal8");

const STATS_TTL_MS = 60_000;
const PARTIAL_TTL_MS = 15_000;
const RPC_ATTEMPTS = 3;
const CALL_TIMEOUT_MS = 2500;
// Arc USDC's ERC-20 face (0x3600…0000) reports 6 decimals. The native balance is 18.
const QUOTE_DECIMALS = 6;
const HOLDERS_API = "https://api.arc-scan.org/v1/tokens/";
const USER_AGENT = "liars-dice-arena/argus-stats";

const Q192 = 1n << 192n;

const portalIface = new ethers.Interface([
  "function launches(address token) view returns (address creator, int24 tickStart, bool tokenIsToken0, address locker, address hook, address splitter, uint16 buyTaxBps, uint16 sellTaxBps, uint256 positionId, int24 tickBond, address quoteAsset)",
  "function poolIdFor(address token, address hook, address quote) pure returns (bytes32)",
  "function stateView() view returns (address)",
]);

const erc20Iface = new ethers.Interface([
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

const stateViewIface = new ethers.Interface([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
]);

const cache = new Map();
const inflight = new Map();

function clearArgusStatsCache() {
  cache.clear();
  inflight.clear();
}

function canonical(raw) {
  try { return ethers.getAddress(String(raw || "")); }
  catch { return null; }
}

function clock(opts) {
  return opts && Number.isFinite(opts.now) ? opts.now : Date.now();
}

function groupInt(n) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function compactRatio(whole, unit) {
  const scaled = (whole * 100n + unit / 2n) / unit;
  const int = scaled / 100n;
  const frac = scaled % 100n;
  if (frac === 0n) return int.toString();
  if (frac % 10n === 0n) return int.toString() + "." + (frac / 10n).toString();
  return int.toString() + "." + frac.toString().padStart(2, "0");
}

// sqrtPriceX96 prices token1/token0 in raw token units:
//   priceX192 = sqrtPriceX96^2 = (token1_raw / token0_raw) * 2^192
// Market cap is that spot times total supply, in quote raw units (FDV).
// Quote is token0 when tokenIsToken0 is false, which is the usual Portal #7
// case because Arc USDC (0x3600…0000) sorts below the launched token.
function marketCapQuoteRaw({ sqrtPriceX96, tokenIsToken0, totalSupply }) {
  let sqrt;
  let supply;
  try {
    sqrt = BigInt(sqrtPriceX96);
    supply = BigInt(totalSupply);
  } catch {
    return null;
  }
  if (sqrt <= 0n || supply < 0n) return null;
  const priceX192 = sqrt * sqrt;
  if (priceX192 <= 0n) return null;
  if (tokenIsToken0) return (supply * priceX192) / Q192;
  return (supply * Q192) / priceX192;
}

function formatUnitsTrim(raw, decimals) {
  const scale = 10n ** BigInt(decimals);
  const whole = raw / scale;
  const frac = (raw % scale).toString().padStart(Number(decimals), "0").replace(/0+$/, "");
  if (!frac) return whole.toString();
  return whole.toString() + "." + frac;
}

function formatMarketCapLabel(raw, decimals) {
  let value;
  try { value = BigInt(raw); }
  catch { return null; }
  if (value < 0n) return null;
  const places = Number(decimals);
  if (!Number.isInteger(places) || places < 0 || places > 18) return null;
  const scale = 10n ** BigInt(places);
  let whole = value / scale;
  const frac = value % scale;
  if (whole >= 1_000_000_000n) return "$" + compactRatio(whole, 1_000_000_000n) + "B";
  if (whole >= 1_000_000n) return "$" + compactRatio(whole, 1_000_000n) + "M";
  if (whole >= 10_000n) return "$" + groupInt(whole);
  if (whole >= 1n || value === 0n) {
    let cents = (frac * 100n + scale / 2n) / scale;
    if (cents >= 100n) {
      whole += 1n;
      cents = 0n;
    }
    if (whole >= 10_000n) return "$" + groupInt(whole);
    return "$" + groupInt(whole) + "." + cents.toString().padStart(2, "0");
  }
  const digits = frac.toString().padStart(places, "0").replace(/0+$/, "");
  return "$0." + (digits.slice(0, 6) || "00");
}

function formatHolderLabel(count) {
  if (!Number.isInteger(count) || count < 0) return null;
  return groupInt(BigInt(count));
}

function portalOf(argus) {
  const stored = canonical(argus && argus.portal);
  if (stored) return stored;
  try { return canonical(activePortal()) || canonical(PORTAL7); }
  catch { return canonical(PORTAL7); }
}

async function ethCall(url, to, data, fetchImpl) {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": USER_AGENT },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error("rpc_http_" + res.status);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || "rpc_error");
  if (typeof json.result !== "string" || !/^0x[0-9a-fA-F]*$/.test(json.result) || json.result === "0x") {
    throw new Error("bad_call");
  }
  return json.result;
}

async function quoteDecimalsOf(url, quote, fetchImpl) {
  const addr = canonical(quote);
  if (!addr) return null;
  if (addr === canonical(QUOTE_ASSET)) return QUOTE_DECIMALS;
  const raw = await ethCall(url, addr, erc20Iface.encodeFunctionData("decimals"), fetchImpl);
  const places = Number(erc20Iface.decodeFunctionResult("decimals", raw)[0]);
  if (!Number.isInteger(places) || places < 0 || places > 18) return null;
  return places;
}

// Returns { raw, quoteDecimals } or { unavailable: true } when this host answered.
// Throws when the host itself failed so the caller can try the next RPC.
async function readMarketCapAt(url, token, portal, fetchImpl) {
  const [launchRes, viewRes, supplyRes] = await Promise.all([
    ethCall(url, portal, portalIface.encodeFunctionData("launches", [token]), fetchImpl),
    ethCall(url, portal, portalIface.encodeFunctionData("stateView"), fetchImpl),
    ethCall(url, token, erc20Iface.encodeFunctionData("totalSupply"), fetchImpl),
  ]);
  const launch = portalIface.decodeFunctionResult("launches", launchRes);
  const hook = canonical(launch.hook);
  const quote = canonical(launch.quoteAsset);
  const stateView = canonical(portalIface.decodeFunctionResult("stateView", viewRes)[0]);
  if (!hook || hook === ethers.ZeroAddress || !quote || !stateView || stateView === ethers.ZeroAddress) {
    return { unavailable: true };
  }
  const supply = erc20Iface.decodeFunctionResult("totalSupply", supplyRes)[0];
  const poolRes = await ethCall(
    url,
    portal,
    portalIface.encodeFunctionData("poolIdFor", [token, hook, quote]),
    fetchImpl,
  );
  const poolId = portalIface.decodeFunctionResult("poolIdFor", poolRes)[0];
  const slotRes = await ethCall(url, stateView, stateViewIface.encodeFunctionData("getSlot0", [poolId]), fetchImpl);
  const sqrtPriceX96 = stateViewIface.decodeFunctionResult("getSlot0", slotRes).sqrtPriceX96;
  const quoteDecimals = await quoteDecimalsOf(url, quote, fetchImpl);
  if (quoteDecimals == null) return { unavailable: true };
  const raw = marketCapQuoteRaw({
    sqrtPriceX96,
    tokenIsToken0: !!launch.tokenIsToken0,
    totalSupply: supply,
  });
  if (raw == null) return { unavailable: true };
  return { raw, quoteDecimals };
}

async function readPortal8MarketCapAt(url, token, argus, fetchImpl) {
  const supplyRes = await ethCall(url, token, erc20Iface.encodeFunctionData("totalSupply"), fetchImpl);
  const supply = erc20Iface.decodeFunctionResult("totalSupply", supplyRes)[0];
  const quote = canonical(QUOTE_ASSET);
  let poolId = argus && argus.poolId;
  let tokenIsToken0 = argus && argus.tokenIsToken0;
  if (!poolId && argus && argus.hook) {
    const computed = poolIdFor(token, quote, argus.hook);
    poolId = computed.poolId;
    tokenIsToken0 = computed.tokenIsToken0;
  }
  if (!poolId) return { unavailable: true };
  const slotRes = await ethCall(url, STATE_VIEW, stateViewIface.encodeFunctionData("getSlot0", [poolId]), fetchImpl);
  const sqrtPriceX96 = stateViewIface.decodeFunctionResult("getSlot0", slotRes).sqrtPriceX96;
  const raw = marketCapQuoteRaw({ sqrtPriceX96, tokenIsToken0: !!tokenIsToken0, totalSupply: supply });
  if (raw == null) return { unavailable: true };
  return { raw, quoteDecimals: QUOTE_DECIMALS };
}

async function readPortal8MarketCap(token, argus, opts) {
  const urls = (opts.rpcUrls || rpcUrls(opts.env)).slice(0, RPC_ATTEMPTS);
  const fetchImpl = opts.fetchImpl || global.fetch;
  for (const url of urls) {
    try {
      const row = await readPortal8MarketCapAt(url, token, argus, fetchImpl);
      if (!row || row.unavailable) return null;
      const label = formatMarketCapLabel(row.raw, row.quoteDecimals);
      if (!label) return null;
      return { usdc: formatUnitsTrim(row.raw, row.quoteDecimals), label };
    } catch {
      // The next public Arc host may still have the pool.
    }
  }
  return null;
}

async function readMarketCap(token, portal, opts) {
  const urls = (opts.rpcUrls || rpcUrls(opts.env)).slice(0, RPC_ATTEMPTS);
  const fetchImpl = opts.fetchImpl || global.fetch;
  for (const url of urls) {
    try {
      const row = await readMarketCapAt(url, token, portal, fetchImpl);
      if (!row || row.unavailable) return null;
      const label = formatMarketCapLabel(row.raw, row.quoteDecimals);
      if (!label) return null;
      return { usdc: formatUnitsTrim(row.raw, row.quoteDecimals), label };
    } catch {
      // The next public Arc host may still have the pool.
    }
  }
  return null;
}

function parseHolders(json) {
  const n = json && json.holders;
  if (typeof n === "number" && Number.isInteger(n) && n >= 0) return n;
  return null;
}

async function readHolders(token, opts) {
  const fetchImpl = opts.fetchImpl || global.fetch;
  const base = String(opts.holdersApi || HOLDERS_API);
  const url = base.replace(/\/?$/, "/") + token;
  try {
    const res = await fetchImpl(url, {
      headers: { accept: "application/json", "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const count = parseHolders(await res.json());
    if (count == null) return null;
    return { count, label: formatHolderLabel(count) };
  } catch {
    return null;
  }
}

function payloadFor(argus, token, marketCap, holders, at) {
  return {
    symbol: (argus && argus.symbol) || null,
    tokenAddress: token,
    argusUrl: (argus && argus.argusUrl) || ("https://argus.world/token/" + token),
    marketCap,
    holders,
    asOf: at,
  };
}

async function loadFresh(argus, token, opts) {
  const at = clock(opts);
  const portal = portalOf(argus);
  if (!portal) return payloadFor(argus, token, null, null, at);
  const [marketCap, holders] = await Promise.all([
    isPortal8(portal) ? readPortal8MarketCap(token, argus, opts) : readMarketCap(token, portal, opts),
    readHolders(token, opts),
  ]);
  return payloadFor(argus, token, marketCap, holders, at);
}

async function readArgusStats(argus, opts) {
  const body = opts || {};
  const token = canonical(argus && argus.tokenAddress);
  const at = clock(body);
  if (!token) {
    return {
      symbol: null,
      tokenAddress: null,
      argusUrl: null,
      marketCap: null,
      holders: null,
      asOf: at,
      cached: false,
    };
  }
  const key = token.toLowerCase();
  const useCache = body.cache !== false;
  if (useCache) {
    const hit = cache.get(key);
    if (hit && at - hit.at < hit.ttl) return { ...hit.payload, cached: true };
    const pending = inflight.get(key);
    if (pending) return pending;
  }
  const job = loadFresh(argus, token, body).then((payload) => {
    const ttl = payload.marketCap && payload.holders ? STATS_TTL_MS : PARTIAL_TTL_MS;
    if (useCache) cache.set(key, { at: clock(body), payload, ttl });
    return { ...payload, cached: false };
  }).finally(() => {
    if (inflight.get(key) === job) inflight.delete(key);
  });
  if (useCache) inflight.set(key, job);
  return job;
}

module.exports = {
  STATS_TTL_MS,
  PARTIAL_TTL_MS,
  HOLDERS_API,
  QUOTE_DECIMALS,
  portalIface,
  erc20Iface,
  stateViewIface,
  clearArgusStatsCache,
  marketCapQuoteRaw,
  formatMarketCapLabel,
  formatHolderLabel,
  readArgusStats,
};
