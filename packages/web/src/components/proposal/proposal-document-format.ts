import { occasionLabel } from "@omnitwin/types";
import type { PublicProposal } from "../../api/proposals.js";
import { formatMinorAsCurrency } from "../../lib/money-input.js";
import { SUPPLIED_ROOM_STILLS, roomPosterSources, type RoomPosterSources } from "../../lib/room-posters.js";
import { VENUE_TIME_ZONE } from "../../pages/diary/lib/board-time.js";
import { eventDateLong } from "../dashboard/enquiries/enquiry-desk-format.js";

// ---------------------------------------------------------------------------
// The client's proposal as a document (roadmap X1): its facts, the sentence
// that says where it stands, the version it is and when it was prepared, and
// the room's photograph. Only what the venue holds is said; nothing is
// guessed, and nothing reads as a promise the system does not keep.
// ---------------------------------------------------------------------------

/** The venue whose own photographs the room pictures are. */
export const TRADES_HALL_SLUG = "trades-hall-glasgow";

export interface DocumentFact {
  readonly label: string;
  readonly value: string;
}

/** The event, as the facts row reads it, leaving out what is not known.
 *  "Other occasion" says nothing, so it is left out too. */
export function documentFacts(facts: PublicProposal["facts"]): readonly DocumentFact[] {
  const out: DocumentFact[] = [];
  const date = eventDateLong(facts.eventDate);
  if (date !== null) out.push({ label: "Date", value: date });
  if (facts.guestCount !== null && facts.guestCount > 0) {
    out.push({ label: "Guests", value: facts.guestCount.toLocaleString("en-GB") });
  }
  const occasion = facts.occasion === null || facts.occasion.trim().toLowerCase() === "other" ? null : occasionLabel(facts.occasion);
  if (occasion !== null) out.push({ label: "Occasion", value: occasion });
  if (facts.roomName !== null && facts.roomName.trim() !== "") out.push({ label: "Room", value: facts.roomName });
  return out;
}

const LONG_DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: VENUE_TIME_ZONE });

/** "1 October 2026", on the venue's calendar. */
export function venueLongDate(iso: string | null): string | null {
  if (iso === null) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? LONG_DATE.format(ms) : null;
}

/** "Version 2 · prepared 29 September 2026". */
export function preparedLine(version: number, preparedAt: string | null): string {
  const prepared = venueLongDate(preparedAt);
  return prepared === null ? `Version ${String(version)}` : `Version ${String(version)} · prepared ${prepared}`;
}

/** Where the proposal stands, said once near the top; null while it waits
 *  on the client's decision, which the foot of the page asks for. */
export function standingSentence(proposal: Pick<PublicProposal, "status" | "accepted">): string | null {
  switch (proposal.status) {
    case "accepted": {
      const on = venueLongDate(proposal.accepted?.at ?? null);
      const by = proposal.accepted?.by ?? null;
      if (by !== null && on !== null) return `Accepted by ${by} on ${on}.`;
      if (on !== null) return `Accepted on ${on}.`;
      return "Accepted.";
    }
    case "changes_requested":
      return "Changes were asked for on this version. The venue team will send the next one.";
    case "declined":
      return "This proposal was declined.";
    case "expired":
      return "This proposal has expired. Ask the venue team for a current one.";
    default:
      return null;
  }
}

/** The sentence a printed copy carries in place of the decision. */
export function printedDecision(proposal: Pick<PublicProposal, "status" | "accepted">): string {
  return standingSentence(proposal) ?? "Not yet accepted.";
}

/** Exact money, pence and all, as a quote states it. */
export function documentMoney(minor: number, currency: string): string {
  return formatMinorAsCurrency(minor, currency);
}

/** "Crawford wedding proposal — Trades Hall Glasgow — version 2": the tab's
 *  name, and so a saved PDF's. */
export function documentTitle(proposal: Pick<PublicProposal, "title" | "venueName" | "version">): string {
  return [proposal.title, proposal.venueName, `version ${String(proposal.version)}`]
    .filter((part): part is string => part !== null && part.trim() !== "")
    .join(" — ");
}

/** The room's photograph: only a supplied photograph of Trades Hall's own
 *  room. Another venue's room of the same name is not this one, and a
 *  render from a scan is not a photograph. */
export function roomPhotograph(venueSlug: string | null, roomSlug: string | null): RoomPosterSources | null {
  if (venueSlug !== TRADES_HALL_SLUG || roomSlug === null) return null;
  if (!Object.hasOwn(SUPPLIED_ROOM_STILLS, roomSlug)) return null;
  return roomPosterSources(roomSlug);
}

/** Who wrote a comment, as the client reads it. */
export function commentAuthor(comment: { readonly authorName: string | null; readonly from?: "venue" | "client" | undefined }): string {
  const from = comment.from ?? (comment.authorName === "Venue team" ? "venue" : "client");
  if (from === "venue") return "The venue team";
  // Said as the client's, whatever name was typed: a link reaches more than
  // one person, and a name alone could pass for the venue's.
  const name = comment.authorName?.trim() ?? "";
  return name === "" ? "The client" : `${name} (client)`;
}

/** The conversation, without the note written automatically with an
 *  acceptance: the acceptance is said once, where the decision is. */
export function conversation<T extends { readonly kind: string }>(comments: readonly T[] | undefined): readonly T[] {
  return (comments ?? []).filter((comment) => comment.kind !== "approval_note");
}
