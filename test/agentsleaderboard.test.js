// Agents leaderboard: rank the house cast and ready user agents by match wins,
// with a market-cap sort that still lists agents when the Argus quote is missing.
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { Show } = require("../src/showrunner");

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
const html = fs.readFileSync(path.join(__dirname, "..", "public", "app.html"), "utf8");
const names = ["isLeaderboardAgent", "marketCapUsdcOf", "rankAgents"];
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(names.map((name) => sliceFn(app, name)).join("\n"), sandbox);

const house = { id: "shark", name: "LDA The Shark", roster: "house", status: "READY", playable: true, won: 2 };
const ready = { id: "vesper", name: "LDA Vesper", roster: "user", status: "READY", playable: true, won: 4 };
const draft = { id: "sketch", name: "LDA Sketch", roster: "user", status: "GENERATING_IDENTITY", playable: false, won: 9 };
const tokenless = { id: "quiet", name: "LDA Quiet", roster: "user", status: "READY", playable: true, won: 1, argus: null };

assert(sandbox.isLeaderboardAgent(house), "house cast is on the board");
assert(sandbox.isLeaderboardAgent(ready), "a finished user agent is on the board");
assert(sandbox.isLeaderboardAgent(tokenless), "a ready agent without a token still plays");
assert(!sandbox.isLeaderboardAgent(draft), "a tokenless draft that is not seated stays off");
assert(!sandbox.isLeaderboardAgent({ id: "x", name: "", roster: "house" }), "a nameless row is skipped");
assert(!sandbox.isLeaderboardAgent(null), "missing rows are skipped");

eq(sandbox.marketCapUsdcOf(null), null, "a missing quote has no number");
eq(sandbox.marketCapUsdcOf({ label: "$—" }), null, "a label without usdc does not sort");
eq(sandbox.marketCapUsdcOf({ usdc: "1500.5", label: "$1,500.50" }), 1500.5, "usdc string sorts as a number");
eq(sandbox.marketCapUsdcOf({ usdc: "0", label: "$0" }), 0, "a zero cap is a known quote");
eq(sandbox.marketCapUsdcOf({ usdc: "-1" }), null, "a negative quote is ignored");

const cast = [
  { id: "fox", name: "LDA Fox", roster: "house", won: 3 },
  { id: "shark", name: "LDA The Shark", roster: "house", won: 5 },
  { id: "athena", name: "LDA Athena", roster: "house", won: 5 },
  draft,
  ready,
];
const byWins = sandbox.rankAgents(cast, "wins", {});
eq(byWins.map((row) => row.id).join(","), "athena,shark,vesper,fox", "wins rank drops drafts and breaks ties by name");
eq(byWins[0].rank, 1, "the first row is rank 1");
eq(byWins[0].won, 5, "wins come from the agent record");
eq(byWins.map((row) => row.marketCapLabel).join(","), ",,,", "missing caps stay blank labels");

const caps = {
  shark: null,
  athena: { usdc: "20", label: "$20" },
  vesper: { usdc: "900", label: "$900" },
  fox: { usdc: "900", label: "$900" },
};
const byCap = sandbox.rankAgents(cast, "mcap", caps);
eq(byCap.map((row) => row.id).join(","), "vesper,fox,athena,shark", "market cap ranks known quotes first and uses wins, then name, for ties");
eq(byCap[0].marketCapLabel, "$900", "the row keeps the display label");
eq(byCap[3].marketCapUsdc, null, "an unknown cap stays on the board");
eq(sandbox.rankAgents(cast, "nope", caps).map((row) => row.id).join(","), byWins.map((row) => row.id).join(","), "any other sort is the wins ranking");

assert(app.includes('id="agent-leaders-title">Leaders'), "the Agents tab has a Leaders section");
assert(app.includes('data-leader-sort="wins"'), "wins is a ranking control");
assert(app.includes('data-leader-sort="mcap"'), "market cap is a ranking control");
assert(app.includes("let leaderSort = \"wins\""), "wins is the default ranking");
assert(app.includes('class="leader-row"'), "each leader is a row");
assert(app.includes('data-leader-row="${esc(String(row.rank))}"'), "the row shows a rank");
assert(app.includes('data-agent="${esc(agent.id)}"'), "the row uses the same profile hook as agent cards");
assert(app.includes("leader-row__face"), "the row includes a portrait");
assert(app.includes("leader-row__name"), "the row includes the name");
assert(app.includes('class="leader-row__cap'), "the row includes market cap");
assert(app.includes('row.marketCapLabel || "—"'), "a missing market cap renders an em dash");
assert(app.includes("await openAgent(agentBtn.dataset.agent)"), "tapping the row opens the in-app profile");
assert(app.includes("function agentLeaderboard()"), "the board is rendered with the roster");
assert(app.includes("agentSearchNorm(agentQuery) ? \"\" : agentLeaderboard()"), "a search stays on the roster");
assert(!app.includes("data-tab=\"leaders\""), "leaders do not add a sixth tab");
assert(html.includes('data-tab="agents"'), "the Agents tab remains the entry");
assert(css.includes(".leader-row {"), "rows use the arena surface");
assert(css.includes("minmax(0, 1fr)"), "the name column can shrink on a phone");
assert(css.includes("min-height: var(--tap)"), "sort controls keep a tap target");
assert(css.includes(".leader-row__cap.is-unknown"), "an unknown cap is visually quiet");
assert(css.includes("@media (max-width: 420px)"), "narrow phones get a tighter row");

const show = new Show({
  dataPath: path.join(os.tmpdir(), `lda-leaders-${process.pid}.json`),
  sleep: async () => {},
  loopEnabled: false,
  bootstrapCount: 0,
  marketsEnabled: false,
});
show.records.applyMatch({
  seats: [{ id: "shark" }, { id: "fox" }],
  winnerId: "shark",
  story: { title: "Shark takes it" },
});
show.persist();
const shark = show.agentList().find((row) => row.id === "shark");
const fox = show.agentList().find((row) => row.id === "fox");
eq(shark.won, 1, "a settled match increments the winner");
eq(fox.won, 0, "the loser is not credited a win");
eq(fox.lost, 1, "the loss is stored on the same record");
assert(sandbox.isLeaderboardAgent(shark), "the listed house agent is board-eligible");

const base = {
  shortDescription: "A quiet closer who spends one lie and waits.",
  archetype: "ASSASSIN",
  aggression: 0.42,
  bluffing: 0.66,
  discipline: 0.81,
  chaos: 0.18,
};
const created = show.createAgent({ ...base, name: "Sketchcoin" });
const listedDraft = show.agentList().find((row) => row.id === created.agent.id);
assert(listedDraft, "the draft is still on the roster");
assert(!sandbox.isLeaderboardAgent(listedDraft), "the unfinished draft is not a leader");
show.userAgents.get(created.agent.id).status = "READY";
const listedReady = show.agentList().find((row) => row.id === created.agent.id);
assert(sandbox.isLeaderboardAgent(listedReady), "marking the agent ready puts them on the board");
assert(listedReady.argus == null, "a ready agent can be tokenless");
show.removeAgent(created.agent.id);
assert(!show.agentList().some((row) => row.id === created.agent.id), "a deleted agent leaves the list the board reads");

console.log("agentsleaderboard ok");
