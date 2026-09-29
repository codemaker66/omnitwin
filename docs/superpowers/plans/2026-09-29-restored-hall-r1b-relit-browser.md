# The Restored Hall — R1b "Relit in the browser" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On development and preview builds, a desktop visitor with WebGPU walks the Grand Hall relit live from the R1a relight package — night with the lamps lit, sunny morning, overcast noon, or any hour and date from a preview-only light control — on the restored floor drawn lit by the same light, with a dark or bright sky panel in each window; anything missing, and every other device, keeps the hall exactly as captured, and venviewer.com keeps the founder hold.

**Architecture:** A worker fetches and verifies the package (`venviewer.relight.v1`, SHA-256 per file) and decodes probes, stencils and floor light maps; each splat layer loads its tile's 12-byte records beside its geometry and hands both to the native splat host. The host keeps one `RelightFrame` per scene (uniforms, probe volumes, stencil atlas, floor light texture) and one `RelightDraw` per cached snapshot (records merged in snapshot order, a TSL compute pass writing one packed multiplier word per splat); the pass reruns when the light setting changes or a snapshot is built, never per frame, and never rebuilds a snapshot. A new optional `workingColorNode` on the patched `GaussianSplat` multiplies each splat's linear colour by its multiplier and applies the shared display function (exposure, 60% white balance, highlight roll-off above a knee: the splat's own captured brightest channel, at least 0.8; 0.8 for the floor and sky panels); hidden splats lose their alpha through the existing opacity hook. A TypeScript twin of every GPU formula (`relight-kernel.ts`, `display.ts`, `floor-light.ts`) is driven by R1a's test vectors and compared with GPU read-backs in the browser. Spec: `docs/superpowers/specs/2026-09-29-the-restored-hall-design.md` (§3 slice R1, §4.3, §4.4, §5, §6); contract: `docs/engineering/relight-package.md`; normative multiplier: R1a plan section "The multiplier".

**Tech Stack:** React 18.3 + @react-three/fiber 8.18, three 0.186 (WebGPURenderer, TSL compute, pnpm patch), Zod 3.24, zustand 5.0, Vitest 4.1 + happy-dom 20, TypeScript 5.7, pnpm 9.15.4, Node 22, Playwright 1.59 (headed Chromium on the RTX 4090), Python 3.13 (`C:/Python313/python.exe`, numpy, Pillow, `unittest`) for the photo check in `tools/relight`.

## Global Constraints

- Work only in the worktree `D:/claude/real-hall/repo`, branch `claude/real-hall`. Never edit `C:/Users/blake/omnitwin2` (the shared, dirty checkout) or another worktree.
- Commit with explicit pathspecs only; inspect `git diff --cached --stat` before each commit; every message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Founder hold (19 September 2026, amended 28 September 2026): splats, the relit hall and the light control exist only where `gaussianSplatsAvailable()` is true (development and Vercel preview builds, never a venviewer.com host). No query, saved state or role may override it; `?light=` and `?relight=off` are honoured only where it is true.
- TypeScript strict: no `any`, no `as unknown as`, `import type` for types, `noUncheckedIndexedAccess` respected, and the repo's `strictTypeChecked` lint (including `strict-boolean-expressions`, `no-unnecessary-condition`, `prefer-readonly`, `no-floating-promises`). The only `console` call added to app code is in `lib/relight/relight-warning.ts` (the Node verification script logs its progress), in the existing fallback pattern (`// eslint-disable-next-line no-console` and a `VenViewer: …` message, as `MeshErrorBoundary.tsx`). If TypeScript rejects a TSL type annotation in a plan code block, change the annotation only, never the node graph.
- Tests: `pnpm --filter @omnitwin/web exec vitest run <path relative to packages/web>`, one file per command, in the foreground (multi-file runs in this worktree die after about 60 s with "Command vitest not found"). Python: from `tools/relight`, `C:/Python313/python.exe -m unittest tests.<module> -v`.
- All visible loading and working states use `packages/web/src/components/shared/Activity.tsx` (`.claude/conventions/loading-and-working-motion.md`); the light control follows `.claude/conventions/product-experience.md` (quiet colour-change hovers, visible focus ring, reduced motion honoured, plain factual words).
- Build-PC GPU rule: one GPU-heavy job at a time. Every browser render or benchmark holds `D:/claude/visual-firstprinciples-20260928/gpu.lock`, a JSON file `{"owner":"<name>","since":"<ISO time>"}` created exclusively (`wx`) and deleted afterwards; if another owner holds it (the T-640 performance session uses it), wait. Render on demand, never a spinning loop.
- Outputs go to D: (`D:/claude/relight/grand-hall/…`); C: filled up twice on 29 September. Inputs are read-only: `D:/claude/splats/**` (served in development through `SPLAT_STAGING_ROOT=D:\claude\splats`; preview builds read the public R2 bucket `https://pub-2bf1ea54c4c642d3b19067b97c55dc5d.r2.dev/splats` directly), `D:/claude/real-hall/renovation/**`, `F:/**`.
- Spec numbers, verbatim: the multiplier is clamped to between 1/16 and 8; the codec round trip is within 1/20 of a stop; at the captured light the result is neutral; lamps default to 2,700 K (the package's measured lamp colour, 2,700–2,800 K); the night photo check reaches a correlation of at least 0.80 at station 45 and 0.85 at station 43 and is never worse than the hall as captured; with no package the renderer's output matches I1a; with the captured light it matches I1a within 1/20 of a stop; the walk stays inside the Twin budgets on the build PC (60 fps in motion on the RTX 4090: drag p95 frame at most 16.7 ms); decoding runs in a worker and loading adds no main-thread task over 50 ms; below-desktop devices and the WebGL fallback keep the hall as captured.
- The multiplier is normative in `docs/superpowers/plans/2026-09-29-restored-hall-r1a-light-bake.md`, section "The multiplier", with R1a's two amendments. The emitter boost is a setting: `Mlit = 1 + (β − 1) × smoothstep(0.45, 0.9, L)` for lit bulbs, where β (`emitterBoost`) is 1 at the captured light, 4 for the night preset and 1 otherwise. And the horizon test: a window counts, for the direct sun and for the sun-bounce glass area, only while `asin(σ·up)` in degrees is strictly greater than `horizon[w][round((atan2(σ·east, σ·north) in degrees) mod 360) mod 360]` (Python's round, halves to even; floored mod). R1b computes that gate once per setting on the CPU (`horizonGates` in Task 4) and the GPU reads the same five values, so the two match exactly.
- Display (decision 3, knee per call): `display(rgb, k) = rolloff_k(rgb × exposure × whiteBalance)`, the identity while the brightest channel is at most k, above it the Khronos-neutral highlight curve generalised to the knee, `newPeak = 1 − (1 − k)² / (peak + 1 − 2k)`, with desaturation 0.15. The floor and the sky panels use k = 0.8; a splat uses k = min(max(0.8, the brightest channel of its captured linear colour), 0.999), so at the captured light (multiplier 1, exposure 1, white balance 1) every splat's display is exactly the identity. No canvas tone mapping changes (I1a's "no film curve on a capture" holds).
- Presets (decision 4, from `presetsFromProof` and the proof's `work/exposure.json`): night = lamps lit with emitter boost 4, clear weather, 29 September 2026 22:00 (dark: sun −25°), exposure 0.825 (−0.3 EV), white balance [0.9161, 1, 1.2254]; sunny morning = lamps off, clear, 31 May 2026 09:00 BST, exposure 0.629 (−0.7 EV), white balance [1.1078, 1, 0.8304]; overcast noon = lamps off, overcast, 31 May 2026 13:00 BST, exposure 3.461 (+1.8 EV), white balance [1.2428, 1, 0.7361]; as captured = the capture's own light, emitter boost 1, exposure 1, white balance 1. At a preset's own hour and date these are exact; when the hour or date moves, exposure adapts by half the change in the floor's mean light and white balance by 60% of the change in its colour. The hour slider runs 06:00–22:00 (Europe/London time).
- Relighting is WebGPU-only (`nativeRendererStorageLimit(renderer) !== null`) and desktop-class only (device tier `high`). The splat vertex stage then binds 8 storage buffers (order, centre, covariance A, covariance B, colour, SH contribution, tile ids, multiplier words), exactly WebGPU's default per-stage limit, so the native canvas requests the adapter's `maxStorageBuffersPerShaderStage` whenever the adapter offers more than 8 (Task 12); the multiplier pass binds 6 (records, centres, colours, the two probe volumes, words) and the probe fold 2.
- The probe volume is R1a's coarse bounce grid (0.5 m over the hall box x −1.823..19.307, y −10.329..0.301, z 0.02..6.78: about 43 × 22 × 14 ≈ 13,000 probes, about 4 MB as binary16). The manifest's `probes.shape` is the only source of its size (the schema refuses more than 2,000,000 probes); nothing in R1b assumes a grid size.
- The shared patch: T-640 (GPU sort culling, branch `claude/perf-20260929`) edits `patches/three@0.186.0.patch` too. R1b's hook is one constructor option and one output line whose anchors T-640 leaves unchanged. Regenerate the patch the I1a Task 2 way; if T-640 is on master when R1b ships, merge master first and regenerate on top of it; if both are ready at once, T-640 lands first.

## Contracts R1b relies on from R1a's outputs

Items 1 and 2 are R1b's reading of R1a's outputs; items 3–6 are produced by R1a as amended on 29 September. Every one is still checked: 1 by Task 4's tests, 2–5 by Task 0 Step 2, 4 and 5 again in the browser by Task 18 (the fixture splats found at their model positions), and 6 by Task 19 Step 5. A mismatch is reported, not designed around.

1. **Test vectors.** `packages/web/src/lib/relight/__fixtures__/relight-vectors.json` has exactly the shape of `RelightVectorsSchema` in Task 4 (schema `venviewer.relight-vectors.v1`): the manifest slice, the three settings `captured`, `night`, `sunny_morning` in full (weights, sky level and colour, lamp levels, `emitterBoost`, sun direction and RGB), a sparse probe table holding every probe corner the 64 splats touch (float16, base64), the five windows' planes with their stencils as base64 PNGs and their 360 horizon elevations, and per splat its record (24 hex digits), model-frame position, captured linear colour and expected `m`, `alpha` and packed `word` per setting. The splats may include horizon-blocked cases.
2. **Tiles** are matched by `tiles[].tileSha256`, which equals the bundle's `sha256` of the served `.sog` (`packages/web/src/data/generated/trades-hall-splat-bundles.ts`); `count` equals the decoded splat count.
3. **Floor skin v2** (produced by R1a) is `floor-skin/v2/floor-skin.json`, schema string `venviewer.floor-skin.v1`, `provenance.kind` `"restored-albedo"`, texture already scaled to the fitted albedo (`colour.albedoScale` records the factor; R1b does not apply it again).
4. **`floor.texelToModel`** (produced by R1a) maps the texel-centre coordinates `(col, row, 0, 1)` of the 5 cm floor light maps to the model frame; row 0 is the first PNG row.
5. **`site.north` and `site.east`** (produced by R1a) equal the proof's `sun_vec_e57(0, 0)` and `sun_vec_e57(90, 0)`, so the browser's sun matches the proof's.
6. **Publishing** (produced by R1a): the publisher recurses into the version directory's subfolders, so every path in `files` (`tiles/`, `windows/`, `floor/` included) is published under `splats/trades-hall/grand-hall/relight/v1/` on R2, and `.gz` objects carry `Content-Type: application/octet-stream` and no `Content-Encoding` (the checksums are of the compressed bytes).

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `packages/web/src/lib/relight/relight-codec.ts` | Create | Log codes, octahedral normals, flags, multiplier words, float16 (twin of `codec.py`) |
| `packages/web/src/lib/relight/relight-manifest.ts` | Create | `venviewer.relight.v1` schema, URL, tile matching and refusal |
| `packages/web/src/lib/relight/relight-warning.ts` | Create | One console warning per fallback kind |
| `packages/web/src/lib/relight/relight-png.ts` | Create | Bounded gunzip, 8-bit PNG decoding, base64 |
| `packages/web/src/lib/relight/relight-kernel.ts` | Create | CPU reference of the multiplier (twin of `reference.py` and of the GPU pass) |
| `packages/web/src/lib/relight/relight-vectors.ts` | Create | Schema and loaders for R1a's test vectors |
| `packages/web/src/lib/relight/relight-assets.ts` | Create | Verified fetch, package and records decoding, capture fold and floor bounce (worker side) |
| `packages/web/src/lib/relight/relight-worker.ts` | Create | The decode worker |
| `packages/web/src/lib/relight/relight-worker-client.ts` | Create | Queued one-shot workers |
| `packages/web/src/lib/relight-package.ts` | Create | Package and records loading (cached; a failure warns once and returns null) |
| `packages/web/src/lib/sun.ts` | Create | NOAA solar position; sun direction in the model frame |
| `packages/web/src/lib/relight/daylight.ts` | Create | Daylight colour, CCT shift, sky level by elevation |
| `packages/web/src/lib/light-setting.ts` | Create | Presets, London time, setting for a choice, display adaptation, query rules |
| `packages/web/src/stores/light-setting-store.ts` | Create | The light choice and the relight status |
| `packages/web/src/lib/relight/display.ts` | Create | Display function and sky panel colour, TypeScript and TSL |
| `packages/web/src/lib/relight/floor-light.ts` | Create | Floor light per setting, room light, light-map UV mapping |
| `packages/web/src/lib/relight/relight-frame.ts` | Create | One package's GPU resources and uniforms; the probe fold pass |
| `packages/web/src/lib/relight/relight-apply.ts` | Create | Light choice → setting, gates and display |
| `packages/web/src/lib/relight/relight-draw.ts` | Create | Per-snapshot buffers, the TSL multiplier pass, render hooks |
| `packages/web/src/lib/relight/relight-tile-load.ts` | Create | Geometry and records for one tile; relight promises per tile |
| `packages/web/src/lib/relight/floor-material.ts` | Create | The lit floor material |
| `packages/web/src/lib/relight/sky-panels.ts` | Create | Sky panel geometry and material |
| `packages/web/src/lib/relight/relight-debug.ts` | Create | DEV-only read-back instruments (`window.__relight`) |
| `packages/web/src/lib/native-splat-scene.ts` | Modify | Relight frame, per-source records, key, pass runs, the relit stage's storage-buffer count |
| `packages/web/src/components/scene/NativeCanvas.tsx`, `packages/web/src/lib/native-renderer.ts` | Modify | Request the adapter's storage buffers per stage above 8; read the negotiated value |
| `packages/web/src/lib/native-gaussian-addon.d.ts` | Modify | `workingColorNode` type |
| `patches/three@0.186.0.patch`, `pnpm-lock.yaml` | Modify (regenerated) | `workingColorNode` option |
| `patches/README.three-native-splats.md` | Modify | Documents it |
| `packages/web/src/components/scene/NativeSplatLayer.tsx` | Modify | `relight` prop; records with geometry |
| `packages/web/src/components/scene/relight-context.ts` | Create | Relight state context |
| `packages/web/src/components/scene/RelightProvider.tsx` | Create | Package → frame → host; store subscription; sky panels |
| `packages/web/src/components/scene/RelightSkyPanels.tsx` | Create | Draws the sky panels |
| `packages/web/src/lib/floor-skin.ts` | Modify | `restored-albedo`, `albedoScale`, versioned package URL, `?floorskin=v1` |
| `packages/web/src/components/stage/StageFloor.tsx` | Modify | Lit floor skin v2, v1 fallback |
| `packages/web/src/components/rooms/RoomSplatScene.tsx` | Modify | Package once the backend is known, tile promises, provider, `?light=`, view capture |
| `packages/web/src/components/rooms/LightControl.tsx`, `LightControl.css` | Create | The preview-only light control |
| `packages/web/src/pages/RoomWalkPage.tsx` | Modify | The control, lazily and in development and preview bundles only |
| `packages/web/src/lib/native-current-view-capture.ts` | Modify | Optional size and PNG |
| `packages/web/src/lib/splat-staging-plugin.ts` | Modify | Serves the relight package in development |
| `packages/web/src/components/__tests__/stub-r3f-root.tsx` | Modify | Optional renderer fields for a test |
| `packages/web/scripts/relight-verify.mjs` | Create | Browser verification driver |
| `tools/relight/relight/browsercheck.py`, `tools/relight/tests/test_browsercheck.py` | Create | Image checks and the photo check |
| `tools/relight/relight/__main__.py` | Modify | `browser-check` command |
| `tools/relight/proof/shots.py` | Create (moved) if R1a did not | `07_compare.py` imports it |
| Tests under each `__tests__/` | Create/Modify | Regression coverage per task |
| `docs/engineering/native-splats.md`, `docs/engineering/relight-package.md`, the day's session log, `docs/state/tasks.md` | Modify | Record the change |

---

### Task 0: Baseline and prerequisites

**Files:** none changed.

- [ ] **Step 1: Check the branch and R1a's outputs**

```bash
cd D:/claude/real-hall/repo && git status --short && git log --oneline -5
ls D:/claude/splats/trades-hall/grand-hall/relight/v1/manifest.json D:/claude/splats/trades-hall/grand-hall/floor-skin/v2/floor-skin.json packages/web/src/lib/relight/__fixtures__/relight-vectors.json tools/relight/proof/07_compare.py tools/relight/proof/pano_view.py
```
Expected: a clean tree; the five files exist. If any is missing, stop and report: R1b consumes R1a's package, floor skin v2, test vectors and moved proof tooling.

- [ ] **Step 2: Check contracts 2–5 on the staged files**

```bash
cd D:/claude/real-hall/repo && node -e "
const fs=require('fs');const m=JSON.parse(fs.readFileSync('D:/claude/splats/trades-hall/grand-hall/relight/v1/manifest.json','utf8'));
const b=fs.readFileSync('packages/web/src/data/generated/trades-hall-splat-bundles.ts','utf8');
const miss=m.tiles.filter(t=>!b.includes(t.tileSha256));console.log('tiles',m.tiles.length,'not in bundle',miss.map(t=>t.tile));
const f=JSON.parse(fs.readFileSync('D:/claude/splats/trades-hall/grand-hall/floor-skin/v2/floor-skin.json','utf8'));console.log('floor v2',f.schema,f.provenance.kind,JSON.stringify(f.colour));
console.log('floor light',m.floor.skin,JSON.stringify(m.floor.size),m.floor.texel);
const r=Math.PI/180,q=14.3*r,N=[Math.cos(q),Math.sin(q),0],E=[Math.sin(q),-Math.cos(q),0];
const d=(a,c)=>Math.max(...a.map((v,i)=>Math.abs(v-c[i])));console.log('site',d(m.site.north,N)<1e-6&&d(m.site.east,E)<1e-6?'matches sun_vec_e57':'DIFFERS');
const T=m.floor.texelToModel,[w,h]=m.floor.size,at=(c,k)=>[T[0]*c+T[1]*k+T[3],T[4]*c+T[5]*k+T[7],T[8]*c+T[9]*k+T[11]];
const cs=[at(0,0),at(w-1,0),at(0,h-1),at(w-1,h-1)],ok=cs.every(([x,y,z])=>x>-1.923&&x<19.407&&y>-10.429&&y<0.401&&Math.abs(z)<0.2);
console.log('floor light corners',ok?'inside the hall box':'OUTSIDE',JSON.stringify(cs.map(p=>p.map(v=>+v.toFixed(3)))));
console.log('probes',JSON.stringify(m.probes.shape),m.probes.spacing);"
```
Expected: `tiles 24 not in bundle []`; `floor v2 venviewer.floor-skin.v1 restored-albedo {"matched":[…],"albedoScale":…}`; `floor light floor-skin/v2 [w,h] 0.05`; `site matches sun_vec_e57`; `floor light corners inside the hall box …` (the hall box x −1.823..19.307, y −10.329..0.301, 0.1 m margin, the floor within 0.2 m of z = 0); `probes [nx,ny,nz] 0.5` (about 43 × 22 × 14; the numbers are whatever the manifest says). Any other answer: stop and report which contract differs.

- [ ] **Step 3: Record the base commit (Task 18 builds the I1a comparison from it)**

```bash
mkdir -p D:/claude/relight/grand-hall/evidence/r1b && cd D:/claude/real-hall/repo && git rev-parse HEAD > D:/claude/relight/grand-hall/evidence/r1b/base-commit.txt && cat D:/claude/relight/grand-hall/evidence/r1b/base-commit.txt
```
Expected: one commit hash.

- [ ] **Step 4: Install and build shared types**

```bash
cd D:/claude/real-hall/repo && pnpm install --frozen-lockfile && pnpm --filter @omnitwin/types build
```
Expected: both exit 0.

- [ ] **Step 5: Baseline the test files this plan extends (one per command)**

```bash
cd D:/claude/real-hall/repo
pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/native-splat-scene.test.ts
pnpm --filter @omnitwin/web exec vitest run src/components/scene/__tests__/NativeSplatLayer.test.tsx
pnpm --filter @omnitwin/web exec vitest run src/components/stage/__tests__/StageFloor.test.tsx
pnpm --filter @omnitwin/web exec vitest run src/components/rooms/__tests__/RoomSplatScene.test.tsx
pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/floor-skin.test.ts
pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/splat-staging-plugin.test.ts
pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/native-current-view-capture.test.ts
pnpm --filter @omnitwin/web exec vitest run src/components/scene/__tests__/NativeCanvas.test.tsx
```
Expected: every file passes. A failure means the base is broken: stop.

- [ ] **Step 6: Note T-640's state**

```bash
cd D:/claude/real-hall/repo && git fetch origin && git log origin/master --oneline -5 -- patches/three@0.186.0.patch && git log --oneline -3 claude/perf-20260929
```
Expected: two lists. Record in the task report whether T-640's commits (`711c4346`, `3eb5b9b6`) are on origin/master; Tasks 9 and 19 act on it.

---

### Task 1: The relight codec in TypeScript

**Files:**
- Create: `packages/web/src/lib/relight/relight-codec.ts`
- Test: `packages/web/src/lib/relight/__tests__/relight-codec.test.ts`

**Interfaces:**
- Produces: `type Vec3 = readonly [number, number, number]`; `RELIGHT_SOURCES` (the nine names), `SOURCE_COUNT = 9`, `WINDOW_COUNT = 5`, `RECORD_BYTES = 12`, `LOG_STEPS = 254`, `MULTIPLIER_LO = -4`, `MULTIPLIER_HI = 3`; `CLASS_MASK`, `CLASS_INTERIOR`, `CLASS_EMBRASURE`, `CLASS_HIDDEN`, `CLASS_CH_EMITTER`, `CLASS_DOME_EMITTER`, `CLASS_COVE`, `CLASS_CH_FIXTURE`, `FLAG_ISO`, `FLAG_SUN`, `FLAG_CH_CENTRE`; `roundHalfEven(value: number): number`; `encodeLog(value: number, lo: number, hi: number): number`; `decodeLog(code: number, lo: number, hi: number): number`; `decodeOctahedral(byteU: number, byteV: number): Vec3`; `packMultiplierWord(m: Vec3, alpha: number): number`; `unpackMultiplierWord(word: number): { readonly m: Vec3; readonly alpha: number }`; `multiplierCodeDistance(a: number, b: number): number`; `recordFromHex(hex: string): Uint8Array`; `decodeHalfFloat(bits: number): number`.

- [ ] **Step 1: Write the failing test**

`packages/web/src/lib/relight/__tests__/relight-codec.test.ts` (expected values come from the committed R1a codec, `tools/relight/relight/codec.py`, commit `ec4dd7bf`):

```ts
import { describe, expect, it } from "vitest";
import {
  CLASS_MASK, FLAG_CH_CENTRE, FLAG_ISO, FLAG_SUN, RECORD_BYTES,
  decodeHalfFloat, decodeLog, decodeOctahedral, encodeLog, multiplierCodeDistance,
  packMultiplierWord, recordFromHex, roundHalfEven, unpackMultiplierWord,
} from "../relight-codec.js";

describe("relight codec (T-639 R1b)", () => {
  it("rounds halves to the even neighbour, as numpy.rint and WGSL round do", () => {
    expect([0.5, 1.5, 2.5, -1.5, 2.4, 2.6].map(roundHalfEven)).toEqual([0, 2, 2, -2, 2, 3]);
  });

  it("round-trips a log code within a twentieth of a stop", () => {
    for (let exponent = -20; exponent <= 5; exponent += 0.013) {
      const back = decodeLog(encodeLog(2 ** exponent, -20, 5), -20, 5);
      expect(Math.abs(Math.log2(back) - exponent)).toBeLessThanOrEqual(0.05);
    }
  });

  it("codes zero, negatives and NaN as zero, and decodes code zero to zero", () => {
    expect([0, -1, Number.NaN].map((value) => encodeLog(value, -25, 0))).toEqual([0, 0, 0]);
    expect(decodeLog(0, -25, 0)).toBe(0);
  });

  it("decodes a source's log codes as the package contract says", () => {
    expect(decodeLog(1, -22, 3)).toBe(2 ** -22);
    expect(decodeLog(200, -22, 3)).toBeCloseTo(0.1877147827003019, 14);
    expect(decodeLog(255, -22, 3)).toBe(8);
    expect(encodeLog(0.3, -22, 3)).toBe(207);
  });

  it("decodes octahedral normals as the R1a codec does", () => {
    const cases: [number, number, number, number, number][] = [
      [128, 128, 0.003952507, 0.003952507, 0.999984378],
      [255, 128, 0.99999225, 0, -0.003936977],
      [0, 0, 0, 0, -1],
      [200, 30, 0.396274912, -0.726504005, -0.561389459],
      [10, 250, -0.044226578, 0.088453156, -0.99509801],
    ];
    for (const [u, v, x, y, z] of cases) {
      const normal = decodeOctahedral(u, v);
      expect(normal[0]).toBeCloseTo(x, 8);
      expect(normal[1]).toBeCloseTo(y, 8);
      expect(normal[2]).toBeCloseTo(z, 8);
    }
  });

  it("packs multiplier words exactly as the R1a codec does, clamped to 1/16..8", () => {
    expect(packMultiplierWord([1, 0.5, 8], 1)).toBe(4294930066);
    expect(packMultiplierWord([1 / 16, 2, 0], 1)).toBe(4278236673);
    expect(packMultiplierWord([3, 3, 3], 0)).toBe(13421772);
    expect(packMultiplierWord([100, 1e-9, 1], 1)).toBe(4287758847);
  });

  it("unpacks a word to its multipliers and alpha", () => {
    const { m, alpha } = unpackMultiplierWord(4294930066);
    expect(m[0]).toBeCloseTo(0.9972747942258295, 14);
    expect(m[1]).toBeCloseTo(0.5013663264077008, 14);
    expect(m[2]).toBe(8);
    expect(alpha).toBe(1);
    expect(unpackMultiplierWord(4278236673).m[2]).toBe(0);
  });

  it("measures the code distance between two words channel by channel", () => {
    expect(multiplierCodeDistance(4294930066, 4294930066)).toBe(0);
    expect(multiplierCodeDistance(packMultiplierWord([1, 1, 1], 1), packMultiplierWord([1.02, 1, 1], 1))).toBe(1);
  });

  it("reads a record from its hexadecimal form and refuses any other length", () => {
    const record = recordFromHex("c80000000096000000808000");
    expect(record.length).toBe(RECORD_BYTES);
    expect(Array.from(record)).toEqual([200, 0, 0, 0, 0, 150, 0, 0, 0, 128, 128, 0]);
    expect(() => recordFromHex("00")).toThrow("24 hexadecimal digits");
  });

  it("keeps the contract's flag layout and decodes binary16 probe values", () => {
    expect(CLASS_MASK).toBe(0b111);
    expect([FLAG_ISO, FLAG_SUN, FLAG_CH_CENTRE]).toEqual([8, 16, 32]);
    expect(decodeHalfFloat(0x3c00)).toBe(1);
    expect(decodeHalfFloat(0xc000)).toBe(-2);
    expect(decodeHalfFloat(0x0001)).toBe(2 ** -24);
    expect(decodeHalfFloat(0x7c00)).toBe(Infinity);
    expect(decodeHalfFloat(0x3555)).toBeCloseTo(0.333251953125, 12);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/relight-codec.test.ts`
Expected: FAIL — cannot find module `../relight-codec.js`.

- [ ] **Step 3: Implement** — create `packages/web/src/lib/relight/relight-codec.ts`:

```ts
/**
 * Byte codec of the relight package (docs/engineering/relight-package.md): the
 * TypeScript twin of tools/relight/relight/codec.py (T-639 R1b). A record is 12
 * bytes per splat: nine log-coded direct-light values, an octahedral normal and a
 * flags byte. A multiplier word packs three log codes over [2^-4, 2^3] and alpha.
 */
export type Vec3 = readonly [number, number, number];

export const RELIGHT_SOURCES = ["W1", "W2", "W3", "W4", "W5", "cove", "ch_end", "ch_centre", "dome"] as const;
export const SOURCE_COUNT = RELIGHT_SOURCES.length;
export const WINDOW_COUNT = 5;
export const RECORD_BYTES = 12;
export const LOG_STEPS = 254;
export const MULTIPLIER_LO = -4;
export const MULTIPLIER_HI = 3;

export const CLASS_MASK = 0b111;
export const CLASS_INTERIOR = 0;
export const CLASS_EMBRASURE = 1;
export const CLASS_HIDDEN = 2;
export const CLASS_CH_EMITTER = 3;
export const CLASS_DOME_EMITTER = 4;
export const CLASS_COVE = 5;
export const CLASS_CH_FIXTURE = 6;
export const FLAG_ISO = 1 << 3;
export const FLAG_SUN = 1 << 4;
export const FLAG_CH_CENTRE = 1 << 5;

/** numpy.rint, Python round() and WGSL round(): an exact half goes to the even neighbour. */
export function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (fraction > 0.5) return floor + 1;
  if (fraction < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/** 0 for zero, negative or NaN; otherwise 1..255 evenly spaced in log2 over [lo, hi]. */
export function encodeLog(value: number, lo: number, hi: number): number {
  if (!(hi > lo)) throw new RangeError("A log range needs hi above lo.");
  if (!(value > 0)) return 0;
  const t = (Math.log2(value) - lo) / (hi - lo);
  return 1 + roundHalfEven(Math.min(1, Math.max(0, t)) * LOG_STEPS);
}

export function decodeLog(code: number, lo: number, hi: number): number {
  return code > 0 ? 2 ** (lo + (code - 1) * (hi - lo) / LOG_STEPS) : 0;
}

function signOf(value: number): number {
  return value >= 0 ? 1 : -1;
}

/** The unit normal in record bytes 9 and 10 (model frame). */
export function decodeOctahedral(byteU: number, byteV: number): Vec3 {
  const u = byteU / 255 * 2 - 1;
  const v = byteV / 255 * 2 - 1;
  const z = 1 - Math.abs(u) - Math.abs(v);
  const x = z < 0 ? (1 - Math.abs(v)) * signOf(u) : u;
  const y = z < 0 ? (1 - Math.abs(u)) * signOf(v) : v;
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}

function multiplierCode(value: number): number {
  const clipped = Math.min(Math.max(value, 0), 2 ** MULTIPLIER_HI);
  return clipped > 0 ? encodeLog(Math.max(clipped, 2 ** MULTIPLIER_LO), MULTIPLIER_LO, MULTIPLIER_HI) : 0;
}

/** Bits 0–7, 8–15, 16–23: log codes of R, G, B over [2^-4, 2^3] (0 = zero); bits 24–31: alpha. */
export function packMultiplierWord(m: Vec3, alpha: number): number {
  const alphaByte = roundHalfEven(Math.min(Math.max(alpha, 0), 1) * 255);
  return (multiplierCode(m[0]) | (multiplierCode(m[1]) << 8) | (multiplierCode(m[2]) << 16) | (alphaByte << 24)) >>> 0;
}

export function unpackMultiplierWord(word: number): { readonly m: Vec3; readonly alpha: number } {
  const byte = (shift: number): number => (word >>> shift) & 0xff;
  return {
    m: [
      decodeLog(byte(0), MULTIPLIER_LO, MULTIPLIER_HI),
      decodeLog(byte(8), MULTIPLIER_LO, MULTIPLIER_HI),
      decodeLog(byte(16), MULTIPLIER_LO, MULTIPLIER_HI),
    ],
    alpha: byte(24) / 255,
  };
}

/** The largest difference between two words' R, G and B codes. */
export function multiplierCodeDistance(a: number, b: number): number {
  let worst = 0;
  for (const shift of [0, 8, 16]) worst = Math.max(worst, Math.abs(((a >>> shift) & 0xff) - ((b >>> shift) & 0xff)));
  return worst;
}

/** A record written as 24 hexadecimal digits (the test vectors' form). */
export function recordFromHex(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]{24}$/u.test(hex)) throw new Error("A relight record is 24 hexadecimal digits.");
  const record = new Uint8Array(RECORD_BYTES);
  for (let index = 0; index < RECORD_BYTES; index += 1) {
    record[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return record;
}

/** IEEE 754 binary16 bits to a number (the probe volume's storage format). */
export function decodeHalfFloat(bits: number): number {
  const polarity = (bits & 0x8000) === 0 ? 1 : -1;
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x3ff;
  if (exponent === 0) return polarity * 2 ** -14 * (fraction / 1024);
  if (exponent === 31) return fraction === 0 ? polarity * Infinity : Number.NaN;
  return polarity * 2 ** (exponent - 15) * (1 + fraction / 1024);
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/relight-codec.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/relight/relight-codec.ts packages/web/src/lib/relight/__tests__/relight-codec.test.ts && git diff --cached --stat && git commit -m "feat(relight): the relight codec in the browser, twin of the bake's (T-639 R1b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The package manifest, its URL, tile refusal and the one warning

**Files:**
- Create: `packages/web/src/lib/relight/relight-manifest.ts`
- Create: `packages/web/src/lib/relight/relight-warning.ts`
- Create: `packages/web/src/lib/relight/__tests__/relight-test-package.ts` (a synthetic package for tests)
- Test: `packages/web/src/lib/relight/__tests__/relight-manifest.test.ts`, `packages/web/src/lib/relight/__tests__/relight-warning.test.ts`

**Interfaces:**
- Consumes: Task 1 (`RELIGHT_SOURCES`, `SOURCE_COUNT`, `WINDOW_COUNT`, `RECORD_BYTES`, `Vec3`); `splatBaseUrl` from `../../data/room-splat-bundles.js`; `GENERATED_VENUE_SLUG` from `../../data/generated/trades-hall-splat-bundles.js`.
- Produces: `ProofScenarioSchema`, `type ProofScenario`; `RelightManifestSchema`, `type RelightManifest`; `RELIGHT_ROOMS: Readonly<Record<string, string>>`; `relightManifestUrl(roomSlug: string, configuredBaseUrl: string | undefined): string | null`; `interface RelightTileSource { readonly url: string; readonly sha256: string; readonly bytes: number; readonly count: number }`; `type RelightTileLookup = { kind: "records"; source: RelightTileSource } | { kind: "refused"; reason: string }`; `relightTileLookup(manifest: RelightManifest, baseUrl: string, tileFile: string, tileSha256: string): RelightTileLookup`; `warnRelightFallback(kind: string, message: string, cause?: unknown): void`; `resetRelightWarnings(): void`; test helpers `buildTestPackage(): TestPackage`, `testPng(width: number, height: number, channels: 1 | 4, pixel: (x: number, y: number, channel: number) => number): Uint8Array`, `TEST_BASE`, `TEST_TILE_SHA`.

- [ ] **Step 1: Write the synthetic package** — create `packages/web/src/lib/relight/__tests__/relight-test-package.ts`:

```ts
import { createHash } from "node:crypto";
import { deflateSync, gzipSync } from "node:zlib";
import { DataUtils } from "three";
import { RECORD_BYTES } from "../relight-codec.js";

// A complete, tiny relight package for tests: a 2 × 2 × 2 probe grid over the
// unit cube, five 1 m windows side by side, a 2 × 2 floor and one tile of three
// splats, served by an in-memory fetch.

export const TEST_BASE = "https://cdn.test/splats/trades-hall/grand-hall/relight/v1/";
export const TEST_TILE_SHA = "a".repeat(64);

const sha = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  new DataView(out.buffer).setUint32(0, data.length);
  out.set(Array.from(type, (character) => character.charCodeAt(0)), 4);
  out.set(data, 8);
  return out; // CRC left zero: the decoder relies on the file's SHA-256.
}

/** An 8-bit PNG, greyscale (1 channel) or RGBA (4), filter 0 on every row. */
export function testPng(width: number, height: number, channels: 1 | 4, pixel: (x: number, y: number, channel: number) => number): Uint8Array {
  const stride = width * channels;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let c = 0; c < channels; c += 1) raw[y * (stride + 1) + 1 + x * channels + c] = pixel(x, y, c);
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = channels === 1 ? 0 : 6;
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", new Uint8Array(deflateSync(raw))),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

type FileEntries = Record<string, { sha256: string; bytes: number }>;

function testManifest(entries: FileEntries, recordsEntry: { sha256: string; bytes: number }) {
  const bearing = 14.3 * Math.PI / 180;
  const windows = [0, 1, 2, 3, 4].map((w) => {
    const plane = (y: number, tag: "inner" | "glass") => ({
      origin: [2 * w, y, 2], u: [1, 0, 0], v: [0, 0, -1], width: 1, height: 1, normal: [0, -1, 0],
      stencil: `windows/W${String(w + 1)}-${tag}.png`, stencilSize: [4, 3],
    });
    return {
      id: `W${String(w + 1)}`, glassDepth: 0.5,
      outline: { x0: 2 * w, x1: 2 * w + 1, sill: 1, top: 2, kind: "rect" },
      planes: { inner: plane(0, "inner"), glass: plane(-0.5, "glass") },
      horizon: Array.from({ length: 360 }, () => 0),
    };
  });
  return {
    schema: "venviewer.relight.v1", room: "grand-hall", createdAt: "2026-09-29T00:00:00Z", tool: "test",
    model: { frame: "e57", tileToModel: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
    site: {
      latitude: 55.8593, longitude: -4.2491,
      north: [Math.cos(bearing), Math.sin(bearing), 0], east: [Math.sin(bearing), -Math.cos(bearing), 0], up: [0, 0, 1],
    },
    sources: ["W1", "W2", "W3", "W4", "W5", "cove", "ch_end", "ch_centre", "dome"],
    encoding: {
      record: 12,
      sources: Array.from({ length: 9 }, () => [-22, 3]),
      floor: Array.from({ length: 9 }, () => [-22, 3]),
      multiplier: { lo: -4, hi: 3 },
    },
    capture: {
      weights: [1, 1, 1, 1, 1, 0.5, 0.5, 0.5, 0.5],
      colours: [[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1], [1.62, 1, 0.47], [1.62, 1, 0.47], [1.62, 1, 0.47], [1.62, 1, 0.47]],
      daylightColour: [1, 1, 1], skyBandWeights: [0.15, 0.66, 1, 1.21], gamma: 1,
    },
    lamps: { measuredColour: [1.62, 1, 0.47], cct: 2750, groups: { cove: 5, ch_end: 6, ch_centre: 7, dome: 8 } },
    sun: { bounce: { beta: 0.5, skyFlux: [1, 1, 1, 1, 1] }, fresnel: Array.from({ length: 101 }, () => 0.9) },
    windows,
    probes: { origin: [0, 0, 0], spacing: 1, shape: [2, 2, 2], file: "probes.bin.gz", validFile: "probe-valid.bin.gz" },
    floor: {
      skin: "floor-skin/v2", texelToModel: [0.5, 0, 0, 0.25, 0, 0.5, 0, 0.25, 0, 0, 0, 0.02, 0, 0, 0, 1],
      texel: 0.5, size: [2, 2], files: ["floor/light-0.png", "floor/light-1.png", "floor/light-2.png"],
    },
    tiles: [{ tile: "t.sog", tileSha256: TEST_TILE_SHA, level: 5, count: 3, file: "tiles/t.relight.gz", sha256: recordsEntry.sha256, bytes: recordsEntry.bytes }],
    presetsFromProof: {
      night: { sky: 0, sun: null, house: 1, emit: "lit", ext_rgb: [0.03, 0.042, 0.085], ext_desat: 0.85 },
      sunny_morning: { sky: 0.7, sky_T: 9000, sun: [2026, 5, 31, 8, 0], sun_ratio: 16, sun_T: 4900, house: 0, emit: "unlit", ext_rgb: [1.08, 1.04, 1], ext_desat: 0 },
      overcast_noon: { sky: 1.2, sky_T: 6500, sun: null, house: 0, emit: "unlit", ext_rgb: [1, 1, 1.02], ext_desat: 0.35 },
    },
    evidence: {},
    files: entries,
  };
}

export interface TestPackage {
  readonly manifestUrl: string;
  readonly manifest: ReturnType<typeof testManifest>;
  readonly files: Map<string, Uint8Array>;
  readonly records: Uint8Array;
  readonly fetch: (url: string) => Promise<Response>;
}

export function buildTestPackage(): TestPackage {
  const files = new Map<string, Uint8Array>();
  const entries: FileEntries = {};
  const put = (path: string, bytes: Uint8Array): { sha256: string; bytes: number } => {
    files.set(path, bytes);
    const entry = { sha256: sha(bytes), bytes: bytes.length };
    entries[path] = entry;
    return entry;
  };
  // Every probe valid; source k lights every channel and face at 0.01 (k + 1).
  const halves = new Uint16Array(8 * 162);
  for (let probe = 0; probe < 8; probe += 1) {
    for (let source = 0; source < 9; source += 1) {
      for (let value = 0; value < 18; value += 1) halves[probe * 162 + source * 18 + value] = DataUtils.toHalfFloat(0.01 * (source + 1));
    }
  }
  put("probes.bin.gz", new Uint8Array(gzipSync(new Uint8Array(halves.buffer))));
  put("probe-valid.bin.gz", new Uint8Array(gzipSync(new Uint8Array(8).fill(1))));
  for (let w = 1; w <= 5; w += 1) {
    for (const tag of ["inner", "glass"]) put(`windows/W${String(w)}-${tag}.png`, testPng(4, 3, 1, () => 255));
  }
  // light-0: W1..W4 at code 200; light-1: W5, cove, ch_end, ch_centre at 150; light-2: dome at 100.
  [200, 150, 100].forEach((code, index) => {
    put(`floor/light-${String(index)}.png`, testPng(2, 2, 4, (_x, _y, channel) => (index === 2 && channel > 0 ? 0 : code)));
  });
  const records = new Uint8Array(3 * RECORD_BYTES);
  records.set([200, 0, 0, 0, 0, 150, 0, 0, 0, 128, 128, 0], 0);                  // interior, W1 and the cove, normal +z
  records.set([0, 0, 0, 0, 0, 0, 0, 0, 0, 128, 128, 2], RECORD_BYTES);            // hidden
  records.set([180, 0, 0, 0, 0, 0, 0, 0, 0, 128, 128, 16], 2 * RECORD_BYTES);     // interior, reachable by the sun
  const recordsEntry = put("tiles/t.relight.gz", new Uint8Array(gzipSync(records)));
  const manifest = testManifest(entries, recordsEntry);
  files.set("manifest.json", new TextEncoder().encode(JSON.stringify(manifest)));
  const fetch = (url: string): Promise<Response> => {
    const path = url.startsWith(TEST_BASE) ? url.slice(TEST_BASE.length) : "";
    const bytes = files.get(path);
    if (bytes === undefined) return Promise.resolve(new Response(null, { status: 404 }));
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return Promise.resolve(new Response(body, { headers: { "content-type": path.endsWith(".json") ? "application/json" : "application/octet-stream" } }));
  };
  return { manifestUrl: `${TEST_BASE}manifest.json`, manifest, files, records, fetch };
}
```

- [ ] **Step 2: Write the failing tests**

`packages/web/src/lib/relight/__tests__/relight-manifest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { RelightManifestSchema, relightManifestUrl, relightTileLookup } from "../relight-manifest.js";
import { TEST_BASE, TEST_TILE_SHA, buildTestPackage } from "./relight-test-package.js";

const { manifest } = buildTestPackage();

describe("relight package manifest (T-639 R1b)", () => {
  it("accepts a complete venviewer.relight.v1 manifest", () => {
    const parsed = RelightManifestSchema.parse(manifest);
    expect(parsed.tiles[0]?.count).toBe(3);
    expect(parsed.windows.map((window) => window.id)).toEqual(["W1", "W2", "W3", "W4", "W5"]);
  });

  it.each([
    ["another schema", { ...manifest, schema: "venviewer.relight.v2" }],
    ["sources out of record order", { ...manifest, sources: ["W2", "W1", "W3", "W4", "W5", "cove", "ch_end", "ch_centre", "dome"] }],
    ["windows out of order", { ...manifest, windows: [...manifest.windows].reverse() }],
    ["a file named without a checksum", { ...manifest, probes: { ...manifest.probes, file: "probes-other.bin.gz" } }],
    ["a tile whose checksum entry differs", { ...manifest, tiles: manifest.tiles.map((tile) => ({ ...tile, sha256: "b".repeat(64) })) }],
    ["a site frame that is not orthonormal", { ...manifest, site: { ...manifest.site, east: [1, 0, 0] } }],
    ["an absolute path", { ...manifest, floor: { ...manifest.floor, files: ["/etc/light-0.png", "floor/light-1.png", "floor/light-2.png"] } }],
    ["a URL for a file", { ...manifest, probes: { ...manifest.probes, validFile: "https://elsewhere.test/valid.gz" } }],
    ["a dot segment", { ...manifest, probes: { ...manifest.probes, file: "../probes.bin.gz" } }],
  ])("refuses %s", (_label, candidate) => {
    expect(RelightManifestSchema.safeParse(candidate).success).toBe(false);
  });

  it("resolves a room's package beside its tiles, and nothing for other rooms", () => {
    expect(relightManifestUrl("grand-hall", undefined)).toBe("/splats/trades-hall/grand-hall/relight/v1/manifest.json");
    expect(relightManifestUrl("grand-hall", "https://cdn.example/splats/")).toBe("https://cdn.example/splats/trades-hall/grand-hall/relight/v1/manifest.json");
    expect(relightManifestUrl("saloon", undefined)).toBeNull();
  });

  it("finds a tile's records by the SHA-256 of the served tile", () => {
    const parsed = RelightManifestSchema.parse(manifest);
    const entry = parsed.tiles[0];
    if (entry === undefined) throw new Error("The test package has one tile.");
    expect(relightTileLookup(parsed, TEST_BASE, "t.sog", TEST_TILE_SHA)).toEqual({
      kind: "records",
      source: { url: `${TEST_BASE}tiles/t.relight.gz`, sha256: entry.sha256, bytes: entry.bytes, count: 3 },
    });
  });

  it("refuses records built for another capture of the tile, or a tile the package lacks", () => {
    const parsed = RelightManifestSchema.parse(manifest);
    expect(relightTileLookup(parsed, TEST_BASE, "t.sog", "c".repeat(64)))
      .toEqual({ kind: "refused", reason: "the relight records for t.sog were built for another capture of it" });
    expect(relightTileLookup(parsed, TEST_BASE, "u.sog", "c".repeat(64)))
      .toEqual({ kind: "refused", reason: "the relight package has no records for u.sog" });
  });
});
```

`packages/web/src/lib/relight/__tests__/relight-warning.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetRelightWarnings, warnRelightFallback } from "../relight-warning.js";

afterEach(() => { resetRelightWarnings(); vi.restoreAllMocks(); });

describe("relight fallback warning (T-639 R1b)", () => {
  it("warns once per kind, in the VenViewer fallback form", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const cause = new Error("404");
    warnRelightFallback("package", "The relight package could not be used; the hall is drawn as captured.", cause);
    warnRelightFallback("package", "again");
    warnRelightFallback("tile", "Part of the hall stays as captured.");
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenNthCalledWith(1, "VenViewer: The relight package could not be used; the hall is drawn as captured.", cause);
    expect(warn).toHaveBeenNthCalledWith(2, "VenViewer: Part of the hall stays as captured.");
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/relight-manifest.test.ts`
Expected: FAIL — cannot find module `../relight-manifest.js`.

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/relight-warning.test.ts`
Expected: FAIL — cannot find module `../relight-warning.js`.

- [ ] **Step 4: Implement the warning** — create `packages/web/src/lib/relight/relight-warning.ts`:

```ts
const warned = new Set<string>();

/**
 * One console warning per kind of relight fallback (spec §5): the hall is then
 * drawn as captured, or that part of it is, and the visitor never sees an error.
 */
export function warnRelightFallback(kind: string, message: string, cause?: unknown): void {
  if (warned.has(kind)) return;
  warned.add(kind);
  // eslint-disable-next-line no-console -- the one relight fallback warning (spec §5), as MeshErrorBoundary warns
  console.warn(`VenViewer: ${message}`, ...(cause === undefined ? [] : [cause]));
}

/** Tests only: forget which warnings were given. */
export function resetRelightWarnings(): void {
  warned.clear();
}
```

- [ ] **Step 5: Implement the manifest** — create `packages/web/src/lib/relight/relight-manifest.ts`:

```ts
import { z } from "zod";
import { GENERATED_VENUE_SLUG } from "../../data/generated/trades-hall-splat-bundles.js";
import { splatBaseUrl } from "../../data/room-splat-bundles.js";
import { RELIGHT_SOURCES, SOURCE_COUNT, WINDOW_COUNT, type Vec3 } from "./relight-codec.js";

// The relight package (docs/engineering/relight-package.md) is fetched from a
// public bucket and read as untrusted input: every file it names is a relative
// path inside the package with a checksum, and every size is bounded before
// anything is allocated from it.

const finite = z.number().finite();
const vec3 = z.tuple([finite, finite, finite]);
const rgb = z.tuple([finite.nonnegative(), finite.nonnegative(), finite.nonnegative()]);
const matrix4 = z.array(finite).length(16);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/u, "A SHA-256 is 64 lower-case hexadecimal digits.");
/** Segments start with a letter or digit, so no scheme, leading slash or dot segment passes. */
const packagePath = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/u, "A relight file is a relative path inside its package.");
const logRange = z.tuple([finite, finite]).refine(([lo, hi]) => hi > lo, "A log range needs hi above lo.");
const stencilPlane = z.object({
  origin: vec3, u: vec3, v: vec3,
  width: finite.positive(), height: finite.positive(),
  normal: vec3,
  stencil: packagePath,
  stencilSize: z.tuple([z.number().int().positive().max(2048), z.number().int().positive().max(2048)]),
});

/** One of the proof's scenarios as 05_relight.SCENARIOS defines it (other keys are ignored). */
export const ProofScenarioSchema = z.object({
  sky: finite.nonnegative(),
  sky_T: finite.positive().optional(),
  sun: z.tuple([z.number().int(), z.number().int(), z.number().int(), z.number().int(), finite]).nullable(),
  sun_ratio: finite.nonnegative().optional(),
  sun_T: finite.positive().optional(),
  house: finite.nonnegative(),
  emit: z.enum(["lit", "unlit", "off"]),
});
export type ProofScenario = z.infer<typeof ProofScenarioSchema>;

const SITE_TOLERANCE = 1e-6;
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export const RelightManifestSchema = z.object({
  schema: z.literal("venviewer.relight.v1"),
  room: z.string().min(1),
  createdAt: z.string(),
  tool: z.string(),
  model: z.object({ frame: z.literal("e57"), tileToModel: matrix4 }),
  site: z.object({ latitude: finite.min(-90).max(90), longitude: finite.min(-180).max(180), north: vec3, east: vec3, up: vec3 }),
  sources: z.array(z.string()).refine(
    (names) => names.length === SOURCE_COUNT && names.every((name, index) => name === RELIGHT_SOURCES[index]),
    "The sources are W1..W5, cove, ch_end, ch_centre and dome, in record order.",
  ),
  encoding: z.object({
    record: z.literal(12),
    sources: z.array(logRange).length(SOURCE_COUNT),
    floor: z.array(logRange).length(SOURCE_COUNT),
    multiplier: z.object({ lo: z.literal(-4), hi: z.literal(3) }),
  }),
  capture: z.object({
    weights: z.array(finite.nonnegative()).length(SOURCE_COUNT),
    colours: z.array(rgb).length(SOURCE_COUNT),
    daylightColour: rgb,
    skyBandWeights: z.array(finite).length(4),
    gamma: z.literal(1),
  }),
  lamps: z.object({
    measuredColour: rgb, cct: finite.positive(),
    groups: z.object({ cove: z.literal(5), ch_end: z.literal(6), ch_centre: z.literal(7), dome: z.literal(8) }),
  }),
  sun: z.object({
    bounce: z.object({ beta: finite.nonnegative(), skyFlux: z.array(finite.positive()).length(WINDOW_COUNT) }),
    fresnel: z.array(finite.min(0).max(1)).length(101),
  }),
  windows: z.array(z.object({
    id: z.enum(["W1", "W2", "W3", "W4", "W5"]),
    glassDepth: finite.positive(),
    outline: z.object({ x0: finite, x1: finite, sill: finite, top: finite, kind: z.string() }),
    planes: z.object({ inner: stencilPlane, glass: stencilPlane }),
    horizon: z.array(finite.min(-90).max(90)).length(360),
  })).length(WINDOW_COUNT),
  probes: z.object({
    origin: vec3,
    spacing: finite.positive(),
    shape: z.tuple([z.number().int().min(2).max(512), z.number().int().min(2).max(512), z.number().int().min(2).max(512)]),
    file: packagePath,
    validFile: packagePath,
  }),
  floor: z.object({
    skin: z.string().regex(/^floor-skin\/v[0-9]+$/u),
    texelToModel: matrix4,
    texel: finite.positive(),
    size: z.tuple([z.number().int().positive().max(4096), z.number().int().positive().max(4096)]),
    files: z.array(packagePath).length(3),
  }),
  tiles: z.array(z.object({
    tile: z.string().min(1),
    tileSha256: sha256,
    level: z.number().int().nullable(),
    count: z.number().int().positive().max(50_000_000),
    file: packagePath,
    sha256,
    bytes: z.number().int().positive(),
  })).min(1).max(256),
  presetsFromProof: z.object({ night: ProofScenarioSchema, sunny_morning: ProofScenarioSchema, overcast_noon: ProofScenarioSchema }),
  evidence: z.record(z.string(), z.unknown()),
  files: z.record(packagePath, z.object({ sha256, bytes: z.number().int().nonnegative() })),
}).superRefine((manifest, context) => {
  const issue = (path: (string | number)[], message: string): void => {
    context.addIssue({ code: z.ZodIssueCode.custom, path, message });
  };
  manifest.windows.forEach((window, index) => {
    if (window.id !== `W${String(index + 1)}`) issue(["windows", index, "id"], "The windows are listed W1..W5.");
  });
  const [nx, ny, nz] = manifest.probes.shape;
  if (nx * ny * nz > 2_000_000) issue(["probes", "shape"], "The probe grid is larger than the browser accepts.");
  const named = [
    manifest.probes.file, manifest.probes.validFile, ...manifest.floor.files,
    ...manifest.windows.flatMap((window) => [window.planes.inner.stencil, window.planes.glass.stencil]),
  ];
  for (const path of named) {
    if (manifest.files[path] === undefined) issue(["files"], `The manifest names ${path} without a checksum.`);
  }
  manifest.tiles.forEach((tile, index) => {
    const entry = manifest.files[tile.file];
    if (entry === undefined || entry.sha256 !== tile.sha256 || entry.bytes !== tile.bytes) {
      issue(["tiles", index], `The records ${tile.file} do not match their checksum entry.`);
    }
  });
  const { north, east, up } = manifest.site;
  const unit = [north, east, up].every((axis) => Math.abs(dot(axis, axis) - 1) <= SITE_TOLERANCE);
  const handed = cross(north, east).every((value, axis) => Math.abs(value + (up[axis] ?? 0)) <= SITE_TOLERANCE);
  if (!unit || Math.abs(dot(north, east)) > SITE_TOLERANCE || !handed) {
    issue(["site"], "north, east and up must be unit vectors with north ⟂ east and north × east = −up.");
  }
});
export type RelightManifest = z.infer<typeof RelightManifestSchema>;

/** Rooms with a relight package, by path beside their splat tiles. */
export const RELIGHT_ROOMS: Readonly<Record<string, string>> = { "grand-hall": "relight/v1" };

export function relightManifestUrl(roomSlug: string, configuredBaseUrl: string | undefined): string | null {
  const path = RELIGHT_ROOMS[roomSlug];
  if (path === undefined) return null;
  return `${splatBaseUrl(configuredBaseUrl)}/${GENERATED_VENUE_SLUG}/${roomSlug}/${path}/manifest.json`;
}

/** Where one tile's records are, what they must hash to and how many splats they hold. */
export interface RelightTileSource {
  readonly url: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly count: number;
}

export type RelightTileLookup =
  | { readonly kind: "records"; readonly source: RelightTileSource }
  | { readonly kind: "refused"; readonly reason: string };

/** A served tile's records, found by the SHA-256 of the tile itself (contract 2). */
export function relightTileLookup(manifest: RelightManifest, baseUrl: string, tileFile: string, tileSha256: string): RelightTileLookup {
  const entry = manifest.tiles.find((tile) => tile.tileSha256 === tileSha256);
  if (entry !== undefined) {
    return { kind: "records", source: { url: `${baseUrl}${entry.file}`, sha256: entry.sha256, bytes: entry.bytes, count: entry.count } };
  }
  const stem = tileFile.replace(/\.[^.]+$/u, "");
  const named = manifest.tiles.some((tile) => tile.tile === tileFile || tile.tile === stem);
  return {
    kind: "refused",
    reason: named
      ? `the relight records for ${tileFile} were built for another capture of it`
      : `the relight package has no records for ${tileFile}`,
  };
}
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/relight-manifest.test.ts`
Expected: PASS, 13 tests.

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/relight-warning.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 7: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/relight/relight-manifest.ts packages/web/src/lib/relight/relight-warning.ts packages/web/src/lib/relight/__tests__/relight-test-package.ts packages/web/src/lib/relight/__tests__/relight-manifest.test.ts packages/web/src/lib/relight/__tests__/relight-warning.test.ts && git diff --cached --stat && git commit -m "feat(relight): the package manifest read as untrusted input, and tiles matched by their SHA-256 (T-639 R1b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Gunzip and PNG decoding for the package

**Files:**
- Create: `packages/web/src/lib/relight/relight-png.ts`
- Modify: `packages/web/src/lib/relight/__tests__/relight-test-package.ts` (export a raw-scanline PNG writer)
- Test: `packages/web/src/lib/relight/__tests__/relight-png.test.ts`

**Interfaces:**
- Consumes: Task 2's `testPng` test helper.
- Produces: `interface Image8 { readonly width: number; readonly height: number; readonly channels: 1 | 4; readonly data: Uint8Array }`; `inflate(bytes: Uint8Array, format: "gzip" | "deflate", maxBytes: number): Promise<Uint8Array>`; `decodePng(bytes: Uint8Array): Promise<Image8>`; `base64Bytes(text: string): Uint8Array`; test helper `pngFromRaw(width: number, height: number, channels: 1 | 4, raw: Uint8Array): Uint8Array`.

- [ ] **Step 1: Export the raw-scanline writer** — in `packages/web/src/lib/relight/__tests__/relight-test-package.ts`, replace the whole `testPng` function with:

```ts
/** A PNG around already-filtered scanlines (each row: filter byte, then its bytes). */
export function pngFromRaw(width: number, height: number, channels: 1 | 4, raw: Uint8Array): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = channels === 1 ? 0 : 6;
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", new Uint8Array(deflateSync(raw))),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

/** An 8-bit PNG, greyscale (1 channel) or RGBA (4), filter 0 on every row. */
export function testPng(width: number, height: number, channels: 1 | 4, pixel: (x: number, y: number, channel: number) => number): Uint8Array {
  const stride = width * channels;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let c = 0; c < channels; c += 1) raw[y * (stride + 1) + 1 + x * channels + c] = pixel(x, y, c);
    }
  }
  return pngFromRaw(width, height, channels, raw);
}
```

- [ ] **Step 2: Write the failing test** — create `packages/web/src/lib/relight/__tests__/relight-png.test.ts`:

```ts
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { base64Bytes, decodePng, inflate } from "../relight-png.js";
import { pngFromRaw, testPng } from "./relight-test-package.js";

/** Grey pixels of a 3 × 5 image, one row per PNG filter 0..4, filtered as the PNG specification says. */
function filteredGrey(): { pixels: number[]; raw: Uint8Array } {
  const width = 3, height = 5;
  const pixels = Array.from({ length: width * height }, (_, index) => (Math.floor(index / width) * 50 + (index % width) * 30 + 7) % 256);
  const raw = new Uint8Array((width + 1) * height);
  for (let row = 0; row < height; row += 1) {
    raw[row * (width + 1)] = row;
    for (let x = 0; x < width; x += 1) {
      const value = pixels[row * width + x] ?? 0;
      const left = x > 0 ? pixels[row * width + x - 1] ?? 0 : 0;
      const up = row > 0 ? pixels[(row - 1) * width + x] ?? 0 : 0;
      const upLeft = row > 0 && x > 0 ? pixels[(row - 1) * width + x - 1] ?? 0 : 0;
      const p = left + up - upLeft;
      const paeth = Math.abs(p - left) <= Math.abs(p - up) && Math.abs(p - left) <= Math.abs(p - upLeft) ? left : Math.abs(p - up) <= Math.abs(p - upLeft) ? up : upLeft;
      const predictor = [0, left, up, Math.floor((left + up) / 2), paeth][row] ?? 0;
      raw[row * (width + 1) + 1 + x] = (value - predictor) & 0xff;
    }
  }
  return { pixels, raw };
}

describe("relight package decoding primitives (T-639 R1b)", () => {
  it("decodes an 8-bit greyscale PNG", async () => {
    const image = await decodePng(testPng(4, 3, 1, (x, y) => x * 10 + y));
    expect([image.width, image.height, image.channels]).toEqual([4, 3, 1]);
    expect(Array.from(image.data)).toEqual([0, 10, 20, 30, 1, 11, 21, 31, 2, 12, 22, 32]);
  });

  it("decodes an 8-bit RGBA PNG", async () => {
    const image = await decodePng(testPng(2, 1, 4, (x, _y, channel) => x * 100 + channel));
    expect([image.channels, ...image.data]).toEqual([4, 0, 1, 2, 3, 100, 101, 102, 103]);
  });

  it("undoes every PNG row filter", async () => {
    const { pixels, raw } = filteredGrey();
    expect(Array.from((await decodePng(pngFromRaw(3, 5, 1, raw))).data)).toEqual(pixels);
  });

  it("refuses what it does not read: other bit depths and non-PNG bytes", async () => {
    const sixteenBit = testPng(2, 2, 1, () => 0);
    sixteenBit[24] = 16;
    await expect(decodePng(sixteenBit)).rejects.toThrow("8-bit");
    await expect(decodePng(new Uint8Array([1, 2, 3]))).rejects.toThrow("Not a PNG");
  });

  it("inflates gzip and refuses output beyond the declared size", async () => {
    const payload = Uint8Array.from({ length: 1000 }, (_, index) => index % 251);
    const compressed = new Uint8Array(gzipSync(payload));
    expect(Array.from(await inflate(compressed, "gzip", 1000))).toEqual(Array.from(payload));
    await expect(inflate(compressed, "gzip", 999)).rejects.toThrow("declared size");
  });

  it("reads base64", () => {
    expect(Array.from(base64Bytes("AAEC/w=="))).toEqual([0, 1, 2, 255]);
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/relight-png.test.ts`
Expected: FAIL — cannot find module `../relight-png.js`.

- [ ] **Step 4: Implement** — create `packages/web/src/lib/relight/relight-png.ts`:

```ts
/** An 8-bit image: greyscale (a window stencil) or RGBA (a floor light map). */
export interface Image8 {
  readonly width: number;
  readonly height: number;
  readonly channels: 1 | 4;
  readonly data: Uint8Array;
}

/** Streams bytes through DecompressionStream, refusing output beyond maxBytes (a decompression bomb). */
export async function inflate(bytes: Uint8Array, format: "gzip" | "deflate", maxBytes: number): Promise<Uint8Array> {
  let offset = 0;
  const input = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      const end = Math.min(offset + 65_536, bytes.length);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    },
  });
  const reader = input.pipeThrough(new DecompressionStream(format)).getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) throw new Error("A relight file inflates beyond its declared size.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const out = new Uint8Array(length);
  let written = 0;
  for (const chunk of chunks) { out.set(chunk, written); written += chunk.byteLength; }
  return out;
}

export function base64Bytes(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function readUint32(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset] ?? 0) << 24) | ((bytes[offset + 1] ?? 0) << 16) | ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0)) >>> 0;
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left), toUp = Math.abs(estimate - up), toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) return left;
  return toUp <= toUpLeft ? up : upLeft;
}

/**
 * An 8-bit, non-interlaced greyscale or RGBA PNG: the only kinds the relight package writes.
 * Chunk CRCs are not checked; the whole file's SHA-256 already is.
 */
export async function decodePng(bytes: Uint8Array): Promise<Image8> {
  if (bytes.length < 8 || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) throw new Error("Not a PNG file.");
  let offset = 8, width = 0, height = 0, depth = 0, colourType = -1, interlace = 0;
  const imageData: Uint8Array[] = [];
  while (offset + 8 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = readUint32(data, 0);
      height = readUint32(data, 4);
      depth = data[8] ?? 0;
      colourType = data[9] ?? -1;
      interlace = data[12] ?? 0;
    } else if (type === "IDAT") imageData.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  if (depth !== 8 || interlace !== 0 || (colourType !== 0 && colourType !== 6) || width < 1 || height < 1 || width > 8192 || height > 8192) {
    throw new Error("Only 8-bit, non-interlaced greyscale or RGBA PNGs are read.");
  }
  const channels = colourType === 0 ? 1 : 4;
  const stride = width * channels;
  const joined = new Uint8Array(imageData.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of imageData) { joined.set(part, at); at += part.length; }
  const raw = await inflate(joined, "deflate", (stride + 1) * height);
  if (raw.length !== (stride + 1) * height) throw new Error("The PNG image data is truncated.");
  const out = new Uint8Array(stride * height);
  for (let row = 0; row < height; row += 1) {
    const filter = raw[row * (stride + 1)] ?? 0;
    const source = row * (stride + 1) + 1, target = row * stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? out[target + x - channels] ?? 0 : 0;
      const up = row > 0 ? out[target - stride + x] ?? 0 : 0;
      const upLeft = row > 0 && x >= channels ? out[target - stride + x - channels] ?? 0 : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) predictor = paeth(left, up, upLeft);
      else if (filter !== 0) throw new Error(`Unknown PNG filter ${String(filter)}.`);
      out[target + x] = ((raw[source + x] ?? 0) + predictor) & 0xff;
    }
  }
  return { width, height, channels, data: out };
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/relight-png.test.ts`
Expected: PASS, 6 tests.

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/relight-manifest.test.ts`
Expected: PASS, 13 tests (the helper change keeps the package byte-identical).

- [ ] **Step 6: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/relight/relight-png.ts packages/web/src/lib/relight/__tests__/relight-png.test.ts packages/web/src/lib/relight/__tests__/relight-test-package.ts && git diff --cached --stat && git commit -m "feat(relight): gunzip with a size bound, and the package's PNGs decoded (T-639 R1b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The CPU reference multiplier, driven by R1a's test vectors

**Files:**
- Create: `packages/web/src/lib/relight/relight-kernel.ts`
- Create: `packages/web/src/lib/relight/relight-vectors.ts`
- Test: `packages/web/src/lib/relight/__tests__/relight-kernel.test.ts` (reads `packages/web/src/lib/relight/__fixtures__/relight-vectors.json`, committed by R1a Task 5)

**Interfaces:**
- Consumes: Task 1 (codec), Task 2 (`ProofScenarioSchema`), Task 3 (`decodePng`, `base64Bytes`).
- Produces (`relight-kernel.ts`): `type Rgb = Vec3`; `LUMINANCE`; `LAMP_GROUPS`, `type LampGroup`, `type LampLevels`; `PROBE_VALUES = 162`; `PROBE_FOLDED = 18`; `interface StencilImage`, `StencilPlane`, `WindowPlanes`, `ProbeField`, `KernelSite { north; east; up }`, `RelightKernelModel` (with `horizons: readonly (readonly number[])[]` and `site: KernelSite`), `RelightSetting` (with `emitterBoost: number`), `KernelFrame` (with `windowOpen`, the horizon gates), `SplatMultiplier`; `smoothstep(low, high, x): number`; `capturedSetting(model: Pick<RelightKernelModel, "captureWeights" | "daylightColour">): RelightSetting` (emitter boost 1); `sunElevationDegrees(sun: Vec3, site: KernelSite): number`; `sunAzimuthIndex(sun: Vec3, site: KernelSite): number`; `horizonGates(model: Pick<RelightKernelModel, "windows" | "horizons" | "site">, sun: Vec3 | null): number[]`; `fresnelAt(fresnel: ArrayLike<number>, sun: Vec3): number`; `stencilSample(plane: StencilPlane, point: Vec3): number`; `windowVisibility(planes: WindowPlanes, point: Vec3, sun: Vec3): number`; `sunlitGlassArea(windows: readonly WindowPlanes[], sun: Vec3): number[]`; `sunBounceWeights(area: readonly number[], skyFlux: readonly number[], beta: number): number[]`; `foldProbeCube(cube: ArrayLike<number>, weights: readonly Rgb[], sunRgb: Rgb, bounce: readonly number[], out: Float64Array): void`; `trilinearCorners(field: ProbeField, position: Vec3): { readonly indices: number[]; readonly weights: number[] }`; `cubeEval(cube: ArrayLike<number>, normal: Vec3, iso: boolean): Rgb`; `prepareKernelFrame(model: RelightKernelModel, setting: RelightSetting): KernelFrame` (computes the horizon gates itself); `relightSplat(model: RelightKernelModel, frame: KernelFrame, record: Uint8Array, position: Vec3, colour: Rgb): SplatMultiplier`.
- Produces (`relight-vectors.ts`): `RELIGHT_VECTOR_SETTINGS = ["captured", "night", "sunny_morning"]`, `type RelightVectorSetting`, `isRelightVectorSetting(name: string): name is RelightVectorSetting`, `RelightVectorsSchema`, `type RelightVectors`, `settingFromVectors(value: RelightVectors["settings"][RelightVectorSetting]): RelightSetting`, `kernelModelFromVectors(vectors: RelightVectors): Promise<RelightKernelModel>`.

The folded formulation: bounce light is linear in the sources, so `Σk w[k]·I[k]` equals the ambient-cube evaluation of `Σk w[k]·probes[k]` trilinearly interpolated. The kernel folds each probe's nine source cubes by the capture weighting and by the scenario weighting (with the sun's bounce `sunRgb·b[w]` added to the window sources) and evaluates two 18-value cubes per splat; the GPU pass (Task 11) reads the same two folded volumes. The test vectors, written by `reference.py`'s per-source formulation, prove the two agree.

R1a's two amendments are here too. Lit bulbs brighten by the setting's emitter boost β, `Mlit = 1 + (β − 1) smoothstep(0.45, 0.9, L)`, with β = 1 at the captured light, so the captured light is exactly neutral, bulbs included. Each window's horizon gate is reference.py's test: open while `asin(σ·up)` in degrees is strictly greater than the window's horizon at `round((atan2(σ·east, σ·north) in degrees) mod 360) mod 360`, rounding halves to even. It gates both the direct sun and the sun-bounce glass area. `prepareKernelFrame` computes the five gates once per setting and the GPU pass (Task 11) and the floor (Task 14) read those same values.

- [ ] **Step 1: Write the failing test** — create `packages/web/src/lib/relight/__tests__/relight-kernel.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CLASS_CH_EMITTER, CLASS_HIDDEN, CLASS_MASK, FLAG_SUN, multiplierCodeDistance, packMultiplierWord, recordFromHex } from "../relight-codec.js";
import {
  capturedSetting, fresnelAt, horizonGates, prepareKernelFrame, relightSplat, sunAzimuthIndex, windowVisibility,
  type ProbeField, type RelightKernelModel, type RelightSetting, type StencilPlane, type WindowPlanes,
} from "../relight-kernel.js";
import { RELIGHT_VECTOR_SETTINGS, RelightVectorsSchema, kernelModelFromVectors, settingFromVectors } from "../relight-vectors.js";

// Synthetic cases mirror tools/relight/tests/test_reference.py (R1a Task 5).
const RANGE: [number, number] = [-127, 0]; // code 255 decodes to 1 and code 253 to 0.5, exactly
/** North +y, east +x, up +z (north × east = −up, as the manifest's site frame). */
const SITE = { north: [0, 1, 0], east: [1, 0, 0], up: [0, 0, 1] } as const;
/** `horizon` is every window's horizon elevation at every azimuth. */
function syntheticModel(windows: readonly WindowPlanes[] = [], horizon = 0): RelightKernelModel {
  const cube = new Float32Array(162);
  for (let value = 0; value < 18; value += 1) cube[5 * 18 + value] = 0.1; // the cove bounces 0.1 everywhere
  const probes: ProbeField = { origin: [0, 0, 0], spacing: 1, shape: [2, 2, 2], valid: () => true, cube: () => cube };
  return {
    ranges: Array.from({ length: 9 }, () => RANGE),
    captureWeights: [1, 1, 1, 1, 1, 0.5, 0.5, 0.5, 0.5].map((weight) => [weight, weight, weight] as const),
    daylightColour: [1, 1, 1],
    probes, windows, fresnel: Array.from({ length: 101 }, () => 0.9), sunBeta: 0.5, skyFlux: [1, 1, 1, 1, 1],
    horizons: windows.map(() => Array.from({ length: 360 }, () => horizon)), site: SITE,
  };
}
/** W1 at 1 and the cove at 0.5, normal +z (bytes 128, 128), then the flags. */
const record = (flags: number): Uint8Array => Uint8Array.from([255, 0, 0, 0, 0, 253, 0, 0, 0, 128, 128, flags]);
const CENTRE: [number, number, number] = [0.5, 0.5, 0.5];
const GREY: [number, number, number] = [0.4, 0.4, 0.4];
const withoutSky = (setting: RelightSetting): RelightSetting => ({
  ...setting, skyLevel: 0, weights: setting.weights.map((weight, k) => (k < 5 ? [0, 0, 0] as const : weight)),
});

describe("the reference multiplier on synthetic splats (T-639 R1b)", () => {
  it("is exactly one at the captured light", () => {
    const model = syntheticModel();
    const { m, alpha } = relightSplat(model, prepareKernelFrame(model, capturedSetting(model)), record(0), CENTRE, GREY);
    expect(m).toEqual([1, 1, 1]);
    expect(alpha).toBe(1);
  });

  it("keeps only the lamp light at night: 0.3 of the captured 1.3", () => {
    const model = syntheticModel();
    const { m } = relightSplat(model, prepareKernelFrame(model, withoutSky(capturedSetting(model))), record(0), CENTRE, GREY);
    for (const value of m) expect(value).toBeCloseTo(0.3 / 1.3, 12);
  });

  it("clamps at 8", () => {
    const model = syntheticModel();
    const bright: RelightSetting = { ...capturedSetting(model), weights: model.captureWeights.map((weight, k) => (k < 5 ? [100, 100, 100] as const : weight)) };
    expect(relightSplat(model, prepareKernelFrame(model, bright), record(0), CENTRE, GREY).m).toEqual([8, 8, 8]);
  });

  it("hides the hidden class", () => {
    const model = syntheticModel();
    expect(relightSplat(model, prepareKernelFrame(model, capturedSetting(model)), record(CLASS_HIDDEN), CENTRE, GREY).alpha).toBe(0);
  });

  it("keeps lit bulbs neutral at the captured light, brightens them by the emitter boost, leaves unlit bulbs reflecting", () => {
    const model = syntheticModel();
    const white: [number, number, number] = [0.95, 0.95, 0.95];
    expect(relightSplat(model, prepareKernelFrame(model, capturedSetting(model)), record(CLASS_CH_EMITTER), CENTRE, white).m).toEqual([1, 1, 1]);
    const boosted = relightSplat(model, prepareKernelFrame(model, { ...capturedSetting(model), emitterBoost: 4 }), record(CLASS_CH_EMITTER), CENTRE, white);
    for (const value of boosted.m) expect(value).toBeCloseTo(4, 12);
    const lampsOff: RelightSetting = { ...capturedSetting(model), lampLevels: { cove: 0, ch_end: 0, ch_centre: 0, dome: 0 } };
    const off = relightSplat(model, prepareKernelFrame(model, lampsOff), record(CLASS_CH_EMITTER), CENTRE, white);
    for (const value of off.m) expect(value).toBeLessThan(1);
  });
});

/** A 2 m × 3 m opening in the plane y, from z = 3 down, fully open; its normal points out of the room (−y). */
function opening(y: number): StencilPlane {
  return {
    origin: [0, y, 3], u: [1, 0, 0], v: [0, 0, -1], width: 2, height: 3, normal: [0, -1, 0],
    stencil: { width: 20, height: 30, data: new Uint8Array(600).fill(255) },
  };
}
/** Toward the sun at an elevation and azimuth (degrees) in SITE's frame. */
function toward(elevation: number, azimuth: number): [number, number, number] {
  const el = elevation * Math.PI / 180, az = azimuth * Math.PI / 180;
  return [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)];
}

describe("each window's horizon (T-639 R1b)", () => {
  it("opens a window only while the sun stands strictly above its horizon", () => {
    const sun = toward(30, 200);
    const elevation = Math.asin(sun[2]) * 180 / Math.PI;
    const window = { inner: opening(0), glass: opening(-0.5) };
    expect(horizonGates(syntheticModel([window], elevation - 1e-9), sun)).toEqual([1]);
    expect(horizonGates(syntheticModel([window], elevation), sun)).toEqual([0]);
    expect(horizonGates(syntheticModel([window], 89), null)).toEqual([1]);
  });

  it("reads the horizon at the sun's azimuth rounded to a whole degree, modulo 360", () => {
    const index = (azimuth: number): number => sunAzimuthIndex(toward(10, azimuth), SITE);
    expect([index(0.4), index(359.6), index(-0.6), index(98.944851)]).toEqual([0, 0, 359, 99]);
  });

  it("gates both the direct sun and its bounce through the window", () => {
    const windows = [{ inner: opening(0), glass: opening(-0.5) }];
    const setting: RelightSetting = { ...capturedSetting(syntheticModel()), sunDir: [0, -0.6, 0.8], sunRgb: [2, 2, 2] };
    const open = syntheticModel(windows, 0), closed = syntheticModel(windows, 80);
    const openFrame = prepareKernelFrame(open, setting), closedFrame = prepareKernelFrame(closed, setting);
    expect([openFrame.windowOpen, closedFrame.windowOpen]).toEqual([[1], [0]]);
    expect(openFrame.bounceWeights[0]).toBeGreaterThan(0);
    expect(closedFrame.bounceWeights[0]).toBe(0);
    // through both planes (x = 1; z 1.83 m at the room side, 2.5 m at the glass)
    expect(relightSplat(open, openFrame, record(FLAG_SUN), [1, 1, 0.5], GREY).m[0]).toBeGreaterThan(1);
    expect(relightSplat(closed, closedFrame, record(FLAG_SUN), [1, 1, 0.5], GREY).m).toEqual([1, 1, 1]);
  });
});

/** A 2 m × 2 m opening in the plane y, from z = 3 down, stencil bytes all `value`. */
function plane(y: number, value = 255): StencilPlane {
  return {
    origin: [0, y, 3], u: [1, 0, 0], v: [0, 0, -1], width: 2, height: 2, normal: [0, -1, 0],
    stencil: { width: 20, height: 20, data: new Uint8Array(400).fill(value) },
  };
}

describe("two-plane window visibility (T-639 R1b)", () => {
  it("lights a ray through both openings", () => {
    expect(windowVisibility({ inner: plane(0), glass: plane(-0.5) }, [1, 3, 2], [0, -1, 0])).toBe(1);
  });

  it("darkens a ray that misses the glass opening", () => {
    // crosses the room-side plane at x = 0.2 (inside) and the glass plane at x = −0.47 (outside)
    expect(windowVisibility({ inner: plane(0), glass: plane(-0.5) }, [2.2, 1.5, 2], [-0.8, -0.6, 0])).toBe(0);
  });

  it("multiplies the two stencils", () => {
    expect(windowVisibility({ inner: plane(0, 128), glass: plane(-0.5, 128) }, [1, 3, 2], [0, -1, 0])).toBeCloseTo((128 / 255) ** 2, 12);
  });

  it("darkens a sun behind the wall", () => {
    expect(windowVisibility({ inner: plane(0), glass: plane(-0.5) }, [1, 3, 2], [0, 1, 0])).toBe(0);
  });

  it("reads the glass transmission at |σ · (0, −1, 0)|, halves to even", () => {
    const table = Array.from({ length: 101 }, (_, index) => index);
    expect(fresnelAt(table, [0, -0.125, 0.99])).toBe(12);
    expect(fresnelAt(table, [0, 0.9, 0.1])).toBe(90);
  });
});

const vectors = RelightVectorsSchema.parse(JSON.parse(readFileSync(new URL("../__fixtures__/relight-vectors.json", import.meta.url), "utf8")));

describe("the reference multiplier against R1a's test vectors (T-639 R1b)", () => {
  it("covers every rule: interior, embrasure, hidden, lamps, fixtures or cove, and the sun", () => {
    const flags = vectors.splats.map((splat) => recordFromHex(splat.record)[11] ?? 0);
    const classes = new Set(flags.map((value) => value & CLASS_MASK));
    for (const cls of [0, 1, 2]) expect(classes.has(cls)).toBe(true);
    expect([3, 4].some((cls) => classes.has(cls))).toBe(true);
    expect([5, 6].some((cls) => classes.has(cls))).toBe(true);
    expect(flags.some((value) => (value & FLAG_SUN) !== 0)).toBe(true);
  });

  it.each(RELIGHT_VECTOR_SETTINGS)("reproduces every splat's multiplier, alpha and word for the %s setting", async (name) => {
    const model = await kernelModelFromVectors(vectors);
    const frame = prepareKernelFrame(model, settingFromVectors(vectors.settings[name]));
    vectors.splats.forEach((splat, index) => {
      const expected = splat.expected[name];
      const { m, alpha } = relightSplat(model, frame, recordFromHex(splat.record), splat.position, splat.colour);
      m.forEach((value, channel) => {
        const reference = expected.m[channel] ?? Number.NaN;
        expect(Math.abs(value - reference), `splat ${String(index)} channel ${String(channel)}`).toBeLessThanOrEqual(1e-6 * Math.max(1, Math.abs(reference)));
      });
      expect(alpha, `splat ${String(index)} alpha`).toBe(expected.alpha);
      const word = packMultiplierWord(m, alpha);
      expect(multiplierCodeDistance(word, expected.word), `splat ${String(index)} word`).toBeLessThanOrEqual(1);
      expect(word >>> 24, `splat ${String(index)} alpha byte`).toBe(expected.word >>> 24);
    });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/relight-kernel.test.ts`
Expected: FAIL — cannot find module `../relight-kernel.js`.

- [ ] **Step 3: Implement the kernel** — create `packages/web/src/lib/relight/relight-kernel.ts`:

```ts
import {
  CLASS_CH_EMITTER, CLASS_CH_FIXTURE, CLASS_COVE, CLASS_DOME_EMITTER, CLASS_EMBRASURE, CLASS_HIDDEN, CLASS_MASK,
  FLAG_CH_CENTRE, FLAG_ISO, FLAG_SUN, RECORD_BYTES, SOURCE_COUNT, WINDOW_COUNT,
  decodeLog, decodeOctahedral, roundHalfEven, type Vec3,
} from "./relight-codec.js";

/**
 * The relight multiplier on the CPU (T-639 R1b): the R1a plan's section "The
 * multiplier" (tools/relight/relight/reference.py) and the twin of the GPU pass in
 * relight-draw.ts. Both fold the per-source bounce light into one capture and one
 * scenario volume (bounce light is linear in the sources). The emitter boost is a
 * setting, and each window's horizon gate is reference.py's test, computed here
 * once per setting; the GPU reads the same gates.
 */

export type Rgb = Vec3;
export const LUMINANCE: Rgb = [0.2126, 0.7152, 0.0722];
export const LAMP_GROUPS = ["cove", "ch_end", "ch_centre", "dome"] as const;
export type LampGroup = (typeof LAMP_GROUPS)[number];
export type LampLevels = Readonly<Record<LampGroup, number>>;
/** Floats per probe: [source 0..8][channel r, g, b][face +x, −x, +y, −y, +z, −z]. */
export const PROBE_VALUES = SOURCE_COUNT * 18;
/** Floats per probe once its sources are folded by a weighting: [channel][face]. */
export const PROBE_FOLDED = 18;

export interface StencilImage { readonly width: number; readonly height: number; readonly data: Uint8Array }
export interface StencilPlane {
  readonly origin: Vec3;
  readonly u: Vec3;
  readonly v: Vec3;
  readonly width: number;
  readonly height: number;
  readonly normal: Vec3;
  /** Transmittance bytes (× 1/255), row 0 at the top of the opening. */
  readonly stencil: StencilImage;
}
export interface WindowPlanes { readonly inner: StencilPlane; readonly glass: StencilPlane }
export interface ProbeField {
  readonly origin: Vec3;
  readonly spacing: number;
  readonly shape: readonly [number, number, number];
  valid(index: number): boolean;
  /** PROBE_VALUES floats of one probe. */
  cube(index: number): ArrayLike<number>;
}
/** The site's compass in the model frame (the manifest's `site`). */
export interface KernelSite { readonly north: Vec3; readonly east: Vec3; readonly up: Vec3 }
export interface RelightKernelModel {
  readonly ranges: readonly (readonly [number, number])[];
  /** w[k] × c[k]: each source's fitted capture weight times its colour. */
  readonly captureWeights: readonly Rgb[];
  /** The capture's daylight colour, c[W1]. */
  readonly daylightColour: Rgb;
  readonly probes: ProbeField;
  readonly windows: readonly WindowPlanes[];
  /** Per window, 360 horizon elevations (degrees) by whole azimuth degree. */
  readonly horizons: readonly (readonly number[])[];
  readonly site: KernelSite;
  readonly fresnel: ArrayLike<number>;
  readonly sunBeta: number;
  readonly skyFlux: readonly number[];
}
export interface RelightSetting {
  /** s[k]: each source's weight times its colour. */
  readonly weights: readonly Rgb[];
  readonly skyLevel: number;
  readonly skyColour: Rgb;
  readonly lampLevels: LampLevels;
  /** β: lit bulbs brighten by Mlit = 1 + (β − 1) smoothstep(0.45, 0.9, L); 1 at the captured light. */
  readonly emitterBoost: number;
  /** Toward the sun in the model frame; null when the setting has no sun. */
  readonly sunDir: Vec3 | null;
  readonly sunRgb: Rgb;
}
export interface KernelFrame {
  readonly setting: RelightSetting;
  /** Each window's horizon gate for this setting's sun: 1 open, 0 closed. */
  readonly windowOpen: readonly number[];
  readonly sunOn: boolean;
  readonly fresnelAtSun: number;
  /** b[w] × windowOpen[w]: the sun's bounce through each window. */
  readonly bounceWeights: readonly number[];
  readonly rBack: Rgb;
  capCube(index: number): Float64Array;
  scenarioCube(index: number): Float64Array;
}
export interface SplatMultiplier { readonly m: Rgb; readonly alpha: number }

const NO_BOUNCE: readonly number[] = [0, 0, 0, 0, 0];
const at = (values: ArrayLike<number>, index: number): number => values[index] ?? 0;
const channel = (value: Vec3, index: number): number => value[index] ?? 0;
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function smoothstep(low: number, high: number, x: number): number {
  const t = Math.min(Math.max((x - low) / (high - low), 0), 1);
  return t * t * (3 - 2 * t);
}

/** Setting.captured of reference.py: the capture's own light, bulbs unboosted. */
export function capturedSetting(model: Pick<RelightKernelModel, "captureWeights" | "daylightColour">): RelightSetting {
  return {
    weights: model.captureWeights,
    skyLevel: 1,
    skyColour: model.daylightColour,
    lampLevels: { cove: 1, ch_end: 1, ch_centre: 1, dome: 1 },
    emitterBoost: 1,
    sunDir: null,
    sunRgb: [0, 0, 0],
  };
}

/** Python's %: the result takes the divisor's sign. */
const floorMod = (value: number, modulus: number): number => ((value % modulus) + modulus) % modulus;

/** The sun's elevation, asin(σ·up), in degrees. */
export function sunElevationDegrees(sun: Vec3, site: KernelSite): number {
  return Math.asin(Math.min(1, Math.max(-1, dot(sun, site.up)))) * 180 / Math.PI;
}

/** The horizon table's index: round((atan2(σ·east, σ·north) in degrees) mod 360) mod 360, halves to even. */
export function sunAzimuthIndex(sun: Vec3, site: KernelSite): number {
  const azimuth = Math.atan2(dot(sun, site.east), dot(sun, site.north)) * 180 / Math.PI;
  return floorMod(roundHalfEven(floorMod(azimuth, 360)), 360);
}

/** reference.py's horizon test: 1 while the sun stands strictly above a window's horizon, else 0; all open without a sun. */
export function horizonGates(model: Pick<RelightKernelModel, "windows" | "horizons" | "site">, sun: Vec3 | null): number[] {
  if (sun === null) return model.windows.map(() => 1);
  const elevation = sunElevationDegrees(sun, model.site), index = sunAzimuthIndex(sun, model.site);
  return model.windows.map((_planes, w) => (elevation > (model.horizons[w]?.[index] ?? 90) ? 1 : 0));
}

/** The glass's transmission for the sun: the table at |σ · (0, −1, 0)|, 0.00..1.00. */
export function fresnelAt(fresnel: ArrayLike<number>, sun: Vec3): number {
  return at(fresnel, roundHalfEven(Math.min(Math.abs(sun[1]), 1) * 100));
}

/** A stencil's transmittance at a point on its plane, nearest cell (windows._sample). */
export function stencilSample(plane: StencilPlane, point: Vec3): number {
  const d: Vec3 = [point[0] - plane.origin[0], point[1] - plane.origin[1], point[2] - plane.origin[2]];
  const a = dot(d, plane.u), b = dot(d, plane.v);
  if (!(a >= 0 && a <= plane.width && b >= 0 && b <= plane.height)) return 0;
  const { width, height, data } = plane.stencil;
  const column = Math.min(Math.max(roundHalfEven(a / plane.width * (width - 1)), 0), width - 1);
  const row = Math.min(Math.max(roundHalfEven(b / plane.height * (height - 1)), 0), height - 1);
  return at(data, row * width + column) / 255;
}

/** Transmittance of the ray point + t·sun (t > 0) through both planes of one window (windows.visibility). */
export function windowVisibility(planes: WindowPlanes, point: Vec3, sun: Vec3): number {
  let transmittance = 1;
  for (const plane of [planes.inner, planes.glass]) {
    const denominator = dot(sun, plane.normal);
    if (denominator <= 1e-6) return 0;
    const t = dot([plane.origin[0] - point[0], plane.origin[1] - point[1], plane.origin[2] - point[2]], plane.normal) / denominator;
    if (!(t > 0)) return 0;
    transmittance *= stencilSample(plane, [point[0] + t * sun[0], point[1] + t * sun[1], point[2] + t * sun[2]]);
  }
  return transmittance;
}

/** Each window's glass area lit through both stencils, times the cosine to the wall (reference.sunlit_glass_area). */
export function sunlitGlassArea(windows: readonly WindowPlanes[], sun: Vec3): number[] {
  return windows.map((planes) => {
    const { inner, glass } = planes;
    const rows = glass.stencil.height, columns = glass.stencil.width;
    const cell = (inner.width / columns) * (inner.height / rows);
    let lit = 0;
    for (let row = 0; row < rows; row += 1) {
      const b = (row + 0.5) / rows * inner.height;
      for (let column = 0; column < columns; column += 1) {
        const a = (column + 0.5) / columns * inner.width;
        lit += windowVisibility(planes, [
          inner.origin[0] + a * inner.u[0] + b * inner.v[0] - 0.01 * inner.normal[0],
          inner.origin[1] + a * inner.u[1] + b * inner.v[1] - 0.01 * inner.normal[1],
          inner.origin[2] + a * inner.u[2] + b * inner.v[2] - 0.01 * inner.normal[2],
        ], sun);
      }
    }
    return lit * cell * Math.max(dot(sun, inner.normal), 0);
  });
}

export function sunBounceWeights(area: readonly number[], skyFlux: readonly number[], beta: number): number[] {
  return area.map((value, w) => beta * value / Math.max(skyFlux[w] ?? 0, 1e-9));
}

/** One probe's cube folded by a weighting: out[c·6 + f] = Σk (weights[k][c] + [k < 5]·sunRgb[c]·bounce[k]) · cube[k][c][f]. */
export function foldProbeCube(cube: ArrayLike<number>, weights: readonly Rgb[], sunRgb: Rgb, bounce: readonly number[], out: Float64Array): void {
  out.fill(0);
  for (let k = 0; k < SOURCE_COUNT; k += 1) {
    const weight = weights[k];
    if (weight === undefined) continue;
    for (let c = 0; c < 3; c += 1) {
      const factor = channel(weight, c) + (k < WINDOW_COUNT ? channel(sunRgb, c) * (bounce[k] ?? 0) : 0);
      if (factor === 0) continue;
      for (let f = 0; f < 6; f += 1) out[c * 6 + f] = at(out, c * 6 + f) + factor * at(cube, (k * 3 + c) * 6 + f);
    }
  }
}

/** Trilinear corners over valid probes, weights renormalised (03_bases.trilinear_weights). */
export function trilinearCorners(field: ProbeField, position: Vec3): { readonly indices: number[]; readonly weights: number[] } {
  const [nx, ny, nz] = field.shape;
  const clampAxis = (value: number, size: number): number => Math.min(Math.max(value, 0), size - 1 - 1e-6);
  const qx = clampAxis((position[0] - field.origin[0]) / field.spacing, nx);
  const qy = clampAxis((position[1] - field.origin[1]) / field.spacing, ny);
  const qz = clampAxis((position[2] - field.origin[2]) / field.spacing, nz);
  const ix = Math.floor(qx), iy = Math.floor(qy), iz = Math.floor(qz);
  const fx = qx - ix, fy = qy - iy, fz = qz - iz;
  const indices: number[] = [], raw: number[] = [];
  for (const dx of [0, 1]) {
    for (const dy of [0, 1]) {
      for (const dz of [0, 1]) {
        const index = (Math.min(ix + dx, nx - 1) * ny + Math.min(iy + dy, ny - 1)) * nz + Math.min(iz + dz, nz - 1);
        const weight = (dx === 1 ? fx : 1 - fx) * (dy === 1 ? fy : 1 - fy) * (dz === 1 ? fz : 1 - fz);
        indices.push(index);
        raw.push(field.valid(index) ? weight : 0);
      }
    }
  }
  const sum = raw.reduce((total, value) => total + value, 0);
  return { indices, weights: raw.map((value) => (sum > 0 ? value / Math.max(sum, 1e-12) : 0)) };
}

/** An 18-value cube at a normal: Σ n+² cube[+axis] + n−² cube[−axis], or the mean of the six faces for isotropic receivers. */
export function cubeEval(cube: ArrayLike<number>, normal: Vec3, iso: boolean): Rgb {
  const [x, y, z] = normal;
  const faces = [Math.max(x, 0) ** 2, Math.max(-x, 0) ** 2, Math.max(y, 0) ** 2, Math.max(-y, 0) ** 2, Math.max(z, 0) ** 2, Math.max(-z, 0) ** 2];
  const evaluate = (c: number): number => {
    let weighted = 0, total = 0;
    for (let f = 0; f < 6; f += 1) {
      const value = at(cube, c * 6 + f);
      weighted += value * (faces[f] ?? 0);
      total += value;
    }
    return iso ? total / 6 : weighted;
  };
  return [evaluate(0), evaluate(1), evaluate(2)];
}

/** What a setting fixes for every splat: the sun's gates, Fresnel and bounce, and the folded probe cubes (memoised). */
export function prepareKernelFrame(model: RelightKernelModel, setting: RelightSetting): KernelFrame {
  const sun = setting.sunDir;
  const windowOpen = horizonGates(model, sun);
  const sunOn = sun !== null && model.windows.length > 0;
  const fresnelAtSun = sun !== null && sunOn ? fresnelAt(model.fresnel, sun) : 0;
  const area = sun !== null && sunOn ? sunlitGlassArea(model.windows, sun) : model.windows.map(() => 0);
  const bounceWeights = sunBounceWeights(area.map((value) => value * fresnelAtSun), model.skyFlux, model.sunBeta)
    .map((value, w) => value * (windowOpen[w] ?? 0));
  const rBack: Rgb = [
    setting.skyLevel * setting.skyColour[0] / Math.max(model.daylightColour[0], 1e-6),
    setting.skyLevel * setting.skyColour[1] / Math.max(model.daylightColour[1], 1e-6),
    setting.skyLevel * setting.skyColour[2] / Math.max(model.daylightColour[2], 1e-6),
  ];
  const captureCubes = new Map<number, Float64Array>();
  const scenarioCubes = new Map<number, Float64Array>();
  const noSun: Rgb = [0, 0, 0];
  return {
    setting, windowOpen, sunOn, fresnelAtSun, bounceWeights, rBack,
    capCube: (index) => {
      let cube = captureCubes.get(index);
      if (cube === undefined) {
        cube = new Float64Array(PROBE_FOLDED);
        foldProbeCube(model.probes.cube(index), model.captureWeights, noSun, NO_BOUNCE, cube);
        captureCubes.set(index, cube);
      }
      return cube;
    },
    scenarioCube: (index) => {
      let cube = scenarioCubes.get(index);
      if (cube === undefined) {
        cube = new Float64Array(PROBE_FOLDED);
        foldProbeCube(model.probes.cube(index), setting.weights, setting.sunRgb, sunOn ? bounceWeights : NO_BOUNCE, cube);
        scenarioCubes.set(index, cube);
      }
      return cube;
    },
  };
}

/** One splat's multiplier and alpha (the R1a plan's rules, in order: interior ratio, embrasure, clamp, lamps, hidden). */
export function relightSplat(model: RelightKernelModel, frame: KernelFrame, record: Uint8Array, position: Vec3, colour: Rgb): SplatMultiplier {
  if (record.length < RECORD_BYTES) throw new Error("A relight record has 12 bytes.");
  const flags = at(record, 11);
  const cls = flags & CLASS_MASK;
  const iso = (flags & FLAG_ISO) !== 0;
  const normal = decodeOctahedral(at(record, 9), at(record, 10));
  const { indices, weights } = trilinearCorners(model.probes, position);
  const captureCube = new Float64Array(PROBE_FOLDED), scenarioCube = new Float64Array(PROBE_FOLDED);
  indices.forEach((index, corner) => {
    const weight = weights[corner] ?? 0;
    if (weight === 0) return;
    const capture = frame.capCube(index), scenario = frame.scenarioCube(index);
    for (let value = 0; value < PROBE_FOLDED; value += 1) {
      captureCube[value] = at(captureCube, value) + weight * at(capture, value);
      scenarioCube[value] = at(scenarioCube, value) + weight * at(scenario, value);
    }
  });
  const eCap = [...cubeEval(captureCube, normal, iso)];
  const e = [...cubeEval(scenarioCube, normal, iso)];
  for (let k = 0; k < SOURCE_COUNT; k += 1) {
    const range = model.ranges[k];
    if (range === undefined) throw new Error(`The relight model lacks the range of source ${String(k)}.`);
    const direct = decodeLog(at(record, k), range[0], range[1]);
    if (direct === 0) continue;
    const capture = model.captureWeights[k], scenario = frame.setting.weights[k];
    for (let c = 0; c < 3; c += 1) {
      eCap[c] = at(eCap, c) + (capture === undefined ? 0 : channel(capture, c)) * direct;
      e[c] = at(e, c) + (scenario === undefined ? 0 : channel(scenario, c)) * direct;
    }
  }
  const sun = frame.setting.sunDir;
  if (sun !== null && frame.sunOn && (flags & FLAG_SUN) !== 0) {
    let visibility = 0;
    model.windows.forEach((planes, w) => { visibility += (frame.windowOpen[w] ?? 0) * windowVisibility(planes, position, sun); });
    visibility *= frame.fresnelAtSun;
    const cosine = iso ? 0.25 : Math.max(dot(normal, sun), 0);
    for (let c = 0; c < 3; c += 1) e[c] = at(e, c) + visibility * cosine * channel(frame.setting.sunRgb, c);
  }
  const luminance = dot(colour, LUMINANCE);
  const m = [0, 1, 2].map((c) => at(e, c) / Math.max(at(eCap, c), 1e-4));
  if (cls === CLASS_EMBRASURE) {
    for (let c = 0; c < 3; c += 1) {
      const captured = channel(colour, c), light = at(eCap, c);
      const rho = Math.min(captured / Math.max(light, 1e-4), 0.8);
      const excess = Math.max(captured - rho * light, 0);
      m[c] = (rho * at(e, c) + excess * channel(frame.rBack, c)) / Math.max(captured, 1e-4);
    }
  }
  for (let c = 0; c < 3; c += 1) m[c] = Math.min(Math.max(at(m, c), 1 / 16), 8);
  const bulb = cls === CLASS_CH_EMITTER || cls === CLASS_DOME_EMITTER;
  const cove = cls === CLASS_COVE;
  if (bulb || cove || cls === CLASS_CH_FIXTURE) {
    const group: LampGroup = cls === CLASS_DOME_EMITTER ? "dome" : cove ? "cove" : (flags & FLAG_CH_CENTRE) !== 0 ? "ch_centre" : "ch_end";
    const level = frame.setting.lampLevels[group];
    const litBulb = 1 + (frame.setting.emitterBoost - 1) * smoothstep(0.45, 0.9, luminance);
    for (let c = 0; c < 3; c += 1) {
      const captured = channel(colour, c);
      const lit = bulb ? litBulb : cove ? 1 : at(m, c);
      const chroma = Math.min(Math.max(captured / Math.max(luminance, 1e-4), 0.5), 2) ** 0.4;
      const albedo = cove ? 0.3 : (cls === CLASS_DOME_EMITTER ? 0.5 : 0.35) * chroma;
      const unlit = albedo * at(e, c) / Math.max(captured, 1e-4);
      m[c] = Math.min(Math.max(level * lit + (1 - level) * unlit, 0), 8);
    }
  }
  return { m: [at(m, 0), at(m, 1), at(m, 2)], alpha: cls === CLASS_HIDDEN ? 0 : 1 };
}
```

- [ ] **Step 4: Implement the vectors' schema** — create `packages/web/src/lib/relight/relight-vectors.ts`:

```ts
import { z } from "zod";
import { decodeHalfFloat } from "./relight-codec.js";
import type { ProbeField, RelightKernelModel, RelightSetting, Rgb, StencilPlane, WindowPlanes } from "./relight-kernel.js";
import { ProofScenarioSchema } from "./relight-manifest.js";
import { base64Bytes, decodePng } from "./relight-png.js";

// R1a's test vectors (contract 1): written by `python -m relight check` from
// reference.py, read here by the kernel's tests and by the DEV browser check.

const finite = z.number().finite();
const vec3 = z.tuple([finite, finite, finite]);
const plane = z.object({
  origin: vec3, u: vec3, v: vec3, width: finite.positive(), height: finite.positive(), normal: vec3,
  stencilSize: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  /** The stencil PNG, base64. */
  stencilPng: z.string().min(1),
});
const setting = z.object({
  weights: z.array(vec3).length(9),
  skyLevel: finite,
  skyColour: vec3,
  lampLevels: z.object({ cove: finite, ch_end: finite, ch_centre: finite, dome: finite }),
  emitterBoost: finite.positive(),
  sunDir: vec3.nullable(),
  sunRgb: vec3,
});
const expectation = z.object({ m: vec3, alpha: finite, word: z.number().int().min(0).max(0xffffffff) });

export const RELIGHT_VECTOR_SETTINGS = ["captured", "night", "sunny_morning"] as const;
export type RelightVectorSetting = (typeof RELIGHT_VECTOR_SETTINGS)[number];

export function isRelightVectorSetting(name: string): name is RelightVectorSetting {
  return RELIGHT_VECTOR_SETTINGS.some((candidate) => candidate === name);
}

export const RelightVectorsSchema = z.object({
  schema: z.literal("venviewer.relight-vectors.v1"),
  sources: z.array(z.string()).length(9),
  encoding: z.object({ sources: z.array(z.tuple([finite, finite])).length(9) }),
  capture: z.object({ weights: z.array(finite).length(9), colours: z.array(vec3).length(9), daylightColour: vec3 }),
  site: z.object({ north: vec3, east: vec3, up: vec3 }),
  sun: z.object({ beta: finite.nonnegative(), skyFlux: z.array(finite.positive()).length(5), fresnel: z.array(finite).length(101) }),
  /** Each window's two planes and its 360 horizon elevations (degrees) by whole azimuth degree. */
  windows: z.array(z.object({ id: z.string(), inner: plane, glass: plane, horizon: z.array(finite.min(-90).max(90)).length(360) })).length(5),
  probes: z.object({
    origin: vec3,
    spacing: finite.positive(),
    shape: z.tuple([z.number().int().positive(), z.number().int().positive(), z.number().int().positive()]),
    /** Every probe the 64 splats' trilinear corners touch; `cube` is 162 float16 values, little-endian, base64. */
    entries: z.array(z.object({ index: z.number().int().nonnegative(), valid: z.boolean(), cube: z.string().min(1) })).min(1),
  }),
  presetsFromProof: z.object({ night: ProofScenarioSchema, sunny_morning: ProofScenarioSchema, overcast_noon: ProofScenarioSchema }),
  settings: z.object({ captured: setting, night: setting, sunny_morning: setting }),
  splats: z.array(z.object({
    record: z.string().regex(/^[0-9a-fA-F]{24}$/u),
    /** Model frame (e57). */
    position: vec3,
    /** The captured linear colour C. */
    colour: vec3,
    expected: z.object({ captured: expectation, night: expectation, sunny_morning: expectation }),
  })).length(64),
});
export type RelightVectors = z.infer<typeof RelightVectorsSchema>;

export function settingFromVectors(value: RelightVectors["settings"][RelightVectorSetting]): RelightSetting {
  return {
    weights: value.weights, skyLevel: value.skyLevel, skyColour: value.skyColour, lampLevels: value.lampLevels,
    emitterBoost: value.emitterBoost, sunDir: value.sunDir, sunRgb: value.sunRgb,
  };
}

function cubeFromBase64(text: string): Float32Array {
  const bytes = base64Bytes(text);
  if (bytes.length !== 162 * 2) throw new Error("A test-vector probe holds 162 float16 values.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Float32Array.from({ length: 162 }, (_, index) => decodeHalfFloat(view.getUint16(index * 2, true)));
}

async function stencilPlane(value: z.infer<typeof plane>): Promise<StencilPlane> {
  const image = await decodePng(base64Bytes(value.stencilPng));
  if (image.channels !== 1 || image.width !== value.stencilSize[0] || image.height !== value.stencilSize[1]) {
    throw new Error("A test-vector stencil does not match its size.");
  }
  return {
    origin: value.origin, u: value.u, v: value.v, width: value.width, height: value.height, normal: value.normal,
    stencil: { width: image.width, height: image.height, data: image.data },
  };
}

/** The kernel's model from the vectors' manifest slice; the sparse probe table refuses any probe it lacks. */
export async function kernelModelFromVectors(vectors: RelightVectors): Promise<RelightKernelModel> {
  const entries = new Map(vectors.probes.entries.map((entry) => [entry.index, entry]));
  const cubes = new Map<number, Float32Array>();
  const entryAt = (index: number): RelightVectors["probes"]["entries"][number] => {
    const entry = entries.get(index);
    if (entry === undefined) throw new Error(`The test vectors lack probe ${String(index)}.`);
    return entry;
  };
  const probes: ProbeField = {
    origin: vectors.probes.origin,
    spacing: vectors.probes.spacing,
    shape: vectors.probes.shape,
    valid: (index) => entryAt(index).valid,
    cube: (index) => {
      const cached = cubes.get(index);
      if (cached !== undefined) return cached;
      const cube = cubeFromBase64(entryAt(index).cube);
      cubes.set(index, cube);
      return cube;
    },
  };
  const windows: WindowPlanes[] = [];
  for (const window of vectors.windows) windows.push({ inner: await stencilPlane(window.inner), glass: await stencilPlane(window.glass) });
  return {
    ranges: vectors.encoding.sources,
    captureWeights: vectors.capture.weights.map((weight, k): Rgb => {
      const colour = vectors.capture.colours[k] ?? [0, 0, 0];
      return [weight * colour[0], weight * colour[1], weight * colour[2]];
    }),
    daylightColour: vectors.capture.daylightColour,
    probes,
    windows,
    horizons: vectors.windows.map((window) => window.horizon),
    site: vectors.site,
    fresnel: vectors.sun.fresnel,
    sunBeta: vectors.sun.beta,
    skyFlux: vectors.sun.skyFlux,
  };
}
```

- [ ] **Step 5: Run the test**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/relight-kernel.test.ts`
Expected: PASS, 17 tests. If `RelightVectorsSchema.parse` throws, the committed vectors do not have contract 1's shape: stop and report the Zod issues to the controller (R1a's `check` command writes the vectors; do not bend this schema to them). If a splat disagrees, report its index, class and the two values.

- [ ] **Step 6: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/relight/relight-kernel.ts packages/web/src/lib/relight/relight-vectors.ts packages/web/src/lib/relight/__tests__/relight-kernel.test.ts && git diff --cached --stat && git commit -m "feat(relight): the reference multiplier in the browser, held to R1a's test vectors (T-639 R1b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Loading the package and a tile's records in a worker

**Files:**
- Create: `packages/web/src/lib/relight/relight-assets.ts`
- Create: `packages/web/src/lib/relight/relight-worker.ts`
- Create: `packages/web/src/lib/relight/relight-worker-client.ts`
- Create: `packages/web/src/lib/relight-package.ts`
- Test: `packages/web/src/lib/relight/__tests__/relight-assets.test.ts`, `packages/web/src/lib/relight/__tests__/relight-assets.staged.test.ts`, `packages/web/src/lib/__tests__/relight-package.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces (`relight-assets.ts`): `PROBE_CAPTURE_STRIDE = 19`; `type FetchLike = (url: string, init: { readonly signal?: AbortSignal }) => Promise<Response>`; `interface StencilAtlas { width; height; data: Uint8Array; rects: Float32Array }`; `interface RelightModelData { manifest: RelightManifest; baseUrl: string; probeCount: number; probes: Uint16Array (binary16 bits, 162 per probe); probeValid: Uint8Array; probeCapture: Float32Array; stencils: readonly Image8[]; atlas: StencilAtlas; floorDirect: Float32Array; floorBounce: Float32Array }` (readonly fields); `RelightWorkerRequestSchema`, `type RelightWorkerRequest`, `type RelightWorkerResult`, `type RelightWorkerResponse`; `sha256Hex(bytes): Promise<string>`; `fetchVerified(fetchFn, url, expected: { sha256: string; bytes: number }, signal?): Promise<Uint8Array>`; `texelCentre(texelToModel: readonly number[], column: number, row: number): Vec3`; `denseProbeField(manifest: RelightManifest, probes: Uint16Array, valid: Uint8Array): ProbeField` (decodes a probe's 162 values when read, a bounded cache); `captureWeightsOf(manifest): Rgb[]`; `packStencilAtlas(stencils: readonly Image8[]): StencilAtlas`; `decodeFloorDirect(maps, ranges, texels): Float32Array`; `floorBounceField(field, texelToModel, width, height): Float32Array`; `loadRelightModelData(fetchFn, manifestUrl, signal?): Promise<RelightModelData>`; `loadRelightRecords(fetchFn, source: RelightTileSource, signal?): Promise<Uint8Array>`; `transferablesOf(data: RelightModelData): ArrayBuffer[]`.
- Produces (`relight-worker-client.ts`): `runRelightWorker(request: RelightWorkerRequest, signal?: AbortSignal): Promise<RelightWorkerResult>`.
- Produces (`relight-package.ts`, the spec's unit): `loadRelightPackage(manifestUrl: string): Promise<RelightModelData | null>` (cached per URL; any failure warns once and resolves null), `loadRelightRecords(source: RelightTileSource, signal: AbortSignal): Promise<Uint8Array>`, `resetRelightPackages(): void` (tests).

Stencils are ordered W1 inner, W1 glass, W2 inner, …, W5 glass (index `2w` and `2w + 1`); the atlas stacks them with one blank row after each, and `rects[4i..4i+3]` is stencil `i`'s `x0, y0, width, height`. `floorDirect` is `[texel][source]`; `floorBounce` is `[texel][source][channel]` at normal +z (the probes' +z face, trilinear over valid probes at each texel centre, contract 4). The probe volume stays as binary16 bits, exactly as the file holds it: R1a's coarse bounce grid (0.5 m over the hall box, about 43 × 22 × 14 ≈ 13,000 probes, about 4 MB), its size read only from the manifest's `probes.shape` (the schema refuses more than 2,000,000 probes). The GPU folds it per light change (Task 10), the CPU decodes only the probes it reads, and the capture fold and the floor's bounce are computed here, in the worker.

- [ ] **Step 1: Write the failing tests**

`packages/web/src/lib/relight/__tests__/relight-assets.test.ts`:

```ts
import { DataUtils } from "three";
import { describe, expect, it } from "vitest";
import { decodeLog } from "../relight-codec.js";
import { PROBE_CAPTURE_STRIDE, loadRelightModelData, loadRelightRecords, packStencilAtlas, texelCentre } from "../relight-assets.js";
import { RelightManifestSchema } from "../relight-manifest.js";
import { TEST_BASE, buildTestPackage, testPng } from "./relight-test-package.js";

const half = (value: number): number => DataUtils.fromHalfFloat(DataUtils.toHalfFloat(value));

describe("relight package decoding (T-639 R1b)", () => {
  it("decodes the probe volume and folds the capture light into it, validity last", async () => {
    const pkg = buildTestPackage();
    const data = await loadRelightModelData(pkg.fetch, pkg.manifestUrl);
    expect(data.probeCount).toBe(8);
    expect(data.probes[0]).toBe(DataUtils.toHalfFloat(0.01));
    expect(data.probes[8 * 18]).toBe(DataUtils.toHalfFloat(0.09));
    // red, +x: windows 1 × white, lamps 0.5 × (1.62, 1, 0.47)
    const red = [0, 1, 2, 3, 4].reduce((sum, k) => sum + half(0.01 * (k + 1)), 0)
      + [5, 6, 7, 8].reduce((sum, k) => sum + 0.5 * 1.62 * half(0.01 * (k + 1)), 0);
    expect(data.probeCapture[0]).toBeCloseTo(red, 6);
    expect(data.probeCapture[PROBE_CAPTURE_STRIDE - 1]).toBe(1);
  });

  it("reads every stencil in window order and packs them into one atlas", async () => {
    const pkg = buildTestPackage();
    const data = await loadRelightModelData(pkg.fetch, pkg.manifestUrl);
    expect(data.stencils).toHaveLength(10);
    expect(data.stencils.every((stencil) => stencil.width === 4 && stencil.height === 3 && stencil.data.every((value) => value === 255))).toBe(true);
    expect([data.atlas.width, data.atlas.height]).toEqual([4, 40]);
    expect(Array.from(data.atlas.rects.slice(4, 8))).toEqual([0, 4, 4, 3]);
  });

  it("decodes the floor's direct light and its bounce at +z on the floor grid", async () => {
    const pkg = buildTestPackage();
    const data = await loadRelightModelData(pkg.fetch, pkg.manifestUrl);
    expect(data.floorDirect).toHaveLength(2 * 2 * 9);
    expect(data.floorDirect[0]).toBe(Math.fround(decodeLog(200, -22, 3)));
    expect(data.floorDirect[5]).toBe(Math.fround(decodeLog(150, -22, 3)));
    expect(data.floorDirect[8]).toBe(Math.fround(decodeLog(100, -22, 3)));
    expect(data.floorBounce).toHaveLength(2 * 2 * 27);
    expect(data.floorBounce[8 * 3 + 1]).toBeCloseTo(half(0.09), 6); // texel 0, dome, green
  });

  it("maps a floor texel's centre through texelToModel", () => {
    expect(texelCentre([0.5, 0, 0, 0.25, 0, 0.5, 0, 0.25, 0, 0, 0, 0.02, 0, 0, 0, 1], 1, 0)).toEqual([0.75, 0.25, 0.02]);
  });

  it("refuses a file that does not match its manifest entry, and a manifest of another kind", async () => {
    const tampered = buildTestPackage();
    tampered.files.set("windows/W1-glass.png", testPng(4, 3, 1, () => 0));
    await expect(loadRelightModelData(tampered.fetch, tampered.manifestUrl)).rejects.toThrow(/SHA-256|bytes/);
    const other = buildTestPackage();
    other.files.set("manifest.json", new TextEncoder().encode(JSON.stringify({ ...other.manifest, schema: "venviewer.floor-skin.v1" })));
    await expect(loadRelightModelData(other.fetch, other.manifestUrl)).rejects.toThrow();
  });

  it("reads a tile's records and refuses a count they do not hold", async () => {
    const pkg = buildTestPackage();
    const entry = RelightManifestSchema.parse(pkg.manifest).tiles[0];
    if (entry === undefined) throw new Error("The test package has one tile.");
    const source = { url: `${TEST_BASE}${entry.file}`, sha256: entry.sha256, bytes: entry.bytes, count: entry.count };
    expect(Array.from(await loadRelightRecords(pkg.fetch, source))).toEqual(Array.from(pkg.records));
    await expect(loadRelightRecords(pkg.fetch, { ...source, count: 4 })).rejects.toThrow("records");
  });

  it("stacks stencils with a blank row after each", () => {
    const one = { width: 2, height: 1, channels: 1 as const, data: Uint8Array.from([1, 2]) };
    const two = { width: 3, height: 2, channels: 1 as const, data: Uint8Array.from([3, 4, 5, 6, 7, 8]) };
    const atlas = packStencilAtlas([one, two]);
    expect([atlas.width, atlas.height]).toEqual([3, 5]);
    expect(Array.from(atlas.data)).toEqual([1, 2, 0, 0, 0, 0, 3, 4, 5, 6, 7, 8, 0, 0, 0]);
    expect(Array.from(atlas.rects)).toEqual([0, 0, 2, 1, 0, 2, 3, 2]);
  });
});
```

`packages/web/src/lib/relight/__tests__/relight-assets.staged.test.ts` (runs only when `RELIGHT_STAGED_PACKAGE` names the staged folder; CI has no D:):

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadRelightModelData } from "../relight-assets.js";

const folder = process.env["RELIGHT_STAGED_PACKAGE"];
const BASE = "https://staged.test/relight/v1/";

describe.runIf(folder !== undefined)("the staged Grand Hall relight package (T-639 R1b)", () => {
  it("validates, verifies every checksum and decodes", async () => {
    const root = folder ?? "";
    const fetchFile = async (url: string): Promise<Response> => {
      const bytes = await readFile(join(root, url.slice(BASE.length)));
      return new Response(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    };
    const data = await loadRelightModelData(fetchFile, `${BASE}manifest.json`);
    expect(data.manifest.tiles.reduce((sum, tile) => sum + tile.count, 0)).toBe(11_487_038);
    expect(data.stencils).toHaveLength(10);
    expect(data.floorDirect.length).toBe(data.manifest.floor.size[0] * data.manifest.floor.size[1] * 9);
  }, 120_000);
});
```

`packages/web/src/lib/__tests__/relight-package.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

const worker = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("../relight/relight-worker-client.js", () => ({ runRelightWorker: worker.run }));

import { loadRelightPackage, loadRelightRecords, resetRelightPackages } from "../relight-package.js";
import { resetRelightWarnings } from "../relight/relight-warning.js";

afterEach(() => { resetRelightPackages(); resetRelightWarnings(); worker.run.mockReset(); vi.restoreAllMocks(); });

describe("relight package loading (T-639 R1b)", () => {
  it("decodes a package once per URL, in a worker", async () => {
    const data = { decoded: true };
    worker.run.mockResolvedValue({ type: "package", data });
    const first = loadRelightPackage("https://cdn.test/relight/v1/manifest.json");
    expect(loadRelightPackage("https://cdn.test/relight/v1/manifest.json")).toBe(first);
    await expect(first).resolves.toBe(data);
    expect(worker.run).toHaveBeenCalledOnce();
    expect(worker.run).toHaveBeenCalledWith({ type: "package", manifestUrl: "https://cdn.test/relight/v1/manifest.json" });
  });

  it("draws the hall as captured when the package cannot be used: null, and one warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    worker.run.mockRejectedValue(new Error("The relight manifest could not be read (404)."));
    await expect(loadRelightPackage("https://cdn.test/a/manifest.json")).resolves.toBeNull();
    await expect(loadRelightPackage("https://cdn.test/b/manifest.json")).resolves.toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("returns a tile's records from the worker and passes the abort signal", async () => {
    const records = new Uint8Array(12);
    worker.run.mockResolvedValue({ type: "records", records });
    const controller = new AbortController();
    const source = { url: "https://cdn.test/relight/v1/tiles/t.relight.gz", sha256: "a".repeat(64), bytes: 20, count: 1 };
    await expect(loadRelightRecords(source, controller.signal)).resolves.toBe(records);
    expect(worker.run).toHaveBeenCalledWith({ type: "records", source }, controller.signal);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/relight-assets.test.ts`
Expected: FAIL — cannot find module `../relight-assets.js`.

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/relight-package.test.ts`
Expected: FAIL — cannot find module `../relight-package.js`.

- [ ] **Step 3: Implement the decoding** — create `packages/web/src/lib/relight/relight-assets.ts`:

```ts
import { z } from "zod";
import { RECORD_BYTES, SOURCE_COUNT, decodeHalfFloat, decodeLog, type Vec3 } from "./relight-codec.js";
import { PROBE_FOLDED, PROBE_VALUES, foldProbeCube, trilinearCorners, type ProbeField, type Rgb } from "./relight-kernel.js";
import { RelightManifestSchema, type RelightManifest, type RelightTileSource } from "./relight-manifest.js";
import { decodePng, inflate, type Image8 } from "./relight-png.js";

/** Floats per probe in the capture volume the GPU reads: the folded cube, then validity (1 or 0). */
export const PROBE_CAPTURE_STRIDE = PROBE_FOLDED + 1;

export type FetchLike = (url: string, init: { readonly signal?: AbortSignal }) => Promise<Response>;

export interface StencilAtlas {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
  /** Per stencil (W1 inner, W1 glass, …, W5 glass): x0, y0, width, height in texels. */
  readonly rects: Float32Array;
}

/** A decoded, verified package (docs/engineering/relight-package.md), as transferable arrays. */
export interface RelightModelData {
  readonly manifest: RelightManifest;
  readonly baseUrl: string;
  readonly probeCount: number;
  readonly probes: Float32Array;
  readonly probeValid: Uint8Array;
  readonly probeCapture: Float32Array;
  readonly stencils: readonly Image8[];
  readonly atlas: StencilAtlas;
  readonly floorDirect: Float32Array;
  readonly floorBounce: Float32Array;
}

export const RelightWorkerRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("package"), manifestUrl: z.string().url() }),
  z.object({
    type: z.literal("records"),
    source: z.object({
      url: z.string().url(),
      sha256: z.string().regex(/^[0-9a-f]{64}$/u),
      bytes: z.number().int().positive(),
      count: z.number().int().positive(),
    }),
  }),
]);
export type RelightWorkerRequest = z.infer<typeof RelightWorkerRequestSchema>;
export type RelightWorkerResult =
  | { readonly type: "package"; readonly data: RelightModelData }
  | { readonly type: "records"; readonly records: Uint8Array };
export type RelightWorkerResponse = RelightWorkerResult | { readonly type: "error"; readonly message: string };

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("");
}

/** A package file, refused unless its size and SHA-256 are the manifest's. */
export async function fetchVerified(fetchFn: FetchLike, url: string, expected: { readonly sha256: string; readonly bytes: number }, signal?: AbortSignal): Promise<Uint8Array> {
  const response = await fetchFn(url, { signal });
  if (!response.ok) throw new Error(`${url} could not be read (${String(response.status)}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== expected.bytes) throw new Error(`${url} has ${String(bytes.byteLength)} bytes; the manifest says ${String(expected.bytes)}.`);
  if (await sha256Hex(bytes) !== expected.sha256) throw new Error(`${url} does not match its SHA-256.`);
  return bytes;
}

/** The model-frame centre of floor texel (column, row) (contract 4: texelToModel × (column, row, 0, 1)). */
export function texelCentre(texelToModel: readonly number[], column: number, row: number): Vec3 {
  const m = (index: number): number => texelToModel[index] ?? 0;
  return [m(0) * column + m(1) * row + m(3), m(4) * column + m(5) * row + m(7), m(8) * column + m(9) * row + m(11)];
}

/** The probe grid over binary16 bits; a probe's 162 values are decoded when read (bounded cache). */
export function denseProbeField(manifest: RelightManifest, probes: Uint16Array, valid: Uint8Array): ProbeField {
  const decoded = new Map<number, Float32Array>();
  return {
    origin: manifest.probes.origin,
    spacing: manifest.probes.spacing,
    shape: manifest.probes.shape,
    valid: (index) => valid[index] === 1,
    cube: (index) => {
      const cached = decoded.get(index);
      if (cached !== undefined) return cached;
      const cube = new Float32Array(PROBE_VALUES);
      for (let value = 0; value < PROBE_VALUES; value += 1) cube[value] = decodeHalfFloat(probes[index * PROBE_VALUES + value] ?? 0);
      if (decoded.size >= 4096) decoded.clear();
      decoded.set(index, cube);
      return cube;
    },
  };
}

/** w[k] × c[k] for each source. */
export function captureWeightsOf(manifest: RelightManifest): Rgb[] {
  return manifest.capture.weights.map((weight, k): Rgb => {
    const colour = manifest.capture.colours[k] ?? [0, 0, 0];
    return [weight * colour[0], weight * colour[1], weight * colour[2]];
  });
}

export function packStencilAtlas(stencils: readonly Image8[]): StencilAtlas {
  const width = Math.max(1, ...stencils.map((stencil) => stencil.width));
  const height = stencils.reduce((sum, stencil) => sum + stencil.height + 1, 0);
  const data = new Uint8Array(width * height);
  const rects = new Float32Array(stencils.length * 4);
  let top = 0;
  stencils.forEach((stencil, index) => {
    for (let row = 0; row < stencil.height; row += 1) {
      data.set(stencil.data.subarray(row * stencil.width, (row + 1) * stencil.width), (top + row) * width);
    }
    rects.set([0, top, stencil.width, stencil.height], index * 4);
    top += stencil.height + 1;
  });
  return { width, height, data, rects };
}

/** light-0 holds W1..W4, light-1 W5, cove, ch_end and ch_centre, light-2 the dome (then three unused channels). */
export function decodeFloorDirect(maps: readonly Image8[], ranges: readonly (readonly [number, number])[], texels: number): Float32Array {
  const out = new Float32Array(texels * SOURCE_COUNT);
  for (let k = 0; k < SOURCE_COUNT; k += 1) {
    const map = maps[Math.floor(k / 4)], range = ranges[k];
    if (map === undefined || range === undefined) throw new Error("The floor light maps are incomplete.");
    for (let texel = 0; texel < texels; texel += 1) {
      out[texel * SOURCE_COUNT + k] = decodeLog(map.data[texel * 4 + (k % 4)] ?? 0, range[0], range[1]);
    }
  }
  return out;
}

export function floorBounceField(field: ProbeField, texelToModel: readonly number[], width: number, height: number): Float32Array {
  const out = new Float32Array(width * height * SOURCE_COUNT * 3);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const { indices, weights } = trilinearCorners(field, texelCentre(texelToModel, column, row));
      const base = (row * width + column) * SOURCE_COUNT * 3;
      indices.forEach((index, corner) => {
        const weight = weights[corner] ?? 0;
        if (weight === 0) return;
        const cube = field.cube(index);
        for (let k = 0; k < SOURCE_COUNT; k += 1) {
          for (let c = 0; c < 3; c += 1) out[base + k * 3 + c] = (out[base + k * 3 + c] ?? 0) + weight * (cube[(k * 3 + c) * 6 + 4] ?? 0);
        }
      });
    }
  }
  return out;
}

export async function loadRelightModelData(fetchFn: FetchLike, manifestUrl: string, signal?: AbortSignal): Promise<RelightModelData> {
  const response = await fetchFn(manifestUrl, { signal });
  if (!response.ok) throw new Error(`The relight manifest could not be read (${String(response.status)}).`);
  const manifest = RelightManifestSchema.parse(await response.json());
  const baseUrl = manifestUrl.slice(0, manifestUrl.lastIndexOf("/") + 1);
  const read = async (path: string): Promise<Uint8Array> => {
    const entry = manifest.files[path];
    if (entry === undefined) throw new Error(`The relight manifest has no checksum for ${path}.`);
    return fetchVerified(fetchFn, `${baseUrl}${path}`, entry, signal);
  };
  const [nx, ny, nz] = manifest.probes.shape;
  const probeCount = nx * ny * nz;
  const halves = await inflate(await read(manifest.probes.file), "gzip", probeCount * PROBE_VALUES * 2);
  if (halves.length !== probeCount * PROBE_VALUES * 2) throw new Error("The probe volume does not match its grid.");
  // Little-endian binary16 bits, read in place (every browser platform is little-endian); the GPU folds them.
  const probes = new Uint16Array(halves.buffer, halves.byteOffset, halves.byteLength / 2);
  const probeValid = await inflate(await read(manifest.probes.validFile), "gzip", probeCount);
  if (probeValid.length !== probeCount) throw new Error("The probe validity does not match its grid.");
  const field = denseProbeField(manifest, probes, probeValid);
  const captureWeights = captureWeightsOf(manifest);
  const probeCapture = new Float32Array(probeCount * PROBE_CAPTURE_STRIDE);
  const folded = new Float64Array(PROBE_FOLDED);
  for (let probe = 0; probe < probeCount; probe += 1) {
    foldProbeCube(field.cube(probe), captureWeights, [0, 0, 0], [0, 0, 0, 0, 0], folded);
    probeCapture.set(folded, probe * PROBE_CAPTURE_STRIDE);
    probeCapture[probe * PROBE_CAPTURE_STRIDE + PROBE_FOLDED] = probeValid[probe] === 1 ? 1 : 0;
  }
  const stencils: Image8[] = [];
  for (const window of manifest.windows) {
    for (const plane of [window.planes.inner, window.planes.glass]) {
      const image = await decodePng(await read(plane.stencil));
      if (image.channels !== 1 || image.width !== plane.stencilSize[0] || image.height !== plane.stencilSize[1]) {
        throw new Error(`The stencil ${plane.stencil} is not a ${String(plane.stencilSize[0])} × ${String(plane.stencilSize[1])} greyscale image.`);
      }
      stencils.push(image);
    }
  }
  const [width, height] = manifest.floor.size;
  const maps: Image8[] = [];
  for (const path of manifest.floor.files) {
    const image = await decodePng(await read(path));
    if (image.channels !== 4 || image.width !== width || image.height !== height) {
      throw new Error(`The floor light map ${path} is not ${String(width)} × ${String(height)} RGBA.`);
    }
    maps.push(image);
  }
  return {
    manifest, baseUrl, probeCount, probes, probeValid, probeCapture, stencils,
    atlas: packStencilAtlas(stencils),
    floorDirect: decodeFloorDirect(maps, manifest.encoding.floor, width * height),
    floorBounce: floorBounceField(field, manifest.floor.texelToModel, width, height),
  };
}

export async function loadRelightRecords(fetchFn: FetchLike, source: RelightTileSource, signal?: AbortSignal): Promise<Uint8Array> {
  const compressed = await fetchVerified(fetchFn, source.url, source, signal);
  const records = await inflate(compressed, "gzip", source.count * RECORD_BYTES);
  if (records.length !== source.count * RECORD_BYTES) {
    throw new Error(`The relight records at ${source.url} hold ${String(records.length / RECORD_BYTES)} splats, not ${String(source.count)}.`);
  }
  return records;
}

export function transferablesOf(data: RelightModelData): ArrayBuffer[] {
  const buffers = new Set<ArrayBufferLike>([
    data.probes.buffer, data.probeValid.buffer, data.probeCapture.buffer, data.atlas.data.buffer, data.atlas.rects.buffer,
    data.floorDirect.buffer, data.floorBounce.buffer, ...data.stencils.map((stencil) => stencil.data.buffer),
  ]);
  return [...buffers].filter((buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer);
}
```

- [ ] **Step 4: Implement the worker and its client**

`packages/web/src/lib/relight/relight-worker.ts`:

```ts
import { RelightWorkerRequestSchema, loadRelightModelData, loadRelightRecords, transferablesOf, type RelightWorkerResponse } from "./relight-assets.js";

// One request per worker (T-639 R1b): the owner terminates it to abort. Fetching,
// checksums, gunzip, PNG decoding and the floor's bounce stay off the main thread.
const scope = self;
scope.onmessage = (event: MessageEvent<unknown>) => {
  void (async () => {
    try {
      const request = RelightWorkerRequestSchema.parse(event.data);
      const fetchFn = (url: string, init: { readonly signal?: AbortSignal }): Promise<Response> => fetch(url, { signal: init.signal, credentials: "omit" });
      if (request.type === "package") {
        const data = await loadRelightModelData(fetchFn, request.manifestUrl);
        const message: RelightWorkerResponse = { type: "package", data };
        scope.postMessage(message, { transfer: transferablesOf(data) });
      } else {
        const records = await loadRelightRecords(fetchFn, request.source);
        const message: RelightWorkerResponse = { type: "records", records };
        scope.postMessage(message, { transfer: [records.buffer as ArrayBuffer] });
      }
    } catch (error) {
      const message: RelightWorkerResponse = { type: "error", message: error instanceof Error ? error.message : String(error) };
      scope.postMessage(message);
    }
  })();
};
```

`packages/web/src/lib/relight/relight-worker-client.ts`:

```ts
import type { RelightWorkerRequest, RelightWorkerResponse, RelightWorkerResult } from "./relight-assets.js";

const MAX_WORKERS = 4;
const queue: (() => void)[] = [];
let running = 0;

function pump(): void {
  while (running < MAX_WORKERS) {
    const next = queue.shift();
    if (next === undefined) return;
    next();
  }
}

/** One request per worker, at most four at a time; aborting terminates the worker. */
export function runRelightWorker(request: RelightWorkerRequest, signal?: AbortSignal): Promise<RelightWorkerResult> {
  return new Promise((resolve, reject) => {
    let worker: Worker | null = null;
    let settled = false;
    let active = false;
    const finish = (error: Error | null, result?: RelightWorkerResult): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      worker?.terminate();
      const queued = queue.indexOf(start);
      if (queued >= 0) queue.splice(queued, 1);
      if (active) running -= 1;
      if (error !== null) reject(error);
      else if (result !== undefined) resolve(result);
      pump();
    };
    const abort = (): void => { finish(new DOMException("Relight loading cancelled.", "AbortError")); };
    const start = (): void => {
      active = true;
      running += 1;
      try {
        worker = new Worker(new URL("./relight-worker.ts", import.meta.url), { type: "module" });
        worker.onmessage = (event: MessageEvent<RelightWorkerResponse>) => {
          const message = event.data;
          if (message.type === "error") finish(new Error(message.message));
          else finish(null, message);
        };
        worker.onerror = (event) => { event.preventDefault(); finish(new Error(event.message || "The relight worker failed.")); };
        worker.onmessageerror = () => { finish(new Error("The relight worker returned an unreadable result.")); };
        worker.postMessage(request);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    };
    if (signal?.aborted === true) { abort(); return; }
    signal?.addEventListener("abort", abort, { once: true });
    queue.push(start);
    pump();
  });
}
```

`packages/web/src/lib/relight-package.ts`:

```ts
import type { RelightModelData } from "./relight/relight-assets.js";
import type { RelightTileSource } from "./relight/relight-manifest.js";
import { runRelightWorker } from "./relight/relight-worker-client.js";
import { warnRelightFallback } from "./relight/relight-warning.js";

// The relight package for the browser (T-639 R1b, spec §4.4): manifest schema,
// fetch and decode in a worker. An absent or invalid package returns nothing.

const packages = new Map<string, Promise<RelightModelData | null>>();

function absoluteUrl(url: string): string {
  return typeof document === "undefined" ? url : new URL(url, document.baseURI).href;
}

/**
 * The room's relight package, decoded and verified in a worker; null (with one
 * console warning) when it is missing, invalid or unreadable, so the hall is
 * drawn as captured (spec §5). Cached per URL: packages are immutable.
 */
export function loadRelightPackage(manifestUrl: string): Promise<RelightModelData | null> {
  const cached = packages.get(manifestUrl);
  if (cached !== undefined) return cached;
  const pending = runRelightWorker({ type: "package", manifestUrl: absoluteUrl(manifestUrl) })
    .then((result) => {
      if (result.type !== "package") throw new Error("The relight worker returned no package.");
      return result.data;
    })
    .catch((reason: unknown) => {
      warnRelightFallback("package", "The relight package could not be used; the hall is drawn as captured.", reason);
      return null;
    });
  packages.set(manifestUrl, pending);
  return pending;
}

/** One tile's records, verified and gunzipped in a worker. */
export async function loadRelightRecords(source: RelightTileSource, signal: AbortSignal): Promise<Uint8Array> {
  const result = await runRelightWorker({ type: "records", source: { ...source, url: absoluteUrl(source.url) } }, signal);
  if (result.type !== "records") throw new Error("The relight worker returned no records.");
  return result.records;
}

/** Tests only. */
export function resetRelightPackages(): void {
  packages.clear();
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/relight-assets.test.ts`
Expected: PASS, 7 tests.

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/relight-package.test.ts`
Expected: PASS, 3 tests.

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/relight-assets.staged.test.ts`
Expected: 1 test skipped (no `RELIGHT_STAGED_PACKAGE`).

- [ ] **Step 6: Check the staged Grand Hall package**

Run: `cd D:/claude/real-hall/repo && RELIGHT_STAGED_PACKAGE=D:/claude/splats/trades-hall/grand-hall/relight/v1 pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/relight-assets.staged.test.ts`
Expected: PASS, 1 test: the real manifest validates, every checksum matches and everything decodes. A Zod issue or checksum failure is a contract mismatch with R1a: stop and report it.

- [ ] **Step 7: Typecheck**

Run: `cd D:/claude/real-hall/repo && pnpm --filter @omnitwin/web typecheck`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/relight/relight-assets.ts packages/web/src/lib/relight/relight-worker.ts packages/web/src/lib/relight/relight-worker-client.ts packages/web/src/lib/relight-package.ts packages/web/src/lib/relight/__tests__/relight-assets.test.ts packages/web/src/lib/relight/__tests__/relight-assets.staged.test.ts packages/web/src/lib/__tests__/relight-package.test.ts && git diff --cached --stat && git commit -m "feat(relight): the package and each tile's records verified and decoded in a worker (T-639 R1b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The sun's position (NOAA)

**Files:**
- Create: `packages/web/src/lib/sun.ts`
- Test: `packages/web/src/lib/__tests__/sun.test.ts`

**Interfaces:**
- Consumes: Task 1 (`Vec3`).
- Produces: `interface SolarPosition { readonly azimuth: number; readonly elevation: number }` (degrees; azimuth clockwise from north; elevation with atmospheric refraction above −0.575°, geometric below, as NOAA and the proof); `TRADES_HALL_LATITUDE = 55.8593`; `TRADES_HALL_LONGITUDE = -4.2491`; `interface SiteFrame { readonly north: Vec3; readonly east: Vec3; readonly up: Vec3 }`; `solarPosition(utc: Date, latitude?: number, longitude?: number): SolarPosition`; `sunDirection(position: SolarPosition, frame: SiteFrame): Vec3` (toward the sun, model frame).

The port is the proof's `common.solar_position` (NOAA's spreadsheet algorithm) line for line; Python's `%` is a floored modulo, so the port uses one. NOAA's published Glasgow times below are from the NOAA Solar Calculator (gml.noaa.gov/grad/solcalc) for 55.8593 N, 4.2491 W, converted to UTC; they are given to the minute, so the elevation at a published sunrise or sunset minute is within 0.1° of −0.833°.

- [ ] **Step 1: Write the failing test** — create `packages/web/src/lib/__tests__/sun.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { TRADES_HALL_LATITUDE, TRADES_HALL_LONGITUDE, solarPosition, sunDirection } from "../sun.js";

const at = (iso: string) => solarPosition(new Date(iso));

describe("the sun's position over the Trades Hall (T-639 R1b)", () => {
  it.each([
    "2026-05-31T12:14:38Z", "2026-06-21T12:18:43Z", "2026-09-29T12:07:29Z", "2026-12-21T12:14:50Z",
  ])("is due south at NOAA's solar noon, %s", (iso) => {
    expect(Math.abs(at(iso).azimuth - 180)).toBeLessThanOrEqual(0.1);
  });

  it.each([
    "2026-05-31T03:41:00Z", "2026-05-31T20:49:00Z", "2026-06-21T03:31:00Z", "2026-06-21T21:06:00Z",
    "2026-09-29T06:16:00Z", "2026-09-29T17:58:00Z", "2026-12-21T08:46:00Z", "2026-12-21T15:44:00Z",
  ])("stands 0.833° below the horizon at NOAA's sunrise or sunset minute, %s", (iso) => {
    expect(Math.abs(at(iso).elevation + 0.833)).toBeLessThanOrEqual(0.1);
  });

  it("puts the sunny morning's sun where the proof did: azimuth 99°, elevation 33°", () => {
    const { azimuth, elevation } = at("2026-05-31T08:00:00Z");
    expect([Math.round(azimuth), Math.round(elevation)]).toEqual([99, 33]);
  });

  it.each([
    ["2026-05-31T08:00:00Z", 98.944851, 32.713999],
    ["2026-05-31T12:00:00Z", 173.893952, 56.000051],
    ["2026-06-21T06:00:00Z", 72.669495, 16.739054],
    ["2026-06-21T09:00:00Z", 110.95278, 41.491999],
    ["2026-03-20T09:00:00Z", 123.767077, 20.590675],
    ["2026-12-21T10:30:00Z", 155.822376, 7.733625],
    ["2026-09-29T21:00:00Z", 306.5488, -24.984063],
    ["2026-09-29T15:30:00Z", 234.601117, 18.58783],
  ])("matches the proof's solar_position at %s", (iso, azimuth, elevation) => {
    const position = at(iso);
    expect(position.azimuth).toBeCloseTo(azimuth, 5);
    expect(position.elevation).toBeCloseTo(elevation, 5);
  });

  it("defaults to the Trades Hall", () => {
    const utc = new Date("2026-06-21T09:00:00Z");
    expect(solarPosition(utc)).toEqual(solarPosition(utc, TRADES_HALL_LATITUDE, TRADES_HALL_LONGITUDE));
    expect([TRADES_HALL_LATITUDE, TRADES_HALL_LONGITUDE]).toEqual([55.8593, -4.2491]);
  });

  it("turns azimuth and elevation into the model frame as the proof's sun_vec_e57 does", () => {
    const rad = Math.PI / 180;
    const frame = {
      north: [Math.cos(14.3 * rad), Math.sin(14.3 * rad), 0] as const,
      east: [Math.sin(14.3 * rad), -Math.cos(14.3 * rad), 0] as const,
      up: [0, 0, 1] as const,
    };
    for (const [azimuth, elevation] of [[98.944851, 32.713999], [0, 0], [90, 0], [250, 60]] as const) {
      const theta = (14.3 - azimuth) * rad, el = elevation * rad;
      const expected = [Math.cos(theta) * Math.cos(el), Math.sin(theta) * Math.cos(el), Math.sin(el)];
      sunDirection({ azimuth, elevation }, frame).forEach((value, axis) => { expect(value).toBeCloseTo(expected[axis] ?? Number.NaN, 12); });
    }
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/sun.test.ts`
Expected: FAIL — cannot find module `../sun.js`.

- [ ] **Step 3: Implement** — create `packages/web/src/lib/sun.ts`:

```ts
import type { Vec3 } from "./relight/relight-codec.js";

/**
 * The sun's direction for a date, time and place (spec §4.4): NOAA's solar
 * position algorithm, ported line for line from the proof's
 * common.solar_position so the browser's sun matches the bake's.
 */
export interface SolarPosition {
  /** Degrees clockwise from north. */
  readonly azimuth: number;
  /** Degrees above the horizon; refracted above −0.575°, geometric below (as NOAA). */
  readonly elevation: number;
}

export const TRADES_HALL_LATITUDE = 55.8593;
export const TRADES_HALL_LONGITUDE = -4.2491;

/** The site's compass in the model frame (relight manifest `site`). */
export interface SiteFrame {
  readonly north: Vec3;
  readonly east: Vec3;
  readonly up: Vec3;
}

const RAD = Math.PI / 180;
/** Python's %: the result takes the divisor's sign. */
const floorMod = (value: number, modulus: number): number => ((value % modulus) + modulus) % modulus;

function julianDay(year: number, month: number, day: number): number {
  let y = year, m = month;
  if (m <= 2) { y -= 1; m += 12; }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.trunc(365.25 * (y + 4716)) + Math.trunc(30.6001 * (m + 1)) + day + b - 1524.5;
}

export function solarPosition(utc: Date, latitude = TRADES_HALL_LATITUDE, longitude = TRADES_HALL_LONGITUDE): SolarPosition {
  const hours = utc.getUTCHours() + utc.getUTCMinutes() / 60 + utc.getUTCSeconds() / 3600 + utc.getUTCMilliseconds() / 3_600_000;
  const jd = julianDay(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate()) + hours / 24;
  const t = (jd - 2451545) / 36525;
  const l0 = floorMod(280.46646 + t * (36000.76983 + 0.0003032 * t), 360);
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const mr = m * RAD;
  const centre = Math.sin(mr) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * mr) * (0.019993 - 0.000101 * t) + Math.sin(3 * mr) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const lambda = l0 + centre - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const declination = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) / RAD;
  const y = Math.tan(eps / 2 * RAD) ** 2;
  const l0r = l0 * RAD;
  const equationOfTime = 4 * (y * Math.sin(2 * l0r) - 2 * e * Math.sin(mr) + 4 * e * y * Math.sin(mr) * Math.cos(2 * l0r)
    - 0.5 * y * y * Math.sin(4 * l0r) - 1.25 * e * e * Math.sin(2 * mr)) / RAD;
  const trueSolarTime = floorMod(hours * 60 + equationOfTime + 4 * longitude, 1440);
  const hourAngle = (trueSolarTime / 4 - 180) * RAD;
  const lat = latitude * RAD, dec = declination * RAD;
  const cosZenith = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(hourAngle);
  let elevation = 90 - Math.acos(Math.max(-1, Math.min(1, cosZenith))) / RAD;
  const azimuth = floorMod(Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat)) / RAD + 180, 360);
  if (elevation > -0.575) elevation += 1.02 / Math.tan((elevation + 10.3 / (elevation + 5.11)) * RAD) / 60;
  return { azimuth, elevation };
}

/** Toward the sun in the model frame: cos(el)(cos(az) north + sin(az) east) + sin(el) up. */
export function sunDirection(position: SolarPosition, frame: SiteFrame): Vec3 {
  const az = position.azimuth * RAD, el = position.elevation * RAD;
  const n = Math.cos(az) * Math.cos(el), e = Math.sin(az) * Math.cos(el), u = Math.sin(el);
  return [
    n * frame.north[0] + e * frame.east[0] + u * frame.up[0],
    n * frame.north[1] + e * frame.east[1] + u * frame.up[1],
    n * frame.north[2] + e * frame.east[2] + u * frame.up[2],
  ];
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/sun.test.ts`
Expected: PASS, 23 tests.

- [ ] **Step 5: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/sun.ts packages/web/src/lib/__tests__/sun.test.ts && git diff --cached --stat && git commit -m "feat(relight): the sun's position over the Trades Hall, NOAA's algorithm as the bake uses it (T-639 R1b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The display function, sky panel colour and the floor's light

**Files:**
- Create: `packages/web/src/lib/relight/display.ts`
- Create: `packages/web/src/lib/relight/floor-light.ts`
- Test: `packages/web/src/lib/relight/__tests__/display.test.ts`, `packages/web/src/lib/relight/__tests__/floor-light.test.ts`

**Interfaces:**
- Consumes: Task 1 (`SOURCE_COUNT`, `WINDOW_COUNT`, `Vec3`), Task 4 (`LUMINANCE`, `windowVisibility`, `KernelFrame`, `RelightKernelModel`, `Rgb`), Task 5 (`texelCentre`).
- Produces (`display.ts`): `interface DisplayParams { readonly exposure: number; readonly whiteBalance: Rgb }`; `NEUTRAL_DISPLAY`; `HIGHLIGHT_KNEE = 0.8`; `SPLAT_KNEE_MAX = 0.999`; `HIGHLIGHT_DESATURATION = 0.15`; `SKY_NIGHT: Rgb = [0.01, 0.013, 0.024]`; `SKY_TOP = 0.85`; `SKY_BOTTOM = 0.55`; `splatKnee(captured: Rgb): number`; `displayColour(rgb: Rgb, params: DisplayParams, knee?: number): Rgb` (knee 0.8 by default); `interface DisplayUniforms { exposure: UniformNode<"float", number>; whiteBalance: UniformNode<"vec3", Vector3> }`; `splatKneeNode(captured: Node<"vec3">): Node<"float">`; `displayNode(rgb: Node<"vec3">, display: DisplayUniforms, knee: Node<"float">): Node<"vec3">`; `skyPanelColour(level: number, colour: Rgb, height: number, params: DisplayParams): Rgb`; `interface SkyUniforms { level: UniformNode<"float", number>; colour: UniformNode<"vec3", Vector3> }`; `skyPanelNode(height: Node<"float">, sky: SkyUniforms, display: DisplayUniforms): Node<"vec3">`.
- Produces (`floor-light.ts`): `interface FloorLightData { readonly width: number; readonly height: number; readonly direct: Float32Array; readonly bounce: Float32Array; readonly texelToModel: readonly number[] }`; `texelBaseLight(data: FloorLightData, texel: number, frame: KernelFrame): Rgb`; `floorBaseLight(data: FloorLightData, frame: KernelFrame): Float32Array` (RGBA per texel, A = 1); `FLOOR_NORMAL: Vec3 = [0, 0, 1]`; `floorSunIrradiance(model: RelightKernelModel, frame: KernelFrame, point: Vec3): Rgb`; `roomLight(data: FloorLightData, model: RelightKernelModel, frame: KernelFrame, stride?: number): Rgb`; `modelToLightUvMatrix(texelToModel: readonly number[], width: number, height: number): Matrix4`.

The display (decision 3, knee per call) multiplies by exposure and white balance, then leaves every colour whose brightest channel is at most the knee k unchanged and rolls higher ones off with the Khronos PBR Neutral highlight curve generalised to k, `newPeak = 1 − (1 − k)² / (peak + 1 − 2k)` (continuous at k), desaturation 0.15. The floor and the sky panels use k = 0.8. A splat uses `splatKnee` of its captured linear colour: its brightest channel, at least 0.8, at most 0.999 (the curve is undefined at 1). At the captured light (multiplier 1, exposure 1, white balance 1) every splat's display is therefore exactly the identity, highlights included, and only light that relighting pushes past the capture's own white is compressed (spec §4.3). "As captured" keeps the display on; it needs no special case. The floor's base light is the nine sources' direct light and bounce per 5 cm texel weighted by the setting, plus the sun's bounce; the direct sun is added per pixel by the floor material (Task 14), and `floorSunIrradiance` is its CPU twin (nearest stencil cell) for the mean light the display adapts to.

- [ ] **Step 1: Write the failing tests**

`packages/web/src/lib/relight/__tests__/display.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { HIGHLIGHT_KNEE, NEUTRAL_DISPLAY, SKY_NIGHT, SPLAT_KNEE_MAX, displayColour, skyPanelColour, splatKnee } from "../display.js";

describe("the relight display (T-639 R1b)", () => {
  it("is exposure times white balance, unchanged up to the knee", () => {
    expect(displayColour([0.8, 0.5, 0.1], NEUTRAL_DISPLAY)).toEqual([0.8, 0.5, 0.1]);
    const scaled = displayColour([0.2, 0.2, 0.2], { exposure: 2, whiteBalance: [1, 1, 1.5] });
    [0.4, 0.4, 0.6].forEach((value, index) => { expect(scaled[index]).toBeCloseTo(value, 12); });
  });

  it("rolls highlights off above 0.8 with the Khronos neutral curve", () => {
    const [r, g, b] = displayColour([2, 1, 0.5], NEUTRAL_DISPLAY);
    expect(r).toBeCloseTo(0.9714285714285714, 12);
    expect(g).toBeCloseTo(0.5506364922206506, 12);
    expect(b).toBeCloseTo(0.3402404526166902, 12);
  });

  it("is continuous at any knee and never reaches 1", () => {
    for (const knee of [HIGHLIGHT_KNEE, 0.95]) {
      const [atKnee] = displayColour([knee + 1e-9, 0, 0], NEUTRAL_DISPLAY, knee);
      expect(atKnee).toBeCloseTo(knee, 7);
      for (const peak of [0.96, 1, 4, 1e6]) expect(Math.max(...displayColour([peak, peak / 2, 0], NEUTRAL_DISPLAY, knee))).toBeLessThan(1);
    }
  });

  it("passes a captured colour with a channel above 0.8 unchanged at its own knee, and rolls off what relighting adds", () => {
    const captured: [number, number, number] = [0.95, 0.5, 0.2];
    expect(splatKnee(captured)).toBe(0.95);
    expect(displayColour(captured, NEUTRAL_DISPLAY, splatKnee(captured))).toEqual(captured);
    expect([splatKnee([0.3, 0.2, 0.1]), splatKnee([1, 1, 1])]).toEqual([HIGHLIGHT_KNEE, SPLAT_KNEE_MAX]);
    expect(Math.max(...displayColour([1.9, 1, 0.4], NEUTRAL_DISPLAY, splatKnee(captured)))).toBeLessThan(1);
  });

  it("draws the sky panel dark at night and brighter at the top by day", () => {
    expect(skyPanelColour(0, [1, 1, 1], 0.5, NEUTRAL_DISPLAY)).toEqual([...SKY_NIGHT]);
    const top = skyPanelColour(1, [1, 1, 1], 1, NEUTRAL_DISPLAY), bottom = skyPanelColour(1, [1, 1, 1], 0, NEUTRAL_DISPLAY);
    expect(top[1]).toBeCloseTo(0.85, 12);
    expect(bottom[1]).toBeCloseTo(0.55, 12);
  });
});
```

`packages/web/src/lib/relight/__tests__/floor-light.test.ts`:

```ts
import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { floorBaseLight, floorSunIrradiance, modelToLightUvMatrix, roomLight, texelBaseLight, type FloorLightData } from "../floor-light.js";
import { capturedSetting, prepareKernelFrame, type KernelFrame, type ProbeField, type RelightKernelModel, type StencilPlane } from "../relight-kernel.js";

const TEXEL_TO_MODEL = [0.5, 0, 0, 0.25, 0, 0.5, 0, 0.25, 0, 0, 0, 0.02, 0, 0, 0, 1];
/** Two texels: W1 direct 1 and bounce 0.2, the cove bounce 0.1. */
const DATA: FloorLightData = {
  width: 2, height: 1, texelToModel: TEXEL_TO_MODEL,
  direct: Float32Array.from({ length: 18 }, (_, index) => (index % 9 === 0 ? 1 : 0)),
  bounce: Float32Array.from({ length: 54 }, (_, index) => {
    const source = Math.floor(index / 3) % 9;
    return source === 0 ? 0.2 : source === 5 ? 0.1 : 0;
  }),
};
function plane(y: number): StencilPlane {
  return {
    origin: [0, y, 3], u: [1, 0, 0], v: [0, 0, -1], width: 2, height: 3, normal: [0, -1, 0],
    stencil: { width: 20, height: 30, data: new Uint8Array(600).fill(255) },
  };
}
const probes: ProbeField = { origin: [0, 0, 0], spacing: 1, shape: [2, 2, 2], valid: () => true, cube: () => new Float32Array(162) };
const horizon = (elevation: number): number[][] => [Array.from({ length: 360 }, () => elevation)];
const MODEL: RelightKernelModel = {
  ranges: Array.from({ length: 9 }, () => [-127, 0] as const),
  captureWeights: [1, 1, 1, 1, 1, 0.5, 0.5, 0.5, 0.5].map((weight) => [weight, weight, weight] as const),
  daylightColour: [1, 1, 1], probes,
  windows: [{ inner: plane(0), glass: plane(-0.5) }], horizons: horizon(0), site: { north: [0, 1, 0], east: [1, 0, 0], up: [0, 0, 1] },
  fresnel: Array.from({ length: 101 }, () => 0.9), sunBeta: 0, skyFlux: [1, 1, 1, 1, 1],
};
/** The same window behind a horizon 80° high. */
const CLOSED: RelightKernelModel = { ...MODEL, horizons: horizon(80) };
const captured = (): KernelFrame => prepareKernelFrame(MODEL, capturedSetting(MODEL));

describe("the floor's light (T-639 R1b)", () => {
  it("weights each texel's direct light and bounce by the setting", () => {
    // W1: 1 × (1 + 0.2); the cove: 0.5 × 0.1
    for (const value of texelBaseLight(DATA, 1, captured())) expect(value).toBeCloseTo(1.25, 6);
    const rgba = floorBaseLight(DATA, captured());
    expect(rgba).toHaveLength(8);
    expect(rgba[3]).toBe(1);
    expect(rgba[4]).toBeCloseTo(1.25, 6);
  });

  it("adds the sun's bounce through each window only while the sun is in", () => {
    const frame: KernelFrame = { ...captured(), sunOn: true, bounceWeights: [2, 0, 0, 0, 0], setting: { ...captured().setting, sunRgb: [1, 0.5, 0] } };
    const [r, g, b] = texelBaseLight(DATA, 0, frame);
    expect(r).toBeCloseTo(1.25 + 2 * 1 * 0.2, 6);
    expect(g).toBeCloseTo(1.25 + 2 * 0.5 * 0.2, 6);
    expect(b).toBeCloseTo(1.25, 6);
  });

  it("lights the floor through a window the sun stands above the horizon of, and not otherwise", () => {
    const sun: [number, number, number] = [0, -0.6, 0.8];
    const setting = { ...capturedSetting(MODEL), sunDir: sun, sunRgb: [2, 2, 2] as const };
    const lit = floorSunIrradiance(MODEL, prepareKernelFrame(MODEL, setting), [1, 1, 0]);
    // through both planes (x = 1; z 1.33 m at the room side, 2.0 m at the glass), transmission 0.9, cosine 0.8
    for (const value of lit) expect(value).toBeCloseTo(0.9 * 0.8 * 2, 12);
    // the sun at 53° stands below an 80° horizon
    expect(floorSunIrradiance(CLOSED, prepareKernelFrame(CLOSED, setting), [1, 1, 0])).toEqual([0, 0, 0]);
  });

  it("averages the floor's light for the display", () => {
    const mean = roomLight(DATA, MODEL, captured(), 1);
    for (const value of mean) expect(value).toBeCloseTo(1.25, 6);
  });

  it("maps model points on the floor to the light map's texel centres", () => {
    const uv = new Vector3(0.75, 0.25, 0.02).applyMatrix4(modelToLightUvMatrix(TEXEL_TO_MODEL, 2, 2));
    expect(uv.x).toBeCloseTo(0.75, 12);
    expect(uv.y).toBeCloseTo(0.25, 12);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/display.test.ts`
Expected: FAIL — cannot find module `../display.js`.

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/floor-light.test.ts`
Expected: FAIL — cannot find module `../floor-light.js`.

- [ ] **Step 3: Implement the display** — create `packages/web/src/lib/relight/display.ts`:

```ts
import type { Vector3 } from "three";
import type { Node, UniformNode } from "three/webgpu";
import { float, max, min, mix, select, vec3 } from "three/tsl";
import type { Rgb } from "./relight-kernel.js";

/**
 * The relit hall's display (decision 3, knee per call): exposure and white
 * balance, then the identity up to a knee k and above it the Khronos PBR Neutral
 * highlight curve generalised to k, newPeak = 1 − (1 − k)² / (peak + 1 − 2k).
 * The floor and sky panels use k = 0.8; a splat uses its own captured brightest
 * channel (splatKnee), so at the captured light the display is exactly the
 * identity for every splat and no film curve is added to the capture.
 */
export interface DisplayParams {
  readonly exposure: number;
  readonly whiteBalance: Rgb;
}

export const NEUTRAL_DISPLAY: DisplayParams = { exposure: 1, whiteBalance: [1, 1, 1] };
export const HIGHLIGHT_KNEE = 0.8;
/** The curve is undefined at a knee of 1. */
export const SPLAT_KNEE_MAX = 0.999;
export const HIGHLIGHT_DESATURATION = 0.15;
/** Linear sky panel radiance: the night floor, and the gradient's top and bottom at sky level 1. */
export const SKY_NIGHT: Rgb = [0.01, 0.013, 0.024];
export const SKY_TOP = 0.85;
export const SKY_BOTTOM = 0.55;

/** A splat's knee: the brightest channel of its captured linear colour, at least 0.8, at most 0.999. */
export function splatKnee(captured: Rgb): number {
  return Math.min(Math.max(HIGHLIGHT_KNEE, captured[0], captured[1], captured[2]), SPLAT_KNEE_MAX);
}

export function displayColour(rgb: Rgb, params: DisplayParams, knee = HIGHLIGHT_KNEE): Rgb {
  const c: Rgb = [rgb[0] * params.exposure * params.whiteBalance[0], rgb[1] * params.exposure * params.whiteBalance[1], rgb[2] * params.exposure * params.whiteBalance[2]];
  const peak = Math.max(c[0], c[1], c[2]);
  if (peak <= knee) return c;
  const d = 1 - knee;
  const newPeak = 1 - d * d / (peak + 1 - 2 * knee);
  const g = 1 - 1 / (HIGHLIGHT_DESATURATION * (peak - newPeak) + 1);
  const roll = (value: number): number => (value * newPeak / peak) * (1 - g) + newPeak * g;
  return [roll(c[0]), roll(c[1]), roll(c[2])];
}

export interface DisplayUniforms {
  readonly exposure: UniformNode<"float", number>;
  readonly whiteBalance: UniformNode<"vec3", Vector3>;
}

/** splatKnee in TSL, from the splat's captured linear colour (before its multiplier). */
export function splatKneeNode(captured: Node<"vec3">): Node<"float"> {
  return min(max(float(HIGHLIGHT_KNEE), max(captured.x, max(captured.y, captured.z))), float(SPLAT_KNEE_MAX));
}

/** displayColour in TSL, on linear working RGB, above the given knee. */
export function displayNode(rgb: Node<"vec3">, display: DisplayUniforms, knee: Node<"float">): Node<"vec3"> {
  const c = rgb.mul(display.exposure).mul(display.whiteBalance);
  const peak = max(c.x, max(c.y, c.z));
  const d = float(1).sub(knee);
  const newPeak = float(1).sub(d.mul(d).div(peak.add(1).sub(knee.mul(2))));
  const g = float(1).sub(float(1).div(peak.sub(newPeak).mul(HIGHLIGHT_DESATURATION).add(1)));
  const rolled = mix(c.mul(newPeak.div(peak)), vec3(newPeak), g);
  return select(peak.greaterThan(knee), rolled, c);
}

/** A window's sky panel at `height` (0 bottom, 1 top): a flat gradient, never darker than the night floor, knee 0.8. */
export function skyPanelColour(level: number, colour: Rgb, height: number, params: DisplayParams): Rgb {
  const gradient = SKY_BOTTOM + (SKY_TOP - SKY_BOTTOM) * height;
  return displayColour([
    Math.max(colour[0] * level * gradient, SKY_NIGHT[0]),
    Math.max(colour[1] * level * gradient, SKY_NIGHT[1]),
    Math.max(colour[2] * level * gradient, SKY_NIGHT[2]),
  ], params, HIGHLIGHT_KNEE);
}

export interface SkyUniforms {
  readonly level: UniformNode<"float", number>;
  readonly colour: UniformNode<"vec3", Vector3>;
}

export function skyPanelNode(height: Node<"float">, sky: SkyUniforms, display: DisplayUniforms): Node<"vec3"> {
  const gradient = mix(float(SKY_BOTTOM), float(SKY_TOP), height);
  return displayNode(max(sky.colour.mul(sky.level).mul(gradient), vec3(...SKY_NIGHT)), display, float(HIGHLIGHT_KNEE));
}
```

- [ ] **Step 4: Implement the floor's light** — create `packages/web/src/lib/relight/floor-light.ts`:

```ts
import { Matrix4 } from "three";
import { SOURCE_COUNT, WINDOW_COUNT, type Vec3 } from "./relight-codec.js";
import { texelCentre } from "./relight-assets.js";
import { windowVisibility, type KernelFrame, type RelightKernelModel, type Rgb } from "./relight-kernel.js";

/** The floor light maps decoded (Task 5): direct [texel][source], bounce at +z [texel][source][channel]. */
export interface FloorLightData {
  readonly width: number;
  readonly height: number;
  readonly direct: Float32Array;
  readonly bounce: Float32Array;
  readonly texelToModel: readonly number[];
}

/** The floor faces up the model frame (e57, z up). */
export const FLOOR_NORMAL: Vec3 = [0, 0, 1];

/** Σk s[k] ⊙ (D[k] + I[k]) + Σw b[w] sunRgb ⊙ I[w]: everything but the direct sun. */
export function texelBaseLight(data: FloorLightData, texel: number, frame: KernelFrame): Rgb {
  const out = [0, 0, 0];
  for (let k = 0; k < SOURCE_COUNT; k += 1) {
    const weight = frame.setting.weights[k];
    const direct = data.direct[texel * SOURCE_COUNT + k] ?? 0;
    const sunBounce = frame.sunOn && k < WINDOW_COUNT ? frame.bounceWeights[k] ?? 0 : 0;
    for (let c = 0; c < 3; c += 1) {
      const bounce = data.bounce[(texel * SOURCE_COUNT + k) * 3 + c] ?? 0;
      out[c] = (out[c] ?? 0) + (weight?.[c] ?? 0) * (direct + bounce) + sunBounce * (frame.setting.sunRgb[c] ?? 0) * bounce;
    }
  }
  return [out[0] ?? 0, out[1] ?? 0, out[2] ?? 0];
}

/** The floor light texture's contents: RGBA per texel, alpha 1. */
export function floorBaseLight(data: FloorLightData, frame: KernelFrame): Float32Array {
  const texels = data.width * data.height;
  const out = new Float32Array(texels * 4);
  for (let texel = 0; texel < texels; texel += 1) {
    const [r, g, b] = texelBaseLight(data, texel, frame);
    out.set([r, g, b, 1], texel * 4);
  }
  return out;
}

/** The direct sun on the floor at a model point (CPU twin of the floor material's term, nearest stencil cell). */
export function floorSunIrradiance(model: RelightKernelModel, frame: KernelFrame, point: Vec3): Rgb {
  const sun = frame.setting.sunDir;
  if (sun === null || !frame.sunOn) return [0, 0, 0];
  const cosine = Math.max(sun[0] * FLOOR_NORMAL[0] + sun[1] * FLOOR_NORMAL[1] + sun[2] * FLOOR_NORMAL[2], 0);
  let visibility = 0;
  model.windows.forEach((planes, w) => { visibility += (frame.windowOpen[w] ?? 0) * windowVisibility(planes, point, sun); });
  const scale = visibility * frame.fresnelAtSun * cosine;
  return [scale * frame.setting.sunRgb[0], scale * frame.setting.sunRgb[1], scale * frame.setting.sunRgb[2]];
}

/** The mean of the floor's light over every `stride`-th texel each way, the sun included. */
export function roomLight(data: FloorLightData, model: RelightKernelModel, frame: KernelFrame, stride = 4): Rgb {
  const sum = [0, 0, 0];
  let count = 0;
  for (let row = 0; row < data.height; row += stride) {
    for (let column = 0; column < data.width; column += stride) {
      const base = texelBaseLight(data, row * data.width + column, frame);
      const sun = floorSunIrradiance(model, frame, texelCentre(data.texelToModel, column, row));
      for (let c = 0; c < 3; c += 1) sum[c] = (sum[c] ?? 0) + (base[c] ?? 0) + (sun[c] ?? 0);
      count += 1;
    }
  }
  return count === 0 ? [0, 0, 0] : [(sum[0] ?? 0) / count, (sum[1] ?? 0) / count, (sum[2] ?? 0) / count];
}

/**
 * Model point → light-map UV: (column + 0.5) / width, (row + 0.5) / height,
 * through the pseudo-inverse of texelToModel's in-plane columns (contract 4).
 */
export function modelToLightUvMatrix(texelToModel: readonly number[], width: number, height: number): Matrix4 {
  const m = (index: number): number => texelToModel[index] ?? 0;
  const a0: Vec3 = [m(0), m(4), m(8)], a1: Vec3 = [m(1), m(5), m(9)], t: Vec3 = [m(3), m(7), m(11)];
  const dot = (p: Vec3, q: Vec3): number => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  const g00 = dot(a0, a0), g01 = dot(a0, a1), g11 = dot(a1, a1);
  const det = g00 * g11 - g01 * g01;
  if (!(Math.abs(det) > 1e-18)) throw new Error("The floor's texelToModel is degenerate.");
  // rows of (AᵀA)⁻¹ Aᵀ
  const p0: Vec3 = [(g11 * a0[0] - g01 * a1[0]) / det, (g11 * a0[1] - g01 * a1[1]) / det, (g11 * a0[2] - g01 * a1[2]) / det];
  const p1: Vec3 = [(g00 * a1[0] - g01 * a0[0]) / det, (g00 * a1[1] - g01 * a0[1]) / det, (g00 * a1[2] - g01 * a0[2]) / det];
  return new Matrix4().set(
    p0[0] / width, p0[1] / width, p0[2] / width, (0.5 - dot(p0, t)) / width,
    p1[0] / height, p1[1] / height, p1[2] / height, (0.5 - dot(p1, t)) / height,
    0, 0, 0, 0,
    0, 0, 0, 1,
  );
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/display.test.ts`
Expected: PASS, 5 tests.

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/floor-light.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Typecheck** (the TSL annotations are checked here)

Run: `cd D:/claude/real-hall/repo && pnpm --filter @omnitwin/web typecheck`
Expected: exit 0. If TypeScript rejects an annotation on `displayNode`, `splatKneeNode` or `skyPanelNode`, change only the annotation (Global Constraints).

- [ ] **Step 7: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/relight/display.ts packages/web/src/lib/relight/floor-light.ts packages/web/src/lib/relight/__tests__/display.test.ts packages/web/src/lib/relight/__tests__/floor-light.test.ts && git diff --cached --stat && git commit -m "feat(relight): the display's highlight roll-off, the sky panel colour and the floor's light (T-639 R1b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Daylight, the light setting and its store

**Files:**
- Create: `packages/web/src/lib/relight/daylight.ts`
- Create: `packages/web/src/lib/light-setting.ts`
- Create: `packages/web/src/stores/light-setting-store.ts`
- Test: `packages/web/src/lib/relight/__tests__/daylight.test.ts`, `packages/web/src/lib/__tests__/light-setting.test.ts`, `packages/web/src/stores/__tests__/light-setting-store.test.ts`

**Interfaces:**
- Consumes: Task 2 (`ProofScenario`, `RelightManifest`), Task 4 (`capturedSetting`, `LUMINANCE`, `RelightSetting`, `Rgb`; `RelightVectorsSchema` in the test), Task 6 (`solarPosition`, `sunDirection`, `SiteFrame`, `SolarPosition`, Trades Hall defaults), Task 7 (`DisplayParams`, `NEUTRAL_DISPLAY`); `DeviceTier` from `./device-tier.js`.
- Produces (`daylight.ts`): `CAPTURE_DAYLIGHT_CCT = 6500`; `daylightRgb(cct: number): Rgb`; `cctShift(cct: number): Rgb`; `skyFactor(elevation: number): number`.
- Produces (`light-setting.ts`): `LIGHT_PRESETS = ["captured", "night", "sunny", "overcast"]`, `type LightPresetId`; `MIN_MINUTES = 360`, `MAX_MINUTES = 1320`; `interface LightChoice { readonly preset: LightPresetId; readonly date: string; readonly minutes: number }`; `PRESET_DEFAULTS`; `PRESET_DISPLAY`; `PRESET_EMITTER_BOOST` (captured 1, night 4, sunny 1, overcast 1); `defaultChoice(preset?: LightPresetId): LightChoice`; `londonOffsetHours(utc: Date): number`; `isIsoDate(value: string): boolean`; `londonLocalToUtc(date: string, minutes: number): Date`; `formatMinutes(minutes: number): string`; `clampMinutes(minutes: number): number`; `interface WeatherModel`; `interface LightInputs`; `interface LightParts`; `lightInputsFromParts(parts: LightParts): LightInputs`; `lightInputsFromManifest(manifest: RelightManifest): LightInputs`; `interface ChoiceLight { readonly setting: RelightSetting; readonly sun: SolarPosition | null }` (the horizon gates are the kernel's, Task 4); `settingForChoice(inputs: LightInputs, choice: LightChoice): ChoiceLight`; `adaptDisplay(preset: DisplayParams, reference: Rgb, current: Rgb): DisplayParams`; `lightPresetFromSearch(search: string, previewable: boolean): LightPresetId | null`; `relightOffBySearch(search: string, previewable: boolean): boolean`; `relightEligible(previewable: boolean, deviceTier: DeviceTier, off: boolean): boolean`.
- Produces (store): `type RelightStatus = "off" | "loading" | "ready"`; `useLightSettingStore` with `choice: LightChoice`, `status: RelightStatus`, `selectPreset(preset: LightPresetId): void`, `setMinutes(minutes: number): void`, `setDate(date: string): void`, `setStatus(status: RelightStatus): void`.

How a choice becomes a setting (decision 4, the proof's `scenario_light`): the preset fixes the weather, the lamps and the emitter boost (night: clear, lamps lit, boost 4; sunny: clear, lamps off, boost 1; overcast: overcast, lamps off, boost 1); the date and London time fix the sun. Clear weather is the proof's sunny morning (sky 0.7 at 9,000 K, sun 16 × sky × mean window weight at 4,900 K); overcast weather is its overcast noon (sky 1.2 at 6,500 K, no sun). The sky level scales by `skyFactor(elevation)` relative to the weather's own reference hour (the ratio is computed first, so at the preset's own hour it is exactly 1); `skyFactor` is 0 below civil twilight (−6°), rises through dawn and is √sin(elevation) from 3° up. Each window's horizon gate belongs to the kernel (`horizonGates`, Task 4), which reads it from the setting's sun direction. The captured choice is `capturedSetting` (emitter boost 1) with the neutral display, exposure 1 and white balance 1.

- [ ] **Step 1: Write the failing tests**

`packages/web/src/lib/relight/__tests__/daylight.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CAPTURE_DAYLIGHT_CCT, cctShift, daylightRgb, skyFactor } from "../daylight.js";

const close = (actual: readonly number[], expected: readonly number[], digits: number): void => {
  expected.forEach((value, index) => { expect(actual[index]).toBeCloseTo(value, digits); });
};

describe("daylight colour and sky level (T-639 R1b)", () => {
  it("places 6,500 K daylight at the capture's white", () => { close(daylightRgb(CAPTURE_DAYLIGHT_CCT), [0.9992811, 1, 0.9982526], 6); });
  it("warms at 4,000 K", () => { close(daylightRgb(4000), [1.4827245, 1, 0.5297081], 6); });
  it("uses the upper branch above 7,000 K", () => { close(daylightRgb(9000), [0.8484907, 1, 1.2998793], 6); });
  it("reaches a blue sky at 25,000 K", () => { close(daylightRgb(25000), [0.6669284, 1, 1.8934056], 6); });
  it("is continuous across the two branches", () => { close(daylightRgb(7001), daylightRgb(7000), 3); });
  it("shifts nothing at the capture's temperature", () => { expect(cctShift(6500)).toEqual([1, 1, 1]); });
  it("shifts toward the sun's 4,900 K as the proof does", () => { close(cctShift(4900), [1.2259506, 1, 0.7200617], 6); });
  it("shifts toward the clear sky's 9,000 K as the proof does", () => { close(cctShift(9000), [0.8491011, 1, 1.3021547], 6); });
  it("has no sky below civil twilight and full sky overhead", () => {
    expect([skyFactor(-25), skyFactor(-6), skyFactor(90)]).toEqual([0, 0, 1]);
    expect(skyFactor(30)).toBeCloseTo(Math.SQRT1_2, 12);
  });
  it("brightens steadily through dawn", () => {
    expect(skyFactor(0)).toBeCloseTo(0.1694596532222416, 12);
    expect(skyFactor(1.5)).toBeCloseTo(0.21182456652780202, 12);
    expect(skyFactor(3)).toBeCloseTo(0.22877053185002616, 12);
    for (let elevation = -6; elevation < 60; elevation += 0.5) expect(skyFactor(elevation + 0.5)).toBeGreaterThanOrEqual(skyFactor(elevation));
  });
});
```

`packages/web/src/lib/__tests__/light-setting.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PRESET_DEFAULTS, PRESET_DISPLAY, adaptDisplay, clampMinutes, defaultChoice, formatMinutes, isIsoDate,
  lightInputsFromParts, lightPresetFromSearch, londonLocalToUtc, relightEligible, relightOffBySearch, settingForChoice,
  type LightInputs,
} from "../light-setting.js";
import { RelightVectorsSchema, settingFromVectors } from "../relight/relight-vectors.js";
import type { RelightSetting } from "../relight/relight-kernel.js";
import { TRADES_HALL_LATITUDE, TRADES_HALL_LONGITUDE } from "../sun.js";

const vectors = RelightVectorsSchema.parse(JSON.parse(readFileSync(new URL("../relight/__fixtures__/relight-vectors.json", import.meta.url), "utf8")));
const inputs = (): LightInputs => lightInputsFromParts({
  weights: vectors.capture.weights, colours: vectors.capture.colours, daylightColour: vectors.capture.daylightColour,
  site: { ...vectors.site, latitude: TRADES_HALL_LATITUDE, longitude: TRADES_HALL_LONGITUDE },
  presets: vectors.presetsFromProof,
});
const relClose = (actual: number, expected: number): void => {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1e-6 * Math.max(1, Math.abs(expected)));
};
function expectSetting(actual: RelightSetting, expected: RelightSetting): void {
  actual.weights.forEach((weight, k) => { weight.forEach((value, c) => { relClose(value, expected.weights[k]?.[c] ?? Number.NaN); }); });
  relClose(actual.skyLevel, expected.skyLevel);
  if (expected.skyLevel > 0) actual.skyColour.forEach((value, c) => { relClose(value, expected.skyColour[c] ?? Number.NaN); });
  expect(actual.lampLevels).toEqual(expected.lampLevels);
  expect(actual.emitterBoost).toBe(expected.emitterBoost);
  if (expected.sunDir === null) expect(actual.sunDir).toBeNull();
  else actual.sunDir?.forEach((value, axis) => { expect(value).toBeCloseTo(expected.sunDir?.[axis] ?? Number.NaN, 9); });
  actual.sunRgb.forEach((value, c) => { relClose(value, expected.sunRgb[c] ?? Number.NaN); });
}

describe("the light setting (T-639 R1b)", () => {
  it("converts London wall-clock time to UTC across both clock changes", () => {
    expect(londonLocalToUtc("2026-05-31", 540).toISOString()).toBe("2026-05-31T08:00:00.000Z");
    expect(londonLocalToUtc("2026-12-21", 720).toISOString()).toBe("2026-12-21T12:00:00.000Z");
    expect(londonLocalToUtc("2026-03-29", 180).toISOString()).toBe("2026-03-29T02:00:00.000Z");
    expect(londonLocalToUtc("2026-10-25", 90).toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });

  it("accepts calendar dates only", () => {
    expect(["2026-05-31", "2024-02-29"].map(isIsoDate)).toEqual([true, true]);
    expect(["2026-02-29", "2026-5-31", "31/05/2026", ""].map(isIsoDate)).toEqual([false, false, false, false]);
  });

  it("keeps the hour between 06:00 and 22:00 and writes it as a clock", () => {
    expect([clampMinutes(100), clampMinutes(600.4), clampMinutes(2000)]).toEqual([360, 600, 1320]);
    expect([formatMinutes(360), formatMinutes(1305)]).toEqual(["06:00", "21:45"]);
  });

  it("opens each preset at its own hour: the sunny morning at the proof's sun", () => {
    expect(defaultChoice()).toEqual({ preset: "captured", ...PRESET_DEFAULTS.captured });
    const sunny = PRESET_DEFAULTS.sunny;
    const [year, month, day, hour, minute] = vectors.presetsFromProof.sunny_morning.sun ?? [0, 0, 0, 0, 0];
    expect(londonLocalToUtc(sunny.date, sunny.minutes).getTime()).toBe(Date.UTC(year, month - 1, day, hour, minute));
    expect(londonLocalToUtc(PRESET_DEFAULTS.night.date, PRESET_DEFAULTS.night.minutes).toISOString()).toBe("2026-09-29T21:00:00.000Z");
  });

  it("uses the captured light itself, bulbs unboosted, with the neutral display, for the captured choice", () => {
    const light = settingForChoice(inputs(), defaultChoice("captured"));
    expectSetting(light.setting, settingFromVectors(vectors.settings.captured));
    expect([light.setting.emitterBoost, light.sun]).toEqual([1, null]);
    expect(PRESET_DISPLAY.captured).toEqual({ exposure: 1, whiteBalance: [1, 1, 1] });
  });

  it("reproduces the test vectors' night setting at the night preset's hour", () => {
    expectSetting(settingForChoice(inputs(), defaultChoice("night")).setting, settingFromVectors(vectors.settings.night));
  });

  it("reproduces the test vectors' sunny morning, sun and all, at its hour", () => {
    expectSetting(settingForChoice(inputs(), defaultChoice("sunny")).setting, settingFromVectors(vectors.settings.sunny_morning));
  });

  it("has no sky and no sun at night, the lamps lit and their bulbs boosted fourfold", () => {
    const { setting } = settingForChoice(inputs(), defaultChoice("night"));
    expect([setting.skyLevel, setting.sunDir, setting.lampLevels.dome, setting.emitterBoost]).toEqual([0, null, 1, 4]);
  });

  it("dims the sky toward dawn and loses the sun after sunset", () => {
    const nine = settingForChoice(inputs(), defaultChoice("sunny")).setting;
    const six = settingForChoice(inputs(), { ...defaultChoice("sunny"), minutes: 360 }).setting;
    const late = settingForChoice(inputs(), { ...defaultChoice("sunny"), minutes: 1320 }).setting;
    expect(six.skyLevel).toBeLessThan(nine.skyLevel);
    expect(six.sunDir).not.toBeNull();
    expect(late.sunDir).toBeNull();
    expect(late.skyLevel).toBeLessThan(six.skyLevel);
  });

  it("keeps the overcast sky sunless, the lamps off and the bulbs unboosted", () => {
    const { setting } = settingForChoice(inputs(), defaultChoice("overcast"));
    expect(setting.sunDir).toBeNull();
    expect(setting.skyLevel).toBeCloseTo(vectors.presetsFromProof.overcast_noon.sky, 12);
    expect([setting.lampLevels.cove, setting.emitterBoost]).toEqual([0, 1]);
  });

  it("keeps a preset's own display at its own hour", () => {
    expect(adaptDisplay(PRESET_DISPLAY.night, [0.3, 0.2, 0.1], [0.3, 0.2, 0.1])).toEqual(PRESET_DISPLAY.night);
  });

  it("follows half the change in light and 60% of the change in colour", () => {
    const adapted = adaptDisplay({ exposure: 1, whiteBalance: [1, 1, 1] }, [1, 1, 1], [4, 4, 2]);
    const lr = 1, lc = 0.2126 * 4 + 0.7152 * 4 + 0.0722 * 2;
    expect(adapted.exposure).toBeCloseTo(Math.sqrt(lr / lc), 12);
    const channel = (reference: number, current: number): number => ((reference / lr) / (current / lc)) ** 0.6;
    expect(adapted.whiteBalance[0]).toBeCloseTo(channel(1, 4) / channel(1, 4), 12);
    expect(adapted.whiteBalance[2]).toBeCloseTo(channel(1, 2) / channel(1, 4), 12);
    expect(adapted.whiteBalance[1]).toBe(1);
  });

  it("never moves exposure more than eightfold", () => {
    expect(adaptDisplay(PRESET_DISPLAY.sunny, [1, 1, 1], [1e-6, 1e-6, 1e-6]).exposure).toBeCloseTo(PRESET_DISPLAY.sunny.exposure * 8, 12);
  });

  it("honours ?light= only where splats may run", () => {
    expect(lightPresetFromSearch("?light=night", true)).toBe("night");
    expect(lightPresetFromSearch("?light=night", false)).toBeNull();
    expect(lightPresetFromSearch("?light=disco", true)).toBeNull();
  });

  it("honours ?relight=off only where splats may run", () => {
    expect([relightOffBySearch("?relight=off", true), relightOffBySearch("?relight=off", false), relightOffBySearch("", true)]).toEqual([true, false, false]);
  });

  it("relights only previews on desktop-class devices", () => {
    expect([relightEligible(true, "high", false), relightEligible(true, "medium", false), relightEligible(false, "high", false), relightEligible(true, "high", true)])
      .toEqual([true, false, false, false]);
  });
});
```

`packages/web/src/stores/__tests__/light-setting-store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { PRESET_DEFAULTS } from "../../lib/light-setting.js";
import { useLightSettingStore } from "../light-setting-store.js";

const initialState = useLightSettingStore.getState();
beforeEach(() => { useLightSettingStore.setState(initialState, true); });

describe("the light setting store (T-639 R1b)", () => {
  it("starts at the captured light with relighting off", () => {
    expect(useLightSettingStore.getState().choice.preset).toBe("captured");
    expect(useLightSettingStore.getState().status).toBe("off");
  });

  it("opens a preset at its own date and hour", () => {
    useLightSettingStore.getState().selectPreset("sunny");
    expect(useLightSettingStore.getState().choice).toEqual({ preset: "sunny", ...PRESET_DEFAULTS.sunny });
  });

  it("rounds and bounds the hour", () => {
    useLightSettingStore.getState().setMinutes(2000.7);
    expect(useLightSettingStore.getState().choice.minutes).toBe(1320);
  });

  it("ignores a date that is not a calendar date", () => {
    useLightSettingStore.getState().setDate("2026-06-21");
    useLightSettingStore.getState().setDate("2026-02-30");
    expect(useLightSettingStore.getState().choice.date).toBe("2026-06-21");
  });

  it("records the relight status", () => {
    useLightSettingStore.getState().setStatus("loading");
    expect(useLightSettingStore.getState().status).toBe("loading");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/daylight.test.ts`
Expected: FAIL — cannot find module `../daylight.js`.

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/light-setting.test.ts`
Expected: FAIL — cannot find module `../light-setting.js`.

Run: `pnpm --filter @omnitwin/web exec vitest run src/stores/__tests__/light-setting-store.test.ts`
Expected: FAIL — cannot find module `../light-setting-store.js`.

- [ ] **Step 3: Implement daylight** — create `packages/web/src/lib/relight/daylight.ts`:

```ts
import type { Rgb } from "./relight-kernel.js";

/** The capture's daylight was diffuse; its white is taken as 6,500 K (05_relight.T_DAY_CAPTURE). */
export const CAPTURE_DAYLIGHT_CCT = 6500;

/** Linear sRGB (G = 1) of the CIE daylight locus at a correlated colour temperature, 4,000–25,000 K (05_relight.daylight_rgb). */
export function daylightRgb(cct: number): Rgb {
  const x = cct <= 7000
    ? -4.6070e9 / cct ** 3 + 2.9678e6 / cct ** 2 + 0.09911e3 / cct + 0.244063
    : -2.0064e9 / cct ** 3 + 1.9018e6 / cct ** 2 + 0.24748e3 / cct + 0.237040;
  const y = -3 * x * x + 2.87 * x - 0.275;
  const X = x / y, Z = (1 - x - y) / y;
  const r = 3.2406 * X - 1.5372 - 0.4986 * Z;
  const g = -0.9689 * X + 1.8758 + 0.0415 * Z;
  const b = 0.0557 * X - 0.2040 + 1.0570 * Z;
  return [r / g, 1, b / g];
}

/** A colour temperature relative to the capture's daylight, G = 1 (05_relight.cct_shift). */
export function cctShift(cct: number): Rgb {
  const target = daylightRgb(cct), capture = daylightRgb(CAPTURE_DAYLIGHT_CCT);
  const r = target[0] / capture[0], g = target[1] / capture[1], b = target[2] / capture[2];
  return [r / g, g / g, b / g];
}

function smoothstep(low: number, high: number, x: number): number {
  const t = Math.min(Math.max((x - low) / (high - low), 0), 1);
  return t * t * (3 - 2 * t);
}

/** Diffuse sky brightness by solar elevation (degrees), 1 overhead: none below civil twilight, √sin(elevation) from 3° up. */
export function skyFactor(elevation: number): number {
  return smoothstep(-6, 3, elevation) * Math.sqrt(Math.sin(Math.max(elevation, 3) * Math.PI / 180));
}
```

- [ ] **Step 4: Implement the light setting** — create `packages/web/src/lib/light-setting.ts`:

```ts
import type { DeviceTier } from "./device-tier.js";
import { WINDOW_COUNT } from "./relight/relight-codec.js";
import { CAPTURE_DAYLIGHT_CCT, cctShift, skyFactor } from "./relight/daylight.js";
import { NEUTRAL_DISPLAY, type DisplayParams } from "./relight/display.js";
import { LUMINANCE, capturedSetting, type RelightSetting, type Rgb } from "./relight/relight-kernel.js";
import type { ProofScenario, RelightManifest } from "./relight/relight-manifest.js";
import { solarPosition, sunDirection, type SiteFrame, type SolarPosition } from "./sun.js";

/**
 * The light setting (spec §4.3): presets, London time, the relight setting for a
 * choice of preset, date and hour, and the display that goes with it (T-639 R1b).
 */
export const LIGHT_PRESETS = ["captured", "night", "sunny", "overcast"] as const;
export type LightPresetId = (typeof LIGHT_PRESETS)[number];
type WeatherPreset = Exclude<LightPresetId, "captured">;
export const MIN_MINUTES = 360;
export const MAX_MINUTES = 1320;

export interface LightChoice {
  readonly preset: LightPresetId;
  /** London calendar date, YYYY-MM-DD. */
  readonly date: string;
  /** London wall-clock minutes after midnight. */
  readonly minutes: number;
}

/** Each preset's own date and hour (decision 4). The captured light has no hour; its entry is never shown. */
export const PRESET_DEFAULTS: Readonly<Record<LightPresetId, { readonly date: string; readonly minutes: number }>> = {
  captured: { date: "2026-09-29", minutes: 720 },
  night: { date: "2026-09-29", minutes: 1320 },
  sunny: { date: "2026-05-31", minutes: 540 },
  overcast: { date: "2026-05-31", minutes: 780 },
};

/** Each preset's display at its own hour (the proof's work/exposure.json); the captured light's is neutral. */
export const PRESET_DISPLAY: Readonly<Record<LightPresetId, DisplayParams>> = {
  captured: NEUTRAL_DISPLAY,
  night: { exposure: 0.825, whiteBalance: [0.9161, 1, 1.2254] },
  sunny: { exposure: 0.629, whiteBalance: [1.1078, 1, 0.8304] },
  overcast: { exposure: 3.461, whiteBalance: [1.2428, 1, 0.7361] },
};

/** β, the lit bulbs' boost (R1a's emitter boost): 4 at night, 1 otherwise, so the captured light stays exactly neutral. */
export const PRESET_EMITTER_BOOST: Readonly<Record<LightPresetId, number>> = { captured: 1, night: 4, sunny: 1, overcast: 1 };

export function defaultChoice(preset: LightPresetId = "captured"): LightChoice {
  return { preset, ...PRESET_DEFAULTS[preset] };
}

function lastSunday(year: number, monthIndex: number): number {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0));
  return last.getUTCDate() - last.getUTCDay();
}

/** 1 in British Summer Time (01:00 UTC on March's last Sunday to 01:00 UTC on October's), else 0. */
export function londonOffsetHours(utc: Date): number {
  const year = utc.getUTCFullYear();
  const time = utc.getTime();
  return time >= Date.UTC(year, 2, lastSunday(year, 2), 1) && time < Date.UTC(year, 9, lastSunday(year, 9), 1) ? 1 : 0;
}

export function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** London date and wall-clock minute to the instant; in October's repeated hour, the first (summer-time) one. */
export function londonLocalToUtc(date: string, minutes: number): Date {
  if (!isIsoDate(date)) throw new RangeError(`${date} is not a calendar date (YYYY-MM-DD).`);
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  const wall = Date.UTC(year, month - 1, day, 0, minutes);
  const summer = new Date(wall - 3_600_000);
  return londonOffsetHours(summer) === 1 ? summer : new Date(wall);
}

export function clampMinutes(minutes: number): number {
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(Number.isFinite(minutes) ? minutes : MIN_MINUTES)));
}

export function formatMinutes(minutes: number): string {
  const whole = clampMinutes(minutes);
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

/** A weather's sky and sun, anchored to the proof scenario it comes from. */
export interface WeatherModel {
  readonly referenceSky: number;
  readonly referenceElevation: number;
  readonly skyCct: number;
  /** Sun strength per unit sky × mean window weight; 0 for no direct sun. */
  readonly sunRatio: number;
  readonly sunCct: number;
}

type Site = SiteFrame & { readonly latitude: number; readonly longitude: number };

export interface LightInputs {
  /** w[k] × c[k]. */
  readonly captureWeights: readonly Rgb[];
  readonly windowWeights: readonly number[];
  readonly meanWindowWeight: number;
  readonly daylightColour: Rgb;
  readonly site: Site;
  readonly presets: Readonly<Record<WeatherPreset, { readonly weather: WeatherModel; readonly house: number; readonly lampLevel: number }>>;
}

export interface LightParts {
  readonly weights: readonly number[];
  readonly colours: readonly Rgb[];
  readonly daylightColour: Rgb;
  readonly site: Site;
  readonly presets: { readonly night: ProofScenario; readonly sunny_morning: ProofScenario; readonly overcast_noon: ProofScenario };
}

function weatherFrom(scenario: ProofScenario, preset: WeatherPreset, site: Site): WeatherModel {
  const own = PRESET_DEFAULTS[preset];
  return {
    referenceSky: scenario.sky,
    referenceElevation: solarPosition(londonLocalToUtc(own.date, own.minutes), site.latitude, site.longitude).elevation,
    skyCct: scenario.sky_T ?? CAPTURE_DAYLIGHT_CCT,
    sunRatio: scenario.sun === null ? 0 : scenario.sun_ratio ?? 0,
    sunCct: scenario.sun_T ?? CAPTURE_DAYLIGHT_CCT,
  };
}

export function lightInputsFromParts(parts: LightParts): LightInputs {
  const windowWeights = parts.weights.slice(0, WINDOW_COUNT);
  const clear = weatherFrom(parts.presets.sunny_morning, "sunny", parts.site);
  const lamps = (scenario: ProofScenario): { house: number; lampLevel: number } => ({ house: scenario.house, lampLevel: scenario.emit === "lit" ? 1 : 0 });
  return {
    captureWeights: parts.weights.map((weight, k): Rgb => {
      const colour = parts.colours[k] ?? [0, 0, 0];
      return [weight * colour[0], weight * colour[1], weight * colour[2]];
    }),
    windowWeights,
    meanWindowWeight: windowWeights.reduce((sum, value) => sum + value, 0) / WINDOW_COUNT,
    daylightColour: parts.daylightColour,
    site: parts.site,
    presets: {
      night: { weather: clear, ...lamps(parts.presets.night) },
      sunny: { weather: clear, ...lamps(parts.presets.sunny_morning) },
      overcast: { weather: weatherFrom(parts.presets.overcast_noon, "overcast", parts.site), ...lamps(parts.presets.overcast_noon) },
    },
  };
}

export function lightInputsFromManifest(manifest: RelightManifest): LightInputs {
  return lightInputsFromParts({
    weights: manifest.capture.weights, colours: manifest.capture.colours, daylightColour: manifest.capture.daylightColour,
    site: manifest.site, presets: manifest.presetsFromProof,
  });
}

/** A choice's setting and sun; the kernel gates each window by its horizon from the setting's sun direction. */
export interface ChoiceLight {
  readonly setting: RelightSetting;
  readonly sun: SolarPosition | null;
}

export function settingForChoice(inputs: LightInputs, choice: LightChoice): ChoiceLight {
  if (choice.preset === "captured") {
    return { setting: capturedSetting(inputs), sun: null };
  }
  const { weather, house, lampLevel } = inputs.presets[choice.preset];
  const sun = solarPosition(londonLocalToUtc(choice.date, choice.minutes), inputs.site.latitude, inputs.site.longitude);
  const reference = skyFactor(weather.referenceElevation);
  // The ratio first: exactly 1 at the weather's own hour, so the proof's sky level is reproduced exactly.
  const skyLevel = reference > 0 ? weather.referenceSky * (skyFactor(sun.elevation) / reference) : 0;
  const skyShift = cctShift(weather.skyCct), sunShift = cctShift(weather.sunCct);
  const daylight = inputs.daylightColour;
  const skyColour: Rgb = [daylight[0] * skyShift[0], daylight[1] * skyShift[1], daylight[2] * skyShift[2]];
  const sunUp = weather.sunRatio > 0 && sun.elevation > 0;
  const sunStrength = sunUp ? weather.sunRatio * skyLevel * inputs.meanWindowWeight : 0;
  const sunRgb: Rgb = [sunStrength * (daylight[0] * sunShift[0]), sunStrength * (daylight[1] * sunShift[1]), sunStrength * (daylight[2] * sunShift[2])];
  const weights = inputs.captureWeights.map((captured, k): Rgb => {
    if (k >= WINDOW_COUNT) return [house * captured[0], house * captured[1], house * captured[2]];
    const weight = inputs.windowWeights[k] ?? 0;
    return [weight * skyLevel * skyColour[0], weight * skyLevel * skyColour[1], weight * skyLevel * skyColour[2]];
  });
  return {
    setting: {
      weights, skyLevel, skyColour, sunRgb,
      lampLevels: { cove: lampLevel, ch_end: lampLevel, ch_centre: lampLevel, dome: lampLevel },
      emitterBoost: PRESET_EMITTER_BOOST[choice.preset],
      sunDir: sunUp ? sunDirection(sun, inputs.site) : null,
    },
    sun,
  };
}

const luminanceOf = (rgb: Rgb): number => rgb[0] * LUMINANCE[0] + rgb[1] * LUMINANCE[1] + rgb[2] * LUMINANCE[2];

/**
 * A preset's display carried to another hour or date: exposure follows half the
 * change in the floor's mean light (at most eightfold), white balance 60% of the
 * change in its colour (G stays 1). At the preset's own hour it is the preset's.
 */
export function adaptDisplay(preset: DisplayParams, reference: Rgb, current: Rgb): DisplayParams {
  const lr = luminanceOf(reference), lc = luminanceOf(current);
  if (!(lr > 0) || !(lc > 0)) return preset;
  const exposure = preset.exposure * Math.min(Math.max(Math.sqrt(lr / lc), 1 / 8), 8);
  const balance = [0, 1, 2].map((c) => (preset.whiteBalance[c] ?? 1) * (((reference[c] ?? 0) / lr) / Math.max((current[c] ?? 0) / lc, 1e-9)) ** 0.6);
  const green = balance[1] ?? 1;
  return { exposure, whiteBalance: [(balance[0] ?? 1) / green, 1, (balance[2] ?? 1) / green] };
}

export function lightPresetFromSearch(search: string, previewable: boolean): LightPresetId | null {
  if (!previewable) return null;
  const value = new URLSearchParams(search).get("light");
  return LIGHT_PRESETS.find((preset) => preset === value) ?? null;
}

export function relightOffBySearch(search: string, previewable: boolean): boolean {
  return previewable && new URLSearchParams(search).get("relight") === "off";
}

/** Relighting runs on preview builds, desktop-class devices, unless `?relight=off` (WebGPU is checked by the host). */
export function relightEligible(previewable: boolean, deviceTier: DeviceTier, off: boolean): boolean {
  return previewable && deviceTier === "high" && !off;
}
```

- [ ] **Step 5: Implement the store** — create `packages/web/src/stores/light-setting-store.ts`:

```ts
import { create } from "zustand";
import { clampMinutes, defaultChoice, isIsoDate, type LightChoice, type LightPresetId } from "../lib/light-setting.js";

export type RelightStatus = "off" | "loading" | "ready";

export interface LightSettingState {
  readonly choice: LightChoice;
  /** off: the hall is drawn as captured; loading: the package is being read; ready: relit. */
  readonly status: RelightStatus;
  readonly selectPreset: (preset: LightPresetId) => void;
  readonly setMinutes: (minutes: number) => void;
  readonly setDate: (date: string) => void;
  readonly setStatus: (status: RelightStatus) => void;
}

export const useLightSettingStore = create<LightSettingState>()((set) => ({
  choice: defaultChoice(),
  status: "off",
  selectPreset: (preset) => { set({ choice: defaultChoice(preset) }); },
  setMinutes: (minutes) => { set((state) => ({ choice: { ...state.choice, minutes: clampMinutes(minutes) } })); },
  setDate: (date) => { if (isIsoDate(date)) set((state) => ({ choice: { ...state.choice, date } })); },
  setStatus: (status) => { set({ status }); },
}));
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/daylight.test.ts`
Expected: PASS, 10 tests.

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/light-setting.test.ts`
Expected: PASS, 16 tests. If the two fixture tests fail, report which field differs and by how much; the settings in the vectors are R1a's `scenario_light` construction (contract 1), and this module must reproduce them, not the reverse.

Run: `pnpm --filter @omnitwin/web exec vitest run src/stores/__tests__/light-setting-store.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 7: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/relight/daylight.ts packages/web/src/lib/light-setting.ts packages/web/src/stores/light-setting-store.ts packages/web/src/lib/relight/__tests__/daylight.test.ts packages/web/src/lib/__tests__/light-setting.test.ts packages/web/src/stores/__tests__/light-setting-store.test.ts && git diff --cached --stat && git commit -m "feat(relight): the light setting: presets, London time, sky by the sun's height, and its store (T-639 R1b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The `workingColorNode` hook in the patched `GaussianSplat`

**Files:**
- Modify (regenerated): `patches/three@0.186.0.patch`, `pnpm-lock.yaml` (the patch hash)
- Modify: `packages/web/src/lib/native-gaussian-addon.d.ts`
- Modify: `patches/README.three-native-splats.md`
- Test: `packages/web/src/lib/__tests__/native-addon-working-colour.test.ts`

**Interfaces:**
- Produces: the constructor option `workingColorNode?: (index: Node<"uint">, center: Node<"vec3">, rgb: Node<"vec3">) => Node<"vec3">`, applied to each splat's linear working RGB after SH and colour-space decoding and before the quad's alpha; absent (the default `null`), the node graph is exactly today's.

The hook's three anchors (the constructor's option list, the two `createMaterialNodes` option lists, the `splatColor.assign` line) are unchanged by T-640's patch (checked against `claude/perf-20260929`), so the edit applies on either base. If T-640 is already on master when this task runs, run Task 19 Step 1 first so the patch is regenerated on top of it.

- [ ] **Step 1: Write the failing test** — create `packages/web/src/lib/__tests__/native-addon-working-colour.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const source = readFileSync(require.resolve("three/examples/jsm/objects/GaussianSplat.js"), "utf8");

describe("patched GaussianSplat working-colour hook (T-639 R1b)", () => {
  it("accepts a workingColorNode option that defaults to none", () => {
    expect(source).toContain("sphericalHarmonicsDirectionNode = null, workingColorNode = null, colorSpace = NoColorSpace,");
  });

  it("passes it to the material nodes", () => {
    expect(source.split("{ opacityNode, sphericalHarmonicsDirectionNode, workingColorNode, colorSpace, kernelRadius, antialias }")).toHaveLength(3);
  });

  it("maps the linear working colour with it, and leaves the colour as it was without it", () => {
    expect(source).toContain("const workingRgb = colorSpace === NoColorSpace ? displayRgb : colorSpaceToWorking( vec4( displayRgb, 1 ), colorSpace ).rgb;");
    expect(source).toContain("splatColor.assign( vec4( workingColorNode ? workingColorNode( splatIndex, center, workingRgb ) : workingRgb, color.a.mul( alphaScale ) ) );");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/native-addon-working-colour.test.ts`
Expected: FAIL, 3 tests (the installed addon lacks the option).

- [ ] **Step 3: Regenerate the patch with the hook**

```bash
cd D:/claude/real-hall/repo && pnpm patch three@0.186.0 --edit-dir D:/claude/real-hall/three-edit-r1b
```
Then create `D:/claude/real-hall/apply-working-colour.mjs`:

```js
import { readFileSync, writeFileSync } from "node:fs";
const file = "D:/claude/real-hall/three-edit-r1b/examples/jsm/objects/GaussianSplat.js";
let code = readFileSync(file, "utf8");
if (!code.includes("const BIN_COUNT = 65536;") || !code.includes("splitSH3") || !code.includes("antialias = true")) throw new Error("not the production-patched addon");
function once(from, to, all = false) {
  const n = code.split(from).length - 1;
  if (all ? n < 1 : n !== 1) throw new Error(`expected ${all ? ">=1" : "exactly 1"} match, found ${n}: ${from.slice(0, 80)}`);
  code = all ? code.split(from).join(to) : code.replace(from, to);
}
once("sphericalHarmonicsDirectionNode = null, colorSpace = NoColorSpace,",
  "sphericalHarmonicsDirectionNode = null, workingColorNode = null, colorSpace = NoColorSpace,");
once("{ opacityNode, sphericalHarmonicsDirectionNode, colorSpace, kernelRadius, antialias }",
  "{ opacityNode, sphericalHarmonicsDirectionNode, workingColorNode, colorSpace, kernelRadius, antialias }", true);
once("splatColor.assign( vec4( colorSpace === NoColorSpace ? displayRgb : colorSpaceToWorking( vec4( displayRgb, 1 ), colorSpace ).rgb, color.a.mul( alphaScale ) ) );",
  "const workingRgb = colorSpace === NoColorSpace ? displayRgb : colorSpaceToWorking( vec4( displayRgb, 1 ), colorSpace ).rgb;\n"
  + "\t\tsplatColor.assign( vec4( workingColorNode ? workingColorNode( splatIndex, center, workingRgb ) : workingRgb, color.a.mul( alphaScale ) ) );");
writeFileSync(file, code);
console.log("workingColorNode option applied");
```
Run it and commit the patch through pnpm:

```bash
node D:/claude/real-hall/apply-working-colour.mjs && cd D:/claude/real-hall/repo && pnpm patch-commit D:/claude/real-hall/three-edit-r1b && git diff --stat patches/three@0.186.0.patch pnpm-lock.yaml
```
Expected: `workingColorNode option applied`; pnpm rewrites the patch (a few lines) and the lockfile's patch hash, and reinstalls.

- [ ] **Step 4: Declare the option** — in `packages/web/src/lib/native-gaussian-addon.d.ts`, inside `interface GaussianSplatOptions`, directly after the `sphericalHarmonicsDirectionNode?: …;` line, add:

```ts
    /** Maps each splat's linear working RGB after SH and colour-space decoding (the
     *  relit hall's multiplier and display, T-639 R1b). Absent: today's output. */
    workingColorNode?: (index: Node<"uint">, center: Node<"vec3">, rgb: Node<"vec3">) => Node<"vec3">;
```

- [ ] **Step 5: Document it** — in `patches/README.three-native-splats.md`, directly after the `sphericalHarmonicsDirectionNode` bullet (the line ending `**center minus camera** direction into the source's SH basis after merging.`), add:

```markdown
- `workingColorNode(index, center, rgb)`: TSL map of each splat's linear working
  RGB after SH and colour-space decoding, before the quad's alpha. Venviewer's
  relit hall multiplies by the per-splat relight multiplier and applies its
  display there (T-639 R1b). Absent, the node graph is exactly as before.
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/native-addon-working-colour.test.ts`
Expected: PASS, 3 tests.

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/native-addon-antialias.test.ts`
Expected: PASS, 2 tests.

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/native-splat-scene.test.ts`
Expected: PASS (unchanged count from Task 0).

Run: `cd D:/claude/real-hall/repo && pnpm --filter @omnitwin/web typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
cd D:/claude/real-hall/repo && git add patches/three@0.186.0.patch pnpm-lock.yaml patches/README.three-native-splats.md packages/web/src/lib/native-gaussian-addon.d.ts packages/web/src/lib/__tests__/native-addon-working-colour.test.ts && git diff --cached --stat && git commit -m "feat(splats): an optional working-colour hook in the patched GaussianSplat (T-639 R1b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The relight frame: one package's GPU resources and the light applied to them

**Files:**
- Create: `packages/web/src/lib/relight/relight-frame.ts`
- Create: `packages/web/src/lib/relight/relight-apply.ts`
- Test: `packages/web/src/lib/relight/__tests__/relight-frame.test.ts`, `packages/web/src/lib/relight/__tests__/relight-apply.test.ts`

**Interfaces:**
- Consumes: Tasks 4, 5, 7, 8.
- Produces (`relight-frame.ts`): `matrixFromRowMajor(values: readonly number[]): Matrix4`; `interface RelightApplication { readonly setting: RelightSetting; readonly display: DisplayParams; readonly sun: SolarPosition | null }`; `kernelModelFromData(data: RelightModelData): RelightKernelModel` (with the manifest's horizons and site); `type RelightUniforms` (fields `values.sourceWeights: Vector3[]`, `values.windowOpen: number[]`, `sourceWeights`, `captureWeights` (uniform arrays of vec3), `ranges` (vec2 × 9), `windowOpen` (float × 5: the kernel's horizon gates), `values.sunBounce: number[]` and `sunBounce` (float × 5: the sun's gated bounce weight per window while the sun is in), `sunDir`, `sunRgb`, `rBack` (vec3), `sunOn`, `fresnelAtSun`, `emitterBoost` (float), `lampLevels` (vec4: cove, ch_end, ch_centre, dome), `display: DisplayUniforms` (exposure, white balance), `sky: SkyUniforms`, `planeOrigin`, `planeU`, `planeV`, `planeNormal` (vec3 × 10), `planeSize` (vec2 × 10), `atlasRect` (vec4 × 10), `probeOrigin` (vec3), `probeSpacing` (float), `probeShape` (vec3), `tileToModel` (mat4), `modelToLightUv` (mat4)); `class RelightFrame` with `constructor(data: RelightModelData)`, readonly `data`, `model`, `inputs: LightInputs`, `floor: FloorLightData`, `probeCount`, `probeRaw: StorageBufferAttribute` (the binary16 probe volume as `u32` pairs), `probeCapture: StorageBufferAttribute` (stride 19), `probeScenario: StorageBufferAttribute` (stride 18, written on the GPU), `stencilAtlas: DataTexture` (R8, linear), `floorLight: DataTexture` (RGBA half float, linear), `uniforms: RelightUniforms`, `tileToModel: Matrix4`; mutable `current: RelightApplication | null`, `kernelFrame: KernelFrame | null`, `lastApplyMs: number | null`; methods `apply(application: RelightApplication): void`, `prepare(renderer: WebGPURenderer): void` (runs the probe fold pass once after each `apply`), `meanLight(light: ChoiceLight): Rgb`, `onApply(listener: () => void): () => void`, `dispose(): void`.
- Produces (`relight-apply.ts`): `applicationForChoice(inputs: LightInputs, choice: LightChoice, meanLight: (light: ChoiceLight) => Rgb): RelightApplication`.

Plane index `i` in the plane arrays is stencil `i` of the package (W1 inner, W1 glass, …, W5 glass), the order of `RelightModelData.stencils` and the atlas rectangles. `apply` prepares the kernel frame (which computes the five horizon gates), sets the uniforms from it, rewrites the floor's base light texture (about 135,000 texels) and marks the probe fold; it never touches a splat. The scenario volume is folded on the GPU by `prepare`, one invocation per probe value over nine sources. The volume is small (R1a's coarse 0.5 m grid, about 13,000 probes and 4 MB, its size taken only from the manifest's `probes.shape`); the GPU does the fold for simplicity. The half floats go up as they arrive, the fold is the same formula as `foldProbeCube`, and the multiplier pass reads the folded volume with no CPU copy to keep in step. Draws call `prepare` before their own pass and rerun through `onApply` (Task 15).

- [ ] **Step 1: Write the failing tests**

`packages/web/src/lib/relight/__tests__/relight-frame.test.ts`:

```ts
import { DataUtils } from "three";
import { WebGPURenderer } from "three/webgpu";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PRESET_DISPLAY, defaultChoice, settingForChoice } from "../../light-setting.js";
import { texelBaseLight } from "../floor-light.js";
import { loadRelightModelData, type RelightModelData } from "../relight-assets.js";
import { RelightFrame, kernelModelFromData, matrixFromRowMajor, type RelightApplication } from "../relight-frame.js";
import { PROBE_FOLDED, PROBE_VALUES } from "../relight-kernel.js";
import { buildTestPackage } from "./relight-test-package.js";

let data: RelightModelData;
beforeAll(async () => {
  const pkg = buildTestPackage();
  data = await loadRelightModelData(pkg.fetch, pkg.manifestUrl);
});

function application(frame: RelightFrame, preset: "captured" | "night" | "sunny"): RelightApplication {
  return { ...settingForChoice(frame.inputs, defaultChoice(preset)), display: PRESET_DISPLAY[preset] };
}

describe("the relight frame (T-639 R1b)", () => {
  it("reads the package's windows, horizons and site into the kernel's model, in window order", () => {
    const model = kernelModelFromData(data);
    expect(model.windows).toHaveLength(5);
    expect(model.windows[1]?.glass.origin).toEqual([2, -0.5, 2]);
    expect(model.windows[4]?.inner.stencil.width).toBe(4);
    expect([model.horizons.length, model.horizons[0]?.length, model.site.up]).toEqual([5, 360, [0, 0, 1]]);
    expect(matrixFromRowMajor([1, 0, 0, 5, 0, 1, 0, 6, 0, 0, 1, 7, 0, 0, 0, 1]).elements.slice(12, 15)).toEqual([5, 6, 7]);
  });

  it("keeps the probe volume on the GPU as half-float pairs and folds it there once per light change", () => {
    const frame = new RelightFrame(data);
    expect(frame.probeRaw.array).toHaveLength(frame.probeCount * PROBE_VALUES / 2);
    expect(frame.probeScenario.array).toHaveLength(frame.probeCount * PROBE_FOLDED);
    const renderer = new WebGPURenderer({ forceWebGL: true });
    const compute = vi.spyOn(renderer, "compute").mockImplementation(() => undefined);
    frame.prepare(renderer);
    frame.prepare(renderer);
    expect(compute).toHaveBeenCalledOnce();
    frame.apply(application(frame, "night"));
    frame.prepare(renderer);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("sets the light's uniforms for the sunny morning, the horizon gates from the kernel", () => {
    const frame = new RelightFrame(data);
    frame.apply(application(frame, "sunny"));
    const u = frame.uniforms;
    expect(u.sunOn.value).toBe(1);
    expect(u.lampLevels.value.toArray()).toEqual([0, 0, 0, 0]);
    expect([u.display.exposure.value, u.emitterBoost.value]).toEqual([0.629, 1]);
    expect(u.sky.level.value).toBeCloseTo(0.7, 12);
    expect(u.values.windowOpen).toEqual(frame.kernelFrame?.windowOpen);
    expect(u.values.windowOpen).toEqual([1, 1, 1, 1, 1]);
    expect(u.values.sunBounce.some((value) => value > 0)).toBe(true);
    frame.apply(application(frame, "night"));
    expect(u.emitterBoost.value).toBe(4);
  });

  it("writes the floor's base light as half floats, alpha 1", () => {
    const frame = new RelightFrame(data);
    frame.apply(application(frame, "captured"));
    const halves = frame.floorLight.image.data;
    const kernelFrame = frame.kernelFrame;
    if (!(halves instanceof Uint16Array) || kernelFrame === null) throw new Error("The floor light is half float once applied.");
    expect(halves[3]).toBe(DataUtils.toHalfFloat(1));
    expect(halves[0]).toBe(DataUtils.toHalfFloat(texelBaseLight(frame.floor, 0, kernelFrame)[0]));
  });

  it("tells its listeners and times each apply", () => {
    const frame = new RelightFrame(data);
    const listener = vi.fn();
    const stop = frame.onApply(listener);
    const night = application(frame, "night");
    frame.apply(night);
    expect(listener).toHaveBeenCalledOnce();
    expect(frame.current).toBe(night);
    expect(frame.lastApplyMs).toBeGreaterThanOrEqual(0);
    stop();
    frame.apply(night);
    expect(listener).toHaveBeenCalledOnce();
  });
});
```

`packages/web/src/lib/relight/__tests__/relight-apply.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { PRESET_DISPLAY, defaultChoice, lightInputsFromManifest, type ChoiceLight } from "../../light-setting.js";
import { applicationForChoice } from "../relight-apply.js";
import { RelightManifestSchema } from "../relight-manifest.js";
import type { Rgb } from "../relight-kernel.js";
import { buildTestPackage } from "./relight-test-package.js";

const inputs = lightInputsFromManifest(RelightManifestSchema.parse(buildTestPackage().manifest));

describe("a light choice applied (T-639 R1b)", () => {
  it("draws the captured light with the neutral display", () => {
    const meanLight = vi.fn((): Rgb => [1, 1, 1]);
    const applied = applicationForChoice(inputs, defaultChoice("captured"), meanLight);
    expect(applied.display).toEqual({ exposure: 1, whiteBalance: [1, 1, 1] });
    expect(applied.setting.emitterBoost).toBe(1);
    expect(meanLight).not.toHaveBeenCalled();
  });

  it("keeps a preset's own display at its own hour without measuring the floor", () => {
    const meanLight = vi.fn((): Rgb => [1, 1, 1]);
    expect(applicationForChoice(inputs, defaultChoice("night"), meanLight).display).toEqual(PRESET_DISPLAY.night);
    expect(meanLight).not.toHaveBeenCalled();
  });

  it("carries the display to another hour by the floor's light", () => {
    const meanLight = vi.fn((light: ChoiceLight): Rgb => (light.setting.skyLevel > 0.5 ? [1, 1, 1] : [0.25, 0.25, 0.25]));
    const applied = applicationForChoice(inputs, { ...defaultChoice("sunny"), minutes: 360 }, meanLight);
    expect(meanLight).toHaveBeenCalledTimes(2);
    expect(applied.display.exposure).toBeCloseTo(PRESET_DISPLAY.sunny.exposure * 2, 12);
    expect(applied.sun?.elevation).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/relight-frame.test.ts`
Expected: FAIL — cannot find module `../relight-frame.js`.

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/relight-apply.test.ts`
Expected: FAIL — cannot find module `../relight-apply.js`.

- [ ] **Step 3: Implement the frame** — create `packages/web/src/lib/relight/relight-frame.ts`:

```ts
import { ClampToEdgeWrapping, DataTexture, DataUtils, HalfFloatType, LinearFilter, Matrix4, RGBAFormat, RedFormat, UnsignedByteType, Vector2, Vector3, Vector4 } from "three";
import { StorageBufferAttribute, type ComputeNode, type Node, type WebGPURenderer } from "three/webgpu";
import { Fn, If, Return, float, instanceIndex, select, storage, uint, uniform, uniformArray, unpackHalf2x16 } from "three/tsl";
import { lightInputsFromManifest, type ChoiceLight, type LightInputs } from "../light-setting.js";
import type { SolarPosition } from "../sun.js";
import type { DisplayParams, DisplayUniforms, SkyUniforms } from "./display.js";
import { floorBaseLight, modelToLightUvMatrix, roomLight, type FloorLightData } from "./floor-light.js";
import { captureWeightsOf, denseProbeField, type RelightModelData } from "./relight-assets.js";
import { SOURCE_COUNT, WINDOW_COUNT } from "./relight-codec.js";
import {
  PROBE_FOLDED, PROBE_VALUES, prepareKernelFrame,
  type KernelFrame, type RelightKernelModel, type RelightSetting, type Rgb, type StencilPlane,
} from "./relight-kernel.js";
import type { RelightManifest } from "./relight-manifest.js";

/** A manifest's row-major 4 × 4 as a three.js matrix (Matrix4.set takes rows). */
export function matrixFromRowMajor(values: readonly number[]): Matrix4 {
  if (values.length !== 16) throw new Error("A 4 × 4 matrix has 16 values.");
  const v = (index: number): number => values[index] ?? 0;
  return new Matrix4().set(v(0), v(1), v(2), v(3), v(4), v(5), v(6), v(7), v(8), v(9), v(10), v(11), v(12), v(13), v(14), v(15));
}

/** A light choice resolved: the kernel's setting (the kernel derives the horizon gates from it) and the display. */
export interface RelightApplication {
  readonly setting: RelightSetting;
  readonly display: DisplayParams;
  readonly sun: SolarPosition | null;
}

type ManifestPlane = RelightManifest["windows"][number]["planes"]["inner"];

export function kernelModelFromData(data: RelightModelData): RelightKernelModel {
  const manifest = data.manifest;
  const plane = (value: ManifestPlane, index: number): StencilPlane => {
    const image = data.stencils[index];
    if (image === undefined) throw new Error("The relight package lacks a window stencil.");
    return {
      origin: value.origin, u: value.u, v: value.v, width: value.width, height: value.height, normal: value.normal,
      stencil: { width: image.width, height: image.height, data: image.data },
    };
  };
  return {
    ranges: manifest.encoding.sources,
    captureWeights: captureWeightsOf(manifest),
    daylightColour: manifest.capture.daylightColour,
    probes: denseProbeField(manifest, data.probes, data.probeValid),
    windows: manifest.windows.map((window, w) => ({ inner: plane(window.planes.inner, 2 * w), glass: plane(window.planes.glass, 2 * w + 1) })),
    horizons: manifest.windows.map((window) => window.horizon),
    site: manifest.site,
    fresnel: manifest.sun.fresnel,
    sunBeta: manifest.sun.bounce.beta,
    skyFlux: manifest.sun.bounce.skyFlux,
  };
}

function prepared(texture: DataTexture): DataTexture {
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

function createRelightUniforms(data: RelightModelData) {
  const manifest = data.manifest;
  const planes = manifest.windows.flatMap((window) => [window.planes.inner, window.planes.glass]);
  const rects = data.atlas.rects;
  const [nx, ny, nz] = manifest.probes.shape;
  const [width, height] = manifest.floor.size;
  const sourceWeights = Array.from({ length: SOURCE_COUNT }, () => new Vector3());
  const windowOpen = Array.from({ length: WINDOW_COUNT }, () => 1);
  const sunBounce = Array.from({ length: WINDOW_COUNT }, () => 0);
  const vectors = (pick: (plane: ManifestPlane) => readonly [number, number, number]) => uniformArray<"vec3">(planes.map((plane) => new Vector3(...pick(plane))), "vec3");
  return {
    /** The arrays behind three uniform arrays, written in place by apply. */
    values: { sourceWeights, windowOpen, sunBounce },
    sourceWeights: uniformArray<"vec3">(sourceWeights, "vec3"),
    captureWeights: uniformArray<"vec3">(captureWeightsOf(manifest).map(([r, g, b]) => new Vector3(r, g, b)), "vec3"),
    ranges: uniformArray<"vec2">(manifest.encoding.sources.map(([lo, hi]) => new Vector2(lo, hi)), "vec2"),
    windowOpen: uniformArray<"float">(windowOpen, "float"),
    sunBounce: uniformArray<"float">(sunBounce, "float"),
    sunDir: uniform(new Vector3(0, 0, 1)),
    sunRgb: uniform(new Vector3()),
    sunOn: uniform(0),
    fresnelAtSun: uniform(0),
    emitterBoost: uniform(1),
    rBack: uniform(new Vector3(1, 1, 1)),
    lampLevels: uniform(new Vector4(1, 1, 1, 1)),
    display: { exposure: uniform(1), whiteBalance: uniform(new Vector3(1, 1, 1)) } satisfies DisplayUniforms,
    sky: { level: uniform(1), colour: uniform(new Vector3(...manifest.capture.daylightColour)) } satisfies SkyUniforms,
    planeOrigin: vectors((plane) => plane.origin),
    planeU: vectors((plane) => plane.u),
    planeV: vectors((plane) => plane.v),
    planeNormal: vectors((plane) => plane.normal),
    planeSize: uniformArray<"vec2">(planes.map((plane) => new Vector2(plane.width, plane.height)), "vec2"),
    atlasRect: uniformArray<"vec4">(planes.map((_plane, i) => new Vector4(rects[i * 4] ?? 0, rects[i * 4 + 1] ?? 0, rects[i * 4 + 2] ?? 1, rects[i * 4 + 3] ?? 1)), "vec4"),
    probeOrigin: uniform(new Vector3(...manifest.probes.origin)),
    probeSpacing: uniform(manifest.probes.spacing),
    probeShape: uniform(new Vector3(nx, ny, nz)),
    tileToModel: uniform(matrixFromRowMajor(manifest.model.tileToModel)),
    modelToLightUv: uniform(modelToLightUvMatrix(manifest.floor.texelToModel, width, height)),
  };
}
export type RelightUniforms = ReturnType<typeof createRelightUniforms>;

/**
 * The scenario probe volume on the GPU: out[p][c][f] = Σk (s[k][c] + [k < 5] sunRgb[c] b[k]) cube[p][k][c][f],
 * foldProbeCube's formula, one invocation per probe value. Halves are read two to a word, little-endian.
 */
function createFoldPass(raw: StorageBufferAttribute, scenario: StorageBufferAttribute, probeCount: number, u: RelightUniforms): ComputeNode {
  const total = probeCount * PROBE_FOLDED;
  const rawRead = storage(raw, "uint", probeCount * (PROBE_VALUES / 2)).toReadOnly();
  const scenarioWrite = storage(scenario, "float", total);
  return Fn(() => {
    const i = instanceIndex;
    If(i.greaterThanEqual(uint(total)), () => { Return(); });
    const probe = i.div(PROBE_FOLDED).toVar(), value = i.mod(PROBE_FOLDED).toVar();
    const channel = value.div(6).toVar();
    const sum = float(0).toVar();
    const pick = (x: Node<"float">, y: Node<"float">, z: Node<"float">): Node<"float"> => select(channel.equal(0), x, select(channel.equal(1), y, z));
    for (let k = 0; k < SOURCE_COUNT; k += 1) {
      const index = probe.mul(PROBE_VALUES).add(k * PROBE_FOLDED).add(value).toVar();
      const pair = unpackHalf2x16(rawRead.element(index.shiftRight(1)));
      const cube = select(index.bitAnd(1).equal(0), pair.x, pair.y);
      const weight = u.sourceWeights.element(k);
      const own = pick(weight.x, weight.y, weight.z);
      const factor = k < WINDOW_COUNT ? own.add(pick(u.sunRgb.x, u.sunRgb.y, u.sunRgb.z).mul(u.sunBounce.element(k))) : own;
      sum.addAssign(factor.mul(cube));
    }
    scenarioWrite.element(i).assign(sum);
  })().compute(total, [256]).setName("RelightProbeFold");
}

/**
 * One relight package on the GPU (spec §4.3): the probe volumes, the stencil
 * atlas, the floor's light and every uniform the multiplier pass, the floor and
 * the sky panels read. `apply` changes the light; splats are never touched here.
 */
export class RelightFrame {
  readonly data: RelightModelData;
  readonly model: RelightKernelModel;
  readonly inputs: LightInputs;
  readonly floor: FloorLightData;
  readonly probeCount: number;
  readonly probeRaw: StorageBufferAttribute;
  readonly probeCapture: StorageBufferAttribute;
  readonly probeScenario: StorageBufferAttribute;
  readonly stencilAtlas: DataTexture;
  readonly floorLight: DataTexture;
  readonly uniforms: RelightUniforms;
  readonly tileToModel: Matrix4;
  current: RelightApplication | null = null;
  kernelFrame: KernelFrame | null = null;
  lastApplyMs: number | null = null;
  private readonly foldPass: ComputeNode;
  private foldDirty = true;
  private readonly floorHalves: Uint16Array;
  private readonly listeners = new Set<() => void>();

  constructor(data: RelightModelData) {
    const [width, height] = data.manifest.floor.size;
    this.data = data;
    this.model = kernelModelFromData(data);
    this.inputs = lightInputsFromManifest(data.manifest);
    this.floor = { width, height, direct: data.floorDirect, bounce: data.floorBounce, texelToModel: data.manifest.floor.texelToModel };
    this.probeCount = data.probeCount;
    this.probeRaw = new StorageBufferAttribute(new Uint32Array(data.probes.buffer, data.probes.byteOffset, data.probes.length / 2), 1);
    this.probeCapture = new StorageBufferAttribute(data.probeCapture, 1);
    this.probeScenario = new StorageBufferAttribute(new Float32Array(data.probeCount * PROBE_FOLDED), 1);
    this.stencilAtlas = prepared(new DataTexture(data.atlas.data, data.atlas.width, data.atlas.height, RedFormat, UnsignedByteType));
    this.floorHalves = new Uint16Array(width * height * 4);
    this.floorLight = prepared(new DataTexture(this.floorHalves, width, height, RGBAFormat, HalfFloatType));
    this.uniforms = createRelightUniforms(data);
    this.foldPass = createFoldPass(this.probeRaw, this.probeScenario, data.probeCount, this.uniforms);
    this.tileToModel = matrixFromRowMajor(data.manifest.model.tileToModel);
  }

  apply(application: RelightApplication): void {
    const started = performance.now();
    const { setting, display } = application;
    const frame = prepareKernelFrame(this.model, setting);
    const rgba = floorBaseLight(this.floor, frame);
    for (let index = 0; index < rgba.length; index += 1) this.floorHalves[index] = DataUtils.toHalfFloat(rgba[index] ?? 0);
    this.floorLight.needsUpdate = true;
    const u = this.uniforms;
    setting.weights.forEach((weight, k) => { u.values.sourceWeights[k]?.set(weight[0], weight[1], weight[2]); });
    // The kernel's horizon gates, so the GPU pass and the floor use exactly the CPU's.
    frame.windowOpen.forEach((open, w) => { u.values.windowOpen[w] = open; });
    frame.bounceWeights.forEach((weight, w) => { u.values.sunBounce[w] = frame.sunOn ? weight : 0; });
    this.foldDirty = true;
    if (setting.sunDir !== null) u.sunDir.value.set(setting.sunDir[0], setting.sunDir[1], setting.sunDir[2]);
    u.sunOn.value = frame.sunOn ? 1 : 0;
    u.sunRgb.value.set(setting.sunRgb[0], setting.sunRgb[1], setting.sunRgb[2]);
    u.fresnelAtSun.value = frame.fresnelAtSun;
    u.emitterBoost.value = setting.emitterBoost;
    u.rBack.value.set(frame.rBack[0], frame.rBack[1], frame.rBack[2]);
    u.lampLevels.value.set(setting.lampLevels.cove, setting.lampLevels.ch_end, setting.lampLevels.ch_centre, setting.lampLevels.dome);
    u.display.exposure.value = display.exposure;
    u.display.whiteBalance.value.set(display.whiteBalance[0], display.whiteBalance[1], display.whiteBalance[2]);
    u.sky.level.value = setting.skyLevel;
    u.sky.colour.value.set(setting.skyColour[0], setting.skyColour[1], setting.skyColour[2]);
    this.current = application;
    this.kernelFrame = frame;
    this.lastApplyMs = performance.now() - started;
    for (const listener of this.listeners) listener();
  }

  /** Folds the scenario probe volume on the GPU once after each apply; every draw calls it before its pass. */
  prepare(renderer: WebGPURenderer): void {
    if (!this.foldDirty) return;
    this.foldDirty = false;
    void renderer.compute(this.foldPass);
  }

  /** The floor's mean light under a choice's light: what the display adapts to. */
  meanLight(light: ChoiceLight): Rgb {
    return roomLight(this.floor, this.model, prepareKernelFrame(this.model, light.setting));
  }

  onApply(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  dispose(): void {
    this.listeners.clear();
    this.foldPass.dispose();
    this.stencilAtlas.dispose();
    this.floorLight.dispose();
    this.probeRaw.dispose();
    this.probeCapture.dispose();
    this.probeScenario.dispose();
  }
}
```

- [ ] **Step 4: Implement the application** — create `packages/web/src/lib/relight/relight-apply.ts`:

```ts
import { PRESET_DEFAULTS, PRESET_DISPLAY, adaptDisplay, settingForChoice, type ChoiceLight, type LightChoice, type LightInputs } from "../light-setting.js";
import type { RelightApplication } from "./relight-frame.js";
import type { Rgb } from "./relight-kernel.js";

/**
 * A light choice resolved for the frame (decision 4): the setting for its date
 * and hour, and the preset's display — exactly the preset's at its own hour
 * (neutral for the captured light), otherwise adapted to the floor's light.
 */
export function applicationForChoice(inputs: LightInputs, choice: LightChoice, meanLight: (light: ChoiceLight) => Rgb): RelightApplication {
  const light = settingForChoice(inputs, choice);
  const display = PRESET_DISPLAY[choice.preset];
  const own = PRESET_DEFAULTS[choice.preset];
  if (choice.preset === "captured" || (choice.date === own.date && choice.minutes === own.minutes)) {
    return { setting: light.setting, sun: light.sun, display };
  }
  const reference = settingForChoice(inputs, { ...choice, date: own.date, minutes: own.minutes });
  return { setting: light.setting, sun: light.sun, display: adaptDisplay(display, meanLight(reference), meanLight(light)) };
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/relight-frame.test.ts`
Expected: PASS, 5 tests.

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/relight-apply.test.ts`
Expected: PASS, 3 tests.

Run: `cd D:/claude/real-hall/repo && pnpm --filter @omnitwin/web typecheck`
Expected: exit 0 (annotation-only changes allowed, Global Constraints).

- [ ] **Step 6: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/relight/relight-frame.ts packages/web/src/lib/relight/relight-apply.ts packages/web/src/lib/relight/__tests__/relight-frame.test.ts packages/web/src/lib/relight/__tests__/relight-apply.test.ts && git diff --cached --stat && git commit -m "feat(relight): one package's GPU resources, and a light choice applied to them (T-639 R1b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The multiplier pass and the render hooks of one draw

**Files:**
- Create: `packages/web/src/lib/relight/relight-draw.ts`
- Test: `packages/web/src/lib/relight/__tests__/relight-draw.test.ts`

**Interfaces:**
- Consumes: Task 1 (`RECORD_BYTES`, `packMultiplierWord`, `LOG_STEPS`), Task 5 (`PROBE_CAPTURE_STRIDE`), Task 4 (`PROBE_FOLDED`, `LUMINANCE`), Task 7 (`displayNode`, `splatKneeNode`), Task 10 (`RelightFrame`, its `emitterBoost` and `windowOpen` uniforms).
- Produces: `PASSTHROUGH_FLAGS = 0xff`; `PASSTHROUGH_WORD = packMultiplierWord([1, 1, 1], 1)`; `mergeRelightRecords(sources: readonly { readonly count: number; readonly records: Uint8Array | null }[]): Uint32Array` (three words per splat, little-endian record bytes; a source without records, or with a record count other than its splat count, is passed through); `sharedPlacement(matrices: readonly Matrix4[]): Matrix4 | null`; `interface RelightHooks { alpha(index: Node<"uint">): Node<"float">; workingColour(index: Node<"uint">, center: Node<"vec3">, rgb: Node<"vec3">): Node<"vec3"> }`; `interface RelightDraw { readonly count: number; readonly recordsAttribute: StorageBufferAttribute; readonly wordsAttribute: StorageBufferAttribute; readonly positions: Float32Array; readonly colours: Uint32Array; readonly sceneToModel: Matrix4; readonly hooks: RelightHooks; setSourceRecords(offset: number, count: number, records: Uint8Array | null): void; run(renderer: WebGPURenderer): void; dispose(): void }`; `createRelightDraw(frame: RelightFrame, geometry: BufferGeometry, records: Uint32Array, sceneToModel: Matrix4): RelightDraw`.

The pass is `relightSplat` (Task 4) in TSL, one invocation per splat of the snapshot, writing one `u32` word (contract packing). Positions are the merged scene-frame centres (`native-splat-merge.ts` applies each source's matrix), taken to the model frame by `sceneToModel = tileToModel × placement⁻¹`; colours are the merged sRGB bytes, linearised as the proof's `C`. The two probe volumes are folded, so bounce light costs two 18-value lookups per corner, evaluated at the splat's normal and accumulated per corner (`cubeEval` is linear, so this equals evaluating the interpolated cube). The stencils are read with `textureLoad` at the nearest cell, rounding halves to even like the CPU. Each window's horizon gate is the `windowOpen` uniform the frame copied from the CPU kernel's `horizonGates`, so the GPU applies exactly the CPU's gate. Lit bulbs use the `emitterBoost` uniform. The pass binds six storage buffers (records, positions, colours, the two probe volumes, words); the render hooks read only the words, and the working-colour hook calls `displayNode` with `splatKneeNode` of the splat's captured colour (the hook's `rgb`, before the multiplier). The pass runs on a setting change, a snapshot build and late records — never per frame.

- [ ] **Step 1: Write the failing test** — create `packages/web/src/lib/relight/__tests__/relight-draw.test.ts`:

```ts
import { BufferAttribute, BufferGeometry, Matrix4 } from "three";
import { WebGPURenderer } from "three/webgpu";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RECORD_BYTES, unpackMultiplierWord } from "../relight-codec.js";
import { loadRelightModelData, type RelightModelData } from "../relight-assets.js";
import { PASSTHROUGH_FLAGS, PASSTHROUGH_WORD, createRelightDraw, mergeRelightRecords, sharedPlacement } from "../relight-draw.js";
import { RelightFrame } from "../relight-frame.js";
import { buildTestPackage } from "./relight-test-package.js";

let data: RelightModelData;
let frame: RelightFrame;
beforeAll(async () => {
  const pkg = buildTestPackage();
  data = await loadRelightModelData(pkg.fetch, pkg.manifestUrl);
});
beforeEach(() => { frame = new RelightFrame(data); });

function geometry(count: number): BufferGeometry {
  const result = new BufferGeometry();
  result.setAttribute("position", new BufferAttribute(new Float32Array(count * 3), 3));
  result.setAttribute("color", new BufferAttribute(new Uint8Array(count * 4).fill(200), 4, true));
  return result;
}

describe("one relit draw (T-639 R1b)", () => {
  it("merges each source's records in snapshot order and passes through a source without them", () => {
    const records = Uint8Array.from({ length: 2 * RECORD_BYTES }, (_, index) => index + 1);
    const words = mergeRelightRecords([{ count: 2, records }, { count: 1, records: null }, { count: 1, records: new Uint8Array(RECORD_BYTES * 2) }]);
    expect(words).toHaveLength(4 * 3);
    expect(words[0]).toBe(0x04030201);
    expect(words[5]).toBe(0x18171615);
    expect([(words[8] ?? 0) >>> 24, (words[11] ?? 0) >>> 24]).toEqual([PASSTHROUGH_FLAGS, PASSTHROUGH_FLAGS]);
  });

  it("passes a splat through at a multiplier of one, within 1/20 of a stop, fully opaque", () => {
    const { m, alpha } = unpackMultiplierWord(PASSTHROUGH_WORD);
    for (const value of m) expect(Math.abs(Math.log2(value))).toBeLessThanOrEqual(0.05);
    expect(alpha).toBe(1);
  });

  it("finds the one placement all of a draw's sources share, or none", () => {
    const placed = new Matrix4().makeTranslation(1, 2, 3);
    expect(sharedPlacement([placed, placed.clone()])?.equals(placed)).toBe(true);
    expect(sharedPlacement([placed, new Matrix4()])).toBeNull();
    expect(sharedPlacement([])).toBeNull();
  });

  it("starts every splat passed through; a run folds the probes once per light change, then runs its pass", () => {
    const draw = createRelightDraw(frame, geometry(3), mergeRelightRecords([{ count: 3, records: null }]), new Matrix4());
    expect(Array.from(draw.wordsAttribute.array)).toEqual([PASSTHROUGH_WORD, PASSTHROUGH_WORD, PASSTHROUGH_WORD]);
    expect([typeof draw.hooks.alpha, typeof draw.hooks.workingColour]).toEqual(["function", "function"]);
    const renderer = new WebGPURenderer({ forceWebGL: true });
    const compute = vi.spyOn(renderer, "compute").mockImplementation(() => undefined);
    draw.run(renderer);
    expect(compute).toHaveBeenCalledTimes(2);
    draw.run(renderer);
    expect(compute).toHaveBeenCalledTimes(3);
    draw.dispose();
  });

  it("writes late records into place and uploads only their range", () => {
    const draw = createRelightDraw(frame, geometry(3), mergeRelightRecords([{ count: 1, records: null }, { count: 2, records: null }]), new Matrix4());
    const records = Uint8Array.from({ length: 2 * RECORD_BYTES }, (_, index) => index);
    draw.setSourceRecords(1, 2, records);
    expect(draw.recordsAttribute.array[3]).toBe(0x03020100);
    expect(draw.recordsAttribute.updateRanges).toEqual([{ start: 3, count: 6 }]);
    draw.setSourceRecords(1, 2, null);
    expect(((draw.recordsAttribute.array[5] ?? 0) >>> 24)).toBe(PASSTHROUGH_FLAGS);
    draw.dispose();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/relight-draw.test.ts`
Expected: FAIL — cannot find module `../relight-draw.js`.

- [ ] **Step 3: Implement** — create `packages/web/src/lib/relight/relight-draw.ts`:

```ts
import { Matrix4, type BufferGeometry } from "three";
import { StorageBufferAttribute, type Node, type WebGPURenderer } from "three/webgpu";
import {
  Fn, If, Return, abs, clamp, dot, exp2, float, floor, instanceIndex, int, ivec2, log2, max, min, normalize, pow,
  round, select, smoothstep, storage, textureLoad, uint, uniform, unpackUnorm4x8, vec3, vec4,
} from "three/tsl";
import { displayNode, splatKneeNode } from "./display.js";
import { PROBE_CAPTURE_STRIDE } from "./relight-assets.js";
import { LOG_STEPS, RECORD_BYTES, SOURCE_COUNT, WINDOW_COUNT, packMultiplierWord } from "./relight-codec.js";
import type { RelightFrame } from "./relight-frame.js";
import { LUMINANCE, PROBE_FOLDED } from "./relight-kernel.js";

/** Flags byte 0xff (class 7 is unused) marks a splat whose tile has no records: it is drawn as captured. */
export const PASSTHROUGH_FLAGS = 0xff;
/** Multiplier 1 (code 146 decodes to 0.9973, −0.004 stop), alpha 1. */
export const PASSTHROUGH_WORD = packMultiplierWord([1, 1, 1], 1);
const WORKGROUP = 256;
const RECORD_WORDS = RECORD_BYTES / 4;

export function mergeRelightRecords(sources: readonly { readonly count: number; readonly records: Uint8Array | null }[]): Uint32Array {
  const total = sources.reduce((sum, source) => sum + source.count, 0);
  const bytes = new Uint8Array(total * RECORD_BYTES);
  let offset = 0;
  for (const source of sources) {
    if (source.records !== null && source.records.length === source.count * RECORD_BYTES) {
      bytes.set(source.records, offset * RECORD_BYTES);
    } else {
      for (let splat = 0; splat < source.count; splat += 1) bytes[(offset + splat) * RECORD_BYTES + 11] = PASSTHROUGH_FLAGS;
    }
    offset += source.count;
  }
  return new Uint32Array(bytes.buffer);
}

/** The placement every source of a draw shares (a room's tiles are placed together), or null. */
export function sharedPlacement(matrices: readonly Matrix4[]): Matrix4 | null {
  const first = matrices[0];
  if (first === undefined) return null;
  const same = matrices.every((matrix) => matrix.elements.every((value, index) => {
    const reference = first.elements[index] ?? Number.NaN;
    return Math.abs(value - reference) <= 1e-9 * Math.max(1, Math.abs(reference));
  }));
  return same ? first.clone() : null;
}

export interface RelightHooks {
  alpha(index: Node<"uint">): Node<"float">;
  workingColour(index: Node<"uint">, center: Node<"vec3">, rgb: Node<"vec3">): Node<"vec3">;
}

export interface RelightDraw {
  readonly count: number;
  readonly recordsAttribute: StorageBufferAttribute;
  readonly wordsAttribute: StorageBufferAttribute;
  /** The merged scene-frame centres and sRGB colours the pass reads (for the DEV instruments). */
  readonly positions: Float32Array;
  readonly colours: Uint32Array;
  readonly sceneToModel: Matrix4;
  readonly hooks: RelightHooks;
  setSourceRecords(offset: number, count: number, records: Uint8Array | null): void;
  run(renderer: WebGPURenderer): void;
  dispose(): void;
}

function decodeMultiplierCode(code: Node<"uint">): Node<"float"> {
  return select(code.equal(0), float(0), exp2(float(code).sub(1).mul(7 / LOG_STEPS).sub(4)));
}

function srgbToLinear(c: Node<"vec3">): Node<"vec3"> {
  return select(c.lessThanEqual(vec3(0.04045)), c.div(12.92), pow(c.add(0.055).div(1.055), vec3(2.4)));
}

function octahedral(byteU: Node<"uint">, byteV: Node<"uint">): Node<"vec3"> {
  const u = float(byteU).div(255).mul(2).sub(1);
  const v = float(byteV).div(255).mul(2).sub(1);
  const z = float(1).sub(abs(u)).sub(abs(v));
  const signU = select(u.greaterThanEqual(0), float(1), float(-1));
  const signV = select(v.greaterThanEqual(0), float(1), float(-1));
  const x = select(z.lessThan(0), float(1).sub(abs(v)).mul(signU), u);
  const y = select(z.lessThan(0), float(1).sub(abs(u)).mul(signV), v);
  return normalize(vec3(x, y, z));
}

/** Transmittance through stencil plane `index` along p + t·sun (t > 0), nearest cell (windows._sample). */
function planeTransmittance(frame: RelightFrame, index: number, p: Node<"vec3">, sun: Node<"vec3">): Node<"float"> {
  const u = frame.uniforms;
  const origin = u.planeOrigin.element(index), normal = u.planeNormal.element(index);
  const size = u.planeSize.element(index), rect = u.atlasRect.element(index);
  const denominator = dot(sun, normal);
  const t = dot(origin.sub(p), normal).div(max(denominator, 1e-6));
  const d = p.add(sun.mul(t)).sub(origin);
  const a = dot(d, u.planeU.element(index)), b = dot(d, u.planeV.element(index));
  const inside = denominator.greaterThan(1e-6).and(t.greaterThan(0))
    .and(a.greaterThanEqual(0)).and(a.lessThanEqual(size.x)).and(b.greaterThanEqual(0)).and(b.lessThanEqual(size.y));
  const column = clamp(round(a.div(size.x).mul(rect.z.sub(1))), 0, rect.z.sub(1));
  const row = clamp(round(b.div(size.y).mul(rect.w.sub(1))), 0, rect.w.sub(1));
  const value = textureLoad(frame.stencilAtlas, ivec2(int(rect.x.add(column)), int(rect.y.add(row)))).r;
  return select(inside, value, float(0));
}

function encodeMultiplier(value: Node<"float">): Node<"uint"> {
  const t = clamp(log2(clamp(value, 1 / 16, 8)).add(4).div(7), 0, 1);
  return select(value.lessThanEqual(0), uint(0), uint(1).add(uint(round(t.mul(LOG_STEPS)))));
}

export function createRelightDraw(frame: RelightFrame, geometry: BufferGeometry, records: Uint32Array, sceneToModelMatrix: Matrix4): RelightDraw {
  const positions = geometry.getAttribute("position").array;
  const colourBytes = geometry.getAttribute("color").array;
  if (!(positions instanceof Float32Array) || !(colourBytes instanceof Uint8Array)) throw new Error("A relit draw needs Float32 centres and packed RGBA bytes.");
  const count = positions.length / 3;
  if (records.length !== count * RECORD_WORDS || colourBytes.length !== count * 4) throw new Error("The relight records do not match the draw.");
  const colours = new Uint32Array(colourBytes.buffer, colourBytes.byteOffset, count);
  const recordsAttribute = new StorageBufferAttribute(records, 1);
  const positionsAttribute = new StorageBufferAttribute(positions, 1);
  const coloursAttribute = new StorageBufferAttribute(colours, 1);
  const wordsAttribute = new StorageBufferAttribute(new Uint32Array(count).fill(PASSTHROUGH_WORD), 1);
  const sceneToModel = uniform(sceneToModelMatrix.clone());
  const u = frame.uniforms;
  const recordRead = storage(recordsAttribute, "uint", count * RECORD_WORDS).toReadOnly();
  const positionRead = storage(positionsAttribute, "float", count * 3).toReadOnly();
  const colourRead = storage(coloursAttribute, "uint", count).toReadOnly();
  const captureRead = storage(frame.probeCapture, "float", frame.probeCount * PROBE_CAPTURE_STRIDE).toReadOnly();
  const scenarioRead = storage(frame.probeScenario, "float", frame.probeCount * PROBE_FOLDED).toReadOnly();
  const wordsWrite = storage(wordsAttribute, "uint", count);
  const wordsRead = storage(wordsAttribute, "uint", count).toReadOnly();

  const pass = Fn(() => {
    const i = instanceIndex;
    If(i.greaterThanEqual(uint(count)), () => { Return(); });
    const w0 = recordRead.element(i.mul(3)).toVar(), w1 = recordRead.element(i.mul(3).add(1)).toVar(), w2 = recordRead.element(i.mul(3).add(2)).toVar();
    const byteOf = (word: Node<"uint">, shift: number): Node<"uint"> => word.shiftRight(shift).bitAnd(0xff);
    const flags = byteOf(w2, 24).toVar();
    If(flags.equal(uint(PASSTHROUGH_FLAGS)), () => { wordsWrite.element(i).assign(uint(PASSTHROUGH_WORD)); Return(); });
    const codes = [byteOf(w0, 0), byteOf(w0, 8), byteOf(w0, 16), byteOf(w0, 24), byteOf(w1, 0), byteOf(w1, 8), byteOf(w1, 16), byteOf(w1, 24), byteOf(w2, 0)];
    const cls = flags.bitAnd(7).toVar();
    const iso = flags.bitAnd(8).notEqual(0);
    const reach = flags.bitAnd(16).notEqual(0);
    const centre = flags.bitAnd(32).notEqual(0);
    const normal = octahedral(byteOf(w2, 8), byteOf(w2, 16)).toVar();
    const scene = vec3(positionRead.element(i.mul(3)), positionRead.element(i.mul(3).add(1)), positionRead.element(i.mul(3).add(2)));
    const p = sceneToModel.mul(vec4(scene, 1)).xyz.toVar();
    const colour = srgbToLinear(unpackUnorm4x8(colourRead.element(i)).rgb).toVar();

    // Trilinear over valid probes; each corner's two folded cubes evaluated at the normal.
    const faces = [max(normal.x, 0).pow2(), max(normal.x.negate(), 0).pow2(), max(normal.y, 0).pow2(), max(normal.y.negate(), 0).pow2(), max(normal.z, 0).pow2(), max(normal.z.negate(), 0).pow2()]
      .map((weight) => select(iso, float(1 / 6), weight));
    const q = clamp(p.sub(u.probeOrigin).div(u.probeSpacing), vec3(0), u.probeShape.sub(1 + 1e-6)).toVar();
    const cell = floor(q).toVar();
    const f = q.sub(cell).toVar();
    const bounceCapture = vec3(0).toVar(), bounceScenario = vec3(0).toVar(), weightSum = float(0).toVar();
    for (const dx of [0, 1]) {
      for (const dy of [0, 1]) {
        for (const dz of [0, 1]) {
          const cx = min(cell.x.add(dx), u.probeShape.x.sub(1)), cy = min(cell.y.add(dy), u.probeShape.y.sub(1)), cz = min(cell.z.add(dz), u.probeShape.z.sub(1));
          const index = uint(cx.mul(u.probeShape.y).add(cy).mul(u.probeShape.z).add(cz)).toVar();
          const captureBase = index.mul(PROBE_CAPTURE_STRIDE).toVar(), scenarioBase = index.mul(PROBE_FOLDED).toVar();
          const weight = (dx === 1 ? f.x : float(1).sub(f.x)).mul(dy === 1 ? f.y : float(1).sub(f.y)).mul(dz === 1 ? f.z : float(1).sub(f.z))
            .mul(captureRead.element(captureBase.add(PROBE_FOLDED))).toVar();
          const evaluate = (read: typeof captureRead, base: Node<"uint">, c: number): Node<"float"> => faces
            .map((face, faceIndex) => face.mul(read.element(base.add(c * 6 + faceIndex))))
            .reduce((sum, term) => sum.add(term));
          bounceCapture.addAssign(vec3(evaluate(captureRead, captureBase, 0), evaluate(captureRead, captureBase, 1), evaluate(captureRead, captureBase, 2)).mul(weight));
          bounceScenario.addAssign(vec3(evaluate(scenarioRead, scenarioBase, 0), evaluate(scenarioRead, scenarioBase, 1), evaluate(scenarioRead, scenarioBase, 2)).mul(weight));
          weightSum.addAssign(weight);
        }
      }
    }
    const normaliser = select(weightSum.greaterThan(0), float(1).div(max(weightSum, 1e-12)), float(0));
    const eCap = bounceCapture.mul(normaliser).toVar(), e = bounceScenario.mul(normaliser).toVar();
    for (let k = 0; k < SOURCE_COUNT; k += 1) {
      const code = codes[k] ?? uint(0), range = u.ranges.element(k);
      const direct = select(code.equal(0), float(0), exp2(range.x.add(float(code).sub(1).mul(range.y.sub(range.x).div(LOG_STEPS)))));
      eCap.addAssign(u.captureWeights.element(k).mul(direct));
      e.addAssign(u.sourceWeights.element(k).mul(direct));
    }

    If(u.sunOn.greaterThan(0.5).and(reach), () => {
      let visibility: Node<"float"> = float(0);
      for (let w = 0; w < WINDOW_COUNT; w += 1) {
        visibility = visibility.add(u.windowOpen.element(w).mul(planeTransmittance(frame, 2 * w, p, u.sunDir)).mul(planeTransmittance(frame, 2 * w + 1, p, u.sunDir)));
      }
      const cosine = select(iso, float(0.25), max(dot(normal, u.sunDir), 0));
      e.addAssign(u.sunRgb.mul(visibility.mul(u.fresnelAtSun).mul(cosine)));
    });

    const luminance = dot(colour, vec3(...LUMINANCE)).toVar();
    const m = e.div(max(eCap, vec3(1e-4))).toVar();
    If(cls.equal(1), () => {
      const rho = min(colour.div(max(eCap, vec3(1e-4))), vec3(0.8));
      const excess = max(colour.sub(rho.mul(eCap)), vec3(0));
      m.assign(rho.mul(e).add(excess.mul(u.rBack)).div(max(colour, vec3(1e-4))));
    });
    m.assign(clamp(m, vec3(1 / 16), vec3(8)));
    If(cls.greaterThanEqual(3).and(cls.lessThanEqual(6)), () => {
      const bulb = cls.equal(3).or(cls.equal(4));
      const cove = cls.equal(5);
      const level = select(cls.equal(4), u.lampLevels.w, select(cove, u.lampLevels.x, select(centre, u.lampLevels.z, u.lampLevels.y)));
      // R1a's emitter boost: Mlit = 1 + (β − 1) smoothstep(0.45, 0.9, L), β = 1 at the captured light.
      const lit = select(bulb, vec3(float(1).add(u.emitterBoost.sub(1).mul(smoothstep(0.45, 0.9, luminance)))), select(cove, vec3(1), m));
      const chroma = pow(clamp(colour.div(max(luminance, 1e-4)), vec3(0.5), vec3(2)), vec3(0.4));
      const albedo = select(cove, vec3(0.3), chroma.mul(select(cls.equal(4), float(0.5), float(0.35))));
      const unlit = albedo.mul(e).div(max(colour, vec3(1e-4)));
      m.assign(clamp(lit.mul(level).add(unlit.mul(float(1).sub(level))), vec3(0), vec3(8)));
    });
    const alpha = select(cls.equal(2), uint(0), uint(255));
    wordsWrite.element(i).assign(encodeMultiplier(m.x).bitOr(encodeMultiplier(m.y).shiftLeft(8)).bitOr(encodeMultiplier(m.z).shiftLeft(16)).bitOr(alpha.shiftLeft(24)));
  })().compute(count, [WORKGROUP]).setName("RelightMultiplier");

  const hooks: RelightHooks = {
    alpha: (index) => float(wordsRead.element(index).shiftRight(24).bitAnd(0xff)).div(255),
    workingColour: (index, _center, rgb) => {
      const word = wordsRead.element(index).toVar("relightWord");
      const multiplier = vec3(decodeMultiplierCode(word.bitAnd(0xff)), decodeMultiplierCode(word.shiftRight(8).bitAnd(0xff)), decodeMultiplierCode(word.shiftRight(16).bitAnd(0xff)));
      // The knee is the splat's own captured brightest channel (at least 0.8): the capture itself is never rolled off.
      return displayNode(rgb.mul(multiplier), u.display, splatKneeNode(rgb));
    },
  };

  return {
    count, recordsAttribute, wordsAttribute, positions, colours, sceneToModel: sceneToModelMatrix.clone(), hooks,
    setSourceRecords: (offset, sourceCount, sourceRecords) => {
      const words = recordsAttribute.array;
      if (!(words instanceof Uint32Array)) throw new Error("The relight records are 32-bit words.");
      const merged = mergeRelightRecords([{ count: sourceCount, records: sourceRecords }]);
      words.set(merged, offset * RECORD_WORDS);
      recordsAttribute.addUpdateRange(offset * RECORD_WORDS, merged.length);
      recordsAttribute.needsUpdate = true;
    },
    run: (renderer) => {
      frame.prepare(renderer);
      void renderer.compute(pass);
    },
    dispose: () => {
      recordsAttribute.dispose();
      positionsAttribute.dispose();
      coloursAttribute.dispose();
      wordsAttribute.dispose();
      pass.dispose();
    },
  };
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/relight-draw.test.ts`
Expected: PASS, 5 tests. (The TSL graph is built lazily at compile time; the GPU check of the pass itself is Task 18's read-back against the CPU kernel.)

- [ ] **Step 5: Typecheck and lint the file**

Run: `cd D:/claude/real-hall/repo && pnpm --filter @omnitwin/web typecheck && pnpm exec eslint packages/web/src/lib/relight`
Expected: both exit 0. A TSL typing complaint is fixed by changing the annotation only (for example widening a helper's return to `Node`), never the graph.

- [ ] **Step 6: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/relight/relight-draw.ts packages/web/src/lib/relight/__tests__/relight-draw.test.ts && git diff --cached --stat && git commit -m "feat(relight): the per-splat multiplier pass in TSL and its render hooks (T-639 R1b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Relit draws in the native splat host

**Files:**
- Modify: `packages/web/src/lib/native-splat-scene.ts`
- Modify: `packages/web/src/components/scene/NativeCanvas.tsx` (the device's storage-buffer headroom), `packages/web/src/lib/native-renderer.ts` (reads the negotiated per-stage limit)
- Test: `packages/web/src/lib/__tests__/native-splat-scene.test.ts`, `packages/web/src/components/scene/__tests__/NativeCanvas.test.tsx`

**Interfaces:**
- Consumes: Task 10 (`RelightFrame`), Task 11 (`createRelightDraw`, `mergeRelightRecords`, `sharedPlacement`, `RelightDraw`), Task 2 (`warnRelightFallback`); `MergedNativeSplats` from `./native-splat-merge.js`.
- Produces (device): the native canvas's `requestDevice` asks for `requiredLimits.maxStorageBuffersPerShaderStage` equal to the adapter's value whenever the adapter reports more than 8, and leaves the limit out otherwise (so every existing request is unchanged); `nativeRendererStorageBuffersPerStage(renderer: WebGPURenderer): number | null` in `native-renderer.ts`; `RELIT_VERTEX_STORAGE_BUFFERS = 8` in `native-splat-scene.ts` (the relit vertex stage's storage buffers; Task 19 Step 1 raises it if T-640 adds one), and the default `relightSupported` also requires the device's per-stage limit to reach it.
- Produces: `interface NativeSourceHandle { readonly setGeometry: (geometry: BufferGeometry) => void; readonly setRelight: (records: Uint8Array | null) => void; readonly dispose: () => void }` (the return type of `register`); `NativeSplatScene` constructor gains a third parameter `relightSupported: (renderer: WebGPURenderer) => boolean` (default: `nativeRendererStorageLimit(renderer) !== null`); methods `setRelight(owner: object, frame: RelightFrame | null): void`, `clearRelight(owner: object): void`, `runRelight(): void`, `relightState(): { readonly supported: boolean; readonly relit: boolean }`, `activeRelightDraw(): RelightDraw | null`.

A draw's key gains `relit` or `captured`, so setting or clearing the frame builds a new draw beside the old one (which stays on screen until the new one is ready) and a change of light never rebuilds. A new relit draw runs its pass after compilation and before it is first shown; late records rerun the pass of every cached draw holding that source; `runRelight` reruns every cached relit draw after `RelightFrame.apply`. Tiles placed differently cannot share one scene-to-model transform: the draw is then drawn as captured with one warning.

- [ ] **Step 1: Write the failing tests** — in `packages/web/src/lib/__tests__/native-splat-scene.test.ts`:

Replace the first line with:

```ts
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
```

Directly after the line `import type { NativeCpuSortCommand } from "../native-cpu-sort-protocol.js";`, add:

```ts
import { loadRelightModelData, type RelightModelData } from "../relight/relight-assets.js";
import { RelightFrame } from "../relight/relight-frame.js";
import { resetRelightWarnings } from "../relight/relight-warning.js";
import { buildTestPackage } from "../relight/__tests__/relight-test-package.js";
```

Replace `inputs: [] as BufferGeometry[], maskResamples: 0 }));` with:

```ts
inputs: [] as BufferGeometry[], maskResamples: 0, workingColour: [] as unknown[] }));
```

Replace:

```ts
    constructor(source: BufferGeometry, options: { kernelRadius: number; antialias?: boolean }) {
```

with:

```ts
    constructor(source: BufferGeometry, options: { kernelRadius: number; antialias?: boolean; workingColorNode?: unknown }) {
```

and directly after `      evidence.antialias.push(options.antialias);` add:

```ts
      evidence.workingColour.push(options.workingColorNode);
```

Replace `function setup(automaticSort = true) {` with `function setup(automaticSort = true, relightSupported = false) {`; directly after the line `  const rendererError = vi.spyOn(renderer, "onError").mockImplementation(() => undefined);` add:

```ts
  const compute = vi.spyOn(renderer, "compute").mockImplementation(() => undefined);
```

replace `  const runtime = new NativeSplatScene(scene, () => new NativeCpuSortPool(() => sortWorker));` with:

```ts
  const runtime = new NativeSplatScene(scene, () => new NativeCpuSortPool(() => sortWorker), () => relightSupported);
```

and replace `  return { scene, camera, renderer, rendererError, runtime, compile, detach, add, draw, gpu, render, invalidate, sortWorker };` with:

```ts
  return { scene, camera, renderer, rendererError, runtime, compile, detach, add, draw, gpu, render, invalidate, sortWorker, compute };
```

Replace `evidence.inputs.length = 0; evidence.maskResamples = 0; });` with:

```ts
evidence.inputs.length = 0; evidence.maskResamples = 0; evidence.workingColour.length = 0; });
```

Append at the end of the file:

```ts
describe("relit native draws (T-639 R1b)", () => {
  let data: RelightModelData;
  let frame: RelightFrame;
  beforeAll(async () => {
    const pkg = buildTestPackage();
    data = await loadRelightModelData(pkg.fetch, pkg.manifestUrl);
  });
  beforeEach(() => { frame = new RelightFrame(data); });
  afterEach(() => { resetRelightWarnings(); });

  it("draws as captured without a relight frame", async () => {
    const state = setup(true, true);
    state.add(3);
    await vi.advanceTimersByTimeAsync(40);
    expect(evidence.workingColour).toEqual([undefined]);
    expect(state.compute).not.toHaveBeenCalled();
    expect(state.runtime.relightState()).toEqual({ supported: true, relit: false });
  });

  it("rebuilds the draw relit once a frame is set, and runs its pass before showing it", async () => {
    const state = setup(true, true);
    state.add(3);
    await vi.advanceTimersByTimeAsync(40);
    state.runtime.setRelight({}, frame);
    await vi.advanceTimersByTimeAsync(40);
    expect(evidence.created).toBe(2);
    expect(typeof evidence.workingColour[1]).toBe("function");
    expect(state.compute).toHaveBeenCalledTimes(2); // the frame's probe fold, then the draw's pass
    expect(state.runtime.relightState()).toEqual({ supported: true, relit: true });
    expect(state.runtime.activeRelightDraw()?.count).toBe(3);
  });

  it("keeps the hall as captured on the WebGL2 fallback", async () => {
    const state = setup(true, false);
    state.add(3);
    state.runtime.setRelight({}, frame);
    await vi.advanceTimersByTimeAsync(40);
    expect(evidence.workingColour).toEqual([undefined]);
    expect(state.runtime.relightState()).toEqual({ supported: false, relit: false });
  });

  it("reruns the pass for records that arrive late, without rebuilding the draw", async () => {
    const state = setup(true, true);
    const source = state.add(3);
    state.runtime.setRelight({}, frame);
    await vi.advanceTimersByTimeAsync(40);
    const calls = state.compute.mock.calls.length;
    source.setRelight(new Uint8Array(36));
    expect(state.compute.mock.calls.length).toBe(calls + 1);
    expect(evidence.created).toBe(1);
  });

  it("reruns every cached relit draw when the light changes, and never rebuilds", async () => {
    const state = setup(true, true);
    state.add(3);
    state.runtime.setRelight({}, frame);
    await vi.advanceTimersByTimeAsync(40);
    const calls = state.compute.mock.calls.length;
    state.invalidate.mockClear();
    state.runtime.runRelight();
    expect(state.compute.mock.calls.length).toBe(calls + 1);
    expect(state.invalidate).toHaveBeenCalled();
    expect(evidence.created).toBe(1);
  });

  it("returns to a captured draw when its owner clears the frame", async () => {
    const state = setup(true, true);
    state.add(3);
    const owner = {};
    state.runtime.setRelight(owner, frame);
    await vi.advanceTimersByTimeAsync(40);
    state.runtime.clearRelight({});
    expect(state.runtime.relightState().relit).toBe(true);
    state.runtime.clearRelight(owner);
    await vi.advanceTimersByTimeAsync(40);
    expect(evidence.workingColour.at(-1)).toBeUndefined();
    expect(state.runtime.relightState().relit).toBe(false);
  });

  it("draws tiles placed apart as captured, with one warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const state = setup(true, true);
    state.add(3);
    const second = state.add(2);
    second.anchor.position.set(5, 0, 0);
    state.runtime.frame(1);
    state.runtime.setRelight({}, frame);
    await vi.advanceTimersByTimeAsync(40);
    expect(evidence.workingColour.at(-1)).toBeUndefined();
    expect(warn.mock.calls.filter(([message]) => String(message).includes("not placed together"))).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the file to see the new tests fail**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/native-splat-scene.test.ts`
Expected: FAIL — the new tests fail (`relightState` and `setRelight` are not functions; `setRelight` is missing from the handle); the existing tests still pass.

- [ ] **Step 3: Implement** — in `packages/web/src/lib/native-splat-scene.ts`:

Replace `import { mergeNativeSplatSources, type NativeRoomClip } from "./native-splat-merge.js";` with:

```ts
import { mergeNativeSplatSources, type MergedNativeSplats, type NativeRoomClip } from "./native-splat-merge.js";
```

Directly after `import { NativeCpuSortPool, type NativeCpuSortHandle } from "./native-cpu-sort-pool.js";` add:

```ts
import { createRelightDraw, mergeRelightRecords, sharedPlacement, type RelightDraw } from "./relight/relight-draw.js";
import type { RelightFrame } from "./relight/relight-frame.js";
import { warnRelightFallback } from "./relight/relight-warning.js";
```

Directly after the `NativeSourceRegistration` interface's closing `}` add:

```ts
export interface NativeSourceHandle {
  readonly setGeometry: (geometry: BufferGeometry) => void;
  /** This tile's relight records (T-639 R1b), or null to draw it as captured. Records that
   * arrive after the draw is built rerun its relight pass; no draw is rebuilt. */
  readonly setRelight: (records: Uint8Array | null) => void;
  readonly dispose: () => void;
}
```

In `interface Source`, directly after `  renderedOnce: boolean;` add:

```ts
  relightRecords: Uint8Array | null;
```

In `interface Snapshot`, directly after `  readonly cpuSort: NativeCpuSortHandle | null;` add:

```ts
  /** The relight pass and hooks of a relit draw; null when it is drawn as captured. */
  readonly relight: RelightDraw | null;
  /** Each source's first splat and splat count in the merged draw. */
  readonly offsets: readonly number[];
  readonly counts: readonly number[];
```

Directly after `  private cpuSortPool: NativeCpuSortPool | null = null;` add:

```ts
  private relightFrame: RelightFrame | null = null;
  private relightOwner: object | null = null;
```

Replace the constructor line `  constructor(private readonly scene: Scene, private readonly createCpuSortPool: () => NativeCpuSortPool = () => new NativeCpuSortPool()) {}` with:

```ts
  constructor(
    private readonly scene: Scene,
    private readonly createCpuSortPool: () => NativeCpuSortPool = () => new NativeCpuSortPool(),
    /** Relighting needs WebGPU compute; the WebGL2 fallback keeps the hall as captured (spec §5). */
    private readonly relightSupported: (renderer: WebGPURenderer) => boolean = (renderer) => nativeRendererStorageLimit(renderer) !== null,
  ) {}
```

Replace:

```ts
  register(registration: NativeSourceRegistration): { setGeometry: (geometry: BufferGeometry) => void; dispose: () => void } {
    const key = registration.anchor.uuid;
    const source: Source = { ...registration, geometry: null, matrix: new Matrix4(), version: 0, renderedOnce: false };
```

with:

```ts
  register(registration: NativeSourceRegistration): NativeSourceHandle {
    const key = registration.anchor.uuid;
    const source: Source = { ...registration, geometry: null, matrix: new Matrix4(), version: 0, renderedOnce: false, relightRecords: null };
```

and in the same method replace:

```ts
        this.schedule();
        this.invalidate();
      },
      dispose: () => {
        disposed = true;
```

with:

```ts
        this.schedule();
        this.invalidate();
      },
      setRelight: (records) => {
        if (disposed || source.relightRecords === records) return;
        source.relightRecords = records;
        for (const snapshot of this.snapshots.values()) {
          const index = snapshot.sources.findIndex((member) => member === source);
          const offset = snapshot.offsets[index], count = snapshot.counts[index];
          if (snapshot.relight === null || offset === undefined || count === undefined) continue;
          snapshot.relight.setSourceRecords(offset, count, records);
          if (this.renderer !== null) snapshot.relight.run(this.renderer);
        }
        this.invalidate();
      },
      dispose: () => {
        disposed = true;
```

Directly after the `clearExclusion` method add:

```ts
  /** The relit hall's GPU resources (T-639 R1b), or null for the hall as captured. A new
   * frame builds a new draw (its material differs); a change of light only reruns the pass. */
  setRelight(owner: object, frame: RelightFrame | null): void {
    this.relightOwner = owner;
    if (this.relightFrame === frame) return;
    this.relightFrame = frame;
    this.schedule();
    this.invalidate();
  }

  clearRelight(owner: object): void {
    if (this.relightOwner !== owner) return;
    this.relightOwner = null;
    if (this.relightFrame === null) return;
    this.relightFrame = null;
    this.schedule();
    this.invalidate();
  }

  /** After RelightFrame.apply: every cached relit draw recomputes its multipliers. */
  runRelight(): void {
    const renderer = this.renderer;
    if (renderer === null) return;
    for (const snapshot of this.snapshots.values()) snapshot.relight?.run(renderer);
    this.invalidate();
  }

  relightState(): { readonly supported: boolean; readonly relit: boolean } {
    return { supported: this.renderer !== null && this.relightSupported(this.renderer), relit: (this.active?.relight ?? null) !== null };
  }

  /** The active draw's relight pass, for the DEV instruments. */
  activeRelightDraw(): RelightDraw | null {
    return this.active?.relight ?? null;
  }

  private relightActive(): boolean {
    return this.relightFrame !== null && this.renderer !== null && this.relightSupported(this.renderer);
  }
```

Replace the `key` method's body line:

```ts
    return `${String(this.kernelRadius)}:` + sources.map((source) => `${source.anchor.uuid}/${String(source.version)}/${String(Math.floor(source.maxSh()))}`).join(";");
```

with:

```ts
    // A relit draw has another material, so the relight state is part of a draw's identity.
    return `${String(this.kernelRadius)}:${this.relightActive() ? "relit" : "captured"}:`
      + sources.map((source) => `${source.anchor.uuid}/${String(source.version)}/${String(Math.floor(source.maxSh()))}`).join(";");
```

In `buildNext`, replace:

```ts
      } else {
        this.snapshots.set(key, snapshot);
```

with:

```ts
      } else {
        // The multipliers are written before the draw is first shown, and never per frame.
        snapshot.relight?.run(renderer);
        this.snapshots.set(key, snapshot);
```

In `createSnapshot`, replace:

```ts
    const exclusionMask = this.exclusionTexture;
    let mesh: NativeGaussianObject;
    try {
      mesh = new GaussianSplat(merged.geometry, {
```

with:

```ts
    const exclusionMask = this.exclusionTexture;
    const relight = this.createRelight(sources, merged);
    let mesh: NativeGaussianObject;
    try {
      mesh = new GaussianSplat(merged.geometry, {
        ...(relight === null ? {} : { workingColorNode: relight.hooks.workingColour }),
```

replace:

```ts
          return opacity;
        })(),
      });
    } catch (reason: unknown) {
      tileAttribute.dispose(); merged.geometry.dispose(); throw reason;
    }
```

with:

```ts
          // Hidden splats (the glass and the view outside) lose their alpha when relit.
          if (relight !== null) opacity.mulAssign(relight.hooks.alpha(index));
          return opacity;
        })(),
      });
    } catch (reason: unknown) {
      relight?.dispose(); tileAttribute.dispose(); merged.geometry.dispose(); throw reason;
    }
```

replace:

```ts
        cpuSort?.dispose(); mesh.dispose(); tileAttribute.dispose(); merged.geometry.dispose();
        throw reason;
```

with:

```ts
        cpuSort?.dispose(); mesh.dispose(); relight?.dispose(); tileAttribute.dispose(); merged.geometry.dispose();
        throw reason;
```

replace:

```ts
    const snapshot: Snapshot = {
      key, mesh, geometry: merged.geometry, tileAttribute, sources, opacityValues,
```

with:

```ts
    const offsets: number[] = [];
    merged.counts.reduce((offset, count) => { offsets.push(offset); return offset + count; }, 0);
    const snapshot: Snapshot = {
      key, mesh, geometry: merged.geometry, tileAttribute, sources, opacityValues, relight, offsets, counts: merged.counts,
```

and replace `        mesh.removeFromParent(); mesh.dispose(); tileAttribute.dispose(); merged.geometry.dispose();` with:

```ts
        mesh.removeFromParent(); mesh.dispose(); relight?.dispose(); tileAttribute.dispose(); merged.geometry.dispose();
```

Directly after the `createSnapshot` method add:

```ts
  /** The relight pass for a new draw, or null to draw it as captured. */
  private createRelight(sources: readonly ReadySource[], merged: MergedNativeSplats): RelightDraw | null {
    const frame = this.relightFrame;
    if (frame === null || !this.relightActive()) return null;
    // Merged centres are in the Scene frame (source matrix × tile point); the package is in its model frame.
    const placement = sharedPlacement(sources.map((source) => source.matrix));
    if (placement === null) {
      warnRelightFallback("placement", "The hall's splat tiles are not placed together, so it is drawn as captured.");
      return null;
    }
    const records = mergeRelightRecords(sources.map((source, index) => ({ count: merged.counts[index] ?? 0, records: source.relightRecords })));
    return createRelightDraw(frame, merged.geometry, records, frame.tileToModel.clone().multiply(placement.invert()));
  }
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/native-splat-scene.test.ts`
Expected: PASS, the Task 0 count plus 7.

- [ ] **Step 5: Typecheck**

Run: `cd D:/claude/real-hall/repo && pnpm --filter @omnitwin/web typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/native-splat-scene.ts packages/web/src/lib/__tests__/native-splat-scene.test.ts && git diff --cached --stat && git commit -m "feat(splats): relit draws in the native host, the pass run on build, late records and light changes only (T-639 R1b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Storage-buffer headroom — write the failing tests.** A relit draw's vertex stage binds 8 storage buffers (Global Constraints), exactly WebGPU's default `maxStorageBuffersPerShaderStage`, and T-640's work (Task 19 Step 1) may add another. The device is created before any draw exists, in `components/scene/NativeCanvas.tsx` (`lib/native-renderer.ts` only reads the negotiated limits). So the canvas asks for the adapter's own limit whenever it is higher, which never fails, and the host relights only where the negotiated limit reaches the relit stage's count.

In `packages/web/src/lib/__tests__/native-splat-scene.test.ts`, replace the import line `import { NativeSplatScene } from "../native-splat-scene.js";` with `import { NativeSplatScene, RELIT_VERTEX_STORAGE_BUFFERS } from "../native-splat-scene.js";`, and append inside the `describe("relit native draws (T-639 R1b)", …)` block, before its closing `});`:

```ts
  it("relights by default only on a WebGPU device whose per-stage limit covers a relit draw", () => {
    const relightable = (limits: object | null): boolean => {
      const renderer = Object.assign(new WebGPURenderer({ forceWebGL: true }), { backend: limits === null ? {} : { device: { limits } } });
      const runtime = new NativeSplatScene(new Scene());
      runtime.attach(renderer, new PerspectiveCamera(), () => undefined);
      return runtime.relightState().supported;
    };
    expect(relightable({ maxStorageBufferBindingSize: 134_217_728, maxStorageBuffersPerShaderStage: RELIT_VERTEX_STORAGE_BUFFERS })).toBe(true);
    expect(relightable({ maxStorageBufferBindingSize: 134_217_728, maxStorageBuffersPerShaderStage: RELIT_VERTEX_STORAGE_BUFFERS - 1 })).toBe(false);
    expect(relightable(null)).toBe(false);
  });
```

In `packages/web/src/components/scene/__tests__/NativeCanvas.test.tsx`, directly before the line `  it("withholds both scene and frame loop until native initialization resolves", async () => {`, add:

```tsx
  it.each([
    [16, 16],
    [8, undefined],
    [undefined, undefined],
  ])("asks for the adapter's %s storage buffers per shader stage only above WebGPU's default of 8 (T-639 R1b)", async (perStage, requested) => {
    const device = { destroy: vi.fn() };
    const requestDevice = vi.fn(() => Promise.resolve(device));
    const limits = { maxStorageBufferBindingSize: 134_217_728, maxBufferSize: 268_435_456, ...(perStage === undefined ? {} : { maxStorageBuffersPerShaderStage: perStage }) };
    vi.stubGlobal("navigator", { gpu: { requestAdapter: vi.fn(() => Promise.resolve({ features: new Set<string>(), limits, requestDevice })) } });
    const view = render(<NativeCanvas />);
    await act(() => Promise.resolve());
    expect(requestDevice).toHaveBeenCalledWith({
      requiredFeatures: [],
      requiredLimits: {
        maxStorageBufferBindingSize: 134_217_728,
        maxBufferSize: 268_435_456,
        ...(requested === undefined ? {} : { maxStorageBuffersPerShaderStage: requested }),
      },
    });
    view.unmount();
    await act(() => Promise.resolve());
  });

```

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/scene/__tests__/NativeCanvas.test.tsx`
Expected: FAIL — the `16` case (the limit is not requested); the other cases and every existing test pass.

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/native-splat-scene.test.ts`
Expected: FAIL — `RELIT_VERTEX_STORAGE_BUFFERS` is not exported.

- [ ] **Step 8: Request the headroom and check it** — in `packages/web/src/lib/native-renderer.ts`, directly after the `nativeRendererStorageLimit` function, add:

```ts
/** The negotiated storage buffers per shader stage; null on the WebGL2 backend or when not reported. */
export function nativeRendererStorageBuffersPerStage(renderer: WebGPURenderer): number | null {
  const backend = renderer.backend;
  if (!("device" in backend) || typeof backend.device !== "object" || backend.device === null) return null;
  const device = backend.device;
  if (!("limits" in device) || typeof device.limits !== "object" || device.limits === null) return null;
  const limits = device.limits;
  if (!("maxStorageBuffersPerShaderStage" in limits) || typeof limits.maxStorageBuffersPerShaderStage !== "number") return null;
  return limits.maxStorageBuffersPerShaderStage;
}
```

In `packages/web/src/lib/native-splat-scene.ts`, replace `import { afterNativeCanvasGpuWork, isNativeCanvasRender, nativeRendererStorageLimit } from "./native-renderer.js";` with:

```ts
import { afterNativeCanvasGpuWork, isNativeCanvasRender, nativeRendererStorageBuffersPerStage, nativeRendererStorageLimit } from "./native-renderer.js";
```

directly after the `NativeSourceHandle` interface add:

```ts
/** Storage buffers a relit draw's vertex stage binds (order, centre, covariance A and B, colour, SH contribution,
 * tile ids, multiplier words). Task 19 Step 1 raises it if the rebased patch's vertex stage binds more. */
export const RELIT_VERTEX_STORAGE_BUFFERS = 8;
```

and in the constructor replace the default `(renderer) => nativeRendererStorageLimit(renderer) !== null` with:

```ts
(renderer) => nativeRendererStorageLimit(renderer) !== null
      && (nativeRendererStorageBuffersPerStage(renderer) ?? 0) >= RELIT_VERTEX_STORAGE_BUFFERS
```

Then, in `packages/web/src/components/scene/NativeCanvas.tsx`:

Replace:

```ts
  readonly limits: { readonly maxStorageBufferBindingSize: number; readonly maxBufferSize: number };
  requestDevice(options: {
    requiredFeatures: string[];
    requiredLimits: { maxStorageBufferBindingSize: number; maxBufferSize: number };
  }): Promise<NativeGraphicsDevice>;
```

with:

```ts
  readonly limits: { readonly maxStorageBufferBindingSize: number; readonly maxBufferSize: number; readonly maxStorageBuffersPerShaderStage?: number };
  requestDevice(options: {
    requiredFeatures: string[];
    requiredLimits: { maxStorageBufferBindingSize: number; maxBufferSize: number; maxStorageBuffersPerShaderStage?: number };
  }): Promise<NativeGraphicsDevice>;
```

and replace:

```ts
            const device = await adapter.requestDevice({
              requiredFeatures: [...adapter.features],
              requiredLimits: {
                maxStorageBufferBindingSize: Math.min(adapter.limits.maxStorageBufferBindingSize, 268_435_456),
                maxBufferSize: Math.min(adapter.limits.maxBufferSize, 536_870_912),
              },
            });
```

with:

```ts
            const perStage = adapter.limits.maxStorageBuffersPerShaderStage;
            const device = await adapter.requestDevice({
              requiredFeatures: [...adapter.features],
              requiredLimits: {
                maxStorageBufferBindingSize: Math.min(adapter.limits.maxStorageBufferBindingSize, 268_435_456),
                maxBufferSize: Math.min(adapter.limits.maxBufferSize, 536_870_912),
                // A relit splat draw binds 8 storage buffers in its vertex stage, WebGPU's default limit (T-639 R1b):
                // take the adapter's headroom whenever it has more, so one more binding cannot fail the pipeline.
                ...(perStage !== undefined && perStage > 8 ? { maxStorageBuffersPerShaderStage: perStage } : {}),
              },
            });
```

- [ ] **Step 9: Run the tests and commit**

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/scene/__tests__/NativeCanvas.test.tsx`
Expected: PASS (the Task 0 count plus 3).

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/native-splat-scene.test.ts`
Expected: PASS, the Task 0 count plus 8.

Run: `cd D:/claude/real-hall/repo && pnpm --filter @omnitwin/web typecheck`
Expected: exit 0.

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/components/scene/NativeCanvas.tsx packages/web/src/components/scene/__tests__/NativeCanvas.test.tsx packages/web/src/lib/native-renderer.ts packages/web/src/lib/native-splat-scene.ts packages/web/src/lib/__tests__/native-splat-scene.test.ts && git diff --cached --stat && git commit -m "feat(splats): the native device takes the adapter's storage-buffer headroom; relit draws need it (T-639 R1b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Each tile loads its relight records beside its geometry

**Files:**
- Create: `packages/web/src/lib/relight/relight-tile-load.ts`
- Modify: `packages/web/src/components/scene/NativeSplatLayer.tsx`
- Test: `packages/web/src/lib/relight/__tests__/relight-tile-load.test.ts`, `packages/web/src/components/scene/__tests__/NativeSplatLayer.test.tsx`

**Interfaces:**
- Consumes: Task 2 (`relightTileLookup`, `RelightTileSource`, `warnRelightFallback`), Task 5 (`loadRelightRecords`, `RelightModelData`), Task 12 (`NativeSourceHandle.setRelight`); `getNativeRenderer`, `nativeRendererStorageLimit` from `../native-renderer.js`; `nativeSplatCount` from `../native-splat-merge.js`.
- Produces: `relightBackendSupported(gl: unknown): boolean`; `interface RelightBundleTile { readonly file: string; readonly sha256: string; readonly isEnvironment: boolean }`; `relightTilePromises(tiles: readonly RelightBundleTile[], relightPackage: Promise<RelightModelData | null>): ReadonlyMap<string, Promise<RelightTileSource | null>>` (keyed by tile file); `interface TileLoad { readonly geometry: BufferGeometry; readonly records: Uint8Array | null }`; `loadTileWithRelight(loadGeometry: () => Promise<BufferGeometry>, relight: Promise<RelightTileSource | null> | undefined, supported: boolean, signal: AbortSignal): Promise<TileLoad>`; `NativeSplatLayerProps.relight?: Promise<RelightTileSource | null>`.

A tile never waits on, or fails because of, its records: both load together and settle independently. A refused tile (another capture of it, no records, a count other than its splat count, an unreadable file) is drawn as captured with one `tile` warning; the sky shell is refused silently (the sky panels cover the windows).

- [ ] **Step 1: Write the failing tests**

`packages/web/src/lib/relight/__tests__/relight-tile-load.test.ts`:

```ts
import { BufferAttribute, BufferGeometry } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

const records = vi.hoisted(() => ({ load: vi.fn<(source: unknown, signal: AbortSignal) => Promise<Uint8Array>>() }));
vi.mock("../../relight-package.js", () => ({ loadRelightRecords: records.load }));

import { loadRelightModelData } from "../relight-assets.js";
import { loadTileWithRelight, relightBackendSupported, relightTilePromises } from "../relight-tile-load.js";
import { resetRelightWarnings } from "../relight-warning.js";
import { TEST_TILE_SHA, buildTestPackage } from "./relight-test-package.js";

function geometry(count: number): BufferGeometry {
  const result = new BufferGeometry();
  result.setAttribute("position", new BufferAttribute(new Float32Array(count * 3), 3));
  return result;
}
const SOURCE = { url: "https://cdn.test/t.relight.gz", sha256: "a".repeat(64), bytes: 30, count: 1 };

afterEach(() => { resetRelightWarnings(); records.load.mockReset(); vi.restoreAllMocks(); });

describe("a tile's relight records (T-639 R1b)", () => {
  it("relights only on WebGPU", () => {
    expect(relightBackendSupported({ isWebGPURenderer: true, backend: { device: { limits: { maxStorageBufferBindingSize: 134_217_728 } } } })).toBe(true);
    expect(relightBackendSupported({ isWebGPURenderer: true, backend: {} })).toBe(false);
    expect([relightBackendSupported({}), relightBackendSupported(undefined)]).toEqual([false, false]);
  });

  it("finds each tile's records by its digest, refusing others with one warning and the sky shell silently", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const pkg = buildTestPackage();
    const data = loadRelightModelData(pkg.fetch, pkg.manifestUrl);
    const promises = relightTilePromises([
      { file: "t.sog", sha256: TEST_TILE_SHA, isEnvironment: false },
      { file: "u.sog", sha256: "c".repeat(64), isEnvironment: false },
      { file: "v.sog", sha256: "d".repeat(64), isEnvironment: false },
      { file: "env.sog", sha256: "e".repeat(64), isEnvironment: true },
    ], data);
    expect((await promises.get("t.sog"))?.count).toBe(3);
    expect(await promises.get("u.sog")).toBeNull();
    expect(await promises.get("v.sog")).toBeNull();
    expect(await promises.get("env.sog")).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    expect(await relightTilePromises([{ file: "t.sog", sha256: TEST_TILE_SHA, isEnvironment: false }], Promise.resolve(null)).get("t.sog")).toBeNull();
  });

  it("loads a tile's geometry and records together", async () => {
    const loaded = geometry(1), bytes = new Uint8Array(12);
    records.load.mockResolvedValue(bytes);
    const result = await loadTileWithRelight(() => Promise.resolve(loaded), Promise.resolve(SOURCE), true, new AbortController().signal);
    expect(result).toEqual({ geometry: loaded, records: bytes });
  });

  it("draws a tile as captured when its records fail or hold another count, with one warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    records.load.mockRejectedValue(new Error("404"));
    const failed = await loadTileWithRelight(() => Promise.resolve(geometry(1)), Promise.resolve(SOURCE), true, new AbortController().signal);
    expect(failed.records).toBeNull();
    records.load.mockResolvedValue(new Uint8Array(24));
    expect((await loadTileWithRelight(() => Promise.resolve(geometry(1)), Promise.resolve(SOURCE), true, new AbortController().signal)).records).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    await expect(loadTileWithRelight(() => Promise.reject(new Error("Malformed SOG")), Promise.resolve(SOURCE), true, new AbortController().signal)).rejects.toThrow("Malformed SOG");
  });

  it("never asks for records where it cannot relight", async () => {
    const result = await loadTileWithRelight(() => Promise.resolve(geometry(1)), Promise.resolve(SOURCE), false, new AbortController().signal);
    expect(result.records).toBeNull();
    expect(records.load).not.toHaveBeenCalled();
  });
});
```

In `packages/web/src/components/scene/__tests__/NativeSplatLayer.test.tsx`:

Replace `  gl: { isWebGPURenderer: true },` with `  gl: { isWebGPURenderer: true } as object,`.

Replace `  setGeometry: vi.fn(), dispose: vi.fn(),` with `  setGeometry: vi.fn(), setRelight: vi.fn(), dispose: vi.fn(),`.

Replace `    return { setGeometry: runtime.setGeometry, dispose: runtime.dispose };` with `    return { setGeometry: runtime.setGeometry, setRelight: runtime.setRelight, dispose: runtime.dispose };`.

Directly after `vi.mock("../../../lib/native-splat-loader.js", () => ({ loadNativeSplatGeometry: loader.load }));` add:

```ts
const relightRecords = vi.hoisted(() => ({ load: vi.fn<(source: unknown, signal: AbortSignal) => Promise<Uint8Array>>() }));
vi.mock("../../../lib/relight-package.js", () => ({ loadRelightRecords: relightRecords.load }));
const WEBGPU = { isWebGPURenderer: true, backend: { device: { limits: { maxStorageBufferBindingSize: 134_217_728 } } } };
const RELIGHT_SOURCE = { url: "https://cdn.test/t.relight.gz", sha256: "a".repeat(64), bytes: 30, count: 1 };
```

In `beforeEach`, replace `  state.scene = new Scene(); state.camera = new PerspectiveCamera(); runtime.registration = null;` with:

```ts
  state.scene = new Scene(); state.camera = new PerspectiveCamera(); runtime.registration = null; state.gl = { isWebGPURenderer: true };
```

Append inside the `describe("native splat source boundary", …)` block, before its closing `});`:

```ts
  it("hands the host its tile's relight records with the geometry", async () => {
    state.gl = WEBGPU;
    const loaded = geometry(), bytes = new Uint8Array(12);
    loader.load.mockResolvedValue(loaded);
    relightRecords.load.mockResolvedValue(bytes);
    render(<NativeSplatLayer url="/room.sog" relight={Promise.resolve(RELIGHT_SOURCE)} />);
    await waitFor(() => { expect(runtime.setRelight).toHaveBeenCalledWith(bytes); });
    expect(runtime.setGeometry).toHaveBeenCalledWith(loaded);
  });

  it("draws the tile as captured when its records cannot be read", async () => {
    state.gl = WEBGPU;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const loaded = geometry();
    loader.load.mockResolvedValue(loaded);
    relightRecords.load.mockRejectedValue(new Error("404"));
    render(<NativeSplatLayer url="/room.sog" relight={Promise.resolve(RELIGHT_SOURCE)} />);
    await waitFor(() => { expect(runtime.setRelight).toHaveBeenCalledWith(null); });
    expect(runtime.setGeometry).toHaveBeenCalledWith(loaded);
  });

  it("never loads records on the WebGL2 fallback", async () => {
    loader.load.mockResolvedValue(geometry());
    render(<NativeSplatLayer url="/room.sog" relight={Promise.resolve(RELIGHT_SOURCE)} />);
    await waitFor(() => { expect(runtime.setRelight).toHaveBeenCalledWith(null); });
    expect(relightRecords.load).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/relight-tile-load.test.ts`
Expected: FAIL — cannot find module `../relight-tile-load.js`.

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/scene/__tests__/NativeSplatLayer.test.tsx`
Expected: FAIL — the three new tests (`setRelight` is never called); the four existing tests pass.

- [ ] **Step 3: Implement the tile loading** — create `packages/web/src/lib/relight/relight-tile-load.ts`:

```ts
import type { BufferGeometry } from "three";
import { getNativeRenderer, nativeRendererStorageLimit } from "../native-renderer.js";
import { nativeSplatCount } from "../native-splat-merge.js";
import { loadRelightRecords } from "../relight-package.js";
import type { RelightModelData } from "./relight-assets.js";
import { RECORD_BYTES } from "./relight-codec.js";
import { relightTileLookup, type RelightTileSource } from "./relight-manifest.js";
import { warnRelightFallback } from "./relight-warning.js";

/** Relighting needs the WebGPU backend; the WebGL2 fallback keeps the hall as captured (spec §5). */
export function relightBackendSupported(gl: unknown): boolean {
  if (typeof gl !== "object" || gl === null) return false;
  const renderer = getNativeRenderer(gl);
  return renderer !== null && nativeRendererStorageLimit(renderer) !== null;
}

export interface RelightBundleTile {
  readonly file: string;
  readonly sha256: string;
  readonly isEnvironment: boolean;
}

/** Each tile's records, by tile file, once the package is known; null without a package or for a refused tile. */
export function relightTilePromises(tiles: readonly RelightBundleTile[], relightPackage: Promise<RelightModelData | null>): ReadonlyMap<string, Promise<RelightTileSource | null>> {
  const promises = new Map<string, Promise<RelightTileSource | null>>();
  for (const tile of tiles) {
    promises.set(tile.file, relightPackage.then((data) => {
      if (data === null) return null;
      const lookup = relightTileLookup(data.manifest, data.baseUrl, tile.file, tile.sha256);
      if (lookup.kind === "records") return lookup.source;
      if (!tile.isEnvironment) warnRelightFallback("tile", `Part of the hall stays as captured: ${lookup.reason}.`);
      return null;
    }));
  }
  return promises;
}

export interface TileLoad {
  readonly geometry: BufferGeometry;
  readonly records: Uint8Array | null;
}

/** A tile's geometry and its relight records, loaded together; the records never fail the tile. */
export async function loadTileWithRelight(
  loadGeometry: () => Promise<BufferGeometry>,
  relight: Promise<RelightTileSource | null> | undefined,
  supported: boolean,
  signal: AbortSignal,
): Promise<TileLoad> {
  const pending = relight === undefined || !supported
    ? Promise.resolve(null)
    : relight.then((source) => (source === null ? null : loadRelightRecords(source, signal)));
  const [geometry, records] = await Promise.allSettled([loadGeometry(), pending]);
  if (geometry.status === "rejected") {
    const reason: unknown = geometry.reason;
    throw reason instanceof Error ? reason : new Error(String(reason));
  }
  if (records.status === "rejected") {
    const reason: unknown = records.reason;
    if (!signal.aborted) warnRelightFallback("tile", "Part of the hall stays as captured: its relight records could not be read.", reason);
    return { geometry: geometry.value, records: null };
  }
  if (records.value !== null && records.value.length !== nativeSplatCount(geometry.value) * RECORD_BYTES) {
    warnRelightFallback("tile", "Part of the hall stays as captured: its relight records do not match its splats.");
    return { geometry: geometry.value, records: null };
  }
  return { geometry: geometry.value, records: records.value };
}
```

- [ ] **Step 4: Load records in the layer** — in `packages/web/src/components/scene/NativeSplatLayer.tsx`:

Directly after `import { gaussianSplatsAvailable } from "../../lib/splat-access.js";` add:

```ts
import type { RelightTileSource } from "../../lib/relight/relight-manifest.js";
import { loadTileWithRelight, relightBackendSupported } from "../../lib/relight/relight-tile-load.js";
```

In `NativeSplatLayerProps`, directly after `  readonly onError?: (event: NativeSplatErrorEvent) => void;` add:

```ts
  /** This tile's relight records source (T-639 R1b); undefined or null draws it as captured. */
  readonly relight?: Promise<RelightTileSource | null>;
```

Replace:

```ts
function AvailableNativeSplatLayer(props: NativeSplatLayerProps): ReactElement {
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);
```

with:

```ts
function AvailableNativeSplatLayer(props: NativeSplatLayerProps): ReactElement {
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);
  const gl = useThree((state) => state.gl);
  const relight = props.relight;
```

Replace:

```ts
    void import("../../lib/native-splat-loader.js")
      .then(({ loadNativeSplatGeometry }) => loadNativeSplatGeometry(url, { signal: controller.signal }))
      .then((loaded) => {
        if (disposed) { loaded.dispose(); return; }
        geometry = loaded;
        registration.setGeometry(loaded);
```

with:

```ts
    const relightable = relightBackendSupported(gl);
    void import("../../lib/native-splat-loader.js")
      .then(({ loadNativeSplatGeometry }) => loadTileWithRelight(
        () => loadNativeSplatGeometry(url, { signal: controller.signal }), relight, relightable, controller.signal,
      ))
      .then(({ geometry: loaded, records }) => {
        if (disposed) { loaded.dispose(); return; }
        geometry = loaded;
        registration.setGeometry(loaded);
        registration.setRelight(records);
```

and replace `  }, [host, anchor, url, invalidate]);` with:

```ts
  }, [host, anchor, url, invalidate, relight, gl]);
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/relight-tile-load.test.ts`
Expected: PASS, 5 tests.

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/scene/__tests__/NativeSplatLayer.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/relight/relight-tile-load.ts packages/web/src/lib/relight/__tests__/relight-tile-load.test.ts packages/web/src/components/scene/NativeSplatLayer.tsx packages/web/src/components/scene/__tests__/NativeSplatLayer.test.tsx && git diff --cached --stat && git commit -m "feat(relight): each tile loads its relight records beside its geometry, never failing it (T-639 R1b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: The restored floor, drawn lit

**Files:**
- Modify: `packages/web/src/lib/floor-skin.ts`
- Create: `packages/web/src/lib/relight/floor-material.ts`
- Create: `packages/web/src/components/scene/relight-context.ts`
- Modify: `packages/web/src/components/stage/StageFloor.tsx`
- Test: `packages/web/src/lib/__tests__/floor-skin.test.ts`, `packages/web/src/components/stage/__tests__/StageFloor.test.tsx`

**Interfaces:**
- Consumes: Task 7 (`displayNode`, `HIGHLIGHT_KNEE`: the floor's knee is 0.8), Task 10 (`RelightFrame`: `uniforms` including the kernel's `windowOpen` horizon gates, `stencilAtlas`, `floorLight`), Task 2 (`warnRelightFallback`).
- Produces (`floor-skin.ts`): `provenance.kind` is `"measured-photographic" | "restored-albedo"`; `colour.albedoScale?: number` (recorded, never applied again, contract 3); `type FloorSkinVersion = "v1" | "v2"`; `floorSkinPackageUrl(roomSlug: string, version: FloorSkinVersion, configuredBaseUrl: string | undefined): string | null`; `floorSkinVersionOverride(search: string, previewable: boolean): "v1" | null` (`?floorskin=v1`, used by the captured-light check in Task 18).
- Produces (`floor-material.ts`): `litFloorMaterial(map: Texture, frame: RelightFrame): MeshBasicNodeMaterial` (name `stage-floor-lit`).
- Produces (`relight-context.ts`): `interface RelightState { readonly frame: RelightFrame | null; readonly pending: boolean }`; `RelightContext`; `useRelightState(): RelightState`.

The floor geometry is in the tiles' capture frame (`floor-skin.ts`), so `tileToModel × positionLocal` is the model-frame point; `modelToLightUv` finds its 5 cm light texel. The sun on the floor is computed per pixel by projecting each window's two stencils along the sun, sampled bilinearly, so the patches keep sharp edges (spec §4.3). While the relight package loads the floor waits (so v1 is never fetched and dropped); relit, it is v2 drawn lit, else v1 as today; a missing or broken v2 falls back to v1 with one `floor-skin-v2` warning (spec §5).

- [ ] **Step 1: Write the failing tests**

In `packages/web/src/lib/__tests__/floor-skin.test.ts`, replace `  floorColourModeFromSearch, floorExclusionMatrix, floorSkinManifestUrl, floorSkinTier,` with:

```ts
  floorColourModeFromSearch, floorExclusionMatrix, floorSkinManifestUrl, floorSkinPackageUrl, floorSkinTier, floorSkinVersionOverride,
```

and append at the end of the file:

```ts
describe("floor skin v2, the restored floor (T-639 R1b)", () => {
  it("reads a restored-albedo package and its recorded albedo scale", () => {
    const restored = FloorSkinManifestSchema.parse({ ...manifest, provenance: { ...manifest.provenance, kind: "restored-albedo" }, colour: { matched: [1, 1, 1], albedoScale: 0.92 } });
    expect([restored.provenance.kind, restored.colour.albedoScale]).toEqual(["restored-albedo", 0.92]);
    expect(FloorSkinManifestSchema.safeParse({ ...manifest, provenance: { ...manifest.provenance, kind: "generated" } }).success).toBe(false);
  });

  it("finds each version beside the room's tiles, and nothing for other rooms", () => {
    expect(floorSkinPackageUrl("grand-hall", "v2", undefined)).toBe("/splats/trades-hall/grand-hall/floor-skin/v2/floor-skin.json");
    expect(floorSkinPackageUrl("grand-hall", "v1", undefined)).toBe(floorSkinManifestUrl("grand-hall", undefined));
    expect(floorSkinPackageUrl("saloon", "v2", undefined)).toBeNull();
  });

  it("keeps the photographed floor on request only where splats may run", () => {
    expect([floorSkinVersionOverride("?floorskin=v1", true), floorSkinVersionOverride("?floorskin=v1", false), floorSkinVersionOverride("", true)]).toEqual(["v1", null, null]);
  });
});
```

In `packages/web/src/components/stage/__tests__/StageFloor.test.tsx`:

Replace `import { Texture, TextureLoader, type BufferGeometry, type Mesh, type Object3D } from "three";` with:

```ts
import { Texture, TextureLoader, type BufferGeometry, type Material, type Mesh, type Object3D } from "three";
```

Replace `import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";` with:

```ts
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
```

Directly after `import { StageFloor } from "../StageFloor.js";` add:

```ts
import { RelightContext } from "../../scene/relight-context.js";
import { loadRelightModelData } from "../../../lib/relight/relight-assets.js";
import { RelightFrame } from "../../../lib/relight/relight-frame.js";
import { resetRelightWarnings } from "../../../lib/relight/relight-warning.js";
import { buildTestPackage } from "../../../lib/relight/__tests__/relight-test-package.js";
```

Replace `let manifestResponse: (() => Response) | null = null;` with `let manifestResponse: ((url: string) => Response) | null = null;`, and in the `fetch` stub replace `manifestResponse?.()` with `manifestResponse?.(url)`.

Append at the end of the file:

```tsx
describe("the restored floor, lit by the relight setting (T-639 R1b)", () => {
  let frame: RelightFrame;
  beforeAll(async () => {
    const pkg = buildTestPackage();
    frame = new RelightFrame(await loadRelightModelData(pkg.fetch, pkg.manifestUrl));
  });
  afterEach(() => { resetRelightWarnings(); });
  const RESTORED = { ...MANIFEST, provenance: { ...MANIFEST.provenance, kind: "restored-albedo" }, colour: { matched: [1, 1, 1], albedoScale: 0.92 } };
  const json = (value: unknown): Response => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
  const materialNames = (): string[] => tiles().map((mesh) => (mesh.material as Material).name);

  it("draws floor skin v2 lit while the hall is relit", async () => {
    manifestResponse = (url) => json(url.includes("/floor-skin/v2/") ? RESTORED : MANIFEST);
    mounted = mountInStubRoot(<RelightContext.Provider value={{ frame, pending: false }}><Harness /></RelightContext.Provider>);
    await settle();
    expect(materialNames()).toEqual(["stage-floor-lit", "stage-floor-lit"]);
    expect(requests.filter((url) => url.endsWith("/floor-skin.json"))).toEqual([expect.stringContaining("/floor-skin/v2/")]);
  });

  it("falls back to floor skin v1, drawn as photographed, with one warning when v2 is missing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    manifestResponse = (url) => (url.includes("/floor-skin/v2/") ? new Response(null, { status: 404 }) : json(MANIFEST));
    mounted = mountInStubRoot(<RelightContext.Provider value={{ frame, pending: false }}><Harness /></RelightContext.Provider>);
    await settle();
    expect(materialNames()).toEqual(["", ""]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("waits for the relight package before choosing a floor", async () => {
    mounted = mountInStubRoot(<RelightContext.Provider value={{ frame: null, pending: true }}><Harness /></RelightContext.Provider>);
    await settle();
    expect(requests).toEqual([]);
    expect(tiles()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/floor-skin.test.ts`
Expected: FAIL — `floorSkinPackageUrl` and `floorSkinVersionOverride` are not exported; `restored-albedo` is refused.

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/stage/__tests__/StageFloor.test.tsx`
Expected: FAIL — cannot find module `../../scene/relight-context.js`.

- [ ] **Step 3: Extend the floor skin** — in `packages/web/src/lib/floor-skin.ts`:

Replace `    kind: z.literal("measured-photographic"),` with:

```ts
    /** v1 wears the floor's photographs; v2 is the restored, lighting-neutral albedo drawn lit (T-639 R1b). */
    kind: z.enum(["measured-photographic", "restored-albedo"]),
```

Replace `  colour: z.object({ matched: vec3 }),` with:

```ts
  /** `albedoScale` records the factor already applied to a restored albedo; it is never applied again. */
  colour: z.object({ matched: vec3, albedoScale: z.number().positive().optional() }),
```

Directly after the `floorSkinManifestUrl` function add:

```ts
export type FloorSkinVersion = "v1" | "v2";

/** A room's floor-skin package of one version, beside its tiles: v1 photographed, v2 restored (T-639 R1b). */
export function floorSkinPackageUrl(roomSlug: string, version: FloorSkinVersion, configuredBaseUrl: string | undefined): string | null {
  if (FLOOR_SKIN_ROOMS[roomSlug] === undefined) return null;
  return `${splatBaseUrl(configuredBaseUrl)}/${GENERATED_VENUE_SLUG}/${roomSlug}/floor-skin/${version}/floor-skin.json`;
}

/** `?floorskin=v1` keeps the photographed floor while relit, where splats may run (the captured-light check). */
export function floorSkinVersionOverride(search: string, previewable: boolean): "v1" | null {
  return previewable && new URLSearchParams(search).get("floorskin") === "v1" ? "v1" : null;
}
```

- [ ] **Step 4: The relight context** — create `packages/web/src/components/scene/relight-context.ts`:

```ts
import { createContext, useContext } from "react";
import type { RelightFrame } from "../../lib/relight/relight-frame.js";

/** The relit hall's frame for what draws with it (the floor; the furniture in I3). Pending while the package loads. */
export interface RelightState {
  readonly frame: RelightFrame | null;
  readonly pending: boolean;
}

export const RelightContext = createContext<RelightState>({ frame: null, pending: false });

export function useRelightState(): RelightState {
  return useContext(RelightContext);
}
```

- [ ] **Step 5: The lit floor material** — create `packages/web/src/lib/relight/floor-material.ts`:

```ts
import { FrontSide, type Texture } from "three";
import { MeshBasicNodeMaterial, type Node } from "three/webgpu";
import { Fn, dot, float, max, positionLocal, select, texture as textureNode, uv, vec2, vec4 } from "three/tsl";
import { HIGHLIGHT_KNEE, displayNode } from "./display.js";
import { WINDOW_COUNT } from "./relight-codec.js";
import type { RelightFrame } from "./relight-frame.js";

/** Stencil plane `index`'s transmittance along the sun from a floor point, sampled bilinearly: sharp patch edges. */
function planeTransmittance(frame: RelightFrame, index: number, p: Node<"vec3">): Node<"float"> {
  const u = frame.uniforms;
  const origin = u.planeOrigin.element(index), normal = u.planeNormal.element(index);
  const size = u.planeSize.element(index), rect = u.atlasRect.element(index);
  const denominator = dot(u.sunDir, normal);
  const t = dot(origin.sub(p), normal).div(max(denominator, 1e-6));
  const d = p.add(u.sunDir.mul(t)).sub(origin);
  const a = dot(d, u.planeU.element(index)), b = dot(d, u.planeV.element(index));
  const inside = denominator.greaterThan(1e-6).and(t.greaterThan(0))
    .and(a.greaterThanEqual(0)).and(a.lessThanEqual(size.x)).and(b.greaterThanEqual(0)).and(b.lessThanEqual(size.y));
  // Cell (col, row) centres at atlas texel (x0 + col + 0.5, y0 + row + 0.5); a blank row separates stencils.
  const atlas = vec2(frame.stencilAtlas.image.width, frame.stencilAtlas.image.height);
  const texel = vec2(rect.x.add(a.div(size.x).mul(rect.z.sub(1))).add(0.5), rect.y.add(b.div(size.y).mul(rect.w.sub(1))).add(0.5));
  return select(inside, textureNode(frame.stencilAtlas, texel.div(atlas)).level(float(0)).r, float(0));
}

/**
 * The restored floor lit by the relight setting (spec §4.3): albedo × (the nine
 * sources and their bounce per 5 cm texel, plus the sun through the window
 * stencils per pixel, each window gated by its horizon), then the shared display with a knee of 0.8.
 */
export function litFloorMaterial(map: Texture, frame: RelightFrame): MeshBasicNodeMaterial {
  const u = frame.uniforms;
  const material = new MeshBasicNodeMaterial({ side: FrontSide, fog: false, toneMapped: false });
  material.name = "stage-floor-lit";
  material.colorNode = Fn(() => {
    const albedo = textureNode(map, uv());
    const model = u.tileToModel.mul(vec4(positionLocal, 1)).xyz.toVar();
    const base = textureNode(frame.floorLight, u.modelToLightUv.mul(vec4(model, 1)).xy).level(float(0)).rgb;
    let visibility: Node<"float"> = float(0);
    for (let w = 0; w < WINDOW_COUNT; w += 1) {
      visibility = visibility.add(u.windowOpen.element(w).mul(planeTransmittance(frame, 2 * w, model)).mul(planeTransmittance(frame, 2 * w + 1, model)));
    }
    // The floor faces up the model frame (e57, z up).
    const sun = u.sunRgb.mul(visibility.mul(u.fresnelAtSun).mul(max(u.sunDir.z, 0)).mul(u.sunOn));
    return vec4(displayNode(albedo.rgb.mul(base.add(sun)), u.display, float(HIGHLIGHT_KNEE)), albedo.a);
  })();
  material.alphaTest = 0.5;
  return material;
}
```

- [ ] **Step 6: Draw the restored floor** — in `packages/web/src/components/stage/StageFloor.tsx`:

Replace:

```ts
  floorSkinManifestUrl,
  floorSkinTier,
  floorSkinTileGeometry,
  type FloorSkinManifest,
  type FloorSkinTier,
} from "../../lib/floor-skin.js";
```

with:

```ts
  floorSkinPackageUrl,
  floorSkinTier,
  floorSkinTileGeometry,
  floorSkinVersionOverride,
  type FloorSkinManifest,
  type FloorSkinTier,
  type FloorSkinVersion,
} from "../../lib/floor-skin.js";
import { litFloorMaterial } from "../../lib/relight/floor-material.js";
import { warnRelightFallback } from "../../lib/relight/relight-warning.js";
import { useRelightState } from "../scene/relight-context.js";
```

Replace `async function loadFloor(url: string, roomSlug: string, tierName: FloorSkinTier, signal: AbortSignal): Promise<LoadedFloor | null> {` with:

```ts
async function loadFloor(url: string, roomSlug: string, tierName: FloorSkinTier, signal: AbortSignal, kind: FloorSkinManifest["provenance"]["kind"]): Promise<LoadedFloor | null> {
```

and directly after that function's venue/room check (the `throw new Error(\`The floor skin at ${url} was built for …\`);` line and its closing `}`), add:

```ts
  if (manifest.provenance.kind !== kind) throw new Error(`The floor skin at ${url} is ${manifest.provenance.kind}, not ${kind}.`);
```

Directly after the `loadFloor` function add:

```ts
/**
 * The restored floor (v2) while the hall is relit, else the photographed floor
 * (v1); a missing or broken v2 falls back to v1 with one warning (spec §5).
 */
async function loadRoomFloor(roomSlug: string, version: FloorSkinVersion, tierName: FloorSkinTier, signal: AbortSignal): Promise<LoadedFloor | null> {
  const base = import.meta.env.VITE_SPLAT_BASE_URL;
  const restoredUrl = version === "v2" ? floorSkinPackageUrl(roomSlug, "v2", base) : null;
  if (restoredUrl !== null) {
    try {
      const restored = await loadFloor(restoredUrl, roomSlug, tierName, signal, "restored-albedo");
      if (restored !== null) return restored;
      warnRelightFallback("floor-skin-v2", "The restored floor is not published; the photographed floor is shown.");
    } catch (reason: unknown) {
      if (signal.aborted) throw reason;
      warnRelightFallback("floor-skin-v2", "The restored floor could not be used; the photographed floor is shown.", reason);
    }
  }
  const photographedUrl = floorSkinPackageUrl(roomSlug, "v1", base);
  return photographedUrl === null ? null : loadFloor(photographedUrl, roomSlug, tierName, signal, "measured-photographic");
}
```

Replace:

```ts
  const splatsAvailable = gaussianSplatsAvailable();
  const url = roomSlug === null || !splatsAvailable ? null : floorSkinManifestUrl(roomSlug, import.meta.env.VITE_SPLAT_BASE_URL);
  const key = url === null ? null : `${url}|${tierName}`;
  const colourMode = floorColourModeFromSearch(typeof window === "undefined" ? "" : window.location.search, splatsAvailable);
```

with:

```ts
  const splatsAvailable = gaussianSplatsAvailable();
  const search = typeof window === "undefined" ? "" : window.location.search;
  // Relit, the floor is the restored albedo drawn by the same light (T-639 R1b). It waits for the
  // relight package, so the photographed floor is not fetched first and then dropped.
  const relight = useRelightState();
  const relightFrame = relight.frame;
  const version: FloorSkinVersion = relightFrame !== null && floorSkinVersionOverride(search, splatsAvailable) === null ? "v2" : "v1";
  const url = roomSlug === null || !splatsAvailable || relight.pending ? null : floorSkinPackageUrl(roomSlug, version, import.meta.env.VITE_SPLAT_BASE_URL);
  const key = url === null ? null : `${url}|${tierName}`;
  const colourMode = floorColourModeFromSearch(search, splatsAvailable);
```

Replace `    loadFloor(url, roomSlug, tierName, controller.signal)` with `    loadRoomFloor(roomSlug, version, tierName, controller.signal)`, and `  }, [url, roomSlug, tierName, invalidate]);` with `  }, [url, roomSlug, tierName, invalidate, version]);`.

Replace:

```ts
  const materials = useMemo(() => {
    if (floor === null) return [];
    const gain = uniform(new Vector3(...floorColourGain(floor.manifest, colourMode)));
```

with:

```ts
  const materials = useMemo(() => {
    if (floor === null) return [];
    // The restored albedo is drawn lit; a photographed floor already carries its light.
    if (relightFrame !== null && floor.manifest.provenance.kind === "restored-albedo") {
      return floor.tiles.map((tile) => litFloorMaterial(tile.map, relightFrame));
    }
    const gain = uniform(new Vector3(...floorColourGain(floor.manifest, colourMode)));
```

and `  }, [floor, colourMode]);` with `  }, [floor, colourMode, relightFrame]);`.

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/floor-skin.test.ts`
Expected: PASS (the Task 0 count plus 3).

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/stage/__tests__/StageFloor.test.tsx`
Expected: PASS (the Task 0 count plus 3).

Run: `cd D:/claude/real-hall/repo && pnpm --filter @omnitwin/web typecheck`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/floor-skin.ts packages/web/src/lib/relight/floor-material.ts packages/web/src/components/scene/relight-context.ts packages/web/src/components/stage/StageFloor.tsx packages/web/src/lib/__tests__/floor-skin.test.ts packages/web/src/components/stage/__tests__/StageFloor.test.tsx && git diff --cached --stat && git commit -m "feat(relight): the restored floor drawn lit by the relight setting, the photographed floor as fallback (T-639 R1b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: The relight provider, the sky panels and the walk scene

**Files:**
- Create: `packages/web/src/lib/relight/sky-panels.ts`
- Create: `packages/web/src/components/scene/RelightSkyPanels.tsx`
- Create: `packages/web/src/components/scene/RelightProvider.tsx`
- Modify: `packages/web/src/components/rooms/RoomSplatScene.tsx`
- Modify: `packages/web/src/lib/splat-staging-plugin.ts`
- Modify: `packages/web/src/components/__tests__/stub-r3f-root.tsx`
- Test: `packages/web/src/lib/relight/__tests__/sky-panels.test.ts`, `packages/web/src/components/scene/__tests__/RelightProvider.test.tsx`, `packages/web/src/components/rooms/__tests__/RoomSplatScene.test.tsx`, `packages/web/src/lib/__tests__/splat-staging-plugin.test.ts`

**Interfaces:**
- Consumes: Tasks 5, 7 (`skyPanelNode`, which displays the sky with a knee of 0.8), 8, 10, 12, 13, 14.
- Produces (`sky-panels.ts`): `SKY_PANEL_OFFSET = 0.01`; `skyPanelGeometry(planes: readonly Pick<StencilPlane, "origin" | "u" | "v" | "width" | "height" | "normal">[]): BufferGeometry` (model frame, 1 cm outside each glass plane, `uv.y` 0 at the sill and 1 at the top); `skyPanelMaterial(frame: RelightFrame): MeshBasicNodeMaterial` (name `relight-sky-panel`).
- Produces: `RelightSkyPanels({ frame, transform })`; `RelightProvider({ relightPackage: Promise<RelightModelData | null> | null, transform: RuntimeAssetViewTransform, children })` providing `RelightContext`, setting the frame on the host, applying the store's choice once per animation frame and setting the store's `status`.
- Produces (`stub-r3f-root.tsx`): `mountInStubRoot(element, width?, height?, renderer?: Record<string, unknown>)` (fields merged into the stub renderer).
- Produces (`RoomSplatScene`): the relit walk scene; each `NativeSplatLayer` receives `relight`; `?light=<preset>` selects a preset where previewable.

The relight package (`venviewer.relight.v1`) holds `.json`, `.gz` and `.png` files under `relight/`; the development server serves them only inside a `relight` or `floor-skin` directory.

- [ ] **Step 1: Write the failing tests**

`packages/web/src/lib/relight/__tests__/sky-panels.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SKY_PANEL_OFFSET, skyPanelGeometry } from "../sky-panels.js";

describe("the sky panels (T-639 R1b)", () => {
  it("sets a quad 1 cm outside each glass plane, bright end at the top", () => {
    const glass = { origin: [0, -0.5, 3] as const, u: [1, 0, 0] as const, v: [0, 0, -1] as const, width: 2, height: 3, normal: [0, -1, 0] as const };
    const geometry = skyPanelGeometry([glass, { ...glass, origin: [4, -0.5, 3] as const }]);
    const position = geometry.getAttribute("position"), uv = geometry.getAttribute("uv");
    const close = (actual: number[], expected: number[]): void => { expected.forEach((value, axis) => { expect(actual[axis]).toBeCloseTo(value, 6); }); };
    expect([position.count, geometry.getIndex()?.count]).toEqual([8, 12]);
    close([position.getX(0), position.getY(0), position.getZ(0)], [0, -0.5 - SKY_PANEL_OFFSET, 3]);
    close([position.getX(2), position.getY(2), position.getZ(2)], [2, -0.5 - SKY_PANEL_OFFSET, 0]);
    expect([uv.getY(0), uv.getY(2)]).toEqual([1, 0]);
    expect(position.getX(4)).toBe(4);
  });
});
```

`packages/web/src/components/scene/__tests__/RelightProvider.test.tsx`:

```tsx
import { act } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mesh, Object3D } from "three";
import { PRESET_DISPLAY } from "../../../lib/light-setting.js";
import { NativeSplatScene } from "../../../lib/native-splat-scene.js";
import { loadRelightModelData, type RelightModelData } from "../../../lib/relight/relight-assets.js";
import { RelightFrame } from "../../../lib/relight/relight-frame.js";
import { buildTestPackage } from "../../../lib/relight/__tests__/relight-test-package.js";
import { useLightSettingStore } from "../../../stores/light-setting-store.js";
import { mountInStubRoot, type StubRoot } from "../../__tests__/stub-r3f-root.js";
import { RelightProvider } from "../RelightProvider.js";
import { useRelightState } from "../relight-context.js";
import type { RuntimeAssetViewTransform } from "../../../lib/runtime-package-resolution.js";

const WEBGPU = { isWebGPURenderer: true, backend: { device: { limits: { maxStorageBufferBindingSize: 134_217_728 } } } };
const IDENTITY: RuntimeAssetViewTransform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, note: "identity" };
const seen: { frame: RelightFrame | null; pending: boolean }[] = [];
function Probe(): null {
  seen.push(useRelightState());
  return null;
}

let data: RelightModelData;
let mounted: StubRoot | null = null;
const initial = useLightSettingStore.getState();
beforeAll(async () => {
  const pkg = buildTestPackage();
  data = await loadRelightModelData(pkg.fetch, pkg.manifestUrl);
});
beforeEach(() => { useLightSettingStore.setState(initial, true); seen.length = 0; });
afterEach(() => { mounted?.unmount(); mounted = null; vi.restoreAllMocks(); });

async function settle(ms = 60): Promise<void> {
  await act(async () => { await new Promise<void>((resolve) => { setTimeout(resolve, ms); }); });
}
function skyPanels(): Mesh[] {
  const found: Mesh[] = [];
  mounted?.scene.traverse((object: Object3D) => { if (object.name === "relight-sky-panel") found.push(object as Mesh); });
  return found;
}

describe("the relight provider (T-639 R1b)", () => {
  it("draws the hall as captured without a package", async () => {
    const setRelight = vi.spyOn(NativeSplatScene.prototype, "setRelight");
    mounted = mountInStubRoot(<RelightProvider relightPackage={null} transform={IDENTITY}><Probe /></RelightProvider>, 1440, 900, WEBGPU);
    await settle();
    expect(setRelight).not.toHaveBeenCalled();
    expect(useLightSettingStore.getState().status).toBe("off");
    expect(seen.at(-1)).toEqual({ frame: null, pending: false });
  });

  it("never relights on the WebGL2 fallback", async () => {
    const setRelight = vi.spyOn(NativeSplatScene.prototype, "setRelight");
    mounted = mountInStubRoot(<RelightProvider relightPackage={Promise.resolve(data)} transform={IDENTITY}><Probe /></RelightProvider>);
    await settle();
    expect(setRelight).not.toHaveBeenCalled();
    expect(seen.at(-1)).toEqual({ frame: null, pending: false });
  });

  it("puts the package's frame on the host with the light applied, and draws the sky panels", async () => {
    const setRelight = vi.spyOn(NativeSplatScene.prototype, "setRelight");
    let release: (value: RelightModelData) => void = () => undefined;
    const pending = new Promise<RelightModelData>((resolve) => { release = resolve; });
    mounted = mountInStubRoot(<RelightProvider relightPackage={pending} transform={IDENTITY}><Probe /></RelightProvider>, 1440, 900, WEBGPU);
    await settle();
    expect(seen.at(-1)?.pending).toBe(true);
    expect(useLightSettingStore.getState().status).toBe("loading");
    release(data);
    await settle();
    const frame = seen.at(-1)?.frame;
    expect(frame).toBeInstanceOf(RelightFrame);
    expect(setRelight).toHaveBeenCalledWith(expect.anything(), frame);
    expect(frame?.current?.display).toEqual(PRESET_DISPLAY.captured);
    expect(useLightSettingStore.getState().status).toBe("ready");
    expect(skyPanels()).toHaveLength(1);
  });

  it("applies a new choice within an animation frame and reruns the host's passes", async () => {
    const runRelight = vi.spyOn(NativeSplatScene.prototype, "runRelight");
    mounted = mountInStubRoot(<RelightProvider relightPackage={Promise.resolve(data)} transform={IDENTITY}><Probe /></RelightProvider>, 1440, 900, WEBGPU);
    await settle();
    runRelight.mockClear();
    act(() => { useLightSettingStore.getState().selectPreset("night"); });
    await settle();
    expect(seen.at(-1)?.frame?.current?.display).toEqual(PRESET_DISPLAY.night);
    expect(runRelight).toHaveBeenCalledOnce();
  });

  it("takes the frame off the host and returns the hall to captured on unmount", async () => {
    const clearRelight = vi.spyOn(NativeSplatScene.prototype, "clearRelight");
    mounted = mountInStubRoot(<RelightProvider relightPackage={Promise.resolve(data)} transform={IDENTITY}><Probe /></RelightProvider>, 1440, 900, WEBGPU);
    await settle();
    mounted.unmount();
    mounted = null;
    expect(clearRelight).toHaveBeenCalledOnce();
    expect(useLightSettingStore.getState().status).toBe("off");
  });
});
```

In `packages/web/src/components/rooms/__tests__/RoomSplatScene.test.tsx`:

In the `recorded` hoisted object, directly after `  floor: null as Record<string, unknown> | null,` add:

```ts
  /** The relight provider's package, as last rendered. */
  relight: undefined as unknown,
  loadPackage: vi.fn((_url: string) => Promise.resolve(null)),
```

Directly after the `vi.mock("../../stage/StageFloor.js", …)` block add:

```ts
vi.mock("../../scene/RelightProvider.js", () => ({
  RelightProvider: ({ children, relightPackage }: { readonly children?: ReactNode; readonly relightPackage: unknown }) => {
    recorded.relight = relightPackage;
    return <>{children}</>;
  },
}));
vi.mock("../../../lib/relight-package.js", () => ({ loadRelightPackage: recorded.loadPackage }));
```

Append at the end of the file:

```tsx
describe("RoomSplatScene relit (T-639 R1b)", () => {
  beforeEach(() => {
    recorded.layers.length = 0;
    recorded.mounted.clear();
    recorded.loadPackage.mockClear();
    recorded.relight = undefined;
    if (typeof window.matchMedia !== "function") {
      Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false }) });
    }
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); window.history.replaceState(null, "", "/"); });

  const created = (gl: object): void => {
    (recorded.onCreated as (state: object) => void)({ scene: new Scene(), camera: new PerspectiveCamera(), gl });
  };

  it("loads the room's relight package once the renderer is WebGPU, and hands every tile its records", async () => {
    render(<RoomSplatScene room={ROOM} />);
    expect(recorded.loadPackage).not.toHaveBeenCalled();
    expect(recorded.relight).toBeInstanceOf(Promise);
    expect(mountedLayers().length).toBeGreaterThan(0);
    expect(mountedLayers().every((layer) => layer["relight"] instanceof Promise)).toBe(true);
    created({ isWebGPURenderer: true, backend: { device: { limits: { maxStorageBufferBindingSize: 134_217_728 } } } });
    await act(async () => { await Promise.resolve(); });
    expect(recorded.loadPackage).toHaveBeenCalledWith("/splats/trades-hall/grand-hall/relight/v1/manifest.json");
  });

  it("never loads the package on the WebGL2 fallback", async () => {
    render(<RoomSplatScene room={ROOM} />);
    created({ isWebGPURenderer: true, backend: {} });
    await expect(recorded.relight as Promise<unknown>).resolves.toBeNull();
    expect(recorded.loadPackage).not.toHaveBeenCalled();
  });

  it("keeps the hall as captured with ?relight=off", () => {
    window.history.replaceState(null, "", "/room/grand-hall?relight=off");
    render(<RoomSplatScene room={ROOM} />);
    expect(recorded.loadPackage).not.toHaveBeenCalled();
    expect(recorded.relight).toBeNull();
    expect(mountedLayers().every((layer) => layer["relight"] === undefined)).toBe(true);
  });
});
```

In `packages/web/src/lib/__tests__/splat-staging-plugin.test.ts`, append inside the first `describe` block (the one containing `serves a room's floor-skin package files`), before its closing `});`:

```ts
  it("serves a room's relight package files, and only inside a relight directory (T-639 R1b)", () => {
    for (const file of ["manifest.json", "probes.bin.gz", "windows/W1-inner.png", "floor/light-0.png", "tiles/0_0.relight.gz"]) {
      expect(resolveStagedSplatPath(ROOT, `/splats/trades-hall/grand-hall/relight/v1/${file}`))
        .toBe(join(ROOT, "trades-hall", "grand-hall", "relight", "v1", ...file.split("/")));
    }
    expect(resolveStagedSplatPath(ROOT, "/splats/trades-hall/grand-hall/probes.bin.gz")).toBeNull();
    expect(resolveStagedSplatPath(ROOT, "/splats/trades-hall/grand-hall/relight/../secret.png")).toBeNull();
  });

  it("labels the relight package's stencils and light maps as PNG images (T-639 R1b)", () => {
    expect(stagedContentType(join(ROOT, "a", "relight", "v1", "windows", "W1-glass.png"))).toBe("image/png");
    expect(stagedContentType(join(ROOT, "a", "relight", "v1", "probes.bin.gz"))).toBe("application/octet-stream");
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/sky-panels.test.ts`
Expected: FAIL — cannot find module `../sky-panels.js`.

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/scene/__tests__/RelightProvider.test.tsx`
Expected: FAIL — cannot find module `../RelightProvider.js`.

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/rooms/__tests__/RoomSplatScene.test.tsx`
Expected: FAIL — the three new tests (no layer receives `relight`, `loadRelightPackage` is never called); the existing tests pass.

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/splat-staging-plugin.test.ts`
Expected: FAIL — the two new tests.

- [ ] **Step 3: The sky panels** — create `packages/web/src/lib/relight/sky-panels.ts`:

```ts
import { BufferAttribute, BufferGeometry, DoubleSide } from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { uv, vec4 } from "three/tsl";
import { skyPanelNode } from "./display.js";
import type { RelightFrame } from "./relight-frame.js";
import type { StencilPlane } from "./relight-kernel.js";

/** Metres beyond each glass plane (its normal points out of the room). */
export const SKY_PANEL_OFFSET = 0.01;

type PanelPlane = Pick<StencilPlane, "origin" | "u" | "v" | "width" | "height" | "normal">;

/** One quad per window in the model frame; `v` runs down from the top, so uv.y is 1 at the top and 0 at the sill. */
export function skyPanelGeometry(planes: readonly PanelPlane[]): BufferGeometry {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  planes.forEach((plane, index) => {
    for (const [a, b] of [[0, 0], [plane.width, 0], [plane.width, plane.height], [0, plane.height]] as const) {
      for (let axis = 0; axis < 3; axis += 1) {
        positions.push((plane.origin[axis] ?? 0) + a * (plane.u[axis] ?? 0) + b * (plane.v[axis] ?? 0) + SKY_PANEL_OFFSET * (plane.normal[axis] ?? 0));
      }
      uvs.push(a / plane.width, 1 - b / plane.height);
    }
    const first = index * 4;
    indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("uv", new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  return geometry;
}

/** The R1 sky: a flat gradient, dark at night and bright by day, through the same display (spec §4.3). */
export function skyPanelMaterial(frame: RelightFrame): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({ side: DoubleSide, fog: false, toneMapped: false });
  material.name = "relight-sky-panel";
  // skyPanelNode calls displayNode with the sky's knee, 0.8 (Task 7).
  material.colorNode = vec4(skyPanelNode(uv().y, frame.uniforms.sky, frame.uniforms.display), 1);
  return material;
}
```

- [ ] **Step 4: The sky panel component** — create `packages/web/src/components/scene/RelightSkyPanels.tsx`:

```tsx
import { useEffect, useMemo, type ReactElement } from "react";
import type { RuntimeAssetViewTransform } from "../../lib/runtime-package-resolution.js";
import type { RelightFrame } from "../../lib/relight/relight-frame.js";
import { skyPanelGeometry, skyPanelMaterial } from "../../lib/relight/sky-panels.js";

/**
 * A sky panel behind each window (spec §4.3). The panels are built in the
 * package's model frame; model → tile (tileToModel⁻¹) and the room's placement
 * put them where the splats are.
 */
export function RelightSkyPanels({ frame, transform }: {
  readonly frame: RelightFrame;
  readonly transform: RuntimeAssetViewTransform;
}): ReactElement {
  const geometry = useMemo(() => skyPanelGeometry(frame.data.manifest.windows.map((window) => window.planes.glass)), [frame]);
  const material = useMemo(() => skyPanelMaterial(frame), [frame]);
  const modelToTile = useMemo(() => frame.tileToModel.clone().invert(), [frame]);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  const [px, py, pz] = transform.position;
  const [rx, ry, rz] = transform.rotation;
  return (
    <group position={[px, py, pz]} rotation={[rx, ry, rz]} scale={transform.scale} name="relight-sky-panels">
      <mesh geometry={geometry} material={material} matrix={modelToTile} matrixAutoUpdate={false} name="relight-sky-panel" raycast={() => undefined} />
    </group>
  );
}
```

- [ ] **Step 5: The provider** — create `packages/web/src/components/scene/RelightProvider.tsx`:

```tsx
import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { useThree } from "@react-three/fiber";
import { nativeSplatScene } from "../../lib/native-splat-scene.js";
import type { RelightModelData } from "../../lib/relight/relight-assets.js";
import { applicationForChoice } from "../../lib/relight/relight-apply.js";
import { RelightFrame } from "../../lib/relight/relight-frame.js";
import { relightBackendSupported } from "../../lib/relight/relight-tile-load.js";
import type { RuntimeAssetViewTransform } from "../../lib/runtime-package-resolution.js";
import { useLightSettingStore } from "../../stores/light-setting-store.js";
import { RelightContext, type RelightState } from "./relight-context.js";
import { RelightSkyPanels } from "./RelightSkyPanels.js";

export interface RelightProviderProps {
  /** The room's relight package, or null to draw the hall as captured. */
  readonly relightPackage: Promise<RelightModelData | null> | null;
  readonly transform: RuntimeAssetViewTransform;
  readonly children?: ReactNode;
}

/**
 * The relit hall (T-639 R1b): the package becomes a frame on the native host,
 * the store's light choice is applied to it (once per animation frame while the
 * slider moves) and every cached draw reruns its pass; the sky panels draw
 * behind the windows. No package, no WebGPU: the hall as captured.
 */
export function RelightProvider({ relightPackage, transform, children }: RelightProviderProps): ReactElement {
  const scene = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const host = useMemo(() => nativeSplatScene(scene), [scene]);
  const supported = relightBackendSupported(gl);
  const wanted = supported ? relightPackage : null;
  const [loaded, setLoaded] = useState<{ readonly from: Promise<RelightModelData | null>; readonly frame: RelightFrame | null } | null>(null);
  const frame = loaded !== null && loaded.from === wanted ? loaded.frame : null;
  const state = useMemo<RelightState>(() => ({ frame, pending: wanted !== null && loaded?.from !== wanted }), [frame, wanted, loaded]);

  useEffect(() => {
    const { setStatus } = useLightSettingStore.getState();
    if (wanted === null) { setStatus("off"); return; }
    setStatus("loading");
    const owner = {};
    let cancelled = false;
    let created: RelightFrame | null = null;
    let request = 0;
    let stop: (() => void)[] = [];
    void wanted.then((data) => {
      if (cancelled) return;
      if (data === null) {
        setStatus("off");
        setLoaded({ from: wanted, frame: null });
        return;
      }
      const next = new RelightFrame(data);
      created = next;
      const apply = (): void => {
        next.apply(applicationForChoice(next.inputs, useLightSettingStore.getState().choice, (light) => next.meanLight(light)));
      };
      apply();
      stop = [
        next.onApply(() => { host.runRelight(); invalidate(); }),
        useLightSettingStore.subscribe((current, previous) => {
          if (current.choice === previous.choice) return;
          cancelAnimationFrame(request);
          request = requestAnimationFrame(apply);
        }),
      ];
      host.setRelight(owner, next);
      setLoaded({ from: wanted, frame: next });
      setStatus("ready");
      invalidate();
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(request);
      for (const unsubscribe of stop) unsubscribe();
      host.clearRelight(owner);
      created?.dispose();
      useLightSettingStore.getState().setStatus("off");
    };
  }, [wanted, host, invalidate]);

  return (
    <RelightContext.Provider value={state}>
      {children}
      {frame !== null && <RelightSkyPanels frame={frame} transform={transform} />}
    </RelightContext.Provider>
  );
}
```

- [ ] **Step 6: The stub root's renderer fields** — in `packages/web/src/components/__tests__/stub-r3f-root.tsx`, replace:

```ts
export function mountInStubRoot(element: ReactElement, width = 1440, height = 900): StubRoot {
  const canvas = document.createElement("canvas");
  const root: ReconcilerRoot<HTMLCanvasElement> = createRoot(canvas);
  root.configure({ gl: stubRenderer(canvas), frameloop: "never", size: { width, height, top: 0, left: 0 } });
```

with:

```ts
/** `renderer` fields are merged into the stub renderer (for example a WebGPU device's limits). */
export function mountInStubRoot(element: ReactElement, width = 1440, height = 900, renderer: Record<string, unknown> = {}): StubRoot {
  const canvas = document.createElement("canvas");
  const root: ReconcilerRoot<HTMLCanvasElement> = createRoot(canvas);
  root.configure({ gl: { ...stubRenderer(canvas), ...renderer }, frameloop: "never", size: { width, height, top: 0, left: 0 } });
```

- [ ] **Step 7: Relight the walk scene** — in `packages/web/src/components/rooms/RoomSplatScene.tsx`:

Directly after `import { StageFloor } from "../stage/StageFloor.js";` add:

```ts
import { RelightProvider } from "../scene/RelightProvider.js";
import { lightPresetFromSearch, relightEligible, relightOffBySearch } from "../../lib/light-setting.js";
import { loadRelightPackage } from "../../lib/relight-package.js";
import { relightManifestUrl } from "../../lib/relight/relight-manifest.js";
import { relightBackendSupported, relightTilePromises } from "../../lib/relight/relight-tile-load.js";
import { gaussianSplatsAvailable } from "../../lib/splat-access.js";
import { useLightSettingStore } from "../../stores/light-setting-store.js";
```

Replace `  const handleCreated = useCallback((state: RootState) => { captureSource.current = state; }, []);` with:

```ts
  const handleCreated = useCallback((state: RootState) => {
    captureSource.current = state;
    relightBackend.resolve(relightBackendSupported(state.gl));
  }, [relightBackend]);
```

Directly after the `settledDpr` constant (the statement ending `typeof window === "undefined" ? 0 : window.innerHeight,\n  );`) add:

```ts
  // The relit hall (T-639 R1b): previews only, desktop class only, never with ?relight=off. The
  // package promise exists from the first render so every tile keeps one identity; it loads only
  // once the canvas reports a WebGPU renderer, and resolves null on the WebGL2 fallback.
  const previewable = gaussianSplatsAvailable();
  const search = typeof window === "undefined" ? "" : window.location.search;
  const relightOn = relightEligible(previewable, profile.tier, relightOffBySearch(search, previewable));
  const relightUrl = relightOn ? relightManifestUrl(room, import.meta.env.VITE_SPLAT_BASE_URL) : null;
  const relightBackend = useMemo(() => {
    let settle: (supported: boolean) => void = () => undefined;
    const promise = new Promise<boolean>((resolve) => { settle = resolve; });
    return { promise, resolve: (supported: boolean): void => { settle(supported); } };
  }, []);
  const relightPackage = useMemo(
    () => (relightUrl === null ? null : relightBackend.promise.then((supported) => (supported ? loadRelightPackage(relightUrl) : null))),
    [relightUrl, relightBackend],
  );
  const relightTiles = useMemo(
    () => (relightPackage === null || bundle === null ? null : relightTilePromises(bundle.tiles, relightPackage)),
    [relightPackage, bundle],
  );
  useEffect(() => {
    const preset = lightPresetFromSearch(window.location.search, previewable);
    if (preset !== null) useLightSettingStore.getState().selectPreset(preset);
  }, [previewable]);
```

In the returned JSX, replace everything from `      <ambientLight intensity={1} />` through the line before `    </Canvas>` (the `InteriorCamera` block's closing `      )}`) with:

```tsx
      <RelightProvider relightPackage={relightPackage} transform={transform}>
        <ambientLight intensity={1} />
        {/* One renderer host per scene, owned by no tile: the ladder drops the
            coarse room when the finest level lands, and a host riding on that
            tile would take the renderer away with it. */}
        <NativeSplatRendererMount runtime={profile} lodScaleFn={lodScaleFn} />
        {mounted.map((source) => (
          <NativeSplatLayer
            key={source.url}
            url={source.url}
            residencyGroup={motionLevelEnabled && !source.isEnvironment
              ? (ladder.coarse.some((tile) => tile.url === source.url) ? "motion" : "detail")
              : undefined}
            opacityFn={source.isEnvironment ? undefined
              : (ladder.coarse.some((tile) => tile.url === source.url) ? coarseOpacity : sharpOpacity)}
            position={[...transform.position] as [number, number, number]}
            rotation={[...transform.rotation] as [number, number, number]}
            scale={transform.scale}
            runtime={profile}
            includeRendererHost={false}
            lodScaleFn={lodScaleFn}
            onLoad={handleLoad}
            onError={handleError}
            onRendered={handleRendered}
            relight={relightTiles?.get(source.file)}
          />
        ))}
        <StageFloor roomSlug={room} transform={transform} active />
        {spawn !== null && walkBounds !== null && (
          <InteriorCamera
            spawn={spawn}
            bounds={walkBounds}
            roomHeightM={extentM?.[1]}
            reducedMotion={prefersReducedMotion}
            motionDpr={profile.motionDpr}
            settledDpr={settledDpr}
            onMotionChange={handleMotionChange}
          />
        )}
      </RelightProvider>
```

- [ ] **Step 8: Serve the package in development** — in `packages/web/src/lib/splat-staging-plugin.ts`:

Replace:

```ts
const PACKAGE_DIRECTORY = "floor-skin";
const PACKAGE_EXTENSIONS = [".json", ".webp", ".i16", ".u8"] as const;
```

with:

```ts
const PACKAGE_DIRECTORIES = ["floor-skin", "relight"] as const;
/** The floor skin's .json/.webp/.i16/.u8 and the relight package's (T-639 R1b) .json/.gz/.png. */
const PACKAGE_EXTENSIONS = [".json", ".webp", ".i16", ".u8", ".gz", ".png"] as const;
```

replace `    if (directorySegments.includes(PACKAGE_DIRECTORY)) return candidate;` with:

```ts
    if (directorySegments.some((segment) => PACKAGE_DIRECTORIES.some((directory) => directory === segment))) return candidate;
```

and in `stagedContentType`, directly after `  if (lower.endsWith(".webp")) return "image/webp";` add:

```ts
  if (lower.endsWith(".png")) return "image/png";
```

(`.gz` stays `application/octet-stream` with no `Content-Encoding`, so the browser hands the relight worker the compressed bytes whose SHA-256 the manifest lists.)

- [ ] **Step 9: Run the tests**

Run each, one per command, from `D:/claude/real-hall/repo`:
- `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/sky-panels.test.ts` — Expected: PASS, 1 test.
- `pnpm --filter @omnitwin/web exec vitest run src/components/scene/__tests__/RelightProvider.test.tsx` — Expected: PASS, 5 tests.
- `pnpm --filter @omnitwin/web exec vitest run src/components/rooms/__tests__/RoomSplatScene.test.tsx` — Expected: PASS (the Task 0 count plus 3).
- `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/splat-staging-plugin.test.ts` — Expected: PASS (the Task 0 count plus 2).
- `pnpm --filter @omnitwin/web exec vitest run src/components/stage/__tests__/StageFloor.test.tsx` — Expected: PASS (unchanged from Task 14; the stub root's new parameter is optional).
- `pnpm --filter @omnitwin/web typecheck` — Expected: exit 0.

- [ ] **Step 10: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/relight/sky-panels.ts packages/web/src/components/scene/RelightSkyPanels.tsx packages/web/src/components/scene/RelightProvider.tsx packages/web/src/components/rooms/RoomSplatScene.tsx packages/web/src/lib/splat-staging-plugin.ts packages/web/src/components/__tests__/stub-r3f-root.tsx packages/web/src/lib/relight/__tests__/sky-panels.test.ts packages/web/src/components/scene/__tests__/RelightProvider.test.tsx packages/web/src/components/rooms/__tests__/RoomSplatScene.test.tsx packages/web/src/lib/__tests__/splat-staging-plugin.test.ts && git diff --cached --stat && git commit -m "feat(relight): the relit walk: package to frame to host, the light applied per change, sky panels (T-639 R1b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: The preview-only light control

**Files:**
- Create: `packages/web/src/components/rooms/LightControl.tsx`, `packages/web/src/components/rooms/LightControl.css`
- Modify: `packages/web/src/pages/RoomWalkPage.tsx`
- Test: `packages/web/src/components/rooms/__tests__/LightControl.test.tsx`, `packages/web/src/components/rooms/__tests__/RoomSplatScene.test.tsx`

**Interfaces:**
- Consumes: Task 8 (`LIGHT_PRESETS`, `MIN_MINUTES`, `MAX_MINUTES`, `formatMinutes`, `useLightSettingStore`); `ActivityStatus` from `../shared/Activity.js`.
- Produces: `LightControl(): ReactElement | null` — nothing while `status` is `"off"`; otherwise a region named "Light" with four radios ("As captured", "Night, lamps lit", "Sunny morning", "Overcast noon"), a range labelled "Time" (06:00–22:00 in 15-minute steps, disabled as captured) with its clock as an `output`, a date input labelled "Date" (disabled as captured), and "Preparing the light…" through `ActivityStatus` while loading.

The control is loaded lazily by the walk page, and only in development and preview bundles: `import.meta.env.DEV || import.meta.env.VITE_DEPLOY_ENV === "preview"` is a build-time constant (`vite.config.ts` defines `VITE_DEPLOY_ENV` from `VERCEL_ENV`), so venviewer.com's bundle never contains it (spec §4.4, §5; checked in Task 19), and at run time it also needs `gaussianSplatsAvailable()`. It follows the product experience brief: the walk's palette, quiet colour-change hovers, a visible copper focus ring, plain words, reduced motion honoured.

- [ ] **Step 1: Write the failing tests**

`packages/web/src/components/rooms/__tests__/LightControl.test.tsx`:

```tsx
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PRESET_DEFAULTS } from "../../../lib/light-setting.js";
import { useLightSettingStore } from "../../../stores/light-setting-store.js";
import { LightControl } from "../LightControl.js";

const initial = useLightSettingStore.getState();
beforeEach(() => { useLightSettingStore.setState(initial, true); });
afterEach(() => { cleanup(); });

describe("the light control (T-639 R1b)", () => {
  it("is absent while the hall is drawn as captured", () => {
    const { container } = render(<LightControl />);
    expect(container.innerHTML).toBe("");
  });

  it("offers the four presets, the hour and the date while relit", () => {
    act(() => { useLightSettingStore.getState().setStatus("ready"); });
    render(<LightControl />);
    expect(screen.getAllByRole("radio").map((radio) => radio.getAttribute("value"))).toEqual(["captured", "night", "sunny", "overcast"]);
    expect((screen.getByRole("radio", { name: "As captured" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Time") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("Date") as HTMLInputElement).disabled).toBe(true);
  });

  it("opens a preset at its own hour, and moves with the hour and the date", () => {
    act(() => { useLightSettingStore.getState().setStatus("ready"); });
    render(<LightControl />);
    fireEvent.click(screen.getByRole("radio", { name: "Sunny morning" }));
    expect(useLightSettingStore.getState().choice).toEqual({ preset: "sunny", ...PRESET_DEFAULTS.sunny });
    expect(screen.getByText("09:00")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "600" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-06-21" } });
    expect(useLightSettingStore.getState().choice).toEqual({ preset: "sunny", date: "2026-06-21", minutes: 600 });
    expect(screen.getByText("10:00")).toBeTruthy();
  });

  it("says it is preparing the light while the package loads", () => {
    act(() => { useLightSettingStore.getState().setStatus("loading"); });
    render(<LightControl />);
    expect(screen.getByRole("status").textContent).toContain("Preparing the light…");
  });
});
```

In `packages/web/src/components/rooms/__tests__/RoomSplatScene.test.tsx`, directly after `import { RoomWalkPage } from "../../../pages/RoomWalkPage.js";` add:

```ts
import { useLightSettingStore } from "../../../stores/light-setting-store.js";
```

and append inside the `describe("RoomSplatScene relit (T-639 R1b)", …)` block (Task 15), before its closing `});`:

```tsx
  it("offers the light control on the walk while the hall is relit, and never in bare mode", async () => {
    useLightSettingStore.getState().setStatus("ready");
    try {
      const walk = (entry: string) => render(
        <MemoryRouter initialEntries={[entry]}>
          <Routes><Route path="/room/:roomSlug" element={<RoomWalkPage />} /></Routes>
        </MemoryRouter>,
      );
      const view = walk("/room/grand-hall");
      expect(await screen.findByRole("region", { name: "Light" })).toBeTruthy();
      view.unmount();
      walk("/room/grand-hall?bare=1");
      await act(async () => { await Promise.resolve(); });
      expect(screen.queryByRole("region", { name: "Light" })).toBeNull();
    } finally {
      useLightSettingStore.getState().setStatus("off");
    }
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/rooms/__tests__/LightControl.test.tsx`
Expected: FAIL — cannot find module `../LightControl.js`.

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/rooms/__tests__/RoomSplatScene.test.tsx`
Expected: FAIL — the new walk-page test (no region named "Light").

- [ ] **Step 3: The control** — create `packages/web/src/components/rooms/LightControl.tsx`:

```tsx
import { useId, type ReactElement } from "react";
import { ActivityStatus } from "../shared/Activity.js";
import { LIGHT_PRESETS, MAX_MINUTES, MIN_MINUTES, formatMinutes, type LightPresetId } from "../../lib/light-setting.js";
import { useLightSettingStore } from "../../stores/light-setting-store.js";
import "./LightControl.css";

const LABELS: Readonly<Record<LightPresetId, string>> = {
  captured: "As captured",
  night: "Night, lamps lit",
  sunny: "Sunny morning",
  overcast: "Overcast noon",
};

/**
 * The preview-only light control (spec §4.3): three presets and the capture's
 * own light, an hour between 06:00 and 22:00 and a date. It exists only while
 * the hall is being relit; the captured light has no hour to move.
 */
export function LightControl(): ReactElement | null {
  const choice = useLightSettingStore((state) => state.choice);
  const status = useLightSettingStore((state) => state.status);
  const selectPreset = useLightSettingStore((state) => state.selectPreset);
  const setMinutes = useLightSettingStore((state) => state.setMinutes);
  const setDate = useLightSettingStore((state) => state.setDate);
  const group = useId(), hourId = useId(), dateId = useId();
  if (status === "off") return null;
  const timed = choice.preset !== "captured";
  return (
    <section className="light-control" aria-label="Light">
      <fieldset className="light-control__presets">
        <legend className="light-control__legend">Light</legend>
        {LIGHT_PRESETS.map((preset) => (
          <label key={preset} className="light-control__preset">
            <input type="radio" name={group} value={preset} checked={choice.preset === preset} onChange={() => { selectPreset(preset); }} />
            <span>{LABELS[preset]}</span>
          </label>
        ))}
      </fieldset>
      <div className="light-control__row">
        <label className="light-control__label" htmlFor={hourId}>Time</label>
        <input
          id={hourId} type="range" min={MIN_MINUTES} max={MAX_MINUTES} step={15} value={choice.minutes} disabled={!timed}
          aria-valuetext={formatMinutes(choice.minutes)}
          onChange={(event) => { setMinutes(Number(event.currentTarget.value)); }}
        />
        <output className="light-control__time" htmlFor={hourId}>{formatMinutes(choice.minutes)}</output>
      </div>
      <div className="light-control__row">
        <label className="light-control__label" htmlFor={dateId}>Date</label>
        <input id={dateId} type="date" value={choice.date} disabled={!timed} onChange={(event) => { setDate(event.currentTarget.value); }} />
      </div>
      {status === "loading" && <ActivityStatus className="light-control__status">Preparing the light…</ActivityStatus>}
    </section>
  );
}
```

`packages/web/src/components/rooms/LightControl.css`:

```css
/* The preview-only light control (T-639 R1b): a quiet panel over the walk,
 * in the walk's palette (RoomWalkPage.css), copper for what is chosen. */

.light-control {
  position: absolute;
  right: 1rem;
  bottom: 5.5rem;
  z-index: 2;
  width: min(18rem, calc(100% - 2rem));
  padding: 0.75rem 0.9rem;
  border: 1px solid rgba(242, 236, 223, 0.16);
  border-radius: 0.75rem;
  background: rgba(20, 16, 12, 0.78);
  color: var(--stone);
  font-family: var(--fr-ui, "Geist", system-ui, sans-serif);
  font-size: 0.8rem;
}

.light-control__presets { display: grid; gap: 0.2rem; margin: 0; padding: 0; border: 0; }

.light-control__legend {
  margin-bottom: 0.35rem;
  padding: 0;
  color: var(--stone-dim);
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.light-control__preset {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0.4rem;
  border-radius: 0.45rem;
  cursor: pointer;
  transition: color 160ms ease, background-color 160ms ease;
}
.light-control__preset:hover { background: rgba(242, 236, 223, 0.06); }
.light-control__preset input { margin: 0; accent-color: var(--brass); }
.light-control__preset:has(input:checked) { color: var(--brass); }
.light-control__preset:has(input:focus-visible) { outline: 2px solid var(--brass); outline-offset: 2px; }

.light-control__row {
  display: grid;
  grid-template-columns: 3.2rem 1fr auto;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.55rem;
}
.light-control__label { color: var(--stone-dim); }
.light-control__row input[type="range"] { width: 100%; accent-color: var(--brass); }
.light-control__row input[type="date"] {
  grid-column: 2 / 4;
  padding: 0.2rem 0.35rem;
  border: 1px solid rgba(242, 236, 223, 0.2);
  border-radius: 0.4rem;
  background: transparent;
  color: var(--stone);
  color-scheme: dark;
  font: inherit;
}
.light-control__row input:focus-visible { outline: 2px solid var(--brass); outline-offset: 2px; }
.light-control__row input:disabled { opacity: 0.45; cursor: not-allowed; }
.light-control__time { color: var(--stone); font-family: "Geist Mono", ui-monospace, monospace; font-variant-numeric: tabular-nums; }
.light-control__status { margin-top: 0.6rem; color: var(--stone-dim); }

@media (prefers-reduced-motion: reduce) {
  .light-control__preset { transition: none; }
}
```

- [ ] **Step 4: Put it on the walk** — in `packages/web/src/pages/RoomWalkPage.tsx`:

Replace `import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";` with:

```ts
import { Suspense, lazy, useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
```

Replace `import "./RoomWalkPage.css";` with:

```ts
import { gaussianSplatsAvailable } from "../lib/splat-access.js";
import "./RoomWalkPage.css";

/** The preview-only light control (T-639 R1b): in development and preview bundles only, never venviewer.com's. */
const LightControl = import.meta.env.DEV || import.meta.env.VITE_DEPLOY_ENV === "preview"
  ? lazy(() => import("../components/rooms/LightControl.js").then((module) => ({ default: module.LightControl })))
  : null;
```

Directly before the line `      {!bare && <footer className="walk__foot">` add:

```tsx
      {!bare && LightControl !== null && gaussianSplatsAvailable() && (
        <Suspense fallback={null}><LightControl /></Suspense>
      )}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/rooms/__tests__/LightControl.test.tsx`
Expected: PASS, 4 tests.

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/rooms/__tests__/RoomSplatScene.test.tsx`
Expected: PASS (the Task 0 count plus 4).

Run: `cd D:/claude/real-hall/repo && pnpm --filter @omnitwin/web typecheck && pnpm exec eslint packages/web/src/components/rooms packages/web/src/pages/RoomWalkPage.tsx`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/components/rooms/LightControl.tsx packages/web/src/components/rooms/LightControl.css packages/web/src/pages/RoomWalkPage.tsx packages/web/src/components/rooms/__tests__/LightControl.test.tsx packages/web/src/components/rooms/__tests__/RoomSplatScene.test.tsx && git diff --cached --stat && git commit -m "feat(relight): the preview-only light control on the walk: presets, hour and date (T-639 R1b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: DEV instruments: GPU read-back, fixture splats and PNG view capture

**Files:**
- Create: `packages/web/src/lib/relight/relight-debug.ts`
- Modify: `packages/web/src/components/scene/RelightProvider.tsx`
- Modify: `packages/web/src/lib/native-current-view-capture.ts`
- Modify: `packages/web/src/components/rooms/RoomSplatScene.tsx`
- Test: `packages/web/src/lib/relight/__tests__/relight-debug.test.ts`, `packages/web/src/lib/__tests__/native-current-view-capture.test.ts`, `packages/web/src/components/rooms/__tests__/RoomSplatScene.test.tsx`

**Interfaces:**
- Consumes: Tasks 1, 4, 8, 10, 11, 12.
- Produces (`relight-debug.ts`): `interface WordCheck { readonly checked: number; readonly worstCodeDistance: number; readonly alphaMismatches: number; readonly missing: number }`; `interface RelightDebug { state(): { status: RelightStatus; relit: boolean; supported: boolean; applyMs: number | null; choice: LightChoice }; select(preset: LightPresetId, minutes?: number, date?: string): Promise<void>; sample(stride: number): Promise<WordCheck>; fixture(vectors: unknown, setting: string): Promise<WordCheck>; timings(): Promise<{ readonly applyMs: number | null; readonly passMs: number }> }` on `window.__relight` (DEV only); `findSplatsByRecord(records: Uint32Array, positions: Float32Array, sceneToModel: Matrix4, wanted: readonly { readonly record: Uint8Array; readonly position: readonly [number, number, number] }[], tolerance?: number): number[]`; `installRelightDebug(frame: RelightFrame, host: NativeSplatScene, renderer: WebGPURenderer): () => void`.
- Produces (capture): `interface NativeCaptureOptions { readonly width?: number; readonly height?: number; readonly mimeType?: "image/jpeg" | "image/png" }`; `captureNativeCurrentView(scene, camera, options?)`.
- Produces (`RoomSplatScene`): `interface RoomViewCaptureRequest { readonly position: readonly [number, number, number]; readonly target: readonly [number, number, number]; readonly fov: number; readonly width: number; readonly height: number }`; `window.__roomViewCapture(request)` (DEV, `captureReadback` only) — a PNG of that view at that size, the live camera restored.

These are the only ways Task 18 reads the GPU: the multiplier words against the CPU kernel (`sample`), the R1a fixture splats found in the live draw by record and model position (`fixture`), and lossless renders at the proof's stations. They are imported only inside `import.meta.env.DEV` branches, so no production bundle carries them.

- [ ] **Step 1: Write the failing tests**

`packages/web/src/lib/relight/__tests__/relight-debug.test.ts`:

```ts
import { Matrix4 } from "three";
import { describe, expect, it } from "vitest";
import { findSplatsByRecord } from "../relight-debug.js";

describe("the relight instruments (T-639 R1b)", () => {
  it("finds fixture splats by record and model position, and reports the ones it cannot", () => {
    const record = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const other = Uint8Array.from([9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9]);
    const bytes = new Uint8Array(36);
    bytes.set(record, 0); bytes.set(other, 12); bytes.set(record, 24);
    const positions = Float32Array.from([0, 0, 0, 1, 1, 1, 5, 0, 0]);
    const sceneToModel = new Matrix4().makeTranslation(0, 0, 10);
    const found = findSplatsByRecord(new Uint32Array(bytes.buffer), positions, sceneToModel, [
      { record, position: [5, 0, 10] },
      { record: Uint8Array.from([7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7]), position: [0, 0, 10] },
    ]);
    expect(found).toEqual([2, -1]);
  });
});
```

In `packages/web/src/lib/__tests__/native-current-view-capture.test.ts`, append inside the `describe("native current-view poster capture", …)` block, before its closing `});`:

```ts
  it("renders at a requested size and encodes PNG for verification", async () => {
    const fixture = captureFixture(false);
    fixture.encode.mockReturnValue("data:image/png;base64,iVBORw0KGgo=");
    await expect(captureNativeCurrentView(fixture.scene, fixture.camera, { width: 2, height: 2, mimeType: "image/png" }))
      .resolves.toEqual({ width: 2, height: 2, dataUrl: "data:image/png;base64,iVBORw0KGgo=" });
    expect(fixture.encode).toHaveBeenLastCalledWith("image/png");
    fixture.encode.mockReturnValue("data:image/jpeg;base64,/9j/2Q==");
    await expect(captureNativeCurrentView(fixture.scene, fixture.camera, { mimeType: "image/png" })).rejects.toThrow("Capture PNG encoding failed");
    await expect(captureNativeCurrentView(fixture.scene, fixture.camera, { width: 9000, height: 2 })).rejects.toThrow("invalid capture dimensions");
    fixture.unregister();
  });
```

In `packages/web/src/components/rooms/__tests__/RoomSplatScene.test.tsx`, append inside the `describe("RoomSplatScene relit (T-639 R1b)", …)` block, before its closing `});`:

```tsx
  it("captures a requested view as PNG at the requested size, then puts the camera back", async () => {
    vi.useFakeTimers();
    const view = render(<RoomSplatScene room={ROOM} captureReadback />);
    const scene = new Scene();
    const camera = new PerspectiveCamera(50, 1.5);
    camera.position.set(1, 1.6, 2);
    (recorded.onCreated as (state: { scene: Scene; camera: PerspectiveCamera }) => void)({ scene, camera });
    const capture = window.__roomViewCapture;
    if (capture === undefined) throw new Error("The view capture hook is missing");
    const request = { position: [0.414, 1.6, -1.064252] as const, target: [0.414, 1.6, -11.064252] as const, fov: 48, width: 1920, height: 1080 };
    await expect(capture(request)).rejects.toThrow("successfully drawn room");
    act(() => { loadEveryMountedLayer(); vi.advanceTimersByTime(450); });
    act(() => { loadEveryMountedLayer(false); vi.advanceTimersByTime(450); });
    act(() => { for (const layer of mountedLayers()) drawLayer(layer); vi.advanceTimersByTime(450); });
    const seen: { fov: number; aspect: number; x: number }[] = [];
    recorded.capture.mockImplementationOnce((_scene: Scene, used: PerspectiveCamera) => {
      seen.push({ fov: used.fov, aspect: used.aspect, x: used.position.x });
      return Promise.resolve({ width: 1920, height: 1080, dataUrl: "data:image/png;base64,view" });
    });
    await expect(capture(request)).resolves.toEqual({ width: 1920, height: 1080, dataUrl: "data:image/png;base64,view" });
    expect(seen).toEqual([{ fov: 48, aspect: 1920 / 1080, x: 0.414 }]);
    expect(recorded.capture).toHaveBeenLastCalledWith(scene, camera, { width: 1920, height: 1080, mimeType: "image/png" });
    expect([camera.fov, camera.aspect, camera.position.x]).toEqual([50, 1.5, 1]);
    view.unmount();
    expect(window.__roomViewCapture).toBeUndefined();
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/relight-debug.test.ts`
Expected: FAIL — cannot find module `../relight-debug.js`.

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/native-current-view-capture.test.ts`
Expected: FAIL — the new test (the options are ignored; JPEG is always encoded).

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/rooms/__tests__/RoomSplatScene.test.tsx`
Expected: FAIL — the new test (`window.__roomViewCapture` is undefined).

- [ ] **Step 3: The instruments** — create `packages/web/src/lib/relight/relight-debug.ts`:

```ts
import { Vector3, type Matrix4 } from "three";
import type { WebGPURenderer } from "three/webgpu";
import type { LightChoice, LightPresetId } from "../light-setting.js";
import type { NativeSplatScene } from "../native-splat-scene.js";
import { useLightSettingStore, type RelightStatus } from "../../stores/light-setting-store.js";
import { RECORD_BYTES, multiplierCodeDistance, packMultiplierWord, recordFromHex } from "./relight-codec.js";
import { PASSTHROUGH_FLAGS, type RelightDraw } from "./relight-draw.js";
import type { RelightFrame } from "./relight-frame.js";
import { relightSplat, type Rgb } from "./relight-kernel.js";
import { RelightVectorsSchema, isRelightVectorSetting } from "./relight-vectors.js";

export interface WordCheck {
  readonly checked: number;
  readonly worstCodeDistance: number;
  readonly alphaMismatches: number;
  readonly missing: number;
}

export interface RelightDebug {
  state(): { readonly status: RelightStatus; readonly relit: boolean; readonly supported: boolean; readonly applyMs: number | null; readonly choice: LightChoice };
  select(preset: LightPresetId, minutes?: number, date?: string): Promise<void>;
  sample(stride: number): Promise<WordCheck>;
  fixture(vectors: unknown, setting: string): Promise<WordCheck>;
  timings(): Promise<{ readonly applyMs: number | null; readonly passMs: number }>;
}

declare global {
  interface Window {
    /** Development-only relight instruments (T-639 R1b, Task 18). */
    __relight?: RelightDebug;
  }
}

/** Each wanted splat's index in a draw (same record, model position within `tolerance` m), or −1. One pass. */
export function findSplatsByRecord(
  records: Uint32Array,
  positions: Float32Array,
  sceneToModel: Matrix4,
  wanted: readonly { readonly record: Uint8Array; readonly position: readonly [number, number, number] }[],
  tolerance = 0.01,
): number[] {
  const words = wanted.map((item) => new Uint32Array(Uint8Array.from(item.record).buffer));
  const byFirst = new Map<number, number[]>();
  words.forEach((word, index) => {
    const first = word[0] ?? 0;
    byFirst.set(first, [...(byFirst.get(first) ?? []), index]);
  });
  const found = wanted.map(() => -1), best = wanted.map(() => Infinity);
  const point = new Vector3();
  for (let splat = 0; splat < records.length / 3; splat += 1) {
    const candidates = byFirst.get(records[splat * 3] ?? 0);
    if (candidates === undefined) continue;
    for (const index of candidates) {
      const word = words[index], target = wanted[index]?.position;
      if (word === undefined || target === undefined || records[splat * 3 + 1] !== word[1] || records[splat * 3 + 2] !== word[2]) continue;
      point.set(positions[splat * 3] ?? 0, positions[splat * 3 + 1] ?? 0, positions[splat * 3 + 2] ?? 0).applyMatrix4(sceneToModel);
      const distance = Math.hypot(point.x - target[0], point.y - target[1], point.z - target[2]);
      if (distance <= tolerance && distance < (best[index] ?? Infinity)) { best[index] = distance; found[index] = splat; }
    }
  }
  return found;
}

const srgbToLinear = (byte: number): number => {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

function recordWords(draw: RelightDraw): Uint32Array {
  const words = draw.recordsAttribute.array;
  if (!(words instanceof Uint32Array)) throw new Error("The relight records are 32-bit words.");
  return words;
}

async function readWords(renderer: WebGPURenderer, draw: RelightDraw): Promise<Uint32Array> {
  return new Uint32Array(await renderer.getArrayBufferAsync(draw.wordsAttribute));
}

function afterFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (left: number): void => { if (left === 0) resolve(); else requestAnimationFrame(() => { step(left - 1); }); };
    step(count);
  });
}

export function installRelightDebug(frame: RelightFrame, host: NativeSplatScene, renderer: WebGPURenderer): () => void {
  const activeDraw = (): RelightDraw => {
    const draw = host.activeRelightDraw();
    if (draw === null) throw new Error("The hall is not relit.");
    return draw;
  };
  const select = (preset: LightPresetId, minutes?: number, date?: string): Promise<void> => new Promise((resolve) => {
    const stop = frame.onApply(() => { stop(); void afterFrames(2).then(resolve); });
    const store = useLightSettingStore.getState();
    store.selectPreset(preset);
    if (minutes !== undefined) store.setMinutes(minutes);
    if (date !== undefined) store.setDate(date);
  });
  const debug: RelightDebug = {
    state: () => {
      const { status, choice } = useLightSettingStore.getState();
      return { status, choice, applyMs: frame.lastApplyMs, ...host.relightState() };
    },
    select,
    sample: async (stride) => {
      const draw = activeDraw(), kernel = frame.kernelFrame;
      if (kernel === null) throw new Error("No light has been applied.");
      const words = await readWords(renderer, draw);
      const bytes = new Uint8Array(recordWords(draw).buffer);
      const point = new Vector3();
      let checked = 0, worst = 0, alphaMismatches = 0;
      for (let splat = 0; splat < draw.count; splat += Math.max(1, Math.floor(stride))) {
        const record = bytes.subarray(splat * RECORD_BYTES, (splat + 1) * RECORD_BYTES);
        if (record[11] === PASSTHROUGH_FLAGS) continue;
        point.set(draw.positions[splat * 3] ?? 0, draw.positions[splat * 3 + 1] ?? 0, draw.positions[splat * 3 + 2] ?? 0).applyMatrix4(draw.sceneToModel);
        const packed = draw.colours[splat] ?? 0;
        const colour: Rgb = [srgbToLinear(packed & 0xff), srgbToLinear((packed >>> 8) & 0xff), srgbToLinear((packed >>> 16) & 0xff)];
        const { m, alpha } = relightSplat(frame.model, kernel, record, [point.x, point.y, point.z], colour);
        const expected = packMultiplierWord(m, alpha), actual = words[splat] ?? 0;
        worst = Math.max(worst, multiplierCodeDistance(actual, expected));
        if (actual >>> 24 !== expected >>> 24) alphaMismatches += 1;
        checked += 1;
      }
      return { checked, worstCodeDistance: worst, alphaMismatches, missing: 0 };
    },
    fixture: async (value, setting) => {
      const vectors = RelightVectorsSchema.parse(value);
      if (!isRelightVectorSetting(setting)) throw new Error(`The test vectors have no setting ${setting}.`);
      await select(setting === "sunny_morning" ? "sunny" : setting);
      const draw = activeDraw();
      const words = await readWords(renderer, draw);
      const found = findSplatsByRecord(recordWords(draw), draw.positions, draw.sceneToModel,
        vectors.splats.map((splat) => ({ record: recordFromHex(splat.record), position: splat.position })));
      let checked = 0, worst = 0, alphaMismatches = 0, missing = 0;
      vectors.splats.forEach((splat, index) => {
        const at = found[index] ?? -1;
        if (at < 0) { missing += 1; return; }
        const actual = words[at] ?? 0, expected = splat.expected[setting].word;
        worst = Math.max(worst, multiplierCodeDistance(actual, expected));
        if (actual >>> 24 !== expected >>> 24) alphaMismatches += 1;
        checked += 1;
      });
      return { checked, worstCodeDistance: worst, alphaMismatches, missing };
    },
    timings: async () => {
      const draw = activeDraw();
      const started = performance.now();
      draw.run(renderer);
      await readWords(renderer, draw);
      return { applyMs: frame.lastApplyMs, passMs: performance.now() - started };
    },
  };
  window.__relight = debug;
  return () => { if (window.__relight === debug) delete window.__relight; };
}
```

- [ ] **Step 4: Install them from the provider in development** — in `packages/web/src/components/scene/RelightProvider.tsx`:

Replace `import { relightBackendSupported } from "../../lib/relight/relight-tile-load.js";` with:

```ts
import { getNativeRenderer } from "../../lib/native-renderer.js";
import { relightBackendSupported } from "../../lib/relight/relight-tile-load.js";
```

and directly before `  return (\n    <RelightContext.Provider value={state}>` add:

```tsx
  // Development only: GPU read-back instruments for the browser checks (Task 18).
  useEffect(() => {
    if (!import.meta.env.DEV || frame === null) return;
    const renderer = getNativeRenderer(gl);
    if (renderer === null) return;
    let uninstall: (() => void) | null = null, cancelled = false;
    void import("../../lib/relight/relight-debug.js").then(({ installRelightDebug }) => {
      if (!cancelled) uninstall = installRelightDebug(frame, host, renderer);
    });
    return () => { cancelled = true; uninstall?.(); };
  }, [frame, host, gl]);

```

- [ ] **Step 5: Size and PNG in the capture** — in `packages/web/src/lib/native-current-view-capture.ts`:

Replace:

```ts
/** Capture the current camera on its existing device, independent of whether
 * the browser preserves the presented canvas buffer. Never move the camera. */
export async function captureNativeCurrentView(scene: Scene, camera: Camera): Promise<NativeCurrentViewCapture> {
  const renderer = nativeRendererForScene(scene);
  if (renderer === null) throw new Error("The room has no initialized native renderer");
  const size = renderer.getDrawingBufferSize(new Vector2());
  const width = size.x, height = size.y;
```

with:

```ts
export interface NativeCaptureOptions {
  /** Pixels; the drawing buffer's size by default. The caller sets the camera's aspect to match. */
  readonly width?: number;
  readonly height?: number;
  /** PNG for lossless verification renders; JPEG at 0.86 (posters) by default. */
  readonly mimeType?: "image/jpeg" | "image/png";
}

/** Capture the current camera on its existing device, independent of whether
 * the browser preserves the presented canvas buffer. Never move the camera. */
export async function captureNativeCurrentView(scene: Scene, camera: Camera, options: NativeCaptureOptions = {}): Promise<NativeCurrentViewCapture> {
  const renderer = nativeRendererForScene(scene);
  if (renderer === null) throw new Error("The room has no initialized native renderer");
  const size = renderer.getDrawingBufferSize(new Vector2());
  const width = options.width ?? size.x, height = options.height ?? size.y;
```

and replace:

```ts
    const dataUrl = canvas.toDataURL("image/jpeg", 0.86);
    if (!dataUrl.startsWith("data:image/jpeg;base64,")) throw new Error("Poster JPEG encoding failed");
```

with:

```ts
    const png = options.mimeType === "image/png";
    const dataUrl = png ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.86);
    if (!dataUrl.startsWith(png ? "data:image/png;base64," : "data:image/jpeg;base64,")) {
      throw new Error(png ? "Capture PNG encoding failed" : "Poster JPEG encoding failed");
    }
```

- [ ] **Step 6: The view capture** — in `packages/web/src/components/rooms/RoomSplatScene.tsx`:

Replace `import type { RootState } from "@react-three/fiber";` with:

```ts
import type { RootState } from "@react-three/fiber";
import { PerspectiveCamera } from "three";
```

Replace:

```ts
declare global {
  interface Window {
    /** Development-only, complete-room poster readback from the live camera. */
    __roomPosterCapture?: () => Promise<NativeCurrentViewCapture>;
  }
}
```

with:

```ts
/** A camera for a verification render (the proof's views.json, in the walk's scene frame). */
export interface RoomViewCaptureRequest {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly fov: number;
  readonly width: number;
  readonly height: number;
}

declare global {
  interface Window {
    /** Development-only, complete-room poster readback from the live camera. */
    __roomPosterCapture?: () => Promise<NativeCurrentViewCapture>;
    /** Development-only lossless render of a requested view (T-639 R1b verification). */
    __roomViewCapture?: (request: RoomViewCaptureRequest) => Promise<NativeCurrentViewCapture>;
  }
}
```

Replace:

```ts
    window.__roomPosterCapture = capture;
    return () => { if (window.__roomPosterCapture === capture) delete window.__roomPosterCapture; };
```

with:

```ts
    const viewCapture = async (request: RoomViewCaptureRequest): Promise<NativeCurrentViewCapture> => {
      const progress = lastReportRef.current;
      const source = captureSource.current;
      if (source === null || progress?.complete !== true || !progress.firstView || progress.failed > 0) {
        throw new Error("A complete, successfully drawn room is required before a view capture");
      }
      const { camera } = source;
      if (!(camera instanceof PerspectiveCamera)) throw new Error("A view capture needs the walk's perspective camera");
      const { captureNativeCurrentView } = await import("../../lib/native-current-view-capture.js");
      const saved = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), fov: camera.fov, aspect: camera.aspect };
      camera.position.set(...request.position);
      camera.fov = request.fov;
      camera.aspect = request.width / request.height;
      camera.up.set(0, 1, 0);
      camera.lookAt(...request.target);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      // The capture renders synchronously before its read-back awaits, so the live pose returns at once.
      const pending = captureNativeCurrentView(source.scene, camera, { width: request.width, height: request.height, mimeType: "image/png" });
      camera.position.copy(saved.position);
      camera.quaternion.copy(saved.quaternion);
      camera.fov = saved.fov;
      camera.aspect = saved.aspect;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      return pending;
    };
    window.__roomPosterCapture = capture;
    window.__roomViewCapture = viewCapture;
    return () => {
      if (window.__roomPosterCapture === capture) delete window.__roomPosterCapture;
      if (window.__roomViewCapture === viewCapture) delete window.__roomViewCapture;
    };
```

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/relight-debug.test.ts`
Expected: PASS, 1 test.

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/native-current-view-capture.test.ts`
Expected: PASS (the Task 0 count plus 1).

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/rooms/__tests__/RoomSplatScene.test.tsx`
Expected: PASS (the Task 0 count plus 5).

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/scene/__tests__/RelightProvider.test.tsx`
Expected: PASS, 5 tests.

Run: `cd D:/claude/real-hall/repo && pnpm --filter @omnitwin/web typecheck`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/relight/relight-debug.ts packages/web/src/components/scene/RelightProvider.tsx packages/web/src/lib/native-current-view-capture.ts packages/web/src/components/rooms/RoomSplatScene.tsx packages/web/src/lib/relight/__tests__/relight-debug.test.ts packages/web/src/lib/__tests__/native-current-view-capture.test.ts packages/web/src/components/rooms/__tests__/RoomSplatScene.test.tsx && git diff --cached --stat && git commit -m "feat(relight): DEV instruments: GPU words against the CPU kernel and the fixture, PNG view renders (T-639 R1b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Verify in the browser: identity, the captured light, the GPU against the CPU, the photographs, speed

**Files:**
- Create: `packages/web/scripts/relight-verify.mjs`
- Create: `tools/relight/relight/browsercheck.py`, `tools/relight/tests/test_browsercheck.py`
- Create (moved, only if R1a did not): `tools/relight/proof/shots.py` (copied unchanged from `D:/claude/real-hall/renovation/relight/scripts/shots.py`; `07_compare.py` imports it)
- Modify: `tools/relight/relight/__main__.py` (the `browser-check` command)
- Outputs (D:, never committed): `D:/claude/relight/grand-hall/renders/{I1a_a,I1a_b,R1b_off,R1b_captured,R1b_night,R1b_sunny,R1b_overcast}/<view>@2x.png`, `D:/claude/relight/grand-hall/evidence/r1b/{r1b-baseline-run.json,r1b-browser-run.json,r1b-browser-checks.json,r1b-off.json,r1b-night.json}`

**Interfaces:**
- Consumes: Task 17's `window.__relight` and `window.__roomViewCapture`; the walk's `window.__roomWalk`; the proof's `work/views.json`, `renders/A_mask/*` and `work/cmp/photo_*.png`; the moved `07_compare.py` (`photo`, `render`, `valid_mask`, `cells`, `metrics`); `config.load(...).paths` (`work`, `proofWork`, `evidence`).
- Produces: `python -m relight browser-check --config config/grand-hall.json` (exit 0 only if every section passes); pure functions `srgb_to_linear`, `load_1x(path2x) -> uint8 RGB`, `pixel_difference(a, b) -> {max, fraction}`, `identity_verdict(noise, change) -> bool`, `stop_difference(a, b, valid) -> ndarray`, `comparison_mask(mask, *renders, fixtures=False) -> ndarray[bool]`, `captured_verdict(stops) -> dict`, `photo_verdict(relit_r, served_r, threshold) -> bool`.

What each check proves (spec §6):
- **No change when off:** `R1b_off` (`?relight=off`) against two I1a renders from the base commit (`I1a_a`, `I1a_b`): the change may not exceed I1a's own run-to-run difference (zero if I1a is deterministic, which then means pixel for pixel).
- **Captured light:** `R1b_captured` (`?light=captured&floorskin=v1`, so the floor is the same photographed floor) against `R1b_off`: the 99th percentile of the luminance difference is at most 1/20 of a stop everywhere but the view out of the windows (the glass splats are hidden by design and the sky panels show; the red channel of the proof's `A_mask`). The fixtures are included: with emitter boost 1 the captured light is exactly neutral for bulbs too, and the display's knee is each splat's own brightest channel.
- **Compute against CPU:** the words read back from the GPU for every 97th splat against `relightSplat` + `packMultiplierWord` for the setting applied, and for R1a's 64 fixture splats (found in the live draw by record and model position, which also tests contracts 4 and 5) against their expected words: at most one log code, alpha bytes equal, none missing.
- **Photographs:** `R1b_night` against Matterport's night photographs with `07_compare`'s cells and correlation: r ≥ 0.85 at station 43 and ≥ 0.80 at station 45, and at both at least the r of the hall as served.
- **Fallbacks:** `?nativeWebGL=1` (the WebGL2 fallback) and `?splat=tier:medium` (below desktop) make no `/relight/` request and install no instruments.
- **Loading:** the relit run adds no main-thread task over 50 ms (its longest task is at most the larger of the served run's longest and 50 ms, and it has no more tasks over 50 ms), and no console warning or error the served run did not have.
- **Speed:** the drag budget with `light=night` has a median p95 frame of at most 16.7 ms and at most 1 ms above `relight=off`.

- [ ] **Step 1: Make the proof's comparison importable**

```bash
cd D:/claude/real-hall/repo && test -f tools/relight/proof/shots.py || cp D:/claude/real-hall/renovation/relight/scripts/shots.py tools/relight/proof/shots.py; ls tools/relight/proof/shots.py tools/relight/proof/07_compare.py tools/relight/proof/pano_view.py
```
Expected: the three paths listed.

- [ ] **Step 2: Write the failing test** — create `tools/relight/tests/test_browsercheck.py`:

```python
import unittest

import numpy as np

from relight import browsercheck as bc


def to_srgb8(lin: np.ndarray) -> np.ndarray:
    s = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)
    return np.clip(s * 255 + 0.5, 0, 255).astype(np.uint8)


class BrowserChecks(unittest.TestCase):
    def test_identical_renders_differ_by_nothing_and_any_change_fails_without_noise(self):
        a = np.full((4, 4, 3), 120, np.uint8)
        b = a.copy(); b[0, 0, 1] = 121
        self.assertEqual(bc.pixel_difference(a, a), {"max": 0, "fraction": 0.0})
        self.assertTrue(bc.identity_verdict({"max": 0, "fraction": 0.0}, bc.pixel_difference(a, a)))
        self.assertFalse(bc.identity_verdict({"max": 0, "fraction": 0.0}, bc.pixel_difference(b, a)))

    def test_identity_allows_i1a_own_run_to_run_difference(self):
        noise = {"max": 2, "fraction": 0.01}
        self.assertTrue(bc.identity_verdict(noise, {"max": 2, "fraction": 0.012}))
        self.assertFalse(bc.identity_verdict(noise, {"max": 3, "fraction": 0.005}))
        self.assertFalse(bc.identity_verdict(noise, {"max": 1, "fraction": 0.02}))

    def test_captured_light_passes_within_a_twentieth_of_a_stop_only(self):
        lin = np.linspace(0.05, 0.6, 64 * 64 * 3).reshape(64, 64, 3)
        a = to_srgb8(lin)
        valid = np.ones((64, 64), bool)
        self.assertTrue(bc.captured_verdict(bc.stop_difference(a, a, valid))["pass"])
        shifted = to_srgb8(lin * 2 ** 0.1)
        verdict = bc.captured_verdict(bc.stop_difference(shifted, a, valid))
        self.assertFalse(verdict["pass"])
        self.assertAlmostEqual(verdict["median"], 0.1, delta=0.02)

    def test_comparison_mask_leaves_out_windows_fixtures_and_clipped_pixels(self):
        mask = np.zeros((2, 2, 3), np.uint8); mask[0, 0] = (255, 0, 0); mask[0, 1] = (0, 255, 0)
        render = np.full((2, 2, 3), 128, np.uint8); render[1, 1] = 255
        self.assertEqual(bc.comparison_mask(mask, render).tolist(), [[False, False], [True, False]])
        # the captured-light check keeps the fixtures: only the view out is left out
        self.assertEqual(bc.comparison_mask(mask, render, fixtures=True).tolist(), [[False, True], [True, False]])

    def test_photo_check_needs_the_threshold_and_never_worse_than_served(self):
        self.assertTrue(bc.photo_verdict(0.82, 0.62, 0.80))
        self.assertFalse(bc.photo_verdict(0.79, 0.62, 0.80))
        self.assertFalse(bc.photo_verdict(0.86, 0.88, 0.85))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 3: Run it to see it fail**

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_browsercheck -v`
Expected: FAIL — `ImportError: cannot import name 'browsercheck'`.

- [ ] **Step 4: Implement the checks** — create `tools/relight/relight/browsercheck.py`:

```python
"""Browser checks of the relit hall (T-639 R1b, plan Task 18).

Reads the renders relight-verify.mjs wrote under <root>/renders (root = the parent of paths.work) and its run
records under <evidence>/r1b, and writes <evidence>/r1b/r1b-browser-checks.json. Sections: identity (relight off
against I1a), captured (the captured light within 1/20 stop), gpu (read-back against the CPU kernel and R1a's
vectors), photo (night against Matterport, 07_compare's r), fallback (WebGL2 and below desktop stay captured),
loading (no new main-thread task over 50 ms, no new console messages)."""
from __future__ import annotations

import importlib
import json
import os
import shutil

import numpy as np
from PIL import Image

LUMW = np.array([0.2126, 0.7152, 0.0722])
NIGHT_STATIONS = {"mp43_night_end": 0.85, "mp45_night_windows": 0.80}
CAPTURED_STOPS = 0.05
LONG_TASK_MS = 50


def srgb_to_linear(c: np.ndarray) -> np.ndarray:
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def load_1x(path2x: str) -> np.ndarray:
    """A DPR-2 render box-averaged to 1x exactly as shots.one_x does."""
    a = np.asarray(Image.open(path2x).convert("RGB"), dtype=np.float32)
    h, w = a.shape[0] // 2, a.shape[1] // 2
    return np.clip(a[:2 * h, :2 * w].reshape(h, 2, w, 2, 3).mean((1, 3)) + 0.5, 0, 255).astype(np.uint8)


def pixel_difference(a: np.ndarray, b: np.ndarray) -> dict:
    d = np.abs(a.astype(np.int16) - b.astype(np.int16)).max(-1)
    return {"max": int(d.max()), "fraction": float((d > 0).mean())}


def identity_verdict(noise: dict, change: dict) -> bool:
    return change["max"] <= noise["max"] and change["fraction"] <= 1.5 * noise["fraction"] + 1e-9


def stop_difference(a: np.ndarray, b: np.ndarray, valid: np.ndarray) -> np.ndarray:
    la = srgb_to_linear(a / 255.0) @ LUMW
    lb = srgb_to_linear(b / 255.0) @ LUMW
    return np.abs(np.log2(np.maximum(la, 1e-5) / np.maximum(lb, 1e-5)))[valid]


def comparison_mask(mask: np.ndarray, *renders: np.ndarray, fixtures: bool = False) -> np.ndarray:
    """07_compare.valid_mask: not the view out (red), not a fixture (green) unless `fixtures`, no render clipped or black."""
    m = srgb_to_linear(mask / 255.0)
    ok = (m[..., 0] < 0.05) & ((m[..., 1] < 0.05) | fixtures)
    for render in renders:
        peak = (render / 255.0).max(-1)
        ok &= (peak < 0.98) & (peak > 0.03)
    return ok


def captured_verdict(stops: np.ndarray) -> dict:
    if stops.size == 0:
        return {"pixels": 0, "median": None, "p99": None, "pass": False}
    p99 = float(np.percentile(stops, 99))
    return {"pixels": int(stops.size), "median": float(np.median(stops)), "p99": p99, "pass": p99 <= CAPTURED_STOPS}


def photo_verdict(relit_r: float, served_r: float, threshold: float) -> bool:
    return relit_r >= threshold and relit_r >= served_r


def _views(renders: str, job: str) -> list[str]:
    folder = os.path.join(renders, job)
    return sorted(n[:-len("@2x.png")] for n in os.listdir(folder) if n.endswith("@2x.png")) if os.path.isdir(folder) else []


def identity_report(renders: str) -> dict:
    views = {}
    for view in _views(renders, "I1a_a"):
        a, b, off = (load_1x(os.path.join(renders, job, f"{view}@2x.png")) for job in ("I1a_a", "I1a_b", "R1b_off"))
        noise, change = pixel_difference(a, b), pixel_difference(off, a)
        views[view] = {"noise": noise, "change": change, "pass": identity_verdict(noise, change)}
    return {"views": views, "pass": bool(views) and all(v["pass"] for v in views.values())}


def captured_report(renders: str) -> dict:
    views = {}
    for view in _views(renders, "R1b_captured"):
        mask = os.path.join(renders, "A_mask", f"{view}@2x.png")
        if not os.path.exists(mask):
            continue
        off = load_1x(os.path.join(renders, "R1b_off", f"{view}@2x.png"))
        captured = load_1x(os.path.join(renders, "R1b_captured", f"{view}@2x.png"))
        # Fixtures included: at the captured light bulbs are exactly neutral (emitter boost 1); only the view out differs.
        views[view] = captured_verdict(stop_difference(captured, off, comparison_mask(load_1x(mask), off, captured, fixtures=True)))
    return {"views": views, "pass": bool(views) and all(v["pass"] for v in views.values())}


def photo_report(cmp) -> dict:
    views = {}
    for view, threshold in NIGHT_STATIONS.items():
        photo_lin, photo_s = cmp.photo(view)
        served_lin, served_s = cmp.render("R1b_off", view)
        relit_lin, relit_s = cmp.render("R1b_night", view)
        ok_px = cmp.valid_mask(view, photo_s, served_s, relit_s)
        pc, pf = cmp.cells(photo_lin, ok_px)
        record = {"threshold": threshold}
        for name, lin in (("served", served_lin), ("relit", relit_lin)):
            mc, mf = cmp.cells(lin, ok_px)
            record[name] = cmp.metrics(mc, pc, (pf > 0.7) & (mf > 0.7))
        record["pass"] = photo_verdict(record["relit"]["r"], record["served"]["r"], threshold)
        views[view] = record
    return {"views": views, "pass": all(v["pass"] for v in views.values())}


def gpu_report(run: dict) -> dict:
    checks = {k: v for k, v in run["runs"]["relit"]["gpu"].items() if k.startswith(("fixture_", "sample_"))}
    ok = {k: v["checked"] > 0 and v["worstCodeDistance"] <= 1 and v["alphaMismatches"] == 0 and v["missing"] == 0 for k, v in checks.items()}
    timings = {k: v for k, v in run["runs"]["relit"]["gpu"].items() if k.startswith("timings_")}
    return {"checks": checks, "timings": timings, "pass": bool(checks) and all(ok.values())}


def fallback_report(run: dict) -> dict:
    runs = {k: run["runs"][k] for k in ("webgl", "medium")}
    return {"runs": runs, "pass": all(r["relightRequests"] == 0 and not r["relightInstalled"] for r in runs.values())}


def loading_report(run: dict) -> dict:
    off, relit = run["runs"]["off"], run["runs"]["relit"]
    long_off = [t for t in off["longTasks"] if t > LONG_TASK_MS]
    long_relit = [t for t in relit["longTasks"] if t > LONG_TASK_MS]
    new_messages = sorted(set(relit["messages"]) - set(off["messages"]))
    ok = max(relit["longTasks"], default=0) <= max(max(off["longTasks"], default=0), LONG_TASK_MS) and len(long_relit) <= len(long_off)
    return {"offLongTasks": long_off, "relitLongTasks": long_relit, "newMessages": new_messages, "pass": ok and not new_messages}


def prepare(cfg) -> str:
    """Seeds the moved comparison with the proof's views, night photographs and window/fixture masks."""
    work, proof = cfg.paths["work"], cfg.paths["proofWork"]
    root = os.path.dirname(work)
    os.makedirs(os.path.join(work, "cmp"), exist_ok=True)
    if not os.path.exists(os.path.join(work, "views.json")):
        shutil.copyfile(os.path.join(proof, "views.json"), os.path.join(work, "views.json"))
    for view in NIGHT_STATIONS:
        photo = os.path.join(work, "cmp", f"photo_{view}.png")
        if not os.path.exists(photo):
            shutil.copyfile(os.path.join(proof, "cmp", f"photo_{view}.png"), photo)
    masks = os.path.join(root, "renders", "A_mask")
    if not os.path.isdir(masks):
        shutil.copytree(os.path.join(os.path.dirname(proof), "renders", "A_mask"), masks)
    return root


def run(cfg, _args) -> int:
    root = prepare(cfg)
    renders = os.path.join(root, "renders")
    evidence = os.path.join(cfg.paths["evidence"], "r1b")
    with open(os.path.join(evidence, "r1b-browser-run.json"), encoding="utf-8") as f:
        browser = json.load(f)
    cmp = importlib.import_module("07_compare")
    report = {
        "identity": identity_report(renders), "captured": captured_report(renders), "gpu": gpu_report(browser),
        "photo": photo_report(cmp), "fallback": fallback_report(browser), "loading": loading_report(browser),
    }
    report["pass"] = all(section["pass"] for section in report.values())
    with open(os.path.join(evidence, "r1b-browser-checks.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=1)
    for name, section in report.items():
        if name != "pass":
            print(f"{name}: {'pass' if section['pass'] else 'FAIL'}", flush=True)
    for view, record in report["photo"]["views"].items():
        print(f"  {view}: r relit {record['relit']['r']} served {record['served']['r']} (needs {record['threshold']})", flush=True)
    return 0 if report["pass"] else 1
```

In `tools/relight/relight/__main__.py`, directly after the line that creates `COMMANDS` (today `COMMANDS: dict = {}`), add:

```python
from . import browsercheck  # noqa: E402  (R1b: the browser's renders against I1a, the capture and the photographs)

COMMANDS["browser-check"] = browsercheck.run
```

- [ ] **Step 5: Run the tests**

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_browsercheck -v`
Expected: PASS, 5 tests.

- [ ] **Step 6: The browser driver** — create `packages/web/scripts/relight-verify.mjs`:

```js
import { chromium } from "@playwright/test";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// R1b browser verification (T-639, plan Task 18). Drives the REAL walk route on
// the REAL GPU (headed Chromium), holding the build PC's GPU lock throughout:
// renders the proof's seven views as served, relit at the captured light and at
// the three presets; reads the GPU's multiplier words back against the CPU
// kernel and R1a's test vectors; checks the WebGL2 fallback and a below-desktop
// tier stay as captured; records long tasks and console messages. The Python
// `browser-check` command judges what this writes.
//
//   node scripts/relight-verify.mjs                                   (R1b, dev server on 5192)
//   RELIGHT_VERIFY_BASELINE=1 RELIGHT_VERIFY_BASE_URL=http://127.0.0.1:5193 node scripts/relight-verify.mjs
// ---------------------------------------------------------------------------

const BASE_URL = process.env.RELIGHT_VERIFY_BASE_URL ?? "http://127.0.0.1:5192";
const BASELINE = process.env.RELIGHT_VERIFY_BASELINE === "1";
const ROOT = process.env.RELIGHT_VERIFY_ROOT ?? "D:/claude/relight/grand-hall";
const VIEWS = process.env.RELIGHT_VERIFY_VIEWS ?? "D:/claude/real-hall/renovation/relight/work/views.json";
const VECTORS = process.env.RELIGHT_VERIFY_VECTORS ?? "src/lib/relight/__fixtures__/relight-vectors.json";
const LOCK = "D:/claude/visual-firstprinciples-20260928/gpu.lock";
const OWNER = "relight-verify (T-639 R1b)";
const WIDTH = 1920, HEIGHT = 1080, SCALE = 2;
const LOAD_TIMEOUT_MS = 240_000;
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function takeLock() {
  for (let waited = 0; ; waited += 30_000) {
    try {
      const handle = await open(LOCK, "wx");
      await handle.writeFile(JSON.stringify({ owner: OWNER, since: new Date().toISOString() }));
      await handle.close();
      return;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const holder = await readFile(LOCK, "utf8").catch(() => "?");
      if (waited >= 3_600_000) throw new Error(`The GPU lock is still held after an hour: ${holder}`);
      console.log(`waiting for the GPU lock: ${holder}`);
      await sleep(30_000);
    }
  }
}

async function releaseLock() {
  const holder = await readFile(LOCK, "utf8").catch(() => "");
  if (holder.includes(OWNER)) await rm(LOCK, { force: true });
}

async function openWalk(browser, query) {
  const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: SCALE });
  const page = await context.newPage();
  const messages = [], requests = [];
  page.on("console", (message) => { if (message.type() === "error" || message.type() === "warning") messages.push(`${message.type()}: ${message.text()}`); });
  page.on("pageerror", (error) => { messages.push(`pageerror: ${error.message}`); });
  page.on("request", (request) => { requests.push(request.url()); });
  await page.addInitScript(() => {
    window.__longTasks = [];
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__longTasks.push(Math.round(entry.duration)); })
      .observe({ type: "longtask", buffered: true });
  });
  const started = Date.now();
  await page.goto(`${BASE_URL}/room/grand-hall?bare=1${query.length > 0 ? `&${query}` : ""}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(() => window.__roomWalk?.complete === true, undefined, { timeout: LOAD_TIMEOUT_MS });
  return { context, page, messages, requests, loadMs: Date.now() - started };
}

async function captureViews(page, views, label) {
  const folder = join(ROOT, "renders", label);
  await mkdir(folder, { recursive: true });
  for (const view of views) {
    const dataUrl = await page.evaluate(async (request) => (await window.__roomViewCapture(request)).dataUrl,
      { position: view.pos, target: view.tgt, fov: view.fov, width: WIDTH * SCALE, height: HEIGHT * SCALE });
    await writeFile(join(folder, `${view.name}@2x.png`), Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64"));
  }
}

async function summary(walk) {
  return {
    loadMs: walk.loadMs,
    messages: walk.messages,
    longTasks: await walk.page.evaluate(() => window.__longTasks),
    relightRequests: walk.requests.filter((url) => url.includes("/relight/")).length,
    relightInstalled: await walk.page.evaluate(() => window.__relight !== undefined),
  };
}

async function main() {
  const views = JSON.parse(await readFile(VIEWS, "utf8"));
  const vectors = BASELINE ? null : JSON.parse(await readFile(VECTORS, "utf8"));
  const record = { startedAt: new Date().toISOString(), baseUrl: BASE_URL, baseline: BASELINE, runs: {} };
  await takeLock();
  const browser = await chromium.launch({
    headless: false,
    args: ["--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-features=CalculateNativeWinOcclusion"],
  });
  try {
    if (BASELINE) {
      for (const label of ["I1a_a", "I1a_b"]) {
        const walk = await openWalk(browser, "");
        await captureViews(walk.page, views, label);
        record.runs[label] = { loadMs: walk.loadMs, messages: walk.messages };
        await walk.context.close();
      }
    } else {
      const off = await openWalk(browser, "relight=off");
      await captureViews(off.page, views, "R1b_off");
      record.runs.off = await summary(off);
      await off.context.close();

      const captured = await openWalk(browser, "light=captured&floorskin=v1");
      await captured.page.waitForFunction(() => window.__relight?.state().relit === true, undefined, { timeout: 120_000 });
      await captureViews(captured.page, views, "R1b_captured");
      record.runs.captured = await summary(captured);
      await captured.context.close();

      const relit = await openWalk(browser, "light=night");
      await relit.page.waitForFunction(() => window.__relight?.state().relit === true, undefined, { timeout: 120_000 });
      const gpu = {};
      for (const setting of ["captured", "night", "sunny_morning"]) {
        gpu[`fixture_${setting}`] = await relit.page.evaluate(([value, name]) => window.__relight.fixture(value, name), [vectors, setting]);
      }
      for (const [preset, label] of [["night", "R1b_night"], ["sunny", "R1b_sunny"], ["overcast", "R1b_overcast"]]) {
        await relit.page.evaluate((name) => window.__relight.select(name), preset);
        gpu[`sample_${preset}`] = await relit.page.evaluate(() => window.__relight.sample(97));
        gpu[`timings_${preset}`] = await relit.page.evaluate(() => window.__relight.timings());
        await captureViews(relit.page, views, label);
      }
      for (const minutes of [420, 1080]) {
        await relit.page.evaluate((value) => window.__relight.select("sunny", value), minutes);
        gpu[`sample_sunny_${String(minutes)}`] = await relit.page.evaluate(() => window.__relight.sample(97));
      }
      record.runs.relit = { ...(await summary(relit)), state: await relit.page.evaluate(() => window.__relight.state()), gpu };
      await relit.context.close();

      for (const [label, query] of [["webgl", "light=night&nativeWebGL=1"], ["medium", "light=night&splat=tier:medium"]]) {
        const walk = await openWalk(browser, query);
        await sleep(3000);
        record.runs[label] = await summary(walk);
        await walk.context.close();
      }
    }
  } finally {
    await browser.close();
    await releaseLock();
  }
  const folder = join(ROOT, "evidence", "r1b");
  await mkdir(folder, { recursive: true });
  const file = join(folder, BASELINE ? "r1b-baseline-run.json" : "r1b-browser-run.json");
  await writeFile(file, JSON.stringify(record, null, 2));
  console.log(`wrote ${file}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
```

- [ ] **Step 7: Serve R1b in development** (a long-running process; start it in the background and leave it running until Step 12)

```bash
cd D:/claude/real-hall/repo/packages/web && SPLAT_STAGING_ROOT='D:\claude\splats' pnpm exec vite --host 127.0.0.1 --port 5192 --strictPort
```
Then check the staged package is served:

```bash
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" http://127.0.0.1:5192/splats/trades-hall/grand-hall/relight/v1/manifest.json
```
Expected: `200 application/json`.

- [ ] **Step 8: Render the I1a baseline from the base commit** (a second worktree and server on 5193, same staged captures)

```bash
cd D:/claude/real-hall/repo && git worktree add D:/claude/relight/grand-hall/i1a-baseline "$(cat D:/claude/relight/grand-hall/evidence/r1b/base-commit.txt)" && cd D:/claude/relight/grand-hall/i1a-baseline && pnpm install --frozen-lockfile && pnpm --filter @omnitwin/types build
```
Start its server in the background: `cd D:/claude/relight/grand-hall/i1a-baseline/packages/web && SPLAT_STAGING_ROOT='D:\claude\splats' pnpm exec vite --host 127.0.0.1 --port 5193 --strictPort`. Then:

```bash
cd D:/claude/real-hall/repo/packages/web && RELIGHT_VERIFY_BASELINE=1 RELIGHT_VERIFY_BASE_URL=http://127.0.0.1:5193 node scripts/relight-verify.mjs
```
Expected: `wrote D:/claude/relight/grand-hall/evidence/r1b/r1b-baseline-run.json`, and seven PNGs in each of `renders/I1a_a` and `renders/I1a_b`. Stop the 5193 server afterwards.

- [ ] **Step 9: Run the R1b verification**

```bash
cd D:/claude/real-hall/repo/packages/web && node scripts/relight-verify.mjs
```
Expected: `wrote D:/claude/relight/grand-hall/evidence/r1b/r1b-browser-run.json`; seven PNGs in each of `renders/R1b_off`, `R1b_captured`, `R1b_night`, `R1b_sunny`, `R1b_overcast`. A thrown error (a view capture refused, `__relight` never relit, a fixture setting unknown) is a failure to diagnose, not to retry blindly.

- [ ] **Step 10: Judge the renders and the run**

```bash
cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m relight browser-check --config config/grand-hall.json
```
Expected: `identity: pass`, `captured: pass`, `gpu: pass`, `photo: pass` (with the two stations' r printed, relit ≥ 0.85 at mp43 and ≥ 0.80 at mp45, each ≥ served), `fallback: pass`, `loading: pass`, exit 0. On any `FAIL`, keep the evidence file, find the cause (for example: `fixture_*` `missing` > 0 means contract 4 or 5 differs — the live positions do not map onto the vectors' model frame; `identity` failing means the hook changed the unrelit graph; `loading` failing on a single long task names the step to split) and fix it; never loosen a threshold.

- [ ] **Step 11: The drag budget, relit and off** (the lock is taken exclusively; if the first command fails with `EEXIST`, wait for the holder and rerun)

```bash
cd D:/claude/real-hall/repo/packages/web && LOCK=D:/claude/visual-firstprinciples-20260928/gpu.lock && node -e "require('fs').writeFileSync(process.argv[1], JSON.stringify({owner:'relight drag budget (T-639 R1b)',since:new Date().toISOString()}),{flag:'wx'})" "$LOCK" && { SPLAT_BUDGET_LABEL=r1b-off SPLAT_BUDGET_QUERY="relight=off" SPLAT_BUDGET_OUT_DIR=D:/claude/relight/grand-hall/evidence/r1b node scripts/splat-drag-budget.mjs; SPLAT_BUDGET_LABEL=r1b-night SPLAT_BUDGET_QUERY="light=night" SPLAT_BUDGET_OUT_DIR=D:/claude/relight/grand-hall/evidence/r1b node scripts/splat-drag-budget.mjs; node -e "require('fs').rmSync(process.argv[1])" "$LOCK"; }
```
Expected: two summary lines. The relit run's median p95 is at most 16.7 ms and at most 1 ms above the off run's (`summary.medianP95Ms` in `r1b-night.json` and `r1b-off.json`). Record both in the session log; if either bound fails, report the numbers — it is a blocker for the ship task, not a tuning knob to loosen.

- [ ] **Step 12: Stop the servers and remove the baseline worktree**

```bash
cd D:/claude/real-hall/repo && git worktree remove D:/claude/relight/grand-hall/i1a-baseline --force && git worktree prune && git status --short
```
Expected: the baseline worktree gone; `git status` shows only this task's new files (the renders and evidence are on D: outside the repository).

- [ ] **Step 13: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/scripts/relight-verify.mjs tools/relight/relight/browsercheck.py tools/relight/relight/__main__.py tools/relight/tests/test_browsercheck.py && (test -z "$(git ls-files tools/relight/proof/shots.py)" && git add tools/relight/proof/shots.py || true) && git diff --cached --stat && git commit -m "test(relight): browser verification: identity, captured light, GPU against CPU, photographs, fallbacks (T-639 R1b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: Integrate, record and ship to a preview for Blake

**Files:**
- Modify: `docs/engineering/native-splats.md`, `docs/engineering/relight-package.md`, `docs/sessions/<the day's date>.md`, `docs/state/tasks.md`
- Possibly regenerated: `patches/three@0.186.0.patch`, `pnpm-lock.yaml` (Step 1)

**Interfaces:**
- Consumes: every earlier task; Task 18's evidence under `D:/claude/relight/grand-hall/evidence/r1b/`.
- Produces: an open PR from `claude/real-hall` with green CI, the GPU gate passed, a Vercel preview link for Blake; merged only on Blake's explicit go-ahead.

The delivery contract (`.claude/conventions/shipping-changes.md`) applies, with the decision for this slice: Blake judges the presets and the hour slider on the Vercel preview (spec §6), so the merge waits for his explicit go-ahead; venviewer.com keeps its hold throughout (the relit hall and the control exist only where `gaussianSplatsAvailable()` is true, and the control is not in the production bundle).

- [ ] **Step 1: Land after T-640, regenerating the shared patch on top of it**

```bash
cd D:/claude/real-hall/repo && git fetch origin && git log --oneline origin/master -8 -- patches/three@0.186.0.patch && git merge-base --is-ancestor origin/master HEAD && echo "master already merged" || echo "master has new commits"
```
If `origin/master` has commits this branch lacks: `git merge origin/master`. If `patches/three@0.186.0.patch` or `pnpm-lock.yaml` conflict (T-640 changed the patch), take master's versions (`git checkout --theirs patches/three@0.186.0.patch pnpm-lock.yaml && pnpm install`), then redo Task 9 Step 3 on top (the three `once()` anchors are unchanged by T-640, so `apply-working-colour.mjs` applies as is), and run:

```bash
cd D:/claude/real-hall/repo && pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/native-addon-working-colour.test.ts && pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/native-addon-performance.test.ts && pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/native-splat-scene.test.ts
```
Expected: all pass. Commit the merge with the regenerated patch and lockfile (explicit pathspecs; message `Merge origin/master into claude/real-hall (T-640 first; R1b's hook regenerated on top)` plus the Co-Authored-By line). If T-640 is ready but not yet on master, tell the controller: T-640 lands first, then this step.

After such a merge, count the relit vertex stage's storage buffers on the merged patch: the eight listed in Global Constraints plus every storage buffer T-640 adds to `createMaterialNodes`' vertex node (each `buffers.<name>Read` or `storage(…)` it reads). If the count is above 8, set `RELIT_VERTEX_STORAGE_BUFFERS` in `packages/web/src/lib/native-splat-scene.ts` to it and rerun `src/lib/__tests__/native-splat-scene.test.ts` (its default-support test reads the constant). Task 12's canvas then requests the adapter's headroom and the host relights only devices whose negotiated limit reaches the count; record the build PC adapter's `maxStorageBuffersPerShaderStage` (`(await navigator.gpu.requestAdapter()).limits`) in the session log. Commit that with the merge. Then rerun Task 18 Steps 7–11 on the merged code, because the evidence must describe what ships; the relit run's `loading` check fails on any WebGPU validation error, a storage-buffer overflow included.

- [ ] **Step 2: Record the change in the engineering notes**

Append to `docs/engineering/native-splats.md`:

```markdown
## Relit draws (T-639 R1b)

A room with a relight package (`docs/engineering/relight-package.md`) is drawn relit on preview builds,
desktop-class devices and the WebGPU backend. `RelightProvider` turns the package into a `RelightFrame`
(probe volumes, stencil atlas, floor light, uniforms) and sets it on the native host with `setRelight`; a
relit draw's key carries `relit`, so relighting builds a second draw beside the captured one and never
edits a draw in place. Each draw owns a `RelightDraw`: its sources' 12-byte records merged in draw order,
and a TSL compute pass writing one packed multiplier word per splat. The pass runs when the draw is built,
when late records arrive and after `RelightFrame.apply` (a light change) — never per frame; the frame's
probe fold runs once per light change before it. The patched `GaussianSplat` applies the word through its
`workingColorNode` (multiplier and display) and the opacity hook (alpha 0 for the glass and the view
outside). Without a package, on WebGL2 and below desktop class, the host builds exactly the I1a draw.
Tiles placed differently in one draw cannot share its scene-to-model transform; that draw is drawn as
captured with one warning. The DEV instruments on `window.__relight` read the words back against the
CPU kernel (`lib/relight/relight-kernel.ts`) and R1a's test vectors.
```

Append to `docs/engineering/relight-package.md`:

```markdown
## In the browser (T-639 R1b)

`lib/relight-package.ts` fetches and verifies the package in a worker (every file's size and SHA-256
against `files`, gzip inflated with a size bound, PNGs decoded, the floor's bounce taken at each texel),
refusing a package whose schema, sources, windows, paths or checksums differ; the hall is then drawn
as captured with one console warning. Tiles are matched by the SHA-256 of the served `.sog`
(`tiles[].tileSha256`); a tile whose records are missing, unreadable or of another count is drawn as
captured. The probe volume (the coarse bounce grid, sized only by `probes.shape`) stays binary16 and is
folded on the GPU per light change; the floor's base light is recomputed on the CPU (5 cm texels) and
the sun on the floor per pixel from the stencils. The light setting (`lib/light-setting.ts`) derives
each preset's setting, its emitter boost included, from `presetsFromProof` exactly at the preset's own
date and hour and scales the sky with the sun's elevation; the kernel gates each window's sun and its
bounce by the window's `horizon` exactly as `reference.py` does. The display rolls off only above each
splat's own captured peak (0.8 for the floor and sky panels), so the captured light is the identity.
R2 serves `.gz` files as `application/octet-stream` without `Content-Encoding` (the checksums are of
the compressed bytes).
```

- [ ] **Step 3: The session log and the task board**

Append to `docs/sessions/<the day's date>.md` a section `## T-639 R1b: relit in the browser` stating: the branch and commits, what was built (one line per task group), and Task 18's measured results copied from `r1b-browser-checks.json` (identity, captured p99 per view, GPU worst code distances, photo r relit/served at stations 43 and 45, the fallbacks, long tasks, the drag budget p95 relit/off), plus the preview link once Step 7 has it, and any failed check with its cause. In `docs/state/tasks.md`, add a dated line above the 2026-09-29 T-639 lines: `- <date> T-639 R1b (relit in the browser) built on claude/real-hall: <one-sentence result>; preview <link>; merge waits for Blake.` and append the same sentence to the T-639 row's notes.

- [ ] **Step 4: Full verification** (one test file per command; stop at the first failure and fix its cause)

```bash
cd D:/claude/real-hall/repo
for f in src/lib/relight/__tests__/relight-codec.test.ts src/lib/relight/__tests__/relight-manifest.test.ts src/lib/relight/__tests__/relight-warning.test.ts src/lib/relight/__tests__/relight-png.test.ts src/lib/relight/__tests__/relight-kernel.test.ts src/lib/relight/__tests__/relight-assets.test.ts src/lib/__tests__/relight-package.test.ts src/lib/__tests__/sun.test.ts src/lib/relight/__tests__/display.test.ts src/lib/relight/__tests__/floor-light.test.ts src/lib/relight/__tests__/daylight.test.ts src/lib/__tests__/light-setting.test.ts src/stores/__tests__/light-setting-store.test.ts src/lib/__tests__/native-addon-working-colour.test.ts src/lib/__tests__/native-addon-antialias.test.ts src/lib/relight/__tests__/relight-frame.test.ts src/lib/relight/__tests__/relight-apply.test.ts src/lib/relight/__tests__/relight-draw.test.ts src/lib/__tests__/native-splat-scene.test.ts src/lib/relight/__tests__/relight-tile-load.test.ts src/components/scene/__tests__/NativeSplatLayer.test.tsx src/lib/__tests__/floor-skin.test.ts src/components/stage/__tests__/StageFloor.test.tsx src/lib/relight/__tests__/sky-panels.test.ts src/components/scene/__tests__/RelightProvider.test.tsx src/components/rooms/__tests__/RoomSplatScene.test.tsx src/lib/__tests__/splat-staging-plugin.test.ts src/components/rooms/__tests__/LightControl.test.tsx src/lib/relight/__tests__/relight-debug.test.ts src/lib/__tests__/native-current-view-capture.test.ts src/components/scene/__tests__/NativeCanvas.test.tsx; do pnpm --filter @omnitwin/web exec vitest run "$f" || { echo "FAILED: $f"; break; }; done
pnpm --filter @omnitwin/web typecheck && pnpm exec eslint packages/web/src && cd tools/relight && C:/Python313/python.exe -m unittest tests.test_browsercheck tests.test_codec -v
```
Expected: every file passes, typecheck and lint exit 0, the Python tests pass.

Then the production bundle must not contain the control or the instruments, and the preview bundle must. `vite.config.ts` defines `import.meta.env.VITE_DEPLOY_ENV` from `VERCEL_ENV` at build time, so the unused branch and its dynamic import are removed:

```bash
cd D:/claude/real-hall/repo && VERCEL_ENV=production pnpm --filter @omnitwin/web build && (grep -rl "Preparing the light" packages/web/dist && echo "LEAK: the light control is in the production bundle" || echo "production bundle clean") && (grep -rl "__relight" packages/web/dist && echo "LEAK: the DEV instruments are in the production bundle" || echo "no instruments") && VERCEL_ENV=preview pnpm --filter @omnitwin/web build && grep -rl "Preparing the light" packages/web/dist >/dev/null && echo "preview bundle has the control"
```
Expected: `production bundle clean`, `no instruments`, `preview bundle has the control`. A leak is fixed at its cause (a static import of the module), never by weakening the check.

- [ ] **Step 5: The package is published where previews read it** (contract 6; R1b does not publish)

```bash
cd D:/claude/real-hall/repo && node -e "
const base='https://pub-2bf1ea54c4c642d3b19067b97c55dc5d.r2.dev/splats/trades-hall/grand-hall/';
const m=require('D:/claude/splats/trades-hall/grand-hall/relight/v1/manifest.json');
const f=require('D:/claude/splats/trades-hall/grand-hall/floor-skin/v2/floor-skin.json');
const paths=['relight/v1/manifest.json',...Object.keys(m.files).map(p=>'relight/v1/'+p),'floor-skin/v2/floor-skin.json',...Object.keys(f.files).map(p=>'floor-skin/v2/'+p)];
(async()=>{let bad=0;for(const p of paths){const r=await fetch(base+p,{method:'HEAD'});const enc=r.headers.get('content-encoding'),type=r.headers.get('content-type');if(!r.ok||enc||(p.endsWith('.gz')&&type!=='application/octet-stream')){bad++;console.log(r.status,enc,type,p);}}console.log(paths.length,'files,',bad,'problems');})();"
```
Expected: `<n> files, 0 problems`. This checks contract 6, which R1a produces. Any 404 means the package or floor skin v2 is not published (R1a's publisher recursing into `tiles/`, `windows/` and `floor/`). Any `content-encoding`, or a `.gz` not served as `application/octet-stream`, means R2 would hand the browser bytes whose checksums fail. In any of these cases stop and report to the controller; the preview would draw the hall as captured.

- [ ] **Step 6: Push and open (or update) the PR**

```bash
cd D:/claude/real-hall/repo && git status --short && git push -u origin claude/real-hall && gh pr list --head claude/real-hall --state open
```
If a PR from this branch is open (R1a's), add R1b to its description; otherwise create one:

```bash
cd D:/claude/real-hall/repo && gh pr create --base master --head claude/real-hall --title "T-639 R1b: the Grand Hall relit in the browser (preview only)" --body "$(cat <<'EOF'
The Grand Hall in the walk view relights live from the R1a relight package, on preview builds and desktop-class WebGPU devices only: night with the lamps lit, sunny morning, overcast noon, any hour from 06:00 to 22:00 and any date, from a preview-only light control. The restored floor (floor skin v2) is drawn lit by the same light, and each window shows a sky panel. Anything missing, WebGL2 and every smaller device keep the hall exactly as captured; venviewer.com keeps its hold and its bundle has no light control.

Verification (evidence D:/claude/relight/grand-hall/evidence/r1b on the build PC):
- relight off against I1a from the base commit: <identity result>
- captured light against relight off, outside windows and fixtures: p99 <value> stops (limit 0.05)
- GPU words against the CPU kernel and R1a's 64 test-vector splats: worst <n> code (limit 1), alpha exact
- night against Matterport's photographs: r <relit>/<served> at station 43 (needs 0.85), <relit>/<served> at station 45 (needs 0.80)
- WebGL2 and below-desktop tiers: no relight request; loading adds no task over 50 ms
- drag budget p95: <relit> ms relit, <off> ms off (limit 16.7 ms and +1 ms)

Blake judges the presets and the hour slider on the Vercel preview; merge waits for his go-ahead.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
Fill each `<…>` from `r1b-browser-checks.json`, `r1b-night.json` and `r1b-off.json` before running it; do not open the PR with any left unfilled.

- [ ] **Step 7: CI, the GPU gate and the preview**

Run: `cd D:/claude/real-hall/repo && gh pr checks --watch`
Expected: every check green except "GPU performance (required)" waiting for its operator. Run the GPU gate as its operator on this PC within its 25-minute window, following `.github/gpu/README.md` and `.github/gpu/PUBLISHING.md`: fetch the request's `sourceCommit` (the PR merge ref), archive it and check `python .github/gpu/source_manifest.py --repo D:/claude/real-hall/repo --commit <sha>` against `trusted.json`; in WSL Ubuntu install with `pnpm install --frozen-lockfile --prefer-offline`, delete `<workspace>/node-compile-cache`, run `.github/gpu/run-worker.py` holding `D:/claude/visual-firstprinciples-20260928/gpu.lock` (with `--pnpm /root/.local/share/pnpm/.tools/pnpm/9.15.4`), then publish with `node .github/gpu/publish-result.mjs … --run-id <run> --attempt <attempt> --source <sha>` from the controller extracted from that commit. Do not push to the branch after publishing. Expected: the gate job and "Browser release gate" pass.

Open the Vercel preview for the PR (the deployment URL from `gh pr view --json comments` or the Vercel check), and on it check with the Browser tools: `/room/grand-hall` loads, the light control appears once the package is ready, "Night, lamps lit" darkens the windows and lights the lamps, the hour slider on "Sunny morning" moves the sun patches on the floor, and the console has no errors. Record the preview URL in the session log and the PR. Deployment Protection may require Blake's Vercel login: give him the link.

- [ ] **Step 8: Hand the preview to Blake, and merge only on his go-ahead**

Send the controller: the preview link, the PR link, the verification summary (Step 6's bullets) and any failed check. Merge only after Blake's explicit go-ahead in chat (`gh pr merge --merge`), then confirm production kept its hold: `https://venviewer.com/room/grand-hall` shows no splats, makes no `/relight/` request and has no light control, checked with the Browser tools. Update the session log and `docs/state/tasks.md` with the merge commit and the production check (explicit pathspecs, pushed to master through the normal path).

---

## Self-review

**Spec coverage** (`docs/superpowers/specs/2026-09-29-the-restored-hall-design.md`):

| Requirement | Tasks |
|---|---|
| §3 R1: the walk relights live from a preview-only control (three presets, hour, date); desktop previews first | 8, 10–13, 15, 16 |
| §3 R1 / §4.3: the restored floor drawn lit by the same light, sun patches with sharp edges | 7, 14 |
| §3 R1 / §4.3: glass splats hidden, a sky panel behind each window, dark at night and bright by day | 11 (alpha), 12 (opacity hook), 15 (panels) |
| §4.2: manifest validated at run time; refusal of another model version or counts; checksum per file; captured light rebuilt, not stored | 2, 5, 13; 4, 10, 11 (capture volume and weights) |
| §4.3: the light setting (date, time, place, sun, sky, lamp levels, exposure) | 6, 8 |
| §4.3: per-splat multiplier by GPU compute when the setting changes, never per frame, clamped 1/16–8, one extra buffer read per splat | 4, 10, 11, 12, 15 |
| §4.3: sun term along the ray to each window plane through its stencil, weighted by the normal, each window gated by its horizon exactly as reference.py | 4, 7, 11, 14 |
| §4.3: linear relighting, exposure, 60% white balance, neutral roll-off above a per-call knee (the splat's own captured peak, 0.8 for floor and sky), no film curve; captured light as I1a | 7, 8, 10, 11, 14, 15 |
| R1a's emitter boost as a setting (1 captured, 4 night, 1 otherwise) | 4, 8, 10, 11 |
| WebGPU's 8 storage buffers per stage: the canvas takes the adapter's headroom, the host relights only where the limit covers a relit draw | 12, 19 |
| §4.4: `relight-package.ts` (worker decode, null when absent or invalid), `sun.ts` (NOAA), `light-setting.ts` and store, the patch hook, floor lighting in the floor-skin path, the preview-only control | 5, 6, 8, 9, 14, 16 |
| §5: missing/invalid/mismatched package → as captured with one warning; v2 → v1 → none; below desktop and WebGL2 → as captured; clamps; control only in previews | 2, 5, 8, 13, 14, 15, 16, 19 |
| §6: unit tests (manifest and decoder with refusals, sun within 0.1° of NOAA, weights and clamps, compute against a CPU reference) | 1–8, 11, 17, 18 |
| §6: photo check (≥ 0.80 at station 45, ≥ 0.85 at 43, never worse than captured) | 18 |
| §6: no change when off; captured light within 1/20 stop | 18 |
| §6: Twin budgets, the GPU benchmark, decoding in a worker, no main-thread task over 50 ms | 5, 10, 18, 19 |
| §6: Blake judges the presets and slider on the Vercel preview | 19 |
| §8: the shared patch sequenced after T-640 | 9, 19 |

**Limits, stated rather than designed around:**
- "Pixel for pixel" with no package is judged against I1a's own run-to-run difference: if the GPU sort makes two I1a renders differ, R1b off may differ by no more than that.
- The captured-light check leaves out only the view out of the windows (the glass is hidden by design) and keeps the photographed floor (`?floorskin=v1`), since the restored floor is meant to differ. With emitter boost 1 and each splat's own knee, everything else, fixtures included, must match within 1/20 of a stop; the only remaining difference is the multiplier word's quantisation of 1 (−0.004 stop).
- The photo check is run on the night preset at the two night stations the proof has photographs for (43 and 45); the day photographs have the house lights on and match no R1 preset.
- The probe grid's size is whatever the manifest's `probes.shape` says (R1a's coarse 0.5 m grid, about 13,000 probes, 4 MB); loading's long tasks are measured in Task 18, not assumed.
- If T-640 adds a vertex-stage storage buffer, an adapter that offers only 8 draws the hall as captured (Task 12's check, the count raised in Task 19 Step 1).

**Placeholder scan:** no "TBD", "TODO" or "similar to Task N"; every code step carries its code. The only `<…>` fields are in Task 19's PR body and session-log entry, which must be filled from Task 18's measured evidence before use.

**Type and name consistency** (checked across tasks): `RelightModelData.probes` is `Uint16Array` everywhere (Tasks 5, 10); `denseProbeField(manifest, probes, valid)`; `prepareKernelFrame(model, setting)` takes no gates, since `horizonGates` inside it is the only source of `windowOpen` (Tasks 4, 7, 10, 17), and `RelightKernelModel` carries `horizons` and `site` in both builders (`kernelModelFromVectors`, `kernelModelFromData`); `RelightSetting.emitterBoost` is set by `capturedSetting`, `settingForChoice` (`PRESET_EMITTER_BOOST`), `settingFromVectors` and read by the kernel and the `emitterBoost` uniform (Tasks 4, 8, 10, 11); `DisplayParams` and `DisplayUniforms` have no roll-off switch, and every `displayNode` call passes a knee (`splatKneeNode(rgb)` in Task 11, `float(HIGHLIGHT_KNEE)` in Task 14 and inside `skyPanelNode` for Task 15); `ChoiceLight` and `RelightApplication` carry no `windowOpen`; `RelightFrame.prepare` is called by `RelightDraw.run` (Tasks 10, 11) and counted in Tasks 10–12's compute expectations; `RELIT_VERTEX_STORAGE_BUFFERS` and `nativeRendererStorageBuffersPerStage` (Task 12) are what Task 19 Step 1 adjusts; `NativeSourceHandle.setRelight` (Task 12) is what `NativeSplatLayer` calls (Task 13); `relightBackendSupported(gl: unknown)` is used by Tasks 13, 15; `RelightState { frame, pending }` by Tasks 14, 15; `LightPresetId` values `captured | night | sunny | overcast` in Tasks 8, 16, 17, 18; `findSplatsByRecord` (Task 17) is what `fixture` uses; `window.__relight`, `window.__roomViewCapture` and `window.__roomWalk` are what the Task 18 driver calls; `browsercheck.run(cfg, args)` is the registered command.
