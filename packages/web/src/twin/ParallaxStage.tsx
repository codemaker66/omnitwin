import { useEffect, useMemo, type ReactElement } from "react";
import { useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import {
  DoubleSide,
  Mesh,
  ShaderMaterial,
  Vector3,
  type IUniform,
  type Texture,
} from "three";
import type { TwinScanNode } from "@omnitwin/types";
import {
  E57_TO_THREE_QUAT,
  EQUIRECT_U_FLIP,
  EQUIRECT_U_OFFSET,
  MESH_OFFSET_M,
  e57PointToThree,
} from "./twin-basis.js";
import { gradeGLSL, makeGradeUniforms, type GradeUniforms } from "./PanoStage.js";
import { useEquirectTexture } from "./useEquirectTexture.js";

// -----------------------------------------------------------------------------
// ParallaxStage — true 3D movement: the moonshot that kills the photo bubble.
//
// A pano crossfade between two fixed spheres has ZERO parallax — the room
// slides as a flat image, the tell that you are inside photographs. This stage
// instead projects both hop panos onto the REAL building geometry (the
// co-registered dollhouse mesh): each mesh fragment looks up its world
// position in node A's equirect (direction from A's scan centre) and node B's,
// and blends by hop progress. Because sampling is anchored to world geometry
// while the camera dollies, TRUE parallax falls out — near doorframes slide
// past far walls exactly as they would walking the building.
//
// The elegant part is the handoff: viewed FROM a pano's own projection centre,
// the mesh-projected pano is pixel-identical to the sphere pano (the mapping
// is geometry-independent at the centre). So the stage simply becomes visible
// for 0<progress<1 and invisible at rest — no fade, no seam; the spheres
// remain underneath and show through mesh holes (windows, unscanned glass).
//
// Where the mesh is coarse (the reconstructed dome apex) the projection blurs
// those distant pixels slightly DURING MOTION ONLY — far surfaces carry
// near-zero parallax, so the cost hides in the motion; the mesh is
// centimetre-true at walking height where parallax actually lives (verified
// against the E57 poses — see the SS++ plan memory). The glb (~7 MB) loads
// lazily behind Suspense; the caller gates mounting to capable devices.
//
// Continuous light: each side carries its node's exposure correction, so the
// projective blend matches the sphere pipeline's colour exactly (one grade,
// one encode — gradeGLSL is shared with PanoStage).
// -----------------------------------------------------------------------------

const parallaxVertexShader = /* glsl */ `
varying vec3 vWorld;
void main() {
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;

const parallaxFragmentShader = /* glsl */ gradeGLSL + `
uniform sampler2D uMapA;
uniform sampler2D uMapB;
uniform vec3 uPosA;
uniform vec3 uPosB;
uniform vec3 uExpA;
uniform vec3 uExpB;
uniform float uProgress;
uniform float uUSign;
uniform float uUOffset;
varying vec3 vWorld;
const float PI = 3.141592653589793;

// three-space direction → equirect UV, identical maths to PanoStage's sphere
// shader (threeDirToE57 then az/el), so the projected image lines up with the
// sphere pixel-for-pixel at each projection centre.
vec2 twinDirToUv(vec3 d) {
  vec3 e = vec3(d.x, -d.z, d.y);
  float az = atan(e.y, e.x);
  float u = uUSign * az / (2.0 * PI) + uUOffset;
  float v = 0.5 + asin(clamp(e.z, -1.0, 1.0)) / PI;
  return vec2(u, v);
}

void main() {
  vec3 a = texture2D(uMapA, twinDirToUv(normalize(vWorld - uPosA))).rgb * uExpA;
  vec3 b = texture2D(uMapB, twinDirToUv(normalize(vWorld - uPosB))).rgb * uExpB;
  vec3 c = mix(a, b, uProgress);
  gl_FragColor = vec4(twinGrade(twinLinearToSRGB(c)), 1.0);
}
`;

interface ParallaxUniforms extends GradeUniforms {
  [uniform: string]: IUniform;
  uMapA: IUniform<Texture | null>;
  uMapB: IUniform<Texture | null>;
  uPosA: IUniform<Vector3>;
  uPosB: IUniform<Vector3>;
  uExpA: IUniform<Vector3>;
  uExpB: IUniform<Vector3>;
  uProgress: IUniform<number>;
  uUSign: IUniform<number>;
  uUOffset: IUniform<number>;
}

function expVec(node: TwinScanNode): readonly [number, number, number] {
  const e = node.exposure;
  return e === undefined
    ? [1, 1, 1]
    : [e.gain * e.wb[0], e.gain * e.wb[1], e.gain * e.wb[2]];
}

/** Streams one node's base pano into the given uniform slot (child component
 *  so the target feed can mount only while a hop is in flight). */
function PanoFeed({
  nodeId,
  assetBase,
  slot,
  uniforms,
}: {
  readonly nodeId: string;
  readonly assetBase: string;
  readonly slot: "uMapA" | "uMapB";
  readonly uniforms: ParallaxUniforms;
}): null {
  const invalidate = useThree((state) => state.invalidate);
  const { texture } = useEquirectTexture(nodeId, assetBase);
  useEffect(() => {
    uniforms[slot].value = texture;
    invalidate();
    return () => {
      uniforms[slot].value = null;
    };
  }, [texture, uniforms, slot, invalidate]);
  return null;
}

export interface ParallaxStageProps {
  readonly meshUrl: string;
  readonly assetBase: string;
  readonly currentNode: TwinScanNode;
  readonly targetNode: TwinScanNode | undefined;
  /** 0→1 hop progress — the stage is visible only strictly between the two. */
  readonly progress: number;
}

export function ParallaxStage({
  meshUrl,
  assetBase,
  currentNode,
  targetNode,
  progress,
}: ParallaxStageProps): ReactElement {
  const gltf = useGLTF(meshUrl);

  const uniforms = useMemo<ParallaxUniforms>(
    () => ({
      uMapA: { value: null },
      uMapB: { value: null },
      uPosA: { value: new Vector3() },
      uPosB: { value: new Vector3() },
      uExpA: { value: new Vector3(1, 1, 1) },
      uExpB: { value: new Vector3(1, 1, 1) },
      uProgress: { value: 0 },
      uUSign: { value: EQUIRECT_U_FLIP ? -1 : 1 },
      uUOffset: { value: EQUIRECT_U_OFFSET },
      ...makeGradeUniforms(),
    }),
    [],
  );

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: parallaxVertexShader,
        fragmentShader: parallaxFragmentShader,
        uniforms,
        // Winding varies room to room in the matterpak mesh; both faces sample
        // the same projective colour, so DoubleSide is free correctness.
        // Opaque + depth so nearer geometry occludes properly during the hop.
        side: DoubleSide,
      }),
    [uniforms],
  );
  useEffect(
    () => () => {
      material.dispose();
    },
    [material],
  );

  // One cloned scene graph (geometry SHARED by reference — no copy) with every
  // material swapped for the projective shader. The glTF cache's original
  // scene keeps its own materials for the dollhouse view.
  const projected = useMemo(() => {
    const clone = gltf.scene.clone(true);
    clone.traverse((object) => {
      if (object instanceof Mesh) {
        object.material = material;
      }
    });
    return clone;
  }, [gltf.scene, material]);

  // Per-hop uniform writes ride the hop machine's own re-render per progress
  // step — no extra React state, no per-frame subscriptions.
  const a = e57PointToThree(currentNode.pose.t);
  uniforms.uPosA.value.set(a[0], a[1], a[2]);
  const expA = expVec(currentNode);
  uniforms.uExpA.value.set(expA[0], expA[1], expA[2]);
  if (targetNode !== undefined) {
    const b = e57PointToThree(targetNode.pose.t);
    uniforms.uPosB.value.set(b[0], b[1], b[2]);
    const expB = expVec(targetNode);
    uniforms.uExpB.value.set(expB[0], expB[1], expB[2]);
  }
  // Until the target texture lands, hold on A (A projected alone still gives
  // true parallax against the dollying camera — no double image, no black).
  const bReady = targetNode !== undefined && uniforms.uMapB.value !== null;
  uniforms.uProgress.value = bReady ? progress : 0;

  const hopping = targetNode !== undefined && progress > 0 && progress < 1;

  return (
    <group quaternion={E57_TO_THREE_QUAT} position={MESH_OFFSET_M} visible={hopping}>
      <primitive object={projected} />
      <PanoFeed
        nodeId={currentNode.id}
        assetBase={assetBase}
        slot="uMapA"
        uniforms={uniforms}
      />
      {targetNode !== undefined && (
        <PanoFeed
          nodeId={targetNode.id}
          assetBase={assetBase}
          slot="uMapB"
          uniforms={uniforms}
        />
      )}
    </group>
  );
}
