const fs = require("fs"); const p = __dirname + "/../src/pfp.js"; const raw = fs.readFileSync(p, "utf8"); const crlf = raw.includes("\r\n"); let s = raw.replace(/\r\n/g, "\n");
const rep = (a, b) => { if (s.includes(b)) return; if (!s.includes(a)) throw new Error("anchor: " + a.slice(0, 60)); s = s.replace(a, b); };
rep(`function withBrandVersion(url, agent) {
  if (!url) return url;
  const row = agent && typeof agent === "object" ? agent : {};
  const brand = row.brand && typeof row.brand === "object" ? row.brand : row;
  const version = Number(brand.version || row.version || 1);
  const n = Number.isFinite(version) && version > 0 ? version : 1;
  const text = String(url);
  if (/[?&]v=\\d+/.test(text)) return text;
  return \`\${text}\${text.includes("?") ? "&" : "?"}v=\${n}\`;
}`,
`// Bump whenever the portrait RENDER changes for an unchanged brand (new rig, new style rules).
// It rides along in every portrait URL, so browsers/CDNs that cached the old look fetch again.
const PFP_STYLE_STAMP = 2;

function withBrandVersion(url, agent) {
  if (!url) return url;
  const row = agent && typeof agent === "object" ? agent : {};
  const brand = row.brand && typeof row.brand === "object" ? row.brand : row;
  const version = Number(brand.version || row.version || 1);
  const n = Number.isFinite(version) && version > 0 ? version : 1;
  let text = String(url);
  if (!/[?&]v=\\d+/.test(text)) text = \`\${text}\${text.includes("?") ? "&" : "?"}v=\${n}\`;
  if (!/[?&]s=\\d+/.test(text)) text = \`\${text}&s=\${PFP_STYLE_STAMP}\`;
  return text;
}`);
// export the stamp for tests/clients
rep(`module.exports = {`, `module.exports = {
  PFP_STYLE_STAMP,`);
fs.writeFileSync(p, crlf ? s.replace(/\n/g, "\r\n") : s); console.log("style stamp added");
