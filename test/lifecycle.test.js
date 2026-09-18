const {
  PHASES, matchIdFor, parseMatchId, tipsOpen, assertTipsOpen, marketOpen,
  buildLockedConfig, marketListing, OracleBook, hashPayload,
} = require("../src/lifecycle");

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, m) { if (a !== b) throw new Error((m || "eq") + `: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }

assert(PHASES.includes("crowd") && PHASES.includes("locked") && PHASES.includes("market"), "phases");
eq(matchIdFor("t-1", 12), "lda:t-1:12", "match id");
eq(parseMatchId("lda:t-2:3").tableId, "t-2", "parse");
assert(tipsOpen("crowd") && !tipsOpen("locked") && !tipsOpen("market") && !tipsOpen("playing"), "tips only crowd");
assert(marketOpen("locked") && marketOpen("market") && marketOpen("playing"), "market after lock");
let threw = false;
try { assertTipsOpen("playing"); } catch (e) { threw = /crowd phase/.test(e.message); }
assert(threw, "assertTipsOpen");

const seats = [
  { id: "b", name: "Bravo", owner: "bob", ownerAddress: "0x1", influence: { weights: { aggressive: 1, calculated: 0, chaos: 0, defensive: 0 }, dominant: "aggressive", total: 1 } },
  { id: "a", name: "Alpha", owner: "alice", influence: { weights: { aggressive: 0, calculated: 2, chaos: 0, defensive: 0 }, dominant: "calculated", total: 2 } },
];
const cfg = buildLockedConfig({ tableId: "t-1", matchNo: 4, seats, lockedAt: 1000 });
eq(cfg.matchId, "lda:t-1:4", "cfg id");
assert(cfg.lockedConfigHash && cfg.lockedConfigHash.length === 64, "sha256 hex");
eq(cfg.seats[0].id, "a", "canonical sort");
assert(cfg.tipsOpen === false && cfg.entitlesWinnings === false, "lock flags");
const cfg2 = buildLockedConfig({ tableId: "t-1", matchNo: 4, seats, lockedAt: 1000 });
eq(cfg.lockedConfigHash, cfg2.lockedConfigHash, "hash stable");
assert(hashPayload({ x: 1 }) !== hashPayload({ x: 2 }), "hash changes");

const listing = marketListing({ matchId: cfg.matchId, tableId: "t-1", matchNo: 4, seats: cfg.seats });
eq(listing.status, "awaiting_partner_listing", "stub listing");
assert(listing.custody === false && listing.ldaDoesNotCustodyBets === true, "no custody");
assert(listing.ldaPaysWinnersFromLosers === false, "no lda payout");
assert(listing.contracts.length === 2 && /Will Alpha win Match #4/.test(listing.contracts[0].question), "yesno");
assert(listing.whoWins.agents.length === 2, "who-wins");
assert(!listing.url, "no url until partner");

const book = new OracleBook();
book.recordLock(cfg);
book.recordMarket(cfg.matchId, listing);
const pending = book.get(cfg.matchId);
eq(pending.lockedConfigHash, cfg.lockedConfigHash, "oracle hash");
eq(pending.winnerAgentId, null, "not settled");
const settled = book.settle(cfg.matchId, { winnerAgentId: "a", winnerName: "Alpha", settledAt: 2000 });
eq(settled.winnerAgentId, "a", "winner");
eq(settled.settledAt, 2000, "timestamp");
eq(settled.phase, "settled", "settled phase");
assert(book.list({ tableId: "t-1" }).length === 1, "list");

console.log("lifecycle ok");
