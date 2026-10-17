import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promotedHoldFromActionPath } from "@omnitwin/types";
import * as schema from "../db/schema.js";
import { transitionBookingCore, type MutationActor } from "../services/booking-mutations.js";
import { loadPromotionDraft } from "../services/hold-promotion.js";

// ---------------------------------------------------------------------------
// The promoted 2nd option is told, in the same transaction (fix-first item 8;
// Blake, 26 September 2026), on Goal 12's migrated disposable cluster.
//
// A mock cannot prove the notice and the ladder commit together, so the last
// case makes the notice's insert fail inside the database and shows the exit
// and the new ranks rolled back with it.
//
// Never loads .env or falls back to DATABASE_URL.
// ---------------------------------------------------------------------------

const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("Hold promotion tests require the explicit disposable platform database");
  }
}

const DAY = new Date("2030-06-15T16:00:00.000Z"); // Saturday 15 June 2030, 17:00 in Glasgow
const DAY_END = new Date("2030-06-15T23:00:00.000Z");

describe.skipIf(target === undefined)("the promoted 2nd option is told, on migrated PostgreSQL", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: `hold_promotion_${randomUUID()}`, max: 4,
      options: "-c statement_timeout=10000 -c lock_timeout=8000" });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name)
      .toBe("venviewer_platform_test");
    db = drizzle(pool, { schema });
  });
  afterAll(async () => { await pool?.end(); });

  async function person(venueId: string, role: string, name: string): Promise<string> {
    const id = randomUUID();
    await db.insert(schema.users).values({ id, venueId, name, email: `${id}@promotion.invalid`, role });
    return id;
  }

  /** A venue with a two-hold ladder on one Saturday: the office (staff) owns
   *  the 1st option, and `secondOwner` the 2nd. */
  async function ladder(options: { secondOwnerRole?: string; secondOwnerElsewhere?: boolean; secondTitle?: string } = {}) {
    const venueId = randomUUID(), spaceId = randomUUID(), otherVenueId = randomUUID();
    await db.insert(schema.venues).values([
      { id: venueId, name: "Trades Hall", slug: venueId, address: "Disposable fixture" },
      { id: otherVenueId, name: "Elsewhere", slug: otherVenueId, address: "Disposable fixture" },
    ]);
    await db.insert(schema.spaces).values({ id: spaceId, venueId, name: "Grand Hall", slug: "grand-hall", widthM: "10", lengthM: "21", heightM: "8",
      floorPlanOutline: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 21 }, { x: 0, y: 21 }] });
    const office = await person(venueId, "staff", "Moira Stewart");
    const secondOwner = await person(options.secondOwnerElsewhere === true ? otherVenueId : venueId,
      options.secondOwnerRole ?? "sales", "Sam Morrison");
    const enquiryId = randomUUID();
    await db.insert(schema.enquiries).values({ id: enquiryId, venueId, spaceId, name: "Jane MacLeod", email: "jane.macleod@example.test", state: "submitted" });
    const first = randomUUID(), second = randomUUID();
    const hygiene = { nextAction: "Call the client", decisionAt: new Date("2030-05-30T16:00:00.000Z"), nextActionDueAt: new Date("2030-05-20T09:00:00.000Z") };
    await db.insert(schema.bookings).values([
      { id: first, venueId, spaceId, kind: "hold", title: "Campbell wedding", startsAt: DAY, endsAt: DAY_END, rank: 1, ownerUserId: office, createdBy: office, ...hygiene },
      { id: second, venueId, spaceId, kind: "hold", title: options.secondTitle ?? "MacLeod wedding", startsAt: DAY, endsAt: DAY_END, rank: 2,
        ownerUserId: secondOwner, createdBy: office, enquiryId, ...hygiene },
    ]);
    const actor: MutationActor = { id: office, venueId, role: "staff", platformRole: "none" };
    return { venueId, otherVenueId, spaceId, office, secondOwner, first, second, actor };
  }

  async function noticesFor(venueId: string) {
    return db.select().from(schema.eventPlanNotifications).where(eq(schema.eventPlanNotifications.venueId, venueId));
  }

  it.each(["released", "expired", "lost"] as const)("tells the 2nd option's owner by name when the 1st is %s", async (toState) => {
    const f = await ladder();
    const result = await transitionBookingCore(db, f.actor, f.first, { toState });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [promoted] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, f.second));
    expect(promoted?.rank).toBe(1);

    const notices = await noticesFor(f.venueId);
    expect(notices).toHaveLength(1);
    const notice = notices[0];
    expect(notice).toMatchObject({
      recipientUserId: f.secondOwner,
      audienceRole: "sales",
      eventId: null,
      severity: "attention",
      title: "Now 1st option: Saturday 15 June 2030, Grand Hall",
    });
    const exitWords = { released: "released", expired: "marked as lapsed", lost: "marked as lost" }[toState];
    expect(notice?.body).toBe(
      `MacLeod wedding has moved up. The hold ahead of it was ${exitWords} by Moira Stewart. `
      + "A drafted email to your client is ready for you to read, change and send from your own email. Nothing has been sent. "
      + "When the client answers, Moira Stewart in the office will confirm or release the hold.",
    );
    expect(promotedHoldFromActionPath(notice?.actionPath ?? null)).toBe(f.second);
    expect(notice?.actionPath).toContain("goto=2030-06-15");

    // What the transport announces after commit.
    expect(result.promotionNotices).toEqual([expect.objectContaining({
      bookingId: f.second, recipientUserIds: [f.secondOwner], audienceRoles: [], notificationIds: [notice?.id],
    })]);
  });

  it("does not add the office line for an owner who writes the Diary", async () => {
    const f = await ladder({ secondOwnerRole: "staff" });
    expect((await transitionBookingCore(db, f.actor, f.first, { toState: "released" })).ok).toBe(true);
    const [notice] = await noticesFor(f.venueId);
    expect(notice?.audienceRole).toBe("staff");
    expect(notice?.body).not.toContain("in the office");
  });

  it("tells the office when the 2nd option's owner no longer works at the venue", async () => {
    const f = await ladder({ secondOwnerElsewhere: true });
    expect((await transitionBookingCore(db, f.actor, f.first, { toState: "released" })).ok).toBe(true);
    const notices = await noticesFor(f.venueId);
    expect(notices.map((row) => row.audienceRole).sort()).toEqual(["admin", "staff"]);
    for (const row of notices) {
      expect(row.recipientUserId).toBeNull();
      expect(row.title).toBe("1st option, no owner: Saturday 15 June 2030, Grand Hall");
      expect(row.body).toContain("Nobody owns this hold now.");
    }
  });

  it("writes nothing when nobody moves up", async () => {
    const f = await ladder();
    expect((await transitionBookingCore(db, f.actor, f.second, { toState: "released" })).ok).toBe(true);
    expect(await noticesFor(f.venueId)).toEqual([]);
  });

  it("drafts the email to the enquirer for the pipeline at the venue, and refuses everyone else", async () => {
    const f = await ladder();
    expect((await transitionBookingCore(db, f.actor, f.first, { toState: "released" })).ok).toBe(true);

    const owner: MutationActor = { id: f.secondOwner, venueId: f.venueId, role: "sales", platformRole: "none" };
    const result = await loadPromotionDraft(db, owner, f.second, new Date("2030-05-01T09:00:00.000Z"));
    expect(result).toEqual({
      ok: true,
      draft: {
        bookingId: f.second,
        to: { name: "Jane MacLeod", email: "jane.macleod@example.test", source: "enquiry" },
        subject: "Your date at Trades Hall: Saturday 15 June 2030, Grand Hall",
        body: [
          "Dear Jane,",
          "",
          "Your provisional booking of the Grand Hall on Saturday 15 June 2030 is now 1st option.",
          "",
          "I can hold the date for you until Thursday 30 May 2030. Please let me know by then whether you would like to confirm.",
          "",
          "If your plans have changed, a short reply is enough and I will release the date.",
          "",
          "Kind regards,",
          "",
          "Sam Morrison",
          "Trades Hall",
        ].join("\n"),
      },
    });

    const hallkeeper = await person(f.venueId, "hallkeeper", "Hall Keeper");
    expect(await loadPromotionDraft(db, { id: hallkeeper, venueId: f.venueId, role: "hallkeeper", platformRole: "none" }, f.second))
      .toMatchObject({ ok: false, status: 403 });
    const stranger = await person(f.otherVenueId, "sales", "Other Sales");
    expect(await loadPromotionDraft(db, { id: stranger, venueId: f.otherVenueId, role: "sales", platformRole: "none" }, f.second))
      .toMatchObject({ ok: false, status: 403 });
  });

  it("prefers the event's client contact and says when the hold is no longer 1st option", async () => {
    const f = await ladder();
    const accountId = randomUUID(), contactId = randomUUID(), eventId = randomUUID();
    await db.insert(schema.clientAccounts).values({ id: accountId, venueId: f.venueId, name: "MacLeod family" });
    await db.insert(schema.contacts).values({ id: contactId, venueId: f.venueId, clientAccountId: accountId, name: "Iain MacLeod", email: "iain@example.test" });
    await db.update(schema.clientAccounts).set({ primaryContactId: contactId }).where(eq(schema.clientAccounts.id, accountId));
    await db.insert(schema.events).values({ id: eventId, venueId: f.venueId, name: "MacLeod wedding", clientAccountId: accountId });
    await db.update(schema.bookings).set({ eventId }).where(eq(schema.bookings.id, f.second));
    expect((await transitionBookingCore(db, f.actor, f.first, { toState: "lost" })).ok).toBe(true);

    const reader: MutationActor = { id: f.office, venueId: f.venueId, role: "staff", platformRole: "none" };
    const drafted = await loadPromotionDraft(db, reader, f.second, new Date("2030-06-01T09:00:00.000Z"));
    expect(drafted.ok && drafted.draft.to).toEqual({ name: "Iain MacLeod", email: "iain@example.test", source: "client_contact" });
    // The decision date has passed, so the draft does not offer it.
    expect(drafted.ok && drafted.draft.body).toContain("Please let me know whether you would like to confirm");

    await db.update(schema.bookings).set({ status: "released" }).where(eq(schema.bookings.id, f.second));
    expect(await loadPromotionDraft(db, reader, f.second)).toMatchObject({ ok: false, status: 409, code: "NOT_FIRST_OPTION" });
  });

  it("rolls the exit and the new ranks back when the notice cannot be written", async () => {
    const marker = `FAIL-NOTICE-${randomUUID().slice(0, 8)}`;
    const fn = `promotion_notice_fails_${randomUUID().replaceAll("-", "")}`;
    await pool.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.body LIKE '%${marker}%' THEN RAISE EXCEPTION 'notice refused for the test'; END IF; RETURN NEW; END $$`);
    await pool.query(`CREATE TRIGGER ${fn} BEFORE INSERT ON event_plan_notifications FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
    try {
      const f = await ladder({ secondTitle: marker });
      await expect(transitionBookingCore(db, f.actor, f.first, { toState: "released" })).rejects.toThrow();
      const rows = await db.select().from(schema.bookings).where(inArray(schema.bookings.id, [f.first, f.second]));
      const byId = new Map(rows.map((row) => [row.id, row]));
      expect(byId.get(f.first)).toMatchObject({ status: "active", rank: 1 });
      expect(byId.get(f.second)).toMatchObject({ status: "active", rank: 2 });
      expect(await db.select().from(schema.bookingStatusHistory).where(eq(schema.bookingStatusHistory.bookingId, f.first))).toEqual([]);
      expect(await noticesFor(f.venueId)).toEqual([]);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${fn} ON event_plan_notifications`);
      await pool.query(`DROP FUNCTION IF EXISTS ${fn}()`);
    }
  });
});
