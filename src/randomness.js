// randomness.js — Commit–reveal seeds for one match.
//
// The root seed is 32 random bytes. Its SHA-256 commitment is public before
// the match. Dice, agent decisions, and cosmetic draws are separate HMAC
// streams. Only the dice stream produces authoritative faces.
//
// rng-v1 folds each stream into the existing mulberry32 generator:
//   domain = HMAC-SHA256(root, label)
//   uint32 = first 4 bytes, big-endian
//   faces  = mulberry32(dice uint32), then 1 + floor(u * 6)
//
// A numeric seed (the pre-commitment show path, and playExhibit tests) stays
// on the original mulberry32 + decisionRng mix. It is not a commitment.

const crypto = require("crypto");
const { makeRng } = require("./engine");
const { coded, sha256Prefixed } = require("./canonical");
const { RNG_ALGORITHM_VERSION } = require("./versions");

const DEV_WRAP_LABEL = "lda-dev-seed-wrap-v1";
let warnedDevWrap = false;

function isRootHex(seed) {
  return typeof seed === "string" && /^[0-9a-f]{64}$/.test(seed);
}

function generateRootSeed() {
  return crypto.randomBytes(32);
}

function commitmentFor(root) {
  const buf = Buffer.isBuffer(root) ? root : Buffer.from(root, "hex");
  if (buf.length !== 32) throw coded("RNG_SEED_INVALID", "root seed must be 32 bytes");
  return sha256Prefixed(buf);
}

function deriveDomains(root) {
  const buf = Buffer.isBuffer(root) ? root : Buffer.from(String(root), "hex");
  if (buf.length !== 32) throw coded("RNG_SEED_INVALID", "root seed must be 32 bytes");
  const domain = (label) => crypto.createHmac("sha256", buf).update(label).digest();
  const dice = domain("dice");
  const agent = domain("agent");
  const cosmetic = domain("cosmetic");
  return {
    dice,
    agent,
    cosmetic,
    diceUint32: dice.readUInt32BE(0),
    agentUint32: agent.readUInt32BE(0),
    cosmeticUint32: cosmetic.readUInt32BE(0),
  };
}

// What playExhibit should feed the engine. Legacy numbers are unchanged.
function resolvePlaySeeds(seed) {
  if (isRootHex(seed)) {
    const domains = deriveDomains(seed);
    return {
      legacy: false,
      diceSeed: domains.diceUint32,
      agentSeed: domains.agentUint32,
      cosmeticSeed: domains.cosmeticUint32,
      rootHex: seed,
    };
  }
  const n = (typeof seed === "number" || (typeof seed === "string" && /^\d+$/.test(seed)))
    ? (Number(seed) >>> 0)
    : (Number(seed) >>> 0);
  return {
    legacy: true,
    diceSeed: n,
    agentSeed: n,
    cosmeticSeed: null,
    rootHex: null,
  };
}

function seedWrapKey(env = process.env) {
  const hex = env && env.LDA_SEED_WRAP_KEY;
  if (hex) {
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
      throw coded("LDA_SEED_WRAP_KEY_INVALID", "LDA_SEED_WRAP_KEY must be 64 hex characters");
    }
    return Buffer.from(hex, "hex");
  }
  const production = env && (env.NODE_ENV === "production" || env.RENDER);
  if (production && !warnedDevWrap) {
    warnedDevWrap = true;
    console.warn("LDA_SEED_WRAP_KEY is unset. Sealing match seeds with the documented dev wrap key. Set LDA_SEED_WRAP_KEY before treating seals as secret.");
  }
  return crypto.createHash("sha256").update(DEV_WRAP_LABEL).digest();
}

function sealSeed(root, env = process.env) {
  const buf = Buffer.isBuffer(root) ? root : Buffer.from(String(root), "hex");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", seedWrapKey(env), iv);
  const ct = Buffer.concat([cipher.update(buf), cipher.final()]);
  return {
    alg: "aes-256-gcm",
    iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
    ct: ct.toString("hex"),
  };
}

