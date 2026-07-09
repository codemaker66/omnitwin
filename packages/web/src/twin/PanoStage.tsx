import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  BackSide,
  Color,
  PerspectiveCamera,
  ShaderMaterial,
  Vector3,
  type CubeTexture,
  type IUniform,
  type Texture,
} from "three";
import {
  TWIN_EQUIRECT_LODS,
  TWIN_LODS,
  type TwinEquirectLod,
  type TwinImagery,
} from "@omnitwin/types";
import { EQUIRECT_U_FLIP, EQUIRECT_U_OFFSET } from "./twin-basis.js";
import { useCubeTiles } from "./useCubeTiles.js";
import {
  EQUIRECT_ZOOM_FOV_DEG,
  resolveEquirectMaxLod,
  useEquirectTexture,
} from "./useEquirectTexture.js";

// -----------------------------------------------------------------------------
// PanoStage — one scan node rendered as an inverted sphere, dispatched on the
// bundle's imagery mode.
//
// EQUIRECT (the current pipeline): one seamless WORLD-frame equirectangular
// pano per node (extract_equirect.py). The fragment shader maps each three
// sampling direction into the E57 world (the inverse of the twin-basis point
// map — threeDirToE57, pinned by test) and reads the pano at
// u = az/2π, v = ½ + asin(z_e)/π. Because the pano is world-aligned the mesh
// carries NO pose rotation — poses only position nodes. There are no faces,
// no seams and no per-face table; the EQUIRECT_U_FLIP / EQUIRECT_U_OFFSET
// constants in twin-basis are the single calibration surface.
//
// CUBE-FACES (legacy bundles): the six-face path, kept verbatim so older
// forged bundles keep rendering. The shader remaps three directions into the
// scanner frame composed with a y_s negation that cancels the left-handed
// WebGL cube-sampling convention, and the mesh carries the node's pose
// rotation (e57QuatToThree, passed as the quaternion prop).
//
// Both paths blend a nadir "crown" (deep Rite green) over the tripod's blind
// spot straight below, expose an opacity uniform so hops can crossfade two
// stages, and render null until the first LOD is ready — the viewer's
// loading state owns the blank, not a black sphere.
//
// Plan: docs/superpowers/plans/2026-07-02-twin-phase1-walk.md (Task 7);
// equirect rebuild 2026-07-04.
// -----------------------------------------------------------------------------

export const PANO_SPHERE_RADIUS = 50;
/** Nadir fill colour — a warm floor-toned greige that reads as a soft patch of
 *  parquet under the viewer, NOT a dark disc. Only the small equirect pole
 *  pinch straight down is covered; the real floor shows everywhere else. */
export const PANO_CROWN_COLOR = "#a99a86";
/** Downward cos where the nadir fill begins. 0.95 ≈ an 18° soft vignette — just
 *  enough to hide the pole pinch. Was 0.82, a huge ~35° cone (the black disc
 *  Blake saw underfoot); the fill also ramps to full only AT the pole now, so
 *  it feathers into the floor instead of sitting as a hard-edged plate. */
export const PANO_CROWN_START = 0.95;

/**
 * Interior tone grade — applied in DISPLAY (sRGB) space, on top of a colour-
 * correct base. The panos are sampled as linear (sRGB textures the GPU
 * decodes), so the shader must re-encode linear→sRGB before writing to the
 * canvas; a raw ShaderMaterial does not do this automatically, and omitting it
 * rendered every node ~2× too dark with crushed blacks (the true source of the
 * "gloomy" look — the grade below was previously masking it). With the encode
 * restored the base already reads like the source photograph, so this grade is
 * now a gentle aesthetic layer: a light gamma lift (0→0, 1→1, so highlights
 * never blow) plus a whisper of saturation and warmth. Calibrated by eye
 * against the source JPEGs on dark (scan_035) and bright (scan_050) nodes.
 * Every value is a shader uniform — the single tuning surface.
 */
export const PANO_GRADE = {
  /** 1/gamma; gamma 1.12 is a light mid lift now the base is correct. */
  invGamma: 1 / 1.12,
  /** Rec.709 saturation gain — richness without garish. */
  saturation: 1.06,
  /** Per-channel warm tint (R up, B down) — candlelit, not clinical. */
  warm: [1.015, 1.0, 0.99] as const,
} as const;

