import { useMemo } from "react";
import type { Phase } from "@omnitwin/types";
import { GOLD } from "../../constants/ui-palette.js";
import {
  collectFloorPlanMarkers,
  markerColourFor,
  svgAspectRatio,
  type RoomDims,
} from "../../lib/hallkeeper-geometry.js";

// ---------------------------------------------------------------------------
// InteractiveFloorPlan — top-down SVG plan with clickable markers
//
// The hallkeeper's tablet view on the morning of an event: tapping
// a manifest row highlights its positions on this plan; tapping a
// marker on this plan scrolls the corresponding row into view. That
// bidirectional link is what kills the "where does this go" cognitive
// load.
//
// SVG over PNG deliberately: the PNG thumbnail from the editor is a
// 3D perspective shot and can't be trusted to align with room
// coordinates. An orthographic SVG we draw ourselves is always
// pixel-perfect aligned with the placement data.
// ---------------------------------------------------------------------------

const BG = "#141311";
const GRID = "#252320";
const WALL = "#3a3631";
const DIM_INK = "rgba(255,255,255,0.15)";

// SVG coordinate space uses 1000 units wide; height derived from room
// aspect ratio. This keeps markers pixel-crisp at any render size.
const SVG_W = 1000;

export interface InteractiveFloorPlanProps {
  readonly room: RoomDims;
  readonly phases: readonly Phase[];
  readonly highlightedRowKey: string | null;
  readonly onMarkerClick: (rowKey: string) => void;
}

export function InteractiveFloorPlan({
  room, phases, highlightedRowKey, onMarkerClick,
}: InteractiveFloorPlanProps): React.ReactElement {
  const markers = useMemo(() => collectFloorPlanMarkers(phases, room), [phases, room]);
  const aspect = svgAspectRatio(room);
  const svgH = SVG_W / aspect;

  const dimOthers = highlightedRowKey !== null;

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        borderRadius: 10,
        overflow: "hidden",
        background: BG,
        border: `1px solid ${GRID}`,
      }}
    >
      <svg
        viewBox={`0 0 ${String(SVG_W)} ${String(svgH)}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: "block", width: "100%", height: "auto" }}
        role="img"
        aria-label="Interactive floor plan"
      >
        {/* Grid — subtle metre spacing for scale reference */}
        <GridLines room={room} svgW={SVG_W} svgH={svgH} />

        {/* Room outline */}
        <rect
          x={0} y={0} width={SVG_W} height={svgH}
          fill="none" stroke={WALL} strokeWidth={4}
        />

        {/* Scale bar: 1m reference in the bottom-left corner */}
        <ScaleBar room={room} svgH={svgH} />

        {/* Markers */}
        {markers.map((m, i) => {
          const cx = m.nx * SVG_W;
          const cy = m.nz * svgH;
          const highlighted = m.rowKey === highlightedRowKey;
          const dimmed = dimOthers && !highlighted;
          const baseColour = markerColourFor(m.category);
          const colour = dimmed ? DIM_INK : baseColour;
          const r = highlighted ? 14 : 9;
          return (
            <g
              key={`${m.rowKey}|${String(i)}|${m.objectId}`}
              onClick={(e) => { e.stopPropagation(); onMarkerClick(m.rowKey); }}
              style={{ cursor: "pointer" }}
            >
              {highlighted && (
                <circle cx={cx} cy={cy} r={r + 10} fill="none" stroke={GOLD} strokeWidth={2} opacity={0.6}>
                  <animate attributeName="r" values={`${String(r + 6)};${String(r + 14)};${String(r + 6)}`} dur="1.6s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.7;0.15;0.7" dur="1.6s" repeatCount="indefinite" />
                </circle>
              )}
              <circle cx={cx} cy={cy} r={r} fill={colour} stroke={highlighted ? GOLD : "#000"} strokeWidth={highlighted ? 2 : 1} />
              {/* Rotation indicator — small line pointing in the object's facing direction */}
              <line
                x1={cx} y1={cy}
                x2={cx + Math.sin(m.rotationY) * r * 1.6}
                y2={cy - Math.cos(m.rotationY) * r * 1.6}
                stroke={dimmed ? DIM_INK : "#000"}
                strokeWidth={highlighted ? 2 : 1.2}
                strokeLinecap="round"
              />
            </g>
          );
        })}

        {/* Empty state — only fires when there are no markers at all */}
        {markers.length === 0 && (
          <text
            x={SVG_W / 2} y={svgH / 2} textAnchor="middle" fill="#555" fontSize={24} fontFamily="Inter, sans-serif"
          >
            No placements on this layout yet
          </text>
        )}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grid — thin lines every 1m for scale. Kept at 8% opacity so markers
// are what the eye lands on, not the grid.
// ---------------------------------------------------------------------------

function GridLines({ room, svgW, svgH }: { room: RoomDims; svgW: number; svgH: number }): React.ReactElement {
  const lines: React.ReactElement[] = [];
  const stepX = svgW / Math.max(room.widthM, 1);
  const stepY = svgH / Math.max(room.lengthM, 1);
  for (let i = 1; i < Math.floor(room.widthM); i++) {
    const x = i * stepX;
    lines.push(<line key={`vx${String(i)}`} x1={x} y1={0} x2={x} y2={svgH} stroke={GRID} strokeWidth={0.8} opacity={0.5} />);
  }
  for (let j = 1; j < Math.floor(room.lengthM); j++) {
    const y = j * stepY;
    lines.push(<line key={`hy${String(j)}`} x1={0} y1={y} x2={svgW} y2={y} stroke={GRID} strokeWidth={0.8} opacity={0.5} />);
  }
  return <>{lines}</>;
}

function ScaleBar({ room, svgH }: { room: RoomDims; svgH: number }): React.ReactElement {
  const oneMetreInSvg = SVG_W / Math.max(room.widthM, 1);
  return (
    <g>
      <line x1={24} y1={svgH - 24} x2={24 + oneMetreInSvg} y2={svgH - 24}
        stroke="#aaa" strokeWidth={2} strokeLinecap="round" />
      <text x={28 + oneMetreInSvg} y={svgH - 20} fontSize={14} fill="#aaa" fontFamily="Inter, sans-serif">1m</text>
    </g>
  );
}
