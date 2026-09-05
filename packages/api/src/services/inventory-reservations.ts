import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { InventoryActorSchema, InventoryAssessmentResponseSchema, InventoryAssessmentSchema, InventoryAvailabilityResultSchema, InventoryIdSchema,
  InventoryRemedyApproveInputSchema, InventoryRemedyApproveResponseSchema, InventoryRemedyPrepareInputSchema,
  InventoryRemedyPrepareResponseSchema, InventoryRemedyResponseSchema, InventoryRemedySchema,
  InventoryReservationApprovalInputSchema, InventoryReservationHistoryResponseSchema, InventoryReservationMutationResponseSchema,
  InventoryReservationReleaseSchema, InventoryReservationRevokeInputSchema, InventoryWindowSchema,
  canAdjustVenueInventory, deterministicEventArchitectUuid, evaluateInventoryAvailability,
  type InventoryActor, type InventoryAssessment, type InventoryAssessmentItem, type InventoryCommitment,
  type InventoryRemedyApproveInput, type InventoryRemedyPrepareInput, type InventoryReservationApprovalInput,
  type InventoryReservationRelease, type InventoryReservationRevokeInput, type InventoryReservationSource, type InventoryStock, type InventoryWindow,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { inventoryDecisionCommands, inventoryRemedyRequests, inventoryReservationReleases, venues } from "../db/schema.js";
import { inventoryDecisionDigest, inventoryWindowsOverlap } from "./inventory-reservation-projection.js";
import { InventoryDecisionError, loadInventorySources, type InventoryReader } from "./inventory-reservation-source.js";
export { InventoryDecisionError } from "./inventory-reservation-source.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Loaded = Awaited<ReturnType<typeof loadInventorySources>>;
function authorize(actor: InventoryActor, venueId: string) {
  const normalized = InventoryActorSchema.parse(actor);
  const scope = InventoryIdSchema.parse(venueId);
  if (!canAdjustVenueInventory(normalized, scope)) throw new InventoryDecisionError(403, "FORBIDDEN", "Only this venue's administrator can approve inventory decisions");
  return { actor: normalized, venueId: scope };
}

function commitmentsFor(source: InventoryReservationSource): InventoryCommitment[] {
  const release = source.approvedRelease;
  // Authoritative active-ink removal deactivates current demand. A contradictory
  // cancelled event with active ink keeps its old allocation pending review.
  if (release === null || source.bookingIds.length === 0) return [];
  return release.demands.map((demand) => ({ id: deterministicEventArchitectUuid(`${release.id}:${demand.assetDefinitionId}`),
    venueId: release.venueId, assetDefinitionId: demand.assetDefinitionId, eventId: release.eventId,
    quantity: demand.quantity, status: "reserved", ...release.occupiedWindow }));
}
function itemAssessment(asset: { id: string; name: string; category: string }, stock: InventoryStock | undefined,
  commitments: InventoryCommitment[], window: InventoryWindow, now: string): InventoryAssessmentItem {
  const base = { assetDefinitionId: asset.id, name: asset.name, category: asset.category, stockRevision: stock?.revision ?? null };
  if (stock === undefined) return { ...base, availability: null, unavailableReason: "stock_unrecorded" };
  if (Date.parse(window.startsAt) < Date.parse(stock.effectiveAt) || Date.parse(window.startsAt) < Date.parse(now)) {
    return { ...base, availability: null, unavailableReason: "historical_unsupported" };
  }
  return { ...base, availability: InventoryAvailabilityResultSchema.parse(evaluateInventoryAvailability(stock,
    commitments.filter((row) => row.assetDefinitionId === asset.id), window)), unavailableReason: null };
}

export function buildInventoryAssessment(loaded: Loaded, venueId: string, window: InventoryWindow, now: string): InventoryAssessment {
  const stock = new Map(loaded.stock.map((row) => [row.assetDefinitionId, row]));
  const catalogue = new Map(loaded.catalogue.map((row) => [row.id, row]));
  const commitments = loaded.sources.flatMap(commitmentsFor);
  const sources = loaded.sources.filter((source) => (source.occupiedWindow !== null && inventoryWindowsOverlap(source.occupiedWindow, window))
    || (source.approvedRelease !== null && inventoryWindowsOverlap(source.approvedRelease.occupiedWindow, window)));
  for (const source of sources) {
    if (source.occupiedWindow === null || source.state === "incomplete" || source.state === "inactive") continue;
    const previousIds = new Set(commitmentsFor(source).map((row) => row.id));
    const candidate = source.demands.map((demand): InventoryCommitment => ({
      id: deterministicEventArchitectUuid(`proposal:${source.sourceDigest}:${demand.assetDefinitionId}`), venueId,
      assetDefinitionId: demand.assetDefinitionId, eventId: source.eventId, quantity: demand.quantity, status: "reserved",
      startsAt: source.occupiedWindow?.startsAt ?? window.startsAt, endsAt: source.occupiedWindow?.endsAt ?? window.endsAt }));
    const proposed = [...commitments.filter((row) => !previousIds.has(row.id)), ...candidate];
    source.proposalImpact = source.demands.map((demand) => {
      const asset = catalogue.get(demand.assetDefinitionId);
      if (asset === undefined || source.occupiedWindow === null) throw new Error("INVENTORY_CATALOGUE_INTEGRITY");
      return itemAssessment(asset, stock.get(asset.id), proposed, source.occupiedWindow, now);
    });
  }
  const items = loaded.catalogue.map((asset) => itemAssessment(asset, stock.get(asset.id), commitments, window, now));
  const issues = [...loaded.issues, ...sources.flatMap((source) => source.issues)];
  const historical = Date.parse(window.startsAt) < Date.parse(now)
    || items.some((item) => item.unavailableReason === "historical_unsupported");
  if (historical) issues.push({ code: "HISTORICAL_WINDOW_UNSUPPORTED", message: "Historical source and stock reconstruction is not supported for this window.", eventId: null, spaceId: null, phaseId: null });
  const demandIds = new Set(sources.filter((source) => source.state !== "inactive").flatMap((source) => [
    ...source.demands.map((row) => row.assetDefinitionId), ...(source.approvedRelease?.demands.map((row) => row.assetDefinitionId) ?? [])]));
  const coverage = historical ? "historical_unsupported" : issues.length > 0
    || sources.some((source) => ["unapproved", "stale", "incomplete", "revoked"].includes(source.state))
    || items.some((item) => demandIds.has(item.assetDefinitionId) && item.availability === null) ? "partial" : "complete";
  // The digest binds observations AND the full proposal footprints. Request
  // packets and wall-clock rendering timestamps cannot invalidate themselves.
  const digestFacts = { policy: "inventory_assessment_v1", venueId, window,
    sources: loaded.sources.map((source) => ({ sourceDigest: source.sourceDigest, latestReleaseId: source.latestReleaseId,
      releaseRevision: source.releaseRevision, state: source.state })), stock: loaded.stock, issues: loaded.issues };
  const approvedRequests = loaded.remedies.filter((remedy) => remedy.status === "approved" && inventoryWindowsOverlap(remedy.window, window))
    .map((remedy) => ({ id: remedy.id, kind: remedy.kind, assetDefinitionId: remedy.assetDefinitionId, quantity: remedy.quantity,
      window: remedy.window, approvedBy: remedy.approvedBy, approvedAt: remedy.approvedAt })).sort((left, right) => left.id.localeCompare(right.id));
  const assessmentDigest = inventoryDecisionDigest({ ...digestFacts, approvedRequests });
  return InventoryAssessmentSchema.parse({ venueId, timeZone: loaded.timeZone, window, assessedAt: now,
    assessmentDigest, coverage, demandScope: "frozen_placed_catalogue_objects_only",
    scopeDisclosure: "Counts cover verified placed catalogue objects only. Implied accessories are not included. Each room holds its item peak across its recorded footprint; the administrator confirms setup through return before approval.",
    issues, sources, items, remedies: loaded.remedies.filter((remedy) => inventoryWindowsOverlap(remedy.window, window))
      .map((remedy) => ({ ...remedy, check: inventoryDecisionDigest(remedy.window) !== inventoryDecisionDigest(window) ? "not_checked"
        : remedy.assessmentDigest === inventoryDecisionDigest({ ...digestFacts,
          approvedRequests: approvedRequests.filter((request) => request.id !== remedy.id) }) ? "current" : "stale" })) });
}

async function assessmentIn(db: InventoryReader, venueId: string, window: InventoryWindow) {
  const loaded = await loadInventorySources(db, venueId, window);
  return { loaded, assessment: buildInventoryAssessment(loaded, venueId, window, new Date().toISOString()) };
}
export async function assessVenueInventory(db: Database, actor: InventoryActor, venueId: string, window: InventoryWindow) {
  const scope = authorize(actor, venueId); const parsedWindow = InventoryWindowSchema.parse(window);
  return db.transaction(async (tx) => InventoryAssessmentResponseSchema.parse({ data: (await assessmentIn(tx, scope.venueId, parsedWindow)).assessment }),
    { isolationLevel: "repeatable read", accessMode: "read only" });
}

function serializationFailure(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  if ("code" in error && error.code === "40001") return true;
  return "cause" in error && error.cause !== error && serializationFailure(error.cause);
}
async function decisionTransaction<T>(db: Database, venueId: string, operation: (tx: Transaction) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        // Both stock and decision writers create a venue row version, keeping
        // waiters from retaining a pre-lock SERIALIZABLE snapshot.
        const [venue] = await tx.update(venues).set({ updatedAt: sql`${venues.updatedAt}` })
          .where(and(eq(venues.id, venueId), isNull(venues.deletedAt))).returning({ id: venues.id });
        if (venue === undefined) throw new InventoryDecisionError(404, "NOT_FOUND", "Venue not found");
        return operation(tx);
      }, { isolationLevel: "serializable" });
    } catch (error) {
      if (!serializationFailure(error)) throw error;
      if (attempt === 2) throw new InventoryDecisionError(409, "INVENTORY_CONCURRENT_CHANGE", "Inventory or its source changed concurrently. Refresh and review the decision again.");
    }
  }
  throw new Error("UNREACHABLE_INVENTORY_TRANSACTION");
}
async function replayedCommand(tx: Transaction, actor: InventoryActor, venueId: string, operation: string,
  command: Record<string, unknown> & { commandId: string }): Promise<Record<string, unknown> | null> {
  const [row] = await tx.select().from(inventoryDecisionCommands).where(and(eq(inventoryDecisionCommands.venueId, venueId),
    eq(inventoryDecisionCommands.commandId, command.commandId))).limit(1);
  if (row === undefined) return null;
  if (row.actorUserId !== actor.userId || row.operation !== operation || inventoryDecisionDigest(row.command) !== inventoryDecisionDigest(command)) {
    throw new InventoryDecisionError(409, "INVENTORY_IDEMPOTENCY_CONFLICT", "This command identity belongs to another actor or decision");
  }
  return row.result;
}
async function recordCommand(tx: Transaction, actor: InventoryActor, venueId: string, operation: string,
  command: Record<string, unknown> & { commandId: string }, result: Record<string, unknown>): Promise<void> {
  await tx.insert(inventoryDecisionCommands).values({ venueId, commandId: command.commandId, actorUserId: actor.userId,
    operation, command, result, recordedAt: new Date() });
}
function currentAssessment(assessment: InventoryAssessment, expected: string): void {
  if (assessment.assessmentDigest !== expected) throw new InventoryDecisionError(409, "INVENTORY_ASSESSMENT_STALE",
    "Stock, commitments or source evidence changed. Review a fresh assessment before approving.", { currentAssessmentDigest: assessment.assessmentDigest });
  if (assessment.coverage === "historical_unsupported") throw new InventoryDecisionError(400, "INVENTORY_HISTORY_UNSUPPORTED", "Historical inventory decisions are not supported");
}

