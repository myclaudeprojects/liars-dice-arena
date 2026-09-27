// Argus Portal #8 spectator launches and the on-chain creator-fee split.
//
// Used when ARGUS_PORTAL=8 or ARGUS_PORTAL8_ENABLED is set.
//
// Spectator Create: the spectator wallet is msg.sender and pays the opening
// buy. payoutAddress is the house wallet, which Portal 8 allows to differ
// from the launcher. The house key then calls setPayoutSplit (5000/5000).
// The spectator cannot clear that split. The house key is not the launcher
// and does not buy tokens for this launch.
//
// House and factory server mints do not launch here. They stay on Portal #7
// in sponsor.js, with a zero dev buy and no opening buy. sponsorPortal8
// refuses so that path cannot spend the Portal 8 seed.

const { ethers } = require("ethers");
const { fail, prepareLaunch, QUOTE_ASSET, CHAIN_ID, HOUSE_LAUNCH_DEFAULTS } = require("./launch");

const PORTAL8 = "0xeed7559B8A6ABf64427dc41Cb5cc6400109C5D93";
const CREATOR_REGISTRY = "0x986B478bE2F05b44b47c61E26a0BbcBcC07610eD";
const QUOTE_REGISTRY = "0x58398C03C7a6240D8aa1cED42592933ad857843A";
const PARTS_FACTORY = "0xD969062076F75fbC4fd0195561501dC13eF87C72";
const HOOK_FACTORY = "0xA7a0F2D2DaE22851d77946A42d4010c5ba5aaD97";
const POOL_MANAGER = "0x8366a39CC670B4001A1121B8F6A443A643e40951";
const POSITION_MANAGER = "0x6049c9a0e26405C0985f9E3685C87d0aE917f82B";
const STATE_VIEW = "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b";
const TREASURY = "0x1D79DF4e2e8BF1847e9a07bBAa9aEd67EA09767f";
const CONVERTER = "0x90FEd5C170f43b299C3F70bEfC9bd3b2305d9f07";
const BURN_EXECUTOR = "0x917E6E0deC873b8Ee8A8F183a43c397ee3fe527d";
const LIQUIDITY_EXECUTOR = "0xDeBebDed037435ae0BfcB010840558a410c4AD0D";
const LOCK_EXECUTOR = "0x52Bf02Bd941D246356bfa9Ec9DC7afa7d42f5088";
const LOCK_VAULT = "0xf61641B4AA3C7ace1084B8D4380920ECCBFd7Af2";

const HOOK_FLAGS = 0x20CCn;
const HOOK_MASK = (1n << 14n) - 1n;
const DYNAMIC_FEE = 0x800000;
const TICK_SPACING = 200;
const SPLIT_BPS = 10_000;
const HOUSE_SPLIT_BPS = 5_000;
const CREATOR_SPLIT_BPS = 5_000;
const PPM = 1_000_000n;
const ESCROW_ABI_WORDS = 11;
const ESCROW_ABI_BYTES = ESCROW_ABI_WORDS * 32;
const ESCROW_WORD_INDEX = 2;
const CLAIM_URL = "https://argus.world/claim";
const FALLBACK_GAS = 18_000_000n;
const GAS_CAP = 30_000_000n;

const PORTAL_ABI = require("./portal8.abi.json");
const CREATOR_ABI = require("./creator-registry.abi.json");

const PARTS_ABI = [
  "function escrowInitCodeHash(address portal) pure returns (bytes32)",
];
const QUOTE_ABI = [
  "function economicsFor(address quote) view returns (uint128 startFdvQuote, uint128 bondFdvQuote, uint8 decimals)",
];

const portalIface = new ethers.Interface(PORTAL_ABI);
const creatorIface = new ethers.Interface(CREATOR_ABI);
const partsIface = new ethers.Interface(PARTS_ABI);
const quoteIface = new ethers.Interface(QUOTE_ABI);

const REFUSED_SPLIT = new Set([
  PORTAL8,
  CREATOR_REGISTRY,
  QUOTE_REGISTRY,
  PARTS_FACTORY,
  HOOK_FACTORY,
  POOL_MANAGER,
  POSITION_MANAGER,
  STATE_VIEW,
  TREASURY,
  CONVERTER,
  BURN_EXECUTOR,
  LIQUIDITY_EXECUTOR,
  LOCK_EXECUTOR,
  LOCK_VAULT,
  QUOTE_ASSET,
  "0xB021Be536808f551b31789422Fd28a6c9c6e97Da",
].map((row) => row.toLowerCase()));

