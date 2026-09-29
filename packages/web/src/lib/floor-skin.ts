import { BufferAttribute, BufferGeometry, Matrix4, Vector3 } from "three";
import { z } from "zod";
import { GENERATED_VENUE_SLUG } from "../data/generated/trades-hall-splat-bundles.js";
import { splatBaseUrl } from "../data/room-splat-bundles.js";
import type { DeviceTier } from "./device-tier.js";

/** A room's floor drawn as what it is: a measured surface wearing its own
 * photographs (T-639). Coordinates are in the room's capture frame, the frame
 * of its splat tiles, so the floor is drawn under the same transform. */
const vec3 = z.tuple([z.number(), z.number(), z.number()]);
/** The manifest is fetched from a public bucket and read as untrusted input:
 * every file it names is a bare name beside it, never a path, and every size
 * is bounded before anything is allocated from it. */
const fileName = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "A floor-skin file is named without a path.");
const tier = z.object({ size: z.number().int().positive().max(8_192), files: z.array(fileName).min(1) });
const tileSpan = z.number().int().positive().max(65_536);
const tileOrigin = z.number().int().nonnegative().max(65_535);

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
    widthPx: z.number().int().positive().max(65_536),
    heightPx: z.number().int().positive().max(65_536),
    texelM: z.number().positive(),
    origin: vec3, uAxis: vec3, vAxis: vec3,
  }),
  plane: z.object({ normal: vec3, d: z.number() }),
  tiles: z.array(z.object({ col0: tileOrigin, row0: tileOrigin, cols: tileSpan, rows: tileSpan })).min(1).max(16),
  tiers: z.object({ high: tier, medium: tier, low: tier }),
  height: z.object({
    file: fileName, cols: z.number().int().positive().max(4_096), rows: z.number().int().positive().max(4_096),
    cellPx: z.number().int().positive(), unitM: z.number().positive(), outside: z.number().int(),
  }),
  slab: z.object({
    file: fileName, width: z.number().int().positive().max(4_096), height: z.number().int().positive().max(4_096),
    below: z.number().nonnegative(), above: z.number().nonnegative(),
  }),
  colour: z.object({ matched: vec3 }),
  files: z.record(fileName, z.string()),
}).superRefine((manifest, context) => {
  // Tiles size the floor geometry, so each must lie inside the grid it cuts.
  manifest.tiles.forEach((tile, index) => {
    if (tile.col0 + tile.cols > manifest.grid.widthPx || tile.row0 + tile.rows > manifest.grid.heightPx) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["tiles", index], message: "A floor-skin tile lies outside its grid." });
    }
  });
});
export type FloorSkinManifest = z.infer<typeof FloorSkinManifestSchema>;
export type FloorSkinTier = keyof FloorSkinManifest["tiers"];
export type FloorColourMode = "photo" | "matched";

/**
 * Whether Blake's review may ask for the matched (colour-graded) floor instead
 * of the photographs as captured (T-639). The query is only honoured where
 * Gaussian splats may run at all — that is the same review audience, and the
 * public site must never see a query-driven variant.
 */
export function floorColourModeFromSearch(search: string, previewable: boolean): FloorColourMode {
  if (!previewable) return "photo";
  return new URLSearchParams(search).get("floor") === "matched" ? "matched" : "photo";
}

/** Rooms with a floor-skin package, by path beside their splat tiles. */
export const FLOOR_SKIN_ROOMS: Readonly<Record<string, string>> = { "grand-hall": "floor-skin/v1" };

export function floorSkinManifestUrl(roomSlug: string, configuredBaseUrl: string | undefined): string | null {
  const path = FLOOR_SKIN_ROOMS[roomSlug];
  if (path === undefined) return null;
  return `${splatBaseUrl(configuredBaseUrl)}/${GENERATED_VENUE_SLUG}/${roomSlug}/${path}/floor-skin.json`;
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

/**
 * Scene-frame splat centre → floor-skin mask (u, v, signed distance above the
 * plane, 1), from the host Scene's and the floor group's own world matrices
 * (see `SplatExclusion` in `splat-exclusion.ts`). Correct for any relationship
 * between the two — an arbitrary chain of ancestors, not just a group parented
 * directly under the Scene — because it is built from what each object's own
 * `matrixWorld` already resolves to, not from any assumption about the chain
 * in between.
 */
export function floorExclusionMatrix(manifest: FloorSkinManifest, sceneMatrixWorld: Matrix4, groupMatrixWorld: Matrix4): Matrix4 {
  const captureFromScene = new Matrix4().copy(sceneMatrixWorld).invert().multiply(groupMatrixWorld).invert();
  return captureToMaskMatrix(manifest).multiply(captureFromScene);
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
