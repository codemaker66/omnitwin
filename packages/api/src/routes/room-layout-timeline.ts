import type { FastifyInstance, FastifyReply } from "fastify";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import {
  RoomLayoutTimelineQuerySchema,
  RoomLayoutTimelineResponseSchema,
  type RoomLayoutTimelineQuery,
  type RoomLayoutTimelineRange,
  type RoomLayoutTimelineResponse,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import {
  canonicalLayoutSnapshots,
  configurations,
  eventPhases,
  events,
  layoutValidationRuns,
  phaseLayoutSnapshots,
  revenueScenarios,
  spaces,
  venues,
} from "../db/schema.js";
import { authenticate } from "../middleware/auth.js";
import {
  deriveRoomLayoutTimelineGuestsFigure,
  deriveRoomLayoutTimelineRevenueFigure,
  deriveRoomLayoutTimelineSeatedCapacity,
  resolveRoomLayoutTimelineKeyframe,
  type LayoutTimelineSnapshotCandidate,
} from "../services/room-layout-timeline.js";
import { canAccessResource, canReadVenuePlanningData } from "../utils/query.js";

const MINUTE_MS = 60_000;
/**
 * The reader is deliberately bounded independently of the elapsed range. A
 * venue with an unusually dense diary must narrow the window instead of
 * causing every historical layout payload for the room to be materialised.
 */
export const MAX_ROOM_LAYOUT_TIMELINE_FRAMES = 256;
export const MAX_ROOM_LAYOUT_TIMELINE_OBJECTS = 10_000;
export const MAX_ROOM_LAYOUT_TIMELINE_RESPONSE_BYTES = 8 * 1024 * 1024;

export interface RoomLayoutTimelineResponseAssessment {
  readonly totalCanonicalObjects: number;
  readonly serializedBytes: number;
  readonly exceeded: "objects" | "bytes" | null;
}

export function assessRoomLayoutTimelineResponse(
  response: RoomLayoutTimelineResponse,
  limits: {
    readonly maxObjects: number;
    readonly maxBytes: number;
  } = {
    maxObjects: MAX_ROOM_LAYOUT_TIMELINE_OBJECTS,
    maxBytes: MAX_ROOM_LAYOUT_TIMELINE_RESPONSE_BYTES,
  },
): RoomLayoutTimelineResponseAssessment {
  const totalCanonicalObjects = response.frames.reduce((total, frame) => (
    frame.keyframe.state === "available"
      ? total + frame.keyframe.payload.objects.length
      : total
  ), 0);
  const serializedBytes = Buffer.byteLength(JSON.stringify({ data: response }), "utf8");
  return {
    totalCanonicalObjects,
    serializedBytes,
    exceeded: totalCanonicalObjects > limits.maxObjects
      ? "objects"
      : serializedBytes > limits.maxBytes
        ? "bytes"
        : null,
  };
}

interface ResolvedRoomLayoutTimelineRange {
  readonly from: Date;
  readonly to: Date;
  readonly response: RoomLayoutTimelineRange;
}

function epochMilliseconds(value: unknown, field: "from_ms" | "to_ms"): number {
  const milliseconds = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(milliseconds)) {
    throw new Error(`PostgreSQL returned an invalid ${field} timeline bound.`);
  }
  return milliseconds;
}

/**
 * PostgreSQL's timezone catalogue is the authority for wall-clock boundaries.
 * The Diary's operational day starts at 04:00 venue-local time; Week remains
 * the civil Monday 00:00 boundary from Canon §8. `date_trunc('week', ...)` is
 * ISO/Monday-based and the two independent
 * `AT TIME ZONE` conversions preserve 23/25-hour days and 167/169-hour weeks.
 */
