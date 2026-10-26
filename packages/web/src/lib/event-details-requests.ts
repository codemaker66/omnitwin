import { z } from "zod";
import { api } from "../api/client.js";

// ---------------------------------------------------------------------------
// The two reads and writes Event details needs that the shared API modules do
// not carry yet (T-674 slice 19). Everything else reuses v1's calls as they
// are: patchConfigMetadata for the instructions, updateEventPhase and
// createEventPhase for the acts.
//
// - The layout as Event details reads it: v1's getConfig schema strips
//   `guestCount`, the layout's own guests figure (configurations.guest_count),
//   which the panel shows and writes when no event is linked (critic C-05).
// - The event's guests figure (events.guest_count), the one the v2 plane
//   reads (Slate.tsx:291). The server lets only event writers change it.
// ---------------------------------------------------------------------------

const LayoutDetailsSchema = z.object({
  id: z.string(),
  venueId: z.string(),
  userId: z.string().nullable(),
  isPublicPreview: z.boolean(),
  guestCount: z.number().int().nonnegative().optional().catch(undefined),
  metadata: z.unknown().optional(),
});

export type LayoutDetails = z.infer<typeof LayoutDetailsSchema>;

export async function getLayoutDetails(configId: string): Promise<LayoutDetails> {
  return api.get(`/configurations/${encodeURIComponent(configId)}`, LayoutDetailsSchema);
}

const PatchedSchema = z.object({ id: z.string() }).passthrough();

/** The layout's own guests figure, used when no event is linked. */
export async function patchLayoutGuestCount(configId: string, guestCount: number): Promise<void> {
  await api.patch(`/configurations/${encodeURIComponent(configId)}`, { guestCount }, PatchedSchema);
}

/** The event's guests figure: what the plane, the evening and the function sheet's event read. */
export async function patchEventGuestCount(eventId: string, guestCount: number): Promise<void> {
  await api.patch(`/events/${encodeURIComponent(eventId)}`, { guestCount }, PatchedSchema);
}

/**
 * Said on the window after Event details saves the event's guests or acts, so
 * the slate's plane and the evening can read the event again instead of
 * holding what they read when the planner opened (a WIRING request: they do
 * not listen yet). The detail names the event and what changed, nothing else.
 */
export const EVENT_DETAILS_CHANGED = "venviewer:event-details-changed";

export interface EventDetailsChangedDetail {
  readonly eventId: string;
  readonly what: "guests" | "acts";
}

export function announceEventChanged(detail: EventDetailsChangedDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<EventDetailsChangedDetail>(EVENT_DETAILS_CHANGED, { detail }));
}
