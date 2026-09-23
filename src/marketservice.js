// marketservice.js — Test-mode event contracts.
//
// Observes authoritative match events. Does not roll dice, choose bids, or
// change a winner. Arena Credits move only through CreditLedger.
//
// Spec event → what this show emits today:
//   MATCH_CREATED   Show.makeCard. The book opens with the card. No legacy name.
//   MATCH_STARTED   LOCK from Show.playOpen, before the first die.
//   MATCH_RESOLVED  SETTLED after the engine names a winner.
//   MATCH_ABORTED   Play or loop failure before settlement. No legacy name.
//   ROUND_STARTED   Not emitted. Round markets are a later slice.
//   ROUND_RESOLVED  REVEAL is the engine reveal, not a round-market settlement.
//
// V1 trades a binary MATCH_WINNER only, and only while the match is open.
// Lock is the start signal. Settlement pays 1 Arena Credit per winning share
// and 0 for the losing side. A void refunds remaining cost basis once.

const crypto = require("crypto");
const {
  buyCost, sellValue, prices, seedBinary, sharesForBudget, centsPair, round4, clampLiquidity,
} = require("./lmsr");

const TEST_BADGE = "TEST MARKET — Arena Credits have no monetary value.";

const EVENT_MAP = {
  MATCH_CREATED: "Show.makeCard",
  MATCH_STARTED: "LOCK",
  MATCH_RESOLVED: "SETTLED",
  MATCH_ABORTED: "play or loop failure before settlement",
  ROUND_STARTED: "not emitted",
  ROUND_RESOLVED: "REVEAL is not a round settlement",
};

function fail(code) {
  const err = new Error(code);
  err.code = code;
  throw err;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function replaceData(target, snap) {
  const fresh = clone(snap);
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, fresh);
}

function hashAgent(agent) {
  return crypto.createHash("sha256").update(JSON.stringify({
    id: agent.id,
    version: agent.version || "cast-v1",
    aggression: agent.aggression ?? null,
    chaos: agent.chaos ?? null,
    archetype: agent.archetype ?? null,
  })).digest("hex");
}

function assertRequestId(id) {
  if (id == null || id === "") return null;
  const s = String(id);
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(s)) fail("bad_request_id");
  return s;
}

class MarketService {
  constructor(book, opts = {}) {
    this.book = book;
    this.ledger = book.ledger;
    this.markets = new Map();
    this.seenEvents = new Set();
    this.requests = new Map();
    this.quotes = new Map();
    this.seq = 0;
    this.b = clampLiquidity(opts.b == null ? process.env.LMSR_B : opts.b);
    this.maxTradeCost = opts.maxTradeCost == null ? 250 : opts.maxTradeCost;
    this.maxSharesPerTrade = opts.maxSharesPerTrade == null ? 2000 : opts.maxSharesPerTrade;
    this.maxMarketExposure = opts.maxMarketExposure == null ? 500 : opts.maxMarketExposure;
    this.maxDailyVolume = opts.maxDailyVolume == null ? 10000 : opts.maxDailyVolume;
    this.quoteTtlMs = opts.quoteTtlMs == null ? 15000 : opts.quoteTtlMs;
    this.minStake = opts.minStake == null ? 10 : opts.minStake;
    this.maxStake = opts.maxStake == null ? 250 : opts.maxStake;
  }

  requireMarket(matchId) {
    const m = this.markets.get(String(matchId || ""));
    if (!m) fail("no_market");
    return m;
  }

  qOf(m) {
    return [m.outcomes.YES.q, m.outcomes.NO.q];
  }

  setQ(m, q) {
    m.outcomes.YES.q = q[0];
    m.outcomes.NO.q = q[1];
    this.syncPrices(m);
  }

  syncPrices(m) {
    const [yes, no] = prices(this.qOf(m), m.b);
    m.yesPrice = yes;
    m.noPrice = no;
    const cents = centsPair(yes);
    m.yesCents = cents.yes;
    m.noCents = cents.no;
    const yesPx = round4(yes);
    m.price = {};
    const others = m.agents.filter((a) => a.id !== m.targetAgentId);
    m.price[m.targetAgentId] = yesPx;
    if (others.length === 1) m.price[others[0].id] = round4(1 - yesPx);
    else for (const a of others) m.price[a.id] = round4(no);
  }

  otherId(m) {
    const other = m.agents.find((a) => a.id !== m.targetAgentId);
    return other ? other.id : m.targetAgentId;
  }

  outcomeFor(m, agentId, side) {
    const which = String(side || "yes");
    if (which !== "yes" && which !== "no") fail("bad_side");
    if (!m.agents.some((a) => a.id === agentId)) fail("unknown_agent");
    const onTarget = agentId === m.targetAgentId;
    const wantYes = which === "yes";
    return wantYes === onTarget ? "YES" : "NO";
  }

