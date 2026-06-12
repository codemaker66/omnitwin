import { z } from "zod";
import { ConfigurationIdSchema } from "./configuration.js";
import { VenueIdSchema } from "./venue.js";
import { UserIdSchema } from "./user.js";

// ---------------------------------------------------------------------------
// Event Phase Graph v0
//
// First-class event, phase, scenario, and layout-variant contracts. These are
// planning data contracts only. Density and staff-conflict fields intentionally
// fail closed as "not_checked" until a later Guest Flow Replay implementation
// can populate simulated outputs.
// ---------------------------------------------------------------------------

export const EVENT_STATUSES = [
  "draft",
  "proposed",
  "confirmed",
  "in_planning",
  "ready_for_ops",
  "executed",
  "closed",
  "cancelled",
] as const;

export const EventStatusSchema = z.enum(EVENT_STATUSES);
export type EventStatus = z.infer<typeof EventStatusSchema>;

export const EVENT_PHASE_TEMPLATE_KEYS = [
  "arrival",
  "ceremony",
  "room-flip",
  "dinner",
  "speeches",
  "bar-queue",
  "dancing",
  "breakdown",
] as const;

export const EventPhaseTemplateKeySchema = z.enum(EVENT_PHASE_TEMPLATE_KEYS);
export type EventPhaseTemplateKey = z.infer<typeof EventPhaseTemplateKeySchema>;

export interface DefaultEventPhaseTemplateEntry {
  readonly key: EventPhaseTemplateKey;
  readonly label: string;
  readonly defaultDurationMinutes: number;
}

export const DEFAULT_EVENT_PHASE_TEMPLATE: readonly DefaultEventPhaseTemplateEntry[] = [
  { key: "arrival", label: "Arrival", defaultDurationMinutes: 30 },
  { key: "ceremony", label: "Ceremony", defaultDurationMinutes: 45 },
  { key: "room-flip", label: "Room Flip", defaultDurationMinutes: 45 },
  { key: "dinner", label: "Dinner", defaultDurationMinutes: 90 },
  { key: "speeches", label: "Speeches", defaultDurationMinutes: 30 },
  { key: "bar-queue", label: "Bar Queue", defaultDurationMinutes: 45 },
  { key: "dancing", label: "Dancing", defaultDurationMinutes: 90 },
  { key: "breakdown", label: "Breakdown", defaultDurationMinutes: 45 },
] as const;

export const EventIdSchema = z.string().uuid();
export const EventPhaseIdSchema = z.string().uuid();
export const EventScenarioIdSchema = z.string().uuid();
export const LayoutVariantIdSchema = z.string().uuid();
export const EventConfigurationLinkIdSchema = z.string().uuid();
export const PhaseLayoutSnapshotIdSchema = z.string().uuid();

export type EventId = z.infer<typeof EventIdSchema>;
export type EventPhaseId = z.infer<typeof EventPhaseIdSchema>;
export type EventScenarioId = z.infer<typeof EventScenarioIdSchema>;
export type LayoutVariantId = z.infer<typeof LayoutVariantIdSchema>;
export type EventConfigurationLinkId = z.infer<typeof EventConfigurationLinkIdSchema>;
export type PhaseLayoutSnapshotId = z.infer<typeof PhaseLayoutSnapshotIdSchema>;

export const PhaseEvidencePlaceholderSchema = z.enum([
  "not_checked",
  "missing_inputs",
  "simulated",
  "current",
  "stale",
]);
export type PhaseEvidencePlaceholder = z.infer<typeof PhaseEvidencePlaceholderSchema>;

export const LayoutVariantStatusSchema = z.enum(["draft", "candidate", "approved", "archived"]);
export type LayoutVariantStatus = z.infer<typeof LayoutVariantStatusSchema>;

export const EventScenarioStatusSchema = z.enum(["draft", "ready_for_inputs", "queued", "completed", "stale", "cancelled"]);
export type EventScenarioStatus = z.infer<typeof EventScenarioStatusSchema>;

