import { describe, expect, it } from "vitest";
import { formatOpenUntil } from "../routes/venue-team.js";

// The invitation email's "Open until" line: the venue's own calendar day, so
// a grant lapsing at 23:30 UTC in a London summer reads as the next day there.

describe("formatOpenUntil", () => {
  it("names the day in the venue's time zone", () => {
    const lapses = new Date("2026-07-14T23:30:00.000Z");
    expect(formatOpenUntil(lapses, "Europe/London")).toBe("Wednesday 15 July 2026");
    expect(formatOpenUntil(lapses, "America/New_York")).toBe("Tuesday 14 July 2026");
  });

  it("falls back to London for a zone Intl does not know", () => {
    expect(formatOpenUntil(new Date("2026-11-24T12:00:00.000Z"), "Mars/Olympus_Mons")).toBe("Tuesday 24 November 2026");
  });

  it("says plainly when a grant has no end", () => {
    expect(formatOpenUntil(null, "Europe/London")).toBe("until it is cancelled");
  });
});
