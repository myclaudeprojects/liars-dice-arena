# Spectator premium audit (Phase 1)

Audit date: 2026-09-23. Base: `main` at `f0d2e81` (show-store lock on shutdown).

This document records the architecture that is actually in the repo and the gap to `gameplay-ui-visual-spec.md` (the product brief). It does not add gameplay, UI, or AI behavior.

**Status words used below**

| Label | Meaning |
| --- | --- |
| **Designed** | Specified in the brief. Not a claim about code. |
| **Implemented** | Present in the current show path and reachable without `LEGACY_USDC=1`. |
| **Partial** | A thinner version exists. The brief’s behavior is not what the code does. |
| **Missing** | No show-path implementation. |
| **Tested** | Covered by `npm test` on this commit (`node test/run.js`, all files passed in this audit). |
| **Verified** | Exercised in a browser against a running server. **Not claimed here.** This audit did not open the live site or a local browser. |

Do not treat unit-test passage as a live-site verification. Do not invent viewer counts, win rates, or memories. Numbers below are code constants and field names, not production telemetry.

## Product lock

The default process (`LEGACY_USDC` unset) is the Phase 1 spectator show: AI characters play, humans pick a winner with test credits, `cashValue: 0`, `custody: false`, `realMoney: false`. `src/showhttp.js` does not expose wallet routes. `src/simmarket.js` grants 1000 test credits, stakes 10–250, default stake 50. Settled copy and share text are kept off USDC (`test/showrunner.test.js` asserts share text does not match `/usdc|wallet|\$/i`).

A second product still lives in the same process and is **not** the lead experience on `/`:

- `LEGACY_USDC=1` runs `cycle()` in `server.js`: USDC `BettingPool`, SSE `/events`, `POST /api/bet`.
- Static pages `/legacy`, `/arena`, `/agents`, `/leaderboard`, `/how-it-works` still describe wallets, Arc, and a `$LIAR` buy link.
- `src/llm.js` `PERSONAS` and `LLMAgent` prompts still say the player is betting real USDC. The show never constructs those agents. `makePlayer()` in `src/characters.js` always returns `MockAgent`.

Phase 2 must leave that legacy tree alone unless a change is required to keep `/` on the show. Do not add wallets, custody, burns, NFTs, or chain UX to the show.

## 1. Architecture

One Node process. No React, no bundler. Dependency in `package.json`: `ethers` (legacy wallet path only). Frontend is static files under `public/`.

```
node server.js
  LEGACY_USDC unset
    Show.start()                          src/showrunner.js
      ShowStore lock + show.json          src/showstore.js
      SimMarket test-credit book          src/simmarket.js
      playExhibit → Match + MockAgent     src/engine.js, src/agents.js, src/characters.js
      narrative + share text              src/narrative.js
    handleShow → /api/show/*              src/showhttp.js
    sendFile public/app.html at "/"
  LEGACY_USDC=1
    cycle() → Registry, runMatch, BettingPool, Stats
    "/" serves public/landing.html
```

### Server entry

`server.js`

- Binds `HOST` (default `0.0.0.0`) and `PORT` (default 3000). Render-compatible.
- `LEGACY_USDC !== "1"`: constructs `Show` and calls `show.start()`. The legacy `cycle()` does not run.
- Show timing from env, with these code defaults: pick window 14000 ms, turn delay 900 ms, reveal delay 1400 ms, settle hold 12000 ms, bootstrap 12 matches, loop on unless `SHOW_LOOP=0`.
- `render.yaml` sets `TURN_DELAY_MS=1600`. The show reads that same variable, so the deployed turn dwell is 1600 ms, not the 900 ms code default. `REVEAL_DELAY_MS` is not set in `render.yaml`, so reveal dwell stays 1400 ms.
- `GET /health` returns `{ ok, mode: "show"|"legacy-usdc", phase, showReady, wallet, clients, lastError }`. `wallet` is still the legacy adapter kind (`mock` when no Circle key and no house key). The show does not spend it.

### Show engine

`src/showrunner.js` class `Show`

- Cast of 12 from `src/characters.js`. `test/showrunner.test.js` locks `CAST.length === 12` and a unique `aggression:chaos` pair per id.
- Schedule: round-robin pairs with `athena` held out of bootstrap (`pairSchedule("athena")`). After bootstrap, the first free unplayed character (Athena if she has not played) is debuted. A streak of 3 or more pulls that character back onto the board. Otherwise the round-robin continues. Live match plus `slateAhead` (default 4) upcoming books. Tests assert nobody is double-booked across that board.
- Phases on the live card: `pick` → `live` → `settled`. Show-level phase can also be `starting` or `paused`.
- `loop()` waits `pickWindowMs`, then `playOpen()`, then `settleHoldMs`, then opens the next card.
- `playExhibit()` builds a `Match` (5 dice, ones wild, seeded mulberry32), asks `MockAgent.act(view)`, rejects illegal actions through `safeFallback`, emits `CALL` / `BID` / `REVEAL`, and sleeps.
- Settlement writes `matchStory`, `shareCard`, and an oracle `{ matchId, winnerId, seed, resultHash, eventCount, rules, realMoney: false }`. History keeps 100 matches (`HISTORY_CAP`).
- An in-flight `live` card is stored as `current` with `phase: "live"`. On the next boot, `finishInterrupted()` **re-simulates the match from the seed with delays forced to 0**. It does not resume the action log the spectators already saw. See the Phase 2 kickoff: agent dice are seeded; agent choices are not.

