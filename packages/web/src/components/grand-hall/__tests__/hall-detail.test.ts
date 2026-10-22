import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PerspectiveCamera } from "three";
import {
  DETAIL_ABANDON_FRAMES, DETAIL_ATLAS_TEXEL_MM, DETAIL_DENSITY, DETAIL_FADE_STEP, DETAIL_GUTTER, DETAIL_INDEX_HEIGHT, DETAIL_INDEX_WIDTH, DETAIL_MAX_REQUESTS, DETAIL_PITCH,
  DETAIL_ROWS, DETAIL_SLOT_BYTES, DETAIL_TILE_COUNT, DETAIL_UPLOAD_BUDGET_MS, DETAIL_WAKE_MS, DETAIL_WALLS, DetailWake, HallDetailLayer, detailHandoverLevel, detailKey, detailTile,
  detailTileAt, detailTilePath, parseDetailIndex,
  selectDetailTiles, wallLocalFromAtlas, type DetailDecoder, type DetailRenderer, type HallDetailIndex, type WakeClock,
} from "../hall-detail.js";
import { DETAIL_LEVELS, DETAIL_TILE_TEXELS, detailMipChain } from "../hall-detail-decode.js";
import { wallAtlasUv, WALL_ATLAS_V_MAX, WALL_ATLAS_V_MIN } from "../hall-atlas.js";
import { HALL_WALLS, type HallWallId } from "../hall-spec.js";

const SURVEY = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../public/rooms/grand-hall/survey-2026-07-11");
const HEX = "0123456789abcdef".repeat(4);

interface TileJson { readonly column: number; readonly row: number; readonly bytes: number; readonly sha256: string }
interface WallJson { readonly columns: number; readonly rows: number; readonly tiles: readonly TileJson[] }
type Skip = (wall: HallWallId, column: number, row: number) => boolean;

function wallJson(id: HallWallId, skip: Skip): WallJson {
  const grid = DETAIL_WALLS.find((candidate) => candidate.wall === id);
  if (grid === undefined) throw new Error(id);
  const tiles: TileJson[] = [];
  for (let row = 0; row < grid.rows; row++) {
    for (let column = 0; column < grid.columns; column++) {
      if (!skip(id, column, row)) tiles.push({ column, row, bytes: 1000, sha256: HEX });
    }
  }
  return { columns: grid.columns, rows: grid.rows, tiles };
}

/** A well-formed index publishing every tile except those `skip` names. */
function indexJson(skip: Skip = () => false) {
  const walls = { window: wallJson("window", skip), door: wallJson("door", skip), end: wallJson("end", skip), fireplace: wallJson("fireplace", skip) };
  const tiles = Object.values(walls).reduce((sum, wall) => sum + wall.tiles.length, 0);
  return {
    format: "venviewer-hall-detail", version: 1, texelMetres: 0.002, tileTexels: 512, gutterTexels: 8, pitchMetres: 0.992,
    origin: { u: 0, v: 6.72 }, quality: 86, walls, tiles, totalBytes: tiles * 1000,
  };
}

const END = HALL_WALLS.findIndex((wall) => wall.id === "end");
const WINDOW = HALL_WALLS.findIndex((wall) => wall.id === "window");

type V3 = readonly [number, number, number];

/** The planner's camera (fov 55) at a pose, its matrices current. */
function camera(position: V3, target: V3, width = 2000, height = 1166): PerspectiveCamera {
  const created = new PerspectiveCamera(55, width / height, 0.1, 200);
  created.position.set(...position);
  created.lookAt(...target);
  created.updateMatrixWorld(true);
  created.updateProjectionMatrix();
  return created;
}

interface Pose { readonly position: V3; readonly target: V3 }
const BOARDS: Pose = { position: [8.67, 2.7, -3.23], target: [10.5, 2.78, -3.23] };
const NONE = [100, 100, 100, 100, 100];

