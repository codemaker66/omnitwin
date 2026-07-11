import type { FastifyInstance, FastifyReply } from "fastify";
import { and, asc, eq, gt, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import {
  CalendarQuerySchema,
  CalendarResponseSchema,
  deriveBookingState,
  type CalendarEntry,
  type CalendarQuery,
  type CalendarResponse,
} from "@omnitwin/types";
import { bookings, eventPhases, events, spaces, turnaroundRules } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate } from "../middleware/auth.js";
import { canManageVenue } from "../utils/query.js";
import {
  detectCalendarConflicts,
  type ConflictBookingInput,
  type ConflictPhaseInput,
} from "../services/calendar-conflicts.js";

// ---------------------------------------------------------------------------
// GET /calendar — the Diary's shared read model (T-489; Canon §12 P0).
//
// One endpoint every view shares (board, day, week, avails): the venue's
// rooms as lanes, entries (bookings of every kind/status in range plus
// room-scoped timed phases — the Occupancy Footprint), and the conflict
// engine's report computed over the same data in the same request. Rendering
// choices (hiding exits, collapsing prospects) belong to views, not to this
// truth surface; only soft-deleted rows are excluded.
//
// Overlap semantics are half-open: an entry appears iff
// startsAt < to AND endsAt > from.
// ---------------------------------------------------------------------------

const MINUTE_MS = 60_000;

function validationError(reply: FastifyReply, details: unknown): FastifyReply {
  return reply.status(400).send({
    error: "Validation failed",
    code: "VALIDATION_ERROR",
    details,
  });
}

/** Fastify query strings arrive as strings; spaceIds may be comma-separated
 *  or repeated. Normalise before Zod sees it. */
function normaliseQuery(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null) return {};
  const query = { ...(raw as Record<string, unknown>) };
  const spaceIds = query["spaceIds"];
  if (typeof spaceIds === "string") {
    query["spaceIds"] = spaceIds
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  }
  return query;
}

