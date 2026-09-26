import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import {
  CreateTurnaroundRuleSchema,
  UpdateTurnaroundRuleSchema,
  type TurnaroundRuleSetting,
} from "@omnitwin/types";
import { bookings, events, spaces, turnaroundRules, users, venues } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate, type JwtUser } from "../middleware/auth.js";
import { canAdministerVenue, canManageCommercial, canManageVenue } from "../utils/query.js";

// ---------------------------------------------------------------------------
// Turnaround rules staff can set (T-637, slice A)
//
// How long a room needs between two functions. The rules drive the Diary's
// gap warnings, the planner's When ribbon and the Day Board. Everyone who
// reads the Diary may read them; the roles that administer the venue set
// them. Saving a rule, even unchanged, confirms it: a seeded demo value
// reads "Not confirmed" until a person does.
// ---------------------------------------------------------------------------

const VenueIdParam = z.object({ venueId: z.string().uuid() });
const RuleIdParam = z.object({ venueId: z.string().uuid(), id: z.string().uuid() });

/** How many of the venue's event types the editor offers. */
const EVENT_TYPE_LIMIT = 20;

function canReadTurnarounds(user: JwtUser, venueId: string): boolean {
  return canManageVenue(user, venueId) || canManageCommercial(user, venueId);
}

/** A rule's name, from its scope: staff choose a room and a type, not a label. */
export function turnaroundRuleName(roomName: string | null, eventType: string | null): string {
  const room = roomName ?? "All rooms";
  return eventType === null ? room : `${room}, ${eventType}`;
}

const RULE_COLUMNS = {
  id: turnaroundRules.id,
  venueId: turnaroundRules.venueId,
  spaceId: turnaroundRules.spaceId,
  eventType: turnaroundRules.eventType,
  name: turnaroundRules.name,
  minutes: turnaroundRules.minutes,
  isActive: turnaroundRules.isActive,
  confirmedAt: turnaroundRules.confirmedAt,
  createdAt: turnaroundRules.createdAt,
  updatedAt: turnaroundRules.updatedAt,
  updatedByName: users.name,
};

interface RuleRow {
  readonly id: string;
  readonly venueId: string;
  readonly spaceId: string | null;
  readonly eventType: string | null;
  readonly name: string;
  readonly minutes: number;
  readonly isActive: boolean;
  readonly confirmedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly updatedByName: string | null;
}

function serialize(row: RuleRow): TurnaroundRuleSetting {
  return {
    id: row.id,
    venueId: row.venueId,
    spaceId: row.spaceId,
    eventType: row.eventType,
    name: row.name,
    minutes: row.minutes,
    isActive: row.isActive,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    updatedByName: row.updatedByName,
  };
}

/** Postgres keeps microseconds; the API speaks milliseconds. */
function sameInstant(column: typeof turnaroundRules.updatedAt, iso: string) {
  return sql`date_trunc('milliseconds', ${column}) = ${new Date(iso).toISOString()}::timestamptz`;
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown; cause?: { code?: unknown } }).code
    ?? (error as { cause?: { code?: unknown } }).cause?.code;
  return code === "23505";
}

