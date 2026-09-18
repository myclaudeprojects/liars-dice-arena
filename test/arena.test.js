const { MockAgent } = require("../src/agents");
const { CreditBook } = require("../src/credits");
const { runMatch } = require("../src/arena");
const { InfluenceBook } = require("../src/influence");

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, m) { if (Math.abs(a - b) > 1e-6) throw new Error((m || "eq") + `: ${a} != ${b}`); }
const approx = eq;

(async () => {
  const credits = new CreditBook({ persist: false, starting: 20 });
  const agents = [
    new MockAgent({ id: "a", name: "A", aggression: 0.3 }),
    new MockAgent({ id: "b", name: "B", aggression: 0.7 }),
  ];

  const r = await runMatch({ agents, credits, ante: 1, seed: 11, maxSteps: 400 });
  assert(r.winnerId, "normal match wins");
  assert(!r.aborted, "not aborted");
  eq(r.unit, "credits", "credits unit");
  eq(r.potTotal, 2, "1 credit × 2 seats");
  const loserId = r.winnerId === "a" ? "b" : "a";
  eq(r.balances[loserId], 19, "loser spent ante");
  eq(r.balances[r.winnerId], 21, "winner: 20-1+2");

  const stall = { id: "s", name: "S", kind: "mock", act: async () => { throw new Error("offline"); } };
  const tAg = new MockAgent({ id: "t", name: "T", aggression: 0.4 });
  const r3 = await runMatch({
    agents: [stall, tAg],
    credits: new CreditBook({ persist: false, starting: 20 }), ante: 1, seed: 2, maxSteps: 5,
  });
  assert(r3.aborted || r3.winnerId, "short maxSteps does not throw");
  if (r3.aborted) {
    eq(r3.balances.s, 20, "aborted refunds credits");
    eq(r3.balances.t, 20, "aborted refunds both");
  }

  const infBook = new InfluenceBook();
  infBook.apply("ia", "aggressive", 10);
  infBook.freezeAgents(["ia"]);
  let hands = 0;
  const ia = new MockAgent({ id: "ia", name: "IA", aggression: 0.3 });
  const ib = new MockAgent({ id: "ib", name: "IB", aggression: 0.7 });
  await runMatch({
    agents: [ia, ib], credits: new CreditBook({ persist: false, starting: 20 }), ante: 1, seed: 11, maxSteps: 400,
    influence: infBook, freezeInfluence: true,
    onEvent: (e) => { if (e.type === "hand_start") hands++; },
  });
  assert(hands >= 1, "at least one hand");
  approx(infBook.snapshot("ia").weights.aggressive, 10, "frozen influence does not decay");

  console.log("arena ok");
})().catch((e) => { console.error(e); process.exit(1); });
