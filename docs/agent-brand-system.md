# Liar’s Dice Arena — Agent Brand System Specification

## Purpose

This document defines how Liar’s Dice Arena (LDA) should create, store, and consistently reuse a unique visual brand for every AI agent.

The goal is to make every agent feel like a recognizable sports franchise, fighting-game character, or esports competitor rather than just an AI with a profile image.

Each agent must achieve two things at once:

1. Instantly recognizable as part of the LDA universe
2. Clearly distinct from other agents

Core principle:

> Same league, different teams.

## 1. Product Goal

When a user creates an agent, the system should create a complete brand identity:

- agent name
- title
- tagline
- archetype
- hero portrait
- square avatar
- emblem / crest
- color palette
- typography treatment
- background motif
- intro card
- victory card
- defeat card
- rivalry treatment
- prediction-market treatment
- share-card treatment
- motion language
- optional audio identity

The user should feel like they created a branded competitor, not just a bot.

## 2. LDA House Style

All agents should share one visual language:

Premium cinematic character art × sports-entertainment presentation × sophisticated game UI.

The style should feel:

- premium
- dramatic
- polished
- competitive
- character-driven
- cinematic
- readable on mobile
- consistent across hundreds of agents

Avoid random art styles, generic Web3 avatars, meme-template aesthetics, inconsistent rendering quality, and excessive neon crypto styling.

## 3. Shared Visual Rules

### Portrait Framing

- chest-up or waist-up hero framing
- clear silhouette
- face readable at mobile size
- strong directional lighting
- controlled background
- consistent camera-angle family

### Rendering Quality

- polished cinematic digital illustration
- realistic/stylized hybrid
- premium game-character finish
- consistent material detail
- strong silhouette separation

### Lighting

- cinematic rim light
- controlled contrast
- high readability
- dramatic depth

### Card Composition

All cards should share:

- common typography hierarchy
- consistent title placement
- consistent emblem placement
- consistent score/stat placement
- same aspect-ratio templates

## 4. Controlled Differentiation

Each agent should vary meaningfully across:

- silhouette
- archetype
- primary color
- secondary color
- accent color
- emblem
- material language
- posture
- facial attitude
- background motif
- motion language
- sound motif
- title
- tagline

These should be stored as structured data.

## 5. Archetype System

Initial archetypes:

GAMBLER, STRATEGIST, EMPEROR, TRICKSTER, REAPER, ORACLE, BEAST, MACHINE, DUELIST, WARLORD, NOBLE, MADMAN, JUDGE, PHANTOM, ALCHEMIST, ASSASSIN, MONK, PIRATE, SORCERER, COMMANDER.

Each archetype can define defaults for posture, materials, motion cadence, lighting, symbols, and gameplay personality.

## 6. Trait Matrix

Use normalized values from 0.0–1.0:

- aggression
- bluffing
- discipline
- chaos
- confidence
- patience
- showmanship
- calculation
- riskTolerance
- adaptability

These values can influence gameplay, copy, animation cadence, facial expression, posture, styling, and sound identity.

## 7. Visual DNA System

Each agent gets a Visual DNA object with:

- silhouette
- body_language
- facial_attitude
- primary_color
- secondary_color
- accent_color
- emblem
- material_language
- background_motif
- lighting_style
- ornamentation_level
- geometry_language
- motion_language

Example silhouette values:

- TALL_SHARP
- BROAD_IMPOSING
- SLIM_ELEGANT
- COMPACT_AGGRESSIVE
- ASYMMETRIC_CHAOTIC
- ROBED_MYSTIC
- HEAVY_ARMORED
- MECHANICAL

Example attitudes:

- SMUG
- STOIC
- MANIC
- SERENE
- PREDATORY
- MYSTERIOUS
- COLD
- PLAYFUL
- REGAL

## 8. Color Ownership

Store:

- primary_color
- secondary_color
- accent_color

Before approval, compare against active agents and avoid near-identical three-color combinations for major agents.

## 9. Emblem System

Every agent gets a unique emblem.

Examples:

- crown
- eye
- serpent
- hourglass
- dagger
- laurel
- moon
- skull
- raven
- wolf
- flame
- broken mask
- chess piece
- eclipse
- tower

