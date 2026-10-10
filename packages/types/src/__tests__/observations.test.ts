import { describe, expect, it } from "vitest";
import {
  OBSERVATION_KINDS,
  ObservationListQuerySchema,
  RecordObservationSchema,
  SlotObservationSchema,
  describeObservationKind,
  latestObservation,
  nextObservationKinds,
  observationMeansInUse,
  observationMeansOver,
} from "../observations.js";

// ---------------------------------------------------------------------------
// Goal 19 S5 — observations are facts, not edits (D1).
//
// Held here before any route exists: the vocabulary, that a tap carries no
// time for the booking, the latest-wins rule that makes arrival order
// irrelevant, and the verbs a slab offers from each fact.
// ---------------------------------------------------------------------------

const BOOKING = "00000000-0000-4000-8000-00000000d001";
const KEY = "00000000-0000-4000-8000-00000000d002";
const VENUE = "00000000-0000-4000-8000-00000000d003";

describe("observation vocabulary", () => {
  it("runs in the order a room's day runs", () => {
    expect(OBSERVATION_KINDS).toEqual(["set", "doors-open", "live", "flipping", "done", "cleaned"]);
  });

  it("gives every kind words, and says which mean in use and which mean over", () => {
    expect(OBSERVATION_KINDS.map(describeObservationKind)).toEqual([
      "Room set", "Doors open", "Live", "Flipping", "Done", "Cleaned",
    ]);
    expect(OBSERVATION_KINDS.filter(observationMeansInUse)).toEqual(["doors-open", "live", "flipping"]);
    expect(OBSERVATION_KINDS.filter(observationMeansOver)).toEqual(["done", "cleaned"]);
  });

  it("offers the next facts from each; cleaned is terminal", () => {
    expect(nextObservationKinds(null)).toEqual(["set", "doors-open", "live"]);
    expect(nextObservationKinds("set")).toEqual(["doors-open", "live", "done"]);
    expect(nextObservationKinds("doors-open")).toEqual(["live", "done"]);
    expect(nextObservationKinds("live")).toEqual(["flipping", "done"]);
    expect(nextObservationKinds("flipping")).toEqual(["set", "live", "done"]);
    expect(nextObservationKinds("done")).toEqual(["cleaned"]);
    expect(nextObservationKinds("cleaned")).toEqual([]);
  });
});

describe("RecordObservationSchema", () => {
  const tap = { bookingId: BOOKING, kind: "doors-open", observedAt: "2026-10-10T18:52:00.000Z", idempotencyKey: KEY };

  it("accepts one tap with its own time and key", () => {
    expect(RecordObservationSchema.parse(tap)).toEqual(tap);
  });

  it("rejects a tap that tries to carry a time for the booking", () => {
    expect(RecordObservationSchema.safeParse({ ...tap, startsAt: "2026-10-10T19:00:00.000Z" }).success).toBe(false);
    expect(RecordObservationSchema.safeParse({ ...tap, endsAt: "2026-10-10T23:00:00.000Z" }).success).toBe(false);
    expect(RecordObservationSchema.safeParse({ ...tap, quantity: 10 }).success).toBe(false);
  });

  it("rejects an unknown kind, a bare date and a non-uuid key", () => {
    expect(RecordObservationSchema.safeParse({ ...tap, kind: "started" }).success).toBe(false);
    expect(RecordObservationSchema.safeParse({ ...tap, observedAt: "2026-10-10" }).success).toBe(false);
    expect(RecordObservationSchema.safeParse({ ...tap, idempotencyKey: "tap-1" }).success).toBe(false);
  });
});

describe("SlotObservationSchema and the list query", () => {
  it("parses the fact the API serialises", () => {
    const fact = SlotObservationSchema.parse({
      id: KEY,
      venueId: VENUE,
      bookingId: BOOKING,
      spaceId: null,
      kind: "set",
      observedAt: "2026-10-10T17:40:00.000Z",
      recordedAt: "2026-10-10T18:30:00.000Z",
      actorUserId: null,
      actorName: "Elaine",
      actorRole: "hallkeeper",
      idempotencyKey: KEY,
    });
    expect(fact.kind).toBe("set");
    expect(Date.parse(fact.recordedAt)).toBeGreaterThan(Date.parse(fact.observedAt));
  });

  it("wants a window that runs forwards", () => {
    expect(ObservationListQuerySchema.safeParse({ from: "2026-10-10T04:00:00.000Z", to: "2026-10-11T04:00:00.000Z" }).success).toBe(true);
    expect(ObservationListQuerySchema.safeParse({ from: "2026-10-11T04:00:00.000Z", to: "2026-10-10T04:00:00.000Z" }).success).toBe(false);
    expect(ObservationListQuerySchema.safeParse({ from: "2026-10-10T04:00:00.000Z" }).success).toBe(false);
  });
});

describe("latestObservation", () => {
  const set = { kind: "set" as const, observedAt: "2026-10-10T17:40:00.000Z", recordedAt: "2026-10-10T17:40:01.000Z" };
  const doors = { kind: "doors-open" as const, observedAt: "2026-10-10T18:52:00.000Z", recordedAt: "2026-10-10T19:30:00.000Z" };
  const live = { kind: "live" as const, observedAt: "2026-10-10T19:05:00.000Z", recordedAt: "2026-10-10T19:05:01.000Z" };

  it("is null with nothing observed", () => {
    expect(latestObservation([])).toBeNull();
  });

  it("reads the latest by the hallkeeper's time, whatever order the facts arrived", () => {
    // doors-open was recorded last (an offline phone replaying) but observed
    // before live: the room is live.
    expect(latestObservation([set, live, doors])?.kind).toBe("live");
    expect(latestObservation([doors, set, live])?.kind).toBe("live");
    expect(latestObservation([live, doors, set])?.kind).toBe("live");
  });

  it("breaks a same-instant tie by the server's time, then by the kind furthest along", () => {
    const doneAtSix = { kind: "done" as const, observedAt: "2026-10-10T23:00:00.000Z", recordedAt: "2026-10-10T23:00:02.000Z" };
    const cleanedAtSix = { kind: "cleaned" as const, observedAt: "2026-10-10T23:00:00.000Z", recordedAt: "2026-10-10T23:00:09.000Z" };
    expect(latestObservation([cleanedAtSix, doneAtSix])?.kind).toBe("cleaned");
    const liveNoRecord = { kind: "live" as const, observedAt: "2026-10-10T23:00:00.000Z" };
    const doneNoRecord = { kind: "done" as const, observedAt: "2026-10-10T23:00:00.000Z" };
    expect(latestObservation([liveNoRecord, doneNoRecord])?.kind).toBe("done");
    expect(latestObservation([doneNoRecord, liveNoRecord])?.kind).toBe("done");
  });

  it("lets a flip start the run again: live, flipping, set, live reads live", () => {
    const flipping = { kind: "flipping" as const, observedAt: "2026-10-10T20:00:00.000Z" };
    const reset = { kind: "set" as const, observedAt: "2026-10-10T20:25:00.000Z" };
    const liveAgain = { kind: "live" as const, observedAt: "2026-10-10T20:40:00.000Z" };
    expect(latestObservation([live, flipping, reset])?.kind).toBe("set");
    expect(latestObservation([liveAgain, live, flipping, reset])?.kind).toBe("live");
  });
});
