import {
  BufferAttribute,
  DoubleSide,
  Material,
  Matrix4,
  Quaternion,
  Vector3,
  type Mesh,
  type Object3D,
} from "three";
import { E57_TO_THREE_QUAT, MESH_OFFSET_M } from "./twin-basis.js";

// -----------------------------------------------------------------------------
// dollhouse-peel — why the dollhouse no longer loses large segments as the
// camera moves, and why you can still see into every room.
//
// THE SETTLED DIAGNOSIS (three rounds of measurement — do not re-litigate)
//
// The capture holds only surfaces seen from inside the rooms. Its 144 chunks
// carry `position` and `uv` and no `normal` attribute, and every material ships
// `side: FrontSide`, so a triangle exists exactly while its interior side faces
// the camera. Probed on the live scene: 49.8 % of the footprint has overhead
// surface above 3 m once culling is disabled, 3.1 % as shipped — the dome and
// the roofs ARE in the asset; per-triangle backface culling is what deletes
// them, and the culled boundary sweeps as the camera orbits. That sweep is the
// reported bug, four times: "large segments are still cut away depending on
// your perspective and as you change the camera angle".
//
// The same culling is also the FEATURE: the near wall dissolving is the only
// reason an interior-only capture can be seen into at all. So the cure cannot
// be "stop culling" — forcing every material DoubleSide was measured to zero
// the absence metric while closing the coffered lid over the Grand Hall; the
// money view died. And it cannot be a painted fill — the BackSide plaster pass
// this module replaces left the dominant roof holes open (largest contiguous
// hole 18.9 % → 18.4 % of the body) while replacing 24 % of the visible
// interior with flat beige at orbit poses. Both killed by their numbers.
//
// THE RULE THAT MEASURED CLEAN
//
// Split each chunk ONCE, at load, by per-triangle facing computed from winding
// in the WORLD frame (the winding is consistent — FrontSide works from every
// room), into:
//
//   OPEN — stays FrontSide, keeps culling, keeps the see-in:
//     · everything wall-ish and floor-ish (|ny| small or up-facing), and
//     · near-flat ceiling plates HIGH in the building (ny < −0.85 AND
//       world y > 3 m): the Grand Hall's coffered lid, the upper rooms' flat
//       ceilings, the crown of the dome. A horizontal plate culls as one
//       piece the moment the camera crosses its plane — a coherent, deliberate
//       open-top, not a sweep — and beneath it there is always a lit room.
//
//   CAPPED — drawn DoubleSide with its own captured texture, so it can never
//   cull from anywhere:
//     · every steep overhead (dome flanks, coves, vaults) at any height — the
//       surfaces whose cull terminator used to crawl across them as gold arcs;
//     · every down-facing plate LOW in the building (world y ≤ 3 m) — the
//       lower-storey annex ceilings that cap what the storey section plane has
//       emptied beneath them. Uncapped they were the 18.9 % contiguous void.
//
// The 3 m line is measured, not chosen: the down-facing area histogram of this
// capture has 329 m² of plates at y ∈ [−1, 0.5], 267 m² of lids at
// y ∈ [5.5, 7], and under 16 m² in the whole band between 0.5 and 5.5. The
// back of a capped triangle shows the interior texture mirrored — measured on
// screen this reads as the gilded outside of the dome and the panelled tops of
// the annex, not as a defect (the heraldic dome in the reference render).
//
// MEASURED RESULT (360-pose sweep, absence = pixels lit in a DoubleSide-forced
// reference but background in the actual render; instrument in the session
// log):                        before        after this module
//   mean absence               8.12 %        1.17 %
//   worst-pose absence         27.4 %        2.8 %
//   largest contiguous hole    18.9 %        1.9 % of the body
//   absence shift per 3° drag  3.8 % mean    1.3 % mean
// The default landing pose keeps the see-in, the far mahogany, and a COMPLETE
// gilded dome (previously a floating arc). Cost: one extra draw group for each
// chunk that owns capped triangles (133 of 144, measured), ~50 ms of one-time
// load work on 326,820 triangles, zero new per-frame work, zero new geometry
// buffers — the caps reuse the chunk's vertex data through a second index
// range.
//
// The vertical camera-side cutaway and the storey floor plane are untouched:
// they remain the only view-driven removers, and they were already continuous
// and coherent. Caps inherit both planes per mount because the cutaway clone
// pass clones every material in an array (dollhouse-cutaway.ts).
// -----------------------------------------------------------------------------