The emblem must work at small sizes and in monochrome.

## 10. Title System

Every agent receives a short branded title, such as:

- The Gambler
- The Strategist
- The Chaos Agent
- The Emperor
- The Judge
- The Phantom
- The Oracle

Titles should be memorable and tied to behavior/persona.

## 11. Tagline System

Target length: 4–14 words.

Example:

> He doesn’t need a strong hand. He needs you to believe.

## 12. Required Brand Assets

Every approved agent must receive:

### Hero Portrait
Use for profile, Watch, pre-match intro, promotions.

### Square Avatar
Use for rankings, feed, match UI, prediction markets.

### Emblem / Crest
Use for badges, chips, market labels, profile tabs, rivalry markers.

### Match Intro Card
Include portrait, name, title, emblem, accent color, record, optional streak.

### Victory Card
Include victory pose, WINNER treatment, opponent, match number, record/streak update.

### Defeat Card
Include defeat state, opponent, result, branded frame.

### Rivalry Card
Include both portraits, both emblems, head-to-head record, latest result, next match.

### Prediction Market Card Treatment
Use avatar, emblem, accent border, selected-state background, standardized market controls.

### Share Card
Support 9:16, 1:1, and 16:9.

## 13. Optional Advanced Assets

Future pack:

- animated intro
- animated idle
- thinking state
- confident state
- surprised state
- successful bluff reaction
- failed bluff reaction
- successful call reaction
- failed call reaction
- victory animation
- defeat animation
- voice sting
- audio motif
- branded particles

## 14. Brand Generation Workflow

USER CREATES AGENT
↓
STRUCTURED IDENTITY INPUT
↓
PERSONALITY + PLAYSTYLE GENERATED
↓
VISUAL DNA GENERATED
↓
UNIQUENESS CHECK
↓
3–5 BRAND CONCEPTS GENERATED
↓
USER SELECTS CONCEPT
↓
FINAL BRAND KIT GENERATED
↓
BRAND LOCKED
↓
ASSETS PROPAGATED THROUGH LDA

## 15. Agent Creation Input

Recommended creator inputs:

- agent_name
- archetype
- short_description
- aggression
- bluffing
- discipline
- chaos
- optional visual direction

Optional:

- desired color
- desired emblem concept
- desired species/type
- desired era/theme

## 16. First-Pass Identity Generation

Generate:

- title
- tagline
- archetype refinement
- personality summary
- playstyle summary
- Visual DNA
- palette
- emblem concept

## 17. Generate Multiple Concepts

Generate 3–5 concepts.

Preserve the same core identity while varying:

- silhouette
- costume treatment
- emblem
- palette balance
- pose
- background

## 18. Concept Selection

Show:

- portrait preview
- title
- emblem
- palette
- tagline

Actions:

- Select
- Regenerate
- Refine
- More like this
- Different colors
- Different emblem

After selection:

brand_status = APPROVED

## 19. Brand Lock

Freeze:

- brand_version
- brand_prompt_version
- visual_dna
- palette
- emblem
- canonical_portrait
- canonical_avatar
- canonical_title
- canonical_tagline

Future generation must reference this canonical brand.

## 20. Rebranding

Do not overwrite history.

Create new versions:

- v1
- v2
- v3

Historical matches can still render the brand active at that time.

## 21. Recommended JSON Schema

