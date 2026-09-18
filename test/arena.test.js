const { MockAgent } = require("../src/agents");
const { makeWallet, CircleArcWallet } = require("../src/wallet");
const { CreditBook } = require("../src/credits");
const { runMatch } = require("../src/arena");
const { STARTING_CREDITS } = require("../src/economics");
const { InfluenceBook } = require("../src/influence");

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, m) { if (Math.abs(a - b) > 1e-6) throw new Error((m || "eq") + `: ${a} != ${b}`); }

(async () => {
  const credits = new CreditBook({ persist: false });
  const agents = [
    new MockAgent({ id: "a", name: "A", aggression: 0.3 }),
    new MockAgent({ id: "b", name: "B", aggression: 0.7 }),
  ];
  const r = await runMatch({ agents, credits, ante: 1, seed: 11, maxSteps: 400 });
  assert(r.winnerId, "normal match wins");
  assert(!r.aborted, "not aborted");
  eq(r.unit, "credits", "credits unit");
  assert(r.redeemable === false, "not redeemable");
  eq(r.potTotal, 2, "1 credit × 2 seats");
  eq(r.creatorShare == null ? 0 : r.creatorShare, 0, "no USDC creator pot split");
  const winnerBal = r.balances[r.winnerId];
  const loserId = r.winnerId === "a" ? "b" : "a";
  eq(winnerBal, STARTING_CREDITS + 1, "winner nets +1 credit");
  eq(r.balances[loserId], STARTING_CREDITS - 1, "loser spent ante");

  const broken = {
    id: "x", name: "X", kind: "mock",
    act: async () => ({ action: { type: "bid", count: 99, face: 9 }, thought: "nope" }),
  };
  const ok = new MockAgent({ id: "y", name: "Y", aggression: 0.2 });
  const r2 = await runMatch({
    agents: [broken, ok], credits: new CreditBook({ persist: false }), ante: 1, seed: 1, maxSteps: 80,
  });
  assert(r2.winnerId || r2.aborted, "illegal opener recovered or aborted cleanly");
  if (r2.aborted) assert(r2.winnerId == null, "aborted has no winner");

  const stall = {
    id: "s", name: "S", kind: "mock",
    act: async () => { throw new Error("offline"); },
  };
  const r3 = await runMatch({
    agents: [stall, new MockAgent({ id: "t", name: "T", aggression: 0.4 })],
    credits: new CreditBook({ persist: false }), ante: 1, seed: 2, maxSteps: 5,
  });
  assert(r3.aborted || r3.winnerId, "short maxSteps does not throw");
  if (r3.aborted) {
    eq(r3.balances.s, STARTING_CREDITS, "aborted refunds credits");
    eq(r3.balances.t, STARTING_CREDITS, "aborted refunds both");
  }

  try {
    await runMatch({ agents, credits: new CreditBook({ persist: false }), ante: 5 });
    throw new Error("non-tier ante should throw");
  } catch (e) {
    if (!/Credit ante must be/.test(e.message)) throw e;
  }

  const circle = new CircleArcWallet({ apiKey: "test" });
  assert(circle.kind === "circle", "constructs");
  assert(circle.blockchain === "ARC", "circle defaults to Arc mainnet, not testnet");
  let threw = false;
  try { await circle.createSeatWallet("x"); } catch (e) { threw = /TODO\(circle\)/.test(e.message); }
  assert(threw, "circle ops are TODO");

  const w = makeWallet({ startingBalance: 20 });
  assert((await w.getBalance((await w.createSeatWallet("z")).walletId)) === 20, "wallet still used for USDC tips/prizes");

  const infBook = new InfluenceBook();
  infBook.apply("a", "aggressive", 10);
  let hands = 0;
  await runMatch({
    agents: [
      new MockAgent({ id: "a", name: "A", aggression: 0.3 }),
      new MockAgent({ id: "b", name: "B", aggression: 0.7 }),
    ],
    credits: new CreditBook({ persist: false }), ante: 1, seed: 11, maxSteps: 400,
    influence: infBook,
    onEvent: (e) => { if (e.type === "hand_start") hands++; },
  });
  assert(hands >= 1, "at least one hand");
  if (hands > 1) {
    assert(infBook.snapshot("a").weights.aggressive < 10, "influence decays after opening hand");
    assert(infBook.snapshot("a").entitlesWinnings === false, "still no claim");
  }

  console.log("arena ok");
})().catch((e) => { console.error(e); process.exit(1); });
