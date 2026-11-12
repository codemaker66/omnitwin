import { and, eq, isNull } from "drizzle-orm";
import {
  EventStatusSchema,
  deriveEventStatus,
  eventStatusAgreesWithDiary,
  summariseEventBookings,
  toEventPlanAudienceRole,
  UpdateEventSchema,
  sha256Hex,
  stableCanonicalJson,
  type EventPlanChangeSurface,
  type UpdateEvent,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { bookings, events, venues } from "../db/schema.js";
import type { JwtUser } from "../middleware/auth.js";
import { canWriteEvents, isEventWriteRole } from "../utils/query.js";
import { recordEventPlanChange } from "./event-plan-lifecycle.js";
import { wallRange } from "./booking-move-feed.js";

type EventRow = typeof events.$inferSelect;
export type EventDbConn = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];
export type EventMutationActor = Pick<JwtUser, "id" | "email" | "role" | "venueId" | "platformRole">;

export interface EventMutationPrecondition {
  /** Digest of the authoritative event read when the decision was prepared. */
  expectedStateDigest: string;
}

export type EventMutationResult =
  | { ok: true; event: EventRow; stateDigest: string; changed: boolean }
  | { ok: false; status: 400 | 403 | 404 | 409; code: string; error: string; details?: unknown };

/** Stable semantic basis, including fields not exposed by the legacy PATCH.
 * An updatedAt timestamp alone misses writes from other domain paths. This
 * digest binds this event only; it is not proof of a layout, quote or release.
 */
export function eventStateDigest(row: EventRow): string {
  return sha256Hex(`venviewer.event-mutation-state.v1\n${stableCanonicalJson({
    id: row.id, venueId: row.venueId, createdBy: row.createdBy,
    name: row.name, eventType: row.eventType, status: row.status,
    startsAt: row.startsAt?.toISOString() ?? null, endsAt: row.endsAt?.toISOString() ?? null,
    guestCount: row.guestCount, clientName: row.clientName,
    clientAccountId: row.clientAccountId, opportunityId: row.opportunityId,
    headcountGuaranteed: row.headcountGuaranteed, headcountExpected: row.headcountExpected,
    headcountSetFor: row.headcountSetFor, notes: row.notes,
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  })}`);
}

function changedSurfaces(before: EventRow, after: EventRow): EventPlanChangeSurface[] {
  const surfaces: EventPlanChangeSurface[] = [];
  if (before.guestCount !== after.guestCount) surfaces.push("guest_count");
  if (before.startsAt?.getTime() !== after.startsAt?.getTime()
    || before.endsAt?.getTime() !== after.endsAt?.getTime()) surfaces.push("timings");
  if (before.name !== after.name || before.eventType !== after.eventType
    || before.clientName !== after.clientName || before.notes !== after.notes) surfaces.push("service_notes");
  if (before.status !== after.status) surfaces.push("evidence");
  return surfaces;
}

/** An event's hours as the floor reads them, or that none are set. */
function eventHours(row: Pick<EventRow, "startsAt" | "endsAt">, timeZone: string): string {
  if (row.startsAt === null || row.endsAt === null) return "no hours set";
  return wallRange({ startsAt: row.startsAt, endsAt: row.endsAt }, timeZone);
}

/**
 * What an event edit changed, in the floor's words (the Day Board shows them
 * until someone acknowledges the change). Names the guests and the hours in
 * the venue's clock; for the written details it says only which changed,
 * never their words.
 */
export function describeEventEdit(before: EventRow, after: EventRow, timeZone: string): {
  readonly summary: string;
  readonly beforeSummary: string | null;
  readonly afterSummary: string | null;
} {
  const parts: string[] = [];
  const was: string[] = [];
  const now: string[] = [];
  if (before.guestCount !== after.guestCount) {
    parts.push(`guests ${String(before.guestCount)} to ${String(after.guestCount)}`);
    was.push(`${String(before.guestCount)} guests`);
    now.push(`${String(after.guestCount)} guests`);
  }
  if (before.startsAt?.getTime() !== after.startsAt?.getTime() || before.endsAt?.getTime() !== after.endsAt?.getTime()) {
    parts.push(`hours now ${eventHours(after, timeZone)}`);
    was.push(eventHours(before, timeZone));
    now.push(eventHours(after, timeZone));
  }
  const details: string[] = [];
  if (before.name !== after.name) details.push("name");
  if (before.eventType !== after.eventType) details.push("occasion");
  if (before.clientName !== after.clientName) details.push("client");
  if (before.notes !== after.notes) details.push("notes");
  if (details.length > 0) parts.push(`${details.join(", ")} changed`);
  if (before.status !== after.status) parts.push(`status ${before.status.replace(/_/g, " ")} to ${after.status.replace(/_/g, " ")}`);
  const summary = `${after.name}: ${parts.join("; ")}.`;
  return {
    summary: summary.length <= 1000 ? summary : `${summary.slice(0, 999)}…`,
    beforeSummary: was.length === 0 ? null : was.join(" · ").slice(0, 1000),
    afterSummary: now.length === 0 ? null : now.join(" · ").slice(0, 1000),
  };
}

