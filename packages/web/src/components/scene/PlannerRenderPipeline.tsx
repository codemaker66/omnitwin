// ---------------------------------------------------------------------------
// PlannerRenderPipeline — the planner's post-processing
//
// Draws the main view through a node pipeline instead of a plain render:
//
//   scene pass ──► ambient occlusion ──► temporal anti-aliasing ──► bloom
//   ──► white balance and saturation ──► vignette ──► tone mapping and output
//
// Every surface writes an occlusion weight of 1 into the normal target's
// alpha, so screen-space occlusion darkens the photographed room as it does
// the furniture. The window panes (hall-glazing.ts) write alpha 0 into the
// normal and velocity targets, and the street's light (hall-street-light.ts)
// into the normal target; both targets blend by alpha, so what lies behind
// keeps its own normal and occlusion (and, behind the panes, its motion).
//
// Temporal anti-aliasing jitters the camera every frame; under the planner's
// on-demand frame loop the view keeps drawing for a few frames after the last
// change, so a still image converges to a supersampled one and then the loop
// goes idle again. Profiles per device class live in
// lib/render-quality.ts. The pipeline stands aside while a captured room is
// shown (captures carry their own camera response), and a software
// rasteriser draws the scene plainly.
//
// On a phone bloom pauses while the view moves (lib/motion-bloom.ts): its
// passes are skipped and the composite weights its last glow 0, so the same
// compiled pipeline draws both, and switching between them compiles nothing.
// ---------------------------------------------------------------------------

import { useLayoutEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { NormalBlending, RenderTarget, UnsignedByteType, type Camera, type Scene } from "three";
import { BlendMode, RenderPipeline, type Node, type NodeFrame, type UniformNode, type WebGPURenderer } from "three/webgpu";
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
  uniform,
  unpackRGBToNormal,
  vec3,
  vec4,
  velocity,
} from "three/tsl";
import { ao } from "three/examples/jsm/tsl/display/GTAONode.js";
import BloomNode from "three/examples/jsm/tsl/display/BloomNode.js";
import { traa } from "three/examples/jsm/tsl/display/TRAANode.js";
import { fxaa } from "three/examples/jsm/tsl/display/FXAANode.js";
import { getNativeRenderer, nativeRendererGpuString } from "../../lib/native-renderer.js";
import { isSoftwareRenderer } from "../grand-hall/hall-finish.js";
import { CameraPoseWatch, MotionBloom } from "../../lib/motion-bloom.js";
import { registerNativeFrameComposer } from "../../lib/native-frame-composer.js";
import { compileEach, compileWithin, drawAhead, requestNativePrecompile, withoutShadowMapDraws } from "../../lib/native-precompile.js";
import type { RenderProfile } from "../../lib/render-quality.js";
import { sceneGrade } from "../../lib/scene-grade.js";
import { watchViewHand } from "../../lib/view-hand.js";

/**
 * Bloom whose passes can be skipped. The composite multiplies its glow by
 * `weight`; at 0 the passes are skipped and the glow they last drew is
 * weighted away. The first frame draws them whatever the weight, so they
 * compile with the rest of the pipeline rather than when the view next stills.
 */
export class PausableBloomNode extends BloomNode {
  readonly weight: UniformNode<"float", number> = uniform(1);
  private drawn = false;

  /** The glow's weight in the composite, 0 to 1. */
  setWeight(weight: number): void {
    this.weight.value = weight;
  }

  override updateBefore(frame: NodeFrame): boolean | undefined {
    if (this.drawn && this.weight.value === 0) return undefined;
    this.drawn = true;
    return super.updateBefore(frame);
  }
}

interface BuiltPipeline {
  readonly pipeline: RenderPipeline;
  /** The scene pass, whose pipelines compile ahead of its first draw. */
  readonly scenePass: ReturnType<typeof pass>;
  /** The pipeline's bloom, or null for a profile without it. */
  readonly bloom: PausableBloomNode | null;
  /** The temporal resolve, or null for a profile without it. */
  readonly temporal: ReturnType<typeof traa> | null;
  readonly dispose: () => void;
}

interface Disposable { dispose(): void }

/**
 * Has a temporal resolve start its history afresh from the scene at its next
 * frame: after a frame drawn ahead, which drew nothing, the history holds
 * nothing. A new size does it (TRAANode.updateBefore restarts the history
 * when its size changes); r186's TRAANode.setSize is public but missing
 * from @types/three.
 */
function restartHistory(temporal: object): void {
  const setSize: unknown = Reflect.get(temporal, "setSize");
  if (typeof setSize === "function") Reflect.apply(setSize, temporal, [1, 1]);
}

/** A development view of one intermediate (`?pipeline=ao`), or the final image. */
export type PipelineDebugView = "ao" | null;

