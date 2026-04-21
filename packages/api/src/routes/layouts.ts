import type { FastifyInstance } from "fastify";
import { LayoutResolveQuerySchema } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { parseLayoutUrlPath, resolveLayoutUrl } from "../services/layout-resolver.js";

// ---------------------------------------------------------------------------
// GET /layouts/resolve?path=<encoded-path>
//
// Public, unauthenticated. Returns one of:
//   - { status: "canonical", configId }
//   - { status: "redirect",  configId, toPath }
//   - { status: "not_found" }
//
// The endpoint is read-only and idempotent. Rate limited generously so
// a React Router loader can call it on every navigation without fear.
//
// Malformed or reserved-segment paths resolve to `not_found` rather
// than 400 — the frontend loader uses the `not_found` result to render
// a 404 page, not to surface a validation error to the user.
// ---------------------------------------------------------------------------

interface LayoutsRoutesOptions {
  readonly db: Database;
  readonly prefix?: string;
}

export async function layoutRoutes(
  server: FastifyInstance,
  opts: LayoutsRoutesOptions,
): Promise<void> {
  const { db } = opts;

  server.get("/resolve", {
    config: { rateLimit: { max: 600, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const parsed = LayoutResolveQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "Invalid query", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    const input = parseLayoutUrlPath(parsed.data.path);
    if (input === null) {
      return reply.status(200).send({ status: "not_found" });
    }

    const result = await resolveLayoutUrl(db, input);
    return reply.status(200).send(result);
  });
}
