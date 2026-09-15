import {
  EventPlanAudienceRoleSchema,
  type EventPlanAudienceRole,
  type EventPlanNotificationSeverity,
} from "@omnitwin/types";
import { eventPlanNotifications } from "../db/schema.js";
import type { Database } from "../db/client.js";

// ---------------------------------------------------------------------------
// Commercial notifications — the ones that fire without an event.
//
// `recordEventPlanChange` is the operational spine: it writes an
// `event_plan_changes` row first, and that table's `event_id` is NOT NULL.
// So every notification the product could raise had to hang off an event.
// A public enquiry has no event. A proposal with no linked configuration has
// no event either. Both used to fall silently through
// `recordProposalLifecycleChange`'s `if (context === null) return;`, which is
// how "a client accepted the proposal" reached nobody.
//
// `event_plan_notifications` already allows a null `change_id` and `event_id`
// (schema.ts), and the notification list route already admits event-less rows
// through `notificationEventScope`'s `personal` branch while still requiring
// the reader's venue and role to match. So a venue-scoped, event-less
// notification is representable today — no migration, no schema change.
// ---------------------------------------------------------------------------

/**
 * Who hears about commercial events. Filtered against the live audience-role
 * vocabulary at module load, so this list can name a role the deployed role
 * set does not have yet ("sales", added by the roles lane) without throwing:
 * the role simply starts being notified the moment it exists.
 */
const COMMERCIAL_AUDIENCE_ROLE_NAMES: readonly string[] = ["staff", "admin", "sales"];

export const COMMERCIAL_AUDIENCE_ROLES: readonly EventPlanAudienceRole[] =
  COMMERCIAL_AUDIENCE_ROLE_NAMES.filter(
    (name): name is EventPlanAudienceRole => EventPlanAudienceRoleSchema.safeParse(name).success,
  );

export interface CommercialNotificationInput {
  readonly venueId: string;
  readonly title: string;
  readonly body: string;
  readonly severity: EventPlanNotificationSeverity;
  /** Where the notification takes the reader. Dashboard `?view=` URLs only —
   *  the same deep-link vocabulary the reviewer email uses. */
  readonly actionPath: string | null;
}

/** Trim to the column's limit rather than letting a long client note fail the
 *  insert and take the enquiry or the acceptance down with it. */
function bounded(value: string, max: number, fallback: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return fallback;
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

/**
 * Raise one venue-scoped notification per commercial audience role.
 * Returns the number of rows written so callers can log a real count.
 */
export async function notifyCommercialTeam(
  db: Database,
  input: CommercialNotificationInput,
): Promise<number> {
  if (COMMERCIAL_AUDIENCE_ROLES.length === 0) return 0;

  const rows = COMMERCIAL_AUDIENCE_ROLES.map((audienceRole) => ({
    changeId: null,
    eventId: null,
    venueId: input.venueId,
    audienceRole,
    recipientUserId: null,
    title: bounded(input.title, 180, "Commercial update"),
    body: bounded(input.body, 1000, "A commercial record changed."),
    severity: input.severity,
    actionPath: input.actionPath === null ? null : bounded(input.actionPath, 500, "/dashboard"),
  }));

  await db.insert(eventPlanNotifications).values(rows);
  return rows.length;
}
