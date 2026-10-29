// ---------------------------------------------------------------------------
// The walls in two-millimetre detail, streamed where they are looked at
//
// The wall atlas (hall-atlas.ts) holds the four walls at 5.2 mm a texel on
// desktops and 10.3 mm on phones: from a metre or two the deacon boards' names
// and the portraits' brushwork are beyond it. The survey also publishes the
// same best-view photograph at 2 mm (tools/grand-hall-survey project-detail.py,
// pack-detail.py) as tiles of 512 x 512 texels: 496 of their own (0.992 m of
// wall) inside an 8-texel gutter that repeats their neighbours', so bilinear
// filtering and mip levels to 3 never read past a tile. detail/index.json
// lists them; tiles all of window glass are left out.
//
// HallDetailLayer keeps a few of them on the GPU, in one array texture with a
// slot a tile (a device's budget of slots: hall-finish.ts), made when the
// first tile arrives (until then the shader reads a one-texel stand-in, so a
// visit that never comes close to a wall pays nothing for it), and an index
// texture saying, per wall, column and row, which slot holds that tile and how
// far it has faded in. Each frame it picks the tiles worth having: in view,
// on a wall facing the camera, below that wall's cut, and magnified, drawn at
// DETAIL_DENSITY screen pixels a millimetre or more (where the 2 mm detail
// shows more than the atlas). While the camera is still or slow it fetches
// the missing ones, most magnified first (at most DETAIL_MAX_REQUESTS at a
// time); a worker decodes each and builds its mip levels (hall-detail-
// decode.ts) off the main thread, and at most DETAIL_MAX_UPLOADS a frame (one
// once DETAIL_UPLOAD_BUDGET_MS of the frame has gone on them, as on a slow
// phone) are
// copied into free slots, the least recently wanted tile giving up its slot
// (fading out first if it is on screen). A new tile cross-fades over the atlas
// (DETAIL_FADE_STEP a frame at most, about 200 ms; at once under reduced
// motion). A tile that fails stays on the atlas and is retried with back-off,
// three times at most. Nothing is shown about it: the walls simply sharpen.
//
// The walls' shader (hall-materials.ts wallTexel) finds its fragment's tile
// from the atlas coordinate it already carries, reads the index, and samples
// the slot with gradients from the wall's continuous coordinates (so a tile's
// edge never drops to a coarse mip): two texture reads a wall fragment, no
// draw calls. Where a fragment's detail is drawn no larger than the device's
// atlas draws it (the detail's mip level whose texel is the atlas's own, 5.2 mm
// on computers and 10.3 mm on phones), the atlas shows as much, and the detail
// gives way to it over three quarters of a level: a resident tile's far end
// never shimmers on its last mip, and its edge against a tile not loaded is
// lost in the distance. Never over glass, where the atlas's alpha marks it.
// ---------------------------------------------------------------------------

import { z } from "zod";
import {
  Box2, Box3, ClampToEdgeWrapping, DataArrayTexture, DataTexture, Frustum, LinearFilter, LinearMipmapLinearFilter, Matrix4,
  NearestFilter, NoColorSpace, RGBAFormat, SRGBColorSpace, UnsignedByteType, Vector2, Vector3,
  type Camera, type Texture,
} from "three";
import type { Node, TextureNode } from "three/webgpu";
import { Fn, If, float, int, ivec2, length, log2, max, min, smoothstep, texture as textureNode, textureLoad, vec2, vec4 } from "three/tsl";
import { HALL_WALLS, type HallWallId } from "./hall-spec.js";
import { WALL_ATLAS_ORIGIN, WALL_ATLAS_PPM, WALL_ATLAS_SIZE, WALL_ATLAS_V_MAX, WALL_ATLAS_V_MIN } from "./hall-atlas.js";
import { hallSurveyUrl } from "./hall-photos.js";
import { DETAIL_LEVELS, DETAIL_TILE_TEXELS, type DetailDecodeResponse, type DetailWorkerMessage } from "./hall-detail-decode.js";

/** Metres a detail texel. */
export const DETAIL_TEXEL = 0.002;
/** Texels repeated from the neighbouring tiles on each side of a tile. */
export const DETAIL_GUTTER = 8;
/** A tile's own texels across. */
export const DETAIL_UNIQUE = DETAIL_TILE_TEXELS - 2 * DETAIL_GUTTER;
/** Metres of wall a tile holds across (0.992 m). */
export const DETAIL_PITCH = DETAIL_UNIQUE * DETAIL_TEXEL;
/** Tile rows over every wall, down from WALL_ATLAS_V_MAX. */
export const DETAIL_ROWS = Math.ceil((WALL_ATLAS_V_MAX - WALL_ATLAS_V_MIN) / DETAIL_PITCH - 1e-9);
/**
 * Screen pixels a millimetre of wall from which a tile is worth fetching:
 * the atlas's own 5.17 mm texel spread over a pixel (1 / 5.17 mm). Below it
 * the atlas already shows all the screen can.
 */
export const DETAIL_DENSITY = 0.19;
/** Largest change of a tile's fade in one frame: a fade takes 13 frames, about 200 ms at 60 a second. */
export const DETAIL_FADE_STEP = 1 / 13;
/** Seconds a fade takes at most frame rates. */
export const DETAIL_FADE_SECONDS = 0.2;
/** Tiles fetched or decoded at once. */
export const DETAIL_MAX_REQUESTS = 4;
/** Tiles copied to the GPU in one frame. */
export const DETAIL_MAX_UPLOADS = 2;
/**
 * Milliseconds of a frame the copies may take before the next waits for the
 * next frame (one always goes): on the phone profile at 4x CPU slowdown a
 * tile's copy took up to 10 ms, on the desktop 1-2 ms.
 */
export const DETAIL_UPLOAD_BUDGET_MS = 4;
/** Retries of a tile that failed (after 2 s, 8 s and 32 s). */
export const DETAIL_RETRIES = 3;
const RETRY_MS = 2000;
/** The camera is slow enough to fetch for below these: metres and radians a second. */
export const DETAIL_SLOW_SPEED = 1.5;
export const DETAIL_SLOW_TURN = Math.PI / 4;
/** How long after the camera stops the layer looks again for what it now wants, in milliseconds. */
export const DETAIL_WAKE_MS = 150;
/**
 * A tile still being fetched or decoded that has not been wanted for this many
 * drawn frames (and DETAIL_ABANDON_MS) is abandoned: its fetch is aborted and
 * it goes back to idle, not counted as a failure, so a slow walk past a wall
 * does not keep spending a phone's bandwidth and worker on tiles left behind.
 */
export const DETAIL_ABANDON_FRAMES = 8;
export const DETAIL_ABANDON_MS = 300;

/** The timers DetailWake sets (the page's own by default; a test's fake). */
export interface WakeClock {
  now(): number;
  set(fire: () => void, ms: number): ReturnType<typeof setTimeout>;
  clear(handle: ReturnType<typeof setTimeout>): void;
}

const PAGE_CLOCK: WakeClock = {
  now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
  set: (fire, ms) => setTimeout(fire, ms),
  clear: (handle) => { clearTimeout(handle); },
};

