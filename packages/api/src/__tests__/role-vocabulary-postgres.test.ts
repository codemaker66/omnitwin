import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../db/client.js";
import * as schema from "../db/schema.js";
import { getUserByClerkId, type JwtUser } from "../middleware/auth.js";
import { eventRoutes } from "../routes/events.js";
import { onboardingRoutes } from "../routes/onboarding.js";
import { migrationText } from "./migration-text.js";

// The roles lane added manager, sales and caterer, and the vocabulary
// migrations are what let PostgreSQL hold them. This suite proves both halves
// on real constraints: the migrated platform database admits the new roles
// wherever the application stores one, and the migrations themselves either
// apply to the data production may already hold or stop, named, before they
// change anything.
//
// Platform gate only: the explicitly owned disposable database. Never .env,
// never DATABASE_URL. The migration cases build their own throwaway schemas.
const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const url = new URL(target);
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.port !== "55477"
    || url.pathname !== "/venviewer_platform_test" || url.search || url.hash) {
    throw new Error("Role vocabulary tests require the explicitly owned disposable platform database");
  }
}

const NEW_ROLES = ["manager", "sales", "caterer"] as const;

function bearer(user: JwtUser): { authorization: string } {
  return { authorization: `Bearer ${JSON.stringify(user)}` };
}

describe.skipIf(target === undefined)("the widened role vocabulary on the migrated platform database", () => {
  let pool: Pool;
  let db: Database;
  let server: FastifyInstance;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit target required");
    pool = new Pool({ connectionString: target, application_name: `role-vocabulary-${randomUUID()}`, max: 5 });
    db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(onboardingRoutes, { db, prefix: "/onboarding" });
    await server.register(eventRoutes, { db, prefix: "/events" });
    await server.ready();
  });
  afterAll(async () => { await server?.close(); await pool?.end(); });

  async function venue(): Promise<string> {
    const id = randomUUID();
    await db.insert(schema.venues).values({ id, name: "Synthetic role vocabulary venue", slug: `roles-${id}`, address: "Test only" });
    return id;
  }

  async function platformAdmin(): Promise<JwtUser> {
    const id = randomUUID();
    const user: JwtUser = { id, email: `${id}@test.invalid`, name: "Platform fixture admin", role: "admin", platformRole: "admin", venueId: null };
    await db.insert(schema.users).values({ id, email: user.email, name: user.name, role: "admin", platformRole: "admin" });
    return user;
  }

  // Onboarding offers every venue role, and a membership stores both of its
  // roles under their own CHECKs. Before the workspace vocabulary migration
  // this invitation was a 23514 answered as a server error.
  it("invites manager, sales and caterer through managed onboarding and admits each at sign-in", async () => {
    const venueId = await venue();
    const admin = await platformAdmin();
    const suffix = randomUUID();
    const email = (role: string): string => `${role}-${suffix}@test.invalid`;
    const response = await server.inject({ method: "POST", url: "/onboarding/managed-workspaces", headers: bearer(admin), payload: {
      organisationName: `Role vocabulary organisation ${suffix}`,
      existingVenueId: venueId,
      ownerInvite: { email: email("owner"), workspaceRole: "owner", venueRole: "admin" },
      staffInvites: NEW_ROLES.map((role) => ({ email: email(role), workspaceRole: role, venueRole: role })),
      entitlement: { planKey: "managed_deployment", billingProvider: "none" },
    } });
    expect(response.statusCode, response.body).toBe(201);

    for (const role of NEW_ROLES) {
      const membership = () => db.select({ role: schema.workspaceMemberships.role, venueRole: schema.workspaceMemberships.venueRole,
        status: schema.workspaceMemberships.status }).from(schema.workspaceMemberships)
        .where(eq(schema.workspaceMemberships.email, email(role)));
      expect(await membership(), role).toEqual([{ role, venueRole: role, status: "invited" }]);

      const user = await getUserByClerkId(db, `user_${role}_${suffix}`, email(role));
      expect(user, role).toMatchObject({ role, platformRole: "none", venueId });
      expect(await membership(), role).toEqual([{ role, venueRole: role, status: "active" }]);
    }
  });

  // A manager writes events, and every write records its actor on the plan
  // change feed. That column's CHECK is one the vocabulary migration widened;
  // without it this edit is a 23514 and a 500.
  it("records a manager's event edit on the plan-change feed", async () => {
    const venueId = await venue();
    const managerId = randomUUID();
    const eventId = randomUUID();
    const manager: JwtUser = { id: managerId, email: `${managerId}@test.invalid`, name: "Test manager", role: "manager", platformRole: "none", venueId };
    await db.insert(schema.users).values({ id: managerId, venueId, name: manager.name, email: manager.email, role: "manager" });
    await db.insert(schema.events).values({ id: eventId, venueId, createdBy: managerId, name: "Manager test dinner", guestCount: 120,
      startsAt: new Date("2026-11-02T18:00:00Z"), endsAt: new Date("2026-11-02T23:00:00Z") });

    const response = await server.inject({ method: "PATCH", url: `/events/${eventId}`, headers: bearer(manager), payload: { guestCount: 140 } });
    expect(response.statusCode, response.body).toBe(200);
    const changes = await db.select({ actorRole: schema.eventPlanChanges.actorRole }).from(schema.eventPlanChanges)
      .where(and(eq(schema.eventPlanChanges.eventId, eventId), eq(schema.eventPlanChanges.actorUserId, managerId)));
    expect(changes.length).toBeGreaterThan(0);
    expect(new Set(changes.map((change) => change.actorRole))).toEqual(new Set(["manager"]));
  });

  it("still refuses a role outside the vocabulary wherever one is stored", async () => {
    const venueId = await venue();
    await expect(pool.query("INSERT INTO users (email, name, role) VALUES ($1, 'Unlisted role', 'sous_chef')", [`${randomUUID()}@test.invalid`]))
      .rejects.toMatchObject({ code: "23514", constraint: "users_role_check" });
    await expect(pool.query("INSERT INTO user_invitations (email, role, venue_id) VALUES ($1, 'sous_chef', $2)", [`${randomUUID()}@test.invalid`, venueId]))
      .rejects.toMatchObject({ code: "23514", constraint: "user_invitations_role_check" });
    for (const role of NEW_ROLES) {
      const id = randomUUID();
      await db.insert(schema.users).values({ id, email: `${id}@test.invalid`, name: `New ${role}`, role, venueId });
    }
  });
});

