// arena.js — Orchestrates one match: seats the agents, funds the pot from antes,
// drives turns, and settles USDC to the winner. Emits events via a callback so
// a CLI, a websocket server, or a test can all consume the same stream.

const { Match } = require("./engine");

async function runMatch({ agents, wallet, ante = 1, diceCount = 5, seed = Date.now(), onEvent = () => {}, maxSteps = 1000 }) {
  // 1) Wallets for each seat + the pot.
  const seatWallets = {};
  for (const ag of agents) {
    seatWallets[ag.id] = ag.walletInfo || await wallet.createSeatWallet(ag.name);
  }
  const pot = await wallet.createPot();

  // 2) Collect antes on-chain (the pot fills).
  for (const ag of agents) {
    const tx = await wallet.ante(seatWallets[ag.id], pot, ante);
    onEvent({ type: "ante", agentId: ag.id, name: ag.name, amount: ante, tx, explorer: wallet.explorerUrl(tx) });
  }
  const potTotal = Math.round(ante * agents.length * 1e6) / 1e6;
  onEvent({ type: "pot_ready", total: potTotal });

  // 3) Play.
  const match = new Match({
    seats: agents.map((a) => ({ id: a.id, name: a.name })),
    diceCount, seed,
  });
  const byId = Object.fromEntries(agents.map((a) => [a.id, a]));

  onEvent({ type: "match_start", seats: agents.map((a) => ({ id: a.id, name: a.name, kind: a.kind, owner: a.owner || "house" })), seed });
  const emitDeal = () => onEvent({ type: "hand_start", hand: match.handNumber,
    counts: match.players.map((p) => ({ id: p.id, dice: p.dice.length, alive: p.alive })), first: match.currentPlayer.id });
  emitDeal();

  let steps = 0;
  while (!match.winnerId && steps++ < maxSteps) {
    const actor = byId[match.currentPlayer.id];
    const view = match.viewFor(actor.id);
    const { action, thought } = await actor.act(view);

    onEvent({
      type: "turn", agentId: actor.id, name: actor.name,
      thought, action, bidBefore: view.currentBid,
    });

    const res = match.applyAction(action);
    if (!res.ok) {
      // Illegal move slipped through — force a challenge so the match can't stall.
      onEvent({ type: "illegal", agentId: actor.id, error: res.error, action });
      match.applyAction({ type: "challenge" });
      continue;
    }
    if (res.resolved) {
      onEvent({ type: "reveal", ...res.resolved,
        bidderName: byId[res.resolved.bidderId].name,
        challengerName: byId[res.resolved.challengerId].name,
        loserName: byId[res.resolved.loserId].name });
      if (!res.matchOver) emitDeal();
    }
  }

  // 4) Settle the pot to the winner on-chain.
  const winner = byId[match.winnerId];
  const settleTx = await wallet.settle(pot, seatWallets[winner.id], potTotal);
  onEvent({ type: "settled", winnerId: winner.id, name: winner.name, amount: potTotal, tx: settleTx, explorer: wallet.explorerUrl(settleTx) });

  // 5) Final balances (nice for the UI).
  const balances = {};
  for (const ag of agents) balances[ag.id] = await wallet.getBalance(seatWallets[ag.id].walletId);

  return { winnerId: match.winnerId, winnerName: winner.name, potTotal, balances, log: match.log, seed };
}

module.exports = { runMatch };
