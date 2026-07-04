import { useEffect, useMemo, type ReactElement } from "react";
import { useThree } from "@react-three/fiber";
import {
  BackSide,
  Color,
  ShaderMaterial,
  type CubeTexture,
  type IUniform,
} from "three";
import { useCubeTiles } from "./useCubeTiles.js";

// -----------------------------------------------------------------------------
// PanoStage — one scan node rendered as an inverted, cube-sampled sphere.
//
// The fragment shader remaps three.js sampling directions into the scanner
// frame (the twin-basis rotation x_s=-z₃, y_s=-x₃, z_s=y₃, composed with a
// y_s negation that cancels the left-handed WebGL cube-sampling convention —
// see the shader comment) so the cubemap reads exactly as the scanner saw
// the room, chirality included, and blends a nadir "crown"
// (deep Rite green) over the tripod's blind spot straight below. The mesh
// carries the node's pose rotation (e57QuatToThree, passed in as a quaternion
// prop) so every pano is oriented by its scan pose, and an opacity uniform so
// Task 9 can crossfade two stages during a hop.
//
// Renders null until the first LOD is ready — the viewer's loading state owns
// the blank, not a black sphere.
//
// Plan: docs/superpowers/plans/2026-07-02-twin-phase1-walk.md (Task 7). The
// visual calibration step against scan_000 runs once Task 9 mounts the viewer.
// -----------------------------------------------------------------------------

export const PANO_SPHERE_RADIUS = 50;
/** Nadir crown colour — the Rite's deep green-black. */
export const PANO_CROWN_COLOR = "#07100f";
/** Fraction of straight-down (scanner −Z) where the crown fade begins. */
export const PANO_CROWN_START = 0.82;

const panoVertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const panoFragmentShader = /* glsl */ `
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

/** Typed uniform bag (house pattern from cockpit-overlay-materials). */
interface PanoUniforms {
  [uniform: string]: IUniform;
  uCube: IUniform<CubeTexture | null>;
  uOpacity: IUniform<number>;
  uCrownColor: IUniform<Color>;
  uCrownStart: IUniform<number>;
}

export interface PanoStageProps {
  readonly nodeId: string;
  /** Node position in three space ([x, y, z] metres, from e57PointToThree). */
  readonly position: readonly [number, number, number];
  /** Node pose rotation in three space ([x, y, z, w], from e57QuatToThree). */
  readonly quaternion: readonly [number, number, number, number];
  /** Bundle base URL including the venue segment, e.g. `/twin/trades-hall`. */
  readonly assetBase: string;
  /** 0..1 crossfade opacity — Task 9 drives this during hops. */
  readonly opacity: number;
}

export function PanoStage({
  nodeId,
  position,
  quaternion,
  assetBase,
  opacity,
}: PanoStageProps): ReactElement | null {
  const invalidate = useThree((state) => state.invalidate);
  const { texture } = useCubeTiles(nodeId, assetBase);

  const material = useMemo(() => {
    const uniforms: PanoUniforms = {
      uCube: { value: null },
      uOpacity: { value: 1 },
      uCrownColor: { value: new Color(PANO_CROWN_COLOR) },
      uCrownStart: { value: PANO_CROWN_START },
    };
    return new ShaderMaterial({
      vertexShader: panoVertexShader,
      fragmentShader: panoFragmentShader,
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
    (material.uniforms as PanoUniforms).uCube.value = texture;
    invalidate();
  }, [texture, material, invalidate]);

  useEffect(() => {
    (material.uniforms as PanoUniforms).uOpacity.value = opacity;
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
