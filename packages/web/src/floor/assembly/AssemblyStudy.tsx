// ---------------------------------------------------------------------------
// AssemblyStudy — development-only host for the Grand Assembly direction
// studies, mounted by PlannerScene when the address asks for `?assembly=`.
//
// It plays a choreography over the planner's own furniture as drawn: the
// instanced batches of InstancedFurnitureLayer, the contact shadows and the
// table candles. It never writes the placement store. Every instance slot it
// moves is matched to its placed item by the item's saved position and the
// slot's original matrix is kept, so a piece that comes to rest is written
// back byte for byte and the planner carries on exactly where it was.
//
// `window.__assembly` lets a capture harness drive time in fixed steps with
// the frame loop frozen (frameloop "never"), so every frame is reproducible.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { advance, useFrame, useThree } from "@react-three/fiber";
import {
  AdditiveBlending,
  BufferGeometry,
  DoubleSide,
  Color,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  Object3D,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Vector3,
  type InstancedBufferAttribute,
} from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { attribute, float, step, uniform, vec3 } from "three/tsl";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { useHallViewStore } from "../../stores/hall-view-store.js";
import { useHallTimeStore } from "../../stores/hall-time-store.js";
import { useRenderGovernorStore } from "../../stores/render-governor-store.js";
import { getCatalogueItem } from "../../lib/catalogue.js";
import { isSceneFurniturePlacement } from "../../lib/table-dressing.js";
import { isDiningTableItem } from "../../lib/furniture-semantics.js";
import { publishFurnitureSettleFrame } from "../../lib/furniture-motion.js";
import { getNativeRenderer } from "../../lib/native-renderer.js";
import { prefersReducedMotion } from "../../lib/reduced-motion.js";
import type { PlacedItem } from "../../lib/placement.js";
import type { HallMoodName } from "../../components/grand-hall/hall-mood.js";
import { HALL_HALF_LENGTH, HALL_HALF_WIDTH } from "../../components/grand-hall/hall-spec.js";
import { diffLayouts, isAssemblyDirection, type AssemblyPiece, type DescribePiece } from "./choreography.js";
import { createAssemblyPlayback, emptyPose, type AssemblyPlayback, type BlueprintPose, type DressingPose } from "./engine.js";
import { directionModel } from "./directions.js";
import { composePieceMatrix } from "./pose-matrix.js";
import { grandHallDinner180 } from "./fixture.js";

export interface AssemblyFrameReport {
  /** Wall time of the last drawn frame: playback, every frame callback, the draw and the GPU, ms. */
  readonly ms: number;
  /** Of which the playback step and writing the poses, ms. */
  readonly applyMs: number;
  /** Frames the canvas drew since the previous report (1 per subframe when nothing else drew). */
  readonly drawn: number;
  /** The renderer's node frame number after the frame (its temporal effects key on it). */
  readonly frameId: number | null;
  /** Draws the canvas's frame pacer held back and that were drawn again. */
  readonly skipped: number;
}

export interface AssemblyMeasure {
  readonly frames: number;
  readonly meanMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly maxMs: number;
  readonly applyP95Ms: number;
  readonly applyMaxMs: number;
  readonly gpuP95Ms: number | null;
  readonly gpuMeanMs: number | null;
}

export interface AssemblyStateReport {
  readonly direction: string | null;
  readonly seed: number | null;
  readonly time: number;
  readonly done: boolean;
  readonly settledAt: number | null;
  readonly pieces: number;
  readonly matched: number;
  readonly unmatched: readonly string[];
  readonly live: number;
  readonly clipSeconds: number;
  readonly anchorId: string | null;
  readonly sunIntensity: number | null;
}

export interface AssemblyStudyApi {
  /** Loads the 180-seat dinner into the planner; returns the item count. */
  load(): number;
  /** Sets the hall's mood and hour (ISO time). */
  scene(mood: HallMoodName, at: string): void;
  /** Builds the playback for a direction over the layout as drawn; hides every piece. */
  prepare(direction: string, seed: number, options?: { readonly reducedMotion?: boolean }): AssemblyStateReport;
  /** Driven playback: the pose at this time is drawn on the next frame. */
  setTime(seconds: number): void;
  /** Real-time playback on the frame loop. */
  play(): void;
  skip(): void;
  cancel(): void;
  state(): AssemblyStateReport;
  /** Frame loop "never": only frame() draws. */
  freeze(on: boolean): void;
  /** Draws the pose at `seconds` (after `subframes - 1` frames at 60 fps before it) and waits for the GPU. */
  frame(seconds: number, subframes?: number, gapMs?: number): Promise<AssemblyFrameReport>;
  /** Measures frame cost over the whole playback at 60 fps steps. */
  measure(options?: { readonly gpu?: boolean; readonly seconds?: number }): Promise<AssemblyMeasure>;
  /** Rebuilds the post-processing pipeline (fresh temporal history) and waits for it. */
  resetPipeline(): Promise<void>;
  /**
   * Restarts the temporal anti-aliasing, its jitter sequence and its history,
   * so a capture's temporal state starts from its own first frame. (The
   * ambient occlusion's noise and the motion vectors key on the renderer's own
   * frame number, which is left alone.) Returns that number and how many were restarted.
   */
  alignTemporal(): Promise<{ readonly frameId: number | null; readonly restarted: number }>;
  /** A hash of every matrix and colour the study writes, and the camera, as drawn now. */
  transformHash(): string;
  /** Everything back to its saved transform, exactly; the study stays mounted. */
  finish(): void;
  /** Ends the study: saved transforms, overlays back, the frame loop back on demand. */
  release(): void;
  /** Places the camera (position, target) and holds it there while no playback moves it. */
  look(position: readonly [number, number, number], target: readonly [number, number, number]): void;
  /** Where the camera is and what it looks at. */
  camera(): { readonly position: [number, number, number]; readonly target: [number, number, number] | null };
}

