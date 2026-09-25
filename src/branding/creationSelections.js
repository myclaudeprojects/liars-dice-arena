// Character options for Create Agent. These ids drive the existing
// procedural portrait rig. They are not a second image provider.

const ARCHETYPE_IDS = Object.freeze([
  "executive", "street", "athlete", "celebrity", "tech", "criminal",
  "antihero", "comedian", "animal", "primal", "robot_ai", "experimental",
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
]);

const PALETTE_IDS = Object.freeze([
  "red", "blue", "purple", "pink", "green", "orange", "gold", "cyan",
  "yellow", "monochrome", "multi",
]);

const BACKGROUND_IDS = Object.freeze([
  "city_night", "underground", "club", "casino", "studio", "tech_lab",
  "vault", "arena", "space", "abstract", "custom",
]);

const ACCESSORY_IDS = Object.freeze([
  "glasses", "hat_cap", "mask", "headphones", "smoke", "jewelry",
  "scar_tattoo", "pet", "prop", "unique_fx", "none",
]);

const GROUPS = Object.freeze({
  archetype: ARCHETYPE_IDS,
  bodyType: BODY_TYPE_IDS,
  expression: EXPRESSION_IDS,
  attire: ATTIRE_IDS,
  colorPalette: PALETTE_IDS,
  background: BACKGROUND_IDS,
  accessories: ACCESSORY_IDS,
});

const GROUP_LABELS = Object.freeze({
  archetype: "Archetype",
  bodyType: "Body type",
  expression: "Expression",
  attire: "Attire",
  colorPalette: "Color palette",
  background: "Background",
  accessories: "Accessories",
});

const DEFAULT_SELECTIONS = Object.freeze({
  archetype: "executive",
  bodyType: "male_lean",
  expression: "confident",
  attire: "formal",
  colorPalette: "cyan",
  background: "abstract",
  accessories: "none",
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
  if (s.archetype === "executive" || s.archetype === "tech") return "swept";
  return "swept";
}

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
    turn: TURN[selections.expression] || 0,
    hair: hairOf(selections, species),
    headwear: headwearOf(selections, species),
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
  const lockedHair = mapped.hair === "none" || mapped.headwear === "hood";
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
  return base;
}

function visualOptionGroups() {
  return Object.keys(GROUPS).map((id) => ({
    id,
    label: GROUP_LABELS[id],
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
  previewSelections,
};
