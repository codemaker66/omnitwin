// -----------------------------------------------------------------------------
// lantern-program — GL setup for the Lantern: context acquisition (WebGL2,
// then WebGL1, then nothing so the CSS fallback shows), compile and link, one
// fullscreen triangle, uniform upload. The presets are written in GLSL ES
// 1.00 so one source runs on both context versions.
//
// The pure parts (the stage viewport, uniform packing, the preset table) sit
// apart from the GL calls so they are tested under happy-dom, which has no
// WebGL. The GL surface the Lantern touches is written out as `LanternGL` so
// a WebGL2RenderingContext, a WebGLRenderingContext and a test double all fit.
// -----------------------------------------------------------------------------
import type { StageLight } from "../stage/stage-manifest.js";
import { MAX_RIPPLES, type LanternProgramId, type LanternRipple } from "./lantern-types.js";
import { FIRE_FRAGMENT } from "./presets/fire.glsl.js";
import { RIVER_GATE_FRAGMENT } from "./presets/river-gate.glsl.js";

/** The stage's reference frame is 16:9; a 9:16 phone shows its middle third. */
export const STAGE_ASPECT = 16 / 9;

/** At most 16 lights, as vec4 (x, y, intensity, warmth). */
export const MAX_LIGHT_UNIFORMS = 16;

export interface LanternPreset {
  readonly id: LanternProgramId;
  readonly fragment: string;
  /**
   * True when the program paints every pixel (sky and river): the context is
   * created without an alpha channel so the compositor never blends a
   * full-screen canvas over the page. The flame alone needs alpha.
   */
  readonly opaque: boolean;
}

const PRESETS: Readonly<Partial<Record<LanternProgramId, LanternPreset>>> = {
  "river-gate": { id: "river-gate", fragment: RIVER_GATE_FRAGMENT, opaque: true },
  fire: { id: "fire", fragment: FIRE_FRAGMENT, opaque: false },
};

/** Null for "none" and for the beats not built yet (frost, ink flood, weather, wax). */
export function presetFor(id: LanternProgramId): LanternPreset | null {
  return PRESETS[id] ?? null;
}

export const LANTERN_VERTEX = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

/**
 * The visible range of stage x for a canvas of this aspect. Stage y always
 * spans the full height (the horizon stays at 58%); stage x is centred and
 * measured in 16:9 frame widths, so a phone crops the sides and an ultrawide
 * sees beyond both edges. Planes drawn by other modules align to this.
 */
export function stageViewport(width: number, height: number): { readonly xMin: number; readonly xMax: number } {
  const aspect = height > 0 ? width / height : STAGE_ASPECT;
  const half = aspect / STAGE_ASPECT / 2;
  return { xMin: 0.5 - half, xMax: 0.5 + half };
}

/** Packs lights into a vec4 array (x, y, intensity, warmth); returns the count uploaded. */
export function packLights(lights: readonly StageLight[], out: Float32Array): number {
  const count = Math.min(lights.length, MAX_LIGHT_UNIFORMS);
  out.fill(0);
  for (let i = 0; i < count; i += 1) {
    const light = lights[i];
    if (light === undefined) {
      break;
    }
    out[i * 4] = light.x;
    out[i * 4 + 1] = light.y;
    out[i * 4 + 2] = Math.min(Math.max(light.intensity, 0), 1);
    out[i * 4 + 3] = Math.min(Math.max(light.warmth, 0), 1);
  }
  return count;
}

/** Packs ripples into a vec3 array (x, y, startedAt); returns the count uploaded. */
export function packRipples(ripples: readonly LanternRipple[], out: Float32Array): number {
  const count = Math.min(ripples.length, MAX_RIPPLES);
  out.fill(0);
  for (let i = 0; i < count; i += 1) {
    const ripple = ripples[i];
    if (ripple === undefined) {
      break;
    }
    out[i * 3] = ripple.x;
    out[i * 3 + 1] = ripple.y;
    out[i * 3 + 2] = ripple.startedAt;
  }
  return count;
}

