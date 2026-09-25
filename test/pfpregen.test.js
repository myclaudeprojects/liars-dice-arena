// PFP regeneration & replacement — end-to-end acceptance (spec §17 / §20).
//
//   1. Visual selections reach the concept portraits (Executive ≠ Robot).
//   2. Four concepts of ONE selection set are visibly different portraits.
//   3. Selecting a concept saves a versioned brand that stores the selections,
//      and the served /pfp.svg renders from them.
//   4. Changing selections on a locked agent → new concepts → select → version 2,
//      new cache-busted URLs, different served portrait, old version still readable.
//   5. recipeFromBrand honours creationSelections (no fallback to archetype defaults).
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Show } = require("../src/showrunner");
const { pathData, recipeFromBrand, renderPfp } = require("../src/pfp");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }
function eq(a, b, m) { if (a !== b) throw new Error((m || "eq") + `: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }

const EXECUTIVE = { archetype: "executive", bodyType: "male_lean", expression: "confident", attire: "formal", colorPalette: "red", background: "city_night", accessories: "glasses" };
const ROBOT = { archetype: "robot_ai", bodyType: "full_robot", expression: "intense", attire: "cyber_gear", colorPalette: "cyan", background: "tech_lab", accessories: "unique_fx" };

function boot(file) {
  return new Show({ dataPath: file, sleep: async () => {}, pickWindowMs: 0, turnDelayMs: 0, revealDelayMs: 0, settleHoldMs: 0, bootstrapCount: 0, loopEnabled: false, marketsEnabled: true });
}
const base = (name, archetype) => ({ name, shortDescription: `${name} plays to win.`, archetype, aggression: 0.5, bluffing: 0.5, discipline: 0.6, chaos: 0.3 });

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lda-regen-"));
  const show = boot(path.join(dir, "show.json"));

  // ---- Test A vs Test B: dramatically different option sets → different characters
  const a = show.createAgent({ ...base("Boardroom", "COMMANDER"), creationSelections: EXECUTIVE });
  const b = show.createAgent({ ...base("Unit Nine", "MACHINE"), creationSelections: ROBOT });
  const ca = show.generateConcepts(a.agent.id, { count: 4 });
  const cb = show.generateConcepts(b.agent.id, { count: 4 });
  eq(ca.concepts.length, 4, "four concepts A");
  eq(cb.concepts.length, 4, "four concepts B");
  for (const c of ca.concepts) eq(c.creationSelections.archetype, "executive", "concept carries the user's selections");
  assert(pathData(ca.concepts[0].pfpSvg) !== pathData(cb.concepts[0].pfpSvg), "executive and robot are different characters");
  assert(/robot|skeletal|MECHANICAL/.test(JSON.stringify(cb.concepts[0].pfp.recipe.species + cb.concepts[0].pfp.recipe.silhouette)), "robot selections drive a mechanical rig");
  eq(ca.concepts[0].pfp.recipe.accessory, "glasses", "accessory selection reaches the recipe");
  eq(ca.concepts[0].pfp.recipe.background, "city_night", "background selection reaches the recipe");

  // ---- four concepts of the same selections are visibly different, and concept 0 is the pure rendition
  const faces = new Set(ca.concepts.map((c) => pathData(c.pfpSvg)));
  eq(faces.size, 4, "four concepts are four different portraits");
  eq(ca.concepts[0].pfpVariation, 0, "first concept is the pure selection");
  for (const c of ca.concepts) eq(c.pfp.recipe.selections.colorPalette, "red", "variants keep the chosen palette");

  // ---- select → versioned save with selections; served pfp renders from the locked recipe
  const chosen = ca.concepts[2];
  const locked = show.selectConcept(a.agent.id, chosen.id);
  eq(locked.brand.version, 1, "first save is version 1");
  eq(locked.brand.creationSelections.attire, "formal", "brand stores creationSelections");
  eq(locked.brand.pfpVariation, chosen.pfpVariation, "brand stores the chosen concept variant");
  eq(locked.brand.visualDirty, false, "not dirty after save");
  eq(locked.brand.status, "READY", "ready after save");
  assert(/\?v=1$/.test(locked.brand.assets.canonicalPfp), "canonical URL is version-stamped");
  eq(locked.brand.animatedPfp.sourceCanonicalPfp, locked.brand.assets.canonicalPfp, "animation derives from the chosen portrait");
  const servedV1 = show.pfpSvgFor(a.agent.id, 512);
  eq(pathData(servedV1), pathData(chosen.pfpSvg), "served portrait IS the chosen concept");
  const view1 = show.brands.publicOf(a.agent.id);
  eq(view1.version, 1, "public view version 1");
  eq(view1.creationSelections.accessories, "glasses", "public view exposes stored selections");

  // ---- recipeFromBrand honours selections (what house/legacy paths use)
  const full = show.brands.full(a.agent.id);
  const rebuilt = recipeFromBrand({ ...full, pfpRecipe: undefined });
  eq(rebuilt.accessory, "glasses", "recipeFromBrand reads creationSelections");
  eq(rebuilt.conceptVariant, chosen.pfpVariation, "recipeFromBrand reads the stored variant");
  eq(pathData(renderPfp(rebuilt, { size: 512, nonce: "x" })), pathData(servedV1), "recipeFromBrand reproduces the served portrait");

  // ---- regenerate on a locked agent: new selections → 4 concepts → select → version 2
  const dirty = show.updateSelections(a.agent.id, ROBOT);
  eq(dirty.visualDirty, true, "selection change marks visualDirty");
  eq(show.brands.full(a.agent.id).status, "AWAITING_REGENERATION", "active brand flagged AWAITING_REGENERATION");
  const round2 = show.generateConcepts(a.agent.id, { count: 4 });
  eq(round2.concepts.length, 4, "regenerate produces four concepts");
  eq(round2.regenerating, true, "regenerate round reported");
  eq(show.userAgents.get(a.agent.id).status, "READY", "agent stays playable during regeneration");
  assert(pathData(show.pfpSvgFor(a.agent.id, 512)) === pathData(servedV1), "old portrait stays live until a concept is chosen");
  const pick2 = round2.concepts[1];
  const locked2 = show.selectConcept(a.agent.id, pick2.id);
  eq(locked2.brand.version, 2, "second save is version 2");
  eq(locked2.brand.creationSelections.bodyType, "full_robot", "version 2 stores the new selections");
  assert(/\?v=2$/.test(locked2.brand.assets.canonicalPfp), "URL changes with the version (cache bust)");
  const servedV2 = show.pfpSvgFor(a.agent.id, 512);
  assert(pathData(servedV2) !== pathData(servedV1), "served portrait visibly changed after regeneration");
  eq(pathData(servedV2), pathData(pick2.pfpSvg), "served portrait IS the newly chosen concept");
  eq(pathData(show.pfpSvgFor(a.agent.id, 512, 1)), pathData(servedV1), "old version still renders by ?v=1 (non-destructive)");
  eq(show.brands.publicOf(a.agent.id).version, 2, "public view moves to version 2");
  eq(show.userAgents.get(a.agent.id).visualDirty, false, "draft clean after save");

  // ---- explicit regenerate without changing selections (Regenerate PFP button) also works
  const round3 = show.generateConcepts(a.agent.id, { count: 4, regenerate: true });
  eq(round3.concepts.length, 4, "explicit regenerate produces concepts");
  const locked3 = show.selectConcept(a.agent.id, round3.concepts[0].id);
  eq(locked3.brand.version, 3, "third save is version 3");

  // ---- survives reload: selections and version persist
  const again = boot(path.join(dir, "show.json"));
  const reloaded = again.brands.full(a.agent.id);
  eq(reloaded.version, 3, "version persists");
  eq(reloaded.creationSelections.archetype, "robot_ai", "selections persist");
  eq(pathData(again.pfpSvgFor(a.agent.id, 512)), pathData(show.pfpSvgFor(a.agent.id, 512)), "portrait identical after reload");

  console.log("pfp regeneration ok");
})().catch((e) => { console.error(e); process.exit(1); });
