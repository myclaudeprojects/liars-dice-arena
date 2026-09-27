// Create Agent rolls a callsign and a matching line. It must not stick on one name.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }
function eq(a, b, m) { if (a !== b) throw new Error((m || "eq") + `: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }

const app = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");

assert(!app.includes("Nightshade"), "create no longer suggests Nightshade");
assert(!app.includes('placeholder="Nightshade"'), "the name field has no fixed Nightshade placeholder");
assert(app.includes('placeholder="Callsign"'), "an empty name field asks for a callsign");
assert(app.includes("data-refresh-suggestion"), "create can roll another suggestion");
assert(app.includes("New suggestion"), "the refresh control is labeled");
assert(app.includes("applyAgentSuggestion()"), "opening create rolls a suggestion");
assert(app.includes('data-refresh-suggestion="1"'), "the button rolls another pair");
assert(app.includes("saved on the roster as LDA plus this name"), "the roster still prefixes LDA");
assert(app.includes("data-more-faces"), "different faces stays on create");
assert(!app.includes("Regenerate PFP") && !app.includes("data-regenerate-pfp"), "portrait regenerate stays gone");

function sliceFn(source, name) {
  const token = "function " + name + "(";
  const start = source.indexOf(token);
  if (start < 0) throw new Error("missing " + name);
  let i = source.indexOf("{", start);
  let depth = 0;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error("unclosed " + name);
}

const catalogStart = app.indexOf("const CREATOR_ARCHETYPES");
const catalogEnd = app.indexOf("const CREATOR_BEATS");
assert(catalogStart >= 0 && catalogEnd > catalogStart, "suggestion catalog sits with the archetypes");

const sandbox = { creator: null };
vm.createContext(sandbox);
vm.runInContext(
  app.slice(catalogStart, catalogEnd) + "\n" + [
    "this.CREATOR_ARCHETYPES = CREATOR_ARCHETYPES;",
    "this.AGENT_SUGGESTIONS = AGENT_SUGGESTIONS;",
    "this.suggestAgentCallsign = suggestAgentCallsign;",
    "this.applyAgentSuggestion = applyAgentSuggestion;",
  ].join("\n"),
  sandbox,
);
vm.runInContext(sliceFn(app, "rosterNamePreview"), sandbox);

const resume = sliceFn(app, "resumeCreator");
assert(!resume.includes("applyAgentSuggestion"), "resuming an agent keeps the saved name");
const opened = sliceFn(app, "openCreator");
assert(opened.includes("applyAgentSuggestion()"), "open rolls before the first paint");

const archetypes = sandbox.CREATOR_ARCHETYPES;
const book = sandbox.AGENT_SUGGESTIONS;
eq(archetypes.length, 20, "creator archetypes stay the shared list");
const seenNames = new Set();
for (const id of archetypes) {
  const row = book[id];
  assert(row && row.names.length >= 3 && row.lines.length >= 2, id + " has several callsigns and lines");
  for (const name of row.names) {
    assert(/^[A-Za-z][A-Za-z0-9 '\-]{1,27}$/.test(name), name + " is a short callsign");
    assert(!/^lda\b/i.test(name), name + " leaves the LDA prefix to the roster");
    const key = name.toLowerCase();
    assert(!seenNames.has(key), name + " is not reused");
    seenNames.add(key);
  }
  for (const line of row.lines) {
    assert(line.length >= 8 && line.length <= 240, id + " line fits the description field");
  }
}
assert(seenNames.size >= 60, "the pool is more than one favorite");

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function checkPair(pair) {
  const row = book[pair.archetype];
  assert(row, "rolled archetype is in the catalog");
  assert(row.names.includes(pair.name), "callsign belongs to that archetype");
  assert(row.lines.includes(pair.line), "line belongs to that archetype");
  assert(pair.name.toLowerCase() !== "nightshade", "a roll is not Nightshade");
}

const zeros = sandbox.suggestAgentCallsign(() => 0, "");
eq(zeros.archetype, "GAMBLER", "a zero roll uses the first archetype");
eq(zeros.name, "Neon Ace", "a zero roll uses that archetype's first callsign");
const skipped = sandbox.suggestAgentCallsign(() => 0, "Neon Ace");
eq(skipped.archetype, "GAMBLER", "avoid stays on the same archetype when the roll says so");
eq(skipped.name, "Lucky Dice", "avoid skips the callsign just shown");
assert(skipped.name !== zeros.name, "a refresh is a different callsign");

const high = sandbox.suggestAgentCallsign(() => 0.999, "");
eq(high.archetype, "COMMANDER", "a high roll reaches the last archetype");
eq(high.name, "Solar Knox", "a high roll uses that archetype's last callsign");
checkPair(high);

const rolled = new Set();
const kinds = new Set();
let previous = "";
const rand = mulberry32(20260927);
for (let i = 0; i < 80; i++) {
  const pair = sandbox.suggestAgentCallsign(rand, previous);
  checkPair(pair);
  assert(pair.name.toLowerCase() !== previous.toLowerCase(), "refresh does not repeat the previous callsign");
  rolled.add(pair.name);
  kinds.add(pair.archetype);
  previous = pair.name;
}
assert(rolled.size >= 15, "repeated refreshes vary the callsign");
assert(kinds.size >= 8, "repeated refreshes vary the archetype");

sandbox.creator = {
  suggestion: null,
  form: { name: "", shortDescription: "" },
};
const first = sandbox.applyAgentSuggestion(() => 0);
eq(sandbox.creator.form.name, "Neon Ace", "open fills the name field");
eq(sandbox.creator.form.shortDescription, first.line, "open fills the matching line");
eq(sandbox.rosterNamePreview(sandbox.creator.form.name), "LDA Neon Ace", "the roster preview adds LDA once");
const second = sandbox.applyAgentSuggestion(() => 0);
eq(sandbox.creator.form.name, "Lucky Dice", "refresh replaces the callsign");
eq(sandbox.creator.form.shortDescription, second.line, "refresh replaces the line");
eq(sandbox.rosterNamePreview(sandbox.creator.form.name), "LDA Lucky Dice", "the new roster name is still prefixed once");
assert(second.line === book.GAMBLER.lines[0], "the new line still fits the rolled archetype");

console.log("agentsuggest ok");
