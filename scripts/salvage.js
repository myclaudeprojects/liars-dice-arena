// scripts/salvage.js — Sell Usdc.cool into whatever the public pools will pay, via Kyber's aggregator.
//   node scripts/salvage.js            dry run: shows the quote and route, sends nothing
//   node scripts/salvage.js --send     approves exact amount, then sends the swap
//   --amount 6180372  (default: your full balance)   --slippage 3  (% below quote at which the tx reverts)
const path = require("node:path");
try { process.loadEnvFile(path.join(__dirname, "..", ".env")); } catch {}
const { JsonRpcProvider, Wallet, Contract, formatUnits, parseUnits } = require("ethers");

const RPC = "https://rpc.mainnet.arc.io", TOKEN = "0xc29C18447Aac536cAcCFA0616caF185DDEdB92Df", USDC = "0x3600000000000000000000000000000000000000";
const API = "https://aggregator-api.kyberswap.com/arc/api/v1";
const H = { "content-type": "application/json", "x-client-id": "liarsdicearena", "user-agent": "Mozilla/5.0" };
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SEND = args.includes("--send"), SLIP = Number(opt("--slippage", 3));

(async () => {
  if (!process.env.SELLER_PRIVATE_KEY) { console.error("SELLER_PRIVATE_KEY missing in .env"); process.exit(1); }
  const provider = new JsonRpcProvider(RPC, 5042, { staticNetwork: true }); provider.pollingInterval = 500;
  const wallet = new Wallet(process.env.SELLER_PRIVATE_KEY, provider);
  const token = new Contract(TOKEN, ["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)"], wallet);
  const bal = await token.balanceOf(wallet.address);
  const amountIn = opt("--amount", null) ? parseUnits(opt("--amount"), 18) : bal;
  if (amountIn > bal) { console.error("amount exceeds balance"); process.exit(1); }
  console.log(`wallet ${wallet.address}  selling ${formatUnits(amountIn, 18)} Usdc.cool`);

  const q = await (await fetch(`${API}/routes?tokenIn=${TOKEN}&tokenOut=${USDC}&amountIn=${amountIn}`, { headers: H })).json();
  if (!q.data) { console.error("quote failed:", JSON.stringify(q).slice(0, 200)); process.exit(1); }
  const rs = q.data.routeSummary, router = q.data.routerAddress;
  const outUsdc = Number(rs.amountOut) / 1e6;
  console.log(`quote: ${outUsdc.toFixed(2)} USDC  (gas ≈ $${Number(rs.gasUsd).toFixed(3)})  via ${[...new Set(rs.route.flat().map((h) => h.exchange))].join(", ")} — ${rs.route.flat().length} hop(s)`);
  console.log(`floor: ${(outUsdc * (1 - SLIP / 100)).toFixed(2)} USDC (tx reverts below this)`);

  const b = await (await fetch(`${API}/route/build`, { method: "POST", headers: H, body: JSON.stringify({ routeSummary: rs, sender: wallet.address, recipient: wallet.address, slippageTolerance: Math.round(SLIP * 100), deadline: Math.floor(Date.now() / 1000) + 600, source: "liarsdicearena" }) })).json();
  if (!b.data) { console.error("build failed:", JSON.stringify(b).slice(0, 200)); process.exit(1); }
  const { data: calldata, routerAddress } = b.data;

  if (!SEND) { console.log("\nDry run. Re-run with --send to execute."); return; }
  if ((await token.allowance(wallet.address, routerAddress)) < amountIn) { console.log("approving exact amount to Kyber router…"); const t = await token.approve(routerAddress, amountIn); await t.wait(); console.log("  ", t.hash); }
  // final check: re-quote right before sending; abort if it fell more than the slippage
  const q2 = await (await fetch(`${API}/routes?tokenIn=${TOKEN}&tokenOut=${USDC}&amountIn=${amountIn}`, { headers: H })).json();
  const out2 = Number(q2.data.routeSummary.amountOut) / 1e6;
  if (out2 < outUsdc * (1 - SLIP / 100)) { console.error(`quote moved to ${out2.toFixed(2)} — aborting, nothing sent`); process.exit(1); }
  const before = await provider.getBalance(wallet.address);
  console.log("sending…"); const tx = await wallet.sendTransaction({ to: routerAddress, data: calldata, gasLimit: 900000 });
  console.log("  https://arc.etherscan.io/tx/" + tx.hash);
  const rc = await tx.wait();
  const after = await provider.getBalance(wallet.address);
  console.log(rc.status === 1 ? `DONE — native USDC balance ${formatUnits(before, 18)} → ${formatUnits(after, 18)}` : "REVERTED — only gas spent");
})().catch((e) => { console.error("ERROR:", e.shortMessage || e.message); process.exit(1); });
