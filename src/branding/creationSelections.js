// Character options for Create Agent. These ids drive the existing
// procedural portrait rig. They are not a second image provider.

const ARCHETYPE_IDS = Object.freeze([
  "executive", "street", "athlete", "celebrity", "tech", "criminal",
  "antihero", "comedian", "animal", "primal", "robot_ai", "experimental",
  "gambler", "dealer", "hacker", "royalty",
]);

const BODY_TYPE_IDS = Object.freeze([
  "male_lean", "male_muscular", "female_lean", "female_athletic", "androgynous",
  "heavy_set", "elder", "young_adult", "non_human", "full_robot", "skeletal_synthetic",
]);

const EXPRESSION_IDS = Object.freeze([
  "calm", "confident", "aggressive", "playful", "mysterious", "intense",
  "intellectual", "laid_back", "cocky", "serious", "unhinged",
]);

const ATTIRE_IDS = Object.freeze([
  "formal", "casual", "streetwear", "sports", "tactical", "luxury",
  "business", "hood_mask", "performance_costume", "cyber_gear", "minimal",
  "trench_coat", "bomber_jacket", "robe", "plate_armor",
]);

const PALETTE_IDS = Object.freeze([
  "red", "blue", "purple", "pink", "green", "orange", "gold", "cyan",
  "yellow", "monochrome", "multi",
]);

const BACKGROUND_IDS = Object.freeze([
  "city_night", "underground", "club", "casino", "studio", "tech_lab",
  "vault", "arena", "space", "abstract", "custom",
  "dice_table", "rooftop", "boardroom", "neon_alley", "bunker",
]);

const ACCESSORY_IDS = Object.freeze([
  "glasses", "hat_cap", "mask", "headphones", "smoke", "jewelry",
  "scar_tattoo", "pet", "prop", "unique_fx", "none",
  "dice", "chips", "cards", "cigar",
]);

// ---- second-tier groups. "auto" means "derive it the old way", so every agent
// created before these existed renders exactly as it did.
const SKIN_TONE_IDS = Object.freeze(["auto", "porcelain", "fair", "olive", "tan", "brown", "deep", "ebony", "synthetic"]);
const HAIR_STYLE_IDS = Object.freeze(["auto", "bald", "buzz", "cropped", "swept", "undercut", "asymmetric", "long", "wild", "braids", "mohawk", "bun"]);
const HAIR_COLOR_IDS = Object.freeze(["auto", "black", "brown", "blond", "red", "silver", "white", "neon", "dipped"]);
const EYE_IDS = Object.freeze(["auto", "brown", "hazel", "green", "blue", "gray", "glow", "heterochromia"]);
const FACIAL_HAIR_IDS = Object.freeze(["auto", "none", "stubble", "goatee", "beard", "mustache"]);
const HEADWEAR_IDS = Object.freeze(["auto", "none", "cap", "beanie", "crown", "hood", "helmet", "halo", "bandana", "visor"]);
const POSE_IDS = Object.freeze(["auto", "facing", "quarter_left", "quarter_right", "chin_up", "chin_down"]);
const FX_IDS = Object.freeze(["none", "halo_ring", "scanlines", "glitch", "embers", "rain", "haze", "chip_storm"]);

const GROUPS = Object.freeze({
  archetype: ARCHETYPE_IDS,
  bodyType: BODY_TYPE_IDS,
  expression: EXPRESSION_IDS,
  attire: ATTIRE_IDS,
  colorPalette: PALETTE_IDS,
  background: BACKGROUND_IDS,
  accessories: ACCESSORY_IDS,
  skinTone: SKIN_TONE_IDS,
  hairStyle: HAIR_STYLE_IDS,
  hairColor: HAIR_COLOR_IDS,
  eyes: EYE_IDS,
  facialHair: FACIAL_HAIR_IDS,
  headwear: HEADWEAR_IDS,
  pose: POSE_IDS,
  fx: FX_IDS,
});

// How the option UI clusters the groups.
const GROUP_SECTIONS = Object.freeze([
  { id: "identity", label: "Identity", groups: ["archetype", "bodyType", "skinTone", "expression", "pose"] },
  { id: "face", label: "Hair & face", groups: ["hairStyle", "hairColor", "facialHair", "eyes", "headwear"] },
  { id: "look", label: "Look", groups: ["attire", "colorPalette", "accessories"] },
  { id: "scene", label: "Scene", groups: ["background", "fx"] },
]);