/** World-space classification thresholds for one venue's capture. */
export interface DollhouseCapRule {
  /**
   * A triangle is down-facing (an overhead surface) when the Y of its unit
   * winding normal is below this. −0.2 keeps genuine walls (|ny| ≈ 0) out of
   * the overhead classes entirely.
   */
  readonly downNormalYMax: number;
  /**
   * A down-facing triangle is a FLAT PLATE when its normal Y is also below
   * this. Plates may stay open (cullable); steeper overheads never may —
   * a sloped surface's cull terminator sweeps with the camera, which is the
   * reported defect.
   */
  readonly plateNormalYMax: number;
  /**
   * A flat plate stays OPEN (cullable, so the room beneath it can be seen
   * into) only above this world height. Below it, plates cap storey voids and
   * must render from above. Measured for trades-hall: the down-facing area
   * histogram is empty between 0.5 m and 5.5 m, so 3 m splits the annex
   * plates from the hall lids with metres of margin on both sides.
   */
  readonly openPlateMinWorldY: number;
}

/**
 * Trades Hall calibration. The thresholds are properties of THIS capture's
 * geometry (see the histogram note on each field); pass a venue's own measured
 * rule for any other capture rather than assuming these carry.
 */
export const TRADES_HALL_CAP_RULE: DollhouseCapRule = {
  downNormalYMax: -0.2,
  plateNormalYMax: -0.85,
  openPlateMinWorldY: 3,
};

/** `geometry.userData` flag — the caps split ran on this (shared) geometry. */
export const DOLLHOUSE_CAPS_FLAG = "dollhouseCapsApplied";

/** `Object3D.userData` key the split report is stored under on the root. */
export const DOLLHOUSE_CAPS_REPORT_KEY = "dollhouseCapsReport";

/** What one application of the caps split did, for logs and tests. */
export interface DollhouseCapReport {
  /** Meshes visited that carried an indexed geometry with positions. */
  readonly meshes: number;
  /** Meshes that received a cap group (had at least one capped triangle). */
  readonly meshesCapped: number;
  readonly cappedTriangles: number;
  readonly totalTriangles: number;
  /** Geometries skipped because a previous run already split them. */
  readonly alreadyApplied: number;
  readonly elapsedMs: number;
}

/**
 * The transform the mounted stage applies above the GLB scene — the twin-basis
 * calibration surface as a Matrix4. The caps split runs on drei's CACHED scene
 * before that group exists, so world-frame classification must apply this
 * explicitly; classifying in the raw GLB frame would swap "down" for one of
 * the E57 horizontals and misfile every surface in the building.
 */
export function meshRootWorldMatrix(): Matrix4 {
  const [qx, qy, qz, qw] = E57_TO_THREE_QUAT;
  const [tx, ty, tz] = MESH_OFFSET_M;
  return new Matrix4().compose(
    new Vector3(tx, ty, tz),
    new Quaternion(qx, qy, qz, qw),
    new Vector3(1, 1, 1),
  );
}

/**
 * The pure rule: is a triangle with unit world normal Y `normalY`, centroid
 * world height `worldY`, capped (drawn DoubleSide) rather than left cullable?
 */
export function capTriangleIsCapped(
  normalY: number,
  worldY: number,
  rule: DollhouseCapRule,
): boolean {
  if (!(normalY < rule.downNormalYMax)) {
    return false; // walls, floors, everything not overhead: never touched
  }
  // A high flat plate is the open-top see-in; everything else overhead caps.
  // NaN inputs fail both comparisons and fall through to CAPPED — the safe
  // direction: a stray capped sliver, never a hole.
  const staysOpen = normalY < rule.plateNormalYMax && worldY > rule.openPlateMinWorldY;
  return !staysOpen;
}

interface MeshLike extends Object3D {
  geometry: Mesh["geometry"];
  material: Mesh["material"];
}

/** Structural mesh test that keeps mocked scenes degrading to a no-op. */
function isMeshLike(object: Object3D): object is MeshLike {
  return (
    (object as { isMesh?: unknown }).isMesh === true &&
    "geometry" in object &&
    "material" in object
  );
}

/** An index array of the source's breed, wide enough for the same indices. */
function matchingIndexArray(source: ArrayLike<number>, length: number): Uint16Array | Uint32Array {
  return source instanceof Uint16Array ? new Uint16Array(length) : new Uint32Array(length);
}

// Scratch space — the split runs over ~10^6 vertices; no per-vertex allocation.
const capWorldMatrix = new Matrix4();
const capVertexA = new Vector3();
const capVertexB = new Vector3();
const capVertexC = new Vector3();
const capEdgeAB = new Vector3();
const capEdgeAC = new Vector3();
const capNormal = new Vector3();

/**
 * Split every chunk under `root` into an OPEN group (original material,
 * unchanged) and a CAPPED group (a DoubleSide clone of the same material), by
 * the world-frame rule above. Runs once per geometry: drei caches GLTF scenes
 * across mounts, so the split is flagged idempotent exactly like the shell
 * prune that precedes it, and every later clone of the scene inherits both the
 * groups (shared geometry) and the material array (cloned per mount by the
 * cutaway pass, which is what attaches the live clipping planes).
 *
 * No vertex data is copied or created — the cap group is a second range of the
 * SAME vertex buffers reached through a reordered index. The one allocation
 * per chunk is that index.
 *
 * `worldFromRoot` is the transform the stage will mount `root` under
 * (`meshRootWorldMatrix()` in production). A root that cannot be traversed —
 * mocked scenes in tests — degrades to a zero report, never a throw: a missed
 * split is a cosmetic regression, an exception here unmounts the dollhouse.
 */
