// Neon Noir procedural busts are not the live portrait. A missing agent is a letter.
const { SEED_BRANDS, BrandBook } = require("../src/brands");
const { recipeFromBrand, renderPfp, PFP_STYLE_STAMP, withBrandVersion } = require("../src/pfp");
const ui = require("../public/ui.js");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }
function eq(a, b, m) { if (a !== b) throw new Error((m || "eq") + `: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }

eq(PFP_STYLE_STAMP, 6, "style stamp bumped past the noir svg");
eq(withBrandVersion("/api/show/agents/fox/pfp.svg?v=1&s=4", { version: 1 }), "/api/show/agents/fox/pfp.svg?v=1&s=6", "stored stamp is rewritten");

const book = new BrandBook();
for (const id of ["fox", "brutus", "dracula"]) {
  const view = book.publicOf(id);
  assert(view.pfpUrl && view.pfpUrl.includes("s=6"), id + " portrait url needs no image key");
  assert(view.avatarSizes && view.avatarSizes[96].includes("s=6"), id + " avatar urls are stamped");
  assert(view.animatedPfp && view.animatedPfp.enabled === false && view.animatedPfp.engine === "neon-competitive", id + " stays a static poster");
  let retired = false;
  try { renderPfp(recipeFromBrand(SEED_BRANDS.find((row) => row.agentId === id))); }
  catch (err) { retired = err.code === "pfp_procedural_retired"; }
  assert(retired, id + " does not draw a noir bust");
}

const letter = ui.avatar("The Fox", 40, "fox", {});
assert(letter.includes("lda-avatar-glyph") && !letter.includes("<img"), "letter fallback when there is no portrait");
const img = ui.avatar("The Fox", 40, "fox", { src: "/api/show/agents/fox/pfp.svg?v=1&s=6", size: 96 });
assert(img.includes("<img") && img.includes("s=6") && !img.includes("lda-avatar-glyph"), "a real portrait url still mounts");

console.log("neon noir retired ok");