declare global {
  interface Window {
    __assembly?: AssemblyStudyApi;
  }
}

// --- Matching the planner's drawn furniture --------------------------------------

interface SlotRef {
  readonly matrices: InstancedBufferAttribute;
  readonly colors: InstancedBufferAttribute | null;
  readonly slot: number;
}

interface CandleSet {
  readonly meshes: readonly InstancedMesh[];
  readonly originals: readonly Float32Array[];
  /** Instance index of each table's candles. */
  readonly index: ReadonlyMap<string, number>;
}

interface ShadowSet {
  readonly mesh: InstancedMesh;
  readonly original: Float32Array;
  readonly index: ReadonlyMap<string, number>;
  readonly parts: ReadonlyMap<string, { readonly y: number; readonly sx: number; readonly sz: number }>;
}

interface Presenter {
  readonly playback: AssemblyPlayback;
  readonly pieces: readonly AssemblyPiece[];
  readonly slots: ReadonlyMap<string, SlotRef>;
  readonly unmatched: readonly string[];
  readonly originals: ReadonlyMap<InstancedBufferAttribute, Float32Array>;
  readonly candles: CandleSet | null;
  readonly shadows: ShadowSet | null;
  readonly restored: Set<string>;
  mode: "driven" | "realtime";
  hadLive: boolean;
  lastApplyMs: number;
}

/** Matches a drawn (float32) position to the placed item standing there, within a millimetre. */
function itemAt(items: readonly PlacedItem[], x: number, z: number): PlacedItem | undefined {
  let best: PlacedItem | undefined;
  let bestDistance = 0.001;
  for (const item of items) {
    const distance = Math.hypot(item.x - x, item.z - z);
    if (distance < bestDistance) { best = item; bestDistance = distance; }
  }
  return best;
}

const describePiece: DescribePiece = (item) => {
  if (!isSceneFurniturePlacement(item)) return null;
  const catalogue = getCatalogueItem(item.catalogueItemId);
  if (catalogue === undefined) return null;
  const scale = item.scale ?? 1;
  const role = catalogue.category === "table" ? "table" : catalogue.category === "chair" ? "chair" : "piece";
  return { role, height: catalogue.height * scale, radius: (Math.max(catalogue.width, catalogue.depth) * scale) / 2 };
};

function isInstanced(object: Object3D): object is InstancedMesh {
  return (object as { readonly isInstancedMesh?: boolean }).isInstancedMesh === true;
}

/** The furniture batches' instance slots, each matched to its item by saved position. */
function matchSlots(root: Object3D, items: readonly PlacedItem[]): { slots: Map<string, SlotRef>; originals: Map<InstancedBufferAttribute, Float32Array> } {
  const slots = new Map<string, SlotRef>();
  const originals = new Map<InstancedBufferAttribute, Float32Array>();
  const seen = new Set<InstancedBufferAttribute>();
  root.traverse((object) => {
    if (!isInstanced(object) || object.count === 0) return;
    const matrices = object.instanceMatrix;
    if (seen.has(matrices)) return;
    seen.add(matrices);
    const array = matrices.array;
    const found = new Map<string, number>();
    for (let slot = 0; slot < object.count; slot++) {
      const item = itemAt(items, array[slot * 16 + 12] ?? Number.NaN, array[slot * 16 + 14] ?? Number.NaN);
      // A batch with a slot that is no placed item (a hidden template) is not furniture to move.
      if (item === undefined) return;
      found.set(item.id, slot);
    }
    originals.set(matrices, Float32Array.from(array));
    const colors = object.instanceColor;
    if (colors !== null) originals.set(colors, Float32Array.from(colors.array));
    for (const [id, slot] of found) slots.set(id, { matrices, colors, slot });
  });
  return { slots, originals };
}

function findCandles(scene: Object3D, items: readonly PlacedItem[]): CandleSet | null {
  const names = ["table-candles", "table-candle-flames", "table-candle-linen-glow", "table-candle-floor-pool"];
  const meshes: InstancedMesh[] = [];
  for (const name of names) {
    // The candles' group shares its name with the wax mesh: find the instanced mesh itself.
    const found = scene.getObjectsByProperty("name", name).find(isInstanced);
    if (found === undefined) return null;
    meshes.push(found);
  }
  // TableCandles draws one cluster per dining table, in the store's order.
  const index = new Map<string, number>();
  let next = 0;
  for (const item of items) {
    const catalogue = getCatalogueItem(item.catalogueItemId);
    if (catalogue === undefined || !isDiningTableItem(catalogue)) continue;
    index.set(item.id, next);
    next += 1;
  }
  return { meshes, originals: meshes.map((mesh) => Float32Array.from(mesh.instanceMatrix.array)), index };
}

function findShadows(scene: Object3D, items: readonly PlacedItem[]): ShadowSet | null {
  const found = scene.getObjectsByProperty("name", "furniture-contact-shadows").find(isInstanced);
  if (found === undefined) return null;
  const index = new Map<string, number>();
  const parts = new Map<string, { y: number; sx: number; sz: number }>();
  const matrix = new Matrix4();
  const position = new Vector3();
  const rotation = new Quaternion();
  const scale = new Vector3();
  for (let slot = 0; slot < found.count; slot++) {
    matrix.fromArray(found.instanceMatrix.array, slot * 16);
    matrix.decompose(position, rotation, scale);
    const item = itemAt(items, position.x, position.z);
    if (item === undefined) continue;
    index.set(item.id, slot);
    parts.set(item.id, { y: position.y, sx: scale.x, sz: scale.z });
  }
  return { mesh: found, original: Float32Array.from(found.instanceMatrix.array), index, parts };
}

