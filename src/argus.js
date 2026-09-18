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
// There is no native “arena / seat bankroll” bucket. That 25% is a second
// creator recipient (the agent’s funding address). Do not fold it into
// the liquidity tax bucket.

const { PUBLIC_BASE_URL } = require("./economics");
const ARGUS_LAUNCH_CONTRACT = "0xa5628a11c412596e1f63b75a2c0284f843c549d6";
const ARGUS_APP = "https://argus.world/";
const ARGUS_TOKEN_CREATED_TOPIC = "0x1d8917231579f8ce39407f0d616f36f357b07329b0ce5164d0754ac15145ce0a";

// Intended split of post-protocol-tax proceeds. Must sum to 1.
const AGENT_TOKEN_ECONOMICS = Object.freeze({
  creatorFunds: 0.30,       // human owner
  holderDividends: 0.35,    // USDC dividends to holders
  arenaSeatBankroll: 0.25,  // extra top-up of the agent's play wallet (does not replace creator funding)
  buybackBurn: 0.10,        // buyback and burn
  liquidityOngoing: 0,      // LP is a one-time launch seed, not a tax slice
});

function assertEconomics(econ = AGENT_TOKEN_ECONOMICS) {
  const sum = econ.creatorFunds + econ.holderDividends + econ.arenaSeatBankroll
    + econ.buybackBurn + econ.liquidityOngoing;
  if (Math.abs(sum - 1) > 1e-9) throw new Error(`token economics must sum to 1, got ${sum}`);
  if (econ.liquidityOngoing !== 0) throw new Error("liquidity must be launch-seed only (ongoing tax 0)");
  return econ;
}

// Four Argus form buckets. Arena seat is NOT liquidity; it rides with creator
// funds and must be split to the seat wallet (splitter or dual recipient).
function toArgusFormAllocation(econ = AGENT_TOKEN_ECONOMICS) {
  assertEconomics(econ);
  const creatorBucket = econ.creatorFunds + econ.arenaSeatBankroll; // 0.55
  return {
    creatorFunds: creatorBucket,
    holderDividends: econ.holderDividends,
    buybackBurn: econ.buybackBurn,
    liquidity: econ.liquidityOngoing,
    creatorSplit: {
      owner: econ.creatorFunds / creatorBucket,           // 30/55
      arenaSeatBankroll: econ.arenaSeatBankroll / creatorBucket, // 25/55
    },
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

// Short on-chain copy. Full 30/35/25/10 economics live in How it works.
function tokenDescription(agent, link) {
  const where = link.absolute ? link.url : link.path;
  return `Liar's Dice Arena agent · watch & bet ${where} #LiarsDiceArena`;
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

// Creator / fee recipient is the human's connected wallet — never the
// agent's seat wallet and never the LDA/dev (house) key.
function assertCreatorWallet(ownerAddress, { seatAddress, deployerAddress, houseAddress } = {}) {
  const creator = normalizeAddress(ownerAddress);
  if (!creator) throw new Error("Creator must be your connected wallet (0x address).");
  const seat = normalizeAddress(seatAddress);
  const house = normalizeAddress(houseAddress) || normalizeAddress(deployerAddress);
  if (seat && creator === seat) throw new Error("Creator wallet must not be the agent's seat wallet.");
  if (house && creator === house) throw new Error("Creator wallet cannot be the arena/house wallet. Connect your own wallet.");
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

const ARENA_LIAR_TOKEN = "0x47c3D4490C1e8B9ed71464e333AD9D5ce7D20790";

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
    creator: spec.recipients?.feeRecipient || spec.recipients?.creator || null,
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

function buildTokenSpec({ agent, seatWallet, ownerAddress, deployerAddress, houseAddress, siteOrigin } = {}) {
  const creator = assertCreatorWallet(ownerAddress, {
    seatAddress: seatWallet?.address,
    deployerAddress,
    houseAddress,
  });
  const econ = assertEconomics(AGENT_TOKEN_ECONOMICS);
  const form = toArgusFormAllocation(econ);
  const deployer = normalizeAddress(deployerAddress) || normalizeAddress(houseAddress);
  const meta = tokenMetadata(agent, { siteOrigin });
  return {
    name: meta.name,
    symbol: meta.symbol,
    agentId: agent.id,
    metadata: meta,
    economics: { ...econ },
    // Native Argus buckets (must sum to 100% on the create form).
    argusAllocation: form,
    recipients: {
      creator,                 // 30% creator funds → connected user
      feeRecipient: creator,   // must never be the LDA/dev wallet
      seatBankroll: seatWallet?.address || null, // 25% — separate play wallet
      deployer: deployer && deployer !== creator ? deployer : null,
    },
    creatorRights: {
      feeRecipient: creator,
      // House key may sponsor gas / factory-deploy. If deployer ≠ creator,
      // set fee recipient (or transfer creator role) to the user in the same flow.
      transferIfDeployerDiffers: !!(deployer && deployer !== creator),
    },
    liquidity: { kind: "launch_seed_only", ongoingTax: false },
    launch: {
      app: ARGUS_APP,
      contract: ARGUS_LAUNCH_CONTRACT,
      tokenCreatedTopic: ARGUS_TOKEN_CREATED_TOPIC,
    },
    // TODO(argus): No public create API/SDK is documented. When Argus ships one,
    // submit buyTax/sellTax in 1–10% and the allocation above. If the form still
    // has a single creator wallet, set it to a 30/25 payment splitter
    // (owner vs seat), NEVER to the liquidity tax bucket.
    todos: [
      "TODO(argus): wallet-connect create on argus.world — no server-side create endpoint published",
      "TODO(argus): single creator wallet → 30/25 splitter (owner vs agent funding address)",
      "TODO(argus): if factory deployer is the house key, set fee recipient / transfer creator to ownerAddress in the same flow — never leave creator as LDA/dev",
      "TODO(argus): confirm buy/sell tax bps against the live create form (cap 10% each)",
      "TODO(argus): confirm create-form keys for description/website/social — terms list names, symbols, images, descriptions, and links; map metadata.argusForm, do not invent twitter/telegram endpoints",
      "TODO(argus): set PUBLIC_BASE_URL so metadata.website is an absolute /agent/<id> deep link",
      "TODO(argus): image is our hosted /api/agents/:id/avatar (generated SVG or upload). If the live create form only accepts a file, the operator must GET this URL and attach it — no Argus image/CDN API is documented",
      "TODO(argus): if Argus later hosts images, POST the same bytes; keep the LDA URL so site cards and token art stay in sync",
      "TODO(argus): 25% arena seat bankroll is an EXTRA top-up of the play wallet when tax is collected — never a substitute for creator deposits",
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

async function onAgentRegistered({ agent, seatWallet, ownerAddress, deployerAddress, houseAddress, siteOrigin, fetchImpl = fetch } = {}) {
  const spec = buildTokenSpec({ agent, seatWallet, ownerAddress, deployerAddress, houseAddress, siteOrigin });
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
  ARENA_LIAR_TOKEN,
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
  quoteMockBuy,
  normalizeAddress,
  assertCreatorWallet,
  buildTokenSpec,
  onAgentRegistered,
};
