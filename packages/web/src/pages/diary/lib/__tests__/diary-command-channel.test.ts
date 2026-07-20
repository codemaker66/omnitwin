import { describe, it, expect, vi, afterEach } from "vitest";
import type { DiaryCommandAck } from "@omnitwin/types";
import { ApiError } from "../../../../api/client.js";
import {
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
// channel-level failure (timeout, socket died mid-flight) falls back to
// REST: the envelope's exactly-once ledger makes the retry safe.
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

  it("a channel-level failure (timeout / socket died) falls back to REST", async () => {
    setDiaryCommandChannel((() => Promise.reject(new Error("command timed out"))) as never);
    const rest = vi.fn().mockResolvedValue(BOOKING);
    const result = await sendViaChannelOrRest(
      (commandId) => ({ kind: "booking.create", commandId, payload: {} as never }),
      rest,
    );
    expect(result).toBe(BOOKING);
    expect(rest).toHaveBeenCalledTimes(1);
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
});
