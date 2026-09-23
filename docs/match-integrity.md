# Match integrity, oracle, and verification

Play-money only. Arena Credits have no cash value. This layer does not take deposits, pay withdrawals, or convert anything to crypto. A market may read a signed result. It must not change the match.

## Designed

Phases 1–5 of the integrity spec:

1. Freeze the competitive snapshot (agents, rules, engine versions) and hash it. Reject later edits.
2. Generate a 32-byte seed, publish `SHA-256(seed)` before the market opens, play from domain-separated streams, reveal the seed after the match.
3. Validate the ordered event log and replay it to a final state. Hash the log and the final state.
4. Move `PENDING → VALIDATING → VALID | UNDER_REVIEW | INVALID | VOID`.
5. Sign the canonical result with Ed25519 and publish it.

Phase 6 (moving Arena Credits inside `SimMarket`) is a gate the market code can call. This process still refuses to settle unless that gate returns `settle`. Invalid and void results do not pick a winner.

## Implemented

| Module | Role |
| --- | --- |
| `src/matchconfig.js` | Frozen snapshot, configuration hash, post-lock rejection |
| `src/randomness.js` | Seed, commitment, HMAC domains, mulberry32 dice replay, AES-GCM seal |
| `src/eventlog.js` | Sequence checks and deterministic replay |
| `src/integrity.js` | State machine. Does not import the market or the show loop |
| `src/oracle.js` | Canonical payload, result hash, Ed25519 signature |
| `src/oraclekeys.js` | Active, retired, and revoked public keys |
| `src/settlementgate.js` | `evaluateSettlementGate` / `SettlementGate.commit` |

`Show` freezes and commits inside `makeCard` before `SimMarket.createMarket`. The root seed is sealed in `show.json` under `integrity` and omitted from the public card until reveal. `show.json` stays `v: 1`. The same `ShowStore` lock and SIGTERM release still own the file.

Verification:

- `GET /api/verify-match/:id`
- `POST /api/verify-match/:id` replays dice, events, and the signature
- `GET|POST /api/show/matches/:id/verification`

`rng-v1` is `HMAC-SHA256(root, "dice"|"agent"|"cosmetic")`, then the first four bytes as a mulberry32 seed. Numeric seeds passed straight to `playExhibit` keep the older mix so existing replays stay valid. Those numeric seeds are not commitments.

## Settlement gate

```js
const { evaluateSettlementGate } = require("./src/settlementgate");

const decision = evaluateSettlementGate({
  integrity,       // status, gameStatus, configurationHash, signatureValid
  oracle,          // signed payload, realMoney: false, cashValue: 0
  marketStatus,    // "locked" or "AWAITING_RESULT"
  signatureCheck,  // OracleService.verify(oracle), optional but required for a revoked key
});
// decision.action is "settle", "wait", or "void"
```

`SettlementGate.commit` stores `matchId:resultHash` and returns `duplicate: true` on a second settle. `pay()` throws. The gate does not read dice or write credits.

## Keys

`LDA_ORACLE_SIGNING_KEY` is a PKCS#8 PEM or a 32-byte hex seed. `LDA_ORACLE_KEY_ID` names it. `LDA_SEED_WRAP_KEY` is 64 hex characters used to seal the unrevealed seed.

If those variables are unset, the process signs with an ephemeral dev key and seals with the label `lda-dev-seed-wrap-v1`. That fallback is not a production secret. Set both variables before treating signatures or seals as operational.

`keys/lda-oracle-dev.pub.json` is a public key only.

### Rotate

1. Generate an Ed25519 key outside the repo. Do not commit the private key.
2. Set `LDA_ORACLE_SIGNING_KEY` and `LDA_ORACLE_KEY_ID` to the new key.
3. Restart the process. `OracleKeyStore` marks the previous active key `RETIRED`. Retired public keys stay on the show file and still verify old results.
4. Call `oracleKeys.revoke(id, reason)` only when a key is compromised. Revoked keys fail verification with `SIGNING_KEY_REVOKED`. The settlement gate waits. It does not choose a winner.

## Tested

`test/integrity.test.js` covers freeze, post-lock rejection, commitment, seed change, dice replay, algorithm version, duplicate and gapped RNG sequences, out-of-range dice, event sequence, replay, oracle signature, retired and revoked keys, and the settlement gate (`settle`, `wait`, `void`, duplicate). `npm test` runs that file with the rest of the suite.