function dateOrNull(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

/** Shared by direct editing and future decision execution. The caller may pass
 * an existing transaction; Drizzle then nests a savepoint. The lock, merged
 * state validation, source mutation, change record and notifications succeed
 * together. No external delivery happens here.
 */
export async function updateEventCore(
  conn: EventDbConn,
  actor: EventMutationActor,
  eventId: string,
  input: UpdateEvent,
  precondition?: EventMutationPrecondition,
): Promise<EventMutationResult> {
  if (!isEventWriteRole(actor)) {
    return { ok: false, status: 403, code: "FORBIDDEN", error: "Insufficient permissions" };
  }
  const parsed = UpdateEventSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, status: 400, code: "VALIDATION_ERROR", error: "Validation failed", details: parsed.error.issues };
  }
  if (precondition !== undefined && !/^[a-f0-9]{64}$/.test(precondition.expectedStateDigest)) {
    return { ok: false, status: 400, code: "VALIDATION_ERROR", error: "Invalid event state digest" };
  }
  const patch = parsed.data;
  return conn.transaction(async (tx): Promise<EventMutationResult> => {
    const [row] = await tx.select().from(events)
      .where(and(eq(events.id, eventId), isNull(events.deletedAt))).limit(1).for("update");
    if (row === undefined) return { ok: false, status: 404, code: "NOT_FOUND", error: "Event not found" };
    if (!canWriteEvents(actor, row.venueId)) {
      return { ok: false, status: 403, code: "FORBIDDEN", error: "Insufficient permissions" };
    }
    if (precondition !== undefined && eventStateDigest(row) !== precondition.expectedStateDigest) {
      return { ok: false, status: 409, code: "EVENT_STATE_CHANGED", error: "The event changed. Prepare the decision again using the current event." };
    }

    // The bind: an event's status follows its Diary bookings
    // (deriveEventStatus). People may record the steps the bookings allow
    // (proposed while options stand; in planning, ready for ops, executed and
    // closed while a confirmed booking stands), never a status the Diary
    // contradicts. The bookings are read after the event lock, so a booking
    // write committed meanwhile is seen.
    if (patch.status !== undefined && patch.status !== row.status) {
      const held = await tx.select({ kind: bookings.kind, status: bookings.status, deletedAt: bookings.deletedAt })
        .from(bookings)
        .where(eq(bookings.eventId, row.id));
      const summary = summariseEventBookings(held);
      if (!eventStatusAgreesWithDiary(patch.status, summary)) {
        const current = EventStatusSchema.parse(row.status);
        return {
          ok: false,
          status: 409,
          code: "EVENT_STATUS_FOLLOWS_DIARY",
          error: "This event's status follows its bookings in the Diary. Confirm, release or cancel the booking there.",
          details: { requested: patch.status, diaryStatus: deriveEventStatus(current, summary) },
        };
      }
    }

    const next: EventRow = {
      ...row,
      name: patch.name ?? row.name,
      eventType: patch.eventType === undefined ? row.eventType : patch.eventType,
      status: patch.status ?? row.status,
      startsAt: patch.startsAt === undefined ? row.startsAt : dateOrNull(patch.startsAt),
      endsAt: patch.endsAt === undefined ? row.endsAt : dateOrNull(patch.endsAt),
      guestCount: patch.guestCount ?? row.guestCount,
      clientName: patch.clientName === undefined ? row.clientName : patch.clientName,
      notes: patch.notes === undefined ? row.notes : patch.notes,
    };
    if (next.startsAt !== null && next.endsAt !== null && next.endsAt <= next.startsAt) {
      return { ok: false, status: 400, code: "VALIDATION_ERROR", error: "Event end must be after its start" };
    }
    const affectedSurfaces = changedSurfaces(row, next);
    if (affectedSurfaces.length === 0) {
      return { ok: true, event: row, stateDigest: eventStateDigest(row), changed: false };
    }
    const [updated] = await tx.update(events).set({
      name: next.name, eventType: next.eventType, status: next.status,
      startsAt: next.startsAt, endsAt: next.endsAt, guestCount: next.guestCount,
      clientName: next.clientName, notes: next.notes, updatedAt: new Date(),
    }).where(and(eq(events.id, row.id), eq(events.venueId, row.venueId), isNull(events.deletedAt))).returning();
    if (updated === undefined) throw new Error("Locked event update returned no row");

    const requiresAcknowledgement = affectedSurfaces.some(surface => surface !== "evidence");
    const [venue] = await tx.select({ timezone: venues.timezone }).from(venues).where(eq(venues.id, updated.venueId)).limit(1);
    const words = describeEventEdit(row, updated, venue?.timezone ?? "Europe/London");
    await recordEventPlanChange(tx, {
      eventId: updated.id, venueId: updated.venueId,
      actorUserId: actor.id, actorRole: toEventPlanAudienceRole(actor.role), actorLabel: actor.email,
      sourceKind: "event", sourceId: updated.id, title: "Event plan updated",
      summary: words.summary,
      beforeSummary: words.beforeSummary, afterSummary: words.afterSummary,
      affectedSurfaces, audienceRoles: ["staff", "hallkeeper"],
      riskLevel: requiresAcknowledgement ? "attention" : "info",
      requiresHallkeeperAcknowledgement: requiresAcknowledgement,
      actionPath: `/ops/events/${updated.id}`,
    });
    return { ok: true, event: updated, stateDigest: eventStateDigest(updated), changed: true };
  });
}
