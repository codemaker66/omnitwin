import { type ReactElement, type ReactNode } from "react";
import { toRealWorld } from "../../constants/scale.js";
import type { RoomSide } from "../../lib/auto-fill.js";
import type { AisleLine } from "../../lib/clearance-ring.js";
import { toScreen, type DrawingView, type DrawnPoint, type DrawnRoom, type DrawnUnit } from "../../lib/plan-drawing-model.js";
import type { SnapGuide } from "../../lib/snap-guide.js";

// ---------------------------------------------------------------------------
// What Plan's Drawing draws (T-674; spec §6.3, §7.2), as SVG in the paper's own
// pixels: the room (its walls cut through at their doors and windows, the
// doors' leaves drawn open with their swing, the fireplace), the pieces (each
// table with its chairs and its number), the aisles, the snap guides and the
// area being selected. Pure renderers of the model; PlanDrawing owns the view
// and the hand. Colours, weights and type are plan-drawing.css's.
// ---------------------------------------------------------------------------

/** A coordinate to a tenth of a pixel, as SVG writes it. */
export function n(value: number): string {
  return String(Math.round(value * 10) / 10);
}

function pathOf(points: readonly DrawnPoint[], view: DrawingView): string {
  return `${points.map((point, index) => {
    const at = toScreen(view, point);
    return `${index === 0 ? "M" : "L"}${n(at.x)} ${n(at.y)}`;
  }).join(" ")} Z`;
}

/** About how wide a run of Inter is at `size` px, for whether a label fits its piece. */
function textWidth(text: string, size: number): number {
  return text.length * size * 0.56;
}

// -- The room --------------------------------------------------------------

function outward(side: RoomSide): DrawnPoint {
  switch (side) {
    case "xMin": return { x: -1, z: 0 };
    case "xMax": return { x: 1, z: 0 };
    case "zMin": return { x: 0, z: -1 };
    case "zMax": return { x: 0, z: 1 };
  }
}

function Segment({ a, b, view, className }: { readonly a: DrawnPoint; readonly b: DrawnPoint; readonly view: DrawingView; readonly className: string }): ReactElement {
  const p = toScreen(view, a);
  const q = toScreen(view, b);
  return <line className={className} x1={n(p.x)} y1={n(p.y)} x2={n(q.x)} y2={n(q.y)} />;
}

