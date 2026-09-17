// scripts/sell-token.js — Sell an Arc launchpad token through its Uniswap V4 hooked pool,
// exactly the route used by the working sale in tx 0x8a13fe3e...ab78.
//
//   node scripts/sell-token.js --amount 6000000            (dry run: shows balances, expected USDC, simulates)
//   node scripts/sell-token.js --amount 6000000 --send     (actually sends)
//   options: --min-usdc 1100   hard floor on USDC received (tx reverts below it)
//            --slippage 5      % under the expected output to use as the floor when --min-usdc isn't given
//
// Uses SELLER_PRIVATE_KEY from .env (NOT the house key). Never printed. Runs on your machine only.

const path = require("node:path");
try { process.loadEnvFile(path.join(__dirname, "..", ".env")); } catch {}
const { JsonRpcProvider, Wallet, Contract, AbiCoder, formatUnits, parseUnits, MaxUint256 } = require("ethers");

const RPC = "https://rpc.mainnet.arc.io";
const TOKEN = "0xc29C18447Aac536cAcCFA0616caF185DDEdB92Df";       // the token you are selling (18 dec)
const USDC = "0x3600000000000000000000000000000000000000";        // USDC ERC-20 on Arc (6 dec)
const UNIVERSAL_ROUTER = "0x4fcA4a51Ab4F23A7447b3284fBd7D73289A89Fb1";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
// Pool key from the successful sale: USDC / token, 0.01% fee, tick spacing 1, launchpad hook.
const POOL = { currency0: USDC, currency1: TOKEN, fee: 100, tickSpacing: 1, hooks: "0x11bcfcd113fe27e52e4be3398dae176f27de0144" };
// Price observed right after that sale (sqrtPriceX96 from the Swap log) — used only to estimate expected output.
const LAST_SQRT_PRICE = 5764023541178348228313763340989956456n;
const LAST_LIQUIDITY = 1414229208959103952n;

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SEND = args.includes("--send");
const AMOUNT = Number(opt("--amount", 0));
const SLIPPAGE = Number(opt("--slippage", 5));
const MIN_USDC_ARG = opt("--min-usdc", null);

const ERC20 = ["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function decimals() view returns (uint8)", "function symbol() view returns (string)"];
const PERMIT2_ABI = ["function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)", "function approve(address token, address spender, uint160 amount, uint48 expiration)"];
const UR_ABI = ["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"];

// V3/V4 constant-liquidity math: selling `dy` of token1 into liquidity L at sqrtP → USDC (token0) out.
function estimateOut(dyRaw) {
  const Q96 = 2n ** 96n;
  // work in floating point; precision is fine for an estimate
  const sqrtP = Number(LAST_SQRT_PRICE) / Number(Q96);
  const L = Number(LAST_LIQUIDITY);
  const sqrtPnew = sqrtP + Number(dyRaw) / L;
  const dx = L * (1 / sqrtP - 1 / sqrtPnew);     // raw USDC (6 dec)
  const spot = Number(dyRaw) / (sqrtP * sqrtP);   // raw USDC at spot price, no impact
  return { out: dx / 1e6, noImpact: spot / 1e6 };
}