// --- Writing poses ----------------------------------------------------------------

const pose = emptyPose();
const matrix = new Matrix4();
const shadowMatrix = new Matrix4();
const shadowPosition = new Vector3();
const shadowRotation = new Quaternion();
const shadowScale = new Vector3();
const UP = new Vector3(0, 1, 0);
const dressingPose: DressingPose = { wax: 1, flame: 1, glow: 1 };
const candleMatrix = new Matrix4();
const candleStep = new Matrix4();
/** The gold an Unfolding piece is born in (multiplies its colour). */
const GILT = [1.32, 1.02, 0.56] as const;
const HIDDEN_SCALE = 1e-5;
/** Where a piece not yet in the room is kept, metres below the floor. */
const HIDDEN_DEPTH = -60;
/** Height the three flames scale about, metres above the table top. */
const FLAME_CENTRE = 0.2;

function markRange(ranges: Map<InstancedBufferAttribute, [number, number]>, target: InstancedBufferAttribute, slot: number): void {
  const range = ranges.get(target);
  if (range === undefined) ranges.set(target, [slot, slot]);
  else { range[0] = Math.min(range[0], slot); range[1] = Math.max(range[1], slot); }
}

function upload(ranges: Map<InstancedBufferAttribute, [number, number]>): void {
  for (const [target, [first, last]] of ranges) {
    const size = target.itemSize;
    target.clearUpdateRanges();
    target.addUpdateRange(first * size, (last - first + 1) * size);
    target.needsUpdate = true;
  }
}

function applyCandles(presenter: Presenter, candles: CandleSet): void {
  const { playback } = presenter;
  for (const [tableId, index] of candles.index) {
    if (!playback.dressing(tableId, dressingPose)) continue;
    const resting = dressingPose.wax >= 1 && dressingPose.flame >= 1 && dressingPose.glow >= 1;
    const unstarted = dressingPose.wax <= 0 && dressingPose.flame <= 0 && dressingPose.glow <= 0;
    candles.meshes.forEach((mesh, meshIndex) => {
      const original = candles.originals[meshIndex];
      if (original === undefined) return;
      if (resting) {
        mesh.instanceMatrix.array.set(original.subarray(index * 16, index * 16 + 16), index * 16);
        return;
      }
      if (unstarted) {
        // Not there at all yet: vanishingly small and well below the floor.
        candleMatrix.makeScale(HIDDEN_SCALE, HIDDEN_SCALE, HIDDEN_SCALE).setPosition(0, HIDDEN_DEPTH, 0);
        candleMatrix.toArray(mesh.instanceMatrix.array, index * 16);
        return;
      }
      candleMatrix.fromArray(original, index * 16);
      if (meshIndex === 0) {
        // The wax rises from the linen (and is not there at all before it starts).
        const wax = dressingPose.wax;
        if (wax < 0.02) candleMatrix.multiply(candleStep.makeScale(HIDDEN_SCALE, HIDDEN_SCALE, HIDDEN_SCALE));
        else candleMatrix.multiply(candleStep.makeScale(1, wax, 1));
      } else if (meshIndex === 1) {
        // The flames catch at the wicks.
        const flame = Math.max(HIDDEN_SCALE, dressingPose.flame);
        candleMatrix.multiply(candleStep.makeTranslation(0, FLAME_CENTRE, 0));
        candleMatrix.multiply(candleStep.makeScale(flame, flame, flame));
        candleMatrix.multiply(candleStep.makeTranslation(0, -FLAME_CENTRE, 0));
      } else {
        // Their light spreads over the linen and the floor.
        const glow = Math.max(HIDDEN_SCALE, dressingPose.glow);
        candleMatrix.multiply(candleStep.makeScale(glow, 1, glow));
      }
      candleMatrix.toArray(mesh.instanceMatrix.array, index * 16);
    });
  }
  for (const mesh of candles.meshes) mesh.instanceMatrix.needsUpdate = true;
}

function applyShadows(presenter: Presenter, shadows: ShadowSet): void {
  const { playback } = presenter;
  const array = shadows.mesh.instanceMatrix.array;
  for (const piece of presenter.pieces) {
    const slot = shadows.index.get(piece.id);
    const part = shadows.parts.get(piece.id);
    if (slot === undefined || part === undefined) continue;
    if (playback.isDone(piece.id)) {
      array.set(shadows.original.subarray(slot * 16, slot * 16 + 16), slot * 16);
      continue;
    }
    playback.pose(piece.id, pose);
    const strength = pose.visible ? Math.max(0, pose.shadow) * Math.max(pose.sx, pose.sz) : 0;
    shadowPosition.set(pose.x, part.y, pose.z);
    shadowRotation.setFromAxisAngle(UP, pose.yaw);
    shadowScale.set(Math.max(HIDDEN_SCALE, part.sx * strength), 1, Math.max(HIDDEN_SCALE, part.sz * strength));
    shadowMatrix.compose(shadowPosition, shadowRotation, shadowScale).toArray(array, slot * 16);
  }
  shadows.mesh.instanceMatrix.needsUpdate = true;
}

