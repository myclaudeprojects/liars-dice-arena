// Create Agent option registry.
//
// House style stays neon-competitive. These ids drive procedural SVG
// portraits (lda-pfp-v2). They are not a webp pack and not a second art style.

const HOUSE_STYLE_ID = "neon-competitive";

const HOUSE_STYLE_DESCRIPTION = `
Premium modern competitive portrait.
Dark premium background.
Face-first composition.
Clean silhouette.
Strong small-size readability.
Controlled neon accent lighting.
Modern, high-end, competitive, and brandable.
Not fantasy. Not medieval. Not chaotic cyberpunk.
`.trim();

const AGENT_CREATION_OPTIONS = Object.freeze({
  archetype: Object.freeze([
    opt("executive", "Executive", "Suits, wealth, power.", {
      silhouette: "structured_clean",
      facialType: "sharp_confident",
      wardrobe: "tailored_suit",
      accessories: Object.freeze(["luxury_glasses", "watch"]),
      vibe: "wealth_control",
    }),
    opt("street", "Street", "Urban, gritty, modern.", {
      silhouette: "relaxed_urban",
      facialType: "street_confident",
      wardrobe: "streetwear_jacket",
      accessories: Object.freeze(["cap", "chain"]),
      vibe: "urban_energy",
    }),
    opt("athlete", "Athlete", "Sporty, competitive.", {
      silhouette: "athletic_clean",
      facialType: "disciplined_intense",
      wardrobe: "sports_gear",
      accessories: Object.freeze(["armband"]),
      vibe: "performance",
    }),
    opt("celebrity", "Celebrity", "Famous, glamorous.", {
      silhouette: "polished_glamour",
      facialType: "camera_ready",
      wardrobe: "fashion_luxury",
      accessories: Object.freeze(["designer_shades", "earring"]),
      vibe: "spotlight",
    }),
    opt("tech", "Tech", "Cyber, futuristic.", {
      silhouette: "sleek_tech",
      facialType: "augmented_focus",
      wardrobe: "tech_shell",
      accessories: Object.freeze(["visor", "earpiece"]),
      vibe: "signal_precision",
    }),
    opt("criminal", "Criminal", "Rough, dangerous.", {
      silhouette: "hard_worn",
      facialType: "scarred_aggressive",
      wardrobe: "dark_jacket",
      accessories: Object.freeze(["scar", "bandana"]),
      vibe: "danger",
    }),
    opt("antihero", "Anti-Hero", "Dark, mysterious.", {
      silhouette: "hooded_lean",
      facialType: "shadowed_intense",
      wardrobe: "hooded_coat",
      accessories: Object.freeze(["mask_optional"]),
      vibe: "mystery",
    }),
    opt("comedian", "Comedian", "Funny, quirky.", {
      silhouette: "expressive_casual",
      facialType: "playful_exaggerated",
      wardrobe: "casual_flashy",
      accessories: Object.freeze(["glasses"]),
      vibe: "chaotic_fun",
    }),
    opt("animal", "Animal", "Anthro / mascot style.", {
      silhouette: "anthro_compact",
      facialType: "animal_mascot",
      wardrobe: "minimal_or_stylized",
      accessories: Object.freeze(["collar_optional"]),
      vibe: "mascot_power",
    }),
    opt("primal", "Primal", "Raw, instinctive.", {
      silhouette: "feral_asymmetrical",
      facialType: "predatory",
      wardrobe: "rugged_layers",
      accessories: Object.freeze(["claw_mark"]),
      vibe: "instinct",
    }),
    opt("robot_ai", "Robot / AI", "Mechanical, synthetic.", {
      silhouette: "mechanical_clean",
      facialType: "synthetic_face",
      wardrobe: "integrated_mech_shell",
      accessories: Object.freeze(["optic_lens"]),
      vibe: "machine_signal",
    }),
    opt("fantasy", "Fantasy", "Unique, creative.", {
      silhouette: "stylized_extreme",
      facialType: "mythic_stylized",
      wardrobe: "ornamental_modern",
      accessories: Object.freeze(["ornament"]),
      vibe: "creative_identity",
    }),
  ]),
  bodyType: Object.freeze([
    opt("male_lean", "Male (Lean)"),
    opt("male_muscular", "Male (Muscular)"),
    opt("female_lean", "Female (Lean)"),
    opt("female_athletic", "Female (Athletic)"),
    opt("androgynous", "Androgynous"),
    opt("heavy_set", "Heavy Set"),
    opt("elder", "Elder"),
    opt("teen_young", "Teen / Young"),
    opt("non_human", "Non-Human"),
    opt("full_robot", "Full Robot"),
    opt("skeletal", "Skeletal"),
  ]),
  expression: Object.freeze([
    opt("calm", "Calm"),
    opt("confident", "Confident"),
    opt("aggressive", "Aggressive"),
    opt("playful", "Playful"),
    opt("mysterious", "Mysterious"),
    opt("intense", "Intense"),
    opt("intellectual", "Intellectual"),
    opt("laid_back", "Laid Back"),
    opt("cocky", "Cocky"),
    opt("serious", "Serious"),
    opt("unhinged", "Unhinged"),
  ]),
  attire: Object.freeze([
    opt("formal", "Formal"),
    opt("casual", "Casual"),
    opt("streetwear", "Streetwear"),
    opt("sports", "Sports"),
    opt("tactical", "Tactical"),
    opt("luxury", "Luxury"),
    opt("business", "Business"),
    opt("hood_mask", "Hood / Mask"),
    opt("costume", "Costume"),
    opt("cyber_gear", "Cyber Gear"),
    opt("minimal", "Minimal"),
  ]),
  colorPalette: Object.freeze([
    opt("red", "Red", "", { accent: "#F43B5F" }),
    opt("blue", "Blue", "", { accent: "#4AD7FF" }),
    opt("purple", "Purple", "", { accent: "#8D63FF" }),
    opt("pink", "Pink", "", { accent: "#FF57D2" }),
    opt("green", "Green", "", { accent: "#55E67A" }),
    opt("orange", "Orange", "", { accent: "#FF8B2D" }),
    opt("gold", "Gold", "", { accent: "#FFC247" }),
    opt("cyan", "Cyan", "", { accent: "#2BE4FF" }),
    opt("yellow", "Yellow", "", { accent: "#FFD94A" }),
    opt("monochrome", "Monochrome", "", { accent: "#E8E8E8" }),
    opt("multi", "Multi", "", { accent: "#7DF0FF" }),
  ]),
  background: Object.freeze([
    opt("city_night", "City Night"),
    opt("underground", "Underground"),
    opt("club", "Club"),
    opt("casino", "Casino"),
    opt("studio", "Studio"),
    opt("tech_lab", "Tech Lab"),
    opt("vault", "Vault"),
    opt("beach", "Beach"),
    opt("space", "Space"),
    opt("abstract", "Abstract"),
    opt("custom", "Custom"),
  ]),
  accessories: Object.freeze([
    opt("glasses", "Glasses"),
    opt("hat_cap", "Hat / Cap"),
    opt("mask", "Mask"),
    opt("headphones", "Headphones"),
    opt("cigar_smoke", "Cigar / Smoke"),
    opt("jewelry", "Jewelry"),
    opt("scar_tattoo", "Scar / Tattoo"),
    opt("pet", "Pet"),
    opt("weapon_prop", "Weapon Prop"),
    opt("unique_fx", "Unique FX"),
    opt("none", "None"),
  ]),
});

const CATEGORY_KEYS = Object.freeze(Object.keys(AGENT_CREATION_OPTIONS));

const DEFAULT_SELECTIONS = Object.freeze({
  archetype: "executive",
  bodyType: "male_lean",
  expression: "confident",
  attire: "formal",
  colorPalette: "red",
  background: "city_night",
  accessories: "glasses",
});

function opt(id, label, description, extra) {
  const row = { id, label };
  if (description) row.description = description;
  if (extra && extra.accent) row.accent = extra.accent;
  if (extra && (extra.silhouette || extra.facialType || extra.wardrobe)) {
    row.visual = Object.freeze({ ...extra });
  }
  return Object.freeze(row);
}

function optionById(category, id) {
  return (AGENT_CREATION_OPTIONS[category] || []).find((row) => row.id === id) || null;
}

function optionLabel(category, id) {
  const row = optionById(category, id);
  return row ? row.label : id;
}

module.exports = {
  HOUSE_STYLE_ID,
  HOUSE_STYLE_DESCRIPTION,
  AGENT_CREATION_OPTIONS,
  CATEGORY_KEYS,
  DEFAULT_SELECTIONS,
  optionById,
  optionLabel,
};
