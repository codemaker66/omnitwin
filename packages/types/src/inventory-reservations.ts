import { z } from "zod";
import { InventoryIdSchema as Id, InventoryInstantSchema as Instant, InventoryQuantitySchema as Quantity,
  InventoryWindowSchema as Window } from "./venue-inventory.js";

const Digest = z.string().regex(/^[a-f0-9]{64}$/u);
const Reason = z.string().trim().min(1).max(1000);
const SignedQuantity = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const ObservationWindow = Window.refine((value) => Date.parse(value.endsAt) - Date.parse(value.startsAt) <= 31 * 86_400_000,
  { message: "Assessment windows cannot exceed 31 days" });
export const InventoryAssessmentQuerySchema = z.object({ from: Instant, to: Instant }).strict()
  .refine((value) => Date.parse(value.to) > Date.parse(value.from)
    && Date.parse(value.to) - Date.parse(value.from) <= 31 * 86_400_000,
  { message: "Choose a positive assessment window of at most 31 days" });
export const InventoryAssessmentIssueSchema = z.object({ code: z.string(), message: z.string(),
  eventId: Id.nullable(), spaceId: Id.nullable(), phaseId: Id.nullable() }).strict();
export type InventoryAssessmentIssue = z.infer<typeof InventoryAssessmentIssueSchema>;
export const InventoryReservationDemandSchema = z.object({ assetDefinitionId: Id, name: z.string(),
  category: z.string(), quantity: Quantity }).strict();
