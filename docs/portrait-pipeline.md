# pfp-forge — local portrait generator (Liar's Dice Arena)

Generates neon portraits on this PC's CPU (SD-Turbo via diffusers). No API key, no cost.
Paired with the site's portrait library: `liars-dice-arena/src/portraitlib.js`,
`scripts/ingest-portraits.js`, `scripts/sync-portraits.js`. Status when parked (Sep 27 2026):
2,058 bank portraits + 48 house-cast candidates on disk here, 2,106 live on the site.

## Restart in 3 commands
```powershell
cd $HOME\Desktop\pfp-forge
$env:LOOP_CAP="3000"                                   # stop once the bank has this many
Start-Process .\.venv\Scripts\python.exe "forge.py --loop" -NoNewWindow -RedirectStandardOutput loop.log -RedirectStandardError loop.err

cd $HOME\Desktop\liars-dice-arena
$env:PORTRAIT_AHEAD="100000"                           # upload everything (or 500 = stay 500 ahead of assigned)
Start-Process node "scripts/sync-portraits.js --every 120" -NoNewWindow -RedirectStandardOutput $env:TEMP\portrait-sync.log
```
Stop: `Get-Process python | Stop-Process -Force` (forge) and kill the `node scripts/sync-portraits.js` process.
Progress: `Get-Content loop.log -Tail 3` / `Get-Content $env:TEMP\portrait-sync.log -Tail 2`.

## What each piece does
- `forge.py --loop` — endless bank generation. Balanced archetype mix, unique tag roll per index, look-alike guard
  (perceptual hash, distance <= 10), WebP only, resumes after restart, idles at `LOOP_CAP`.
  Also: `--test` (6 samples), `--house` (4 candidates per house member), `--bank N` (one batch).
- `out/bank/manifest.json` — tags + prompt for every portrait (what the site matches against).
- `scripts/ingest-portraits.js` — copies WebPs into `public/assets/portraits/` and writes the site manifest (`--max N` caps bank entries).
- `scripts/sync-portraits.js` — pull, ingest, commit, push on a timer. Every push redeploys Render (~2 min).
- Site side: `portraitlib.js` matches an agent's creation selections to the closest unused portrait; every portrait is
  single-use across house cast, finished agents, drafts, and concepts on offer. `HOUSE_PORTRAITS=dracula=3,fox=2`
  (Render env) swaps a house member's candidate without a deploy. No library on disk => SVG rig fallback.

## Different art for a new project
Only the prompt changes. In `forge.py`: `STYLE` (the look), `NEGATIVE`, and the vocab dicts (`ARCHETYPE`, `ATTIRE`,
`BACKGROUND`, ...) describe the world; `HOUSE` describes named characters. Keep prompts under ~58 words (CLIP limit).
For a very different look, swap `MODEL` too (any diffusers text-to-image id works; sd-turbo is the CPU-fast one).
Then `--test` to judge, `--loop` to build the bank, ingest/sync as above.

## Environment
Python 3.11 (uv, user-scope) + torch CPU + diffusers in `.venv`; SD-Turbo weights cached in `%USERPROFILE%\.cache\huggingface`.
~25 s per 512x512 portrait on this machine (Ryzen 5 7640HS, no GPU). Each WebP ~50 KB.
