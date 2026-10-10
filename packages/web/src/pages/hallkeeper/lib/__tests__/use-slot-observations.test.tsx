import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordObservation } from "@omnitwin/types";
import type { QueuedEventDayOp, EventDayOpOutcome } from "../../../../lib/event-day-offline-queue.js";
import type { RequestsLiveEvent } from "../../../../lib/requests-live.js";
import { ApiError } from "../../../../api/client.js";

// ---------------------------------------------------------------------------
// The board's facts hook (goal 19 S5; D10, D12) — tests written FIRST.
//
// The day's facts are read on mount and again when a fact lands in the
// venue; a tap goes to the server at once with its own key and the
// corrected clock's time; when the connection fails the fact stands on the
// screen with that time and waits in the queue, which drains on reconnect
// with the same key; a fact the server refuses is reported, not queued.
// ---------------------------------------------------------------------------

const VENUE = "00000000-0000-4000-8000-000000000001";
const BOOKING = "00000000-0000-4000-8000-0000000000b1";
const RANGE = { fromMs: Date.parse("2026-10-10T04:00:00.000Z"), toMs: Date.parse("2026-10-11T04:00:00.000Z") };

const seams = vi.hoisted(() => {
  const queued: QueuedEventDayOp[] = [];
  const live: { listener: ((event: RequestsLiveEvent) => void) | null } = { listener: null };
  return {
    queued,
    live,
    listVenueObservations: vi.fn(),
    recordVenueObservation: vi.fn(),
  };
});

vi.mock("../../../../api/observations.js", () => ({
  listVenueObservations: (...args: unknown[]) => seams.listVenueObservations(...args) as unknown,
  recordVenueObservation: (...args: unknown[]) => seams.recordVenueObservation(...args) as unknown,
}));

vi.mock("../../../../lib/requests-live.js", () => ({
  subscribeRequestsLive: (listener: (event: RequestsLiveEvent) => void) => {
    seams.live.listener = listener;
    return () => { seams.live.listener = null; };
  },
}));

vi.mock("../../../../lib/event-day-offline-queue.js", () => ({
  enqueueEventDayObservation: (venueId: string, input: RecordObservation) => {
    seams.queued.push({
      kind: "observation_record",
      queueKey: `observation:${input.idempotencyKey}`,
      venueId,
      input,
      queuedAt: new Date().toISOString(),
    });
    return Promise.resolve();
  },
  listPendingEventDayOps: () => Promise.resolve([...seams.queued]),
  drainEventDayOps: async (perform: (op: QueuedEventDayOp) => Promise<EventDayOpOutcome>) => {
    const acked: QueuedEventDayOp[] = [];
    for (const op of [...seams.queued]) {
      let outcome: EventDayOpOutcome;
      try {
        outcome = await perform(op);
      } catch {
        break;
      }
      if (outcome === "left") continue;
      seams.queued.splice(seams.queued.indexOf(op), 1);
      acked.push(op);
    }
    return acked;
  },
}));

import { useSlotObservations } from "../use-slot-observations.js";

