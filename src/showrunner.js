// showrunner.js — Phase 1 arena loop.
//
// LDA creates a match, runs two AI characters, records every engine event,
// and settles the test-credit book against that result. No wallets.
// Phase 3 handoff is the oracle block (match id, seed, event log, result hash).
// A regulated partner would settle real money. This process does not.

const crypto = require("crypto");
const { Match, makeRng } = require("./engine");
const { safeFallback, bidFacts, decisionRng } = require("./agents");
const { CAST, character, makePlayer, pairSchedule } = require("./characters");
const { SimMarket, pricesFromRecords, DEFAULT_STAKE } = require("./simmarket");
const { EVENT_MAP } = require("./marketservice");
const { classifyPace, bidAside, revealHeadline, matchStory, shareCard } = require("./narrative");
const { intensityFor, paceDelay, splitHold, publicEvent } = require("./contract");
const { ShowStore } = require("./showstore");
const { resolvePlaySeeds } = require("./randomness");
const { MatchIntegrity } = require("./integrity");
const { OracleService } = require("./oracle");
const { OracleKeyStore } = require("./oraclekeys");
const { SettlementGate } = require("./settlementgate");
const { BrandBook } = require("./brands");

// Rates are quoted only after this many recorded samples. Same gate knownFor uses for calls.
const SAMPLE_FLOOR = 6;

// Settled stories kept on the show file. Older matches drop off the list.
const HISTORY_CAP = 100;

function propMetrics({ log, seats, winnerId, durationMs }) {
  const ids = (seats || []).map((s) => s.id);
  const roundWinners = [];
  const roundWins = Object.fromEntries(ids.map((id) => [id, 0]));
  const totalDiceRolled = Object.fromEntries(ids.map((id) => [id, 0]));
  for (const ev of log || []) {
    if (ev.type === "hand_start" && Array.isArray(ev.counts)) {
      for (const row of ev.counts) {
        if (row && row.id in totalDiceRolled) totalDiceRolled[row.id] += Number(row.dice) || 0;
      }
    }
    if (ev.type === "challenge" && ev.loserId) {
      const roundWinner = ids.find((id) => id !== ev.loserId) || null;
      if (roundWinner) {
        roundWinners.push(roundWinner);
        roundWins[roundWinner] = (roundWins[roundWinner] || 0) + 1;
      }
    }
  }
  return {
    winnerId,
    durationMs: Math.max(0, Number(durationMs) || 0),
    roundWinners,
    roundWins,
    totalDiceRolled,
  };
}

function resultHash({ matchId, winnerId, seed, log }) {
  const events = (log || []).map((e) => ({
    type: e.type,
    hand: e.hand,
    byId: e.byId || null,
    count: e.count ?? e.bid?.count ?? null,
    face: e.face ?? e.bid?.face ?? null,
    loserId: e.loserId || null,
    actual: e.actual ?? null,
    bidWasTrue: e.bidWasTrue ?? null,
    winnerId: e.winnerId || null,
  }));
  return crypto.createHash("sha256").update(JSON.stringify({
    v: 1, matchId, winnerId, seed, events,
  })).digest("hex");
}

function emptyRecord(id) {
  return {
    id, won: 0, lost: 0, played: 0, streak: 0, bestStreak: 0,
    form: [], rivals: {}, bids: 0, bigBids: 0, challenges: 0, correctCalls: 0,
    moments: [],
    bluffAttempts: 0, bluffCaught: 0, bidStepSum: 0, bidSteps: 0,
    handsAhead: 0, handsBehind: 0, winsWhileAhead: 0, winsWhileBehind: 0,
  };
}

function rivalBucket(record, oid) {
  const riv = record.rivals[oid] ||= { wins: 0, losses: 0, meetings: 0 };
  if (riv.bluffAttempts == null) riv.bluffAttempts = 0;
  if (riv.calls == null) riv.calls = 0;
  return riv;
}

function storedLine(hits, n, label) {
  if (!(n >= SAMPLE_FLOOR)) return null;
  return `${hits} of ${n} ${label}`;
}

class Records {
  constructor(ids) {
    this.agents = {};
    for (const id of ids) this.agents[id] = emptyRecord(id);
  }
  get(id) { return this.agents[id] || emptyRecord(id); }
  line(id) {
    const r = this.get(id);
    return `${r.won}–${r.lost}`;
  }
  noteBid(id, { count, total, step, bluff, opponentId }) {
    const r = this.agents[id];
    if (!r) return;
    r.bids++;
    if (total && count >= total * 0.55) r.bigBids++;
    if (bluff) {
      r.bluffAttempts++;
      if (opponentId) rivalBucket(r, opponentId).bluffAttempts++;
    }
    if (Number.isFinite(step)) {
      r.bidStepSum += step;
      r.bidSteps++;
    }
  }
  noteCall(id, correct, opponentId) {
    const r = this.agents[id];
    if (!r) return;
    r.challenges++;
    if (correct) r.correctCalls++;
    if (opponentId) rivalBucket(r, opponentId).calls++;
  }
  noteBluffCaught(id) {
    const r = this.agents[id];
    if (!r) return;
    r.bluffCaught++;
  }
  noteHand(id, edge) {
    const r = this.agents[id];
    if (!r) return;
    if (edge === "ahead") r.handsAhead++;
    else if (edge === "behind") r.handsBehind++;
  }
  applyMatch({ seats, winnerId, story, edges }) {
    for (const s of seats) {
      const r = this.agents[s.id];
      if (!r) continue;
      r.played++;
      const won = s.id === winnerId;
      if (won) {
        r.won++;
        r.streak++;
        r.bestStreak = Math.max(r.bestStreak, r.streak);
        r.form.unshift("W");
      } else {
        r.lost++;
        r.streak = 0;
        r.form.unshift("L");
      }
      if (r.form.length > 8) r.form.length = 8;
      const edge = edges && edges[s.id];
      if (won && edge && edge.ahead > edge.behind) r.winsWhileAhead++;
      else if (won && edge && edge.behind > edge.ahead) r.winsWhileBehind++;
      for (const o of seats) {
        if (o.id === s.id) continue;
        const riv = rivalBucket(r, o.id);
        riv.meetings++;
        if (won) riv.wins++;
        else riv.losses++;
      }
      if (won && story?.title) {
        r.moments.unshift({ title: story.title, dek: story.dek, at: Date.now() });
        if (r.moments.length > 6) r.moments.length = 6;
      }
    }
  }
  knownFor(id) {
    const r = this.get(id);
    if (r.bids >= 8 && r.bigBids / r.bids >= 0.34) return "big claims";
    if (r.challenges >= 6 && r.correctCalls / r.challenges >= 0.55) return "calling thin bids";
    return null;
  }
  static load(raw, ids) {
    const records = new Records(ids);
    if (!raw) return records;
    for (const id of ids) {
      if (!raw[id]) continue;
      records.agents[id] = { ...emptyRecord(id), ...raw[id], id };
    }
    return records;
  }
}

