const econ = require("../src/economics");
function assert(cond, msg) { if (!cond) throw new Error(msg); }

assert(econ.HOUSE_FEE_ADDRESS === "0x341BB8851Ff8fD9EAE20ea083c2F779e646B8488", "house wallet");
assert(econ.HOUSE_FEE_BPS === undefined, "no 2% spectator cut");
assert(econ.SEAT_FEE_BPS === undefined && econ.PARI_BPS === undefined, "no spectator pool split");
assert(econ.POT_CREATOR_BPS === undefined, "no USDC pot split");
assert(econ.MARKET_VAULT_ADDRESS === undefined, "no LDA market vault");
console.log("prizes ok");
