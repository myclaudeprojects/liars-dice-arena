// influence.js — Tips shift how an agent will play. Money still goes 100%
// to the agent's seat. Influence is never a claim on winnings or the pot.

const { round6 } = require("./economics");

const INFLUENCE_IDS = Object.freeze(["aggressive", "calculated", "chaos", "defensive"]);

const INFLUENCES = Object.freeze({
  aggressive: {
    id: "aggressive",
    label: "Aggressive",
    blurb: "Bluff more, challenge more",
  },
  calculated: {
    id: "calculated",
    label: "Calculated",
    blurb: "Play tighter / probability-focused",
  },
  chaos: {
    id: "chaos",
    label: "Chaos",
    blurb: "More unpredictable",
  },
  defensive: {
    id: "defensive",
    label: "Defensive",
    blurb: "Protect position / avoid marginal challenges",
  },
});

const INFLUENCE_DECAY_PER_HAND = 0.65;
const INFLUENCE_FLOOR = 0.02;

function emptyWeights() {
  return { aggressive: 0, calculated: 0, chaos: 0, defensive: 0 };
}

function assertInfluence(id) {
  const k = String(id || "").trim().toLowerCase();
  if (!INFLUENCES[k]) {
    throw new Error("Pick one influence: Aggressive, Calculated, Chaos, or Defensive.");
  }
  return k;
}

function influenceList() {
  return INFLUENCE_IDS.map((id) => ({ ...INFLUENCES[id] }));
}

function clamp01(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function snapshotFromWeights(weights) {
  const w = emptyWeights();
  let total = 0;
  for (const id of INFLUENCE_IDS) {
    const v = Math.max(0, Number(weights?.[id]) || 0);
    w[id] = round6(v);
    total += w[id];
  }
  total = round6(total);
  const shares = emptyWeights();
  let dominant = null;
  let best = 0;
  if (total >= INFLUENCE_FLOOR) {
    for (const id of INFLUENCE_IDS) {
      shares[id] = round6(w[id] / total);
      if (w[id] > best) { best = w[id]; dominant = id; }
    }
  }
  const meta = dominant ? INFLUENCES[dominant] : null;
  return {
    weights: w,
    shares,
    total,
    dominant,
    label: meta ? meta.label : null,
    blurb: meta ? meta.blurb : null,
    toCredits: false,
    toPrize: false,
    entitlesWinnings: false,
  };
}

// Mix a heuristic aggression (0..1) with live influence shares.
// rng is injectable so tests can freeze chaos.
function effectivePlay(baseAggression, snap, rng = Math.random) {
  const s = snap?.shares || emptyWeights();
  const t = Number(snap?.total) || 0;
  const live = t >= INFLUENCE_FLOOR;
  let aggression = Number(baseAggression);
  if (!Number.isFinite(aggression)) aggression = 0.5;
  if (live) {
    aggression += 0.40 * s.aggressive - 0.30 * s.calculated - 0.20 * s.defensive;
    if (s.chaos) aggression += (rng() - 0.5) * 0.50 * s.chaos;
  }
  aggression = clamp01(aggression);
  // challengeEase: higher → more willing to call liar.
  let challengeEase = 0;
  if (live) {
    challengeEase = 0.45 * s.aggressive - 0.50 * s.defensive + 0.10 * s.calculated;
    if (s.chaos) challengeEase += (rng() - 0.5) * 0.70 * s.chaos;
  }
  // bidNudge: chance to push the bid one extra pip / stay honest.
  let bidNudge = live ? (0.35 * s.aggressive - 0.25 * s.calculated - 0.20 * s.defensive) : 0;
  if (live && s.chaos) bidNudge += (rng() - 0.5) * 0.50 * s.chaos;
  return {
    aggression,
    challengeEase,
    bidNudge,
    chaos: live ? s.chaos : 0,
    dominant: live ? snap.dominant : null,
    live,
  };
}

function influencePrompt(snap) {
  if (!snap || !snap.dominant || !(snap.total >= INFLUENCE_FLOOR)) return "";
  const parts = INFLUENCE_IDS
    .filter((id) => snap.weights[id] >= INFLUENCE_FLOOR)
    .map((id) => `${INFLUENCES[id].label} ${snap.weights[id].toFixed(2)}`);
  return `SPECTATOR INFLUENCE (crowd-phase weights, locked for this match). Tippers are never entitled to winnings. Lean ${snap.label} — ${snap.blurb}. Weights: ${parts.join(", ")}.`;
}

class InfluenceBook {
  constructor({ decay = INFLUENCE_DECAY_PER_HAND } = {}) {
    this.decay = decay;
    this.byAgent = new Map();
    this.frozen = new Map();
  }

  _row(id) {
    const k = String(id);
    if (!this.byAgent.has(k)) this.byAgent.set(k, emptyWeights());
    return this.byAgent.get(k);
  }

  isFrozen(agentId) {
    return this.frozen.has(String(agentId));
  }

  apply(agentId, influence, amount) {
    if (this.isFrozen(agentId)) {
      throw new Error("This agent's personality is locked for the match. No further paid influence.");
    }
    const k = assertInfluence(influence);
    const amt = round6(Number(amount));
    if (!(amt > 0) || !Number.isFinite(amt)) throw new Error("bad_amount");
    const row = this._row(agentId);
    row[k] = round6(row[k] + amt);
    return this.snapshot(agentId);
  }

  freezeAgents(ids) {
    const out = {};
    for (const id of ids || []) {
      const snap = snapshotFromWeights(this._row(id));
      snap.locked = true;
      this.frozen.set(String(id), snap);
      out[id] = snap;
    }
    return out;
  }

  thawAgents(ids) {
    for (const id of ids || []) this.frozen.delete(String(id));
  }

  resetAgents(ids) {
    for (const id of ids || []) {
      this.byAgent.set(String(id), emptyWeights());
      this.frozen.delete(String(id));
    }
  }

  decayHand(agentId) {
    if (this.isFrozen(agentId)) return this.snapshot(agentId);
    const row = this._row(agentId);
    for (const id of INFLUENCE_IDS) {
      const next = round6(row[id] * this.decay);
      row[id] = next < INFLUENCE_FLOOR ? 0 : next;
    }
    return this.snapshot(agentId);
  }

  decayHands(ids) {
    for (const id of ids || []) this.decayHand(id);
  }

  snapshot(agentId) {
    const frozen = this.frozen.get(String(agentId));
    if (frozen) return { ...frozen, locked: true };
    return snapshotFromWeights(this._row(agentId));
  }
}

module.exports = {
  INFLUENCE_IDS, INFLUENCES, INFLUENCE_DECAY_PER_HAND, INFLUENCE_FLOOR,
  emptyWeights, assertInfluence, influenceList, snapshotFromWeights,
  effectivePlay, influencePrompt, InfluenceBook, clamp01,
};
