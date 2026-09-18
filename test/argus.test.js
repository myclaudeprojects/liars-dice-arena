const {
  AGENT_TOKEN_ECONOMICS, assertEconomics, toArgusFormAllocation,
  buildTokenSpec, onAgentRegistered, tokenSymbol, publicTokenView,
  tokenContract, tokenPageUrl, buyView, quoteMockBuy, ARGUS_APP,
  assertCreatorWallet, publicBaseUrl,
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

assert(tokenSymbol("Cold Hands", "cold-hands") === "LDACOLDHAN", "LDA ticker");
assert(tokenSymbol("LDA Bot", "lda-bot") === "LDABOT", "no double LDA prefix");
assert(publicBaseUrl("https://example.test/arena/") === "https://example.test", "origin only");
assert(publicBaseUrl("") === null, "no guessed domain");
const spec = buildTokenSpec({
  agent: { id: "cold-hands", name: "Cold Hands" },
  seatWallet: { address: "0x" + "11".repeat(20) },
  ownerAddress: "0x" + "22".repeat(20),
  deployerAddress: "0x" + "33".repeat(20),
});
assert(spec.name === "Cold Hands", "token name is display name");
assert(spec.symbol === "LDACOLDHAN", "LDA symbol");
assert(spec.metadata.description.includes("Liar's Dice Arena agent · watch & bet"), "short funnel line");
assert(spec.metadata.description.includes("/agent/cold-hands"), "agent deep link");
assert(spec.metadata.description.includes("#LiarsDiceArena"), "hashtag");
assert(!/30%|35%|25%|10%/.test(spec.metadata.description), "economics stay off-chain");
assert(spec.metadata.argusForm.name === spec.name, "form name");
assert(spec.todos.some((t) => /EXTRA top-up/i.test(t)), "seat bankroll extra");
const specAbs = buildTokenSpec({
  agent: { id: "cold-hands", name: "Cold Hands" },
  seatWallet: { address: "0x" + "11".repeat(20) },
  ownerAddress: "0x" + "22".repeat(20),
  siteOrigin: "https://arena.example",
});
assert(specAbs.metadata.website === "https://arena.example/agent/cold-hands", "absolute website");
assert(specAbs.metadata.argusForm.links[0] === specAbs.metadata.website, "links map to website");
assert(specAbs.metadata.description.includes("https://arena.example/agent/cold-hands"), "abs url in description");
assert(/\/api\/agents\/cold-hands\/avatar/.test(spec.metadata.image), "generated avatar on spec");
assert(spec.metadata.argusForm.image === spec.metadata.image, "form image");
assert(specAbs.metadata.image === "https://arena.example/api/agents/cold-hands/avatar", "abs image");
assert(spec.todos.some((t) => /image URL|hosted/.test(t)), "image upload TODO");
assert(spec.liquidity.ongoingTax === false, "lp seed only");
assert(spec.recipients.seatBankroll, "seat recipient");
assert(spec.recipients.creator === ("0x" + "22".repeat(20)), "creator is user wallet");
assert(spec.recipients.feeRecipient === spec.recipients.creator, "fee recipient is creator");
assert(spec.recipients.deployer === ("0x" + "33".repeat(20)), "house may deploy");
assert(spec.creatorRights.transferIfDeployerDiffers === true, "transfer creator if deployer ≠ user");
assert(spec.recipients.creator !== spec.recipients.seatBankroll, "seat ≠ creator");
assert(spec.todos.some((t) => /splitter/.test(t)), "splitter TODO");
assert(spec.todos.some((t) => /fee recipient|LDA\/dev/.test(t)), "never LDA as creator");
assert(spec.todos.some((t) => /PUBLIC_BASE_URL/.test(t)), "deep link origin TODO");
assert(spec.todos.some((t) => /description\/website/.test(t)), "form field mapping TODO");
assert(!/liquidity tax bucket/i.test(JSON.stringify(spec.argusAllocation)), "seat not mapped into liquidity numbers");

try { buildTokenSpec({ agent: { id: "x", name: "X" }, seatWallet: { address: "0x" + "11".repeat(20) } }); throw new Error("missing creator should throw"); }
catch (e) { if (!/connected wallet/.test(e.message)) throw e; }
try {
  buildTokenSpec({
    agent: { id: "x", name: "X" },
    seatWallet: { address: "0x" + "11".repeat(20) },
    ownerAddress: "0x" + "11".repeat(20),
  });
  throw new Error("seat-as-creator should throw");
} catch (e) { if (!/seat wallet/.test(e.message)) throw e; }
try {
  assertCreatorWallet("0x" + "aa".repeat(20), { houseAddress: "0x" + "aa".repeat(20) });
  throw new Error("house-as-creator should throw");
} catch (e) { if (!/arena\/house/.test(e.message)) throw e; }

assert(tokenContract({ spec: { address: "0x" + "ab".repeat(20) } }) === "0x" + "ab".repeat(20), "ca from spec");
assert(tokenContract({ spec: { address: "0x123" } }) === null, "reject short ca");
assert(tokenPageUrl({}) === ARGUS_APP.replace(/\/$/, "") + "/", "no ca → launchpad home, not a fake buy path");
assert(/\/token\/0x/.test(tokenPageUrl({ address: "0x" + "cd".repeat(20) })), "ca → argus token page");
const houseBuy = buyView(null, { house: true, name: "The Shark", id: "shark" });
assert(houseBuy.kind === "house" && !houseBuy.address, "house has no personal token");
const pendingBuy = buyView({ status: "pending_manual_launch", spec }, { name: "Cold Hands", id: "cold-hands" });
assert(pendingBuy.kind === "agent" && pendingBuy.symbol === "LDACOLDHAN" && !pendingBuy.address, "pending has symbol, no ca");
assert(pendingBuy.creator === spec.recipients.creator, "buy view exposes creator");
assert(pendingBuy.inAppSwap === false, "no invented in-app swap");
const q = quoteMockBuy(2, { symbol: "COLDHAND" });
eq(q.tokensOut, 2000, "mock rate");
eq(q.usdcIn, 2, "usdc in");
try { quoteMockBuy(0); throw new Error("zero should throw"); } catch (e) { if (e.message !== "bad_amount") throw e; }

(async () => {
  const pending = await onAgentRegistered({
    agent: { id: "a", name: "A" },
    seatWallet: { address: "0x" + "33".repeat(20) },
    ownerAddress: "0x" + "22".repeat(20),
  });
  assert(pending.status === "pending_manual_launch", "no webhook → pending");
  assert(!publicTokenView(pending).webhook, "no webhook leak");

  process.env.ARGUS_CREATE_URL = "https://operator.example/hook";
  const posted = await onAgentRegistered({
    agent: { id: "a", name: "A" }, seatWallet: { address: "0x" + "33".repeat(20) },
    ownerAddress: "0x" + "22".repeat(20),
    fetchImpl: async (url, opts) => {
      assert(url === "https://operator.example/hook", "webhook url");
      const body = JSON.parse(opts.body);
      assert(body.type === "agent_token_spec", "envelope");
      assert(body.spec.recipients.feeRecipient === body.spec.recipients.creator, "creator is fee recipient");
      assert(body.spec.metadata.description.includes("#LiarsDiceArena"), "hashtag in webhook spec");
      assert(body.spec.metadata.name === "A", "display name");
      assert(body.spec.recipients.creator !== body.spec.recipients.seatBankroll, "seat is not creator");
      return { ok: true, text: async () => JSON.stringify({ queued: true }) };
    },
  });
  assert(posted.status === "webhook_posted", "posted");
  delete process.env.ARGUS_CREATE_URL;
  console.log("argus ok");
})().catch((e) => { console.error(e); process.exit(1); });
