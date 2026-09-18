const {
  AGENT_TOKEN_ECONOMICS, assertEconomics, toArgusFormAllocation,
  buildTokenSpec, onAgentRegistered, tokenSymbol, publicTokenView,
  tokenContract, tokenPageUrl, buyView, quoteMockBuy, ARGUS_APP,
  assertCreatorWallet, publicBaseUrl, tokenTaxLabel,
} = require("../src/argus");

function assert(cond, msg) { if (!cond) throw new Error(msg); }
const eq = (a, b, m) => { if (Math.abs(a - b) > 1e-9) throw new Error(m + `: ${a} != ${b}`); };

assertEconomics(AGENT_TOKEN_ECONOMICS);
eq(AGENT_TOKEN_ECONOMICS.creatorFunds, 1, "100% creator");
eq(AGENT_TOKEN_ECONOMICS.holderDividends, 0, "0 dividends");
assert((AGENT_TOKEN_ECONOMICS.arenaSeatBankroll || 0) === 0, "no seat bankroll tax");
assert(AGENT_TOKEN_ECONOMICS.platformPrizeTreasury === undefined, "no prize treasury slice");
eq(AGENT_TOKEN_ECONOMICS.buybackBurn, 0, "0 burn");
eq(AGENT_TOKEN_ECONOMICS.liquidityOngoing, 0, "no lp tax");

const form = toArgusFormAllocation();
eq(form.creatorFunds, 1, "creator bucket 100");
eq(form.holderDividends, 0, "div 0");
eq(form.buybackBurn, 0, "burn 0");
eq(form.liquidity, 0, "liquidity tax 0");
eq(form.creatorFeeRecipient, "fee_router_contract", "router not EOA");
eq(form.feeRouter.platformTreasuryBps, 5000, "50 treasury");
eq(form.feeRouter.personaCreatorBps, 5000, "50 persona");
eq(form.creatorFunds + form.holderDividends + form.buybackBurn + form.liquidity, 1, "form buckets 100%");
assert(/launch blocker/i.test(form.blockerIfNonZeroRequired), "blocker documented");

try {
  toArgusFormAllocation({ ...AGENT_TOKEN_ECONOMICS, liquidityOngoing: 0.33, creatorFunds: 0.67 });
  throw new Error("should reject liquidity tax");
} catch (e) { if (!/liquidity/.test(e.message) && !/100% Creator/.test(e.message) && !/sum/.test(e.message)) throw e; }

try {
  toArgusFormAllocation({ ...AGENT_TOKEN_ECONOMICS, arenaSeatBankroll: 0.25, creatorFunds: 0.75 });
  throw new Error("should reject seat bankroll tax");
} catch (e) { if (!/seat bankroll/.test(e.message)) throw e; }

assert(tokenSymbol("Cold Hands", "cold-hands") === "LDACOLDHAN", "LDA ticker");
assert(tokenSymbol("LDA Bot", "lda-bot") === "LDABOT", "no double LDA prefix");
assert(publicBaseUrl("https://example.test/arena/") === "https://example.test", "origin only");
assert(publicBaseUrl("") === null, "no guessed domain");
assert(/100% Creator/.test(tokenTaxLabel()) && /fee router/.test(tokenTaxLabel()), "tax label");