async function writeReservation(db: Database, actorInput: InventoryActor, venueInput: string,
  command: InventoryReservationApprovalInput | InventoryReservationRevokeInput, action: "approved" | "revoked") {
  const { actor, venueId } = authorize(actorInput, venueInput);
  const operation = action === "approved" ? "reservation_approve" : "reservation_revoke";
  return decisionTransaction(db, venueId, async (tx) => {
    const previous = await replayedCommand(tx, actor, venueId, operation, command);
    const { assessment, loaded } = await assessmentIn(tx, venueId, command.window);
    if (previous !== null) return InventoryReservationMutationResponseSchema.parse({ data: {
      release: InventoryReservationReleaseSchema.parse(previous), assessment, replayed: true } });
    currentAssessment(assessment, command.expectedAssessmentDigest);
    const source = assessment.sources.find((row) => row.eventId === command.eventId && row.spaceId === command.spaceId);
    if (source === undefined) throw new InventoryDecisionError(404, "NOT_FOUND", "Reservation source not found in this assessment");
    if (source.sourceDigest !== command.expectedSourceDigest) throw new InventoryDecisionError(409, "INVENTORY_SOURCE_STALE", "The source changed. Review its current frozen demand.", { currentAssessmentDigest: assessment.assessmentDigest });
    const input = loaded.inputs.find((row) => row.eventId === source.eventId && row.spaceId === source.spaceId);
    if (input === undefined) throw new Error("INVENTORY_SOURCE_INTEGRITY");
    if (source.releaseRevision === Number.MAX_SAFE_INTEGER) throw new InventoryDecisionError(409, "INVENTORY_REVISION_LIMIT", "Reservation revision limit reached");
    let release: InventoryReservationRelease;
    if (action === "revoked") {
      if (source.approvedRelease === null) throw new InventoryDecisionError(409, "INVENTORY_NO_ACTIVE_RELEASE", "This room has no approved reservation to revoke");
      release = InventoryReservationReleaseSchema.parse({ ...source.approvedRelease, id: randomUUID(), action,
        revision: source.releaseRevision + 1, supersedesReleaseId: source.latestReleaseId,
        actorUserId: actor.userId, recordedAt: new Date().toISOString(), reason: command.reason });
    } else {
      if (["incomplete", "inactive"].includes(source.state) || source.occupiedWindow === null) {
        throw new InventoryDecisionError(409, "INVENTORY_SOURCE_INCOMPLETE", "Resolve the missing source evidence before approving this reservation");
      }
      if (Date.parse(source.occupiedWindow.startsAt) < Date.now()
        || source.proposalImpact.some((item) => item.unavailableReason === "historical_unsupported")) {
        throw new InventoryDecisionError(400, "INVENTORY_HISTORY_UNSUPPORTED", "The full occupied footprint needs historical stock or demand evidence that is not supported. Review future occupied times without clipping the reservation.");
      }
      release = InventoryReservationReleaseSchema.parse({ id: randomUUID(), venueId, eventId: source.eventId, spaceId: source.spaceId,
        revision: source.releaseRevision + 1, action, supersedesReleaseId: source.latestReleaseId, sourceDigest: source.sourceDigest,
        occupiedWindow: source.occupiedWindow, occupiedWindowConfirmed: true, demands: source.demands, phases: source.phases,
        bookings: input.bookings, actorUserId: actor.userId, recordedAt: new Date().toISOString(), reason: command.reason });
    }
    await tx.insert(inventoryReservationReleases).values({ id: release.id, venueId, eventId: release.eventId, spaceId: release.spaceId,
      revision: release.revision, actorUserId: actor.userId, recordedAt: new Date(release.recordedAt), payload: release });
    await recordCommand(tx, actor, venueId, operation, command, release);
    return InventoryReservationMutationResponseSchema.parse({ data: { release,
      assessment: (await assessmentIn(tx, venueId, command.window)).assessment, replayed: false } });
  });
}
export async function approveInventoryReservation(db: Database, actor: InventoryActor, venueId: string, input: InventoryReservationApprovalInput) {
  return writeReservation(db, actor, venueId, InventoryReservationApprovalInputSchema.parse(input), "approved");
}
export async function revokeInventoryReservation(db: Database, actor: InventoryActor, venueId: string, input: InventoryReservationRevokeInput) {
  return writeReservation(db, actor, venueId, InventoryReservationRevokeInputSchema.parse(input), "revoked");
}
export async function readInventoryReservationHistory(db: Database, actor: InventoryActor, venueId: string, eventId: string, spaceId: string) {
  const scope = authorize(actor, venueId);
  const rows = await db.select({ payload: inventoryReservationReleases.payload }).from(inventoryReservationReleases).where(and(
    eq(inventoryReservationReleases.venueId, scope.venueId), eq(inventoryReservationReleases.eventId, InventoryIdSchema.parse(eventId)),
    eq(inventoryReservationReleases.spaceId, InventoryIdSchema.parse(spaceId)))).orderBy(desc(inventoryReservationReleases.revision)).limit(100);
  return InventoryReservationHistoryResponseSchema.parse({ data: rows.map((row) => row.payload) });
}

