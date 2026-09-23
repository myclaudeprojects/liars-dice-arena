// Spectator presence: connection gaps, mute default, replay motion policy.
// A brief miss keeps the last live frame. It does not invent a match.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ldaPresence = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const HOLD_MS = 4500;

  function soundOn(stored) {
    return stored === "1";
  }

  function replayIndex(count, reduced) {
    const n = count | 0;
    if (n <= 0) return 0;
    return reduced ? n - 1 : 0;
  }

  function replayPlays(reduced) {
    return !reduced;
  }

  function statusCopy(link) {
    if (link === "down") return "Reconnecting. This frame stays up.";
    if (link === "hold") return "Next match is opening. This frame stays up.";
    return "";
  }

  // prev: { snap, link, holdUntil }
  // incoming: { failed, starting, snap }
  // Returns the next presence. apply false means keep the previous frame.
  function foldShow(state, incoming, now, holdMs) {
    const prev = state || {};
    const prevSnap = prev.snap || null;
    const hadLive = !!(prevSnap && prevSnap.live);
    const wait = holdMs == null ? HOLD_MS : holdMs;
    const at = Number(now) || 0;
    if (!incoming || incoming.failed || incoming.starting) {
      const failed = !!(incoming && incoming.failed);
      let link = "boot";
      if (prevSnap) link = "down";
      else if (failed) link = "down";
      return {
        snap: prevSnap,
        link,
        holdUntil: prev.holdUntil || 0,
        apply: false,
      };
    }
    const next = incoming.snap || null;
    if (next && !next.live && hadLive) {
      const until = prev.holdUntil || (at + wait);
      if (at < until) {
        return { snap: prevSnap, link: "hold", holdUntil: until, apply: false };
      }
    }
    return { snap: next, link: "up", holdUntil: 0, apply: true };
  }

  return { HOLD_MS, soundOn, replayIndex, replayPlays, statusCopy, foldShow };
});
