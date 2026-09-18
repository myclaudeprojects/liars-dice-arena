// Platform prize program is not part of the v1 money model.
// House wallet exists for house-agent creator share / ops — not a 2% spectator cut.
const econ = require("../src/economics");
function assert(cond, msg) { if (!cond) throw new Error(msg); }

assert(econ.HOUSE_FEE_ADDRESS === "0x341BB8851Ff8fD9EAE20ea083c2F779e646B8488", "house wallet");
assert(econ.HOUSE_FEE_BPS === undefined, "no 2% spectator cut");
assert(econ.SEAT_FEE_BPS === undefined && econ.PARI_BPS === undefined, "no spectator pool split");
assert(econ.POT_CREATOR_BPS === 2000 && econ.POT_SEAT_BPS === 8000, "20/80 pot");
console.log("prizes ok");