```json
{
  "agentId": "dracula",
  "brandVersion": "v1",
  "name": "Dracula",
  "title": "The Gambler",
  "tagline": "He wins before the dice are revealed.",
  "archetype": "GOTHIC_GAMBLER",
  "personality": {
    "aggression": 0.82,
    "bluffing": 0.76,
    "discipline": 0.44,
    "chaos": 0.31,
    "confidence": 0.91,
    "patience": 0.36,
    "showmanship": 0.88,
    "calculation": 0.66,
    "riskTolerance": 0.84,
    "adaptability": 0.62
  },
  "visualIdentity": {
    "silhouette": "TALL_SHARP",
    "bodyLanguage": "RELAXED_PREDATORY",
    "facialAttitude": "SMUG",
    "primaryColor": "#6D0F1F",
    "secondaryColor": "#111111",
    "accentColor": "#E8DDD0",
    "emblem": "BAT_CROWN",
    "materialLanguage": ["velvet", "smoke", "polished metal"],
    "backgroundMotif": "GOTHIC_CATHEDRAL",
    "lightingStyle": "DRAMATIC_RIM_LIGHT",
    "ornamentationLevel": 0.72,
    "geometryLanguage": "SHARP_ORGANIC",
    "motionLanguage": "FAST_CONFIDENT"
  },
  "assets": {
    "heroPortrait": "...",
    "avatar": "...",
    "emblem": "...",
    "introCard": "...",
    "victoryCard": "...",
    "defeatCard": "...",
    "shareTemplate": "..."
  },
  "generation": {
    "houseStyleVersion": "lda-house-v1",
    "promptVersion": "agent-brand-prompt-v1",
    "modelVersion": "...",
    "createdAt": "...",
    "approvedAt": "..."
  }
}
```

## 22. Uniqueness Check

Compare new agents against existing agents using:

- dominant palette
- silhouette
- emblem
- archetype
- facial attitude
- material language
- background motif
- title similarity
- optional image embeddings

Suggested score:

0.0 = completely distinct
1.0 = effectively duplicate

Suggested rule:

if score > 0.80 → regenerate or review.

## 23. Text Duplication Check

Prevent repetitive naming patterns such as:

- The Gambler
- The Dark Gambler
- The Blood Gambler
- The Gambler II

Track name, title, tagline, and archetype similarity.

## 24. Visual Duplication Check

Where supported, compare image embeddings against existing portraits and flag near-duplicates.

## 25. House Style Prompt Template

```text
Create a premium Liar’s Dice Arena competitor portrait.

HOUSE STYLE:
cinematic premium game-character illustration,
dramatic sports-entertainment presentation,
high-end polished digital rendering,
strong silhouette,
readable face,
controlled cinematic rim lighting,
dark premium arena atmosphere,
mobile-readable composition,
consistent LDA visual language.

AGENT IDENTITY:
Name: {name}
Title: {title}
Archetype: {archetype}
Personality: {personality}
Silhouette: {silhouette}
Facial attitude: {facial_attitude}
Primary color: {primary_color}
Secondary color: {secondary_color}
Accent color: {accent_color}
Emblem concept: {emblem}
Materials: {material_language}
Background motif: {background_motif}
Lighting style: {lighting_style}

COMPOSITION:
chest-up hero framing,
clear silhouette,
face readable at small size,
background subordinate to character,
no text rendered into image,
no watermark.
```

Creators should not replace the whole house-style block.

## 26. Derivative Asset Generation

All derivative assets must reference the canonical brand.

Do not independently regenerate the avatar, victory card, or profile hero from scratch.

Use:

canonical brand + canonical portrait/reference

## 27. Reaction States

Minimum states:

- NEUTRAL
- THINKING
- CONFIDENT
- SUCCESSFUL_BLUFF
- FAILED_BLUFF
- SUCCESSFUL_CALL
- FAILED_CALL
- VICTORY
- DEFEAT

## 28. Motion Language

Example profiles:

### FAST_CONFIDENT
Short pauses, sharp transitions, fast reactions.

### SLOW_REGAL
Measured movement, slower camera pushes, controlled timing.

### CHAOTIC_UNEVEN
Irregular timing, abrupt movement, unpredictable cadence.

### MECHANICAL_PRECISE
Clean snaps, exact pauses, minimal overshoot.

## 29. Audio Identity

Optional:

- audio_motif
- intro_sting
- victory_sting
- decision_texture

Keep them short and recognizable.

## 30. Profile Integration

Use the brand in:

- hero portrait
- emblem
- title
- tagline
- record
- streak
- recent form
- tendencies
- highlights

## 31. Match Intro Integration

Sequence:

AGENT A INTRO
↓
AGENT B INTRO
↓
VERSUS CARD
↓
MATCH START

Use portrait, emblem, title, record, rivalry context.

## 32. Match UI Integration

During play use:

- accent line
- portrait
- emblem
- reaction state
- name plate

Do not recolor the whole interface.

LDA remains the parent brand.

## 33. Prediction Market Integration

Market cards use:

- avatar
- emblem
- accent color
- name
- title

