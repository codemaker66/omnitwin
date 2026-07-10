import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import {
  BeoDocumentSchema,
  EventArchitectCandidateSchema,
  EventConfigurationLinkSchema,
  EventPhaseGraphSchema,
  EventPhaseSchema,
  EventScenarioSchema,
  EventSchema,
  FurniturePickListSchema,
  HandoffPackSchema,
  OpsHandoffPackBundleSchema,
  OpsSequenceStepSchema,
  OpsTaskSchema,
  PickListItemSchema,
  RoomFlipPlanSchema,
  SafeOpsTextSchema,
  SnapshotDiffPayloadSchema,
  SnapshotDiffSchema,
  SupplierInstructionSchema,
  TaskGroupSchema,
  LayoutVariantSchema,
  PhaseLayoutSnapshotSchema,
  opsHandoffPayloadDigest,
  safePlanningLanguage,
  type BeoDocument,
  type ConfigurationSheetSnapshot,
  type EventPhase,
  type EventPhaseGraph,
  type EventMissionSpatialAnchor,
  type EventArchitectGuestFlowEvidence,
  type FurniturePickList,
  type HandoffPack,
  type OpsHandoffPackBundle,
  type OpsSequenceStep,
  type OpsTask,
  type PickListItem,
  type RoomFlipPlan,
  type SnapshotDiff,
  type SnapshotDiffPayload,
  type SupplierInstruction,
  type TaskGroup,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import {
  beoDocuments,
  breakdownSequences,
  configurationSheetSnapshots,
  configurations,
  eventArchitectCandidates,
  eventConfigurationLinks,
  eventPhases,
  eventScenarios,
  events,
  furniturePickLists,
  generalAuditLog,
  handoffPacks,
  layoutVariants,
  loadInSequences,
  opsTasks,
  phaseLayoutSnapshots,
  pickListItems,
  roomFlipPlans,
  snapshotDiffs,
  supplierInstructions,
  taskGroups,
} from "../db/schema.js";
import { parseHallkeeperSnapshotPayload } from "./layout-coordinate-space.js";
import {
  EventArchitectOpsReviewEvidenceIntegrityError,
  getEventArchitectOpsReviewGate,
} from "./event-architect.js";

type SnapshotRow = typeof configurationSheetSnapshots.$inferSelect;
type HandoffPackRow = typeof handoffPacks.$inferSelect;
type TaskGroupRow = typeof taskGroups.$inferSelect;
type OpsTaskRow = typeof opsTasks.$inferSelect;
type FurniturePickListRow = typeof furniturePickLists.$inferSelect;
type PickListItemRow = typeof pickListItems.$inferSelect;
type SupplierInstructionRow = typeof supplierInstructions.$inferSelect;
type LoadInSequenceRow = typeof loadInSequences.$inferSelect;
type BreakdownSequenceRow = typeof breakdownSequences.$inferSelect;
type RoomFlipPlanRow = typeof roomFlipPlans.$inferSelect;
type BeoDocumentRow = typeof beoDocuments.$inferSelect;
type SnapshotDiffRow = typeof snapshotDiffs.$inferSelect;

export class OpsHandoffSourceNotFoundError extends Error {
  constructor(readonly configId: string) {
    super(`Configuration ${configId} was not found.`);
    this.name = "OpsHandoffSourceNotFoundError";
  }
}

export class OpsHandoffApprovedSnapshotRequiredError extends Error {
  constructor(readonly configId: string) {
    super(`Configuration ${configId} does not have an approved snapshot.`);
    this.name = "OpsHandoffApprovedSnapshotRequiredError";
  }
}

export class OpsHandoffEventNotFoundError extends Error {
  constructor(readonly eventId: string) {
    super(`Event ${eventId} was not found.`);
    this.name = "OpsHandoffEventNotFoundError";
  }
}

export interface OpsHandoffBlockingReviewGate {
  readonly source: "event_architect_guest_flow";
  readonly reason: EventArchitectGuestFlowEvidence["reviewGate"]["reason"];
  readonly requiredData: EventArchitectGuestFlowEvidence["reviewGate"]["requiredData"];
  readonly resolution: "reviewed_evidence_artifact_required";
}

export class OpsHandoffBlockingReviewGateError extends Error {
  constructor(readonly gate: OpsHandoffBlockingReviewGate) {
    super("Event Architect review evidence blocks Ops handoff compilation.");
    this.name = "OpsHandoffBlockingReviewGateError";
  }
}

export class OpsHandoffEvidenceIntegrityError extends Error {
  constructor(readonly configId: string) {
    super(`Event Architect evidence for configuration ${configId} is not valid.`);
    this.name = "OpsHandoffEvidenceIntegrityError";
  }
}

export class OpsHandoffEventBindingRequiredError extends Error {
  constructor(readonly configId: string, readonly eventId: string) {
    super(`Configuration ${configId} is not bound to event ${eventId} in the same venue.`);
    this.name = "OpsHandoffEventBindingRequiredError";
  }
}

export function eventArchitectOpsCompilationReviewGate(
  reviewGate: EventArchitectGuestFlowEvidence["reviewGate"] | null,
): OpsHandoffBlockingReviewGate | null {
  if (reviewGate === null) return null;
  return {
    source: "event_architect_guest_flow",
    reason: reviewGate.reason,
    requiredData: reviewGate.requiredData,
    resolution: "reviewed_evidence_artifact_required",
  };
}

export function eventGraphBindsConfiguration(
  graph: EventPhaseGraph,
  configId: string,
  venueId: string,
): boolean {
  if (graph.event.venueId !== venueId) return false;
  return graph.configurationLinks.some((link) =>
    link.eventId === graph.event.id && link.configurationId === configId
  );
}

interface DraftTaskGroup {
  readonly key: string;
  readonly title: string;
  readonly kind: "setup" | "breakdown" | "room_flip" | "supplier" | "review";
  readonly sortOrder: number;
}

interface DraftOpsTask {
  readonly groupKey: string;
  readonly phaseId: string | null;
  readonly kind: "setup" | "breakdown" | "room_flip" | "supplier" | "review_gate" | "note";
  readonly title: string;
  readonly detail: string;
  readonly sortOrder: number;
  readonly dueLabel: string | null;
  readonly sourceRef: string | null;
  readonly spatialAnchors: readonly EventMissionSpatialAnchor[];
}

interface DraftPickListItem {
  readonly name: string;
  readonly category: string;
  readonly quantity: number;
  readonly sourcePhase: string | null;
  readonly sourceZone: string | null;
  readonly notes: string | null;
  readonly sortOrder: number;
}

interface DraftSupplierInstruction {
  readonly supplierId: string | null;
  readonly category: string;
  readonly title: string;
  readonly detail: string;
  readonly arrivalWindow: string | null;
  readonly sourceRef: string | null;
  readonly sortOrder: number;
}

interface DraftSequenceStep {
  readonly stepNumber: number;
  readonly title: string;
  readonly detail: string;
  readonly sortOrder: number;
}

interface DraftRoomFlipPlan {
  readonly phaseId: string | null;
  readonly fromPhaseLabel: string | null;
  readonly toPhaseLabel: string | null;
  readonly durationMinutes: number;
  readonly taskCount: number;
  readonly reviewGateCount: number;
  readonly notes: string;
}

interface DraftOpsHandoff {
  readonly summary: string;
  readonly sourceLabel: string;
  readonly digest: string;
  readonly taskGroups: readonly DraftTaskGroup[];
  readonly opsTasks: readonly DraftOpsTask[];
  readonly pickListTitle: string;
  readonly pickListItems: readonly DraftPickListItem[];
  readonly supplierInstructions: readonly DraftSupplierInstruction[];
  readonly loadInSequence: readonly DraftSequenceStep[];
  readonly breakdownSequence: readonly DraftSequenceStep[];
  readonly roomFlipPlans: readonly DraftRoomFlipPlan[];
  readonly beoTitle: string;
  readonly beoBody: string;
  readonly snapshotDiff: Omit<SnapshotDiff, "id" | "handoffPackId" | "createdAt">;
}

function toIso(value: Date): string {
  return value.toISOString();
}

function toIsoOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function safeOpsText(text: string, maxLength = 3800): string {
  const trimmed = safePlanningLanguage(text).replace(/\s+\n/gu, "\n").trim();
  const fallback = trimmed.length > 0 ? trimmed : "No additional operations note was captured.";
  const bounded = fallback.length <= maxLength ? fallback : `${fallback.slice(0, maxLength - 3).trim()}...`;
  return SafeOpsTextSchema.parse(bounded);
}

function itemKey(item: { readonly name: string; readonly category: string }): string {
  return `${item.category.trim().toLowerCase()}\u0000${item.name.trim().toLowerCase()}`;
}

function titleCase(value: string): string {
  return value
    .split(/[-_\s]+/u)
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function hydrateSnapshot(row: SnapshotRow): ConfigurationSheetSnapshot {
  const payload = parseHallkeeperSnapshotPayload(row.payload, row.coordinateSpace);
  if (payload === null) {
    throw new Error(`Stored sheet snapshot ${row.id} failed payload validation`);
  }
  return {
    id: row.id,
    configurationId: row.configurationId,
    version: row.version,
    payload,
    diagramUrl: row.diagramUrl,
    pdfUrl: row.pdfUrl,
    sourceHash: row.sourceHash,
    createdAt: toIso(row.createdAt),
    createdBy: row.createdBy,
    approvedAt: toIsoOrNull(row.approvedAt),
    approvedBy: row.approvedBy,
  };
}

function serializeHandoffPack(row: HandoffPackRow): HandoffPack {
  return HandoffPackSchema.parse({
    id: row.id,
    eventId: row.eventId,
    configId: row.configId,
    snapshotId: row.snapshotId,
    snapshotHash: row.snapshotHash,
    version: row.version,
    status: row.status,
    sourceLabel: row.sourceLabel,
    summary: row.summary,
    createdBy: row.createdBy,
    compiledAt: toIso(row.compiledAt),
    updatedAt: toIso(row.updatedAt),
  });
}

function serializeTaskGroup(row: TaskGroupRow): TaskGroup {
  return TaskGroupSchema.parse({
    id: row.id,
    handoffPackId: row.handoffPackId,
    title: row.title,
    kind: row.kind,
    sortOrder: row.sortOrder,
    createdAt: toIso(row.createdAt),
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

function serializeFurniturePickList(row: FurniturePickListRow): FurniturePickList {
  return FurniturePickListSchema.parse({
    id: row.id,
    handoffPackId: row.handoffPackId,
    title: row.title,
    totalItems: row.totalItems,
    createdAt: toIso(row.createdAt),
  });
}

function serializePickListItem(row: PickListItemRow): PickListItem {
  return PickListItemSchema.parse({
    id: row.id,
    pickListId: row.pickListId,
    name: row.name,
    category: row.category,
    quantity: row.quantity,
    sourcePhase: row.sourcePhase,
    sourceZone: row.sourceZone,
    notes: row.notes,
    sortOrder: row.sortOrder,
    createdAt: toIso(row.createdAt),
  });
}

function serializeSupplierInstruction(row: SupplierInstructionRow): SupplierInstruction {
  return SupplierInstructionSchema.parse({
    id: row.id,
    handoffPackId: row.handoffPackId,
    supplierId: row.supplierId,
    category: row.category,
    title: row.title,
    detail: row.detail,
    arrivalWindow: row.arrivalWindow,
    sourceRef: row.sourceRef,
    sortOrder: row.sortOrder,
    createdAt: toIso(row.createdAt),
  });
}

function serializeLoadInSequence(row: LoadInSequenceRow): OpsSequenceStep {
  return OpsSequenceStepSchema.parse({
    id: row.id,
    handoffPackId: row.handoffPackId,
    kind: "load_in",
    stepNumber: row.stepNumber,
    title: row.title,
    detail: row.detail,
    sortOrder: row.sortOrder,
    createdAt: toIso(row.createdAt),
  });
}

function serializeBreakdownSequence(row: BreakdownSequenceRow): OpsSequenceStep {
  return OpsSequenceStepSchema.parse({
    id: row.id,
    handoffPackId: row.handoffPackId,
    kind: "breakdown",
    stepNumber: row.stepNumber,
    title: row.title,
    detail: row.detail,
    sortOrder: row.sortOrder,
    createdAt: toIso(row.createdAt),
  });
}

function serializeRoomFlipPlan(row: RoomFlipPlanRow): RoomFlipPlan {
  return RoomFlipPlanSchema.parse({
    id: row.id,
    handoffPackId: row.handoffPackId,
    phaseId: row.phaseId,
    fromPhaseLabel: row.fromPhaseLabel,
    toPhaseLabel: row.toPhaseLabel,
    durationMinutes: row.durationMinutes,
    taskCount: row.taskCount,
    reviewGateCount: row.reviewGateCount,
    notes: row.notes,
    createdAt: toIso(row.createdAt),
  });
}

function serializeBeoDocument(row: BeoDocumentRow): BeoDocument {
  return BeoDocumentSchema.parse({
    id: row.id,
    handoffPackId: row.handoffPackId,
    title: row.title,
    body: row.body,
    sourceSnapshotHash: row.sourceSnapshotHash,
    safeStatus: row.safeStatus,
    createdAt: toIso(row.createdAt),
  });
}

function serializeSnapshotDiff(row: SnapshotDiffRow): SnapshotDiff {
  return SnapshotDiffSchema.parse({
    id: row.id,
    handoffPackId: row.handoffPackId,
    previousSnapshotHash: row.previousSnapshotHash,
    currentSnapshotHash: row.currentSnapshotHash,
    addedCount: row.addedCount,
    removedCount: row.removedCount,
    changedCount: row.changedCount,
    summary: row.summary,
    payload: row.payload,
    createdAt: toIso(row.createdAt),
  });
}

function compileSnapshotDiff(
  snapshot: ConfigurationSheetSnapshot,
  previousSnapshot: ConfigurationSheetSnapshot | null,
): DraftOpsHandoff["snapshotDiff"] {
  if (previousSnapshot === null) {
    const payload = SnapshotDiffPayloadSchema.parse({ added: [], removed: [], changed: [] });
    return {
      previousSnapshotHash: null,
      currentSnapshotHash: snapshot.sourceHash,
      addedCount: 0,
      removedCount: 0,
      changedCount: 0,
      summary: safeOpsText("No previous approved snapshot is available for comparison."),
      payload,
    };
  }

  const current = new Map(snapshot.payload.totals.entries.map((entry) => [itemKey(entry), entry]));
  const previous = new Map(previousSnapshot.payload.totals.entries.map((entry) => [itemKey(entry), entry]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  for (const [key, entry] of current) {
    const prior = previous.get(key);
    if (prior === undefined) {
      added.push(`${String(entry.qty)} x ${entry.name}`);
    } else if (prior.qty !== entry.qty) {
      changed.push(`${entry.name}: ${String(prior.qty)} -> ${String(entry.qty)}`);
    }
  }

  for (const [key, entry] of previous) {
    if (!current.has(key)) {
      removed.push(`${String(entry.qty)} x ${entry.name}`);
    }
  }

  const payload = SnapshotDiffPayloadSchema.parse({
    added: added.sort((a, b) => a.localeCompare(b)),
    removed: removed.sort((a, b) => a.localeCompare(b)),
    changed: changed.sort((a, b) => a.localeCompare(b)),
  });
  const changedCount = payload.changed.length;
  const addedCount = payload.added.length;
  const removedCount = payload.removed.length;
  const summary = addedCount + removedCount + changedCount === 0
    ? "No furniture count changes since the previous approved snapshot."
    : `${String(addedCount)} added, ${String(removedCount)} removed, ${String(changedCount)} quantity changed since the previous approved snapshot.`;

  return {
    previousSnapshotHash: previousSnapshot.sourceHash,
    currentSnapshotHash: snapshot.sourceHash,
    addedCount,
    removedCount,
    changedCount,
    summary: safeOpsText(summary),
    payload,
  };
}

function compilePickList(snapshot: ConfigurationSheetSnapshot): readonly DraftPickListItem[] {
  return [...snapshot.payload.totals.entries]
    .sort((a, b) => `${a.category}:${a.name}`.localeCompare(`${b.category}:${b.name}`))
    .map((entry, index) => ({
      name: safeOpsText(entry.name, 180),
      category: safeOpsText(entry.category, 70),
      quantity: entry.qty,
      sourcePhase: null,
      sourceZone: null,
      notes: null,
      sortOrder: index,
    }));
}

function compileSetupTasks(snapshot: ConfigurationSheetSnapshot): readonly DraftOpsTask[] {
  const tasks: DraftOpsTask[] = [];
  for (const phase of snapshot.payload.phases) {
    for (const zone of phase.zones) {
      for (const row of zone.rows) {
        if (row.qty === 0) continue;
        const zoneLabel = titleCase(zone.zone);
        const phaseLabel = titleCase(phase.phase);
        const notes = row.notes.trim().length > 0 ? ` Notes: ${row.notes.trim()}` : "";
        tasks.push({
          groupKey: "setup",
          phaseId: null,
          kind: "setup",
          title: safeOpsText(`Set ${String(row.qty)} x ${row.name}`, 220),
          detail: safeOpsText(`Place in ${zoneLabel} during ${phaseLabel}.${notes}`),
          sortOrder: tasks.length,
          dueLabel: null,
          sourceRef: row.key,
          spatialAnchors: row.positions.map((position) => ({
            coordinateSpace: "real_m_v1",
            configurationId: snapshot.configurationId,
            snapshotId: snapshot.id,
            objectId: position.objectId,
            xM: position.x,
            zM: position.z,
            floorLabel: null,
            label: safeOpsText(`${row.name} - ${zoneLabel}`, 200),
            source: "frozen_snapshot",
          })),
        });
      }
    }
  }
  return tasks;
}

function compileBreakdownTasks(snapshot: ConfigurationSheetSnapshot): readonly DraftOpsTask[] {
  return [...snapshot.payload.totals.entries]
    .sort((a, b) => `${a.category}:${a.name}`.localeCompare(`${b.category}:${b.name}`))
    .map((entry, index) => ({
      groupKey: "breakdown",
      phaseId: null,
      kind: "breakdown" as const,
      title: safeOpsText(`Break down ${entry.name}`, 220),
      detail: safeOpsText(`Account for ${String(entry.qty)} x ${entry.name} from the approved handoff pack.`),
      sortOrder: index,
      dueLabel: null,
      sourceRef: `${entry.category}:${entry.name}`,
      spatialAnchors: [],
    }));
}

function compileSequences(snapshot: ConfigurationSheetSnapshot, kind: "load_in" | "breakdown"): readonly DraftSequenceStep[] {
  const phases = kind === "load_in" ? snapshot.payload.phases : [...snapshot.payload.phases].reverse();
  const steps = phases
    .map((phase, index) => {
      const rowCount = phase.zones.reduce((count, zone) => count + zone.rows.length, 0);
      return {
        stepNumber: index + 1,
        title: safeOpsText(`${kind === "load_in" ? "Load in" : "Break down"} ${titleCase(phase.phase)}`, 180),
        detail: safeOpsText(`${String(rowCount)} row(s) from the approved snapshot are grouped in this phase.`),
        sortOrder: index,
      };
    })
    .filter((step) => !step.detail.startsWith("0 row"));

  if (steps.length > 0) return steps;

  return [{
    stepNumber: 1,
    title: kind === "load_in" ? "Confirm load-in scope" : "Confirm breakdown scope",
    detail: "No phase rows were captured in the approved snapshot; confirm scope before issuing the handoff.",
    sortOrder: 0,
  }];
}

function categoryOrNameIncludes(
  entries: readonly { readonly name: string; readonly category: string }[],
  needles: readonly string[],
): boolean {
  return entries.some((entry) => {
    const haystack = `${entry.category} ${entry.name}`.toLowerCase();
    return needles.some((needle) => haystack.includes(needle));
  });
}

function compileSupplierInstructions(snapshot: ConfigurationSheetSnapshot): readonly DraftSupplierInstruction[] {
  const entries = snapshot.payload.totals.entries;
  const instructions = snapshot.payload.instructions;
  const drafts: DraftSupplierInstruction[] = [];

  if (categoryOrNameIncludes(entries, ["av", "audio", "lighting", "stage", "screen", "microphone"])) {
    drafts.push({
      supplierId: null,
      category: "technical",
      title: "Technical supplier handoff",
      detail: "Technical items appear in the approved snapshot. Confirm delivery, setup order, and removal timing against the handoff pack.",
      arrivalWindow: null,
      sourceRef: "snapshot.totals",
      sortOrder: drafts.length,
    });
  }

  if (categoryOrNameIncludes(entries, ["decor", "linen", "cloth", "runner", "centrepiece", "candle", "floral"])) {
    drafts.push({
      supplierId: null,
      category: "decor",
      title: "Decor supplier handoff",
      detail: "Decor and dressing items appear in the approved snapshot. Use the pick list and setup tasks as the source for quantities and room zones.",
      arrivalWindow: null,
      sourceRef: "snapshot.totals",
      sortOrder: drafts.length,
    });
  }

  if (instructions?.dietary !== null && instructions?.dietary !== undefined) {
    drafts.push({
      supplierId: null,
      category: "catering",
      title: "Catering notes",
      detail: "Dietary information is captured in the approved snapshot. Catering should review the hallkeeper sheet and confirm assumptions with staff.",
      arrivalWindow: null,
      sourceRef: "snapshot.instructions.dietary",
      sortOrder: drafts.length,
    });
  }

  const accessNotes = instructions?.accessNotes.trim() ?? "";
  if (accessNotes.length > 0) {
    drafts.push({
      supplierId: null,
      category: "logistics",
      title: "Load-in access notes",
      detail: `Access note from approved snapshot: ${accessNotes}`,
      arrivalWindow: null,
      sourceRef: "snapshot.instructions.accessNotes",
      sortOrder: drafts.length,
    });
  }

  if (drafts.length === 0) {
    drafts.push({
      supplierId: null,
      category: "operations",
      title: "Supplier coordination check",
      detail: "No supplier-specific notes were captured in the approved snapshot; confirm supplier scope before dispatch.",
      arrivalWindow: null,
      sourceRef: "snapshot",
      sortOrder: 0,
    });
  }

  return drafts.map((draft, index) => ({
    ...draft,
    category: safeOpsText(draft.category, 70),
    title: safeOpsText(draft.title, 180),
    detail: safeOpsText(draft.detail),
    sortOrder: index,
  }));
}

function compileRoomFlipPlans(eventGraph: EventPhaseGraph | null): readonly DraftRoomFlipPlan[] {
  if (eventGraph === null) return [];
  const phases = [...eventGraph.phases].sort((a, b) => a.sortOrder - b.sortOrder);
  const plans: DraftRoomFlipPlan[] = [];

  phases.forEach((phase, index) => {
    const isRoomFlip = phase.templateKey === "room-flip" || /room\s*flip|reset|turnaround/iu.test(phase.name);
    if (!isRoomFlip) return;
    const previous = phases[index - 1] ?? null;
    const next = phases[index + 1] ?? null;
    plans.push({
      phaseId: phase.id,
      fromPhaseLabel: previous?.name ?? null,
      toPhaseLabel: next?.name ?? null,
      durationMinutes: phase.durationMinutes,
      taskCount: Math.max(phase.opsTasksCount, 1),
      reviewGateCount: phase.reviewGatesCount,
      notes: safeOpsText(`${phase.name} is an internal planning handoff phase. Confirm reset scope against the approved snapshot before staff execution.`),
    });
  });

  return plans;
}

function compileRoomFlipTasks(plans: readonly DraftRoomFlipPlan[]): readonly DraftOpsTask[] {
  return plans.map((plan, index) => ({
    groupKey: "room_flip",
    phaseId: plan.phaseId,
    kind: "room_flip" as const,
    title: safeOpsText(`Prepare room flip ${String(index + 1)}`, 220),
    detail: safeOpsText(`${plan.fromPhaseLabel ?? "Prior phase"} -> ${plan.toPhaseLabel ?? "next phase"}; target duration ${String(plan.durationMinutes)} min. ${plan.notes}`),
    sortOrder: index,
    dueLabel: plan.durationMinutes > 0 ? `${String(plan.durationMinutes)} min planning window` : null,
    sourceRef: plan.phaseId,
    spatialAnchors: [],
  }));
}

function compileBeoBody(input: {
  readonly snapshot: ConfigurationSheetSnapshot;
  readonly eventGraph: EventPhaseGraph | null;
  readonly clientNotes: string | null;
  readonly digest: string;
  readonly setupTaskCount: number;
  readonly supplierInstructionCount: number;
}): string {
  const { payload } = input.snapshot;
  const eventLine = input.eventGraph === null
    ? "Event: no event record linked to this handoff pack."
    : `Event: ${input.eventGraph.event.name} (${input.eventGraph.event.status}).`;
  const notes = input.clientNotes === null || input.clientNotes.trim().length === 0
    ? "Client/event notes: none supplied for this compiler run."
    : `Client/event notes: ${input.clientNotes.trim()}`;
  const special = payload.instructions?.specialInstructions.trim();
  const specialLine = special === undefined || special.length === 0
    ? "Special instructions: none captured in the approved snapshot."
    : `Special instructions: ${special}`;

  return safeOpsText([
    `BEO internal operations handoff for ${payload.config.name}.`,
    eventLine,
    `Venue: ${payload.venue.name}; room: ${payload.space.name}.`,
    `Guest count from approved snapshot: ${String(payload.config.guestCount)}.`,
    `Snapshot: v${String(input.snapshot.version)}; hash ${input.snapshot.sourceHash}.`,
    `Pick list items: ${String(payload.totals.entries.length)}; total quantity ${String(payload.totals.totalItems)}.`,
    `Setup tasks: ${String(input.setupTaskCount)}; supplier notes: ${String(input.supplierInstructionCount)}.`,
    specialLine,
    notes,
    "Review note: this is an internal operations handoff from approved planning data; unresolved review gates remain visible in related evidence surfaces.",
    `Compiler digest: ${input.digest}.`,
  ].join("\n"));
}

export function compileOpsHandoffDraft(input: {
  readonly snapshot: ConfigurationSheetSnapshot;
  readonly previousSnapshot: ConfigurationSheetSnapshot | null;
  readonly eventGraph: EventPhaseGraph | null;
  readonly clientNotes: string | null;
}): DraftOpsHandoff {
  const pickListItems = compilePickList(input.snapshot);
  const setupTasks = compileSetupTasks(input.snapshot);
  const breakdownTasks = compileBreakdownTasks(input.snapshot);
  const roomFlipPlans = compileRoomFlipPlans(input.eventGraph);
  const roomFlipTasks = compileRoomFlipTasks(roomFlipPlans);
  const supplierInstructions = compileSupplierInstructions(input.snapshot);
  const taskGroups: readonly DraftTaskGroup[] = [
    { key: "setup", title: "Setup tasks", kind: "setup", sortOrder: 0 },
    { key: "room_flip", title: "Room flip tasks", kind: "room_flip", sortOrder: 1 },
    { key: "supplier", title: "Supplier notes", kind: "supplier", sortOrder: 2 },
    { key: "breakdown", title: "Breakdown tasks", kind: "breakdown", sortOrder: 3 },
  ];
  const supplierTasks: readonly DraftOpsTask[] = supplierInstructions.map((instruction, index) => ({
    groupKey: "supplier",
    phaseId: null,
    kind: "supplier",
    title: instruction.title,
    detail: instruction.detail,
    sortOrder: index,
    dueLabel: instruction.arrivalWindow,
    sourceRef: instruction.sourceRef,
    spatialAnchors: [],
  }));
  const allTasks = [
    ...setupTasks,
    ...roomFlipTasks.map((task, index) => ({ ...task, sortOrder: setupTasks.length + index })),
    ...supplierTasks.map((task, index) => ({ ...task, sortOrder: setupTasks.length + roomFlipTasks.length + index })),
    ...breakdownTasks.map((task, index) => ({
      ...task,
      sortOrder: setupTasks.length + roomFlipTasks.length + supplierTasks.length + index,
    })),
  ];
  const digest = opsHandoffPayloadDigest({
    snapshotHash: input.snapshot.sourceHash,
    taskTitles: allTasks.map((task) => task.title),
    pickList: pickListItems.map((item) => ({ name: item.name, quantity: item.quantity })),
    supplierInstructionTitles: supplierInstructions.map((instruction) => instruction.title),
  });
  const snapshotDiff = compileSnapshotDiff(input.snapshot, input.previousSnapshot);
  const summary = safeOpsText(
    `${input.snapshot.payload.space.name} handoff compiled from approved snapshot v${String(input.snapshot.version)}: ` +
    `${String(pickListItems.length)} pick-list line(s), ${String(allTasks.length)} task(s), ${String(supplierInstructions.length)} supplier note(s).`,
  );

  return {
    summary,
    sourceLabel: safeOpsText(`Approved configuration snapshot v${String(input.snapshot.version)}`, 180),
    digest,
    taskGroups,
    opsTasks: allTasks,
    pickListTitle: safeOpsText(`${input.snapshot.payload.space.name} furniture pick list`, 180),
    pickListItems,
    supplierInstructions,
    loadInSequence: compileSequences(input.snapshot, "load_in"),
    breakdownSequence: compileSequences(input.snapshot, "breakdown"),
    roomFlipPlans,
    beoTitle: safeOpsText(`${input.snapshot.payload.config.name} BEO internal handoff`, 180),
    beoBody: compileBeoBody({
      snapshot: input.snapshot,
      eventGraph: input.eventGraph,
      clientNotes: input.clientNotes,
      digest,
      setupTaskCount: setupTasks.length,
      supplierInstructionCount: supplierInstructions.length,
    }),
    snapshotDiff,
  };
}

async function latestApprovedSnapshots(
  db: Database,
  configId: string,
): Promise<readonly ConfigurationSheetSnapshot[]> {
  const rows = await db.select()
    .from(configurationSheetSnapshots)
    .where(and(
      eq(configurationSheetSnapshots.configurationId, configId),
      isNotNull(configurationSheetSnapshots.approvedAt),
    ))
    .orderBy(desc(configurationSheetSnapshots.version))
    .limit(2);
  return rows.map(hydrateSnapshot);
}

async function assertEventArchitectOpsCompilationReady(
  db: Database,
  configId: string,
): Promise<void> {
  const [row] = await db.select({ payload: eventArchitectCandidates.payload })
    .from(eventArchitectCandidates)
    .where(eq(eventArchitectCandidates.configurationId, configId))
    .limit(1);
  if (row === undefined) return;

  const candidate = EventArchitectCandidateSchema.safeParse(row.payload);
  if (!candidate.success) throw new OpsHandoffEvidenceIntegrityError(configId);
  // The candidate payload remains immutable planning evidence and cannot
  // approve itself. Only a current, separately persisted, digest-bound review
  // artifact can resolve the gate at this boundary.
  const gate = eventArchitectOpsCompilationReviewGate(
    candidate.data.guestFlowEvidence.reviewGate,
  );
  if (gate === null) return;
  try {
    const review = await getEventArchitectOpsReviewGate(db, candidate.data.candidateId);
    if (review?.status === "approved" && !review.blockingForOpsCompilation) return;
  } catch (error: unknown) {
    if (error instanceof EventArchitectOpsReviewEvidenceIntegrityError) {
      throw new OpsHandoffEvidenceIntegrityError(configId);
    }
    throw error;
  }
  throw new OpsHandoffBlockingReviewGateError(gate);
}

async function loadEventGraph(db: Database, eventId: string): Promise<EventPhaseGraph> {
  const [eventRow] = await db.select()
    .from(events)
    .where(and(eq(events.id, eventId), isNull(events.deletedAt)))
    .limit(1);
  if (eventRow === undefined) throw new OpsHandoffEventNotFoundError(eventId);

  const [phaseRows, scenarioRows, variantRows, linkRows, snapshotRows] = await Promise.all([
    db.select().from(eventPhases).where(eq(eventPhases.eventId, eventId)).orderBy(eventPhases.sortOrder),
    db.select().from(eventScenarios).where(eq(eventScenarios.eventId, eventId)).orderBy(eventScenarios.createdAt),
    db.select().from(layoutVariants).where(eq(layoutVariants.eventId, eventId)).orderBy(layoutVariants.createdAt),
    db.select().from(eventConfigurationLinks).where(eq(eventConfigurationLinks.eventId, eventId)).orderBy(eventConfigurationLinks.createdAt),
    db.select({ snapshot: phaseLayoutSnapshots })
      .from(phaseLayoutSnapshots)
      .innerJoin(eventPhases, eq(phaseLayoutSnapshots.eventPhaseId, eventPhases.id))
      .where(eq(eventPhases.eventId, eventId))
      .orderBy(phaseLayoutSnapshots.createdAt),
  ]);

  return EventPhaseGraphSchema.parse({
    event: EventSchema.parse({
      id: eventRow.id,
      venueId: eventRow.venueId,
      createdBy: eventRow.createdBy,
      name: eventRow.name,
      eventType: eventRow.eventType,
      status: eventRow.status,
      startsAt: toIsoOrNull(eventRow.startsAt),
      endsAt: toIsoOrNull(eventRow.endsAt),
      guestCount: eventRow.guestCount,
      clientName: eventRow.clientName,
      notes: eventRow.notes,
      createdAt: toIso(eventRow.createdAt),
      updatedAt: toIso(eventRow.updatedAt),
    }),
    phases: phaseRows.map((row): EventPhase => EventPhaseSchema.parse({
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
    })),
    scenarios: scenarioRows.map((row) => EventScenarioSchema.parse({
      id: row.id,
      eventId: row.eventId,
      phaseId: row.phaseId,
      name: row.name,
      status: row.status,
      assumptions: row.assumptions,
      seed: row.seed,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
    })),
    layoutVariants: variantRows.map((row) => LayoutVariantSchema.parse({
      id: row.id,
      eventId: row.eventId,
      configurationId: row.configurationId,
      name: row.name,
      status: row.status,
      guestCount: row.guestCount,
      notes: row.notes,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
    })),
    configurationLinks: linkRows.map((row) => EventConfigurationLinkSchema.parse({
      id: row.id,
      eventId: row.eventId,
      configurationId: row.configurationId,
      layoutVariantId: row.layoutVariantId,
      linkType: row.linkType,
      createdAt: toIso(row.createdAt),
    })),
    phaseLayoutSnapshots: snapshotRows.map((row) => PhaseLayoutSnapshotSchema.parse({
      id: row.snapshot.id,
      eventPhaseId: row.snapshot.eventPhaseId,
      layoutVariantId: row.snapshot.layoutVariantId,
      configurationId: row.snapshot.configurationId,
      snapshotHash: row.snapshot.snapshotHash,
      status: row.snapshot.status,
      objectCount: row.snapshot.objectCount,
      guestCount: row.snapshot.guestCount,
      payload: row.snapshot.payload,
      createdAt: toIso(row.snapshot.createdAt),
      frozenAt: toIsoOrNull(row.snapshot.frozenAt),
    })),
  });
}

export async function getOpsHandoffPackBundle(
  db: Database,
  handoffPackId: string,
): Promise<OpsHandoffPackBundle | null> {
  const [packRow] = await db.select().from(handoffPacks).where(eq(handoffPacks.id, handoffPackId)).limit(1);
  if (packRow === undefined) return null;

  const [
    groupRows,
    taskRows,
    pickListRows,
    supplierInstructionRows,
    loadInRows,
    breakdownRows,
    roomFlipRows,
    beoRows,
    diffRows,
  ] = await Promise.all([
    db.select().from(taskGroups).where(eq(taskGroups.handoffPackId, handoffPackId)).orderBy(taskGroups.sortOrder),
    db.select().from(opsTasks).where(eq(opsTasks.handoffPackId, handoffPackId)).orderBy(opsTasks.sortOrder),
    db.select().from(furniturePickLists).where(eq(furniturePickLists.handoffPackId, handoffPackId)).limit(1),
    db.select().from(supplierInstructions).where(eq(supplierInstructions.handoffPackId, handoffPackId)).orderBy(supplierInstructions.sortOrder),
    db.select().from(loadInSequences).where(eq(loadInSequences.handoffPackId, handoffPackId)).orderBy(loadInSequences.sortOrder),
    db.select().from(breakdownSequences).where(eq(breakdownSequences.handoffPackId, handoffPackId)).orderBy(breakdownSequences.sortOrder),
    db.select().from(roomFlipPlans).where(eq(roomFlipPlans.handoffPackId, handoffPackId)).orderBy(roomFlipPlans.createdAt),
    db.select().from(beoDocuments).where(eq(beoDocuments.handoffPackId, handoffPackId)).limit(1),
    db.select().from(snapshotDiffs).where(eq(snapshotDiffs.handoffPackId, handoffPackId)).limit(1),
  ]);

  const pickListRow = pickListRows[0];
  const beoRow = beoRows[0];
  const diffRow = diffRows[0];
  if (pickListRow === undefined || beoRow === undefined || diffRow === undefined) return null;

  const pickItemRows = await db.select()
    .from(pickListItems)
    .where(eq(pickListItems.pickListId, pickListRow.id))
    .orderBy(pickListItems.sortOrder);

  return OpsHandoffPackBundleSchema.parse({
    pack: serializeHandoffPack(packRow),
    taskGroups: groupRows.map(serializeTaskGroup),
    opsTasks: taskRows.map(serializeOpsTask),
    furniturePickList: serializeFurniturePickList(pickListRow),
    pickListItems: pickItemRows.map(serializePickListItem),
    supplierInstructions: supplierInstructionRows.map(serializeSupplierInstruction),
    loadInSequence: loadInRows.map(serializeLoadInSequence),
    breakdownSequence: breakdownRows.map(serializeBreakdownSequence),
    roomFlipPlans: roomFlipRows.map(serializeRoomFlipPlan),
    beoDocument: serializeBeoDocument(beoRow),
    snapshotDiff: serializeSnapshotDiff(diffRow),
  });
}

export async function compileOpsHandoffPackFromConfiguration(
  db: Database,
  input: {
    readonly configId: string;
    readonly eventId: string | null;
    readonly clientNotes: string | null;
    readonly actorUserId: string | null;
  },
): Promise<OpsHandoffPackBundle> {
  const [config] = await db.select({
    id: configurations.id,
    venueId: configurations.venueId,
  })
    .from(configurations)
    .where(and(eq(configurations.id, input.configId), isNull(configurations.deletedAt)))
    .limit(1);
  if (config === undefined) throw new OpsHandoffSourceNotFoundError(input.configId);

  const snapshots = await latestApprovedSnapshots(db, input.configId);
  const snapshot = snapshots[0] ?? null;
  if (snapshot === null) throw new OpsHandoffApprovedSnapshotRequiredError(input.configId);

  await assertEventArchitectOpsCompilationReady(db, input.configId);
  const eventGraph = input.eventId === null ? null : await loadEventGraph(db, input.eventId);
  if (
    eventGraph !== null &&
    !eventGraphBindsConfiguration(eventGraph, input.configId, config.venueId)
  ) {
    throw new OpsHandoffEventBindingRequiredError(input.configId, eventGraph.event.id);
  }
  const draft = compileOpsHandoffDraft({
    snapshot,
    previousSnapshot: snapshots[1] ?? null,
    eventGraph,
    clientNotes: input.clientNotes,
  });

  return db.transaction(async (tx) => {
    const [latestPack] = await tx.select({ version: handoffPacks.version })
      .from(handoffPacks)
      .where(eq(handoffPacks.snapshotId, snapshot.id))
      .orderBy(desc(handoffPacks.version))
      .limit(1);
    const version = (latestPack?.version ?? 0) + 1;

    const [pack] = await tx.insert(handoffPacks).values({
      eventId: input.eventId,
      configId: input.configId,
      snapshotId: snapshot.id,
      snapshotHash: snapshot.sourceHash,
      version,
      status: "compiled",
      sourceLabel: draft.sourceLabel,
      summary: draft.summary,
      createdBy: input.actorUserId,
    }).returning();
    if (pack === undefined) throw new Error("Handoff pack insertion returned no row.");

    const groupRows = await tx.insert(taskGroups).values(draft.taskGroups.map((group) => ({
      handoffPackId: pack.id,
      title: group.title,
      kind: group.kind,
      sortOrder: group.sortOrder,
    }))).returning();
    const groupByKey = new Map<string, string>();
    draft.taskGroups.forEach((group, index) => {
      const row = groupRows[index];
      if (row !== undefined) groupByKey.set(group.key, row.id);
    });

    if (draft.opsTasks.length > 0) {
      await tx.insert(opsTasks).values(draft.opsTasks.map((task) => ({
        handoffPackId: pack.id,
        taskGroupId: groupByKey.get(task.groupKey) ?? null,
        phaseId: task.phaseId,
        kind: task.kind,
        title: task.title,
        detail: task.detail,
        status: "todo",
        sortOrder: task.sortOrder,
        dueLabel: task.dueLabel,
        sourceRef: task.sourceRef,
        spatialAnchors: [...task.spatialAnchors],
      })));
    }

    const [pickList] = await tx.insert(furniturePickLists).values({
      handoffPackId: pack.id,
      title: draft.pickListTitle,
      totalItems: draft.pickListItems.reduce((sum, item) => sum + item.quantity, 0),
    }).returning();
    if (pickList === undefined) throw new Error("Furniture pick list insertion returned no row.");

    if (draft.pickListItems.length > 0) {
      await tx.insert(pickListItems).values(draft.pickListItems.map((item) => ({
        pickListId: pickList.id,
        name: item.name,
        category: item.category,
        quantity: item.quantity,
        sourcePhase: item.sourcePhase,
        sourceZone: item.sourceZone,
        notes: item.notes,
        sortOrder: item.sortOrder,
      })));
    }

    await tx.insert(supplierInstructions).values(draft.supplierInstructions.map((instruction) => ({
      handoffPackId: pack.id,
      supplierId: instruction.supplierId,
      category: instruction.category,
      title: instruction.title,
      detail: instruction.detail,
      arrivalWindow: instruction.arrivalWindow,
      sourceRef: instruction.sourceRef,
      sortOrder: instruction.sortOrder,
    })));

    await tx.insert(loadInSequences).values(draft.loadInSequence.map((step) => ({
      handoffPackId: pack.id,
      stepNumber: step.stepNumber,
      title: step.title,
      detail: step.detail,
      sortOrder: step.sortOrder,
    })));

    await tx.insert(breakdownSequences).values(draft.breakdownSequence.map((step) => ({
      handoffPackId: pack.id,
      stepNumber: step.stepNumber,
      title: step.title,
      detail: step.detail,
      sortOrder: step.sortOrder,
    })));

    if (draft.roomFlipPlans.length > 0) {
      await tx.insert(roomFlipPlans).values(draft.roomFlipPlans.map((plan) => ({
        handoffPackId: pack.id,
        phaseId: plan.phaseId,
        fromPhaseLabel: plan.fromPhaseLabel,
        toPhaseLabel: plan.toPhaseLabel,
        durationMinutes: plan.durationMinutes,
        taskCount: plan.taskCount,
        reviewGateCount: plan.reviewGateCount,
        notes: plan.notes,
      })));
    }

    await tx.insert(beoDocuments).values({
      handoffPackId: pack.id,
      title: draft.beoTitle,
      body: draft.beoBody,
      sourceSnapshotHash: snapshot.sourceHash,
      safeStatus: "internal_operations_handoff",
    });

    await tx.insert(snapshotDiffs).values({
      handoffPackId: pack.id,
      previousSnapshotHash: draft.snapshotDiff.previousSnapshotHash,
      currentSnapshotHash: draft.snapshotDiff.currentSnapshotHash,
      addedCount: draft.snapshotDiff.addedCount,
      removedCount: draft.snapshotDiff.removedCount,
      changedCount: draft.snapshotDiff.changedCount,
      summary: draft.snapshotDiff.summary,
      payload: draft.snapshotDiff.payload as SnapshotDiffPayload,
    });

    await tx.insert(generalAuditLog).values({
      actorUserId: input.actorUserId,
      action: "ops_handoff.compiled",
      targetType: "handoff_pack",
      targetId: pack.id,
      summary: "Ops handoff pack compiled from approved snapshot.",
      metadata: {
        configId: input.configId,
        eventId: input.eventId,
        snapshotId: snapshot.id,
        digest: draft.digest,
      },
    });

    const bundle = await getOpsHandoffPackBundle(tx, pack.id);
    if (bundle === null) throw new Error("Handoff pack bundle could not be loaded after insertion.");
    return bundle;
  });
}
