// Server-sponsored Portal #7 launch.
//
// Signs with ARGUS_MINT_KEY only. That address is msg.sender, so Portal #7
// records it as the creator and the creator share accrues there. This module
// never reads a house or seat wallet key, and it never returns the mint key.

const { ethers } = require("ethers");
const {
  prepareLaunch,
  encodeCall,
  encodeLaunch,
  mineHookSalt,
  activePortal,
  loadAbi,
  fail,
  CHAIN_ID,
} = require("./launch");
const { rpcUrls } = require("./verify");

const WINDOW_MS = 10 * 60 * 1000;
const SESSION_MAX = 5;
const GLOBAL_MAX = 40;
const MIN_INTERVAL_MS = 15 * 1000;
const FALLBACK_GAS = 12_000_000n;
const GAS_CAP = 30_000_000n;

let transportOverride = null;
let guard = createSponsorGuard();

function redact(text, secret) {
  const raw = String(secret || "").trim().replace(/^0x/i, "");
  if (raw.length < 32) return String(text || "");
  return String(text || "")
    .replace(new RegExp("0x" + raw, "ig"), "[redacted]")
    .replace(new RegExp(raw, "ig"), "[redacted]");
}

function redactAll(text, secrets) {
  return (secrets || []).reduce((out, secret) => redact(out, secret), String(text || ""));
}

function parseMintKey(raw) {
  const text = String(raw == null ? "" : raw).trim();
  if (!text) return null;
  const hex = /^0x/i.test(text) ? "0x" + text.slice(2) : "0x" + text;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) return null;
  try {
    const wallet = new ethers.Wallet(hex);
    return { privateKey: wallet.privateKey, address: wallet.address };
  } catch {
    return null;
  }
}

function scrubbed(err, secrets, code, fallback, status) {
  const detail = redactAll(String((err && (err.shortMessage || err.message)) || ""), secrets).slice(0, 180);
  console.warn("argus_sponsor", code, detail || "failed");
  return fail(code, fallback, status);
}

function createSponsorGuard(opts) {
  const body = opts || {};
  const windowMs = body.windowMs == null ? WINDOW_MS : body.windowMs;
  const max = body.max == null ? SESSION_MAX : body.max;
  const globalMax = body.globalMax == null ? GLOBAL_MAX : body.globalMax;
  const minIntervalMs = body.minIntervalMs == null ? MIN_INTERVAL_MS : body.minIntervalMs;
  const now = body.now || (() => Date.now());
  const buckets = new Map();
  const inflight = new Set();
  function rowsFor(key, t) {
    return (buckets.get(key) || []).filter((ts) => t - ts < windowMs);
  }
  return {
    take(keys) {
      const t = now();
      const list = keys && keys.length ? keys : ["anon"];
      for (const key of list) {
        const isGlobal = key === "global";
        const limit = isGlobal ? globalMax : max;
        const rows = rowsFor(key, t);
        const last = rows.length ? rows[rows.length - 1] : null;
        const tooSoon = !isGlobal && last != null && minIntervalMs > 0 && t - last < minIntervalMs;
        if (rows.length >= limit || tooSoon) {
          throw fail("rate_limited", "Server mint is temporarily limited for this session. This agent can still play.", 429);
        }
      }
      for (const key of list) {
        const rows = rowsFor(key, t);
        rows.push(t);
        buckets.set(key, rows);
      }
    },
    begin(agentId) {
      if (inflight.has(agentId)) return false;
      inflight.add(agentId);
      return true;
    },
    end(agentId) {
      inflight.delete(agentId);
    },
    reset() {
      buckets.clear();
      inflight.clear();
    },
  };
}

function resetSponsorGuard(opts) {
  guard = createSponsorGuard(opts);
  return guard;
}

function sponsorGuard() {
  return guard;
}

function setSponsorTransport(factory) {
  transportOverride = factory || null;
}

function clientIp(req) {
  const headers = (req && req.headers) || {};
  const fwd = headers["x-forwarded-for"] || headers["X-Forwarded-For"] || "";
  const first = String(fwd).split(",")[0].trim();
  if (first) return first.slice(0, 80);
  const sock = req && req.socket && req.socket.remoteAddress;
  return sock ? String(sock).slice(0, 80) : "";
}

function clientKeys(req, body) {
  const keys = [];
  const headers = (req && req.headers) || {};
  const predictor = String((body && body.predictor) || headers["x-lda-predictor"] || "").trim().toLowerCase();
  if (/^[a-z0-9]{8,40}$/.test(predictor)) keys.push("session:" + predictor);
  const ip = clientIp(req);
  if (ip) keys.push("ip:" + ip);
  keys.push("global");
  return keys;
}

function decodeWord(types, data) {
  if (!data || data === "0x") throw fail("eth_call", "Portal #7 did not answer that read.", 502);
  return ethers.AbiCoder.defaultAbiCoder().decode(types, data);
}

async function resolveTransport(env) {
  if (transportOverride) return transportOverride(env);
  return createArcTransport(env);
}

