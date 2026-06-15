import { z } from "zod";
import { EventIdSchema, EventPhaseIdSchema, EventPhaseSchema, EventSchema } from "./event-phase-graph.js";
import { HandoffPackIdSchema, OpsHandoffPackBundleSchema, OpsTaskIdSchema, OpsTaskStatusSchema, SafeOpsTextSchema, SupplierInstructionIdSchema } from "./ops-compiler.js";
import { UserIdSchema } from "./user.js";

// ---------------------------------------------------------------------------
// Event-day mobile ops v0
//
// Live execution state for hallkeepers and venue operations staff. Immutable
// handoff packs stay in ops-compiler; this module only models day-of status,
// issue, assignment, and board read payloads.
// ---------------------------------------------------------------------------

const UUID = z.string().uuid();

export const EventDayIssueIdSchema = UUID;
export type EventDayIssueId = z.infer<typeof EventDayIssueIdSchema>;

export const TaskAssignmentIdSchema = UUID;
export type TaskAssignmentId = z.infer<typeof TaskAssignmentIdSchema>;

export const TaskCompletionEventIdSchema = UUID;
export type TaskCompletionEventId = z.infer<typeof TaskCompletionEventIdSchema>;

export const OpsStatusUpdateIdSchema = UUID;
export type OpsStatusUpdateId = z.infer<typeof OpsStatusUpdateIdSchema>;

export const EventDayIssueStatusSchema = z.enum(["open", "in_progress", "resolved", "closed"]);
export type EventDayIssueStatus = z.infer<typeof EventDayIssueStatusSchema>;

export const EventDayIssueSeveritySchema = z.enum(["info", "attention", "urgent"]);
export type EventDayIssueSeverity = z.infer<typeof EventDayIssueSeveritySchema>;

export const EventDayIssueSourceSchema = z.enum(["hallkeeper", "staff", "system"]);
export type EventDayIssueSource = z.infer<typeof EventDayIssueSourceSchema>;

export const TaskAssignmentStatusSchema = z.enum(["assigned", "accepted", "released"]);
export type TaskAssignmentStatus = z.infer<typeof TaskAssignmentStatusSchema>;

export const OpsStatusUpdateKindSchema = z.enum(["phase", "setup", "supplier", "escalation", "general"]);
export type OpsStatusUpdateKind = z.infer<typeof OpsStatusUpdateKindSchema>;

export const EventDaySafeTextSchema = SafeOpsTextSchema;
export type EventDaySafeText = z.infer<typeof EventDaySafeTextSchema>;

export const EventDayIssueSchema = z.object({
  id: EventDayIssueIdSchema,
  eventId: EventIdSchema,
  phaseId: EventPhaseIdSchema.nullable(),
  opsTaskId: OpsTaskIdSchema.nullable(),
  title: z.string().trim().min(1).max(180),
  detail: EventDaySafeTextSchema,
  status: EventDayIssueStatusSchema,
  severity: EventDayIssueSeveritySchema,
  source: EventDayIssueSourceSchema,
  reportedBy: UserIdSchema.nullable(),
  assignedTo: UserIdSchema.nullable(),
  escalationNote: EventDaySafeTextSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
}).strict();
export type EventDayIssue = z.infer<typeof EventDayIssueSchema>;

