const econ = require("../src/economics");
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, m) { if (Math.abs(a - b) > 1e-9) throw new Error((m || "eq") + `: ${a} != ${b}`); }

eq(econ.HOUSE_FEE_BPS, 200, "2%");
eq(econ.SEAT_FEE_BPS, 1000, "10%");
eq(econ.PARI_BPS, 8800, "88%");
eq(econ.POT_CREATOR_BPS, 2000, "20%");
eq(econ.POT_SEAT_BPS, 8000, "80%");
eq(econ.DEFAULT_ANTE, 1, "ante");
eq(econ.MIN_SEAT, 3, "min seat");
eq(econ.DEFAULT_TABLE_SIZE, 3, "table size");
assert(econ.HOUSE_FEE_ADDRESS === "0x341BB8851Ff8fD9EAE20ea083c2F779e646B8488", "house fee dest");
assert(econ.PUBLIC_BASE_URL === "https://liarsdicearc.app", "site");
assert(econ.SUPPORT_EMAIL === "myclaudeprojects@gmail.com", "support");
econ.assertBetSplit();
eq(econ.splitBps(100, 200), 2, "2% of 100");
console.log("economics ok");
