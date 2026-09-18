// tables.js — Many parallel matches, each with its own seats and spectator pool.
//
// Product: thousands of people play, bet, and create agents. A creator must be
// able to find tables featuring their agent and back it. Pools are per match.
//
// This process still runs tables on one event loop (Render web service). That is
// a foundation, not a claim of infinite scale.
//
// TODO(scale): shard TableManager across workers keyed by tableId (or a
//   matchmaking service that assigns table ids to worker processes).
// TODO(scale): Redis / NATS pub-sub so SSE is not bound to the process that
//   ran the match — /api/tables/:id/events should subscribe to a channel.
// TODO(scale): lobby list from an index (Redis hashes) instead of walking
//   in-memory Table objects; filter/q/agent should be indexed.
// TODO(scale): house-bot wallets are already per-table labels; community
//   agents stay one-wallet/one-live-table until a worker owns that agent.

const { runMatch } = require("./arena");
const { BettingPool, impliedMultipliers } = require("./betting");
const {
  HOUSE_FEE_ADDRESS, HOUSE_FEE_BPS, SEAT_FEE_BPS, MIN_SEAT,
} = require("./economics");

const TABLE_ID_RE = /^t-\d+$/;

function tableLabels(tableId, matchNo) {
  return {
    pot: `pot:${tableId}:${matchNo}`,
    pool: `pool:${tableId}:${matchNo}`,
  };
}

function communityBusyIds(tables, exceptTableId) {
  const ids = new Set();
  for (const t of tables) {
    if (exceptTableId && t.id === exceptTableId) continue;
    for (const id of t.busyIds || []) ids.add(id);
  }
  return [...ids];
}

function filterTableSummaries(tables, { agent, owner, q } = {}) {
  const agentId = agent ? String(agent).toLowerCase() : "";
  const ownerQ = owner ? String(owner).toLowerCase() : "";
  const needle = q ? String(q).toLowerCase().trim() : "";
  return tables.filter((t) => {
    const seats = t.seats || [];
    if (agentId && !seats.some((s) => String(s.id).toLowerCase() === agentId)) return false;
    if (ownerQ && !seats.some((s) => String(s.owner || "").toLowerCase() === ownerQ)) return false;
    if (needle) {
      const blob = [t.id, t.phase, ...seats.flatMap((s) => [s.id, s.name, s.owner])].join(" ").toLowerCase();
      if (!blob.includes(needle)) return false;
    }
    return true;
  });
}

class Mutex {
  constructor() { this._p = Promise.resolve(); }
  run(fn) {
    const next = this._p.then(fn, fn);
    this._p = next.catch(() => {});
    return next;
  }
}

class Table {
  constructor(id, mgr) {
    this.id = id;
    this.mgr = mgr;
    this.matchNo = 0;
    this.phase = "idle";
    this.seats = [];
    this.pool = null;
    this.bets = [];
    this.multipliers = {};
    this.betCloseAt = null;
    this.clients = new Set();
    this.lastError = null;
    this.busyIds = [];
  }

  publicState() {
    const bets = this.bets || [];
    return {
      tableId: this.id,
      serverNow: Date.now(),
      phase: this.phase,
      matchNo: this.matchNo,
      seats: this.seats,
      bets,
      multipliers: this.multipliers,
      betCloseAt: this.betCloseAt,
      poolTotal: bets.reduce((s, b) => s + b.amount, 0),
      ante: this.mgr.ante,
      minSeat: this.mgr.minSeat,
      walletKind: this.mgr.wallet.kind,
      live: this.mgr.liveChain,
      betWindowMs: this.mgr.betWindowMs,
      tableCount: this.mgr.tables.length,
    };
  }

  summary() {
    const st = this.publicState();
    return {
      id: this.id,
      matchNo: st.matchNo,
      phase: st.phase,
      seats: st.seats,
      poolTotal: st.poolTotal,
      betCloseAt: st.betCloseAt,
      multipliers: st.multipliers,
      open: !!(this.pool && this.pool.open),
      poolAddress: this.pool?.poolWallet?.address || null,
      clients: this.clients.size,
      error: this.lastError?.message || null,
    };
  }

