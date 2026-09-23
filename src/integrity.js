// integrity.js — Match integrity state machine.
//
// PENDING → VALIDATING → VALID | UNDER_REVIEW | INVALID | VOID
//
// Gameplay and the test-credit book are not this service. It freezes config,
// commits randomness, replays the event log, and asks OracleService to sign
// when every check passes. A failed check does not pick a winner.

const { coded } = require("./canonical");
const { MatchConfigStore, configurationHash, agentSnapshot } = require("./matchconfig");
const {
  generateRootSeed,
  commitmentFor,
  sealSeed,
  openSeed,
  replayDice,
} = require("./randomness");
const { validateAndReplay, eventLogHash } = require("./eventlog");
const {
  RNG_ALGORITHM_VERSION,
  VERIFIER_VERSION,
  RULES_VERSION,
} = require("./versions");

const STATUSES = ["PENDING", "VALIDATING", "VALID", "UNDER_REVIEW", "INVALID", "VOID"];

function checkRow(matchId, type, status, extra = {}) {
  return {
    matchId,
    checkType: type,
    checkVersion: VERIFIER_VERSION,
    status,
    expectedValue: extra.expected == null ? null : extra.expected,
    actualValue: extra.actual == null ? null : extra.actual,
    errorCode: extra.code || null,
    evidence: extra.evidence || null,
    checkedAt: extra.at || new Date().toISOString(),
  };
}

class MatchIntegrity {
  constructor(opts = {}) {
    if (!opts.oracle) throw coded("ORACLE_REQUIRED");
    this.oracle = opts.oracle;
    this.env = opts.env || process.env;
    this.configs = new MatchConfigStore();
    this.matches = new Map();
    this.audit = [];
  }

  // Freeze config, then generate the seed and publish only the commitment.
  prepare({ matchId, seats, frozenBy = "show", scheduledAt = null, now = Date.now(), rootSeed = null }) {
    const id = String(matchId);
    if (this.matches.has(id)) throw coded("MATCH_EXISTS");
    const frozen = this.configs.freeze({ matchId: id, seats, frozenBy, scheduledAt, now });
    const rootBuf = rootSeed
      ? (Buffer.isBuffer(rootSeed) ? rootSeed : Buffer.from(String(rootSeed), "hex"))
      : generateRootSeed();
    if (rootBuf.length !== 32) throw coded("RNG_SEED_INVALID");
    const rootHex = rootBuf.toString("hex");
    const commitment = commitmentFor(rootBuf);
    const record = {
      matchId: id,
      status: "PENDING",
      gameStatus: "SCHEDULED",
      configurationHash: frozen.configurationHash,
      rulesVersion: RULES_VERSION,
      rng: {
        algorithmVersion: RNG_ALGORITHM_VERSION,
        commitment,
        sealedSeed: sealSeed(rootBuf, this.env),
        revealedSeed: null,
        revealedAt: null,
        sequenceCount: null,
        commitmentVerified: null,
        replayVerified: null,
      },
      checks: [],
      eventLogHash: null,
      finalStateHash: null,
      finalState: null,
      winnerId: null,
      rounds: null,
      startedAt: null,
      endedAt: null,
      errorCode: null,
      oracle: null,
      signatureValid: null,
      createdAt: now,
      manualOverrideEnabled: false,
    };
    this.matches.set(id, record);
    this._audit("RNG_COMMITMENT_CREATED", id, { commitment });
    return {
      matchId: id,
      configurationHash: frozen.configurationHash,
      rngCommitment: commitment,
      rngAlgorithmVersion: RNG_ALGORITHM_VERSION,
      rootSeed: rootHex,
      status: "PENDING",
    };
  }

  rejectChange(matchId, patch, actor) {
    return this.configs.rejectChange(matchId, patch, actor);
  }

  // Server-side resume. Not a public view.
  exportSeed(matchId) {
    const row = this.matches.get(String(matchId || ""));
    if (!row) return null;
    if (row.rng.revealedSeed) return row.rng.revealedSeed;
    try { return openSeed(row.rng.sealedSeed, this.env); }
    catch { return null; }
  }

