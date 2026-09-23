// eventlog.js — Ordered event-log checks and a deterministic replay reducer.
//
// The engine log is the record. This module does not roll dice and does not
// call agents. It checks that the log could have been produced by the rules
// and rebuilds the final table from those events alone.

const { countFace, isHigherBid } = require("./engine");
const { kindOf } = require("./contract");
const { canonicalJson, sha256Prefixed } = require("./canonical");

const ALLOWED = new Set([
  "MATCH_STARTED",
  "ROUND_STARTED",
  "DICE_ROLLED",
  "AGENT_THINKING_STARTED",
  "BID_PLACED",
  "CALL_MADE",
  "REVEAL_STARTED",
  "DICE_REVEALED",
  "ROUND_RESOLVED",
  "AGENT_REACTED",
  "PLAYER_ELIMINATED",
  "MATCH_RESOLVED",
]);

const NEXT = {
  MATCH_STARTED: ["DICE_ROLLED"],
  DICE_ROLLED: ["ROUND_STARTED"],
  ROUND_STARTED: ["AGENT_THINKING_STARTED", "BID_PLACED", "CALL_MADE"],
  AGENT_THINKING_STARTED: ["BID_PLACED", "CALL_MADE"],
  BID_PLACED: ["AGENT_THINKING_STARTED", "BID_PLACED", "CALL_MADE"],
  CALL_MADE: ["REVEAL_STARTED"],
  REVEAL_STARTED: ["DICE_REVEALED"],
  DICE_REVEALED: ["ROUND_RESOLVED"],
  ROUND_RESOLVED: ["AGENT_REACTED"],
  AGENT_REACTED: ["AGENT_REACTED", "PLAYER_ELIMINATED", "DICE_ROLLED", "MATCH_RESOLVED"],
  PLAYER_ELIMINATED: ["MATCH_RESOLVED", "DICE_ROLLED"],
  MATCH_RESOLVED: [],
};

function eventKind(ev) {
  if (!ev || typeof ev !== "object") return null;
  if (ev.kind && ALLOWED.has(ev.kind)) return ev.kind;
  return kindOf(ev.type);
}

function eventLogHash(log) {
  return sha256Prefixed(canonicalJson(log || []));
}

function finalStateFrom(players, winnerId) {
  return {
    winnerId: winnerId || null,
    players: [...players].map((p) => ({
      id: p.id,
      alive: !!p.alive,
      dice: p.diceCount || 0,
    })).sort((a, b) => String(a.id).localeCompare(String(b.id))),
  };
}

function finalStateHash(state) {
  return sha256Prefixed(canonicalJson(state));
}

function fail(code, detail) {
  return { ok: false, code, detail: detail || null, finalState: null };
}

// Idempotent append. A repeated sequence number returns the existing log.
function appendEvent(log, ev) {
  const next = Array.isArray(log) ? log : [];
  const seq = ev && ev.seq;
  if (next.some((row) => row && row.seq === seq)) {
    return { ok: true, duplicate: true, log: next };
  }
  if (next.length && seq !== next.length) {
    return { ok: false, duplicate: false, code: "EVENT_SEQUENCE_INVALID", log: next };
  }
  if (!next.length && seq !== 0) {
    return { ok: false, duplicate: false, code: "EVENT_SEQUENCE_INVALID", log: next };
  }
  next.push(ev);
  return { ok: true, duplicate: false, log: next };
}