export const EventConfigurationLinkTypeSchema = z.enum([
  "source_configuration",
  "variant_configuration",
  "approved_snapshot_source",
]);
export type EventConfigurationLinkType = z.infer<typeof EventConfigurationLinkTypeSchema>;

export const PhaseLayoutSnapshotStatusSchema = z.enum(["draft", "frozen", "stale", "superseded"]);
export type PhaseLayoutSnapshotStatus = z.infer<typeof PhaseLayoutSnapshotStatusSchema>;

export const EventSchema = z.object({
  id: EventIdSchema,
  venueId: VenueIdSchema,
  createdBy: UserIdSchema.nullable(),
  name: z.string().trim().min(1).max(200),
  eventType: z.string().trim().max(80).nullable(),
  status: EventStatusSchema,
  startsAt: z.string().datetime().nullable(),
  endsAt: z.string().datetime().nullable(),
  guestCount: z.number().int().nonnegative(),
  clientName: z.string().trim().max(200).nullable(),
  notes: z.string().max(4000).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Event = z.infer<typeof EventSchema>;

export const EventPhaseSchema = z.object({
  id: EventPhaseIdSchema,
  eventId: EventIdSchema,
  templateKey: EventPhaseTemplateKeySchema.nullable(),
  name: z.string().trim().min(1).max(100),
  sortOrder: z.number().int().nonnegative(),
  startsAt: z.string().datetime().nullable(),
  durationMinutes: z.number().int().nonnegative(),
  guestCount: z.number().int().nonnegative().nullable(),
  opsTasksCount: z.number().int().nonnegative(),
  reviewGatesCount: z.number().int().nonnegative(),
  densityStatus: PhaseEvidencePlaceholderSchema,
  densityLabel: z.string().trim().min(1).max(120),
  staffConflictsStatus: PhaseEvidencePlaceholderSchema,
  staffConflictsLabel: z.string().trim().min(1).max(120),
  notes: z.string().max(2000).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type EventPhase = z.infer<typeof EventPhaseSchema>;

export const EventScenarioSchema = z.object({
  id: EventScenarioIdSchema,
  eventId: EventIdSchema,
  phaseId: EventPhaseIdSchema.nullable(),
  name: z.string().trim().min(1).max(160),
  status: EventScenarioStatusSchema,
  assumptions: z.record(z.unknown()),
  seed: z.number().int().nonnegative().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type EventScenario = z.infer<typeof EventScenarioSchema>;

export const LayoutVariantSchema = z.object({
  id: LayoutVariantIdSchema,
  eventId: EventIdSchema,
  configurationId: ConfigurationIdSchema.nullable(),
  name: z.string().trim().min(1).max(160),
  status: LayoutVariantStatusSchema,
  guestCount: z.number().int().nonnegative().nullable(),
  notes: z.string().max(2000).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type LayoutVariant = z.infer<typeof LayoutVariantSchema>;

export const EventConfigurationLinkSchema = z.object({
  id: EventConfigurationLinkIdSchema,
  eventId: EventIdSchema,
  configurationId: ConfigurationIdSchema,
  layoutVariantId: LayoutVariantIdSchema.nullable(),
  linkType: EventConfigurationLinkTypeSchema,
  createdAt: z.string().datetime(),
});
export type EventConfigurationLink = z.infer<typeof EventConfigurationLinkSchema>;

export const PhaseLayoutSnapshotSchema = z.object({
  id: PhaseLayoutSnapshotIdSchema,
  eventPhaseId: EventPhaseIdSchema,
  layoutVariantId: LayoutVariantIdSchema.nullable(),
  configurationId: ConfigurationIdSchema.nullable(),
  snapshotHash: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  status: PhaseLayoutSnapshotStatusSchema,
  objectCount: z.number().int().nonnegative(),
  guestCount: z.number().int().nonnegative().nullable(),
  payload: z.record(z.unknown()).nullable(),
  createdAt: z.string().datetime(),
  frozenAt: z.string().datetime().nullable(),
});
export type PhaseLayoutSnapshot = z.infer<typeof PhaseLayoutSnapshotSchema>;

export const CreateEventSchema = z.object({
  venueId: VenueIdSchema,
  name: z.string().trim().min(1).max(200),
  eventType: z.string().trim().max(80).nullable().optional(),
  status: EventStatusSchema.default("draft"),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  guestCount: z.number().int().nonnegative().default(0),
  clientName: z.string().trim().max(200).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});
export type CreateEvent = z.infer<typeof CreateEventSchema>;

export const UpdateEventSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  eventType: z.string().trim().max(80).nullable().optional(),
  status: EventStatusSchema.optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  guestCount: z.number().int().nonnegative().optional(),
  clientName: z.string().trim().max(200).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});
export type UpdateEvent = z.infer<typeof UpdateEventSchema>;

export const CreateEventPhaseSchema = z.object({
  templateKey: EventPhaseTemplateKeySchema.nullable().optional(),
  name: z.string().trim().min(1).max(100),
  startsAt: z.string().datetime().nullable().optional(),
  durationMinutes: z.number().int().nonnegative().default(30),
  guestCount: z.number().int().nonnegative().nullable().optional(),
  opsTasksCount: z.number().int().nonnegative().default(0),
  reviewGatesCount: z.number().int().nonnegative().default(0),
  notes: z.string().max(2000).nullable().optional(),
});
export type CreateEventPhase = z.infer<typeof CreateEventPhaseSchema>;

export const UpdateEventPhaseSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  startsAt: z.string().datetime().nullable().optional(),
  durationMinutes: z.number().int().nonnegative().optional(),
  guestCount: z.number().int().nonnegative().nullable().optional(),
  opsTasksCount: z.number().int().nonnegative().optional(),
  reviewGatesCount: z.number().int().nonnegative().optional(),
  densityStatus: PhaseEvidencePlaceholderSchema.optional(),
  densityLabel: z.string().trim().min(1).max(120).optional(),
  staffConflictsStatus: PhaseEvidencePlaceholderSchema.optional(),
  staffConflictsLabel: z.string().trim().min(1).max(120).optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type UpdateEventPhase = z.infer<typeof UpdateEventPhaseSchema>;

export const CreateEventScenarioSchema = z.object({
  phaseId: EventPhaseIdSchema.nullable().optional(),
  name: z.string().trim().min(1).max(160),
  status: EventScenarioStatusSchema.default("draft"),
  assumptions: z.record(z.unknown()).default({}),
  seed: z.number().int().nonnegative().nullable().optional(),
});
export type CreateEventScenario = z.infer<typeof CreateEventScenarioSchema>;

export const CreateLayoutVariantSchema = z.object({
  configurationId: ConfigurationIdSchema.nullable().optional(),
  name: z.string().trim().min(1).max(160),
  status: LayoutVariantStatusSchema.default("draft"),
  guestCount: z.number().int().nonnegative().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type CreateLayoutVariant = z.infer<typeof CreateLayoutVariantSchema>;

export const EventPhaseGraphSchema = z.object({
  event: EventSchema,
  phases: z.array(EventPhaseSchema),
  scenarios: z.array(EventScenarioSchema),
  layoutVariants: z.array(LayoutVariantSchema),
  configurationLinks: z.array(EventConfigurationLinkSchema),
  phaseLayoutSnapshots: z.array(PhaseLayoutSnapshotSchema),
});
export type EventPhaseGraph = z.infer<typeof EventPhaseGraphSchema>;

export function defaultEventPhaseInputs(): readonly CreateEventPhase[] {
  return DEFAULT_EVENT_PHASE_TEMPLATE.map((entry) => ({
    templateKey: entry.key,
    name: entry.label,
    durationMinutes: entry.defaultDurationMinutes,
    guestCount: null,
    opsTasksCount: 0,
    reviewGatesCount: 0,
    notes: null,
  }));
}
