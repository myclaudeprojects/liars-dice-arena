// scripts/register-entity-secret.js — one-time Circle setup.
//   1. Put CIRCLE_API_KEY=... in .env (or the environment)
//   2. npm install @circle-fin/developer-controlled-wallets
//   3. node scripts/register-entity-secret.js
// Generates a 32-byte Entity Secret, registers it with Circle, saves the
// recovery file to ./recovery/, and appends CIRCLE_ENTITY_SECRET to .env.
// Circle never stores the secret: without it (or the recovery file) the
// wallets and their funds are unrecoverable. Back both up.

const { randomBytes } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
try { process.loadEnvFile(path.join(root, ".env")); } catch {}

(async () => {
  const apiKey = process.env.CIRCLE_API_KEY;
  if (!apiKey) { console.error("CIRCLE_API_KEY is not set. Add it to .env first."); process.exit(1); }
  if (process.env.CIRCLE_ENTITY_SECRET) { console.error("CIRCLE_ENTITY_SECRET already exists in .env — refusing to overwrite."); process.exit(1); }

  let sdk;
  try { sdk = require("@circle-fin/developer-controlled-wallets"); }
  catch { console.error("SDK missing. Run: npm install @circle-fin/developer-controlled-wallets"); process.exit(1); }

  const entitySecret = randomBytes(32).toString("hex");
  const recoveryDir = path.join(root, "recovery"); fs.mkdirSync(recoveryDir, { recursive: true });

  console.log("Registering entity secret with Circle...");
  const res = await sdk.registerEntitySecretCiphertext({ apiKey, entitySecret, recoveryFileDownloadPath: recoveryDir });

  fs.appendFileSync(path.join(root, ".env"), `\r\nCIRCLE_ENTITY_SECRET=${entitySecret}\r\n`);
  console.log("Done.");
  console.log(" - CIRCLE_ENTITY_SECRET appended to .env");
  console.log(" - Recovery file saved in ./recovery/  <- back this up somewhere safe, then delete it from this folder");
  console.log("\nNext: add CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET as environment variables on Render.");
})().catch((e) => { console.error("Registration failed:", e?.response?.data || e.message || e); process.exit(1); });
