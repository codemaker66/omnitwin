# Codex Recent Handoff — Venviewer

Created: 2026-05-13  
Purpose: compact context file for another ChatGPT/Codex/LLM session.

## Current Repository State

- Main checkout: `C:\Users\blake\omnitwin2`
- Main branch: `master`
- Main checkout status before this handoff file: clean.
- Active implementation worktree: `C:\Users\blake\venviewer-command-shell`
- Active worktree branch: `chore/reference-match-trades-hall-visual`
- T-411 worktree status: uncommitted by instruction; do not assume it is on `master`.
- No push/merge was done for T-411.

## Last 10 Material Codex Outputs / Outcomes

### 1. T-411 — Reference-matched internal Trades Hall command-center shell

- Worktree: `C:\Users\blake\venviewer-command-shell`
- Branch: `chore/reference-match-trades-hall-visual`
- Route: `/dev/trades-hall-visual`
- Status: implemented and verified, not committed or pushed.
- Files changed include:
  - `packages/web/src/pages/TradesHallVisualPage.tsx`
  - `packages/web/src/pages/TradesHallVisualPage.css`
  - `packages/web/src/lib/trades-hall-command-fixture.ts`
  - deleted `packages/web/src/lib/trades-hall-visual-demo-state.ts`
  - `packages/web/src/__tests__/TradesHallVisualPage.test.tsx`
  - `packages/web/e2e/trades-hall-visual.spec.ts`
  - `docs/state/tasks.md`
  - `docs/diagrams/task-graph.md`
  - `docs/sessions/2026-05-12.md`
- What changed:
  - Refactored the internal visual route into a dark command-center shell matching the supplied reference direction.
  - Added dark top bar, left command rail, central Grand Hall canvas, right Truth Mode panel, Event Phase Graph, insight cards, Mesh/Splat/Hybrid toggle, overlay legend, route labels, heritage badges, selected-table callout, cyan flow lines, ghost agents, and density heatmap.
  - Replaced old demo fixture with typed command fixture data.
- Verification:
  - `pnpm --filter @omnitwin/web lint` passed.
  - `pnpm --filter @omnitwin/web typecheck` passed.
  - `pnpm --filter @omnitwin/web test -- TradesHallVisualPage runtime-visual-asset spark-stack bundle-splitting` passed: 31 tests.
  - `pnpm --filter @omnitwin/web build` passed with local dummy `VITE_CLERK_PUBLISHABLE_KEY`.
  - `/dev/trades-hall-visual` E2E passed.
  - Existing planner canvas smoke passed.
- Screenshot:
  - `C:\Users\blake\venviewer-command-shell\packages\web\test-results\trades-hall-visual-1920.png`
- Guardrails:
  - No textSplats.
  - No fake real captured asset.
  - No T-091/T-091A completion.
  - No public copy changes.
  - No unsafe legal/fire/accessibility/survey-grade claims.

### 2. T-410 — Premium table/seat command callouts

- Status: done on main before T-411.
- Files:
  - `packages/web/src/components/PlacedFurniture.tsx`
  - `packages/web/src/__tests__/PlacedFurniture.test.ts`
- What changed:
  - Replaced tiny table/seat labels with larger black/gold in-scene command callouts.
  - Added readable title rows, contextual details, grouped-seat counts, camera POV state, anchor dot, and object-side placement.
- Verified with focused tests, lint, typecheck, build, and local Chromium screenshot inspection.

### 3. T-409 — Hidden `jackielarkin` heart easter egg

- Status: done on main.
- Files:
  - `packages/web/src/components/JackieLarkinHeart.tsx`
  - `packages/web/src/components/JackieLarkinHeart.css`
  - `packages/web/src/components/__tests__/JackieLarkinHeart.test.tsx`
  - `packages/web/src/main.tsx`
- What changed:
  - Typing hidden sequence `jackielarkin` outside editable fields shows a large CSS love heart that pulses seven times and vanishes.
- Verified with focused tests, lint, typecheck, and build.

### 4. T-408 — Live `/plan` command shell and readable labels

- Status: done on main.
- Files:
  - `packages/web/src/pages/EditorPage.tsx`
  - `packages/web/src/App.css`
  - `packages/web/src/components/PlacedFurniture.tsx`
  - `packages/web/src/components/editor/SaveSendPanel.tsx`
  - `packages/web/src/__tests__/PlacedFurniture.test.ts`
- What changed:
  - Added full-width dark command-center status bar to live `/plan`.
  - Kept blank-hall opening path from T-406.
  - Moved desktop Send action below the bar.
  - Rendered seat/table labels as large camera-facing black/gold nameplates.
- Verified with web lint/typecheck, focused unit tests, full editor E2E, and screenshots.

### 5. T-407 — First internal `/dev/trades-hall-visual` command-center shell

- Status: done on main, superseded visually by T-411 worktree.
- Files:
  - `packages/web/src/pages/TradesHallVisualPage.tsx`
  - `packages/web/src/pages/TradesHallVisualPage.css`
  - `packages/web/src/lib/trades-hall-visual-demo-state.ts`
  - route tests and E2E
