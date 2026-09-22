// simmarket.js — Test-credit prediction book for one match at a time.
//
// Credits have no cash value. LDA is not a real-money exchange.
// A future regulated partner would list, clear, and settle real-money
// contracts against the same match id + result hash. This module never
// touches USDC, wallets, or custody.

const STARTING_CREDITS = 1000;
const DEFAULT_STAKE = 50;
const MIN_STAKE = 10;
const MAX_STAKE = 250;
const THEORY_TAGS = ["Aggressive", "Conservative", "Bluffer", "Risk-taker", "Pressure player", "Unpredictable"];

function round4(x) { return Math.round(Number(x) * 10000) / 10000; }

function assertPredictorId(id) {
  const s = String(id || "");
  if (!/^[a-z0-9]{8,40}$/.test(s)) {
    const err = new Error("bad_predictor");
    err.code = "bad_predictor";
    throw err;
  }
  return s;
}

function fail(code) {
  const err = new Error(code);
  err.code = code;
  throw err;
}

class SimMarket {
  constructor() {
    this.predictors = new Map();
    this.markets = new Map();
    this.buysAt = new Map();
  }

  openPredictor(id) {
    const pid = assertPredictorId(id);
    if (!this.predictors.has(pid)) {
      this.predictors.set(pid, {
        id: pid,
        credits: STARTING_CREDITS,
        granted: STARTING_CREDITS,
        picks: 0,
        correct: 0,
        streak: 0,
        bestStreak: 0,
        pnl: 0,
        theories: {},
        createdAt: Date.now(),
      });
    }
    return this.publicPredictor(this.predictors.get(pid));
  }

  requirePredictor(id) {
    const pid = assertPredictorId(id);
    const p = this.predictors.get(pid);
    if (!p) fail("unknown_predictor");
    return p;
  }

  publicPredictor(p) {
    const accuracy = p.picks ? Math.round((1000 * p.correct) / p.picks) / 10 : 0;
    let best = null;
    for (const [agentId, bag] of Object.entries(p.byAgent || {})) {
      if (bag.picks < 3) continue;
      const acc = bag.correct / bag.picks;
      if (!best || acc > best.acc || (acc === best.acc && bag.picks > best.picks)) {
        best = { agentId, picks: bag.picks, correct: bag.correct, acc };
      }
    }
    return {
      id: p.id,
      credits: p.credits,
      picks: p.picks,
      correct: p.correct,
      accuracy,
      streak: p.streak,
      bestStreak: p.bestStreak,
      pnl: p.pnl,
      theories: p.theories || {},
      bestRead: best ? { agentId: best.agentId, picks: best.picks, accuracy: Math.round(best.acc * 1000) / 10 } : null,
      unit: "test-credits",
      cashValue: 0,
    };
  }

  setTheory(id, agentId, tags) {
    const p = this.requirePredictor(id);
    const clean = [...new Set((tags || []).filter((t) => THEORY_TAGS.includes(t)))].slice(0, 4);
    p.theories[String(agentId)] = clean;
    return this.publicPredictor(p);
  }

  createMarket({ matchId, agents, prices }) {
    if (!matchId || this.markets.has(matchId)) fail("market_exists");
    if (!Array.isArray(agents) || agents.length < 2) fail("need_agents");
    const price = {};
    for (const a of agents) {
      const n = Number(prices?.[a.id]);
      if (!(n > 0 && n < 1)) fail("bad_price");
      price[a.id] = round4(n);
    }
    const sum = Object.values(price).reduce((s, n) => s + n, 0);
    if (Math.abs(sum - 1) > 0.021) fail("prices_must_sum_to_1");
    const market = {
      matchId: String(matchId),
      status: "open",
      agents: agents.map((a) => ({ id: a.id, name: a.name })),
      price,
      positions: [],
      winnerId: null,
      resultHash: null,
      createdAt: Date.now(),
      lockedAt: null,
      settledAt: null,
      cashValue: 0,
      custody: false,
    };
    this.markets.set(market.matchId, market);
    return this.publicMarket(market);
  }

  requireMarket(matchId) {
    const m = this.markets.get(String(matchId || ""));
    if (!m) fail("no_market");
    return m;
  }

