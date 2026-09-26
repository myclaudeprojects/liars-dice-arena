// Portal #7 wallet launch: ticker, allocation, calldata, hook mining, and mint persistence.
// The provider is a mock. Nothing here talks to Arc.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");
const ethers = require("ethers");
const { Show } = require("../src/showrunner");
const { handleShow } = require("../src/showhttp");
const launch = require("../src/argus/launch");
const { argusPublicConfig } = require("../src/argus/config");
const { verifyLaunchTx, rpcUrls } = require("../src/argus/verify");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }
function eq(a, b, m) { if (a !== b) throw new Error((m || "eq") + `: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }

const CREATOR = "0x1111111111111111111111111111111111111111";
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
  return {
    address: launch.PORTAL7,
    topics: encoded.topics,
    data: encoded.data,
  };
}

function receipt(overrides) {
  const body = overrides || {};
  return {
    status: body.status == null ? "0x1" : body.status,
    transactionHash: body.transactionHash || TX,
    blockHash: body.blockHash == null ? BLOCK : body.blockHash,
    from: body.from || CREATOR,
    to: body.to == null ? launch.PORTAL7 : body.to,
    logs: body.logs || [
      eventLog("TokenCreated", [TOKEN, CREATOR, "Vesper", "VESPER", POOL, IMAGE, SITE, "", ""]),
      eventLog("PartsDeployed", [TOKEN, LOCKER, HOOK, SPLITTER]),
    ],
  };
}

function mockFetch(byHost) {
  return async (url, opts) => {
    const host = new URL(url).host;
    const spec = byHost[host];
    if (spec === "down") return { ok: false, status: 503, json: async () => ({}) };
    const body = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ jsonrpc: "2.0", id: body.id, result: spec }) };
  };
}

function mockReq(method, body) {
  const req = new EventEmitter();
  req.method = method;
  req.destroy = () => {};
  process.nextTick(() => {
    if (body != null) req.emit("data", Buffer.from(JSON.stringify(body)));
    req.emit("end");
  });
  return req;
}

function mockRes() {
  const res = {
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
  return res;
}

(async () => {
  eq(launch.BUNDLE_SHA256, "94f7e126fd2f0a9fe34f1c4b82d7f8082eef9757a5822895f3c0a6d1c9d3da1f", "bundle pin");
  eq(launch.activePortal(), ethers.getAddress(launch.PORTAL7), "portal 7 when the bundle file is absent");
  assert(launch.activePortal() !== ethers.getAddress(launch.PORTAL6), "not portal 6");
  eq(launch.portal7FromBundle({
    addresses: { portal: launch.PORTAL6 },
    portal7: { address: launch.PORTAL7 },
  }), ethers.getAddress(launch.PORTAL7), "portal7 section wins over addresses.portal");
  let rejected = false;
  try { launch.portal7FromBundle({ addresses: { portal: launch.PORTAL6 } }); }
  catch (e) { rejected = e.code === "bundle"; }
  assert(rejected, "missing portal7 section is refused");
  rejected = false;
  try { launch.portal7FromBundle({ portal7: { address: launch.PORTAL6 } }); }
  catch (e) { rejected = e.code === "bundle"; }
  assert(rejected, "portal7 section cannot be portal 6");
  rejected = false;
  try { launch.portal7FromBundle({ addresses: { portal: launch.PORTAL7 }, portal7: launch.PORTAL7 }); }
  catch (e) { rejected = e.code === "bundle"; }
  assert(rejected, "top-level portal is not a substitute");

  const topic = iface().getEvent("TokenCreated").topicHash;
  assert(topic.startsWith("0x1d891723"), "TokenCreated topic " + topic);
  eq(iface().getEvent("PartsDeployed").name, "PartsDeployed", "parts event");
  const launchFn = iface().getFunction("launch");
  eq(launchFn.inputs[0].components[launchFn.inputs[0].components.length - 1].name, "expectConvert", "portal 7 field");

  eq(launch.deriveTicker("Vesper"), "VESPER", "single word");
  eq(launch.deriveTicker("The Fox"), "TF", "initials");
  eq(launch.deriveTicker("Silent Wager"), "SW", "two words");
  eq(launch.deriveTicker("Agent 7"), "A7", "digit");
  eq(launch.deriveTicker("Extraordinary"), "EXTRAORDIN", "ten characters");
  eq(launch.deriveTicker("Fox", ["FOX"]), "FOX2", "collision");
  eq(launch.deriveTicker("The Fox", ["TF", "tf2"]), "TF3", "next free suffix");
  eq(launch.deriveTicker("!!"), "AG", "fallback ticker");

  const alloc = launch.validateAllocation({ creatorBps: 10000, burnBps: 0, dividendBps: 0, liquidityBps: 0 });
  eq(alloc.creatorBps, 10000, "creator allocation");
  launch.validateAllocation({ creatorBps: 4000, burnBps: 2000, dividendBps: 2000, liquidityBps: 2000 });
  for (const bad of [
    { creatorBps: 9999, burnBps: 0, dividendBps: 0, liquidityBps: 0 },
    { creatorBps: 10001, burnBps: 0, dividendBps: 0, liquidityBps: 0 },
    { creatorBps: -1, burnBps: 0, dividendBps: 0, liquidityBps: 10001 },
    { creatorBps: 1.5, burnBps: 0, dividendBps: 0, liquidityBps: 9998.5 },
  ]) {
    let threw = false;
    try { launch.validateAllocation(bad); }
    catch (e) { threw = e.code === "allocation"; }
    assert(threw, "bad allocation " + JSON.stringify(bad));
  }
  eq(launch.validateTaxes(500, 500).buyTaxBps, 500, "default tax");
  eq(launch.validateTaxes(100, 1000).sellTaxBps, 1000, "tax bounds");
  for (const pair of [[0, 500], [500, 0], [99, 500], [500, 1001]]) {
    let threw = false;
    try { launch.validateTaxes(pair[0], pair[1]); }
    catch (e) { threw = e.code === "tax"; }
    assert(threw, "bad tax " + pair.join("/"));
  }

  const huge = "https://cdn.example.com/" + "a".repeat(600);
  eq(launch.fitImageUri([huge], IMAGE), IMAGE, "long image falls back");
  eq(launch.byteLength(IMAGE) < 512, true, "pfp url fits");
  const suggested = launch.suggestLaunch({
    name: "Vesper",
    description: "A quiet closer who spends one lie and waits.",
    agentId: "u_vesper",
    publicBase: "https://liars-dice-arena.onrender.com",
    takenTickers: ["VESPER"],
    canonicalPfp: huge,
  });
  eq(suggested.launchTicker, "VESPER2", "suggested ticker avoids a collision");
  eq(suggested.launchImage, IMAGE, "suggested image is the short portrait");
  eq(suggested.launchWebsite, SITE, "website is the site root");
  eq(suggested.launchBuy, "5", "buy default");
  eq(suggested.launchCreator, "100", "creator default");
  eq(suggested.launchDevBuy, "0", "no dev buy");
  const prepared = launch.prepareLaunch(suggested);
  eq(prepared.name, "Vesper", "prepared name");
  eq(prepared.symbol, "VESPER2", "prepared ticker");
  eq(prepared.buyTaxBps, 500, "prepared buy");
  eq(prepared.sellTaxBps, 500, "prepared sell");
  eq(prepared.creatorBps, 10000, "prepared creator");
  eq(prepared.burnBps, 0, "prepared burn");
  eq(prepared.devBuyQuote, 0n, "prepared dev buy");
  eq(prepared.startFdvUsdc6, 2500n * 1000000n, "opening fdv");
  eq(prepared.bondFdvUsdc6, 45000n * 1000000n, "bond fdv");
  eq(prepared.totalSupply, 1000000000n * (10n ** 18n), "supply");
  eq(prepared.expectConvert, 1, "quote payout");
  eq(prepared.quoteAsset, ethers.getAddress(launch.QUOTE_ASSET), "usdc quote");

  const mined = launch.mineHookSalt({
    portal: launch.PORTAL7,
    creator: CREATOR,
    initCodeHash: ethers.keccak256(ethers.toUtf8Bytes("portal7-hook")),
  });
  assert(mined.tries > 0 && mined.tries < 250000, "hook salt found in " + mined.tries);
  assert((BigInt(mined.hook) & ((1n << 14n) - 1n)) === launch.HOOK_FLAGS, "hook flags 0x2044");
  const salt = launch.hookCreate2Salt(CREATOR, mined.hookSalt);
  eq(ethers.getCreate2Address(launch.PORTAL7, salt, ethers.keccak256(ethers.toUtf8Bytes("portal7-hook"))), mined.hook, "create2 matches");

  const data = launch.encodeLaunch(null, { ...prepared, hookSalt: mined.hookSalt });
  const decodedCall = iface().decodeFunctionData("launch", data);
  eq(decodedCall[0].name, "Vesper", "calldata name");
  eq(decodedCall[0].symbol, "VESPER2", "calldata ticker");
  eq(decodedCall[0].buyTaxBps, 500n, "calldata buy");
  eq(decodedCall[0].sellTaxBps, 500n, "calldata sell");
  eq(decodedCall[0].creatorBps, 10000n, "calldata allocation");
  eq(decodedCall[0].devBuyQuote, 0n, "calldata dev buy");
  eq(decodedCall[0].expectConvert, 1n, "calldata expectConvert");
  eq(ethers.getAddress(decodedCall[0].quoteAsset), ethers.getAddress(launch.QUOTE_ASSET), "calldata quote");
  eq(decodedCall[1].imageURI, IMAGE, "calldata image");
  eq(decodedCall[1].website, SITE, "calldata website");
  eq(decodedCall[2], prepared.salt, "calldata salt");
  eq(decodedCall[3], mined.hookSalt, "calldata hook salt");
  assert(data.startsWith(launchFn.selector), "launch selector");

  const decodedReceipt = launch.decodeLaunchReceipt(receipt(), launch.PORTAL7);
  eq(decodedReceipt.tokenAddress, ethers.getAddress(TOKEN), "decoded token");
  eq(decodedReceipt.poolId, POOL, "decoded pool");
  eq(decodedReceipt.hook, ethers.getAddress(HOOK), "decoded hook");
  eq(decodedReceipt.locker, ethers.getAddress(LOCKER), "decoded locker");
  eq(decodedReceipt.splitter, ethers.getAddress(SPLITTER), "decoded splitter");
  eq(decodedReceipt.portal, ethers.getAddress(launch.PORTAL7), "decoded portal");
  eq(decodedReceipt.argusUrl, "https://argus.world/token/" + ethers.getAddress(TOKEN), "argus url");
  eq(decodedReceipt.creatorWallet, ethers.getAddress(CREATOR), "creator wallet");
  eq(decodedReceipt.status, "minted", "mint status");
  let badPortal = false;
  try { launch.decodeLaunchReceipt(receipt({ to: launch.PORTAL6, logs: [] }), launch.PORTAL6); }
  catch (e) { badPortal = e.code === "wrong_portal"; }
  assert(badPortal, "portal 6 receipt is refused");

  const hosts = {
    "rpc.mainnet.arc.io": receipt(),
    "rpc.drpc.mainnet.arc.io": receipt(),
  };
  const verified = await verifyLaunchTx(TX, {
    rpcUrls: ["https://rpc.mainnet.arc.io", "https://rpc.drpc.mainnet.arc.io"],
    fetchImpl: mockFetch(hosts),
  });
  eq(verified.tokenAddress, ethers.getAddress(TOKEN), "two rpcs agree");
  let unconfirmed = false;
  try {
    await verifyLaunchTx(TX, {
      rpcUrls: ["https://rpc.mainnet.arc.io", "https://rpc.drpc.mainnet.arc.io"],
      fetchImpl: mockFetch({ "rpc.mainnet.arc.io": receipt(), "rpc.drpc.mainnet.arc.io": null }),
    });
  } catch (e) { unconfirmed = e.code === "unconfirmed"; }
  assert(unconfirmed, "one endpoint is not enough");
  let disagreed = false;
  const other = receipt();
  other.logs = [
    eventLog("TokenCreated", ["0x9999999999999999999999999999999999999999", CREATOR, "Vesper", "VESPER", POOL, IMAGE, SITE, "", ""]),
    eventLog("PartsDeployed", ["0x9999999999999999999999999999999999999999", LOCKER, HOOK, SPLITTER]),
  ];
  try {
    await verifyLaunchTx(TX, {
      rpcUrls: ["https://rpc.mainnet.arc.io", "https://rpc.drpc.mainnet.arc.io"],
      fetchImpl: mockFetch({ "rpc.mainnet.arc.io": receipt(), "rpc.drpc.mainnet.arc.io": other }),
    });
  } catch (e) { disagreed = e.code === "unconfirmed"; }
  assert(disagreed, "disagreeing endpoints are refused");
  let down = false;
  try {
    await verifyLaunchTx(TX, {
      rpcUrls: ["https://rpc.mainnet.arc.io", "https://rpc.drpc.mainnet.arc.io"],
      fetchImpl: mockFetch({ "rpc.mainnet.arc.io": "down", "rpc.drpc.mainnet.arc.io": "down" }),
    });
  } catch (e) { down = e.code === "rpc_unavailable"; }
  assert(down, "all endpoints down");
  assert(rpcUrls({ ARC_RPC_URL: "https://rpc.mainnet.arc.io", ARC_RPC_URLS: "" }).length >= 2, "fallback rpcs");

  const calls = [];
  let chain = "0x1";
  const provider = {
    async request({ method, params }) {
      calls.push(method);
      if (method === "eth_requestAccounts") return [CREATOR];
      if (method === "eth_chainId") return chain;
      if (method === "wallet_switchEthereumChain") {
        const err = new Error("missing");
        err.code = 4902;
        throw err;
      }
      if (method === "wallet_addEthereumChain") {
        eq(params[0].chainId, "0x13b2", "added arc");
        chain = "0x13b2";
        return null;
      }
      if (method === "eth_call") {
        const parsed = iface().parseTransaction({ data: params[0].data });
        if (parsed.name === "predictSplitter") {
          return ethers.AbiCoder.defaultAbiCoder().encode(["address"], [SPLITTER]);
        }
        if (parsed.name === "hookInitCodeHash") {
          return ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [ethers.keccak256(ethers.toUtf8Bytes("portal7-hook"))]);
        }
        throw new Error("unexpected call " + parsed.name);
      }
      if (method === "eth_sendTransaction") {
        eq(ethers.getAddress(params[0].to), ethers.getAddress(launch.PORTAL7), "tx targets portal 7");
        eq(params[0].from, CREATOR, "creator signs");
        const sent = iface().decodeFunctionData("launch", params[0].data);
        eq(sent[0].symbol, "VESPER2", "wallet payload ticker");
        eq(sent[0].buyTaxBps, 500n, "wallet payload tax");
        return TX;
      }
      if (method === "eth_getTransactionReceipt") return receipt({ transactionHash: params[0] });
      throw new Error("unexpected " + method);
    },
  };
  const ran = await launch.runLaunch(provider, {
    portal: launch.PORTAL7,
    abi: launch.loadAbi(),
    params: suggested,
    receiptDelayMs: 0,
  });
  eq(ran.decoded.tokenAddress, ethers.getAddress(TOKEN), "mock provider decoded the token");
  eq(ran.creator, ethers.getAddress(CREATOR), "mock provider creator");
  assert(calls.includes("wallet_addEthereumChain"), "chain was added");
  assert(!calls.includes("eth_sendTransaction") || calls.filter((m) => m === "eth_sendTransaction").length === 1, "one launch tx");

  let declined = false;
  try {
    await launch.connectWallet({
      async request() {
        const err = new Error("no");
        err.code = 4001;
        throw err;
      },
    });
  } catch (e) { declined = e.code === "wallet_rejected"; }
  assert(declined, "declined wallet keeps the agent path");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lda-argus-"));
  const file = path.join(dir, "show.json");
  const show = boot(file);
  const created = show.createAgent({
    name: "Vesper",
    shortDescription: "A quiet closer who spends one lie and waits.",
    archetype: "ASSASSIN",
  });
  const id = created.agent.id;
  const draft = show.userAgents.get(id);
  draft.status = "READY";
  show.attachArgusMint(id, decodedReceipt);
  const detail = show.agentDetail(id);
  eq(detail.playable, true, "minted agent still plays");
  eq(detail.status, "READY", "mint does not change play status");
  eq(detail.argus.tokenAddress, ethers.getAddress(TOKEN), "detail stores the token");
  eq(detail.argus.poolId, POOL, "detail stores the pool");
  eq(detail.argus.hook, ethers.getAddress(HOOK), "detail stores the hook");
  eq(detail.argus.locker, ethers.getAddress(LOCKER), "detail stores the locker");
  eq(detail.argus.splitter, ethers.getAddress(SPLITTER), "detail stores the splitter");
  eq(detail.argus.portal, ethers.getAddress(launch.PORTAL7), "detail stores portal 7");
  eq(detail.argus.txHash, TX, "detail stores the tx");
  eq(detail.argus.creatorWallet, ethers.getAddress(CREATOR), "detail stores the creator");
  eq(detail.argus.status, "minted", "detail mint status");
  const again = show.attachArgusMint(id, decodedReceipt);
  eq(again.argus.txHash, TX, "same transaction is idempotent");
  let duplicate = false;
  try { show.attachArgusMint(id, { ...decodedReceipt, txHash: "0x" + "ef".repeat(32) }); }
  catch (e) { duplicate = e.code === "already_minted"; }
  assert(duplicate, "a second token is refused");
  eq(show.agentDetail(id).argus.txHash, TX, "the first token stays");
  const reloaded = boot(file);
  eq(reloaded.agentDetail(id).argus.argusUrl, detail.argus.argusUrl, "mint survives a reload");
  eq(reloaded.agentList().find((row) => row.id === id).argus.symbol, "VESPER", "roster exposes the ticker");

  show.ready = true;
  const off = mockRes();
  await handleShow(mockReq("GET"), off, "/api/show/argus/config", new URLSearchParams(), show);
  eq(off.json.enabled, false, "mint is off by default");
  assert(!off.json.abi, "disabled config hides the abi");
  const blocked = mockRes();
  await handleShow(mockReq("POST", { txHash: TX }), blocked, "/api/show/agents/" + id + "/argus", new URLSearchParams(), show);
  eq(blocked.statusCode, 403, "attach is refused while disabled");
  eq(show.agentDetail(id).playable, true, "a refused mint leaves the agent");

  const prevFlag = process.env.ARGUS_MINT_ENABLED;
  const prevFetch = global.fetch;
  process.env.ARGUS_MINT_ENABLED = "1";
  try {
    const cfg = argusPublicConfig();
    eq(cfg.enabled, true, "flag enables mint");
    eq(cfg.portal, ethers.getAddress(launch.PORTAL7), "enabled config is portal 7");
    assert(cfg.portal !== ethers.getAddress(launch.PORTAL6), "enabled config is not portal 6");
    assert(Array.isArray(cfg.abi) && cfg.abi.some((row) => row.name === "launch"), "config serves the launch abi");
    eq(cfg.defaults.buyTaxPercent, 5, "documented buy default");
    eq(cfg.defaults.creatorPercent, 100, "documented allocation");
    const fresh = boot(path.join(dir, "http.json"));
    fresh.ready = true;
    const made = fresh.createAgent({
      name: "Marble",
      shortDescription: "A quiet closer who spends one lie and waits.",
      archetype: "NOBLE",
    });
    global.fetch = mockFetch({
      "rpc.mainnet.arc.io": receipt(),
      "rpc.drpc.mainnet.arc.io": receipt(),
      "rpc.quicknode.mainnet.arc.io": receipt(),
      "rpc.blockdaemon.mainnet.arc.io": receipt(),
    });
    const saved = mockRes();
    await handleShow(mockReq("POST", { txHash: TX.toUpperCase() }), saved, "/api/show/agents/" + made.agent.id + "/argus", new URLSearchParams(), fresh);
    eq(saved.statusCode, 200, "verified attach " + saved.body);
    eq(saved.json.argus.status, "minted", "http mint status");
    eq(saved.json.argus.tokenAddress, ethers.getAddress(TOKEN), "http token");
    eq(fresh.userAgents.get(made.agent.id).status, "GENERATING_IDENTITY", "attach does not pretend the portrait finished");
  } finally {
    global.fetch = prevFetch;
    if (prevFlag == null) delete process.env.ARGUS_MINT_ENABLED;
    else process.env.ARGUS_MINT_ENABLED = prevFlag;
  }

  assert(fs.existsSync(path.join(__dirname, "..", "node_modules", "ethers", "dist", "ethers.umd.min.js")), "browser ethers bundle");
  assert(fs.existsSync(path.join(__dirname, "..", "public", "argusmint.js")), "browser mint script");
  console.log("argus mint ok");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
