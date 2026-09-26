// Neon-competitive portraits, drawn in-process.
//
// createImage() builds an SVG from visual DNA and rasterizes it with sharp.
// No OpenAI client, no image API, and no secret. OPENAI_API_KEY is only
// used by the optional chat players in src/llm.js.

const sharp = require("sharp");
const { buildVisualDNA } = require("./buildVisualDNA");
const { renderNeonCompetitiveSvg } = require("./localPortrait");

const LOCAL_MODEL = "neon-competitive-local";

function imageProviderConfigured() {
  return true;
}

function grab(prompt, label) {
  const match = String(prompt || "").match(new RegExp(`${label}:\\s*([^\\n]+)`, "i"));
  return match ? match[1].trim() : "";
}

function dnaFromCall({ visualDNA, agent, archetype, prompt }) {
  if (visualDNA && visualDNA.primaryColor) return { archetype: archetype || (agent && agent.archetype) || "", dna: visualDNA };
  const fromAgent = agent && agent.brand && (agent.brand.visualDNA || agent.brand.visualIdentity);
  if (fromAgent && fromAgent.primaryColor) {
    return { archetype: archetype || agent.archetype || "", dna: fromAgent };
  }
  const named = archetype || (agent && agent.archetype) || grab(prompt, "Archetype");
  const dna = buildVisualDNA({ archetype: named });
  const primary = grab(prompt, "Primary color");
  const secondary = grab(prompt, "Secondary color");
  const accent = grab(prompt, "Accent color");
  if (/^#[0-9a-fA-F]{6}$/.test(primary)) dna.primaryColor = primary;
  if (/^#[0-9a-fA-F]{6}$/.test(secondary)) dna.secondaryColor = secondary;
  if (/^#[0-9a-fA-F]{6}$/.test(accent)) dna.accentColor = accent;
  const signature = grab(prompt, "Signature feature");
  const emblem = grab(prompt, "Emblem concept");
  const lighting = grab(prompt, "Lighting style");
  const motif = grab(prompt, "Background motif");
  const silhouette = grab(prompt, "Silhouette");
  const attitude = grab(prompt, "Facial attitude");
  if (signature) dna.signatureFeature = signature;
  if (emblem) dna.emblem = emblem;
  if (lighting) dna.lightingStyle = lighting;
  if (motif) dna.backgroundMotif = motif;
  if (silhouette) dna.silhouette = silhouette;
  if (attitude) dna.facialAttitude = attitude;
  return { archetype: named, dna };
}

function sideOf(width, height) {
  const side = Math.max(Number(width) || 1024, Number(height) || 1024);
  if (side >= 1024) return 1024;
  if (side >= 512) return 512;
  if (side >= 256) return 256;
  return 128;
}

async function createImage({
  prompt,
  width = 1024,
  height = 1024,
  seed,
  agent,
  visualDNA,
  archetype,
  selections,
} = {}) {
  const resolved = dnaFromCall({ visualDNA, agent, archetype, prompt });
  const svg = renderNeonCompetitiveSvg({
    visualDNA: resolved.dna,
    seed: seed || (agent && agent.id) || "neon-competitive",
    agentId: agent && (agent.id || agent.agentId),
    archetype: resolved.archetype,
    selections: selections || (agent && agent.creationSelections) || null,
    prompt,
  });
  const side = sideOf(width, height);
  let buffer;
  try {
    buffer = await sharp(Buffer.from(svg), { density: 144 })
      .resize(side, side, { fit: "cover", position: "centre" })
      .webp({ quality: 90 })
      .toBuffer();
  } catch (err) {
    const error = new Error(`Local portrait raster failed: ${(err && err.message) || err}`);
    error.code = "pfp_provider_failed";
    throw error;
  }
  if (!buffer || buffer.length < 32) {
    const error = new Error("Local portrait raster was empty.");
    error.code = "pfp_provider_failed";
    throw error;
  }
  return {
    buffer,
    model: LOCAL_MODEL,
    seed: seed || null,
    mime: "image/webp",
    svg,
  };
}

module.exports = {
  LOCAL_MODEL,
  imageProviderConfigured,
  createImage,
};
