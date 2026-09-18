import { PerspectiveCamera, RenderTarget, Scene } from "three";
import { describe, expect, it } from "vitest";
import { isNativeCanvasRender, withNativeRenderScope } from "../native-renderer.js";

describe("native render scopes", () => {
  it("restores the main scope after nested offscreen failure and clears it after the outer draw", () => {
    const scene = new Scene(), camera = new PerspectiveCamera();
    let target: RenderTarget | null = null;
    const renderer = { getRenderTarget: () => target };
    const offscreen = new RenderTarget(1, 1);
    expect(isNativeCanvasRender(renderer, scene, camera)).toBe(false);
    withNativeRenderScope(renderer, scene, camera, () => {
      expect(isNativeCanvasRender(renderer, scene, camera)).toBe(true);
      expect(isNativeCanvasRender(renderer, new Scene(), camera)).toBe(false);
      expect(isNativeCanvasRender(renderer, scene, new PerspectiveCamera())).toBe(false);
      target = offscreen;
      expect(() => { withNativeRenderScope(renderer, scene, camera, () => {
        target = null;
        expect(isNativeCanvasRender(renderer, scene, camera)).toBe(false);
        throw new Error("Nested export failed");
      }); }).toThrow("Nested export failed");
      expect(isNativeCanvasRender(renderer, scene, camera)).toBe(true);
    });
    expect(isNativeCanvasRender(renderer, scene, camera)).toBe(false);
    expect(() => { withNativeRenderScope(renderer, scene, camera, () => {
      throw new Error("Main draw failed");
    }); }).toThrow("Main draw failed");
    expect(isNativeCanvasRender(renderer, scene, camera)).toBe(false);
    offscreen.dispose();
  });
});
