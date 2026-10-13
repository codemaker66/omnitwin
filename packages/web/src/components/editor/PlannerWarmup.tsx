// ---------------------------------------------------------------------------
// PlannerWarmup — compile the planner's on-demand overlays while it loads
//
// Selection outlines, clearance rings, name plates, the marquee, snap guides
// and circulation lines mount only when a click, drag or orbit calls for
// them, so their shaders would otherwise compile in the middle of that
// gesture: a visible stall on a phone. For its first few frames the planner
// draws one vanishingly small copy of each, with the same material settings,
// through the same render pass. The copies then stay mounted but hidden, so
// the renderer keeps their compiled shaders for the real overlays to reuse.
//
// PipelineRetention complements it: three.js forgets a compiled pipeline once
// nothing drawn uses it, so it keeps every pipeline for the renderer's life
// and an overlay that unmounts and returns never compiles twice.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { DataTexture, DoubleSide, LinearFilter, SRGBColorSpace } from "three";
import { ignoreSelectionOutlineRaycast, SELECTION_OUTLINE_BRASS } from "../../lib/furniture-selection-outline.js";
import { closedLoopSegments } from "../../lib/loop-segments.js";
import { nativeFrameComposer, type NativeFrameComposer } from "../../lib/native-frame-composer.js";
import { retainCompiledPipelines } from "../../lib/pipeline-retention.js";
import { SELECTION_COLOR } from "../../lib/selection.js";
import { sectionClipPlanes } from "../SectionPlane.js";

/** Frames the copies are drawn, enough for the pipeline's passes to draw them. */
export const PLANNER_WARMUP_FRAMES = 4;

const OUTLINE: Float32Array = closedLoopSegments(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]));
const DASH_POSITIONS = new Float32Array([0, 0, 0, 1, 0, 0]);
const DASH_DISTANCES = new Float32Array([0, 1]);
/** A colour is a uniform, not part of a compiled pipeline: the copies share one. */
const RING_GREEN = "#5f8a6a";

/** A texel sampled the way a name plate's canvas texture is. */
function namePlateTexture(): DataTexture {
  const texture = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Keeps every pipeline the planner's renderer compiles, once it is ready. */
export function PipelineRetention(): null {
  const gl = useThree((state) => state.gl);
  const retained = useRef<{ readonly renderer: object; readonly restore: () => void } | null>(null);
  // The renderer's pipeline cache exists once it is initialised, which is
  // before its first frame; checking per frame costs one comparison.
  useFrame(() => {
    if (retained.current?.renderer === gl) return;
    retained.current?.restore();
    const restore = retainCompiledPipelines(gl);
    retained.current = restore === null ? null : { renderer: gl, restore };
  });
  useEffect(() => () => {
    retained.current?.restore();
    retained.current = null;
  }, []);
  return null;
}

export function PlannerWarmup(): ReactElement {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const [warming, setWarming] = useState(true);
  const frames = useRef(PLANNER_WARMUP_FRAMES);
  const drawnBy = useRef<NativeFrameComposer | null | undefined>(undefined);
  const texture = useMemo(namePlateTexture, []);
  useEffect(() => () => { texture.dispose(); }, [texture]);
  useFrame(() => {
    // Shaders compile per render target: when the post-processing pipeline
    // takes over the main view, or is rebuilt, draw the copies through it.
    const composer = nativeFrameComposer(gl);
    if (composer !== drawnBy.current) {
      drawnBy.current = composer;
      frames.current = PLANNER_WARMUP_FRAMES;
      if (!warming) setWarming(true);
    }
    if (!warming) return;
    frames.current -= 1;
    if (frames.current <= 0) setWarming(false);
    invalidate();
  });
  // Each copy is drawn whatever the camera sees, and none can be picked.
  const copy = { frustumCulled: false, raycast: ignoreSelectionOutlineRaycast } as const;
  return (
    <group name="planner-warmup" scale={1e-4} visible={warming}>
      {/* As FurnitureSelectionOutlines draws a footprint. */}
      <lineSegments renderOrder={10} {...copy}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[OUTLINE, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={SELECTION_OUTLINE_BRASS} transparent opacity={0.9}
          depthTest={false} depthWrite={false} toneMapped={false} clippingPlanes={sectionClipPlanes} />
      </lineSegments>
      {/* As ClearanceRings draws a ring and its fill. */}
      <lineSegments {...copy}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[OUTLINE, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={RING_GREEN} transparent opacity={0.9} depthTest={false} />
      </lineSegments>
      <mesh {...copy}>
        <circleGeometry args={[1, 8]} />
        <meshBasicMaterial color={RING_GREEN} transparent opacity={0.05} depthWrite={false} />
      </mesh>
      {/* As FurnitureNamePlate draws a selected piece's plate and its anchor dot. */}
      <mesh {...copy}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={texture} side={DoubleSide} transparent opacity={0.96}
          depthTest={false} depthWrite={false} clippingPlanes={sectionClipPlanes} />
      </mesh>
      <mesh {...copy}>
        <circleGeometry args={[1, 8]} />
        <meshBasicMaterial color={RING_GREEN} transparent opacity={0.92}
          depthTest={false} depthWrite={false} clippingPlanes={sectionClipPlanes} />
      </mesh>
      {/* As MarqueeSelect draws its fill and border. */}
      <mesh {...copy}>
        <circleGeometry args={[1, 8]} />
        <meshBasicMaterial color={SELECTION_COLOR} transparent opacity={0.75} side={DoubleSide} depthWrite={false} />
      </mesh>
      {/* As CirculationOverlay and SnapGuides draw a dashed line, and the overlay its end dots. */}
      <lineSegments {...copy}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[DASH_POSITIONS, 3]} />
          <bufferAttribute attach="attributes-lineDistance" args={[DASH_DISTANCES, 1]} />
        </bufferGeometry>
        <lineDashedMaterial color={RING_GREEN} dashSize={0.35} gapSize={0.22} depthTest={false} transparent opacity={0.95} />
      </lineSegments>
      <mesh {...copy}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshBasicMaterial color={RING_GREEN} depthTest={false} transparent opacity={0.95} />
      </mesh>
    </group>
  );
}
