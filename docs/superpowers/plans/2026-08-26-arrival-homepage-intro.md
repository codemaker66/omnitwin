# The Arrival — Live Fly-In Homepage Intro Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-08-26-arrival-homepage-intro-design.md` — read it first; its §4 constraints are law.

**Goal:** venviewer.com's hero becomes a live scene: Google Photorealistic 3D Tiles fly the recorded path into Trades Hall, crossfade into the Twin dollhouse mesh, and click-explode into labeled storeys leading to `/tour` and `/plan`.

**Architecture:** A self-contained `arrival/` module renders its own R3F `<Canvas>` layered over the existing static hero photo (which is the universal fallback). `3d-tiles-renderer`'s `ReorientationPlugin` puts Trades Hall at the scene origin Y-up, so the camera rail and twin placement are authored in local meters. A Zustand phase machine (`loading → flight → arrived → exploded`, + `fallback`) drives everything; frameloop is `always` only while animating.

**Tech Stack:** three 0.180.0 · @react-three/fiber 8.18.0 · @react-three/drei 9.122.0 · react 18.3.1 · zustand 5.0.3 · `3d-tiles-renderer@0.5.2` (peers verified: fiber `^8.17.9||^9`, react `^18.3.1||^19`, three `>=0.167`) · Vitest 4 + happy-dom · Playwright.

## Global Constraints

- TypeScript strict, zero `any`, `noUncheckedIndexedAccess` — env access is bracket-style: `import.meta.env["VITE_X"]` (pattern: `packages/web/src/twin/useTwinManifest.ts:26-28`).
- NO Spark / splats anywhere in the hero (spec §4). Mesh only.
- Springs, never tweens: `stepSpring(state, target, dtSeconds, config)` mutates in place; `isSpringSettled(state, target, epsilon?)` — from `packages/web/src/lib/springs.ts`.
- The dollhouse peel is settled: never modify `dollhouse-peel.ts`, `dollhouse-shell.ts`, material `side`, or the facing split. Explode moves whole chunk meshes only.
- Twin asset slug is `trades-hall` (the venues-table slug `trades-hall-glasgow` is a DIFFERENT namespace — mixing them 404s; see memory `project_venue_slug_namespaces`).
- Naming/copy: House/Floor vocabulary ("the Arrival", "Open the Hall"). No new cockpit names.
- Non-hero /fresh content must be byte-identical in behavior. The static hero photo `<img class="fr-hero-photo">` STAYS in the DOM always.
- Every commit: explicit pathspec (`git commit -- <paths>`), message trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Verify chain before declaring any task done: `pnpm --filter @omnitwin/types build` (once per session, web typecheck needs the .d.ts), then `pnpm --filter @omnitwin/web typecheck && pnpm --filter @omnitwin/web test`. Web `build` needs `VITE_CLERK_PUBLISHABLE_KEY=pk_live_localbuildcheck` in the environment.
- Component tests mock R3F per the repo pattern — copy the mock preamble style from `packages/web/src/twin/__tests__/DollhouseStage.test.tsx` (uses `vi.hoisted` + `vi.mock("@react-three/fiber")` / `vi.mock("@react-three/drei")`).
- Dev server: use `.claude/launch.json` config (Vite on 5173; API per `project_local_dev_stack` if needed). Never run dev servers via raw Bash.

---

### Task 1: Dependency + arrival config plumbing

**Files:**
- Modify: `packages/web/package.json` (dependency added via pnpm CLI, not hand-edit)
- Modify: root `package.json` (pnpm peer-rule for unused Babylon entry points)
- Create: `packages/web/src/pages/landing/arrival/arrival-config.ts`
- Test: `packages/web/src/pages/landing/arrival/__tests__/arrival-config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `googleTilesApiKey(): string | null` — later tasks (4, 5, 12) gate on it. Also the installed `3d-tiles-renderer` package.

- [ ] **Step 1: Install the renderer, exact version**

```bash
pnpm --filter @omnitwin/web add -E 3d-tiles-renderer@0.5.2
```

- [ ] **Step 2: Silence the irrelevant Babylon peer warnings**

`3d-tiles-renderer` declares `@babylonjs/core` / `@babylonjs/loaders` peers for its Babylon entry point, which we never import. In root `package.json`, extend (or create) the pnpm config:

```json
"pnpm": {
  "peerDependencyRules": {
    "ignoreMissing": ["@babylonjs/core", "@babylonjs/loaders"]
  }
}
```

Then run `pnpm install` and confirm the install log shows no unmet-peer warning for three/fiber/react (those peers are genuinely satisfied — fail the task if not).

- [ ] **Step 3: Write the failing config test**

```ts
// packages/web/src/pages/landing/arrival/__tests__/arrival-config.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { googleTilesApiKey } from "../arrival-config.js";

