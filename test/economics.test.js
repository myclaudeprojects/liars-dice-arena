const econ = require("../src/economics");
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, m) { if (Math.abs(a - b) > 1e-9) throw new Error((m || "eq") + `: ${a} != ${b}`); }

eq(econ.TIP_CREATOR_BPS, 10_000, "tips 100% to creator");
eq(econ.TIP_SEAT_BPS, 0, "tips not to seat");
eq(econ.TIP_HOUSE_BPS, 0, "no tip house skim");
assert(econ.HOUSE_FEE_BPS === undefined, "no spectator-pool house cut");
assert(econ.SEAT_FEE_BPS === undefined, "no 10% seat bet cut");
assert(econ.PARI_BPS === undefined, "no 88% pari-mutuel");
assert(econ.POT_CREATOR_BPS === undefined && econ.POT_SEAT_BPS === undefined, "no USDC agent pot split");
assert(econ.MARKET_FEE_BPS === undefined && econ.MARKET_VAULT_ADDRESS === undefined, "no first-party market fee/vault");
eq(econ.DEFAULT_ANTE_CREDITS, 1, "1 credit ante");
eq(econ.DEFAULT_ANTE, 1, "ante alias");
assert(econ.MIN_SEAT === undefined, "no USDC min seat");
eq(econ.MIN_TIP, 0.05, "min tip");
eq(econ.DEFAULT_TABLE_SIZE, 3, "table size");
eq(econ.TOKEN_FEE_PLATFORM_BPS, 5000, "50% treasury");
eq(econ.TOKEN_FEE_CREATOR_BPS, 5000, "50% persona");
assert(econ.HOUSE_FEE_ADDRESS === "0x341BB8851Ff8fD9EAE20ea083c2F779e646B8488", "house wallet");
assert(econ.PLATFORM_TREASURY === econ.HOUSE_FEE_ADDRESS, "treasury");
assert(econ.PUBLIC_BASE_URL === "https://liarsdicearc.app", "site");
assert(econ.SUPPORT_EMAIL === "myclaudeprojects@gmail.com", "support");
econ.assertSplits();
eq(econ.splitBps(2, 5000), 1, "50/50");
console.log("economics ok");
