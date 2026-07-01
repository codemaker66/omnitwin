import { useEffect, useRef, type MutableRefObject, type ReactElement } from "react";
import {
  RITE_SPRINGS,
  flameDisturbance,
  stepSpring,
  type SpringState,
} from "./rite-motion.js";
import type { PointerMotion } from "./useCursorLight.js";

// -----------------------------------------------------------------------------
// FlameCanvas — a single candle flame, procedurally shaded.
//
// Raw WebGL1 on one small canvas (~46vmin square) — not Three.js; the whole
// program is one fragment shader (~2 KB). The flame breathes ±2 %, sways with
// value noise, and is *alive to the visitor*: cursor speed feeds a
// disturbance value each frame, so sweeping past guts the flame and the
// underdamped flameIntensity spring rights it with a wobble.
//
// Failure ladder: no WebGL context → render nothing; the CSS fallback flame
// (.rite-flame-fallback in rite.css) stays visible underneath. The rAF loop
// parks whenever `active` is false or the tab is hidden.
// -----------------------------------------------------------------------------

const VERTEX_SRC = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAGMENT_SRC = `
precision mediump float;
uniform float u_time;
uniform float u_intensity;
uniform vec2 u_res;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

void main() {
  vec2 uv = (gl_FragCoord.xy / u_res) * 2.0 - 1.0;
  uv.y += 0.30;

  float unrest = 1.0 - u_intensity;

  // Lateral sway: quiet drift when steady, guttering when disturbed.
  float sway = (noise(vec2(u_time * 1.4, uv.y * 3.0)) - 0.5)
    * 0.35 * (uv.y * 0.5 + 0.55) * (1.0 + unrest * 2.4);
  float x = uv.x + sway * smoothstep(-0.4, 0.9, uv.y);

  // Teardrop body, tapering to the tip; height collapses when guttered.
  float widthBase = mix(0.085, 0.21, smoothstep(-0.45, 0.05, uv.y));
  float width = widthBase * (0.72 + 0.28 * u_intensity);
  float tipY = 0.20 + 0.64 * u_intensity;
  width *= 1.0 - smoothstep(0.02, tipY, uv.y);
  float body = 1.0 - smoothstep(0.0, max(width, 0.001), abs(x));
  body *= smoothstep(-0.54, -0.42, uv.y);
  float flame = body * (1.0 - smoothstep(tipY * 0.5, tipY, uv.y));
  flame = pow(clamp(flame * 1.35, 0.0, 1.0), 0.85); // brighter, fuller core

  // The breath: +/-2% at a calm 0.9 Hz-ish period.
  flame *= 0.98 + 0.02 * sin(u_time * 0.9);

  // Colour: cool blue root -> candle gold -> warm white core.
  vec3 col = mix(vec3(0.10, 0.22, 0.50), vec3(0.96, 0.60, 0.16),
    smoothstep(-0.44, -0.16, uv.y));
  col = mix(col, vec3(1.0, 0.90, 0.70), smoothstep(0.15, 0.75, flame));

  // Halo: the light the flame throws on the dark.
  float d = length(vec2(x, (uv.y + 0.12) * 1.35));
  float halo = exp(-d * 3.2) * 0.5 * u_intensity;

  vec3 rgb = col * flame + vec3(1.0, 0.74, 0.38) * halo;
  float alpha = clamp(max(flame, halo * 1.6), 0.0, 1.0);
  gl_FragColor = vec4(rgb, alpha);
}
`;

function acquireWebGL(canvas: HTMLCanvasElement): WebGLRenderingContext | null {
  try {
    return canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
    });
  } catch {
    return null; // some environments throw instead of returning null
  }
}

function compile(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
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

export interface FlameCanvasProps {
  /** Pointer speed feed from useCursorLight — read per frame, never rendered. */
  readonly pointerMotion: MutableRefObject<PointerMotion>;
  /** The loop runs only while the flame can be seen (threshold + darkness). */
  readonly active: boolean;
}

export function FlameCanvas({ pointerMotion, active }: FlameCanvasProps): ReactElement | null {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const failedRef = useRef<boolean>(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!active || canvas === null || failedRef.current) {
      return;
    }

    const gl = acquireWebGL(canvas);
    if (gl === null) {
      failedRef.current = true; // CSS fallback flame remains visible
      canvas.style.display = "none";
      return;
    }

    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SRC);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC);
    if (vs === null || fs === null) {
      failedRef.current = true;
      canvas.style.display = "none";
      return;
    }
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
      failedRef.current = true;
      canvas.style.display = "none";
      return;
    }
    gl.useProgram(program);

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    const aPos = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(program, "u_time");
    const uIntensity = gl.getUniformLocation(program, "u_intensity");
    const uRes = gl.getUniformLocation(program, "u_res");

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const dpr = Math.min(window.devicePixelRatio, 1.5);
    const resize = (): void => {
      const size = canvas.clientWidth; // square via CSS
      const px = Math.max(1, Math.round(size * dpr));
      if (canvas.width !== px || canvas.height !== px) {
        canvas.width = px;
        canvas.height = px;
        gl.viewport(0, 0, px, px);
      }
    };

    const intensity: SpringState = { value: 1, velocity: 0 };
    let rafId: number | null = null;
    let last = 0;
    const start = performance.now();

    const frame = (now: number): void => {
      const dt = last > 0 ? (now - last) / 1000 : 1 / 60;
      last = now;
      resize();

      const disturbance = flameDisturbance(pointerMotion.current.speed);
      const target = 1 - disturbance * 0.85;
      stepSpring(intensity, target, dt, RITE_SPRINGS.flameIntensity);
      const clamped = Math.min(Math.max(intensity.value, 0.05), 1.15);

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(uTime, (now - start) / 1000);
      gl.uniform1f(uIntensity, clamped);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      rafId = window.requestAnimationFrame(frame);
    };

    const onVisibility = (): void => {
      if (document.hidden) {
        if (rafId !== null) {
          window.cancelAnimationFrame(rafId);
          rafId = null;
          last = 0;
        }
      } else {
        rafId ??= window.requestAnimationFrame(frame);
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    rafId = window.requestAnimationFrame(frame);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
      // Release GL objects: the effect re-runs on every act transition
      // (scrolling back and forth), and each run compiles a fresh program —
      // without deletion that would leak GPU resources without bound.
      gl.deleteBuffer(quad);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      // Deliberately no loseContext(): under StrictMode's double-invoke,
      // getContext() would then hand back the same — now dead — context.
      // The browser reclaims it with the canvas when the page truly unmounts.
    };
  }, [active, pointerMotion]);

  return (
    <canvas
      ref={canvasRef}
      className="rite-flame-canvas"
      aria-hidden
      data-testid="rite-flame-canvas"
    />
  );
}
