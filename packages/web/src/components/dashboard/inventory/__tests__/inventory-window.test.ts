import { describe, expect, it } from "vitest";
import { defaultInventoryWindow, inventoryTime, inventoryWindowInput, localInventoryInstant } from "../inventory-window.js";

describe("inventory assessment window", () => {
  it("distinguishes exact occupied instants during the repeated DST hour", () => {
    const first = inventoryTime("2026-10-25T00:30:00.000Z", "Europe/London");
    const second = inventoryTime("2026-10-25T01:30:00.000Z", "Europe/London");
    expect(first).not.toBe(second);
    expect(first).toContain("GMT+1");
    expect(second).toContain("GMT");
  });
  it("defaults to a future hour and a seven-day window", () => {
    const now = new Date("2026-09-05T10:24:32.000Z");
    const result = inventoryWindowInput(defaultInventoryWindow(now));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(Date.parse(result.data.startsAt)).toBeGreaterThan(now.getTime());
    expect(Date.parse(result.data.endsAt) - Date.parse(result.data.startsAt)).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("converts displayed local clock values to exact instants", () => {
    const at = new Date(2026, 8, 6, 12, 30);
    const result = inventoryWindowInput({ startsAt: localInventoryInstant(at), endsAt: localInventoryInstant(new Date(at.getTime() + 3_600_000)) });
    expect(result).toEqual({ success: true, data: { startsAt: at.toISOString(), endsAt: new Date(at.getTime() + 3_600_000).toISOString() } });
  });

  it.each(["", "2026-02-30T10:00", "2026-09-05", "not a date"])("rejects an incomplete or impossible start %s", (startsAt) => {
    expect(inventoryWindowInput({ startsAt, endsAt: "2026-10-01T12:00" }).success).toBe(false);
  });

  it("rejects an end before the start", () => {
    expect(inventoryWindowInput({ startsAt: "2026-09-06T12:00", endsAt: "2026-09-06T11:00" }).success).toBe(false);
  });
  it("rejects an assessment longer than 31 days", () => {
    expect(inventoryWindowInput({ startsAt: "2026-09-06T12:00", endsAt: "2026-11-06T12:00" }))
      .toMatchObject({ success: false, message: "Choose a window of at most 31 days." });
  });
});
