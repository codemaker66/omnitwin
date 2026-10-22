import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Texture, type BufferGeometry, type Material } from "three";
import { uv } from "three/tsl";
import { NodeMaterial } from "three/webgpu";

// The atlas decodes through createImageBitmap, off the main thread; a fake
// loader stands in for it, as in hall-photos.test.ts.
const recorded = vi.hoisted(() => ({
  options: [] as unknown[],
  loads: [] as { url: string; onLoad: (bitmap: ImageBitmap) => void; onError: () => void }[],
}));

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  class FakeImageBitmapLoader {
    setOptions(options: unknown): this {
      recorded.options.push(options);
      return this;
    }
    load(url: string, onLoad: (bitmap: ImageBitmap) => void, _onProgress: unknown, onError: () => void): void {
      recorded.loads.push({ url, onLoad, onError });
    }
  }
  return { ...actual, ImageBitmapLoader: FakeImageBitmapLoader };
});

const {
  BEYOND_ATLAS, BEYOND_DOORWAYS, BEYOND_FADE_END, BEYOND_FADE_START, BEYOND_PHOTO_FADE, BEYOND_REACH, BEYOND_SURFACE, CARD, CARD_PART, CARD_WALL_HEIGHT,
  HallBeyondPhotos, POOL, SPILL, beyondAtlasUrl, beyondFade, beyondPresence, buildBeyondFloors, buildBeyondPools, buildBeyondSolids,
  buildFirstFloorCard, createBeyondFloorMaterial, createBeyondPoolMaterial, createBeyondSolidMaterial, createFirstFloorCardMaterial,
  spillShare, triangleCount,
} = await import("../hall-beyond.js");
const { BEYOND_FLOOR_Y, BEYOND_SPACES, LANDING_BALUSTRADE, parseFirstFloor } = await import("../hall-neighbours.js");
const { COPING, buildCoping, copingBase, copingProfile, copingRuns, copingShown, createCopingMaterial } = await import("../hall-coping.js");
const { SECTION_PRESETS, createHallSection } = await import("../hall-section.js");
const { HallSectionUniforms, createDoorLeafMaterials } = await import("../hall-materials.js");
const { HallMoodUniforms } = await import("../hall-mood.js");
const { DoorSwingUniforms } = await import("../hall-doors.js");
const { HallPhotos, HALL_SURVEY_REVISION } = await import("../hall-photos.js");
const { DOOR_SLOTS, LINTEL_RELEASE, WALL_BODY_TOP, buildWallBody } = await import("../hall-wall-body.js");
const { HALL_DOORS, HALL_OPENINGS, HALL_WALLS } = await import("../hall-spec.js");
const { createSunCaster } = await import("../hall-sun.js");

const PUBLIC = path.resolve("public/rooms/grand-hall/survey-2026-07-11");
const record = JSON.parse(readFileSync(path.resolve("../../tools/grand-hall-survey/beyond-atlas.json"), "utf8")) as {
  atlas: [number, number];
  files: Record<string, { size: [number, number]; bytes: number; sha256: string }>;
  surfaces: { name: string; rect: [number, number, number, number]; medianSrgb: [number, number, number]; map: Record<string, number | string> }[];
};

afterEach(() => {
  recorded.options.length = 0;
  recorded.loads.length = 0;
});

/** A WebP's pixel size from its header (lossy VP8, lossless VP8L or extended VP8X). */
function webpSize(bytes: Buffer): [number, number] {
  expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
  expect(bytes.toString("ascii", 8, 12)).toBe("WEBP");
  const chunk = bytes.toString("ascii", 12, 16);
  if (chunk === "VP8X") return [1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3)];
  if (chunk === "VP8L") {
    const bits = bytes.readUInt32LE(21);
    return [1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff)];
  }
  if (chunk === "VP8 ") return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
  throw new Error(`unknown WebP chunk ${chunk}`);
}

function positions(geometry: BufferGeometry): [number, number, number][] {
  const attribute = geometry.getAttribute("position");
  return Array.from({ length: attribute.count }, (_, i): [number, number, number] => [attribute.getX(i), attribute.getY(i), attribute.getZ(i)]);
}

function context() {
  return { mood: new HallMoodUniforms(), swing: new DoorSwingUniforms(), section: new HallSectionUniforms(), sun: null };
}

