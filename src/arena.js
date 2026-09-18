// arena.js — Orchestrates one match: seats the agents, antes Arena Credits,
// drives turns, and awards the credit pot to the winner. Credits are free
// and nonredeemable. There is no real-USDC agent pot. Influence is frozen
// at lock (freezeInfluence: true). Emits events via a callback.

const { Match } = require("./engine");
const { safeFallback } = require("./agents");
const { DEFAULT_ANTE_CREDITS, round6 } = require("./economics");

async function runMatch({
  agents, credits, ante = DEFAULT_ANTE_CREDITS, diceCount = 5, seed = Date.now(),
  onEvent = () => {}, maxSteps = 1000,
  influence = null, freezeInfluence = true,
} = {}) {
  if (!credits) throw new Error("credits book required");

  const paid = [];
  try {
    for (const ag of agents) {
      credits.ensure(ag.id, ante);
      credits.debit(ag.id, ante);
      paid.push(ag);
      await onEvent({ type: "ante", agentId: ag.id, name: ag.name, amount: ante, unit: "credits" });
    }
  } catch (e) {
    await onEvent({ type: "ante_failed", error: String(e.message || e).slice(0, 200), paid: paid.length, unit: "credits" });
    for (const ag of paid) {
      try { credits.credit(ag.id, ante); } catch { /* best-effort refund */ }
    }
    throw e;
  }

  const potTotal = round6(ante * agents.length);
  await onEvent({ type: "pot_ready", total: potTotal, unit: "credits" });

  const match = new Match({
    seats: agents.map((a) => ({ id: a.id, name: a.name })),
    diceCount, seed,
  });
  const byId = Object.fromEntries(agents.map((a) => [a.id, a]));

  await onEvent({ type: "match_start", seats: agents.map((a) => ({
    id: a.id, name: a.name, kind: a.kind, owner: a.owner || "house",
    ownerAddress: a.ownerAddress || null, personaTag: a.personaTag || null,
    imageUrl: `/api/agents/${encodeURIComponent(a.id)}/avatar`,
  })), seed, unit: "credits" });
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
  const readBalances = () => {
    for (const ag of agents) balances[ag.id] = credits.balance(ag.id);
  };

  if (!match.winnerId) {
    await onEvent({ type: "aborted", reason: "no_winner", steps: maxSteps, unit: "credits" });
    for (const ag of agents) {
      try { credits.credit(ag.id, ante); } catch { /* refund */ }
    }
    readBalances();
    return { winnerId: null, winnerName: null, potTotal, aborted: true, unit: "credits", balances, log: match.log, seed };
  }

  const winner = byId[match.winnerId];
  credits.credit(winner.id, potTotal);
  await onEvent({
    type: "settled", winnerId: winner.id, name: winner.name, amount: potTotal,
    unit: "credits",
  });
  readBalances();

  return {
    winnerId: match.winnerId, winnerName: winner.name, potTotal,
    unit: "credits", balances, log: match.log, seed,
  };
}

module.exports = { runMatch };
