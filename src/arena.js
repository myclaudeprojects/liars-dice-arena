// arena.js — Orchestrates one match: seats the agents, funds the pot from
// USDC antes, drives turns, and settles the pot 20% creator / 80% seat.
// There is no spectator win pool. Emits events via a callback so a CLI, a
// websocket server, or a test can all consume the same stream.

const { Match } = require("./engine");
const { safeFallback } = require("./agents");
const { POT_CREATOR_BPS, POT_SEAT_BPS, DEFAULT_ANTE, round6 } = require("./economics");

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

async function runMatch({
  agents, wallet, ante = DEFAULT_ANTE, diceCount = 5, seed = Date.now(),
  onEvent = () => {}, maxSteps = 1000, potLabel = "pot",
  influence = null, freezeInfluence = true,
} = {}) {
  const seatWallets = {};
  for (const ag of agents) {
    seatWallets[ag.id] = ag.walletInfo || await wallet.createSeatWallet(ag.name);
  }
  const pot = await wallet.createPot(potLabel);

  const paid = [];
  try {
    for (const ag of agents) {
      const tx = await wallet.ante(seatWallets[ag.id], pot, ante);
      paid.push(ag);
      await onEvent({ type: "ante", agentId: ag.id, name: ag.name, amount: ante, tx, explorer: wallet.explorerUrl(tx), unit: "USDC" });
    }
  } catch (e) {
    await onEvent({ type: "ante_failed", error: String(e.message || e).slice(0, 200), paid: paid.length, unit: "USDC" });
    await refundAntes({ agents: paid, wallet, pot, seatWallets, ante, onEvent });
    throw e;
  }

  const potTotal = round6(ante * agents.length);
  await onEvent({ type: "pot_ready", total: potTotal, unit: "USDC" });

  const match = new Match({
    seats: agents.map((a) => ({ id: a.id, name: a.name })),
    diceCount, seed,
  });
  const byId = Object.fromEntries(agents.map((a) => [a.id, a]));

  await onEvent({ type: "match_start", seats: agents.map((a) => ({
    id: a.id, name: a.name, kind: a.kind, owner: a.owner || "house",
    ownerAddress: a.ownerAddress || null, personaTag: a.personaTag || null,
    imageUrl: `/api/agents/${encodeURIComponent(a.id)}/avatar`,
  })), seed, unit: "USDC" });
  const emitDeal = () => {
    if (influence && !freezeInfluence && match.handNumber > 1) {
      influence.decayHands(agents.map((a) => a.id));
    }
    return onEvent({ type: "hand_start", hand: match.handNumber,
      counts: match.players.map((p) => ({ id: p.id, dice: p.dice.length, alive: p.alive })), first: match.currentPlayer.id });
  };
  await emitDeal();

  let steps = 0;
  while (!match.winnerId && steps++ < maxSteps) {
    const actor = byId[match.currentPlayer.id];
    const view = match.viewFor(actor.id);
    if (influence) view.influence = influence.snapshot(actor.id);
    else if (typeof actor.influenceOf === "function") view.influence = actor.influenceOf();
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
    return { winnerId: null, winnerName: null, potTotal, aborted: true, unit: "USDC", balances, log: match.log, seed };
  }

  const winner = byId[match.winnerId];
  const creatorDest = winner.creatorWallet || winner.ownerWallet || null;
  const creatorShare = creatorDest ? round6((potTotal * POT_CREATOR_BPS) / 10_000) : 0;
  const seatShare = round6(potTotal - creatorShare);
  const settleTxs = [];
  if (creatorShare > 0) {
    const ctx = await wallet.settle(pot, creatorDest, creatorShare);
    settleTxs.push({ to: "creator", amount: creatorShare, tx: ctx, explorer: wallet.explorerUrl(ctx) });
    await onEvent({
      type: "pot_creator", winnerId: winner.id, name: winner.name, amount: creatorShare,
      tx: ctx, explorer: wallet.explorerUrl(ctx), unit: "USDC",
    });
  }
  const settleTx = await wallet.settle(pot, seatWallets[winner.id], seatShare);
  settleTxs.push({ to: "seat", amount: seatShare, tx: settleTx, explorer: wallet.explorerUrl(settleTx) });
  await onEvent({
    type: "settled", winnerId: winner.id, name: winner.name, amount: potTotal,
    seatShare, creatorShare, tx: settleTx, explorer: wallet.explorerUrl(settleTx), unit: "USDC",
  });
  await readBalances();

  return {
    winnerId: match.winnerId, winnerName: winner.name, potTotal,
    seatShare, creatorShare, settleTxs, unit: "USDC",
    balances, log: match.log, seed,
  };
}

module.exports = { runMatch };
