const fs = require("fs");
const path = require("path");
const {
  presentationOf, reactionsOf, roundCall, transition, commandFor, commandKey,
  direct, AnimationDirector, bidWords, pressureLabel, nextHint, broadcastStage, countFace,
  storySource, storyKicker, storyLines, tendencyLines,
} = require("../public/presentation");
const { countShown } = require("../public/motion");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }
function eq(a, b, m) {
  const left = JSON.stringify(a);
  const right = JSON.stringify(b);
  if (left !== right) throw new Error((m || "eq") + `: ${left} !== ${right}`);
}

const seats = [
  { id: "dracula", name: "Dracula", dice: 5, alive: true },
  { id: "caesar", name: "Caesar", dice: 5, alive: true },
];

eq(presentationOf(null).state, "LOADING", "no card yet");
eq(presentationOf({ phase: "pick", seats }).state, "PREDICTION", "pick window");
eq(presentationOf({ phase: "live", seats, bid: null, narrative: {} }).state, "ROLLING", "cups down");
eq(broadcastStage("ROLLING"), "roll", "roll stage");
eq(broadcastStage("THINKING"), "thinking", "think stage");
eq(broadcastStage("BIDDING"), "announce", "bid stage");
eq(broadcastStage("CALL"), "call", "call stage");
eq(broadcastStage("REVEAL"), "reveal", "reveal stage");
eq(broadcastStage("ROUND_RESULT"), "reveal", "round result stays on the reveal");
eq(broadcastStage("MATCH_RESULT"), "result", "match result");

const thinking = {
  phase: "live",
  seats,
  bid: { agentId: "dracula", name: "Dracula", count: 2, face: 6 },
  thinking: { agentId: "caesar", name: "Caesar" },
  narrative: { line: "Caesar is thinking.", intensity: 1 },
  reveal: null,
};
eq(presentationOf(thinking).state, "THINKING", "thinking wins over the previous bid");
eq(presentationOf(thinking).actorId, "caesar", "the actor is the one actually waiting");
eq(reactionsOf(thinking).caesar, "thinking", "thinking reaction");
eq(reactionsOf(thinking).dracula, "confident", "the standing bid stays a commitment");
assert(!Object.values(reactionsOf(thinking)).includes("failed-bluff"), "no bluff label before the dice");

const bid = {
  phase: "live",
  seats,
  bid: { agentId: "dracula", name: "Dracula", count: 6, face: 3 },
  narrative: { intensity: 3, pace: "critical" },
  reveal: null,
};
eq(presentationOf(bid).state, "BIDDING", "bid");
eq(presentationOf(bid).intensity, 3, "bid intensity comes from the event");
eq(presentationOf(bid).focus, "bid", "the bid owns focus");
eq(reactionsOf(bid).dracula, "confident", "a committed bid reads confident");
eq(bidWords(6, 3), "SIX THREES", "bid words");

const call = {
  phase: "live",
  seats,
  bid: { byId: "dracula", agentId: "dracula", name: "Dracula", count: 6, face: 3, callerId: "caesar", callerName: "Caesar" },
  narrative: { headline: "LIAR.", intensity: 4 },
  reveal: null,
};
eq(presentationOf(call).state, "CALL", "liar");
eq(presentationOf(call).intensity, 4, "call intensity");
eq(presentationOf(call).actorId, "caesar", "caller");
eq(reactionsOf(call).caesar, "confident", "the caller has committed, not won yet");
assert(reactionsOf(call).dracula !== "failed-bluff", "the bid is not judged during the call");
eq(nextHint("CALL"), "Next: the dice", "call tells you what happens next");
eq(pressureLabel(4), "Call", "pressure word");

const bluffReveal = {
  phase: "live",
  seats: [
    { id: "dracula", name: "Dracula", dice: 4, alive: true },
    { id: "caesar", name: "Caesar", dice: 5, alive: true },
  ],
  bid: call.bid,
  narrative: { headline: "HE WAS BLUFFING.", intensity: 4, pace: "reveal" },
  reveal: [
    { id: "dracula", dice: [2, 2, 3, 4, 5] },
    { id: "caesar", dice: [6, 1, 2, 3, 4] },
  ],
};
eq(presentationOf(bluffReveal).state, "ROUND_RESULT", "refresh lands on the result, not a blank call");
const bluff = roundCall(bluffReveal);
eq(bluff.actual, countShown(bluffReveal.reveal, 3), "count matches the motion rule");
eq(bluff.verdict, "BLUFF", "short bid");
eq(bluff.winner, "Caesar", "caller wins the round");
eq(reactionsOf(bluffReveal).dracula, "failed-bluff", "failed bluff");
eq(reactionsOf(bluffReveal).caesar, "successful-call", "successful call");

