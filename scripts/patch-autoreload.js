// Auto-reload the client when a new build deploys. The server stamps every snapshot with its
// build id (Render's git commit, else boot time); the client reloads once when it changes.
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const rw = (f, fn) => { const p = path.join(root, f); const raw = fs.readFileSync(p, "utf8"); const crlf = raw.includes("\r\n"); const a = raw.replace(/\r\n/g, "\n"); const b = fn(a); fs.writeFileSync(p, crlf ? b.replace(/\n/g, "\r\n") : b); console.log(f, a === b ? "(no change)" : "patched"); };
const rep = (s, from, to) => { if (s.includes(to)) return s; if (!s.includes(from)) throw new Error("anchor missing: " + from.slice(0, 70)); return s.replace(from, to); };

rw("src/showrunner.js", (s) => {
  s = rep(s, `  snapshot(predictorId) {
    const cur = this.current;
    return {
      phase: this.phase,
      serverNow: Date.now(),`, `  snapshot(predictorId) {
    const cur = this.current;
    return {
      build: BUILD_ID,
      phase: this.phase,
      serverNow: Date.now(),`);
  // define BUILD_ID near the top (after the first require block)
  if (!s.includes("const BUILD_ID")) {
    s = s.replace(/(const \{ inferSelectionsFromBrand \} = require\("\.\/branding\/creationSelections"\);\n)/,
      `$1// Identifies the running build so clients can reload when a deploy lands.
const BUILD_ID = String(process.env.RENDER_GIT_COMMIT || process.env.BUILD_ID || Date.now()).slice(0, 12);
`);
    if (!s.includes("const BUILD_ID")) throw new Error("could not place BUILD_ID");
  }
  return s;
});

rw("public/app.js", (s) => {
  s = rep(s, `    const j = await api("/api/show?predictor=" + encodeURIComponent(me.id));
    if (gen !== pollGen) return;
    incoming = { failed: false, starting: !!j.starting, snap: j };`, `    const j = await api("/api/show?predictor=" + encodeURIComponent(me.id));
    if (gen !== pollGen) return;
    // A new build deployed under us: reload once so this page never runs stale code.
    if (j && j.build) {
      if (window.__ldaBuild && window.__ldaBuild !== j.build && !creatorSession()) { location.reload(); return; }
      window.__ldaBuild = j.build;
    }
    incoming = { failed: false, starting: !!j.starting, snap: j };`);
  return s;
});

rw("public/app.html", (s) => s.replace('/static/app.js?v=24', '/static/app.js?v=25'));
console.log("done");