function sameAddress(a, b) {
  return String(a || "").toLowerCase() === String(b || "").toLowerCase();
}

function isPortal8(value) {
  return sameAddress(value, PORTAL8);
}

function checksumOrNull(value) {
  try {
    const addr = ethers.getAddress(value);
    if (addr === ethers.ZeroAddress) return null;
    return addr;
  } catch {
    return null;
  }
}

function portal8Enabled(env) {
  const source = env || process.env;
  const named = String(source.ARGUS_PORTAL || "").trim();
  if (named === "8") return true;
  return /^(1|true|yes|on)$/i.test(String(source.ARGUS_PORTAL8_ENABLED || "").trim());
}

function houseWallet(value) {
  return checksumOrNull(value) || ethers.getAddress(HOUSE_LAUNCH_DEFAULTS.creatorFeeWallet);
}

// Empty means "set the spectator wallet later". A bad address is refused
// before any USDC moves. The house wallet cannot be both sides of the split.
function parseSpectatorWallet(value, payout) {
  const raw = String(value == null ? "" : value).trim();
  if (!raw) return null;
  const addr = checksumOrNull(raw);
  if (!addr) throw fail("bad_fee_wallet", "Fee claim wallet must be an Arc address.", 400);
  if (payout && sameAddress(addr, payout)) {
    throw fail("bad_fee_wallet", "Fee claim wallet must be your wallet. The house wallet is already the other half of the split.", 400);
  }
  if (REFUSED_SPLIT.has(addr.toLowerCase())) {
    throw fail("bad_fee_wallet", "That address cannot receive a creator-fee split.", 400);
  }
  return addr;
}

function parseLauncher(value) {
  const addr = checksumOrNull(value);
  if (!addr) throw fail("bad_launcher", "Connect a wallet before signing the Portal 8 launch.", 400);
  if (REFUSED_SPLIT.has(addr.toLowerCase())) {
    throw fail("bad_launcher", "That wallet cannot sign a Portal 8 launch.", 400);
  }
  return addr;
}

// The signing wallet is the fee-claim half when the form left it blank.
function spectatorForLaunch(explicit, launcher, payout) {
  const hinted = parseSpectatorWallet(explicit, payout);
  if (hinted) return hinted;
  if (!launcher || sameAddress(launcher, payout)) return null;
  return parseSpectatorWallet(launcher, payout);
}

function splitParts(house, spectator) {
  const left = ethers.getAddress(house);
  const right = ethers.getAddress(spectator);
  if (sameAddress(left, right)) {
    throw fail("bad_fee_wallet", "The 50/50 split needs two different wallets.", 400);
  }
  if (left === ethers.ZeroAddress || right === ethers.ZeroAddress) {
    throw fail("bad_fee_wallet", "Fee claim wallet must be an Arc address.", 400);
  }
  if (REFUSED_SPLIT.has(right.toLowerCase())) {
    throw fail("bad_fee_wallet", "That address cannot receive a creator-fee split.", 400);
  }
  return [
    { recipient: left, bps: HOUSE_SPLIT_BPS },
    { recipient: right, bps: CREATOR_SPLIT_BPS },
  ];
}

function openingBuyRaw(bondFdvQuote, minSeedPpm) {
  const bond = BigInt(bondFdvQuote);
  const ppm = BigInt(minSeedPpm);
  if (ppm === 0n) return 0n;
  if (bond <= 0n) throw fail("opening_buy", "Portal 8 did not report an opening value for USDC.", 502);
  let floor = (bond * ppm) / PPM;
  if (floor === 0n) floor = 1n;
  return floor;
}

function escrowWordOffset(length) {
  return length - ESCROW_ABI_BYTES + (ESCROW_WORD_INDEX * 32);
}

function predictEscrowAddress(opts) {
  const body = opts || {};
  const partsFactory = ethers.getAddress(body.partsFactory);
  const portal = ethers.getAddress(body.portal || PORTAL8);
  const creator = ethers.getAddress(body.creator);
  const hookSalt = ethers.hexlify(body.hookSalt);
  const initCodeHash = ethers.hexlify(body.escrowInitCodeHash);
  const escrowSalt = ethers.solidityPackedKeccak256(
    ["string", "address", "bytes32"],
    ["argus.v5.escrow", creator, hookSalt],
  );
  const create2Salt = ethers.solidityPackedKeccak256(
    ["address", "bytes32"],
    [portal, escrowSalt],
  );
  return ethers.getCreate2Address(partsFactory, create2Salt, initCodeHash);
}

