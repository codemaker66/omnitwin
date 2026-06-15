import type { ReactElement } from "react";
import type { ProposalLayoutItemKind, ProposalLayoutSnapshot } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// ProposalLayoutVisual — read-only top-down SVG of the proposed layout
// (T-427 phase 7). Pure: it renders only the client-safe snapshot geometry
// (room dimensions + furniture footprints in metres), never internal IDs or
// editable controls. z (depth) maps to the SVG y-axis for a true plan view.
// ---------------------------------------------------------------------------

const VIEW_TARGET_PX = 680;
const PAD_PX = 16;
const FALLBACK_FILL = "rgba(140, 140, 140, 0.4)";
const FALLBACK_STROKE = "#888888";

const KIND_FILL: Record<ProposalLayoutItemKind, string> = {
  table: "rgba(201, 169, 106, 0.55)",
  chair: "rgba(178, 178, 166, 0.40)",
  stage: "rgba(120, 140, 180, 0.50)",
  other: FALLBACK_FILL,
};

const KIND_STROKE: Record<ProposalLayoutItemKind, string> = {
  table: "#c9a96a",
  chair: "#8b8b80",
  stage: "#7d8cb4",
  other: FALLBACK_STROKE,
};

export function ProposalLayoutVisual({
  snapshot,
}: {
  readonly snapshot: ProposalLayoutSnapshot;
}): ReactElement | null {
  if (snapshot.items.length === 0 || snapshot.roomWidthM <= 0 || snapshot.roomLengthM <= 0) {
    return null;
  }

  const scale = VIEW_TARGET_PX / snapshot.roomWidthM;
  const roomW = snapshot.roomWidthM * scale;
  const roomH = snapshot.roomLengthM * scale;
  const viewW = roomW + PAD_PX * 2;
  const viewH = roomH + PAD_PX * 2;

  const tables = snapshot.items.filter((item) => item.kind === "table").length;
  const chairs = snapshot.items.filter((item) => item.kind === "chair").length;
  const summary = `Read-only top-down plan of the proposed layout: ${String(tables)} tables, ${String(chairs)} seats, room about ${snapshot.roomWidthM.toFixed(1)} by ${snapshot.roomLengthM.toFixed(1)} metres.`;

  return (
    <svg
      data-testid="proposal-layout-visual"
      role="img"
      aria-label={summary}
      viewBox={`0 0 ${String(viewW)} ${String(viewH)}`}
      width="100%"
      style={{ display: "block", maxHeight: 460 }}
    >
      <rect
        x={PAD_PX}
        y={PAD_PX}
        width={roomW}
        height={roomH}
        rx={8}
        fill="rgba(255, 255, 255, 0.02)"
        stroke="rgba(201, 169, 106, 0.45)"
        strokeWidth={1.5}
      />
      {snapshot.items.map((item, index) => {
        const cx = PAD_PX + item.xM * scale;
        const cy = PAD_PX + item.zM * scale;
        const iw = Math.max(2, item.widthM * scale);
        const ih = Math.max(2, item.depthM * scale);
        const fill = KIND_FILL[item.kind];
        const stroke = KIND_STROKE[item.kind];

        if (item.shape === "round") {
          return (
            <ellipse key={index} cx={cx} cy={cy} rx={iw / 2} ry={ih / 2} fill={fill} stroke={stroke} strokeWidth={1} />
          );
        }
        return (
          <rect
            key={index}
            x={cx - iw / 2}
            y={cy - ih / 2}
            width={iw}
            height={ih}
            rx={1.5}
            fill={fill}
            stroke={stroke}
            strokeWidth={1}
            transform={`rotate(${String(item.rotationDeg)} ${String(cx)} ${String(cy)})`}
          />
        );
      })}
    </svg>
  );
}
