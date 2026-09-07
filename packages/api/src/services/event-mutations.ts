import { and, eq, isNull } from "drizzle-orm";
import { EventPlanAudienceRoleSchema, UpdateEventSchema, sha256Hex, stableCanonicalJson, type EventPlanChangeSurface, type UpdateEvent } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { events } from "../db/schema.js";
import type { JwtUser } from "../middleware/auth.js";
import { canWriteEvents, isEventWriteRole } from "../utils/query.js";
import { recordEventPlanChange } from "./event-plan-lifecycle.js";

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
    await recordEventPlanChange(tx, {
      eventId: updated.id, venueId: updated.venueId,
      actorUserId: actor.id, actorRole: EventPlanAudienceRoleSchema.parse(actor.role), actorLabel: actor.email,
      sourceKind: "event", sourceId: updated.id, title: "Event plan updated",
      summary: `${updated.name} changed: ${affectedSurfaces.join(", ").replace(/_/g, " ")}.`,
      beforeSummary: `${String(row.guestCount)} guests`, afterSummary: `${String(updated.guestCount)} guests`,
      affectedSurfaces, audienceRoles: ["staff", "hallkeeper"],
      riskLevel: requiresAcknowledgement ? "attention" : "info",
      requiresHallkeeperAcknowledgement: requiresAcknowledgement,
      actionPath: `/ops/events/${updated.id}`,
    });
    return { ok: true, event: updated, stateDigest: eventStateDigest(updated), changed: true };
  });
}
