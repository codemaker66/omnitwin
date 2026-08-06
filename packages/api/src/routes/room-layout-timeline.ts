import type { FastifyInstance, FastifyReply } from "fastify";
import { and, asc, eq, gt, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import {
  RoomLayoutTimelineQuerySchema,
  RoomLayoutTimelineResponseSchema,
  type RoomLayoutTimelineQuery,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import {
  configurations,
  eventPhases,
  events,
  phaseLayoutSnapshots,
  spaces,
} from "../db/schema.js";
import { authenticate } from "../middleware/auth.js";
import {
  resolveRoomLayoutTimelineKeyframe,
  type LayoutTimelineSnapshotCandidate,
} from "../services/room-layout-timeline.js";
import { canManageVenue } from "../utils/query.js";

const MINUTE_MS = 60_000;
/**
 * The reader is deliberately bounded independently of the elapsed range. A
 * venue with an unusually dense diary must narrow the window instead of
 * causing every historical layout payload for the room to be materialised.
 */
export const MAX_ROOM_LAYOUT_TIMELINE_FRAMES = 256;

function validationError(reply: FastifyReply, details: unknown): FastifyReply {
  return reply.status(400).send({
    error: "Validation failed",
    code: "VALIDATION_ERROR",
    details,
  });
}

/**
 * Read-only room timeline. The phase read and one phase-id-bounded snapshot
 * read deliberately avoid per-event graph requests and snapshot N+1s.
 */
export async function roomLayoutTimelineRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  server.get("/layout-timeline", { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = RoomLayoutTimelineQuerySchema.safeParse(request.query);
    if (!parsed.success) return validationError(reply, parsed.error.issues);
    const query: RoomLayoutTimelineQuery = parsed.data;

    if (!canManageVenue(request.user, query.venueId)) {
      return reply.status(403).send({ error: "Forbidden", code: "FORBIDDEN" });
    }

    const [room] = await db
      .select({ id: spaces.id })
      .from(spaces)
      .where(and(
        eq(spaces.id, query.spaceId),
        eq(spaces.venueId, query.venueId),
        isNull(spaces.deletedAt),
      ))
      .limit(1);
    if (room === undefined) {
      return validationError(reply, [{
        path: ["spaceId"],
        message: "Requested space does not belong to this venue.",
      }]);
    }

    const from = new Date(query.from);
    const to = new Date(query.to);
    const phaseRows = await db
      .select({
        phaseId: eventPhases.id,
        templateKey: eventPhases.templateKey,
        phaseName: eventPhases.name,
        sortOrder: eventPhases.sortOrder,
        startsAt: eventPhases.startsAt,
        durationMinutes: eventPhases.durationMinutes,
        guestCount: eventPhases.guestCount,
        opsTasksCount: eventPhases.opsTasksCount,
        reviewGatesCount: eventPhases.reviewGatesCount,
        densityStatus: eventPhases.densityStatus,
        densityLabel: eventPhases.densityLabel,
        staffConflictsStatus: eventPhases.staffConflictsStatus,
        staffConflictsLabel: eventPhases.staffConflictsLabel,
        eventId: events.id,
        eventName: events.name,
        eventType: events.eventType,
        eventStatus: events.status,
        eventGuestCount: events.guestCount,
      })
      .from(eventPhases)
      .innerJoin(events, eq(eventPhases.eventId, events.id))
      .where(and(
        eq(events.venueId, query.venueId),
        isNull(events.deletedAt),
        eq(eventPhases.spaceId, query.spaceId),
        isNotNull(eventPhases.startsAt),
        lt(eventPhases.startsAt, to),
        gt(
          sql`${eventPhases.startsAt} + make_interval(mins => ${eventPhases.durationMinutes})`,
          from,
        ),
      ))
      .orderBy(asc(eventPhases.startsAt), asc(eventPhases.id))
      .limit(MAX_ROOM_LAYOUT_TIMELINE_FRAMES + 1);

    if (phaseRows.length > MAX_ROOM_LAYOUT_TIMELINE_FRAMES) {
      return reply.status(422).send({
        error: "Timeline range contains too many event phases. Choose a narrower range.",
        code: "TIMELINE_RANGE_TOO_DENSE",
        maxFrames: MAX_ROOM_LAYOUT_TIMELINE_FRAMES,
      });
    }

    const phaseIds = phaseRows.map((row) => row.phaseId);
    const rankedSnapshotIds = phaseIds.length === 0
      ? null
      : db
        .select({
          id: phaseLayoutSnapshots.id,
          candidateRank: sql<number>`row_number() over (
            partition by ${phaseLayoutSnapshots.eventPhaseId}
            order by
              case ${phaseLayoutSnapshots.status}
                when 'frozen' then 0
                when 'draft' then 1
                when 'stale' then 2
                when 'superseded' then 3
                else 2147483647
              end,
              coalesce(${phaseLayoutSnapshots.frozenAt}, ${phaseLayoutSnapshots.createdAt}) desc,
              ${phaseLayoutSnapshots.id} asc
          )`.as("candidate_rank"),
        })
        .from(phaseLayoutSnapshots)
        .where(inArray(phaseLayoutSnapshots.eventPhaseId, phaseIds))
        .as("ranked_timeline_snapshot_ids");
    const snapshotRows = rankedSnapshotIds === null
      ? []
      : await db
        .select({
          id: phaseLayoutSnapshots.id,
          eventPhaseId: phaseLayoutSnapshots.eventPhaseId,
          configurationId: phaseLayoutSnapshots.configurationId,
          snapshotHash: phaseLayoutSnapshots.snapshotHash,
          status: phaseLayoutSnapshots.status,
          objectCount: phaseLayoutSnapshots.objectCount,
          guestCount: phaseLayoutSnapshots.guestCount,
          payload: phaseLayoutSnapshots.payload,
          coordinateSpace: phaseLayoutSnapshots.coordinateSpace,
          createdAt: phaseLayoutSnapshots.createdAt,
          frozenAt: phaseLayoutSnapshots.frozenAt,
          configurationSpaceId: configurations.spaceId,
          configurationVenueId: configurations.venueId,
        })
        .from(rankedSnapshotIds)
        .innerJoin(phaseLayoutSnapshots, eq(phaseLayoutSnapshots.id, rankedSnapshotIds.id))
        .leftJoin(configurations, eq(phaseLayoutSnapshots.configurationId, configurations.id))
        .where(eq(rankedSnapshotIds.candidateRank, 1))
        .orderBy(
          asc(phaseLayoutSnapshots.eventPhaseId),
          asc(phaseLayoutSnapshots.createdAt),
          asc(phaseLayoutSnapshots.id),
        );

    const snapshotsByPhase = new Map<string, LayoutTimelineSnapshotCandidate[]>();
    for (const snapshot of snapshotRows) {
      const candidates = snapshotsByPhase.get(snapshot.eventPhaseId) ?? [];
      candidates.push(snapshot);
      snapshotsByPhase.set(snapshot.eventPhaseId, candidates);
    }

    const frames = phaseRows.flatMap((row) => {
      if (row.startsAt === null) return [];
      const endsAt = new Date(row.startsAt.getTime() + row.durationMinutes * MINUTE_MS);
      const isRoomFlip = row.templateKey === "room-flip"
        || (row.templateKey === null && row.phaseName.trim().toLowerCase() === "room flip");
      return [{
        id: row.phaseId,
        kind: isRoomFlip ? "room_flip" : "phase",
        eventId: row.eventId,
        eventName: row.eventName,
        eventType: row.eventType,
        eventStatus: row.eventStatus,
        eventGuestCount: row.eventGuestCount,
        phaseId: row.phaseId,
        phaseName: row.phaseName,
        templateKey: row.templateKey,
        sortOrder: row.sortOrder,
        startsAt: row.startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        guestCount: row.guestCount,
        opsTasksCount: row.opsTasksCount,
        reviewGatesCount: row.reviewGatesCount,
        densityStatus: row.densityStatus,
        densityLabel: row.densityLabel,
        staffConflictsStatus: row.staffConflictsStatus,
        staffConflictsLabel: row.staffConflictsLabel,
        keyframe: resolveRoomLayoutTimelineKeyframe({
          venueId: query.venueId,
          spaceId: query.spaceId,
          isRoomFlip,
          candidates: snapshotsByPhase.get(row.phaseId) ?? [],
        }),
      }];
    });

    const response = RoomLayoutTimelineResponseSchema.parse({
      venueId: query.venueId,
      spaceId: query.spaceId,
      from: from.toISOString(),
      to: to.toISOString(),
      frames,
    });
    return { data: response };
  });
}
