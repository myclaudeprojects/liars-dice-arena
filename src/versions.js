// versions.js — Pinned integrity versions.
//
// Historical matches keep the version they froze. Replay must not follow
// "whatever the process runs today" once a new engine ships.

const GAME_ENGINE_VERSION = "engine-v1";
const RULES_VERSION = "liars-dice-common-hand-ones-wild-v1";
const RNG_ALGORITHM_VERSION = "rng-v1";
const AGENT_ENGINE_VERSION = "agent-engine-v1";
const ORACLE_PAYLOAD_VERSION = "1.0";
const VERIFIER_VERSION = "verifier-v1";
const MARKET_LOCK_POLICY_VERSION = "lock-v1";
const SIGNING_ALGORITHM = "Ed25519";
const WINNING_MARGIN_VERSION = "WINNING_MARGIN_V1";
const MATCH_DURATION_VERSION = "MATCH_DURATION_V1";

module.exports = {
  GAME_ENGINE_VERSION,
  RULES_VERSION,
  RNG_ALGORITHM_VERSION,
  AGENT_ENGINE_VERSION,
  ORACLE_PAYLOAD_VERSION,
  VERIFIER_VERSION,
  MARKET_LOCK_POLICY_VERSION,
  SIGNING_ALGORITHM,
  WINNING_MARGIN_VERSION,
  MATCH_DURATION_VERSION,
};
