// Runs every *.test.js in this folder; exits non-zero on the first failure.
const { execFileSync } = require("child_process");
const fs = require("fs"); const path = require("path");
for (const f of fs.readdirSync(__dirname).filter((f) => f.endsWith(".test.js"))) {
  process.stdout.write(`▶ ${f}\n`);
  // Existing tests assert the SVG rig; the library test brings its own fixture library.
  const env = { ...process.env, PORTRAIT_LIB: f === "portraitlib.test.js" ? "" : "off" };
  execFileSync(process.execPath, [path.join(__dirname, f)], { stdio: "inherit", env });
}
console.log("\nall tests passed");
