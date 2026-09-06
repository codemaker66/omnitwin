import { describe, expect, it } from "vitest";
import {
  createLanternProgram,
  MAX_LIGHT_UNIFORMS,
  packLights,
  packRipples,
  presetFor,
  STAGE_ASPECT,
  stageViewport,
  type LanternFrame,
  type LanternGL,
} from "../lantern-program.js";
import { MAX_RIPPLES } from "../lantern-types.js";

describe("stageViewport — the 16:9 frame under any aspect", () => {
  it("shows the whole frame at 16:9", () => {
    expect(stageViewport(1920, 1080)).toEqual({ xMin: 0, xMax: 1 });
    expect(STAGE_ASPECT).toBeCloseTo(16 / 9, 6);
  });

  it("crops a 9:16 phone to the middle, keeping the port at centre", () => {
    const { xMin, xMax } = stageViewport(390, 844);
    expect(xMin).toBeCloseTo(0.37, 2);
    expect(xMax).toBeCloseTo(0.63, 2);
    expect((xMin + xMax) / 2).toBeCloseTo(0.5, 9);
  });

  it("sees beyond both edges on an ultrawide", () => {
    const { xMin, xMax } = stageViewport(3440, 1440);
    expect(xMin).toBeLessThan(0);
    expect(xMax).toBeGreaterThan(1);
  });

  it("does not divide by a zero height", () => {
    expect(stageViewport(100, 0)).toEqual({ xMin: 0, xMax: 1 });
  });
});

describe("packLights / packRipples", () => {
  it("packs vec4 rows, clamps intensity and warmth, and caps at sixteen", () => {
    const out = new Float32Array(MAX_LIGHT_UNIFORMS * 4);
    const lights = Array.from({ length: 20 }, (_, i) => ({ x: i / 20, y: 0.5, intensity: 2, warmth: -1 }));
    expect(packLights(lights, out)).toBe(16);
    expect(out[0]).toBe(0);
    expect(out[2]).toBe(1);
    expect(out[3]).toBe(0);
    expect(out[4 * 15]).toBeCloseTo(15 / 20, 6);
  });

  it("zeroes the tail when fewer lights follow more", () => {
    const out = new Float32Array(MAX_LIGHT_UNIFORMS * 4);
    packLights([{ x: 0.1, y: 0.2, intensity: 1, warmth: 1 }, { x: 0.3, y: 0.4, intensity: 1, warmth: 1 }], out);
    expect(packLights([{ x: 0.5, y: 0.5, intensity: 0.5, warmth: 0.5 }], out)).toBe(1);
    expect(Array.from(out.slice(4, 8))).toEqual([0, 0, 0, 0]);
  });

  it("packs vec3 rows of x, y, startedAt and caps at eight", () => {
    const out = new Float32Array(MAX_RIPPLES * 3);
    const ripples = Array.from({ length: 10 }, (_, i) => ({ x: 0.5, y: 0.8, startedAt: i }));
    expect(packRipples(ripples, out)).toBe(8);
    expect(out[2]).toBe(0);
    expect(out[3 * 7 + 2]).toBe(7);
  });
});

describe("presetFor", () => {
  it("knows the river gate (opaque) and the fire (transparent), and nothing else yet", () => {
    expect(presetFor("river-gate")?.opaque).toBe(true);
    expect(presetFor("fire")?.opaque).toBe(false);
    expect(presetFor("none")).toBeNull();
    expect(presetFor("frost")).toBeNull();
    expect(presetFor("wax")).toBeNull();
  });
});

interface FakeGL {
  readonly gl: LanternGL;
  readonly calls: string[];
  readonly uniforms: Map<string, unknown>;
}

