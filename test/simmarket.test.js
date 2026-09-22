const {
  SimMarket, pricesFromRecords, pricesFromDice, STARTING_CREDITS, ERROR_TEXT,
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
const buy = book.buy({ matchId: "m1", predictorId: "predictor1", agentId: "dracula", side: "yes", stake: 100 });
eq(buy.position.contracts, 250, "100 / 0.40");
eq(buy.credits, STARTING_CREDITS - 100, "debited");

threw = false;
try { book.buy({ matchId: "m1", predictorId: "predictor1", agentId: "caesar", side: "yes", stake: 50 }); }
catch (e) { threw = e.code === "already_picked"; }
assert(threw, "one pick");

book.lock("m1");
threw = false;
try { book.buy({ matchId: "m1", predictorId: "predictor1", agentId: "caesar", side: "no", stake: 50 }); }
catch (e) { threw = e.code === "market_locked"; }
assert(threw, "locked");

book.mark("m1", { dracula: 0.7, caesar: 0.3 });
const mtm = book.positionFor("m1", "predictor1");
eq(mtm.value, 175, "250 * 0.70");
eq(mtm.unrealized, 75, "up 75");

const hash = "a".repeat(64);
const settled = book.settle("m1", { winnerId: "dracula", resultHash: hash });
eq(settled.status, "settled", "settled");
eq(book.requirePredictor("predictor1").credits, STARTING_CREDITS - 100 + 250, "paid 1 per contract");
eq(book.requirePredictor("predictor1").streak, 1, "streak");
const again = book.settle("m1", { winnerId: "dracula", resultHash: hash });
eq(again.status, "settled", "idempotent");
eq(book.requirePredictor("predictor1").credits, STARTING_CREDITS - 100 + 250, "no double pay");

threw = false;
try { book.settle("m1", { winnerId: "caesar", resultHash: "b".repeat(64) }); }
catch (e) { threw = e.code === "result_conflict"; }
assert(threw, "conflict");

const book2 = new SimMarket();
book2.openPredictor("predictor2");
book2.createMarket({ matchId: "m2", agents, prices: { dracula: 0.25, caesar: 0.75 } });
book2.buy({ matchId: "m2", predictorId: "predictor2", agentId: "dracula", side: "no", stake: 75 });
const noPx = book2.positionFor("m2", "predictor2");
eq(noPx.contracts, 100, "75 / 0.75");
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

console.log("simmarket ok");
