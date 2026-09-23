// matchconfig.js — Immutable competitive snapshot for one match.
//
// The hash covers rules, engine versions, and agent sheets. It does not
// cover the RNG seed. Crowd tips and creator sliders are not a live system;
// the snapshot records that none were applied, so a later tip cannot change
// a frozen match.

const { character } = require("./characters");
const { canonicalJson, sha256Prefixed, coded } = require("./canonical");
const {
  GAME_ENGINE_VERSION,
  RULES_VERSION,
  RNG_ALGORITHM_VERSION,
  AGENT_ENGINE_VERSION,
  MARKET_LOCK_POLICY_VERSION,
} = require("./versions");

function agentSnapshot(agentId, lookup) {
  const c = typeof lookup === "function" ? lookup(agentId) : character(agentId);
  const strategy = {
    aggression: c.aggression,
    chaos: c.chaos,
    style: c.style,
  };
  const persona = {
    archetype: c.archetype,
    line: c.line,
    strength: c.strength,
    weakness: c.weakness,
  };
  const strategyHash = sha256Prefixed(canonicalJson(strategy));
  const promptHash = sha256Prefixed(canonicalJson({
    kind: "heuristic-sheet",
    persona,
  }));
  const configuration = {
    strategy,
    persona,
    modelProvider: "internal",
    modelVersion: AGENT_ENGINE_VERSION,
  };
  const configurationHash = sha256Prefixed(canonicalJson(configuration));
  const memory = {
    agentId: c.id,
    memorySnapshotId: "mem-stateless",
    memoryHash: sha256Prefixed(canonicalJson({
      kind: "stateless-heuristic",
      strategyHash,
    })),
    includedThroughMatchId: null,
  };
  return {
    agentId: c.id,
    agentVersionId: c.id + "-v1",
    modelProvider: "internal",
    modelVersion: AGENT_ENGINE_VERSION,
    strategyVersion: "strategy-v1",
    personalityVersion: "persona-v1",
    promptHash,
    strategyHash,
    configurationHash,
    memory,
  };
}

function buildCompetitiveConfig({ matchId, seats, scheduledAt, lookup }) {
  if (!matchId) throw coded("MATCH_ID_REQUIRED");
  if (!Array.isArray(seats) || seats.length < 2) throw coded("NEED_AGENTS");
  const agents = seats.map((s) => agentSnapshot(s.id, lookup));
  return {
    matchId: String(matchId),
    game: "LIARS_DICE",
    gameEngineVersion: GAME_ENGINE_VERSION,
    rulesVersion: RULES_VERSION,
    agentEngineVersion: AGENT_ENGINE_VERSION,
    scheduledAt: scheduledAt || null,
    agents,
    startingDice: 5,
    maxRounds: null,
    wildOnes: true,
    timeouts: { decisionTimeoutMs: null },
    rngAlgorithmVersion: RNG_ALGORITHM_VERSION,
    marketLockPolicyVersion: MARKET_LOCK_POLICY_VERSION,
    crowdInfluence: { applied: false },
  };
}

function configurationHash(config) {
  return sha256Prefixed(canonicalJson(config));
}

class MatchConfigStore {
  constructor(opts = {}) {
    this.rows = new Map();
    this.audit = [];
    this.lookup = opts.lookup || null;
  }

  freeze({ matchId, seats, frozenBy = "show", scheduledAt = null, now = Date.now() }) {
    const id = String(matchId);
    const existing = this.rows.get(id);
    if (existing && existing.locked) throw coded("MATCH_CONFIGURATION_LOCKED");
    const config = buildCompetitiveConfig({ matchId: id, seats, scheduledAt, lookup: this.lookup });
    const canonical = canonicalJson(config);
    const hash = sha256Prefixed(canonical);
    const row = {
      matchId: id,
      version: 1,
      config,
      canonicalJson: canonical,
      configurationHash: hash,
      frozenAt: now,
      frozenBy: String(frozenBy || "show"),
      isActive: true,
      locked: true,
    };
    this.rows.set(id, row);
    this._audit({
      action: "MATCH_CONFIGURATION_FROZEN",
      matchId: id,
      after: { configurationHash: hash },
      at: now,
    });
    return row;
  }

  require(matchId) {
    const row = this.rows.get(String(matchId || ""));
    if (!row) throw coded("MATCH_CONFIG_MISSING");
    return row;
  }

  // Material edits after freeze are rejected and audited. The stored
  // snapshot is left as it was.
  rejectChange(matchId, patch, actor = "admin") {
    const row = this.require(matchId);
    if (!row.locked) return row;
    this._audit({
      action: "MATCH_CONFIGURATION_LOCKED",
      matchId: row.matchId,
      actor,
      attempted: patch || null,
      at: Date.now(),
    });
    throw coded("MATCH_CONFIGURATION_LOCKED");
  }

  _audit(entry) {
    this.audit.push({ id: "aud_" + (this.audit.length + 1), ...entry });
  }

  exportState() {
    return {
      rows: [...this.rows.values()],
      audit: this.audit,
    };
  }

  importState(data) {
    this.rows = new Map();
    this.audit = Array.isArray(data && data.audit) ? data.audit.slice() : [];
    for (const row of (data && data.rows) || []) {
      if (row && row.matchId) this.rows.set(String(row.matchId), row);
    }
  }
}

module.exports = {
  agentSnapshot,
  buildCompetitiveConfig,
  configurationHash,
  MatchConfigStore,
};