  holding(m, userId, outcome, create) {
    const key = `${userId}|${outcome}`;
    if (!m.holdings[key] && create) {
      m.holdings[key] = {
        userId,
        outcome,
        shares: 0,
        netCostBasis: 0,
        realizedPnl: 0,
        trail: [],
        updatedAt: Date.now(),
      };
    }
    return m.holdings[key] || null;
  }

  exposure(m, userId) {
    let n = 0;
    for (const h of Object.values(m.holdings)) {
      if (h.userId === userId) n = round4(n + Math.max(0, h.netCostBasis));
    }
    return n;
  }

  dailyVolume(userId) {
    const day = new Date().toISOString().slice(0, 10);
    let sum = 0;
    for (const e of this.ledger.entries) {
      if (e.userId !== userId) continue;
      if (e.type !== "TRADE_BUY" && e.type !== "TRADE_SELL") continue;
      if (new Date(e.createdAt).toISOString().slice(0, 10) !== day) continue;
      sum = round4(sum + Math.abs(e.amount));
    }
    return sum;
  }

  fingerprint(m) {
    return `${m.status}|${m.outcomes.YES.q}|${m.outcomes.NO.q}`;
  }

  createMarket({ matchId, agents, prices, initialProbabilitySource } = {}) {
    const id = String(matchId || "");
    if (!id || this.markets.has(id)) fail(id ? "market_exists" : "need_agents");
    if (!Array.isArray(agents) || agents.length < 2) fail("need_agents");
    let source = initialProbabilitySource || null;
    let pYes = 0.5;
    if (prices) {
      for (const a of agents) {
        const n = Number(prices[a.id]);
        if (!(n > 0 && n < 1)) fail("bad_price");
      }
      const sum = agents.reduce((s, a) => s + Number(prices[a.id]), 0);
      if (Math.abs(sum - 1) > 0.021) fail("prices_must_sum_to_1");
      pYes = source === "equal_prior" ? 0.5 : Number(prices[agents[0].id]);
      if (!source) source = Math.abs(pYes - 0.5) < 1e-9 ? "equal_prior" : "admin_test";
    } else {
      source = source || "equal_prior";
    }
    const target = agents[0];
    const q = seedBinary(pYes, this.b);
    const now = Date.now();
    const market = {
      id,
      matchId: id,
      marketType: "MATCH_WINNER",
      title: `Will ${target.name} win Match ${id}?`,
      description: "YES pays 1 Arena Credit per share if this agent wins. NO pays 1 if they do not. Arena Credits have no monetary value.",
      question: `Will ${target.name} win?`,
      status: "open",
      agents: agents.map((a) => ({ id: a.id, name: a.name })),
      targetAgentId: target.id,
      targetName: target.name,
      outcomes: {
        YES: { id: "YES", code: "YES", label: "YES", q: q[0] },
        NO: { id: "NO", code: "NO", label: "NO", q: q[1] },
      },
      b: this.b,
      initialProbability: pYes,
      initialProbabilitySource: source,
      holdings: {},
      trades: [],
      predictions: {},
      settlements: {},
      freeze: null,
      winnerId: null,
      winningOutcome: null,
      resultHash: null,
      evidence: null,
      resolution: null,
      acVolume: 0,
      createdAt: now,
      openAt: now,
      lockedAt: null,
      settledAt: null,
      voidedAt: null,
      voidReason: null,
      updatedAt: now,
      cashValue: 0,
      custody: false,
      realMoney: false,
      badge: TEST_BADGE,
    };
    this.syncPrices(market);
    market.initialProbability = market.yesPrice;
    this.markets.set(id, market);
    return this.publicMarket(market);
  }

  onGameEvent(ev = {}) {
    const eventId = String(ev.eventId || `${ev.type}:${ev.matchId || ""}:${ev.resultHash || ""}`);
    if (this.seenEvents.has(eventId)) {
      return { ok: true, duplicate: true, eventId, type: ev.type };
    }
    let result;
    if (ev.type === "MATCH_CREATED") {
      if (this.markets.has(String(ev.matchId || ""))) result = this.publicMarket(this.requireMarket(ev.matchId));
      else result = this.createMarket(ev);
    } else if (ev.type === "MATCH_STARTED") result = this.lock(ev.matchId, ev);
    else if (ev.type === "MATCH_RESOLVED") result = this.settle(ev.matchId, ev);
    else if (ev.type === "MATCH_ABORTED") result = this.voidMarket(ev.matchId, ev);
    else fail("ignored_event");
    this.seenEvents.add(eventId);
    return { ok: true, duplicate: false, eventId, type: ev.type, market: result };
  }

