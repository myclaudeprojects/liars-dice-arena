// credits.js — Free, nonredeemable Arena Credits.
//
// Credits are a visual/strategic chip for matches. They are granted for free,
// never sold as a wager, and never redeemable for USDC. A credit pot is not
// a prize pool and is not funded by tips, tokens, or creators.

const fs = require("fs");
const path = require("path");
// Unused by the v1 USDC-seat money path. Kept as a library for tests.
const STARTING_CREDITS = 1000;
const DEFAULT_ANTE_CREDITS = 1;
function round6(x) { return Math.round(Number(x) * 1e6) / 1e6; }

const CREDITS_PATH = process.env.CREDITS_PATH || path.join(__dirname, "..", "data", "credits.json");

function load() {
  try { return JSON.parse(fs.readFileSync(CREDITS_PATH, "utf8")); }
  catch { return { balances: {}, granted: 0 }; }
}

function save(s) {
  fs.mkdirSync(path.dirname(CREDITS_PATH), { recursive: true });
  fs.writeFileSync(CREDITS_PATH, JSON.stringify(s));
}

class CreditBook {
  constructor({ starting = STARTING_CREDITS, persist = true } = {}) {
    this.starting = starting;
    this.persist = persist;
    this.s = persist ? load() : { balances: {}, granted: 0 };
    this.s.balances ||= {};
  }

  _save() { if (this.persist) save(this.s); }

  balance(id) {
    const k = String(id);
    if (this.s.balances[k] == null) {
      this.s.balances[k] = this.starting;
      this.s.granted += this.starting;
      this._save();
    }
    return this.s.balances[k];
  }

  ensure(id, min = DEFAULT_ANTE_CREDITS) {
    const have = this.balance(id);
    if (have >= min) return have;
    // Free refill — credits are not purchased.
    this.s.balances[String(id)] = this.starting;
    this.s.granted += this.starting - have;
    this._save();
    return this.starting;
  }

  debit(id, amount) {
    const amt = round6(amount);
    if (!(amt > 0)) throw new Error("bad_amount");
    this.ensure(id, amt);
    const have = this.balance(id);
    if (have < amt) throw new Error("insufficient_credits");
    this.s.balances[String(id)] = round6(have - amt);
    this._save();
    return this.s.balances[String(id)];
  }

  credit(id, amount) {
    const amt = round6(amount);
    if (!(amt > 0)) throw new Error("bad_amount");
    const have = this.balance(id);
    this.s.balances[String(id)] = round6(have + amt);
    this._save();
    return this.s.balances[String(id)];
  }

  snapshot(ids) {
    const out = {};
    for (const id of ids || []) out[id] = this.balance(id);
    return out;
  }
}

module.exports = { CreditBook, STARTING_CREDITS };
