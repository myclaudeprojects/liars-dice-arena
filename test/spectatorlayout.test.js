// Spectator rail: one column for the header, pages, and desktop tab bar.
// Leaving Watch must clear the market slot or later pages keep that column.
const fs = require("fs");
const path = require("path");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }

const publicDir = path.join(__dirname, "..", "public");
const app = fs.readFileSync(path.join(publicDir, "app.js"), "utf8");
const css = fs.readFileSync(path.join(publicDir, "app.css"), "utf8");

assert(app.includes("prev !== null && html === prev"), "empty slots still repaint when the cache was cleared");
assert(app.includes("arriving ? null : paintedMarket"), "a tab change forces the market slot to paint");
assert(css.includes("lda-pfp-idle") && css.includes("translate3d"), "idle float stays on raster portraits");
assert(css.includes("--rail-width"), "header and tab bar share a content rail");
assert(css.includes("--column-max: 720px"), "the spectator column stays the card width");
assert(/:root:has\(#market:not\(:empty\)\)/.test(css), "Watch's market column widens the rail");
assert(!css.includes("min(640px, calc(100% - 40px))"), "the desktop tab bar is no longer a fixed 640px pill");
assert(css.includes(".creator-actions") && css.includes("bottom: calc(var(--tabbar-offset) + 10px)"), "wizard actions sit above the tab bar");
assert(css.includes(".agent-card__portrait .agent-avatar { padding: 0; }"), "roster portraits fill the card frame");
assert(css.includes(".arena-shell .agent-portrait-wrap .agent-avatar { padding: 0; }"), "watch portraits fill the seat frame");

console.log("spectator layout ok");