  broadcast(ev) {
    const line = `data: ${JSON.stringify(ev)}\n\n`;
    for (const res of this.clients) {
      try { res.write(line); } catch { this.clients.delete(res); }
    }
  }

  subscribe(req, res) {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.write(`data: ${JSON.stringify({ type: "phase", ...this.publicState() })}\n\n`);
    this.clients.add(res);
    req.on("close", () => this.clients.delete(res));
  }

  async cycle() {
    while (true) {
      try {
        await this.oneMatch();
        this.lastError = null;
      } catch (e) {
        this.lastError = { at: Date.now(), message: String(e?.message || e).slice(0, 300) };
        console.error(`table ${this.id} match #${this.matchNo} failed:`, e?.stack || e);
        this.phase = "paused";
        this.busyIds = [];
        this.broadcast({ type: "phase", ...this.publicState(), error: this.lastError.message });
        this.mgr.notifyLobby();
        await this.mgr.sleep(this.mgr.errorPauseMs);
      }
    }
  }

  async oneMatch() {
    const agents = await this.mgr.seatLock.run(() => this.mgr.buildAgents(this));
    if (!agents || agents.length < 2) {
      this.phase = "waiting";
      this.seats = [];
      this.busyIds = [];
      this.pool = null;
      this.bets = [];
      this.broadcast({ type: "phase", ...this.publicState() });
      this.mgr.notifyLobby();
      await this.mgr.sleep(this.mgr.waitingMs);
      return;
    }

    this.matchNo++;
    this.seats = agents.map((a) => ({
      id: a.id, name: a.name, kind: a.kind, owner: a.owner || "house",
      ownerAddress: a.ownerAddress || null,
      personaTag: a.personaTag || null,
      imageUrl: `/api/agents/${encodeURIComponent(a.id)}/avatar`,
    }));
    this.busyIds = this.seats.filter((s) => s.owner && s.owner !== "house").map((s) => s.id);
    const labels = tableLabels(this.id, this.matchNo);

    this.pool = new BettingPool({
      wallet: this.mgr.wallet,
      houseFeeBps: HOUSE_FEE_BPS,
      seatFeeBps: SEAT_FEE_BPS,
      houseAddress: HOUSE_FEE_ADDRESS,
      potLabel: labels.pool,
    });
    await this.pool.init();
    this.phase = "betting";
    this.bets = [];
    this.multipliers = impliedMultipliers([], agents.map((a) => a.id), { houseBps: HOUSE_FEE_BPS, seatBps: SEAT_FEE_BPS });
    this.betCloseAt = Date.now() + this.mgr.betWindowMs;
    this.pool.closeAt = this.betCloseAt;
    this.broadcast({ type: "phase", ...this.publicState() });
    this.mgr.notifyLobby();
    await this.mgr.sleep(this.mgr.betWindowMs);
    this.pool.close();

    this.phase = "playing";
    this.broadcast({ type: "phase", ...this.publicState() });
    this.mgr.notifyLobby();

    const { turnDelayMs, revealDelayMs, dealDelayMs } = this.mgr;
    const result = await runMatch({
      agents, wallet: this.mgr.wallet, ante: this.mgr.ante, seed: Date.now(), potLabel: labels.pot,
      onEvent: async (ev) => {
        this.broadcast(ev);
        if (ev.type === "turn") await this.mgr.sleep(turnDelayMs);
        else if (ev.type === "reveal") await this.mgr.sleep(revealDelayMs);
        else if (ev.type === "hand_start") await this.mgr.sleep(dealDelayMs);
        else if (ev.type === "ante") await this.mgr.sleep(500);
      },
    });

    this.pool.settledAt = Date.now();
    if (result.winnerId && !result.aborted) {
      this.mgr.stats.recordMatch({
        matchNo: this.matchNo, seats: this.seats, winnerId: result.winnerId, potTotal: result.potTotal,
        ante: this.mgr.ante, log: result.log, poolTotal: this.pool.bets.reduce((s, b) => s + b.amount, 0),
        seed: result.seed, tableId: this.id,
      });
    }
    const settlement = await this.pool.settle(result.winnerId || null, {
      house: { address: HOUSE_FEE_ADDRESS },
      seat: result.winnerId ? agents.find((a) => a.id === result.winnerId)?.walletInfo : null,
    });
    this.mgr.stats.recordBets(this.pool.bets, result.winnerId || null, settlement.payouts);
    await this.mgr.reviewSeats(agents);
    this.phase = "settled";
    this.broadcast({
      type: "pool_settled", winnerId: result.winnerId || null, winnerName: result.winnerName || null,
      aborted: !!result.aborted, ...settlement, ...this.publicState(),
    });
    this.mgr.notifyLobby();
    await this.mgr.sleep(this.mgr.settlePauseMs);
    this.busyIds = [];
  }
}