/**
 * The one timer that asks for a frame when the detail layer wants to look
 * again (DetailFrameResult.wakeMs): a tile's retry, seconds away, or 150 ms
 * after the camera stops. The earliest deadline asked for wins: a sooner one
 * replaces the timer that is waiting, a later one waits behind it. (Keeping
 * whichever came first dropped the look after a pan whenever a retry was
 * already waiting, and a phone, which draws no frames once the camera stops,
 * then waited up to 32 s for tiles at its new pose.)
 */
export class DetailWake {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private due = Number.POSITIVE_INFINITY;

  constructor(private readonly fire: () => void, private readonly clock: WakeClock = PAGE_CLOCK) {}

  /** Asks for a frame in `ms` milliseconds (16 at least), unless one is already due sooner. */
  request(ms: number): void {
    const now = this.clock.now();
    const due = now + Math.max(16, ms);
    if (this.timer !== null && this.due <= due) return;
    if (this.timer !== null) this.clock.clear(this.timer);
    this.due = due;
    this.timer = this.clock.set(() => {
      this.timer = null;
      this.due = Number.POSITIVE_INFINITY;
      this.fire();
    }, due - now);
  }

  /** Whether a frame is waiting to be asked for. */
  get pending(): boolean {
    return this.timer !== null;
  }

  /** Drops the waiting timer, if any (the layer is going away). */
  cancel(): void {
    if (this.timer !== null) this.clock.clear(this.timer);
    this.timer = null;
    this.due = Number.POSITIVE_INFINITY;
  }
}
/** GPU bytes one slot holds: its four RGBA8 levels. */
export const DETAIL_SLOT_BYTES = Array.from({ length: DETAIL_LEVELS }, (_, level) => (DETAIL_TILE_TEXELS >> level) ** 2 * 4).reduce((a, b) => a + b, 0);
/** Mip levels over which the detail gives way to the atlas, from the handover level (detailHandoverLevel). */
export const DETAIL_HANDOVER_LEVELS = 0.75;
/** The 4096 atlas's texel in millimetres (hall-atlas.ts): a computer's. */
export const DETAIL_ATLAS_TEXEL_MM = 1000 / WALL_ATLAS_PPM;

/** The detail's mip level whose texel is as large as the device's atlas texel (`atlasTexelMm`). */
export function detailHandoverLevel(atlasTexelMm: number): number {
  return Math.log2(Math.max(atlasTexelMm, DETAIL_TEXEL * 1000) / (DETAIL_TEXEL * 1000));
}
/**
 * How far in front of (+) and behind (-) its wall's plane a tile's box
 * reaches for the frustum test: the boards, frames, pilasters and doorcases
 * stand within 35 cm. (The chimneypiece and the curtains stand further out; a
 * tile seen only through them keeps the atlas.)
 */
const RELIEF_FRONT = 0.35;
const RELIEF_BACK = 0.05;

/** One wall's tiles: their columns and rows, and the first tile's key (keys run row by row). */
export interface DetailWallGrid {
  readonly wall: HallWallId;
  readonly columns: number;
  readonly rows: number;
  readonly first: number;
}

/** Every wall's tiles, in HALL_WALLS order (the order of `aWall`). */
export const DETAIL_WALLS: readonly DetailWallGrid[] = (() => {
  let first = 0;
  return HALL_WALLS.map((wall) => {
    const grid = { wall: wall.id, columns: Math.ceil(wall.length / DETAIL_PITCH - 1e-9), rows: DETAIL_ROWS, first };
    first += grid.columns * grid.rows;
    return grid;
  });
})();

/** Tiles over all four walls (keys 0 to DETAIL_TILE_COUNT - 1). */
export const DETAIL_TILE_COUNT = DETAIL_WALLS.reduce((sum, grid) => sum + grid.columns * grid.rows, 0);
/** The index texture: a column per tile column, DETAIL_ROWS rows per wall. */
export const DETAIL_INDEX_WIDTH = Math.max(...DETAIL_WALLS.map((grid) => grid.columns));
export const DETAIL_INDEX_HEIGHT = DETAIL_ROWS * DETAIL_WALLS.length;

function wallGrid(index: number): DetailWallGrid {
  const grid = DETAIL_WALLS[index];
  if (grid === undefined) throw new Error(`No hall wall ${String(index)}`);
  return grid;
}

/** The key of a wall's tile. */
export function detailKey(wall: number, column: number, row: number): number {
  const grid = wallGrid(wall);
  return grid.first + row * grid.columns + column;
}

/** The wall, column and row of a key. */
export function detailTile(key: number): { readonly wall: number; readonly column: number; readonly row: number } {
  for (let wall = DETAIL_WALLS.length - 1; wall >= 0; wall--) {
    const grid = wallGrid(wall);
    if (key >= grid.first) {
      const local = key - grid.first;
      return { wall, column: local % grid.columns, row: Math.floor(local / grid.columns) };
    }
  }
  throw new Error(`No detail tile ${String(key)}`);
}

/**
 * Wall-local (u, v) of atlas texture coordinates on wall `index` (in
 * HALL_WALLS): wallAtlasUv's inverse, as the shader computes it.
 */
export function wallLocalFromAtlas(index: number, s: number, t: number): [number, number] {
  const wall = HALL_WALLS[index];
  if (wall === undefined) throw new Error(`No hall wall ${String(index)}`);
  const [x0, y0] = WALL_ATLAS_ORIGIN[wall.id];
  return [(s * WALL_ATLAS_SIZE - x0) / WALL_ATLAS_PPM, WALL_ATLAS_V_MAX - ((1 - t) * WALL_ATLAS_SIZE - y0) / WALL_ATLAS_PPM];
}

/**
 * The tile over wall-local (u, v) on wall `index` and the texture
 * coordinates of the point inside it (gutter included; row 0 of a tile's
 * data at the top, as decoded), as the shader finds them.
 */
export function detailTileAt(index: number, u: number, v: number): { readonly column: number; readonly row: number; readonly x: number; readonly y: number } {
  const grid = wallGrid(index);
  const t = WALL_ATLAS_V_MAX - v;
  const column = Math.min(Math.max(Math.floor(u / DETAIL_PITCH), 0), grid.columns - 1);
  const row = Math.min(Math.max(Math.floor(t / DETAIL_PITCH), 0), grid.rows - 1);
  return {
    column, row,
    x: ((u - column * DETAIL_PITCH) / DETAIL_TEXEL + DETAIL_GUTTER) / DETAIL_TILE_TEXELS,
    y: ((t - row * DETAIL_PITCH) / DETAIL_TEXEL + DETAIL_GUTTER) / DETAIL_TILE_TEXELS,
  };
}

// ---------------------------------------------------------------------------
// The published index
// ---------------------------------------------------------------------------

