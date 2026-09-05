import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { applyInventoryAdjustment, canAdjustVenueInventory, InventoryActorSchema, InventoryStockSchema,
  VenueInventoryHistoryResponseSchema, VenueInventoryListResponseSchema, VenueInventoryReceiptSchema,
  VenueInventoryWriteCommandSchema, VenueInventoryWriteResponseSchema,
  type InventoryActor, type InventoryStock, type VenueInventoryHistoryResponse,
  type VenueInventoryListResponse, type VenueInventoryReceipt, type VenueInventoryWriteCommand,
  type VenueInventoryWriteResponse } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { assetDefinitions, venueInventoryReceipts, venueInventoryStock, venues } from "../db/schema.js";

type InventoryTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type StockRow = typeof venueInventoryStock.$inferSelect;

export class VenueInventoryError extends Error {
  constructor(readonly status: number, readonly code: string, message: string,
    readonly currentStock?: InventoryStock | null) {
    super(message);
    this.name = "VenueInventoryError";
  }
}

function assertAdmin(actor: InventoryActor, venueId: string): void {
  if (!canAdjustVenueInventory(actor, venueId)) {
    throw new VenueInventoryError(403, "FORBIDDEN", "Only this venue's administrator can manage inventory");
  }
}

function stockFromRow(row: StockRow): InventoryStock {
  const { updatedBy: _updatedBy, ...stock } = row;
  return InventoryStockSchema.parse({ ...stock, effectiveAt: row.effectiveAt.toISOString() });
}

function normalizeCommand(input: VenueInventoryWriteCommand): VenueInventoryWriteCommand {
  const parsed = VenueInventoryWriteCommandSchema.parse(input);
  parsed.hires.sort((left, right) => left.id.localeCompare(right.id));
  return parsed;
}

async function assertVenueExists(db: Database, venueId: string): Promise<void> {
  const [venue] = await db.select({ id: venues.id }).from(venues)
    .where(and(eq(venues.id, venueId), isNull(venues.deletedAt))).limit(1);
  if (venue === undefined) throw new VenueInventoryError(404, "NOT_FOUND", "Venue not found");
}

export async function listVenueInventory(db: Database, actor: InventoryActor, venueId: string): Promise<VenueInventoryListResponse> {
  assertAdmin(actor, venueId);
  await assertVenueExists(db, venueId);
  const rows = await db.select({ catalogue: { id: assetDefinitions.id, name: assetDefinitions.name, category: assetDefinitions.category },
    stock: venueInventoryStock }).from(assetDefinitions).leftJoin(venueInventoryStock,
    and(eq(venueInventoryStock.assetDefinitionId, assetDefinitions.id), eq(venueInventoryStock.venueId, venueId)))
    .orderBy(asc(assetDefinitions.category), asc(assetDefinitions.name), asc(assetDefinitions.id));
  return VenueInventoryListResponseSchema.parse({ data: { items: rows.map((row) => ({
    catalogue: row.catalogue, stock: row.stock === null ? null : stockFromRow(row.stock),
  })), availability: { status: "requires_assessment", reason: "TIME_WINDOW_REQUIRED" } } });
}

export async function readVenueInventoryHistory(db: Database, actor: InventoryActor, venueId: string,
  assetDefinitionId: string, query: { limit: number; offset: number }): Promise<VenueInventoryHistoryResponse> {
  assertAdmin(actor, venueId);
  await assertVenueExists(db, venueId);
  const [asset] = await db.select({ id: assetDefinitions.id }).from(assetDefinitions)
    .where(eq(assetDefinitions.id, assetDefinitionId)).limit(1);
  if (asset === undefined) throw new VenueInventoryError(404, "NOT_FOUND", "Catalogue item not found");
  const scope = and(eq(venueInventoryReceipts.venueId, venueId), eq(venueInventoryReceipts.assetDefinitionId, assetDefinitionId));
  // One statement keeps the page and its count on the same PostgreSQL snapshot.
  const rows = await db.select({ payload: venueInventoryReceipts.payload, total: sql<number>`count(*) over()::int` })
    .from(venueInventoryReceipts).where(scope).orderBy(desc(venueInventoryReceipts.revision))
    .limit(query.limit).offset(query.offset);
  let total = rows[0]?.total;
  if (total === undefined) {
    const [count] = await db.select({ total: sql<number>`count(*)::int` }).from(venueInventoryReceipts).where(scope);
    total = count?.total ?? 0;
  }
  return VenueInventoryHistoryResponseSchema.parse({ data: rows.map((row) => row.payload), total, ...query });
}

async function lockedStock(tx: InventoryTransaction, command: VenueInventoryWriteCommand): Promise<InventoryStock | null> {
  const [row] = await tx.select().from(venueInventoryStock).where(and(eq(venueInventoryStock.venueId, command.venueId),
    eq(venueInventoryStock.assetDefinitionId, command.assetDefinitionId))).for("update");
  return row === undefined ? null : stockFromRow(row);
}

