import Fastify, { type FastifyInstance } from "fastify";
import { drizzle } from "drizzle-orm/neon-serverless";
import {
  EVENT_ARCHITECT_OPS_EVIDENCE_KINDS,
  EVENT_ARCHITECT_OPS_REVIEW_ROLES,
  EVENT_ARCHITECT_OPS_REVIEW_SCHEMA_VERSION,
  EventArchitectOpsReviewGateSchema,
  EventArchitectOpsReviewerAuthoritySchema,
  USER_ROLES,
  eventArchitectOpsReviewerAuthorityFor,
  type EventArchitectOpsReviewerAuthority,
} from "@omnitwin/types";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import * as schema from "../db/schema.js";
import { eventArchitectRoutes } from "../routes/event-architect.js";
import * as architect from "../services/event-architect.js";
import { checkListValues, migrationText, sqlWithoutComments } from "./migration-text.js";

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

// The review is recorded under the reviewer's own authority (migration 0048's
// CHECK, widened for venue_manager by 0107), so the route admits exactly the
// venue roles in EVENT_ARCHITECT_OPS_REVIEW_AUTHORITY_BY_ROLE at their own
// venue and a platform admin anywhere. Managers record reviews too (Blake,
// 11 November 2026: "Yes, managers too"). The web offers the form from the
// same list (OPS_REVIEW_ROLES in packages/web/src/lib/role-capabilities.ts).
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
  } as const;
  const record = (headers: { authorization: string }) => server.inject({
    method: "POST", url: `/event-architect/candidates/${RESOURCE_ID}/ops-review`, headers, payload: review,
  });

  /** The gate the service answers once the review is stored under `reviewerAuthority`. */
  function recordedGate(reviewerAuthority: EventArchitectOpsReviewerAuthority) {
    const artifact = {
      schemaVersion: EVENT_ARCHITECT_OPS_REVIEW_SCHEMA_VERSION,
      artifactId: "00000000-0000-4000-8000-000000008205", artifactDigest: digest("f"),
      candidateId: RESOURCE_ID, runId: RESOURCE_ID, venueId: VENUE_ID, configurationId: "00000000-0000-4000-8000-000000008206",
      decision: review.decision, reviewerUserId: USER_ID, reviewerAuthority,
      requestDigest: review.expectedRequestDigest, snapshotDigest: review.expectedSnapshotDigest,
      proofDigest: review.expectedProofDigest, guestFlowArtifactHash: review.expectedGuestFlowArtifactHash,
      witnesses: review.witnesses, note: review.note,
      reviewedAt: "2026-11-11T09:00:00.000Z", validUntil: review.validUntil,
    };
    return EventArchitectOpsReviewGateSchema.parse({
      candidateId: RESOURCE_ID, status: "approved", blockingForOpsCompilation: false,
      requiredData: ["surveyed_door_positions", "reviewed_route_model", "venue_operations_signoff"],
      activeArtifact: artifact, history: [artifact],
    });
  }

  it("records a venue manager's review at their own venue under venue_manager", async () => {
    const recordReview = vi.mocked(architect.createEventArchitectOpsReview);
    const conflict = recordReview.getMockImplementation();
    recordReview.mockImplementation((_db, _candidateId, _input, actor) => Promise.resolve(recordedGate(actor.reviewerAuthority)));
    try {
      const response = await record(token("manager", VENUE_ID));
      expect(response.statusCode, response.body).toBe(201);
      expect(recordReview).toHaveBeenCalledTimes(1);
      expect(recordReview.mock.calls[0]?.[3]).toEqual({ userId: USER_ID, reviewerAuthority: "venue_manager" });
      const body = z.object({ data: EventArchitectOpsReviewGateSchema }).parse(response.json());
      expect(body.data.activeArtifact?.reviewerAuthority).toBe("venue_manager");
    } finally {
      // The other cases expect the module mock's conflict, so put it back.
      if (conflict !== undefined) recordReview.mockImplementation(conflict);
    }
  });

  it.each(["sales", "caterer", "planner", "client"])("refuses a %s at the venue before anything is recorded", async role => {
    const response = await record(token(role, VENUE_ID));
    expect(response.statusCode, response.body).toBe(403);
    expect(architect.createEventArchitectOpsReview).not.toHaveBeenCalled();
  });

  it.each(["manager", "staff", "hallkeeper", "admin"])("answers another venue's %s as if the plan were not there", async role => {
    const response = await record(token(role, OTHER_VENUE_ID));
    expect(response.statusCode, response.body).toBe(404);
    expect(architect.createEventArchitectOpsReview).not.toHaveBeenCalled();
  });

  it.each([
    ["staff", "venue_staff"], ["hallkeeper", "venue_hallkeeper"], ["manager", "venue_manager"],
    ["admin", "venue_admin"], ["platform", "platform_admin"],
  ] as const)("records it for a %s under %s", async (role, reviewerAuthority) => {
    const response = await record(role === "platform" ? token("admin", null, "admin") : token(role, VENUE_ID));
    expect(response.statusCode, response.body).toBe(409);
    expect(architect.createEventArchitectOpsReview).toHaveBeenCalledTimes(1);
    expect(vi.mocked(architect.createEventArchitectOpsReview).mock.calls[0]?.[3])
      .toEqual({ userId: USER_ID, reviewerAuthority });
  });

  it("records only authorities the database CHECK holds", async () => {
    // Admitting a role whose authority 0048's CHECK refused would turn its
    // review into a 23514 answered as a 500; 0107 is the CHECK's current list.
    const sql = sqlWithoutComments(await migrationText("_event_architect_ops_review_managers"));
    expect([...checkListValues(sql, "event_architect_ops_reviews_authority")].sort())
      .toEqual([...EventArchitectOpsReviewerAuthoritySchema.options].sort());
  });

  it("admits every venue role the shared list names, and no other role", () => {
    // The route answers from @omnitwin/types, which the web reads too.
    for (const role of [...USER_ROLES, "owner", "executive"]) {
      const authority = eventArchitectOpsReviewerAuthorityFor(role);
      expect(authority !== null, role).toBe((EVENT_ARCHITECT_OPS_REVIEW_ROLES as readonly string[]).includes(role));
    }
    expect([...EVENT_ARCHITECT_OPS_REVIEW_ROLES].sort()).toEqual(["admin", "hallkeeper", "manager", "staff"]);
  });
});
