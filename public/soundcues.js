// Which spectator cues a live-match snapshot just earned.
// The first snapshot a client sees is silent. Later diffs name the moment.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ldaSoundCues = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function head(m) {
    return (m && m.narrative && m.narrative.headline) || "";
  }

  function bidKey(m) {
    const b = m && m.bid;
    if (!b) return "";
    return [m.round || 0, b.agentId || b.name || "", b.count, b.face].join("|");
  }

  function revealKey(m) {
    if (!m || !m.reveal || !m.reveal.length) return "";
    return m.reveal.map((r) => `${r.id}:${(r.dice || []).join(",")}`).join(";");
  }

  function soundCues(prev, live) {
    if (!prev || !live) return [];
    const cues = [];
    const same = prev.matchId === live.matchId;
    if (live.phase === "pick" && (!same || prev.phase !== "pick")) cues.push("pick-open");
    if (same && prev.phase === "pick" && live.phase === "live") cues.push("pick-locked");
    const nextBid = bidKey(live);
    if (same && live.phase === "live" && nextBid && nextBid !== bidKey(prev) && head(live) !== "LIAR.") cues.push("bid");
    if (same && head(live) === "LIAR." && head(prev) !== "LIAR.") cues.push("call");
    const nextReveal = revealKey(live);
    if (same && nextReveal && nextReveal !== revealKey(prev)) cues.push("reveal");
    if (same && live.phase === "settled" && prev.phase !== "settled") {
      const you = live.market && live.market.you;
      if (you && you.won) cues.push("settle-win");
      else if (you) cues.push("settle-miss");
    }
    return cues;
  }

  return { soundCues };
});