/** Shared grade + colour-management helpers, prepended to both pano shaders
 *  (and to ParallaxStage's projective shader — one colour pipeline). */
export const gradeGLSL = /* glsl */ `
uniform float uInvGamma;
uniform float uSaturation;
uniform vec3 uWarm;
// Linear working colour → display sRGB (the IEC 61966-2-1 OETF). Raw
// ShaderMaterials get no automatic output encoding, so the pano shaders call
// this explicitly before writing gl_FragColor.
vec3 twinLinearToSRGB(vec3 c) {
  c = max(c, vec3(0.0));
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(hi, lo, step(c, vec3(0.0031308)));
}
// Gentle aesthetic grade in display space.
vec3 twinGrade(vec3 c) {
  c = pow(max(c, 0.0), vec3(uInvGamma));            // light mid lift; 0→0, 1→1
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));   // Rec.709 luma
  c = mix(vec3(l), c, uSaturation);                 // gentle saturation
  c *= uWarm;                                        // subtle warmth
  return clamp(c, 0.0, 1.0);
}
`;

const panoVertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const cubeFragmentShader = /* glsl */ gradeGLSL + `
uniform samplerCube uCube;
uniform float uOpacity;
uniform vec3 uCrownColor;
uniform float uCrownStart;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  // three sampling dir → scanner frame is the proper rotation Mᵀ:
  // x_s=-z₃, y_s=-x₃, z_s=y₃. But WebGL cube maps use the left-handed
  // RenderMan convention (a view from OUTSIDE the cube), so sampling from
  // inside the sphere with the rotation alone renders every pano as its
  // horizontal mirror image. Negating y_s (the scanner left/right axis —
  // the mirror plane contains forward and up, pinned by the 2026-07-04
  // chirality calibration against scan_039's painted frieze and scan_145's
  // entrance signage) folds that mirror back out: s = mirror_y ∘ Mᵀ · d.
  vec3 s = vec3(-d.z, d.x, d.y);
  vec4 c = textureCube(uCube, s);
  // Linear sample → display sRGB → aesthetic grade; crown mixed in display
  // space so it keeps its exact authored colour.
  vec3 g = twinGrade(twinLinearToSRGB(c.rgb));
  float crown = smoothstep(uCrownStart, 1.0, max(-s.z, 0.0));
  gl_FragColor = vec4(mix(g, twinLinearToSRGB(uCrownColor), crown), uOpacity);
}
`;

const equirectFragmentShader = /* glsl */ gradeGLSL + `
uniform sampler2D uMap;
uniform float uOpacity;
uniform vec3 uCrownColor;
uniform float uCrownStart;
uniform float uUSign;
uniform float uUOffset;
// Continuous light: per-node gain*wb, applied in LINEAR space so the physics
// is right (a scanner exposure step is a linear scale). Identity when absent.
uniform vec3 uExposure;
varying vec3 vDir;
const float PI = 3.141592653589793;
void main() {
  vec3 d = normalize(vDir);
  // three → E57 world = the inverse of the twin-basis point map [x, z, -y]:
  // x_e = d.x, y_e = -d.z, z_e = d.y (threeDirToE57 — pinned by test).
  vec3 e = vec3(d.x, -d.z, d.y);
  // Extractor raster: u = az/2π with az = atan2(y_e, x_e); v row 0 = zenith,
  // and the flipY texture upload puts that zenith row at v = 1.
  float az = atan(e.y, e.x);
  float u = uUSign * az / (2.0 * PI) + uUOffset; // RepeatWrapping absorbs winding
  float v = 0.5 + asin(clamp(e.z, -1.0, 1.0)) / PI;
  vec4 c = texture2D(uMap, vec2(u, v));
  // Nadir fill — the floor's own pole pinches to a swirl straight down (and the
  // tripod blind-spot sits there). Blend the sample toward the AVERAGE of the
  // nearest floor ring, so it reads as a soft patch of THIS room's actual floor
  // (auto-matched per node — parquet, mosaic, carpet), not a black disc or a
  // swirl. Feathers to full only AT the pole, so it melts into the real floor.
  float crown = smoothstep(uCrownStart, 1.0, max(-e.z, 0.0));
  if (crown > 0.0) {
    vec3 floorRing = texture2D(uMap, vec2(0.0, 0.03)).rgb
                   + texture2D(uMap, vec2(0.25, 0.03)).rgb
                   + texture2D(uMap, vec2(0.5, 0.03)).rgb
                   + texture2D(uMap, vec2(0.75, 0.03)).rgb;
    c.rgb = mix(c.rgb, floorRing * 0.25, crown);
  }
  // Continuous light, then linear → display sRGB → aesthetic grade. Applied
  // after the ring blend so the nadir fill inherits the same correction.
  c.rgb *= uExposure;
  vec3 g = twinGrade(twinLinearToSRGB(c.rgb));
  gl_FragColor = vec4(g, uOpacity);
}
`;

