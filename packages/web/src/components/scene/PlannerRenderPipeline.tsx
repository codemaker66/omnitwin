// ---------------------------------------------------------------------------
// PlannerRenderPipeline — the planner's post-processing
//
// Draws the main view through a node pipeline instead of a plain render:
//
//   scene pass ──► ambient occlusion (weighted per material) ──► temporal
//   anti-aliasing ──► bloom ──► vignette ──► tone mapping and output
//
// Surfaces whose colour already holds the room's own shadows (the hall's
// photographs) write a lower occlusion weight into the normal target's alpha,
// so screen-space occlusion grounds furniture without darkening the scan's
// corners twice. Temporal anti-aliasing jitters the camera every frame; under
// the planner's on-demand frame loop the view keeps drawing for a few frames
// after the last change, so a still image converges to a supersampled one and
// then the loop goes idle again. Profiles per device class live in
// lib/render-quality.ts. The pipeline stands aside while a captured room is
// shown (captures carry their own camera response), and a software
// rasteriser draws the scene plainly.
// ---------------------------------------------------------------------------

import { useLayoutEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { UnsignedByteType, type Camera, type Scene } from "three";
import { RenderPipeline, type Node, type WebGPURenderer } from "three/webgpu";
import {
  float,
  luminance,
  mix,
  mrt,
  normalView,
  output,
  packNormalToRGB,
  pass,
  renderOutput,
  sample,
  screenUV,
  smoothstep,
  unpackRGBToNormal,
  vec3,
  vec4,
  velocity,
} from "three/tsl";
import { ao } from "three/examples/jsm/tsl/display/GTAONode.js";
import { bloom } from "three/examples/jsm/tsl/display/BloomNode.js";
import { traa } from "three/examples/jsm/tsl/display/TRAANode.js";
import { fxaa } from "three/examples/jsm/tsl/display/FXAANode.js";
import { getNativeRenderer, nativeRendererGpuString } from "../../lib/native-renderer.js";
import { isSoftwareRenderer } from "../grand-hall/hall-finish.js";
import { registerNativeFrameComposer } from "../../lib/native-frame-composer.js";
import type { RenderProfile } from "../../lib/render-quality.js";
import { sceneGrade } from "../../lib/scene-grade.js";

interface BuiltPipeline {
  readonly pipeline: RenderPipeline;
  readonly dispose: () => void;
}

interface Disposable { dispose(): void }

/** A development view of one intermediate (`?pipeline=ao`), or the final image. */
export type PipelineDebugView = "ao" | null;

/** Builds the node pipeline for one renderer, scene, camera and profile. */
export function buildPlannerPipeline(renderer: WebGPURenderer, scene: Scene, camera: Camera, profile: RenderProfile, debugView: PipelineDebugView = null): BuiltPipeline {
  const owned: Disposable[] = [];
  const temporal = profile.antiAlias === "temporal";
  const occlusion = profile.ambientOcclusion;

  // Occlusion and temporal anti-aliasing read the depth buffer, which cannot
  // be multisampled (the profile then asks for no samples): the temporal
  // resolve replaces MSAA's edge smoothing. Phones keep MSAA, which a tiled
  // mobile GPU resolves on chip for little cost.
  const scenePass = pass(scene, camera, { samples: profile.sceneSamples });
  owned.push(scenePass);
  const targets: Parameters<typeof mrt>[0] = { output };
  // The normal target's alpha carries each surface's occlusion weight.
  if (occlusion !== null) targets["normal"] = vec4(packNormalToRGB(normalView), float(1));
  if (temporal) targets["velocity"] = velocity;
  if (Object.keys(targets).length > 1) scenePass.setMRT(mrt(targets));
  if (occlusion !== null) scenePass.getTexture("normal").type = UnsignedByteType;

  const color = scenePass.getTextureNode("output");
  const depth = scenePass.getTextureNode("depth");

  let lit: Node<"vec4"> = vec4(color);
  if (occlusion !== null) {
    const normalTexture = scenePass.getTextureNode("normal");
    const normal = sample((coordinates) => unpackRGBToNormal(normalTexture.sample(coordinates).xyz));
    const occlusionPass = ao(depth, normal, camera);
    owned.push(occlusionPass);
    occlusionPass.resolutionScale = occlusion.resolutionScale;
    occlusionPass.radius.value = occlusion.radius;
    occlusionPass.samples.value = occlusion.samples;
    occlusionPass.useTemporalFiltering = temporal;
    const weight = normalTexture.a.mul(occlusion.intensity);
    const visibility = mix(float(1), occlusionPass.getTextureNode().r, weight);
    lit = vec4(color.rgb.mul(visibility), color.a);
    if (debugView === "ao") {
      const pipeline = new RenderPipeline(renderer);
      pipeline.outputColorTransform = false;
      pipeline.outputNode = vec4(vec3(occlusionPass.getTextureNode().r), 1);
      return { pipeline, dispose: () => { pipeline.dispose(); for (const item of owned) item.dispose(); } };
    }
  }

  let resolved: Node<"vec4"> = lit;
  if (temporal) {
    const temporalPass = traa(lit, depth, scenePass.getTextureNode("velocity"), camera);
    owned.push(temporalPass);
    resolved = vec4(temporalPass);
  }

  let graded: Node<"vec4"> = resolved;
  if (profile.bloom !== null) {
    const glow = bloom(resolved, profile.bloom.strength, profile.bloom.radius, profile.bloom.threshold);
    owned.push(glow);
    graded = vec4(resolved.rgb.add(glow.rgb), resolved.a);
  }
  // The camera's eye: white balance, then saturation, in linear light.
  const balanced = graded.rgb.mul(sceneGrade.whiteBalance);
  graded = vec4(mix(vec3(luminance(balanced)), balanced, sceneGrade.saturation), graded.a);
  if (profile.vignette > 0) {
    const distance = screenUV.sub(0.5).length().mul(1.4142);
    const shade = mix(float(1), float(1 - profile.vignette), smoothstep(0.35, 1.0, distance));
    graded = vec4(graded.rgb.mul(shade), graded.a);
  }

  const pipeline = new RenderPipeline(renderer);
  if (profile.antiAlias === "fxaa") {
    // FXAA works on display-referred colour, after tone mapping.
    pipeline.outputColorTransform = false;
    const spatial = fxaa(renderOutput(graded));
    owned.push(spatial);
    pipeline.outputNode = spatial;
  } else {
    pipeline.outputNode = graded;
  }
  return {
    pipeline,
    dispose: () => {
      pipeline.dispose();
      for (const item of owned) item.dispose();
    },
  };
}

export interface PlannerRenderPipelineProps {
  /** False while a captured room is shown, or for scenes that draw plainly. */
  readonly enabled: boolean;
  /** The device's profile (lib/render-quality.ts), chosen once by the scene. */
  readonly profile: RenderProfile;
}

/** Installs the planner's pipeline as the canvas's frame composer. */
export function PlannerRenderPipeline({ enabled, profile }: PlannerRenderPipelineProps): null {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const convergence = useRef({ remaining: 0, selfRequested: false });
  // Whether this renderer is a software rasteriser, read at its first frame.
  const software = useRef<boolean | null>(null);

  // A layout effect registers the composer before the next frame can draw:
  // one plain frame would compile every visible material for the canvas too.
  useLayoutEffect(() => {
    const native = getNativeRenderer(gl);
    if (native === null || !enabled || profile.name === "off") return undefined;
    let built: BuiltPipeline;
    const debugView: PipelineDebugView = import.meta.env.DEV && new URLSearchParams(window.location.search).get("pipeline") === "ao" ? "ao" : null;
    try {
      built = buildPlannerPipeline(native, scene, camera, profile, debugView);
    } catch {
      // Without post-processing the planner still draws its scene plainly.
      return undefined;
    }
    const release = registerNativeFrameComposer(native, () => {
      // A software rasteriser (a virtual machine, a headless browser) would run
      // every pass on the CPU, seconds a frame, so it draws the scene plainly,
      // as the hall's finish lightens there too (hall-finish.ts). Its backend
      // names the rasteriser once initialised, which the first frame awaits.
      software.current ??= isSoftwareRenderer(nativeRendererGpuString(native));
      if (software.current) native.render(scene, camera);
      else built.pipeline.render();
    });
    invalidate();
    return () => {
      release();
      built.dispose();
      invalidate();
    };
  }, [camera, enabled, gl, invalidate, profile, scene]);

  // Temporal anti-aliasing converges over a few frames after the last change.
  useFrame(() => {
    if (!enabled || profile.convergenceFrames === 0 || software.current === true) return;
    const state = convergence.current;
    if (state.selfRequested) {
      state.selfRequested = false;
      state.remaining -= 1;
    } else {
      state.remaining = profile.convergenceFrames;
    }
    if (state.remaining > 0) {
      state.selfRequested = true;
      invalidate();
    }
  });

  return null;
}
