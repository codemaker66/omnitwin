import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";
import { proposalRoutes } from "../routes/proposals.js";

// ---------------------------------------------------------------------------
// A proposal's conversation as the venue team reads it, on a long thread
// (audit contract-n-4).
//
// The Proposals desk reads GET /proposals/:id/comments whole and shows it as
// the thread, oldest first. The route reads at most 200 comments, and it read
// the OLDEST 200: on a longer thread the client's newest question never
// reached the desk, while the client's own page (the newest 100) showed it.
// Only real rows show which 200 the database returns.
//
// Opt-in, disposable PostgreSQL only. Never consults DATABASE_URL or .env.
// ---------------------------------------------------------------------------

const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("Proposal conversation tests require the explicit disposable platform database");
  }
}

/** The most of one thread the staff read returns. */
const CAP = 200;
const FIRST_MESSAGE_AT = Date.parse("2026-11-01T09:00:00Z");

interface StaffComment {
  readonly body: string;
  readonly authorType: "client" | "staff";
  readonly createdAt: string;
}

describe.skipIf(target === undefined)("a proposal's conversation for the venue team on the migrated disposable database", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let server: FastifyInstance;
  const venueId = randomUUID();
  const staff = { id: randomUUID(), email: "conversation@proposal.invalid", role: "staff", platformRole: "none", venueId };

  async function proposal(title: string): Promise<string> {
    const [row] = await db.insert(schema.proposals).values({ venueId, title, status: "draft", currentVersion: 0 })
      .returning({ id: schema.proposals.id });
    if (row === undefined) throw new Error("Proposal fixture not written");
    return row.id;
  }

  /** Message N (from 1) written N - 1 minutes after the first; odd numbers are the client's. */
  async function write(proposalId: string, numbers: readonly number[]): Promise<void> {
    await db.insert(schema.proposalComments).values(numbers.map((number) => {
      const fromClient = number % 2 === 1;
      return {
        proposalId,
        shareTokenId: null,
        kind: "comment",
        authorName: fromClient ? "TEST ONLY client" : "Venue team",
        authorEmail: null,
        body: `Message ${String(number)}`,
        isClientVisible: true,
        authorType: fromClient ? "client" as const : "staff" as const,
        createdAt: new Date(FIRST_MESSAGE_AT + (number - 1) * 60_000),
      };
    }));
  }

  async function thread(proposalId: string): Promise<readonly StaffComment[]> {
    const response = await server.inject({
      method: "GET", url: `/proposals/${proposalId}/comments`,
      headers: { authorization: `Bearer ${JSON.stringify(staff)}` },
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<{ data: StaffComment[] }>().data;
  }

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: `proposal_conversation_${randomUUID()}`, max: 4 });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name).toBe("venviewer_platform_test");
    db = drizzle(pool, { schema });
    await db.insert(schema.venues).values({ id: venueId, name: "TEST ONLY conversation venue", slug: venueId, address: "Disposable fixture" });
    server = Fastify();
    await server.register(proposalRoutes, { db, prefix: "/proposals" });
    await server.ready();
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    await pool?.end();
  });

  it("keeps the newest messages of a thread longer than the cap, oldest first, so the client's latest question reaches the desk", async () => {
    const id = await proposal("TEST ONLY long thread");
    const total = CAP + 5;
    await write(id, Array.from({ length: total }, (_, index) => index + 1));

    const read = await thread(id);
    expect(read).toHaveLength(CAP);
    // The five oldest are the ones left out; the newest, the client's, is last.
    expect(read.map((comment) => comment.body)).toEqual(
      Array.from({ length: CAP }, (_, index) => `Message ${String(total - CAP + index + 1)}`),
    );
    expect(read.at(-1)).toMatchObject({ body: `Message ${String(total)}`, authorType: "client" });
  });

  it("returns a short thread whole, oldest first, whatever order it was written in", async () => {
    const id = await proposal("TEST ONLY short thread");
    await write(id, [3, 1, 2]);

    const read = await thread(id);
    expect(read.map((comment) => [comment.body, comment.authorType])).toEqual([
      ["Message 1", "client"], ["Message 2", "staff"], ["Message 3", "client"],
    ]);
  });
});
