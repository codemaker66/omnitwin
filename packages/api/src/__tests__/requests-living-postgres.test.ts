import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LAYOUT_STYLES } from "@omnitwin/types";
import * as schema from "../db/schema.js";
import {
  clientConversationSnapshot,
  listMessagesCore,
  openThreadCore,
  type ConversationDeny,
} from "../services/conversations.js";
import {
  createClientRequestCore,
  createRequestCore,
  listRequestsForClientEvent,
  transitionRequestCore,
  type RequestActor,
  type RequestDeny,
} from "../services/requests.js";

// Goal 19 S1 — the widened request on real rows: the client asks on their own
// slot and gets a client-facing thread; the floor's ask gets a staff-private
// one; two accepts leave exactly one owner and name them to the loser; the
// longer ladder (underway, handover, reopen) is held in the UPDATE's own WHERE;
// every step lands in the thread the client polls; a hallkeeper reaches the
// client's words only through the request.
process.env["NODE_ENV"] = "test";
const target = process.env["VENVIEWER_REQUESTS_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:"
    || parsed.hostname !== "127.0.0.1"
    || parsed.pathname !== "/venviewer_lane9_test"
    || parsed.search !== ""
    || parsed.hash !== "") {
    throw new Error("Request tests require the explicit disposable database venviewer_lane9_test on 127.0.0.1");
  }
}

type Deny = RequestDeny | ConversationDeny;

function isDeny(result: unknown): result is Deny {
  return typeof result === "object" && result !== null && "ok" in result && (result as { readonly ok: unknown }).ok === false;
}

function granted<T>(result: T | Deny): Exclude<T, Deny> {
  if (isDeny(result)) throw new Error(`expected success, got ${result.code}: ${result.error}`);
  return result as Exclude<T, Deny>;
}

function refused(result: unknown): Deny {
  if (!isDeny(result)) throw new Error("expected a refusal");
  return result;
}

/** The name a refused "I'll take this" carries; only a request refusal has one. */
function ownerNameOf(result: Deny | undefined): string | undefined {
  return result !== undefined && "ownerName" in result ? result.ownerName : undefined;
}