class TableManager {
  constructor(opts) {
    this.wallet = opts.wallet;
    this.registry = opts.registry;
    this.stats = opts.stats;
    this.instantiate = opts.instantiate;
    this.ensureWallet = opts.ensureWallet;
    this.ante = opts.ante;
    this.tableSize = opts.tableSize;
    this.liveChain = opts.liveChain;
    this.betWindowMs = opts.betWindowMs;
    this.turnDelayMs = opts.turnDelayMs;
    this.revealDelayMs = opts.revealDelayMs;
    this.dealDelayMs = opts.dealDelayMs;
    this.settlePauseMs = opts.settlePauseMs ?? 8000;
    this.errorPauseMs = opts.errorPauseMs ?? 15000;
    this.waitingMs = opts.waitingMs ?? 5000;
    this.staggerMs = opts.staggerMs ?? 4000;
    this.sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.minStake = opts.minStake;
    this.minSeat = opts.minSeat ?? MIN_SEAT;
    this.shouldReleaseTxClaim = opts.shouldReleaseTxClaim;
    this.houseWallet = null;
    this.seatLock = new Mutex();
    this.lobbyClients = new Set();
    const count = Math.max(1, Math.min(24, Math.round(Number(opts.tableCount) || 3)));
    this.tables = [];
    for (let i = 1; i <= count; i++) this.tables.push(new Table(`t-${i}`, this));
  }

  get(id) { return this.tables.find((t) => t.id === id) || null; }

  list(filters) {
    const summaries = this.tables.map((t) => t.summary());
    return filterTableSummaries(summaries, filters || {});
  }

  featuring(agentId) {
    const id = String(agentId || "");
    return this.tables.filter((t) => t.seats.some((s) => s.id === id)).map((t) => t.summary());
  }

  seatedIndex() {
    const out = {};
    for (const t of this.tables) {
      for (const s of t.seats) {
        (out[s.id] ||= []).push(t.id);
      }
    }
    return out;
  }

  featured() {
    return this.tables.find((t) => t.phase === "betting")
      || this.tables.find((t) => t.phase === "playing")
      || this.tables[0];
  }

  clientCount() {
    let n = this.lobbyClients.size;
    for (const t of this.tables) n += t.clients.size;
    return n;
  }

  health() {
    return this.tables.map((t) => ({
      id: t.id, phase: t.phase, matchNo: t.matchNo, clients: t.clients.size,
      seats: t.seats.map((s) => s.id), error: t.lastError?.message || null,
    }));
  }

  notifyLobby() {
    const ev = { type: "lobby", tables: this.list(), serverNow: Date.now(), tableCount: this.tables.length };
    const line = `data: ${JSON.stringify(ev)}\n\n`;
    for (const res of this.lobbyClients) {
      try { res.write(line); } catch { this.lobbyClients.delete(res); }
    }
  }

