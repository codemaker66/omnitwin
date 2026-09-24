import { useCallback, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Group, Material, Mesh, Object3D } from "three";
import {
  getSurfaceOpacity,
  useVisibilityStore,
  type SurfaceKey,
} from "../stores/visibility-store.js";
import { useXrayStore } from "../stores/xray-store.js";
import { applyXrayOpacity } from "../lib/xray.js";
import { skipDescendantRaycast } from "../lib/raycast-gate.js";
import { OPAQUE_OPACITY, authoredOpacity } from "../lib/material-opacity.js";
import {
  stepWallAssemblyOpacity,
  wallAssemblyTargetFromBaseOpacity,
  wallKeyFromSurfaceKey,
} from "../lib/surface-visibility-group.js";

interface SurfaceVisibilityGroupProps {
  readonly surfaceKey: SurfaceKey;
  readonly name: string;
  readonly children: React.ReactNode;
  /**
   * Optional cheaper stand-in (e.g. merged draw batches) drawn instead of
   * `children` while the surface is fully opaque. It must render identically
   * in that state, including any translucent pieces (window glass), which
   * blend even then. `children` remain the canonical content: they are drawn
   * whenever the surface itself is faded (fades, clicked-open walls, x-ray),
   * where three's per-object depth sort sets the blending order, and on the
   * surface's first visible frame, so their buffers are resident before any
   * fade. The stand-in never receives raycasts; `children` still do.
   */
  readonly opaqueStandIn?: React.ReactNode;
}

/**
 * Shows the stand-in or the per-mesh children for the surface opacity last
 * applied to the materials. The stand-in is an exact replacement only while
 * the surface is fully opaque. Returns true when the per-mesh children were
 * just drawn for the first time and the next frame will switch to the stand-in.
 */
function selectSurfaceRepresentation(
  standIn: Group | null,
  perMesh: Group | null,
  surfaceVisible: boolean,
  appliedOpacity: number,
  perMeshDrawn: { current: boolean },
): boolean {
  if (standIn === null || perMesh === null) return false;
  const opaque = appliedOpacity >= OPAQUE_OPACITY;
  const useStandIn = opaque && perMeshDrawn.current;
  standIn.visible = useStandIn;
  perMesh.visible = !useStandIn;
  if (useStandIn || !surfaceVisible || perMeshDrawn.current) return false;
  perMeshDrawn.current = true;
  return opaque;
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

/**
 * Each material's authored opacity, read the first time a surface fades it,
 * before any fade has changed it.
 */
const authoredOpacities = new WeakMap<Material, number>();

function authoredOpacityOf(material: Material): number {
  let opacity = authoredOpacities.get(material);
  if (opacity === undefined) {
    opacity = authoredOpacity(material.transparent, material.opacity);
    authoredOpacities.set(material, opacity);
  }
  return opacity;
}

/**
 * Fades materials with their surface: each draws at its authored opacity
 * times `surfaceOpacity`, so translucent pieces such as window glass keep
 * their own opacity on a fully opaque surface and fade with it.
 */
export function setSurfaceOpacity(material: Material | readonly Material[], surfaceOpacity: number): void {
  if (isMaterialArray(material)) {
    for (const item of material) {
      setSurfaceOpacity(item, surfaceOpacity);
    }
    return;
  }

  // Opacity is read as a uniform every frame. Only a change of blending mode
  // needs a material rebuild; flagging every fade step made the renderer
  // re-key each wall material on every frame of an orbit.
  const opacity = authoredOpacityOf(material) * surfaceOpacity;
  const transparent = opacity < OPAQUE_OPACITY;
  material.opacity = opacity;
  if (material.transparent !== transparent) {
    material.transparent = transparent;
    material.needsUpdate = true;
  }
}

function applyTreeOpacity(root: Object3D, surfaceOpacity: number): void {
  const visible = surfaceOpacity > 0.01;
  root.visible = visible;
  root.traverse((child) => {
    if (child instanceof Mesh) {
      child.visible = visible;
      const material = materialFromUnknown(child.material);
      if (material !== null) {
        setSurfaceOpacity(material, surfaceOpacity);
      }
    }
  });
}

export {
  stepWallAssemblyOpacity,
  wallAssemblyTargetFromBaseOpacity,
  wallKeyFromSurfaceKey,
} from "../lib/surface-visibility-group.js";

export function SurfaceVisibilityGroup({
  surfaceKey,
  name,
  children,
  opaqueStandIn,
}: SurfaceVisibilityGroupProps): React.ReactElement {
  const groupRef = useRef<Group>(null);
  const standInRef = useRef<Group | null>(null);
  const perMeshRef = useRef<Group>(null);
  const perMeshDrawn = useRef(false);
  const assemblyOpacity = useRef<number | null>(null);
  const lastOpacity = useRef<number | null>(null);
  const { invalidate } = useThree();
  const attachStandIn = useCallback((standIn: Group | null) => {
    standInRef.current = standIn;
    if (standIn !== null) standIn.raycast = skipDescendantRaycast;
  }, []);

  useFrame((_state, delta) => {
    const group = groupRef.current;
    if (group === null) return;

    const { wallOpacity, wallLocks, ceiling, dome } = useVisibilityStore.getState();
    const baseOpacity = getSurfaceOpacity(surfaceKey, wallOpacity, ceiling, dome);
    const wallKey = wallKeyFromSurfaceKey(surfaceKey);
    const isClickAnimatingWall = wallKey !== null && wallLocks[wallKey];

    let localOpacity = baseOpacity;
    if (isClickAnimatingWall) {
      const target = wallAssemblyTargetFromBaseOpacity(baseOpacity);
      const current = assemblyOpacity.current ?? baseOpacity;
      localOpacity = stepWallAssemblyOpacity(current, target, delta);
      assemblyOpacity.current = localOpacity;
      if (Math.abs(localOpacity - target) > 0.001) {
        invalidate();
      }
    } else {
      assemblyOpacity.current = baseOpacity;
    }

    const opacity = applyXrayOpacity(surfaceKey, localOpacity, useXrayStore.getState().opacity);

    if (lastOpacity.current !== null && Math.abs(lastOpacity.current - opacity) < 0.001) {
      if (selectSurfaceRepresentation(standInRef.current, perMeshRef.current, group.visible, lastOpacity.current, perMeshDrawn)) {
        invalidate();
      }
      return;
    }

    lastOpacity.current = opacity;
    applyTreeOpacity(group, opacity);
    selectSurfaceRepresentation(standInRef.current, perMeshRef.current, group.visible, opacity, perMeshDrawn);
    invalidate();
  });

  return (
    <group ref={groupRef} name={name}>
      {opaqueStandIn === undefined ? children : (
        <>
          <group ref={attachStandIn} name={`${name}-opaque-stand-in`}>
            {opaqueStandIn}
          </group>
          <group ref={perMeshRef} name={`${name}-per-mesh`}>
            {children}
          </group>
        </>
      )}
    </group>
  );
}