const GROUP_LABELS = Object.freeze({
  archetype: "Archetype",
  bodyType: "Body type",
  expression: "Expression",
  attire: "Attire",
  colorPalette: "Color palette",
  background: "Background",
  accessories: "Accessories",
  skinTone: "Skin tone",
  hairStyle: "Hair style",
  hairColor: "Hair color",
  eyes: "Eyes",
  facialHair: "Facial hair",
  headwear: "Headwear",
  pose: "Pose",
  fx: "Effects",
});

const DEFAULT_SELECTIONS = Object.freeze({
  archetype: "executive",
  bodyType: "male_lean",
  expression: "confident",
  attire: "formal",
  colorPalette: "cyan",
  background: "abstract",
  accessories: "none",
  skinTone: "auto",
  hairStyle: "auto",
  hairColor: "auto",
  eyes: "auto",
  facialHair: "auto",
  headwear: "auto",
  pose: "auto",
  fx: "none",
});

const PALETTE_HEX = Object.freeze({
  red: "#F43B5F",
  blue: "#3B82F6",
  purple: "#8D63FF",
  pink: "#F25CA2",
  green: "#3DDC97",
  orange: "#FF8A3D",
  gold: "#FFC247",
  cyan: "#4AD7FF",
  yellow: "#FFE14A",
  monochrome: "#E6E7EE",
  multi: "#4AD7FF",
});

const ATTITUDE = Object.freeze({
  calm: "SERENE",
  confident: "REGAL",
  aggressive: "PREDATORY",
  playful: "PLAYFUL",
  mysterious: "MYSTERIOUS",
  intense: "COLD",
  intellectual: "STOIC",
  laid_back: "SMUG",
  cocky: "SMUG",
  serious: "STOIC",
  unhinged: "MANIC",
});

const INTENSITY = Object.freeze({
  calm: 0.85,
  confident: 1.15,
  aggressive: 1.65,
  playful: 1.35,
  mysterious: 1.2,
  intense: 1.45,
  intellectual: 1,
  laid_back: 1.05,
  cocky: 1.4,
  serious: 1.05,
  unhinged: 1.85,
});

const TURN = Object.freeze({
  calm: 0,
  confident: 0,
  aggressive: 1,
  playful: -1,
  mysterious: -1,
  intense: 1,
  intellectual: 0,
  laid_back: -1,
  cocky: 1,
  serious: 0,
  unhinged: 1,
});

