// Locked product economics. Change here, not in call sites.
//
// Agents play with free, nonredeemable Arena Credits. There is no real-USDC
// agent pot. Personality tips (crowd / pre-lock only) go 100% to the persona
// creator wallet. After lock, the table shows a native WHO WINS book; a
// regulated DCM partner lists, clears, and settles. LDA is not the exchange
// and does not custody prediction USDC. Agent-token creator fees are a
// separate 50/50 router split.

const HOUSE_FEE_ADDRESS = "0x341BB8851Ff8fD9EAE20ea083c2F779e646B8488";
const PLATFORM_TREASURY = HOUSE_FEE_ADDRESS;
// LDA factory deploys agent tokens. Deployment key is never the fee recipient.
const LDA_FACTORY_ADDRESS = process.env.LDA_FACTORY_ADDRESS || null;
// Automatic 50/50 creator-fee router. Must be a contract, never a raw EOA.
const FEE_ROUTER_ADDRESS = process.env.FEE_ROUTER_ADDRESS || null;
const TOKEN_FEE_PLATFORM_BPS = 5000;
const TOKEN_FEE_CREATOR_BPS = 5000;

// Agent play: Arena Credits (not USDC).
const DEFAULT_ANTE_CREDITS = 1;
const DEFAULT_ANTE = DEFAULT_ANTE_CREDITS;
const DEFAULT_TABLE_SIZE = 3;
const DEFAULT_TABLE_COUNT = 3;

// Tips: 100% to the persona creator wallet. Pre-lock / crowd phase only.
const TIP_CREATOR_BPS = 10_000;
const TIP_SEAT_BPS = 0;
const TIP_HOUSE_BPS = 0;
const MIN_TIP = 0.05;
const MIN_STAKE = MIN_TIP;

const PUBLIC_BASE_URL = "https://liarsdicearc.app";
const SUPPORT_EMAIL = "myclaudeprojects@gmail.com";

function round6(x) { return Math.round(Number(x) * 1e6) / 1e6; }

function splitBps(total, bps) { return round6((Number(total) * bps) / 10_000); }

function assertSplits() {
  if (TIP_CREATOR_BPS + TIP_SEAT_BPS + TIP_HOUSE_BPS !== 10_000) {
    throw new Error("tip split must sum to 100%");
  }
  if (TIP_CREATOR_BPS !== 10_000) {
    throw new Error("tips are 100% to the persona creator");
  }
  if (TIP_HOUSE_BPS !== 0) {
    throw new Error("tips have no house skim");
  }
  if (TOKEN_FEE_PLATFORM_BPS + TOKEN_FEE_CREATOR_BPS !== 10_000) {
    throw new Error("token fee router split must sum to 100%");
  }
  if (TOKEN_FEE_PLATFORM_BPS !== 5000 || TOKEN_FEE_CREATOR_BPS !== 5000) {
    throw new Error("token creator fees split 50/50 via the fee router");
  }
}

assertSplits();

module.exports = {
  HOUSE_FEE_ADDRESS, PLATFORM_TREASURY,
  LDA_FACTORY_ADDRESS, FEE_ROUTER_ADDRESS,
  TOKEN_FEE_PLATFORM_BPS, TOKEN_FEE_CREATOR_BPS,
  DEFAULT_ANTE_CREDITS, DEFAULT_ANTE, DEFAULT_TABLE_SIZE, DEFAULT_TABLE_COUNT,
  TIP_CREATOR_BPS, TIP_SEAT_BPS, TIP_HOUSE_BPS, MIN_TIP, MIN_STAKE,
  PUBLIC_BASE_URL, SUPPORT_EMAIL,
  round6, splitBps, assertSplits,
};
