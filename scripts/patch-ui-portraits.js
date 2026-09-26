const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const rw = (f, fn) => { const p = path.join(root, f); const raw = fs.readFileSync(p, "utf8"); const crlf = raw.includes("\r\n"); const a = raw.replace(/\r\n/g, "\n"); const b = fn(a); fs.writeFileSync(p, crlf ? b.replace(/\n/g, "\r\n") : b); console.log(f, a === b ? "(no change)" : "patched"); };
rw("public/ui.js", (s) => {
  if (s.includes("Generated portrait library (same rule")) return s;
  const from = `  function portraitUrl(url) {\n    const text = String(url || "");\n    const m = text.match(`;
  if (!s.includes(from)) throw new Error("anchor missing in ui.js");
  return s.replace(from, `  function portraitUrl(url) {\n    const text = String(url || "");\n    // Generated portrait library (same rule as app.js pfpPath).\n    if (/^\\/assets\\/portraits\\/[a-z0-9_.-]+\\.(?:webp|png|jpg)(?:\\?(?:[a-z]+=[a-z0-9]+)(?:&[a-z]+=[a-z0-9]+)*)?$/i.test(text)) return text;\n    const m = text.match(`);
});
rw("public/app.html", (s) => s.replace(/\/static\/ui\.js\?v=(\d+)/, (m, n) => "/static/ui.js?v=" + (Number(n) + 1)));
