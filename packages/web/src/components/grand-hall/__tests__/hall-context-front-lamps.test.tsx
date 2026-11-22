import { readFileSync } from "node:fs";
import path from "node:path";
import { act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountInStubRoot, type StubRoot } from "../../__tests__/stub-r3f-root.js";
import { CONTEXT_MODEL_FRONT_URL, CONTEXT_MODEL_URL } from "../hall-context.js";
import { FACADE_LIGHTS_URL } from "../hall-facade-lights.js";
import { STREET_LAMPS_FRONT_URL, STREET_LAMPS_URL, STREET_LIGHT_FRONT_URL, STREET_LIGHT_URL } from "../hall-street-light.js";
import type { HallFinish } from "../hall-finish.js";

// A computer's finish, as the hall reads it.
vi.mock("../hall-finish.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../hall-finish.js")>();
  return { ...original, useHallFinish: (): HallFinish => original.FULL_HALL_FINISH };
});

// A front whose build fails when the test says so, once its city and lamps are on screen.
const front = vi.hoisted(() => ({ fail: null as (() => void) | null }));
vi.mock("../HallExterior.js", () => ({
  HallExterior: ({ onFailed }: { readonly onFailed?: () => void }): null => {
    front.fail = onFailed ?? null;
    return null;
  },
}));

const { HallContext } = await import("../HallContext.js");

/** The site's own files, as the planner fetches them. */
function served(url: string): Buffer {
  return readFileSync(path.join(path.resolve("public"), url.split("?")[0] ?? ""));
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

let mounted: StubRoot | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  front.fail = null;
  vi.unstubAllGlobals();
});

async function settle(steps = 8): Promise<void> {
  for (let step = 0; step < steps; step++) {
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });
  }
}

describe("a measured front that fails after its lamps are lit", () => {
  it("takes its lamps with it, and the city's own failing leaves the street unlit, not lit for the front", async () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      asked.push(url);
      if (url === CONTEXT_MODEL_FRONT_URL || url === CONTEXT_MODEL_URL) {
        return Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(cityModel()) });
      }
      if (url === STREET_LIGHT_FRONT_URL) {
        const file = served(url);
        return Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)) });
      }
      if (url === STREET_LAMPS_FRONT_URL || url === FACADE_LIGHTS_URL) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(served(url).toString("utf-8")) as unknown) });
      }
      // The city's own lamps cannot be had.
      return Promise.resolve({ ok: false, status: 404 });
    }));
    mounted = mountInStubRoot(<HallContext />);
    await settle();
    const scene = mounted.scene;
    expect(scene.getObjectByName("grand-hall-street-lamps"), "the front's lamps, before it fails").toBeDefined();
    expect(scene.getObjectByName("grand-hall-facade-lights")).toBeDefined();

    expect(front.fail).not.toBeNull();
    act(() => { front.fail?.(); });
    await settle();

    expect(asked).toContain(STREET_LIGHT_URL);
    expect(asked).toContain(STREET_LAMPS_URL);
    expect(scene.getObjectByName("grand-hall-street-lamps"), "the front's lamps, after it failed").toBeUndefined();
    // The lit openings are one file for both fronts: they stay, and are not fetched again.
    expect(scene.getObjectByName("grand-hall-facade-lights")).toBeDefined();
    expect(asked.filter((url) => url === FACADE_LIGHTS_URL)).toHaveLength(1);
  });
});
