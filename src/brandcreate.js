// brandcreate.js — Spectator agent creation.
//
// Identity, Visual DNA, and 3–5 concepts are deterministic. Portraits are
// neon-competitive images drawn in-process. No image API key. Selecting a
// concept locks the identity. generatePortrait writes sized WebP files.
// The house cast is not rewritten here.

const {
  PERSONALITY_KEYS,
  SEED_BRANDS,
  generationStamp,
  paletteNear,
  titlesTooClose,
  brandSimilarity,
  validateBrand,
  wordCount,
} = require("./brands");
const {
  PFP_STYLE_VERSION,
  PFP_PROMPT_VERSION,
  ASSET_TYPE,
  AVATAR_SIZES,
  assetUrls,
  withBrandVersion,
} = require("./pfp");
const { createImageProvider } = require("./imageprovider");
const { PFP_STYLE_ID } = require("./branding/stylePresets");
const { buildVisualDNA, composeVisualDNA } = require("./branding/buildVisualDNA");
const { promptForAgent } = require("./branding/buildPfpPrompt");
const { buildSeed, savePortrait, STYLE_VERSION } = require("./branding/pfpAssets");
const { renderNeonCompetitiveSvg } = require("./branding/localPortrait");
const {
  normalizeSelections,
  mapSelections,
  visualOptionGroups,
} = require("./branding/creationSelections");

const imageProvider = createImageProvider();

const MODEL_VERSION = PFP_STYLE_VERSION;
const PFP_TOUCHES = Object.freeze(["expression", "darker", "cleaner", "minimal", "premium"]);
const ROSTER_CAP = 16;

const ARCHETYPE_IDS = Object.freeze([
  "GAMBLER", "STRATEGIST", "EMPEROR", "TRICKSTER", "REAPER", "ORACLE",
  "BEAST", "MACHINE", "DUELIST", "WARLORD", "NOBLE", "MADMAN", "JUDGE",
  "PHANTOM", "ALCHEMIST", "ASSASSIN", "MONK", "PIRATE", "SORCERER", "COMMANDER",
]);

const SLIDER_KEYS = Object.freeze([
  "aggression", "bluffing", "discipline", "chaos",
]);

const OPTIONAL_SLIDERS = Object.freeze([
  "confidence", "patience", "showmanship", "calculation", "riskTolerance", "adaptability",
]);

const SILHOUETTES = Object.freeze([
  "TALL_SHARP", "BROAD_IMPOSING", "SLIM_ELEGANT", "COMPACT_AGGRESSIVE",
  "ASYMMETRIC_CHAOTIC", "ROBED_MYSTIC", "HEAVY_ARMORED", "MECHANICAL",
]);

const ATTITUDES = Object.freeze([
  "SMUG", "STOIC", "MANIC", "SERENE", "PREDATORY", "MYSTERIOUS", "COLD", "PLAYFUL", "REGAL",
]);

const BODIES = Object.freeze([
  "RELAXED_PREDATORY", "STILL_COMMAND", "OFF_BALANCE", "MEASURED_STANCE",
  "FORWARD_WEIGHT", "LOOSE_LEAN", "ROBED_STILL", "COILED",
]);

const MOTIFS = Object.freeze([
  "NEON_HALO_GRID", "AUREATE_SIGNAL_RING", "VOID_PULSE", "SIGNAL_HALO",
]);

const LIGHTING = Object.freeze([
  "CRIMSON_NEON_RIM", "AMBER_NEON_EDGE", "VIOLET_NEON_GLOW", "COOL_NEON_EDGE",
]);

const GEOMETRY = Object.freeze([
  "SHARP_ORGANIC", "STRUCTURED_CLASSIC", "BROKEN_SYMMETRY", "CLEAN_MACHINE", "SOFT_CURVE",
]);

const MOTIONS = Object.freeze([
  "FAST_CONFIDENT", "SLOW_REGAL", "CHAOTIC_UNEVEN", "MECHANICAL_PRECISE",
]);

const MATERIALS = Object.freeze([
  ["matte fabric", "glass", "metal"],
  ["brushed metal", "carbon", "stone"],
  ["smoke", "glass", "carbon"],
  ["carbon", "glass"],
]);

const TAGLINES = Object.freeze([
  "He prices the bluff before the cup even moves.",
  "The table pays for believing the wrong count.",
  "A thin bid is a door left open on purpose.",
  "Silence does more work than another die.",
  "The next call is already sitting in the cup.",
  "Pressure is a bid that arrives a little early.",
  "He spends one lie and then waits for the room.",
  "The count climbs only when the price is real.",
  "Nobody leaves this table with the story they wanted.",
  "A calm face can be the loudest bet in the room.",
  "The winning bid was finished before the dice stopped.",
  "Mercy is just another way to raise the price.",
  "He lets the loud table talk itself into the call.",
  "One extra die is a story the room wants to believe.",
  "The cup stays still until somebody flinches.",
  "Victory sounds like a quiet call at the right time.",
]);

const ADJECTIVES = Object.freeze([
  "Velvet", "Silent", "Gilded", "Hollow", "Crimson", "Marble", "Silver", "Ragged",
  "Iron", "Pale", "Wicked", "Gentle", "Rapid", "Bitter", "Lucid", "Amber",
  "Frozen", "Hidden", "Scarlet", "Quiet",
]);

const NOUNS = Object.freeze([
  "Wager", "Mask", "Oath", "Vein", "Ledger", "Signal", "Mirror", "Prayer",
  "Storm", "Bargain", "Chorus", "Vessel", "Riddle", "Banner", "Cipher", "Throne",
  "Hunter", "Lantern", "Verdict", "Harbor",
]);