function replay(command: VenueInventoryWriteCommand, actor: InventoryActor, current: InventoryStock | null,
  payload: VenueInventoryReceipt): VenueInventoryWriteResponse {
  const receipt = VenueInventoryReceiptSchema.parse(payload);
  if (receipt.actorUserId !== actor.userId || JSON.stringify(normalizeCommand(receipt.command)) !== JSON.stringify(command)) {
    throw new VenueInventoryError(409, "INVENTORY_IDEMPOTENCY_CONFLICT", "This change identity was already used for another request");
  }
  if (current === null || current.revision < receipt.after.revision || (current.revision === receipt.after.revision &&
    JSON.stringify(current) !== JSON.stringify(receipt.after))) throw new Error("INVENTORY_RECEIPT_INTEGRITY");
  return VenueInventoryWriteResponseSchema.parse({ data: { stock: current, receipt, replayed: true } });
}

function makeReceipt(current: InventoryStock | null, command: VenueInventoryWriteCommand,
  actor: InventoryActor, recordedAt: string): VenueInventoryReceipt {
  if (current === null && command.expectedRevision === null) {
    const { commandId: _commandId, expectedRevision: _expectedRevision, reason: _reason, ...values } = command;
    return VenueInventoryReceiptSchema.parse({ kind: "created", command, actorUserId: actor.userId, actorRole: "admin",
      reason: command.reason, recordedAt, before: null, after: { ...values, revision: 1, effectiveAt: recordedAt } });
  }
  if (current === null || command.expectedRevision === null || current.revision !== command.expectedRevision) {
    throw new VenueInventoryError(409, "INVENTORY_REVISION_CONFLICT", "Inventory has changed; review the latest stock before saving", current);
  }
  if (current.revision === Number.MAX_SAFE_INTEGER) throw new VenueInventoryError(409, "INVENTORY_REVISION_LIMIT", "Inventory revision limit reached");
  const result = applyInventoryAdjustment(current, { ...command, expectedRevision: command.expectedRevision }, actor, recordedAt);
  return VenueInventoryReceiptSchema.parse({ ...result.receipt, kind: "adjusted" });
}

async function persistReceipt(tx: InventoryTransaction, current: InventoryStock | null,
  receipt: VenueInventoryReceipt): Promise<void> {
  const { after, actorUserId } = receipt;
  const values = { ...after, effectiveAt: new Date(after.effectiveAt), updatedBy: actorUserId };
  if (current === null) await tx.insert(venueInventoryStock).values(values);
  else {
    const updated = await tx.update(venueInventoryStock).set(values).where(and(eq(venueInventoryStock.venueId, after.venueId),
      eq(venueInventoryStock.assetDefinitionId, after.assetDefinitionId), eq(venueInventoryStock.revision, current.revision))).returning({ revision: venueInventoryStock.revision });
    if (updated.length !== 1) throw new Error("INVENTORY_CAS_FAILED");
  }
  await tx.insert(venueInventoryReceipts).values({ venueId: after.venueId, assetDefinitionId: after.assetDefinitionId,
    commandId: receipt.command.commandId, actorUserId, revision: after.revision,
    recordedAt: new Date(receipt.recordedAt), payload: receipt });
}

/** Serialize a venue's infrequent stock corrections, including first-record races
 * and command identities reused across items. The database lock, CAS, unique
 * ledger keys and receipt insertion all live in this one transaction. */
export async function writeVenueInventory(db: Database, actor: InventoryActor,
  input: VenueInventoryWriteCommand): Promise<VenueInventoryWriteResponse> {
  const command = normalizeCommand(input);
  const normalizedActor = InventoryActorSchema.parse(actor);
  assertAdmin(normalizedActor, command.venueId);
  return db.transaction(async (tx) => {
    // A real row-version write makes a SERIALIZABLE decision waiting behind
    // this READ COMMITTED correction retry with a fresh snapshot. FOR UPDATE
    // alone locks without changing the tuple and permits a stale stock read.
    // Preserve the user-visible timestamp; this is the shared lock version.
    const [venue] = await tx.update(venues).set({ updatedAt: sql`${venues.updatedAt}` })
      .where(and(eq(venues.id, command.venueId), isNull(venues.deletedAt))).returning({ id: venues.id });
    if (venue === undefined) throw new VenueInventoryError(404, "NOT_FOUND", "Venue not found");
    const [recorded] = await tx.select({ payload: venueInventoryReceipts.payload }).from(venueInventoryReceipts)
      .where(and(eq(venueInventoryReceipts.venueId, command.venueId), eq(venueInventoryReceipts.commandId, command.commandId))).limit(1);
    const current = await lockedStock(tx, command);
    if (recorded !== undefined) return replay(command, normalizedActor, current, recorded.payload);
    const [asset] = await tx.select({ id: assetDefinitions.id }).from(assetDefinitions)
      .where(eq(assetDefinitions.id, command.assetDefinitionId)).limit(1);
    if (asset === undefined) throw new VenueInventoryError(404, "NOT_FOUND", "Catalogue item not found");
    const receipt = makeReceipt(current, command, normalizedActor, new Date().toISOString());
    await persistReceipt(tx, current, receipt);
    return VenueInventoryWriteResponseSchema.parse({ data: { stock: receipt.after, receipt, replayed: false } });
  });
}
