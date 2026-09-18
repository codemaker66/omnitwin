import type { ColorSpace } from "three";
import type { Node } from "three/webgpu";
import "three/addons/objects/GaussianSplat.js";

/** Additive public contract of patches/three@0.186.0.patch. */
declare module "three/addons/objects/GaussianSplat.js" {
  interface GaussianSplatOptions {
    opacityNode?: (index: Node<"uint">, center: Node<"vec3">) => Node<"float">;
    sphericalHarmonicsDirectionNode?: (index: Node<"uint">, direction: Node<"vec3">) => Node<"vec3">;
    colorSpace?: ColorSpace;
    kernelRadius?: number;
    minSortIntervalMs?: number;
  }
  interface GaussianSplat {
    minSortIntervalMs: number;
    dispose(): void;
  }
}