  lock(matchId, ev = {}) {
    const m = this.requireMarket(matchId);
    if (m.status === "settled") fail("already_settled");
    if (m.status === "voided") fail("voided");
    if (m.status === "locked" || m.status === "awaiting_result") return this.publicMarket(m);
    if (m.status !== "open") fail("market_locked");
    m.status = "locked";
    m.lockedAt = ev.startedAt || Date.now();
    const users = new Set(Object.values(m.holdings).map((h) => h.userId));
    m.predictions = {};
    for (const userId of users) m.predictions[userId] = this.exposureSnap(m, userId);
    const agents = Array.isArray(ev.agents) && ev.agents.length
      ? ev.agents
      : m.agents.map((a) => ({ id: a.id, version: "cast-v1" }));
    m.freeze = {
      marketId: m.matchId,
      lockTimestamp: m.lockedAt,
      matchId: m.matchId,
      agentIds: m.agents.map((a) => a.id),
      agents: agents.map((a) => ({
        id: a.id,
        version: a.version || "cast-v1",
        configurationHash: hashAgent(a),
      })),
      prices: { ...m.price },
      yesPrice: m.yesPrice,
      noPrice: m.noPrice,
      q: { YES: m.outcomes.YES.q, NO: m.outcomes.NO.q },
    };
    m.updatedAt = m.lockedAt;
    return this.publicMarket(m);
  }

  exposureSnap(m, userId) {
    const yes = this.holding(m, userId, "YES")?.shares || 0;
    const no = this.holding(m, userId, "NO")?.shares || 0;
    let prediction = "NO_PREDICTION";
    if (yes > no + 1e-9) prediction = "YES";
    else if (no > yes + 1e-9) prediction = "NO";
    const backedAgentId = prediction === "YES"
      ? m.targetAgentId
      : prediction === "NO"
        ? this.otherId(m)
        : null;
    return { prediction, yesShares: yes, noShares: no, backedAgentId };
  }

  applyInfluence(matchId) {
    const m = this.requireMarket(matchId);
    if (m.status !== "open") fail("influence_after_lock");
    return { ok: true, applied: false, reason: "no_paid_influence", cashValue: 0 };
  }

  quote({ matchId, predictorId, outcomeId, agentId, side, shares }) {
    const m = this.requireMarket(matchId);
    if (m.status !== "open") fail("market_locked");
    const tradeSide = String(side || "BUY").toUpperCase() === "SELL" ? "SELL" : "BUY";
    const outcome = outcomeId === "YES" || outcomeId === "NO"
      ? outcomeId
      : this.outcomeFor(m, agentId, String(side || "yes").toLowerCase() === "no" ? "no" : "yes");
    const n = Number(shares);
    if (!Number.isFinite(n) || n <= 0) fail("bad_size");
    if (n > this.maxSharesPerTrade) fail("size_limit");
    const idx = outcome === "YES" ? 0 : 1;
    const q = this.qOf(m);
    const before = prices(q, m.b)[idx];
    const cash = tradeSide === "SELL" ? sellValue(q, m.b, idx, n) : buyCost(q, m.b, idx, n);
    const next = q.slice();
    next[idx] += tradeSide === "SELL" ? -n : n;
    const after = prices(next, m.b)[idx];
    const quote = {
      quoteId: `quote_${++this.seq}`,
      marketId: m.matchId,
      userId: predictorId ? String(predictorId) : null,
      outcomeId: outcome,
      side: tradeSide,
      shares: n,
      estimatedCost: tradeSide === "BUY" ? round4(cash) : null,
      estimatedCredit: tradeSide === "SELL" ? round4(cash) : null,
      averagePrice: round4(cash / n),
      priceBefore: round4(before),
      priceAfter: round4(after),
      expiresAt: Date.now() + this.quoteTtlMs,
      fingerprint: this.fingerprint(m),
      cashValue: 0,
      realMoney: false,
    };
    this.quotes.set(quote.quoteId, quote);
    return quote;
  }

  executeQuote({ matchId, predictorId, quoteId, clientRequestId }) {
    const m = this.requireMarket(matchId);
    const quote = this.quotes.get(String(quoteId || ""));
    if (!quote || quote.marketId !== m.matchId) fail("quote_missing");
    if (Date.now() >= quote.expiresAt) fail("quote_expired");
    if (quote.fingerprint !== this.fingerprint(m)) fail("price_moved");
    if (quote.userId && predictorId && quote.userId !== String(predictorId)) fail("bad_predictor");
    const order = {
      matchId: m.matchId,
      predictorId,
      outcomeId: quote.outcomeId,
      shares: quote.shares,
      clientRequestId,
    };
    if (quote.side === "SELL") return this.sell(order);
    return this.buy(order);
  }

