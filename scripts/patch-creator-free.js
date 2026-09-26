const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const rw = (f, fn) => { const p = path.join(root, f); const raw = fs.readFileSync(p, "utf8"); const crlf = raw.includes("\r\n"); const a = raw.replace(/\r\n/g, "\n"); const b = fn(a); fs.writeFileSync(p, crlf ? b.replace(/\n/g, "\r\n") : b); console.log(f, a === b ? "(no change)" : "patched"); };
const rep = (s, a, b) => { if (s.includes(b)) return s; if (!s.includes(a)) throw new Error("anchor missing: " + a.slice(0, 70)); return s.replace(a, b); };

// ---------------- server: no requirements — generate what is missing, trim what is long
rw("src/brandcreate.js", (s) => {
  s = rep(s, `function cleanName(value) {
  const name = String(value || "").replace(/\\s+/g, " ").trim();
  if (!/^[A-Za-z][A-Za-z0-9 '\\-]{1,31}$/.test(name)) {`, `// Nothing is required to make an agent: a missing name is invented, a missing description
// is written from the archetype, and anything too long is trimmed rather than rejected.
const NAME_FIRST = ["Neon", "Velvet", "Iron", "Silent", "Lucky", "Midnight", "Golden", "Static", "Crimson", "Cobalt", "Ghost", "Ember", "Jade", "Solar", "Vandal", "Royal", "Sable", "Viper", "Halo", "Rogue"];
const NAME_LAST = ["Vega", "Ace", "Marlow", "Kessler", "Rook", "Dice", "Quinn", "Nova", "Blaze", "Cassidy", "Voss", "Rex", "Mercer", "Loki", "Sato", "Dune", "Cruz", "Rain", "Knox", "Vale"];
function randomName(taken) {
  const used = new Set((taken || []).map((n) => String(n).toLowerCase()));
  for (let i = 0; i < 200; i++) {
    const base = NAME_FIRST[Math.floor(Math.random() * NAME_FIRST.length)] + " " + NAME_LAST[Math.floor(Math.random() * NAME_LAST.length)];
    const name = i < 40 ? base : base + " " + (2 + Math.floor(Math.random() * 97));
    if (!used.has(name.toLowerCase())) return name;
  }
  return "Agent " + Date.now().toString().slice(-5);
}

function cleanName(value, taken) {
  let name = String(value || "").replace(/[^A-Za-z0-9 '\\-]/g, " ").replace(/\\s+/g, " ").trim().slice(0, 32).replace(/^[^A-Za-z]+/, "");
  if (name.length < 2) return randomName(taken);
  return name;
}

function cleanNameStrict(value) {
  const name = String(value || "").replace(/\\s+/g, " ").trim();
  if (!/^[A-Za-z][A-Za-z0-9 '\\-]{1,31}$/.test(name)) {`);
  s = rep(s, `function cleanDescription(value) {
  const text = String(value || "").replace(/\\s+/g, " ").trim();
  if (text.length < 8 || text.length > 240) {
    throw creatorError("bad_description", "Add a short description, between 8 and 240 characters.");
  }
  return text;
}`, `const AUTO_DESCRIPTIONS = ["Plays the table, not the dice.", "Bluffs early, collects late.", "Never shows the same face twice.", "Counts everything and admits nothing.", "Loud hands, quiet math.", "Lets the others talk themselves out of it.", "Patient until the pot is worth it.", "Reads tells, sells lies."];
function cleanDescription(value, archetype) {
  const text = String(value || "").replace(/\\s+/g, " ").trim().slice(0, 240);
  if (text.length >= 8) return text;
  const line = AUTO_DESCRIPTIONS[Math.floor(Math.random() * AUTO_DESCRIPTIONS.length)];
  return archetype ? \`\${archetypeLabel(archetype)}. \${line}\` : line;
}`);
  s = rep(s, `  const name = cleanName(body.name);
  const shortDescription = cleanDescription(body.shortDescription || body.description);`, `  const name = cleanName(body.name, ctx && ctx.names);
  const shortDescription = cleanDescription(body.shortDescription || body.description, body.archetype);`);
  return s;
});

// ---------------- client: drop the gates, remove Visual direction, Choose look = random look
rw("public/app.js", (s) => {
  // Remove every `if (...) { creator.error = "Add a name, ..."; ...; return; }` gate, whatever its condition.
  let gi;
  while ((gi = s.indexOf("at least 8 characters under Advanced.")) >= 0) {
    const start = s.lastIndexOf("\n  if (", gi) + 1;
    const end = s.indexOf("\n  }\n", gi) + 5;
    if (start <= 0 || end < gi) throw new Error("could not bound a gate block");
    s = s.slice(0, start) + s.slice(end);
  }
  if (s.includes("at least 8 characters")) throw new Error("gate text still present");
  s = rep(s, `      <label>Visual direction<textarea name="visualDirection" maxlength="160" placeholder="Elegant gothic gambler, crimson rim light.">\${esc(f.visualDirection)}</textarea></label>
`, ``);
  s = rep(s, `      <label>Name<input type="text" name="name" maxlength="32" value="\${esc(f.name)}" autocomplete="off" placeholder="Dracula"></label>`,
             `      <label>Name <span class="fine">(optional — leave blank and we name them)</span><input type="text" name="name" maxlength="32" value="\${esc(f.name)}" autocomplete="off" placeholder="Dracula"></label>`);
  s = rep(s, `          <label>Short description<textarea name="shortDescription" maxlength="240" placeholder="A quiet closer who spends one lie and waits.">`,
             `          <label>Short description <span class="fine">(optional)</span><textarea name="shortDescription" maxlength="240" placeholder="A quiet closer who spends one lie and waits.">`);
  // random look
  s = rep(s, `function chooseLook() {
  if (!creator || creator.busy) return;
  syncCreatorFromDom();`, `// Pick a random option in every group (never "auto"/"none" so the roll always shows).
function randomizeLook() {
  const out = {};
  for (const [group, , ids] of visualGroupList()) {
    const pool = ids.filter((id) => id !== "auto" && id !== "none" && id !== "custom");
    out[group] = pool[Math.floor(Math.random() * pool.length)] || ids[0];
  }
  return out;
}

function chooseLook() {
  if (!creator || creator.busy) return;
  syncCreatorFromDom();
  creator.selections = randomizeLook();`);
  s = rep(s, `      \${visualOptionGrids(creator.selections)}
      <label>Refine<textarea name="refine"`, `      <button class="ghost lda-btn" type="button" data-random-look="1">🎲 Randomize again</button>
      \${visualOptionGrids(creator.selections)}
      <label>Refine<textarea name="refine"`);
  s = rep(s, `  if (e.target.closest("[data-creator-next]")) { chooseLook(); return; }`, `  if (e.target.closest("[data-creator-next]")) { chooseLook(); return; }
  if (e.target.closest("[data-random-look]") && creator && !creator.busy) { creator.selections = randomizeLook(); painted = ""; render(); return; }`);
  s = rep(s, `  const nextLabel = step === 1 ? "Choose look" : step === 2 ? "Generate agent" : "Enter the Arena";`, `  const nextLabel = step === 1 ? "🎲 Random look" : step === 2 ? "Generate agent" : "Enter the Arena";`);
  return s;
});
rw("public/app.html", (s) => s.replace(/\/static\/app\.js\?v=(\d+)/, (m, n) => "/static/app.js?v=" + (Number(n) + 1)));
