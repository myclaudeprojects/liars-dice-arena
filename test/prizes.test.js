const os = require("os");
const fs = require("fs");
const path = require("path");
process.env.STATS_PATH = path.join(os.tmpdir(), "lda-prize-stats-" + process.pid + ".json");
process.env.REGISTRY_PATH = path.join(os.tmpdir(), "lda-prize-reg-" + process.pid + ".json");
try { fs.unlinkSync(process.env.STATS_PATH); } catch {}
try { fs.unlinkSync(process.env.REGISTRY_PATH); } catch {}

const { Stats } = require("../src/stats");
const { Registry } = require("../src/registry");
const { makeWallet } = require("../src/wallet");
const { prizeRules, pickLaureate, shouldAward, maybeAwardPrize } = require("../src/prizes");
const { PRIZE_WALLET, PRIZE_USDC } = require("../src/economics");

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, m) { if (a !== b) throw new Error((m || "eq") + `: ${a} !== ${b}`); }

const rules = prizeRules();
eq(rules.paidTo, "creator", "paid to creator");
eq(rules.sourceWallet, PRIZE_WALLET, "house prize wallet");
assert(rules.notFrom.includes("spectator tips"), "not from tips");
assert(rules.notFrom.includes("Arena Credits"), "not from credits");
assert(rules.notFrom.includes("other users' losses"), "not from losses");
assert(shouldAward({ matches: 10 }) && !shouldAward({ matches: 9 }) && !shouldAward({ matches: 0 }), "cadence");

const stats = new Stats();
const reg = new Registry({ allowLocal: true });
const addr = (h) => "0x" + String(h).replace(/[^0-9a-f]/gi, "a").padEnd(40, "0").slice(0, 40);
const rec = reg.register({ name: "Laureate", type: "heuristic", owner: "alice", ownerAddress: addr("aa") });
for (let i = 0; i < 6; i++) {
  stats.recordMatch({
    matchNo: i + 1,
    seats: [
      { id: rec.id, name: rec.name, kind: "mock" },
      { id: "shark", name: "The Shark", kind: "mock" },
    ],
    winnerId: rec.id, potTotal: 2, ante: 1, log: [], seed: i,
  });
}
assert(pickLaureate(stats, reg).rec.id === rec.id, "community ELO laureate");
assert(!pickLaureate(stats, reg, { minPlayed: 99 }), "minPlayed gates");

(async () => {
  const w = makeWallet({ startingBalance: 0 });
  const miss = await maybeAwardPrize({ stats, registry: reg, wallet: w, every: 7 });
  assert(miss.awarded === false && miss.reason === "not_due", "not due yet");
  // 6 matches recorded; award on every 1 for the test.
  const hit = await maybeAwardPrize({ stats, registry: reg, wallet: w, every: 1, amount: PRIZE_USDC });
  assert(hit.awarded, "awarded");
  eq(hit.prize.creator, rec.ownerAddress, "paid to creator");
  eq(hit.prize.paidTo, "creator", "label");
  eq(hit.prize.source, "platform_prize_treasury", "source");
  eq(await w.getBalance(rec.ownerAddress), PRIZE_USDC, "creator credited in mock");
  const lb = stats.leaderboard();
  assert(lb.totals.prizes >= 1 && lb.totals.prizesUsdc >= PRIZE_USDC, "prize totals");
  assert(lb.prizes[0].agentId === rec.id, "prize on board");
  console.log("prizes ok");
})().catch((e) => { console.error(e); process.exit(1); });