async function playExhibit({ agents, seed, matchId = null, onEvent = async () => {}, sleep = async () => {}, turnDelayMs = 0, revealDelayMs = 0, maxSteps = 900 }) {
  // Numeric seeds keep the pre-commitment mix. A 32-byte hex root uses the
  // committed dice stream and a separate agent stream.
  const seeds = resolvePlaySeeds(seed);
  const match = new Match({
    seats: agents.map((a) => ({ id: a.id, name: a.name })),
    seed: seeds.diceSeed,
    diceCount: 5,
  });
  const timings = { turnDelayMs, revealDelayMs, settleHoldMs: 0 };
  const rng = seeds.legacy ? decisionRng(seed) : makeRng(seeds.agentSeed);
  const byId = Object.fromEntries(agents.map((a) => [a.id, a]));
  if (matchId) for (const ev of match.log) ev.matchId = matchId;
  let steps = 0;
  while (!match.winnerId && steps++ < maxSteps) {
    const actor = byId[match.currentPlayer.id];
    const view = match.viewFor(actor.id);
    match.record("thinking", {
      actorId: actor.id,
      name: actor.name,
      matchId,
      pace: "normal",
      intensity: intensityFor("normal"),
    });
    let played;
    try { played = await actor.act(view, rng); }
    catch (e) { played = safeFallback(view, e.message); }
    if (!played || !played.action) played = safeFallback(view, "empty");
    let trial = played;
    // Illegal moves are swapped for a legal fallback before the engine sees them.
    // The sleep is presentation. It does not choose the action.
    const action = trial.action;
    const illegalBid = action.type === "bid" && view.currentBid && !(
      action.count > view.currentBid.count || (action.count === view.currentBid.count && action.face > view.currentBid.face)
    );
    const illegalOpen = action.type === "challenge" && !view.currentBid;
    if (illegalBid || illegalOpen || (action.type !== "bid" && action.type !== "challenge")) {
      trial = safeFallback(view, "illegal");
    }
    const pace = classifyPace(view, trial.action);
    let ch = null;
    try { ch = character(actor.id); } catch { ch = null; }
    if (trial.action.type === "challenge") {
      const bidder = (view.table || []).find((t) => t.id === view.currentBid.byId);
      await onEvent({
        type: "CALL",
        kind: "CALL_MADE",
        name: actor.name,
        agentId: actor.id,
        callerId: actor.id,
        pace: "call",
        intensity: intensityFor("call"),
        bid: view.currentBid,
        bidderName: bidder ? bidder.name : null,
        hand: match.handNumber,
        matchId,
      });
      await sleep(paceDelay("call", timings));
    }
    const from = match.log.length;
    let res = match.applyAction(trial.action);
    if (!res.ok) {
      const fb = safeFallback(view, res.error || "illegal");
      if (fb.action.type === "challenge" && trial.action.type !== "challenge") {
        await onEvent({
          type: "CALL", kind: "CALL_MADE", name: actor.name, agentId: actor.id, callerId: actor.id,
          pace: "call", intensity: intensityFor("call"), bid: view.currentBid, hand: match.handNumber, matchId,
        });
        await sleep(paceDelay("call", timings));
      }
      res = match.applyAction(fb.action);
      trial = fb;
    }
    if (!res.ok) break;
    const facts = bidFacts(view, trial.action);
    const decision = trial.decision || null;
    for (const ev of match.log.slice(from)) {
      if (matchId) ev.matchId = matchId;
      if (ev.type === "bid") {
        ev.pace = pace;
        ev.intensity = intensityFor(pace);
        ev.thought = trial.thought || "";
        ev.bluff = facts.bluff;
        ev.step = facts.step;
        ev.bestFace = decision ? decision.bestFace : null;
        ev.secondFace = decision ? decision.secondFace : null;
        ev.chosenFace = trial.action.face;
        ev.plannedFace = decision ? decision.plannedFace ?? null : null;
        ev.mix = decision ? decision.mix || null : null;
        ev.wild = !!(decision && decision.wild);
      }
    }
    if (trial.action.type === "bid" && res.ok) {
      const bidEv = match.log.slice(from).find((e) => e.type === "bid");
      const aside = bidAside(trial.action, view, ch);
      const bidIntensity = intensityFor(pace);
      const bidHold = splitHold(paceDelay(pace, timings), bidIntensity, "bid");
      // The think slice is the existing pace clock, moved ahead of the bid.
      // It is not an extra delay, and it does not publish the agent's dice or a memory.
      if (bidHold.think > 0) {
        await onEvent({
          type: "THINKING",
          kind: "AGENT_THINKING_STARTED",
          name: actor.name,
          agentId: actor.id,
          pace: "normal",
          intensity: 1,
          hand: bidEv ? bidEv.hand : match.handNumber,
          matchId,
        });
        await sleep(bidHold.think);
      }
      await onEvent({
        type: "BID",
        kind: "BID_PLACED",
        name: actor.name,
        agentId: actor.id,
        count: trial.action.count,
        face: trial.action.face,
        aside,
        pace,
        intensity: bidIntensity,
        hand: bidEv ? bidEv.hand : match.handNumber,
        seq: bidEv ? bidEv.seq : null,
        counts: match.players.map((p) => ({ id: p.id, dice: p.dice.length, alive: p.alive })),
        thought: trial.thought || "",
        bluff: facts.bluff,
        step: facts.step,
        matchId,
        contract: bidEv ? publicEvent(bidEv) : null,
      });
      await sleep(bidHold.rest);
    }
    if (res.resolved) {
      const roundEv = match.log.slice(from).find((e) => e.type === "challenge");
      const revealEv = match.log.slice(from).find((e) => e.kind === "DICE_REVEALED");
      const lastBid = [...match.log].reverse().find((e) => e.type === "bid");
      const elimination = !!res.resolved.elimination;
      await onEvent({
        type: "REVEAL",
        kind: "DICE_REVEALED",
        pace: "reveal",
        intensity: intensityFor("reveal", { elimination }),
        hand: roundEv ? roundEv.hand : match.handNumber,
        seq: revealEv ? revealEv.seq : null,
        headline: revealHeadline(res.resolved.bidWasTrue),
        bidWasTrue: res.resolved.bidWasTrue,
        actual: res.resolved.actual,
        bid: res.resolved.bid,
        reveal: res.resolved.reveal,
        loserId: res.resolved.loserId,
        challengerId: res.resolved.challengerId,
        bidderId: res.resolved.bidderId,
        counts: res.resolved.countsAfter,
        beforeCounts: (res.resolved.reveal || []).map((r) => ({ id: r.id, dice: r.dice.length, alive: true })),
        bluffBid: !!(lastBid && lastBid.bluff && lastBid.byId === res.resolved.bidderId),
        elimination,
        matchOver: !!res.matchOver,
        matchId,
        contract: revealEv ? publicEvent(revealEv) : null,
      });
      await sleep(paceDelay("reveal", timings));
    }
  }
  const winner = match.players.find((p) => p.id === match.winnerId) || null;
  return {
    winnerId: match.winnerId,
    winnerName: winner ? winner.name : null,
    seed,
    log: match.log,
    hands: match.handNumber,
  };
}

