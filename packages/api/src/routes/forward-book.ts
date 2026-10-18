import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import {
  RecordForwardBookCheckSchema,
  type ForwardBookCheck,
  type RoomForwardBook,
} from "@omnitwin/types";
import { forwardBookChecks, spaces, users, venues } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate } from "../middleware/auth.js";
import { canReadDiary, canRecordForwardBook } from "../utils/query.js";
import { USER_DISPLAY_NAME_MAX, userDisplayName } from "../utils/user-display-name.js";

// ---------------------------------------------------------------------------
// The forward book on the Diary, room by room (Blake, 17 October 2026: "hide
// date status until checked").
//
// The public MCP (and any public web surface) shows a room's dates only while
// a record stands that the room's whole forward book is on the Diary. The
// venue's admin or manager records it, with an optional note, or clears it,
// which hides the room's dates again. Everyone who reads the Diary may see
// where each room stands and who said so, and when. Records are never
// deleted: a cleared record keeps who cleared it and when.
//
// The public read (services/public-discovery.ts) selects only the room and
// the time of each standing record: never a name or a note.
// ---------------------------------------------------------------------------

const VenueIdParam = z.object({ venueId: z.string().uuid() });
const CheckIdParam = z.object({ venueId: z.string().uuid(), id: z.string().uuid() });

const CHECK_COLUMNS = {
  id: forwardBookChecks.id,
  spaceId: forwardBookChecks.spaceId,
  recordedAt: forwardBookChecks.recordedAt,
  recordedByName: forwardBookChecks.recordedByName,
  note: forwardBookChecks.note,
  clearedAt: forwardBookChecks.clearedAt,
  clearedByName: forwardBookChecks.clearedByName,
};

interface CheckRow {
  readonly id: string;
  readonly spaceId: string;
  readonly recordedAt: Date;
  readonly recordedByName: string;
  readonly note: string | null;
  readonly clearedAt: Date | null;
  readonly clearedByName: string | null;
}

function serialize(row: CheckRow): ForwardBookCheck {
  return {
    id: row.id,
    spaceId: row.spaceId,
    recordedAt: row.recordedAt.toISOString(),
    recordedByName: row.recordedByName,
    note: row.note,
    clearedAt: row.clearedAt?.toISOString() ?? null,
    clearedByName: row.clearedByName,
  };
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown; cause?: { code?: unknown } }).code
    ?? (error as { cause?: { code?: unknown } }).cause?.code;
  return code === "23505";
}

/** A person's name for the record: as the product shows it, from their
 *  account; the signed-in name if the account row cannot be read. */
async function actorName(db: Database, user: { readonly id: string; readonly name: string }): Promise<string> {
  const [row] = await db.select({ name: userDisplayName }).from(users).where(eq(users.id, user.id)).limit(1);
  const name = (row?.name ?? user.name).trim().slice(0, USER_DISPLAY_NAME_MAX);
  return name === "" ? "A venue manager" : name;
}

