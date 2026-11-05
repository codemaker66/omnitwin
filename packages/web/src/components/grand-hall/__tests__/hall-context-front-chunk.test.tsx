import { act } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mountInStubRoot, type StubRoot } from "../../__tests__/stub-r3f-root.js";
import { CHUNK_RELOAD_GUARD_KEY, installStaleChunkReload, stalePage } from "../../../route-error-boundary.js";
import { CONTEXT_MODEL_FRONT_URL, CONTEXT_MODEL_URL } from "../hall-context.js";
import { FACADE_LIGHTS_FRONT_URL, FACADE_LIGHTS_URL } from "../hall-facade-lights.js";
import { STREET_LAMPS_FRONT_URL, STREET_LAMPS_URL, STREET_LIGHT_FRONT_URL, STREET_LIGHT_URL } from "../hall-street-light.js";
import type { HallFinish } from "../hall-finish.js";

// A computer's finish, as the hall reads it.
vi.mock("../hall-finish.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../hall-finish.js")>();
  return { ...original, useHallFinish: (): HallFinish => original.FULL_HALL_FINISH };
});

/**
 * The front's import as a build runs it once a deploy has replaced its chunk. Vite's preload
 * helper (6.4: `baseModule().catch(handlePreloadError)`) first asks the page with a cancelable
 * `vite:preloadError`, rethrows if the page leaves it, and otherwise resolves to nothing.
 */
function staleChunkImport(): Promise<undefined> {
  const failure = new TypeError("Failed to fetch dynamically imported module: /assets/HallExterior-old.js");
  return Promise.reject(failure).catch((error: unknown) => {
    const event = new Event("vite:preloadError", { cancelable: true });
    window.dispatchEvent(event);
    if (!event.defaultPrevented) throw error;
    return undefined;
  });
}

/** One packed triangle of the city model ('VVCX', version 1, int16 cm vertices, uint32 indices). */
function cityModel(): ArrayBuffer {
  const vertices = [0, 0, 0, 1000, 0, 0, 0, 250, -1200];
  const buffer = new ArrayBuffer(16 + vertices.length * 2 + 3 * 4);
  const view = new DataView(buffer);
  "VVCX".split("").forEach((letter, i) => { view.setUint8(i, letter.charCodeAt(0)); });
  view.setUint32(4, 1, true);
  view.setUint32(8, 3, true);
  view.setUint32(12, 3, true);
  vertices.forEach((value, i) => { view.setInt16(16 + i * 2, value, true); });
  [0, 1, 2].forEach((value, i) => { view.setUint32(16 + vertices.length * 2 + i * 4, value, true); });
  return buffer;
}

/**
 * Each of the front's files, and the city's own that must follow it once the front is given up
 * (the lit openings are one file for both, so it is fetched again).
 */
const FRONT_THEN_OWN = [
  [CONTEXT_MODEL_FRONT_URL, CONTEXT_MODEL_URL],
  [STREET_LIGHT_FRONT_URL, STREET_LIGHT_URL],
  [STREET_LAMPS_FRONT_URL, STREET_LAMPS_URL],
  [FACADE_LIGHTS_FRONT_URL, FACADE_LIGHTS_URL],
] as const;

const reload = vi.fn();
let mounted: StubRoot | null = null;

beforeAll(() => {
  // As router.tsx does when the app starts.
  installStaleChunkReload(window);
});

beforeEach(() => {
  window.sessionStorage.clear();
  reload.mockClear();
  vi.spyOn(stalePage, "reload").mockImplementation(reload);
  // React.lazy keeps the first answer it is given, so each case needs a fresh HallContext.
  vi.resetModules();
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Mounts the city with the front's chunk gone, and returns every URL it fetched, in order. */
async function cityWithStaleFront(): Promise<readonly string[]> {
  const asked: string[] = [];
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    asked.push(url);
    if (url === CONTEXT_MODEL_FRONT_URL || url === CONTEXT_MODEL_URL) {
      return Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(cityModel()) });
    }
    return Promise.resolve({ ok: false, status: 404 });
  }));
  const { HallContext, frontChunk } = await import("../HallContext.js");
  vi.spyOn(frontChunk, "load").mockImplementation(staleChunkImport);
  mounted = mountInStubRoot(<HallContext />);
  // The front's city arrives, the front's import fails, the city's own files follow.
  for (let step = 0; step < 12; step++) {
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });
  }
  return asked;
}

function expectTheCityTookItsOwnFrontBack(asked: readonly string[]): void {
  for (const [front, own] of FRONT_THEN_OWN) {
    expect(asked.indexOf(front), front).toBeGreaterThanOrEqual(0);
    expect(asked.lastIndexOf(own), own).toBeGreaterThan(asked.indexOf(front));
  }
  expect(mounted?.scene.getObjectByName("grand-hall-city")).toBeDefined();
}

describe("a measured front whose chunk a deploy has replaced", () => {
  it("resolves to nothing once the page has claimed its one reload, and the city keeps a front", async () => {
    const asked = await cityWithStaleFront();
    expect(reload).toHaveBeenCalledTimes(1);
    expectTheCityTookItsOwnFrontBack(asked);
  });

  it("rejects when this minute's reload is already spent, and the city keeps a front", async () => {
    window.sessionStorage.setItem(CHUNK_RELOAD_GUARD_KEY, String(Date.now()));
    const asked = await cityWithStaleFront();
    expect(reload).not.toHaveBeenCalled();
    expectTheCityTookItsOwnFrontBack(asked);
  });
});
