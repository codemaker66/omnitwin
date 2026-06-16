import {
  Color,
  DataTexture,
  LinearFilter,
  NormalBlending,
  RGBAFormat,
  ShaderMaterial,
  type IUniform,
} from "three";

// ---------------------------------------------------------------------------
// Cockpit overlay materials — shared GPU primitives for the flow overlays.
//
// Two pieces, both built once and shared across every overlay instance so the
// scene stays a handful of draw calls:
//
//  • a flow-ribbon ShaderMaterial: a soft additive cyan band with travelling
//    "comet" pulses that flow along each path's arc length. All the motion
//    lives in a single `uTime` uniform — the geometry never changes per frame,
//    so animating the whole flow field costs one uniform write + one redraw,
//    which is what keeps it gliding at 60 fps+.
//
//  • a radial glow DataTexture: a white disc with a soft alpha falloff, tinted
//    per use. Used as the density-heatmap blob (so the heatmap reads as warm
//    light pooling on the floor instead of hard squares) and as the agent-mote
//    sprite (a firefly rather than a faceted sphere).
//
// Procedural + dependency-free so it constructs identically in tests (no canvas
// 2D context, no WebGL) and at runtime. SAFE: these are rendering primitives —
// they carry no data and make no claim of measurement.
// ---------------------------------------------------------------------------

const flowRibbonVertexShader = /* glsl */ `
  attribute float aDist;
  varying vec2 vUv;
  varying float vDist;

  void main() {
    vUv = uv;
    vDist = aDist;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const flowRibbonFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform vec3 uPulseColor;
  uniform float uOpacity;
  uniform float uSpeed;
  uniform float uWavelength;

  varying vec2 vUv;
  varying float vDist;

  void main() {
    // Soft falloff across the band: bright core, transparent edges.
    float across = 1.0 - smoothstep(0.30, 1.0, abs(vUv.y - 0.5) * 2.0);
    // Fade the very head and tail so ribbons don't start/stop with a hard cut.
    float ends = smoothstep(0.0, 0.06, vUv.x) * (1.0 - smoothstep(0.94, 1.0, vUv.x));

    // Steady base presence — strong enough to read as a confident cyan band
    // over the venue's bright, light floor at any zoom.
    float base = 0.64 * across;

    // Travelling comet pulses: a sawtooth phase along arc length, scrolling with
    // time, shaped into a sharp head with a long luminous tail.
    float phase = fract((vDist - uTime * uSpeed) / uWavelength);
    float comet = pow(1.0 - phase, 4.0);
    float energy = comet * across;

    float alpha = (base + energy * 1.1) * ends * uOpacity;
    vec3 color = mix(uColor, uPulseColor, energy);
    gl_FragColor = vec4(color, alpha);
  }
`;

export interface FlowRibbonUniforms {
  [uniform: string]: IUniform;
  uTime: IUniform<number>;
  uColor: IUniform<Color>;
  uPulseColor: IUniform<Color>;
  uOpacity: IUniform<number>;
  uSpeed: IUniform<number>;
  uWavelength: IUniform<number>;
}

/** Build the flow-ribbon material. Normal (alpha) blending + depth-test off so
 *  the cyan reads as cyan over the venue's *light* floor — additive would
 *  saturate to white on a pale background and vanish — and always draws through
 *  as a planning overlay. One shared instance animates the whole flow field. */
export function createFlowRibbonMaterial(): ShaderMaterial {
  const uniforms: FlowRibbonUniforms = {
    uTime: { value: 0 },
    uColor: { value: new Color("#2fa6c4") },
    uPulseColor: { value: new Color("#eafdff") },
    uOpacity: { value: 0.95 },
    uSpeed: { value: 2.4 }, // scene units / second a pulse travels
    uWavelength: { value: 6.0 }, // scene units between pulses
  };
  return new ShaderMaterial({
    vertexShader: flowRibbonVertexShader,
    fragmentShader: flowRibbonFragmentShader,
    uniforms,
    transparent: true,
    blending: NormalBlending,
    depthWrite: false,
    depthTest: false,
  });
}

let sharedFlowRibbonMaterial: ShaderMaterial | null = null;

/** The process-wide flow-ribbon material, built on first use. */
export function getFlowRibbonMaterial(): ShaderMaterial {
  sharedFlowRibbonMaterial ??= createFlowRibbonMaterial();
  return sharedFlowRibbonMaterial;
}

/** Advance the flow pulse by `delta` seconds. Keeps Three's loosely-typed
 *  uniform bag behind a typed boundary so callers stay free of `any`. */
export function advanceFlowRibbonTime(material: ShaderMaterial, delta: number): void {
  const uniforms = material.uniforms as FlowRibbonUniforms;
  uniforms.uTime.value += delta;
}

/** Side length (px) of the square radial-glow texture. */
export const RADIAL_GLOW_TEXTURE_SIZE = 64;

/** RGBA bytes for a white disc whose alpha falls off radially to zero at the
 *  edge (soft glow). Exported for unit testing the falloff. */
export function buildRadialGlowData(size: number): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  const centre = (size - 1) / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x - centre) / centre;
      const dy = (y - centre) / centre;
      const r = Math.min(1, Math.hypot(dx, dy));
      const alpha = Math.pow(1 - r, 2.2); // soft, slightly tail-heavy falloff
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(alpha * 255);
    }
  }
  return data;
}

let sharedRadialGlowTexture: DataTexture | null = null;

/** The process-wide radial-glow texture, built on first use. */
export function getRadialGlowTexture(): DataTexture {
  if (sharedRadialGlowTexture === null) {
    const texture = new DataTexture(
      buildRadialGlowData(RADIAL_GLOW_TEXTURE_SIZE),
      RADIAL_GLOW_TEXTURE_SIZE,
      RADIAL_GLOW_TEXTURE_SIZE,
      RGBAFormat,
    );
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    texture.needsUpdate = true;
    sharedRadialGlowTexture = texture;
  }
  return sharedRadialGlowTexture;
}
