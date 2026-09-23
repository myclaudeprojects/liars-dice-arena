const { Show, Records, playExhibit, SAMPLE_FLOOR } = require("../src/showrunner");
const { makePlayer } = require("../src/characters");
const { callSlackLimit } = require("../src/agents");
const { classifyPace } = require("../src/narrative");
const { paceDelay, rollDelay, splitHold, publicEvent, intensityFor } = require("../src/contract");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }
function eq(a, b, m) { if (a !== b) throw new Error((m || "eq") + `: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }

function sequence(log) {
  return log.filter((e) => e.type === "bid" || e.type === "challenge").map((e) => (
    e.type === "bid"
      ? `bid:${e.byId}:${e.count}x${e.face}`
      : `call:${e.challengerId}:${e.bid.count}x${e.bid.face}:${e.bidWasTrue}`
  ));
}

function summarize(logs, id) {
  const steps = [];
  let bluffs = 0, bids = 0, calls = 0, off = 0, wild = 0;
  const mixes = { best: 0, second: 0, count: 0, other: 0 };
  const keptSecond = [];
  for (const log of logs) {
    for (const e of log) {
      if (e.type === "bid" && e.byId === id) {
        bids++;
        if (Number.isFinite(e.step)) steps.push(e.step);
        if (e.bluff) bluffs++;
        if (e.bestFace && e.chosenFace && e.chosenFace !== e.bestFace) off++;
        if (e.wild) wild++;
        if (e.mix === "best" || e.mix === "second" || e.mix === "count") mixes[e.mix]++;
        else mixes.other++;
        if (e.mix === "second" && e.plannedFace === e.chosenFace) keptSecond.push(e);
      }
      if (e.type === "challenge" && e.challengerId === id) calls++;
    }
  }
  const mean = steps.length ? steps.reduce((a, b) => a + b, 0) / steps.length : 0;
  const actions = bids + calls;
  return {
    meanStep: mean,
    challengeRate: actions ? calls / actions : 0,
    bluffRate: bids ? bluffs / bids : 0,
    offBestRate: bids ? off / bids : 0,
    wildRate: bids ? wild / bids : 0,
    bids, calls, steps: steps.length, mixes, keptSecond,
  };
}

function fmt(n) { return n.toFixed(3); }

(async () => {
  const dracula = { id: "dracula", aggression: 0.86 };
  const caesar = { id: "caesar", aggression: 0.22 };
  assert(callSlackLimit(caesar) > callSlackLimit(dracula), "Caesar's call slack is tighter than Dracula's");
  eq(callSlackLimit(dracula), -1 - 0.86, "Dracula keeps -1 - aggression");

  const pair = () => [makePlayer("dracula"), makePlayer("caesar")];
  const origRandom = Math.random;
  Math.random = () => { throw new Error("Math.random in the show path"); };
  let first;
  let second;
  let other;
  try {
    first = await playExhibit({ agents: pair(), seed: 42, sleep: async () => {} });
    second = await playExhibit({ agents: pair(), seed: 42, sleep: async () => {} });
    other = await playExhibit({ agents: pair(), seed: 7, sleep: async () => {} });
  } finally {
    Math.random = origRandom;
  }
  const seqA = sequence(first.log);
  eq(seqA.join("|"), sequence(second.log).join("|"), "seed 42 replays the same bids and calls");
  assert(seqA.join("|") !== sequence(other.log).join("|"), "a different seed can differ");
  assert(first.winnerId === "dracula" || first.winnerId === "caesar", "someone wins");

  const kinds = new Set(first.log.map((e) => e.kind));
  for (const kind of [
    "MATCH_STARTED", "ROUND_STARTED", "DICE_ROLLED", "AGENT_THINKING_STARTED",
    "BID_PLACED", "CALL_MADE", "REVEAL_STARTED", "DICE_REVEALED",
    "ROUND_RESOLVED", "AGENT_REACTED", "MATCH_RESOLVED",
  ]) assert(kinds.has(kind), "log includes " + kind);
  const seqs = first.log.map((e) => e.seq);
  eq(seqs[0], 0, "seq starts at 0");
  eq(seqs[seqs.length - 1], seqs.length - 1, "seq is dense");
  for (let i = 1; i < seqs.length; i++) assert(seqs[i] === seqs[i - 1] + 1, "seq is the order index");
  assert(first.log.some((e) => e.type === "bid" && e.kind === "BID_PLACED"), "legacy bid type stays");
  assert(first.log.some((e) => e.type === "challenge" && e.kind === "ROUND_RESOLVED"), "legacy challenge type stays");
  assert(first.log.some((e) => e.type === "hand_start"), "hand_start stays for replay");

  const rolled = first.log.find((e) => e.kind === "DICE_ROLLED");
  assert(Array.isArray(rolled.hands[0].dice) && rolled.hands[0].dice.length > 0, "authoritative roll keeps faces");
  const pub = publicEvent(rolled);
  assert(!pub.hands[0].dice, "public projection drops hidden faces");
  eq(pub.hands[0].count, rolled.hands[0].dice.length, "public projection keeps the count");
  assert(Array.isArray(rolled.hands[0].dice), "public projection does not mutate the log");
  const revealed = first.log.find((e) => e.kind === "DICE_REVEALED");
  assert(revealed.reveal[0].dice.length > 0, "revealed dice stay public");
  assert(publicEvent(revealed).reveal[0].dice.length > 0, "reveal is not stripped");
  for (const ev of first.log) {
    if (ev.intensity == null) continue;
    assert(ev.intensity >= 1 && ev.intensity <= 5, "intensity is 1-5");
  }
  assert(intensityFor("normal") === 1 && intensityFor("interesting") === 2 && intensityFor("critical") === 3, "bid intensities");
  assert(intensityFor("call") === 4 && intensityFor("reveal", { elimination: true }) === 5 && intensityFor("result") === 5, "show intensities");

  const timings = { turnDelayMs: 900, revealDelayMs: 1500, settleHoldMs: 12000 };
  const clocks = ["normal", "interesting", "critical", "call", "reveal", "result"].map((p) => paceDelay(p, timings));
  eq(new Set(clocks).size, 6, "six pacing states change the clock");
  eq(paceDelay("normal", timings), 900, "normal is the turn delay");
  eq(paceDelay("interesting", timings), 1125, "interesting is a modest multiple");
  eq(paceDelay("critical", timings), 1620, "critical is the longer multiple");
  eq(paceDelay("call", timings), 1170, "call has its own hold");
  eq(paceDelay("reveal", timings), 1500, "reveal is the reveal delay");
  eq(paceDelay("result", timings), 12000, "result is the settle hold");
  eq(rollDelay({ turnDelayMs: 0 }), 0, "a zero turn clock does not add a roll wait");
  eq(rollDelay({ turnDelayMs: 2400 }), 1320, "a hand opens long enough to see the cups");
  const spectator = new Show({ loopEnabled: false });
  eq(spectator.turnDelayMs, 2400, "spectator turn dwell");
  eq(spectator.revealDelayMs, 3600, "spectator reveal dwell");

  const view = {
    table: [{ alive: true, diceCount: 5 }, { alive: true, diceCount: 5 }],
    totalDice: 10,
    currentBid: { count: 3, face: 2 },
  };
  eq(classifyPace(view, { type: "bid", count: 3, face: 4 }), "normal", "routine bid");
  eq(classifyPace(view, { type: "bid", count: 6, face: 2 }), "interesting", "large raise");
  eq(classifyPace(view, { type: "bid", count: 7, face: 2 }), "critical", "huge claim");
  eq(classifyPace(view, { type: "challenge" }), "call", "a call is its own state");
  eq(classifyPace({
    table: [{ alive: true, diceCount: 1 }, { alive: true, diceCount: 4 }],
    totalDice: 5,
  }, { type: "bid", count: 2, face: 3 }), "critical", "one die left is critical");

  const slept = [];
  await playExhibit({
    agents: pair(), seed: 42, turnDelayMs: 900, revealDelayMs: 1500,
    sleep: async (ms) => { slept.push(ms); },
  });
  assert(slept.includes(1170), "the match actually waits on call");
  assert(slept.includes(1500), "the match actually waits on reveal");
  assert(slept.includes(rollDelay({ turnDelayMs: 900 })), "a new hand waits on the roll");
  const bidClock = (pace) => splitHold(paceDelay(pace, { turnDelayMs: 900, revealDelayMs: 1500 }), intensityFor(pace), "bid");
  const bidClocks = ["normal", "interesting", "critical"].map(bidClock);
  assert(bidClocks.every((split) => split.think + split.rest === paceDelay(
    split === bidClocks[0] ? "normal" : split === bidClocks[1] ? "interesting" : "critical",
    { turnDelayMs: 900, revealDelayMs: 1500 },
  )), "bid slices add up");
  assert(bidClocks.some((split) => slept.includes(split.think) && slept.includes(split.rest)), "bids wait on a bid clock");
  let sawInteresting = false;
  const interesting = bidClock("interesting");
  for (let seed = 1; seed <= 12 && !sawInteresting; seed++) {
    const waits = [];
    await playExhibit({
      agents: pair(), seed, turnDelayMs: 900, revealDelayMs: 1500,
      sleep: async (ms) => { waits.push(ms); },
    });
    if (waits.includes(interesting.think) && waits.includes(interesting.rest)) sawInteresting = true;
  }
  assert(sawInteresting, "interesting is not a dead label");

  const dc = [];
  const rm = [];
  for (let seed = 1; seed <= 24; seed++) {
    dc.push((await playExhibit({
      agents: pair(), seed, sleep: async () => {},
    })).log);
    rm.push((await playExhibit({
      agents: [makePlayer("reaper"), makePlayer("monk")], seed, sleep: async () => {},
    })).log);
  }
  const dStat = summarize(dc, "dracula");
  const cStat = summarize(dc, "caesar");
  const rStat = summarize(rm, "reaper");
  console.log("headless decision report (seeds 1-24)");
  console.log("dracula meanStep=" + fmt(dStat.meanStep) + " challengeRate=" + fmt(dStat.challengeRate) + " bluffRate=" + fmt(dStat.bluffRate) + " bids=" + dStat.bids + " calls=" + dStat.calls);
  console.log("caesar  meanStep=" + fmt(cStat.meanStep) + " challengeRate=" + fmt(cStat.challengeRate) + " bluffRate=" + fmt(cStat.bluffRate) + " bids=" + cStat.bids + " calls=" + cStat.calls);
  console.log("reaper  meanStep=" + fmt(rStat.meanStep) + " challengeRate=" + fmt(rStat.challengeRate) + " bluffRate=" + fmt(rStat.bluffRate) + " offBest=" + fmt(rStat.offBestRate) + " wild=" + fmt(rStat.wildRate) + " mix=" + JSON.stringify(rStat.mixes));
  assert(dStat.meanStep > cStat.meanStep, "Dracula's mean bid step exceeds Caesar's");
  assert(dStat.bluffRate > cStat.bluffRate, "Dracula's bluff rate exceeds Caesar's");
  assert(rStat.offBestRate > 0.05 && rStat.offBestRate < 0.75, "Reaper's face is not always best and not a uniform draw");
  assert(rStat.wildRate > 0.4 && rStat.wildRate < 0.85, "Reaper's wild branch tracks chaos");
  assert(rStat.mixes.second > 0 && rStat.mixes.count > 0 && rStat.mixes.other === 0, "Reaper's mix is best, second face, or honest count");
  assert(rStat.keptSecond.length > 0 && rStat.keptSecond.every((e) => e.chosenFace === e.secondFace), "the wild face is the second-best face");

  eq(SAMPLE_FLOOR, 6, "sample floor");
  const loaded = Records.load({
    dracula: { won: 2, lost: 1, played: 3, rivals: { caesar: { wins: 1, losses: 0, meetings: 1 } } },
  }, ["dracula", "caesar"]);
  eq(loaded.get("dracula").won, 2, "old record still loads");
  eq(loaded.get("dracula").bluffAttempts, 0, "new counters default");
  eq(loaded.get("caesar").bidSteps, 0, "missing seat defaults");
  loaded.noteBid("dracula", { count: 4, total: 10, bluff: true, step: 2, opponentId: "caesar" });
  eq(loaded.get("dracula").bluffAttempts, 1, "bluff attempt stored");
  eq(loaded.get("dracula").bidStepSum, 2, "bid step stored");
  eq(loaded.get("dracula").rivals.caesar.bluffAttempts, 1, "opponent bluff bucket");
  eq(loaded.get("dracula").rivals.caesar.wins, 1, "old rivalry wins stay");

  const book = new Show({ loopEnabled: false });
  eq(book.agentDetail("caesar").bluffLine, null, "bluff line hidden under the sample floor");
  eq(book.agentDetail("caesar").callLine, null, "call line hidden under the sample floor");
  for (let i = 0; i < 6; i++) book.records.noteCall("caesar", i < 4, "dracula");
  eq(book.agentDetail("caesar").callLine, "4 of 6 calls were right", "call line quotes stored fields");
  for (let i = 0; i < 6; i++) book.records.noteBid("dracula", { count: 6, total: 8, bluff: true, step: 1, opponentId: "caesar" });
  book.records.noteBluffCaught("dracula");
  book.records.noteBluffCaught("dracula");
  eq(book.agentDetail("dracula").bluffLine, "2 of 6 bluff bids were caught", "bluff line quotes stored fields");
  assert(!/remembers/i.test(JSON.stringify(book.agentDetail("caesar"))), "no invented memory sentence");

  let caller = null;
  let revealSnap = null;
  const show = new Show({
    sleep: async () => {
      const m = show.current;
      if (!m || !m.narrative) return;
      if (m.narrative.headline === "LIAR." && m.bid && m.bid.callerId && !caller) caller = { ...m.bid };
      if (m.reveal && m.narrative.pace === "reveal" && !revealSnap) {
        revealSnap = {
          seats: m.seats.map((s) => ({ id: s.id, dice: s.dice })),
          shown: m.reveal.map((r) => ({ id: r.id, n: r.dice.length })),
        };
      }
    },
    pickWindowMs: 0,
    turnDelayMs: 0,
    revealDelayMs: 0,
    settleHoldMs: 0,
    bootstrapCount: 0,
    loopEnabled: false,
  });
  show.bootstrapDone = true;
  show.openNext();
  await show.playOpen();
  assert(caller && caller.callerId, "live bid carries the caller id");
  assert(caller.callerId !== caller.byId && caller.callerId !== caller.agentId, "caller is not the bidder");
  assert(revealSnap, "reveal snapshot");
  const shown = Object.fromEntries(revealSnap.shown.map((r) => [r.id, r.n]));
  const seated = Object.fromEntries(revealSnap.seats.map((s) => [s.id, s.dice]));
  let dropped = 0;
  for (const id of Object.keys(shown)) {
    if (seated[id] === shown[id] - 1) dropped++;
    else if (seated[id] === 0 && shown[id] === 1) dropped++;
    else assert(seated[id] === shown[id], "seat dice match the reveal or the lost die");
  }
  eq(dropped, 1, "reveal syncs the lost die immediately");

  const waits = [];
  const clock = { turnDelayMs: 100, revealDelayMs: 200, settleHoldMs: 400 };
  const live = new Show({
    loopEnabled: true,
    sleep: async (ms) => {
      waits.push(ms);
      if (ms === clock.settleHoldMs) live.running = false;
    },
    pickWindowMs: 80,
    ...clock,
    bootstrapCount: 0,
  });
  live.bootstrapDone = true;
  live.running = true;
  await live.loop();
  assert(waits.includes(paceDelay("result", clock)), "the result state waits out the settle hold");
  assert(waits.includes(paceDelay("reveal", clock)), "the loop's match waits on reveal");
  assert(waits.includes(paceDelay("call", clock)), "the loop's match waits on call");

  const seen = [];
  const paced = new Show({
    sleep: async (ms) => {
      const cur = paced.current;
      const liveCard = paced.snapshot().live;
      seen.push({
        ms,
        line: cur && cur.narrative && cur.narrative.line,
        thinking: cur && cur.thinking ? cur.thinking.agentId : null,
        reveal: !!(cur && cur.reveal && cur.reveal.length),
        publicThinking: liveCard && liveCard.thinking,
        thought: liveCard && liveCard.thinking && liveCard.thinking.thought,
      });
    },
    pickWindowMs: 0,
    turnDelayMs: 100,
    revealDelayMs: 0,
    settleHoldMs: 0,
    bootstrapCount: 0,
    loopEnabled: false,
  });
  paced.bootstrapDone = true;
  paced.openNext();
  await paced.playOpen();
  const think = seen.find((row) => row.thinking);
  assert(think, "a bid pause shows the actor thinking");
  assert(/is thinking\.$/.test(think.line), "thinking copy names the wait");
  assert(!/remember/i.test(think.line), "thinking copy does not invent a memory");
  assert(think.publicThinking && think.publicThinking.agentId === think.thinking, "the public card names the actor");
  assert(think.thought == null, "the public card does not carry private reasoning");
  const next = seen[seen.indexOf(think) + 1];
  assert(next && /bids /.test(next.line), "the bid is shown after the thinking hold");
  const sums = [100, 125, 180];
  assert(sums.includes(think.ms + next.ms), "thinking plus the bid hold is the existing pace delay");
  assert(seen.filter((row) => row.line && row.line.endsWith("calls.")).every((row) => !row.thinking), "a call is not labeled as thinking");
  const rollAfter = seen.find((row, i) => i > 0 && row.line === "Cups down." && seen[i - 1].line && /TRUTH|BLUFFING/.test(seen[i - 1].line));
  assert(rollAfter && rollAfter.reveal === false && !rollAfter.thinking, "a new hand shows the roll with the cups closed");
  const afterRoll = seen[seen.indexOf(rollAfter) + 1];
  assert(afterRoll && afterRoll.thinking && afterRoll.reveal === false, "thinking starts after the roll");
  const parts = splitHold(900, 1, "bid");
  eq(parts.think + parts.rest, 900, "a routine bid slice adds back up");
  eq(splitHold(1170, 4, "call").think, 0, "the call hold stays whole for the liar sequence");

  console.log("gameplay ok");
})().catch((e) => { console.error(e); process.exit(1); });