const held = {
  phase: "live",
  seats,
  bid: { byId: "dracula", agentId: "dracula", name: "Dracula", count: 2, face: 6, callerId: "caesar", callerName: "Caesar" },
  narrative: { headline: "HE WAS TELLING THE TRUTH.", intensity: 4 },
  reveal: [
    { id: "dracula", dice: [1, 2, 2, 3, 4] },
    { id: "caesar", dice: [6, 6, 5, 4, 3] },
  ],
};
eq(countFace(held.reveal, 6), 3, "wild one plus two sixes");
eq(roundCall(held).truth, true, "the table covered a thin hand");
eq(reactionsOf(held).dracula, "successful-bluff", "own hand was short, the table held");
eq(reactionsOf(held).caesar, "failed-call", "missed call");

const out = {
  ...bluffReveal,
  seats: [
    { id: "dracula", name: "Dracula", dice: 0, alive: false },
    { id: "caesar", name: "Caesar", dice: 5, alive: true },
  ],
  narrative: { headline: "HE WAS BLUFFING.", intensity: 5 },
};
eq(reactionsOf(out).dracula, "defeat", "elimination reads defeat");
eq(presentationOf(out).intensity, 5, "elimination intensity");

const settled = {
  phase: "settled",
  seats,
  oracle: { winnerId: "caesar" },
  narrative: { intensity: 5 },
};
eq(presentationOf(settled).state, "MATCH_RESULT", "settled");
eq(reactionsOf(settled).caesar, "victory", "winner");
eq(reactionsOf(settled).dracula, "defeat", "loser");

eq(presentationOf(bluffReveal), presentationOf(bluffReveal), "the same card reconstructs the same state");
assert(transition("BIDDING", "CALL").ok, "bid can become a call");
assert(!transition("CALL", "BIDDING").ok, "a call does not step back to a bid");
assert(transition("CALL", "BIDDING", { fastForward: true }).ok, "fast-forward can land on the snapshot");
assert(transition("CALL", "ROUND_RESULT").ok && !transition("CALL", "ROUND_RESULT").skipped, "reveal result is a normal step");

const callCmd = commandFor(call);
eq(callCmd.play, "playCall", "call command");
const callLine = direct(callCmd);
eq(callLine.labels, ["darken", "focus-caller", "liar", "hold"], "liar timeline");
eq(callLine.frameAt(0).label, "darken", "anticipation first");
assert(callLine.frameAt(0).showLiar !== true, "liar type waits");
assert(callLine.frameAt(0).camera !== "caller", "camera waits");
assert(callLine.frameAt(200).camera === "caller", "camera finds the caller");
assert(callLine.frameAt(400).showLiar === true, "liar type");
assert(callLine.frameAt(callLine.fullDuration).done, "hold completes");
eq(direct({ play: "playCall", intensity: 1 }).labels.includes("liar"), false, "a quiet call does not take the full beat");

const quiet = direct(commandFor(bid && { ...bid, narrative: { intensity: 1 } }));
eq(quiet.labels, ["bid"], "routine bid is one beat");
eq(quiet.frameAt(0).camera, "wide", "routine bid does not push the camera");
assert(!quiet.frameAt(0).punch, "routine bid does not punch");
const push = direct({ play: "playBid", intensity: 3 });
eq(push.frameAt(0).camera, "push", "a critical bid gets a small push");

const revealCmd = commandFor(bluffReveal);
eq(revealCmd.play, "playReveal", "reveal command");
const revealLine = direct(revealCmd);
for (const label of ["dice-focus", "tumble", "count", "verdict", "react", "result"]) {
  assert(revealLine.labels.includes(label), "reveal includes " + label);
}
assert(revealLine.frameAt(0).showCount !== true, "count waits until the dice are the focus");
assert(revealLine.frameAt(600).showCount === true, "count");
assert(revealLine.frameAt(900).showVerdict === true, "verdict");
assert(revealLine.frameAt(revealLine.fullDuration).showResult === true, "round result");
const bigger = direct({ play: "playReveal", intensity: 5 });
assert(bigger.fullDuration > direct({ play: "playReveal", intensity: 4 }).fullDuration, "intensity 5 holds the result longer");
const round = direct({ play: "playRoundResult", intensity: 4 });
assert(round.frameAt(round.fullDuration).showResult && round.frameAt(round.fullDuration).showVerdict, "round result command");

const reduced = direct(revealCmd, { reduced: true }).frameAt(0);
assert(reduced.done && reduced.showCount && reduced.showVerdict && reduced.showResult, "reduced motion keeps the result");
eq(reduced.camera, "wide", "reduced motion drops the camera push");
assert(!reduced.tumble, "reduced motion does not tumble");

