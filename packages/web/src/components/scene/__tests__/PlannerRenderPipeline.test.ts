// The planner's scene pass targets (PlannerRenderPipeline.tsx plannerSceneOutputs): the
// normal and velocity targets blend by alpha, so a surface writing alpha 0 there (the Grand
// Hall's window panes) leaves what lies behind it its own normal, occlusion and motion.
import { describe, expect, it, vi } from "vitest";
import { NormalBlending, PerspectiveCamera, Scene } from "three";
import type { NodeFrame, WebGPURenderer } from "three/webgpu";
import { vec4 } from "three/tsl";
import BloomNode from "three/examples/jsm/tsl/display/BloomNode.js";
import { RENDER_PROFILES } from "../../../lib/render-quality.js";
import { PausableBloomNode, buildPlannerPipeline, plannerSceneOutputs } from "../PlannerRenderPipeline.js";

describe("bloom paused while the view moves", () => {
  it("skips its passes at weight 0 once it has drawn a first frame, and draws them at any other weight", () => {
    const passes = vi.spyOn(BloomNode.prototype, "updateBefore").mockReturnValue(undefined);
    try {
      const glow = new PausableBloomNode(vec4(1), 0.32, 0.55, 0.92);
      const frame = {} as NodeFrame;
      glow.setWeight(0);
      // The first frame draws whatever the weight, so its passes compile with the pipeline.
      glow.updateBefore(frame);
      expect(passes).toHaveBeenCalledTimes(1);
      glow.updateBefore(frame);
      glow.updateBefore(frame);
      expect(passes).toHaveBeenCalledTimes(1);
      glow.setWeight(0.4);
      glow.updateBefore(frame);
      expect(passes).toHaveBeenCalledTimes(2);
      expect(glow.weight.value).toBe(0.4);
    } finally {
      passes.mockRestore();
    }
  });

  it("is what every profile with bloom draws, so pausing it compiles nothing", () => {
    const renderer = {} as WebGPURenderer;
    const phone = buildPlannerPipeline(renderer, new Scene(), new PerspectiveCamera(), RENDER_PROFILES.phone);
    expect(phone.bloom).toBeInstanceOf(PausableBloomNode);
    phone.dispose();
    const plain = buildPlannerPipeline(renderer, new Scene(), new PerspectiveCamera(), { ...RENDER_PROFILES.phone, bloom: null });
    expect(plain.bloom).toBeNull();
    plain.dispose();
  });
});

describe("the planner's scene pass targets", () => {
  it("blends the normal and velocity targets by alpha where a profile draws them, and leaves the colour alone", () => {
    const desktop = RENDER_PROFILES.desktop;
    expect(desktop.antiAlias).toBe("temporal");
    const outputs = plannerSceneOutputs(desktop);
    expect(outputs).not.toBeNull();
    expect(outputs?.has("normal")).toBe(true);
    expect(outputs?.has("velocity")).toBe(true);
    expect(outputs?.getBlendMode("normal").blending).toBe(NormalBlending);
    expect(outputs?.getBlendMode("velocity").blending).toBe(NormalBlending);
    expect(outputs?.getBlendMode("output").blending).not.toBe(NormalBlending);
  });

  it("keeps the normal target, blended, once occlusion is given up (the governor), and draws no velocity without temporal smoothing", () => {
    for (const profile of [RENDER_PROFILES.phone, RENDER_PROFILES.tablet]) {
      const outputs = plannerSceneOutputs({ ...profile, ambientOcclusion: null }, true);
      expect(outputs?.has("normal")).toBe(true);
      expect(outputs?.getBlendMode("normal").blending).toBe(NormalBlending);
      expect(outputs?.has("velocity")).toBe(profile.antiAlias === "temporal");
    }
  });

  it("draws colour alone where nothing else is wanted", () => {
    expect(plannerSceneOutputs({ ...RENDER_PROFILES.phone, ambientOcclusion: null, antiAlias: "none" }, false)).toBeNull();
  });
});