const tileSchema = z.object({
  column: z.number().int().nonnegative(),
  row: z.number().int().nonnegative(),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

const wallSchema = z.object({
  columns: z.number().int().positive(),
  rows: z.number().int().positive(),
  tiles: z.array(tileSchema),
}).strict();

const indexSchema = z.object({
  format: z.literal("venviewer-hall-detail"),
  version: z.literal(1),
  texelMetres: z.number(),
  tileTexels: z.number().int(),
  gutterTexels: z.number().int(),
  pitchMetres: z.number(),
  origin: z.object({ u: z.number(), v: z.number() }).strict(),
  quality: z.number().int().min(1).max(100),
  walls: z.object({ window: wallSchema, door: wallSchema, end: wallSchema, fireplace: wallSchema }).strict(),
  tiles: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
}).strict();

/** The published tiles: which exist (by key), their sizes, and their checksums for the build's own checks. */
export interface HallDetailIndex {
  readonly present: Uint8Array;
  readonly bytes: Uint32Array;
  readonly sha256: ReadonlyMap<number, string>;
  readonly tiles: number;
  readonly totalBytes: number;
}

const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;

/**
 * Reads detail/index.json, refusing any file whose grid is not the one the
 * shader is built for (texel, tile, gutter, pitch, origin, every wall's
 * columns and rows), whose tiles fall outside it or repeat, or whose counts
 * disagree with its tiles.
 */
export function parseDetailIndex(json: unknown): HallDetailIndex {
  const parsed = indexSchema.parse(json);
  if (!near(parsed.texelMetres, DETAIL_TEXEL) || parsed.tileTexels !== DETAIL_TILE_TEXELS || parsed.gutterTexels !== DETAIL_GUTTER
    || !near(parsed.pitchMetres, DETAIL_PITCH) || !near(parsed.origin.u, 0) || !near(parsed.origin.v, WALL_ATLAS_V_MAX)) {
    throw new Error("The detail index's grid is not the planner's");
  }
  const present = new Uint8Array(DETAIL_TILE_COUNT);
  const bytes = new Uint32Array(DETAIL_TILE_COUNT);
  const sha256 = new Map<number, string>();
  let tiles = 0;
  let total = 0;
  DETAIL_WALLS.forEach((grid, wall) => {
    const entry = parsed.walls[grid.wall];
    if (entry.columns !== grid.columns || entry.rows !== grid.rows) throw new Error(`The detail index's ${grid.wall} wall is not ${String(grid.columns)} x ${String(grid.rows)} tiles`);
    for (const tile of entry.tiles) {
      if (tile.column >= grid.columns || tile.row >= grid.rows) throw new Error(`Detail tile ${grid.wall} ${String(tile.column)}_${String(tile.row)} is off the wall`);
      const key = detailKey(wall, tile.column, tile.row);
      if (present[key] === 1) throw new Error(`Detail tile ${grid.wall} ${String(tile.column)}_${String(tile.row)} is listed twice`);
      present[key] = 1;
      bytes[key] = tile.bytes;
      sha256.set(key, tile.sha256);
      tiles += 1;
      total += tile.bytes;
    }
  });
  if (tiles !== parsed.tiles || total !== parsed.totalBytes) throw new Error("The detail index's counts disagree with its tiles");
  return { present, bytes, sha256, tiles, totalBytes: total };
}

/** Where the index is published, at the survey's revision. */
export function detailIndexUrl(): string {
  return hallSurveyUrl("detail/index.json");
}

/** The published path of a tile, inside the survey folder. */
export function detailTilePath(key: number): string {
  const { wall, column, row } = detailTile(key);
  return `detail/${wallGrid(wall).wall}/${String(column)}_${String(row)}.webp`;
}

/** Where a tile is published, at the survey's revision. */
export function detailTileUrl(key: number): string {
  return hallSurveyUrl(detailTilePath(key));
}

// ---------------------------------------------------------------------------
// Which tiles a view wants
// ---------------------------------------------------------------------------

/** What the layer needs of a frame to choose its tiles. */
export interface DetailView {
  readonly camera: Camera;
  /** The drawing buffer's height in device pixels. */
  readonly heightPx: number;
  /** Each wall's cut height (HALL_WALLS order). */
  readonly cuts: readonly number[];
}

interface TileGeometry {
  readonly wall: number;
  readonly u0: number;
  readonly u1: number;
  readonly v0: number;
  readonly v1: number;
  readonly box: Box3;
}

const TILE_GEOMETRY: readonly TileGeometry[] = Array.from({ length: DETAIL_TILE_COUNT }, (_, key) => {
  const { wall, column, row } = detailTile(key);
  const spec = HALL_WALLS[wall];
  if (spec === undefined) throw new Error(`No hall wall ${String(wall)}`);
  const u0 = column * DETAIL_PITCH;
  const u1 = Math.min((column + 1) * DETAIL_PITCH, spec.length);
  const v1 = WALL_ATLAS_V_MAX - row * DETAIL_PITCH;
  const v0 = Math.max(WALL_ATLAS_V_MAX - (row + 1) * DETAIL_PITCH, WALL_ATLAS_V_MIN);
  const box = new Box3();
  for (const u of [u0, u1]) {
    for (const depth of [-RELIEF_BACK, RELIEF_FRONT]) {
      for (const v of [v0, v1]) {
        box.expandByPoint(new Vector3(
          spec.origin[0] + spec.tangent[0] * u + spec.normal[0] * depth, v,
          spec.origin[2] + spec.tangent[2] * u + spec.normal[2] * depth,
        ));
      }
    }
  }
  return { wall, u0, u1, v0, v1, box };
});

/** The tiles a view wants, most magnified first, and which tiles it can see at all. */
export interface DetailSelection {
  /** Keys of the wanted tiles, most magnified first. */
  readonly wanted: number[];
  /** Screen pixels a millimetre of each wanted tile at its nearest point (by key; 0 for the rest). */
  readonly density: Float32Array;
  /** 1 for every tile in view, on a wall facing the camera and below its cut (by key). */
  readonly visible: Uint8Array;
  /** 1 for every wanted tile (by key). */
  readonly wants: Uint8Array;
}

/** An empty selection to fill (reused from frame to frame). */
export function detailSelection(): DetailSelection {
  return { wanted: [], density: new Float32Array(DETAIL_TILE_COUNT), visible: new Uint8Array(DETAIL_TILE_COUNT), wants: new Uint8Array(DETAIL_TILE_COUNT) };
}

const frustum = new Frustum();
const projection = new Matrix4();
const cameraPosition = new Vector3();
const cameraDirection = new Vector3();

function isPerspective(camera: Camera): camera is Camera & { readonly isPerspectiveCamera: true; getEffectiveFOV(): number } {
  return "isPerspectiveCamera" in camera && camera.isPerspectiveCamera === true && "getEffectiveFOV" in camera;
}

function isOrthographic(camera: Camera): camera is Camera & { readonly isOrthographicCamera: true; top: number; bottom: number; zoom: number } {
  return "isOrthographicCamera" in camera && camera.isOrthographicCamera === true;
}

/**
 * The tiles `view` wants of those `index` publishes: in the camera's frustum,
 * on a wall it stands in front of, starting below that wall's cut, drawn at
 * DETAIL_DENSITY screen pixels a millimetre or more (a perspective camera's
 * pixels a radian over the distance to the tile's nearest point, times the
 * cosine of the wall's slant there; an orthographic camera's pixels a metre
 * times the slant). At most `limit`, the most magnified.
 */
export function selectDetailTiles(index: HallDetailIndex, view: DetailView, limit: number, into: DetailSelection = detailSelection()): DetailSelection {
  const { camera } = view;
  const { density, visible, wants, wanted } = into;
  density.fill(0);
  visible.fill(0);
  wants.fill(0);
  wanted.length = 0;
  if (limit <= 0 || view.heightPx <= 0) return into;
  camera.getWorldPosition(cameraPosition);
  camera.getWorldDirection(cameraDirection);
  projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projection, camera.coordinateSystem);
  const perspective = isPerspective(camera);
  const orthographic = isOrthographic(camera);
  if (!perspective && !orthographic) return into;
  const pxPerRadian = perspective ? view.heightPx / (2 * Math.tan((camera.getEffectiveFOV() * Math.PI) / 360)) : 0;
  const pxPerMetre = orthographic ? (view.heightPx * camera.zoom) / Math.max(camera.top - camera.bottom, 1e-6) : 0;
  for (let key = 0; key < DETAIL_TILE_COUNT; key++) {
    if (index.present[key] !== 1) continue;
    const tile = TILE_GEOMETRY[key];
    const spec = tile === undefined ? undefined : HALL_WALLS[tile.wall];
    if (tile === undefined || spec === undefined) continue;
    const rx = cameraPosition.x - spec.origin[0];
    const rz = cameraPosition.z - spec.origin[2];
    // In front of the wall: its room face can be seen.
    const front = rx * spec.normal[0] + rz * spec.normal[2];
    if (front <= 0.05) continue;
    if (tile.v0 >= (view.cuts[tile.wall] ?? Infinity)) continue;
    if (!frustum.intersectsBox(tile.box)) continue;
    visible[key] = 1;
    let pxPerMm: number;
    if (perspective) {
      const along = rx * spec.tangent[0] + rz * spec.tangent[2];
      const du = along - Math.min(Math.max(along, tile.u0), tile.u1);
      const dv = cameraPosition.y - Math.min(Math.max(cameraPosition.y, tile.v0), tile.v1);
      pxPerMm = (pxPerRadian * front) / (du * du + dv * dv + front * front) / 1000;
    } else {
      pxPerMm = (pxPerMetre * Math.abs(cameraDirection.x * spec.normal[0] + cameraDirection.z * spec.normal[2])) / 1000;
    }
    if (pxPerMm < DETAIL_DENSITY) continue;
    density[key] = pxPerMm;
    wanted.push(key);
  }
  wanted.sort((a, b) => (density[b] ?? 0) - (density[a] ?? 0) || a - b);
  if (wanted.length > limit) wanted.length = limit;
  for (const key of wanted) wants[key] = 1;
  return into;
}

// ---------------------------------------------------------------------------
// The layer
// ---------------------------------------------------------------------------

/** Decodes a tile's bytes to its RGBA levels, largest first. */
export interface DetailDecoder {
  decode(bytes: ArrayBuffer): Promise<readonly Uint8Array<ArrayBuffer>[]>;
  /** Takes back a tile's levels once they are on the GPU (or no longer wanted), to decode the next tiles into. */
  recycle(levels: readonly Uint8Array<ArrayBuffer>[]): void;
  /**
   * The decoder itself has stopped (its worker died, or cannot decode on this
   * browser): no tile will ever decode, so the layer stops asking rather than
   * fetching every tile again for its retries. Absent: never.
   */
  readonly broken?: boolean;
  dispose(): void;
}

/** The part of the renderer the layer uses: copying a decoded tile's levels into its slot. */
export interface DetailRenderer {
  copyTextureToTexture(srcTexture: Texture, dstTexture: Texture, srcRegion?: Box2 | null, dstPosition?: Vector3 | null, srcLevel?: number, dstLevel?: number): void;
}

/**
 * Whether `new Worker(url, { type: "module" })` is understood: a browser that
 * reads the option reads its `type` (the usual test; the throwaway worker is
 * terminated at once, or its URL refused, either way harmlessly).
 */
function moduleWorkers(): boolean {
  let read = false;
  const probe: WorkerOptions = { get type(): WorkerType { read = true; return "module"; } };
  try {
    new Worker("blob://", probe).terminate();
  } catch {
    // The URL is refused; the option was still read where module workers exist.
  }
  return read;
}

/**
 * Whether this browser can run the decoding worker: module workers, and in
 * them an OffscreenCanvas with a 2D context and createImageBitmap (iOS Safari
 * before 16.4 and some WebViews have no OffscreenCanvas). Without them the
 * walls stay on the atlas rather than fetching tiles nothing can decode.
 */
export function detailWorkerSupported(): boolean {
  return typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined"
    && typeof OffscreenCanvasRenderingContext2D !== "undefined" && typeof createImageBitmap === "function" && moduleWorkers();
}

/**
 * The decoding worker (hall-detail.worker.ts), started on the first tile; null
 * where it cannot run. If the worker dies, or answers that it cannot decode at
 * all, every waiting decode is rejected, the worker is let go and the decoder
 * reports itself `broken`, so no later decode waits for an answer that will
 * never come.
 */
export function workerDecoder(): DetailDecoder | null {
  if (!detailWorkerSupported()) return null;
  let worker: Worker | null = null;
  let broken = false;
  let next = 1;
  const waiting = new Map<number, { resolve: (levels: Uint8Array<ArrayBuffer>[]) => void; reject: (reason: Error) => void }>();
  const failAll = (reason: Error): void => {
    for (const entry of waiting.values()) entry.reject(reason);
    waiting.clear();
  };
  const stop = (reason: Error): void => {
    broken = true;
    worker?.terminate();
    worker = null;
    failAll(reason);
  };
  const start = (): Worker => {
    const created = new Worker(new URL("./hall-detail.worker.ts", import.meta.url), { type: "module" });
    created.onmessage = (event: MessageEvent<DetailDecodeResponse>) => {
      const answer = event.data;
      if (!answer.ok && answer.fatal === true) { stop(new Error(answer.error)); return; }
      const entry = waiting.get(answer.id);
      if (entry === undefined) return;
      waiting.delete(answer.id);
      if (answer.ok) entry.resolve(answer.levels.map((buffer) => new Uint8Array(buffer)));
      else entry.reject(new Error(answer.error));
    };
    created.onerror = () => { stop(new Error("The detail decoder stopped")); };
    created.onmessageerror = () => { stop(new Error("The detail decoder could not read a message")); };
    return created;
  };
  return {
    get broken(): boolean {
      return broken;
    },
    decode(bytes: ArrayBuffer): Promise<readonly Uint8Array<ArrayBuffer>[]> {
      if (broken) return Promise.reject(new Error("The detail decoder has stopped"));
      worker ??= start();
      const id = next;
      next += 1;
      const running = worker;
      return new Promise((resolve, reject) => {
        waiting.set(id, { resolve, reject });
        const request: DetailWorkerMessage = { kind: "decode", id, bytes };
        running.postMessage(request, [bytes]);
      });
    },
    recycle(levels: readonly Uint8Array<ArrayBuffer>[]): void {
      if (worker === null) return;
      const buffers = levels.map((level) => level.buffer);
      if (buffers.some((buffer) => buffer.byteLength === 0)) return;
      const message: DetailWorkerMessage = { kind: "recycle", levels: buffers };
      worker.postMessage(message, buffers);
    },
    dispose(): void {
      worker?.terminate();
      worker = null;
      failAll(new Error("The detail decoder was closed"));
    },
  };
}

async function fetchBytes(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${url}: ${String(response.status)}`);
  return response.arrayBuffer();
}

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${url}: ${String(response.status)}`);
  const body: unknown = await response.json();
  return body;
}

