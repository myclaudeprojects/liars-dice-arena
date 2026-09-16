// Runs every *.test.js in this folder; exits non-zero on the first failure.
const { execFileSync } = require("child_process");
const fs = require("fs"); const path = require("path");
for (const f of fs.readdirSync(__dirname).filter((f) => f.endsWith(".test.js"))) {
  process.stdout.write(`▶ ${f}\n`);
  execFileSync(process.execPath, [path.join(__dirname, f)], { stdio: "inherit" });
}
console.log("\nall tests passed");
