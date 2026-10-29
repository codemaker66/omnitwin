import { memo, useMemo } from "react";
import type { MouseEvent, ReactNode } from "react";
import {
  Armchair,
  Camera,
  CircleSlash,
  Clapperboard,
  Group,
  LayoutGrid,
  MousePointer2,
  Paintbrush,
  PenLine,
  Redo2,
  Sparkles,
  Trash2,
  Undo2,
  Ungroup,
  Utensils,
} from "lucide-react";
import { getCatalogueItem } from "../../lib/catalogue.js";
import { useAutoFillRequestStore } from "../../stores/auto-fill-request-store.js";
import { pressPlannerPresent, presentName, usePlannerPresent } from "./planner-present.js";
import { canRedo, canUndo, redoLabel, undoLabel } from "../../lib/editor-history.js";
import { dispatchPlannerToolbarCommand } from "../../lib/planner-toolbar-events.js";
import { useBookmarkStore } from "../../stores/bookmark-store.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { useMarkupStore } from "../../stores/markup-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";
import {
  canApplyTableLinenToItem,
  isDiningTableItem,
} from "../../lib/furniture-semantics.js";
import { sceneFurniturePlacements } from "../../lib/table-dressing.js";
import { countLabel } from "../../lib/count-label.js";
import { canLayOut } from "../../lib/auto-fill.js";
import { plannerFeatureEnabled } from "../../lib/planner-features.js";

interface CommandAction {
  readonly id: string;
  readonly label: string;
  readonly ariaLabel: string;
  readonly tone?: "primary" | "danger";
  readonly icon: ReactNode;
  readonly onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  readonly disabled?: boolean;
}

interface CommandDeckCopy {
  readonly title: string;
  readonly detail: string;
  readonly metric: string | null;
}

function selectedCopy(
  selectedCount: number,
  tableCount: number,
  chairCount: number,
  linenTargetCount: number,
): CommandDeckCopy {
  if (selectedCount === 1 && tableCount === 1) {
    const canDress = linenTargetCount === 1;
    return {
      title: "Table selected",
      detail: canDress
        ? "Dress, move or group this table."
        : "Move or group this table. Cloth included.",
      metric: null,
    };
  }
  if (selectedCount === 1 && chairCount === 1) {
    return {
      title: "Seat selected",
      detail: "Drag to move; right-click for seat options.",
      metric: null,
    };
  }
  return {
    title: `${countLabel(selectedCount, "item")} selected`,
    detail: "Move, group or delete the selection.",
    metric: null,
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
      title={action.disabled === true ? action.ariaLabel : undefined}
    >
      {action.icon}
      <span>{action.label}</span>
    </button>
  );
}

/**
 * Undo/redo commands against the editor-store history — the single timeline
 * shared by the 3D scene and the 2D blueprint. The aria-label carries the
 * recorded entry label ("Undo Move 3 items") so screen readers announce
 * exactly what will be reverted.
 */
