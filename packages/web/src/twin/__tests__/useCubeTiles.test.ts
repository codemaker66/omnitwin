import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CubeTexture } from "three";
import { TWIN_FACES } from "@omnitwin/types";
import { FACE_TO_CUBE } from "../twin-basis.js";
import { useCubeTiles } from "../useCubeTiles.js";

// -----------------------------------------------------------------------------
// useCubeTiles — unit tests with a manually-triggered Image mock (happy-dom
// never loads real images) and a recording 2D-context mock (the FlameCanvas
// getContext-spy pattern). The tests pin the streaming order (all six 256
// faces before any 1024 face), the FACE_TO_CUBE slot ordering of the built
// CubeTexture, and disposal on node change and unmount.
// -----------------------------------------------------------------------------

/** Stand-in for the browser Image: records instances, loads only on demand. */
class MockImage {
  static instances: MockImage[] = [];
  crossOrigin: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = "";
  constructor() {
    MockImage.instances.push(this);
  }
}

interface RecordedContext {
  readonly canvas: HTMLCanvasElement;
  readonly scaleCalls: [number, number][];
  readonly translateCalls: [number, number][];
  readonly rotateCalls: number[];
  readonly drawnSrcs: string[];
}

const contexts: RecordedContext[] = [];

/** The 2D-context surface useCubeTiles touches — happy-dom has no real one. */
interface RecordingContext2D {
  scale(x: number, y: number): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  drawImage(image: unknown, dx: number, dy: number, dw: number, dh: number): void;
}

/** Typed helper: stand a narrow recording fake in for the full 2D context. */
function asContext2D(fake: RecordingContext2D): CanvasRenderingContext2D {
  const widened: unknown = fake;
  return widened as CanvasRenderingContext2D;
}

function makeRecordingContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const recorded: RecordedContext = {
    canvas,
    scaleCalls: [],
    translateCalls: [],
    rotateCalls: [],
    drawnSrcs: [],
  };
  contexts.push(recorded);
  return asContext2D({
    scale: (x: number, y: number): void => {
      recorded.scaleCalls.push([x, y]);
    },
    translate: (x: number, y: number): void => {
      recorded.translateCalls.push([x, y]);
    },
    rotate: (angle: number): void => {
      recorded.rotateCalls.push(angle);
    },
    drawImage: (image: unknown): void => {
      recorded.drawnSrcs.push((image as MockImage).src);
    },
  });
}

type GetContext = typeof HTMLCanvasElement.prototype.getContext;

/** Typed helper: a getContext implementation that hands back recording fakes. */
function recordingGetContext(): GetContext {
  const impl = function (this: HTMLCanvasElement): CanvasRenderingContext2D {
    return makeRecordingContext(this);
  };
  const widened: unknown = impl;
  return widened as GetContext;
}

const BASE = "/twin/trades-hall";

/** WebGL cube face order — [px, nx, py, ny, pz, nz]. */
const SLOT_INDEX = { px: 0, nx: 1, py: 2, ny: 3, pz: 4, nz: 5 } as const;

function imagesFor(lod: 256 | 1024): MockImage[] {
  return MockImage.instances.filter((image) => image.src.endsWith(`_${String(lod)}.webp`));
}

/** Fire onload for every pending image of one LOD and flush the microtasks. */
async function completeLod(lod: 256 | 1024): Promise<void> {
  await act(async () => {
    for (const image of imagesFor(lod)) {
      image.onload?.();
    }
    await Promise.resolve();
  });
}

function canvasThatDrew(src: string): HTMLCanvasElement {
  const recorded = contexts.find((context) => context.drawnSrcs.includes(src));
  if (recorded === undefined) {
    throw new Error(`no canvas drew ${src}`);
  }
  return recorded.canvas;
}

