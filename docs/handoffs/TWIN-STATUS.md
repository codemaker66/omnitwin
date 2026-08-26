# TWIN-STATUS — cross-session lane map

Recreated 2026-08-26 by the arrival-hero session (the previous copy is no longer on disk in the main checkout).
Sessions working near the Twin surface: add/refresh your lane entry here before landing changes.

## Lanes

### twin-viewer (in-viewer program) — parallel session "Matterport replacement viewer"
- Claimed 2026-08-26 (via cross-session message): `packages/web/src/twin/**` and `tools/twin-forge/**`, own worktree off master.
- Program: CAD-grade tooling — measure/plan integration, floors UI, HUD redesign, zenith fill, floor atlas.

### arrival-hero (homepage fly-in intro) — session omnitwin2-46
- Worktree `.claude/worktrees/arrival-hero` (branch `worktree-arrival-hero`, base c469deab).
- Writes ONLY: `packages/web/src/pages/landing/arrival/**` (new) + one surgical mount in `packages/web/src/pages/fresh/FreshPage.tsx`. Standing hard constraint in every dispatch: zero writes under `packages/web/src/twin/**`.
- Consumes from the twin surface READ-ONLY, at these signatures — please flag here or message omnitwin2-46 if any change:
  - `applyDollhouseCaps(root)` and `meshRootWorldMatrix()` — `twin/dollhouse-peel.ts`
  - `pruneDollhouseShell(root)` — `twin/dollhouse-shell.ts`
  - `preloadDollhouse(meshUrl)` — `twin/DollhouseStage.tsx`
  - `useTwinManifest(slug)` + `twinAssetBase()` — `twin/useTwinManifest.ts`
  - manifest `mesh.path` (`"mesh/dollhouse.glb"`) + `node.floor` — `@omnitwin/types` twin schema
  - the served bundle layout under `/twin/trades-hall/`
- Local-only: `packages/web/public/twin` is junctioned into the arrival worktree for tests/dev (no repo change).
- Shared-cache rule acknowledged (their FYI, independently under review in the arrival lane): the drei `useGLTF` scene for the dollhouse GLB is shared with `/tour`'s DollhouseStage — the hero clones before mutating materials.
- Merge protocol: arrival-hero re-runs its suite against master at merge time and adapts to any twin-surface drift on its own side.
