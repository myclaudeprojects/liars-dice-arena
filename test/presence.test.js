const { soundOn, replayIndex, replayPlays, statusCopy, foldShow, HOLD_MS } = require("../public/presence");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }
function eq(a, b, m) {
  const left = JSON.stringify(a);
  const right = JSON.stringify(b);
  if (left !== right) throw new Error((m || "eq") + `: ${left} !== ${right}`);
}

assert(soundOn(null) === false, "missing preference stays muted");
assert(soundOn(undefined) === false, "unset preference stays muted");
assert(soundOn("0") === false, "explicit off stays muted");
assert(soundOn("") === false, "blank stays muted");
assert(soundOn("true") === false, "only the stored on flag unmutes");
assert(soundOn("1") === true, "unmute is an explicit choice");

eq(replayIndex(0, false), 0, "empty replay has no frame");
eq(replayIndex(4, false), 0, "motion starts at the first beat");
eq(replayIndex(4, true), 3, "reduced motion opens on the final frame");
assert(replayPlays(false) === true, "replay autoplays when motion is allowed");
assert(replayPlays(true) === false, "reduced motion does not autoplay");

eq(statusCopy("up"), "", "a live link has no banner");
eq(statusCopy("boot"), "", "the first connect uses the empty state, not a banner");
assert(statusCopy("down").includes("Reconnecting"), "a dropped link says so");
assert(statusCopy("hold").includes("stays up"), "a gap keeps the frame");

const live = { live: { matchId: "m1", phase: "live" }, you: { credits: 1000 } };
const boot = { snap: null, link: "boot", holdUntil: 0 };

let next = foldShow(boot, { starting: true, snap: { starting: true } }, 1000);
assert(next.apply === false && next.snap == null && next.link === "boot", "startup does not blank into a fake match");

next = foldShow(boot, { failed: true }, 1000);
assert(next.apply === false && next.link === "down" && next.snap == null, "a failed first load is a reconnect, not a new book");

next = foldShow(boot, { snap: live }, 1000);
assert(next.apply === true && next.link === "up" && next.snap.live.matchId === "m1", "the first real frame is shown");

const up = { snap: live, link: "up", holdUntil: 0 };
const dropped = foldShow(up, { failed: true }, 2000);
assert(dropped.apply === false && dropped.snap.live.matchId === "m1" && dropped.link === "down", "a poll miss keeps the live frame");

const gap = foldShow(up, { snap: { live: null, upcoming: [] } }, 3000);
assert(gap.apply === false && gap.link === "hold" && gap.snap.live.matchId === "m1", "a null live during the grace window does not clear the table");
eq(gap.holdUntil, 3000 + HOLD_MS, "the grace window is armed once");

const still = foldShow(
  { snap: live, link: "hold", holdUntil: gap.holdUntil },
  { snap: { live: null } },
  gap.holdUntil - 1,
);
assert(still.apply === false && still.snap.live.matchId === "m1", "a second null inside the window still holds");

const released = foldShow(
  { snap: live, link: "hold", holdUntil: gap.holdUntil },
  { snap: { live: null, upcoming: [{ matchId: "m2" }] } },
  gap.holdUntil,
);
assert(released.apply === true && released.link === "up" && released.snap.live == null, "after the grace window a real empty show is empty");
assert(released.snap.upcoming[0].matchId === "m2", "the empty show still carries what is coming up");

const resumed = foldShow(
  { snap: live, link: "hold", holdUntil: gap.holdUntil },
  { snap: { live: { matchId: "m2", phase: "pick" } } },
  3000 + 100,
);
assert(resumed.apply === true && resumed.link === "up" && resumed.holdUntil === 0, "a new match replaces the held frame immediately");
eq(resumed.snap.live.matchId, "m2", "the new match id is the one on stage");

const restart = foldShow(up, { starting: true }, 4000);
assert(restart.apply === false && restart.snap.live.matchId === "m1" && restart.link === "down", "a restarting show keeps the last frame");

console.log("presence ok");