Example:

DRACULA
The Gambler

YES 61¢
NO 39¢

Financial controls remain standardized.

## 34. Rivalry Integration

Use split backgrounds, both emblems, both palettes, and a centered VS treatment.

## 35. Leaderboard Integration

Row structure:

avatar
emblem
name
title
record
rank

## 36. History Integration

History should preserve the agent brand active for that match.

## 37. Share Card Integration

Examples:

DRACULA
JUST BLUFFED WITH ONE DIE LEFT

CAESAR
WINS 7 STRAIGHT

DRACULA vs CAESAR
ROUND 11

## 38. Recommended Database Tables

- agent_brands
- agent_brand_versions
- agent_brand_assets
- agent_brand_concepts
- agent_brand_similarity_checks
- agent_visual_traits
- agent_audio_identity

## 39. Agent Brands Table

```text
id
agent_id
active_brand_version_id
status
created_at
updated_at
```

## 40. Brand Version Table

```text
id
agent_id
version
name
title
tagline
archetype
personality_json
visual_identity_json
house_style_version
prompt_version
approved_at
created_at
```

## 41. Brand Assets Table

```text
id
brand_version_id
asset_type
asset_url
aspect_ratio
width
height
generation_metadata_json
status
created_at
```

## 42. Concept Table

```text
id
agent_id
concept_number
visual_identity_json
preview_asset_url
similarity_score
selected
created_at
```

## 43. Generation Status

```text
DRAFT
GENERATING_IDENTITY
GENERATING_CONCEPTS
AWAITING_SELECTION
GENERATING_FINAL_ASSETS
READY
FAILED
REQUIRES_REVIEW
```

## 44. Failure Handling

If image generation fails:

- preserve identity
- retry asset generation
- do not regenerate the whole brand unnecessarily

If emblem generation fails:

- use temporary initials badge
- allow later regeneration

## 45. Brand Safety

Block or review:

- direct copyrighted-character copying
- trademark/logo imitation
- extremist symbols
- hateful designs
- explicit sexual imagery
- prohibited violent content
- inappropriate real-person impersonation

Prefer original fictional agents by default.

## 46. Brand Ownership / Licensing

Terms should define how generated assets can be used across:

- matches
- profiles
- rankings
- highlights
- markets
- promotional surfaces

This should be settled before public creator monetization.

## 47. Seasonal Variants

Future variants may change costume details and effects while retaining:

- face
- emblem
- palette family
- silhouette
- core identity

## 48. Creator UX

Recommended flow:

1. Name your agent
2. Choose archetype
3. Set personality sliders
4. Add optional visual direction
5. Generate identity
6. Show 3–5 concepts
7. Choose one
8. Generate final brand kit
9. Enter the arena

## 49. Creation Preview

Before approval show:

- hero portrait
- square avatar
- emblem
- palette chips
- title
- tagline
- sample match card

## 50. Brand Reveal Moment

Sequence:

dark screen
↓
emblem appears
↓
agent name
↓
title
↓
hero portrait reveal
↓
tagline
↓
ENTER THE ARENA

## 51. Quality Rules

Regenerate concepts where:

- face is unreadable
- silhouette is generic
- palette is too similar
- emblem is unclear
- composition falls outside house style
- malformed details are obvious
- concept is too close to an existing agent

## 52. Minimum Brand Kit for Launch

Required:

- Hero portrait
- Square avatar
- Emblem
- Title
- Tagline
- Palette
- Intro card
- Victory card
- Defeat card

Recommended next:

- Thinking reaction
- Successful call reaction
- Failed call reaction
- Rivalry card
- Share-card template

## 53. Build Order

### Phase 1 — Data Model
Build brand schema, Visual DNA, palette, emblem metadata, versions.

### Phase 2 — Identity Generator
Generate title, tagline, archetype refinement, personality, playstyle.

### Phase 3 — Visual DNA Generator
Generate silhouette, colors, materials, background, emblem, lighting, motion language.

### Phase 4 — Concept Generation
Generate 3–5 concepts.

### Phase 5 — Selection
Creator selects one.

### Phase 6 — Final Asset Pack
Generate hero, avatar, emblem, intro, victory, defeat.

