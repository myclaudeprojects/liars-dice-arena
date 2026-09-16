// scripts/sweep.js — Pull USDC out of the arena's derived wallets.
//   node scripts/sweep.js                 → seats/pot/pool -> house (leaves a small float in each seat)
//   node scripts/sweep.js --to 0xYOUR_ADDR → everything (incl. house) -> your own wallet, leaving HOUSE_FLOAT in house
// Options: --float 0.5   float to leave in each house seat (default 0.35 ≈ 3 antes at 0.10)
//          --house-float 5   what to leave in the house when using --to (default 5)
//          --dry          show what would move, send nothing
const path = require("node:path");
try { process.loadEnvFile(path.join(__dirname, "..", ".env")); } catch {}
const { makeWallet } = require("../src/wallet");

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DRY = args.includes("--dry");
const TO = opt("--to", null);
const SEAT_FLOAT = Number(opt("--float", 0.35));
const HOUSE_FLOAT = Number(opt("--house-float", 5));
const SEATS = (opt("--seats", "shark,degen,oracle,grinder,pot,pool")).split(",");

(async () => {
  const w = makeWallet({ provider: "evm", privateKey: process.env.HOUSE_PRIVATE_KEY });
  const house = await w.createSeatWallet("house");
  let moved = 0;
  console.log(`house ${house.address}: ${await w.getBalance("house")} USDC`);
  for (const label of SEATS) {
    const bal = await w.getBalance(label);
    const keep = label === "pot" || label === "pool" ? 0.02 : SEAT_FLOAT;
    const amt = Math.floor((bal - keep - w.gasReserve) * 1e6) / 1e6;
    if (amt <= 0.001) { console.log(`  ${label.padEnd(8)} ${bal.toFixed(6)}  (keep)`); continue; }
    if (DRY) { console.log(`  ${label.padEnd(8)} ${bal.toFixed(6)}  -> would send ${amt} to house`); moved += amt; continue; }
    const tx = await w.settle({ walletId: label }, house, amt);
    console.log(`  ${label.padEnd(8)} ${bal.toFixed(6)}  -> sent ${amt} to house  ${w.explorerUrl(tx)}`);
    moved += amt;
  }
  console.log(`swept ${moved.toFixed(6)} USDC into the house`);
  if (TO) {
    const hb = await w.getBalance("house");
    const out = Math.floor((hb - HOUSE_FLOAT - w.gasReserve) * 1e6) / 1e6;
    if (out > 0.001) {
      if (DRY) console.log(`would send ${out} USDC from house to ${TO}`);
      else { const tx = await w.settle({ walletId: "house" }, { address: TO }, out); console.log(`sent ${out} USDC to ${TO}  ${w.explorerUrl(tx)}`); }
    } else console.log(`house has ${hb}; nothing above the ${HOUSE_FLOAT} float to withdraw`);
  }
  console.log(`house now: ${await w.getBalance("house")} USDC`);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
