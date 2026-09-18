const {
  INFLUENCE_IDS, INFLUENCES, INFLUENCE_DECAY_PER_HAND, INFLUENCE_FLOOR,
  assertInfluence, influenceList, InfluenceBook, effectivePlay, influencePrompt,
} = require("../src/influence");

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, m) { if (a !== b) throw new Error((m || "eq") + `: ${a} !== ${b}`); }
function approx(a, b, m) { if (Math.abs(a - b) > 1e-6) throw new Error((m || "approx") + `: ${a} != ${b}`); }

assert(INFLUENCE_IDS.join(",") === "aggressive,calculated,chaos,defensive", "four ids");
assert(influenceList().length === 4, "list");
eq(assertInfluence("Aggressive"), "aggressive", "case");
eq(assertInfluence("CHAOS"), "chaos", "chaos");
let threw = false;
try { assertInfluence("yolo"); } catch (e) { threw = /Pick one influence/.test(e.message); }
assert(threw, "unknown influence");
try { assertInfluence(""); } catch (e) { threw = /Pick one influence/.test(e.message); }
assert(threw, "missing influence");

const book = new InfluenceBook();
const s1 = book.apply("cold-hands", "aggressive", 2);
approx(s1.weights.aggressive, 2, "size-weighted");
eq(s1.dominant, "aggressive", "dominant");
assert(s1.entitlesWinnings === false && s1.toCredits === false && s1.toPrize === false, "no claim");
const s2 = book.apply("cold-hands", "calculated", 1);
approx(s2.weights.aggressive, 2, "kept");
approx(s2.weights.calculated, 1, "added");
eq(s2.dominant, "aggressive", "larger tip still leads");
approx(s2.shares.aggressive, 2 / 3, "share");

const before = book.snapshot("cold-hands").weights.aggressive;
const afterHand = book.decayHand("cold-hands");
approx(afterHand.weights.aggressive, before * INFLUENCE_DECAY_PER_HAND, "decay 0.65");
assert(INFLUENCE_DECAY_PER_HAND === 0.65, "decay constant");

// Floor: tiny leftover zeros so one tip cannot lock forever.
const tiny = new InfluenceBook();
tiny.apply("x", "chaos", INFLUENCE_FLOOR);
tiny.decayHand("x");
eq(tiny.snapshot("x").total, 0, "below floor cleared");
eq(tiny.snapshot("x").dominant, null, "no dominant after fade");

const lockBook = new InfluenceBook();
lockBook.apply("cold-hands", "defensive", 3);
lockBook.freezeAgents(["cold-hands"]);
assert(lockBook.snapshot("cold-hands").locked === true, "frozen flag");
approx(lockBook.snapshot("cold-hands").weights.defensive, 3, "frozen keeps weight");
let lockedApply = false;
try { lockBook.apply("cold-hands", "chaos", 1); } catch (e) { lockedApply = /locked/.test(e.message); }
assert(lockedApply, "no paid influence after freeze");
lockBook.decayHand("cold-hands");
approx(lockBook.snapshot("cold-hands").weights.defensive, 3, "frozen skips decay");
lockBook.thawAgents(["cold-hands"]);
lockBook.resetAgents(["cold-hands"]);
eq(lockBook.snapshot("cold-hands").total, 0, "reset after thaw");

const mid = 0.5;
const none = effectivePlay(0.5, book.snapshot("nobody"), () => mid);
approx(none.aggression, 0.5, "no live influence");
assert(!none.live, "not live");

const aggro = new InfluenceBook();
aggro.apply("a", "aggressive", 5);
const pa = effectivePlay(0.5, aggro.snapshot("a"), () => mid);
assert(pa.aggression > 0.5, "aggressive raises aggression");
assert(pa.challengeEase > 0, "aggressive challenges more");
assert(pa.bidNudge > 0, "aggressive nudges bids up");

const calc = new InfluenceBook();
calc.apply("a", "calculated", 5);
const pc = effectivePlay(0.5, calc.snapshot("a"), () => mid);
assert(pc.aggression < 0.5, "calculated tightens");
assert(pc.bidNudge < 0, "calculated stays honest");

const def = new InfluenceBook();
def.apply("a", "defensive", 5);
const pd = effectivePlay(0.5, def.snapshot("a"), () => mid);
assert(pd.aggression < 0.5, "defensive lowers aggression");
assert(pd.challengeEase < 0, "defensive avoids marginal challenges");

const ch = new InfluenceBook();
ch.apply("a", "chaos", 5);
const pHi = effectivePlay(0.5, ch.snapshot("a"), () => 1);
const pLo = effectivePlay(0.5, ch.snapshot("a"), () => 0);
assert(pHi.aggression !== pLo.aggression, "chaos jitter depends on rng");

const prompt = influencePrompt(aggro.snapshot("a"));
assert(/SPECTATOR INFLUENCE/.test(prompt), "prompt");
assert(/never entitled to winnings/.test(prompt), "prompt no claim");
assert(/Aggressive/.test(prompt), "prompt names lean");
eq(influencePrompt(tiny.snapshot("x")), "", "empty prompt when faded");

assert(INFLUENCES.aggressive.blurb === "Bluff more, challenge more", "copy aggressive");
assert(INFLUENCES.calculated.blurb === "Play tighter / probability-focused", "copy calculated");
assert(INFLUENCES.chaos.blurb === "More unpredictable", "copy chaos");
assert(INFLUENCES.defensive.blurb === "Protect position / avoid marginal challenges", "copy defensive");

console.log("influence ok");
