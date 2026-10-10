import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ConversationCommand } from "@omnitwin/types";
import * as schema from "../db/schema.js";
import { executeConversationCommand } from "../services/conversation-commands.js";
import { openThreadCore, sendMessageCore } from "../services/conversations.js";
import type { RequestActor } from "../services/requests.js";

// Goal 19 S2 — the conversation command path through the diary_commands
// ledger: one logical message under a resent commandId, a replay that proves
// the actor's venue and the thread's audience again, a request step on the
// same ledger, a rejected outcome recorded and replayed as rejected, and a
// socket attempt whose REST retry is the same message.
process.env["NODE_ENV"] = "test";
const target = process.env["VENVIEWER_REQUESTS_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:"
    || parsed.hostname !== "127.0.0.1"
    || parsed.pathname !== "/venviewer_lane9_test"
    || parsed.search !== ""
    || parsed.hash !== "") {
    throw new Error("Conversation command tests require the explicit disposable database venviewer_lane9_test on 127.0.0.1");
  }
}

describe.skipIf(target === undefined)("conversation commands on migrated PostgreSQL", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({
      connectionString: target,
      application_name: `s2_commands_${randomUUID()}`,
      max: 8,
      options: "-c statement_timeout=10000 -c lock_timeout=8000",
    });
    const name = (await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name;
    expect(name).toBe("venviewer_lane9_test");
    await migrate(drizzle(pool), { migrationsFolder: resolve(import.meta.dirname, "../../drizzle") });
    db = drizzle(pool, { schema });
  }, 300_000);

  afterAll(async () => { await pool.end(); });

  interface Fixture {
    readonly venueId: string;
    readonly otherVenueId: string;
    readonly roomId: string;
    readonly bookingId: string;
    readonly threadId: string;
    readonly staff: RequestActor;
    readonly hallkeeper: RequestActor;
    readonly secondHallkeeper: RequestActor;
    readonly outsider: RequestActor;
  }

  async function fixture(): Promise<Fixture> {
    const venueId = randomUUID();
    const otherVenueId = randomUUID();
    const roomId = randomUUID();
    const bookingId = randomUUID();
    const outline = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    for (const id of [venueId, otherVenueId]) {
      await db.insert(schema.venues).values({ id, name: "TEST ONLY s2 commands", slug: id, address: "Disposable fixture" });
    }
    await db.insert(schema.spaces).values({
      id: roomId, venueId, name: "Grand Hall", slug: "grand-hall", widthM: "21", lengthM: "10", heightM: "7", floorPlanOutline: outline,
    });
    const people = {
      staff: { id: randomUUID(), role: "staff", venueId, name: "Fiona" },
      hallkeeper: { id: randomUUID(), role: "hallkeeper", venueId, name: "Elaine" },
      secondHallkeeper: { id: randomUUID(), role: "hallkeeper", venueId, name: "Graham" },
      outsider: { id: randomUUID(), role: "admin", venueId: otherVenueId, name: "Someone from elsewhere" },
    } as const;
    for (const person of Object.values(people)) {
      await db.insert(schema.users).values({
        id: person.id, venueId: person.venueId, name: person.name, email: `${person.id}@s2.invalid`, role: person.role,
      });
    }
    await db.insert(schema.bookings).values({
      id: bookingId, venueId, spaceId: roomId, kind: "ink", title: "Fixture booking", createdBy: people.staff.id,
      startsAt: new Date("2030-01-10T10:00:00.000Z"), endsAt: new Date("2030-01-10T12:00:00.000Z"),
    });
    const actor = (person: { readonly id: string; readonly role: string; readonly venueId: string | null; readonly name: string }): RequestActor => ({
      id: person.id, name: person.name, role: person.role, venueId: person.venueId, platformRole: "none",
    });
    const staff = actor(people.staff);
    const opened = await openThreadCore(db, staff, venueId, { audience: "staff-private", subject: "booking", bookingId });
    if (!("thread" in opened)) throw new Error("expected a thread");
    return {
      venueId, otherVenueId, roomId, bookingId, threadId: opened.thread.id,
      staff, hallkeeper: actor(people.hallkeeper), secondHallkeeper: actor(people.secondHallkeeper), outsider: actor(people.outsider),
    };
  }

  const send = (threadId: string, body: string, commandId = randomUUID(), idempotencyKey = randomUUID()): ConversationCommand => ({
    kind: "message.send", commandId, threadId, payload: { body, idempotencyKey },
  });

  it("sends a message once under a resent commandId; the second ack is a replay of the first", async () => {
    const f = await fixture();
    const command = send(f.threadId, "Doors at six");
    const clock = () => 1_700_000_000_000;
    const first = await executeConversationCommand(db, f.staff, f.venueId, command, clock);
    expect(first.ack.outcome).toBe("applied");
    expect(first.ack.replay).toBe(false);
    expect(first.ack.status).toBe(201);
    expect(first.ack.serverNowMs).toBe(1_700_000_000_000);
    expect(first.changed?.kind).toBe("message.sent");

    const again = await executeConversationCommand(db, f.staff, f.venueId, command);
    expect(again.ack.outcome).toBe("applied");
    expect(again.ack.replay).toBe(true);
    expect(again.ack.message?.id).toBe(first.ack.message?.id);
    expect(again.changed).toBeNull();

    const rows = await db.select().from(schema.messages).where(eq(schema.messages.threadId, f.threadId));
    expect(rows).toHaveLength(1);
    const ledger = await db.select().from(schema.diaryCommands).where(eq(schema.diaryCommands.commandId, command.commandId));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.kind).toBe("message.send");
    expect(ledger[0]?.venueId).toBe(f.venueId);
  });

  it("refuses to replay a command to somebody the recorded venue and audience do not admit", async () => {
    const f = await fixture();
    const command = send(f.threadId, "Doors at six");
    await executeConversationCommand(db, f.staff, f.venueId, command);
    const stranger = await executeConversationCommand(db, f.outsider, f.otherVenueId, command);
    expect(stranger.ack.outcome).toBe("rejected");
    expect(stranger.ack.replay).toBe(true);
    expect(stranger.ack.status).toBe(403);
    expect(stranger.ack.message).toBeUndefined();
  });

  it("is the same message whether the socket or the REST retry got there first", async () => {
    const f = await fixture();
    const key = randomUUID();
    const command = send(f.threadId, "Chairs are out", randomUUID(), key);
    // The socket attempt committed, the ack was lost, the client retried over REST with the same key…
    const overSocket = await executeConversationCommand(db, f.staff, f.venueId, command);
    const overRest = await sendMessageCore(db, f.staff, f.threadId, { body: "Chairs are out", idempotencyKey: key });
    if (!("message" in overRest)) throw new Error("expected a message");
    expect(overRest.replay).toBe(true);
    expect(overRest.message.id).toBe(overSocket.ack.message?.id);
    // …and the other way round.
    const key2 = randomUUID();
    const first = await sendMessageCore(db, f.staff, f.threadId, { body: "Tables too", idempotencyKey: key2 });
    if (!("message" in first)) throw new Error("expected a message");
    const second = await executeConversationCommand(db, f.staff, f.venueId, send(f.threadId, "Tables too", randomUUID(), key2));
    expect(second.ack.replay).toBe(true);
    expect(second.ack.message?.id).toBe(first.message.id);
    const rows = await db.select().from(schema.messages).where(eq(schema.messages.threadId, f.threadId));
    expect(rows).toHaveLength(2);
  });

  it("carries a request and its steps on the same ledger, and replays a step by its id", async () => {
    const f = await fixture();
    const made = await executeConversationCommand(db, f.hallkeeper, f.venueId, {
      kind: "request.create", commandId: randomUUID(),
      payload: { roomId: f.roomId, bookingId: f.bookingId, kind: "chairs", quantity: 6, urgency: "soon", idempotencyKey: randomUUID() },
    });
    expect(made.ack.outcome).toBe("applied");
    expect(made.changed?.kind).toBe("request.created");
    const requestId = made.ack.request?.id ?? "";

    const accept: ConversationCommand = { kind: "request.accept", commandId: randomUUID(), requestId, payload: {} };
    const taken = await executeConversationCommand(db, f.hallkeeper, f.venueId, accept);
    expect(taken.ack.outcome).toBe("applied");
    expect(taken.ack.request?.state).toBe("accepted");
    expect(taken.ack.request?.ownerName).toBe("Elaine");
    expect(taken.changed?.kind).toBe("request.updated");

    const replayed = await executeConversationCommand(db, f.hallkeeper, f.venueId, accept);
    expect(replayed.ack.replay).toBe(true);
    expect(replayed.ack.outcome).toBe("applied");
    expect(replayed.ack.request?.state).toBe("accepted");
    expect(replayed.changed).toBeNull();
  });

  it("records a refused step and replays it as refused, with the owner's name", async () => {
    const f = await fixture();
    const made = await executeConversationCommand(db, f.hallkeeper, f.venueId, {
      kind: "request.create", commandId: randomUUID(),
      payload: { roomId: f.roomId, bookingId: f.bookingId, kind: "av", quantity: null, urgency: "now", idempotencyKey: randomUUID() },
    });
    const requestId = made.ack.request?.id ?? "";
    await executeConversationCommand(db, f.hallkeeper, f.venueId, { kind: "request.accept", commandId: randomUUID(), requestId, payload: {} });

    const late: ConversationCommand = { kind: "request.accept", commandId: randomUUID(), requestId, payload: {} };
    const refused = await executeConversationCommand(db, f.secondHallkeeper, f.venueId, late);
    expect(refused.ack.outcome).toBe("rejected");
    expect(refused.ack.status).toBe(409);
    expect(refused.ack.code).toBe("REQUEST_TAKEN");
    expect(refused.ack.ownerName).toBe("Elaine");
    expect(refused.changed).toBeNull();

    const again = await executeConversationCommand(db, f.secondHallkeeper, f.venueId, late);
    expect(again.ack.outcome).toBe("rejected");
    expect(again.ack.replay).toBe(true);
    expect(again.ack.code).toBe("REQUEST_TAKEN");
    expect(again.ack.request?.ownerName).toBe("Elaine");
  });

  it("refuses a send into a thread the actor's audience does not admit, and records the refusal", async () => {
    const f = await fixture();
    const command = send(f.threadId, "Hello from elsewhere");
    const refused = await executeConversationCommand(db, f.outsider, f.otherVenueId, command);
    expect(refused.ack.outcome).toBe("rejected");
    expect(refused.ack.status).toBe(403);
    const ledger = await db.select().from(schema.diaryCommands).where(eq(schema.diaryCommands.commandId, command.commandId));
    expect(ledger[0]?.outcome).toBe("rejected");
  });
});
