import { z } from "zod";
import { ConfigurationIdSchema } from "./configuration.js";
import { ConfigurationSheetSnapshotIdSchema, ConfigurationSheetSnapshotSchema } from "./configuration-sheet-snapshot.js";
import { EventIdSchema, EventPhaseGraphSchema, EventPhaseIdSchema } from "./event-phase-graph.js";
import { sha256Hex, stableCanonicalJson } from "./canonical-layout-snapshot.js";
import { VenueIdSchema } from "./venue.js";
import { UserIdSchema } from "./user.js";

export const OPS_COMPILER_SCHEMA_VERSION = "ops_compiler.v1";
export const OPS_HANDOFF_DIGEST_DOMAIN_PREFIX = "venviewer.ops_handoff.v1\n";

const UUID = z.string().uuid();
const SHA256_HEX = /^[a-f0-9]{64}$/;

export const HandoffPackIdSchema = UUID;
export type HandoffPackId = z.infer<typeof HandoffPackIdSchema>;

export const OpsTaskIdSchema = UUID;
export type OpsTaskId = z.infer<typeof OpsTaskIdSchema>;

export const TaskGroupIdSchema = UUID;
export type TaskGroupId = z.infer<typeof TaskGroupIdSchema>;

export const FurniturePickListIdSchema = UUID;
export type FurniturePickListId = z.infer<typeof FurniturePickListIdSchema>;

export const PickListItemIdSchema = UUID;
export type PickListItemId = z.infer<typeof PickListItemIdSchema>;

export const SupplierIdSchema = UUID;
export type SupplierId = z.infer<typeof SupplierIdSchema>;

export const SupplierInstructionIdSchema = UUID;
export type SupplierInstructionId = z.infer<typeof SupplierInstructionIdSchema>;

export const LoadInSequenceIdSchema = UUID;
export type LoadInSequenceId = z.infer<typeof LoadInSequenceIdSchema>;

export const BreakdownSequenceIdSchema = UUID;
export type BreakdownSequenceId = z.infer<typeof BreakdownSequenceIdSchema>;

export const RoomFlipPlanIdSchema = UUID;
export type RoomFlipPlanId = z.infer<typeof RoomFlipPlanIdSchema>;

export const BeoDocumentIdSchema = UUID;
export type BeoDocumentId = z.infer<typeof BeoDocumentIdSchema>;

export const SnapshotDiffIdSchema = UUID;
export type SnapshotDiffId = z.infer<typeof SnapshotDiffIdSchema>;

export const HandoffPackStatusSchema = z.enum(["compiled", "superseded", "stale", "exported"]);
export type HandoffPackStatus = z.infer<typeof HandoffPackStatusSchema>;

export const OpsTaskStatusSchema = z.enum(["todo", "in_progress", "done", "blocked", "waived"]);
export type OpsTaskStatus = z.infer<typeof OpsTaskStatusSchema>;

export const OpsTaskKindSchema = z.enum(["setup", "breakdown", "room_flip", "supplier", "review_gate", "note"]);
export type OpsTaskKind = z.infer<typeof OpsTaskKindSchema>;

export const TaskGroupKindSchema = z.enum(["setup", "breakdown", "room_flip", "supplier", "review"]);
export type TaskGroupKind = z.infer<typeof TaskGroupKindSchema>;

export const SequenceKindSchema = z.enum(["load_in", "breakdown"]);
export type SequenceKind = z.infer<typeof SequenceKindSchema>;

