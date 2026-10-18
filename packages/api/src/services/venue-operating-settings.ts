import { and, eq, inArray } from "drizzle-orm";
import {
  OPERATING_SETTINGS_DEFAULTS,
  type UpdateVenueOperatingSettings,
  type VenueOperatingSettings,
} from "@omnitwin/types";
import { users, venueSettings } from "../db/schema.js";
import type { Database } from "../db/client.js";

// ---------------------------------------------------------------------------
// The venue's operating settings (goal 19 S7): one row per venue, read by the
// escalation sweep, the office's presence line and the wall. A venue with no
// row has no windows and never escalates, as slice 10 decided; the first
// write creates the row with Blake's defaults and the change on top.
// ---------------------------------------------------------------------------

/** Postgres gives a `time` back as "HH:MM:SS"; the settings speak "HH:MM". */
function clockFace(time: string): string {
  return time.slice(0, 5);
}

function serialize(row: typeof venueSettings.$inferSelect): VenueOperatingSettings {
  return {
    escalationNowSeconds: row.escalationNowSeconds,
    escalationSoonSeconds: row.escalationSoonSeconds,
    escalationRoutineSeconds: row.escalationRoutineSeconds,
    quietHoursStart: clockFace(row.quietHoursStart),
    quietHoursEnd: clockFace(row.quietHoursEnd),
    dutyAdminUserId: row.dutyAdminUserId,
    dayBoundaryHour: row.dayBoundaryHour,
    handoverReliefSeconds: row.handoverReliefSeconds,
    wallShowsGuestDetails: row.wallShowsGuestDetails,
  };
}

export async function readOperatingSettings(db: Database, venueId: string): Promise<VenueOperatingSettings | null> {
  const [row] = await db.select().from(venueSettings).where(eq(venueSettings.venueId, venueId)).limit(1);
  return row === undefined ? null : serialize(row);
}

export type WriteOperatingSettingsResult =
  | { readonly ok: true; readonly settings: VenueOperatingSettings }
  | { readonly ok: false; readonly code: "DUTY_ADMIN_NOT_IN_VENUE" };

/** The roles a duty admin may hold: the venue's administrators, or a manager
 *  where the people matrix lets one stand in. */
const DUTY_ADMIN_ROLES = ["admin", "manager"] as const;

export async function writeOperatingSettings(
  db: Database,
  venueId: string,
  patch: UpdateVenueOperatingSettings,
): Promise<WriteOperatingSettingsResult> {
  if (patch.dutyAdminUserId !== undefined && patch.dutyAdminUserId !== null) {
    const [person] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(
        eq(users.id, patch.dutyAdminUserId),
        eq(users.venueId, venueId),
        inArray(users.role, [...DUTY_ADMIN_ROLES]),
      ))
      .limit(1);
    if (person === undefined) return { ok: false, code: "DUTY_ADMIN_NOT_IN_VENUE" };
  }

  const current = await readOperatingSettings(db, venueId);
  const next: VenueOperatingSettings = { ...(current ?? OPERATING_SETTINGS_DEFAULTS), ...patch };
  const now = new Date();
  const columns = {
    // Slice 10's column is still NOT NULL; it mirrors the "now" window
    // until a later migration drops it.
    requestEscalationSeconds: next.escalationNowSeconds,
    escalationNowSeconds: next.escalationNowSeconds,
    escalationSoonSeconds: next.escalationSoonSeconds,
    escalationRoutineSeconds: next.escalationRoutineSeconds,
    quietHoursStart: next.quietHoursStart,
    quietHoursEnd: next.quietHoursEnd,
    dutyAdminUserId: next.dutyAdminUserId,
    dayBoundaryHour: next.dayBoundaryHour,
    handoverReliefSeconds: next.handoverReliefSeconds,
    wallShowsGuestDetails: next.wallShowsGuestDetails,
    updatedAt: now,
  };
  const [row] = await db
    .insert(venueSettings)
    .values({ venueId, createdAt: now, ...columns })
    .onConflictDoUpdate({ target: venueSettings.venueId, set: columns })
    .returning();
  if (row === undefined) throw new Error("venue_settings upsert returned no row");
  return { ok: true, settings: serialize(row) };
}
