import { useEffect, useMemo, useRef, type ReactElement } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, NormalBlending, type Group } from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { attribute, float, fract, mix, smoothstep, uniform, uv, vec3 } from "three/tsl";
import { toRenderSpace, toRealWorld } from "../../constants/scale.js";
import { getCatalogueItem } from "../../lib/catalogue.js";
import { isDiningTableItem } from "../../lib/furniture-semantics.js";
import { computeRotatedFootprint } from "../../lib/placement.js";
import { banquetSeatsPerTable, tableGroupPlanningRadius } from "../../lib/table-group.js";
import { isTableDressingApplicator } from "../../lib/table-dressing.js";
import { prefersReducedMotion } from "../../lib/reduced-motion.js";
import { spacesEntered, type DoorClearSpace, type Footprint } from "../../lib/door-clear-spaces.js";
import { doorFloorStrengths, doorsBlockedByAny } from "../../lib/keep-doors-clear.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useDoorClearSpaceStore } from "../../stores/door-clear-space-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";

// ---------------------------------------------------------------------------
// DoorClearSpaceLayer — the doors' clear spaces on the floor (Blake, 27 Oct
// 2026: "Keep them clear automatically (Recommended)").
//
// While a piece is placed or carried, the floor in front of each door shows
// faintly: a pool of warm light from the threshold, fading into the room, and
// a fine dashed edge where the clear space ends, as a plan marks a door's
// clearance. The space the piece is entering shows fully. Otherwise the floor
// is left alone, but for a space something already stands in, beside the
// notice that names it (DoorClearNotice). Fades are short eases; under reduced
// motion a mark simply is at its strength.
// ---------------------------------------------------------------------------

/** Height above the floor the marks lie at, metres: above the ink and grid (InkArchitectureLayer). */
const MARK_Y = 0.006;
/** The pool's light: warm ivory, as daylight falls through a doorway. */
const POOL_COLOUR = vec3(0.957, 0.918, 0.847);
/** The edge: the hall's brass, a touch lighter so it reads on the timber. */
const EDGE_COLOUR = "#cfae72";
/** The pool's opacity at full strength: at the threshold, and where the space meets the room. */
const POOL_AT_DOOR = 0.48;
const POOL_AT_EDGE = 0.12;
const EDGE_OPACITY = 0.85;
/**
 * The edge's width on the floor, metres. A drawn line is one pixel wide at
 * any distance, so it vanished on the timber from the planner's camera; a
 * ribbon keeps a real width, as ink on a plan does.
 */
const EDGE_WIDTH_M = 0.04;
/** The edge's dashes and gaps along it, metres, and the soft end of each dash. */
const EDGE_DASH_M = 0.22;
const EDGE_GAP_M = 0.14;
const EDGE_DASH_SOFT_M = 0.012;
/** Ease time constants, seconds: a quicker arrival than leaving. */
const FADE_IN_S = 0.09;
const FADE_OUT_S = 0.16;

type Corner = readonly [number, number];

/** A space's corners in render units: along the wall from its left, then back along the room edge. */
function markCorners(space: DoorClearSpace): readonly [Corner, Corner, Corner, Corner] {
  const { rect, inward } = space;
  const r = (value: number): number => toRenderSpace(value);
  if (Math.abs(inward[1]) >= Math.abs(inward[0])) {
    const wallZ = inward[1] < 0 ? rect.maxZ : rect.minZ;
    const roomZ = inward[1] < 0 ? rect.minZ : rect.maxZ;
    return [[r(rect.minX), r(wallZ)], [r(rect.maxX), r(wallZ)], [r(rect.maxX), r(roomZ)], [r(rect.minX), r(roomZ)]];
  }
  const wallX = inward[0] > 0 ? rect.minX : rect.maxX;
  const roomX = inward[0] > 0 ? rect.maxX : rect.minX;
  return [[r(wallX), r(rect.minZ)], [r(wallX), r(rect.maxZ)], [r(roomX), r(rect.maxZ)], [r(roomX), r(rect.minZ)]];
}

