// oraclekeys.js — Ed25519 signing keys for the match oracle.
//
// Private keys come from LDA_ORACLE_SIGNING_KEY or, outside production, from
// an ephemeral dev key kept in memory. Public keys may be stored with the
// show file so a signature still verifies after restart. Private keys are
// never written to the show file and are not committed.
//
// Rotation: generate a new key, set LDA_ORACLE_SIGNING_KEY and
// LDA_ORACLE_KEY_ID, restart. The previous public key stays on the record
// with status RETIRED and keeps verifying old results. REVOKED keys fail
// closed even when the math still matches.

const crypto = require("crypto");
const { coded } = require("./canonical");
const { SIGNING_ALGORITHM } = require("./versions");

const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function privateKeyFromSeed(seed32) {
  const pkcs8 = Buffer.concat([PKCS8_PREFIX, seed32]);
  return crypto.createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
}

function importPrivate(material) {
  const text = String(material || "").trim();
  if (!text) throw coded("ORACLE_KEY_MISSING");
  if (text.includes("BEGIN")) {
    return crypto.createPrivateKey(text);
  }
  if (/^[0-9a-fA-F]{64}$/.test(text)) {
    return privateKeyFromSeed(Buffer.from(text, "hex"));
  }
  throw coded("ORACLE_KEY_INVALID", "LDA_ORACLE_SIGNING_KEY must be a PKCS8 PEM or 32-byte hex seed");
}

function publicPem(privateKey) {
  const pub = crypto.createPublicKey(privateKey);
  return pub.export({ type: "spki", format: "pem" });
}

class OracleKeyStore {
  constructor(opts = {}) {
    this.env = opts.env || process.env;
    this.keys = [];
    this._warned = false;
    if (opts.autoLoad !== false) this.loadSigningKey();
  }

  loadSigningKey() {
    const material = this.env.LDA_ORACLE_SIGNING_KEY;
    const production = this.env.NODE_ENV === "production" || !!this.env.RENDER;
    if (material) {
      const privateKey = importPrivate(material);
      const id = this.env.LDA_ORACLE_KEY_ID || "lda-oracle-env";
      this._addActive({ id, privateKey, publicKeyPem: publicPem(privateKey) });
      return this.active();
    }
    if (production && !this._warned) {
      this._warned = true;
      console.warn("LDA_ORACLE_SIGNING_KEY is unset. This process will sign with an ephemeral dev key. Set a managed key before production settlement.");
    }
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const id = "lda-oracle-dev-" + crypto.randomBytes(4).toString("hex");
    this._addActive({
      id,
      privateKey,
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
      dev: true,
    });
    return this.active();
  }

  _addActive({ id, privateKey, publicKeyPem: pem, dev = false }) {
    for (const key of this.keys) {
      if (key.status === "ACTIVE" && key.id !== id) key.status = "RETIRED";
    }
    const existing = this.keys.find((k) => k.id === id);
    const row = existing || {
      id,
      algorithm: SIGNING_ALGORITHM,
      validFrom: new Date().toISOString(),
      validUntil: null,
      dev: !!dev,
    };
    row.publicKeyPem = pem;
    row.privateKey = privateKey;
    row.status = "ACTIVE";
    row.algorithm = SIGNING_ALGORITHM;
    if (!existing) this.keys.push(row);
    return row;
  }

  active() {
    return this.keys.find((k) => k.status === "ACTIVE" && k.privateKey) || null;
  }

  get(id) {
    return this.keys.find((k) => k.id === id) || null;
  }

  retire(id, reason) {
    const key = this.get(id);
    if (!key) throw coded("UNKNOWN_SIGNING_KEY");
    if (key.status === "REVOKED") return this.publicRecord(key);
    key.status = "RETIRED";
    key.retiredReason = reason || null;
    return this.publicRecord(key);
  }

  revoke(id, reason) {
    const key = this.get(id);
    if (!key) throw coded("UNKNOWN_SIGNING_KEY");
    key.status = "REVOKED";
    key.revokedReason = reason || null;
    return this.publicRecord(key);
  }

  // Swap in a new active key. The previous active key becomes RETIRED.
  rotate({ privateMaterial, id, reason }) {
    const prev = this.active();
    if (prev) this.retire(prev.id, reason || "rotated");
    const privateKey = importPrivate(privateMaterial);
    const nextId = id || ("lda-oracle-" + crypto.randomBytes(3).toString("hex"));
    return this.publicRecord(this._addActive({
      id: nextId,
      privateKey,
      publicKeyPem: publicPem(privateKey),
    }));
  }

  publicRecord(key) {
    if (!key) return null;
    return {
      id: key.id,
      signingKeyId: key.id,
      algorithm: key.algorithm,
      publicKeyPem: key.publicKeyPem,
      status: key.status,
      validFrom: key.validFrom,
      validUntil: key.validUntil,
      dev: !!key.dev,
    };
  }

  exportPublic() {
    return this.keys.map((k) => this.publicRecord(k));
  }

  importPublic(list) {
    for (const raw of list || []) {
      if (!raw || !raw.publicKeyPem) continue;
      const id = raw.id || raw.signingKeyId;
      if (!id) continue;
      const existing = this.get(id);
      if (existing) {
        if (!existing.privateKey && raw.status) existing.status = raw.status;
        continue;
      }
      let status = raw.status || "RETIRED";
      if (status === "ACTIVE") status = "RETIRED";
      this.keys.push({
        id,
        algorithm: raw.algorithm || SIGNING_ALGORITHM,
        publicKeyPem: raw.publicKeyPem,
        privateKey: null,
        status,
        validFrom: raw.validFrom || null,
        validUntil: raw.validUntil || null,
        dev: !!raw.dev,
      });
    }
    const holders = this.keys.filter((k) => k.privateKey && k.status === "ACTIVE");
    if (holders.length === 1) {
      for (const key of this.keys) {
        if (key.id !== holders[0].id && key.status === "ACTIVE") key.status = "RETIRED";
      }
    }
  }

  sign(message) {
    const key = this.active();
    if (!key) throw coded("ORACLE_KEY_MISSING");
    const sig = crypto.sign(null, Buffer.from(message, "utf8"), key.privateKey);
    return {
      signature: sig.toString("base64"),
      signingKeyId: key.id,
      algorithm: SIGNING_ALGORITHM,
      publicKeyPem: key.publicKeyPem,
    };
  }

  // Retired keys still verify. Revoked keys do not, even if the math matches.
  verify(signingKeyId, message, signatureB64) {
    const key = this.get(signingKeyId);
    if (!key) return { ok: false, code: "UNKNOWN_SIGNING_KEY", math: false };
    let math = false;
    try {
      math = crypto.verify(
        null,
        Buffer.from(message, "utf8"),
        crypto.createPublicKey(key.publicKeyPem),
        Buffer.from(signatureB64, "base64"),
      );
    } catch {
      math = false;
    }
    if (key.status === "REVOKED") {
      return { ok: false, code: "SIGNING_KEY_REVOKED", math, status: key.status };
    }
    if (!math) return { ok: false, code: "RESULT_SIGNATURE_FAILED", math: false, status: key.status };
    return { ok: true, code: null, math: true, status: key.status };
  }
}

module.exports = { OracleKeyStore, importPrivate, publicPem };
