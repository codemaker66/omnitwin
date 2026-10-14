import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ObservationKind, RecordObservation, SlotObservation } from "@omnitwin/types";
import type { EventDayOpOutcome, QueuedEventDayOp } from "../../../../lib/event-day-offline-queue.js";
import type { RequestsLiveEvent } from "../../../../lib/requests-live.js";
import { ApiError } from "../../../../api/client.js";

// ---------------------------------------------------------------------------
// The board's facts hook (goal 19 S5; D10, D12) — tests written FIRST.
//
// The day's facts are read once on mount and again when a fact lands in the
// venue, never because the page handed over an equal range in a new object;
// a tap goes to the server at once with its own key and the corrected
// clock's time and stands on the screen until the server lists it; when the
// connection fails the fact stands with that time and waits in the queue,
// through any refetch, and the queue drains on reconnect or online with the
// same key; a tap the server refuses for good leaves the queue, one the
// server could not be asked to keep stays; a refused live tap is reported,
// not queued; the state of the day's read is told honestly.
// ---------------------------------------------------------------------------

const VENUE = "00000000-0000-4000-8000-000000000001";
const OTHER_VENUE = "00000000-0000-4000-8000-000000000002";
const BOOKING = "00000000-0000-4000-8000-0000000000b1";
const OTHER_BOOKING = "00000000-0000-4000-8000-0000000000b2";
const RANGE = { fromMs: Date.parse("2026-10-10T04:00:00.000Z"), toMs: Date.parse("2026-10-11T04:00:00.000Z") };
const NEXT_DAY = { fromMs: RANGE.toMs, toMs: RANGE.toMs + 24 * 3_600_000 };

const seams = vi.hoisted(() => {
  const queued: QueuedEventDayOp[] = [];
  const live: { listener: ((event: RequestsLiveEvent) => void) | null } = { listener: null };
  return {
    queued,
    live,
    // The corrected clock stands still at an instant the device clock never shows.
    correctedNow: Date.parse("2026-10-10T18:52:30.000Z"),
    listVenueObservations: vi.fn(),
    recordVenueObservation: vi.fn(),
  };
});

vi.mock("../../../../api/observations.js", () => ({
  listVenueObservations: (...args: unknown[]) => seams.listVenueObservations(...args) as unknown,
  recordVenueObservation: (...args: unknown[]) => seams.recordVenueObservation(...args) as unknown,
}));

