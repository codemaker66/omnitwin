import { describe, it, expect, vi, afterEach } from "vitest";
import type { DiaryCommandAck } from "@omnitwin/types";
import { ApiError } from "../../../../api/client.js";
import {
  ChannelDispatchError,
  releaseDiaryCommandChannel,
  sendViaChannelOrRest,
  setDiaryCommandChannel,
} from "../diary-command-channel.js";

// ---------------------------------------------------------------------------
// Diary command channel registry (T-537; Canon §9) — tests written FIRST.
//
// The api layer routes mutations through here: command-first when the live
// socket has registered a sender, REST otherwise. A rejected ack becomes a
// REAL ApiError (status/code/details verbatim) so every existing error
// branch — drawer copy, board 409 handling — keeps working unchanged.
// ONE commandId is minted per logical operation and travels with BOTH
// transports (T-538): the REST fallback carries it as an Idempotency-Key,
// so a channel attempt and its retry dedupe on the server's ledger — the
// T-537 invariant ("an unconfirmed create must never duplicate") is now
// enforced by identity instead of refusal.
// ---------------------------------------------------------------------------

afterEach(() => {
  setDiaryCommandChannel(null);
});

const BOOKING = { id: "00000000-0000-4000-8000-000000000001" };

function appliedAck(commandId: string): DiaryCommandAck {
  return {
    type: "diary.ack",
    commandId,
    outcome: "applied",
    replay: false,
    status: 201,
    booking: BOOKING as never,
  };
}

