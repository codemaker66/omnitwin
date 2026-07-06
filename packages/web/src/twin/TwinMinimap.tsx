import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import type { TwinScanNode } from "@omnitwin/types";
import { TWIN_MINIMAP_NORTH } from "./twin-copy.js";

// -----------------------------------------------------------------------------
// TwinMinimap — the top-down scan graph, bottom-right (Twin Phase 1, Task 10).
//
// Pure SVG over plan coordinates: each scan node becomes a dot at
// (t.x, −t.y) — E57 plan view with screen-y flipped so north is up — inside
// a viewBox auto-fitted to the node extents plus 2 m of padding. The current
// node is gold and wears a 40° view cone rotated by the camera yaw; when the
// bundle spans more than one floor, toggle buttons dim the other storey.
//
// The panel is a listbox: every dot is a labelled option, arrow keys move the
// selection to the nearest same-floor node in that screen direction, Enter
// teleports (onSelect → hopTo(id, { teleport: true })), and clicking a dot
// does the same directly.
//
// Plan: docs/superpowers/plans/2026-07-02-twin-phase1-walk.md (Task 10).
// -----------------------------------------------------------------------------

/** Rite palette — parchment dots, flame-gold current node and cone. */
const DOT_COLOR = "#b9aa8b";
const CURRENT_COLOR = "#d7a64b";
const SELECTED_STROKE = "#f0c66b";

// Dot radii are in METRES (the viewBox is plan metres) — scan spacing in the
// bundle is ~1.5 m, so sub-metre dots stay distinguishable at 149 nodes.
const DOT_RADIUS = 0.45;
const CURRENT_DOT_RADIUS = 0.7;
const VIEWBOX_PADDING_M = 2;
const CONE_RADIUS = 2.5;
const CONE_HALF_ANGLE_RAD = (20 * Math.PI) / 180;
const OTHER_FLOOR_OPACITY = 0.25;
/** Selection ring width in screen px — paired with non-scaling stroke. */
const SELECTED_STROKE_WIDTH_PX = 1.5;

/** ViewBox auto-fitted to the node (x, −y) extents plus 2 m padding. */
export function minimapViewBox(nodes: readonly TwinScanNode[]): string {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    const x = node.pose.t[0];
    const y = -node.pose.t[1];
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX)) {
    return "0 0 1 1";
  }
  const width = maxX - minX + VIEWBOX_PADDING_M * 2;
  const height = maxY - minY + VIEWBOX_PADDING_M * 2;
  return `${String(minX - VIEWBOX_PADDING_M)} ${String(minY - VIEWBOX_PADDING_M)} ${String(width)} ${String(height)}`;
}

/**
 * Camera yaw (three space, YXZ radians) → clockwise SVG rotation in degrees.
 * At yaw 0 the camera faces three −Z = E57 +Y = screen up; positive yaw turns
 * the camera left, which on a y-down screen is a counter-clockwise (negative)
 * SVG rotation.
 */
export function yawToMinimapRotationDeg(yaw: number): number {
  const degrees = (-yaw * 180) / Math.PI;
  // Normalise the -0 that -yaw produces at yaw 0.
  return degrees === 0 ? 0 : degrees;
}

/** Canonical up-pointing 40° wedge; the yaw rotation is applied as transform. */
function conePath(cx: number, cy: number): string {
  const spanX = CONE_RADIUS * Math.sin(CONE_HALF_ANGLE_RAD);
  const edgeY = cy - CONE_RADIUS * Math.cos(CONE_HALF_ANGLE_RAD);
  return (
    `M ${String(cx)} ${String(cy)} ` +
    `L ${String(cx - spanX)} ${String(edgeY)} ` +
    `A ${String(CONE_RADIUS)} ${String(CONE_RADIUS)} 0 0 1 ${String(cx + spanX)} ${String(edgeY)} Z`
  );
}

/** Screen direction per arrow key (SVG y grows downward). */
const ARROW_DIRECTIONS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};

export interface TwinMinimapProps {
  readonly nodes: readonly TwinScanNode[];
  readonly currentId: string;
  /** Camera yaw in three space (radians) — rotates the view cone. */
  readonly yaw: number;
  /** Teleport request — the viewer wires this to hopTo(id, { teleport }). */
  readonly onSelect: (id: string) => void;
}

