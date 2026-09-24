const fs = require("fs");
const path = require("path");
const ui = require("../public/ui");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }

function lin(c) {
  c /= 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = lin((n >> 16) & 255);
  const g = lin((n >> 8) & 255);
  const b = lin(n & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const hi = Math.max(luminance(a), luminance(b));
  const lo = Math.min(luminance(a), luminance(b));
  return (hi + 0.05) / (lo + 0.05);
}

const root = path.join(__dirname, "..", "public");
const tokens = fs.readFileSync(path.join(root, "tokens.css"), "utf8");
const primitives = fs.readFileSync(path.join(root, "primitives.css"), "utf8");
const appCss = fs.readFileSync(path.join(root, "app.css"), "utf8");
const appJs = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "app.html"), "utf8");

function tokenHex(name) {
  const m = tokens.match(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ":\\s*(#[0-9a-fA-F]{6})"));
  assert(m, "missing hex token " + name);
  return m[1];
}

const required = [
  "--lda-bg", "--lda-surface", "--lda-surface-2", "--lda-text", "--lda-text-muted",
  "--lda-live", "--lda-live-fill", "--lda-critical", "--lda-win", "--lda-loss", "--lda-prediction",
  "--agent-dracula", "--agent-caesar", "--agent-reaper", "--agent-jester",
  "--space-1", "--space-4", "--radius-lg", "--lda-border-opacity",
  "--lda-shadow-1", "--lda-shadow-2",
  "--lda-font-display", "--lda-font-sans", "--type-display-lg", "--type-ui",
  "--dur-micro", "--dur-ui", "--dur-cinematic", "--ease-standard", "--ease-emphasis",
  "--z-chrome", "--z-nav", "--z-overlay",
  "--tap", "--lda-focus",
];
for (const name of required) assert(tokens.includes(name + ":"), "token " + name);

assert(tokens.includes("--brand-dracula-accent: #F43B5F"), "dracula brand accent token");
assert(tokens.includes("--agent-dracula: var(--brand-dracula-accent)"), "cast accent aliases the brand accent");
assert(tokens.includes("--bg: var(--lda-bg)"), "legacy background alias");

const pairs = [
  ["text on bg", "--lda-text", "--lda-bg"],
  ["muted on surface", "--lda-text-muted", "--lda-surface"],
  ["live on bg", "--lda-live", "--lda-bg"],
  ["ivory on live fill", "--lda-text", "--lda-live-fill"],
  ["critical on bg", "--lda-critical", "--lda-bg"],
  ["win on surface", "--lda-win", "--lda-surface"],
  ["loss on surface", "--lda-loss", "--lda-surface"],
  ["prediction on bg", "--lda-prediction", "--lda-bg"],
  ["ink on prediction", "--lda-prediction-ink", "--lda-prediction"],
  ["ink on gold", "--lda-ink", "--lda-gold"],
];
for (const [label, fg, bg] of pairs) {
  const ratio = contrast(tokenHex(fg), tokenHex(bg));
  assert(ratio >= 4.5, label + " contrast " + ratio.toFixed(2));
}

for (const name of [
  ".lda-btn", ".lda-card", ".lda-avatar", ".lda-badge-live", ".lda-pill",
  ".lda-match", ".lda-result", ".lda-choice", ".lda-choice-yes", ".lda-choice-no",
]) {
  assert(primitives.includes(name), "primitive " + name);
}
for (const state of [":hover", ":focus-visible", ":disabled", ".is-loading", ".is-selected", "prefers-reduced-motion"]) {
  assert(primitives.includes(state), "state " + state);
}
assert(primitives.includes("transform: none"), "reduced motion clears button press");