  peek(userId, clientRequestId) {
    const id = assertRequestId(clientRequestId);
    if (!id) return null;
    const hit = this.requests.get(`${userId}:${id}`);
    if (!hit) return null;
    const m = this.markets.get(hit.marketId);
    const trade = m ? (m.trades || []).find((t) => t.id === hit.tradeId) : null;
    return {
      ok: true,
      duplicate: true,
      trade: trade || { id: hit.tradeId },
      position: hit.position,
      credits: hit.credits,
      market: m ? this.publicMarket(m, userId) : null,
      cashValue: 0,
    };
  }

  buy(req) {
    const m = this.requireMarket(req.matchId);
    if (m.status !== "open") fail("market_locked");
    const userId = String(req.predictorId || "");
    const requestId = assertRequestId(req.clientRequestId);
    const dup = this.peek(userId, requestId);
    if (dup) return dup;
    const outcome = req.outcomeId === "YES" || req.outcomeId === "NO"
      ? req.outcomeId
      : this.outcomeFor(m, req.agentId, req.side || "yes");
    const idx = outcome === "YES" ? 0 : 1;
    const spot = prices(this.qOf(m), m.b)[idx];
    if (req.expectedPrice != null && Math.abs(Number(req.expectedPrice) - spot) > 0.03) fail("price_moved");
    let shares;
    let cash;
    if (req.shares != null && req.stake == null) {
      shares = Number(req.shares);
      if (!Number.isFinite(shares) || shares <= 0) fail("bad_size");
      cash = round4(buyCost(this.qOf(m), m.b, idx, shares));
    } else {
      const stake = Number(req.stake);
      if (!Number.isInteger(stake) || stake < this.minStake || stake > this.maxStake) fail("stake_out_of_range");
      shares = sharesForBudget(this.qOf(m), m.b, idx, stake);
      const raw = buyCost(this.qOf(m), m.b, idx, shares);
      cash = Math.abs(raw - stake) <= 1e-3 ? stake : round4(raw);
    }
    if (!(shares > 0) || shares > this.maxSharesPerTrade) fail("size_limit");
    if (cash > this.maxTradeCost + 1e-9) fail("size_limit");
    if (this.exposure(m, userId) + cash > this.maxMarketExposure + 1e-9) fail("exposure_limit");
    if (this.dailyVolume(userId) + cash > this.maxDailyVolume + 1e-9) fail("daily_limit");
    if (this.ledger.balance(userId) + 1e-9 < cash) fail("insufficient_credits");
    return this.execute({
      m, userId, outcome, side: "BUY", shares, cash, clientRequestId: requestId,
    });
  }

  sell(req) {
    const m = this.requireMarket(req.matchId);
    if (m.status !== "open") fail("market_locked");
    const userId = String(req.predictorId || "");
    const requestId = assertRequestId(req.clientRequestId);
    const dup = this.peek(userId, requestId);
    if (dup) return dup;
    const outcome = req.outcomeId === "YES" || req.outcomeId === "NO"
      ? req.outcomeId
      : this.outcomeFor(m, req.agentId, req.side || "yes");
    const held = this.holding(m, userId, outcome);
    const shares = Number(req.shares);
    if (!Number.isFinite(shares) || shares <= 0) fail("bad_size");
    if (!held || held.shares + 1e-8 < shares) fail("not_enough_shares");
    if (shares > this.maxSharesPerTrade) fail("size_limit");
    const idx = outcome === "YES" ? 0 : 1;
    const cash = round4(sellValue(this.qOf(m), m.b, idx, shares));
    if (!(cash > 0)) fail("bad_price");
    if (this.dailyVolume(userId) + cash > this.maxDailyVolume + 1e-9) fail("daily_limit");
    return this.execute({
      m, userId, outcome, side: "SELL", shares, cash, clientRequestId: requestId,
    });
  }