export const SafeOpsTextSchema = z.string().trim().min(1).max(4000).superRefine((text, ctx) => {
  const unsafe = /\b(fire approved|certified safe|legally compliant|survey-grade|approved for occupancy|guaranteed accessible|Black Label|production ready|photoreal digital twin)\b/iu.exec(text);
  if (unsafe !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Unsafe public/client claim phrase "${unsafe[1] ?? unsafe[0]}" is not allowed.`,
    });
  }
});

export const HandoffPackSchema = z.object({
  id: HandoffPackIdSchema,
  eventId: EventIdSchema.nullable(),
  configId: ConfigurationIdSchema,
  snapshotId: ConfigurationSheetSnapshotIdSchema,
  snapshotHash: z.string().regex(SHA256_HEX),
  version: z.number().int().positive(),
  status: HandoffPackStatusSchema,
  sourceLabel: z.string().trim().min(1).max(200),
  summary: SafeOpsTextSchema,
  createdBy: UserIdSchema.nullable(),
  compiledAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type HandoffPack = z.infer<typeof HandoffPackSchema>;

export const TaskGroupSchema = z.object({
  id: TaskGroupIdSchema,
  handoffPackId: HandoffPackIdSchema,
  title: z.string().trim().min(1).max(200),
  kind: TaskGroupKindSchema,
  sortOrder: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
}).strict();
export type TaskGroup = z.infer<typeof TaskGroupSchema>;

export const OpsTaskSchema = z.object({
  id: OpsTaskIdSchema,
  handoffPackId: HandoffPackIdSchema,
  taskGroupId: TaskGroupIdSchema.nullable(),
  phaseId: EventPhaseIdSchema.nullable(),
  kind: OpsTaskKindSchema,
  title: z.string().trim().min(1).max(240),
  detail: SafeOpsTextSchema,
  status: OpsTaskStatusSchema,
  sortOrder: z.number().int().nonnegative(),
  dueLabel: z.string().trim().min(1).max(120).nullable(),
  sourceRef: z.string().trim().min(1).max(300).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type OpsTask = z.infer<typeof OpsTaskSchema>;

export const FurniturePickListSchema = z.object({
  id: FurniturePickListIdSchema,
  handoffPackId: HandoffPackIdSchema,
  title: z.string().trim().min(1).max(200),
  totalItems: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
}).strict();
export type FurniturePickList = z.infer<typeof FurniturePickListSchema>;

export const PickListItemSchema = z.object({
  id: PickListItemIdSchema,
  pickListId: FurniturePickListIdSchema,
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(80),
  quantity: z.number().int().nonnegative(),
  sourcePhase: z.string().trim().min(1).max(80).nullable(),
  sourceZone: z.string().trim().min(1).max(80).nullable(),
  notes: SafeOpsTextSchema.nullable(),
  sortOrder: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
}).strict();
export type PickListItem = z.infer<typeof PickListItemSchema>;

export const SupplierSchema = z.object({
  id: SupplierIdSchema,
  venueId: VenueIdSchema.nullable(),
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(80),
  contactName: z.string().trim().max(160).nullable(),
  email: z.string().email().max(255).nullable(),
  phone: z.string().trim().max(40).nullable(),
  notes: SafeOpsTextSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type Supplier = z.infer<typeof SupplierSchema>;

export const SupplierInstructionSchema = z.object({
  id: SupplierInstructionIdSchema,
  handoffPackId: HandoffPackIdSchema,
  supplierId: SupplierIdSchema.nullable(),
  category: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(200),
  detail: SafeOpsTextSchema,
  arrivalWindow: z.string().trim().min(1).max(120).nullable(),
  sourceRef: z.string().trim().min(1).max(300).nullable(),
  sortOrder: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
}).strict();
export type SupplierInstruction = z.infer<typeof SupplierInstructionSchema>;

export const OpsSequenceStepSchema = z.object({
  id: z.union([LoadInSequenceIdSchema, BreakdownSequenceIdSchema]),
  handoffPackId: HandoffPackIdSchema,
  kind: SequenceKindSchema,
  stepNumber: z.number().int().positive(),
  title: z.string().trim().min(1).max(200),
  detail: SafeOpsTextSchema,
  sortOrder: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
}).strict();
export type OpsSequenceStep = z.infer<typeof OpsSequenceStepSchema>;

export const RoomFlipPlanSchema = z.object({
  id: RoomFlipPlanIdSchema,
  handoffPackId: HandoffPackIdSchema,
  phaseId: EventPhaseIdSchema.nullable(),
  fromPhaseLabel: z.string().trim().min(1).max(120).nullable(),
  toPhaseLabel: z.string().trim().min(1).max(120).nullable(),
  durationMinutes: z.number().int().nonnegative(),
  taskCount: z.number().int().nonnegative(),
  reviewGateCount: z.number().int().nonnegative(),
  notes: SafeOpsTextSchema,
  createdAt: z.string().datetime(),
}).strict();
export type RoomFlipPlan = z.infer<typeof RoomFlipPlanSchema>;

export const BeoDocumentSchema = z.object({
  id: BeoDocumentIdSchema,
  handoffPackId: HandoffPackIdSchema,
  title: z.string().trim().min(1).max(200),
  body: SafeOpsTextSchema,
  sourceSnapshotHash: z.string().regex(SHA256_HEX),
  safeStatus: z.literal("internal_operations_handoff"),
  createdAt: z.string().datetime(),
}).strict();
export type BeoDocument = z.infer<typeof BeoDocumentSchema>;

export const SnapshotDiffPayloadSchema = z.object({
  added: z.array(z.string().trim().min(1).max(200)),
  removed: z.array(z.string().trim().min(1).max(200)),
  changed: z.array(z.string().trim().min(1).max(240)),
}).strict();
export type SnapshotDiffPayload = z.infer<typeof SnapshotDiffPayloadSchema>;

export const SnapshotDiffSchema = z.object({
  id: SnapshotDiffIdSchema,
  handoffPackId: HandoffPackIdSchema,
  previousSnapshotHash: z.string().regex(SHA256_HEX).nullable(),
  currentSnapshotHash: z.string().regex(SHA256_HEX),
  addedCount: z.number().int().nonnegative(),
  removedCount: z.number().int().nonnegative(),
  changedCount: z.number().int().nonnegative(),
  summary: SafeOpsTextSchema,
  payload: SnapshotDiffPayloadSchema,
  createdAt: z.string().datetime(),
}).strict();
export type SnapshotDiff = z.infer<typeof SnapshotDiffSchema>;

export const OpsHandoffPackBundleSchema = z.object({
  pack: HandoffPackSchema,
  taskGroups: z.array(TaskGroupSchema),
  opsTasks: z.array(OpsTaskSchema),
  furniturePickList: FurniturePickListSchema,
  pickListItems: z.array(PickListItemSchema),
  supplierInstructions: z.array(SupplierInstructionSchema),
  loadInSequence: z.array(OpsSequenceStepSchema),
  breakdownSequence: z.array(OpsSequenceStepSchema),
  roomFlipPlans: z.array(RoomFlipPlanSchema),
  beoDocument: BeoDocumentSchema,
  snapshotDiff: SnapshotDiffSchema,
}).strict();
export type OpsHandoffPackBundle = z.infer<typeof OpsHandoffPackBundleSchema>;

export const CompileOpsHandoffInputSchema = z.object({
  snapshot: ConfigurationSheetSnapshotSchema,
  previousSnapshot: ConfigurationSheetSnapshotSchema.nullable(),
  eventGraph: EventPhaseGraphSchema.nullable(),
  clientNotes: SafeOpsTextSchema.nullable(),
}).strict();
export type CompileOpsHandoffInput = z.infer<typeof CompileOpsHandoffInputSchema>;

export function opsHandoffPayloadDigest(payload: {
  readonly snapshotHash: string;
  readonly taskTitles: readonly string[];
  readonly pickList: readonly { readonly name: string; readonly quantity: number }[];
  readonly supplierInstructionTitles: readonly string[];
}): string {
  return sha256Hex(`${OPS_HANDOFF_DIGEST_DOMAIN_PREFIX}${stableCanonicalJson(payload)}`);
}
