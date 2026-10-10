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
  clientHoldsEventLink,
  listMessagesCore,
  listThreadsCore,
  markReceiptCore,
  openThreadCore,
  sendClientMessageCore,
  sendMessageCore,
  type ConversationActor,
  type ConversationDeny,
} from "../services/conversations.js";

// Goal 19 S1 — the gates only real rows can prove: a thread opened once per
// slot per audience, the audience held on every read and write, the client
// admitted by the link and shut out the instant it is revoked, one message
// under a replayed key, cursors that only go forward, and receipts that are
// facts rather than ticks.
//
// Never loads .env and never falls back to DATABASE_URL. The target must be an
// explicitly named disposable cluster on this machine, the same one the
// request tests use.
process.env["NODE_ENV"] = "test";
const target = process.env["VENVIEWER_REQUESTS_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:"
    || parsed.hostname !== "127.0.0.1"
    || parsed.pathname !== "/venviewer_lane9_test"
    || parsed.search !== ""
    || parsed.hash !== "") {
    throw new Error("Conversation tests require the explicit disposable database venviewer_lane9_test on 127.0.0.1");
  }
}

function isDeny(result: unknown): result is ConversationDeny {
  return typeof result === "object" && result !== null && "ok" in result && (result as { readonly ok: unknown }).ok === false;
}

function granted<T>(result: T | ConversationDeny): Exclude<T, ConversationDeny> {
  if (isDeny(result)) throw new Error(`expected success, got ${result.code}: ${result.error}`);
  return result as Exclude<T, ConversationDeny>;
}

function refused(result: unknown): ConversationDeny {
  if (!isDeny(result)) throw new Error("expected a refusal");
  return result;
}

