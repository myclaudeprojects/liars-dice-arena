// Maps option ids onto a drawing spec the procedural portrait builder can render.
// Categories own different variables. Re-applying `emphasis` last is how a
// thumbnail locks every other category and still shows its own change.

const {
  CATEGORY_KEYS,
  DEFAULT_SELECTIONS,
  optionById,
} = require("./optionRegistry");

const EMOTIONS = Object.freeze({
  calm: Object.freeze({ squint: 0.18, wide: 0.04, brow: Object.freeze([4, 4]), mouth: "smile", turn: 0, intensity: 1, glow: 0 }),
  confident: Object.freeze({ squint: 0.28, wide: 0, brow: Object.freeze([14, -6]), mouth: "smirk", turn: 0, intensity: 1.15, glow: 0 }),
  aggressive: Object.freeze({ squint: 0.48, wide: 0, brow: Object.freeze([-16, -16]), mouth: "tight", turn: 1, intensity: 1.35, glow: 0.75 }),
  playful: Object.freeze({ squint: 0, wide: 0.22, brow: Object.freeze([20, 2]), mouth: "grin", turn: -1, intensity: 1.25, glow: 0 }),
  mysterious: Object.freeze({ squint: 0.26, wide: 0, brow: Object.freeze([2, 16]), mouth: "flat", wink: 0.9, turn: 1, intensity: 1.1, glow: 0.4 }),
  intense: Object.freeze({ squint: 0.55, wide: 0, brow: Object.freeze([-12, -12]), mouth: "tight", turn: 0, intensity: 1.45, glow: 0.9 }),
  intellectual: Object.freeze({ squint: 0.08, wide: 0, brow: Object.freeze([8, 8]), mouth: "flat", turn: 0, intensity: 1, glow: 0.15 }),
  laid_back: Object.freeze({ squint: 0.32, wide: 0.06, brow: Object.freeze([10, 0]), mouth: "smile", turn: -1, intensity: 0.95, glow: 0 }),
  cocky: Object.freeze({ squint: 0.36, wide: 0, brow: Object.freeze([22, -10]), mouth: "smirk", turn: 1, intensity: 1.3, glow: 0.2 }),
  serious: Object.freeze({ squint: 0.16, wide: 0, brow: Object.freeze([-6, -6]), mouth: "flat", turn: 0, intensity: 1.05, glow: 0 }),
  unhinged: Object.freeze({ squint: 0, wide: 0.42, brow: Object.freeze([24, -18]), mouth: "grin", turn: 1, intensity: 1.6, glow: 0.55 }),
});

