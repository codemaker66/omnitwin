import { describe, expect, it } from "vitest";
import { nativeDrawingBackend } from "../native-renderer.js";

const RTX = "ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11 vs_5_0 ps_5_0, D3D11)";

/** A native renderer as far as the reader looks: its marker and its backend. */
function renderer(backend: object): object {
  return { isWebGPURenderer: true, backend };
}

function webglBackend(gpu: string | null): object {
  const info = { UNMASKED_VENDOR_WEBGL: 0x9245, UNMASKED_RENDERER_WEBGL: 0x9246 };
  return {
    isWebGLBackend: true,
    gl: {
      getExtension: (name: string) => (name === "WEBGL_debug_renderer_info" && gpu !== null ? info : null),
      getParameter: (parameter: number) => (parameter === info.UNMASKED_RENDERER_WEBGL ? gpu : null),
    },
  };
}

describe("the backend a renderer draws with", () => {
  it("is WebGPU once the backend holds its device, named by that device's own adapter", () => {
    const adapterInfo = { vendor: "nvidia", architecture: "lovelace", description: "NVIDIA GeForce RTX 4090" };
    expect(nativeDrawingBackend(renderer({ isWebGPUBackend: true, device: { adapterInfo } })))
      .toEqual({ backend: "webgpu", gpu: "nvidia lovelace NVIDIA GeForce RTX 4090" });
    // A browser may leave parts of the adapter's description empty, or give the device none.
    expect(nativeDrawingBackend(renderer({ isWebGPUBackend: true, device: { adapterInfo: { vendor: "nvidia", architecture: "", description: "" } } })))
      .toEqual({ backend: "webgpu", gpu: "nvidia" });
    expect(nativeDrawingBackend(renderer({ isWebGPUBackend: true, device: { adapterInfo: { vendor: "", architecture: "", description: "" } } })))
      .toEqual({ backend: "webgpu", gpu: null });
    expect(nativeDrawingBackend(renderer({ isWebGPUBackend: true, device: {} }))).toEqual({ backend: "webgpu", gpu: null });
  });

  it("is not WebGPU before the backend has a device: the renderer may yet fall back to WebGL2", () => {
    expect(nativeDrawingBackend(renderer({ isWebGPUBackend: true, device: null }))).toBeNull();
    expect(nativeDrawingBackend(renderer({ isWebGPUBackend: true }))).toBeNull();
  });

  it("is WebGL2 where the renderer fell back, named by its own context", () => {
    expect(nativeDrawingBackend(renderer(webglBackend(RTX)))).toEqual({ backend: "webgl2", gpu: RTX });
    expect(nativeDrawingBackend(renderer(webglBackend(null)))).toEqual({ backend: "webgl2", gpu: null });
  });

  it("is unknown without a native renderer, or with a backend it does not know", () => {
    expect(nativeDrawingBackend(null)).toBeNull();
    expect(nativeDrawingBackend({ backend: { isWebGPUBackend: true, device: {} } })).toBeNull();
    expect(nativeDrawingBackend(renderer({}))).toBeNull();
  });
});
