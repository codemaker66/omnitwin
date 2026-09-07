import { useMemo } from "react";
import type { Phase } from "@omnitwin/types";
const GOLD = "#986246";
import type { PlanPoint, ProjectedFrozenPlan } from "../../lib/hallkeeper-frozen-plan.js";
import { collectFloorPlanMarkers, markerColourFor } from "../../lib/hallkeeper-geometry.js";

const pointsAttribute = (points: readonly PlanPoint[]): string => points.map((point) => `${String(point.x)},${String(point.y)}`).join(" ");

export function SavedFloorPlan({ plan, phases, highlightedRowKey, onMarkerClick }: {
  readonly plan: ProjectedFrozenPlan;
  readonly phases: readonly Phase[];
  readonly highlightedRowKey: string | null;
  readonly onMarkerClick: (rowKey: string) => void;
}): React.ReactElement {
  const links = useMemo(() => {
    // Only IDs explicitly present in manifest positions establish a row link.
    // An unlinked chair remains visible; proximity does not prove bundle membership.
    const byId = new Map<string, { key: string; name: string }[]>();
    for (const marker of collectFloorPlanMarkers(phases, { widthM: 1, lengthM: 1 })) {
      const rows = byId.get(marker.objectId) ?? [];
      if (!rows.some((row) => row.key === marker.rowKey)) rows.push({ key: marker.rowKey, name: marker.rowName });
      byId.set(marker.objectId, rows);
    }
    return byId;
  }, [phases]);
  // Choose a labelled scale length that fits even a very small saved room.
  const scaleMetres = Math.min(1, 10 ** Math.floor(Math.log10(200 / plan.pointsPerMetre)));
  return <div style={{ background: "#f8f5ee", border: "1px solid #e4dcd0", borderRadius: 10, overflow: "hidden" }}>
    <p style={{ margin: "16px 20px 0", color: "#686e5f", fontSize: 13 }}>
      Saved layout · {plan.objects.length} items
    </p>
    <svg viewBox="0 0 1000 648" preserveAspectRatio="xMidYMid meet" role="group" aria-label="Interactive saved floor plan"
      style={{ display: "block", width: "100%", height: "auto" }}>
      <polygon data-room-outline points={pointsAttribute(plan.outline)} fill="#fffdf7" stroke="#8a8d7c" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      {plan.objects.map(({ object, center, corners, width, depth }) => {
        const rows = links.get(object.objectId) ?? [];
        const current = rows.find((row) => row.key === highlightedRowKey);
        const row = current ?? rows[0];
        const highlighted = current !== undefined;
        const dimmed = highlightedRowKey !== null && !highlighted;
        const colour = highlighted ? GOLD : markerColourFor(object.category);
        const shape = { "data-footprint-shape": true, fill: colour, fillOpacity: highlighted ? 0.4 : 0.16,
          stroke: colour, strokeWidth: highlighted ? 2 : 1, vectorEffect: "non-scaling-stroke" } as const;
        return <g key={object.objectId} data-footprint-id={object.objectId} data-highlighted={highlighted}
          opacity={dimmed ? 0.35 : 1} role={row === undefined ? undefined : "button"} tabIndex={row === undefined ? undefined : 0}
          aria-label={row === undefined ? undefined : `Find ${row.name} in the manifest`}
          aria-pressed={row === undefined ? undefined : highlighted}
          style={{ cursor: row === undefined ? "default" : "pointer" }}
          onClick={row === undefined ? undefined : (event) => { event.stopPropagation(); onMarkerClick(row.key); }}
          onKeyDown={row === undefined ? undefined : (event) => {
            if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); onMarkerClick(row.key); }
          }}>
          <title>{object.name}{row === undefined ? " · saved footprint" : ` · ${row.name}`}</title>
          {object.collisionType === "cylinder"
            ? <ellipse {...shape} cx={center.x} cy={center.y} rx={width / 2} ry={depth / 2}
              transform={`rotate(${String(-object.rotationY * 180 / Math.PI)} ${String(center.x)} ${String(center.y)})`} />
            : <polygon {...shape} points={pointsAttribute(corners)} />}
        </g>;
      })}
      {plan.objects.length === 0 && <text x={500} y={300} textAnchor="middle" fill="#686e5f" fontSize={22}>No furniture in this saved layout</text>}
      <g aria-label={`${String(scaleMetres)} metre scale`} fill="#686e5f" stroke="#686e5f">
        <path d={`M32 616v8h${String(plan.pointsPerMetre * scaleMetres)}v-8`} fill="none" strokeWidth={1.5} />
        <text x={40 + plan.pointsPerMetre * scaleMetres} y={629} stroke="none" fontSize={16}>{scaleMetres} m</text>
      </g>
    </svg>
  </div>;
}
