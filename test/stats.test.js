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
  winnerId: "shark", potTotal: 3, ante: 1, log: [], poolTotal: 0, seed: 1,
});
s.recordMatch({
  matchNo: 2,
  seats: [
    { id: "shark", name: "The Shark", kind: "mock" },
    { id: "degen", name: "Degen", kind: "mock" },
  ],
  winnerId: "degen", potTotal: 3, ante: 1, log: [], poolTotal: 0, seed: 2,
});
const lb = s.leaderboard();
const shark = lb.agents.find((a) => a.id === "shark");
const degen = lb.agents.find((a) => a.id === "degen");
assert(shark.form[0] === "L" && shark.form[1] === "W", "shark form newest first");
assert(degen.form[0] === "W" && degen.form[1] === "L", "degen form");
assert(shark.won === 1 && shark.played === 2, "record");
console.log("stats ok");
