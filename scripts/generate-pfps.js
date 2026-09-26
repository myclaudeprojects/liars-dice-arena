#!/usr/bin/env node
// Generate Liar's Dice Arena portraits.
//
//   node scripts/generate-pfps.js
//   node scripts/generate-pfps.js --agents fox,brutus,dracula
//   node scripts/generate-pfps.js --out artifacts/pfp-samples --no-png
//
// Writes one SVG per agent plus a contact sheet (circle crops at 96, 128,
// and a larger plate). PNG previews use headless Chrome when it is on PATH.
// The same drawing is what /api/show/agents/:id/pfp.svg serves (src/pfparena.js).
// PFP_RIG=v3 still renders the old neon-noir bust.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { SEED_BRANDS } = require("../src/brands");
const { recipeFromBrand, renderPfp } = require("../src/pfp");

const HOUSE_ORDER = ["fox", "brutus", "dracula", "caesar", "reaper", "athena", "shark", "oracle", "monk", "siren", "miser", "jester"];

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  if (!next || next.startsWith("--")) return fallback;
  return next;
}

function has(flag) {
  return process.argv.includes(flag);
}

function parseAgents() {
  const raw = arg("--agents", "");
  if (!raw || raw === "all") return HOUSE_ORDER.slice();
  return raw.split(",").map((s) => s.trim().toLowerCase().replace(/^the\s+/, "")).filter(Boolean);
}

function sheetHtml(entries) {
  const cards = entries.map((e) => `<figure>
    <img class="hero" src="${e.file}" alt="${e.name}" width="280" height="280">
    <div class="row">
      <img class="c128" src="${e.file}" alt="" width="128" height="128">
      <img class="c96" src="${e.file}" alt="" width="96" height="96">
    </div>
    <figcaption><b>${e.name}</b><span>${e.title}</span></figcaption>
  </figure>`).join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>LDA arena portraits</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #0e0d0b; color: #f4efe6; font: 15px/1.4 Georgia, "Iowan Old Style", serif; }
  header { padding: 28px 32px 8px; }
  header p { margin: 6px 0 0; color: #b7ad9f; font-family: "Avenir Next", system-ui, sans-serif; font-size: 14px; max-width: 62ch; }
  h1 { font-weight: 560; font-size: 32px; margin: 0; letter-spacing: -0.03em; }
  main { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 28px; padding: 24px 32px 48px; }
  figure { margin: 0; }
  img { display: block; background: #100e0c; }
  .hero { width: 100%; height: auto; border-radius: 28px; box-shadow: 0 18px 48px rgba(0,0,0,.42); }
  .row { display: flex; gap: 16px; align-items: flex-end; margin-top: 14px; }
  .c128, .c96 { border-radius: 50%; object-fit: cover; border: 2px solid #e4c27a; }
  .c128 { width: 128px; height: 128px; }
  .c96 { width: 96px; height: 96px; }
  figcaption { margin-top: 10px; }
  figcaption b { display: block; font-size: 22px; font-weight: 560; }
  figcaption span { color: #e4c27a; font-family: "Avenir Next", system-ui, sans-serif; font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; }
</style>
</head>
<body>
<header>
  <h1>Arena portraits</h1>
  <p>Felt-roster busts for Liar’s Dice Arena. The large plate is the matchup size. The circles are Up Next at 128 and 96.</p>
</header>
<main>
${cards}
</main>
</body>
</html>
`;
}

function chromeBin() {
  for (const bin of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    try {
      execFileSync("which", [bin], { stdio: "ignore" });
      return bin;
    } catch { /* next */ }
  }
  return "";
}

function shoot(bin, htmlPath, pngPath, width, height) {
  // Headless Chrome writes the PNG and then often refuses to exit.
  try {
    execFileSync("timeout", [
      "20", bin,
      "--headless",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      `--window-size=${width},${height}`,
      `--screenshot=${pngPath}`,
      "file://" + htmlPath,
    ], { stdio: "pipe" });
  } catch (err) {
    if (!fs.existsSync(pngPath) || fs.statSync(pngPath).size < 1000) throw err;
  }
}

function main() {
  const outDir = path.resolve(arg("--out", path.join("artifacts", "pfp-samples")));
  const want = new Set(parseAgents());
  const brands = HOUSE_ORDER
    .filter((id) => want.has(id))
    .map((id) => SEED_BRANDS.find((b) => b.agentId === id))
    .filter(Boolean);
  const missing = [...want].filter((id) => !brands.some((b) => b.agentId === id));
  if (!brands.length) {
    console.error("No matching agents. House ids: " + HOUSE_ORDER.join(", "));
    process.exit(1);
  }
  if (missing.length) console.error("Skipped unknown ids: " + missing.join(", "));
  fs.mkdirSync(outDir, { recursive: true });

  const entries = [];
  for (const brand of brands) {
    const recipe = recipeFromBrand(brand);
    const svg = renderPfp(recipe, { size: 1024, nonce: brand.agentId });
    const file = `${brand.agentId}.svg`;
    fs.writeFileSync(path.join(outDir, file), svg);
    entries.push({
      file,
      id: brand.agentId,
      name: brand.name,
      title: brand.title,
      accent: brand.visualIdentity.accentColor,
    });
    console.log(`${file}  ${brand.name} — ${brand.title}  ${brand.visualIdentity.accentColor}`);
  }

  const html = sheetHtml(entries);
  const sheetPath = path.join(outDir, "sheet.html");
  fs.writeFileSync(sheetPath, html);
  console.log("sheet.html");

  if (!has("--no-png")) {
    const bin = chromeBin();
    if (!bin) {
      console.log("No Chrome on PATH. SVGs and sheet.html are written. Open sheet.html to preview the circle crops.");
    } else {
      const cols = Math.min(entries.length, 4);
      const width = Math.max(640, cols * 340 + 64);
      const rows = Math.ceil(entries.length / cols);
      const height = 120 + rows * 520;
      const png = path.join(outDir, "avatars.png");
      try {
        shoot(bin, sheetPath, png, width, height);
        console.log("avatars.png  " + width + "x" + height);
      } catch (err) {
        console.error("PNG preview failed: " + (err && err.message ? err.message : err));
      }
    }
  }
}

main();