/**
 * The scene pass's targets for a profile, or null for colour alone: the
 * colour, the normal target where occlusion is drawn or kept (its alpha the
 * occlusion weight: 1 here for every surface; a material's own MRT may write
 * 0, see the header) and the velocity target under temporal anti-aliasing.
 * The normal and velocity targets blend by their own alpha. Every surface
 * writes alpha 1 there, which replaces what lies behind as before; a surface
 * that writes alpha 0 (the Grand Hall's window panes, hall-glazing.ts) leaves
 * the street behind it to occlusion and the temporal resolve. Lost, that
 * blend would leave the panes' own normal and a zero motion behind them.
 */
export function plannerSceneOutputs(profile: RenderProfile, sceneNormals = profile.ambientOcclusion !== null): ReturnType<typeof mrt> | null {
  const targets: Parameters<typeof mrt>[0] = { output };
  if (sceneNormals || profile.ambientOcclusion !== null) targets["normal"] = vec4(packNormalToRGB(normalView), float(1));
  if (profile.antiAlias === "temporal") targets["velocity"] = velocity;
  if (Object.keys(targets).length === 1) return null;
  const outputs = mrt(targets);
  for (const name of ["normal", "velocity"] as const) {
    if (name in targets) outputs.setBlendMode(name, new BlendMode(NormalBlending));
  }
  return outputs;
}

/**
 * Builds the node pipeline for one renderer, scene, camera and profile.
 * `sceneNormals` keeps the scene pass writing normals once ambient occlusion
 * is given up (lib/render-governor.ts): the scene's every material compiles
 * per set of pass targets, so the same targets keep their compiled pipelines
 * and only the passes after the scene compile again.
 */
export function buildPlannerPipeline(
  renderer: WebGPURenderer, scene: Scene, camera: Camera, profile: RenderProfile,
  debugView: PipelineDebugView = null, sceneNormals = profile.ambientOcclusion !== null,
): BuiltPipeline {
  const owned: Disposable[] = [];
  const temporal = profile.antiAlias === "temporal";
  const occlusion = profile.ambientOcclusion;
  const normals = sceneNormals || occlusion !== null;

  // Occlusion and temporal anti-aliasing read the depth buffer, which cannot
  // be multisampled (the profile then asks for no samples): the temporal
  // resolve replaces MSAA's edge smoothing. Phones keep MSAA, which a tiled
  // mobile GPU resolves on chip for little cost.
  const scenePass = pass(scene, camera, { samples: profile.sceneSamples });
  owned.push(scenePass);
  const outputs = plannerSceneOutputs(profile, sceneNormals);
  if (outputs !== null) scenePass.setMRT(outputs);
  if (normals) scenePass.getTexture("normal").type = UnsignedByteType;

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
      return { pipeline, scenePass, bloom: null, temporal: null, dispose: () => { pipeline.dispose(); for (const item of owned) item.dispose(); } };
    }
  }

  let resolved: Node<"vec4"> = lit;
  let temporalPass: ReturnType<typeof traa> | null = null;
  if (temporal) {
    temporalPass = traa(lit, depth, scenePass.getTextureNode("velocity"), camera);
    owned.push(temporalPass);
    resolved = vec4(temporalPass);
  }

  let graded: Node<"vec4"> = resolved;
  let glow: PausableBloomNode | null = null;
  if (profile.bloom !== null) {
    glow = new PausableBloomNode(resolved, profile.bloom.strength, profile.bloom.radius, profile.bloom.threshold);
    owned.push(glow);
    graded = vec4(resolved.rgb.add(glow.rgb.mul(glow.weight)), resolved.a);
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
    scenePass,
    bloom: glow,
    temporal: temporalPass,
    dispose: () => {
      pipeline.dispose();
      for (const item of owned) item.dispose();
    },
  };
}

export interface PlannerRenderPipelineProps {
  /** False while a captured room is shown, or for scenes that draw plainly. */
  readonly enabled: boolean;
  /** The device's profile (lib/render-quality.ts), less what the frame-rate governor gave up. */
  readonly profile: RenderProfile;
  /** Whether the scene pass writes normals: true for a device whose own profile has ambient occlusion. */
  readonly sceneNormals?: boolean;
}

