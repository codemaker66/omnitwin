import {
  Color,
  type Material,
  type Mesh,
  type Object3D,
} from "three";

import type { FurniturePresentationRuntime } from "../../../lib/furniture-presentation-runtime.js";

const SELECTED_EMISSIVE_COLOR = new Color("#c9a84c");
const SELECTED_EMISSIVE_INTENSITY = 0.45;

export interface GeneratedFurnitureAppearance {
  readonly opacity: number;
  readonly colorOverride?: string;
  readonly selectedPartId?: string | null;
}

export interface GeneratedFurnitureAppearanceController {
  apply(appearance: GeneratedFurnitureAppearance): void;
  restore(): void;
}

interface MaterialSnapshot {
  readonly opacity: number;
  readonly transparent: boolean;
  readonly depthWrite: boolean;
  readonly color: Color | null;
  readonly emissive: Color | null;
  readonly emissiveIntensity: number | null;
}

interface CapturedMesh {
  readonly mesh: FurnitureMesh;
  readonly originalMaterial: Material | Material[];
  readonly partId: string | null;
}

interface SelectedMaterialClone {
  readonly original: Material;
  readonly clone: Material;
}

interface SelectedMeshMaterials {
  readonly mesh: FurnitureMesh;
  readonly originalMaterial: Material | Material[];
  readonly clones: readonly SelectedMaterialClone[];
}

type FurnitureMesh = Mesh;
type ColorMaterial = Material & { readonly color: Color };
type EmissiveMaterial = Material & {
  readonly emissive: Color;
  emissiveIntensity: number;
};

function isFurnitureMesh(object: Object3D): object is FurnitureMesh {
  return (object as { readonly isMesh?: boolean }).isMesh === true;
}

function hasColor(material: Material): material is ColorMaterial {
  return (material as { readonly color?: unknown }).color instanceof Color;
}

function hasEmissive(material: Material): material is EmissiveMaterial {
  const candidate = material as {
    readonly emissive?: unknown;
    readonly emissiveIntensity?: unknown;
  };
  return candidate.emissive instanceof Color
    && typeof candidate.emissiveIntensity === "number";
}

function snapshotMaterial(material: Material): MaterialSnapshot {
  return {
    opacity: material.opacity,
    transparent: material.transparent,
    depthWrite: material.depthWrite,
    color: hasColor(material) ? material.color.clone() : null,
    emissive: hasEmissive(material) ? material.emissive.clone() : null,
    emissiveIntensity: hasEmissive(material) ? material.emissiveIntensity : null,
  };
}

function applyMaterialAppearance(
  material: Material,
  snapshot: MaterialSnapshot,
  appearance: GeneratedFurnitureAppearance,
  selected: boolean,
): void {
  const opacity = Math.min(1, Math.max(0, appearance.opacity));
  const nextTransparent = snapshot.transparent || opacity < 1;
  material.opacity = snapshot.opacity * opacity;
  material.depthWrite = opacity < 1 ? false : snapshot.depthWrite;
  if (material.transparent !== nextTransparent) {
    material.transparent = nextTransparent;
    material.needsUpdate = true;
  }

  if (hasColor(material) && snapshot.color !== null) {
    material.color.copy(snapshot.color);
    if (appearance.colorOverride !== undefined) {
      material.color.set(appearance.colorOverride);
    }
  }
  if (hasEmissive(material) && snapshot.emissive !== null) {
    material.emissive.copy(selected ? SELECTED_EMISSIVE_COLOR : snapshot.emissive);
    material.emissiveIntensity = selected
      ? Math.max(snapshot.emissiveIntensity ?? 0, SELECTED_EMISSIVE_INTENSITY)
      : (snapshot.emissiveIntensity ?? 0);
  }
}

/** Capture and reversibly drive only presentation material state. */
export function createGeneratedFurnitureAppearanceController(
  root: Object3D,
  presentation: FurniturePresentationRuntime,
): GeneratedFurnitureAppearanceController {
  const snapshots = new Map<Material, MaterialSnapshot>();
  const capturedMeshes: CapturedMesh[] = [];
  let selectedPartId: string | null = null;
  let selectedMeshes: SelectedMeshMaterials[] = [];

  root.traverse((object) => {
    if (!isFurnitureMesh(object)) return;
    const partId = presentation.resolveInspectionPart(object)?.id ?? null;
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) {
      if (!snapshots.has(material)) snapshots.set(material, snapshotMaterial(material));
    }
    capturedMeshes.push({ mesh: object, originalMaterial: object.material, partId });
  });

  const clearSelectedMaterials = (): void => {
    const clones = new Set<Material>();
    for (const selected of selectedMeshes) {
      selected.mesh.material = selected.originalMaterial;
      for (const pair of selected.clones) clones.add(pair.clone);
    }
    for (const clone of clones) clone.dispose();
    selectedMeshes = [];
    selectedPartId = null;
  };

  const selectPart = (nextPartId: string | null): void => {
    if (nextPartId === selectedPartId) return;
    clearSelectedMaterials();
    if (nextPartId === null) return;
    selectedMeshes = capturedMeshes
      .filter((captured) => captured.partId === nextPartId)
      .map((captured): SelectedMeshMaterials => {
        const originals = Array.isArray(captured.originalMaterial)
          ? captured.originalMaterial
          : [captured.originalMaterial];
        const clones = originals.map((original) => ({
          original,
          clone: original.clone(),
        }));
        captured.mesh.material = Array.isArray(captured.originalMaterial)
          ? clones.map((pair) => pair.clone)
          : (clones[0]?.clone ?? captured.originalMaterial);
        return {
          mesh: captured.mesh,
          originalMaterial: captured.originalMaterial,
          clones,
        };
      });
    selectedPartId = nextPartId;
  };

  const apply = (appearance: GeneratedFurnitureAppearance): void => {
    const nextSelectedPartId = appearance.selectedPartId ?? null;
    selectPart(nextSelectedPartId);
    for (const [material, snapshot] of snapshots) {
      applyMaterialAppearance(material, snapshot, appearance, false);
    }
    for (const selected of selectedMeshes) {
      for (const pair of selected.clones) {
        const snapshot = snapshots.get(pair.original);
        if (snapshot !== undefined) {
          applyMaterialAppearance(pair.clone, snapshot, appearance, true);
        }
      }
    }
  };

  const restore = (): void => {
    clearSelectedMaterials();
    apply({ opacity: 1, selectedPartId: null });
  };

  return { apply, restore };
}
