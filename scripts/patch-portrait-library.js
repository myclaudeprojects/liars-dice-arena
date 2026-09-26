// One-off patch: portrait library wiring (concepts, brands, view, routes, client, migration, tests). Idempotent.
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const files = {};
const read = (f) => { if (!files[f]) { const raw = fs.readFileSync(path.join(root, f), "utf8"); files[f] = { crlf: raw.includes("\r\n"), text: raw.replace(/\r\n/g, "\n"), orig: raw.replace(/\r\n/g, "\n") }; } return files[f]; };
const rep = (f, a, b) => { const o = read(f); if (o.text.includes(b)) return; if (!o.text.includes(a)) throw new Error(f + " anchor missing: " + a.slice(0, 70)); o.text = o.text.replace(a, b); };

// ---- brandcreate.js
rep("src/brandcreate.js", `const imageProvider = createImageProvider();`, `const imageProvider = createImageProvider();
const portraitLib = require("./portraitlib");

// Asset map for a brand whose portrait is a library image: every size is the same
// file (browsers scale it), stamped so a new version or style still busts caches.
function imagePortraitAssets(entry, agentId, version) {
  const base = portraitAssets(agentId, version);
  const url = withBrandVersion(portraitLib.urlFor(entry), { version });
  return { ...base, pfpPortrait: url, canonicalPfp: url, avatar: url, avatar48: url, avatar96: url, avatar160: url, avatar256: url, avatar320: url, avatar512: url, avatar1024: url };
}

// Attach library portraits to a concept round: four DIFFERENT generated faces that best
// match the selections (regenerate rounds skip what was already shown).
function attachLibraryPortraits(draft, concepts) {
  if (!portraitLib.enabled()) return concepts;
  const shown = Array.isArray(draft.shownPortraits) ? draft.shownPortraits : [];
  let picks = portraitLib.match(draft.creationSelections, { count: concepts.length, exclude: shown, seed: draft.id + ":" + (draft.conceptSalt || 0) });
  if (picks.length < concepts.length) picks = portraitLib.match(draft.creationSelections, { count: concepts.length, seed: draft.id + ":" + (draft.conceptSalt || 0) });
  concepts.forEach((c, i) => { const e = picks[i]; if (e) { c.portrait = { id: e.id, file: e.file, tags: e.tags }; c.pfpUrl = portraitLib.urlFor(e); } });
  draft.shownPortraits = [...shown, ...picks.map((e) => e.id)].slice(-40);
  return concepts;
}`);
rep("src/brandcreate.js", `    throw creatorError("uniqueness_exhausted", "Could not make three distinct concepts. Try a different direction.", 409);
  }
  return concepts;
}`, `    throw creatorError("uniqueness_exhausted", "Could not make three distinct concepts. Try a different direction.", 409);
  }
  return attachLibraryPortraits(draft, concepts);
}`);
rep("src/brandcreate.js", `  const assetId = \`pfp_\${draft.id}_v\${version}\`;
  const assets = portraitAssets(draft.id, version);
  const material = portrait.visual.materialLanguage || ["carbon", "glass"];`, `  const assetId = \`pfp_\${draft.id}_v\${version}\`;
  const libEntry = portrait.libraryEntry || (portraitLib.enabled() ? portraitLib.match(selections, { count: 1, seed: draft.id })[0] : null);
  const assets = libEntry ? imagePortraitAssets(libEntry, draft.id, version) : portraitAssets(draft.id, version);
  const material = portrait.visual.materialLanguage || ["carbon", "glass"];`);
rep("src/brandcreate.js", `    pfpRecipe: portrait.recipe,
    assets,
    generation: {
      ...generationStamp({
        status: "READY",
        at: stamp,
        modelVersion: MODEL_VERSION,
        assetStatus: { pfpPortrait: "READY", avatar: "READY" },
      }),
      styleId: PFP_STYLE_ID,`, `    pfpRecipe: portrait.recipe,
    portrait: libEntry ? { id: libEntry.id, file: libEntry.file, tags: libEntry.tags } : null,
    assets,
    generation: {
      ...generationStamp({
        status: "READY",
        at: stamp,
        modelVersion: MODEL_VERSION,
        assetStatus: { pfpPortrait: "READY", avatar: "READY" },
      }),
      styleId: PFP_STYLE_ID,`);
