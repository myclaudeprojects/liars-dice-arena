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

const ARGUS_LAUNCH_CONTRACT = "0xa5628a11c412596e1f63b75a2c0284f843c549d6";
const ARGUS_APP = "https://argus.world/";
const ARGUS_TOKEN_CREATED_TOPIC = "0x1d8917231579f8ce39407f0d616f36f357b07329b0ce5164d0754ac15145ce0a";

// Intended split of post-protocol-tax proceeds. Must sum to 1.
const AGENT_TOKEN_ECONOMICS = Object.freeze({
  creatorFunds: 0.30,       // human owner
  holderDividends: 0.35,    // USDC dividends to holders
  arenaSeatBankroll: 0.25,  // agent's play money / ante wallet
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
  const base = (letters.slice(0, 8) || "AGENT");
  return base.slice(0, 10);
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
      symbol: "LIAR",
      address: ARENA_LIAR_TOKEN,
      argusUrl: `${ARGUS_APP.replace(/\/$/, "")}/token/${ARENA_LIAR_TOKEN}`,
      inAppSwap: false,
      message: "House agents don't have a personal token. $LIAR is the arena token.",
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
    argusUrl: tokenPageUrl(token),
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

function buildTokenSpec({ agent, seatWallet, ownerAddress }) {
  const econ = assertEconomics(AGENT_TOKEN_ECONOMICS);
  const form = toArgusFormAllocation(econ);
  return {
    name: `${agent.name} (${agent.id})`,
    symbol: tokenSymbol(agent.name, agent.id),
    agentId: agent.id,
    economics: { ...econ },
    // Native Argus buckets (must sum to 100% on the create form).
    argusAllocation: form,
    recipients: {
      creator: ownerAddress || null,
      seatBankroll: seatWallet?.address || null,
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
      "TODO(argus): confirm buy/sell tax bps against the live create form (cap 10% each)",
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

async function onAgentRegistered({ agent, seatWallet, ownerAddress, fetchImpl = fetch } = {}) {
  const spec = buildTokenSpec({ agent, seatWallet, ownerAddress });
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
  publicTokenView,
  tokenContract,
  tokenPageUrl,
  buyView,
  quoteMockBuy,
  buildTokenSpec,
  onAgentRegistered,
};