vi.mock("../../../../lib/clock-offset.js", () => ({
  correctedNowMs: () => seams.correctedNow,
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
  // Mirrors the real drain, pinned in event-day-offline-queue.test.ts: "left"
  // stays, every other outcome is acked, a throw ends the pass.
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

import { QUEUE_RETRY_MS, useSlotObservations } from "../use-slot-observations.js";

function fact(kind: ObservationKind, observedAt: string, idempotencyKey: string = crypto.randomUUID(), bookingId: string = BOOKING): SlotObservation {
  return {
    id: crypto.randomUUID(),
    venueId: VENUE,
    bookingId,
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

function queuedOp(venueId: string, bookingId: string, kind: ObservationKind, observedAt: string, idempotencyKey: string): QueuedEventDayOp {
  return {
    kind: "observation_record",
    queueKey: `observation:${idempotencyKey}`,
    venueId,
    input: { bookingId, kind, observedAt, idempotencyKey },
    queuedAt: observedAt,
  };
}

/** The server as it answers a tap: the same fact back, with its own id. */
function serverKeepsTaps(): void {
  seams.recordVenueObservation.mockImplementation((_venueId: unknown, input: RecordObservation) =>
    Promise.resolve(fact(input.kind, input.observedAt, input.idempotencyKey, input.bookingId)));
}

function networkError(): ApiError {
  return new ApiError(0, "Network error — check your connection", "NETWORK_ERROR");
}

function settle(ms = 200): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
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

  // Vitest runs without globals, so the library does not unmount for us; a
  // hook left mounted would answer the next test's window events.
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("reads the day's facts once on mount, and again when a fact lands in this venue", async () => {
    seams.listVenueObservations.mockResolvedValue([fact("set", "2026-10-10T17:40:00.000Z")]);
    const { result } = renderHook(() => useSlotObservations(VENUE, RANGE, true, "Elaine"));
    expect(result.current.status).toBe("loading");
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    expect(result.current.observations.map((row) => row.kind)).toEqual(["set"]);
    expect(seams.listVenueObservations).toHaveBeenCalledTimes(1);
    expect(seams.listVenueObservations).toHaveBeenCalledWith(VENUE, RANGE);

    seams.listVenueObservations.mockResolvedValue([fact("set", "2026-10-10T17:40:00.000Z"), fact("doors-open", "2026-10-10T18:52:00.000Z")]);
    act(() => { seams.live.listener?.({ kind: "observation", venueId: VENUE, bookingId: BOOKING }); });
    await waitFor(() => { expect(result.current.observations).toHaveLength(2); });
    expect(seams.listVenueObservations).toHaveBeenCalledTimes(2);
    // Another venue's fact is not this board's business.
    act(() => { seams.live.listener?.({ kind: "observation", venueId: OTHER_VENUE, bookingId: BOOKING }); });
    await settle();
    expect(seams.listVenueObservations).toHaveBeenCalledTimes(2);
  });

  it("does not read again for an equal range in a new object; it does when the day changes", async () => {
    const { result, rerender } = renderHook(
      ({ range }: { range: { fromMs: number; toMs: number } }) => useSlotObservations(VENUE, range, true, "Elaine"),
      { initialProps: { range: { ...RANGE } } },
    );
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    expect(seams.listVenueObservations).toHaveBeenCalledTimes(1);
    // The page rebuilds its range object on every clock tick.
    rerender({ range: { ...RANGE } });
    rerender({ range: { ...RANGE } });
    await settle(60);
    expect(seams.listVenueObservations).toHaveBeenCalledTimes(1);
    rerender({ range: NEXT_DAY });
    await waitFor(() => { expect(seams.listVenueObservations).toHaveBeenCalledTimes(2); });
    expect(seams.listVenueObservations).toHaveBeenLastCalledWith(VENUE, NEXT_DAY);
  });

  it("reads the day on screen now, not the day it started in, when the day changes while a replay is in flight", async () => {
    const dayA = fact("set", "2026-10-10T17:40:00.000Z");
    const dayB = fact("set", "2026-10-11T17:40:00.000Z");
    seams.listVenueObservations.mockImplementation((_venueId: unknown, range: { fromMs: number }) =>
      Promise.resolve(range.fromMs === RANGE.fromMs ? [dayA] : [dayB]));
    const queuedKey = "00000000-0000-4000-8000-00000000abab";
    seams.queued.push(queuedOp(VENUE, BOOKING, "doors-open", "2026-10-10T18:50:00.000Z", queuedKey));
    // The replay reaches the server and waits there.
    const replay: { land: (() => void) | null } = { land: null };
    seams.recordVenueObservation.mockImplementation((_venueId: unknown, input: RecordObservation) =>
      new Promise<SlotObservation>((resolve) => {
        replay.land = () => { resolve(fact(input.kind, input.observedAt, input.idempotencyKey)); };
      }));
    const { result, rerender } = renderHook(
      ({ range }: { range: { fromMs: number; toMs: number } }) => useSlotObservations(VENUE, range, true, "Elaine"),
      { initialProps: { range: RANGE } },
    );
    await waitFor(() => { expect(seams.recordVenueObservation).toHaveBeenCalledTimes(1); });
    // The queued tap stands from the start, beside the day's facts.
    await waitFor(() => { expect(result.current.observations.map((row) => row.id)).toEqual([dayA.id, `queued:${queuedKey}`]); });

    // The day changes while the replay is still in flight: the old day's rows
    // go, the new day's come, the queued tap stands throughout.
    rerender({ range: NEXT_DAY });
    await waitFor(() => { expect(result.current.observations.map((row) => row.id)).toEqual([dayB.id, `queued:${queuedKey}`]); });
    act(() => { replay.land?.(); });
    await waitFor(() => { expect(result.current.pendingCount).toBe(0); });
    // The replay's follow-up read asks for the day on screen now, and its
    // answer is what stands, with the replayed fact beside it until listed.
    await waitFor(() => { expect(result.current.observations.map((row) => row.idempotencyKey)).toEqual([dayB.idempotencyKey, queuedKey]); });
    expect(result.current.observations[1]?.id).not.toMatch(/^queued:/u);
    const asked = seams.listVenueObservations.mock.calls.map((call) => (call[1] as { fromMs: number }).fromMs);
    expect(asked.at(-1)).toBe(NEXT_DAY.fromMs);
    expect(result.current.status).toBe("ready");
  });

  it("sends a tap at once with its own key and the corrected clock's time; the fact stands until the server lists it, then once", async () => {
    serverKeepsTaps();
    const { result } = renderHook(() => useSlotObservations(VENUE, RANGE, true, "Elaine"));
    await waitFor(() => { expect(result.current.status).toBe("ready"); });

    let outcome: string | null = null;
    await act(async () => { outcome = await result.current.record(BOOKING, "doors-open"); });
    expect(outcome).toBe("sent");
    const [venueId, input] = seams.recordVenueObservation.mock.calls[0] as [string, RecordObservation];
    expect(venueId).toBe(VENUE);
    expect(input.idempotencyKey).toMatch(UUID);
    expect(input).toEqual({
      bookingId: BOOKING,
      kind: "doors-open",
      observedAt: new Date(seams.correctedNow).toISOString(),
      idempotencyKey: input.idempotencyKey,
    });
    expect(result.current.observations.map((row) => row.kind)).toEqual(["doors-open"]);
    expect(result.current.pendingCount).toBe(0);

    // A read that does not list the fact yet leaves it standing.
    act(() => { seams.live.listener?.({ kind: "observation", venueId: VENUE, bookingId: BOOKING }); });
    await settle();
    expect(result.current.observations.map((row) => row.kind)).toEqual(["doors-open"]);
    // Once the server lists it, there is one of it: the server's.
    const listed = fact("doors-open", input.observedAt, input.idempotencyKey);
    seams.listVenueObservations.mockResolvedValue([listed]);
    await act(async () => { await result.current.refresh(); });
    expect(result.current.observations).toHaveLength(1);
    expect(result.current.observations[0]?.id).toBe(listed.id);
  });

  it("queues a tap when the connection fails, keeps the fact standing through a refetch, and replays it on reconnect with the same key and time", async () => {
    seams.recordVenueObservation.mockRejectedValueOnce(networkError());
    const { result } = renderHook(() => useSlotObservations(VENUE, RANGE, true, "Elaine"));
    await waitFor(() => { expect(result.current.status).toBe("ready"); });

    let outcome: string | null = null;
    await act(async () => { outcome = await result.current.record(BOOKING, "live"); });
    expect(outcome).toBe("queued");
    expect(result.current.pendingCount).toBe(1);
    expect(result.current.pendingByBooking.get(BOOKING)).toBe(1);
    expect(result.current.observations).toHaveLength(1);
    const standing = result.current.observations[0];
    expect(standing?.kind).toBe("live");
    expect(standing?.actorName).toBe("Elaine");
    expect(standing?.observedAt).toBe(new Date(seams.correctedNow).toISOString());
    const key = standing?.idempotencyKey ?? "";
    expect(key).toMatch(UUID);
    expect(standing?.id).toBe(`queued:${key}`);

    // Reads may work while writes do not: a refetch does not drop the queued fact.
    seams.listVenueObservations.mockResolvedValue([fact("set", "2026-10-10T17:40:00.000Z")]);
    await act(async () => { await result.current.refresh(); });
    expect(result.current.observations.map((row) => row.kind)).toEqual(["set", "live"]);
    expect(result.current.pendingCount).toBe(1);

    // The connection returns: the queue replays the same tap, same key, same time.
    serverKeepsTaps();
    seams.listVenueObservations.mockResolvedValue([fact("set", "2026-10-10T17:40:00.000Z"), fact("live", standing?.observedAt ?? "", key)]);
    act(() => { seams.live.listener?.({ kind: "reconnected" }); });
    await waitFor(() => { expect(result.current.pendingCount).toBe(0); });
    const replayed = seams.recordVenueObservation.mock.calls.at(-1) as [string, RecordObservation];
    expect(replayed[1].idempotencyKey).toBe(key);
    expect(replayed[1].observedAt).toBe(standing?.observedAt);
    await waitFor(() => {
      const live = result.current.observations.filter((row) => row.kind === "live");
      expect(live).toHaveLength(1);
      expect(live[0]?.id).not.toMatch(/^queued:/u);
    });
    expect(seams.queued).toHaveLength(0);
  });

  it("queues a tap on a server blip too, and drains when the browser comes back online", async () => {
    seams.recordVenueObservation.mockRejectedValueOnce(new ApiError(503, "Service unavailable", "SERVICE_UNAVAILABLE"));
    const { result } = renderHook(() => useSlotObservations(VENUE, RANGE, true, "Elaine"));
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    await act(async () => { await result.current.record(BOOKING, "set"); });
    expect(result.current.pendingCount).toBe(1);
    serverKeepsTaps();
    act(() => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => { expect(result.current.pendingCount).toBe(0); });
    expect(seams.recordVenueObservation).toHaveBeenCalledTimes(2);
    expect(seams.queued).toHaveLength(0);
  });

  it("tries the queue again on a timer while a tap waits with the socket up, as after a server blip", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    seams.recordVenueObservation.mockRejectedValueOnce(new ApiError(502, "Bad gateway", "BAD_GATEWAY"));
    const { result } = renderHook(() => useSlotObservations(VENUE, RANGE, true, "Elaine"));
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    await act(async () => { await result.current.record(BOOKING, "live"); });
    expect(result.current.pendingCount).toBe(1);
    // No reconnect and no online event come; the timer does.
    serverKeepsTaps();
    await act(async () => { await vi.advanceTimersByTimeAsync(QUEUE_RETRY_MS); });
    await waitFor(() => { expect(result.current.pendingCount).toBe(0); });
    expect(seams.recordVenueObservation).toHaveBeenCalledTimes(2);
    expect(seams.queued).toHaveLength(0);
  });

  it("counts a tap as sent when the server's 2xx reply could not be parsed at all", async () => {
    seams.recordVenueObservation.mockRejectedValueOnce(new SyntaxError("Unexpected token < in JSON"));
    const { result } = renderHook(() => useSlotObservations(VENUE, RANGE, true, "Elaine"));
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    seams.listVenueObservations.mockResolvedValue([fact("set", "2026-10-10T17:40:00.000Z")]);
    let outcome: string | null = null;
    await act(async () => { outcome = await result.current.record(BOOKING, "set"); });
    expect(outcome).toBe("sent");
    expect(seams.queued).toHaveLength(0);
    await waitFor(() => { expect(result.current.observations.map((row) => row.kind)).toEqual(["set"]); });
  });

  it("keeps a replayed fact standing when the read that should list it fails", async () => {
    seams.queued.push(queuedOp(VENUE, BOOKING, "done", "2026-10-10T23:40:00.000Z", "00000000-0000-4000-8000-00000000cdcd"));
    seams.recordVenueObservation.mockRejectedValueOnce(networkError());
    const { result } = renderHook(() => useSlotObservations(VENUE, RANGE, true, "Elaine"));
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    await waitFor(() => { expect(result.current.pendingCount).toBe(1); });
    // The connection returns for the replay, but the read after it fails.
    serverKeepsTaps();
    seams.listVenueObservations.mockRejectedValue(networkError());
    act(() => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => { expect(result.current.pendingCount).toBe(0); });
    const standing = result.current.observations;
    expect(standing.map((row) => row.kind)).toEqual(["done"]);
    expect(standing[0]?.id).not.toMatch(/^queued:/u);
    expect(standing[0]?.idempotencyKey).toBe("00000000-0000-4000-8000-00000000cdcd");
    expect(result.current.status).toBe("ready");
  });

  it("stands a tap left in the queue by an earlier visit as soon as the board opens", async () => {
    seams.queued.push(queuedOp(VENUE, BOOKING, "doors-open", "2026-10-10T18:50:00.000Z", "00000000-0000-4000-8000-00000000aaaa"));
    seams.recordVenueObservation.mockRejectedValue(networkError());
    const { result } = renderHook(() => useSlotObservations(VENUE, RANGE, true, "Elaine"));
    await waitFor(() => { expect(result.current.pendingCount).toBe(1); });
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    expect(result.current.observations.map((row) => row.id)).toEqual(["queued:00000000-0000-4000-8000-00000000aaaa"]);
    expect(seams.queued).toHaveLength(1);
  });

  it("drops a replayed tap the server refuses for good, keeps one it could not be asked to keep, and leaves another venue's taps alone", async () => {
    const refusedKey = "00000000-0000-4000-8000-00000000bbbb";
    const keptKey = "00000000-0000-4000-8000-00000000cccc";
    const laterKey = "00000000-0000-4000-8000-00000000dddd";
    seams.queued.push(
      queuedOp(VENUE, BOOKING, "set", "2026-10-10T17:00:00.000Z", refusedKey),
      queuedOp(OTHER_VENUE, BOOKING, "set", "2026-10-10T17:01:00.000Z", "00000000-0000-4000-8000-00000000eeee"),
      queuedOp(VENUE, OTHER_BOOKING, "live", "2026-10-10T17:05:00.000Z", keptKey),
      queuedOp(VENUE, OTHER_BOOKING, "done", "2026-10-10T17:09:00.000Z", laterKey),
    );
    seams.recordVenueObservation.mockImplementation((_venueId: unknown, input: RecordObservation) => (
      input.idempotencyKey === refusedKey
        ? Promise.reject(new ApiError(404, "Booking not found", "NOT_FOUND"))
        : Promise.reject(new ApiError(401, "Session expired — please sign in again", "UNAUTHORIZED"))
    ));
    const { result } = renderHook(() => useSlotObservations(VENUE, RANGE, true, "Elaine"));
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    await waitFor(() => { expect(result.current.pendingCount).toBe(2); });
    // The refused tap is gone from the queue and the screen; the other venue's
    // tap was left; the tap that needs a session waited, and the one behind
    // it was not tried: the order of the day's facts is kept.
    expect(seams.queued.map((op) => op.queueKey)).toEqual([
      "observation:00000000-0000-4000-8000-00000000eeee",
      `observation:${keptKey}`,
      `observation:${laterKey}`,
    ]);
    expect(result.current.observations.map((row) => row.idempotencyKey)).toEqual([keptKey, laterKey]);
    expect(result.current.pendingByBooking.get(OTHER_BOOKING)).toBe(2);
    expect(result.current.pendingByBooking.get(BOOKING)).toBeUndefined();
    expect(seams.recordVenueObservation).toHaveBeenCalledTimes(2);
  });

  it("reports a tap the server refuses, or a session to renew, and queues nothing", async () => {
    seams.recordVenueObservation.mockRejectedValueOnce(new ApiError(400, "An observation cannot be ahead of the clock.", "OBSERVED_IN_FUTURE"));
    const { result } = renderHook(() => useSlotObservations(VENUE, RANGE, true, "Elaine"));
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    await expect(result.current.record(BOOKING, "done")).rejects.toThrow("ahead of the clock");
    seams.recordVenueObservation.mockRejectedValueOnce(new ApiError(401, "Session expired — please sign in again", "UNAUTHORIZED"));
    await expect(result.current.record(BOOKING, "done")).rejects.toThrow("sign in again");
    expect(seams.queued).toHaveLength(0);
    expect(result.current.pendingCount).toBe(0);
    expect(result.current.observations).toHaveLength(0);
  });

  it("counts a tap as sent when the server kept it but its reply could not be read, and reads the list again", async () => {
    seams.recordVenueObservation.mockRejectedValueOnce(
      new ApiError(0, "Server returned an unexpected response shape for POST /venues/v/observations", "RESPONSE_VALIDATION_ERROR"),
    );
    const { result } = renderHook(() => useSlotObservations(VENUE, RANGE, true, "Elaine"));
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    expect(seams.listVenueObservations).toHaveBeenCalledTimes(1);
    seams.listVenueObservations.mockResolvedValue([fact("flipping", "2026-10-10T20:00:00.000Z")]);
    let outcome: string | null = null;
    await act(async () => { outcome = await result.current.record(BOOKING, "flipping"); });
    expect(outcome).toBe("sent");
    expect(seams.queued).toHaveLength(0);
    await waitFor(() => { expect(seams.listVenueObservations).toHaveBeenCalledTimes(2); });
    await waitFor(() => { expect(result.current.observations.map((row) => row.kind)).toEqual(["flipping"]); });
  });

  it("says when the day's facts could not be read, and a tap does not pretend they were", async () => {
    seams.listVenueObservations.mockRejectedValue(networkError());
    serverKeepsTaps();
    const { result } = renderHook(() => useSlotObservations(VENUE, RANGE, true, "Elaine"));
    await waitFor(() => { expect(result.current.status).toBe("failed"); });
    await act(async () => { await result.current.record(BOOKING, "set"); });
    expect(result.current.status).toBe("failed");
    expect(result.current.observations.map((row) => row.kind)).toEqual(["set"]);
    // Once a read lands the board is ready; the sent fact stands until listed.
    seams.listVenueObservations.mockResolvedValue([]);
    await act(async () => { await result.current.refresh(); });
    expect(result.current.status).toBe("ready");
    expect(result.current.observations.map((row) => row.kind)).toEqual(["set"]);
  });

  it("is inert for a screen that cannot read the board", async () => {
    const { result } = renderHook(() => useSlotObservations(VENUE, RANGE, false, ""));
    await settle(50);
    expect(seams.listVenueObservations).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
    expect(result.current.pendingCount).toBe(0);
    await expect(result.current.record(BOOKING, "set")).rejects.toThrow("cannot record");
  });
});
