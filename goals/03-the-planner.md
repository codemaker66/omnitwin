# 03 · The planner — placing furniture that feels like magic

## The /goal block

Rebuild furniture placement as the planner's heart under the Sublime (goals/01): the surface from scratch, the spine kept. One real Trades Hall chair and table as the first catalogue items with measured footprints. Live Assembly: a footprint traces, a table glides and settles with weight, chairs arrange in a wave, guides settle, and the user never waits. Then formations, snapping, numeric precision, grouping, dressing, duplication, 2D/3D continuity, undo and autosave; then Layout Recall, Grand Assembly, Transformation Assembly and Director's Cut, each from a deterministic layout diff with presentation-only transforms. Every interruption (skip, cancel, redrag, undo, route change) settles to the true state without a lost or duplicated object. 60 fps furnished on the device matrix.

## Outcome, in Blake's words

"We want to be able to place furniture with an awesome looking UI ... we want these layouts to buttery smooth with awesome animations baked in to everything so it feels like magic"; "we can use image generation tools to get examples of what a next-gen awesome userinterface will look like". From the vision §29: "The user does not populate the venue. They conduct it."

## Where we are

/plan is the cockpit: 26 Zustand stores, unified undo (T-447), the command deck, the chair brush, table dressing, laser markup, POV cameras, eleven lenses, the action log (T-522), real-metre coordinates (T-473). The Stage programme put the planner inside the captured room: S1 (T-559) and S2 (T-562: the tool pill, judged rings, spring settle) shipped. packages/web/src/lib/springs.ts is the one spring core; packages/web/src/lib/furniture-motion.ts separates saved transforms from transient spring offsets; placeItem and moveItem magnetise. The furniture is generic meshes, not Trades Hall's. The planner's splat delivery lags the walk (goal 00 T-581). Blake's verdict: the surface does not inspire; rebuild it.

## Decided

- The surface is rebuilt; the state, the commands, the undo, the action log, the coordinate space, the spring core and the Spark host are kept. New components live under packages/web/src/floor/ (Floor/House vocabulary for new modules; existing cockpit names stay; no mass renames).
- Motion is generated from canonical planner state through a deterministic layout diff and a choreography graph (vision §30). Intermediate transforms are presentation state; a saved position never carries an animation frame.
- Springs with mass, from goal 01 §5; emil-design-eng read before touching motion. Routine edits never move the camera. Reduced motion keeps every function.
- Real furniture comes from goal 08 F5 (one chair, one table) with footprints from HUMAN.md 2; until then the current meshes carry the measured footprints.
- The catalogue item is the existing furniture schema in packages/types/src/furniture.ts, extended (footprint, identity, quantity, storage, seat count, AV class), never forked.
- Identical source, target, version and seed give identical playback; the motion lab tests that.

## The work, in slices

S1 The keystone (goal 01 slice 4b, on a branch behind `?house=sublime`): place one table; chairs arrange round it and settle; the tool pill; the new tokens from goal 01 §3; the interface withdraws while dragging and returns at rest. Playwright screenshots and the sublime test filled in.

S2 The catalogue as one dark field: real items with footprint, identity, quantity, storage and seat count; the AV items (projector, TV, screen, lectern, microphone) as first-class catalogue entries so goal 05's sheets can count them; types extended test-first.

S3 Formations and precision: rounds, rows, cabaret, boardroom, theatre and standing from one gesture; snapping (grid, edge, centre, wall, angular, equal-spacing); a numeric inspector with tabular scrubbable numbers; measuring; guides; table and seat labels.

S4 Grouping, dressing, duplication and 2D/3D continuity: a table with its chairs and settings behaves as one family; the blueprint and the room share state and switching is a camera move, never a reload; autosave; version history; variant comparison.

S5 Layout Recall: a saved arrangement assembles from stored identities, groups and positions in under three seconds; interruption-safe.

S6 Grand Assembly: the explicit reveal. Constraints establish the usable space, anchors set the composition, tables arrive in waves, chairs arrange, décor resolves, routes appear, the camera completes; skip and cancel at any moment; reproducible by seed.

S7 Transformation Assembly: a version or phase transition animates the actual differences: unchanged objects stay, moved objects travel, new arrive, removed leave, styling transforms in place.

S8 Director's Cut: authored camera work, lighting states, optional sound from the room tone, room-to-room storytelling, export.

S9 The motion lab at /dev/motion-lab: every spring and transition, replayable by seed, and the interruption suite: skip, cancel, redrag, undo, route change and direct intervention mid-choreography, asserting no lost object, no duplicate, no intermediate position saved, reload reproduces the counts.

## Done when

The sublime test passes on every planner state. The interruption suite is green. Frame-interval p95 ≤ 16.7 ms with a 180-seat layout on every device in the matrix (goal 02 D1). Each Assembly form has an acceptance recording. Elaine recognises the real chair and table. The same approved layout survives reload and yields the correct item counts.

## Verify

```
pnpm --filter @omnitwin/web test -- --run floor
node packages/web/scripts/splat-drag-budget.mjs --room grand-hall --layout 180
pnpm --filter @omnitwin/web visual-check
pnpm --filter @omnitwin/web exec playwright test e2e/floor-interruptions.spec.ts --workers 1
```

E2E rules from the plan-cards memory: serial, one file per invocation, no page evaluation after a heavy readback.

## Forbidden

Tweens or easing curves. Ambient motion. Taking the camera during an edit. Saving an animation frame as a position. A second spring core, undo or store for the same state. Renaming cockpit code. A card wall for the catalogue.

## Human inputs

HUMAN.md 2 (the inventory with dimensions and photos), 4 (taste), 5 (image generation for the concepts).

## Unlocks

Goal 05's exact counts; goal 06's living proposal layouts; goal 09's alternatives rendered through Grand Assembly.
