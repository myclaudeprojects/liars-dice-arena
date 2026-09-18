const { TipBook, assertTipAmount, TIP_SEAT_BPS, TIP_HOUSE_BPS } = require("../src/tips");
const { makeWallet } = require("../src/wallet");

const eq = (a, b, m) => { if (Math.abs(a - b) > 1e-6) throw new Error(m + `: ${a} != ${b}`); };
function assert(cond, msg) { if (!cond) throw new Error(msg); }

assert(TIP_SEAT_BPS === 10_000 && TIP_HOUSE_BPS === 0, "tips 100/0 seat");
eq(assertTipAmount(1), 1, "1 usdc");
eq(assertTipAmount(0.05), 0.05, "min");
try { assertTipAmount(0.01); throw new Error("too small should throw"); }
catch (e) { if (!/Tip must be between/.test(e.message)) throw e; }

const book = new TipBook();
book.claimTx("0xabc");
let threw = false; try { book.claimTx("0xabc"); } catch (e) { threw = e.message === "tx_already_used"; }
assert(threw, "duplicate tx claimed");
book.releaseTx("0xabc");
book.claimTx("0xabc");
const seat = "0x" + "22".repeat(20);
const row = book.record({
  from: "alice", agentId: "cold-hands", amount: 1.23456789, txHash: "0xabc",
  tableId: "t-1", seat, influence: "aggressive", mock: true,
});
eq(row.amount, 1.234568, "rounded");
assert(row.seatBps === 10_000 && row.houseBps === 0, "recorded split");
assert(row.toSeat === true && row.toPot === false, "tips fund seat not table pot");
assert(row.entitlesWinnings === false, "tipper never entitled to winnings");
assert(row.influence === "aggressive", "influence stored");
assert(row.seat === seat, "seat dest recorded");
let missing = false;
try { book.record({ from: "alice", agentId: "cold-hands", amount: 1, seat }); }
catch (e) { missing = /Pick one influence/.test(e.message); }
assert(missing, "record requires influence");

(async () => {
  const w = makeWallet({ startingBalance: 50 });
  const spectator = await w.createSeatWallet("spectator:alice");
  const dest = await w.createSeatWallet("cold-hands");
  const before = await w.getBalance(dest.walletId);
  const tx = await w.ante(spectator, dest, 2);
  eq(await w.getBalance(dest.walletId), before + 2, "100% of tip credited to seat");
  eq(await w.getBalance(spectator.walletId), 48, "tipper debited");
  assert(/^0x/.test(tx), "tx hash");
  console.log("tips ok");
})().catch((e) => { console.error(e); process.exit(1); });
