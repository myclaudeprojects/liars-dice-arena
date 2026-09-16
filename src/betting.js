// betting.js — Spectator pari-mutuel pool.
//
// Humans back an agent before the match. All stakes go into one pool wallet.
// After the match, backers of the winner split the ENTIRE pool pro-rata to
// their stake (optionally minus a house fee in bps). Losers get nothing.
// If nobody backed the winner, everyone is refunded.
//
// Pure math lives in `computePayouts` (unit-testable). `BettingPool` wires it
// to the wallet adapter for real settlement.

function computePayouts(bets, winnerId, houseFeeBps = 0) {
  // bets: [{ bettorId, agentId, amount }]
  const pool = bets.reduce((s, b) => s + b.amount, 0);
  const winners = bets.filter((b) => b.agentId === winnerId);
  const winnerStake = winners.reduce((s, b) => s + b.amount, 0);

  if (pool === 0) return { payouts: [], houseCut: 0, refunded: false, pool };

  if (winnerStake === 0) {
    // Nobody picked the winner -> full refund, no fee.
    return {
      payouts: bets.map((b) => ({ bettorId: b.bettorId, amount: b.amount })),
      houseCut: 0, refunded: true, pool,
    };
  }

  const houseCut = round6((pool * houseFeeBps) / 10_000);
  const distributable = pool - houseCut;

  // Pro-rata share of the whole pool per unit of winning stake.
  const payouts = winners.map((b) => ({
    bettorId: b.bettorId,
    amount: round6((b.amount / winnerStake) * distributable),
  }));

  // Fix rounding dust so payouts sum exactly to distributable.
  const sum = payouts.reduce((s, p) => s + p.amount, 0);
  const dust = round6(distributable - sum);
  if (payouts.length && dust !== 0) payouts[0].amount = round6(payouts[0].amount + dust);

  return { payouts, houseCut, refunded: false, pool };
}

// Implied odds shown live in the UI: multiplier a backer of `agentId` gets if it wins.
function impliedMultipliers(bets, agentIds, houseFeeBps = 0) {
  const pool = bets.reduce((s, b) => s + b.amount, 0);
  const out = {};
  for (const id of agentIds) {
    const stake = bets.filter((b) => b.agentId === id).reduce((s, b) => s + b.amount, 0);
    out[id] = stake > 0 ? round6((pool * (1 - houseFeeBps / 10_000)) / stake) : null;
  }
  return out;
}

function round6(x) { return Math.round(x * 1e6) / 1e6; } // USDC has 6 decimals

class BettingPool {
  constructor({ wallet, houseFeeBps = 200 }) {
    this.wallet = wallet;
    this.houseFeeBps = houseFeeBps;
    this.bets = [];
    this.bettorWallets = {}; // bettorId -> { walletId, address }
    this.poolWallet = null;
    this.open = true;
    this.closeAt = null;
    this.usedTx = new Set();
  }

  // A bet whose USDC already arrived on-chain from the bettor's own wallet.
  // Payout goes straight back to that address.
  recordExternal({ bettorId, address, agentId, amount, txHash }) {
    if (this.usedTx.has(txHash)) throw new Error("tx_already_used");
    this.usedTx.add(txHash);
    this.bettorWallets[bettorId] = { walletId: null, address };
    this.bets.push({ bettorId, agentId, amount, txHash });
  }

  async init() {
    this.poolWallet = await this.wallet.createPot("pool"); // separate from the agents' pot
    return this.poolWallet;
  }

  // In production the bettor signs a transfer from THEIR wallet (e.g. via
  // Circle Gateway / a connected wallet) into poolWallet.address. Here we take a
  // wallet object we control so the mock flow works end-to-end.
  async placeBet({ bettorId, bettorWallet, agentId, amount }) {
    if (!this.open) throw new Error("betting_closed");
    if (!(amount > 0)) throw new Error("bad_amount");
    const tx = await this.wallet.ante(bettorWallet, this.poolWallet, amount);
    this.bettorWallets[bettorId] = bettorWallet;
    this.bets.push({ bettorId, agentId, amount });
    return { tx, explorer: this.wallet.explorerUrl(tx) };
  }

  close() { this.open = false; }

  async settle(winnerId, houseWallet) {
    const res = computePayouts(this.bets, winnerId, this.houseFeeBps);
    const txs = [];
    for (const p of res.payouts) {
      if (p.amount <= 0) continue;
      const tx = await this.wallet.settle(this.poolWallet, this.bettorWallets[p.bettorId], p.amount);
      txs.push({ bettorId: p.bettorId, amount: p.amount, tx, explorer: this.wallet.explorerUrl(tx) });
    }
    if (res.houseCut > 0 && houseWallet) {
      const tx = await this.wallet.settle(this.poolWallet, houseWallet, res.houseCut);
      txs.push({ bettorId: "house", amount: res.houseCut, tx });
    }
    return { ...res, txs };
  }
}

module.exports = { computePayouts, impliedMultipliers, BettingPool, round6 };
