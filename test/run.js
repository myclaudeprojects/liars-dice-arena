// Runs every *.test.js in this folder; exits non-zero on the first failure.
process.on("unhandledRejection", (e) => { console.error(e); process.exit(1); });
process.on("uncaughtException", (e) => { console.error(e); process.exit(1); });
const { execFileSync } = require("child_process");
const fs = require("fs"); const path = require("path");
for (const f of fs.readdirSync(__dirname).filter((f) => f.endsWith(".test.js"))) {
  process.stdout.write(`▶ ${f}\n`);
  execFileSync(process.execPath, [path.join(__dirname, f)], { stdio: "inherit" });
}
console.log("\nall tests passed");
