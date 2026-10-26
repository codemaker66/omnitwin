import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool as PgPool } from "pg";
import { eq } from "drizzle-orm";
import { drizzle as nodeDrizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { InviteVenueTeamMemberResult, VenueTeam } from "@omnitwin/types";
import { createDbConnection, type Database, type DatabaseConnection } from "../db/client.js";
import * as schema from "../db/schema.js";
import { getUserByClerkId } from "../middleware/auth.js";
import type { EmailPayload } from "../services/email.js";

// ---------------------------------------------------------------------------
// The venue team on a migrated disposable PostgreSQL (Plan 19 L1).
//
// A venue administrator invites a person; that person's verified first
// sign-in (the real auth bridge, getUserByClerkId) turns the grant into an
// account at the venue with that role, and the Team list moves them from
// "waiting" to "has access". Cancelling withdraws the grant so the sign-in no
// longer admits them. The gate, the conflicts and the managed-workspace path
// are proven on real rows and real locks; mocks cannot prove a grant.
//
// Email: by default the real sender in its no-provider mode (its audit row
// says dev_mode, and the route reports "not_configured"). Two cases put a
// stand-in provider in front to prove "sent" and "not_sent" and the email's
// content, without the network.
//
// Never reads DATABASE_URL/.env. Opt in with a disposable local database:
//   VENVIEWER_VENUE_TEAM_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55476/venviewer_venue_team_test
// ---------------------------------------------------------------------------

process.env["NODE_ENV"] = "test";
delete process.env["RESEND_API_KEY"];
const explicitUrl = process.env["VENVIEWER_VENUE_TEAM_TEST_DATABASE_URL"];

const provider = vi.hoisted(() => ({
  standIn: null as null | "accepts" | "refuses",
  sent: [] as EmailPayload[],
}));

vi.mock("../services/email.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/email.js")>();
  return {
    ...actual,
    isEmailDeliveryConfigured: (): boolean => provider.standIn !== null || actual.isEmailDeliveryConfigured(),
    sendEmail: async (...args: Parameters<typeof actual.sendEmail>): Promise<boolean> => {
      if (provider.standIn === null) return actual.sendEmail(...args);
      provider.sent.push(args[0]);
      return provider.standIn === "accepts";
    },
  };
});

function assertTestTarget(raw: string): void {
  const url = new URL(raw);
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1"
    || url.pathname !== "/venviewer_venue_team_test" || url.search !== "" || url.hash !== "") {
    throw new Error("Venue team regressions require the explicit loopback venviewer_venue_team_test database");
  }
}

describe("Venue team PostgreSQL target guard", () => {
  it.each([
    "postgresql://user@production.example/venviewer_venue_team_test",
    "postgresql://postgres@127.0.0.1/production",
    "postgresql://postgres@127.0.0.1/venviewer_venue_team_test?host=production.example",
  ])("rejects an unsafe target: %s", (url) => {
    expect(() => { assertTestTarget(url); }).toThrow();
  });
});

interface Actor {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly venueId: string | null;
  readonly platformRole?: "admin";
}

