// Portal 8 server mint and the 50/50 setPayoutSplit. The provider is a mock.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");
const ethers = require("ethers");
const { Show } = require("../src/showrunner");
const { handleShow } = require("../src/showhttp");
const launch = require("../src/argus/launch");
const portal8 = require("../src/argus/portal8");
const { argusPublicConfig } = require("../src/argus/config");
const { verifyLaunchTx } = require("../src/argus/verify");
const { setSponsorTransport, resetSponsorGuard } = require("../src/argus/sponsor");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }
function eq(a, b, m) { if (a !== b && String(a) !== String(b)) throw new Error((m || "eq") + `: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }

const signer = new ethers.Wallet("0x" + "11".repeat(32));
const TEST_KEY = signer.privateKey;
const MINT = signer.address;
const SPECTATOR = "0x2222222222222222222222222222222222222222";
const TOKEN = "0x3333333333333333333333333333333333333333";
const HOOK = "0x4444444444444444444444444444444444444444";
const LOCKER = "0x5555555555555555555555555555555555555555";
const ESCROW = "0x6666666666666666666666666666666666666666";
const BLOCK = "0x" + "cd".repeat(32);
const IMAGE = "https://liars-dice-arena.onrender.com/api/show/agents/u_vesper/pfp.svg";
const TEMPLATE = ethers.hexlify(new Uint8Array(400));
const ESCROW_HASH = ethers.keccak256(ethers.toUtf8Bytes("portal8-escrow-init"));
const SEED = 4_500_000n;

const partsIface = new ethers.Interface([
  "function escrowInitCodeHash(address portal) pure returns (bytes32)",
]);
const quoteIface = new ethers.Interface([
  "function economicsFor(address quote) view returns (uint128 startFdvQuote, uint128 bondFdvQuote, uint8 decimals)",
]);
const erc20Iface = new ethers.Interface([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

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

function form(extra) {
  return Object.assign({
    launchName: "LDA Vesper",
    launchTicker: "VESPER",
    launchImage: IMAGE,
    launchWebsite: "https://liarsdicearc.app/",
    launchDescription: "A quiet closer.\n\nAn LDA agent in Liar's Dice Arena.",
    launchX: "https://x.com/LiarsDiceArc",
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

function encodeAddr(iface, name, value) {
  return iface.encodeFunctionResult(name, [value]);
}

function portal8Transport(opts) {
  const options = opts || {};
  const sent = [];
  let nonce = 4;
  const allowance = options.allowance == null ? SEED : BigInt(options.allowance);
  return {
    sent,
    creators: [],
    broadcasts: () => sent.length,
    async call({ data }) {
      const sel = String(data || "").slice(0, 10).toLowerCase();
      const portal = portal8.portalIface;
      const creator = portal8.creatorIface;
      if (sel === portal.getFunction("creatorRegistry").selector) return encodeAddr(portal, "creatorRegistry", portal8.CREATOR_REGISTRY);
      if (sel === portal.getFunction("partsFactory").selector) return encodeAddr(portal, "partsFactory", portal8.PARTS_FACTORY);
      if (sel === portal.getFunction("hookFactory").selector) return encodeAddr(portal, "hookFactory", portal8.HOOK_FACTORY);
      if (sel === portal.getFunction("registry").selector) return encodeAddr(portal, "registry", portal8.QUOTE_REGISTRY);
      if (sel === portal.getFunction("minSeedPpm").selector) return portal.encodeFunctionResult("minSeedPpm", [100]);
      if (sel === quoteIface.getFunction("economicsFor").selector) {
        return quoteIface.encodeFunctionResult("economicsFor", [2_500n * 1_000_000n, 45_000n * 1_000_000n, 6]);
      }
      if (sel === erc20Iface.getFunction("allowance").selector) return erc20Iface.encodeFunctionResult("allowance", [allowance]);
      if (sel === portal.getFunction("hookInitCodeTemplate").selector) {
        return ethers.AbiCoder.defaultAbiCoder().encode(["bytes"], [TEMPLATE]);
      }
      if (sel === partsIface.getFunction("escrowInitCodeHash").selector) {
        return ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [ESCROW_HASH]);
      }
      if (sel === portal.getFunction("hookInitCodeHash").selector) {
        const decoded = portal.decodeFunctionData("hookInitCodeHash", data);
        this.creators.push(ethers.getAddress(decoded[0]));
        const escrow = portal8.predictEscrowAddress({
          partsFactory: portal8.PARTS_FACTORY,
          portal: portal8.PORTAL8,
          creator: decoded[0],
          hookSalt: decoded[1],
          escrowInitCodeHash: ESCROW_HASH,
        });
        return ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [portal8.hookInitCodeHashLocal(TEMPLATE, escrow)]);
      }
      if (sel === portal.getFunction("predictEscrow").selector) {
        const decoded = portal.decodeFunctionData("predictEscrow", data);
        const escrow = portal8.predictEscrowAddress({
          partsFactory: portal8.PARTS_FACTORY,
          portal: portal8.PORTAL8,
          creator: decoded[0],
          hookSalt: decoded[1],
          escrowInitCodeHash: ESCROW_HASH,
        });
        return ethers.AbiCoder.defaultAbiCoder().encode(["address"], [escrow]);
      }
      if (sel === creator.getFunction("payoutOf").selector) return encodeAddr(creator, "payoutOf", MINT);
      throw new Error("unexpected portal8 call " + sel);
    },
    async estimateGas() {
      if (options.revert) {
        const err = new Error("execution reverted");
        err.data = "0x4e487b71";
        throw err;
      }
      return 900_000n;
    },
    async nonce() { return nonce; },
    async feeData() { return { gasPrice: 2n, maxFeePerGas: null, maxPriorityFeePerGas: null }; },
    async chainId() { return 5042; },
    async broadcast(raw) {
      const tx = ethers.Transaction.from(raw);
      sent.push(tx);
      nonce += 1;
      return ethers.keccak256(ethers.toUtf8Bytes("portal8-tx-" + sent.length + "-" + tx.data.slice(0, 10)));
    },
    async receipt() { return { status: 1 }; },
    destroy() {},
  };
}

function launchedReceipt(txHash, creator) {
  const encoded = portal8.portalIface.encodeEventLog(portal8.portalIface.getEvent("Launched"), [
    TOKEN, creator, HOOK, ESCROW, LOCKER, 9n, -200, 400,
  ]);
  return {
    status: "0x1",
    transactionHash: txHash,
    blockHash: BLOCK,
    from: creator,
    to: portal8.PORTAL8,
    logs: [{ address: portal8.PORTAL8, topics: encoded.topics, data: encoded.data }],
  };
}

function mockFetch() {
  return async (url, opts) => {
    const body = JSON.parse(opts.body);
    const hash = body.params[0];
    return { ok: true, json: async () => ({ jsonrpc: "2.0", id: body.id, result: launchedReceipt(hash, MINT) }) };
  };
}

function mockReq(method, body, extra) {
  const req = new EventEmitter();
  req.method = method;
  req.headers = { "x-forwarded-for": (extra && extra.ip) || "203.0.113.9" };
  req.socket = { remoteAddress: "127.0.0.1" };
  req.destroy = () => {};
  process.nextTick(() => {
    if (body != null) req.emit("data", Buffer.from(JSON.stringify(body)));
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

function agent(show, name, extra) {
  const created = show.createAgent(Object.assign({
    name,
    shortDescription: "A quiet closer who spends one lie and waits.",
    archetype: "ASSASSIN",
  }, extra || {}));
  const draft = show.userAgents.get(created.agent.id);
  draft.status = "READY";
  return created.agent.id;
}

(async () => {
  eq(portal8.openingBuyRaw(45_000n * 1_000_000n, 100n), SEED, "usdc opening buy is 4.50");
  eq(portal8.openingBuyRaw(45_000n * 1_000_000n, 0n), 0n, "zero ppm means no opening buy");
  const parts = portal8.splitParts(MINT, SPECTATOR);
  eq(parts[0].bps + parts[1].bps, 10000, "split totals 10000");
  eq(parts[0].bps, 5000, "house half");
  eq(parts[1].recipient, ethers.getAddress(SPECTATOR), "spectator is last and takes the remainder");
  let rejected = false;
  try { portal8.splitParts(MINT, MINT); }
  catch (e) { rejected = e.code === "bad_fee_wallet"; }
  assert(rejected, "duplicate wallets are refused");
  rejected = false;
  try { portal8.parseSpectatorWallet(portal8.PORTAL8, MINT); }
  catch (e) { rejected = e.code === "bad_fee_wallet"; }
  assert(rejected, "protocol addresses are refused");
  eq(portal8.parseSpectatorWallet("", MINT), null, "blank wallet waits");
  eq(portal8.parseSpectatorWallet("  " + SPECTATOR.toLowerCase() + " ", MINT), ethers.getAddress(SPECTATOR), "checksum");

  const prepared = launch.prepareLaunch(form());
  const hookSalt = "0x" + "ab".repeat(32);
  const encoded = portal8.encodePortal8Launch(prepared, { payout: MINT, seed: SEED, recipient: MINT, hookSalt });
  const parsed = portal8.portalIface.parseTransaction({ data: encoded.data });
  eq(parsed.name, "launch", "portal 8 launch selector");
  eq(Number(parsed.args[0].alloc[0]), 10000, "creator lane");
  eq(Number(parsed.args[0].alloc[4]), 0, "lock lane stays zero");
  eq(parsed.args[0].bundle.length, 1, "one opening buy");
  eq(parsed.args[0].bundle[0].amountQuote, SEED, "opening buy amount");
  eq(ethers.getAddress(parsed.args[0].payoutAddress), MINT, "payout is the house");
  eq(Number(parsed.args[0].kothBps), 0, "koth off");
  eq(parsed.args[1], hookSalt, "hook salt");

  const mined = portal8.minePortal8Hook({
    hookFactory: portal8.HOOK_FACTORY,
    partsFactory: portal8.PARTS_FACTORY,
    portal: portal8.PORTAL8,
    creator: MINT,
    template: TEMPLATE,
    escrowInitCodeHash: ESCROW_HASH,
    maxTries: 40_000,
  });
  assert((BigInt(mined.hook) & portal8.HOOK_MASK) === portal8.HOOK_FLAGS, "mined hook flags 0x20cc");
  eq(mined.initCodeHash, portal8.hookInitCodeHashLocal(TEMPLATE, mined.escrow), "local hash matches the patch");
  assert(mined.tries < 40_000, "hook found within the try cap");

  const off = argusPublicConfig({ ARGUS_MINT_ENABLED: "1", ARGUS_MINT_KEY: TEST_KEY });
  eq(off.portal8Enabled, false, "portal 8 is off unless asked");
  eq(off.serverPortalNumber, 7, "server portal stays 7");
  eq(off.portal, ethers.getAddress(launch.PORTAL7), "browser portal stays 7");
  const on = argusPublicConfig({ ARGUS_MINT_ENABLED: "1", ARGUS_MINT_KEY: TEST_KEY, ARGUS_PORTAL: "8" });
  eq(on.portal8Enabled, true, "ARGUS_PORTAL=8");
  eq(on.serverPortal, ethers.getAddress(portal8.PORTAL8), "server portal is portal 8");
  eq(on.feeSplitBps.house, 5000, "published house bps");
  eq(on.feeSplitBps.creator, 5000, "published creator bps");
  eq(on.portal, ethers.getAddress(launch.PORTAL7), "wallet fallback stays on portal 7");
  assert(on.abi.some((row) => row.name === "launch" && row.inputs[0].components.some((field) => field.name === "expectConvert")), "browser abi is still portal 7");
  const alias = argusPublicConfig({ ARGUS_PORTAL8_ENABLED: "1" });
  eq(alias.portal8Enabled, true, "ARGUS_PORTAL8_ENABLED alias");

  const transport = portal8Transport();
  const sent = await portal8.sponsorPortal8({
    privateKey: TEST_KEY,
    prepared,
    spectatorFeeWallet: SPECTATOR,
    transport,
  });
  eq(sent.creator, MINT, "house signs");
  eq(sent.portalNumber, 8, "family");
  eq(sent.openingBuy.raw, SEED.toString(), "recorded opening buy");
  eq(sent.spectatorFeeWallet, ethers.getAddress(SPECTATOR), "spectator rides along");
  eq(transport.broadcasts(), 1, "allowance was enough, so only launch is sent");
  const launchTx = portal8.portalIface.parseTransaction({ data: transport.sent[0].data });
  eq(launchTx.name, "launch", "broadcast is launch");
  eq(launchTx.args[0].bundle[0].amountQuote, SEED, "broadcast opening buy");
  assert(!JSON.stringify(sent, (_, value) => typeof value === "bigint" ? value.toString() : value).includes(TEST_KEY.slice(2)), "sponsor result has no key");

  const low = portal8Transport({ allowance: 0n });
  await portal8.sponsorPortal8({ privateKey: TEST_KEY, prepared, transport: low });
  eq(low.broadcasts(), 2, "low allowance approves then launches");
  const approveTx = erc20Iface.parseTransaction({ data: low.sent[0].data });
  eq(approveTx.name, "approve", "first tx is the USDC approval");
  eq(ethers.getAddress(approveTx.args[0]), ethers.getAddress(portal8.PORTAL8), "approval spender is portal 8");
  eq(approveTx.args[1], SEED, "approval is the opening buy");

  const decoded = portal8.decodePortal8Receipt(launchedReceipt(sent.txHash, MINT));
  eq(decoded.portalNumber, 8, "decoded family");
  eq(decoded.tokenAddress, ethers.getAddress(TOKEN), "decoded token");
  eq(decoded.escrow, ethers.getAddress(ESCROW), "decoded escrow");
  eq(decoded.splitter, decoded.escrow, "splitter field carries the escrow for older readers");
  eq(decoded.creatorWallet, MINT, "decoded creator");
  eq(decoded.claimUrl, "https://argus.world/claim", "claim link");
  assert(decoded.poolId && decoded.poolId.startsWith("0x"), "pool id is computed");

  const prevFetch = global.fetch;
  global.fetch = mockFetch();
  const verified = await verifyLaunchTx(sent.txHash, { portal: portal8.PORTAL8 });
  eq(verified.tokenAddress, ethers.getAddress(TOKEN), "two rpcs confirm portal 8");
  eq(verified.creatorWallet, MINT, "confirmed creator");
  global.fetch = prevFetch;

  const splitTransport = portal8Transport();
  const split = await portal8.setPayoutSplitTx({
    privateKey: TEST_KEY,
    token: TOKEN,
    spectatorFeeWallet: SPECTATOR,
    transport: splitTransport,
  });
  eq(split.txHash.startsWith("0x"), true, "split tx");
  const splitTx = portal8.creatorIface.parseTransaction({ data: splitTransport.sent[0].data });
  eq(splitTx.name, "setPayoutSplit", "split call");
  eq(ethers.getAddress(splitTx.args[0]), ethers.getAddress(TOKEN), "split token");
  eq(Number(splitTx.args[1][0].bps), 5000, "house bps");
  eq(Number(splitTx.args[1][1].bps), 5000, "spectator bps");
  eq(ethers.getAddress(splitTx.args[1][1].recipient), ethers.getAddress(SPECTATOR), "spectator recipient");
  eq(ethers.getAddress(splitTransport.sent[0].to), ethers.getAddress(portal8.CREATOR_REGISTRY), "split goes to the creator registry");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lda-portal8-"));
  const show = boot(path.join(dir, "show.json"));
  show.ready = true;
  const prevFlag = process.env.ARGUS_MINT_ENABLED;
  const prevKey = process.env.ARGUS_MINT_KEY;
  const prevPortal = process.env.ARGUS_PORTAL;
  const prevAlias = process.env.ARGUS_PORTAL8_ENABLED;
  const savedFetch = global.fetch;
  try {
    process.env.ARGUS_MINT_ENABLED = "1";
    process.env.ARGUS_MINT_KEY = TEST_KEY;
    process.env.ARGUS_PORTAL = "8";
    delete process.env.ARGUS_PORTAL8_ENABLED;
    resetSponsorGuard({ max: 10, minIntervalMs: 0, globalMax: 100 });
    const chain = portal8Transport();
    setSponsorTransport(() => chain);
    global.fetch = mockFetch();

    const withWallet = agent(show, "Vesper", { spectatorFeeWallet: SPECTATOR });
    eq(show.agentDetail(withWallet).spectatorFeeWallet, ethers.getAddress(SPECTATOR), "create stores the fee wallet");
    const minted = mockRes();
    await handleShow(mockReq("POST", form({ spectatorFeeWallet: SPECTATOR }), { ip: "203.0.113.80" }), minted, "/api/show/agents/" + withWallet + "/argus/sponsor", new URLSearchParams(), show);
    eq(minted.statusCode, 200, "portal 8 sponsor " + minted.body);
    eq(minted.json.argus.portalNumber, 8, "saved family");
    eq(minted.json.argus.portal, ethers.getAddress(portal8.PORTAL8), "saved portal");
    eq(minted.json.argus.feeSplit.status, "set", "split is set");
    eq(minted.json.argus.feeSplit.houseBps, 5000, "saved house bps");
    eq(minted.json.argus.feeSplit.creatorBps, 5000, "saved creator bps");
    eq(minted.json.argus.feeSplit.spectatorWallet, ethers.getAddress(SPECTATOR), "saved spectator");
    assert(minted.json.argus.feeSplit.splitTxHash, "split tx stored");
    eq(minted.json.argus.symbol, "VESPER", "ticker kept");
    assert(!minted.body.includes(TEST_KEY.slice(2)), "http body has no key");
    const names = chain.sent.map((tx) => {
      try { return portal8.portalIface.parseTransaction({ data: tx.data }).name; }
      catch { return portal8.creatorIface.parseTransaction({ data: tx.data }).name; }
    });
    assert(names.includes("launch"), "http path launches");
    assert(names.includes("setPayoutSplit"), "http path sets the split");

    const later = agent(show, "Quill");
    const pendingRes = mockRes();
    await handleShow(mockReq("POST", form({ launchTicker: "QUILL", launchName: "LDA Quill" }), { ip: "203.0.113.81" }), pendingRes, "/api/show/agents/" + later + "/argus/sponsor", new URLSearchParams(), show);
    eq(pendingRes.statusCode, 200, "mint without a wallet " + pendingRes.body);
    eq(pendingRes.json.argus.feeSplit.status, "pending", "split waits");
    eq(pendingRes.json.argus.feeSplit.spectatorWallet, null, "no spectator yet");
    eq(pendingRes.json.argus.portalNumber, 8, "pending mint is still portal 8");
    const attached = mockRes();
    await handleShow(mockReq("POST", { spectatorFeeWallet: SPECTATOR }, { ip: "203.0.113.82" }), attached, "/api/show/agents/" + later + "/argus/payout", new URLSearchParams(), show);
    eq(attached.statusCode, 200, "later split " + attached.body);
    eq(attached.json.argus.feeSplit.status, "set", "later split lands");
    eq(attached.json.argus.feeSplit.spectatorWallet, ethers.getAddress(SPECTATOR), "later spectator");

    const prepChain = portal8Transport();
    setSponsorTransport(() => prepChain);
    const signerId = agent(show, "Signer");
    const preparedRes = mockRes();
    await handleShow(mockReq("POST", form({
      launchTicker: "SIGN",
      launchName: "LDA Signer",
      launcher: SPECTATOR,
    }), { ip: "203.0.113.84" }), preparedRes, "/api/show/agents/" + signerId + "/argus/prepare", new URLSearchParams(), show);
    eq(preparedRes.statusCode, 200, "spectator prepare " + preparedRes.body);
    eq(prepChain.broadcasts(), 0, "prepare does not spend the house mint key");
    eq(preparedRes.json.launcher, ethers.getAddress(SPECTATOR), "launcher is the spectator");
    eq(preparedRes.json.payout, ethers.getAddress(launch.HOUSE_LAUNCH_DEFAULTS.creatorFeeWallet), "payout is the house");
    eq(preparedRes.json.spectatorFeeWallet, ethers.getAddress(SPECTATOR), "blank fee wallet uses the signer");
    eq(preparedRes.json.openingBuy.recipient, ethers.getAddress(SPECTATOR), "signer pays and receives the opening buy");
    const preparedTx = portal8.portalIface.parseTransaction({ data: preparedRes.json.data });
    eq(preparedTx.name, "launch", "prepared calldata is launch");
    eq(ethers.getAddress(preparedTx.args[0].payoutAddress), ethers.getAddress(launch.HOUSE_LAUNCH_DEFAULTS.creatorFeeWallet), "calldata payout is the house");
    eq(ethers.getAddress(preparedTx.args[0].bundle[0].to), ethers.getAddress(SPECTATOR), "calldata bundle pays the signer");
    assert(prepChain.creators.includes(ethers.getAddress(SPECTATOR)), "hook is mined for the signer");
    assert(!prepChain.creators.includes(ethers.getAddress(launch.HOUSE_LAUNCH_DEFAULTS.creatorFeeWallet)), "hook is not mined for the house");
    assert(!preparedRes.body.includes(TEST_KEY.slice(2)), "prepare body has no key");
    const providerCalls = [];
    const preparedSend = await launch.sendPreparedLaunch({
      request: async (payload) => {
        providerCalls.push(payload);
        if (payload.method === "eth_requestAccounts") return [SPECTATOR];
        if (payload.method === "eth_chainId") return "0x13b2";
        if (payload.method === "eth_call") return ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [0]);
        if (payload.method === "eth_getTransactionReceipt") return { status: "0x1", transactionHash: "0x" + "cd".repeat(32) };
        if (payload.method === "eth_sendTransaction") return "0x" + "ab".repeat(32);
        throw new Error(payload.method);
      },
    }, {
      launcher: SPECTATOR,
      portal: portal8.PORTAL8,
      quote: launch.QUOTE_ASSET,
      openingBuyRaw: SEED.toString(),
      data: preparedRes.json.data,
    });
    eq(preparedSend.creator, ethers.getAddress(SPECTATOR), "prepared send uses the spectator");
    eq(preparedSend.txHash, "0x" + "ab".repeat(32), "prepared send returns the wallet hash");
    assert(providerCalls.some((row) => row.method === "eth_sendTransaction" && String(row.params[0].to).toLowerCase() === portal8.PORTAL8.toLowerCase()), "wallet sends to portal 8");
    assert(providerCalls.some((row) => row.method === "eth_sendTransaction" && row.params[0].data === preparedRes.json.data), "wallet sends the prepared calldata");

    global.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      const hash = body.params[0];
      return { ok: true, json: async () => ({ jsonrpc: "2.0", id: body.id, result: launchedReceipt(hash, SPECTATOR) }) };
    };
    setSponsorTransport(() => portal8Transport());
    const signed = mockRes();
    const signedHash = "0x" + "ee".repeat(32);
    await handleShow(mockReq("POST", { txHash: signedHash, spectatorFeeWallet: SPECTATOR }, { ip: "203.0.113.85" }), signed, "/api/show/agents/" + signerId + "/argus", new URLSearchParams(), show);
    eq(signed.statusCode, 200, "spectator receipt " + signed.body);
    eq(signed.json.argus.creatorWallet, ethers.getAddress(SPECTATOR), "on-chain creator is the signer");
    eq(signed.json.argus.payoutWallet, MINT, "recorded payout is the controller the registry reports");
    eq(signed.json.argus.feeSplit.status, "set", "house sets the split after the spectator mint");
    eq(signed.json.argus.feeSplit.spectatorWallet, ethers.getAddress(SPECTATOR), "split spectator is the signer");
    global.fetch = mockFetch();

    const old = agent(show, "Nightshade");
    show.attachArgusMint(old, {
      status: "minted",
      tokenAddress: TOKEN,
      poolId: "0x" + "12".repeat(32),
      hook: HOOK,
      locker: LOCKER,
      splitter: "0x7777777777777777777777777777777777777777",
      portal: launch.PORTAL7,
      txHash: "0x" + "ab".repeat(32),
      creatorWallet: MINT,
      symbol: "NIGHT",
    });
    eq(show.agentDetail(old).argus.portalNumber, 7, "portal 7 record stays portal 7");
    eq(show.agentDetail(old).argus.feeSplit, null, "portal 7 record has no split");
    eq(show.agentDetail(old).argus.symbol, "NIGHT", "portal 7 symbol stays");
    const refused = mockRes();
    await handleShow(mockReq("POST", { spectatorFeeWallet: SPECTATOR }, { ip: "203.0.113.83" }), refused, "/api/show/agents/" + old + "/argus/payout", new URLSearchParams(), show);
    eq(refused.statusCode, 409, "portal 7 payout is refused");
    eq(refused.json.code, "portal7", "portal 7 code");
    eq(show.agentDetail(old).argus.portal, ethers.getAddress(launch.PORTAL7), "portal 7 address unchanged");
  } finally {
    global.fetch = savedFetch;
    setSponsorTransport(null);
    resetSponsorGuard();
    if (prevFlag == null) delete process.env.ARGUS_MINT_ENABLED;
    else process.env.ARGUS_MINT_ENABLED = prevFlag;
    if (prevKey == null) delete process.env.ARGUS_MINT_KEY;
    else process.env.ARGUS_MINT_KEY = prevKey;
    if (prevPortal == null) delete process.env.ARGUS_PORTAL;
    else process.env.ARGUS_PORTAL = prevPortal;
    if (prevAlias == null) delete process.env.ARGUS_PORTAL8_ENABLED;
    else process.env.ARGUS_PORTAL8_ENABLED = prevAlias;
  }

  const app = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "argus", "portal8.js"), "utf8");
  assert(app.includes("50/50 on-chain via Argus Portal 8 payout-split"), "create copy names the on-chain split");
  assert(app.includes("Sign Portal 8 launch"), "spectator signs the portal 8 mint");
  assert(app.includes("payout controller"), "copy says the house stays the payout controller");
  assert(app.includes("if (argusOffer.portal8Enabled) return;"), "profile view does not house-mint a portal 8 agent");
  assert(app.includes("!portal8SpectatorSign(creator.argusConfig)"), "create does not auto house-mint when the spectator can sign");
  assert(!app.includes("You do not sign the mint"), "portal 8 create no longer says the spectator skips the signature");
  assert(app.includes("data-set-fee-wallet"), "profile can set the fee wallet later");
  assert(app.includes("data-fee-wallet-connect"), "create can fill a wallet without minting");
  assert(app.includes("Claim creator fees"), "claim link is offered");
  assert(app.includes("no on-chain split with the spectator"), "portal 7 copy still says there is no on-chain split");
  assert(app.includes("The house pays you."), "portal 7 copy still says the house pays");
  assert(!app.includes("ARGUS_MINT_KEY"), "client does not mention the mint key");
  assert(!src.includes("HOUSE_PRIVATE_KEY"), "portal 8 module does not read the house key");
  assert(!/0x[0-9a-fA-F]{64}/.test(src), "portal 8 module has no private key");
  const docs = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8")
    + fs.readFileSync(path.join(__dirname, "..", ".env.example"), "utf8");
  assert(docs.includes("ARGUS_PORTAL=8"), "flag is documented");
  assert(docs.includes("setPayoutSplit"), "split call is documented");
  assert(docs.includes("4.50 USDC"), "opening buy is documented");

  console.log("portal 8 split ok");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
