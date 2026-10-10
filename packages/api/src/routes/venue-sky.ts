import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { VenueSkyQuerySchema } from "@omnitwin/types";
import { venues } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { SkyUnavailableError, type VenueSkyService } from "../services/sky/sky-service.js";

// ---------------------------------------------------------------------------
// GET /venues/:venueId/sky?at=<ISO> — the weather over a venue (T-647).
//
// Public, like GET /venues/:id and GET /venues/:venueId/spaces: it reveals
// only public weather at a venue's public address, and the relit hall reads
// it on public pages. The global limiter applies (100 a minute per address);
// a request never costs an upstream call by itself, since the forecast is
// fetched per venue location on a fixed refresh, whatever `at` is asked.
//
// 400 for a malformed id or instant, or an instant outside 2000-2099;
// 404 for an unknown or removed venue; 422 VENUE_NOT_LOCATED for a venue
// with no latitude/longitude (never a guessed location); 503
// SKY_UNAVAILABLE when no forecast can be served and no normals cover the
// venue. A body is `{ data: VenueSky }` (packages/types/src/venue-sky.ts).
// ---------------------------------------------------------------------------

const VenueIdParam = z.object({ venueId: z.string().uuid() });

const EARLIEST_AT = Date.UTC(2000, 0, 1);
const LATEST_AT = Date.UTC(2100, 0, 1);

export interface VenueLocationRecord {
  readonly id: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly timezone: string;
}

/** Where the route reads a venue's location. One method, so a test can
 *  hand the route a list. */
export interface VenueLocationStore {
  find(venueId: string): Promise<VenueLocationRecord | null>;
}

export function drizzleVenueLocationStore(db: Database): VenueLocationStore {
  return {
    async find(venueId) {
      const [row] = await db.select({
        id: venues.id,
        latitude: venues.latitude,
        longitude: venues.longitude,
        timezone: venues.timezone,
      }).from(venues).where(and(eq(venues.id, venueId), isNull(venues.deletedAt))).limit(1);
      return row ?? null;
    },
  };
}

export async function venueSkyRoutes(
  server: FastifyInstance,
  opts: { store: VenueLocationStore; sky: VenueSkyService },
): Promise<void> {
  const { store, sky } = opts;

  server.get("/:venueId/sky", async (request, reply) => {
    const params = VenueIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid venue ID", code: "VALIDATION_ERROR" });
    }
    const query = VenueSkyQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: "at must be an ISO 8601 date-time with a time zone", code: "VALIDATION_ERROR", details: query.error.issues });
    }
    const at = query.data.at === undefined ? Date.now() : Date.parse(query.data.at);
    if (!Number.isFinite(at) || at < EARLIEST_AT || at >= LATEST_AT) {
      return reply.status(400).send({ error: "at must fall between 2000 and 2099", code: "VALIDATION_ERROR" });
    }

    const venue = await store.find(params.data.venueId);
    if (venue === null) {
      return reply.status(404).send({ error: "Venue not found", code: "NOT_FOUND" });
    }
    if (venue.latitude === null || venue.longitude === null) {
      return reply.status(422).send({
        error: "This venue has no recorded location, so its sky is unknown",
        code: "VENUE_NOT_LOCATED",
      });
    }

    try {
      const answer = await sky.skyFor(
        { id: venue.id, latitude: venue.latitude, longitude: venue.longitude, timezone: venue.timezone },
        at,
      );
      return reply.header("Cache-Control", answer.cacheControl).send({ data: answer.body });
    } catch (error) {
      if (!(error instanceof SkyUnavailableError)) throw error;
      return reply.status(503).header("Cache-Control", "no-store").send({
        error: "No weather is available for this venue at this time",
        code: "SKY_UNAVAILABLE",
        details: { forecast: error.forecastReason, normals: "not_available" },
      });
    }
  });
}
