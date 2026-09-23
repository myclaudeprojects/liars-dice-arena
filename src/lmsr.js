// lmsr.js — Logarithmic market scoring rule for test-mode event contracts.
//
// Prices are play-money probabilities. They do not touch the dice engine.
// Liquidity b stays inside the engine. Callers that render a market must not
// show b. Outstanding quantities q are virtual AMM state, not a user's shares.
// A user share balance is tracked separately and cannot go below zero.

const B_MIN = 50;
const B_MAX = 5000;
const DEFAULT_B = 500;

function round4(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

function assertLiquidity(b) {
  const n = Number(b);
  if (!Number.isFinite(n) || n < B_MIN || n > B_MAX) {
    const err = new Error("bad_liquidity");
    err.code = "bad_liquidity";
    throw err;
  }
  return n;
}

function clampLiquidity(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_B;
  return Math.min(B_MAX, Math.max(B_MIN, n));
}

function logSumExp(values) {
  let max = -Infinity;
  for (const v of values) {
    if (v > max) max = v;
  }
  if (!Number.isFinite(max)) return NaN;
  let sum = 0;
  for (const v of values) sum += Math.exp(v - max);
  if (!Number.isFinite(sum) || sum <= 0) return NaN;
  return max + Math.log(sum);
}

function assertQuantities(q) {
  if (!Array.isArray(q) || q.length < 2) {
    const err = new Error("bad_outcomes");
    err.code = "bad_outcomes";
    throw err;
  }
  const out = q.map(Number);
  if (out.some((n) => !Number.isFinite(n))) {
    const err = new Error("bad_quantity");
    err.code = "bad_quantity";
    throw err;
  }
  return out;
}

function cost(q, b) {
  const qty = assertQuantities(q);
  const liquidity = assertLiquidity(b);
  const lse = logSumExp(qty.map((qi) => qi / liquidity));
  const c = liquidity * lse;
  if (!Number.isFinite(c)) {
    const err = new Error("unstable_cost");
    err.code = "unstable_cost";
    throw err;
  }
  return c;
}

function prices(q, b) {
  const qty = assertQuantities(q);
  const liquidity = assertLiquidity(b);
  const scaled = qty.map((qi) => qi / liquidity);
  const lse = logSumExp(scaled);
  const p = scaled.map((s) => Math.exp(s - lse));
  if (p.some((n) => !Number.isFinite(n))) {
    const err = new Error("unstable_price");
    err.code = "unstable_price";
    throw err;
  }
  return p;
}

function withShare(q, index, delta) {
  const qty = assertQuantities(q);
  if (!Number.isInteger(index) || index < 0 || index >= qty.length) {
    const err = new Error("bad_outcome");
    err.code = "bad_outcome";
    throw err;
  }
  const next = qty.slice();
  next[index] = qty[index] + delta;
  return next;
}

function buyCost(q, b, index, shares) {
  const n = Number(shares);
  if (!Number.isFinite(n) || n <= 0) {
    const err = new Error("bad_size");
    err.code = "bad_size";
    throw err;
  }
  return cost(withShare(q, index, n), b) - cost(q, b);
}

function sellValue(q, b, index, shares) {
  const n = Number(shares);
  if (!Number.isFinite(n) || n <= 0) {
    const err = new Error("bad_size");
    err.code = "bad_size";
    throw err;
  }
  const before = cost(q, b);
  const after = cost(withShare(q, index, -n), b);
  return before - after;
}

// Shares whose buy cost equals `budget`. LMSR cost is strictly increasing in shares.
function sharesForBudget(q, b, index, budget) {
  const target = Number(budget);
  if (!Number.isFinite(target) || target <= 0) {
    const err = new Error("bad_size");
    err.code = "bad_size";
    throw err;
  }
  let hi = 1;
  let guard = 0;
  while (buyCost(q, b, index, hi) < target) {
    hi *= 2;
    guard += 1;
    if (guard > 60 || hi > 1e12) break;
  }
  let lo = 0;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (buyCost(q, b, index, mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// q_i = b * ln(p_i / min p) so the smallest outcome starts at 0 and prices match p.
function seedQuantities(probs, b) {
  const liquidity = assertLiquidity(b);
  if (!Array.isArray(probs) || probs.length < 2) {
    const err = new Error("bad_outcomes");
    err.code = "bad_outcomes";
    throw err;
  }
  const raw = probs.map((x) => {
    const n = Number(x);
    if (!Number.isFinite(n) || n <= 0) return 1e-6;
    return Math.min(1 - 1e-6, n);
  });
  const sum = raw.reduce((s, n) => s + n, 0) || 1;
  const norm = raw.map((n) => n / sum);
  const logs = norm.map((n) => Math.log(n));
  const min = Math.min(...logs);
  return logs.map((n) => liquidity * (n - min));
}

function seedBinary(pYes, b) {
  const p = Number(pYes);
  const yes = Number.isFinite(p) ? Math.min(0.99, Math.max(0.01, p)) : 0.5;
  return seedQuantities([yes, 1 - yes], b);
}

function centsPair(yesPrice) {
  const yes = Math.max(0, Math.min(100, Math.round(Number(yesPrice) * 100)));
  return { yes, no: 100 - yes };
}

module.exports = {
  B_MIN,
  B_MAX,
  DEFAULT_B,
  round4,
  assertLiquidity,
  clampLiquidity,
  logSumExp,
  cost,
  prices,
  buyCost,
  sellValue,
  sharesForBudget,
  seedQuantities,
  seedBinary,
  centsPair,
};
