// ---------------------------------------------------------------------------
// Occasions — what an enquiry is for, in words a person reads
//
// The venue's forms send short slugs: the walkthrough and the planner send
// wedding, corporate, ceremony, concert, private or other, and the website's
// form wedding, dinner, conference or reception. Staff read them as words,
// never as slugs. An occasion typed in free (older rows, other senders) is
// shown as it was typed.
//
// This module imports nothing, so a screen that only names an event
// (event-name.ts) never bundles the enquiry schemas. enquiry.ts offers the
// same names, as it always has.
// ---------------------------------------------------------------------------

interface OccasionWords {
  /** "Corporate event": on its own, as a fact. */
  readonly label: string;
  /** "a corporate event": inside a sentence, after "for". */
  readonly phrase: string;
}

const ENQUIRY_OCCASIONS: Readonly<Record<string, OccasionWords>> = {
  wedding: { label: "Wedding", phrase: "a wedding" },
  dinner: { label: "Dinner", phrase: "a dinner" },
  conference: { label: "Conference", phrase: "a conference" },
  reception: { label: "Drinks reception", phrase: "a drinks reception" },
  corporate: { label: "Corporate event", phrase: "a corporate event" },
  ceremony: { label: "Ceremony", phrase: "a ceremony" },
  concert: { label: "Concert or performance", phrase: "a concert or performance" },
  private: { label: "Private celebration", phrase: "a private celebration" },
  other: { label: "Other occasion", phrase: "another occasion" },
};

/** The occasions the venue names, in the order it offers them. */
export const ENQUIRY_OCCASION_KEYS: readonly string[] = Object.keys(ENQUIRY_OCCASIONS);

function occasionWords(eventType: string | null | undefined): { readonly typed: string; readonly known: OccasionWords | undefined } | null {
  const typed = eventType?.trim() ?? "";
  if (typed === "") return null;
  const key = typed.toLowerCase();
  return { typed, known: Object.hasOwn(ENQUIRY_OCCASIONS, key) ? ENQUIRY_OCCASIONS[key] : undefined };
}

/** "Wedding", "Corporate event"; an occasion typed in free as typed; null for none. */
export function occasionLabel(eventType: string | null | undefined): string | null {
  const words = occasionWords(eventType);
  return words === null ? null : words.known?.label ?? words.typed;
}

/** "a wedding", "another occasion", to follow "for"; an occasion typed in free as typed; null for none. */
export function occasionPhrase(eventType: string | null | undefined): string | null {
  const words = occasionWords(eventType);
  return words === null ? null : words.known?.phrase ?? words.typed;
}
