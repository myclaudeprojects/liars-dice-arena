// Neon competitive style lock: preset, visual DNA defaults, prompt, public view.
const { PFP_STYLE_PRESETS, PFP_STYLE_ID } = require("../src/branding/stylePresets");
const { buildPfpPrompt } = require("../src/branding/buildPfpPrompt");
const { buildVisualDNA } = require("../src/branding/buildVisualDNA");
const { SEED_BRANDS, BrandBook } = require("../src/brands");
const { recipeFromBrand } = require("../src/pfp");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }
function eq(a, b, m) { if (a !== b) throw new Error((m || "eq") + `: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }

eq(PFP_STYLE_ID, "neon-competitive", "locked style id");
const preset = PFP_STYLE_PRESETS["neon-competitive"];
eq(preset.version, "v1", "style version");
eq(preset.displayName, "Neon Competitive", "display name");
assert(preset.description.includes("Premium modern competitive portrait"), "description");
assert(preset.composition.includes("Exact 1:1 square"), "composition");
assert(preset.negatives.includes("fantasy armor"), "negatives");
assert(preset.negatives.includes("cyberpunk overload"), "cyberpunk negative");

const executive = buildVisualDNA({ archetype: "executive" });
eq(executive.accentColor, "#F43B5F", "executive crimson");
eq(executive.backgroundMotif, "city_signal_grid", "executive grid");
eq(executive.lightingStyle, "crimson_neon_edge", "executive rim");
const street = buildVisualDNA({ archetype: "street" });
eq(street.accentColor, "#4AD7FF", "street cyan");
eq(street.lightingStyle, "cyan_neon_edge", "street edge");
const antihero = buildVisualDNA({ archetype: "antihero" });
eq(antihero.accentColor, "#8D63FF", "antihero violet");
eq(antihero.lightingStyle, "violet_neon_glow", "antihero glow");
const cool = buildVisualDNA({ archetype: "ORACLE" });
eq(cool.accentColor, "#4AD7FF", "default cyan");
eq(cool.lightingStyle, "cool_neon_edge", "default edge");

const byId = Object.fromEntries(SEED_BRANDS.map((b) => [b.agentId, b]));
eq(byId.dracula.visualIdentity.accentColor, "#F43B5F", "house dracula accent");
eq(byId.dracula.visualIdentity.lightingStyle, "CRIMSON_NEON_RIM", "house dracula light");
eq(byId.caesar.visualIdentity.accentColor, "#FFC247", "house caesar accent");
eq(byId.caesar.visualIdentity.primaryColor, "#101216", "house caesar primary");
eq(byId.reaper.visualIdentity.accentColor, "#B15CFF", "house reaper accent");
eq(byId.reaper.visualIdentity.lightingStyle, "VIOLET_NEON_GLOW", "house reaper light");
eq(recipeFromBrand(byId.dracula).styleId, "neon-competitive", "recipe style");

const prompt = buildPfpPrompt({
  styleId: "neon-competitive",
  agent: { name: "Dracula", title: "The Gambler", archetype: "executive", brand: { visualDNA: executive } },
});
assert(prompt.includes("Name: Dracula"), "prompt names the agent");
assert(prompt.includes("#F43B5F"), "prompt carries the accent");
assert(prompt.includes("fantasy armor"), "prompt lists negatives");

const book = new BrandBook();
const view = book.publicOf("dracula");
eq(view.pfpStyleId, "neon-competitive", "public style id");
assert(view.pfpUrl && view.pfpUrl.includes("/api/show/agents/dracula/pfp.svg") && view.pfpUrl.includes("s=6"), "house portrait url is local");
assert(view.animatedPfp && view.animatedPfp.enabled === false, "poster motion stays off");
assert(!book.full("dracula").animatedPfp, "animation stays off the stored brand");

console.log("neon style ok");
