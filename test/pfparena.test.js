// Felt-roster portraits: house seats stay distinct, branded, and circle-readable.
const { SEED_BRANDS } = require("../src/brands");
const { recipeFromBrand, renderPfp, qualityCheck, pathData, buildRecipe } = require("../src/pfp");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }
function eq(a, b, m) { if (a !== b) throw new Error((m || "eq") + `: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }

const byId = Object.fromEntries(SEED_BRANDS.map((b) => [b.agentId, b]));
const faces = new Set();
for (const id of ["fox", "brutus", "dracula", "caesar", "reaper", "athena", "shark", "oracle", "monk", "siren", "miser", "jester"]) {
  const brand = byId[id];
  const recipe = recipeFromBrand(brand);
  eq(recipe.colors.accent.toUpperCase(), brand.visualIdentity.accentColor.toUpperCase(), id + " keeps its brand accent");
  eq(recipe.attitude, brand.visualIdentity.facialAttitude, id + " keeps its expression");
  const svg = renderPfp(recipe, { size: 1024, nonce: id });
  const quality = qualityCheck(recipe, svg);
  assert(quality.ok, id + " quality " + quality.reasons.join(","));
  assert(svg.includes('data-rig="arena"'), id + " arena rig");
  assert(svg.includes(`data-cast="${id}"`), id + " cast id");
  assert(svg.includes('data-layer="eyesClosed"') && /data-layer="eyesClosed"[^>]*opacity="0"/.test(svg), id + " blink pose");
  assert(!/<text[\s>]|<image[\s>]/.test(svg), id + " no text");
  faces.add(pathData(svg));
  const small = renderPfp(recipe, { size: 96, nonce: id });
  eq(pathData(svg), pathData(small), id + " 96 shares the master paths");
}
eq(faces.size, 12, "twelve distinct house portraits");

const fox = renderPfp(recipeFromBrand(byId.fox), { size: 512, nonce: "fox" });
assert(fox.includes("#F6C453") || fox.toLowerCase().includes("#f6c453"), "fox gold reads in the drawing");
const brutus = renderPfp(recipeFromBrand(byId.brutus), { size: 512, nonce: "brutus" });
assert(brutus.includes("#F0A07A") || brutus.toLowerCase().includes("#f0a07a"), "brutus rust reads in the drawing");
const dracula = renderPfp(recipeFromBrand(byId.dracula), { size: 512, nonce: "dracula" });
assert(dracula.includes("#F43B5F") || dracula.toLowerCase().includes("#f43b5f"), "dracula crimson reads in the drawing");
assert(pathData(fox) !== pathData(brutus) && pathData(brutus) !== pathData(dracula), "fox, brutus, and dracula are not the same bust");

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
assert(pathData(renderPfp(base)) !== pathData(renderPfp(louder)), "expression still changes the arena drawing");

console.log("arena pfp ok");
