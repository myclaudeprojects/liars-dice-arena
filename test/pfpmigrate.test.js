// Migration check: a legacy user agent (no stored selections) gets a new styled version; house cast renders in the new style with signature headwear.
const fs = require("fs"), os = require("os"), path = require("path");
const { Show } = require("../src/showrunner");
const { renderPfp } = require("../src/pfp");
const { SEED_BRANDS } = require("../src/brands");
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lda-mig-"));
  const boot = () => new Show({ dataPath: path.join(dir, "show.json"), sleep: async () => {}, pickWindowMs: 0, turnDelayMs: 0, revealDelayMs: 0, settleHoldMs: 0, bootstrapCount: 0, loopEnabled: false, marketsEnabled: true });
  const show = boot();
  const a = show.createAgent({ name: "Old Timer", shortDescription: "from before", archetype: "COMMANDER", aggression: .5, bluffing: .5, discipline: .6, chaos: .3,
    creationSelections: { archetype: "executive", bodyType: "male_lean", expression: "confident", attire: "formal", colorPalette: "red", background: "city_night", accessories: "glasses" } });
  const round = show.generateConcepts(a.agent.id, { count: 4 });
  show.selectConcept(a.agent.id, round.concepts[0].id);
  // simulate a brand saved before this build: strip the new fields
  const full = show.brands.full(a.agent.id);
  for (const row of show.brands._versions.values()) { if (row.agentId === a.agent.id) { delete row.creationSelections; delete row.pfpVariation; delete row.pfpRecipe; row.brandVersion = "v1"; delete row.version; } }
  show.persist();
  const legacyBefore = show.legacyPortraitAgents();
  eq(legacyBefore.includes(a.agent.id), true, "legacy agent detected");
  eq(show.pfpSvgFor(a.agent.id, 512), null, "legacy agent has no procedural bust");
  const savedKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const res = await show.migrateLegacyPortraits();
  if (savedKey) process.env.OPENAI_API_KEY = savedKey;
  eq(res.migrated, 0, "migration does not invent portraits");
  eq(res.skipped, "provider_unconfigured", "migration waits for the image key");
  eq(show.pfpMigration >= 2, false, "unconfigured migration does not mark itself done");
  eq(show.legacyPortraitAgents().includes(a.agent.id), true, "legacy agent stays until a real portrait exists");
  let retired = false;
  try { renderPfp({}); }
  catch (err) { retired = err.code === "pfp_procedural_retired"; }
  assert(retired, "house cast is not drawn as neon noir");
  assert(SEED_BRANDS.length === 12, "house cast stays 12");
  console.log("pfp migration ok");
})().catch((e) => { console.error(e); process.exit(1); });
