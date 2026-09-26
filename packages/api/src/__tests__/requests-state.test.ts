import { describe, it, expect } from "vitest";
import {
  REQUEST_KINDS,
  REQUEST_STATES,
  REQUEST_URGENCIES,
  STAFF_AUDIENCE_ROLES,
  USER_ROLES,
  describeRequestState,
  isOpenRequest,
  nextRequestState,
  summariseRequest,
} from "@omnitwin/types";
import { selectDueRequestEscalations, type EscalationCandidate } from "../services/requests.js";

// The rules that do not need a database: the ladder, the audience derivation,
// and which unanswered request is due to reach the venue administrator.

describe("the request ladder", () => {
  it("climbs, in either the short way or the long way", () => {
    expect(nextRequestState("sent", "acknowledged").ok).toBe(true);
    expect(nextRequestState("sent", "accepted").ok).toBe(true);
    expect(nextRequestState("sent", "resolved").ok).toBe(true);
    expect(nextRequestState("acknowledged", "accepted").ok).toBe(true);
    expect(nextRequestState("accepted", "resolved").ok).toBe(true);
  });

  it("never goes backwards", () => {
    expect(nextRequestState("accepted", "acknowledged").ok).toBe(false);
    expect(nextRequestState("resolved", "accepted").ok).toBe(false);
    expect(nextRequestState("acknowledged", "sent").ok).toBe(false);
  });

  it("says plainly when a request is already finished", () => {
    const check = nextRequestState("resolved", "resolved");
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain("Done");
  });

  it("uses words a hallkeeper would use, not state names", () => {
    expect(describeRequestState("acknowledged")).toBe("Seen");
    expect(describeRequestState("accepted")).toBe("Someone is on it");
    expect(describeRequestState("resolved")).toBe("Done");
  });

  it("counts everything but a finished request as open", () => {
    expect(isOpenRequest({ state: "sent" })).toBe(true);
    expect(isOpenRequest({ state: "acknowledged" })).toBe(true);
    expect(isOpenRequest({ state: "accepted" })).toBe(true);
    expect(isOpenRequest({ state: "resolved" })).toBe(false);
  });

  it("keeps the vocabulary the plan fixed", () => {
    expect([...REQUEST_KINDS]).toEqual(["refreshments", "temperature", "cleaning", "av", "access", "other"]);
    expect([...REQUEST_URGENCIES]).toEqual(["routine", "soon", "now"]);
    expect([...REQUEST_STATES]).toEqual(["sent", "acknowledged", "accepted", "resolved"]);
  });
});

describe("the audience", () => {
  it("is derived from the product's role list, not a second copy of it", () => {
    for (const role of USER_ROLES) {
      const isClientSide = role === "client" || role === "planner";
      expect(STAFF_AUDIENCE_ROLES.includes(role)).toBe(!isClientSide);
    }
  });

  it("never includes the client's side of the table", () => {
    expect(STAFF_AUDIENCE_ROLES).not.toContain("client");
    expect(STAFF_AUDIENCE_ROLES).not.toContain("planner");
  });

  it("carries every staff role the product currently knows", () => {
    expect(STAFF_AUDIENCE_ROLES).toContain("staff");
    expect(STAFF_AUDIENCE_ROLES).toContain("hallkeeper");
    expect(STAFF_AUDIENCE_ROLES).toContain("admin");
  });
});

describe("what a slab says in one line", () => {
  it("names the thing and the room", () => {
    expect(summariseRequest({ kind: "refreshments", quantity: 6, roomName: "Grand Hall" }))
      .toBe("Refreshments × 6 · Grand Hall");
  });

  it("leaves the count out when nobody counted", () => {
    expect(summariseRequest({ kind: "temperature", quantity: null, roomName: "Saloon" }))
      .toBe("Room temperature · Saloon");
  });

  it("works without a room", () => {
    expect(summariseRequest({ kind: "other", quantity: null, roomName: null })).toBe("Something else");
  });
});

describe("which unanswered request is due to escalate", () => {
  const base: EscalationCandidate = {
    id: "r-1",
    state: "sent",
    urgency: "now",
    escalationDueAt: new Date("2026-09-16T14:03:00.000Z"),
    escalatedAt: null,
  };
  const now = new Date("2026-09-16T14:03:01.000Z");

  it("picks an urgent request nobody has answered past its window", () => {
    expect(selectDueRequestEscalations([base], now).map((row) => row.id)).toEqual(["r-1"]);
  });

  it("leaves it alone before the window has passed", () => {
    expect(selectDueRequestEscalations([base], new Date("2026-09-16T14:02:59.000Z"))).toEqual([]);
  });

  it("stops the moment somebody says they have seen it", () => {
    expect(selectDueRequestEscalations([{ ...base, state: "acknowledged" }], now)).toEqual([]);
    expect(selectDueRequestEscalations([{ ...base, state: "accepted" }], now)).toEqual([]);
    expect(selectDueRequestEscalations([{ ...base, state: "resolved" }], now)).toEqual([]);
  });

  it("only escalates the urgent ones", () => {
    expect(selectDueRequestEscalations([{ ...base, urgency: "soon" }], now)).toEqual([]);
    expect(selectDueRequestEscalations([{ ...base, urgency: "routine" }], now)).toEqual([]);
  });

  it("never escalates a request twice", () => {
    expect(selectDueRequestEscalations([{ ...base, escalatedAt: now }], now)).toEqual([]);
  });

  it("never escalates a venue that has set no window", () => {
    expect(selectDueRequestEscalations([{ ...base, escalationDueAt: null }], now)).toEqual([]);
  });
});
