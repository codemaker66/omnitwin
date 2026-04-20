import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// request-id — per-request correlation identifier
//
// Every request gets a UUID that:
//   - Is logged on every Pino line via `request.log` (Fastify default).
//   - Is echoed back as `X-Request-Id` on every response.
//   - Is honoured from an inbound `X-Request-Id` header so a caller's
//     service mesh can propagate its own trace ID (within a short
//     sanity-length cap so a misbehaving client can't flood our logs
//     with giant IDs).
//
// Enables the acquisition-review pattern:
//   user screenshot → "X-Request-Id: 8f3e..." → log query → Sentry event
// without having to guess from timestamps.
// ---------------------------------------------------------------------------

// Printable ASCII, dashes, underscores. Slash could be ambiguous with
// path separators in log queries; avoid.
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function registerRequestId(server: FastifyInstance): void {
  server.addHook("onRequest", (request, reply, done) => {
    const inbound = request.headers["x-request-id"];
    const candidate = typeof inbound === "string" && ID_PATTERN.test(inbound)
      ? inbound
      : randomUUID();

    // Attach to the request so every log line Fastify emits carries it.
    // `request.id` is the Fastify built-in; assigning here replaces the
    // default numeric counter with our UUID.
    (request as unknown as { id: string }).id = candidate;

    reply.header("X-Request-Id", candidate);
    done();
  });
}
