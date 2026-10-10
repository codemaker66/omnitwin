import { describe, expect, it } from "vitest";
import {
  COUNTABLE_REQUEST_KINDS,
  ClientCreateRequestSchema,
  REQUEST_KINDS,
  REQUEST_OUTCOMES,
  REQUEST_STATES,
  RequestTransitionSchema,
  describeRequestKind,
  describeRequestOutcome,
  describeRequestState,
  isOpenRequest,
  nextRequestState,
} from "../requests.js";

// ---------------------------------------------------------------------------
// Goal 19 S1 — the request vocabulary widened (D4): chairs, tables and setup
// join the kinds; underway, handed-over and reopened join the ladder;
// "substituted" joins the outcomes. The ladder still only climbs, except that
// a finished request may be reopened, which starts it again.
// ---------------------------------------------------------------------------

const UUID = "00000000-0000-4000-8000-00000000d001";

describe("the widened vocabulary", () => {
  it("keeps the shipped kinds first and adds the room's furniture", () => {
    expect([...REQUEST_KINDS]).toEqual([
      "refreshments", "temperature", "cleaning", "av", "access", "chairs", "tables", "setup", "other",
    ]);
    expect(describeRequestKind("chairs")).toBe("Chairs");
    expect(describeRequestKind("tables")).toBe("Tables");
    expect(describeRequestKind("setup")).toBe("Room setup");
  });

  it("counts the kinds that have a number", () => {
    expect([...COUNTABLE_REQUEST_KINDS]).toEqual(["refreshments", "av", "chairs", "tables", "other"]);
  });

  it("adds underway, handed-over and reopened to the ladder", () => {
    expect([...REQUEST_STATES]).toEqual([
      "sent", "acknowledged", "accepted", "underway", "handed-over", "resolved", "reopened",
    ]);
    expect(describeRequestState("underway")).toBe("Underway");
    expect(describeRequestState("handed-over")).toBe("Handing over");
    expect(describeRequestState("reopened")).toBe("Reopened");
  });

  it("adds an outcome for a request done another way", () => {
    expect([...REQUEST_OUTCOMES]).toEqual(["done", "not_possible", "no_longer_needed", "substituted"]);
    expect(describeRequestOutcome("substituted")).toBe("Done another way");
  });
});

describe("the ladder", () => {
  it("climbs through underway", () => {
    expect(nextRequestState("accepted", "underway").ok).toBe(true);
    expect(nextRequestState("underway", "resolved").ok).toBe(true);
    expect(nextRequestState("sent", "underway").ok).toBe(false);
  });

  it("hands over only something somebody owns, and the next person accepts it", () => {
    expect(nextRequestState("accepted", "handed-over").ok).toBe(true);
    expect(nextRequestState("underway", "handed-over").ok).toBe(true);
    expect(nextRequestState("sent", "handed-over").ok).toBe(false);
    expect(nextRequestState("handed-over", "accepted").ok).toBe(true);
    expect(nextRequestState("handed-over", "resolved").ok).toBe(true);
    expect(nextRequestState("handed-over", "underway").ok).toBe(false);
  });

  it("reopens only a finished request, and a reopened one climbs again", () => {
    expect(nextRequestState("resolved", "reopened").ok).toBe(true);
    expect(nextRequestState("accepted", "reopened").ok).toBe(false);
    expect(nextRequestState("reopened", "acknowledged").ok).toBe(true);
    expect(nextRequestState("reopened", "accepted").ok).toBe(true);
    expect(nextRequestState("reopened", "resolved").ok).toBe(true);
    expect(nextRequestState("resolved", "accepted").ok).toBe(false);
  });

  it("counts a handed-over or reopened request as open", () => {
    expect(isOpenRequest({ state: "handed-over" })).toBe(true);
    expect(isOpenRequest({ state: "reopened" })).toBe(true);
    expect(isOpenRequest({ state: "underway" })).toBe(true);
    expect(isOpenRequest({ state: "resolved" })).toBe(false);
  });
});

describe("what may be sent to move a request", () => {
  it("names the person a handover goes to", () => {
    expect(RequestTransitionSchema.safeParse({ to: "handed-over", toUserId: UUID }).success).toBe(true);
    expect(RequestTransitionSchema.safeParse({ to: "handed-over" }).success).toBe(false);
  });

  it("takes a note on reopening and an outcome on finishing", () => {
    expect(RequestTransitionSchema.safeParse({ to: "reopened", note: "Still only eight chairs" }).success).toBe(true);
    expect(RequestTransitionSchema.safeParse({ to: "resolved", outcome: "substituted", note: "Benches instead" }).success).toBe(true);
    expect(RequestTransitionSchema.safeParse({ to: "resolved" }).success).toBe(false);
  });

  it("refuses to carry a time, a layout or an audience", () => {
    expect(RequestTransitionSchema.safeParse({ to: "accepted", startsAt: "2026-10-10T12:00:00Z" }).success).toBe(false);
    expect(RequestTransitionSchema.safeParse({ to: "accepted", audienceRoles: ["client"] }).success).toBe(false);
  });
});

describe("what a client may send", () => {
  it("names the slot, not the room: the room comes from the booking", () => {
    const made = ClientCreateRequestSchema.safeParse({
      bookingId: UUID, kind: "chairs", quantity: 10, urgency: "soon", idempotencyKey: UUID,
    });
    expect(made.success).toBe(true);
    expect(ClientCreateRequestSchema.safeParse({
      roomId: UUID, bookingId: UUID, kind: "chairs", urgency: "soon", idempotencyKey: UUID,
    }).success).toBe(false);
  });

  it("cannot name an audience, a time or a price", () => {
    for (const extra of [{ audienceRoles: ["admin"] }, { startsAt: "x" }, { price: 100 }]) {
      expect(ClientCreateRequestSchema.safeParse({
        bookingId: UUID, kind: "chairs", urgency: "soon", idempotencyKey: UUID, ...extra,
      }).success).toBe(false);
    }
  });
});