class Show {
  constructor(opts = {}) {
    this.store = opts.dataPath ? new ShowStore(opts.dataPath) : null;
    this._hydrating = false;
    this.oracleKeys = opts.oracleKeys || new OracleKeyStore({ env: opts.env || process.env });
    this.oracleService = opts.oracle || new OracleService(this.oracleKeys);
    this.integrity = opts.integrity || new MatchIntegrity({
      oracle: this.oracleService,
      env: opts.env || process.env,
    });
    this.settlementGate = opts.settlementGate || new SettlementGate();
    this.market = opts.market || new SimMarket({ onChange: () => this.persist() });
    // Brands ride the same show.json writer. Missing versions fall back to seed v1.
    this.brands = opts.brands || new BrandBook({ seeds: false });
    // TEST_MARKETS=0 runs the same matches with the book closed.
    // Default is on. The dice loop does not read this flag.
    this.marketsEnabled = opts.marketsEnabled != null
      ? !!opts.marketsEnabled
      : process.env.TEST_MARKETS !== "0";
    this.eventMap = EVENT_MAP;
    this.records = new Records(CAST.map((c) => c.id));
    this.sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.pickWindowMs = opts.pickWindowMs ?? 14000;
    this.turnDelayMs = opts.turnDelayMs ?? 900;
    this.revealDelayMs = opts.revealDelayMs ?? 1500;
    this.settleHoldMs = opts.settleHoldMs ?? 12000;
    this.bootstrapCount = opts.bootstrapCount ?? 16;
    this.loopEnabled = opts.loopEnabled !== false;
    this.testHook = !!opts.testHook;
    // Live now plus four coming-up books. Twelve characters leave two off
    // the board. A longer request stops when the next pair would sit twice.
    this.slateAhead = Math.max(1, opts.slateAhead ?? 4);
    this.debutId = "athena";
    this.schedule = pairSchedule(this.debutId);
    this.pairIdx = 0;
    this.seq = 0;
    this.phase = "starting";
    this.current = null;
    this.upcoming = [];
    this.history = [];
    this._interrupted = null;
    this.clients = new Set();
    this.running = false;
    this.ready = false;
    this.bootstrapDone = false;
    this._playing = null;
    if (this.store) this.hydrate(this.store.load());
    this.brands.ensureSeeds();
  }

  persist() {
    if (!this.store || this._hydrating) return;
    const keep = new Set();
    if (this.current) keep.add(this.current.matchId);
    for (const u of this.upcoming) keep.add(u.matchId);
    const book = this.market.exportState();
    book.markets = book.markets.filter((m) => m.status !== "settled" || keep.has(m.matchId));
    this.store.save({
      v: 1,
      seq: this.seq,
      pairIdx: this.pairIdx,
      bootstrapDone: this.bootstrapDone,
      records: this.records.agents,
      history: this.history,
      market: book,
      current: this.slimCard(this.current),
      upcoming: this.upcoming.map((m) => this.slimCard(m)),
      interrupted: this._interrupted || null,
      integrity: this.integrity.exportState(),
      brands: this.brands.exportState(),
      cashValue: 0,
      custody: false,
      realMoney: false,
    });
  }

  slimCard(m) {
    if (!m) return null;
    return {
      matchId: m.matchId,
      phase: m.phase,
      round: m.round || 0,
      // The root seed stays sealed until the match is finalized.
      seed: m.rngCommitment && !m.integrityRevealed ? null : m.seed,
      rngCommitment: m.rngCommitment || null,
      configurationHash: m.configurationHash || null,
      integrityStatus: m.integrityStatus || null,
      seats: (m.seats || []).map((s) => ({ id: s.id, name: s.name, brandVersion: s.brandVersion || null })),
      prior: m.prior || null,
    };
  }

  cardFromSaved(raw, phase) {
    if (!raw || !raw.matchId) return null;
    const market = this.market.markets.get(raw.matchId);
    if (!market) return null;
    const seats = (raw.seats || []).map((s) => {
      const c = character(s.id);
      return { id: c.id, name: c.name, dice: 5, alive: true, brandVersion: s.brandVersion || this.brands.activeVersion(c.id) };
    });
    if (seats.length < 2) return null;
    return {
      matchId: raw.matchId,
      phase,
      round: 0,
      seed: raw.seed != null ? raw.seed : this.integrity.exportSeed(raw.matchId),
      rngCommitment: raw.rngCommitment || null,
      configurationHash: raw.configurationHash || null,
      integrityStatus: raw.integrityStatus || null,
      integrityRevealed: raw.integrityStatus === "VALID" || raw.integrityStatus === "INVALID" || raw.integrityStatus === "VOID",
      seats,
      bid: null,
      narrative: { line: phase === "upcoming" ? "Up next." : "Who's got this?", aside: null, headline: null, pace: "normal" },
      reveal: null,
      market,
      story: null,
      share: null,
      oracle: null,
      prior: raw.prior || { ...market.price },
    };
  }