export interface HallDetailOptions {
  /** Array slots on the GPU (the device's budget: hall-finish.ts). */
  readonly slots: number;
  /** The wall atlas's texel on this device, in millimetres (DETAIL_ATLAS_TEXEL_MM over the photographs' quality). */
  readonly atlasTexelMm?: number;
  readonly fetchBytes?: (url: string, signal: AbortSignal) => Promise<ArrayBuffer>;
  readonly fetchIndex?: (url: string, signal: AbortSignal) => Promise<unknown>;
  /** The tiles' decoder; by default the worker (none: the layer stays empty). */
  readonly decoder?: DetailDecoder | null;
  /** Milliseconds, for back-off and the camera's speed. */
  readonly now?: () => number;
}

/** One frame's update. */
export interface DetailFrame extends DetailView {
  /** Seconds since the last drawn frame (hall-mood.ts hallFrameStep). */
  readonly delta: number;
  /** Under reduced motion a tile shows at once; asked only when a tile arrives or fades (a function: asked then). */
  readonly reducedMotion: boolean | (() => boolean);
  /** Where tiles are copied to the GPU; null leaves decoded tiles waiting. */
  readonly renderer: DetailRenderer | null;
}

export interface DetailFrameResult {
  /** A fade or an upload is under way: draw another frame. */
  readonly active: boolean;
  /** Look again after this many milliseconds (tiles wanted but held back), or null. */
  readonly wakeMs: number | null;
}