### AI decision path (what the show actually calls)

`src/characters.js` `makePlayer(id)` → `src/agents.js` `MockAgent`.

`MockAgent.act(view)` uses:

- Own dice (`view.you.dice`).
- Current bid, total dice, ones-wild flag.
- Two scalars: `aggression` (challenge slack threshold `-1 - aggression`, and a chance to bump the bid count by 1) and `chaos` (chance to bid a random face via `Math.random()`).

It does **not** read: hand/round number, opponent bid history, score, ahead/behind, persistent records, rival series, or the character’s written strength/weakness. Those strings are spectator copy. `view.table[].diceCount` is available and unused by the heuristic.

`Math.random()` drives chaos and the aggression bump. `Match` rolls dice from `makeRng(seed)`. Re-running `playExhibit` with the same seed does **not** reproduce the same bids. `test/showrunner.test.js` only asserts that seed 42 produces some winner and a non-empty log.

`LLMAgent`, `RemoteAgent`, `src/llm.js`, and `src/registry.js` belong to the legacy table and community-agent registration. `USE_LLM=1` does not change `makePlayer`.

### Records the show persists (this is the whole “memory”)

`Records` in `src/showrunner.js`, saved on the show file under `records`:

| Field | Written by | Fed back into `act()` |
| --- | --- | --- |
| `won`, `lost`, `played` | `applyMatch` | No. Shown as `W–L` and win rate. |
| `streak`, `bestStreak` | `applyMatch` | No. Streak ≥ 3 changes scheduling and the Arena “Hot” line. |
| `form` | Last 8 `W`/`L` | No. Agent profile only. |
| `rivals[id] = { wins, losses, meetings }` | `applyMatch` | No. Arena rivalry row and profile list. |
| `bids`, `bigBids` | `noteBid` when count ≥ 55% of dice | No. `knownFor` returns `"big claims"` after 8 bids and a 0.34 ratio. |
| `challenges`, `correctCalls` | `noteCall` | No. `knownFor` returns `"calling thin bids"` after 6 calls and a 0.55 hit rate. |
| `moments` | Up to 6 `{ title, dek, at }` for the winner | No. |

`knownFor` is the only derived tendency, and it is a single string with two thresholds. There is no stored bluff rate, successful-bluff rate, average bid increase, comeback record, ahead record, or behind record. `src/stats.js` tracks `bluffsCaught`, `bluffsLanded`, `callsRight`, `callsWrong`, and Elo for the **legacy** USDC table (`data/stats.json`). The show does not call `Stats`.

### Show store and Render

`src/showstore.js`, `render.yaml`

- Path: `SHOW_DATA_PATH`, else `/var/data/show.json` when that directory exists, else `data/show.json`.
- Blueprint: one web service, disk `arena-data` at `/var/data` (1 GB), health check `/health`, `autoDeploy: true`. One instance is required because the disk and the lock assume a single writer.
- Document shape: `{ v: 1, seq, pairIdx, bootstrapDone, records, history, market, current, upcoming, interrupted, cashValue: 0, custody: false, realMoney: false }`. `load()` returns null unless `v === 1`, and a null book bootstraps a fresh show (tested).
- Lock file `show.json.lock` holds the pid. Wait is 15 s (`LOCK_WAIT_MS`). A dead pid is cleared. A live pid is not stolen. `save()` writes `show.json.tmp`, fsyncs, renames. SIGTERM and SIGINT release the lock and `process.exit(0)` (tested in `test/showstore.test.js`).
- Buy timestamps for the 12-per-60s slow-down live in the same file (`simmarket.js` `buysAt`). Career series is the predictor’s `settled` list, capped at 100, and is not backfilled for older predictors (tested in `test/career.test.js` and `test/simmarket.test.js`).

Phase 2 may add fields inside `records[id]`. It must keep `v: 1` readable. A new required field that makes old files fail `v` check will wipe the book. Prefer optional fields with defaults in `Records.load`.

### HTTP surface (show mode)