/** The pool: one quad, u along the wall, v from the threshold (0) into the room (1). */
function poolGeometry(space: DoorClearSpace): BufferGeometry {
  const corners = markCorners(space);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(corners.flatMap(([x, z]) => [x, MARK_Y, z]), 3));
  geometry.setAttribute("uv", new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

/**
 * The edge: the three sides that face the room (the wall is its own edge), as
 * a flat ribbon EDGE_WIDTH_M wide. Each vertex carries its distance along the
 * edge (`along`, render units) for the dashes. Each side runs half a width past
 * its ends, so the corners close.
 */
function edgeGeometry(space: DoorClearSpace): BufferGeometry {
  const [wallLeft, wallRight, roomRight, roomLeft] = markCorners(space);
  const lift = MARK_Y + 0.001;
  const half = toRenderSpace(EDGE_WIDTH_M) / 2;
  const positions: number[] = [];
  const along: number[] = [];
  const index: number[] = [];
  let travelled = 0;
  for (const [[ax, az], [bx, bz]] of [[wallRight, roomRight], [roomRight, roomLeft], [roomLeft, wallLeft]] as const) {
    const length = Math.hypot(bx - ax, bz - az);
    if (length === 0) continue;
    const ux = (bx - ax) / length;
    const uz = (bz - az) / length;
    const [sx, sz, ex, ez] = [ax - ux * half, az - uz * half, bx + ux * half, bz + uz * half];
    const base = positions.length / 3;
    positions.push(sx - uz * half, lift, sz + ux * half, sx + uz * half, lift, sz - ux * half, ex + uz * half, lift, ez - ux * half, ex - uz * half, lift, ez + ux * half);
    along.push(travelled - half, travelled - half, travelled + length + half, travelled + length + half);
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    travelled += length;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("along", new Float32BufferAttribute(along, 1));
  geometry.setIndex(index);
  return geometry;
}

/** The edge's brass, as the drawn line had it. */
const EDGE_INK = new Color(EDGE_COLOUR);

function DoorClearSpaceMark({ space, target }: { readonly space: DoorClearSpace; readonly target: number }): ReactElement {
  const invalidate = useThree((state) => state.invalidate);
  const group = useRef<Group>(null);
  const shown = useRef(0);
  const strength = useMemo(() => uniform(0), []);
  const pool = useMemo(() => poolGeometry(space), [space]);
  const poolMaterial = useMemo(() => {
    const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: NormalBlending, side: DoubleSide });
    material.colorNode = POOL_COLOUR;
    const across = uv().x;
    const sides = smoothstep(float(0), float(0.1), across).mul(smoothstep(float(0), float(0.1), float(1).sub(across)));
    material.opacityNode = mix(float(POOL_AT_DOOR), float(POOL_AT_EDGE), uv().y).mul(sides).mul(strength);
    material.polygonOffset = true;
    material.polygonOffsetFactor = -2;
    material.polygonOffsetUnits = -4;
    return material;
  }, [strength]);
  const edge = useMemo(() => edgeGeometry(space), [space]);
  // The edge's ink: the brass, its dashes cut along the ribbon with soft ends, at the mark's strength.
  const edgeInk = useMemo(() => {
    const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: NormalBlending, side: DoubleSide });
    material.colorNode = vec3(EDGE_INK.r, EDGE_INK.g, EDGE_INK.b);
    const dash = toRenderSpace(EDGE_DASH_M);
    const period = toRenderSpace(EDGE_DASH_M + EDGE_GAP_M);
    const soft = toRenderSpace(EDGE_DASH_SOFT_M);
    const phase = fract(attribute("along", "float").div(period)).mul(period);
    const inDash = smoothstep(float(0), float(soft), phase).mul(float(1).sub(smoothstep(float(dash - soft), float(dash), phase)));
    material.opacityNode = float(EDGE_OPACITY).mul(inDash).mul(strength);
    material.polygonOffset = true;
    material.polygonOffsetFactor = -3;
    material.polygonOffsetUnits = -6;
    return material;
  }, [strength]);

  // Each resource is released with its own memo, so a new space never disposes a material still in use.
  useEffect(() => () => { pool.dispose(); }, [pool]);
  useEffect(() => () => { poolMaterial.dispose(); }, [poolMaterial]);
  useEffect(() => () => { edge.dispose(); }, [edge]);
  useEffect(() => () => { edgeInk.dispose(); }, [edgeInk]);

  // A new strength wakes the demand frame loop; the frame eases toward it.
  useEffect(() => { invalidate(); }, [target, invalidate]);

  useFrame((_state, delta) => {
    const from = shown.current;
    let next = target;
    if (!prefersReducedMotion() && from !== target) {
      const eased = target + (from - target) * Math.exp(-Math.min(delta, 0.1) / (target > from ? FADE_IN_S : FADE_OUT_S));
      next = Math.abs(eased - target) < 0.005 ? target : eased;
    }
    shown.current = next;
    strength.value = next;
    const node = group.current;
    if (node !== null) {
      node.visible = next > 0;
      node.userData["strength"] = next;
    }
    if (next !== target) invalidate();
  });

  return (
    <group ref={group} name={`door-clear-space-${space.id}`} visible={false}>
      <mesh geometry={pool} material={poolMaterial} renderOrder={-1} />
      <mesh geometry={edge} material={edgeInk} renderOrder={-1} />
    </group>
  );
}