let now = 0;
const director = new AnimationDirector({ now: () => now });
director.play(callCmd);
eq(director.frame().label, "darken", "director starts at anticipation");
now = 400;
assert(director.frame().showLiar, "director clock advances without a timeout");
const gen = director.generation;
director.cancel();
assert(director.generation !== gen && director.frame() == null, "cancel drops the timeline");
director.play(callCmd);
director.fastForward();
assert(director.frame().done && director.frame().showLiar, "fast-forward reaches the liar hold");
eq(commandKey(callCmd), commandKey(commandFor(call)), "command key is stable");
const rollA = commandFor({ phase: "live", round: 1, seats, bid: null, reveal: null, narrative: {} });
const rollB = commandFor({ phase: "live", round: 2, seats, bid: null, reveal: null, narrative: {} });
eq(rollA.play, "playRoll", "cups down is a roll");
assert(commandKey(rollA) !== commandKey(rollB), "the next hand replays the roll");
assert(direct(rollA).fullDuration >= 1000, "the roll timeline is long enough to watch");
assert(direct(rollA).labels.includes("cup"), "the roll timeline lifts the cup");
assert(direct(callCmd).fullDuration >= 2000, "the liar hold is long enough to read");
assert(direct(revealCmd).fullDuration >= 2400, "settlement outlasts the count");
eq(direct(callCmd).frameAt(400), direct(callCmd).frameAt(400), "the same instant is the same frame");

const thinkCmd = commandFor(thinking);
eq(thinkCmd.play, "playThinking", "thinking command");
assert(!direct(thinkCmd).frameAt(0).showLiar, "thinking is not a liar beat");

const source = fs.readFileSync(path.join(__dirname, "..", "public", "presentation.js"), "utf8");
assert(!source.includes("setTimeout"), "the director does not chain timeouts");
assert(source.includes("class AnimationDirector"), "animation director");
const css = fs.readFileSync(path.join(__dirname, "..", "public", "app.css"), "utf8");
for (const name of [".stage", ".liar-type", ".think-line", ".felt", "thinkPulse"]) {
  assert(css.includes(name), "css " + name);
}
assert(css.includes("prefers-reduced-motion") && css.includes("transform: none"), "reduced motion drops camera transforms");
const app = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
assert(app.includes("data-skip") && app.includes("data-state") && app.includes("syncDirector"), "watch stage is wired to the director");
assert(app.includes("Escape") && app.includes("fastForward") && app.includes("data-reduced"), "skip and reduced motion stay on the stage");
assert(app.includes("Who's got this?") && app.includes("You missed this"), "arena leads with the pick and the last real story");

const card = storySource({
  title: "Caesar called the bluff.",
  dek: "6 threes were not on the table.",
  result: "Caesar wins.",
  keyMoment: "The call on 6 threes.",
  turningPoint: "Caesar was behind on dice.",
  comeback: true,
  calledBluff: true,
  winnerName: "Caesar",
  loserName: "Dracula",
});
eq(storyKicker(card), "Comeback", "comeback leads the card");
eq(storyLines(card), [
  "6 threes were not on the table.",
  "The call on 6 threes.",
  "Caesar was behind on dice.",
], "story lines are the stored facts");
assert(!storyLines(card).some((line) => /viewer|watching|0:42/i.test(line)), "story cards do not invent a clip");
eq(storyKicker(storySource({ calledBluff: true })), "Called the bluff", "bluff flag");
eq(storyKicker(storySource({ toldTruth: true })), "Told the truth", "truth flag");
eq(storyKicker(storySource({})), "", "no kicker without a flag");
eq(storyLines(storySource({ story: { title: "Quiet.", dek: "Same line.", keyMoment: "Same line." } })), ["Same line."], "nested story does not repeat itself");
eq(tendencyLines({
  knownFor: "big claims",
  bluffLine: "2 of 6 bluff bids were caught",
  raiseLine: "Average bid increase 1 over 6 raises",
  edgeLine: null,
}), [
  "From the matches: big claims.",
  "2 of 6 bluff bids were caught.",
  "Average bid increase 1 over 6 raises.",
], "profile quotes stored tendencies");
eq(tendencyLines({}), [], "empty profile adds nothing");
assert(!tendencyLines({ line: "Caesar remembers the last bid" }).some((line) => /remembers/i.test(line)), "persona copy is not a tendency");
assert(app.includes("arena-shell") && app.includes("dice-tray") && app.includes("thought-orbit") && app.includes("liar-overlay"), "broadcast arena markup");
assert(app.includes("scrollHold") && !app.includes("scrollIntoView"), "live updates do not pull the viewport");
assert(css.includes("cupLift") && css.includes("thinkOrbit") && css.includes("translateX(-50%)"), "cups, orbit, and floating nav");

console.log("presentation ok");