export async function prepareInventoryRemedy(db: Database, actorInput: InventoryActor, venueInput: string, input: InventoryRemedyPrepareInput) {
  const { actor, venueId } = authorize(actorInput, venueInput); const command = InventoryRemedyPrepareInputSchema.parse(input);
  return decisionTransaction(db, venueId, async (tx) => {
    const replayed = await replayedCommand(tx, actor, venueId, "remedy_prepare", command);
    if (replayed !== null) return InventoryRemedyPrepareResponseSchema.parse({ data: { remedy: replayed, replayed: true } });
    const { assessment } = await assessmentIn(tx, venueId, command.window);
    currentAssessment(assessment, command.expectedAssessmentDigest);
    const item = assessment.items.find((row) => row.assetDefinitionId === command.assetDefinitionId);
    if (item === undefined) throw new InventoryDecisionError(404, "NOT_FOUND", "Catalogue item not found");
    const shortageSegments = item.availability?.segments.filter((segment) => segment.shortageQuantity > 0) ?? [];
    if (command.kind === "hire_request" && shortageSegments.length === 0) throw new InventoryDecisionError(409,
      "INVENTORY_SHORTAGE_UNVERIFIED", "A hire remedy requires a verified current shortage");
    const shortageCommitments = new Set(shortageSegments.flatMap((segment) => segment.commitmentIds));
    const affectedReservations = assessment.sources.filter((source) => source.approvedRelease !== null
      && source.bookingIds.length > 0 && source.approvedRelease.demands.some((row) => row.assetDefinitionId === item.assetDefinitionId)
      && (command.kind !== "hire_request" || commitmentsFor(source).some((commitment) => shortageCommitments.has(commitment.id))))
      .flatMap((source) => source.approvedRelease === null ? [] : [{ releaseId: source.approvedRelease.id, eventId: source.eventId,
        eventName: source.eventName, spaceId: source.spaceId, spaceName: source.spaceName }]);
    const remedy = InventoryRemedySchema.parse({ id: randomUUID(), venueId, kind: command.kind, assetDefinitionId: item.assetDefinitionId,
      assetName: item.name, quantity: command.quantity, window: command.window, status: "prepared", assessmentDigest: assessment.assessmentDigest,
      reason: command.reason, preparedBy: actor.userId, preparedAt: new Date().toISOString(), approvedBy: null, approvedAt: null,
      effect: "internal_request_only", check: "current", evidence: { stockRevision: item.stockRevision, shortageSegments, affectedReservations,
        missingFacts: command.kind === "hire_request" ? ["Supplier, price and delivery/return feasibility are unconfirmed.", "No external supply has been booked."]
          : ["Recoverable quantity and inspection outcome are unconfirmed.", "No physical stock has been changed."] } });
    await tx.insert(inventoryRemedyRequests).values({ id: remedy.id, venueId, preparedBy: actor.userId, preparedAt: new Date(remedy.preparedAt), payload: remedy });
    await recordCommand(tx, actor, venueId, "remedy_prepare", command, remedy);
    return InventoryRemedyPrepareResponseSchema.parse({ data: { remedy, replayed: false } });
  });
}
export async function approveInventoryRemedy(db: Database, actorInput: InventoryActor, venueInput: string, idInput: string, input: InventoryRemedyApproveInput) {
  const { actor, venueId } = authorize(actorInput, venueInput); const id = InventoryIdSchema.parse(idInput);
  const command = { ...InventoryRemedyApproveInputSchema.parse(input), remedyId: id };
  return decisionTransaction(db, venueId, async (tx) => {
    const replayed = await replayedCommand(tx, actor, venueId, "remedy_approve", command);
    if (replayed !== null) return InventoryRemedyApproveResponseSchema.parse({ data: { remedy: replayed, replayed: true } });
    const [row] = await tx.select().from(inventoryRemedyRequests).where(and(eq(inventoryRemedyRequests.venueId, venueId), eq(inventoryRemedyRequests.id, id))).for("update");
    if (row === undefined) throw new InventoryDecisionError(404, "NOT_FOUND", "Internal request not found");
    const prepared = InventoryRemedySchema.parse(row.payload);
    if (prepared.status !== "prepared") throw new InventoryDecisionError(409, "INVENTORY_REMEDY_ALREADY_APPROVED", "This internal request is already approved");
    const { assessment } = await assessmentIn(tx, venueId, prepared.window);
    currentAssessment(assessment, command.expectedAssessmentDigest);
    currentAssessment(assessment, prepared.assessmentDigest);
    const remedy = InventoryRemedySchema.parse({ ...prepared, status: "approved", approvedBy: actor.userId, approvedAt: new Date().toISOString(), check: "current" });
    await tx.update(inventoryRemedyRequests).set({ payload: remedy }).where(eq(inventoryRemedyRequests.id, id));
    await recordCommand(tx, actor, venueId, "remedy_approve", command, remedy);
    return InventoryRemedyApproveResponseSchema.parse({ data: { remedy, replayed: false } });
  });
}
export async function readInventoryRemedy(db: Database, actor: InventoryActor, venueId: string, idInput: string) {
  const scope = authorize(actor, venueId); const id = InventoryIdSchema.parse(idInput);
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ payload: inventoryRemedyRequests.payload }).from(inventoryRemedyRequests)
      .where(and(eq(inventoryRemedyRequests.venueId, scope.venueId), eq(inventoryRemedyRequests.id, id))).limit(1);
    if (row === undefined) throw new InventoryDecisionError(404, "NOT_FOUND", "Internal request not found");
    const remedy = InventoryRemedySchema.parse(row.payload);
    let assessment: InventoryAssessment;
    try { assessment = (await assessmentIn(tx, scope.venueId, remedy.window)).assessment; }
    catch (error) {
      // The immutable receipt remains readable even when current source density
      // exceeds the live assessment limit. No currentness is fabricated.
      if (!(error instanceof InventoryDecisionError) || error.code !== "INVENTORY_SOURCE_LIMIT") throw error;
      return InventoryRemedyResponseSchema.parse({ data: { ...remedy, check: "not_checked" } });
    }
    const checked = assessment.remedies.find((request) => request.id === remedy.id);
    if (checked === undefined) throw new Error("INVENTORY_REMEDY_INTEGRITY");
    return InventoryRemedyResponseSchema.parse({ data: checked });
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