  execute({ m, userId, outcome, side, shares, cash, clientRequestId }) {
    const idx = outcome === "YES" ? 0 : 1;
    const before = prices(this.qOf(m), m.b);
    const nextQ = this.qOf(m).slice();
    nextQ[idx] += side === "BUY" ? shares : -shares;
    const after = prices(nextQ, m.b);
    const trade = {
      id: `trd_${++this.seq}`,
      marketId: m.matchId,
      outcomeId: outcome,
      userId,
      side,
      shares,
      costOrCredit: round4(cash),
      averagePrice: round4(cash / shares),
      priceBefore: round4(before[idx]),
      priceAfter: round4(after[idx]),
      createdAt: Date.now(),
      clientRequestId: clientRequestId || null,
    };
    const marketSnap = clone(m);
    const pred = this.book.predictors.get(userId);
    const predSnap = pred ? clone(pred) : null;
    const ledgerSnap = this.ledger.exportState();
    try {
      this.ledger.post({
        userId,
        amount: side === "BUY" ? -round4(cash) : round4(cash),
        type: side === "BUY" ? "TRADE_BUY" : "TRADE_SELL",
        referenceType: "market_trade",
        referenceId: trade.id,
        idempotencyKey: clientRequestId ? `trade:${userId}:${clientRequestId}` : "",
      });
      this.setQ(m, nextQ);
      const h = this.holding(m, userId, outcome, true);
      if (side === "BUY") {
        h.shares += shares;
        h.netCostBasis = round4(h.netCostBasis + round4(cash));
      } else {
        const basis = h.shares > 0 ? round4(h.netCostBasis * (shares / h.shares)) : 0;
        h.realizedPnl = round4(h.realizedPnl + round4(cash) - basis);
        h.netCostBasis = round4(Math.max(0, h.netCostBasis - basis));
        h.shares -= shares;
        if (h.shares < 1e-8) h.shares = 0;
      }
      h.updatedAt = trade.createdAt;
      const view = this.positionView(m, userId);
      if (view) {
        h.trail = h.trail || [];
        const mark = view.value;
        const last = h.trail[h.trail.length - 1];
        if (last !== mark) h.trail.push(mark);
        if (h.trail.length > 32) h.trail.shift();
        view.trail = h.trail.slice();
      }
      m.trades.push(trade);
      m.acVolume = round4((m.acVolume || 0) + round4(cash));
      m.updatedAt = trade.createdAt;
      if (pred) pred.credits = this.ledger.balance(userId);
      const result = {
        ok: true,
        duplicate: false,
        trade,
        position: this.positionView(m, userId),
        credits: this.ledger.balance(userId),
        market: this.publicMarket(m, userId),
        cashValue: 0,
      };
      if (clientRequestId) {
        this.requests.set(`${userId}:${clientRequestId}`, {
          tradeId: trade.id,
          credits: result.credits,
          position: result.position,
          marketId: m.matchId,
        });
      }
      return result;
    } catch (e) {
      replaceData(m, marketSnap);
      this.ledger.importState(ledgerSnap);
      if (pred && predSnap) replaceData(pred, predSnap);
      throw e;
    }
  }

  positionFor(matchId, predictorId) {
    const m = this.markets.get(String(matchId || ""));
    if (!m) return null;
    const pid = String(predictorId || "");
    if (!/^[a-z0-9]{8,40}$/.test(pid)) return null;
    return this.positionView(m, pid);
  }

  positionView(m, userId) {
    if (m.status === "settled" && m.settlements && m.settlements[userId]) {
      return { ...m.settlements[userId], cashValue: 0, pnlLabel: "Test P&L" };
    }
    const holds = ["YES", "NO"]
      .map((o) => this.holding(m, userId, o))
      .filter((h) => h && (h.shares > 1e-9 || h.netCostBasis > 1e-9 || Math.abs(h.realizedPnl) > 1e-9));
    if (!holds.length) return null;
    const primary = holds.slice().sort((a, b) => b.shares - a.shares)[0];
    const idx = primary.outcome === "YES" ? 0 : 1;
    const liq = primary.shares > 1e-9 ? sellValue(this.qOf(m), m.b, idx, primary.shares) : 0;
    const spot = primary.outcome === "YES" ? m.yesPrice : m.noPrice;
    const agentId = primary.outcome === "YES" ? m.targetAgentId : this.otherId(m);
    return {
      predictorId: userId,
      agentId,
      side: primary.outcome === "YES" ? "yes" : "no",
      outcome: primary.outcome,
      stake: round4(primary.netCostBasis),
      price: primary.shares ? round4(primary.netCostBasis / primary.shares) : 0,
      contracts: round4(primary.shares),
      shares: primary.shares,
      markPrice: round4(spot),
      value: round4(liq),
      unrealized: round4(liq - primary.netCostBasis),
      testPnl: round4(liq - primary.netCostBasis + primary.realizedPnl),
      pnlLabel: "Test P&L",
      trail: (primary.trail || []).slice(),
      settled: false,
      won: false,
      cashValue: 0,
    };
  }

  userPnL(m, userId, winning) {
    let payout = 0;
    let basis = 0;
    let realized = 0;
    let yesShares = 0;
    let noShares = 0;
    for (const outcome of ["YES", "NO"]) {
      const h = this.holding(m, userId, outcome);
      if (!h) continue;
      if (outcome === "YES") yesShares = h.shares;
      else noShares = h.shares;
      if (outcome === winning) payout = round4(payout + h.shares);
      basis = round4(basis + h.netCostBasis);
      realized = round4(realized + h.realizedPnl);
    }
    const pnl = round4(payout - basis + realized);
    return { payout, basis, realized, pnl, yesShares, noShares };
  }