/** The layer's own accounting. */
export interface HallDetailStats {
  readonly slots: number;
  /** GPU bytes the layer may hold: its slots, the staging tile and the index. */
  readonly budgetBytes: number;
  readonly residentTiles: number;
  /** GPU bytes of the resident tiles. */
  readonly residentBytes: number;
  /** GPU bytes held now: the slots' array once a tile has arrived, the staging tile once used, the index. */
  readonly gpuBytes: number;
  readonly wanted: number;
  /** Of the wanted tiles, those resident. */
  readonly wantedResident: number;
  readonly inFlight: number;
  /** Decoded tiles waiting for a slot or a frame. */
  readonly waiting: number;
  readonly fading: number;
  readonly indexLoaded: boolean;
  readonly requested: number;
  readonly fetched: number;
  readonly bytesFetched: number;
  readonly failures: number;
  /** Fetches given up because their tile was no longer wanted (not failures). */
  readonly abandoned: number;
  readonly uploads: number;
  readonly evictions: number;
  readonly lastUploadMs: number;
  readonly maxUploadMs: number;
  readonly maxUpdateMs: number;
}

const IDLE = 0;
const FETCHING = 1;
const DECODED = 2;
const RESIDENT = 3;
const FAILED = 4;

const slotOrigin = new Vector3();
const levelRegions = Array.from({ length: DETAIL_LEVELS }, (_, level) => new Box2(new Vector2(0, 0), new Vector2(DETAIL_TILE_TEXELS >> level, DETAIL_TILE_TEXELS >> level)));

/** The TSL nodes a wall material samples the detail through. */
export interface HallDetailSample {
  /** The detail's colour at this fragment (sRGB decoded to the working space). */
  readonly color: Node<"vec4">;
  /** How much of it to show: the tile's fade, 0 where no tile is resident. */
  readonly weight: Node<"float">;
}

/** The resident tiles' array: a 512 x 512 layer a slot, with four mip levels, filled only by copies. */
function createSlotArray(layers: number): DataArrayTexture {
  // One layer's worth of zeros is all the first upload needs: only layer 0 is
  // written (layerUpdates) and the GPU clears the rest; tiles arrive by copy.
  const array = new DataArrayTexture(new Uint8Array(DETAIL_TILE_TEXELS * DETAIL_TILE_TEXELS * 4), DETAIL_TILE_TEXELS, DETAIL_TILE_TEXELS, layers);
  array.format = RGBAFormat;
  array.type = UnsignedByteType;
  array.colorSpace = SRGBColorSpace;
  array.wrapS = ClampToEdgeWrapping;
  array.wrapT = ClampToEdgeWrapping;
  array.magFilter = LinearFilter;
  array.minFilter = LinearMipmapLinearFilter;
  array.anisotropy = 8;
  // Four levels, each tile's own from the worker: with generateMipmaps three
  // would regenerate every level of every layer at each upload.
  array.generateMipmaps = false;
  array.mipmaps = Array.from({ length: DETAIL_LEVELS }, (_, level) => ({ data: new Uint8Array(0), width: DETAIL_TILE_TEXELS >> level, height: DETAIL_TILE_TEXELS >> level }));
  array.addLayerUpdate(0);
  array.needsUpdate = true;
  array.name = "grand-hall-detail";
  return array;
}

/** What the shader samples until the first tile arrives: one transparent texel, sampled as the array is. */
function createStandIn(): DataArrayTexture {
  const standIn = new DataArrayTexture(new Uint8Array(4), 1, 1, 1);
  standIn.format = RGBAFormat;
  standIn.type = UnsignedByteType;
  standIn.colorSpace = SRGBColorSpace;
  standIn.wrapS = ClampToEdgeWrapping;
  standIn.wrapT = ClampToEdgeWrapping;
  standIn.magFilter = LinearFilter;
  standIn.minFilter = LinearMipmapLinearFilter;
  standIn.anisotropy = 8;
  standIn.generateMipmaps = false;
  standIn.needsUpdate = true;
  standIn.name = "grand-hall-detail-stand-in";
  return standIn;
}

export class HallDetailLayer {
  /** Per wall, column and row: slot + 1 (red, 0 for none) and fade (green). */
  readonly index: DataTexture;
  /** Called when something arrives that the next frame should use. */
  onChange: (() => void) | null = null;
  readonly slots: number;
  /** The detail's mip level from which it gives way to the atlas (detailHandoverLevel). */
  readonly handoverLevel: number;
  /** The resident tiles (createSlotArray), made when the first tile is copied. */
  private array: DataArrayTexture | null = null;
  /** Sampled until then. */
  private readonly standIn: DataArrayTexture;
  /** Every texture node sampling the slots, pointed at the array once it exists. */
  private readonly arrayNodes: TextureNode[] = [];
  private stagingUsed = false;
  private heldFade: number | null = null;
  private readonly staging: DataTexture;
  private readonly indexData: Uint8Array<ArrayBuffer>;
  private readonly options: HallDetailOptions;
  private readonly decoder: DetailDecoder | null;
  private readonly now: () => number;
  private published: HallDetailIndex | null = null;
  private readonly selection = detailSelection();
  private readonly status = new Uint8Array(DETAIL_TILE_COUNT);
  private readonly slot = new Int16Array(DETAIL_TILE_COUNT).fill(-1);
  private readonly fade = new Float32Array(DETAIL_TILE_COUNT);
  private readonly target = new Uint8Array(DETAIL_TILE_COUNT);
  private readonly lastWanted = new Float64Array(DETAIL_TILE_COUNT);
  /** When each tile was last wanted, milliseconds (for abandoning a fetch, with the frame). */
  private readonly lastWantedMs = new Float64Array(DETAIL_TILE_COUNT);
  private readonly attempts = new Uint8Array(DETAIL_TILE_COUNT);
  private readonly retryAt = new Float64Array(DETAIL_TILE_COUNT);
  private readonly slotTile: Int32Array;
  private readonly controllers = new Map<number, AbortController>();
  private readonly decoded = new Map<number, readonly Uint8Array<ArrayBuffer>[]>();
  private readonly indexController = new AbortController();
  private readonly lastPosition = new Vector3();
  private readonly lastDirection = new Vector3();
  private lastTime: number | null = null;
  private frame = 0;
  private readonly counters = { requested: 0, fetched: 0, bytesFetched: 0, failures: 0, abandoned: 0, uploads: 0, evictions: 0, lastUploadMs: 0, maxUploadMs: 0, maxUpdateMs: 0 };
  private disposed = false;
  /** The decoder stopped for good (DetailDecoder.broken): the walls stay as they are, nothing more is fetched. */
  private stopped = false;

