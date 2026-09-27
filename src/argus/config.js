// ARGUS_MINT_ENABLED gates Portal #7 launches. Unset or anything other than
// 1 / true / yes / on leaves Create Agent unchanged.
// ARGUS_MINT_KEY is a separate server key for creators with no browser wallet.
// The browser path stays available whenever the flag is on. The key itself is
// never copied into the public config.

const { ethers } = require("ethers");
const { activePortal, loadAbi, QUOTE_ASSET, CHAIN_ID, CHAIN_ID_HEX, BUNDLE_SHA256, BUNDLE_URL, HOUSE_LAUNCH_DEFAULTS } = require("./launch");
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

function hostOf(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function withSlash(value) {
  return String(value || "").trim().replace(/\/+$/, "") + "/";
}

// Arena coin. Distinct from a per-agent Portal #7 mint. Confirmed on Arcscan
// as name "Liar's Dice Arena", symbol LIAR.
const DEFAULT_LIAR_TOKEN = "0x47c3D4490C1e8B9ed71464e333AD9D5ce7D20790";

function liarTokenAddress(source) {
  const raw = String(source.LDA_LIAR_TOKEN_ADDRESS || "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) return ethers.getAddress(DEFAULT_LIAR_TOKEN);
  try { return ethers.getAddress(raw); }
  catch { return ethers.getAddress(DEFAULT_LIAR_TOKEN); }
}

function liarBuyUrl(source, address) {
  const raw = String(source.LDA_LIAR_BUY_URL || "").trim();
  if (raw) {
    try {
      const url = new URL(raw);
      if (url.protocol === "https:" || url.protocol === "http:") return url.href;
    } catch { /* a bad override keeps the Argus token page */ }
  }
  return "https://argus.world/token/" + address;
}

function arenaToken(env) {
  const source = env || process.env;
  const tokenAddress = liarTokenAddress(source);
  return {
    symbol: "LIAR",
    label: "$LIAR",
    name: "Liar's Dice Arena",
    tokenAddress,
    buyUrl: liarBuyUrl(source, tokenAddress),
  };
}

function creatorFeeWallet(source) {
  const raw = String(source.ARGUS_CREATOR_WALLET || "").trim();
  const pick = /^0x[0-9a-fA-F]{40}$/.test(raw) ? raw : HOUSE_LAUNCH_DEFAULTS.creatorFeeWallet;
  try { return ethers.getAddress(pick); }
  catch { return ethers.getAddress(HOUSE_LAUNCH_DEFAULTS.creatorFeeWallet); }
}

// LDA_SITE_URL wins. Otherwise a publicBase that is already liarsdicearc.app
// is the site link. Any other host keeps the house default.
function houseLaunchProfile(env) {
  const source = env || process.env;
  const explicit = String(source.LDA_SITE_URL || "").trim();
  let site = /^https?:\/\//i.test(explicit) ? explicit : "";
  if (!site && hostOf(publicBase(source)) === "liarsdicearc.app") site = publicBase(source);
  if (!site) site = HOUSE_LAUNCH_DEFAULTS.siteUrl;
  const xUrl = String(source.LDA_X_URL || "").trim() || HOUSE_LAUNCH_DEFAULTS.xUrl;
  const telegramUrl = String(source.LDA_TELEGRAM_URL || "").trim();
  return {
    siteUrl: withSlash(site),
    xUrl: xUrl.slice(0, 120),
    telegramUrl: telegramUrl.slice(0, 120),
    creatorFeeWallet: creatorFeeWallet(source),
  };
}

function argusPublicConfig(env) {
  const state = sponsoredState(env);
  const house = houseLaunchProfile(env);
  const mintIsHouse = !!(state.sponsored && state.mintWallet
    && state.mintWallet.toLowerCase() === house.creatorFeeWallet.toLowerCase());
  const base = {
    enabled: state.enabled,
    sponsored: state.sponsored,
    sponsoredMessage: state.sponsoredMessage,
    mintWallet: state.mintWallet,
    mintIsHouse,
    chainId: CHAIN_ID,
    chainIdHex: CHAIN_ID_HEX,
    publicBase: publicBase(env),
    siteUrl: house.siteUrl,
    xUrl: house.xUrl,
    telegramUrl: house.telegramUrl,
    creatorFeeWallet: house.creatorFeeWallet,
    arenaToken: arenaToken(env),
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

module.exports = { argusEnabled, publicBase, houseLaunchProfile, argusPublicConfig, arenaToken, sponsoredState, SPONSOR_UNAVAILABLE, DEFAULT_LIAR_TOKEN };
