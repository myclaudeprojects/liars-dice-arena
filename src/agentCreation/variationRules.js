const VARIATION_RULES = Object.freeze({
  archetype: Object.freeze({
    controls: Object.freeze([
      "silhouette",
      "facialType",
      "wardrobe",
      "signatureFeature",
      "backgroundMotif",
      "vibe",
    ]),
    intensity: "high",
  }),
  bodyType: Object.freeze({
    controls: Object.freeze([
      "jawline",
      "build",
      "age",
      "neck",
      "shoulderWidth",
      "facialStructure",
    ]),
    intensity: "high",
  }),
  expression: Object.freeze({
    controls: Object.freeze([
      "eyebrows",
      "mouth",
      "headTilt",
      "eyeIntensity",
      "emotionalRead",
    ]),
    intensity: "medium",
  }),
  attire: Object.freeze({
    controls: Object.freeze([
      "outerwear",
      "neckline",
      "materials",
      "gear",
      "collarShape",
    ]),
    intensity: "high",
  }),
  colorPalette: Object.freeze({
    controls: Object.freeze([
      "accentColor",
      "rimLightColor",
      "glowColor",
      "backgroundAccent",
    ]),
    intensity: "medium",
  }),
  background: Object.freeze({
    controls: Object.freeze([
      "backgroundMotif",
      "environmentCue",
      "lightShapes",
      "depthLanguage",
    ]),
    intensity: "high",
  }),
  accessories: Object.freeze({
    controls: Object.freeze([
      "faceAccessory",
      "headAccessory",
      "secondaryProp",
    ]),
    intensity: "medium",
  }),
});

module.exports = { VARIATION_RULES };
