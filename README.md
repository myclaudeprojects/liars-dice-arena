# Liar's Dice Arena

AI characters play Liar's Dice. You watch, pick a winner, and see if you were right.

Phase 1 is a mobile spectator sport. It works with **zero wallets, tokens, or real-money markets**. The show prices a match-winner test market and four props (round 1, a 2+ round margin, under 90 seconds, and 25+ dice rolled) with LMSR and settles them in Arena Credits. Those credits have no cash value: no deposits, withdrawals, transfers, or conversion. The books lock when the match starts. Props settle from the match log, then the winner market pays from the server result. `TEST_MARKETS=0` runs the same matches with the book off. LDA is not a real-money exchange. A future regulated partner could settle real-money contracts from the match id and result hash. That partner is not wired here.

The architecture audit for the next spectator upgrades is [docs/spectator-premium-audit.md](docs/spectator-premium-audit.md). It records what the show already does. It does not change the game.

```bash
npm start    # http://localhost:3000  — Arena / Agents / Watch / History / Profile
npm test
```

Open the site, tap **Watch & pick**, confirm a test trade, and stay for the reveal. No signup. Sound stays muted until Unmute. A dropped connection keeps the last Arena and Watch frame up instead of a blank table. A new predictor sees an empty career line, and History says so when no stories have finished. Arena also shows the next four matches. Test-credit balances and settled history are written to `SHOW_DATA_PATH` (on Render, `/var/data/show.json`; otherwise `data/show.json`). History keeps the latest 100 settled matches. A predictor's career chart keeps the latest 100 settled picks. Profile and History draw that series as an equity line with total test PnL, win rate, and recent calls. The line uses recorded points only. Buy attempts from the last minute are stored in that same file, so a restart still enforces slow-down. Predictors saved before the career series existed keep their total PnL and an empty chart; those points are not invented. One process holds `show.json.lock`. On a rolling deploy the next process waits up to 15 seconds for that lock, and the owner releases it on SIGTERM, SIGINT, and exit. A dead pid is cleared. If the lock is still held, the new process refuses to write. Each save fsyncs `show.json.tmp` and renames it into place. A leftover `.tmp`, or a file that is not valid version-1 JSON, is ignored and the show starts a fresh book.

`LEGACY_USDC=1 npm start` boots the older on-chain spectator table. That path is parked, not the product.

## Argus token launch (optional)

Create Agent can launch a Portal #7 token on Arc (chain id 5042). There is no Argus REST create API. Set `ARGUS_MINT_ENABLED=1` on the host. Leave it unset and Create Agent stays a spectator-only save. The server confirms a launch receipt on two Arc RPCs before saving it.

Create Agent launches the token by itself when `ARGUS_MINT_KEY` is the key for the house wallet `0x341BB8851Ff8fD9EAE20ea083c2F779e646B8488`. Confirm starts the server mint. The reveal shows status only (“Creating token…” then “Done” and Buy on Argus). There is no Launch, Connect, or Sign button on that path, and the agent profile does not offer Launch on Argus either. A rejected estimate is retried once on the server before the spectator sees anything. Each Arc read has a timeout, and a failed or timed-out mint always logs `argus_sponsor` with the revert name, selector, or message. The broadcast hash is saved before the receipt is confirmed. The next silent retry confirms that same hash, or a TokenCreated log already mined for this name and ticker, instead of launching a second token. If it still fails, the page says the token will retry and the agent can still play. Opening that agent's profile tries the mint again with no button. On Portal #7 the on-chain creator is the house wallet, so the creator allocation accrues there. The spectator who created the agent is promised a share of trading fees; the house pays that cut. It is not an on-chain split at mint time. `ARGUS_MINT_KEY` is a dedicated Arc key set only in the Render dashboard. Do not commit the key, and do not reuse `HOUSE_PRIVATE_KEY` or a seat wallet. The mint wallet pays Arc gas. A dev buy is refused on the server path so the key does not spend quote inventory. If the key is missing, or its address is not the house wallet, the older wallet form stays available and the agent stays playable. A failed launch never blocks Create Agent.

Portal #7 is the default. `launch` has no fee-recipient argument and no on-chain split with the spectator. The 100% creator share accrues to the signing wallet. The spectator who created the agent is promised a share of trading fees; the house pays that cut off-chain. It is not an on-chain split. Existing Portal #7 tokens (including ones already minted) stay on Portal #7. There is no migration.

Set `ARGUS_PORTAL=8` or `ARGUS_PORTAL8_ENABLED=1` to mint **new** tokens on Portal #8 instead. Portal #8 is `0xeed7559B8A6ABf64427dc41Cb5cc6400109C5D93` on Arc. The house wallet is still `msg.sender` and the payout control address. Portal #8 requires an opening buy paid by that wallet (on USDC, 0.01% of the 45,000 bond, which is 4.50 USDC). The server reads `minSeedPpm` and `economicsFor` and approves that amount to the Portal before `launch`. Leave the flag unset to keep Portal #7. A failed Portal #8 attempt is not retried as a Portal #7 mint.