const firstFloor = () => parseFirstFloor(JSON.parse(readFileSync(path.join(PUBLIC, "first-floor-2010.json"), "utf8")));

describe("the beyond's floors", () => {
  it("lie at +1 cm, above the city's caps at the floor's level: the four doors' and the stairwell", () => {
    const floors = buildBeyondFloors();
    expect(BEYOND_FLOOR_Y).toBe(0.01);
    for (const [, y] of positions(floors)) expect(y).toBeCloseTo(BEYOND_FLOOR_Y, 6);
    const tags = floors.getAttribute("aBeyond");
    const seen = new Set<string>();
    for (let i = 0; i < tags.count; i++) seen.add(`${String(tags.getX(i))}:${String(tags.getY(i))}`);
    const main = HALL_DOORS.findIndex((door) => door.opening === "door-main");
    expect(seen).toContain(`${String(main)}:${String(BEYOND_SURFACE.well)}`);
    expect(new Set([...seen].map((entry) => entry.split(":")[0]))).toEqual(new Set(["0", "1", "2", "3"]));
  });

  it("fade out over their reach and appear as their door opens", () => {
    expect(BEYOND_REACH).toEqual(HALL_DOORS.map((door) => BEYOND_SPACES.find((space) => space.opening === door.opening)?.reach));
    expect(beyondFade(0, 2.4)).toBe(1);
    expect(beyondFade(BEYOND_FADE_START * 2.4, 2.4)).toBe(1);
    expect(beyondFade(BEYOND_FADE_END * 2.4, 2.4)).toBe(0);
    expect(beyondFade(2.4, 2.4)).toBe(0);
    // Every floor ends within its reach of its doorway's middle: wherever it ends there, it has dissolved.
    for (const space of BEYOND_SPACES) {
      const face = BEYOND_DOORWAYS[HALL_DOORS.findIndex((door) => door.opening === space.opening)];
      if (face === undefined) throw new Error(space.opening);
      for (const [x, z] of space.floor) expect(Math.hypot(x - face.centre[0], z - face.centre[1])).toBeLessThanOrEqual(space.reach + 1e-3);
    }
    let last = 1;
    for (let d = 0; d <= 2.4; d += 0.05) {
      const fade = beyondFade(d, 2.4);
      expect(fade).toBeLessThanOrEqual(last + 1e-12);
      last = fade;
    }
    expect(beyondPresence(0)).toBe(0);
    expect(beyondPresence(Math.PI / 2)).toBe(1);
    expect(beyondPresence(Math.PI / 4)).toBeGreaterThan(0.2);
  });

  it("take the room's light falling out of each door as a lit doorway throws it: a widening band, dimming as it goes", () => {
    const half = 0.55;
    expect(spillShare(0, 0, half)).toBe(1);
    // As wide as the doorway at its threshold (soft at its sides), wider further out.
    expect(spillShare(0, half - SPILL.soft, half)).toBe(1);
    expect(spillShare(0, half + SPILL.soft, half)).toBe(0);
    expect(spillShare(2, half + SPILL.soft, half)).toBeGreaterThan(0);
    // Dimming as the doorway's opening shrinks seen from further out.
    expect(spillShare(SPILL.reach, 0, half)).toBeCloseTo(0.5, 6);
    let last = 1;
    for (let along = 0; along <= 2.4; along += 0.1) {
      const share = spillShare(along, 0, half);
      expect(share).toBeLessThanOrEqual(last + 1e-12);
      last = share;
    }
    // Never on a point beside the doorway, behind the wall's outer face.
    expect(spillShare(-0.5, 3, half)).toBe(0);
    // Each doorway's face is outside the room and its outward points away from the hall.
    for (const face of BEYOND_DOORWAYS) {
      expect(Math.abs(face.centre[0]) > 10.5 || Math.abs(face.centre[1]) > 5.29).toBe(true);
      expect(face.outward[0] * face.centre[0] + face.outward[1] * face.centre[1]).toBeGreaterThan(0);
    }
  });
});

