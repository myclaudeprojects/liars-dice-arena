// scripts/circle-setup.js — Step 1-3 of going live: prove connectivity, create the
// house wallet on Arc, and discover the USDC token id. Creates nothing that costs money.
//   node scripts/circle-setup.js
// Writes ids into .env (CIRCLE_WALLET_SET_ID, CIRCLE_HOUSE_WALLET_ID, CIRCLE_HOUSE_ADDRESS).
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, ".."); try { process.loadEnvFile(path.join(root, ".env")); } catch {}
const { initiateDeveloperControlledWalletsClient } = require("@circle-fin/developer-controlled-wallets");

const chain = process.env.CIRCLE_BLOCKCHAIN || "ARC";
const client = initiateDeveloperControlledWalletsClient({ apiKey: process.env.CIRCLE_API_KEY, entitySecret: process.env.CIRCLE_ENTITY_SECRET });
const envSet = (k, v) => { let s = fs.readFileSync(path.join(root, ".env"), "utf8"); s = s.replace(new RegExp(`^${k}=.*$`, "m"), ""); fs.writeFileSync(path.join(root, ".env"), s.trimEnd() + `\r\n${k}=${v}\r\n`); };

(async () => {
  console.log(`chain: ${chain}`);
  // 1) wallet set (idempotent-ish: reuse if we already have one)
  let setId = process.env.CIRCLE_WALLET_SET_ID;
  if (!setId) {
    const r = await client.createWalletSet({ name: "liars-dice-arena" });
    setId = r.data.walletSet.id; envSet("CIRCLE_WALLET_SET_ID", setId);
  }
  console.log("wallet set:", setId);

  // 2) house wallet
  let houseId = process.env.CIRCLE_HOUSE_WALLET_ID, houseAddr = process.env.CIRCLE_HOUSE_ADDRESS;
  if (!houseId) {
    const r = await client.createWallets({ walletSetId: setId, blockchains: [chain], count: 1, accountType: "EOA", metadata: [{ name: "house", refId: "house" }] });
    const w = r.data.wallets[0]; houseId = w.id; houseAddr = w.address;
    envSet("CIRCLE_HOUSE_WALLET_ID", houseId); envSet("CIRCLE_HOUSE_ADDRESS", houseAddr);
  }
  console.log("house wallet:", houseId);
  console.log("house address:", houseAddr, `  -> https://arcscan.app/address/${houseAddr}`);

  // 3) token balances (discovers USDC token id once funded; may be empty now)
  const b = await client.getWalletTokenBalance({ id: houseId });
  const bals = b.data.tokenBalances || [];
  if (!bals.length) console.log("balances: (empty — fund the house address with a little USDC on Arc, then rerun to capture the token id)");
  for (const t of bals) { console.log(`balance: ${t.amount} ${t.token.symbol}  tokenId=${t.token.id}`); if (t.token.symbol === "USDC") envSet("CIRCLE_USDC_TOKEN_ID", t.token.id); }
})().catch((e) => { console.error("FAILED:", e?.response?.data || e.message || e); process.exit(1); });
