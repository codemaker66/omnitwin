import { describe, expect, it } from "vitest";
import {
  BOOKING_KINDS,
  BOOKING_LIVENESS_STATUSES,
  VALID_BOOKING_TRANSITIONS,
  bookingStateToColumns,
  deriveBookingState,
  type BookingKind,
  type BookingLiveness,
  type BookingState,
} from "../booking.js";
import { EVENT_STATUSES, type EventStatus } from "../event-phase-graph.js";
import {
  EMPTY_EVENT_BOOKING_SUMMARY,
  EVENT_CONFIRMED_STATUSES,
  EVENT_ENDED_STATUSES,
  EVENT_PIPELINE_STATUSES,
  bookingKindNeedsEvent,
  deriveEventStatus,
  diarySpeaksForEvent,
  eventStatusAgreesWithDiary,
  isConfirmedEventStatus,
  isEndedEventStatus,
  isPipelineEventStatus,
  summariseEventBookings,
  type EventBookingFacts,
} from "../event-binding.js";

// ---------------------------------------------------------------------------
// The bind's status rule (event-spine Phase A). Three kinds of evidence:
//  1. the written derivation table, row by row;
//  2. an exhaustive property over every booking state the database can hold
//     (any kind with any liveness, deleted or not, because an admin may
//     override the transition structure), up to three bookings per event and
//     every status the event could carry before;
//  3. seeded random walks through the real transition matrix, re-deriving
//     after every step as the API does, so the rule is checked along the
//     paths a Diary actually takes, not only at isolated points.
// ---------------------------------------------------------------------------

function booking(kind: BookingKind, status: BookingLiveness = "active", deleted = false): EventBookingFacts {
  return { kind, status, deletedAt: deleted ? "2026-10-16T10:00:00.000Z" : null };
}

function derive(current: EventStatus, rows: readonly EventBookingFacts[]): EventStatus {
  return deriveEventStatus(current, summariseEventBookings(rows));
}

describe("which bookings must belong to an event", () => {
  it("binds provisional options and confirmed bookings, never interest or the venue's own blocks", () => {
    expect(BOOKING_KINDS.filter(bookingKindNeedsEvent)).toEqual(["hold", "ink"]);
  });
});

describe("the event status vocabulary splits cleanly", () => {
  it("puts every status in exactly one of pipeline, confirmed or ended", () => {
    for (const status of EVENT_STATUSES) {
      const memberships = [isPipelineEventStatus(status), isConfirmedEventStatus(status), isEndedEventStatus(status)]
        .filter(Boolean).length;
      expect(memberships, status).toBe(1);
    }
    expect([...EVENT_PIPELINE_STATUSES, ...EVENT_CONFIRMED_STATUSES, ...EVENT_ENDED_STATUSES].sort())
      .toEqual([...EVENT_STATUSES].sort());
  });
});

describe("the derivation table, row by row", () => {
  it("a live confirmed booking makes the event confirmed", () => {
    expect(derive("draft", [booking("ink")])).toBe("confirmed");
    expect(derive("proposed", [booking("ink"), booking("hold")])).toBe("confirmed");
    expect(derive("lost", [booking("ink")])).toBe("confirmed");
    expect(derive("cancelled", [booking("ink")])).toBe("confirmed");
  });

  it("keeps the later step people recorded while the confirmed booking is live", () => {
    for (const status of ["in_planning", "ready_for_ops", "executed", "closed"] as const) {
      expect(derive(status, [booking("ink")])).toBe(status);
    }
  });

  it("only options or interest live: draft, or proposed when a proposal was recorded", () => {
    expect(derive("draft", [booking("hold")])).toBe("draft");
    expect(derive("proposed", [booking("hold")])).toBe("proposed");
    expect(derive("proposed", [booking("prospect")])).toBe("proposed");
    // The confirmed booking was cancelled but a provisional option stands.
    expect(derive("in_planning", [booking("ink", "cancelled"), booking("hold")])).toBe("draft");
    // A lost event revives when the same enquiry is held again.
    expect(derive("lost", [booking("hold", "released"), booking("hold")])).toBe("draft");
  });

  it("nothing live after a confirmed booking was cancelled: cancelled", () => {
    expect(derive("confirmed", [booking("ink", "cancelled")])).toBe("cancelled");
    expect(derive("ready_for_ops", [booking("ink", "cancelled"), booking("hold", "released")])).toBe("cancelled");
  });

  it("every option released, lapsed or lost and none confirmed: lost", () => {
    for (const exit of ["released", "expired", "lost"] as const) {
      expect(derive("draft", [booking("hold", exit)]), exit).toBe("lost");
      expect(derive("proposed", [booking("hold", exit), booking("prospect", "lost")]), exit).toBe("lost");
    }
  });

  it("leaves an event alone when the Diary holds nothing for it", () => {
    for (const status of EVENT_STATUSES) {
      expect(derive(status, [])).toBe(status);
      // Soft-deleted rows and the venue's own blocks are not evidence.
      expect(derive(status, [booking("ink", "active", true), booking("internal_block")])).toBe(status);
    }
    expect(diarySpeaksForEvent(EMPTY_EVENT_BOOKING_SUMMARY)).toBe(false);
  });

  it("refuses a status the Diary would change straight back", () => {
    const heldOnly = summariseEventBookings([booking("hold")]);
    expect(eventStatusAgreesWithDiary("proposed", heldOnly)).toBe(true);
    expect(eventStatusAgreesWithDiary("confirmed", heldOnly)).toBe(false);
    const inked = summariseEventBookings([booking("ink")]);
    expect(eventStatusAgreesWithDiary("ready_for_ops", inked)).toBe(true);
    expect(eventStatusAgreesWithDiary("draft", inked)).toBe(false);
    expect(eventStatusAgreesWithDiary("cancelled", EMPTY_EVENT_BOOKING_SUMMARY)).toBe(true);
  });
});

