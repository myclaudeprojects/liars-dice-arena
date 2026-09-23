// Brand schema, cast uniqueness, version history, and show boot with brands.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { CAST } = require("../src/characters");
const { Show } = require("../src/showrunner");
const {
  SEED_BRANDS, BrandBook, validateBrand, paletteNear, titlesTooClose,
  BRAND_STATUSES, PERSONALITY_KEYS, MOTION_LANGUAGES,
} = require("../src/brands");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }
function eq(a, b, m) { if (a !== b) throw new Error((m || "eq") + `: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }

assert(CAST.length === 12 && SEED_BRANDS.length === 12, "CAST=12 seed brands");
const byId = Object.fromEntries(SEED_BRANDS.map((b) => [b.agentId, b]));
for (const c of CAST) {
  const brand = byId[c.id];
  assert(brand, "seed for " + c.id);
  eq(brand.name, c.name, "name " + c.id);
  const check = validateBrand(brand);
  assert(check.ok, c.id + " schema " + check.errors.join(","));
  assert(brand.brandVersion === "v1", "v1 " + c.id);
  assert(fs.existsSync(path.join(__dirname, "..", "public", "emblems", c.id + ".svg")), "emblem file " + c.id);
  assert(brand.assets.emblem === "/static/emblems/" + c.id + ".svg", "emblem ref " + c.id);
  assert(brand.generation.status === "READY", "ready " + c.id);
  assert(BRAND_STATUSES.includes(brand.generation.status), "status enum");
  for (const key of PERSONALITY_KEYS) {
    const n = brand.personality[key];
    assert(n >= 0 && n <= 1, key + " " + c.id);
  }
  assert(MOTION_LANGUAGES[brand.visualIdentity.motionLanguage], "motion " + c.id);
}

eq(byId.dracula.title, "The Gambler", "dracula title");
eq(byId.dracula.visualIdentity.emblem, "BAT_CROWN", "dracula emblem");
eq(byId.dracula.visualIdentity.primaryColor, "#6D0F1F", "dracula primary");
eq(byId.caesar.title, "The Strategist", "caesar title");
eq(byId.caesar.visualIdentity.emblem, "LAUREL_SPEAR", "caesar emblem");
eq(byId.reaper.title, "The Chaos Agent", "reaper title");
eq(byId.reaper.visualIdentity.emblem, "BROKEN_HOURGLASS", "reaper emblem");
eq(byId.reaper.visualIdentity.accentColor, "#B15CFF", "reaper accent");

const titles = SEED_BRANDS.map((b) => b.title);
eq(new Set(titles).size, titles.length, "titles are unique");
const emblems = SEED_BRANDS.map((b) => b.visualIdentity.emblem);
eq(new Set(emblems).size, emblems.length, "emblems are unique");
for (let i = 0; i < SEED_BRANDS.length; i++) {
  for (let j = i + 1; j < SEED_BRANDS.length; j++) {
    const a = SEED_BRANDS[i];
    const b = SEED_BRANDS[j];
    assert(!titlesTooClose(a.title, b.title), `titles collide ${a.title} / ${b.title}`);
    assert(!paletteNear(a, b), `palette collides ${a.agentId} / ${b.agentId}`);
  }
}

const book = new BrandBook();
eq(book.activeVersion("dracula"), "v1", "active v1");
const prior = book.full("dracula", "v1");
const next = book.rebrand("dracula", { title: "The Count", tagline: "A later night still answers to the same house." });
eq(next.brandVersion, "v2", "rebrand appends");
eq(book.activeVersion("dracula"), "v2", "active moves");
eq(book.full("dracula", "v1").title, "The Gambler", "v1 title stays");
eq(book.full("dracula", "v1").visualIdentity.primaryColor, prior.visualIdentity.primaryColor, "v1 palette stays");
assert(book.versions("dracula").length === 2, "two versions");
let collided = false;
try { book.appendVersion(book.full("dracula", "v1")); }
catch (e) { collided = e.code === "brand_version_exists"; }
assert(collided, "version history is not overwritten");
const sim = book.similarity(book.full("athena"));
assert(sim.portraitSimilarity == null && sim.embeddings === "deferred", "embeddings stay deferred");
assert(typeof sim.overallSimilarity === "number" && sim.closestAgentId, "local similarity still reports");

const file = path.join(os.tmpdir(), `lda-brands-${process.pid}.json`);
try { fs.unlinkSync(file); } catch { /* fresh */ }
const show = new Show({
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
show.openNext({ queue: false });
assert(show.current.seats.every((s) => s.brandVersion === "v1"), "match freezes brand version");
const snap = show.snapshot();
assert(snap.brands && Object.keys(snap.brands).length === 12, "snapshot brand map");
assert(snap.live.seats.every((s) => s.brand && s.brand.emblemUrl), "public match brand");
const listed = show.agentList();
eq(listed.length, 12, "agent list");
assert(listed.every((a) => a.brand && a.brand.title && a.brand.tagline), "list brand");
const detail = show.agentDetail("caesar");
eq(detail.brand.title, "The Strategist", "detail public brand");
eq(detail.brandRecord.visualIdentity.motionLanguage, "SLOW_REGAL", "detail keeps the full record");
eq(show.brandView("reaper").archetype, "SPECTRAL_WILDCARD", "brand route document");
show.brands.rebrand("caesar", { title: "The Consul", tagline: "The second reign keeps the first on record." });
show.persist();
const again = new Show({
  dataPath: file,
  sleep: async () => {},
  loopEnabled: false,
  bootstrapCount: 0,
  marketsEnabled: false,
});
eq(again.brands.activeVersion("caesar"), "v2", "disk restores the active version");
eq(again.brands.full("caesar", "v1").title, "The Strategist", "disk keeps v1");
eq(again.brands.full("dracula", "v1").title, "The Gambler", "other agents stay on the seed");
assert(again.snapshot().live == null || again.snapshot().brands.caesar.title === "The Consul", "restored book");
eq(again.brands.publicOf("caesar").title, "The Consul", "public brand follows the active version");

console.log("brands ok");
