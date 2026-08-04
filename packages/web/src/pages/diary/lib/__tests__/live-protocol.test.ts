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
