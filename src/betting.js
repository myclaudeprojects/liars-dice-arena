// betting.js — Spectator pari-mutuel pool, per table.
//
// Locked split of each table's pool:
//   2%  house  → HOUSE_FEE_ADDRESS
//   10% seat   → winning agent's seat wallet
//   88% pari-mutuel → winning backers, pro-rata
// One spectator bet per table (same bettor cannot hedge two seats).
// Betting at other tables is allowed. If nobody backed the winner, full refund.

const {
  HOUSE_FEE_ADDRESS, HOUSE_FEE_BPS, SEAT_FEE_BPS, PARI_BPS, round6,
} = require("./economics");

function bettorKey(id) {
  return String(id || "").trim().toLowerCase();
}

function computePayouts(bets, winnerId, opts = {}) {
  const houseBps = opts.houseBps ?? (typeof opts === "number" ? opts : HOUSE_FEE_BPS);
  const seatBps = opts.seatBps ?? SEAT_FEE_BPS;
  for (const b of bets) {
    if (!Number.isFinite(b.amount) || b.amount < 0) throw new Error("bad_amount");
  }
  const pool = round6(bets.reduce((s, b) => s + b.amount, 0));
  const winners = winnerId == null ? [] : bets.filter((b) => b.agentId === winnerId);
  const winnerStake = winners.reduce((s, b) => s + b.amount, 0);

  if (pool === 0) return { payouts: [], houseCut: 0, seatCut: 0, refunded: false, pool };

  if (winnerStake === 0) {
    return {
      payouts: bets.map((b) => ({ bettorId: b.bettorId, amount: b.amount })),
      houseCut: 0, seatCut: 0, refunded: true, pool,
    };
  }

  const houseCut = round6((pool * houseBps) / 10_000);
  const seatCut = round6((pool * seatBps) / 10_000);
  const distributable = round6(pool - houseCut - seatCut);

  const payouts = winners.map((b) => ({
    bettorId: b.bettorId,
    amount: round6((b.amount / winnerStake) * distributable),
  }));
  const sum = payouts.reduce((s, p) => s + p.amount, 0);
  const dust = round6(distributable - sum);
  if (payouts.length && dust !== 0) payouts[0].amount = round6(payouts[0].amount + dust);

  return { payouts, houseCut, seatCut, refunded: false, pool };
}

// Implied odds: multiplier on original stake if this seat wins (88% pool / stake on seat).
function impliedMultipliers(bets, agentIds, opts = {}) {
  const houseBps = typeof opts === "number" ? opts : (opts.houseBps ?? HOUSE_FEE_BPS);
  const seatBps = typeof opts === "number" ? SEAT_FEE_BPS : (opts.seatBps ?? SEAT_FEE_BPS);
  const pool = bets.reduce((s, b) => s + b.amount, 0);
  const pariFrac = 1 - houseBps / 10_000 - seatBps / 10_000;
  const out = {};
  for (const id of agentIds) {
    const stake = bets.filter((b) => b.agentId === id).reduce((s, b) => s + b.amount, 0);
    out[id] = stake > 0 ? round6((pool * pariFrac) / stake) : null;
  }
  return out;
}

class BettingPool {
  constructor({
    wallet,
    houseFeeBps = HOUSE_FEE_BPS,
    seatFeeBps = SEAT_FEE_BPS,
    houseAddress = HOUSE_FEE_ADDRESS,
    potLabel = "pool",
  } = {}) {
    this.wallet = wallet;
    this.houseFeeBps = houseFeeBps;
    this.seatFeeBps = seatFeeBps;
    this.houseAddress = houseAddress;
    this.potLabel = potLabel;
    this.bets = [];
    this.bettorWallets = {};
    this.poolWallet = null;
    this.open = true;
    this.closeAt = null;
    this.usedTx = new Set();
    this._q = Promise.resolve();
  }

  _serial(fn) {
    const next = this._q.then(fn, fn);
    this._q = next.catch(() => {});
    return next;
  }

  claimTx(txHash) {
    if (!txHash) throw new Error("missing_tx");
    if (this.usedTx.has(txHash)) throw new Error("tx_already_used");
    this.usedTx.add(txHash);
  }
  releaseTx(txHash) { this.usedTx.delete(txHash); }

  hasBettor(bettorId) {
    const k = bettorKey(bettorId);
    return this.bets.some((b) => bettorKey(b.bettorId) === k);
  }

  assertOneBet(bettorId) {
    if (this.hasBettor(bettorId)) {
      throw new Error("One bet per table — you can still bet at other tables.");
    }
  }

  recordExternal({ bettorId, address, agentId, amount, txHash, claimed = false }) {
    if (!claimed) this.claimTx(txHash);
    const amt = round6(Number(amount));
    if (!(amt > 0) || !Number.isFinite(amt)) throw new Error("bad_amount");
    this.assertOneBet(bettorId);
    this.bettorWallets[bettorId] = { walletId: null, address };
    this.bets.push({ bettorId, agentId, amount: amt, txHash });
  }

  async init() {
    this.poolWallet = await this.wallet.createPot(this.potLabel);
    return this.poolWallet;
  }

  async placeBet({ bettorId, bettorWallet, agentId, amount }) {
    return this._serial(() => this._placeBet({ bettorId, bettorWallet, agentId, amount }));
  }

  async _placeBet({ bettorId, bettorWallet, agentId, amount }) {
    if (!this.open) throw new Error("betting_closed");
    const amt = round6(Number(amount));
    if (!(amt > 0) || !Number.isFinite(amt)) throw new Error("bad_amount");
    this.assertOneBet(bettorId);
    const tx = await this.wallet.ante(bettorWallet, this.poolWallet, amt);
    this.bettorWallets[bettorId] = bettorWallet;
    this.bets.push({ bettorId, agentId, amount: amt });
    return { tx, explorer: this.wallet.explorerUrl(tx) };
  }

  close() { this.open = false; }

  async settle(winnerId, { house, seat } = {}) {
    const res = computePayouts(this.bets, winnerId, { houseBps: this.houseFeeBps, seatBps: this.seatFeeBps });
    const txs = [];
    const pay = async (dest, amount, label) => {
      if (!(amount > 0)) return;
      if (!dest || !(dest.address || dest.walletId)) {
        txs.push({ bettorId: label, amount, error: "missing_wallet" });
        return;
      }
      try {
        const tx = await this.wallet.settle(this.poolWallet, dest, amount);
        txs.push({ bettorId: label, amount, tx, explorer: this.wallet.explorerUrl(tx) });
      } catch (e) {
        txs.push({ bettorId: label, amount, error: String(e.message || e).slice(0, 200) });
      }
    };
    for (const p of res.payouts) {
      await pay(this.bettorWallets[p.bettorId], p.amount, p.bettorId);
    }
    if (!res.refunded) {
      const houseDest = house || { address: this.houseAddress };
      await pay(houseDest, res.houseCut, "house");
      await pay(seat, res.seatCut, "seat");
    }
    return { ...res, txs };
  }
}

module.exports = {
  computePayouts, impliedMultipliers, BettingPool, round6, bettorKey,
  HOUSE_FEE_BPS, SEAT_FEE_BPS, PARI_BPS, HOUSE_FEE_ADDRESS,
};
