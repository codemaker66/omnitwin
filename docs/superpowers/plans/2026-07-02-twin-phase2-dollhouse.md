# Twin Phase 2 — Dollhouse & Floorplan — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** An orbitable dollhouse of Trades Hall (optimized from `trades-hall-web.glb`), the signature spring dive from dollhouse into any pano node, and an orthographic floorplan mode with per-floor slicing — all inside the existing Twin viewer.

**Architecture:** twin-forge gains a mesh step (gltf-transform programmatic API: prune/dedup/meshopt + WebP textures — no KTX2 toolchain needed; three.js decodes both natively) writing `mesh/dollhouse.glb` into the bundle and an optional `mesh` field into the manifest. The viewer gains a three-state mode machine (walk ⇄ dollhouse ⇄ plan) where dollhouse/plan render the mesh + node dots and the dive is a spring camera flight with crossfade. The mesh shares the E57 Z-up frame (verified: GLB bounds z 0.6–6.8 = storey heights, y negative like the scan poses), so it uses the SAME basis conversion as poses, with a visual calibration gate.

**Tech Stack:** gltf-transform (@gltf-transform/core+functions+extensions) + meshoptimizer + sharp (forge); three GLTFLoader + MeshoptDecoder + drei useGLTF + three-stdlib OrbitControls/MapControls (viewer; all already in the stack except gltf-transform/meshoptimizer).

## Global Constraints

- All Phase-1 constraints hold (strict TS, zero `any`, springs-not-tweens, claim-safe copy, explicit-pathspec commits, Fact-Forcing Gate answered-then-retry, absolute paths into the forge CLI).
- Spec budgets (program spec §6 Phase 2): optimized dollhouse GLB **≤ 8 MB**; twin chunk growth **≤ +80 KB gz**; dive-in/out **≤ 1.2 s**.
- `mesh` is OPTIONAL in twin/0 (bundles without a mesh keep working; the viewer hides dollhouse/plan modes when absent).
- Deviation of record vs spec wording: WebP textures instead of KTX2 (`EXT_texture_webp` — avoids the native KTX toolchain on Windows; same size goal). Log it in the session log.
- Never commit bundle output; source GLB stays on F: untouched.

---

### Task 1: twin/0 optional mesh field + forge manifest support

**Files:**
- Modify: `packages/types/src/twin.ts`, test `packages/types/src/__tests__/twin.test.ts`
- Modify: `tools/twin-forge/src/build-manifest.ts`, test `tools/twin-forge/src/__tests__/build-manifest.test.ts`

**Interfaces:**
- Produces: `TwinMeshSchema = z.object({ path: z.literal("mesh/dollhouse.glb"), bytes: z.number().int().positive(), sourceName: z.string().min(1) })`; `TwinManifestSchema` gains `mesh: TwinMeshSchema.optional()`; `ManifestOptions` gains `mesh?: TwinManifest["mesh"]` passed through by `buildManifest`.

- [ ] Failing tests: types — manifest WITH mesh `{ path: "mesh/dollhouse.glb", bytes: 7340032, sourceName: "trades-hall-web.glb" }` parses; wrong `path` rejects; manifest WITHOUT mesh still parses. forge — `buildManifest(raw, { ...opts, mesh })` carries the field verbatim; omitted → absent.
- [ ] Implement (schema + options passthrough), tests green, `pnpm --filter @omnitwin/types build`, both typechecks.
- [ ] Commit: `feat(types,twin-forge): optional twin/0 dollhouse mesh descriptor`

---

### Task 2: forge mesh step — optimize GLB (meshopt + WebP)

**Files:**
- Create: `tools/twin-forge/src/mesh.ts`; test `tools/twin-forge/src/__tests__/mesh.test.ts`
- Modify: `tools/twin-forge/src/cli.ts` (new optional `--mesh <abs glb>` flag), `tools/twin-forge/package.json` (deps)

**Interfaces:**
- Produces: `optimizeMesh(srcGlb: string, outDir: string): Promise<{ bytes: number; sourceName: string }>` — writes `${outDir}/mesh/dollhouse.glb`; idempotent (existing output → return its size, no rewrite).
- Deps to add: `@gltf-transform/core`, `@gltf-transform/functions`, `@gltf-transform/extensions` (pin 4.3.0 — the source GLB was produced by v4.3.0; verify availability with `pnpm view`), `meshoptimizer` (pin what the registry serves, ~0.2x); record actual pins in the commit body.