async function createArcTransport(env) {
  const urls = rpcUrls(env);
  for (const url of urls) {
    let host = "arc";
    try { host = new URL(url).host; } catch { host = "arc"; }
    let provider = null;
    try {
      const req = new ethers.FetchRequest(url);
      req.timeout = 12000;
      provider = new ethers.JsonRpcProvider(req, CHAIN_ID, { staticNetwork: true });
      const hex = await provider.send("eth_chainId", []);
      const chain = typeof hex === "bigint" ? Number(hex) : Number(hex);
      if (chain !== CHAIN_ID) {
        provider.destroy();
        provider = null;
        console.warn("argus_sponsor_rpc", host, "wrong_chain");
        continue;
      }
      const live = provider;
      provider = null;
      return {
        call: ({ to, data }) => live.call({ to, data }),
        nonce: (address) => live.getTransactionCount(address, "pending"),
        feeData: () => live.getFeeData(),
        estimateGas: (tx) => live.estimateGas(tx),
        chainId: async () => chain,
        broadcast: async (raw) => {
          const sent = await live.broadcastTransaction(raw);
          return sent.hash;
        },
        destroy: () => live.destroy(),
      };
    } catch (e) {
      if (provider) {
        try { provider.destroy(); } catch { /* already closed */ }
      }
      console.warn("argus_sponsor_rpc", host, redact(e && e.message, env && env.ARGUS_MINT_KEY).slice(0, 120));
    }
  }
  throw fail("rpc_unavailable", "Arc RPCs did not accept the server mint. This agent can still play.", 502);
}

async function sponsorLaunch(opts) {
  const body = opts || {};
  const parsed = parseMintKey(body.privateKey);
  if (!parsed) {
    throw fail("mint_key_missing", "Server mint is not set up. Connect a wallet, or leave this agent playable.", 503);
  }
  const secrets = [body.privateKey, parsed.privateKey];
  const prepared = body.prepared || prepareLaunch(body.params || {});
  if (prepared.devBuyQuote !== 0n) {
    throw fail("dev_buy", "A dev buy spends the creator wallet. Connect your own wallet for a dev buy, or set it to zero. This agent can still play.", 400);
  }
  const transport = body.transport || await resolveTransport(body.env);
  const abi = body.abi || loadAbi();
  const portal = prepared.portal || body.portal || activePortal();
  try {
    try {
    const creator = parsed.address;
    const splitterRaw = await transport.call({
      to: portal,
      data: encodeCall(abi, "predictSplitter", [creator, prepared.salt]),
    });
    const splitter = ethers.getAddress(decodeWord(["address"], splitterRaw)[0]);
    const hashRaw = await transport.call({
      to: portal,
      data: encodeCall(abi, "hookInitCodeHash", [splitter, prepared.buyTaxBps, prepared.sellTaxBps, prepared.quoteAsset]),
    });
    const initCodeHash = ethers.hexlify(decodeWord(["bytes32"], hashRaw)[0]);
    const mined = mineHookSalt({ portal, creator, initCodeHash });
    const data = encodeLaunch(abi, { ...prepared, hookSalt: mined.hookSalt });
    const chainId = Number(await transport.chainId());
    if (chainId !== CHAIN_ID) {
      throw fail("wrong_chain", "Server mint is not pointed at Arc mainnet (chain id 5042). This agent can still play.", 502);
    }
    const nonce = Number(await transport.nonce(creator));
    const fees = transport.feeData ? await transport.feeData() : { gasPrice: 1n };
    let gasLimit = FALLBACK_GAS;
    if (typeof transport.estimateGas === "function") {
      try {
        const est = BigInt(await transport.estimateGas({ from: creator, to: portal, data, value: 0n }));
        if (est > 0n) gasLimit = est + (est / 5n) + 50_000n;
      } catch (e) {
        throw scrubbed(e, secrets, "sponsor_rejected", "Portal #7 did not accept this launch. This agent can still play.", 400);
      }
    }
    if (gasLimit > GAS_CAP) gasLimit = GAS_CAP;
    const tx = {
      to: portal,
      data,
      value: 0n,
      chainId: CHAIN_ID,
      nonce,
      gasLimit,
    };
    if (fees && fees.maxFeePerGas != null && fees.maxPriorityFeePerGas != null) {
      tx.type = 2;
      tx.maxFeePerGas = BigInt(fees.maxFeePerGas);
      tx.maxPriorityFeePerGas = BigInt(fees.maxPriorityFeePerGas);
      if (tx.maxPriorityFeePerGas > tx.maxFeePerGas) tx.maxPriorityFeePerGas = tx.maxFeePerGas;
    } else {
      tx.type = 0;
      tx.gasPrice = BigInt((fees && fees.gasPrice) || 1n);
    }
    const wallet = new ethers.Wallet(parsed.privateKey);
    let raw;
    try {
      raw = await wallet.signTransaction(tx);
    } catch (e) {
      throw scrubbed(e, secrets, "sponsor_failed", "Server mint could not sign the launch. This agent can still play.", 502);
    }
    let txHash;
    try {
      txHash = await transport.broadcast(raw);
    } catch (e) {
      throw scrubbed(e, secrets, "sponsor_failed", "Server mint did not send. This agent can still play.", 502);
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(String(txHash || ""))) {
      throw fail("sponsor_failed", "Server mint did not return a transaction. This agent can still play.", 502);
    }
    return {
      txHash,
      creator,
      hook: mined.hook,
      portal: ethers.getAddress(portal),
      prepared,
    };
    } catch (e) {
      if (e && e.publicMessage) throw e;
      throw scrubbed(e, secrets, "sponsor_failed", "Server mint did not send. This agent can still play.", 502);
    }
  } finally {
    if (transport && typeof transport.destroy === "function") {
      try { transport.destroy(); } catch { /* the provider is already closed */ }
    }
  }
}

module.exports = {
  parseMintKey,
  redact,
  sponsorLaunch,
  createSponsorGuard,
  resetSponsorGuard,
  sponsorGuard,
  setSponsorTransport,
  clientKeys,
  clientIp,
  WINDOW_MS,
  SESSION_MAX,
  GLOBAL_MAX,
  MIN_INTERVAL_MS,
};
