import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// POST /admin/observability/sentry-check — the production error-reporting
// check. Only a platform administrator may run it, and the error it throws
// must travel the real 5xx path: into the Sentry capture hook with its name
// and message intact, out to the caller as the generic 500 envelope.
// ---------------------------------------------------------------------------

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const capture = vi.hoisted(() => vi.fn<(error: unknown, request: unknown) => void>());

// The real module captures only when SENTRY_DSN is set; stand in a capture
// hook so the test sees exactly what production would hand to Sentry.
vi.mock("../observability/sentry.js", () => ({
  initSentry: (): Promise<void> => Promise.resolve(),
  buildSentryCapture: () => Promise.resolve(capture),
}));

const { buildServer } = await import("../index.js");
const { SentryVerificationError } = await import("../routes/admin.js");

let server: FastifyInstance;
beforeAll(async () => { server = await buildServer(); });
afterAll(async () => { await server.close(); });
beforeEach(() => { capture.mockClear(); });

function bearer(payload: { id: string; email: string; role: string; platformRole?: "none" | "operator" | "admin"; venueId: string | null }): string {
  return `Bearer ${JSON.stringify(payload)}`;
}

const URL = "/admin/observability/sentry-check";

describe("POST /admin/observability/sentry-check", () => {
  it("refuses an anonymous caller and reports nothing", async () => {
    const res = await server.inject({ method: "POST", url: URL });
    expect(res.statusCode).toBe(401);
    expect(capture).not.toHaveBeenCalled();
  });

  it("refuses a venue admin who is not a platform administrator", async () => {
    const res = await server.inject({
      method: "POST", url: URL,
      headers: { authorization: bearer({ id: "u2", email: "venue@test.com", role: "admin", platformRole: "none", venueId: "v1" }) },
    });
    expect(res.statusCode).toBe(403);
    expect(capture).not.toHaveBeenCalled();
  });

  it("refuses a hallkeeper", async () => {
    const res = await server.inject({
      method: "POST", url: URL,
      headers: { authorization: bearer({ id: "u3", email: "hk@test.com", role: "hallkeeper", venueId: "v1" }) },
    });
    expect(res.statusCode).toBe(403);
    expect(capture).not.toHaveBeenCalled();
  });

  it("sends a platform administrator's check through the real 5xx path to Sentry", async () => {
    const res = await server.inject({
      method: "POST", url: URL,
      headers: { authorization: bearer({ id: "u1", email: "admin@test.com", role: "admin", platformRole: "admin", venueId: "v1" }) },
    });

    expect(res.statusCode).toBe(500);
    // The caller sees the ordinary envelope; the deliberate message stays server-side.
    expect(res.json()).toEqual({ error: "Internal server error.", code: "INTERNAL_ERROR" });

    expect(capture).toHaveBeenCalledTimes(1);
    const [error] = capture.mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(SentryVerificationError);
    expect((error as Error).name).toBe("SentryVerificationError");
    expect((error as Error).message).toContain("prove production errors reach Sentry");
  });
});
