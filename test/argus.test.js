const {
  AGENT_TOKEN_ECONOMICS, assertEconomics, toArgusFormAllocation,
  buildTokenSpec, onAgentRegistered, tokenSymbol, publicTokenView,
  tokenContract, tokenPageUrl, buyView, quoteMockBuy, ARENA_LIAR_TOKEN, ARGUS_APP,
} = require("../src/argus");

function assert(cond, msg) { if (!cond) throw new Error(msg); }
const eq = (a, b, m) => { if (Math.abs(a - b) > 1e-9) throw new Error(m + `: ${a} != ${b}`); };

assertEconomics(AGENT_TOKEN_ECONOMICS);
eq(AGENT_TOKEN_ECONOMICS.creatorFunds, 0.30, "creator");
eq(AGENT_TOKEN_ECONOMICS.holderDividends, 0.35, "holders");
eq(AGENT_TOKEN_ECONOMICS.arenaSeatBankroll, 0.25, "seat");
eq(AGENT_TOKEN_ECONOMICS.buybackBurn, 0.10, "burn");
eq(AGENT_TOKEN_ECONOMICS.liquidityOngoing, 0, "no lp tax");

const form = toArgusFormAllocation();
eq(form.creatorFunds, 0.55, "creator bucket = owner + seat");
eq(form.holderDividends, 0.35, "div");
eq(form.buybackBurn, 0.10, "burn");
eq(form.liquidity, 0, "liquidity tax 0");
eq(form.creatorSplit.owner + form.creatorSplit.arenaSeatBankroll, 1, "split of creator bucket");
eq(form.creatorFunds + form.holderDividends + form.buybackBurn + form.liquidity, 1, "form buckets 100%");

try {
  toArgusFormAllocation({ ...AGENT_TOKEN_ECONOMICS, liquidityOngoing: 0.33, creatorFunds: 0 });
  throw new Error("should reject liquidity tax");
} catch (e) { if (!/liquidity/.test(e.message) && !/sum/.test(e.message)) throw e; }

assert(tokenSymbol("Cold Hands", "cold-hands") === "COLDHAND", "symbol");
const spec = buildTokenSpec({
  agent: { id: "cold-hands", name: "Cold Hands" },
  seatWallet: { address: "0x" + "11".repeat(20) },
  ownerAddress: "0x" + "22".repeat(20),
});
assert(spec.liquidity.ongoingTax === false, "lp seed only");
assert(spec.recipients.seatBankroll, "seat recipient");
assert(spec.todos.some((t) => /splitter/.test(t)), "splitter TODO");
assert(!/liquidity tax bucket/i.test(JSON.stringify(spec.argusAllocation)), "seat not mapped into liquidity numbers");

assert(tokenContract({ spec: { address: "0x" + "ab".repeat(20) } }) === "0x" + "ab".repeat(20), "ca from spec");
assert(tokenContract({ spec: { address: "0x123" } }) === null, "reject short ca");
assert(tokenPageUrl({}) === ARGUS_APP.replace(/\/$/, "") + "/", "no ca → launchpad home, not a fake buy path");
assert(/\/token\/0x/.test(tokenPageUrl({ address: "0x" + "cd".repeat(20) })), "ca → argus token page");
const houseBuy = buyView(null, { house: true, name: "The Shark", id: "shark" });
assert(houseBuy.kind === "house" && houseBuy.address === ARENA_LIAR_TOKEN, "house → $LIAR");
const pendingBuy = buyView({ status: "pending_manual_launch", spec }, { name: "Cold Hands", id: "cold-hands" });
assert(pendingBuy.kind === "agent" && pendingBuy.symbol === "COLDHAND" && !pendingBuy.address, "pending has symbol, no ca");
assert(pendingBuy.inAppSwap === false, "no invented in-app swap");
const q = quoteMockBuy(2, { symbol: "COLDHAND" });
eq(q.tokensOut, 2000, "mock rate");
eq(q.usdcIn, 2, "usdc in");
try { quoteMockBuy(0); throw new Error("zero should throw"); } catch (e) { if (e.message !== "bad_amount") throw e; }

(async () => {
  const pending = await onAgentRegistered({ agent: { id: "a", name: "A" }, seatWallet: { address: "0x" + "33".repeat(20) } });
  assert(pending.status === "pending_manual_launch", "no webhook → pending");
  assert(!publicTokenView(pending).webhook, "no webhook leak");

  process.env.ARGUS_CREATE_URL = "https://operator.example/hook";
  const posted = await onAgentRegistered({
    agent: { id: "a", name: "A" }, seatWallet: { address: "0x" + "33".repeat(20) },
    fetchImpl: async (url, opts) => {
      assert(url === "https://operator.example/hook", "webhook url");
      const body = JSON.parse(opts.body);
      assert(body.type === "agent_token_spec", "envelope");
      eq(body.spec.economics.arenaSeatBankroll, 0.25, "seat in payload");
      return { ok: true, text: async () => JSON.stringify({ queued: true }) };
    },
  });
  assert(posted.status === "webhook_posted", "posted");
  delete process.env.ARGUS_CREATE_URL;
  console.log("argus ok");
})().catch((e) => { console.error(e); process.exit(1); });