rep("src/brandcreate.js", `  const assets = portraitAssets(draft.id, version);
  console.log("PFP_CONCEPT_SELECTED",`, `  const libEntry = concept.portrait && concept.portrait.file ? concept.portrait : null;
  const assets = libEntry ? imagePortraitAssets(libEntry, draft.id, version) : portraitAssets(draft.id, version);
  console.log("PFP_CONCEPT_SELECTED",`);
{ // buildPortraitBrand's brand object: add portrait line (its generation block differs from lockBrand's)
  const o = read("src/brandcreate.js");
  const marker = "    pfpRecipe: portrait.recipe,\n    assets,\n    generation: {\n";
  const idx = o.text.indexOf(marker);
  if (idx >= 0) o.text = o.text.slice(0, idx) + "    pfpRecipe: portrait.recipe,\n    portrait: libEntry ? { id: libEntry.id, file: libEntry.file, tags: libEntry.tags } : null,\n    assets,\n    generation: {\n" + o.text.slice(idx + marker.length);
  if ((o.text.match(/portrait: libEntry \? \{ id: libEntry\.id/g) || []).length !== 2) throw new Error("expected two brand objects to carry portrait");
}

// ---- brands.js
rep("src/brands.js", `const { inferSelectionsFromBrand } = require("./branding/creationSelections");`, `const { inferSelectionsFromBrand } = require("./branding/creationSelections");
const portraitLib = require("./portraitlib");`);
rep("src/brands.js", `      const versioned = (url) => withBrandVersion(url, brand.version ? brand : { version: view.version });
      view.pfpUrl = versioned((brand.assets && (brand.assets.canonicalPfp || brand.assets.pfpPortrait)) || urls.master);`, `      const versioned = (url) => withBrandVersion(url, brand.version ? brand : { version: view.version });
      // Library portrait: the brand's own, or the house cast's generated one.
      const libEntry = (brand.portrait && brand.portrait.file) ? brand.portrait : portraitLib.houseEntry(brand.agentId);
      const libUrl = libEntry ? versioned(portraitLib.urlFor(libEntry)) : null;
      if (libUrl) view.portrait = { id: libEntry.id, file: libEntry.file, url: libUrl, kind: "image" };
      view.pfpUrl = libUrl || versioned((brand.assets && (brand.assets.canonicalPfp || brand.assets.pfpPortrait)) || urls.master);`);
rep("src/brands.js", `      view.avatarUrl = versioned((brand.assets && brand.assets.avatar) || urls.avatar);
      view.avatarSizes = {`, `      view.avatarUrl = libUrl || versioned((brand.assets && brand.assets.avatar) || urls.avatar);
      view.avatarSizes = libUrl ? { 48: libUrl, 96: libUrl, 160: libUrl, 256: libUrl, 320: libUrl, 512: libUrl } : {`);

// ---- pfp.js stamp
rep("src/pfp.js", `const PFP_STYLE_STAMP = 5;`, `const PFP_STYLE_STAMP = 6;`);

// ---- showhttp.js redirect
rep("src/showhttp.js", `      const version = query && query.get ? query.get("v") : "";
      const svg = show.pfpSvgFor(decodeURIComponent(pfpGet[1]), size, version);`, `      const version = query && query.get ? query.get("v") : "";
      const imageUrl = show.portraitImageFor(decodeURIComponent(pfpGet[1]), version);
      if (imageUrl) { res.writeHead(302, { location: imageUrl, "cache-control": "no-cache" }); res.end(); return true; }
      const svg = show.pfpSvgFor(decodeURIComponent(pfpGet[1]), size, version);`);

// ---- showrunner.js
rep("src/showrunner.js", `const { inferSelectionsFromBrand } = require("./branding/creationSelections");`, `const { inferSelectionsFromBrand } = require("./branding/creationSelections");
const portraitLib = require("./portraitlib");`);
rep("src/showrunner.js", `  // Which agents still render through the pre-selection pipeline.
  legacyPortraitAgents() {`, `  // Library image URL for an agent's portrait (the brand's own, or the house cast's), else null.
  portraitImageFor(agentId, version) {
    const brand = version ? this.brands.full(agentId, "v" + version) || this.brands.full(agentId) : this.brands.full(agentId);
    if (!brand) return null;
    const entry = (brand.portrait && brand.portrait.file) ? brand.portrait : portraitLib.houseEntry(agentId);
    return entry ? withBrandVersion(portraitLib.urlFor(entry), { version: Number(brand.version) || 1 }) : null;
  }

  // Which agents still render through the pre-selection pipeline.
  legacyPortraitAgents() {`);
rep("src/showrunner.js", `      const hasVariant = Number.isFinite(Number(brand.pfpVariation));
      if (!hasSelections || !hasVariant) out.push(id);`, `      const hasVariant = Number.isFinite(Number(brand.pfpVariation));
      const needsImage = portraitLib.enabled() && !(brand.portrait && brand.portrait.file);
      if (!hasSelections || !hasVariant || needsImage) out.push(id);`);
rep("src/showrunner.js", `    const TARGET = 2;`, `    const TARGET = portraitLib.enabled() ? 3 : 2;`);
if (!/withBrandVersion/.test(read("src/showrunner.js").text.slice(0, 3000))) throw new Error("showrunner does not import withBrandVersion");

// ---- server.js previews
rep("server.js", `    const svg = previewSvg(preview[1], preview[2]);
    if (!svg) { res.writeHead(404); return res.end("not found"); }`, `    const previewImage = (() => { try { const lib = require("./src/portraitlib"); const cs = require("./src/branding/creationSelections"); if (!lib.enabled()) return null; const sel = cs.previewSelections(preview[1], preview[2]); if (!sel) return null; const e = lib.match(sel, { count: 1, seed: preview[1] + "/" + preview[2] })[0]; return e ? lib.urlFor(e) : null; } catch { return null; } })();
    if (previewImage) { res.writeHead(302, { location: previewImage, "cache-control": "public, max-age=3600" }); return res.end(); }
    const svg = previewSvg(preview[1], preview[2]);
    if (!svg) { res.writeHead(404); return res.end("not found"); }`);

// ---- client
rep("public/app.js", `function pfpPath(url) {
  const text = String(url || "");`, `function pfpPath(url) {
  const text = String(url || "");
  if (/^\\/assets\\/portraits\\/[a-z0-9_.-]+\\.(?:webp|png|jpg)(?:\\?(?:[a-z]+=[a-z0-9]+)(?:&[a-z]+=[a-z0-9]+)*)?$/i.test(text)) return text;`);
rep("public/app.js", `function pfpFrame(svg) {
  const art = safeSvg(svg);
  if (!art) return "";
  return \`<span class="pfp-frame">\${art}</span>\`;
}`, `function pfpFrame(svg) {
  const art = safeSvg(svg);
  if (!art) return "";
  return \`<span class="pfp-frame">\${art}</span>\`;
}
// A concept's art: a generated library image when it has one, else its SVG.
function conceptArt(c) {
  if (c && c.pfpUrl && pfpPath(c.pfpUrl)) return \`<span class="pfp-frame"><img src="\${esc(c.pfpUrl)}" alt="" loading="lazy"></span>\`;
  return pfpFrame(c && c.pfpSvg);
}`);
{ const o = read("public/app.js");
  o.text = o.text.split(`<span class="pfp-concept__image-wrap">\${pfpFrame(c.pfpSvg)}<span class="pfp-concept__ring"></span></span>`).join(`<span class="pfp-concept__image-wrap">\${conceptArt(c)}<span class="pfp-concept__ring"></span></span>`);
  o.text = o.text.replace(`data-agent="\${esc(revealId)}">\${pfpFrame(reveal.svg || (c && c.pfpSvg))}</div>`, `data-agent="\${esc(revealId)}">\${(c && c.pfpUrl) ? conceptArt(c) : pfpFrame(reveal.svg || (c && c.pfpSvg))}</div>`);
  if (!o.text.includes("conceptArt(c)}<span class=\"pfp-concept__ring\"")) throw new Error("concept cards not switched to conceptArt"); }
rep("public/app.css", `.visual-group { margin: 0 0 18px; }`, `.pfp-frame img { width: 100%; height: 100%; display: block; object-fit: cover; border-radius: inherit; }
.visual-group { margin: 0 0 18px; }`);
{ const o = read("public/app.html"); o.text = o.text.replace(/\/static\/app\.js\?v=(\d+)/, (m, n) => "/static/app.js?v=" + (Number(n) + 1)); }

// ---- tests
rep("test/run.js", `  execFileSync(process.execPath, [path.join(__dirname, f)], { stdio: "inherit" });`, `  // Existing tests assert the SVG rig; the library test brings its own fixture library.
  const env = { ...process.env, PORTRAIT_LIB: f === "portraitlib.test.js" ? "" : "off" };
  execFileSync(process.execPath, [path.join(__dirname, f)], { stdio: "inherit", env });`);
for (const f of ["test/brandcreate.test.js", "test/creationpfp.test.js", "test/neonnoir.test.js"]) { const o = read(f); o.text = o.text.split('&s=5"').join('&s=6"').split("s=5(").join("s=6(").replace("eq(PFP_STYLE_STAMP, 5,", "eq(PFP_STYLE_STAMP, 6,").replace('includes("s=5")', 'includes("s=6")'); }

for (const [f, o] of Object.entries(files)) { if (o.text !== o.orig) { fs.writeFileSync(path.join(root, f), o.crlf ? o.text.replace(/\n/g, "\r\n") : o.text); console.log("patched", f); } else console.log("(no change)", f); }
console.log("done");
