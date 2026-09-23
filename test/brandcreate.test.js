// Create → concepts → select, then the agent survives a reload and can be seated.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { CAST } = require("../src/characters");
const { Show } = require("../src/showrunner");
const { paletteNear, titlesTooClose, wordCount, brandSimilarity, SEED_BRANDS } = require("../src/brands");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }
function eq(a, b, m) { if (a !== b) throw new Error((m || "eq") + `: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }

const INPUT = {
  name: "Vesper",
  shortDescription: "A quiet closer who spends one lie and waits.",
  archetype: "ASSASSIN",
  aggression: 0.42,
  bluffing: 0.66,
  discipline: 0.81,
  chaos: 0.18,
  visualDirection: "cold steel, moonlit",
};

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

function signatures(concepts) {
  return concepts.map((c) => [c.title, c.emblem, c.visualIdentity.primaryColor, c.visualIdentity.silhouette].join("|")).join("\n");
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lda-create-"));
  const fileA = path.join(dir, "a.json");
  const fileB = path.join(dir, "b.json");
  const showA = boot(fileA);
  const showB = boot(fileB);
  const a = showA.createAgent(INPUT);
  const b = showB.createAgent(INPUT);
  eq(a.identity.title, b.identity.title, "identity is deterministic");
  eq(a.identity.visualIdentity.emblem, b.identity.visualIdentity.emblem, "visual DNA is deterministic");
  assert(wordCount(a.identity.tagline) >= 4 && wordCount(a.identity.tagline) <= 14, "tagline length");
  const conceptsA = showA.generateConcepts(a.agent.id, { count: 4 });
  const conceptsB = showB.generateConcepts(b.agent.id, { count: 4 });
  eq(conceptsA.concepts.length, 4, "four concepts");
  eq(signatures(conceptsA.concepts), signatures(conceptsB.concepts), "concepts are seeded");
  const emblems = new Set(conceptsA.concepts.map((c) => c.emblem));
  eq(emblems.size, conceptsA.concepts.length, "concepts use different emblems");
  const titles = conceptsA.concepts.map((c) => c.title);
  eq(new Set(titles).size, titles.length, "concepts use different titles");
  for (const concept of conceptsA.concepts) {
    assert(concept.emblemSvg.includes("<svg"), "svg emblem");
    assert(concept.assetType === "PFP_PORTRAIT", "concept is a pfp");
    assert(concept.pfpSvg.includes('viewBox="0 0 1024 1024"'), "square pfp");
    assert(!/<text[\s>]/.test(concept.pfpSvg), "portrait has no baked text");
    assert(concept.pfp && concept.pfp.quality && concept.pfp.quality.ok, "portrait passes the quality filter");
    assert(!SEED_BRANDS.some((seed) => titlesTooClose(seed.title, concept.title)), "title misses the house");
    assert(!SEED_BRANDS.some((seed) => seed.visualIdentity.emblem === concept.emblem), "emblem misses the house");
    assert(!SEED_BRANDS.some((seed) => paletteNear(seed, { visualIdentity: concept.visualIdentity })), "palette misses the house");
    for (const other of conceptsA.concepts) {
      if (other.id === concept.id) continue;
      assert(!paletteNear({ visualIdentity: concept.visualIdentity }, { visualIdentity: other.visualIdentity }), "concepts do not share a triad");
    }
  }
  const again = showA.generateConcepts(a.agent.id, { count: 4, vary: "all" });
  assert(signatures(again.concepts) !== signatures(conceptsA.concepts), "regenerate changes the set");

  let collided = false;
  try { showA.createAgent({ ...INPUT, name: "Dracula" }); }
  catch (e) { collided = e.code === "name_collision"; }
  assert(collided, "house names are rejected");

  const picked = again.concepts[1];
  const locked = showA.selectConcept(a.agent.id, picked.id);
  eq(locked.brand.brandVersion, "v1", "v1");
  eq(locked.brand.generation.status, "READY", "ready");
  eq(locked.brand.title, picked.title, "selected title is canonical");
  eq(locked.brand.assets.emblem, "/api/show/agents/" + a.agent.id + "/emblem.svg", "emblem url");
  eq(locked.brand.primaryPfpAssetId, "pfp_" + a.agent.id + "_" + picked.id, "canonical pfp id");
  eq(locked.brand.pfpStyleVersion, "lda-pfp-v2", "pfp style version");
  eq(locked.brand.selectedConceptId, picked.id, "select locks the concept");
  assert(brandSimilarity(locked.brand, locked.brand) >= 0.75, "a brand matches itself");
  assert(brandSimilarity(locked.brand, SEED_BRANDS[0]) < 0.75, "locked brand stays off the house");
  eq(locked.brand.assets.pfpPortrait, "/api/show/agents/" + a.agent.id + "/pfp.svg", "pfp url");
  eq(locked.brand.assets.avatar48, "/api/show/agents/" + a.agent.id + "/pfp.svg?size=48", "48 derived");
  eq(locked.brand.assets.avatar96, "/api/show/agents/" + a.agent.id + "/pfp.svg?size=96", "96 derived");
  eq(locked.brand.assets.heroPortrait, null, "hero art stays deferred");
  assert(locked.brand.avatarCrop.method === "uniform-scale", "avatars scale the master");
  const { pathData, renderPfp } = require("../src/pfp");
  const served = showA.pfpSvgFor(a.agent.id, 48);
  const master = showA.pfpSvgFor(a.agent.id, 512);
  eq(pathData(served), pathData(master), "48 and 512 share the face");
  eq(pathData(served), pathData(renderPfp(locked.brand.pfpRecipe, { size: 48, nonce: "x" })), "served portrait is the locked recipe");
  const touched = showB.generateConcepts(b.agent.id, { vary: "expression" });
  eq(touched.concepts[0].title, conceptsB.concepts[0].title, "expression keeps the identity");
  assert(pathData(touched.concepts[0].pfpSvg) !== pathData(conceptsB.concepts[0].pfpSvg), "expression changes the face");
  assert(locked.seated, "guest enters the slate");
  assert(showA.upcoming.some((m) => m.seats.some((s) => s.id === a.agent.id)), "upcoming card");
  assert(showA.agentList().some((row) => row.id === a.agent.id && row.roster === "user" && row.brand.title === picked.title), "list");
  eq(showA.agentList().filter((row) => row.roster === "house").length, 12, "house list");
  eq(CAST.length, 12, "cast constant");
  assert(showA.snapshot().brands[a.agent.id].title === picked.title, "snapshot publishes the user brand");
  assert(Object.keys(showA.snapshot().brands).filter((id) => CAST.some((c) => c.id === id)).length === 12, "house brands stay");

  const guestCard = showA.upcoming.find((m) => m.seats.some((s) => s.id === a.agent.id));
  showA.current = guestCard;
  showA.current.phase = "pick";
  showA.upcoming = showA.upcoming.filter((m) => m !== guestCard);
  const archived = await showA.playOpen();
  assert(archived.seats.some((s) => s.id === a.agent.id), "played from a seat");
  assert(archived.winnerId, "someone won");
  eq(showA.records.get(a.agent.id).played, 1, "record sticks");
  const view = showA.integrity.publicView(archived.matchId);
  eq(view.integrityStatus, "VALID", "user agent still verifies");

  const reloaded = boot(fileA);
  eq(reloaded.brands.full(a.agent.id).title, picked.title, "brand reloads");
  eq(reloaded.brands.full(a.agent.id, "v1").generation.status, "READY", "v1 stays ready");
  eq(reloaded.userAgents.get(a.agent.id).status, "READY", "roster reloads");
  eq(reloaded.records.get(a.agent.id).played, 1, "record reloads");
  eq(reloaded.brands.full("dracula").title, "The Gambler", "house brand untouched");
  assert(reloaded.agentList().some((row) => row.id === a.agent.id), "list reloads");

  const app = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  assert(app.includes("Create agent"), "agents tab labels the action");
  assert(app.includes("data-create-agent"), "empty and list states can open the wizard");
  assert(app.includes("/api/show/agents/brand/create"), "wizard calls create");
  assert(app.includes("/brand/pfp-concepts"), "wizard calls pfp concepts");
  assert(app.includes("/brand/pfp-select"), "wizard calls pfp select");
  assert(app.includes("Regenerate all"), "wizard can regenerate portraits");
  assert(app.includes("pfp-frame"), "wizard shows square portraits");
  assert(app.includes("agent-reveal"), "lock ends on a reveal");
  assert(app.includes("Advanced / Developer Options"), "developer options stay collapsed");
  assert(app.includes("hero-match-card"), "arena leads with a match card");
  assert(app.includes("cast-board"), "profile carries a cast board");

  console.log("brandcreate ok");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