/** The ghost's footprint in metres: a dining round as the set it places, any other piece as itself. */
function ghostFootprint(itemId: string, position: readonly [number, number, number], rotationY: number): Footprint | null {
  const item = getCatalogueItem(itemId);
  if (item === undefined || isTableDressingApplicator(itemId)) return null;
  const x = toRealWorld(position[0]);
  const z = toRealWorld(position[2]);
  if (isDiningTableItem(item) && item.tableShape === "round") {
    const radius = tableGroupPlanningRadius(item, banquetSeatsPerTable(item));
    return { x, z, halfW: radius, halfD: radius };
  }
  const { halfW, halfD } = computeRotatedFootprint(item, rotationY);
  return { x, z, halfW: toRealWorld(halfW), halfD: toRealWorld(halfD) };
}

export function DoorClearSpaceLayer(): ReactElement | null {
  const spaces = useDoorClearSpaceStore((state) => state.spaces);
  const carrying = useDoorClearSpaceStore((state) => state.carrying);
  const inHand = useCatalogueStore((state) => state.selectedItemId);
  const placedItems = usePlacementStore((state) => state.placedItems);
  const ghostPosition = usePlacementStore((state) => state.ghostPosition);
  const ghostRotation = usePlacementStore((state) => state.ghostRotation);

  // Cloths and place settings dress tables; they are not set down on the floor.
  const placing = inHand !== null && !isTableDressingApplicator(inHand);
  // The placed pieces' doors apart from the ghost's, so a moving ghost does not rescan the layout.
  const byPieces = useMemo(() => doorsBlockedByAny(placedItems, spaces), [placedItems, spaces]);
  const strengths = useMemo(() => {
    const ghost = placing && ghostPosition !== null ? ghostFootprint(inHand, ghostPosition, ghostRotation) : null;
    const byGhost = ghost === null ? [] : spacesEntered([ghost], spaces);
    const entered = spaces.filter((space) => byPieces.includes(space) || byGhost.includes(space));
    return doorFloorStrengths({ spaces, placing, carrying, entered });
  }, [spaces, placing, carrying, inHand, byPieces, ghostPosition, ghostRotation]);

  if (spaces.length === 0) return null;
  return (
    <group name="door-clear-spaces">
      {spaces.map((space) => <DoorClearSpaceMark key={space.id} space={space} target={strengths.get(space.id) ?? 0} />)}
    </group>
  );
}
