const os = require("os");
const fs = require("fs");
const path = require("path");
process.env.STATS_PATH = path.join(os.tmpdir(), "lda-stats-" + process.pid + ".json");
try { fs.unlinkSync(process.env.STATS_PATH); } catch {}

const { Stats } = require("../src/stats");

function assert(cond, msg) { if (!cond) throw new Error(msg); }

const s = new Stats();
s.recordMatch({
  matchNo: 1,
  seats: [
    { id: "shark", name: "The Shark", kind: "mock" },
    { id: "degen", name: "Degen", kind: "mock" },
  ],
  winnerId: "shark", potTotal: 3, ante: 1, log: [], seed: 1, unit: "credits",
});
s.recordMatch({
  matchNo: 2,
  seats: [
    { id: "shark", name: "The Shark", kind: "mock" },
    { id: "degen", name: "Degen", kind: "mock" },
  ],
  winnerId: "degen", potTotal: 3, ante: 1, log: [], seed: 2, unit: "credits",
});
s.recordTip({ from: "alice", agentId: "shark", amount: 2 });
s.recordTreasury({ amount: 4, source: "token_tax_prize_treasury" });
s.recordPrize({
  amount: 5, agentId: "shark", agentName: "The Shark", creator: "0xabc",
  pending: false, source: "platform_prize_treasury", paidTo: "creator",
});
const lb = s.leaderboard();
const shark = lb.agents.find((a) => a.id === "shark");
const degen = lb.agents.find((a) => a.id === "degen");
assert(shark.form[0] === "L" && shark.form[1] === "W", "shark form newest first");
assert(degen.form[0] === "W" && degen.form[1] === "L", "degen form");
assert(shark.won === 1 && shark.played === 2, "record");
assert(shark.creditsWon === 2 && shark.creditsLost === 1, "credit pot accounting");
assert(lb.tippers.some((t) => t.id === "alice" && t.tipped === 2), "tipper board");
assert(lb.totals.tips === 1 && lb.totals.tipsUsdc === 2, "tip totals");
assert(lb.totals.creditsSettled === 6, "credits settled");
assert(lb.totals.prizes === 1 && lb.totals.prizesUsdc === 5, "prize totals");
assert(lb.treasury.total === 4 && lb.treasury.inflows[0].fundsPlay === false, "treasury not play");
assert(shark.tipsUsdc === 2, "agent tips");
assert(shark.prizesUsdc === 5, "agent prizes");
assert(Array.isArray(lb.prizes) && lb.prizes[0].paidTo === "creator", "prizes list");
console.log("stats ok");
