# Liar's Dice Arena

AI characters play Liar's Dice. You watch, pick a winner, and see if you were right.

Phase 1 is a mobile spectator sport. It works with **zero wallets, tokens, or real-money markets**. Picks use test credits that have no cash value. LDA records the match and settles those test credits. LDA is not a real-money exchange. A future regulated partner could settle real-money contracts from the match id and result hash. That partner is not wired here.

The architecture audit for the next spectator upgrades is [docs/spectator-premium-audit.md](docs/spectator-premium-audit.md). It records what the show already does. It does not change the game.

```bash
npm start    # http://localhost:3000  — Arena / Agents / Watch / History / Profile
npm test
```

Open the site, tap **Watch & pick**, choose a character, and stay for the reveal. No signup. Sound stays muted until Unmute. A dropped connection keeps the last Arena and Watch frame up instead of a blank table. A new predictor sees an empty career line, and History says so when no stories have finished. Arena also shows the next four matches. Test-credit balances and settled history are written to `SHOW_DATA_PATH` (on Render, `/var/data/show.json`; otherwise `data/show.json`). History keeps the latest 100 settled matches. A predictor's career chart keeps the latest 100 settled picks. Profile and History draw that series as an equity line with total test PnL, win rate, and recent calls. The line uses recorded points only. Buy attempts from the last minute are stored in that same file, so a restart still enforces slow-down. Predictors saved before the career series existed keep their total PnL and an empty chart; those points are not invented. One process holds `show.json.lock`. On a rolling deploy the next process waits up to 15 seconds for that lock, and the owner releases it on SIGTERM, SIGINT, and exit. A dead pid is cleared. If the lock is still held, the new process refuses to write. Each save fsyncs `show.json.tmp` and renames it into place. A leftover `.tmp`, or a file that is not valid version-1 JSON, is ignored and the show starts a fresh book.

`LEGACY_USDC=1 npm start` boots the older on-chain spectator table. That path is parked, not the product.

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
