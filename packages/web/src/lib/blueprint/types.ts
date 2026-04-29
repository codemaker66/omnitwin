// ---------------------------------------------------------------------------
// Blueprint domain types — purely descriptive, no React, no runtime values.
//
// The blueprint is a 2D top-down floor plan. All world coordinates are in
// metres with origin at the room's top-left corner (y increases downward,
// matching SVG convention so renderers don't flip axes).
// ---------------------------------------------------------------------------

/** A point in the room's metre-space. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Axis-aligned room rectangle. Width = x-axis, length = y-axis. */
export interface RoomDimensions {
  readonly widthM: number;
  readonly lengthM: number;
  /** Label points drawn on the room perimeter (e.g. "WINDOWS"). */
  readonly labels?: readonly RoomLabel[];
  /** Door markers — small circles on the wall. */
  readonly doors?: readonly DoorMarker[];
  /** Optional notch cut out of the room (e.g. the bar alcove on the mock). */
  readonly notch?: RoomNotch;
}

export interface RoomLabel {
  readonly text: string;
  /** Position in metres. Rendered in the room's ink colour. */
  readonly position: Point;
}

/** A wall-mounted door. Positioned ON a wall, drawn as a small filled dot. */
export interface DoorMarker {
  readonly wall: "north" | "south" | "east" | "west";
  /** Distance along the wall in metres, measured from the wall's start corner. */
  readonly distanceM: number;
}

/** Cut-out from the room rectangle (e.g. an L-shape or recess). */
export interface RoomNotch {
  readonly x: number;
  readonly y: number;
  readonly widthM: number;
  readonly lengthM: number;
}

// ---------------------------------------------------------------------------
// Furniture items
// ---------------------------------------------------------------------------

export type ItemShape = "round" | "rect" | "dancefloor" | "bar";

interface BaseItem {
  readonly id: string;
  readonly kind: ItemKind;
  /** Optional explicit rotation in degrees (0 = aligned with room axes). */
  readonly rotationDeg?: number;
  /** When true, the item can't be dragged, resized, rotated, or deleted. */
  readonly locked?: boolean;
}

export type ItemKind =
  | "round-table"
  | "long-table"
  | "stage"
  | "top-table"
  | "bar"
  | "dancefloor";

export interface RoundTableItem extends BaseItem {
  readonly kind: "round-table";
  readonly shape: "round";
  /** Centre of the table in metres. */
  readonly center: Point;
  readonly diameterM: number;
  readonly seats: number;
  readonly linen?: string;
  readonly centrepiece?: string;
  /**
   * Actual chair positions (in metre-space, blueprint convention with
   * top-left origin) when the table is grouped with chairs in the 3D
   * scene. When omitted, renderers fall back to a uniform algorithmic
   * ring derived from `seats`. Real positions are required so the 2D
   * view reflects what 3D shows — including wall-clearance offsets the
   * 3D auto-arrange has applied.
   */
  readonly chairs?: readonly Point[];
}

export interface RectItem extends BaseItem {
  readonly kind: "long-table" | "stage" | "top-table" | "bar";
  readonly shape: "rect" | "bar";
  /** Top-left corner of the rectangle in metres. */
  readonly topLeft: Point;
  readonly widthM: number;
  readonly lengthM: number;
  /** If a table, how many seats along the length. */
  readonly seats?: number;
  readonly linen?: string;
  readonly centrepiece?: string;
}

export interface DancefloorItem extends BaseItem {
  readonly kind: "dancefloor";
  readonly shape: "dancefloor";
  readonly topLeft: Point;
  readonly widthM: number;
  readonly lengthM: number;
}

export type BlueprintItem = RoundTableItem | RectItem | DancefloorItem;

// ---------------------------------------------------------------------------
// Scene — the top-level container the canvas consumes
// ---------------------------------------------------------------------------

export type EventType = "wedding" | "gala" | "conference";

export interface BlueprintScene {
  readonly roomName: string;
  readonly layoutName: string;
  readonly status: "draft" | "submitted" | "approved";
  readonly eventType: EventType;
  readonly guestCount: number;
  readonly room: RoomDimensions;
  readonly items: readonly BlueprintItem[];
  /** Last save timestamp (epoch ms); null if never saved. */
  readonly lastSavedAtMs: number | null;
}

// ---------------------------------------------------------------------------
// Catalogue chips (left sidebar — "DRAG & DROP")
// ---------------------------------------------------------------------------

export interface CatalogueChip {
  readonly label: string;
  readonly kind: ItemKind;
  readonly marker: "circle" | "square-outline" | "square-filled" | "bar" | "sparkle";
}

export const DEFAULT_CATALOGUE: readonly CatalogueChip[] = [
  { label: "Round 10", kind: "round-table", marker: "circle" },
  { label: "Long 12", kind: "long-table", marker: "square-outline" },
  { label: "Stage", kind: "stage", marker: "square-filled" },
  { label: "Bar", kind: "bar", marker: "bar" },
  { label: "Dancefloor", kind: "dancefloor", marker: "sparkle" },
];

// ---------------------------------------------------------------------------
// Status metrics (bottom bar)
// ---------------------------------------------------------------------------

export interface StatusMetrics {
  readonly totalSeats: number;
  readonly roundCount: number;
  readonly floorUsedPercent: number;
  readonly fireEgressClear: boolean;
}