/** Everything one frame uploads. Arrays are owned by the caller and reused. */
export interface LanternFrame {
  readonly width: number;
  readonly height: number;
  readonly time: number;
  readonly dusk: number;
  readonly lanternIntensity: number;
  /** x, y, speed, presence (0 when the pointer has left the stage). */
  readonly pointer: Float32Array;
  readonly lights: Float32Array;
  readonly lightCount: number;
  readonly ripples: Float32Array;
  readonly rippleCount: number;
  readonly reducedMotion: boolean;
  readonly particles: number;
}

/** The slice of the WebGL API the Lantern uses; both context versions satisfy it. */
export interface LanternGL {
  readonly VERTEX_SHADER: number;
  readonly FRAGMENT_SHADER: number;
  readonly COMPILE_STATUS: number;
  readonly LINK_STATUS: number;
  readonly ARRAY_BUFFER: number;
  readonly STATIC_DRAW: number;
  readonly FLOAT: number;
  readonly TRIANGLES: number;
  readonly COLOR_BUFFER_BIT: number;
  readonly BLEND: number;
  readonly ONE: number;
  readonly ONE_MINUS_SRC_ALPHA: number;
  createShader(type: number): WebGLShader | null;
  shaderSource(shader: WebGLShader, source: string): void;
  compileShader(shader: WebGLShader): void;
  getShaderParameter(shader: WebGLShader, pname: number): unknown;
  deleteShader(shader: WebGLShader | null): void;
  createProgram(): WebGLProgram | null;
  attachShader(program: WebGLProgram, shader: WebGLShader): void;
  linkProgram(program: WebGLProgram): void;
  getProgramParameter(program: WebGLProgram, pname: number): unknown;
  deleteProgram(program: WebGLProgram | null): void;
  useProgram(program: WebGLProgram | null): void;
  createBuffer(): WebGLBuffer | null;
  bindBuffer(target: number, buffer: WebGLBuffer | null): void;
  bufferData(target: number, data: BufferSource, usage: number): void;
  deleteBuffer(buffer: WebGLBuffer | null): void;
  getAttribLocation(program: WebGLProgram, name: string): number;
  enableVertexAttribArray(index: number): void;
  vertexAttribPointer(index: number, size: number, type: number, normalized: boolean, stride: number, offset: number): void;
  getUniformLocation(program: WebGLProgram, name: string): WebGLUniformLocation | null;
  uniform1f(location: WebGLUniformLocation | null, x: number): void;
  uniform1i(location: WebGLUniformLocation | null, x: number): void;
  uniform2f(location: WebGLUniformLocation | null, x: number, y: number): void;
  uniform3fv(location: WebGLUniformLocation | null, data: Float32Array): void;
  uniform4fv(location: WebGLUniformLocation | null, data: Float32Array): void;
  enable(cap: number): void;
  blendFunc(sfactor: number, dfactor: number): void;
  viewport(x: number, y: number, width: number, height: number): void;
  clearColor(r: number, g: number, b: number, a: number): void;
  clear(mask: number): void;
  drawArrays(mode: number, first: number, count: number): void;
  isContextLost(): boolean;
}

export type LanternGLVersion = 2 | 1;

export interface LanternContext {
  readonly gl: LanternGL;
  readonly version: LanternGLVersion;
}

/** WebGL2 first, WebGL1 second, null third: the CSS fallback stays visible. */
export function acquireLanternContext(canvas: HTMLCanvasElement, opaque: boolean): LanternContext | null {
  const attributes: WebGLContextAttributes = {
    alpha: !opaque,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    powerPreference: "low-power",
  };
  try {
    const gl2 = canvas.getContext("webgl2", attributes);
    if (gl2 !== null) {
      return { gl: gl2, version: 2 };
    }
  } catch {
    // Some embedders throw for an unknown context id instead of returning null.
  }
  try {
    const gl1 = canvas.getContext("webgl", attributes);
    if (gl1 !== null) {
      return { gl: gl1, version: 1 };
    }
  } catch {
    // As above: a throw is a refusal.
  }
  return null;
}

