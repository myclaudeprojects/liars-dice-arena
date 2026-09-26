# Arena portraits

The live portrait route is still `GET /api/show/agents/:id/pfp.svg`. Merging this change replaces the Neon Noir bust on that route with the felt-roster rig in `src/pfparena.js`.

It is a first visual pass. Look at `artifacts/pfp-samples/sheet.html` (and `avatars.png`) before merging. If the samples are wrong, do not merge. `PFP_RIG=v3` serves the previous neon bust without a code change. `PFP_RIG=v2` serves the older cartoon.

## Run the script

From the repo root:

```bash
node scripts/generate-pfps.js
node scripts/generate-pfps.js --agents fox,brutus,dracula
node scripts/generate-pfps.js --out artifacts/pfp-samples --no-png
```

`--agents` takes house ids (`fox`, `brutus`, `dracula`, `caesar`, `reaper`, `athena`, `shark`, `oracle`, `monk`, `siren`, `miser`, `jester`). The default is the full house cast.

Each run writes:

- `*.svg` — the same drawing `renderPfp()` serves, at 1024 with a square viewBox
- `sheet.html` — matchup plate plus circle crops at 128 and 96 (Up Next sizes)
- `avatars.png` — a Chrome screenshot of that sheet, when `google-chrome` is on `PATH`

No new API keys. Portraits stay procedural SVG.

## How it plugs in

`src/pfp.js` `renderPfp()` calls `renderArenaPfp()` unless `PFP_RIG` says otherwise. Create Agent, regenerate, and the house cast all go through that function, so the script and the live route cannot drift.

House brands keep the accent and expression stored on the brand. Inferred Create Agent defaults were painting most seats with the same cyan and a replacement expression. Chosen creation palettes still win, because Create Agent copies the palette onto the brand before render.

The SVG contract is unchanged: `lda-pfp-v2`, the neon-competitive style id, the layer names the idle animation moves, and `?size=` / `?v=` / `?s=`. The style stamp is `4`, so cached Neon Noir images are not reused.

Avatar sizes share one path. Only the root `width` and `height` change. The face, costume, and team color are meant to survive a circular crop around 96–128px and a larger matchup plate.
