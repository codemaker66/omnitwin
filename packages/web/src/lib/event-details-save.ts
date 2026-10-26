import { z } from "zod";
import {
  EventInstructionsSchema,
  normalizeProtectedPremises,
  type DayOfContact,
  type DietarySummary,
  type DoorSchedule,
  type EventInstructions,
} from "@omnitwin/types";
import type { SurfaceActionSpec } from "./surface-actions.js";

// ---------------------------------------------------------------------------
// What Event details sends, and what the action log keeps of it
// (T-674 slice 19; lens C-12, C-15; release audit people-privacy-3).
//
// Sending. The server replaces the whole of `instructions` on each save and
// refuses it all if one field breaks its schema, so a half-typed email would
// lose every other edit with it. `sendableInstructions` sends what the person
// typed wherever it is valid and, where it is not yet, what was last saved
// for that one field, and names the section still waiting ("Type the whole
// email address to save it"). It keeps v1's own rules (normalizeForSave): a
// contact with nothing in it is no contact, and Martyn's Law entries are
// trimmed and an empty record dropped, so an untouched block writes nothing.
//
// Logging. v1 copied the whole blob, allergy note and contact details
// included, into the append-only action log on every save
// (EventDetailsPanel.tsx:285, people-privacy-3), which retention never
// clears and the API keeps serving. This port logs that event details
// changed and which sections, never what they say: no allergy or dietary
// text, no counts, no names, phones or emails. The inverse is not recorded
// for the same reason; nothing replays an `event.details.update` (the
// change-history model only titles it), so nothing depends on it.
// ---------------------------------------------------------------------------

export const EVENT_DETAILS_SECTIONS = [
  "specialInstructions",
  "dayOfContact",
  "accessNotes",
  "phaseDeadlines",
  "accessibility",
  "dietary",
  "doorSchedule",
  "protectedPremises",
] as const;

export type EventDetailsSection = (typeof EVENT_DETAILS_SECTIONS)[number];

export interface SendableInstructions {
  /** What to PATCH, or null when nothing valid can be sent yet. */
  readonly payload: EventInstructions | null;
  /** The sections holding back an edit, and what would let it save. */
  readonly held: Readonly<Partial<Record<EventDetailsSection, string>>>;
}

const EmailSchema = z.string().email().max(255);

function contactIsEmpty(contact: DayOfContact): boolean {
  return contact.name.trim() === "" && contact.role.trim() === "" && contact.phone.trim() === "" && contact.email.trim() === "";
}

function sendableContact(
  draft: DayOfContact | null,
  saved: DayOfContact | null,
  held: Partial<Record<EventDetailsSection, string>>,
): DayOfContact | null {
  if (draft === null || contactIsEmpty(draft)) return null;
  if (draft.name.trim() === "") {
    held.dayOfContact = "Add a name to save this contact";
    return saved;
  }
  if (draft.email !== "" && !EmailSchema.safeParse(draft.email).success) {
    held.dayOfContact = "Type the whole email address to save it";
    const savedEmail = saved !== null && (saved.email === "" || EmailSchema.safeParse(saved.email).success) ? saved.email : "";
    return { ...draft, email: savedEmail };
  }
  return draft;
}

function sendableDoors(
  draft: DoorSchedule | null,
  saved: DoorSchedule | null,
  held: Partial<Record<EventDetailsSection, string>>,
): DoorSchedule | null {
  if (draft === null) return null;
  const entries = draft.entries.flatMap((entry, index) => {
    if (entry.label.trim() !== "") return [entry];
    held.doorSchedule = "Name each door to save it";
    const before = saved?.entries[index];
    return before === undefined ? [] : [{ ...entry, label: before.label }];
  });
  return { entries };
}

/** What can be sent now, and what is waiting on the person. */
export function sendableInstructions(draft: EventInstructions, saved: EventInstructions | null): SendableInstructions {
  const held: Partial<Record<EventDetailsSection, string>> = {};
  const payload: EventInstructions = {
    ...draft,
    dayOfContact: sendableContact(draft.dayOfContact, saved?.dayOfContact ?? null, held),
    doorSchedule: sendableDoors(draft.doorSchedule, saved?.doorSchedule ?? null, held),
    protectedPremises: normalizeProtectedPremises(draft.protectedPremises),
  };
  // Validated, not parsed: the parsed copy would reorder keys and add defaults,
  // and the blob is compared with what the server holds as JSON.
  return EventInstructionsSchema.safeParse(payload).success ? { payload, held } : { payload: null, held };
}

/** The sections whose saved value differs between two blobs. */
export function changedSections(before: EventInstructions | null, after: EventInstructions): readonly EventDetailsSection[] {
  return EVENT_DETAILS_SECTIONS.filter((section) => JSON.stringify(before?.[section] ?? null) !== JSON.stringify(after[section] ?? null));
}

/**
 * The action-log record of one saved change, or null when nothing changed.
 * It names the sections, and nothing they hold.
 */
export function eventDetailsLogSpec(before: EventInstructions | null, after: EventInstructions): SurfaceActionSpec | null {
  const changed = changedSections(before, after);
  if (changed.length === 0) return null;
  return {
    intent: "event.details.update",
    tool: "event-details",
    payload: { changed },
    inverse: { changed, contents: "not recorded" },
  };
}

const DIET_KEYS = ["vegetarian", "vegan", "glutenFree", "nutFree", "halal", "kosher"] as const;

/** The diet counts added up. */
export function dietTotal(dietary: DietarySummary): number {
  return DIET_KEYS.reduce((sum, key) => sum + dietary[key], 0);
}

/** "These add to 196, more than the 180 guests." when the counts pass the guests; never blocking. */
export function dietOverGuestsLine(dietary: DietarySummary | null, guests: number | null): string | null {
  if (dietary === null || guests === null || guests <= 0) return null;
  const total = dietTotal(dietary);
  return total > guests ? `These add to ${String(total)}, more than the ${String(guests)} guests.` : null;
}

/**
 * The line under the allergy note (lens C-15). Only what is true today: the
 * note is printed for the hallkeeper and kitchen. The retention promise v1
 * makes ("removed 30 days after the event") is not repeated, because client
 * layouts never get that rule (people-privacy-1) and a moved booking can
 * remove it early (people-privacy-2). It comes back with the fix.
 */
export const ALLERGY_NOTE_LINE = "Allergens and numbers, not guests' names. Printed on the function sheet for the hallkeeper and kitchen.";
