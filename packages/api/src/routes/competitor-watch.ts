import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  CaptureCreateSchema,
  CompetitorCreateSchema,
  CompetitorUpdateSchema,
  PageCheckPermissionSchema,
  PRICING_WRITE_ROLES,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { authenticate } from "../middleware/auth.js";
import { canManageCommercial, canWritePricing } from "../utils/query.js";
import {
  allowPageCheck,
  createCapture,
  createCompetitor,
  dismissPageChange,
  loadCompetitorNames,
  loadCompetitorWatch,
  loadMarketContext,
  loadSuggestedSet,
  markReviewed,
  markSourceGone,
  removeCompetitor,
  runPageChecks,
  updateCompetitor,
  withdrawPageCheck,
  type WatchRefusal,
} from "../services/competitor-watch-data.js";
import { createHttpsPageFetcher, type PageFetcher } from "../services/page-check.js";

// ---------------------------------------------------------------------------
// The competitor watch (Blake approved the proposal, 17 October 2026): a
// dated notebook beside the Pricing desk, never a price input.
//
//   GET    /venues/:venueId/competitor-watch                       the set, captures, losses, checks
//   GET    .../names                                               the set by name (who won a lost deal)
//   GET    .../context?year=YYYY                                   Current figures beside a suggestion
//   POST   .../                                                    add a venue to the set
//   POST   .../suggested                                           start from the suggested set
//   PATCH  .../:competitorId                                       change one
//   DELETE .../:competitorId                                       remove one (kept, with its captures)
//   POST   .../:competitorId/reviewed                              reviewed: the next review in six months
//   PUT    .../:competitorId/page-check                            terms and robots.txt read: checking allowed
//   DELETE .../:competitorId/page-check                            checking off
//   POST   .../:competitorId/page-change/dismissal                 a page change that was a false alarm
//   POST   .../:competitorId/captures                              record a figure (append-only)
//   POST   .../:competitorId/captures/:captureId/source-gone       its page or brochure has gone
//   POST   .../page-checks                                         check the allowed pages now
//
// Who: the watch is kept by the people who set prices (canWritePricing:
// admin and manager), beside the suggestions only they see. The set's names
// alone are read by the commercial team (canManageCommercial), who mark
// deals lost and say who won. Every query names the venue in the path.
// ---------------------------------------------------------------------------

const VenueParam = z.object({ venueId: z.uuid() });
const CompetitorParam = z.object({ venueId: z.uuid(), competitorId: z.uuid() });
const CaptureParam = CompetitorParam.extend({ captureId: z.uuid() });
const ContextQuery = z.object({ year: z.coerce.number().int().min(2000).max(2100) }).strict();

const ROLE_WORDS: Readonly<Record<string, string>> = { admin: "an administrator", manager: "a manager" };

/** Names who keeps the watch, from the one list, so the words stay true. */
export function watchRefusal(): string {
  const who = [...PRICING_WRITE_ROLES].map((role) => ROLE_WORDS[role] ?? role);
  const last = who[who.length - 1] ?? "";
  const list = who.length <= 1 ? last : `${who.slice(0, -1).join(", ")} or ${last}`;
  return `The competitor watch is kept by ${list} at the venue, beside the price list. Ask them.`;
}

function sendRefusal(reply: FastifyReply, result: WatchRefusal): FastifyReply {
  return reply.status(result.status).send({ error: result.error, code: result.code });
}

function badRequest(reply: FastifyReply, issues: z.core.$ZodIssue[]): FastifyReply {
  return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: issues });
}

