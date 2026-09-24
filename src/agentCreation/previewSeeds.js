// Stable seeds. Previews are procedural, so the seed is the reproducibility key.
// The same option id always resolves to the same string.

const { AGENT_CREATION_OPTIONS, CATEGORY_KEYS } = require("./optionRegistry");

const PREVIEW_SEEDS = {};
for (const key of CATEGORY_KEYS) {
  const row = {};
  for (const option of AGENT_CREATION_OPTIONS[key]) {
    row[option.id] = `preview_${key}_${option.id}_v1`;
  }
  PREVIEW_SEEDS[key] = Object.freeze(row);
}

function seedFor(category, optionId) {
  const table = PREVIEW_SEEDS[category] || {};
  return table[optionId] || `preview_${category}_${optionId}_v1`;
}

function composedSeed(selections) {
  const parts = CATEGORY_KEYS.map((key) => `${key}:${selections[key] || ""}`);
  return `preview_composed_${parts.join("__")}_v1`;
}

module.exports = {
  PREVIEW_SEEDS: Object.freeze(PREVIEW_SEEDS),
  seedFor,
  composedSeed,
};
