// Neon Noir procedural busts are not the live portrait. A missing file is a letter.
const { SEED_BRANDS, BrandBook } = require("../src/brands");
const { recipeFromBrand, renderPfp, PFP_STYLE_STAMP, withBrandVersion } = require("../src/pfp");
const ui = require("../public/ui.js");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }
function eq(a, b, m) { if (a !== b) throw new Error((m || "eq") + `: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }

eq(PFP_STYLE_STAMP, 5, "style stamp bumped past the noir svg");
eq(withBrandVersion("/api/show/agents/fox/pfp.svg?v=1&s=4", { version: 1 }), "/api/show/agents/fox/pfp.svg?v=1&s=5", "stored stamp is rewritten");

const book = new BrandBook();
for (const id of ["fox", "brutus", "dracula"]) {
  const view = book.publicOf(id);
  assert(!view.pfpUrl, id + " has no portrait url until an image exists");
  assert(!view.avatarSizes, id + " has no avatar urls until an image exists");
  assert(!view.animatedPfp, id + " does not advertise a procedural rig");
  let retired = false;
  try { renderPfp(recipeFromBrand(SEED_BRANDS.find((row) => row.agentId === id))); }
  catch (err) { retired = err.code === "pfp_procedural_retired"; }
  assert(retired, id + " does not draw a noir bust");
}

const letter = ui.avatar("The Fox", 40, "fox", {});
assert(letter.includes("lda-avatar-glyph") && !letter.includes("<img"), "letter fallback when there is no portrait");
const img = ui.avatar("The Fox", 40, "fox", { src: "/api/show/agents/fox/pfp.svg?v=1&s=5", size: 96 });
assert(img.includes("<img") && img.includes("s=5") && !img.includes("lda-avatar-glyph"), "a real portrait url still mounts");

console.log("neon noir retired ok");