  _hitRate(id) {
    const now = Date.now();
    const arr = (this.buysAt.get(id) || []).filter((t) => now - t < 60_000);
    if (arr.length >= 12) fail("slow_down");
    arr.push(now);
    this.buysAt.set(id, arr);
  }

  buy({ matchId, predictorId, agentId, side = "yes", stake, expectedPrice = null }) {
    const m = this.requireMarket(matchId);
    if (m.status === "locked" || m.status === "settled") fail("market_locked");
    if (m.status !== "open") fail("market_locked");
    const pred = this.requirePredictor(predictorId);
    this._hitRate(pred.id);
    const which = String(side || "yes");
    if (which !== "yes" && which !== "no") fail("bad_side");
    if (!m.agents.some((a) => a.id === agentId)) fail("unknown_agent");
    const n = Number(stake);
    if (!Number.isInteger(n) || n < MIN_STAKE || n > MAX_STAKE) fail("stake_out_of_range");
    if (m.positions.some((p) => p.predictorId === pred.id)) fail("already_picked");
    const yes = m.price[agentId];
    const px = which === "yes" ? yes : round4(1 - yes);
    if (!(px > 0)) fail("bad_price");
    if (expectedPrice != null && Math.abs(Number(expectedPrice) - px) > 0.03) fail("price_moved");
    if (pred.credits + 1e-9 < n) fail("insufficient_credits");
    const contracts = round4(n / px);
    pred.credits = round4(pred.credits - n);
    const pos = {
      predictorId: pred.id,
      agentId,
      side: which,
      stake: n,
      price: px,
      contracts,
      at: Date.now(),
    };
    m.positions.push(pos);
    return { ok: true, position: this.markOne(m, pos), credits: pred.credits, market: this.publicMarket(m) };
  }

  lock(matchId) {
    const m = this.requireMarket(matchId);
    if (m.status === "settled") fail("already_settled");
    if (m.status === "open") {
      m.status = "locked";
      m.lockedAt = Date.now();
    }
    return this.publicMarket(m);
  }

  mark(matchId, prices) {
    const m = this.requireMarket(matchId);
    if (m.status === "settled") return this.publicMarket(m);
    const price = {};
    for (const a of m.agents) {
      const n = Number(prices?.[a.id]);
      if (!(n >= 0 && n <= 1)) fail("bad_price");
      price[a.id] = round4(n);
    }
    const sum = Object.values(price).reduce((s, n) => s + n, 0);
    if (Math.abs(sum - 1) > 0.021) fail("prices_must_sum_to_1");
    m.price = price;
    return this.publicMarket(m);
  }

  markOne(m, pos) {
    const yes = m.price[pos.agentId] ?? 0;
    const px = pos.side === "yes" ? yes : round4(1 - yes);
    const value = round4(pos.contracts * px);
    return {
      ...pos,
      markPrice: px,
      value,
      unrealized: round4(value - pos.stake),
    };
  }

  positionFor(matchId, predictorId) {
    const m = this.markets.get(String(matchId || ""));
    if (!m) return null;
    let pid;
    try { pid = assertPredictorId(predictorId); } catch { return null; }
    const pos = m.positions.find((p) => p.predictorId === pid);
    if (!pos) return null;
    if (m.status === "settled") {
      return { ...pos, markPrice: pos.won ? 1 : 0, value: pos.payout, unrealized: pos.pnl, settled: true };
    }
    return this.markOne(m, pos);
  }