// ---------------------------------------------------------------------------
// The migrations against the data production may already hold
//
// Each case builds a throwaway schema with the columns the migrations read and
// the constraints they replace, runs the real SQL the way the migrator does
// (every pending file inside one transaction), and reads the catalogue
// afterwards. A migration that cannot hold the data must say which values
// stopped it and leave every constraint, column and index as it found them.
// ---------------------------------------------------------------------------

const VOCABULARY = "_vocabulary_checks_and_hot_path_indexes";
const WORKSPACE_VOCABULARY = "_workspace_membership_role_vocabulary";

const OLD_USER_ROLES = ["client", "planner", "staff", "hallkeeper", "admin"] as const;
const OLD_AUDIENCE_ROLES = [...OLD_USER_ROLES, "supplier", "executive"] as const;

function listed(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(", ");
}

const FIXTURE_TABLES = `
  CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), role varchar(20) NOT NULL);
  CREATE TABLE user_invitations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), role varchar(20) NOT NULL,
    CONSTRAINT user_invitations_role_check CHECK (role IN (${listed(OLD_USER_ROLES)})));
  CREATE TABLE configurations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    state varchar(20) NOT NULL DEFAULT 'draft', review_status varchar(30) NOT NULL DEFAULT 'draft',
    visibility varchar(20) NOT NULL DEFAULT 'private', layout_style varchar(50) NOT NULL);
  CREATE TABLE enquiries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), state varchar(20) NOT NULL DEFAULT 'draft');
  CREATE TABLE events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), venue_id uuid, starts_at timestamptz, ends_at timestamptz);
  CREATE TABLE bookings (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE pricing_rules (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), venue_id uuid, space_id uuid, deleted_at timestamptz);
  CREATE TABLE placed_objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), asset_definition_id uuid);
  CREATE TABLE event_plan_changes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_role varchar(30) NOT NULL,
    audience_roles jsonb NOT NULL,
    CONSTRAINT event_plan_changes_actor_role_check CHECK (actor_role IN (${listed(OLD_AUDIENCE_ROLES)})));
  CREATE TABLE event_plan_notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), audience_role varchar(30) NOT NULL,
    CONSTRAINT event_plan_notifications_role_check CHECK (audience_role IN (${listed(OLD_AUDIENCE_ROLES)})));
  CREATE TABLE workspace_memberships (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), role varchar(30) NOT NULL,
    venue_role varchar(20) NOT NULL,
    CONSTRAINT workspace_memberships_role_check CHECK (role IN ('owner', ${listed(OLD_USER_ROLES)})),
    CONSTRAINT workspace_memberships_venue_role_check CHECK (venue_role IN (${listed(OLD_USER_ROLES)})));
`;

