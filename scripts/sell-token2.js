// scripts/sell-token2.js — Sell through the launchpad router (0xB904...517b) exactly as the working sale did.
//   node scripts/sell-token2.js --amount 6000000            dry run: balances, floor, simulate
//   node scripts/sell-token2.js --amount 6000000 --send     execute
//   --min-usdc 1000  hard floor; --slippage 5 (default) when --min-usdc not given
const path = require("node:path");
try { process.loadEnvFile(path.join(__dirname, "..", ".env")); } catch {}
const { JsonRpcProvider, Wallet, Contract, formatUnits, parseUnits, MaxUint256, toBeHex, zeroPadValue } = require("ethers");

const RPC = "https://rpc.mainnet.arc.io";
const TOKEN = "0xc29C18447Aac536cAcCFA0616caF185DDEdB92Df";
const USDC = "0x3600000000000000000000000000000000000000";
const ROUTER = "0xB904868c72344A81918d123b9A597B287cdD517b";      // launchpad router used by the working sale
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const LAST_SQRT_PRICE = 5764023541178348228313763340989956456n, LAST_LIQUIDITY = 1414229208959103952n;

// Exact payload of the working sale (inputs[0]); only words 7 (amountIn) and 8 (amountOutMin) change.
const TEMPLATE = [
  "000000000000000000000000b904868c72344a81918d123b9a597b287cdd517b",
  "0000000000000000000000000000000000000000000000000000000000000040",
  "00000000000000000000000000000000000000000000000000000000000001e0",
  "0000000000000000000000000000000000000000000000000000000000000020",
  "000000000000000000000000c29c18447aac536caccfa0616caf185ddedb92df",
  "00000000000000000000000000000000000000000000000000000000000000a0",
  "00000000000000000000000000000000000000000000000000000000000001a0",
  "AMOUNT_IN",
  "AMOUNT_OUT_MIN",
  "0000000000000000000000000000000000000000000000000000000000000001",
  "0000000000000000000000000000000000000000000000000000000000000020",
  "0000000000000000000000003600000000000000000000000000000000000000",
  "0000000000000000000000000000000000000000000000000000000000000064",
  "0000000000000000000000000000000000000000000000000000000000000001",
  "00000000000000000000000011bcfcd113fe27e52e4be3398dae176f27de0144",
  "00000000000000000000000000000000000000000000000000000000000000a0",
  "0000000000000000000000000000000000000000000000000000000000000000",
  "0000000000000000000000000000000000000000000000000000000000000000",
];

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SEND = args.includes("--send"), AMOUNT = Number(opt("--amount", 0)), SLIPPAGE = Number(opt("--slippage", 5)), MIN_ARG = opt("--min-usdc", null);

const ERC20 = ["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function symbol() view returns (string)"];
const PERMIT2_ABI = ["function allowance(address,address,address) view returns (uint160,uint48,uint48)", "function approve(address,address,uint160,uint48)"];
const ROUTER_ABI = ["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"];

function estimateOut(dyRaw) {
  const sqrtP = Number(LAST_SQRT_PRICE) / 2 ** 96, L = Number(LAST_LIQUIDITY);
  const sqrtPnew = sqrtP + Number(dyRaw) / L;
  return { out: L * (1 / sqrtP - 1 / sqrtPnew) / 1e6, noImpact: Number(dyRaw) / (sqrtP * sqrtP) / 1e6 };
}
const word = (n) => zeroPadValue(toBeHex(n), 32).slice(2);

