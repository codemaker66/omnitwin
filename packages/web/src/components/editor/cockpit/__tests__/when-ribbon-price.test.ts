import { describe, expect, it } from "vitest";
import { formatPrice, priceWindowFor } from "../when-ribbon-price.js";

// The price line's request (goal 19 S6): venue wall time, one day at a time.
const ROOM = "00000000-0000-4000-8000-0000000000a1";
const T = (iso: string): number => Date.parse(iso);

describe("priceWindowFor", () => {
  it("asks for the window in the venue's wall time, on the venue's date", () => {
    // 17:00Z on a BST day is 18:00 in Glasgow.
    expect(priceWindowFor(ROOM, T("2030-05-10T17:00:00.000Z"), T("2030-05-10T22:00:00.000Z"), "Europe/London", 80)).toEqual({
      kind: "request",
      input: { spaceId: ROOM, eventDate: "2030-05-10", startTime: "18:00", endTime: "23:00", guestCount: 80 },
    });
  });

  it("treats an end at midnight exactly as the day's twenty-fourth hour", () => {
    expect(priceWindowFor(ROOM, T("2030-05-10T17:00:00.000Z"), T("2030-05-10T23:00:00.000Z"), "Europe/London", 80)).toMatchObject({
      kind: "request",
      input: { eventDate: "2030-05-10", startTime: "18:00", endTime: "24:00" },
    });
  });

  it("will not price a window that runs past midnight", () => {
    expect(priceWindowFor(ROOM, T("2030-05-10T17:00:00.000Z"), T("2030-05-11T00:30:00.000Z"), "Europe/London", 80)).toEqual({ kind: "crosses-midnight" });
  });

  it("asks for nothing without a guest count, a positive one, or a real window", () => {
    const start = T("2030-05-10T17:00:00.000Z");
    expect(priceWindowFor(ROOM, start, start + 3_600_000, "Europe/London", null)).toEqual({ kind: "none" });
    expect(priceWindowFor(ROOM, start, start + 3_600_000, "Europe/London", 0)).toEqual({ kind: "none" });
    expect(priceWindowFor(ROOM, start, start, "Europe/London", 10)).toEqual({ kind: "none" });
    expect(priceWindowFor(ROOM, Number.NaN, start, "Europe/London", 10)).toEqual({ kind: "none" });
  });

  it("rounds and caps the guest count to what the estimate door accepts", () => {
    const start = T("2030-05-10T17:00:00.000Z");
    const result = priceWindowFor(ROOM, start, start + 3_600_000, "Europe/London", 12_345.6);
    expect(result.kind === "request" ? result.input.guestCount : null).toBe(10_000);
  });
});

describe("formatPrice", () => {
  it("writes pounds without pence", () => {
    expect(formatPrice(1250, "GBP")).toBe("£1,250");
    expect(formatPrice(1250.4, "GBP")).toBe("£1,250");
  });

  it("falls back to the code when the currency is not one Intl knows", () => {
    expect(formatPrice(12, "NOT-A-CURRENCY")).toBe("NOT-A-CURRENCY 12");
  });
});