  constructor(options: HallDetailOptions) {
    this.options = options;
    this.slots = Number.isFinite(options.slots) ? Math.max(0, Math.floor(options.slots)) : 0;
    this.decoder = this.slots > 0 ? (options.decoder === undefined ? workerDecoder() : options.decoder) : null;
    this.now = options.now ?? (() => performance.now());
    this.slotTile = new Int32Array(Math.max(this.slots, 1)).fill(-1);
    this.handoverLevel = detailHandoverLevel(options.atlasTexelMm ?? DETAIL_ATLAS_TEXEL_MM);
    this.standIn = createStandIn();
    const staging = new DataTexture(new Uint8Array(DETAIL_TILE_TEXELS * DETAIL_TILE_TEXELS * 4), DETAIL_TILE_TEXELS, DETAIL_TILE_TEXELS, RGBAFormat, UnsignedByteType);
    staging.colorSpace = SRGBColorSpace;
    staging.generateMipmaps = false;
    staging.magFilter = LinearFilter;
    staging.minFilter = LinearMipmapLinearFilter;
    staging.name = "grand-hall-detail-staging";
    this.staging = staging;
    this.indexData = new Uint8Array(DETAIL_INDEX_WIDTH * DETAIL_INDEX_HEIGHT * 4);
    const index = new DataTexture(this.indexData, DETAIL_INDEX_WIDTH, DETAIL_INDEX_HEIGHT, RGBAFormat, UnsignedByteType);
    index.colorSpace = NoColorSpace;
    index.magFilter = NearestFilter;
    index.minFilter = NearestFilter;
    index.generateMipmaps = false;
    index.needsUpdate = true;
    index.name = "grand-hall-detail-index";
    this.index = index;
  }

  /** Whether the layer can ever show detail (slots and a decoder that has not stopped). */
  get enabled(): boolean {
    return this.slots > 0 && this.decoder !== null && !this.disposed && !this.stopped;
  }

  /** Fetches the published index; tiles are chosen once it is in. */
  start(): void {
    if (!this.enabled || this.published !== null) return;
    const load = this.options.fetchIndex ?? fetchJson;
    load(detailIndexUrl(), this.indexController.signal).then((json) => {
      if (this.disposed) return;
      this.published = parseDetailIndex(json);
      this.onChange?.();
    }).catch(() => { /* Without the index the walls stay on the atlas. */ });
  }

  /** Uses an index already in hand (tests, or a caller that fetched it). */
  setIndex(index: HallDetailIndex): void {
    this.published = index;
  }

  /** The detail at a wall fragment, from its atlas coordinates and wall (`aAtlas`, `aWall`). */
  sample(atlas: Node<"vec2">, wall: Node<"float">): HallDetailSample {
    const pick = (values: readonly number[]): Node<"float"> => wall.lessThan(0.5).select(float(values[0] ?? 0),
      wall.lessThan(1.5).select(float(values[1] ?? 0), wall.lessThan(2.5).select(float(values[2] ?? 0), float(values[3] ?? 0))));
    const x0 = pick(HALL_WALLS.map((spec) => WALL_ATLAS_ORIGIN[spec.id][0]));
    const y0 = pick(HALL_WALLS.map((spec) => WALL_ATLAS_ORIGIN[spec.id][1]));
    const columns = pick(DETAIL_WALLS.map((grid) => grid.columns));
    const rowBase = pick(DETAIL_WALLS.map((_, index) => index * DETAIL_ROWS));
    // wallLocalFromAtlas and detailTileAt per fragment: u along the wall and
    // t down from WALL_ATLAS_V_MAX, in metres.
    const u = atlas.x.mul(WALL_ATLAS_SIZE).sub(x0).div(WALL_ATLAS_PPM);
    const t = float(1).sub(atlas.y).mul(WALL_ATLAS_SIZE).sub(y0).div(WALL_ATLAS_PPM);
    const column = u.div(DETAIL_PITCH).floor().clamp(float(0), columns.sub(1));
    const row = t.div(DETAIL_PITCH).floor().clamp(float(0), float(DETAIL_ROWS - 1));
    const entry = textureLoad(this.index, ivec2(int(column), int(row.add(rowBase))));
    const slot = entry.r.mul(255).add(0.5).floor().sub(1);
    const local = vec2(u.sub(column.mul(DETAIL_PITCH)), t.sub(row.mul(DETAIL_PITCH))).div(DETAIL_TEXEL).add(DETAIL_GUTTER).div(DETAIL_TILE_TEXELS);
    // Gradients from the wall's own coordinates, continuous across tiles, so
    // a tile's edge samples its proper level rather than the coarsest. Held in
    // variables: taken here, in the fragment's uniform flow (as a derivative
    // must be), and handed to the sample inside its branch below.
    const metric = vec2(u, t).div(DETAIL_TEXEL * DETAIL_TILE_TEXELS);
    const dx = metric.dFdx().toVar();
    const dy = metric.dFdy().toVar();
    const slotTexel = textureNode(this.array ?? this.standIn, local).depth(int(slot.max(0))).grad(dx, dy);
    this.arrayNodes.push(slotTexel);
    // The level the sampler reads (anisotropic up to 8:1, as the array is
    // filtered): from the handover level on, the atlas shows as much.
    const along = length(dx.mul(DETAIL_TILE_TEXELS));
    const across = length(dy.mul(DETAIL_TILE_TEXELS));
    const level = log2(max(min(along, across), max(along, across).div(8), float(1e-6)));
    const sharp = float(1).sub(smoothstep(float(this.handoverLevel), float(this.handoverLevel + DETAIL_HANDOVER_LEVELS), level));
    // Only on the walls themselves (a vertex off every wall has aWall -1).
    const weight = slot.greaterThanEqual(0).and(wall.greaterThan(-0.5)).select(entry.g.mul(sharp), float(0)).toVar();
    // The array is read only where a tile shows: everywhere else (most of
    // every wall, and all of it until a tile arrives) a fragment pays for the
    // index's one texel and no more. Explicit gradients make the branch legal.
    const color = Fn(() => {
      const texel = vec4(0, 0, 0, 0).toVar();
      If(weight.greaterThan(0), () => { texel.assign(slotTexel); });
      return texel;
    })();
    return { color, weight };
  }

