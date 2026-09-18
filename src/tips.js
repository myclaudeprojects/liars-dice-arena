// tips.js — Spectator gifts to an agent's persona creator, with one influence.
//
// Crowd / pre-lock only. Not a wager: no pool, no odds, no multipliers, no
// payout if the agent wins or loses. 100% of a tip goes to the persona
// creator wallet. The tipper is never entitled to winnings. House skim is 0.
// Duplicate tx hashes are rejected. Each tip must pick ONE influence.

const { TIP_CREATOR_BPS, TIP_SEAT_BPS, TIP_HOUSE_BPS, MIN_TIP, round6 } = require("./economics");
const { assertInfluence } = require("./influence");

function tipperKey(id) {
  return String(id || "").trim().toLowerCase();
}

function assertTipAmount(amount, min = MIN_TIP, max = 1000) {
  const amt = round6(Number(amount));
  if (!(amt >= min) || amt > max || !Number.isFinite(amt)) {
    throw new Error(`Tip must be between ${min} and ${max} USDC.`);
  }
  return amt;
}

class TipBook {
  constructor() {
    this.usedTx = new Set();
    this.tips = [];
  }

  claimTx(txHash) {
    if (!txHash) throw new Error("missing_tx");
    if (this.usedTx.has(txHash)) throw new Error("tx_already_used");
    this.usedTx.add(txHash);
  }
  releaseTx(txHash) { this.usedTx.delete(txHash); }

  record({ from, agentId, amount, txHash, tableId, creator, influence, mock = false }) {
    const amt = round6(Number(amount));
    if (!(amt > 0) || !Number.isFinite(amt)) throw new Error("bad_amount");
    const inf = assertInfluence(influence);
    const row = {
      from: from || null,
      agentId,
      amount: amt,
      influence: inf,
      txHash: txHash || null,
      tableId: tableId || null,
      creator: creator || null,
      mock: !!mock,
      at: Date.now(),
      houseBps: TIP_HOUSE_BPS,
      seatBps: TIP_SEAT_BPS,
      creatorBps: TIP_CREATOR_BPS,
      toCredits: false,
      toPrize: false,
      toPot: false,
      toSeat: false,
      toCreator: true,
      entitlesWinnings: false,
    };
    this.tips.push(row);
    return row;
  }
}

module.exports = {
  TipBook, assertTipAmount, tipperKey, round6,
  TIP_CREATOR_BPS, TIP_SEAT_BPS, TIP_HOUSE_BPS,
};
