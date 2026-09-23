// simmarket.js — Arena Credit book for the spectator show.
//
// One MATCH_WINNER contract per match, priced by LMSR (src/lmsr.js) and
// ledgered in Arena Credits (src/credits.js). Credits have no cash value.
// This module never touches USDC, wallets, or custody. The dice engine does
// not read it. TEST_MARKETS=0 skips market creation in the show loop.

const { CreditLedger } = require("./credits");
const { MarketService, TEST_BADGE } = require("./marketservice");
const { round4 } = require("./lmsr");

const STARTING_CREDITS = 1000;
const DEFAULT_STAKE = 50;
const MIN_STAKE = 10;
const MAX_STAKE = 250;
const THEORY_TAGS = ["Aggressive", "Conservative", "Bluffer", "Risk-taker", "Pressure player", "Unpredictable"];
const CAREER_CAP = 100;
const BUY_WINDOW_MS = 60_000;
const BUY_WINDOW_MAX = 12;

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
  constructor(opts = {}) {
    this.onChange = opts.onChange || (() => {});
    this.careerCap = CAREER_CAP;
    this.ledger = new CreditLedger();
    this.service = new MarketService(this, {
      b: opts.b,
      maxTradeCost: opts.maxTradeCost == null ? MAX_STAKE : opts.maxTradeCost,
      maxSharesPerTrade: opts.maxSharesPerTrade,
      maxMarketExposure: opts.maxMarketExposure,
      maxDailyVolume: opts.maxDailyVolume,
      quoteTtlMs: opts.quoteTtlMs,
      minStake: opts.minStake == null ? MIN_STAKE : opts.minStake,
      maxStake: opts.maxStake == null ? MAX_STAKE : opts.maxStake,
    });
    this.predictors = new Map();
    this.buysAt = new Map();
  }

  get markets() {
    return this.service.markets;
  }

  touch() {
    try { this.onChange(); } catch { /* store must not break a trade */ }
  }

  exportState() {
    const now = Date.now();
    const buysAt = {};
    for (const [id, arr] of this.buysAt) {
      const fresh = (arr || []).filter((t) => now - t < BUY_WINDOW_MS);
      if (fresh.length) buysAt[id] = fresh;
    }
    const book = this.service.exportFragment();
    return {
      predictors: [...this.predictors.values()],
      markets: book.markets,
      buysAt,
      ledger: this.ledger.exportState(),
      seenEvents: book.seenEvents,
      requests: book.requests,
      tradeSeq: book.tradeSeq,
    };
  }

  importState(data) {
    this.ledger.importState(data?.ledger || {});
    this.predictors = new Map();
    for (const raw of data?.predictors || []) {
      if (!raw || !raw.id) continue;
      const p = {
        credits: 0,
        granted: 0,
        picks: 0,
        correct: 0,
        streak: 0,
        bestStreak: 0,
        pnl: 0,
        settled: [],
        theories: {},
        ...raw,
      };
      const known = this.ledger.entries.some((e) => e.userId === p.id);
      if (!known && round4(p.credits) > 0) {
        this.ledger.post({
          userId: p.id,
          amount: round4(p.credits),
          type: "OPENING_BALANCE",
          referenceType: "account",
          referenceId: p.id,
          idempotencyKey: `opening:${p.id}`,
        });
      }
      p.credits = this.ledger.balance(p.id);
      this.predictors.set(p.id, p);
    }
    this.service.importFragment({
      markets: data?.markets || [],
      seenEvents: data?.seenEvents || [],
      requests: data?.requests || [],
      tradeSeq: data?.tradeSeq || 0,
    });
    this.buysAt = new Map();
    const now = Date.now();
    const raw = data?.buysAt && typeof data.buysAt === "object" ? data.buysAt : {};
    for (const [id, arr] of Object.entries(raw)) {
      if (!Array.isArray(arr)) continue;
      const fresh = arr.map(Number).filter((t) => Number.isFinite(t) && now - t < BUY_WINDOW_MS);
      if (fresh.length) this.buysAt.set(id, fresh);
    }
  }

  openPredictor(id) {
    const pid = assertPredictorId(id);
    if (!this.predictors.has(pid)) {
      const pred = {
        id: pid,
        credits: 0,
        granted: STARTING_CREDITS,
        picks: 0,
        correct: 0,
        streak: 0,
        bestStreak: 0,
        pnl: 0,
        settled: [],
        theories: {},
        createdAt: Date.now(),
      };
      this.predictors.set(pid, pred);
      this.ledger.post({
        userId: pid,
        amount: STARTING_CREDITS,
        type: "INITIAL_GRANT",
        referenceType: "account",
        referenceId: pid,
        idempotencyKey: `grant:${pid}`,
      });
      pred.credits = this.ledger.balance(pid);
      this.touch();
    }
    return this.publicPredictor(this.predictors.get(pid));
  }

  requirePredictor(id) {
    const pid = assertPredictorId(id);
    const p = this.predictors.get(pid);
    if (!p) fail("unknown_predictor");
    return p;
  }

  // A test or migration may write predictor.credits directly. The next trade
  // records the delta as TEST_ADMIN_ADJUSTMENT so the ledger still matches.
  reconcile(pred) {
    const book = this.ledger.balance(pred.id);
    const stated = round4(pred.credits);
    if (Math.abs(stated - book) <= 0.0001) {
      pred.credits = book;
      return;
    }
    this.ledger.post({
      userId: pred.id,
      amount: round4(stated - book),
      type: "TEST_ADMIN_ADJUSTMENT",
      referenceType: "account",
      referenceId: pred.id,
      idempotencyKey: `adjust:${pred.id}:${this.ledger.seq}:${stated}`,
    });
    pred.credits = this.ledger.balance(pred.id);
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
      testPnl: p.pnl,
      pnlLabel: "Test P&L",
      series: (p.settled || []).map((s) => ({
        matchId: s.matchId,
        pnl: s.pnl,
        cum: s.cum,
        won: !!s.won,
      })),
      theories: p.theories || {},
      bestRead: best ? { agentId: best.agentId, picks: best.picks, accuracy: Math.round(best.acc * 1000) / 10 } : null,
      unit: "test-credits",
      currency: "Arena Credits",
      cashValue: 0,
    };
  }

  setTheory(id, agentId, tags) {
    const p = this.requirePredictor(id);
    const clean = [...new Set((tags || []).filter((t) => THEORY_TAGS.includes(t)))].slice(0, 4);
    p.theories[String(agentId)] = clean;
    this.touch();
    return this.publicPredictor(p);
  }

  createMarket(input) {
    return this.service.createMarket(input);
  }

  requireMarket(matchId) {
    return this.service.requireMarket(matchId);
  }

  onGameEvent(ev) {
    const result = this.service.onGameEvent(ev);
    this.touch();
    return result;
  }

  _hitRate(id) {
    const now = Date.now();
    const arr = (this.buysAt.get(id) || []).filter((t) => now - t < BUY_WINDOW_MS);
    if (arr.length >= BUY_WINDOW_MAX) fail("slow_down");
    arr.push(now);
    this.buysAt.set(id, arr);
  }

  buy(req) {
    const pred = this.requirePredictor(req.predictorId);
    this.reconcile(pred);
    const dup = this.service.peek(pred.id, req.clientRequestId);
    if (dup) return dup;
    const m = this.service.requireMarket(req.matchId);
    if (m.status !== "open") fail("market_locked");
    this._hitRate(pred.id);
    const result = this.service.buy({ ...req, predictorId: pred.id });
    this.touch();
    return result;
  }

  buyProp(req) {
    const pred = this.requirePredictor(req.predictorId);
    this.reconcile(pred);
    const dup = this.service.peekProp(pred.id, req.propId, req.clientRequestId);
    if (dup) return dup;
    const m = this.service.requireMarket(req.matchId);
    if (m.status !== "open") fail("market_locked");
    this._hitRate(pred.id);
    const result = this.service.buyProp({ ...req, predictorId: pred.id });
    this.touch();
    return result;
  }

  settleProps(matchId, metrics) {
    const result = this.service.settleProps(matchId, metrics || {});
    this.touch();
    return result;
  }

  sell(req) {
    const pred = this.requirePredictor(req.predictorId);
    this.reconcile(pred);
    const dup = this.service.peek(pred.id, req.clientRequestId);
    if (dup) return dup;
    const m = this.service.requireMarket(req.matchId);
    if (m.status !== "open") fail("market_locked");
    this._hitRate(pred.id);
    const result = this.service.sell({ ...req, predictorId: pred.id });
    this.touch();
    return result;
  }

  quote(req) {
    return this.service.quote(req);
  }

  executeQuote(req) {
    const pred = this.requirePredictor(req.predictorId);
    this.reconcile(pred);
    const dup = this.service.peek(pred.id, req.clientRequestId);
    if (dup) return dup;
    const m = this.service.requireMarket(req.matchId);
    if (m.status !== "open") fail("market_locked");
    this._hitRate(pred.id);
    const result = this.service.executeQuote({ ...req, predictorId: pred.id });
    this.touch();
    return result;
  }

  lock(matchId, ev) {
    return this.service.lock(matchId, ev || {});
  }

  settle(matchId, result) {
    return this.service.settle(matchId, result || {});
  }

  voidMarket(matchId, ev) {
    return this.service.voidMarket(matchId, ev || {});
  }

  applyInfluence(matchId) {
    return this.service.applyInfluence(matchId);
  }

  inspect(matchId) {
    return this.service.inspect(matchId);
  }

  // Dice can move the table. They do not reprice a test market.
  mark(matchId) {
    return this.service.mark(matchId);
  }

  positionFor(matchId, predictorId) {
    return this.service.positionFor(matchId, predictorId);
  }

  publicMarket(m, predictorId) {
    if (!m) return null;
    return this.service.publicMarket(m, predictorId);
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
  unknown_predictor: "Open the arena once so we can hand you Arena Credits.",
  market_exists: "That match already has a test market.",
  need_agents: "A match needs two agents.",
  bad_price: "Price is not usable.",
  prices_must_sum_to_1: "Prices must sum to 1.",
  no_market: "No test market for that match.",
  market_locked: "This test market is locked. Watch the match.",
  slow_down: "Slow down a second.",
  bad_side: "Pick yes or no.",
  unknown_agent: "That agent is not in this match.",
  stake_out_of_range: "Use between 10 and 250 Arena Credits.",
  price_moved: "The price moved. Look again.",
  insufficient_credits: "Not enough Arena Credits.",
  already_settled: "This test market is already settled.",
  bad_result: "Missing the match result hash.",
  winner_not_seated: "Winner is not in this match.",
  result_conflict: "That result does not match the settled market.",
  not_locked: "Lock the test market before settlement.",
  not_enough_shares: "You cannot sell more shares than you hold.",
  size_limit: "That trade is over the test position limit.",
  exposure_limit: "That would put too many Arena Credits on one test market.",
  daily_limit: "Daily Arena Credit test volume is used up.",
  quote_expired: "That quote expired. Ask for a new one.",
  quote_missing: "That quote was not found.",
  bad_request_id: "That trade request id is not valid.",
  bad_size: "Share size is not usable.",
  influence_after_lock: "The match has started. Influence is closed.",
  voided: "This test market was voided.",
  ignored_event: "That event does not settle a test market.",
  no_prop: "That prop is not on this match.",
  already_picked_prop: "You already have a test position on that prop.",
  bad_liquidity: "Liquidity is out of range.",
  unstable_cost: "The test price could not be priced.",
  unstable_price: "The test price could not be priced.",
  forced_failure: "The test ledger rolled back.",
};

module.exports = {
  SimMarket, pricesFromRecords, pricesFromDice, normalize,
  STARTING_CREDITS, DEFAULT_STAKE, MIN_STAKE, MAX_STAKE, THEORY_TAGS, CAREER_CAP,
  BUY_WINDOW_MS, BUY_WINDOW_MAX, ERROR_TEXT, round4, TEST_BADGE,
};