  settle(matchId, result = {}) {
    const m = this.requireMarket(matchId);
    const winnerId = result.winnerId;
    const resultHash = result.resultHash ? String(result.resultHash) : "";
    if (m.status === "voided") fail("voided");
    if (m.status === "settled") {
      if (m.resultHash !== resultHash || m.winnerId !== winnerId) fail("result_conflict");
      return this.publicMarket(m);
    }
    if (m.status !== "locked" && m.status !== "awaiting_result") fail("not_locked");
    if (!resultHash || resultHash.length < 32) fail("bad_result");
    if (!m.agents.some((a) => a.id === winnerId)) fail("winner_not_seated");
    const winning = winnerId === m.targetAgentId ? "YES" : "NO";
    const users = [...new Set(Object.values(m.holdings).map((h) => h.userId))];
    const marketSnap = clone(m);
    const ledgerSnap = this.ledger.exportState();
    const predSnaps = new Map();
    for (const userId of users) {
      const pred = this.book.predictors.get(userId);
      if (pred) predSnaps.set(userId, clone(pred));
    }
    try {
      m.status = "settling";
      const rows = users.map((userId) => {
        const math = this.userPnL(m, userId, winning);
        return {
          userId,
          amount: math.payout,
          allowZero: true,
          type: "MARKET_SETTLEMENT",
          referenceType: "market",
          referenceId: m.matchId,
          idempotencyKey: `settle:${m.matchId}:${userId}`,
        };
      });
      if (rows.length) this.ledger.postAll(rows);
      m.settlements = m.settlements || {};
      for (const userId of users) {
        const math = this.userPnL(m, userId, winning);
        const snap = m.predictions[userId] || this.exposureSnap(m, userId);
        const prediction = snap.prediction || "NO_PREDICTION";
        const called = prediction !== "NO_PREDICTION";
        const won = called && prediction === winning;
        const pred = this.book.predictors.get(userId);
        if (pred) {
          if (called) {
            pred.picks += 1;
            if (won) {
              pred.correct += 1;
              pred.streak += 1;
              pred.bestStreak = Math.max(pred.bestStreak, pred.streak);
            } else pred.streak = 0;
            pred.byAgent = pred.byAgent || {};
            const bag = pred.byAgent[snap.backedAgentId] || { picks: 0, correct: 0 };
            bag.picks += 1;
            if (won) bag.correct += 1;
            pred.byAgent[snap.backedAgentId] = bag;
          }
          pred.pnl = round4(pred.pnl + math.pnl);
          pred.settled = pred.settled || [];
          pred.settled.push({
            matchId: m.matchId,
            agentId: snap.backedAgentId,
            pnl: math.pnl,
            cum: pred.pnl,
            won: called ? won : false,
            prediction,
            at: Date.now(),
          });
          const cap = this.book.careerCap || 100;
          if (pred.settled.length > cap) pred.settled.splice(0, pred.settled.length - cap);
          pred.credits = this.ledger.balance(userId);
        }
        const primaryOutcome = prediction === "NO" ? "NO" : prediction === "YES" ? "YES" : (math.yesShares >= math.noShares ? "YES" : "NO");
        const primaryShares = primaryOutcome === "YES" ? math.yesShares : math.noShares;
        m.settlements[userId] = {
          predictorId: userId,
          agentId: snap.backedAgentId || (primaryOutcome === "YES" ? m.targetAgentId : this.otherId(m)),
          side: primaryOutcome === "NO" ? "no" : "yes",
          outcome: primaryOutcome,
          stake: math.basis,
          price: primaryShares ? round4(math.basis / primaryShares) : 0,
          contracts: round4(primaryShares),
          shares: primaryShares,
          payout: math.payout,
          pnl: math.pnl,
          testPnl: math.pnl,
          pnlLabel: "Test P&L",
          won: called ? won : false,
          prediction,
          settled: true,
          markPrice: primaryOutcome === winning ? 1 : 0,
          value: math.payout,
          unrealized: math.pnl,
          cashValue: 0,
        };
      }
      m.status = "settled";
      m.winnerId = winnerId;
      m.winningOutcome = winning;
      m.resultHash = resultHash;
      m.settledAt = result.endedAt || Date.now();
      m.yesPrice = winning === "YES" ? 1 : 0;
      m.noPrice = winning === "YES" ? 0 : 1;
      const cents = centsPair(m.yesPrice);
      m.yesCents = cents.yes;
      m.noCents = cents.no;
      m.price = {};
      for (const a of m.agents) m.price[a.id] = a.id === winnerId ? 1 : 0;
      const eventId = result.eventId || `MATCH_RESOLVED:${m.matchId}:${resultHash}`;
      m.evidence = {
        matchId: m.matchId,
        marketType: "MATCH_WINNER",
        targetAgentId: m.targetAgentId,
        officialWinnerId: winnerId,
        resolutionEventId: eventId,
        resolvedOutcome: winning,
        resultHash,
      };
      m.resolution = {
        status: "SETTLED",
        winningOutcomeId: winning,
        evidence: m.evidence,
        resolutionTimestamp: m.settledAt,
      };
      m.updatedAt = m.settledAt;
      return this.publicMarket(m);
    } catch (e) {
      replaceData(m, marketSnap);
      this.ledger.importState(ledgerSnap);
      for (const [userId, snap] of predSnaps) {
        const pred = this.book.predictors.get(userId);
        if (pred) replaceData(pred, snap);
      }
      throw e;
    }
  }

