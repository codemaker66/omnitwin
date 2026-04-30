import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Group, Material, Mesh, Object3D } from "three";
import {
  getSurfaceOpacity,
  useVisibilityStore,
  type SurfaceKey,
} from "../stores/visibility-store.js";
import { useXrayStore } from "../stores/xray-store.js";
import { applyXrayOpacity } from "../lib/xray.js";

interface SurfaceVisibilityGroupProps {
  readonly surfaceKey: SurfaceKey;
  readonly name: string;
  readonly children: React.ReactNode;
}

function isMaterialArray(material: Material | readonly Material[]): material is readonly Material[] {
  return Array.isArray(material);
}

function materialFromUnknown(value: unknown): Material | readonly Material[] | null {
  if (value instanceof Material) {
    return value;
  }
  if (Array.isArray(value) && value.every((item): item is Material => item instanceof Material)) {
    return value;
  }
  return null;
}

function setMaterialOpacity(material: Material | readonly Material[], opacity: number): void {
  if (isMaterialArray(material)) {
    for (const item of material) {
      setMaterialOpacity(item, opacity);
    }
    return;
  }

  material.transparent = opacity < 0.999;
  material.opacity = opacity;
  material.needsUpdate = true;
}

function applyTreeOpacity(root: Object3D, opacity: number): void {
  const visible = opacity > 0.01;
  root.visible = visible;
  root.traverse((child) => {
    if (child instanceof Mesh) {
      child.visible = visible;
      const material = materialFromUnknown(child.material);
      if (material !== null) {
        setMaterialOpacity(material, opacity);
      }
    }
  });
}

export function SurfaceVisibilityGroup({
  surfaceKey,
  name,
  children,
}: SurfaceVisibilityGroupProps): React.ReactElement {
  const groupRef = useRef<Group>(null);
  const lastOpacity = useRef<number | null>(null);
  const { invalidate } = useThree();

  useFrame(() => {
    const group = groupRef.current;
    if (group === null) return;

    const { wallOpacity, ceiling, dome } = useVisibilityStore.getState();
    const baseOpacity = getSurfaceOpacity(surfaceKey, wallOpacity, ceiling, dome);
    const opacity = applyXrayOpacity(surfaceKey, baseOpacity, useXrayStore.getState().opacity);

    if (lastOpacity.current !== null && Math.abs(lastOpacity.current - opacity) < 0.001) {
      return;
    }

    lastOpacity.current = opacity;
    applyTreeOpacity(group, opacity);
    invalidate();
  });

  return (
    <group ref={groupRef} name={name}>
      {children}
    </group>
  );
}