After a Portal #8 mint, the server calls `setPayoutSplit` on the creator registry `0x986B478bE2F05b44b47c61E26a0BbcBcC07610eD`. The split is 5000 bps house and 5000 bps spectator, totaling 10,000. The spectator address is optional at Create (paste, or “Use connected wallet”, which only reads the address). If it is missing, the payout stays house-only on-chain and the agent record stores `feeSplit.status = "pending"`. The profile then accepts a wallet and the house signs `setPayoutSplit`. `POST /api/show/agents/:id/argus/payout` with `{ "spectatorFeeWallet": "0x…" }` does the same. Anyone can call `claimCreator()` on the payout escrow; payment goes to the split. The profile links the Argus token and `https://argus.world/claim`. The spectator wallet is stored as `spectatorFeeWallet`, separate from `argus.creatorWallet`.

Manual check before turning the flag on in production: fund the house mint wallet with Arc gas and at least 4.50 USDC per new agent; set `ARGUS_MINT_ENABLED=1`, `ARGUS_MINT_KEY`, and `ARGUS_PORTAL=8`; create an agent with a fee wallet and confirm the token page plus `feeSplit.status = "set"` and two 5000 bps recipients; create another with the wallet blank and confirm `pending`, then set the wallet from the profile; open an older Portal #7 agent and confirm it still shows Buy on Argus and refuses the payout route with `portal7`.

The launch form is prefilled from the agent and the house profile. The image URL is the canonical portrait Create Agent already saved, including its `?v=&s=` query. That query is accepted by Portal #7. `PUBLIC_BASE_URL` can stay on the onrender.com host. Website and X default to `https://liarsdicearc.app/` and `https://x.com/LiarsDiceArc`. Telegram is left blank unless `LDA_TELEGRAM_URL` is set. The form still defaults to 100% creator, 0% dividends, 0% burn, and 0% LP. The house wallet's Argus reward mode is QUOTE, so every launch it signs clones a reward tracker. A zero dividend then reverts `RewardTrackerWithoutDividend`. The server reads that mode and, only when it is not NONE and the dividend is still 0, moves one basis point (0.01%) from the creator share onto dividends. An explicit dividend is left alone. The house wallet above is shown read-only.

Render env vars: `ARGUS_MINT_ENABLED`, `ARGUS_MINT_KEY`, `ARGUS_PORTAL` or `ARGUS_PORTAL8_ENABLED`, `PUBLIC_BASE_URL`, `LDA_SITE_URL`, `LDA_X_URL`, `LDA_TELEGRAM_URL`, `ARGUS_CREATOR_WALLET`, `ARC_RPC_URL`, `ARC_RPC_URLS`. Sponsored sends are limited per spectator session and per IP. Portal #8 market cap uses the stored pool id and the shared StateView. Portal #7 market cap is unchanged.

A minted token is shown on that agent's page: Buy on Argus, the ticker, a shortened token address, market cap, and holder count. Market cap is the Portal #7 pool price times total supply, read with the same Arc RPC list (`ARC_RPC_URL`, `ARC_RPC_URLS`, then the public defaults). The first endpoint that answers is enough. Holder count is Arcscan's non-zero holder total (`https://api.arc-scan.org/v1/tokens/{address}`). A full quote is reused for 60 seconds. A missing figure is reused for 15 seconds. The profile still shows the Argus link when a number is unavailable.

## Arena token ($LIAR)

The header and Profile show **Buy $LIAR** before anyone creates an agent. That link is the arena coin, not an agent token. It opens argus.world in a new tab. The app does not swap, and Arena Credits stay test credits with no cash value.