describe("the detail tiles' grid", () => {
  it("covers every wall with 0.992 m tiles in seven rows from the atlas's top", () => {
    expect(DETAIL_PITCH).toBeCloseTo(0.992, 12);
    expect(DETAIL_ROWS).toBe(7);
    expect(DETAIL_WALLS.map((grid) => [grid.wall, grid.columns])).toEqual([["window", 22], ["end", 11], ["door", 22], ["fireplace", 11]]);
    expect(DETAIL_TILE_COUNT).toBe(462);
    for (let key = 0; key < DETAIL_TILE_COUNT; key++) {
      const { wall, column, row } = detailTile(key);
      expect(detailKey(wall, column, row)).toBe(key);
    }
  });

  it("finds a wall point from its atlas coordinates on all four walls, as the shader does", () => {
    HALL_WALLS.forEach((wall, index) => {
      for (const [u, v] of [[0, WALL_ATLAS_V_MIN], [0.37, 1.9], [wall.length / 2, 3.33], [wall.length - 0.001, WALL_ATLAS_V_MAX]] as const) {
        const [s, t] = wallAtlasUv(wall.id, u, v);
        const [u2, v2] = wallLocalFromAtlas(index, s, t);
        expect(u2).toBeCloseTo(u, 9);
        expect(v2).toBeCloseTo(v, 9);
      }
    });
  });

  it("places a point inside its tile's own texels, the gutter outside them", () => {
    const first = detailTileAt(END, 0.001, WALL_ATLAS_V_MAX - 0.001);
    expect([first.column, first.row]).toEqual([0, 0]);
    expect(first.x * DETAIL_TILE_TEXELS).toBeCloseTo(DETAIL_GUTTER + 0.5, 9);
    expect(first.y * DETAIL_TILE_TEXELS).toBeCloseTo(DETAIL_GUTTER + 0.5, 9);
    const edge = detailTileAt(END, DETAIL_PITCH - 1e-6, WALL_ATLAS_V_MAX - DETAIL_PITCH + 1e-6);
    expect([edge.column, edge.row]).toEqual([0, 0]);
    expect(edge.x * DETAIL_TILE_TEXELS).toBeCloseTo(DETAIL_TILE_TEXELS - DETAIL_GUTTER, 2);
    expect(edge.y * DETAIL_TILE_TEXELS).toBeCloseTo(DETAIL_TILE_TEXELS - DETAIL_GUTTER, 2);
    const next = detailTileAt(END, DETAIL_PITCH + 1e-6, 3);
    expect(next.column).toBe(1);
    expect(next.x * DETAIL_TILE_TEXELS).toBeCloseTo(DETAIL_GUTTER, 2);
    // Beyond the wall's ends the last tile clamps, as the atlas does.
    expect(detailTileAt(END, 99, -5)).toMatchObject({ column: 10, row: 6 });
  });

  it("names each tile by its wall, column and row", () => {
    expect(detailTilePath(detailKey(END, 3, 4))).toBe("detail/end/3_4.webp");
    expect(detailTilePath(detailKey(3, 10, 6))).toBe("detail/fireplace/10_6.webp");
  });
});

describe("the detail index", () => {
  it("reads a well-formed index", () => {
    const index = parseDetailIndex(indexJson((wall, column) => wall === "window" && column === 5));
    expect(index.tiles).toBe(DETAIL_TILE_COUNT - DETAIL_ROWS);
    expect(index.present[detailKey(WINDOW, 5, 2)]).toBe(0);
    expect(index.present[detailKey(WINDOW, 6, 2)]).toBe(1);
    expect(index.totalBytes).toBe(index.tiles * 1000);
  });

  it("refuses malformed files", () => {
    const good = indexJson();
    const end = good.walls.end;
    const broken: unknown[] = [
      null,
      "index",
      { ...good, format: "something else" },
      { ...good, version: 2 },
      { ...good, pitchMetres: 1 },
      { ...good, gutterTexels: 4 },
      { ...good, origin: { u: 0, v: 7 } },
      { ...good, tiles: good.tiles + 1 },
      { ...good, totalBytes: 5 },
      { ...good, extra: true },
      { ...good, walls: { ...good.walls, end: { ...end, columns: 12 } } },
      { ...good, walls: { ...good.walls, end: { ...end, tiles: [...end.tiles, { column: 11, row: 0, bytes: 9, sha256: HEX }] } } },
      { ...good, walls: { ...good.walls, end: { ...end, tiles: [...end.tiles, { column: 0, row: 0, bytes: 9, sha256: HEX }] } } },
      { ...good, walls: { ...good.walls, end: { ...end, tiles: [{ column: 0, row: 0, bytes: 9, sha256: "XYZ" }] } } },
      { ...good, walls: { ...good.walls, end: { ...end, tiles: [{ column: 0, row: 0, bytes: -1, sha256: HEX }] } } },
      { ...good, walls: { window: good.walls.window, door: good.walls.door, end } },
    ];
    for (const json of broken) expect(() => parseDetailIndex(json)).toThrow();
  });
});

