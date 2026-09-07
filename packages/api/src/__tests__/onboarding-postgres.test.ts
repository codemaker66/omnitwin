import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool, type PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../db/client.js";
import * as schema from "../db/schema.js";
import { getUserByClerkId, type JwtUser } from "../middleware/auth.js";
import { onboardingRoutes } from "../routes/onboarding.js";
import { venueRoutes } from "../routes/venues.js";

// This suite never reads DATABASE_URL or loads .env. Run only against its
// explicitly provisioned disposable loopback PostgreSQL database. A fresh schema
// contains all fixture writes; cleanup removes only this invocation's schema.
// Real SQL, CHECK/FK constraints and transactions run through the production
// handlers. Clerk's external identity proof and the Neon transport are outside
// this fixture; getUserByClerkId receives an already-verified identity.
const databaseUrl = process.env["VENVIEWER_ONBOARDING_TEST_DATABASE_URL"];
if (databaseUrl !== undefined) {
  const target = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(target.protocol)
    || target.hostname !== "127.0.0.1" || target.port !== "55478"
    || target.pathname !== "/venviewer_onboarding_test"
    || target.search !== "" || target.hash !== "") {
    throw new Error("Onboarding tests require their explicit isolated loopback database");
  }
}

const VENUE = randomUUID();
const OTHER_VENUE = randomUUID();
const PLATFORM_ADMIN = randomUUID();
const EMAIL = "elaine-fixture@example.test";
const CLERK_ID = "user_onboarding_fixture";
const platformUser: JwtUser = {
  id: PLATFORM_ADMIN, email: "platform-owner@example.test", name: "Platform fixture owner",
  role: "admin", platformRole: "admin", venueId: null,
};
const CreatedWorkspace = z.object({ data: z.object({
  workspace: z.object({ id: z.string().uuid(), primaryVenueId: z.string().uuid() }),
  ownerMembership: z.object({ id: z.string().uuid(), invitationId: z.string().uuid() }),
}) });
type CreatedWorkspaceData = z.infer<typeof CreatedWorkspace>["data"];

function headers(user: JwtUser = platformUser): { authorization: string } {
  return { authorization: `Bearer ${JSON.stringify(user)}` };
}