// --- 2. exhaustive property ------------------------------------------------

const ALL_FACTS: readonly EventBookingFacts[] = BOOKING_KINDS.flatMap((kind) =>
  BOOKING_LIVENESS_STATUSES.flatMap((status) => [booking(kind, status), booking(kind, status, true)]));

/** Every multiset of up to `size` facts, each once (combinations with repetition). */
function* multisets(size: number, start = 0, prefix: readonly EventBookingFacts[] = []): Generator<readonly EventBookingFacts[]> {
  yield prefix;
  if (size === 0) return;
  for (let index = start; index < ALL_FACTS.length; index += 1) {
    const fact = ALL_FACTS[index];
    if (fact !== undefined) yield* multisets(size - 1, index, [...prefix, fact]);
  }
}

/** The contradiction, stated from the bookings alone (not from the rule). */
function contradiction(status: EventStatus, rows: readonly EventBookingFacts[]): string | null {
  const counted = rows.filter((row) => row.deletedAt === null);
  const live = (kind: BookingKind) => counted.some((row) => row.kind === kind && row.status === "active");
  const ended = (kind: BookingKind) => counted.some((row) => row.kind === kind && row.status !== "active");
  if (live("ink")) {
    return isConfirmedEventStatus(status) ? null : "a live confirmed booking under an unconfirmed event";
  }
  if (isConfirmedEventStatus(status) && (live("hold") || live("prospect") || ended("ink") || ended("hold"))) {
    return "a confirmed event with no live confirmed booking";
  }
  if (live("hold") || live("prospect")) {
    return isPipelineEventStatus(status) ? null : "live options under an event that is not in the pipeline";
  }
  if (ended("ink")) return status === "cancelled" ? null : "a cancelled booking's event still open";
  if (ended("hold")) return status === "lost" ? null : "every option gone, event still open";
  return null;
}

describe("no reachable booking state leaves a contradicting event", () => {
  it("holds for every combination of up to three bookings and every prior status", () => {
    let checked = 0;
    for (const rows of multisets(3)) {
      for (const before of EVENT_STATUSES) {
        const after = derive(before, rows);
        const problem = contradiction(after, rows);
        if (problem !== null) {
          throw new Error(`${problem}: ${before} -> ${after} for ${JSON.stringify(rows)}`);
        }
        // Idempotent: deriving again changes nothing.
        expect(derive(after, rows)).toBe(after);
        // A status that already agrees is kept: people's recorded steps survive.
        if (contradiction(before, rows) === null && diarySpeaksForEvent(summariseEventBookings(rows))) {
          expect(after).toBe(before);
        }
        checked += 1;
      }
    }
    // 40 facts, up to three of them, nine prior statuses.
    expect(checked).toBe((1 + 40 + 820 + 11480) * EVENT_STATUSES.length);
  });

  it("ignores the order the bookings are read in", () => {
    for (const rows of multisets(3)) {
      const reversed = [...rows].reverse();
      for (const before of EVENT_STATUSES) {
        expect(derive(before, reversed)).toBe(derive(before, rows));
      }
    }
  });
});

// --- 3. random walks through the transition matrix --------------------------

/** Deterministic PRNG (mulberry32) so a failure reproduces from its seed. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface WalkBooking { kind: BookingKind; status: BookingLiveness; deletedAt: string | null }

describe("re-deriving after every Diary step never leaves a contradiction", () => {
  it("holds along 2,000 seeded walks of the real transition matrix", () => {
    const creations: readonly BookingKind[] = ["prospect", "hold", "ink"];
    const exits: readonly BookingState[] = ["released", "expired", "cancelled", "lost"];
    for (let seed = 1; seed <= 2000; seed += 1) {
      const random = prng(seed);
      const pick = <T>(values: readonly T[]): T => {
        const value = values[Math.floor(random() * values.length)];
        if (value === undefined) throw new Error("empty choice");
        return value;
      };
      // The event is born with its first option or confirmed booking.
      const rows: WalkBooking[] = [{ kind: pick(["hold", "ink"] as const), status: "active", deletedAt: null }];
      let status = derive("draft", rows);
      for (let step = 0; step < 12; step += 1) {
        const roll = random();
        if (roll < 0.25 && rows.length < 4) {
          rows.push({ kind: pick(creations), status: "active", deletedAt: null });
        } else if (roll < 0.35) {
          // People record a step the Diary agrees with, as the API allows.
          const wanted = pick(EVENT_STATUSES);
          if (eventStatusAgreesWithDiary(wanted, summariseEventBookings(rows))) status = wanted;
        } else {
          const target = pick(rows);
          const from = deriveBookingState(target.kind, target.status);
          // An admin may override structure (booking-mutations.ts), so a
          // tenth of the moves leave the matrix.
          const allowed = random() < 0.1 ? [...creations, ...exits] : VALID_BOOKING_TRANSITIONS[from];
          if (allowed.length === 0) continue;
          const columns = bookingStateToColumns(pick(allowed), target.kind);
          target.kind = columns.kind;
          target.status = columns.status;
        }
        status = derive(status, rows);
        const problem = contradiction(status, rows);
        if (problem !== null) throw new Error(`seed ${String(seed)} step ${String(step)}: ${problem}`);
      }
    }
  });
});
