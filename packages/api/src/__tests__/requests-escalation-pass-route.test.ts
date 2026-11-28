import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type * as PushTriggers from "../services/push-triggers.js";
import type * as Requests from "../services/requests.js";

// ---------------------------------------------------------------------------
// The escalation-pass endpoint (an external cron's) announces every request
// the pass escalated, and only then, if the pass failed on any, answers with
// the generic 500, so the caller and Sentry hear of it while nothing is lost
// (T-768; #495's review, LN3). The pass and the push are stubbed; the
// publish is read from the API's own event bus. No database.
// ---------------------------------------------------------------------------

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const fixture = vi.hoisted(() => ({
  venueId: "00000000-0000-4000-8000-00000000a001",
  escalatedId: "00000000-0000-4000-8000-00000000a002",
  failedId: "00000000-0000-4000-8000-00000000a003",
  pushed: [] as string[],
}));

vi.mock("../services/requests.js", async (importOriginal) => ({
  ...await importOriginal<typeof Requests>(),
  runRequestEscalationPass: () => Promise.resolve({
    escalated: [{
      request: { id: fixture.escalatedId, venueId: fixture.venueId, bookingId: null, roomId: "00000000-0000-4000-8000-00000000a004", state: "sent", audienceRoles: ["hallkeeper"] },
      reason: "unowned",
      notificationIds: ["00000000-0000-4000-8000-00000000a005"],
      recipientUserIds: ["00000000-0000-4000-8000-00000000a006"],
      emailedAdmins: 1,
      emailDeferred: false,
    }],
    failed: [{ requestId: fixture.failedId, step: "claim", error: new Error("the inbox refused this request") }],
  }),
}));

vi.mock("../services/push-triggers.js", async (importOriginal) => ({
  ...await importOriginal<typeof PushTriggers>(),
  pushForRequestEscalated: (_db: unknown, request: { readonly id: string }) => {
    fixture.pushed.push(request.id);
    return Promise.resolve();
  },
}));

const { buildServer } = await import("../index.js");
const { subscribe } = await import("../observability/event-bus.js");

const admin = { authorization: `Bearer ${JSON.stringify({ id: "00000000-0000-4000-8000-00000000a010", email: "lane9@test.invalid", name: "Lane Nine", role: "admin", venueId: fixture.venueId })}` };

describe("the escalation-pass endpoint when the pass failed on a request", () => {
  let server: FastifyInstance;
  const published: (readonly [string, string])[] = [];
  let unsubscribe: () => void = () => undefined;

  beforeAll(async () => {
    unsubscribe = subscribe("request.changed", { name: "t768-route-test", handle: (payload) => { published.push([payload.kind, payload.requestId]); } });
    server = await buildServer();
  });

  afterAll(async () => {
    unsubscribe();
    await server.close();
  });

  it("announces the request it escalated, then answers with the generic 500, naming nothing", async () => {
    const res = await server.inject({ method: "POST", url: `/venues/${fixture.venueId}/requests/escalation-pass`, headers: admin });
    // The good request was announced first: one publish and one push.
    expect(published.filter(([kind]) => kind === "request.escalated")).toEqual([["request.escalated", fixture.escalatedId]]);
    expect(fixture.pushed).toEqual([fixture.escalatedId]);
    // Then the run is an error, with the generic body: no message, no request.
    expect(res.statusCode).toBe(500);
    expect(res.body).toContain("Internal server error.");
    expect(res.body).not.toContain("inbox refused");
    expect(res.body).not.toContain(fixture.failedId);
  });
});
