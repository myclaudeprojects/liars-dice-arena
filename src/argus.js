// argus.js — Agent-token launch hook for Argus.world.
//
// Argus is a wallet-connected launchpad on Arc, not a documented public create
// API/SDK. We therefore:
//   1. Record the intended economics on every new agent.
//   2. Optionally POST that spec to an operator webhook (ARGUS_CREATE_URL).
//   3. Leave explicit TODOs for the on-chain create call once Argus publishes
//      a stable interface. We do not invent REST paths or contract calldata.
//
// Argus create-form capabilities (from argus.world/terms, retrieved 2026-09):
//   - Separate buy and sell taxes, each 1%–10%.
//   - After Argus’s 10% protocol share, the remainder is allocated among
//     creator funds, buyback and burn, holder dividends, and liquidity.
//   - Launch seeds a Uniswap pool (one-time LP). Liquidity as an *ongoing*
//     tax slice is a form option — we set it to 0.
// Locked tax: 100% of the post-protocol remainder is Creator. The Argus
// “creator fee recipient” is the LDA fee-router contract (not a raw EOA).
// The router automatically splits 50% platform treasury / 50% persona creator.
// Dividends 0, buyback-and-burn 0, ongoing LP tax 0. No seat-bankroll tax.

const {
  PUBLIC_BASE_URL, PLATFORM_TREASURY, FEE_ROUTER_ADDRESS, LDA_FACTORY_ADDRESS,
  TOKEN_FEE_PLATFORM_BPS, TOKEN_FEE_CREATOR_BPS,
} = require("./economics");
const ARGUS_LAUNCH_CONTRACT = "0xa5628a11c412596e1f63b75a2c0284f843c549d6";
const ARGUS_APP = "https://argus.world/";
const ARGUS_TOKEN_CREATED_TOPIC = "0x1d8917231579f8ce39407f0d616f36f357b07329b0ce5164d0754ac15145ce0a";

// Intended split of post-protocol-tax proceeds. Must sum to 1.
const AGENT_TOKEN_ECONOMICS = Object.freeze({
  creatorFunds: 1,                // 100% Creator → fee router (not a raw EOA)
  holderDividends: 0,
  buybackBurn: 0,
  liquidityOngoing: 0,            // LP is a one-time launch seed, not a tax slice
});

function assertEconomics(econ = AGENT_TOKEN_ECONOMICS) {
  if ((econ.arenaSeatBankroll || 0) !== 0) {
    throw new Error("no arena/seat bankroll tax leg");
  }
  if ((econ.platformPrizeTreasury || 0) !== 0) {
    throw new Error("no prize-treasury tax leg");
  }
  const sum = econ.creatorFunds + econ.holderDividends
    + econ.buybackBurn + econ.liquidityOngoing;
  if (Math.abs(sum - 1) > 1e-9) throw new Error(`token economics must sum to 1, got ${sum}`);
  if (econ.creatorFunds !== 1) throw new Error("ongoing tax must be 100% Creator");
  if (econ.holderDividends !== 0) throw new Error("dividends must be 0%");
  if (econ.buybackBurn !== 0) throw new Error("buyback and burn must be 0%");
  if (econ.liquidityOngoing !== 0) throw new Error("liquidity must be launch-seed only (ongoing tax 0)");
  return econ;
}

// Four Argus form buckets. Closest legal config is 100/0/0/0.
// If the live form requires a non-zero dividends/burn/LP tax, that is a
// launch blocker — do not fill those buckets to “make the form submit”.
function toArgusFormAllocation(econ = AGENT_TOKEN_ECONOMICS) {
  assertEconomics(econ);
  return {
    creatorFunds: econ.creatorFunds,
    holderDividends: econ.holderDividends,
    buybackBurn: econ.buybackBurn,
    liquidity: econ.liquidityOngoing,
    creatorFeeRecipient: "fee_router_contract",
    feeRouter: {
      kind: "automatic",
      notRawEoa: true,
      platformTreasuryBps: TOKEN_FEE_PLATFORM_BPS,
      personaCreatorBps: TOKEN_FEE_CREATOR_BPS,
    },
    blockerIfNonZeroRequired:
      "If Argus UI/API requires a non-zero dividends, buyback, or LP tax bucket, do not allocate. Closest legal config remains 100% Creator → fee router. TODO(argus): confirm zeros are accepted; otherwise this is a launch blocker.",
  };
}

