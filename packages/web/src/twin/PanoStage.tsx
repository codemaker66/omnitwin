import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  BackSide,
  Color,
  PerspectiveCamera,
  ShaderMaterial,
  type CubeTexture,
  type IUniform,
  type Texture,
} from "three";
import type { TwinImagery } from "@omnitwin/types";
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
/** Nadir crown colour — the Rite's deep green-black. */
export const PANO_CROWN_COLOR = "#07100f";
/** Fraction of straight-down (world −Z / scanner −Z) where the crown fade begins. */
export const PANO_CROWN_START = 0.82;

const panoVertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const cubeFragmentShader = /* glsl */ `
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
  float crown = smoothstep(uCrownStart, 0.98, max(-s.z, 0.0));
  gl_FragColor = vec4(mix(c.rgb, uCrownColor, crown), uOpacity);
}
`;

const equirectFragmentShader = /* glsl */ `
uniform sampler2D uMap;
uniform float uOpacity;
uniform vec3 uCrownColor;
uniform float uCrownStart;
uniform float uUSign;
uniform float uUOffset;
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
  float crown = smoothstep(uCrownStart, 0.98, max(-e.z, 0.0));
  gl_FragColor = vec4(mix(c.rgb, uCrownColor, crown), uOpacity);
}
`;

/** Typed uniform bag (house pattern from cockpit-overlay-materials). */
interface CubePanoUniforms {
  [uniform: string]: IUniform;
  uCube: IUniform<CubeTexture | null>;
  uOpacity: IUniform<number>;
  uCrownColor: IUniform<Color>;
  uCrownStart: IUniform<number>;
}

interface EquirectPanoUniforms {
  [uniform: string]: IUniform;
  uMap: IUniform<Texture | null>;
  uOpacity: IUniform<number>;
  uCrownColor: IUniform<Color>;
  uCrownStart: IUniform<number>;
  uUSign: IUniform<number>;
  uUOffset: IUniform<number>;
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
  /** Imagery mode from the manifest — selects the pano pipeline. */
  readonly imagery: TwinImagery;
}

function CubePanoStage({
  nodeId,
  position,
  quaternion,
  assetBase,
  opacity,
}: PanoStageProps): ReactElement | null {
  const invalidate = useThree((state) => state.invalidate);
  const { texture } = useCubeTiles(nodeId, assetBase);

  const material = useMemo(() => {
    const uniforms: CubePanoUniforms = {
      uCube: { value: null },
      uOpacity: { value: 1 },
      uCrownColor: { value: new Color(PANO_CROWN_COLOR) },
      uCrownStart: { value: PANO_CROWN_START },
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
  }, [texture, material, invalidate]);

  useEffect(() => {
    (material.uniforms as CubePanoUniforms).uOpacity.value = opacity;
    invalidate();
  }, [opacity, material, invalidate]);

  if (texture === null) {
    return null;
  }

  return (
    <mesh
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
}: PanoStageProps): ReactElement | null {
  const invalidate = useThree((state) => state.invalidate);
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);

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

  const maxLod = resolveEquirectMaxLod(gl.capabilities.maxTextureSize, zoomIntent);
  const { texture } = useEquirectTexture(nodeId, assetBase, maxLod);

  const material = useMemo(() => {
    const uniforms: EquirectPanoUniforms = {
      uMap: { value: null },
      uOpacity: { value: 1 },
      uCrownColor: { value: new Color(PANO_CROWN_COLOR) },
      uCrownStart: { value: PANO_CROWN_START },
      uUSign: { value: EQUIRECT_U_FLIP ? -1 : 1 },
      uUOffset: { value: EQUIRECT_U_OFFSET },
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
    (material.uniforms as EquirectPanoUniforms).uMap.value = texture;
    invalidate();
  }, [texture, material, invalidate]);

  useEffect(() => {
    (material.uniforms as EquirectPanoUniforms).uOpacity.value = opacity;
    invalidate();
  }, [opacity, material, invalidate]);

  if (texture === null) {
    return null;
  }

  // CRITICAL: no quaternion here. The pano is world-aligned by construction;
  // applying the pose rotation would double-rotate every equirect node.
  return (
    <mesh position={[position[0], position[1], position[2]]}>
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
