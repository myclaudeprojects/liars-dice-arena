// contract.js — Typed match-event contract.
//
// The engine log is the only record of what happened. `kind` names the
// event for a later presentation subscriber. `type` stays the legacy word
// so replay, stories, and the result hash keep reading one log.
//
// Presentation may read these facts. It does not roll dice, accept bids,
// or decide the winner. `seq` is the order index. Wall-clock timestamps are
// not stored: they would make the same seed look like a different match.
//
// DICE_ROLLED carries the faces the seed produced, marked hidden. Live
// projections must go through publicEvent(), which replaces those faces
// with counts. DICE_REVEALED is the first public look at the cups.

const KINDS = Object.freeze({
  match_started: "MATCH_STARTED",
  hand_start: "ROUND_STARTED",
  dice_rolled: "DICE_ROLLED",
  thinking: "AGENT_THINKING_STARTED",
  bid: "BID_PLACED",
  call: "CALL_MADE",
  reveal_started: "REVEAL_STARTED",
  dice_revealed: "DICE_REVEALED",
  challenge: "ROUND_RESOLVED",
  reacted: "AGENT_REACTED",
  eliminated: "PLAYER_ELIMINATED",
  match_over: "MATCH_RESOLVED",
});

function kindOf(type) {
  return KINDS[type] || null;
}

// Juice budget (§9A). A number on the event, not a visual treatment.
function intensityFor(pace, { elimination = false } = {}) {
  if (pace === "result") return 5;
  if (pace === "reveal") return elimination ? 5 : 4;
  if (pace === "call") return 4;
  if (pace === "critical") return 3;
  if (pace === "interesting") return 2;
  return 1;
}

// Six clocks. Same inputs always return the same delay.
// normal = turn, interesting = 1.25×, critical = 1.8×,
// call = its own mix of turn and reveal, reveal = revealDelay, result = settle hold.
function paceDelay(pace, timings = {}) {
  const turn = Number(timings.turnDelayMs) || 0;
  const reveal = Number(timings.revealDelayMs) || 0;
  const settle = Number(timings.settleHoldMs) || 0;
  if (pace === "reveal") return reveal;
  if (pace === "result") return settle;
  if (pace === "call") return Math.round(turn * 0.55 + reveal * 0.45);
  if (pace === "interesting") return Math.round(turn * 1.25);
  if (pace === "critical") return Math.round(turn * 1.8);
  return turn;
}

function publicEvent(ev) {
  if (!ev || typeof ev !== "object") return ev;
  const out = { ...ev };
  const hideFaces = out.kind === "DICE_ROLLED" || out.hidden === true;
  if (hideFaces && Array.isArray(out.hands)) {
    out.hands = out.hands.map((h) => ({
      id: h.id,
      name: h.name || null,
      count: Array.isArray(h.dice) ? h.dice.length : (h.count || 0),
      alive: h.alive !== false,
    }));
    out.hidden = true;
  }
  return out;
}

module.exports = { KINDS, kindOf, intensityFor, paceDelay, publicEvent };