function applyPresenter(presenter: Presenter): void {
  const { playback } = presenter;
  const ranges = new Map<InstancedBufferAttribute, [number, number]>();
  for (const piece of presenter.pieces) {
    const slot = presenter.slots.get(piece.id);
    if (slot === undefined) continue;
    if (playback.isDone(piece.id)) {
      if (presenter.restored.has(piece.id)) continue;
      presenter.restored.add(piece.id);
      const original = presenter.originals.get(slot.matrices);
      if (original !== undefined) slot.matrices.array.set(original.subarray(slot.slot * 16, slot.slot * 16 + 16), slot.slot * 16);
      markRange(ranges, slot.matrices, slot.slot);
      if (slot.colors !== null) {
        const colors = presenter.originals.get(slot.colors);
        if (colors !== undefined) slot.colors.array.set(colors.subarray(slot.slot * 3, slot.slot * 3 + 3), slot.slot * 3);
        markRange(ranges, slot.colors, slot.slot);
      }
      continue;
    }
    presenter.restored.delete(piece.id);
    playback.pose(piece.id, pose);
    if (!pose.visible) {
      pose.sx = HIDDEN_SCALE;
      pose.sy = HIDDEN_SCALE;
      pose.sz = HIDDEN_SCALE;
      pose.pivotY = 0;
      pose.y = HIDDEN_DEPTH;
    }
    composePieceMatrix(pose, piece.scale, matrix);
    matrix.toArray(slot.matrices.array, slot.slot * 16);
    markRange(ranges, slot.matrices, slot.slot);
    if (slot.colors !== null) {
      const gild = playback.blueprint ? pose.tint : 0;
      slot.colors.array[slot.slot * 3] = 1 + (GILT[0] - 1) * gild;
      slot.colors.array[slot.slot * 3 + 1] = 1 + (GILT[1] - 1) * gild;
      slot.colors.array[slot.slot * 3 + 2] = 1 + (GILT[2] - 1) * gild;
      markRange(ranges, slot.colors, slot.slot);
    }
  }
  upload(ranges);
  if (presenter.shadows !== null) applyShadows(presenter, presenter.shadows);
  if (presenter.candles !== null) applyCandles(presenter, presenter.candles);
}

/** Writes every original back, exactly. */
function restoreAll(presenter: Presenter): void {
  for (const [target, original] of presenter.originals) {
    target.array.set(original);
    target.clearUpdateRanges();
    target.needsUpdate = true;
  }
  if (presenter.shadows !== null) {
    presenter.shadows.mesh.instanceMatrix.array.set(presenter.shadows.original);
    presenter.shadows.mesh.instanceMatrix.needsUpdate = true;
  }
  if (presenter.candles !== null) {
    const { candles } = presenter;
    candles.meshes.forEach((mesh, index) => {
      const original = candles.originals[index];
      if (original === undefined) return;
      mesh.instanceMatrix.array.set(original);
      mesh.instanceMatrix.needsUpdate = true;
    });
  }
  for (const piece of presenter.pieces) presenter.restored.add(piece.id);
}

function hashArrays(arrays: readonly ArrayLike<number>[]): string {
  let hash = 0x811c9dc5;
  for (const values of arrays) {
    const copy = Float32Array.from(values);
    const bytes = new Uint8Array(copy.buffer);
    for (let index = 0; index < bytes.length; index++) {
      hash ^= bytes[index] ?? 0;
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))] ?? 0;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

// --- The renderer's temporal state (development tooling over three's internals) ---------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** three's node manager: the frame counter the ambient occlusion's noise keys on, and the built node states. */
function nodeManager(renderer: object): Record<string, unknown> | null {
  const nodes: unknown = (renderer as Record<string, unknown>)["_nodes"];
  return isRecord(nodes) ? nodes : null;
}

function rendererFrameId(renderer: object): number | null {
  const frame = nodeManager(renderer)?.["nodeFrame"];
  const id = isRecord(frame) ? frame["frameId"] : undefined;
  return typeof id === "number" ? id : null;
}

/** Every node the renderer has built that runs before its frame and matches `test`. */
function framedNodes(renderer: object, test: (node: Record<string, unknown>) => boolean): Record<string, unknown>[] {
  const cache = nodeManager(renderer)?.["nodeBuilderCache"];
  const found = new Set<Record<string, unknown>>();
  if (!(cache instanceof Map)) return [];
  for (const state of cache.values()) {
    const before: unknown = isRecord(state) ? state["updateBeforeNodes"] : undefined;
    if (!Array.isArray(before)) continue;
    for (const node of before) if (isRecord(node) && test(node)) found.add(node);
  }
  return [...found];
}

/** The temporal anti-aliasing nodes (they carry a jitter index). */
function jitterNodes(renderer: object): Record<string, unknown>[] {
  return framedNodes(renderer, (node) => node["isTRAANode"] === true && typeof node["_jitterIndex"] === "number");
}

/** The orbit controls' target, which the camera is aimed at. */
function orbitTarget(controls: unknown): Vector3 | null {
  if (!isRecord(controls)) return null;
  const target = controls["target"];
  return target instanceof Vector3 ? target : null;
}

interface GpuQueue { readonly queue: { onSubmittedWorkDone(): Promise<void> } }
interface TimestampBackend { trackTimestamp: boolean }

function isGpuQueue(value: unknown): value is GpuQueue {
  return typeof value === "object" && value !== null && "queue" in value;
}

function isTimestampBackend(value: unknown): value is TimestampBackend {
  return typeof value === "object" && value !== null && "trackTimestamp" in value;
}

// --- The gold blueprint (the Unfolding) ---------------------------------------