  /**
   * One frame: chooses the tiles this view wants, starts fetches while the
   * camera is still or slow, copies decoded tiles into slots and steps the
   * fades. Cheap when nothing changes.
   */
  update(frame: DetailFrame): DetailFrameResult {
    const index = this.published;
    if (!this.enabled || index === null) return { active: false, wakeMs: null };
    const now = this.now();
    this.frame += 1;
    // How fast the camera moves, from the last frame drawn (a long gap: it stopped).
    frame.camera.getWorldPosition(cameraPosition);
    frame.camera.getWorldDirection(cameraDirection);
    let slow = true;
    if (this.lastTime !== null) {
      const seconds = (now - this.lastTime) / 1000;
      if (seconds > 0 && seconds < 0.25) {
        const speed = cameraPosition.distanceTo(this.lastPosition) / seconds;
        const turn = Math.acos(Math.min(1, Math.max(-1, cameraDirection.dot(this.lastDirection)))) / seconds;
        slow = speed < DETAIL_SLOW_SPEED && turn < DETAIL_SLOW_TURN;
      }
    }
    this.lastPosition.copy(cameraPosition);
    this.lastDirection.copy(cameraDirection);
    this.lastTime = now;

    const selection = selectDetailTiles(index, frame, this.slots, this.selection);
    const held = this.heldFade;
    const { wants, visible, density } = selection;
    for (const key of selection.wanted) {
      this.lastWanted[key] = this.frame;
      this.lastWantedMs[key] = now;
    }
    let reduced: boolean | null = null;
    const reducedMotion = (): boolean => {
      reduced ??= typeof frame.reducedMotion === "function" ? frame.reducedMotion() : frame.reducedMotion;
      return reduced;
    };
    // A fetch whose tile has not been wanted for a while is abandoned (not a failure).
    for (const [key, controller] of [...this.controllers]) {
      if (wants[key] === 1) continue;
      if (this.frame - (this.lastWanted[key] ?? 0) < DETAIL_ABANDON_FRAMES || now - (this.lastWantedMs[key] ?? 0) < DETAIL_ABANDON_MS) continue;
      controller.abort();
      this.controllers.delete(key);
      this.status[key] = IDLE;
      this.counters.abandoned += 1;
    }
    let changed = false;
    // A wanted tile shows; one out of sight drops out at once; one in sight
    // and no longer wanted stays until its slot is needed.
    for (let s = 0; s < this.slots; s++) {
      const key = this.slotTile[s] ?? -1;
      if (key < 0) continue;
      if (wants[key] === 1) {
        if (this.target[key] !== 1) { this.target[key] = 1; changed = true; }
      } else if (visible[key] !== 1 && (this.fade[key] !== 0 || this.target[key] !== 0)) {
        this.fade[key] = 0;
        this.target[key] = 0;
        this.writeIndex(key);
        changed = true;
      }
    }
    // Decoded tiles no longer wanted are dropped; the rest go to the GPU, most magnified first.
    if (this.decoded.size > 0) {
      for (const [key, levels] of [...this.decoded]) {
        if (wants[key] !== 1) {
          this.decoded.delete(key);
          this.status[key] = IDLE;
          this.decoder?.recycle(levels);
        }
      }
    }
    if (frame.renderer !== null && this.decoded.size > 0) {
      const ready = [...this.decoded.keys()].sort((a, b) => (density[b] ?? 0) - (density[a] ?? 0) || a - b);
      let uploads = 0;
      for (const key of ready) {
        if (uploads >= DETAIL_MAX_UPLOADS || (uploads > 0 && this.now() - now > DETAIL_UPLOAD_BUDGET_MS)) break;
        const free = this.freeSlot(wants, visible);
        if (free < 0) break;
        const levels = this.decoded.get(key);
        this.decoded.delete(key);
        if (levels === undefined) continue;
        const began = this.now();
        try {
          this.upload(frame.renderer, free, levels);
        } catch {
          // A renderer that cannot copy into the array leaves the walls on the atlas.
          this.status[key] = FAILED;
          this.attempts[key] = DETAIL_RETRIES + 1;
          continue;
        } finally {
          // The copies took the levels' bytes at once (writeTexture, texSubImage): the buffers go back to the worker.
          this.decoder?.recycle(levels);
        }
        const took = this.now() - began;
        this.counters.lastUploadMs = took;
        this.counters.maxUploadMs = Math.max(this.counters.maxUploadMs, took);
        this.counters.uploads += 1;
        this.slotTile[free] = key;
        this.slot[key] = free;
        this.status[key] = RESIDENT;
        this.target[key] = 1;
        this.fade[key] = reducedMotion() ? 1 : 0;
        this.writeIndex(key);
        uploads += 1;
        changed = true;
      }
    }
    // Fetch what is wanted and missing, while the camera is still or slow.
    let heldBack = false;
    let retryIn: number | null = null;
    for (const key of selection.wanted) {
      const status = this.status[key];
      if (status === RESIDENT || status === FETCHING || status === DECODED) continue;
      if (status === FAILED) {
        if ((this.attempts[key] ?? 0) > DETAIL_RETRIES) continue;
        const wait = (this.retryAt[key] ?? 0) - now;
        if (wait > 0) { retryIn = retryIn === null ? wait : Math.min(retryIn, wait); continue; }
      }
      if (!slow) { heldBack = true; continue; }
      if (this.controllers.size >= DETAIL_MAX_REQUESTS) break;
      this.request(key);
    }
    // Step the fades: in by at most DETAIL_FADE_STEP a frame, out the same.
    let step: number | null = null;
    let fading = 0;
    for (let s = 0; s < this.slots; s++) {
      const key = this.slotTile[s] ?? -1;
      if (key < 0) continue;
      // A held fade (holdFade) stands in for the target of every tile fading in.
      const goal = held !== null && this.target[key] === 1 ? held : this.target[key] ?? 0;
      const current = this.fade[key] ?? 0;
      if (current === goal) continue;
      step ??= reducedMotion() ? 1 : Math.min(Math.max(frame.delta, 0) / DETAIL_FADE_SECONDS, DETAIL_FADE_STEP);
      const stepped = held !== null ? goal : goal > current ? Math.min(goal, current + step) : Math.max(goal, current - step);
      const next = Math.abs(goal - stepped) < 1e-6 ? goal : stepped;
      this.fade[key] = next;
      this.writeIndex(key);
      changed = true;
      if (next !== goal) fading += 1;
    }
    if (changed) this.index.needsUpdate = true;
    this.counters.maxUpdateMs = Math.max(this.counters.maxUpdateMs, this.now() - now);
    const waitingUploads = frame.renderer !== null && this.decoded.size > 0;
    return { active: fading > 0 || waitingUploads || changed, wakeMs: heldBack ? DETAIL_WAKE_MS : retryIn };
  }

  /**
   * A slot for a new tile: an empty one, or that of the least recently wanted
   * tile now unwanted and out of sight or faded out. Failing that, the least
   * recently wanted unwanted tile in sight starts to fade out, and its slot is
   * free once it has (-1 meanwhile).
   */
  private freeSlot(wants: Uint8Array, visible: Uint8Array): number {
    let best = -1;
    let bestAge = Infinity;
    let fadeCandidate = -1;
    let fadeAge = Infinity;
    for (let s = 0; s < this.slots; s++) {
      const key = this.slotTile[s] ?? -1;
      if (key < 0) return s;
      if (wants[key] === 1) continue;
      const age = this.lastWanted[key] ?? 0;
      if (visible[key] !== 1 || this.fade[key] === 0) {
        if (age < bestAge) { best = s; bestAge = age; }
      } else if (age < fadeAge) {
        fadeCandidate = s;
        fadeAge = age;
      }
    }
    if (best >= 0) {
      this.release(best);
      return best;
    }
    const key = fadeCandidate >= 0 ? this.slotTile[fadeCandidate] ?? -1 : -1;
    if (key >= 0) this.target[key] = 0;
    return -1;
  }

