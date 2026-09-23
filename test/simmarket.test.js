const {
  SimMarket, pricesFromRecords, pricesFromDice, STARTING_CREDITS, CAREER_CAP, ERROR_TEXT, round4, TEST_BADGE,
} = require("../src/simmarket");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }
function eq(a, b, m) { if (a !== b) throw new Error((m || "eq") + `: ${a} !== ${b}`); }

const book = new SimMarket();
const me = book.openPredictor("predictor1");
eq(me.credits, STARTING_CREDITS, "grant");
eq(me.cashValue, 0, "no cash value");
assert(book.openPredictor("predictor1").credits === STARTING_CREDITS, "no double grant");

let threw = false;
try { book.openPredictor("no"); } catch (e) { threw = e.code === "bad_predictor"; }
assert(threw, "short id rejected");

const agents = [{ id: "dracula", name: "Dracula" }, { id: "caesar", name: "Caesar" }];
book.createMarket({ matchId: "m1", agents, prices: { dracula: 0.4, caesar: 0.6 } });
const beforeYes = book.requireMarket("m1").yesPrice;
const buy = book.buy({ matchId: "m1", predictorId: "predictor1", agentId: "dracula", side: "yes", stake: 100 });
assert(buy.position.contracts > 100, "stake buys more than 100 shares when price is under 1");
eq(buy.position.stake, 100, "budget is the debit");
eq(buy.credits, STARTING_CREDITS - 100, "debited");
assert(book.requireMarket("m1").yesPrice > beforeYes, "buying YES lifts YES");
assert(book.publicMarket(book.requireMarket("m1")).b == null, "b stays off the public book");
eq(book.publicMarket(book.requireMarket("m1")).badge, TEST_BADGE, "test badge");

const added = book.buy({ matchId: "m1", predictorId: "predictor1", agentId: "dracula", side: "yes", stake: 10 });
assert(added.position.shares > buy.position.shares, "a second buy adds shares");

book.lock("m1");
threw = false;
try { book.buy({ matchId: "m1", predictorId: "predictor1", agentId: "caesar", side: "no", stake: 50 }); }
catch (e) { threw = e.code === "market_locked"; }
assert(threw, "locked");

const marked = book.positionFor("m1", "predictor1");
book.mark("m1", { dracula: 0.7, caesar: 0.3 });
const mtm = book.positionFor("m1", "predictor1");
eq(mtm.value, marked.value, "dice do not reprice a locked book");
eq(mtm.stake, 110, "both buys are the cost basis");

const hash = "a".repeat(64);
const settled = book.settle("m1", { winnerId: "dracula", resultHash: hash });
eq(settled.status, "settled", "settled");
const settledPos = book.positionFor("m1", "predictor1");
const paid = round4(STARTING_CREDITS - 110 + settledPos.payout);
eq(book.requirePredictor("predictor1").credits, paid, "paid 1 per winning share");
eq(book.requirePredictor("predictor1").streak, 1, "streak");
const again = book.settle("m1", { winnerId: "dracula", resultHash: hash });
eq(again.status, "settled", "idempotent");
eq(book.requirePredictor("predictor1").credits, paid, "no double pay");

threw = false;
try { book.settle("m1", { winnerId: "caesar", resultHash: "b".repeat(64) }); }
catch (e) { threw = e.code === "result_conflict"; }
assert(threw, "conflict");

const book2 = new SimMarket();
book2.openPredictor("predictor2");
book2.createMarket({ matchId: "m2", agents, prices: { dracula: 0.25, caesar: 0.75 } });
book2.buy({ matchId: "m2", predictorId: "predictor2", agentId: "dracula", side: "no", stake: 75 });
const noPx = book2.positionFor("m2", "predictor2");
eq(noPx.stake, 75, "no stake is the debit");
eq(noPx.outcome, "NO", "no on the target is the NO contract");
book2.lock("m2");
threw = false;
try { book2.settle("m2", { winnerId: "dracula", resultHash: "short" }); }
catch (e) { threw = e.code === "bad_result"; }
assert(threw, "hash required");
book2.settle("m2", { winnerId: "dracula", resultHash: "c".repeat(64) });
eq(book2.requirePredictor("predictor2").credits, STARTING_CREDITS - 75, "no loses, stake gone");
eq(book2.leaderboard()[0].pnl, -75, "leaderboard pnl");

const priced = pricesFromRecords(["dracula", "caesar"], (id) => id === "dracula" ? { won: 6, lost: 2 } : { won: 2, lost: 6 });
assert(Math.abs(priced.dracula + priced.caesar - 1) < 1e-9, "record prices sum 1");
assert(priced.dracula > priced.caesar, "better record is shorter price");
const live = pricesFromDice(["dracula", "caesar"], (id) => id === "dracula" ? 4 : 1, { dracula: 0.5, caesar: 0.5 });
assert(live.dracula > live.caesar, "more dice, higher price");
assert(Math.abs(live.dracula + live.caesar - 1) < 1e-9, "live prices sum 1");

threw = false;
try {
  const b3 = new SimMarket();
  b3.openPredictor("predictor3");
  b3.createMarket({ matchId: "m3", agents, prices: { dracula: 0.5, caesar: 0.5 } });
  b3.buy({ matchId: "m3", predictorId: "predictor3", agentId: "dracula", side: "yes", stake: 5000 });
} catch (e) { threw = e.code === "stake_out_of_range"; }
assert(threw, "stake cap");
assert(ERROR_TEXT.market_locked, "human copy");