export function RoomDrawing({ room, view, hatch }: { readonly room: DrawnRoom; readonly view: DrawingView; readonly hatch: string }): ReactElement {
  const half = { x: room.widthM / 2, z: room.lengthM / 2 };
  const thick = (side: RoomSide): number => room.walls.find((wall) => wall.side === side)?.thickness ?? 0;
  const inner: DrawnPoint[] = [{ x: -half.x, z: -half.z }, { x: half.x, z: -half.z }, { x: half.x, z: half.z }, { x: -half.x, z: half.z }];
  const outer: DrawnPoint[] = [
    { x: -half.x - thick("xMin"), z: -half.z - thick("zMin") }, { x: half.x + thick("xMax"), z: -half.z - thick("zMin") },
    { x: half.x + thick("xMax"), z: half.z + thick("zMax") }, { x: -half.x - thick("xMin"), z: half.z + thick("zMax") },
  ];
  // A cut runs a pixel and a half past both faces, so neither face's line crosses an opening.
  const pad = 1.5 / view.scale;
  const cuts: ReactNode[] = [];
  const marks: ReactNode[] = [];
  const names: ReactNode[] = [];
  room.openings.forEach((opening, index) => {
    const key = String(index);
    const out = outward(opening.side);
    const depth = thick(opening.side);
    const length = Math.hypot(opening.to.x - opening.from.x, opening.to.z - opening.from.z);
    const unit = { x: (opening.to.x - opening.from.x) / Math.max(1e-9, length), z: (opening.to.z - opening.from.z) / Math.max(1e-9, length) };
    const at = (u: number, d: number): DrawnPoint => ({ x: opening.from.x + unit.x * u + out.x * d, z: opening.from.z + unit.z * u + out.z * d });
    cuts.push(<path key={`cut-${key}`} className="pc-drawing__cut" d={pathOf([at(0, -pad), at(length, -pad), at(length, depth + pad), at(0, depth + pad)], view)} />);
    marks.push(<Segment key={`j0-${key}`} a={at(0, 0)} b={at(0, depth)} view={view} className="pc-drawing__wall-edge" />);
    marks.push(<Segment key={`j1-${key}`} a={at(length, 0)} b={at(length, depth)} view={view} className="pc-drawing__wall-edge" />);
    if (opening.kind === "window") {
      marks.push(<Segment key={`g0-${key}`} a={at(0, depth * 0.42)} b={at(length, depth * 0.42)} view={view} className="pc-drawing__glass" />);
      marks.push(<Segment key={`g1-${key}`} a={at(0, depth * 0.58)} b={at(length, depth * 0.58)} view={view} className="pc-drawing__glass" />);
      return;
    }
    // The hall's doors are pairs hung at the hall face that open outward (hall-spec HALL_DOORS): each leaf drawn open, with its swing.
    const leaf = length / 2;
    const radius = n(leaf * view.scale);
    const swing = (hingeU: number, shutU: number): string => {
      const hinge = toScreen(view, at(hingeU, 0));
      const open = toScreen(view, at(hingeU, leaf));
      const shut = toScreen(view, at(shutU, 0));
      const turn = (open.x - hinge.x) * (shut.y - hinge.y) - (open.y - hinge.y) * (shut.x - hinge.x);
      return `M${n(open.x)} ${n(open.y)} A${radius} ${radius} 0 0 ${turn > 0 ? "1" : "0"} ${n(shut.x)} ${n(shut.y)}`;
    };
    marks.push(<Segment key={`l0-${key}`} a={at(0, 0)} b={at(0, leaf)} view={view} className="pc-drawing__leaf" />);
    marks.push(<Segment key={`l1-${key}`} a={at(length, 0)} b={at(length, leaf)} view={view} className="pc-drawing__leaf" />);
    marks.push(<path key={`s0-${key}`} className="pc-drawing__swing" d={swing(0, leaf)} />);
    marks.push(<path key={`s1-${key}`} className="pc-drawing__swing" d={swing(length, length - leaf)} />);
    if (opening.name !== null) {
      const middle = toScreen(view, at(length / 2, depth));
      names.push(<SideText key={`n-${key}`} side={opening.side} x={middle.x} y={middle.y} gap={12} className="pc-drawing__door-name">{opening.name}</SideText>);
    }
  });
  const fireplace = room.fireplace;
  const fireLabel = fireplace === null ? null : toScreen(view, fireplace.labelAt);
  return (
    <g className="pc-drawing__room">
      <path className="pc-drawing__floor" d={pathOf(inner, view)} />
      <path className="pc-drawing__wall" fill={hatch} fillRule="evenodd" d={`${pathOf(outer, view)} ${pathOf(inner, view)}`} />
      <path className="pc-drawing__wall-face" d={pathOf(inner, view)} />
      <path className="pc-drawing__wall-edge" d={pathOf(outer, view)} />
      {cuts}
      {fireplace === null ? null : (
        <>
          <path className="pc-drawing__cut" d={pathOf(fireplace.firebox, view)} />
          <path className="pc-drawing__firebox" d={pathOf(fireplace.firebox, view)} />
          <path className="pc-drawing__surround" d={pathOf(fireplace.surround, view)} />
        </>
      )}
      {marks}
      {fireLabel === null ? null : <text className="pc-drawing__feature" x={n(fireLabel.x)} y={n(fireLabel.y)} dominantBaseline="middle">Fireplace</text>}
      {room.walls.map((wall) => {
        if (wall.name === null) return null;
        const across = wall.side === "xMin" || wall.side === "xMax";
        const out = outward(wall.side);
        const face = across ? { x: out.x * (half.x + wall.thickness), z: wall.nameAt } : { x: wall.nameAt, z: out.z * (half.z + wall.thickness) };
        const at = toScreen(view, face);
        return <SideText key={wall.side} side={wall.side} x={at.x} y={at.y} gap={12} className="pc-drawing__wall-name">{wall.name}</SideText>;
      })}
      {names}
      <ScaleBar room={room} view={view} />
    </g>
  );
}

/** Words set just outside a wall, reading along it; the end walls' turn to run up and down the page. */
function SideText({ side, x, y, gap, className, children }: { readonly side: RoomSide; readonly x: number; readonly y: number; readonly gap: number; readonly className: string; readonly children: string }): ReactElement {
  const out = outward(side);
  const px = x + out.x * gap;
  const py = y + out.z * gap;
  const turn = side === "xMin" ? -90 : side === "xMax" ? 90 : 0;
  return (
    <text className={className} x={n(px)} y={n(py)} textAnchor="middle" dominantBaseline="middle" transform={turn === 0 ? undefined : `rotate(${String(turn)} ${n(px)} ${n(py)})`}>
      {children}
    </text>
  );
}

/** A scale bar over the far end of the top wall, a round length about 90–200 px long. */
function ScaleBar({ room, view }: { readonly room: DrawnRoom; readonly view: DrawingView }): ReactElement | null {
  const metres = [1, 2, 5, 10].find((m) => m * view.scale >= 90) ?? 10;
  const top = room.walls.find((wall) => wall.side === "zMin")?.thickness ?? 0;
  const end = room.walls.find((wall) => wall.side === "xMax")?.thickness ?? 0;
  const corner = toScreen(view, { x: room.widthM / 2 + end, z: -room.lengthM / 2 - top });
  const y = corner.y - 12;
  const x1 = corner.x;
  const x0 = x1 - metres * view.scale;
  if (x0 < 0 || y < 0) return null;
  return (
    <g className="pc-drawing__scale" aria-hidden="true">
      <line x1={n(x0)} y1={n(y)} x2={n(x1)} y2={n(y)} />
      <line x1={n(x0)} y1={n(y - 3)} x2={n(x0)} y2={n(y + 3)} />
      <line x1={n(x1)} y1={n(y - 3)} x2={n(x1)} y2={n(y + 3)} />
      <text x={n(x0 - 6)} y={n(y)} textAnchor="end" dominantBaseline="middle">{`${String(metres)} m`}</text>
    </g>
  );
}