function validateAndReplay(log, { wildOnes = true, claimedWinnerId = null, expectedEventLogHash = null } = {}) {
  if (!Array.isArray(log) || !log.length) return fail("EVENT_SEQUENCE_INVALID", "empty log");
  const hash = eventLogHash(log);
  if (expectedEventLogHash && expectedEventLogHash !== hash) {
    return {
      ok: false,
      code: "EVENT_LOG_HASH_MISMATCH",
      expected: expectedEventLogHash,
      actual: hash,
      finalState: null,
    };
  }

  const seenSeq = new Set();
  const seenId = new Set();
  let players = [];
  let currentBid = null;
  let callerId = null;
  let bidderId = null;
  let pendingReveal = null;
  let winnerId = null;
  let terminal = false;
  let prevKind = null;

  for (let i = 0; i < log.length; i++) {
    const ev = log[i];
    const kind = eventKind(ev);
    if (!kind) return fail("EVENT_SEQUENCE_INVALID", "unknown event at " + i);
    if (terminal) return fail("EVENT_SEQUENCE_INVALID", "event after terminal state");
    if (!Number.isInteger(ev.seq) || seenSeq.has(ev.seq)) {
      return fail("EVENT_SEQUENCE_INVALID", "duplicate or missing seq at " + i);
    }
    if (ev.seq !== i) return fail("EVENT_SEQUENCE_INVALID", "gap at " + i);
    seenSeq.add(ev.seq);
    const eventId = ev.eventId || (ev.matchId ? ev.matchId + ":" + ev.seq : String(ev.seq));
    if (seenId.has(eventId)) return fail("EVENT_SEQUENCE_INVALID", "duplicate event id");
    seenId.add(eventId);

    if (prevKind == null) {
      if (kind !== "MATCH_STARTED") return fail("EVENT_SEQUENCE_INVALID", "log must start with MATCH_STARTED");
    } else if (!NEXT[prevKind].includes(kind)) {
      return fail("EVENT_SEQUENCE_INVALID", prevKind + " -> " + kind);
    }

    if (kind === "MATCH_STARTED") {
      const seats = ev.seats || [];
      if (seats.length < 2) return fail("EVENT_SEQUENCE_INVALID", "need seats");
      players = seats.map((s) => ({ id: s.id, name: s.name || s.id, alive: true, diceCount: 0, dice: [] }));
    } else if (kind === "DICE_ROLLED") {
      currentBid = null;
      callerId = null;
      bidderId = null;
      pendingReveal = null;
      for (const hand of ev.hands || []) {
        const p = players.find((x) => x.id === hand.id);
        if (!p) return fail("EVENT_SEQUENCE_INVALID", "unknown roller");
        const faces = Array.isArray(hand.dice) ? hand.dice : [];
        if (!p.alive && faces.length) return fail("GAME_RULE_VIOLATION", "dice for eliminated player");
        for (const face of faces) {
          if (!Number.isInteger(face) || face < 1 || face > 6) {
            return fail("GAME_RULE_VIOLATION", "die face out of range");
          }
        }
        p.dice = faces.slice();
        p.diceCount = faces.length;
      }
    } else if (kind === "BID_PLACED") {
      const bid = { count: ev.count, face: ev.face, byId: ev.byId || ev.actorId };
      if (!players.some((p) => p.id === bid.byId && p.alive)) {
        return fail("GAME_RULE_VIOLATION", "bid from unknown actor");
      }
      const total = players.reduce((s, p) => s + (p.alive ? p.diceCount : 0), 0);
      if (!Number.isInteger(bid.count) || !Number.isInteger(bid.face)) {
        return fail("GAME_RULE_VIOLATION", "bid must be integers");
      }
      if (bid.count > total) return fail("GAME_RULE_VIOLATION", "bid exceeds dice");
      if (!isHigherBid(currentBid, bid)) return fail("GAME_RULE_VIOLATION", "bid not higher");
      currentBid = bid;
    } else if (kind === "CALL_MADE") {
      if (!currentBid) return fail("GAME_RULE_VIOLATION", "nothing to call");
      callerId = ev.actorId || ev.challengerId;
      bidderId = ev.bidderId || currentBid.byId;
      if (!players.some((p) => p.id === callerId && p.alive)) {
        return fail("GAME_RULE_VIOLATION", "unknown caller");
      }
    } else if (kind === "DICE_REVEALED") {
      pendingReveal = ev.reveal || null;
    } else if (kind === "ROUND_RESOLVED") {
      if (!currentBid) return fail("GAME_RULE_VIOLATION", "resolve without a bid");
      const reveal = ev.reveal || pendingReveal || [];
      const hands = reveal.map((r) => r.dice || []);
      const actual = countFace(hands, ev.bid ? ev.bid.face : currentBid.face, wildOnes);
      if (ev.actual != null && ev.actual !== actual) {
        return fail("GAME_RULE_VIOLATION", "face count does not match the reveal");
      }
      const bidWasTrue = actual >= (ev.bid ? ev.bid.count : currentBid.count);
      if (ev.bidWasTrue != null && ev.bidWasTrue !== bidWasTrue) {
        return fail("GAME_RULE_VIOLATION", "bid truth does not match the dice");
      }
      const loserId = bidWasTrue ? (ev.challengerId || callerId) : (ev.bidderId || bidderId);
      if (ev.loserId && ev.loserId !== loserId) return fail("GAME_RULE_VIOLATION", "loser mismatch");
      if (Array.isArray(ev.countsAfter)) {
        for (const row of ev.countsAfter) {
          const p = players.find((x) => x.id === row.id);
          if (!p) return fail("EVENT_SEQUENCE_INVALID", "unknown count");
          p.diceCount = row.dice;
          p.alive = row.alive !== false && row.dice > 0;
        }
      } else {
        const loser = players.find((p) => p.id === loserId);
        if (!loser) return fail("GAME_RULE_VIOLATION", "unknown loser");
        loser.diceCount = Math.max(0, loser.diceCount - 1);
        if (loser.diceCount <= 0) loser.alive = false;
      }
      currentBid = null;
    } else if (kind === "PLAYER_ELIMINATED") {
      const p = players.find((x) => x.id === (ev.id || ev.actorId));
      if (!p) return fail("EVENT_SEQUENCE_INVALID", "unknown elimination");
      p.alive = false;
      p.diceCount = 0;
    } else if (kind === "MATCH_RESOLVED") {
      const alive = players.filter((p) => p.alive);
      if (alive.length !== 1) return fail("FINAL_STATE_MISMATCH", "winner is not the last player");
      if (ev.winnerId !== alive[0].id) return fail("FINAL_STATE_MISMATCH", "winner mismatch");
      winnerId = ev.winnerId;
      terminal = true;
    }

    prevKind = kind;
  }

  if (!terminal || !winnerId) return fail("EVENT_SEQUENCE_INVALID", "match did not resolve");
  if (claimedWinnerId && claimedWinnerId !== winnerId) {
    return fail("FINAL_STATE_MISMATCH", "claimed winner differs from replay");
  }
  const finalState = finalStateFrom(players, winnerId);
  return {
    ok: true,
    code: null,
    winnerId,
    finalState,
    finalStateHash: finalStateHash(finalState),
    eventLogHash: hash,
    rounds: log.reduce((n, ev) => Math.max(n, ev.hand || 0), 0),
  };
}

module.exports = {
  ALLOWED,
  eventKind,
  eventLogHash,
  finalStateHash,
  finalStateFrom,
  appendEvent,
  validateAndReplay,
};
