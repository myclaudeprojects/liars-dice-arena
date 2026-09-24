// brands.js — Versioned agent brands. Structured identity, not a portrait file.
//
// Seed v1 covers the CAST=12 house characters. A rebrand appends v2, v3, …
// and never replaces an earlier version, so a settled match can still render
// the brand that was active when it was played.
//
// Emblems are monochrome SVG marks. PFP portraits are procedural squares
// (src/pfp.js), derived into avatar sizes. Hero cards stay pending.
// Similarity embeddings are not computed; palette and title checks are local.

const { CAST } = require("./characters");
const { assetUrls, PFP_STYLE_VERSION, PFP_STYLE_ID, ASSET_TYPE, withBrandVersion } = require("./pfp");
const { inferSelectionsFromBrand } = require("./branding/creationSelections");
const { animatedPfpMeta } = require("./motionprofiles");

const HOUSE_STYLE_VERSION = "lda-house-v1";
const PROMPT_VERSION = "agent-brand-prompt-v1";
const SEED_STAMP = "2026-09-23T00:00:00.000Z";

const BRAND_STATUSES = Object.freeze([
  "DRAFT",
  "GENERATING_IDENTITY",
  "GENERATING_CONCEPTS",
  "AWAITING_SELECTION",
  "GENERATING_FINAL_ASSETS",
  "READY",
  "FAILED",
  "REQUIRES_REVIEW",
]);

const PERSONALITY_KEYS = Object.freeze([
  "aggression", "bluffing", "discipline", "chaos", "confidence",
  "patience", "showmanship", "calculation", "riskTolerance", "adaptability",
]);

const VISUAL_KEYS = Object.freeze([
  "silhouette", "bodyLanguage", "facialAttitude",
  "primaryColor", "secondaryColor", "accentColor",
  "emblem", "materialLanguage", "backgroundMotif", "lightingStyle",
  "ornamentationLevel", "geometryLanguage", "motionLanguage",
]);

const ASSET_KEYS = Object.freeze([
  "heroPortrait", "avatar", "emblem", "introCard", "victoryCard", "defeatCard", "shareTemplate",
]);

const MOTION_LANGUAGES = Object.freeze({
  FAST_CONFIDENT: { pause: "short", transition: "sharp", reaction: "fast" },
  SLOW_REGAL: { pause: "measured", transition: "slow", reaction: "controlled" },
  CHAOTIC_UNEVEN: { pause: "irregular", transition: "abrupt", reaction: "uneven" },
  MECHANICAL_PRECISE: { pause: "exact", transition: "snap", reaction: "minimal" },
});

