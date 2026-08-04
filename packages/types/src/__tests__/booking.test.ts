import { describe, expect, it } from "vitest";
import {
  BOOKING_EXIT_STATES,
  BOOKING_KINDS,
  BOOKING_LIVENESS_STATUSES,
  BOOKING_STATES,
  BookingSchema,
  CalendarConflictSchema,
  CalendarEntrySchema,
  CalendarQuerySchema,
  CalendarResponseSchema,
  ConflictReportSchema,
  CreateBookingSchema,
  MAX_CALENDAR_RANGE_DAYS,
  TransitionBookingSchema,
  TurnaroundRuleSchema,
  UpdateBookingSchema,
  VALID_BOOKING_TRANSITIONS,
  bookingStateToColumns,
  deriveBookingState,
  isValidBookingTransition,
  type BookingState,
} from "../booking.js";

// ---------------------------------------------------------------------------
// Diary Slice 1 — booking vocabulary, structural transition matrix, and
// calendar read-model schemas (Canon §1–§4; architecture doc §1–§5).
// ---------------------------------------------------------------------------

const VENUE_ID = "00000000-0000-4000-8000-00000000000a";
const SPACE_ID = "00000000-0000-4000-8000-00000000000b";
const OWNER_ID = "00000000-0000-4000-8000-00000000000c";

function validHoldInput(): Record<string, unknown> {
  return {
    venueId: VENUE_ID,
    spaceId: SPACE_ID,
    kind: "hold",
    title: "MacLeod wedding",
    startsAt: "2026-09-19T17:00:00.000Z",
    endsAt: "2026-09-19T23:30:00.000Z",
    rank: 1,
    decisionAt: "2026-08-01T12:00:00.000Z",
    ownerUserId: OWNER_ID,
    nextAction: "Call Fiona MacLeod to confirm the decision date.",
    nextActionDueAt: "2026-07-25T09:00:00.000Z",
  };
}

describe("booking vocabulary", () => {
  it("locks the four commitment kinds (Canon §2.1)", () => {
    expect(BOOKING_KINDS).toEqual(["prospect", "hold", "ink", "internal_block"]);
  });

  it("locks liveness: active plus the four exits (Canon §1)", () => {
    expect(BOOKING_LIVENESS_STATUSES).toEqual([
      "active",
      "released",
      "expired",
      "cancelled",
      "lost",
    ]);
    expect(BOOKING_EXIT_STATES).toEqual(["released", "expired", "cancelled", "lost"]);
  });

  it("derived state vocabulary is kinds followed by exits", () => {
    expect(BOOKING_STATES).toEqual([...BOOKING_KINDS, ...BOOKING_EXIT_STATES]);
  });
});

describe("derived state (kind/status split, architecture §1.1)", () => {
  it("active rows derive to their kind", () => {
    for (const kind of BOOKING_KINDS) {
      expect(deriveBookingState(kind, "active")).toBe(kind);
    }
  });

  it("exited rows derive to their exit status regardless of kind", () => {
    for (const kind of BOOKING_KINDS) {
      for (const exit of BOOKING_EXIT_STATES) {
        expect(deriveBookingState(kind, exit)).toBe(exit);
      }
    }
  });

  it("promotion targets map to an active row of the target kind", () => {
    for (const kind of BOOKING_KINDS) {
      expect(bookingStateToColumns(kind, "prospect")).toEqual({ kind, status: "active" });
    }
  });

  it("exit targets keep the current kind and set the exit status", () => {
    for (const exit of BOOKING_EXIT_STATES) {
      expect(bookingStateToColumns(exit, "hold")).toEqual({ kind: "hold", status: exit });
      expect(bookingStateToColumns(exit, "ink")).toEqual({ kind: "ink", status: exit });
    }
  });

  it("round-trips: columns → state → columns is stable", () => {
    for (const state of BOOKING_STATES) {
      const columns = bookingStateToColumns(state, "hold");
      expect(deriveBookingState(columns.kind, columns.status)).toBe(state);
    }
  });
});

