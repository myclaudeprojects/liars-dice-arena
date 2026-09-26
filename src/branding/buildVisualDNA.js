// Archetype visual DNA for neon-competitive portraits.
// Create Agent passes the selection archetype (executive, street, …).
// Unknown archetypes use the default competitive identity.

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
  switch (String(archetype || "").trim().toLowerCase()) {
    case "executive":
      return cloneDna({
        silhouette: "structured_clean",
        facialAttitude: "confident_controlled",
        bodyLanguage: "upright_composed",
        primaryColor: "#101216",
        secondaryColor: "#1C1F26",
        accentColor: "#F43B5F",
        emblem: "signal_peak",
        materials: ["tailored wool", "glass", "metal"],
        backgroundMotif: "city_signal_grid",
        lightingStyle: "crimson_neon_edge",
        signatureFeature: "sharp_suit_collar",
      });

    case "street":
      return cloneDna({
        silhouette: "relaxed_urban",
        facialAttitude: "street_confident",
        bodyLanguage: "leaned_relaxed",
        primaryColor: "#0F1218",
        secondaryColor: "#212633",
        accentColor: "#4AD7FF",
        emblem: "street_arc",
        materials: ["nylon", "cotton", "chrome"],
        backgroundMotif: "alley_signal_lines",
        lightingStyle: "cyan_neon_edge",
        signatureFeature: "streetwear_jacket",
      });

    case "athlete":
      return cloneDna({
        silhouette: "athletic_clean",
        facialAttitude: "disciplined_intense",
        bodyLanguage: "ready_forward",
        primaryColor: "#0E1116",
        secondaryColor: "#1E222A",
        accentColor: "#55E67A",
        emblem: "speed_mark",
        materials: ["performance_fabric", "rubber", "mesh"],
        backgroundMotif: "arena_motion_bands",
        lightingStyle: "green_neon_edge",
        signatureFeature: "performance_shoulders",
      });

    case "celebrity":
      return cloneDna({
        silhouette: "polished_glamour",
        facialAttitude: "camera_ready",
        bodyLanguage: "poised_showy",
        primaryColor: "#111217",
        secondaryColor: "#241B24",
        accentColor: "#FF57D2",
        emblem: "spotlight_ring",
        materials: ["silk", "glass", "jewelry"],
        backgroundMotif: "spotlight_halo",
        lightingStyle: "pink_neon_glow",
        signatureFeature: "luxury_styling",
      });

    case "tech":
      return cloneDna({
        silhouette: "sleek_tech",
        facialAttitude: "augmented_focus",
        bodyLanguage: "still_precise",
        primaryColor: "#0C1015",
        secondaryColor: "#18222B",
        accentColor: "#2BE4FF",
        emblem: "circuit_core",
        materials: ["carbon", "glass", "polymer"],
        backgroundMotif: "signal_grid",
        lightingStyle: "cyan_neon_glow",
        signatureFeature: "visor_or_tech_frame",
      });

    case "criminal":
      return cloneDna({
        silhouette: "hard_worn",
        facialAttitude: "scarred_aggressive",
        bodyLanguage: "tense_forward",
        primaryColor: "#121212",
        secondaryColor: "#231A1A",
        accentColor: "#FF8B2D",
        emblem: "warning_mark",
        materials: ["leather", "denim", "smoke"],
        backgroundMotif: "grit_smoke",
        lightingStyle: "orange_neon_edge",
        signatureFeature: "scarred_profile",
      });

    case "antihero":
      return cloneDna({
        silhouette: "hooded_lean",
        facialAttitude: "shadowed_intense",
        bodyLanguage: "quiet_ready",
        primaryColor: "#0D0F14",
        secondaryColor: "#1E1D26",
        accentColor: "#8D63FF",
        emblem: "broken_ring",
        materials: ["matte_fabric", "smoke", "metal"],
        backgroundMotif: "void_pulse",
        lightingStyle: "violet_neon_glow",
        signatureFeature: "hood_or_mask",
      });

    case "comedian":
      return cloneDna({
        silhouette: "expressive_casual",
        facialAttitude: "playful_exaggerated",
        bodyLanguage: "animated_loose",
        primaryColor: "#111319",
        secondaryColor: "#1D2431",
        accentColor: "#FFD94A",
        emblem: "spark_pop",
        materials: ["cotton", "plastic", "gloss"],
        backgroundMotif: "burst_shapes",
        lightingStyle: "yellow_neon_pop",
        signatureFeature: "expressive_smile",
      });

    case "animal":
      return cloneDna({
        silhouette: "anthro_compact",
        facialAttitude: "mascot_fierce",
        bodyLanguage: "compact_ready",
        primaryColor: "#101216",
        secondaryColor: "#1F232C",
        accentColor: "#4AD7FF",
        emblem: "crest_mark",
        materials: ["fur", "fabric", "metal"],
        backgroundMotif: "mascot_halo",
        lightingStyle: "cool_neon_edge",
        signatureFeature: "animal_face_structure",
      });

    case "primal":
      return cloneDna({
        silhouette: "feral_asymmetrical",
        facialAttitude: "predatory",
        bodyLanguage: "unstable_ready",
        primaryColor: "#11100F",
        secondaryColor: "#231A15",
        accentColor: "#FFC247",
        emblem: "claw_arc",
        materials: ["rugged_fabric", "bone", "leather"],
        backgroundMotif: "wild_signal_streaks",
        lightingStyle: "amber_neon_edge",
        signatureFeature: "feral_features",
      });

    case "robot_ai":
      return cloneDna({
        silhouette: "mechanical_clean",
        facialAttitude: "synthetic_focus",
        bodyLanguage: "perfect_stillness",
        primaryColor: "#0B0F14",
        secondaryColor: "#18212C",
        accentColor: "#2BE4FF",
        emblem: "optic_core",
        materials: ["alloy", "glass", "polymer"],
        backgroundMotif: "machine_grid",
        lightingStyle: "cyan_signal_glow",
        signatureFeature: "optical_lens",
      });

    default:
      return cloneDna({
        silhouette: "upright_clean",
        facialAttitude: "calm_focused",
        bodyLanguage: "controlled",
        primaryColor: "#101216",
        secondaryColor: "#1F232A",
        accentColor: "#4AD7FF",
        emblem: "core_ring",
        materials: ["carbon", "glass"],
        backgroundMotif: "signal_halo",
        lightingStyle: "cool_neon_edge",
        signatureFeature: "iconic_collar",
      });
  }
}

