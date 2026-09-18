// prizes.js — Platform-funded USDC prizes paid to creators.
//
// Funded only from the house/prize treasury (including the 25% token-tax
// "Platform prize treasury" slice). Never from tips, Arena Credits, match
// pots, or other users' losses. Paid to the winning agent's creator wallet.

const {
  PRIZE_WALLET, PRIZE_EVERY_MATCHES, PRIZE_USDC, PRIZE_MIN_PLAYED, round6,
} = require("./economics");

function prizeRules() {
  return {
    everyMatches: PRIZE_EVERY_MATCHES,
    amountUsdc: PRIZE_USDC,
    minPlayed: PRIZE_MIN_PLAYED,
    paidTo: "creator",
    sourceWallet: PRIZE_WALLET,
    unit: "USDC",
    ineligible: ["house agents", "agents below minPlayed"],
    notFrom: [
      "spectator tips",
      "Arena Credits",
      "match antes",
      "other users' losses",
      "player-funded pots",
    ],
    summary: `After every ${PRIZE_EVERY_MATCHES} settled matches, the highest-ELO community agent with at least ${PRIZE_MIN_PLAYED} matches played wins ${PRIZE_USDC} USDC, paid from the platform prize treasury to that agent's creator wallet. Independent of credits and tips.`,
  };
}

function pickLaureate(stats, registry, { minPlayed = PRIZE_MIN_PLAYED } = {}) {
  const lb = stats.leaderboard();
  for (const a of lb.agents) {
    const rec = registry.get(a.id);
    if (!rec || rec.house) continue;
    if ((a.played || 0) < minPlayed) continue;
    if (!rec.ownerAddress) continue;
    return { agent: a, rec };
  }
  return null;
}

function shouldAward(totals, every = PRIZE_EVERY_MATCHES) {
  const n = Number(totals?.matches) || 0;
  return n > 0 && n % every === 0;
}

async function maybeAwardPrize({
  stats, registry, wallet, amount = PRIZE_USDC, every = PRIZE_EVERY_MATCHES,
  minPlayed = PRIZE_MIN_PLAYED, live = false,
} = {}) {
  const rules = prizeRules();
  if (!shouldAward(stats.s?.totals || stats.leaderboard().totals, every)) {
    return { awarded: false, reason: "not_due" };
  }
  const pick = pickLaureate(stats, registry, { minPlayed });
  if (!pick) return { awarded: false, reason: "no_eligible", rules };
  const dest = { address: pick.rec.ownerAddress };
  let tx = null, explorer = null, error = null;
  try {
    if (wallet && wallet.kind === "mock" && wallet.credit) {
      tx = await wallet.credit(dest, amount);
      explorer = wallet.explorerUrl?.(tx) || null;
    } else if (wallet && live) {
      const house = { walletId: "house", address: PRIZE_WALLET };
      tx = await wallet.settle(house, dest, amount);
      explorer = wallet.explorerUrl?.(tx) || null;
    } else if (wallet && wallet.settle) {
      const house = wallet.houseWallet || { walletId: "house", address: PRIZE_WALLET };
      tx = await wallet.settle(house, dest, amount);
      explorer = wallet.explorerUrl?.(tx) || null;
    }
  } catch (e) {
    error = String(e.message || e).slice(0, 200);
  }
  const row = {
    at: Date.now(),
    amount: round6(amount),
    agentId: pick.agent.id,
    agentName: pick.agent.name,
    creator: pick.rec.ownerAddress,
    elo: pick.agent.elo,
    matches: stats.s?.totals?.matches || stats.leaderboard().totals.matches,
    tx, explorer, error,
    pending: !!error,
    source: "platform_prize_treasury",
    paidTo: "creator",
  };
  if (stats.recordPrize) stats.recordPrize(row);
  return { awarded: !error, reason: error ? "pay_failed" : "ok", prize: row, rules };
}

module.exports = { prizeRules, pickLaureate, shouldAward, maybeAwardPrize, PRIZE_WALLET };
