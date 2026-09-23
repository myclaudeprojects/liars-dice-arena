// LMSR, Arena Credit ledger, and match-winner settlement (§72 MVP).
const fs = require("fs");
const path = require("path");
const { cost, prices, buyCost, sellValue, seedQuantities, DEFAULT_B } = require("../src/lmsr");
const { CreditLedger, LEDGER_TYPES } = require("../src/credits");
const { SimMarket, TEST_BADGE, STARTING_CREDITS } = require("../src/simmarket");
const { Show } = require("../src/showrunner");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }
function eq(a, b, m) { if (a !== b) throw new Error((m || "eq") + `: ${a} !== ${b}`); }
function near(a, b, eps, m) {
  if (Math.abs(a - b) > eps) throw new Error((m || "near") + `: ${a} !~ ${b}`);
}

const agents = [{ id: "dracula", name: "Dracula" }, { id: "caesar", name: "Caesar" }];
const hash = "a".repeat(64);

function fresh(opts) {
  const book = new SimMarket(opts);
  book.openPredictor("predictor1");
  return book;
}

// --- pricing ---
const flat = prices([0, 0], DEFAULT_B);
near(flat[0] + flat[1], 1, 1e-12, "binary prices sum to 1");
near(flat[0], 0.5, 1e-12, "equal q is 50/50");
near(cost([0, 0], DEFAULT_B), DEFAULT_B * Math.log(2), 1e-9, "cost at the origin");

const multi = prices(seedQuantities([0.2, 0.5, 0.3], DEFAULT_B), DEFAULT_B);
near(multi.reduce((s, n) => s + n, 0), 1, 1e-12, "multi-outcome prices sum to 1");
near(multi[1], 0.5, 1e-9, "seeded multi price");

const extreme = prices([1e6, 0, -20], DEFAULT_B);
near(extreme.reduce((s, n) => s + n, 0), 1, 1e-9, "stable prices still sum to 1");
assert(extreme.every((n) => Number.isFinite(n) && n >= 0), "stable prices are finite");
assert(Number.isFinite(cost([1e6, 0], DEFAULT_B)), "cost stays finite");

const book = fresh();
book.createMarket({ matchId: "px", agents, prices: { dracula: 0.5, caesar: 0.5 } });
const spot = book.requireMarket("px").yesPrice;
const bought = book.buy({ matchId: "px", predictorId: "predictor1", agentId: "dracula", side: "yes", shares: 80 });
assert(book.requireMarket("px").yesPrice > spot, "buying YES increases YES");
const held = bought.position.shares;
book.sell({
  matchId: "px", predictorId: "predictor1", outcomeId: "YES", shares: held / 2,
  clientRequestId: "sell-half-1",
});
assert(book.requireMarket("px").yesPrice < bought.market.yesPrice, "selling YES decreases YES");
let shorted = false;
try {
  book.sell({ matchId: "px", predictorId: "predictor1", outcomeId: "YES", shares: held, clientRequestId: "sell-too-many" });
} catch (e) { shorted = e.code === "not_enough_shares"; }
assert(shorted, "no negative share position");
assert(book.positionFor("px", "predictor1").shares > 0, "remaining shares stay positive");

// --- trading ---
const poor = fresh();
poor.requirePredictor("predictor1").credits = 15;
poor.reconcile(poor.requirePredictor("predictor1"));
poor.createMarket({ matchId: "poor", agents });
let broke = false;
try { poor.buy({ matchId: "poor", predictorId: "predictor1", agentId: "dracula", side: "yes", stake: 50 }); }
catch (e) { broke = e.code === "insufficient_credits"; }
assert(broke, "insufficient balance rejected");
eq(poor.ledger.balance("predictor1"), 15, "rejected buy does not move the ledger");

const once = fresh();
once.createMarket({ matchId: "idem", agents });
const first = once.buy({
  matchId: "idem", predictorId: "predictor1", agentId: "dracula", side: "yes", stake: 40,
  clientRequestId: "req-idem-001",
});
const second = once.buy({
  matchId: "idem", predictorId: "predictor1", agentId: "dracula", side: "yes", stake: 40,
  clientRequestId: "req-idem-001",
});
assert(second.duplicate, "duplicate trade is flagged");
eq(second.trade.id, first.trade.id, "duplicate trade request does not double execute");
eq(once.ledger.balance("predictor1"), STARTING_CREDITS - 40, "duplicate leaves the balance");
eq(once.requireMarket("idem").trades.length, 1, "one trade row");

once.lock("idem");
let late = false;
try { once.buy({ matchId: "idem", predictorId: "predictor1", agentId: "caesar", side: "yes", stake: 10 }); }
catch (e) { late = e.code === "market_locked"; }
assert(late, "trade after lock rejected");
let lateSell = false;
try { once.sell({ matchId: "idem", predictorId: "predictor1", outcomeId: "YES", shares: 1, clientRequestId: "sell-locked-1" }); }
catch (e) { lateSell = e.code === "market_locked"; }
assert(lateSell, "sell after lock rejected");

