const { computePayouts, impliedMultipliers, BettingPool, round6 } = require("../src/betting");
const { makeWallet } = require("../src/wallet");
const { HOUSE_FEE_ADDRESS, HOUSE_FEE_BPS, SEAT_FEE_BPS, PARI_BPS } = require("../src/economics");

const eq = (a, b, m) => { if (Math.abs(a - b) > 1e-6) throw new Error(m + `: ${a} != ${b}`); };
function assert(cond, msg) { if (!cond) throw new Error(msg); }

assert(HOUSE_FEE_BPS + SEAT_FEE_BPS + PARI_BPS === 10_000, "split 100%");

let r = computePayouts([{ bettorId: "x", agentId: "A", amount: 10 }, { bettorId: "y", agentId: "B", amount: 30 }], "A");
eq(r.houseCut, 0.8, "2% of 40"); eq(r.seatCut, 4, "10% of 40"); eq(r.payouts[0].amount, 35.2, "88% to sole backer of A");

r = computePayouts([
  { bettorId: "x", agentId: "A", amount: 10 },
  { bettorId: "z", agentId: "A", amount: 30 },
  { bettorId: "y", agentId: "B", amount: 60 },
], "A");
eq(r.houseCut, 2, "2% of 100"); eq(r.seatCut, 10, "10% of 100");
eq(r.payouts.find((p) => p.bettorId === "x").amount, 22, "x 1/4 of 88");
eq(r.payouts.find((p) => p.bettorId === "z").amount, 66, "z 3/4 of 88");

r = computePayouts([{ bettorId: "solo", agentId: "A", amount: 1 }], "A");
eq(r.houseCut, 0.02, "2% of 1"); eq(r.seatCut, 0.10, "10% of 1"); eq(r.payouts[0].amount, 0.88, "88% to sole backer");

r = computePayouts([{ bettorId: "x", agentId: "A", amount: 10 }], "B");
if (!r.refunded || r.payouts[0].amount !== 10 || r.houseCut !== 0) throw new Error("refund path");
r = computePayouts([{ bettorId: "x", agentId: "A", amount: 10 }], null);
assert(r.refunded && r.payouts[0].amount === 10, "null winner refunds");

r = computePayouts([1, 2, 3].map((i) => ({ bettorId: "w" + i, agentId: "A", amount: 1 })).concat([{ bettorId: "l", agentId: "B", amount: 97 }]), "A");
eq(r.payouts.reduce((s, p) => s + p.amount, 0), 88, "dust fixed on 88%");
eq(r.houseCut + r.seatCut + r.payouts.reduce((s, p) => s + p.amount, 0), 100, "full pool accounted");

try { computePayouts([{ bettorId: "x", agentId: "A", amount: NaN }], "A"); throw new Error("nan should throw"); }
catch (e) { if (e.message !== "bad_amount") throw e; }

const m = impliedMultipliers([{ bettorId: "x", agentId: "A", amount: 10 }, { bettorId: "y", agentId: "B", amount: 30 }], ["A", "B", "C"]);
eq(m.A, 3.52, "A pays 0.88*40/10"); eq(m.B, round6(35.2 / 30), "B pays 0.88*40/30"); if (m.C !== null) throw new Error("unbacked = null");
console.log("betting math ok");

(async () => {
  const w = makeWallet({ startingBalance: 50 });
  const pool = new BettingPool({ wallet: w }); await pool.init();
  const alice = await w.createSeatWallet("alice"), bob = await w.createSeatWallet("bob");
  const seat = await w.createSeatWallet("claude-seat");
  await pool.placeBet({ bettorId: "alice", bettorWallet: alice, agentId: "claude", amount: 20 });
  try {
    await pool.placeBet({ bettorId: "alice", bettorWallet: alice, agentId: "gpt", amount: 1 });
    throw new Error("second bet on same table accepted");
  } catch (e) { if (!/One bet per table/.test(e.message)) throw e; }
  await pool.placeBet({ bettorId: "bob", bettorWallet: bob, agentId: "gpt", amount: 30 });
  pool.close();
  try {
    await pool.placeBet({ bettorId: "cara", bettorWallet: alice, agentId: "claude", amount: 1 });
    throw new Error("closed pool accepted a bet");
  } catch (e) { if (e.message !== "betting_closed") throw e; }
  const s = await pool.settle("claude", { house: { address: HOUSE_FEE_ADDRESS }, seat });
  eq(await w.getBalance(alice.walletId), 30 + 44, "alice 88% of 50"); // started 50, staked 20, got 44
  eq(await w.getBalance(bob.walletId), 20, "bob lost stake");
  eq(await w.getBalance(seat.walletId) - 50, 5, "seat 10% of 50");
  eq(await w.getBalance(HOUSE_FEE_ADDRESS), 1, "house 2% of 50 credited to fee address");
  eq(await w.getBalance(pool.poolWallet.walletId), 0, "pool empty");
  assert(s.houseCut === 1 && s.seatCut === 5, "cuts");

  const p2 = new BettingPool({ wallet: w, potLabel: "pool:t-2:1" }); await p2.init();
  assert(p2.poolWallet.walletId !== pool.poolWallet.walletId, "labeled pools are distinct");
  // Multi-table: same bettor can bet on another table.
  await p2.placeBet({ bettorId: "alice", bettorWallet: alice, agentId: "claude", amount: 1 });
  p2.claimTx("0xabc");
  let threw = false; try { p2.claimTx("0xabc"); } catch (e) { threw = e.message === "tx_already_used"; }
  assert(threw, "duplicate tx claimed");
  p2.releaseTx("0xabc");
  p2.claimTx("0xabc");
  p2.recordExternal({ bettorId: "0xfrom", address: "0xfrom", agentId: "claude", amount: 1.23456789, txHash: "0xabc", claimed: true });
  eq(p2.bets[0].amount, 1, "first p2 bet is alice's 1");
  eq(p2.bets[1].amount, round6(1.23456789), "external amount rounded");
  try {
    p2.recordExternal({ bettorId: "ALICE", address: "alice", agentId: "gpt", amount: 2, txHash: "0xdef" });
    throw new Error("case-insensitive duplicate bettor");
  } catch (e) { if (!/One bet per table/.test(e.message)) throw e; }

  console.log("betting pool ok");
})().catch((e) => { console.error(e); process.exit(1); });