export function applyDollhouseCaps(
  root: Object3D,
  rule: DollhouseCapRule = TRADES_HALL_CAP_RULE,
  worldFromRoot?: Matrix4,
): DollhouseCapReport {
  const startedAt = Date.now();
  if (
    typeof (root as { updateMatrixWorld?: unknown }).updateMatrixWorld !== "function" ||
    typeof (root as { traverse?: unknown }).traverse !== "function"
  ) {
    return {
      meshes: 0,
      meshesCapped: 0,
      cappedTriangles: 0,
      totalTriangles: 0,
      alreadyApplied: 0,
      elapsedMs: 0,
    };
  }
  root.updateMatrixWorld(true);

  let meshes = 0;
  let meshesCapped = 0;
  let cappedTriangles = 0;
  let totalTriangles = 0;
  let alreadyApplied = 0;

  root.traverse((object) => {
    if (!isMeshLike(object)) {
      return;
    }
    const { geometry } = object;
    const index = geometry.getIndex();
    // hasAttribute, not a getAttribute-undefined check: the three types declare
    // getAttribute total even though it is not, and the lint rightly objects.
    if (index === null || !geometry.hasAttribute("position")) {
      return;
    }
    const position = geometry.getAttribute("position");
    meshes += 1;
    totalTriangles += Math.floor(index.count / 3);
    if (geometry.userData[DOLLHOUSE_CAPS_FLAG] === true) {
      alreadyApplied += 1;
      return;
    }
    geometry.userData[DOLLHOUSE_CAPS_FLAG] = true;
    // A chunk that already carries a material array is not the single-material
    // capture chunk this split is calibrated for; leave it exactly as it is.
    if (Array.isArray(object.material) || !(object.material instanceof Material)) {
      return;
    }

    if (worldFromRoot === undefined) {
      capWorldMatrix.copy(object.matrixWorld);
    } else {
      capWorldMatrix.multiplyMatrices(worldFromRoot, object.matrixWorld);
    }

    const open: number[] = [];
    const capped: number[] = [];
    for (let triangle = 0; triangle < index.count; triangle += 3) {
      const a = index.getX(triangle);
      const b = index.getX(triangle + 1);
      const c = index.getX(triangle + 2);
      capVertexA.fromBufferAttribute(position, a).applyMatrix4(capWorldMatrix);
      capVertexB.fromBufferAttribute(position, b).applyMatrix4(capWorldMatrix);
      capVertexC.fromBufferAttribute(position, c).applyMatrix4(capWorldMatrix);
      capEdgeAB.subVectors(capVertexB, capVertexA);
      capEdgeAC.subVectors(capVertexC, capVertexA);
      capNormal.crossVectors(capEdgeAB, capEdgeAC);
      const length = capNormal.length();
      const normalY = length === 0 ? 0 : capNormal.y / length;
      const worldY = (capVertexA.y + capVertexB.y + capVertexC.y) / 3;
      if (capTriangleIsCapped(normalY, worldY, rule)) {
        capped.push(a, b, c);
      } else {
        open.push(a, b, c);
      }
    }
    if (capped.length === 0) {
      return;
    }

    const merged = matchingIndexArray(index.array, open.length + capped.length);
    merged.set(open, 0);
    merged.set(capped, open.length);
    geometry.setIndex(new BufferAttribute(merged, 1));
    geometry.clearGroups();
    geometry.addGroup(0, open.length, 0);
    geometry.addGroup(open.length, capped.length, 1);

    const capMaterial = object.material.clone();
    capMaterial.name = `${object.material.name}-cap`;
    capMaterial.side = DoubleSide;
    // Material.clone() deep-clones clipping planes into frozen snapshots; share
    // the source's live array so per-frame plane updates keep reaching the
    // caps. On the cached scene this is null — the cutaway clone pass attaches
    // the live planes per mount, to originals and caps alike.
    capMaterial.clippingPlanes = object.material.clippingPlanes;
    object.material = [object.material, capMaterial];

    meshesCapped += 1;
    cappedTriangles += capped.length / 3;
  });

  const report: DollhouseCapReport = {
    meshes,
    meshesCapped,
    cappedTriangles,
    totalTriangles,
    alreadyApplied,
    elapsedMs: Date.now() - startedAt,
  };
  // Keep the report of the run that DID the split. StrictMode double-invokes
  // the mounting memo, and the second, idempotent pass would otherwise
  // overwrite the real cost figures with a row of zeros.
  if (meshesCapped > 0 || !(DOLLHOUSE_CAPS_REPORT_KEY in root.userData)) {
    root.userData[DOLLHOUSE_CAPS_REPORT_KEY] = report;
  }
  return report;
}
