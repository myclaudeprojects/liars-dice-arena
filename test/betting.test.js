const { computePayouts, impliedMultipliers, BettingPool, round6 } = require("../src/betting");
const { makeWallet } = require("../src/wallet");

const eq = (a, b, m) => { if (Math.abs(a - b) > 1e-6) throw new Error(m + `: ${a} != ${b}`); };
function assert(cond, msg) { if (!cond) throw new Error(msg); }

let r = computePayouts([{ bettorId: "x", agentId: "A", amount: 10 }, { bettorId: "y", agentId: "B", amount: 30 }], "A", 0);
eq(r.payouts[0].amount, 40, "sole winner takes pool");
r = computePayouts([{ bettorId: "x", agentId: "A", amount: 10 }, { bettorId: "z", agentId: "A", amount: 30 }, { bettorId: "y", agentId: "B", amount: 60 }], "A", 200);
eq(r.houseCut, 1.2, "2% of the 60 losing"); eq(r.payouts.find((p) => p.bettorId === "x").amount, 24.7, "x gets 1/4 of 98.8"); eq(r.payouts.find((p) => p.bettorId === "z").amount, 74.1, "z gets 3/4");
r = computePayouts([{ bettorId: "solo", agentId: "A", amount: 1 }], "A", 200);
eq(r.houseCut, 0, "no losers, no rake"); eq(r.payouts[0].amount, 1, "sole winner gets 1.00x back");
r = computePayouts([{ bettorId: "x", agentId: "A", amount: 10 }], "B", 200);
if (!r.refunded || r.payouts[0].amount !== 10) throw new Error("refund path");
r = computePayouts([{ bettorId: "x", agentId: "A", amount: 10 }], null, 200);
assert(r.refunded && r.payouts[0].amount === 10, "null winner refunds");
r = computePayouts([1, 2, 3].map((i) => ({ bettorId: "w" + i, agentId: "A", amount: 1 })).concat([{ bettorId: "l", agentId: "B", amount: 97 }]), "A", 0);
eq(r.payouts.reduce((s, p) => s + p.amount, 0), 100, "dust fixed");
try { computePayouts([{ bettorId: "x", agentId: "A", amount: NaN }], "A", 0); throw new Error("nan should throw"); }
catch (e) { if (e.message !== "bad_amount") throw e; }
const m = impliedMultipliers([{ bettorId: "x", agentId: "A", amount: 10 }, { bettorId: "y", agentId: "B", amount: 30 }], ["A", "B", "C"], 0);
eq(m.A, 4, "A pays 4x"); eq(m.B, 4 / 3, "B pays 1.33x"); if (m.C !== null) throw new Error("unbacked = null");
const m2 = impliedMultipliers([{ bettorId: "x", agentId: "A", amount: 1 }], ["A"], 200); eq(m2.A, 1, "sole backer shows 1.00x, never below");
console.log("betting math ok");

(async () => {
  const w = makeWallet({ startingBalance: 50 });
  const pool = new BettingPool({ wallet: w, houseFeeBps: 200 }); await pool.init();
  const alice = await w.createSeatWallet("alice"), bob = await w.createSeatWallet("bob"), house = await w.createSeatWallet("house");
  await pool.placeBet({ bettorId: "alice", bettorWallet: alice, agentId: "claude", amount: 20 });
  await pool.placeBet({ bettorId: "bob", bettorWallet: bob, agentId: "gpt", amount: 30 });
  pool.close();
  try {
    await pool.placeBet({ bettorId: "alice", bettorWallet: alice, agentId: "claude", amount: 1 });
    throw new Error("closed pool accepted a bet");
  } catch (e) { if (e.message !== "betting_closed") throw e; }
  const s = await pool.settle("claude", house);
  eq(await w.getBalance(alice.walletId), 79.4, "alice payout");
  eq(await w.getBalance(bob.walletId), 20, "bob lost stake");
  eq(await w.getBalance(house.walletId) - 50, 0.6, "house rake");
  eq(await w.getBalance(pool.poolWallet.walletId), 0, "pool empty");
  assert(s.houseCut === 0.6, "houseCut 0.6");

  const p2 = new BettingPool({ wallet: w, houseFeeBps: 200 }); await p2.init();
  p2.claimTx("0xabc");
  let threw = false; try { p2.claimTx("0xabc"); } catch (e) { threw = e.message === "tx_already_used"; }
  assert(threw, "duplicate tx claimed");
  p2.releaseTx("0xabc");
  p2.claimTx("0xabc");
  p2.recordExternal({ bettorId: "0xfrom", address: "0xfrom", agentId: "claude", amount: 1.23456789, txHash: "0xabc", claimed: true });
  eq(p2.bets[0].amount, round6(1.23456789), "external amount rounded");

  console.log("betting pool ok");
})().catch((e) => { console.error(e); process.exit(1); });
