import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { PLAN_VIEW_LINK_LIMIT, PlanViewTokenSchema } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { generateVisitorPlanPdf, visitorPlanFilename } from "../services/visitor-plan-pdf.js";
import {
  issuePlanViewLink,
  listPlanViewLinks,
  planViewOf,
  resolvePlanViewToken,
  revokePlanViewLink,
} from "../services/plan-view-links.js";

// ---------------------------------------------------------------------------
// View-only links to a visitor's plan (fix-first item 11, 16 Oct 2026 brief).
//
// Two audiences, two capabilities, never mixed:
//
//   The ORGANISER holds the plan's configuration id (the edit capability of
//   an anonymous plan) and uses it to make, list and stop links:
//     POST /public/configurations/:configId/view-tokens
//     GET  /public/configurations/:configId/view-tokens
//     POST /public/configurations/:configId/view-tokens/:linkId/revoke
//   (POST, not DELETE, as the other public configuration writes are: the
//   web client's public POST is the one that sends no credentials.)
//
//   The RECIPIENT holds only the token and can only read:
//     GET /public/plan-views/:token           the plan, no prices, no ids
//     GET /public/plan-views/:token/plan.pdf  the same one-page PDF
//   No write verb exists under /plan-views, and no configuration route takes
//   a token (they demand a UUID). Every token that does not work (unknown,
//   malformed, stopped, expired, or its plan claimed or gone) gets the same
//   404, so a response never says which.
// ---------------------------------------------------------------------------

const ConfigIdParam = z.object({ configId: z.uuid() });
const LinkParams = z.object({ configId: z.uuid(), linkId: z.uuid() });
const TokenParam = z.object({ token: PlanViewTokenSchema });

const PLAN_NOT_FOUND = { error: "Public preview configuration not found", code: "NOT_FOUND" } as const;
const LINK_NOT_FOUND = { error: "View-only link not found", code: "NOT_FOUND" } as const;
const LINK_NOT_WORKING = { error: "This view-only link is not working", code: "VIEW_LINK_NOT_FOUND" } as const;

/** A view-only page is somebody's private plan: never cached, indexed or referred. */
function privatePage(reply: FastifyReply): FastifyReply {
  return reply
    .header("Cache-Control", "no-store")
    .header("X-Robots-Tag", "noindex, nofollow")
    .header("Referrer-Policy", "no-referrer");
}

export async function publicPlanViewRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  // POST /public/configurations/:configId/view-tokens — make a link. The
  // token is in this answer and nowhere else, ever.
  server.post("/configurations/:configId/view-tokens", {
    config: { rateLimit: { max: 10, timeWindow: "1 hour" } },
  }, async (request, reply) => {
    const params = ConfigIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid config ID", code: "VALIDATION_ERROR" });
    }
    const result = await issuePlanViewLink(db, params.data.configId);
    reply.header("Cache-Control", "no-store");
    if (result.kind === "not_found") return reply.status(404).send(PLAN_NOT_FOUND);
    if (result.kind === "limit") {
      return reply.status(409).send({
        error: `This plan already has ${String(PLAN_VIEW_LINK_LIMIT)} working view-only links. Stop one to make another.`,
        code: "VIEW_LINK_LIMIT",
        details: { limit: PLAN_VIEW_LINK_LIMIT },
      });
    }
    return reply.status(201).send({ data: result.link });
  });

  // GET /public/configurations/:configId/view-tokens — the plan's working
  // links, without their tokens (only the hash is stored).
  server.get("/configurations/:configId/view-tokens", {
    config: { rateLimit: { max: 120, timeWindow: "1 hour" } },
  }, async (request, reply) => {
    const params = ConfigIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid config ID", code: "VALIDATION_ERROR" });
    }
    const links = await listPlanViewLinks(db, params.data.configId);
    reply.header("Cache-Control", "no-store");
    if (links === null) return reply.status(404).send(PLAN_NOT_FOUND);
    return { data: links };
  });

  // POST /public/configurations/:configId/view-tokens/:linkId/revoke — stop a
  // link. Only the plan's own id stops its own links.
  server.post("/configurations/:configId/view-tokens/:linkId/revoke", {
    config: { rateLimit: { max: 30, timeWindow: "1 hour" } },
  }, async (request, reply) => {
    const params = LinkParams.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid link", code: "VALIDATION_ERROR" });
    }
    const result = await revokePlanViewLink(db, params.data.configId, params.data.linkId);
    if (result === "not_found") return reply.status(404).send(LINK_NOT_FOUND);
    return reply.status(204).send();
  });

  // GET /public/plan-views/:token — the plan as its recipient reads it.
  server.get("/plan-views/:token", {
    config: { rateLimit: { max: 120, timeWindow: "1 hour" } },
  }, async (request, reply) => {
    privatePage(reply);
    const params = TokenParam.safeParse(request.params);
    if (!params.success) return reply.status(404).send(LINK_NOT_WORKING);
    const resolved = await resolvePlanViewToken(db, params.data.token);
    if (resolved === null) return reply.status(404).send(LINK_NOT_WORKING);
    return { data: planViewOf(resolved.plan, resolved.expiresAt) };
  });

  // GET /public/plan-views/:token/plan.pdf — the same one-page PDF the
  // organiser can make, for a recipient who wants it on paper.
  server.get("/plan-views/:token/plan.pdf", {
    config: { rateLimit: { max: 30, timeWindow: "1 hour" } },
  }, async (request, reply) => {
    privatePage(reply);
    const params = TokenParam.safeParse(request.params);
    if (!params.success) return reply.status(404).send(LINK_NOT_WORKING);
    const resolved = await resolvePlanViewToken(db, params.data.token);
    if (resolved === null) return reply.status(404).send(LINK_NOT_WORKING);
    const pdf = await generateVisitorPlanPdf(resolved.plan);
    return reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="${visitorPlanFilename(resolved.plan.roomName)}"`)
      .header("Content-Length", pdf.length)
      .send(pdf);
  });
}
