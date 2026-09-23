const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { Show, playExhibit } = require("../src/showrunner");
const { makePlayer } = require("../src/characters");
const { canonicalJson, sha256Prefixed } = require("../src/canonical");
const {
  generateRootSeed, commitmentFor, deriveDomains, replayDice, verifyRollSequence,
} = require("../src/randomness");
const {
  buildCompetitiveConfig, configurationHash, agentSnapshot,
} = require("../src/matchconfig");
const { eventLogHash, validateAndReplay, appendEvent } = require("../src/eventlog");
const { OracleKeyStore } = require("../src/oraclekeys");
const { OracleService, hashOracleBody } = require("../src/oracle");
const { MatchIntegrity } = require("../src/integrity");
const { evaluateSettlementGate, SettlementGate } = require("../src/settlementgate");

function assert(cond, msg) { if (!cond) throw new Error(msg || "assert"); }
function eq(a, b, m) { if (a !== b) throw new Error((m || "eq") + `: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }

function pair() {
  return [makePlayer("dracula"), makePlayer("caesar")];
}

function service() {
  const keys = new OracleKeyStore({ env: {} });
  const oracle = new OracleService(keys);
  const integrity = new MatchIntegrity({ oracle, env: {} });
  return { keys, oracle, integrity };
}

(async () => {
  for (const file of [
    "integrity.js", "oracle.js", "oraclekeys.js", "randomness.js",
    "eventlog.js", "matchconfig.js", "settlementgate.js", "canonical.js",
  ]) {
    const src = fs.readFileSync(path.join(__dirname, "..", "src", file), "utf8");
    assert(!/require\("\.\/simmarket"\)/.test(src), file + " stays off the market");
    assert(!/require\("\.\/showrunner"\)/.test(src), file + " stays off the show loop");
    assert(!/require\("\.\/wallet"\)/.test(src), file + " stays off wallets");
  }

  const pub = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "keys", "lda-oracle-dev.pub.json"), "utf8"));
  assert(pub.publicKeyPem.includes("BEGIN PUBLIC KEY"), "committed public key");
  assert(!pub.privateKey && !JSON.stringify(pub).includes("PRIVATE"), "no private key in the repo file");

  eq(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), canonicalJson({ a: { c: 3, d: 2 }, b: 1 }), "canonical key order");
  const seats = [{ id: "dracula" }, { id: "caesar" }];
  const scheduledAt = "2026-09-25T19:00:00.000Z";
  const configA = buildCompetitiveConfig({ matchId: "m-hash", seats, scheduledAt });
  const configB = buildCompetitiveConfig({ matchId: "m-hash", seats, scheduledAt });
  eq(configurationHash(configA), configurationHash(configB), "config hash reproduces");
  configB.wildOnes = false;
  assert(configurationHash(configA) !== configurationHash(configB), "a rule change changes the hash");
  assert(!canonicalJson(configA).includes("seed"), "the frozen config has no seed");
  const snap = agentSnapshot("dracula");
  eq(snap.agentVersionId, "dracula-v1", "agent version id");
  assert(snap.memory.memorySnapshotId === "mem-stateless", "stateless memory snapshot");

  const { keys, oracle, integrity } = service();
  const prepared = integrity.prepare({
    matchId: "m-lock", seats, scheduledAt, frozenBy: "test",
  });
  assert(prepared.rngCommitment.startsWith("sha256:"), "commitment published");
  eq(prepared.rngCommitment, commitmentFor(prepared.rootSeed), "commitment matches the seed");
  let locked = null;
  try { integrity.rejectChange("m-lock", { wildOnes: false }, "admin"); }
  catch (e) { locked = e.code; }
  eq(locked, "MATCH_CONFIGURATION_LOCKED", "post-lock edit rejected");
  assert(integrity.configs.audit.some((a) => a.action === "MATCH_CONFIGURATION_LOCKED"), "rejection is audited");
  eq(integrity.configs.require("m-lock").config.wildOnes, true, "rejected edit did not apply");

  const other = integrity.prepare({ matchId: "m-other", seats, scheduledAt });
  assert(other.matchId !== prepared.matchId, "rematch identity is a new match id");
  assert(other.rootSeed !== prepared.rootSeed, "rematch gets a new seed");
  assert(other.rngCommitment !== prepared.rngCommitment, "rematch gets a new commitment");
  let reused = null;
  try { integrity.prepare({ matchId: "m-lock", seats, scheduledAt }); }
  catch (e) { reused = e.code; }
  eq(reused, "MATCH_EXISTS", "a match id cannot be reused");

  let override = null;
  try { integrity.attemptOverride("m-lock", { winnerId: "dracula" }); }
  catch (e) { override = e.code; }
  eq(override, "MANUAL_OVERRIDE_DISABLED", "manual result override is refused");

  const root = prepared.rootSeed;
  const domains = deriveDomains(root);
  assert(domains.diceUint32 !== domains.agentUint32, "dice and agent streams differ");
  assert(domains.cosmeticUint32 !== domains.diceUint32, "cosmetic stream is not the dice stream");
  const first = await playExhibit({ agents: pair(), seed: root, sleep: async () => {} });
  const second = await playExhibit({ agents: pair(), seed: root, sleep: async () => {} });
  eq(
    first.log.filter((e) => e.type === "dice_rolled").map((e) => JSON.stringify(e.hands)).join("|"),
    second.log.filter((e) => e.type === "dice_rolled").map((e) => JSON.stringify(e.hands)).join("|"),
    "committed seed replays the same dice",
  );
  const dice = replayDice({ rootSeed: root, log: first.log });
  assert(dice.ok, "dice replay matches the log");
  eq(dice.sequenceCount, dice.rolls.length, "sequence count");
  const changedSeed = replayDice({ rootSeed: other.rootSeed, log: first.log });
  assert(!changedSeed.ok && changedSeed.code === "RNG_REPLAY_MISMATCH", "a different seed fails replay");
  const badAlg = replayDice({ rootSeed: root, algorithmVersion: "rng-v0", log: first.log });
  eq(badAlg.code, "RNG_ALGORITHM_UNSUPPORTED", "unknown rng version fails");
  const dupRolls = dice.rolls.map((r) => ({ ...r }));
  dupRolls[1] = { ...dupRolls[1], rngSequence: 0 };
  eq(verifyRollSequence(dupRolls).code, "RNG_SEQUENCE_DUPLICATE", "duplicate rng sequence fails");
  const gapRolls = dice.rolls.map((r) => ({ ...r }));
  gapRolls[1] = { ...gapRolls[1], rngSequence: 2 };
  eq(verifyRollSequence(gapRolls).code, "RNG_SEQUENCE_GAP", "rng gap fails");
  const range = verifyRollSequence([{ rngSequence: 0, purpose: "DIE_ROLL", value: 7 }]);
  eq(range.code, "RNG_DIE_OUT_OF_RANGE", "out-of-range die fails");
  assert(commitmentFor(generateRootSeed()) !== prepared.rngCommitment, "a new seed has a new commitment");

  const replay = validateAndReplay(first.log, { claimedWinnerId: first.winnerId });
  assert(replay.ok, "event sequence passes: " + (replay.detail || replay.code));
  eq(replay.winnerId, first.winnerId, "winner reproduces");
  eq(replay.eventLogHash, eventLogHash(first.log), "event log hash");
  const altered = JSON.parse(JSON.stringify(first.log));
  const bid = altered.find((e) => e.type === "bid");
  bid.count = 99;
  assert(eventLogHash(altered) !== eventLogHash(first.log), "altered event changes the log hash");
  const alteredReplay = validateAndReplay(altered, { claimedWinnerId: first.winnerId });
  assert(!alteredReplay.ok, "altered event fails replay");

  const missing = JSON.parse(JSON.stringify(first.log));
  missing.splice(2, 1);
  assert(!validateAndReplay(missing).ok, "missing event fails");
  const duplicate = first.log.slice();
  duplicate.splice(2, 0, { ...first.log[1] });
  eq(validateAndReplay(duplicate).code, "EVENT_SEQUENCE_INVALID", "duplicate event fails");
  const afterEnd = first.log.concat([{
    type: "bid", kind: "BID_PLACED", seq: first.log.length, hand: 1, byId: "dracula", count: 1, face: 2,
  }]);
  eq(validateAndReplay(afterEnd).code, "EVENT_SEQUENCE_INVALID", "event after terminal state fails");
  const impossible = [
    { type: "match_started", kind: "MATCH_STARTED", seq: 0, hand: 0, seats: [{ id: "dracula", name: "Dracula" }, { id: "caesar", name: "Caesar" }] },
    { type: "bid", kind: "BID_PLACED", seq: 1, hand: 1, byId: "dracula", count: 2, face: 3 },
  ];
  eq(validateAndReplay(impossible).code, "EVENT_SEQUENCE_INVALID", "impossible transition fails");
  const appended = appendEvent([{ seq: 0, type: "match_started" }], { seq: 0, type: "match_started" });
  assert(appended.duplicate && appended.log.length === 1, "duplicate append is idempotent");

  const faceLog = JSON.parse(JSON.stringify(first.log));
  faceLog.find((e) => e.kind === "DICE_ROLLED").hands[0].dice[0] = 9;
  const ranged = replayDice({ rootSeed: root, log: faceLog });
  eq(ranged.code, "RNG_DIE_OUT_OF_RANGE", "logged out-of-range die fails");

  const done = integrity.finalize({
    matchId: "m-lock",
    log: first.log,
    winnerId: first.winnerId,
    startedAt: 1_000,
    endedAt: 1_400,
  });
  eq(done.status, "VALID", "integrity valid: " + done.errorCode);
  eq(done.winnerId, first.winnerId, "signed winner");
  assert(done.oracle && done.oracle.signature && done.oracle.realMoney === false, "signed play-money payload");
  eq(done.oracle.durationMs, 400, "duration is the server interval");
  eq(hashOracleBody(done.oracle), done.oracle.resultHash, "result hash matches the body");
  eq(hashOracleBody({ ...done.oracle, signature: "nope" }), done.oracle.resultHash, "signature is outside the hash");
  assert(oracle.verify(done.oracle).ok, "signature verifies");
  const tampered = { ...done.oracle, winnerId: done.oracle.winnerId === "dracula" ? "caesar" : "dracula" };
  assert(!oracle.verify(tampered).ok, "changed payload breaks the signature");
  const again = integrity.finalize({ matchId: "m-lock", log: first.log, winnerId: first.winnerId });
  eq(again.oracle.signature, done.oracle.signature, "a second finalize keeps the signature");

  const gate = new SettlementGate();
  const signatureCheck = oracle.verify(done.oracle);
  const settled = gate.commit({
    integrity: done, oracle: done.oracle, marketStatus: "locked", signatureCheck,
  });
  eq(settled.action, "settle", "valid signed match may settle");
  const twice = gate.commit({
    integrity: done, oracle: done.oracle, marketStatus: "locked", signatureCheck,
  });
  assert(twice.duplicate && twice.settlementKey === settled.settlementKey, "cannot settle twice");
  eq(evaluateSettlementGate({
    integrity: { status: "PENDING", gameStatus: "SCHEDULED" },
    oracle: null,
    marketStatus: "open",
  }).action, "wait", "pending match waits");
  eq(evaluateSettlementGate({
    integrity: { status: "VALID", gameStatus: "RESOLVED", signatureValid: true, configurationHash: done.configurationHash },
    oracle: null,
    marketStatus: "locked",
  }).errorCode, "RESULT_SIGNATURE_FAILED", "cannot settle before a signed oracle result");
  eq(evaluateSettlementGate({
    integrity: done, oracle: done.oracle, marketStatus: "open", signatureCheck,
  }).errorCode, "MARKET_LOCK_VIOLATION", "open market does not settle");
  let paid = null;
  try { gate.pay(); }
  catch (e) { paid = e.code; }
  eq(paid, "SETTLEMENT_GATE_DOES_NOT_PAY", "the gate does not move credits");

  const oldId = keys.active().id;
  keys.retire(oldId, "scheduled");
  assert(oracle.verify(done.oracle).ok, "retired public key still verifies");
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  keys.rotate({
    privateMaterial: privateKey.export({ type: "pkcs8", format: "pem" }),
    id: "lda-oracle-next",
    reason: "rotation",
  });
  eq(keys.get(oldId).status, "RETIRED", "rotation retires the previous key");
  assert(oracle.verify(done.oracle).ok, "historical signature survives rotation");
  keys.revoke(oldId, "compromised");
  const revoked = oracle.verify(done.oracle);
  eq(revoked.code, "SIGNING_KEY_REVOKED", "revoked key is rejected");
  assert(revoked.math, "the math still matches the revoked key");
  eq(evaluateSettlementGate({
    integrity: done, oracle: done.oracle, marketStatus: "locked", signatureCheck: revoked,
  }).action, "wait", "revoked key blocks settlement");

  const reviewPrep = integrity.prepare({ matchId: "m-review", seats, scheduledAt });
  const reviewLog = await playExhibit({ agents: pair(), seed: reviewPrep.rootSeed, sleep: async () => {} });
  const review = integrity.finalize({
    matchId: "m-review",
    log: reviewLog.log,
    winnerId: reviewLog.winnerId,
    fault: "review",
  });
  eq(review.status, "UNDER_REVIEW", "simulated uncertainty waits");
  eq(evaluateSettlementGate({
    integrity: review, oracle: null, marketStatus: "locked",
  }).action, "wait", "under review does not settle");

  const driftPrep = integrity.prepare({ matchId: "m-drift", seats, scheduledAt });
  const driftLog = await playExhibit({ agents: pair(), seed: driftPrep.rootSeed, sleep: async () => {} });
  integrity.matches.get("m-drift").configurationHash = "sha256:" + "ab".repeat(32);
  const drift = integrity.finalize({
    matchId: "m-drift",
    log: driftLog.log,
    winnerId: driftLog.winnerId,
  });
  eq(drift.status, "INVALID", "config drift is invalid");
  eq(drift.errorCode, "CONFIG_HASH_MISMATCH", "config mismatch code");
  eq(evaluateSettlementGate({
    integrity: drift, oracle: null, marketStatus: "locked",
  }).action, "void", "invalid match voids");

  const voided = integrity.prepare({ matchId: "m-void", seats, scheduledAt });
  const voidView = integrity.voidMatch(voided.matchId, "canceled_before_start");
  eq(voidView.status, "VOID", "void before start");
  eq(evaluateSettlementGate({
    integrity: voidView, oracle: null, marketStatus: "locked",
  }).action, "void", "void match does not settle");

  const file = path.join(os.tmpdir(), `lda-integrity-${process.pid}.json`);
  const show = new Show({
    dataPath: file,
    sleep: async () => {},
    pickWindowMs: 0,
    turnDelayMs: 0,
    revealDelayMs: 0,
    settleHoldMs: 0,
    bootstrapCount: 0,
    loopEnabled: false,
    env: {},
  });
  show.bootstrapDone = true;
  show.openNext();
  const secret = show.current.seed;
  const live = show.snapshot();
  eq(live.live.seed, null, "public snapshot hides the seed");
  assert(live.live.rngCommitment && live.live.rngCommitment.startsWith("sha256:"), "public commitment");
  assert(live.live.configurationHash.startsWith("sha256:"), "public config hash");
  const published = JSON.stringify(show.snapshot());
  for (const card of [show.current, ...show.upcoming]) {
    assert(!published.includes(card.seed), "upcoming and live seeds stay off the snapshot");
  }
  const disk = JSON.parse(fs.readFileSync(file, "utf8"));
  eq(disk.v, 1, "show file stays version 1");
  eq(disk.current.seed, null, "disk card has no raw seed");
  assert(disk.current.rngCommitment, "disk card keeps the commitment");
  assert(disk.integrity && disk.integrity.matches.length >= 1, "integrity rides in the same file");
  assert(!JSON.stringify(disk.current).includes(secret), "current card is not the seed");
  assert(!JSON.stringify(disk.integrity).includes(secret), "sealed record is not the raw seed");
  assert(!JSON.stringify(disk).includes("BEGIN PRIVATE"), "private key is not stored");

  const resumed = new Show({
    dataPath: file,
    sleep: async () => {},
    pickWindowMs: 0,
    turnDelayMs: 0,
    revealDelayMs: 0,
    settleHoldMs: 0,
    bootstrapCount: 0,
    loopEnabled: false,
    env: {},
  });
  eq(resumed.current.matchId, show.current.matchId, "resume keeps the match id");
  eq(resumed.current.seed, secret, "resume unseals the same seed");
  assert(!JSON.stringify(resumed.snapshot()).includes(secret), "resumed public view still hides the seed");
  const archived = await resumed.playOpen();
  eq(archived.oracle.integrityStatus, "VALID", "resumed match verifies");
  eq(resumed.market.requireMarket(archived.matchId).status, "settled", "gate allowed settlement");
  eq(resumed.market.requireMarket(archived.matchId).configurationHash, archived.oracle.configurationHash, "market stores the config hash");
  const view = resumed.verification(archived.matchId);
  eq(view.integrityStatus, "VALID", "verification record");
  eq(view.rngCommitment, archived.oracle.rngCommitment, "verification commitment");
  assert(view.rngSeedReveal.startsWith("hex:"), "seed revealed after the match");
  eq(commitmentFor(view.rngSeedReveal.slice(4)), view.rngCommitment, "reveal matches the commitment");
  assert(view.signature && view.signingKeyId && view.realMoney === false && view.cashValue === 0, "public signature");
  assert(!view.sealedSeed, "verification has no seal");
  const replayed = resumed.verification(archived.matchId, { replay: true });
  assert(replayed.replay.diceVerified && replayed.replay.eventVerified && replayed.replay.signatureVerified, "post-match replay");
  assert(replayed.replay.finalStateMatches, "final state hash matches");

  console.log("integrity ok");
})().catch((e) => { console.error(e); process.exit(1); });
