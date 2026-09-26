const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const rw = (f, fn) => { const p = path.join(root, f); const raw = fs.readFileSync(p, "utf8"); const crlf = raw.includes("\r\n"); const a = raw.replace(/\r\n/g, "\n"); const b = fn(a); fs.writeFileSync(p, crlf ? b.replace(/\n/g, "\r\n") : b); console.log(f, a === b ? "(no change)" : "patched"); };
const rep = (s, a, b) => { if (s.includes(b) && b !== "") return s; if (!s.includes(a)) throw new Error("anchor missing: " + a.slice(0, 70)); return s.replace(a, b); };

rw("src/brandcreate.js", (s) => {
  // concepts: exclude portraits held by anyone else, not just ones this draft has seen
  s = rep(s, `function attachLibraryPortraits(draft, concepts) {
  if (!portraitLib.enabled()) return concepts;
  const shown = Array.isArray(draft.shownPortraits) ? draft.shownPortraits : [];
  let picks = portraitLib.match(draft.creationSelections, { count: concepts.length, exclude: shown, seed: draft.id + ":" + (draft.conceptSalt || 0) });
  if (picks.length < concepts.length) picks = portraitLib.match(draft.creationSelections, { count: concepts.length, seed: draft.id + ":" + (draft.conceptSalt || 0) });`,
`function attachLibraryPortraits(draft, concepts, taken) {
  if (!portraitLib.enabled()) return concepts;
  const shown = Array.isArray(draft.shownPortraits) ? draft.shownPortraits : [];
  const held = Array.isArray(taken) ? taken : [];   // portraits already belonging to other agents: never offered
  const seed = draft.id + ":" + (draft.conceptSalt || 0);
  let picks = portraitLib.match(draft.creationSelections, { count: concepts.length, exclude: [...held, ...shown], seed });
  if (picks.length < concepts.length) picks = portraitLib.match(draft.creationSelections, { count: concepts.length, exclude: held, seed });
  if (picks.length < concepts.length) picks = portraitLib.match(draft.creationSelections, { count: concepts.length, seed });`);
  s = rep(s, `  return attachLibraryPortraits(draft, concepts);
}`, `  return attachLibraryPortraits(draft, concepts, opts.takenPortraits);
}`);
  s = rep(s, `  const libEntry = portrait.libraryEntry || (portraitLib.enabled() ? portraitLib.match(selections, { count: 1, seed: draft.id })[0] : null);`,
             `  const libEntry = portrait.libraryEntry || (portraitLib.enabled() ? portraitLib.match(selections, { count: 1, exclude: portrait.takenPortraits || [], seed: draft.id })[0] || portraitLib.match(selections, { count: 1, seed: draft.id })[0] : null);`);
  return s;
});

rw("src/showrunner.js", (s) => {
  s = rep(s, `  // A draft that has not finished creation has no brand yet. Rather than a letter, the
  // roster shows the closest library portrait for its options; the chosen one replaces it.
  provisionalBrand(draft) {
    if (!draft || !portraitLib.enabled()) return null;
    const entry = portraitLib.match(normalizeSelections(draft.creationSelections), { count: 1, seed: "draft:" + draft.id })[0];
    if (!entry) return null;`,
`  // Every library portrait is single-use: the ids currently held by any agent (house cast,
  // locked brands in any version, and drafts' provisional picks), except \`exceptId\`'s own.
  takenPortraits(exceptId) {
    const used = new Set();
    for (const row of this.brands._versions.values()) if (row.portrait && row.portrait.id && row.agentId !== exceptId) used.add(row.portrait.id);
    for (const e of portraitLib.load().entries) if (e.house) used.add(e.id);
    for (const d of this.userAgents.values()) if (d.provisionalPortrait && d.id !== exceptId) used.add(d.provisionalPortrait);
    return [...used];
  }

  // A draft that has not finished creation has no brand yet. Rather than a letter, the
  // roster shows a library portrait nobody else holds; the chosen one replaces it.
  provisionalBrand(draft) {
    if (!draft || !portraitLib.enabled()) return null;
    let entry = draft.provisionalPortrait ? portraitLib.byId(draft.provisionalPortrait) : null;
    if (!entry) {
      const sel = normalizeSelections(draft.creationSelections);
      entry = portraitLib.match(sel, { count: 1, exclude: this.takenPortraits(draft.id), seed: "draft:" + draft.id })[0] || portraitLib.match(sel, { count: 1, seed: "draft:" + draft.id })[0];
      if (entry) { draft.provisionalPortrait = entry.id; this.persist(); }
    }
    if (!entry) return null;`);
  s = rep(s, `      anchor,
      brands: this.brandPool(),
    });
    draft.concepts = PFP_TOUCHES.includes(vary) ? retouchConcepts({ ...draft, concepts }, vary) : concepts;`,
`      anchor,
      brands: this.brandPool(),
      takenPortraits: this.takenPortraits(agentId),
    });
    draft.concepts = PFP_TOUCHES.includes(vary) ? retouchConcepts({ ...draft, concepts }, vary) : concepts;`);
  s = rep(s, `    const locked = buildPortraitBrand(draft, portrait, previous);
    try {
      this.brands.appendVersion(locked.brand);`,
`    portrait.takenPortraits = this.takenPortraits(agentId);
    const locked = buildPortraitBrand(draft, portrait, previous);
    try {
      this.brands.appendVersion(locked.brand);`);
  return s;
});
