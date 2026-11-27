import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import {
  EVENT_ARCHITECT_OPS_EVIDENCE_KINDS,
  EventArchitectOpsReviewerAuthoritySchema,
  EventArchitectOpsReviewGateSchema,
  PersistedEventArchitectRunSchema,
} from "@omnitwin/types";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { Database } from "../db/client.js";
import * as schema from "../db/schema.js";
import type { JwtUser } from "../middleware/auth.js";
import { eventArchitectRoutes } from "../routes/event-architect.js";
import { migrationText } from "./migration-text.js";

// Venue managers record Event Architect Ops reviews (Blake, 11 November 2026:
// "Yes, managers too"). Each review is stored under its reviewer's authority,
// and that column's CHECK (0048) named only staff, hallkeeper, admin and
// platform admin, so admitting managers at the route alone would have turned
// their review into a 23514 answered as a server error. This suite proves both
// halves on real constraints: a manager's review goes through the real route
// and service and is stored as venue_manager, the other roles and venues stay
// refused with nothing stored, and the migration widens 0048's CHECK over the
// rows production may already hold without touching them.
//
// Platform gate only: the explicitly owned disposable database. Never .env,
// never DATABASE_URL. The migration case builds its own throwaway schema.
const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const url = new URL(target);
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.port !== "55477"
    || url.pathname !== "/venviewer_platform_test" || url.search || url.hash) {
    throw new Error("Event Architect Ops review tests require the explicitly owned disposable platform database");
  }
}

const MIGRATION = "_event_architect_ops_review_managers";
const OPS_REVIEWS_SCHEMA = "_event_architect_ops_reviews";

function bearer(user: JwtUser): { authorization: string } {
  return { authorization: `Bearer ${JSON.stringify(user)}` };
}

const DataSchema = <T extends z.ZodType>(data: T) => z.object({ data });

