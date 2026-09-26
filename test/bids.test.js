const { Match, bidAllowed } = require("../src/engine");
const { parseAction, gatePersonalClaim, MockAgent } = require("../src/agents");
const { Show, playExhibit } = require("../src/showrunner");
const { makePlayer } = require("../src/characters");
const { validateAndReplay } = require("../src/eventlog");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }
function eq(a, b, m) { if (a !== b) throw new Error((m || "eq") + `: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }

const view = {
  you: { id: "a", name: "A", dice: [6, 6, 1] },
  table: [
    { id: "a", name: "A", diceCount: 3, alive: true },
    { id: "b", name: "B", diceCount: 2, alive: true },
  ],
  totalDice: 5,
  currentBid: { count: 2, face: 3, byId: "b" },
  onesWild: true,
  whoseTurn: "a",
};

assert(bidAllowed(null, 3, 6, 5), "a table bid may exceed the bidder's own dice");
assert(!bidAllowed(view.currentBid, 6, 6, 5), "a bid cannot exceed dice still in play");
assert(!bidAllowed(view.currentBid, 3, 9, 5), "face stays on the die");
assert(!bidAllowed(view.currentBid, 2.5, 6, 5), "quantity is an integer");
assert(bidAllowed({ count: 5, face: 4 }, 5, 5, 5), "same count, higher face, at the table size");
assert(!bidAllowed({ count: 5, face: 6 }, 5, 6, 5), "nothing is higher once every die is claimed at sixes");

const kept = parseAction(JSON.stringify({
  thought: "Holding 2 6s. The table can stand 4.",
  action: { type: "bid", count: 4, face: 6 },
}), view);
assert(kept && kept.action.count === 4 && kept.action.face === 6, "parser keeps a legal table bid above the cup");
assert(/Holding 2 6s/.test(kept.thought), "a true personal count stays");

const invented = parseAction(JSON.stringify({
  thought: "I have 9 sixes. Holding 8 6s and I only really have 7.",
  action: { type: "bid", count: 4, face: 6 },
}), view);
assert(invented, "the table bid itself is legal");
assert(!/\b9\b/.test(invented.thought), "nine is more sixes than dice in the cup");
assert(!/Holding 8/.test(invented.thought), "holding eight is rewritten");
assert(!/really have 7/.test(invented.thought), "the bluff line cannot invent dice");
assert(/no more than 3 dice/.test(invented.thought), "the rewrite states the real ceiling");
eq(parseAction(JSON.stringify({
  thought: "all of them",
  action: { type: "bid", count: 9, face: 6 },
}), view), null, "parser rejects a quantity above the table");

eq(gatePersonalClaim("Pushing 6×3 to pressure them.", 2), "Pushing 6×3 to pressure them.", "a table bid is not a personal count");

const m = new Match({ seats: [{ id: "a", name: "A" }, { id: "b", name: "B" }], seed: 3, diceCount: 2 });
const open = m.applyAction({ type: "bid", count: 5, face: 6 });
assert(!open.ok && open.error === "bid_exceeds_total_dice", "engine rejects an opening bid past the table");
assert(m.applyAction({ type: "bid", count: 3, face: 2 }).ok, "three is legal when each seat has two");
const seatDice = m.players.map((p) => p.dice.length);
assert(seatDice.every((n) => n === 2) && 3 > 2, "that bid is above either cup");

// Climb to the ceiling, then lose a die. The old total is no longer a legal bid.
const late = new Match({ seats: [{ id: "a", name: "A" }, { id: "b", name: "B" }], seed: 9, diceCount: 2 });
const before = late.totalDice();
assert(late.applyAction({ type: "bid", count: before, face: 6 }).ok, "every die on the table");
const called = late.applyAction({ type: "challenge" });
assert(called.ok && called.resolved && !called.matchOver, "the call drops one die and the match continues");
eq(late.totalDice(), before - 1, "exactly one die left the table");
const tooHigh = late.applyAction({ type: "bid", count: before, face: 2 });
assert(!tooHigh.ok && tooHigh.error === "bid_exceeds_total_dice", "the pre-loss quantity is illegal on the next hand");
assert(late.applyAction({ type: "bid", count: before - 1, face: 2 }).ok, "the new total still fits");

(async () => {
  const mouths = [];
  class Loud extends MockAgent {
    async act(v) {
      const played = await super.act(v);
      if (!played || played.action.type !== "bid") return played;
      mouths.push({ held: v.you.dice.length, count: played.action.count, total: v.totalDice });
      return {
        action: played.action,
        thought: `I have ${v.you.dice.length + 4} sixes. Pushing ${played.action.count}×${played.action.face}.`,
      };
    }
  }
  const exhibit = await playExhibit({
    agents: [new Loud({ id: "dracula", name: "Dracula", aggression: 0.86, chaos: 0.12 }), makePlayer("caesar")],
    seed: 4,
    sleep: async () => {},
  });
  assert(mouths.length > 0, "the loud agent bid");
  const replay = validateAndReplay(exhibit.log);
  assert(replay.ok, "a normal match still replays: " + (replay.detail || replay.code));
  let handDice = {};
  let total = 0;
  for (const ev of exhibit.log) {
    if (ev.type === "hand_start") {
      total = 0;
      for (const row of ev.counts) { handDice[row.id] = row.dice; total += row.dice; }
    }
    if (ev.type === "bid") {
      assert(ev.count <= total, "logged bid fits the hand");
      assert(!/\bI have \d+ sixes\b/.test(ev.thought || ""), "the log does not keep an impossible personal count");
      const claim = /no more than (\d+) dice/.exec(ev.thought || "");
      if (claim) eq(Number(claim[1]), handDice[ev.byId], "the ceiling is that seat's dice");
    }
  }

  class Over extends MockAgent {
    async act(v) {
      return { action: { type: "bid", count: v.totalDice + 3, face: 6 }, thought: "I have 20 sixes." };
    }
  }
  const cheated = await playExhibit({
    agents: [new Over({ id: "dracula", name: "Dracula", aggression: 0.2, chaos: 0 }), makePlayer("monk")],
    seed: 11,
    sleep: async () => {},
  });
  assert(cheated.winnerId, "an illegal bidder does not stall the match");
  assert(!cheated.log.some((e) => e.type === "bid" && e.count > 10), "no bid above a fresh table of ten");
  let live = 0;
  for (const ev of cheated.log) {
    if (ev.type === "hand_start") live = ev.counts.reduce((s, row) => s + row.dice, 0);
    if (ev.type === "bid") assert(ev.count <= live, "fallback bids stay inside the dice remaining");
  }

  const show = new Show({
    sleep: async () => {},
    pickWindowMs: 0,
    turnDelayMs: 0,
    revealDelayMs: 0,
    thinkDelayMs: 0,
    settleHoldMs: 0,
    bootstrapCount: 0,
    loopEnabled: false,
  });
  show.bootstrapDone = true;
  show.openNext();
  const seen = [];
  const orig = show.sleep;
  show.sleep = async () => {
    const card = show.current;
    if (!card) return;
    seen.push({
      line: card.narrative && card.narrative.line,
      bid: card.bid && card.bid.count,
      seats: card.seats.map((s) => s.dice),
      reveal: (card.reveal || []).reduce((s, hand) => s + hand.dice.length, 0),
    });
    return orig();
  };
  await show.playOpen();
  const reveals = seen.filter((row) => row.reveal > 0 && row.bid);
  assert(reveals.length > 0, "the show opened the cups");
  assert(reveals.every((row) => row.bid <= row.seats.reduce((s, n) => s + n, 0)), "seat totals during a reveal still cover the bid");
  assert(reveals.every((row) => row.seats.reduce((s, n) => s + n, 0) === row.reveal), "seat totals match the open cups");
  const settled = show.history[0];
  assert(settled && settled.winnerId, "the match still settles");

  console.log("bids ok");
})().catch((e) => { console.error(e); process.exit(1); });