const seat = { address: "0x" + "44".repeat(20) };
const router = "0x" + "55".repeat(20);
const factory = "0x" + "66".repeat(20);
const spec = buildTokenSpec({
  agent: { id: "cold-hands", name: "Cold Hands" },
  ownerAddress: "0x" + "22".repeat(20),
  deployerAddress: factory,
  factoryAddress: factory,
  feeRouterAddress: router,
  houseAddress: "0x341BB8851Ff8fD9EAE20ea083c2F779e646B8488",
  seatWallet: seat,
});
assert(spec.name === "Cold Hands", "token name is display name");
assert(spec.symbol === "LDACOLDHAN", "LDA symbol");
assert(spec.metadata.description.includes("Liar's Dice Arena agent · watch & tip"), "short funnel line");
assert(spec.metadata.description.includes("/agent/cold-hands"), "agent deep link");
assert(spec.metadata.description.includes("#LiarsDiceArena"), "hashtag");
assert(!/30%|35%|25%|10%/.test(spec.metadata.description), "economics stay off-chain");
assert(spec.factory.kind === "lda_factory", "lda factory");
assert(spec.factory.feeRecipientIsDeploymentKey === false, "factory is not fee recipient");
assert(spec.recipients.feeRecipient === router, "fee recipient is router");
assert(spec.recipients.feeRecipient !== spec.recipients.creator, "router is not the EOA");
assert(spec.recipients.feeRecipientIsRawEoa === false, "not raw EOA");
assert(spec.recipients.personaCreator === ("0x" + "22".repeat(20)), "persona creator");
assert(spec.feeRouter.split.platformTreasuryBps === 5000, "50/50");
assert(spec.liquidity.ongoingTax === false, "lp seed only");
assert(!spec.recipients.seatBankroll, "no seat bankroll recipient");
assert(spec.todos.some((t) => /launch blocker/.test(t)), "blocker TODO");
assert(spec.todos.some((t) => /fee-router CONTRACT/.test(t)), "router TODO");
assert(spec.todos.some((t) => /PUBLIC_BASE_URL/.test(t)), "deep link origin TODO");

const specAbs = buildTokenSpec({
  agent: { id: "cold-hands", name: "Cold Hands" },
  ownerAddress: "0x" + "22".repeat(20),
  seatWallet: seat,
  feeRouterAddress: router,
  siteOrigin: "https://arena.example",
});
assert(specAbs.metadata.website === "https://arena.example/agent/cold-hands", "absolute website");
assert(/\/api\/agents\/cold-hands\/avatar/.test(spec.metadata.image), "generated avatar on spec");

try { buildTokenSpec({ agent: { id: "x", name: "X" } }); throw new Error("missing creator should throw"); }
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
  throw new Error("treasury-as-creator should throw");
} catch (e) { if (!/platform treasury/.test(e.message)) throw e; }
try {
  assertCreatorWallet(router, { feeRouterAddress: router });
  throw new Error("router-as-creator should throw");
} catch (e) { if (!/fee router/.test(e.message)) throw e; }

assert(tokenContract({ spec: { address: "0x" + "ab".repeat(20) } }) === "0x" + "ab".repeat(20), "ca from spec");
assert(tokenPageUrl({}) === ARGUS_APP.replace(/\/$/, "") + "/", "no ca → launchpad home");
const pendingBuy = buyView({ status: "pending_manual_launch", spec }, { name: "Cold Hands", id: "cold-hands" });
assert(pendingBuy.kind === "agent" && pendingBuy.symbol === "LDACOLDHAN", "pending has symbol");
assert(pendingBuy.feeRecipient === router, "buy view fee recipient is router");
assert(pendingBuy.feeRecipientKind === "fee_router_contract", "kind");
eq(pendingBuy.economics.creatorFunds, 1, "buy view 100% creator");
assert(/100% Creator/.test(pendingBuy.taxLabel), "tax label on buy view");
const q = quoteMockBuy(2, { symbol: "COLDHAND" });
eq(q.tokensOut, 2000, "mock rate");

(async () => {
  const pending = await onAgentRegistered({
    agent: { id: "a", name: "A" },
    ownerAddress: "0x" + "22".repeat(20),
    seatWallet: seat,
    feeRouterAddress: router,
  });
  assert(pending.status === "pending_manual_launch", "no webhook → pending");
  assert(!publicTokenView(pending).webhook, "no webhook leak");

  process.env.ARGUS_CREATE_URL = "https://operator.example/hook";
  const posted = await onAgentRegistered({
    agent: { id: "a", name: "A" },
    ownerAddress: "0x" + "22".repeat(20),
    seatWallet: seat,
    feeRouterAddress: router,
    fetchImpl: async (url, opts) => {
      const body = JSON.parse(opts.body);
      assert(body.spec.recipients.feeRecipient === router, "webhook fee recipient is router");
      assert(body.spec.recipients.feeRecipient !== body.spec.recipients.creator, "not EOA");
      return { ok: true, text: async () => JSON.stringify({ queued: true }) };
    },
  });
  assert(posted.status === "webhook_posted", "posted");
  delete process.env.ARGUS_CREATE_URL;
  console.log("argus ok");
})().catch((e) => { console.error(e); process.exit(1); });
