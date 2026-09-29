# The Real Hall — I1a "Looks right" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In development and preview builds, the Grand Hall shows its captured splats without the film curve or false anti-aliasing dimming, stands on a photographic floor in place of the smeared splat floor, and phones receive a phone-sized splat budget; production keeps the founder hold.

**Architecture:** Five contained changes on the existing native renderer (three 0.186 WebGPURenderer + the pnpm-patched first-party `GaussianSplat`). (1) One access function decides where splats run; preview builds join development. (2) The patched addon gains an `antialias` option and the splat host passes `false`, because every native loader already refuses (or after this plan refuses) anti-aliased sources. (3) Canvases showing a captured room use no tone mapping. (4) Device classification learns the form factor, so iPhones and Android phones leave the desktop tier. (5) A floor-skin package (photographic texture tiers, a 5 cm height grid and a floor-slab mask, built offline from the 28 September research) is drawn as an opaque mesh under the same transform as the splats, and the splat host hides the floor-slab splats with a per-splat mask test in the existing opacity node. Spec: `docs/superpowers/specs/2026-09-28-the-real-hall-design.md` (§3.2 A-lite, §3.4, §3.6, §3.7, §4 I1). Exact display-space splat blending (spec §3.2) is the follow-on plan I1b; this plan measured the gap first (see "Evidence this plan relies on").

**Tech Stack:** React 18.3 + @react-three/fiber 8.18, three 0.186 (WebGPURenderer, TSL, pnpm patch), Zod, Vitest 4 + happy-dom, pnpm 9.15.4, Node 22.18, Python 3.13 (`C:/Python313/python.exe`, numpy, OpenCV, Pillow) for the offline floor-skin builder, Playwright (the existing drag-budget harness) for browser evidence.

## Global Constraints

- Work only in the worktree `D:/claude/real-hall/repo`, branch `claude/real-hall` (based on origin/master `5d06a9c9`). Never edit `C:/Users/blake/omnitwin2` (the shared, dirty checkout) or any other worktree.
- Commit with explicit pathspecs only; inspect `git diff --cached --stat` before each commit; every message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Founder hold (19 September 2026) as amended by Blake on 28 September 2026: splats run in development and on preview deployments; production builds (venviewer.com) never show them. No query, saved state or role may override this.
- TypeScript strict: no `any`, no `as unknown as`, no `console` in `src`, `import type` for types, `noUncheckedIndexedAccess` respected.
- Tests: `pnpm --filter @omnitwin/web exec vitest run <path relative to packages/web>`, always in the foreground.
- All visible loading and working states use `packages/web/src/components/shared/Activity.tsx`; this plan adds none.
- Build-PC GPU rule (two power losses on 28 September under concurrent GPU load): one GPU-heavy job at a time; browser renders hold `D:/claude/visual-firstprinciples-20260928/gpu.lock` (JSON `{"owner":"<name>","since":"<ISO>"}`, deleted afterwards); render on demand, never a spinning animation loop.
- Bulk and generated output goes under `D:/claude/`; staged room assets live under `D:/claude/splats/trades-hall/<room>/` (served in development by `SPLAT_STAGING_ROOT`; preview builds read the public R2 bucket directly, because since the 19 September hold every deployment redirects `/splats/*` to `/work-in-progress` — see Task 1b).
- Source captures on `F:` are read-only; research inputs under `D:/claude/visual-firstprinciples-20260928/` are read-only inputs to this plan.
- Floor-skin tiers by device tier: high 4096², medium 2048², low and poster 1024² per tile, two tiles per room floor (2.59 / 5.18 / 10.35 mm per texel). WebP with alpha for I1a; KTX2 arrives with I2.
- Slab removal band: splat centres from 0.15 m below to 0.12 m above the floor plane, inside the floor outline inset about 9 cm from walls and fixtures.
- Floor colour: default `photo` (the photographs as they are); `matched` multiplies by the measured splat/photo floor ratio `[0.708582, 0.575199, 0.62761]` (linear RGB). Blake chooses on the preview (`?floor=matched` in development and preview builds).

## Evidence this plan relies on (measured 28 September 2026)

- Render proof in the product renderer (`D:/claude/visual-firstprinciples-20260928/render-proof/`): control match 53–63 dB; the photographic floor registers to the splats within 1–2 mm; a floor-slab cull between −0.15 m and +0.12 m left no haze above the floor.
- Linear-light blending without the film curve (variant `H1L`) against display-space blending (`H1`): 32.5–34.2 dB on six views (plan view 25.1 dB), mean absolute difference 2.4–4.7 levels, concentrated on edges; today's view scores 23.0–25.8 dB against the same reference. I1a takes the H1L gain now; I1b closes the rest.
- Floor colour ratio splat/photo (Arm A), linear RGB: `[0.708582, 0.575199, 0.62761]` (`render-proof/assets/ibl/gain.json`).

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `packages/web/src/lib/splat-access.ts` | Modify | Where splats may run (development, preview) |
| `packages/web/vite.config.ts` | Modify | Bake Vercel's `VERCEL_ENV` into `import.meta.env.VITE_DEPLOY_ENV` |
| `packages/web/src/vite-env.d.ts` | Modify | Type for `VITE_DEPLOY_ENV` |
| `packages/web/src/__tests__/splat-access.test.tsx` | Modify | Access rules |
| `patches/three@0.186.0.patch` | Modify (regenerated) | `antialias` constructor option on `GaussianSplat` |
| `patches/README.three-native-splats.md` | Modify | Documents `antialias` |
| `packages/web/src/lib/native-gaussian-addon.d.ts` | Modify | Type for `antialias` |
| `packages/web/src/lib/native-splat-spz.ts` | Modify | Refuse anti-aliased SPZ like anti-aliased SOG |
| `packages/web/src/lib/native-splat-scene.ts` | Modify | `antialias: false`; floor-slab exclusion (mask texture + band + matrix) |
| `packages/web/src/lib/splat-exclusion.ts` | Create | Exclusion types, mask resampling, CPU reference of the rule |
| `packages/web/src/lib/capture-display.ts` | Create | Tone mapping for captured rooms |
| `packages/web/src/components/scene/CaptureToneMapping.tsx` | Create | Applies it inside a canvas |
| `packages/web/src/lib/device-tier.ts` | Modify | Form-factor classification |
| `packages/web/src/stores/device-store.ts` | Modify | Uses it |
| `packages/web/src/hooks/use-splat-runtime-profile.ts` | Modify | Uses it |
| `packages/web/src/lib/floor-skin.ts` | Create | Manifest schema, URLs, tier choice, matrices, geometry |
| `packages/web/src/components/stage/StageFloor.tsx` | Create | Draws the floor skin and registers the slab exclusion |
| `packages/web/src/components/editor/PlannerScene.tsx` | Modify | Mounts `CaptureToneMapping` and `StageFloor` |
| `packages/web/src/components/rooms/RoomSplatScene.tsx` | Modify | `flat` canvas and `StageFloor` |
| `tools/floor-skin/build_floor_skin.py` | Create | Offline builder of the floor-skin package |
| `tools/floor-skin/README.md` | Create | How to build and publish it |
| Tests under each `__tests__/` | Create/Modify | Regression coverage per task |
| `docs/engineering/native-splats.md`, `docs/sessions/2026-09-28.md`, `docs/state/tasks.md` | Modify | Record the change |

---

### Task 0: Install and baseline

**Files:** none changed.

- [ ] **Step 1: Install dependencies in the worktree**