export async function resolveRoomLayoutTimelineRange(
  db: Database,
  query: RoomLayoutTimelineQuery,
  timeZone: string,
): Promise<ResolvedRoomLayoutTimelineRange> {
  if ("from" in query) {
    const from = new Date(query.from);
    const to = new Date(query.to);
    return {
      from,
      to,
      response: {
        scope: "custom",
        anchorDate: null,
        from: from.toISOString(),
        to: to.toISOString(),
      },
    };
  }

  const result = query.scope === "day"
    ? await db.execute(sql`
        select
          extract(epoch from ((${query.anchorDate}::date + interval '4 hours') at time zone ${timeZone})) * 1000 as from_ms,
          extract(epoch from (((${query.anchorDate}::date + 1) + interval '4 hours') at time zone ${timeZone})) * 1000 as to_ms
      `)
    : await db.execute(sql`
        select
          extract(epoch from (date_trunc('week', ${query.anchorDate}::date::timestamp) at time zone ${timeZone})) * 1000 as from_ms,
          extract(epoch from ((date_trunc('week', ${query.anchorDate}::date::timestamp) + interval '7 days') at time zone ${timeZone})) * 1000 as to_ms
      `);
  const row = result.rows[0];
  if (row === undefined) throw new Error("PostgreSQL returned no timeline range.");
  const from = new Date(epochMilliseconds(row["from_ms"], "from_ms"));
  const to = new Date(epochMilliseconds(row["to_ms"], "to_ms"));
  return {
    from,
    to,
    response: {
      scope: query.scope,
      anchorDate: query.anchorDate,
      from: from.toISOString(),
      to: to.toISOString(),
    },
  };
}

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

    if (!canReadVenuePlanningData(request.user, query.venueId)) {
      return reply.status(403).send({ error: "Forbidden", code: "FORBIDDEN" });
    }

    const [room] = await db
      .select({ id: spaces.id, timeZone: venues.timezone })
      .from(spaces)
      .innerJoin(venues, eq(spaces.venueId, venues.id))
      .where(and(
        eq(spaces.id, query.spaceId),
        eq(spaces.venueId, query.venueId),
        isNull(spaces.deletedAt),
        isNull(venues.deletedAt),
      ))
      .limit(1);
    if (room === undefined) {
      return validationError(reply, [{
        path: ["spaceId"],
        message: "Requested space does not belong to this venue.",
      }]);
    }

    const range = await resolveRoomLayoutTimelineRange(db, query, room.timeZone);
    const { from, to } = range;
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
        eventCreatedBy: events.createdBy,
      })
      .from(eventPhases)
      .innerJoin(events, eq(eventPhases.eventId, events.id))
      .where(and(
        eq(events.venueId, query.venueId),
        isNull(events.deletedAt),
        eq(eventPhases.spaceId, query.spaceId),
        isNotNull(eventPhases.startsAt),
        gt(eventPhases.durationMinutes, 0),
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
          canonicalSnapshotId: phaseLayoutSnapshots.canonicalSnapshotId,
          proofDigest: phaseLayoutSnapshots.proofDigest,
          supersedesSnapshotId: phaseLayoutSnapshots.supersedesSnapshotId,
          frozenBy: phaseLayoutSnapshots.frozenBy,
          canonicalRowId: canonicalLayoutSnapshots.id,
          canonicalConfigurationId: canonicalLayoutSnapshots.configurationId,
          canonicalVenueId: canonicalLayoutSnapshots.venueId,
          canonicalSpaceId: canonicalLayoutSnapshots.spaceId,
          canonicalSnapshotDigest: canonicalLayoutSnapshots.snapshotDigest,
          canonicalPayload: canonicalLayoutSnapshots.payload,
          proofSnapshotId: layoutValidationRuns.snapshotId,
          proofSnapshotDigest: layoutValidationRuns.snapshotDigest,
          proofRowDigest: layoutValidationRuns.proofDigest,
          proofPayload: layoutValidationRuns.payload,
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
        .leftJoin(
          canonicalLayoutSnapshots,
          eq(phaseLayoutSnapshots.canonicalSnapshotId, canonicalLayoutSnapshots.id),
        )
        .leftJoin(
          layoutValidationRuns,
          eq(phaseLayoutSnapshots.proofDigest, layoutValidationRuns.proofDigest),
        )
        .where(eq(rankedSnapshotIds.candidateRank, 1))
        .orderBy(
          asc(phaseLayoutSnapshots.eventPhaseId),
          asc(phaseLayoutSnapshots.createdAt),
          asc(phaseLayoutSnapshots.id),
        );

    const predecessorIds = snapshotRows.flatMap((snapshot) => (
      snapshot.supersedesSnapshotId === null ? [] : [snapshot.supersedesSnapshotId]
    ));
    const predecessorRows = predecessorIds.length === 0
      ? []
      : await db.select({
          id: phaseLayoutSnapshots.id,
          eventPhaseId: phaseLayoutSnapshots.eventPhaseId,
          status: phaseLayoutSnapshots.status,
          createdAt: phaseLayoutSnapshots.createdAt,
          frozenAt: phaseLayoutSnapshots.frozenAt,
        }).from(phaseLayoutSnapshots).where(inArray(phaseLayoutSnapshots.id, predecessorIds));
    const predecessorsById = new Map(predecessorRows.map((row) => [row.id, row]));

    const snapshotsByPhase = new Map<string, LayoutTimelineSnapshotCandidate[]>();
    for (const snapshot of snapshotRows) {
      const candidates = snapshotsByPhase.get(snapshot.eventPhaseId) ?? [];
      candidates.push({
        ...snapshot,
        predecessor: snapshot.supersedesSnapshotId === null
          ? null
          : predecessorsById.get(snapshot.supersedesSnapshotId) ?? null,
      });
      snapshotsByPhase.set(snapshot.eventPhaseId, candidates);
    }

    const baseFrames = phaseRows.flatMap((row) => {
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
        templateKey: isRoomFlip ? "room-flip" as const : row.templateKey,
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
        commercialAccess: canAccessResource(
          request.user,
          row.eventCreatedBy,
          query.venueId,
        ),
        keyframe: resolveRoomLayoutTimelineKeyframe({
          venueId: query.venueId,
          spaceId: query.spaceId,
          isRoomFlip,
          candidates: snapshotsByPhase.get(row.phaseId) ?? [],
        }),
      }];
    });

    const planningPairs = new Map<string, { readonly eventId: string; readonly configurationId: string }>();
    for (const frame of baseFrames) {
      if (!frame.commercialAccess || frame.keyframe.state !== "available") continue;
      const configurationId = frame.keyframe.payload.configurationId;
      planningPairs.set(`${frame.eventId}:${configurationId}`, {
        eventId: frame.eventId,
        configurationId,
      });
    }
    const pairPredicates = [...planningPairs.values()].map((pair) => and(
      eq(revenueScenarios.configurationId, pair.configurationId),
      or(isNull(revenueScenarios.eventId), eq(revenueScenarios.eventId, pair.eventId)),
    ));
    const rankedRevenueScenarioIds = pairPredicates.length === 0
      ? null
      : db.select({
          id: revenueScenarios.id,
          candidateRank: sql<number>`row_number() over (
            partition by ${revenueScenarios.configurationId}, ${revenueScenarios.eventId}
            order by
              case ${revenueScenarios.status} when 'active' then 0 else 1 end,
              ${revenueScenarios.updatedAt} desc,
              ${revenueScenarios.id} desc
          )`.as("candidate_rank"),
        }).from(revenueScenarios).where(and(
          eq(revenueScenarios.venueId, query.venueId),
          inArray(revenueScenarios.status, ["active", "draft"]),
          or(...pairPredicates),
        )).as("ranked_timeline_revenue_scenario_ids");
    const scenarioRows = rankedRevenueScenarioIds === null
      ? []
      : await db.select({
          id: revenueScenarios.id,
          venueId: revenueScenarios.venueId,
          eventId: revenueScenarios.eventId,
          configurationId: revenueScenarios.configurationId,
          name: revenueScenarios.name,
          status: revenueScenarios.status,
          scenarioKind: revenueScenarios.scenarioKind,
          currency: revenueScenarios.currency,
          plannedGuestCount: revenueScenarios.plannedGuestCount,
          estimatedRevenueMinor: revenueScenarios.estimatedRevenueMinor,
          comfortStatus: revenueScenarios.comfortStatus,
          reviewGateCount: revenueScenarios.reviewGateCount,
          updatedAt: revenueScenarios.updatedAt,
        }).from(rankedRevenueScenarioIds)
          .innerJoin(revenueScenarios, eq(revenueScenarios.id, rankedRevenueScenarioIds.id))
          .where(eq(rankedRevenueScenarioIds.candidateRank, 1))
          .orderBy(desc(revenueScenarios.updatedAt), desc(revenueScenarios.id))
          .limit(planningPairs.size * 2);

    const scenariosByConfiguration = new Map<string, typeof scenarioRows>();
    for (const scenario of scenarioRows) {
      if (scenario.configurationId === null) continue;
      const candidates = scenariosByConfiguration.get(scenario.configurationId) ?? [];
      candidates.push(scenario);
      scenariosByConfiguration.set(scenario.configurationId, candidates);
    }

    const frames = baseFrames.map((frame) => {
      const { commercialAccess, ...publicFrame } = frame;
      const configurationId = frame.keyframe.state === "available"
        ? frame.keyframe.payload.configurationId
        : null;
      return {
        ...publicFrame,
        figures: {
          guests: deriveRoomLayoutTimelineGuestsFigure({
            keyframe: frame.keyframe,
            phaseGuestCount: frame.guestCount,
            eventGuestCount: frame.eventGuestCount,
          }),
          seatedCapacity: deriveRoomLayoutTimelineSeatedCapacity(frame.keyframe),
          staffing: {
            state: "not_checked" as const,
            value: null,
            source: "phase_staff_conflicts" as const,
            staffConflictsStatus: frame.staffConflictsStatus,
            staffConflictsLabel: frame.staffConflictsLabel,
          },
          revenue: deriveRoomLayoutTimelineRevenueFigure({
            venueId: query.venueId,
            eventId: frame.eventId,
            commercialAccess,
            keyframe: frame.keyframe,
            candidates: configurationId === null
              ? []
              : scenariosByConfiguration.get(configurationId) ?? [],
          }),
        },
      };
    });

    const response = RoomLayoutTimelineResponseSchema.parse({
      venueId: query.venueId,
      spaceId: query.spaceId,
      timeZone: room.timeZone,
      from: from.toISOString(),
      to: to.toISOString(),
      range: range.response,
      frames,
    });
    const assessment = assessRoomLayoutTimelineResponse(response);
    if (assessment.exceeded === "objects") {
      return reply.status(422).send({
        error: "Timeline snapshots contain too many layout objects. Choose a narrower range.",
        code: "TIMELINE_RESPONSE_TOO_LARGE",
        maxObjects: MAX_ROOM_LAYOUT_TIMELINE_OBJECTS,
      });
    }

    const envelope = { data: response };
    if (assessment.exceeded === "bytes") {
      return reply.status(422).send({
        error: "Timeline snapshot payload is too large. Choose a narrower range.",
        code: "TIMELINE_RESPONSE_TOO_LARGE",
        maxBytes: MAX_ROOM_LAYOUT_TIMELINE_RESPONSE_BYTES,
      });
    }
    return envelope;
  });
}