  hydrate(data) {
    if (!data) return;
    this._hydrating = true;
    try {
      if (data.integrity) this.integrity.importState(data.integrity);
      if (data.brands) this.brands.importState(data.brands);
      this.seq = data.seq || 0;
      this.pairIdx = data.pairIdx || 0;
      this.bootstrapDone = !!data.bootstrapDone;
      this.history = Array.isArray(data.history) ? data.history : [];
      this.records = Records.load(data.records, CAST.map((c) => c.id));
      this.market.importState(data.market || {});
      this.upcoming = (data.upcoming || []).map((raw) => this.cardFromSaved(raw, "upcoming")).filter(Boolean);
      this.current = null;
      this._interrupted = null;
      if (data.current && data.current.phase === "pick") {
        this.current = this.cardFromSaved(data.current, "pick");
        if (this.current) this.phase = "pick";
      } else if (data.current && data.current.phase === "live") {
        this._interrupted = data.current;
      } else if (data.interrupted) {
        this._interrupted = data.interrupted;
      }
    } finally {
      this._hydrating = false;
    }
  }

  snapshot(predictorId) {
    const cur = this.current;
    return {
      phase: this.phase,
      serverNow: Date.now(),
      unit: "test-credits",
      cashValue: 0,
      custody: false,
      realMoney: false,
      defaultStake: DEFAULT_STAKE,
      testMarkets: this.marketsEnabled,
      badge: "TEST MARKET — Arena Credits have no monetary value.",
      live: cur ? this.publicMatch(cur, predictorId) : null,
      hot: this.hotLine(),
      rivalries: this.topRivalries(),
      fresh: CAST.filter((c) => this.records.get(c.id).played === 0).map((c) => ({ id: c.id, name: c.name, archetype: c.archetype, brand: this.brands.publicOf(c.id) })),
      brands: this.brands.publicMap(),
      yourReads: this.readsFor(predictorId),
      you: this.youView(predictorId),
      upcoming: this.upcoming.map((m) => this.upcomingCard(m, predictorId)),
      watching: this.clients.size,
      partner: {
        status: "not_contracted",
        realMoney: false,
        handoff: ["matchId", "participants", "rules", "engineLog", "seed", "resultHash", "winnerId", "configurationHash", "rngCommitment", "eventLogHash", "signature"],
      },
    };
  }

  youView(predictorId) {
    if (!predictorId) return null;
    try {
      return this.market.publicPredictor(this.market.requirePredictor(predictorId));
    } catch {
      return null;
    }
  }

  readsFor(predictorId) {
    if (!predictorId) return [];
    let view;
    try { view = this.market.predictors.get(predictorId); } catch { return []; }
    if (!view) return [];
    const bag = view.byAgent || {};
    return Object.entries(bag)
      .filter(([, b]) => b.picks > 0)
      .sort((a, b) => b[1].picks - a[1].picks)
      .slice(0, 3)
      .map(([id, b]) => {
        const c = character(id);
        return { id, name: c.name, picks: b.picks, correct: b.correct, brand: this.brands.publicOf(id) };
      });
  }

  hotLine() {
    const ranked = CAST.map((c) => this.records.get(c.id)).filter((r) => r.streak >= 3)
      .sort((a, b) => b.streak - a.streak);
    if (!ranked.length) return null;
    const r = ranked[0];
    const c = character(r.id);
    return { agentId: r.id, name: c.name, streak: r.streak, text: `${c.name} has won ${r.streak} straight.`, brand: this.brands.publicOf(r.id) };
  }

  topRivalries() {
    const seen = new Set();
    const rows = [];
    for (const c of CAST) {
      const r = this.records.get(c.id);
      for (const [oid, riv] of Object.entries(r.rivals)) {
        const key = [c.id, oid].sort().join(":");
        if (seen.has(key) || riv.meetings < 2) continue;
        seen.add(key);
        const o = character(oid);
        rows.push({
          a: { id: c.id, name: c.name, brand: this.brands.publicOf(c.id) },
          b: { id: o.id, name: o.name, brand: this.brands.publicOf(o.id) },
          meetings: riv.meetings,
          series: `${riv.wins}–${riv.losses}`,
          text: `${c.name} vs ${o.name}`,
        });
      }
    }
    rows.sort((x, y) => y.meetings - x.meetings);
    return rows.slice(0, 3);
  }

  publicMatch(m, predictorId) {
    const seats = m.seats.map((s) => {
      const c = character(s.id);
      const rec = this.records.get(s.id);
      return {
        id: s.id,
        name: c.name,
        archetype: c.archetype,
        hue: c.hue,
        line: c.line,
        dice: s.dice,
        alive: s.alive !== false,
        record: this.records.line(s.id),
        won: rec.won,
        lost: rec.lost,
        streak: rec.streak,
        brand: this.brands.publicOf(s.id, s.brandVersion),
      };
    });
    return {
      matchId: m.matchId,
      phase: m.phase,
      round: m.round,
      seed: m.integrityRevealed ? m.seed : null,
      rngCommitment: m.rngCommitment || null,
      configurationHash: m.configurationHash || null,
      integrityStatus: m.integrityStatus || null,
      seats,
      bid: m.bid,
      narrative: m.narrative,
      thinking: m.thinking ? { agentId: m.thinking.agentId, name: m.thinking.name } : null,
      reveal: m.reveal,
      market: m.market ? this.market.publicMarket(m.market, predictorId) : null,
      story: m.story,
      share: m.share,
      oracle: m.oracle,
      rules: "liars-dice-common-hand-ones-wild-v1",
    };
  }

  emit(ev) {
    const line = `data: ${JSON.stringify({ ...ev, serverNow: Date.now() })}\n\n`;
    for (const res of this.clients) {
      try { res.write(line); } catch { this.clients.delete(res); }
    }
  }

  emitState() {
    this.emit({ type: "state", ...this.snapshot() });
  }

