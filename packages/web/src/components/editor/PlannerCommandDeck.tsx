import { memo, useMemo } from "react";
import type { ReactNode } from "react";
import {
  Armchair,
  Camera,
  CircleSlash,
  Group,
  LayoutGrid,
  MousePointer2,
  Paintbrush,
  PenLine,
  Sparkles,
  Trash2,
  Ungroup,
  Utensils,
} from "lucide-react";
import { getCatalogueItem, getCatalogueItemBySlug } from "../../lib/catalogue.js";
import { dispatchPlannerToolbarCommand } from "../../lib/planner-toolbar-events.js";
import { useBookmarkStore } from "../../stores/bookmark-store.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useMarkupStore } from "../../stores/markup-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";

interface CommandAction {
  readonly id: string;
  readonly label: string;
  readonly ariaLabel: string;
  readonly tone?: "primary" | "danger";
  readonly icon: ReactNode;
  readonly onClick: () => void;
  readonly disabled?: boolean;
}

interface CommandDeckCopy {
  readonly kicker: string;
  readonly title: string;
  readonly detail: string;
  readonly metric: string;
}

function selectedCopy(
  selectedCount: number,
  tableCount: number,
  chairCount: number,
): CommandDeckCopy {
  if (selectedCount === 1 && tableCount === 1) {
    return {
      kicker: "Selection",
      title: "Table selected",
      detail: "Dress it, move it, or group the surrounding seats without opening another panel.",
      metric: "Table controls ready",
    };
  }
  if (selectedCount === 1 && chairCount === 1) {
    return {
      kicker: "Selection",
      title: "Seat selected",
      detail: "Drag to move, right-click to name the seat, or turn it into a saved POV.",
      metric: "Seat planning",
    };
  }
  return {
    kicker: "Selection",
    title: `${selectedCount.toLocaleString("en-GB")} items selected`,
    detail: "Move as one, group for layout integrity, or remove the set in one command.",
    metric: selectedCount > 1 ? "Batch edit" : "Ready",
  };
}

function makeButton(action: CommandAction): React.ReactElement {
  return (
    <button
      key={action.id}
      type="button"
      aria-label={action.ariaLabel}
      data-testid={`planner-command-action-${action.id}`}
      className={`planner-command-deck__button planner-command-deck__button--${action.tone ?? "default"}`}
      onClick={action.onClick}
      disabled={action.disabled === true}
    >
      {action.icon}
      <span>{action.label}</span>
    </button>
  );
}

