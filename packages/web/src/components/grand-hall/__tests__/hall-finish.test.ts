import { describe, expect, it } from "vitest";
import { FULL_HALL_FINISH, hallFinish, isSoftwareRenderer } from "../hall-finish.js";
import { nativeRendererGpuString } from "../../../lib/native-renderer.js";

const SWIFTSHADER = "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)";
const RTX = "ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)";

function webglBackend(renderer: string) {
  const info = { UNMASKED_VENDOR_WEBGL: 0x9245, UNMASKED_RENDERER_WEBGL: 0x9246 };
  return {
    isWebGLBackend: true,
    gl: {
      getExtension: (name: string) => (name === "WEBGL_debug_renderer_info" ? info : null),
      getParameter: (parameter: number) => (parameter === info.UNMASKED_RENDERER_WEBGL ? renderer : null),
    },
  };
}

describe("the Grand Hall's finish per device", () => {
  it("gives computers and tablets everything", () => {
    expect(hallFinish("desktop", false)).toEqual(FULL_HALL_FINISH);
    expect(hallFinish("tablet", false)).toEqual({ photoQuality: 1, liveLight: true });
  });

  it("gives phones the half-size photographs under the same light", () => {
    expect(hallFinish("phone", false)).toEqual({ photoQuality: 0.5, liveLight: true });
  });

  it("spares a software rasteriser the reflection map and the chandeliers' lights", () => {
    expect(hallFinish("desktop", true)).toEqual({ photoQuality: 0.5, liveLight: false });
  });

  it("knows a software rasteriser by its renderer string", () => {
    expect(isSoftwareRenderer(SWIFTSHADER)).toBe(true);
    expect(isSoftwareRenderer("llvmpipe (LLVM 15.0.7, 256 bits)")).toBe(true);
    expect(isSoftwareRenderer(RTX)).toBe(false);
    expect(isSoftwareRenderer("")).toBe(false);
    expect(isSoftwareRenderer(null)).toBe(false);
  });

  it("reads the renderer string from the canvas's own WebGL context, never WebGPU's", () => {
    expect(nativeRendererGpuString({ backend: webglBackend(SWIFTSHADER) })).toBe(SWIFTSHADER);
    expect(nativeRendererGpuString({ backend: { isWebGPUBackend: true } })).toBeNull();
    expect(nativeRendererGpuString({ backend: { isWebGLBackend: true, gl: null } })).toBeNull();
  });
});