  voidMarket(matchId, ev = {}) {
    const m = this.requireMarket(matchId);
    if (m.status === "settled") return this.publicMarket(m);
    if (m.status === "voided") return this.publicMarket(m);
    const users = [...new Set(Object.values(m.holdings).map((h) => h.userId))];
    const marketSnap = clone(m);
    const ledgerSnap = this.ledger.exportState();
    const predSnaps = new Map();
    for (const userId of users) {
      const pred = this.book.predictors.get(userId);
      if (pred) predSnaps.set(userId, clone(pred));
    }
    try {
      const rows = [];
      for (const h of Object.values(m.holdings)) {
        const refund = round4(h.netCostBasis);
        if (refund <= 0) continue;
        rows.push({
          userId: h.userId,
          amount: refund,
          type: "MARKET_VOID_REFUND",
          referenceType: "market",
          referenceId: m.matchId,
          idempotencyKey: `void:${m.matchId}:${h.userId}:${h.outcome}`,
        });
      }
      if (rows.length) this.ledger.postAll(rows);
      for (const userId of users) {
        let realized = 0;
        for (const outcome of ["YES", "NO"]) {
          const h = this.holding(m, userId, outcome);
          if (!h) continue;
          realized = round4(realized + h.realizedPnl);
          h.shares = 0;
          h.netCostBasis = 0;
        }
        const pred = this.book.predictors.get(userId);
        if (pred) {
          if (Math.abs(realized) > 1e-9) {
            pred.pnl = round4(pred.pnl + realized);
            pred.settled = pred.settled || [];
            pred.settled.push({
              matchId: m.matchId,
              agentId: null,
              pnl: realized,
              cum: pred.pnl,
              won: false,
              prediction: "VOID",
              at: Date.now(),
            });
          }
          pred.credits = this.ledger.balance(userId);
        }
      }
      m.status = "voided";
      m.voidedAt = Date.now();
      m.voidReason = ev.reason || "match_aborted";
      m.evidence = {
        matchId: m.matchId,
        marketType: "MATCH_WINNER",
        targetAgentId: m.targetAgentId,
        resolvedOutcome: "VOID",
        reason: m.voidReason,
        resolutionEventId: ev.eventId || `MATCH_ABORTED:${m.matchId}`,
      };
      m.resolution = {
        status: "VOIDED",
        winningOutcomeId: null,
        evidence: m.evidence,
        resolutionTimestamp: m.voidedAt,
      };
      m.updatedAt = m.voidedAt;
      return this.publicMarket(m);
    } catch (e) {
      replaceData(m, marketSnap);
      this.ledger.importState(ledgerSnap);
      for (const [userId, snap] of predSnaps) {
        const pred = this.book.predictors.get(userId);
        if (pred) replaceData(pred, snap);
      }
      throw e;
    }
  }

  mark(matchId) {
    return this.publicMarket(this.requireMarket(matchId));
  }

  inspect(matchId) {
    const m = this.requireMarket(matchId);
    return {
      matchId: m.matchId,
      status: m.status,
      b: m.b,
      q: { YES: m.outcomes.YES.q, NO: m.outcomes.NO.q },
      freeze: m.freeze,
      evidence: m.evidence,
      cashValue: 0,
    };
  }