  subscribe(req, res) {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify({ type: "state", ...this.snapshot() })}\n\n`);
    this.clients.add(res);
    this.emitState();
    req.on("close", () => {
      this.clients.delete(res);
      this.emitState();
    });
  }

  busyIds() {
    const ids = new Set();
    const take = (m) => { if (m) for (const s of m.seats || []) ids.add(s.id); };
    take(this.current);
    for (const u of this.upcoming) take(u);
    return ids;
  }

  nextPair() {
    const busy = this.busyIds();
    const free = (id) => id && !busy.has(id);
    const unplayed = CAST.filter((c) => this.records.get(c.id).played === 0 && free(c.id));
    const debut = unplayed.find((c) => c.id === this.debutId) || unplayed[0];
    if (debut && this.bootstrapDone) {
      const foe = CAST.find((c) => free(c.id) && c.id !== debut.id);
      if (foe) return [debut.id, foe.id];
    }
    const hot = CAST.map((c) => this.records.get(c.id)).filter((r) => r.streak >= 3 && free(r.id))
      .sort((a, b) => b.streak - a.streak)[0];
    if (hot) {
      const rivals = Object.entries(hot.rivals).sort((a, b) => b[1].meetings - a[1].meetings);
      const foe = (rivals.find(([id]) => free(id)) || [])[0]
        || (CAST.find((c) => free(c.id) && c.id !== hot.id) || {}).id;
      if (foe && foe !== hot.id) return [hot.id, foe];
    }
    for (let i = 0; i < this.schedule.length; i++) {
      const pair = this.schedule[this.pairIdx % this.schedule.length];
      this.pairIdx++;
      if (pair.every((id) => free(id))) return pair;
    }
    const rest = CAST.map((c) => c.id).filter(free);
    if (rest.length >= 2) return [rest[0], rest[1]];
    if (busy.size === 0) {
      const pair = this.schedule[this.pairIdx % this.schedule.length];
      this.pairIdx++;
      return pair;
    }
    return null;
  }

  makeCard(phase) {
    const pair = this.nextPair();
    if (!pair) return null;
    const [a, b] = pair;
    const seats = [a, b].map((id) => {
      const c = character(id);
      return { id: c.id, name: c.name, dice: 5, alive: true, brandVersion: this.brands.activeVersion(c.id) };
    });
    this.seq++;
    const matchId = `m${this.seq.toString(36)}`;
    const prepared = this.integrity.prepare({
      matchId,
      seats,
      frozenBy: "show",
      scheduledAt: new Date().toISOString(),
    });
    const prices = pricesFromRecords(seats.map((s) => s.id), (id) => this.records.get(id));
    const played = seats.some((s) => (this.records.get(s.id).played || 0) > 0);
    let book = null;
    if (this.marketsEnabled) {
      this.market.onGameEvent({
        type: "MATCH_CREATED",
        eventId: `MATCH_CREATED:${matchId}`,
        matchId,
        agents: seats.map((s) => ({ id: s.id, name: s.name })),
        prices,
        initialProbabilitySource: played ? "historical_model" : "equal_prior",
      });
      book = this.market.requireMarket(matchId);
      book.configurationHash = prepared.configurationHash;
      book.rngCommitment = prepared.rngCommitment;
    }
    return {
      matchId,
      phase,
      round: 0,
      seed: prepared.rootSeed,
      rngCommitment: prepared.rngCommitment,
      configurationHash: prepared.configurationHash,
      integrityStatus: "PENDING",
      integrityRevealed: false,
      seats,
      bid: null,
      narrative: { line: phase === "upcoming" ? "Up next." : "Who's got this?", aside: null, headline: null, pace: "normal" },
      reveal: null,
      market: book,
      story: null,
      share: null,
      oracle: null,
      prior: book ? book.price : prices,
    };
  }

  ensureUpcoming(n) {
    const want = Math.max(0, (n == null ? this.slateAhead : n) | 0);
    while (this.upcoming.length < want) {
      const card = this.makeCard("upcoming");
      if (!card) break;
      this.upcoming.push(card);
    }
  }

  upcomingCard(m, predictorId) {
    const book = m.market ? this.market.publicMarket(m.market, predictorId) : null;
    return {
      matchId: m.matchId,
      phase: "upcoming",
      seats: m.seats.map((s) => {
        const c = character(s.id);
        return {
          id: s.id, name: c.name, archetype: c.archetype, hue: c.hue,
          record: this.records.line(s.id),
          brand: this.brands.publicOf(s.id, s.brandVersion),
        };
      }),
      price: book ? book.price : null,
      yesPrice: book ? book.yesPrice : null,
      noPrice: book ? book.noPrice : null,
      yesCents: book ? book.yesCents : null,
      noCents: book ? book.noCents : null,
      targetAgentId: book ? book.targetAgentId : null,
      question: book ? book.question : null,
      badge: book ? book.badge : null,
      testMarket: !!book,
      you: book ? book.you || null : null,
      props: book ? book.props || [] : [],
      cashValue: 0,
      custody: false,
      realMoney: false,
    };
  }

  openNext(opts = {}) {
    const queue = opts.queue !== false;
    if (this.current && (this.current.phase === "pick" || this.current.phase === "live")) {
      if (queue) this.ensureUpcoming();
      this.persist();
      return this.current;
    }
    this.pruneSettled();
    let card = this.upcoming.shift() || null;
    if (card) {
      card.phase = "pick";
      card.narrative = { line: "Who's got this?", aside: null, headline: null, pace: "normal" };
      card.round = 0;
    } else {
      card = this.makeCard("pick");
      if (!card) throw new Error("no_pair");
    }
    this.current = card;
    this.phase = "pick";
    if (queue) this.ensureUpcoming();
    this.persist();
    this.emitState();
    return this.current;
  }

  pruneSettled() {
    const keep = new Set();
    if (this.current) keep.add(this.current.matchId);
    for (const u of this.upcoming) keep.add(u.matchId);
    for (const [id, m] of this.market.markets) {
      if (m.status === "settled" && !keep.has(id)) this.market.markets.delete(id);
    }
  }

  _syncDice(counts) {
    if (!this.current || !counts) return;
    for (const c of counts) {
      const s = this.current.seats.find((x) => x.id === c.id);
      if (s) { s.dice = c.dice; s.alive = c.alive !== false; }
    }
  }

  _markFromDice() {
    // V1: LMSR moves only when someone trades. Dice never reprice the book.
    const m = this.current;
    if (!this.marketsEnabled || !m || !m.market) return;
    this.market.mark(m.matchId);
  }

  _matchAgents(m) {
    return m.seats.map((s) => {
      const c = character(s.id);
      return {
        id: c.id,
        version: "cast-v1",
        aggression: c.aggression,
        chaos: c.chaos,
        archetype: c.archetype,
      };
    });
  }

  _livePrice(m) {
    if (!this.marketsEnabled || !m || !m.market) return null;
    return this.market.requireMarket(m.matchId).price;
  }

  async playOpen() {
    if (this._playing) return this._playing;
    const run = this._playOpen();
    this._playing = run;
    try { return await run; }
    finally { this._playing = null; }
  }

  async _playOpen() {
    const m = this.current;
    if (!m || m.phase === "settled") throw new Error("nothing_to_play");
    if (m.phase === "live") throw new Error("already_playing");
    let settled = false;
    try {
      return await this._playLocked(m, (done) => { settled = done; });
    } catch (e) {
      if (!settled) this._abortMatch(m, e);
      throw e;
    }
  }

  _abortMatch(m, err) {
    if (!this.marketsEnabled || !m || !m.market) return;
    try {
      this.market.onGameEvent({
        type: "MATCH_ABORTED",
        eventId: `MATCH_ABORTED:${m.matchId}`,
        matchId: m.matchId,
        reason: String(err && err.message || err || "match_aborted"),
      });
    } catch (abortErr) {
      console.error("void market failed:", abortErr);
    }
  }

  async _playLocked(m, markSettled) {
    const startedAt = Date.now();
    m.startedAt = m.startedAt || startedAt;
    if (m.configurationHash) this.integrity.assertCanStart(m.matchId);
    if (this.marketsEnabled && m.market) {
      this.market.onGameEvent({
        type: "MATCH_STARTED",
        eventId: `MATCH_STARTED:${m.matchId}`,
        matchId: m.matchId,
        startedAt: m.startedAt,
        agents: this._matchAgents(m),
      });
    }
    m.phase = "live";
    this.phase = "live";
    this.persist();
    m.narrative = { line: "Dice are down.", aside: null, headline: null, pace: "normal" };
    this.emit({ type: "LOCK", matchId: m.matchId });
    this.emit({
      type: "MATCH_STARTED",
      matchId: m.matchId,
      eventId: `MATCH_STARTED:${m.matchId}`,
      legacyType: "LOCK",
    });
    this.emitState();
    const agents = m.seats.map((s) => makePlayer(s.id));
    this._handEdges = {};
    const exhibit = await playExhibit({
      agents,
      seed: m.seed,
      matchId: m.matchId,
      turnDelayMs: this.turnDelayMs,
      revealDelayMs: this.revealDelayMs,
      sleep: this.sleep,
      onEvent: async (ev) => {
        if (ev.type === "THINKING") {
          const newHand = ev.hand && ev.hand !== m.round;
          if (newHand) {
            m.round = ev.hand;
            m.bid = null;
            m.reveal = null;
          }
          m.thinking = { agentId: ev.agentId, name: ev.name };
          m.narrative = {
            line: `${ev.name} is thinking.`,
            aside: null,
            headline: null,
            pace: "normal",
            intensity: 1,
          };
        } else if (ev.type === "BID") {
          m.thinking = null;
          m.round = ev.hand;
          m.bid = { count: ev.count, face: ev.face, name: ev.name, agentId: ev.agentId, byId: ev.agentId };
          m.reveal = null;
          this._syncDice(ev.counts);
          m.narrative = {
            line: `${ev.name} bids ${ev.count} ${requireFace(ev.face)}.`,
            aside: ev.aside,
            headline: null,
            pace: ev.pace,
            intensity: ev.intensity,
          };
          const foe = m.seats.find((s) => s.id !== ev.agentId);
          this.records.noteBid(ev.agentId, {
            count: ev.count,
            total: (ev.counts || []).reduce((s, c) => s + (c.alive ? c.dice : 0), 0),
            step: ev.step,
            bluff: ev.bluff,
            opponentId: foe && foe.id,
          });
          this._markFromDice();
        } else if (ev.type === "CALL") {
          m.thinking = null;
          m.narrative = {
            line: `${ev.name} calls.`, aside: null, headline: "LIAR.",
            pace: "call", intensity: ev.intensity,
          };
          const bidderId = ev.bid && ev.bid.byId;
          m.bid = {
            ...(m.bid || {}),
            ...(ev.bid || {}),
            byId: bidderId || (m.bid && m.bid.byId) || null,
            agentId: bidderId || (m.bid && m.bid.agentId) || null,
            name: (m.bid && m.bid.name) || ev.bidderName || "",
            callerId: ev.agentId,
            callerName: ev.name,
          };
        } else if (ev.type === "REVEAL") {
          m.thinking = null;
          m.reveal = ev.reveal;
          m.narrative = {
            line: ev.headline,
            aside: null,
            headline: ev.headline,
            pace: "reveal",
            intensity: ev.intensity,
          };
          const callerRight = ev.bidWasTrue === false;
          this.records.noteCall(ev.challengerId, callerRight, ev.bidderId);
          if (ev.bluffBid && callerRight) this.records.noteBluffCaught(ev.bidderId);
          for (const row of ev.beforeCounts || []) {
            const others = (ev.beforeCounts || []).filter((x) => x.id !== row.id);
            if (!others.length) continue;
            const opp = Math.max(...others.map((x) => x.dice));
            const bucket = this._handEdges[row.id] ||= { ahead: 0, behind: 0 };
            if (row.dice > opp) { bucket.ahead++; this.records.noteHand(row.id, "ahead"); }
            else if (row.dice < opp) { bucket.behind++; this.records.noteHand(row.id, "behind"); }
          }
          // LMSR prices move only on trades. Dice do not reprice the book.
          this._markFromDice();
          this._syncDice(ev.counts);
        }
        this.emit({ type: ev.type, matchId: m.matchId, ...ev, narrative: m.narrative, price: this._livePrice(m) });
        this.emitState();
      },
    });
    if (!exhibit.winnerId) throw new Error("no_winner");
    const endedAt = Date.now();
    const story = matchStory({ seats: m.seats, winnerId: exhibit.winnerId, log: exhibit.log });
    const hash = resultHash({ matchId: m.matchId, winnerId: exhibit.winnerId, seed: m.seed, log: exhibit.log });
    let record = null;
    let gate = null;
    if (m.configurationHash) {
      record = this.integrity.finalize({
        matchId: m.matchId,
        log: exhibit.log,
        winnerId: exhibit.winnerId,
        startedAt: m.startedAt,
        endedAt,
      });
      m.integrityStatus = record.status;
      m.integrityRevealed = !!record.revealedSeed;
      const marketStatus = this.marketsEnabled && m.market
        ? this.market.requireMarket(m.matchId).status
        : "locked";
      const signatureCheck = record.oracle
        ? this.oracleService.verify(record.oracle)
        : { ok: false, code: "RESULT_SIGNATURE_FAILED" };
      gate = this.settlementGate.commit({
        integrity: record,
        oracle: record.oracle,
        marketStatus,
        signatureCheck,
      });
      m.settlementGate = { action: gate.action, errorCode: gate.errorCode, duplicate: !!gate.duplicate };
    }
    const resultEventId = `MATCH_RESOLVED:${m.matchId}:${hash}`;
    const metrics = propMetrics({
      log: exhibit.log,
      seats: m.seats,
      winnerId: exhibit.winnerId,
      durationMs: m.startedAt ? endedAt - m.startedAt : 0,
    });
    // Credits move only after the settlement gate accepts a signed VALID result.
    // Prop contracts settle from this log inside that same settlement, before
    // the winner payout. The market still sees integrityStatus, but that string
    // is not the decision.
    if (this.marketsEnabled && m.market && gate) {
      this.market.onGameEvent({
        type: "MATCH_RESOLVED",
        eventId: resultEventId,
        matchId: m.matchId,
        winnerId: exhibit.winnerId,
        resultHash: hash,
        endedAt,
        startedAt: m.startedAt || null,
        rounds: exhibit.hands,
        participants: m.seats.map((s) => s.id),
        integrityStatus: gate.action === "settle" ? "VALID" : record.status,
        signature: record.oracle ? record.oracle.signature : null,
        signedResultHash: record.oracle ? record.oracle.resultHash : null,
        signingKeyId: record.oracle ? record.oracle.signingKeyId : null,
        propMetrics: gate.action === "settle" ? metrics : null,
      });
      if (gate.action === "settle" && markSettled) markSettled(true);
    } else if (markSettled) {
      markSettled(true);
    }
    const winner = character(exhibit.winnerId);
    const loser = m.seats.find((s) => s.id !== exhibit.winnerId);
    this.records.applyMatch({ seats: m.seats, winnerId: exhibit.winnerId, story, edges: this._handEdges });
    const streak = this.records.get(exhibit.winnerId).streak;
    m.story = story;
    m.share = shareCard({ story, winnerName: winner.name, streak, loserName: loser && loser.name, matchId: m.matchId });
    const freeze = m.market && m.market.freeze;
    const agentVersions = {};
    for (const seat of m.seats) {
      const frozen = freeze && (freeze.agents || []).find((a) => a.id === seat.id);
      agentVersions[seat.id] = frozen ? frozen.version : "cast-v1";
    }
    m.oracle = {
      version: "1.0",
      matchId: m.matchId,
      status: "RESOLVED",
      participants: m.seats.map((s) => s.id),
      winnerId: exhibit.winnerId,
      winnerName: winner.name,
      rounds: exhibit.hands,
      startTimestamp: m.startedAt || null,
      endTimestamp: endedAt,
      durationMs: m.startedAt ? endedAt - m.startedAt : null,
      resultEventId,
      agentVersions,
      seed: m.integrityRevealed ? m.seed : null,
      resultHash: hash,
      eventCount: exhibit.log.length,
      rules: "liars-dice-common-hand-ones-wild-v1",
      realMoney: false,
      cashValue: 0,
      integrityStatus: m.integrityStatus || null,
      configurationHash: m.configurationHash || null,
      rngCommitment: m.rngCommitment || null,
      eventLogHash: record && record.eventLogHash,
      finalStateHash: record && record.finalStateHash,
      signedResultHash: record && record.oracle ? record.oracle.resultHash : null,
      signature: record && record.oracle ? record.oracle.signature : null,
      signingKeyId: record && record.oracle ? record.oracle.signingKeyId : null,
      algorithm: record && record.oracle ? record.oracle.algorithm : null,
      settlement: m.settlementGate || null,
      note: "LDA result only. Arena Credits settle here only after integrity is VALID and the oracle signature verifies. They have no monetary value.",
    };
    m.engineLog = exhibit.log;
    m.phase = "settled";
    this.phase = "settled";
    m.narrative = {
      line: story.title, aside: story.dek, headline: story.title,
      pace: "result", intensity: intensityFor("result"),
    };
    const archived = {
      matchId: m.matchId,
      at: Date.now(),
      seats: m.seats.map((s) => ({
        id: s.id,
        name: s.name,
        brandVersion: s.brandVersion || this.brands.activeVersion(s.id),
      })),
      winnerId: exhibit.winnerId,
      winnerName: winner.name,
      story,
      share: m.share,
      oracle: m.oracle,
      seed: m.seed,
      engineLog: exhibit.log,
      hands: exhibit.hands,
    };
    this.rememberHistory(archived);
    this.persist();
    this.emit({ type: "SETTLED", matchId: m.matchId, story, oracle: m.oracle, share: m.share });
    this.emit({
      type: "MATCH_RESOLVED",
      matchId: m.matchId,
      eventId: resultEventId,
      legacyType: "SETTLED",
      winnerId: exhibit.winnerId,
      resultHash: hash,
    });
    this.emitState();
    return archived;
  }

  async bootstrap(n) {
    const prev = {
      sleep: this.sleep,
      turn: this.turnDelayMs,
      reveal: this.revealDelayMs,
    };
    this.sleep = async () => {};
    this.turnDelayMs = 0;
    this.revealDelayMs = 0;
    const count = Math.max(0, n | 0);
    for (let i = 0; i < count; i++) {
      this.openNext({ queue: false });
      await this.playOpen();
      this.current = null;
    }
    this.sleep = prev.sleep;
    this.turnDelayMs = prev.turn;
    this.revealDelayMs = prev.reveal;
    this.current = null;
    this.bootstrapDone = true;
    this.persist();
  }

  async finishInterrupted(raw) {
    // Re-sim from the seed. Seeded decisions replay the actions that seed defines.
    // A match killed mid-play after older Math.random calls does not resume the
    // bids already streamed. The seed is the result, not a partial tape.
    if (this.history.some((h) => h.matchId === raw.matchId)) return;
    const market = this.market.markets.get(raw.matchId);
    if (!market || market.status === "settled") return;
    const card = this.cardFromSaved(raw, "pick");
    if (!card) return;
    this.current = card;
    this.phase = "pick";
    const prev = { sleep: this.sleep, turn: this.turnDelayMs, reveal: this.revealDelayMs };
    this.sleep = async () => {};
    this.turnDelayMs = 0;
    this.revealDelayMs = 0;
    try { await this.playOpen(); }
    finally {
      this.sleep = prev.sleep;
      this.turnDelayMs = prev.turn;
      this.revealDelayMs = prev.reveal;
      this.current = null;
    }
  }

  async start() {
    if (this.running) return;
    this.running = true;
    if (this._interrupted) {
      const raw = this._interrupted;
      this._interrupted = null;
      try { await this.finishInterrupted(raw); }
      catch (e) {
        console.error("resume match failed:", e);
        this.current = null;
      }
    }
    if (!this.bootstrapDone) {
      const need = Math.max(0, this.bootstrapCount - this.history.length);
      if (need) await this.bootstrap(need);
      else this.bootstrapDone = true;
    }
    this.ready = true;
    if (!this.current || (this.current.phase !== "pick" && this.current.phase !== "live")) {
      this.current = null;
      this.openNext();
    } else {
      this.ensureUpcoming();
      this.persist();
      this.emitState();
    }
    if (!this.loopEnabled) return;
    this.loop().catch((e) => console.error("show loop:", e));
  }

  async loop() {
    while (this.running) {
      try {
        if (!this.current || this.current.phase === "settled") this.openNext();
        if (this.current && this.current.phase === "pick") {
          await this.sleep(this.pickWindowMs);
          if (this.current && this.current.phase === "pick") await this.playOpen();
        }
        await this.sleep(paceDelay("result", {
          turnDelayMs: this.turnDelayMs,
          revealDelayMs: this.revealDelayMs,
          settleHoldMs: this.settleHoldMs,
        }));
        this.current = null;
        this.openNext();
      } catch (e) {
        console.error("show match failed:", e);
        if (this.current) this._abortMatch(this.current, e);
        this.phase = "paused";
        this.emitState();
        this.current = null;
        await this.sleep(2000);
      }
    }
  }

  agentList() {
    return CAST.map((c) => {
      const r = this.records.get(c.id);
      return {
        id: c.id, name: c.name, archetype: c.archetype, hue: c.hue, style: c.style, line: c.line,
        record: this.records.line(c.id), won: r.won, lost: r.lost, streak: r.streak,
        form: r.form, played: r.played, knownFor: this.records.knownFor(c.id),
        brand: this.brands.publicOf(c.id),
      };
    });
  }

  agentDetail(id) {
    const c = character(id);
    const r = this.records.get(c.id);
    const rivals = Object.entries(r.rivals).map(([oid, riv]) => ({
      id: oid, name: character(oid).name, series: `${riv.wins}–${riv.losses}`, meetings: riv.meetings,
    })).sort((a, b) => b.meetings - a.meetings);
    return {
      ...c,
      record: this.records.line(c.id),
      won: r.won, lost: r.lost, streak: r.streak, bestStreak: r.bestStreak,
      form: r.form, played: r.played,
      winRate: r.played ? Math.round((1000 * r.won) / r.played) / 10 : 0,
      knownFor: this.records.knownFor(c.id),
      bluffLine: storedLine(r.bluffCaught, r.bluffAttempts, "bluff bids were caught"),
      callLine: storedLine(r.correctCalls, r.challenges, "calls were right"),
      bidStep: r.bidSteps >= SAMPLE_FLOOR
        ? { sum: r.bidStepSum, n: r.bidSteps }
        : null,
      rivals, moments: r.moments,
      brand: this.brands.publicOf(c.id),
      brandRecord: this.brands.full(c.id),
    };
  }

  brandView(id) {
    const brand = this.brands.full(id);
    if (!brand) {
      const err = new Error("unknown_agent");
      err.code = "unknown_agent";
      throw err;
    }
    return brand;
  }

  brandsForSeats(seats) {
    const out = {};
    for (const seat of seats || []) {
      if (!seat || !seat.id) continue;
      const brand = this.brands.publicOf(seat.id, seat.brandVersion);
      if (brand) out[seat.id] = brand;
    }
    return out;
  }

  rememberHistory(archived) {
    this.history.unshift(archived);
    if (this.history.length > HISTORY_CAP) this.history.length = HISTORY_CAP;
    return this.history;
  }

  historyList() {
    return this.history.map((h) => ({
      matchId: h.matchId,
      at: h.at,
      seats: (h.seats || []).map((s) => ({
        ...s,
        brand: this.brands.publicOf(s.id, s.brandVersion),
      })),
      winnerId: h.winnerId,
      winnerName: h.winnerName,
      title: h.story?.title,
      dek: h.story?.dek,
      share: h.share,
    }));
  }

  matchDetail(id) {
    const h = this.history.find((m) => m.matchId === id);
    if (h) return h;
    if (this.current && this.current.matchId === id) return this.publicMatch(this.current);
    return null;
  }

  // Public verification record. No sealed seed and no private key.
  verification(matchId, opts = {}) {
    const id = String(matchId || "");
    const known = this.integrity.publicView(id);
    if (!known) return null;
    if (!opts.replay) return known;
    const row = this.history.find((h) => h.matchId === id)
      || (this.current && this.current.matchId === id ? this.current : null);
    const log = row && (row.engineLog || null);
    if (!log) return { ...known, replay: null };
    return this.integrity.reverify({
      matchId: id,
      log,
      winnerId: (row && row.winnerId) || known.winnerId,
    });
  }
}

function requireFace(face) {
  const { faceWord } = require("./narrative");
  return faceWord(face);
}

module.exports = { Show, Records, playExhibit, resultHash, propMetrics, DEFAULT_STAKE, HISTORY_CAP, SAMPLE_FLOOR };
