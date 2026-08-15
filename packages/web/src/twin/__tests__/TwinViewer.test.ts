import { describe, expect, it } from "vitest";
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Plane,
  Scene,
  Vector3,
} from "three";
import type { TwinScanNode } from "@omnitwin/types";
import { DOLLHOUSE_DOT_RADIUS_M } from "../DollhouseStage.js";
import {
  HOP_FOV_BREATH_DEG,
  SHIMMER_FADE_MS,
  TRADES_HALL_DOLLHOUSE_CUTAWAY_INSET_M,
  dollhouseCutawayInsetForVenue,
  lowerFloorSectionMinimumY,
  measurePickFrom,
  shimmerPhaseAfterTier,
  type TwinShimmerPhase,
} from "../TwinViewer.js";

describe("dollhouse cutaway venue gate", () => {
  it("enables the visually reviewed inset for Trades Hall only", () => {
    expect(dollhouseCutawayInsetForVenue("trades-hall")).toBe(
      TRADES_HALL_DOLLHOUSE_CUTAWAY_INSET_M,
    );
    expect(TRADES_HALL_DOLLHOUSE_CUTAWAY_INSET_M).toBe(4);
    expect(dollhouseCutawayInsetForVenue("another-venue")).toBeUndefined();
  });

  it("uses the lowest current-storey pose to suppress lower-floor slab scraps", () => {
    const node = (id: string, floor: number, z: number): TwinScanNode => ({
      id,
      index: Number(id.slice(-3)),
      pose: { q: [1, 0, 0, 0], t: [0, 0, z] },
      floor,
      roomSlug: null,
    });
    const scan080 = node("scan_080", 0, -0.21);
    const scan146 = node("scan_146", 0, -0.21);
    const nodes = [
      node("scan_000", -1, -2.1),
      node("scan_001", -1, -1.35),
      scan080,
      scan146,
      node("scan_028", 0, 1.72),
    ];

    const minimumY = lowerFloorSectionMinimumY(nodes, 0);
    expect(minimumY).toBeCloseTo(-0.39);
    for (const lowestCurrent of [scan080, scan146]) {
      expect(lowestCurrent.pose.t[2] - (minimumY ?? Number.NaN)).toBeGreaterThanOrEqual(
        DOLLHOUSE_DOT_RADIUS_M,
      );
    }
    expect(lowerFloorSectionMinimumY(nodes, -1)).toBeUndefined();
    expect(lowerFloorSectionMinimumY(nodes, 99)).toBeUndefined();
  });
});

// -----------------------------------------------------------------------------
// TwinViewer — pure polish-pass logic (2026-07-05).
//
// The R3F composition itself is exercised by the twin-walk e2e and the visual
// harness; here we pin the pure pieces: the initial-load shimmer's state
// machine (the shimmer belongs to the opening only — hops must never re-arm
// it) and the travel fov breath's contract (a mid-hop surge that vanishes at
// both endpoints, so the WalkControls handover carries zero residue).
// -----------------------------------------------------------------------------

describe("shimmerPhaseAfterTier", () => {
  it("keeps shimmering while the initial node is still at preview tier", () => {
    expect(shimmerPhaseAfterTier("loading", "scan_000", "scan_000", "preview")).toBe(
      "loading",
    );
  });

  it("fades on the initial node's base-tier arrival", () => {
    expect(shimmerPhaseAfterTier("loading", "scan_000", "scan_000", "base")).toBe(
      "fading",
    );
  });

  it("fades when any OTHER node reports — the visitor walked on", () => {
    expect(shimmerPhaseAfterTier("loading", "scan_001", "scan_000", "preview")).toBe(
      "fading",
    );
    expect(shimmerPhaseAfterTier("loading", "scan_001", "scan_000", "base")).toBe(
      "fading",
    );
  });

  it("never re-arms once past loading — hops cannot bring the shimmer back", () => {
    const settled: TwinShimmerPhase[] = ["fading", "done"];
    for (const phase of settled) {
      expect(shimmerPhaseAfterTier(phase, "scan_000", "scan_000", "preview")).toBe(phase);
      expect(shimmerPhaseAfterTier(phase, "scan_000", "scan_000", "base")).toBe(phase);
      expect(shimmerPhaseAfterTier(phase, "scan_002", "scan_000", "base")).toBe(phase);
    }
  });
});

describe("travel fov breath", () => {
  it("is a subtle +4 degree surge", () => {
    expect(HOP_FOV_BREATH_DEG).toBe(4);
  });

  it("vanishes exactly at both hop endpoints (sin π·p)", () => {
    // The breath is base + sin(π·progress)·HOP_FOV_BREATH_DEG; the settle
    // handover to WalkControls relies on a zero contribution at p = 0 and 1.
    expect(Math.sin(Math.PI * 0) * HOP_FOV_BREATH_DEG).toBeCloseTo(0, 10);
    expect(Math.sin(Math.PI * 1) * HOP_FOV_BREATH_DEG).toBeCloseTo(0, 10);
    expect(Math.sin(Math.PI * 0.5) * HOP_FOV_BREATH_DEG).toBeCloseTo(4, 10);
  });
});

