import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import {
  CheckResultSchema,
  EvidenceItemSchema,
  EvidencePackBundleSchema,
  EvidencePackPayloadSchema,
  EvidencePackSchema,
  ReviewGateSchema,
  AssumptionRecordSchema,
  ClaimStateSchema,
  TruthModeSummarySchema,
  evidencePackPayloadDigest,
  safePlanningLanguage,
  type AssumptionRecord,
  type CheckResult,
  type ConfigurationSheetSnapshot,
  type EvidenceItem,
  type EvidencePack,
  type EvidencePackBundle,
  type EvidencePackPayload,
  type EvidenceTargetType,
  type ReviewGate,
  type TruthModeSummary,
} from "@omnitwin/types";
import {
  assumptionRecords,
  checkResults,
  claimStates,
  configurations,
  evidenceItems,
  evidencePackItems,
  evidencePacks,
  generalAuditLog,
  reviewGates,
  runtimePackages,
  spaces,
  staleEvidenceEvents,
  venues,
} from "../db/schema.js";
import type { Database } from "../db/client.js";
import { getLatestApprovedSnapshot } from "./sheet-snapshot.js";

type EvidenceItemRow = typeof evidenceItems.$inferSelect;
type CheckResultRow = typeof checkResults.$inferSelect;
type AssumptionRecordRow = typeof assumptionRecords.$inferSelect;
type ReviewGateRow = typeof reviewGates.$inferSelect;
type ClaimStateRow = typeof claimStates.$inferSelect;
type EvidencePackRow = typeof evidencePacks.$inferSelect;
type RuntimePackageRow = typeof runtimePackages.$inferSelect;

export class EvidenceSourceNotFoundError extends Error {
  constructor(readonly configId: string) {
    super(`Configuration ${configId} was not found.`);
  }
}

export class ApprovedSnapshotRequiredError extends Error {
  constructor(readonly configId: string) {
    super(`Configuration ${configId} does not have an approved snapshot.`);
  }
}

function dateToIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function numberFromDb(value: string | number | null): number | null {
  if (value === null) return null;
  if (typeof value === "number") return value;
  return Number(value);
}