export async function competitorWatchRoutes(
  server: FastifyInstance,
  opts: { db: Database; fetcher?: PageFetcher; now?: () => Date },
): Promise<void> {
  const { db } = opts;
  const fetcher = opts.fetcher ?? createHttpsPageFetcher();
  const clock = opts.now ?? ((): Date => new Date());

  /** The watch after a write, so the desk shows what is now true in one trip. */
  async function watchAfter(reply: FastifyReply, venueId: string, status: number, extra: Record<string, unknown> = {}): Promise<FastifyReply> {
    const watch = await loadCompetitorWatch(db, venueId, clock());
    reply.header("Cache-Control", "private, no-store");
    return reply.status(status).send({ data: { ...extra, watch } });
  }

  server.get("/", { preHandler: [authenticate] }, async (request, reply) => {
    const params = VenueParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid venue ID", code: "VALIDATION_ERROR" });
    if (!canWritePricing(request.user, params.data.venueId)) return reply.status(403).send({ error: watchRefusal(), code: "FORBIDDEN" });
    const watch = await loadCompetitorWatch(db, params.data.venueId, clock());
    if (watch === null) return reply.status(404).send({ error: "Venue not found", code: "NOT_FOUND" });
    reply.header("Cache-Control", "private, no-store");
    return { data: watch };
  });

  server.get("/names", { preHandler: [authenticate] }, async (request, reply) => {
    const params = VenueParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid venue ID", code: "VALIDATION_ERROR" });
    if (!canManageCommercial(request.user, params.data.venueId)) {
      return reply.status(403).send({ error: "The competitor set is the venue team's own.", code: "FORBIDDEN" });
    }
    reply.header("Cache-Control", "private, no-store");
    return { data: await loadCompetitorNames(db, params.data.venueId) };
  });

  server.get("/context", { preHandler: [authenticate] }, async (request, reply) => {
    const params = VenueParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid venue ID", code: "VALIDATION_ERROR" });
    if (!canWritePricing(request.user, params.data.venueId)) return reply.status(403).send({ error: watchRefusal(), code: "FORBIDDEN" });
    const query = ContextQuery.safeParse(request.query ?? {});
    if (!query.success) return badRequest(reply, query.error.issues);
    const context = await loadMarketContext(db, params.data.venueId, query.data.year, clock());
    if (context === null) return reply.status(404).send({ error: "Venue not found", code: "NOT_FOUND" });
    reply.header("Cache-Control", "private, no-store");
    return { data: context };
  });

  server.post("/", { preHandler: [authenticate] }, async (request, reply) => {
    const params = VenueParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid venue ID", code: "VALIDATION_ERROR" });
    if (!canWritePricing(request.user, params.data.venueId)) return reply.status(403).send({ error: watchRefusal(), code: "FORBIDDEN" });
    const body = CompetitorCreateSchema.safeParse(request.body);
    if (!body.success) return badRequest(reply, body.error.issues);
    const result = await createCompetitor(db, params.data.venueId, request.user.id, body.data, clock());
    if (!result.ok) return sendRefusal(reply, result);
    return watchAfter(reply, params.data.venueId, 201, { id: result.id });
  });

  server.post("/suggested", { preHandler: [authenticate] }, async (request, reply) => {
    const params = VenueParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid venue ID", code: "VALIDATION_ERROR" });
    if (!canWritePricing(request.user, params.data.venueId)) return reply.status(403).send({ error: watchRefusal(), code: "FORBIDDEN" });
    const result = await loadSuggestedSet(db, params.data.venueId, request.user.id, clock());
    if (!result.ok) return sendRefusal(reply, result);
    return watchAfter(reply, params.data.venueId, 201, { added: result.added });
  });

  server.patch("/:competitorId", { preHandler: [authenticate] }, async (request, reply) => {
    const params = CompetitorParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid params", code: "VALIDATION_ERROR" });
    if (!canWritePricing(request.user, params.data.venueId)) return reply.status(403).send({ error: watchRefusal(), code: "FORBIDDEN" });
    const body = CompetitorUpdateSchema.safeParse(request.body);
    if (!body.success) return badRequest(reply, body.error.issues);
    const result = await updateCompetitor(db, params.data.venueId, params.data.competitorId, request.user.id, body.data, clock());
    if (!result.ok) return sendRefusal(reply, result);
    return watchAfter(reply, params.data.venueId, 200, { checkReset: result.checkReset });
  });

  server.delete("/:competitorId", { preHandler: [authenticate] }, async (request, reply) => {
    const params = CompetitorParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid params", code: "VALIDATION_ERROR" });
    if (!canWritePricing(request.user, params.data.venueId)) return reply.status(403).send({ error: watchRefusal(), code: "FORBIDDEN" });
    const result = await removeCompetitor(db, params.data.venueId, params.data.competitorId, request.user.id, clock());
    if (!result.ok) return sendRefusal(reply, result);
    return watchAfter(reply, params.data.venueId, 200);
  });

  server.post("/:competitorId/reviewed", { preHandler: [authenticate] }, async (request, reply) => {
    const params = CompetitorParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid params", code: "VALIDATION_ERROR" });
    if (!canWritePricing(request.user, params.data.venueId)) return reply.status(403).send({ error: watchRefusal(), code: "FORBIDDEN" });
    const result = await markReviewed(db, params.data.venueId, params.data.competitorId, request.user.id, clock());
    if (!result.ok) return sendRefusal(reply, result);
    return watchAfter(reply, params.data.venueId, 200);
  });

  server.put("/:competitorId/page-check", { preHandler: [authenticate] }, async (request, reply) => {
    const params = CompetitorParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid params", code: "VALIDATION_ERROR" });
    if (!canWritePricing(request.user, params.data.venueId)) return reply.status(403).send({ error: watchRefusal(), code: "FORBIDDEN" });
    const body = PageCheckPermissionSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        error: "Record that the site's terms and its robots.txt were both read and allow the check.",
        code: "VALIDATION_ERROR",
        details: body.error.issues,
      });
    }
    const result = await allowPageCheck(db, params.data.venueId, params.data.competitorId, request.user.id, clock());
    if (!result.ok) return sendRefusal(reply, result);
    return watchAfter(reply, params.data.venueId, 200);
  });

  server.delete("/:competitorId/page-check", { preHandler: [authenticate] }, async (request, reply) => {
    const params = CompetitorParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid params", code: "VALIDATION_ERROR" });
    if (!canWritePricing(request.user, params.data.venueId)) return reply.status(403).send({ error: watchRefusal(), code: "FORBIDDEN" });
    const result = await withdrawPageCheck(db, params.data.venueId, params.data.competitorId, request.user.id, clock());
    if (!result.ok) return sendRefusal(reply, result);
    return watchAfter(reply, params.data.venueId, 200);
  });

  server.post("/:competitorId/page-change/dismissal", { preHandler: [authenticate] }, async (request, reply) => {
    const params = CompetitorParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid params", code: "VALIDATION_ERROR" });
    if (!canWritePricing(request.user, params.data.venueId)) return reply.status(403).send({ error: watchRefusal(), code: "FORBIDDEN" });
    const result = await dismissPageChange(db, params.data.venueId, params.data.competitorId, request.user.id, clock());
    if (!result.ok) return sendRefusal(reply, result);
    return watchAfter(reply, params.data.venueId, 200);
  });

  server.post("/:competitorId/captures", { preHandler: [authenticate] }, async (request, reply) => {
    const params = CompetitorParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid params", code: "VALIDATION_ERROR" });
    if (!canWritePricing(request.user, params.data.venueId)) return reply.status(403).send({ error: watchRefusal(), code: "FORBIDDEN" });
    const body = CaptureCreateSchema.safeParse(request.body);
    if (!body.success) return badRequest(reply, body.error.issues);
    const result = await createCapture(db, params.data.venueId, params.data.competitorId, request.user.id, body.data, clock());
    if (!result.ok) return sendRefusal(reply, result);
    return watchAfter(reply, params.data.venueId, 201, { id: result.id });
  });

  server.post("/:competitorId/captures/:captureId/source-gone", { preHandler: [authenticate] }, async (request, reply) => {
    const params = CaptureParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid params", code: "VALIDATION_ERROR" });
    if (!canWritePricing(request.user, params.data.venueId)) return reply.status(403).send({ error: watchRefusal(), code: "FORBIDDEN" });
    const result = await markSourceGone(db, params.data.venueId, params.data.competitorId, params.data.captureId, request.user.id, clock());
    if (!result.ok) return sendRefusal(reply, result);
    return watchAfter(reply, params.data.venueId, 200);
  });

  server.post("/page-checks", { preHandler: [authenticate] }, async (request, reply) => {
    const params = VenueParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid venue ID", code: "VALIDATION_ERROR" });
    if (!canWritePricing(request.user, params.data.venueId)) return reply.status(403).send({ error: watchRefusal(), code: "FORBIDDEN" });
    const run = await runPageChecks(db, {
      venueId: params.data.venueId, now: clock(), fetcher, runBy: "person", triggeredBy: request.user.id,
    });
    return watchAfter(reply, params.data.venueId, 200, { run });
  });
}
