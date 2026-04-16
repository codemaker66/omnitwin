import { z } from "zod";
import { ConfigurationIdSchema, LayoutStyleSchema } from "./configuration.js";
import { SetupPhaseSchema } from "./hallkeeper-accessories.js";
import { EventInstructionsSchema } from "./hallkeeper-instructions.js";

// ---------------------------------------------------------------------------
// Hallkeeper Sheet V2 — phase ▸ zone ▸ row hierarchy
//
// v1 was a flat `rows[]` with `setupGroup` used to sort. That's what the
// old API serves today. v2 restructures the shape around how the
// hallkeeper actually works the room:
//
//   phase  — WHEN to set up (ordered by physical-dependency: structure →
//            furniture → dress → technical → final)
//   zone   — WHERE in the room (north/south/east/west walls, entrance,
//            centre, perimeter) so the hallkeeper walks a foot path
//   row    — the item itself, with `afterDepth` to sort prerequisite
//            chains within the zone (cloth before runner before
//            centrepiece)
//
// Every row has a stable `key` that persists checkbox state across
// hydrations (page refresh, tab reload). The key is built from
// phase|zone|name|afterDepth so the same logical item survives even
// if the config is re-saved with different placed-object UUIDs.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Zone — 7-zone classification (north/south/east/west walls + entrance +
// perimeter + centre). The demo established this taxonomy; we inherit it.
// ---------------------------------------------------------------------------

export const ZONES = [
  "North wall",
  "South wall",
  "East wall",
  "West wall",
  "Entrance",
  "Perimeter",
  "Centre",
] as const;

export const ZoneSchema = z.enum(ZONES);
export type Zone = z.infer<typeof ZoneSchema>;

// ---------------------------------------------------------------------------
// ManifestRowV2 — single manifest line
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// RowPosition — floor-plan coordinates for one placement aggregated into
// this row. Used by the tablet page to draw markers on the diagram and
// by the PDF for a "see diagram" reference grid. Coordinates are in the
// space's floor-plan frame, same units as space.widthM / lengthM.
// ---------------------------------------------------------------------------

export const RowPositionSchema = z.object({
  /** Source placed-object UUID — lets the tablet link back to the 3D scene. */
  objectId: z.string().uuid(),
  /** X in metres, floor-plan frame. */
  x: z.number(),
  /** Z in metres, floor-plan frame. */
  z: z.number(),
  /** Y rotation in radians — lets the renderer orient the marker. */
  rotationY: z.number(),
});
export type RowPosition = z.infer<typeof RowPositionSchema>;

// ---------------------------------------------------------------------------
// ManifestRowV2 — single manifest line
// ---------------------------------------------------------------------------

export const ManifestRowV2Schema = z.object({
  /** Stable idempotent key — survives re-saves. phase|zone|name|afterDepth. */
  key: z.string().min(1).max(300),
  /** Item name ("6ft Round Table with 10 chairs", "Gold Chair Sash"). */
  name: z.string().min(1).max(200),
  /** Category — "table", "chair", "decor", "av"… drives icon choice. */
  category: z.string().min(1).max(40),
  /** Quantity at this zone. */
  qty: z.number().int().nonnegative(),
  /**
   * Dependency depth within the zone — 0 renders before 1 before 2.
   * Used to order "cloth → runner → centrepiece" under one table row.
   */
  afterDepth: z.number().int().nonnegative().max(5),
  /** True if this row is an accessory implied by a parent placement. */
  isAccessory: z.boolean(),
  /**
   * Planner-authored notes from the union of placed-object `notes`
   * fields that aggregate into this row. Empty string when no source
   * placement carried a note.
   */
  notes: z.string().max(2000).default(""),
  /**
   * Floor-plan coordinates for every placement that aggregates into
   * this row. Empty for accessory rows — accessories don't have their
   * own coordinates, they follow their parent's.
   */
  positions: z.array(RowPositionSchema).default([]),
});

export type ManifestRowV2 = z.infer<typeof ManifestRowV2Schema>;

// ---------------------------------------------------------------------------
// PhaseZones — rows grouped by zone, sorted by afterDepth
// ---------------------------------------------------------------------------

export const PhaseZoneSchema = z.object({
  zone: ZoneSchema,
  rows: z.array(ManifestRowV2Schema),
});
export type PhaseZone = z.infer<typeof PhaseZoneSchema>;

export const PhaseSchema = z.object({
  phase: SetupPhaseSchema,
  zones: z.array(PhaseZoneSchema),
});
export type Phase = z.infer<typeof PhaseSchema>;

// ---------------------------------------------------------------------------
// Timing — "setup must be complete by X, event starts Y"
// ---------------------------------------------------------------------------

export const TimingSchema = z.object({
  /** ISO-8601 datetime the event is scheduled to begin. */
  eventStart: z.string().datetime(),
  /** ISO-8601 datetime setup must be complete. Default = eventStart - 90min. */
  setupBy: z.string().datetime(),
  /** Minutes between setupBy and eventStart for a "buffer" chip on the sheet. */
  bufferMinutes: z.number().int().nonnegative(),
});
export type Timing = z.infer<typeof TimingSchema>;

// ---------------------------------------------------------------------------
// HallkeeperSheetV2 — full payload consumed by the web view / PDF renderer
// ---------------------------------------------------------------------------

export const HallkeeperSheetV2Schema = z.object({
  config: z.object({
    id: ConfigurationIdSchema,
    name: z.string(),
    guestCount: z.number().int().nonnegative(),
    layoutStyle: LayoutStyleSchema,
  }),
  venue: z.object({
    name: z.string(),
    address: z.string(),
    logoUrl: z.string().nullable().optional(),
  }),
  space: z.object({
    name: z.string(),
    widthM: z.number(),
    lengthM: z.number(),
    heightM: z.number(),
  }),
  timing: TimingSchema.nullable(),
  /**
   * Planner-authored human context — special instructions, day-of
   * contact, per-phase deadlines, access notes. Null when the planner
   * hasn't filled any of it out yet; renderers should hide the
   * instructions section cleanly in that case rather than showing a
   * stub.
   */
  instructions: EventInstructionsSchema.nullable(),
  phases: z.array(PhaseSchema),
  totals: z.object({
    /** One entry per distinct item name, summed across phases + zones. */
    entries: z.array(z.object({
      name: z.string(),
      category: z.string(),
      qty: z.number().int().nonnegative(),
    })),
    /** Total row count — used by the progress bar denominator. */
    totalRows: z.number().int().nonnegative(),
    /** Total item count (sum of qty across rows) — headline number. */
    totalItems: z.number().int().nonnegative(),
  }),
  diagramUrl: z.string().nullable(),
  webViewUrl: z.string(),
  generatedAt: z.string().datetime(),
});

export type HallkeeperSheetV2 = z.infer<typeof HallkeeperSheetV2Schema>;
