// Option previews are procedural SVG. Categories must change different parts
// of the portrait, and the same seed must redraw the same face.
const { SEED_BRANDS } = require("../src/brands");
const { Show } = require("../src/showrunner");
const { pathData, qualityCheck, PFP_STYLE_ID } = require("../src/pfp");
const {
  HOUSE_STYLE_ID,
  AGENT_CREATION_OPTIONS,
  DEFAULT_SELECTIONS,
  CATEGORY_KEYS,
} = require("../src/agentCreation/optionRegistry");
const { PREVIEW_SEEDS, seedFor } = require("../src/agentCreation/previewSeeds");
const { VARIATION_RULES } = require("../src/agentCreation/variationRules");
const { buildOptionPreviewPrompt } = require("../src/agentCreation/buildOptionPreviewPrompt");
const { resolveLook } = require("../src/agentCreation/resolveLook");
const { optionPreview, composedPreview, renderLook } = require("../src/agentCreation/creationPreview");
const fs = require("fs");
const os = require("os");
const path = require("path");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }
function eq(a, b, m) { if (a !== b) throw new Error((m || "eq") + `: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }

eq(HOUSE_STYLE_ID, "neon-competitive", "house style id");
eq(HOUSE_STYLE_ID, PFP_STYLE_ID, "registry matches the locked preset");
eq(PREVIEW_SEEDS.archetype.executive, "preview_archetype_executive_v1", "executive seed");
eq(seedFor("bodyType", "skeletal"), "preview_bodyType_skeletal_v1", "body seed");
for (const key of CATEGORY_KEYS) {
  assert(VARIATION_RULES[key] && VARIATION_RULES[key].controls.length >= 3, key + " controls traits");
  assert(AGENT_CREATION_OPTIONS[key].length >= 8, key + " has options");
}

function draw(category, id) {
  const selections = { ...DEFAULT_SELECTIONS, [category]: id };
  const look = resolveLook(selections, { emphasis: category });
  return renderLook(look, { seed: seedFor(category, id), nonce: category + "_" + id, size: 512 });
}

function check(category, id) {
  const drawn = draw(category, id);
  const quality = qualityCheck(drawn.recipe, drawn.svg);
  assert(quality.ok, category + " " + id + " " + quality.reasons.join(","));
  assert(drawn.svg.includes('data-pfp-style="neon-competitive"'), id + " stays neon");
  assert(drawn.svg.includes('data-style="lda-pfp-v2"'), id + " stays procedural");
  assert(!/<text[\s>]|<image[\s>]/.test(drawn.svg), id + " has no text or bitmap");
  const again = draw(category, id);
  eq(pathData(drawn.svg), pathData(again.svg), id + " is stable");
  return drawn.svg;
}

const executive = check("archetype", "executive");
const street = check("archetype", "street");
const animal = check("archetype", "animal");
const robot = check("archetype", "robot_ai");
const fantasy = check("archetype", "fantasy");
assert(pathData(executive) !== pathData(street), "street is not a recolor of executive");
assert(pathData(executive) !== pathData(animal), "animal changes the face");
assert(pathData(executive) !== pathData(robot), "robot changes the face");
assert(executive.includes('data-face="sharp"') && street.includes('data-face="wide"'), "archetype face ids");
assert(animal.includes('data-face="snout"') && robot.includes('data-face="synthetic"'), "non-human faces");
assert(executive.includes('data-wardrobe="suit"') && street.includes('data-wardrobe="jacket"'), "archetype wardrobe");
assert(fantasy.includes('data-wardrobe="ornament"') && fantasy.includes('data-pfp-style="neon-competitive"'), "fantasy stays in house style");

const lean = check("bodyType", "male_lean");
const muscular = check("bodyType", "male_muscular");
const skeletal = check("bodyType", "skeletal");
const elder = check("bodyType", "elder");
assert(pathData(lean) !== pathData(muscular), "muscular changes the build");
assert(pathData(lean) !== pathData(skeletal), "skeletal changes the face");
assert(skeletal.includes('data-face="skull"'), "skeletal skull");
assert(elder.includes('data-face="weathered"'), "elder face");
assert(muscular.includes('data-wardrobe="jacket"') && lean.includes('data-wardrobe="suit"'), "body type changes wardrobe");

const calm = check("expression", "calm");
const aggressive = check("expression", "aggressive");
const unhinged = check("expression", "unhinged");
assert(pathData(calm) !== pathData(aggressive) && pathData(calm) !== pathData(unhinged), "expression changes the face");
assert(calm.includes('data-face="sharp"') && aggressive.includes('data-face="sharp"'), "expression keeps the locked face family");

const formal = check("attire", "formal");
const sports = check("attire", "sports");
const hood = check("attire", "hood_mask");
assert(formal.includes('data-wardrobe="suit"') && sports.includes('data-wardrobe="jersey"'), "attire ids");
assert(hood.includes('data-accessory="mask"'), "hood wears a mask");
assert(pathData(formal) !== pathData(sports), "attire paths differ");

const red = check("colorPalette", "red");
const blue = check("colorPalette", "blue");
const multi = check("colorPalette", "multi");
assert(/#F43B5F/i.test(red) && /#4AD7FF/i.test(blue), "palette accents");
assert(/#FF57D2/i.test(multi) && /#7DF0FF/i.test(multi), "multi uses two accents");
assert(red.includes('data-palette="red"') && blue.includes('data-palette="blue"'), "palette ids");

const city = check("background", "city_night");
const space = check("background", "space");
const beach = check("background", "beach");
assert(city.includes('data-background="city_night"') && space.includes('data-background="space"'), "background ids");
assert(pathData(city) !== pathData(space) && pathData(city) !== pathData(beach), "backgrounds differ");

const glasses = check("accessories", "glasses");
const mask = check("accessories", "mask");
const none = check("accessories", "none");
const pet = check("accessories", "pet");
assert(glasses.includes('data-accessory="glasses"') && mask.includes('data-accessory="mask"'), "accessory ids");
assert(pathData(glasses) !== pathData(none) && pathData(pet) !== pathData(none), "accessories are drawn");

const prompt = buildOptionPreviewPrompt({
  category: "archetype",
  optionId: "street",
  lockedSelections: DEFAULT_SELECTIONS,
});
assert(prompt.includes("street") && prompt.includes("lda-pfp-v2") && prompt.includes("Not fantasy-heavy"), "prompt names the option and the renderer");
const card = optionPreview("archetype", "athlete");
eq(card.manifest.seed, "preview_archetype_athlete_v1", "manifest seed");
eq(card.manifest.model, "procedural-svg", "no image model");
eq(card.manifest.optionId, "athlete", "manifest option");

const heroA = composedPreview({ ...DEFAULT_SELECTIONS, archetype: "animal", bodyType: "female_athletic" });
const heroB = composedPreview({ ...DEFAULT_SELECTIONS, archetype: "animal", bodyType: "female_athletic" });
eq(pathData(heroA.svg), pathData(heroB.svg), "composed preview is stable");
assert(heroA.svg.includes('data-face="snout"'), "animal face stays when the body is a human build");
assert(heroA.svg.includes('data-wardrobe="suit"'), "formal attire still dresses the animal");
assert(pathData(heroA.svg) !== pathData(composedPreview(DEFAULT_SELECTIONS).svg), "composed look is not the default executive");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lda-look-"));
const show = new Show({
  dataPath: path.join(dir, "show.json"),
  sleep: async () => {},
  pickWindowMs: 0,
  turnDelayMs: 0,
  revealDelayMs: 0,
  settleHoldMs: 0,
  bootstrapCount: 0,
  loopEnabled: false,
  marketsEnabled: false,
});
const created = show.createAgent({
  name: "Vesper",
  shortDescription: "A quiet closer who spends one lie and waits.",
  archetype: "ASSASSIN",
  creationOptions: {
    archetype: "street",
    bodyType: "female_athletic",
    expression: "intense",
    attire: "streetwear",
    colorPalette: "cyan",
    background: "club",
    accessories: "headphones",
  },
});
eq(created.identity.visualIdentity.creationLook.face, "angular", "athletic body changes the street face");
assert(created.identity.visualIdentity.creationLook.wardrobe === "jacket", "streetwear attire is the wardrobe");
eq(created.identity.visualIdentity.accentColor, "#2BE4FF", "palette accent is stored");
const concepts = show.generateConcepts(created.agent.id, { count: 4 });
assert(concepts.concepts.every((row) => row.pfpSvg.includes('data-background="club"')), "concepts keep the background");
assert(concepts.concepts.every((row) => row.pfpSvg.includes('data-accessory="headphones"')), "concepts keep the accessory");
assert(concepts.concepts.every((row) => /#2BE4FF/i.test(row.pfpSvg)), "concepts keep the cyan accent");
const locked = show.selectConcept(created.agent.id, concepts.concepts[0].id);
eq(locked.brand.creationOptions.archetype, "street", "option id is stored");
eq(locked.brand.creationOptions.bodyType, "female_athletic", "body id is stored");
eq(locked.brand.creationOptions.seeds.archetype, "preview_archetype_street_v1", "seed is stored");
eq(locked.brand.creationOptions.model, "procedural-svg", "renderer is recorded");
assert(locked.brand.creationOptions.prompt.includes("Street"), "prompt is stored");
eq(locked.brand.pfpStyleVersion, "lda-pfp-v2", "style version stays");
assert(show.pfpSvgFor(created.agent.id, 96).includes('data-accessory="headphones"'), "served portrait keeps the accessory");
assert(!SEED_BRANDS.some((seed) => seed.agentId === created.agent.id), "user agent is not house cast");

const plain = show.createAgent({
  name: "Plain",
  shortDescription: "A quiet closer who spends one lie and waits.",
  archetype: "GAMBLER",
});
assert(!plain.identity.visualIdentity.creationLook, "omitted options do not force a creation look");

console.log("creationpreview ok");
