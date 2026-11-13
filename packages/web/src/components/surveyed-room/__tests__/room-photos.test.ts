import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClampToEdgeWrapping, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace } from "three";
import { float, uv } from "three/tsl";
import { parseSurveyRecord } from "../survey-record.js";

// The photographs decode through createImageBitmap, off the main thread; a
// fake loader stands in for it here and records what it was asked to do.
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

const { RoomPhotos, roomPhotoFile, roomPhotoSources, ROOM_PLACEHOLDER_TONE } = await import("../room-photos.js");
type RoomPhotoSource = import("../room-photos.js").RoomPhotoSource;

const SALOON = parseSurveyRecord(JSON.parse(
  readFileSync(path.resolve("src/components/surveyed-room/__tests__/fixtures/saloon-survey.fixture.json"), "utf-8"),
));
const ENTRY = { base: "/rooms/saloon/survey-2026-07-11", revision: 3 };

/** A decoded image, with its close() kept apart for assertions. */
function bitmap(): { readonly image: ImageBitmap; readonly close: ReturnType<typeof vi.fn> } {
  const close = vi.fn();
  return { image: { width: 4, height: 4, close }, close };
}

function loadFor(name: string): { onLoad: (bitmap: ImageBitmap) => void; onError: () => void } {
  const entry = recorded.loads.find((load) => load.url.includes(name));
  if (entry === undefined) throw new Error(`no load for ${name}`);
  return entry;
}

afterEach(() => {
  recorded.options.length = 0;
  recorded.loads.length = 0;
});

describe("which size of a photograph a device takes", () => {
  it("is the largest at full quality and the next size down below it", () => {
    const sizes = ["walls-4096.webp", "walls-2048.webp"];
    expect(roomPhotoFile(sizes, 1)).toBe("walls-4096.webp");
    expect(roomPhotoFile(sizes, 0.75)).toBe("walls-4096.webp");
    expect(roomPhotoFile(sizes, 0.5)).toBe("walls-2048.webp");
    // Three sizes published: a phone takes the second, not the smallest.
    expect(roomPhotoFile(["a-8192.webp", "a-4096.webp", "a-2048.webp"], 0.5)).toBe("a-4096.webp");
  });

  it("is the only size where one is published, and nothing where none is", () => {
    expect(roomPhotoFile(["floor-1463.webp"], 0.5)).toBe("floor-1463.webp");
    expect(roomPhotoFile([], 1)).toBeNull();
  });

  it("names the Saloon's three photographs at the entry's revision, per device", () => {
    expect(roomPhotoSources(SALOON, ENTRY, 1)).toEqual([
      { kind: "walls", file: "walls-4096.webp", url: "/rooms/saloon/survey-2026-07-11/walls-4096.webp?r=3" },
      { kind: "ceiling", file: "ceiling-1829.webp", url: "/rooms/saloon/survey-2026-07-11/ceiling-1829.webp?r=3" },
      { kind: "floor", file: "floor-1463.webp", url: "/rooms/saloon/survey-2026-07-11/floor-1463.webp?r=3" },
    ]);
    expect(roomPhotoSources(SALOON, ENTRY, 0.5).map((source) => source.file)).toEqual(["walls-2048.webp", "ceiling-915.webp", "floor-732.webp"]);
  });

  it("leaves out a surface that publishes no photograph", () => {
    const bare = { ...SALOON, floor: { ...SALOON.floor, files: [] } };
    expect(roomPhotoSources(bare, ENTRY, 1).map((source) => source.kind)).toEqual(["walls", "ceiling"]);
  });
});

