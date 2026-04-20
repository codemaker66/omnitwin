import { describe, it, expect } from "vitest";
import {
  ACTIVE_WINDOW_MS,
  STALE_WINDOW_MS,
  filterActiveViewers,
} from "../../services/review-sessions.js";

// ---------------------------------------------------------------------------
// review-sessions — pure presence-window filtering
//
// `filterActiveViewers` is the decision logic behind "who is currently
// viewing this review" — tests pin the window semantics without
// needing a DB.
// ---------------------------------------------------------------------------

describe("filterActiveViewers", () => {
  const now = new Date("2026-04-17T12:00:00.000Z");

  it("keeps rows whose lastSeenAt is within the window", () => {
    const rows = [
      { userId: "u1", lastSeenAt: new Date("2026-04-17T11:59:50.000Z") }, // 10s ago
      { userId: "u2", lastSeenAt: new Date("2026-04-17T11:59:45.000Z") }, // 15s ago
    ];
    const active = filterActiveViewers(rows, now, 30_000);
    expect(active).toHaveLength(2);
  });

  it("drops rows older than the window", () => {
    const rows = [
      { userId: "u1", lastSeenAt: new Date("2026-04-17T11:59:00.000Z") }, // 60s ago
      { userId: "u2", lastSeenAt: new Date("2026-04-17T11:59:55.000Z") }, // 5s ago
    ];
    const active = filterActiveViewers(rows, now, 30_000);
    expect(active.map((r) => r.userId)).toEqual(["u2"]);
  });

  it("treats exactly-on-boundary as active (inclusive cutoff)", () => {
    const rows = [
      { userId: "u1", lastSeenAt: new Date("2026-04-17T11:59:30.000Z") }, // exactly 30s
    ];
    const active = filterActiveViewers(rows, now, 30_000);
    expect(active).toHaveLength(1);
  });

  it("drops just-past-boundary rows", () => {
    const rows = [
      { userId: "u1", lastSeenAt: new Date("2026-04-17T11:59:29.999Z") }, // 30.001s ago
    ];
    const active = filterActiveViewers(rows, now, 30_000);
    expect(active).toHaveLength(0);
  });

  it("handles empty input", () => {
    expect(filterActiveViewers([], now, 30_000)).toEqual([]);
  });

  it("preserves input order (stable filter)", () => {
    const rows = [
      { userId: "u1", lastSeenAt: new Date("2026-04-17T11:59:55.000Z") },
      { userId: "u2", lastSeenAt: new Date("2026-04-17T11:59:50.000Z") },
      { userId: "u3", lastSeenAt: new Date("2026-04-17T11:59:45.000Z") },
    ];
    const active = filterActiveViewers(rows, now, 30_000);
    expect(active.map((r) => r.userId)).toEqual(["u1", "u2", "u3"]);
  });
});

describe("review-sessions constants", () => {
  it("ACTIVE_WINDOW_MS is 30s (matches client heartbeat cadence)", () => {
    expect(ACTIVE_WINDOW_MS).toBe(30_000);
  });

  it("STALE_WINDOW_MS is longer than ACTIVE (so cleanup doesn't evict active rows)", () => {
    expect(STALE_WINDOW_MS).toBeGreaterThan(ACTIVE_WINDOW_MS);
  });
});
