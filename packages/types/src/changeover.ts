import { z } from "zod";
import { SetupPhaseSchema } from "./hallkeeper-accessories.js";
import { ZoneSchema } from "./zone.js";

// ---------------------------------------------------------------------------
// What moves at a changeover: from the layout one booking leaves in a room to
// the layout the next booking needs there. Each item says how many the room
// holds and how many it needs, so the floor reads what stays, what goes back
// to store and what comes from store; the plan says which pieces move within
// the room. Built from the two sheets the floor already reads, in the same
// room's own coordinates.
// ---------------------------------------------------------------------------

/** One item's count in one zone, before and after the changeover. */
export const ChangeoverZoneCountSchema = z.object({
  zone: ZoneSchema,
  before: z.number().int().nonnegative(),
  after: z.number().int().nonnegative(),
}).strict();
export type ChangeoverZoneCount = z.infer<typeof ChangeoverZoneCountSchema>;

/**
 * An item of either layout: how many the room holds when the earlier booking
 * ends (`before`) and how many the next booking needs (`after`). The overlap
 * stays; the rest goes back to store or comes from it.
 */
export const ChangeoverItemSchema = z.object({
  name: z.string().min(1).max(200),
  category: z.string().min(1).max(40),
  /** The earliest phase the next booking sets it in (or the earlier one struck it from). */
  phase: SetupPhaseSchema,
  isAccessory: z.boolean(),
  before: z.number().int().nonnegative(),
  after: z.number().int().nonnegative(),
  /** Only the zones whose count changes. */
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
}).strict();

export const ChangeoverSchema = z.object({
  from: LayoutRefSchema,
  to: LayoutRefSchema,
  items: z.array(ChangeoverItemSchema),
  /** Null when either layout has no saved plan. */
  plan: ChangeoverPlanSchema.nullable(),
}).strict();
export type Changeover = z.infer<typeof ChangeoverSchema>;

export const ChangeoverQuerySchema = z.object({
  from: z.uuid(),
  to: z.uuid(),
  /** The events the two bookings belong to, which scope each sheet's hours. */
  fromEventId: z.uuid().optional(),
  toEventId: z.uuid().optional(),
}).strict().refine((query) => query.from !== query.to, {
  message: "A changeover runs between two layouts.",
  path: ["to"],
});
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
