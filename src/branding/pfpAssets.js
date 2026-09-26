// On-disk neon-competitive portraits.
//
// The generation script and the live Create Agent path both write:
//   {root}/{agentId}/neon-competitive/v1/b{version}/pfp-{size}.webp
//   plus manifest.json
//
// root follows PFP_ASSET_DIR, otherwise the directory next to the show file
// (on Render that is the persistent disk). public/assets/agents is the
// fallback the batch script uses when no show path is set.

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const STYLE_ID = "neon-competitive";
const STYLE_VERSION = "v1";
const DERIVED_SIZES = Object.freeze([512, 256, 96, 48]);
const MASTER_SIZE = 1024;

function buildSeed(agentId, styleVersion = STYLE_VERSION) {
  return `${agentId}__neon_competitive__${styleVersion}`;
}

function safeId(agentId) {
  const id = String(agentId || "agent").replace(/[^a-zA-Z0-9_.-]/g, "_");
  return id || "agent";
}

function assetRootFor(dataFile) {
  if (process.env.PFP_ASSET_DIR) return path.resolve(process.env.PFP_ASSET_DIR);
  if (dataFile) return path.join(path.dirname(path.resolve(dataFile)), "assets", "agents");
  if (process.env.SHOW_DATA_PATH) return path.join(path.dirname(process.env.SHOW_DATA_PATH), "assets", "agents");
  return path.resolve("public/assets/agents");
}

function publicAssetRoot() {
  return path.resolve("public/assets/agents");
}

function brandFolder(version) {
  const n = Number(version);
  return `b${Number.isFinite(n) && n > 0 ? n : 1}`;
}

function portraitDir(root, agentId, version) {
  return path.join(root, safeId(agentId), STYLE_ID, STYLE_VERSION, brandFolder(version));
}

function fileForSize(requested) {
  const n = Number(requested);
  if (n === 48) return 48;
  if (n === 96) return 96;
  if (n === 256) return 256;
  if (n === 512) return 512;
  if (n === 1024) return 1024;
  if (!Number.isFinite(n) || n <= 0) return 1024;
  if (n <= 48) return 48;
  if (n <= 96) return 96;
  if (n <= 256) return 256;
  if (n <= 512) return 512;
  return 1024;
}

function relativeAssets(agentId, version) {
  const id = safeId(agentId);
  const folder = `${id}/${STYLE_ID}/${STYLE_VERSION}/${brandFolder(version)}`;
  const rel = (size) => `/assets/agents/${folder}/pfp-${size}.webp`;
  return {
    pfp1024: rel(1024),
    pfp512: rel(512),
    pfp256: rel(256),
    pfp96: rel(96),
    pfp48: rel(48),
  };
}

async function resizeOutputs(sourcePath, destDir) {
  for (const size of DERIVED_SIZES) {
    await sharp(sourcePath)
      .resize(size, size, { fit: "cover", position: "centre" })
      .webp({ quality: size <= 96 ? 90 : 92 })
      .toFile(path.join(destDir, `pfp-${size}.webp`));
  }
}

async function savePortrait({
  root,
  agentId,
  version = 1,
  buffer,
  model,
  prompt,
  seed,
  visualDNA,
  agentName,
} = {}) {
  if (!buffer || !buffer.length) {
    const err = new Error("Portrait save received an empty image.");
    err.code = "pfp_provider_failed";
    throw err;
  }
  const destDir = portraitDir(root, agentId, version);
  await fs.promises.mkdir(destDir, { recursive: true });
  const masterPath = path.join(destDir, "pfp-1024.webp");
  await sharp(buffer)
    .resize(MASTER_SIZE, MASTER_SIZE, { fit: "cover", position: "centre" })
    .webp({ quality: 92 })
    .toFile(masterPath);
  await resizeOutputs(masterPath, destDir);
  const meta = await sharp(masterPath).metadata();
  if (!meta.width || meta.width !== meta.height) {
    const err = new Error("Saved portrait was not square.");
    err.code = "pfp_provider_failed";
    throw err;
  }
  const styleVersion = STYLE_VERSION;
  const manifest = {
    agentId: safeId(agentId),
    agentName: agentName || safeId(agentId),
    styleId: STYLE_ID,
    styleVersion,
    brandVersion: Number(version) || 1,
    seed: seed || buildSeed(agentId, styleVersion),
    model: model || "unknown",
    generatedAt: new Date().toISOString(),
    prompt,
    visualDNA: visualDNA || null,
    assets: relativeAssets(agentId, version),
  };
  await fs.promises.writeFile(path.join(destDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  return manifest;
}

function readFileAt(file) {
  try {
    if (!fs.existsSync(file)) return null;
    const buffer = fs.readFileSync(file);
    if (!buffer || !buffer.length) return null;
    return buffer;
  } catch {
    return null;
  }
}

function readPortraitSync(root, agentId, version, size) {
  const px = fileForSize(size);
  const name = `pfp-${px}.webp`;
  const roots = [];
  if (root) roots.push(root);
  const pub = publicAssetRoot();
  if (!roots.includes(pub)) roots.push(pub);
  for (const base of roots) {
    const file = path.join(portraitDir(base, agentId, version), name);
    const buffer = readFileAt(file);
    if (buffer) return { buffer, mime: "image/webp", file, size: px };
  }
  return null;
}

function portraitExists(root, agentId, version) {
  return Boolean(readPortraitSync(root, agentId, version, MASTER_SIZE));
}

module.exports = {
  STYLE_ID,
  STYLE_VERSION,
  DERIVED_SIZES,
  MASTER_SIZE,
  buildSeed,
  assetRootFor,
  publicAssetRoot,
  portraitDir,
  relativeAssets,
  savePortrait,
  resizeOutputs,
  readPortraitSync,
  portraitExists,
};
