# Planner Cockpit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the existing `/dev/trades-hall-visual` cockpit into the real planner at `/plan`, merging the cockpit chrome with the live editable scene and wiring every control to real functions — at SS++ tier.

**Architecture:** One editable R3F `<Canvas>` (extracted from `App.tsx` into `PlannerScene`) lives in the stage cell of a CSS-grid cockpit shell (`PlannerCockpit`). A small `cockpit-store` (Zustand) holds interaction state (active lens, layer mode, overlay visibility, selected phase). Chrome regions (top bar, nav rail, Truth rail, phase strip) bind to real data with SAFE fixtures only as labeled fallbacks. Overlays move inside the canvas so they track the camera.

**Tech Stack:** TypeScript strict, React, @react-three/fiber + drei, Zustand, Vitest + @testing-library/react (happy-dom), Spark 2.0 for splats.

**Reference spec:** `docs/superpowers/specs/2026-06-13-planner-cockpit-design.md`

---

## Pre-flight (read before Task 1)

- **Branch:** The working tree is on `fix/hallkeeper-offline-sync-dataloss` with unrelated strand changes staged. Before starting, **ask Blake** whether to branch (`feat/planner-cockpit`) off `master` or continue here. Do not commit other strands' files. (House rule: commit only when Blake asks.)
- **Scope of this plan = Phase 1 only** (Shell + route swap). Phases 2–5 (wire chrome / overlays+spatial evidence / wow+accelerators / verify+tests+docs) get their own plans written when Phase 1 is green. This keeps each plan's code real.
- **Verify chain (run from repo root after each task that touches `packages/web`):**
  - `pnpm --filter @omnitwin/types build` (web typecheck needs the `.d.ts`)
  - `pnpm --filter @omnitwin/web typecheck`
  - `pnpm --filter @omnitwin/web test -- run <test-file>` for the task's test
  - `pnpm --filter @omnitwin/web lint` before commit
- **Windows/Vitest note:** per `.claude/gotchas/windows-v8-heap.md`, run web tests filtered to the file under test, not the whole suite, while iterating.

---

## Task 1: Cockpit mode/overlay/layer constants (pure data)

Canonical source of the 8 lenses, 6 overlays, and 3 layer modes, decoupled from the dev page's `trades-hall-visual-demo-state.ts`.

**Files:**
- Create: `packages/web/src/lib/cockpit-modes.ts`
- Test: `packages/web/src/lib/__tests__/cockpit-modes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  COCKPIT_MODES,
  COCKPIT_OVERLAY_KEYS,
  COCKPIT_LAYER_MODES,
  isCockpitMode,
} from "../cockpit-modes.js";

describe("cockpit-modes", () => {
  it("exposes the eight lenses in nav order with labels", () => {
    expect(COCKPIT_MODES.map((m) => m.id)).toEqual([
      "design", "guests", "flow", "evidence", "lighting", "ops", "costs", "share",
    ]);
    expect(COCKPIT_MODES.every((m) => m.label.length > 0)).toBe(true);
  });

  it("exposes overlay keys and layer modes", () => {
    expect(COCKPIT_OVERLAY_KEYS).toContain("guestFlow");
    expect(COCKPIT_OVERLAY_KEYS).toContain("densityHeatmap");
    expect(COCKPIT_LAYER_MODES).toEqual(["mesh", "splat", "hybrid"]);
  });

  it("narrows arbitrary strings with isCockpitMode", () => {
    expect(isCockpitMode("flow")).toBe(true);
    expect(isCockpitMode("nope")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @omnitwin/web test -- run src/lib/__tests__/cockpit-modes.test.ts`
Expected: FAIL — "Cannot find module '../cockpit-modes.js'".

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/web/src/lib/cockpit-modes.ts
// Canonical lens / overlay / layer vocabulary for the planner cockpit.
// Kept free of React + icon imports so it is unit-testable and importable
// by the store. Icon mapping lives in the nav-rail component.

export const COCKPIT_MODES = [
  { id: "design", label: "Design" },
  { id: "guests", label: "Guests" },
  { id: "flow", label: "Flow" },
  { id: "evidence", label: "Evidence" },
  { id: "lighting", label: "Lighting" },
  { id: "ops", label: "Ops" },
  { id: "costs", label: "Costs" },
  { id: "share", label: "Share" },
] as const;

export type CockpitMode = (typeof COCKPIT_MODES)[number]["id"];

export const COCKPIT_OVERLAY_KEYS = [
  "guestFlow",
  "routeClearance",
  "heritageBuffer",
  "densityHeatmap",
  "lightingProbes",
  "agentReplay",
] as const;

export type CockpitOverlayKey = (typeof COCKPIT_OVERLAY_KEYS)[number];

export const COCKPIT_LAYER_MODES = ["mesh", "splat", "hybrid"] as const;
export type CockpitLayerMode = (typeof COCKPIT_LAYER_MODES)[number];

