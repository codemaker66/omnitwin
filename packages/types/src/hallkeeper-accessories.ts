import { z } from "zod";

// ---------------------------------------------------------------------------
// Hallkeeper accessories — the "implied items" model
//
// Some catalogue entries (a round table, a PA speaker) carry DRESSING or
// AUXILIARY items that the planner does not explicitly place in the 3D
// editor: a tablecloth, a runner, a centrepiece, a wireless mic for the
// speaker. The hallkeeper on the day has to set those up too, so the
// manifest has to list them.
//
// Approach: a static lookup, `ACCESSORY_RULES`, keyed by asset name.
// Each entry declares one or more `ImpliedAccessory` items with:
//   - quantityPerParent: how many per placed parent instance
//   - phase: which setup phase the accessory belongs to (usually "dress"
//     or "final", later than the parent's phase)
//   - afterDepth: dependency layering WITHIN the parent group. A runner
//     goes on AFTER the tablecloth (depth 1), a centrepiece goes on
//     AFTER the runner (depth 2). The hallkeeper page orders items by
//     depth so they're laid out in a valid sequence.
//
// Why a static lookup and not a DB column: the current asset_definitions
// table is a shared catalogue used for rendering — coupling it to
// hallkeeper-specific policy would leak product logic into the rendering
// schema. A lookup module ships as typed data, is versionable via git,
// and can move to a DB table later if a second venue wants different
// rules without redeploy.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Setup phase — drives top-level ordering on the hallkeeper sheet
// ---------------------------------------------------------------------------

export const SETUP_PHASES = [
  "structure",   // risers, dance floor — things that define the floor plan
  "furniture",   // tables, chairs, lecterns — the bulk items
  "dress",       // linens, runners, centrepieces — goes onto furniture
  "technical",   // PA, projectors, lighting — cabled, tested, fired
  "final",       // candles, welcome signs, guest book — last-touch polish
] as const;

export const SetupPhaseSchema = z.enum(SETUP_PHASES);
export type SetupPhase = z.infer<typeof SetupPhaseSchema>;

/**
 * Shared display metadata for each setup phase — label, icon, ordinal.
 * Single source of truth for every renderer (tablet page, PDF,
 * event-details form, instructions banner). Ordinal is 1-based to
 * match how the PDF numbers phases ("Phase 1 — Structure").
 */
export const PHASE_METADATA: Readonly<Record<SetupPhase, {
  readonly label: string;
  readonly icon: string;
  readonly order: number;
}>> = {
  structure: { label: "Structure",      icon: "▣", order: 1 },
  furniture: { label: "Furniture",      icon: "▬", order: 2 },
  dress:     { label: "Dress",          icon: "✦", order: 3 },
  technical: { label: "Technical",      icon: "⚡", order: 4 },
  final:     { label: "Final Touches",  icon: "★", order: 5 },
};

/** Default phase for a category when no override is specified. */
export function defaultPhaseForCategory(category: string): SetupPhase {
  switch (category) {
    case "stage": return "structure";
    case "table":
    case "chair":
    case "lectern": return "furniture";
    case "av":
    case "lighting": return "technical";
    case "decor": return "dress";
    default: return "final";
  }
}

// ---------------------------------------------------------------------------
// ImpliedAccessory — one auxiliary item attached to a parent
// ---------------------------------------------------------------------------

export const ImpliedAccessorySchema = z.object({
  /** Human-readable item name ("Ivory Tablecloth", "Wireless Microphone"). */
  name: z.string().trim().min(1).max(200),
  /** Category for icon/grouping on the sheet. */
  category: z.string().trim().min(1).max(40),
  /** How many accessories per parent instance (10 chairs → 10 sashes). */
  quantityPerParent: z.number().int().positive().max(100),
  /** Which phase this accessory belongs to. Must be ≥ parent's phase. */
  phase: SetupPhaseSchema,
  /**
   * Dependency depth within the parent group.
   *   0 = set up immediately after parent (tablecloth on table)
   *   1 = set up after depth-0 (runner on cloth)
   *   2 = set up after depth-1 (centrepiece on runner)
   * The hallkeeper sheet sorts rows within a zone by this.
   */
  afterDepth: z.number().int().nonnegative().max(5),
});