  settle(matchId, { winnerId, resultHash } = {}) {
    const m = this.requireMarket(matchId);
    if (!resultHash || String(resultHash).length < 32) fail("bad_result");
    if (!m.agents.some((a) => a.id === winnerId)) fail("winner_not_seated");
    if (m.status === "settled") {
      if (m.resultHash !== resultHash || m.winnerId !== winnerId) fail("result_conflict");
      return this.publicMarket(m);
    }
    if (m.status !== "locked") fail("not_locked");
    m.status = "settled";
    m.winnerId = winnerId;
    m.resultHash = resultHash;
    m.settledAt = Date.now();
    for (const a of m.agents) m.price[a.id] = a.id === winnerId ? 1 : 0;
    for (const pos of m.positions) {
      const won = pos.side === "yes" ? pos.agentId === winnerId : pos.agentId !== winnerId;
      const payout = won ? pos.contracts : 0;
      pos.payout = round4(payout);
      pos.pnl = round4(pos.payout - pos.stake);
      pos.won = won;
      const pred = this.predictors.get(pos.predictorId);
      if (!pred) continue;
      pred.credits = round4(pred.credits + pos.payout);
      pred.picks++;
      pred.pnl = round4(pred.pnl + pos.pnl);
      if (won) {
        pred.correct++;
        pred.streak++;
        pred.bestStreak = Math.max(pred.bestStreak, pred.streak);
      } else pred.streak = 0;
      pred.byAgent ||= {};
      const bag = pred.byAgent[pos.agentId] ||= { picks: 0, correct: 0 };
      bag.picks++;
      if (won) bag.correct++;
    }
    return this.publicMarket(m);
  }

  publicMarket(m, predictorId) {
    const you = predictorId ? this.positionFor(m.matchId, predictorId) : undefined;
    return {
      matchId: m.matchId,
      status: m.status,
      agents: m.agents,
      price: m.price,
      positionCount: m.positions.length,
      winnerId: m.winnerId,
      resultHash: m.resultHash,
      cashValue: 0,
      custody: false,
      you,
    };
  }

  leaderboard() {
    return [...this.predictors.values()]
      .filter((p) => p.picks > 0)
      .map((p) => this.publicPredictor(p))
      .sort((a, b) => b.pnl - a.pnl || b.accuracy - a.accuracy)
      .slice(0, 20);
  }
}

function pricesFromRecords(ids, recordOf) {
  const weights = ids.map((id) => {
    const r = recordOf(id) || { won: 0, lost: 0 };
    return (r.won + 2) / ((r.won || 0) + (r.lost || 0) + 4);
  });
  return normalize(ids, weights);
}

function pricesFromDice(ids, diceOf, prior) {
  const dice = ids.map((id) => Math.max(0, Number(diceOf(id)) || 0));
  const tot = dice.reduce((s, n) => s + n, 0) || 1;
  const weights = ids.map((id, i) => (0.4 * (prior[id] ?? 0.5)) + (0.6 * (dice[i] / tot)));
  return normalize(ids, weights);
}

function normalize(ids, weights) {
  const clamped = weights.map((w) => Math.min(0.92, Math.max(0.08, w)));
  const sum = clamped.reduce((s, n) => s + n, 0) || 1;
  const price = {};
  let acc = 0;
  ids.forEach((id, i) => {
    if (i === ids.length - 1) price[id] = round4(1 - acc);
    else {
      price[id] = round4(clamped[i] / sum);
      acc = round4(acc + price[id]);
    }
  });
  return price;
}

const ERROR_TEXT = {
  bad_predictor: "That profile id is not valid.",
  unknown_predictor: "Open the arena once so we can hand you test credits.",
  market_exists: "That match already has a book.",
  need_agents: "A match needs two agents.",
  bad_price: "Price is not usable.",
  prices_must_sum_to_1: "Prices must sum to 1.",
  no_market: "No book for that match.",
  market_locked: "Picks are closed. Watch this one.",
  slow_down: "Slow down a second.",
  bad_side: "Pick yes or no.",
  unknown_agent: "That agent is not in this match.",
  stake_out_of_range: "Use between 10 and 250 test credits.",
  already_picked: "You already picked this match.",
  price_moved: "The price moved. Look again.",
  insufficient_credits: "Not enough test credits.",
  already_settled: "This match is already settled.",
  bad_result: "Missing the match result hash.",
  winner_not_seated: "Winner is not in this match.",
  result_conflict: "That result does not match the settled match.",
  not_locked: "Lock the book before settlement.",
};

module.exports = {
  SimMarket, pricesFromRecords, pricesFromDice, normalize,
  STARTING_CREDITS, DEFAULT_STAKE, MIN_STAKE, MAX_STAKE, THEORY_TAGS, ERROR_TEXT, round4,
};
