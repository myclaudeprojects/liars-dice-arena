const econ = require("../src/economics");
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, m) { if (Math.abs(a - b) > 1e-9) throw new Error((m || "eq") + `: ${a} != ${b}`); }

eq(econ.TIP_CREATOR_BPS, 10_000, "tips 100% to creator");
eq(econ.TIP_HOUSE_BPS, 0, "no tip house skim");
assert(econ.TIP_SEAT_BPS === undefined, "no tip-to-seat");
assert(econ.HOUSE_FEE_BPS === undefined, "no spectator-pool house cut");
assert(econ.SEAT_FEE_BPS === undefined, "no 10% seat bet cut");
assert(econ.PARI_BPS === undefined, "no 88% pari-mutuel");
assert(econ.POT_CREATOR_BPS === undefined, "no 20% pot split");
assert(econ.POT_SEAT_BPS === undefined, "no 80% pot split");
assert(econ.DEFAULT_ANTE === undefined, "no USDC ante");
assert(econ.MIN_SEAT === undefined, "no min USDC seat");
eq(econ.DEFAULT_ANTE_CREDITS, 1, "credit ante");
assert(econ.CREDIT_TIERS.join(",") === "1,10,100", "credit tiers");
eq(econ.STARTING_CREDITS, 1000, "free grant");
eq(econ.MIN_TIP, 0.05, "min tip");
eq(econ.DEFAULT_TABLE_SIZE, 3, "table size");
eq(econ.PRIZE_EVERY_MATCHES, 10, "prize cadence");
eq(econ.PRIZE_USDC, 5, "prize amount");
eq(econ.PRIZE_MIN_PLAYED, 5, "prize min played");
assert(econ.PRIZE_WALLET === "0x341BB8851Ff8fD9EAE20ea083c2F779e646B8488", "prize wallet");
assert(econ.HOUSE_FEE_ADDRESS === econ.PRIZE_WALLET, "house is prize wallet");
assert(econ.PUBLIC_BASE_URL === "https://liarsdicearc.app", "site");
assert(econ.SUPPORT_EMAIL === "myclaudeprojects@gmail.com", "support");
econ.assertSplits();
eq(econ.assertAnteCredits(10), 10, "tier 10");
try { econ.assertAnteCredits(2); throw new Error("bad ante should throw"); }
catch (e) { if (!/Credit ante must be/.test(e.message)) throw e; }
eq(econ.splitBps(100, 2500), 25, "25% of 100");
console.log("economics ok");