// Monochrome marks. Fill is currentColor so a card can tint the emblem
// with the concept accent. Masks still read them as solid shapes.
const EMBLEM_PATHS = Object.freeze({
  CROWN: '<path fill="currentColor" d="M5 23h22v3H5zm1.2-2.2 2.6-8.2 3.6 4.4L16 8l3.6 9 3.6-4.4 2.6 8.2z"/>',
  SERPENT: '<path fill="currentColor" d="M6 20c6 0 5-7 11-7 4 0 6 3 8 3-1 4-6 3-8 1-3-2-4 3-8 3-2 0-3-1-3-2 1 0 2 .4 3 .4z"/>',
  OPEN_EYE: '<path fill="currentColor" d="M4 16C8 9 24 9 28 16c-4 7-20 7-24 0zm8.2-.2a3.8 3.8 0 1 0 7.6 0 3.8 3.8 0 0 0-7.6 0z"/>',
  WOLF: '<path fill="currentColor" d="M7 11 4 6l6 3 6-4 6 4 6-3-3 5-2 12H9z"/>',
  RAVEN: '<path fill="currentColor" d="M8 20c2-6 8-10 16-10-4 2-6 4-6 7 4-1 7 0 9 2-5 1-8 4-12 4-3 0-6-1-7-3z"/>',
  FLAME: '<path fill="currentColor" d="M16 4c2 5-2 7-2 11 0 2 1 3 3 3 4 0 7-3 7-8 3 3 4 7 4 10 0 5-4 8-8 8s-9-3-9-8c0-5 3-8 5-16z"/>',
  SKULL: '<path fill="currentColor" d="M8 14a8 8 0 0 1 16 0c0 4-2 6-2 8v3H10v-3c0-2-2-4-2-8zm4 1h2v3h-2zm6 0h2v3h-2zM12 24h8v2h-2v-1h-1v1h-2v-1h-1v1h-2z"/>',
  TOWER: '<path fill="currentColor" d="M10 28V12h3V8h2v4h2V8h2v4h3v16zm3-4h2v3h-2zm4 0h2v3h-2z"/>',
  CHESS_KING: '<path fill="currentColor" d="M14 6h4v3h3v3h-3v2h5l-2 12H11L9 14h5V12h-3V9h3z"/>',
  CRESCENT: '<path fill="currentColor" d="M18 6a10 10 0 1 0 8 16 8 8 0 1 1-8-16z"/>',
  LAUREL_WREATH: '<path fill="currentColor" d="M16 6c2 3 2 6 1 9-3-1-6 0-8 2 3 0 5 2 6 5-4-1-7 0-9 3 5 1 8 4 8 8h2c0-4 3-7 8-8-2-3-5-4-9-3 1-3 3-5 6-5-2-2-5-3-8-2 1-3 1-6-1-9z"/>',
  COIN_STACK: '<path fill="currentColor" d="M8 10h16v3H8zm1 5h14v3H9zm-1 5h16v3H8z"/>',
  DICE_MARK: '<path fill="currentColor" d="M7 7h18v18H7zm4 3h3v3h-3zm7 0h3v3h-3zM11 18h3v3h-3zm7 0h3v3h-3z"/>',
  HOURGLASS: '<path fill="currentColor" d="M8 5h16v3l-6 8 6 8v3H8v-3l6-8-6-8zm3 3 5 6 5-6z"/>',
  SPEARHEAD: '<path fill="currentColor" d="M16 3 23 14h-5v15h-4V14h-5z"/>',
  ROSE: '<path fill="currentColor" d="M16 8c2-3 6-2 6 2 3-1 5 3 2 5 2 3-1 6-4 5 0 3-4 5-6 2-2 3-6 1-6-2-3 1-6-2-4-5-3-2-1-6 2-5 0-4 4-5 6-2z"/>',
  ANCHOR_MARK: '<path fill="currentColor" d="M14 6h4v3h3v3h-3v8c3 0 5-2 6-4l3 2c-2 4-6 6-9 6s-7-2-9-6l3-2c1 2 3 4 6 4V12H11V9h3z"/>',
  STAR_MARK: '<path fill="currentColor" d="M16 4l3 8h8l-6.5 5 2.5 8L16 20l-7 5 2.5-8L5 12h8z"/>',
  KEY_MARK: '<path fill="currentColor" d="M12 8a5 5 0 1 1 0 10H11v3h-3v3H5v-4l7-2a5 5 0 0 1 0-10zm1 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/>',
  HELM: '<path fill="currentColor" d="M6 16a10 10 0 0 1 20 0v6H6zm4 6h12v3H10z"/>',
  SUN_MARK: '<path fill="currentColor" d="M14 3h4v4h-4zM14 25h4v4h-4zM3 14h4v4H3zm22 0h4v4h-4zM6 6l3 3-2 2-3-3zm16 16 3 3-2 2-3-3zM23 6l3 3-2 2-3-3zM8 22l3 3-2 2-3-3zM16 10a6 6 0 1 1 0 12 6 6 0 0 1 0-12z"/>',
  COMPASS: '<path fill="currentColor" d="M16 4 20 14 16 28 12 14zm0 8 1.2 4L16 20l-1.2-4z"/>',
  FANG: '<path fill="currentColor" d="M8 6h5l3 14 3-14h5l-4 20h-4l-2-8-2 8H10z"/>',
  VINE: '<path fill="currentColor" d="M16 28V14c0-4 3-7 7-8-1 4-4 6-7 6 4-1 8 1 9 5-4-1-7 1-8 4 3 0 6 2 7 5-3-1-6 0-8 2zM16 14c0-4-3-7-7-8 1 4 4 6 7 6z"/>',
});

const EMBLEM_IDS = Object.freeze(Object.keys(EMBLEM_PATHS));

const DIRECTION_HINTS = Object.freeze([
  { test: /cold|ice|moon|silver|steel|blue/i, hue: 196, motif: "SIGNAL_HALO" },
  { test: /gold|sun|imperial|warm|brass|amber/i, hue: 38, motif: "AUREATE_SIGNAL_RING" },
  { test: /blood|red|crimson|rose/i, hue: 348, motif: "NEON_HALO_GRID" },
  { test: /sea|wave|tide|green/i, hue: 168, motif: "SIGNAL_HALO" },
  { test: /void|shadow|night|black|violet/i, hue: 268, motif: "VOID_PULSE" },
  { test: /stone|marble|cloak|monk/i, hue: 200, motif: "SIGNAL_HALO" },
]);