function patchEscrowWord(template, escrow) {
  const code = ethers.getBytes(template);
  const offset = escrowWordOffset(code.length);
  if (offset < 0 || offset + 32 > code.length) {
    throw fail("hook_template", "Portal 8 hook template is shorter than the constructor tail.", 502);
  }
  let empty = true;
  for (let i = 0; i < 32; i++) if (code[offset + i] !== 0) empty = false;
  if (!empty) {
    throw fail("hook_template", "Portal 8 hook template does not have an empty escrow word.", 502);
  }
  const word = ethers.getBytes(ethers.zeroPadValue(ethers.getAddress(escrow), 32));
  code.set(word, offset);
  return code;
}

function hookInitCodeHashLocal(template, escrow) {
  return ethers.keccak256(patchEscrowWord(template, escrow));
}

function minePortal8Hook(opts) {
  const body = opts || {};
  const limit = body.maxTries || 80_000;
  const hookFactory = ethers.getAddress(body.hookFactory);
  const template = ethers.getBytes(body.template);
  const offset = escrowWordOffset(template.length);
  if (offset < 0 || offset + 32 > template.length) {
    throw fail("hook_template", "Portal 8 hook template is shorter than the constructor tail.", 502);
  }
  for (let i = 0; i < 32; i++) {
    if (template[offset + i] !== 0) {
      throw fail("hook_template", "Portal 8 hook template does not have an empty escrow word.", 502);
    }
  }
  const code = template.slice();
  for (let i = 0; i < limit; i++) {
    const hookSalt = ethers.zeroPadValue(ethers.toBeHex(i), 32);
    const escrow = predictEscrowAddress({
      partsFactory: body.partsFactory,
      portal: body.portal,
      creator: body.creator,
      hookSalt,
      escrowInitCodeHash: body.escrowInitCodeHash,
    });
    const word = ethers.getBytes(ethers.zeroPadValue(escrow, 32));
    code.set(word, offset);
    const initCodeHash = ethers.keccak256(code);
    const hook = ethers.getCreate2Address(hookFactory, hookSalt, initCodeHash);
    code.fill(0, offset, offset + 32);
    if ((BigInt(hook) & HOOK_MASK) === HOOK_FLAGS) {
      return {
        hookSalt: hookSalt.toLowerCase(),
        hook: ethers.getAddress(hook),
        escrow: ethers.getAddress(escrow),
        initCodeHash,
        tries: i + 1,
      };
    }
  }
  throw fail("hook_salt", "Could not find a Portal 8 hook address. This agent can still play.", 502);
}

function poolIdFor(token, quote, hook) {
  const launchToken = ethers.getAddress(token);
  const quoteAsset = ethers.getAddress(quote || QUOTE_ASSET);
  const hookAddr = ethers.getAddress(hook);
  const tokenIsToken0 = BigInt(launchToken) < BigInt(quoteAsset);
  const currency0 = tokenIsToken0 ? launchToken : quoteAsset;
  const currency1 = tokenIsToken0 ? quoteAsset : launchToken;
  return {
    poolId: ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint24", "int24", "address"],
      [currency0, currency1, DYNAMIC_FEE, TICK_SPACING, hookAddr],
    )),
    tokenIsToken0,
  };
}

