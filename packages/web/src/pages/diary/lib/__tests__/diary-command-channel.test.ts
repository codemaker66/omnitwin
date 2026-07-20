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
// branch — drawer copy, board 409 handling — keeps working unchanged. A
// channel-level failure falls back to REST ONLY when that retry cannot
// duplicate work: always for update/transition (their cores re-apply to
// the same row), but for a create only when the frame provably never left
// this client — an unconfirmed create surfaces COMMAND_UNCONFIRMED instead
// of re-executing as a new operation (reviewer P0, T-537).
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
  it("uses REST when no channel is registered", async () => {
    const rest = vi.fn().mockResolvedValue(BOOKING);
    const result = await sendViaChannelOrRest(
      (commandId) => ({ kind: "booking.create", commandId, payload: {} as never }),
      rest,
    );
    expect(result).toBe(BOOKING);
    expect(rest).toHaveBeenCalledTimes(1);
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

  it("an applied ack without a booking payload falls back to REST (defensive)", async () => {
    setDiaryCommandChannel(((command: { commandId: string }) =>
      Promise.resolve({
        type: "diary.ack",
        commandId: command.commandId,
        outcome: "applied",
        replay: false,
        status: 201,
      } satisfies DiaryCommandAck)) as never);
    const rest = vi.fn().mockResolvedValue(BOOKING);
    const result = await sendViaChannelOrRest(
      (commandId) => ({ kind: "booking.create", commandId, payload: {} as never }),
      rest,
    );
    expect(result).toBe(BOOKING);
    expect(rest).toHaveBeenCalledTimes(1);
  });

  it("a channel-level failure (timeout / socket died) falls back to REST for an update", async () => {
    // update/transition cores re-apply to the SAME row — a repeat is a
    // no-op or a clean 4xx, so even a sent-but-unacked failure may retry.
    setDiaryCommandChannel((() =>
      Promise.reject(new ChannelDispatchError(true, "command ack timed out"))) as never);
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
  });

  it("an unconfirmed CREATE (sent, then timeout/drop) refuses the REST retry (reviewer P0)", async () => {
    // The REST surface carries no commandId — a blind retry of a create
    // that may have committed would insert a SECOND booking.
    setDiaryCommandChannel((() =>
      Promise.reject(new ChannelDispatchError(true, "command ack timed out"))) as never);
    const rest = vi.fn();
    await expect(
      sendViaChannelOrRest(
        (commandId) => ({ kind: "booking.create", commandId, payload: {} as never }),
        rest,
      ),
    ).rejects.toSatisfy((caught: unknown) => {
      expect(caught).toBeInstanceOf(ApiError);
      const error = caught as ApiError;
      expect(error.code).toBe("COMMAND_UNCONFIRMED");
      expect(error.status).toBe(0);
      return true;
    });
    expect(rest).not.toHaveBeenCalled();
  });

  it("a create the channel provably never dispatched still falls back to REST", async () => {
    setDiaryCommandChannel((() =>
      Promise.reject(new ChannelDispatchError(false, "command channel closed"))) as never);
    const rest = vi.fn().mockResolvedValue(BOOKING);
    const result = await sendViaChannelOrRest(
      (commandId) => ({ kind: "booking.create", commandId, payload: {} as never }),
      rest,
    );
    expect(result).toBe(BOOKING);
    expect(rest).toHaveBeenCalledTimes(1);
  });

  it("an UNTYPED channel failure on a create is treated as possibly-sent (conservative)", async () => {
    setDiaryCommandChannel((() => Promise.reject(new Error("boom"))) as never);
    const rest = vi.fn();
    await expect(
      sendViaChannelOrRest(
        (commandId) => ({ kind: "booking.create", commandId, payload: {} as never }),
        rest,
      ),
    ).rejects.toSatisfy((caught: unknown) => {
      expect(caught).toBeInstanceOf(ApiError);
      expect((caught as ApiError).code).toBe("COMMAND_UNCONFIRMED");
      return true;
    });
    expect(rest).not.toHaveBeenCalled();
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
