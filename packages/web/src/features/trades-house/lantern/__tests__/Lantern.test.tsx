import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Lantern } from "../Lantern.js";
import type { LanternGL } from "../lantern-program.js";
import type { LanternHandle } from "../lantern-types.js";

const LIGHTS = [
  { x: 0.5, y: 0.56, intensity: 1, warmth: 1 },
  { x: 0.31, y: 0.5, intensity: 0.3, warmth: 0.8 },
];

function fakeContext(): { readonly gl: LanternGL; readonly calls: string[] } {
  const calls: string[] = [];
  const gl: LanternGL = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    ARRAY_BUFFER: 5,
    STATIC_DRAW: 6,
    FLOAT: 7,
    TRIANGLES: 8,
    COLOR_BUFFER_BIT: 9,
    BLEND: 10,
    ONE: 11,
    ONE_MINUS_SRC_ALPHA: 12,
    createShader: () => ({}),
    shaderSource: () => undefined,
    compileShader: () => undefined,
    getShaderParameter: () => true,
    deleteShader: () => undefined,
    createProgram: () => ({}),
    attachShader: () => undefined,
    linkProgram: () => undefined,
    getProgramParameter: () => true,
    deleteProgram: () => { calls.push("deleteProgram"); },
    useProgram: () => undefined,
    createBuffer: () => ({}),
    bindBuffer: () => undefined,
    bufferData: () => undefined,
    deleteBuffer: () => { calls.push("deleteBuffer"); },
    getAttribLocation: () => 0,
    enableVertexAttribArray: () => undefined,
    vertexAttribPointer: () => undefined,
    getUniformLocation: (_program, name) => ({ name }),
    uniform1f: () => undefined,
    uniform1i: () => undefined,
    uniform2f: () => undefined,
    uniform3fv: () => undefined,
    uniform4fv: () => undefined,
    enable: () => undefined,
    blendFunc: () => undefined,
    viewport: () => undefined,
    clearColor: () => undefined,
    clear: () => undefined,
    drawArrays: () => { calls.push("drawArrays"); },
    isContextLost: () => false,
  };
  return { gl, calls };
}

describe("Lantern", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("hides the canvas and leaves the CSS dusk when no WebGL context can be had", () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
    const onHandle = vi.fn<(handle: LanternHandle | null) => void>();

    render(<Lantern program="river-gate" active reducedMotion={false} lights={LIGHTS} onHandle={onHandle} />);

    const canvas = screen.getByTestId("lantern-canvas");
    expect(canvas.style.display).toBe("none");
    expect(canvas.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByTestId("lantern-fallback")).toBeTruthy();
    // WebGL2 is asked for first, then WebGL1, each without alpha for an opaque preset.
    expect(getContext.mock.calls.map((call) => call[0])).toEqual(["webgl2", "webgl"]);
    expect(getContext.mock.calls[0]?.[1]).toMatchObject({ alpha: false, antialias: false, depth: false });
    expect(onHandle).not.toHaveBeenCalledWith(expect.objectContaining({ programId: "river-gate" }));
  });

  it("places the fallback's flame at the first light and marks it still under reduced motion", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
    render(<Lantern program="river-gate" active reducedMotion lights={LIGHTS} />);
    const fallback = screen.getByTestId("lantern-fallback");
    expect(fallback.style.getPropertyValue("--lantern-x")).toBe("50%");
    expect(fallback.style.getPropertyValue("--lantern-y")).toBe("56%");
    expect(fallback.className).toContain("lantern-fallback--still");
    expect(fallback.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders nothing for program none", () => {
    const { container } = render(<Lantern program="none" active reducedMotion={false} lights={[]} />);
    expect(container.childElementCount).toBe(0);
  });

  it("hands out a handle once the program is up, draws a frame, and withdraws it on unmount", () => {
    const { gl, calls } = fakeContext();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((id) =>
      id === "webgl2" ? (gl as WebGL2RenderingContext) : null,
    );
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const onHandle = vi.fn<(handle: LanternHandle | null) => void>();

    const view = render(
      <Lantern program="river-gate" active reducedMotion={false} lights={LIGHTS} onHandle={onHandle} />,
    );

    const handle = onHandle.mock.calls.at(-1)?.[0];
    expect(handle).not.toBeNull();
    expect(handle?.programId).toBe("river-gate");
    expect(handle?.degraded).toBe(false);
    expect(handle?.fillMegapixels).toBe(0); // happy-dom lays nothing out: a 0×0 canvas

    // A frame draws the triangle once.
    expect(frames).toHaveLength(1);
    act(() => {
      frames[0]?.(16);
    });
    expect(calls.filter((c) => c === "drawArrays")).toHaveLength(1);

    // The handle accepts the whole vocabulary without throwing and keeps at most eight rings.
    act(() => {
      handle?.setPointer(0.5, 0.7, 120);
      handle?.setPointer(-1, -1, 0);
      handle?.gutter(0.8);
      handle?.setDusk(0.4);
      handle?.setLights(LIGHTS.slice(0, 1));
      for (let i = 0; i < 12; i += 1) {
        handle?.ripple(0.4 + i * 0.01, 0.8);
      }
    });

    view.unmount();
    expect(onHandle).toHaveBeenLastCalledWith(null);
    expect(calls).toContain("deleteProgram");
    expect(calls).toContain("deleteBuffer");
  });

  it("does not boot a program while inactive", () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
    render(<Lantern program="river-gate" active={false} reducedMotion={false} lights={LIGHTS} />);
    expect(getContext).not.toHaveBeenCalled();
    expect(screen.getByTestId("lantern-fallback")).toBeTruthy();
  });
});
