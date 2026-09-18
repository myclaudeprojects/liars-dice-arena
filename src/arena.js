// arena.js — Orchestrates one match: seats the agents, funds the pot from antes,
// drives turns, and settles USDC to the winner. Emits events via a callback so
// a CLI, a websocket server, or a test can all consume the same stream.

const { Match } = require("./engine");
const { safeFallback } = require("./agents");

async function refundAntes({ agents, wallet, pot, seatWallets, ante, onEvent }) {
  for (const ag of agents) {
    try {
      const tx = await wallet.settle(pot, seatWallets[ag.id], ante);
      await onEvent({ type: "refund", agentId: ag.id, name: ag.name, amount: ante, tx, explorer: wallet.explorerUrl(tx) });
    } catch (e) {
      await onEvent({ type: "refund_failed", agentId: ag.id, name: ag.name, error: String(e.message || e).slice(0, 200) });
    }
  }
}

async function runMatch({ agents, wallet, ante = 1, diceCount = 5, seed = Date.now(), onEvent = () => {}, maxSteps = 1000 }) {
  const seatWallets = {};
  for (const ag of agents) {
    seatWallets[ag.id] = ag.walletInfo || await wallet.createSeatWallet(ag.name);
  }
  const pot = await wallet.createPot();

  // Collect antes; if a later ante fails, refund whoever already paid so funds
  // are not stuck in the pot.
  const paid = [];
  try {
    for (const ag of agents) {
      const tx = await wallet.ante(seatWallets[ag.id], pot, ante);
      paid.push(ag);
      await onEvent({ type: "ante", agentId: ag.id, name: ag.name, amount: ante, tx, explorer: wallet.explorerUrl(tx) });
    }
  } catch (e) {
    await onEvent({ type: "ante_failed", error: String(e.message || e).slice(0, 200), paid: paid.length });
    for (const ag of paid) {
      try {
        const tx = await wallet.settle(pot, seatWallets[ag.id], ante);
        await onEvent({ type: "refund", agentId: ag.id, name: ag.name, amount: ante, tx, explorer: wallet.explorerUrl(tx) });
      } catch (re) {
        await onEvent({ type: "refund_failed", agentId: ag.id, error: String(re.message || re).slice(0, 200) });
      }
    }
    throw e;
  }

  const potTotal = Math.round(ante * agents.length * 1e6) / 1e6;
  await onEvent({ type: "pot_ready", total: potTotal });

  const match = new Match({
    seats: agents.map((a) => ({ id: a.id, name: a.name })),
    diceCount, seed,
  });
  const byId = Object.fromEntries(agents.map((a) => [a.id, a]));

  await onEvent({ type: "match_start", seats: agents.map((a) => ({ id: a.id, name: a.name, kind: a.kind, owner: a.owner || "house" })), seed });
  const emitDeal = () => onEvent({ type: "hand_start", hand: match.handNumber,
    counts: match.players.map((p) => ({ id: p.id, dice: p.dice.length, alive: p.alive })), first: match.currentPlayer.id });
  await emitDeal();

  let steps = 0;
  while (!match.winnerId && steps++ < maxSteps) {
    const actor = byId[match.currentPlayer.id];
    const view = match.viewFor(actor.id);
    let played;
    try {
      played = await actor.act(view);
    } catch (e) {
      played = safeFallback(view, `act crashed: ${e.message}`);
    }
    if (!played || !played.action) played = safeFallback(view, "empty act");

    await onEvent({
      type: "turn", agentId: actor.id, name: actor.name,
      thought: played.thought, action: played.action, bidBefore: view.currentBid,
    });

    let res = match.applyAction(played.action);
    if (!res.ok) {
      const fb = safeFallback(view, `illegal: ${res.error}`);
      await onEvent({ type: "illegal", agentId: actor.id, error: res.error, action: played.action, fallback: fb.action });
      res = match.applyAction(fb.action);
      if (!res.ok) {
        // Last resort: challenge if a bid exists, else the match cannot stall —
        // refund and abort after the loop's maxSteps guard.
        if (view.currentBid) res = match.applyAction({ type: "challenge" });
        if (!res.ok) continue;
      }
    }
    if (res.resolved) {
      await onEvent({ type: "reveal", ...res.resolved,
        bidderName: byId[res.resolved.bidderId].name,
        challengerName: byId[res.resolved.challengerId].name,
        loserName: byId[res.resolved.loserId].name });
      if (!res.matchOver) await emitDeal();
    }
  }

  const balances = {};
  const readBalances = async () => {
    for (const ag of agents) balances[ag.id] = await wallet.getBalance(seatWallets[ag.id].walletId);
  };

  if (!match.winnerId) {
    await onEvent({ type: "aborted", reason: "no_winner", steps: maxSteps });
    await refundAntes({ agents, wallet, pot, seatWallets, ante, onEvent });
    await readBalances();
    return { winnerId: null, winnerName: null, potTotal, aborted: true, balances, log: match.log, seed };
  }

  const winner = byId[match.winnerId];
  const settleTx = await wallet.settle(pot, seatWallets[winner.id], potTotal);
  await onEvent({ type: "settled", winnerId: winner.id, name: winner.name, amount: potTotal, tx: settleTx, explorer: wallet.explorerUrl(settleTx) });
  await readBalances();

  return { winnerId: match.winnerId, winnerName: winner.name, potTotal, balances, log: match.log, seed };
}

module.exports = { runMatch };