describe("structural transition matrix (Canon §1/§3)", () => {
  const EXPECTED_VALID: ReadonlyArray<readonly [BookingState, BookingState]> = [
    ["prospect", "hold"],
    ["prospect", "ink"],
    ["prospect", "lost"],
    ["hold", "ink"],
    ["hold", "released"],
    ["hold", "expired"],
    ["hold", "lost"],
    ["ink", "cancelled"],
    ["internal_block", "released"],
  ];

  it("permits exactly the Canon lifecycle and nothing else (exhaustive)", () => {
    const allowed = new Set(EXPECTED_VALID.map(([from, to]) => `${from}→${to}`));
    for (const from of BOOKING_STATES) {
      for (const to of BOOKING_STATES) {
        expect(isValidBookingTransition(from, to), `${from}→${to}`).toBe(
          allowed.has(`${from}→${to}`),
        );
      }
    }
  });

  it("every exit state is terminal", () => {
    for (const exit of BOOKING_EXIT_STATES) {
      expect(VALID_BOOKING_TRANSITIONS[exit]).toEqual([]);
    }
  });

  it("ink never downgrades to hold or prospect (cancel and re-book instead)", () => {
    expect(isValidBookingTransition("ink", "hold")).toBe(false);
    expect(isValidBookingTransition("ink", "prospect")).toBe(false);
    expect(isValidBookingTransition("ink", "released")).toBe(false);
  });

  it("nothing transitions into prospect or internal_block", () => {
    for (const from of BOOKING_STATES) {
      expect(isValidBookingTransition(from, "prospect")).toBe(false);
      expect(isValidBookingTransition(from, "internal_block")).toBe(false);
    }
  });
});

