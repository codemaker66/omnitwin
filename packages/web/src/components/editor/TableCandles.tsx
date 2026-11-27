// ---------------------------------------------------------------------------
// TableCandles — candlelight on every dining table
//
// When the room's mood lights the event (eventLight.candles above zero), each
// dining table carries a cluster of three pillar candles. Their flames burn
// bright enough to bloom; a warm pool of their light lies on the linen and a
// softer one on the floor around the table. Light pools are additive light,
// not real lights, so a hall of tables costs four draw calls and nothing per
// light, on a phone as on a desktop. Presentation only: the layout is not
// changed and nothing is saved.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, type ReactElement } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  AdditiveBlending,
  CylinderGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Group,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from "three/webgpu";
import { attribute, float, smoothstep, uv, vec3 } from "three/tsl";
import { usePlacementStore } from "../../stores/placement-store.js";
import { getCatalogueItem } from "../../lib/catalogue.js";
import { isDiningTableItem } from "../../lib/furniture-semantics.js";
import { normalizeFurnitureScale } from "../../lib/furniture-scale.js";
import { toRenderSpace } from "../../constants/scale.js";
import { eventLight } from "../../lib/event-light.js";
import { composeFurnitureMotion, furnitureMotionPose, subscribeFurnitureSettleFrames } from "../../lib/furniture-motion.js";
import type { PlacedItem } from "../../lib/placement.js";
import {
  HIDDEN_MATRIX,
  currentFurniturePresentation,
  presentedPiece,
  subscribeFurniturePresentation,
  type PresentationFrame,
  type PresentedPiece,
} from "../../floor/presentation-channel.js";

/** The cluster, in the table's own frame: offset from its centre, height, radius (metres). */
const CLUSTER: readonly { readonly x: number; readonly z: number; readonly height: number; readonly radius: number }[] = [
  { x: 0, z: -0.02, height: 0.22, radius: 0.034 },
  { x: 0.085, z: 0.045, height: 0.15, radius: 0.032 },
  { x: -0.07, z: 0.06, height: 0.11, radius: 0.03 },
];
/** Radius of the glow on the linen and of the pool on the floor, metres. */
const LINEN_GLOW_RADIUS = 0.78;
const FLOOR_POOL_RADIUS = 2.1;
/** Flame colour in linear light at full burn (before the mood's level). */
const FLAME = [1.0, 0.58, 0.22] as const;
const CANDLE_LIGHT = [1.0, 0.66, 0.36] as const;

interface CandleTable {
  /** The table's placed-item id. */
  readonly id: string;
  readonly x: number;
  /** Height of the table's base above the floor, metres: where its motion pivots. */
  readonly y: number;
  readonly z: number;
  /** Height of the table's top above the floor, metres. */
  readonly top: number;
  readonly rotationY: number;
  /** The table's radius (or half its smaller side), metres. */
  readonly reach: number;
}

/** The dining tables that carry candles. */
export function candleTables(items: readonly PlacedItem[]): CandleTable[] {
  const tables: CandleTable[] = [];
  for (const placed of items) {
    const item = getCatalogueItem(placed.catalogueItemId);
    if (item === undefined || !isDiningTableItem(item)) continue;
    const scale = normalizeFurnitureScale(placed.scale);
    tables.push({
      id: placed.id,
      x: placed.x,
      y: placed.y,
      z: placed.z,
      top: placed.y + toRenderSpace(item.height) * scale,
      rotationY: placed.rotationY,
      reach: (Math.min(toRenderSpace(item.width), toRenderSpace(item.depth)) * scale) / 2,
    });
  }
  return tables;
}

/** The three candles merged, with a glow weight rising to 1 at each top. */
function candleGeometry(): BufferGeometry {
  const parts = CLUSTER.map((candle) => {
    const geometry = new CylinderGeometry(candle.radius, candle.radius * 1.02, candle.height, 14, 3, false);
    geometry.translate(candle.x, candle.height / 2, candle.z);
    const position = geometry.getAttribute("position");
    const glow = new Float32Array(position.count);
    for (let i = 0; i < position.count; i++) glow[i] = Math.max(0, (position.getY(i) - candle.height * 0.66) / (candle.height * 0.34));
    geometry.setAttribute("glow", new Float32BufferAttribute(glow, 1));
    return geometry;
  });
  // Every part carries the same attributes, so the merge cannot refuse them.
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return merged;
}

/** A teardrop flame over each candle, merged. */
function flameGeometry(): BufferGeometry {
  const parts = CLUSTER.map((candle) => {
    const geometry = new SphereGeometry(1, 10, 8);
    // Narrow at the wick, round below, drawn up into a tip.
    const position = geometry.getAttribute("position");
    for (let i = 0; i < position.count; i++) {
      const y = position.getY(i);
      const taper = y > 0 ? 1 - y * 0.7 : 1;
      position.setXYZ(i, position.getX(i) * 0.0105 * taper, y * 0.024, position.getZ(i) * 0.0105 * taper);
    }
    geometry.computeVertexNormals();
    geometry.translate(candle.x, candle.height + 0.026, candle.z);
    return geometry;
  });
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return merged;
}

