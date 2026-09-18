// tables.js — Many parallel matches.
//
// BUILD seats → CROWD (tips open) → LOCK (freeze + oracle hash) →
// MARKET (native WHO WINS UI; partner DCM) → MATCH (Arena Credits) →
// SETTLEMENT (verifiable oracle). Personality tips are disabled after lock.
// LDA is not the exchange and does not custody prediction USDC.

const { runMatch } = require("./arena");
const { HOUSE_FEE_ADDRESS } = require("./economics");
const {
  matchIdFor, tipsOpen, bookVisible, marketOpen,
  buildLockedConfig, marketListing,
} = require("./lifecycle");

const TABLE_ID_RE = /^t-\d+$/;

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
    this.matchId = null;
    this.lockedConfig = null;
    this.listing = null;
    this.crowdCloseAt = null;
    this.marketCloseAt = null;
    this.clients = new Set();
    this.lastError = null;
    this.busyIds = [];
  }

  publicState() {
    const seats = (this.seats || []).map((s) => {
      const snap = this.mgr.influence ? this.mgr.influence.snapshot(s.id) : null;
      return snap ? { ...s, influence: snap } : s;
    });
    const market = this.listing || null;
    return {
      tableId: this.id,
      serverNow: Date.now(),
      phase: this.phase,
      matchNo: this.matchNo,
      matchId: this.matchId,
      seats,
      ante: this.mgr.ante,
      unit: "credits",
      walletKind: this.mgr.wallet.kind,
      live: this.mgr.liveChain,
      crowdDelayMs: this.mgr.crowdDelayMs,
      marketDelayMs: this.mgr.marketDelayMs,
      crowdCloseAt: this.crowdCloseAt,
      marketCloseAt: this.marketCloseAt,
      tableCount: this.mgr.tables.length,
      tipsOpen: tipsOpen(this.phase),
      bookVisible: bookVisible(this.phase),
      marketOpen: marketOpen(this.phase),
      noSpectatorPool: true,
      firstPartyMarkets: false,
      ldaIsTheExchange: false,
      custody: false,
      lockedConfigHash: this.lockedConfig?.lockedConfigHash || null,
      market,
    };
  }

  summary() {
    const st = this.publicState();
    return {
      id: this.id,
      matchNo: st.matchNo,
      matchId: st.matchId,
      phase: st.phase,
      seats: st.seats,
      clients: this.clients.size,
      tipsOpen: st.tipsOpen,
      bookVisible: st.bookVisible,
      ldaIsTheExchange: false,
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
      this.matchId = null;
      this.lockedConfig = null;
      this.broadcast({ type: "phase", ...this.publicState() });
      this.mgr.notifyLobby();
      await this.mgr.sleep(this.mgr.waitingMs);
      return;
    }

    this.matchNo++;
    this.matchId = matchIdFor(this.id, this.matchNo);
    this.seats = agents.map((a) => ({
      id: a.id, name: a.name, kind: a.kind, owner: a.owner || "house",
      ownerAddress: a.ownerAddress || null,
      personaTag: a.personaTag || null,
      aggression: a.aggression != null ? a.aggression : null,
      creatorAddress: a.creatorWallet?.address || a.ownerAddress || null,
      imageUrl: `/api/agents/${encodeURIComponent(a.id)}/avatar`,
    }));
    this.busyIds = this.seats.filter((s) => s.owner && s.owner !== "house").map((s) => s.id);

    // CROWD — personality tips open; agents not yet locked.
    this.phase = "crowd";
    this.crowdCloseAt = Date.now() + this.mgr.crowdDelayMs;
    this.marketCloseAt = null;
    this.lockedConfig = null;
    this.listing = null;
    this.broadcast({ type: "phase", ...this.publicState() });
    this.mgr.notifyLobby();
    await this.mgr.sleep(this.mgr.crowdDelayMs);

    // LOCK — freeze influence, hash config, publish oracle freeze + DCM listing stub.
    if (this.mgr.influence) this.mgr.influence.freezeAgents(agents.map((a) => a.id));
    const cfg = buildLockedConfig({
      tableId: this.id, matchNo: this.matchNo, seats: this.seats, lockedAt: Date.now(),
    });
    this.lockedConfig = cfg;
    this.phase = "locked";
    this.crowdCloseAt = null;
    if (this.mgr.oracle) this.mgr.oracle.recordLock(cfg);
    this.listing = marketListing({
      matchId: cfg.matchId, tableId: this.id, matchNo: this.matchNo,
      seats: cfg.seats, lockedConfigHash: cfg.lockedConfigHash,
      oracle: this.mgr.oracle ? this.mgr.oracle.get(cfg.matchId) : null,
    });
    if (this.mgr.oracle) this.mgr.oracle.recordMarket(cfg.matchId, this.listing);
    this.broadcast({ type: "lock", ...this.publicState(), lockedConfig: cfg });
    this.mgr.notifyLobby();

    // MARKET — trading open; tips closed. Short window before the deal.
    this.phase = "market";
    this.marketCloseAt = Date.now() + this.mgr.marketDelayMs;
    this.broadcast({ type: "phase", ...this.publicState() });
    this.mgr.notifyLobby();
    await this.mgr.sleep(this.mgr.marketDelayMs);

    this.phase = "playing";
    this.marketCloseAt = null;
    this.broadcast({ type: "phase", ...this.publicState() });
    this.mgr.notifyLobby();

    const { turnDelayMs, revealDelayMs, dealDelayMs } = this.mgr;
    const result = await runMatch({
      agents, credits: this.mgr.credits, ante: this.mgr.ante, seed: Date.now(),
      influence: this.mgr.influence, freezeInfluence: true,
      onEvent: async (ev) => {
        this.broadcast(ev);
        if (ev.type === "turn") await this.mgr.sleep(turnDelayMs);
        else if (ev.type === "reveal") await this.mgr.sleep(revealDelayMs);
        else if (ev.type === "hand_start") await this.mgr.sleep(dealDelayMs);
        else if (ev.type === "ante") await this.mgr.sleep(200);
      },
    });

    if (result.winnerId && !result.aborted) {
      this.mgr.stats.recordMatch({
        matchNo: this.matchNo, seats: this.seats, winnerId: result.winnerId, potTotal: result.potTotal,
        ante: this.mgr.ante, log: result.log, seed: result.seed, tableId: this.id, unit: "credits",
      });
    }

    const oracleRow = this.mgr.oracle
      ? this.mgr.oracle.settle(this.matchId, {
        winnerAgentId: result.winnerId || null,
        winnerName: result.winnerName || null,
        aborted: !!result.aborted,
        seed: result.seed,
      })
      : null;
    if (this.listing) {
      this.listing = { ...this.listing, oracle: oracleRow, settled: true };
    }

    if (this.mgr.influence) {
      this.mgr.influence.resetAgents(agents.map((a) => a.id));
    }

    this.phase = "settled";
    this.broadcast({
      type: "match_over", winnerId: result.winnerId || null, winnerName: result.winnerName || null,
      aborted: !!result.aborted, potTotal: result.potTotal, unit: "credits",
      oracle: oracleRow,
      ...this.publicState(),
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
    this.credits = opts.credits;
    this.influence = opts.influence || null;
    this.oracle = opts.oracle || null;
    this.instantiate = opts.instantiate;
    this.ensureWallet = opts.ensureWallet;
    this.ante = opts.ante;
    this.tableSize = opts.tableSize;
    this.liveChain = opts.liveChain;
    this.crowdDelayMs = opts.crowdDelayMs ?? opts.startDelayMs ?? 4000;
    this.marketDelayMs = opts.marketDelayMs ?? 4000;
    this.startDelayMs = this.crowdDelayMs;
    this.turnDelayMs = opts.turnDelayMs;
    this.revealDelayMs = opts.revealDelayMs;
    this.dealDelayMs = opts.dealDelayMs;
    this.settlePauseMs = opts.settlePauseMs ?? 8000;
    this.errorPauseMs = opts.errorPauseMs ?? 15000;
    this.waitingMs = opts.waitingMs ?? 5000;
    this.staggerMs = opts.staggerMs ?? 4000;
    this.sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.minTip = opts.minTip;
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
    return this.tables.find((t) => t.phase === "playing")
      || this.tables.find((t) => t.phase === "market")
      || this.tables.find((t) => t.phase === "crowd")
      || this.tables.find((t) => t.phase === "locked")
      || this.tables[0];
  }

  clientCount() {
    let n = this.lobbyClients.size;
    for (const t of this.tables) n += t.clients.size;
    return n;
  }

  health() {
    return this.tables.map((t) => ({
      id: t.id, phase: t.phase, matchNo: t.matchNo, matchId: t.matchId, clients: t.clients.size,
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
    const recs = this.registry.pickSeats(this.tableSize, {
      eligible: () => true,
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
      if (this.influence) {
        const book = this.influence;
        const aid = rec.id;
        ag.influenceOf = () => book.snapshot(aid);
      }
      if (this.credits) this.credits.ensure(rec.id);
      agents.push(ag);
    }
    this.registry.markPlayed(recs.map((r) => r.id));
    table.busyIds = recs.filter((r) => !r.house).map((r) => r.id);
    return agents;
  }

  async reviewSeats() {
    // Credits auto-refill; agents are not sidelined for a USDC seat floor.
  }

  findTableFeaturing(agentId, tableId) {
    if (tableId) return this.get(tableId);
    if (agentId) return this.tables.find((t) => t.seats.some((s) => s.id === agentId)) || null;
    return this.featured();
  }

  async start() {
    this.tables.forEach((t, i) => {
      this.sleep(i * this.staggerMs).then(() => t.cycle()).catch((e) => {
        console.error(`table ${t.id} cycle crashed:`, e);
      });
    });
  }
}

module.exports = {
  Table, TableManager, Mutex, TABLE_ID_RE,
  communityBusyIds, filterTableSummaries,
};
