import { z } from "zod";
import { SetupPhaseSchema } from "./hallkeeper-accessories.js";
import { ZoneSchema } from "./zone.js";

// ---------------------------------------------------------------------------
// What moves at a changeover: from the layout one booking leaves in a room to
// the layout the next booking needs there. Each item says how many the room
// holds and how many it needs, so the floor reads what stays, what goes back
// to store and what comes from store; the plan says which pieces move within
// the room. Built from the two sheets the floor already reads, in the same
// room's own coordinates, and with both plans, in one room size.
// ---------------------------------------------------------------------------

/** One item's count in one zone, before and after the changeover, both
 *  sides' pieces placed in the next layout's room size. */
export const ChangeoverZoneCountSchema = z.object({
  zone: ZoneSchema,
  before: z.number().int().nonnegative(),
  after: z.number().int().nonnegative(),
}).strict();
export type ChangeoverZoneCount = z.infer<typeof ChangeoverZoneCountSchema>;

/**
 * An item of either layout: how many the room holds when the earlier booking
 * ends (`before`) and how many the next booking needs (`after`). Counted as
 * the sheet's store list counts them: every piece on the plan, the chairs at
 * tables included. For furniture the overlap stays and the rest goes back to
 * store or comes from it; an accessory (a table's linen) is dressing each
 * booking lays for itself, so the floor reads it as cleared and laid.
 */
export const ChangeoverItemSchema = z.object({
  name: z.string().min(1).max(200),
  category: z.string().min(1).max(40),
  /** The earliest phase the next booking sets it in (or the earlier one struck it from). */
  phase: SetupPhaseSchema,
  isAccessory: z.boolean(),
  before: z.number().int().nonnegative(),
  after: z.number().int().nonnegative(),
  /** Only the zones whose count changes; always empty for dressing, and for
   *  every item when the changeover's `zonesCompared` is false. */
  zones: z.array(ChangeoverZoneCountSchema),
}).strict();
export type ChangeoverItem = z.infer<typeof ChangeoverItemSchema>;

/** Pieces of one kind on the plan, counted. */
export const ChangeoverPlanGroupSchema = z.object({
  name: z.string().min(1).max(200),
  category: z.string().min(1).max(40),
  count: z.number().int().positive(),
}).strict();
export type ChangeoverPlanGroup = z.infer<typeof ChangeoverPlanGroupSchema>;

/** Where a piece going back to store stands now, so the plan can outline it. */
export const ChangeoverFootprintSchema = z.object({
  x: z.number(),
  z: z.number(),
  rotationY: z.number(),
  scale: z.number().positive(),
  widthM: z.number().positive(),
  depthM: z.number().positive(),
  collisionType: z.enum(["box", "cylinder"]),
}).strict();
export type ChangeoverFootprint = z.infer<typeof ChangeoverFootprintSchema>;

export const ChangeoverPlanSchema = z.object({
  /** Pieces that stand where the next booking needs them. */
  staysPut: z.number().int().nonnegative(),
  /** Pieces that stay in the room but move. */
  moved: z.array(ChangeoverPlanGroupSchema),
  fromStore: z.array(ChangeoverPlanGroupSchema),
  toStore: z.array(ChangeoverPlanGroupSchema),
  /** Pieces of the next layout's plan that move or come from store. */
  movedIds: z.array(z.uuid()),
  fromStoreIds: z.array(z.uuid()),
  toStoreFootprints: z.array(ChangeoverFootprintSchema),
}).strict();
export type ChangeoverPlan = z.infer<typeof ChangeoverPlanSchema>;

const LayoutRefSchema = z.object({
  configId: z.uuid(),
  name: z.string().max(200),
  guests: z.number().int().nonnegative(),
  /** False for a sheet frozen before plans were kept with it: its pieces
   *  can be counted, but not paired with the other layout's by where they stand. */
  hasPlan: z.boolean(),
}).strict();

export const ChangeoverSchema = z.object({
  from: LayoutRefSchema,
  to: LayoutRefSchema,
  items: z.array(ChangeoverItemSchema),
  /**
   * True when both layouts' pieces were placed in parts of the room the same
   * way: both have plans, and each piece is placed where it stands, in the
   * next layout's room size. False when either sheet was frozen without a
   * plan, whose rows list a table's chairs at the table and a laid floor at
   * its middle: every item's `zones` is then empty, and nothing can be said
   * about which parts of the room change.
   */
  zonesCompared: z.boolean(),
  /** Null when either layout has no saved plan, or `tooManyPieces`. */
  plan: ChangeoverPlanSchema.nullable(),
  /** Both layouts have plans, but too many pieces to pair one by one within
   *  one read's bounded work: `plan` is null, the counts and zones stand. */
  tooManyPieces: z.boolean(),
}).strict();
export type Changeover = z.infer<typeof ChangeoverSchema>;

/**
 * The two layouts. `to` may be `from` again, when the next booking keeps the
 * layout: the furniture then stays, and the dressing is still cleared and
 * laid for a different booking.
 */
export const ChangeoverQuerySchema = z.object({
  from: z.uuid(),
  to: z.uuid(),
}).strict();
export type ChangeoverQuery = z.infer<typeof ChangeoverQuerySchema>;

/** What stays, what goes back to store and what comes from it, for one item. */
export function changeoverSplit(item: Pick<ChangeoverItem, "before" | "after">): {
  readonly stays: number;
  readonly toStore: number;
  readonly fromStore: number;
} {
  return {
    stays: Math.min(item.before, item.after),
    toStore: Math.max(0, item.before - item.after),
    fromStore: Math.max(0, item.after - item.before),
  };
}
