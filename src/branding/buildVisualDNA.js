// Neon visual-DNA templates. Colors in the template are the style defaults.
// Create Agent still shifts hue so two agents do not share a palette.

const GAMBLER = Object.freeze({
  silhouette: "TALL_SHARP",
  facialAttitude: "SMUG",
  bodyLanguage: "RELAXED_PREDATORY",
  primaryColor: "#120E12",
  secondaryColor: "#2A0E18",
  accentColor: "#F43B5F",
  emblem: "BAT_SPIKE",
  materials: Object.freeze(["matte fabric", "glass", "metal"]),
  backgroundMotif: "NEON_HALO_GRID",
  lightingStyle: "CRIMSON_NEON_RIM",
  signatureFeature: "ARISTOCRATIC_COLLAR",
});

const STRATEGIST = Object.freeze({
  silhouette: "BROAD_IMPOSING",
  facialAttitude: "STOIC",
  bodyLanguage: "UPRIGHT_CONTROLLED",
  primaryColor: "#101216",
  secondaryColor: "#2A2417",
  accentColor: "#FFC247",
  emblem: "LAUREL_GEOMETRY",
  materials: Object.freeze(["brushed metal", "carbon", "stone"]),
  backgroundMotif: "AUREATE_SIGNAL_RING",
  lightingStyle: "AMBER_NEON_EDGE",
  signatureFeature: "LAUREL_BROW",
});

const CHAOS = Object.freeze({
  silhouette: "ASYMMETRIC_CHAOTIC",
  facialAttitude: "MYSTERIOUS",
  bodyLanguage: "DRIFTING_UNEVEN",
  primaryColor: "#0F1014",
  secondaryColor: "#1F1A2E",
  accentColor: "#8D63FF",
  emblem: "BROKEN_SIGNAL",
  materials: Object.freeze(["smoke", "glass", "carbon"]),
  backgroundMotif: "VOID_PULSE",
  lightingStyle: "VIOLET_NEON_GLOW",
  signatureFeature: "BROKEN_HOOD",
});

const DEFAULT_DNA = Object.freeze({
  silhouette: "SLIM_ELEGANT",
  facialAttitude: "COLD",
  bodyLanguage: "CONTROLLED",
  primaryColor: "#101216",
  secondaryColor: "#1F232A",
  accentColor: "#4AD7FF",
  emblem: "CORE_RING",
  materials: Object.freeze(["carbon", "glass"]),
  backgroundMotif: "SIGNAL_HALO",
  lightingStyle: "COOL_NEON_EDGE",
  signatureFeature: "ICONIC_COLLAR",
});

function canonicalArchetype(archetype) {
  const key = String(archetype || "").toUpperCase();
  if (key === "GAMBLER" || key === "GOTHIC_GAMBLER" || key === "PIRATE") return "GAMBLER";
  if (
    key === "STRATEGIST" || key === "IMPERIAL_COMMANDER" || key === "COMMANDER"
    || key === "EMPEROR" || key === "JUDGE" || key === "NOBLE"
  ) return "STRATEGIST";
  if (
    key === "CHAOS" || key === "REAPER" || key === "SPECTRAL_WILDCARD"
    || key === "PHANTOM" || key === "MADMAN" || key === "TRICKSTER" || key === "SORCERER"
  ) return "CHAOS";
  return "DEFAULT";
}

function cloneDna(row) {
  return {
    silhouette: row.silhouette,
    facialAttitude: row.facialAttitude,
    bodyLanguage: row.bodyLanguage,
    primaryColor: row.primaryColor,
    secondaryColor: row.secondaryColor,
    accentColor: row.accentColor,
    emblem: row.emblem,
    materials: row.materials.slice(),
    backgroundMotif: row.backgroundMotif,
    lightingStyle: row.lightingStyle,
    signatureFeature: row.signatureFeature,
  };
}

function buildVisualDNA({ archetype } = {}) {
  switch (canonicalArchetype(archetype)) {
    case "GAMBLER":
      return cloneDna(GAMBLER);
    case "STRATEGIST":
      return cloneDna(STRATEGIST);
    case "CHAOS":
      return cloneDna(CHAOS);
    default:
      return cloneDna(DEFAULT_DNA);
  }
}

module.exports = {
  buildVisualDNA,
  canonicalArchetype,
};
