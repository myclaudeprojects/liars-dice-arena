const { soundCues } = require("../public/soundcues");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }
function eq(a, b, m) {
  const left = JSON.stringify(a);
  const right = JSON.stringify(b);
  if (left !== right) throw new Error((m || "eq") + `: ${left} !== ${right}`);
}

const pick = {
  matchId: "m2",
  phase: "pick",
  round: 0,
  bid: null,
  narrative: { headline: null },
  reveal: null,
  market: {},
};

assert(soundCues(null, pick).length === 0, "the first snapshot is silent");
eq(soundCues(pick, pick), [], "an unchanged pick window is silent");

const again = { ...pick, matchId: "m3" };
eq(soundCues(pick, again), ["pick-open"], "a new pick window opens");

const locked = {
  ...pick,
  phase: "live",
  round: 1,
  bid: { agentId: "dracula", name: "Dracula", count: 2, face: 6 },
  narrative: { headline: null, line: "Dracula bids 2 sixes." },
};
eq(soundCues(pick, locked), ["pick-locked", "bid"], "the table locks and the first bid sounds");

const sameBid = { ...locked };
eq(soundCues(locked, sameBid), [], "the same bid does not repeat");

const nextBid = {
  ...locked,
  bid: { agentId: "caesar", name: "Caesar", count: 3, face: 6 },
  narrative: { headline: null },
};
eq(soundCues(locked, nextBid), ["bid"], "a new bid sounds");

const called = {
  ...nextBid,
  narrative: { headline: "LIAR." },
};
eq(soundCues(nextBid, called), ["call"], "LIAR is the call, not another bid");
eq(soundCues(called, called), [], "the call does not repeat");

const revealed = {
  ...called,
  narrative: { headline: "Bluff." },
  reveal: [{ id: "dracula", dice: [6, 6] }, { id: "caesar", dice: [1] }],
};
eq(soundCues(called, revealed), ["reveal"], "dice on the table is a reveal");

const won = {
  ...revealed,
  phase: "settled",
  market: { you: { won: true, settled: true } },
};
eq(soundCues(revealed, won), ["settle-win"], "a winning pick settles up");

const missed = {
  ...revealed,
  phase: "settled",
  market: { you: { won: false, settled: true } },
};
eq(soundCues(revealed, missed), ["settle-miss"], "a missed pick settles down");

const watched = { ...revealed, phase: "settled", market: {} };
eq(soundCues(revealed, watched), [], "watching without a pick is not a miss");

const mid = { ...locked, matchId: "m9" };
eq(soundCues(locked, mid), [], "joining a match already in play stays quiet");

console.log("soundcues ok");