const ARCHETYPE_BIAS = Object.freeze({
  GAMBLER: { motion: "FAST_CONFIDENT", hue: 350, silhouette: "TALL_SHARP", attitude: "SMUG" },
  STRATEGIST: { motion: "SLOW_REGAL", hue: 40, silhouette: "BROAD_IMPOSING", attitude: "STOIC" },
  EMPEROR: { motion: "SLOW_REGAL", hue: 32, silhouette: "BROAD_IMPOSING", attitude: "REGAL" },
  TRICKSTER: { motion: "CHAOTIC_UNEVEN", hue: 300, silhouette: "ASYMMETRIC_CHAOTIC", attitude: "PLAYFUL" },
  REAPER: { motion: "CHAOTIC_UNEVEN", hue: 272, silhouette: "ROBED_MYSTIC", attitude: "MYSTERIOUS" },
  ORACLE: { motion: "MECHANICAL_PRECISE", hue: 200, silhouette: "SLIM_ELEGANT", attitude: "SERENE" },
  BEAST: { motion: "FAST_CONFIDENT", hue: 16, silhouette: "COMPACT_AGGRESSIVE", attitude: "PREDATORY" },
  MACHINE: { motion: "MECHANICAL_PRECISE", hue: 188, silhouette: "MECHANICAL", attitude: "COLD" },
  DUELIST: { motion: "FAST_CONFIDENT", hue: 210, silhouette: "SLIM_ELEGANT", attitude: "COLD" },
  WARLORD: { motion: "FAST_CONFIDENT", hue: 8, silhouette: "HEAVY_ARMORED", attitude: "PREDATORY" },
  NOBLE: { motion: "SLOW_REGAL", hue: 44, silhouette: "SLIM_ELEGANT", attitude: "REGAL" },
  MADMAN: { motion: "CHAOTIC_UNEVEN", hue: 312, silhouette: "ASYMMETRIC_CHAOTIC", attitude: "MANIC" },
  JUDGE: { motion: "SLOW_REGAL", hue: 24, silhouette: "BROAD_IMPOSING", attitude: "STOIC" },
  PHANTOM: { motion: "CHAOTIC_UNEVEN", hue: 258, silhouette: "ROBED_MYSTIC", attitude: "MYSTERIOUS" },
  ALCHEMIST: { motion: "MECHANICAL_PRECISE", hue: 128, silhouette: "SLIM_ELEGANT", attitude: "PLAYFUL" },
  ASSASSIN: { motion: "FAST_CONFIDENT", hue: 168, silhouette: "TALL_SHARP", attitude: "COLD" },
  MONK: { motion: "SLOW_REGAL", hue: 86, silhouette: "ROBED_MYSTIC", attitude: "SERENE" },
  PIRATE: { motion: "CHAOTIC_UNEVEN", hue: 18, silhouette: "COMPACT_AGGRESSIVE", attitude: "SMUG" },
  SORCERER: { motion: "CHAOTIC_UNEVEN", hue: 276, silhouette: "ROBED_MYSTIC", attitude: "MYSTERIOUS" },
  COMMANDER: { motion: "MECHANICAL_PRECISE", hue: 214, silhouette: "BROAD_IMPOSING", attitude: "STOIC" },
});