describe("which tiles a view wants", () => {
  const full = parseDetailIndex(indexJson());

  it("at Blake's deacon-board pose, the boards' tiles first, and of other walls only the corner beside them", () => {
    const selection = selectDetailTiles(full, { camera: camera(BOARDS.position, BOARDS.target), heightPx: 1166, cuts: NONE }, 64);
    // The boards: u 0.62-3.50 m along the end wall, 2.15-3.40 m up (rows 3 and 4 down from 6.72 m).
    const boards: number[] = [];
    for (let column = 0; column <= 3; column++) {
      for (const row of [3, 4]) boards.push(detailKey(END, column, row));
    }
    // Among the first ten: two tiles above the boards' middle are nearer than their outer columns.
    const first = selection.wanted.slice(0, 10);
    for (const key of boards) expect(first).toContain(key);
    for (const key of selection.wanted) {
      expect(selection.density[key]).toBeGreaterThanOrEqual(DETAIL_DENSITY);
      // The window wall's last column meets the end wall at the left of the view (its relief's box reaches into it).
      const tile = detailTile(key);
      if (tile.wall !== END) expect(tile).toMatchObject({ wall: WINDOW, column: 21 });
    }
    // The tile straight ahead, 1.8975 m off at 1166 / (2 tan 27.5 deg) px a radian.
    expect(detailTile(selection.wanted[0] ?? -1)).toMatchObject({ wall: END, column: 2, row: 4 });
    expect(selection.density[detailKey(END, 2, 4)]).toBeCloseTo(1166 / (2 * Math.tan((27.5 * Math.PI) / 180)) / 1.8975 / 1000, 4);
  });

  it("from the far overview and the opening view, none", () => {
    const length = Math.hypot(11.2, 12.6, 14.2);
    for (const reach of [22, 33.4]) {
      const k = reach / length;
      const position: V3 = [-1 + 11.2 * k, 12.6 * k, -1 + 14.2 * k];
      const selection = selectDetailTiles(full, { camera: camera(position, [-1, 0, -1], 1534, 1098), heightPx: 1098, cuts: [6.9, 1.96, 1.96, 6.9, -1] }, 64);
      expect(selection.wanted).toEqual([]);
    }
  });

  it("never a cut wall's tiles that start above its cut", () => {
    const selection = selectDetailTiles(full, { camera: camera(BOARDS.position, BOARDS.target), heightPx: 1166, cuts: [100, 2.0, 100, 100, 100] }, 64);
    expect(selection.wanted.length).toBeGreaterThan(0);
    const onEnd = selection.wanted.filter((key) => detailTile(key).wall === END);
    expect(onEnd.length).toBeGreaterThan(0);
    for (const key of onEnd) {
      expect(WALL_ATLAS_V_MAX - (detailTile(key).row + 1) * DETAIL_PITCH).toBeLessThan(2.0);
    }
    expect(selection.wanted).not.toContain(detailKey(END, 2, 3));
  });

  it("never a tile the index leaves out (the window glass)", () => {
    // From the centre arch's station, 0.72 m from its glass.
    const pose = camera([-0.132, 1.474, -4.572], [-0.132, 2.6, -14]);
    const all = selectDetailTiles(full, { camera: pose, heightPx: 1166, cuts: NONE }, 64);
    expect(all.wanted).toContain(detailKey(WINDOW, 10, 4));
    const glassless = parseDetailIndex(indexJson((wall, column, row) => wall === "window" && column >= 9 && column <= 11 && row === 4));
    const selection = selectDetailTiles(glassless, { camera: pose, heightPx: 1166, cuts: NONE }, 64);
    expect(selection.wanted.length).toBeGreaterThan(0);
    for (const key of selection.wanted) expect(glassless.present[key]).toBe(1);
  });

  it("nothing from behind a wall, and no more than the slots", () => {
    expect(selectDetailTiles(full, { camera: camera([12, 2.7, -3.23], [14, 2.78, -3.23]), heightPx: 1166, cuts: NONE }, 64).wanted).toEqual([]);
    expect(selectDetailTiles(full, { camera: camera(BOARDS.position, BOARDS.target), heightPx: 1166, cuts: NONE }, 3).wanted).toHaveLength(3);
  });
});

