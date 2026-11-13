import { z } from "zod";
import type { RequestUrgency } from "./requests.js";

// ---------------------------------------------------------------------------
// A venue's operating settings (goal 19 S7, docs/operations/people-matrix.md §6).
//
// Everything here is venue configuration: how long an unowned request waits
// before the duty admin is told, by urgency; the hours in which no email is
// sent; who the duty admin is; when "today" rolls over on a wall left on; how
// long a relief has to accept a handover; whether the wall shows guest
// details. The defaults are Blake's decisions of 10 October 2026. They are
// edited in the venue's settings, never written into code as constants.
// ---------------------------------------------------------------------------

/** "HH:MM" on a 24-hour clock. */
export const CLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/u;
export const ClockTimeSchema = z.string().regex(CLOCK_TIME_PATTERN, "HH:MM on a 24-hour clock");

const WindowSecondsSchema = z.number().int().min(30).max(86_400);

export const VenueOperatingSettingsSchema = z.object({
  /** Seconds an unowned "now" request waits before the duty admin is told. */
  escalationNowSeconds: WindowSecondsSchema,
  escalationSoonSeconds: WindowSecondsSchema,
  escalationRoutineSeconds: WindowSecondsSchema,
  /** No escalation email leaves between these venue-local times; the
   *  in-product copy never sleeps. A start after its end runs past midnight. */
  quietHoursStart: ClockTimeSchema,
  quietHoursEnd: ClockTimeSchema,
  /** The venue administrator escalations are addressed to; null means every
   *  administrator of the venue. */
  dutyAdminUserId: z.uuid().nullable(),
  /** The venue-local hour at which a wall left on turns to the next day. */
  dayBoundaryHour: z.number().int().min(0).max(23),
  /** Seconds a named relief has to accept a handover before it escalates. */
  handoverReliefSeconds: WindowSecondsSchema,
  wallShowsGuestDetails: z.boolean(),
});

export type VenueOperatingSettings = z.infer<typeof VenueOperatingSettingsSchema>;

/** A change: any subset of the fields, nothing else. */
export const UpdateVenueOperatingSettingsSchema = VenueOperatingSettingsSchema.partial().strict();
export type UpdateVenueOperatingSettings = z.infer<typeof UpdateVenueOperatingSettingsSchema>;

export const OPERATING_SETTINGS_DEFAULTS: VenueOperatingSettings = {
  escalationNowSeconds: 120,
  escalationSoonSeconds: 300,
  escalationRoutineSeconds: 900,
  quietHoursStart: "22:00",
  quietHoursEnd: "07:00",
  dutyAdminUserId: null,
  dayBoundaryHour: 4,
  handoverReliefSeconds: 300,
  wallShowsGuestDetails: false,
};

/** The window before an unowned request of this urgency escalates. */
export function escalationWindowSeconds(
  settings: Pick<VenueOperatingSettings, "escalationNowSeconds" | "escalationSoonSeconds" | "escalationRoutineSeconds">,
  urgency: RequestUrgency,
): number {
  switch (urgency) {
    case "now": return settings.escalationNowSeconds;
    case "soon": return settings.escalationSoonSeconds;
    case "routine": return settings.escalationRoutineSeconds;
  }
}
