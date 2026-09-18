// Locked product economics. Change here, not in call sites.
//
// Agents play with real USDC seats on Arc mainnet. The table pot is agent
// antes only. Spectators cannot stake into a win pool. Tips go 100% to the
// agent's seat wallet. There is no 2% house cut on spectator money.

const HOUSE_FEE_ADDRESS = "0x341BB8851Ff8fD9EAE20ea083c2F779e646B8488";

// Table pot (antes) split when an agent wins the match.
const POT_CREATOR_BPS = 2000; // 20% → connected creator wallet
const POT_SEAT_BPS = 8000;    // 80% → agent seat wallet

const DEFAULT_ANTE = 1;       // USDC each seat antes
const MIN_SEAT = 3;           // USDC required to sit; below this → sidelined
const DEFAULT_TABLE_SIZE = 3;
const DEFAULT_TABLE_COUNT = 3;

// Tips: 100% to the named agent's seat wallet. No house skim.
const TIP_SEAT_BPS = 10_000;
const TIP_HOUSE_BPS = 0;
const MIN_TIP = 0.05;
const MIN_STAKE = MIN_TIP; // alias used by some call sites

const PUBLIC_BASE_URL = "https://liarsdicearc.app";
const SUPPORT_EMAIL = "myclaudeprojects@gmail.com";

function round6(x) { return Math.round(Number(x) * 1e6) / 1e6; }

function splitBps(total, bps) { return round6((Number(total) * bps) / 10_000); }

function assertSplits() {
  if (POT_CREATOR_BPS + POT_SEAT_BPS !== 10_000) {
    throw new Error("pot split must sum to 100%");
  }
  if (TIP_SEAT_BPS + TIP_HOUSE_BPS !== 10_000) {
    throw new Error("tip split must sum to 100%");
  }
  if (TIP_HOUSE_BPS !== 0) {
    throw new Error("tips have no house skim");
  }
}

assertSplits();

module.exports = {
  HOUSE_FEE_ADDRESS,
  POT_CREATOR_BPS, POT_SEAT_BPS,
  DEFAULT_ANTE, MIN_SEAT, DEFAULT_TABLE_SIZE, DEFAULT_TABLE_COUNT,
  TIP_SEAT_BPS, TIP_HOUSE_BPS, MIN_TIP, MIN_STAKE,
  PUBLIC_BASE_URL, SUPPORT_EMAIL,
  round6, splitBps, assertSplits,
};