describe.skipIf(target === undefined)("the widened request on migrated PostgreSQL", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({
      connectionString: target,
      application_name: `s1_requests_${randomUUID()}`,
      max: 8,
      options: "-c statement_timeout=10000 -c lock_timeout=8000",
    });
    const name = (await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name;
    expect(name).toBe("venviewer_lane9_test");
    await migrate(drizzle(pool), { migrationsFolder: resolve(import.meta.dirname, "../../drizzle") });
    db = drizzle(pool, { schema });
  }, 120_000);

  afterAll(async () => { await pool.end(); });

  interface Fixture {
    readonly venueId: string;
    readonly roomId: string;
    readonly eventId: string;
    readonly bookingId: string;
    readonly linkId: string;
    readonly admin: RequestActor;
    readonly staff: RequestActor;
    readonly hallkeeper: RequestActor;
    readonly secondHallkeeper: RequestActor;
    readonly client: RequestActor;
    readonly stranger: RequestActor;
  }

  async function fixture(): Promise<Fixture> {
    const venueId = randomUUID();
    const roomId = randomUUID();
    const eventId = randomUUID();
    const bookingId = randomUUID();
    const configurationId = randomUUID();
    const linkId = randomUUID();
    const outline = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

    await db.insert(schema.venues).values({ id: venueId, name: "TEST ONLY s1 requests", slug: venueId, address: "Disposable fixture" });
    await db.insert(schema.spaces).values({
      id: roomId, venueId, name: "Grand Hall", slug: "grand-hall", widthM: "21", lengthM: "10", heightM: "7", floorPlanOutline: outline,
    });
    const people = {
      admin: { id: randomUUID(), role: "admin", venueId, name: "The administrator" },
      staff: { id: randomUUID(), role: "staff", venueId, name: "Fiona" },
      hallkeeper: { id: randomUUID(), role: "hallkeeper", venueId, name: "Elaine" },
      secondHallkeeper: { id: randomUUID(), role: "hallkeeper", venueId, name: "Graham" },
      client: { id: randomUUID(), role: "client", venueId: null, name: "Morag" },
      stranger: { id: randomUUID(), role: "client", venueId: null, name: "Somebody Else" },
    } as const;
    for (const person of Object.values(people)) {
      await db.insert(schema.users).values({
        id: person.id, venueId: person.venueId, name: person.name, email: `${person.id}@s1.invalid`, role: person.role,
      });
    }
    await db.insert(schema.events).values({ id: eventId, venueId, name: "Fixture event", createdBy: people.admin.id });
    await db.insert(schema.bookings).values({
      id: bookingId, venueId, spaceId: roomId, eventId, kind: "ink", title: "Fixture booking", createdBy: people.admin.id,
      startsAt: new Date("2030-01-10T10:00:00.000Z"), endsAt: new Date("2030-01-10T12:00:00.000Z"),
    });
    await db.insert(schema.configurations).values({
      id: configurationId, spaceId: roomId, venueId, userId: people.client.id, name: "The client's plan", layoutStyle: LAYOUT_STYLES[0],
    });
    await db.insert(schema.eventConfigurationLinks).values({ id: linkId, eventId, configurationId, linkType: "source_configuration" });

    const actor = (person: { readonly id: string; readonly role: string; readonly venueId: string | null; readonly name: string }): RequestActor => ({
      id: person.id, name: person.name, role: person.role, venueId: person.venueId, platformRole: "none",
    });
    return {
      venueId, roomId, eventId, bookingId, linkId,
      admin: actor(people.admin), staff: actor(people.staff), hallkeeper: actor(people.hallkeeper),
      secondHallkeeper: actor(people.secondHallkeeper), client: actor(people.client), stranger: actor(people.stranger),
    };
  }

  const chairs = (f: Fixture, over: Partial<Parameters<typeof createClientRequestCore>[3]> = {}) => ({
    bookingId: f.bookingId, kind: "chairs" as const, quantity: 10, urgency: "soon" as const,
    detail: "Ten more for the top table, please.", idempotencyKey: randomUUID(), ...over,
  });

  it("lets the client ask for ten more chairs on their own slot, with a client-facing thread", async () => {
    const f = await fixture();
    const press = chairs(f);
    const made = granted(await createClientRequestCore(db, f.client, f.eventId, press));
    expect(made.replay).toBe(false);
    expect(made.request.kind).toBe("chairs");
    expect(made.request.quantity).toBe(10);
    expect(made.request.requestedByRole).toBe("client");
    expect(made.request.roomId).toBe(f.roomId);
    expect(made.request.roomName).toBe("Grand Hall");
    expect(made.request.venueId).toBe(f.venueId);
    expect(made.request.threadId).not.toBeNull();

    const [thread] = await db.select().from(schema.threads).where(eq(schema.threads.id, made.request.threadId ?? ""));
    expect(thread?.audience).toBe("client-facing");
    expect(thread?.subject).toBe("request");
    expect(thread?.requestId).toBe(made.request.id);
    expect(thread?.eventId).toBe(f.eventId);
    expect(thread?.messageCount).toBe(1);
    const first = granted(await listMessagesCore(db, f.client, thread?.id ?? "", { after: 0, limit: 10 })).messages[0];
    expect(first?.kind).toBe("request");
    expect(first?.authorName).toBe("Morag");
    expect(first?.body).toContain("Chairs × 10");

    // The same press again is the same request.
    const again = granted(await createClientRequestCore(db, f.client, f.eventId, press));
    expect(again.replay).toBe(true);
    expect(again.request.id).toBe(made.request.id);
  });

  it("refuses a client without a live link, and again the moment it is revoked", async () => {
    const f = await fixture();
    expect(refused(await createClientRequestCore(db, f.stranger, f.eventId, chairs(f))).status).toBe(403);
    granted(await createClientRequestCore(db, f.client, f.eventId, chairs(f)));
    await db.delete(schema.eventConfigurationLinks).where(eq(schema.eventConfigurationLinks.id, f.linkId));
    expect(refused(await createClientRequestCore(db, f.client, f.eventId, chairs(f))).status).toBe(403);
    expect(refused(await listRequestsForClientEvent(db, f.client, f.eventId)).status).toBe(403);
  });

  it("refuses a slot that is not part of the client's event, and a hallkeeper at the client's door", async () => {
    const f = await fixture();
    const otherEventId = randomUUID();
    const otherBookingId = randomUUID();
    await db.insert(schema.events).values({ id: otherEventId, venueId: f.venueId, name: "Another event", createdBy: f.admin.id });
    await db.insert(schema.bookings).values({
      id: otherBookingId, venueId: f.venueId, spaceId: f.roomId, eventId: otherEventId, kind: "ink", title: "Another booking",
      startsAt: new Date("2030-01-11T10:00:00.000Z"), endsAt: new Date("2030-01-11T12:00:00.000Z"),
    });
    const wrongSlot = refused(await createClientRequestCore(db, f.client, f.eventId, chairs(f, { bookingId: otherBookingId })));
    expect(wrongSlot.status).toBe(400);
    expect(wrongSlot.code).toBe("BOOKING_NOT_ON_EVENT");
    expect(refused(await createClientRequestCore(db, f.hallkeeper, f.eventId, chairs(f))).status).toBe(403);
  });

  it("gives the floor's own ask a staff-private thread and accepts the widened kinds", async () => {
    const f = await fixture();
    for (const kind of ["tables", "setup", "chairs"] as const) {
      const made = granted(await createRequestCore(db, f.hallkeeper, f.venueId, {
        roomId: f.roomId, bookingId: f.bookingId, eventId: f.eventId, kind, quantity: kind === "setup" ? null : 4,
        urgency: "routine", detail: null, idempotencyKey: randomUUID(),
      }));
      expect(made.request.kind).toBe(kind);
      const [thread] = await db.select().from(schema.threads).where(eq(schema.threads.id, made.request.threadId ?? ""));
      expect(thread?.audience).toBe("staff-private");
      expect(thread?.messageCount).toBe(1);
    }
  });

  it("lets exactly one of two colleagues take a request, and names the owner to the loser", async () => {
    const f = await fixture();
    const made = granted(await createClientRequestCore(db, f.client, f.eventId, chairs(f)));
    const [a, b] = await Promise.all([
      transitionRequestCore(db, f.hallkeeper, made.request.id, { to: "accepted" }),
      transitionRequestCore(db, f.secondHallkeeper, made.request.id, { to: "accepted" }),
    ]);
    const wins = [a, b].filter((result) => !isDeny(result));
    const losses = [a, b].filter((result) => isDeny(result)).map(refused);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    const winner = granted(wins[0] ?? a);
    expect(losses[0]?.status).toBe(409);
    expect(losses[0]?.code).toBe("REQUEST_TAKEN");
    expect(ownerNameOf(losses[0])).toBe(winner.request.ownerName);
    expect(losses[0]?.error).toBe(`${winner.request.ownerName ?? ""} has this.`);

    // A minute later, the same answer: the name, not a shrug.
    const late = refused(await transitionRequestCore(db, f.staff, made.request.id, { to: "accepted" }));
    expect(late.code).toBe("REQUEST_TAKEN");
    expect(ownerNameOf(late)).toBe(winner.request.ownerName);

    // The client, polling, reads who has it.
    const snapshot = granted(await clientConversationSnapshot(db, f.client, f.eventId, 0));
    expect(snapshot.messages.map((message) => message.body)).toContain(`${winner.request.ownerName ?? ""} has this.`);
  });

  it("walks the longer ladder, and the thread records each step for the client", async () => {
    const f = await fixture();
    const made = granted(await createClientRequestCore(db, f.client, f.eventId, chairs(f)));
    const id = made.request.id;

    granted(await transitionRequestCore(db, f.staff, id, { to: "accepted" }));
    // Only the owner starts the work.
    expect(refused(await transitionRequestCore(db, f.hallkeeper, id, { to: "underway" })).code).toBe("NOT_OWNER");
    const underway = granted(await transitionRequestCore(db, f.staff, id, { to: "underway" }));
    expect(underway.request.underwayAt).not.toBeNull();

    // Handing over names a person on the floor; nobody else may take it.
    expect(refused(await transitionRequestCore(db, f.staff, id, { to: "handed-over", toUserId: f.client.id })).code).toBe("HANDOVER_TARGET");
    const handed = granted(await transitionRequestCore(db, f.staff, id, { to: "handed-over", toUserId: f.hallkeeper.id }));
    expect(handed.request.state).toBe("handed-over");
    expect(handed.request.handoverToName).toBe("Elaine");
    expect(handed.request.ownerName).toBe("Fiona");
    expect(refused(await transitionRequestCore(db, f.secondHallkeeper, id, { to: "accepted" })).code).toBe("HANDOVER_NAMED_SOMEONE_ELSE");
    const taken = granted(await transitionRequestCore(db, f.hallkeeper, id, { to: "accepted" }));
    expect(taken.request.ownerName).toBe("Elaine");
    expect(taken.request.handoverToUserId).toBeNull();

    const snapshot = granted(await clientConversationSnapshot(db, f.client, f.eventId, 0));
    const bodies = snapshot.messages.map((message) => message.body);
    expect(bodies).toEqual(expect.arrayContaining([
      "Fiona has this.", "Fiona is on it.", "Fiona handed this to Elaine.", "Elaine has this.",
    ]));
    expect(snapshot.messages.filter((message) => message.kind === "system").every((message) => message.authorUserId === null)).toBe(true);

    const history = await db.select().from(schema.requestStatusHistory).where(eq(schema.requestStatusHistory.requestId, id));
    expect(history.map((row) => row.toState)).toEqual(["sent", "accepted", "underway", "handed-over", "accepted"]);
  });

  it("resolves with an outcome and lets the client reopen, which clears the owner", async () => {
    const f = await fixture();
    const made = granted(await createClientRequestCore(db, f.client, f.eventId, chairs(f)));
    const id = made.request.id;
    granted(await transitionRequestCore(db, f.hallkeeper, id, { to: "accepted" }));
    const done = granted(await transitionRequestCore(db, f.hallkeeper, id, { to: "resolved", outcome: "substituted", note: "Benches instead." }));
    expect(done.request.outcome).toBe("substituted");
    expect(done.request.outcomeNote).toBe("Benches instead.");

    // The client may reopen their own; nobody may reopen what is not finished;
    // a stranger may not reopen anything; the client may not take it.
    expect(refused(await transitionRequestCore(db, f.stranger, id, { to: "reopened" })).status).toBe(403);
    expect(refused(await transitionRequestCore(db, f.client, id, { to: "accepted" })).status).toBe(403);
    const reopened = granted(await transitionRequestCore(db, f.client, id, { to: "reopened", note: "Benches are too low." }));
    expect(reopened.request.state).toBe("reopened");
    expect(reopened.request.ownerUserId).toBeNull();
    expect(reopened.request.outcome).toBeNull();
    expect(reopened.request.reopenedAt).not.toBeNull();
    expect(refused(await transitionRequestCore(db, f.staff, id, { to: "reopened" })).code).toBe("REQUEST_STATE_CONFLICT");

    const again = granted(await transitionRequestCore(db, f.staff, id, { to: "accepted" }));
    expect(again.request.ownerName).toBe("Fiona");
    const snapshot = granted(await clientConversationSnapshot(db, f.client, f.eventId, 0));
    expect(snapshot.messages.map((message) => message.body)).toEqual(expect.arrayContaining([
      "Done another way: Benches instead.", "Reopened by Morag: Benches are too low.", "Fiona has this.",
    ]));
  });

  it("lets a hallkeeper read the client's request thread but not the client's booking thread", async () => {
    const f = await fixture();
    const made = granted(await createClientRequestCore(db, f.client, f.eventId, chairs(f)));
    const requestThread = made.request.threadId ?? "";
    expect(granted(await listMessagesCore(db, f.hallkeeper, requestThread, { after: 0, limit: 10 })).messages).toHaveLength(1);
    const bookingThread = granted(await openThreadCore(db, f.staff, f.venueId, { audience: "client-facing", subject: "booking", bookingId: f.bookingId })).thread;
    expect(refused(await listMessagesCore(db, f.hallkeeper, bookingThread.id, { after: 0, limit: 10 })).status).toBe(403);
  });

  it("lists only the client's own asks on their event, and everything for the office", async () => {
    const f = await fixture();
    granted(await createClientRequestCore(db, f.client, f.eventId, chairs(f)));
    granted(await createRequestCore(db, f.hallkeeper, f.venueId, {
      roomId: f.roomId, bookingId: f.bookingId, eventId: f.eventId, kind: "cleaning", quantity: null,
      urgency: "routine", detail: "Spill by the door.", idempotencyKey: randomUUID(),
    }));
    const mine = granted(await listRequestsForClientEvent(db, f.client, f.eventId));
    expect(mine).toHaveLength(1);
    expect(mine[0]?.kind).toBe("chairs");
    const office = granted(await listRequestsForClientEvent(db, f.admin, f.eventId));
    expect(office).toHaveLength(2);
    expect(refused(await listRequestsForClientEvent(db, f.hallkeeper, f.eventId)).status).toBe(403);
  });
});