const dracula = ui.avatar("Dracula", 350, "dracula");
assert(dracula.includes('data-cast="dracula"'), "known agent uses the accent token");
assert(dracula.includes("lda-avatar"), "avatar shell class");
assert(!dracula.includes("data-agent"), "avatar does not steal agent clicks");
const guest = ui.avatar("Guest", 12);
assert(guest.includes("--agent-accent:hsl(12 42% 58%)"), "unknown hue still paints a shell");
assert(guest.includes("lda-avatar-glyph"), "missing pfp falls back to the letter shell");
const photo = ui.avatar("Vesper", 200, "u_vesper", { src: "/api/show/agents/u_vesper/pfp.svg?size=96", size: 96 });
assert(photo.includes("lda-pfp") && photo.includes("width=\"96\"") && !photo.includes("lda-avatar-glyph"), "pfp url replaces the letter");
const versioned = ui.avatar("Vesper", 200, "u_vesper", { src: "/api/show/agents/u_vesper/pfp.svg?size=96&v=2", size: 96 });
assert(versioned.includes("v=2") && !versioned.includes("lda-avatar-glyph"), "cache-busted pfp url replaces the letter");
const bogus = ui.avatar("Vesper", 200, "u_vesper", { src: "https://example.com/face.png" });
assert(bogus.includes("lda-avatar-glyph"), "outside portrait urls stay on the letter");

const yes = ui.choice({ side: "yes", price: "62¢", detail: "Dracula wins this match", data: { "pick-side": "yes" } });
assert(yes.includes("lda-choice-yes") && yes.includes(">YES<") && yes.includes("data-pick-side=\"yes\""), "yes choice");
assert(yes.includes("aria-pressed=\"false\""), "choice exposes pressed state");
const busy = ui.choice({ side: "no", price: "38¢", detail: "does not win", loading: true, extra: "lda-choice-compact" });
assert(busy.includes("disabled") && busy.includes("aria-busy=\"true\"") && busy.includes("Working."), "loading choice");
assert(busy.includes("lda-choice-compact") && !busy.includes("giant"), "compact choice drops the giant class");

const pill = ui.statPill("+12", "Test PnL", "win");
assert(pill.includes("lda-pill") && pill.includes("is-win") && pill.includes("Test PnL"), "stat pill");
assert(ui.cardClass("match") === "lda-card lda-match", "match card classes");
assert(ui.cardClass("result") === "lda-card lda-result", "result banner classes");
assert(ui.liveBadge("Live", {}).includes("lda-badge-live") && ui.liveBadge("Final", { final: true }).includes("lda-badge-final"), "live and final badges");
assert(ui.marketBadge("TEST MARKET").includes("test-badge") && ui.marketBadge("TEST MARKET").includes("lda-badge-market"), "test market badge");

assert(html.includes('id="match"') && html.includes('id="market"') && html.includes('id="sheet"'), "watch paints the table, market, and sheet apart");
assert(html.includes('id="live-line"'), "match lines announce from a stable node");
assert(html.includes("tokens.css"), "page loads tokens");
assert(html.includes("primitives.css"), "page loads primitives");
assert(html.indexOf("ui.js") < html.indexOf("app.js"), "helpers load before the app");
assert(appJs.includes("ldaUi"), "watch markup uses the helpers");
assert(appJs.includes("data-skip") && appJs.includes("syncDirector"), "presentation wiring stays");
assert(appJs.includes("brand-title") && appJs.includes("market-identity"), "brand name plates reach markets");
assert(appJs.includes("data-motion"), "motion language reaches the seat");
assert(primitives.includes(".lda-emblem") && primitives.includes(".lda-palette"), "emblem and palette primitives");
assert(primitives.includes("lda-choice-yes"), "market controls stay on the prediction treatment");
assert(appJs.includes("scrollHold") && !appJs.includes("scrollIntoView"), "live updates do not pull the viewport");
assert(appJs.includes("preventScroll"), "restored focus does not scroll");

assert(!/#[0-9a-fA-F]{3,8}/.test(appCss), "app.css has no one-off hex");
assert(!appCss.includes("rgba("), "app.css has no one-off rgba");
assert(appCss.includes("var(--lda-"), "app.css consumes lda tokens");
for (const name of [".stage", ".liar-type", ".think-line", ".felt", "thinkPulse", "@keyframes tumble", "@keyframes slam"]) {
  assert(appCss.includes(name), "viewer css kept " + name);
}
assert(appCss.includes("prefers-reduced-motion") && appCss.includes("transform: none"), "viewer reduced motion stays");
assert(appCss.includes(".career-line, .career-line * { animation: none"), "career line stays still");

const presentation = fs.readFileSync(path.join(root, "presentation.js"), "utf8");
assert(presentation.includes("class AnimationDirector"), "animation director untouched");

console.log("visual ok");