/** Four levels of a tile, as the worker answers. */
function levels(): Uint8Array<ArrayBuffer>[] {
  return Array.from({ length: DETAIL_LEVELS }, (_, level) => new Uint8Array((DETAIL_TILE_TEXELS >> level) ** 2 * 4));
}

interface Recorder {
  readonly fetched: string[];
  readonly signals: AbortSignal[];
  readonly copies: { readonly slot: number; readonly level: number }[];
  /** Level sets handed back to the decoder. */
  recycled: number;
  clock: number;
  fail: boolean;
}

interface Harness extends Recorder {
  readonly layer: HallDetailLayer;
  readonly renderer: DetailRenderer;
}

function harness(slots: number, index: HallDetailIndex): Harness {
  const record: Recorder = { fetched: [], signals: [], copies: [], recycled: 0, clock: 0, fail: false };
  const renderer: DetailRenderer = {
    copyTextureToTexture: (_src, _dst, _region, position, _srcLevel, level) => {
      record.copies.push({ slot: position?.z ?? -1, level: level ?? 0 });
    },
  };
  const decoder: DetailDecoder = {
    decode: () => Promise.resolve(levels()),
    recycle: (set) => { if (set.length === DETAIL_LEVELS) record.recycled += 1; },
    dispose: () => undefined,
  };
  const layer = new HallDetailLayer({
    slots, decoder, now: () => record.clock,
    fetchBytes: (url, signal) => {
      record.fetched.push(url);
      record.signals.push(signal);
      return record.fail ? Promise.reject(new Error("404")) : Promise.resolve(new ArrayBuffer(16));
    },
  });
  layer.setIndex(index);
  return Object.assign(record, { layer, renderer });
}

const settle = async (): Promise<void> => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function frameAt(h: Harness, pose: Pose, options: { readonly delta?: number; readonly reducedMotion?: boolean; readonly advance?: number } = {}) {
  h.clock += options.advance ?? 1000 / 60;
  return h.layer.update({
    camera: camera(pose.position, pose.target), heightPx: 1166, cuts: NONE, delta: options.delta ?? 1 / 60,
    reducedMotion: options.reducedMotion ?? false, renderer: h.renderer,
  });
}

const resident = (layer: HallDetailLayer): number[] => [...Array(DETAIL_TILE_COUNT).keys()].filter((key) => layer.slotOf(key) >= 0);

