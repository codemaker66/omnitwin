import type { LinkedLayoutChoice } from "../../../lib/event-linked-layouts.js";

// ---------------------------------------------------------------------------
// The Day Board → setup sheet corridor (Ship Friday gate line 20).
//
// A hallkeeper standing at the board must be able to reach the room's setup
// sheet from the slot in front of them. Before this, the only route ran
// through a COMPILED handoff pack — so a booking with a perfectly good
// approved layout offered no way through, and the board said nothing at all.
//
// The corridor is: booking.eventId → the event's configuration links → the
// layout that belongs to THIS room → /hallkeeper/:configId. Every step can
// legitimately be empty, and each empty step has a different next action, so
// the state is modelled explicitly rather than collapsed into "no sheet".
// The page renders exactly what this returns; none of the wording is decided
// in JSX, which is what makes the honest states testable.
//
// What this deliberately does NOT do: claim approval. The sheet itself
// reports whether it is serving an approved frozen snapshot or live work in
// progress (HallkeeperStatusBanner), and that is the only place allowed to
// say so. The board offers the door, not a verdict.
// ---------------------------------------------------------------------------

export interface SlotSheetChoice {
  readonly configurationId: string;
  readonly name: string;
  readonly href: string;
}

export type SlotSheetState =
  /** The booking is not attached to an event, so no layout can exist yet. */
  | { readonly kind: "no-event"; readonly message: string; readonly nextAction: string }
  /** Attached to an event, but no layout for this room is linked. */
  | { readonly kind: "no-layout"; readonly message: string; readonly nextAction: string; readonly eventId: string }
  /** Exactly one layout — the common case; one tap reaches the sheet. */
  | { readonly kind: "one"; readonly href: string; readonly label: string; readonly layoutName: string }
  /** More than one layout for this room; the hallkeeper chooses. */
  | { readonly kind: "many"; readonly eventId: string; readonly choices: readonly SlotSheetChoice[] };

export interface SlotSheetInput {
  readonly eventId: string | null;
  readonly roomName: string;
  readonly layouts: readonly LinkedLayoutChoice[];
  /** References the signed-in account may not read. Surfaced, never hidden. */
  readonly unavailableCount: number;
}

/** The sheet route, carrying the event so the sheet can show the running
 *  order and operations context for the right event. */
export function sheetHref(configurationId: string, eventId: string): string {
  return `/hallkeeper/${configurationId}?eventId=${encodeURIComponent(eventId)}`;
}

export function describeSlotSheet(input: SlotSheetInput): SlotSheetState {
  const { eventId, roomName, layouts, unavailableCount } = input;

  if (eventId === null) {
    return {
      kind: "no-event",
      message: "No setup sheet yet — this booking is not linked to an event.",
      nextAction: "Open the booking in the Diary and link it to an event.",
    };
  }

  if (layouts.length === 0) {
    return {
      kind: "no-layout",
      eventId,
      message: unavailableCount > 0
        ? `No setup sheet you can open for ${roomName} — ${String(unavailableCount)} linked layout${unavailableCount === 1 ? " is" : "s are"} outside your access.`
        : `No setup sheet yet for ${roomName} — no layout is linked to this event.`,
      nextAction: unavailableCount > 0
        ? "Ask a venue administrator to share the layout."
        : "Open the event and link the room's layout.",
    };
  }

  const [only] = layouts;
  if (layouts.length === 1 && only !== undefined) {
    return {
      kind: "one",
      href: sheetHref(only.configurationId, eventId),
      label: "Open setup sheet",
      layoutName: only.name,
    };
  }

  return {
    kind: "many",
    eventId,
    choices: layouts.map((layout) => ({
      configurationId: layout.configurationId,
      name: layout.name,
      href: sheetHref(layout.configurationId, eventId),
    })),
  };
}