describe("the landing's balustrade and the Saloon's dado", () => {
  const solids = buildBeyondSolids();

  it("stand where the scan has them, the rail's top at its height", () => {
    const points = positions(solids);
    const ys = points.map((p) => p[1]);
    expect(Math.max(...ys)).toBeCloseTo(Math.max(LANDING_BALUSTRADE.newels[0].top, LANDING_BALUSTRADE.newels[1].top), 3);
    // Between the balusters' heads (0.74 m) and the newels' caps (0.98 m), only the rail.
    const rail = points.filter((p) => p[1] > 0.7 && p[1] < 0.9 && p[2] > 7.9 && p[2] < 8.2);
    expect(Math.max(...rail.map((p) => p[1]))).toBeCloseTo(LANDING_BALUSTRADE.railTop, 3);
    for (const p of points) expect(p[1]).toBeGreaterThanOrEqual(0);
  });

  it("the balustrade keeps under 1.5k triangles", () => {
    // Everything tagged to the main door is the balustrade; the dado is the end door's.
    const tags = solids.getAttribute("aBeyond");
    const index = solids.getIndex();
    if (index === null) throw new Error("indexed");
    const main = HALL_DOORS.findIndex((door) => door.opening === "door-main");
    let balustrade = 0;
    for (let t = 0; t < index.count; t += 3) if (tags.getX(index.getX(t)) === main) balustrade += 1;
    expect(balustrade).toBeGreaterThan(300);
    expect(balustrade).toBeLessThanOrEqual(1500);
  });
});

describe("each section style's cost", () => {
  it("Ashlar: what it adds beyond the doors draws in 2 calls (of 4) and under 6k triangles", () => {
    const beyond = [buildBeyondFloors(), buildBeyondSolids()];
    expect(beyond.length).toBeLessThanOrEqual(4);
    expect(beyond.reduce((sum, geometry) => sum + triangleCount(geometry), 0)).toBeLessThanOrEqual(6000);
    expect(triangleCount(buildWallBody().geometry)).toBeLessThanOrEqual(6000);
  });

  it("Atelier: the first floor in card and the doors' light draw in 2 calls (of 4) and under 8k triangles", () => {
    const plan = firstFloor();
    for (const withFloor of [true, false]) {
      const beyond = [buildFirstFloorCard(plan, withFloor), buildBeyondPools()];
      expect(beyond.reduce((sum, geometry) => sum + triangleCount(geometry), 0)).toBeLessThanOrEqual(8000);
    }
  });

  it("Nocturne: the moulded top and the pools draw in 2 calls (of 4); the top under 2.5k triangles", () => {
    expect(buildCoping().triangles).toBeLessThanOrEqual(2500);
    expect(triangleCount(buildBeyondPools())).toBe(2 * BEYOND_DOORWAYS.length);
  });
});

describe("the first floor in card (Atelier)", () => {
  it("stands every wall to 1.2 m, its sides upright, and lays the floor at +1 cm only when asked", () => {
    const plan = firstFloor();
    const card = buildFirstFloorCard(plan, true);
    const tags = card.getAttribute("aBeyond");
    const normal = card.getAttribute("normal");
    const position = card.getAttribute("position");
    let floors = 0;
    for (let i = 0; i < position.count; i++) {
      const code = tags.getY(i);
      if (code === CARD_PART.top) expect(position.getY(i)).toBeCloseTo(CARD_WALL_HEIGHT, 6);
      if (code === CARD_PART.floor) {
        floors += 1;
        expect(position.getY(i)).toBeCloseTo(BEYOND_FLOOR_Y, 6);
      }
      if (code === CARD_PART.side) expect(Math.abs(normal.getY(i))).toBeLessThan(1e-6);
    }
    expect(floors).toBeGreaterThan(0);
    const without = buildFirstFloorCard(plan, false).getAttribute("aBeyond");
    for (let i = 0; i < without.count; i++) expect(without.getY(i)).not.toBe(CARD_PART.floor);
    expect(CARD.wall).toEqual([0.86, 0.82, 0.76]);
    expect(CARD.section).toEqual([0.78, 0.72, 0.64]);
  });

  it("faces every wall's side out of its wall", () => {
    const plan = firstFloor();
    const card = buildFirstFloorCard(plan, false);
    const index = card.getIndex();
    const position = card.getAttribute("position");
    const normal = card.getAttribute("normal");
    const tags = card.getAttribute("aBeyond");
    if (index === null) throw new Error("indexed");
    const insideAny = (x: number, z: number): boolean => plan.walls.some((wall) => {
      const ring = (points: readonly (readonly [number, number])[]): boolean => {
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
          const a = points[i];
          const b = points[j];
          if (a === undefined || b === undefined) continue;
          if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
        }
        return inside;
      };
      return ring(wall.outline) && !wall.holes.some((hole) => ring(hole));
    });
    let checked = 0;
    for (let t = 0; t < index.count; t += 3) {
      const a = index.getX(t);
      if (tags.getY(a) !== CARD_PART.side) continue;
      const ids = [a, index.getX(t + 1), index.getX(t + 2)];
      const cx = ids.reduce((sum, i) => sum + position.getX(i), 0) / 3;
      const cz = ids.reduce((sum, i) => sum + position.getZ(i), 0) / 3;
      expect(insideAny(cx + normal.getX(a) * 0.01, cz + normal.getZ(a) * 0.01)).toBe(false);
      expect(insideAny(cx - normal.getX(a) * 0.01, cz - normal.getZ(a) * 0.01)).toBe(true);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(100);
  });
});

