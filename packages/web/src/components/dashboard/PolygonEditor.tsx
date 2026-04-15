import { useCallback, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type KeyboardEvent } from "react";
import { polygonBoundingBox, type FloorPlanPoint } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// PolygonEditor — click-to-add, drag-to-reposition floor-plan authoring.
//
// The canvas is a fixed pixel size; the world viewport is computed from the
// polygon's bounding box so small and large rooms both frame nicely. During
// an interactive drag the viewport is frozen so the mouse target doesn't
// drift mid-gesture. The viewport re-fits on commit (drop, add, delete,
// reset) only.
//
// Coordinate mapping matches the backend contract: polygon points are 2D
// (x, y) in metres in floor-plan space. `y` here is floor depth, which
// corresponds to `positionZ` on placed objects — `positionY` (vertical
// height) is orthogonal and not represented in this editor.
// ---------------------------------------------------------------------------

const CANVAS_PX = 400;
const CANVAS_MARGIN_PX = 20;
const VERTEX_HIT_RADIUS_PX = 10;
const VERTEX_DRAW_RADIUS_PX = 6;
const MIN_VIEWPORT_M = 12;
const VIEWPORT_PADDING_FACTOR = 1.3;
const MIN_POLYGON_POINTS = 3;
const DEFAULT_RECTANGLE_METRES = 10;

export interface PolygonEditorProps {
  readonly value: readonly FloorPlanPoint[];
  readonly onChange: (next: readonly FloorPlanPoint[]) => void;
  readonly disabled?: boolean;
}

interface Viewport {
  readonly centreX: number;
  readonly centreY: number;
  readonly sizeM: number;
}

function computeViewport(points: readonly FloorPlanPoint[]): Viewport {
  if (points.length === 0) {
    return { centreX: 0, centreY: 0, sizeM: MIN_VIEWPORT_M };
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const rawSize = Math.max(w, h) * VIEWPORT_PADDING_FACTOR;
  return {
    centreX: (minX + maxX) / 2,
    centreY: (minY + maxY) / 2,
    sizeM: Math.max(MIN_VIEWPORT_M, rawSize),
  };
}

function worldToCanvas(p: FloorPlanPoint, vp: Viewport): { cx: number; cy: number } {
  const drawable = CANVAS_PX - CANVAS_MARGIN_PX * 2;
  const scale = drawable / vp.sizeM;
  return {
    cx: CANVAS_PX / 2 + (p.x - vp.centreX) * scale,
    cy: CANVAS_PX / 2 + (p.y - vp.centreY) * scale,
  };
}

function canvasToWorld(cx: number, cy: number, vp: Viewport): FloorPlanPoint {
  const drawable = CANVAS_PX - CANVAS_MARGIN_PX * 2;
  const scale = drawable / vp.sizeM;
  return {
    x: (cx - CANVAS_PX / 2) / scale + vp.centreX,
    y: (cy - CANVAS_PX / 2) / scale + vp.centreY,
  };
}

function findNearestVertexIndex(
  canvasX: number,
  canvasY: number,
  points: readonly FloorPlanPoint[],
  vp: Viewport,
): number | null {
  let best: { index: number; distSq: number } | null = null;
  const hitSq = VERTEX_HIT_RADIUS_PX * VERTEX_HIT_RADIUS_PX;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p === undefined) continue;
    const { cx, cy } = worldToCanvas(p, vp);
    const dx = cx - canvasX;
    const dy = cy - canvasY;
    const d2 = dx * dx + dy * dy;
    if (d2 <= hitSq && (best === null || d2 < best.distSq)) {
      best = { index: i, distSq: d2 };
    }
  }
  return best === null ? null : best.index;
}

function defaultRectangle(sideM: number): FloorPlanPoint[] {
  const h = sideM / 2;
  return [
    { x: -h, y: -h },
    { x: h, y: -h },
    { x: h, y: h },
    { x: -h, y: h },
  ];
}

