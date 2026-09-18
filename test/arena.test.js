const { MockAgent } = require("../src/agents");
const { makeWallet, CircleArcWallet } = require("../src/wallet");
const { runMatch } = require("../src/arena");
const { InfluenceBook } = require("../src/influence");

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, m) { if (Math.abs(a - b) > 1e-6) throw new Error((m || "eq") + `: ${a} != ${b}`); }
const approx = eq;

(async () => {
  const w = makeWallet({ startingBalance: 20 });
  const aInfo = await w.createSeatWallet("a");
  const bInfo = await w.createSeatWallet("b");
  const creator = { address: "0x" + "22".repeat(20) };
  const agents = [
    new MockAgent({ id: "a", name: "A", aggression: 0.3 }),
    new MockAgent({ id: "b", name: "B", aggression: 0.7 }),
  ];
  agents[0].walletInfo = aInfo; agents[0].creatorWallet = creator;
  agents[1].walletInfo = bInfo; agents[1].creatorWallet = creator;

  const r = await runMatch({ agents, wallet: w, ante: 1, seed: 11, maxSteps: 400 });
  assert(r.winnerId, "normal match wins");
  assert(!r.aborted, "not aborted");
  eq(r.unit, "USDC", "USDC unit");
  eq(r.potTotal, 2, "1 USDC × 2 seats");
  eq(r.creatorShare, 0.4, "20% of 2 to creator");
  eq(r.seatShare, 1.6, "80% of 2 to seat");
  const loserId = r.winnerId === "a" ? "b" : "a";
  eq(r.balances[loserId], 19, "loser spent ante");
  eq(r.balances[r.winnerId], 20.6, "winner: 20-1+1.6");
  eq(await w.getBalance(creator.address), 0.4, "creator got 20%");

  const stall = {
    id: "s", name: "S", kind: "mock",
    act: async () => { throw new Error("offline"); },
  };
  stall.walletInfo = await w.createSeatWallet("s");
  const tAg = new MockAgent({ id: "t", name: "T", aggression: 0.4 });
  tAg.walletInfo = await w.createSeatWallet("t");
  const r3 = await runMatch({
    agents: [stall, tAg],
    wallet: w, ante: 1, seed: 2, maxSteps: 5,
  });
  assert(r3.aborted || r3.winnerId, "short maxSteps does not throw");
  if (r3.aborted) {
    eq(r3.balances.s, 20, "aborted refunds seat");
    eq(r3.balances.t, 20, "aborted refunds both");
  }

  const circle = new CircleArcWallet({ apiKey: "test" });
  assert(circle.kind === "circle", "constructs");
  assert(circle.blockchain === "ARC", "circle defaults to Arc mainnet, not testnet");
  let threw = false;
  try { await circle.createSeatWallet("x"); } catch (e) { threw = /TODO\(circle\)/.test(e.message); }
  assert(threw, "circle ops are TODO");

  const infBook = new InfluenceBook();
  infBook.apply("ia", "aggressive", 10);
  infBook.freezeAgents(["ia"]);
  let hands = 0;
  const ia = new MockAgent({ id: "ia", name: "IA", aggression: 0.3 });
  const ib = new MockAgent({ id: "ib", name: "IB", aggression: 0.7 });
  await runMatch({
    agents: [ia, ib], wallet: makeWallet({ startingBalance: 20 }), ante: 1, seed: 11, maxSteps: 400,
    influence: infBook, freezeInfluence: true,
    onEvent: (e) => { if (e.type === "hand_start") hands++; },
  });
  assert(hands >= 1, "at least one hand");
  approx(infBook.snapshot("ia").weights.aggressive, 10, "frozen influence does not decay");

  console.log("arena ok");
})().catch((e) => { console.error(e); process.exit(1); });