(async () => {
  if (!(AMOUNT > 0)) { console.error("Give --amount <tokens>"); process.exit(1); }
  if (!process.env.SELLER_PRIVATE_KEY) { console.error("SELLER_PRIVATE_KEY missing in .env"); process.exit(1); }
  const provider = new JsonRpcProvider(RPC, 5042, { staticNetwork: true }); provider.pollingInterval = 500;
  const wallet = new Wallet(process.env.SELLER_PRIVATE_KEY, provider);
  const token = new Contract(TOKEN, ERC20, wallet), usdc = new Contract(USDC, ERC20, provider);
  const permit2 = new Contract(PERMIT2, PERMIT2_ABI, wallet), router = new Contract(ROUTER, ROUTER_ABI, wallet);

  const [sym, bal, usdcBal, gas] = await Promise.all([token.symbol(), token.balanceOf(wallet.address), usdc.balanceOf(wallet.address), provider.getBalance(wallet.address)]);
  const amountIn = parseUnits(String(AMOUNT), 18);
  console.log(`wallet ${wallet.address}\n  ${sym}: ${formatUnits(bal, 18)}   USDC (native/gas): ${formatUnits(gas, 18)}   USDC (erc20): ${formatUnits(usdcBal, 6)}`);
  if (bal < amountIn) { console.error("not enough tokens"); process.exit(1); }

  const est = estimateOut(amountIn);
  const minOut = MIN_ARG != null ? Number(MIN_ARG) : est.out * (1 - SLIPPAGE / 100);
  const minOutRaw = BigInt(Math.floor(minOut * 1e6));
  console.log(`\nselling ${AMOUNT.toLocaleString()} ${sym} via launchpad router ${ROUTER.slice(0, 10)}… → Uniswap V4 hooked pool`);
  console.log(`  expected ≈ ${est.out.toFixed(2)} USDC (impact ≈ ${((1 - est.out / est.noImpact) * 100).toFixed(1)}%)   hard floor ${minOut.toFixed(2)} USDC (reverts below)`);

  const RECIP = (opt("--recipient", "self") === "router") ? ROUTER : wallet.address;   // word 0: who receives the USDC
  const input0 = "0x" + TEMPLATE.map((w, i) => i === 0 ? zeroPadValue(RECIP, 32).slice(2) : w === "AMOUNT_IN" ? word(amountIn) : w === "AMOUNT_OUT_MIN" ? word(minOutRaw) : w).join("");
  console.log(`  USDC recipient: ${RECIP === ROUTER ? "router (native unwrap → you)" : "you directly (ERC-20 USDC)"}`);
  const deadline = Math.floor(Date.now() / 1000) + 600;

  // The launchpad router pulls the token with a plain ERC-20 allowance granted to the router itself.
  const routerAllow = await token.allowance(wallet.address, ROUTER);
  const needErc20 = routerAllow < bal, needP2 = false;
  console.log(`\napproval: token → launchpad router ${needErc20 ? "NEEDED (your full balance, so a router fee fits)" : "ok (" + formatUnits(routerAllow, 18) + ")"}`);

  const simulate = async () => { await router.execute.staticCall("0x10", [input0], deadline); };
  if (!SEND) {
    if (needErc20 || needP2) console.log("\nsimulation: can't run until the approval exists (it is sent first with --send, then the swap is simulated before sending). Nothing sent.");
    else { try { await simulate(); console.log("\nsimulation: SUCCESS — swap would go through at or above the floor."); } catch (e) { console.log("\nsimulation: REVERT —", (e.shortMessage || e.message).slice(0, 200)); } }
    console.log("\nDry run only. Re-run with --send to execute."); return;
  }
  if (needErc20) { console.log("approving token → launchpad router for exactly this amount…"); const t = await token.approve(ROUTER, bal); /* full balance: headroom for a router fee; you cannot lose more than you hold */ await t.wait(); console.log("  ", t.hash); }
  console.log("simulating…"); await simulate(); console.log("  ok");
  const before = gas + 0n;
  console.log("sending…"); const tx = await router.execute("0x10", [input0], deadline, { gasLimit: 600000 });
  console.log("  https://arc.etherscan.io/tx/" + tx.hash);
  const rc = await tx.wait();
  const afterNative = await provider.getBalance(wallet.address), afterErc = await usdc.balanceOf(wallet.address);
  console.log(rc.status === 1 ? `SUCCESS. USDC now: native ${formatUnits(afterNative, 18)} (Δ ${formatUnits(afterNative - before, 18)}), erc20 ${formatUnits(afterErc, 6)} (Δ ${formatUnits(afterErc - usdcBal, 6)})` : "FAILED (reverted): only gas spent");
})().catch((e) => { console.error("ERROR:", e.shortMessage || e.message); process.exit(1); });
