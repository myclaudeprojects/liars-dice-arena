// Auto-sync: keep the site's portrait library ahead of demand.
//   node scripts/sync-portraits.js --every 120     (minutes; runs once immediately, then on the interval)
//   node scripts/sync-portraits.js --once
// Each cycle: git pull --ff-only, ingest up to (assigned + AHEAD) bank portraits from pfp-forge,
// commit and push only if the library changed. A push redeploys the site (~2 min).
const { execSync } = require("child_process"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const AHEAD = Number(process.env.PORTRAIT_AHEAD || 500);
const SITE = process.env.SITE_URL || "https://liarsdicearc.app";
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const sh = (cmd) => execSync(cmd, { cwd: root, stdio: "pipe" }).toString().trim();
const log = (m) => console.log(new Date().toISOString().slice(11, 19), m);

async function assignedCount() {
  try { const j = await (await fetch(SITE + "/api/show/agents")).json(); const rows = j.agents || []; return rows.length; } catch { return 60; }
}

async function cycle() {
  try { sh("git pull -q --ff-only origin main"); } catch (e) { log("pull failed (local changes?): " + e.message.split("\n")[0]); return; }
  const assigned = await assignedCount();
  const target = assigned + AHEAD;
  const before = fs.existsSync(path.join(root, "public/assets/portraits/manifest.json")) ? JSON.parse(fs.readFileSync(path.join(root, "public/assets/portraits/manifest.json"), "utf8")).entries.length : 0;
  const out = sh(`node scripts/ingest-portraits.js "${path.join(process.env.USERPROFILE || process.env.HOME, "Desktop", "pfp-forge", "out")}" --max ${target}`);
  const after = JSON.parse(fs.readFileSync(path.join(root, "public/assets/portraits/manifest.json"), "utf8")).entries.length;
  const changed = sh("git status --porcelain -- public/assets/portraits").length > 0;
  log(`${out} | assigned ${assigned}, target ${target}, library ${before} -> ${after}${changed ? "" : " (no change)"}`);
  if (!changed) return;
  sh("git add public/assets/portraits");
  sh(`git -c core.safecrlf=false -c user.name=Vik -c user.email=vik@users.noreply.github.com commit -q -m "Portrait library sync: ${after} portraits"`);
  sh("git push -q origin main");
  log(`pushed ${after - before} new portraits`);
}

(async () => {
  await cycle();
  if (process.argv.includes("--once")) return;
  const every = Number(arg("--every", 120)) * 60 * 1000;
  log(`auto-sync running every ${every / 60000} min`);
  setInterval(() => cycle().catch((e) => log("cycle error: " + e.message)), every);
})();
