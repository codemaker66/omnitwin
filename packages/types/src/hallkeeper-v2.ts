import { z } from "zod";
import { ConfigurationIdSchema, LayoutStyleSchema } from "./configuration.js";
import { SetupPhaseSchema } from "./hallkeeper-accessories.js";
import { EventInstructionsSchema } from "./hallkeeper-instructions.js";
import { TimezoneSchema, DEFAULT_VENUE_TIMEZONE } from "./venue.js";
import { ZONES, ZoneSchema, type Zone } from "./zone.js";

// Re-export the Zone primitives so existing import paths through
// hallkeeper-v2 (including the `index.ts` re-export block) continue to
// resolve identically. Canonical source: `./zone.js`.
export { ZONES, ZoneSchema };
export type { Zone };

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
// Zone — canonical source now in ./zone.ts (extracted to break circular
// imports with hallkeeper-instructions ↔ event-requirements). Re-exported
// above so callers resolving via this module still work.
// ---------------------------------------------------------------------------

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
// SheetApproval — audit metadata for an approved sheet
//
// Populated by the data assembler when the linked configuration is in
// the `approved` review state AND a sheet snapshot has been frozen.
// Null otherwise — the renderer hides the approver stamp cleanly.
//
// `version` is the snapshot-table version (1-based, gapless within a
// configuration). `approverName` is the display name of the staff user
// who approved, falling back to their email if no name is set.
// ---------------------------------------------------------------------------

export const SheetApprovalSchema = z.object({
  /** Snapshot version — starts at 1, increments on each new approval. */
  version: z.number().int().min(1),
  /** ISO-8601 datetime the approval was recorded. */
  approvedAt: z.string().datetime(),
  /** Display name of the approving staff user (email fallback). */
  approverName: z.string().min(1).max(200),
});
export type SheetApproval = z.infer<typeof SheetApprovalSchema>;

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
    /**
     * IANA timezone for this venue. Renderers use it to format audit
     * timestamps (approval stamp, PDF footer) in the venue's
     * operational clock. Defaults to the flagship tenant's zone to
     * keep pre-timezone snapshots (before migration 0015) renderable.
     */
    timezone: TimezoneSchema.default(DEFAULT_VENUE_TIMEZONE),
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
  /**
   * Approval audit metadata. Set when the configuration is `approved`
   * AND a sheet snapshot exists; null otherwise. Consumers render an
   * "APPROVED — v{n} — {name} — {date}" stamp when this is non-null
   * and omit it cleanly when null — draft/under-review sheets must
   * not carry the visual authority of an approval stamp.
   */
  approval: SheetApprovalSchema.nullable(),
});

export type HallkeeperSheetV2 = z.infer<typeof HallkeeperSheetV2Schema>;
