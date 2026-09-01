import { useMemo, useRef, type ReactElement } from "react";
import {
  MousePointer2,
  Move,
  RotateCw,
  Ruler,
  Scaling,
  type LucideIcon,
} from "lucide-react";
import { useToolStore } from "../../../stores/tool-store.js";
import { useSelectionStore } from "../../../stores/selection-store.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { useMeasurementStore } from "../../../stores/measurement-store.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import {
  PLANNER_TOOLS,
  formatDegrees,
  formatMetres,
  formatScale,
  scrubRotation,
  scrubScale,
  type PlannerTool,
} from "../../../lib/planner-tools.js";
import { isSceneFurniturePlacement } from "../../../lib/table-dressing.js";
import { normalizeFurnitureScale } from "../../../lib/furniture-scale.js";
import "./ToolPill.css";

// ---------------------------------------------------------------------------
// ToolPill — the five hands, top-centre over the stage.
//
// Pointer-first by design: the planner's keyboard is already spoken for
// (digits jump bookmarks, WASD pans, Q/E nudge rotation), so the pill adds
// no new letter bindings — M and Escape both route through the tool store
// from where they already lived.
//
// The value chip is the tabular readout ("135°", "×1.25", "3.20 m") and the
// fine instrument: a horizontal scrub on the number adjusts the selection in
// 1° / 1% steps, where the drag gestures deliberately snap coarse. Scrubs
// are fenced with history epochs exactly like drags, so one scrub = one
// undo entry.
// ---------------------------------------------------------------------------

const TOOL_ICONS: Readonly<Record<PlannerTool, LucideIcon>> = {
  select: MousePointer2,
  move: Move,
  rotate: RotateCw,
  scale: Scaling,
  measure: Ruler,
};

interface ScrubSession {
  readonly pointerId: number;
  readonly startX: number;
  /** Initial value per selected item id at scrub start. */
  readonly initial: ReadonlyMap<string, number>;
}

/** The chip's meaning depends on the hand: rotation, scale, or tape length. */
function idleChipValue(tool: PlannerTool): string | null {
  if (tool === "rotate" || tool === "scale") {
    const selectedIds = useSelectionStore.getState().selectedIds;
    const placedItems = usePlacementStore.getState().placedItems;
    const primary = placedItems.find(
      (item) => selectedIds.has(item.id) && isSceneFurniturePlacement(item),
    );
    if (primary === undefined) return null;
    return tool === "rotate"
      ? formatDegrees(primary.rotationY)
      : formatScale(normalizeFurnitureScale(primary.scale));
  }
  if (tool === "measure") {
    const measurements = useMeasurementStore.getState().measurements;
    const last = measurements[measurements.length - 1];
    return last === undefined ? null : formatMetres(last.distance);
  }
  return null;
}

export function ToolPill(): ReactElement | null {
  const activeTool = useToolStore((s) => s.activeTool);
  const liveValue = useToolStore((s) => s.liveValue);
  const setTool = useToolStore((s) => s.setTool);
  const walkMode = useCockpitStore((s) => s.walkMode);
  // Subscribed so the idle chip re-renders as selection / placement change.
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const placedItems = usePlacementStore((s) => s.placedItems);
  const measurementCount = useMeasurementStore((s) => s.measurements.length);

  const scrub = useRef<ScrubSession | null>(null);

  const chipValue = useMemo(
    () => liveValue ?? idleChipValue(activeTool),
    // placedItems/selectedIds/measurementCount are the chip's real inputs —
    // idleChipValue reads them imperatively to keep one code path with the
    // gesture-driven liveValue.
    [liveValue, activeTool, selectedIds, placedItems, measurementCount],
  );

  const scrubbable = (activeTool === "rotate" || activeTool === "scale") && chipValue !== null;

  if (walkMode) return null;

  const scrubTargets = (): ReadonlyMap<string, number> => {
    const ids = useSelectionStore.getState().selectedIds;
    const items = usePlacementStore.getState().placedItems;
    const initial = new Map<string, number>();
    for (const item of items) {
      if (!ids.has(item.id) || !isSceneFurniturePlacement(item)) continue;
      initial.set(
        item.id,
        activeTool === "rotate" ? item.rotationY : normalizeFurnitureScale(item.scale),
      );
    }
    return initial;
  };

  const onChipPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!scrubbable) return;
    const initial = scrubTargets();
    if (initial.size === 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    // Fence the undo timeline: one scrub coalesces into one entry.
    useEditorStore.getState().bumpHistoryEpoch();
    scrub.current = { pointerId: event.pointerId, startX: event.clientX, initial };
  };

  const onChipPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const session = scrub.current;
    if (session === null || event.pointerId !== session.pointerId) return;
    const dx = event.clientX - session.startX;
    const placement = usePlacementStore.getState();
    const next = new Map<string, number>();
    let readout: string | null = null;
    for (const [id, initial] of session.initial) {
      const value = activeTool === "rotate" ? scrubRotation(initial, dx) : scrubScale(initial, dx);
      next.set(id, value);
      readout ??= activeTool === "rotate" ? formatDegrees(value) : formatScale(value);
    }
    if (activeTool === "rotate") placement.rotateItemsTo(next);
    else placement.scaleItemsTo(next);
    useToolStore.getState().setLiveValue(readout);
  };

  const onChipPointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    const session = scrub.current;
    if (session === null || event.pointerId !== session.pointerId) return;
    scrub.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    useEditorStore.getState().bumpHistoryEpoch();
    useToolStore.getState().setLiveValue(null);
  };

  return (
    <div className="planner-tool-pill" data-testid="planner-tool-pill" role="toolbar" aria-label="Planner tools">
      {PLANNER_TOOLS.map((tool) => {
        const Icon = TOOL_ICONS[tool.id];
        const active = activeTool === tool.id;
        return (
          <button
            key={tool.id}
            type="button"
            className="planner-tool-pill__btn"
            data-testid={`planner-tool-${tool.id}`}
            aria-pressed={active}
            aria-label={tool.label}
            title={tool.hint}
            onClick={() => { setTool(tool.id); }}
          >
            <Icon size={16} strokeWidth={1.75} aria-hidden />
            <span className="planner-tool-pill__label">{tool.label}</span>
          </button>
        );
      })}
      {chipValue !== null && (
        <div
          className={`planner-tool-pill__chip${scrubbable ? " planner-tool-pill__chip--scrub" : ""}`}
          data-testid="planner-tool-value"
          aria-label={scrubbable ? "Adjust value — drag horizontally" : "Current value"}
          onPointerDown={onChipPointerDown}
          onPointerMove={onChipPointerMove}
          onPointerUp={onChipPointerUp}
          onPointerCancel={onChipPointerUp}
        >
          {chipValue}
        </div>
      )}
    </div>
  );
}
