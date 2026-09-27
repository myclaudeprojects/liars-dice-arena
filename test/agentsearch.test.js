// Spectators find an agent from the roster already loaded on the Agents tab.
// Matching is client-side: display name, ticker/symbol, and Argus token address.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }
function eq(a, b, m) { if (a !== b) throw new Error((m || "eq") + `: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }

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

const app = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "public", "app.css"), "utf8");
const names = ["agentSearchNorm", "agentSearchHaystack", "agentMatchesQuery", "agentSearchExact", "agentSearchPick"];
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(names.map((name) => sliceFn(app, name)).join("\n"), sandbox);

const NIGHT = "0xF74C1294d67827fF7EaFb21D834B67aB1C8a79D0";
const tilt = { id: "tilt", name: "LDA Tiltpickle", argus: { symbol: "TILT", tokenAddress: "0x1111111111111111111111111111111111111111" } };
const night = { id: "night", name: "LDA Nightshade", argus: { symbol: "NIGHTSHADEX", tokenAddress: NIGHT } };
const fan = { id: "fan", name: "LDA Tiltpickle Fan", argus: { symbol: "FAN", ticker: "FAN" } };
const shark = { id: "shark", name: "LDA The Shark", argus: null };
const roster = [shark, tilt, night, fan];

roster.forEach((agent) => assert(sandbox.agentMatchesQuery(agent, "  "), agent.name + " stays in an empty query"));
assert(!sandbox.agentMatchesQuery(shark, "0xf74c"), "a house agent without a token does not match an address");
assert(sandbox.agentMatchesQuery(tilt, "tiltpickle"), "name match ignores case");
assert(sandbox.agentMatchesQuery(tilt, "TILT"), "ticker match ignores case");
assert(sandbox.agentMatchesQuery(night, NIGHT.toLowerCase()), "full address match ignores case");
assert(sandbox.agentMatchesQuery(night, "0xF74C"), "partial 0x address matches");
assert(sandbox.agentMatchesQuery(night, "f74c1294"), "address match does not require the 0x prefix");
assert(sandbox.agentMatchesQuery(night, "1c8a79d0"), "address match can use the tail");
assert(!sandbox.agentMatchesQuery(night, "0xdead"), "a different address is not a match");
assert(!sandbox.agentMatchesQuery(shark, "zzzz-no-such-agent"), "unknown text matches nobody");

const byName = roster.filter((agent) => sandbox.agentMatchesQuery(agent, "Tiltpickle"));
eq(byName.length, 2, "partial name keeps every display-name hit");
eq(sandbox.agentSearchPick(roster, "Tiltpickle").id, "tilt", "confirming Tiltpickle opens the roster name, not a longer name");
eq(sandbox.agentSearchPick(roster, "nightshadex").id, "night", "confirming a ticker opens that agent");
eq(sandbox.agentSearchPick(roster, "0xf74c1294d67827ff7eafb21d834b67ab1c8a79d0").id, "night", "confirming the full address opens Nightshade");
eq(sandbox.agentSearchPick(roster, "shark").id, "shark", "one name hit is enough to confirm");
assert(sandbox.agentSearchPick(roster, "") === null, "an empty query does not auto-open anyone");
assert(sandbox.agentSearchPick(roster, "lda") === null, "a query that hits several agents waits for a tap");

assert(app.includes('data-agent-search'), "Agents tab has a search field");
assert(app.includes("Find an agent"), "the search field is labeled");
assert(app.includes("Name, ticker, or 0x address"), "the placeholder names the three fields");
assert(app.includes("No agent has that name, ticker, or token address."), "no matches has a short empty state");
assert(app.includes("function agentsView()"), "the roster view still owns the tab");
assert(app.includes("agentSearchForm()"), "the loaded roster renders the search field");
assert(app.includes("agentMatchesQuery(a, agentQuery)"), "filtering uses the agents already on the tab");
assert(!app.includes("/api/show/agents?q=") && !app.includes("/api/show/agents/search"), "search does not add a server endpoint");
assert(app.includes('data-create-agent="1"'), "Create agent stays on the tab");
assert(app.includes("submitServerMint"), "Argus mint path stays");
assert(app.includes("houseMintReady"), "house mint path stays");
assert(app.includes("async function openAgent(id)"), "a match opens through one profile path");
assert(app.includes("await openAgent(agentBtn.dataset.agent)"), "tapping a card still opens the profile");
assert(app.includes("await openAgent(pick.id)"), "confirming a search opens that same profile");
assert(app.includes("data-back=\"agents\""), "profile still returns to the roster");

const fieldRule = css.slice(css.indexOf(".agent-search input[type=\"search\"]"), css.indexOf(".agent-search__clear"));
assert(fieldRule.startsWith(".agent-search input[type=\"search\"]"), "search has its own field rule");
assert(fieldRule.includes("var(--lda-surface)"), "the field uses the arena surface");
assert(fieldRule.includes("min-height: var(--tap)"), "the field keeps a tap target");
assert(fieldRule.includes("font-size: 16px"), "the field stays at 16px so mobile does not zoom");
assert(fieldRule.includes("color-scheme: dark"), "the native clear control stays visible on the dark field");
assert(css.includes(".agent-search__clear[hidden]"), "Clear can hide without fighting the button display");

console.log("agentsearch ok");
