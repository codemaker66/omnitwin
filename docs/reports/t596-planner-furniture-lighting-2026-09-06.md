# T-596: persistent planner furniture lighting

Status: code and CPU checks complete; real furnished GPU comparison pending with the coordinating agent. This is a demo lighting fix, not reconstruction completion or a 60 fps/PSNR qualification.

Worktree: `D:/claude/venviewer-demo-lighting-20260906`

Branch: `codex/demo-furniture-lighting`

Base: `dbdcdec037fb995ac0d94cae3d4c04550048483b` (current HEAD when the isolated worktree was created). Dirty main and the Claude/T-581 worktrees were preserved. T-581's unmerged progressive delivery changes are not part of this candidate.

## Problem and change

In `PlannerScene`, Splat mode unmounted `RoomMesh` or `GrandHallRoom`. Those room components also owned the scene lights, so inserted furniture lost illumination when the captured hall became visible. `RoomMesh` additionally removed its lights when viewport size or camera movement selected the lean procedural shell.

`RoomLighting` now holds the two existing presets. The planner owns one persistent rig outside its conditional procedural shell, and passes `includeLighting={false}` to either room component. Mesh and Hybrid retain one rig. Splat and lean-shell camera motion retain the same rig while the proxy room can be hidden. Other room consumers retain their existing default behavior.

Preserved values:

| Branch | Lights |
| --- | --- |
| Polygon room (`RoomMesh`, including named Grand Hall) | Hemisphere `#f0f0ff` / `#d0c8c0`, intensity 1.2; ambient intensity 0.3 |
| `GrandHallRoom` fallback | Existing device-tier hemisphere; ambient `#f7ead0`, 0.38; directional `[12,5.5,9]`, `#f7dfae`, 0.52; directional `[-10,6,-8]`, `#e5edf4`, 0.16; both directional shadows disabled |

The former room groups have no transforms, so extraction does not alter light positions. No splat shader, exposure, source asset, opacity, camera, or delivery setting changed. Installed Spark 2.1 creates its renderer `ShaderMaterial` without enabling scene lights; Three's `ShaderMaterial.lights` defaults to `false`. That supports the expectation of unchanged captured appearance; it is not a substitute for the pending visual comparison.

No asynchronous UI changed, so the shared Activity convention required no new UI work.

## Verification

The new 10-case `PlannerSceneLighting.test.tsx` first ran against baseline: **7 failed, 3 passed**, reproducing Splat, lean viewport, and camera-motion light loss. After the implementation, all 10 pass. It mounts actual room/light components selected by the planner with a CPU-only Canvas harness; unrelated GPU-dependent children are omitted.

Covered behavior: repeated Mesh/Splat/Hybrid switching; named Grand Hall, custom polygon, and no-space fallback; 768 and 1440 px room viewports; camera motion; missing captured assets; standalone room defaults; fallback device-tier updates; exact light counts and unchanged settings across switches.

Commands from `packages/web`:

```powershell
pnpm exec vitest run src/components/editor/__tests__/PlannerSceneLighting.test.tsx src/components/editor/__tests__/PlannerScene.test.tsx src/components/__tests__/GrandHallRoom.test.tsx src/lib/__tests__/lighting.test.ts --maxWorkers=2
pnpm exec tsc --noEmit
pnpm exec tsc -p e2e --noEmit
pnpm exec eslint src/components/RoomLighting.tsx src/components/GrandHallRoom.tsx src/components/editor/RoomMesh.tsx src/components/editor/PlannerScene.tsx src/components/editor/__tests__/PlannerSceneLighting.test.tsx
pnpm exec vite build --mode test
```

Results: **125 tests passed** across four files; both TypeScript checks passed; changed-file lint passed; build passed. Build reported an unmatched CSS brace warning in an existing `@media (max-width: 640px)` rule; this candidate changes no CSS. `--mode test` checks the compiled bundle without production environment enforcement or Sentry source-map publication. It is not a production deployment qualification.

An independent read-only code review found no material issues. `git diff --check` passed (Windows line-ending notices only).

## Local visual handoff

No browser or GPU session was started by the implementing agent. The coordinator owns the single real-GPU comparison using the actual 162-item furnished draft, read-only API passthrough, and captured assets.

From `D:/claude/venviewer-demo-lighting-20260906/packages/web`:

```powershell
$env:VITE_API_URL='https://api.venviewer.com'
$env:SPLAT_STAGING_ROOT='D:/claude/splats'
& 'C:/Users/blake/AppData/Roaming/npm/pnpm.cmd' exec vite --host 127.0.0.1 --port 5199 --strictPort
```

Open the existing draft at `/plan/3b18bfc3-4a40-4723-8130-13134c80e16e?space=grand-hall&capture=1`. Check Splat + Walk with the actual furniture, then switch modes at a fixed camera to confirm one light rig and no return to black furniture. Use the existing GET-only CORS passthrough pattern; block writes. Capture source-only/background regions at matched camera and render state if making a pixel-stability claim.

No push, merge, deployment, raw-asset modification, paid job, or reconstruction acceptance was performed.
