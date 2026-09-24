// Stable option previews. Built once per process, not on every page view.
// These are examples of an option, not a creator's canonical portrait.

const { buildRecipe, renderPfp } = require("../pfp");
const { previewSelections, GROUPS } = require("./creationSelections");

const cache = new Map();

function previewKey(group, id) {
  return `${group}/${id}`;
}

function previewSvg(group, id) {
  const key = previewKey(group, id);
  if (cache.has(key)) return cache.get(key);
  const selections = previewSelections(group, id);
  if (!selections) return null;
  const recipe = buildRecipe({
    name: `Preview ${group} ${id}`,
    title: "Preview",
    archetype: "GAMBLER",
    visual: {
      silhouette: "SLIM_ELEGANT",
      facialAttitude: "STOIC",
      primaryColor: "#141820",
      secondaryColor: "#10141C",
      accentColor: "#4AD7FF",
      emblem: "CORE_RING",
      backgroundMotif: "SIGNAL_HALO",
      lightingStyle: "COOL_NEON_EDGE",
      ornamentationLevel: 0.4,
    },
    variation: 0,
    treatment: "standard",
    selections,
  });
  const svg = renderPfp(recipe, { size: 256, nonce: `preview_${group}_${id}` });
  cache.set(key, svg);
  return svg;
}

function warmCreationPreviews() {
  for (const group of Object.keys(GROUPS)) {
    for (const id of GROUPS[group]) previewSvg(group, id);
  }
  return cache.size;
}

module.exports = {
  previewSvg,
  warmCreationPreviews,
};
