// Server-sponsored Portal #7 launch. The provider is a mock. Nothing here talks to Arc.
// TEST_KEY is a fixture of repeated bytes, not a deployment key.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");
const ethers = require("ethers");
const { Show } = require("../src/showrunner");
const { handleShow } = require("../src/showhttp");
const launch = require("../src/argus/launch");
const { argusPublicConfig, SPONSOR_UNAVAILABLE } = require("../src/argus/config");
const { findPriorLaunch, setReceiptTimeout } = require("../src/argus/verify");
const {
  parseMintKey,
  sponsorLaunch,
  describeRevert,
  setSponsorTransport,
  resetSponsorGuard,
  setSponsorStepTimeout,
  clientKeys,
} = require("../src/argus/sponsor");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }
function eq(a, b, m) { if (a !== b) throw new Error((m || "eq") + `: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }

const TEST_KEY = "0x" + "11".repeat(32);
const MINT = new ethers.Wallet(TEST_KEY).address;
const TOKEN = "0x2222222222222222222222222222222222222222";
const HOOK = "0x3333333333333333333333333333333333333333";
const LOCKER = "0x4444444444444444444444444444444444444444";
const SPLITTER = "0x5555555555555555555555555555555555555555";
const TX = "0x" + "ab".repeat(32);
const BLOCK = "0x" + "cd".repeat(32);
const POOL = "0x" + "12".repeat(32);
const IMAGE = "https://liars-dice-arena.onrender.com/api/show/agents/u_vesper/pfp.svg";
const SITE = "https://liars-dice-arena.onrender.com/";

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

function receipt(creator, name, symbol) {
  return {
    status: "0x1",
    transactionHash: TX,
    blockHash: BLOCK,
    from: creator,
    to: launch.PORTAL7,
    logs: [
      eventLog("TokenCreated", [TOKEN, creator, name || "Vesper", symbol || "VESPER", POOL, IMAGE, SITE, "", ""]),
      eventLog("PartsDeployed", [TOKEN, LOCKER, HOOK, SPLITTER]),
    ],
  };
}

function mockFetch(byHost) {
  return async (url, opts) => {
    const host = new URL(url).host;
    const spec = byHost[host];
    if (spec == null || spec === "down") return { ok: false, status: 503, json: async () => ({}) };
    const body = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ jsonrpc: "2.0", id: body.id, result: spec }) };
  };
}

function agreeingHosts(creator) {
  const row = receipt(creator);
  return {
    "rpc.mainnet.arc.io": row,
    "rpc.drpc.mainnet.arc.io": row,
    "rpc.quicknode.mainnet.arc.io": row,
    "rpc.blockdaemon.mainnet.arc.io": row,
  };
}

function form(extra) {
  return Object.assign({
    launchName: "Vesper",
    launchTicker: "VESPER",
    launchImage: IMAGE,
    launchWebsite: SITE,
    launchDescription: "A quiet closer.",
    launchX: "",
    launchTelegram: "",
    launchBuy: "5",
    launchSell: "5",
    launchCreator: "100",
    launchBurn: "0",
    launchDividends: "0",
    launchLiquidity: "0",
    launchDevBuy: "0",
    launchStartFdv: "2500",
    launchBondFdv: "45000",
    launchSupply: "1000000000",
    predictor: "predictor01",
  }, extra || {});
}

const CONFIG_ABI = [
  "function launchConfig() view returns (address)",
  "function configFor(address creator) view returns (uint8 mode, uint96 minimumShareBalance)",
];
const configIface = new ethers.Interface(CONFIG_ABI);
const LAUNCH_CONFIG = "0x6666666666666666666666666666666666666666";
const TOKEN_IMPL = "0x7777777777777777777777777777777777777777";

function mockTransport(opts) {
  const options = opts || {};
  const sent = [];
  let broadcasts = 0;
  return {
    sent,
    broadcasts: () => broadcasts,
    get estimates() { return options.estimates || 0; },
    async call({ data }) {
      const selector = String(data || "").slice(0, 10).toLowerCase();
      if (selector === configIface.getFunction("launchConfig").selector) {
        return ethers.AbiCoder.defaultAbiCoder().encode(["address"], [LAUNCH_CONFIG]);
      }
      if (selector === configIface.getFunction("configFor").selector) {
        return ethers.AbiCoder.defaultAbiCoder().encode(["uint8", "uint96"], [options.rewardMode || 0, 0]);
      }
      const parsed = iface().parseTransaction({ data });
      if (parsed.name === "tokenImpl") {
        return ethers.AbiCoder.defaultAbiCoder().encode(["address"], [TOKEN_IMPL]);
      }
      if (parsed.name === "predictSplitter") {
        return ethers.AbiCoder.defaultAbiCoder().encode(["address"], [SPLITTER]);
      }
      if (parsed.name === "hookInitCodeHash") {
        return ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [ethers.keccak256(ethers.toUtf8Bytes("portal7-hook"))]);
      }
      throw new Error("unexpected call " + parsed.name);
    },
    async estimateGas() {
      if (options.revertData) {
        options.estimates = (options.estimates || 0) + 1;
        if (!(options.revertOnce && options.estimates > 1)) {
          const err = new Error("execution reverted");
          err.shortMessage = "execution reverted (unknown custom error)";
          err.data = options.revertData;
          if (options.revertSecret) err.shortMessage += " " + options.revertSecret;
          throw err;
        }
      }
      return 210000n;
    },
    async nonce() { return 4; },
    async feeData() { return { gasPrice: 1n, maxFeePerGas: null, maxPriorityFeePerGas: null }; },
    async chainId() { return options.chainId == null ? 5042 : options.chainId; },
    async broadcast(raw) {
      broadcasts += 1;
      if (options.onBroadcast) await options.onBroadcast(raw);
      if (options.failSend) throw new Error(options.failSend);
      const tx = ethers.Transaction.from(raw);
      sent.push(tx);
      return options.txHash || TX;
    },
  };
}

function mockReq(method, body, extra) {
  const req = new EventEmitter();
  const more = extra || {};
  req.method = method;
  req.headers = more.headers || {};
  req.socket = { remoteAddress: more.ip || "203.0.113.10" };
  req.destroy = () => {};
  process.nextTick(() => {
    if (body != null) req.emit("data", Buffer.from(typeof body === "string" ? body : JSON.stringify(body)));
    req.emit("end");
  });
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

function agent(show, name) {
  const created = show.createAgent({
    name,
    shortDescription: "A quiet closer who spends one lie and waits.",
    archetype: "ASSASSIN",
  });
  const draft = show.userAgents.get(created.agent.id);
  draft.status = "READY";
  return created.agent.id;
}

(async () => {
  const parsed = parseMintKey(TEST_KEY);
  eq(parsed.address, MINT, "fixture address");
  eq(parseMintKey("  " + TEST_KEY.slice(2).toUpperCase() + " ").address, MINT, "bare hex key");
  eq(parseMintKey(""), null, "empty key");
  eq(parseMintKey("not-a-key"), null, "bad key");
  assert(parseMintKey(TEST_KEY).privateKey !== TEST_KEY.slice(2), "normalized key keeps the prefix");

  const hidden = argusPublicConfig({ ARGUS_MINT_ENABLED: "1", ARGUS_MINT_KEY: TEST_KEY });
  eq(hidden.sponsored, true, "key enables server mint");
  eq(hidden.enabled, true, "flag still enables the browser path");
  eq(hidden.mintWallet, MINT, "public config names the mint wallet");
  eq(hidden.portal, ethers.getAddress(launch.PORTAL7), "sponsored config stays on portal 7");
  const dumped = JSON.stringify(hidden);
  assert(!dumped.includes(TEST_KEY), "public config omits the key");
  assert(!dumped.includes(TEST_KEY.slice(2)), "public config omits the raw key");
  assert(!Object.prototype.hasOwnProperty.call(hidden, "privateKey"), "no privateKey field");

  eq(hidden.siteUrl, "https://liarsdicearc.app/", "house site is prefilled");
  eq(hidden.xUrl, "https://x.com/LiarsDiceArc", "house X is prefilled");
  eq(hidden.telegramUrl, "", "Telegram is left blank");
  eq(hidden.creatorFeeWallet, "0x341BB8851Ff8fD9EAE20ea083c2F779e646B8488", "house creator-fee wallet is prefilled");
  eq(hidden.mintIsHouse, false, "fixture mint key is not the house wallet");
  const matched = argusPublicConfig({
    ARGUS_MINT_ENABLED: "1",
    ARGUS_MINT_KEY: TEST_KEY,
    ARGUS_CREATOR_WALLET: MINT,
  });
  eq(matched.mintIsHouse, true, "mint key that matches the house wallet prefers server mint");
  eq(matched.defaults.creatorPercent, 100, "allocation stays 100% creator");
  eq(matched.defaults.dividendPercent, 0, "dividends stay 0");
  eq(matched.defaults.burnPercent, 0, "burn stays 0");
  eq(matched.defaults.liquidityPercent, 0, "LP stays 0");
  const branded = argusPublicConfig({
    ARGUS_MINT_ENABLED: "1",
    PUBLIC_BASE_URL: "https://liarsdicearc.app",
    LDA_SITE_URL: "https://example.com/arena",
    LDA_X_URL: "https://x.com/Example",
    LDA_TELEGRAM_URL: "https://t.me/example",
    ARGUS_CREATOR_WALLET: "0x2222222222222222222222222222222222222222",
  });
  eq(branded.publicBase, "https://liarsdicearc.app", "public base stays the app origin");
  eq(branded.siteUrl, "https://example.com/arena/", "LDA_SITE_URL replaces the website");
  eq(branded.xUrl, "https://x.com/Example", "LDA_X_URL replaces X");
  eq(branded.telegramUrl, "https://t.me/example", "LDA_TELEGRAM_URL replaces Telegram");
  eq(branded.creatorFeeWallet, "0x2222222222222222222222222222222222222222", "ARGUS_CREATOR_WALLET replaces the fee wallet");
  const canonHost = argusPublicConfig({ PUBLIC_BASE_URL: "https://www.liarsdicearc.app" });
  eq(canonHost.siteUrl, "https://www.liarsdicearc.app/", "a canonical public base becomes the website");
  const badWallet = argusPublicConfig({ ARGUS_CREATOR_WALLET: "not-an-address" });
  eq(badWallet.creatorFeeWallet, "0x341BB8851Ff8fD9EAE20ea083c2F779e646B8488", "a bad fee wallet keeps the house default");

  const houseOnly = argusPublicConfig({ ARGUS_MINT_ENABLED: "1", HOUSE_PRIVATE_KEY: TEST_KEY });
  eq(houseOnly.sponsored, false, "house key is not a mint key");
  eq(houseOnly.mintWallet, null, "house key is not published as the creator");
  eq(houseOnly.sponsoredMessage, SPONSOR_UNAVAILABLE, "missing mint key explains itself");

  const warnings = [];
  const prevWarn = console.warn;
  console.warn = (...args) => warnings.push(args.map(String).join(" "));
  try {
    const invalid = argusPublicConfig({ ARGUS_MINT_ENABLED: "1", ARGUS_MINT_KEY: "super-secret-not-a-key" });
    eq(invalid.sponsored, false, "invalid key leaves server mint off");
    eq(invalid.sponsoredMessage, SPONSOR_UNAVAILABLE, "invalid key uses the public message");
    assert(warnings.some((line) => line.includes("cannot be used")), "invalid key warns once");
    assert(warnings.every((line) => !line.includes("super-secret-not-a-key")), "warning omits the value");
  } finally {
    console.warn = prevWarn;
  }

  const off = argusPublicConfig({ ARGUS_MINT_ENABLED: "0", ARGUS_MINT_KEY: TEST_KEY });
  eq(off.enabled, false, "flag still gates the feature");
  eq(off.sponsored, false, "key alone does not enable mint");
  eq(off.mintWallet, null, "disabled config hides the mint wallet");
  assert(!off.abi, "disabled config still hides the abi");

  const transport = mockTransport();
  const signed = await sponsorLaunch({ privateKey: TEST_KEY, params: form(), transport });
  eq(signed.creator, MINT, "server mint creator is the mint key");
  eq(signed.txHash, TX, "broadcast hash");
  eq(signed.portal, ethers.getAddress(launch.PORTAL7), "signed launch targets portal 7");
  assert(signed.portal !== ethers.getAddress(launch.PORTAL6), "not portal 6");
  const tx = transport.sent[0];
  eq(ethers.getAddress(tx.to), ethers.getAddress(launch.PORTAL7), "tx to portal 7");
  eq(ethers.getAddress(tx.from), MINT, "recovered signer is the mint key");
  eq(tx.chainId, 5042n, "arc chain id");
  eq(tx.nonce, 4, "nonce from the provider");
  const decoded = iface().decodeFunctionData("launch", tx.data);
  eq(decoded[0].name, "Vesper", "sponsored calldata name");
  eq(decoded[0].symbol, "VESPER", "sponsored calldata ticker");
  eq(decoded[0].buyTaxBps, 500n, "sponsored calldata buy tax");
  eq(decoded[0].sellTaxBps, 500n, "sponsored calldata sell tax");
  eq(decoded[0].creatorBps, 10000n, "sponsored calldata creator share");
  eq(decoded[0].devBuyQuote, 0n, "sponsored calldata has no dev buy");
  eq(decoded[0].expectConvert, 1n, "sponsored calldata expectConvert");
  eq(ethers.getAddress(decoded[0].quoteAsset), ethers.getAddress(launch.QUOTE_ASSET), "sponsored quote is usdc");
  assert((BigInt(signed.hook) & ((1n << 14n) - 1n)) === launch.HOOK_FLAGS, "sponsored hook flags");
  eq(decoded[0].dividendBps, 0n, "no reward tracker keeps a zero dividend");

  eq(launch.seatRewardDividend({ creatorBps: 10000, burnBps: 0, dividendBps: 0, liquidityBps: 0 }, 0).dividendBps, 0, "mode none leaves the allocation");
  const quoted = launch.seatRewardDividend({ creatorBps: 10000, burnBps: 0, dividendBps: 0, liquidityBps: 0 }, 1);
  eq(quoted.creatorBps, 9999, "quote mode takes one basis point from the creator");
  eq(quoted.dividendBps, 1, "quote mode seats one basis point of dividend");
  const kind = launch.seatRewardDividend({ creatorBps: 0, burnBps: 0, dividendBps: 0, liquidityBps: 10000 }, 2);
  eq(kind.liquidityBps, 9999, "in-kind mode can take the basis point from liquidity");
  eq(kind.dividendBps, 1, "in-kind mode still seats a dividend");
  const kept = launch.seatRewardDividend({ creatorBps: 9950, burnBps: 0, dividendBps: 50, liquidityBps: 0 }, 1);
  eq(kept.dividendBps, 50, "an explicit dividend is left alone");

  const nightshadeImage = "https://liars-dice-arena.onrender.com/assets/portraits/bank_0094.webp?v=1&s=6";
  const tracked = mockTransport({ rewardMode: 1 });
  const night = await sponsorLaunch({
    privateKey: TEST_KEY,
    params: form({
      launchName: "LDA Nightshade",
      launchTicker: "NIGHTSHADE",
      launchImage: nightshadeImage,
      launchWebsite: "https://liarsdicearc.app/",
      launchX: "https://x.com/LiarsDiceArc",
      launchDescription: "A quiet closer.\n\nPlay at https://liarsdicearc.app/",
    }),
    transport: tracked,
  });
  const nightDecoded = iface().decodeFunctionData("launch", tracked.sent[0].data);
  eq(nightDecoded[0].name, "LDA Nightshade", "a space in the LDA name is accepted");
  eq(nightDecoded[0].symbol, "NIGHTSHADE", "nightshade ticker");
  eq(nightDecoded[1].imageURI, nightshadeImage, "portrait query string is not the revert");
  eq(nightDecoded[1].website, "https://liarsdicearc.app/", "house website");
  eq(nightDecoded[0].devBuyQuote, 0n, "nightshade dev buy stays zero");
  eq(nightDecoded[0].creatorBps, 9999n, "house reward mode moves one basis point");
  eq(nightDecoded[0].dividendBps, 1n, "house reward mode requires a dividend");
  eq(night.prepared.dividendBps, 1, "returned launch records the dividend");

  const reverted = mockTransport({ rewardMode: 1, revertData: "0xabec626d", revertSecret: TEST_KEY });
  const revertLogs = [];
  console.warn = (...args) => revertLogs.push(args.map(String).join(" "));
  let revertCode = "";
  try {
    await sponsorLaunch({ privateKey: TEST_KEY, params: form(), transport: reverted });
  } catch (e) {
    revertCode = e.code;
    assert(!String(e.publicMessage).includes("RewardTrackerWithoutDividend"), "the spectator message stays short");
    assert(!String(e.publicMessage).includes(TEST_KEY.slice(2)), "spectator message omits the key");
  } finally {
    console.warn = prevWarn;
  }
  eq(revertCode, "sponsor_rejected", "estimateGas revert is sponsor_rejected");
  eq(reverted.broadcasts(), 0, "a revert is not broadcast");
  const revertLine = revertLogs.find((line) => line.includes("sponsor_rejected")) || "";
  assert(revertLine.includes("RewardTrackerWithoutDividend"), "log names the custom error");
  assert(revertLine.includes("selector=0xabec626d"), "log includes the selector");
  assert(!revertLine.toLowerCase().includes(TEST_KEY.slice(2)), "revert log omits the key");
  const named = describeRevert({ data: "0xabec626d", shortMessage: "execution reverted (unknown custom error)" }, launch.loadAbi());
  eq(named, "RewardTrackerWithoutDividend selector=0xabec626d", "describeRevert decodes the portal error");

  setSponsorStepTimeout(200);
  const hanging = mockTransport();
  hanging.estimateGas = () => new Promise(() => {});
  const timeoutLogs = [];
  console.warn = (...args) => timeoutLogs.push(args.map(String).join(" "));
  let timeoutCode = "";
  try {
    await sponsorLaunch({ privateKey: TEST_KEY, params: form(), transport: hanging });
  } catch (e) {
    timeoutCode = e.code;
    assert(/can still play/i.test(e.publicMessage), "a timeout stays playable");
  } finally {
    console.warn = prevWarn;
    setSponsorStepTimeout(null);
  }
  eq(timeoutCode, "sponsor_timeout", "a hung estimateGas times out");
  eq(hanging.broadcasts(), 0, "a timeout does not broadcast");
  const timeoutLine = timeoutLogs.find((line) => line.includes("sponsor_timeout")) || "";
  assert(timeoutLine.includes("estimateGas"), "timeout log names the step");
  assert(!timeoutLine.toLowerCase().includes(TEST_KEY.slice(2)), "timeout log omits the key");

  const priorOnly = eventLog("TokenCreated", [TOKEN, MINT, "LDA NightshadeX", "NIGHTSHADE", POOL, IMAGE, SITE, "", ""]);
  const priorRow = await findPriorLaunch({
    creator: MINT,
    name: "LDA NightshadeX",
    symbol: "NIGHTSHADE",
    rpcUrls: ["https://rpc.mainnet.arc.io"],
    fetchImpl: async (url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.method === "eth_blockNumber") return { ok: true, json: async () => ({ result: "0x2000" }) };
      if (body.method === "eth_getLogs") {
        const from = body.params[0].fromBlock;
        const hit = from === "0x0" || BigInt(from) <= 0x20n;
        return { ok: true, json: async () => ({ result: hit ? [{ address: launch.PORTAL7, topics: priorOnly.topics, data: priorOnly.data, transactionHash: TX, blockNumber: "0x20" }] : [] }) };
      }
      return { ok: false, status: 503, json: async () => ({}) };
    },
  });
  eq(priorRow && priorRow.txHash, TX, "a mined NightshadeX launch is found in an older window");
  const skipped = await findPriorLaunch({
    creator: MINT,
    name: "LDA NightshadeX",
    symbol: "NIGHTSHADE",
    taken: new Set([TX.toLowerCase()]),
    rpcUrls: ["https://rpc.mainnet.arc.io"],
    fetchImpl: async (url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.method === "eth_blockNumber") return { ok: true, json: async () => ({ result: "0x30" }) };
      if (body.method === "eth_getLogs") {
        return { ok: true, json: async () => ({ result: [{ address: launch.PORTAL7, topics: priorOnly.topics, data: priorOnly.data, transactionHash: TX, blockNumber: "0x20" }] }) };
      }
      return { ok: false, status: 503, json: async () => ({}) };
    },
  });
  eq(skipped, null, "a token already saved on an agent is not reused");

  const wrongChain = mockTransport({ chainId: 1 });
  let wrong = false;
  try { await sponsorLaunch({ privateKey: TEST_KEY, params: form(), transport: wrongChain }); }
  catch (e) { wrong = e.code === "wrong_chain"; }
  assert(wrong, "wrong chain does not send");
  eq(wrongChain.broadcasts(), 0, "wrong chain made no broadcast");

  const dev = mockTransport();
  let devBuy = false;
  try { await sponsorLaunch({ privateKey: TEST_KEY, params: form({ launchDevBuy: "5" }), transport: dev }); }
  catch (e) { devBuy = e.code === "dev_buy"; }
  assert(devBuy, "server mint refuses a dev buy");
  eq(dev.broadcasts(), 0, "dev buy made no broadcast");

  const leaked = mockTransport({ failSend: "rejected " + TEST_KEY });
  const seen = [];
  console.warn = (...args) => seen.push(args.map(String).join(" "));
  let leakedCode = "";
  try {
    await sponsorLaunch({ privateKey: TEST_KEY, params: form(), transport: leaked });
  } catch (e) {
    leakedCode = e.code;
    assert(!String(e.publicMessage).includes(TEST_KEY.slice(2)), "client message omits the key");
  } finally {
    console.warn = prevWarn;
  }
  eq(leakedCode, "sponsor_failed", "failed send");
  assert(seen.length > 0, "failure is logged");
  assert(seen.every((line) => !line.toLowerCase().includes(TEST_KEY.slice(2))), "logs omit the key");

  const keys = clientKeys({ headers: { "x-forwarded-for": "198.51.100.4, 10.0.0.1" }, socket: { remoteAddress: "10.0.0.8" } }, { predictor: "Predictor01" });
  eq(keys[0], "session:predictor01", "session key");
  eq(keys[1], "ip:198.51.100.4", "forwarded ip");
  assert(keys.includes("global"), "global bucket");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lda-sponsor-"));
  const file = path.join(dir, "show.json");
  const show = boot(file);
  show.ready = true;
  const id = agent(show, "Vesper");
  const prevFlag = process.env.ARGUS_MINT_ENABLED;
  const prevKey = process.env.ARGUS_MINT_KEY;
  const prevFetch = global.fetch;
  try {
    delete process.env.ARGUS_MINT_ENABLED;
    delete process.env.ARGUS_MINT_KEY;
    setSponsorTransport(() => { throw new Error("transport should stay unused"); });
    const disabled = mockRes();
    await handleShow(mockReq("POST", form()), disabled, "/api/show/agents/" + id + "/argus/sponsor", new URLSearchParams(), show);
    eq(disabled.statusCode, 403, "sponsor respects the flag");
    eq(disabled.json.code, "argus_disabled", "disabled code");
    eq(show.agentDetail(id).playable, true, "disabled sponsor leaves the agent");
    eq(show.agentDetail(id).argus, null, "disabled sponsor stores nothing");

    process.env.ARGUS_MINT_ENABLED = "1";
    const missing = mockRes();
    await handleShow(mockReq("POST", form()), missing, "/api/show/agents/" + id + "/argus/sponsor", new URLSearchParams(), show);
    eq(missing.statusCode, 503, "missing key");
    eq(missing.json.code, "mint_key_missing", "missing key code");
    eq(missing.json.error, SPONSOR_UNAVAILABLE, "missing key message");
    eq(show.userAgents.get(id).status, "READY", "missing key keeps the agent ready");
    const created = mockRes();
    await handleShow(mockReq("POST", {
      name: "Marble",
      shortDescription: "A quiet closer who spends one lie and waits.",
      archetype: "NOBLE",
    }), created, "/api/show/agents/brand/create", new URLSearchParams(), show);
    eq(created.statusCode, 200, "create still works when server mint is unset " + created.body);
    eq(created.json.ok, true, "create response");

    process.env.ARGUS_MINT_KEY = TEST_KEY;
    const cfg = mockRes();
    await handleShow(mockReq("GET"), cfg, "/api/show/argus/config", new URLSearchParams(), show);
    eq(cfg.json.sponsored, true, "config offers server mint");
    eq(cfg.json.mintWallet, MINT, "config publishes the creator address");
    assert(!cfg.body.includes(TEST_KEY.slice(2)), "config response has no key");
    assert(Array.isArray(cfg.json.abi) && cfg.json.abi.some((row) => row.name === "launch"), "browser abi still served");

    resetSponsorGuard({ max: 1, minIntervalMs: 0, globalMax: 100 });
    const failing = mockTransport({ failSend: "rejected " + TEST_KEY });
    setSponsorTransport(() => failing);
    const blew = mockRes();
    await handleShow(mockReq("POST", form(), { ip: "203.0.113.20" }), blew, "/api/show/agents/" + id + "/argus/sponsor", new URLSearchParams(), show);
    eq(blew.statusCode, 502, "failed send status " + blew.body);
    assert(!blew.body.includes(TEST_KEY.slice(2)), "failed response has no key");
    assert(/can still play/i.test(blew.json.error), "failed send stays playable in copy");
    eq(show.agentDetail(id).argus, null, "failed send does not persist a token");
    eq(show.agentDetail(id).status, "READY", "failed send keeps play status");
    eq(failing.broadcasts(), 1, "one failed broadcast");
    const limited = mockRes();
    await handleShow(mockReq("POST", form({ predictor: "predictor02" }), { ip: "203.0.113.20" }), limited, "/api/show/agents/" + id + "/argus/sponsor", new URLSearchParams(), show);
    eq(limited.statusCode, 429, "same ip is limited across sessions");
    eq(limited.json.code, "rate_limited", "rate limit code");
    eq(failing.broadcasts(), 1, "limited call does not send");
    eq(show.agentDetail(id).playable, true, "rate limit leaves the agent");

    resetSponsorGuard({ max: 10, minIntervalMs: 0, globalMax: 100 });
    const badTicker = mockRes();
    await handleShow(mockReq("POST", form({ launchTicker: "A" })), badTicker, "/api/show/agents/" + id + "/argus/sponsor", new URLSearchParams(), show);
    eq(badTicker.statusCode, 400, "bad ticker");
    eq(badTicker.json.code, "ticker", "ticker code");
    eq(show.agentDetail(id).argus, null, "bad ticker stores nothing");

    const devRes = mockRes();
    await handleShow(mockReq("POST", form({ launchDevBuy: "1" })), devRes, "/api/show/agents/" + id + "/argus/sponsor", new URLSearchParams(), show);
    eq(devRes.statusCode, 400, "http dev buy");
    eq(devRes.json.code, "dev_buy", "http dev buy code");
    eq(failing.broadcasts(), 1, "dev buy does not broadcast");

    const good = mockTransport();
    setSponsorTransport(() => good);
    global.fetch = mockFetch(agreeingHosts(MINT));
    const saved = mockRes();
    await handleShow(mockReq("POST", form(), { ip: "203.0.113.30" }), saved, "/api/show/agents/" + id + "/argus/sponsor", new URLSearchParams(), show);
    eq(saved.statusCode, 200, "sponsored persist " + saved.body);
    eq(saved.json.sponsored, true, "response marks the server path");
    eq(saved.json.argus.status, "minted", "mint status");
    eq(saved.json.argus.tokenAddress, ethers.getAddress(TOKEN), "token");
    eq(saved.json.argus.poolId, POOL, "pool");
    eq(saved.json.argus.hook, ethers.getAddress(HOOK), "hook");
    eq(saved.json.argus.locker, ethers.getAddress(LOCKER), "locker");
    eq(saved.json.argus.splitter, ethers.getAddress(SPLITTER), "splitter");
    eq(saved.json.argus.portal, ethers.getAddress(launch.PORTAL7), "portal");
    eq(saved.json.argus.txHash, TX, "tx");
    eq(saved.json.argus.creatorWallet, MINT, "persisted creator is the mint wallet");
    eq(saved.json.argus.symbol, "VESPER", "ticker");
    assert(saved.json.argus.mintedAt, "minted at");
    assert(!saved.body.includes(TEST_KEY.slice(2)), "success response has no key");
    eq(show.agentDetail(id).playable, true, "minted agent still plays");
    eq(show.agentDetail(id).status, "READY", "mint does not change play status");
    eq(good.broadcasts(), 1, "one successful broadcast");
    const disk = fs.readFileSync(file, "utf8");
    assert(!disk.includes(TEST_KEY.slice(2)), "show file has no mint key");
    const again = mockRes();
    await handleShow(mockReq("POST", form(), { ip: "203.0.113.31" }), again, "/api/show/agents/" + id + "/argus/sponsor", new URLSearchParams(), show);
    eq(again.statusCode, 409, "second mint");
    eq(again.json.code, "already_minted", "already minted");
    eq(good.broadcasts(), 1, "second mint does not send");
    eq(show.agentDetail(id).argus.txHash, TX, "first token stays");

    const other = agent(show, "Quill");
    global.fetch = mockFetch({ "rpc.mainnet.arc.io": receipt(MINT) });
    const pending = mockRes();
    await handleShow(mockReq("POST", form({ launchTicker: "QUILL", launchName: "Quill" }), { ip: "203.0.113.40" }), pending, "/api/show/agents/" + other + "/argus/sponsor", new URLSearchParams(), show);
    eq(pending.json.code, "unconfirmed", "one rpc is not confirmation " + pending.body);
    eq(pending.json.txHash, TX, "unconfirmed response keeps the hash for check again");
    eq(show.agentDetail(other).argus, null, "unconfirmed mint is not stored");
    eq(show.agentDetail(other).playable, true, "unconfirmed agent still plays");

    let entered = false;
    let release = () => {};
    const gate = new Promise((resolve) => { release = resolve; });
    const slow = mockTransport({
      onBroadcast: async () => {
        entered = true;
        await gate;
      },
    });
    setSponsorTransport(() => slow);
    global.fetch = mockFetch(agreeingHosts(MINT));
    const third = agent(show, "Nim");
    const first = mockRes();
    const pendingFirst = handleShow(mockReq("POST", form({ launchTicker: "NIM", launchName: "Nim" }), { ip: "203.0.113.50" }), first, "/api/show/agents/" + third + "/argus/sponsor", new URLSearchParams(), show);
    for (let i = 0; i < 50 && !entered; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    assert(entered, "first server mint reached the broadcaster");
    const busy = mockRes();
    await handleShow(mockReq("POST", form({ launchTicker: "NIM", launchName: "Nim" }), { ip: "203.0.113.51" }), busy, "/api/show/agents/" + third + "/argus/sponsor", new URLSearchParams(), show);
    eq(busy.statusCode, 409, "in flight");
    eq(busy.json.code, "sponsor_busy", "in flight code");
    eq(slow.broadcasts(), 1, "overlap does not double send");
    release();
    await pendingFirst;
    eq(first.statusCode, 200, "in-flight leader still persists " + first.body);
    eq(show.agentDetail(third).argus.creatorWallet, MINT, "in-flight leader stores the mint wallet");

    resetSponsorGuard({ max: 10, minIntervalMs: 0, globalMax: 100 });
    const retryId = agent(show, "Relay");
    const flaky = mockTransport({ rewardMode: 1, revertData: "0xabec626d", revertOnce: true });
    setSponsorTransport(() => flaky);
    global.fetch = mockFetch(agreeingHosts(MINT));
    const retried = mockRes();
    await handleShow(mockReq("POST", form({ launchTicker: "RELAY", launchName: "Relay" }), { ip: "203.0.113.70" }), retried, "/api/show/agents/" + retryId + "/argus/sponsor", new URLSearchParams(), show);
    eq(retried.statusCode, 200, "a rejected estimate is retried once " + retried.body);
    eq(flaky.estimates, 2, "silent retry estimates again");
    eq(flaky.broadcasts(), 1, "silent retry broadcasts once");
    eq(show.agentDetail(retryId).argus.status, "minted", "silent retry persists the token");

    const stuck = mockTransport({ rewardMode: 1, revertData: "0xabec626d" });
    setSponsorTransport(() => stuck);
    const stuckId = agent(show, "Stuck");
    const stuckRes = mockRes();
    await handleShow(mockReq("POST", form({ launchTicker: "STUCK", launchName: "Stuck" }), { ip: "203.0.113.71" }), stuckRes, "/api/show/agents/" + stuckId + "/argus/sponsor", new URLSearchParams(), show);
    eq(stuckRes.statusCode, 400, "two rejects stay a failure");
    eq(stuck.estimates, 2, "retry stops after one extra attempt");
    eq(stuck.broadcasts(), 0, "a repeated reject is not broadcast");
    eq(show.agentDetail(stuckId).argus, null, "a repeated reject stores nothing");

    const priorId = agent(show, "Piper");
    const TX2 = "0x" + "ee".repeat(32);
    const priorLog = eventLog("TokenCreated", [TOKEN, MINT, "Piper", "PIPER", POOL, IMAGE, SITE, "", ""]);
    const priorFetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      const host = new URL(url).host;
      if (body.method === "eth_blockNumber") return { ok: true, json: async () => ({ result: "0x30" }) };
      if (body.method === "eth_getLogs") {
        return { ok: true, json: async () => ({ result: [{ address: launch.PORTAL7, topics: priorLog.topics, data: priorLog.data, transactionHash: TX2, blockNumber: "0x20" }] }) };
      }
      if (body.method === "eth_getTransactionReceipt") {
        if (host === "rpc.quicknode.mainnet.arc.io") return { ok: false, status: 503, json: async () => ({}) };
        const row = receipt(MINT, "Piper", "PIPER");
        row.transactionHash = TX2;
        return { ok: true, json: async () => ({ result: row }) };
      }
      return { ok: false, status: 503, json: async () => ({}) };
    };
    const quiet = mockTransport();
    setSponsorTransport(() => quiet);
    global.fetch = priorFetch;
    const reused = mockRes();
    await handleShow(mockReq("POST", form({ launchTicker: "PIPER", launchName: "Piper" }), { ip: "203.0.113.80" }), reused, "/api/show/agents/" + priorId + "/argus/sponsor", new URLSearchParams(), show);
    eq(reused.statusCode, 200, "an already mined launch is attached " + reused.body);
    eq(reused.json.argus.txHash, TX2, "reused tx");
    eq(reused.json.argus.symbol, "PIPER", "reused ticker");
    eq(quiet.broadcasts(), 0, "reuse does not broadcast");
    eq(show.agentDetail(priorId).argus.status, "minted", "reused token is minted");

    const heldId = agent(show, "Hold");
    show.noteArgusPending(heldId, { txHash: TX, creatorWallet: MINT, name: "Hold", symbol: "HOLD" });
    global.fetch = mockFetch(agreeingHosts(MINT));
    const heldRes = mockRes();
    await handleShow(mockReq("POST", form({ launchTicker: "HOLD", launchName: "Hold" }), { ip: "203.0.113.81" }), heldRes, "/api/show/agents/" + heldId + "/argus/sponsor", new URLSearchParams(), show);
    eq(heldRes.statusCode, 200, "a pending hash is confirmed without a new send " + heldRes.body);
    eq(quiet.broadcasts(), 0, "pending confirm does not broadcast");
    eq(show.agentDetail(heldId).argus.tokenAddress, ethers.getAddress(TOKEN), "pending confirm stores the token");

    setReceiptTimeout(200);
    const slowId = agent(show, "Linger");
    let receiptCalls = 0;
    global.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.method === "eth_blockNumber") return { ok: true, json: async () => ({ result: "0x10" }) };
      if (body.method === "eth_getLogs") return { ok: true, json: async () => ({ result: [] }) };
      if (body.method === "eth_getTransactionReceipt") {
        receiptCalls += 1;
        await new Promise(() => {});
      }
      return { ok: false, status: 503, json: async () => ({}) };
    };
    const once = mockTransport();
    setSponsorTransport(() => once);
    const hangLogs = [];
    console.warn = (...args) => hangLogs.push(args.map(String).join(" "));
    const hung = mockRes();
    await handleShow(mockReq("POST", form({ launchTicker: "LINGER", launchName: "Linger" }), { ip: "203.0.113.82" }), hung, "/api/show/agents/" + slowId + "/argus/sponsor", new URLSearchParams(), show);
    eq(hung.statusCode, 502, "a hung receipt becomes an RPC failure " + hung.body);
    eq(hung.json.code, "rpc_unavailable", "hung receipt code");
    eq(hung.json.txHash, TX, "hung receipt keeps the hash");
    eq(once.broadcasts(), 1, "the hung confirm already broadcast");
    eq(show.agentDetail(slowId).argus, null, "a hung confirm is not shown as minted");
    assert(show.userAgents.get(slowId).argus.status === "pending", "the hash is kept for the retry");
    assert(hangLogs.some((line) => line.includes("argus_sponsor") && line.includes("rpc_unavailable") && line.includes("timeout") && line.includes(TX)), "a hung receipt logs argus_sponsor");
    assert(hangLogs.every((line) => !line.toLowerCase().includes(TEST_KEY.slice(2))), "hung receipt log omits the key");
    console.warn = prevWarn;
    global.fetch = mockFetch(agreeingHosts(MINT));
    const againSlow = mockRes();
    await handleShow(mockReq("POST", form({ launchTicker: "LINGER", launchName: "Linger" }), { ip: "203.0.113.83" }), againSlow, "/api/show/agents/" + slowId + "/argus/sponsor", new URLSearchParams(), show);
    eq(againSlow.statusCode, 200, "the same hash confirms on retry " + againSlow.body);
    eq(once.broadcasts(), 1, "retry does not mint a second token");
    eq(show.agentDetail(slowId).argus.txHash, TX, "retry stores the first token");
    setReceiptTimeout(null);

    const failedReceipt = receipt(MINT);
    failedReceipt.status = "0x0";
    failedReceipt.logs = [];
    const droppedId = agent(show, "Drop");
    show.noteArgusPending(droppedId, { txHash: TX, creatorWallet: MINT, name: "Drop", symbol: "DROP" });
    global.fetch = mockFetch({
      "rpc.mainnet.arc.io": failedReceipt,
      "rpc.drpc.mainnet.arc.io": failedReceipt,
      "rpc.quicknode.mainnet.arc.io": failedReceipt,
      "rpc.blockdaemon.mainnet.arc.io": failedReceipt,
    });
    const dropped = mockRes();
    await handleShow(mockReq("POST", form({ launchTicker: "DROP", launchName: "Drop" }), { ip: "203.0.113.84" }), dropped, "/api/show/agents/" + droppedId + "/argus/sponsor", new URLSearchParams(), show);
    eq(dropped.json.code, "tx_failed", "a reverted launch is not reused " + dropped.body);
    eq(show.userAgents.get(droppedId).argus, null, "a reverted hash is cleared");
    eq(once.broadcasts(), 1, "clearing a revert does not send inside that request");
  } finally {
    console.warn = prevWarn;
    global.fetch = prevFetch;
    setSponsorTransport(null);
    setReceiptTimeout(null);
    setSponsorStepTimeout(null);
    resetSponsorGuard();
    if (prevFlag == null) delete process.env.ARGUS_MINT_ENABLED;
    else process.env.ARGUS_MINT_ENABLED = prevFlag;
    if (prevKey == null) delete process.env.ARGUS_MINT_KEY;
    else process.env.ARGUS_MINT_KEY = prevKey;
  }

  const app = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  const mintJs = fs.readFileSync(path.join(__dirname, "..", "public", "argusmint.js"), "utf8");
  const sponsorSrc = fs.readFileSync(path.join(__dirname, "..", "src", "argus", "sponsor.js"), "utf8");
  assert(app.includes("Sign create on Arc"), "browser sign button remains");
  assert(!app.includes("data-argus-for"), "the agent profile has no Launch on Argus button");
  assert(!app.includes(">Launch on Argus</button>"), "no profile control is labeled Launch on Argus");
  assert(!app.includes("!argusOffer.enabled || !agent.playable"), "a saved user agent can launch before they are playable");
  assert(app.includes("data-argus-launch"), "browser launch action remains");
  assert(app.includes("Launch with server mint"), "server mint button");
  assert(app.includes("data-argus-sponsor"), "server mint action");
  assert(app.includes("data-argus-house"), "house mint uses one launch screen");
  assert(app.includes("You invent a player for Liar's Dice Arena."), "create copy says what an agent is");
  assert(app.includes("The house pays you."), "create copy says the house pays the fee share");
  assert(app.includes("Creating token"), "house mint shows status instead of a choice");
  assert(app.includes("The token will retry"), "a failed house mint promises a retry without a button");
  assert(!app.includes("Retry mint"), "house mint does not ask the spectator to retry");
  assert(app.includes("sponsorArgus({ auto: true })"), "create confirm auto-runs the server mint");
  assert(app.includes("mintPhase"), "mint phase keeps the launching screen stable");
  assert(!app.includes("if (houseMint) return sponsor + connect + sign"), "house mint does not show the three launch buttons");
  assert(app.includes("return connect + sign + sponsor"), "a mint key that is not the house wallet does not lead with server mint");
  assert(app.includes("signing wallet becomes the on-chain creator"), "ui warns that Sign create changes who receives fees");
  assert(app.includes("unless you are signing as"), "ui warns Sign create conflicts unless the signer is the house wallet");
  assert(app.includes("portrait from Create Agent"), "image is the existing portrait");
  assert(app.includes("100% creator, 0% dividends, 0% burn, 0% LP"), "allocation default stays 100% creator");
  assert(app.includes("no on-chain split with the spectator"), "ui says the spectator split is not on-chain");
  assert(app.includes("siteUrl"), "launch suggestions receive the house site");
  assert(!app.includes("ARGUS_MINT_KEY"), "client does not mention the env key");
  assert(!mintJs.includes("ARGUS_MINT_KEY"), "wallet bundle does not mention the env key");
  assert(mintJs.includes("runLaunch"), "browser launch helper remains");
  assert(!sponsorSrc.includes("HOUSE_PRIVATE_KEY"), "sponsor source does not read the house key");
  assert(!sponsorSrc.includes(TEST_KEY.slice(2)), "sponsor source has no fixture key");
  const docs = fs.readFileSync(path.join(__dirname, "..", ".env.example"), "utf8")
    + fs.readFileSync(path.join(__dirname, "..", "render.yaml"), "utf8")
    + fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");
  assert(docs.includes("ARGUS_MINT_KEY"), "env var is documented");
  assert(docs.includes("HOUSE_PRIVATE_KEY"), "docs say not to reuse the house key");
  assert(!/ARGUS_MINT_KEY=\s*0x[0-9a-fA-F]{64}/.test(docs), "docs do not contain a key");

  console.log("argus sponsor ok");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
