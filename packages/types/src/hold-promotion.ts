import { z } from "zod";

// ---------------------------------------------------------------------------
// A 2nd option moved up (Blake, 26 September 2026).
//
// When a 1st option is released, lapses or is lost and the hold behind it
// becomes 1st option, the new 1st option's owner is told in the app and given
// a drafted email to their client to read and send. Nothing is sent
// automatically: the draft opens in the owner's own email, and a person
// sends it.
//
// The notification row is written by the API in the same transaction as the
// ladder change. Its action path names the day and the hold, built and read
// by the two functions below so the API and the web cannot disagree on the
// shape.
// ---------------------------------------------------------------------------

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

/** `/diary?goto=2026-06-13&hold=<id>`: the Diary opens on the day, and the
 *  notification knows which hold its draft is for. */
export function holdPromotionActionPath(venueDay: string, bookingId: string): string {
  if (!DAY_PATTERN.test(venueDay)) throw new Error("A promotion path needs a YYYY-MM-DD day");
  if (!UUID_PATTERN.test(bookingId)) throw new Error("A promotion path needs a booking id");
  const params = new URLSearchParams({ goto: venueDay, hold: bookingId });
  return `/diary?${params.toString()}`;
}

/** The hold a promotion notification is about, or null for any other path. */
export function promotedHoldFromActionPath(actionPath: string | null): string | null {
  if (actionPath === null || !actionPath.startsWith("/diary?")) return null;
  const hold = new URLSearchParams(actionPath.slice("/diary?".length)).get("hold");
  return hold !== null && UUID_PATTERN.test(hold) ? hold : null;
}

/** Where the draft's address came from, so the reader knows whom they are
 *  writing to before they send. */
export const PROMOTION_DRAFT_RECIPIENT_SOURCES = ["client_contact", "enquiry"] as const;
export const PromotionDraftRecipientSourceSchema = z.enum(PROMOTION_DRAFT_RECIPIENT_SOURCES);
export type PromotionDraftRecipientSource = z.infer<typeof PromotionDraftRecipientSourceSchema>;

export const PromotionDraftSchema = z.object({
  bookingId: z.uuid(),
  /** The client contact of record; null when none is recorded on the hold. */
  to: z.object({
    name: z.string().trim().min(1).max(200),
    email: z.email().max(255),
    source: PromotionDraftRecipientSourceSchema,
  }).nullable(),
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(4000),
}).strict();
export type PromotionDraft = z.infer<typeof PromotionDraftSchema>;
