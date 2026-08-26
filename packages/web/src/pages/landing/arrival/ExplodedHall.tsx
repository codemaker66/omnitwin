import { useEffect, useRef, useState, type ReactElement } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useNavigate } from "react-router-dom";
import { create } from "zustand";
import { Group, Mesh, Vector3, type Matrix4, type Object3D } from "three";
import type { TwinScanNode } from "@omnitwin/types";
import {
  isSpringSettled,
  stepSpring,
  type SpringConfig,
  type SpringState,
} from "../../../lib/springs.js";
import { diveClickGuard } from "../../../twin/DollhouseStage.js";
import { e57PointToThree } from "../../../twin/twin-basis.js";
import { ROOM_DISPLAY_NAMES } from "../../../twin/shell/twin-rooms.js";
import { useArrivalStore, type ArrivalPhase } from "./arrival-store.js";
import {
  bucketForY,
  explodeOffsetY,
  storeyBoundaries,
  type StoreySample,
} from "./storey-explode.js";

// -----------------------------------------------------------------------------
// ExplodedHall — click, springs, labels, CTAs (Arrival Task 10). The Hall's
// signature interaction: click the landed dollhouse and its storeys drift
// apart on one shared spring, each labeled with the real rooms it holds, with
// routes into the Twin walk (/tour) and the planner (/plan).
//
// STOREY COUNT IS REAL DATA, NOT A GUESS. TwinViewer.tsx:116 records the
// finding that sent the old walkthrough minimap the same way: "manifest floor
// 0 is the building's first floor (the Grand Hall, the Saloon) and floor −1
// is the GROUND floor, the entrance." The shipped bundle
// (public/twin/trades-hall/manifest.json) confirms it holds exactly those two
// floor values across all 149 nodes, and twin-rooms.ts's five-viewpoint join
// confirms which two rooms sit on each: Reception Room and Robert Adam Room on
// floor −1 (verified: room-selector.test.ts's "reads the storey from the
// manifest… downstairs" case), Grand Hall and Saloon on floor 0. So today's
// real building explodes into exactly TWO storeys, each carrying two of the
// four rooms — ARRIVAL_STOREY_LABELS below names both rooms per storey rather
// than inventing a false one-room-per-storey mapping the capture does not
// have. Nothing here HARD-CODES "two": storeyBoundaries()/bucketForY() (Task
// 9) size the bucket count from whatever floors the manifest actually reports,
// so a future multi-storey capture buckets correctly on its own, and a bucket
// beyond ARRIVAL_STOREY_LABELS' length falls back to a generic ordinal rather
// than fabricating a room name (storeyLabelFor below).
//
// BUCKETING RUNS ONCE, ON FIRST ENTRY TO "exploded" (Step 1) — never eagerly
// at mount, never again on a later re-explode. HallHandoff's own fade spring
// (Task 7) keeps animating the SAME material array regardless of which group
// currently parents a chunk's mesh, so this split is invisible to it.
//
// THE REPARENT-WITHOUT-MOVING-ANYTHING PROBLEM, AND WHY attach() SOLVES IT
// OUTRIGHT RATHER THAN BY CAREFUL NESTING:
//
// The obvious approach — make each storey a child `<group position-y={…}>`
// INSIDE HallHandoff's existing placement group (the one carrying
// `matrix={HANDOFF_PLACEMENT_MATRIX}`) — silently breaks the moment that
// matrix's rotation is non-zero. HANDOFF_PLACEMENT_MATRIX is not just the
// placement's own outer yaw; twinPlacementMatrix() bakes the twin-basis
// rotation (meshRootWorldMatrix(): E57_TO_THREE_QUAT, a −90° rotation about
// X) into the SAME Matrix4. A child group's local +Y, carried through that
// rotation, lands on world −Z, not world +Y — verified by hand: R_x(−90°)
// applied to (0,1,0) is (0,0,−1). "Placement heading is yaw-only about +Y so
// local +Y stays world +Y" is true of the OUTER yaw alone (rotation about Y
// fixes the Y axis, for any heading), but it is NOT true of the FULL matrix
// this group carries, which also contains that X-axis basis rotation. A
// storey group nested there would explode SIDEWAYS the day Task 8 calibrates
// a non-zero heading, and even today (heading = 0) the fact that it happens
// to work is a coincidence of the seed value, not a property of the
// structure.
//
// So this module does not nest inside that group at all. Each storey group is
// a plain `THREE.Group`, freshly constructed, mounted as a SIBLING at the
// exact tree position the old placement group used to occupy (a child of
// HallHandoffMesh's own identity-transform wrapper — see that file's header
// on why the lights, and now this, stay outside the twin-basis rotation).
// Chunks are moved into it with `Object3D.prototype.attach()`, which computes
// whatever LOCAL transform reproduces the chunk's CURRENT world transform —
// including everything HANDOFF_PLACEMENT_MATRIX was contributing at the
// moment of the split — and bakes that into the chunk's new position/
// quaternion/scale relative to the (freshly-constructed, still-identity)
// storey group. Because the storey group itself carries no rotation and sits
// under an unrotated ancestor, a LATER `group.position.y = …` write is
// therefore guaranteed to be a genuine world-space vertical lift, regardless
// of whatever HANDOFF_PLACEMENT_MATRIX's own rotation is or becomes. This is
// strictly more robust than the nested-group approach: it does not depend on
// the placement matrix's rotation staying yaw-only, because the storey groups
// never sit inside it in the first place.
//
// THE BRIDGE OUT OF THE CANVAS (labels are DOM, projection needs the camera):
//
// A small dedicated zustand store (useExplodeOverlayStore below), matching
// this file's OWN precedent (arrival-store.ts already bridges phase from
// inside the Canvas to ArrivalHero's DOM — the skip button and
// data-arrival-phase attribute are exactly this pattern) rather than lifting
// React state via a callback prop or hand-rolling a ref + imperative DOM
// writer. Kept as its OWN store, never folded into useArrivalStore, so the
// phase machine stays free of per-frame projection numbers and the overlay
// stays free of phase-transition rules — "isolated from the phase machine"
// per the brief. Two pieces of data cross the boundary every unsettled frame:
// whether the explode spring is at rest (ArrivalHero widens the Canvas's
// frameloop to "always" while it is not, exactly like the flight's own
// continuous-motion treatment) and each visible storey's current projected
// screen position (ArrivalHero positions a DOM label there). A per-frame
// zustand write re-renders ArrivalHero's small DOM overlay for the ~1 s the
// spring is moving — a deliberate, bounded, user-triggered burst, not a
// persistent per-frame cost — which this file judges an acceptable trade for
// reusing an idiom the codebase already has, rather than adding a second,
// bespoke imperative-DOM-mutation mechanism (the drei `<Html>` technique the
// brief explicitly asks NOT to depend on) for one marketing-hero interaction.
// -----------------------------------------------------------------------------

