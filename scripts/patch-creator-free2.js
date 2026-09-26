const fs = require("fs"), path = require("path");
const p = path.join(__dirname, "..", "public", "app.js");
const raw = fs.readFileSync(p, "utf8"); const crlf = raw.includes("\r\n"); let s = raw.replace(/\r\n/g, "\n");
// drop the Visual direction field entirely
s = s.replace(/^[ \t]*<label>Visual direction<textarea name="visualDirection"[^\n]*\n/m, "");
if (/Visual direction/.test(s)) throw new Error("visual direction still present");
// plain-text labels (no emoji through the shell)
s = s.replace(/const nextLabel = step === 1 \? "[^"]*Random look"/, 'const nextLabel = step === 1 ? "Random look"');
s = s.replace(/<button class="ghost lda-btn" type="button" data-random-look="1">[^<]*<\/button>/, '<button class="ghost lda-btn" type="button" data-random-look="1">Randomize again</button>');
fs.writeFileSync(p, crlf ? s.replace(/\n/g, "\r\n") : s);
console.log("ok", /"Random look"/.test(s), /Randomize again/.test(s));
