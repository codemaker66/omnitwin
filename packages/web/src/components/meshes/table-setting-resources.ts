import { createContext, useContext, useEffect, useMemo } from "react";
import {
  BoxGeometry,
  CylinderGeometry,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  TorusGeometry,
} from "three";
import { noClipPlanes } from "../SectionPlane.js";

// ---------------------------------------------------------------------------
// Dinner place-setting GPU resources — one geometry and one material per part,
// shared by every cover drawn at the same opacity.
//
// Each cover part is still its own mesh, deliberately. The planner's native
// renderer sorts the glass (transmissive), gilt rim and cutlery in ONE
// transparent list by per-object depth, and every glass refracts a backdrop
// copied when the first glass is drawn. Batching a part type into one
// instanced draw would change that interleaving and that backdrop, which is a
// visible change. Sharing resources removes the per-cover geometries,
// materials and material conversions without changing what is drawn or in
// which order.
//
// Shared materials must never be mutated for one table: every cover at this
// opacity would change with it.
// ---------------------------------------------------------------------------

export interface TableSettingPart<TGeometry, TMaterial> {
  readonly geometry: TGeometry;
  readonly material: TMaterial;
}

export interface TableSettingResources {
  /** The cover opacity these materials were built for. */
  readonly opacity: number;
  readonly plate: TableSettingPart<CylinderGeometry, MeshStandardMaterial>;
  readonly rim: TableSettingPart<TorusGeometry, MeshStandardMaterial>;
  readonly glass: TableSettingPart<CylinderGeometry, MeshPhysicalMaterial>;
  readonly knife: TableSettingPart<BoxGeometry, MeshStandardMaterial>;
  readonly fork: TableSettingPart<BoxGeometry, MeshStandardMaterial>;
}

function cutleryMaterial(opacity: number): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: "#d9d1bf",
    roughness: 0.28,
    metalness: 0.72,
    transparent: true,
    opacity: opacity * 0.86,
    clippingPlanes: noClipPlanes,
  });
}

export function createTableSettingResources(opacity: number): TableSettingResources {
  return {
    opacity,
    plate: {
      geometry: new CylinderGeometry(0.115, 0.115, 0.012, 36),
      material: new MeshStandardMaterial({
        color: "#f8f3e8",
        roughness: 0.56,
        metalness: 0.03,
        transparent: true,
        opacity,
        clippingPlanes: noClipPlanes,
      }),
    },
    rim: {
      geometry: new TorusGeometry(0.094, 0.004, 8, 36),
      material: new MeshStandardMaterial({
        color: "#d7b75a",
        roughness: 0.42,
        metalness: 0.35,
        transparent: true,
        opacity: opacity * 0.9,
        clippingPlanes: noClipPlanes,
      }),
    },
    glass: {
      geometry: new CylinderGeometry(0.026, 0.021, 0.105, 20),
      material: new MeshPhysicalMaterial({
        color: "#cfe7ff",
        roughness: 0.08,
        metalness: 0,
        transparent: true,
        opacity: opacity * 0.38,
        transmission: 0.45,
        thickness: 0.04,
        clippingPlanes: noClipPlanes,
      }),
    },
    knife: { geometry: new BoxGeometry(0.018, 0.012, 0.22), material: cutleryMaterial(opacity) },
    fork: { geometry: new BoxGeometry(0.018, 0.012, 0.19), material: cutleryMaterial(opacity) },
  };
}

export function disposeTableSettingResources(resources: TableSettingResources): void {
  for (const part of [resources.plate, resources.rim, resources.glass, resources.knife, resources.fork]) {
    part.geometry.dispose();
    part.material.dispose();
  }
}

/** Layout-level set shared by every cover drawn below the provider. */
export const TableSettingResourcesContext = createContext<TableSettingResources | null>(null);

interface ResourceSelection {
  readonly resources: TableSettingResources;
  readonly owned: boolean;
}

function useDisposeOwned(selection: ResourceSelection): void {
  useEffect(() => {
    if (!selection.owned) return undefined;
    return () => { disposeTableSettingResources(selection.resources); };
  }, [selection]);
}

/** A set owned by the calling component, disposed when it unmounts or `opacity` changes. */
export function useOwnedTableSettingResources(opacity: number): TableSettingResources {
  const selection = useMemo(
    (): ResourceSelection => ({ resources: createTableSettingResources(opacity), owned: true }),
    [opacity],
  );
  useDisposeOwned(selection);
  return selection.resources;
}

/**
 * The provided set when it was built for `opacity`; otherwise a set owned by
 * the caller, so a standalone cover (the dressing ghost) still shares one set
 * across its own settings.
 */
export function useTableSettingResources(opacity: number): TableSettingResources {
  const provided = useContext(TableSettingResourcesContext);
  const shared = provided?.opacity === opacity ? provided : null;
  const selection = useMemo(
    (): ResourceSelection => (shared === null
      ? { resources: createTableSettingResources(opacity), owned: true }
      : { resources: shared, owned: false }),
    [opacity, shared],
  );
  useDisposeOwned(selection);
  return selection.resources;
}
