import { z } from "zod";

// ---------------------------------------------------------------------------
// Gangway review (Blake, 25 Oct 2026): "use guidance of 1.1 but allow them to
// place it smaller, hallkeeper or venue staff will approve or deny or send
// adjustment".
//
// The planner never refuses a layout for gangway width. Where a layout
// narrows one of the room's designated gangways under the guidance, the
// planner derives a review item (packages/web/src/lib/auto-fill.ts,
// `gangwayReview`), and the venue's staff decide on it. The derived items are
// the source of truth for what is open; only decisions are stored, joined to
// items by id.
//
// Written with plain z.object / z.enum / z.array / z.string / z.number /
// z.literal / z.union so it compiles under zod 3 and zod 4 alike.
// ---------------------------------------------------------------------------

/** The guidance a gangway is measured against. */
export const GangwayGuidanceSchema = z.object({
  /** The width a gangway should keep, metres. */
  thresholdM: z.number().positive(),
  /** Where the figure comes from, as staff read it. */
  source: z.string().min(1),
});
export type GangwayGuidance = z.infer<typeof GangwayGuidanceSchema>;

/** The guidance the planner applies today: Scotland's, for a room used by more than 100 people. */
export const SCOTTISH_GANGWAY_GUIDANCE: GangwayGuidance = {
  thresholdM: 1.1,
  source: "Scottish Government, Practical fire safety guidance for existing non-residential premises, ch. 7",
};

/** A point on the floor in the planner's real-metre frame: room-centred, X along the room's width, Z along its length. */
export const FloorPointSchema = z.object({ x: z.number(), z: z.number() });
export type FloorPoint = z.infer<typeof FloorPointSchema>;

/** Where a pinch is: the segment its width is measured along, or the floor it covers. */
export const GangwayLocationSchema = z.union([
  z.object({ kind: z.literal("segment"), from: FloorPointSchema, to: FloorPointSchema }),
  z.object({ kind: z.literal("polygon"), points: z.array(FloorPointSchema).min(3) }),
]);
export type GangwayLocation = z.infer<typeof GangwayLocationSchema>;

export const GANGWAY_REVIEW_STATUSES = ["open", "approved", "denied", "adjustment-requested"] as const;
export const GangwayReviewStatusSchema = z.enum(GANGWAY_REVIEW_STATUSES);
export type GangwayReviewStatus = z.infer<typeof GangwayReviewStatusSchema>;

/** An instant, ISO 8601 in UTC, as `Date.prototype.toISOString` writes it. */
const IsoInstantSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/u);

/**
 * One gangway narrowed under the guidance.
 *
 * The id rule (stable and deterministic, so a stored decision re-attaches
 * to the same pinch after a reload or a small edit, and a materially changed
 * pinch reopens; `gangwayReviewId` writes it):
 *   `gangway:<gangway>:<bucket>:<either side>`
 * where `<gangway>` is the side of the room the gangway runs along (`xMin`,
 * `xMax`, `zMin`, `zMax`) or `spine`; `<bucket>` is the pinch's position
 * along the gangway in metres from its low end, rounded to the nearest whole
 * metre; and `<either side>` is what stands either side, sorted and joined
 * with `+`: a wall as `wall:<side>`, a table and its chairs by the group's
 * `groupId`, a set (a Top table's trestles) by its `setId`, a lone piece by
 * its own id. Group and set ids are used because they survive saving; a new
 * piece's own id changes when it is first saved.
 */
export const GangwayReviewItemSchema = z.object({
  id: z.string().min(1),
  /** Its clear width at the pinch, metres. */
  widthM: z.number().nonnegative(),
  guidance: GangwayGuidanceSchema,
  /** The gangway as staff name it: "the window wall", "the middle". */
  gangway: z.string().min(1),
  location: GangwayLocationSchema,
  /** The placed pieces narrowing it. */
  pieceIds: z.array(z.string().min(1)),
  /** What stands either side of the pinch, as staff name them: "the window wall", "Table 4's chairs". */
  sides: z.array(z.string().min(1)),
  status: GangwayReviewStatusSchema,
  /** Who decided, once decided. */
  reviewer: z.string().min(1).optional(),
  decisionNote: z.string().optional(),
  decidedAt: IsoInstantSchema.optional(),
});
export type GangwayReviewItem = z.infer<typeof GangwayReviewItemSchema>;

/** A layout's gangway review: every pinch under the guidance, narrowest first. */
export const GangwayReviewSchema = z.object({
  items: z.array(GangwayReviewItemSchema),
});
export type GangwayReview = z.infer<typeof GangwayReviewSchema>;

/** What stands either side of a pinch, for the id rule. */
export type GangwaySide = { readonly wall: "xMin" | "xMax" | "zMin" | "zMax" } | { readonly unit: string };

/** The id rule written out (see GangwayReviewItemSchema). */
export function gangwayReviewId(gangway: "xMin" | "xMax" | "zMin" | "zMax" | "spine", atM: number, sides: readonly GangwaySide[]): string {
  const names = sides.map((side) => ("wall" in side ? `wall:${side.wall}` : side.unit)).sort();
  return `gangway:${gangway}:${String(Math.round(atM))}:${names.join("+")}`;
}

/** How far a pinch may narrow after a decision before the decision lapses and the item reopens, metres. */
export const GANGWAY_DECISION_TOLERANCE_M = 0.05;

/**
 * The derived items with the stored decisions laid back over them, by id. A
 * decision lapses, and its item reopens, when the pinch has since narrowed by
 * more than GANGWAY_DECISION_TOLERANCE_M. A decision whose pinch has gone is
 * dropped: the gangway is no longer narrowed.
 */
export function withGangwayDecisions(derived: readonly GangwayReviewItem[], decided: readonly GangwayReviewItem[]): readonly GangwayReviewItem[] {
  const byId = new Map(decided.filter((item) => item.status !== "open").map((item) => [item.id, item]));
  return derived.map((item) => {
    const decision = byId.get(item.id);
    if (decision === undefined || item.widthM < decision.widthM - GANGWAY_DECISION_TOLERANCE_M) return item;
    return {
      ...item,
      status: decision.status,
      ...(decision.reviewer === undefined ? {} : { reviewer: decision.reviewer }),
      ...(decision.decisionNote === undefined ? {} : { decisionNote: decision.decisionNote }),
      ...(decision.decidedAt === undefined ? {} : { decidedAt: decision.decidedAt }),
    };
  });
}