function tokenSymbol(name, id) {
  const letters = String(name || id || "AGENT").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (letters.startsWith("LDA") && letters.length >= 4) return letters.slice(0, 10);
  const rest = (letters || "AGT").slice(0, 7);
  return ("LDA" + rest).slice(0, 10);
}

// Canonical site origin for metadata deep links. Do not guess a production
// domain — set PUBLIC_BASE_URL (or SITE_ORIGIN) to an http(s) origin, no path.
function publicBaseUrl(raw = process.env.PUBLIC_BASE_URL || process.env.SITE_ORIGIN || PUBLIC_BASE_URL) {
  const s = String(raw || "").trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.username || u.password) return null;
    return u.origin;
  } catch {
    return null;
  }
}

function agentDeepLink(agentId, { siteOrigin } = {}) {
  const id = encodeURIComponent(String(agentId || "").trim());
  const path = `/agent/${id}`;
  const tablesPath = `/tables?agent=${id}`;
  const base = publicBaseUrl(siteOrigin !== undefined ? siteOrigin : (process.env.PUBLIC_BASE_URL || process.env.SITE_ORIGIN));
  return {
    path,
    tablesPath,
    url: base ? `${base}${path}` : path,
    absolute: !!base,
  };
}

// Short on-chain copy. Full 100% Creator → 50/50 router economics live in How it works.
function tokenDescription(agent, link) {
  const where = link.absolute ? link.url : link.path;
  return `Liar's Dice Arena agent · watch & tip ${where} #LiarsDiceArena`;
}

function tokenMetadata(agent, { siteOrigin } = {}) {
  const name = String(agent?.name || agent?.id || "Agent").slice(0, 32);
  const symbol = tokenSymbol(name, agent?.id);
  const link = agentDeepLink(agent?.id, { siteOrigin });
  const description = tokenDescription(agent, link);
  const website = link.absolute ? link.url : null;
  const { publicUrl } = require("./avatar");
  const image = agent?.id ? publicUrl(agent.id, agent.avatar, { siteOrigin }) : null;
  return {
    name,
    symbol,
    description,
    website,
    image,
    // Argus terms (retrieved 2026-09): creators supply names, symbols, images,
    // descriptions, and links. No public schema for twitter/telegram — do not
    // invent those APIs. Map website onto "links" / a website slot if present.
    // Image is our hosted avatar URL (generated LDA mark, or an optional upload).
    argusForm: {
      name,
      symbol,
      description,
      image,
      links: website ? [website] : [],
      website,
    },
    deepLink: link,
  };
}

function normalizeAddress(a) {
  const s = String(a || "");
  if (!/^0x[0-9a-fA-F]{40}$/.test(s)) return null;
  return s.toLowerCase();
}

// Persona creator is the human's connected wallet — never the seat, never
// the platform treasury, never the factory/deployment key, never the router.
function assertCreatorWallet(ownerAddress, { seatAddress, deployerAddress, houseAddress, feeRouterAddress, factoryAddress } = {}) {
  const creator = normalizeAddress(ownerAddress);
  if (!creator) throw new Error("Creator must be your connected wallet (0x address).");
  const seat = normalizeAddress(seatAddress);
  const treasury = normalizeAddress(houseAddress) || normalizeAddress(PLATFORM_TREASURY);
  const deployer = normalizeAddress(deployerAddress) || normalizeAddress(factoryAddress);
  const router = normalizeAddress(feeRouterAddress);
  if (seat && creator === seat) throw new Error("Creator wallet must not be the agent's seat wallet.");
  if (treasury && creator === treasury) throw new Error("Creator wallet cannot be the platform treasury. Connect your own wallet.");
  if (deployer && creator === deployer) throw new Error("Creator wallet cannot be the factory deployment key.");
  if (router && creator === router) throw new Error("Creator wallet cannot be the fee router contract.");
  return creator;
}

function publicTokenView(token) {
  if (!token) return null;
  const { webhook, raw, ...rest } = token;
  return rest;
}

function tokenContract(token) {
  const cands = [
    token?.address, token?.contract,
    token?.spec?.address, token?.spec?.contract, token?.spec?.tokenAddress,
  ];
  for (const c of cands) {
    if (typeof c === "string" && /^0x[0-9a-fA-F]{40}$/.test(c)) return c;
  }
  return null;
}

// Real Argus token page when we have a CA; otherwise the known launchpad home.
// Do not invent a swap/buy REST path.
function tokenPageUrl(token) {
  const ca = tokenContract(token);
  const base = ARGUS_APP.replace(/\/$/, "");
  return ca ? `${base}/token/${ca}` : `${base}/`;
}

