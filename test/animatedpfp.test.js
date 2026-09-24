// Layered procedural portraits: motion profiles, static poster, hero-only playback.
const fs = require("fs");
const path = require("path");
const { SEED_BRANDS, BrandBook } = require("../src/brands");
const { recipeFromBrand, renderPfp, qualityCheck, pathData } = require("../src/pfp");
const {
  MOTION_PROFILES, profileForBrand, animatedPfpMeta, shouldAnimate,
  blinkWindow, blinkClosed, poseAt, applyPose,
} = require("../src/motionprofiles");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }
function eq(a, b, m) { if (a !== b) throw new Error((m || "eq") + `: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }

for (const name of ["ELEGANT_SMOKE", "REGAL_STEADY", "CHAOTIC_SPECTRAL"]) {
  const profile = MOTION_PROFILES[name];
  assert(profile, name);
  for (const key of ["floatY", "headDriftX", "headDriftY", "pupilRange", "blinkMinMs", "blinkMaxMs", "auraDrift", "particleSpeed"]) {
    assert(typeof profile[key] === "number" && profile[key] > 0, name + " " + key);
  }
  assert(profile.blinkMaxMs > profile.blinkMinMs, name + " blink window");
}
assert(MOTION_PROFILES.REGAL_STEADY.floatY < MOTION_PROFILES.ELEGANT_SMOKE.floatY, "regal sits stiller than smoke");
assert(MOTION_PROFILES.CHAOTIC_SPECTRAL.floatY > MOTION_PROFILES.ELEGANT_SMOKE.floatY, "spectral drifts more");
assert(MOTION_PROFILES.CHAOTIC_SPECTRAL.blinkMinMs < MOTION_PROFILES.REGAL_STEADY.blinkMinMs, "spectral blinks sooner");

const book = new BrandBook();
const neon = MOTION_PROFILES.NEON_COMPETITIVE;
assert(neon, "neon profile");
eq(neon.floatY, 3.2, "neon float");
eq(neon.headDriftX, 1.8, "neon head drift");
eq(neon.pupilRange, 1.8, "neon pupils");
eq(neon.blinkMinMs, 2600, "neon blink min");
eq(neon.blinkMaxMs, 5800, "neon blink max");
eq(neon.auraDrift, 8, "neon aura");
eq(neon.pulseMin, 0.82, "neon pulse min");
eq(neon.pulseMax, 1, "neon pulse max");
eq(neon.glowDuration, 1.9, "neon glow");
eq(neon.scanDriftY, 10, "neon scan");
eq(neon.particleAlphaMin, 0.38, "neon particle min");
eq(neon.particleAlphaMax, 0.66, "neon particle max");
assert(neon.blinkMaxMs > neon.blinkMinMs, "neon blink window");

eq(profileForBrand(book.full("dracula")), "NEON_COMPETITIVE", "dracula profile");
eq(profileForBrand(book.full("caesar")), "NEON_COMPETITIVE", "caesar profile");
eq(profileForBrand(book.full("reaper")), "NEON_COMPETITIVE", "reaper profile");
eq(book.publicOf("athena").animatedPfp.motionProfile, "NEON_COMPETITIVE", "athena uses the neon rig");
eq(book.publicOf("jester").animatedPfp.motionProfile, "NEON_COMPETITIVE", "jester profile");
eq(profileForBrand({ animatedPfp: { motionProfile: "REGAL_STEADY" } }), "REGAL_STEADY", "explicit profile still wins");

for (const id of ["dracula", "caesar", "reaper"]) {
  const view = book.publicOf(id);
  const motion = view.animatedPfp;
  assert(motion && motion.enabled && motion.version === 1, id + " animatedPfp");
  eq(motion.engine, "procedural-svg", id + " engine");
  eq(motion.qualityTier, "LAYERED_2_5D", id + " tier");
  eq(motion.manifestUrl, null, id + " has no webp manifest");
  assert(motion.previewUrl.includes(id), id + " poster");
  eq(motion.manifest.poster, motion.previewUrl, id + " poster fallback");
  eq(motion.manifest.source, "procedural-svg", id + " synthetic manifest");
  assert(motion.manifest.layers.eyesOpen === "procedural" && motion.manifest.layers.pupils === "procedural", id + " layers");
  assert(motion.manifest.layers.bgGrid === "procedural" && motion.manifest.layers.rimGlow === "procedural" && motion.manifest.layers.scanFx === "procedural", id + " neon layers");
  eq(motion.styleId, "neon-competitive", id + " style id");
  eq(view.pfpStyleId, "neon-competitive", id + " public style");
  assert(!book.full(id).animatedPfp, id + " disk record stays free of the view field");
}

const meta = animatedPfpMeta({ motionLanguage: "FAST_CONFIDENT", archetype: "GAMBLER" }, "/api/show/agents/u_vesper/pfp.svg");
eq(meta.motionProfile, "NEON_COMPETITIVE", "created agent uses the neon rig");
eq(profileForBrand({ archetype: "TRICKSTER", visualIdentity: { motionLanguage: "CHAOTIC_UNEVEN" } }), "NEON_COMPETITIVE", "trickster concept");
eq(profileForBrand({ archetype: "MACHINE", visualIdentity: { motionLanguage: "MECHANICAL_PRECISE" } }), "NEON_COMPETITIVE", "machine concept");

for (const context of ["watch", "profile", "reveal", "hero"]) {
  assert(shouldAnimate({ context }), context + " plays");
}
for (const context of ["leaderboard", "market", "history", "roster", "list"]) {
  assert(!shouldAnimate({ context }), context + " stays static");
}
assert(!shouldAnimate({ context: "watch", reducedMotion: true }), "reduced motion is a poster");
assert(!shouldAnimate({ context: "reveal", lowPower: true }), "save-data is a poster");
assert(!shouldAnimate({ context: "hero", enabled: false }), "disabled portrait stays still");

const gaps = [0, 1, 2, 3, 4].map((i) => blinkWindow(MOTION_PROFILES.ELEGANT_SMOKE, 42, i).gap);
assert(new Set(gaps.map((n) => Math.round(n))).size > 1, "blink gaps are not a fixed loop");
assert(gaps.every((n) => n >= 2600 && n <= 6200), "blink gaps stay in the profile window");
const first = blinkWindow(MOTION_PROFILES.CHAOTIC_SPECTRAL, 7, 0);
assert(!blinkClosed(0, MOTION_PROFILES.CHAOTIC_SPECTRAL, 7), "eyes start open");
assert(blinkClosed(first.gap + 20, MOTION_PROFILES.CHAOTIC_SPECTRAL, 7), "a blink closes the eyes");
assert(!blinkClosed(first.gap + first.hold + 80, MOTION_PROFILES.CHAOTIC_SPECTRAL, 7), "the blink opens again");

const neonPose = poseAt(1400, "NEON_COMPETITIVE", "idle", 3);
assert(neonPose.floatY <= MOTION_PROFILES.NEON_COMPETITIVE.floatY, "neon float stays inside the profile");
assert(neonPose.rimAlpha >= 0.82 && neonPose.rimAlpha <= 1, "rim glow stays in the pulse window");
assert(neonPose.particleAlpha >= 0.38 && neonPose.particleAlpha <= 0.66, "particle alpha stays in the neon window");
assert(Math.abs(neonPose.scanY) <= 10, "scan drift stays in the profile");
const neonGaps = [0, 1, 2, 3, 4].map((i) => blinkWindow(MOTION_PROFILES.NEON_COMPETITIVE, 9, i).gap);
assert(neonGaps.every((n) => n >= 2600 && n <= 5800), "neon blink gaps stay in the profile window");

const elegant = poseAt(1400, "ELEGANT_SMOKE", "idle", 3);
const regal = poseAt(1400, "REGAL_STEADY", "idle", 3);
const spectral = poseAt(1400, "CHAOTIC_SPECTRAL", "idle", 3);
const active = poseAt(1400, "ELEGANT_SMOKE", "activeTurn", 3);
assert(elegant.floatY > regal.floatY, "idle float follows the profile");
assert(spectral.floatY > elegant.floatY, "spectral float is the largest");
assert(active.floatY > elegant.floatY, "active turn breathes a little more");
assert(elegant.eyesClosed === false || elegant.eyesClosed === true, "pose names the blink");
const later = poseAt(4200, "ELEGANT_SMOKE", "idle", 3);
assert(later.pupilX !== elegant.pupilX || later.pupilY !== elegant.pupilY || later.headX !== elegant.headX, "the pose keeps moving");

function fakeLayer(name, opacity) {
  const attrs = { "data-layer": name };
  if (opacity != null) attrs.opacity = opacity;
  return {
    attrs,
    getAttribute(key) { return this.attrs[key]; },
    setAttribute(key, value) { this.attrs[key] = value; },
    removeAttribute(key) { delete this.attrs[key]; },
  };
}
function fakeSvg() {
  const nodes = ["torso", "head", "hairFront", "pupils", "eyesOpen", "eyesClosed", "aura", "bgFx", "particles", "collarFx"].map((name) => fakeLayer(name, name === "eyesClosed" ? "0" : null));
  return {
    querySelector(sel) {
      const found = /data-layer="([^"]+)"/.exec(sel || "");
      return found ? nodes.find((node) => node.attrs["data-layer"] === found[1]) || null : null;
    },
    querySelectorAll() { return nodes; },
  };
}
const svg = fakeSvg();
applyPose(svg, elegant);
assert(svg.querySelector('[data-layer="torso"]').getAttribute("transform").includes("scale"), "torso breathes");
assert(svg.querySelector('[data-layer="pupils"]').getAttribute("transform").includes("translate"), "pupils drift");
applyPose(svg, { rest: true });
assert(!svg.querySelector('[data-layer="head"]').getAttribute("transform"), "pause returns to the poster pose");
eq(svg.querySelector('[data-layer="eyesClosed"]').getAttribute("opacity"), "0", "rest pose keeps eyes open");

for (const brand of SEED_BRANDS) {
  const recipe = recipeFromBrand(brand);
  const drawn = renderPfp(recipe, { size: 1024, nonce: brand.agentId });
  const small = renderPfp(recipe, { size: 48, nonce: brand.agentId });
  const quality = qualityCheck(recipe, drawn);
  assert(quality.ok, brand.agentId + " still passes portrait quality " + quality.reasons.join(","));
  eq(pathData(drawn), pathData(small), brand.agentId + " sizes still share paths");
  assert(drawn.includes('data-layered="1"'), brand.agentId + " layered hook");
  assert(drawn.includes('data-engine="procedural-svg"'), brand.agentId + " engine");
  for (const layer of ["bg", "bgGrid", "torso", "head", "eyesOpen", "eyesClosed", "pupils", "rimGlow", "aura", "scanFx"]) {
    assert(drawn.includes(`data-layer="${layer}"`), brand.agentId + " layer " + layer);
  }
  assert(drawn.includes('data-pfp-style="neon-competitive"'), brand.agentId + " neon style");
  assert(/data-layer="eyesClosed"[^>]*opacity="0"/.test(drawn), brand.agentId + " closed eyes stay hidden on the poster");
  assert(!/<animate[\s>]|script|foreignObject/i.test(drawn), brand.agentId + " poster does not run its own timeline");
}

const publicDir = path.join(__dirname, "..", "public");
const app = fs.readFileSync(path.join(publicDir, "app.js"), "utf8");
const html = fs.readFileSync(path.join(publicDir, "app.html"), "utf8");
assert(html.includes("animated-pfp.js") && html.indexOf("animated-pfp.js") < html.indexOf("app.js"), "runtime loads before the app");
assert(app.includes('context: "watch"'), "watch seats opt in");
assert(app.includes('data-context="reveal"'), "create reveal opts in");
assert(app.includes('context: "hero"'), "arena hero opts in");
assert(app.includes('"profile"'), "agent profile opts in");
assert(app.includes("animatePfp: false"), "history replay stays on the poster");
assert(app.includes("facePlate(a, 320)") && !app.includes('context: "roster"'), "roster rows are not animated mounts");
assert(!app.includes('context: "market"') && !app.includes('context: "history"'), "market and history rows are not animated mounts");

console.log("animated pfp ok");
