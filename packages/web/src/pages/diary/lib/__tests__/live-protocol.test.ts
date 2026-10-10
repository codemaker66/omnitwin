import { describe, expect, it } from "vitest";
import {
  RECONNECT_MAX_MS,
  nextBackoffMs,
  parseLiveMessage,
} from "../live-protocol.js";

// ---------------------------------------------------------------------------
// Live protocol parsing + reconnect arithmetic (T-497; Canon §15).
// ---------------------------------------------------------------------------

describe("parseLiveMessage", () => {
  it("parses every server message type", () => {
    expect(
      parseLiveMessage(JSON.stringify({ type: "hello", venueId: "v", presence: [] }))?.type,
    ).toBe("hello");
    expect(
      parseLiveMessage(
        JSON.stringify({ type: "presence", users: [{ userId: "u", name: "A", role: "staff" }] }),
      )?.type,
    ).toBe("presence");
    expect(
      parseLiveMessage(
        JSON.stringify({
          type: "diary.event",
          kind: "booking.created",
          bookingId: "b",
          actorUserId: null,
          at: "2026-09-19T17:00:00.000Z",
        }),
      )?.type,
    ).toBe("diary.event");
    expect(parseLiveMessage(JSON.stringify({ type: "ping" }))?.type).toBe("ping");
    expect(parseLiveMessage(JSON.stringify({ type: "pong" }))?.type).toBe("pong");
    expect(
      parseLiveMessage(JSON.stringify({ type: "error", code: "FORBIDDEN", message: "no" }))?.type,
    ).toBe("error");
  });

  it("parses the conversation frames, and the clock on every frame that carries it", () => {
    const UUID = "00000000-0000-4000-8000-00000000e001";
    const hello = parseLiveMessage(JSON.stringify({ type: "hello", venueId: "v", presence: [], serverNowMs: 1_700_000_000_000 }));
    expect(hello?.type).toBe("hello");
    expect(hello !== null && "serverNowMs" in hello ? hello.serverNowMs : null).toBe(1_700_000_000_000);
    const landed = parseLiveMessage(JSON.stringify({
      type: "conversation.event", venueId: UUID, kind: "message.sent", threadId: UUID, audience: "staff-private",
      subject: "booking", bookingId: UUID, eventId: null, requestId: null, messageId: UUID, cursor: 7,
      actorUserId: null, at: "2026-10-08T15:00:00.000Z", serverNowMs: 1_700_000_000_000,
    }));
    expect(landed?.type).toBe("conversation.event");
    expect(parseLiveMessage(JSON.stringify({ type: "conversation.caughtUp", cursor: 7, serverNowMs: 1_700_000_000_000 }))?.type).toBe("conversation.caughtUp");
    expect(parseLiveMessage(JSON.stringify({
      type: "conversation.ack", commandId: UUID, outcome: "rejected", replay: false, status: 409,
      code: "REQUEST_TAKEN", error: "Elaine has this.", ownerName: "Elaine", serverNowMs: 1_700_000_000_000,
    }))?.type).toBe("conversation.ack");
    // The conversation frames carry the clock by contract; one without it is not a frame.
    expect(parseLiveMessage(JSON.stringify({ type: "conversation.caughtUp", cursor: 7 }))).toBeNull();
  });

  it("ignores malformed frames instead of throwing", () => {
    expect(parseLiveMessage("not json")).toBeNull();
    expect(parseLiveMessage(JSON.stringify({ type: "mystery" }))).toBeNull();
    expect(parseLiveMessage(42)).toBeNull();
  });
});

describe("nextBackoffMs", () => {
  it("doubles from one second and caps at thirty", () => {
    expect(nextBackoffMs(0)).toBe(1_000);
    expect(nextBackoffMs(1)).toBe(2_000);
    expect(nextBackoffMs(3)).toBe(8_000);
    expect(nextBackoffMs(10)).toBe(RECONNECT_MAX_MS);
    expect(nextBackoffMs(1000)).toBe(RECONNECT_MAX_MS);
  });
});