describe.skipIf(databaseUrl === undefined)("managed onboarding on isolated PostgreSQL", () => {
  const fixtureSchema = `onboarding_${randomUUID().replaceAll("-", "")}`;
  let pool: Pool;
  let db: Database;
  let server: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("VENVIEWER_APPROVED_AUTH_DOMAINS", "");
    pool = new Pool({ connectionString: databaseUrl, application_name: fixtureSchema,
      max: 10, options: `-c search_path=${fixtureSchema} -c statement_timeout=30000` });
    await pool.query(`CREATE SCHEMA "${fixtureSchema}"`);
    await pool.query(await readFile(new URL("./fixtures/onboarding-postgres.sql", import.meta.url), "utf8"));
    for (const migration of ["0022_user_invitations.sql", "0037_onboarding_entitlements.sql",
      "0043_platform_admin_scope.sql", "0070_client_onboarding_access.sql"]) {
      await pool.query(await readFile(new URL(`../../drizzle/${migration}`, import.meta.url), "utf8"));
    }
    db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(onboardingRoutes, { db, prefix: "/onboarding" });
    await server.register(venueRoutes, { db, prefix: "/venues" });
    await server.ready();
  }, 120000);

  beforeEach(async () => {
    await pool.query("TRUNCATE onboarding_audit_events, onboarding_projects, workspace_entitlements, workspace_memberships, workspaces, organisations, user_invitations, users, venues");
    await pool.query("INSERT INTO venues(id, name, slug, address) VALUES ($1, 'Existing venue fixture', 'existing-venue', 'Synthetic fixture address'), ($2, 'Other venue fixture', 'other-venue', 'Other synthetic address')", [VENUE, OTHER_VENUE]);
    await pool.query("INSERT INTO users(id, email, name, role, platform_role) VALUES ($1, $2, $3, 'admin', 'admin')", [PLATFORM_ADMIN, platformUser.email, platformUser.name]);
  }, 30000);

  afterAll(async () => {
    if (server !== undefined) await server.close();
    if (pool !== undefined) {
      await pool.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
      await pool.end();
    }
    vi.unstubAllEnvs();
  }, 30000);

  function onboardingPayload(email = EMAIL) {
    return {
      organisationName: "Synthetic client organisation",
      workspaceName: "Synthetic client workspace",
      existingVenueId: VENUE,
      ownerInvite: { email, name: "Elaine fixture", workspaceRole: "owner", venueRole: "admin" },
      entitlement: { planKey: "managed_deployment", billingProvider: "none" },
    };
  }

  async function createWorkspace(email = EMAIL): Promise<CreatedWorkspaceData> {
    const response = await server.inject({ method: "POST", url: "/onboarding/managed-workspaces",
      headers: headers(), payload: onboardingPayload(email) });
    expect(response.statusCode, response.body).toBe(201);
    return CreatedWorkspace.parse(response.json()).data;
  }

  async function insertExistingUser(options: {
    clerkId?: string | null; venueId?: string | null; role?: string; platformRole?: string;
  } = {}): Promise<string> {
    const id = randomUUID();
    await pool.query("INSERT INTO users(id, clerk_id, email, name, role, platform_role, venue_id) VALUES ($1, $2, $3, 'Existing fixture user', $4, $5, $6)",
      [id, options.clerkId === undefined ? CLERK_ID : options.clerkId, EMAIL,
        options.role ?? "planner", options.platformRole ?? "none", options.venueId ?? null]);
    return id;
  }

  async function invitationState(id: string) {
    const result = await pool.query<{ status: string; accepted_by: string | null; accepted_at: Date | null }>(
      "SELECT status, accepted_by, accepted_at FROM user_invitations WHERE id = $1", [id]);
    return result.rows[0];
  }

  async function expectActiveMembership(created: CreatedWorkspaceData, userId: string): Promise<void> {
    const result = await pool.query<{ user_id: string; status: string; role: string; venue_role: string; accepted_at: Date | null }>(
      "SELECT user_id, status, role, venue_role, accepted_at FROM workspace_memberships WHERE id = $1", [created.ownerMembership.id]);
    expect(result.rows[0]).toMatchObject({ user_id: userId, status: "active", role: "owner", venue_role: "admin" });
    expect(result.rows[0]?.accepted_at).toBeInstanceOf(Date);
    const invitation = await invitationState(created.ownerMembership.invitationId);
    expect(invitation).toMatchObject({ status: "accepted", accepted_by: userId });
    expect(invitation?.accepted_at).toBeInstanceOf(Date);
  }

  async function withBlocker(run: (client: PoolClient) => Promise<void>): Promise<void> {
    const client = await pool.connect();
    await client.query("BEGIN");
    try { await run(client); } finally { await client.query("ROLLBACK"); client.release(); }
  }

  async function waitForBlockedQueries(count: number): Promise<void> {
    await expect.poll(async () => {
      const result = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'", [fixtureSchema]);
      return Number(result.rows[0]?.count);
    }, { timeout: 5000 }).toBe(count);
  }

  it("attaches the existing venue and grants its invited administrator no platform authority", async () => {
    const created = await createWorkspace();
    expect(created.workspace.primaryVenueId).toBe(VENUE);
    expect((await pool.query("SELECT id FROM venues")).rowCount).toBe(2);
    const user = await getUserByClerkId(db, CLERK_ID, EMAIL.toUpperCase());
    expect(user).toMatchObject({ email: EMAIL, role: "admin", platformRole: "none", venueId: VENUE });
    if (user === null) throw new Error("Expected invited user");
    await expectActiveMembership(created, user.id);
    const ownEdit = await server.inject({ method: "PATCH", url: `/venues/${VENUE}`, headers: headers(user), payload: { name: "Managed venue fixture" } });
    expect(ownEdit.statusCode, ownEdit.body).toBe(200);
    const foreignEdit = await server.inject({ method: "PATCH", url: `/venues/${OTHER_VENUE}`, headers: headers(user), payload: { name: "Forbidden fixture change" } });
    expect(foreignEdit.statusCode).toBe(403);
    expect((await server.inject({ method: "GET", url: "/onboarding/summary", headers: headers(user) })).statusCode).toBe(403);
    expect((await pool.query<{ name: string }>("SELECT name FROM venues WHERE id = $1", [OTHER_VENUE])).rows[0]?.name).toBe("Other venue fixture");
  });

  it("creates a fresh client venue through the same managed onboarding workflow", async () => {
    const payload = onboardingPayload();
    const { existingVenueId: _existingVenueId, ...withoutExistingVenue } = payload;
    const response = await server.inject({ method: "POST", url: "/onboarding/managed-workspaces", headers: headers(), payload: {
      ...withoutExistingVenue, venue: { name: "Fresh client venue", slug: "fresh-client-venue", address: "Synthetic new address" },
    } });
    expect(response.statusCode, response.body).toBe(201);
    const created = CreatedWorkspace.parse(response.json()).data;
    expect(created.workspace.primaryVenueId).not.toBe(VENUE);
    expect((await pool.query("SELECT id FROM venues")).rowCount).toBe(3);
    const user = await getUserByClerkId(db, CLERK_ID, EMAIL);
    expect(user).toMatchObject({ role: "admin", platformRole: "none", venueId: created.workspace.primaryVenueId });
  });

  it.each([
    { label: "already signed in", clerkId: CLERK_ID, venueId: null, role: "planner" },
    { label: "legacy email account", clerkId: null, venueId: null, role: "planner" },
    { label: "same-venue staff", clerkId: CLERK_ID, venueId: VENUE, role: "staff" },
  ])("accepts the administrator invitation for $label without duplicating the account", async (existing) => {
    const userId = await insertExistingUser(existing);
    const created = await createWorkspace();
    const user = await getUserByClerkId(db, CLERK_ID, EMAIL);
    expect(user).toMatchObject({ id: userId, role: "admin", platformRole: "none", venueId: VENUE });
    await expectActiveMembership(created, userId);
    expect((await pool.query("SELECT id FROM users WHERE email = $1", [EMAIL])).rowCount).toBe(1);
  });

  it("retains platform authority only when it was already independently granted", async () => {
    const id = await insertExistingUser({ platformRole: "operator" });
    const created = await createWorkspace();
    const user = await getUserByClerkId(db, CLERK_ID, EMAIL);
    expect(user).toMatchObject({ id, role: "admin", platformRole: "operator", venueId: VENUE });
    await expectActiveMembership(created, id);
  });

  it("keeps the real invitation CHECK constraint active while accepting all audit fields atomically", async () => {
    const created = await createWorkspace();
    await expect(pool.query("UPDATE user_invitations SET status = 'accepted', accepted_at = now() WHERE id = $1", [created.ownerMembership.invitationId]))
      .rejects.toMatchObject({ constraint: "user_invitations_acceptance_check" });
    expect(await getUserByClerkId(db, CLERK_ID, EMAIL)).toMatchObject({ venueId: VENUE });
  });

  it.each([false, true])("rolls back account writes and invitation consumption when membership activation fails (existing account: %s)", async (existingAccount) => {
    const existingId = existingAccount ? await insertExistingUser({ clerkId: null }) : null;
    const created = await createWorkspace();
    await pool.query("CREATE FUNCTION reject_membership_activation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status = 'active' THEN RAISE EXCEPTION 'injected membership activation failure'; END IF; RETURN NEW; END $$");
    await pool.query("CREATE TRIGGER reject_activation BEFORE UPDATE ON workspace_memberships FOR EACH ROW EXECUTE FUNCTION reject_membership_activation()");
    try {
      await expect(getUserByClerkId(db, CLERK_ID, EMAIL)).rejects.toThrow();
      const accounts = await pool.query("SELECT id, clerk_id, role, venue_id FROM users WHERE email = $1", [EMAIL]);
      expect(accounts.rows).toEqual(existingAccount
        ? [{ id: existingId, clerk_id: null, role: "planner", venue_id: null }] : []);
      expect(await invitationState(created.ownerMembership.invitationId)).toEqual({ status: "pending", accepted_by: null, accepted_at: null });
      const membership = await pool.query("SELECT status, user_id, accepted_at FROM workspace_memberships WHERE id = $1", [created.ownerMembership.id]);
      expect(membership.rows[0]).toEqual({ status: "invited", user_id: null, accepted_at: null });
    } finally {
      await pool.query("DROP TRIGGER reject_activation ON workspace_memberships");
      await pool.query("DROP FUNCTION reject_membership_activation()");
    }
    expect(await getUserByClerkId(db, CLERK_ID, EMAIL)).toMatchObject({ role: "admin", venueId: VENUE });
  });

  it("serializes concurrent first acceptance and repeated sign-in to one account and membership", async () => {
    const created = await createWorkspace();
    await withBlocker(async (client) => {
      await client.query("SELECT id FROM user_invitations WHERE id = $1 FOR UPDATE", [created.ownerMembership.invitationId]);
      const resolutions = Promise.all([getUserByClerkId(db, CLERK_ID, EMAIL), getUserByClerkId(db, CLERK_ID, EMAIL)]);
      await waitForBlockedQueries(2);
      await client.query("COMMIT");
      const [first, second] = await resolutions;
      expect(first).toMatchObject({ role: "admin", venueId: VENUE });
      expect(second).toEqual(first);
      if (first === null || first === undefined) throw new Error("Expected concurrent invited user");
      await expectActiveMembership(created, first.id);
      expect(await getUserByClerkId(db, CLERK_ID, EMAIL)).toEqual(first);
      expect((await pool.query("SELECT id FROM users WHERE email = $1", [EMAIL])).rowCount).toBe(1);
    });
  });

  it.each(["renew", "cancel"] as const)("completes invitation acceptance while an administrator waits to %s it", async (operation) => {
    const created = await createWorkspace();
    await withBlocker(async (client) => {
      await client.query("SELECT id FROM user_invitations WHERE id = $1 FOR UPDATE", [created.ownerMembership.invitationId]);
      const acceptance = getUserByClerkId(db, CLERK_ID, EMAIL);
      await waitForBlockedQueries(1);
      const mutation = operation === "renew"
        ? server.inject({ method: "POST", url: `/onboarding/workspaces/${created.workspace.id}/invitations`, headers: headers(),
          payload: { staffInvites: [{ email: EMAIL, workspaceRole: "admin", venueRole: "admin" }] } })
        : server.inject({ method: "DELETE", url: `/onboarding/workspaces/${created.workspace.id}/invitations/${created.ownerMembership.id}`, headers: headers() });
      const outcomes = Promise.all([acceptance, mutation] as const);
      // Auth owns the email advisory lock; the operator owns the parent lock.
      // Once released, auth must still acquire FK key-share on that parent.
      await waitForBlockedQueries(2);
      await client.query("COMMIT");
      const [user, response] = await outcomes;
      expect(user).toMatchObject({ role: "admin", venueId: VENUE });
      expect(response.statusCode, response.body).toBe(operation === "renew" ? 201 : 409);
      if (user === null) throw new Error("Expected invited user");
      await expectActiveMembership(created, user.id);
    });
  });

  it("completes legacy invitation acceptance while an administrator attaches that venue", async () => {
    const invitation = await pool.query<{ id: string }>(
      "INSERT INTO user_invitations(email, role, venue_id, expires_at) VALUES ($1, 'admin', $2, now() + interval '1 day') RETURNING id", [EMAIL, VENUE]);
    const invitationId = invitation.rows[0]?.id;
    if (invitationId === undefined) throw new Error("Expected legacy invitation");
    await withBlocker(async (client) => {
      await client.query("SELECT id FROM user_invitations WHERE id = $1 FOR UPDATE", [invitationId]);
      const acceptance = getUserByClerkId(db, CLERK_ID, EMAIL);
      await waitForBlockedQueries(1);
      const attachment = server.inject({ method: "POST", url: "/onboarding/managed-workspaces", headers: headers(), payload: onboardingPayload() });
      const outcomes = Promise.all([acceptance, attachment] as const);
      await waitForBlockedQueries(2);
      await client.query("COMMIT");
      const [user, response] = await outcomes;
      expect(user).toMatchObject({ role: "admin", venueId: VENUE });
      expect(response.statusCode, response.body).toBe(201);
      const created = CreatedWorkspace.parse(response.json()).data;
      if (user === null) throw new Error("Expected invited user");
      expect(await getUserByClerkId(db, CLERK_ID, EMAIL)).toEqual(user);
      await expectActiveMembership(created, user.id);
    });
  });

  it("does not transfer an account into a different venue when an older invitation remains pending", async () => {
    const created = await createWorkspace();
    const userId = await insertExistingUser({ venueId: OTHER_VENUE, role: "admin" });
    const result = await getUserByClerkId(db, CLERK_ID, EMAIL);
    expect(result === null || result.venueId === OTHER_VENUE).toBe(true);
    expect((await pool.query("SELECT venue_id, role FROM users WHERE id = $1", [userId])).rows[0])
      .toEqual({ venue_id: OTHER_VENUE, role: "admin" });
    expect(await invitationState(created.ownerMembership.invitationId)).toEqual({ status: "pending", accepted_by: null, accepted_at: null });
  });

  it("refuses to provision a foreign-venue account and rolls the proposed workspace back", async () => {
    await insertExistingUser({ venueId: OTHER_VENUE, role: "admin" });
    const response = await server.inject({ method: "POST", url: "/onboarding/managed-workspaces", headers: headers(), payload: onboardingPayload() });
    expect(response.statusCode, response.body).toBe(409);
    for (const table of ["organisations", "workspaces", "user_invitations", "workspace_memberships", "workspace_entitlements", "onboarding_projects", "onboarding_audit_events"]) {
      expect((await pool.query(`SELECT id FROM ${table}`)).rowCount).toBe(0);
    }
    expect((await pool.query("SELECT id FROM venues")).rowCount).toBe(2);
  });

  it("reports a conflicting invitation at another venue without leaking a database uniqueness failure", async () => {
    await pool.query("INSERT INTO user_invitations(email, role, venue_id, expires_at) VALUES ($1, 'admin', $2, now() + interval '1 day')", [EMAIL, OTHER_VENUE]);
    const response = await server.inject({ method: "POST", url: "/onboarding/managed-workspaces", headers: headers(), payload: onboardingPayload() });
    expect(response.statusCode, response.body).toBe(409);
    expect((await pool.query("SELECT id FROM workspaces")).rowCount).toBe(0);
    expect((await pool.query("SELECT venue_id, status FROM user_invitations WHERE email = $1", [EMAIL])).rows)
      .toEqual([{ venue_id: OTHER_VENUE, status: "pending" }]);
  });

  it("expires an elapsed foreign invitation before provisioning the newly authorized venue", async () => {
    await pool.query("INSERT INTO user_invitations(email, role, venue_id, expires_at) VALUES ($1, 'admin', $2, now() - interval '1 day')", [EMAIL, OTHER_VENUE]);
    const created = await createWorkspace();
    expect((await pool.query("SELECT status FROM user_invitations WHERE email = $1 AND venue_id = $2", [EMAIL, OTHER_VENUE])).rows)
      .toEqual([{ status: "expired" }]);
    const user = await getUserByClerkId(db, CLERK_ID, EMAIL);
    expect(user).toMatchObject({ role: "admin", platformRole: "none", venueId: VENUE });
    if (user === null) throw new Error("Expected invited user");
    await expectActiveMembership(created, user.id);
  });

  it("denies a different Clerk identity for an email already linked to another account", async () => {
    const userId = await insertExistingUser({ clerkId: "user_original_fixture" });
    const created = await createWorkspace();
    expect(await getUserByClerkId(db, CLERK_ID, EMAIL)).toBeNull();
    expect((await pool.query("SELECT clerk_id, venue_id, role FROM users WHERE id = $1", [userId])).rows[0])
      .toEqual({ clerk_id: "user_original_fixture", venue_id: null, role: "planner" });
    expect((await invitationState(created.ownerMembership.invitationId))?.status).toBe("pending");
  });

  it("does not let approved-domain fallback override a suspended managed invitation", async () => {
    const created = await createWorkspace();
    await pool.query("UPDATE workspace_memberships SET status = 'suspended' WHERE id = $1", [created.ownerMembership.id]);
    vi.stubEnv("VENVIEWER_APPROVED_AUTH_DOMAINS", "example.test");
    vi.stubEnv("VENVIEWER_APPROVED_AUTH_DOMAIN_ROLE", "staff");
    vi.stubEnv("VENVIEWER_APPROVED_AUTH_DOMAIN_VENUE_ID", VENUE);
    try {
      expect(await getUserByClerkId(db, CLERK_ID, EMAIL)).toBeNull();
      expect((await pool.query("SELECT id FROM users WHERE email = $1", [EMAIL])).rowCount).toBe(0);
      expect(await getUserByClerkId(db, "user_domain_fixture", "domain-policy@example.test"))
        .toMatchObject({ role: "staff", platformRole: "none", venueId: VENUE });
    } finally {
      vi.stubEnv("VENVIEWER_APPROVED_AUTH_DOMAINS", "");
    }
  });

  it("does not consume expired invitations or create an uninvited local account", async () => {
    const created = await createWorkspace();
    await pool.query("UPDATE user_invitations SET expires_at = now() - interval '1 minute' WHERE id = $1", [created.ownerMembership.invitationId]);
    expect(await getUserByClerkId(db, CLERK_ID, EMAIL)).toBeNull();
    expect(await getUserByClerkId(db, "user_uninvited_fixture", "uninvited@example.test")).toBeNull();
    expect((await pool.query("SELECT id FROM users WHERE email IN ($1, $2)", [EMAIL, "uninvited@example.test"])).rowCount).toBe(0);
  });

  it("renews an expired invitation in the same workspace and preserves its owner membership", async () => {
    const created = await createWorkspace();
    await pool.query("UPDATE user_invitations SET expires_at = now() - interval '1 minute' WHERE id = $1", [created.ownerMembership.invitationId]);
    const response = await server.inject({ method: "POST", url: `/onboarding/workspaces/${created.workspace.id}/invitations`, headers: headers(),
      payload: { staffInvites: [{ email: EMAIL, workspaceRole: "admin", venueRole: "admin" }] } });
    expect(response.statusCode, response.body).toBe(201);
    expect((await invitationState(created.ownerMembership.invitationId))?.status).toBe("revoked");
    const membership = await pool.query<{ invitation_id: string; role: string; status: string }>(
      "SELECT invitation_id, role, status FROM workspace_memberships WHERE id = $1", [created.ownerMembership.id]);
    expect(membership.rows[0]).toMatchObject({ role: "owner", status: "invited" });
    const renewedInvitationId = membership.rows[0]?.invitation_id;
    expect(renewedInvitationId).not.toBe(created.ownerMembership.invitationId);
    if (renewedInvitationId === undefined) throw new Error("Expected renewed invitation");
    const user = await getUserByClerkId(db, CLERK_ID, EMAIL);
    if (user === null) throw new Error("Expected invited user");
    await expectActiveMembership({ ...created, ownerMembership: { ...created.ownerMembership, invitationId: renewedInvitationId } }, user.id);
    expect((await pool.query("SELECT id FROM workspace_memberships")).rowCount).toBe(1);
  });

  it("cancels a pending invitation without creating account access", async () => {
    const created = await createWorkspace();
    const response = await server.inject({ method: "DELETE",
      url: `/onboarding/workspaces/${created.workspace.id}/invitations/${created.ownerMembership.id}`, headers: headers() });
    expect(response.statusCode, response.body).toBe(200);
    expect((await invitationState(created.ownerMembership.invitationId))?.status).toBe("revoked");
    expect(await getUserByClerkId(db, CLERK_ID, EMAIL)).toBeNull();
    expect((await pool.query("SELECT status, user_id FROM workspace_memberships WHERE id = $1", [created.ownerMembership.id])).rows[0])
      .toEqual({ status: "removed", user_id: null });
  });

  it("cancels an unaccepted administrator upgrade while preserving the member's existing access", async () => {
    const payload = onboardingPayload();
    const createdResponse = await server.inject({ method: "POST", url: "/onboarding/managed-workspaces", headers: headers(),
      payload: { ...payload, ownerInvite: { ...payload.ownerInvite, venueRole: "staff" } } });
    expect(createdResponse.statusCode, createdResponse.body).toBe(201);
    const created = CreatedWorkspace.parse(createdResponse.json()).data;
    const staff = await getUserByClerkId(db, CLERK_ID, EMAIL);
    expect(staff).toMatchObject({ role: "staff", venueId: VENUE });
    const upgrade = await server.inject({ method: "POST", url: `/onboarding/workspaces/${created.workspace.id}/invitations`, headers: headers(),
      payload: { staffInvites: [{ email: EMAIL, workspaceRole: "admin", venueRole: "admin" }] } });
    expect(upgrade.statusCode, upgrade.body).toBe(201);
    const cancelled = await server.inject({ method: "DELETE",
      url: `/onboarding/workspaces/${created.workspace.id}/invitations/${created.ownerMembership.id}`, headers: headers() });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(await getUserByClerkId(db, CLERK_ID, EMAIL)).toEqual(staff);
    expect((await pool.query("SELECT role, venue_role, status, user_id FROM workspace_memberships WHERE id = $1", [created.ownerMembership.id])).rows[0])
      .toEqual({ role: "owner", venue_role: "staff", status: "active", user_id: staff?.id });
  });

  it.each([
    { label: "suspended workspace", statement: "UPDATE workspaces SET status = 'suspended'" },
    { label: "suspended membership", statement: "UPDATE workspace_memberships SET status = 'suspended'" },
    { label: "deleted venue", statement: "UPDATE venues SET deleted_at = now()" },
  ])("does not grant account access through a $label", async ({ statement }) => {
    const created = await createWorkspace();
    await pool.query(statement);
    expect(await getUserByClerkId(db, CLERK_ID, EMAIL)).toBeNull();
    expect((await pool.query("SELECT id FROM users WHERE email = $1", [EMAIL])).rowCount).toBe(0);
    expect((await invitationState(created.ownerMembership.invitationId))?.status).toBe("pending");
  });

  it("rechecks revocation after a first-login request waits for its invitation lock", async () => {
    const created = await createWorkspace();
    await withBlocker(async (client) => {
      await client.query("SELECT id FROM user_invitations WHERE id = $1 FOR UPDATE", [created.ownerMembership.invitationId]);
      const resolution = getUserByClerkId(db, CLERK_ID, EMAIL);
      await waitForBlockedQueries(1);
      await client.query("UPDATE user_invitations SET status = 'revoked' WHERE id = $1", [created.ownerMembership.invitationId]);
      await client.query("COMMIT");
      expect(await resolution).toBeNull();
      expect((await pool.query("SELECT id FROM users WHERE email = $1", [EMAIL])).rowCount).toBe(0);
    });
  });

  it("rolls back an entire onboarding package when its final audit write fails", async () => {
    await pool.query("CREATE FUNCTION reject_onboarding_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected onboarding audit failure'; END $$");
    await pool.query("CREATE TRIGGER reject_audit BEFORE INSERT ON onboarding_audit_events FOR EACH ROW EXECUTE FUNCTION reject_onboarding_audit()");
    try {
      const response = await server.inject({ method: "POST", url: "/onboarding/managed-workspaces", headers: headers(), payload: onboardingPayload() });
      expect(response.statusCode).toBe(500);
      for (const table of ["organisations", "workspaces", "user_invitations", "workspace_memberships", "workspace_entitlements", "onboarding_projects"]) {
        expect((await pool.query(`SELECT id FROM ${table}`)).rowCount).toBe(0);
      }
      expect((await pool.query("SELECT id FROM venues")).rowCount).toBe(2);
    } finally {
      await pool.query("DROP TRIGGER reject_audit ON onboarding_audit_events");
      await pool.query("DROP FUNCTION reject_onboarding_audit()");
    }
  });

  it("allows only one workspace to attach to a venue under concurrent provisioning", async () => {
    await withBlocker(async (client) => {
      await client.query("SELECT id FROM venues WHERE id = $1 FOR UPDATE", [VENUE]);
      const responses = Promise.all([EMAIL, "second-owner@example.test"].map((email) => server.inject({
        method: "POST", url: "/onboarding/managed-workspaces", headers: headers(), payload: onboardingPayload(email),
      })));
      await waitForBlockedQueries(2);
      await client.query("COMMIT");
      expect((await responses).map((response) => response.statusCode).sort()).toEqual([201, 409]);
      expect((await pool.query("SELECT id FROM workspaces WHERE primary_venue_id = $1", [VENUE])).rowCount).toBe(1);
      expect((await pool.query("SELECT id FROM organisations")).rowCount).toBe(1);
      expect((await pool.query("SELECT id FROM user_invitations")).rowCount).toBe(1);
    });
  });
});