// Selection palettes override the archetype defaults when a concept has its own colors.
function composeVisualDNA({ archetype, visual } = {}) {
  const dna = buildVisualDNA({ archetype });
  const row = visual && typeof visual === "object" ? visual : {};
  if (row.silhouette) dna.silhouette = row.silhouette;
  if (row.facialAttitude) dna.facialAttitude = row.facialAttitude;
  if (row.bodyLanguage) dna.bodyLanguage = row.bodyLanguage;
  if (row.primaryColor) dna.primaryColor = row.primaryColor;
  if (row.secondaryColor) dna.secondaryColor = row.secondaryColor;
  if (row.accentColor) dna.accentColor = row.accentColor;
  if (row.emblem) dna.emblem = row.emblem;
  if (Array.isArray(row.materialLanguage) && row.materialLanguage.length) dna.materials = row.materialLanguage.slice();
  else if (Array.isArray(row.materials) && row.materials.length) dna.materials = row.materials.slice();
  if (row.backgroundMotif) dna.backgroundMotif = row.backgroundMotif;
  if (row.lightingStyle) dna.lightingStyle = row.lightingStyle;
  if (row.signatureFeature) dna.signatureFeature = row.signatureFeature;
  return dna;
}

module.exports = {
  buildVisualDNA,
  composeVisualDNA,
};
