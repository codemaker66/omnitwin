import { usePlannerEventStore, type PlannerEventKind } from "../stores/planner-event-store.js";

/** Defaults for newly authored layouts only; saved asset identities are never remapped. */
export const DEFAULT_PLANNER_ROUND_TABLE_SLUG = "round-table-6ft-white";

/**
 * The chair a new seat is set with, by the kind of event (Blake, 26 Oct 2026):
 * the venue's gold Chiavari at a wedding; the pink velvet chair, which is the
 * Burgess Turini 18/3 (maker's 42 × 58 cm), at a business event and at
 * anything else. Seats already placed keep the chair they have.
 */
export const PLANNER_CHAIR_BY_EVENT: Readonly<Record<PlannerEventKind, string>> = {
  wedding: "chiavari-chair",
  corporate: "burgess-turini-18-3",
  other: "burgess-turini-18-3",
};

/** The chair before the planner has asked what the event is: the one it always set. */
export const UNASKED_PLANNER_CHAIR_SLUG = "burgess-turini-18-3";

const PLANNER_CHAIRS: ReadonlySet<string> = new Set([UNASKED_PLANNER_CHAIR_SLUG, ...Object.values(PLANNER_CHAIR_BY_EVENT)]);

/** Whether the planner sets this chair by itself for some event (legacy and imported chairs are kept, never copied). */
export function isPlannerChair(slug: string): boolean {
  return PLANNER_CHAIRS.has(slug);
}

/**
 * Chairs the venue records under another identity than the one the planner
 * sets: the venue's pink chair is the Burgess Turini 18/3 (Blake, 26 Oct
 * 2026), as its stock already counts (lib/card-stock).
 */
const SAME_CHAIR_AS: Readonly<Record<string, string>> = { "pink-chair": UNASKED_PLANNER_CHAIR_SLUG };

/** The planner chair this chair is, under either identity; null for a chair the planner never sets (a highchair, a legacy chair). */
export function plannerChairFor(slug: string): string | null {
  const same = SAME_CHAIR_AS[slug] ?? slug;
  return isPlannerChair(same) ? same : null;
}

/** The chair a new seat gets: the event's, once the planner knows the event. */
export function plannerChairSlug(kind: PlannerEventKind | null = usePlannerEventStore.getState().eventKind): string {
  return kind === null ? UNASKED_PLANNER_CHAIR_SLUG : PLANNER_CHAIR_BY_EVENT[kind];
}