const quoted = fresh({ quoteTtlMs: 0 });
quoted.createMarket({ matchId: "q", agents });
const quote = quoted.quote({ matchId: "q", predictorId: "predictor1", outcomeId: "YES", side: "BUY", shares: 25 });
assert(quote.estimatedCost > 0 && quote.averagePrice > 0, "quote has a server price");
let expired = false;
try {
  quoted.executeQuote({ matchId: "q", predictorId: "predictor1", quoteId: quote.quoteId, clientRequestId: "quote-exec-01" });
} catch (e) { expired = e.code === "quote_expired"; }
assert(expired, "expired quote is rejected");

const liveQuote = fresh();
liveQuote.createMarket({ matchId: "q2", agents });
const q2 = liveQuote.quote({ matchId: "q2", predictorId: "predictor1", outcomeId: "NO", side: "BUY", shares: 30 });
const filled = liveQuote.executeQuote({
  matchId: "q2", predictorId: "predictor1", quoteId: q2.quoteId, clientRequestId: "quote-exec-02",
});
eq(filled.position.outcome, "NO", "quote fills the quoted outcome");
near(filled.trade.costOrCredit, q2.estimatedCost, 0.0001, "fill matches the quote");

const capped = fresh({ maxMarketExposure: 100 });
capped.createMarket({ matchId: "cap", agents });
capped.buy({ matchId: "cap", predictorId: "predictor1", agentId: "dracula", side: "yes", stake: 80 });
let exposed = false;
try { capped.buy({ matchId: "cap", predictorId: "predictor1", agentId: "dracula", side: "yes", stake: 40 }); }
catch (e) { exposed = e.code === "exposure_limit"; }
assert(exposed, "max market exposure rejects the extra buy");

// --- settlement: match winner ---
const win = fresh();
win.createMarket({ matchId: "win", agents, prices: { dracula: 0.58, caesar: 0.42 }, initialProbabilitySource: "historical_model" });
const winBuy = win.buy({ matchId: "win", predictorId: "predictor1", agentId: "dracula", side: "yes", stake: 50 });
assert(Math.abs(win.requireMarket("win").yesPrice + win.requireMarket("win").noPrice - 1) < 1e-9, "market prices sum to 1");
win.onGameEvent({
  type: "MATCH_STARTED",
  eventId: "MATCH_STARTED:win",
  matchId: "win",
  agents: [
    { id: "dracula", version: "cast-v1", aggression: 0.86, chaos: 0.12, archetype: "The Gambler" },
    { id: "caesar", version: "cast-v1", aggression: 0.22, chaos: 0.02, archetype: "The Strategist" },
  ],
});
const frozen = win.inspect("win");
assert(frozen.freeze && frozen.freeze.agents.length === 2, "agent configuration frozen after lock");
assert(frozen.freeze.agents.every((a) => a.configurationHash && a.configurationHash.length === 64), "configuration hash stored");
eq(frozen.freeze.q.YES, win.requireMarket("win").outcomes.YES.q, "q frozen with the lock");
const hashA = frozen.freeze.agents[0].configurationHash;
win.requireMarket("win").freeze.agents[0].aggression = 0.1;
eq(win.inspect("win").freeze.agents[0].configurationHash, hashA, "stored hash does not follow a later edit");
let influence = false;
try { win.applyInfluence("win"); }
catch (e) { influence = e.code === "influence_after_lock"; }
assert(influence, "late influence rejected");
win.onGameEvent({
  type: "MATCH_RESOLVED",
  eventId: "MATCH_RESOLVED:win",
  matchId: "win",
  winnerId: "dracula",
  resultHash: hash,
});
const winPos = win.positionFor("win", "predictor1");
assert(winPos.won && winPos.payout > 0, "winner market pays YES");
eq(winPos.pnlLabel || winPos.pnlLabel, "Test P&L", "pnl is labeled test");
eq(winPos.pnl, winPos.testPnl, "test pnl matches settlement pnl");
eq(win.ledger.balance("predictor1"), win.requirePredictor("predictor1").credits, "balance equals the account");
const beforeDup = win.ledger.entries.length;
const dupEvent = win.onGameEvent({
  type: "MATCH_RESOLVED",
  eventId: "MATCH_RESOLVED:win",
  matchId: "win",
  winnerId: "dracula",
  resultHash: hash,
});
assert(dupEvent.duplicate, "duplicate game event ignored");
eq(win.ledger.entries.length, beforeDup, "duplicate event writes nothing");
eq(win.ledger.balance("predictor1"), STARTING_CREDITS - 50 + winPos.payout, "settlement cannot pay twice");
assert(win.publicMarket(win.requireMarket("win")).b == null, "settled public market hides b");
eq(win.publicMarket(win.requireMarket("win")).badge, TEST_BADGE, "settled badge");

