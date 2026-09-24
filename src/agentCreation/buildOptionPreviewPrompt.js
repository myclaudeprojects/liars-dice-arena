const {
  AGENT_CREATION_OPTIONS,
  HOUSE_STYLE_DESCRIPTION,
  optionLabel,
} = require("./optionRegistry");

const HOUSE_STYLE = `
Premium modern competitive portrait.
Dark premium background.
Face-first roster composition.
Strong silhouette.
Controlled neon accent lighting.
Clean, brandable, modern.
Not fantasy-heavy. Not medieval. Not chaotic cyberpunk.
`.trim();

function labelFor(listKey, id) {
  return optionLabel(listKey, id);
}

function buildOptionPreviewPrompt({ category, optionId, lockedSelections = {} } = {}) {
  const archetype = labelFor("archetype", lockedSelections.archetype || "executive");
  const bodyType = labelFor("bodyType", lockedSelections.bodyType || "male_lean");
  const expression = labelFor("expression", lockedSelections.expression || "confident");
  const attire = labelFor("attire", lockedSelections.attire || "formal");
  const colorPalette = labelFor("colorPalette", lockedSelections.colorPalette || "red");
  const background = labelFor("background", lockedSelections.background || "city_night");
  const accessories = labelFor("accessories", lockedSelections.accessories || "glasses");
  const known = (AGENT_CREATION_OPTIONS[category] || []).some((row) => row.id === optionId);

  return `
Create a square 1:1 profile-picture preview for a Liar's Dice Arena agent creation screen.

HOUSE STYLE:
${HOUSE_STYLE}

${HOUSE_STYLE_DESCRIPTION}

This image is an OPTION PREVIEW for category: ${category}
Current option: ${optionId}${known ? "" : " (unlisted)"}

The preview must make the difference for this option category visually obvious.

LOCKED BASE SELECTIONS:
Archetype: ${archetype}
Body Type: ${bodyType}
Expression: ${expression}
Attire: ${attire}
Color Palette: ${colorPalette}
Background: ${background}
Accessories: ${accessories}

RULES:
- face-first portrait
- shoulders visible
- one character only
- strong small-size readability
- dark premium background
- clean composition
- no text
- no watermark
- controlled neon accents
- clearly show what makes this option different

IMPORTANT:
For this preview, exaggerate the visual cues of the chosen ${category} option enough that a user instantly understands the difference between this option and neighboring options.

Avoid making all options look like the same person with only a color change.

RENDERER: procedural SVG, lda-pfp-v2. No external image model.
`.trim();
}

module.exports = { buildOptionPreviewPrompt, HOUSE_STYLE };
