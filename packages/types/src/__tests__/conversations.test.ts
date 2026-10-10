import { describe, expect, it } from "vitest";
import {
  ConversationCommandSchema,
  CreateThreadSchema,
  MESSAGE_BODY_MAX,
  MESSAGE_KINDS,
  MarkReceiptSchema,
  MessageListQuerySchema,
  MessageSchema,
  SendMessageSchema,
  THREAD_AUDIENCES,
  THREAD_SUBJECTS,
  ThreadSchema,
  threadAudienceAdmits,
} from "../conversations.js";
import { STAFF_AUDIENCE_ROLES, USER_ROLES } from "../index.js";

// ---------------------------------------------------------------------------
// Goal 19 S1 — conversations: threads, messages and receipts (D4, D6).
//
// The rules that must hold before any route exists: the audience vocabulary,
// the body limit, that a message can carry words and nothing else, and who an
// audience admits. threadAudienceAdmits is the single arbiter the API, the
// hub's replay and the web client all call, so it is held here role by role.
// ---------------------------------------------------------------------------

const VENUE = "00000000-0000-4000-8000-00000000c001";
const OTHER_VENUE = "00000000-0000-4000-8000-00000000c002";
const BOOKING = "00000000-0000-4000-8000-00000000c003";
const KEY = "00000000-0000-4000-8000-00000000c004";

describe("the vocabulary", () => {
  it("has exactly two audiences until goal 10 adds the supplier's", () => {
    expect([...THREAD_AUDIENCES]).toEqual(["staff-private", "client-facing"]);
  });

  it("names what a thread is about", () => {
    expect([...THREAD_SUBJECTS]).toEqual(["booking", "event", "request", "person"]);
  });

  it("has three kinds of message and no attachment", () => {
    expect([...MESSAGE_KINDS]).toEqual(["text", "request", "system"]);
    expect(MessageSchema.shape).not.toHaveProperty("attachments");
  });

  it("caps a message at two thousand characters", () => {
    expect(MESSAGE_BODY_MAX).toBe(2000);
    expect(SendMessageSchema.safeParse({ body: "x".repeat(2000), idempotencyKey: KEY }).success).toBe(true);
    expect(SendMessageSchema.safeParse({ body: "x".repeat(2001), idempotencyKey: KEY }).success).toBe(false);
    expect(SendMessageSchema.safeParse({ body: "   ", idempotencyKey: KEY }).success).toBe(false);
  });
});

describe("a message carries words and nothing else", () => {
  it("rejects a body that tries to carry a time", () => {
    const smuggled = SendMessageSchema.safeParse({
      body: "Move us to 7pm", idempotencyKey: KEY, startsAt: "2026-10-10T19:00:00.000Z",
    });
    expect(smuggled.success).toBe(false);
  });

  it("rejects a body that tries to carry stock or a quantity", () => {
    expect(SendMessageSchema.safeParse({ body: "Ten more chairs", idempotencyKey: KEY, quantity: 10 }).success).toBe(false);
    expect(SendMessageSchema.safeParse({ body: "Ten more chairs", idempotencyKey: KEY, stockDelta: 10 }).success).toBe(false);
  });

  it("rejects a body that tries to name an audience or a layout", () => {
    expect(SendMessageSchema.safeParse({ body: "hello", idempotencyKey: KEY, audience: "client-facing" }).success).toBe(false);
    expect(SendMessageSchema.safeParse({ body: "hello", idempotencyKey: KEY, configurationId: BOOKING }).success).toBe(false);
  });

  it("needs a client-minted key so a resend is the same message", () => {
    expect(SendMessageSchema.safeParse({ body: "hello" }).success).toBe(false);
    expect(SendMessageSchema.safeParse({ body: "hello", idempotencyKey: "not-a-uuid" }).success).toBe(false);
  });
});

describe("a thread is made once and its audience is fixed", () => {
  it("accepts a booking thread for either audience", () => {
    for (const audience of THREAD_AUDIENCES) {
      expect(CreateThreadSchema.safeParse({ audience, subject: "booking", bookingId: BOOKING }).success).toBe(true);
    }
  });

  it("refuses a subject without the thing it is about", () => {
    expect(CreateThreadSchema.safeParse({ audience: "staff-private", subject: "booking" }).success).toBe(false);
    expect(CreateThreadSchema.safeParse({ audience: "staff-private", subject: "event" }).success).toBe(false);
  });

  it("refuses to make a request thread or a person thread by hand", () => {
    // A request's thread is made with the request; a person thread is goal 19 S4+.
    expect(CreateThreadSchema.safeParse({ audience: "client-facing", subject: "request", requestId: BOOKING }).success).toBe(false);
    expect(CreateThreadSchema.safeParse({ audience: "staff-private", subject: "person", subjectUserId: BOOKING }).success).toBe(false);
  });

  it("has no schema at all for changing an audience", () => {
    expect(ThreadSchema.shape.audience.isOptional()).toBe(false);
    expect(MarkReceiptSchema.safeParse({ mark: "read", audience: "staff-private" }).success).toBe(false);
  });
});