// Every value the application writes to these columns, one row each: the
// data a production database at master's 0072 can hold.
const HELD_DATA = `
  INSERT INTO users (role) SELECT unnest(ARRAY[${listed(OLD_USER_ROLES)}]);
  INSERT INTO user_invitations (role) SELECT unnest(ARRAY[${listed(OLD_USER_ROLES)}]);
  INSERT INTO configurations (state, review_status, visibility, layout_style) VALUES
    ('draft', 'draft', 'private', 'ceremony'), ('published', 'submitted', 'staff', 'dinner-rounds'),
    ('published', 'under_review', 'public', 'dinner-banquet'), ('draft', 'approved', 'private', 'theatre'),
    ('draft', 'rejected', 'private', 'boardroom'), ('draft', 'changes_requested', 'private', 'cabaret'),
    ('draft', 'withdrawn', 'private', 'cocktail'), ('draft', 'archived', 'private', 'custom');
  INSERT INTO enquiries (state) SELECT unnest(ARRAY['draft', 'submitted', 'under_review', 'approved', 'rejected', 'withdrawn', 'archived']);
  INSERT INTO event_plan_changes (actor_role, audience_roles) SELECT role, jsonb_build_array(role, 'staff')
    FROM unnest(ARRAY[${listed(OLD_AUDIENCE_ROLES)}]) AS role;
  INSERT INTO event_plan_notifications (audience_role) SELECT unnest(ARRAY[${listed(OLD_AUDIENCE_ROLES)}]);
  INSERT INTO workspace_memberships (role, venue_role) VALUES ('owner', 'admin'), ('staff', 'staff'),
    ('hallkeeper', 'hallkeeper'), ('planner', 'planner'), ('client', 'client');
`;

interface CatalogueState {
  readonly constraints: readonly string[];
  readonly columns: readonly string[];
  readonly indexes: readonly string[];
}

interface MigrationFailure {
  readonly code: string | undefined;
  readonly message: string;
}

