// oracle.js — Canonical signed result. No gameplay, no credit movement.
//
// The signed body is the match result. `signature` and `resultHash` are
// attached after the hash so they are not part of the preimage. Arena
// Credits only: the payload says realMoney false and cashValue 0.

const { canonicalJson, sha256Prefixed, coded } = require("./canonical");
const {
  ORACLE_PAYLOAD_VERSION,
  SIGNING_ALGORITHM,
  WINNING_MARGIN_VERSION,
  MATCH_DURATION_VERSION,
} = require("./versions");

const HASH_OMIT = new Set(["signature", "resultHash", "publicKeyPem"]);

function hashOracleBody(payload) {
  const body = {};
  for (const key of Object.keys(payload || {})) {
    if (HASH_OMIT.has(key)) continue;
    body[key] = payload[key];
  }
  return sha256Prefixed(canonicalJson(body));
}

function buildOracleBody(input) {
  const rng = input.rng || {};
  return {
    version: ORACLE_PAYLOAD_VERSION,
    matchId: String(input.matchId),
    game: "LIARS_DICE",
    status: "RESOLVED",
    integrityStatus: input.integrityStatus || "VALID",
    configurationHash: input.configurationHash,
    rng: {
      algorithmVersion: rng.algorithmVersion,
      commitment: rng.commitment,
      seedReveal: rng.seedReveal,
    },
    participants: (input.participants || []).map((p) => ({
      agentId: p.agentId,
      agentVersionId: p.agentVersionId,
      configurationHash: p.configurationHash,
    })),
    winnerId: input.winnerId,
    rounds: input.rounds,
    startTimestamp: input.startTimestamp ?? null,
    endTimestamp: input.endTimestamp ?? null,
    durationMs: input.durationMs ?? null,
    durationMetric: MATCH_DURATION_VERSION,
    winningMarginMetric: WINNING_MARGIN_VERSION,
    eventLogHash: input.eventLogHash,
    finalStateHash: input.finalStateHash,
    signingKeyId: input.signingKeyId,
    algorithm: SIGNING_ALGORITHM,
    unit: "test-credits",
    cashValue: 0,
    realMoney: false,
  };
}

class OracleService {
  constructor(keys) {
    if (!keys) throw coded("ORACLE_KEY_MISSING");
    this.keys = keys;
  }

  // Hash and sign a resolved match. Does not read the game engine.
  sign(input) {
    const key = this.keys.active();
    if (!key) throw coded("ORACLE_KEY_MISSING");
    const body = buildOracleBody({ ...input, signingKeyId: key.id });
    const resultHash = hashOracleBody(body);
    const signed = this.keys.sign(resultHash);
    return {
      ...body,
      resultHash,
      signature: signed.signature,
      signingKeyId: signed.signingKeyId,
      algorithm: SIGNING_ALGORITHM,
      publicKeyPem: signed.publicKeyPem,
    };
  }

  verify(payload) {
    if (!payload || !payload.resultHash || !payload.signature || !payload.signingKeyId) {
      return { ok: false, code: "RESULT_SIGNATURE_FAILED" };
    }
    const recomputed = hashOracleBody(payload);
    if (recomputed !== payload.resultHash) {
      return { ok: false, code: "RESULT_SIGNATURE_FAILED", reason: "hash" };
    }
    const checked = this.keys.verify(payload.signingKeyId, payload.resultHash, payload.signature);
    if (!checked.ok) return checked;
    if (payload.realMoney !== false || payload.cashValue !== 0) {
      return { ok: false, code: "RESULT_SIGNATURE_FAILED", reason: "not_play_money" };
    }
    return { ok: true, code: null, status: checked.status, resultHash: payload.resultHash };
  }
}

module.exports = { HASH_OMIT, hashOracleBody, buildOracleBody, OracleService };