describe("CreateBookingSchema — hold hygiene (Canon §3, §17 universal law)", () => {
  it("accepts a fully-hygienic hold", () => {
    const result = CreateBookingSchema.safeParse(validHoldInput());
    expect(result.success).toBe(true);
  });

  it.each(["decisionAt", "ownerUserId", "nextAction", "nextActionDueAt"] as const)(
    "rejects a hold missing %s",
    (field) => {
      const input = Object.fromEntries(
        Object.entries(validHoldInput()).filter(([key]) => key !== field),
      );
      const result = CreateBookingSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.path.includes(field))).toBe(true);
      }
    },
  );

  it("rejects a hold with a whitespace-only next action", () => {
    const input = { ...validHoldInput(), nextAction: "   " };
    expect(CreateBookingSchema.safeParse(input).success).toBe(false);
  });

  it("accepts a prospect without hygiene fields (prospects never block)", () => {
    const result = CreateBookingSchema.safeParse({
      venueId: VENUE_ID,
      spaceId: SPACE_ID,
      kind: "prospect",
      title: "Corporate awards enquiry",
      startsAt: "2026-09-19T17:00:00.000Z",
      endsAt: "2026-09-19T23:30:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("accepts an internal block without hygiene fields", () => {
    const result = CreateBookingSchema.safeParse({
      venueId: VENUE_ID,
      spaceId: SPACE_ID,
      kind: "internal_block",
      title: "Floor maintenance",
      startsAt: "2026-09-21T08:00:00.000Z",
      endsAt: "2026-09-21T12:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects endsAt at or before startsAt", () => {
    const equal = {
      ...validHoldInput(),
      startsAt: "2026-09-19T17:00:00.000Z",
      endsAt: "2026-09-19T17:00:00.000Z",
    };
    expect(CreateBookingSchema.safeParse(equal).success).toBe(false);
  });

  it("rejects a rank on a non-hold (ladder positions belong to holds)", () => {
    const input = {
      venueId: VENUE_ID,
      spaceId: SPACE_ID,
      kind: "ink",
      title: "Chamber dinner",
      startsAt: "2026-09-19T17:00:00.000Z",
      endsAt: "2026-09-19T23:30:00.000Z",
      rank: 1,
    };
    expect(CreateBookingSchema.safeParse(input).success).toBe(false);
  });

  it("rejects rank zero and negative ranks", () => {
    expect(CreateBookingSchema.safeParse({ ...validHoldInput(), rank: 0 }).success).toBe(false);
    expect(CreateBookingSchema.safeParse({ ...validHoldInput(), rank: -2 }).success).toBe(false);
  });

  it("rejects an unknown kind", () => {
    const input = { ...validHoldInput(), kind: "pencilled" };
    expect(CreateBookingSchema.safeParse(input).success).toBe(false);
  });
});

describe("UpdateBookingSchema", () => {
  it("accepts a partial time move", () => {
    const result = UpdateBookingSchema.safeParse({
      startsAt: "2026-09-19T18:00:00.000Z",
      endsAt: "2026-09-20T00:30:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a cross-lane move (spaceId change) — the Board's room reassignment", () => {
    expect(UpdateBookingSchema.safeParse({ spaceId: SPACE_ID }).success).toBe(true);
    expect(
      UpdateBookingSchema.safeParse({
        spaceId: SPACE_ID,
        startsAt: "2026-09-19T18:00:00.000Z",
        endsAt: "2026-09-20T00:30:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("rejects clearing or malforming the space — a booking always occupies a room", () => {
    expect(UpdateBookingSchema.safeParse({ spaceId: null }).success).toBe(false);
    expect(UpdateBookingSchema.safeParse({ spaceId: "not-a-uuid" }).success).toBe(false);
  });

  it("rejects kind or status changes through the edit surface", () => {
    expect(UpdateBookingSchema.safeParse({ kind: "ink" }).success).toBe(false);
    expect(UpdateBookingSchema.safeParse({ status: "released" }).success).toBe(false);
  });

  it("rejects stripping hygiene fields to null", () => {
    expect(UpdateBookingSchema.safeParse({ decisionAt: null }).success).toBe(false);
    expect(UpdateBookingSchema.safeParse({ nextAction: null }).success).toBe(false);
  });

  it("rejects an inverted time window when both bounds are supplied", () => {
    const result = UpdateBookingSchema.safeParse({
      startsAt: "2026-09-20T01:00:00.000Z",
      endsAt: "2026-09-19T23:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });
});

describe("TransitionBookingSchema", () => {
  it("accepts a target state with an optional note", () => {
    expect(TransitionBookingSchema.safeParse({ toState: "ink" }).success).toBe(true);
    expect(
      TransitionBookingSchema.safeParse({ toState: "released", note: "Client chose Òran Mór" })
        .success,
    ).toBe(true);
  });

  it("rejects vocabulary outside the state list", () => {
    expect(TransitionBookingSchema.safeParse({ toState: "confirmed" }).success).toBe(false);
  });
});

describe("BookingSchema serialization contract", () => {
  it("parses a serialized hold with derived state", () => {
    const result = BookingSchema.safeParse({
      id: "00000000-0000-4000-8000-000000000001",
      venueId: VENUE_ID,
      spaceId: SPACE_ID,
      eventId: null,
      kind: "hold",
      status: "active",
      state: "hold",
      title: "MacLeod wedding",
      eventType: "wedding",
      startsAt: "2026-09-19T17:00:00.000Z",
      endsAt: "2026-09-19T23:30:00.000Z",
      rank: 1,
      jointFlag: false,
      decisionAt: "2026-08-01T12:00:00.000Z",
      ownerUserId: OWNER_ID,
      nextAction: "Call Fiona MacLeod to confirm the decision date.",
      nextActionDueAt: "2026-07-25T09:00:00.000Z",
      seriesId: null,
      notes: null,
      createdBy: null,
      enquiryId: null,
      createdAt: "2026-07-11T10:00:00.000Z",
      updatedAt: "2026-07-11T10:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });
});

describe("ConvertEnquirySchema — enquiry→hold (T-496)", () => {
  function validConvertInput(): Record<string, unknown> {
    return {
      enquiryId: "00000000-0000-4000-8000-0000000000e1",
      startsAt: "2026-09-19T17:00:00.000Z",
      endsAt: "2026-09-19T23:30:00.000Z",
      rank: 2,
      decisionAt: "2026-08-01T12:00:00.000Z",
      ownerUserId: OWNER_ID,
      nextAction: "Send the welcome pack and confirm the decision date.",
      nextActionDueAt: "2026-07-25T09:00:00.000Z",
    };
  }

  it("accepts a hygienic conversion with optional overrides", async () => {
    const { ConvertEnquirySchema } = await import("../booking.js");
    expect(ConvertEnquirySchema.safeParse(validConvertInput()).success).toBe(true);
    expect(
      ConvertEnquirySchema.safeParse({
        ...validConvertInput(),
        spaceId: SPACE_ID,
        title: "MacLeod wedding",
        eventType: "wedding",
      }).success,
    ).toBe(true);
  });

  it.each(["decisionAt", "ownerUserId", "nextAction", "nextActionDueAt"] as const)(
    "requires hold hygiene unconditionally — missing %s rejects",
    async (field) => {
      const { ConvertEnquirySchema } = await import("../booking.js");
      const input = Object.fromEntries(
        Object.entries(validConvertInput()).filter(([key]) => key !== field),
      );
      const result = ConvertEnquirySchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.path.includes(field))).toBe(true);
      }
    },
  );

  it("rejects an inverted window", async () => {
    const { ConvertEnquirySchema } = await import("../booking.js");
    expect(
      ConvertEnquirySchema.safeParse({
        ...validConvertInput(),
        startsAt: "2026-09-19T23:30:00.000Z",
        endsAt: "2026-09-19T17:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});

describe("TurnaroundRuleSchema", () => {
  it("parses a venue-wide rule (null space, null event type)", () => {
    const result = TurnaroundRuleSchema.safeParse({
      id: "00000000-0000-4000-8000-000000000002",
      venueId: VENUE_ID,
      spaceId: null,
      eventType: null,
      name: "House default turnaround",
      minutes: 90,
      isActive: true,
      createdAt: "2026-07-11T10:00:00.000Z",
      updatedAt: "2026-07-11T10:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects negative minutes", () => {
    const result = TurnaroundRuleSchema.safeParse({
      id: "00000000-0000-4000-8000-000000000002",
      venueId: VENUE_ID,
      spaceId: null,
      eventType: null,
      name: "Broken rule",
      minutes: -15,
      isActive: true,
      createdAt: "2026-07-11T10:00:00.000Z",
      updatedAt: "2026-07-11T10:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });
});

describe("CalendarQuerySchema", () => {
  it("accepts a venue-scoped range with optional space filter", () => {
    const result = CalendarQuerySchema.safeParse({
      venueId: VENUE_ID,
      from: "2026-09-14T00:00:00.000Z",
      to: "2026-09-21T00:00:00.000Z",
      spaceIds: [SPACE_ID],
    });
    expect(result.success).toBe(true);
  });

  it("rejects from at or after to", () => {
    expect(
      CalendarQuerySchema.safeParse({
        venueId: VENUE_ID,
        from: "2026-09-21T00:00:00.000Z",
        to: "2026-09-14T00:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      CalendarQuerySchema.safeParse({
        venueId: VENUE_ID,
        from: "2026-09-14T00:00:00.000Z",
        to: "2026-09-14T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it(`rejects a range longer than ${String(MAX_CALENDAR_RANGE_DAYS)} days`, () => {
    expect(
      CalendarQuerySchema.safeParse({
        venueId: VENUE_ID,
        from: "2026-01-01T00:00:00.000Z",
        to: "2027-01-03T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});

describe("Calendar entries and conflicts", () => {
  it("parses a booking entry and a phase entry through the discriminated union", () => {
    const booking = CalendarEntrySchema.safeParse({
      entryType: "booking",
      id: "00000000-0000-4000-8000-000000000003",
      spaceId: SPACE_ID,
      kind: "ink",
      status: "active",
      state: "ink",
      title: "Chamber dinner",
      eventType: "dinner",
      startsAt: "2026-09-18T18:00:00.000Z",
      endsAt: "2026-09-18T23:00:00.000Z",
      rank: null,
      jointFlag: false,
      decisionAt: null,
      ownerUserId: null,
      nextAction: null,
      nextActionDueAt: null,
      eventId: null,
      seriesId: null,
    });
    expect(booking.success).toBe(true);

    const phase = CalendarEntrySchema.safeParse({
      entryType: "phase",
      id: "00000000-0000-4000-8000-000000000004",
      spaceId: SPACE_ID,
      eventId: "00000000-0000-4000-8000-000000000005",
      eventName: "Chamber dinner",
      name: "Setup",
      startsAt: "2026-09-18T15:00:00.000Z",
      endsAt: "2026-09-18T18:00:00.000Z",
      sortOrder: 0,
    });
    expect(phase.success).toBe(true);
  });

  it("rejects an unknown entry type", () => {
    expect(
      CalendarEntrySchema.safeParse({ entryType: "note", id: "x" }).success,
    ).toBe(false);
  });

  it("parses a conflict with severity vocabulary and explanation", () => {
    const result = CalendarConflictSchema.safeParse({
      id: "ink_double_book:a:b",
      type: "ink_double_book",
      severity: "blocking",
      spaceId: SPACE_ID,
      entryIds: ["a", "b"],
      explanation:
        "Two confirmed bookings overlap in the Grand Hall — planning support only, human review required.",
    });
    expect(result.success).toBe(true);
  });

  it("conflict report checks never claim OK for unchecked turnaround pairs", () => {
    const report = ConflictReportSchema.safeParse({
      conflicts: [],
      checks: {
        inkDoubleBook: { status: "checked" },
        holdOverlap: { status: "checked" },
        turnaround: {
          status: "not_checked",
          uncoveredPairCount: 3,
          detail: "No active turnaround rule covers these spaces yet.",
        },
      },
    });
    expect(report.success).toBe(true);

    const invalid = ConflictReportSchema.safeParse({
      conflicts: [],
      checks: {
        inkDoubleBook: { status: "checked" },
        holdOverlap: { status: "checked" },
        turnaround: { status: "ok", uncoveredPairCount: 0, detail: "" },
      },
    });
    expect(invalid.success).toBe(false);
  });

  it("parses a full calendar response", () => {
    const result = CalendarResponseSchema.safeParse({
      venueId: VENUE_ID,
      range: { from: "2026-09-14T00:00:00.000Z", to: "2026-09-21T00:00:00.000Z" },
      rooms: [{ id: SPACE_ID, name: "Grand Hall", slug: "grand-hall", sortOrder: 0 }],
      entries: [],
      conflicts: {
        conflicts: [],
        checks: {
          inkDoubleBook: { status: "checked" },
          holdOverlap: { status: "checked" },
          turnaround: { status: "checked", uncoveredPairCount: 0, detail: "All gaps covered." },
        },
      },
    });
    expect(result.success).toBe(true);
  });
});
