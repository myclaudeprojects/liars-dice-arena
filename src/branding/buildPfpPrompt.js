const { PFP_STYLE_ID, stylePreset } = require("./stylePresets");

function visualOf(agent) {
  const row = agent && typeof agent === "object" ? agent : {};
  const brand = row.brand && typeof row.brand === "object" ? row.brand : row;
  return brand.visualDNA || brand.visualIdentity || {};
}

function buildPfpPrompt({ agent, styleId } = {}) {
  const preset = stylePreset(styleId || PFP_STYLE_ID);
  const row = agent && typeof agent === "object" ? agent : {};
  const v = visualOf(row);
  const materials = Array.isArray(v.materials) ? v.materials : (v.materialLanguage || []);
  const negativeLine = (preset.negatives || []).join(", ");

  return `
Create a premium square profile-picture portrait for a competitor in Liar's Dice Arena.

STYLE:
${preset.description}

COMPOSITION:
${preset.composition}

IDENTITY:
Name: ${row.name || "Competitor"}
Title: ${row.title || ""}
Archetype: ${row.archetype || ""}

VISUAL DNA:
Silhouette: ${v.silhouette || ""}
Facial attitude: ${v.facialAttitude || ""}
Body language: ${v.bodyLanguage || ""}
Primary color: ${v.primaryColor || ""}
Secondary color: ${v.secondaryColor || ""}
Accent color: ${v.accentColor || ""}
Emblem concept: ${v.emblem || ""}
Materials: ${materials.join(", ")}
Background motif: ${v.backgroundMotif || ""}
Lighting style: ${v.lightingStyle || ""}
Signature feature: ${v.signatureFeature || ""}

REQUIREMENTS:
- one character only
- face dominant in frame
- strong expression
- clean silhouette
- readable at 48px
- simple premium background
- controlled neon accent lighting
- dark premium atmosphere
- strong competitive roster feel
- no text
- no watermark
- no full body composition
- no complex scene

IMPORTANT:
The neon should be controlled and premium.
The image should feel modern and competitive, not fantasy and not chaotic.
The portrait should look brandable and clean in a product UI.

AVOID:
${negativeLine}
`.trim();
}

function buildNeonPfpVisualInstruction(agent) {
  const row = agent && typeof agent === "object" ? agent : {};
  const s = row.creationSelections || {};
  return `
LDA VISUAL STYLE:
Premium modern competitive roster portrait.
Dark premium background.
Face-first composition.
Head-and-shoulders or tight chest-up crop.
High-end stylized portrait.
Strong silhouette.
Controlled neon accent lighting.
Clean, modern and brandable.
Readable at 48px.
One character only.
No text.
No watermark.
No full-body poster composition.

SELECTED CHARACTER OPTIONS:
Archetype: ${s.archetype || ""}
Body / Character Form: ${s.bodyType || ""}
Expression: ${s.expression || ""}
Attire: ${s.attire || ""}
Color Palette: ${s.colorPalette || ""}
Background: ${s.background || ""}
Accessory: ${s.accessories || ""}

CRITICAL DIFFERENTIATION RULE:
These options define the actual character structure.

Do NOT reuse the same generic human face.

Archetype and body/character form may change:
- gender presentation
- age
- facial structure
- face shape
- skin/material appearance
- species/type
- human vs synthetic construction
- build
- shoulders
- hair/head design
- silhouette
- tech level
- wardrobe language

Examples:
- robot_ai + full_robot MUST be visibly synthetic and non-human.
- animal + non_human MUST visibly be an animal/anthro character, not a human with ears.
- elder MUST visibly read as older.
- female_athletic MUST structurally differ from male_lean.
- executive MUST visually differ from street.
- athlete MUST visually differ from criminal.
- tech MUST differ from robot_ai: Tech may be augmented human; Robot/AI may be fully synthetic.

NEON RULE:
Neon is controlled accent lighting, not visual noise.

BACKGROUND RULE:
The selected background is a simplified premium backdrop, not a busy full scene.

ACCESSORY RULE:
Make the selected accessory visible without hiding the character.

FINAL OUTPUT:
One unique canonical Liar's Dice Arena competitor portrait.
`.trim();
}

function promptForAgent({ agent, styleId, selections, variation, treatment } = {}) {
  const base = buildPfpPrompt({ agent, styleId });
  const instruction = selections
    ? buildNeonPfpVisualInstruction({ ...(agent || {}), creationSelections: selections })
    : "";
  const variant = variation == null && !treatment
    ? ""
    : `CONCEPT VARIANT: ${variation == null ? 0 : variation}\nTREATMENT: ${treatment || "standard"}`;
  return [base, instruction, variant].filter(Boolean).join("\n\n");
}

module.exports = { buildPfpPrompt, buildNeonPfpVisualInstruction, promptForAgent };