function portal8LaunchTuple(prepared, extra) {
  const row = prepared || {};
  const more = extra || {};
  const payout = ethers.getAddress(more.payout);
  const seed = BigInt(more.seed);
  const alloc = [
    Number(row.creatorBps),
    Number(row.burnBps),
    Number(row.dividendBps),
    Number(row.liquidityBps),
    0,
  ];
  if (alloc.reduce((sum, n) => sum + n, 0) !== SPLIT_BPS) {
    throw fail("allocation", "Creator, burn, dividends, and liquidity must total 100%.", 400);
  }
  const bundle = seed === 0n ? [] : [{
    to: ethers.getAddress(more.recipient || payout),
    amountQuote: seed,
  }];
  return {
    name: row.name,
    symbol: row.symbol,
    totalSupply: BigInt(row.totalSupply),
    buyTaxBps: Number(row.buyTaxBps),
    sellTaxBps: Number(row.sellTaxBps),
    alloc,
    quoteAsset: ethers.getAddress(row.quoteAsset || QUOTE_ASSET),
    payoutAsset: ethers.getAddress(row.quoteAsset || QUOTE_ASSET),
    kothBps: 0,
    payoutAddress: payout,
    identityProvider: ethers.ZeroHash,
    identitySubject: 0n,
    bundle,
    snipeExempt: [],
    meta: {
      imageURI: row.imageURI,
      website: row.website,
      twitter: row.twitter || "",
      telegram: row.telegram || "",
      description: row.description || "",
    },
  };
}

function encodePortal8Launch(prepared, extra) {
  const more = extra || {};
  if (!more.hookSalt) throw fail("hook_salt", "Hook salt is missing.", 500);
  const params = portal8LaunchTuple(prepared, more);
  return {
    params,
    data: portalIface.encodeFunctionData("launch", [params, more.hookSalt]),
  };
}

function encodeSetPayoutSplit(token, house, spectator) {
  const parts = splitParts(house, spectator);
  return {
    parts,
    data: creatorIface.encodeFunctionData("setPayoutSplit", [ethers.getAddress(token), parts]),
  };
}

function receiptOk(status) {
  if (typeof status === "bigint") return status === 1n;
  if (typeof status === "number") return status === 1;
  const text = String(status == null ? "" : status).toLowerCase();
  return text === "0x1" || text === "0x01" || text === "1";
}

function decodePortal8Receipt(receipt, portal) {
  if (!receipt || typeof receipt !== "object") throw fail("no_receipt", "No transaction receipt.", 400);
  if (!receiptOk(receipt.status)) throw fail("tx_failed", "The launch transaction reverted.", 400);
  const portalAddr = ethers.getAddress(portal || PORTAL8);
  if (!isPortal8(portalAddr)) throw fail("wrong_portal", "That transaction was not sent to Portal 8.", 400);
  if (receipt.to && !isPortal8(receipt.to)) throw fail("wrong_portal", "That transaction was not sent to Portal 8.", 400);
  let launched = null;
  for (const log of receipt.logs || []) {
    if (!log || !log.address || !isPortal8(log.address)) continue;
    let parsed;
    try { parsed = portalIface.parseLog(log); } catch { continue; }
    if (parsed && parsed.name === "Launched") launched = parsed;
  }
  if (!launched) throw fail("no_token_created", "The receipt has no Portal 8 Launched event.", 400);
  const token = ethers.getAddress(launched.args.token);
  const creator = ethers.getAddress(launched.args.creator);
  if (receipt.from && !sameAddress(receipt.from, creator)) {
    throw fail("creator_mismatch", "The transaction sender is not the token creator.", 409);
  }
  const hook = ethers.getAddress(launched.args.hook);
  const escrow = ethers.getAddress(launched.args.escrow);
  const pool = poolIdFor(token, QUOTE_ASSET, hook);
  const txHash = ethers.hexlify(receipt.transactionHash);
  return {
    status: "minted",
    portalNumber: 8,
    tokenAddress: token,
    poolId: pool.poolId,
    tokenIsToken0: pool.tokenIsToken0,
    hook,
    locker: ethers.getAddress(launched.args.locker),
    escrow,
    splitter: escrow,
    portal: portalAddr,
    argusUrl: "https://argus.world/token/" + token,
    claimUrl: CLAIM_URL,
    txHash,
    blockHash: receipt.blockHash ? ethers.hexlify(receipt.blockHash) : null,
    creatorWallet: creator,
    payoutWallet: creator,
    positionId: launched.args.positionId.toString(),
    tickStart: Number(launched.args.tickStart),
    tickBond: Number(launched.args.tickBond),
  };
}

function decodeWord(types, data) {
  if (!data || data === "0x") throw fail("eth_call", "Portal 8 did not answer that read.", 502);
  return ethers.AbiCoder.defaultAbiCoder().decode(types, data);
}

function sponsorKit() {
  return require("./sponsor");
}

function scrub(err, secrets, code, message, status, abi) {
  const kit = sponsorKit();
  let detail = kit.describeRevert(err, abi || PORTAL_ABI);
  for (const secret of secrets || []) detail = kit.redact(detail, secret);
  console.warn("argus_portal8", code, detail.slice(0, 220));
  return fail(code, message, status);
}