(async () => {
  if (!(AMOUNT > 0)) { console.error("Give --amount <tokens>, e.g. --amount 6000000"); process.exit(1); }
  const pk = process.env.SELLER_PRIVATE_KEY;
  if (!pk) { console.error("SELLER_PRIVATE_KEY is not set in .env"); process.exit(1); }

  const provider = new JsonRpcProvider(RPC, 5042, { staticNetwork: true });
  provider.pollingInterval = 500;
  const wallet = new Wallet(pk, provider);
  const token = new Contract(TOKEN, ERC20, wallet), usdc = new Contract(USDC, ERC20, provider);
  const permit2 = new Contract(PERMIT2, PERMIT2_ABI, wallet), ur = new Contract(UNIVERSAL_ROUTER, UR_ABI, wallet);

  const [sym, dec, bal, usdcBal, gas] = await Promise.all([token.symbol(), token.decimals(), token.balanceOf(wallet.address), usdc.balanceOf(wallet.address), provider.getBalance(wallet.address)]);
  const amountIn = parseUnits(String(AMOUNT), dec);
  console.log(`wallet ${wallet.address}`);
  console.log(`  ${sym}: ${formatUnits(bal, dec)}   USDC: ${formatUnits(usdcBal, 6)}   gas (native USDC): ${formatUnits(gas, 18)}`);
  if (bal < amountIn) { console.error(`You hold ${formatUnits(bal, dec)} ${sym}, less than --amount ${AMOUNT}`); process.exit(1); }
  if (gas < parseUnits("0.05", 18)) console.warn("  warning: under 0.05 native USDC for gas — a swap costs ~0.005, approvals ~0.001 each");

  const est = estimateOut(amountIn);
  const minOut = MIN_USDC_ARG != null ? Number(MIN_USDC_ARG) : est.out * (1 - SLIPPAGE / 100);
  console.log(`\nselling ${AMOUNT.toLocaleString()} ${sym} via V4 pool (fee 0.01%, hook ${POOL.hooks.slice(0, 10)}…)`);
  console.log(`  expected ≈ ${est.out.toFixed(2)} USDC  (spot ${est.noImpact.toFixed(2)}, price impact ≈ ${((1 - est.out / est.noImpact) * 100).toFixed(1)}%)  [estimate from last observed pool state]`);
  console.log(`  hard floor: ${minOut.toFixed(2)} USDC — the tx reverts (gas only) if the pool delivers less`);

  // ---- build the Universal Router call: V4_SWAP with SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL
  const abi = AbiCoder.defaultAbiCoder();
  const minOutRaw = BigInt(Math.floor(minOut * 1e6));
  const poolKeyTuple = "tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
  const swapParams = abi.encode([`tuple(${poolKeyTuple} poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)`],
    [{ poolKey: POOL, zeroForOne: false, amountIn, amountOutMinimum: minOutRaw, hookData: "0x" }]);
  const settle = abi.encode(["address", "uint256"], [TOKEN, amountIn]);         // pay the token in
  const take = abi.encode(["address", "uint256"], [USDC, minOutRaw]);           // take USDC out
  const actions = "0x060c0f";                                                     // SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL
  const v4Input = abi.encode(["bytes", "bytes[]"], [actions, [swapParams, settle, take]]);
  const commands = "0x10";                                                        // V4_SWAP
  const deadline = Math.floor(Date.now() / 1000) + 600;

  // ---- approvals: token -> Permit2 (ERC-20 approve), then Permit2 -> Universal Router
  const erc20Allow = await token.allowance(wallet.address, PERMIT2);
  const [p2Amount, p2Exp] = await permit2.allowance(wallet.address, TOKEN, UNIVERSAL_ROUTER);
  const needErc20 = erc20Allow < amountIn;
  const needP2 = p2Amount < amountIn || Number(p2Exp) < deadline;
  console.log(`\napprovals: token→Permit2 ${needErc20 ? "NEEDED" : "ok"}, Permit2→Router ${needP2 ? "NEEDED" : "ok"}`);

  if (!SEND) {
    // Simulate the swap as if approvals were in place (approvals can't be simulated in the same call).
    try {
      if (!needErc20 && !needP2) { await ur.execute.staticCall(commands, [v4Input], deadline); console.log("\nsimulation: swap would SUCCEED at or above the floor."); }
      else console.log("\nsimulation skipped until approvals exist (they are sent first with --send).");
    } catch (e) { console.log("\nsimulation: swap would REVERT —", (e.shortMessage || e.message).slice(0, 200)); console.log("Usually means the pool can't meet the floor; lower --min-usdc / raise --slippage, or sell a smaller --amount."); }
    console.log("\nDry run only. Re-run with --send to execute.");
    return;
  }

  if (needErc20) { console.log("approving token → Permit2…"); const t = await token.approve(PERMIT2, MaxUint256); await t.wait(); console.log("  done", t.hash); }
  if (needP2) { console.log("approving Permit2 → Universal Router…"); const t = await permit2.approve(TOKEN, UNIVERSAL_ROUTER, (2n ** 160n) - 1n, deadline + 3600); await t.wait(); console.log("  done", t.hash); }

  console.log("simulating…"); await ur.execute.staticCall(commands, [v4Input], deadline); console.log("  ok");
  console.log("sending swap…");
  const tx = await ur.execute(commands, [v4Input], deadline, { gasLimit: 600000 });
  console.log("  tx", tx.hash, "→ https://arc.etherscan.io/tx/" + tx.hash);
  const rc = await tx.wait();
  const after = await usdc.balanceOf(wallet.address);
  console.log(rc.status === 1 ? `SUCCESS: received ${formatUnits(after - usdcBal, 6)} USDC` : "FAILED (reverted) — nothing left your wallet except gas");
})().catch((e) => { console.error("ERROR:", e.shortMessage || e.message); process.exit(1); });
