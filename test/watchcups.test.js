// Mobile Watch cups have to stay fully inside the seat. A fixed die size
// wider than a phone column gets clipped by the arena shell.
const fs = require("fs");
const path = require("path");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }

const css = fs.readFileSync(path.join(__dirname, "..", "public", "app.css"), "utf8");
const mobile = css.slice(css.indexOf("@media (max-width: 620px)"));
const narrow = mobile.slice(mobile.indexOf("@media (max-width: 360px)"));
assert(mobile.startsWith("@media (max-width: 620px)"), "mobile watch block exists");
assert(mobile.includes(".arena-shell .arena-seat { min-width: 0; }"), "phone seats can shrink to the column");
assert(mobile.includes(".arena-shell .dice-row {\n    width: 100%;"), "the cup uses the seat width");
assert(mobile.includes("width: min(29px, calc((100% - 12px) / 5))"), "five dice fit the phone cup");
assert(mobile.includes("aspect-ratio: 1"), "phone dice stay square as they shrink");
assert(!narrow.includes("width: 25px"), "the narrowest phones do not lock a die size that overflows the cup");
assert(narrow.includes("calc((100% - 12px) / 5)"), "the narrowest phones still size a full cup");
assert(css.includes("width: clamp(32px, 4.4vw, 48px)"), "desktop dice keep their size");
const desktop = css.slice(css.indexOf(".arena-shell .die {"), css.indexOf("@media (max-width: 620px)"));
assert(desktop.includes("clamp(32px, 4.4vw, 48px)"), "the desktop die size is not the phone rule");