function compileShader(gl: LanternGL, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (shader === null) {
    return null;
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export interface LanternUniformLocations {
  readonly res: WebGLUniformLocation | null;
  readonly time: WebGLUniformLocation | null;
  readonly dusk: WebGLUniformLocation | null;
  readonly lanternIntensity: WebGLUniformLocation | null;
  readonly pointer: WebGLUniformLocation | null;
  readonly lights: WebGLUniformLocation | null;
  readonly lightCount: WebGLUniformLocation | null;
  readonly ripples: WebGLUniformLocation | null;
  readonly rippleCount: WebGLUniformLocation | null;
  readonly reducedMotion: WebGLUniformLocation | null;
  readonly particles: WebGLUniformLocation | null;
}

export interface LanternProgram {
  readonly locations: LanternUniformLocations;
  /** Uploads one frame's uniforms and draws the triangle. */
  draw(frame: LanternFrame): void;
  dispose(): void;
}

/**
 * Compiles the preset, links it, binds the fullscreen triangle and resolves
 * every uniform the Lantern knows. A preset that does not declare a uniform
 * gets a null location, and WebGL ignores uploads to null, so one upload
 * routine serves every preset. Returns null when the driver refuses.
 */
export function createLanternProgram(gl: LanternGL, preset: LanternPreset): LanternProgram | null {
  const vs = compileShader(gl, gl.VERTEX_SHADER, LANTERN_VERTEX);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, preset.fragment);
  if (vs === null || fs === null) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return null;
  }
  const program = gl.createProgram();
  if (program === null) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return null;
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  // The linked binary owns the shaders from here; deleting them now is the
  // usual discipline and leaves nothing to forget at dispose.
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    gl.deleteProgram(program);
    return null;
  }
  gl.useProgram(program);

  const triangle = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, triangle);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, "a_pos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  if (!preset.opaque) {
    // Presets write premultiplied colour, so the flame adds light over the
    // page instead of greying it.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  const locations: LanternUniformLocations = {
    res: gl.getUniformLocation(program, "u_res"),
    time: gl.getUniformLocation(program, "u_time"),
    dusk: gl.getUniformLocation(program, "u_dusk"),
    lanternIntensity: gl.getUniformLocation(program, "u_lanternIntensity"),
    pointer: gl.getUniformLocation(program, "u_pointer"),
    lights: gl.getUniformLocation(program, "u_lights"),
    lightCount: gl.getUniformLocation(program, "u_lightCount"),
    ripples: gl.getUniformLocation(program, "u_ripples"),
    rippleCount: gl.getUniformLocation(program, "u_rippleCount"),
    reducedMotion: gl.getUniformLocation(program, "u_reducedMotion"),
    particles: gl.getUniformLocation(program, "u_particles"),
  };

  return {
    locations,
    draw(frame: LanternFrame): void {
      gl.viewport(0, 0, frame.width, frame.height);
      if (!preset.opaque) {
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.uniform2f(locations.res, frame.width, frame.height);
      gl.uniform1f(locations.time, frame.time);
      gl.uniform1f(locations.dusk, frame.dusk);
      gl.uniform1f(locations.lanternIntensity, frame.lanternIntensity);
      gl.uniform4fv(locations.pointer, frame.pointer);
      gl.uniform4fv(locations.lights, frame.lights);
      gl.uniform1i(locations.lightCount, frame.lightCount);
      gl.uniform3fv(locations.ripples, frame.ripples);
      gl.uniform1i(locations.rippleCount, frame.rippleCount);
      gl.uniform1f(locations.reducedMotion, frame.reducedMotion ? 1 : 0);
      gl.uniform1i(locations.particles, frame.particles);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose(): void {
      gl.deleteBuffer(triangle);
      gl.deleteProgram(program);
    },
  };
}
