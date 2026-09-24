// On-the-fly option previews. Procedural SVG only — no webp pack and no image API.

const { buildRecipe, renderPfp } = require("../pfp");
const { resolveLook, normalizeSelections } = require("./resolveLook");
const { seedFor, composedSeed } = require("./previewSeeds");
const { buildOptionPreviewPrompt } = require("./buildOptionPreviewPrompt");
const {
  AGENT_CREATION_OPTIONS,
  CATEGORY_KEYS,
  DEFAULT_SELECTIONS,
  HOUSE_STYLE_ID,
  optionById,
} = require("./optionRegistry");
const { CREATION_PREVIEW_SECTIONS } = require("./previewSections");

const MODEL = "procedural-svg";
const RENDERER = "lda-pfp-v2";

function renderLook(look, { seed, nonce, size } = {}) {
  const drawing = { ...look, seed: seed || "" };
  const recipe = buildRecipe({
    name: "Preview",
    title: "",
    archetype: "GAMBLER",
    visual: {
      silhouette: drawing.silhouette,
      facialAttitude: drawing.attitude,
      bodyLanguage: drawing.bodyLanguage,
      primaryColor: drawing.primary,
      secondaryColor: drawing.secondary,
      accentColor: drawing.accent,
      emblem: "DICE_MARK",
      materialLanguage: drawing.materials,
      backgroundMotif: drawing.motif,
      lightingStyle: drawing.lighting,
      signatureFeature: drawing.signatureFeature,
      ornamentationLevel: 0.45,
      creationLook: drawing,
    },
    variation: 1,
    treatment: "standard",
    look: drawing,
  });
  return {
    recipe,
    svg: renderPfp(recipe, { size: size || 512, nonce: nonce || "preview" }),
  };
}

function manifestFor({ category, optionId, label, seed, selections, prompt }) {
  return {
    category,
    optionId,
    label: label || optionId,
    seed,
    model: MODEL,
    renderer: RENDERER,
    houseStyleId: HOUSE_STYLE_ID,
    prompt,
    lockedSelections: selections,
  };
}

function optionPreview(category, optionId) {
  const option = optionById(category, optionId);
  const id = option ? option.id : optionId;
  const selections = { ...DEFAULT_SELECTIONS, [category]: id };
  const look = resolveLook(selections, { emphasis: category });
  const seed = seedFor(category, id);
  const prompt = buildOptionPreviewPrompt({ category, optionId: id, lockedSelections: selections });
  const drawn = renderLook(look, { seed, nonce: `${category}_${id}`, size: 512 });
  return {
    id,
    label: option ? option.label : id,
    description: option ? (option.description || "") : "",
    accent: option && option.accent ? option.accent : "",
    seed,
    svg: drawn.svg,
    manifest: manifestFor({
      category,
      optionId: id,
      label: option ? option.label : id,
      seed,
      selections,
      prompt,
    }),
  };
}

function composedPreview(selections) {
  const chosen = normalizeSelections(selections) || { ...DEFAULT_SELECTIONS };
  const look = resolveLook(chosen);
  const seed = composedSeed(chosen);
  const prompt = buildOptionPreviewPrompt({
    category: "composed",
    optionId: seed,
    lockedSelections: chosen,
  });
  const drawn = renderLook(look, { seed, nonce: "hero_" + seed.slice(-24), size: 512 });
  return {
    selections: chosen,
    seed,
    svg: drawn.svg,
    look,
    prompt,
    manifest: manifestFor({
      category: "composed",
      optionId: seed,
      label: "Draft look",
      seed,
      selections: chosen,
      prompt,
    }),
  };
}

let cachedPack = null;

function sectionPreviews() {
  if (cachedPack) return cachedPack;
  const previews = {};
  for (const key of CATEGORY_KEYS) {
    previews[key] = AGENT_CREATION_OPTIONS[key].map((option) => optionPreview(key, option.id));
  }
  cachedPack = {
    houseStyleId: HOUSE_STYLE_ID,
    defaults: { ...DEFAULT_SELECTIONS },
    sections: CREATION_PREVIEW_SECTIONS.map((section) => ({ ...section })),
    previews,
    hero: composedPreview(DEFAULT_SELECTIONS),
  };
  return cachedPack;
}

module.exports = {
  MODEL,
  RENDERER,
  renderLook,
  optionPreview,
  composedPreview,
  sectionPreviews,
  manifestFor,
};