describe.skipIf(target === undefined)("a venue manager records an Ops review on the migrated platform database", () => {
  let pool: Pool;
  let db: Database;
  let server: FastifyInstance;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit target required");
    pool = new Pool({ connectionString: target, application_name: `ops-review-managers-${randomUUID()}`, max: 5 });
    db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(eventArchitectRoutes, { db, prefix: "/event-architect" });
    await server.ready();
  });
  afterAll(async () => { await server?.close(); await pool?.end(); });

  async function venueWithRoom(): Promise<{ venueId: string; spaceId: string }> {
    const venueId = randomUUID();
    const spaceId = randomUUID();
    await db.insert(schema.venues).values({ id: venueId, name: "Synthetic Ops review venue", slug: `ops-review-${venueId}`, address: "Test only" });
    await db.insert(schema.spaces).values({
      id: spaceId, venueId, name: "Synthetic hall", slug: "synthetic-hall", widthM: "21.00", lengthM: "10.50", heightM: "7.00",
      floorPlanOutline: [{ x: 0, y: 0 }, { x: 21, y: 0 }, { x: 21, y: 10.5 }, { x: 0, y: 10.5 }],
    });
    return { venueId, spaceId };
  }

  async function person(role: string, venueId: string): Promise<JwtUser> {
    const id = randomUUID();
    const user: JwtUser = { id, email: `${role}-${id}@test.invalid`, name: `Test ${role}`, role, platformRole: "none", venueId };
    await db.insert(schema.users).values({ id, email: user.email, name: user.name, role, venueId });
    return user;
  }

  /** A manager generates three options and selects one: the candidate a review is recorded on. */
  async function selectedCandidate(manager: JwtUser, venueId: string, spaceId: string) {
    const created = await server.inject({ method: "POST", url: "/event-architect/runs", headers: bearer(manager), payload: {
      venueId, spaceId, idempotencyKey: `ops-review-run-${randomUUID()}`, brief: {
        eventName: "Ops review dinner", eventType: "dinner", guestCount: 30, layoutStyle: "dinner-rounds", budgetLimitMinor: null,
        preferredDate: null, startTime: null, endTime: null, serviceModel: "none", accessibilityRequirements: [], planningPrompt: null,
      },
    } });
    expect(created.statusCode, created.body).toBe(201);
    const persisted = DataSchema(PersistedEventArchitectRunSchema).parse(created.json()).data;
    const candidate = persisted.run.candidates[0];
    if (candidate === undefined) throw new Error("The engine returned no candidate");
    const selected = await server.inject({
      method: "POST", url: `/event-architect/candidates/${candidate.candidateId}/select`, headers: bearer(manager),
      payload: { idempotencyKey: `ops-review-select-${randomUUID()}`, expectedRequestDigest: persisted.run.requestDigest },
    });
    expect(selected.statusCode, selected.body).toBe(200);
    return { requestDigest: persisted.run.requestDigest, candidate };
  }

  function reviewOf(selected: Awaited<ReturnType<typeof selectedCandidate>>) {
    const day = 24 * 60 * 60 * 1000;
    return {
      idempotencyKey: `ops-review-${randomUUID()}`,
      expectedRequestDigest: selected.requestDigest,
      expectedSnapshotDigest: selected.candidate.snapshotDigest,
      expectedProofDigest: selected.candidate.validation.proofDigest,
      expectedGuestFlowArtifactHash: selected.candidate.guestFlowEvidence.artifactHash,
      decision: "approved",
      note: "Doors surveyed and the routes walked with the duty manager.",
      validUntil: new Date(Date.now() + 7 * day).toISOString(),
      witnesses: EVENT_ARCHITECT_OPS_EVIDENCE_KINDS.map((kind) => ({
        kind, sourceLabel: "Synthetic survey", sourceReference: `fixture://ops-review/${kind}`, contentDigest: "e".repeat(64),
        observedAt: new Date(Date.now() - day).toISOString(),
      })),
    };
  }

  async function storedReviews(candidateId: string) {
    return db.select({ reviewerUserId: schema.eventArchitectOpsReviews.reviewerUserId,
      reviewerAuthority: schema.eventArchitectOpsReviews.reviewerAuthority })
      .from(schema.eventArchitectOpsReviews).where(eq(schema.eventArchitectOpsReviews.candidateId, candidateId));
  }

  it("records the manager's review through the route and stores it as venue_manager", async () => {
    const { venueId, spaceId } = await venueWithRoom();
    const manager = await person("manager", venueId);
    const selected = await selectedCandidate(manager, venueId, spaceId);

    const response = await server.inject({
      method: "POST", url: `/event-architect/candidates/${selected.candidate.candidateId}/ops-review`,
      headers: bearer(manager), payload: reviewOf(selected),
    });
    expect(response.statusCode, response.body).toBe(201);
    const gate = DataSchema(EventArchitectOpsReviewGateSchema).parse(response.json()).data;
    expect(gate.status).toBe("approved");
    expect(gate.blockingForOpsCompilation).toBe(false);
    expect(gate.activeArtifact).toMatchObject({ reviewerUserId: manager.id, reviewerAuthority: "venue_manager" });
    expect(await storedReviews(selected.candidate.candidateId))
      .toEqual([{ reviewerUserId: manager.id, reviewerAuthority: "venue_manager" }]);

    // The gate reads back the same stored authority.
    const read = await server.inject({
      method: "GET", url: `/event-architect/candidates/${selected.candidate.candidateId}/ops-review`, headers: bearer(manager),
    });
    expect(read.statusCode, read.body).toBe(200);
    expect(DataSchema(EventArchitectOpsReviewGateSchema).parse(read.json()).data.history.map((artifact) => artifact.reviewerAuthority))
      .toEqual(["venue_manager"]);
  });

  it("still refuses sales, a caterer, a planner and a client at the venue, and stores nothing", async () => {
    const { venueId, spaceId } = await venueWithRoom();
    const manager = await person("manager", venueId);
    const selected = await selectedCandidate(manager, venueId, spaceId);
    for (const role of ["sales", "caterer", "planner", "client"]) {
      const response = await server.inject({
        method: "POST", url: `/event-architect/candidates/${selected.candidate.candidateId}/ops-review`,
        headers: bearer(await person(role, venueId)), payload: reviewOf(selected),
      });
      expect(response.statusCode, `${role}: ${response.body}`).toBe(403);
    }
    expect(await storedReviews(selected.candidate.candidateId)).toEqual([]);
  });

  it("answers another venue's manager as if the plan were not there, and stores nothing", async () => {
    const { venueId, spaceId } = await venueWithRoom();
    const manager = await person("manager", venueId);
    const selected = await selectedCandidate(manager, venueId, spaceId);
    const elsewhere = await venueWithRoom();
    const response = await server.inject({
      method: "POST", url: `/event-architect/candidates/${selected.candidate.candidateId}/ops-review`,
      headers: bearer(await person("manager", elsewhere.venueId)), payload: reviewOf(selected),
    });
    expect(response.statusCode, response.body).toBe(404);
    expect(await storedReviews(selected.candidate.candidateId)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The migration against the reviews production may already hold
//
// A throwaway schema gets the tables 0048 references, then 0048's own SQL, one
// stored review under each of its four authorities, and 0107 run the way the
// migrator runs it (inside one transaction). The CHECK must widen without
// rewriting a row, and the table must stay append-only.
// ---------------------------------------------------------------------------

const PRIOR_AUTHORITIES = ["venue_staff", "venue_hallkeeper", "venue_admin", "platform_admin"] as const;

const REFERENCED_TABLES = `
  CREATE TABLE venues (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE configurations (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE event_architect_candidates (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL);
`;

describe.skipIf(target === undefined)("the Ops review managers migration over 0048's stored reviews", () => {
  let pool: Pool;
  let client: PoolClient;
  let fixtureSchema: string;
  let refs: { candidateId: string; runId: string; venueId: string; configurationId: string; userId: string };

  beforeEach(async () => {
    if (target === undefined) throw new Error("Explicit target required");
    fixtureSchema = `ops_review_managers_${randomUUID().replaceAll("-", "")}`;
    pool = new Pool({ connectionString: target, max: 1, options: `-c search_path=${fixtureSchema}` });
    client = await pool.connect();
    await client.query(`CREATE SCHEMA "${fixtureSchema}"`);
    await client.query(REFERENCED_TABLES);
    await client.query(await migrationText(OPS_REVIEWS_SCHEMA));
    refs = { candidateId: randomUUID(), runId: randomUUID(), venueId: randomUUID(), configurationId: randomUUID(), userId: randomUUID() };
    await client.query("INSERT INTO venues (id) VALUES ($1)", [refs.venueId]);
    await client.query("INSERT INTO configurations (id) VALUES ($1)", [refs.configurationId]);
    await client.query("INSERT INTO users (id) VALUES ($1)", [refs.userId]);
    await client.query("INSERT INTO event_architect_candidates (id, run_id) VALUES ($1, $2)", [refs.candidateId, refs.runId]);
  });

  afterEach(async () => {
    await client.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
    client.release();
    await pool.end();
  });

  function insertReview(authority: string) {
    return client.query<{ id: string }>(`INSERT INTO event_architect_ops_reviews (candidate_id, run_id, venue_id, configuration_id,
        reviewer_user_id, reviewer_authority, idempotency_key, decision, request_digest, snapshot_digest, proof_digest,
        guest_flow_artifact_hash, artifact_digest, witnesses, note, reviewed_at, valid_until)
      VALUES ($1, $2, $3, $4, $5, $6, gen_random_uuid()::text, 'approved', repeat('a', 64), repeat('b', 64), repeat('c', 64),
        repeat('d', 64), encode(sha256(convert_to(gen_random_uuid()::text, 'UTF8')), 'hex'),
        '[{"kind":"surveyed_door_positions"},{"kind":"reviewed_route_model"},{"kind":"venue_operations_signoff"}]'::jsonb,
        'Doors surveyed and routes walked.', now(), now() + interval '7 days')
      RETURNING id`, [refs.candidateId, refs.runId, refs.venueId, refs.configurationId, refs.userId, authority]);
  }

  async function storedAuthorities(): Promise<{ id: string; reviewer_authority: string }[]> {
    return (await client.query<{ id: string; reviewer_authority: string }>(
      "SELECT id, reviewer_authority FROM event_architect_ops_reviews ORDER BY reviewer_authority",
    )).rows;
  }

  it("widens the authority CHECK to venue_manager over the stored reviews and leaves them as they were", async () => {
    for (const authority of PRIOR_AUTHORITIES) await insertReview(authority);
    const before = await storedAuthorities();
    await expect(insertReview("venue_manager"))
      .rejects.toMatchObject({ code: "23514", constraint: "event_architect_ops_reviews_authority" });

    await client.query("BEGIN");
    await client.query(await migrationText(MIGRATION));
    await client.query("COMMIT");

    expect(await storedAuthorities()).toEqual(before);
    await insertReview("venue_manager");
    await expect(insertReview("venue_sales"))
      .rejects.toMatchObject({ code: "23514", constraint: "event_architect_ops_reviews_authority" });
    const definition = (await client.query<{ definition: string }>(`SELECT pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = $1 AND c.conname = 'event_architect_ops_reviews_authority'`, [fixtureSchema])).rows;
    expect(definition).toHaveLength(1);
    const listed = [...(definition[0]?.definition ?? "").matchAll(/'([a-z_]+)'::/gu)].map((match) => match[1]);
    expect([...listed].sort()).toEqual([...EventArchitectOpsReviewerAuthoritySchema.options].sort());

    // Still append-only: 0048's triggers survive the constraint change.
    await expect(client.query("UPDATE event_architect_ops_reviews SET note = 'Rewritten after the fact.'"))
      .rejects.toThrow("event_architect_ops_reviews is append-only");
    await expect(client.query("DELETE FROM event_architect_ops_reviews"))
      .rejects.toThrow("event_architect_ops_reviews is append-only");
  });
});