describe("the pools of light", () => {
  it("lie past each doorway, a little above the floors, wide enough for a pool 1.5-2 m across", () => {
    for (const [, y] of positions(buildBeyondPools())) expect(y).toBeCloseTo(POOL.y, 6);
    expect(POOL.y).toBeGreaterThan(BEYOND_FLOOR_Y);
    expect(2 * POOL.radius).toBeGreaterThanOrEqual(1.5);
    expect(2 * POOL.radius).toBeLessThanOrEqual(2);
    expect(POOL.width).toBeGreaterThanOrEqual(2 * POOL.radius);
  });
});

describe("the moulded top (Nocturne)", () => {
  it("is 60 mm, projecting 30 mm beyond each face, and runs the length of every wall", () => {
    const profile = copingProfile(1.14);
    expect(Math.max(...profile.map((p) => p[1]))).toBeCloseTo(COPING.height, 9);
    expect(Math.max(...profile.map((p) => p[0]))).toBeCloseTo(COPING.projection, 9);
    expect(Math.min(...profile.map((p) => p[0]))).toBeCloseTo(-1.14 - COPING.projection, 9);
    const runs = copingRuns();
    HALL_WALLS.forEach((wall, index) => {
      const own = runs.filter((run) => run.wall === index).sort((a, b) => a.u0 - b.u0);
      const inset = index === 1 || index === 3 ? COPING.projection : 0;
      expect(own[0]?.u0).toBeCloseTo(inset, 9);
      expect(own[own.length - 1]?.u1).toBeCloseTo(wall.length - inset, 9);
      for (let i = 0; i + 1 < own.length; i++) expect(own[i + 1]?.u0).toBeCloseTo(own[i]?.u1 ?? 0, 9);
    });
  });

  it("sits on the cut, never over an opening the cut passes through, nor over a doorway once its walling goes", () => {
    expect(copingBase(1.96)).toBe(1.96);
    expect(copingBase(100)).toBe(WALL_BODY_TOP);
    const arch = HALL_OPENINGS.find((opening) => opening.id === "arch-centre");
    if (arch === undefined) throw new Error("arch");
    expect(copingShown(0, arch.centre, 1.96)).toBe(false);
    expect(copingShown(0, arch.centre, 6.7)).toBe(true);
    for (const slot of DOOR_SLOTS) {
      const middle = (slot.u0 + slot.u1) / 2;
      expect(copingShown(slot.wall, middle, LINTEL_RELEASE - 0.5)).toBe(false);
      expect(copingShown(slot.wall, middle, 6.7)).toBe(true);
    }
    // Between openings the top shows at any cut.
    expect(copingShown(2, 5.0, 1.96)).toBe(true);
  });

  it("builds its material, the glint real on desktops and drawn on phones", () => {
    const section = new HallSectionUniforms();
    const mood = new HallMoodUniforms();
    for (const fake of [false, true]) expect(createCopingMaterial(section, mood, fake).name).toBe("grand-hall-coping");
  });
});

