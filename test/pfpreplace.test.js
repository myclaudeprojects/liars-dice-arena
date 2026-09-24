// Selections must replace the canonical portrait: four different concepts,
// a version bump, cache-busted URLs, and Test A must not look like Test B.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { CAST } = require("../src/characters");
const { Show } = require("../src/showrunner");
const { pathData } = require("../src/pfp");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }
function eq(a, b, m) { if (a !== b) throw new Error((m || "eq") + `: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }

const TEST_A = {
  archetype: "executive",
  bodyType: "male_lean",
  expression: "confident",
  attire: "formal",
  colorPalette: "red",
  background: "city_night",
  accessories: "glasses",
};
const TEST_B = {
  archetype: "robot_ai",
  bodyType: "full_robot",
  expression: "intense",
  attire: "cyber_gear",
  colorPalette: "cyan",
  background: "tech_lab",
  accessories: "unique_fx",
};

function boot(file) {
  return new Show({
    dataPath: file,
    sleep: async () => {},
    pickWindowMs: 0,
    turnDelayMs: 0,
    revealDelayMs: 0,
    settleHoldMs: 0,
    bootstrapCount: 0,
    loopEnabled: false,
    marketsEnabled: false,
  });
}

function make(show, name, selections, archetype) {
  return show.createAgent({
    name,
    shortDescription: "A quiet closer who spends one lie and waits.",
    archetype,
    creationSelections: selections,
  });
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lda-pfp-replace-"));
const file = path.join(dir, "show.json");
const show = boot(file);
const houseBefore = pathData(show.pfpSvgFor("dracula", 512));

const a = make(show, "Ada Executive", TEST_A, "GAMBLER");
const draftA = show.userAgents.get(a.agent.id);
eq(draftA.creationSelections.archetype, "executive", "selections persist");
eq(draftA.creationSelections.accessories, "glasses", "accessory id persists");
eq(draftA.visualDirty, true, "new visuals start dirty");
eq(draftA.status, "AWAITING_REGENERATION", "new visuals wait for a portrait");

const conceptsA = show.generateConcepts(a.agent.id, { count: 4, creationSelections: TEST_A });
eq(conceptsA.concepts.length, 4, "four concepts");
const pathsA = conceptsA.concepts.map((row) => pathData(row.pfpSvg));
eq(new Set(pathsA).size, 4, "concepts are not the same face");
for (const row of conceptsA.concepts) {
  assert(row.pfpSvg.includes('data-face="sharp"'), "executive face family");
  assert(row.pfpSvg.includes('data-wardrobe="suit"'), "formal attire");
  assert(row.pfpSvg.includes('data-accessory="glasses"'), "glasses stay");
  assert(row.pfpSvg.includes('data-background="city_night"'), "city night stays");
  assert(row.pfpSvg.includes('data-palette="red"'), "red palette stays");
  assert(/#F43B5F/i.test(row.pfpSvg), "red accent stays");
}

const locked = show.selectConcept(a.agent.id, conceptsA.concepts[0].id);
eq(locked.brand.version, 1, "first canonical version");
eq(locked.brand.brandVersion, "v1", "first brand version");
eq(locked.brand.visualDirty, false, "select clears the dirty flag");
eq(locked.brand.portraitStatus, "READY", "portrait is ready");
eq(locked.brand.generation.status, "READY", "generation stays ready");
eq(locked.brand.creationSelections.bodyType, "male_lean", "selections stored on the brand");
eq(locked.brand.assets.canonicalPfp, "/api/show/agents/" + a.agent.id + "/pfp.svg", "canonical path");
assert(!locked.brand.animatedPfp, "animation is computed, not stored");
const viewA = show.brands.publicOf(a.agent.id);
assert(viewA.pfpUrl.endsWith("?v=1"), "public portrait is cache-busted");
eq(viewA.animatedPfp.previewUrl, viewA.pfpUrl, "motion uses the same portrait");
eq(viewA.animatedPfp.version, 1, "motion version");
eq(viewA.animatedPfp.engine, "procedural-svg", "procedural motion");
eq(viewA.animatedPfp.motionProfile, "NEON_COMPETITIVE", "neon motion");
assert(show.pfpSvgFor(a.agent.id, 320, 1).includes('data-accessory="glasses"'), "v1 svg is the executive");

let blocked = false;
try { show.generateConcepts(a.agent.id, { count: 4 }); }
catch (e) { blocked = e.code === "brand_locked"; }
assert(blocked, "a clean brand does not regenerate by accident");

const dirty = show.updateSelections(a.agent.id, TEST_B);
eq(dirty.visualDirty, true, "option change dirties the portrait");
eq(dirty.status, "AWAITING_REGENERATION", "option change waits for regeneration");
eq(show.brands.full(a.agent.id).visualDirty, true, "active brand records the dirty flag");
eq(show.brands.full(a.agent.id).portraitStatus, "AWAITING_REGENERATION", "portrait status");

const conceptsB = show.generateConcepts(a.agent.id, { count: 4, regenerate: true, creationSelections: TEST_B });
eq(conceptsB.concepts.length, 4, "regenerate makes four concepts");
const pathsB = conceptsB.concepts.map((row) => pathData(row.pfpSvg));
eq(new Set(pathsB).size, 4, "regenerated concepts differ");
for (const row of conceptsB.concepts) {
  assert(row.pfpSvg.includes('data-face="synthetic"'), "robot face");
  assert(row.pfpSvg.includes('data-wardrobe="cyber"'), "cyber gear");
  assert(row.pfpSvg.includes('data-background="tech_lab"'), "tech lab");
  assert(row.pfpSvg.includes('data-accessory="fx"'), "unique fx");
  assert(row.pfpSvg.includes('data-palette="cyan"'), "cyan palette");
  assert(/#2BE4FF/i.test(row.pfpSvg), "cyan accent");
}
assert(pathsA[0] !== pathsB[0], "test A and test B are different drawings");

const replaced = show.selectConcept(a.agent.id, conceptsB.concepts[2].id);
eq(replaced.brand.brandVersion, "v2", "regenerate appends v2");
eq(replaced.brand.version, 2, "numeric version bumps");
eq(replaced.brand.visualDirty, false, "v2 is clean");
eq(show.brands.versions(a.agent.id).length, 2, "v1 is kept");
eq(show.brands.full(a.agent.id, "v1").visualIdentity.creationLook.accessory, "glasses", "v1 face stays");
const oldSvg = show.pfpSvgFor(a.agent.id, 512, 1);
const newSvg = show.pfpSvgFor(a.agent.id, 512, 2);
assert(oldSvg.includes('data-accessory="glasses"') && oldSvg.includes('data-background="city_night"'), "version 1 still serves the executive");
assert(newSvg.includes('data-accessory="fx"') && newSvg.includes('data-face="synthetic"'), "version 2 serves the robot");
assert(pathData(oldSvg) !== pathData(newSvg), "versions are different characters");
const active = show.brands.publicOf(a.agent.id);
assert(active.pfpUrl.includes("v=2"), "active url bumped");
eq(active.animatedPfp.previewUrl, active.pfpUrl, "active motion matches the new portrait");
eq(active.animatedPfp.version, 2, "active motion version");
assert(show.pfpSvgFor(a.agent.id, 96).includes('data-accessory="fx"'), "default route serves the active portrait");

const b = make(show, "Bolt Chassis", TEST_B, "MACHINE");
const lockedB = show.selectConcept(b.agent.id, show.generateConcepts(b.agent.id, { count: 4 }).concepts[1].id);
assert(pathData(show.pfpSvgFor(a.agent.id, 512)) !== pathData(show.pfpSvgFor(b.agent.id, 512)), "two agents do not share a face");
assert(lockedB.brand.creationSelections.archetype === "robot_ai", "second agent keeps its selections");
eq(show.brands.list().length, 12, "house book stays 12");
eq(CAST.length, 12, "cast stays 12");
eq(pathData(show.pfpSvgFor("dracula", 512)), houseBefore, "house portrait was not rewritten");

const reloaded = boot(file);
assert(reloaded.pfpSvgFor(a.agent.id, 320).includes('data-accessory="fx"'), "hard reload keeps the new portrait");
assert(reloaded.pfpSvgFor(a.agent.id, 320, 1).includes('data-accessory="glasses"'), "hard reload still has v1");
assert(reloaded.brands.publicOf(a.agent.id).pfpUrl.includes("v=2"), "reloaded url stays cache-busted");
eq(reloaded.brands.full("dracula").title, "The Gambler", "house brand untouched");

const app = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
const ui = fs.readFileSync(path.join(__dirname, "..", "public", "ui.js"), "utf8");
assert(app.includes("Regenerate PFP"), "profile exposes regenerate");
assert(app.includes('focusAgent.roster === "user"'), "regenerate stays off the house cast");
assert(app.includes("creationSelections"), "client sends selections");
assert(app.includes("v=[1-9]"), "client allows a version query");
assert(ui.includes("v=[1-9]"), "avatar helper allows a version query");