/** Installs the planner's pipeline as the canvas's frame composer. */
export function PlannerRenderPipeline({ enabled, profile, sceneNormals = profile.ambientOcclusion !== null }: PlannerRenderPipelineProps): null {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const convergence = useRef({ remaining: 0, selfRequested: false });
  // Whether this renderer is a software rasteriser, read at its first frame.
  const software = useRef<boolean | null>(null);
  /** The renderer a pipeline was last built for: a rebuild for it compiles ahead itself. */
  const builtFor = useRef<object | null>(null);

  // A layout effect registers the composer before the next frame can draw:
  // one plain frame would compile every visible material for the canvas too.
  useLayoutEffect(() => {
    const native = getNativeRenderer(gl);
    if (native === null || !enabled || profile.name === "off") return undefined;
    let built: BuiltPipeline;
    const debugView: PipelineDebugView = import.meta.env.DEV && new URLSearchParams(window.location.search).get("pipeline") === "ao" ? "ao" : null;
    try {
      built = buildPlannerPipeline(native, scene, camera, profile, debugView, sceneNormals);
    } catch {
      // Without post-processing the planner still draws its scene plainly.
      return undefined;
    }
    // A phone's bloom pauses while a hand is on the view or the camera moves.
    const glow = profile.bloomInMotion ? null : built.bloom;
    const motion = new MotionBloom();
    const pose = new CameraPoseWatch();
    let weight = 1;
    // A paused frame stays on screen until the next one: draw it once the hand leaves.
    const hand = glow === null ? null : watchViewHand(gl.domElement, () => { if (weight < 1) invalidate(); });
    // The scene pass's pipelines for what the scene holds, compiled ahead of
    // their first draw (lib/native-precompile.ts, F-01): its own target and
    // MRT, every visible piece with the view's own camera, in view or not.
    // Then the post passes' (occlusion, the temporal resolve, bloom's seven):
    // their materials exist only once the chain builds them as it draws its
    // first frame, so one frame is drawn ahead into a 1 px target of its own,
    // each pass's pipeline built off the GPU process's main thread and none
    // drawn (drawAhead). The pass to the canvas compiles as the view draws.
    // A job may still be waiting or running when this pipeline is replaced: it
    // must not touch the disposed passes (it would allocate their targets anew).
    let live = true;
    // Read after each await: the pipeline may have been replaced meanwhile.
    const isLive = (): boolean => live;
    const precompile = async (signal: AbortSignal): Promise<void> => {
      if (!isLive() || isSoftwareRenderer(nativeRendererGpuString(native))) return;
      // Under temporal anti-aliasing the scene is drawn with the projection TRAA
      // hands the velocity node on every frame it draws (TRAANode.setViewOffset),
      // which the velocity output builds into each shader as its own uniform;
      // without it the compile builds a shader the frames never draw.
      const temporal = profile.antiAlias === "temporal";
      if (temporal) velocity.setProjectionMatrix(camera.projectionMatrix);
      try {
        await compileWithin(native, built.scenePass.renderTarget, built.scenePass.getMRT(), signal,
          () => compileEach(native, scene, camera, scene, signal));
      } finally {
        if (temporal) velocity.setProjectionMatrix(null);
      }
      if (signal.aborted || !isLive()) return;
      const scratch = new RenderTarget(1, 1, { depthBuffer: false });
      try {
        await compileWithin(native, scratch, null, signal, () => drawAhead(native, () => {
          const { toneMapping, outputColorSpace } = native;
          try {
            withoutShadowMapDraws(scene, () => { built.pipeline.render(); });
          } finally {
            // RenderPipeline.render puts these back only when it returns.
            native.toneMapping = toneMapping;
            native.outputColorSpace = outputColorSpace;
          }
        }, signal));
      } finally {
        scratch.dispose();
      }
      if (isLive() && built.temporal !== null) restartHistory(built.temporal);
    };
    const release = registerNativeFrameComposer(native, () => {
      // A software rasteriser (a virtual machine, a headless browser) would run
      // every pass on the CPU, seconds a frame, so it draws the scene plainly,
      // as the hall's finish lightens there too (hall-finish.ts). Its backend
      // names the rasteriser once initialised, which the first frame awaits.
      software.current ??= isSoftwareRenderer(nativeRendererGpuString(native));
      if (software.current) {
        native.render(scene, camera);
        return;
      }
      if (glow !== null && hand !== null) {
        const now = performance.now();
        const cameraMoved = pose.changed(camera);
        weight = motion.frame(now, cameraMoved || hand.isOn(now));
        glow.setWeight(weight);
        // Frames follow while the glow returns, and one after a camera move to see it stop.
        if (motion.returning || cameraMoved) invalidate();
      }
      built.pipeline.render();
    }, precompile);
    // A pipeline rebuilt for the same renderer (an effect given up, the
    // profile changed) compiles ahead before it draws. The first is compiled
    // by its view's own job, after the hall's capture, whose environment its
    // materials are built with (GrandHallModel, PlannerScene).
    if (builtFor.current === native) void requestNativePrecompile(native, precompile);
    builtFor.current = native;
    invalidate();
    return () => {
      live = false;
      release();
      hand?.dispose();
      built.dispose();
      invalidate();
    };
  }, [camera, enabled, gl, invalidate, profile, scene, sceneNormals]);

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
