import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";

// ---------------------------------------------------------------------------
// Migration 0084 on isolated PostgreSQL (T-635, roadmap X1).
//
// Who wrote a proposal comment was read from its share link, and the link is
// ON DELETE SET NULL: deleting one would make its client's words the venue
// team's. 0084 records the author. Here every shape of comment the routes
// have written meets it, on tables built as the release before it defined
// them, with the real link; then the previous API keeps writing without
// naming the author, a link is deleted, and the migration runs again.
//
// Opt-in, isolated PostgreSQL only. Never consults DATABASE_URL or .env.
// ---------------------------------------------------------------------------

const testUrl = process.env["VENVIEWER_ROUTE_TEST_DATABASE_URL"];
if (testUrl !== undefined) {
  const parsed = new URL(testUrl);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || parsed.hostname !== "127.0.0.1" || parsed.port !== "55476"
    || parsed.pathname !== "/venviewer_route_atomicity_test"
    || parsed.search !== "" || parsed.hash !== "") {
    throw new Error("Proposal comment author migration tests require their explicit isolated loopback database");
  }
}

/** The column 0084 adds, which the release before it did not have. */
const ADDED = ["author_type"];

async function applyMigration(pool: Pool): Promise<void> {
  const migration = await readFile(resolve("drizzle", "0084_proposal_comment_author.sql"), "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim() !== "") await client.query(statement);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** A column as the table defined it: type, NOT NULL and the defaults these
 *  tables rely on. */
function columnSql(column: ReturnType<typeof getTableConfig>["columns"][number]): string {
  let extra = "";
  if (column.name === "id") extra = " primary key default gen_random_uuid()";
  else if (column.name === "created_at" || column.name === "updated_at") extra = " default now()";
  else if (column.name === "kind") extra = " default 'comment'";
  else if (column.name === "is_client_visible") extra = " default true";
  else if (column.name === "current_version") extra = " default 0";
  const notNull = column.notNull && column.name !== "id" ? " not null" : "";
  return `"${column.name}" ${column.getSQLType()}${notNull}${extra}`;
}

type Author = "client" | "staff";

describe.skipIf(testUrl === undefined)("migration 0084 on isolated PostgreSQL", () => {
  const fixtureSchema = `proposal_comment_author_${randomUUID().replaceAll("-", "")}`;
  const venue = randomUUID();
  const proposal = randomUUID();
  const link = randomUUID();
  const otherLink = randomUUID();
  let pool: Pool;
  const ids = {
    clientQuestion: randomUUID(),
    clientChanges: randomUUID(),
    clientAcceptance: randomUUID(),
    clientNamedVenueTeam: randomUUID(),
    venueReply: randomUUID(),
    venueReplyHidden: randomUUID(),
    lostLinkNamed: randomUUID(),
    lostLinkNameless: randomUUID(),
    lostLinkChanges: randomUUID(),
    lostLinkWithEmail: randomUUID(),
  };

  /** As the release before 0084 writes: the author is not named. */
  async function written(
    id: string,
    via: string | null,
    kind: string,
    name: string | null,
    email: string | null = null,
    visible = true,
  ): Promise<void> {
    await pool.query(
      `INSERT INTO proposal_comments (id, proposal_id, share_token_id, kind, author_name, author_email, body, is_client_visible)
       VALUES ($1, $2, $3, $4, $5, $6, 'Words as written.', $7)`,
      [id, proposal, via, kind, name, email, visible],
    );
  }
  async function author(id: string): Promise<Author> {
    const found = (await pool.query<{ author_type: Author }>(
      "SELECT author_type FROM proposal_comments WHERE id = $1", [id],
    )).rows[0];
    if (found === undefined) throw new Error(`no comment ${id}`);
    return found.author_type;
  }
  async function refusal(statement: string, values: unknown[]): Promise<string | null> {
    try {
      await pool.query(statement, values);
      return null;
    } catch (error) {
      return (error as { code?: string }).code ?? "unknown";
    }
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: testUrl, application_name: fixtureSchema, max: 2, options: `-c search_path=${fixtureSchema}` });
    await pool.query(`CREATE SCHEMA "${fixtureSchema}"`);
    // The tables as the release before 0084 defined them, with the link's
    // ON DELETE SET NULL from 0034.
    const tables: PgTable[] = [schema.proposals, schema.proposalShareTokens, schema.proposalComments];
    for (const table of tables) {
      const config = getTableConfig(table);
      const columns = config.columns.filter((column) => !ADDED.includes(column.name)).map(columnSql);
      await pool.query(`CREATE TABLE "${config.name}" (${columns.join(", ")})`);
    }
    await pool.query(`ALTER TABLE proposal_comments
      ADD FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE,
      ADD FOREIGN KEY (share_token_id) REFERENCES proposal_share_tokens(id) ON DELETE SET NULL,
      ADD CONSTRAINT proposal_comments_kind_check CHECK (kind IN ('comment', 'request_changes', 'approval_note'))`);

    await pool.query(
      "INSERT INTO proposals (id, venue_id, title, status, current_version) VALUES ($1, $2, 'Fixture proposal', 'sent', 1)",
      [proposal, venue],
    );
    for (const [id, prefix] of [[link, "abc123"], [otherLink, "def456"]] as const) {
      await pool.query(
        "INSERT INTO proposal_share_tokens (id, proposal_id, token_hash, token_prefix) VALUES ($1, $2, $3, $4)",
        [id, proposal, randomUUID().replaceAll("-", "").padEnd(64, "0"), prefix],
      );
    }

    // Through the client's link: every kind it writes, one of them from a
    // client who typed the venue's own name.
    await written(ids.clientQuestion, link, "comment", "Elaine Crawford", "elaine@example.com");
    await written(ids.clientChanges, link, "request_changes", "Elaine Crawford");
    await written(ids.clientAcceptance, link, "approval_note", null);
    await written(ids.clientNamedVenueTeam, link, "comment", "Venue team");
    // The venue's replies, as its route writes them.
    await written(ids.venueReply, null, "comment", "Venue team");
    await written(ids.venueReplyHidden, null, "comment", "Venue team", null, false);
    // The client's, whose link was deleted before 0084: each differs from
    // the reply's shape somewhere.
    await written(ids.lostLinkNamed, null, "comment", "Iain Robertson");
    await written(ids.lostLinkNameless, null, "comment", null);
    await written(ids.lostLinkChanges, null, "request_changes", "Venue team");
    await written(ids.lostLinkWithEmail, null, "comment", "Venue team", "iain@example.com");

    await applyMigration(pool);
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
    await pool.end();
  });

  it("names the client for every comment made through a link, whatever name was typed", async () => {
    expect(await author(ids.clientQuestion)).toBe("client");
    expect(await author(ids.clientChanges)).toBe("client");
    expect(await author(ids.clientAcceptance)).toBe("client");
    expect(await author(ids.clientNamedVenueTeam)).toBe("client");
  });

  it("names the venue for its replies, shown to the client or not", async () => {
    expect(await author(ids.venueReply)).toBe("staff");
    expect(await author(ids.venueReplyHidden)).toBe("staff");
  });

  it("names the client for a comment that lost its link and is not the venue's reply", async () => {
    expect(await author(ids.lostLinkNamed)).toBe("client");
    expect(await author(ids.lostLinkNameless)).toBe("client");
    expect(await author(ids.lostLinkChanges)).toBe("client");
    expect(await author(ids.lostLinkWithEmail)).toBe("client");
  });

  it("names the author of what the release before writes, and keeps it when the link is deleted", async () => {
    const question = randomUUID();
    const reply = randomUUID();
    const named = randomUUID();
    await written(question, otherLink, "comment", "Morag Stewart");
    await written(reply, null, "comment", "Venue team");
    await written(named, otherLink, "comment", "Venue team");
    expect(await author(question)).toBe("client");
    expect(await author(reply)).toBe("staff");
    expect(await author(named)).toBe("client");

    await pool.query("DELETE FROM proposal_share_tokens WHERE id = $1", [otherLink]);
    const orphaned = (await pool.query<{ share_token_id: string | null }>(
      "SELECT share_token_id FROM proposal_comments WHERE id = ANY($1)", [[question, named]],
    )).rows;
    expect(orphaned.map((row) => row.share_token_id)).toEqual([null, null]);
    expect(await author(question)).toBe("client");
    expect(await author(named)).toBe("client");
  });

  it("keeps an author the writer names", async () => {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO proposal_comments (id, proposal_id, share_token_id, kind, author_name, body, author_type)
       VALUES ($1, $2, NULL, 'comment', 'Elaine Crawford', 'Words as written.', 'client')`,
      [id, proposal],
    );
    expect(await author(id)).toBe("client");
  });

  it("refuses an author outside the two, none at all, and a venue reply carrying a link", async () => {
    expect(await refusal(
      `INSERT INTO proposal_comments (proposal_id, kind, body, author_type) VALUES ($1, 'comment', 'x', 'venue')`,
      [proposal],
    )).toBe("23514");
    expect(await refusal(
      `INSERT INTO proposal_comments (proposal_id, share_token_id, kind, body, author_type) VALUES ($1, $2, 'comment', 'x', 'staff')`,
      [proposal, link],
    )).toBe("23514");
    expect(await refusal(
      "UPDATE proposal_comments SET author_type = NULL WHERE id = $1",
      [ids.clientQuestion],
    )).toBe("23502");
    expect(await refusal(
      "UPDATE proposal_comments SET share_token_id = $2 WHERE id = $1",
      [ids.venueReply, link],
    )).toBe("23514");
  });

  it("changes nothing when it runs again, after links were deleted", async () => {
    const before = (await pool.query<{ id: string; author_type: Author }>(
      "SELECT id, author_type FROM proposal_comments ORDER BY id",
    )).rows;
    await applyMigration(pool);
    const after = (await pool.query<{ id: string; author_type: Author }>(
      "SELECT id, author_type FROM proposal_comments ORDER BY id",
    )).rows;
    expect(after).toEqual(before);
    const triggers = (await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND c.relname = 'proposal_comments' AND NOT t.tgisinternal`,
      [fixtureSchema],
    )).rows[0];
    expect(triggers?.count).toBe("1");
  });
});