/** Typed uniform bag (house pattern from cockpit-overlay-materials). */
export interface GradeUniforms {
  uInvGamma: IUniform<number>;
  uSaturation: IUniform<number>;
  uWarm: IUniform<Vector3>;
}

interface CubePanoUniforms extends GradeUniforms {
  [uniform: string]: IUniform;
  uCube: IUniform<CubeTexture | null>;
  uOpacity: IUniform<number>;
  uCrownColor: IUniform<Color>;
  uCrownStart: IUniform<number>;
}

interface EquirectPanoUniforms extends GradeUniforms {
  [uniform: string]: IUniform;
  uMap: IUniform<Texture | null>;
  uOpacity: IUniform<number>;
  uCrownColor: IUniform<Color>;
  uCrownStart: IUniform<number>;
  uUSign: IUniform<number>;
  uUOffset: IUniform<number>;
  uExposure: IUniform<Vector3>;
}

/** The grade uniform trio, fresh per material (Vector3 must not be shared). */
export function makeGradeUniforms(): GradeUniforms {
  return {
    uInvGamma: { value: PANO_GRADE.invGamma },
    uSaturation: { value: PANO_GRADE.saturation },
    uWarm: { value: new Vector3(PANO_GRADE.warm[0], PANO_GRADE.warm[1], PANO_GRADE.warm[2]) },
  };
}

export interface PanoStageProps {
  readonly nodeId: string;
  /** Node position in three space ([x, y, z] metres, from e57PointToThree). */
  readonly position: readonly [number, number, number];
  /** Node pose rotation in three space ([x, y, z, w], from e57QuatToThree).
   *  Applied in cube-faces mode ONLY — world-frame equirects need no pose
   *  rotation (poses only position). */
  readonly quaternion: readonly [number, number, number, number];
  /** Bundle base URL including the venue segment, e.g. `/twin/trades-hall`. */
  readonly assetBase: string;
  /** 0..1 crossfade opacity — the hop spring drives this. */
  readonly opacity: number;
  /** Draw order among concurrent stages — the departing pano (0) renders under
   *  the arriving pano (1) so the fade layers instead of flashing black. */
  readonly renderOrder?: number;
  /** True while a hop is animating. The arriving pano then holds at its instant
   *  512 preview and DEFERS the heavy 4096/8192 base upload (a ~50 ms
   *  main-thread stall) to the settle — smooth motion, sharp on arrival
   *  (finding [32]). The departing pano keeps its base (the stream never
   *  downgrades). */
  readonly hopping?: boolean;
  /** Continuous-light correction for THIS node (manifest `exposure`): a small
   *  gain + white balance applied in linear space, so adjacent nodes read as
   *  one continuous light and the hop crossfade never pops. Absent = identity. */
  readonly exposure?: { readonly gain: number; readonly wb: readonly [number, number, number] };
  /** Imagery mode from the manifest — selects the pano pipeline. */
  readonly imagery: TwinImagery;
  /**
   * HUD bridge (polish pass): reports each landed texture tier — "preview"
   * for the fast first paint, "base" once the full-quality tier (or better)
   * is on stage. Drives the stage fade-in and the initial-load shimmer;
   * never influences streaming itself.
   */
  readonly onTier?: (nodeId: string, tier: "preview" | "base") => void;
}