const LINE_WIDTH = 0.04;
const FLOOR_LIFT = 0.006;
/** The usable floor: the hall less a strip along every wall, metres. */
const USABLE_INSET = 0.32;

function floatUniform(value: number) {
  return uniform(value);
}
type FloatUniform = ReturnType<typeof floatUniform>;

/** A flat strip along a polyline, with each vertex's fraction of the way along it. */
function stripPoints(points: readonly (readonly [number, number])[], width: number, positions: number[], along: number[], indices: number[]): void {
  let total = 0;
  const lengths = points.map((point, index) => {
    if (index > 0) {
      const previous = points[index - 1];
      if (previous !== undefined) total += Math.hypot(point[0] - previous[0], point[1] - previous[1]);
    }
    return total;
  });
  const base = positions.length / 3;
  points.forEach((point, index) => {
    const previous = points[Math.max(0, index - 1)] ?? point;
    const next = points[Math.min(points.length - 1, index + 1)] ?? point;
    const dx = next[0] - previous[0];
    const dz = next[1] - previous[1];
    const length = Math.hypot(dx, dz) || 1;
    const nx = (-dz / length) * (width / 2);
    const nz = (dx / length) * (width / 2);
    positions.push(point[0] + nx, FLOOR_LIFT, point[1] + nz, point[0] - nx, FLOOR_LIFT, point[1] - nz);
    const fraction = total > 0 ? (lengths[index] ?? 0) / total : 0;
    along.push(fraction, fraction);
    if (index > 0) {
      const a = base + (index - 1) * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  });
}

function stripGeometry(polylines: readonly (readonly (readonly [number, number])[])[], width: number): BufferGeometry {
  const positions: number[] = [];
  const along: number[] = [];
  const indices: number[] = [];
  for (const points of polylines) stripPoints(points, width, positions, along, indices);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("along", new Float32BufferAttribute(along, 1));
  geometry.setIndex(indices);
  return geometry;
}

function goldMaterial(name: string): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false, side: DoubleSide });
  material.polygonOffset = true;
  material.polygonOffsetFactor = -4;
  material.polygonOffsetUnits = -8;
  material.name = name;
  return material;
}

/** Leaf gold, linear: additive over the warm floor, so deeper than it reads. */
const GOLD = [0.95, 0.56, 0.16] as const;

function lineMaterial(progress: FloatUniform, brightness: FloatUniform): MeshBasicNodeMaterial {
  const material = goldMaterial("assembly-blueprint-line");
  const shown = step(attribute("along", "float"), progress);
  material.colorNode = vec3(...GOLD).mul(shown).mul(brightness).mul(float(0.9));
  return material;
}

function footprintMaterial(): MeshBasicNodeMaterial {
  const material = goldMaterial("assembly-blueprint-footprint");
  material.colorNode = vec3(...GOLD).mul(float(1.1));
  return material;
}

/** A chair's footprint outline: four thin bars round its seat. */
function chairOutline(width: number, depth: number, bar: number): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const add = (w: number, d: number, x: number, z: number): void => {
    const plane = new PlaneGeometry(w, d);
    plane.rotateX(-Math.PI / 2);
    plane.translate(x, 0, z);
    const offset = positions.length / 3;
    const position = plane.getAttribute("position");
    for (let index = 0; index < position.count; index++) positions.push(position.getX(index), position.getY(index), position.getZ(index));
    const index = plane.getIndex();
    if (index !== null) for (let i = 0; i < index.count; i++) indices.push(index.getX(i) + offset);
    plane.dispose();
  };
  add(width, bar, 0, -depth / 2);
  add(width, bar, 0, depth / 2);
  add(bar, depth, -width / 2, 0);
  add(bar, depth, width / 2, 0);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

interface BlueprintParts {
  readonly tables: InstancedMesh;
  readonly chairs: InstancedMesh;
  readonly perimeter: Mesh;
  readonly aisle: Mesh;
  readonly perimeterProgress: FloatUniform;
  readonly aisleProgress: FloatUniform;
  readonly brightness: FloatUniform;
  readonly tableIds: readonly string[];
  readonly chairIds: readonly string[];
  dispose(): void;
}

function createBlueprint(pieces: readonly AssemblyPiece[], anchorX: number): BlueprintParts {
  const tables = pieces.filter((piece) => piece.role === "table");
  const chairs = pieces.filter((piece) => piece.role !== "table");
  const ringGeometry = new RingGeometry(0.955, 0.985, 96);
  ringGeometry.rotateX(-Math.PI / 2);
  ringGeometry.translate(0, FLOOR_LIFT, 0);
  const chairGeometry = chairOutline(0.46, 0.62, 0.022);
  chairGeometry.translate(0, FLOOR_LIFT, 0);
  const tableMesh = new InstancedMesh(ringGeometry, footprintMaterial(), Math.max(1, tables.length));
  const chairMesh = new InstancedMesh(chairGeometry, footprintMaterial(), Math.max(1, chairs.length));
  const x = HALL_HALF_LENGTH - USABLE_INSET;
  const z = HALL_HALF_WIDTH - USABLE_INSET;
  const start = anchorX < 0 ? -x : x;
  // The usable floor's outline in two halves from the top table's end, meeting at the far end.
  const half = (sign: number): (readonly [number, number])[] => [[start, 0], [start, sign * z], [-start, sign * z], [-start, 0]];
  const perimeterProgress = floatUniform(0);
  const aisleProgress = floatUniform(0);
  const brightness = floatUniform(1);
  const perimeter = new Mesh(stripGeometry([half(1), half(-1)], LINE_WIDTH), lineMaterial(perimeterProgress, brightness));
  // The main aisle: from the main door, under the clock, across to the centre window.
  const aisle = new Mesh(stripGeometry([[[0, z], [0, -z]]], LINE_WIDTH * 0.8), lineMaterial(aisleProgress, brightness));
  for (const mesh of [tableMesh, chairMesh, perimeter, aisle]) {
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    mesh.raycast = () => undefined;
  }
  return {
    tables: tableMesh,
    chairs: chairMesh,
    perimeter,
    aisle,
    perimeterProgress,
    aisleProgress,
    brightness,
    tableIds: tables.map((piece) => piece.id),
    chairIds: chairs.map((piece) => piece.id),
    dispose: () => {
      for (const mesh of [tableMesh, chairMesh, perimeter, aisle]) {
        mesh.geometry.dispose();
        const material = mesh.material;
        if (!Array.isArray(material)) material.dispose();
      }
    },
  };
}