/** Vertical gap between exploded storeys, in metres. */
export const STOREY_SEPARATION_M = 5;

/** The one explode-progress spring — shared by every storey group. */
export const EXPLODE_SPRING: SpringConfig = { stiffness: 120, damping: 20 };

/**
 * One label per storey bucket, lowest first (bucket 0 = the lowest storey —
 * storeyFloors() sorts ascending, and bucket 0 never moves per
 * explodeOffsetY). Composed from twin-rooms.ts's ROOM_DISPLAY_NAMES rather
 * than restated, so a renamed room cannot drift out of sync with what the
 * walkthrough itself calls it. See the file header for the floor-convention
 * finding this ordering is verified against.
 */
export const ARRIVAL_STOREY_LABELS: readonly string[] = [
  `${ROOM_DISPLAY_NAMES["reception-room"]} & ${ROOM_DISPLAY_NAMES["robert-adam-room"]}`,
  `${ROOM_DISPLAY_NAMES["grand-hall"]} & ${ROOM_DISPLAY_NAMES.saloon}`,
];

/** Fallback for a bucket beyond ARRIVAL_STOREY_LABELS — an honest ordinal,
 *  never a fabricated room name, so a future capture with more storeys than
 *  this file has copy for degrades instead of lying. */
function storeyLabelFor(bucket: number): string {
  return ARRIVAL_STOREY_LABELS[bucket] ?? `Storey ${String(bucket + 1)}`;
}

