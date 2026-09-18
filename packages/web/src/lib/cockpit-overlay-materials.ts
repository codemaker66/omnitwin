import {
  Color,
  DataTexture,
  LinearFilter,
  NormalBlending,
  RGBAFormat,

  type IUniform,
} from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { abs, attribute, float, fract, mix, pow, smoothstep, uniform, uv, varying, vec4 } from "three/tsl";

// ---------------------------------------------------------------------------
// Cockpit overlay materials — shared GPU primitives for the flow overlays.
//
// Two pieces, both built once and shared across every overlay instance so the
// scene stays a handful of draw calls:
//
//  • a flow-ribbon node material: a soft additive cyan band with travelling
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
export type FlowRibbonMaterial = MeshBasicNodeMaterial & { readonly uniforms: FlowRibbonUniforms };

export function createFlowRibbonMaterial(): FlowRibbonMaterial {
  const uniforms: FlowRibbonUniforms = {
    uTime: { value: 0 },
    uColor: { value: new Color("#2fa6c4") },
    uPulseColor: { value: new Color("#eafdff") },
    uOpacity: { value: 0.95 },
    uSpeed: { value: 2.4 }, // scene units / second a pulse travels
    uWavelength: { value: 6.0 }, // scene units between pulses
  };
  const time = uniform(0).onRenderUpdate(() => uniforms.uTime.value);
  const color = uniform(uniforms.uColor.value).onRenderUpdate(() => uniforms.uColor.value);
  const pulseColor = uniform(uniforms.uPulseColor.value).onRenderUpdate(() => uniforms.uPulseColor.value);
  const opacity = uniform(0.95).onRenderUpdate(() => uniforms.uOpacity.value);
  const speed = uniform(2.4).onRenderUpdate(() => uniforms.uSpeed.value);
  const wavelength = uniform(6).onRenderUpdate(() => uniforms.uWavelength.value);
  const across = float(1).sub(smoothstep(0.3, 1, abs(uv().y.sub(0.5)).mul(2)));
  const ends = smoothstep(0, 0.06, uv().x).mul(float(1).sub(smoothstep(0.94, 1, uv().x)));
  const phase = fract(varying(attribute("aDist", "float")).sub(time.mul(speed)).div(wavelength));
  const energy = pow(float(1).sub(phase), 4).mul(across);
  const alpha = across.mul(0.64).add(energy.mul(1.1)).mul(ends).mul(opacity);
  const material = new MeshBasicNodeMaterial({ fog: false,
    transparent: true,
    blending: NormalBlending,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  });
  material.fragmentNode = vec4(mix(color, pulseColor, energy), alpha);
  return Object.assign(material, { uniforms });
}

let sharedFlowRibbonMaterial: FlowRibbonMaterial | null = null;

/** The process-wide flow-ribbon material, built on first use. */
export function getFlowRibbonMaterial(): FlowRibbonMaterial {
  sharedFlowRibbonMaterial ??= createFlowRibbonMaterial();
  return sharedFlowRibbonMaterial;
}

/** Advance the flow pulse by `delta` seconds. Keeps Three's loosely-typed
 *  uniform bag behind a typed boundary so callers stay free of `any`. */
export function advanceFlowRibbonTime(material: FlowRibbonMaterial, delta: number): void {
  const uniforms = material.uniforms;
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