describe("googleTilesApiKey", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns null when the env var is unset or blank", () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_TILES_KEY", "");
    expect(googleTilesApiKey()).toBeNull();
  });

  it("returns the trimmed key when set", () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_TILES_KEY", " AIza-test-key ");
    expect(googleTilesApiKey()).toBe("AIza-test-key");
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `pnpm --filter @omnitwin/web test -- src/pages/landing/arrival/__tests__/arrival-config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement**

```ts
// packages/web/src/pages/landing/arrival/arrival-config.ts
/**
 * Google Map Tiles API key for the Arrival hero. Absent in dev until the key
 * lands in packages/web/.env.local; absence must degrade to the static hero
 * photo, never throw (spec §6). Bracket access per useTwinManifest.ts:26.
 */
export function googleTilesApiKey(): string | null {
  const raw = import.meta.env["VITE_GOOGLE_MAPS_TILES_KEY"];
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}
```

- [ ] **Step 6: Run to verify pass, then commit**

```bash
git add packages/web/src/pages/landing/arrival packages/web/package.json package.json pnpm-lock.yaml
git commit -m "feat(arrival): add 3d-tiles-renderer and tiles API key config" -- packages/web/src/pages/landing/arrival packages/web/package.json package.json pnpm-lock.yaml
```

---

### Task 2: Camera rail — pure math module

**Files:**
- Create: `packages/web/src/pages/landing/arrival/camera-rail.ts`
- Test: `packages/web/src/pages/landing/arrival/__tests__/camera-rail.test.ts`

**Interfaces:**
- Consumes: `three` (`Vector3`, `Quaternion`, `Matrix4`, `CatmullRomCurve3`, `MathUtils`).
- Produces (Tasks 5, 12 rely on these exact names):

```ts
export interface RailKeyframe {
  /** Normalized rail time 0..1, strictly increasing across the array. */
  readonly t: number;
  /** Camera position, local meters (Trades Hall anchor at origin, +Y up). */
  readonly position: readonly [number, number, number];
  /** Point the camera looks at, same space. */
  readonly lookAt: readonly [number, number, number];
}
export interface RailPose {
  readonly position: Vector3;
  readonly quaternion: Quaternion;
}
export function sampleRail(keyframes: readonly RailKeyframe[], tNorm: number): RailPose;
export const ARRIVAL_RAIL: readonly RailKeyframe[];
export const FLIGHT_DURATION_S: number;
```

- [ ] **Step 1: Write the failing tests**

```ts
// packages/web/src/pages/landing/arrival/__tests__/camera-rail.test.ts
import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import {
  ARRIVAL_RAIL,
  FLIGHT_DURATION_S,
  sampleRail,
  type RailKeyframe,
} from "../camera-rail.js";

const RAIL: readonly RailKeyframe[] = [
  { t: 0, position: [0, 1000, 1000], lookAt: [0, 0, 0] },
  { t: 0.5, position: [0, 400, 400], lookAt: [0, 10, 0] },
  { t: 1, position: [0, 30, 60], lookAt: [0, 12, 0] },
];

describe("sampleRail", () => {
  it("returns the first keyframe pose at t<=0 and the last at t>=1 (clamped)", () => {
    expect(sampleRail(RAIL, -0.5).position.toArray()).toEqual([0, 1000, 1000]);
    expect(sampleRail(RAIL, 0).position.toArray()).toEqual([0, 1000, 1000]);
    const end = sampleRail(RAIL, 1.7).position;
    expect(end.distanceTo(new Vector3(0, 30, 60))).toBeLessThan(1e-6);
  });

  it("descends monotonically in altitude for a descending rail", () => {
    let prevY = Number.POSITIVE_INFINITY;
    for (let i = 0; i <= 20; i += 1) {
      const y = sampleRail(RAIL, i / 20).position.y;
      expect(y).toBeLessThanOrEqual(prevY + 1e-6);
      prevY = y;
    }
  });

  it("produces a normalized quaternion that looks toward the lookAt point", () => {
    const pose = sampleRail(RAIL, 1);
    expect(
      Math.abs(
        pose.quaternion.x ** 2 + pose.quaternion.y ** 2 +
        pose.quaternion.z ** 2 + pose.quaternion.w ** 2 - 1,
      ),
    ).toBeLessThan(1e-6);
    // Camera forward is -Z rotated by the quaternion; it must point at lookAt.
    const forward = new Vector3(0, 0, -1).applyQuaternion(pose.quaternion);
    const toTarget = new Vector3(0, 12, 0).sub(pose.position).normalize();
    expect(forward.angleTo(toTarget)).toBeLessThan(1e-4);
  });

  it("ships a real rail: 0-start, 1-end, strictly increasing t, sane duration", () => {
    expect(ARRIVAL_RAIL[0]?.t).toBe(0);
    expect(ARRIVAL_RAIL[ARRIVAL_RAIL.length - 1]?.t).toBe(1);
    for (let i = 1; i < ARRIVAL_RAIL.length; i += 1) {
      expect(ARRIVAL_RAIL[i]!.t).toBeGreaterThan(ARRIVAL_RAIL[i - 1]!.t);
    }
    expect(FLIGHT_DURATION_S).toBeGreaterThan(6);
    expect(FLIGHT_DURATION_S).toBeLessThan(20);
  });
});
```

(If the repo's eslint config forbids non-null assertions in tests, swap the `!` accesses for explicit `expect(...).toBeDefined()` guards — match the house test style.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @omnitwin/web test -- src/pages/landing/arrival/__tests__/camera-rail.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/web/src/pages/landing/arrival/camera-rail.ts
import { CatmullRomCurve3, MathUtils, Matrix4, Quaternion, Vector3 } from "three";

// -----------------------------------------------------------------------------
// camera-rail — the Arrival's flight path as pure, testable math.
//
// Space: local meters around the Trades Hall anchor. ReorientationPlugin
// (GoogleTilesStage) places the anchor at the scene origin with +Y up and
// cardinal axes aligned, so these numbers survive independent of the globe.
// Position runs through a centripetal Catmull-Rom (no corner kinks at
// keyframes); look-at targets interpolate linearly per segment; segment-local
// progress is smoothstepped so each leg eases in/out without a global
// velocity discontinuity. Roll is always zero (up = +Y): an establishing
// dive, not a barrel roll.
// -----------------------------------------------------------------------------

export interface RailKeyframe {
  readonly t: number;
  readonly position: readonly [number, number, number];
  readonly lookAt: readonly [number, number, number];
}

export interface RailPose {
  readonly position: Vector3;
  readonly quaternion: Quaternion;
}

const UP = new Vector3(0, 1, 0);

/** Smootherstep (Perlin) — zero 1st AND 2nd derivative at the ends. */
function smoother(u: number): number {
  const x = MathUtils.clamp(u, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

export function sampleRail(
  keyframes: readonly RailKeyframe[],
  tNorm: number,
): RailPose {
  if (keyframes.length < 2) {
    throw new Error("sampleRail needs at least two keyframes");
  }
  const t = MathUtils.clamp(tNorm, 0, 1);

  // Find the active segment by keyframe time.
  let seg = 0;
  while (seg < keyframes.length - 2 && t > keyframes[seg + 1]!.t) {
    seg += 1;
  }
  const a = keyframes[seg]!;
  const b = keyframes[seg + 1]!;
  const span = Math.max(b.t - a.t, 1e-9);
  const u = smoother((t - a.t) / span);

  // Global position spline through ALL keyframes (centripetal — no kinks),
  // sampled at the eased global parameter mapped into the curve's 0..1.
  const curve = new CatmullRomCurve3(
    keyframes.map((k) => new Vector3(...k.position)),
    false,
    "centripetal",
  );
  const curveT = (seg + u) / (keyframes.length - 1);
  const position = curve.getPoint(curveT);

  const lookAt = new Vector3(...a.lookAt).lerp(new Vector3(...b.lookAt), u);
  const m = new Matrix4().lookAt(position, lookAt, UP);
  const quaternion = new Quaternion().setFromRotationMatrix(m).normalize();
  return { position, quaternion };
}

/** Flight length — matches the recording's pacing plus a settle beat. */
export const FLIGHT_DURATION_S = 11;

/**
 * SEED rail, tuned live in Task 6 against the reference footage
 * (D:\Davinci exports\trades hall zoom in 2.mov — 9.37 s: city-wide over the
 * Clyde → dive → settle on the Glassford Street facade). Axis mapping of the
 * reoriented frame (which horizontal axis is north) is confirmed in Task 6;
 * until then these x/z values are calibrated by eye, not survey.
 */
export const ARRIVAL_RAIL: readonly RailKeyframe[] = [
  { t: 0.0, position: [-600, 3400, 1400], lookAt: [0, 0, 200] },
  { t: 0.45, position: [-220, 900, 520], lookAt: [0, 8, 60] },
  { t: 0.8, position: [-90, 180, 150], lookAt: [0, 14, 0] },
  { t: 1.0, position: [-58, 26, 40], lookAt: [0, 13, 0] },
];
```

(`sampleRail` allocates a `CatmullRomCurve3` per call — fine for tests; Task 5's `FlightCamera` calls it per frame, so memoize the curve there if the frame budget flags it. Do not pre-optimize.)

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @omnitwin/web test -- src/pages/landing/arrival/__tests__/camera-rail.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/pages/landing/arrival/camera-rail.ts packages/web/src/pages/landing/arrival/__tests__/camera-rail.test.ts
git commit -m "feat(arrival): camera rail as pure eased spline math" -- packages/web/src/pages/landing/arrival
```

---

### Task 3: Arrival phase machine (zustand)

**Files:**
- Create: `packages/web/src/pages/landing/arrival/arrival-store.ts`
- Test: `packages/web/src/pages/landing/arrival/__tests__/arrival-store.test.ts`

**Interfaces:**
- Consumes: `zustand` (`create`), pattern reference `packages/web/src/stores/device-store.ts`.
- Produces (Tasks 4, 5, 10, 12 rely on these exact names):

```ts
export type ArrivalPhase = "loading" | "flight" | "arrived" | "exploded" | "fallback";
export type ArrivalFailReason = "no-key" | "webgl" | "tiles" | "poster-tier";
// state: phase, failReason, reducedMotion
// actions: tilesReady(), flightDone(), skip(), explode(), reassemble(),
//          fail(reason), setReducedMotion(v), reset()
export const useArrivalStore: /* zustand store of the above */;
```

- [ ] **Step 1: Write the failing tests**

```ts
// packages/web/src/pages/landing/arrival/__tests__/arrival-store.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { useArrivalStore } from "../arrival-store.js";

const s = () => useArrivalStore.getState();

describe("arrival phase machine", () => {
  beforeEach(() => {
    s().reset();
  });

  it("boots in loading and flies once tiles are ready", () => {
    expect(s().phase).toBe("loading");
    s().tilesReady();
    expect(s().phase).toBe("flight");
  });

  it("reduced motion goes straight to arrived, skipping the flight", () => {
    s().setReducedMotion(true);
    s().tilesReady();
    expect(s().phase).toBe("arrived");
  });

  it("skip only acts during flight", () => {
    s().skip();
    expect(s().phase).toBe("loading");
    s().tilesReady();
    s().skip();
    expect(s().phase).toBe("arrived");
  });

  it("explode round-trips arrived ⇄ exploded and refuses from flight", () => {
    s().tilesReady();
    s().explode();
    expect(s().phase).toBe("flight"); // refused
    s().flightDone();
    s().explode();
    expect(s().phase).toBe("exploded");
    s().reassemble();
    expect(s().phase).toBe("arrived");
  });

  it("fail wins from any phase and keeps the FIRST reason", () => {
    s().tilesReady();
    s().fail("tiles");
    s().fail("webgl");
    expect(s().phase).toBe("fallback");
    expect(s().failReason).toBe("tiles");
  });

  it("no transition escapes fallback except reset", () => {
    s().fail("no-key");
    s().tilesReady();
    s().flightDone();
    s().explode();
    expect(s().phase).toBe("fallback");
    s().reset();
    expect(s().phase).toBe("loading");
    expect(s().failReason).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — same test-run command shape as Task 2. Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/web/src/pages/landing/arrival/arrival-store.ts
import { create } from "zustand";

export type ArrivalPhase = "loading" | "flight" | "arrived" | "exploded" | "fallback";
export type ArrivalFailReason = "no-key" | "webgl" | "tiles" | "poster-tier";

interface ArrivalState {
  phase: ArrivalPhase;
  failReason: ArrivalFailReason | null;
  reducedMotion: boolean;
  tilesReady: () => void;
  flightDone: () => void;
  skip: () => void;
  explode: () => void;
  reassemble: () => void;
  fail: (reason: ArrivalFailReason) => void;
  setReducedMotion: (v: boolean) => void;
  reset: () => void;
}

const INITIAL = {
  phase: "loading" as ArrivalPhase,
  failReason: null as ArrivalFailReason | null,
  reducedMotion: false,
};

export const useArrivalStore = create<ArrivalState>((set) => ({
  ...INITIAL,
  tilesReady: () =>
    set((st) =>
      st.phase === "loading"
        ? { phase: st.reducedMotion ? "arrived" : "flight" }
        : st,
    ),
  flightDone: () => set((st) => (st.phase === "flight" ? { phase: "arrived" } : st)),
  skip: () => set((st) => (st.phase === "flight" ? { phase: "arrived" } : st)),
  explode: () => set((st) => (st.phase === "arrived" ? { phase: "exploded" } : st)),
  reassemble: () => set((st) => (st.phase === "exploded" ? { phase: "arrived" } : st)),
  fail: (reason) =>
    set((st) =>
      st.phase === "fallback" ? st : { phase: "fallback", failReason: reason },
    ),
  setReducedMotion: (v) => set({ reducedMotion: v }),
  reset: () => set({ ...INITIAL }),
}));
```

- [ ] **Step 4: Run to verify pass.**

- [ ] **Step 5: Commit** (pathspec: `packages/web/src/pages/landing/arrival`), message `feat(arrival): phase machine with single-fallback failure edges`.

---

### Task 4: GoogleTilesStage — the world

**Files:**
- Create: `packages/web/src/pages/landing/arrival/GoogleTilesStage.tsx`
- Create: `packages/web/src/pages/landing/arrival/trades-hall-anchor.ts`
- Test: `packages/web/src/pages/landing/arrival/__tests__/GoogleTilesStage.test.tsx`

**Interfaces:**
- Consumes: `googleTilesApiKey()` (Task 1), `useArrivalStore` (Task 3), `3d-tiles-renderer/r3f` (`TilesRenderer`, `TilesPlugin`, `TilesAttributionOverlay`) and `3d-tiles-renderer/plugins` (`GoogleCloudAuthPlugin`, `ReorientationPlugin` — if `ReorientationPlugin` is not exported there, check the package's `exports` map; it lives in the repo's `src/three/plugins`).
- Produces: `<GoogleTilesStage apiToken={string} />` — mounted by Task 5 inside the Canvas; fires `useArrivalStore` `tilesReady()` / `fail("tiles")` itself. Also `TRADES_HALL_ANCHOR` and `TILES_READY_PROGRESS`.

- [ ] **Step 1: Anchor constant with provenance**

```ts
// packages/web/src/pages/landing/arrival/trades-hall-anchor.ts
/**
 * Trades Hall of Glasgow, 85 Glassford Street — the point ReorientationPlugin
 * pins to the scene origin (+Y up, cardinals aligned).
 *
 * PROVENANCE: seeded 2026-08-26 from the address's approximate map position;
 * CALIBRATED in plan Task 6/8 by eye against the rendered tiles (nudge tool),
 * then baked here with the calibration date. This file is the ONLY alignment
 * truth for the Arrival — never introduce a second anchor (spec §3).
 */
export const TRADES_HALL_ANCHOR = {
  latDeg: 55.859,
  lonDeg: -4.2474,
  heightM: 20,
  azimuthDeg: 0,
} as const;
```

- [ ] **Step 2: Write the failing component test**

Copy the R3F mock preamble style from `packages/web/src/twin/__tests__/DollhouseStage.test.tsx`, then:

```tsx
// packages/web/src/pages/landing/arrival/__tests__/GoogleTilesStage.test.tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { useArrivalStore } from "../arrival-store.js";

const seen = vi.hoisted(() => ({ plugins: [] as Array<{ plugin: { name: string }; args: unknown }> }));

vi.mock("3d-tiles-renderer/r3f", () => ({
  TilesRenderer: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="tiles-renderer">{children}</div>
  ),
  TilesPlugin: ({ plugin, args }: { plugin: { name: string }; args: unknown }) => {
    seen.plugins.push({ plugin, args });
    return null;
  },
  TilesAttributionOverlay: () => <div data-testid="attribution" />,
}));
vi.mock("3d-tiles-renderer/plugins", () => ({
  GoogleCloudAuthPlugin: class GoogleCloudAuthPlugin {},
  ReorientationPlugin: class ReorientationPlugin {},
}));

import { GoogleTilesStage } from "../GoogleTilesStage.js";

describe("GoogleTilesStage", () => {
  beforeEach(() => {
    useArrivalStore.getState().reset();
    seen.plugins.length = 0;
  });

  it("registers the Google auth plugin with the api token and the reorientation plugin", () => {
    render(<GoogleTilesStage apiToken="AIza-test" />);
    const names = seen.plugins.map((p) => p.plugin.name);
    expect(names).toContain("GoogleCloudAuthPlugin");
    expect(names).toContain("ReorientationPlugin");
    const auth = seen.plugins.find((p) => p.plugin.name === "GoogleCloudAuthPlugin");
    expect((auth?.args as { apiToken: string }).apiToken).toBe("AIza-test");
  });

  it("always renders the attribution overlay (Google ToS)", () => {
    const { getByTestId } = render(<GoogleTilesStage apiToken="AIza-test" />);
    expect(getByTestId("attribution")).toBeTruthy();
  });
});
```

(`useThree` must also be mocked — the DollhouseStage preamble shows the repo's way; `invalidate` can be a `vi.fn()`.)

- [ ] **Step 3: Run to verify it fails.**

- [ ] **Step 4: Implement**

```tsx
// packages/web/src/pages/landing/arrival/GoogleTilesStage.tsx
import { useEffect, useRef, type ReactElement } from "react";
import { useThree } from "@react-three/fiber";
import { MathUtils } from "three";
import {
  TilesAttributionOverlay,
  TilesPlugin,
  TilesRenderer,
} from "3d-tiles-renderer/r3f";
import { GoogleCloudAuthPlugin, ReorientationPlugin } from "3d-tiles-renderer/plugins";
import { useArrivalStore } from "./arrival-store.js";
import { TRADES_HALL_ANCHOR } from "./trades-hall-anchor.js";

// -----------------------------------------------------------------------------
// GoogleTilesStage — live Photorealistic 3D Tiles, reoriented so the Trades
// Hall anchor sits at the scene origin with +Y up. Event wiring, not polling:
//   load-error      → fail("tiles")   (spec §6 — single fallback)
//   tiles-load-end  → tilesReady()    (first idle = the flight may begin)
//   needs-update    → invalidate()    (demand-frameloop discipline)
// The attribution overlay is a Google ToS requirement — it ships in every
// phase and no prop may hide it.
// -----------------------------------------------------------------------------

/** How much of the start-pose tileset must be in before the dive begins. */
export const TILES_READY_PROGRESS = 0.85;

/** The event surface this stage needs from the tiles instance. */
interface TilesEvents {
  addEventListener: (type: string, cb: () => void) => void;
  removeEventListener: (type: string, cb: () => void) => void;
  loadProgress: number;
}

interface GoogleTilesStageProps {
  readonly apiToken: string;
}

export function GoogleTilesStage({ apiToken }: GoogleTilesStageProps): ReactElement {
  const invalidate = useThree((s) => s.invalidate);
  const tilesRef = useRef<TilesEvents | null>(null);

  useEffect(() => {
    const tiles = tilesRef.current;
    if (tiles === null) {
      return;
    }
    const { tilesReady, fail } = useArrivalStore.getState();
    let announced = false;
    const onLoadEnd = (): void => {
      if (!announced && tiles.loadProgress >= TILES_READY_PROGRESS) {
        announced = true;
        tilesReady();
      }
      invalidate();
    };
    const onError = (): void => {
      fail("tiles");
    };
    const onNeedsUpdate = (): void => {
      invalidate();
    };
    tiles.addEventListener("tiles-load-end", onLoadEnd);
    tiles.addEventListener("load-error", onError);
    tiles.addEventListener("needs-update", onNeedsUpdate);
    return () => {
      tiles.removeEventListener("tiles-load-end", onLoadEnd);
      tiles.removeEventListener("load-error", onError);
      tiles.removeEventListener("needs-update", onNeedsUpdate);
    };
  }, [invalidate]);

  return (
    <TilesRenderer ref={tilesRef as never}>
      <TilesPlugin plugin={GoogleCloudAuthPlugin} args={{ apiToken }} />
      <TilesPlugin
        plugin={ReorientationPlugin}
        args={{
          lat: MathUtils.degToRad(TRADES_HALL_ANCHOR.latDeg),
          lon: MathUtils.degToRad(TRADES_HALL_ANCHOR.lonDeg),
          height: TRADES_HALL_ANCHOR.heightM,
        }}
      />
      <TilesAttributionOverlay />
    </TilesRenderer>
  );
}
```

NOTE for the implementer: two API details are pinned by docs but must be confirmed against the installed 0.5.2 before this task's commit — (a) whether `ReorientationPlugin` takes these constructor args or requires calling `transformLatLonHeightToOrigin(lat, lon, height, azimuth, elevation, roll)` on the instance, and (b) whether lat/lon are radians or degrees. Read `node_modules/3d-tiles-renderer/src/three/plugins/ReorientationPlugin.js` directly (readable source ships in the package) and adjust the call site — the anchor file stays in degrees either way. Also confirm the R3F `TilesRenderer` forwards a ref to the tiles instance; if it uses a context instead, get the instance the documented way and keep the same event wiring.

- [ ] **Step 5: Run tests to verify pass; typecheck; commit** — message `feat(arrival): Google tiles stage anchored at Trades Hall`.

---

### Task 5: ArrivalHero + FreshPage hero integration

**Files:**
- Create: `packages/web/src/pages/landing/arrival/ArrivalHero.tsx`
- Create: `packages/web/src/pages/landing/arrival/arrival.css`
- Modify: `packages/web/src/pages/fresh/FreshPage.tsx` (hero section, lines ~701–740: inside `<div className="fr-hero-frame">`, after the existing `<img className="fr-hero-photo">`)
- Test: `packages/web/src/pages/landing/arrival/__tests__/ArrivalHero.test.tsx`

**Interfaces:**
- Consumes: Tasks 1–4 exports; `useDeviceStore` from `packages/web/src/stores/device-store.ts`.
- Produces: `export function ArrivalHero(): ReactElement | null` — self-gating; renders `null` on `fallback`/no-key so the photo beneath simply shows. `export const ARRIVAL_SKIP_LABEL = "Skip the flight";` (Tasks 12–13 hook on it).

- [ ] **Step 1: Write the failing tests** — with Canvas/stage mocked (DollhouseStage preamble), assert: (a) with no key (env unset) the component renders `null` and the store lands `fallback` with reason `no-key`; (b) with a key stubbed and the store forced to `flight`, a `button` with text `Skip the flight` exists and clicking it moves the store to `arrived`; (c) store forced to `fallback` renders `null`. Drive the store directly via `useArrivalStore.getState()` as in Task 3's tests; use `@testing-library/react` `render` + `fireEvent`.

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement the hero**

```tsx
// packages/web/src/pages/landing/arrival/ArrivalHero.tsx
import { useEffect, useRef, type ReactElement } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { googleTilesApiKey } from "./arrival-config.js";
import { useArrivalStore } from "./arrival-store.js";
import { GoogleTilesStage } from "./GoogleTilesStage.js";
import { ARRIVAL_RAIL, FLIGHT_DURATION_S, sampleRail } from "./camera-rail.js";
import "./arrival.css";

export const ARRIVAL_SKIP_LABEL = "Skip the flight";

/** Drives the camera along the rail while phase === "flight". */
function FlightCamera(): null {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const phase = useArrivalStore((s) => s.phase);
  const elapsed = useRef(0);

  useFrame((_, delta) => {
    if (phase !== "flight") {
      elapsed.current = 0;
      return;
    }
    elapsed.current += delta;
    const t = elapsed.current / FLIGHT_DURATION_S;
    const pose = sampleRail(ARRIVAL_RAIL, t);
    camera.position.copy(pose.position);
    camera.quaternion.copy(pose.quaternion);
    if (t >= 1) {
      useArrivalStore.getState().flightDone();
    }
    invalidate();
  });

  // Arrived/exploded hold the rail's final pose (explode framing is Task 10's).
  useEffect(() => {
    if (phase === "arrived" || phase === "exploded") {
      const pose = sampleRail(ARRIVAL_RAIL, 1);
      camera.position.copy(pose.position);
      camera.quaternion.copy(pose.quaternion);
      invalidate();
    }
  }, [phase, camera, invalidate]);
  return null;
}

export function ArrivalHero(): ReactElement | null {
  const phase = useArrivalStore((s) => s.phase);
  const apiToken = googleTilesApiKey();

  useEffect(() => {
    if (apiToken === null) {
      useArrivalStore.getState().fail("no-key");
    }
  }, [apiToken]);

  if (apiToken === null || phase === "fallback") {
    return null; // the static hero photo beneath carries the page (spec §6)
  }

  const animating = phase === "flight";
  return (
    <div className="arrival-hero" data-arrival-phase={phase}>
      <Canvas
        className="arrival-canvas"
        frameloop={animating ? "always" : "demand"}
        dpr={[1, 2]}
        gl={{ powerPreference: "high-performance" }}
        camera={{ fov: 45, near: 1, far: 60000 }}
        onCreated={({ gl }) => {
          gl.domElement.addEventListener("webglcontextlost", () => {
            useArrivalStore.getState().fail("webgl");
          });
        }}
      >
        <GoogleTilesStage apiToken={apiToken} />
        <FlightCamera />
      </Canvas>
      {phase === "flight" && (
        <button
          type="button"
          className="arrival-skip"
          onClick={() => {
            useArrivalStore.getState().skip();
          }}
        >
          {ARRIVAL_SKIP_LABEL}
        </button>
      )}
    </div>
  );
}
```

`arrival.css`: `.arrival-hero { position: absolute; inset: 0; }` filling `.fr-hero-frame` above the photo; `.arrival-skip` a bottom-right quiet pill in the /fresh sandstone language — read `packages/web/src/pages/fresh/fresh.css` and reuse its custom-property tokens; invent no colors.

- [ ] **Step 4: FreshPage wiring (surgical)**

In `FreshPage.tsx`, lazy the hero alongside the file's existing `lazy(...)` imports (top of file):

```tsx
const ArrivalHero = lazy(() =>
  import("../landing/arrival/ArrivalHero.js").then((m) => ({ default: m.ArrivalHero })),
);
```

and inside `.fr-hero-frame`, immediately after the `<img className="fr-hero-photo" …/>` (the img itself is untouched):

```tsx
<Suspense fallback={null}>
  <ArrivalHero />
</Suspense>
```

Check the dome-aperture comment block at `FreshPage.tsx:209-221` before positioning: the hero frame uses a top-anchored cover technique — the canvas overlay must not change the frame's box model (absolute inset-0 inside the existing relatively-positioned frame; add `position: relative` to `.fr-hero-frame` in `arrival.css` ONLY if it isn't already positioned — check `fresh.css` first).

- [ ] **Step 5: Run the arrival tests + the fresh page's existing test files; typecheck; commit** — message `feat(arrival): live hero canvas over the fresh photo, flight + skip`. Pathspec: the arrival dir + `packages/web/src/pages/fresh/FreshPage.tsx`.

---

### Task 6: CHECKPOINT M1 — live flight against real tiles (needs Blake's key)

**Blocked on:** `VITE_GOOGLE_MAPS_TILES_KEY` present in `packages/web/.env.local`. If absent, stop and report; do not fake this gate.

- [ ] **Step 1:** Start the dev stack via `.claude/launch.json`; open `http://localhost:5173/` in the Browser pane.
- [ ] **Step 2:** Confirm, with screenshots at loading/flight/arrived: tiles stream, the dive plays once tiles settle, skip works, the Google attribution overlay is visible, and zero console errors (`read_console_messages`).
- [ ] **Step 3:** Confirm the reoriented axes (which horizontal direction is north) and settle the Task 4 radians/degrees note. Tune `ARRIVAL_RAIL` until the flight visibly matches the reference footage beats (city-wide over the Clyde → dive → facade settle, dome centered — compare against the recording).
- [ ] **Step 4:** Remove the key from `.env.local` momentarily, reload, confirm the photo-only fallback renders with zero console errors, restore the key.
- [ ] **Step 5:** `pnpm --filter @omnitwin/web frame-budget` — record the result; investigate anything over the repo's standing budget before proceeding.
- [ ] **Step 6:** Commit tuned constants — message `feat(arrival): rail tuned against reference footage (M1 gate)`.

---

### Task 7: HallHandoff — the reveal

**Files:**
- Create: `packages/web/src/pages/landing/arrival/HallHandoff.tsx`
- Create: `packages/web/src/pages/landing/arrival/twin-placement.ts`
- Test: `packages/web/src/pages/landing/arrival/__tests__/twin-placement.test.ts`
- Modify: `packages/web/src/pages/landing/arrival/ArrivalHero.tsx` (mount `<HallHandoff />` when phase is `arrived`/`exploded`)

**Interfaces:**
- Consumes: `useTwinManifest` + `twinAssetBase` from `packages/web/src/twin/useTwinManifest.ts` (`twinAssetBase()` = `import.meta.env["VITE_TWIN_ASSET_BASE"] ?? "/twin"`, line 26); mesh URL exactly as `TwinViewer.tsx:1280` builds it: `` `${assetBase}/${manifest.mesh.path}` `` with `assetBase = ` `` `${twinAssetBase()}/trades-hall` `` (TwinPage pattern, `TwinPage.tsx:96`) and `manifest.mesh.path` the literal `"mesh/dollhouse.glb"` (`packages/types/src/twin.ts:70`); `useGLTF` + `MeshoptDecoder` configured exactly as `DollhouseStage.tsx:100-112` (`loader.setMeshoptDecoder(MeshoptDecoder)`); `applyDollhouseCaps(root)` (`dollhouse-peel.ts:224`, defaults are the Trades Hall rule), `pruneDollhouseShell(root)` (`dollhouse-shell.ts:1061`), `meshRootWorldMatrix()` (`dollhouse-peel.ts:149`) — call them, never edit them; `preloadDollhouse(meshUrl)` (`DollhouseStage.tsx:110`).
- Produces:

```ts
// twin-placement.ts
export interface TwinPlacement {
  readonly positionM: readonly [number, number, number]; // anchor-local meters
  readonly headingRad: number;                            // yaw about +Y
}
export const TRADES_HALL_TWIN_PLACEMENT: TwinPlacement;   // seeded zeros, calibrated Task 8
export function twinPlacementMatrix(p: TwinPlacement): Matrix4;
// HallHandoff.tsx
export function HallHandoff(): ReactElement | null;       // self-gates on phase
export const HANDOFF_FADE_SPRING: SpringConfig;           // exported for tests
```

- [ ] **Step 1: TDD `twinPlacementMatrix`** — failing tests asserting: zero placement returns exactly `meshRootWorldMatrix()` (compare elements); a pure translation placement shifts the matrix's position column by that translation; `headingRad: Math.PI / 2` rotates the basis so local +X maps to world −Z (three.js yaw). Implementation: `new Matrix4().makeRotationY(p.headingRad).setPosition(new Vector3(...p.positionM)).multiply(meshRootWorldMatrix())` — the twin basis stays the single inner truth (spec §3), the placement is an outer transform.
- [ ] **Step 2: Implement `HallHandoff`** — mirror `DollhouseStage`'s internal mesh component structure: `useGLTF(meshUrl, true, true, (loader) => { loader.setMeshoptDecoder(MeshoptDecoder); })`, clone the scene, run `applyDollhouseCaps(clone)` then `pruneDollhouseShell(clone)` once in a `useMemo`, mount under `<group matrixAutoUpdate={false} matrix={twinPlacementMatrix(TRADES_HALL_TWIN_PLACEMENT)}>`. Crossfade on entering `arrived`: one `SpringState` 0→1 stepped in `useFrame` via `stepSpring(fade, 1, delta, HANDOFF_FADE_SPRING)` with `HANDOFF_FADE_SPRING = { stiffness: 60, damping: 14 }` (slow reveal, tuned at gate); while fading, traverse chunk materials setting `transparent = true; opacity = fade.value; needsUpdate` as required; when `isSpringSettled(fade, 1)`, set `transparent = false; opacity = 1` (kills alpha-sort cost) and stop invalidating. NEVER touch `material.side` (peel law). Manifest: `useTwinManifest("trades-hall")` — render nothing until `state === "ready"`; on `"error"` render nothing and `console.warn` once (the tiles building simply remains; the hero survives without the twin).
- [ ] **Step 3: Warm during flight** — in `ArrivalHero`, when phase enters `flight` and the manifest is ready, call `preloadDollhouse(meshUrl)` so arrival never pops.
- [ ] **Step 4: Component test** with mocked `useGLTF`/`useTwinManifest` (DollhouseStage preamble): asserts caps+prune called exactly once per load, opacity ramps on arrival, materials end opaque with `transparent === false`.
- [ ] **Step 5: Run, typecheck, commit** — `feat(arrival): twin dollhouse crossfade at landing`.

---

### Task 8: CHECKPOINT M2 — bake the placement calibration (needs key + local twin assets)

- [ ] **Step 1:** Add a dev-only nudge hook in `HallHandoff` gated by `import.meta.env.DEV && new URLSearchParams(window.location.search).has("calibrate")`: arrow keys move `positionM` x/z by 0.5 m (Shift: 0.1 m), PageUp/Down move y, `[` / `]` rotate heading by 0.5°, every change `console.info`s the full placement literal ready to paste.
- [ ] **Step 2:** Live-calibrate at `http://localhost:5173/?calibrate` until the twin mesh sits on its tile footprint — walls parallel to Glassford/Garth streets, twin dome over the tile dome.
- [ ] **Step 3:** Paste the logged literal into `TRADES_HALL_TWIN_PLACEMENT`; update its provenance comment with today's date and "calibrated by eye against Google tiles"; update `TRADES_HALL_ANCHOR` the same way if it moved.
- [ ] **Step 4:** Screenshot the aligned reveal; run `pnpm --filter @omnitwin/web visual-check`; commit — `feat(arrival): baked twin placement calibration (M2 gate)`.

---

### Task 9: Storey bucketing — pure module

**Files:**
- Create: `packages/web/src/pages/landing/arrival/storey-explode.ts`
- Test: `packages/web/src/pages/landing/arrival/__tests__/storey-explode.test.ts`

**Interfaces:**
- Consumes: nothing at runtime — pure. Callers map manifest nodes to `{ floor, yMeters }` (Task 10 does the `e57PointToThree` conversion exactly as `FloorConstellation.tsx` documents at its §2 comment).
- Produces:

```ts
export interface StoreySample { readonly floor: number; readonly yMeters: number; }
/** Sorted unique floors present in the samples. */
export function storeyFloors(samples: readonly StoreySample[]): readonly number[];
/** Boundary Ys between adjacent storeys: midpoints of neighbouring floors' mean sample heights. Length = floors.length - 1. */
export function storeyBoundaries(samples: readonly StoreySample[]): readonly number[];
/** Bucket a world-space centroid Y into a storey index (0-based from the lowest floor). */
export function bucketForY(y: number, boundaries: readonly number[]): number;
/** Vertical explode offset for a bucket at explode progress 0..1. */
export function explodeOffsetY(bucket: number, progress: number, separationM: number): number;
```

- [ ] **Step 1: Failing tests**

```ts
// packages/web/src/pages/landing/arrival/__tests__/storey-explode.test.ts
import { describe, expect, it } from "vitest";
import {
  bucketForY, explodeOffsetY, storeyBoundaries, storeyFloors,
} from "../storey-explode.js";

const SAMPLES = [
  { floor: 0, yMeters: 1.4 }, { floor: 0, yMeters: 1.6 },
  { floor: 1, yMeters: 6.9 }, { floor: 1, yMeters: 7.1 },
  { floor: 2, yMeters: 12.5 },
];

describe("storey bucketing", () => {
  it("finds sorted unique floors", () => {
    expect(storeyFloors(SAMPLES)).toEqual([0, 1, 2]);
  });
  it("boundaries are midpoints of neighbouring mean heights", () => {
    expect(storeyBoundaries(SAMPLES)).toEqual([4.25, 9.75]);
  });
  it("buckets below, between, and above all boundaries", () => {
    const b = storeyBoundaries(SAMPLES);
    expect(bucketForY(0.2, b)).toBe(0);
    expect(bucketForY(5.0, b)).toBe(1);
    expect(bucketForY(30, b)).toBe(2);
  });
  it("offset scales with bucket and progress; ground floor never moves", () => {
    expect(explodeOffsetY(0, 1, 6)).toBe(0);
    expect(explodeOffsetY(2, 0.5, 6)).toBe(6);
    expect(explodeOffsetY(2, 1, 6)).toBe(12);
  });
  it("single-floor building yields no boundaries and bucket 0 for any y", () => {
    expect(storeyBoundaries([{ floor: 0, yMeters: 2 }])).toEqual([]);
    expect(bucketForY(99, [])).toBe(0);
  });
});
```

- [ ] **Step 2: Run to fail.**
- [ ] **Step 3: Implement** — one pass computing per-floor mean heights (sorted by floor), boundaries as midpoints of adjacent means, `bucketForY` = count of boundaries strictly below `y`, `explodeOffsetY = bucket * progress * separationM`.
- [ ] **Step 4: Run to pass.**
- [ ] **Step 5: Commit** — `feat(arrival): storey bucketing math from manifest floor samples`.

---

### Task 10: ExplodedHall — click, springs, labels, CTAs

**Files:**
- Create: `packages/web/src/pages/landing/arrival/ExplodedHall.tsx`
- Modify: `packages/web/src/pages/landing/arrival/HallHandoff.tsx` (the loaded clone is shared — storey grouping hooks in here)
- Modify: `packages/web/src/pages/landing/arrival/ArrivalHero.tsx` (DOM label/CTA layer)
- Test: `packages/web/src/pages/landing/arrival/__tests__/ExplodedHall.test.tsx`

**Interfaces:**
- Consumes: Task 9 functions; `stepSpring`/`isSpringSettled`; `diveClickGuard` from `DollhouseStage.tsx:89` (reuse verbatim for click-vs-drag); manifest nodes (`TwinScanNode.floor: number` int, `packages/types/src/twin.ts:46`) with positions converted via `e57PointToThree` exactly as `FloorConstellation.tsx` does (read its conversion call and mirror it); `useNavigate` from `react-router-dom` — routes `/tour` (TwinPage flagship, `router.tsx:475`) and `/plan`.
- Produces: per-storey `Group`s inside the placement group; DOM labels `data-arrival-storey={n}` rendered in `ArrivalHero`'s overlay (NOT drei `<Html>` — labels live in the hero's DOM layer, positioned from projected storey centroids on animated frames; keeps the canvas dependency-light and labels accessible). Exported: `ARRIVAL_STOREY_LABELS: readonly string[]`, `STOREY_SEPARATION_M = 5`, `EXPLODE_SPRING: SpringConfig`.

- [ ] **Step 1:** On first entry to `exploded`: walk the loaded clone's chunk meshes once, compute each chunk's world bounding-box centroid Y (`geometry.boundingBox`, computing it when null, transformed by the chunk's world matrix), bucket via Task 9 (samples from manifest nodes: `{ floor: node.floor, yMeters: <e57PointToThree-converted pose>.y }`), and reparent chunks into per-storey `Group`s. Reparenting whole meshes is peel-safe: the facing split and caps happened at load and travel with the geometry.
- [ ] **Step 2:** One `SpringState` for explode progress (0⇄1), `EXPLODE_SPRING = { stiffness: 120, damping: 20 }` seed; `useFrame` steps toward the phase target (`exploded` → 1, `arrived` → 0), sets each storey group's `position.y = explodeOffsetY(bucket, progress, STOREY_SEPARATION_M)`, invalidates while unsettled. `ArrivalHero`'s frameloop condition extends `always` to "explode spring unsettled".
- [ ] **Step 3:** Pointer: clicking the assembled hall (any chunk, via `diveClickGuard`) → `explode()`. In `exploded`: storey click → `navigate("/tour")`; per-label DOM button "Plan this room" → `navigate("/plan")`; a "Close" control → `reassemble()`. Storey copy in `ARRIVAL_STOREY_LABELS` — VERIFY the floor numbering against the full comment at `TwinViewer.tsx:116` ("manifest floor 0 is the building's …") before writing label text; the labels must name real rooms per storey (Grand Hall, Saloon, Reception Room, Robert Adam Room) in House vocabulary.
- [ ] **Step 4:** Tests: bucket-and-reparent integration on a synthetic `Group` of box meshes at three heights (assert group membership and settled offsets); spring target follows phase; `diveClickGuard` refuses an 11 px drag (`delta: 11`); navigation spies fire per CTA (`vi.mock("react-router-dom")` for `useNavigate`).
- [ ] **Step 5:** Run, typecheck, commit — `feat(arrival): the Hall explodes into storeys`.

---

### Task 11: CHECKPOINT M3 — explode gate + peel regression

- [ ] **Step 1:** Live: click → explode → storeys separate and settle on springs, labels track their storeys, close reassembles exactly (screenshot each state).
- [ ] **Step 2:** Run `pnpm --filter @omnitwin/web visual-check` AND the dollhouse absence instrument (the validated instrument from the dollhouse saga — locate its invocation via `docs/handoffs/TWIN-STATUS.md`'s lane map / `packages/web/scripts/`; its numeric acceptance bars must not regress — spec §7).
- [ ] **Step 3:** Full verify chain (types build → web typecheck → full web test → build with the Clerk stub var). Commit tuning — `feat(arrival): explode gate passed, peel bars hold (M3)`.

---

### Task 12: Fallback armor

**Files:**
- Create: `packages/web/src/pages/landing/arrival/use-arrival-gate.ts`
- Modify: `packages/web/src/pages/landing/arrival/ArrivalHero.tsx`
- Test: `packages/web/src/pages/landing/arrival/__tests__/use-arrival-gate.test.ts`

**Interfaces:**
- Consumes: `useDeviceStore` from `packages/web/src/stores/device-store.ts` (`tier` includes `"poster"`; tests use `override("poster")` per `device-store.test.ts:50`); the reduced-motion helper from `packages/web/src/twin/reduced-motion.ts` (read the file, reuse its export — do not re-implement matchMedia).
- Produces: `useArrivalGate(): { blocked: ArrivalFailReason | null }` — evaluated before the Canvas mounts.

- [ ] **Step 1: Failing tests:** poster tier → `blocked: "poster-tier"`; missing key → `"no-key"`; healthy → `null`; reduced-motion is NOT a block — it must call `setReducedMotion(true)` so the machine skips flight (spec §2).
- [ ] **Step 2: Implement** the hook; `ArrivalHero` consumes it: `blocked !== null` → `fail(blocked)` once (in an effect) and render `null`. Keep Task 5's `webglcontextlost → fail("webgl")` and Task 4's `load-error → fail("tiles")`. When `fallback` arrives while the canvas WAS rendering, fade `.arrival-hero` to opacity 0 over 300 ms via `[data-arrival-phase="fallback"]` CSS before unmount (spec §6 "holds briefly, then fades" — a phase-driven `onTransitionEnd` unmount).
- [ ] **Step 3:** Every `ArrivalFailReason` value has a test landing phase `fallback` with the canvas gone. Run, commit — `feat(arrival): full fallback matrix, the photo never breaks`.

---

### Task 13: E2E + visual phases

**Files:**
- Create: `packages/web/e2e/arrival.spec.ts` — follow the GPU recipe (serial mode, own file, no `page.evaluate` after heavy readback); copy the header discipline from an existing twin spec in `packages/web/e2e/`.
- Modify: `packages/web/scripts/visual-check.mjs` shot list IF the harness enumerates targets (read the script first).

- [ ] **Step 1:** Spec cases, each its own serial test: (a) keyless env → photo hero visible, no `.arrival-hero`, zero console errors; (b) `prefers-reduced-motion` emulation → `[data-arrival-phase="arrived"]` appears without a flight; (c) keyed runs guarded by `test.skip(process.env["VITE_GOOGLE_MAPS_TILES_KEY"] === undefined, "needs tiles key")`: skip button (`Skip the flight`) appears then the page lands `arrived`; the Google attribution node is present (ToS assertion); clicking the hall yields `[data-arrival-storey]` labels.
- [ ] **Step 2:** Run per-file per the recipe: `pnpm --filter @omnitwin/web e2e -- arrival.spec.ts` (confirm per-file syntax against existing usage and `package.json:15`).
- [ ] **Step 3:** Commit — `test(arrival): e2e phases incl. keyless fallback and attribution`.

---

### Task 14: Performance + bundle discipline

- [ ] **Step 1:** Confirm the hero is its own chunk: `VITE_CLERK_PUBLISHABLE_KEY=pk_live_localbuildcheck pnpm --filter @omnitwin/web build`; inspect the emitted chunk list — `3d-tiles-renderer` must NOT be in the entry chunk (it rides the lazy `ArrivalHero` chunk). Record the entry-chunk size delta vs `master` (target ≈ 0 beyond the lazy shim).
- [ ] **Step 2:** `pnpm --filter @omnitwin/web frame-budget` during flight and exploded hold. If over budget, first levers: an `errorTarget={ARRIVAL_ERROR_TARGET}` prop on `<TilesRenderer>` (exported constant, seed 12 — higher = coarser/fewer tiles) and the `dpr` cap.
- [ ] **Step 3:** Confirm the kill-switch: deleting the env key cleanly disables the feature (the `no-key` path) — note it in Task 15's ops doc.
- [ ] **Step 4:** Commit tuning — `perf(arrival): chunking + tile error budget`.

---

### Task 15: STOP-GATE — licensing, pricing, ops doc

- [ ] **Step 1:** Research with primary sources (WebFetch on Google Maps Platform docs/ToS pages): Photorealistic 3D Tiles commercial-use terms for a marketing homepage; attribution requirements (confirm our overlay satisfies them); whether capturing promotional video from your own Map Tiles application is permitted; current pricing SKU + free tier for root tileset and tile requests.
- [ ] **Step 2:** Write `docs/operations/arrival-google-tiles.md`: findings WITH dated citations, estimated cost per 1k homepage sessions, key-restriction checklist (referer lock, restrict key to Map Tiles API only), the env kill-switch, the attribution audit result.
- [ ] **Step 3:** **If any finding blocks homepage use or video capture: STOP and escalate to Blake before Task 16.** Report the finding literally — no softening (Blake Clause).
- [ ] **Step 4:** Commit the doc — `docs(arrival): Google tiles licensing, pricing, and ops runbook`.

---

### Task 16: Production wiring (Blake-dependent)

- [ ] **Step 1:** Blake actions (report and wait; never fake): create the restricted production key; add `VITE_GOOGLE_MAPS_TILES_KEY` to the Vercel env; decide twin-asset hosting and set `VITE_TWIN_ASSET_BASE` — the hero needs ONLY the manifest + the ~7 MB meshopt dollhouse GLB served publicly (`DollhouseStage.tsx:43`); walk imagery is not required for the hero.
- [ ] **Step 2:** After envs land: Vercel preview deploy; run Task 13's e2e against the preview URL; screenshot all phases on the deployed host.
- [ ] **Step 3:** Update the ops doc's deployment checklist as executed; commit.

---

### Task 17: Cinema capture — the marketing cut

- [ ] **Step 1:** Add `?cinema` handling in `ArrivalHero` (dev/preview): hides the skip button and DOM labels. The attribution overlay STAYS unless Task 15 explicitly cleared its removal for capture (default: it stays in frame).
- [ ] **Step 2:** Record: 4K window, `?cinema`, OS-level capture (Game Bar / OBS — Blake's choice), one take loading → flight → arrived → explode → reassemble.
- [ ] **Step 3:** Hand the raw capture path to Blake for the DaVinci grade (his `D:\Davinci exports\` workflow). Done = raw file delivered + one line in the day's session log.

---

## Self-review record (kept per writing-plans)

- **Spec coverage:** §2 acts → Tasks 4/5/7/10; §3 modules → Tasks 1–5, 7, 9, 10; §4 constraints → Global Constraints + Tasks 7/10/11; §5 dependencies → Tasks 6/15/16; §6 fallback → Tasks 5/12; §7 testing → Tasks 2/3/9/10/13 + gates 6/8/11; §8 YAGNI honored (no free-roam controls, no audio, no scroll-scrub); §9 milestones → gates 6/8/11 and Tasks 14–17.
- **Type consistency:** `ArrivalPhase`/`ArrivalFailReason` (Task 3) used by 4/5/12; `RailKeyframe`/`sampleRail` (Task 2) used by 5; `TwinPlacement`/`twinPlacementMatrix` (Task 7) used by 10; `StoreySample` API (Task 9) used by 10; `ARRIVAL_SKIP_LABEL` (Task 5) used by 13.
- **Known deliberate verifications (not placeholders):** ReorientationPlugin arg shape + radians/degrees (Task 4 pins the exact source file to read); storey label copy (Task 10 pins `TwinViewer.tsx:116` as the naming truth); absence-instrument invocation (Task 11 pins where to find it); e2e per-file syntax (Task 13 pins `package.json:15`).