function creatorError(code, message, status = 400) {
  const err = new Error(code);
  err.code = code;
  err.publicMessage = message;
  err.status = status;
  return err;
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

function hashString(text) {
  let h = 2166136261;
  const s = String(text || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(list, rand) {
  return list[Math.floor(rand() * list.length) % list.length];
}

function hslToHex(h, s, l) {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(100, s)) / 100;
  const light = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const hp = hue / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const m = light - c / 2;
  const hex = (n) => Math.round((n + m) * 255).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase();
}

function hexHue(hex) {
  const m = /^#([0-9A-F]{6})$/i.exec(String(hex || ""));
  if (!m) return 40;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 40;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = Math.round(h * 60);
  if (h < 0) h += 360;
  return h;
}

function labelFor(id) {
  const text = String(id || "").toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

function humanize(code) {
  return String(code || "").toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function band(n) {
  if (n >= 0.66) return "high";
  if (n <= 0.34) return "low";
  return "measured";
}

function buildTitles() {
  const titles = [];
  for (const adj of ADJECTIVES) {
    for (const noun of NOUNS) {
      const title = `The ${adj} ${noun}`;
      if (SEED_BRANDS.some((brand) => titlesTooClose(brand.title, title))) continue;
      if (titles.some((other) => titlesTooClose(other, title))) continue;
      titles.push(title);
    }
  }
  return titles;
}

const SAFE_TITLES = Object.freeze(buildTitles());

function assertCatalog() {
  if (SAFE_TITLES.length < 40) throw new Error("brand title catalog is too small");
  for (const line of TAGLINES) {
    const n = wordCount(line);
    if (n < 4 || n > 14) throw new Error("tagline length: " + line);
  }
  if (EMBLEM_IDS.length < 20) throw new Error("emblem catalog is too small");
}
assertCatalog();

function archetypeLabel(id) {
  return labelFor(id);
}

function cleanName(value) {
  const name = String(value || "").replace(/\s+/g, " ").trim();
  if (!/^[A-Za-z][A-Za-z0-9 '\-]{1,31}$/.test(name)) {
    throw creatorError("bad_name", "Use 2–32 letters, numbers, spaces, apostrophes, or hyphens.");
  }
  return name;
}

function cleanDescription(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length < 8 || text.length > 240) {
    throw creatorError("bad_description", "Add a short description, between 8 and 240 characters.");
  }
  return text;
}

function cleanDirection(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length > 160) throw creatorError("bad_direction", "Keep the visual direction under 160 characters.");
  return text;
}

function unit(value, fallback, key) {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw creatorError("bad_personality", `${key} must be a number from 0 to 1.`);
  }
  return Math.round(n * 1000) / 1000;
}

function personalityFrom(input, archetype) {
  const raw = input && input.personality && typeof input.personality === "object" ? input.personality : {};
  const bias = ARCHETYPE_BIAS[archetype] || ARCHETYPE_BIAS.GAMBLER;
  const base = {
    aggression: 0.5,
    bluffing: 0.5,
    discipline: 0.5,
    chaos: 0.35,
    confidence: 0.62,
    patience: 0.5,
    showmanship: 0.48,
    calculation: 0.55,
    riskTolerance: 0.5,
    adaptability: 0.5,
  };
  if (bias.motion === "FAST_CONFIDENT") base.aggression = 0.72;
  if (bias.motion === "SLOW_REGAL") base.discipline = 0.74;
  if (bias.motion === "CHAOTIC_UNEVEN") base.chaos = 0.7;
  if (bias.motion === "MECHANICAL_PRECISE") base.calculation = 0.78;
  const out = {};
  for (const key of PERSONALITY_KEYS) {
    const supplied = raw[key] != null ? raw[key] : input[key];
    out[key] = unit(supplied, base[key], key);
  }
  return out;
}

function summaries(name, archetype, personality) {
  const label = archetypeLabel(archetype);
  const personalitySummary = `${name} reads as ${band(personality.aggression)} aggression, ${band(personality.bluffing)} bluffing, ${band(personality.discipline)} discipline, and ${band(personality.chaos)} chaos.`;
  let playstyleSummary = "Mixes a measured bid with a patient call.";
  if (personality.aggression >= 0.66 && personality.bluffing >= 0.66) {
    playstyleSummary = "Pushes thin bids and expects the table to fold.";
  } else if (personality.discipline >= 0.66 && personality.aggression < 0.45) {
    playstyleSummary = "Waits until the count is actually thin.";
  } else if (personality.chaos >= 0.66) {
    playstyleSummary = "Changes the face often enough to spoil a read.";
  } else if (personality.bluffing >= 0.66) {
    playstyleSummary = "Spends a small lie and watches who pays it.";
  }
  const strength = personality.discipline >= personality.aggression
    ? "Holds the count until the bid is priced."
    : "Pushes the table off an honest ladder.";
  const weakness = personality.chaos >= 0.66
    ? "The wild bid that was never in the cup."
    : personality.aggression >= 0.66
      ? "Calls one die before the math agrees."
      : "Gives a patient liar one bid too many.";
  return { personalitySummary, playstyleSummary, strength, weakness, label };
}

function styleOf(personality, label) {
  const style = [label];
  if (personality.aggression >= 0.66) style.push("Aggressive");
  else if (personality.aggression <= 0.34) style.push("Patient");
  if (personality.bluffing >= 0.66) style.push("Bluffer");
  if (personality.discipline >= 0.66) style.push("Disciplined");
  if (personality.chaos >= 0.66) style.push("Unpredictable");
  return style.slice(0, 4);
}

function directionBias(text, fallbackHue) {
  const found = DIRECTION_HINTS.find((row) => row.test.test(text || ""));
  if (!found) return { hue: fallbackHue, motif: null };
  return found;
}

function paletteAt(hue, balance) {
  const accentHue = (hue + 28) % 360;
  if (balance === 1) {
    return {
      primaryColor: hslToHex(hue, 42, 16),
      secondaryColor: hslToHex(hue + 18, 30, 9),
      accentColor: hslToHex(accentHue, 92, 62),
    };
  }
  if (balance === 2) {
    return {
      primaryColor: hslToHex(hue, 36, 13),
      secondaryColor: hslToHex(hue + 210, 16, 8),
      accentColor: hslToHex(accentHue + 12, 88, 66),
    };
  }
  return {
    primaryColor: hslToHex(hue, 48, 15),
    secondaryColor: hslToHex(hue, 22, 8),
    accentColor: hslToHex(accentHue + 6, 90, 64),
  };
}

function occupied(brands) {
  const titles = [];
  const emblems = new Set();
  const palettes = [];
  const names = [];
  for (const brand of brands || []) {
    if (!brand) continue;
    if (brand.title) titles.push(brand.title);
    if (brand.name) names.push(brand.name);
    const visual = brand.visualIdentity || brand;
    if (visual.emblem) emblems.add(visual.emblem);
    if (visual.primaryColor) palettes.push(brand.visualIdentity ? brand : { visualIdentity: visual });
  }
  return { titles, emblems, palettes, names };
}

function titleFree(title, occ, extra) {
  if ([...occ.titles, ...extra].some((other) => titlesTooClose(other, title))) return false;
  return true;
}

function paletteFree(visual, occ, extra) {
  const candidate = { visualIdentity: visual };
  return ![...occ.palettes, ...extra].some((other) => paletteNear(candidate, other));
}

function conceptVariant(draft, index, salt, occ, vary, anchor) {
  const bias = ARCHETYPE_BIAS[draft.archetype];
  const hinted = directionBias(draft.visualDirection, bias.hue);
  const rand = mulberry32(hashString([
    draft.name, draft.archetype, draft.shortDescription, draft.visualDirection,
    salt, index, vary || "all",
    anchor ? anchor.emblem : "",
  ].join("|")));
  const keepColors = vary === "emblem" && anchor;
  const keepEmblem = vary === "colors" && anchor;
  const like = vary === "like" && anchor;
  let hue = (hinted.hue + salt * 19 + index * (like ? 9 : 27) + Math.floor(rand() * 5)) % 360;
  const balance = keepColors ? 0 : (index + salt) % 3;
  const usedTitles = [];
  const usedEmblems = new Set();
  const usedPalettes = [];
  for (let attempt = 0; attempt < 36; attempt++) {
    const title = SAFE_TITLES[(hashString(draft.name) + index * 5 + salt * 3 + attempt) % SAFE_TITLES.length];
    const tagline = TAGLINES[(hashString(draft.shortDescription) + index + salt + attempt) % TAGLINES.length];
    const emblem = keepEmblem
      ? anchor.emblem
      : EMBLEM_IDS[(hashString(draft.archetype) + index * 3 + salt + attempt) % EMBLEM_IDS.length];
    const colors = keepColors
      ? {
        primaryColor: anchor.visualIdentity.primaryColor,
        secondaryColor: anchor.visualIdentity.secondaryColor,
        accentColor: anchor.visualIdentity.accentColor,
      }
      : paletteAt((hue + attempt * 17) % 360, balance);
    const silhouette = like && anchor
      ? anchor.visualIdentity.silhouette
      : SILHOUETTES[(SILHOUETTES.indexOf(bias.silhouette) + index + attempt) % SILHOUETTES.length];
    const dna = buildVisualDNA({ archetype: draft.archetype });
    const visual = {
      silhouette,
      bodyLanguage: BODIES[(index + attempt + salt) % BODIES.length],
      facialAttitude: attempt % 2 === 0 ? bias.attitude : ATTITUDES[(index + attempt) % ATTITUDES.length],
      primaryColor: colors.primaryColor,
      secondaryColor: colors.secondaryColor,
      accentColor: colors.accentColor,
      emblem,
      materialLanguage: (dna.materials || MATERIALS[(index + salt + attempt) % MATERIALS.length]).slice(),
      backgroundMotif: hinted.motif || dna.backgroundMotif || MOTIFS[(index + salt + attempt) % MOTIFS.length],
      lightingStyle: dna.lightingStyle || LIGHTING[(index + attempt) % LIGHTING.length],
      ornamentationLevel: Math.round(clamp01(0.28 + ((index + attempt) % 4) * 0.08) * 100) / 100,
      geometryLanguage: GEOMETRY[(index + salt) % GEOMETRY.length],
      motionLanguage: bias.motion,
      signatureFeature: dna.signatureFeature,
      styleId: PFP_STYLE_ID,
    };
    if (!titleFree(title, occ, usedTitles)) continue;
    if (!keepEmblem && (occ.emblems.has(emblem) || usedEmblems.has(emblem))) continue;
    if (!paletteFree(visual, occ, usedPalettes)) continue;
    if (wordCount(tagline) < 4 || wordCount(tagline) > 14) continue;
    const candidate = { archetype: draft.archetype, visualIdentity: visual };
    const crowded = [...(occ.palettes || []), ...usedPalettes].some((other) => brandSimilarity(candidate, other) >= 0.75);
    if (crowded) continue;
    return {
      id: `c${index + 1}`,
      conceptNumber: index + 1,
      title,
      tagline,
      silhouette: visual.silhouette,
      pose: visual.bodyLanguage,
      background: visual.backgroundMotif,
      visualIdentity: visual,
      palette: {
        primary: visual.primaryColor,
        secondary: visual.secondaryColor,
        accent: visual.accentColor,
      },
      emblem,
      emblemSvg: emblemSvg(emblem),
    };
  }
  return null;
}

// Concept variant number: concept 0 is the purest rendition of the selections;
// later concepts (and later regenerations, via salt) vary hair/turn/intensity/jaw
// inside those selections.
function conceptVariation(draft, index) {
  const salt = Number(draft && draft.conceptSalt) || 0;
  const i = Math.max(0, Number(index) || 0);
  return i === 0 ? 0 : i + 4 * (salt % 3);
}

function attachPfp(draft, concept, index, treatment) {
  const selections = normalizeSelections(draft.creationSelections);
  const variation = conceptVariation(draft, index);
  concept.creationSelections = { ...selections };
  concept.pfpVariation = variation;
  const archetype = selections.archetype || draft.archetype;
  const visualDNA = composeVisualDNA({ archetype, visual: concept.visualIdentity });
  const agent = {
    name: draft.name,
    title: concept.title,
    archetype,
    brand: { visualDNA },
  };
  const mode = treatment || "standard";
  const seed = buildSeed(`${draft.id}_c${variation}_${mode}`, STYLE_VERSION);
  const prompt = promptForAgent({
    agent,
    styleId: PFP_STYLE_ID,
    selections,
    variation,
    treatment: mode,
  });
  concept.pfp = {
    assetType: ASSET_TYPE,
    assetId: `pfp_${draft.id}_${concept.id}`,
    styleVersion: PFP_STYLE_VERSION,
    promptVersion: PFP_PROMPT_VERSION,
    prompt,
    seed,
    visualDNA,
    safeZone: { circle: 0.86, face: { x: 0.28, y: 0.17, w: 0.44, h: 0.52 } },
    quality: { ok: true, reasons: [] },
    recipe: {
      selections,
      conceptVariant: variation,
      seed,
      styleId: PFP_STYLE_ID,
      treatment: mode,
    },
  };
  concept.pfpSvg = renderNeonCompetitiveSvg({
    visualDNA,
    seed,
    agentId: draft.id,
    archetype,
    selections,
  });
  concept.assetType = ASSET_TYPE;
  return concept;
}

function emblemSvg(emblemId) {
  const body = EMBLEM_PATHS[emblemId];
  if (!body) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" aria-hidden="true">${body}</svg>`;
}

function userAssetRefs(agentId) {
  const urls = assetUrls(agentId);
  return {
    heroPortrait: null,
    avatar: urls.avatar,
    emblem: `/api/show/agents/${encodeURIComponent(agentId)}/emblem.svg`,
    introCard: null,
    victoryCard: null,
    defeatCard: null,
    shareTemplate: null,
    pfpPortrait: urls.master,
    avatar48: urls.sizes["48"],
    avatar96: urls.sizes["96"],
    avatar160: urls.sizes["160"],
    avatar256: urls.sizes["256"],
    avatar320: urls.sizes["320"],
    avatar512: urls.sizes["512"],
  };
}

function retouchConcepts(draft, treatment) {
  const mode = PFP_TOUCHES.includes(treatment) ? treatment : "standard";
  return (draft.concepts || []).map((concept, index) => {
    const next = {
      ...concept,
      visualIdentity: { ...concept.visualIdentity },
      palette: concept.palette ? { ...concept.palette } : concept.palette,
    };
    return attachPfp(draft, next, index, mode);
  });
}

// Full display name, folded only for case and whitespace. Brand-title
// closeness (leading "the", substring) is a different rule and would reject
// "test agent x" because it contains "test".
function normalizeDisplayName(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function displayNameTaken(name, names) {
  const key = normalizeDisplayName(name);
  if (!key) return false;
  return (names || []).some((other) => normalizeDisplayName(other) === key);
}

function allocateId(name, taken) {
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "") || "agent";
  const root = `u_${base}`;
  const used = taken || new Set();
  if (!used.has(root)) return root;
  for (let n = 2; n < 100; n++) {
    const id = `${root}_${n}`;
    if (!used.has(id)) return id;
  }
  throw creatorError("roster_full", "The arena cannot take another agent right now.", 409);
}

function createDraft(input, ctx) {
  const body = input && typeof input === "object" ? input : {};
  const name = cleanName(body.name);
  const shortDescription = cleanDescription(body.shortDescription || body.description);
  const archetype = String(body.archetype || "").trim().toUpperCase();
  if (!ARCHETYPE_IDS.includes(archetype)) {
    throw creatorError("bad_archetype", "Pick an archetype from the list.");
  }
  const visualDirection = cleanDirection(body.visualDirection || body.direction || "");
  const names = ctx.names || [];
  if (displayNameTaken(name, names)) {
    throw creatorError("name_collision", "That name is already in the arena.", 409);
  }
  if ((ctx.count || 0) >= ROSTER_CAP) {
    throw creatorError("roster_full", "The user roster is full.", 409);
  }
  const id = allocateId(name, ctx.takenIds || new Set());
  const personality = personalityFrom(body, archetype);
  const copy = summaries(name, archetype, personality);
  const now = new Date().toISOString();
  const draft = {
    id,
    name,
    shortDescription,
    archetype,
    archetypeLabel: copy.label,
    visualDirection,
    personality,
    personalitySummary: copy.personalitySummary,
    playstyleSummary: copy.playstyleSummary,
    strength: copy.strength,
    weakness: copy.weakness,
    identity: null,
    creationSelections: normalizeSelections(body.creationSelections),
    visualDirty: true,
    pfpStatus: "AWAITING_REGENERATION",
    concepts: [],
    conceptSalt: 0,
    selectedConceptId: null,
    status: "GENERATING_IDENTITY",
    sheet: null,
    roster: "user",
    createdAt: now,
    updatedAt: now,
  };
  const first = conceptVariant(draft, 0, 0, occupied(ctx.brands), "all", null);
  if (!first) {
    throw creatorError("uniqueness_exhausted", "Could not find a distinct identity. Try another name or archetype.", 409);
  }
  draft.identity = {
    title: first.title,
    tagline: first.tagline,
    archetype,
    personalitySummary: copy.personalitySummary,
    playstyleSummary: copy.playstyleSummary,
    visualIdentity: first.visualIdentity,
  };
  return draft;
}

function buildConcepts(draft, opts = {}) {
  const count = Math.max(3, Math.min(5, Number(opts.count) || 4));
  const salt = Number.isFinite(opts.salt) ? opts.salt : (draft.conceptSalt || 0);
  const vary = opts.vary || "all";
  const anchor = opts.anchor || null;
  const occ = occupied(opts.brands);
  const concepts = [];
  const local = {
    titles: [],
    emblems: new Set(),
    palettes: [],
    names: [],
  };
  for (let i = 0; i < count; i++) {
    const merged = {
      titles: [...occ.titles, ...local.titles],
      emblems: new Set([...occ.emblems, ...local.emblems]),
      palettes: [...occ.palettes, ...local.palettes],
      names: occ.names,
    };
    const row = conceptVariant(draft, i, salt + i, merged, i === 0 ? vary : "all", i === 0 ? anchor : null);
    if (!row) break;
    local.titles.push(row.title);
    local.emblems.add(row.emblem);
    local.palettes.push({ visualIdentity: row.visualIdentity });
    concepts.push(attachPfp(draft, row, i, "standard"));
  }
  if (concepts.length < 3) {
    throw creatorError("uniqueness_exhausted", "Could not make three distinct concepts. Try a different direction.", 409);
  }
  return concepts;
}

function sheetFor(draft, concept) {
  const personality = draft.personality;
  const aggression = clamp01(personality.aggression);
  const chaos = clamp01(personality.chaos * 0.55 + personality.bluffing * 0.35 + (1 - personality.discipline) * 0.1);
  return {
    id: draft.id,
    name: draft.name,
    archetype: draft.archetypeLabel,
    style: styleOf(personality, draft.archetypeLabel),
    aggression: Math.round(aggression * 1000) / 1000,
    chaos: Math.round(chaos * 1000) / 1000,
    hue: hexHue(concept.visualIdentity.primaryColor),
    line: draft.playstyleSummary,
    weakness: draft.weakness,
    strength: draft.strength,
    roster: "user",
    note: draft.shortDescription,
  };
}

function shiftHex(hex, step) {
  const raw = String(hex || "").replace("#", "");
  const n = parseInt(raw, 16);
  if (!Number.isFinite(n)) return "#4AD7FF";
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const t = 0.16 + step * 0.07;
  const next = channels.map((c) => {
    const target = step % 2 ? 255 : 0;
    return Math.max(0, Math.min(255, Math.round(c + (target - c) * t)));
  });
  return "#" + next.map((c) => c.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function nextBrandVersion(current) {
  const n = Number(String(current || "v0").replace(/\D/g, "")) || 0;
  return `v${n + 1}`;
}

// Numeric version of the next brand. Legacy brands carry only brandVersion
// ("v1") with no numeric `version`; both are honoured so keys never collide.
function nextVersionNumber(previous) {
  if (!previous) return 1;
  const numeric = Number(previous.version) || 0;
  const tagged = Number(String(previous.brandVersion || "").replace(/\D/g, "")) || 0;
  return Math.max(numeric, tagged) + 1;
}

function visualForPortrait(draft, selections, pool) {
  const base = { ...((draft.identity && draft.identity.visualIdentity) || {}) };
  const mapped = mapSelections(selections);
  const visual = {
    ...base,
    silhouette: mapped.silhouette,
    facialAttitude: mapped.attitude,
    accentColor: mapped.accent,
  };
  const others = Array.isArray(pool) ? pool : [];
  for (let i = 0; i < 8; i++) {
    visual.accentColor = i === 0 ? mapped.accent : shiftHex(mapped.accent, i);
    const near = others.some((brand) => brand && brand.agentId !== draft.id && paletteNear(brand, { visualIdentity: visual }));
    if (!near) return visual;
  }
  return visual;
}

function portraitAssets(agentId, version) {
  const urls = assetUrls(agentId);
  const stamp = (url) => withBrandVersion(url, { version });
  return {
    heroPortrait: null,
    avatar: stamp(urls.avatar),
    emblem: `/api/show/agents/${encodeURIComponent(agentId)}/emblem.svg`,
    introCard: null,
    victoryCard: null,
    defeatCard: null,
    shareTemplate: null,
    pfpPortrait: stamp(urls.master),
    canonicalPfp: stamp(urls.master),
    avatar48: stamp(urls.sizes["48"]),
    avatar96: stamp(urls.sizes["96"]),
    avatar160: stamp(urls.sizes["160"]),
    avatar256: stamp(urls.sizes["256"]),
    avatar320: stamp(urls.sizes["320"]),
    avatar512: stamp(urls.sizes["512"]),
  };
}

function generationFailure(err) {
  const error = creatorError("generation_failed", "Portrait generation failed. The last portrait was kept.", 502);
  error.cause = err;
  return error;
}

async function renderCanonicalPortrait(draft, opts = {}) {
  if (!draft || !draft.identity || !draft.identity.visualIdentity) {
    throw creatorError("brand_not_ready", "Create the agent before generating a portrait.", 409);
  }
  const selections = normalizeSelections(opts.selections || draft.creationSelections);
  const currentBrandVersion = Number(opts.currentVersion || 0);
  const version = Number(opts.version) || nextVersionNumber(opts.previous) || (currentBrandVersion + 1);
  console.log("PFP_GENERATION_START", {
    agentId: draft.id,
    selections,
    currentBrandVersion,
    version,
  });
  const visual = visualForPortrait(draft, selections, opts.brands || []);
  const archetype = selections.archetype || draft.archetype;
  const visualDNA = composeVisualDNA({ archetype, visual });
  const agent = {
    name: draft.name,
    title: draft.identity.title,
    archetype,
    brand: { visualDNA },
  };
  const seed = buildSeed(`${draft.id}_b${version}`, STYLE_VERSION);
  const finalPrompt = promptForAgent({
    agent,
    styleId: PFP_STYLE_ID,
    selections,
    variation: 0,
    treatment: "standard",
  });
  const provider = opts.provider || imageProvider;
  let generated = null;
  try {
    generated = await provider.generate({
      prompt: finalPrompt,
      seed,
      width: 1024,
      height: 1024,
      agent,
      visualDNA,
      archetype,
      selections,
    });
  } catch (err) {
    throw generationFailure(err);
  }
  const buffer = generated && generated.buffer;
  console.log("PFP_GENERATOR_RESULT", {
    agentId: draft.id,
    hasImage: Boolean(buffer && buffer.length),
    existingProviderMetadata: generated ? {
      provider: generated.provider || null,
      mime: generated.mime || null,
      model: generated.model || null,
      width: generated.width || null,
      height: generated.height || null,
    } : null,
  });
  if (!buffer || !buffer.length) {
    throw creatorError("generation_failed", "PFP generation did not produce a persisted canonical image.", 502);
  }
  let manifest;
  try {
    manifest = await savePortrait({
      root: opts.assetRoot,
      agentId: draft.id,
      version,
      buffer,
      model: generated.model || generated.provider || "unknown",
      prompt: finalPrompt,
      seed,
      visualDNA,
      agentName: draft.name,
    });
  } catch (err) {
    throw generationFailure(err);
  }
  return {
    svg: null,
    version,
    manifest,
    recipe: {
      selections,
      conceptVariant: 0,
      seed,
      styleId: PFP_STYLE_ID,
      safeZone: { circle: 0.86, face: { x: 0.28, y: 0.17, w: 0.44, h: 0.52 } },
      visualDNA,
    },
    visual,
    prompt: finalPrompt,
    quality: { ok: true, reasons: [] },
    selections,
    metadata: {
      provider: generated.provider || "neon-competitive",
      model: manifest.model,
      mime: "image/webp",
      width: 1024,
      height: 1024,
      seed,
    },
  };
}

function buildPortraitBrand(draft, portrait, previous) {
  const selections = portrait.selections || normalizeSelections(draft.creationSelections);
  const version = Number(portrait.version) || nextVersionNumber(previous);
  const stamp = new Date().toISOString();
  const assetId = `pfp_${draft.id}_v${version}`;
  const assets = portraitAssets(draft.id, version);
  const material = portrait.visual.materialLanguage || ["carbon", "glass"];
  const brand = {
    agentId: draft.id,
    brandVersion: `v${version}`,
    version,
    pfpVariation: Number(portrait.recipe && portrait.recipe.conceptVariant) || 0,
    name: draft.name,
    title: draft.identity.title,
    tagline: draft.identity.tagline,
    archetype: draft.archetype,
    personality: { ...draft.personality },
    visualIdentity: {
      ...portrait.visual,
      materialLanguage: material.slice(),
    },
    creationSelections: { ...selections },
    styleId: PFP_STYLE_ID,
    styleVersion: "v1",
    visualDirty: false,
    status: "READY",
    primaryPfpAssetId: assetId,
    selectedConceptId: draft.selectedConceptId || null,
    pfpStyleVersion: PFP_STYLE_VERSION,
    pfpPromptVersion: "neon-character-v1",
    pfpSafeZone: portrait.recipe.safeZone,
    avatarCrop: {
      sizes: AVATAR_SIZES.slice(),
      sourceAssetType: ASSET_TYPE,
      sourceAssetId: assetId,
      method: "uniform-scale",
    },
    pfpRecipe: portrait.recipe,
    assets,
    generation: {
      ...generationStamp({
        status: "READY",
        at: stamp,
        modelVersion: MODEL_VERSION,
        assetStatus: { pfpPortrait: "READY", avatar: "READY" },
      }),
      styleId: PFP_STYLE_ID,
      styleVersion: "v1",
      promptVersion: "neon-character-v1",
      selections: { ...selections },
      generatedAt: Date.now(),
      ...(portrait.metadata || {}),
    },
    animatedPfp: {
      version,
      engine: "neon-competitive",
      enabled: false,
      sourceCanonicalPfp: assets.canonicalPfp,
      manifestUrl: null,
      motionProfile: "NEON_COMPETITIVE",
    },
  };
  const check = validateBrand(brand);
  if (!check.ok) {
    const err = creatorError("invalid_brand", "The portrait could not be saved.");
    err.errors = check.errors;
    throw err;
  }
  if (!brand.assets.canonicalPfp) {
    throw creatorError("generation_failed", "PFP generation did not produce a persisted canonical image.", 502);
  }
  return { brand, sheet: sheetFor(draft, { visualIdentity: brand.visualIdentity, title: brand.title, tagline: brand.tagline }) };
}

function lockBrand(draft, concept, at, previous) {
  const stamp = at || new Date().toISOString();
  const portrait = concept.pfp || attachPfp(draft, concept, Math.max(0, (concept.conceptNumber || 1) - 1), "standard").pfp;
  const selections = normalizeSelections(concept.creationSelections || draft.creationSelections);
  const version = nextVersionNumber(previous);
  const variation = Number.isFinite(Number(concept.pfpVariation)) ? Number(concept.pfpVariation)
    : (Number(portrait.recipe && portrait.recipe.conceptVariant) || 0);
  const assets = portraitAssets(draft.id, version);
  console.log("PFP_CONCEPT_SELECTED", { agentId: draft.id, conceptId: concept.id, variation, version, selections });
  const brand = {
    agentId: draft.id,
    brandVersion: `v${version}`,
    version,
    pfpVariation: variation,
    creationSelections: { ...selections },
    styleId: PFP_STYLE_ID,
    styleVersion: "v1",
    visualDirty: false,
    status: "READY",
    name: draft.name,
    title: concept.title,
    tagline: concept.tagline,
    archetype: draft.archetype,
    personality: { ...draft.personality },
    visualIdentity: {
      ...concept.visualIdentity,
      materialLanguage: concept.visualIdentity.materialLanguage.slice(),
    },
    primaryPfpAssetId: portrait.assetId,
    selectedConceptId: concept.id,
    pfpStyleVersion: portrait.styleVersion,
    pfpPromptVersion: portrait.promptVersion,
    pfpSafeZone: portrait.safeZone,
    avatarCrop: {
      sizes: AVATAR_SIZES.slice(),
      sourceAssetType: ASSET_TYPE,
      sourceAssetId: portrait.assetId,
      method: "uniform-scale",
    },
    pfpRecipe: portrait.recipe,
    assets,
    generation: {
      ...generationStamp({
        status: "READY",
        at: stamp,
        modelVersion: MODEL_VERSION,
        assetStatus: { pfpPortrait: "READY", avatar: "READY" },
      }),
      styleId: PFP_STYLE_ID,
      styleVersion: "v1",
      promptVersion: PFP_PROMPT_VERSION,
      selections: { ...selections },
      conceptId: concept.id,
      variation,
      generatedAt: Date.now(),
      provider: "neon-competitive",
      model: "neon-competitive-local",
      mime: "image/svg+xml",
      portrait: "local",
    },
    animatedPfp: {
      version,
      engine: "neon-competitive",
      enabled: false,
      sourceCanonicalPfp: assets.canonicalPfp,
      manifestUrl: null,
      motionProfile: "NEON_COMPETITIVE",
    },
  };
  const check = validateBrand(brand);
  if (!check.ok) {
    const err = creatorError("invalid_brand", "The selected concept could not be locked.");
    err.errors = check.errors;
    throw err;
  }
  return { brand, sheet: sheetFor(draft, concept) };
}

function publicDraft(draft) {
  if (!draft) return null;
  return {
    id: draft.id,
    name: draft.name,
    shortDescription: draft.shortDescription,
    archetype: draft.archetype,
    archetypeLabel: draft.archetypeLabel,
    visualDirection: draft.visualDirection,
    personality: draft.personality,
    personalitySummary: draft.personalitySummary,
    playstyleSummary: draft.playstyleSummary,
    status: draft.status,
    roster: "user",
    identity: draft.identity,
    creationSelections: draft.creationSelections || normalizeSelections(null),
    visualDirty: draft.visualDirty === true,
    pfpStatus: draft.pfpStatus || null,
    concepts: draft.concepts,
    selectedConceptId: draft.selectedConceptId,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  };
}

module.exports = {
  ARCHETYPE_IDS,
  SLIDER_KEYS,
  OPTIONAL_SLIDERS,
  EMBLEM_IDS,
  MODEL_VERSION,
  PFP_TOUCHES,
  ROSTER_CAP,
  SAFE_TITLES,
  archetypeLabel,
  humanize,
  emblemSvg,
  createDraft,
  normalizeDisplayName,
  buildConcepts,
  retouchConcepts,
  lockBrand,
  renderCanonicalPortrait,
  buildPortraitBrand,
  visualOptionGroups,
  normalizeSelections,
  publicDraft,
  creatorError,
  hexHue,
};