export async function forwardBookRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  const venueExists = async (venueId: string): Promise<boolean> => {
    const [venue] = await db.select({ id: venues.id }).from(venues)
      .where(and(eq(venues.id, venueId), isNull(venues.deletedAt)))
      .limit(1);
    return venue !== undefined;
  };

  const standingCheck = (spaceId: string) => db.select(CHECK_COLUMNS)
    .from(forwardBookChecks)
    .where(and(eq(forwardBookChecks.spaceId, spaceId), isNull(forwardBookChecks.clearedAt)))
    .limit(1);

  // GET /venues/:venueId/forward-book — every room, with its standing record
  // and, when none stands, the one most recently cleared.
  server.get("/", { preHandler: [authenticate] }, async (request, reply) => {
    const params = VenueIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid venue ID", code: "VALIDATION_ERROR" });
    }
    const { venueId } = params.data;
    if (!canReadDiary(request.user, venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    if (!await venueExists(venueId)) {
      return reply.status(404).send({ error: "Venue not found", code: "NOT_FOUND" });
    }

    const [rooms, standing, cleared] = await Promise.all([
      db.select({ id: spaces.id, name: spaces.name })
        .from(spaces)
        .where(and(eq(spaces.venueId, venueId), isNull(spaces.deletedAt)))
        .orderBy(asc(spaces.sortOrder), asc(spaces.name), asc(spaces.id)),
      db.select(CHECK_COLUMNS)
        .from(forwardBookChecks)
        .where(and(eq(forwardBookChecks.venueId, venueId), isNull(forwardBookChecks.clearedAt))),
      db.selectDistinctOn([forwardBookChecks.spaceId], CHECK_COLUMNS)
        .from(forwardBookChecks)
        .where(and(eq(forwardBookChecks.venueId, venueId), isNotNull(forwardBookChecks.clearedAt)))
        .orderBy(forwardBookChecks.spaceId, desc(forwardBookChecks.clearedAt), desc(forwardBookChecks.id)),
    ]);

    const standingBySpace = new Map(standing.map((row) => [row.spaceId, serialize(row)]));
    const clearedBySpace = new Map(cleared.map((row) => [row.spaceId, serialize(row)]));
    const data: RoomForwardBook[] = rooms.map((room) => {
      const current = standingBySpace.get(room.id) ?? null;
      return {
        spaceId: room.id,
        name: room.name,
        current,
        previous: current === null ? clearedBySpace.get(room.id) ?? null : null,
      };
    });
    return { data: { rooms: data } };
  });

  // POST /venues/:venueId/forward-book — record that a room's whole forward
  // book is on the Diary. Assistants and the website start saying whether the
  // room has bookings on a date.
  server.post("/", { preHandler: [authenticate] }, async (request, reply) => {
    const params = VenueIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid venue ID", code: "VALIDATION_ERROR" });
    }
    const { venueId } = params.data;
    if (!canRecordForwardBook(request.user, venueId)) {
      return reply.status(403).send({
        error: "Only the venue's admin or a manager can record this.",
        code: "FORBIDDEN",
      });
    }
    const parsed = RecordForwardBookCheckSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }
    if (!await venueExists(venueId)) {
      return reply.status(404).send({ error: "Venue not found", code: "NOT_FOUND" });
    }
    // The room must be this venue's: another venue's room is not found here.
    const [room] = await db.select({ id: spaces.id }).from(spaces)
      .where(and(eq(spaces.id, parsed.data.spaceId), eq(spaces.venueId, venueId), isNull(spaces.deletedAt)))
      .limit(1);
    if (room === undefined) {
      return reply.status(404).send({ error: "Room not found in this venue", code: "NOT_FOUND" });
    }

    const name = await actorName(db, request.user);
    try {
      const [created] = await db.insert(forwardBookChecks).values({
        venueId,
        spaceId: room.id,
        recordedBy: request.user.id,
        recordedByName: name,
        note: parsed.data.note,
      }).returning(CHECK_COLUMNS);
      if (created === undefined) {
        return reply.status(500).send({ error: "The record could not be saved", code: "INTERNAL_ERROR" });
      }
      return reply.status(201).send({ data: serialize(created) });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // One standing record per room: a colleague recorded it first.
      const [existing] = await standingCheck(room.id);
      return reply.status(409).send({
        error: "This room's check was recorded a moment ago. Here is the record that stands.",
        code: "FORWARD_BOOK_ALREADY_RECORDED",
        ...(existing === undefined ? {} : { details: serialize(existing) }),
      });
    }
  });

  // POST /venues/:venueId/forward-book/:id/clear — clear a standing record.
  // Assistants and the website stop saying whether the room has bookings on
  // a date and tell people to ask the team. The record stays, with who
  // cleared it and when.
  server.post("/:id/clear", { preHandler: [authenticate] }, async (request, reply) => {
    const params = CheckIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid params", code: "VALIDATION_ERROR" });
    }
    const { venueId, id } = params.data;
    if (!canRecordForwardBook(request.user, venueId)) {
      return reply.status(403).send({
        error: "Only the venue's admin or a manager can clear this.",
        code: "FORBIDDEN",
      });
    }
    const name = await actorName(db, request.user);
    // The standing condition sits in the UPDATE's own WHERE, so a record that
    // was cleared, or belongs to another venue, is never touched. The time is
    // the database's own clock, the one that stamped the record.
    const [cleared] = await db.update(forwardBookChecks)
      .set({ clearedAt: sql`now()`, clearedBy: request.user.id, clearedByName: name })
      .where(and(
        eq(forwardBookChecks.id, id),
        eq(forwardBookChecks.venueId, venueId),
        isNull(forwardBookChecks.clearedAt),
      ))
      .returning(CHECK_COLUMNS);
    if (cleared !== undefined) return { data: serialize(cleared) };

    const [row] = await db.select(CHECK_COLUMNS).from(forwardBookChecks)
      .where(and(eq(forwardBookChecks.id, id), eq(forwardBookChecks.venueId, venueId)))
      .limit(1);
    if (row === undefined) {
      return reply.status(404).send({ error: "Record not found", code: "NOT_FOUND" });
    }
    return reply.status(409).send({
      error: "This record was cleared a moment ago.",
      code: "FORWARD_BOOK_ALREADY_CLEARED",
      details: serialize(row),
    });
  });
}
