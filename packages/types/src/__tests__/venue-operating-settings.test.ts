import { describe, expect, it } from "vitest";
import {
  OPERATING_SETTINGS_DEFAULTS,
  UpdateVenueOperatingSettingsSchema,
  VenueOperatingSettingsSchema,
  escalationWindowSeconds,
} from "../venue-operating-settings.js";

describe("venue operating settings", () => {
  it("defaults are Blake's decisions of 10 October 2026", () => {
    expect(OPERATING_SETTINGS_DEFAULTS).toEqual({
      escalationNowSeconds: 120,
      escalationSoonSeconds: 300,
      escalationRoutineSeconds: 900,
      quietHoursStart: "22:00",
      quietHoursEnd: "07:00",
      dutyAdminUserId: null,
      dayBoundaryHour: 4,
      handoverReliefSeconds: 300,
      wallShowsGuestDetails: false,
    });
    expect(VenueOperatingSettingsSchema.safeParse(OPERATING_SETTINGS_DEFAULTS).success).toBe(true);
  });

  it("gives each urgency its own window", () => {
    expect(escalationWindowSeconds(OPERATING_SETTINGS_DEFAULTS, "now")).toBe(120);
    expect(escalationWindowSeconds(OPERATING_SETTINGS_DEFAULTS, "soon")).toBe(300);
    expect(escalationWindowSeconds(OPERATING_SETTINGS_DEFAULTS, "routine")).toBe(900);
  });

  it("refuses a window under 30 s or over a day, a clock that is not HH:MM, and an hour past 23", () => {
    for (const bad of [
      { escalationNowSeconds: 29 },
      { escalationRoutineSeconds: 86_401 },
      { quietHoursStart: "7:00" },
      { quietHoursEnd: "24:00" },
      { dayBoundaryHour: 24 },
      { dutyAdminUserId: "elaine" },
    ]) {
      expect(VenueOperatingSettingsSchema.safeParse({ ...OPERATING_SETTINGS_DEFAULTS, ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("a change is any subset of the fields and nothing else", () => {
    expect(UpdateVenueOperatingSettingsSchema.safeParse({ escalationSoonSeconds: 240 }).success).toBe(true);
    expect(UpdateVenueOperatingSettingsSchema.safeParse({}).success).toBe(true);
    expect(UpdateVenueOperatingSettingsSchema.safeParse({ requestEscalationSeconds: 180 }).success).toBe(false);
  });
});