/** Progress above which labels are shown. Just off zero (not exactly zero) so
 *  labels fade out a beat BEFORE the storeys finish reassembling on Close,
 *  rather than vanishing the instant Close is clicked while geometry is still
 *  visibly mid-flight back together. */
const LABEL_APPEAR_PROGRESS = 0.02;

// -----------------------------------------------------------------------------
// The overlay bridge — see file header.
// -----------------------------------------------------------------------------

export interface StoreyLabelPlacement {
  readonly bucket: number;
  readonly label: string;
  /** CSS pixel offset from the canvas's top-left corner. */
  readonly xPx: number;
  readonly yPx: number;
}

interface ExplodeOverlayState {
  /** True whenever there is no explode spring actively moving — the default
   *  (nothing has ever split) and every settled rest state alike. ArrivalHero
   *  reads this to decide whether the Canvas needs "always" frameloop. */
  readonly settled: boolean;
  /** Empty until progress first crosses LABEL_APPEAR_PROGRESS; always empty
   *  before the first split (nothing to label yet). */
  readonly labels: readonly StoreyLabelPlacement[];
  readonly reset: () => void;
}

const INITIAL_OVERLAY: Pick<ExplodeOverlayState, "settled" | "labels"> = {
  settled: true,
  labels: [],
};

/** Dedicated store bridging ExplodedHall's per-frame Canvas state to
 *  ArrivalHero's DOM overlay. Isolated from useArrivalStore on purpose — see
 *  the file header. */
export const useExplodeOverlayStore = create<ExplodeOverlayState>((set) => ({
  ...INITIAL_OVERLAY,
  reset: () => {
    set({ ...INITIAL_OVERLAY });
  },
}));

// -----------------------------------------------------------------------------
// Pure-ish bucketing + reparenting.
// -----------------------------------------------------------------------------

/**
 * `object instanceof Mesh` alone narrows to `Mesh<any, any, any>` rather than
 * the default-generic `Mesh` a plain `Mesh[]` array expects — a TypeScript
 * quirk with `instanceof` narrowing against a class whose type parameters
 * carry defaults. An explicit predicate, whose RETURN TYPE names the bare
 * `Mesh` type directly, sidesteps it instead of scattering casts.
 */
function isChunkMesh(object: Object3D): object is Mesh {
  return object instanceof Mesh;
}

/** World-space bounding-box centroid of a chunk mesh, or null when its
 *  geometry has nothing to bound (no position data) — a degenerate chunk is
 *  skipped rather than crashing the split. */
function chunkWorldCentroid(mesh: Mesh): Vector3 | null {
  mesh.updateWorldMatrix(true, false);
  let box = mesh.geometry.boundingBox;
  if (box === null) {
    mesh.geometry.computeBoundingBox();
    box = mesh.geometry.boundingBox;
  }
  if (box === null || box.isEmpty()) {
    return null;
  }
  return box.getCenter(new Vector3()).applyMatrix4(mesh.matrixWorld);
}

export interface StoreyBucket {
  readonly bucket: number;
  readonly group: Group;
  /** Mean pre-explode world centroid of this storey's chunks — the label's
   *  anchor point, fixed in the group's own (identity-at-attach-time) local
   *  space, so `group.localToWorld(anchor)` re-projects it correctly as the
   *  group's position animates. The origin when a bucket ends up empty
   *  (should not happen on a real capture; kept as a graceful default rather
   *  than a throw). */
  readonly anchor: Vector3;
}

