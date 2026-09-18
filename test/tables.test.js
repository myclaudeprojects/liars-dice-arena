const os = require("os");
const fs = require("fs");
const path = require("path");
process.env.REGISTRY_PATH = path.join(os.tmpdir(), "lda-tables-reg-" + process.pid + ".json");
process.env.STATS_PATH = path.join(os.tmpdir(), "lda-tables-stats-" + process.pid + ".json");
process.env.CREDITS_PATH = path.join(os.tmpdir(), "lda-tables-credits-" + process.pid + ".json");
try { fs.unlinkSync(process.env.REGISTRY_PATH); } catch {}
try { fs.unlinkSync(process.env.STATS_PATH); } catch {}
try { fs.unlinkSync(process.env.CREDITS_PATH); } catch {}

const { Registry } = require("../src/registry");
const { makeWallet } = require("../src/wallet");
const { MockAgent } = require("../src/agents");
const { Stats } = require("../src/stats");
const { CreditBook } = require("../src/credits");
const {
  TableManager, communityBusyIds, filterTableSummaries, TABLE_ID_RE,
} = require("../src/tables");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }
function eq(a, b, m) { if (a !== b) throw new Error((m || "eq") + `: ${a} !== ${b}`); }

assert(TABLE_ID_RE.test("t-3") && !TABLE_ID_RE.test("global") && !TABLE_ID_RE.test("t-x"), "table id re");

const filtered = filterTableSummaries([
  { id: "t-1", phase: "starting", seats: [{ id: "cold-hands", name: "Cold Hands", owner: "alice" }] },
  { id: "t-2", phase: "playing", seats: [{ id: "shark", name: "The Shark", owner: "house" }] },
], { agent: "cold-hands" });
eq(filtered.length, 1, "filter agent");
eq(filtered[0].id, "t-1", "agent table");
eq(filterTableSummaries(filtered, { owner: "alice" }).length, 1, "owner");
eq(filterTableSummaries(filtered, { q: "shark" }).length, 0, "q miss");
eq(filterTableSummaries([{ id: "t-2", phase: "playing", seats: [{ id: "shark", name: "The Shark", owner: "house" }] }], { q: "shark" }).length, 1, "q hit");

const busy = communityBusyIds([
  { id: "t-1", busyIds: ["cold-hands"], seats: [{ id: "cold-hands", owner: "alice" }, { id: "shark", owner: "house" }] },
  { id: "t-2", busyIds: [], seats: [{ id: "degen", owner: "house" }] },
], "t-2");
assert(busy.includes("cold-hands") && !busy.includes("shark") && !busy.includes("degen"), "only community busy, except self");

const reg = new Registry({ allowLocal: true });
const addr = (h) => "0x" + String(h).replace(/[^0-9a-f]/gi, "a").padEnd(40, "0").slice(0, 40);
const a = reg.register({ name: "Alpha", type: "heuristic", owner: "alice", aggression: 0.2, ownerAddress: addr("a1") });
const b = reg.register({ name: "Bravo", type: "heuristic", owner: "bob", aggression: 0.4, ownerAddress: addr("b2") });
const c = reg.register({ name: "Charlie", type: "heuristic", owner: "cara", aggression: 0.6, ownerAddress: addr("c3") });
const first = reg.pickSeats(2, { eligible: () => true });
assert(first.some((x) => x.id === a.id) && first.some((x) => x.id === b.id), "first two community by wait");
const rest = reg.pickSeats(2, { eligible: () => true, excludeIds: first.map((x) => x.id) });
assert(rest.some((x) => x.id === c.id), "exclude skips seated community");
assert(!rest.some((x) => first.map((s) => s.id).includes(x.id)), "no overlap");

(async () => {
  const w = makeWallet({ startingBalance: 80 });
  const credits = new CreditBook({ persist: false });

  const mgr = new TableManager({
    wallet: w, registry: reg, stats: new Stats(), credits,
    instantiate: (rec) => { const ag = new MockAgent({ id: rec.id, name: rec.name, aggression: rec.aggression ?? 0.5 }); ag.owner = rec.owner; return ag; },
    ante: 1, tableSize: 2, tableCount: 3, liveChain: false,
    startDelayMs: 5, turnDelayMs: 0, revealDelayMs: 0, dealDelayMs: 0,
    settlePauseMs: 1, errorPauseMs: 1, waitingMs: 1, staggerMs: 0,
    sleep: async () => {},
    minTip: 0.05,
  });
  eq(mgr.tables.length, 3, "three tables");
  eq(mgr.tables[0].id, "t-1", "stable ids");
  assert(mgr.get("t-2") && !mgr.get("nope"), "get");
  assert(mgr.findTableForBet === undefined, "no bet routing helper");
  assert(typeof mgr.seatWallet !== "function", "no seat wallet helper");

  const t1 = await mgr.seatLock.run(() => mgr.buildAgents(mgr.tables[0]));
  mgr.tables[0].seats = t1.map((ag) => ({ id: ag.id, name: ag.name, owner: ag.owner || "house" }));
  mgr.tables[0].busyIds = mgr.tables[0].seats.filter((s) => s.owner !== "house").map((s) => s.id);
  mgr.tables[0].phase = "playing";
  const t2 = await mgr.seatLock.run(() => mgr.buildAgents(mgr.tables[1]));
  mgr.tables[1].seats = t2.map((ag) => ({ id: ag.id, name: ag.name, owner: ag.owner || "house" }));
  mgr.tables[1].phase = "starting";
  const community1 = t1.filter((ag) => ag.owner !== "house").map((ag) => ag.id);
  const community2 = t2.filter((ag) => ag.owner !== "house").map((ag) => ag.id);
  assert(community1.every((id) => !community2.includes(id)), "community exclusive across tables");
  assert(t1.length === 2 && t2.length === 2, "fills table size");
  assert(t1.some((ag) => ag.owner === "house") || t2.some((ag) => ag.owner === "house"), "house fills remaining seats");
  assert(mgr.featuring(community1[0]).some((t) => t.id === "t-1"), "featuring finds creator table");
  eq(mgr.list({ agent: community1[0] }).length, 1, "list filter by seated agent");
  assert(mgr.findTableFeaturing(community1[0]).id === "t-1", "tip routing to featuring table");
  const st = mgr.tables[0].publicState();
  assert(st.noSpectatorPool === true && st.noUsdcPot === true, "public state flags no pool / no USDC pot");
  eq(st.unit, "credits", "credits unit");
  assert(!("bets" in st) && !("multipliers" in st) && !("poolTotal" in st), "no bet fields on table state");
  assert(credits.balance(community1[0]) >= 1, "credits granted on seat");

  console.log("tables ok");
})().catch((e) => { console.error(e); process.exit(1); });