- [ ] Failing test: build a tiny GLB programmatically with @gltf-transform/core (one quad mesh, one 64×64 png texture via sharp), run `optimizeMesh`, assert: output exists; parses with gltf-transform `NodeIO` registered with ALL extensions + meshopt decoder deps; `extensionsUsed` includes `EXT_meshopt_compression` and `EXT_texture_webp`; output bytes < input bytes; second run returns same bytes without rewriting (compare mtime).
- [ ] Implement:

```ts
// tools/twin-forge/src/mesh.ts
import { existsSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, meshopt, prune, textureCompress, weld } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";

/**
 * Source GLB → bundle dollhouse: dedup/prune/weld, meshopt geometry
 * compression, WebP textures capped at 1024². Target ≤ 8 MB (program spec
 * §6 Phase 2); the CLI warns when the result misses the budget.
 */
export async function optimizeMesh(
  srcGlb: string,
  outDir: string,
): Promise<{ bytes: number; sourceName: string }> {
  const dest = join(outDir, "mesh", "dollhouse.glb");
  const sourceName = basename(srcGlb);
  if (existsSync(dest)) {
    return { bytes: (await stat(dest)).size, sourceName };
  }
  await mkdir(join(outDir, "mesh"), { recursive: true });

  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.encoder": MeshoptEncoder });

  const doc = await io.read(srcGlb);
  await doc.transform(
    dedup(),
    prune(),
    weld(),
    textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024] }),
    meshopt({ encoder: MeshoptEncoder }),
  );
  await io.write(dest, doc);
  return { bytes: (await stat(dest)).size, sourceName };
}
```

  (If ≤ 8 MB needs more, add `simplify` from @gltf-transform/functions with `{ simplifier: MeshoptSimplifier, ratio: 0.75, error: 0.001 }` — then Task 4's visual gate judges the geometry loss.)

- [ ] CLI: optional `--mesh`; when present run `optimizeMesh`, pass the result into `buildManifest`'s `mesh` option, print `mesh: <bytes> bytes from <sourceName>` and `WARN mesh exceeds 8 MB budget` when over.
- [ ] Tests green, typecheck clean. Commit: `feat(twin-forge): dollhouse mesh optimization (meshopt + webp) behind --mesh`

---

### Task 3: run the forge mesh step on the real GLB

- [ ] Run (absolute paths, from repo root):

```powershell
pnpm --filter @omnitwin/twin-forge forge -- --cubemaps "F:\downloads (some very important)\E57\cubemaps" --poses "F:\downloads (some very important)\E57\poses.json" --out "C:\Users\blake\omnitwin2\packages\web\public\twin\trades-hall" --venue trades-hall --name "Trades Hall Glasgow" --overrides "C:\Users\blake\omnitwin2\tools\twin-forge\nav-overrides\trades-hall.json" --mesh "F:\downloads (some very important)\mp_matterpak_TH_T9pXgB4ygNf\trades-hall-web.glb"
```

  Tiles all skip (idempotent). Expect `mesh/dollhouse.glb` ≤ 8 MB (if over: enable simplify per Task 2, delete the output, re-run). Manifest re-validates with `mesh`. Record actual bytes in the session log. Nothing to commit unless Task 2 changed.

---

### Task 4: mesh basis + DollhouseStage + visual alignment gate

**Files:**
- Modify: `packages/web/src/twin/twin-basis.ts` (+test)
- Create: `packages/web/src/twin/DollhouseStage.tsx`; test `packages/web/src/twin/__tests__/DollhouseStage.test.tsx` (render-contract with mocked drei useGLTF)
- Modify: `packages/web/scripts/twin-visual-check.mjs` (dollhouse capture)

**Interfaces:**
- twin-basis produces: `E57_TO_THREE_QUAT: [number, number, number, number]` ([x,y,z,w]) — rotates Z-up E57 space into three space so a mesh root carrying it agrees with `e57PointToThree` for every point. Value: −90° about X = `[-Math.SQRT1_2, 0, 0, Math.SQRT1_2]`. Pin by test: rotate E57 point [1,2,3] with three's Quaternion (test-only import) and expect `e57PointToThree([1,2,3])` = [1,3,−2]. Also add `MESH_OFFSET_M: [number, number, number]` (default [0,0,0]) — the ONLY permissible alignment fudge, calibrated visually, never edited in component code.
- DollhouseStage produces: `DollhouseStage({ meshUrl, nodes, currentId, onDive }: { meshUrl: string; nodes: readonly TwinScanNode[]; currentId: string; onDive: (id: string) => void })` — `<group quaternion={E57_TO_THREE_QUAT} position={MESH_OFFSET_M}>` wrapping the useGLTF scene (`useGLTF(meshUrl, true, true, (loader) => loader.setMeshoptDecoder(MeshoptDecoder))`, MeshoptDecoder from `three/examples/jsm/libs/meshopt_decoder.module.js`); node dots OUTSIDE the group at `e57PointToThree(node.pose.t)` (gold spheres r 0.18, current node emissive pulse, hover spring, click → `onDive(id)` with the same 4px `event.delta` drag-guard as NavMarkers). No `useGLTF.preload` — the mesh loads when dollhouse mode first opens.
- [ ] **Visual alignment gate (mandatory):** harness captures dollhouse orbit; judge with Read: gold dots INSIDE the building volume, ~1.5 m above floor slabs, none outside walls. Offset → calibrate `MESH_OFFSET_M` only.
- [ ] Commit: `feat(web): twin dollhouse stage - shared-frame mesh with posed node dots`

---

### Task 5: mode machine + HUD control

**Files:**
- Create: `packages/web/src/twin/useTwinMode.ts` (+test)
- Modify: `packages/web/src/twin/TwinViewer.tsx`, `packages/web/src/twin/twin-copy.ts`, `packages/web/src/twin/twin.css`, `packages/web/src/twin/__fixtures__/twin-fixture.ts`

**Interfaces:**
- `useTwinMode(hasMesh: boolean): { mode: "walk" | "dollhouse" | "plan"; setMode: (m: "walk" | "dollhouse" | "plan") => void }` — `?mode=` URL sync (absent = walk; invalid or `hasMesh === false` clamps to walk).
- twin-copy adds `TWIN_MODE_WALK_LABEL = "Walk"`, `TWIN_MODE_DOLLHOUSE_LABEL = "Dollhouse"`, `TWIN_MODE_PLAN_LABEL = "Plan"` (swept by `allTwinCopy`).
- TwinViewer: segmented control top-right (`role="radiogroup"` aria-label "View mode", gold active state; hidden entirely when `manifest.mesh` is absent). Walk mode renders Phase-1 content unchanged. Dollhouse renders DollhouseStage + three-stdlib OrbitControls (target = node-extent centroid, maxPolarAngle ≈ 85°, `onChange={() => { invalidate(); }}` house pattern). Minimap hidden outside walk mode.
- Fixture: add `mesh` to `TWIN_FIXTURE_MANIFEST`; export a second `TWIN_FIXTURE_MANIFEST_NO_MESH`; TwinPage tests assert the control shows/hides accordingly.
- [ ] Commit: `feat(web): twin mode machine - walk/dollhouse/plan segmented control`

---

### Task 6: the dive (dollhouse ⇄ walk)

**Files:**
- Create: `packages/web/src/twin/useDive.ts` (+test)
- Modify: `packages/web/src/twin/TwinViewer.tsx`, `packages/web/src/twin/DollhouseStage.tsx`, `packages/web/scripts/twin-visual-check.mjs` (mid-dive capture)

**Interfaces:**
- `useDive({ onArrive }: { onArrive: (nodeId: string) => void }): { diving: boolean; progress: number; target: string | null; dive: (nodeId: string, from: { position: [number, number, number] }) => void }` — spring `{ stiffness: 42, damping: 13 }`; unit test with a cranked rAF clock asserts settle < 1200 ms simulated and `onArrive` fires exactly once.
- Choreography (TwinViewer): dollhouse dot click → `dive(id, { position: camera.position.toArray() })`; per frame camera position follows a quadratic bezier `from → mid → to` where `to = e57PointToThree(node.t)` and `mid = lerp(from, to, 0.5) + [0, 2.5, 0]` (swoop, not sink); fov 50→75 with progress; dollhouse group fades `1 − progress` (traverse materials once, transparent+opacity, restored on mode exit); target PanoStage mounts at `progress > 0.35` with opacity `(progress − 0.35) / 0.65`; on settle `onArrive(id)` → mode walk, `?node=` push and `?mode=` cleared in ONE history entry. Reverse: a quiet "Surface" button in walk HUD (only when mesh exists) springs backwards to an orbit position above the current node (same curve reversed, dollhouse fades in). Reduced motion: instant cut both directions.
- [ ] Commit: `feat(web): the dive - spring flight dollhouse->pano with crossfade`

---

### Task 7: floorplan mode

**Files:**
- Modify: `packages/types/src/twin.ts` (+forge import updates + tests): move `TWIN_STOREY_HEIGHT_M = 3.5` and `TWIN_TRIPOD_HEIGHT_M = 1.5` here from twin-forge's nav-graph (single source; forge re-imports).
- Create: `packages/web/src/twin/PlanStage.tsx` + pure helper test
- Modify: `packages/web/src/twin/TwinViewer.tsx`, `twin-copy.ts`, `twin.css`, harness (plan capture)

**Interfaces:**
- Plan mode: same mesh group, orthographic top-down (R3F `<OrthographicCamera makeDefault>`, zoom fit from node extents + 2 m), three-stdlib `MapControls` with `enableRotate: false` (pan/zoom only), `gl.localClippingEnabled` + per-material `clippingPlanes = [new Plane(new Vector3(0, -1, 0), sliceForFloor(floor).clipY)]` — read the planner's SectionPlane usage first and mirror its mechanics exactly.
- `sliceForFloor(floor: number): { clipY: number }` pure export: `clipY = floor * TWIN_STOREY_HEIGHT_M + 3.1` (slices just under the next slab; test floors 0/1/2).
- Floor buttons (only when >1 floor among nodes — reuse the minimap floor-toggle pattern); dots filter to the active floor; dot click → dive with a top-down start.
- [ ] Commit: `feat(web): twin floorplan - orthographic top-down with per-floor slicing`

---

### Task 8: quality gates

**Files:**
- Create: `packages/web/src/twin/__fixtures__/dollhouse-fixture.glb` (tiny real GLB ≤ 2 KB, generated once via gltf-transform in a script comment inside the fixture ts — committed so the REAL loader path runs headless in e2e)
- Modify: `packages/web/e2e/twin-walk.spec.ts`, `packages/web/src/__tests__/twin-chunk-budget.test.ts`

E2E adds (fixture manifest now carries mesh; route `**/mesh/dollhouse.glb` → the byte fixture): mode control appears with mesh and hides without; dollhouse → dot click → arrives in walk with `?node=` set and `?mode=` cleared; Surface returns; plan floor buttons filter dots; reduced-motion instant transitions; overflow matrix across all three modes; zero console errors.
Budget: twin chunk ≤ (Phase-1 measured baseline + 80 KB gz) — pin the baseline as a constant with the measurement date in a comment.

- [ ] Commit: `test(web): twin phase 2 gates - modes, dive, plan, budget delta`

---

### Task 9: ship pass

- [ ] Full chain (types/forge/web typecheck+lint+tests, build, twin+landing e2e, both visual harnesses). Dirty-tree caveat from the Phase-1 log applies: certify the full web suite in the clean worktree if the pre-existing App.test DPR failure persists in the main tree.
- [ ] `everything-claude-code:typescript-reviewer` on the Phase-2 diff; fix P0/P1.
- [ ] Docs: forge README mesh section; session log; tasks.md entry; memory update (mesh bytes actual, MESH_OFFSET_M final value, WebP-not-KTX2 deviation, dive spring constants).

---

## Self-review

- **Spec coverage §3 Phase 2:** GLB ≤ 8 MB (T2/T3), orbitable dollhouse (T4/T5), signature dive ≤ 1.2 s asserted (T6), floorplan + per-floor slicing via the planner's section-plane machinery (T7), +80 KB budget (T8). Nothing from the phase's spec scope deferred.
- **Placeholders:** none — code where code is the deliverable, exact props/behaviour contracts elsewhere (the Phase-1 pattern).
- **Type consistency:** `E57_TO_THREE_QUAT`/`MESH_OFFSET_M` (T4) consumed by T5/T6/T7; `useDive.dive(nodeId, { position })` matches T6 wiring; storey constants move to types once (T7) with forge updated in the same task; `TwinMeshSchema.path` literal matches `optimizeMesh`'s output path.
