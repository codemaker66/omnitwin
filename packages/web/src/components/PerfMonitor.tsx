import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import type { Camera, Scene, WebGLRenderer } from "three";
import type { WebGPURenderer } from "three/webgpu";

declare global {
  interface Window {
    /** DEV-only perf bridge published by {@link PerfMonitor}; absent in production. */
    __venPerf?: { gl: WebGLRenderer | WebGPURenderer; scene: Scene; camera: Camera };
  }
}

/**
 * Development renderer bridge. Actual profiling belongs to NativeCanvas's
 * successful draw boundary: R3F callbacks can run without a paced draw.
 */
export function PerfMonitor(): null {
  const { gl, scene, camera } = useThree();

  // DEV-only debug bridge: publish the live renderer/scene/camera so perf
  // experiments (frame-timing, draw-call inspection) can run from the browser
  // console. This component only mounts under import.meta.env.DEV, so the
  // bridge never exists in production builds.
  useEffect(() => {
    window.__venPerf = { gl, scene, camera };
    return () => { delete window.__venPerf; };
  }, [gl, scene, camera]);

  return null;
}