export function PolygonEditor({ value, onChange, disabled = false }: PolygonEditorProps): React.ReactElement {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragViewport, setDragViewport] = useState<Viewport | null>(null);

  // Freeze the viewport during drag so the mouse doesn't chase a moving target.
  const viewport = useMemo(
    () => dragViewport ?? computeViewport(value),
    [dragViewport, value],
  );

  const bbox = useMemo(
    () => (value.length >= MIN_POLYGON_POINTS ? polygonBoundingBox(value) : null),
    [value],
  );

  const eventToCanvas = useCallback((e: MouseEvent<SVGSVGElement>): { x: number; y: number } => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (rect === undefined) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const handleMouseDown = useCallback((e: MouseEvent<SVGSVGElement>) => {
    if (disabled) return;
    // Right-click is handled by onContextMenu (delete).
    if (e.button !== 0) return;
    const { x, y } = eventToCanvas(e);
    const hitIdx = findNearestVertexIndex(x, y, value, viewport);
    if (hitIdx !== null) {
      setDraggingIndex(hitIdx);
      setDragViewport(viewport);
      return;
    }
    // Click on empty canvas → append a new vertex at the cursor.
    const world = canvasToWorld(x, y, viewport);
    onChange([...value, world]);
  }, [disabled, eventToCanvas, value, viewport, onChange]);

  const handleMouseMove = useCallback((e: MouseEvent<SVGSVGElement>) => {
    if (disabled || draggingIndex === null) return;
    const { x, y } = eventToCanvas(e);
    const world = canvasToWorld(x, y, viewport);
    const next = value.map((p, i) => (i === draggingIndex ? world : p));
    onChange(next);
  }, [disabled, draggingIndex, eventToCanvas, viewport, value, onChange]);

  const handleMouseUp = useCallback(() => {
    if (draggingIndex === null) return;
    setDraggingIndex(null);
    setDragViewport(null);
  }, [draggingIndex]);

  const handleContextMenu = useCallback((e: MouseEvent<SVGSVGElement>) => {
    e.preventDefault();
    if (disabled) return;
    const { x, y } = eventToCanvas(e);
    const hitIdx = findNearestVertexIndex(x, y, value, viewport);
    if (hitIdx === null) return;
    if (value.length <= MIN_POLYGON_POINTS) return; // Guard: never drop below 3.
    onChange(value.filter((_, i) => i !== hitIdx));
  }, [disabled, eventToCanvas, value, viewport, onChange]);

  const handleKeyDown = useCallback((e: KeyboardEvent<SVGSVGElement>) => {
    if (disabled) return;
    if ((e.key === "Delete" || e.key === "Backspace") && draggingIndex !== null) {
      if (value.length <= MIN_POLYGON_POINTS) return;
      onChange(value.filter((_, i) => i !== draggingIndex));
      setDraggingIndex(null);
      e.preventDefault();
    }
  }, [disabled, draggingIndex, value, onChange]);

  const handleReset = useCallback(() => {
    if (disabled) return;
    onChange(defaultRectangle(DEFAULT_RECTANGLE_METRES));
  }, [disabled, onChange]);

  const handleClear = useCallback(() => {
    if (disabled) return;
    onChange([]);
  }, [disabled, onChange]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const polylinePoints = value.map((p) => {
    const { cx, cy } = worldToCanvas(p, viewport);
    return `${cx.toString()},${cy.toString()}`;
  }).join(" ");

  return (
    <div data-testid="polygon-editor" style={containerStyle}>
      <svg
        ref={svgRef}
        width={CANVAS_PX}
        height={CANVAS_PX}
        role="application"
        aria-label="Polygon floor-plan editor"
        tabIndex={0}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onContextMenu={handleContextMenu}
        onKeyDown={handleKeyDown}
        style={{
          background: "#fafafa",
          border: "1px solid #ccc",
          borderRadius: 8,
          cursor: disabled ? "not-allowed" : draggingIndex !== null ? "grabbing" : "crosshair",
          userSelect: "none",
        }}
      >
        {/* Origin crosshair */}
        <line x1={CANVAS_PX / 2} y1={0} x2={CANVAS_PX / 2} y2={CANVAS_PX}
          stroke="#e0e0e0" strokeWidth={1} strokeDasharray="3 3" />
        <line x1={0} y1={CANVAS_PX / 2} x2={CANVAS_PX} y2={CANVAS_PX / 2}
          stroke="#e0e0e0" strokeWidth={1} strokeDasharray="3 3" />

        {/* Filled polygon (closed shape when ≥ 3 points) */}
        {value.length >= MIN_POLYGON_POINTS && (
          <polygon
            data-testid="polygon-shape"
            points={polylinePoints}
            fill="rgba(26,26,46,0.08)"
            stroke="#1a1a2e"
            strokeWidth={2}
          />
        )}

        {/* Open polyline (when < 3 points so the user sees edges being built) */}
        {value.length > 0 && value.length < MIN_POLYGON_POINTS && (
          <polyline
            points={polylinePoints}
            fill="none"
            stroke="#1a1a2e"
            strokeWidth={2}
          />
        )}

        {/* Vertex handles */}
        {value.map((p, i) => {
          const { cx, cy } = worldToCanvas(p, viewport);
          return (
            <circle
              key={`${String(cx)}-${String(cy)}-${String(i)}`}
              data-testid={`polygon-vertex-${String(i)}`}
              cx={cx}
              cy={cy}
              r={VERTEX_DRAW_RADIUS_PX}
              fill={draggingIndex === i ? "#c9a84c" : "#1a1a2e"}
              stroke="#fff"
              strokeWidth={2}
            />
          );
        })}
      </svg>

      <div style={readoutRowStyle}>
        <div data-testid="polygon-readout" style={{ fontSize: 12, color: "#555" }}>
          {value.length < MIN_POLYGON_POINTS ? (
            <span>
              Click on the canvas to add vertices. Need <strong>{String(MIN_POLYGON_POINTS - value.length)}</strong> more.
            </span>
          ) : (
            <span>
              <strong>{String(value.length)}</strong> vertices — bounding box{" "}
              <strong>{bbox !== null ? bbox.widthM.toFixed(2) : "—"}m</strong> ×{" "}
              <strong>{bbox !== null ? bbox.lengthM.toFixed(2) : "—"}m</strong>.
              Right-click a vertex to delete.
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            data-testid="polygon-reset-rectangle"
            onClick={handleReset}
            disabled={disabled}
            style={smallBtnStyle}
          >
            Reset to rectangle
          </button>
          <button
            type="button"
            data-testid="polygon-clear"
            onClick={handleClear}
            disabled={disabled || value.length === 0}
            style={smallBtnStyle}
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const readoutRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
};

const smallBtnStyle: CSSProperties = {
  padding: "4px 10px",
  fontSize: 12,
  borderRadius: 6,
  border: "1px solid #ccc",
  background: "#fff",
  cursor: "pointer",
};
