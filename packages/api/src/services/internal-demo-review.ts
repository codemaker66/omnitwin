import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { eventConfigurationLinks, events, eventPhases, generalAuditLog, layoutVariants, phaseLayoutSnapshots } from "../db/schema.js";
import type { JwtUser } from "../middleware/auth.js";
import { canManageVenue } from "../utils/query.js";

// There is no persisted demo flag. This deliberately exact, visible naming
// contract applies to the configuration AND every linked event, not substrings.
export const InternalDemoNameSchema = z.string().max(200).regex(/^DEMO ONLY (?:—|-) \S[^\r\n]*$/u);

export interface DemoReviewConfig {
  readonly id: string;
  readonly name: string;
  readonly venueId: string;
  readonly userId: string | null;
  readonly isPublicPreview: boolean;
  readonly visibility: string;
}

export class InternalDemoReviewForbiddenError extends Error {
  constructor() {
    super("Disabling team notifications requires venue staff or admin, a claimed DEMO ONLY - layout, and only DEMO ONLY - linked events in that venue.");
  }
}

export async function internalDemoReviewScope(
  db: Database, config: DemoReviewConfig, actor: JwtUser, lock = false,
): Promise<readonly string[] | null> {
  if ((actor.role !== "staff" && actor.role !== "admin")
    || !canManageVenue(actor, config.venueId)
    || config.userId === null || config.isPublicPreview || config.visibility !== "private"
    || !InternalDemoNameSchema.safeParse(config.name).success) return null;

  const query = db.select({ id: events.id, name: events.name, venueId: events.venueId })
    .from(eventConfigurationLinks)
    .innerJoin(events, eq(events.id, eventConfigurationLinks.eventId))
    .where(eq(eventConfigurationLinks.configurationId, config.id));
  // The caller holds the configuration FOR UPDATE, preventing new FK links;
  // SHARE locks also keep existing event names and link membership stable.
  const variants = db.select({ id: events.id, name: events.name, venueId: events.venueId })
    .from(layoutVariants).innerJoin(events, eq(events.id, layoutVariants.eventId))
    .where(eq(layoutVariants.configurationId, config.id));
  const phases = db.select({ id: events.id, name: events.name, venueId: events.venueId })
    .from(phaseLayoutSnapshots)
    .innerJoin(eventPhases, eq(eventPhases.id, phaseLayoutSnapshots.eventPhaseId))
    .innerJoin(events, eq(events.id, eventPhases.eventId))
    .where(eq(phaseLayoutSnapshots.configurationId, config.id));
  const rows = [
    ...await (lock ? query.for("share") : query),
    ...await (lock ? variants.for("share") : variants),
    ...await (lock ? phases.for("share") : phases),
  ];
  if (rows.length === 0 || rows.some(row => row.venueId !== config.venueId
    || !InternalDemoNameSchema.safeParse(row.name).success)) return null;
  return [...new Set(rows.map(row => row.id))].sort();
}

export async function recordSuppressedReviewNotifications(
  db: Database, input: {
    readonly configurationId: string;
    readonly snapshotId: string;
    readonly actorUserId: string;
    readonly eventIds: readonly string[];
    readonly transition: "submitted" | "approved";
  },
): Promise<void> {
  await db.insert(generalAuditLog).values({
    actorUserId: input.actorUserId,
    action: "configuration.review.notifications_suppressed",
    targetType: "configuration",
    targetId: input.configurationId,
    summary: `DEMO ONLY review ${input.transition}; team email notifications suppressed by the acting staff/admin.`,
    metadata: {
      schemaVersion: "venviewer.internal-demo-review.v1", notifyTeam: false,
      snapshotId: input.snapshotId, transition: input.transition,
      eventIds: [...input.eventIds], scopeNamePrefixes: ["DEMO ONLY - ", "DEMO ONLY — "],
    },
  });
}