export function isCockpitMode(value: string): value is CockpitMode {
  return COCKPIT_MODES.some((mode) => mode.id === value);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @omnitwin/web test -- run src/lib/__tests__/cockpit-modes.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/cockpit-modes.ts packages/web/src/lib/__tests__/cockpit-modes.test.ts
git commit -m "feat(web): add canonical cockpit mode/overlay/layer constants"
```

---

## Task 2: Cockpit interaction store (Zustand, pure)

Holds the chrome↔scene shared state so regions stay in sync without prop-drilling.

**Files:**
- Create: `packages/web/src/stores/cockpit-store.ts`
- Test: `packages/web/src/stores/__tests__/cockpit-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it } from "vitest";
import { useCockpitStore } from "../cockpit-store.js";

afterEach(() => { useCockpitStore.getState().reset(); });

describe("cockpit-store", () => {
  it("defaults to design lens, hybrid layer, all overlays on, no phase", () => {
    const s = useCockpitStore.getState();
    expect(s.activeMode).toBe("design");
    expect(s.layerMode).toBe("hybrid");
    expect(s.overlayVisibility.guestFlow).toBe(true);
    expect(s.selectedPhaseId).toBeNull();
  });

  it("setMode switches the active lens", () => {
    useCockpitStore.getState().setMode("flow");
    expect(useCockpitStore.getState().activeMode).toBe("flow");
  });

  it("setLayerMode switches the renderer layer", () => {
    useCockpitStore.getState().setLayerMode("splat");
    expect(useCockpitStore.getState().layerMode).toBe("splat");
  });

  it("toggleOverlay flips a single overlay without touching others", () => {
    useCockpitStore.getState().toggleOverlay("densityHeatmap");
    const v = useCockpitStore.getState().overlayVisibility;
    expect(v.densityHeatmap).toBe(false);
    expect(v.guestFlow).toBe(true);
  });

  it("selectPhase records the chosen phase id", () => {
    useCockpitStore.getState().selectPhase("dinner");
    expect(useCockpitStore.getState().selectedPhaseId).toBe("dinner");
  });

  it("reset restores defaults", () => {
    const api = useCockpitStore.getState();
    api.setMode("ops");
    api.setLayerMode("mesh");
    api.toggleOverlay("guestFlow");
    api.selectPhase("ceremony");
    api.reset();
    const s = useCockpitStore.getState();
    expect(s.activeMode).toBe("design");
    expect(s.layerMode).toBe("hybrid");
    expect(s.overlayVisibility.guestFlow).toBe(true);
    expect(s.selectedPhaseId).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @omnitwin/web test -- run src/stores/__tests__/cockpit-store.test.ts`
Expected: FAIL — "Cannot find module '../cockpit-store.js'".

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/web/src/stores/cockpit-store.ts
import { create } from "zustand";
import {
  COCKPIT_OVERLAY_KEYS,
  type CockpitLayerMode,
  type CockpitMode,
  type CockpitOverlayKey,
} from "../lib/cockpit-modes.js";

type OverlayVisibility = Record<CockpitOverlayKey, boolean>;

function allOverlaysOn(): OverlayVisibility {
  return COCKPIT_OVERLAY_KEYS.reduce<OverlayVisibility>((acc, key) => {
    acc[key] = true;
    return acc;
  }, {} as OverlayVisibility);
}

interface CockpitState {
  readonly activeMode: CockpitMode;
  readonly layerMode: CockpitLayerMode;
  readonly overlayVisibility: OverlayVisibility;
  readonly selectedPhaseId: string | null;
  readonly setMode: (mode: CockpitMode) => void;
  readonly setLayerMode: (mode: CockpitLayerMode) => void;
  readonly toggleOverlay: (key: CockpitOverlayKey) => void;
  readonly setOverlay: (key: CockpitOverlayKey, visible: boolean) => void;
  readonly selectPhase: (phaseId: string | null) => void;
  readonly reset: () => void;
}

export const useCockpitStore = create<CockpitState>((set) => ({
  activeMode: "design",
  layerMode: "hybrid",
  overlayVisibility: allOverlaysOn(),
  selectedPhaseId: null,
  setMode: (mode) => { set({ activeMode: mode }); },
  setLayerMode: (mode) => { set({ layerMode: mode }); },
  toggleOverlay: (key) => {
    set((state) => ({
      overlayVisibility: { ...state.overlayVisibility, [key]: !state.overlayVisibility[key] },
    }));
  },
  setOverlay: (key, visible) => {
    set((state) => ({
      overlayVisibility: { ...state.overlayVisibility, [key]: visible },
    }));
  },
  selectPhase: (phaseId) => { set({ selectedPhaseId: phaseId }); },
  reset: () => {
    set({
      activeMode: "design",
      layerMode: "hybrid",
      overlayVisibility: allOverlaysOn(),
      selectedPhaseId: null,
    });
  },
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @omnitwin/web test -- run src/stores/__tests__/cockpit-store.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/stores/cockpit-store.ts packages/web/src/stores/__tests__/cockpit-store.test.ts
git commit -m "feat(web): add cockpit interaction store"
```

---

## Task 3: Cockpit nav rail (8 lenses, wired to the store)

**Files:**
- Create: `packages/web/src/components/editor/cockpit/CockpitNavRail.tsx`
- Test: `packages/web/src/components/editor/cockpit/__tests__/CockpitNavRail.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useCockpitStore } from "../../../../stores/cockpit-store.js";
import { CockpitNavRail } from "../CockpitNavRail.js";

afterEach(() => { cleanup(); useCockpitStore.getState().reset(); });

describe("CockpitNavRail", () => {
  it("renders eight lens buttons with Design pressed by default", () => {
    render(<CockpitNavRail />);
    const buttons = screen.getAllByRole("button", { name: /design|guests|flow|evidence|lighting|ops|costs|share/i });
    expect(buttons.length).toBeGreaterThanOrEqual(8);
    expect(screen.getByRole("button", { name: /design/i }).getAttribute("aria-pressed")).toBe("true");
  });

  it("switches the active lens in the store on click", () => {
    render(<CockpitNavRail />);
    fireEvent.click(screen.getByRole("button", { name: /flow/i }));
    expect(useCockpitStore.getState().activeMode).toBe("flow");
    expect(screen.getByRole("button", { name: /flow/i }).getAttribute("aria-pressed")).toBe("true");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @omnitwin/web test -- run src/components/editor/cockpit/__tests__/CockpitNavRail.test.tsx`
Expected: FAIL — "Cannot find module '../CockpitNavRail.js'".

- [ ] **Step 3: Write minimal implementation**

```tsx
// packages/web/src/components/editor/cockpit/CockpitNavRail.tsx
import { type ReactElement } from "react";
import {
  Box, Users, Waypoints, FileCheck2, Lightbulb, ClipboardList,
  CircleDollarSign, Share2, type LucideIcon,
} from "lucide-react";
import { COCKPIT_MODES, type CockpitMode } from "../../../lib/cockpit-modes.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";

const MODE_ICONS: Readonly<Record<CockpitMode, LucideIcon>> = {
  design: Box,
  guests: Users,
  flow: Waypoints,
  evidence: FileCheck2,
  lighting: Lightbulb,
  ops: ClipboardList,
  costs: CircleDollarSign,
  share: Share2,
};

export function CockpitNavRail(): ReactElement {
  const activeMode = useCockpitStore((s) => s.activeMode);
  const setMode = useCockpitStore((s) => s.setMode);
  return (
    <nav className="cockpit-rail" aria-label="Planner lenses" data-testid="cockpit-rail">
      <div className="cockpit-rail__list">
        {COCKPIT_MODES.map((mode) => {
          const Icon = MODE_ICONS[mode.id];
          const active = mode.id === activeMode;
          return (
            <button
              key={mode.id}
              type="button"
              className={active ? "cockpit-rail__button is-active" : "cockpit-rail__button"}
              aria-pressed={active}
              onClick={() => { setMode(mode.id); }}
            >
              <Icon size={20} aria-hidden="true" />
              <span>{mode.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @omnitwin/web test -- run src/components/editor/cockpit/__tests__/CockpitNavRail.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/editor/cockpit/CockpitNavRail.tsx packages/web/src/components/editor/cockpit/__tests__/CockpitNavRail.test.tsx
git commit -m "feat(web): add cockpit nav rail wired to cockpit store"
```

---

## Task 4: Extract `PlannerScene` from `App.tsx` (pure refactor)

Move the `<Canvas>` block out of `App.tsx` into a focused component so the cockpit can mount the live editable scene in its stage cell. **No behavior change** — the regression guard is the existing web suite + typecheck.

**Files:**
- Create: `packages/web/src/components/editor/PlannerScene.tsx`
- Modify: `packages/web/src/App.tsx` (replace the inline `<Canvas>…</Canvas>` with `<PlannerScene />`)
- Test: `packages/web/src/components/editor/__tests__/PlannerScene.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

// Mock the R3F Canvas to render children into a div (no WebGL in happy-dom).
vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="r3f-canvas">{children}</div>
  ),
}));
// Mock the heavy scene children so the test stays a structural smoke test.
vi.mock("../../PlannerCanvasBoundary.js", () => ({
  PlannerCanvasBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../../SceneProvider.js", () => ({ SceneProvider: () => null }));
vi.mock("../../CameraRig.js", () => ({ CameraRig: () => null }));

const { PlannerScene } = await import("../PlannerScene.js");

describe("PlannerScene", () => {
  it("mounts an R3F canvas", () => {
    const { getByTestId } = render(<PlannerScene />);
    expect(getByTestId("r3f-canvas")).toBeTruthy();
  });
});
```

> Note: the mock list above covers the children referenced during render. If `tsc`/test reports another child importing WebGL at module load, add a matching `vi.mock` line for it — keep the mocks structural.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @omnitwin/web test -- run src/components/editor/__tests__/PlannerScene.test.tsx`
Expected: FAIL — "Cannot find module '../PlannerScene.js'".

- [ ] **Step 3: Create `PlannerScene.tsx` by moving the Canvas block from `App.tsx`**

Cut the `<Canvas frameloop="demand" …> … </Canvas>` element (currently `App.tsx:123-158`) and the `useRoomDimensions` hook + room-geometry derivation it depends on into the new component. Result:

```tsx
// packages/web/src/components/editor/PlannerScene.tsx
import { useMemo, type ReactElement } from "react";
import { Canvas } from "@react-three/fiber";
import type { SpaceDimensions } from "@omnitwin/types";
import { GRAND_HALL_RENDER_DIMENSIONS, scaleForRendering } from "../../constants/scale.js";
import { PlannerCanvasBoundary } from "../PlannerCanvasBoundary.js";
import { CameraRig } from "../CameraRig.js";
import { GrandHallRoom } from "../GrandHallRoom.js";
import { RoomMesh } from "./RoomMesh.js";
import { SectionPlane } from "../SectionPlane.js";
import { InvalidateOnToggle, AutoWallSelector } from "../WallTogglePanel.js";
import { XrayToggle } from "../XrayToggle.js";
import { MeasurementTool } from "../MeasurementTool.js";
import { TapeMeasure } from "../TapeMeasure.js";
import { PlacementGhost } from "../PlacementGhost.js";
import { DiagramLabels } from "../DiagramLabels.js";
import { PlacedFurniture } from "../PlacedFurniture.js";
import { SelectionSystem } from "../SelectionSystem.js";
import { MarqueeSelect } from "../MarqueeSelect.js";
import { SnapGuides } from "../SnapGuides.js";
import { CirculationOverlay } from "../CirculationOverlay.js";
import { MarkupLayer } from "../MarkupLayer.js";
import { SceneProvider } from "../SceneProvider.js";
import { PerfMonitor } from "../PerfMonitor.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { computeBoundingBox, resolveRoomGeometry } from "../../data/room-geometries.js";

function useRoomDimensions(): SpaceDimensions {
  const space = useEditorStore((s) => s.space);
  return useMemo(() => {
    if (space === null) return GRAND_HALL_RENDER_DIMENSIONS;
    const geom = resolveRoomGeometry(space);
    if (geom !== null) {
      const bbox = computeBoundingBox(geom.wallPolygon);
      return scaleForRendering({ width: bbox.width, length: bbox.depth, height: geom.ceilingHeight });
    }
    return scaleForRendering({
      width: parseFloat(space.widthM),
      length: parseFloat(space.lengthM),
      height: parseFloat(space.heightM),
    });
  }, [space]);
}

export function PlannerScene(): ReactElement {
  const space = useEditorStore((s) => s.space);
  const dimensions = useRoomDimensions();
  const roomGeometry = space !== null ? resolveRoomGeometry(space) : null;
  const roomVariant = space?.name === "Grand Hall" ? "grand-hall" : "generic";

  return (
    <PlannerCanvasBoundary>
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        camera={{ fov: 55, near: 0.1, far: 200 }}
        style={{ width: "100%", height: "100%" }}
      >
        <color attach="background" args={["#eee9de"]} />
        <fog attach="fog" args={["#efe9dc", 54, 138]} />
        <SceneProvider />
        <SectionPlane />
        <InvalidateOnToggle />
        {roomGeometry !== null ? (
          <RoomMesh geometry={roomGeometry} variant={roomVariant} />
        ) : (
          <>
            <AutoWallSelector />
            <GrandHallRoom />
          </>
        )}
        <XrayToggle />
        <MeasurementTool />
        <TapeMeasure />
        <PlacedFurniture />
        <PlacementGhost />
        <SelectionSystem />
        <SnapGuides />
        <CirculationOverlay />
        <MarqueeSelect />
        <MarkupLayer />
        <DiagramLabels />
        <CameraRig dimensions={dimensions} />
        {import.meta.env.DEV && <PerfMonitor />}
      </Canvas>
    </PlannerCanvasBoundary>
  );
}
```

- [ ] **Step 4: Update `App.tsx` to use `PlannerScene` and keep dimensions for the effect**

In `App.tsx`: keep `useRoomDimensions()` (the effect at `:89-93` still initializes section/bookmark/room-dimensions stores from it), import `PlannerScene`, and replace the `<PlannerCanvasBoundary><Canvas>…</Canvas></PlannerCanvasBoundary>` block inside `.planner-canvas-stage` with `<PlannerScene />`. Remove now-unused Canvas-child imports from `App.tsx` (RoomMesh, SectionPlane, XrayToggle, MeasurementTool, TapeMeasure, PlacementGhost, DiagramLabels, PlacedFurniture, SelectionSystem, MarqueeSelect, SnapGuides, CirculationOverlay, MarkupLayer, SceneProvider, GrandHallRoom, CameraRig, PerfMonitor, PlannerCanvasBoundary, `Canvas`, `resolveRoomGeometry`/`computeBoundingBox` if no longer used). Keep: the shell div, `planner-canvas-stage`, MarkupPersistence, VerticalToolbox, PlannerSpatialHud, PlannerCommandDeck, SectionSlider dock, MeasurementOverlay, PlacementHint, CameraReference*, ChairCountDialog, PerfOverlay.

The stage div becomes:

```tsx
<div className="planner-canvas-stage" style={{ /* unchanged */ }}>
  <PlannerScene />
</div>
```

- [ ] **Step 5: Run the new test + typecheck + the existing editor suite to verify no regression**

Run:
```
pnpm --filter @omnitwin/types build
pnpm --filter @omnitwin/web typecheck
pnpm --filter @omnitwin/web test -- run src/components/editor/__tests__/PlannerScene.test.tsx
pnpm --filter @omnitwin/web test -- run src/__tests__/EditorPage.venue-routing.test.tsx
```
Expected: typecheck clean (no unused-import errors); PlannerScene test PASS; EditorPage routing test still PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/editor/PlannerScene.tsx packages/web/src/App.tsx packages/web/src/components/editor/__tests__/PlannerScene.test.tsx
git commit -m "refactor(web): extract PlannerScene from App canvas (no behaviour change)"
```

---

## Task 5: `PlannerCockpit` grid shell + CSS

The grid that frames the live scene. Phase 1 regions: real nav rail + live scene + tools-under-Design; top bar / Truth rail / phase strip are labeled **placeholders** wired in Phase 2.

**Files:**
- Create: `packages/web/src/components/editor/cockpit/PlannerCockpit.tsx`
- Create: `packages/web/src/components/editor/cockpit/PlannerCockpit.css`
- Test: `packages/web/src/components/editor/cockpit/__tests__/PlannerCockpit.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useCockpitStore } from "../../../../stores/cockpit-store.js";

vi.mock("../../PlannerScene.js", () => ({ PlannerScene: () => <div data-testid="planner-scene" /> }));
vi.mock("../../VerticalToolbox.js", () => ({ VerticalToolbox: () => <div data-testid="vertical-toolbox" /> }));

const { PlannerCockpit } = await import("../PlannerCockpit.js");

afterEach(() => { cleanup(); useCockpitStore.getState().reset(); });

describe("PlannerCockpit", () => {
  it("renders the grid regions, the live scene, and the nav rail", () => {
    render(<PlannerCockpit />);
    expect(screen.getByTestId("cockpit-shell")).toBeTruthy();
    expect(screen.getByTestId("planner-scene")).toBeTruthy();
    expect(screen.getByTestId("cockpit-rail")).toBeTruthy();
  });

  it("shows the tool toolbox in Design and hides it in other lenses", () => {
    render(<PlannerCockpit />);
    expect(screen.getByTestId("vertical-toolbox")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /flow/i }));
    expect(screen.queryByTestId("vertical-toolbox")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @omnitwin/web test -- run src/components/editor/cockpit/__tests__/PlannerCockpit.test.tsx`
Expected: FAIL — "Cannot find module '../PlannerCockpit.js'".

- [ ] **Step 3: Write the grid CSS**

```css
/* packages/web/src/components/editor/cockpit/PlannerCockpit.css */
.cockpit-shell {
  --cockpit-rail-width: 92px;
  --cockpit-topbar-height: 64px;
  --cockpit-bottom-height: 232px;
  --cockpit-right-width: 360px;
  --cockpit-amber: #c9a84c;

  position: fixed;
  inset: 0;
  display: grid;
  grid-template-columns: var(--cockpit-rail-width) minmax(0, 1fr) var(--cockpit-right-width);
  grid-template-rows: var(--cockpit-topbar-height) minmax(0, 1fr) var(--cockpit-bottom-height);
  grid-template-areas:
    "topbar topbar topbar"
    "rail   stage  panel"
    "rail   bottom bottom";
  overflow: hidden;
  background: var(--vv-cinema-black, #090807);
  color: #f4efe6;
  font-family: "Inter", system-ui, sans-serif;
  color-scheme: dark;
  isolation: isolate;
}

.cockpit-topbar { grid-area: topbar; }
.cockpit-rail { grid-area: rail; }
.cockpit-stage { grid-area: stage; position: relative; overflow: hidden; }
.cockpit-panel { grid-area: panel; overflow-y: auto; }
.cockpit-bottom { grid-area: bottom; overflow: hidden; }

.cockpit-rail {
  display: grid;
  grid-template-rows: 1fr auto;
  padding: 12px 0;
  border-right: 1px solid rgba(201, 168, 76, 0.22);
  background: linear-gradient(180deg, rgba(7,7,7,0.99), rgba(18,15,12,0.99) 48%, rgba(8,8,8,0.99));
}
.cockpit-rail__list { display: grid; gap: 4px; align-content: start; justify-items: center; }
.cockpit-rail__button {
  width: 76px; min-height: 60px;
  display: grid; place-items: center; gap: 3px;
  border: 1px solid transparent; border-radius: 12px;
  background: transparent; color: rgba(255,255,255,0.66);
  cursor: pointer;
  font: 700 9px/1 "Inter", system-ui, sans-serif; letter-spacing: 0.06em; text-transform: uppercase;
  transition: background 160ms ease, color 160ms ease, transform 160ms ease;
}
.cockpit-rail__button:hover { color: #f3ddb0; background: rgba(201,168,76,0.08); }
.cockpit-rail__button:active { transform: scale(0.97); }
.cockpit-rail__button.is-active {
  color: #0e0e0e;
  background: linear-gradient(145deg, #e0c66c 0%, var(--cockpit-amber) 44%, #9d7a23 100%);
  border-color: rgba(255,239,177,0.62);
}
.cockpit-rail__button:focus-visible { outline: 2px solid rgba(226,193,93,0.72); outline-offset: 2px; }

/* Phase 1 placeholder chrome — replaced with real regions in Phase 2. */
.cockpit-placeholder {
  display: grid; align-content: center; gap: 4px; padding: 0 18px;
  color: rgba(244,239,230,0.5); font-size: 11px; letter-spacing: 0.04em;
}
.cockpit-topbar.cockpit-placeholder { grid-auto-flow: column; justify-content: start; align-items: center; }

@media (prefers-reduced-motion: reduce) {
  .cockpit-shell *, .cockpit-shell *::before, .cockpit-shell *::after {
    animation-duration: 0.001ms !important; transition-duration: 0.001ms !important;
  }
}
```

- [ ] **Step 4: Write the cockpit shell component**

```tsx
// packages/web/src/components/editor/cockpit/PlannerCockpit.tsx
import { type ReactElement } from "react";
import { PlannerScene } from "../PlannerScene.js";
import { VerticalToolbox } from "../VerticalToolbox.js";
import { CockpitNavRail } from "./CockpitNavRail.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import "./PlannerCockpit.css";

export function PlannerCockpit(): ReactElement {
  const activeMode = useCockpitStore((s) => s.activeMode);
  const isDesign = activeMode === "design";
  return (
    <div className="cockpit-shell" data-testid="cockpit-shell">
      <header className="cockpit-topbar cockpit-placeholder" aria-label="Planner status">
        <span>Venviewer — planner cockpit</span>
        <span>Planning evidence / human review required</span>
      </header>
      <CockpitNavRail />
      <section className="cockpit-stage" aria-label="Planner scene">
        <PlannerScene />
        {isDesign && <VerticalToolbox />}
      </section>
      <aside className="cockpit-panel cockpit-placeholder" aria-label="Truth Mode">
        <span>Truth Mode</span>
        <span>Human review required</span>
      </aside>
      <footer className="cockpit-bottom cockpit-placeholder" aria-label="Event phase graph">
        <span>Event Phase Graph</span>
      </footer>
    </div>
  );
}
```

- [ ] **Step 5: Run test + typecheck**

Run:
```
pnpm --filter @omnitwin/web typecheck
pnpm --filter @omnitwin/web test -- run src/components/editor/cockpit/__tests__/PlannerCockpit.test.tsx
```
Expected: typecheck clean; both tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/editor/cockpit/PlannerCockpit.tsx packages/web/src/components/editor/cockpit/PlannerCockpit.css packages/web/src/components/editor/cockpit/__tests__/PlannerCockpit.test.tsx
git commit -m "feat(web): add PlannerCockpit grid shell with live scene + tools-under-Design"
```

---

## Task 6: Route swap — `/plan*` renders the cockpit (desktop)

Render `PlannerCockpit` from `EditorPage`'s `PlannerCommsLayer` on desktop, keeping the existing mobile chrome and all bootstrap/loading/error states.

**Files:**
- Modify: `packages/web/src/pages/EditorPage.tsx` (the `PlannerCommsLayer` desktop branch)
- Test: `packages/web/src/__tests__/EditorPage.cockpit.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../components/editor/cockpit/PlannerCockpit.js", () => ({
  PlannerCockpit: () => <div data-testid="planner-cockpit" />,
}));
vi.mock("../components/editor/MobilePlannerTopBar.js", () => ({ MobilePlannerTopBar: () => null }));
vi.mock("../components/editor/SaveSendPanel.js", () => ({ SaveSendPanel: () => null }));
vi.mock("../components/editor/SubmitForReviewPanel.js", () => ({ SubmitForReviewPanel: () => null }));
vi.mock("../components/editor/EditorBridge.js", () => ({ EditorBridge: () => null }));
vi.mock("../components/editor/ObjectNotePanel.js", () => ({ ObjectNotePanel: () => null }));
vi.mock("../components/editor/EventDetailsPanel.js", () => ({ EventDetailsPanel: () => null }));
vi.mock("../components/truth/TruthModeIndicator.js", () => ({ TruthModeIndicator: () => null }));
vi.mock("../hooks/use-media-query.js", () => ({
  useIsCoarsePointer: () => false,
  useIsNarrowViewport: () => false,
}));

const { EditorPage } = await import("../pages/EditorPage.js");
const { useEditorStore } = await import("../stores/editor-store.js");

beforeEach(() => {
  useEditorStore.setState({ configId: "cfg-1", isLoading: false, error: null });
});

describe("EditorPage cockpit", () => {
  it("renders the cockpit at /plan on desktop when a config is loaded", async () => {
    render(
      <MemoryRouter initialEntries={["/plan/cfg-1"]}>
        <Routes><Route path="/plan/:code" element={<EditorPage />} /></Routes>
      </MemoryRouter>,
    );
    await waitFor(() => { expect(screen.getByTestId("planner-cockpit")).toBeTruthy(); });
  });
});
```

> If `useEditorStore.setState` shape differs, mirror the fields the existing `EditorPage.venue-routing.test.tsx` sets. Keep the mock list aligned with `PlannerCommsLayer`'s imports.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @omnitwin/web test -- run src/__tests__/EditorPage.cockpit.test.tsx`
Expected: FAIL — `planner-cockpit` testid not found (the page still renders `<Editor3D/>`).

- [ ] **Step 3: Update `PlannerCommsLayer` to render the cockpit on desktop**

In `EditorPage.tsx`: import `PlannerCockpit`. In `PlannerCommsLayer`, the desktop branch currently renders `<Editor3D />` (= `App`) inside `planner-3d-shell` plus `PlannerStatusHeader` + `ViewModeToggle`. Replace the **desktop** path so that, when `!mobile` and `viewMode === "3d"`, it renders `<PlannerCockpit />` instead of `Editor3D` + `PlannerStatusHeader` + `ViewModeToggle`. Keep:
- the `viewMode === "2d"` blueprint branch,
- the entire `mobile` branch (`MobilePlannerTopBar` + `Editor3D`),
- `EditorBridge`, `ObjectNotePanel`, `SaveSendPanel`, `SubmitForReviewPanel`, `EventDetailsPanel`, `TruthModeIndicator`, `SaveErrorToast` (these remain mounted; the cockpit will absorb their roles in later phases).

Concretely, the desktop 3D stage becomes:

```tsx
{viewMode === "3d" ? (
  mobile ? <Editor3D /> : <PlannerCockpit />
) : (
  <BlueprintPage source="editor-store" />
)}
```

and the desktop-only `<PlannerStatusHeader viewMode={viewMode} />` + `<ViewModeToggle … />` block is removed (the cockpit owns top chrome now; the 2D toggle returns in Phase 2 inside the cockpit top bar). Leave the mobile branch untouched.

- [ ] **Step 4: Run the new test + the existing routing test + typecheck**

Run:
```
pnpm --filter @omnitwin/web typecheck
pnpm --filter @omnitwin/web test -- run src/__tests__/EditorPage.cockpit.test.tsx
pnpm --filter @omnitwin/web test -- run src/__tests__/EditorPage.venue-routing.test.tsx
```
Expected: typecheck clean; cockpit test PASS; venue-routing test still PASS (it mocks `../App.js`; if it asserted on `PlannerStatusHeader`, update those assertions to the cockpit testid — confirm by reading the test first).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/pages/EditorPage.tsx packages/web/src/__tests__/EditorPage.cockpit.test.tsx
git commit -m "feat(web): render planner cockpit at /plan on desktop"
```

---

## Task 7: Re-dock the tool toolbox inside the cockpit stage

`VerticalToolbox` is `position: fixed; left: 0` and sets `--toolbox-offset` on `documentElement` (consumed by the *old* floating chrome). Inside the grid, the nav rail already occupies the far left, so the toolbox must dock at the **stage's** left edge, and the canvas must fill the stage regardless of the CSS vars.

**Files:**
- Modify: `packages/web/src/components/editor/cockpit/PlannerCockpit.css` (scope the toolbox + canvas inside `.cockpit-stage`)
- Test: extend `packages/web/src/components/editor/cockpit/__tests__/PlannerCockpit.test.tsx`

- [ ] **Step 1: Add a failing assertion for the stage owning its toolbox dock**

Append to the existing `PlannerCockpit.test.tsx`:

```tsx
it("docks the toolbox inside the stage region, not the viewport edge", () => {
  const { container } = render(<PlannerCockpit />);
  const stage = container.querySelector(".cockpit-stage");
  expect(stage).not.toBeNull();
  // The toolbox mock renders inside the stage subtree.
  expect(stage?.querySelector('[data-testid="vertical-toolbox"]')).not.toBeNull();
});
```

- [ ] **Step 2: Run to verify it passes structurally, then pin the CSS contract**

Run: `pnpm --filter @omnitwin/web test -- run src/components/editor/cockpit/__tests__/PlannerCockpit.test.tsx`
Expected: the new test PASSES structurally (toolbox is already inside the stage from Task 5). The real work is the CSS docking below; this test locks the DOM contract so a future refactor can't move the toolbox out of the stage.

- [ ] **Step 3: Add stage-scoped CSS so the fixed toolbox aligns to the stage, not the viewport**

Append to `PlannerCockpit.css`:

```css
/* The stage establishes a containing context; the existing fixed toolbox is
   re-anchored to the stage's left edge via a CSS var the toolbox already reads,
   and the canvas fills the stage regardless of the legacy --toolbox-offset. */
.cockpit-stage { --toolbox-offset: 0px; --toolbox-bottom: 0px; }
.cockpit-stage .venviewer-planner-shell,
.cockpit-stage .planner-canvas-stage {
  position: absolute;
  inset: 0;
  padding-left: 0;
  padding-bottom: 0;
}
.cockpit-stage .planner-canvas-stage { padding-left: var(--cockpit-toolbox-width, 68px); }
```

> Rationale: the toolbox stays visible at the stage's left; the canvas is inset by the toolbox width so furniture isn't hidden behind it. Exact value (`--cockpit-toolbox-width`) matches `VerticalToolbox`'s `TOOLBAR_W` (68). If the toolbox's own `position: fixed; left: 0` still escapes the stage in the running app, change its container offset by reading `left: var(--cockpit-rail-width)` — verify visually in Step 5.

- [ ] **Step 4: Run test + typecheck**

Run:
```
pnpm --filter @omnitwin/web typecheck
pnpm --filter @omnitwin/web test -- run src/components/editor/cockpit/__tests__/PlannerCockpit.test.tsx
```
Expected: all PlannerCockpit tests PASS; typecheck clean.

- [ ] **Step 5: Manual visual verification (Playwright MCP or `pnpm --filter @omnitwin/web dev`)**

Open `/plan`. Confirm: nav rail at far left; tool toolbox docked just inboard of it; the editable canvas fills the remaining stage; placing furniture works; switching to Flow hides the toolbox; the room is draggable/orbitable. Note any overlap to fix before committing.

- [ ] **Step 6: Lint + commit**

```bash
pnpm --filter @omnitwin/web lint
git add packages/web/src/components/editor/cockpit/PlannerCockpit.css packages/web/src/components/editor/cockpit/__tests__/PlannerCockpit.test.tsx
git commit -m "feat(web): dock tool toolbox inside the cockpit stage"
```

---

## Phase 1 exit criteria

- `/plan` (desktop) renders the cockpit grid with the **fully editable** scene in the stage; nav rail switches lenses; tools show only in Design.
- No regression: load/save/undo/section/markup still work; existing web suite green.
- `pnpm --filter @omnitwin/web typecheck && lint && test` green; `pnpm --filter @omnitwin/web build` green.
- Mobile path unchanged (existing `MobilePlannerTopBar` + `Editor3D`).

---

## Subsequent plans (write each when the prior phase is green)

- **`2026-06-13-planner-cockpit-phase2-wire-chrome.md`** — real `CockpitTopBar` (editor store + auth + linked event), `CockpitTruthRail` (truth-mode + evidence-runtime gates/status), `CockpitPhaseGraph` + `CockpitInsightCards` (real event + values + open real surfaces), Mesh/Splat/Hybrid + Layers + 3D/2D wired. **Blocking open item:** confirm event↔config linkage (`event_configuration_links`) web client; if none, top bar/phase graph degrade to "No event linked." Replaces the Phase-1 placeholders; satisfies the "zero inert buttons" DoD.
- **`2026-06-13-planner-cockpit-phase3-overlays.md`** — in-canvas world-anchored flow/density/conflict/heritage/review-gate overlays; projected HTML callouts + tracking object-card; evidence→scene beam; live 2D minimap inset.
- **`2026-06-13-planner-cockpit-phase4-wow.md`** — splat cross-dissolve, cinematic establishing move, phase time-machine (phase layout snapshots), lens transitions, cinematic fly-to, ⌘K command palette, Showcase/Present mode; all with `prefers-reduced-motion` paths.
- **`2026-06-13-planner-cockpit-phase5-verify.md`** — full unit/RTL/E2E coverage, SAFE-language audit, retire/redirect `/dev/trades-hall-visual`, session log + `tasks.md`, final verify chain.

---

## Self-review (completed against the spec)

- **Spec coverage:** §3 architecture (single canvas grid) → Tasks 4–5; §5 lenses nav → Tasks 1,3; tools-under-Design (§ decision 3) → Tasks 5,7; route at `/plan` (§ decision 2) → Task 6. Chrome wiring (§4), overlays (§2.1/§9 phase 3), wow/accelerators (§2/§2.1) → explicitly deferred to the named subsequent plans, not dropped.
- **Placeholder scan:** Phase-1 tasks contain complete code; the only "placeholders" are the intentional, labeled Phase-1 chrome regions (top bar/Truth rail/phase strip) that §9 phase 1 permits and Phase 2 replaces. No "TBD"/"add error handling"/uncoded steps.
- **Type consistency:** `CockpitMode`/`CockpitOverlayKey`/`CockpitLayerMode` defined in Task 1 are used unchanged in Tasks 2,3,5; `useCockpitStore` action names (`setMode`/`setLayerMode`/`toggleOverlay`/`setOverlay`/`selectPhase`/`reset`) are consistent across Tasks 2,3,5; `PlannerScene`/`PlannerCockpit`/`CockpitNavRail` names consistent across Tasks 4,5,6.