function flatPlane(): BufferGeometry {
  const geometry = new PlaneGeometry(1, 1);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

interface CandleMeshes {
  readonly candles: InstancedMesh;
  readonly flames: InstancedMesh;
  readonly linen: InstancedMesh;
  readonly floor: InstancedMesh;
}

function createCandleMeshes(capacity: number): CandleMeshes {
  const level = eventLight.candles;
  const warm = vec3(...CANDLE_LIGHT);

  // Ivory wax, glowing through near the flame.
  const wax = new MeshStandardNodeMaterial({ roughness: 0.55, metalness: 0 });
  wax.colorNode = vec3(0.86, 0.8, 0.68);
  wax.emissiveNode = vec3(1.0, 0.55, 0.22).mul(attribute("glow", "float").pow(3).mul(level).mul(2.2));
  wax.name = "table-candle-wax";

  const flame = new MeshBasicNodeMaterial({ fog: false });
  flame.colorNode = vec3(...FLAME).mul(level.mul(16));
  flame.name = "table-candle-flame";

  // Additive light pools: falloff from the centre of a unit plane.
  const radial = uv().sub(0.5).length().mul(2);
  const linenMaterial = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false });
  const linenFalloff = float(1).sub(smoothstep(0.0, 1.0, radial)).pow(2.2);
  linenMaterial.colorNode = warm.mul(linenFalloff.mul(level).mul(0.62));
  linenMaterial.polygonOffset = true;
  linenMaterial.polygonOffsetFactor = -2;
  linenMaterial.polygonOffsetUnits = -4;
  linenMaterial.name = "table-candle-linen-glow";

  const floorMaterial = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false });
  // Light spilling past the table's edge: rising from under the cloth (where
  // the table hides it) and fading slowly across the floor.
  const spill = smoothstep(0.2, 0.52, radial).mul(float(1).sub(smoothstep(0.38, 1.0, radial)).pow(2.2));
  floorMaterial.colorNode = warm.mul(spill.mul(level).mul(0.13));
  floorMaterial.polygonOffset = true;
  floorMaterial.polygonOffsetFactor = -3;
  floorMaterial.polygonOffsetUnits = -6;
  floorMaterial.name = "table-candle-floor-pool";

  const make = (geometry: BufferGeometry, material: MeshBasicNodeMaterial | MeshStandardNodeMaterial, name: string): InstancedMesh => {
    const mesh = new InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.name = name;
    return mesh;
  };
  return {
    candles: make(candleGeometry(), wax, "table-candles"),
    flames: make(flameGeometry(), flame, "table-candle-flames"),
    linen: make(flatPlane(), linenMaterial, "table-candle-linen-glow"),
    floor: make(flatPlane(), floorMaterial, "table-candle-floor-pool"),
  };
}

function disposeCandleMeshes(meshes: CandleMeshes): void {
  for (const mesh of [meshes.candles, meshes.flames, meshes.linen, meshes.floor]) {
    mesh.geometry.dispose();
    const material = mesh.material;
    if (!Array.isArray(material)) material.dispose();
    mesh.dispose();
  }
}

const position = new Vector3();
const rotation = new Quaternion();
const size = new Vector3();
const UP = new Vector3(0, 1, 0);

/** Height of the flames' middle above the table top, metres: they catch about it. */
const FLAME_CENTRE = 0.2;
const presented = new Matrix4();
const local = new Matrix4();
const flameStep = new Matrix4();
const flameSize = new Vector3();

/**
 * One candle part of one table, as placed or as a reveal presents it: the
 * wax rises from the linen, the flames catch at the wicks and their light
 * spreads over the linen and the floor (floor/presentation-channel.ts).
 */
function writePart(mesh: InstancedMesh, index: number, placed: Matrix4, shown: PresentedPiece | null, part: "candles" | "flames" | "linen" | "floor"): void {
  if (shown === null) {
    mesh.setMatrixAt(index, placed);
    return;
  }
  const amount = part === "candles" ? shown.wax : part === "flames" ? shown.flame : shown.glow;
  if (amount <= 0.02) {
    mesh.setMatrixAt(index, HIDDEN_MATRIX);
    return;
  }
  presented.multiplyMatrices(shown.delta, placed);
  if (part === "candles") local.makeScale(1, amount, 1);
  else if (part === "flames") local.makeTranslation(0, FLAME_CENTRE, 0).scale(flameSize.set(amount, amount, amount)).multiply(flameStep.makeTranslation(0, -FLAME_CENTRE, 0));
  else local.makeScale(amount, 1, amount);
  mesh.setMatrixAt(index, presented.multiply(local));
}

