// Locked PFP art direction. The renderer is still procedural SVG (lda-pfp-v2).
// neon-competitive is the style id, not a webp layer pack.

const PFP_STYLE_PRESETS = Object.freeze({
  "neon-competitive": Object.freeze({
    id: "neon-competitive",
    version: "v1",
    displayName: "Neon Competitive",
    description: `
Premium modern competitive portrait.
Face-first roster-style composition.
Dark premium background with controlled neon accents.
High contrast, strong silhouette, clear expression, minimal background noise.
Feels like a premium competitive game identity portrait.
Clean, bold, high-end, modern, and brandable.
Not fantasy. Not poster-like. Not chaotic cyberpunk.
`.trim(),
    composition: `
Exact 1:1 square.
Head-and-shoulders or tight chest-up composition.
Face dominant in frame.
One character only.
Strong silhouette.
Strong small-size readability.
Clean dark background.
Controlled tech/neon atmosphere.
No text.
No watermark.
`.trim(),
    negatives: Object.freeze([
      "fantasy armor",
      "medieval fantasy portrait",
      "generic sci-fi poster",
      "busy neon city background",
      "anime style",
      "cyberpunk overload",
      "multiple characters",
      "text",
      "watermark",
      "full body",
      "environment-heavy composition",
    ]),
  }),
});

const PFP_STYLE_ID = "neon-competitive";

function stylePreset(styleId) {
  return PFP_STYLE_PRESETS[styleId] || PFP_STYLE_PRESETS[PFP_STYLE_ID];
}

module.exports = {
  PFP_STYLE_PRESETS,
  PFP_STYLE_ID,
  stylePreset,
};