/**
 * Bucket every chunk mesh under `container` by world-space height and
 * reparent each into a fresh per-storey Group, via `Object3D.attach()` — see
 * the file header for why attach() rather than nesting inside the placement
 * matrix. Returns one StoreyBucket per bucket, indexed 0..boundaries.length
 * inclusive (bucketForY's full range), even if a bucket happens to be empty.
 *
 * Collects chunks into a plain array BEFORE reparenting any of them: attach()
 * mutates the scene graph in place (removeFromParent + add), which would
 * corrupt a `.traverse()` walking the very children array being rewritten.
 */
export function bucketAndReparentChunks(
  container: Object3D,
  boundaries: readonly number[],
): readonly StoreyBucket[] {
  container.updateWorldMatrix(true, false);

  const chunks: Mesh[] = [];
  container.traverse((object) => {
    if (isChunkMesh(object)) {
      chunks.push(object);
    }
  });

  const bucketCount = boundaries.length + 1;
  const groups: Group[] = [];
  const sums: Vector3[] = [];
  const counts: number[] = [];
  for (let i = 0; i < bucketCount; i += 1) {
    groups.push(new Group());
    sums.push(new Vector3());
    counts.push(0);
  }

  for (const chunk of chunks) {
    const centroid = chunkWorldCentroid(chunk);
    if (centroid === null) {
      continue;
    }
    const bucket = bucketForY(centroid.y, boundaries);
    const group = groups[bucket];
    const sum = sums[bucket];
    if (group === undefined || sum === undefined) {
      continue; // unreachable: bucketForY's range is exactly [0, boundaries.length]
    }
    sum.add(centroid);
    counts[bucket] = (counts[bucket] ?? 0) + 1;
    group.attach(chunk);
  }

  return groups.map((group, bucket) => {
    const count = counts[bucket] ?? 0;
    const sum = sums[bucket] ?? new Vector3();
    return {
      bucket,
      group,
      anchor: count > 0 ? sum.clone().divideScalar(count) : new Vector3(),
    };
  });
}

/** Storey-bucketing samples from the manifest — the ONLY source of bucket
 *  boundaries (Task 9's contract: real scan heights, never chunk guesses). */
function storeySamplesFromNodes(nodes: readonly TwinScanNode[]): readonly StoreySample[] {
  return nodes.map((node) => ({
    floor: node.floor,
    yMeters: e57PointToThree(node.pose.t)[1],
  }));
}

/**
 * What a CLEAN click (post-diveClickGuard) on the hall does, given the
 * current phase — pulled out of the JSX event handler so the decision itself
 * is unit-testable without synthesising a ThreeEvent or a raycast hit.
 * Mirrors diveClickGuard's own shape: a small pure function the component
 * wires up, rather than inline logic buried in an onClick prop.
 */
export function handleHallClick(
  phase: ArrivalPhase,
  actions: { readonly explode: () => void; readonly navigateToTour: () => void },
): void {
  if (phase === "exploded") {
    actions.navigateToTour();
  } else {
    actions.explode();
  }
}

// -----------------------------------------------------------------------------
// The component.
// -----------------------------------------------------------------------------

export interface ExplodedHallProps {
  /** HallHandoff's prepared (prune+caps'd, material-cloned) scene. */
  readonly scene: Object3D;
  /** HallHandoff's placement × basis matrix — applied unchanged until first
   *  explode; baked into each chunk's own transform by attach() thereafter. */
  readonly placementMatrix: Matrix4;
  /** Manifest nodes — bucketing samples (Task 9 contract). */
  readonly nodes: readonly TwinScanNode[];
}

interface SplitState {
  readonly buckets: readonly StoreyBucket[];
}