describe("the detail layer", () => {
  const full = parseDetailIndex(indexJson());
  const ahead = detailKey(END, 2, 4);

  it("fetches the most magnified first, four at a time, and copies two a frame with their four levels", async () => {
    const h = harness(64, full);
    frameAt(h, BOARDS);
    expect(h.fetched).toHaveLength(DETAIL_MAX_REQUESTS);
    expect(h.fetched[0]).toContain("detail/end/2_4.webp");
    await settle();
    expect(frameAt(h, BOARDS).active).toBe(true);
    expect(h.copies).toHaveLength(2 * DETAIL_LEVELS);
    expect(h.copies.map((copy) => copy.level)).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
    expect(h.layer.stats()).toMatchObject({ residentTiles: 2, uploads: 2, residentBytes: 2 * DETAIL_SLOT_BYTES });
    // Each uploaded tile's buffers go back to the decoder for the next tiles.
    expect(h.recycled).toBe(2);
  });

  it("copies one tile a frame once the copies have taken their share of the frame", async () => {
    const h = harness(64, full);
    // A slow device: each level's copy takes a third of the budget, so a tile takes more than the budget.
    const slow: DetailRenderer = {
      copyTextureToTexture: (_src, _dst, _region, position, _srcLevel, level) => {
        h.clock += DETAIL_UPLOAD_BUDGET_MS / 3;
        h.copies.push({ slot: position?.z ?? -1, level: level ?? 0 });
      },
    };
    const frame = (): void => {
      h.clock += 1000 / 60;
      h.layer.update({ camera: camera(BOARDS.position, BOARDS.target), heightPx: 1166, cuts: NONE, delta: 1 / 60, reducedMotion: false, renderer: slow });
    };
    frame();
    await settle();
    frame();
    expect(h.layer.stats().uploads).toBe(1);
    frame();
    expect(h.layer.stats().uploads).toBe(2);
  });

  it("holds no slots on the GPU until the first tile arrives, then its whole budget", async () => {
    const h = harness(16, full);
    const index = DETAIL_INDEX_WIDTH * DETAIL_INDEX_HEIGHT * 4;
    expect(h.layer.allocated).toBe(false);
    expect(h.layer.stats().gpuBytes).toBeLessThan(index + 16);
    frameAt(h, BOARDS);
    expect(h.layer.allocated).toBe(false);
    await settle();
    frameAt(h, BOARDS);
    expect(h.layer.allocated).toBe(true);
    const stats = h.layer.stats();
    expect(stats.gpuBytes).toBe(16 * DETAIL_SLOT_BYTES + DETAIL_SLOT_BYTES + index);
    expect(stats.gpuBytes).toBe(stats.budgetBytes);
    // A phone's budget: 16 slots of 1.39 MB, the staging tile and the index, about 23.7 MB.
    expect(stats.budgetBytes / 1e6).toBeCloseTo(23.68, 1);
  });

  it("hands over to the atlas where its texel is the atlas's: level 1.37 on a computer, 2.37 on a phone", () => {
    expect(DETAIL_ATLAS_TEXEL_MM).toBeCloseTo(5.171, 3);
    expect(detailHandoverLevel(DETAIL_ATLAS_TEXEL_MM)).toBeCloseTo(1.3704, 3);
    expect(detailHandoverLevel(DETAIL_ATLAS_TEXEL_MM * 2)).toBeCloseTo(2.3704, 3);
    expect(detailHandoverLevel(1)).toBe(0);
    expect(new HallDetailLayer({ slots: 0, atlasTexelMm: DETAIL_ATLAS_TEXEL_MM * 2 }).handoverLevel).toBeCloseTo(2.3704, 3);
  });

  it("keeps to its slots, giving up the least recently wanted tiles", async () => {
    const h = harness(4, full);
    for (let i = 0; i < 6; i++) { frameAt(h, BOARDS); await settle(); }
    const first = resident(h.layer);
    expect(first).toHaveLength(4);
    const elsewhere: Pose = { position: [8.67, 2.7, 2.5], target: [10.5, 2.78, 2.5] };
    for (let i = 0; i < 40; i++) { frameAt(h, elsewhere); await settle(); }
    const stats = h.layer.stats();
    expect(stats.budgetBytes).toBe(5 * DETAIL_SLOT_BYTES + DETAIL_INDEX_WIDTH * DETAIL_INDEX_HEIGHT * 4);
    expect(stats.residentBytes).toBe(4 * DETAIL_SLOT_BYTES);
    expect(stats.gpuBytes).toBeLessThanOrEqual(stats.budgetBytes);
    const now = resident(h.layer);
    expect(now).toHaveLength(4);
    for (const key of now) expect(first).not.toContain(key);
    expect(stats.evictions).toBe(4);
  });

  it("fades a tile in by at most a thirteenth a frame, whatever the frame time, and at once under reduced motion", async () => {
    const h = harness(64, full);
    frameAt(h, BOARDS);
    await settle();
    frameAt(h, BOARDS);
    expect(h.layer.slotOf(ahead)).toBeGreaterThanOrEqual(0);
    expect(h.layer.fadeOf(ahead)).toBeCloseTo(DETAIL_FADE_STEP, 6);
    let previous = h.layer.fadeOf(ahead);
    let frames = 1;
    while (h.layer.fadeOf(ahead) < 1 && frames < 100) {
      frameAt(h, BOARDS, { delta: frames % 2 === 0 ? 0.5 : 1 / 60 });
      const fade = h.layer.fadeOf(ahead);
      expect(fade - previous).toBeLessThanOrEqual(DETAIL_FADE_STEP + 1e-6);
      expect(fade).toBeGreaterThan(previous);
      previous = fade;
      frames += 1;
    }
    expect(frames).toBe(13);
    for (let i = 0; i < 3; i++) frameAt(h, BOARDS);
    expect(frameAt(h, BOARDS).active).toBe(false);

    const calm = harness(64, full);
    frameAt(calm, BOARDS, { reducedMotion: true });
    await settle();
    frameAt(calm, BOARDS, { reducedMotion: true });
    expect(calm.layer.fadeOf(ahead)).toBe(1);
  });

  it("holds its resident tiles at a fade for measuring, and lets them run on", async () => {
    const h = harness(64, full);
    frameAt(h, BOARDS);
    await settle();
    h.layer.holdFade(5 / 13);
    frameAt(h, BOARDS);
    expect(h.layer.fadeOf(ahead)).toBeCloseTo(5 / 13, 6);
    frameAt(h, BOARDS);
    expect(h.layer.fadeOf(ahead)).toBeCloseTo(5 / 13, 6);
    h.layer.holdFade(null);
    frameAt(h, BOARDS);
    expect(h.layer.fadeOf(ahead)).toBeCloseTo(6 / 13, 6);
  });

  it("writes slot + 1 and the fade into the index texture", async () => {
    const h = harness(64, full);
    frameAt(h, BOARDS);
    await settle();
    for (let i = 0; i < 4; i++) frameAt(h, BOARDS);
    const data = h.layer.index.image.data;
    const offset = ((END * DETAIL_ROWS + 4) * DETAIL_INDEX_WIDTH + 2) * 4;
    expect(data?.[offset]).toBe(h.layer.slotOf(ahead) + 1);
    expect(data?.[offset + 1]).toBe(Math.round(h.layer.fadeOf(ahead) * 255));
    expect(h.layer.fadeOf(ahead)).toBeGreaterThan(0);
  });

  it("fetches nothing while the camera turns fast, and asks to look again once it stops", () => {
    const h = harness(64, full);
    frameAt(h, BOARDS);
    const fetched = h.fetched.length;
    const result = frameAt(h, { position: [8.0, 2.7, -3.23], target: [10.5, 2.78, -1.0] });
    expect(result.wakeMs).toBe(DETAIL_WAKE_MS);
    expect(h.fetched).toHaveLength(fetched);
  });

  it("leaves a failing tile on the atlas and retries it three times at most, backing off", async () => {
    const h = harness(64, full);
    h.fail = true;
    const tries = (): number => h.fetched.filter((name) => name.includes("detail/end/2_4.webp")).length;
    frameAt(h, BOARDS);
    await settle();
    expect(tries()).toBe(1);
    expect(frameAt(h, BOARDS).wakeMs).not.toBeNull();
    expect(tries()).toBe(1);
    for (const wait of [2000, 8000, 32000, 128000, 512000]) {
      frameAt(h, BOARDS, { advance: wait + 1 });
      await settle();
    }
    expect(tries()).toBe(4);
    expect(h.layer.slotOf(ahead)).toBe(-1);
  });

  it("abandons its fetches when disposed, and does nothing without a decoder or slots", async () => {
    const h = harness(64, full);
    frameAt(h, BOARDS);
    h.layer.dispose();
    expect(h.signals.length).toBeGreaterThan(0);
    for (const signal of h.signals) expect(signal.aborted).toBe(true);
    await settle();
    const none = new HallDetailLayer({ slots: 64, decoder: null });
    none.setIndex(full);
    expect(none.enabled).toBe(false);
    expect(none.update({ camera: camera(BOARDS.position, BOARDS.target), heightPx: 1166, cuts: NONE, delta: 0.016, reducedMotion: false, renderer: h.renderer }))
      .toEqual({ active: false, wakeMs: null });
    none.dispose();
    const noSlots = new HallDetailLayer({ slots: 0 });
    expect(noSlots.enabled).toBe(false);
    noSlots.dispose();
  });
});