| Method | Path | Role |
| --- | --- | --- |
| GET | `/` | `public/app.html` |
| GET | `/static/*` | CSS/JS from `public/` |
| GET | `/health` | Process health |
| GET | `/api/show?predictor=` | Snapshot: live card, upcoming, hot, rivalries, fresh, your reads, you, `watching` |
| GET | `/api/show/events` | SSE. Each message is a full snapshot (`type: "state"`) or a play event (`BID`, `CALL`, `REVEAL`, `LOCK`, `SETTLED`). |
| GET | `/api/show/agents` | Cast list with record, form, streak, `knownFor` |
| GET | `/api/show/agents/:id` | Profile fields plus rivals and moments |
| GET | `/api/show/history` | Last ≤100 stories: title, dek, seats, winner, share text. No engine log in the list. |
| GET | `/api/show/matches/:id` | Full archived row, including `engineLog`, when the id is in history |
| GET | `/api/show/matches/:id/replay` | `{ oracle, events: engineLog, story, share }` |
| GET | `/api/show/leaderboard` | Predictor accuracy / test PnL. `unit: "test-credits"`, `cashValue: 0` |
| POST | `/api/show/predictors` | Open or return a predictor |
| GET | `/api/show/predictors/:id` | Career view plus open position on the live match |
| POST | `/api/show/predictors/:id/theory` | Personal tags. Not a public theory feed. |
| POST | `/api/show/markets/:id/buy` | Test-credit pick |
| POST | `/api/show/test/play` | Only if `SHOW_TEST_HOOK=1` |

Legacy routes that remain registered in show mode: `/api/agents`, `/api/bet`, `/api/pool`, `/api/balance/:id`, `/api/leaderboard`, `/api/state`, `/events`, `/legacy`, `/arena`, `/agents`, `/leaderboard`, `/how-it-works`. The spectator app does not call them.

`snapshot().watching` is `this.clients.size`: open SSE responses, including the spectator’s own `EventSource`. The Arena kicker prints `N watching` when that number is > 0 (`public/app.js`). It is a connection count, not a unique-human audience, and it is not a fabricated metric.

### Static frontend and client state

Lead UI: `public/app.html`, `public/app.css`, `public/app.js`, plus `motion.js`, `soundcues.js`, `presence.js`, `career.js`. Cache-bust query `?v=11`. No framework. `#view` is re-rendered as an HTML string. Tabs are Arena, Agents, Watch, History, Profile (`data-tab`). Column max width is 480px on every viewport.

Client memory (all in `app.js`, lost on refresh except the keys below):

| State | Where it lives |
| --- | --- |
| Predictor id | `localStorage["ldaPredictor"]`, pattern `[a-z0-9]{8,40}` |
| Mute | `localStorage["ldaSound"]`. Missing value stays muted (`presence.js`, tested). |
| Snapshot | `snap` from `GET /api/show` |
| Pick on the live match | `position` from `live.market.you`. Cleared when the next match has no position. |
| Career | `me` from the snapshot `you` block |
| Agents, history, leaderboard | Fetched when those tabs are open |
| Motion | Diff of the previous live card (`ldaMotion.motionBeats`). First snapshot is still (tested). |
| Sound | Diff of the previous live card (`ldaSoundCues`). First snapshot is silent (tested). |
| Replay | Frames built from the stored engine log (`replayFrames`). Reduced motion jumps to the last frame and does not autoplay (tested). |
| Connection | `presence.foldShow`: boot, down, hold (4.5 s grace), up. A dropped poll keeps the last Arena/Watch frame (tested). |

Transport: poll every 2000 ms, plus `EventSource("/api/show/events")` whose handler ignores the payload and calls `poll()`. Thoughts on the `BID` SSE event never reach the DOM. The rendered match is the polled snapshot.

Portrait marks are a letter in a circle colored with `hsl(hue)`. There are no portrait assets.

### What `npm test` covers

Passed in this audit: `engine`, `agents` (legacy LLM fallback), `betting` (legacy pool math), `showrunner`, `showhttp`, `showstore`, `simmarket`, `career`, `motion`, `soundcues`, `presence`.

Not covered by tests: measured bid/call rates per character, pacing dwell by state, the live dice-count update on reveal, desktop layout, or any browser session.

## 2. North star

Brief loop: **SEE → PICK → WATCH → REACT → LEARN → CARE → PREDICT → SHARE → RETURN**.

| Step | Status | Evidence |
| --- | --- | --- |
| SEE | **Partial** | Arena opens on a live card: two names, records, “Live now”, round or “Picks are open” (`arena()` in `app.js`). The first screen is a card plus “Watch & pick”, not the match already in motion. Dice, the bid, and the LIAR beat are on Watch. |
| PICK | **Implemented** | “Who's got this?” one-tap buttons, 50 test credits, copy that they are not cash (`picker()`). Upcoming cards accept a pick ahead. **Tested** through `SimMarket.buy` and the showrunner pick/settle assertions. |
| WATCH | **Partial** | Watch renders seats, bid chip, headline, reveal tally, and the user’s pick (`tableView()`). The layout is a side-by-side VS, not the brief’s stacked portrait arena. There is no event feed on the live table. |
| REACT | **Partial** | LIAR chip, red flash, gold seat ring, tally count-up, payoff YES/NO. No character reaction states. |
| LEARN | **Partial** | Payoff shows `story.lesson` from the last challenge only (`narrative.js`). Profile shows record, form, and at most one `knownFor` string. No in-match tendency grounded in stored history. |
| CARE | **Partial** | Streak ≥ 3 can surface as “Hot”. Rivalries are a win–loss series after 2 meetings. No upset, last match, or next booking on the rivalry itself. |
| PREDICT | **Implemented** | Test-credit book, lock on play, settle against `resultHash`, career PnL series, profile accuracy and streak. **Tested.** |
| SHARE | **Partial** | One 720×960 canvas, Web Share or download, replay hash `#replay=`. No 9:16, 1:1, or 16:9 masters. No video. |
| RETURN | **Partial** | After settle, the loop opens the next match (`settleHoldMs`, 12 s in code). Arena lists four upcoming books. No measured return rate (brief section 42 metrics are **Missing**). |