const firstPub = book.openPredictor("predictor1");
eq(firstPub.series.length, 1, "win is one career point");
eq(firstPub.series[0].matchId, "m1", "career point names the match");
eq(firstPub.series[0].won, true, "win marked");
eq(firstPub.series[0].cum, firstPub.pnl, "first cum is total pnl");
eq(firstPub.cashValue, 0, "career view still has no cash value");
book.settle("m1", { winnerId: "dracula", resultHash: hash });
eq(book.openPredictor("predictor1").series.length, 1, "idempotent settle does not append");

book.createMarket({ matchId: "m4", agents, prices: { dracula: 0.5, caesar: 0.5 } });
book.buy({ matchId: "m4", predictorId: "predictor1", agentId: "caesar", side: "yes", stake: 50 });
book.lock("m4");
book.settle("m4", { winnerId: "dracula", resultHash: "d".repeat(64) });
const two = book.openPredictor("predictor1");
eq(two.series.length, 2, "loss adds a second point");
eq(two.series[1].won, false, "loss marked");
let run = 0;
for (const point of two.series) {
  run = Math.round((run + point.pnl) * 10000) / 10000;
  eq(point.cum, run, "cum is the running pnl");
}
eq(two.series[1].cum, two.pnl, "last cum is total pnl");
eq(book.requirePredictor("predictor1").settled.length, 2, "raw book keeps both points");

const restored = new SimMarket();
restored.importState(book.exportState());
const back = restored.openPredictor("predictor1");
eq(back.series.length, 2, "series survives export");
eq(back.series[1].cum, two.pnl, "imported cum matches");
eq(back.cashValue, 0, "imported book still worthless");
eq(back.pnl, restored.requirePredictor("predictor1").pnl, "public pnl matches the stored book");

const old = new SimMarket();
old.importState({
  predictors: [{ id: "predictor8", credits: 900, granted: 1000, picks: 1, correct: 1, streak: 1, bestStreak: 1, pnl: 12, theories: {} }],
  markets: [],
});
const legacy = old.openPredictor("predictor8");
eq(legacy.series.length, 0, "picks settled before the series stay a total, not invented points");
eq(legacy.pnl, 12, "old total pnl remains");
eq(legacy.cashValue, 0, "old book still worthless");

eq(CAREER_CAP, 100, "career chart keeps 100 settled picks");
const capBook = new SimMarket();
capBook.openPredictor("predictor9");
capBook.requirePredictor("predictor9").credits = 5000;
for (let i = 0; i < 102; i++) {
  const id = "cap" + i;
  if (i % 10 === 0) capBook.buysAt.delete("predictor9");
  capBook.createMarket({ matchId: id, agents, prices: { dracula: 0.5, caesar: 0.5 } });
  capBook.buy({ matchId: id, predictorId: "predictor9", agentId: "caesar", side: "yes", stake: 10 });
  capBook.lock(id);
  capBook.settle(id, { winnerId: "dracula", resultHash: "e".repeat(64) });
}
eq(capBook.requirePredictor("predictor9").settled.length, 100, "career series caps at 100");
eq(capBook.openPredictor("predictor9").series[0].matchId, "cap2", "oldest points drop first");
eq(capBook.openPredictor("predictor9").cashValue, 0, "capped book still worthless");

const limited = new SimMarket();
limited.openPredictor("predictor7");
for (let i = 0; i < 12; i++) {
  const id = "rate" + i;
  limited.createMarket({ matchId: id, agents, prices: { dracula: 0.5, caesar: 0.5 } });
  limited.buy({ matchId: id, predictorId: "predictor7", agentId: "caesar", side: "yes", stake: 10 });
}
const dumped = limited.exportState();
eq(dumped.buysAt.predictor7.length, 12, "buy window is in the book export");
const resumed = new SimMarket();
resumed.importState(dumped);
resumed.createMarket({ matchId: "rate12", agents, prices: { dracula: 0.5, caesar: 0.5 } });
let slowed = false;
try {
  resumed.buy({ matchId: "rate12", predictorId: "predictor7", agentId: "caesar", side: "yes", stake: 10 });
} catch (e) { slowed = e.code === "slow_down"; }
assert(slowed, "imported window still enforces slow_down");
eq(resumed.openPredictor("predictor7").cashValue, 0, "rate-limited book still worthless");

const stale = new SimMarket();
stale.importState({
  predictors: [{ id: "predictor6", credits: 1000, granted: 1000, picks: 0, correct: 0, streak: 0, bestStreak: 0, pnl: 0, settled: [], theories: {} }],
  markets: [],
  buysAt: { predictor6: [Date.now() - 120000, "nope", Date.now() - 90000] },
});
stale.createMarket({ matchId: "fresh", agents, prices: { dracula: 0.5, caesar: 0.5 } });
stale.buy({ matchId: "fresh", predictorId: "predictor6", agentId: "caesar", side: "yes", stake: 10 });
eq(stale.buysAt.get("predictor6").length, 1, "stale stamps do not block a new buy");

console.log("simmarket ok");
