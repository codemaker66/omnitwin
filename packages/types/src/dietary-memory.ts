import { z } from "zod";
import { DIETARY_NOTE_RETENTION } from "./event-requirements.js";

// ---------------------------------------------------------------------------
// Remembered allergy notes: "ask once, then remember" (Blake, 17 October 2026).
//
// The allergy note on a layout (metadata.instructions.dietary.otherAllergies)
// is removed 30 days after its event. A client planning a repeat event can
// ask, beside the note, for it to be remembered with their own account: an
// opt-in box, unticked until they tick it. Ticked, the note is kept with a
// record of who agreed, when and the exact words beside the box, and their
// next layout at the venue is filled in from it. They can see and remove it
// at any time; unused for DIETARY_MEMORY_RETENTION.daysUnused days, the
// retention pass removes it.
//
// The note is health information (special-category data under UK GDPR), so
// the wording is one definition here: the planner shows it, the API records
// it, and the privacy policy describes the same two paths. Which Article 9
// condition applies is for the venue's adviser; nothing here claims one.
// ---------------------------------------------------------------------------

/** How long a remembered note is kept without being saved with a layout
 *  again: the same 24 months the privacy policy gives a layout with no
 *  dated event. */
export const DIETARY_MEMORY_RETENTION = { daysUnused: DIETARY_NOTE_RETENTION.daysWithoutEvent } as const;

/** The unused period in whole months, as the wording and the policy say it. */
export const DIETARY_MEMORY_MONTHS_UNUSED = Math.round(DIETARY_MEMORY_RETENTION.daysUnused / 30.4);

/**
 * The opt-in, word for word. `version` names this wording: the API records
 * the wording only for the version it currently shows, so a page loaded
 * before a change cannot record words the client never read.
 */
export const DIETARY_MEMORY_CONSENT = {
  version: "2026-10-17",
  question: "Remember these for our next event?",
  detail:
    "We keep this note with your account and fill it in on your next layout here. "
    + `You can remove it at any time, and we remove it after ${String(DIETARY_MEMORY_MONTHS_UNUSED)} months without use. `
    + `Left unticked, it is removed ${String(DIETARY_NOTE_RETENTION.daysAfterEvent)} days after this event.`,
} as const;

/** The exact words shown beside the box, as the consent record keeps them. */
export function dietaryMemoryConsentWording(): string {
  return `${DIETARY_MEMORY_CONSENT.question} ${DIETARY_MEMORY_CONSENT.detail}`;
}

/** The longest note a layout holds (DietarySummarySchema.otherAllergies). */
export const DIETARY_MEMORY_NOTE_MAX = 1000;

/**
 * PUT /account/dietary-notes. The note itself is not in the body: the API
 * reads it from the client's own saved layout, so what is remembered is
 * exactly what that layout carries, and the request never carries the note.
 */
export const RememberDietaryNoteRequestSchema = z.object({
  configurationId: z.string().uuid(),
  consentVersion: z.string().trim().min(1).max(40),
}).strict();
export type RememberDietaryNoteRequest = z.infer<typeof RememberDietaryNoteRequestSchema>;

/**
 * One remembered note, as its owner reads it. The note travels under the
 * key `otherAllergies`, the key the log and error-report scrubbers already
 * redact (HEALTH_FREE_TEXT_KEYS), so a response or a request body repeated
 * in a log line cannot carry it out.
 */
export const RememberedDietaryNoteSchema = z.object({
  id: z.string().uuid(),
  venueId: z.string().uuid(),
  venueName: z.string(),
  otherAllergies: z.string().min(1).max(DIETARY_MEMORY_NOTE_MAX),
  /** The words beside the box when the client ticked it. */
  consentWording: z.string().min(1),
  /** When the client ticked the box. */
  consentedAt: z.string().datetime({ offset: true }),
  /** When the note was last saved with a layout. */
  updatedAt: z.string().datetime({ offset: true }),
  /** The layout it was last saved from, while that layout is still theirs. */
  sourceLayout: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
});
export type RememberedDietaryNote = z.infer<typeof RememberedDietaryNoteSchema>;

/** Why a remembered note ended. The consent record stays, without the note. */
export const DIETARY_MEMORY_REMOVED_BY = ["client", "retention", "reworded"] as const;
export type DietaryMemoryRemovedBy = (typeof DIETARY_MEMORY_REMOVED_BY)[number];
