// Locked product economics. Change here, not in call sites.
//
// Agents play with free, nonredeemable Arena Credits. There is no USDC ante,
// no player-funded pot, and no spectator win pool. Tips are gifts to the
// agent's creator wallet. Platform USDC prizes are paid from the house
// treasury to creators — never from tips, credits, or other users' losses.

const PRIZE_WALLET = "0x341BB8851Ff8fD9EAE20ea083c2F779e646B8488";
const HOUSE_FEE_ADDRESS = PRIZE_WALLET;

// Tips: 100% to the named agent's creator wallet. No house skim. Not credits.
const TIP_CREATOR_BPS = 10_000;
const TIP_HOUSE_BPS = 0;

// Visual/strategic credit antes (not money).
const CREDIT_TIERS = Object.freeze([1, 10, 100]);
const DEFAULT_ANTE_CREDITS = 1;
const STARTING_CREDITS = 1000;

const DEFAULT_TABLE_SIZE = 3;
const DEFAULT_TABLE_COUNT = 3;
const MIN_TIP = 0.05;

// Platform prize program (USDC from treasury → creator).
const PRIZE_EVERY_MATCHES = 10;
const PRIZE_USDC = 5;
const PRIZE_MIN_PLAYED = 5;

const PUBLIC_BASE_URL = "https://liarsdicearc.app";
const SUPPORT_EMAIL = "myclaudeprojects@gmail.com";

function round6(x) { return Math.round(Number(x) * 1e6) / 1e6; }

function splitBps(total, bps) { return round6((Number(total) * bps) / 10_000); }

function assertAnteCredits(n, tiers = CREDIT_TIERS) {
  const v = Number(n);
  if (!tiers.includes(v)) throw new Error(`Credit ante must be one of ${tiers.join("/")}.`);
  return v;
}

function assertSplits() {
  if (TIP_CREATOR_BPS + TIP_HOUSE_BPS !== 10_000) {
    throw new Error("tip split must sum to 100%");
  }
  if (TIP_HOUSE_BPS !== 0) {
    throw new Error("tips have no house skim");
  }
}

assertSplits();

module.exports = {
  PRIZE_WALLET, HOUSE_FEE_ADDRESS,
  TIP_CREATOR_BPS, TIP_HOUSE_BPS,
  CREDIT_TIERS, DEFAULT_ANTE_CREDITS, STARTING_CREDITS,
  DEFAULT_TABLE_SIZE, DEFAULT_TABLE_COUNT, MIN_TIP,
  PRIZE_EVERY_MATCHES, PRIZE_USDC, PRIZE_MIN_PLAYED,
  PUBLIC_BASE_URL, SUPPORT_EMAIL,
  round6, splitBps, assertSplits, assertAnteCredits,
};
