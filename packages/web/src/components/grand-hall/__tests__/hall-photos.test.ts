import { afterEach, describe, expect, it, vi } from "vitest";
import { uv } from "three/tsl";

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

const { HallPhotos } = await import("../hall-photos.js");

function bitmap(): ImageBitmap {
  return { width: 4, height: 4, close: vi.fn() };
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

describe("HallPhotos", () => {
  it("decodes each photograph flipped, and uploads it unflipped, on either backend", () => {
    const photos = new HallPhotos();
    const walls = photos.sample("walls", uv());
    const settled: [string, boolean][] = [];
    photos.load(1, (kind, loaded) => { settled.push([kind, loaded]); });
    expect(recorded.options).toEqual([{ imageOrientation: "flipY", premultiplyAlpha: "none" }]);
    expect(recorded.loads.map((load) => load.url.split("?")[0])).toEqual([
      "/rooms/grand-hall/survey-2026-07-11/walls-4096.webp",
      "/rooms/grand-hall/survey-2026-07-11/ceiling-3072.webp",
      "/rooms/grand-hall/survey-2026-07-11/dome-4096.webp",
    ]);

    const decoded = bitmap();
    loadFor("walls").onLoad(decoded);
    expect(walls.value.image).toBe(decoded);
    expect(walls.value.flipY).toBe(false);
    expect(walls.value.generateMipmaps).toBe(true);
    expect(settled).toEqual([["walls", true]]);
    photos.dispose();
  });

  it("releases every decoded bitmap, including one that arrives after disposal", () => {
    const photos = new HallPhotos();
    photos.load(0.5, () => { /* settled */ });
    const kept = bitmap();
    loadFor("walls-2048").onLoad(kept);
    photos.dispose();
    expect(kept.close).toHaveBeenCalledTimes(1);

    const late = bitmap();
    loadFor("dome-2048").onLoad(late);
    expect(late.close).toHaveBeenCalledTimes(1);
  });

  it("leaves a surface in its average colour when its photograph fails", () => {
    const photos = new HallPhotos();
    const ceiling = photos.sample("ceiling", uv());
    const placeholder = ceiling.value;
    const settled: [string, boolean][] = [];
    photos.load(1, (kind, loaded) => { settled.push([kind, loaded]); });
    loadFor("ceiling").onError();
    expect(ceiling.value).toBe(placeholder);
    expect(settled).toEqual([["ceiling", false]]);
    photos.dispose();
  });
});
