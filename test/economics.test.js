const econ = require("../src/economics");
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, m) { if (Math.abs(a - b) > 1e-9) throw new Error((m || "eq") + `: ${a} != ${b}`); }

eq(econ.TIP_SEAT_BPS, 10_000, "tips 100% to seat");
eq(econ.TIP_HOUSE_BPS, 0, "no tip house skim");
assert(econ.TIP_CREATOR_BPS === undefined, "tips are not to creator");
assert(econ.HOUSE_FEE_BPS === undefined, "no spectator-pool house cut");
assert(econ.SEAT_FEE_BPS === undefined, "no 10% seat bet cut");
assert(econ.PARI_BPS === undefined, "no 88% pari-mutuel");
eq(econ.POT_CREATOR_BPS, 2000, "20% pot to creator");
eq(econ.POT_SEAT_BPS, 8000, "80% pot to seat");
eq(econ.DEFAULT_ANTE, 1, "1 USDC ante");
eq(econ.MIN_SEAT, 3, "min 3 USDC seat");
assert(econ.DEFAULT_ANTE_CREDITS === undefined, "no credit ante");
eq(econ.MIN_TIP, 0.05, "min tip");
eq(econ.DEFAULT_TABLE_SIZE, 3, "table size");
assert(econ.HOUSE_FEE_ADDRESS === "0x341BB8851Ff8fD9EAE20ea083c2F779e646B8488", "house wallet");
assert(econ.PUBLIC_BASE_URL === "https://liarsdicearc.app", "site");
assert(econ.SUPPORT_EMAIL === "myclaudeprojects@gmail.com", "support");
econ.assertSplits();
eq(econ.splitBps(3, 2000), 0.6, "20% of 3");
eq(econ.splitBps(3, 8000), 2.4, "80% of 3");
console.log("economics ok");
