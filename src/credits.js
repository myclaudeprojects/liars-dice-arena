// credits.js — Arena Credit ledger.
//
// Arena Credits are play money. This module has no deposit, withdrawal,
// transfer, wallet, or crypto conversion. Every balance change is an entry.
// postAll applies a batch or restores the previous ledger. A duplicate
// idempotency key returns the original entry and does not move the balance.

const { round4 } = require("./lmsr");

const LEDGER_TYPES = [
  "INITIAL_GRANT",
  "OPENING_BALANCE",
  "TRADE_BUY",
  "TRADE_SELL",
  "MARKET_SETTLEMENT",
  "MARKET_VOID_REFUND",
  "TEST_ADMIN_ADJUSTMENT",
];

class CreditLedger {
  constructor() {
    this.entries = [];
    this.balances = new Map();
    this.seen = new Map();
    this.seq = 0;
    this.failOnPost = 0;
  }

  balance(userId) {
    return this.balances.get(String(userId)) || 0;
  }

  sum(userId) {
    let n = 0;
    for (const e of this.entries) {
      if (e.userId === String(userId)) n = round4(n + e.amount);
    }
    return n;
  }

  exportState() {
    return {
      entries: this.entries.map((e) => ({ ...e })),
      seq: this.seq,
      seen: [...this.seen.entries()],
    };
  }

  importState(data) {
    this.entries = Array.isArray(data?.entries) ? data.entries.map((e) => ({ ...e })) : [];
    this.seq = Number(data?.seq) || this.entries.length;
    this.seen = new Map(Array.isArray(data?.seen) ? data.seen : []);
    this.balances = new Map();
    for (const e of this.entries) {
      const next = round4((this.balances.get(e.userId) || 0) + e.amount);
      this.balances.set(e.userId, next);
      e.balanceAfter = next;
    }
  }

  _entryById(id) {
    return this.entries.find((e) => e.id === id) || null;
  }

  post(row) {
    if (this.failOnPost > 0) {
      this.failOnPost -= 1;
      if (this.failOnPost === 0) {
        const err = new Error("forced_failure");
        err.code = "forced_failure";
        throw err;
      }
    }
    const userId = String(row.userId || "");
    if (!userId) {
      const err = new Error("bad_account");
      err.code = "bad_account";
      throw err;
    }
    const type = String(row.type || "");
    if (!LEDGER_TYPES.includes(type)) {
      const err = new Error("bad_ledger_type");
      err.code = "bad_ledger_type";
      throw err;
    }
    const key = row.idempotencyKey ? String(row.idempotencyKey) : "";
    if (key && this.seen.has(key)) return this._entryById(this.seen.get(key));
    const amt = round4(row.amount);
    const allowZero = !!row.allowZero;
    if (!Number.isFinite(amt) || (amt === 0 && !allowZero)) {
      const err = new Error("bad_amount");
      err.code = "bad_amount";
      throw err;
    }
    const next = round4(this.balance(userId) + amt);
    if (next < -1e-9) {
      const err = new Error("insufficient_credits");
      err.code = "insufficient_credits";
      throw err;
    }
    const entry = {
      id: `led_${++this.seq}`,
      userId,
      amount: amt,
      balanceAfter: next,
      type,
      referenceType: row.referenceType || null,
      referenceId: row.referenceId == null ? null : String(row.referenceId),
      createdAt: row.createdAt || Date.now(),
    };
    this.entries.push(entry);
    this.balances.set(userId, next);
    if (key) this.seen.set(key, entry.id);
    return entry;
  }

  postAll(rows) {
    const snap = this.exportState();
    const out = [];
    try {
      for (const row of rows) out.push(this.post(row));
      return out;
    } catch (e) {
      this.importState(snap);
      throw e;
    }
  }
}

module.exports = { CreditLedger, LEDGER_TYPES };