const blueprintMatrix = new Matrix4();
const blueprintPosition = new Vector3();
const blueprintRotation = new Quaternion();
const blueprintScale = new Vector3();
const blueprintColor = new Color();
const lineState: BlueprintPose = { perimeter: 0, aisle: 0, lines: 0 };

function drawBlueprint(parts: BlueprintParts, playback: AssemblyPlayback, pieces: ReadonlyMap<string, AssemblyPiece>): void {
  const write = (mesh: InstancedMesh, ids: readonly string[]): void => {
    ids.forEach((id, index) => {
      const piece = pieces.get(id);
      const ring = playback.ring(id);
      if (piece === undefined || ring === null) return;
      const glow = Math.max(0, ring.glow);
      blueprintPosition.set(piece.x, 0, piece.z);
      blueprintRotation.setFromAxisAngle(UP, piece.rotationY);
      const s = glow > 0.002 ? ring.scale : HIDDEN_SCALE;
      blueprintScale.set(s, 1, s);
      mesh.setMatrixAt(index, blueprintMatrix.compose(blueprintPosition, blueprintRotation, blueprintScale));
      mesh.setColorAt(index, blueprintColor.setScalar(glow));
    });
    mesh.count = ids.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
  };
  write(parts.tables, parts.tableIds);
  write(parts.chairs, parts.chairIds);
  if (playback.lines(lineState)) {
    parts.perimeterProgress.value = lineState.perimeter * 1.0001;
    parts.aisleProgress.value = lineState.aisle * 1.0001;
    parts.brightness.value = lineState.lines;
    parts.perimeter.visible = lineState.lines > 0.002;
    parts.aisle.visible = lineState.lines > 0.002;
  }
}

function AssemblyBlueprint({ presenter }: { readonly presenter: Presenter }): ReactElement {
  const parts = useMemo(() => {
    const anchor = presenter.pieces.find((piece) => piece.id === presenter.playback.graph.anchorId);
    return createBlueprint(presenter.pieces, anchor?.x ?? -1);
  }, [presenter]);
  const byId = useMemo(() => new Map(presenter.pieces.map((piece) => [piece.id, piece])), [presenter]);
  useEffect(() => () => { parts.dispose(); }, [parts]);
  // Drawn before the frame renders, from the same playback tick as the furniture.
  drawBlueprint(parts, presenter.playback, byId);
  useFrame(() => { drawBlueprint(parts, presenter.playback, byId); });
  return (
    <group name="assembly-blueprint">
      <primitive object={parts.perimeter} />
      <primitive object={parts.aisle} />
      <primitive object={parts.tables} />
      <primitive object={parts.chairs} />
    </group>
  );
}

// --- The study ------------------------------------------------------------------------