export function TwinMinimap({
  nodes,
  currentId,
  yaw,
  onSelect,
}: TwinMinimapProps): ReactElement {
  const byId = useMemo(
    () => new Map<string, TwinScanNode>(nodes.map((node) => [node.id, node])),
    [nodes],
  );
  const floors = useMemo(
    () => [...new Set(nodes.map((node) => node.floor))].sort((a, b) => a - b),
    [nodes],
  );

  const currentNode = byId.get(currentId);
  const currentFloor = currentNode?.floor ?? floors[0] ?? 0;

  // The active floor follows the walk; toggling is a temporary look-around.
  const [activeFloor, setActiveFloor] = useState(currentFloor);
  useEffect(() => {
    setActiveFloor(currentFloor);
  }, [currentFloor]);

  // The keyboard selection highlight starts (and re-anchors) on the walk.
  const [selectedId, setSelectedId] = useState(currentId);
  useEffect(() => {
    setSelectedId(currentId);
  }, [currentId]);

  const selectFloor = (floor: number): void => {
    setActiveFloor(floor);
    const selected = byId.get(selectedId);
    if (selected === undefined || selected.floor !== floor) {
      const first = nodes.find((node) => node.floor === floor);
      if (first !== undefined) {
        setSelectedId(first.id);
      }
    }
  };

  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      onSelect(selectedId);
      return;
    }
    const direction = ARROW_DIRECTIONS[event.key];
    if (direction === undefined) {
      return;
    }
    event.preventDefault();
    const origin = byId.get(selectedId);
    if (origin === undefined) {
      return;
    }
    const originX = origin.pose.t[0];
    const originY = -origin.pose.t[1];
    let nearest: { id: string; distance: number } | null = null;
    for (const node of nodes) {
      if (node.id === selectedId || node.floor !== activeFloor) {
        continue;
      }
      const dx = node.pose.t[0] - originX;
      const dy = -node.pose.t[1] - originY;
      const along = dx * direction[0] + dy * direction[1];
      if (along <= 1e-9) {
        continue;
      }
      const distance = Math.hypot(dx, dy);
      if (nearest === null || distance < nearest.distance) {
        nearest = { id: node.id, distance };
      }
    }
    if (nearest !== null) {
      setSelectedId(nearest.id);
    }
  };

  return (
    <div className="twin-minimap">
      {/* Static north anchor — screen-up is E57 +Y = north; the fixed reference
          the rotating view cone turns against (finding [6]). */}
      <span className="twin-minimap-north" aria-hidden>
        {TWIN_MINIMAP_NORTH}
      </span>
      {floors.length > 1 && (
        <div className="twin-minimap-floors" role="group" aria-label="Floors">
          {floors.map((floor) => (
            <button
              key={floor}
              type="button"
              className={
                floor === activeFloor
                  ? "twin-minimap-floor twin-minimap-floor--active"
                  : "twin-minimap-floor"
              }
              aria-pressed={floor === activeFloor}
              onClick={() => {
                selectFloor(floor);
              }}
            >
              {`Floor ${String(floor)}`}
            </button>
          ))}
        </div>
      )}
      <svg
        className="twin-minimap-map"
        viewBox={minimapViewBox(nodes)}
        role="listbox"
        aria-label="Scan positions"
        aria-activedescendant={`twin-minimap-option-${selectedId}`}
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        {currentNode !== undefined && (
          <>
            <defs>
              {/* Soft-edged cone: gold at the standing point, breathing out to
                  nothing at the arc — rotation-invariant because the gradient
                  is centred on the node the cone pivots around. */}
              <radialGradient
                id="vv-twin-cone-grad"
                gradientUnits="userSpaceOnUse"
                cx={currentNode.pose.t[0]}
                cy={-currentNode.pose.t[1]}
                r={CONE_RADIUS}
              >
                <stop offset="0%" stopColor={CURRENT_COLOR} stopOpacity={0.62} />
                <stop offset="55%" stopColor={CURRENT_COLOR} stopOpacity={0.38} />
                <stop offset="100%" stopColor={CURRENT_COLOR} stopOpacity={0} />
              </radialGradient>
            </defs>
            <path
              className="twin-minimap-cone"
              d={conePath(currentNode.pose.t[0], -currentNode.pose.t[1])}
              fill="url(#vv-twin-cone-grad)"
              transform={`rotate(${String(yawToMinimapRotationDeg(yaw))} ${String(currentNode.pose.t[0])} ${String(-currentNode.pose.t[1])})`}
            />
          </>
        )}
        {nodes.map((node) => {
          const isCurrent = node.id === currentId;
          const isSelected = node.id === selectedId;
          return (
            <g
              key={node.id}
              id={`twin-minimap-option-${node.id}`}
              role="option"
              aria-selected={isSelected}
              aria-label={`Go to scan ${String(node.index)}`}
              opacity={node.floor === activeFloor ? 1 : OTHER_FLOOR_OPACITY}
              onClick={() => {
                onSelect(node.id);
              }}
            >
              {isCurrent && (
                // Decorative breath around the standing node — CSS keyframes
                // scale it (reduced motion pins it static); never a target.
                <circle
                  className="twin-minimap-pulse"
                  cx={node.pose.t[0]}
                  cy={-node.pose.t[1]}
                  r={CURRENT_DOT_RADIUS}
                  fill="none"
                  stroke={CURRENT_COLOR}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                />
              )}
              <circle
                className="twin-minimap-dot"
                cx={node.pose.t[0]}
                cy={-node.pose.t[1]}
                r={isCurrent ? CURRENT_DOT_RADIUS : DOT_RADIUS}
                fill={isCurrent ? CURRENT_COLOR : DOT_COLOR}
                stroke={isSelected ? SELECTED_STROKE : "none"}
                strokeWidth={isSelected ? SELECTED_STROKE_WIDTH_PX : 0}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
