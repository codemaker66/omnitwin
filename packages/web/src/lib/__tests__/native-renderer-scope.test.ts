import { PerspectiveCamera, RenderTarget, Scene } from "three";
import { describe, expect, it } from "vitest";
import { isNativeCanvasRender, withNativeComposedFrame, withNativeRenderScope } from "../native-renderer.js";

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

  it("counts a composed frame's nested draw of its own scene and camera as the main draw, and only that", () => {
    const scene = new Scene(), camera = new PerspectiveCamera();
    const quad = new Scene(), quadCamera = new PerspectiveCamera();
    let target: RenderTarget | null = null;
    const renderer = { getRenderTarget: () => target };
    const pass = new RenderTarget(1, 1);
    const seen: boolean[] = [];
    const nested = (drawScene: Scene, drawCamera: PerspectiveCamera): void => {
      target = pass;
      withNativeRenderScope(renderer, drawScene, drawCamera, () => { seen.push(isNativeCanvasRender(renderer, drawScene, drawCamera)); });
      target = null;
    };
    // A composer draws the canvas with a quad; the scene is drawn inside it, into the scene pass.
    withNativeComposedFrame(renderer, scene, camera, () => {
      withNativeRenderScope(renderer, quad, quadCamera, () => {
        nested(scene, camera);
        nested(scene, new PerspectiveCamera());
        nested(new Scene(), camera);
      });
    });
    // Outside a composed frame a nested draw is never the main one.
    withNativeRenderScope(renderer, quad, quadCamera, () => { nested(scene, camera); });
    expect(seen).toEqual([true, false, false, false]);
    pass.dispose();
  });
});
