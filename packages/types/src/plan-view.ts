import { z } from "zod";

// ---------------------------------------------------------------------------
// A visitor's plan through a view-only link (fix-first item 11, 16 Oct 2026
// upgrade brief).
//
// An organiser with no account draws a layout and wants to show it to a
// partner, a boss or a parent. The planner address cannot be the thing they
// send: an anonymous plan's configuration id IS its edit capability. So the
// organiser's browser asks for a separate view token (stored only as its
// SHA-256, revocable, and expiring), and the recipient's page reads this
// projection through it. The projection carries the room, the outline, what
// is placed and where, and the provenance line. It never carries the
// configuration id, the short code, the planner address or any price.
// ---------------------------------------------------------------------------

/** The provenance line every visitor plan carries, on paper and on screen. */
export const VISITOR_PLAN_PROVENANCE = "Drawn by a visitor; not reviewed by the venue.";

/** How long a view-only link works from the moment it is made. */
export const PLAN_VIEW_LINK_DAYS = 30;

/** Working links one plan may have at once; stopping one frees a place. */
export const PLAN_VIEW_LINK_LIMIT = 5;

/** A view token: 32 random bytes (256 bits) in unpadded base64url. */
export const PlanViewTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);

/** One placed item as the view draws it: a footprint, never an id. */
export const PlanViewFootprintSchema = z.object({
  name: z.string().min(1).max(200),
  category: z.string().min(1).max(50),
  x: z.number(),
  z: z.number(),
  rotationY: z.number(),
  scale: z.number().positive(),
  widthM: z.number().positive(),
  depthM: z.number().positive(),
  collisionType: z.enum(["box", "cylinder"]),
});
export type PlanViewFootprint = z.infer<typeof PlanViewFootprintSchema>;

/** What is on the plan, counted by the name the planner shows. */
export const PlanViewItemSchema = z.object({
  name: z.string().min(1).max(200),
  category: z.string().min(1).max(50),
  count: z.number().int().positive(),
});
export type PlanViewItem = z.infer<typeof PlanViewItemSchema>;

export const PlanViewSchema = z.object({
  venueName: z.string().min(1).max(200),
  venueAddress: z.string().max(500),
  /** The venue's IANA zone; times are shown in the venue's clock. */
  timezone: z.string().min(1).max(100),
  roomName: z.string().min(1).max(200),
  /** The organiser's own name for the plan; null while it is the default. */
  planName: z.string().min(1).max(200).nullable(),
  provenance: z.literal(VISITOR_PLAN_PROVENANCE),
  lastChangedAt: z.iso.datetime(),
  /** When this link stops working, unless the organiser stops it sooner. */
  linkExpiresAt: z.iso.datetime(),
  /** Real metres on the floor plane (x across, z down the page). */
  outline: z.array(z.object({ x: z.number(), z: z.number() })).min(3).max(1000),
  objects: z.array(PlanViewFootprintSchema).max(2000),
  items: z.array(PlanViewItemSchema).max(2000),
});
export type PlanView = z.infer<typeof PlanViewSchema>;

/** A working link as its organiser sees it. The token itself is shown once. */
export const PlanViewLinkSchema = z.object({
  id: z.uuid(),
  prefix: z.string().min(4).max(16),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export type PlanViewLink = z.infer<typeof PlanViewLinkSchema>;

/** The answer to making a link: the only time the token leaves the server. */
export const IssuedPlanViewLinkSchema = PlanViewLinkSchema.extend({
  token: PlanViewTokenSchema,
});
export type IssuedPlanViewLink = z.infer<typeof IssuedPlanViewLinkSchema>;
