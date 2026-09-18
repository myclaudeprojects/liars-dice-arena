// Deterministic LDA avatars (felt + dice + initials) and optional custom-image
// storage. Generated SVGs need no disk. Uploads live next to the registry so a
// Render disk at /var/data keeps them. We do not call a fake Argus CDN.

const fs = require("fs");
const path = require("path");

const MAX_BYTES = 400 * 1024;
const SIZE = 256;
const FELT = ["#144b39", "#0d362a", "#1a5c44", "#0f3f30", "#1c6b4a"];
const RAIL = ["#5a3b22", "#7a5433", "#3d2414"];
const IVORY = "#f6efe1";
const GOLD = "#d9a93b";
const INK = "#1a1a17";
const PIPS = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[28, 28], [50, 50], [72, 72]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 28], [72, 28], [28, 50], [72, 50], [28, 72], [72, 72]],
};

function hash32(str) {
  let h = 2166136261;
  for (const ch of String(str)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function escapeXml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]
  ));
}

function initials(name) {
  const w = String(name || "?").trim().split(/\s+/).filter(Boolean);
  if (w.length >= 2) return (w[0][0] + w[1][0]).toUpperCase();
  const s = (w[0] || "?").replace(/[^A-Za-z0-9]/g, "");
  return (s.slice(0, 2) || "?").toUpperCase();
}

function svg({ name, id } = {}) {
  const label = String(name || id || "Agent");
  const h = hash32(`${label}\0${id || ""}`);
  const felt = FELT[h % FELT.length];
  const felt2 = FELT[(h >>> 8) % FELT.length];
  const rail = RAIL[(h >>> 16) % RAIL.length];
  const face = 1 + ((h >>> 20) % 6);
  const ini = initials(label);
  const gid = "g" + (h >>> 4).toString(16);
  const pips = (PIPS[face] || PIPS[5]).map(([x, y]) =>
    `<circle cx="${(x / 100) * 48}" cy="${(y / 100) * 48}" r="4" fill="${INK}"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}" role="img" aria-label="${escapeXml(label)}">
  <defs><radialGradient id="${gid}" cx="50%" cy="40%" r="75%"><stop offset="0%" stop-color="${felt}"/><stop offset="100%" stop-color="${felt2}"/></radialGradient></defs>
  <rect width="${SIZE}" height="${SIZE}" rx="40" fill="${rail}"/>
  <rect x="14" y="14" width="228" height="228" rx="32" fill="url(#${gid})"/>
  <ellipse cx="128" cy="138" rx="98" ry="74" fill="${felt2}" opacity=".55"/>
  <g transform="translate(174 32)"><rect width="48" height="48" rx="10" fill="${IVORY}"/>${pips}</g>
  <text x="128" y="156" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-size="78" font-weight="700" fill="${IVORY}">${escapeXml(ini)}</text>
  <text x="128" y="214" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="13" letter-spacing="3" fill="${GOLD}">LDA</text>
</svg>`;
}

function sniff(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.slice(0, 6).toString("ascii") === "GIF87a" || buf.slice(0, 6).toString("ascii") === "GIF89a") return "image/gif";
  if (buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP") return "image/webp";
  const head = buf.slice(0, 180).toString("utf8").replace(/^\uFEFF/, "").trim();
  if (/^(<svg[\s>])/i.test(head) || /^<\?xml[\s\S]{0,80}<svg/i.test(head)) return "image/svg+xml";
  return null;
}

function decodeDataUrl(s) {
  const m = String(s || "").match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+=*)$/i);
  if (!m) throw new Error("Image must be a PNG, JPEG or WebP (square-cropped on the client).");
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > MAX_BYTES) throw new Error("Image must be under 400 KB.");
  const mime = sniff(buf);
  if (!mime || (mime === "image/jpeg" ? m[1].toLowerCase() !== "image/jpeg" : mime !== m[1].toLowerCase())) {
    throw new Error("Image bytes did not match the declared type.");
  }
  return { buf, mime };
}