  private release(slot: number): void {
    const key = this.slotTile[slot] ?? -1;
    if (key < 0) return;
    this.slotTile[slot] = -1;
    this.slot[key] = -1;
    this.fade[key] = 0;
    this.target[key] = 0;
    this.status[key] = IDLE;
    this.writeIndex(key);
    this.index.needsUpdate = true;
    this.counters.evictions += 1;
  }

  private request(key: number): void {
    const decoder = this.decoder;
    if (decoder === null) return;
    const controller = new AbortController();
    this.controllers.set(key, controller);
    // Still this tile's own fetch: not abandoned (update) nor superseded by a later request.
    const current = (): boolean => this.controllers.get(key) === controller;
    this.status[key] = FETCHING;
    this.counters.requested += 1;
    const load = this.options.fetchBytes ?? fetchBytes;
    load(detailTileUrl(key), controller.signal).then((bytes) => {
      if (this.disposed || controller.signal.aborted) throw new Error("Detail tile abandoned");
      this.counters.fetched += 1;
      this.counters.bytesFetched += bytes.byteLength;
      return decoder.decode(bytes);
    }).then((levels) => {
      if (this.disposed || !current()) {
        // Abandoned while it decoded: its buffers go back for the next tile.
        if (!this.disposed) decoder.recycle(levels);
        return;
      }
      this.controllers.delete(key);
      if (levels.length !== DETAIL_LEVELS || levels[0]?.length !== DETAIL_TILE_TEXELS * DETAIL_TILE_TEXELS * 4) throw new Error("A detail tile decoded to the wrong size");
      this.decoded.set(key, levels);
      this.status[key] = DECODED;
      this.attempts[key] = 0;
      this.onChange?.();
    }).catch(() => {
      if (this.disposed || !current()) return;
      this.controllers.delete(key);
      if (decoder.broken === true) {
        // The decoder itself has stopped: no tile will decode, so none is fetched again.
        this.stopped = true;
        this.status[key] = IDLE;
        for (const other of this.controllers.values()) other.abort();
        this.controllers.clear();
        this.onChange?.();
        return;
      }
      // It stays on the atlas; retried after 2, 8 and 32 seconds.
      this.counters.failures += 1;
      const attempt = (this.attempts[key] ?? 0) + 1;
      this.attempts[key] = attempt;
      this.retryAt[key] = this.now() + RETRY_MS * 4 ** (attempt - 1);
      this.status[key] = FAILED;
      this.onChange?.();
    });
  }

  /** The slots' array, made (and every sampling node pointed at it) on the first tile. */
  private slotArray(): DataArrayTexture {
    if (this.array !== null) return this.array;
    const array = createSlotArray(Math.max(this.slots, 1));
    this.array = array;
    for (const node of this.arrayNodes) node.value = array;
    return array;
  }

  /** Copies a tile's levels into a slot of the array, through the staging texture. */
  private upload(renderer: DetailRenderer, slot: number, levels: readonly Uint8Array<ArrayBuffer>[]): void {
    const base = levels[0];
    if (base === undefined) throw new Error("A detail tile has no levels");
    const array = this.slotArray();
    this.stagingUsed = true;
    this.staging.image = { data: base, width: DETAIL_TILE_TEXELS, height: DETAIL_TILE_TEXELS };
    this.staging.mipmaps = levels.map((data, level) => ({ data, width: DETAIL_TILE_TEXELS >> level, height: DETAIL_TILE_TEXELS >> level }));
    this.staging.needsUpdate = true;
    slotOrigin.set(0, 0, slot);
    for (let level = 0; level < levels.length; level++) {
      renderer.copyTextureToTexture(this.staging, array, levelRegions[level] ?? null, slotOrigin, level, level);
    }
  }

  private writeIndex(key: number): void {
    const { wall, column, row } = detailTile(key);
    const offset = ((wall * DETAIL_ROWS + row) * DETAIL_INDEX_WIDTH + column) * 4;
    const slot = this.slot[key] ?? -1;
    this.indexData[offset] = slot < 0 ? 0 : slot + 1;
    this.indexData[offset + 1] = slot < 0 ? 0 : Math.round((this.fade[key] ?? 0) * 255);
  }

  /** A tile's fade (0 to 1; 0 when not resident). */
  fadeOf(key: number): number {
    return (this.slot[key] ?? -1) < 0 ? 0 : this.fade[key] ?? 0;
  }

  /** The slot holding a tile, or -1. */
  slotOf(key: number): number {
    return this.slot[key] ?? -1;
  }

  /** Whether the slots' array has been made (a tile has arrived). */
  get allocated(): boolean {
    return this.array !== null;
  }

  /**
   * Lets every tile go for good, and the slots' array and staging tile with
   * them (the graphics device ran out of memory: lib/gpu-memory-pressure.ts).
   * The walls show their photographs alone, and nothing more is fetched.
   */
  releaseAll(): void {
    if (this.disposed) return;
    this.stopped = true;
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
    this.decoded.clear();
    this.status.fill(IDLE);
    this.slot.fill(-1);
    this.fade.fill(0);
    this.slotTile.fill(-1);
    this.indexData.fill(0);
    this.index.needsUpdate = true;
    for (const node of this.arrayNodes) node.value = this.standIn;
    this.array?.dispose();
    this.array = null;
    this.staging.dispose();
    this.stagingUsed = false;
    this.onChange?.();
  }

  /**
   * Holds every resident tile that is wanted at `fade` from the next frame
   * (null lets the fades run again): for measuring a cross-fade frame by frame.
   */
  holdFade(fade: number | null): void {
    this.heldFade = fade === null ? null : Math.min(1, Math.max(0, fade));
  }

  stats(): HallDetailStats {
    let resident = 0;
    let fading = 0;
    for (let s = 0; s < this.slots; s++) {
      const key = this.slotTile[s] ?? -1;
      if (key < 0) continue;
      resident += 1;
      if (this.fade[key] !== this.target[key]) fading += 1;
    }
    const indexBytes = DETAIL_INDEX_WIDTH * DETAIL_INDEX_HEIGHT * 4;
    return {
      slots: this.slots, budgetBytes: this.slots * DETAIL_SLOT_BYTES + DETAIL_SLOT_BYTES + indexBytes,
      residentTiles: resident, residentBytes: resident * DETAIL_SLOT_BYTES,
      gpuBytes: (this.array === null ? 4 : this.slots * DETAIL_SLOT_BYTES) + (this.stagingUsed ? DETAIL_SLOT_BYTES : 0) + indexBytes,
      wanted: this.selection.wanted.length, wantedResident: this.selection.wanted.filter((key) => (this.slot[key] ?? -1) >= 0).length,
      inFlight: this.controllers.size, waiting: this.decoded.size, fading, indexLoaded: this.published !== null, ...this.counters,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.indexController.abort();
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
    this.decoded.clear();
    this.decoder?.dispose();
    this.array?.dispose();
    this.standIn.dispose();
    this.staging.dispose();
    this.index.dispose();
  }
}