describe.skipIf(explicitUrl === undefined)("the venue team on PostgreSQL", () => {
  let connection: DatabaseConnection | undefined;
  let migrationPool: PgPool | undefined;
  let db: Database;
  let server: FastifyInstance;

  // The database is kept between runs: every row here is this run's.
  const run = randomUUID().slice(0, 8);
  const venueId = randomUUID();
  const otherVenueId = randomUUID();
  const managedVenueId = randomUUID();
  const address = (local: string): string => `${local}-${run}@team.invalid`;
  const admin: Actor = { id: randomUUID(), email: address("elaine"), role: "admin", venueId };
  const manager: Actor = { id: randomUUID(), email: address("morag"), role: "manager", venueId };
  const otherAdmin: Actor = { id: randomUUID(), email: address("other"), role: "admin", venueId: otherVenueId };
  const managedAdmin: Actor = { id: randomUUID(), email: address("managed"), role: "admin", venueId: managedVenueId };
  const platformAdmin: Actor = { id: randomUUID(), email: address("blake"), role: "admin", venueId: null, platformRole: "admin" };

  function as(actor: Actor): { authorization: string } {
    return { authorization: `Bearer ${JSON.stringify({ ...actor, name: actor.email, platformRole: actor.platformRole ?? "none" })}` };
  }

  async function team(actor: Actor = admin, venue = venueId): Promise<VenueTeam> {
    const response = await server.inject({ method: "GET", url: `/venues/${venue}/team`, headers: as(actor) });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<{ data: VenueTeam }>().data;
  }

  async function invite(email: string, role: string, actor: Actor = admin, venue = venueId): Promise<{ status: number; body: unknown }> {
    const response = await server.inject({
      method: "POST", url: `/venues/${venue}/team/invitations`, headers: as(actor), payload: { email, role },
    });
    return { status: response.statusCode, body: response.json<unknown>() };
  }

  function invited(result: { status: number; body: unknown }): InviteVenueTeamMemberResult {
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    return (result.body as { data: InviteVenueTeamMemberResult }).data;
  }

  function code(result: { body: unknown }): string | undefined {
    return (result.body as { code?: string }).code;
  }

  beforeAll(async () => {
    if (explicitUrl === undefined) throw new Error("Explicit test URL required");
    assertTestTarget(explicitUrl);
    migrationPool = new PgPool({ connectionString: explicitUrl });
    const target = await migrationPool.query<{ database: string }>("SELECT current_database() AS database");
    expect(target.rows[0]?.database).toBe("venviewer_venue_team_test");
    await migrate(nodeDrizzle(migrationPool), { migrationsFolder: resolve(import.meta.dirname, "../../drizzle") });
    connection = createDbConnection(explicitUrl);
    db = connection.db;

    await db.insert(schema.venues).values([
      { id: venueId, name: "Trades Hall test", slug: `team-${run}`, address: "Test only", timezone: "Europe/London" },
      { id: otherVenueId, name: "Another venue", slug: `team-other-${run}`, address: "Test only" },
      { id: managedVenueId, name: "Managed venue", slug: `team-managed-${run}`, address: "Test only" },
    ]);
    await db.insert(schema.users).values([admin, manager, otherAdmin, managedAdmin, platformAdmin].map((actor) => ({
      id: actor.id, email: actor.email, name: actor.email, role: actor.role, venueId: actor.venueId,
      platformRole: actor.platformRole ?? "none",
    })));
    await db.update(schema.users).set({ displayName: "Elaine Morrison" }).where(eq(schema.users.id, admin.id));

    const { venueTeamRoutes } = await import("../routes/venue-team.js");
    server = Fastify();
    await server.register(venueTeamRoutes, { db, prefix: "/venues/:venueId/team" });
    await server.ready();
  }, 120000);

  beforeEach(() => {
    provider.standIn = null;
    provider.sent = [];
  });

  afterAll(async () => {
    await server.close();
    await connection?.close();
    await migrationPool?.end();
  });

  it("lists the venue's people with their roles, the administrator first", async () => {
    const { members, invitations } = await team();
    expect(members.map((member) => [member.email, member.role])).toEqual([
      [admin.email, "admin"], [manager.email, "manager"],
    ]);
    expect(members[0]?.name).toBe("Elaine Morrison");
    expect(invitations).toEqual([]);
  });

  it("lets only the venue's administrators, and platform admins, see or change its team", async () => {
    for (const actor of [manager, otherAdmin]) {
      const read = await server.inject({ method: "GET", url: `/venues/${venueId}/team`, headers: as(actor) });
      expect(read.statusCode).toBe(403);
      expect((await invite(address("nobody"), "staff", actor)).status).toBe(403);
    }
    expect((await server.inject({ method: "GET", url: `/venues/${venueId}/team` })).statusCode).toBe(401);
    expect((await team(platformAdmin)).members.length).toBe(2);
  });

  it("invites a hallkeeper, who joins with that role on their first verified sign-in", async () => {
    const sam = address("sam");
    const result = invited(await invite(sam.toUpperCase(), "hallkeeper"));
    expect(result.emailDelivery).toBe("not_configured");
    expect(result.invitation).toMatchObject({ email: sam, role: "hallkeeper", invitedByName: "Elaine Morrison" });
    expect(Date.parse(result.invitation.expiresAt ?? "") - Date.now()).toBeGreaterThan(29 * 86400_000);

    const waiting = await team();
    expect(waiting.invitations.map((invitation) => [invitation.email, invitation.invitedByName])).toEqual([[sam, "Elaine Morrison"]]);
    const [audit] = await db.select().from(schema.generalAuditLog)
      .where(eq(schema.generalAuditLog.targetId, result.invitation.id));
    expect(audit).toMatchObject({ actorUserId: admin.id, action: "venue_team.invitation_created" });
    const [send] = await db.select().from(schema.emailSends)
      .where(eq(schema.emailSends.idempotencyKey, `venue-team-invitation:${result.invitation.id}`));
    expect(send).toMatchObject({ recipient: sam, status: "dev_mode" });

    const joined = await getUserByClerkId(db, `clerk_${run}_sam`, sam);
    expect(joined).toMatchObject({ email: sam, role: "hallkeeper", venueId, platformRole: "none" });
    const after = await team();
    expect(after.invitations).toEqual([]);
    expect(after.members.find((member) => member.email === sam)?.role).toBe("hallkeeper");
  });

  it("cancels an invitation, after which that sign-in is no longer admitted", async () => {
    const ross = address("ross");
    const { invitation } = invited(await invite(ross, "staff"));
    const cancel = await server.inject({ method: "DELETE", url: `/venues/${venueId}/team/invitations/${invitation.id}`, headers: as(admin) });
    expect(cancel.statusCode, cancel.body).toBe(204);
    expect((await team()).invitations.some((open) => open.id === invitation.id)).toBe(false);
    expect(await getUserByClerkId(db, `clerk_${run}_ross`, ross)).toBeNull();

    const again = await server.inject({ method: "DELETE", url: `/venues/${venueId}/team/invitations/${invitation.id}`, headers: as(admin) });
    expect(again.statusCode).toBe(409);
    expect(again.json<{ code: string }>().code).toBe("INVITATION_NOT_PENDING");
  });

  it("never lets one venue's administrator cancel another venue's invitation", async () => {
    const { invitation } = invited(await invite(address("guarded"), "sales"));
    const foreign = await server.inject({
      method: "DELETE", url: `/venues/${otherVenueId}/team/invitations/${invitation.id}`, headers: as(otherAdmin),
    });
    expect(foreign.statusCode).toBe(404);
    expect((await team()).invitations.some((open) => open.id === invitation.id)).toBe(true);
  });

  it("replaces an earlier invitation to the same address rather than keeping two", async () => {
    const isla = address("isla");
    const first = invited(await invite(isla, "staff"));
    const second = invited(await invite(isla, "sales"));
    expect(second.invitation.id).not.toBe(first.invitation.id);
    const open = (await team()).invitations.filter((invitation) => invitation.email === isla);
    expect(open.map((invitation) => invitation.role)).toEqual(["sales"]);
    expect((await getUserByClerkId(db, `clerk_${run}_isla`, isla))?.role).toBe("sales");
  });

  it("refuses grants that would duplicate, reduce or move someone's existing access", async () => {
    const own = await invite(admin.email, "admin");
    expect(own.status).toBe(409);
    expect(code(own)).toBe("ALREADY_HAS_ACCESS");

    const lower = await invite(manager.email, "staff");
    expect(lower.status).toBe(409);
    expect(code(lower)).toBe("ROLE_CHANGE_CONFLICT");

    const elsewhere = await invite(otherAdmin.email, "staff");
    expect(elsewhere.status).toBe(409);
    expect(code(elsewhere)).toBe("ACCOUNT_VENUE_CONFLICT");

    const contested = address("contested");
    invited(await invite(contested, "staff", otherAdmin, otherVenueId));
    const second = await invite(contested, "staff");
    expect(second.status).toBe(409);
    expect(code(second)).toBe("INVITATION_VENUE_CONFLICT");
  });

  it("refuses a client role and an address that is not one", async () => {
    expect((await invite(address("client"), "client")).status).toBe(400);
    expect((await invite("not an address", "staff")).status).toBe(400);
  });

  it("says when the provider took the email, and what the email tells them", async () => {
    provider.standIn = "accepts";
    const kirsty = address("kirsty");
    const result = invited(await invite(kirsty, "hallkeeper"));
    expect(result.emailDelivery).toBe("sent");
    expect(provider.sent).toHaveLength(1);
    const [email] = provider.sent;
    expect(email?.to).toBe(kirsty);
    expect(email?.subject).toBe("Your access to Trades Hall test on Venviewer");
    expect(email?.html).toContain("Elaine Morrison");
    expect(email?.html).toContain("Hallkeeper");
    expect(email?.html).toContain(kirsty);
    expect(email?.html).toContain("/register");
  });

  it("says when the email did not go out, and keeps the grant", async () => {
    provider.standIn = "refuses";
    const result = invited(await invite(address("bounced"), "staff"));
    expect(result.emailDelivery).toBe("not_sent");
    expect((await team()).invitations.some((open) => open.id === result.invitation.id)).toBe(true);
  });

  it("records the grant on the venue's managed workspace, so Clients & access shows it too", async () => {
    const [organisation] = await db.insert(schema.organisations).values({ name: `Managed ${run}`, status: "active" }).returning();
    if (organisation === undefined) throw new Error("Organisation insert returned no row");
    const [workspace] = await db.insert(schema.workspaces).values({
      organisationId: organisation.id, primaryVenueId: managedVenueId, name: `Managed ${run}`, status: "active",
    }).returning();
    if (workspace === undefined) throw new Error("Workspace insert returned no row");

    const fiona = address("fiona");
    const { invitation } = invited(await invite(fiona, "manager", managedAdmin, managedVenueId));
    const [membership] = await db.select().from(schema.workspaceMemberships)
      .where(eq(schema.workspaceMemberships.invitationId, invitation.id));
    expect(membership).toMatchObject({ workspaceId: workspace.id, email: fiona, status: "invited", venueRole: "manager", invitedBy: managedAdmin.id });

    const joined = await getUserByClerkId(db, `clerk_${run}_fiona`, fiona);
    expect(joined).toMatchObject({ role: "manager", venueId: managedVenueId });
    const [active] = await db.select().from(schema.workspaceMemberships).where(eq(schema.workspaceMemberships.id, membership?.id ?? ""));
    expect(active).toMatchObject({ status: "active", userId: joined?.id });

    const gregor = address("gregor");
    const pending = invited(await invite(gregor, "staff", managedAdmin, managedVenueId));
    const cancel = await server.inject({
      method: "DELETE", url: `/venues/${managedVenueId}/team/invitations/${pending.invitation.id}`, headers: as(managedAdmin),
    });
    expect(cancel.statusCode).toBe(204);
    const [removed] = await db.select().from(schema.workspaceMemberships)
      .where(eq(schema.workspaceMemberships.invitationId, pending.invitation.id));
    expect(removed?.status).toBe("removed");
  });
});
