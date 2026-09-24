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
- no movie poster layout

IMPORTANT:
The neon should be controlled and premium.
The image should feel modern and competitive, not fantasy and not chaotic.
The portrait should look brandable and clean in a product UI.

AVOID:
${negativeLine}
`.trim();
}

module.exports = { buildPfpPrompt };
