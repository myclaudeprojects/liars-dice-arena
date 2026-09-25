const fs = require("fs"); const p = __dirname + "/../public/app.js"; const raw = fs.readFileSync(p, "utf8"); const crlf = raw.includes("\r\n"); let s = raw.replace(/\r\n/g, "\n");
const from = `function pfpPath(url) {
  const text = String(url || "");
  if (/^\\/api\\/show\\/agents\\/[a-z0-9_%.-]+\\/pfp\\.svg(?:\\?(?:size=(?:48|96|160|256|320|512|1024)|v=\\d+)(?:&(?:size=(?:48|96|160|256|320|512|1024)|v=\\d+))?)?$/i.test(text)) return text;
  return "";
}`;
const to = `// Accept only our own portrait route. Query may carry size=, v= (brand version) and
// s= (style stamp) in any order; anything else is refused and the letter fallback shows.
function pfpPath(url) {
  const text = String(url || "");
  const m = text.match(/^(\\/api\\/show\\/agents\\/[a-z0-9_%.-]+\\/pfp\\.svg)(?:\\?(.*))?$/i);
  if (!m) return "";
  if (!m[2]) return text;
  const ok = m[2].split("&").every((kv) => /^size=(?:48|96|160|256|320|512|1024)$/.test(kv) || /^v=\\d+$/.test(kv) || /^s=\\d+$/.test(kv));
  return ok ? text : "";
}`;
if (!s.includes(from)) { if (s.includes("s= (style stamp)")) { console.log("already patched"); process.exit(0); } throw new Error("anchor missing"); }
s = s.replace(from, to);
fs.writeFileSync(p, crlf ? s.replace(/\n/g, "\r\n") : s); console.log("pfpPath widened");