async function readAddress(transport, to, data) {
  const raw = await transport.call({ to, data });
  return ethers.getAddress(decodeWord(["address"], raw)[0]);
}

async function sendSigned(opts) {
  const body = opts || {};
  const wallet = body.wallet;
  const transport = body.transport;
  const secrets = body.secrets || [];
  const abi = body.abi || PORTAL_ABI;
  const creator = wallet.address;
  const chainId = Number(await transport.chainId());
  if (chainId !== CHAIN_ID) {
    throw fail("wrong_chain", "Server mint is not pointed at Arc mainnet (chain id 5042). This agent can still play.", 502);
  }
  const nonce = Number(await transport.nonce(creator));
  const fees = transport.feeData ? await transport.feeData() : { gasPrice: 1n };
  let gasLimit = BigInt(body.gasFallback || FALLBACK_GAS);
  if (typeof transport.estimateGas === "function") {
    try {
      const est = BigInt(await transport.estimateGas({ from: creator, to: body.to, data: body.data, value: 0n }));
      if (est > 0n) gasLimit = est + (est / 5n) + 50_000n;
    } catch (e) {
      throw scrub(e, secrets, body.rejectCode || "sponsor_rejected", body.rejectMessage, body.rejectStatus || 400, abi);
    }
  }
  if (gasLimit > GAS_CAP) gasLimit = GAS_CAP;
  const tx = {
    to: body.to,
    data: body.data,
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
  let raw;
  try {
    raw = await wallet.signTransaction(tx);
  } catch (e) {
    throw scrub(e, secrets, "sponsor_failed", "Server mint could not sign. This agent can still play.", 502, abi);
  }
  let txHash;
  try {
    txHash = await transport.broadcast(raw);
  } catch (e) {
    throw scrub(e, secrets, "sponsor_failed", "Server mint did not send. This agent can still play.", 502, abi);
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(String(txHash || ""))) {
    throw fail("sponsor_failed", "Server mint did not return a transaction. This agent can still play.", 502);
  }
  return txHash;
}

// Hook escrow salt is msg.sender (the launcher), not the payout address.
async function assemblePortal8Launch(opts) {
  const body = opts || {};
  const prepared = body.prepared;
  const launcher = ethers.getAddress(body.launcher);
  const payout = ethers.getAddress(body.payout);
  const recipient = ethers.getAddress(body.recipient || launcher);
  const transport = body.transport;
  const portal = ethers.getAddress(PORTAL8);
  const creatorRegistry = await readAddress(transport, portal, portalIface.encodeFunctionData("creatorRegistry", []));
  const partsFactory = await readAddress(transport, portal, portalIface.encodeFunctionData("partsFactory", []));
  const hookFactory = await readAddress(transport, portal, portalIface.encodeFunctionData("hookFactory", []));
  const quoteRegistry = await readAddress(transport, portal, portalIface.encodeFunctionData("registry", []));
  if (!sameAddress(creatorRegistry, CREATOR_REGISTRY) || !sameAddress(partsFactory, PARTS_FACTORY) || !sameAddress(hookFactory, HOOK_FACTORY)) {
    throw fail("portal8_pin", "Portal 8 factories do not match the pinned addresses. This agent can still play.", 502);
  }
  const ppmRaw = await transport.call({ to: portal, data: portalIface.encodeFunctionData("minSeedPpm", []) });
  const minSeedPpm = BigInt(decodeWord(["uint32"], ppmRaw)[0]);
  const econRaw = await transport.call({
    to: quoteRegistry,
    data: quoteIface.encodeFunctionData("economicsFor", [QUOTE_ASSET]),
  });
  const econ = decodeWord(["uint128", "uint128", "uint8"], econRaw);
  const seed = openingBuyRaw(econ[1], minSeedPpm);
  const quote = ethers.getAddress(prepared.quoteAsset || QUOTE_ASSET);
  if (!sameAddress(quote, QUOTE_ASSET)) {
    throw fail("quote", "This launch pairs with Arc USDC.", 400);
  }
  const templateRaw = await transport.call({
    to: portal,
    data: portalIface.encodeFunctionData("hookInitCodeTemplate", [quote, prepared.buyTaxBps, prepared.sellTaxBps]),
  });
  const template = decodeWord(["bytes"], templateRaw)[0];
  const hashRaw = await transport.call({
    to: partsFactory,
    data: partsIface.encodeFunctionData("escrowInitCodeHash", [portal]),
  });
  const escrowInitCodeHash = ethers.hexlify(decodeWord(["bytes32"], hashRaw)[0]);
  const mined = minePortal8Hook({
    hookFactory,
    partsFactory,
    portal,
    creator: launcher,
    template,
    escrowInitCodeHash,
    maxTries: body.maxTries,
  });
  const remoteHashRaw = await transport.call({
    to: portal,
    data: portalIface.encodeFunctionData("hookInitCodeHash", [
      launcher,
      mined.hookSalt,
      quote,
      prepared.buyTaxBps,
      prepared.sellTaxBps,
    ]),
  });
  const remoteHash = ethers.hexlify(decodeWord(["bytes32"], remoteHashRaw)[0]);
  if (remoteHash.toLowerCase() !== mined.initCodeHash.toLowerCase()) {
    throw fail("hook_mismatch", "Portal 8 hook hash did not match the miner. This agent can still play.", 502);
  }
  const remoteEscrow = await readAddress(
    transport,
    portal,
    portalIface.encodeFunctionData("predictEscrow", [launcher, mined.hookSalt]),
  );
  if (!sameAddress(remoteEscrow, mined.escrow)) {
    throw fail("hook_mismatch", "Portal 8 escrow address did not match the miner. This agent can still play.", 502);
  }
  const encoded = encodePortal8Launch(prepared, { payout, seed, recipient, hookSalt: mined.hookSalt });
  return { portal, prepared, launcher, payout, recipient, seed, quote, mined, encoded };
}

// House server mint must not assemble a Portal 8 launch. Calling this used to
// approve and spend the opening seed from ARGUS_MINT_KEY. It now refuses
// before any RPC read or broadcast. Spectator launches use prepareSpectatorLaunch.
async function sponsorPortal8() {
  throw fail(
    "house_portal7",
    "House server mint launches on Portal 7 with no opening buy. Spectator launches use Portal 8. This agent can still play.",
    409,
  );
}

// Unsigned Portal 8 launch for a spectator wallet. The house wallet is the
// payout controller. The spectator pays the opening buy and signs launch.
async function prepareSpectatorLaunch(opts) {
  const body = opts || {};
  const kit = sponsorKit();
  const prepared = body.prepared || prepareLaunch(body.params || {});
  if (prepared.devBuyQuote !== 0n) {
    throw fail("dev_buy", "Portal 8 uses the opening buy, not a dev buy. Set the dev buy to zero. This agent can still play.", 400);
  }
  const { houseLaunchProfile } = require("./config");
  const payout = houseWallet((body.payout) || houseLaunchProfile(body.env).creatorFeeWallet);
  const launcher = parseLauncher(body.launcher);
  const spectator = spectatorForLaunch(body.spectatorFeeWallet, launcher, payout);
  const transport = body.transport || await kit.openSponsorTransport(body.env);
  const ownedTransport = !body.transport;
  try {
    const built = await assemblePortal8Launch({
      prepared,
      launcher,
      payout,
      recipient: launcher,
      transport,
      maxTries: body.maxTries,
    });
    return {
      portal: built.portal,
      portalNumber: 8,
      launcher,
      payout,
      spectatorFeeWallet: spectator,
      data: built.encoded.data,
      hook: built.mined.hook,
      escrow: built.mined.escrow,
      hookSalt: built.mined.hookSalt,
      openingBuy: {
        raw: built.seed.toString(),
        quote: built.quote,
        recipient: launcher,
      },
    };
  } catch (e) {
    if (e && e.publicMessage) throw e;
    throw scrub(e, [], "prepare_failed", "Portal 8 could not prepare this launch. This agent can still play.", 502, PORTAL_ABI);
  } finally {
    if (ownedTransport && transport && typeof transport.destroy === "function") {
      try { transport.destroy(); } catch { /* already closed */ }
    }
  }
}

async function readPayoutOf(token, env, transport) {
  const kit = sponsorKit();
  const owned = !transport;
  const live = transport || await kit.openSponsorTransport(env);
  try {
    return await readAddress(live, CREATOR_REGISTRY, creatorIface.encodeFunctionData("payoutOf", [ethers.getAddress(token)]));
  } finally {
    if (owned && live && typeof live.destroy === "function") {
      try { live.destroy(); } catch { /* already closed */ }
    }
  }
}

async function setPayoutSplitTx(opts) {
  const body = opts || {};
  const kit = sponsorKit();
  const parsed = kit.parseMintKey(body.privateKey);
  if (!parsed) {
    throw fail("mint_key_missing", "Server mint is not set up, so the on-chain split was not set. This agent can still play.", 503);
  }
  const secrets = [body.privateKey, parsed.privateKey];
  const house = ethers.getAddress(parsed.address);
  const token = ethers.getAddress(body.token);
  const encoded = encodeSetPayoutSplit(token, house, body.spectatorFeeWallet);
  const transport = body.transport || await kit.openSponsorTransport(body.env);
  const ownedTransport = !body.transport;
  try {
    const payout = await readAddress(transport, CREATOR_REGISTRY, creatorIface.encodeFunctionData("payoutOf", [token]));
    if (!sameAddress(payout, house)) {
      throw fail("not_payout", "The house wallet is not this token's payout address, so it cannot set the split. This agent can still play.", 409);
    }
    const txHash = await sendSigned({
      wallet: new ethers.Wallet(parsed.privateKey),
      transport,
      secrets,
      to: ethers.getAddress(CREATOR_REGISTRY),
      data: encoded.data,
      gasFallback: 400_000n,
      abi: CREATOR_ABI,
      rejectCode: "split_rejected",
      rejectMessage: "Portal 8 did not accept the 50/50 payout split. The token is minted. Set the fee wallet again from the profile.",
      rejectStatus: 400,
    });
    return { txHash, parts: encoded.parts, houseWallet: house, spectatorWallet: ethers.getAddress(body.spectatorFeeWallet) };
  } catch (e) {
    if (e && e.publicMessage) throw e;
    throw scrub(e, secrets, "split_rejected", "Portal 8 did not accept the 50/50 payout split. The token is minted. Set the fee wallet again from the profile.", 400, CREATOR_ABI);
  } finally {
    if (ownedTransport && transport && typeof transport.destroy === "function") {
      try { transport.destroy(); } catch { /* already closed */ }
    }
  }
}

function publicFeeSplit(raw) {
  const split = raw && raw.feeSplit;
  if (!split || typeof split !== "object") return null;
  if (split.status !== "pending" && split.status !== "set") return null;
  const house = checksumOrNull(split.houseWallet);
  if (!house) return null;
  const spectator = checksumOrNull(split.spectatorWallet);
  const txHash = /^0x[0-9a-fA-F]{64}$/.test(String(split.splitTxHash || ""))
    ? String(split.splitTxHash).toLowerCase()
    : null;
  return {
    status: split.status,
    houseBps: HOUSE_SPLIT_BPS,
    creatorBps: CREATOR_SPLIT_BPS,
    houseWallet: house,
    spectatorWallet: spectator,
    splitTxHash: split.status === "set" ? txHash : txHash,
  };
}

module.exports = {
  PORTAL8,
  CREATOR_REGISTRY,
  QUOTE_REGISTRY,
  PARTS_FACTORY,
  HOOK_FACTORY,
  POOL_MANAGER,
  STATE_VIEW,
  QUOTE_ASSET,
  HOOK_FLAGS,
  HOOK_MASK,
  DYNAMIC_FEE,
  TICK_SPACING,
  HOUSE_SPLIT_BPS,
  CREATOR_SPLIT_BPS,
  SPLIT_BPS,
  CLAIM_URL,
  PORTAL_ABI,
  CREATOR_ABI,
  portalIface,
  creatorIface,
  portal8Enabled,
  isPortal8,
  houseWallet,
  parseSpectatorWallet,
  parseLauncher,
  spectatorForLaunch,
  splitParts,
  openingBuyRaw,
  escrowWordOffset,
  predictEscrowAddress,
  patchEscrowWord,
  hookInitCodeHashLocal,
  minePortal8Hook,
  poolIdFor,
  portal8LaunchTuple,
  encodePortal8Launch,
  encodeSetPayoutSplit,
  decodePortal8Receipt,
  sponsorPortal8,
  prepareSpectatorLaunch,
  readPayoutOf,
  setPayoutSplitTx,
  publicFeeSplit,
};
