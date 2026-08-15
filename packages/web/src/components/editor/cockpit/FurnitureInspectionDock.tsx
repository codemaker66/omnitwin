import { type ReactElement, useEffect } from "react";
import type { PlacedItem } from "../../../lib/placement.js";
import { getCatalogueItem, type CatalogueItem } from "../../../lib/catalogue.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { useSelectionStore } from "../../../stores/selection-store.js";
import { useFurnitureInspectionStore } from "../../../stores/furniture-inspection-store.js";
import { isSceneFurniturePlacement } from "../../../lib/table-dressing.js";
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
  if (catalogueItem === undefined || !isGeneratedFurnitureSlug(catalogueItem.slug)) {
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
        <p className="furniture-inspection__eyebrow">Generated visual stand-in</p>
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

/** Persistent disclosure whenever a generated visual stand-in is in the plan. */
export function GeneratedFurnitureProxyBadge(): ReactElement | null {
  const placedItems = usePlacementStore((state) => state.placedItems);
  const generatedCount = placedItems.reduce((count, placed) => {
    if (!isSceneFurniturePlacement(placed)) return count;
    const item = getCatalogueItem(placed.catalogueItemId);
    return item !== undefined && isGeneratedFurnitureSlug(item.slug) ? count + 1 : count;
  }, 0);

  if (generatedCount === 0) return null;
  const noun = generatedCount === 1 ? "proxy" : "proxies";
  const standIn = generatedCount === 1 ? "stand-in" : "stand-ins";
  return (
    <p
      className="generated-furniture-proxy-badge"
      data-testid="generated-furniture-proxy-badge"
      role="status"
    >
      AI-generated furniture {noun} · visual {standIn} · not measured
    </p>
  );
}