const PALETTE_NEAR = 40;

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function wordCount(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

function hexToRgb(hex) {
  const m = /^#([0-9a-fA-F]{6})$/.exec(String(hex || ""));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function colorDistance(a, b) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  if (!A || !B) return Infinity;
  const dr = A[0] - B[0];
  const dg = A[1] - B[1];
  const db = A[2] - B[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function paletteOf(brand) {
  const v = brand && brand.visualIdentity ? brand.visualIdentity : brand;
  return v ? [v.primaryColor, v.secondaryColor, v.accentColor] : [null, null, null];
}

function paletteNear(a, b, limit = PALETTE_NEAR) {
  const A = paletteOf(a);
  const B = paletteOf(b);
  return A.every((color, i) => colorDistance(color, B[i]) < limit);
}

function normalizeTitle(title) {
  return String(title || "").toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function titlesTooClose(a, b) {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return na.includes(nb) || nb.includes(na);
}

function generationStamp({ status = "READY", at = null, modelVersion = "seed-canonical-v1", assetStatus = null } = {}) {
  const stamp = at || new Date().toISOString();
  return {
    houseStyleVersion: HOUSE_STYLE_VERSION,
    promptVersion: PROMPT_VERSION,
    modelVersion,
    createdAt: stamp,
    approvedAt: status === "READY" ? stamp : null,
    status,
    assetStatus: {
      heroPortrait: "PENDING",
      avatar: "PENDING",
      emblem: "READY",
      introCard: "PENDING",
      victoryCard: "PENDING",
      defeatCard: "PENDING",
      shareTemplate: "PENDING",
      ...(assetStatus || {}),
    },
  };
}

function generation(status = "READY") {
  return generationStamp({ status, at: SEED_STAMP, modelVersion: "seed-canonical-v1" });
}

function assetRefs(agentId) {
  return {
    heroPortrait: null,
    avatar: null,
    emblem: `/static/emblems/${agentId}.svg`,
    introCard: null,
    victoryCard: null,
    defeatCard: null,
    shareTemplate: null,
  };
}

function defineBrand(row) {
  return {
    agentId: row.agentId,
    brandVersion: "v1",
    name: row.name,
    title: row.title,
    tagline: row.tagline,
    archetype: row.archetype,
    personality: row.personality,
    visualIdentity: row.visualIdentity,
    assets: assetRefs(row.agentId),
    generation: generation("READY"),
  };
}

// Canonical v1. Dracula, Caesar, and The Reaper follow the spec examples.
// The rest of the house cast gets a distinct title, emblem, and palette.
const SEED_BRANDS = [
  defineBrand({
    agentId: "dracula",
    name: "Dracula",
    title: "The Gambler",
    tagline: "He wins before the dice are revealed.",
    archetype: "GOTHIC_GAMBLER",
    personality: {
      aggression: 0.86, bluffing: 0.76, discipline: 0.44, chaos: 0.12,
      confidence: 0.91, patience: 0.36, showmanship: 0.88, calculation: 0.66,
      riskTolerance: 0.84, adaptability: 0.62,
    },
    visualIdentity: {
      silhouette: "TALL_SHARP",
      bodyLanguage: "RELAXED_PREDATORY",
      facialAttitude: "SMUG",
      primaryColor: "#6D0F1F",
      secondaryColor: "#2A0E18",
      accentColor: "#F43B5F",
      emblem: "BAT_CROWN",
      materialLanguage: ["matte fabric", "glass", "metal"],
      backgroundMotif: "NEON_HALO_GRID",
      lightingStyle: "CRIMSON_NEON_RIM",
      signatureFeature: "ARISTOCRATIC_COLLAR",
      ornamentationLevel: 0.72,
      geometryLanguage: "SHARP_ORGANIC",
      motionLanguage: "FAST_CONFIDENT",
    },
  }),
  defineBrand({
    agentId: "caesar",
    name: "Caesar",
    title: "The Strategist",
    tagline: "The bid waits until the table is thin.",
    archetype: "IMPERIAL_COMMANDER",
    personality: {
      aggression: 0.22, bluffing: 0.28, discipline: 0.92, chaos: 0.02,
      confidence: 0.74, patience: 0.9, showmanship: 0.34, calculation: 0.94,
      riskTolerance: 0.24, adaptability: 0.48,
    },
    visualIdentity: {
      silhouette: "BROAD_IMPOSING",
      bodyLanguage: "STILL_COMMAND",
      facialAttitude: "STOIC",
      primaryColor: "#101216",
      secondaryColor: "#2A2417",
      accentColor: "#FFC247",
      emblem: "LAUREL_SPEAR",
      materialLanguage: ["brushed metal", "carbon", "stone"],
      backgroundMotif: "AUREATE_SIGNAL_RING",
      lightingStyle: "AMBER_NEON_EDGE",
      signatureFeature: "LAUREL_BROW",
      ornamentationLevel: 0.46,
      geometryLanguage: "STRUCTURED_CLASSIC",
      motionLanguage: "SLOW_REGAL",
    },
  }),
  defineBrand({
    agentId: "reaper",
    name: "The Reaper",
    title: "The Chaos Agent",
    tagline: "There is no pattern until you invent one.",
    archetype: "SPECTRAL_WILDCARD",
    personality: {
      aggression: 0.58, bluffing: 0.7, discipline: 0.18, chaos: 0.62,
      confidence: 0.66, patience: 0.22, showmanship: 0.74, calculation: 0.4,
      riskTolerance: 0.8, adaptability: 0.86,
    },
    visualIdentity: {
      silhouette: "ASYMMETRIC_CHAOTIC",
      bodyLanguage: "UNEVEN_DRIFT",
      facialAttitude: "MYSTERIOUS",
      primaryColor: "#0F1014",
      secondaryColor: "#1F1A2E",
      accentColor: "#B15CFF",
      emblem: "BROKEN_HOURGLASS",
      materialLanguage: ["smoke", "glass", "carbon"],
      backgroundMotif: "VOID_PULSE",
      lightingStyle: "VIOLET_NEON_GLOW",
      signatureFeature: "BROKEN_HOOD",
      ornamentationLevel: 0.38,
      geometryLanguage: "BROKEN_FLOW",
      motionLanguage: "CHAOTIC_UNEVEN",
    },
  }),
  defineBrand({
    agentId: "athena",
    name: "Athena",
    title: "The Reader",
    tagline: "She calls when the count cannot hold.",
    archetype: "AEGIS_READER",
    personality: {
      aggression: 0.16, bluffing: 0.18, discipline: 0.9, chaos: 0.04,
      confidence: 0.7, patience: 0.84, showmanship: 0.22, calculation: 0.96,
      riskTolerance: 0.2, adaptability: 0.55,
    },
    visualIdentity: {
      silhouette: "SLIM_ELEGANT",
      bodyLanguage: "MEASURED_STILL",
      facialAttitude: "SERENE",
      primaryColor: "#163A66",
      secondaryColor: "#141A24",
      accentColor: "#E2B340",
      emblem: "OWL_EYE",
      materialLanguage: ["brushed metal", "glass", "carbon"],
      backgroundMotif: "SIGNAL_HALO",
      lightingStyle: "COOL_NEON_EDGE",
      signatureFeature: "ICONIC_COLLAR",
      ornamentationLevel: 0.4,
      geometryLanguage: "CLASSIC_LINEAR",
      motionLanguage: "MECHANICAL_PRECISE",
    },
  }),
  defineBrand({
    agentId: "shark",
    name: "The Shark",
    title: "The Closer",
    tagline: "A thin bid gets more expensive from here.",
    archetype: "PREDATORY_DUELIST",
    personality: {
      aggression: 0.5, bluffing: 0.64, discipline: 0.58, chaos: 0.18,
      confidence: 0.78, patience: 0.42, showmanship: 0.46, calculation: 0.72,
      riskTolerance: 0.6, adaptability: 0.68,
    },
    visualIdentity: {
      silhouette: "COMPACT_AGGRESSIVE",
      bodyLanguage: "FORWARD_LEAN",
      facialAttitude: "PREDATORY",
      primaryColor: "#0B3A32",
      secondaryColor: "#101820",
      accentColor: "#7CFF6A",
      emblem: "SHARK_TOOTH",
      materialLanguage: ["carbon", "glass", "metal"],
      backgroundMotif: "SIGNAL_HALO",
      lightingStyle: "COOL_NEON_EDGE",
      signatureFeature: "ICONIC_COLLAR",
      ornamentationLevel: 0.22,
      geometryLanguage: "CUT_TRIANGULAR",
      motionLanguage: "FAST_CONFIDENT",
    },
  }),
  defineBrand({
    agentId: "oracle",
    name: "The Oracle",
    title: "The Clock",
    tagline: "Rarely spectacular, and never out of time.",
    archetype: "SERENE_ORACLE",
    personality: {
      aggression: 0.38, bluffing: 0.3, discipline: 0.86, chaos: 0.05,
      confidence: 0.64, patience: 0.88, showmanship: 0.26, calculation: 0.84,
      riskTolerance: 0.32, adaptability: 0.5,
    },
    visualIdentity: {
      silhouette: "ROBED_MYSTIC",
      bodyLanguage: "CENTERED_STILL",
      facialAttitude: "MYSTERIOUS",
      primaryColor: "#2C1654",
      secondaryColor: "#0C0A12",
      accentColor: "#C9B6F2",
      emblem: "ECLIPSE",
      materialLanguage: ["smoke", "glass", "carbon"],
      backgroundMotif: "VOID_PULSE",
      lightingStyle: "VIOLET_NEON_GLOW",
      signatureFeature: "ICONIC_COLLAR",
      ornamentationLevel: 0.34,
      geometryLanguage: "CIRCULAR",
      motionLanguage: "SLOW_REGAL",
    },
  }),
  defineBrand({
    agentId: "fox",
    name: "The Fox",
    title: "The Edge",
    tagline: "The smallest lie that still raises the price.",
    archetype: "TRICKSTER",
    personality: {
      aggression: 0.47, bluffing: 0.72, discipline: 0.66, chaos: 0.22,
      confidence: 0.7, patience: 0.58, showmanship: 0.52, calculation: 0.8,
      riskTolerance: 0.55, adaptability: 0.84,
    },
    visualIdentity: {
      silhouette: "SLIM_ELEGANT",
      bodyLanguage: "ANGLED_POISE",
      facialAttitude: "PLAYFUL",
      primaryColor: "#B45309",
      secondaryColor: "#1C140C",
      accentColor: "#F6C453",
      emblem: "FOX_MASK",
      materialLanguage: ["brushed metal", "carbon", "glass"],
      backgroundMotif: "AUREATE_SIGNAL_RING",
      lightingStyle: "AMBER_NEON_EDGE",
      signatureFeature: "ICONIC_COLLAR",
      ornamentationLevel: 0.36,
      geometryLanguage: "POINTED_CURVE",
      motionLanguage: "FAST_CONFIDENT",
    },
  }),
  defineBrand({
    agentId: "brutus",
    name: "Brutus",
    title: "The Blade",
    tagline: "A thin bid is an insult he answers.",
    archetype: "ASSASSIN",
    personality: {
      aggression: 0.74, bluffing: 0.34, discipline: 0.7, chaos: 0.06,
      confidence: 0.8, patience: 0.28, showmanship: 0.3, calculation: 0.62,
      riskTolerance: 0.58, adaptability: 0.4,
    },
    visualIdentity: {
      silhouette: "HEAVY_ARMORED",
      bodyLanguage: "SQUARED_READY",
      facialAttitude: "COLD",
      primaryColor: "#D4522A",
      secondaryColor: "#241610",
      accentColor: "#F0A07A",
      emblem: "DAGGER",
      materialLanguage: ["matte fabric", "metal", "carbon"],
      backgroundMotif: "NEON_HALO_GRID",
      lightingStyle: "CRIMSON_NEON_RIM",
      signatureFeature: "ICONIC_COLLAR",
      ornamentationLevel: 0.28,
      geometryLanguage: "BLADE_LINEAR",
      motionLanguage: "MECHANICAL_PRECISE",
    },
  }),
  defineBrand({
    agentId: "monk",
    name: "The Monk",
    title: "The Anchor",
    tagline: "He matches the count and calls the impossible.",
    archetype: "MONK",
    personality: {
      aggression: 0.1, bluffing: 0.08, discipline: 0.96, chaos: 0,
      confidence: 0.52, patience: 0.94, showmanship: 0.08, calculation: 0.78,
      riskTolerance: 0.12, adaptability: 0.3,
    },
    visualIdentity: {
      silhouette: "ROBED_MYSTIC",
      bodyLanguage: "GROUNDED",
      facialAttitude: "SERENE",
      primaryColor: "#1F4D32",
      secondaryColor: "#141814",
      accentColor: "#7DAF6A",
      emblem: "STONE_CIRCLE",
      materialLanguage: ["matte fabric", "carbon", "glass"],
      backgroundMotif: "SIGNAL_HALO",
      lightingStyle: "COOL_NEON_EDGE",
      signatureFeature: "ICONIC_COLLAR",
      ornamentationLevel: 0.12,
      geometryLanguage: "CIRCLE_PLAIN",
      motionLanguage: "SLOW_REGAL",
    },
  }),
  defineBrand({
    agentId: "siren",
    name: "The Siren",
    title: "The Tempo",
    tagline: "She changes the count to see who flinches.",
    archetype: "SORCERER",
    personality: {
      aggression: 0.63, bluffing: 0.68, discipline: 0.4, chaos: 0.35,
      confidence: 0.76, patience: 0.34, showmanship: 0.82, calculation: 0.58,
      riskTolerance: 0.72, adaptability: 0.77,
    },
    visualIdentity: {
      silhouette: "SLIM_ELEGANT",
      bodyLanguage: "SWAY",
      facialAttitude: "PLAYFUL",
      primaryColor: "#0C6B62",
      secondaryColor: "#071018",
      accentColor: "#6AE7FF",
      emblem: "CRESCENT_WAVE",
      materialLanguage: ["glass", "carbon", "metal"],
      backgroundMotif: "SIGNAL_HALO",
      lightingStyle: "COOL_NEON_EDGE",
      signatureFeature: "ICONIC_COLLAR",
      ornamentationLevel: 0.58,
      geometryLanguage: "CURVE_REPEAT",
      motionLanguage: "CHAOTIC_UNEVEN",
    },
  }),
  defineBrand({
    agentId: "miser",
    name: "The Miser",
    title: "The Grinder",
    tagline: "Nothing is given, and nothing unpriced is taken.",
    archetype: "PATIENT_GRINDER",
    personality: {
      aggression: 0.28, bluffing: 0.22, discipline: 0.88, chaos: 0.09,
      confidence: 0.48, patience: 0.92, showmanship: 0.12, calculation: 0.86,
      riskTolerance: 0.18, adaptability: 0.44,
    },
    visualIdentity: {
      silhouette: "MECHANICAL",
      bodyLanguage: "CLOSED_GUARD",
      facialAttitude: "COLD",
      primaryColor: "#2A3142",
      secondaryColor: "#0E1016",
      accentColor: "#C5A47E",
      emblem: "LOCKED_COIN",
      materialLanguage: ["brushed metal", "carbon", "stone"],
      backgroundMotif: "AUREATE_SIGNAL_RING",
      lightingStyle: "AMBER_NEON_EDGE",
      signatureFeature: "ICONIC_COLLAR",
      ornamentationLevel: 0.18,
      geometryLanguage: "TIGHT_GRID",
      motionLanguage: "MECHANICAL_PRECISE",
    },
  }),
  defineBrand({
    agentId: "jester",
    name: "The Jester",
    title: "The Noise",
    tagline: "The bid is a joke until the call lands.",
    archetype: "MADMAN",
    personality: {
      aggression: 0.52, bluffing: 0.8, discipline: 0.24, chaos: 0.48,
      confidence: 0.84, patience: 0.26, showmanship: 0.94, calculation: 0.5,
      riskTolerance: 0.76, adaptability: 0.7,
    },
    visualIdentity: {
      silhouette: "ASYMMETRIC_CHAOTIC",
      bodyLanguage: "OFF_BALANCE",
      facialAttitude: "MANIC",
      primaryColor: "#7A2E8A",
      secondaryColor: "#140814",
      accentColor: "#F25CA2",
      emblem: "BROKEN_MASK",
      materialLanguage: ["glass", "carbon", "metal"],
      backgroundMotif: "VOID_PULSE",
      lightingStyle: "VIOLET_NEON_GLOW",
      signatureFeature: "ICONIC_COLLAR",
      ornamentationLevel: 0.8,
      geometryLanguage: "BROKEN_SYMMETRY",
      motionLanguage: "CHAOTIC_UNEVEN",
    },
  }),
];

function validateBrand(brand) {
  const errors = [];
  if (!brand || typeof brand !== "object") return { ok: false, errors: ["brand"] };
  for (const key of ["agentId", "brandVersion", "name", "title", "tagline", "archetype"]) {
    if (!brand[key] || typeof brand[key] !== "string") errors.push(key);
  }
  if (brand.brandVersion && !/^v[1-9][0-9]*$/.test(brand.brandVersion)) errors.push("brandVersion");
  const words = wordCount(brand.tagline);
  if (words < 4 || words > 14) errors.push("tagline_length");
  const personality = brand.personality || {};
  for (const key of PERSONALITY_KEYS) {
    const n = personality[key];
    if (typeof n !== "number" || n < 0 || n > 1) errors.push("personality." + key);
  }
  const visual = brand.visualIdentity || {};
  for (const key of VISUAL_KEYS) {
    if (visual[key] == null || visual[key] === "") errors.push("visualIdentity." + key);
  }
  if (visual.materialLanguage && !Array.isArray(visual.materialLanguage)) errors.push("visualIdentity.materialLanguage");
  for (const key of ["primaryColor", "secondaryColor", "accentColor"]) {
    if (!hexToRgb(visual[key])) errors.push("visualIdentity." + key);
  }
  if (typeof visual.ornamentationLevel !== "number" || visual.ornamentationLevel < 0 || visual.ornamentationLevel > 1) {
    errors.push("visualIdentity.ornamentationLevel");
  }
  if (visual.motionLanguage && !MOTION_LANGUAGES[visual.motionLanguage]) errors.push("visualIdentity.motionLanguage");
  const assets = brand.assets || {};
  for (const key of ASSET_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(assets, key)) errors.push("assets." + key);
    else if (assets[key] != null && typeof assets[key] !== "string") errors.push("assets." + key);
  }
  const gen = brand.generation || {};
  for (const key of ["houseStyleVersion", "promptVersion", "modelVersion", "createdAt", "status"]) {
    if (!gen[key]) errors.push("generation." + key);
  }
  if (gen.status && !BRAND_STATUSES.includes(gen.status)) errors.push("generation.status");
  if (!Object.prototype.hasOwnProperty.call(gen, "approvedAt")) errors.push("generation.approvedAt");
  return { ok: errors.length === 0, errors };
}

function versionKey(agentId, brandVersion) {
  return `${agentId}:${brandVersion}`;
}

function nextVersionId(current) {
  const n = Number(String(current || "v0").replace(/\D/g, "")) || 0;
  return `v${n + 1}`;
}

class BrandBook {
  constructor(opts = {}) {
    this._versions = new Map();
    this._active = new Map();
    this._meta = new Map();
    if (opts.state) this.importState(opts.state);
    if (opts.seeds !== false) this.ensureSeeds();
  }

  ensureSeeds() {
    for (const brand of SEED_BRANDS) {
      const key = versionKey(brand.agentId, brand.brandVersion);
      if (this._versions.has(key)) continue;
      this._versions.set(key, clone(brand));
      if (!this._active.has(brand.agentId)) this._activate(brand, brand.generation.createdAt);
    }
  }

  _activate(brand, at) {
    const prev = this._meta.get(brand.agentId);
    const now = at || new Date().toISOString();
    this._active.set(brand.agentId, brand.brandVersion);
    this._meta.set(brand.agentId, {
      agentId: brand.agentId,
      activeBrandVersion: brand.brandVersion,
      status: brand.generation.status,
      createdAt: prev ? prev.createdAt : (brand.generation.createdAt || now),
      updatedAt: now,
    });
  }

  activeVersion(agentId) {
    return this._active.get(agentId) || null;
  }

  full(agentId, brandVersion) {
    const version = brandVersion || this._active.get(agentId);
    if (!version) return null;
    const row = this._versions.get(versionKey(agentId, version));
    return row ? clone(row) : null;
  }

  versions(agentId) {
    const rows = [];
    for (const row of this._versions.values()) {
      if (row.agentId === agentId) rows.push(clone(row));
    }
    rows.sort((a, b) => a.brandVersion.localeCompare(b.brandVersion, undefined, { numeric: true }));
    return rows;
  }

  list() {
    return CAST.map((c) => this.full(c.id)).filter(Boolean);
  }

  publicBrand(brand) {
    if (!brand) return null;
    const visual = brand.visualIdentity;
    const view = {
      agentId: brand.agentId,
      brandVersion: brand.brandVersion,
      name: brand.name,
      title: brand.title,
      tagline: brand.tagline,
      archetype: brand.archetype,
      emblem: visual.emblem,
      emblemUrl: brand.assets.emblem,
      primaryColor: visual.primaryColor,
      secondaryColor: visual.secondaryColor,
      accentColor: visual.accentColor,
      silhouette: visual.silhouette,
      facialAttitude: visual.facialAttitude,
      motionLanguage: visual.motionLanguage,
      status: brand.generation.status,
      version: Number(brand.version) || 1,
      styleId: brand.styleId || PFP_STYLE_ID,
      styleVersion: brand.styleVersion || "v1",
      visualDirty: brand.visualDirty === true,
      pfpStatus: brand.status || brand.generation.status,
      creationSelections: inferSelectionsFromBrand(brand),
      pfpUrl: null,
      pfpAssetType: null,
      primaryPfpAssetId: brand.primaryPfpAssetId || null,
      pfpStyleVersion: brand.pfpStyleVersion || null,
      avatarUrl: null,
      avatarSizes: null,
    };
    if (visual.primaryColor) {
      const urls = assetUrls(brand.agentId);
      const versioned = (url) => withBrandVersion(url, brand.version ? brand : { version: view.version });
      view.pfpUrl = versioned((brand.assets && (brand.assets.canonicalPfp || brand.assets.pfpPortrait)) || urls.master);
      view.canonicalPfp = view.pfpUrl;
      view.pfpAssetType = ASSET_TYPE;
      view.primaryPfpAssetId = brand.primaryPfpAssetId || `pfp_${brand.agentId}_canonical`;
      view.pfpStyleVersion = brand.pfpStyleVersion || PFP_STYLE_VERSION;
      view.pfpStyleId = PFP_STYLE_ID;
      view.avatarUrl = versioned((brand.assets && brand.assets.avatar) || urls.avatar);
      view.avatarSizes = {
        48: versioned((brand.assets && brand.assets.avatar48) || urls.sizes["48"]),
        96: versioned((brand.assets && brand.assets.avatar96) || urls.sizes["96"]),
        160: versioned((brand.assets && brand.assets.avatar160) || urls.sizes["160"]),
        256: versioned((brand.assets && brand.assets.avatar256) || urls.sizes["256"]),
        320: versioned((brand.assets && brand.assets.avatar320) || urls.sizes["320"]),
        512: versioned((brand.assets && brand.assets.avatar512) || urls.sizes["512"]),
      };
      view.assets = {
        canonicalPfp: view.canonicalPfp,
        avatar48: view.avatarSizes[48],
        avatar96: view.avatarSizes[96],
        avatar256: view.avatarSizes[256],
        avatar512: view.avatarSizes[512],
      };
      const motion = animatedPfpMeta({ ...brand, version: view.version, assets: { ...(brand.assets || {}), canonicalPfp: view.canonicalPfp } }, view.canonicalPfp);
      if (motion) view.animatedPfp = motion;
    }
    return view;
  }

  publicOf(agentId, brandVersion) {
    return this.publicBrand(this.full(agentId, brandVersion));
  }

  activeBrands() {
    const rows = [];
    for (const [id, version] of this._active) {
      const row = this.full(id, version);
      if (row) rows.push(row);
    }
    return rows;
  }

  publicMap() {
    const out = {};
    for (const row of this.activeBrands()) {
      const brand = this.publicBrand(row);
      if (brand && brand.status === "READY") out[row.agentId] = brand;
    }
    return out;
  }

  appendVersion(brand, opts = {}) {
    const check = validateBrand(brand);
    if (!check.ok) {
      const err = new Error("invalid_brand");
      err.code = "invalid_brand";
      err.errors = check.errors;
      throw err;
    }
    const key = versionKey(brand.agentId, brand.brandVersion);
    if (this._versions.has(key)) {
      const err = new Error("brand_version_exists");
      err.code = "brand_version_exists";
      throw err;
    }
    for (const other of this._versions.values()) {
      if (other.agentId === brand.agentId) continue;
      if (titlesTooClose(other.title, brand.title)) {
        const err = new Error("brand_title_collision");
        err.code = "brand_title_collision";
        throw err;
      }
      if (other.visualIdentity.emblem === brand.visualIdentity.emblem) {
        const err = new Error("brand_emblem_collision");
        err.code = "brand_emblem_collision";
        throw err;
      }
      if (paletteNear(other, brand)) {
        const err = new Error("brand_palette_collision");
        err.code = "brand_palette_collision";
        throw err;
      }
    }
    const stored = clone(brand);
    this._versions.set(key, stored);
    if (opts.activate !== false) this._activate(stored);
    return clone(stored);
  }

  patchActive(agentId, patch = {}) {
    const version = this._active.get(agentId);
    if (!version) return null;
    const row = this._versions.get(versionKey(agentId, version));
    if (!row) return null;
    if (patch.visualDirty != null) row.visualDirty = patch.visualDirty === true;
    if (patch.status) row.status = patch.status;
    if (patch.creationSelections) row.creationSelections = patch.creationSelections;
    const meta = this._meta.get(agentId);
    if (meta) meta.updatedAt = new Date().toISOString();
    return clone(row);
  }

  rebrand(agentId, patch = {}) {
    const current = this.full(agentId);
    if (!current) {
      const err = new Error("unknown_agent");
      err.code = "unknown_agent";
      throw err;
    }
    const next = clone(current);
    if (patch.title) next.title = patch.title;
    if (patch.tagline) next.tagline = patch.tagline;
    if (patch.archetype) next.archetype = patch.archetype;
    if (patch.personality) next.personality = { ...next.personality, ...patch.personality };
    if (patch.visualIdentity) next.visualIdentity = { ...next.visualIdentity, ...patch.visualIdentity };
    next.brandVersion = nextVersionId(current.brandVersion);
    const now = new Date().toISOString();
    next.generation = {
      ...next.generation,
      createdAt: now,
      approvedAt: patch.status && patch.status !== "READY" ? null : now,
      status: patch.status || "READY",
      modelVersion: patch.modelVersion || next.generation.modelVersion,
    };
    return this.appendVersion(next, { activate: patch.activate !== false });
  }

  importState(raw) {
    if (!raw || typeof raw !== "object") return;
    const versions = Array.isArray(raw.versions) ? raw.versions : [];
    for (const row of versions) {
      const check = validateBrand(row);
      if (!check.ok) continue;
      const key = versionKey(row.agentId, row.brandVersion);
      if (this._versions.has(key)) continue;
      this._versions.set(key, clone(row));
    }
    const agents = raw.agents && typeof raw.agents === "object" ? raw.agents : {};
    for (const meta of Object.values(agents)) {
      if (!meta || !meta.agentId || !meta.activeBrandVersion) continue;
      if (!this._versions.has(versionKey(meta.agentId, meta.activeBrandVersion))) continue;
      this._active.set(meta.agentId, meta.activeBrandVersion);
      this._meta.set(meta.agentId, {
        agentId: meta.agentId,
        activeBrandVersion: meta.activeBrandVersion,
        status: meta.status || "READY",
        createdAt: meta.createdAt || SEED_STAMP,
        updatedAt: meta.updatedAt || meta.createdAt || SEED_STAMP,
      });
    }
  }

  exportState() {
    const versions = [...this._versions.values()].map((row) => clone(row));
    versions.sort((a, b) => (a.agentId === b.agentId
      ? a.brandVersion.localeCompare(b.brandVersion, undefined, { numeric: true })
      : a.agentId.localeCompare(b.agentId)));
    const agents = {};
    for (const [id, meta] of this._meta) agents[id] = clone(meta);
    return { agents, versions };
  }

  // Embeddings are deferred. Palette and title distance are the local check.
  similarity(candidate, others) {
    const pool = others || this.list().filter((row) => row.agentId !== candidate.agentId);
    let closest = null;
    let best = -1;
    for (const other of pool) {
      const palette = paletteSimilarity(candidate, other);
      const identity = identitySimilarity(candidate, other);
      const overall = Math.max(palette, identity);
      if (overall > best) {
        best = overall;
        closest = { other, palette, identity, overall };
      }
    }
    const score = closest ? closest.overall : 0;
    return {
      overallSimilarity: Math.round(score * 1000) / 1000,
      closestAgentId: closest ? closest.other.agentId : null,
      paletteSimilarity: closest ? Math.round(closest.palette * 1000) / 1000 : 0,
      portraitSimilarity: null,
      identitySimilarity: closest ? Math.round(closest.identity * 1000) / 1000 : 0,
      approved: score <= 0.8,
      embeddings: "deferred",
    };
  }
}

function paletteSimilarity(a, b) {
  const A = paletteOf(a);
  const B = paletteOf(b);
  const dists = A.map((color, i) => colorDistance(color, B[i]));
  const avg = dists.reduce((sum, n) => sum + n, 0) / dists.length;
  return Math.max(0, Math.min(1, 1 - avg / 180));
}

function sameText(a, b) {
  return String(a || "").toLowerCase() === String(b || "").toLowerCase();
}

function visualOf(brand) {
  if (!brand) return {};
  return brand.visualIdentity || brand.visualDNA || brand;
}

// Metadata overlap in [0, 1]. A score at or above 0.75 should take a new variant.
function brandSimilarity(a, b) {
  const left = a || {};
  const right = b || {};
  const va = visualOf(left);
  const vb = visualOf(right);
  let score = 0;
  if (sameText(left.archetype, right.archetype)) score += 0.15;
  if (sameText(va.silhouette, vb.silhouette)) score += 0.20;
  if (sameText(va.emblem, vb.emblem)) score += 0.20;
  if (sameText(va.facialAttitude, vb.facialAttitude)) score += 0.10;
  if (sameText(va.backgroundMotif, vb.backgroundMotif)) score += 0.10;
  if (sameText(va.primaryColor, vb.primaryColor)) score += 0.15;
  if (sameText(va.accentColor, vb.accentColor)) score += 0.10;
  return Math.min(1, score);
}

function identitySimilarity(a, b) {
  let score = 0;
  if (titlesTooClose(a.title, b.title)) score = Math.max(score, 1);
  if (a.archetype && a.archetype === b.archetype) score = Math.max(score, 0.7);
  const va = a.visualIdentity || {};
  const vb = b.visualIdentity || {};
  if (va.emblem && va.emblem === vb.emblem) score = Math.max(score, 0.9);
  if (va.silhouette && va.silhouette === vb.silhouette) score = Math.max(score, 0.45);
  return score;
}

module.exports = {
  BRAND_STATUSES,
  PERSONALITY_KEYS,
  VISUAL_KEYS,
  ASSET_KEYS,
  MOTION_LANGUAGES,
  PALETTE_NEAR,
  HOUSE_STYLE_VERSION,
  PROMPT_VERSION,
  SEED_BRANDS,
  generationStamp,
  BrandBook,
  validateBrand,
  paletteNear,
  titlesTooClose,
  brandSimilarity,
  colorDistance,
  wordCount,
};