describe("a tile's mip levels", () => {
  it("halves each level in linear light, alpha kept", () => {
    const base = new Uint8Array(4 * 4 * 4);
    for (let i = 0; i < 16; i++) {
      const on = (i + Math.floor(i / 4)) % 2 === 0;
      base.set([on ? 255 : 0, on ? 255 : 0, on ? 255 : 0, 255], i * 4);
    }
    const chain = detailMipChain(base, 4, 3);
    expect(chain.map((level) => level.length)).toEqual([64, 16, 4]);
    // Half white in linear light is sRGB 188, not 128.
    expect([...(chain[1] ?? [])].slice(0, 4)).toEqual([188, 188, 188, 255]);
    expect([...(chain[2] ?? [])]).toEqual([188, 188, 188, 255]);
    expect(() => detailMipChain(new Uint8Array(10), 4, 2)).toThrow();
  });
});

describe("the detail layer's housekeeping (review, 22 October)", () => {
  const full = parseDetailIndex(indexJson());
  /** A pose behind the end wall: it wants no tile. */
  const AWAY: Pose = { position: [12, 2.7, -3.23], target: [14, 2.78, -3.23] };
  const deferred = () => {
    let resolve: (bytes: ArrayBuffer) => void = () => undefined;
    const promise = new Promise<ArrayBuffer>((done) => { resolve = done; });
    return { promise, resolve };
  };

  it("abandons a fetch whose tile has not been wanted for a while, without counting it as a failure", async () => {
    const pending: { readonly signal: AbortSignal; readonly resolve: (bytes: ArrayBuffer) => void }[] = [];
    let clock = 0;
    let decoded = 0;
    const decoder: DetailDecoder = { decode: () => { decoded += 1; return Promise.resolve(levels()); }, recycle: () => undefined, dispose: () => undefined };
    const layer = new HallDetailLayer({
      slots: 64, decoder, now: () => clock,
      fetchBytes: (_url, signal) => { const waiting = deferred(); pending.push({ signal, resolve: waiting.resolve }); return waiting.promise; },
    });
    layer.setIndex(full);
    const frame = (pose: Pose): void => {
      clock += 1000 / 60;
      layer.update({ camera: camera(pose.position, pose.target), heightPx: 1166, cuts: NONE, delta: 1 / 60, reducedMotion: false, renderer: null });
    };
    frame(BOARDS);
    expect(pending).toHaveLength(DETAIL_MAX_REQUESTS);
    // A few frames away is not yet a while: the fetches stand.
    for (let i = 0; i < DETAIL_ABANDON_FRAMES - 2; i++) frame(AWAY);
    expect(pending.every((entry) => !entry.signal.aborted)).toBe(true);
    for (let i = 0; i < 20; i++) frame(AWAY);
    expect(pending.every((entry) => entry.signal.aborted)).toBe(true);
    expect(layer.stats()).toMatchObject({ inFlight: 0, abandoned: DETAIL_MAX_REQUESTS, failures: 0 });
    // A fetch that lands anyway is thrown away: nothing decodes, nothing fails.
    for (const entry of pending) entry.resolve(new ArrayBuffer(16));
    await settle();
    expect(decoded).toBe(0);
    expect(layer.stats()).toMatchObject({ waiting: 0, failures: 0 });
    // Back at the boards (and still there, so no longer moving fast), the
    // tiles are fetched again at once, not held back as failures.
    frame(BOARDS);
    frame(BOARDS);
    expect(pending).toHaveLength(2 * DETAIL_MAX_REQUESTS);
    layer.dispose();
  });

  it("stops for good when its decoder stops, rather than fetching every tile again", async () => {
    const h = harness(64, full);
    let broken = false;
    let decodes = 0;
    const decoder: DetailDecoder = {
      get broken() { return broken; },
      decode: () => { decodes += 1; broken = true; return Promise.reject(new Error("The detail decoder stopped")); },
      recycle: () => undefined, dispose: () => undefined,
    };
    const fetched: string[] = [];
    const layer = new HallDetailLayer({ slots: 64, decoder, now: () => h.clock, fetchBytes: (url) => { fetched.push(url); return Promise.resolve(new ArrayBuffer(16)); } });
    layer.setIndex(full);
    const frame = (advance: number): void => {
      h.clock += advance;
      layer.update({ camera: camera(BOARDS.position, BOARDS.target), heightPx: 1166, cuts: NONE, delta: 1 / 60, reducedMotion: false, renderer: h.renderer });
    };
    frame(16);
    await settle();
    expect(layer.enabled).toBe(false);
    const before = fetched.length;
    for (const wait of [16, 2001, 8001, 32001]) {
      frame(wait);
      await settle();
    }
    expect(fetched).toHaveLength(before);
    expect(layer.stats().failures).toBe(0);
    expect(decodes).toBeGreaterThanOrEqual(1);
    layer.dispose();
  });

  it("asks whether motion is reduced only when a tile arrives or fades", async () => {
    const h = harness(64, full);
    let asked = 0;
    const reducedMotion = (): boolean => { asked += 1; return false; };
    const frame = (): void => {
      h.clock += 1000 / 60;
      h.layer.update({ camera: camera(BOARDS.position, BOARDS.target), heightPx: 1166, cuts: NONE, delta: 1 / 60, reducedMotion, renderer: h.renderer });
    };
    frame();
    expect(asked).toBe(0);
    await settle();
    frame();
    expect(asked).toBe(1);
    // Fading in, once a frame at most.
    for (let i = 0; i < 60; i++) { frame(); await settle(); }
    const settled = asked;
    for (let i = 0; i < 10; i++) frame();
    expect(asked).toBe(settled);
  });
});