describe("the beyond's photographs", () => {
  it("are published at their stated sizes and match their record", () => {
    expect(record.atlas).toEqual([...BEYOND_ATLAS.size]);
    for (const [file, size] of [[BEYOND_ATLAS.files.full, [832, 640]], [BEYOND_ATLAS.files.half, [416, 320]]] as const) {
      const bytes = readFileSync(path.join(PUBLIC, file));
      expect(webpSize(bytes)).toEqual(size);
      expect(record.files[file]?.size).toEqual(size);
      expect(record.files[file]?.bytes).toBe(bytes.length);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(record.files[file]?.sha256);
    }
    // A phone's whole atlas, with its mips, under 1 MB of texture.
    expect(416 * 320 * 4 * (4 / 3)).toBeLessThan(1_000_000);
    const surfaces = new Map(record.surfaces.map((surface) => [surface.name, surface]));
    for (const [name, map] of [["saloon-floor", BEYOND_ATLAS.saloonFloor], ["landing-floor", BEYOND_ATLAS.landingFloor]] as const) {
      const surface = surfaces.get(name);
      expect(surface?.rect).toEqual([...map.rect]);
      expect(surface?.medianSrgb).toEqual([...map.median]);
      expect(surface?.map.x0).toBe(map.x0);
      expect(surface?.map.z0).toBe(map.z0);
      expect(surface?.map.ppm).toBe(map.ppm);
      // About 0.15 megapixels a floor.
      expect(map.rect[2] * map.rect[3]).toBeGreaterThan(100_000);
      expect(map.rect[2] * map.rect[3]).toBeLessThan(200_000);
    }
    for (const lining of BEYOND_ATLAS.linings) {
      const surface = surfaces.get(lining.opening === "door-end" ? "end-door-lining" : "main-door-lining");
      expect(surface?.rect).toEqual([...lining.rect]);
      expect(surface?.medianSrgb).toEqual([...lining.median]);
      expect(Number(surface?.map.u0)).toBeCloseTo(lining.u0, 6);
      expect(Number(surface?.map.u1)).toBeCloseTo(lining.u1, 6);
      expect(surface?.map.depth).toBe(lining.depth);
      expect(surface?.map.head).toBe(lining.head);
      const opening = HALL_OPENINGS.find((entry) => entry.id === lining.opening);
      expect(lining.u0).toBeCloseTo((opening?.centre ?? 0) - (opening?.width ?? 0) / 2, 6);
      expect(lining.depth).toBe(HALL_DOORS.find((door) => door.opening === lining.opening)?.depth);
    }
  });

  it("load once, the first time they are asked for, at the survey's revision, half size on phones", () => {
    const photos = new HallBeyondPhotos();
    photos.sample(uv());
    expect(photos.status).toBe("idle");
    photos.load(1, () => { /* settled */ });
    photos.load(1, () => { /* settled */ });
    expect(recorded.loads).toHaveLength(1);
    expect(recorded.loads[0]?.url).toBe(`/rooms/grand-hall/survey-2026-07-11/beyond-832.webp?r=${String(HALL_SURVEY_REVISION)}`);
    expect(recorded.options).toEqual([{ imageOrientation: "flipY", premultiplyAlpha: "none" }]);
    expect(beyondAtlasUrl(0.5)).toContain("beyond-416.webp");
    photos.dispose();
  });

  it("cross-fade in over 200 ms once they arrive, at once under reduced motion, and keep the medians if they fail", () => {
    const photos = new HallBeyondPhotos();
    const node = photos.sample(uv());
    const settled: boolean[] = [];
    photos.load(1, (loaded) => { settled.push(loaded); });
    expect(photos.step(0.1, () => false)).toBe(false);
    const close = vi.fn();
    recorded.loads[0]?.onLoad({ width: 832, height: 640, close });
    expect(settled).toEqual([true]);
    expect(node.value).toBeInstanceOf(Texture);
    expect(node.value.flipY).toBe(false);
    expect(photos.step(BEYOND_PHOTO_FADE / 2, () => false)).toBe(true);
    expect(photos.mix.value).toBeCloseTo(0.5, 6);
    expect(photos.step(BEYOND_PHOTO_FADE, () => false)).toBe(false);
    expect(photos.mix.value).toBe(1);
    photos.dispose();
    expect(close).toHaveBeenCalledTimes(1);

    const reduced = new HallBeyondPhotos();
    reduced.load(1, () => { /* settled */ });
    recorded.loads[1]?.onLoad({ width: 832, height: 640, close: vi.fn() });
    expect(reduced.step(0.001, () => true)).toBe(false);
    expect(reduced.mix.value).toBe(1);
    reduced.dispose();

    const failing = new HallBeyondPhotos();
    const outcome: boolean[] = [];
    failing.load(1, (loaded) => { outcome.push(loaded); });
    recorded.loads[2]?.onError();
    expect(outcome).toEqual([false]);
    expect(failing.status).toBe("failed");
    expect(failing.step(1, () => false)).toBe(false);
    expect(failing.mix.value).toBe(0);
    failing.dispose();
  });
});

