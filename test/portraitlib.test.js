// Generated-portrait library: matching, concept images, locked brands, house cast, previews, migration.
const fs = require("fs"), os = require("os"), path = require("path");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lda-lib-"));
// fixture library: 12 bank portraits over a few archetypes/palettes + 2 house candidates for dracula
const lib = path.join(dir, "lib"); fs.mkdirSync(lib);
const entries = [];
const mk = (id, tags, house) => { fs.writeFileSync(path.join(lib, id + ".webp"), "RIFF"); entries.push({ id, file: id + ".webp", tags, house: house || null }); };
let n = 0;
for (const archetype of ["executive", "street", "robot_ai", "celebrity"]) for (const colorPalette of ["red", "cyan", "purple"]) mk(`bank_${String(n++).padStart(4, "0")}`, { archetype, colorPalette, bodyType: archetype === "robot_ai" ? "full_robot" : "male_lean", background: "city_night", attire: "formal", expression: "confident", accessories: "none", skin: "tan skin", hair: "slicked back hair" });
mk("dracula_1", { archetype: "gambler", colorPalette: "red" }, "dracula"); mk("dracula_2", { archetype: "gambler", colorPalette: "red" }, "dracula");
fs.writeFileSync(path.join(lib, "manifest.json"), JSON.stringify({ entries }));
process.env.PORTRAIT_LIB = path.join(lib, "manifest.json");

const { Show } = require("../src/showrunner");
const portraitLib = require("../src/portraitlib");
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };

(async () => {
  eq(portraitLib.size(), 14, "fixture library loaded");
  const m = portraitLib.match({ archetype: "street", colorPalette: "purple", bodyType: "male_lean" }, { count: 4, seed: "x" });
  eq(m[0].tags.archetype, "street", "best match shares the archetype"); eq(m[0].tags.colorPalette, "purple", "…and the palette");
  eq(new Set(m.map((e) => e.id)).size, 4, "four distinct picks"); assert(m.every((e) => !e.house), "house portraits never offered as concepts");

  const show = new Show({ dataPath: path.join(dir, "show.json"), sleep: async () => {}, pickWindowMs: 0, turnDelayMs: 0, revealDelayMs: 0, settleHoldMs: 0, bootstrapCount: 0, loopEnabled: false, marketsEnabled: true });
  const a = show.createAgent({ name: "Neon Nate", shortDescription: "Shines under the neon and never blinks first.", archetype: "COMMANDER", aggression: .5, bluffing: .5, discipline: .6, chaos: .3, creationSelections: { archetype: "street", bodyType: "male_lean", expression: "cocky", attire: "streetwear", colorPalette: "purple", background: "neon_alley", accessories: "hat_cap" } });
  const round = show.generateConcepts(a.agent.id, { count: 4 });
  assert(round.concepts.every((c) => c.pfpUrl && c.portrait), "every concept carries a library image");
  eq(new Set(round.concepts.map((c) => c.portrait.id)).size, 4, "concept images are distinct");
  assert(round.concepts[0].pfpUrl.startsWith("/assets/portraits/"), "image url points at the library");
  const locked = show.selectConcept(a.agent.id, round.concepts[1].id);
  eq(locked.brand.portrait.id, round.concepts[1].portrait.id, "locked brand keeps the chosen image");
  assert(/^\/assets\/portraits\/bank_\d+\.webp\?v=1&s=\d+$/.test(locked.brand.assets.canonicalPfp), "canonical asset is the stamped image url: " + locked.brand.assets.canonicalPfp);
  const view = show.brands.publicOf(a.agent.id);
  eq(view.pfpUrl, locked.brand.assets.canonicalPfp, "public view serves the image"); eq(view.avatarSizes[96], view.pfpUrl, "all sizes use the image");
  eq(show.portraitImageFor(a.agent.id), view.pfpUrl, "pfp.svg route redirects to the image");

  // regenerate: a new round avoids the faces already shown
  const round2 = show.generateConcepts(a.agent.id, { count: 4, regenerate: true });
  const first = new Set(round.concepts.map((c) => c.portrait.id));
  assert(round2.concepts.some((c) => !first.has(c.portrait.id)), "regenerate offers new faces");

  // house cast uses its generated portrait
  const drac = show.brands.publicOf("dracula");
  assert(drac.pfpUrl.includes("/assets/portraits/dracula_1.webp"), "house cast gets its library portrait: " + drac.pfpUrl);
  process.env.HOUSE_PORTRAITS = "dracula=2"; eq(portraitLib.houseEntry("dracula").id, "dracula_2", "house pick override"); delete process.env.HOUSE_PORTRAITS;
  const caesar = show.brands.publicOf("caesar"); assert(caesar.pfpUrl.includes("/pfp.svg"), "house member without a generated portrait keeps the rig");

  // migration: a legacy brand without an image gets one
  for (const row of show.brands._versions.values()) if (row.agentId === a.agent.id) { delete row.portrait; }
  eq(show.legacyPortraitAgents().includes(a.agent.id), true, "brand without image is a migration candidate");
  const res = await show.migrateLegacyPortraits(true);
  assert(res.migrated >= 1, "migration ran"); assert(show.brands.full(a.agent.id).portrait, "migrated brand has an image");
  console.log("portrait library ok");
})().catch((e) => { console.error(e); process.exit(1); });
