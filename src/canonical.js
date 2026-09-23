// canonical.js — Deterministic JSON and SHA-256 helpers.
//
// Object keys are sorted. Array order is preserved. Undefined fields are
// dropped. The same value always hashes to the same hex digest.

const crypto = require("crypto");

function coded(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) continue;
      out[key] = sortValue(value[key]);
    }
    return out;
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

function sha256Hex(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8");
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function sha256Prefixed(data) {
  return "sha256:" + sha256Hex(data);
}

module.exports = { coded, sortValue, canonicalJson, sha256Hex, sha256Prefixed };
