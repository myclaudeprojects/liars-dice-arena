// One-off patch: migrate existing agents to the new portrait design. Idempotent.
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const rw = (f, fn) => { const p = path.join(root, f); const raw = fs.readFileSync(p, "utf8"); const crlf = raw.includes("\r\n"); const a = raw.replace(/\r\n/g, "\n"); const b = fn(a); fs.writeFileSync(p, crlf ? b.replace(/\n/g, "\r\n") : b); console.log(f, a === b ? "(no change)" : "patched"); };
const rep = (s, from, to) => { if (s.includes(to)) return s; if (!s.includes(from)) throw new Error("anchor missing: " + from.slice(0, 70)); return s.replace(from, to); };

// 1) House cast + any brand without stored selections: render from INFERRED selections in the
//    new style (not archetype defaults). Legacy look stays available via PFP_LEGACY_FALLBACK=1.
rw("src/pfp.js", (s) => {
  s = rep(s, `const { mapSelections, conceptVariantFor } = require("./branding/creationSelections");`,
             `const { mapSelections, conceptVariantFor, inferSelectionsFromBrand } = require("./branding/creationSelections");`);
  s = rep(s, `  const selections = row.creationSelections || (row.generation && row.generation.selections) || null;
  const hasSelections = selections && typeof selections === "object" && selections.archetype;`,
`  let selections = row.creationSelections || (row.generation && row.generation.selections) || null;
  let hasSelections = !!(selections && typeof selections === "object" && selections.archetype);
  // Brands from before the selection pipeline (house cast, early user agents) carry no
  // selections. Infer them so those portraits render in the current style too.
  if (!hasSelections && process.env.PFP_LEGACY_FALLBACK !== "1") {
    try { const inferred = inferSelectionsFromBrand(row); if (inferred && inferred.archetype) { selections = inferred; hasSelections = true; } } catch { /* keep legacy path */ }
  }`);
  return s;
});

// 2) User agents: one-time boot migration → new version per legacy brand (non-destructive).
rw("src/showrunner.js", (s) => {
  s = rep(s, `      bootstrapDone: this.bootstrapDone,`, `      bootstrapDone: this.bootstrapDone,
      pfpMigration: this.pfpMigration || 0,`);
  s = rep(s, `    this.bootstrapDone = !!data.bootstrapDone;`, `    this.bootstrapDone = !!data.bootstrapDone;
    this.pfpMigration = Number(data.pfpMigration) || 0;`);
  s = rep(s, `  async generatePortrait(agentId, input = {}) {`,
`  // Which agents still render through the pre-selection pipeline.
  legacyPortraitAgents() {
    const out = [];
    for (const [id, draft] of this.userAgents) {
      if (draft.status !== "READY") continue;
      const brand = this.brands.full(id);
      if (!brand) continue;
      const hasSelections = brand.creationSelections && brand.creationSelections.archetype;
      const hasVariant = Number.isFinite(Number(brand.pfpVariation));
      if (!hasSelections || !hasVariant) out.push(id);
    }
    return out;
  }

  // One-time migration to the current portrait design. Every legacy user brand gets a NEW
  // version rendered from inferred selections; old versions stay reachable by ?v=. Runs in
  // the background after boot, sequentially, and records completion so it never re-runs.
  async migrateLegacyPortraits(force = false) {
    const TARGET = 2;
    if (!force && this.pfpMigration >= TARGET) return { migrated: 0, skipped: "done" };
    const ids = this.legacyPortraitAgents();
    let migrated = 0; const failed = [];
    for (const id of ids) {
      try {
        const brand = this.brands.full(id);
        const inferred = inferSelectionsFromBrand(brand);
        await this.generatePortrait(id, { creationSelections: inferred });
        migrated++;
        console.log("PFP_MIGRATED", { agentId: id, version: (this.brands.full(id) || {}).version, selections: inferred });
      } catch (e) {
        failed.push({ id, error: (e && e.message) || String(e) });
        console.error("PFP_MIGRATE_FAILED", { agentId: id, error: (e && e.message) || String(e) });
      }
    }
    this.pfpMigration = TARGET;
    this.persist();
    console.log("PFP_MIGRATION_DONE", { migrated, failed: failed.length, candidates: ids.length });
    return { migrated, failed, candidates: ids.length };
  }

  async generatePortrait(agentId, input = {}) {`);
  // make sure inferSelectionsFromBrand is imported in showrunner
  if (!/inferSelectionsFromBrand/.test(s.split("\n").slice(0, 60).join("\n"))) {
    s = rep(s, `const { normalizeSelections`, `const { inferSelectionsFromBrand, normalizeSelections`);
  }
  return s;
});

// 3) Kick the migration after boot (server.js), and expose an admin trigger for re-runs.
rw("server.js", (s) => {
  if (s.includes("migrateLegacyPortraits")) return s;
  const m = s.match(/const show = new Show\([^;]*\);/);
  if (!m) throw new Error("could not find Show construction in server.js");
  return s.replace(m[0], m[0] + `
// Migrate pre-selection agents to the current portrait design (one-time, background).
setTimeout(() => { show.migrateLegacyPortraits().catch((e) => console.error("pfp migration:", e && e.message)); }, 3000);`);
});
console.log("done");
