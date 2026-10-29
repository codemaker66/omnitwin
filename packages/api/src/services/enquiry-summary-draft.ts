import { and, eq } from "drizzle-orm";
import { occasionLabel, type CanonicalJsonValue } from "@omnitwin/types";
import { enquiries, spaces } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { clientWords, scrubContactDetails } from "./proposal-message-draft.js";

// ---------------------------------------------------------------------------
// What the AI is told of an enquiry to summarise it for the venue's team
// (release audit ai-1, 27 October 2026). The summary's context was built by
// the browser and sent as it was: the enquirer's name, email address and the
// message word for word. It is built here instead, from the enquiry as the
// venue holds it, so nothing the screen adds can be sent. It carries the
// occasion, the date and guests asked for, the room when the guest chose it,
// the enquiry's stage, the day it arrived and the guest's message with every
// email address and phone number taken out (the scrub the proposal's message
// uses). It carries no name, email address, phone number or id: an internal
// summary needs none of them.
// ---------------------------------------------------------------------------

type SummaryFrom = Pick<typeof enquiries.$inferSelect,
  "venueId" | "spaceId" | "roomChosen" | "eventType" | "preferredDate" | "estimatedGuests" | "message" | "state" | "createdAt">;

export interface EnquirySummaryContext {
  readonly context: Record<string, CanonicalJsonValue>;
  /** Whether there is anything to summarise: event details or the guest's words. */
  readonly hasSomething: boolean;
}

/** The day an enquiry arrived, as the venue in Glasgow counts days. */
function venueDay(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export async function enquirySummaryContext(db: Database, enquiry: SummaryFrom): Promise<EnquirySummaryContext> {
  // A room filed only because the guest named none is not one they asked for.
  const [room] = !enquiry.roomChosen ? [] : await db.select({ name: spaces.name })
    .from(spaces)
    .where(and(eq(spaces.id, enquiry.spaceId), eq(spaces.venueId, enquiry.venueId)))
    .limit(1);
  const occasion = scrubContactDetails(occasionLabel(enquiry.eventType) ?? "").text;
  const clientNotes = clientWords(enquiry.message);
  const context: Record<string, CanonicalJsonValue> = {
    occasion: occasion === "" ? null : occasion,
    preferredDate: enquiry.preferredDate,
    estimatedGuests: enquiry.estimatedGuests,
    roomName: room?.name ?? null,
    currentStatus: enquiry.state,
    receivedOn: venueDay(enquiry.createdAt),
    clientNotes,
  };
  const hasSomething = context["occasion"] !== null || enquiry.preferredDate !== null
    || enquiry.estimatedGuests !== null || clientNotes !== null;
  return { context, hasSomething };
}