describe("who an audience admits", () => {
  const at = (role: string, venueId: string | null = VENUE) => ({ role, venueId, platformRole: "none" as const });
  const staffPrivate = { venueId: VENUE, audience: "staff-private" as const, subject: "booking" as const };
  const clientFacing = { venueId: VENUE, audience: "client-facing" as const, subject: "booking" as const };
  const clientRequest = { venueId: VENUE, audience: "client-facing" as const, subject: "request" as const };

  it("lets exactly the floor into a staff-private thread, and never a client", () => {
    for (const role of USER_ROLES) {
      const admitted = threadAudienceAdmits(at(role), staffPrivate, { holdsEventLink: true });
      expect(admitted, role).toBe(STAFF_AUDIENCE_ROLES.includes(role));
    }
  });

  it("lets the office and the event's client into a client-facing thread", () => {
    expect(threadAudienceAdmits(at("admin"), clientFacing, { holdsEventLink: false })).toBe(true);
    expect(threadAudienceAdmits(at("staff"), clientFacing, { holdsEventLink: false })).toBe(true);
    expect(threadAudienceAdmits(at("manager"), clientFacing, { holdsEventLink: false })).toBe(true);
    expect(threadAudienceAdmits(at("client", null), clientFacing, { holdsEventLink: true })).toBe(true);
    expect(threadAudienceAdmits(at("planner", null), clientFacing, { holdsEventLink: true })).toBe(true);
  });

  it("keeps a client without a live link out, the instant the link is gone", () => {
    expect(threadAudienceAdmits(at("client", null), clientFacing, { holdsEventLink: false })).toBe(false);
    expect(threadAudienceAdmits(at("client", null), clientRequest, { holdsEventLink: false })).toBe(false);
  });

  it("lets a hallkeeper into a client-facing thread only through the request that opened it", () => {
    expect(threadAudienceAdmits(at("hallkeeper"), clientRequest, { holdsEventLink: false })).toBe(true);
    expect(threadAudienceAdmits(at("hallkeeper"), clientFacing, { holdsEventLink: false })).toBe(false);
  });

  it("keeps sales and an event-scoped caterer out of every thread", () => {
    for (const thread of [staffPrivate, clientFacing, clientRequest]) {
      expect(threadAudienceAdmits(at("sales"), thread, { holdsEventLink: true })).toBe(false);
      expect(threadAudienceAdmits(at("caterer"), thread, { holdsEventLink: true })).toBe(false);
    }
  });

  it("keeps another venue's floor out", () => {
    expect(threadAudienceAdmits(at("admin", OTHER_VENUE), staffPrivate, { holdsEventLink: false })).toBe(false);
    expect(threadAudienceAdmits(at("hallkeeper", OTHER_VENUE), clientRequest, { holdsEventLink: false })).toBe(false);
  });

  it("lets a platform administrator read everything", () => {
    expect(threadAudienceAdmits({ role: "admin", venueId: null, platformRole: "admin" }, staffPrivate, { holdsEventLink: false })).toBe(true);
  });
});

describe("reading forward from a cursor", () => {
  it("defaults to the beginning and a page of fifty", () => {
    expect(MessageListQuerySchema.parse({})).toEqual({ after: 0, limit: 50 });
  });

  it("coerces the query string and refuses a negative cursor", () => {
    expect(MessageListQuerySchema.parse({ after: "12", limit: "5" })).toEqual({ after: 12, limit: 5 });
    expect(MessageListQuerySchema.safeParse({ after: "-1" }).success).toBe(false);
    expect(MessageListQuerySchema.safeParse({ limit: "500" }).success).toBe(false);
  });
});

describe("the conversation command envelope", () => {
  it("carries a send with the same body rules as REST", () => {
    const command = ConversationCommandSchema.safeParse({
      kind: "message.send", commandId: KEY, threadId: BOOKING, payload: { body: "On our way", idempotencyKey: KEY },
    });
    expect(command.success).toBe(true);
    const smuggled = ConversationCommandSchema.safeParse({
      kind: "message.send", commandId: KEY, threadId: BOOKING, payload: { body: "On our way", idempotencyKey: KEY, startsAt: "x" },
    });
    expect(smuggled.success).toBe(false);
  });

  it("names every request step as a command kind", () => {
    for (const kind of ["request.acknowledge", "request.accept", "request.underway", "request.resolve", "request.reopen"]) {
      const payload = kind === "request.resolve" ? { outcome: "done" } : {};
      expect(ConversationCommandSchema.safeParse({ kind, commandId: KEY, requestId: BOOKING, payload }).success, kind).toBe(true);
    }
    expect(ConversationCommandSchema.safeParse({
      kind: "request.handover", commandId: KEY, requestId: BOOKING, payload: { toUserId: BOOKING },
    }).success).toBe(true);
  });
});
