import { Box3, Color, Group, Material, type Mesh, type Object3D, Vector3 } from "three";
import { toRenderSpace } from "../constants/scale.js";
import { noClipPlanes } from "../components/SectionPlane.js";

const importedMaterials = new WeakSet<Material>();

/** Imported materials must retain their full identity, including every PBR map. */
export function isImportedFurnitureMaterial(material: Material): boolean {
  return importedMaterials.has(material);
}

interface FurnitureDimensions {
  readonly slug?: string;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

export interface GltfFurnitureInstance {
  readonly object: Group;
  readonly setAppearance: (opacity: number, colorOverride?: string) => void;
  /** Disposes owned materials only. The useGLTF cache owns geometry and textures. */
  readonly dispose: () => void;
}

function isMesh(object: Object3D): object is Mesh {
  return (object as { readonly isMesh?: boolean }).isMesh === true;
}

function materialColor(material: Material): Color | undefined {
  return "color" in material && material.color instanceof Color ? material.color : undefined;
}

/** Build one isolated presentation of a cached static furniture asset. */
export function createGltfFurnitureInstance(
  source: Object3D,
  dimensions: FurnitureDimensions,
): GltfFurnitureInstance {
  const bounds = new Box3().setFromObject(source);
  const size = bounds.getSize(new Vector3());
  const target = [toRenderSpace(dimensions.width), dimensions.height, toRenderSpace(dimensions.depth)];
  if (bounds.isEmpty() || [...size.toArray(), ...target].some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error("Imported furniture has invalid bounds or catalogue dimensions");
  }
  const uniformScale = Math.min(
    toRenderSpace(dimensions.width) / size.x,
    dimensions.height / size.y,
    toRenderSpace(dimensions.depth) / size.z,
  );
  const centre = bounds.getCenter(new Vector3());
  const object = new Group();
  object.name = "imported-furniture-model";
  object.scale.setScalar(uniformScale);
  object.position.set(-centre.x * uniformScale, -bounds.min.y * uniformScale, -centre.z * uniformScale);
  // The supplied chairs are authored facing +Z (Turini provenance and mesh
  // backrest geometry). Planner
  // poses and the loading/error ChairMesh use -Z as the seated forward axis.
  // Normalize only the model, retaining saved poses and the cached source.
  if (dimensions.slug === "burgess-turini-18-3" || dimensions.slug === "checked-banquet-chair") {
    object.rotation.y = Math.PI;
    object.position.applyAxisAngle(new Vector3(0, 1, 0), Math.PI);
  }
  const clone = source.clone(true);
  object.add(clone);
  const materials = new Map<Material, Material>();
  const cloneMaterial = (original: Material): Material => {
    const existing = materials.get(original);
    if (existing !== undefined) return existing;
    const cloned = original.clone();
    cloned.clippingPlanes = noClipPlanes;
    importedMaterials.add(cloned);
    materials.set(original, cloned);
    return cloned;
  };
  try {
    clone.traverse((child) => {
      if (!isMesh(child)) return;
      child.material = Array.isArray(child.material)
        ? child.material.map(cloneMaterial)
        : cloneMaterial(child.material);
      child.castShadow = true;
      child.receiveShadow = true;
    });
  } catch (error: unknown) {
    for (const material of materials.values()) material.dispose();
    throw error;
  }
  return {
    object,
    setAppearance(opacity, colorOverride) {
      const multiplier = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1;
      for (const [original, material] of materials) {
        const colour = materialColor(material);
        const originalColour = materialColor(original);
        if (colour !== undefined && originalColour !== undefined) {
          colour.copy(originalColour);
          if (colorOverride !== undefined) colour.set(colorOverride);
        }
        material.opacity = original.opacity * multiplier;
        material.depthWrite = multiplier < 1 ? false : original.depthWrite;
        const transparent = original.transparent || multiplier < 1;
        if (material.transparent !== transparent) {
          material.transparent = transparent;
          material.needsUpdate = true;
        }
      }
    },
    dispose() {
      for (const material of materials.values()) material.dispose();
    },
  };
}