describe("the section styles", () => {
  it("are complete: each its finish, its leaves and what lies beyond", () => {
    expect(SECTION_PRESETS.ashlar).toMatchObject({ light: "room", interiorFaces: true, liningPhotos: true, coping: false, leaves: "room", beyond: "photographs" });
    expect(SECTION_PRESETS.atelier).toMatchObject({ light: "card", leaves: "card", beyond: "first-floor", coping: false, outer: "#dbd1c2", core: "#c7b8a3" });
    expect(SECTION_PRESETS.nocturne).toMatchObject({ coping: true, beyond: "pools", outer: "#1d1814", core: "#1d1814" });
  });

  it("build every material, with and without the sun, for desktops and phones", () => {
    const section = new HallSectionUniforms();
    const mood = new HallMoodUniforms();
    const textures = { mahoganyDark: new Texture() };
    for (const preset of Object.values(SECTION_PRESETS)) {
      for (const options of [{ sunlit: false, multisampled: false }, { sunlit: true, multisampled: true }]) {
        const photos = new HallBeyondPhotos();
        const built = createHallSection(section, mood, { preset, ...options, textures, beyond: photos });
        expect(built.materials.body.name).toBe("grand-hall-wall-body");
        expect(built.coping !== null).toBe(preset.coping);
        built.dispose();
        photos.dispose();
      }
      const leaves = createDoorLeafMaterials(textures, new HallPhotos(), mood, section, new DoorSwingUniforms(), null, { card: preset.leaves === "card" });
      expect(leaves.size).toBe(4);
      for (const material of leaves.values()) material.dispose();
    }
    const photos = new HallBeyondPhotos();
    expect(createBeyondFloorMaterial(context(), photos).name).toBe("grand-hall-beyond-floors");
    expect(createBeyondSolidMaterial(context(), textures).name).toBe("grand-hall-beyond-solids");
    expect(createBeyondPoolMaterial(context(), 1).name).toBe("grand-hall-beyond-pools");
    expect(createFirstFloorCardMaterial(context()).name).toBe("grand-hall-first-floor-card");
    photos.dispose();
  });

  it("never sample the sun's shadow map on the cut walls, whose normal offset blacked out their tops' occlusion", () => {
    // The map's node reads normalWorld (three's ShadowNode normal bias); in these unlit materials it
    // put the pass's normal target out of step, and the ambient occlusion went black in speckles on
    // Atelier's cut tops (S3d, ?pipeline=ao). The first floor's card, apart from the hall, keeps it.
    const sun = createSunCaster({ name: "test-sun", box: { min: [-1, 0, -1], max: [1, 1, 1] }, mapSize: 256, reach: 1 });
    const section = new HallSectionUniforms();
    const mood = new HallMoodUniforms();
    const textures = { mahoganyDark: new Texture() };
    for (const preset of Object.values(SECTION_PRESETS)) {
      const photos = new HallBeyondPhotos();
      const built = createHallSection(section, mood, { preset, sunlit: true, sun, textures, beyond: photos });
      const materials = [built.materials.body, built.materials.cap, built.materials.plinth, ...(built.coping === null ? [] : [built.coping.material])];
      for (const material of materials) expect(samplesShadowMap(material)).toBe(false);
      built.dispose();
      photos.dispose();
    }
    expect(samplesShadowMap(createFirstFloorCardMaterial({ ...context(), sun }))).toBe(true);
    sun.dispose();
  });
});

/** Whether a node material's graph reads a shadow map (three flags its shadow nodes isShadowBaseNode; hall-sun.ts). */
function samplesShadowMap(material: Material): boolean {
  if (!(material instanceof NodeMaterial)) return false;
  let found = false;
  for (const node of [material.colorNode, material.opacityNode, material.maskNode, material.positionNode]) {
    node?.traverse((child) => { if ("isShadowBaseNode" in child && child.isShadowBaseNode === true) found = true; });
  }
  return found;
}
