const os = require("os");
const fs = require("fs");
const path = require("path");
process.env.REGISTRY_PATH = path.join(os.tmpdir(), "lda-ava-" + process.pid + ".json");
process.env.AVATAR_DIR = path.join(os.tmpdir(), "lda-ava-dir-" + process.pid);
try { fs.rmSync(process.env.AVATAR_DIR, { recursive: true }); } catch {}

const avatar = require("../src/avatar");
const { tokenMetadata } = require("../src/argus");

function assert(cond, msg) { if (!cond) throw new Error(msg); }

const a = avatar.svg({ name: "Cold Hands", id: "cold-hands" });
const b = avatar.svg({ name: "Cold Hands", id: "cold-hands" });
const c = avatar.svg({ name: "Degen", id: "degen" });
assert(a === b, "deterministic");
assert(a !== c, "name/id changes the mark");
assert(a.startsWith("<?xml"), "svg xml");
assert(/viewBox="0 0 256 256"/.test(a), "square 256");
assert(a.includes(">CH<"), "initials");
assert(a.includes(">LDA<"), "LDA motif");
assert(avatar.initials("Cold Hands") === "CH", "two-word initials");
assert(avatar.initials("Degen") === "DE", "one-word initials");

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
assert(avatar.sniff(png) === "image/png", "sniff png");
assert(avatar.sniff(Buffer.from("not-an-image")) === null, "reject garbage");

const data = "data:image/png;base64," + png.toString("base64");
const dec = avatar.decodeDataUrl(data);
assert(dec.mime === "image/png" && dec.buf.equals(png), "data url");
try { avatar.decodeDataUrl("data:text/plain;base64,YQ=="); throw new Error("should reject"); }
catch (e) { if (!/PNG, JPEG or WebP/.test(e.message)) throw e; }

const saved = avatar.saveUpload("cold-hands", png, "image/png");
assert(saved.kind === "upload" && saved.file.endsWith(".png"), "saved");
const read = avatar.readUpload(saved);
assert(read && fs.existsSync(read.full), "readable");
assert(avatar.readUpload({ kind: "upload", file: "../etc/passwd" }) === null, "no path escape");

try {
  avatar.saveUpload("x", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"));
  throw new Error("should reject svg");
} catch (e) { if (!/PNG, JPEG, WebP or GIF/.test(e.message)) throw e; }

(async () => {
  const ingested = await avatar.ingestFromUrl("u1", "https://example.com/a.png", {
    lookup: async () => ({ address: "93.184.216.34" }),
    fetchImpl: async (_url, opts) => {
      assert(opts.redirect === "error", "no redirects");
      return { ok: true, headers: { get: () => null }, arrayBuffer: async () => png };
    },
  });
  assert(ingested.kind === "upload" && ingested.file.endsWith(".png"), "ingest saved");
  let ssrf = false;
  try {
    await avatar.ingestFromUrl("u2", "https://evil.example/a.png", {
      lookup: async () => ({ address: "127.0.0.1" }),
      fetchImpl: async () => { throw new Error("should not fetch"); },
    });
  } catch (e) { ssrf = /publicly reachable/.test(e.message); }
  assert(ssrf, "ingest SSRF refused");
})().then(() => {
  const meta = tokenMetadata({ id: "cold-hands", name: "Cold Hands" });
  assert(/\/api\/agents\/cold-hands\/avatar/.test(meta.image), "image path on spec");
  assert(meta.argusForm.image === meta.image, "argus form image mapped");
  const abs = tokenMetadata({ id: "cold-hands", name: "Cold Hands" }, { siteOrigin: "https://arena.example" });
  assert(abs.image === "https://arena.example/api/agents/cold-hands/avatar", "absolute image when origin set");
  assert(abs.argusForm.image === abs.image, "form uses absolute");
  console.log("avatar ok");
}).catch((e) => { console.error(e); process.exit(1); });
