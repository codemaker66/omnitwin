import { z } from "zod";
import { VenueIdSchema } from "./venue.js";

// ---------------------------------------------------------------------------
// Observations — what a hallkeeper saw in the room (goal 19 S5; D1, D10, D11).
//
// A booking's phases are the schedule. An observation is a fact about the
// room: it was set, the doors opened, it went live, it is being flipped, the
// event is done, the room is cleaned. Each fact carries the hallkeeper's own
// time (observedAt, read from the corrected clock at the tap) and the
// server's (recordedAt). Facts are never updated and never overwrite one
// another: a phone that was offline replays its tap with the time it was
// tapped, and it sits beside what another device recorded meanwhile. The
// board reads the LATEST fact by observedAt, so arrival order never matters.
//
// Nothing here carries a time for the booking. A payload that tries to is
// rejected at the schema (strict): observations derive exceptions against the
// schedule; they do not edit it (D1).
// ---------------------------------------------------------------------------

const UUID = z.string().uuid();
const IsoInstant = z.string().datetime({ offset: true });

/** In the order a room's day runs. Flipping is the room being turned
 *  between two phases of one booking (ceremony to dinner) and starts the
 *  set → doors → live run again. */
export const OBSERVATION_KINDS = ["set", "doors-open", "live", "flipping", "done", "cleaned"] as const;
export const ObservationKindSchema = z.enum(OBSERVATION_KINDS);
export type ObservationKind = z.infer<typeof ObservationKindSchema>;

/** The words a slab and a list use for each fact. */
export function describeObservationKind(kind: ObservationKind): string {
  switch (kind) {
    case "set": return "Room set";
    case "doors-open": return "Doors open";
    case "live": return "Live";
    case "flipping": return "Flipping";
    case "done": return "Done";
    case "cleaned": return "Cleaned";
    default: {
      const exhausted: never = kind;
      return String(exhausted);
    }
  }
}

/** The facts a slab offers next, from the latest fact it has. The API records
 *  any kind (a fact is a fact); this table is what a person is offered so the
 *  common path is one tap. Cleaned is terminal for the slot's day. */
export function nextObservationKinds(latest: ObservationKind | null): readonly ObservationKind[] {
  switch (latest) {
    case null: return ["set", "doors-open", "live"];
    case "set": return ["doors-open", "live", "done"];
    case "doors-open": return ["live", "done"];
    case "live": return ["flipping", "done"];
    case "flipping": return ["set", "live", "done"];
    case "done": return ["cleaned"];
    case "cleaned": return [];
    default: {
      const exhausted: never = latest;
      return [String(exhausted)] as unknown as readonly ObservationKind[];
    }
  }
}

/** The room was observed in use: guests in, or the event under way. Only
 *  these facts can ground an overrun (without a done signal there is no
 *  overrun; without a doors-open or live signal there is no use to overrun). */
export function observationMeansInUse(kind: ObservationKind): boolean {
  return kind === "doors-open" || kind === "live" || kind === "flipping";
}

/** The event is over as far as the room is concerned. */
export function observationMeansOver(kind: ObservationKind): boolean {
  return kind === "done" || kind === "cleaned";
}

export const SlotObservationSchema = z.object({
  id: UUID,
  venueId: VenueIdSchema,
  bookingId: UUID,
  /** The room the booking holds, copied from the booking when recorded. */
  spaceId: UUID.nullable(),
  kind: ObservationKindSchema,
  /** When the hallkeeper says it happened: the corrected clock at the tap. */
  observedAt: IsoInstant,
  /** When the server wrote it; later than observedAt for a replayed tap. */
  recordedAt: IsoInstant,
  actorUserId: UUID.nullable(),
  actorName: z.string().min(1).max(160),
  actorRole: z.string().min(1).max(30),
  idempotencyKey: UUID,
});
export type SlotObservation = z.infer<typeof SlotObservationSchema>;

/** One tap. The key is minted at the tap so an offline replay is the same
 *  fact, not a second one. Strict: a time for the booking has no field here. */
export const RecordObservationSchema = z.object({
  bookingId: UUID,
  kind: ObservationKindSchema,
  observedAt: IsoInstant,
  idempotencyKey: UUID,
}).strict();
export type RecordObservation = z.infer<typeof RecordObservationSchema>;

/** The board's window: the observations of every booking that touches it. */
export const ObservationListQuerySchema = z.object({
  from: IsoInstant,
  to: IsoInstant,
}).strict().refine((query) => Date.parse(query.from) < Date.parse(query.to), {
  message: "from must be before to",
  path: ["to"],
});
export type ObservationListQuery = z.infer<typeof ObservationListQuerySchema>;

/** The least a fact needs for the latest-wins rule. */
export interface ObservationFact {
  readonly kind: ObservationKind;
  readonly observedAt: string;
  readonly recordedAt?: string;
}

/** The fact the room is in now: the latest by observedAt, then by recordedAt
 *  for two taps at the same instant, then by the kind furthest along the
 *  day. Array order never decides, so a replayed tap lands where it belongs. */
export function latestObservation<T extends ObservationFact>(facts: readonly T[]): T | null {
  let latest: T | null = null;
  for (const fact of facts) {
    if (latest === null || compareObservations(fact, latest) > 0) latest = fact;
  }
  return latest;
}

function compareObservations(a: ObservationFact, b: ObservationFact): number {
  const byObserved = Date.parse(a.observedAt) - Date.parse(b.observedAt);
  if (byObserved !== 0) return byObserved;
  const byRecorded = Date.parse(a.recordedAt ?? a.observedAt) - Date.parse(b.recordedAt ?? b.observedAt);
  if (byRecorded !== 0) return byRecorded;
  return OBSERVATION_KINDS.indexOf(a.kind) - OBSERVATION_KINDS.indexOf(b.kind);
}
