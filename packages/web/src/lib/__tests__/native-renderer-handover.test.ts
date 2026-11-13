import { describe, expect, it, vi } from "vitest";
import { Color, NoToneMapping, ACESFilmicToneMapping, PCFShadowMap, VSMShadowMap } from "three";
import { WebGPURenderer } from "three/webgpu";
import {
  applyNativeRendererSettings, readNativeRendererSettings, releaseLostWebGLRenderer, replaceStoreRenderer,
} from "../native-renderer.js";

/** A lost WebGL renderer as r186 leaves it: a backend whose dispose() ends in loseContext(). */
function lostWebGLRenderer(extensionCache: boolean) {
  const canvas = document.createElement("canvas");
  const loseContext = vi.fn();
  const onContextLost = vi.fn();
  canvas.addEventListener("webglcontextlost", onContextLost);
  const extensions = { extensions: {} as Record<string, unknown>, get(name: string): unknown {
    if (!(name in this.extensions)) this.extensions[name] = name === "WEBGL_lose_context" ? { loseContext } : null;
    return this.extensions[name];
  } };
  const backend = {
    isWebGLBackend: true,
    _onContextLost: onContextLost,
    ...(extensionCache ? { extensions } : {}),
    dispose(): void {
      const extension = extensions.get("WEBGL_lose_context") as { loseContext(): void } | null;
      if (extension !== null) extension.loseContext();
      canvas.removeEventListener("webglcontextlost", onContextLost);
    },
  };
  const renderer = {
    backend, domElement: canvas,
    dispose: vi.fn(async () => { backend.dispose(); await Promise.resolve(); }),
  };
  return { renderer, loseContext, onContextLost, canvas };
}

describe("handing a canvas to a replacement renderer", () => {
  it("releases a lost WebGL renderer completely without taking the shared context away", async () => {
    const { renderer, loseContext } = lostWebGLRenderer(true);
    await releaseLostWebGLRenderer(renderer);
    // r186 forgets every object it uploaded, so its stale listeners never reach GL again.
    expect(renderer.dispose).toHaveBeenCalledOnce();
    expect(loseContext).not.toHaveBeenCalled();
  });

  it("only lets go of the canvas when it cannot stop r186's loseContext()", async () => {
    const { renderer, loseContext, onContextLost, canvas } = lostWebGLRenderer(false);
    await releaseLostWebGLRenderer(renderer);
    expect(renderer.dispose).not.toHaveBeenCalled();
    expect(loseContext).not.toHaveBeenCalled();
    canvas.dispatchEvent(new Event("webglcontextlost"));
    expect(onContextLost).not.toHaveBeenCalled();
  });

  it("carries every base setting across, and hands R3F's store the new renderer", () => {
    const from = new WebGPURenderer({ forceWebGL: true });
    from.toneMapping = ACESFilmicToneMapping;
    from.toneMappingExposure = 0.8;
    from.outputColorSpace = "srgb-linear";
    from.sortObjects = false;
    from.autoClear = false;
    from.shadowMap.enabled = true;
    from.shadowMap.type = VSMShadowMap;
    from.setClearColor(new Color(0x204060), 0.5);
    from.info.autoReset = false;
    const to = new WebGPURenderer({ forceWebGL: true });
    expect(to.toneMapping).toBe(NoToneMapping);
    expect(to.shadowMap.type).toBe(PCFShadowMap);
    applyNativeRendererSettings(to, readNativeRendererSettings(from));
    expect(readNativeRendererSettings(to)).toEqual(readNativeRendererSettings(from));

    const set = vi.fn();
    replaceStoreRenderer({ set }, to);
    expect(set).toHaveBeenCalledExactlyOnceWith({ gl: to });
  });
});
