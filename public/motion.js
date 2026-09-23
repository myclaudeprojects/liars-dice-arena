// Which spectator beats a live-match snapshot just earned.
// The first snapshot a client sees is still. Later diffs name the motion.
// Replay frames are built from the stored engine log, not a second rules engine.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ldaMotion = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function head(m) {
    return (m && m.narrative && m.narrative.headline) || "";
  }

  function bidKey(m) {
    const b = m && m.bid;
    if (!b) return "";
    return [m.round || 0, b.agentId || b.byId || b.name || "", b.count, b.face].join("|");
  }

  function revealKey(m) {
    if (!m || !m.reveal || !m.reveal.length) return "";
    return m.reveal.map((r) => `${r.id}:${(r.dice || []).join(",")}`).join(";");
  }

  function priceKey(m) {
    const price = m && m.market && m.market.price;
    if (!price) return "";
    return Object.keys(price).sort().map((k) => k + "=" + price[k]).join(",");
  }

  function frameKey(m) {
    if (!m) return "";
    const seats = (m.seats || []).map((s) => [s.id, s.dice || 0, s.alive === false ? 0 : 1].join(":")).join(",");
    return [m.matchId, m.phase, m.round || 0, bidKey(m), revealKey(m), head(m), seats, priceKey(m)].join("~");
  }

  // Ones are wild for every face except ones, matching the show rules.
  function countShown(reveal, face) {
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

  function seatLosses(before, after) {
    const out = [];
    for (const seat of after || []) {
      const prev = (before || []).find((s) => s.id === seat.id);
      if (!prev) continue;
      const from = prev.dice || 0;
      const to = seat.alive === false ? 0 : (seat.dice || 0);
      const eliminated = prev.alive !== false && seat.alive === false;
      if (from > to || eliminated) {
        out.push({
          type: "lose-die",
          id: seat.id,
          name: seat.name,
          from,
          to,
          eliminated,
        });
      }
    }
    return out;
  }

  function motionBeats(prev, live) {
    if (!prev || !live) return [];
    const beats = [];
    const same = prev.matchId && prev.matchId === live.matchId;
    if (!same) {
      if (live.phase === "pick") beats.push({ type: "intro" });
      return beats;
    }
    if (live.phase === "pick" && prev.phase !== "pick") beats.push({ type: "intro" });

    let rolled = false;
    if (prev.phase !== "live" && live.phase === "live") {
      beats.push({ type: "start" });
      beats.push({ type: "roll" });
      rolled = true;
    }

    if (live.phase === "live") {
      beats.push(...seatLosses(prev.seats, live.seats));
      const prevReveal = revealKey(prev);
      const nextReveal = revealKey(live);
      const revealCleared = prevReveal && !nextReveal;
      const roundUp = (live.round || 0) > (prev.round || 0);
      if (!rolled && prev.phase === "live" && (revealCleared || roundUp) && !nextReveal) {
        beats.push({ type: "roll" });
      }
      const nextBid = bidKey(live);
      if (nextBid && nextBid !== bidKey(prev) && head(live) !== "LIAR.") {
        beats.push({
          type: "bid",
          agentId: (live.bid && (live.bid.agentId || live.bid.byId)) || "",
          name: (live.bid && live.bid.name) || "",
          count: live.bid.count,
          face: live.bid.face,
          prevBid: prev.bid || null,
        });
      }
      if (head(live) === "LIAR." && head(prev) !== "LIAR.") {
        beats.push({
          type: "call",
          name: (live.bid && live.bid.name) || "",
          bidderId: (live.bid && (live.bid.byId || live.bid.agentId)) || "",
        });
      }
      if (nextReveal && nextReveal !== prevReveal) {
        const truth = head(live) === "HE WAS TELLING THE TRUTH.";
        const bluff = head(live) === "HE WAS BLUFFING.";
        beats.push({
          type: "reveal",
          bidWasTrue: truth ? true : bluff ? false : null,
          face: live.bid && live.bid.face,
          count: live.bid && live.bid.count,
          actual: countShown(live.reveal, live.bid && live.bid.face),
        });
      }
      if (priceKey(live) && priceKey(live) !== priceKey(prev)) beats.push({ type: "price" });
    }

    if (live.phase === "settled" && prev.phase !== "settled") {
      const you = live.market && live.market.you;
      beats.push({
        type: "settle",
        won: !!(you && you.won),
        picked: !!you,
        pnl: you ? you.pnl : 0,
      });
    }
    return beats;
  }

  const FACE = { 1: "ones", 2: "twos", 3: "threes", 4: "fours", 5: "fives", 6: "sixes" };
function faceWord(face) { return FACE[face] || "dice"; }

function indexNames(events) {
    const names = {};
    for (const e of events || []) {
      if (e.type === "bid" && e.byId && e.name) names[e.byId] = e.name;
      if (e.type === "eliminated" && e.id && e.name) names[e.id] = e.name;
      if (e.type === "match_over" && e.winnerId && e.name) names[e.winnerId] = e.name;
      if (e.type === "challenge" && e.reveal) {
        for (const r of e.reveal) if (r.id && r.name) names[r.id] = r.name;
      }
    }
    return names;
  }

  function cloneSeats(seats) {
    return seats.map((s) => ({
      id: s.id,
      name: s.name,
      hue: s.hue,
      dice: s.dice,
      alive: s.alive !== false,
    }));
  }

  // Step the archived engine log into table frames. Presentation only.
  function replayFrames(events, meta) {
    const hueOf = (meta && meta.hueOf) || (() => 40);
    const names = indexNames(events);
    let seats = [];
    let lastBid = null;
    let lastReveal = null;
    let round = 1;
    const frames = [];

    function named(id, fallback) {
      return names[id] || fallback || id;
    }

    for (const e of events || []) {
      if (e.hand) round = e.hand;
      if (e.type === "hand_start") {
        const before = cloneSeats(seats);
        if (!seats.length) {
          seats = (e.counts || []).map((c) => {
            const hue = hueOf(c.id);
            return {
              id: c.id,
              name: named(c.id),
              hue: hue == null ? 40 : hue,
              dice: c.dice,
              alive: (c.dice || 0) > 0,
            };
          });
        } else {
          for (const c of e.counts || []) {
            const s = seats.find((x) => x.id === c.id);
            if (!s) continue;
            s.dice = c.dice;
            s.alive = (c.dice || 0) > 0;
            s.name = named(c.id, s.name);
          }
        }
        lastBid = null;
        lastReveal = null;
        const losses = seatLosses(before, seats);
        frames.push({
          kind: "roll",
          round,
          seats: cloneSeats(seats),
          bid: null,
          reveal: null,
          narrative: { line: "Cups down.", headline: null, aside: null, pace: "normal" },
          beats: [{ type: "roll" }, ...losses],
        });
      } else if (e.type === "bid") {
        if (e.byId && e.name) names[e.byId] = e.name;
        for (const s of seats) if (names[s.id]) s.name = names[s.id];
        const bid = { count: e.count, face: e.face, name: e.name, agentId: e.byId };
        frames.push({
          kind: "bid",
          round,
          seats: cloneSeats(seats),
          bid,
          reveal: null,
          narrative: {
            line: `${e.name} bids ${e.count} ${faceWord(e.face)}.`,
            headline: null,
            aside: null,
            pace: "normal",
          },
          beats: [{
            type: "bid",
            agentId: e.byId,
            name: e.name,
            count: e.count,
            face: e.face,
            prevBid: lastBid,
          }],
        });
        lastBid = bid;
      } else if (e.type === "challenge") {
        if (e.reveal) {
          for (const r of e.reveal) if (r.id && r.name) names[r.id] = r.name;
        }
        for (const s of seats) if (names[s.id]) s.name = names[s.id];
        const bid = {
          count: e.bid.count,
          face: e.bid.face,
          byId: e.bidderId,
          agentId: e.bidderId,
          name: named(e.challengerId, "Caller"),
        };
        const caller = named(e.challengerId, "Someone");
        frames.push({
          kind: "call",
          round,
          seats: cloneSeats(seats),
          bid,
          reveal: null,
          narrative: { line: `${caller} calls.`, headline: "LIAR.", aside: null, pace: "critical" },
          beats: [{ type: "call", name: caller, bidderId: e.bidderId }],
        });
        const headline = e.bidWasTrue ? "HE WAS TELLING THE TRUTH." : "HE WAS BLUFFING.";
        lastReveal = e.reveal || [];
        lastBid = bid;
        frames.push({
          kind: "reveal",
          round,
          seats: cloneSeats(seats),
          bid,
          reveal: lastReveal,
          actual: e.actual,
          narrative: { line: headline, headline, aside: null, pace: "critical" },
          beats: [{
            type: "reveal",
            bidWasTrue: !!e.bidWasTrue,
            face: e.bid.face,
            count: e.bid.count,
            actual: e.actual != null ? e.actual : countShown(lastReveal, e.bid.face),
          }],
        });
      } else if (e.type === "eliminated") {
        const before = cloneSeats(seats);
        const s = seats.find((x) => x.id === e.id);
        if (s) {
          s.alive = false;
          s.dice = 0;
          if (e.name) s.name = e.name;
        }
        const losses = seatLosses(before, seats);
        frames.push({
          kind: "out",
          round,
          seats: cloneSeats(seats),
          bid: lastBid,
          reveal: lastReveal,
          narrative: {
            line: `${e.name || named(e.id)} loses the last die.`,
            headline: `${e.name || named(e.id)} is out.`,
            aside: null,
            pace: "critical",
          },
          beats: losses.length ? losses : [{ type: "lose-die", id: e.id, name: e.name, from: 1, to: 0, eliminated: true }],
        });
      } else if (e.type === "match_over") {
        frames.push({
          kind: "settle",
          round,
          seats: cloneSeats(seats),
          bid: lastBid,
          reveal: lastReveal,
          winnerId: e.winnerId,
          narrative: {
            line: `${e.name || named(e.winnerId)} wins.`,
            headline: `${e.name || named(e.winnerId)} wins.`,
            aside: null,
            pace: "critical",
          },
          beats: [{ type: "settle", won: false, picked: false, pnl: 0, name: e.name || "" }],
        });
      }
    }
    return frames;
  }

  return { motionBeats, countShown, frameKey, replayFrames, seatLosses };
});
