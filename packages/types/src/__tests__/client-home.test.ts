import { describe, expect, it } from "vitest";
import { CLIENT_HOME_PLAN_LIMIT, ClientHomeSchema } from "../client-home.js";

// The client's own home is strict: nothing the venue keeps for itself may
// ride along, and a plan may name only an event the same answer lists.

const VENUE = { id: "00000000-0000-4000-8000-0000000000f1", name: "Trades Hall Glasgow" };
const EVENT = {
  id: "00000000-0000-4000-8000-0000000000e1", name: "Winter dinner", eventType: "dinner",
  startsAt: "2026-12-05T18:00:00.000Z", endsAt: "2026-12-05T23:00:00.000Z", guestCount: 120,
  venue: { ...VENUE, timezone: "Europe/London" }, layoutCount: 1,
};
const PLAN = {
  id: "00000000-0000-4000-8000-0000000000c1", name: "Rounds of ten", updatedAt: "2026-10-15T10:00:00.000Z",
  space: { id: "00000000-0000-4000-8000-0000000000a1", name: "Grand Hall" }, venue: VENUE, eventId: EVENT.id,
};

describe("ClientHomeSchema", () => {
  it("accepts a person's own events and plans, and an empty home", () => {
    expect(ClientHomeSchema.safeParse({ events: [EVENT], plans: [PLAN], planTotal: 1 }).success).toBe(true);
    expect(ClientHomeSchema.safeParse({ events: [], plans: [], planTotal: 0 }).success).toBe(true);
  });

  it("refuses the venue's internal fields", () => {
    expect(ClientHomeSchema.safeParse({ events: [{ ...EVENT, notes: "internal" }], plans: [], planTotal: 0 }).success).toBe(false);
    expect(ClientHomeSchema.safeParse({ events: [{ ...EVENT, clientName: "someone" }], plans: [], planTotal: 0 }).success).toBe(false);
    expect(ClientHomeSchema.safeParse({ events: [EVENT], plans: [{ ...PLAN, metadata: {} }], planTotal: 1 }).success).toBe(false);
  });

  it("refuses a plan that names an event the answer does not list", () => {
    expect(ClientHomeSchema.safeParse({ events: [], plans: [PLAN], planTotal: 1 }).success).toBe(false);
  });

  it("refuses repeated rows, a short total and more plans than the limit", () => {
    expect(ClientHomeSchema.safeParse({ events: [EVENT, EVENT], plans: [], planTotal: 0 }).success).toBe(false);
    expect(ClientHomeSchema.safeParse({ events: [EVENT], plans: [PLAN], planTotal: 0 }).success).toBe(false);
    const many = Array.from({ length: CLIENT_HOME_PLAN_LIMIT + 1 }, (_, index) => ({
      ...PLAN, eventId: null, id: `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
    }));
    expect(ClientHomeSchema.safeParse({ events: [], plans: many, planTotal: many.length }).success).toBe(false);
  });

  it("requires at least one linked layout on an event", () => {
    expect(ClientHomeSchema.safeParse({ events: [{ ...EVENT, layoutCount: 0 }], plans: [], planTotal: 0 }).success).toBe(false);
  });
});
