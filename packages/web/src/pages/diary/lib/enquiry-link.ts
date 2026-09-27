import { isBookingEnquiry } from "@omnitwin/types";
import type { Enquiry } from "../../../api/enquiries.js";
import { BOARD_COPY } from "../board-copy.js";
import type { ConvertSource } from "./drawer-form.js";

// ---------------------------------------------------------------------------
// Holding a date from the Enquiries desk (roadmap N6). The desk links to the
// Diary with the enquiry named in the address; the Diary opens that week
// with the hold's drawer open, seeded with the enquiry's date and, when the
// guest chose one, its room.
// ---------------------------------------------------------------------------

/** The stages a date may be held for from the Enquiries desk: every stage
 *  still going, never one declined, withdrawn or closed. */
export const HOLDABLE_ENQUIRY_STATES: readonly string[] = ["submitted", "under_review", "approved"];

/** The Diary's address for holding a date for this enquiry: the week of the
 *  date it asks for, when it asks for one. */
export function diaryHoldHref(enquiry: Pick<Enquiry, "id" | "preferredDate">): string {
  const params = new URLSearchParams();
  if (enquiry.preferredDate !== null && /^\d{4}-\d{2}-\d{2}$/u.test(enquiry.preferredDate)) {
    params.set("date", enquiry.preferredDate);
  }
  params.set("enquiry", enquiry.id);
  return `/diary?${params.toString()}`;
}

/** True when the desk may offer a hold for this enquiry. */
export function canHoldDateFor(enquiry: Pick<Enquiry, "state" | "eventType">): boolean {
  return HOLDABLE_ENQUIRY_STATES.includes(enquiry.state) && isBookingEnquiry(enquiry.eventType);
}

/** The hold drawer's view of an enquiry. */
export function convertSourceOf(enquiry: Enquiry): ConvertSource {
  return {
    id: enquiry.id,
    spaceId: enquiry.spaceId,
    roomChosen: enquiry.roomChosen,
    name: enquiry.name,
    eventType: enquiry.eventType,
    preferredDate: enquiry.preferredDate,
  };
}

/** Why this venue's Diary holds no date for the enquiry, in words; null when
 *  it may. */
export function holdRefusal(enquiry: Enquiry, venueId: string): string | null {
  if (enquiry.venueId !== venueId) return BOARD_COPY.enquiryLink.otherVenue(enquiry.name);
  if (!isBookingEnquiry(enquiry.eventType)) return BOARD_COPY.enquiryLink.noDateAsked(enquiry.name);
  if (!HOLDABLE_ENQUIRY_STATES.includes(enquiry.state)) return BOARD_COPY.enquiryLink.closed(enquiry.name, enquiry.state);
  return null;
}
