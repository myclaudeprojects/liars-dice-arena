// Confirm a Portal #7 launch on more than one Arc RPC before saving it.
// Public Arc endpoints disagree often enough that one answer is not a confirmation.

const { ethers } = require("ethers");
const { decodeLaunchReceipt, fail, loadAbi, PORTAL7 } = require("./launch");

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

let receiptTimeoutMs = 8000;

function setReceiptTimeout(ms) {
  receiptTimeoutMs = ms == null ? 8000 : ms;
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout " + (label || "rpc"))), ms);
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

async function rpcSend(url, method, params, fetchImpl, timeoutMs) {
  const res = await withTimeout(fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }), timeoutMs, method);
  if (!res || !res.ok) throw new Error("rpc_http_" + ((res && res.status) || "down"));
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || "rpc_error");
  return json.result;
}

async function getReceipt(url, txHash, fetchImpl, timeoutMs) {
  const result = await rpcSend(url, "eth_getTransactionReceipt", [txHash], fetchImpl, timeoutMs);
  return result || null;
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
  const timeoutMs = body.timeoutMs == null ? receiptTimeoutMs : body.timeoutMs;
  const settled = await Promise.all(urls.map(async (url) => {
    try {
      return { url, receipt: await getReceipt(url, hash, fetchImpl, timeoutMs) };
    } catch (e) {
      return { url, error: (e && e.message) || String(e) };
    }
  }));
  const groups = new Map();
  let failedReceipts = 0;
  let missingReceipts = 0;
  for (const row of settled) {
    if (row.error) continue;
    if (!row.receipt) {
      missingReceipts += 1;
      continue;
    }
    let launch;
    try { launch = decodeLaunchReceipt(row.receipt, portal); }
    catch (e) {
      if (e && e.code === "tx_failed") failedReceipts += 1;
      continue;
    }
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
  if (failedReceipts > 0 && missingReceipts === 0) {
    throw fail("tx_failed", "The launch transaction reverted. This agent can still play.", 502);
  }
  const answered = settled.some((row) => row.receipt || row.error);
  const detail = settled.map((row) => hostOf(row.url) + ": " + (row.error || (row.receipt ? "unconfirmed" : "pending"))).join("; ");
  if (!answered || settled.every((row) => row.error)) {
    const err = fail("rpc_unavailable", "Arc RPCs did not return that receipt. Try again in a moment. This agent can still play.", 502);
    err.detail = detail;
    throw err;
  }
  const err = fail("unconfirmed", "That transaction is not confirmed as a Portal #7 launch on two Arc endpoints yet. This agent can still play.", 409);
  err.detail = detail;
  throw err;
}

// A launch that already landed must be attached again, not minted a second time.
// Portal #7 indexes TokenCreated by creator. One window is a few thousand blocks.
const LOG_WINDOW = 4000n;
const LOG_WINDOWS = 6;

async function findPriorLaunch(opts) {
  const body = opts || {};
  const creator = ethers.getAddress(body.creator);
  const name = String(body.name || "");
  const symbol = String(body.symbol || "");
  if (!name || !symbol) return null;
  const taken = body.taken || new Set();
  const urls = body.rpcUrls || rpcUrls(body.env);
  const fetchImpl = body.fetchImpl || global.fetch;
  const timeoutMs = body.timeoutMs == null ? receiptTimeoutMs : body.timeoutMs;
  const budgetMs = body.budgetMs == null ? 10000 : body.budgetMs;
  const portal = ethers.getAddress(body.portal || PORTAL7);
  const iface = new ethers.Interface(body.abi || loadAbi());
  const topic0 = iface.getEvent("TokenCreated").topicHash;
  const topicCreator = ethers.zeroPadValue(creator.toLowerCase(), 32);
  const deadline = Date.now() + budgetMs;
  for (const url of urls) {
    if (Date.now() >= deadline) return null;
    try {
      const head = await rpcSend(url, "eth_blockNumber", [], fetchImpl, Math.min(timeoutMs, deadline - Date.now()));
      if (typeof head !== "string" || !/^0x[0-9a-fA-F]+$/.test(head)) continue;
      let cursor = BigInt(head);
      for (let i = 0; i < LOG_WINDOWS && cursor > 0n; i++) {
        if (Date.now() >= deadline) return null;
        const from = cursor > LOG_WINDOW ? cursor - LOG_WINDOW : 0n;
        const logs = await rpcSend(url, "eth_getLogs", [{
          address: portal,
          fromBlock: ethers.toQuantity(from),
          toBlock: ethers.toQuantity(cursor),
          topics: [topic0, null, topicCreator],
        }], fetchImpl, Math.min(timeoutMs, Math.max(1, deadline - Date.now())));
        if (!Array.isArray(logs)) break;
        const matches = [];
        for (const log of logs) {
          let parsed;
          try { parsed = iface.parseLog(log); } catch { continue; }
          if (!parsed || parsed.name !== "TokenCreated") continue;
          if (String(parsed.args.name) !== name || String(parsed.args.symbol) !== symbol) continue;
          const txHash = String(log.transactionHash || "");
          if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) continue;
          if (taken.has(txHash.toLowerCase())) continue;
          matches.push({ txHash, block: BigInt(log.blockNumber || 0) });
        }
        if (matches.length) {
          matches.sort((a, b) => (a.block === b.block ? 0 : (a.block > b.block ? -1 : 1)));
          return { txHash: matches[0].txHash };
        }
        if (from === 0n) break;
        cursor = from - 1n;
      }
    } catch {
      continue;
    }
  }
  return null;
}

module.exports = {
  rpcUrls,
  verifyLaunchTx,
  findPriorLaunch,
  setReceiptTimeout,
  FALLBACK_RPCS,
};
