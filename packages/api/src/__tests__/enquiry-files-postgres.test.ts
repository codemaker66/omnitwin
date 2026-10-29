import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../db/schema.js";
import type { Env } from "../env.js";
import type { JwtUser } from "../middleware/auth.js";
import { uploadRoutes } from "../routes/uploads.js";

// ---------------------------------------------------------------------------
// An enquiry's files, through the real upload routes on isolated PostgreSQL.
//
// A client who sent an enquiry can attach files to it and list them. The
// venue's staff attach their own working papers to the same enquiry (a
// costing, a floor plan with notes, a supplier quote). Nothing marks a staff
// upload as shared with the client, so the client lists only the files they
// sent; the venue lists every file; anyone else is refused. Before this fix
// the client's list returned the staff's files too, each with a signed read
// link.
//
// Opt-in, isolated PostgreSQL only. Never consults DATABASE_URL or .env.
// Tables are created in a schema of their own from the real Drizzle schema.
// R2 is a fake account: presigning is local arithmetic, nothing is uploaded.
// ---------------------------------------------------------------------------

const testUrl = process.env["VENVIEWER_ROUTE_TEST_DATABASE_URL"];
if (testUrl !== undefined) {
  const parsed = new URL(testUrl);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || parsed.hostname !== "127.0.0.1" || parsed.port !== "55476"
    || parsed.pathname !== "/venviewer_route_atomicity_test"
    || parsed.search !== "" || parsed.hash !== "") {
    throw new Error("Enquiry file tests require their explicit isolated loopback database");
  }
}

const VENUE = randomUUID();
const OTHER_VENUE = randomUUID();
const ROOM = randomUUID();
const ENQUIRY = randomUUID();

const CLIENT: JwtUser = { id: randomUUID(), email: "client@enquiry-files.invalid", name: "Fixture client", role: "client", platformRole: "none", venueId: null };
const OTHER_CLIENT: JwtUser = { id: randomUUID(), email: "other@enquiry-files.invalid", name: "Other client", role: "client", platformRole: "none", venueId: null };
const STAFF: JwtUser = { id: randomUUID(), email: "staff@enquiry-files.invalid", name: "Fixture staff", role: "staff", platformRole: "none", venueId: VENUE };
const MANAGER: JwtUser = { id: randomUUID(), email: "manager@enquiry-files.invalid", name: "Fixture manager", role: "manager", platformRole: "none", venueId: VENUE };
const OTHER_STAFF: JwtUser = { id: randomUUID(), email: "elsewhere@enquiry-files.invalid", name: "Other venue staff", role: "staff", platformRole: "none", venueId: OTHER_VENUE };

const FAKE_R2 = {
  R2_ACCOUNT_ID: "fixture-account",
  R2_ACCESS_KEY_ID: "fixture-access-key",
  R2_SECRET_ACCESS_KEY: "fixture-secret-key",
  R2_BUCKET_NAME: "fixture-bucket",
} as Env;

interface ListedFile {
  readonly id: string;
  readonly filename: string;
  readonly fileKey: string;
  readonly uploadedBy: string;
  readonly readUrl: string | null;
}

function headers(user: JwtUser): { authorization: string } {
  return { authorization: `Bearer ${JSON.stringify(user)}` };
}