function fakeGL(options: { readonly compiles?: boolean; readonly links?: boolean } = {}): FakeGL {
  const calls: string[] = [];
  const uniforms = new Map<string, unknown>();
  const named = (location: WebGLUniformLocation | null): string =>
    location === null ? "null" : String((location as { name?: string }).name);
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
    createShader: () => { calls.push("createShader"); return {}; },
    shaderSource: () => { calls.push("shaderSource"); },
    compileShader: () => { calls.push("compileShader"); },
    getShaderParameter: () => options.compiles ?? true,
    deleteShader: (shader) => { calls.push(shader === null ? "deleteShader(null)" : "deleteShader"); },
    createProgram: () => { calls.push("createProgram"); return {}; },
    attachShader: () => { calls.push("attachShader"); },
    linkProgram: () => { calls.push("linkProgram"); },
    getProgramParameter: () => options.links ?? true,
    deleteProgram: () => { calls.push("deleteProgram"); },
    useProgram: () => { calls.push("useProgram"); },
    createBuffer: () => { calls.push("createBuffer"); return {}; },
    bindBuffer: () => { calls.push("bindBuffer"); },
    bufferData: () => { calls.push("bufferData"); },
    deleteBuffer: () => { calls.push("deleteBuffer"); },
    getAttribLocation: () => 0,
    enableVertexAttribArray: () => { calls.push("enableVertexAttribArray"); },
    vertexAttribPointer: () => { calls.push("vertexAttribPointer"); },
    getUniformLocation: (_program, name) => ({ name }),
    uniform1f: (location, x) => { uniforms.set(named(location), x); },
    uniform1i: (location, x) => { uniforms.set(named(location), x); },
    uniform2f: (location, x, y) => { uniforms.set(named(location), [x, y]); },
    uniform3fv: (location, data) => { uniforms.set(named(location), Array.from(data)); },
    uniform4fv: (location, data) => { uniforms.set(named(location), Array.from(data)); },
    enable: () => { calls.push("enable"); },
    blendFunc: () => { calls.push("blendFunc"); },
    viewport: (_x, _y, w, h) => { calls.push(`viewport(${String(w)},${String(h)})`); },
    clearColor: () => { calls.push("clearColor"); },
    clear: () => { calls.push("clear"); },
    drawArrays: (_mode, _first, count) => { calls.push(`drawArrays(${String(count)})`); },
    isContextLost: () => false,
  };
  return { gl, calls, uniforms };
}

function frameOf(overrides: Partial<LanternFrame> = {}): LanternFrame {
  return {
    width: 640,
    height: 360,
    time: 1.5,
    dusk: 0.25,
    lanternIntensity: 0.9,
    pointer: new Float32Array([0.5, 0.5, 0, 1]),
    lights: new Float32Array(MAX_LIGHT_UNIFORMS * 4),
    lightCount: 1,
    ripples: new Float32Array(MAX_RIPPLES * 3),
    rippleCount: 0,
    reducedMotion: false,
    particles: 400,
    ...overrides,
  };
}

describe("createLanternProgram — the plumbing, without a GPU", () => {
  it("compiles, links, binds one triangle, resolves every uniform and draws three vertices", () => {
    const { gl, calls, uniforms } = fakeGL();
    const preset = presetFor("river-gate");
    expect(preset).not.toBeNull();
    const program = createLanternProgram(gl, preset!);
    expect(program).not.toBeNull();
    expect(calls.filter((c) => c === "compileShader")).toHaveLength(2);
    expect(calls).toContain("linkProgram");
    expect(calls).toContain("bufferData");
    // An opaque preset never enables blending: the compositor gets a solid canvas.
    expect(calls).not.toContain("enable");

    program!.draw(frameOf({ reducedMotion: true, rippleCount: 2 }));
    expect(calls).toContain("viewport(640,360)");
    expect(calls).toContain("drawArrays(3)");
    expect(uniforms.get("u_res")).toEqual([640, 360]);
    expect(uniforms.get("u_time")).toBe(1.5);
    expect(uniforms.get("u_dusk")).toBe(0.25);
    expect(uniforms.get("u_lanternIntensity")).toBe(0.9);
    expect(uniforms.get("u_lightCount")).toBe(1);
    expect(uniforms.get("u_rippleCount")).toBe(2);
    expect(uniforms.get("u_reducedMotion")).toBe(1);
    expect(uniforms.get("u_particles")).toBe(400);

    program!.dispose();
    expect(calls).toContain("deleteBuffer");
    expect(calls).toContain("deleteProgram");
  });

  it("enables premultiplied blending for the transparent fire preset and clears each frame", () => {
    const { gl, calls } = fakeGL();
    const program = createLanternProgram(gl, presetFor("fire")!);
    expect(program).not.toBeNull();
    expect(calls).toContain("enable");
    expect(calls).toContain("blendFunc");
    program!.draw(frameOf());
    expect(calls).toContain("clear");
  });

  it("returns null and releases the shaders when compilation fails", () => {
    const { gl, calls } = fakeGL({ compiles: false });
    expect(createLanternProgram(gl, presetFor("river-gate")!)).toBeNull();
    expect(calls).not.toContain("linkProgram");
    expect(calls.filter((c) => c.startsWith("deleteShader"))).not.toHaveLength(0);
  });

  it("returns null and deletes the program when linking fails", () => {
    const { gl, calls } = fakeGL({ links: false });
    expect(createLanternProgram(gl, presetFor("river-gate")!)).toBeNull();
    expect(calls).toContain("deleteProgram");
    expect(calls).not.toContain("useProgram");
  });
});