export function ExplodedHall({
  scene,
  placementMatrix,
  nodes,
}: ExplodedHallProps): ReactElement {
  const phase = useArrivalStore((s) => s.phase);
  const navigate = useNavigate();
  const invalidate = useThree((s) => s.invalidate);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  const splitRef = useRef<SplitState | null>(null);
  const progressRef = useRef<SpringState>({ value: 0, velocity: 0 });
  // Refs are invisible to React's render cycle — this state exists purely to
  // force a re-render once splitRef gains a value, so the return statement
  // below can switch from the pre-split to the post-split JSX. Nothing reads
  // its value; only the setter matters.
  const [, forceRenderAfterSplit] = useState(0);

  // Step 1: bucket + reparent, once, on first entry to "exploded".
  useEffect(() => {
    if (phase !== "exploded" || splitRef.current !== null) {
      return;
    }
    const boundaries = storeyBoundaries(storeySamplesFromNodes(nodes));
    const buckets = bucketAndReparentChunks(scene, boundaries);
    splitRef.current = { buckets };
    forceRenderAfterSplit((tick) => tick + 1);
    invalidate();
  }, [phase, nodes, scene, invalidate]);

  // A later re-explode / reassemble, once already split, still needs a frame
  // kicked off immediately — mirrors FlightCamera's own held-pose effect.
  useEffect(() => {
    if (splitRef.current !== null) {
      invalidate();
    }
  }, [phase, invalidate]);

  // The overlay is a MODULE-LEVEL store — reset it on unmount so a later
  // remount (a fresh Arrival visit) never renders a stale label left over
  // from a previous mount's last frame.
  useEffect(
    () => () => {
      useExplodeOverlayStore.getState().reset();
    },
    [],
  );

  useFrame((_state, delta) => {
    const split = splitRef.current;
    if (split === null) {
      return;
    }
    // Read the phase IMPERATIVELY here, not the closed-over reactive `phase`
    // above: real R3F keeps a useFrame callback's closure fresh every render
    // via a ref updated in a deps-less layout effect (the same "always the
    // latest" trick ArrivalHero.test.tsx documents for the Canvas mock's
    // onCreated), so relying on the closure is safe there — but that is a
    // property of the RENDERER, not of this component, and this animation
    // loop should not depend on it. getState() is zustand's own escape hatch
    // for exactly this: a per-frame driver reading current truth with zero
    // dependency on when React's last commit happened to land.
    const target = useArrivalStore.getState().phase === "exploded" ? 1 : 0;
    const spring = progressRef.current;
    if (isSpringSettled(spring, target)) {
      return; // last frame's write already reflects rest; nothing to redo
    }
    stepSpring(spring, target, delta, EXPLODE_SPRING);
    const settled = isSpringSettled(spring, target);

    for (const { bucket, group } of split.buckets) {
      group.position.y = explodeOffsetY(bucket, spring.value, STOREY_SEPARATION_M);
    }

    const labels: StoreyLabelPlacement[] =
      spring.value > LABEL_APPEAR_PROGRESS
        ? split.buckets.map(({ bucket, group, anchor }) => {
            const world = group.localToWorld(anchor.clone());
            const ndc = world.project(camera);
            return {
              bucket,
              label: storeyLabelFor(bucket),
              xPx: ((ndc.x + 1) / 2) * size.width,
              yPx: ((1 - ndc.y) / 2) * size.height,
            };
          })
        : [];
    useExplodeOverlayStore.setState({ settled, labels });

    if (!settled) {
      invalidate();
    }
  });

  const handleChunkClick = (event: ThreeEvent<MouseEvent>): void => {
    diveClickGuard(event, () => {
      // Fresh read, matching the useFrame callback above — a click is a raw
      // DOM/raycast event, not something React re-renders ahead of, so this
      // has no more reason to trust a closed-over `phase` than the frame
      // loop does.
      handleHallClick(useArrivalStore.getState().phase, {
        explode: () => {
          useArrivalStore.getState().explode();
        },
        navigateToTour: () => {
          // react-router-dom's NavigateFunction can return a Promise (view
          // transitions); this click has nothing to await it against.
          void navigate("/tour");
        },
      });
    });
  };

  const split = splitRef.current;
  if (split === null) {
    return (
      <group matrixAutoUpdate={false} matrix={placementMatrix} onClick={handleChunkClick}>
        <primitive object={scene} />
      </group>
    );
  }
  return (
    <>
      {split.buckets.map(({ bucket, group }) => (
        <primitive key={bucket} object={group} onClick={handleChunkClick} />
      ))}
    </>
  );
}