describe.skipIf(target === undefined)("conversations on migrated PostgreSQL", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({
      connectionString: target,
      application_name: `s1_conversations_${randomUUID()}`,
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
    readonly otherVenueId: string;
    readonly roomId: string;
    readonly eventId: string;
    readonly bookingId: string;
    readonly linkId: string;
    readonly admin: ConversationActor;
    readonly staff: ConversationActor;
    readonly hallkeeper: ConversationActor;
    readonly client: ConversationActor;
    readonly stranger: ConversationActor;
    readonly outsider: ConversationActor;
  }

  async function fixture(): Promise<Fixture> {
    const venueId = randomUUID();
    const otherVenueId = randomUUID();
    const roomId = randomUUID();
    const eventId = randomUUID();
    const bookingId = randomUUID();
    const configurationId = randomUUID();
    const linkId = randomUUID();
    const outline = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

    for (const id of [venueId, otherVenueId]) {
      await db.insert(schema.venues).values({ id, name: "TEST ONLY s1 conversations", slug: id, address: "Disposable fixture" });
    }
    await db.insert(schema.spaces).values({
      id: roomId, venueId, name: "Grand Hall", slug: "grand-hall", widthM: "21", lengthM: "10", heightM: "7", floorPlanOutline: outline,
    });

    const people = {
      admin: { id: randomUUID(), role: "admin", venueId, name: "The administrator" },
      staff: { id: randomUUID(), role: "staff", venueId, name: "Fiona" },
      hallkeeper: { id: randomUUID(), role: "hallkeeper", venueId, name: "Elaine" },
      client: { id: randomUUID(), role: "client", venueId: null, name: "Morag" },
      stranger: { id: randomUUID(), role: "client", venueId: null, name: "Somebody Else" },
      outsider: { id: randomUUID(), role: "admin", venueId: otherVenueId, name: "Someone from elsewhere" },
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
    // The client's link: a configuration they own, linked to the event.
    await db.insert(schema.configurations).values({
      id: configurationId, spaceId: roomId, venueId, userId: people.client.id, name: "The client's plan", layoutStyle: LAYOUT_STYLES[0],
    });
    await db.insert(schema.eventConfigurationLinks).values({
      id: linkId, eventId, configurationId, linkType: "source_configuration",
    });

    const actor = (person: { readonly id: string; readonly role: string; readonly venueId: string | null; readonly name: string }): ConversationActor => ({
      id: person.id, name: person.name, role: person.role, venueId: person.venueId, platformRole: "none",
    });
    return {
      venueId, otherVenueId, roomId, eventId, bookingId, linkId,
      admin: actor(people.admin), staff: actor(people.staff), hallkeeper: actor(people.hallkeeper),
      client: actor(people.client), stranger: actor(people.stranger), outsider: actor(people.outsider),
    };
  }

  const send = (body: string, idempotencyKey = randomUUID()) => ({ body, idempotencyKey });

  it("opens the slot's conversation once, however many times it is asked for", async () => {
    const f = await fixture();
    const first = granted(await openThreadCore(db, f.admin, f.venueId, { audience: "staff-private", subject: "booking", bookingId: f.bookingId }));
    const second = granted(await openThreadCore(db, f.hallkeeper, f.venueId, { audience: "staff-private", subject: "booking", bookingId: f.bookingId }));
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.thread.id).toBe(first.thread.id);
    // The booking's event rides along, so the client's event page finds it.
    expect(first.thread.eventId).toBe(f.eventId);
    expect(first.thread.messageCount).toBe(0);
  });

  it("keeps a hallkeeper from opening a client-facing thread by hand, and lets the office", async () => {
    const f = await fixture();
    expect(refused(await openThreadCore(db, f.hallkeeper, f.venueId, { audience: "client-facing", subject: "booking", bookingId: f.bookingId })).status).toBe(403);
    const opened = granted(await openThreadCore(db, f.staff, f.venueId, { audience: "client-facing", subject: "booking", bookingId: f.bookingId }));
    expect(opened.thread.audience).toBe("client-facing");
  });

  it("makes a second thread for the other audience rather than widening the first", async () => {
    const f = await fixture();
    const priv = granted(await openThreadCore(db, f.staff, f.venueId, { audience: "staff-private", subject: "booking", bookingId: f.bookingId }));
    const pub = granted(await openThreadCore(db, f.staff, f.venueId, { audience: "client-facing", subject: "booking", bookingId: f.bookingId }));
    expect(pub.thread.id).not.toBe(priv.thread.id);
    expect(priv.thread.audience).toBe("staff-private");
    expect(pub.thread.audience).toBe("client-facing");

    // Listing filters by the stored audience: the hallkeeper sees the floor's
    // thread and not the client's booking thread; the office sees both.
    const seenByHallkeeper = granted(await listThreadsCore(db, f.hallkeeper, f.venueId, { bookingId: f.bookingId }));
    expect(seenByHallkeeper.map((thread) => thread.id)).toEqual([priv.thread.id]);
    const seenByAdmin = granted(await listThreadsCore(db, f.admin, f.venueId, { bookingId: f.bookingId }));
    expect(seenByAdmin.map((thread) => thread.id).sort()).toEqual([priv.thread.id, pub.thread.id].sort());
    expect(refused(await listThreadsCore(db, f.outsider, f.venueId, { bookingId: f.bookingId })).status).toBe(403);
  });

  // Goal 19 D2 row 6, confirmed for S4: the floor's thread is the floor's.
  // canManageVenue admits a hallkeeper to the venue's thread routes, so the
  // gate is not changed here; this holds the row as behaviour, not prose.
  it("lets a hallkeeper open, read and write the floor's thread, and never the client's booking thread (D2 row 6)", async () => {
    const f = await fixture();
    const opened = granted(await openThreadCore(db, f.hallkeeper, f.venueId, { audience: "staff-private", subject: "booking", bookingId: f.bookingId }));
    expect(opened.created).toBe(true);
    const sent = granted(await sendMessageCore(db, f.hallkeeper, opened.thread.id, send("Chairs are out; doors at six.")));
    expect(sent.message.authorRole).toBe("hallkeeper");
    expect(granted(await listMessagesCore(db, f.hallkeeper, opened.thread.id, { after: 0, limit: 50 })).messages.map((m) => m.body))
      .toEqual(["Chairs are out; doors at six."]);
    expect(granted(await listThreadsCore(db, f.hallkeeper, f.venueId, { bookingId: f.bookingId })).map((thread) => thread.id)).toEqual([opened.thread.id]);

    const clientFacing = granted(await openThreadCore(db, f.staff, f.venueId, { audience: "client-facing", subject: "booking", bookingId: f.bookingId })).thread;
    expect(refused(await listMessagesCore(db, f.hallkeeper, clientFacing.id, { after: 0, limit: 50 })).status).toBe(403);
    expect(refused(await sendMessageCore(db, f.hallkeeper, clientFacing.id, send("hello?"))).status).toBe(403);
    // Listing is filtered by the stored audience: the client's thread never appears.
    expect(granted(await listThreadsCore(db, f.hallkeeper, f.venueId, { bookingId: f.bookingId })).map((thread) => thread.id)).toEqual([opened.thread.id]);
  });

  it("sends a message once under a replayed key, even when two phones race", async () => {
    const f = await fixture();
    const thread = granted(await openThreadCore(db, f.staff, f.venueId, { audience: "staff-private", subject: "booking", bookingId: f.bookingId })).thread;
    const key = randomUUID();
    const first = granted(await sendMessageCore(db, f.staff, thread.id, send("Doors at six", key)));
    const again = granted(await sendMessageCore(db, f.staff, thread.id, send("Doors at six", key)));
    expect(first.replay).toBe(false);
    expect(again.replay).toBe(true);
    expect(again.message.id).toBe(first.message.id);

    const raced = randomUUID();
    const [a, b] = await Promise.all([
      sendMessageCore(db, f.staff, thread.id, send("Chairs are out", raced)),
      sendMessageCore(db, f.hallkeeper, thread.id, send("Chairs are out", raced)),
    ]);
    expect(granted(a).message.id).toBe(granted(b).message.id);
    const rows = await db.select().from(schema.messages).where(eq(schema.messages.threadId, thread.id));
    expect(rows).toHaveLength(2);
    const [counted] = await db.select().from(schema.threads).where(eq(schema.threads.id, thread.id));
    expect(counted?.messageCount).toBe(2);
    expect(counted?.lastCursor).toBe(Math.max(...rows.map((row) => row.cursor)));
  });

  it("hands back only what is newer than the cursor, in order", async () => {
    const f = await fixture();
    const thread = granted(await openThreadCore(db, f.staff, f.venueId, { audience: "staff-private", subject: "booking", bookingId: f.bookingId })).thread;
    const one = granted(await sendMessageCore(db, f.staff, thread.id, send("one"))).message;
    const two = granted(await sendMessageCore(db, f.staff, thread.id, send("two"))).message;
    const three = granted(await sendMessageCore(db, f.hallkeeper, thread.id, send("three"))).message;
    expect(one.cursor).toBeLessThan(two.cursor);
    expect(two.cursor).toBeLessThan(three.cursor);

    const page = granted(await listMessagesCore(db, f.admin, thread.id, { after: one.cursor, limit: 50 }));
    expect(page.messages.map((message) => message.body)).toEqual(["two", "three"]);
    expect(page.cursor).toBe(three.cursor);
    const nothing = granted(await listMessagesCore(db, f.admin, thread.id, { after: three.cursor, limit: 50 }));
    expect(nothing.messages).toEqual([]);
    expect(nothing.cursor).toBe(three.cursor);
  });

  it("admits the event's client to the client-facing thread and never to the staff-private one", async () => {
    const f = await fixture();
    const priv = granted(await openThreadCore(db, f.staff, f.venueId, { audience: "staff-private", subject: "booking", bookingId: f.bookingId })).thread;
    const pub = granted(await openThreadCore(db, f.staff, f.venueId, { audience: "client-facing", subject: "booking", bookingId: f.bookingId })).thread;
    await sendMessageCore(db, f.staff, priv.id, send("Private: the client is late paying"));
    await sendMessageCore(db, f.staff, pub.id, send("We have you from ten"));

    expect(granted(await listMessagesCore(db, f.client, pub.id, { after: 0, limit: 50 })).messages.map((m) => m.body)).toEqual(["We have you from ten"]);
    expect(refused(await listMessagesCore(db, f.client, priv.id, { after: 0, limit: 50 })).status).toBe(403);
    expect(refused(await sendMessageCore(db, f.client, priv.id, send("hello?"))).status).toBe(403);
    expect(refused(await listMessagesCore(db, f.stranger, pub.id, { after: 0, limit: 50 })).status).toBe(403);
    expect(refused(await listMessagesCore(db, f.outsider, pub.id, { after: 0, limit: 50 })).status).toBe(403);
    expect(refused(await listMessagesCore(db, f.outsider, priv.id, { after: 0, limit: 50 })).status).toBe(403);
    // A hallkeeper reaches a client's words only through a request.
    expect(refused(await listMessagesCore(db, f.hallkeeper, pub.id, { after: 0, limit: 50 })).status).toBe(403);
    expect(granted(await listMessagesCore(db, f.hallkeeper, priv.id, { after: 0, limit: 50 })).messages).toHaveLength(1);
  });

  it("closes the client's reads and writes the instant the link is revoked", async () => {
    const f = await fixture();
    const pub = granted(await openThreadCore(db, f.staff, f.venueId, { audience: "client-facing", subject: "booking", bookingId: f.bookingId })).thread;
    granted(await sendMessageCore(db, f.client, pub.id, send("Can we have the Saloon too?")));
    expect(await clientHoldsEventLink(db, f.client.id, f.eventId)).toBe(true);

    await db.delete(schema.eventConfigurationLinks).where(eq(schema.eventConfigurationLinks.id, f.linkId));

    expect(await clientHoldsEventLink(db, f.client.id, f.eventId)).toBe(false);
    expect(refused(await sendMessageCore(db, f.client, pub.id, send("Hello?"))).status).toBe(403);
    expect(refused(await listMessagesCore(db, f.client, pub.id, { after: 0, limit: 50 })).status).toBe(403);
    expect(refused(await clientConversationSnapshot(db, f.client, f.eventId, 0)).status).toBe(403);
    expect(refused(await sendClientMessageCore(db, f.client, f.eventId, send("Hello?"))).status).toBe(403);
  });

  it("records delivered, read and acknowledged as facts, never ahead of time", async () => {
    const f = await fixture();
    const pub = granted(await openThreadCore(db, f.staff, f.venueId, { audience: "client-facing", subject: "booking", bookingId: f.bookingId })).thread;
    const sent = granted(await sendMessageCore(db, f.staff, pub.id, send("Doors open at seven")));
    expect(sent.message.receipts).toEqual([]);

    // Nobody has fetched it: the author sees no tick.
    const unseen = granted(await listMessagesCore(db, f.staff, pub.id, { after: 0, limit: 50 }));
    expect(unseen.messages[0]?.receipts).toEqual([]);

    // The client's screen fetches it: delivered, not read.
    granted(await listMessagesCore(db, f.client, pub.id, { after: 0, limit: 50 }));
    const delivered = granted(await listMessagesCore(db, f.staff, pub.id, { after: 0, limit: 50 })).messages[0]?.receipts ?? [];
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.recipientName).toBe("Morag");
    expect(delivered[0]?.deliveredAt).not.toBeNull();
    expect(delivered[0]?.readAt).toBeNull();
    expect(delivered[0]?.acknowledgedAt).toBeNull();

    // The client's screen says read; then the client presses.
    const read = granted(await markReceiptCore(db, f.client, sent.message.id, { mark: "read" }));
    expect(read.receipt.readAt).not.toBeNull();
    const acknowledged = granted(await markReceiptCore(db, f.client, sent.message.id, { mark: "acknowledged" }));
    expect(acknowledged.receipt.acknowledgedAt).not.toBeNull();
    // The first instant stands.
    expect(acknowledged.receipt.readAt).toBe(read.receipt.readAt);

    const final = granted(await listMessagesCore(db, f.staff, pub.id, { after: 0, limit: 50 })).messages[0]?.receipts ?? [];
    expect(final[0]?.readAt).toBe(read.receipt.readAt);
    expect(final[0]?.acknowledgedAt).toBe(acknowledged.receipt.acknowledgedAt);

    // The author cannot tick their own message.
    expect(refused(await markReceiptCore(db, f.staff, sent.message.id, { mark: "read" })).code).toBe("OWN_MESSAGE");
  });

  it("gives the client one snapshot of the event's client-facing threads from a cursor, with the server's clock", async () => {
    const f = await fixture();
    const pub = granted(await openThreadCore(db, f.staff, f.venueId, { audience: "client-facing", subject: "booking", bookingId: f.bookingId })).thread;
    granted(await sendMessageCore(db, f.staff, pub.id, send("We have you from ten")));
    const asked = granted(await sendClientMessageCore(db, f.client, f.eventId, send("Could we come at nine to set up?")));
    expect(asked.thread.subject).toBe("event");
    const askedAgain = granted(await sendClientMessageCore(db, f.client, f.eventId, send("And park round the back?")));
    expect(askedAgain.thread.id).toBe(asked.thread.id);

    const before = Date.now();
    const snapshot = granted(await clientConversationSnapshot(db, f.client, f.eventId, 0));
    expect(snapshot.threads.map((thread) => thread.subject).sort()).toEqual(["booking", "event"]);
    expect(snapshot.messages.map((message) => message.body)).toEqual([
      "We have you from ten", "Could we come at nine to set up?", "And park round the back?",
    ]);
    expect(snapshot.cursor).toBe(askedAgain.message.cursor);
    expect(snapshot.serverNowMs).toBeGreaterThanOrEqual(before);
    expect(snapshot.serverNowMs).toBeLessThanOrEqual(Date.now());

    const later = granted(await clientConversationSnapshot(db, f.client, f.eventId, snapshot.cursor));
    expect(later.messages).toEqual([]);
    expect(later.cursor).toBe(snapshot.cursor);
  });

  it("keeps a staff-private thread out of the client's snapshot entirely", async () => {
    const f = await fixture();
    const priv = granted(await openThreadCore(db, f.staff, f.venueId, { audience: "staff-private", subject: "booking", bookingId: f.bookingId })).thread;
    granted(await sendMessageCore(db, f.staff, priv.id, send("Private note about the deposit")));
    const snapshot = granted(await clientConversationSnapshot(db, f.client, f.eventId, 0));
    expect(snapshot.threads.every((thread) => thread.audience === "client-facing")).toBe(true);
    expect(snapshot.messages.some((message) => message.body.includes("deposit"))).toBe(false);
  });
});
