import { describe, expect, it, vi } from "vitest";
import { BufferAttribute, BufferGeometry, PerspectiveCamera, Scene } from "three";
import { WebGPURenderer } from "three/webgpu";
import { GaussianSplat } from "three/addons/objects/GaussianSplat.js";
import { nativeSceneDrawnSplats, nativeScenePerfStats, nativeSplatScene } from "../native-splat-scene.js";

function splatGeometry(count: number): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(Float32Array.from({ length: count * 3 }, (_, i) => (i % 3 === 2 ? -4 : i % 5)), 3));
  geometry.setAttribute("covariance", new BufferAttribute(Float32Array.from({ length: count * 6 }, (_, i) => (i % 6 === 0 || i % 6 === 3 || i % 6 === 5 ? 0.01 : 0)), 6));
  geometry.setAttribute("color", new BufferAttribute(new Uint8Array(count * 4).fill(200), 4, true));
  return geometry;
}

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

  it("reads the GPU-culled draw count on WebGPU and reports every loaded splat on WebGL", async () => {
    const scene = new Scene();
    const runtime = nativeSplatScene(scene);
    const geometry = splatGeometry(64);
    const mesh = new GaussianSplat(geometry, { autoSort: false });
    const webgpu = new WebGPURenderer();
    vi.spyOn(webgpu, "compute").mockImplementation(() => undefined);
    const camera = new PerspectiveCamera(60, 1.5, 0.1, 100);
    Reflect.set(runtime, "active", { mesh, sortFailed: false, completionFailed: false });
    try {
      expect(await nativeSceneDrawnSplats(scene, webgpu)).toBeNull();
      camera.updateMatrixWorld(true);
      mesh.updateSort(webgpu, camera);
      const read = vi.spyOn(webgpu, "getArrayBufferAsync").mockResolvedValue(new Uint32Array([6, 17, 0, 0, 0]).buffer);
      expect(await nativeSceneDrawnSplats(scene, webgpu)).toBe(17);
      expect(read).toHaveBeenCalledWith(mesh.drawIndirect);
      expect(await nativeSceneDrawnSplats(scene, new WebGPURenderer({ forceWebGL: true }))).toBe(64);
      mesh.visible = false;
      expect(await nativeSceneDrawnSplats(scene, webgpu)).toBeNull();
      expect(await nativeSceneDrawnSplats(new Scene(), webgpu)).toBeNull();
    } finally {
      Reflect.set(runtime, "active", null);
      mesh.dispose();
      geometry.dispose();
    }
  });
});