```bash
cd D:/claude/real-hall/repo && pnpm install --frozen-lockfile
```
Expected: completes without errors; the store is on D: (pnpm picks a store on the project's drive).

- [ ] **Step 2: Build shared types (the web typecheck needs their declarations)**

```bash
cd D:/claude/real-hall/repo && pnpm --filter @omnitwin/types build
```
Expected: exit 0.

- [ ] **Step 3: Record the baseline of every test file this plan touches**

```bash
cd D:/claude/real-hall/repo && pnpm --filter @omnitwin/web exec vitest run src/__tests__/splat-access.test.tsx src/lib/__tests__/native-splat-scene.test.ts src/lib/__tests__/native-splat-spz.test.ts 2>&1 | tail -8
```
Expected: all pass. Any failure: stop, the base is broken.

---

### Task 1: Splats on preview deployments

**Files:**
- Modify: `packages/web/src/lib/splat-access.ts`
- Modify: `packages/web/vite.config.ts` (the `define` block)
- Modify: `packages/web/src/vite-env.d.ts`
- Test: `packages/web/src/__tests__/splat-access.test.tsx`

**Interfaces:**
- Produces: `export interface SplatAccessEnv { readonly DEV: boolean; readonly VITE_DEPLOY_ENV?: string | undefined }` and `export function gaussianSplatsAvailable(env?: SplatAccessEnv): boolean` (existing callers keep calling it with no argument).

- [ ] **Step 1: Write the failing test** — append to `packages/web/src/__tests__/splat-access.test.tsx`:

```tsx
describe("where splats may run (T-639)", () => {
  it("allows local development", () => {
    expect(gaussianSplatsAvailable({ DEV: true, VITE_DEPLOY_ENV: "" })).toBe(true);
  });

  it("allows preview deployments so Blake can judge on his own devices", () => {
    expect(gaussianSplatsAvailable({ DEV: false, VITE_DEPLOY_ENV: "preview" })).toBe(true);
  });

  it.each(["production", "development", "", undefined])("refuses a %s build", (deployEnv) => {
    expect(gaussianSplatsAvailable({ DEV: false, VITE_DEPLOY_ENV: deployEnv })).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @omnitwin/web exec vitest run src/__tests__/splat-access.test.tsx`
Expected: FAIL — the preview case returns `false` (and TypeScript reports the unexpected argument).

- [ ] **Step 3: Implement** — replace the whole of `packages/web/src/lib/splat-access.ts` with:

```ts
/** Where Gaussian splats may run.
 *
 * Founder hold, 19 September 2026: never on the public site; no query, saved
 * planner state or role overrides it. Blake, 28 September 2026 (T-639):
 * preview deployments may show them so he can judge the Real Hall on his own
 * devices. Production builds always return false. */
export interface SplatAccessEnv {
  readonly DEV: boolean;
  /** Vercel's VERCEL_ENV baked in at build time: "production", "preview" or
   *  "development"; empty outside Vercel. */
  readonly VITE_DEPLOY_ENV?: string | undefined;
}

export function gaussianSplatsAvailable(
  env: SplatAccessEnv = { DEV: import.meta.env.DEV, VITE_DEPLOY_ENV: import.meta.env.VITE_DEPLOY_ENV },
): boolean {
  return env.DEV || env.VITE_DEPLOY_ENV === "preview";
}
```

In `packages/web/src/vite-env.d.ts`, inside `interface ImportMetaEnv`, after `readonly VITE_SPLAT_BASE_URL?: string;`, add:

```ts
  /** Vercel's VERCEL_ENV at build time (vite.config.ts define); empty outside Vercel. */
  readonly VITE_DEPLOY_ENV?: string;
```

In `packages/web/vite.config.ts`, inside the returned `define` object, after the `"import.meta.env.VITE_SPLAT_BASE_URL"` entry, add:

```ts
      // Vercel's deployment environment, so preview links can open splats
      // (T-639) while production keeps the founder hold. Empty outside Vercel.
      "import.meta.env.VITE_DEPLOY_ENV": JSON.stringify(env["VERCEL_ENV"] ?? ""),
```

- [ ] **Step 4: Run the test and the existing hold tests**

Run: `pnpm --filter @omnitwin/web exec vitest run src/__tests__/splat-access.test.tsx`
Expected: PASS, including every existing "production Gaussian splat hold" case.

- [ ] **Step 5: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/splat-access.ts packages/web/src/vite-env.d.ts packages/web/vite.config.ts packages/web/src/__tests__/splat-access.test.tsx && git diff --cached --stat && git commit -m "feat(web): preview deployments may open splats; production keeps the hold (T-639)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Anti-aliasing compensation only for assets that ask for it

**Files:**
- Modify: `patches/three@0.186.0.patch` (regenerated by pnpm)
- Modify: `patches/README.three-native-splats.md`
- Modify: `packages/web/src/lib/native-gaussian-addon.d.ts`
- Modify: `packages/web/src/lib/native-splat-spz.ts` (after the LOD-tree check in `readHeader`)
- Modify: `packages/web/src/lib/native-splat-scene.ts` (the `new GaussianSplat(...)` options in `createSnapshot`)
- Create: `packages/web/src/lib/__tests__/native-addon-antialias.test.ts`
- Test: `packages/web/src/lib/__tests__/native-splat-scene.test.ts`, `packages/web/src/lib/__tests__/native-splat-spz.test.ts`

**Interfaces:**
- Produces: `GaussianSplatOptions.antialias?: boolean` (default `true`, upstream behaviour). The native host always passes `false`; the SOG loader already refuses `antialias: true` archives, and after this task the SPZ loader refuses the anti-aliased flag too.

- [ ] **Step 1: Write the failing contract test** — create `packages/web/src/lib/__tests__/native-addon-antialias.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const source = readFileSync(require.resolve("three/examples/jsm/objects/GaussianSplat.js"), "utf8");

describe("patched GaussianSplat anti-aliasing option (T-639)", () => {
  it("accepts an antialias option that defaults to upstream behaviour", () => {
    expect(source).toContain("constructor( splatGeometry, { antialias = true, autoSort = true,");
  });

  it("skips the opacity compensation when antialias is false", () => {
    expect(source).toContain("const alphaScale = ( antialias ? sqrt( max( detBase.div( max( det, 0.000001 ) ), 0 ) ) : float( 1 ) ).toVar( 'alphaScale' );");
  });
});
```

- [ ] **Step 2: Extend the scene test** — in `packages/web/src/lib/__tests__/native-splat-scene.test.ts`:
  - in the `vi.hoisted` `evidence` object add `antialias: [] as unknown[]`;
  - change the mocked constructor signature to `constructor(source: BufferGeometry, options: { kernelRadius: number; antialias?: boolean })` and add `evidence.antialias.push(options.antialias);` after `evidence.radii.push(options.kernelRadius);`;
  - in `beforeEach` add `evidence.antialias.length = 0;`;
  - add this block at the end of the file:

```ts
describe("native presentation (T-639)", () => {
  it("draws captured sources without anti-aliasing opacity compensation", async () => {
    const state = setup();
    state.add(3);
    await vi.advanceTimersByTimeAsync(20);
    expect(evidence.antialias).toEqual([false]);
    state.detach(); await vi.advanceTimersByTimeAsync(0);
  });
});
```

- [ ] **Step 3: Extend the SPZ test** — in `packages/web/src/lib/__tests__/native-splat-spz.test.ts`, inside the existing top-level `describe`, after the LOD-tree test, add:

```ts
  it("rejects anti-aliased SPZ, as anti-aliased SOG is rejected, before decoding", async () => {
    const parse = vi.spyOn(SPZLoader.prototype, "parseRawSPZ");
    const legacy = legacySpz();
    legacy[14] = 0x01;
    await expect(decodeNativeSplatBuffer(new Uint8Array(gzipSync(legacy)).buffer, "/aa.spz"))
      .rejects.toThrow("Anti-aliased SPZ");
    expect(parse).not.toHaveBeenCalled();
  });
```

- [ ] **Step 4: Run the three tests to see them fail**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/native-addon-antialias.test.ts src/lib/__tests__/native-splat-scene.test.ts src/lib/__tests__/native-splat-spz.test.ts`
Expected: FAIL — the addon lacks the option, the host passes nothing (`[undefined]`), the SPZ loader decodes the flagged file.

- [ ] **Step 5: Regenerate the three patch with the option**

```bash
cd D:/claude/real-hall/repo && pnpm patch three@0.186.0 --edit-dir D:/claude/real-hall/three-edit
```
Then create `D:/claude/real-hall/apply-antialias.mjs`:

```js
import { readFileSync, writeFileSync } from "node:fs";
const file = "D:/claude/real-hall/three-edit/examples/jsm/objects/GaussianSplat.js";
let code = readFileSync(file, "utf8");
if (!code.includes("const BIN_COUNT = 65536;") || !code.includes("splitSH3")) throw new Error("not the production-patched addon");
function once(from, to, all = false) {
  const n = code.split(from).length - 1;
  if (all ? n < 1 : n !== 1) throw new Error(`expected ${all ? ">=1" : "exactly 1"} match, found ${n}: ${from.slice(0, 80)}`);
  code = all ? code.split(from).join(to) : code.replace(from, to);
}
once("constructor( splatGeometry, { autoSort = true,", "constructor( splatGeometry, { antialias = true, autoSort = true,");
once("{ opacityNode, sphericalHarmonicsDirectionNode, colorSpace, kernelRadius }", "{ opacityNode, sphericalHarmonicsDirectionNode, colorSpace, kernelRadius, antialias }", true);
once("const alphaScale = sqrt( max( detBase.div( max( det, 0.000001 ) ), 0 ) ).toVar( 'alphaScale' );",
  "const alphaScale = ( antialias ? sqrt( max( detBase.div( max( det, 0.000001 ) ), 0 ) ) : float( 1 ) ).toVar( 'alphaScale' );");
writeFileSync(file, code);
console.log("antialias option applied");
```
Run it, then commit the patch through pnpm:

```bash
node D:/claude/real-hall/apply-antialias.mjs && cd D:/claude/real-hall/repo && pnpm patch-commit D:/claude/real-hall/three-edit && git diff --stat patches/three@0.186.0.patch
```
Expected: `antialias option applied`; pnpm rewrites `patches/three@0.186.0.patch` and reinstalls; the diff touches only that patch (a few added lines). The same three edits were proven in the render-proof harness (`render-proof/prep/make_addon_variant.mjs`), where `antialias: false` rendered correctly.

- [ ] **Step 6: Type, loader and host changes**

In `packages/web/src/lib/native-gaussian-addon.d.ts`, inside `interface GaussianSplatOptions`, after `kernelRadius?: number;`, add:

```ts
    /** Upstream compensates opacity for its 0.3 px² low-pass (default true). Pass
     *  false for sources trained without mip anti-aliasing (every native source). */
    antialias?: boolean;
```

In `packages/web/src/lib/native-splat-spz.ts`, directly after the LOD-tree check (`if ((flags & 0x80) !== 0) { ... }`), add:

```ts
  // Native rendering draws every source without anti-aliasing compensation; the
  // SOG loader refuses mip-anti-aliased archives for the same reason (T-639).
  if ((flags & 0x01) !== 0) {
    throw new Error("Anti-aliased SPZ requires conversion preserving its filter before native rendering.");
  }
```

In `packages/web/src/lib/native-splat-scene.ts`, in `createSnapshot`, add to the `new GaussianSplat(merged.geometry, { ... })` options, directly after `colorSpace: SRGBColorSpace,`:

```ts
        // Every native source is non-anti-aliased: the SOG and SPZ loaders refuse
        // mip-anti-aliased assets. Upstream's always-on compensation dimmed them (T-639).
        antialias: false,
```

- [ ] **Step 7: Document the option** — in `patches/README.three-native-splats.md`, under "The additive constructor options are:", add:

```markdown
- `antialias`: whether to apply upstream's opacity compensation for its 0.3 px²
  low-pass filter; default `true` preserves upstream. Venviewer passes `false`:
  its loaders refuse mip-anti-aliased SOG and SPZ, and compensating a source
  trained without that filter dims it (T-639, measured 28 September 2026).
```

- [ ] **Step 8: Run the tests**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/native-addon-antialias.test.ts src/lib/__tests__/native-splat-scene.test.ts src/lib/__tests__/native-splat-spz.test.ts src/lib/__tests__/native-addon-performance.test.ts src/lib/__tests__/native-sh3-storage-split.test.ts`
Expected: PASS (the last two guard the regenerated patch's other behaviour).

- [ ] **Step 9: Commit**

```bash
cd D:/claude/real-hall/repo && git add patches/three@0.186.0.patch patches/README.three-native-splats.md packages/web/src/lib/native-gaussian-addon.d.ts packages/web/src/lib/native-splat-spz.ts packages/web/src/lib/native-splat-scene.ts packages/web/src/lib/__tests__/native-addon-antialias.test.ts packages/web/src/lib/__tests__/native-splat-scene.test.ts packages/web/src/lib/__tests__/native-splat-spz.test.ts && git diff --cached --stat && git commit -m "fix(native-splats): no anti-aliasing dimming on sources trained without it (T-639)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: No film curve on captured rooms

**Files:**
- Create: `packages/web/src/lib/capture-display.ts`
- Create: `packages/web/src/components/scene/CaptureToneMapping.tsx`
- Modify: `packages/web/src/components/editor/PlannerScene.tsx` (inside `<Canvas>`, after `<SceneProvider />`)
- Modify: `packages/web/src/components/rooms/RoomSplatScene.tsx` (the `<Canvas` props)
- Test: `packages/web/src/lib/__tests__/capture-display.test.ts`

**Interfaces:**
- Produces: `captureToneMapping(captureShown: boolean): ToneMapping` and `CaptureToneMapping({ captureShown }: { readonly captureShown: boolean }): null`.

- [ ] **Step 1: Write the failing test** — create `packages/web/src/lib/__tests__/capture-display.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ACESFilmicToneMapping, NoToneMapping } from "three";
import { captureToneMapping } from "../capture-display.js";

describe("captured-room display (T-639)", () => {
  it("shows a captured room as photographed, with no film curve", () => {
    expect(captureToneMapping(true)).toBe(NoToneMapping);
  });

  it("keeps the canvas default for the procedural room", () => {
    expect(captureToneMapping(false)).toBe(ACESFilmicToneMapping);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/capture-display.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `packages/web/src/lib/capture-display.ts`:

```ts
import { ACESFilmicToneMapping, NoToneMapping, type ToneMapping } from "three";

/** A captured room is shown as photographed: splats already carry the camera's
 * own response, and three r186 ignores `Material.toneMapped`, so the film curve
 * must come off the whole canvas while a capture is shown (T-639). Other scenes
 * keep R3F's default ACES curve. */
export function captureToneMapping(captureShown: boolean): ToneMapping {
  return captureShown ? NoToneMapping : ACESFilmicToneMapping;
}
```

Create `packages/web/src/components/scene/CaptureToneMapping.tsx`:

```tsx
import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { captureToneMapping } from "../../lib/capture-display.js";

/** Sets the canvas tone mapping for a captured room and restores it on unmount. */
export function CaptureToneMapping({ captureShown }: { readonly captureShown: boolean }): null {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    const previous = gl.toneMapping;
    gl.toneMapping = captureToneMapping(captureShown);
    invalidate();
    return () => { gl.toneMapping = previous; invalidate(); };
  }, [gl, invalidate, captureShown]);
  return null;
}
```

In `packages/web/src/components/editor/PlannerScene.tsx`, add beside the other scene imports:

```ts
import { CaptureToneMapping } from "../scene/CaptureToneMapping.js";
```
and inside `<Canvas ...>`, directly after `<SceneProvider />`:

```tsx
          <CaptureToneMapping captureShown={splatActive} />
```

In `packages/web/src/components/rooms/RoomSplatScene.tsx`, add `flat` to the `<Canvas` props (the walk canvas only ever shows a captured room), directly after `frameloop="demand"`:

```tsx
      flat
```

- [ ] **Step 4: Run tests for the touched files**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/capture-display.test.ts src/components/editor src/components/rooms`
Expected: PASS (existing planner and walk tests still pass).

- [ ] **Step 5: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/capture-display.ts packages/web/src/components/scene/CaptureToneMapping.tsx packages/web/src/components/editor/PlannerScene.tsx packages/web/src/components/rooms/RoomSplatScene.tsx packages/web/src/lib/__tests__/capture-display.test.ts && git diff --cached --stat && git commit -m "fix(web): captured rooms show as photographed, without the film curve (T-639)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Phones get a phone budget

**Files:**
- Modify: `packages/web/src/lib/device-tier.ts` (after `classifyDevice`)
- Modify: `packages/web/src/stores/device-store.ts` (the `detect` action)
- Modify: `packages/web/src/hooks/use-splat-runtime-profile.ts` (the `tier` line in the hook)
- Test: `packages/web/src/lib/__tests__/device-tier-context.test.ts`

**Interfaces:**
- Produces: `interface DeviceContext { readonly userAgent: string; readonly maxTouchPoints: number }`, `classifyDeviceInContext(rendererString: string, context: DeviceContext): DeviceTier`, `currentDeviceContext(): DeviceContext`.
- Rule (Blake, 24 September 2026: phones hold 60 fps with about 0.5–1M rendered splats; this supersedes Plan 16's "full room on phones" pending physical measurement in S6): iPhones and Android phones cap at `low` (1.5M budget, the highest complete level under it); iPads cap at `medium`; desktops keep their GPU tier.

- [ ] **Step 1: Write the failing tests** — create `packages/web/src/lib/__tests__/device-tier-context.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { classifyDeviceInContext } from "../device-tier.js";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const MAC_OR_IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
const ANDROID_PHONE = "Mozilla/5.0 (Linux; Android 15; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const ANDROID_TABLET = "Mozilla/5.0 (Linux; Android 15; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

describe("device classification with form factor (T-639)", () => {
  it("does not treat an iPhone's 'Apple GPU' as a desktop card", () => {
    expect(classifyDeviceInContext("Apple GPU", { userAgent: IPHONE, maxTouchPoints: 5 })).toBe("low");
  });

  it("caps an iPad (desktop-mode Safari with touch) at medium", () => {
    expect(classifyDeviceInContext("Apple GPU", { userAgent: MAC_OR_IPAD, maxTouchPoints: 5 })).toBe("medium");
  });

  it("keeps an Apple-silicon Mac at high", () => {
    expect(classifyDeviceInContext("Apple GPU", { userAgent: MAC_OR_IPAD, maxTouchPoints: 0 })).toBe("high");
  });

  it("caps a flagship Android phone at low", () => {
    expect(classifyDeviceInContext("Adreno (TM) 750", { userAgent: ANDROID_PHONE, maxTouchPoints: 5 })).toBe("low");
  });

  it("leaves an Android tablet on its GPU tier", () => {
    expect(classifyDeviceInContext("Adreno (TM) 750", { userAgent: ANDROID_TABLET, maxTouchPoints: 5 })).toBe("high");
  });

  it("never raises a device above its GPU tier", () => {
    expect(classifyDeviceInContext("Mali-T880", { userAgent: IPHONE, maxTouchPoints: 5 })).toBe("low");
    expect(classifyDeviceInContext("SwiftShader", { userAgent: ANDROID_PHONE, maxTouchPoints: 5 })).toBe("poster");
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/device-tier-context.test.ts`
Expected: FAIL — `classifyDeviceInContext` is not exported.

- [ ] **Step 3: Implement** — in `packages/web/src/lib/device-tier.ts`, after `classifyDevice`, add:

```ts
/** What the browser reports about the device beyond its GPU string. */
export interface DeviceContext {
  readonly userAgent: string;
  readonly maxTouchPoints: number;
}

const TIER_ORDER: readonly DeviceTier[] = ["poster", "low", "medium", "high"];

function capTier(tier: DeviceTier, cap: DeviceTier): DeviceTier {
  return TIER_ORDER.indexOf(tier) <= TIER_ORDER.indexOf(cap) ? tier : cap;
}

/**
 * Safari reports every Apple device as "Apple GPU", which `classifyDevice`
 * reads as a desktop card, so iPhones downloaded the full 6M-splat level.
 * Phones cap at low and iPads at medium (T-639; Blake, 24 September 2026:
 * phones hold 60 fps at about 0.5–1M rendered splats). A device never rises
 * above its GPU tier. iPadOS requests desktop sites with a Mac user agent, so
 * touch support separates it from a Mac.
 */
export function classifyDeviceInContext(rendererString: string, context: DeviceContext): DeviceTier {
  const tier = classifyDevice(rendererString);
  const agent = context.userAgent;
  const phone = /iPhone|iPod/.test(agent) || (/Android/.test(agent) && /Mobile/.test(agent));
  const iPad = /iPad/.test(agent) || (/Macintosh/.test(agent) && context.maxTouchPoints > 1);
  if (phone) return capTier(tier, "low");
  if (iPad) return capTier(tier, "medium");
  return tier;
}

export function currentDeviceContext(): DeviceContext {
  if (typeof navigator === "undefined") return { userAgent: "", maxTouchPoints: 0 };
  return { userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints };
}
```

In `packages/web/src/stores/device-store.ts`, import `classifyDeviceInContext` and `currentDeviceContext` from the same module, and in `detect` replace `const tier = classifyDevice(rendererString);` with:

```ts
    const tier = classifyDeviceInContext(rendererString, currentDeviceContext());
```
(Remove `classifyDevice` from that import if it becomes unused.)

In `packages/web/src/hooks/use-splat-runtime-profile.ts`, change the device-tier import to `import { classifyDeviceInContext, currentDeviceContext, getGpuRenderer, type DeviceTier } from "../lib/device-tier.js";` (keep any other names it already imports) and the tier line to:

```ts
  const tier: DeviceTier = detected || probed === null ? storeTier : classifyDeviceInContext(probed, currentDeviceContext());
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/device-tier-context.test.ts src/lib/__tests__ src/stores src/hooks`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/device-tier.ts packages/web/src/stores/device-store.ts packages/web/src/hooks/use-splat-runtime-profile.ts packages/web/src/lib/__tests__/device-tier-context.test.ts && git diff --cached --stat && git commit -m "fix(web): phones and iPads get their own splat budgets, not a desktop card's (T-639)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The floor-skin package builder

**Files:**
- Create: `tools/floor-skin/build_floor_skin.py`
- Create: `tools/floor-skin/README.md`
- Output (not in the repo): `D:/claude/splats/trades-hall/grand-hall/floor-skin/v1/`

**Interfaces:**
- Consumes (read-only): `D:/claude/visual-firstprinciples-20260928/floor/floor.json` (texel → capture-frame affine, plane, polygon), `floor_{A_obj|B_pano}_2mm.png` (10600 × 5300 RGB), `floor_{A_obj|B_pano}_mask.png`, `floor_height_resid_5cm.png` (uint16: `round(mm*10)+32768`, 0 = outside).
- Produces (the package Tasks 6 and 8 read): `floor-skin.json` (schema below), `albedo-{4096|2048|1024}-{0|1}.webp` (RGBA, alpha = valid floor), `height-5cm.i16` (int16 LE, 0.1 mm units relative to the plane, −32768 outside), `slab-mask-1024x512.u8` (row-major, 255 = hide floor splats here).

Manifest schema `venviewer.floor-skin.v1` (values shown are placeholders for the shape; the builder writes the real ones):
```json
{
  "schema": "venviewer.floor-skin.v1",
  "venue": "trades-hall",
  "room": "grand-hall",
  "frame": "capture",
  "provenance": { "kind": "measured-photographic", "arm": "A", "source": "text", "built": "2026-09-28T00:00:00Z", "inputs": { "floor.json": "sha256" } },
  "grid": { "widthPx": 10600, "heightPx": 5300, "texelM": 0.002, "origin": [0, 0, 0], "uAxis": [0, 0.002, 0], "vAxis": [0.002, 0, 0] },
  "plane": { "normal": [0, 0, 1], "d": 0 },
  "tiles": [ { "col0": 0, "row0": 0, "cols": 5300, "rows": 5300 }, { "col0": 5300, "row0": 0, "cols": 5300, "rows": 5300 } ],
  "tiers": { "high": { "size": 4096, "files": ["albedo-4096-0.webp", "albedo-4096-1.webp"] }, "medium": { "size": 2048, "files": ["albedo-2048-0.webp", "albedo-2048-1.webp"] }, "low": { "size": 1024, "files": ["albedo-1024-0.webp", "albedo-1024-1.webp"] } },
  "height": { "file": "height-5cm.i16", "cols": 424, "rows": 212, "cellPx": 25, "unitM": 0.0001, "outside": -32768 },
  "slab": { "file": "slab-mask-1024x512.u8", "width": 1024, "height": 512, "below": 0.15, "above": 0.12 },
  "colour": { "matched": [0.708582, 0.575199, 0.62761] },
  "files": { "albedo-4096-0.webp": "sha256" }
}
```
`origin`, `uAxis` and `vAxis` are per texel in the capture frame (the frame of the room's splat tiles): `P(col, row) = origin + col·uAxis + row·vAxis`, texel centres at `+0.5`. `plane` satisfies `normal·P = d` there.

- [ ] **Step 1: Write the builder** — create `tools/floor-skin/build_floor_skin.py`:

```python
"""Build a room's floor-skin package (T-639) from the 28 September floor research.

Reads the floor agent's floor.json, the 2 mm texture of one arm and its mask, and the
5 cm LiDAR height residual map; writes WebP texture tiers, an int16 height grid, a
floor-slab mask and floor-skin.json. Inputs are read-only; outputs go to --out.

  python tools/floor-skin/build_floor_skin.py --arm A --room grand-hall \
    --floor D:/claude/visual-firstprinciples-20260928/floor \
    --out D:/claude/splats/trades-hall/grand-hall/floor-skin/v1
"""
import argparse, datetime, hashlib, json, os
import numpy as np
import cv2
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ARMS = {"A": ("floor_A_obj_2mm.png", "floor_A_obj_mask.png", "Matterport textured OBJ floor, re-baked at 2 mm"),
        "B": ("floor_B_pano_2mm.png", "floor_B_pano_mask.png", "Matterport E57 photograph mosaic at 2 mm")}
TIERS = {"high": 4096, "medium": 2048, "low": 1024}
MASK_W, MASK_H = 1024, 512
MATCHED = [0.708582, 0.575199, 0.62761]  # splat/photo floor ratio, linear RGB (render-proof gain.json)


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--arm", choices=sorted(ARMS), required=True)
    ap.add_argument("--room", required=True)
    ap.add_argument("--floor", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    fj_path = os.path.join(a.floor, "floor.json")
    fj = json.load(open(fj_path, encoding="utf-8"))
    tex_name, mask_name, description = ARMS[a.arm]
    W, H = fj["texture"]["size_px"]
    texel = fj["texture"]["texel_m"]
    mapping = fj["texture"]["texel_to_hallframe"]
    if (W, H) != (10600, 5300):
        raise SystemExit(f"unexpected texture size {W}x{H}")
    rgb = np.asarray(Image.open(os.path.join(a.floor, tex_name)).convert("RGB"))
    valid = np.asarray(Image.open(os.path.join(a.floor, mask_name)).convert("L"))
    if rgb.shape[:2] != (H, W) or valid.shape != (H, W):
        raise SystemExit("texture and mask must both be 10600x5300")

    files = {}
    tiles = [{"col0": 0, "row0": 0, "cols": 5300, "rows": 5300}, {"col0": 5300, "row0": 0, "cols": 5300, "rows": 5300}]
    tiers = {}
    for tier, size in TIERS.items():
        names = []
        for t, tile in enumerate(tiles):
            c0, r0, cw, rh = tile["col0"], tile["row0"], tile["cols"], tile["rows"]
            crop = rgb[r0:r0 + rh, c0:c0 + cw]
            alpha = valid[r0:r0 + rh, c0:c0 + cw]
            colour = cv2.resize(crop, (size, size), interpolation=cv2.INTER_AREA)
            a8 = cv2.resize(alpha, (size, size), interpolation=cv2.INTER_AREA)
            rgba = np.dstack([colour, a8]).astype(np.uint8)
            name = f"albedo-{size}-{t}.webp"
            path = os.path.join(a.out, name)
            Image.fromarray(rgba, "RGBA").save(path, "WEBP", quality=90, method=6)
            files[name] = sha256(path)
            names.append(name)
        tiers[tier] = {"size": size, "files": names}

    resid = np.asarray(Image.open(os.path.join(a.floor, "floor_height_resid_5cm.png")))
    if resid.dtype != np.uint16 or resid.shape != (212, 424):
        raise SystemExit(f"unexpected height map {resid.dtype} {resid.shape}")
    heights = (resid.astype(np.int32) - 32768).astype("<i2")  # 0.1 mm units; -32768 = outside
    heights.tofile(os.path.join(a.out, "height-5cm.i16"))
    files["height-5cm.i16"] = sha256(os.path.join(a.out, "height-5cm.i16"))

    poly = np.asarray(fj["floor_polygon"]["texel_col_row"], dtype=np.float64)
    scaled = np.round(poly * [MASK_W / W, MASK_H / H] * 8).astype(np.int32)  # 3 fractional bits
    slab = np.zeros((MASK_H, MASK_W), np.uint8)
    cv2.fillPoly(slab, [scaled.reshape(-1, 1, 2)], 255, lineType=cv2.LINE_8, shift=3)
    slab = cv2.erode(slab, np.ones((3, 3), np.uint8), iterations=2)  # about 4 cm more inset (about 9 cm in all)
    slab.tofile(os.path.join(a.out, "slab-mask-1024x512.u8"))
    files["slab-mask-1024x512.u8"] = sha256(os.path.join(a.out, "slab-mask-1024x512.u8"))

    manifest = {
        "schema": "venviewer.floor-skin.v1",
        "venue": "trades-hall",
        "room": a.room,
        "frame": "capture",
        "provenance": {
            "kind": "measured-photographic", "arm": a.arm, "source": description,
            "built": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "inputs": {"floor.json": sha256(fj_path), tex_name: sha256(os.path.join(a.floor, tex_name))},
        },
        "grid": {"widthPx": W, "heightPx": H, "texelM": texel,
                 "origin": mapping["origin_corner"], "uAxis": mapping["u_axis_per_texel"], "vAxis": mapping["v_axis_per_texel"]},
        "plane": {"normal": fj["floor_plane"]["hallframe_unit_normal"], "d": fj["floor_plane"]["hallframe_n_dot_x_eq_d"]},
        "tiles": tiles,
        "tiers": tiers,
        "height": {"file": "height-5cm.i16", "cols": 424, "rows": 212, "cellPx": 25, "unitM": 0.0001, "outside": -32768},
        "slab": {"file": "slab-mask-1024x512.u8", "width": MASK_W, "height": MASK_H, "below": 0.15, "above": 0.12},
        "colour": {"matched": MATCHED},
        "files": files,
    }
    with open(os.path.join(a.out, "floor-skin.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, indent=1)
    print(json.dumps({"out": a.out, "files": len(files), "slab_pixels": int((slab > 0).sum())}))


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run it for Arm A and check the outputs**

```bash
cd D:/claude/real-hall/repo && python tools/floor-skin/build_floor_skin.py --arm A --room grand-hall --floor D:/claude/visual-firstprinciples-20260928/floor --out D:/claude/splats/trades-hall/grand-hall/floor-skin/v1 && python -c "import json;m=json.load(open('D:/claude/splats/trades-hall/grand-hall/floor-skin/v1/floor-skin.json'));print(m['schema'],m['tiers']['high'],len(m['files']))"
```
Expected: a JSON line with 8 files and a slab pixel count of roughly 400,000–480,000 (about 209 m² of the 225 m² grid is floor); then `venviewer.floor-skin.v1 {'size': 4096, 'files': [...]} 8`. Open `albedo-1024-0.webp` and `-1.webp` with the Read tool: the two halves of the oak floor, transparent outside it.

- [ ] **Step 3: Verify the slab mask lands on the floor**

```bash
python -c "import numpy as np;from PIL import Image;m=np.fromfile('D:/claude/splats/trades-hall/grand-hall/floor-skin/v1/slab-mask-1024x512.u8',np.uint8).reshape(512,1024);a=np.asarray(Image.open('D:/claude/visual-firstprinciples-20260928/floor/floor_A_obj_2048.jpg').convert('RGB').resize((1024,512)));o=a.astype(np.float32);o[m>0]=0.6*o[m>0]+[0,102,0];Image.fromarray(o.clip(0,255).astype(np.uint8)).save('D:/claude/real-hall/slab-check.jpg')"
```
Expected: open `D:/claude/real-hall/slab-check.jpg`: green covers the oak floor, stops a few centimetres short of the skirting and fixtures, and nothing green lies outside the floor.

- [ ] **Step 4: Write `tools/floor-skin/README.md`**

```markdown
# Floor skin (T-639)

A room's floor drawn as what it is: a measured surface wearing its own photographs.
The package sits beside the room's splat tiles and is drawn under the same transform.

Build (inputs are the 28 September 2026 research outputs; nothing here reads F:):

    python tools/floor-skin/build_floor_skin.py --arm A --room grand-hall \
      --floor D:/claude/visual-firstprinciples-20260928/floor \
      --out D:/claude/splats/trades-hall/grand-hall/floor-skin/v1

Contents: `floor-skin.json` (schema `venviewer.floor-skin.v1`), texture tiers
`albedo-{4096|2048|1024}-{0|1}.webp` (two 10.6 m tiles, alpha = measured floor),
`height-5cm.i16` (int16, 0.1 mm relative to the fitted plane, −32768 outside) and
`slab-mask-1024x512.u8` (255 where the splat host hides floor-slab splats).

Arm A re-bakes the Matterport textured OBJ floor; Arm B is the multi-view photo
mosaic. Use the arm that wins on the render harness (spec §4 I1).

In development `SPLAT_STAGING_ROOT` serves the output. For preview and production,
publish the folder to R2 under `splats/trades-hall/<room>/floor-skin/v1/` before
pushing code that reads it.
```

- [ ] **Step 5: Commit**

```bash
cd D:/claude/real-hall/repo && git add tools/floor-skin/build_floor_skin.py tools/floor-skin/README.md && git diff --cached --stat && git commit -m "feat(tools): floor-skin package builder for measured photographic floors (T-639)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Floor-skin manifest and geometry (web)

**Files:**
- Create: `packages/web/src/lib/floor-skin.ts`
- Test: `packages/web/src/lib/__tests__/floor-skin.test.ts`

**Interfaces:**
- Consumes: the package from Task 5; `splatBaseUrl` from `../data/room-splat-bundles.js`; `DeviceTier` from `./device-tier.js`.
- Produces:
  - `FloorSkinManifestSchema` (Zod) and `type FloorSkinManifest`, `type FloorSkinTier`, `type FloorColourMode = "photo" | "matched"`
  - `FLOOR_SKIN_ROOMS: Readonly<Record<string, string>>` — room slug → package path (`{ "grand-hall": "floor-skin/v1" }`)
  - `floorSkinManifestUrl(roomSlug: string, configuredBaseUrl: string | undefined): string | null`
  - `floorSkinTier(tier: DeviceTier): FloorSkinTier`
  - `captureToMaskMatrix(manifest: FloorSkinManifest): Matrix4` — capture-frame point → `(u, v, signed plane distance, 1)` over the whole grid
  - `decodeFloorHeights(buffer: ArrayBuffer, manifest: FloorSkinManifest): Int16Array`
  - `floorSkinTileGeometry(manifest: FloorSkinManifest, tileIndex: number, heights: Int16Array, stepPx?: number): BufferGeometry` — capture-frame positions, tile-local UVs, triangles facing along the plane normal
  - `floorColourGain(manifest: FloorSkinManifest, mode: FloorColourMode): readonly [number, number, number]`

- [ ] **Step 1: Write the failing tests** — create `packages/web/src/lib/__tests__/floor-skin.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Vector3, Vector4 } from "three";
import {
  FloorSkinManifestSchema, captureToMaskMatrix, decodeFloorHeights, floorColourGain,
  floorSkinManifestUrl, floorSkinTier, floorSkinTileGeometry, type FloorSkinManifest,
} from "../floor-skin.js";

// A 4 m × 2 m floor on z = 1 in the capture frame, 1 cm texels, axes aligned:
// u runs along +y, v along +x, as in the Grand Hall package.
const manifest: FloorSkinManifest = FloorSkinManifestSchema.parse({
  schema: "venviewer.floor-skin.v1", venue: "trades-hall", room: "grand-hall", frame: "capture",
  provenance: { kind: "measured-photographic", arm: "A", source: "test", built: "2026-09-28T00:00:00Z", inputs: {} },
  grid: { widthPx: 400, heightPx: 200, texelM: 0.01, origin: [0, 0, 1], uAxis: [0, 0.01, 0], vAxis: [0.01, 0, 0] },
  plane: { normal: [0, 0, 1], d: 1 },
  tiles: [{ col0: 0, row0: 0, cols: 200, rows: 200 }, { col0: 200, row0: 0, cols: 200, rows: 200 }],
  tiers: { high: { size: 200, files: ["h0.webp", "h1.webp"] }, medium: { size: 100, files: ["m0.webp", "m1.webp"] }, low: { size: 50, files: ["l0.webp", "l1.webp"] } },
  height: { file: "height-5cm.i16", cols: 80, rows: 40, cellPx: 5, unitM: 0.0001, outside: -32768 },
  slab: { file: "slab.u8", width: 8, height: 4, below: 0.15, above: 0.12 },
  colour: { matched: [0.7, 0.6, 0.65] },
  files: {},
});

describe("floor-skin package (T-639)", () => {
  it("resolves a room's package beside its splat tiles, and nothing for other rooms", () => {
    expect(floorSkinManifestUrl("grand-hall", undefined)).toBe("/splats/trades-hall/grand-hall/floor-skin/v1/floor-skin.json");
    expect(floorSkinManifestUrl("grand-hall", "https://cdn.example/splats/")).toBe("https://cdn.example/splats/trades-hall/grand-hall/floor-skin/v1/floor-skin.json");
    expect(floorSkinManifestUrl("saloon", undefined)).toBeNull();
  });

  it("chooses texture tiers by device tier", () => {
    expect(floorSkinTier("high")).toBe("high");
    expect(floorSkinTier("medium")).toBe("medium");
    expect(floorSkinTier("low")).toBe("low");
    expect(floorSkinTier("poster")).toBe("low");
  });

  it("maps a capture-frame point to mask coordinates and plane distance", () => {
    const m = captureToMaskMatrix(manifest);
    // Texel (col 100, row 50) centre is at y = 1.005, x = 0.505; 0.05 m above the plane.
    const q = new Vector4(0.505, 1.005, 1.05, 1).applyMatrix4(m);
    expect(q.x).toBeCloseTo(100.5 / 400, 6);
    expect(q.y).toBeCloseTo(50.5 / 200, 6);
    expect(q.z).toBeCloseTo(0.05, 6);
  });

  it("decodes the height grid and refuses a truncated one", () => {
    const heights = new Int16Array(80 * 40).fill(123);
    expect(decodeFloorHeights(heights.buffer, manifest)[0]).toBe(123);
    expect(() => decodeFloorHeights(new ArrayBuffer(10), manifest)).toThrow("height grid");
  });

  it("builds a tile whose triangles face along the plane normal and follow the height grid", () => {
    const heights = new Int16Array(80 * 40).fill(500); // +0.05 m everywhere
    const geometry = floorSkinTileGeometry(manifest, 1, heights, 50);
    const position = geometry.getAttribute("position");
    const uv = geometry.getAttribute("uv");
    const index = geometry.getIndex();
    if (index === null) throw new Error("expected indexed geometry");
    // Tile 1 spans cols 200..400 in steps of 50 (5 columns) and rows 0..200 (5 rows).
    expect(position.count).toBe(25);
    expect(position.getZ(0)).toBeCloseTo(1.05, 6);
    expect(position.getY(0)).toBeCloseTo(2, 6);
    expect(uv.getX(0)).toBeCloseTo(0, 6);
    expect(uv.getX(4)).toBeCloseTo(1, 6);
    const a = new Vector3().fromBufferAttribute(position, index.getX(0));
    const b = new Vector3().fromBufferAttribute(position, index.getX(1));
    const c = new Vector3().fromBufferAttribute(position, index.getX(2));
    const normal = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).normalize();
    expect(normal.z).toBeCloseTo(1, 6);
  });

  it("offers the photographs as they are, or matched to the splat room", () => {
    expect(floorColourGain(manifest, "photo")).toEqual([1, 1, 1]);
    expect(floorColourGain(manifest, "matched")).toEqual([0.7, 0.6, 0.65]);
  });

  it("refuses a package with the wrong schema", () => {
    expect(FloorSkinManifestSchema.safeParse({ ...manifest, schema: "other" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/floor-skin.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `packages/web/src/lib/floor-skin.ts`:

```ts
import { BufferAttribute, BufferGeometry, Matrix4, Vector3 } from "three";
import { z } from "zod";
import { splatBaseUrl } from "../data/room-splat-bundles.js";
import type { DeviceTier } from "./device-tier.js";

/** A room's floor drawn as what it is: a measured surface wearing its own
 * photographs (T-639). Coordinates are in the room's capture frame, the frame
 * of its splat tiles, so the floor is drawn under the same transform. */
const vec3 = z.tuple([z.number(), z.number(), z.number()]);
const tier = z.object({ size: z.number().int().positive(), files: z.array(z.string().min(1)).min(1) });

export const FloorSkinManifestSchema = z.object({
  schema: z.literal("venviewer.floor-skin.v1"),
  venue: z.string().min(1),
  room: z.string().min(1),
  frame: z.literal("capture"),
  provenance: z.object({
    kind: z.literal("measured-photographic"),
    arm: z.string(),
    source: z.string(),
    built: z.string(),
    inputs: z.record(z.string(), z.string()),
  }),
  grid: z.object({
    widthPx: z.number().int().positive(),
    heightPx: z.number().int().positive(),
    texelM: z.number().positive(),
    origin: vec3, uAxis: vec3, vAxis: vec3,
  }),
  plane: z.object({ normal: vec3, d: z.number() }),
  tiles: z.array(z.object({
    col0: z.number().int().nonnegative(), row0: z.number().int().nonnegative(),
    cols: z.number().int().positive(), rows: z.number().int().positive(),
  })).min(1),
  tiers: z.object({ high: tier, medium: tier, low: tier }),
  height: z.object({
    file: z.string().min(1), cols: z.number().int().positive(), rows: z.number().int().positive(),
    cellPx: z.number().int().positive(), unitM: z.number().positive(), outside: z.number().int(),
  }),
  slab: z.object({
    file: z.string().min(1), width: z.number().int().positive(), height: z.number().int().positive(),
    below: z.number().nonnegative(), above: z.number().nonnegative(),
  }),
  colour: z.object({ matched: vec3 }),
  files: z.record(z.string(), z.string()),
});
export type FloorSkinManifest = z.infer<typeof FloorSkinManifestSchema>;
export type FloorSkinTier = keyof FloorSkinManifest["tiers"];
export type FloorColourMode = "photo" | "matched";

/** Rooms with a floor-skin package, by path beside their splat tiles. */
export const FLOOR_SKIN_ROOMS: Readonly<Record<string, string>> = { "grand-hall": "floor-skin/v1" };

export function floorSkinManifestUrl(roomSlug: string, configuredBaseUrl: string | undefined): string | null {
  const path = FLOOR_SKIN_ROOMS[roomSlug];
  if (path === undefined) return null;
  return `${splatBaseUrl(configuredBaseUrl)}/trades-hall/${roomSlug}/${path}/floor-skin.json`;
}

export function floorSkinTier(deviceTier: DeviceTier): FloorSkinTier {
  if (deviceTier === "high") return "high";
  if (deviceTier === "medium") return "medium";
  return "low";
}

/** Capture-frame point → (u, v, signed distance above the plane, 1) over the whole grid. */
export function captureToMaskMatrix(manifest: FloorSkinManifest): Matrix4 {
  const origin = new Vector3(...manifest.grid.origin);
  const u = new Vector3(...manifest.grid.uAxis);
  const v = new Vector3(...manifest.grid.vAxis);
  const n = new Vector3(...manifest.plane.normal).normalize();
  const uScale = 1 / (u.lengthSq() * manifest.grid.widthPx);
  const vScale = 1 / (v.lengthSq() * manifest.grid.heightPx);
  return new Matrix4().set(
    u.x * uScale, u.y * uScale, u.z * uScale, -origin.dot(u) * uScale,
    v.x * vScale, v.y * vScale, v.z * vScale, -origin.dot(v) * vScale,
    n.x, n.y, n.z, -manifest.plane.d,
    0, 0, 0, 1,
  );
}

export function decodeFloorHeights(buffer: ArrayBuffer, manifest: FloorSkinManifest): Int16Array {
  const expected = manifest.height.cols * manifest.height.rows;
  if (buffer.byteLength !== expected * 2) {
    throw new Error(`The floor height grid has ${String(buffer.byteLength)} bytes; expected ${String(expected * 2)}.`);
  }
  return new Int16Array(buffer);
}

function heightAt(manifest: FloorSkinManifest, heights: Int16Array, col: number, row: number): number {
  const { cols, rows, cellPx, unitM, outside } = manifest.height;
  // Mean of the valid 5 cm cells around this texel corner; the plane where none is valid.
  let sum = 0, count = 0;
  for (const r of [Math.floor(row / cellPx) - 1, Math.floor(row / cellPx)]) {
    for (const c of [Math.floor(col / cellPx) - 1, Math.floor(col / cellPx)]) {
      if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
      const value = heights[r * cols + c];
      if (value === undefined || value === outside) continue;
      sum += value; count++;
    }
  }
  return count === 0 ? 0 : (sum / count) * unitM;
}

/** One tile of the floor as a displaced grid in the capture frame. */
export function floorSkinTileGeometry(manifest: FloorSkinManifest, tileIndex: number, heights: Int16Array, stepPx = 50): BufferGeometry {
  const tile = manifest.tiles[tileIndex];
  if (tile === undefined) throw new Error(`The floor skin has no tile ${String(tileIndex)}.`);
  const origin = new Vector3(...manifest.grid.origin);
  const u = new Vector3(...manifest.grid.uAxis);
  const v = new Vector3(...manifest.grid.vAxis);
  const n = new Vector3(...manifest.plane.normal).normalize();
  const columns = Math.ceil(tile.cols / stepPx) + 1;
  const rowsCount = Math.ceil(tile.rows / stepPx) + 1;
  const positions = new Float32Array(columns * rowsCount * 3);
  const uvs = new Float32Array(columns * rowsCount * 2);
  const point = new Vector3();
  for (let i = 0; i < rowsCount; i++) {
    const row = tile.row0 + Math.min(i * stepPx, tile.rows);
    for (let j = 0; j < columns; j++) {
      const col = tile.col0 + Math.min(j * stepPx, tile.cols);
      const k = i * columns + j;
      point.copy(origin).addScaledVector(u, col).addScaledVector(v, row).addScaledVector(n, heightAt(manifest, heights, col, row));
      positions.set([point.x, point.y, point.z], k * 3);
      uvs.set([(col - tile.col0) / tile.cols, (row - tile.row0) / tile.rows], k * 2);
    }
  }
  const indices: number[] = [];
  for (let i = 0; i < rowsCount - 1; i++) {
    for (let j = 0; j < columns - 1; j++) {
      const a = i * columns + j, b = a + columns, c = a + 1, d = b + 1;
      // (row + 1) × (col + 1) is v × u, which points along the plane normal for this grid.
      indices.push(a, b, c, c, b, d);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

export function floorColourGain(manifest: FloorSkinManifest, mode: FloorColourMode): readonly [number, number, number] {
  return mode === "matched" ? manifest.colour.matched : [1, 1, 1];
}
```

Note for the implementer: if the geometry test's normal check fails because this grid's `v × u` points down, swap the winding (`a, c, b, c, d, b`) and correct the comment; the test encodes the requirement.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/floor-skin.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/floor-skin.ts packages/web/src/lib/__tests__/floor-skin.test.ts && git diff --cached --stat && git commit -m "feat(web): floor-skin package reader and floor geometry (T-639)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Floor-slab exclusion in the splat host

**Files:**
- Create: `packages/web/src/lib/splat-exclusion.ts`
- Modify: `packages/web/src/lib/native-splat-scene.ts` (imports; `Snapshot`; class fields; `createSnapshot` opacity node; `updateSnapshot`; new public methods)
- Test: `packages/web/src/lib/__tests__/splat-exclusion.test.ts`, `packages/web/src/lib/__tests__/native-splat-scene.test.ts`

**Interfaces:**
- Produces:
  - `interface SplatExclusion { readonly matrix: Matrix4; readonly below: number; readonly above: number; readonly mask: { readonly width: number; readonly height: number; readonly data: Uint8Array } }` — `matrix` maps a scene-frame point to `(u, v, s, 1)`; splats with `u, v` in [0, 1], mask ≥ 128 at `(u, v)` and `−below ≤ s ≤ above` are hidden.
  - `EXCLUSION_MASK_WIDTH = 1024`, `EXCLUSION_MASK_HEIGHT = 512`
  - `resampleExclusionMask(mask, width, height): Uint8Array` (nearest)
  - `excludedBySlab(point: Vector3, exclusion: SplatExclusion): boolean` (CPU reference of the shader rule)
  - `NativeSplatScene.setExclusion(owner: object, exclusion: SplatExclusion | null): void`, `clearExclusion(owner: object): void`, `get exclusionMask(): DataTexture`

- [ ] **Step 1: Write the failing tests** — create `packages/web/src/lib/__tests__/splat-exclusion.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Matrix4, Vector3 } from "three";
import { excludedBySlab, resampleExclusionMask, type SplatExclusion } from "../splat-exclusion.js";

// The mask covers the left half of a 4 × 2 grid; the matrix maps x∈[0,4] → u, z∈[0,2] → v, y → s.
const exclusion: SplatExclusion = {
  matrix: new Matrix4().set(0.25, 0, 0, 0, 0, 0, 0.5, 0, 0, 1, 0, 0, 0, 0, 0, 1),
  below: 0.15, above: 0.12,
  mask: { width: 4, height: 2, data: new Uint8Array([255, 255, 0, 0, 255, 255, 0, 0]) },
};

describe("floor-slab exclusion (T-639)", () => {
  it("hides floor-slab splats inside the outline", () => {
    expect(excludedBySlab(new Vector3(0.5, 0.05, 0.5), exclusion)).toBe(true);
    expect(excludedBySlab(new Vector3(0.5, -0.1, 1.5), exclusion)).toBe(true);
  });

  it("keeps splats above the band, below it, outside the outline or off the grid", () => {
    expect(excludedBySlab(new Vector3(0.5, 0.2, 0.5), exclusion)).toBe(false);
    expect(excludedBySlab(new Vector3(0.5, -0.2, 0.5), exclusion)).toBe(false);
    expect(excludedBySlab(new Vector3(3.5, 0.05, 0.5), exclusion)).toBe(false);
    expect(excludedBySlab(new Vector3(-1, 0.05, 0.5), exclusion)).toBe(false);
  });

  it("resamples a mask to the host's fixed grid by nearest neighbour", () => {
    const out = resampleExclusionMask(exclusion.mask, 8, 4);
    expect(Array.from(out.slice(0, 8))).toEqual([255, 255, 255, 255, 0, 0, 0, 0]);
    expect(out.length).toBe(32);
  });
});
```

Add to `packages/web/src/lib/__tests__/native-splat-scene.test.ts` (and add `Matrix4` to its `three` import if it is not already there):

```ts
describe("floor-slab exclusion host (T-639)", () => {
  it("copies an owner's mask into the shared texture and clears it only for that owner", () => {
    const state = setup();
    const owner = {}, other = {};
    const data = new Uint8Array(1024 * 512).fill(255);
    state.runtime.setExclusion(owner, { matrix: new Matrix4(), below: 0.15, above: 0.12, mask: { width: 1024, height: 512, data } });
    const texture = state.runtime.exclusionMask;
    expect((texture.image.data as Uint8Array)[0]).toBe(255);
    state.runtime.clearExclusion(other);
    expect((texture.image.data as Uint8Array)[0]).toBe(255);
    state.runtime.clearExclusion(owner);
    expect((texture.image.data as Uint8Array)[0]).toBe(0);
    state.detach();
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/splat-exclusion.test.ts src/lib/__tests__/native-splat-scene.test.ts`
Expected: FAIL — module and methods missing.

- [ ] **Step 3: Implement the pure module** — create `packages/web/src/lib/splat-exclusion.ts`:

```ts
import { Vector4, type Matrix4, type Vector3 } from "three";

/** Hides captured splats a measured surface replaces (T-639: the floor slab
 * under the photographic floor). `matrix` maps a scene-frame splat centre to
 * (u, v, signed distance above the surface, 1); a splat is hidden when (u, v)
 * lies on the mask and the distance is within [-below, above]. */
export interface SplatExclusion {
  readonly matrix: Matrix4;
  readonly below: number;
  readonly above: number;
  readonly mask: { readonly width: number; readonly height: number; readonly data: Uint8Array };
}

/** The host's fixed mask grid; one R8 texture shared by every draw. */
export const EXCLUSION_MASK_WIDTH = 1024;
export const EXCLUSION_MASK_HEIGHT = 512;

export function resampleExclusionMask(mask: SplatExclusion["mask"], width: number, height: number): Uint8Array {
  if (mask.data.length !== mask.width * mask.height) throw new Error("The exclusion mask size does not match its data.");
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(mask.height - 1, Math.floor(((y + 0.5) * mask.height) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(mask.width - 1, Math.floor(((x + 0.5) * mask.width) / width));
      out[y * width + x] = mask.data[sy * mask.width + sx] ?? 0;
    }
  }
  return out;
}

/** CPU reference of the shader rule in native-splat-scene.ts. */
export function excludedBySlab(point: Vector3, exclusion: SplatExclusion): boolean {
  const q = new Vector4(point.x, point.y, point.z, 1).applyMatrix4(exclusion.matrix);
  if (q.x < 0 || q.x > 1 || q.y < 0 || q.y > 1) return false;
  if (q.z < -exclusion.below || q.z > exclusion.above) return false;
  const { width, height, data } = exclusion.mask;
  const x = Math.min(width - 1, Math.floor(q.x * width));
  const y = Math.min(height - 1, Math.floor(q.y * height));
  return (data[y * width + x] ?? 0) >= 128;
}
```

- [ ] **Step 4: Implement the host** — in `packages/web/src/lib/native-splat-scene.ts`:

Replace the first four import lines with:

```ts
import { DataTexture, Matrix4, NearestFilter, Object3D, RedFormat, Scene, UnsignedByteType, Vector2, Vector3, SRGBColorSpace, type BufferGeometry, type Camera } from "three";
import { StorageBufferAttribute, type UniformNode, type WebGPURenderer } from "three/webgpu";
import { GaussianSplat } from "three/addons/objects/GaussianSplat.js";
import { Fn, If, float, length, max, min, storage, texture, uniform, uniformArray, vec3, vec4 } from "three/tsl";
import { EXCLUSION_MASK_HEIGHT, EXCLUSION_MASK_WIDTH, resampleExclusionMask, type SplatExclusion } from "./splat-exclusion.js";
```
(The existing fifth import, from `./native-splat-merge.js`, stays.)

Add to `interface Snapshot`, after `readonly clipEnabled: UniformNode<"float", number>;`:

```ts
  readonly exclusionEnabled: UniformNode<"float", number>;
  readonly exclusionMatrix: UniformNode<"mat4", Matrix4>;
  readonly exclusionBand: UniformNode<"vec2", Vector2>;
```

Add class fields after `private clipOwner: object | null = null;`:

```ts
  private exclusion: SplatExclusion | null = null;
  private exclusionOwner: object | null = null;
  private readonly exclusionTexture = (() => {
    const mask = new DataTexture(new Uint8Array(EXCLUSION_MASK_WIDTH * EXCLUSION_MASK_HEIGHT), EXCLUSION_MASK_WIDTH, EXCLUSION_MASK_HEIGHT, RedFormat, UnsignedByteType);
    mask.magFilter = NearestFilter; mask.minFilter = NearestFilter;
    mask.generateMipmaps = false; mask.flipY = false; mask.needsUpdate = true;
    return mask;
  })();
```

Add public methods after `clearClip`:

```ts
  /** The shared R8 mask sampled by every draw's exclusion test. */
  get exclusionMask(): DataTexture { return this.exclusionTexture; }

  setExclusion(owner: object, exclusion: SplatExclusion | null): void {
    this.exclusionOwner = owner;
    this.exclusion = exclusion;
    const data = this.exclusionTexture.image.data;
    if (!(data instanceof Uint8Array)) throw new Error("The exclusion mask must be 8-bit.");
    data.set(exclusion === null ? new Uint8Array(data.length) : resampleExclusionMask(exclusion.mask, EXCLUSION_MASK_WIDTH, EXCLUSION_MASK_HEIGHT));
    this.exclusionTexture.needsUpdate = true;
    for (const snapshot of this.snapshots.values()) this.updateSnapshot(snapshot);
    this.invalidate();
  }

  clearExclusion(owner: object): void {
    if (this.exclusionOwner !== owner) return;
    this.setExclusion(owner, null);
    this.exclusionOwner = null;
  }
```

In `createSnapshot`, after `const clipEnabled = uniform(0);`, add:

```ts
    const exclusionEnabled = uniform(0);
    const exclusionMatrix = uniform(new Matrix4());
    const exclusionBand = uniform(new Vector2(-0.15, 0.12));
    const exclusionMask = this.exclusionTexture;
```

In the `opacityNode` `Fn`, directly before `return opacity;`, add:

```ts
          If(exclusionEnabled.greaterThan(0.5), () => {
            const q = exclusionMatrix.mul(vec4(position, 1)).toVar();
            const onGrid = q.x.greaterThanEqual(0).and(q.x.lessThanEqual(1)).and(q.y.greaterThanEqual(0)).and(q.y.lessThanEqual(1));
            const inBand = q.z.greaterThanEqual(exclusionBand.x).and(q.z.lessThanEqual(exclusionBand.y));
            If(onGrid.and(inBand), () => {
              If(texture(exclusionMask, q.xy).level(0).r.greaterThan(0.5), () => { opacity.assign(0); });
            });
          });
```

Add `exclusionEnabled, exclusionMatrix, exclusionBand,` to the `snapshot` object literal after `center, halfExtent, softEdge, clipEnabled,`.

In `updateSnapshot`, after the clip block, add:

```ts
    snapshot.exclusionEnabled.value = this.exclusion === null ? 0 : 1;
    if (this.exclusion !== null) {
      snapshot.exclusionMatrix.value.copy(this.exclusion.matrix);
      snapshot.exclusionBand.value.set(-this.exclusion.below, this.exclusion.above);
    }
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/splat-exclusion.test.ts src/lib/__tests__/native-splat-scene.test.ts src/lib/__tests__/native-splat-depth-order.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/splat-exclusion.ts packages/web/src/lib/native-splat-scene.ts packages/web/src/lib/__tests__/splat-exclusion.test.ts packages/web/src/lib/__tests__/native-splat-scene.test.ts && git diff --cached --stat && git commit -m "feat(native-splats): hide the splats a measured surface replaces (T-639)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The stage floor in the walk and the planner

**Files:**
- Create: `packages/web/src/components/stage/StageFloor.tsx`
- Modify: `packages/web/src/components/editor/PlannerScene.tsx` (inside `<group name="live-room-capture" ...>`)
- Modify: `packages/web/src/components/rooms/RoomSplatScene.tsx` (after the `NativeSplatLayer` list)
- Test: `packages/web/src/components/stage/__tests__/stage-floor-mode.test.ts`

**Interfaces:**
- Consumes: Task 6 (`floor-skin.ts`), Task 7 (`nativeSplatScene(scene).setExclusion/clearExclusion`), `useDeviceStore` tier, `RuntimeAssetViewTransform`, `gaussianSplatsAvailable`.
- Produces: `StageFloor({ roomSlug, transform, active }: { readonly roomSlug: string | null; readonly transform: RuntimeAssetViewTransform; readonly active: boolean }): ReactElement | null` and the pure `floorColourModeFromSearch(search: string, previewable: boolean): FloorColourMode`.

- [ ] **Step 1: Write the failing test** — create `packages/web/src/components/stage/__tests__/stage-floor-mode.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { floorColourModeFromSearch } from "../StageFloor.js";

describe("floor colour choice for Blake's review (T-639)", () => {
  it("shows the photographs as they are by default", () => {
    expect(floorColourModeFromSearch("", true)).toBe("photo");
  });

  it("offers the matched floor where splats may run", () => {
    expect(floorColourModeFromSearch("?floor=matched", true)).toBe("matched");
  });

  it("ignores the query where splats may not run", () => {
    expect(floorColourModeFromSearch("?floor=matched", false)).toBe("photo");
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/stage/__tests__/stage-floor-mode.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `packages/web/src/components/stage/StageFloor.tsx`:

```tsx
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { useThree } from "@react-three/fiber";
import { FrontSide, Group, Matrix4, SRGBColorSpace, TextureLoader, Vector3, type BufferGeometry, type Texture } from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { texture as textureNode, uniform, uv, vec4 } from "three/tsl";
import type { RuntimeAssetViewTransform } from "../../lib/runtime-package-resolution.js";
import {
  FloorSkinManifestSchema, captureToMaskMatrix, decodeFloorHeights, floorColourGain,
  floorSkinManifestUrl, floorSkinTier, floorSkinTileGeometry,
  type FloorColourMode, type FloorSkinManifest, type FloorSkinTier,
} from "../../lib/floor-skin.js";
import { nativeSplatScene } from "../../lib/native-splat-scene.js";
import { gaussianSplatsAvailable } from "../../lib/splat-access.js";
import { useDeviceStore } from "../../stores/device-store.js";

export function floorColourModeFromSearch(search: string, previewable: boolean): FloorColourMode {
  if (!previewable) return "photo";
  return new URLSearchParams(search).get("floor") === "matched" ? "matched" : "photo";
}

interface LoadedFloor {
  readonly manifest: FloorSkinManifest;
  readonly tiles: readonly { readonly geometry: BufferGeometry; readonly map: Texture }[];
  readonly slab: Uint8Array;
}

async function readBytes(url: string, signal: AbortSignal, what: string): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`The ${what} could not be read (${String(response.status)}).`);
  return response.arrayBuffer();
}

async function loadFloor(url: string, tierName: FloorSkinTier, signal: AbortSignal): Promise<LoadedFloor> {
  const base = url.slice(0, url.lastIndexOf("/") + 1);
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`The floor skin could not be read (${String(response.status)}).`);
  const manifest = FloorSkinManifestSchema.parse(await response.json());
  const [heightBuffer, slabBuffer] = await Promise.all([
    readBytes(base + manifest.height.file, signal, "floor height grid"),
    readBytes(base + manifest.slab.file, signal, "floor slab mask"),
  ]);
  const heights = decodeFloorHeights(heightBuffer, manifest);
  const slab = new Uint8Array(slabBuffer);
  if (slab.length !== manifest.slab.width * manifest.slab.height) throw new Error("The floor slab mask has the wrong size.");
  const loader = new TextureLoader();
  const files = manifest.tiers[tierName].files;
  const tiles = await Promise.all(manifest.tiles.map(async (_, index) => {
    const file = files[index];
    if (file === undefined) throw new Error(`The floor skin tier lacks tile ${String(index)}.`);
    const map = await loader.loadAsync(base + file);
    map.colorSpace = SRGBColorSpace;
    map.flipY = false;
    map.anisotropy = 8;
    map.needsUpdate = true;
    return { geometry: floorSkinTileGeometry(manifest, index, heights), map };
  }));
  if (signal.aborted) {
    for (const tile of tiles) { tile.geometry.dispose(); tile.map.dispose(); }
    throw new DOMException("Aborted", "AbortError");
  }
  return { manifest, tiles, slab };
}

/** The room's floor as a measured surface wearing its photographs (T-639),
 * drawn under the splat transform; while shown, it hides the floor-slab splats. */
export function StageFloor({ roomSlug, transform, active }: {
  readonly roomSlug: string | null;
  readonly transform: RuntimeAssetViewTransform;
  readonly active: boolean;
}): ReactElement | null {
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);
  const deviceTier = useDeviceStore((state) => state.tier);
  const tierName = floorSkinTier(deviceTier);
  const url = roomSlug === null ? null : floorSkinManifestUrl(roomSlug, import.meta.env.VITE_SPLAT_BASE_URL);
  const colourMode = floorColourModeFromSearch(typeof window === "undefined" ? "" : window.location.search, gaussianSplatsAvailable());
  const [floor, setFloor] = useState<LoadedFloor | null>(null);
  const group = useMemo(() => new Group(), []);

  useEffect(() => {
    if (url === null || !active) return;
    const controller = new AbortController();
    let loaded: LoadedFloor | null = null;
    loadFloor(url, tierName, controller.signal)
      .then((result) => { loaded = result; setFloor(result); invalidate(); })
      .catch(() => { if (!controller.signal.aborted) setFloor(null); });
    return () => {
      controller.abort();
      setFloor(null);
      if (loaded !== null) for (const tile of loaded.tiles) { tile.geometry.dispose(); tile.map.dispose(); }
    };
  }, [url, tierName, active, invalidate]);

  const materials = useMemo(() => {
    if (floor === null) return [];
    const gain = uniform(new Vector3(...floorColourGain(floor.manifest, colourMode)));
    return floor.tiles.map((tile) => {
      const material = new MeshBasicNodeMaterial({ side: FrontSide });
      const sample = textureNode(tile.map, uv());
      material.colorNode = vec4(sample.rgb.mul(gain), sample.a);
      material.alphaTest = 0.5;
      return material;
    });
  }, [floor, colourMode]);
  useEffect(() => () => { for (const material of materials) material.dispose(); }, [materials]);

  useEffect(() => {
    if (floor === null || !active) return;
    const host = nativeSplatScene(scene);
    const owner = {};
    scene.updateWorldMatrix(true, false);
    group.updateWorldMatrix(true, false);
    const captureFromScene = new Matrix4().copy(scene.matrixWorld).invert().multiply(group.matrixWorld).invert();
    host.setExclusion(owner, {
      matrix: captureToMaskMatrix(floor.manifest).multiply(captureFromScene),
      below: floor.manifest.slab.below,
      above: floor.manifest.slab.above,
      mask: { width: floor.manifest.slab.width, height: floor.manifest.slab.height, data: floor.slab },
    });
    invalidate();
    return () => { host.clearExclusion(owner); invalidate(); };
  }, [floor, active, scene, group, invalidate, transform]);

  if (floor === null || !active) return null;
  return (
    <primitive object={group} position={[...transform.position]} rotation={[...transform.rotation]} scale={transform.scale} name="stage-floor">
      {floor.tiles.map((tile, index) => {
        const material = materials[index];
        return material === undefined ? null : <mesh key={index} geometry={tile.geometry} material={material} name={`stage-floor-tile-${String(index)}`} />;
      })}
    </primitive>
  );
}
```

Mount it in `packages/web/src/components/editor/PlannerScene.tsx`: add

```ts
import { StageFloor } from "../stage/StageFloor.js";
```
and inside `<group name="live-room-capture" ...>`, directly after the `<CockpitSplatLayer ... />` element:

```tsx
              <StageFloor roomSlug={roomSlug} transform={transform} active={splatActive} />
```

Mount it in `packages/web/src/components/rooms/RoomSplatScene.tsx`: add the same import (path `../stage/StageFloor.js`) and, directly after the `{mounted.map(...)}` block that renders the `NativeSplatLayer`s:

```tsx
      <StageFloor roomSlug={room} transform={transform} active />
```

Note for the implementer: the exclusion matrix is set once the group has its transform. If the effect runs before R3F applies the `position`/`rotation` props (the group's `matrixWorld` is still identity), compose the matrix from `transform` directly instead: `new Matrix4().compose(new Vector3(...transform.position), new Quaternion().setFromEuler(new Euler(...transform.rotation)), new Vector3(transform.scale, transform.scale, transform.scale))`, pre-multiplied by the inverse scene matrix. Verify with Task 9 Step 2 (floor splats gone, walls intact).

- [ ] **Step 4: Run the tests and the type check**

```bash
cd D:/claude/real-hall/repo && pnpm --filter @omnitwin/web exec vitest run src/components/stage src/components/editor src/components/rooms && pnpm --filter @omnitwin/web typecheck
```
Expected: PASS and no type errors. If `typecheck` is not a script in `packages/web/package.json`, run `pnpm --filter @omnitwin/web exec tsc --noEmit -p tsconfig.json`.

- [ ] **Step 5: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/components/stage packages/web/src/components/editor/PlannerScene.tsx packages/web/src/components/rooms/RoomSplatScene.tsx && git diff --cached --stat && git commit -m "feat(web): the Grand Hall stands on its own photographed floor (T-639)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: See it in a real browser (development build)

**Files:** none in the repo; evidence under `D:/claude/real-hall/evidence/i1a/`.

- [ ] **Step 1: Full checks**

```bash
cd D:/claude/real-hall/repo && pnpm --filter @omnitwin/web exec vitest run 2>&1 | tail -6 && pnpm --filter @omnitwin/web lint && pnpm --filter @omnitwin/web typecheck && VITE_CLERK_PUBLISHABLE_KEY=pk_live_localbuildcheck pnpm --filter @omnitwin/web build 2>&1 | tail -3
```
Expected: every test passes; lint, typecheck and build exit 0. Record the test counts in the session note.

- [ ] **Step 2: Walk page before and after** — run the web dev server from this worktree with `SPLAT_STAGING_ROOT=D:\claude\splats` (add a `.claude/launch.json` entry in the worktree, port 5192, and start it with `preview_start`), and a second dev server from `D:/claude/visual-firstprinciples-20260928/repo` (origin/master, after `pnpm install` there) on port 5193. Holding the GPU lock, capture `/room/grand-hall?bare=1` from the same pose on both with the existing read-back harness:

```bash
cd D:/claude/real-hall/repo && SPLAT_BUDGET_LABEL=i1a SHOT=true node packages/web/scripts/splat-drag-budget.mjs
```
Read the script's header first for its URL and pose options and point it at each port in turn. Expected: the new frame shows boards on the floor, no pink cast and no haze over the floor; the old frame shows the smeared floor. Save both to the evidence folder and look at them with the Read tool.

- [ ] **Step 2b: Choose the floor arm** — build arms A and C with the builder into `D:/claude/real-hall/floor-arms/<arm>/v1`, copy one at a time into `D:/claude/splats/trades-hall/grand-hall/floor-skin/v1/` (the development middleware sends package files `no-cache`), and capture the same poses for each, holding the GPU lock. Judge by eye: grain and joints, colour, seams, and the daylight baked into the photographs. Leave the winner staged; it is the package Task 10 publishes.

- [ ] **Step 3: Planner check** — open `/plan?space=grand-hall` in the development build (the local stack from the project's local-dev notes, or the e2e plan-bootstrap stub), confirm the floor skin appears under the captured hall, the splats show no film curve, placing a table still works and `?floor=matched` switches the floor colour. Screenshot the planner overview with and without `?floor=matched`.

- [ ] **Step 4: Phone check** — in the browser pane's mobile preset (Android user agent), load the walk page and read `window.__splatRuntimeProfile.tier` with `javascript_tool`; expected `"low"`.

---

### Task 10: Ship to a preview link and master

**Files:** `docs/engineering/native-splats.md`, `docs/sessions/2026-09-28.md`, `docs/state/tasks.md`.

- [ ] **Step 1: Publish the floor-skin package to R2** (before any preview or production code reads it)

```bash
cd D:/claude/real-hall/repo/packages/api && pnpm exec tsx src/scripts/publish-splat-tiles.ts --staged "D:\claude\splats" --package grand-hall/floor-skin/v1 --dry-run
```
Then the same command without `--dry-run` (the package mode from Task 10a publishes only that version directory, manifest last). Verify at the bucket, not the site, since every deployment redirects `/splats/*` under the hold: `curl -sI -H "Origin: https://example.vercel.app" https://pub-2bf1ea54c4c642d3b19067b97c55dc5d.r2.dev/splats/trades-hall/grand-hall/floor-skin/v1/floor-skin.json` → `200`, `Content-Type: application/json`, `Access-Control-Allow-Origin` echoed.

- [ ] **Step 2: Record the change** — add to `docs/engineering/native-splats.md` a section "Presentation and the floor skin (T-639)" stating: splats draw without anti-aliasing compensation (the loaders refuse anti-aliased sources); captured rooms render without tone mapping; the host hides floor-slab splats under a floor skin via a shared R8 mask, a band and a scene→mask matrix; preview deployments may open splats. Update the session log and the T-639 row with commits and evidence paths.

- [ ] **Step 3: Push and check the preview**

```bash
cd D:/claude/real-hall/repo && git push && gh api repos/codemaker66/omnitwin/commits/$(git rev-parse HEAD)/status --jq '.statuses[] | [.context,.state,.target_url] | @tsv'
```
Expected: a Vercel status with a preview URL. Open `<preview>/room/grand-hall` in the browser pane: the captured hall with the photographic floor (if Vercel Deployment Protection is on, the page asks for a Vercel login; report the preview as private). If the preview shows the "Work in progress" page, `VERCEL_ENV` did not reach the build: check for the literal `"preview"` in the preview's JavaScript bundle and report. In the network log, tiles and the floor package must come from `pub-2bf1ea54c4c642d3b19067b97c55dc5d.r2.dev`.

- [ ] **Step 4: Merge to master and verify production still holds** — after CI passes on the branch, merge `claude/real-hall` into master (resolve documentation conflicts by keeping both sides), push, and verify production: `https://venviewer.com/room/grand-hall` still shows "Work in progress", `https://venviewer.com/splats/trades-hall/grand-hall/0_0.sog` still redirects to `/work-in-progress`, and the planner still opens. Record the CI and deploy run IDs in the session log.

- [ ] **Step 5: Hand to Blake** — send the preview link, the before/after images and one question: the photographic floor as it is, or matched to the splat room.

---

## Amendments during execution (28 September)

Found while executing; recorded here so the plan stays the complete record. Their briefs live in the plan's SDD workspace until the branch merges.

- **Task 1b: where preview and development read room assets.** The `/splats/*` rewrite to R2 was removed by the 19 September hold (commit 7cfbcc4c): every deployment now redirects `/splats/*` to `/work-in-progress`, so Task 1 alone would have opened splats on previews with no tiles behind them. Preview builds read the public R2 bucket directly (`resolveBuildSplatBaseUrl` in `packages/web/src/lib/production-env.ts`); the bucket's CORS policy already admits `*.vercel.app` (a preflight from a preview origin returned 204 with the origin echoed). Production keeps `""` and the hold. The development staging middleware also serves a room's floor-skin package (`.json`, `.webp`, `.i16`, `.u8`, only inside a `floor-skin/` directory, sent `no-cache`).
- **Task 5b: Arm C.** The floor study finished after Task 5 with a third arm: the raw 4096 px cube faces after a joint pose solve (sweep misalignment on the floor 7.5 mm median before, 1.1 mm after). It measured sharpest in all six comparison crops (Laplacian variance 188–654; A 34–190; B 108–444). The builder accepts `--arm C`; Task 9 Step 2b compares A and C in the browser. Known defects of B and C: daylight baked in (a sun patch and window-light pools along the window wall) and a south third photographed only in the evening.
- **Task 10a: publishing a package.** `publish-splat-tiles.ts` gains `--package <room>/<package>/v<number>`: one version directory, each file with its content type, immutable caching and its SHA-256 in object metadata, the manifest last and withheld if any file failed, and a refusal to overwrite a published version with different bytes. A rebuilt package is published as the next version.

---

## Self-review

1. **Spec coverage.** §3.2: A-lite (no tone mapping, no false anti-aliasing dimming) in Tasks 2–3; exact display-space blending is the I1b plan, justified by the H1L measurement. §3.4 phone classification: Task 4. §3.6 floor-skin package and floor-slab removal: Tasks 5–8 (removal is a runtime mask test rather than rewritten tiles, which leaves source captures untouched and costs no re-encode). §3.6 "colour harmonised to the splat room": replaced by Blake's choice between `photo` and `matched` (Global Constraints), because the only measured harmonisation made the floor dusky pink. §3.7 access: Task 1. §4 I1 floor-arm rule: Task 5 builds either arm; Task 9 compares them in the browser. §7 verification: Tasks 9–10.
2. **Placeholders.** None: every code step carries its code; Task 10's R2 step names its stop condition; the manifest example's values are marked as shape placeholders written by the builder.
3. **Type consistency.** `SplatExclusion` (Task 7) is what `StageFloor` passes (Task 8); `captureToMaskMatrix`, `floorSkinTier`, `FloorSkinTier`, `floorColourGain`, `floorSkinTileGeometry`, `decodeFloorHeights` and `floorSkinManifestUrl` match between Tasks 6 and 8; `gaussianSplatsAvailable()` keeps its no-argument call sites.