const placedCandles = new Matrix4();
const placedLinen = new Matrix4();
const placedFloor = new Matrix4();
const carried = new Matrix4();
const glide = new Matrix4();

/**
 * Every table's candles and their light, as placed or as a reveal presents
 * them. A table in motion (lib/furniture-motion.ts) carries its candles and
 * the glow on its linen as the table itself is drawn; the pool on the floor
 * glides with it and stays on the floor.
 */
function fillCandles(meshes: CandleMeshes, tables: readonly CandleTable[], frame: PresentationFrame | null): void {
  const count = Math.min(tables.length, meshes.candles.instanceMatrix.count);
  for (let index = 0; index < count; index++) {
    const table = tables[index];
    if (table === undefined) continue;
    const shown = frame === null ? null : presentedPiece(frame, table.id);
    if (shown === "hidden") {
      for (const mesh of [meshes.candles, meshes.flames, meshes.linen, meshes.floor]) mesh.setMatrixAt(index, HIDDEN_MATRIX);
      continue;
    }
    rotation.setFromAxisAngle(UP, table.rotationY);
    position.set(table.x, table.top + 0.002, table.z);
    size.set(1, 1, 1);
    placedCandles.compose(position, rotation, size);
    position.set(table.x, table.top + 0.004, table.z);
    const linen = Math.min(LINEN_GLOW_RADIUS, table.reach) * 2;
    size.set(linen, 1, linen);
    placedLinen.compose(position, rotation, size);
    position.set(table.x, 0.004, table.z);
    const pool = Math.max(FLOOR_POOL_RADIUS, table.reach * 2.2) * 2;
    size.set(pool, 1, pool);
    placedFloor.compose(position, rotation, size);
    const pose = shown === null ? furnitureMotionPose(table.id) : null;
    if (pose !== null) {
      composeFurnitureMotion(pose, table.x, table.y, table.z, carried);
      placedCandles.premultiply(carried);
      placedLinen.premultiply(carried);
      placedFloor.premultiply(glide.makeTranslation(pose.x, 0, pose.z));
    }
    writePart(meshes.candles, index, placedCandles, shown, "candles");
    writePart(meshes.flames, index, placedCandles, shown, "flames");
    writePart(meshes.linen, index, placedLinen, shown, "linen");
    writePart(meshes.floor, index, placedFloor, shown, "floor");
  }
  for (const mesh of [meshes.candles, meshes.flames, meshes.linen, meshes.floor]) {
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Candles, flames and their light on every dining table, while the mood lights them. */
export function TableCandles(): ReactElement {
  const items = usePlacementStore((state) => state.placedItems);
  const invalidate = useThree((state) => state.invalidate);
  const tables = useMemo(() => candleTables(items), [items]);
  const capacity = Math.max(32, 2 ** Math.ceil(Math.log2(Math.max(1, tables.length))));
  const meshes = useMemo(() => createCandleMeshes(capacity), [capacity]);

  useEffect(() => () => { disposeCandleMeshes(meshes); }, [meshes]);
  const latest = useRef(tables);
  latest.current = tables;
  useEffect(() => {
    fillCandles(meshes, tables, currentFurniturePresentation());
    invalidate();
  }, [invalidate, meshes, tables]);

  // A reveal's frames, published before the frame renders (the publisher invalidates).
  useEffect(() => subscribeFurniturePresentation((frame) => {
    fillCandles(meshes, latest.current, frame);
  }), [meshes]);

  // Motion frames, likewise: candles ride their table as it drops in and
  // settles, and the frame after the last motion writes them as placed.
  useEffect(() => subscribeFurnitureSettleFrames(() => {
    fillCandles(meshes, latest.current, currentFurniturePresentation());
  }), [meshes]);

  // Unlit candles are not drawn at all, except vanishingly small (and at
  // least once) for their first frames, so their shaders compile on arrival
  // and not on the first change of mood.
  const group = useRef<Group | null>(null);
  const warmFrames = useRef(4);
  useFrame(() => {
    const all = [meshes.candles, meshes.flames, meshes.linen, meshes.floor];
    const lit = eventLight.candles.value > 0.004;
    if (warmFrames.current > 0) {
      warmFrames.current -= 1;
      for (const mesh of all) { mesh.visible = true; mesh.count = Math.max(1, mesh.count); }
      group.current?.scale.setScalar(lit ? 1 : 1e-4);
      // The last warm frame restores the real instance counts.
      if (warmFrames.current === 0) fillCandles(meshes, tables, currentFurniturePresentation());
      invalidate();
      return;
    }
    group.current?.scale.setScalar(1);
    if (meshes.candles.visible !== lit) {
      for (const mesh of all) mesh.visible = lit;
      invalidate();
    }
  });

  return (
    <group ref={group} name="table-candles">
      <primitive object={meshes.floor} />
      <primitive object={meshes.linen} />
      <primitive object={meshes.candles} />
      <primitive object={meshes.flames} />
    </group>
  );
}
