import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";

// ---------------------------------------------------------------------------
// Migrations 0082 and 0083 on isolated PostgreSQL (T-635, roadmap X1).
//
// The client's link served the latest version saved, so a version saved
// after the client asked for changes was live before anyone sent it; and the
// page named whoever an "approval_note" comment named, which anyone with the
// link could write. 0082 records the version each proposal was sent and the
// name given with its acceptance, filled from what the rows prove. Every
// kind of proposal the routes have written meets it here, on tables built as
// the release before it defined them; then the previous API keeps writing
// until the next release's 0083 runs the fill again, which must settle those
// rows, keep the version a link was sent, and change nothing else.
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
    throw new Error("Proposal sent-version migration tests require their explicit isolated loopback database");
  }
}

/** The two columns 0082 adds, which the release before it did not have. */
const ADDED = ["sent_version", "accepted_name"];

async function applyMigration(pool: Pool, file = "0082_proposal_sent_version.sql"): Promise<void> {
  const migration = await readFile(resolve("drizzle", file), "utf8");
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

interface Stored {
  readonly sent_version: number | null;
  readonly accepted_name: string | null;
}

describe.skipIf(testUrl === undefined)("migrations 0082 and 0083 on isolated PostgreSQL", () => {
  const fixtureSchema = `proposal_sent_${randomUUID().replaceAll("-", "")}`;
  const venue = randomUUID();
  const token = randomUUID();
  let pool: Pool;
  const ids = {
    draft: randomUUID(),
    sentOnce: randomUUID(),
    changesAskedThenSaved: randomUUID(),
    resentAndAccepted: randomUUID(),
    plantedNote: randomUUID(),
    sentBeforeHistory: randomUUID(),
    markedAccepted: randomUUID(),
    archivedAfterAcceptance: randomUUID(),
    adminSavedWhileSent: randomUUID(),
    reopenedThenMarked: randomUUID(),
    reopenedStillSent: randomUUID(),
    acceptedAgainByAnother: randomUUID(),
    acceptedAgainByTeam: randomUUID(),
    linkMadeWhileSent: randomUUID(),
    draftAtFillThenAccepted: randomUUID(),
  };

  async function proposal(id: string, status: string, currentVersion: number): Promise<void> {
    await pool.query(
      `INSERT INTO proposals (id, venue_id, title, status, current_version, sent_at)
       VALUES ($1, $2, 'Fixture proposal', $3, $4, $5)`,
      [id, venue, status, currentVersion, status === "draft" ? null : "2026-09-01T10:05:00Z"],
    );
  }
  async function version(id: string, n: number, at: string): Promise<void> {
    await pool.query(
      `INSERT INTO proposal_versions (proposal_id, version, payload, source_hash, created_at)
       VALUES ($1, $2, '{}'::jsonb, $3, $4)`,
      [id, n, "0".repeat(64), at],
    );
  }
  async function moved(id: string, from: string, to: string, at: string): Promise<void> {
    await pool.query(
      "INSERT INTO proposal_status_history (proposal_id, from_status, to_status, created_at) VALUES ($1, $2, $3, $4)",
      [id, from, to, at],
    );
  }
  async function note(id: string, author: string | null, at: string): Promise<void> {
    await pool.query(
      `INSERT INTO proposal_comments (proposal_id, share_token_id, kind, author_name, body, is_client_visible, created_at)
       VALUES ($1, $2, 'approval_note', $3, 'Client approved the proposal.', true, $4)`,
      [id, token, author, at],
    );
  }
  async function stored(id: string): Promise<Stored> {
    const found = (await pool.query<Stored>("SELECT sent_version, accepted_name FROM proposals WHERE id = $1", [id])).rows[0];
    if (found === undefined) throw new Error(`no proposal ${id}`);
    return found;
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: testUrl, application_name: fixtureSchema, max: 2, options: `-c search_path=${fixtureSchema}` });
    await pool.query(`CREATE SCHEMA "${fixtureSchema}"`);
    // The tables as the release before 0082 defined them.
    const tables: PgTable[] = [schema.proposals, schema.proposalVersions, schema.proposalStatusHistory, schema.proposalComments, schema.proposalShareTokens];
    for (const table of tables) {
      const config = getTableConfig(table);
      const columns = config.columns.filter((column) => !ADDED.includes(column.name)).map((column) => {
        let defaultSql = "";
        if (column.name === "id") defaultSql = " primary key default gen_random_uuid()";
        else if (column.name === "created_at" || column.name === "updated_at") defaultSql = " default now()";
        else if (column.name === "current_version") defaultSql = " default 0";
        return `"${column.name}" ${column.getSQLType()}${defaultSql}`;
      });
      await pool.query(`CREATE TABLE "${config.name}" (${columns.join(", ")})`);
    }

    // Never sent.
    await proposal(ids.draft, "draft", 0);
    // Sent once.
    await proposal(ids.sentOnce, "sent", 1);
    await version(ids.sentOnce, 1, "2026-09-01T10:00:00Z");
    await moved(ids.sentOnce, "draft", "sent", "2026-09-01T10:05:00Z");
    // The client asked for changes, and version 2 has been saved but not sent.
    await proposal(ids.changesAskedThenSaved, "changes_requested", 2);
    await version(ids.changesAskedThenSaved, 1, "2026-09-01T10:00:00Z");
    await moved(ids.changesAskedThenSaved, "draft", "sent", "2026-09-01T10:05:00Z");
    await moved(ids.changesAskedThenSaved, "sent", "changes_requested", "2026-09-01T11:00:00Z");
    await version(ids.changesAskedThenSaved, 2, "2026-09-01T12:00:00Z");
    // Version 2 was sent and the client accepted it, giving their name; the
    // note and the move share their transaction's timestamp.
    await proposal(ids.resentAndAccepted, "accepted", 2);
    await version(ids.resentAndAccepted, 1, "2026-09-01T10:00:00Z");
    await moved(ids.resentAndAccepted, "draft", "sent", "2026-09-01T10:05:00Z");
    await moved(ids.resentAndAccepted, "sent", "changes_requested", "2026-09-01T11:00:00Z");
    await version(ids.resentAndAccepted, 2, "2026-09-01T12:00:00Z");
    await moved(ids.resentAndAccepted, "changes_requested", "sent", "2026-09-01T12:30:00Z");
    await moved(ids.resentAndAccepted, "sent", "accepted", "2026-09-01T13:00:00Z");
    await note(ids.resentAndAccepted, "Elaine Crawford", "2026-09-01T13:00:00Z");
    // Someone with the link wrote an approval note of their own before the
    // client accepted without giving a name.
    await proposal(ids.plantedNote, "accepted", 1);
    await version(ids.plantedNote, 1, "2026-09-01T10:00:00Z");
    await moved(ids.plantedNote, "draft", "sent", "2026-09-01T10:05:00Z");
    await note(ids.plantedNote, "Mallory", "2026-09-01T10:30:00Z");
    await moved(ids.plantedNote, "sent", "accepted", "2026-09-01T11:00:00Z");
    await note(ids.plantedNote, null, "2026-09-01T11:00:00Z");
    // Sent before status history was kept.
    await proposal(ids.sentBeforeHistory, "sent", 2);
    await version(ids.sentBeforeHistory, 1, "2026-01-01T10:00:00Z");
    await version(ids.sentBeforeHistory, 2, "2026-01-02T10:00:00Z");
    // Marked accepted by the venue team: no note.
    await proposal(ids.markedAccepted, "accepted", 1);
    await version(ids.markedAccepted, 1, "2026-09-01T10:00:00Z");
    await moved(ids.markedAccepted, "draft", "sent", "2026-09-01T10:05:00Z");
    await moved(ids.markedAccepted, "sent", "accepted", "2026-09-02T09:00:00Z");
    // Accepted by the client, then archived by the team.
    await proposal(ids.archivedAfterAcceptance, "archived", 1);
    await version(ids.archivedAfterAcceptance, 1, "2026-09-01T10:00:00Z");
    await moved(ids.archivedAfterAcceptance, "draft", "sent", "2026-09-01T10:05:00Z");
    await moved(ids.archivedAfterAcceptance, "sent", "accepted", "2026-09-01T11:00:00Z");
    await note(ids.archivedAfterAcceptance, "  Iain Robertson ", "2026-09-01T11:00:00Z");
    await moved(ids.archivedAfterAcceptance, "accepted", "archived", "2026-09-03T09:00:00Z");

    // A platform administrator saved version 2 while version 1 was with the
    // client; the link showed version 2.
    await proposal(ids.adminSavedWhileSent, "sent", 2);
    await version(ids.adminSavedWhileSent, 1, "2026-09-01T10:00:00Z");
    await moved(ids.adminSavedWhileSent, "draft", "sent", "2026-09-01T10:05:00Z");
    await version(ids.adminSavedWhileSent, 2, "2026-09-02T10:00:00Z");
    // The client accepted as Alice Grant; an administrator reopened it, and
    // the team then marked it accepted themselves, with no note.
    await proposal(ids.reopenedThenMarked, "accepted", 1);
    await version(ids.reopenedThenMarked, 1, "2026-09-01T10:00:00Z");
    await moved(ids.reopenedThenMarked, "draft", "sent", "2026-09-01T10:05:00Z");
    await moved(ids.reopenedThenMarked, "sent", "accepted", "2026-09-01T11:00:00Z");
    await note(ids.reopenedThenMarked, "Alice Grant", "2026-09-01T11:00:00Z");
    await moved(ids.reopenedThenMarked, "accepted", "sent", "2026-09-02T09:00:00Z");
    await moved(ids.reopenedThenMarked, "sent", "accepted", "2026-09-03T09:00:00Z");
    // Reopened and still with the client: not accepted, so no name.
    await proposal(ids.reopenedStillSent, "sent", 1);
    await version(ids.reopenedStillSent, 1, "2026-09-01T10:00:00Z");
    await moved(ids.reopenedStillSent, "draft", "sent", "2026-09-01T10:05:00Z");
    await moved(ids.reopenedStillSent, "sent", "accepted", "2026-09-01T11:00:00Z");
    await note(ids.reopenedStillSent, "Bruce Kerr", "2026-09-01T11:00:00Z");
    await moved(ids.reopenedStillSent, "accepted", "sent", "2026-09-02T09:00:00Z");

    // Accepted as Alice Grant, twice over: once reopened and accepted again
    // through a link by someone else, and once by the team, both after 0082.
    for (const id of [ids.acceptedAgainByAnother, ids.acceptedAgainByTeam]) {
      await proposal(id, "accepted", 1);
      await version(id, 1, "2026-09-01T10:00:00Z");
      await moved(id, "draft", "sent", "2026-09-01T10:05:00Z");
      await moved(id, "sent", "accepted", "2026-09-01T11:00:00Z");
      await note(id, "Alice Grant", "2026-09-01T11:00:00Z");
    }
    // Sent once; after 0082 a version is saved and a new link made on it.
    await proposal(ids.linkMadeWhileSent, "sent", 1);
    await version(ids.linkMadeWhileSent, 1, "2026-09-01T10:00:00Z");
    await moved(ids.linkMadeWhileSent, "draft", "sent", "2026-09-01T10:05:00Z");
    // A draft when 0082 ran; afterwards sent, accepted, and saved again.
    await proposal(ids.draftAtFillThenAccepted, "draft", 0);

    // Exactly as it ships, in one transaction as the migrator runs it.
    await applyMigration(pool);
  }, 120_000);

  afterAll(async () => {
    if (pool !== undefined) {
      // Only the random schema created by this invocation is removed.
      await pool.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
      await pool.end();
    }
  });

  it("records the version each proposal was sent, never one saved since", async () => {
    expect(await stored(ids.draft)).toEqual({ sent_version: null, accepted_name: null });
    expect((await stored(ids.sentOnce)).sent_version).toBe(1);
    // The client asked for changes; version 2 is saved but was never sent.
    expect((await stored(ids.changesAskedThenSaved)).sent_version).toBe(1);
    expect((await stored(ids.resentAndAccepted)).sent_version).toBe(2);
    // Sent before history was kept: the version its link showed.
    expect((await stored(ids.sentBeforeHistory)).sent_version).toBe(2);
    expect((await stored(ids.archivedAfterAcceptance)).sent_version).toBe(1);
    // A version saved while sent was on the link.
    expect((await stored(ids.adminSavedWhileSent)).sent_version).toBe(2);
  });

  it("takes the name given with the acceptance itself, and no other note's", async () => {
    expect((await stored(ids.resentAndAccepted)).accepted_name).toBe("Elaine Crawford");
    expect((await stored(ids.plantedNote)).accepted_name).toBeNull();
    expect((await stored(ids.markedAccepted)).accepted_name).toBeNull();
    expect((await stored(ids.archivedAfterAcceptance)).accepted_name).toBe("Iain Robertson");
    // Only the latest acceptance's own note names it.
    expect((await stored(ids.reopenedThenMarked)).accepted_name).toBeNull();
    expect((await stored(ids.reopenedStillSent)).accepted_name).toBeNull();
  });

  it("refuses a sent version above what has been saved", async () => {
    await expect(pool.query("UPDATE proposals SET sent_version = 3 WHERE id = $1", [ids.sentOnce]))
      .rejects.toThrow(/proposals_sent_version_positive/u);
    await expect(pool.query("UPDATE proposals SET sent_version = 0 WHERE id = $1", [ids.sentOnce]))
      .rejects.toThrow(/proposals_sent_version_positive/u);
  });

  it("0083 settles what the previous API wrote meanwhile, keeps what was sent, and changes nothing else", async () => {
    const before = (await pool.query<Stored & { id: string }>("SELECT id, sent_version, accepted_name FROM proposals ORDER BY id")).rows;
    // The previous API, still running once 0082 applied, sends version 2 and
    // a first version, and sees a client accept by name, without touching
    // the new columns.
    await pool.query("UPDATE proposals SET status = 'sent' WHERE id = $1", [ids.changesAskedThenSaved]);
    await moved(ids.changesAskedThenSaved, "changes_requested", "sent", "2026-09-28T09:00:00Z");
    await pool.query("UPDATE proposals SET status = 'sent', current_version = 1 WHERE id = $1", [ids.draft]);
    await version(ids.draft, 1, "2026-09-28T09:00:00Z");
    await moved(ids.draft, "draft", "sent", "2026-09-28T09:05:00Z");
    await pool.query("UPDATE proposals SET status = 'accepted' WHERE id = $1", [ids.sentOnce]);
    await moved(ids.sentOnce, "sent", "accepted", "2026-09-28T10:00:00Z");
    await note(ids.sentOnce, "Moira Kerr", "2026-09-28T10:00:00Z");
    // The new release, once it runs: a platform administrator saves version
    // 3 while version 2 is with the client. It is a draft; the link keeps 2.
    await pool.query("UPDATE proposals SET current_version = 3 WHERE id = $1", [ids.adminSavedWhileSent]);
    await version(ids.adminSavedWhileSent, 3, "2026-09-28T11:00:00Z");

    // Reopened by an administrator and accepted again, through another link
    // as Bob Kerr, and by the team with no name.
    await pool.query("UPDATE proposals SET status = 'accepted' WHERE id = ANY($1)", [[ids.acceptedAgainByAnother, ids.acceptedAgainByTeam]]);
    for (const id of [ids.acceptedAgainByAnother, ids.acceptedAgainByTeam]) {
      await moved(id, "accepted", "sent", "2026-09-28T09:00:00Z");
      await moved(id, "sent", "accepted", "2026-09-28T10:00:00Z");
    }
    await note(ids.acceptedAgainByAnother, "Bob Kerr", "2026-09-28T10:00:00Z");
    // A platform administrator saves version 2 while version 1 is with the
    // client, then a new link is made: the previous API showed version 2.
    await pool.query("UPDATE proposals SET current_version = 2 WHERE id = $1", [ids.linkMadeWhileSent]);
    await version(ids.linkMadeWhileSent, 2, "2026-09-28T09:00:00Z");
    await pool.query(
      "INSERT INTO proposal_share_tokens (proposal_id, token_hash, token_prefix, created_at) VALUES ($1, 'minted', 'minted', '2026-09-28T09:30:00Z')",
      [ids.linkMadeWhileSent],
    );
    // Sent and accepted on version 1; version 2 saved after the acceptance.
    await pool.query("UPDATE proposals SET status = 'accepted', current_version = 2 WHERE id = $1", [ids.draftAtFillThenAccepted]);
    await version(ids.draftAtFillThenAccepted, 1, "2026-09-28T09:00:00Z");
    await moved(ids.draftAtFillThenAccepted, "draft", "sent", "2026-09-28T09:05:00Z");
    await moved(ids.draftAtFillThenAccepted, "sent", "accepted", "2026-09-28T10:00:00Z");
    await version(ids.draftAtFillThenAccepted, 2, "2026-09-28T11:00:00Z");

    await applyMigration(pool, "0083_proposal_sent_version_refill.sql");

    expect(await stored(ids.acceptedAgainByAnother)).toEqual({ sent_version: 1, accepted_name: "Bob Kerr" });
    expect(await stored(ids.acceptedAgainByTeam)).toEqual({ sent_version: 1, accepted_name: null });
    expect((await stored(ids.linkMadeWhileSent)).sent_version).toBe(2);
    expect((await stored(ids.draftAtFillThenAccepted)).sent_version).toBe(1);
    expect((await stored(ids.changesAskedThenSaved)).sent_version).toBe(2);
    expect((await stored(ids.draft)).sent_version).toBe(1);
    expect(await stored(ids.sentOnce)).toEqual({ sent_version: 1, accepted_name: "Moira Kerr" });
    expect((await stored(ids.adminSavedWhileSent)).sent_version).toBe(2);
    const settled: readonly string[] = [
      ids.changesAskedThenSaved, ids.draft, ids.sentOnce,
      ids.acceptedAgainByAnother, ids.acceptedAgainByTeam, ids.linkMadeWhileSent, ids.draftAtFillThenAccepted,
    ];
    const after = (await pool.query<Stored & { id: string }>("SELECT id, sent_version, accepted_name FROM proposals ORDER BY id")).rows;
    const unchanged = (rows: readonly (Stored & { id: string })[]) => rows.filter((row) => !settled.includes(row.id));
    expect(unchanged(after)).toEqual(unchanged(before));

    // Run again, it changes nothing.
    await applyMigration(pool, "0083_proposal_sent_version_refill.sql");
    expect((await pool.query<Stored & { id: string }>("SELECT id, sent_version, accepted_name FROM proposals ORDER BY id")).rows).toEqual(after);
  });
});