export async function calendarRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  server.get("", { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = CalendarQuerySchema.safeParse(normaliseQuery(request.query));
    if (!parsed.success) return validationError(reply, parsed.error.issues);
    const query: CalendarQuery = parsed.data;

    if (!canManageVenue(request.user, query.venueId)) {
      return reply.status(403).send({ error: "Forbidden", code: "FORBIDDEN" });
    }

    const from = new Date(query.from);
    const to = new Date(query.to);

    const venueSpaces = await db
      .select({
        id: spaces.id,
        name: spaces.name,
        slug: spaces.slug,
        sortOrder: spaces.sortOrder,
      })
      .from(spaces)
      .where(and(eq(spaces.venueId, query.venueId), isNull(spaces.deletedAt)))
      .orderBy(asc(spaces.sortOrder), asc(spaces.name));

    const knownSpaceIds = new Set(venueSpaces.map((space) => space.id));
    const requestedSpaceIds = query.spaceIds?.filter((id) => knownSpaceIds.has(id));
    if (query.spaceIds !== undefined && (requestedSpaceIds?.length ?? 0) === 0) {
      return validationError(reply, [
        { path: ["spaceIds"], message: "No requested space belongs to this venue." },
      ]);
    }
    const laneSpaceIds =
      requestedSpaceIds === undefined ? [...knownSpaceIds] : requestedSpaceIds;
    const rooms =
      requestedSpaceIds === undefined
        ? venueSpaces
        : venueSpaces.filter((space) => requestedSpaceIds.includes(space.id));

    if (laneSpaceIds.length === 0) {
      const emptyResponse: CalendarResponse = CalendarResponseSchema.parse({
        venueId: query.venueId,
        range: { from: from.toISOString(), to: to.toISOString() },
        rooms: [],
        entries: [],
        conflicts: detectCalendarConflicts({ bookings: [], phases: [], turnaroundRules: [] }),
      });
      return { data: emptyResponse };
    }

    // The three reads are independent — one round-trip of latency, not three
    // (review finding: this is the endpoint every calendar view polls).
    const [bookingRows, phaseRows, ruleRows] = await Promise.all([
      db
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.venueId, query.venueId),
            isNull(bookings.deletedAt),
            inArray(bookings.spaceId, laneSpaceIds),
            lt(bookings.startsAt, to),
            gt(bookings.endsAt, from),
          ),
        )
        .orderBy(asc(bookings.startsAt), asc(bookings.id)),
      // Room-scoped, timed phases joined to their event: endsAt is derived
      // from durationMinutes in SQL so the overlap window stays half-open
      // and exact.
      db
        .select({
          id: eventPhases.id,
          spaceId: eventPhases.spaceId,
          name: eventPhases.name,
          sortOrder: eventPhases.sortOrder,
          startsAt: eventPhases.startsAt,
          durationMinutes: eventPhases.durationMinutes,
          eventId: events.id,
          eventName: events.name,
          eventType: events.eventType,
        })
        .from(eventPhases)
        .innerJoin(events, eq(eventPhases.eventId, events.id))
        .where(
          and(
            eq(events.venueId, query.venueId),
            isNull(events.deletedAt),
            isNotNull(eventPhases.spaceId),
            isNotNull(eventPhases.startsAt),
            inArray(eventPhases.spaceId, laneSpaceIds),
            lt(eventPhases.startsAt, to),
            gt(
              sql`${eventPhases.startsAt} + make_interval(mins => ${eventPhases.durationMinutes})`,
              from,
            ),
          ),
        )
        .orderBy(asc(eventPhases.startsAt), asc(eventPhases.id)),
      db
        .select({
          spaceId: turnaroundRules.spaceId,
          eventType: turnaroundRules.eventType,
          name: turnaroundRules.name,
          minutes: turnaroundRules.minutes,
          isActive: turnaroundRules.isActive,
        })
        .from(turnaroundRules)
        .where(and(eq(turnaroundRules.venueId, query.venueId), isNull(turnaroundRules.deletedAt))),
    ]);

    const conflictBookings: ConflictBookingInput[] = bookingRows.map((row) => ({
      id: row.id,
      spaceId: row.spaceId,
      kind: row.kind,
      status: row.status,
      title: row.title,
      eventType: row.eventType,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      rank: row.rank,
      jointFlag: row.jointFlag,
      eventId: row.eventId,
      deletedAt: row.deletedAt,
    }));

    const conflictPhases: ConflictPhaseInput[] = [];
    const phaseEntries: CalendarEntry[] = [];
    for (const row of phaseRows) {
      if (row.spaceId === null || row.startsAt === null) continue;
      const endsAt = new Date(row.startsAt.getTime() + row.durationMinutes * MINUTE_MS);
      conflictPhases.push({
        id: row.id,
        spaceId: row.spaceId,
        eventId: row.eventId,
        eventName: row.eventName,
        name: row.name,
        eventType: row.eventType,
        startsAt: row.startsAt,
        endsAt,
      });
      phaseEntries.push({
        entryType: "phase",
        id: row.id,
        spaceId: row.spaceId,
        eventId: row.eventId,
        eventName: row.eventName,
        name: row.name,
        startsAt: row.startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        sortOrder: row.sortOrder,
      });
    }

    const bookingEntries: CalendarEntry[] = bookingRows.map((row) => ({
      entryType: "booking",
      id: row.id,
      spaceId: row.spaceId,
      kind: row.kind,
      status: row.status,
      state: deriveBookingState(row.kind, row.status),
      title: row.title,
      eventType: row.eventType,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      rank: row.rank,
      jointFlag: row.jointFlag,
      decisionAt: row.decisionAt === null ? null : row.decisionAt.toISOString(),
      ownerUserId: row.ownerUserId,
      nextAction: row.nextAction,
      nextActionDueAt: row.nextActionDueAt === null ? null : row.nextActionDueAt.toISOString(),
      eventId: row.eventId,
      seriesId: row.seriesId,
    }));

    const entries = [...bookingEntries, ...phaseEntries].sort((a, b) => {
      if (a.startsAt !== b.startsAt) return a.startsAt < b.startsAt ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    const conflicts = detectCalendarConflicts({
      bookings: conflictBookings,
      phases: conflictPhases,
      turnaroundRules: ruleRows,
    });

    const response: CalendarResponse = CalendarResponseSchema.parse({
      venueId: query.venueId,
      range: { from: from.toISOString(), to: to.toISOString() },
      rooms,
      entries,
      conflicts,
    });
    return { data: response };
  });
}