export const PlannerCommandDeck = memo(function PlannerCommandDeck(): React.ReactElement {
  const catalogueSelectedId = useCatalogueStore((s) => s.selectedItemId);
  const drawerOpen = useCatalogueStore((s) => s.drawerOpen);
  const markupActive = useMarkupStore((s) => s.active);
  const markupStrokeCount = useMarkupStore((s) => s.strokes.length);
  const activeReferenceId = useBookmarkStore((s) => s.activeReferenceId);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const placedItems = usePlacementStore((s) => s.placedItems);
  const snapEnabled = usePlacementStore((s) => s.snapEnabled);

  const selectedItems = useMemo(
    () => placedItems.filter((item) => selectedIds.has(item.id)),
    [placedItems, selectedIds],
  );
  const selectedCount = selectedItems.length;
  const selectedIdSet = useMemo(
    () => new Set(selectedItems.map((item) => item.id)),
    [selectedItems],
  );
  const selectedTableIds = useMemo(
    () => selectedItems
      .filter((item) => getCatalogueItem(item.catalogueItemId)?.category === "table")
      .map((item) => item.id),
    [selectedItems],
  );
  const tableCount = selectedTableIds.length;
  const chairCount = useMemo(
    () => selectedItems.filter((item) => getCatalogueItem(item.catalogueItemId)?.category === "chair").length,
    [selectedItems],
  );
  const selectedCatalogue = catalogueSelectedId === null ? undefined : getCatalogueItem(catalogueSelectedId);

  const state = useMemo((): { readonly copy: CommandDeckCopy; readonly actions: readonly CommandAction[] } => {
    if (markupActive) {
      return {
        copy: {
          kicker: "Laser diagram",
          title: "Draw planning notes on the floor",
          detail: "Gold strokes stay local to this layout and avoid moving furniture while you sketch.",
          metric: `${markupStrokeCount.toLocaleString("en-GB")} stroke${markupStrokeCount === 1 ? "" : "s"}`,
        },
        actions: [
          {
            id: "finish-drawing",
            label: "Done",
            ariaLabel: "Finish drawing",
            tone: "primary",
            icon: <Sparkles size={16} aria-hidden="true" />,
            onClick: () => { useMarkupStore.getState().setActive(false); },
          },
          {
            id: "undo-stroke",
            label: "Undo stroke",
            ariaLabel: "Undo last laser stroke",
            icon: <Ungroup size={16} aria-hidden="true" />,
            onClick: () => { useMarkupStore.getState().undoStroke(); },
            disabled: markupStrokeCount === 0,
          },
          {
            id: "clear-drawing",
            label: "Clear",
            ariaLabel: "Clear laser diagram",
            tone: "danger",
            icon: <Trash2 size={16} aria-hidden="true" />,
            onClick: () => { useMarkupStore.getState().clearStrokes(); },
            disabled: markupStrokeCount === 0,
          },
        ],
      };
    }

    if (selectedCatalogue !== undefined) {
      const chairHint = selectedCatalogue.category === "chair"
        ? "Drag across the floor to paint a row or block."
        : "Move over the floor, then click to place.";
      return {
        copy: {
          kicker: "Placing",
          title: selectedCatalogue.name,
          detail: `${chairHint} Rotate with R before release.`,
          metric: snapEnabled ? "Grid + smart guides on" : "Free placement",
        },
        actions: [
          {
            id: "cancel-placement",
            label: "Cancel",
            ariaLabel: "Cancel furniture placement",
            icon: <CircleSlash size={16} aria-hidden="true" />,
            onClick: () => {
              useCatalogueStore.getState().clearSelection();
              usePlacementStore.getState().clearGhost();
            },
          },
          {
            id: "open-catalogue",
            label: drawerOpen ? "Catalogue open" : "Catalogue",
            ariaLabel: "Open furniture catalogue",
            icon: <Armchair size={16} aria-hidden="true" />,
            onClick: () => { dispatchPlannerToolbarCommand("open-furniture"); },
          },
        ],
      };
    }

    if (activeReferenceId !== null) {
      return {
        copy: {
          kicker: "Human POV",
          title: "Looking through a saved viewpoint",
          detail: "Right-drag turns like a person standing in the room. Press Escape to return to planning.",
          metric: "First-person camera",
        },
        actions: [
          {
            id: "exit-pov",
            label: "Exit POV",
            ariaLabel: "Exit camera point of view",
            tone: "primary",
            icon: <Camera size={16} aria-hidden="true" />,
            onClick: () => { useBookmarkStore.setState({ activeReferenceId: null }); },
          },
        ],
      };
    }

    if (selectedCount > 0) {
      const tableIds = new Set(selectedTableIds);
      const copy = selectedCopy(selectedCount, tableCount, chairCount);
      const actions: CommandAction[] = [
        {
          id: "group",
          label: selectedCount > 1 ? "Group" : "Group",
          ariaLabel: "Group selected furniture",
          icon: <Group size={16} aria-hidden="true" />,
          onClick: () => { usePlacementStore.getState().groupItems(selectedIdSet); },
          disabled: selectedCount < 2,
        },
        {
          id: "ungroup",
          label: "Ungroup",
          ariaLabel: "Ungroup selected furniture",
          icon: <Ungroup size={16} aria-hidden="true" />,
          onClick: () => { usePlacementStore.getState().ungroupItems(selectedIdSet); },
          disabled: !selectedItems.some((item) => item.groupId !== null),
        },
        {
          id: "delete",
          label: "Delete",
          ariaLabel: "Delete selected furniture",
          tone: "danger",
          icon: <Trash2 size={16} aria-hidden="true" />,
          onClick: () => {
            usePlacementStore.getState().removeItems(selectedIdSet);
            useSelectionStore.getState().clearSelection();
          },
        },
      ];

      if (tableCount > 0) {
        actions.unshift(
          {
            id: "ivory-cloth",
            label: "Ivory cloth",
            ariaLabel: "Apply ivory cloth to selected tables",
            icon: <Paintbrush size={16} aria-hidden="true" />,
            onClick: () => { usePlacementStore.getState().applyTableCloth(tableIds, "white"); },
          },
          {
            id: "dinner-set",
            label: "Dinner set",
            ariaLabel: "Apply dinner place settings to selected tables",
            icon: <Utensils size={16} aria-hidden="true" />,
            onClick: () => { usePlacementStore.getState().applyTableSetting(tableIds, "dinner"); },
          },
        );
      }

      return { copy, actions };
    }

    const emptyActions: CommandAction[] = [
      {
        id: "open-catalogue",
        label: "Furniture",
        ariaLabel: "Open furniture command",
        tone: "primary",
        icon: <Armchair size={16} aria-hidden="true" />,
        onClick: () => { dispatchPlannerToolbarCommand("open-furniture"); },
      },
      {
        id: "draw",
        label: "Laser",
        ariaLabel: "Start floor drawing",
        icon: <PenLine size={16} aria-hidden="true" />,
        onClick: () => { dispatchPlannerToolbarCommand("open-markup"); },
      },
      {
        id: "select",
        label: "Select",
        ariaLabel: "Switch to select mode",
        icon: <MousePointer2 size={16} aria-hidden="true" />,
        onClick: () => {
          dispatchPlannerToolbarCommand("select");
          useMarkupStore.getState().setActive(false);
          useCatalogueStore.getState().clearSelection();
        },
      },
    ];

    // Offer a one-click banquet fill only on a blank floor, so it can never
    // overwrite work in progress. Fills the room with comfortable-aisle round
    // tables (undo-safe); the planner then tunes from there.
    if (placedItems.length === 0) {
      emptyActions.splice(1, 0, {
        id: "auto-fill",
        label: "Auto-fill",
        ariaLabel: "Auto-fill the room with banquet tables",
        icon: <LayoutGrid size={16} aria-hidden="true" />,
        onClick: () => {
          const table = getCatalogueItemBySlug("round-table-6ft");
          if (table === undefined) return;
          usePlacementStore.getState().autoArrangeBanquet(table.id, 0, 8);
        },
      });
    }

    return {
      copy: {
        kicker: "Command deck",
        title: "Build the room from the floor",
        detail: placedItems.length === 0
          ? "Auto-fill a comfortable banquet grid in one click, open furniture, or sketch with Laser Diagram."
          : "Open furniture, drag rows of chairs, right-click a seat for POV, or sketch with Laser Diagram.",
        metric: placedItems.length === 0
          ? "No furniture placed"
          : `${placedItems.length.toLocaleString("en-GB")} placed item${placedItems.length === 1 ? "" : "s"}`,
      },
      actions: emptyActions,
    };
  }, [
    activeReferenceId,
    chairCount,
    drawerOpen,
    markupActive,
    markupStrokeCount,
    placedItems.length,
    selectedCatalogue,
    selectedCount,
    selectedIdSet,
    selectedItems,
    selectedTableIds,
    snapEnabled,
    tableCount,
  ]);

  return (
    <section
      className="planner-command-deck"
      data-testid="planner-command-deck"
      aria-label="Planner command deck"
    >
      <div className="planner-command-deck__glow" aria-hidden="true" />
      <div className="planner-command-deck__copy">
        <p className="planner-command-deck__kicker">{state.copy.kicker}</p>
        <h2 className="planner-command-deck__title">{state.copy.title}</h2>
        <p className="planner-command-deck__detail">{state.copy.detail}</p>
      </div>
      <div className="planner-command-deck__meta">
        <span>{state.copy.metric}</span>
      </div>
      <div className="planner-command-deck__actions">
        {state.actions.map(makeButton)}
      </div>
    </section>
  );
});
