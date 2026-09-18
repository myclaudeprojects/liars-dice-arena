// lifecycle.js — Phased match architecture.
//
// BUILD (agent register) → CROWD (pre-lock influence tips) → LOCK (freeze
// config, disable tips) → MARKET (native WHO WINS UI; partner DCM lists) →
// MATCH (Arena Credits) → SETTLEMENT (verifiable oracle for the DCM).
//
// LDA is not the exchange. The partner DCM owns listing, order book,
// eligibility/KYC, collateral, execution, clearing, and surveillance.
// LDA never custodies prediction USDC and never pays winners from losers.

const crypto = require("crypto");
const { dcmListing } = require("./market");

const PHASES = Object.freeze([
  "idle", "waiting", "crowd", "locked", "market", "playing", "settled", "paused",
]);

function matchIdFor(tableId, matchNo) {
  return `lda:${tableId}:${Number(matchNo)}`;
}

function parseMatchId(id) {
  const m = /^lda:(t-\d+):(\d+)$/.exec(String(id || ""));
  if (!m) return null;
  return { tableId: m[1], matchNo: Number(m[2]) };
}

function tipsOpen(phase) {
  return String(phase) === "crowd";
}

function bookVisible(phase) {
  const p = String(phase);
  return p === "locked" || p === "market" || p === "playing" || p === "settled";
}

function marketOpen(phase) {
  return bookVisible(phase);
}

function assertTipsOpen(phase) {
  if (!tipsOpen(phase)) {
    throw new Error("Tips are only open in the crowd phase, before lock. No paid influence after lock or while the market is open.");
  }
}

function canonicalSeats(seats) {
  return (seats || []).map((s) => ({
    id: s.id,
    name: s.name || null,
    owner: s.owner || null,
    ownerAddress: s.ownerAddress || s.creatorAddress || null,
    personaTag: s.personaTag || null,
    aggression: s.aggression != null ? Number(s.aggression) : null,
    influence: s.influence ? {
      weights: s.influence.weights || null,
      dominant: s.influence.dominant || null,
      total: s.influence.total || 0,
    } : null,
  })).sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function hashPayload(obj) {
  const json = JSON.stringify(obj);
  return crypto.createHash("sha256").update(json).digest("hex");
}

function buildLockedConfig({ tableId, matchNo, seats, lockedAt = Date.now() }) {
  const matchId = matchIdFor(tableId, matchNo);
  const canonical = {
    matchId, tableId, matchNo,
    lockedAt,
    seats: canonicalSeats(seats),
  };
  const lockedConfigHash = hashPayload(canonical);
  return {
    matchId, tableId, matchNo, lockedAt, lockedConfigHash,
    seats: canonical.seats,
    publish: {
      kind: "hash",
      status: "signed_local",
      note: "TODO(chain): optionally publish this hash on Arc. The DCM should treat lockedConfigHash as the official freeze.",
    },
    tipsOpen: false,
    entitlesWinnings: false,
    unit: "credits",
  };
}

function marketListing(opts) {
  return dcmListing(opts);
}

class OracleBook {
  constructor() {
    this.byId = new Map();
  }

  _row(matchId) {
    const k = String(matchId);
    if (!this.byId.has(k)) {
      this.byId.set(k, {
        matchId: k, tableId: null, matchNo: null,
        phase: "crowd",
        lockedAt: null, lockedConfigHash: null, lockedConfig: null,
        seats: [],
        winnerAgentId: null, winnerName: null,
        settledAt: null, aborted: false, seed: null,
        unit: "credits",
        custody: false,
        firstParty: false,
        ldaIsTheExchange: false,
        ldaPaysWinnersFromLosers: false,
        tokenHoldersDoNotEarn: true,
        oracleVersion: 1,
      });
    }
    return this.byId.get(k);
  }

  recordLock(cfg) {
    const row = this._row(cfg.matchId);
    Object.assign(row, {
      tableId: cfg.tableId, matchNo: cfg.matchNo,
      phase: "locked",
      lockedAt: cfg.lockedAt,
      lockedConfigHash: cfg.lockedConfigHash,
      lockedConfig: cfg,
      seats: cfg.seats,
    });
    return this.publicView(row);
  }

  recordMarket(matchId, listing) {
    const row = this._row(matchId);
    row.phase = row.winnerAgentId ? row.phase : "market";
    row.market = listing;
    return this.publicView(row);
  }

  settle(matchId, { winnerAgentId, winnerName, aborted = false, seed = null, settledAt = Date.now() } = {}) {
    const row = this._row(matchId);
    row.phase = "settled";
    row.winnerAgentId = winnerAgentId || null;
    row.winnerName = winnerName || null;
    row.aborted = !!aborted;
    row.seed = seed;
    row.settledAt = settledAt;
    return this.publicView(row);
  }

  get(matchId) {
    const row = this.byId.get(String(matchId));
    return row ? this.publicView(row) : null;
  }

  list({ tableId, limit = 50 } = {}) {
    let rows = [...this.byId.values()];
    if (tableId) rows = rows.filter((r) => r.tableId === tableId);
    rows.sort((a, b) => (b.settledAt || b.lockedAt || 0) - (a.settledAt || a.lockedAt || 0));
    return rows.slice(0, limit).map((r) => this.publicView(r));
  }

  publicView(row) {
    return {
      matchId: row.matchId,
      tableId: row.tableId,
      matchNo: row.matchNo,
      phase: row.phase,
      lockedAt: row.lockedAt,
      lockedConfigHash: row.lockedConfigHash,
      lockedConfig: row.lockedConfig || null,
      seats: row.seats,
      winnerAgentId: row.winnerAgentId,
      winnerName: row.winnerName,
      settledAt: row.settledAt,
      timestamp: row.settledAt || row.lockedAt || null,
      aborted: !!row.aborted,
      seed: row.seed,
      unit: "credits",
      custody: false,
      firstParty: false,
      ldaIsTheExchange: false,
      ldaPaysWinnersFromLosers: false,
      tokenHoldersDoNotEarn: true,
      market: row.market || null,
      oracleVersion: 1,
    };
  }
}

module.exports = {
  PHASES,
  matchIdFor, parseMatchId, tipsOpen, bookVisible, marketOpen, assertTipsOpen,
  canonicalSeats, hashPayload, buildLockedConfig, marketListing,
  OracleBook,
};
