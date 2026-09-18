const { dcmListing, demoPrices, refuseCustodyTrade, CUSTODY_REFUSAL } = require("../src/market");

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, m) { if (a !== b) throw new Error((m || "eq") + `: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }

const seats = [
  { id: "a", name: "Alpha" },
  { id: "b", name: "Bravo" },
  { id: "c", name: "Charlie" },
];
const px = demoPrices(seats, { matchId: "lda:t-1:1" });
eq(px.length, 3, "three legs");
eq(px.reduce((s, p) => s + p.cents, 0), 100, "sum 100¢");
assert(px.every((p) => p.demo === true), "demo flag");
const px2 = demoPrices(seats, { matchId: "lda:t-1:1" });
eq(px[0].cents, px2[0].cents, "deterministic");

const listing = dcmListing({ matchId: "lda:t-1:1", tableId: "t-1", matchNo: 1, seats, lockedConfigHash: "abc" });
eq(listing.status, "awaiting_dcm", "awaiting");
assert(listing.custody === false, "no custody");
assert(listing.ldaIsTheExchange === false, "not the exchange");
assert(listing.introducingBroker === false, "no IB routing");
eq(listing.tradeCta, "disabled", "disabled cta");
assert(/awaiting DCM/i.test(listing.message), "labeled awaiting");
assert(!listing.whoWins.agents.some((a) => !a.demo), "prices labeled demo");

let threw = false;
try { refuseCustodyTrade(); } catch (e) {
  threw = e.message === CUSTODY_REFUSAL && e.code === "dcm_required";
}
assert(threw, "refuse custody");

assert(!/lmsr/i.test(JSON.stringify(listing)), "no LMSR in listing");
assert(!listing.vaultUsdc, "no vault");

console.log("market ok");