  publicMarket(m, predictorId) {
    const you = predictorId ? this.positionFor(m.matchId, predictorId) : undefined;
    let gross = 0;
    const traders = new Set();
    for (const t of m.trades || []) {
      gross = round4(gross + Math.abs(t.costOrCredit || 0));
      traders.add(t.userId);
    }
    return {
      matchId: m.matchId,
      id: m.id,
      marketType: m.marketType,
      title: m.title,
      question: m.question,
      description: m.description,
      status: m.status,
      agents: m.agents,
      targetAgentId: m.targetAgentId,
      targetName: m.targetName,
      price: m.price,
      yesPrice: m.yesPrice,
      noPrice: m.noPrice,
      yesCents: m.yesCents,
      noCents: m.noCents,
      outcomes: [
        { id: "YES", code: "YES", label: "YES", price: m.yesPrice, cents: m.yesCents },
        { id: "NO", code: "NO", label: "NO", price: m.noPrice, cents: m.noCents },
      ],
      initialProbability: m.initialProbability,
      initialProbabilitySource: m.initialProbabilitySource,
      positionCount: Object.values(m.holdings).filter((h) => h.shares > 1e-9).length,
      tradeCount: (m.trades || []).length,
      acVolume: gross,
      uniqueTraders: traders.size,
      winnerId: m.winnerId,
      winningOutcome: m.winningOutcome,
      resultHash: m.resultHash,
      evidence: m.evidence,
      cashValue: 0,
      custody: false,
      realMoney: false,
      testMarket: true,
      badge: TEST_BADGE,
      you,
    };
  }

  exportFragment() {
    return {
      markets: [...this.markets.values()],
      seenEvents: [...this.seenEvents],
      requests: [...this.requests.entries()],
      tradeSeq: this.seq,
    };
  }

  importFragment(data = {}) {
    this.seenEvents = new Set(data.seenEvents || []);
    this.requests = new Map(Array.isArray(data.requests) ? data.requests : []);
    this.seq = Number(data.tradeSeq) || 0;
    this.quotes = new Map();
    this.markets = new Map();
    for (const raw of data.markets || []) {
      const m = this.migrate(raw);
      if (m && m.matchId) this.markets.set(m.matchId, m);
    }
  }

  migrate(raw) {
    if (!raw || !raw.matchId) return raw;
    if (raw.outcomes && raw.outcomes.YES && raw.outcomes.NO) {
      raw.holdings = raw.holdings || {};
      raw.trades = raw.trades || [];
      raw.predictions = raw.predictions || {};
      raw.settlements = raw.settlements || {};
      raw.badge = TEST_BADGE;
      raw.cashValue = 0;
      raw.custody = false;
      raw.realMoney = false;
      raw.b = raw.b || this.b;
      if (raw.status !== "settled" && raw.status !== "voided") this.syncPrices(raw);
      return raw;
    }
    const agents = raw.agents || [];
    if (agents.length < 2) return raw;
    const target = agents[0];
    const quoted = Number(raw.price?.[target.id]);
    const prob = quoted > 0 && quoted < 1 ? quoted : 0.5;
    const seeded = seedBinary(prob, this.b);
    const outcomes = {
      YES: { id: "YES", code: "YES", label: "YES", q: seeded[0] },
      NO: { id: "NO", code: "NO", label: "NO", q: seeded[1] },
    };
    const holdings = {};
    const settlements = {};
    const settled = raw.status === "settled";
    for (const pos of raw.positions || []) {
      const onTarget = pos.agentId === target.id;
      const wantYes = pos.side !== "no";
      const outcome = wantYes === onTarget ? "YES" : "NO";
      const shares = Number(pos.contracts) || 0;
      if (!settled && shares > 0) outcomes[outcome].q += shares;
      holdings[`${pos.predictorId}|${outcome}`] = {
        userId: pos.predictorId,
        outcome,
        shares: settled ? 0 : shares,
        netCostBasis: settled ? 0 : Number(pos.stake) || 0,
        realizedPnl: 0,
        trail: pos.trail || [],
        updatedAt: pos.at || raw.createdAt || Date.now(),
      };
      if (settled) {
        settlements[pos.predictorId] = {
          predictorId: pos.predictorId,
          agentId: pos.agentId,
          side: pos.side,
          outcome,
          stake: pos.stake,
          price: pos.price,
          contracts: pos.contracts,
          shares,
          payout: pos.payout,
          pnl: pos.pnl,
          testPnl: pos.pnl,
          pnlLabel: "Test P&L",
          won: !!pos.won,
          settled: true,
          value: pos.payout,
          unrealized: pos.pnl,
          markPrice: pos.won ? 1 : 0,
          cashValue: 0,
        };
      }
    }
    const market = {
      ...raw,
      id: raw.matchId,
      marketType: raw.marketType || "MATCH_WINNER",
      question: raw.question || `Will ${target.name} win?`,
      targetAgentId: target.id,
      targetName: target.name,
      outcomes,
      b: this.b,
      holdings,
      trades: raw.trades || [],
      predictions: raw.predictions || {},
      settlements,
      badge: TEST_BADGE,
      cashValue: 0,
      custody: false,
      realMoney: false,
      initialProbability: prob,
      initialProbabilitySource: raw.initialProbabilitySource || "admin_test",
    };
    if (!settled && market.status !== "voided") this.syncPrices(market);
    return market;
  }
}

module.exports = { MarketService, TEST_BADGE, EVENT_MAP };