describe("useCubeTiles", () => {
  beforeEach(() => {
    MockImage.instances = [];
    contexts.length = 0;
    vi.stubGlobal("Image", MockImage);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      recordingGetContext(),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("streams 256 first, swaps to 1024, and orders cube slots per FACE_TO_CUBE", async () => {
    const { result } = renderHook(() => useCubeTiles("scan_000", BASE));

    // Exactly the six 256 faces load first — anonymous CORS, correct tile URLs.
    expect(MockImage.instances).toHaveLength(6);
    for (const face of TWIN_FACES) {
      expect(
        MockImage.instances.some(
          (image) => image.src === `${BASE}/tiles/scan_000/${face}_256.webp`,
        ),
      ).toBe(true);
    }
    expect(MockImage.instances.every((image) => image.crossOrigin === "anonymous")).toBe(true);
    expect(result.current.texture).toBeNull();
    expect(result.current.lod).toBe(0);

    await completeLod(256);
    await waitFor(() => {
      expect(result.current.lod).toBe(256);
    });
    expect(result.current.texture).toBeInstanceOf(CubeTexture);

    // Only after the 256 set is live does the 1024 set start.
    expect(MockImage.instances).toHaveLength(12);
    expect(imagesFor(1024)).toHaveLength(6);

    await completeLod(1024);
    await waitFor(() => {
      expect(result.current.lod).toBe(1024);
    });

    // The CubeTexture's [px,nx,py,ny,pz,nz] slots follow FACE_TO_CUBE targets.
    const texture = result.current.texture;
    expect(texture).not.toBeNull();
    const cubeImages = (texture as CubeTexture).images as unknown[];
    expect(cubeImages).toHaveLength(6);
    for (const face of TWIN_FACES) {
      const slot = SLOT_INDEX[FACE_TO_CUBE[face].target];
      expect(cubeImages[slot]).toBe(canvasThatDrew(`${BASE}/tiles/scan_000/${face}_1024.webp`));
    }

    // One draw per face per LOD; the rotate/flip transforms are derived from
    // the calibration table, so future FACE_TO_CUBE calibration edits cannot
    // break this test — it pins the drawing contract, not the calibration.
    expect(contexts).toHaveLength(12);
    for (const face of TWIN_FACES) {
      const mapping = FACE_TO_CUBE[face];
      for (const lod of [256, 1024] as const) {
        const src = `${BASE}/tiles/scan_000/${face}_${String(lod)}.webp`;
        const recorded = contexts.find((context) => context.drawnSrcs.includes(src));
        if (recorded === undefined) {
          throw new Error(`no canvas drew ${src}`);
        }
        expect(recorded.drawnSrcs).toEqual([src]);
        // rotateQuarters draws as one clockwise rotation about the face
        // centre, bracketed by a translate to the centre and back.
        expect(recorded.rotateCalls).toEqual(
          mapping.rotateQuarters === 0 ? [] : [(mapping.rotateQuarters * Math.PI) / 2],
        );
        const flipCount = (mapping.flipX ? 1 : 0) + (mapping.flipY ? 1 : 0);
        expect(recorded.scaleCalls).toHaveLength(flipCount);
        expect(recorded.translateCalls).toHaveLength(
          (mapping.rotateQuarters === 0 ? 0 : 2) + flipCount,
        );
        if (mapping.rotateQuarters !== 0) {
          expect(recorded.translateCalls[0]).toEqual([lod / 2, lod / 2]);
          expect(recorded.translateCalls[1]).toEqual([-lod / 2, -lod / 2]);
        }
      }
    }
  });

  it("disposes the previous texture when the node changes and restarts at 256", async () => {
    const dispose = vi.spyOn(CubeTexture.prototype, "dispose");
    const { result, rerender } = renderHook(({ nodeId }) => useCubeTiles(nodeId, BASE), {
      initialProps: { nodeId: "scan_000" },
    });

    await completeLod(256);
    await waitFor(() => {
      expect(result.current.lod).toBe(256);
    });
    expect(dispose).not.toHaveBeenCalled();

    await completeLod(1024);
    await waitFor(() => {
      expect(result.current.lod).toBe(1024);
    });
    // The 256 texture is released the moment the 1024 swap lands.
    expect(dispose).toHaveBeenCalledTimes(1);

    rerender({ nodeId: "scan_001" });
    // Node change releases the live 1024 texture and resets the state.
    expect(dispose).toHaveBeenCalledTimes(2);
    expect(result.current.texture).toBeNull();
    expect(result.current.lod).toBe(0);

    const fresh = MockImage.instances.slice(12);
    expect(fresh).toHaveLength(6);
    expect(
      fresh.every(
        (image) => image.src.includes("scan_001") && image.src.endsWith("_256.webp"),
      ),
    ).toBe(true);
  });

  it("disposes the live texture on unmount", async () => {
    const dispose = vi.spyOn(CubeTexture.prototype, "dispose");
    const { result, unmount } = renderHook(() => useCubeTiles("scan_002", BASE));

    await completeLod(256);
    await waitFor(() => {
      expect(result.current.lod).toBe(256);
    });
    expect(dispose).not.toHaveBeenCalled();

    unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("stays inert when image callbacks never fire (happy-dom guard)", () => {
    const dispose = vi.spyOn(CubeTexture.prototype, "dispose");
    const { result, unmount } = renderHook(() => useCubeTiles("scan_003", BASE));

    expect(result.current.texture).toBeNull();
    expect(result.current.lod).toBe(0);
    expect(() => {
      unmount();
    }).not.toThrow();
    expect(dispose).not.toHaveBeenCalled();
  });
});
