import Fastify, { type FastifyInstance } from "fastify";
import { drizzle } from "drizzle-orm/neon-serverless";
import { EVENT_ARCHITECT_OPS_EVIDENCE_KINDS } from "@omnitwin/types";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../db/schema.js";
import { eventArchitectRoutes } from "../routes/event-architect.js";
import * as architect from "../services/event-architect.js";

const VENUE_ID = "00000000-0000-4000-8000-000000008201";
const OTHER_VENUE_ID = "00000000-0000-4000-8000-000000008202";
const USER_ID = "00000000-0000-4000-8000-000000008203";
const RESOURCE_ID = "00000000-0000-4000-8000-000000008204";

// Exercise real validation/auth/HTTP handlers against a persisted-scope seam.
// This proves authority before the engine/read boundary, not engine behavior.
vi.mock("../services/event-architect.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../services/event-architect.js")>();
  return { ...actual,
    loadEventArchitectRunScope: vi.fn(() => Promise.resolve({ venueId: VENUE_ID, createdBy: USER_ID })),
    loadEventArchitectCandidateScope: vi.fn(() => Promise.resolve({ venueId: VENUE_ID, createdBy: USER_ID, runId: RESOURCE_ID })),
    getEventArchitectRun: vi.fn(() => Promise.resolve(null)),
    getEventArchitectOpsReviewGate: vi.fn(() => Promise.resolve(null)),
    createEventArchitectRun: vi.fn(() => Promise.reject(new actual.EventArchitectCatalogueNotReadyError([]))),
    selectEventArchitectCandidate: vi.fn(() => Promise.reject(new actual.EventArchitectSelectionConflictError())),
    createEventArchitectOpsReview: vi.fn(() => Promise.reject(new actual.EventArchitectSelectionConflictError())),
  };
});

let server: FastifyInstance;
beforeAll(async () => {
  vi.stubEnv("NODE_ENV", "test");
  server = Fastify();
  await server.register(eventArchitectRoutes, { db: drizzle.mock({ schema }), prefix: "/event-architect" });
  await server.ready();
});
afterAll(async () => { await server.close(); vi.unstubAllEnvs(); });
beforeEach(() => { vi.clearAllMocks(); });

const operations = [
  { method: "GET", url: `/event-architect/runs/${RESOURCE_ID}`, boundary: () => architect.getEventArchitectRun, allowedStatus: 404 },
  { method: "GET", url: `/event-architect/candidates/${RESOURCE_ID}/ops-review`, boundary: () => architect.getEventArchitectOpsReviewGate, allowedStatus: 404 },
  { method: "POST", url: "/event-architect/runs", boundary: () => architect.createEventArchitectRun, allowedStatus: 409,
    payload: { venueId: VENUE_ID, spaceId: RESOURCE_ID, idempotencyKey: "authority-fixture", brief: {
      eventName: "Fixture event", eventType: "dinner", guestCount: 20, layoutStyle: "dinner-rounds", budgetLimitMinor: null,
      preferredDate: null, startTime: null, endTime: null, serviceModel: "none", accessibilityRequirements: [], planningPrompt: null,
    } } },
  { method: "POST", url: `/event-architect/candidates/${RESOURCE_ID}/select`, boundary: () => architect.selectEventArchitectCandidate,
    allowedStatus: 409, payload: { idempotencyKey: "authority-fixture", expectedRequestDigest: "a".repeat(64) } },
] as const;

function token(role: string, venueId: string | null, platformRole = "none") {
  return { authorization: `Bearer ${JSON.stringify({ id: USER_ID, email: "architect@test.invalid", role, venueId, platformRole })}` };
}

describe("current Event Architect authority", () => {
  it.each([
    { role: "client", venueId: VENUE_ID, deniedStatus: 403 },
    { role: "planner", venueId: VENUE_ID, deniedStatus: 403 },
    { role: "staff", venueId: OTHER_VENUE_ID, deniedStatus: 404 },
    { role: "admin", venueId: null, deniedStatus: 404 },
  ])("refuses $role at $venueId even when it created the run", async actor => {
    for (const operation of operations) {
      const { boundary, allowedStatus: _allowedStatus, ...input } = operation;
      const response = await server.inject({ ...input, headers: token(actor.role, actor.venueId) });
      expect(response.statusCode, response.body).toBe(actor.deniedStatus);
      expect(boundary()).not.toHaveBeenCalled();
    }
  });

  it.each(["staff", "admin", "hallkeeper", "platform"])("retains current %s access to the engine/read boundary", async role => {
    for (const operation of operations) {
      const { boundary, allowedStatus, ...input } = operation;
      const response = await server.inject({ ...input, headers: role === "platform" ? token("admin", null, "admin") : token(role, VENUE_ID) });
      expect(response.statusCode, response.body).toBe(allowedStatus);
      expect(boundary()).toHaveBeenCalledTimes(1);
    }
  });
});

// Release audit ai-4: the review is recorded under the reviewer's authority
// (migration 0048 allows venue_staff, venue_hallkeeper, venue_admin and
// platform_admin), so the rest of the floor, a manager included, reads the
// gate but does not record it. The web offers the form to these alone
// (OPS_REVIEW_ROLES in packages/web/src/lib/role-capabilities.ts).
describe("who records an Ops review", () => {
  const digest = (letter: string): string => letter.repeat(64);
  const review = {
    idempotencyKey: "authority-review-fixture",
    expectedRequestDigest: digest("a"), expectedSnapshotDigest: digest("b"), expectedProofDigest: digest("c"),
    expectedGuestFlowArtifactHash: digest("d"),
    decision: "approved",
    note: "Doors surveyed and routes walked for this layout.",
    validUntil: "2026-12-31T00:00:00.000Z",
    witnesses: EVENT_ARCHITECT_OPS_EVIDENCE_KINDS.map((kind) => ({
      kind, sourceLabel: "Fixture survey", sourceReference: "fixture://survey", contentDigest: digest("e"),
      observedAt: "2026-07-10T09:00:00.000Z",
    })),
  };
  const record = (headers: { authorization: string }) => server.inject({
    method: "POST", url: `/event-architect/candidates/${RESOURCE_ID}/ops-review`, headers, payload: review,
  });

  it.each(["manager", "sales", "planner"])("refuses a %s at the venue before anything is recorded", async role => {
    const response = await record(token(role, VENUE_ID));
    expect(response.statusCode, response.body).toBe(403);
    expect(architect.createEventArchitectOpsReview).not.toHaveBeenCalled();
  });

  it.each(["staff", "hallkeeper", "admin", "platform"])("records it for a %s", async role => {
    const response = await record(role === "platform" ? token("admin", null, "admin") : token(role, VENUE_ID));
    expect(response.statusCode, response.body).toBe(409);
    expect(architect.createEventArchitectOpsReview).toHaveBeenCalledTimes(1);
  });
});
