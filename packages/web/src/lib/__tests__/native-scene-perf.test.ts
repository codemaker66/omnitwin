import { describe, expect, it, vi } from "vitest";
import { Scene } from "three";
import { nativeScenePerfStats, nativeSplatScene } from "../native-splat-scene.js";

describe("native scene profiler inspection", () => {
  it("does not create or traverse a scene runtime during inspection", () => {
    const scene = new Scene();
    const traverse = vi.spyOn(scene, "traverse");
    expect(nativeScenePerfStats(scene, 100)).toBeNull();
    expect(traverse).not.toHaveBeenCalled();
    expect(scene.children).toHaveLength(0);
    const runtime = nativeSplatScene(scene);
    const stats = vi.spyOn(runtime, "perfStats").mockReturnValue({ splats: 12, sortTimeMs: null, sortAgeMs: null, sortBacklog: null });
    expect(nativeScenePerfStats(scene, 120)).toEqual({ splats: 12, sortTimeMs: null, sortAgeMs: null, sortBacklog: null });
    expect(stats).toHaveBeenCalledExactlyOnceWith(120);
    expect(traverse).not.toHaveBeenCalled();
  });
});