  subscribeLobby(req, res) {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.write(`data: ${JSON.stringify({ type: "lobby", tables: this.list(), serverNow: Date.now(), tableCount: this.tables.length })}\n\n`);
    this.lobbyClients.add(res);
    req.on("close", () => this.lobbyClients.delete(res));
  }

  async buildAgents(table) {
    const excludeIds = communityBusyIds(this.tables, table.id);
    const funded = new Set();
    for (const a of this.registry.list()) {
      if (a.house || a.status !== "active") continue;
      try {
        const w = await this.ensureWallet(this.registry.get(a.id));
        if ((await this.wallet.getBalance(w.walletId)) >= this.minSeat) funded.add(a.id);
        else this.registry.sideline(a.id, "below_min_seat");
      } catch { /* skip unfundable */ }
    }
    const recs = this.registry.pickSeats(this.tableSize, {
      eligible: (a) => funded.has(a.id),
      excludeIds,
    });
    if (recs.length < 2) {
      table.busyIds = [];
      return [];
    }
    const agents = [];
    for (const rec of recs) {
      const ag = this.instantiate(rec);
      const recFull = this.registry.get(rec.id) || rec;
      if (recFull.ownerAddress) ag.creatorWallet = { address: recFull.ownerAddress };
      else if (rec.house) ag.creatorWallet = { address: HOUSE_FEE_ADDRESS };
      ag.ownerAddress = recFull.ownerAddress || ag.ownerAddress || null;
      if (!ag.personaTag) ag.personaTag = recFull.personaTag || null;
      if (rec.house) {
        ag.walletInfo = await this.wallet.createSeatWallet(`${rec.id}:${table.id}`);
        if (this.wallet.ensureFunded) {
          try {
            const tx = await this.wallet.ensureFunded(ag.walletInfo, this.minSeat);
            if (tx) table.broadcast({ type: "funded", agentId: rec.id, name: rec.name, tx, explorer: this.wallet.explorerUrl(tx) });
          } catch (e) { console.error(`could not fund ${rec.id} at ${table.id}:`, e.message); }
        }
      } else {
        ag.walletInfo = await this.ensureWallet(rec);
      }
      agents.push(ag);
    }
    this.registry.markPlayed(recs.map((r) => r.id));
    table.busyIds = recs.filter((r) => !r.house).map((r) => r.id);
    return agents;
  }

  async reviewSeats(agents) {
    for (const ag of agents || []) {
      if (!ag || ag.owner === "house") continue;
      try {
        const rec = this.registry.get(ag.id);
        if (!rec || rec.house || !rec.wallet) continue;
        const bal = await this.wallet.getBalance(rec.wallet.walletId);
        if (bal < this.minSeat) this.registry.sideline(ag.id, "below_min_seat");
        else if (rec.status === "sidelined") this.registry.reactivate(ag.id);
      } catch { /* leave status as-is */ }
    }
  }

  findTableForBet({ tableId, agentId }) {
    if (tableId) return this.get(tableId);
    if (agentId) {
      const open = this.tables.find((t) => t.pool && t.pool.open && t.seats.some((s) => s.id === agentId));
      if (open) return open;
      return this.tables.find((t) => t.seats.some((s) => s.id === agentId)) || null;
    }
    return this.featured();
  }

  async start() {
    if (!this.houseWallet) this.houseWallet = await this.wallet.createSeatWallet("house");
    this.tables.forEach((t, i) => {
      this.sleep(i * this.staggerMs).then(() => t.cycle()).catch((e) => {
        console.error(`table ${t.id} cycle crashed:`, e);
      });
    });
  }
}

module.exports = {
  Table, TableManager, Mutex, TABLE_ID_RE, HOUSE_FEE_BPS, SEAT_FEE_BPS,
  tableLabels, communityBusyIds, filterTableSummaries,
};