function avatarDir() {
  const reg = process.env.REGISTRY_PATH || path.join(__dirname, "..", "data", "agents.json");
  return process.env.AVATAR_DIR || path.join(path.dirname(reg), "avatars");
}

function extFor(mime) {
  return ({ "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "image/svg+xml": ".svg" })[mime] || null;
}

function saveUpload(id, buf, mime) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) throw new Error("Image must be PNG, JPEG, WebP or GIF.");
  if (buf.length > MAX_BYTES) throw new Error("Image must be under 400 KB.");
  const detected = sniff(buf);
  if (!detected || detected === "image/svg+xml") throw new Error("Image must be PNG, JPEG, WebP or GIF.");
  if (mime && mime !== detected) throw new Error("Image bytes did not match the declared type.");
  mime = detected;
  const ext = extFor(mime);
  const safe = String(id || "agent").replace(/[^a-z0-9._-]+/gi, "-").slice(0, 40) || "agent";
  const dir = avatarDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = `${safe}${ext}`;
  fs.writeFileSync(path.join(dir, file), buf);
  return { kind: "upload", file, mime, updatedAt: Date.now() };
}

function readUpload(avatar) {
  if (!avatar || avatar.kind !== "upload" || !avatar.file) return null;
  const dir = path.resolve(avatarDir());
  const full = path.resolve(dir, path.basename(avatar.file));
  if (full !== dir && !full.startsWith(dir + path.sep)) return null;
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
  return { full, mime: avatar.mime || sniff(fs.readFileSync(full)) || "application/octet-stream" };
}

function publicPath(id, avatar) {
  const q = avatar && avatar.updatedAt ? `?v=${avatar.updatedAt}` : "";
  return `/api/agents/${encodeURIComponent(id)}/avatar${q}`;
}

function publicUrl(id, avatar, { siteOrigin } = {}) {
  const p = publicPath(id, avatar).replace(/\?.*$/, "");
  const { publicBaseUrl } = require("./argus");
  const base = publicBaseUrl(siteOrigin !== undefined ? siteOrigin : undefined);
  return base ? `${base}${p}` : p;
}

function publicMeta(id, av) {
  const kind = av && av.kind === "upload" ? "upload" : "generated";
  return {
    kind,
    mime: kind === "upload" ? (av.mime || "application/octet-stream") : "image/svg+xml",
    url: publicPath(id, av),
  };
}

// Fetch a remote image once (SSRF-guarded). Argus has no documented image
// CDN; we host the bytes and put our URL on the token spec.
async function ingestFromUrl(id, url, { allowLocal = false, fetchImpl = fetch, lookup, timeoutMs = 8000 } = {}) {
  const { assertSafeAgentUrl } = require("./registry");
  const safe = await assertSafeAgentUrl(url, { allowLocal, lookup });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(safe, {
      method: "GET",
      redirect: "error",
      signal: ctrl.signal,
      headers: { accept: "image/png,image/jpeg,image/webp,image/gif,*/*;q=0.1" },
    });
    if (!r.ok) throw new Error("Could not fetch that image URL.");
    const rawLen = r.headers?.get ? r.headers.get("content-length") : (r.headers && r.headers["content-length"]);
    const len = Number(rawLen || 0);
    if (len > MAX_BYTES) throw new Error("Image must be under 400 KB.");
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error("Image must be under 400 KB.");
    return saveUpload(id, buf);
  } catch (e) {
    if (e && e.name === "AbortError") throw new Error("Image URL timed out.");
    throw e;
  } finally { clearTimeout(t); }
}

module.exports = {
  MAX_BYTES, SIZE, hash32, initials, svg, sniff, decodeDataUrl,
  avatarDir, saveUpload, readUpload, publicPath, publicUrl, publicMeta, ingestFromUrl,
};