const ATTITUDE = Object.freeze({
  calm: "SERENE",
  confident: "SMUG",
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

const ARCHETYPES = Object.freeze({
  executive: pack("sharp", -0.15, "structured", "TALL_SHARP", "suit", "swept", "swept", "glasses", "warm", "upright", "confident", "TAILORED_LAPEL", ["matte fabric", "glass", "metal"], "UPRIGHT_CONTROLLED", "SLOW_REGAL", false),
  street: pack("wide", 0.25, "relaxed", "COMPACT_AGGRESSIVE", "jacket", "cap", "cropped", "chain", "olive", "lean", "playful", "STREET_CAP", ["canvas", "metal"], "LOOSE_LEAN", "FAST_CONFIDENT", false),
  athlete: pack("angular", 0.4, "athletic", "BROAD_IMPOSING", "jersey", "headband", "cropped", "armband", "ember", "coiled", "intense", "HEADBAND", ["mesh", "elastic"], "FORWARD_WEIGHT", "FAST_CONFIDENT", false),
  celebrity: pack("oval", -0.35, "slim", "SLIM_ELEGANT", "fashion", "long", "long", "shades", "porcelain", "upright", "calm", "GLAMOUR_SHADE", ["silk", "glass"], "MEASURED_STANCE", "SLOW_REGAL", false),
  tech: pack("synthetic", 0, "mechanical", "MECHANICAL", "shell", "visor", "cropped", "earpiece", "ash", "upright", "intellectual", "VISOR_BAR", ["carbon", "glass"], "STILL_COMMAND", "MECHANICAL_PRECISE", false),
  criminal: pack("predatory", 0.5, "heavy", "COMPACT_AGGRESSIVE", "jacket", "bandana", "cropped", "scar", "deep", "forward", "aggressive", "SCAR_LINE", ["leather", "canvas"], "FORWARD_WEIGHT", "FAST_CONFIDENT", false),
  antihero: pack("sharp", 0.05, "hooded", "TALL_SHARP", "coat", "hood", "none", "mask", "olive", "lean", "mysterious", "SHADOW_HOOD", ["matte fabric", "smoke"], "LOOSE_LEAN", "CHAOTIC_UNEVEN", false),
  comedian: pack("exaggerated", 0.1, "asymmetric", "ASYMMETRIC_CHAOTIC", "casual", "asymmetric", "asymmetric", "glasses", "warm", "relaxed", "unhinged", "LOPSIDED_BROW", ["cotton", "plastic"], "OFF_BALANCE", "CHAOTIC_UNEVEN", false),
  animal: pack("snout", 0.35, "athletic", "COMPACT_AGGRESSIVE", "minimal", "ears", "wild", "collar", "ember", "coiled", "playful", "MASCOT_EARS", ["fur", "metal"], "COILED", "FAST_CONFIDENT", false),
  primal: pack("predatory", 0.55, "asymmetric", "ASYMMETRIC_CHAOTIC", "rugged", "wild", "wild", "claw", "deep", "forward", "aggressive", "CLAW_MARK", ["hide", "bone"], "FORWARD_WEIGHT", "CHAOTIC_UNEVEN", false),
  robot_ai: pack("synthetic", 0, "mechanical", "MECHANICAL", "mech", "none", "none", "optic", "metal", "upright", "serious", "OPTIC_LENS", ["brushed metal", "glass"], "STILL_COMMAND", "MECHANICAL_PRECISE", false),
  fantasy: pack("oval", -0.1, "slim", "SLIM_ELEGANT", "ornament", "crest", "long", "ornament", "porcelain", "upright", "calm", "NEON_ORNAMENT", ["silk", "glass", "metal"], "MEASURED_STANCE", "SLOW_REGAL", true),
});

const BODIES = Object.freeze({
  male_lean: body("sharp", -0.1, "slim", "TALL_SHARP", 0.75, "swept", "warm", "upright", "suit", "", false, 1, false),
  male_muscular: body("wide", 0.7, "broad", "BROAD_IMPOSING", 1.4, "cropped", "deep", "coiled", "jacket", "", false, 1, false),
  female_lean: body("oval", -0.5, "slim", "SLIM_ELEGANT", 0.68, "long", "porcelain", "upright", "fashion", "", false, 1.05, false),
  female_athletic: body("angular", 0.05, "athletic", "BROAD_IMPOSING", 0.9, "crest", "olive", "coiled", "jersey", "", false, 1, false),
  androgynous: body("oval", -0.05, "structured", "SLIM_ELEGANT", 0.82, "swept", "ash", "upright", "minimal", "", false, 1, false),
  heavy_set: body("round", 0.6, "heavy", "BROAD_IMPOSING", 1.55, "cropped", "warm", "relaxed", "jacket", "", false, 0.92, false),
  elder: body("weathered", 0.15, "slim", "TALL_SHARP", 0.8, "swept", "porcelain", "upright", "suit", "grey", true, 0.9, true),
  teen_young: body("round", -0.4, "slim", "SLIM_ELEGANT", 0.62, "swept", "warm", "relaxed", "casual", "", false, 1.32, false),
  non_human: body("snout", 0.45, "athletic", "COMPACT_AGGRESSIVE", 1.15, "wild", "ember", "coiled", "minimal", "", false, 1, false, "ears"),
  full_robot: body("synthetic", 0, "mechanical", "MECHANICAL", 1.05, "none", "metal", "upright", "mech", "", false, 1, false, "visor"),
  skeletal: body("skull", 0.2, "slim", "TALL_SHARP", 0.55, "none", "bone", "forward", "coat", "", false, 1.05, false, "none"),
});

const STRUCTURAL_BODIES = new Set(["non_human", "full_robot", "skeletal"]);

const ATTIRE = Object.freeze({
  formal: { wardrobe: "suit" },
  casual: { wardrobe: "casual" },
  streetwear: { wardrobe: "jacket" },
  sports: { wardrobe: "jersey" },
  tactical: { wardrobe: "tactical" },
  luxury: { wardrobe: "luxury" },
  business: { wardrobe: "business" },
  hood_mask: { wardrobe: "coat", headwear: "hood", accessory: "mask" },
  costume: { wardrobe: "costume" },
  cyber_gear: { wardrobe: "cyber" },
  minimal: { wardrobe: "minimal" },
});

const BACKGROUNDS = Object.freeze({
  city_night: "CITY_NIGHT",
  underground: "UNDERGROUND",
  club: "CLUB",
  casino: "CASINO",
  studio: "STUDIO",
  tech_lab: "TECH_LAB",
  vault: "VAULT",
  beach: "BEACH",
  space: "SPACE",
  abstract: "ABSTRACT",
  custom: "CUSTOM",
});

const LIGHTING = Object.freeze({
  red: "CRIMSON_NEON_RIM",
  blue: "COOL_NEON_EDGE",
  purple: "VIOLET_NEON_GLOW",
  pink: "MAGENTA_NEON_RIM",
  green: "SIGNAL_NEON_EDGE",
  orange: "AMBER_NEON_EDGE",
  gold: "AMBER_NEON_EDGE",
  cyan: "COOL_NEON_EDGE",
  yellow: "AMBER_NEON_EDGE",
  monochrome: "COOL_NEON_EDGE",
  multi: "VIOLET_NEON_GLOW",
});

function pack(face, jaw, shoulder, silhouette, wardrobe, headwear, hair, accessory, skin, pose, emotion, signatureFeature, materials, bodyLanguage, motionLanguage, pointedEar) {
  return Object.freeze({
    face, jaw, shoulder, silhouette, wardrobe, headwear, hair, accessory, skin, pose, emotion,
    signatureFeature, materials: Object.freeze(materials), bodyLanguage, motionLanguage, pointedEar,
  });
}

function body(face, jaw, shoulder, silhouette, neck, hair, skin, pose, wardrobe, hairTint, beard, eyeScale, ageLines, headwear) {
  return Object.freeze({
    face, jaw, shoulder, silhouette, neck, hair, skin, pose, wardrobe, hairTint, beard, eyeScale, ageLines, headwear: headwear || "",
  });
}

function blankSpec() {
  return {
    face: "sharp",
    jaw: 0,
    shoulder: "structured",
    silhouette: "TALL_SHARP",
    neck: 1,
    wardrobe: "suit",
    headwear: "swept",
    hair: "swept",
    hairTint: "",
    accessory: "glasses",
    skin: "warm",
    pose: "upright",
    attitude: "SMUG",
    emotion: { ...EMOTIONS.confident, brow: EMOTIONS.confident.brow.slice() },
    turn: 0,
    intensity: 1.15,
    eyeScale: 1,
    ageLines: false,
    beard: false,
    pointedEar: false,
    scar: false,
    tattoo: false,
    primary: "#120810",
    secondary: "#1A1016",
    accent: "#F43B5F",
    accent2: "",
    palette: "red",
    background: "city_night",
    motif: "CITY_NIGHT",
    lighting: "CRIMSON_NEON_RIM",
    signatureFeature: "TAILORED_LAPEL",
    materials: ["matte fabric", "glass", "metal"],
    bodyLanguage: "UPRIGHT_CONTROLLED",
    motionLanguage: "SLOW_REGAL",
  };
}

function applyEmotion(spec, id) {
  const emotion = EMOTIONS[id] || EMOTIONS.confident;
  spec.emotion = { ...emotion, brow: emotion.brow.slice() };
  spec.attitude = ATTITUDE[id] || "SMUG";
  spec.turn = emotion.turn;
  spec.intensity = emotion.intensity;
}

function applyArchetype(spec, id) {
  const row = ARCHETYPES[id] || ARCHETYPES.executive;
  spec.face = row.face;
  spec.jaw = row.jaw;
  spec.shoulder = row.shoulder;
  spec.silhouette = row.silhouette;
  spec.wardrobe = row.wardrobe;
  spec.headwear = row.headwear;
  spec.hair = row.hair;
  spec.accessory = row.accessory;
  spec.skin = row.skin;
  spec.pose = row.pose;
  spec.signatureFeature = row.signatureFeature;
  spec.materials = row.materials.slice();
  spec.bodyLanguage = row.bodyLanguage;
  spec.motionLanguage = row.motionLanguage;
  spec.pointedEar = row.pointedEar;
  spec.beard = false;
  spec.ageLines = false;
  spec.eyeScale = id === "comedian" ? 1.12 : 1;
  spec.hairTint = "";
  applyEmotion(spec, row.emotion);
}

function applyBody(spec, id) {
  const row = BODIES[id] || BODIES.male_lean;
  const archetypeFace = spec.face === "snout" || spec.face === "synthetic" || spec.face === "skull";
  if (STRUCTURAL_BODIES.has(id) || !archetypeFace) spec.face = row.face;
  spec.jaw = row.jaw;
  spec.shoulder = row.shoulder;
  spec.silhouette = row.silhouette;
  spec.neck = row.neck;
  spec.pose = row.pose;
  spec.eyeScale = row.eyeScale;
  spec.ageLines = row.ageLines;
  spec.beard = row.beard;
  spec.hairTint = row.hairTint;
  if (row.hair) spec.hair = row.hair;
  if (id !== "male_lean") spec.skin = row.skin;
  if (row.wardrobe && (id === "male_muscular" || id === "female_lean" || id === "female_athletic" || id === "androgynous" || id === "heavy_set" || id === "teen_young" || STRUCTURAL_BODIES.has(id))) {
    spec.wardrobe = row.wardrobe;
  }
  if (row.headwear) spec.headwear = row.headwear;
  if (STRUCTURAL_BODIES.has(id)) {
    spec.accessory = id === "full_robot" ? "optic" : (id === "non_human" ? "collar" : "none");
    spec.pointedEar = false;
  }
}

function applyExpression(spec, id) {
  applyEmotion(spec, id);
}

function applyAttire(spec, id) {
  const row = ATTIRE[id] || ATTIRE.formal;
  spec.wardrobe = row.wardrobe;
  if (row.headwear) spec.headwear = row.headwear;
  if (row.accessory) spec.accessory = row.accessory;
}

function applyPalette(spec, id) {
  const option = optionById("colorPalette", id) || optionById("colorPalette", "red");
  spec.palette = option.id;
  spec.accent = option.accent || "#F43B5F";
  spec.accent2 = option.id === "multi" ? "#FF57D2" : "";
  spec.lighting = LIGHTING[option.id] || "COOL_NEON_EDGE";
  if (option.id === "monochrome") {
    spec.primary = "#101114";
    spec.secondary = "#1A1C22";
  }
}

function applyBackground(spec, id) {
  const key = BACKGROUNDS[id] ? id : "city_night";
  spec.background = key;
  spec.motif = BACKGROUNDS[key];
}

function applyAccessories(spec, id) {
  spec.scar = false;
  spec.tattoo = false;
  if (id === "none") {
    spec.accessory = "none";
    return;
  }
  if (id === "glasses") spec.accessory = "glasses";
  else if (id === "hat_cap") {
    spec.headwear = "cap";
    spec.hair = spec.hair === "none" ? "cropped" : spec.hair;
    spec.accessory = "none";
  } else if (id === "mask") spec.accessory = "mask";
  else if (id === "headphones") spec.accessory = "headphones";
  else if (id === "cigar_smoke") spec.accessory = "cigar";
  else if (id === "jewelry") spec.accessory = "chain";
  else if (id === "scar_tattoo") {
    spec.accessory = "scar";
    spec.scar = true;
    spec.tattoo = true;
  } else if (id === "pet") spec.accessory = "pet";
  else if (id === "weapon_prop") spec.accessory = "weapon";
  else if (id === "unique_fx") spec.accessory = "fx";
  else spec.accessory = "glasses";
}

const APPLIERS = Object.freeze({
  archetype: applyArchetype,
  bodyType: applyBody,
  expression: applyExpression,
  attire: applyAttire,
  colorPalette: applyPalette,
  background: applyBackground,
  accessories: applyAccessories,
});

function normalizeSelections(input, opts = {}) {
  if ((input == null || input === "") && opts.allowEmpty) return null;
  if (input == null || typeof input !== "object") return opts.allowEmpty ? null : { ...DEFAULT_SELECTIONS };
  const out = { ...DEFAULT_SELECTIONS };
  let seen = false;
  for (const key of CATEGORY_KEYS) {
    const id = input[key];
    if (optionById(key, id)) {
      out[key] = id;
      seen = true;
    }
  }
  if (!seen && opts.allowEmpty && !Object.keys(input).length) return null;
  return out;
}

function resolveLook(selections, opts = {}) {
  const chosen = normalizeSelections(selections) || { ...DEFAULT_SELECTIONS };
  const spec = blankSpec();
  for (const key of CATEGORY_KEYS) APPLIERS[key](spec, chosen[key]);
  if (opts.emphasis && APPLIERS[opts.emphasis]) APPLIERS[opts.emphasis](spec, chosen[opts.emphasis]);
  spec.selections = chosen;
  return spec;
}

function visualPatchFromLook(look) {
  const row = look || resolveLook(DEFAULT_SELECTIONS);
  return {
    silhouette: row.silhouette,
    bodyLanguage: row.bodyLanguage,
    facialAttitude: row.attitude,
    accentColor: row.accent,
    backgroundMotif: row.motif,
    lightingStyle: row.lighting,
    materialLanguage: (row.materials || []).slice(),
    signatureFeature: row.signatureFeature,
    motionLanguage: row.motionLanguage,
    creationLook: row,
    styleId: "neon-competitive",
  };
}

const HAIR_VARIANTS = Object.freeze({
  swept: Object.freeze(["swept", "cropped", "crest", "asymmetric"]),
  cropped: Object.freeze(["cropped", "swept", "asymmetric", "crest"]),
  long: Object.freeze(["long", "asymmetric", "swept", "crest"]),
  wild: Object.freeze(["wild", "asymmetric", "crest", "long"]),
  crest: Object.freeze(["crest", "cropped", "asymmetric", "swept"]),
  asymmetric: Object.freeze(["asymmetric", "wild", "crest", "cropped"]),
  none: Object.freeze(["none", "none", "none", "none"]),
});

const POSE_VARIANTS = Object.freeze(["upright", "lean", "forward", "coiled", "relaxed"]);
const JAW_SHIFTS = Object.freeze([-0.34, 0.24, -0.12, 0.42, 0.08, -0.22]);
const SPANS = Object.freeze([0.86, 1.16, 0.94, 1.22, 0.9, 1.08]);
const EYE_SCALES = Object.freeze([0.82, 1.18, 0.94, 1.28, 1.06, 0.88]);
const NECK_SCALES = Object.freeze([0.78, 1.2, 0.92, 1.32, 1.08, 0.84]);
const TURNS = Object.freeze([-1, 1, 0, -1, 1, 0]);

function cloneLook(look) {
  const next = { ...(look || {}) };
  if (look && look.emotion) {
    next.emotion = { ...look.emotion, brow: Array.isArray(look.emotion.brow) ? look.emotion.brow.slice() : [] };
  }
  if (look && Array.isArray(look.materials)) next.materials = look.materials.slice();
  if (look && look.selections) next.selections = { ...look.selections };
  return next;
}

// Same option set, different person. Face family, wardrobe, accent, background,
// and accessory stay. Hair, jaw, pose, and proportion change per concept slot.
function varyCreationLook(look, index, salt) {
  const base = cloneLook(look);
  const slot = Math.abs(Number(index) || 0);
  const saltN = Math.abs(Number(salt) || 0);
  const at = (list) => list[(slot + saltN) % list.length];
  base.jaw = Math.max(-0.6, Math.min(0.85, (Number(base.jaw) || 0) + at(JAW_SHIFTS)));
  base.pose = at(POSE_VARIANTS);
  base.turn = at(TURNS);
  base.span = at(SPANS);
  base.eyeScale = Math.round((Number(base.eyeScale) || 1) * at(EYE_SCALES) * 100) / 100;
  base.neck = Math.round((Number(base.neck) || 1) * at(NECK_SCALES) * 100) / 100;
  const hair = base.hair || "swept";
  const cycle = HAIR_VARIANTS[hair] || HAIR_VARIANTS.swept;
  if (hair !== "none") base.hair = cycle[(slot + saltN) % cycle.length];
  if (base.emotion && Array.isArray(base.emotion.brow)) {
    const kick = [-10, 12, -4, 16, 6, -8][(slot + saltN) % 6];
    base.emotion.brow = [base.emotion.brow[0] + kick, base.emotion.brow[1] - Math.round(kick / 2)];
  }
  base.conceptSlot = slot % 4;
  return base;
}

module.exports = {
  EMOTIONS,
  normalizeSelections,
  resolveLook,
  visualPatchFromLook,
  varyCreationLook,
};
