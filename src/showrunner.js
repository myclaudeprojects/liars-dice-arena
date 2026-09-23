// showrunner.js — Phase 1 arena loop.
//
// LDA creates a match, runs two AI characters, records every engine event,
// and settles the test-credit book against that result. No wallets.
// Phase 3 handoff is the oracle block (match id, seed, event log, result hash).
// A regulated partner would settle real money. This process does not.

const crypto = require("crypto");
const { Match } = require("./engine");
const { safeFallback } = require("./agents");
const { CAST, character, makePlayer, pairSchedule } = require("./characters");
const { SimMarket, pricesFromRecords, pricesFromDice, DEFAULT_STAKE } = require("./simmarket");
const { classifyPace, bidAside, revealHeadline, matchStory, shareCard } = require("./narrative");
const { ShowStore } = require("./showstore");

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
  };
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
  noteBid(id, { count, total }) {
    const r = this.agents[id];
    if (!r) return;
    r.bids++;
    if (total && count >= total * 0.55) r.bigBids++;
  }
  noteCall(id, correct) {
    const r = this.agents[id];
    if (!r) return;
    r.challenges++;
    if (correct) r.correctCalls++;
  }
  applyMatch({ seats, winnerId, story }) {
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
      for (const o of seats) {
        if (o.id === s.id) continue;
        const riv = r.rivals[o.id] ||= { wins: 0, losses: 0, meetings: 0 };
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

async function playExhibit({ agents, seed, onEvent = async () => {}, sleep = async () => {}, turnDelayMs = 0, revealDelayMs = 0, maxSteps = 900 }) {
  const match = new Match({
    seats: agents.map((a) => ({ id: a.id, name: a.name })),
    seed,
    diceCount: 5,
  });
  const byId = Object.fromEntries(agents.map((a) => [a.id, a]));
  let steps = 0;
  while (!match.winnerId && steps++ < maxSteps) {
    const actor = byId[match.currentPlayer.id];
    const view = match.viewFor(actor.id);
    let played;
    try { played = await actor.act(view); }
    catch (e) { played = safeFallback(view, e.message); }
    if (!played || !played.action) played = safeFallback(view, "empty");
    let trial = played;
    // Validate without mutating: apply, and if illegal swap to fallback before the pause.
    // Match has no peek, so we apply once. Illegal moves are corrected first via a dry pattern:
    // safeFallback is used when apply would fail. We detect by checking the same rules loosely.
    const action = trial.action;
    const illegalBid = action.type === "bid" && view.currentBid && !(
      action.count > view.currentBid.count || (action.count === view.currentBid.count && action.face > view.currentBid.face)
    );
    const illegalOpen = action.type === "challenge" && !view.currentBid;
    if (illegalBid || illegalOpen || (action.type !== "bid" && action.type !== "challenge")) {
      trial = safeFallback(view, "illegal");
    }
    const pace = classifyPace(view, trial.action);
    const ch = character(actor.id);
    if (trial.action.type === "challenge") {
      await onEvent({
        type: "CALL",
        name: actor.name,
        agentId: actor.id,
        pace,
        bid: view.currentBid,
        hand: match.handNumber,
      });
      await sleep(pace === "critical" ? revealDelayMs : Math.round(turnDelayMs * 0.7));
    }
    let res = match.applyAction(trial.action);
    if (!res.ok) {
      const fb = safeFallback(view, res.error || "illegal");
      if (fb.action.type === "challenge" && trial.action.type !== "challenge") {
        await onEvent({ type: "CALL", name: actor.name, agentId: actor.id, pace: "interesting", bid: view.currentBid, hand: match.handNumber });
        await sleep(turnDelayMs);
      }
      res = match.applyAction(fb.action);
      trial = fb;
    }
    if (!res.ok) break;
    if (trial.action.type === "bid" && res.ok) {
      const aside = bidAside(trial.action, view, ch);
      await onEvent({
        type: "BID",
        name: actor.name,
        agentId: actor.id,
        count: trial.action.count,
        face: trial.action.face,
        aside,
        pace,
        hand: match.handNumber,
        counts: match.players.map((p) => ({ id: p.id, dice: p.dice.length, alive: p.alive })),
        thought: trial.thought || "",
      });
      await sleep(pace === "critical" ? Math.round(turnDelayMs * 1.5) : turnDelayMs);
    }
    if (res.resolved) {
      await onEvent({
        type: "REVEAL",
        pace: "critical",
        hand: match.handNumber,
        headline: revealHeadline(res.resolved.bidWasTrue),
        bidWasTrue: res.resolved.bidWasTrue,
        actual: res.resolved.actual,
        bid: res.resolved.bid,
        reveal: res.resolved.reveal,
        loserId: res.resolved.loserId,
        challengerId: res.resolved.challengerId,
        bidderId: res.resolved.bidderId,
        counts: match.players.map((p) => ({ id: p.id, dice: p.alive ? p.dice.length : 0, alive: p.alive })),
        matchOver: !!res.matchOver,
      });
      await sleep(revealDelayMs);
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
    this.market = opts.market || new SimMarket({ onChange: () => this.persist() });
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
      seed: m.seed,
      seats: (m.seats || []).map((s) => ({ id: s.id, name: s.name })),
      prior: m.prior || null,
    };
  }

  cardFromSaved(raw, phase) {
    if (!raw || !raw.matchId) return null;
    const market = this.market.markets.get(raw.matchId);
    if (!market) return null;
    const seats = (raw.seats || []).map((s) => {
      const c = character(s.id);
      return { id: c.id, name: c.name, dice: 5, alive: true };
    });
    if (seats.length < 2) return null;
    return {
      matchId: raw.matchId,
      phase,
      round: 0,
      seed: raw.seed,
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
      live: cur ? this.publicMatch(cur, predictorId) : null,
      hot: this.hotLine(),
      rivalries: this.topRivalries(),
      fresh: CAST.filter((c) => this.records.get(c.id).played === 0).map((c) => ({ id: c.id, name: c.name, archetype: c.archetype })),
      yourReads: this.readsFor(predictorId),
      you: this.youView(predictorId),
      upcoming: this.upcoming.map((m) => this.upcomingCard(m, predictorId)),
      watching: this.clients.size,
      partner: {
        status: "not_contracted",
        realMoney: false,
        handoff: ["matchId", "participants", "rules", "engineLog", "seed", "resultHash", "winnerId"],
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
        return { id, name: c.name, picks: b.picks, correct: b.correct };
      });
  }

  hotLine() {
    const ranked = CAST.map((c) => this.records.get(c.id)).filter((r) => r.streak >= 3)
      .sort((a, b) => b.streak - a.streak);
    if (!ranked.length) return null;
    const r = ranked[0];
    const c = character(r.id);
    return { agentId: r.id, name: c.name, streak: r.streak, text: `${c.name} has won ${r.streak} straight.` };
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
          a: { id: c.id, name: c.name },
          b: { id: o.id, name: o.name },
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
      };
    });
    return {
      matchId: m.matchId,
      phase: m.phase,
      round: m.round,
      seed: m.seed,
      seats,
      bid: m.bid,
      narrative: m.narrative,
      reveal: m.reveal,
      market: this.market.publicMarket(m.market, predictorId),
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
      return { id: c.id, name: c.name, dice: 5, alive: true };
    });
    this.seq++;
    const matchId = `m${this.seq.toString(36)}`;
    const prices = pricesFromRecords(seats.map((s) => s.id), (id) => this.records.get(id));
    const book = this.market.createMarket({
      matchId,
      agents: seats.map((s) => ({ id: s.id, name: s.name })),
      prices,
    });
    return {
      matchId,
      phase,
      round: 0,
      seed: (Date.now() ^ (this.seq * 997)) >>> 0,
      seats,
      bid: null,
      narrative: { line: phase === "upcoming" ? "Up next." : "Who's got this?", aside: null, headline: null, pace: "normal" },
      reveal: null,
      market: this.market.requireMarket(matchId),
      story: null,
      share: null,
      oracle: null,
      prior: book.price,
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
    const book = this.market.publicMarket(m.market, predictorId);
    return {
      matchId: m.matchId,
      phase: "upcoming",
      seats: m.seats.map((s) => {
        const c = character(s.id);
        return {
          id: s.id, name: c.name, archetype: c.archetype, hue: c.hue,
          record: this.records.line(s.id),
        };
      }),
      price: book.price,
      you: book.you || null,
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
    const m = this.current;
    if (!m) return;
    const ids = m.seats.map((s) => s.id);
    const prices = pricesFromDice(ids, (id) => {
      const s = m.seats.find((x) => x.id === id);
      return s && s.alive ? s.dice : 0;
    }, m.prior);
    this.market.mark(m.matchId, prices);
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
    this.market.lock(m.matchId);
    m.phase = "live";
    this.phase = "live";
    this.persist();
    m.narrative = { line: "Dice are down.", aside: null, headline: null, pace: "normal" };
    this.emit({ type: "LOCK", matchId: m.matchId });
    this.emitState();
    const agents = m.seats.map((s) => makePlayer(s.id));
    const exhibit = await playExhibit({
      agents,
      seed: m.seed,
      turnDelayMs: this.turnDelayMs,
      revealDelayMs: this.revealDelayMs,
      sleep: this.sleep,
      onEvent: async (ev) => {
        if (ev.type === "BID") {
          m.round = ev.hand;
          m.bid = { count: ev.count, face: ev.face, name: ev.name, agentId: ev.agentId };
          m.reveal = null;
          this._syncDice(ev.counts);
          m.narrative = {
            line: `${ev.name} bids ${ev.count} ${requireFace(ev.face)}.`,
            aside: ev.aside,
            headline: null,
            pace: ev.pace,
          };
          this.records.noteBid(ev.agentId, { count: ev.count, total: (ev.counts || []).reduce((s, c) => s + (c.alive ? c.dice : 0), 0) });
          this._markFromDice();
        } else if (ev.type === "CALL") {
          m.narrative = { line: `${ev.name} calls.`, aside: null, headline: "LIAR.", pace: ev.pace };
          m.bid = ev.bid ? { ...ev.bid, name: ev.name } : m.bid;
        } else if (ev.type === "REVEAL") {
          m.reveal = ev.reveal;
          m.narrative = {
            line: ev.headline,
            aside: null,
            headline: ev.headline,
            pace: "critical",
          };
          const callerRight = ev.bidWasTrue === false;
          this.records.noteCall(ev.challengerId, callerRight);
          const ids = m.seats.map((s) => s.id);
          const prices = pricesFromDice(ids, (id) => {
            const c = (ev.counts || []).find((x) => x.id === id);
            return c && c.alive ? c.dice : 0;
          }, m.prior);
          this.market.mark(m.matchId, prices);
          if (ev.matchOver) this._syncDice(ev.counts);
        }
        this.emit({ type: ev.type, matchId: m.matchId, ...ev, narrative: m.narrative, price: this.market.requireMarket(m.matchId).price });
        this.emitState();
      },
    });
    if (!exhibit.winnerId) throw new Error("no_winner");
    const story = matchStory({ seats: m.seats, winnerId: exhibit.winnerId, log: exhibit.log });
    const hash = resultHash({ matchId: m.matchId, winnerId: exhibit.winnerId, seed: m.seed, log: exhibit.log });
    this.market.settle(m.matchId, { winnerId: exhibit.winnerId, resultHash: hash });
    const winner = character(exhibit.winnerId);
    const loser = m.seats.find((s) => s.id !== exhibit.winnerId);
    this.records.applyMatch({ seats: m.seats, winnerId: exhibit.winnerId, story });
    const streak = this.records.get(exhibit.winnerId).streak;
    m.story = story;
    m.share = shareCard({ story, winnerName: winner.name, streak, loserName: loser && loser.name, matchId: m.matchId });
    m.oracle = {
      matchId: m.matchId,
      winnerId: exhibit.winnerId,
      winnerName: winner.name,
      seed: m.seed,
      resultHash: hash,
      eventCount: exhibit.log.length,
      rules: "liars-dice-common-hand-ones-wild-v1",
      realMoney: false,
      note: "LDA result only. Test credits settle here. A regulated partner would settle real-money contracts from this oracle.",
    };
    m.engineLog = exhibit.log;
    m.phase = "settled";
    this.phase = "settled";
    m.narrative = { line: story.title, aside: story.dek, headline: story.title, pace: "critical" };
    const archived = {
      matchId: m.matchId,
      at: Date.now(),
      seats: m.seats.map((s) => ({ id: s.id, name: s.name })),
      winnerId: exhibit.winnerId,
      winnerName: winner.name,
      story,
      share: m.share,
      oracle: m.oracle,
      seed: m.seed,
      engineLog: exhibit.log,
      hands: exhibit.hands,
    };
    this.history.unshift(archived);
    if (this.history.length > 40) this.history.length = 40;
    this.persist();
    this.emit({ type: "SETTLED", matchId: m.matchId, story, oracle: m.oracle, share: m.share });
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
        await this.sleep(this.settleHoldMs);
        this.current = null;
        this.openNext();
      } catch (e) {
        console.error("show match failed:", e);
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
      rivals, moments: r.moments,
    };
  }

  historyList() {
    return this.history.map((h) => ({
      matchId: h.matchId,
      at: h.at,
      seats: h.seats,
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
}

function requireFace(face) {
  const { faceWord } = require("./narrative");
  return faceWord(face);
}

module.exports = { Show, Records, playExhibit, resultHash, DEFAULT_STAKE };
