const { Match, isHigherBid, countFace } = require("../src/engine");

function assert(cond, msg) { if (!cond) throw new Error(msg); }

assert(isHigherBid(null, { count: 1, face: 2 }) === true, "open ok");
assert(isHigherBid({ count: 2, face: 3 }, { count: 2, face: 4 }) === true, "raise face");
assert(isHigherBid({ count: 2, face: 3 }, { count: 2, face: 2 }) === false, "lower face");
assert(isHigherBid({ count: 2, face: 3 }, { count: 3, face: 1 }) === true, "raise count");
assert(countFace([[1, 2, 2], [3, 1]], 2, true) === 4, "ones wild count");
assert(countFace([[1, 2, 2], [3, 1]], 2, false) === 2, "no wild");
assert(countFace([[1, 1, 1]], 1, true) === 3, "ones as ones");

const m0 = new Match({ seats: [{ id: "a", name: "A" }, { id: "b", name: "B" }], seed: 1 });
assert(m0.applyAction(null).error === "unknown_action", "null action");
assert(m0.applyAction({ type: "challenge" }).error === "nothing_to_challenge", "open challenge");
assert(m0.applyAction({ type: "bid", count: 99, face: 2 }).error === "bid_exceeds_total_dice", "overbid");
assert(m0.applyAction({ type: "bid", count: 1.5, face: 2 }).error === "bid_must_be_integers", "non-int");
assert(m0.applyAction({ type: "bid", count: 1, face: 2 }).ok, "legal open");

// Dice drop across hands: loser has one fewer on the next deal.
const m = new Match({ seats: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }], seed: 99 });
assert(m.players.every((p) => p.dice.length === 5), "start with 5");
m.applyAction({ type: "bid", count: 1, face: 2 });
const r = m.applyAction({ type: "challenge" });
assert(r.ok && r.resolved, "challenge resolves");
assert(m.players.find((p) => p.id === r.resolved.loserId).dice.length === 4, "loser drops a die next hand");
assert(m.players.filter((p) => p.id !== r.resolved.loserId).every((p) => p.dice.length === 5), "others keep 5");

// Full random match terminates.
const full = new Match({ seats: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }], seed: 42 });
let guard = 0;
while (!full.winnerId && guard++ < 500) {
  const v = full.viewFor(full.currentPlayer.id);
  let act;
  if (v.currentBid && Math.random() < 0.4) { act = { type: "challenge" }; }
  else if (!v.currentBid) { act = { type: "bid", count: 1, face: 2 }; }
  else {
    let c = v.currentBid.count, f = v.currentBid.face + 1;
    if (f > 6) { f = 2; c++; }
    if (c > v.totalDice) { act = { type: "challenge" }; } else act = { type: "bid", count: c, face: f };
  }
  const res = full.applyAction(act);
  if (!res.ok) full.applyAction({ type: "challenge" });
}
assert(full.winnerId, "match produced a winner");
assert(full.players.filter((p) => p.alive).length === 1, "one alive");
assert(full.applyAction({ type: "bid", count: 1, face: 2 }).error === "match_over", "frozen after win");
console.log("winner:", full.winnerId, "hands:", full.handNumber, "events:", full.log.length);
console.log("engine ok");