describe.skipIf(testUrl === undefined)("an enquiry's files on isolated PostgreSQL", () => {
  let pool: Pool;
  let server: FastifyInstance;
  const fixtureSchema = `enquiry_files_${randomUUID().replaceAll("-", "")}`;
  const tables: PgTable[] = [schema.users, schema.venues, schema.spaces, schema.enquiries, schema.files];

  beforeAll(async () => {
    vi.stubEnv("NODE_ENV", "test");
    pool = new Pool({ connectionString: testUrl, application_name: fixtureSchema, max: 4, options: `-c search_path=${fixtureSchema}` });
    await pool.query(`CREATE SCHEMA "${fixtureSchema}"`);
    for (const table of tables) {
      const config = getTableConfig(table);
      const columns = config.columns.map((column) => {
        let defaultSql = "";
        if (column.name === "id") defaultSql = " primary key default gen_random_uuid()";
        else if (column.name === "created_at" || column.name === "updated_at" || column.name === "uploaded_at") defaultSql = " default now()";
        else if (typeof column.default === "boolean" || typeof column.default === "number") defaultSql = ` default ${String(column.default)}`;
        else if (typeof column.default === "string") defaultSql = ` default '${column.default.replaceAll("'", "''")}'`;
        return `"${column.name}" ${column.getSQLType()}${defaultSql}`;
      });
      await pool.query(`CREATE TABLE "${config.name}" (${columns.join(", ")})`);
    }
    const db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(uploadRoutes, { db, env: FAKE_R2, prefix: "/uploads" });
    await server.ready();
  }, 120_000);

  afterAll(async () => {
    await server?.close();
    if (pool !== undefined) {
      await pool.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
      await pool.end();
    }
    vi.unstubAllEnvs();
  }, 30_000);

  beforeEach(async () => {
    await pool.query(`TRUNCATE ${tables.map((table) => `"${getTableConfig(table).name}"`).join(", ")}`);
    await pool.query(`INSERT INTO venues (id, name, slug, timezone) VALUES
      ($1, 'Trades Hall Glasgow', 'enquiry-files-venue', 'Europe/London'), ($2, 'Another venue', 'enquiry-files-other', 'Europe/London')`,
    [VENUE, OTHER_VENUE]);
    await pool.query(`INSERT INTO spaces (id, venue_id, name, slug, sort_order) VALUES ($1, $2, 'Grand Hall', 'grand-hall', 0)`, [ROOM, VENUE]);
    for (const user of [CLIENT, OTHER_CLIENT, STAFF, MANAGER, OTHER_STAFF]) {
      await pool.query(`INSERT INTO users (id, email, name, role, platform_role, venue_id) VALUES ($1, $2, $3, $4, $5, $6)`,
        [user.id, user.email, user.name, user.role, user.platformRole, user.venueId]);
    }
    await pool.query(`INSERT INTO enquiries (id, venue_id, space_id, user_id, state, name, email) VALUES
      ($1, $2, $3, $4, 'submitted', 'Fixture client', 'client@enquiry-files.invalid')`, [ENQUIRY, VENUE, ROOM, CLIENT.id]);
  });

  async function attach(user: JwtUser, filename: string): Promise<{ status: number; fileId: string | null }> {
    const response = await server.inject({
      method: "POST",
      url: "/uploads/presigned",
      headers: headers(user),
      payload: { filename, contentType: "application/pdf", contentLengthBytes: 2048, context: "enquiry", contextId: ENQUIRY },
    });
    const data = response.json<{ data?: { fileId?: string } }>().data;
    return { status: response.statusCode, fileId: data?.fileId ?? null };
  }

  async function list(user: JwtUser): Promise<{ status: number; files: ListedFile[]; body: string }> {
    const response = await server.inject({ method: "GET", url: `/uploads/enquiry/${ENQUIRY}`, headers: headers(user) });
    const files = response.statusCode === 200 ? response.json<{ data: ListedFile[] }>().data : [];
    return { status: response.statusCode, files, body: response.body };
  }

  it("shows the client only the files they sent, never the staff's", async () => {
    const theirs = await attach(CLIENT, "our-moodboard.pdf");
    const staffPaper = await attach(STAFF, "costing-with-margin.pdf");
    expect(theirs.status).toBe(201);
    expect(staffPaper.status).toBe(201);
    const staffRow = (await pool.query<{ file_key: string }>("SELECT file_key FROM files WHERE id = $1", [staffPaper.fileId])).rows[0];
    expect(staffRow).toBeDefined();

    const asClient = await list(CLIENT);

    expect(asClient.status).toBe(200);
    expect(asClient.files.map((file) => ({ id: file.id, filename: file.filename, uploadedBy: file.uploadedBy })))
      .toEqual([{ id: theirs.fileId, filename: "our-moodboard.pdf", uploadedBy: CLIENT.id }]);
    // Not the staff file's id, name, storage key or a signed link to it.
    expect(asClient.body).not.toContain(String(staffPaper.fileId));
    expect(asClient.body).not.toContain("costing-with-margin");
    expect(asClient.body).not.toContain(staffRow?.file_key ?? "missing");
    // The client still gets a signed read link, to their own file.
    const own = asClient.files[0];
    expect(own?.readUrl).toContain(`/${String(own?.fileKey)}?`);
    expect(own?.readUrl).toContain("X-Amz-Signature=");
  });

  it("shows the venue every file on the enquiry, whoever sent it", async () => {
    const theirs = await attach(CLIENT, "our-moodboard.pdf");
    const staffPaper = await attach(STAFF, "costing-with-margin.pdf");
    const managerPaper = await attach(MANAGER, "supplier-quote.pdf");

    for (const reader of [STAFF, MANAGER]) {
      const asVenue = await list(reader);
      expect(asVenue.status).toBe(200);
      expect(asVenue.files.map((file) => file.id).sort())
        .toEqual([theirs.fileId, staffPaper.fileId, managerPaper.fileId].sort());
    }
  });

  it("refuses another client and another venue's staff", async () => {
    await attach(CLIENT, "our-moodboard.pdf");
    await attach(STAFF, "costing-with-margin.pdf");

    for (const outsider of [OTHER_CLIENT, OTHER_STAFF]) {
      const refused = await list(outsider);
      expect(refused.status).toBe(403);
      expect(refused.body).not.toContain("moodboard");
      expect(refused.body).not.toContain("costing");
      expect((await attach(outsider, "intrusion.pdf")).status).toBe(403);
    }
  });

  it("follows the enquiry's current owner, not who once uploaded to it", async () => {
    await attach(CLIENT, "our-moodboard.pdf");
    await pool.query("UPDATE enquiries SET user_id = $1 WHERE id = $2", [OTHER_CLIENT.id, ENQUIRY]);

    const former = await list(CLIENT);
    expect(former.status).toBe(403);
    expect(former.body).not.toContain("moodboard");
  });
});