describe("shimmer fade window", () => {
  it("outlives the 400 ms CSS fade so the element never pops off mid-fade", () => {
    expect(SHIMMER_FADE_MS).toBeGreaterThanOrEqual(400);
  });
});

// -----------------------------------------------------------------------------
// THE MEASURE PICK.
//
// The one branch of this feature a headless suite can genuinely own. happy-dom
// has no WebGL, so nothing here can prove that a click on a real wall returns a
// sensible metre figure — that is proved by looking, and it was. What CAN be
// proved without a renderer is the arithmetic of the pick, because three's
// Raycaster needs no GL context at all: it is geometry.
//
// The branch that matters is the clipping filter. Dollhouse mode slices the
// building open with clipping planes so the visitor can see inside, and clipping
// is a RASTER operation — the raycaster knows nothing about it. Without the
// filter the nearest hit is routinely the roof the visitor cannot see, so the
// tool would silently measure to a surface that is not on screen. That is the
// exact class of failure a measuring tool cannot have, and it is invisible in a
// screenshot, so it is pinned here.
// -----------------------------------------------------------------------------

/** A unit box on the −Z axis, `distance` metres in front of a camera at the
 *  origin, with optional clipping planes on its material.
 *
 *  Deliberately one metre across, not four: at 75° of fov a box 2 m away spans
 *  ndc ±0.99 once it is much wider than that, and the "clicks past the
 *  building" case below would then still hit it. A test that cannot miss cannot
 *  prove a miss is handled. */
function measureBox(distance: number, clippingPlanes: Plane[] | null): Mesh {
  const material = new MeshBasicMaterial();
  material.clippingPlanes = clippingPlanes;
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), material);
  mesh.position.set(0, 0, -distance);
  return mesh;
}

/** A scene shaped like the one DollhouseStage builds: the real geometry under a
 *  group named `twin-mesh-root`, which is the only thing the pick will look at. */
function measureScene(...meshes: readonly Mesh[]): Scene {
  const scene = new Scene();
  const root = new Group();
  root.name = "twin-mesh-root";
  for (const mesh of meshes) {
    root.add(mesh);
  }
  scene.add(root);
  scene.updateMatrixWorld(true);
  return scene;
}

function measureCamera(): PerspectiveCamera {
  const camera = new PerspectiveCamera(75, 1, 0.1, 200);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  camera.updateMatrixWorld(true);
  return camera;
}

describe("measurePickFrom", () => {
  it("returns the nearest surface the ray meets", () => {
    const scene = measureScene(measureBox(2, null), measureBox(6, null));
    const point = measurePickFrom(scene, measureCamera(), 0, 0);
    expect(point).not.toBeNull();
    // The near box's front face: centre −2, half-depth 0.5.
    expect(point?.[2]).toBeCloseTo(-1.5, 5);
  });

  it("skips a surface the cutaway has clipped away, and takes the one behind it", () => {
    // The plane keeps everything further than 4 m and discards the near box —
    // exactly what the dollhouse's roof slice does to the ceiling above you.
    const slice = new Plane(new Vector3(0, 0, -1), -4);
    const scene = measureScene(measureBox(2, [slice]), measureBox(6, null));
    const point = measurePickFrom(scene, measureCamera(), 0, 0);
    expect(point).not.toBeNull();
    // The FAR box's front face — the near one is not on screen, so it is not a
    // legitimate answer even though the ray reaches it first.
    expect(point?.[2]).toBeCloseTo(-5.5, 5);
  });

  it("answers null when every candidate is clipped, rather than measuring to a ghost", () => {
    const slice = new Plane(new Vector3(0, 0, -1), -4);
    const scene = measureScene(measureBox(2, [slice]));
    expect(measurePickFrom(scene, measureCamera(), 0, 0)).toBeNull();
  });

  it("answers null before the mesh has mounted, which is most of a page load", () => {
    // The glb arrives through Suspense inside a component TwinViewer does not
    // own. "No geometry yet" must read as "take no pick", never as a throw over
    // a visitor's view or a point at the world origin.
    expect(measurePickFrom(new Scene(), measureCamera(), 0, 0)).toBeNull();
  });

  it("answers null when the visitor clicks past the building", () => {
    const scene = measureScene(measureBox(2, null));
    // Hard right of frame: the ray leaves the 4×4 box entirely.
    expect(measurePickFrom(scene, measureCamera(), 0.99, 0)).toBeNull();
  });
});