// loser side
const lose = fresh();
lose.openPredictor("predictor2");
lose.createMarket({ matchId: "lose", agents });
lose.buy({ matchId: "lose", predictorId: "predictor2", agentId: "caesar", side: "yes", stake: 20 });
lose.lock("lose");
lose.settle("lose", { winnerId: "dracula", resultHash: hash });
eq(lose.ledger.balance("predictor2"), STARTING_CREDITS - 20, "NO loses the cost basis");
eq(lose.positionFor("lose", "predictor2").payout, 0, "losing shares pay 0");

// --- void ---
const abort = fresh();
abort.createMarket({ matchId: "abort", agents });
abort.buy({ matchId: "abort", predictorId: "predictor1", agentId: "dracula", side: "yes", stake: 60 });
abort.onGameEvent({ type: "MATCH_ABORTED", eventId: "MATCH_ABORTED:abort", matchId: "abort", reason: "match_aborted" });
eq(abort.requireMarket("abort").status, "voided", "canceled match voids");
eq(abort.ledger.balance("predictor1"), STARTING_CREDITS, "void refunds the cost basis");
const entries = abort.ledger.entries.filter((e) => e.userId === "predictor1").map((e) => e.type);
assert(entries.includes("TRADE_BUY") && entries.includes("MARKET_VOID_REFUND"), "void is ledgered");
const againVoid = abort.voidMarket("abort", { reason: "match_aborted" });
eq(againVoid.status, "voided", "void is idempotent");
eq(abort.ledger.balance("predictor1"), STARTING_CREDITS, "void cannot refund twice");
eq(abort.ledger.sum("predictor1"), abort.ledger.balance("predictor1"), "balance equals ledger history");

// settled market is not voided
const stay = fresh();
stay.createMarket({ matchId: "stay", agents });
stay.buy({ matchId: "stay", predictorId: "predictor1", agentId: "dracula", side: "yes", stake: 30 });
stay.lock("stay");
stay.settle("stay", { winnerId: "dracula", resultHash: hash });
const afterWin = stay.ledger.balance("predictor1");
stay.voidMarket("stay", { reason: "too late" });
eq(stay.requireMarket("stay").status, "settled", "a settled market stays settled");
eq(stay.ledger.balance("predictor1"), afterWin, "void does not claw back a settlement");

// --- atomic rollback ---
const atomic = fresh();
atomic.openPredictor("predictor8");
atomic.createMarket({ matchId: "atom", agents });
atomic.buy({ matchId: "atom", predictorId: "predictor1", agentId: "dracula", side: "yes", stake: 25 });
atomic.buy({ matchId: "atom", predictorId: "predictor8", agentId: "dracula", side: "yes", stake: 25 });
atomic.lock("atom");
const bal1 = atomic.ledger.balance("predictor1");
const bal8 = atomic.ledger.balance("predictor8");
atomic.ledger.failOnPost = 2;
let rolled = false;
try { atomic.settle("atom", { winnerId: "dracula", resultHash: hash }); }
catch (e) { rolled = e.code === "forced_failure"; }
assert(rolled, "failed settlement throws");
eq(atomic.requireMarket("atom").status, "locked", "failed settlement rolls the market back");
eq(atomic.ledger.balance("predictor1"), bal1, "failed settlement does not pay the first account");
eq(atomic.ledger.balance("predictor8"), bal8, "failed settlement does not pay the second account");
atomic.settle("atom", { winnerId: "dracula", resultHash: hash });
eq(atomic.requireMarket("atom").status, "settled", "retry after rollback settles once");

// --- ledger types have no cash path ---
for (const banned of ["DEPOSIT", "WITHDRAWAL", "TRANSFER", "USDC"]) {
  assert(!LEDGER_TYPES.includes(banned), "no " + banned + " ledger type");
}
assert(!CreditLedger.prototype.withdraw && !CreditLedger.prototype.deposit && !CreditLedger.prototype.transfer, "no cash methods");

const engineSrc = fs.readFileSync(path.join(__dirname, "..", "src", "engine.js"), "utf8");
assert(!/lmsr|credits|marketservice|simmarket/.test(engineSrc), "dice engine does not import the market");
const appSrc = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
assert(appSrc.includes(TEST_BADGE), "UI carries the test-market badge");
assert(appSrc.includes("data-pick-side"), "UI offers YES and NO");
assert(appSrc.includes("Test P&L"), "UI labels test P&L");
assert(appSrc.includes("Not real earnings"), "settled copy is not a cash claim");

(async () => {
  const quiet = new Show({
    marketsEnabled: false,
    sleep: async () => {},
    pickWindowMs: 0,
    turnDelayMs: 0,
    revealDelayMs: 0,
    settleHoldMs: 0,
    bootstrapCount: 0,
    loopEnabled: false,
  });
  quiet.bootstrapDone = true;
  quiet.openNext();
  assert(!quiet.current.market, "disabled show does not open a book");
  const archived = await quiet.playOpen();
  assert(archived.winnerId && archived.seats.some((s) => s.id === archived.winnerId), "match runs with markets disabled");
  assert(archived.oracle && archived.oracle.realMoney === false && archived.oracle.resultHash, "oracle still records the result");
  eq(quiet.market.predictors.size, 0, "no credits move when markets are off");
  console.log("market ok");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
