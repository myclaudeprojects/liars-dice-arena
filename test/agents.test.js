const { LLMAgent, MockAgent, parseAction, safeFallback } = require("../src/agents");
const { personaTag } = require("../src/llm");
const { makeWallet } = require("../src/wallet");
const { runMatch } = require("../src/arena");

function assert(cond, msg) { if (!cond) throw new Error(msg); }

const viewOpen = { currentBid: null, totalDice: 15, you: { dice: [2, 3, 4] } };
const viewBid = { currentBid: { count: 4, face: 3 }, totalDice: 15, you: { dice: [2, 3, 4] } };
const viewCeil = { currentBid: { count: 15, face: 6 }, totalDice: 15, you: { dice: [2, 3, 4] } };

assert(parseAction("lol", viewBid) === null, "garbage");
assert(parseAction('{"action":{"type":"bid","count":99,"face":9}}', viewBid) === null, "illegal bid");
assert(parseAction('{"action":{"type":"challenge"}}', viewOpen) === null, "challenge nothing");
assert(parseAction('```json\n{"thought":"x","action":{"type":"challenge"}}\n```', viewBid).action.type === "challenge", "fenced");
assert(parseAction('{"thought":"ok","action":{"type":"bid","count":5,"face":3}}', viewBid).action.count === 5, "raise");
assert(safeFallback(viewOpen).action.type === "bid", "open fallback");
assert(safeFallback(viewCeil).action.type === "challenge", "ceiling fallback");
assert(safeFallback(viewBid).action.type === "bid", "raise fallback");
assert(personaTag({ persona: "degen" }) === "Bluffs for fun", "degen tag");
assert(personaTag({ type: "heuristic", aggression: 0.2 }) === "Tight caller", "tight");

let i = 0;
const fakeComplete = async ({ user }) => {
  i++;
  const total = Number(/Total dice in play: (\d+)/.exec(user)[1]);
  const cb = /Current bid: (\d+) × face (\d+)/.exec(user);
  if (i % 7 === 0) return "lol i dunno";
  if (i % 5 === 0) return JSON.stringify({ thought: "yolo", action: { type: "bid", count: 99, face: 9 } });
  if (cb) {
    const c = Number(cb[1]), f = Number(cb[2]);
    if (c >= Math.ceil(total * 0.5)) return "```json\n" + JSON.stringify({ thought: "Nah, liar.", action: { type: "challenge" } }) + "\n```";
    return JSON.stringify({ thought: "raise it", action: { type: "bid", count: c + 1, face: f } });
  }
  return JSON.stringify({ thought: "open", action: { type: "bid", count: 2, face: 3 } });
};

(async () => {
  const agents = [
    new LLMAgent({ id: "a", name: "FakeLLM-A", persona: "x", complete: fakeComplete }),
    new LLMAgent({ id: "b", name: "FakeLLM-B", persona: "y", complete: fakeComplete }),
    new MockAgent({ id: "c", name: "Mock-C", aggression: 0.5 }),
  ];
  const w = makeWallet({ startingBalance: 20 });
  for (const ag of agents) ag.walletInfo = await w.createSeatWallet(ag.id);
  let fallbacks = 0, illegal = 0, turns = 0;
  const r = await runMatch({
    agents, wallet: w, ante: 1, seed: 3, onEvent: (e) => {
      if (e.type === "turn") { turns++; if (/^\(/.test(e.thought)) fallbacks++; }
      if (e.type === "illegal") illegal++;
    },
  });
  assert(r.winnerId, "match finished");
  assert(illegal === 0, "illegal moves must be caught before the engine");
  const crashed = new LLMAgent({
    id: "a", name: "Boom", persona: "x",
    complete: async () => { throw new Error("timeout"); },
  });
  const r2 = await crashed.act({
    you: { id: "a", name: "Boom", dice: [2, 3, 4] },
    table: [{ id: "a", name: "Boom", diceCount: 3, alive: true }, { id: "b", name: "B", diceCount: 5, alive: true }],
    totalDice: 8, currentBid: { count: 4, face: 3 }, onesWild: true, whoseTurn: "a",
  });
  assert(r2.action.type === "bid" || r2.action.type === "challenge", "model error falls back");

  const hung = new LLMAgent({
    id: "h", name: "Hung", persona: "x", timeoutMs: 40,
    complete: () => new Promise(() => {}),
  });
  const t0 = Date.now();
  const r3 = await hung.act({
    you: { id: "h", name: "Hung", dice: [2, 3, 4] },
    table: [{ id: "h", name: "Hung", diceCount: 3, alive: true }, { id: "b", name: "B", diceCount: 5, alive: true }],
    totalDice: 8, currentBid: { count: 4, face: 3 }, onesWild: true, whoseTurn: "h",
  });
  assert(Date.now() - t0 < 400, "hard turn timeout");
  assert(/timeout/.test(r3.thought), "timeout thought");
  assert(r3.action && (r3.action.type === "bid" || r3.action.type === "challenge"), "timeout falls back");
  console.log({ winner: r.winnerName, turns, fallbacks, illegalReachedEngine: illegal, balances: r.balances });
})().catch((e) => { console.error(e); process.exit(1); });