export function EmptyNote({ view }: { readonly view: DrawingView }): ReactElement {
  const at = toScreen(view, { x: 0, z: 0 });
  return <text className="pc-drawing__empty" x={n(at.x)} y={n(at.y)} textAnchor="middle" dominantBaseline="middle">Nothing on the floor yet</text>;
}

// -- The pieces --------------------------------------------------------------

/** The number alone ("7") where "Table 7" will not fit its table. */
function shortLabel(label: string): string | null {
  const match = /^Table (\d+)$/u.exec(label);
  return match === null ? null : match[1] ?? null;
}

export function UnitDrawing({ unit, view, selected }: { readonly unit: DrawnUnit; readonly view: DrawingView; readonly selected: boolean }): ReactElement {
  const across = unit.span * view.scale;
  let label: string | null = null;
  if (unit.label !== null) {
    if (textWidth(unit.label, 12) + 8 <= across) label = unit.label;
    else if (unit.labelKind === "number") {
      const short = shortLabel(unit.label);
      if (short !== null && textWidth(short, 12) + 6 <= across) label = short;
    }
  }
  const at = toScreen(view, unit.labelAt);
  const detail = label !== null && unit.detail !== null && textWidth(unit.detail, 11) + 8 <= across ? unit.detail : null;
  return (
    <g className="pc-drawing__unit" data-selected={selected ? "" : undefined} data-unit={unit.mainId}>
      {unit.pieces.map((piece) => {
        const className = `pc-drawing__piece pc-drawing__piece--${piece.role}`;
        if (piece.shape.kind === "circle") {
          const c = toScreen(view, piece.shape.centre);
          return <circle key={piece.id} data-piece={piece.id} className={className} cx={n(c.x)} cy={n(c.y)} r={n(piece.shape.radius * view.scale)} />;
        }
        return (
          <g key={piece.id}>
            <path data-piece={piece.id} className={className} d={pathOf(piece.shape.points, view)} />
            {piece.back === null ? null : <Segment a={piece.back[0]} b={piece.back[1]} view={view} className="pc-drawing__back" />}
          </g>
        );
      })}
      {unit.outline === null ? null : <path className="pc-drawing__outline" d={pathOf(unit.outline, view)} />}
      {label === null ? null : (
        <text className={`pc-drawing__label pc-drawing__label--${unit.labelKind ?? "name"}`} x={n(at.x)} y={n(at.y + (detail === null ? 0 : -7))} textAnchor="middle" dominantBaseline="middle">
          {label}
        </text>
      )}
      {detail === null ? null : <text className="pc-drawing__detail" x={n(at.x)} y={n(at.y + 9)} textAnchor="middle" dominantBaseline="middle">{detail}</text>}
    </g>
  );
}

export function AisleDrawing({ aisle, view }: { readonly aisle: AisleLine; readonly view: DrawingView }): ReactElement {
  const a = toScreen(view, aisle.from);
  const b = toScreen(view, aisle.to);
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const ux = length === 0 ? 1 : (b.x - a.x) / length;
  const uy = length === 0 ? 0 : (b.y - a.y) / length;
  const tick = (p: { readonly x: number; readonly y: number }): ReactElement => <line x1={n(p.x - uy * 4)} y1={n(p.y + ux * 4)} x2={n(p.x + uy * 4)} y2={n(p.y - ux * 4)} />;
  const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const width = textWidth(aisle.words, 12) + 12;
  return (
    <g className={`pc-drawing__aisle pc-drawing__aisle--${aisle.tone}`} aria-hidden="true">
      <line x1={n(a.x)} y1={n(a.y)} x2={n(b.x)} y2={n(b.y)} />
      {tick(a)}
      {tick(b)}
      <rect className="pc-drawing__aisle-plate" x={n(middle.x - width / 2)} y={n(middle.y - 10)} width={n(width)} height="20" rx="4" />
      <text x={n(middle.x)} y={n(middle.y)} textAnchor="middle" dominantBaseline="middle">{aisle.words}</text>
    </g>
  );
}

export function GuideLine({ guide, view }: { readonly guide: SnapGuide; readonly view: DrawingView }): ReactElement {
  const along = (value: number): DrawnPoint => (guide.axis === "x"
    ? { x: toRealWorld(value), z: toRealWorld(guide.coord) }
    : { x: toRealWorld(guide.coord), z: toRealWorld(value) });
  return <Segment a={along(guide.start)} b={along(guide.end)} view={view} className="pc-drawing__guide" />;
}

export function BoxDrawing({ a, b, view }: { readonly a: DrawnPoint; readonly b: DrawnPoint; readonly view: DrawingView }): ReactElement {
  const p = toScreen(view, a);
  const q = toScreen(view, b);
  return <rect className="pc-drawing__box" x={n(Math.min(p.x, q.x))} y={n(Math.min(p.y, q.y))} width={n(Math.abs(q.x - p.x))} height={n(Math.abs(q.y - p.y))} />;
}