export const TaskAssignmentSchema = z.object({
  id: TaskAssignmentIdSchema,
  opsTaskId: OpsTaskIdSchema,
  eventId: EventIdSchema,
  assignedTo: UserIdSchema.nullable(),
  assigneeLabel: z.string().trim().min(1).max(160).nullable(),
  roleLabel: z.string().trim().min(1).max(80).nullable(),
  status: TaskAssignmentStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type TaskAssignment = z.infer<typeof TaskAssignmentSchema>;

export const TaskCompletionEventSchema = z.object({
  id: TaskCompletionEventIdSchema,
  opsTaskId: OpsTaskIdSchema,
  eventId: EventIdSchema,
  actorUserId: UserIdSchema.nullable(),
  fromStatus: OpsTaskStatusSchema,
  toStatus: OpsTaskStatusSchema,
  idempotencyKey: z.string().trim().min(1).max(160).nullable(),
  note: EventDaySafeTextSchema.nullable(),
  createdAt: z.string().datetime(),
}).strict();
export type TaskCompletionEvent = z.infer<typeof TaskCompletionEventSchema>;

export const OpsStatusUpdateSchema = z.object({
  id: OpsStatusUpdateIdSchema,
  eventId: EventIdSchema,
  phaseId: EventPhaseIdSchema.nullable(),
  kind: OpsStatusUpdateKindSchema,
  message: EventDaySafeTextSchema,
  createdBy: UserIdSchema.nullable(),
  createdAt: z.string().datetime(),
}).strict();
export type OpsStatusUpdate = z.infer<typeof OpsStatusUpdateSchema>;

export const EventDaySetupProgressSchema = z.object({
  totalTasks: z.number().int().nonnegative(),
  doneTasks: z.number().int().nonnegative(),
  blockedTasks: z.number().int().nonnegative(),
  activeTasks: z.number().int().nonnegative(),
  percent: z.number().min(0).max(100),
}).strict();
export type EventDaySetupProgress = z.infer<typeof EventDaySetupProgressSchema>;

export const EventDaySupplierArrivalSchema = z.object({
  instructionId: SupplierInstructionIdSchema,
  title: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(80),
  arrivalWindow: z.string().trim().min(1).max(120).nullable(),
  detail: EventDaySafeTextSchema,
  statusLabel: z.string().trim().min(1).max(120),
}).strict();
export type EventDaySupplierArrival = z.infer<typeof EventDaySupplierArrivalSchema>;

export const EventDayChangesSinceLastHandoffSchema = z.object({
  handoffPackId: HandoffPackIdSchema.nullable(),
  summary: EventDaySafeTextSchema,
  added: z.array(z.string().trim().min(1).max(200)),
  removed: z.array(z.string().trim().min(1).max(200)),
  changed: z.array(z.string().trim().min(1).max(240)),
  currentSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  previousSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
}).strict();
export type EventDayChangesSinceLastHandoff = z.infer<typeof EventDayChangesSinceLastHandoffSchema>;

export const EventDayOpsBoardSchema = z.object({
  event: EventSchema,
  phases: z.array(EventPhaseSchema),
  handoffPack: OpsHandoffPackBundleSchema.nullable(),
  assignments: z.array(TaskAssignmentSchema),
  issues: z.array(EventDayIssueSchema),
  statusUpdates: z.array(OpsStatusUpdateSchema),
  setupProgress: EventDaySetupProgressSchema,
  supplierArrivals: z.array(EventDaySupplierArrivalSchema),
  escalationNotes: z.array(EventDaySafeTextSchema),
  changesSinceLastHandoff: EventDayChangesSinceLastHandoffSchema,
  sourceStatus: z.enum(["ready", "missing_handoff"]),
}).strict();
export type EventDayOpsBoard = z.infer<typeof EventDayOpsBoardSchema>;

export const UpdateOpsTaskStatusInputSchema = z.object({
  status: OpsTaskStatusSchema,
  idempotencyKey: z.string().trim().min(1).max(160).optional(),
  note: EventDaySafeTextSchema.nullable().optional(),
}).strict();
export type UpdateOpsTaskStatusInput = z.infer<typeof UpdateOpsTaskStatusInputSchema>;

export const CreateEventDayIssueInputSchema = z.object({
  phaseId: EventPhaseIdSchema.nullable().optional(),
  opsTaskId: OpsTaskIdSchema.nullable().optional(),
  title: z.string().trim().min(1).max(180),
  detail: EventDaySafeTextSchema,
  severity: EventDayIssueSeveritySchema.default("attention"),
  escalationNote: EventDaySafeTextSchema.nullable().optional(),
}).strict();
export type CreateEventDayIssueInput = z.infer<typeof CreateEventDayIssueInputSchema>;

export const UpdateEventDayIssueInputSchema = z.object({
  status: EventDayIssueStatusSchema.optional(),
  severity: EventDayIssueSeveritySchema.optional(),
  title: z.string().trim().min(1).max(180).optional(),
  detail: EventDaySafeTextSchema.optional(),
  assignedTo: UserIdSchema.nullable().optional(),
  escalationNote: EventDaySafeTextSchema.nullable().optional(),
}).strict().refine((input) => Object.keys(input).length > 0, {
  message: "At least one issue field must be provided.",
});
export type UpdateEventDayIssueInput = z.infer<typeof UpdateEventDayIssueInputSchema>;