## 3. Gap analysis (brief sections 4–38)

### 4. AI gameplay — **Partial**

**Designed:** each decision considers own dice, bid, dice left, round, opponent behavior, personality, risk, score, ahead/behind, recent bids, and history when memory exists.

**Implemented:** own dice, current bid, total unknown dice, a probability slack check, aggression threshold, chaos face swap. Legal-move fallback if the action cannot raise.

**Missing from the decision:** round, per-opponent history, ahead/behind, recent calls, anything in `Records`. Personality text is not an input. The same function serves all 12 characters.

### 5. Agent personalities — **Partial**

**Designed:** 4–6 agents whose models produce measurable differences. Dracula raises harder and bluffs more. Caesar bids smaller and calls on evidence. Reaper is controlled-random, not uniform noise.

**Implemented:** 12 characters. Dracula `aggression 0.86 / chaos 0.12`, Caesar `0.22 / 0.02`, Reaper `0.58 / 0.62`. The test locks a unique pair for every id, including Athena `0.16/0.04` and The Monk `0.10/0`. That is a unique costume on one heuristic. It does not encode “larger bid increases”, “pressure when ahead”, or “smaller increases and a higher call bar” as separate rules. Chaos is `Math.random() < chaos` then a uniform face, which is the noise the brief tells Reaper not to be.

Shrinking the cast would break `eq(CAST.length, 12)`. Phase 2 should deepen the three featured models and leave the other nine on their current scalars.

### 6. Agent memory — **Partial**

**Designed:** career W–L, streak, form, opponent record, bluff frequency, successful bluff rate, call frequency, successful call rate, average bid increase, comeback record, ahead record, behind record.

**Implemented:** the `Records` table in section 1. Call success is stored only as `correctCalls / challenges` and is not shown as a rate except via the `knownFor` gate. A “big bid” is a count at least 55% of dice that hand, not a bluff (the agent’s hidden dice are not compared).

**Missing:** the rest of the designed stats. Do not display a bluff rate until a match logger writes one.

### 7. Agent adaptation — **Missing**

No threshold moves because an opponent bluffed or called. Rivalry rows are spectator series only.

### 8. Never fake AI intelligence — **Partial**

Grounded today:

- `matchStory` titles come from the engine log (last challenge, whether the winner was ever down a die). **Tested.**
- `bidAside` (“He's pushing hard.” / “That's a huge claim.”) uses the live bid, dice share, and the static aggression number. It does not claim a memory.
- Profile theories are labeled “Your notes. Not an official label.”
- `knownFor` stays null until the thresholds in section 1.

Ungrounded copy:

- Arena “New” says “First match is this one.” for `snap.fresh[0]`, the first cast member with `played === 0`. That person is not necessarily seated in the live match. Bootstrap plays 12 pairs and can leave several characters at 0 played (`SHOW_BOOTSTRAP` default 12, schedule length is C(11,2) = 55).
- Strength/weakness sentences are author copy, not measurements.

`MockAgent.thought` is computed and attached to the `BID` SSE event (`showrunner.js`). The client never renders it. Replays rebuild lines from the engine log, which has no thought field.

### 9. Match pacing — **Partial**

**Designed states:** Normal, Interesting, Critical, Call, Reveal, Result.

`classifyPace()` returns only `normal`, `interesting`, or `critical`. Critical means someone has ≤1 die, or a challenge while someone has ≤2. A challenge or a bid ≥ 55% of dice is `interesting`. Everything else is `normal`.

Sleep in `playExhibit`:

- Challenge: `revealDelayMs` if critical, else `0.7 * turnDelayMs`.
- Bid: `1.5 * turnDelayMs` if critical, else `turnDelayMs`.
- Reveal: always `revealDelayMs`.

`interesting` does not change the clock. There is no Call or Result dwell separate from those branches. The agent resolves the move **before** the sleep, so the spectator sees the bid and then a pause. There is no pre-move “thinking” hold.

On Render, turn dwell is 1600 ms and reveal dwell is 1400 ms. The client holds a reveal beat for 1700 ms (`beatHold` in `app.js`). The next snapshot can replace that beat before the count-up finishes.

### 10. Match viewer layout — **Partial**

**Designed:** portrait stack. Top status, agent A, center table, agent B, bottom pick and a compact feed.

**Implemented:** Watch is agent A | round | agent B in one row (`tableView`), then the test-credit book, bid chip, headline, one line, optional aside, tally, and “you picked”. Arena is a separate card. Bottom tab bar is fixed. Tap targets on the primary controls are ≥44px. `#view { max-width: 480px }` on all widths.

