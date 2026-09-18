// market.js — Native WHO WINS UI backed by a regulated DCM partner.
//
// LDA is NOT the exchange. We do not list, match, clear, or custody
// prediction USDC. We do not run a first-party YES/NO AMM or CLOB.
//
// Partner DCM owns: listing, order book, customer eligibility/KYC,
// collateral, execution, clearing/settlement, reporting/surveillance.
//
// LDA owns: match lifecycle + verifiable oracle (match id, locked config
// hash, winner, timestamp) that the partner may consume.
//
// Integration stubs (until a partner is wired):
//   - embed iframe via DCM_EMBED_URL / PREDICTION_MARKET_URL
//   - approved partner API URL via DCM_API_URL (not called from this process)
// Native UI may show DEMO ¢ prices labeled “awaiting DCM”. Trade CTAs stay
// disabled. We never silently fill a fake custody trade.
// Introducing-broker order routing is not implemented.

const CUSTODY_REFUSAL =
  "LDA does not custody prediction trades. A regulated DCM partner lists, clears, and settles. Native UI is not an LDA exchange.";

function refuseCustodyTrade() {
  const err = new Error(CUSTODY_REFUSAL);
  err.code = "dcm_required";
  throw err;
}

function partnerUrls({ embedUrl, apiUrl } = {}) {
  const embed = String(embedUrl || process.env.DCM_EMBED_URL || process.env.PREDICTION_MARKET_URL || "").trim() || null;
  const api = String(apiUrl || process.env.DCM_API_URL || "").trim() || null;
  return { embed, api };
}

function hash32(s) {
  let h = 2166136261;
  const str = String(s || "");
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Deterministic display-only prices. Labeled demo. Not an order book.
function demoPrices(seats, { matchId } = {}) {
  const list = seats || [];
  if (!list.length) return [];
  const raw = list.map((s, i) => 20 + (hash32(`${matchId || ""}:${s.id}:${i}`) % 60));
  const sum = raw.reduce((a, b) => a + b, 0) || 1;
  const cents = raw.map((r) => Math.round((r / sum) * 100));
  const drift = 100 - cents.reduce((a, b) => a + b, 0);
  cents[cents.length - 1] += drift;
  return list.map((s, i) => ({
    agentId: s.id,
    name: s.name || s.id,
    price: cents[i] / 100,
    cents: cents[i],
    chance: cents[i],
    demo: true,
    label: "DEMO · awaiting DCM",
  }));
}

function dcmListing({
  matchId, tableId, matchNo, seats, lockedConfigHash, oracle = null,
  embedUrl, apiUrl,
} = {}) {
  const urls = partnerUrls({ embedUrl, apiUrl });
  const listed = !!(urls.embed || urls.api);
  const prices = demoPrices(seats, { matchId });
  const whoWins = {
    kind: "who_wins",
    question: `Who wins Match #${matchNo} at ${tableId}?`,
    pricesSumCents: prices.reduce((a, p) => a + p.cents, 0),
    agents: prices,
    demo: !listed,
  };
  const contracts = (seats || []).map((s, i) => ({
    kind: "yesno",
    agentId: s.id,
    name: s.name,
    question: `Will ${s.name} win Match #${matchNo}?`,
    settlement: "$1 notional on the partner DCM (not on LDA)",
    yesCents: prices[i] ? prices[i].cents : null,
    noCents: prices[i] ? 100 - prices[i].cents : null,
    demo: !listed,
  }));
  return {
    matchId, tableId, matchNo, lockedConfigHash,
    venue: listed ? "partner_dcm" : "awaiting_dcm",
    venueLabel: listed ? "Partner DCM" : "Awaiting DCM",
    status: listed ? "listed" : "awaiting_dcm",
    firstParty: false,
    ldaIsTheExchange: false,
    partner: true,
    custody: false,
    ldaDoesNotCustodyBets: true,
    ldaPaysWinnersFromLosers: false,
    noPariMutuelPool: true,
    tokenHoldersDoNotEarn: true,
    introducingBroker: false,
    eligibility: "partner_dcm",
    demo: !listed,
    tradeCta: listed ? "partner" : "disabled",
    message: listed
      ? "Trade on the partner DCM. LDA shows this book but does not hold your collateral or pay winners."
      : "Awaiting DCM — demo prices only. Trade is disabled. LDA does not custody prediction USDC.",
    embed: {
      kind: urls.embed ? "iframe" : (urls.api ? "approved_api" : "stub"),
      url: urls.embed,
      apiUrl: urls.api,
      whiteLabel: false,
      todos: [
        "TODO(dcm): wire approved embed / partner API / white-label once the DCM is contracted",
        "TODO(dcm): do not add introducing-broker order routing without a partner-approved pattern",
        "TODO(dcm): partner owns KYC, geo/eligibility, collateral, matching, clearing, surveillance",
      ],
    },
    oracle: oracle || null,
    whoWins,
    contracts,
    positions: [],
    positionsNote: listed
      ? "Positions live on the partner DCM, not on LDA."
      : "No LDA positions — awaiting DCM.",
  };
}

const marketListing = dcmListing;

module.exports = {
  CUSTODY_REFUSAL, refuseCustodyTrade, partnerUrls, demoPrices, dcmListing, marketListing,
};