function tokenTaxLabel() {
  return "100% Creator → fee router (50% platform treasury / 50% persona creator). Dividends 0%. Buyback and burn 0%. LP launch-seed only. No seat-bankroll tax.";
}

function buyView(token, { house = false, name, id } = {}) {
  if (house) {
    return {
      kind: "house",
      agentId: id || null,
      name: name || null,
      symbol: null,
      address: null,
      argusUrl: null,
      inAppSwap: false,
      message: "House agents have no personal token. Open a community agent to see stats, holdings, and its Argus token.",
    };
  }
  const spec = token?.spec || {};
  const address = tokenContract(token);
  return {
    kind: "agent",
    agentId: id || spec.agentId || null,
    status: token?.status || null,
    name: spec.name || name || null,
    symbol: spec.symbol || tokenSymbol(name, id),
    address,
    creator: spec.recipients?.personaCreator || spec.recipients?.creator || null,
    feeRecipient: spec.recipients?.feeRecipient || null,
    feeRecipientKind: spec.recipients?.feeRecipientKind || "fee_router_contract",
    feeRecipientIsRawEoa: false,
    taxLabel: tokenTaxLabel(),
    feeRouter: spec.feeRouter || {
      kind: "automatic",
      split: {
        platformTreasuryBps: TOKEN_FEE_PLATFORM_BPS,
        personaCreatorBps: TOKEN_FEE_CREATOR_BPS,
      },
    },
    argusUrl: tokenPageUrl(token),
    website: spec.metadata?.website || null,
    description: spec.metadata?.description || null,
    image: spec.metadata?.image || (id ? `/api/agents/${encodeURIComponent(id)}/avatar` : null),
    inAppSwap: false,
    economics: spec.economics || { ...AGENT_TOKEN_ECONOMICS },
    message: address
      ? "Buy on Argus. In-app swap waits on a public Argus buy API."
      : "Token spec stored at registration. CA appears here once launched on Argus.",
    todos: ["TODO(argus): in-app swap — no public buy/swap API; deep-link to argus.world"],
  };
}

function quoteMockBuy(amountUsdc, { symbol = "AGENT", rate = 1000 } = {}) {
  const usdcIn = Number(amountUsdc);
  if (!(usdcIn > 0) || !Number.isFinite(usdcIn)) throw new Error("bad_amount");
  const round6 = (x) => Math.round(x * 1e6) / 1e6;
  return {
    mock: true,
    usdcIn: round6(usdcIn),
    tokensOut: round6(usdcIn * rate),
    rate,
    symbol: String(symbol || "AGENT").slice(0, 12),
  };
}