**Missing:** one-handed stacked arena, live event feed, expandable details. No `@media (min-width: …)` broadcast layout in `app.css`.

### 11. Dice presentation — **Partial**

Hidden dice are 20px (16px under 360px) face-down squares. A roll beat adds CSS `shake` / `cup` (about 620 ms). A reveal beat adds `tumble` (about 480 ms, staggered 70 ms). Matching faces get a gold ring; wild ones get a lighter ring. There is no travel-in, bounce, collision, or settle. The illusion is a cup shake and a short tumble. That matches the brief’s “illusion over physics” direction and stops short of the designed sequence.

### 12. Bid presentation — **Partial**

`.bidchip` shows the count, the face word, and the bidder’s name, and strikes the previous bid during the bid beat. A call replaces the chip with “LIAR” plus “on N face”. It is the visual focus of the table. It is not the designed display line (“SIX THREES” with “DRACULA RAISES” underneath).

### 13. AI thinking state — **Missing** on the show

The legacy table (`public/index.html`) animates the word “thinking”. The show snapshot has no thinking phase. `MockAgent.act` returns immediately.

### 14. The LIAR moment — **Partial**

**Implemented, in one snapshot:** headline `LIAR.`, red bid chip, `.slam` scale, `.slam-flash` (red wash, 420 ms), caller seat gets `.hot`, bidder gets `.marked`, dice shake because a call beat counts as rolling.

**Missing from the designed 11-step sequence:** ambience drop, a held darken, a camera move onto the caller, a dedicated pause, a move onto the dice, then reveal as a later beat. Call and the following reveal are two server events, so they can be two snapshots, but the client does not stage the designed sequence between them. Character reactions are absent.

### 15. Dice reveal — **Partial**

**Implemented:** faces render, matches and wilds are marked, `.tally` counts up to `countShown` (ones wild, same rule as the engine), a verdict line says the bid stands or the bidder loses a die, headlines are `HE WAS TELLING THE TRUTH.` or `HE WAS BLUFFING.`

**Gap:** `playExhibit` emits `REVEAL` **after** `Match.applyAction`. On a challenge that does not end the match, `applyAction` already starts the next hand. `_syncDice` runs on reveal only when `matchOver` is true (`_playOpen`). Mid-match seat dice counts therefore stay on the pre-loss numbers until the next `BID`, which is the next event that calls `_syncDice`. The lose-die motion compares seat counts across snapshots, so the die loss can animate on the following bid instead of on the reveal. Replay frames built from the engine log do show the loss on the following `hand_start` (`motion.js`), which is a different timing than the live card.

### 16. Character reactions — **Missing**

No states for neutral, thinking, confident, successful bluff, failed bluff, successful call, failed call, victory, or defeat. Seats toggle CSS classes `hot`, `marked`, `cool`, `out`, `hit`.

### 17. Visual direction — **Partial**

The show palette is ink, ivory, and gold on `#0e0d0b`, with Fraunces for names and Outfit for UI. It does not use a neon dashboard on `/`. Legacy pages still do the crypto landing. The show has no broadcast camera language (section 30).

### 18. Color system — **Partial**

Live dot `#d4543c`. Win/truth `#9ddeaf` (`--good`). Miss `#e3a090` (`--bad`). Gold `#e4c27a` is both the brand accent and the prediction accent. Agent identity is a hue on the ring only. Critical is a larger headline, not an amber token. Several roles share gold.

### 19. Typography — **Partial**

Fraunces is used for agent names, headlines, the bid quantity, and payoff. Outfit is used for records, tabs, and body. Bid face text is 16px next to a 28px count, not a full display bid. Rivalry titles and highlights do not have their own display treatment.

### 20. Character art — **Missing**

Letter marks only (`mark()` in `app.js`). No portrait, pose, or expression set.

### 21. Agent profile — **Partial**

`agentDetail()` shows name, archetype, record, streak, win rate, played, static style line, strength, weakness, `knownFor` when the gate passes, form, rival series, up to 6 winning moments, and personal theory tags.

**Missing:** signature numbers (bluff rate and the rest of section 6), a public “people think” aggregate, notable moments that are not only the winner’s story title.

### 22. Rivalries — **Partial**

`topRivalries()` returns up to 3 pairs with `meetings >= 2`, series `wins–losses` from the first character’s point of view, sorted by meetings. The profile lists every opponent the same way. Scheduling prefers a hot character’s most-played rival when that rival is free.

**Missing:** last match, biggest upset, rivalry streak, next scheduled meeting, timeline, and a different presentation when a rivalry match is live.

### 23. Arena / home — **Partial**

**Implemented modules, and the data rule they follow:**

| Brief module | Show module | Data |
| --- | --- | --- |
| LIVE NOW | Live card | The actual current match. |
| HOT MATCHES | “Hot” | Real streak ≥ 3. Hidden when nobody has one. |
| RIVALRIES | One rivalry button | Real series after 2 meetings. |
| NEW AGENTS | “New” | `played === 0`. Copy over-claims; see section 8. |
| YOU MISSED THIS | — | **Missing.** |
| INSANE MOMENTS | — | **Missing.** No moment ranked by rarity. |

