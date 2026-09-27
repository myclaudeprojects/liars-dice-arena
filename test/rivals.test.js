// Rival rows on an agent profile: the head-to-head line stays under the name,
// and the whole row opens that rival's in-app profile.
const fs = require("fs");
const path = require("path");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }

const app = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "public", "app.css"), "utf8");

assert(app.includes('class="rowbtn rival-note" type="button"'), "a rival row is a button");
assert(app.includes('data-agent="${esc(r.id)}"'), "a rival row uses the profile hook");
assert(app.includes("rival-note__identity"), "name and title share one block");
assert(app.includes("rival-note__record"), "the head-to-head line is its own element");
assert(app.includes("· head to head"), "meetings of two or more still say head to head");
assert(app.includes("await openAgent(agentBtn.dataset.agent)"), "activating the row opens the in-app profile");
assert(!app.includes('<div class="rowbtn rival-note"'), "rival rows are not static text");

const ruleStart = css.indexOf(".rowbtn.rival-note {");
assert(ruleStart >= 0, "rival rows have their own layout rule");
const rule = css.slice(ruleStart, css.indexOf(".rival-note__face"));
assert(rule.includes("display: grid"), "the row is a grid, not a wrapping flex line");
assert(rule.includes("minmax(0, 1fr)"), "the name column can shrink");
assert(rule.includes('"face identity"'), "avatar sits beside the name");
assert(rule.includes('"record record"'), "the record occupies its own full-width line");
const recordRule = css.slice(css.indexOf(".rowbtn.rival-note .rival-note__record"), css.indexOf(".rowbtn.rival-note .rival-note__record") + 280);
assert(recordRule.includes("grid-area: record"), "the record is placed on that line");
assert(recordRule.includes("flex: none"), "the shared row flex basis cannot pull the record sideways");

console.log("rivals ok");