export type ImpliedAccessory = z.infer<typeof ImpliedAccessorySchema>;

// ---------------------------------------------------------------------------
// Accessory rules — keyed by asset NAME (stable) rather than id (UUID,
// unstable across environments). Unknown assets return [].
// ---------------------------------------------------------------------------

// Keys match the `name` field in CANONICAL_ASSETS (the single source of
// truth for asset naming). Items not in the canonical catalogue can also
// have rules here for future admin-created assets — `accessoriesFor`
// returns [] for unknown names, so missing rules are safe.
export const ACCESSORY_RULES: Readonly<Record<string, readonly ImpliedAccessory[]>> = {
  // --- Tables → cloth, runner, centrepiece, candles, number card ---
  "6ft Round Table": [
    { name: "Ivory Tablecloth", category: "decor", quantityPerParent: 1, phase: "dress", afterDepth: 0 },
    { name: "Gold Organza Runner", category: "decor", quantityPerParent: 1, phase: "dress", afterDepth: 1 },
    { name: "Floral Centrepiece (low)", category: "decor", quantityPerParent: 1, phase: "dress", afterDepth: 2 },
    { name: "Acrylic Table Number", category: "decor", quantityPerParent: 1, phase: "dress", afterDepth: 2 },
    { name: "LED Pillar Candle", category: "decor", quantityPerParent: 3, phase: "final", afterDepth: 0 },
  ],
  "6ft Trestle Table": [
    { name: "Rectangular Ivory Tablecloth", category: "decor", quantityPerParent: 1, phase: "dress", afterDepth: 0 },
    { name: "Gold Organza Runner", category: "decor", quantityPerParent: 1, phase: "dress", afterDepth: 1 },
  ],
  "4ft Trestle Table": [
    { name: "Rectangular Ivory Tablecloth", category: "decor", quantityPerParent: 1, phase: "dress", afterDepth: 0 },
    { name: "Gold Organza Runner", category: "decor", quantityPerParent: 1, phase: "dress", afterDepth: 1 },
  ],

  // --- Chairs → sash (one per chair, dressing phase) ---
  "Banquet Chair": [
    { name: "Gold Chair Sash", category: "decor", quantityPerParent: 1, phase: "dress", afterDepth: 0 },
  ],

  // --- Stage → skirt to hide structure ---
  "Platform": [
    { name: "Black Stage Skirt", category: "decor", quantityPerParent: 1, phase: "dress", afterDepth: 0 },
  ],
  "Narrow Platform": [
    { name: "Black Stage Skirt", category: "decor", quantityPerParent: 1, phase: "dress", afterDepth: 0 },
  ],

  // --- AV → cables, associated kit ---
  "Laser Projector": [
    { name: "HDMI Cable (5m)", category: "av", quantityPerParent: 1, phase: "technical", afterDepth: 1 },
  ],
  "Projector Screen": [], // explicit — no accessories
  "Table Microphone": [],
  "Mic Stand": [],
  "Laptop": [],
  "Lectern": [
    { name: "Bottled Water (500ml)", category: "decor", quantityPerParent: 1, phase: "final", afterDepth: 0 },
  ],

  // --- Decor ---
  "Black Table Cloth": [], // placed explicitly — no secondary dressings
};

/**
 * Lookup accessories for an asset by name. Unknown names return [] so
 * every asset is safe to feed in without a cascade of missing-data errors.
 */
export function accessoriesFor(assetName: string): readonly ImpliedAccessory[] {
  return ACCESSORY_RULES[assetName] ?? [];
}