  assertCanStart(matchId) {
    const row = this.matches.get(String(matchId || ""));
    if (!row) throw coded("MATCH_CONFIG_MISSING");
    const frozen = this.configs.require(matchId);
    if (!frozen.locked) throw coded("MATCH_CONFIG_MISSING");
    if (configurationHash(frozen.config) !== frozen.configurationHash) {
      throw coded("CONFIG_HASH_MISMATCH");
    }
    if (row.configurationHash !== frozen.configurationHash) throw coded("CONFIG_HASH_MISMATCH");
    const root = this.exportSeed(matchId);
    if (!root || commitmentFor(root) !== row.rng.commitment) throw coded("RNG_COMMITMENT_MISMATCH");
    if (row.status === "VOID" || row.status === "INVALID") throw coded("MATCH_INTEGRITY_INVALID");
    return true;
  }

  // Dev/test hook. Ignored when NODE_ENV=production so a deployed process
  // cannot be told to fake a review.
  _faultAllowed(fault) {
    if (!fault) return null;
    if (this.env && this.env.NODE_ENV === "production") return null;
    return fault;
  }

  finalize({ matchId, log, winnerId, startedAt = null, endedAt = null, fault = null }) {
    const row = this.matches.get(String(matchId || ""));
    if (!row) throw coded("MATCH_CONFIG_MISSING");
    if (row.status === "VALID" || row.status === "INVALID" || row.status === "VOID") return this._view(row);
    row.status = "VALIDATING";
    row.gameStatus = "RESOLVED";
    row.startedAt = startedAt;
    row.endedAt = endedAt;
    row.checks = [];
    const at = new Date().toISOString();
    try {
      const frozen = this.configs.require(matchId);
      const configOk = configurationHash(frozen.config) === frozen.configurationHash
        && row.configurationHash === frozen.configurationHash;
      row.checks.push(checkRow(row.matchId, "configuration_hash", configOk ? "PASS" : "FAIL", {
        code: configOk ? null : "CONFIG_HASH_MISMATCH",
        expected: row.configurationHash,
        actual: configurationHash(frozen.config),
        at,
      }));

      let agentsOk = true;
      let agentActual = null;
      for (const agent of frozen.config.agents) {
        let fresh;
        try { fresh = agentSnapshot(agent.agentId); }
        catch { fresh = null; }
        if (!fresh || fresh.configurationHash !== agent.configurationHash || fresh.agentVersionId !== agent.agentVersionId) {
          agentsOk = false;
          agentActual = fresh && fresh.configurationHash;
          break;
        }
      }
      row.checks.push(checkRow(row.matchId, "agent_version", agentsOk ? "PASS" : "FAIL", {
        code: agentsOk ? null : "AGENT_VERSION_MISMATCH",
        expected: "frozen agent configuration",
        actual: agentActual,
        at,
      }));

      let root = null;
      try { root = openSeed(row.rng.sealedSeed, this.env); }
      catch { root = null; }
      const commitOk = !!(root && commitmentFor(root) === row.rng.commitment);
      row.checks.push(checkRow(row.matchId, "rng_commitment", commitOk ? "PASS" : "FAIL", {
        code: commitOk ? null : "RNG_COMMITMENT_MISMATCH",
        expected: row.rng.commitment,
        actual: root ? commitmentFor(root) : null,
        at,
      }));

      const dice = commitOk
        ? replayDice({ rootSeed: root, algorithmVersion: row.rng.algorithmVersion, log })
        : { ok: false, code: "RNG_COMMITMENT_MISMATCH" };
      row.checks.push(checkRow(row.matchId, "rng_replay", dice.ok ? "PASS" : "FAIL", {
        code: dice.ok ? null : dice.code,
        expected: dice.ok ? dice.sequenceCount : null,
        actual: dice.ok ? dice.sequenceCount : (dice.actual == null ? null : dice.actual),
        at,
      }));
      row.rng.commitmentVerified = commitOk;
      row.rng.replayVerified = !!dice.ok;
      row.rng.sequenceCount = dice.ok ? dice.sequenceCount : null;
      if (root) {
        row.rng.revealedSeed = root;
        row.rng.revealedAt = at;
      }

      const replay = validateAndReplay(log, { wildOnes: frozen.config.wildOnes !== false, claimedWinnerId: winnerId });
      row.checks.push(checkRow(row.matchId, "event_sequence", replay.ok ? "PASS" : "FAIL", {
        code: replay.ok ? null : replay.code,
        expected: replay.ok ? replay.eventLogHash : null,
        actual: replay.eventLogHash || eventLogHash(log || []),
        evidence: replay.ok ? null : replay.detail,
        at,
      }));
      if (replay.ok) {
        row.eventLogHash = replay.eventLogHash;
        row.finalStateHash = replay.finalStateHash;
        row.finalState = replay.finalState;
        row.winnerId = replay.winnerId;
        row.rounds = replay.rounds;
      }

      const simulated = this._faultAllowed(fault);
      if (simulated === "review") {
        row.checks.push(checkRow(row.matchId, "simulated", "ERROR", {
          code: "SIMULATED_REVIEW",
          at,
        }));
      } else if (simulated === "invalid") {
        row.checks.push(checkRow(row.matchId, "simulated", "FAIL", {
          code: "SIMULATED_INVALID",
          at,
        }));
      }

      const failed = row.checks.filter((c) => c.status === "FAIL");
      const errors = row.checks.filter((c) => c.status === "ERROR");
      if (failed.length) {
        row.status = "INVALID";
        row.errorCode = failed[0].errorCode || "MATCH_INTEGRITY_INVALID";
        row.oracle = null;
        row.signatureValid = false;
        this._audit("MATCH_INTEGRITY_INVALID", row.matchId, { errorCode: row.errorCode });
        return this._view(row);
      }
      if (errors.length) {
        row.status = "UNDER_REVIEW";
        row.errorCode = errors[0].errorCode || "UNDER_REVIEW";
        row.oracle = null;
        row.signatureValid = null;
        return this._view(row);
      }

      const payload = this.oracle.sign({
        matchId: row.matchId,
        integrityStatus: "VALID",
        configurationHash: row.configurationHash,
        rng: {
          algorithmVersion: row.rng.algorithmVersion,
          commitment: row.rng.commitment,
          seedReveal: "hex:" + row.rng.revealedSeed,
        },
        participants: frozen.config.agents,
        winnerId: row.winnerId,
        rounds: row.rounds,
        startTimestamp: startedAt,
        endTimestamp: endedAt,
        durationMs: startedAt != null && endedAt != null ? Math.max(0, endedAt - startedAt) : null,
        eventLogHash: row.eventLogHash,
        finalStateHash: row.finalStateHash,
      });
      const verified = this.oracle.verify(payload);
      row.checks.push(checkRow(row.matchId, "result_signature", verified.ok ? "PASS" : "FAIL", {
        code: verified.ok ? null : (verified.code || "RESULT_SIGNATURE_FAILED"),
        at,
      }));
      if (!verified.ok) {
        row.status = "INVALID";
        row.errorCode = verified.code || "RESULT_SIGNATURE_FAILED";
        row.oracle = null;
        row.signatureValid = false;
        return this._view(row);
      }
      row.oracle = payload;
      row.signatureValid = true;
      row.status = "VALID";
      row.errorCode = null;
      this._audit("RESULT_SIGNED", row.matchId, { resultHash: payload.resultHash, signingKeyId: payload.signingKeyId });
      return this._view(row);
    } catch (e) {
      row.status = "UNDER_REVIEW";
      row.errorCode = e.code || "VERIFIER_ERROR";
      row.oracle = null;
      row.checks.push(checkRow(row.matchId, "verifier", "ERROR", { code: row.errorCode, evidence: e.message, at }));
      return this._view(row);
    }
  }

