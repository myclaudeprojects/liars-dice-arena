const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const rw = (f, fn) => { const p = path.join(root, f); const raw = fs.readFileSync(p, "utf8"); const crlf = raw.includes("\r\n"); const a = raw.replace(/\r\n/g, "\n"); const b = fn(a); fs.writeFileSync(p, crlf ? b.replace(/\n/g, "\r\n") : b); console.log(f, a === b ? "(no change)" : "patched"); };
const rep = (s, a, b) => { if (s.includes(b)) return s; if (!s.includes(a)) throw new Error("anchor missing: " + a.slice(0, 70)); return s.replace(a, b); };
rw("src/showrunner.js", (s) => {
  s = rep(s, `  agentSummary(draft) {
    return {
      id: draft.id,
      name: draft.name,
      status: draft.status,
      roster: "user",
      archetype: draft.archetype,
      archetypeLabel: draft.archetypeLabel,
      argus: publicArgus(draft.argus),
    };
  }`, `  // A draft that has not finished creation has no brand yet. Rather than a letter, the
  // roster shows the closest library portrait for its options; the chosen one replaces it.
  provisionalBrand(draft) {
    if (!draft || !portraitLib.enabled()) return null;
    const entry = portraitLib.match(normalizeSelections(draft.creationSelections), { count: 1, seed: "draft:" + draft.id })[0];
    if (!entry) return null;
    const url = withBrandVersion(portraitLib.urlFor(entry), { version: 1 });
    return { provisional: true, version: 0, status: draft.status, pfpStatus: draft.status, pfpUrl: url, canonicalPfp: url, avatarUrl: url,
      avatarSizes: { 48: url, 96: url, 160: url, 256: url, 320: url, 512: url }, portrait: { id: entry.id, file: entry.file, url, kind: "image", provisional: true } };
  }

  agentSummary(draft) {
    return {
      id: draft.id,
      name: draft.name,
      status: draft.status,
      roster: "user",
      archetype: draft.archetype,
      archetypeLabel: draft.archetypeLabel,
      argus: publicArgus(draft.argus),
      brand: draft.status === "READY" ? this.brands.publicOf(draft.id) : this.provisionalBrand(draft),
    };
  }`);
  s = rep(s, `      brand: ready ? this.brands.publicOf(c.id) : null,
      roster,`, `      brand: ready ? this.brands.publicOf(c.id) : this.provisionalBrand(draft),
      roster,`);
  return s;
});
