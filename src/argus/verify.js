// Confirm a Portal #7 launch on more than one Arc RPC before saving it.
// Public Arc endpoints disagree often enough that one answer is not a confirmation.

const { decodeLaunchReceipt, fail } = require("./launch");

const FALLBACK_RPCS = Object.freeze([
  "https://rpc.mainnet.arc.io",
  "https://rpc.drpc.mainnet.arc.io",
  "https://rpc.quicknode.mainnet.arc.io",
  "https://rpc.blockdaemon.mainnet.arc.io",
]);

function rpcUrls(env) {
  const source = env || process.env;
  const listed = String(source.ARC_RPC_URLS || "").split(",").map((row) => row.trim()).filter(Boolean);
  const primary = source.ARC_RPC_URL ? [String(source.ARC_RPC_URL).trim()] : [];
  const seen = new Set();
  const out = [];
  for (const url of [...listed, ...primary, ...FALLBACK_RPCS]) {
    const key = url.replace(/\/$/, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function hostOf(url) {
  try { return new URL(url).host.toLowerCase(); }
  catch { return String(url || "").toLowerCase(); }
}

async function getReceipt(url, txHash, fetchImpl) {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getTransactionReceipt",
      params: [txHash],
    }),
  });
  if (!res.ok) throw new Error("rpc_http_" + res.status);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || "rpc_error");
  return json.result || null;
}

function agreementKey(launch) {
  return [
    launch.txHash,
    launch.blockHash,
    launch.tokenAddress,
    launch.poolId,
    launch.hook,
    launch.locker,
    launch.splitter,
    launch.creatorWallet,
  ].join("|").toLowerCase();
}

async function verifyLaunchTx(txHash, opts) {
  const body = opts || {};
  const hash = String(txHash || "").trim();
  if (!/^0x[0-9a-fA-F]{64}$/i.test(hash)) {
    throw fail("bad_tx", "That is not a transaction hash.", 400);
  }
  const urls = body.rpcUrls || rpcUrls(body.env);
  if (urls.length < 2) {
    throw fail("rpc_config", "Arc confirmation needs at least two RPC endpoints.", 500);
  }
  const fetchImpl = body.fetchImpl || global.fetch;
  const portal = body.portal;
  const settled = await Promise.all(urls.map(async (url) => {
    try {
      return { url, receipt: await getReceipt(url, hash, fetchImpl) };
    } catch (e) {
      return { url, error: (e && e.message) || String(e) };
    }
  }));
  const groups = new Map();
  for (const row of settled) {
    if (!row.receipt) continue;
    let launch;
    try { launch = decodeLaunchReceipt(row.receipt, portal); }
    catch { continue; }
    if (!launch.blockHash || launch.txHash.toLowerCase() !== hash.toLowerCase()) continue;
    const key = agreementKey(launch);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ url: row.url, launch });
  }
  let best = null;
  for (const rows of groups.values()) {
    const hosts = new Set(rows.map((row) => hostOf(row.url)));
    if (hosts.size >= 2 && (!best || hosts.size > best.hosts)) best = { hosts: hosts.size, launch: rows[0].launch };
  }
  if (best) return best.launch;
  const answered = settled.some((row) => row.receipt || row.error);
  if (!answered || settled.every((row) => row.error)) {
    throw fail("rpc_unavailable", "Arc RPCs did not return that receipt. Try again in a moment.", 502);
  }
  throw fail("unconfirmed", "That transaction is not confirmed as a Portal #7 launch on two Arc endpoints yet.", 409);
}

module.exports = { rpcUrls, verifyLaunchTx, FALLBACK_RPCS };
