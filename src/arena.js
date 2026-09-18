// arena.js — Orchestrates one match on Arena Credits (not USDC).
// Credits are free and nonredeemable. There is no player-funded pot and no
// chain transfer for antes. Emits events via a callback so a CLI, a websocket
// server, or a test can all consume the same stream.

const { Match } = require("./engine");
const { safeFallback } = require("./agents");
const { CreditBook } = require("./credits");
const { DEFAULT_ANTE_CREDITS, assertAnteCredits } = require("./economics");

function refundAntes({ agents, credits, ante, onEvent }) {
  for (const ag of agents) {
    try {
      credits.credit(ag.id, ante);
      onEvent({ type: "refund", agentId: ag.id, name: ag.name, amount: ante, unit: "credits" });
    } catch (e) {
      onEvent({ type: "refund_failed", agentId: ag.id, name: ag.name, error: String(e.message || e).slice(0, 200) });
    }
  }
}

async function runMatch({
  agents, credits, ante = DEFAULT_ANTE_CREDITS, diceCount = 5, seed = Date.now(),
  onEvent = () => {}, maxSteps = 1000, influence = null, freezeInfluence = true,
} = {}) {
  const book = credits || new CreditBook({ persist: false });
  const anteCredits = assertAnteCredits(ante);
  const paid = [];
  try {
    for (const ag of agents) {
      book.ensure(ag.id, anteCredits);
      book.debit(ag.id, anteCredits);
      paid.push(ag);
      await onEvent({
        type: "ante", agentId: ag.id, name: ag.name, amount: anteCredits, unit: "credits",
      });
    }
  } catch (e) {
    await onEvent({ type: "ante_failed", error: String(e.message || e).slice(0, 200), paid: paid.length, unit: "credits" });
    refundAntes({ agents: paid, credits: book, ante: anteCredits, onEvent });
    throw e;
  }

  const potTotal = anteCredits * agents.length;
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
    // Locked crowd weights stay fixed through the match. Decay is only for
    // tests of the helper when freezeInfluence is false.
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

  const balances = book.snapshot(agents.map((a) => a.id));

  if (!match.winnerId) {
    await onEvent({ type: "aborted", reason: "no_winner", steps: maxSteps });
    refundAntes({ agents, credits: book, ante: anteCredits, onEvent: (ev) => onEvent(ev) });
    return {
      winnerId: null, winnerName: null, potTotal, aborted: true, unit: "credits",
      balances: book.snapshot(agents.map((a) => a.id)), log: match.log, seed,
    };
  }

  const winner = byId[match.winnerId];
  book.credit(winner.id, potTotal);
  await onEvent({
    type: "settled", winnerId: winner.id, name: winner.name, amount: potTotal,
    unit: "credits", redeemable: false,
  });

  return {
    winnerId: match.winnerId, winnerName: winner.name, potTotal,
    unit: "credits", redeemable: false,
    balances: book.snapshot(agents.map((a) => a.id)), log: match.log, seed,
  };
}

module.exports = { runMatch };