“Coming up” is four real booked matches with open test-credit prices. `watching` is the SSE connection count described above.

### 24. Watch page — **Partial**

Watch is the live table or the payoff, not a catalog of finished matches. Finished matches are the History list: a title, a dek, and the two names. Cards do not answer “why should I care?” with a clip length or a highlight. There is no `WATCH 0:42` because there is no clip duration.

### 25. History page — **Partial**

Each row is `story.title` and `story.dek` from `matchStory`, plus a replay built from `engineLog`. The page also draws the predictor’s career line (`career.js`) from recorded settled picks only.

**Missing on the story object:** biggest bluff, best call, a separate turning point beyond “winner was down a die at some hand_start”, rivalry consequence, highlight clip. The log under the replay is every bid, challenge, and the winner. That is closer to a transcript than to the designed story archive, with a title on top.

### 26. Highlight engine — **Partial**

`matchStory().highlights` can contain `bluff`, `comeback`, and `call` items with a text line and sometimes a hand number. They are stored inside the archived story. Nothing reads `highlights` in `public/`. There is no importance score, timestamp, event type catalog, or query for “insane moments.” Detection does not look at bid risk against the bidder’s dice, upsets versus price, streaks, or rare counts. Comeback means the winner’s die count was lower than the opponent’s on some `hand_start`, which is common in a 5-die match and is not a final-die comeback.

### 27. Share system — **Partial**

`shareCard()` builds title, body, optional “WIN STREAK: N” when streak ≥ 3, and `href: #replay=`. `drawShareCard` paints one 720×960 PNG. `doShare` uses `navigator.share` with the file when the browser allows it, otherwise share text, otherwise download plus clipboard. The card says “Test credits. Not real money.”

**Missing:** 9:16, 1:1, 16:9, video, and a highlight sentence of the “one die left” kind unless that happens to be the story dek.

### 28. Sound — **Partial**

WebAudio blips in `app.js` `CUES`: pick-open, pick-locked, bid, call, reveal, settle-win, settle-miss. Mute defaults on. The header button is a 44px control and is wired to `ldaSound`. **Tested:** first snapshot emits no cues; stored `"1"` is the only unmute flag.

**Missing:** ambience, dice collision, per-agent motifs, and a level drop under LIAR. The game is fully usable muted because every state is also text.

### 29. Motion — **Partial**

Client holds: reveal 1700, settle 1500, lose-die 980, call 880, roll/start 820, bid 720, else 640 ms. CSS transitions on tabs are 200 ms. Replay holds are similar (`REPLAY_HOLD`). `prefers-reduced-motion` collapses animation duration and hides confetti (`app.css`) and skips beat playback. Motion is transform and opacity, which is the right performance instinct.

**Missing:** a documented token scale (100–250 / 200–500 / 1–4 s) shared by server dwell and client holds. Server critical bids are `1.5 * turnDelay` (2400 ms on Render) with no matching camera.

### 30. Camera — **Missing**

No wide, push, decision focus, close-up, dice focus, or pullback. Seat emphasis is a box-shadow and opacity.

### 31. First session — **Partial**

A new predictor sees an empty career and the “No picks yet” line. Picks are one tap. The match does not wait for the pick: `loop()` sleeps the pick window and then plays. There is no timed script (0:03 names, 0:30 suspicious raise, 1:00 tendency). Bootstrap matches are real plays, not a scripted tutorial. Connection loss keeps the last frame (**Tested** in `presence.js`).

### 32. Prediction experience — **Implemented**

WHO WINS is the picker and the upcoming buttons. After settle, the payoff shows the pick, YES/NO, test PnL, balance, and a compact career chart. Credits are labeled test credits in the chip, the picker, the profile, and the share card. **Tested** for grant, lock, stake caps, settlement, career series, and restart.

There is no public ranking beyond the in-profile leaderboard of predictor ids (other ids are shown raw, not as names).

### 33. Future prediction-market handoff — **Implemented** as a seam

Oracle on each archived match: `matchId`, `winnerId`, `seed`, `resultHash` (sha256 over a reduced event list), `rules: "liars-dice-common-hand-ones-wild-v1"`. Snapshot `partner.status` is `"not_contracted"`. **Tested.** No partner adapter exists. Phase 2 must not build one.

### 34. Blockchain UX — **Implemented** on `/`, **still present** off the lead UI

`app.html` has no wallet, gas, chain, or token balance. Legacy HTML still links out to buy `$LIAR`. Leave those pages parked.

### 35. Mobile-first — **Partial**

Viewport, safe-area padding, 44px tabs and mute, large pick buttons, wrapping names, 16px dice on very narrow screens. The live table is still a three-column VS, so long names and five dice compete on a 360px screen (the 360px media query only shrinks dice and type). No device lab results exist in repo. Section 8 of the brief (mobile performance pass) is a later phase; do not claim phones were tested.

### 36. Desktop — **Missing**

