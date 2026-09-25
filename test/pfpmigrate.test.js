// Migration check: a legacy user agent (no stored selections) gets a new styled version; house cast renders in the new style with signature headwear.
const fs = require("fs"), os = require("os"), path = require("path");
const { Show } = require("../src/showrunner");
const { pathData, recipeFromBrand } = require("../src/pfp");
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
  const svgBefore = show.pfpSvgFor(a.agent.id, 512);
  const res = await show.migrateLegacyPortraits();
  eq(res.migrated, 1, "one agent migrated");
  const after = show.brands.full(a.agent.id);
  eq(after.version, 2, "migration wrote version 2");
  assert(after.creationSelections && after.creationSelections.archetype, "migrated brand stores inferred selections");
  assert(/\?v=2$/.test(after.assets.canonicalPfp), "new cache-busted URL");
  eq(show.legacyPortraitAgents().length, 0, "no legacy agents remain");
  eq(show.pfpMigration >= 2, true, "migration flag persisted");
  const res2 = await show.migrateLegacyPortraits();
  eq(res2.skipped, "done", "does not re-run");
  const again = boot();
  eq(again.pfpMigration >= 2, true, "flag survives reload");
  eq(again.brands.full(a.agent.id).version, 2, "version survives reload");
  // house cast: new-style render keeps signature headwear and differs per agent
  const faces = new Set(); let crowns = 0;
  for (const seed of SEED_BRANDS) { const r = recipeFromBrand(seed); if (r.selections) crowns += (r.headwear === "crown" ? 1 : 0); faces.add(pathData(require("../src/pfp").renderPfp(r, { size: 512, nonce: "h" }))); }
  eq(faces.size, SEED_BRANDS.length, "house cast portraits are all distinct");
  assert(crowns >= 1, "at least one house signature headwear (crown) preserved");
  console.log("pfp migration ok");
})().catch((e) => { console.error(e); process.exit(1); });
