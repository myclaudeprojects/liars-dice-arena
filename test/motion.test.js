const fs = require("fs");
const path = require("path");
const { motionBeats, countShown, replayFrames } = require("../public/motion");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }
function eq(a, b, m) {
  const left = JSON.stringify(a);
  const right = JSON.stringify(b);
  if (left !== right) throw new Error((m || "eq") + `: ${left} !== ${right}`);
}
function types(beats) { return beats.map((b) => b.type); }

const seats = [
  { id: "dracula", name: "Dracula", dice: 5, alive: true },
  { id: "caesar", name: "Caesar", dice: 5, alive: true },
];

const pick = {
  matchId: "m1",
  phase: "pick",
  round: 0,
  seats,
  bid: null,
  narrative: { headline: null },
  reveal: null,
  market: { price: { dracula: 0.5, caesar: 0.5 } },
};

assert(motionBeats(null, pick).length === 0, "the first snapshot is still");
eq(types(motionBeats(pick, pick)), [], "an unchanged pick window is still");

const again = { ...pick, matchId: "m2" };
eq(types(motionBeats(pick, again)), ["intro"], "a new pick window opens");

const dealt = {
  ...pick,
  phase: "live",
  round: 0,
  narrative: { headline: null, line: "Dice are down." },
};
eq(types(motionBeats(pick, dealt)), ["start", "roll"], "match start shakes the cups");

const locked = {
  ...pick,
  phase: "live",
  round: 1,
  bid: { agentId: "dracula", name: "Dracula", count: 2, face: 6 },
  narrative: { headline: null, line: "Dracula bids 2 sixes." },
  market: { price: { dracula: 0.62, caesar: 0.38 } },
};
eq(types(motionBeats(pick, locked)), ["start", "roll", "bid", "price"], "open, roll, bid, and the book");
eq(motionBeats(locked, { ...locked }).length, 0, "the same bid does not replay");

const thinking = {
  ...locked,
  thinking: { agentId: "caesar", name: "Caesar" },
  narrative: { headline: null, line: "Caesar is thinking.", intensity: 1 },
};
const thinkBeat = motionBeats(locked, thinking).find((b) => b.type === "thinking");
assert(thinkBeat && thinkBeat.agentId === "caesar", "a real thinking snapshot is a beat");
eq(types(motionBeats(thinking, thinking)), [], "the same thinking hold does not replay");

const nextBid = {
  ...locked,
  bid: { agentId: "caesar", name: "Caesar", count: 3, face: 6 },
  narrative: { headline: null },
};
const bidBeat = motionBeats(locked, nextBid).find((b) => b.type === "bid");
assert(bidBeat && bidBeat.prevBid && bidBeat.prevBid.count === 2, "the previous bid is kept for the dim");
assert(bidBeat.agentId === "caesar", "current bidder");

const called = {
  ...nextBid,
  narrative: { headline: "LIAR." },
  bid: { byId: "caesar", name: "Dracula", count: 3, face: 6 },
};
eq(types(motionBeats(nextBid, called)), ["call"], "LIAR is a call, not another bid");

const revealed = {
  ...called,
  narrative: { headline: "HE WAS BLUFFING." },
  reveal: [{ id: "dracula", dice: [6, 1, 2] }, { id: "caesar", dice: [6, 3] }],
};
const revealBeat = motionBeats(called, revealed).find((b) => b.type === "reveal");
assert(revealBeat && revealBeat.bidWasTrue === false, "bluff headline");
eq(revealBeat.actual, 3, "ones are wild in the count-up");
eq(countShown(revealed.reveal, 6), 3, "countShown");
eq(countShown(revealed.reveal, 1), 1, "ones are not wild for a ones bid");

