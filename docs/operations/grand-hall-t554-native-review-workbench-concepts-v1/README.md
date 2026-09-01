# Grand Hall native-review workbench visual specification v1

Status: implementation reference only
Authority: none
Generated architecture: none

The two PNGs in this directory define the visual system and interaction
anatomy for the private T554 native-review workbench:

- `source-review-screen.png` — SHA-256
  `841b5f0daf4c693f79c1c7246d2247add8297a20fe59bcab0cca40b3a54d9013`;
- `mask-review-screen.png` — SHA-256
  `db55c09780e5bfbed6b2c0b344f4da8da03725ff5babfd05868e4d3a5e0e50ba`.

They were generated from the user-supplied Venviewer design references. Their
central canvases deliberately contain neutral grids rather than generated
Grand Hall imagery. They are not capture evidence and must never enter a
training, reconstruction, mask, runtime, or architectural-truth path.

## Data precedence

The concepts control layout, hierarchy, palette, typography character,
component families, and interaction density only. They do not control factual
values. The implementation must render all source identities, hashes, counts,
progress, observations, decisions, mask facts, and authority state from the
verified T554 core.

In particular, any example `INCLUDE`, `EXCLUDE`, `Reviewed`, mask count, source
count per visual group, filename, hash, time, reviewer, or completed coverage
shown in a concept is illustrative and must not be seeded into real state. The
real initial state remains 148 `UNSURE` human decisions, zero completed native
reviews, and zero reviewed masks.

## Design tokens

- Background: true near-black `#080d11`.
- Primary surface: charcoal `#11171b`.
- Elevated surface: `#151c20` with one-pixel borders, not floating bento cards.
- Primary text: warm ivory `#eee7da`.
- Muted text: `#8e9698`.
- Border: `#293136`.
- Accent: restrained antique gold `#b88a45`.
- Verified custody only: muted green `#5f9f6e`.
- Pending/attention: amber `#c49042`.
- Invalid/failure only: restrained red `#c85a50`.
- Exact-source diagnostic edge only: restrained cyan `#46a7ad`.
- Radii: 2–4 px for controls and frames; no rounded-card composition.
- Shadows/glows/gradients: none.
- Brand typography: the existing Venviewer high-contrast serif treatment.
- Application typography: compact disciplined sans; tabular numerals for
  hashes, counts, dimensions, coordinates, and revisions.

## Component and container model

- Quiet fixed top bar: brand, workbench identity, source progress, authority,
  autosave/session state.
- Left source rail: searchable list with real status and selected state.
- Dominant centre canvas: exact RGB or RGB+mask/reason tiles, zoom/pan and true
  native scale. Coverage status remains outside the credited pixels. Do not add
  a minimap, ruler, guide, floating control, or other occlusion unless the
  trusted coverage contract is first extended to exclude the covered pixels.
- Narrow mode/evidence rail: exact source, T561 observation, T565 diagnostic,
  interfaces; machine observations are always visually separate from human
  decisions.
- Right inspector: immutable source facts, human gates, mask tools/reasons,
  frozen-candidate facts, and only actions exposed by the durable core.
- Bottom evidence/decision rail: evidence note and the explicit real
  `INCLUDE`, `EXCLUDE`, or `LEAVE UNSURE` actions with fail-closed disabled
  states. Do not invent revision-history data the operator projection does not
  expose.
- Status footer: authority-none and crash-safe persistence statements.

## Visible-copy lock

The primary surface may use these user-facing strings, adjusted only when a
verified runtime state requires a truthful value:

- `VENVIEWER`
- `GRAND HALL TRUTH WORKBENCH`
- `AUTHORITY NONE`
- `Exact source pixels`
- `Native 8192 × 4096`
- `No generated pixels`
- `Source custody verified` only after the trusted core reports that state
- `Agent observation — not a decision`
- `Human decision: UNSURE`
- `Coverage 0 / 512`
- `Review at native device scale`
- `Doorway / boundary attention`
- `No acceptance or runtime authority`
- `Exact source`
- `Mask overlay`
- `Reason map`
- `No smoothing`
- `No source-data resampling`
- `Crash-safe autosave`
- `Source coverage`
- `Mask coverage`
- `Frozen candidate — HUMAN PENDING`
- `Continue editing` only when it invokes a real durable transition; in the
  current v2 core, the first confirmed edit from frozen-mask review performs
  that transition rather than a standalone resume command
- `Freeze candidate`
- `Review frozen mask`
- `INCLUDE`
- `EXCLUDE`
- `LEAVE UNSURE`
- `Generated fill is impossible in this workbench. Mask evidence grants no
  reconstruction, runtime, staging or production authority.`

No acceptance, runtime, reconstruction, staging, production, or human-review
claim may appear ahead of durable evidence.

## Interaction contract

The source-review flow is:

`open fixed local workbench -> select exact source -> inspect delivered native
tiles at 100% -> complete server-derived source coverage -> write evidence note
-> EXCLUDE, begin an INCLUDE mask workflow, or leave pending`.

The mask-review flow is:

`begin all-excluded mask -> apply integer include/exclude primitives with an
explicit reason -> freeze immutable binary mask and reason map -> inspect the
frozen source/mask pair at native scale -> complete independent mask coverage
-> record INCLUDE or return to editing`.

Every visible control must call a real, tested core operation. There are no
placeholder buttons, browser-authored hashes/counts, or client-side acceptance
claims.

The reference PNGs also contain illustrative elements the present core does not
expose: T565 numeric orientation facts, interface decisions, filenames and
source hashes, reviewer identity, revision thumbnails, undo/redo, brush size,
compare/blink controls, and an independent resume-editing command. None may be
copied as inert UI or populated with guessed values. The durable core and its
strict browser projection always outrank the visual reference.