function fact(kind: "set" | "doors-open" | "live", observedAt: string, idempotencyKey: string = crypto.randomUUID()) {
  return {
    id: crypto.randomUUID(),
    venueId: VENUE,
    bookingId: BOOKING,
    spaceId: null,
    kind,
    observedAt,
    recordedAt: observedAt,
    actorUserId: null,
    actorName: "Elaine",
    actorRole: "hallkeeper",
    idempotencyKey,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

describe("useSlotObservations", () => {
  beforeEach(() => {
    seams.queued.length = 0;
    seams.live.listener = null;
    seams.listVenueObservations.mockReset();
    seams.recordVenueObservation.mockReset();
    seams.listVenueObservations.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads the day's facts on mount, and again when a fact lands in the venue", async () => {
    seams.listVenueObservations.mockResolvedValue([fact("set", "2026-10-10T17:40:00.000Z")]);
    const { result } = renderHook(() => useSlotObservations(VENUE, RANGE, true, "Elaine"));
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    expect(result.current.observations.map((row) => row.kind)).toEqual(["set"]);
    expect(seams.listVenueObservations).toHaveBeenCalledWith(VENUE, RANGE);
    const before = seams.listVenueObservations.mock.calls.length;

    seams.listVenueObservations.mockResolvedValue([fact("set", "2026-10-10T17:40:00.000Z"), fact("doors-open", "2026-10-10T18:52:00.000Z")]);
    act(() => { seams.live.listener?.({ kind: "observation", venueId: VENUE, bookingId: BOOKING }); });
    await waitFor(() => { expect(result.current.observations).toHaveLength(2); });
    expect(seams.listVenueObservations.mock.calls.length).toBeGreaterThan(before);
    // Another venue's fact is not this board's business.
    const after = seams.listVenueObservations.mock.calls.length;
    act(() => { seams.live.listener?.({ kind: "observation", venueId: "elsewhere", bookingId: BOOKING }); });
    await new Promise((resolve) => { setTimeout(resolve, 200); });
    expect(seams.listVenueObservations.mock.calls.length).toBe(after);
  });

  it("sends a tap at once with its own key and the clock's time, and keeps the server's fact", async () => {
    seams.recordVenueObservation.mockImplementation((_venueId: unknown, input: { kind: "doors-open"; idempotencyKey: string; observedAt: string }) =>
      Promise.resolve(fact(input.kind, input.observedAt, input.idempotencyKey)));
    const { result } = renderHook(() => useSlotObservations(VENUE, RANGE, true, "Elaine"));
    await waitFor(() => { expect(result.current.status).toBe("ready"); });

    let outcome: string | null = null;
    await act(async () => { outcome = await result.current.record(BOOKING, "doors-open"); });
    expect(outcome).toBe("sent");
    const [venueId, input] = seams.recordVenueObservation.mock.calls[0] as [string, { bookingId: string; kind: string; observedAt: string; idempotencyKey: string }];
    expect(venueId).toBe(VENUE);
    expect(input.bookingId).toBe(BOOKING);
    expect(input.kind).toBe("doors-open");
    expect(input.idempotencyKey).toMatch(UUID);
    expect(Math.abs(Date.parse(input.observedAt) - Date.now())).toBeLessThan(5_000);
    expect(result.current.observations.map((row) => row.kind)).toEqual(["doors-open"]);
    expect(result.current.pendingCount).toBe(0);
  });

  it("queues a tap when the connection fails, keeps the fact on screen, and drains it on reconnect with the same key", async () => {
    seams.recordVenueObservation.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { result } = renderHook(() => useSlotObservations(VENUE, RANGE, true, "Elaine"));
    await waitFor(() => { expect(result.current.status).toBe("ready"); });

    let outcome: string | null = null;
    await act(async () => { outcome = await result.current.record(BOOKING, "live"); });
    expect(outcome).toBe("queued");
    expect(result.current.pendingCount).toBe(1);
    expect(result.current.observations).toHaveLength(1);
    const standing = result.current.observations[0];
    expect(standing?.kind).toBe("live");
    expect(standing?.actorName).toBe("Elaine");
    const key = standing?.idempotencyKey ?? "";
    expect(key).toMatch(UUID);

    // The connection returns: the queue replays the same tap, same key.
    seams.recordVenueObservation.mockImplementation((_venueId: unknown, input: { kind: "live"; observedAt: string; idempotencyKey: string }) =>
      Promise.resolve(fact(input.kind, input.observedAt, input.idempotencyKey)));
    seams.listVenueObservations.mockResolvedValue([fact("live", standing?.observedAt ?? "", key)]);
    act(() => { seams.live.listener?.({ kind: "reconnected" }); });
    await waitFor(() => { expect(result.current.pendingCount).toBe(0); });
    const replayed = seams.recordVenueObservation.mock.calls.at(-1) as [string, { idempotencyKey: string; observedAt: string }];
    expect(replayed[1].idempotencyKey).toBe(key);
    expect(replayed[1].observedAt).toBe(standing?.observedAt);
    expect(seams.queued).toHaveLength(0);
  });

  it("reports a tap the server refuses and queues nothing", async () => {
    seams.recordVenueObservation.mockRejectedValueOnce(new ApiError(400, "An observation cannot be ahead of the clock.", "OBSERVED_IN_FUTURE"));
    const { result } = renderHook(() => useSlotObservations(VENUE, RANGE, true, "Elaine"));
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    await expect(result.current.record(BOOKING, "done")).rejects.toThrow("ahead of the clock");
    expect(seams.queued).toHaveLength(0);
    expect(result.current.pendingCount).toBe(0);
  });

  it("is inert for a screen that cannot read the board", async () => {
    const { result } = renderHook(() => useSlotObservations(VENUE, RANGE, false, ""));
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    expect(seams.listVenueObservations).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
    await expect(result.current.record(BOOKING, "set")).rejects.toThrow("cannot record");
  });
});
