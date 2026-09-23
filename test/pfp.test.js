// Procedural PFP portraits: square, one face, avatar sizes share the drawing.
const { SEED_BRANDS } = require("../src/brands");
const {
  AVATAR_SIZES, PFP_STYLE_VERSION, buildRecipe, recipeFromBrand, renderPfp, qualityCheck,
  pathData, promptFor, measureFaceScale, validatePfpMetadata, compositionScale,
} = require("../src/pfp");
const { ProceduralSvgProvider, ImageProvider } = require("../src/imageprovider");

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
  const card = renderPfp(recipe, { size: 256, nonce: brand.agentId });
  eq(pathData(svg), pathData(small), brand.agentId + " 48 reuses the master paths");
  eq(pathData(svg), pathData(mid), brand.agentId + " 96 reuses the master paths");
  eq(pathData(svg), pathData(card), brand.agentId + " 256 reuses the master paths");
  assert(small.includes('width="48"') && mid.includes('width="96"'), brand.agentId + " size attributes");
  const measured = measureFaceScale(svg);
  assert(measured.characterHeight >= 0.65 && measured.characterHeight <= 0.82, brand.agentId + " head and torso scale");
  assert(measured.faceHeight >= 0.45, brand.agentId + " face scale");
  assert(svg.includes('data-style="lda-pfp-v2"'), brand.agentId + " v2 style");
  assert(recipe.signature, brand.agentId + " signature silhouette");
}
eq(AVATAR_SIZES.join(","), "48,96,160,256,320,512", "derived sizes");
const scale = compositionScale();
assert(scale.characterHeight >= 0.65 && scale.characterHeight <= 0.82, "composition band");
const meta = validatePfpMetadata({ width: 1024, height: 1024, fileSize: 4000 });
assert(meta.ok, "square metadata");
assert(!validatePfpMetadata({ width: 800, height: 600 }).ok, "rejects a landscape");

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
assert(promptFor(base).includes("lda-pfp-v2"), "prompt names the house style");
eq(PFP_STYLE_VERSION, "lda-pfp-v2", "style version");
const provider = new ProceduralSvgProvider();
const drawn = provider.renderSync({ recipe: base, size: 48, nonce: "prov" });
eq(pathData(drawn), pathData(renderPfp(base, { size: 512, nonce: "prov" })), "provider reuses master paths");
provider.generate({ recipe: base, prompt: "test" }).then((image) => {
  assert(image.mime === "image/svg+xml" && image.width === image.height, "provider returns a square svg");
  assert(image.provider === "procedural-svg", "only the procedural backend is live");
  let threw = false;
  const bare = new ImageProvider();
  bare.generate({}).catch(() => { threw = true; }).then(() => {
    assert(threw, "base provider stays abstract");
    console.log("pfp ok");
  });
});
eq(recipeFromBrand(SEED_BRANDS.find((b) => b.agentId === "dracula")).headwear, "crown", "dracula crown");
eq(recipeFromBrand(SEED_BRANDS.find((b) => b.agentId === "caesar")).headwear, "laurel", "caesar laurel");
eq(recipeFromBrand(SEED_BRANDS.find((b) => b.agentId === "reaper")).headwear, "hood", "reaper hood");
