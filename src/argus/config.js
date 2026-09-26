// ARGUS_MINT_ENABLED gates the wallet launch. Unset or anything other than
// 1 / true / yes / on leaves Create Agent unchanged.

const { activePortal, loadAbi, QUOTE_ASSET, CHAIN_ID, CHAIN_ID_HEX, BUNDLE_SHA256, BUNDLE_URL } = require("./launch");

function argusEnabled(env) {
  const source = env || process.env;
  return /^(1|true|yes|on)$/i.test(String(source.ARGUS_MINT_ENABLED || "").trim());
}

function publicBase(env) {
  const source = env || process.env;
  const raw = String(source.PUBLIC_BASE_URL || "https://liars-dice-arena.onrender.com").trim().replace(/\/$/, "");
  return raw || "https://liars-dice-arena.onrender.com";
}

function argusPublicConfig(env) {
  const enabled = argusEnabled(env);
  const base = {
    enabled,
    chainId: CHAIN_ID,
    chainIdHex: CHAIN_ID_HEX,
    publicBase: publicBase(env),
    bundleUrl: BUNDLE_URL,
    bundleSha256: BUNDLE_SHA256,
  };
  if (!enabled) return base;
  return {
    ...base,
    portal: activePortal(),
    portalNumber: 7,
    quoteAsset: QUOTE_ASSET,
    quoteDecimals: 6,
    hookFlags: "0x2044",
    abi: loadAbi(),
    defaults: {
      buyTaxPercent: 5,
      sellTaxPercent: 5,
      creatorPercent: 100,
      burnPercent: 0,
      dividendPercent: 0,
      liquidityPercent: 0,
      devBuyUsdc: "0",
      startFdvUsdc: "2500",
      bondFdvUsdc: "45000",
      totalSupplyTokens: "1000000000",
      expectConvert: 1,
    },
  };
}

module.exports = { argusEnabled, publicBase, argusPublicConfig };