The 480px column is the desktop UI. There is no side rail, event column, or replay timeline.

### 37. Performance — **Partial**

No image cast, no WebGL, no framework bundle. Google fonts are render-blocking (`app.html` stylesheet). `backdrop-filter: blur(8px)` on the header. Full `#view` innerHTML replacement every poll that changes the HTML string. Poll is 2 s even when SSE is connected. Reduced motion is implemented. No load-time or low-end measurement is in the repo.

### 38. Accessibility — **Partial**

Mute, reduced motion, 44px targets, `aria-live` on the table line, `aria-label` on the tally and the sound button, career chart has text alternatives in `career.js`. Color is backed by text for truth/bluff and for YES/NO. **Missing:** keyboard roster for the tab bar (buttons are focusable by default, but there is no documented shortcut and no roving tabindex), and a non-color live state for “whose bid” beyond the name inside the chip. Dice pips are visual; the tally text carries the count.

## 4. Phases 2–7, mapped

Do not start these in the audit PR. Order is the brief’s order.

| Phase | Brief | Starting point in this repo | Status |
| --- | --- | --- | --- |
| 2 Gameplay | Decisions, differentiation, pacing, state clarity, event logging, agent statistics | `MockAgent.act`, `playExhibit`, `Records`, `classifyPace` | **Partial** foundation. The checklist below is the kickoff. |
| 3 Match viewer | Arena, dice, bid, thinking, LIAR, reveal, victory | `tableView`, `motion.js`, `app.css` motion block | **Partial.** Do not restyle until Phase 2 events are stable. |
| 4 Visual system | Type, space, cards, color tokens, agent accents, timing | `:root` in `app.css` | **Partial** tokens, no shared timing module. |
| 5 Agent system | Profiles, behavior stats, form, rivalries, reactions | `agentDetail`, `Records` | **Partial.** Reactions **Missing.** |
| 6 Content | Watch catalog, story history, rivalry pages, highlights, share cards | History list, `matchStory`, one PNG | **Partial.** |
| 7 Audio and camera | Ambience, camera states, reaction polish | Blips only | **Missing** beyond the blips. |
| 8 Mobile/performance | Device pass | Not started | **Missing.** |

## 5. Phase 2 kickoff checklist

Hand this list to the next agent. One PR per slice. Each slice must boot on a single Render instance, keep the show lock, and keep existing `show.json` files loadable.

### Guardrails for every slice

- Stay on the show path. Do not call `LLMAgent` from `makePlayer`. Do not change `/api/bet` or wallet code.
- Keep `CAST.length === 12` and the existing ids. Tests fail otherwise.
- Keep `show.json` `v: 1`. New record fields must default inside `emptyRecord` and `Records.load` so a file written by `f0d2e81` still loads.
- Do not re-seed or delete `/var/data/show.json` in production. Local tests use a temp file, as `test/showstore.test.js` does.
- `process.once("SIGTERM")` in `showstore.js` exits the process. Do not add a second SIGTERM handler that skips the unlock.
- `autoDeploy` is on. A merged PR deploys. These slices are still reviewable one at a time.
- If a slice changes decisions, the same `seed` plus the same call index must reproduce the same actions. Today it does not (`Math.random` in `MockAgent`).
- `finishInterrupted()` re-runs `playExhibit` from the seed. After decisions become seeded, a match killed mid-play will settle as the match the seed defines, which can still differ from bids already streamed if the process died after some `Math.random` calls. Document that in the PR. Do not pretend an in-flight legacy random match resumes bit-for-bit.
- Commentary added in Phase 2 may only quote fields `Records` actually stores. No “Caesar remembers” until an opponent-specific stat exists.
- Run `npm test`. Add assertions for the new behavior. Do not weaken `cashValue === 0` checks.

### Slice A — Reproducible decisions (do this first)

Files: `src/agents.js`, `src/showrunner.js` (`playExhibit`), `test/showrunner.test.js` or a new `test/decisions.test.js`.

- Pass a rng derived from the match seed into `MockAgent` (or into `act`). Remove `Math.random` from the show path.
- Assert two `playExhibit` calls with seed 42 and Dracula vs Caesar emit the same bid/challenge sequence.
- Assert a different seed can differ. Do not assert a specific winner unless you pin the sequence; the current test only checks that someone wins.

Deploy note: interrupted matches saved before this slice still re-sim. That was already true.

### Slice B — Decisions that use the table, not a new personality

Files: `src/agents.js`, `src/characters.js` (read the existing scalars; do not add a 13th character).

Give the featured three extra branches inside `act`, still legal under `isHigherBid`:

- Dracula: when his die count is greater than the opponent’s, allow a larger count step than +1, gated by aggression. When he is behind, do not invent a “scared” mode the brief did not ask for; he stays aggressive.
- Caesar: raise by the minimum legal step unless slack supports the count he already holds. Call when slack is worse than a tighter threshold than Dracula’s `-1 - aggression`.
- Reaper: replace uniform face noise with a bounded mix (for example, best face or second-best face, or a count that is honest or honest+1), chosen from the seeded rng. Rate of the wild branch should be `chaos`, not an extra `Math.random`.

