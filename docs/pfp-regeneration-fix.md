# PFP regeneration & replacement — what was wrong and what changed (Sept 2026)

## Root cause
The visual-option UI existed, but the seven selections never reached the portrait renderer on the
path the UI actually uses (concept round → select → lock):

1. `src/brandcreate.js` `attachPfp()` built every concept recipe without `selections`.
2. `lockBrand()` saved the chosen concept with no numeric `version`, no `creationSelections`,
   no `visualDirty`/`status`, and unversioned asset URLs — so nothing cache-busted and later
   re-renders fell back to archetype defaults.
3. `src/pfp.js` `recipeFromBrand()` (house/legacy render path) ignored `creationSelections`.
4. Once selections were mapped, the concept `variation` index no longer changed hair/turn/etc.,
   so four concepts would have been one person.

## Fix
- `branding/creationSelections.js`: `conceptVariantFor()` — deterministic per-concept variation
  (hair, head turn, intensity, jaw, eye glow) inside the chosen selections.
- `pfp.js`: `buildRecipe` applies the variant and treatments on top of selections;
  `recipeFromBrand` reads stored selections + variant; robot/skeletal plate and visor vary too.
- `brandcreate.js`: concepts render from `draft.creationSelections`; `lockBrand()` saves a fully
  versioned brand (`version`, `brandVersion:"v{n}"`, `creationSelections`, `status`, `visualDirty`,
  `?v=n` asset URLs, `animatedPfp` sourced from the canonical portrait, `pfpVariation`).
  `nextVersionNumber()` handles legacy brands (brandVersion only) so keys never collide.
- `showrunner.js`: `selectConcept` versions against the previous brand; **Regenerate runs
  through the 4-concept picker** (`generateConcepts({regenerate:true})` or a dirty draft);
  a live agent stays `READY` during a regenerate round; the old portrait stays live until a
  concept is chosen; spec §18 logs `PFP_CONCEPTS_START / PFP_CONCEPT_SELECTED / PFP_CANONICAL_SAVED`.
- `showhttp.js`: `pfp.svg?v=N` served `immutable`; unstamped stays `no-cache`.
- `public/app.js`: Regenerate PFP panel generates 4 concepts → pick → "Use this portrait";
  option changes clear stale concepts and POST `/brand/selections` (marks visualDirty).
- `test/pfpregen.test.js`: spec §17/§20 acceptance (Executive vs Robot, 4 distinct concepts,
  versioned save, served == chosen, regenerate → v2, `?v=1` still renders, reload-safe).

## Audit fixes
- `src/showstore.js`: first boot on a fresh disk / new `SHOW_DATA_PATH` crashed (lock file
  opened before its directory existed). Directory is now created in `_acquire()`.
- `test/brandcreate.test.js`: one assertion expected unversioned asset URLs (the old bug).

## Verified
`npm test` → 25/25. HTTP round-trip: create → concepts → select (v1) → change options →
regenerate → select (v2): different portrait on every surface, `?v=1` still serves the old one.