  // Re-run checks against a stored match. Does not sign a second result.
  reverify({ matchId, log, winnerId }) {
    const row = this.matches.get(String(matchId || ""));
    if (!row) return null;
    if (!row.rng.revealedSeed) return this.publicView(matchId);
    const dice = replayDice({
      rootSeed: row.rng.revealedSeed,
      algorithmVersion: row.rng.algorithmVersion,
      log,
    });
    const replay = validateAndReplay(log, {
      claimedWinnerId: winnerId || row.winnerId,
      expectedEventLogHash: row.eventLogHash,
    });
    const oracleOk = row.oracle ? this.oracle.verify(row.oracle) : { ok: false, code: "RESULT_SIGNATURE_FAILED" };
    return {
      ...this.publicView(matchId),
      replay: {
        commitmentVerified: commitmentFor(row.rng.revealedSeed) === row.rng.commitment,
        diceVerified: !!dice.ok,
        diceError: dice.ok ? null : dice.code,
        eventVerified: !!replay.ok,
        eventError: replay.ok ? null : replay.code,
        finalStateHash: replay.finalStateHash || null,
        finalStateMatches: !!(replay.ok && replay.finalStateHash === row.finalStateHash),
        signatureVerified: !!oracleOk.ok,
        signatureError: oracleOk.ok ? null : oracleOk.code,
        verifierVersion: VERIFIER_VERSION,
      },
    };
  }

