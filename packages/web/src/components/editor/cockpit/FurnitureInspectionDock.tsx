import { type ReactElement, useEffect } from "react";
import type { PlacedItem } from "../../../lib/placement.js";
import { getCatalogueItem, type CatalogueItem } from "../../../lib/catalogue.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { useSelectionStore } from "../../../stores/selection-store.js";
import { useFurnitureInspectionStore } from "../../../stores/furniture-inspection-store.js";
import { isSceneFurniturePlacement } from "../../../lib/table-dressing.js";
import { drawsGeneratedProxy } from "../../FurnitureProxy.js";
import {
  isGeneratedFurnitureSlug,
  type GeneratedFurnitureSlug,
} from "../../meshes/generated/generatedFurnitureRegistry.js";
import "./FurnitureInspectionDock.css";

export interface SelectedGeneratedFurniture {
  readonly placed: PlacedItem;
  readonly catalogueItem: CatalogueItem;
  readonly slug: GeneratedFurnitureSlug;
}

/** Resolve one exact generated-proxy selection without changing planner state. */
export function selectedGeneratedFurniture(
  placedItems: readonly PlacedItem[],
  selectedIds: ReadonlySet<string>,
): SelectedGeneratedFurniture | null {
  if (selectedIds.size !== 1) return null;
  const selectedId = selectedIds.values().next().value;
  if (selectedId === undefined) return null;
  const placed = placedItems.find((candidate) => candidate.id === selectedId);
  if (placed === undefined || !isSceneFurniturePlacement(placed)) return null;
  const catalogueItem = getCatalogueItem(placed.catalogueItemId);
  if (catalogueItem === undefined || !drawsGeneratedProxy(catalogueItem) || !isGeneratedFurnitureSlug(catalogueItem.slug)) {
    return null;
  }
  return { placed, catalogueItem, slug: catalogueItem.slug };
}

export function useSelectedGeneratedFurniture(): SelectedGeneratedFurniture | null {
  const placedItems = usePlacementStore((state) => state.placedItems);
  const selectedIds = useSelectionStore((state) => state.selectedIds);
  return selectedGeneratedFurniture(placedItems, selectedIds);
}

function displayPartName(partId: string): string {
  return partId
    .split("-")
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

export function FurnitureInspectionDock({
  selection,
}: {
  readonly selection: SelectedGeneratedFurniture;
}): ReactElement {
  const inspectedPlacedItemId = useFurnitureInspectionStore(
    (state) => state.inspectedPlacedItemId,
  );
  const selectedGeneratedPartId = useFurnitureInspectionStore(
    (state) => state.selectedGeneratedPartId,
  );
  const explodeProgress = useFurnitureInspectionStore((state) => state.explodeProgress);
  const openInspection = useFurnitureInspectionStore((state) => state.openInspection);
  const closeInspection = useFurnitureInspectionStore((state) => state.closeInspection);
  const setExplodeProgress = useFurnitureInspectionStore(
    (state) => state.setExplodeProgress,
  );
  const toggleExploded = useFurnitureInspectionStore((state) => state.toggleExploded);
  const inspectionActive = inspectedPlacedItemId === selection.placed.id;
  const explodePercent = Math.round(explodeProgress * 100);

  useEffect(() => () => {
    closeInspection();
  }, [closeInspection, selection.placed.id]);

  return (
    <aside
      className="cockpit-panel furniture-inspection"
      data-testid="furniture-inspection-dock"
      data-inspection-active={String(inspectionActive)}
      aria-label="Generated furniture inspection"
    >
      <header className="furniture-inspection__header">
        <h2>{selection.catalogueItem.name}</h2>
        <p className="furniture-inspection__status">
          AI-generated proxy — presentation only
        </p>
      </header>

      <section className="furniture-inspection__card" aria-label="Model provenance">
        <dl>
          <div>
            <dt>Source</dt>
            <dd>ImageGen-derived visual reference</dd>
          </div>
          <div>
            <dt>Geometry</dt>
            <dd>Procedural planning proxy</dd>
          </div>
          <div>
            <dt>Authority</dt>
            <dd>Planning visual — not measured venue evidence</dd>
          </div>
        </dl>
      </section>

      {!inspectionActive ? (
        <button
          className="furniture-inspection__primary"
          type="button"
          onClick={() => { openInspection(selection.placed.id); }}
        >
          Inspect generated parts
        </button>
      ) : (
        <>
          <section className="furniture-inspection__card furniture-inspection__controls">
            <div className="furniture-inspection__control-label">
              <label htmlFor="generated-furniture-explode">Explode assembly</label>
              <output htmlFor="generated-furniture-explode">{explodePercent}%</output>
            </div>
            <input
              id="generated-furniture-explode"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={explodeProgress}
              aria-valuetext={`${String(explodePercent)}% separated`}
              onChange={(event) => {
                setExplodeProgress(Number(event.currentTarget.value));
              }}
            />
            <button
              className="furniture-inspection__secondary"
              type="button"
              aria-pressed={explodeProgress > 0}
              onClick={toggleExploded}
            >
              {explodeProgress > 0 ? "Collapse assembly" : "Explode assembly"}
            </button>
          </section>

          <section className="furniture-inspection__card" aria-live="polite">
            <p className="furniture-inspection__card-label">Selected part</p>
            <strong>
              {selectedGeneratedPartId === null
                ? "Click a model part in the scene"
                : displayPartName(selectedGeneratedPartId)}
            </strong>
          </section>

          <button
            className="furniture-inspection__quiet"
            type="button"
            onClick={closeInspection}
          >
            Exit inspection
          </button>
        </>
      )}

      <p className="furniture-inspection__camera-help">
        Right-drag to orbit · wheel or pinch to zoom · middle-drag to pan
      </p>
    </aside>
  );
}

/**
 * The stand-in line ("AI-generated furniture proxy · visual stand-in · not
 * measured") is retired: Blake decided on 26 Oct 2026 that nobody sees it, and
 * that the furniture itself should carry accurate sizes (T-674, QoL F-15). It
 * renders nothing until lane P's App.tsx stops mounting it.
 */
export function GeneratedFurnitureProxyBadge(): null {
  return null;
}