function openSeed(box, env = process.env) {
  if (!box || box.alg !== "aes-256-gcm") throw coded("RNG_SEED_SEAL_INVALID");
  const decipher = crypto.createDecipheriv("aes-256-gcm", seedWrapKey(env), Buffer.from(box.iv, "hex"));
  decipher.setAuthTag(Buffer.from(box.tag, "hex"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(box.ct, "hex")),
    decipher.final(),
  ]);
  return plain.toString("hex");
}

function rollDie(rng) {
  return 1 + Math.floor(rng() * 6);
}

function verifyRollSequence(rolls) {
  const seen = new Set();
  for (let i = 0; i < rolls.length; i++) {
    const row = rolls[i];
    if (!row || row.purpose !== "DIE_ROLL") {
      return { ok: false, code: "RNG_REPLAY_MISMATCH", detail: "roll purpose" };
    }
    if (seen.has(row.rngSequence)) {
      return { ok: false, code: "RNG_SEQUENCE_DUPLICATE", at: row.rngSequence };
    }
    if (row.rngSequence !== i) {
      return { ok: false, code: "RNG_SEQUENCE_GAP", expected: i, actual: row.rngSequence };
    }
    if (!Number.isInteger(row.value) || row.value < 1 || row.value > 6) {
      return { ok: false, code: "RNG_DIE_OUT_OF_RANGE", at: i, value: row.value };
    }
    seen.add(row.rngSequence);
  }
  return { ok: true };
}

// Replay dice from the revealed root and compare them to DICE_ROLLED events.
function replayDice({ rootSeed, algorithmVersion = RNG_ALGORITHM_VERSION, log }) {
  if (algorithmVersion !== RNG_ALGORITHM_VERSION) {
    return { ok: false, code: "RNG_ALGORITHM_UNSUPPORTED", algorithmVersion };
  }
  let domains;
  try { domains = deriveDomains(rootSeed); }
  catch (e) { return { ok: false, code: e.code || "RNG_SEED_INVALID" }; }
  const rng = makeRng(domains.diceUint32);
  const rolls = [];
  let seq = 0;
  let diceEvents = 0;
  for (const ev of log || []) {
    const kind = ev.kind || ev.type;
    if (kind !== "DICE_ROLLED" && kind !== "dice_rolled") continue;
    diceEvents++;
    for (const hand of ev.hands || []) {
      const faces = Array.isArray(hand.dice) ? hand.dice : [];
      for (let i = 0; i < faces.length; i++) {
        const value = rollDie(rng);
        const face = faces[i];
        if (!Number.isInteger(face) || face < 1 || face > 6) {
          return { ok: false, code: "RNG_DIE_OUT_OF_RANGE", at: seq, value: face, rolls };
        }
        if (value !== face) {
          return {
            ok: false,
            code: "RNG_REPLAY_MISMATCH",
            at: seq,
            expected: value,
            actual: face,
            rolls,
          };
        }
        rolls.push({
          matchId: ev.matchId || null,
          rngSequence: seq,
          roundId: "r" + (ev.hand == null ? "?" : ev.hand),
          agentId: hand.id || null,
          purpose: "DIE_ROLL",
          value,
        });
        seq++;
      }
    }
  }
  if (!diceEvents) return { ok: false, code: "RNG_REPLAY_MISMATCH", detail: "no dice events" };
  const sequence = verifyRollSequence(rolls);
  if (!sequence.ok) return { ...sequence, rolls };
  return {
    ok: true,
    rolls,
    sequenceCount: rolls.length,
    diceUint32: domains.diceUint32,
    agentUint32: domains.agentUint32,
    cosmeticUint32: domains.cosmeticUint32,
  };
}

module.exports = {
  DEV_WRAP_LABEL,
  isRootHex,
  generateRootSeed,
  commitmentFor,
  deriveDomains,
  resolvePlaySeeds,
  seedWrapKey,
  sealSeed,
  openSeed,
  rollDie,
  verifyRollSequence,
  replayDice,
};