describe("RoomPhotos", () => {
  it("shows each surface as one opaque, filtered texel of a plain tone until its photograph arrives", () => {
    const photos = new RoomPhotos();
    for (const kind of ["walls", "ceiling", "floor"] as const) {
      const texture = photos.sample(kind, uv()).value;
      const image = texture.image as { readonly data: Uint8Array; readonly width: number; readonly height: number };
      expect(Array.from(image.data)).toEqual([...ROOM_PLACEHOLDER_TONE, 255]);
      expect([image.width, image.height]).toEqual([1, 1]);
      // Nearest filtering would bind it without a sampler, and the walls' biased sample would not compile.
      expect(texture.magFilter).toBe(LinearFilter);
      expect(texture.minFilter).toBe(LinearFilter);
      expect(texture.colorSpace).toBe(SRGBColorSpace);
    }
    photos.dispose();
  });

  it("decodes each photograph flipped and with its alpha as stored, and uploads it unflipped", () => {
    const photos = new RoomPhotos();
    const walls = photos.sample("walls", uv());
    const ceiling = photos.sample("ceiling", uv());
    const before = ceiling.value;
    const settled: [RoomPhotoSource, boolean][] = [];
    const sources = roomPhotoSources(SALOON, ENTRY, 1);
    photos.load(sources, (source, loaded) => { settled.push([source, loaded]); });
    // The wall atlas's alpha marks glass: premultiplying by it would darken the windows.
    expect(recorded.options).toEqual([{ imageOrientation: "flipY", premultiplyAlpha: "none" }]);
    expect(recorded.loads.map((load) => load.url)).toEqual(sources.map((source) => source.url));

    const decoded = bitmap();
    loadFor("walls-4096").onLoad(decoded.image);
    expect(walls.value.image).toBe(decoded.image);
    expect(walls.value.flipY).toBe(false);
    expect(walls.value.colorSpace).toBe(SRGBColorSpace);
    expect(walls.value.generateMipmaps).toBe(true);
    expect(walls.value.minFilter).toBe(LinearMipmapLinearFilter);
    expect(walls.value.wrapS).toBe(ClampToEdgeWrapping);
    expect(walls.value.wrapT).toBe(ClampToEdgeWrapping);
    expect(walls.value.anisotropy).toBe(8);
    expect(settled).toEqual([[sources[0], true]]);
    // Only the walls changed.
    expect(ceiling.value).toBe(before);
    photos.dispose();
  });

  it("swaps a loaded photograph into every node sampling it, a biased sample and one made later included", () => {
    const photos = new RoomPhotos();
    const first = photos.sample("walls", uv());
    const coarse = first.bias(float(2.5));
    const second = photos.sample("walls", uv());
    photos.load(roomPhotoSources(SALOON, ENTRY, 0.5), () => { /* settled */ });
    const decoded = bitmap();
    loadFor("walls-2048").onLoad(decoded.image);
    expect(first.value.image).toBe(decoded.image);
    expect(second.value.image).toBe(decoded.image);
    expect(coarse.value.image).toBe(decoded.image);
    expect(photos.sample("walls", uv()).value.image).toBe(decoded.image);
    photos.dispose();
  });

  it("leaves a surface in its plain tone when its photograph fails, and says so", () => {
    const photos = new RoomPhotos();
    const floor = photos.sample("floor", uv());
    const placeholder = floor.value;
    const settled: [string, boolean][] = [];
    photos.load(roomPhotoSources(SALOON, ENTRY, 1), (source, loaded) => { settled.push([source.file, loaded]); });
    loadFor("floor-1463").onError();
    expect(floor.value).toBe(placeholder);
    expect(settled).toEqual([["floor-1463.webp", false]]);
    photos.dispose();
  });

  it("frees every texture and decoded bitmap, including one that arrives after disposal, and reports nothing after it", () => {
    const photos = new RoomPhotos();
    const walls = photos.sample("walls", uv());
    const floor = photos.sample("floor", uv());
    const freed: string[] = [];
    walls.value.addEventListener("dispose", () => { freed.push("walls placeholder"); });
    floor.value.addEventListener("dispose", () => { freed.push("floor placeholder"); });
    const settled: string[] = [];
    photos.load(roomPhotoSources(SALOON, ENTRY, 1), (source) => { settled.push(source.file); });
    const kept = bitmap();
    loadFor("walls-4096").onLoad(kept.image);
    walls.value.addEventListener("dispose", () => { freed.push("walls photograph"); });
    expect(settled).toEqual(["walls-4096.webp"]);

    photos.dispose();
    expect(freed.sort()).toEqual(["floor placeholder", "walls photograph", "walls placeholder"]);
    expect(kept.close).toHaveBeenCalledTimes(1);

    const late = bitmap();
    loadFor("ceiling-1829").onLoad(late.image);
    expect(late.close).toHaveBeenCalledTimes(1);
    loadFor("floor-1463").onError();
    expect(settled).toEqual(["walls-4096.webp"]);
  });
});
