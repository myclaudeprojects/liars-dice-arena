// Neon competitive package: DNA, prompt, local portraits, sized files.
const fs = require("fs");
const os = require("os");
const path = require("path");
const sharp = require("sharp");
const { PFP_STYLE_PRESETS, PFP_STYLE_ID } = require("../src/branding/stylePresets");
const { buildVisualDNA } = require("../src/branding/buildVisualDNA");
const { buildPfpPrompt } = require("../src/branding/buildPfpPrompt");
const { neonAgents } = require("../src/branding/testAgents");
const { createImage, imageProviderConfigured } = require("../src/branding/imageProvider");
const { buildSeed, savePortrait, readPortraitSync, portraitExists, STYLE_ID, STYLE_VERSION } = require("../src/branding/pfpAssets");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }
function eq(a, b, m) { if (a !== b) throw new Error((m || "eq") + `: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }

eq(PFP_STYLE_ID, "neon-competitive", "style id");
eq(PFP_STYLE_PRESETS["neon-competitive"].version, "v1", "preset version");
eq(STYLE_ID, "neon-competitive", "asset style");
eq(STYLE_VERSION, "v1", "asset version");

const executive = buildVisualDNA({ archetype: "executive" });
eq(executive.accentColor, "#F43B5F", "executive crimson");
eq(executive.lightingStyle, "crimson_neon_edge", "executive light");
eq(executive.signatureFeature, "sharp_suit_collar", "executive collar");
const street = buildVisualDNA({ archetype: "street" });
eq(street.accentColor, "#4AD7FF", "street cyan");
const robot = buildVisualDNA({ archetype: "robot_ai" });
eq(robot.signatureFeature, "optical_lens", "robot lens");
eq(robot.accentColor, "#2BE4FF", "robot cyan");
const fallback = buildVisualDNA({ archetype: "GAMBLER" });
eq(fallback.accentColor, "#4AD7FF", "unknown archetype uses the default");
eq(fallback.lightingStyle, "cool_neon_edge", "default light");

eq(neonAgents.length, 3, "sample roster");
eq(neonAgents[0].id, "executive_viktor", "first sample");
eq(neonAgents[2].brand.visualDNA.signatureFeature, "optical_lens", "sample dna");

const prompt = buildPfpPrompt({
  styleId: "neon-competitive",
  agent: neonAgents[0],
});
assert(prompt.includes("Name: Victor Vale"), "prompt names the agent");
assert(prompt.includes("Title: The Executive"), "prompt names the title");
assert(prompt.includes("#F43B5F"), "prompt carries the accent");
assert(prompt.includes("fantasy armor"), "prompt lists negatives");
assert(prompt.includes("controlled neon accent lighting"), "prompt keeps neon controlled");
assert(!prompt.includes("procedural"), "prompt is not a drawing spec");

eq(buildSeed("executive_viktor", "v1"), "executive_viktor__neon_competitive__v1", "seed");

const saved = process.env.OPENAI_API_KEY;
delete process.env.OPENAI_API_KEY;
assert(imageProviderConfigured(), "portraits do not need a key");

(async () => {
  const image = await createImage({
    prompt,
    width: 256,
    height: 256,
    seed: buildSeed("executive_viktor"),
    agent: neonAgents[0],
    visualDNA: executive,
    archetype: "executive",
  });
  eq(image.model, "neon-competitive-local", "local model");
  assert(image.buffer.slice(0, 4).toString() === "RIFF", "webp bytes");
  const robotImage = await createImage({
    prompt: "robot",
    width: 256,
    height: 256,
    seed: buildSeed("robot_zeno"),
    agent: neonAgents[2],
    visualDNA: robot,
    archetype: "robot_ai",
    selections: { bodyType: "full_robot", archetype: "robot_ai" },
  });
  assert(!image.buffer.equals(robotImage.buffer), "executive and robot differ");
  if (saved) process.env.OPENAI_API_KEY = saved;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lda-neon-"));
  const buffer = await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 16, g: 18, b: 22 } },
  }).png().toBuffer();
  const manifest = await savePortrait({
    root: dir,
    agentId: "executive_viktor",
    version: 1,
    buffer,
    model: "test-stub",
    prompt,
    seed: buildSeed("executive_viktor"),
    visualDNA: executive,
    agentName: "Victor Vale",
  });
  eq(manifest.styleId, "neon-competitive", "manifest style");
  eq(manifest.model, "test-stub", "manifest model");
  assert(manifest.prompt.includes("Victor Vale"), "manifest keeps the prompt");
  assert(fs.existsSync(path.join(dir, "executive_viktor", "neon-competitive", "v1", "b1", "pfp-48.webp")), "48 webp");
  assert(fs.existsSync(path.join(dir, "executive_viktor", "neon-competitive", "v1", "b1", "pfp-1024.webp")), "master webp");
  assert(fs.existsSync(path.join(dir, "executive_viktor", "neon-competitive", "v1", "b1", "manifest.json")), "manifest file");
  const small = readPortraitSync(dir, "executive_viktor", 1, 48);
  const mid = readPortraitSync(dir, "executive_viktor", 1, 160);
  assert(small && small.mime === "image/webp" && small.size === 48, "48 read");
  assert(mid && mid.size === 256, "160 reads the 256 file");
  assert(portraitExists(dir, "executive_viktor", 1), "exists");
  assert(!portraitExists(dir, "executive_viktor", 2), "other version is empty");
  assert(!readPortraitSync(dir, "dracula", 1, 512), "house cast is not invented");
  console.log("neon pfp ok");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
