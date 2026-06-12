import { and, desc, eq, isNull } from "drizzle-orm";
import {
  CreateEventDayIssueInputSchema,
  EventDayChangesSinceLastHandoffSchema,
  EventDayIssueSchema,
  EventDayOpsBoardSchema,
  EventDaySafeTextSchema,
  EventDaySetupProgressSchema,
  EventDaySupplierArrivalSchema,
  EventPhaseSchema,
  EventSchema,
  OpsStatusUpdateSchema,
  OpsTaskSchema,
  TaskAssignmentSchema,
  TaskCompletionEventSchema,
  UpdateEventDayIssueInputSchema,
  UpdateOpsTaskStatusInputSchema,
  safePlanningLanguage,
  type CreateEventDayIssueInput,
  type Event,
  type EventDayChangesSinceLastHandoff,
  type EventDayIssue,
  type EventDayOpsBoard,
  type EventDaySetupProgress,
  type EventDaySupplierArrival,
  type EventPhase,
  type OpsStatusUpdate,
  type OpsTask,
  type OpsTaskStatus,
  type TaskAssignment,
  type TaskCompletionEvent,
  type UpdateEventDayIssueInput,
  type UpdateOpsTaskStatusInput,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import {
  eventDayIssues,
  eventPhases,
  events,
  handoffPacks,
  opsStatusUpdates,
  opsTasks,
  taskAssignments,
  taskCompletionEvents,
} from "../db/schema.js";
import { getOpsHandoffPackBundle } from "./ops-compiler.js";

type EventRow = typeof events.$inferSelect;
type EventPhaseRow = typeof eventPhases.$inferSelect;
type OpsTaskRow = typeof opsTasks.$inferSelect;
type EventDayIssueRow = typeof eventDayIssues.$inferSelect;
type TaskAssignmentRow = typeof taskAssignments.$inferSelect;
type TaskCompletionEventRow = typeof taskCompletionEvents.$inferSelect;
type OpsStatusUpdateRow = typeof opsStatusUpdates.$inferSelect;

export interface TaskStatusTransition {
  readonly changed: boolean;
  readonly fromStatus: OpsTaskStatus;
  readonly toStatus: OpsTaskStatus;
}

export interface UpdateOpsTaskStatusResult {
  readonly task: OpsTask;
  readonly completionEvent: TaskCompletionEvent | null;
  readonly idempotentReplay: boolean;
}

export class EventDayTaskNotFoundError extends Error {}
export class EventDayIssueNotFoundError extends Error {}

function toIso(value: Date): string {
  return value.toISOString();
}

function toIsoOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function safeEventDayText(text: string, maxLength = 3600): string {
  const cleaned = safePlanningLanguage(text).trim();
  const fallback = cleaned.length > 0 ? cleaned : "No event-day note was captured.";
  const bounded = fallback.length <= maxLength ? fallback : `${fallback.slice(0, maxLength - 3).trim()}...`;
  return EventDaySafeTextSchema.parse(bounded);
}

export function resolveTaskStatusTransition(
  fromStatus: OpsTaskStatus,
  toStatus: OpsTaskStatus,
): TaskStatusTransition {
  return {
    changed: fromStatus !== toStatus,
    fromStatus,
    toStatus,
  };
}

function serializeEvent(row: EventRow): Event {
  return EventSchema.parse({
    id: row.id,
    venueId: row.venueId,
    createdBy: row.createdBy,
    name: row.name,
    eventType: row.eventType,
    status: row.status,
    startsAt: toIsoOrNull(row.startsAt),
    endsAt: toIsoOrNull(row.endsAt),
    guestCount: row.guestCount,
    clientName: row.clientName,
    notes: row.notes,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  });
}

function serializePhase(row: EventPhaseRow): EventPhase {
  return EventPhaseSchema.parse({
    id: row.id,
    eventId: row.eventId,
    templateKey: row.templateKey,
    name: row.name,
    sortOrder: row.sortOrder,
    startsAt: toIsoOrNull(row.startsAt),
    durationMinutes: row.durationMinutes,
    guestCount: row.guestCount,
    opsTasksCount: row.opsTasksCount,
    reviewGatesCount: row.reviewGatesCount,
    densityStatus: row.densityStatus,
    densityLabel: row.densityLabel,
    staffConflictsStatus: row.staffConflictsStatus,
    staffConflictsLabel: row.staffConflictsLabel,
    notes: row.notes,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  });
}

function serializeOpsTask(row: OpsTaskRow): OpsTask {
  return OpsTaskSchema.parse({
    id: row.id,
    handoffPackId: row.handoffPackId,
    taskGroupId: row.taskGroupId,
    phaseId: row.phaseId,
    kind: row.kind,
    title: row.title,
    detail: row.detail,
    status: row.status,
    sortOrder: row.sortOrder,
    dueLabel: row.dueLabel,
    sourceRef: row.sourceRef,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  });
}

function serializeIssue(row: EventDayIssueRow): EventDayIssue {
  return EventDayIssueSchema.parse({
    id: row.id,
    eventId: row.eventId,
    phaseId: row.phaseId,
    opsTaskId: row.opsTaskId,
    title: row.title,
    detail: row.detail,
    status: row.status,
    severity: row.severity,
    source: row.source,
    reportedBy: row.reportedBy,
    assignedTo: row.assignedTo,
    escalationNote: row.escalationNote,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    resolvedAt: toIsoOrNull(row.resolvedAt),
  });
}

function serializeAssignment(row: TaskAssignmentRow): TaskAssignment {
  return TaskAssignmentSchema.parse({
    id: row.id,
    opsTaskId: row.opsTaskId,
    eventId: row.eventId,
    assignedTo: row.assignedTo,
    assigneeLabel: row.assigneeLabel,
    roleLabel: row.roleLabel,
    status: row.status,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  });
}

function serializeCompletionEvent(row: TaskCompletionEventRow): TaskCompletionEvent {
  return TaskCompletionEventSchema.parse({
    id: row.id,
    opsTaskId: row.opsTaskId,
    eventId: row.eventId,
    actorUserId: row.actorUserId,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    idempotencyKey: row.idempotencyKey,
    note: row.note,
    createdAt: toIso(row.createdAt),
  });
}

function serializeStatusUpdate(row: OpsStatusUpdateRow): OpsStatusUpdate {
  return OpsStatusUpdateSchema.parse({
    id: row.id,
    eventId: row.eventId,
    phaseId: row.phaseId,
    kind: row.kind,
    message: row.message,
    createdBy: row.createdBy,
    createdAt: toIso(row.createdAt),
  });
}

function buildSetupProgress(tasks: readonly OpsTask[]): EventDaySetupProgress {
  const totalTasks = tasks.length;
  const doneTasks = tasks.filter((task) => task.status === "done").length;
  const blockedTasks = tasks.filter((task) => task.status === "blocked").length;
  const activeTasks = tasks.filter((task) => task.status !== "done" && task.status !== "blocked" && task.status !== "waived").length;
  const percent = totalTasks === 0 ? 0 : Math.round((doneTasks / totalTasks) * 100);
  return EventDaySetupProgressSchema.parse({ totalTasks, doneTasks, blockedTasks, activeTasks, percent });
}

function buildSupplierArrivals(bundle: NonNullable<EventDayOpsBoard["handoffPack"]>): readonly EventDaySupplierArrival[] {
  return bundle.supplierInstructions.map((instruction) => EventDaySupplierArrivalSchema.parse({
    instructionId: instruction.id,
    title: instruction.title,
    category: instruction.category,
    arrivalWindow: instruction.arrivalWindow,
    detail: instruction.detail,
    statusLabel: instruction.arrivalWindow === null ? "Arrival window not captured" : `Expected ${instruction.arrivalWindow}`,
  }));
}

function buildChanges(bundle: EventDayOpsBoard["handoffPack"]): EventDayChangesSinceLastHandoff {
  if (bundle === null) {
    return EventDayChangesSinceLastHandoffSchema.parse({
      handoffPackId: null,
      summary: "No compiled handoff pack is linked to this event yet.",
      added: [],
      removed: [],
      changed: [],
      currentSnapshotHash: null,
      previousSnapshotHash: null,
    });
  }
  return EventDayChangesSinceLastHandoffSchema.parse({
    handoffPackId: bundle.pack.id,
    summary: bundle.snapshotDiff.summary,
    added: bundle.snapshotDiff.payload.added,
    removed: bundle.snapshotDiff.payload.removed,
    changed: bundle.snapshotDiff.payload.changed,
    currentSnapshotHash: bundle.snapshotDiff.currentSnapshotHash,
    previousSnapshotHash: bundle.snapshotDiff.previousSnapshotHash,
  });
}

function buildEscalationNotes(
  issues: readonly EventDayIssue[],
  updates: readonly OpsStatusUpdate[],
): readonly string[] {
  const notes: string[] = [];
  for (const issue of issues) {
    if (issue.severity === "urgent" && issue.status !== "closed") {
      notes.push(safeEventDayText(issue.escalationNote ?? `${issue.title}: ${issue.detail}`, 500));
    }
  }
  for (const update of updates) {
    if (update.kind === "escalation") {
      notes.push(update.message);
    }
  }
  return notes.slice(0, 8);
}

export async function loadEventForOpsBoard(db: Database, eventId: string): Promise<EventRow | null> {
  const [eventRow] = await db.select().from(events)
    .where(and(eq(events.id, eventId), isNull(events.deletedAt)))
    .limit(1);
  return eventRow ?? null;
}

export async function getEventDayOpsBoard(db: Database, eventRow: EventRow): Promise<EventDayOpsBoard> {
  const [latestPackRow] = await db.select({ id: handoffPacks.id })
    .from(handoffPacks)
    .where(eq(handoffPacks.eventId, eventRow.id))
    .orderBy(desc(handoffPacks.compiledAt))
    .limit(1);

  const handoffPack = latestPackRow === undefined
    ? null
    : await getOpsHandoffPackBundle(db, latestPackRow.id);

  const [phaseRows, assignmentRows, issueRows, updateRows] = await Promise.all([
    db.select().from(eventPhases).where(eq(eventPhases.eventId, eventRow.id)).orderBy(eventPhases.sortOrder),
    db.select().from(taskAssignments).where(eq(taskAssignments.eventId, eventRow.id)).orderBy(taskAssignments.createdAt),
    db.select().from(eventDayIssues).where(eq(eventDayIssues.eventId, eventRow.id)).orderBy(desc(eventDayIssues.createdAt)),
    db.select().from(opsStatusUpdates).where(eq(opsStatusUpdates.eventId, eventRow.id)).orderBy(desc(opsStatusUpdates.createdAt)),
  ]);

  const phases = phaseRows.map(serializePhase);
  const assignments = assignmentRows.map(serializeAssignment);
  const issues = issueRows.map(serializeIssue);
  const statusUpdates = updateRows.map(serializeStatusUpdate);

  return EventDayOpsBoardSchema.parse({
    event: serializeEvent(eventRow),
    phases,
    handoffPack,
    assignments,
    issues,
    statusUpdates,
    setupProgress: buildSetupProgress(handoffPack?.opsTasks ?? []),
    supplierArrivals: handoffPack === null ? [] : buildSupplierArrivals(handoffPack),
    escalationNotes: buildEscalationNotes(issues, statusUpdates),
    changesSinceLastHandoff: buildChanges(handoffPack),
    sourceStatus: handoffPack === null ? "missing_handoff" : "ready",
  });
}

async function loadTaskWithEvent(db: Database, opsTaskId: string): Promise<{
  readonly task: OpsTaskRow;
  readonly event: EventRow;
} | null> {
  const [joined] = await db.select({ task: opsTasks, event: events })
    .from(opsTasks)
    .innerJoin(handoffPacks, eq(opsTasks.handoffPackId, handoffPacks.id))
    .innerJoin(events, eq(handoffPacks.eventId, events.id))
    .where(and(eq(opsTasks.id, opsTaskId), isNull(events.deletedAt)))
    .limit(1);
  return joined ?? null;
}

export async function updateOpsTaskStatus(
  db: Database,
  input: UpdateOpsTaskStatusInput & {
    readonly opsTaskId: string;
    readonly actorUserId: string | null;
  },
): Promise<UpdateOpsTaskStatusResult> {
  const parsed = UpdateOpsTaskStatusInputSchema.parse({
    status: input.status,
    idempotencyKey: input.idempotencyKey,
    note: input.note,
  });
  const joined = await loadTaskWithEvent(db, input.opsTaskId);
  if (joined === null) throw new EventDayTaskNotFoundError(input.opsTaskId);

  if (parsed.idempotencyKey !== undefined) {
    const [existing] = await db.select().from(taskCompletionEvents)
      .where(and(
        eq(taskCompletionEvents.opsTaskId, joined.task.id),
        eq(taskCompletionEvents.idempotencyKey, parsed.idempotencyKey),
      ))
      .limit(1);
    if (existing !== undefined) {
      const reloaded = await loadTaskWithEvent(db, input.opsTaskId);
      return {
        task: serializeOpsTask(reloaded?.task ?? joined.task),
        completionEvent: serializeCompletionEvent(existing),
        idempotentReplay: true,
      };
    }
  }

  const transition = resolveTaskStatusTransition(serializeOpsTask(joined.task).status, parsed.status);
  if (!transition.changed) {
    return {
      task: serializeOpsTask(joined.task),
      completionEvent: null,
      idempotentReplay: parsed.idempotencyKey !== undefined,
    };
  }

  return db.transaction(async (tx) => {
    const [updatedTask] = await tx.update(opsTasks)
      .set({ status: transition.toStatus, updatedAt: new Date() })
      .where(eq(opsTasks.id, joined.task.id))
      .returning();
    if (updatedTask === undefined) throw new EventDayTaskNotFoundError(input.opsTaskId);

    const [completion] = await tx.insert(taskCompletionEvents).values({
      opsTaskId: joined.task.id,
      eventId: joined.event.id,
      actorUserId: input.actorUserId,
      fromStatus: transition.fromStatus,
      toStatus: transition.toStatus,
      idempotencyKey: parsed.idempotencyKey ?? null,
      note: parsed.note ?? null,
    }).returning();
    if (completion === undefined) throw new Error("Task completion event insertion returned no row.");

    await tx.insert(opsStatusUpdates).values({
      eventId: joined.event.id,
      phaseId: updatedTask.phaseId,
      kind: transition.toStatus === "blocked" ? "escalation" : "setup",
      message: safeEventDayText(`Task "${updatedTask.title}" moved from ${transition.fromStatus} to ${transition.toStatus}.`, 500),
      createdBy: input.actorUserId,
    });

    return {
      task: serializeOpsTask(updatedTask),
      completionEvent: serializeCompletionEvent(completion),
      idempotentReplay: false,
    };
  });
}

export async function createEventDayIssue(
  db: Database,
  input: CreateEventDayIssueInput & {
    readonly eventId: string;
    readonly actorUserId: string | null;
  },
): Promise<EventDayIssue> {
  const parsed = CreateEventDayIssueInputSchema.parse({
    phaseId: input.phaseId,
    opsTaskId: input.opsTaskId,
    title: input.title,
    detail: input.detail,
    severity: input.severity,
    escalationNote: input.escalationNote,
  });

  return db.transaction(async (tx) => {
    const [created] = await tx.insert(eventDayIssues).values({
      eventId: input.eventId,
      phaseId: parsed.phaseId ?? null,
      opsTaskId: parsed.opsTaskId ?? null,
      title: parsed.title,
      detail: parsed.detail,
      status: "open",
      severity: parsed.severity,
      source: "hallkeeper",
      reportedBy: input.actorUserId,
      assignedTo: null,
      escalationNote: parsed.escalationNote ?? null,
    }).returning();
    if (created === undefined) throw new Error("Event-day issue insertion returned no row.");

    await tx.insert(opsStatusUpdates).values({
      eventId: input.eventId,
      phaseId: created.phaseId,
      kind: parsed.severity === "urgent" ? "escalation" : "general",
      message: safeEventDayText(`Issue logged: ${created.title}.`, 500),
      createdBy: input.actorUserId,
    });

    return serializeIssue(created);
  });
}

export async function updateEventDayIssue(
  db: Database,
  input: UpdateEventDayIssueInput & {
    readonly eventId: string;
    readonly issueId: string;
    readonly actorUserId: string | null;
  },
): Promise<EventDayIssue> {
  const parsed = UpdateEventDayIssueInputSchema.parse({
    status: input.status,
    severity: input.severity,
    title: input.title,
    detail: input.detail,
    assignedTo: input.assignedTo,
    escalationNote: input.escalationNote,
  });

  const [existing] = await db.select().from(eventDayIssues)
    .where(and(eq(eventDayIssues.id, input.issueId), eq(eventDayIssues.eventId, input.eventId)))
    .limit(1);
  if (existing === undefined) throw new EventDayIssueNotFoundError(input.issueId);

  const nextStatus = parsed.status ?? existing.status;
  const resolvedAt = nextStatus === "resolved" || nextStatus === "closed"
    ? existing.resolvedAt ?? new Date()
    : null;

  return db.transaction(async (tx) => {
    const [updated] = await tx.update(eventDayIssues).set({
      title: parsed.title ?? existing.title,
      detail: parsed.detail ?? existing.detail,
      severity: parsed.severity ?? existing.severity,
      status: nextStatus,
      assignedTo: parsed.assignedTo === undefined ? existing.assignedTo : parsed.assignedTo,
      escalationNote: parsed.escalationNote === undefined ? existing.escalationNote : parsed.escalationNote,
      resolvedAt,
      updatedAt: new Date(),
    }).where(eq(eventDayIssues.id, existing.id)).returning();
    if (updated === undefined) throw new EventDayIssueNotFoundError(input.issueId);

    await tx.insert(opsStatusUpdates).values({
      eventId: input.eventId,
      phaseId: updated.phaseId,
      kind: updated.severity === "urgent" && updated.status !== "closed" ? "escalation" : "general",
      message: safeEventDayText(`Issue "${updated.title}" updated to ${updated.status}.`, 500),
      createdBy: input.actorUserId,
    });

    return serializeIssue(updated);
  });
}