Add a headless report, not a UI: over a fixed set of seeds, log for each id the mean bid step, challenge rate, and rate of bids above `bestHeld + expected`. Assert Dracula’s mean step and bluff rate exceed Caesar’s, and Reaper’s face choice is not always the best face and not uniform. Print the numbers from the test. Do not hard-code production win rates into copy.

Leave Athena, Shark, Oracle, Fox, Brutus, Monk, Siren, Miser, and Jester on the current formula so their unique scalar pairs stay meaningful.

### Slice C — Stats the decisions and the copy are allowed to use

Files: `src/showrunner.js` `Records`, `src/engine.js` only if the log must carry a fact the show cannot see. Prefer computing at `noteBid` / `noteCall` time.

Persist, per agent, only what the match can prove:

- Bluff bid: a bid whose count is above the bidder’s own matches plus expected matches from unknown dice at decision time. Store attempts and how often that bidder later lost the challenge (`bidWasTrue === false` and they were the bidder).
- Call attempts already exist (`challenges`, `correctCalls`). Expose the rate in `agentDetail` only after the existing sample gate (6), as a number computed from those fields, not a new sentence.
- Bid step: sum and count of `(newCount - previousCount)` so an average exists.
- Ahead / behind: at each resolved hand, whether the actor had more dice than the opponent, and whether they won the match. Store counts, not a story.
- Opponent bucket: under `rivals[id]`, optional `bluffAttempts` and `calls` once Slice B is reading them. Adaptation itself can be a later slice.

`knownFor` may gain a third clause only if the new counters clear an explicit sample floor. Until then it stays the two clauses in `knownFor()` today.

Do not show these numbers in the Phase 2 UI if the slice is server-only. A one-line addition on the agent profile is acceptable if it renders the stored fraction and the sample size (“4 of 11 big bids were bluffs”). Skip the line when the sample is under the floor.

### Slice D — Pacing that the clock actually follows

Files: `src/narrative.js` `classifyPace`, `playExhibit` sleeps, a small test with a fake `sleep` that records milliseconds.

- Map the six designed states onto the sleep: normal = `turnDelayMs`, interesting = a modest multiple, critical = the longer multiple, call = its own hold, reveal = `revealDelayMs`, result = the existing `settleHoldMs` (already in `loop()`).
- Use `interesting`. Today it is dead.
- Emit `narrative.pace` with that state name so Phase 3 can read it. The client already prints a larger headline when `pace === "critical"`.
- Keep sleeps skippable when the show passes `sleep: async () => {}` (bootstrap and tests).
- Do not add a fake thinking delay that blocks the engine longer than the state table. A thinking snapshot, if added, should be a short client hold on an event that says who is to move, not a second AI pass.

### Slice E — State clarity for the viewer (still no visual redesign)

Files: `src/showrunner.js` `_playOpen` / `playExhibit`.

- On `REVEAL`, sync seat dice to the post-loss counts, or send both `reveal` (the faces just shown) and `counts` from **before** the next hand’s roll. Today mid-match `_syncDice` waits for the next bid, so the live lose-die beat is late (section 15).
- Put the caller id on the live `bid` object. `challengerOf()` in `app.js` guesses by comparing names. A wrong guess mis-rings the seats.
- Include `pace` and, if Slice C exists, the one stat the aside is allowed to mention. Persist thoughts only if they are stored on the engine log and the replay can show them. Dropping them on the SSE event, as now, means the client will keep ignoring them.

### Explicitly out of Phase 2

Match-viewer layout, character art, camera, ambience, highlight ranking, share aspect ratios, rivalry pages, desktop rails, font loading, and any real-money or chain work. Those are Phases 3–7 and section 41 of the brief.

### Suggested PR order

1. Slice A (seeded rng) — smallest, unblocks honest tests.
2. Slice B (three personalities) — the gameplay bet.
3. Slice C (stats) — only after B, so bluff means the decision’s own definition.
4. Slice E (reveal counts and caller id) — deploy-safe spectator truth, still no CSS redesign.
5. Slice D (pacing clock) — after E, so a slower reveal is showing the right dice.

Each PR: `npm test`, note Render single-instance lock, and say whether `finishInterrupted` behavior changed.

## 6. Files read for this audit

`server.js`, `render.yaml`, `package.json`, `README.md`, `src/showrunner.js`, `src/showhttp.js`, `src/showstore.js`, `src/simmarket.js`, `src/engine.js`, `src/agents.js`, `src/characters.js`, `src/narrative.js`, `src/llm.js`, `src/stats.js`, `src/arena.js`, `src/betting.js`, `src/registry.js`, `src/wallet.js`, `public/app.html`, `public/app.js`, `public/app.css`, `public/motion.js`, `public/soundcues.js`, `public/presence.js`, `public/career.js`, and the test files named above. Legacy pages were identified by route table and by the `$LIAR` links in `public/landing.html`, `public/index.html`, `public/agents.html`, `public/how.html`, and `public/leaderboard.html`.