- What changed:
  - Initial dark graphite/gold command-center shell for internal Spark URL route.
  - Added top status bar, left rail, layer controls, Truth Mode panel, Event Phase Graph, insight cards, and honest fixture-labelled overlays.
- Guardrails:
  - Preserved no-real-asset empty state.
  - Spark stayed lazy behind the internal route.
  - Avoided textSplats and unsafe claims.

### 6. T-406 — Restore blank fast `/plan` opening

- Status: done on main.
- Files:
  - `packages/web/src/stores/editor-store.ts`
  - `packages/web/src/pages/EditorPage.tsx`
  - `packages/web/e2e/public-config-flow.spec.ts`
  - `packages/web/src/components/editor/PlannerSpatialHud.tsx`
- What changed:
  - Removed automatic 132-item starter proposal from new public Grand Hall drafts.
  - `/plan` now opens as an empty editable hall again.
  - Preserved lightweight HUD/camera chrome.
- Verified with focused tests, lint/typecheck/build, focused public-config E2E, and audit.

### 7. T-405 — Starter proposal and event HUD pass

- Status: done but superseded by T-406 for default opening behavior.
- Files included:
  - `packages/web/src/lib/grand-hall-starter-proposal.ts`
  - `packages/web/src/components/editor/PlannerSpatialHud.tsx`
  - editor store/page/camera/app files
- What changed:
  - Briefly added editable 132-item starter proposal and derived spaces/capacity HUD.
  - This was rolled back by T-406 because Blake wanted a blank hall by default.

### 8. T-404 — Planner command deck

- Status: done on main.
- Files:
  - `packages/web/src/components/editor/PlannerCommandDeck.tsx`
  - `packages/web/src/lib/planner-toolbar-events.ts`
  - `packages/web/src/App.tsx`
  - `packages/web/src/App.css`
  - `packages/web/src/components/editor/VerticalToolbox.tsx`
  - tests/E2E
- What changed:
  - Added desktop cinematic command deck that reads actual planner state.
  - Exposes contextual actions for empty planning, catalogue placement, markup, human POV, selected furniture, grouping, deletion, table cloths, dinner settings.
- Verified with unit tests, lint, typecheck, build, editor E2E, and browser screenshot smoke.

### 9. T-403 — Production deploy migration replay fix

- Status: done on main.
- File:
  - `packages/api/drizzle/0012_configuration_reviews.sql`
- What changed:
  - Made named constraint replay idempotent with a `pg_constraint` guard.
  - Fixed GitHub Actions migration failure on production deploy replay.
- Verified with API lint/typecheck/test and SQL grep.

### 10. T-402 — Remote Playwright drag/auth stability

- Status: done on main.
- Files:
  - `packages/web/src/components/SelectionSystem.tsx`
  - `packages/web/src/components/PlacementGhost.tsx`
  - `packages/web/src/components/CatalogueDrawer.tsx`
  - `packages/web/e2e/hallkeeper.spec.ts`
- What changed:
  - Stabilized remote Chromium right-drag/POV creation.
  - Added catalogue mouseup fallback so drag token cannot linger.
  - Seeded explicit null E2E auth user for unauthenticated hallkeeper route.
- Verified with targeted editor/hallkeeper E2E, lint/typecheck/build, and targeted unit tests.

## Important Current Caveats

- T-411 is not committed or pushed.
- T-411 lives only in `C:\Users\blake\venviewer-command-shell`.
- Main `master` does not contain T-411 until reviewed, committed, merged, and pushed.
- `/dev/trades-hall-visual` is still internal and procedural until a real splat URL exists.
- No real Trades Hall `scene.ply` runtime asset exists yet.
- T-091 and T-091A must remain not done until a real captured Trades Hall asset loads in runtime.
- Spark remains intentionally large and lazy/manual chunked; build passes with the existing chunk strategy.

## Best Next Prompts

### To review and merge T-411

```text
Codex, inspect the worktree C:\Users\blake\venviewer-command-shell on branch chore/reference-match-trades-hall-visual. Review the T-411 /dev/trades-hall-visual command-shell patch, verify tests, compare the screenshot at packages/web/test-results/trades-hall-visual-1920.png, then tell me whether it is safe to commit and merge. Do not push unless I explicitly say so.
```

### To commit/push T-411 after review

```text
Codex, commit and push the T-411 command-shell patch from C:\Users\blake\venviewer-command-shell only. Do not modify files. Do not mark T-091/T-091A done. Use commit message: chore(web): reference-match internal visual command shell
```

### To continue T-091 real asset work

```text
Codex, resume T-091 RunPod real Trades Hall asset pipeline. Do not touch /dev/trades-hall-visual runtime UI. Verify R2 staged data, Docker/RunPod blockers, smoke dataset status, and exact next operator command. Do not mark T-091 or T-091A done.
```