function buildTokenSpec({
  agent, seatWallet, ownerAddress, deployerAddress, houseAddress, siteOrigin,
  feeRouterAddress, factoryAddress,
} = {}) {
  const factory = normalizeAddress(factoryAddress)
    || normalizeAddress(LDA_FACTORY_ADDRESS)
    || normalizeAddress(deployerAddress);
  const router = normalizeAddress(feeRouterAddress) || normalizeAddress(FEE_ROUTER_ADDRESS);
  const treasury = normalizeAddress(houseAddress) || normalizeAddress(PLATFORM_TREASURY);
  const creator = assertCreatorWallet(ownerAddress, {
    seatAddress: seatWallet?.address,
    deployerAddress: factory,
    houseAddress: treasury,
    feeRouterAddress: router,
    factoryAddress: factory,
  });
  const econ = assertEconomics(AGENT_TOKEN_ECONOMICS);
  const form = toArgusFormAllocation(econ);
  const meta = tokenMetadata(agent, { siteOrigin });
  const routerPending = !router;
  return {
    name: meta.name,
    symbol: meta.symbol,
    agentId: agent.id,
    metadata: meta,
    economics: { ...econ },
    argusAllocation: form,
    wallets: {
      deploymentKey: factory,
      platformTreasury: treasury,
      personaCreator: creator,
      feeRouter: router,
    },
    recipients: {
      personaCreator: creator,
      creator, // alias — the human, not the Argus fee field
      platformTreasury: treasury,
      feeRecipient: router, // Argus creator-fee field = router contract, not EOA
      feeRecipientKind: "fee_router_contract",
      feeRecipientIsRawEoa: false,
      factory,
      deployer: factory,
    },
    feeRouter: {
      address: router,
      pending: routerPending,
      kind: "automatic",
      notRawEoa: true,
      split: {
        platformTreasuryBps: TOKEN_FEE_PLATFORM_BPS,
        personaCreatorBps: TOKEN_FEE_CREATOR_BPS,
      },
      note: "Router automatically forwards 50% to platform treasury and 50% to the persona creator wallet. No manual accumulate-then-send.",
    },
    factory: {
      kind: "lda_factory",
      address: factory,
      deploysOnRegister: true,
      feeRecipientIsDeploymentKey: false,
    },
    creatorRights: {
      feeRecipient: router,
      feeRecipientKind: "fee_router_contract",
      personaCreator: creator,
      notRawEoa: true,
    },
    liquidity: { kind: "launch_seed_only", ongoingTax: false },
    launch: {
      app: ARGUS_APP,
      contract: ARGUS_LAUNCH_CONTRACT,
      tokenCreatedTopic: ARGUS_TOKEN_CREATED_TOPIC,
    },
    todos: [
      "TODO(argus): wallet-connect create on argus.world — no server-side create endpoint published",
      "TODO(factory): LDA factory deploys each agent token on register — deployment key is never the fee recipient",
      "TODO(argus): set creator fee recipient to the fee-router CONTRACT, not the persona creator EOA and not the factory/dev key",
      "TODO(chain): deploy automatic 50/50 fee router (platform treasury / persona creator) and set FEE_ROUTER_ADDRESS",
      "TODO(argus): map 100% Creator / 0% dividends / 0% buyback / 0% LP tax onto the create form",
      "TODO(argus): if the form requires a non-zero dividends, burn, or LP tax bucket, that is a launch blocker — closest legal config is still 100% Creator → router; do not fill other buckets",
      "TODO(argus): confirm buy/sell tax bps against the live create form (cap 10% each) — those taxes still feed the 100% Creator remainder after Argus protocol share",
      "TODO(argus): confirm create-form keys for description/website/social — terms list names, symbols, images, descriptions, and links; map metadata.argusForm, do not invent twitter/telegram endpoints",
      "TODO(argus): set PUBLIC_BASE_URL so metadata.website is an absolute /agent/<id> deep link",
      "TODO(argus): image is our hosted /api/agents/:id/avatar (generated SVG or upload). If the live create form only accepts a file, the operator must GET this URL and attach it — no Argus image/CDN API is documented",
      "TODO(argus): if Argus later hosts images, POST the same bytes; keep the LDA URL so site cards and token art stay in sync",
    ],
  };
}

async function postOperatorWebhook(spec, { url, timeoutMs = 8000, fetchImpl = fetch } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "agent_token_spec", spec }),
      redirect: "error",
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`webhook HTTP ${r.status}: ${text.slice(0, 180)}`);
    let body = text;
    try { body = JSON.parse(text); } catch { /* keep text */ }
    return { ok: true, body };
  } finally { clearTimeout(t); }
}

async function onAgentRegistered({
  agent, seatWallet, ownerAddress, deployerAddress, houseAddress, siteOrigin,
  feeRouterAddress, factoryAddress, fetchImpl = fetch,
} = {}) {
  const spec = buildTokenSpec({
    agent, seatWallet, ownerAddress, deployerAddress, houseAddress, siteOrigin,
    feeRouterAddress, factoryAddress,
  });
  const url = process.env.ARGUS_CREATE_URL || "";
  if (!url) {
    return {
      status: "pending_manual_launch",
      spec,
      message: "Argus has no public create API; open argus.world with this spec or set ARGUS_CREATE_URL to an operator webhook.",
    };
  }
  // Operator webhook only — not an Argus URL we invented.
  try {
    const posted = await postOperatorWebhook(spec, { url, fetchImpl });
    return { status: "webhook_posted", spec, webhook: posted.body };
  } catch (e) {
    return { status: "webhook_failed", spec, error: String(e.message || e).slice(0, 240) };
  }
}

module.exports = {
  ARGUS_LAUNCH_CONTRACT,
  ARGUS_APP,
  AGENT_TOKEN_ECONOMICS,
  assertEconomics,
  toArgusFormAllocation,
  tokenSymbol,
  publicBaseUrl,
  agentDeepLink,
  tokenMetadata,
  publicTokenView,
  tokenContract,
  tokenPageUrl,
  buyView,
  tokenTaxLabel,
  quoteMockBuy,
  normalizeAddress,
  assertCreatorWallet,
  buildTokenSpec,
  onAgentRegistered,
};