export async function turnaroundRuleRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  const liveRule = (venueId: string, id: string) => db.select(RULE_COLUMNS)
    .from(turnaroundRules)
    .leftJoin(users, eq(users.id, turnaroundRules.updatedBy))
    .where(and(
      eq(turnaroundRules.id, id),
      eq(turnaroundRules.venueId, venueId),
      eq(turnaroundRules.isActive, true),
      isNull(turnaroundRules.deletedAt),
    ))
    .limit(1);

  const venueExists = async (venueId: string): Promise<boolean> => {
    const [venue] = await db.select({ id: venues.id }).from(venues)
      .where(and(eq(venues.id, venueId), isNull(venues.deletedAt)))
      .limit(1);
    return venue !== undefined;
  };

  // GET /venues/:venueId/turnaround-rules — the live rules, the venue's rooms,
  // and the event types its bookings use, so the editor offers real choices.
  server.get("/", { preHandler: [authenticate] }, async (request, reply) => {
    const params = VenueIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid venue ID", code: "VALIDATION_ERROR" });
    }
    const { venueId } = params.data;
    if (!canReadTurnarounds(request.user, venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    if (!await venueExists(venueId)) {
      return reply.status(404).send({ error: "Venue not found", code: "NOT_FOUND" });
    }

    const [rules, rooms, bookingTypes, eventTypes] = await Promise.all([
      db.select(RULE_COLUMNS)
        .from(turnaroundRules)
        .leftJoin(users, eq(users.id, turnaroundRules.updatedBy))
        .where(and(
          eq(turnaroundRules.venueId, venueId),
          eq(turnaroundRules.isActive, true),
          isNull(turnaroundRules.deletedAt),
        ))
        .orderBy(asc(turnaroundRules.id)),
      db.select({ id: spaces.id, name: spaces.name })
        .from(spaces)
        .where(and(eq(spaces.venueId, venueId), isNull(spaces.deletedAt)))
        .orderBy(asc(spaces.sortOrder), asc(spaces.name)),
      db.select({ eventType: bookings.eventType, count: sql<number>`count(*)::int` })
        .from(bookings)
        .where(and(eq(bookings.venueId, venueId), isNotNull(bookings.eventType)))
        .groupBy(bookings.eventType),
      db.select({ eventType: events.eventType, count: sql<number>`count(*)::int` })
        .from(events)
        .where(and(eq(events.venueId, venueId), isNotNull(events.eventType)))
        .groupBy(events.eventType),
    ]);

    const used = new Map<string, number>();
    for (const row of [...bookingTypes, ...eventTypes]) {
      if (row.eventType === null || row.eventType.trim() === "") continue;
      used.set(row.eventType, (used.get(row.eventType) ?? 0) + row.count);
    }
    for (const rule of rules) {
      if (rule.eventType !== null && !used.has(rule.eventType)) used.set(rule.eventType, 0);
    }
    const knownTypes = [...used.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "en-GB"))
      .slice(0, EVENT_TYPE_LIMIT)
      .map(([eventType]) => eventType);

    // All rooms first, then the rooms in the venue's own order; within a room,
    // the rule for any event before the ones for particular types.
    const roomOrder = new Map(rooms.map((room, index) => [room.id, index]));
    const ordered = [...rules].sort((left, right) => {
      const leftRoom = left.spaceId === null ? -1 : roomOrder.get(left.spaceId) ?? rooms.length;
      const rightRoom = right.spaceId === null ? -1 : roomOrder.get(right.spaceId) ?? rooms.length;
      if (leftRoom !== rightRoom) return leftRoom - rightRoom;
      if (left.eventType === null || right.eventType === null) {
        return left.eventType === right.eventType ? 0 : left.eventType === null ? -1 : 1;
      }
      return left.eventType.localeCompare(right.eventType, "en-GB");
    });

    return { data: { rules: ordered.map(serialize), rooms, eventTypes: knownTypes } };
  });

  // POST /venues/:venueId/turnaround-rules — a new rule, confirmed as it is made.
  server.post("/", { preHandler: [authenticate] }, async (request, reply) => {
    const params = VenueIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid venue ID", code: "VALIDATION_ERROR" });
    }
    const { venueId } = params.data;
    if (!canAdministerVenue(request.user, venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    const parsed = CreateTurnaroundRuleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }
    if (!await venueExists(venueId)) {
      return reply.status(404).send({ error: "Venue not found", code: "NOT_FOUND" });
    }

    let roomName: string | null = null;
    if (parsed.data.spaceId !== null) {
      const [room] = await db.select({ name: spaces.name }).from(spaces)
        .where(and(eq(spaces.id, parsed.data.spaceId), eq(spaces.venueId, venueId), isNull(spaces.deletedAt)))
        .limit(1);
      if (room === undefined) {
        return reply.status(404).send({ error: "Room not found in this venue", code: "NOT_FOUND" });
      }
      roomName = room.name;
    }

    const now = new Date();
    try {
      const [created] = await db.insert(turnaroundRules).values({
        venueId,
        spaceId: parsed.data.spaceId,
        eventType: parsed.data.eventType,
        name: turnaroundRuleName(roomName, parsed.data.eventType),
        minutes: parsed.data.minutes,
        isActive: true,
        confirmedAt: now,
        updatedBy: request.user.id,
        createdAt: now,
        updatedAt: now,
      }).returning({ id: turnaroundRules.id });
      if (created === undefined) {
        return reply.status(500).send({ error: "The rule could not be saved", code: "INTERNAL_ERROR" });
      }
      const [row] = await liveRule(venueId, created.id);
      if (row === undefined) {
        return reply.status(500).send({ error: "The rule could not be read back", code: "INTERNAL_ERROR" });
      }
      return reply.status(201).send({ data: serialize(row) });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // One live rule per room and event type: point the editor at it.
      const [existing] = await db.select(RULE_COLUMNS)
        .from(turnaroundRules)
        .leftJoin(users, eq(users.id, turnaroundRules.updatedBy))
        .where(and(
          eq(turnaroundRules.venueId, venueId),
          parsed.data.spaceId === null ? isNull(turnaroundRules.spaceId) : eq(turnaroundRules.spaceId, parsed.data.spaceId),
          parsed.data.eventType === null ? isNull(turnaroundRules.eventType) : eq(turnaroundRules.eventType, parsed.data.eventType),
          eq(turnaroundRules.isActive, true),
          isNull(turnaroundRules.deletedAt),
        ))
        .limit(1);
      return reply.status(409).send({
        error: "This room already has a changeover time for that kind of event. Change that one instead.",
        code: "RULE_EXISTS",
        ...(existing === undefined ? {} : { details: serialize(existing) }),
      });
    }
  });

  // PATCH /venues/:venueId/turnaround-rules/:id — change the minutes, or keep
  // them: either way a person has now confirmed the rule.
  server.patch("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = RuleIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid params", code: "VALIDATION_ERROR" });
    }
    const { venueId, id } = params.data;
    if (!canAdministerVenue(request.user, venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    const parsed = UpdateTurnaroundRuleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    const now = new Date();
    // The precondition sits in the UPDATE's own WHERE, so a colleague's newer
    // change can never be overwritten by an editor that had not seen it.
    const [updated] = await db.update(turnaroundRules)
      .set({ minutes: parsed.data.minutes, confirmedAt: now, updatedBy: request.user.id, updatedAt: now })
      .where(and(
        eq(turnaroundRules.id, id),
        eq(turnaroundRules.venueId, venueId),
        eq(turnaroundRules.isActive, true),
        isNull(turnaroundRules.deletedAt),
        sameInstant(turnaroundRules.updatedAt, parsed.data.expectedUpdatedAt),
      ))
      .returning({ id: turnaroundRules.id });

    const [row] = await liveRule(venueId, id);
    if (row === undefined) {
      return reply.status(404).send({ error: "Changeover time not found", code: "NOT_FOUND" });
    }
    if (updated === undefined) {
      return reply.status(409).send({
        error: "Someone changed this changeover time a moment ago. Here is what it says now.",
        code: "RULE_CHANGED",
        details: serialize(row),
      });
    }
    return { data: serialize(row) };
  });

  // DELETE /venues/:venueId/turnaround-rules/:id — retire the rule; the gaps it
  // covered fall back to a wider rule, or to "not checked".
  server.delete("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = RuleIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid params", code: "VALIDATION_ERROR" });
    }
    const { venueId, id } = params.data;
    if (!canAdministerVenue(request.user, venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    const [retired] = await db.update(turnaroundRules)
      .set({ isActive: false, updatedBy: request.user.id, updatedAt: new Date() })
      .where(and(
        eq(turnaroundRules.id, id),
        eq(turnaroundRules.venueId, venueId),
        eq(turnaroundRules.isActive, true),
        isNull(turnaroundRules.deletedAt),
      ))
      .returning({ id: turnaroundRules.id });
    if (retired === undefined) {
      return reply.status(404).send({ error: "Changeover time not found", code: "NOT_FOUND" });
    }
    return reply.status(204).send();
  });
}