export type InventoryReservationDemand = z.infer<typeof InventoryReservationDemandSchema>;
export const InventoryReservationPhaseSchema = z.object({ phaseId: Id, name: z.string(), window: Window,
  mode: z.enum(["frozen_layout", "room_flip_carry", "breakdown_carry"]),
  snapshotId: Id.nullable(), canonicalSnapshotId: Id.nullable(), proofDigest: Digest.nullable(),
  snapshotDigest: Digest.nullable(),
  objects: z.array(z.object({ objectId: Id, assetDefinitionId: Id }).strict()),
}).strict().superRefine((phase, context) => {
  const lineage = [phase.snapshotId, phase.canonicalSnapshotId, phase.proofDigest, phase.snapshotDigest];
  if ((phase.mode === "frozen_layout" ? lineage.some((value) => value === null)
    : lineage.some((value) => value !== null) || phase.objects.length > 0)
    || new Set(phase.objects.map((object) => object.objectId)).size !== phase.objects.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid inventory phase evidence" });
  }
});
export type InventoryReservationPhase = z.infer<typeof InventoryReservationPhaseSchema>;
export const InventoryReservationBookingSchema = z.object({ id: Id, window: Window, updatedAt: Instant }).strict();
export const InventoryReservationReleaseSchema = z.object({ id: Id, venueId: Id, eventId: Id, spaceId: Id,
  revision: Quantity.refine((value) => value > 0), action: z.enum(["approved", "revoked"]),
  supersedesReleaseId: Id.nullable(), sourceDigest: Digest, occupiedWindow: Window,
  occupiedWindowConfirmed: z.literal(true), demands: z.array(InventoryReservationDemandSchema),
  bookings: z.array(InventoryReservationBookingSchema), phases: z.array(InventoryReservationPhaseSchema),
  actorUserId: Id, recordedAt: Instant, reason: Reason,
}).strict().superRefine((release, context) => {
  const peak = new Map<string, number>();
  for (const phase of release.phases) {
    const counts = new Map<string, number>();
    for (const object of phase.objects) counts.set(object.assetDefinitionId, (counts.get(object.assetDefinitionId) ?? 0) + 1);
    for (const [id, count] of counts) peak.set(id, Math.max(peak.get(id) ?? 0, count));
  }
  if (new Set(release.demands.map((row) => row.assetDefinitionId)).size !== release.demands.length
    || new Set(release.bookings.map((row) => row.id)).size !== release.bookings.length
    || new Set(release.phases.map((row) => row.phaseId)).size !== release.phases.length
    || release.bookings.length === 0 || release.phases.length === 0
    || !release.phases.some((phase) => phase.mode === "frozen_layout")
    || peak.size !== release.demands.length || release.demands.some((row) => peak.get(row.assetDefinitionId) !== row.quantity)
    || [...release.phases, ...release.bookings].some((row) => Date.parse(row.window.startsAt) < Date.parse(release.occupiedWindow.startsAt)
      || Date.parse(row.window.endsAt) > Date.parse(release.occupiedWindow.endsAt))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid inventory release evidence" });
  }
});
export type InventoryReservationRelease = z.infer<typeof InventoryReservationReleaseSchema>;
export const InventoryAvailabilitySegmentSchema = z.object({ startsAt: Instant, endsAt: Instant, ownedQuantity: Quantity, hiredQuantity: Quantity,
  totalQuantity: Quantity, usableQuantity: Quantity, reservedQuantity: Quantity, remainingQuantity: SignedQuantity,
  shortageQuantity: Quantity, commitmentIds: z.array(Id), eventIds: z.array(Id) }).strict().superRefine((segment, context) => {
  if (Date.parse(segment.startsAt) >= Date.parse(segment.endsAt)
    || segment.ownedQuantity + segment.hiredQuantity !== segment.totalQuantity || segment.usableQuantity > segment.totalQuantity
    || segment.usableQuantity - segment.reservedQuantity !== segment.remainingQuantity
    || Math.max(0, -segment.remainingQuantity) !== segment.shortageQuantity
    || new Set(segment.commitmentIds).size !== segment.commitmentIds.length || new Set(segment.eventIds).size !== segment.eventIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Inventory interval arithmetic or identity is inconsistent" });
  }
});
export const InventoryAvailabilityResultSchema = z.object({ venueId: Id, assetDefinitionId: Id, stockRevision: Quantity,
  minimumRemainingQuantity: SignedQuantity, maximumShortageQuantity: Quantity,
  segments: z.array(InventoryAvailabilitySegmentSchema).min(1),
}).strict().superRefine((result, context) => {
  if (result.minimumRemainingQuantity !== Math.min(...result.segments.map((segment) => segment.remainingQuantity))
    || result.maximumShortageQuantity !== Math.max(...result.segments.map((segment) => segment.shortageQuantity))
    || result.segments.some((segment, index) => index > 0 && result.segments[index - 1]?.endsAt !== segment.startsAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Inventory interval summary is inconsistent" });
  }
});
export const InventoryAssessmentItemSchema = z.object({ assetDefinitionId: Id, name: z.string(), category: z.string(),
  stockRevision: Quantity.nullable(), availability: InventoryAvailabilityResultSchema.nullable(),
  unavailableReason: z.enum(["stock_unrecorded", "historical_unsupported"]).nullable(),
}).strict().superRefine((item, context) => {
  if (item.availability === null ? item.unavailableReason === null
    || (item.unavailableReason === "stock_unrecorded" && item.stockRevision !== null)
    || (item.unavailableReason === "historical_unsupported" && (item.stockRevision === null || item.stockRevision < 1))
    : item.unavailableReason !== null || item.stockRevision !== item.availability.stockRevision
      || item.assetDefinitionId !== item.availability.assetDefinitionId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Inventory availability state is inconsistent" });
  }
});
export type InventoryAssessmentItem = z.infer<typeof InventoryAssessmentItemSchema>;
export const InventoryReservationSourceSchema = z.object({ eventId: Id, spaceId: Id, eventName: z.string(), spaceName: z.string(),
  bookingIds: z.array(Id), occupiedWindow: Window.nullable(), sourceDigest: Digest,
  state: z.enum(["unapproved", "approved", "stale", "incomplete", "inactive", "revoked"]),
  issues: z.array(InventoryAssessmentIssueSchema), demands: z.array(InventoryReservationDemandSchema),
  phases: z.array(InventoryReservationPhaseSchema), approvedRelease: InventoryReservationReleaseSchema.nullable(),
  latestReleaseId: Id.nullable(), releaseRevision: Quantity,
  proposalImpact: z.array(InventoryAssessmentItemSchema),
}).strict();
export type InventoryReservationSource = z.infer<typeof InventoryReservationSourceSchema>;
export const InventoryRemedyEvidenceSchema = z.object({ stockRevision: Quantity.nullable(),
  shortageSegments: z.array(InventoryAvailabilitySegmentSchema),
  affectedReservations: z.array(z.object({ releaseId: Id, eventId: Id, eventName: z.string(),
    spaceId: Id, spaceName: z.string() }).strict()), missingFacts: z.array(z.string()),
}).strict();
export const InventoryRemedySchema = z.object({ id: Id, venueId: Id, kind: z.enum(["hire_request", "stock_inspection"]),
  assetDefinitionId: Id, assetName: z.string(), quantity: Quantity.refine((value) => value > 0), window: Window,
  status: z.enum(["prepared", "approved"]), assessmentDigest: Digest, reason: Reason,
  preparedBy: Id, preparedAt: Instant, approvedBy: Id.nullable(), approvedAt: Instant.nullable(),
  effect: z.literal("internal_request_only"),
  evidence: InventoryRemedyEvidenceSchema,
  check: z.enum(["current", "stale", "not_checked"]),
}).strict().superRefine((remedy, context) => {
  if (remedy.status === "prepared" ? remedy.approvedBy !== null || remedy.approvedAt !== null
    : remedy.approvedBy === null || remedy.approvedAt === null || Date.parse(remedy.approvedAt) < Date.parse(remedy.preparedAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Inventory remedy approval lineage is inconsistent" });
  }
});
export type InventoryRemedy = z.infer<typeof InventoryRemedySchema>;
export const InventoryAssessmentSchema = z.object({ venueId: Id, timeZone: z.string(), window: Window, assessedAt: Instant,
  assessmentDigest: Digest, coverage: z.enum(["complete", "partial", "historical_unsupported"]),
  demandScope: z.literal("frozen_placed_catalogue_objects_only"),
  scopeDisclosure: z.string(), issues: z.array(InventoryAssessmentIssueSchema),
  sources: z.array(InventoryReservationSourceSchema), items: z.array(InventoryAssessmentItemSchema),
  remedies: z.array(InventoryRemedySchema),
}).strict();
export type InventoryAssessment = z.infer<typeof InventoryAssessmentSchema>;
export const InventoryAssessmentResponseSchema = z.object({ data: InventoryAssessmentSchema }).strict();
export type InventoryAssessmentResponse = z.infer<typeof InventoryAssessmentResponseSchema>;
const ReservationCommand = z.object({ commandId: Id, eventId: Id, spaceId: Id, window: ObservationWindow,
  expectedSourceDigest: Digest, expectedAssessmentDigest: Digest, reason: Reason }).strict();
export const InventoryReservationApprovalInputSchema = ReservationCommand.extend({ occupiedWindowConfirmed: z.literal(true) });
export type InventoryReservationApprovalInput = z.infer<typeof InventoryReservationApprovalInputSchema>;
export const InventoryReservationRevokeInputSchema = ReservationCommand;
export type InventoryReservationRevokeInput = z.infer<typeof InventoryReservationRevokeInputSchema>;
export const InventoryReservationMutationResponseSchema = z.object({ data: z.object({
  release: InventoryReservationReleaseSchema, assessment: InventoryAssessmentSchema, replayed: z.boolean() }).strict() }).strict();
export type InventoryReservationMutationResponse = z.infer<typeof InventoryReservationMutationResponseSchema>;
export const InventoryReservationHistoryResponseSchema = z.object({ data: z.array(InventoryReservationReleaseSchema) }).strict();
export type InventoryReservationHistoryResponse = z.infer<typeof InventoryReservationHistoryResponseSchema>;
export const InventoryRemedyPrepareInputSchema = z.object({ commandId: Id, kind: z.enum(["hire_request", "stock_inspection"]),
  assetDefinitionId: Id, window: ObservationWindow, quantity: Quantity.refine((value) => value > 0),
  expectedAssessmentDigest: Digest, reason: Reason }).strict();
export type InventoryRemedyPrepareInput = z.infer<typeof InventoryRemedyPrepareInputSchema>;
export const InventoryRemedyApproveInputSchema = z.object({ commandId: Id, expectedAssessmentDigest: Digest }).strict();
export type InventoryRemedyApproveInput = z.infer<typeof InventoryRemedyApproveInputSchema>;
export const InventoryRemedyPrepareResponseSchema = z.object({ data: z.object({ remedy: InventoryRemedySchema,
  replayed: z.boolean() }).strict() }).strict();
export type InventoryRemedyPrepareResponse = z.infer<typeof InventoryRemedyPrepareResponseSchema>;
export const InventoryRemedyApproveResponseSchema = InventoryRemedyPrepareResponseSchema;
export type InventoryRemedyApproveResponse = z.infer<typeof InventoryRemedyApproveResponseSchema>;
export const InventoryRemedyResponseSchema = z.object({ data: InventoryRemedySchema }).strict();
export type InventoryRemedyResponse = z.infer<typeof InventoryRemedyResponseSchema>;