function optionLabel(id) {
  return String(id || "").replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function pick(list, value, fallback) {
  return list.includes(value) ? value : fallback;
}

function normalizeSelections(input) {
  const src = input && typeof input === "object" ? input : {};
  return {
    archetype: pick(ARCHETYPE_IDS, src.archetype, DEFAULT_SELECTIONS.archetype),
    bodyType: pick(BODY_TYPE_IDS, src.bodyType, DEFAULT_SELECTIONS.bodyType),
    expression: pick(EXPRESSION_IDS, src.expression, DEFAULT_SELECTIONS.expression),
    attire: pick(ATTIRE_IDS, src.attire, DEFAULT_SELECTIONS.attire),
    colorPalette: pick(PALETTE_IDS, src.colorPalette, DEFAULT_SELECTIONS.colorPalette),
    background: pick(BACKGROUND_IDS, src.background, DEFAULT_SELECTIONS.background),
    accessories: pick(ACCESSORY_IDS, src.accessories, DEFAULT_SELECTIONS.accessories),
    skinTone: pick(SKIN_TONE_IDS, src.skinTone, DEFAULT_SELECTIONS.skinTone),
    hairStyle: pick(HAIR_STYLE_IDS, src.hairStyle, DEFAULT_SELECTIONS.hairStyle),
    hairColor: pick(HAIR_COLOR_IDS, src.hairColor, DEFAULT_SELECTIONS.hairColor),
    eyes: pick(EYE_IDS, src.eyes, DEFAULT_SELECTIONS.eyes),
    facialHair: pick(FACIAL_HAIR_IDS, src.facialHair, DEFAULT_SELECTIONS.facialHair),
    headwear: pick(HEADWEAR_IDS, src.headwear, DEFAULT_SELECTIONS.headwear),
    pose: pick(POSE_IDS, src.pose, DEFAULT_SELECTIONS.pose),
    fx: pick(FX_IDS, src.fx, DEFAULT_SELECTIONS.fx),
  };
}

function speciesOf(selections) {
  const s = normalizeSelections(selections);
  if (s.bodyType === "skeletal_synthetic") return "skeletal";
  if (s.bodyType === "full_robot" || s.archetype === "robot_ai") return "robot";
  if (s.archetype === "animal" || s.bodyType === "non_human") return "animal";
  if (s.archetype === "primal") return "primal";
  return "human";
}

function silhouetteOf(selections, species) {
  const s = normalizeSelections(selections);
  if (species === "robot" || species === "skeletal") return "MECHANICAL";
  if (s.bodyType === "male_muscular" || s.bodyType === "heavy_set" || s.bodyType === "female_athletic") return "BROAD_IMPOSING";
  if (s.bodyType === "male_lean" || s.bodyType === "female_lean" || s.bodyType === "young_adult" || s.bodyType === "elder") return "SLIM_ELEGANT";
  if (s.archetype === "experimental" || s.archetype === "comedian") return "ASYMMETRIC_CHAOTIC";
  if (s.archetype === "royalty" || s.archetype === "dealer" || s.archetype === "gambler") return "SLIM_ELEGANT";
  return "COMPACT_AGGRESSIVE";
}

function hairOf(selections, species) {
  const s = normalizeSelections(selections);
  if (species === "robot" || species === "skeletal" || species === "animal") return "none";
  if (s.attire === "hood_mask") return "none";
  if (s.bodyType === "elder") return "cropped";
  if (s.bodyType === "female_lean" || s.bodyType === "female_athletic" || s.archetype === "celebrity") return "long";
  if (s.archetype === "street" || s.archetype === "experimental" || s.archetype === "criminal") return "asymmetric";
  if (species === "primal" || s.archetype === "antihero") return "wild";
  if (s.bodyType === "male_muscular" || s.bodyType === "young_adult") return "cropped";
  if (s.archetype === "executive" || s.archetype === "tech" || s.archetype === "dealer") return "swept";
  if (s.archetype === "hacker") return "asymmetric";
  if (s.archetype === "royalty") return "long";
  return "swept";
}

// Explicit choices override the derived defaults ("auto").
function resolveHair(selections, species) {
  const s = normalizeSelections(selections);
  if (s.hairStyle === "auto") return hairOf(s, species);
  if (species === "robot" || species === "skeletal") return "none";
  return s.hairStyle === "bald" ? "none" : s.hairStyle;
}
function resolveHeadwear(selections, species) {
  const s = normalizeSelections(selections);
  if (s.headwear === "auto") return s.archetype === "royalty" ? "crown" : headwearOf(s, species);
  if (s.headwear === "none") return species === "animal" ? "ears" : "";
  return s.headwear;
}
const POSE_TURN = Object.freeze({ facing: 0, quarter_left: -1, quarter_right: 1, chin_up: 0, chin_down: 0 });
const POSE_TILT = Object.freeze({ chin_up: -1, chin_down: 1 });

function headwearOf(selections, species) {
  const s = normalizeSelections(selections);
  if (s.attire === "hood_mask" || s.archetype === "antihero") return "hood";
  if (s.accessories === "hat_cap") return "cap";
  if (species === "animal") return "ears";
  return "";
}

function mapSelections(input) {
  const selections = normalizeSelections(input);
  const species = speciesOf(selections);
  return {
    selections,
    species,
    faceKind: selections.bodyType,
    archetype: selections.archetype,
    silhouette: silhouetteOf(selections, species),
    attitude: ATTITUDE[selections.expression] || "STOIC",
    intensity: INTENSITY[selections.expression] || 1,
    turn: selections.pose !== "auto" ? (POSE_TURN[selections.pose] || 0) : (TURN[selections.expression] || 0),
    hair: resolveHair(selections, species),
    headwear: resolveHeadwear(selections, species),
    hairLocked: selections.hairStyle !== "auto",
    skinTone: selections.skinTone,
    hairColor: selections.hairColor,
    eyes: selections.eyes,
    facialHair: selections.facialHair,
    pose: selections.pose,
    tilt: POSE_TILT[selections.pose] || 0,
    fx: selections.fx,
    accent: PALETTE_HEX[selections.colorPalette] || PALETTE_HEX.cyan,
    secondaryAccent: selections.colorPalette === "multi" ? "#F43B5F" : "",
    attire: selections.attire,
    accessory: selections.accessories,
    background: selections.background,
    expression: selections.expression,
    age: selections.bodyType === "elder" ? "elder" : selections.bodyType === "young_adult" ? "young" : "adult",
    augment: selections.archetype === "tech" && species === "human",
    palette: selections.colorPalette,
  };
}

// Concept variation. The user's seven selections are the identity; a concept
// index (0..n) must still produce a visibly different portrait *within* those
// selections: hair, head turn, expression intensity, jaw, glow. Deterministic,
// so the same (selections, variant) always renders the same character.
const HUMAN_HAIR = Object.freeze(["swept", "cropped", "asymmetric", "long", "wild"]);
function conceptVariantFor(mapped, variant) {
  const v = Math.abs(Math.floor(Number(variant) || 0));
  if (!mapped || v === 0) return { variant: 0, hair: mapped ? mapped.hair : "swept", turn: mapped ? mapped.turn : 0, intensity: mapped ? mapped.intensity : 1, jawShift: 0, glowShift: 0 };
  const lockedHair = mapped.hair === "none" || mapped.headwear === "hood" || mapped.hairLocked;
  let hair = mapped.hair;
  if (!lockedHair) {
    const pool = HUMAN_HAIR.filter((h) => h !== mapped.hair);
    hair = pool[(v * 7 + 3) % pool.length];
  }
  const turnShift = [0, 1, -1][(v * 5) % 3];
  const turn = Math.max(-1, Math.min(1, (mapped.turn || 0) + turnShift)) || (turnShift === 0 ? -(mapped.turn || 0) || 0 : 0);
  const intensity = (mapped.intensity || 1) * [1, 1.18, 0.86, 1.08, 0.94][(v * 3) % 5];
  const jawShift = [0, 10, -12, 6, -6][(v * 11) % 5];
  const glowShift = [0, 0.12, -0.08, 0.06][(v * 13) % 4];
  return { variant: v, hair, turn, intensity: Math.round(intensity * 100) / 100, jawShift, glowShift };
}

function paletteForHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return "";
  const n = parseInt(m[1], 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  let best = "";
  let bestD = Infinity;
  for (const id of PALETTE_IDS) {
    if (id === "multi") continue;
    const pm = /^#([0-9a-f]{6})$/i.exec(PALETTE_HEX[id] || "");
    if (!pm) continue;
    const pn = parseInt(pm[1], 16);
    const pr = [(pn >> 16) & 255, (pn >> 8) & 255, pn & 255];
    const d = (rgb[0] - pr[0]) ** 2 + (rgb[1] - pr[1]) ** 2 + (rgb[2] - pr[2]) ** 2;
    if (d < bestD) { bestD = d; best = id; }
  }
  return best;
}

function inferSelectionsFromBrand(brand) {
  const row = brand && typeof brand === "object" ? brand : {};
  const stored = row.creationSelections || (row.generation && row.generation.selections);
  if (stored && stored.archetype) return normalizeSelections(stored);
  const archetype = String(row.archetype || "").toUpperCase();
  const base = normalizeSelections(null);
  if (/MACHINE/.test(archetype)) {
    base.archetype = "robot_ai";
    base.bodyType = "full_robot";
    base.attire = "cyber_gear";
    base.background = "tech_lab";
  } else if (/BEAST|PIRATE|SHARK|PREDATORY/.test(archetype)) {
    base.archetype = "animal";
    base.bodyType = "non_human";
    base.attire = "minimal";
  } else if (/REAPER|PHANTOM|SPECTRAL/.test(archetype)) {
    base.archetype = "antihero";
    base.attire = "hood_mask";
    base.expression = "mysterious";
    base.background = "underground";
  } else if (/COMMANDER|EMPEROR|JUDGE|NOBLE|IMPERIAL|AEGIS/.test(archetype)) {
    base.archetype = "executive";
    base.attire = "formal";
    base.expression = "serious";
  } else if (/TRICKSTER|MADMAN|JESTER/.test(archetype)) {
    base.archetype = "comedian";
    base.expression = "playful";
    base.attire = "performance_costume";
  } else if (/ORACLE|MONK|SORCERER|ALCHEMIST/.test(archetype)) {
    base.archetype = "tech";
    base.expression = "intellectual";
    base.background = "studio";
  } else if (/GAMBLER|GOTHIC/.test(archetype)) {
    base.archetype = "celebrity";
    base.attire = "luxury";
    base.expression = "cocky";
    base.colorPalette = "red";
  } else if (/DUELIST|WARLORD|ASSASSIN/.test(archetype)) {
    base.archetype = "criminal";
    base.attire = "tactical";
    base.expression = "intense";
  }
  const accent = row.visualIdentity && row.visualIdentity.accentColor;
  const palette = paletteForHex(accent);
  if (palette) base.colorPalette = palette;
  return base;
}

function visualOptionGroups() {
  const sectionOf = (id) => (GROUP_SECTIONS.find((sec) => sec.groups.includes(id)) || {}).id || "identity";
  return Object.keys(GROUPS).map((id) => ({
    id,
    label: GROUP_LABELS[id],
    section: sectionOf(id),
    options: GROUPS[id].map((optionId) => ({
      id: optionId,
      label: optionLabel(optionId),
      preview: `/assets/agent-creation-previews/${id}/${optionId}.svg`,
    })),
  }));
}

function previewSelections(group, id) {
  const selections = normalizeSelections(null);
  if (!Object.prototype.hasOwnProperty.call(GROUPS, group)) return null;
  if (!GROUPS[group].includes(id)) return null;
  selections[group] = id;
  if (group === "facialHair" || group === "hairStyle" || group === "hairColor") { selections.bodyType = "male_lean"; selections.headwear = "none"; }
  if (group === "hairColor" && id !== "auto") selections.hairStyle = "long";
  if (group === "skinTone") { selections.hairStyle = "buzz"; selections.accessories = "none"; }
  if (group === "eyes") { selections.expression = "intense"; selections.accessories = "none"; }
  if (group === "headwear") { selections.hairStyle = "cropped"; }
  if (group === "fx") { selections.background = "studio"; }
  if (group === "archetype") {
    if (id === "robot_ai") {
      selections.bodyType = "full_robot";
      selections.attire = "cyber_gear";
      selections.colorPalette = "cyan";
      selections.background = "tech_lab";
      selections.accessories = "unique_fx";
    } else if (id === "animal") {
      selections.bodyType = "non_human";
      selections.attire = "minimal";
      selections.colorPalette = "green";
      selections.background = "abstract";
    } else if (id === "primal") {
      selections.bodyType = "non_human";
      selections.attire = "minimal";
      selections.colorPalette = "orange";
    } else if (id === "athlete") {
      selections.bodyType = "female_athletic";
      selections.attire = "sports";
      selections.expression = "aggressive";
      selections.colorPalette = "orange";
      selections.background = "arena";
    } else if (id === "executive") {
      selections.bodyType = "male_lean";
      selections.attire = "formal";
      selections.expression = "confident";
      selections.colorPalette = "red";
      selections.accessories = "glasses";
      selections.background = "city_night";
    } else if (id === "street") {
      selections.bodyType = "young_adult";
      selections.attire = "streetwear";
      selections.accessories = "hat_cap";
      selections.colorPalette = "purple";
    } else if (id === "celebrity") {
      selections.bodyType = "female_lean";
      selections.attire = "luxury";
      selections.colorPalette = "pink";
      selections.accessories = "jewelry";
    } else if (id === "tech") {
      selections.bodyType = "androgynous";
      selections.attire = "cyber_gear";
      selections.colorPalette = "cyan";
      selections.background = "tech_lab";
    } else if (id === "criminal") {
      selections.bodyType = "male_muscular";
      selections.attire = "hood_mask";
      selections.colorPalette = "red";
      selections.accessories = "mask";
    } else if (id === "comedian") {
      selections.bodyType = "heavy_set";
      selections.expression = "playful";
      selections.attire = "performance_costume";
      selections.colorPalette = "yellow";
    } else if (id === "antihero") {
      selections.bodyType = "male_lean";
      selections.attire = "tactical";
      selections.expression = "intense";
      selections.colorPalette = "purple";
    } else if (id === "experimental") {
      selections.bodyType = "androgynous";
      selections.attire = "performance_costume";
      selections.expression = "unhinged";
      selections.colorPalette = "multi";
    }
  }
  if (group === "bodyType") {
    if (id === "full_robot" || id === "skeletal_synthetic") selections.archetype = "robot_ai";
    if (id === "non_human") selections.archetype = "animal";
    if (id === "female_athletic" || id === "female_lean") selections.archetype = "athlete";
    if (id === "elder") selections.archetype = "executive";
    if (id === "heavy_set") selections.archetype = "comedian";
  }
  return selections;
}

module.exports = {
  ARCHETYPE_IDS,
  BODY_TYPE_IDS,
  EXPRESSION_IDS,
  ATTIRE_IDS,
  PALETTE_IDS,
  BACKGROUND_IDS,
  ACCESSORY_IDS,
  GROUPS,
  GROUP_LABELS,
  DEFAULT_SELECTIONS,
  PALETTE_HEX,
  optionLabel,
  normalizeSelections,
  speciesOf,
  mapSelections,
  inferSelectionsFromBrand,
  conceptVariantFor,
  visualOptionGroups,
  GROUP_SECTIONS,
  previewSelections,
};