describe.skipIf(target === undefined)("the vocabulary migrations against data production may already hold", () => {
  let pool: Pool;
  let client: PoolClient;
  let fixtureSchema: string;

  beforeEach(async () => {
    if (target === undefined) throw new Error("Explicit target required");
    fixtureSchema = `role_vocabulary_${randomUUID().replaceAll("-", "")}`;
    pool = new Pool({ connectionString: target, max: 1, options: `-c search_path=${fixtureSchema}` });
    client = await pool.connect();
    await client.query(`CREATE SCHEMA "${fixtureSchema}"`);
    await client.query(FIXTURE_TABLES);
    await client.query(HELD_DATA);
  });

  afterEach(async () => {
    await client.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
    client.release();
    await pool.end();
  });

  async function catalogue(): Promise<CatalogueState> {
    const constraints = await client.query<{ entry: string }>(`SELECT c.conrelid::regclass::text || '.' || c.conname || ' '
        || pg_get_constraintdef(c.oid) AS entry
      FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = $1 ORDER BY 1`, [fixtureSchema]);
    const columns = await client.query<{ entry: string }>(`SELECT table_name || '.' || column_name AS entry
      FROM information_schema.columns WHERE table_schema = $1 ORDER BY 1`, [fixtureSchema]);
    const indexes = await client.query<{ entry: string }>("SELECT indexname AS entry FROM pg_indexes WHERE schemaname = $1 ORDER BY 1",
      [fixtureSchema]);
    return {
      constraints: constraints.rows.map((row) => row.entry),
      columns: columns.rows.map((row) => row.entry),
      indexes: indexes.rows.map((row) => row.entry),
    };
  }

  /** The migrator's shape: every pending file inside one transaction. */
  async function migrate(...suffixes: readonly string[]): Promise<void> {
    await client.query("BEGIN");
    for (const suffix of suffixes) await client.query(await migrationText(suffix));
    await client.query("COMMIT");
  }

  /** Runs the migrations expecting them to fail, and rolls the transaction back as the migrator does. */
  async function migrationFailure(...suffixes: readonly string[]): Promise<MigrationFailure> {
    try {
      await migrate(...suffixes);
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
      return { code, message: error instanceof Error ? error.message : String(error) };
    }
    throw new Error("The migration applied to data it should have refused");
  }

  it.each([
    { label: "an unlisted user role", poison: "UPDATE users SET role = 'executive' WHERE role = 'client'",
      named: "USERS_ROLE_VOCABULARY: users.role holds unlisted values: 'executive'" },
    { label: "an unlisted layout style", poison: "INSERT INTO configurations (layout_style) VALUES ('classroom')",
      named: "CONFIGURATIONS_LAYOUT_STYLE_VOCABULARY: configurations.layout_style holds unlisted values: 'classroom'" },
    { label: "an unlisted review status", poison: "INSERT INTO configurations (review_status, layout_style) VALUES ('pending', 'custom')",
      named: "CONFIGURATIONS_REVIEW_STATUS_VOCABULARY: configurations.review_status holds unlisted values: 'pending'" },
    { label: "an unlisted visibility", poison: "INSERT INTO configurations (visibility, layout_style) VALUES ('unlisted', 'custom')",
      named: "CONFIGURATIONS_VISIBILITY_VOCABULARY: configurations.visibility holds unlisted values: 'unlisted'" },
    { label: "an unlisted enquiry state", poison: "INSERT INTO enquiries (state) VALUES ('pondering')",
      named: "ENQUIRIES_STATE_VOCABULARY: enquiries.state holds unlisted values: 'pondering'" },
    { label: "an audience role no constraint ever validated",
      poison: "ALTER TABLE event_plan_notifications DROP CONSTRAINT event_plan_notifications_role_check; INSERT INTO event_plan_notifications (audience_role) VALUES ('sous_chef')",
      named: "AUDIENCE_ROLE_VOCABULARY: event_plan_notifications.audience_role holds unlisted values: 'sous_chef'" },
    { label: "a membership venue role no constraint ever validated",
      poison: "ALTER TABLE workspace_memberships DROP CONSTRAINT workspace_memberships_venue_role_check; INSERT INTO workspace_memberships (role, venue_role) VALUES ('staff', 'sous_chef')",
      named: "WORKSPACE_MEMBERSHIPS_VENUE_ROLE_VOCABULARY: workspace_memberships.venue_role holds unlisted values: 'sous_chef'" },
  ])("stops on $label, names it, and changes nothing", async ({ poison, named }) => {
    await client.query(poison);
    const before = await catalogue();
    const failure = await migrationFailure(VOCABULARY, WORKSPACE_VOCABULARY);
    expect(failure.code).toBe("23514");
    expect(failure.message).toContain(named);
    const after = await catalogue();
    expect(after).toEqual(before);
    expect(after.columns).not.toContain("bookings.fixture_source");
  });

  it("applies to every value production can hold, admits the new roles, and is inert on replay", async () => {
    await migrate(VOCABULARY, WORKSPACE_VOCABULARY);
    const applied = await catalogue();
    for (const column of ["bookings.fixture_source", "events.fixture_source", "enquiries.fixture_source"]) {
      expect(applied.columns).toContain(column);
    }
    for (const index of ["events_venue_starts_idx", "events_venue_ends_idx", "pricing_rules_venue_space_live_idx",
      "placed_objects_asset_definition_idx", "bookings_fixture_source_idx"]) {
      expect(applied.indexes).toContain(index);
    }

    for (const role of NEW_ROLES) {
      await client.query("INSERT INTO users (role) VALUES ($1)", [role]);
      await client.query("INSERT INTO user_invitations (role) VALUES ($1)", [role]);
      await client.query("INSERT INTO event_plan_changes (actor_role, audience_roles) VALUES ($1, jsonb_build_array($2::text))", [role, role]);
      await client.query("INSERT INTO event_plan_notifications (audience_role) VALUES ($1)", [role]);
      await client.query("INSERT INTO workspace_memberships (role, venue_role) VALUES ($1, $1)", [role]);
    }
    await expect(client.query("INSERT INTO users (role) VALUES ('sous_chef')"))
      .rejects.toMatchObject({ code: "23514", constraint: "users_role_check" });
    await expect(client.query("INSERT INTO workspace_memberships (role, venue_role) VALUES ('staff', 'sous_chef')"))
      .rejects.toMatchObject({ code: "23514", constraint: "workspace_memberships_venue_role_check" });
    await expect(client.query("INSERT INTO workspace_memberships (role, venue_role) VALUES ('sous_chef', 'staff')"))
      .rejects.toMatchObject({ code: "23514", constraint: "workspace_memberships_role_check" });

    await migrate(VOCABULARY, WORKSPACE_VOCABULARY);
    expect(await catalogue()).toEqual(applied);
  });
});