function CubePanoStage({
  nodeId,
  position,
  quaternion,
  assetBase,
  opacity,
  renderOrder = 0,
  onTier,
}: PanoStageProps): ReactElement | null {
  const invalidate = useThree((state) => state.invalidate);
  const { texture, lod } = useCubeTiles(nodeId, assetBase);
  const onTierRef = useRef(onTier);
  onTierRef.current = onTier;

  const material = useMemo(() => {
    const uniforms: CubePanoUniforms = {
      uCube: { value: null },
      uOpacity: { value: 1 },
      uCrownColor: { value: new Color(PANO_CROWN_COLOR) },
      uCrownStart: { value: PANO_CROWN_START },
      ...makeGradeUniforms(),
    };
    return new ShaderMaterial({
      vertexShader: panoVertexShader,
      fragmentShader: cubeFragmentShader,
      uniforms,
      side: BackSide,
      transparent: true,
      depthWrite: false,
    });
  }, []);

  useEffect(
    () => () => {
      material.dispose();
    },
    [material],
  );

  // Both the texture swap (256 → 1024 sharpen) and the crossfade opacity are
  // plain uniform writes — no material rebuild — followed by an invalidate so
  // the demand-mode canvas actually repaints.
  useEffect(() => {
    (material.uniforms as CubePanoUniforms).uCube.value = texture;
    invalidate();
    if (texture !== null && lod !== 0) {
      onTierRef.current?.(nodeId, lod >= TWIN_LODS[1] ? "base" : "preview");
    }
  }, [texture, lod, nodeId, material, invalidate]);

  useEffect(() => {
    (material.uniforms as CubePanoUniforms).uOpacity.value = opacity;
    invalidate();
  }, [opacity, material, invalidate]);

  if (texture === null) {
    return null;
  }

  return (
    <mesh
      renderOrder={renderOrder}
      position={[position[0], position[1], position[2]]}
      quaternion={[quaternion[0], quaternion[1], quaternion[2], quaternion[3]]}
    >
      <sphereGeometry args={[PANO_SPHERE_RADIUS, 48, 32]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

function EquirectPanoStage({
  nodeId,
  position,
  assetBase,
  opacity,
  renderOrder = 0,
  hopping = false,
  exposure,
  onTier,
}: PanoStageProps): ReactElement | null {
  const invalidate = useThree((state) => state.invalidate);
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const onTierRef = useRef(onTier);
  onTierRef.current = onTier;

  // Zoom intent, YawProbe-style: the per-frame fov read stays in a ref and
  // React sees at most ONE setState per node (TwinViewer keys PanoStage by
  // node id, so a hop remounts this component and re-arms the latch). Once
  // latched the 8192 tier stays for the node — zoom out never blurs down.
  const [zoomIntent, setZoomIntent] = useState(false);
  const zoomLatchRef = useRef(false);
  useFrame(() => {
    if (zoomLatchRef.current || !(camera instanceof PerspectiveCamera)) {
      return;
    }
    if (camera.fov < EQUIRECT_ZOOM_FOV_DEG) {
      zoomLatchRef.current = true;
      setZoomIntent(true);
    }
  });

  // Only a non-mobile device with real memory headroom may pull the ~134 MB
  // 8192 tier (finding [32]); mobile / low-memory GPUs stay on 4096 even under
  // zoom intent. Firefox reports no deviceMemory — a fine pointer alone passes.
  const canAfford8192 = useMemo(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    const mem = (navigator as { deviceMemory?: number }).deviceMemory;
    return (mem === undefined || mem >= 8) && window.matchMedia("(pointer: fine)").matches;
  }, []);
  // While a hop animates, hold the ARRIVING node at its instant 512 preview and
  // defer the ~34-134 MB base upload to the settle — that upload is the stutter
  // you feel walking, and a still frame absorbs it invisibly. The departing
  // node keeps its base: its stream slot already applied 4096, and a lower
  // ceiling never downgrades a live tier.
  const streamCeiling = resolveEquirectMaxLod(
    gl.capabilities.maxTextureSize,
    zoomIntent,
    canAfford8192,
  );
  const maxLod: TwinEquirectLod = hopping ? TWIN_EQUIRECT_LODS[0] : streamCeiling;
  const { texture, lod } = useEquirectTexture(nodeId, assetBase, maxLod);

  const material = useMemo(() => {
    const uniforms: EquirectPanoUniforms = {
      uMap: { value: null },
      uOpacity: { value: 1 },
      uCrownColor: { value: new Color(PANO_CROWN_COLOR) },
      uCrownStart: { value: PANO_CROWN_START },
      uUSign: { value: EQUIRECT_U_FLIP ? -1 : 1 },
      uUOffset: { value: EQUIRECT_U_OFFSET },
      uExposure: { value: new Vector3(1, 1, 1) },
      ...makeGradeUniforms(),
    };
    return new ShaderMaterial({
      vertexShader: panoVertexShader,
      fragmentShader: equirectFragmentShader,
      uniforms,
      side: BackSide,
      transparent: true,
      depthWrite: false,
    });
  }, []);

  useEffect(
    () => () => {
      material.dispose();
    },
    [material],
  );

  useEffect(() => {
    const uniforms = material.uniforms as EquirectPanoUniforms;
    const apply = (): void => {
      uniforms.uMap.value = texture;
      invalidate();
    };
    // The 4096 base (~34 MB) and 8192 zoom (~134 MB) tiers are large RGBA
    // uploads that three does lazily on the first paint after `needsUpdate`.
    // Inline, that upload hitches the look/travel springs on the swap frame —
    // exactly the stutter/jump you feel walking node-to-node (the base lands
    // mid-hop and freezes a frame). Force the upload during browser idle
    // (gl.initTexture) and only THEN swap the uniform, so the swap frame draws
    // an already-resident texture (finding [32]). Only the tiny 512 preview
    // applies immediately — it paints the arriving node at once while the base
    // warms behind it, so a hop is smooth even before it sharpens.
    let cancel: (() => void) | null = null;
    if (texture !== null && lod >= TWIN_EQUIRECT_LODS[1]) {
      const warmThenApply = (): void => {
        gl.initTexture(texture);
        apply();
      };
      if (typeof requestIdleCallback === "function") {
        // No timeout: the base is only ever REQUESTED once the walk has settled
        // (TwinViewer defers it via `hopping`/inMotion), so a genuine idle is
        // already at hand — never force the ~50 ms upload into an animating
        // frame-sliver, which is what re-introduced the stutter.
        const handle = requestIdleCallback(warmThenApply);
        cancel = () => {
          if (typeof cancelIdleCallback === "function") {
            cancelIdleCallback(handle);
          }
        };
      } else {
        const handle = window.setTimeout(warmThenApply, 0);
        cancel = () => {
          window.clearTimeout(handle);
        };
      }
    } else {
      apply();
    }
    if (texture !== null && lod !== 0) {
      onTierRef.current?.(nodeId, lod >= TWIN_EQUIRECT_LODS[1] ? "base" : "preview");
    }
    return () => {
      cancel?.();
    };
  }, [texture, lod, nodeId, material, invalidate, gl]);

  useEffect(() => {
    (material.uniforms as EquirectPanoUniforms).uOpacity.value = opacity;
    invalidate();
  }, [opacity, material, invalidate]);

  // Continuous light: premultiplied gain*wb as one vec3 (identity when the
  // manifest carries no correction — old bundles keep rendering unchanged).
  useEffect(() => {
    const uniforms = material.uniforms as EquirectPanoUniforms;
    if (exposure === undefined) {
      uniforms.uExposure.value.set(1, 1, 1);
    } else {
      uniforms.uExposure.value.set(
        exposure.gain * exposure.wb[0],
        exposure.gain * exposure.wb[1],
        exposure.gain * exposure.wb[2],
      );
    }
    invalidate();
  }, [exposure, material, invalidate]);

  if (texture === null) {
    return null;
  }

  // CRITICAL: no quaternion here. The pano is world-aligned by construction;
  // applying the pose rotation would double-rotate every equirect node.
  return (
    <mesh renderOrder={renderOrder} position={[position[0], position[1], position[2]]}>
      <sphereGeometry args={[PANO_SPHERE_RADIUS, 48, 32]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

export function PanoStage(props: PanoStageProps): ReactElement | null {
  return props.imagery === "equirect" ? (
    <EquirectPanoStage {...props} />
  ) : (
    <CubePanoStage {...props} />
  );
}