describe("sendViaChannelOrRest", () => {
  it("uses REST when no channel is registered — still carrying a minted commandId", async () => {
    const rest = vi.fn().mockResolvedValue(BOOKING);
    const result = await sendViaChannelOrRest(
      (commandId) => ({ kind: "booking.create", commandId, payload: {} as never }),
      rest,
    );
    expect(result).toBe(BOOKING);
    expect(rest).toHaveBeenCalledTimes(1);
    // T-538: even the pure-REST path is keyed, so ITS retries can dedupe.
    expect(rest.mock.calls[0]?.[0]).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it("routes through the channel when registered and returns the ack's booking", async () => {
    const sender = vi.fn((command: { commandId: string }) =>
      Promise.resolve(appliedAck(command.commandId)),
    );
    setDiaryCommandChannel(sender as never);
    const rest = vi.fn();
    const result = await sendViaChannelOrRest(
      (commandId) => ({ kind: "booking.create", commandId, payload: {} as never }),
      rest,
    );
    expect(result).toEqual(BOOKING);
    expect(rest).not.toHaveBeenCalled();
    // Each send mints a fresh uuid commandId.
    const sent = sender.mock.calls[0]?.[0] as { commandId: string };
    expect(sent.commandId).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it("a rejected ack throws a REAL ApiError with the REST vocabulary", async () => {
    setDiaryCommandChannel(((command: { commandId: string }) =>
      Promise.resolve({
        type: "diary.ack",
        commandId: command.commandId,
        outcome: "rejected",
        replay: false,
        status: 409,
        code: "INK_SLOT_TAKEN",
        error: "That slot has just been inked",
      } satisfies DiaryCommandAck)) as never);
    const rest = vi.fn();
    await expect(
      sendViaChannelOrRest(
        (commandId) => ({ kind: "booking.create", commandId, payload: {} as never }),
        rest,
      ),
    ).rejects.toSatisfy((caught: unknown) => {
      expect(caught).toBeInstanceOf(ApiError);
      const error = caught as ApiError;
      expect(error.status).toBe(409);
      expect(error.code).toBe("INK_SLOT_TAKEN");
      return true;
    });
    // A REAL business rejection must NOT retry over REST — the server
    // already decided.
    expect(rest).not.toHaveBeenCalled();
  });

  it("an applied ack without a booking payload falls back to REST (defensive) — same id", async () => {
    const seen: string[] = [];
    setDiaryCommandChannel(((command: { commandId: string }) => {
      seen.push(command.commandId);
      return Promise.resolve({
        type: "diary.ack",
        commandId: command.commandId,
        outcome: "applied",
        replay: false,
        status: 201,
      } satisfies DiaryCommandAck);
    }) as never);
    const rest = vi.fn().mockResolvedValue(BOOKING);
    const result = await sendViaChannelOrRest(
      (commandId) => ({ kind: "booking.create", commandId, payload: {} as never }),
      rest,
    );
    expect(result).toBe(BOOKING);
    expect(rest).toHaveBeenCalledTimes(1);
    // The keyed REST call replays the recorded outcome with a fresh read.
    expect(rest.mock.calls[0]?.[0]).toBe(seen[0]);
  });

  it("a channel-level failure (timeout / socket died) retries REST with the SAME commandId", async () => {
    // T-538: the id IS the dedupe identity — if the ws attempt committed,
    // the keyed REST call replays the recorded outcome, never re-executes.
    const seen: string[] = [];
    setDiaryCommandChannel(((command: { commandId: string }) => {
      seen.push(command.commandId);
      return Promise.reject(new ChannelDispatchError(true, "command ack timed out"));
    }) as never);
    const rest = vi.fn().mockResolvedValue(BOOKING);
    const result = await sendViaChannelOrRest(
      (commandId) => ({
        kind: "booking.update",
        commandId,
        bookingId: BOOKING.id,
        payload: {} as never,
      }),
      rest,
    );
    expect(result).toBe(BOOKING);
    expect(rest).toHaveBeenCalledTimes(1);
    expect(rest.mock.calls[0]?.[0]).toBe(seen[0]);
  });

  it("an unconfirmed CREATE (sent, then timeout/drop) retries with the SAME id — never a new operation", async () => {
    // T-537's P0 invariant, now enforced by identity: a create that may
    // have committed retries as the SAME command, so the ledger replays it
    // instead of inserting a second booking.
    const seen: string[] = [];
    setDiaryCommandChannel(((command: { commandId: string }) => {
      seen.push(command.commandId);
      return Promise.reject(new ChannelDispatchError(true, "command ack timed out"));
    }) as never);
    const rest = vi.fn().mockResolvedValue(BOOKING);
    const result = await sendViaChannelOrRest(
      (commandId) => ({ kind: "booking.create", commandId, payload: {} as never }),
      rest,
    );
    expect(result).toBe(BOOKING);
    expect(rest).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(1);
    expect(rest.mock.calls[0]?.[0]).toBe(seen[0]);
  });

  it("a create the channel provably never dispatched falls back with the same id too", async () => {
    const seen: string[] = [];
    setDiaryCommandChannel(((command: { commandId: string }) => {
      seen.push(command.commandId);
      return Promise.reject(new ChannelDispatchError(false, "command channel closed"));
    }) as never);
    const rest = vi.fn().mockResolvedValue(BOOKING);
    const result = await sendViaChannelOrRest(
      (commandId) => ({ kind: "booking.create", commandId, payload: {} as never }),
      rest,
    );
    expect(result).toBe(BOOKING);
    expect(rest.mock.calls[0]?.[0]).toBe(seen[0]);
  });

  it("an UNTYPED channel failure on a create also retries with the same id", async () => {
    const seen: string[] = [];
    setDiaryCommandChannel(((command: { commandId: string }) => {
      seen.push(command.commandId);
      return Promise.reject(new Error("boom"));
    }) as never);
    const rest = vi.fn().mockResolvedValue(BOOKING);
    const result = await sendViaChannelOrRest(
      (commandId) => ({ kind: "booking.create", commandId, payload: {} as never }),
      rest,
    );
    expect(result).toBe(BOOKING);
    expect(rest.mock.calls[0]?.[0]).toBe(seen[0]);
  });

  it("unregistering restores pure REST behaviour", async () => {
    const sender = vi.fn();
    setDiaryCommandChannel(sender as never);
    setDiaryCommandChannel(null);
    const rest = vi.fn().mockResolvedValue(BOOKING);
    await sendViaChannelOrRest(
      (commandId) => ({ kind: "booking.create", commandId, payload: {} as never }),
      rest,
    );
    expect(sender).not.toHaveBeenCalled();
    expect(rest).toHaveBeenCalledTimes(1);
  });

  it("releasing a STALE sender leaves the current registration untouched (reviewer P2)", async () => {
    const stale = vi.fn((command: { commandId: string }) =>
      Promise.resolve(appliedAck(command.commandId)),
    );
    const current = vi.fn((command: { commandId: string }) =>
      Promise.resolve(appliedAck(command.commandId)),
    );
    setDiaryCommandChannel(stale as never);
    setDiaryCommandChannel(current as never); // successor takes over
    releaseDiaryCommandChannel(stale as never); // late cleanup of the old one
    const rest = vi.fn();
    const result = await sendViaChannelOrRest(
      (commandId) => ({ kind: "booking.create", commandId, payload: {} as never }),
      rest,
    );
    // The successor still owns the channel — commands keep flowing through it.
    expect(result).toEqual(BOOKING);
    expect(current).toHaveBeenCalledTimes(1);
    expect(rest).not.toHaveBeenCalled();
    // Releasing the RIGHT sender clears the registry.
    releaseDiaryCommandChannel(current as never);
    const restAfter = vi.fn().mockResolvedValue(BOOKING);
    await sendViaChannelOrRest(
      (commandId) => ({ kind: "booking.create", commandId, payload: {} as never }),
      restAfter,
    );
    expect(restAfter).toHaveBeenCalledTimes(1);
  });
});