function serializeEvidenceItem(row: EvidenceItemRow): EvidenceItem {
  return EvidenceItemSchema.parse({
    id: row.id,
    configId: row.configId,
    targetType: row.targetType,
    targetId: row.targetId,
    itemType: row.itemType,
    sourceType: row.sourceType,
    sourceLabel: row.sourceLabel,
    confidence: row.confidence,
    status: row.status,
    staleState: row.staleState,
    wording: row.wording,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function serializeCheckResult(row: CheckResultRow): CheckResult {
  return CheckResultSchema.parse({
    id: row.id,
    evidenceItemId: row.evidenceItemId,
    configId: row.configId,
    targetType: row.targetType,
    targetId: row.targetId,
    checkType: row.checkType,
    status: row.status,
    severity: row.severity,
    message: row.message,
    measuredValue: numberFromDb(row.measuredValue),
    thresholdValue: numberFromDb(row.thresholdValue),
    unit: row.unit,
    sourceLabel: row.sourceLabel,
    createdAt: row.createdAt.toISOString(),
  });
}

function serializeAssumption(row: AssumptionRecordRow): AssumptionRecord {
  return AssumptionRecordSchema.parse({
    id: row.id,
    configId: row.configId,
    targetType: row.targetType,
    targetId: row.targetId,
    assumptionType: row.assumptionType,
    value: row.value,
    sourceLabel: row.sourceLabel,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  });
}

function serializeReviewGate(row: ReviewGateRow): ReviewGate {
  return ReviewGateSchema.parse({
    id: row.id,
    configId: row.configId,
    targetType: row.targetType,
    targetId: row.targetId,
    gateType: row.gateType,
    status: row.status,
    title: row.title,
    description: row.description,
    requiredRole: row.requiredRole,
    decisionBy: row.decisionBy,
    decisionAt: dateToIso(row.decisionAt),
    decisionNote: row.decisionNote,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function serializeClaimState(row: ClaimStateRow) {
  return ClaimStateSchema.parse({
    id: row.id,
    configId: row.configId,
    targetType: row.targetType,
    targetId: row.targetId,
    claimKey: row.claimKey,
    status: row.status,
    safeWording: row.safeWording,
    evidencePackId: row.evidencePackId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function serializeEvidencePack(row: EvidencePackRow): EvidencePack {
  return EvidencePackSchema.parse({
    id: row.id,
    configId: row.configId,
    snapshotId: row.snapshotId,
    snapshotHash: row.snapshotHash,
    payloadHash: row.payloadHash,
    status: row.status,
    humanReviewRequired: row.humanReviewRequired,
    payload: row.payload,
    generatedBy: row.generatedBy,
    generatedAt: row.generatedAt.toISOString(),
    staleAt: dateToIso(row.staleAt),
  });
}

function runtimeAssetStatus(runtimePackage: RuntimePackageRow | null): EvidencePackPayload["runtimeAssetStatus"] {
  if (runtimePackage === null) {
    return {
      status: "missing",
      runtimePackageId: null,
      evidenceStatus: null,
      wording: "No runtime asset evidence is linked to this snapshot.",
    };
  }

  if (runtimePackage.evidenceStatus === "human_reviewed") {
    return {
      status: "current",
      runtimePackageId: runtimePackage.id,
      evidenceStatus: runtimePackage.evidenceStatus,
      wording: "Runtime asset loaded as planning evidence; operational review remains separate.",
    };
  }

  return {
    status: "partial",
    runtimePackageId: runtimePackage.id,
    evidenceStatus: runtimePackage.evidenceStatus,
    wording: "Runtime asset record exists but is not yet human reviewed.",
  };
}

export function buildEvidencePackPayload(input: {
  readonly snapshot: ConfigurationSheetSnapshot;
  readonly runtimePackage: RuntimePackageRow | null;
}): EvidencePackPayload {
  const layoutCount = input.snapshot.payload.totals.totalRows;
  const guestCount = input.snapshot.payload.config.guestCount;
  const runtimeStatus = runtimeAssetStatus(input.runtimePackage);
  const capacityStatus = guestCount > 0 ? "requires_review" : "not_available";

  const reviewGates: EvidencePackPayload["reviewGates"] = [
    {
      gateType: "human_review_required",
      status: "open",
      title: "Human review required",
      description: "This evidence pack is planning support until reviewed by an appropriate person.",
    },
    {
      gateType: "missing_route_clearance",
      status: "open",
      title: "Route clearance not checked",
      description: "Route-clearance evidence is missing from this pack.",
    },
  ];

  if (runtimeStatus.status !== "current") {
    reviewGates.push({
      gateType: "runtime_asset_unverified",
      status: "open",
      title: "Runtime asset not verified",
      description: runtimeStatus.wording,
    });
  }

  return EvidencePackPayloadSchema.parse({
    schemaVersion: "evidence_pack.v0",
    snapshotHash: input.snapshot.sourceHash,
    layoutCount,
    capacityResult: {
      checkType: "capacity",
      status: capacityStatus,
      message: guestCount > 0
        ? "Guest count is captured from the frozen snapshot; capacity remains planning evidence and requires review."
        : "Guest count is missing from the frozen snapshot.",
    },
    routeClearanceResult: {
      checkType: "route_clearance",
      status: "not_checked",
      message: "Route-clearance result is not checked in this evidence pack.",
    },
    runtimeAssetStatus: runtimeStatus,
    assumptions: [
      {
        assumptionType: "guest_count",
        value: guestCount,
        sourceLabel: "Frozen layout snapshot",
      },
      {
        assumptionType: "layout_count",
        value: layoutCount,
        sourceLabel: "Frozen hallkeeper sheet rows",
      },
      {
        assumptionType: "route_clearance",
        value: "not_checked",
        sourceLabel: "Evidence generator v0",
      },
    ],
    reviewGates,
    safeWording: [
      "Planning evidence",
      "Human review required",
      "Not legally certified",
    ],
    humanReviewRequired: true,
  });
}

async function loadRuntimePackageForConfig(db: Database, configId: string): Promise<RuntimePackageRow | null> {
  const [row] = await db.select({
    pkg: runtimePackages,
  })
    .from(configurations)
    .innerJoin(venues, eq(configurations.venueId, venues.id))
    .innerJoin(spaces, eq(configurations.spaceId, spaces.id))
    .leftJoin(
      runtimePackages,
      and(
        eq(runtimePackages.venueSlug, venues.slug),
        eq(runtimePackages.roomSlug, spaces.slug),
        inArray(runtimePackages.runtimeStatus, ["internal_ready", "published"]),
      ),
    )
    .where(and(eq(configurations.id, configId), isNull(configurations.deletedAt)))
    .orderBy(desc(runtimePackages.revision))
    .limit(1);

  return row?.pkg ?? null;
}

export async function getEvidencePackBundle(db: Database, evidencePackId: string): Promise<EvidencePackBundle | null> {
  const [packRow] = await db.select()
    .from(evidencePacks)
    .where(eq(evidencePacks.id, evidencePackId))
    .limit(1);

  if (packRow === undefined) return null;

  const packItems = await db.select({
    evidenceItem: evidenceItems,
  })
    .from(evidencePackItems)
    .innerJoin(evidenceItems, eq(evidencePackItems.evidenceItemId, evidenceItems.id))
    .where(eq(evidencePackItems.evidencePackId, evidencePackId));

  const itemRows = packItems.map((row) => row.evidenceItem);
  const itemIds = itemRows.map((row) => row.id);

  const [checkRows, assumptionRows, gateRows, claimRows] = await Promise.all([
    itemIds.length === 0
      ? Promise.resolve([])
      : db.select().from(checkResults).where(inArray(checkResults.evidenceItemId, itemIds)),
    db.select().from(assumptionRecords).where(eq(assumptionRecords.configId, packRow.configId)),
    db.select().from(reviewGates).where(eq(reviewGates.configId, packRow.configId)),
    db.select().from(claimStates).where(eq(claimStates.evidencePackId, packRow.id)),
  ]);

  return EvidencePackBundleSchema.parse({
    pack: serializeEvidencePack(packRow),
    evidenceItems: itemRows.map(serializeEvidenceItem),
    checkResults: checkRows.map(serializeCheckResult),
    assumptions: assumptionRows.map(serializeAssumption),
    reviewGates: gateRows.map(serializeReviewGate),
    claimStates: claimRows.map(serializeClaimState),
  });
}

export async function generateEvidencePackFromConfiguration(
  db: Database,
  input: {
    readonly configId: string;
    readonly actorUserId: string | null;
  },
): Promise<EvidencePackBundle> {
  const [config] = await db.select({
    id: configurations.id,
  })
    .from(configurations)
    .where(and(eq(configurations.id, input.configId), isNull(configurations.deletedAt)))
    .limit(1);

  if (config === undefined) throw new EvidenceSourceNotFoundError(input.configId);

  const snapshot = await getLatestApprovedSnapshot(db, input.configId);
  if (snapshot === null) throw new ApprovedSnapshotRequiredError(input.configId);

  const runtimePackage = await loadRuntimePackageForConfig(db, input.configId);
  const payload = buildEvidencePackPayload({ snapshot, runtimePackage });
  const payloadHash = evidencePackPayloadDigest(payload);

  const [existingPack] = await db.select()
    .from(evidencePacks)
    .where(and(
      eq(evidencePacks.snapshotId, snapshot.id),
      eq(evidencePacks.payloadHash, payloadHash),
    ))
    .limit(1);

  if (existingPack !== undefined) {
    const bundle = await getEvidencePackBundle(db, existingPack.id);
    if (bundle !== null) return bundle;
  }

  const targetId = input.configId;

  return db.transaction(async (tx) => {
    const itemInputs = [
      {
        configId: input.configId,
        targetType: "layout_snapshot",
        targetId: snapshot.id,
        itemType: "layout_snapshot",
        sourceType: "approved_layout_snapshot",
        sourceLabel: "Approved layout snapshot",
        confidence: "medium",
        status: "current",
        staleState: "current",
        wording: "Approved layout snapshot loaded as planning evidence.",
        metadata: { snapshotHash: snapshot.sourceHash, version: snapshot.version },
      },
      {
        configId: input.configId,
        targetType: "configuration",
        targetId,
        itemType: "capacity_result",
        sourceType: "system_generated",
        sourceLabel: "Evidence generator v0",
        confidence: "low",
        status: payload.capacityResult.status === "not_available" ? "missing" : "partial",
        staleState: "review_due",
        wording: payload.capacityResult.message,
        metadata: { guestCount: snapshot.payload.config.guestCount },
      },
      {
        configId: input.configId,
        targetType: "route",
        targetId,
        itemType: "route_clearance_result",
        sourceType: "system_generated",
        sourceLabel: "Evidence generator v0",
        confidence: "unknown",
        status: "not_checked",
        staleState: "unknown",
        wording: payload.routeClearanceResult.message,
        metadata: null,
      },
      {
        configId: input.configId,
        targetType: "runtime_asset",
        targetId: payload.runtimeAssetStatus.runtimePackageId ?? targetId,
        itemType: "runtime_asset_status",
        sourceType: "runtime_asset_registry",
        sourceLabel: "Runtime asset registry",
        confidence: payload.runtimeAssetStatus.status === "current" ? "medium" : "unknown",
        status: payload.runtimeAssetStatus.status,
        staleState: payload.runtimeAssetStatus.status === "current" ? "current" : "unknown",
        wording: payload.runtimeAssetStatus.wording,
        metadata: {
          runtimePackageId: payload.runtimeAssetStatus.runtimePackageId,
          evidenceStatus: payload.runtimeAssetStatus.evidenceStatus,
        },
      },
      {
        configId: input.configId,
        targetType: "configuration",
        targetId,
        itemType: "human_review_required",
        sourceType: "system_generated",
        sourceLabel: "Evidence generator v0",
        confidence: "medium",
        status: "partial",
        staleState: "review_due",
        wording: "Human review required before this planning evidence is used as an operational decision.",
        metadata: null,
      },
    ];

    const insertedItems = await tx.insert(evidenceItems).values(itemInputs).returning();

    const itemByType = new Map(insertedItems.map((item) => [item.itemType, item]));

    await tx.insert(checkResults).values([
      {
        evidenceItemId: itemByType.get("layout_snapshot")?.id,
        configId: input.configId,
        targetType: "layout_snapshot",
        targetId: snapshot.id,
        checkType: "snapshot_hash",
        status: "passed",
        severity: "info",
        message: "Snapshot hash recorded for replayable planning evidence.",
        measuredValue: null,
        thresholdValue: null,
        unit: null,
        sourceLabel: "Approved layout snapshot",
      },
      {
        evidenceItemId: itemByType.get("layout_snapshot")?.id,
        configId: input.configId,
        targetType: "configuration",
        targetId,
        checkType: "layout_count",
        status: "passed",
        severity: "info",
        message: "Layout row count recorded from the frozen snapshot.",
        measuredValue: String(payload.layoutCount),
        thresholdValue: null,
        unit: "rows",
        sourceLabel: "Frozen hallkeeper sheet rows",
      },
      {
        evidenceItemId: itemByType.get("capacity_result")?.id,
        configId: input.configId,
        targetType: "configuration",
        targetId,
        checkType: "capacity",
        status: payload.capacityResult.status,
        severity: "warning",
        message: payload.capacityResult.message,
        measuredValue: String(snapshot.payload.config.guestCount),
        thresholdValue: null,
        unit: "guests",
        sourceLabel: "Frozen layout snapshot",
      },
      {
        evidenceItemId: itemByType.get("route_clearance_result")?.id,
        configId: input.configId,
        targetType: "route",
        targetId,
        checkType: "route_clearance",
        status: "not_checked",
        severity: "warning",
        message: payload.routeClearanceResult.message,
        measuredValue: null,
        thresholdValue: null,
        unit: null,
        sourceLabel: "Evidence generator v0",
      },
      {
        evidenceItemId: itemByType.get("runtime_asset_status")?.id,
        configId: input.configId,
        targetType: "runtime_asset",
        targetId: payload.runtimeAssetStatus.runtimePackageId ?? targetId,
        checkType: "runtime_asset_status",
        status: payload.runtimeAssetStatus.status === "current" ? "passed" : "requires_review",
        severity: payload.runtimeAssetStatus.status === "current" ? "info" : "warning",
        message: payload.runtimeAssetStatus.wording,
        measuredValue: null,
        thresholdValue: null,
        unit: null,
        sourceLabel: "Runtime asset registry",
      },
    ]);

    await tx.insert(assumptionRecords).values(payload.assumptions.map((assumption) => ({
      configId: input.configId,
      targetType: "configuration",
      targetId,
      assumptionType: assumption.assumptionType,
      value: assumption.value,
      sourceLabel: assumption.sourceLabel,
      status: "active",
    })));

    await tx.insert(reviewGates).values(payload.reviewGates.map((gate) => ({
      configId: input.configId,
      targetType: "configuration",
      targetId,
      gateType: gate.gateType,
      status: gate.status,
      title: gate.title,
      description: gate.description,
      requiredRole: "venue_staff",
    })));

    const [pack] = await tx.insert(evidencePacks).values({
      configId: input.configId,
      snapshotId: snapshot.id,
      snapshotHash: snapshot.sourceHash,
      payloadHash,
      status: "generated",
      humanReviewRequired: true,
      payload,
      generatedBy: input.actorUserId,
    }).returning();

    if (pack === undefined) {
      throw new Error("Evidence pack insertion returned no row.");
    }

    await tx.insert(evidencePackItems).values(insertedItems.map((item) => ({
      evidencePackId: pack.id,
      evidenceItemId: item.id,
      itemRole: item.itemType,
    })));

    const safeWording = safePlanningLanguage("Planning evidence; human review required; not legally certified.");
    await tx.insert(claimStates).values({
      configId: input.configId,
      targetType: "configuration",
      targetId,
      claimKey: "layout_evidence_scope",
      status: "human_review_required",
      safeWording,
      evidencePackId: pack.id,
    }).onConflictDoUpdate({
      target: [claimStates.targetType, claimStates.targetId, claimStates.claimKey],
      set: {
        status: "human_review_required",
        safeWording,
        evidencePackId: pack.id,
        updatedAt: new Date(),
      },
    });

    await tx.insert(generalAuditLog).values({
      actorUserId: input.actorUserId,
      action: "evidence_pack.generated",
      targetType: "configuration",
      targetId,
      summary: "Evidence pack generated from approved layout snapshot.",
      metadata: { evidencePackId: pack.id, snapshotId: snapshot.id, payloadHash },
    });

    const bundle = await getEvidencePackBundle(tx, pack.id);
    if (bundle === null) {
      throw new Error("Evidence pack bundle could not be loaded after insertion.");
    }
    return bundle;
  });
}

export async function listEvidenceItemsForConfig(db: Database, configId: string): Promise<readonly EvidenceItem[]> {
  const rows = await db.select()
    .from(evidenceItems)
    .where(eq(evidenceItems.configId, configId))
    .orderBy(desc(evidenceItems.createdAt));
  return rows.map(serializeEvidenceItem);
}

export async function applyReviewGateDecision(
  db: Database,
  input: {
    readonly reviewGateId: string;
    readonly actorUserId: string;
    readonly status: "approved" | "rejected" | "waived";
    readonly note: string | null;
  },
): Promise<ReviewGate | null> {
  const [updated] = await db.update(reviewGates)
    .set({
      status: input.status,
      decisionBy: input.actorUserId,
      decisionAt: new Date(),
      decisionNote: input.note,
      updatedAt: new Date(),
    })
    .where(eq(reviewGates.id, input.reviewGateId))
    .returning();

  if (updated === undefined) return null;

  await db.insert(generalAuditLog).values({
    actorUserId: input.actorUserId,
    action: "review_gate.decision",
    targetType: "review_gate",
    targetId: input.reviewGateId,
    summary: "Review gate decision recorded.",
    metadata: { status: input.status },
  });

  return serializeReviewGate(updated);
}

export function buildTruthModeSummary(input: {
  readonly targetType: EvidenceTargetType;
  readonly targetId: string;
  readonly evidenceItems: readonly EvidenceItem[];
  readonly checkResults: readonly CheckResult[];
  readonly assumptions: readonly AssumptionRecord[];
  readonly reviewGates: readonly ReviewGate[];
  readonly staleEventCount: number;
}): TruthModeSummary {
  const currentItems = input.evidenceItems.filter((item) => item.status === "current");
  const openReviewGates = input.reviewGates.filter((gate) => gate.status === "open");
  const staleItems = input.evidenceItems.filter((item) => item.staleState === "stale" || item.staleState === "review_due");
  const missingItems = input.evidenceItems.filter((item) => item.status === "missing" || item.status === "not_checked");
  const confidence = currentItems.length > 0 && openReviewGates.length === 0
    ? "medium"
    : input.evidenceItems.length > 0
      ? "low"
      : "unknown";
  const evidenceStatus = input.evidenceItems.length === 0
    ? "missing"
    : missingItems.length > 0 || openReviewGates.length > 0
      ? "partial"
      : "current";
  const staleState = input.staleEventCount > 0 || staleItems.length > 0
    ? "review_due"
    : input.evidenceItems.length > 0
      ? "current"
      : "unknown";

  return TruthModeSummarySchema.parse({
    targetType: input.targetType,
    targetId: input.targetId,
    source: input.evidenceItems.length > 0
      ? `${input.evidenceItems.length.toLocaleString("en-GB")} evidence item(s) linked.`
      : "No runtime evidence item is linked to this selection.",
    confidence,
    assumption: input.assumptions.length > 0
      ? `${input.assumptions.length.toLocaleString("en-GB")} active assumption(s) linked.`
      : "No explicit assumption record is linked.",
    evidenceStatus,
    reviewGate: openReviewGates.length > 0
      ? `${openReviewGates.length.toLocaleString("en-GB")} open review gate(s).`
      : "No open review gate is linked.",
    staleState,
    safeWording: [
      "Planning evidence",
      input.evidenceItems.length > 0 ? "Purpose-fit evidence" : "Evidence missing",
      openReviewGates.length > 0 ? "Human review required" : "No open review gate is linked",
    ],
    humanReviewRequired: openReviewGates.length > 0 || missingItems.length > 0,
    counts: {
      evidenceItems: input.evidenceItems.length,
      checkResults: input.checkResults.length,
      assumptions: input.assumptions.length,
      reviewGates: openReviewGates.length,
      staleEvents: input.staleEventCount,
    },
  });
}

export async function getTruthModeSummary(
  db: Database,
  input: {
    readonly targetType: EvidenceTargetType;
    readonly targetId: string;
  },
): Promise<TruthModeSummary> {
  const itemRows = await db.select()
    .from(evidenceItems)
    .where(and(eq(evidenceItems.targetType, input.targetType), eq(evidenceItems.targetId, input.targetId)));
  const configIds = [...new Set(itemRows.map((item) => item.configId).filter((id): id is string => id !== null))];

  const [checkRows, assumptionRows, gateRows, staleRows] = await Promise.all([
    db.select()
      .from(checkResults)
      .where(and(eq(checkResults.targetType, input.targetType), eq(checkResults.targetId, input.targetId))),
    db.select()
      .from(assumptionRecords)
      .where(configIds.length === 0
        ? and(eq(assumptionRecords.targetType, input.targetType), eq(assumptionRecords.targetId, input.targetId))
        : or(
          and(eq(assumptionRecords.targetType, input.targetType), eq(assumptionRecords.targetId, input.targetId)),
          inArray(assumptionRecords.configId, configIds),
        )),
    db.select()
      .from(reviewGates)
      .where(configIds.length === 0
        ? and(eq(reviewGates.targetType, input.targetType), eq(reviewGates.targetId, input.targetId))
        : or(
          and(eq(reviewGates.targetType, input.targetType), eq(reviewGates.targetId, input.targetId)),
          inArray(reviewGates.configId, configIds),
        )),
    db.select()
      .from(staleEvidenceEvents)
      .where(and(eq(staleEvidenceEvents.targetType, input.targetType), eq(staleEvidenceEvents.targetId, input.targetId))),
  ]);

  return buildTruthModeSummary({
    targetType: input.targetType,
    targetId: input.targetId,
    evidenceItems: itemRows.map(serializeEvidenceItem),
    checkResults: checkRows.map(serializeCheckResult),
    assumptions: assumptionRows.map(serializeAssumption),
    reviewGates: gateRows.map(serializeReviewGate),
    staleEventCount: staleRows.length,
  });
}