describe("the detail layer's wake", () => {
  interface Timer { readonly fire: () => void; readonly at: number; cleared: boolean }
  const fakeClock = () => {
    const timers: Timer[] = [];
    let time = 0;
    const clock: WakeClock = {
      now: () => time,
      set: (fire, ms) => { timers.push({ fire, at: time + ms, cleared: false }); return setTimeout(() => undefined, 0); },
      clear: () => { const live = timers.filter((timer) => !timer.cleared); const last = live[live.length - 1]; if (last !== undefined) last.cleared = true; },
    };
    return { clock, timers, advance: (ms: number) => { time += ms; } };
  };

  it("keeps the earliest deadline asked for: a pan's look replaces a retry's, a later retry waits behind it", () => {
    const { clock, timers } = fakeClock();
    let fired = 0;
    const wake = new DetailWake(() => { fired += 1; }, clock);
    wake.request(32000);
    wake.request(DETAIL_WAKE_MS);
    expect(timers.map((timer) => [timer.at, timer.cleared])).toEqual([[32000, true], [DETAIL_WAKE_MS, false]]);
    wake.request(8000);
    expect(timers).toHaveLength(2);
    timers[1]?.fire();
    expect(fired).toBe(1);
    expect(wake.pending).toBe(false);
    // Asked again after it fired, it sets a new timer; cancelled, it clears it.
    wake.request(2000);
    expect(wake.pending).toBe(true);
    wake.cancel();
    expect(wake.pending).toBe(false);
    expect(timers[2]?.cleared).toBe(true);
  });

  it("never asks sooner than a frame", () => {
    const { clock, timers } = fakeClock();
    new DetailWake(() => undefined, clock).request(0);
    expect(timers[0]?.at).toBe(16);
  });
});

