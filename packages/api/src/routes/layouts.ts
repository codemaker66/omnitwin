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
// The endpoint is read-only and idempotent. It turns a guest plan's
// six-character code into the plan's id, and that id opens the plan, so the
// pace at which codes can be tried decides how findable every guest plan is:
// thirty lookups a minute per address. A person opens a link once; nothing in
// the web app calls this on navigation.
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
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
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
