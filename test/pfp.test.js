// Procedural PFP portraits: square, one face, avatar sizes share the drawing.
const { SEED_BRANDS } = require("../src/brands");
const {
  AVATAR_SIZES, buildRecipe, recipeFromBrand, renderPfp, qualityCheck, pathData, promptFor,
} = require("../src/pfp");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }
function eq(a, b, m) { if (a !== b) throw new Error((m || "eq") + `: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }

for (const brand of SEED_BRANDS) {
  const recipe = recipeFromBrand(brand);
  const svg = renderPfp(recipe, { size: 1024, nonce: brand.agentId });
  const quality = qualityCheck(recipe, svg);
  assert(quality.ok, brand.agentId + " quality " + quality.reasons.join(","));
  assert(svg.includes('viewBox="0 0 1024 1024"'), brand.agentId + " square");
  assert(!/<text[\s>]|<image[\s>]/.test(svg), brand.agentId + " has no text or embedded image");
  const small = renderPfp(recipe, { size: 48, nonce: "other" });
  const mid = renderPfp(recipe, { size: 96, nonce: brand.agentId });
  eq(pathData(svg), pathData(small), brand.agentId + " 48 reuses the master paths");
  eq(pathData(svg), pathData(mid), brand.agentId + " 96 reuses the master paths");
  assert(small.includes('width="48"') && mid.includes('width="96"'), brand.agentId + " size attributes");
}
eq(AVATAR_SIZES.join(","), "48,96,160,320,512", "derived sizes");

const visual = {
  silhouette: "TALL_SHARP",
  facialAttitude: "SMUG",
  primaryColor: "#6D0F1F",
  secondaryColor: "#111111",
  accentColor: "#E8DDD0",
  emblem: "CROWN",
  backgroundMotif: "CANDLE_VAULT",
  lightingStyle: "DRAMATIC_RIM_LIGHT",
  ornamentationLevel: 0.4,
};
const base = buildRecipe({ name: "Vesper", title: "The Quiet Cipher", archetype: "ASSASSIN", visual, variation: 1, treatment: "standard" });
const louder = buildRecipe({ name: "Vesper", title: "The Quiet Cipher", archetype: "ASSASSIN", visual, variation: 1, treatment: "expression" });
assert(pathData(renderPfp(base)) !== pathData(renderPfp(louder)), "stronger expression changes the drawing");
assert(promptFor(base).includes("square composition"), "prompt shape is recorded");
assert(promptFor(base).includes("No external image model"), "prompt does not claim a photo model");
eq(recipeFromBrand(SEED_BRANDS.find((b) => b.agentId === "dracula")).headwear, "crown", "dracula crown");
eq(recipeFromBrand(SEED_BRANDS.find((b) => b.agentId === "caesar")).headwear, "laurel", "caesar laurel");
eq(recipeFromBrand(SEED_BRANDS.find((b) => b.agentId === "reaper")).headwear, "hood", "reaper hood");

console.log("pfp ok");
