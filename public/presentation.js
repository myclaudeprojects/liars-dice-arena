// Match presentation. The engine stays the source of truth.
// This module only names what a spectator should be looking at,
// and builds a cancelable timeline for that look. No timers live here.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ldaPresentation = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const STATES = Object.freeze([
    "LOADING", "PREDICTION", "ROUND_INTRO", "ROLLING", "BIDDING", "THINKING",
    "CALL", "REVEAL", "ROUND_RESULT", "NEXT_ROUND", "MATCH_RESULT",
  ]);

  // Observed jumps are allowed. A poll can skip a frame; a refresh can land
  // anywhere LOADING can reach. CALL never steps backward to a bid.
  const EDGES = Object.freeze({
    LOADING: ["PREDICTION", "ROUND_INTRO", "ROLLING", "BIDDING", "THINKING", "CALL", "REVEAL", "ROUND_RESULT", "NEXT_ROUND", "MATCH_RESULT"],
    PREDICTION: ["ROUND_INTRO", "ROLLING", "LOADING"],
    ROUND_INTRO: ["ROLLING", "BIDDING", "THINKING"],
    ROLLING: ["BIDDING", "THINKING", "CALL"],
    BIDDING: ["THINKING", "BIDDING", "CALL", "REVEAL", "ROUND_RESULT", "ROLLING"],
    THINKING: ["BIDDING", "CALL", "THINKING", "REVEAL", "ROUND_RESULT"],
    CALL: ["REVEAL", "ROUND_RESULT"],
    REVEAL: ["ROUND_RESULT", "MATCH_RESULT"],
    ROUND_RESULT: ["NEXT_ROUND", "ROLLING", "BIDDING", "THINKING", "MATCH_RESULT"],
    NEXT_ROUND: ["ROLLING", "BIDDING", "THINKING"],
    MATCH_RESULT: ["PREDICTION", "LOADING"],
  });

  const PRESSURE = Object.freeze(["", "Routine", "Raise", "Pressure", "Call", "Decisive"]);
  const NEXT_HINT = Object.freeze({
    LOADING: "The table is coming",
    PREDICTION: "Pick a winner",
    ROUND_INTRO: "Cups down",
    ROLLING: "Next: the open",
    BIDDING: "Next: a raise or a call",
    THINKING: "Next: their bid or a call",
    CALL: "Next: the dice",
    REVEAL: "Next: the count",
    ROUND_RESULT: "Next: the next round",
    NEXT_ROUND: "Next: a new roll",
    MATCH_RESULT: "Match over",
  });
  const REACTION_LABEL = Object.freeze({
    neutral: "",
    thinking: "Thinking",
    confident: "Confident",
    "failed-bluff": "Caught",
    "successful-bluff": "Held",
    "successful-call": "Called it",
    "failed-call": "Missed",
    victory: "Won",
    defeat: "Out",
  });
  const NUM = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
  const FACE = { 1: "ones", 2: "twos", 3: "threes", 4: "fours", 5: "fives", 6: "sixes" };

  function canTransition(from, to) {
    if (from === to) return true;
    const next = EDGES[from];
    return !!(next && next.includes(to));
  }

  function transition(from, to, opts) {
    const fastForward = !!(opts && opts.fastForward);
    if (canTransition(from, to)) return { ok: true, state: to, skipped: false };
    if (fastForward && canTransition("LOADING", to)) return { ok: true, state: to, skipped: true };
    return { ok: false, state: from, skipped: false };
  }

  function countFace(reveal, face) {
    const f = Number(face);
    if (!reveal || !f) return 0;
    let n = 0;
    for (const hand of reveal) {
      for (const d of hand.dice || []) {
        if (d === f) n++;
        else if (d === 1 && f !== 1) n++;
      }
    }
    return n;
  }

  function bidWords(count, face) {
    const n = NUM[count] || String(count || "");
    const word = FACE[face] || "dice";
    return `${n} ${word}`.trim().toUpperCase();
  }

  function seatName(match, id) {
    const seat = (match && match.seats || []).find((s) => s.id === id);
    return seat ? seat.name : "";
  }

  function presentationOf(match) {
    if (!match) return { state: "LOADING", intensity: 0, actorId: null, focus: "status" };
    const narrative = match.narrative || {};
    const headline = narrative.headline || "";
    let intensity = Number(narrative.intensity);
    if (!intensity) intensity = headline === "LIAR." ? 4 : 1;
    if (match.phase === "pick" || match.phase === "upcoming") {
      return { state: "PREDICTION", intensity: 1, actorId: null, focus: "pick" };
    }
    if (match.phase === "settled") {
      const winnerId = (match.oracle && match.oracle.winnerId) || match.winnerId || null;
      return { state: "MATCH_RESULT", intensity: 5, actorId: winnerId, focus: "result", winnerId };
    }
    if (match.reveal && match.reveal.length) {
      const level = Math.max(4, intensity || 4);
      return { state: "ROUND_RESULT", intensity: level, actorId: null, focus: "result" };
    }
    if (match.thinking && match.thinking.agentId) {
      return {
        state: "THINKING",
        intensity: 1,
        actorId: match.thinking.agentId,
        focus: "actor",
      };
    }
    if (headline === "LIAR.") {
      const callerId = match.bid && match.bid.callerId || null;
      return { state: "CALL", intensity: Math.max(4, intensity), actorId: callerId, focus: "call" };
    }
    if (match.bid) {
      const actorId = match.bid.agentId || match.bid.byId || null;
      return { state: "BIDDING", intensity: intensity || 1, actorId, focus: "bid" };
    }
    if (match.phase === "live") {
      return { state: "ROLLING", intensity: 1, actorId: null, focus: "dice" };
    }
    return { state: "ROUND_INTRO", intensity: 1, actorId: null, focus: "status" };
  }

  function reactionsOf(match) {
    const out = {};
    const seats = (match && match.seats) || [];
    for (const seat of seats) out[seat.id] = "neutral";
    if (!match) return out;
    const winnerId = (match.oracle && match.oracle.winnerId) || match.winnerId || null;
    if (match.phase === "settled") {
      for (const seat of seats) {
        if (winnerId) out[seat.id] = seat.id === winnerId ? "victory" : "defeat";
        else if (seat.alive === false) out[seat.id] = "defeat";
      }
      return out;
    }
    const reveal = match.reveal || [];
    const bid = match.bid;
    const headline = match.narrative && match.narrative.headline || "";
    if (reveal.length && bid && bid.face) {
      const actual = countFace(reveal, bid.face);
      const truth = actual >= Number(bid.count);
      const bidder = bid.byId || bid.agentId || "";
      const caller = bid.callerId || "";
      if (bidder && out[bidder] != null) {
        if (!truth) out[bidder] = "failed-bluff";
        else {
          const own = countFace(reveal.filter((hand) => hand.id === bidder), bid.face);
          out[bidder] = own < Number(bid.count) ? "successful-bluff" : "confident";
        }
      }
      if (caller && out[caller] != null) out[caller] = truth ? "failed-call" : "successful-call";
      for (const seat of seats) if (seat.alive === false) out[seat.id] = "defeat";
      return out;
    }
    if (headline === "LIAR." && bid && bid.callerId && out[bid.callerId] != null) {
      out[bid.callerId] = "confident";
    } else if (bid) {
      const bidder = bid.agentId || bid.byId || "";
      if (bidder && out[bidder] != null) out[bidder] = "confident";
    }
    if (match.thinking && match.thinking.agentId && out[match.thinking.agentId] != null) {
      out[match.thinking.agentId] = "thinking";
    }
    return out;
  }

  function roundCall(match) {
    if (!match || !match.bid || !match.reveal || !match.reveal.length) return null;
    const face = Number(match.bid.face);
    const count = Number(match.bid.count);
    if (!face || !count) return null;
    const actual = countFace(match.reveal, face);
    const truth = actual >= count;
    const bidderId = match.bid.byId || match.bid.agentId || "";
    const callerId = match.bid.callerId || "";
    const winnerId = truth ? bidderId : callerId;
    const loserId = truth ? callerId : bidderId;
    const winner = seatName(match, winnerId);
    return {
      actual, count, face, truth, bidderId, callerId, winnerId, loserId, winner,
      words: bidWords(actual, face),
      bidWords: bidWords(count, face),
      verdict: truth ? "TRUTH" : "BLUFF",
      result: winner ? `${winner} wins the round` : "",
    };
  }

  function pressureLabel(intensity, state) {
    const level = Math.max(0, Math.min(5, Number(intensity) || 0));
    if (state === "THINKING") return "Thinking";
    if (state === "REVEAL" || state === "ROUND_RESULT") return level >= 5 ? "Decisive" : "Reveal";
    return PRESSURE[level] || "";
  }

  function nextHint(state) {
    return NEXT_HINT[state] || "";
  }

  // CSS stage token for the broadcast arena. The state machine stays the source.
  function broadcastStage(state) {
    if (state === "ROLLING" || state === "ROUND_INTRO" || state === "NEXT_ROUND") return "roll";
    if (state === "THINKING") return "thinking";
    if (state === "BIDDING") return "announce";
    if (state === "CALL") return "call";
    if (state === "REVEAL" || state === "ROUND_RESULT") return "reveal";
    if (state === "MATCH_RESULT") return "result";
    return "live";
  }

  function commandFor(match, pres) {
    const view = pres || presentationOf(match);
    const bid = match && match.bid || null;
    const reveal = match && match.reveal || [];
    const bidKey = bid ? [bid.count, bid.face, bid.callerId || "", bid.agentId || bid.byId || ""].join("x") : "";
    const revealKey = reveal.length ? reveal.map((hand) => `${hand.id}:${(hand.dice || []).join(",")}`).join(";") : "";
    const base = {
      state: view.state,
      intensity: view.intensity || 1,
      actorId: view.actorId || null,
      name: view.actorId ? seatName(match, view.actorId) : "",
      bidKey,
      revealKey,
      round: match && match.round || 0,
      winnerId: view.winnerId || (match && match.oracle && match.oracle.winnerId) || "",
    };
    if (match && match.phase === "settled") return { ...base, play: "playMatchResult" };
    if (reveal.length) {
      const elimination = (match.seats || []).some((seat) => seat.alive === false);
      return { ...base, play: "playReveal", intensity: Math.max(4, view.intensity || 4), elimination };
    }
    if (view.state === "CALL") return { ...base, play: "playCall", intensity: Math.max(4, view.intensity || 4) };
    if (view.state === "THINKING") return { ...base, play: "playThinking", intensity: 1 };
    if (view.state === "BIDDING") return { ...base, play: "playBid" };
    if (view.state === "ROLLING") return { ...base, play: "playRoll" };
    return { ...base, play: "playHold" };
  }

  function commandKey(cmd) {
    if (!cmd) return "";
    return [cmd.play, cmd.actorId || "", cmd.intensity, cmd.bidKey || "", cmd.revealKey || "", cmd.winnerId || "", cmd.elimination ? 1 : 0, cmd.round || 0].join("|");
  }

  const MOTION_FLAGS = { tumble: true, roll: true };

  function buildTimeline(segments) {
    const ordered = segments.slice().sort((a, b) => a.at - b.at);
    const fullDuration = ordered.reduce((max, seg) => Math.max(max, seg.at + seg.dur), 0);
    return {
      labels: ordered.map((seg) => seg.id),
      segments: ordered,
      fullDuration,
      frameAt(t) {
        const time = Math.min(fullDuration, Math.max(0, Number(t) || 0));
        const reached = ordered.filter((seg) => time >= seg.at);
        const current = reached[reached.length - 1] || ordered[0];
        const flags = {};
        for (const seg of reached) {
          for (const [key, value] of Object.entries(seg.flags || {})) {
            if (MOTION_FLAGS[key]) continue;
            flags[key] = value;
          }
        }
        if (current && current.flags) {
          for (const key of Object.keys(MOTION_FLAGS)) {
            if (current.flags[key]) flags[key] = true;
          }
        }
        return {
          t: time,
          label: current ? current.id : "idle",
          done: time >= fullDuration,
          camera: current && current.camera || "wide",
          primary: current && current.primary || "status",
          ...flags,
        };
      },
    };
  }

  function direct(command, opts) {
    const cmd = command || { play: "playHold", intensity: 1 };
    const level = Number(cmd.intensity) || 1;
    const play = cmd.play;
    let segments;
    if (play === "playCall" && level >= 4) {
      segments = [
        { id: "darken", at: 0, dur: 240, camera: "wide", primary: "call", flags: { dim: true, showBid: true, showLiar: false } },
        { id: "focus-caller", at: 160, dur: 280, camera: "caller", primary: "call", flags: { dim: true, showBid: true } },
        { id: "liar", at: 340, dur: 520, camera: "caller", primary: "liar", flags: { dim: true, showBid: true, showLiar: true } },
        { id: "hold", at: 820, dur: 1400, camera: "caller", primary: "liar", flags: { dim: true, showBid: true, showLiar: true } },
      ];
    } else if (play === "playReveal") {
      const resultDur = level >= 5 ? 1400 : 1000;
      segments = [
        { id: "dice-focus", at: 0, dur: 200, camera: "dice", primary: "dice", flags: { dim: true, showDice: true, showLiar: false } },
        { id: "tumble", at: 160, dur: 400, camera: "dice", primary: "dice", flags: { showDice: true, tumble: true, dim: true } },
        { id: "count", at: 520, dur: 480, camera: "dice", primary: "dice", flags: { showDice: true, showCount: true, dim: false } },
        { id: "verdict", at: 860, dur: 420, camera: "dice", primary: "result", flags: { showDice: true, showCount: true, showVerdict: true } },
        { id: "react", at: 1240, dur: 380, camera: level >= 5 ? "pullback" : "dice", primary: "result", flags: { showDice: true, showCount: true, showVerdict: true, showReaction: true } },
        { id: "result", at: 1580, dur: resultDur, camera: "pullback", primary: "result", flags: { showDice: true, showCount: true, showVerdict: true, showReaction: true, showResult: true } },
      ];
    } else if (play === "playBid" && level >= 3) {
      segments = [
        { id: "push", at: 0, dur: 280, camera: "push", primary: "bid", flags: { showBid: true, punch: true } },
        { id: "bid", at: 200, dur: 700, camera: "push", primary: "bid", flags: { showBid: true, punch: true } },
      ];
    } else if (play === "playBid" && level >= 2) {
      segments = [
        { id: "bid", at: 0, dur: 880, camera: "wide", primary: "bid", flags: { showBid: true, punch: true } },
      ];
    } else if (play === "playBid") {
      segments = [
        { id: "bid", at: 0, dur: 640, camera: "wide", primary: "bid", flags: { showBid: true } },
      ];
    } else if (play === "playThinking") {
      const dur = level >= 3 ? 1100 : level >= 2 ? 900 : 720;
      segments = [
        { id: "think", at: 0, dur, camera: level >= 2 ? "push" : "wide", primary: "actor", flags: { showThink: true, showBid: true, orbit: true } },
      ];
    } else if (play === "playRoll") {
      segments = [
        { id: "cup", at: 0, dur: 1080, camera: "wide", primary: "dice", flags: { roll: true, showDice: true, cup: true } },
        { id: "roll", at: 200, dur: 900, camera: "wide", primary: "dice", flags: { roll: true, showDice: true, cup: true } },
      ];
    } else if (play === "playRoundResult") {
      segments = [
        { id: "verdict", at: 0, dur: 200, camera: "dice", primary: "result", flags: { showDice: true, showCount: true, showVerdict: true } },
        { id: "react", at: 160, dur: 180, camera: "pullback", primary: "result", flags: { showDice: true, showCount: true, showVerdict: true, showReaction: true } },
        { id: "result", at: 320, dur: 240, camera: "pullback", primary: "result", flags: { showDice: true, showCount: true, showVerdict: true, showReaction: true, showResult: true } },
      ];
    } else if (play === "playMatchResult") {
      segments = [
        { id: "result", at: 0, dur: 480, camera: "pullback", primary: "result", flags: { showResult: true, showReaction: true } },
      ];
    } else {
      segments = [
        { id: "hold", at: 0, dur: 160, camera: "wide", primary: "status", flags: { showBid: true } },
      ];
    }
    const timeline = buildTimeline(segments);
    if (opts && opts.reduced) {
      const terminal = timeline.frameAt(timeline.fullDuration);
      terminal.camera = "wide";
      terminal.done = true;
      terminal.tumble = false;
      terminal.roll = false;
      terminal.t = 0;
      return {
        ...timeline,
        fullDuration: timeline.fullDuration,
        reduced: true,
        frameAt() { return { ...terminal }; },
      };
    }
    return timeline;
  }

  class AnimationDirector {
    constructor(opts = {}) {
      this._now = opts.now || (() => 0);
      this.reduced = !!opts.reduced;
      this.generation = 0;
      this._timeline = null;
      this._started = 0;
    }

    play(command) {
      this.generation += 1;
      this._timeline = direct(command, { reduced: this.reduced });
      this._started = this._now();
      return this._timeline;
    }

    cancel() {
      this.generation += 1;
      this._timeline = null;
    }

    fastForward() {
      if (!this._timeline) return null;
      this._started = this._now() - this._timeline.fullDuration - 1;
      return this.frame();
    }

    frame() {
      if (!this._timeline) return null;
      const end = this._timeline.fullDuration;
      const elapsed = this.reduced ? end : Math.max(0, this._now() - this._started);
      const shot = this._timeline.frameAt(elapsed);
      if (this.reduced) {
        shot.camera = "wide";
        shot.tumble = false;
        shot.roll = false;
        shot.done = true;
      }
      return shot;
    }
  }

  return {
    STATES,
    EDGES,
    REACTION_LABEL,
    canTransition,
    transition,
    countFace,
    bidWords,
    presentationOf,
    reactionsOf,
    roundCall,
    pressureLabel,
    nextHint,
    broadcastStage,
    commandFor,
    commandKey,
    direct,
    AnimationDirector,
  };
});