export function AssemblyStudy(): ReactElement | null {
  const get = useThree((state) => state.get);
  const invalidate = useThree((state) => state.invalidate);
  const presenterRef = useRef<Presenter | null>(null);
  /** A camera pose set by look(), held every frame against the orbit controls. */
  const heldCameraRef = useRef<{ readonly position: readonly [number, number, number]; readonly target: readonly [number, number, number] } | null>(null);
  const drawnRef = useRef(0);
  const reportedRef = useRef(0);
  /** Draws the canvas's pacer held back (and that were drawn again) since the last report. */
  const skippedRef = useRef(0);

  const [blueprint, setBlueprint] = useState<Presenter | null>(null);

  useFrame((_state, delta) => {
    drawnRef.current += 1;
    const presenter = presenterRef.current;
    if (presenter === null) {
      const held = heldCameraRef.current;
      if (held !== null) {
        const state = get();
        state.camera.position.set(...held.position);
        orbitTarget(state.controls)?.set(...held.target);
        state.camera.lookAt(...held.target);
        state.camera.updateMatrixWorld();
      }
      return;
    }
    const started = performance.now();
    if (presenter.mode === "realtime" && !presenter.playback.done()) {
      presenter.playback.advanceTo(presenter.playback.time() + Math.min(delta, 0.1));
    }
    applyPresenter(presenter);
    const camera = presenter.playback.camera() ?? heldCameraRef.current;
    if (camera !== null) {
      const state = get();
      state.camera.position.set(...camera.position);
      orbitTarget(state.controls)?.set(...camera.target);
      state.camera.lookAt(...camera.target);
      state.camera.updateMatrixWorld();
    }
    // The room's sun or moon shadows follow furniture in motion (HallSunLight).
    const live = presenter.playback.live();
    if (live.length > 0) {
      publishFurnitureSettleFrame(live);
      presenter.hadLive = true;
    } else if (presenter.hadLive) {
      publishFurnitureSettleFrame([]);
      presenter.hadLive = false;
    }
    presenter.lastApplyMs = performance.now() - started;
    if (presenter.mode === "realtime" && !presenter.playback.done()) invalidate();
  });

  useEffect(() => {
    const device = (): GpuQueue | null => {
      const native = getNativeRenderer(get().gl);
      const backend: unknown = native?.backend;
      if (typeof backend !== "object" || backend === null || !("device" in backend)) return null;
      return isGpuQueue(backend.device) ? backend.device : null;
    };
    const report = (): AssemblyStateReport => {
      const presenter = presenterRef.current;
      let sunIntensity: number | null = null;
      get().scene.traverse((object) => {
        const light = object as { readonly isDirectionalLight?: boolean; readonly castShadow?: boolean; readonly intensity?: number };
        if (light.isDirectionalLight === true && light.castShadow === true && typeof light.intensity === "number") sunIntensity = light.intensity;
      });
      if (presenter === null) {
        return { direction: null, seed: null, time: 0, done: true, settledAt: null, pieces: 0, matched: 0, unmatched: [], live: 0, clipSeconds: 0, anchorId: null, sunIntensity };
      }
      return {
        direction: presenter.playback.direction,
        seed: presenter.playback.seed,
        time: presenter.playback.time(),
        done: presenter.playback.done(),
        settledAt: presenter.playback.settledAt(),
        pieces: presenter.pieces.length,
        matched: presenter.slots.size,
        unmatched: presenter.unmatched,
        live: presenter.playback.live().length,
        clipSeconds: presenter.playback.clipSeconds,
        anchorId: presenter.playback.graph.anchorId,
        sunIntensity,
      };
    };
    const drawFrame = async (seconds: number, subframes: number, gapMs: number): Promise<AssemblyFrameReport> => {
      const presenter = presenterRef.current;
      let ms = 0;
      const native = getNativeRenderer(get().gl);
      for (let k = Math.max(1, subframes) - 1; k >= 0; k--) {
        presenter?.playback.advanceTo(Math.max(0, seconds - k / 60));
        // The canvas's frame pacer may hold a draw back while the previous
        // frame's GPU work has not yet retired; the frame number then does not
        // move, and the same pose is drawn again a moment later.
        for (let attempt = 0; attempt < 6; attempt++) {
          const state = get();
          if (state.frameloop !== "never") state.setFrameloop("never");
          const before = native === null ? null : rendererFrameId(native);
          const started = performance.now();
          advance(state.clock.elapsedTime + 1 / 60, true, state);
          await device()?.queue.onSubmittedWorkDone();
          ms = performance.now() - started;
          const after = native === null ? null : rendererFrameId(native);
          if (before === null || after !== before) break;
          skippedRef.current += 1;
          await new Promise((resolve) => { window.setTimeout(resolve, 20); });
        }
        if (gapMs > 0 && k > 0) await new Promise((resolve) => { window.setTimeout(resolve, gapMs); });
      }
      const drawn = drawnRef.current - reportedRef.current;
      reportedRef.current = drawnRef.current;
      const skipped = skippedRef.current;
      skippedRef.current = 0;
      return { ms, applyMs: presenter?.lastApplyMs ?? 0, drawn, skipped, frameId: native === null ? null : rendererFrameId(native) };
    };
    const api: AssemblyStudyApi = {
      load: () => {
        useSelectionStore.getState().clearSelection();
        usePlacementStore.setState({ placedItems: grandHallDinner180() });
        return usePlacementStore.getState().placedItems.length;
      },
      scene: (mood, at) => {
        useHallViewStore.getState().setMood(mood);
        useHallTimeStore.getState().setTime(Date.parse(at));
        invalidate();
      },
      prepare: (direction, seed, options = {}) => {
        if (!isAssemblyDirection(direction)) throw new Error(`Unknown direction ${direction}`);
        const previous = presenterRef.current;
        if (previous !== null) restoreAll(previous);
        const items = usePlacementStore.getState().placedItems;
        const state = get();
        const root = state.scene.getObjectByName("placed-furniture") ?? state.scene;
        const { slots, originals } = matchSlots(root, items);
        const pieces = diffLayouts([], items, describePiece).arriving;
        const unmatched = pieces.filter((piece) => !slots.has(piece.id)).map((piece) => piece.id);
        const playback = createAssemblyPlayback(pieces, directionModel(direction, pieces), seed, {
          reducedMotion: options.reducedMotion ?? prefersReducedMotion(),
        });
        useSelectionStore.getState().clearSelection();
        // The planner's working overlays (gap readouts, guides) stand down, as for a camera move.
        useCockpitStore.getState().setCameraInteractionActive(true);
        const presenter: Presenter = {
          playback,
          pieces,
          slots,
          unmatched,
          originals,
          candles: findCandles(state.scene, items),
          shadows: findShadows(state.scene, items),
          restored: new Set(),
          mode: "driven",
          hadLive: false,
          lastApplyMs: 0,
        };
        presenterRef.current = presenter;
        heldCameraRef.current = null;
        setBlueprint(playback.blueprint ? presenter : null);
        applyPresenter(presenter);
        invalidate();
        return report();
      },
      setTime: (seconds) => {
        const presenter = presenterRef.current;
        if (presenter === null) return;
        presenter.mode = "driven";
        presenter.playback.advanceTo(seconds);
        invalidate();
      },
      play: () => {
        const presenter = presenterRef.current;
        if (presenter === null) return;
        presenter.mode = "realtime";
        invalidate();
      },
      skip: () => { presenterRef.current?.playback.skip(); invalidate(); },
      cancel: () => { presenterRef.current?.playback.cancel(); invalidate(); },
      state: report,
      freeze: (on) => {
        get().setFrameloop(on ? "never" : "demand");
        if (!on) invalidate();
      },
      frame: (seconds, subframes = 1, gapMs = 0) => drawFrame(seconds, subframes, gapMs),
      measure: async (options = {}) => {
        const presenter = presenterRef.current;
        const seconds = options.seconds ?? presenter?.playback.clipSeconds ?? 7.5;
        const native = getNativeRenderer(get().gl);
        const backend: unknown = native?.backend;
        const timestamps = options.gpu === true && native !== null && isTimestampBackend(backend) && native.hasFeature("timestamp-query");
        if (timestamps && isTimestampBackend(backend)) backend.trackTimestamp = true;
        const times: number[] = [];
        const apply: number[] = [];
        const gpu: number[] = [];
        try {
          for (let frame = 0; frame <= Math.round(seconds * 60); frame++) {
            const result = await drawFrame(frame / 60, 1, 0);
            times.push(result.ms);
            apply.push(result.applyMs);
            if (timestamps) {
              const duration = await native.resolveTimestampsAsync("render");
              if (duration !== undefined && Number.isFinite(duration)) gpu.push(duration);
            }
          }
        } finally {
          if (timestamps && isTimestampBackend(backend)) backend.trackTimestamp = false;
        }
        const mean = times.reduce((sum, value) => sum + value, 0) / Math.max(1, times.length);
        return {
          frames: times.length,
          meanMs: round(mean),
          p50Ms: round(percentile(times, 50)),
          p95Ms: round(percentile(times, 95)),
          maxMs: round(Math.max(0, ...times)),
          applyP95Ms: round(percentile(apply, 95)),
          applyMaxMs: round(Math.max(0, ...apply)),
          gpuP95Ms: gpu.length > 0 ? round(percentile(gpu, 95)) : null,
          gpuMeanMs: gpu.length > 0 ? round(gpu.reduce((sum, value) => sum + value, 0) / gpu.length) : null,
        };
      },
      resetPipeline: async () => {
        // Giving up a rung and taking it back rebuilds PlannerRenderPipeline:
        // fresh temporal history and jitter, so a capture starts from nothing.
        const given = useRenderGovernorStore.getState().given;
        const wait = (ms: number): Promise<void> => new Promise((resolve) => { window.setTimeout(resolve, ms); });
        useRenderGovernorStore.getState().setGiven([...given, "bloom"]);
        await wait(80);
        useRenderGovernorStore.getState().setGiven(given);
        await wait(80);
      },
      alignTemporal: async () => {
        const native = getNativeRenderer(get().gl);
        if (native === null) return { frameId: null, restarted: 0 };
        // A rebuilt pipeline's nodes are registered once its build has landed, a few frames in.
        for (let frame = 0; frame < 60 && jitterNodes(native).length === 0; frame++) {
          await drawFrame(presenterRef.current?.playback.time() ?? 0, 1, 0);
        }
        const nodes = jitterNodes(native);
        for (const node of nodes) {
          node["_jitterIndex"] = 0;
          // A size it does not have makes the next frame restart its history from that frame alone.
          const resize = node["setSize"];
          if (typeof resize === "function") resize.call(node, 1, 1);
        }
        return { frameId: rendererFrameId(native), restarted: nodes.length };
      },
      transformHash: () => {
        const presenter = presenterRef.current;
        if (presenter === null) return "none";
        const arrays: ArrayLike<number>[] = [];
        for (const target of presenter.originals.keys()) arrays.push(target.array);
        if (presenter.shadows !== null) arrays.push(presenter.shadows.mesh.instanceMatrix.array);
        if (presenter.candles !== null) for (const mesh of presenter.candles.meshes) arrays.push(mesh.instanceMatrix.array);
        const camera = get().camera;
        arrays.push([...camera.position.toArray(), ...camera.quaternion.toArray()]);
        return hashArrays(arrays);
      },
      finish: () => {
        const presenter = presenterRef.current;
        if (presenter === null) return;
        presenter.playback.skip();
        restoreAll(presenter);
        publishFurnitureSettleFrame([]);
        invalidate();
      },
      release: () => {
        const presenter = presenterRef.current;
        if (presenter !== null) restoreAll(presenter);
        presenterRef.current = null;
        heldCameraRef.current = null;
        setBlueprint(null);
        publishFurnitureSettleFrame([]);
        useCockpitStore.getState().setCameraInteractionActive(false);
        get().setFrameloop("demand");
        invalidate();
      },
      camera: () => {
        const state = get();
        const target = orbitTarget(state.controls);
        return {
          position: [state.camera.position.x, state.camera.position.y, state.camera.position.z],
          target: target === null ? null : [target.x, target.y, target.z],
        };
      },
      look: (position, target) => {
        heldCameraRef.current = { position: [...position], target: [...target] };
        const state = get();
        state.camera.position.set(...position);
        orbitTarget(state.controls)?.set(...target);
        state.camera.lookAt(...target);
        state.camera.updateMatrixWorld();
        invalidate();
      },
    };
    window.__assembly = api;
    return () => {
      const presenter = presenterRef.current;
      if (presenter !== null) restoreAll(presenter);
      presenterRef.current = null;
      delete window.__assembly;
    };
  }, [get, invalidate]);

  return blueprint === null ? null : <AssemblyBlueprint presenter={blueprint} />;
}

export default AssemblyStudy;
