# Design QA — Room layout timeline

**Result: PASSED**  
**Date:** 2026-07-18  
**Reference:** `C:/Users/blake/Downloads/09be6fcd-7894-43f4-af4c-47298b181ad0.png`  
**Preview:** `http://localhost:5173/plan/11111111-1111-4111-8111-111111111111?eventId=99999999-9999-4999-8999-999999999999`  
**QA viewport:** 1536 × 1024

## Visual comparison

- The implementation preserves Venviewer's current planner shell and House
  tokens while matching the reference feature's bottom-dock hierarchy: range
  controls and metrics, wall-clock event phases, ruler/playhead, transport,
  and a horizontally scrollable layout-preview filmstrip.
- The Day lens reads 16:00→02:00 for the fixture while its data query retains
  the complete venue-local 04:00→04:00 operational day. The 00:30→02:00
  Breakdown phase remains visibly owned by the wedding day.
- Phase duration is spatially truthful. Setup, arrival, room flip, dinner,
  speeches, party, and breakdown occupy their real wall-clock widths; room
  flip remains a labelled disabled gap rather than a fabricated layout.
- Frozen, Draft, Stale, Superseded, missing, and invalid states use the
  existing House status grammar. The active phase, playhead, and preview card
  share the brass selection treatment.
- Filmstrip images are rendered from the immutable canonical room outline and
  furniture payload. They are not placeholder room photographs.
- The reference's captured venue layer is not available in this local fixture;
  the existing planner correctly says so. This changes the underlying scene
  appearance but does not change the timeline composition or behavior.

## Interaction and accessibility

- Day/Week, previous/next range, phase-card selection, filmstrip selection,
  playback, pause, collapse/expand, and Exit Preview were exercised.
- `[` and `]` move between trustworthy keyframes. A short Space press starts
  and pauses the 20-second full-range playback without stealing button/input
  interactions.
- Selecting Dinner changed the viewer and updated the accessible metrics to
  120 guests, 112 objects, 12 tables, and 96 seats. The slider exposed
  `19:30 · Elaine & James · Dinner service · Frozen layout` through
  `aria-valuetext`.
- Preview mode leaves the saved plan unchanged, disables mutation surfaces,
  swaps the right dock for an explicit editing lock, and keeps the preview
  count and phase identity in the top bar and minimap.
- Reduced-motion media emulation selected the bounded crossfade path; normal
  motion retained the spatial same-event morph.

## Runtime quality

- Browser console after clean reload and repeated transitions: no warnings or
  errors.
- The first full-motion 46→500-object transition sampled 183 animation frames
  over 1.4 seconds: 7.74 ms average, 13.9 ms p95, 14.0 ms maximum, and zero
  frames above 16.7 ms.
- Warm 500→113 and 113→500 transitions averaged about 8.05 ms per frame; only
  one frame across both samples exceeded 16.7 ms. The 60 fps target passed.

## Evidence boundary

- UI/type/test/lint QA passed for the feature.
- Migration `0060` was applied twice to a disposable PostgreSQL 16 database;
  the second pass remained at 59 ledger entries. Catalog checks proved all
  four restrictive lineage foreign keys, both checks, and both indexes.
- Two concurrent authenticated freezes produced one `created` and one
  `already_current` result with one persisted row, then the real timeline API
  returned that canonical frozen keyframe. Runtime deletes of its actor,
  canonical snapshot, and validator proof were rejected by the expected
  migration-0060 constraints. The disposable database was not production or
  shared development data and was dropped after verification.
- The production web build was stopped by the repository's required live
  Clerk-key guard. No fake or development production credential was supplied.
