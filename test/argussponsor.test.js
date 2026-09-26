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
const {
  parseMintKey,
  sponsorLaunch,
  setSponsorTransport,
  resetSponsorGuard,
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

function receipt(creator) {
  return {
    status: "0x1",
    transactionHash: TX,
    blockHash: BLOCK,
    from: creator,
    to: launch.PORTAL7,
    logs: [
      eventLog("TokenCreated", [TOKEN, creator, "Vesper", "VESPER", POOL, IMAGE, SITE, "", ""]),
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

function mockTransport(opts) {
  const options = opts || {};
  const sent = [];
  let broadcasts = 0;
  return {
    sent,
    broadcasts: () => broadcasts,
    async call({ data }) {
      const parsed = iface().parseTransaction({ data });
      if (parsed.name === "predictSplitter") {
        return ethers.AbiCoder.defaultAbiCoder().encode(["address"], [SPLITTER]);
      }
      if (parsed.name === "hookInitCodeHash") {
        return ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [ethers.keccak256(ethers.toUtf8Bytes("portal7-hook"))]);
      }
      throw new Error("unexpected call " + parsed.name);
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
  } finally {
    console.warn = prevWarn;
    global.fetch = prevFetch;
    setSponsorTransport(null);
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
  assert(app.includes("data-argus-launch"), "browser launch action remains");
  assert(app.includes("Launch with server mint"), "server mint button");
  assert(app.includes("data-argus-sponsor"), "server mint action");
  assert(app.includes("server mint wallet"), "ui names the on-chain creator");
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