const nextHand = {
  ...locked,
  matchId: "m1",
  round: 2,
  seats: [
    { id: "dracula", name: "Dracula", dice: 5, alive: true },
    { id: "caesar", name: "Caesar", dice: 4, alive: true },
  ],
  bid: { agentId: "caesar", name: "Caesar", count: 2, face: 5 },
  reveal: null,
  narrative: { headline: null },
  market: { price: { dracula: 0.7, caesar: 0.3 } },
};
const handBeats = motionBeats(revealed, nextHand);
eq(types(handBeats), ["lose-die", "roll", "bid", "price"], "a lost die, a fresh roll, then the bid");
const loss = handBeats.find((b) => b.type === "lose-die");
eq(loss.id, "caesar", "caesar dropped");
eq(loss.from, 5, "from the reveal count");
eq(loss.to, 4, "one die down");
assert(loss.eliminated === false, "still seated");

const eliminated = {
  ...revealed,
  seats: [
    { id: "dracula", name: "Dracula", dice: 5, alive: true },
    { id: "caesar", name: "Caesar", dice: 0, alive: false },
  ],
};
const out = motionBeats(revealed, eliminated).find((b) => b.type === "lose-die");
assert(out && out.eliminated && out.to === 0, "last die eliminates");

const mid = { ...locked, matchId: "m9" };
eq(motionBeats(locked, mid), [], "joining a match already in play stays still");

const won = {
  ...revealed,
  phase: "settled",
  market: { you: { won: true, pnl: 40 }, price: { dracula: 1, caesar: 0 } },
};
const settle = motionBeats(revealed, won).find((b) => b.type === "settle");
assert(settle && settle.won && settle.picked && settle.pnl === 40, "a winning pick settles");

const watched = { ...revealed, phase: "settled", market: { price: { dracula: 1, caesar: 0 } } };
const quiet = motionBeats(revealed, watched).find((b) => b.type === "settle");
assert(quiet && quiet.picked === false && quiet.won === false, "watching without a pick is not a win");

const frames = replayFrames([
  { type: "hand_start", hand: 1, counts: [{ id: "caesar", dice: 5 }, { id: "dracula", dice: 5 }] },
  { type: "bid", hand: 1, byId: "caesar", name: "Caesar", count: 2, face: 6 },
  { type: "bid", hand: 1, byId: "dracula", name: "Dracula", count: 3, face: 6 },
  {
    type: "challenge",
    hand: 1,
    challengerId: "caesar",
    bidderId: "dracula",
    bidWasTrue: false,
    bid: { count: 3, face: 6 },
    actual: 2,
    loserId: "dracula",
    reveal: [
      { id: "caesar", name: "Caesar", dice: [2, 2, 3, 4, 5] },
      { id: "dracula", name: "Dracula", dice: [1, 6, 6, 3, 4] },
    ],
  },
  { type: "hand_start", hand: 2, counts: [{ id: "caesar", dice: 5 }, { id: "dracula", dice: 4 }] },
  { type: "eliminated", hand: 3, id: "dracula", name: "Dracula" },
  { type: "match_over", hand: 3, winnerId: "caesar", name: "Caesar" },
], { hueOf: (id) => (id === "dracula" ? 0 : 200) });

eq(frames.map((f) => f.kind), ["roll", "bid", "bid", "call", "reveal", "roll", "out", "settle"], "replay follows the log");
eq(frames[0].seats[0].name, "Caesar", "names are known before the first roll");
eq(frames[0].seats[1].hue, 0, "hue lookup");
assert(frames[2].beats[0].prevBid && frames[2].beats[0].prevBid.count === 2, "replay keeps the previous bid");
eq(frames[4].beats[0].actual, 2, "replay reveal count");
assert(frames[4].narrative.headline === "HE WAS BLUFFING.", "replay truth line");
const dropped = frames[5].beats.find((b) => b.type === "lose-die");
assert(dropped && dropped.id === "dracula" && dropped.from === 5 && dropped.to === 4, "replay die loss");
assert(frames[6].beats.some((b) => b.type === "lose-die" && b.eliminated), "replay elimination");
eq(frames[7].narrative.headline, "Caesar wins.", "replay settle");

const css = fs.readFileSync(path.join(__dirname, "..", "public", "app.css"), "utf8");
assert(css.includes("prefers-reduced-motion"), "reduced motion path");
for (const name of ["tumble", "shatter", "slam", "cup"]) {
  assert(css.includes("@keyframes " + name), "keyframe " + name);
}

console.log("motion ok");
