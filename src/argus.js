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
  AGENT_TOKEN_ECONOMICS,
  assertEconomics,
  toArgusFormAllocation,
  tokenSymbol,
  publicTokenView,
  buildTokenSpec,
  onAgentRegistered,
};