Unset, the contract is `0x47c3D4490C1e8B9ed71464e333AD9D5ce7D20790` (Liar's Dice Arena, symbol LIAR). `LDA_LIAR_TOKEN_ADDRESS` replaces that address and the default Argus URL. `LDA_LIAR_BUY_URL`, when it is an http(s) URL, is used instead of `https://argus.world/token/<address>`. A bad address or URL keeps the default. `GET /api/show/argus/config` publishes this as `arenaToken`, including when Portal #7 minting is off. On a narrow screen the header button is a full-width row under the title, so it stays in the sticky chrome.

The rest of this file describes that older table.

Why this is new tech rather than another dApp:

- The **players are LLMs with wallets**. Every ante, pot payout, stake and
  spectator payout is a real USDC transfer. You can read an agent decide to
  bluff, then watch the money move.
- **Arc makes it viable.** Sub-second deterministic finality lets each round
  settle before the next; USDC-denominated gas means a $5 pot isn't eaten by
  fees; no volatile gas token to manage for the agents.
- It's **model-agnostic and pluggable**: Claude vs GPT vs a local Ollama model,
  each with its own persona. Different models genuinely play differently.

## Run it right now (no keys)

```bash
node demo.js        # one match in the terminal, heuristic players, mock wallet
npm start           # live spectator UI at http://localhost:3000
npm test            # engine / agent-robustness / betting-math tests
```

The mock wallet is in-memory, so you can watch the full bet → play → settle
loop immediately. The UI shows "mock wallets (no chain yet)" until Circle is
wired.

## Turn on real LLM players

```bash
cp .env.example .env    # fill ANTHROPIC_API_KEY and/or OPENAI_API_KEY
npm run start:llm
```

Personas live in `src/llm.js` (`PERSONAS`). Seats are built in `server.js`
`buildAgents()` — swap in any model you like. `openaiCompatible()` works with
OpenAI, Groq, Together, xAI, or Ollama (`baseUrl: "http://localhost:11434/v1"`).

Bad model output can't stall a match: replies are validated against the live
game state and any garbage/illegal move falls back to a safe legal move
(`src/agents.js` → `parseAction` / `safeFallback`). `test/agents.test.js`
throws deliberately broken replies at it.

## Wire real money on Arc

All money code is in **one file**: `src/wallet.js`. The interface is four calls
(`createSeatWallet`, `createPot`, `getBalance`, `ante`, `settle`) and the game
never touches anything else. `CircleArcWallet` has each call stubbed with a
`TODO(circle)` block showing the intended Circle Developer-Controlled-Wallets
call.

Finish those blocks against Circle's **live** docs rather than trusting any
snapshot — Circle themselves say SDK signatures, token ids and chain identifiers
change often and should be pulled from their MCP server. Checklist:

1. Create a Circle developer account, an API key and an entity secret
   (developers.circle.com → Wallets → Developer-Controlled).
2. Confirm the current package + init call for developer-controlled wallets and
   the Arc testnet blockchain identifier (was `ARC-TESTNET`, chain id 5042002;
   mainnet chain id 5042).
3. Get the Arc USDC token id from the Circle console / MCP; put it in `ante`
   and `settle`.
4. Fund the seat wallets from the Arc testnet faucet.
5. `CIRCLE_API_KEY=... CIRCLE_ENTITY_SECRET=... npm start`.
6. `explorerUrl()` should point at the current Arcscan host so every log line
   links to a real transaction.

Circle's own Arc sample apps are the best reference for the exact patterns:
`circlefin/arc-escrow` (pot/escrow settlement), `circlefin/arc-nanopayments`
(agent wallets + Gateway), `circlefin/arc-fintech` (wallet + webhooks).

### Spectator stakes in production

Today the server hands each spectator an auto-funded mock wallet so the loop is
testable. For real users, the spectator should transfer USDC **from their own
wallet** to `pool.poolWallet.address` (Circle Gateway or any connected wallet);
the server then records the bet once the transfer confirms (webhook or poll),
and payouts go to the address that paid in. `BettingPool.placeBet` is the seam.

## Bring your own agent

Anyone can register a player at `/agents` and it rotates into matches, antes
like any other seat, and can be backed in the spectator pool (by its owner too).

- **Heuristic** — choose an aggression 0–1. Needs no keys; works today.
- **Prompt** — a written persona run on the arena's model (needs an LLM key on the server).
- **Endpoint** — your URL. Each turn the arena POSTs the game view and waits up to
  6 s for `{thought, action}` JSON. Requests carry `x-arena-signature`
  (HMAC-SHA256 of the body, keyed by the agent's key) so you can verify them.

Registration returns an **agent key** (shown once) and a **funding address**.
The agent must hold at least the ante to be seated. Illegal/late replies become
safe legal moves; five in a row benches the agent (`unresponsive`) until the owner
runs `POST /api/agents/:id/test` and it passes. Endpoints on private/localhost
addresses are refused in production (`RENDER` env set) unless
`ALLOW_LOCAL_AGENTS=1`; locally they're allowed so you can develop against
`examples/my-agent.js` (`node examples/my-agent.js` → `http://localhost:4001/`).

Registry lives in `data/agents.json` (`REGISTRY_PATH`), next to the stats file.

## Layout

```
src/engine.js   pure Liar's Dice rules, seeded RNG, structured event log
src/agents.js   MockAgent (heuristic) + LLMAgent (persona, validated JSON, fallbacks)
src/llm.js      Anthropic + OpenAI-compatible fetch adapters, PERSONAS
src/wallet.js   MockWallet + CircleArcWallet (the only money code)
src/betting.js  pari-mutuel math + BettingPool settlement
src/registry.js house + community agents, keys, fair seat rotation, SSRF guard
src/arena.js    runs a match: wallets → antes → turns → settle, emits events
examples/my-agent.js  a complete endpoint agent to copy
server.js       SSE stream, betting window, match cycle, /api/bet
public/index.html  live table: animated deal, chip flights, "Liar!" burst, staggered reveal
public/agents.html register / test / roster + endpoint protocol docs
```

## Ideas for v2

- **Agent-vs-agent side bets**: let agents wager on each other's reveals.
- **Tournaments + leaderboard**: ELO per model, all-time USDC won per persona.
- **x402 seat fees**: agents pay a sub-cent seat fee per hand via Circle
  Nanopayments — the arena funds itself from the tech it showcases.
- **Privacy**: hidden dice are the natural fit for Arc's opt-in privacy
  controls once available to apps — commitments on-chain, reveal at challenge.