describe("the published detail tiles", () => {
  it("are every file the index lists, at its bytes and SHA-256, 28 MB at most, left out only over window glass", () => {
    const indexPath = join(SURVEY, "detail", "index.json");
    expect(existsSync(indexPath)).toBe(true);
    const index = parseDetailIndex(JSON.parse(readFileSync(indexPath, "utf8")));
    expect(index.totalBytes).toBeLessThanOrEqual(28_000_000);
    expect(index.tiles).toBeGreaterThan(400);
    for (let key = 0; key < DETAIL_TILE_COUNT; key++) {
      if (index.present[key] !== 1) {
        expect(detailTile(key).wall).toBe(WINDOW);
        continue;
      }
      const bytes = readFileSync(join(SURVEY, ...detailTilePath(key).split("/")));
      expect(bytes.length).toBe(index.bytes[key]);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(index.sha256.get(key));
      expect(bytes.subarray(0, 4).toString("latin1")).toBe("RIFF");
      expect(bytes.subarray(8, 12).toString("latin1")).toBe("WEBP");
    }
    // Nothing on disk that the index does not list.
    let files = 0;
    for (const grid of DETAIL_WALLS) {
      for (const name of readdirSync(join(SURVEY, "detail", grid.wall))) {
        if (!statSync(join(SURVEY, "detail", grid.wall, name)).isFile()) continue;
        expect(name).toMatch(/^\d+_\d+\.webp$/);
        files += 1;
      }
    }
    expect(files).toBe(index.tiles);
  });
});
