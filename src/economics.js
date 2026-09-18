// Locked product economics. Change here, not in call sites.

const HOUSE_FEE_ADDRESS = "0x341BB8851Ff8fD9EAE20ea083c2F779e646B8488";

// Spectator bet split of the table pool (must sum to 10_000 bps).
const HOUSE_FEE_BPS = 200;   // 2% → HOUSE_FEE_ADDRESS
const SEAT_FEE_BPS = 1000;   // 10% → winning agent's seat wallet
const PARI_BPS = 8800;       // 88% → winning backers, pro-rata

// Table pot (antes) split when an agent wins the match.
const POT_CREATOR_BPS = 2000; // 20% → connected creator wallet
const POT_SEAT_BPS = 8000;    // 80% → agent seat wallet

const DEFAULT_ANTE = 1;       // USDC each seat antes
const MIN_SEAT = 3;           // USDC required to sit; below this → sidelined
const DEFAULT_TABLE_SIZE = 3;
const DEFAULT_TABLE_COUNT = 3;
const MIN_STAKE = 0.05;
const PUBLIC_BASE_URL = "https://liarsdicearc.app";
const SUPPORT_EMAIL = "myclaudeprojects@gmail.com";

function round6(x) { return Math.round(Number(x) * 1e6) / 1e6; }

function splitBps(total, bps) { return round6((Number(total) * bps) / 10_000); }

function assertBetSplit() {
  if (HOUSE_FEE_BPS + SEAT_FEE_BPS + PARI_BPS !== 10_000) {
    throw new Error("bet split must sum to 100%");
  }
  if (POT_CREATOR_BPS + POT_SEAT_BPS !== 10_000) {
    throw new Error("pot split must sum to 100%");
  }
}

assertBetSplit();

module.exports = {
  HOUSE_FEE_ADDRESS,
  HOUSE_FEE_BPS, SEAT_FEE_BPS, PARI_BPS,
  POT_CREATOR_BPS, POT_SEAT_BPS,
  DEFAULT_ANTE, MIN_SEAT, DEFAULT_TABLE_SIZE, DEFAULT_TABLE_COUNT, MIN_STAKE,
  PUBLIC_BASE_URL, SUPPORT_EMAIL,
  round6, splitBps, assertBetSplit,
};
