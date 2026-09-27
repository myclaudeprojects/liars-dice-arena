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
const names = ["agentSearchNorm", "agentSearchHaystack", "agentMatchesQuery", "agentSearchExact", "agentSearchPick", "createdAgentOrder"];
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
assert(app.includes("async function openAgent(id, opts)"), "a match opens through one profile path");
assert(app.includes("await openAgent(agentBtn.dataset.agent)"), "tapping a card still opens the profile");
assert(app.includes("await openAgent(pick.id)"), "confirming a search opens that same profile");
assert(app.includes("data-back=\"agents\""), "profile still returns to the roster");

const older = { id: "old", roster: "user", createdAt: "2024-01-01T00:00:00.000Z", name: "LDA Older" };
const newer = { id: "new", roster: "user", createdAt: "2026-06-01T00:00:00.000Z", name: "LDA Newer" };
const house = { id: "shark", roster: "house", createdAt: "2027-01-01T00:00:00.000Z", name: "LDA The Shark" };
eq(sandbox.createdAgentOrder([older, house, newer]).map((agent) => agent.id).join(","), "new,old", "created agents are newest first and the house cast stays out");
eq(sandbox.createdAgentOrder([newer, older].filter((agent) => sandbox.agentMatchesQuery(agent, "older"))).map((agent) => agent.id).join(","), "old", "search still filters the created directory");

assert(app.includes("data-agent-directory"), "Agents tab has a created-agent directory");
assert(app.includes("createdAgentOrder(hits)"), "the directory uses newest-first order on the loaded roster");
assert(app.includes("Buy on Argus"), "a minted agent links out to buy on Argus");
assert(app.includes("argusTokenUrl(agent.argus)"), "the directory link uses the Argus token url");
assert(app.includes("No token yet"), "a created agent without a mint still appears");
assert(app.includes("The house wallet is the on-chain fee recipient."), "the directory notes who receives fees");
assert(app.includes("Spectator splits are later, off this page."), "spectator fee splits stay off this page");
assert(app.includes("function agentIdFromLocation()"), "a profile can be opened from the address bar");
assert(app.includes('params.set("agent", id)'), "opening a profile writes ?agent=");
assert(app.includes('history: "keep"'), "a bookmark does not push another history entry");
assert(!app.includes("Regenerate PFP") && !app.includes("data-regenerate-pfp"), "spectator regenerate controls stay gone");

const directoryRule = css.slice(css.indexOf(".agent-directory__row"), css.indexOf(".agent-directory__open"));
assert(directoryRule.includes("var(--lda-surface)"), "directory rows use the arena surface");
assert(css.includes(".agent-directory__open"), "the directory name is its own control");
assert(css.slice(css.indexOf(".agent-directory__open"), css.indexOf(".agent-directory__name")).includes("min-height: var(--tap)"), "the directory name keeps a tap target");

const fieldRule = css.slice(css.indexOf(".agent-search input[type=\"search\"]"), css.indexOf(".agent-search__clear"));
assert(fieldRule.startsWith(".agent-search input[type=\"search\"]"), "search has its own field rule");
assert(fieldRule.includes("var(--lda-surface)"), "the field uses the arena surface");
assert(fieldRule.includes("min-height: var(--tap)"), "the field keeps a tap target");
assert(fieldRule.includes("font-size: 16px"), "the field stays at 16px so mobile does not zoom");
assert(fieldRule.includes("color-scheme: dark"), "the native clear control stays visible on the dark field");
assert(css.includes(".agent-search__clear[hidden]"), "Clear can hide without fighting the button display");

const os = require("os");
const { Show } = require("../src/showrunner");
const show = new Show({
  dataPath: path.join(os.tmpdir(), `lda-agent-dir-${process.pid}.json`),
  sleep: async () => {},
  loopEnabled: false,
  bootstrapCount: 0,
  marketsEnabled: false,
});
const base = {
  shortDescription: "A quiet closer who spends one lie and waits.",
  archetype: "ASSASSIN",
  aggression: 0.42,
  bluffing: 0.66,
  discipline: 0.81,
  chaos: 0.18,
};
const first = show.createAgent({ ...base, name: "Oldercoin" });
const second = show.createAgent({ ...base, name: "Newercoin" });
show.userAgents.get(first.agent.id).createdAt = "2024-01-01T00:00:00.000Z";
show.userAgents.get(second.agent.id).createdAt = "2026-06-01T00:00:00.000Z";
show.userAgents.get(second.agent.id).argus = {
  status: "minted",
  tokenAddress: "0xF74C1294d67827fF7EaFb21D834B67aB1C8a79D0",
  txHash: "0x" + "ab".repeat(32),
  symbol: "NEWER",
};
const guests = show.agentList().filter((row) => row.roster === "user");
eq(guests.map((row) => row.id).join(","), [second.agent.id, first.agent.id].join(","), "the roster lists created agents newest first");
eq(guests[0].createdAt, "2026-06-01T00:00:00.000Z", "createdAt is on the list row");
eq(guests[0].argus.tokenAddress, "0xF74C1294d67827fF7EaFb21D834B67aB1C8a79D0", "a minted token stays on the directory row");
eq(guests[0].argus.argusUrl, "https://argus.world/token/0xF74C1294d67827fF7EaFb21D834B67aB1C8a79D0", "the row can open argus.world");
assert(guests[1].argus == null, "an unminted agent stays on the list without a token");
eq(show.agentList().filter((row) => row.roster === "house").length, 12, "house cast stays on the roster");

console.log("agentsearch ok");