  voidMatch(matchId, reason) {
    const row = this.matches.get(String(matchId || ""));
    if (!row) throw coded("MATCH_CONFIG_MISSING");
    if (row.status === "VALID") throw coded("MATCH_ALREADY_FINAL");
    row.status = "VOID";
    row.gameStatus = row.gameStatus === "RESOLVED" ? row.gameStatus : "ABORTED";
    row.errorCode = reason || "MATCH_ABORTED";
    row.oracle = null;
    this._audit("MATCH_VOIDED", row.matchId, { reason: row.errorCode });
    return this._view(row);
  }

  // Outcomes are not editable. The attempt is audited and refused.
  attemptOverride(matchId, patch, actor = "admin") {
    this._audit("MANUAL_OVERRIDE_ATTEMPT", String(matchId), { actor, attempted: patch || null });
    const row = this.matches.get(String(matchId || ""));
    if (row) row.manualOverrideEnabled = false;
    throw coded("MANUAL_OVERRIDE_DISABLED");
  }

  _audit(action, matchId, extra) {
    this.audit.push({
      id: "aud_" + (this.audit.length + 1),
      action,
      matchId,
      at: new Date().toISOString(),
      ...extra,
    });
    this.configs._audit({ action, matchId, at: Date.now(), ...extra });
  }

  _view(row) {
    return {
      matchId: row.matchId,
      status: row.status,
      gameStatus: row.gameStatus,
      configurationHash: row.configurationHash,
      rngCommitment: row.rng.commitment,
      rngAlgorithmVersion: row.rng.algorithmVersion,
      revealedSeed: row.rng.revealedSeed,
      eventLogHash: row.eventLogHash,
      finalStateHash: row.finalStateHash,
      finalState: row.finalState,
      winnerId: row.winnerId,
      rounds: row.rounds,
      errorCode: row.errorCode,
      oracle: row.oracle,
      signatureValid: row.signatureValid,
      checks: row.checks,
      sequenceCount: row.rng.sequenceCount,
    };
  }

  publicView(matchId) {
    const row = this.matches.get(String(matchId || ""));
    if (!row) return null;
    const key = row.oracle
      ? this.oracle.keys.publicRecord(this.oracle.keys.get(row.oracle.signingKeyId))
      : null;
    return {
      matchId: row.matchId,
      configurationHash: row.configurationHash,
      rngCommitment: row.rng.commitment,
      rngAlgorithmVersion: row.rng.algorithmVersion,
      rngSeedReveal: row.rng.revealedSeed ? "hex:" + row.rng.revealedSeed : null,
      eventLogHash: row.eventLogHash,
      finalStateHash: row.finalStateHash,
      resultHash: row.oracle ? row.oracle.resultHash : null,
      signature: row.oracle ? row.oracle.signature : null,
      signingKeyId: row.oracle ? row.oracle.signingKeyId : null,
      algorithm: row.oracle ? row.oracle.algorithm : null,
      publicKeyPem: key ? key.publicKeyPem : null,
      integrityStatus: row.status,
      gameStatus: row.gameStatus,
      winnerId: row.winnerId,
      rounds: row.rounds,
      errorCode: row.errorCode,
      cashValue: 0,
      realMoney: false,
      unit: "test-credits",
      verifierVersion: VERIFIER_VERSION,
    };
  }

  exportState() {
    return {
      matches: [...this.matches.values()],
      config: this.configs.exportState(),
      audit: this.audit,
      keys: this.oracle.keys.exportPublic(),
    };
  }

  importState(data) {
    if (!data) return;
    this.configs.importState(data.config || {});
    this.audit = Array.isArray(data.audit) ? data.audit.slice() : [];
    this.matches = new Map();
    for (const row of data.matches || []) {
      if (row && row.matchId) this.matches.set(String(row.matchId), row);
    }
    if (data.keys) this.oracle.keys.importPublic(data.keys);
  }
}

module.exports = { MatchIntegrity, STATUSES, checkRow };
