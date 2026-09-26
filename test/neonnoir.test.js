// Neon Noir portraits are one drawing. The previous rig painted a geometric
// face and then stroked that same outline in neon (a wireframe / visor seam).
const { SEED_BRANDS, BrandBook } = require("../src/brands");
const { recipeFromBrand, renderPfp, PFP_STYLE_STAMP, withBrandVersion } = require("../src/pfp");
const ui = require("../public/ui.js");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }
function eq(a, b, m) { if (a !== b) throw new Error((m || "eq") + `: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }

const LIGHT_SKIN = ["#D2B08C", "#F0CDB4", "#F6E7DE", "#E4DEEA", "#A56B45", "#F0C2A4", "#E6E9EE", "#D7A07C"];
const byId = Object.fromEntries(SEED_BRANDS.map((b) => [b.agentId, b]));

function rim(svg) {
  const m = String(svg).match(/<g data-layer="rimGlow"[^>]*>[\s\S]*?<\/g>/);
  return m ? m[0] : "";
}

function assertNoir(id, accent) {
  const brand = byId[id];
  const recipe = recipeFromBrand(brand);
  eq(recipe.colors.accent.toUpperCase(), accent, id + " keeps its brand accent");
  eq(recipe.colors.trim.toUpperCase(), accent, id + " neon trim is the brand accent");
  const svg = renderPfp(recipe, { size: 512, nonce: id });
  assert(svg.includes('data-rig="v3"'), id + " rig v3");
  assert(svg.includes('data-pfp-style="neon-competitive"'), id + " neon-competitive");
  assert(svg.includes('data-portrait="neon-noir"'), id + " neon noir portrait");
  assert(svg.includes('data-composite="pure"'), id + " pure composite");
  assert(svg.includes('data-legacy-overlay="0"'), id + " no legacy overlay flag");
  assert(svg.includes('data-face-fill="noir"'), id + " noir face");
  assert(svg.includes('data-layered="1"'), id + " animation layers stay");
  assert(svg.includes(accent), id + " accent is in the drawing");
  assert(!svg.includes("#4AD7FF"), id + " is not the default cyan wireframe");
  for (const skin of LIGHT_SKIN) assert(!svg.toUpperCase().includes(skin), id + " does not paint legacy skin " + skin);
  const edge = rim(svg);
  assert(edge.includes('data-layer="rimGlow"'), id + " has a rim light");
  assert(!edge.includes("clip-path"), id + " rim is not a clipped face copy");
  assert(!edge.includes("translate("), id + " rim is not shifted across the face");
  assert(!/stroke-width="(?:1[2-9]|[2-9][0-9])/.test(edge), id + " rim is not a wide wireframe");
  assert(!/\sZ"/.test(edge), id + " rim is an open edge, not a closed face contour");
  const book = new BrandBook();
  const view = book.publicOf(id);
  assert(/[?&]s=6(?:&|$)/.test(view.pfpUrl), id + " portrait url busts the old stamp");
  assert(/[?&]s=6(?:&|$)/.test(view.avatarSizes[96]), id + " avatar url busts the old stamp");
}

eq(PFP_STYLE_STAMP, 6, "style stamp bumped");
eq(withBrandVersion("/api/show/agents/fox/pfp.svg?v=1&s=3", { version: 1 }), "/api/show/agents/fox/pfp.svg?v=1&s=6", "stored stamp is rewritten");

assertNoir("fox", "#F6C453");
assertNoir("brutus", "#F0A07A");
assertNoir("dracula", "#F43B5F");

const fox = renderPfp(recipeFromBrand(byId.fox), { nonce: "fox" });
const brutus = renderPfp(recipeFromBrand(byId.brutus), { nonce: "brutus" });
assert(fox !== brutus, "fox and brutus are different portraits");

const robot = renderPfp(recipeFromBrand({
  agentId: "unit",
  name: "Unit",
  archetype: "MACHINE",
  visualIdentity: { accentColor: "#4AD7FF", primaryColor: "#101216", secondaryColor: "#0E1016", facialAttitude: "COLD", silhouette: "MECHANICAL" },
}), { nonce: "unit" });
assert(robot.includes('data-face-fill="synthetic"'), "synthetic heads stay synthetic");
assert(robot.includes('data-portrait="neon-noir"'), "synthetic heads are still neon noir");
assert(!rim(robot).includes("clip-path"), "synthetic rim is not a face overlay");

const letter = ui.avatar("The Fox", 40, "fox", {});
assert(letter.includes("lda-avatar-glyph") && !letter.includes("<img"), "letter fallback when there is no portrait");
const img = ui.avatar("The Fox", 40, "fox", { src: "/api/show/agents/fox/pfp.svg?v=1&s=6", size: 96 });
assert(img.includes("<img") && img.includes("s=6") && !img.includes("lda-avatar-glyph"), "stamped portrait still mounts");

process.env.PFP_RIG = "v2";
const legacy = renderPfp(recipeFromBrand(byId.fox), { nonce: "fox-v2" });
delete process.env.PFP_RIG;
assert(!legacy.includes('data-portrait="neon-noir"'), "v2 rig stays behind the env flag");
assert(legacy.includes('data-style="lda-pfp-v2"'), "v2 still identifies the old drawing");

console.log("neon noir ok");
