import type { ColorSpace } from "three";
import type { Camera, IndirectStorageBufferAttribute, Node, Renderer } from "three/webgpu";
import "three/addons/objects/GaussianSplat.js";
import "three/addons/gpgpu/CountingSort.js";

declare module "three/addons/gpgpu/CountingSort.js" {
  interface CountingSort { dispose(): void }
}

/** Additive public contract of patches/three@0.186.0.patch. */
declare module "three/addons/objects/GaussianSplat.js" {
  interface GaussianSplatCpuSortRequest {
    readonly modelViewMatrix: readonly number[];
    readonly nearDepth: number;
    readonly farDepth: number;
    readonly binCount: number;
  }
  interface GaussianSplatOptions {
    /** Actual device binding cap; oversized SH3 uses two exact contiguous views. */
    maxStorageBufferBindingSize?: number;
    opacityNode?: (index: Node<"uint">, center: Node<"vec3">) => Node<"float">;
    sphericalHarmonicsDirectionNode?: (index: Node<"uint">, direction: Node<"vec3">) => Node<"vec3">;
    colorSpace?: ColorSpace;
    kernelRadius?: number;
    /** Upstream compensates opacity for its 0.3 px² low-pass (default true). Pass
     *  false for sources trained without mip anti-aliasing (every native source). */
    antialias?: boolean;
    minSortIntervalMs?: number;
    cpuSort?: ((request: GaussianSplatCpuSortRequest) => void) | null;
  }
  interface GaussianSplat {
    minSortIntervalMs: number;
    cpuSort: ((request: GaussianSplatCpuSortRequest) => void) | null;
    /** WebGPU drawIndexedIndirect arguments, then the exact kept count: element 1 counts instances,
     *  each a batch of splats; element 5 is the splats the last GPU sort kept after culling. */
    readonly drawIndirect: IndirectStorageBufferAttribute;
    /** Splats in the source geometry (WebGL draws every one of them). */
    readonly splatCount: number;
    /** Copies a trusted sort permutation without transferring live GPU storage. */
    applySortOrder(order: Uint32Array): void;
    /** Restores main-camera CPU order before any asynchronous readback can yield. */
    withSynchronousSort<T>(renderer: Renderer, camera: Camera, draw: () => T): T;
    dispose(): void;
  }
}
