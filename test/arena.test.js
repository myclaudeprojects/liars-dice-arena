const { MockAgent } = require("../src/agents");
const { makeWallet, CircleArcWallet } = require("../src/wallet");
const { runMatch } = require("../src/arena");

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, m) { if (Math.abs(a - b) > 1e-6) throw new Error((m || "eq") + `: ${a} != ${b}`); }

(async () => {
  const w = makeWallet({ startingBalance: 20 });
  const agents = [
    new MockAgent({ id: "a", name: "A", aggression: 0.3 }),
    new MockAgent({ id: "b", name: "B", aggression: 0.7 }),
  ];
  const r = await runMatch({ agents, wallet: w, ante: 5, seed: 11, maxSteps: 400 });
  assert(r.winnerId, "normal match wins");
  assert(!r.aborted, "not aborted");
  eq(r.creatorShare, 0, "no creator dest → 100% seat");
  eq(r.seatShare, r.potTotal, "seat gets pot");

  const wSplit = makeWallet({ startingBalance: 50 });
  const ca = "0x" + "aa".repeat(20);
  const a1 = new MockAgent({ id: "a1", name: "A1", aggression: 0.3 });
  const a2 = new MockAgent({ id: "a2", name: "A2", aggression: 0.7 });
  a1.walletInfo = await wSplit.createSeatWallet("a1");
  a2.walletInfo = await wSplit.createSeatWallet("a2");
  a1.creatorWallet = { address: ca };
  a2.creatorWallet = { address: ca };
  const rSplit = await runMatch({ agents: [a1, a2], wallet: wSplit, ante: 5, seed: 11, maxSteps: 400 });
  eq(rSplit.creatorShare, 2, "20% of 10");
  eq(rSplit.seatShare, 8, "80% of 10");
  eq(await wSplit.getBalance(ca), 2, "creator paid from pot");
  const seatsLeft = await wSplit.getBalance(a1.walletInfo.walletId) + await wSplit.getBalance(a2.walletInfo.walletId);
  eq(seatsLeft + 2, 100, "antes + starting accounted");

  const broken = {
    id: "x", name: "X", kind: "mock",
    act: async () => ({ action: { type: "bid", count: 99, face: 9 }, thought: "nope" }),
  };
  const ok = new MockAgent({ id: "y", name: "Y", aggression: 0.2 });
  const r2 = await runMatch({ agents: [broken, ok], wallet: makeWallet({ startingBalance: 50 }), ante: 2, seed: 1, maxSteps: 80 });
  assert(r2.winnerId || r2.aborted, "illegal opener recovered or aborted cleanly");
  if (r2.aborted) assert(r2.winnerId == null, "aborted has no winner");

  const stall = {
    id: "s", name: "S", kind: "mock",
    act: async () => { throw new Error("offline"); },
  };
  const r3 = await runMatch({
    agents: [stall, new MockAgent({ id: "t", name: "T", aggression: 0.4 })],
    wallet: makeWallet({ startingBalance: 50 }), ante: 3, seed: 2, maxSteps: 5,
  });
  assert(r3.aborted || r3.winnerId, "short maxSteps does not throw");

  const circle = new CircleArcWallet({ apiKey: "test" });
  assert(circle.kind === "circle", "constructs");
  let threw = false;
  try { await circle.createSeatWallet("x"); } catch (e) { threw = /TODO\(circle\)/.test(e.message); }
  assert(threw, "circle ops are TODO");

  const poor = makeWallet({ startingBalance: 1 });
  const rich = new MockAgent({ id: "rich", name: "Rich", aggression: 0.2 });
  const broke = new MockAgent({ id: "broke", name: "Broke", aggression: 0.2 });
  rich.walletInfo = await poor.createSeatWallet("rich");
  broke.walletInfo = await poor.createSeatWallet("broke");
  await poor.ante(broke.walletInfo, { walletId: "sink", address: "0xsink" }, 1); // drain broke below ante
  poor.balances.set("sink", 0);
  let anteFailed = false;
  try {
    await runMatch({ agents: [rich, broke], wallet: poor, ante: 5, seed: 3 });
  } catch (e) {
    anteFailed = e.message === "insufficient_balance";
  }
  assert(anteFailed, "partial ante throws");
  // Rich was refunded (started 1, ante 5 would fail on first if both have 1... rich has 1 too).
  // Recreate: fund only first agent.
  const w2 = makeWallet({ startingBalance: 0 });
  const p1 = new MockAgent({ id: "p1", name: "P1", aggression: 0.2 });
  const p2 = new MockAgent({ id: "p2", name: "P2", aggression: 0.2 });
  p1.walletInfo = await w2.createSeatWallet("p1");
  p2.walletInfo = await w2.createSeatWallet("p2");
  w2.balances.set(p1.walletInfo.walletId, 10);
  w2.balances.set(p2.walletInfo.walletId, 0);
  try { await runMatch({ agents: [p1, p2], wallet: w2, ante: 5, seed: 4 }); }
  catch (e) { assert(e.message === "insufficient_balance", "second ante fails"); }
  assert(await w2.getBalance(p1.walletInfo.walletId) === 10, "first ante refunded");

  console.log("arena ok");
})().catch((e) => { console.error(e); process.exit(1); });
