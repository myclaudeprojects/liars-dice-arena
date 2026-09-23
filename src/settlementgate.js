// settlementgate.js — The only door a market may use to settle.
//
// Callers pass an integrity record and a signed oracle payload. This module
// does not read GameService, the event log, dice, wallets, or Arena Credit
// balances. It does not move credits. The market PR decides whether to pay,
// void, or wait, using the action returned here.
//
//   settle  integrity VALID, signature verifies, market is locked
//   wait    pending, validating, under review, or signature not ready
//   void    integrity INVALID or VOID
//
// A revoked signing key blocks settlement (wait) and does not invent a winner.
// settlementKey = matchId + ":" + oracle result hash. A second commit with
// the same key returns the first decision and pays nothing again.
//
// Play money only. There is no deposit, withdrawal, or asset conversion here.

const { coded } = require("./canonical");

function evaluateSettlementGate({ integrity, oracle, marketStatus, signatureCheck = null } = {}) {
  const reasons = [];
  const status = integrity && integrity.status;
  const gameStatus = integrity && integrity.gameStatus;
  if (!integrity) {
    return { action: "wait", errorCode: "MATCH_NOT_READY", settlementKey: null, duplicate: false, reasons: ["no integrity record"] };
  }
  if (status === "INVALID" || status === "VOID") {
    return {
      action: "void",
      errorCode: status === "VOID" ? "MATCH_ABORTED" : (integrity.errorCode || "MATCH_INTEGRITY_INVALID"),
      settlementKey: null,
      duplicate: false,
      reasons: [status],
    };
  }
  if (status === "UNDER_REVIEW" || status === "PENDING" || status === "VALIDATING" || !status) {
    return {
      action: "wait",
      errorCode: status === "UNDER_REVIEW" ? (integrity.errorCode || "UNDER_REVIEW") : "MATCH_NOT_READY",
      settlementKey: null,
      duplicate: false,
      reasons: [status || "PENDING"],
    };
  }
  if (status !== "VALID") {
    return { action: "wait", errorCode: "MATCH_NOT_READY", settlementKey: null, duplicate: false, reasons: [status] };
  }
  if (gameStatus !== "RESOLVED") {
    reasons.push("game_status");
    return { action: "wait", errorCode: "MATCH_NOT_READY", settlementKey: null, duplicate: false, reasons };
  }
  if (!oracle || !oracle.signature || !oracle.resultHash) {
    return { action: "wait", errorCode: "RESULT_SIGNATURE_FAILED", settlementKey: null, duplicate: false, reasons: ["unsigned"] };
  }
  if (oracle.integrityStatus !== "VALID") {
    return { action: "void", errorCode: "MATCH_INTEGRITY_INVALID", settlementKey: null, duplicate: false, reasons: ["oracle integrity"] };
  }
  if (oracle.realMoney !== false || oracle.cashValue !== 0) {
    return { action: "void", errorCode: "MATCH_INTEGRITY_INVALID", settlementKey: null, duplicate: false, reasons: ["not play money"] };
  }
  const sig = signatureCheck || (
    integrity.signatureValid === false
      ? { ok: false, code: integrity.signatureError || "RESULT_SIGNATURE_FAILED" }
      : null
  );
  if (sig && sig.ok === false) {
    const code = sig.code || "RESULT_SIGNATURE_FAILED";
    if (code === "SIGNING_KEY_REVOKED") {
      return { action: "wait", errorCode: code, settlementKey: null, duplicate: false, reasons: [code] };
    }
    return { action: "void", errorCode: code, settlementKey: null, duplicate: false, reasons: [code] };
  }
  if (!sig && integrity.signatureValid !== true) {
    return { action: "wait", errorCode: "RESULT_SIGNATURE_FAILED", settlementKey: null, duplicate: false, reasons: ["signature not checked"] };
  }
  const locked = marketStatus === "locked" || marketStatus === "AWAITING_RESULT" || marketStatus === "awaiting_result";
  if (!locked) {
    return {
      action: "wait",
      errorCode: "MARKET_LOCK_VIOLATION",
      settlementKey: null,
      duplicate: false,
      reasons: ["market " + (marketStatus || "missing")],
    };
  }
  if (integrity.configurationHash && oracle.configurationHash && integrity.configurationHash !== oracle.configurationHash) {
    return { action: "void", errorCode: "CONFIG_HASH_MISMATCH", settlementKey: null, duplicate: false, reasons: ["config"] };
  }
  const settlementKey = String(oracle.matchId) + ":" + String(oracle.resultHash);
  return { action: "settle", errorCode: null, settlementKey, duplicate: false, reasons };
}

class SettlementGate {
  constructor() {
    this.applied = new Map();
  }

  decide(input) {
    return evaluateSettlementGate(input);
  }

  // Record a settle decision once. Wait and void are not stored as payments.
  commit(input) {
    const decision = evaluateSettlementGate(input);
    if (decision.action !== "settle") return decision;
    const prior = this.applied.get(decision.settlementKey);
    if (prior) {
      return { ...decision, duplicate: true, prior };
    }
    const row = { settlementKey: decision.settlementKey, at: Date.now(), matchId: input.oracle.matchId };
    this.applied.set(decision.settlementKey, row);
    return { ...decision, duplicate: false };
  }

  // Markets must not ask this module to move credits. The method exists so a
  // mistaken call fails loudly instead of paying.
  pay() {
    throw coded("SETTLEMENT_GATE_DOES_NOT_PAY");
  }
}

module.exports = { evaluateSettlementGate, SettlementGate };
