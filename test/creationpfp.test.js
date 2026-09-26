// One create → one canonical neon portrait. Selections change structure.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Show } = require("../src/showrunner");
const { buildRecipe, renderPfp, withBrandVersion, getAgentPfpUrl } = require("../src/pfp");
const { normalizeSelections, speciesOf, previewSelections } = require("../src/branding/creationSelections");
const { previewSvg } = require("../src/branding/creationPreviews");
const { buildNeonPfpVisualInstruction } = require("../src/branding/buildPfpPrompt");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }
function eq(a, b, m) { if (a !== b) throw new Error((m || "eq") + `: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }

const VISUAL = {
  silhouette: "SLIM_ELEGANT",
  facialAttitude: "STOIC",
  primaryColor: "#141820",
  secondaryColor: "#10141C",
  accentColor: "#4AD7FF",
  emblem: "CORE_RING",
  backgroundMotif: "SIGNAL_HALO",
  lightingStyle: "COOL_NEON_EDGE",
};

const A = {
  archetype: "executive",
  bodyType: "male_lean",
  expression: "confident",
  attire: "formal",
  colorPalette: "red",
  background: "city_night",
  accessories: "glasses",
};
const B = {
  archetype: "robot_ai",
  bodyType: "full_robot",
  expression: "intense",
  attire: "cyber_gear",
  colorPalette: "cyan",
  background: "tech_lab",
  accessories: "unique_fx",
};
const C = {
  archetype: "athlete",
  bodyType: "female_athletic",
  expression: "aggressive",
  attire: "sports",
  colorPalette: "orange",
  background: "arena",
  accessories: "none",
};
const D = {
  archetype: "animal",
  bodyType: "non_human",
  expression: "cocky",
  attire: "minimal",
  colorPalette: "green",
  background: "abstract",
  accessories: "none",
};

function recipeFor(selections) {
  return buildRecipe({ name: "Proof", archetype: "GAMBLER", visual: VISUAL, selections });
}

const exec = recipeFor(A);
const robot = recipeFor(B);
const athlete = recipeFor(C);
const animal = recipeFor(D);
eq(exec.species, "human", "executive is human");
eq(robot.species, "robot", "robot is synthetic");
eq(athlete.faceKind, "female_athletic", "athlete form");
eq(animal.species, "animal", "animal is non-human");
eq(speciesOf(B), "robot", "robot_ai + full_robot species");
const tech = recipeFor({ ...A, archetype: "tech", bodyType: "androgynous", attire: "cyber_gear" });
eq(tech.species, "human", "tech stays human");
assert(tech.augment === true, "tech is augmented");
assert(!robot.augment, "robot is not a human implant");
let retired = false;
try { renderPfp(exec); }
catch (err) { retired = err.code === "pfp_procedural_retired"; }
assert(retired, "selections do not draw a procedural bust");

const prompt = buildNeonPfpVisualInstruction({ creationSelections: A });
assert(prompt.includes("Archetype: executive"), "instruction names archetype");
assert(prompt.includes("robot_ai + full_robot"), "instruction keeps the robot rule");
assert(prompt.includes("No external image model") === false, "instruction itself is the art direction");
const recipePrompt = require("../src/pfp").promptFor(exec);
assert(!recipePrompt.includes("lda-pfp-v2"), "prompt does not name the retired renderer");
assert(recipePrompt.includes("Archetype: executive"), "selections are appended to the prompt");

eq(withBrandVersion("/api/show/agents/u_a/pfp.svg", { version: 2 }), "/api/show/agents/u_a/pfp.svg?v=2&s=6", "version query");
eq(withBrandVersion("/api/show/agents/u_a/pfp.svg?size=96", { version: 3 }), "/api/show/agents/u_a/pfp.svg?size=96&v=3&s=6", "version after size");
eq(getAgentPfpUrl({
  brand: { version: 4, assets: { canonicalPfp: "/api/show/agents/u_a/pfp.svg?v=4", avatar256: "/api/show/agents/u_a/pfp.svg?size=256&v=4" }, avatarUrl: "/legacy.png" },
}, 256), "/api/show/agents/u_a/pfp.svg?size=256&v=4&s=6", "sized canonical wins over legacy");

assert(previewSvg("archetype", "executive") == null, "option previews are not procedural busts");
assert(previewSvg("archetype", "robot_ai") == null, "robot preview is not a bust");
assert(previewSvg("nope", "nope") == null, "unknown preview is empty");
assert(previewSelections("nope", "nope") == null, "unknown preview is empty");
eq(normalizeSelections({ archetype: "nope" }).archetype, "executive", "unknown option falls back");

const app = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
assert(app.includes("agent-visual-options"), "option grid class");
assert(app.includes("Generate agent"), "one generate action");
assert(app.includes("Regenerate PFP"), "regenerate control");
assert(app.includes("/brand/generate"), "generate route");
assert(app.includes("data-pfp-debug"), "dev inspector");
assert(!/openai|replicate|stability|fal\.ai/i.test(fs.readFileSync(path.join(__dirname, "..", "src", "branding", "creationSelections.js"), "utf8")), "no new provider in selections");

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
    marketsEnabled: true,
  });
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lda-pfp-"));
  const show = boot(path.join(dir, "show.json"));
  const created = show.createAgent({
    name: "Vesper",
    shortDescription: "A quiet closer who spends one lie and waits.",
    archetype: "ASSASSIN",
    creationSelections: A,
  });
  eq(created.agent.status === "READY", false, "create persists before the portrait");
  const id = created.agent.id;
  const failed = boot(path.join(dir, "fail.json"));
  const failedDraft = failed.createAgent({
    name: "Vesper",
    shortDescription: "A quiet closer who spends one lie and waits.",
    archetype: "ASSASSIN",
    creationSelections: A,
  });
  let blew = false;
  try {
    await failed.generatePortrait(failedDraft.agent.id, {
      creationSelections: A,
      provider: { async generate() { return { provider: "procedural-svg", svg: "" }; } },
    });
  } catch (err) {
    blew = err.code === "generation_failed";
  }
  assert(blew, "empty image is a failure");
  eq(failed.userAgents.get(failedDraft.agent.id).pfpStatus, "GENERATION_FAILED", "failure status");
  eq(failed.brands.full(failedDraft.agent.id), null, "failure does not invent a brand");

  const sharp = require("sharp");
  async function solid(r, g, b) {
    return sharp({ create: { width: 16, height: 16, channels: 3, background: { r, g, b } } }).png().toBuffer();
  }
  const stub = {
    async generate({ prompt }) {
      const robotish = /Archetype: robot_ai/.test(String(prompt || ""));
      return { buffer: await solid(robotish ? 20 : 180, robotish ? 180 : 30, robotish ? 220 : 40), model: "test-stub", provider: "test-stub" };
    },
  };
  const unconfigured = boot(path.join(dir, "nokey.json"));
  const bare = unconfigured.createAgent({
    name: "Vesper",
    shortDescription: "A quiet closer who spends one lie and waits.",
    archetype: "ASSASSIN",
    creationSelections: A,
  });
  const savedKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const local = await unconfigured.generatePortrait(bare.agent.id, { creationSelections: A });
  if (savedKey) process.env.OPENAI_API_KEY = savedKey;
  eq(local.manifest.model, "neon-competitive-local", "generation does not call an image API");
  assert(local.brand.assets.canonicalPfp.includes("s=6"), "local portrait is stamped");
  const localFace = unconfigured.pfpImageFor(bare.agent.id, 96, 1);
  assert(localFace && localFace.mime === "image/webp", "saved portrait is webp without a key");

  const first = await show.generatePortrait(id, { creationSelections: A, provider: stub });
  eq(first.brand.version, 1, "first version");
  eq(first.brand.status, "READY", "ready");
  eq(first.brand.visualDirty, false, "clean");
  eq(first.brand.styleId, "neon-competitive", "style");
  assert(first.brand.assets.canonicalPfp.includes("v=1"), "canonical url is versioned");
  assert(first.brand.assets.canonicalPfp.includes("s=6"), "style stamp busts old svgs");
  assert(!first.svg, "generation does not return an svg bust");
  const face1 = show.pfpImageFor(id, 96, 1);
  assert(face1 && face1.mime === "image/webp", "served portrait is webp");
  eq(first.brand.animatedPfp.sourceCanonicalPfp, first.brand.assets.canonicalPfp, "poster uses the canonical portrait");
  eq(first.brand.animatedPfp.motionProfile, "NEON_COMPETITIVE", "neon motion");
  eq(first.brand.animatedPfp.engine, "neon-competitive", "not the procedural engine");
  eq(first.brand.generation.selections.archetype, "executive", "generation stores selections");
  assert(show.brands.publicOf(id).pfpUrl.includes("s=6"), "public url appears once the file exists");
  const oldUrl = first.brand.assets.canonicalPfp;
  const oldVersion = first.brand.version;
  const again = await show.generatePortrait(id, { creationSelections: B, provider: stub });
  eq(again.brand.version, oldVersion + 1, "regenerate bumps version");
  assert(again.brand.assets.canonicalPfp !== oldUrl, "canonical url changes");
  assert(again.manifest.prompt.includes("robot_ai"), "regenerate prompt is the robot");
  const previous = show.brands.full(id, "v1");
  assert(previous && previous.assets.canonicalPfp === oldUrl, "old version stays");
  const face2 = show.pfpImageFor(id, 96, 2);
  assert(face2 && !face1.buffer.equals(face2.buffer), "versioned portraits differ");
  eq(show.agentList().filter((row) => row.roster === "house").length, 12, "house cast stays 12");
  const house = show.brands.full("dracula");
  eq(house.brandVersion, "v1", "house brand version untouched");
  assert(!house.pfpRecipe, "house portrait was not regenerated");
  const view = show.brands.publicOf("dracula");
  assert(view.pfpUrl && view.pfpUrl.includes("s=6"), "house cast portrait needs no key");
  assert(view.creationSelections && view.creationSelections.archetype, "house gets default selections");
  const reloaded = boot(path.join(dir, "show.json"));
  eq(reloaded.brands.full(id).version, 2, "version reloads");
  eq(reloaded.userAgents.get(id).creationSelections.archetype, "robot_ai", "selections reload");
  eq(reloaded.brands.full(id, "v1").version, 1, "v1 reloads");

  const second = show.createAgent({
    name: "Vale",
    shortDescription: "A quiet closer who spends one lie and waits.",
    archetype: "ASSASSIN",
    creationSelections: A,
  });
  const retired = show.brands.full(id, "v1");
  const draft = show.userAgents.get(second.agent.id);
  draft.identity.visualIdentity.primaryColor = retired.visualIdentity.primaryColor;
  draft.identity.visualIdentity.secondaryColor = retired.visualIdentity.secondaryColor;
  draft.identity.visualIdentity.accentColor = "#5182F6";
  const red = await show.generatePortrait(second.agent.id, { creationSelections: A, provider: stub });
  eq(red.brand.version, 1, "second red executive still locks");
  assert(red.manifest.prompt.includes("executive"), "second portrait prompt is the executive");
  const { paletteNear } = require("../src/brands");
  assert(!paletteNear(red.brand, retired), "accent moves off the retired red palette");
  console.log("creation pfp ok");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
