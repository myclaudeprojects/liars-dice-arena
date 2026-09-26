// Copy generated portraits from pfp-forge into the site's library and write the manifest.
//   node scripts/ingest-portraits.js C:\Users\Vik\Desktop\pfp-forge\out
// Reads out/bank/manifest.json and out/house/manifest.json (+ the .webp files) and writes
// public/assets/portraits/{*.webp, manifest.json}. Re-runnable; existing files are overwritten.
const fs = require("fs"), path = require("path");
const src = path.resolve(process.argv[2] || path.join(process.env.USERPROFILE || process.env.HOME || ".", "Desktop", "pfp-forge", "out"));
const dest = path.join(__dirname, "..", "public", "assets", "portraits");
fs.mkdirSync(dest, { recursive: true });
const entries = [];
for (const set of ["bank", "house"]) {
  const mf = path.join(src, set, "manifest.json");
  if (!fs.existsSync(mf)) { console.log(`(no ${set} manifest yet)`); continue; }
  for (const row of JSON.parse(fs.readFileSync(mf, "utf8"))) {
    const webp = path.join(src, set, row.file.replace(/\.png$/i, ".webp"));
    if (!fs.existsSync(webp)) continue;
    const file = path.basename(webp);
    fs.copyFileSync(webp, path.join(dest, file));
    const tags = { ...row.tags }; delete tags.n; delete tags.variant;
    const house = set === "house" ? file.replace(/_\d+\.webp$/, "") : null;
    entries.push({ id: file.replace(/\.webp$/, ""), file, tags, house });
  }
}
fs.writeFileSync(path.join(dest, "manifest.json"), JSON.stringify({ generated: new Date().toISOString(), entries }, null, 1));
const bytes = entries.reduce((s, e) => s + fs.statSync(path.join(dest, e.file)).size, 0);
console.log(`library: ${entries.length} portraits (${entries.filter((e) => e.house).length} house), ${(bytes / 1048576).toFixed(1)} MB -> ${dest}`);
