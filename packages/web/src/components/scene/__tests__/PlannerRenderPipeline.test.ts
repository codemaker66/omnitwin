// The planner's scene pass targets (PlannerRenderPipeline.tsx plannerSceneOutputs): the
// normal and velocity targets blend by alpha, so a surface writing alpha 0 there (the Grand
// Hall's window panes) leaves what lies behind it its own normal, occlusion and motion.
import { describe, expect, it } from "vitest";
import { NormalBlending } from "three";
import { RENDER_PROFILES } from "../../../lib/render-quality.js";
import { plannerSceneOutputs } from "../PlannerRenderPipeline.js";

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