interface HistoryState {
  readonly undoEntry: string | null;
  readonly redoEntry: string | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

function historyActions({ undoEntry, redoEntry, canUndo: undoAvailable, canRedo: redoAvailable }: HistoryState): readonly CommandAction[] {
  return [
    {
      id: "undo",
      label: "Undo",
      ariaLabel: undoEntry === null ? "Undo" : `Undo ${undoEntry}`,
      icon: <Undo2 size={16} aria-hidden="true" />,
      onClick: () => { useEditorStore.getState().undo(); },
      disabled: !undoAvailable,
    },
    {
      id: "redo",
      label: "Redo",
      ariaLabel: redoEntry === null ? "Redo" : `Redo ${redoEntry}`,
      icon: <Redo2 size={16} aria-hidden="true" />,
      onClick: () => { useEditorStore.getState().redo(); },
      disabled: !redoAvailable,
    },
  ];
}

export const PlannerCommandDeck = memo(function PlannerCommandDeck({ compact = false }: { readonly compact?: boolean }): React.ReactElement {
  const catalogueSelectedId = useCatalogueStore((s) => s.selectedItemId);
  const drawerOpen = useCatalogueStore((s) => s.drawerOpen);
  const markupActive = useMarkupStore((s) => s.active);
  const markupStrokeCount = useMarkupStore((s) => s.strokes.length);
  const hasClearedDrawing = useMarkupStore((s) => s.clearedStrokes !== null);
  const activeReferenceId = useBookmarkStore((s) => s.activeReferenceId);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const allPlacedItems = usePlacementStore((s) => s.placedItems);
  const placedItems = useMemo(
    () => sceneFurniturePlacements(allPlacedItems),
    [allPlacedItems],
  );
  const snapEnabled = usePlacementStore((s) => s.snapEnabled);
  // Labels and flags, not the history object: every drag frame records one.
  const undoEntry = useEditorStore((s) => undoLabel(s.history));
  const redoEntry = useEditorStore((s) => redoLabel(s.history));
  const undoAvailable = useEditorStore((s) => canUndo(s.history));
  const redoAvailable = useEditorStore((s) => canRedo(s.history));
  const history = useMemo<HistoryState>(
    () => ({ undoEntry, redoEntry, canUndo: undoAvailable, canRedo: redoAvailable }),
    [undoEntry, redoEntry, undoAvailable, redoAvailable],
  );
  const plannedGuestCount = useCockpitStore((s) => s.plannedGuestCount);
  const present = usePlannerPresent();

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
  const selectedLinenTableIds = useMemo(
    () => selectedItems
      .filter((item) => {
        const catalogueItem = getCatalogueItem(item.catalogueItemId);
        return catalogueItem !== undefined && canApplyTableLinenToItem(catalogueItem);
      })
      .map((item) => item.id),
    [selectedItems],
  );
  const linenTableCount = selectedLinenTableIds.length;
  const selectedDiningTableIds = useMemo(
    () => selectedItems
      .filter((item) => {
        const catalogueItem = getCatalogueItem(item.catalogueItemId);
        return catalogueItem !== undefined && isDiningTableItem(catalogueItem);
      })
      .map((item) => item.id),
    [selectedItems],
  );
  const diningTableCount = selectedDiningTableIds.length;
  const chairCount = useMemo(
    () => selectedItems.filter((item) => getCatalogueItem(item.catalogueItemId)?.category === "chair").length,
    [selectedItems],
  );
  const selectedCatalogue = catalogueSelectedId === null ? undefined : getCatalogueItem(catalogueSelectedId);

  const state = useMemo((): { readonly copy: CommandDeckCopy; readonly actions: readonly CommandAction[] } => {
    if (markupActive) {
      return {
        copy: {
          title: "Draw planning notes on the floor",
          detail: "Drawings stay in this layout.",
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
            ariaLabel: "Undo the last line drawn",
            icon: <Ungroup size={16} aria-hidden="true" />,
            onClick: () => { useMarkupStore.getState().undoStroke(); },
            disabled: markupStrokeCount === 0 && !hasClearedDrawing,
          },
          {
            id: "clear-drawing",
            label: "Clear",
            ariaLabel: "Clear the drawing",
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
          title: "Looking through a saved viewpoint",
          detail: "Right-drag to look. Escape to return.",
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
      const linenTableIds = new Set(selectedLinenTableIds);
      const copy = selectedCopy(selectedCount, tableCount, chairCount, linenTableCount);
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

      if (linenTableCount > 0) {
        const tableActions: CommandAction[] = [{
          id: "ivory-cloth",
          label: "Ivory cloth",
          ariaLabel: "Apply ivory cloth to selected tables",
          icon: <Paintbrush size={16} aria-hidden="true" />,
          onClick: () => { usePlacementStore.getState().applyTableCloth(linenTableIds, "white"); },
        }];
        if (diningTableCount > 0) {
          const diningTableIds = new Set(selectedDiningTableIds);
          tableActions.push({
            id: "dinner-set",
            label: "Dinner set",
            ariaLabel: "Apply dinner place settings to selected tables",
            icon: <Utensils size={16} aria-hidden="true" />,
            onClick: () => {
              usePlacementStore.getState().applyTableSetting(diningTableIds, "dinner");
            },
          });
        }
        actions.unshift(...tableActions);
      }

      actions.push(...historyActions(history));

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
        label: "Draw",
        ariaLabel: "Draw on the floor",
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
      ...historyActions(history),
      {
        id: "showcase",
        label: "Present",
        ariaLabel: presentName(present),
        icon: <Clapperboard size={16} aria-hidden="true" />,
        disabled: present.kind === "unavailable",
        // A click from the keys (Enter or Space) has no pointer behind it: detail 0.
        onClick: (event) => { pressPlannerPresent(event.detail === 0); },
      },
    ];

    // Offer a banquet fill on a blank floor; with Fill over the layout (Q-10),
    // on any floor as "Lay out", since it re-plans the rounds and keeps
    // everything else (canLayOut). It asks "How many guests?" first, in the
    // Guests lens, beside the venue's published figure, and says what it will
    // place before it places it (redteam fix-first 15). Undo-safe.
    const layOutOver = placedItems.length > 0 && canLayOut("dinner-rounds", false, plannerFeatureEnabled("fillKeepOuts"));
    if (layOutOver) {
      emptyActions.splice(1, 0, {
        id: "lay-out",
        label: "Lay out",
        ariaLabel: "Lay out banquet rounds, keeping everything else on the floor",
        icon: <LayoutGrid size={16} aria-hidden="true" />,
        onClick: () => {
          useAutoFillRequestStore.getState().request("dinner-rounds");
          useCockpitStore.getState().setMode("guests");
        },
      });
    }
    if (placedItems.length === 0) {
      const forGuests = plannedGuestCount !== null && plannedGuestCount > 0 ? plannedGuestCount : 0;
      emptyActions.splice(1, 0, {
        id: "auto-fill",
        label: "Lay out",
        ariaLabel: forGuests > 0
          ? `Lay out tables and seats for ${countLabel(forGuests, "guest")}`
          : "Lay out tables and seats for your guests",
        icon: <LayoutGrid size={16} aria-hidden="true" />,
        onClick: () => {
          useAutoFillRequestStore.getState().request("dinner-rounds");
          useCockpitStore.getState().setMode("guests");
        },
      });
    }

    return {
      copy: {
        title: "Arrange the room",
        detail: placedItems.length === 0
          ? (plannedGuestCount !== null && plannedGuestCount > 0
            ? `Lay out for ${countLabel(plannedGuestCount, "guest")}, or add furniture.`
            : "Lay out for your guests, or add furniture.")
          : layOutOver
          ? "Lay out the rounds again, add furniture or draw setup notes."
          : "Add furniture or draw setup notes.",
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
    diningTableCount,
    history,
    hasClearedDrawing,
    markupActive,
    markupStrokeCount,
    linenTableCount,
    placedItems.length,
    plannedGuestCount,
    present,
    selectedCatalogue,
    selectedCount,
    selectedIdSet,
    selectedDiningTableIds,
    selectedItems,
    selectedLinenTableIds,
    selectedTableIds,
    snapEnabled,
    tableCount,
  ]);

  return (
    <section
      className={`planner-command-deck${compact ? " is-reference-compact" : ""}`}
      data-testid="planner-command-deck"
      aria-label="Planner command deck"
    >
      <div className="planner-command-deck__glow" aria-hidden="true" />
      <div className="planner-command-deck__copy">
        <h2 className="planner-command-deck__title">{state.copy.title}</h2>
        <p className="planner-command-deck__detail">{state.copy.detail}</p>
      </div>
      {state.copy.metric !== null && <div className="planner-command-deck__meta">
        <span>{state.copy.metric}</span>
      </div>}
      <div className="planner-command-deck__actions">
        {state.actions.map(makeButton)}
      </div>
    </section>
  );
});