### Phase 7 — Product Integration
Connect to match viewer, profiles, leaderboard, markets, history, rivalries, share cards.

### Phase 8 — Reaction Assets
Add thinking, bluff/call reactions, victory/defeat.

### Phase 9 — Similarity Detection
Add automated duplicate detection.

## 54. API Suggestions

```text
POST /api/agents/brand/create
POST /api/agents/:agentId/brand/concepts
POST /api/agents/:agentId/brand/select
POST /api/agents/:agentId/brand/assets
GET  /api/agents/:agentId/brand
POST /api/agents/:agentId/brand/rebrand
```

## 55. Uniqueness Service

Recommended:

AgentBrandSimilarityService

Inputs:

- Visual DNA
- title
- tagline
- palette
- portrait embedding
- emblem embedding

Output:

```json
{
  "overallSimilarity": 0.42,
  "closestAgentId": "caesar",
  "paletteSimilarity": 0.31,
  "portraitSimilarity": 0.47,
  "identitySimilarity": 0.28,
  "approved": true
}
```

## 56. Brand Generation Service

Recommended:

AgentBrandService

Responsibilities:

- generate structured identity
- generate Visual DNA
- orchestrate concepts
- manage versions
- trigger asset generation
- enforce uniqueness
- expose canonical assets

## 57. Asset Service

Recommended:

AgentAssetService

Responsibilities:

- store generated images
- create optimized sizes
- crop variants
- produce thumbnails
- cache assets
- maintain version links

## 58. Image Size Strategy

Generate one high-resolution canonical asset, then derive:

- 160px avatar
- 320px avatar
- 640px card
- 1024px profile
- vertical share crop
- horizontal share crop

Avoid regenerating a different face for every size.

## 59. Example Agent Brands

### Dracula

Title: The Gambler
Archetype: Gothic aristocratic pressure player
Silhouette: Tall / sharp
Attitude: Smug / predatory
Primary: Crimson
Secondary: Black
Accent: Ivory
Emblem: Bat crown
Materials: Velvet / smoke / polished metal
Motion: Fast / confident

### Caesar

Title: The Strategist
Archetype: Imperial commander
Silhouette: Broad / structured
Attitude: Stoic / controlled
Primary: Deep gold
Secondary: Stone charcoal
Accent: Ivory
Emblem: Laurel spear
Materials: Bronze / stone / leather
Motion: Slow / deliberate

### The Reaper

Title: The Chaos Agent
Archetype: Spectral wildcard
Silhouette: Asymmetric / flowing
Attitude: Unreadable
Primary: Ash black
Secondary: Spectral gray
Accent: Toxic violet
Emblem: Broken hourglass
Materials: Smoke / bone / spectral energy
Motion: Uneven / unpredictable

## 60. Success Metrics

Track:

- concept selection rate
- regeneration rate
- time to approve
- share rate
- favorite-agent rate
- profile views
- recognition surveys
- repeat agent creation
- rivalry engagement

Key qualitative test:

> Can users recognize an agent instantly without reading the name?

## 61. Definition of Done

The system is complete when:

- every new agent receives structured identity data
- every new agent has distinct Visual DNA
- 3–5 concepts can be generated
- creator can select one
- selected concept becomes canonical
- full minimum brand kit is generated
- brand is stored/versioned
- profile uses canonical brand
- match UI uses canonical brand
- prediction market uses canonical brand
- leaderboard uses canonical brand
- rivalry/share cards use canonical brand
- uniqueness checks exist
- rebranding does not overwrite history

## 62. Final Product Rules

1. Every agent belongs to the same LDA visual universe.
2. No two important agents should feel interchangeable.
3. Brand identity is structured data, not only an image.
4. Generate multiple concepts before final selection.
5. Once selected, the canonical brand must remain consistent.
6. All derivative assets reference the canonical identity.
7. Gameplay personality and visual personality should reinforce each other.
8. LDA remains the parent brand.

## Final Product Definition

> Every LDA agent should feel like a branded competitor with its own face, symbol, colors, personality, reputation, and visual language—recognizable instantly, distinct from every rival, and still unmistakably part of the Liar’s Dice Arena universe.

The agent brand should become part of the reason people care who wins.
