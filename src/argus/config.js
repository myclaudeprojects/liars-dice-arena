// ARGUS_MINT_ENABLED gates Portal #7 launches. Unset or anything other than
// 1 / true / yes / on leaves Create Agent unchanged.
// ARGUS_MINT_KEY is a separate server key for creators with no browser wallet.
// The browser path stays available whenever the flag is on. The key itself is
// never copied into the public config.

const { activePortal, loadAbi, QUOTE_ASSET, CHAIN_ID, CHAIN_ID_HEX, BUNDLE_SHA256, BUNDLE_URL } = require("./launch");
const { parseMintKey } = require("./sponsor");

const SPONSOR_UNAVAILABLE = "Server mint is not set up. Connect a wallet, or leave this agent playable.";
let warnedInvalidMintKey = false;

function mintAccount(env) {
  const source = env || process.env;
  const raw = source.ARGUS_MINT_KEY;
  if (raw == null || String(raw).trim() === "") return { configured: false, reason: "missing" };
  const parsed = parseMintKey(raw);
  if (!parsed) {
    if (!warnedInvalidMintKey) {
      warnedInvalidMintKey = true;
      console.warn("ARGUS_MINT_KEY is set but cannot be used. Server mint stays off. The value was not logged.");
    }
    return { configured: false, reason: "invalid" };
  }
  return { configured: true, address: parsed.address };
}

function sponsoredState(env) {
  const enabled = argusEnabled(env);
  const account = mintAccount(env);
  const sponsored = enabled && account.configured;
  return {
    enabled,
    sponsored,
    mintWallet: sponsored ? account.address : null,
    sponsoredMessage: enabled && !sponsored ? SPONSOR_UNAVAILABLE : "",
  };
}

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
  const state = sponsoredState(env);
  const base = {
    enabled: state.enabled,
    sponsored: state.sponsored,
    sponsoredMessage: state.sponsoredMessage,
    mintWallet: state.mintWallet,
    chainId: CHAIN_ID,
    chainIdHex: CHAIN_ID_HEX,
    publicBase: publicBase(env),
    bundleUrl: BUNDLE_URL,
    bundleSha256: BUNDLE_SHA256,
  };
  if (!state.enabled) return base;
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

module.exports = { argusEnabled, publicBase, argusPublicConfig, sponsoredState, SPONSOR_UNAVAILABLE };
