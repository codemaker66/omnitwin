import {
  InventoryAdjustmentCommandSchema, InventoryAdjustmentReceiptSchema, InventoryActorSchema,
  InventoryInstantSchema, InventoryStockSchema, addInventoryQuantities, canAdjustVenueInventory,
  type InventoryAdjustmentCommand, type InventoryAdjustmentReceipt, type InventoryActor, type InventoryStock,
} from "./venue-inventory.js";

export interface InventoryAdjustmentResult {
  readonly stock: InventoryStock;
  readonly receipt: InventoryAdjustmentReceipt;
  readonly replayed: boolean;
}

function normalizeCommand(input: InventoryAdjustmentCommand): InventoryAdjustmentCommand {
  const command = InventoryAdjustmentCommandSchema.parse(input);
  command.hires.sort((left, right) => left.id.localeCompare(right.id));
  return command;
}

function replayAdjustment(stock: InventoryStock, command: InventoryAdjustmentCommand,
  actor: InventoryActor, receiptInput: InventoryAdjustmentReceipt): InventoryAdjustmentResult {
  const receipt = InventoryAdjustmentReceiptSchema.parse(receiptInput);
  if (receipt.actorUserId !== actor.userId || JSON.stringify(normalizeCommand(receipt.command)) !== JSON.stringify(command)) {
    throw new Error("INVENTORY_IDEMPOTENCY_CONFLICT");
  }
  if (stock.revision < receipt.after.revision ||
      (stock.revision === receipt.after.revision && JSON.stringify(stock) !== JSON.stringify(receipt.after))) {
    throw new Error("INVENTORY_RECEIPT_INTEGRITY");
  }
  // A replay acknowledges the old result; it never overwrites newer stock.
  return { stock, receipt, replayed: true };
}

/** Compute a complete adjustment and audit receipt, without side effects.
 * Persistence MUST atomically load the latest stock and matching command receipt,
 * apply this function, compare-and-swap the stock revision, and insert a uniquely
 * keyed receipt in ONE transaction. A replay must not write receipt.after over
 * result.stock. Cross-process exactly-once/concurrency guarantees require that
 * transaction; this pure function cannot provide a database lock.
 * Actor and recordedAt are trusted server context. This first slice records
 * current physical corrections; backdated/future-effective adjustments require
 * a history projection and are deliberately not inferred here. */
export function applyInventoryAdjustment(stockInput: InventoryStock, commandInput: InventoryAdjustmentCommand,
  actorInput: InventoryActor, recordedAtInput: string, existingReceipt?: InventoryAdjustmentReceipt): InventoryAdjustmentResult {
  const command = normalizeCommand(commandInput);
  const actor = InventoryActorSchema.parse(actorInput);
  if (!canAdjustVenueInventory(actor, command.venueId)) throw new Error("INVENTORY_FORBIDDEN");
  const stock = InventoryStockSchema.parse(stockInput);
  if (stock.venueId !== command.venueId || stock.assetDefinitionId !== command.assetDefinitionId) {
    throw new Error("INVENTORY_SCOPE_MISMATCH");
  }
  if (existingReceipt !== undefined) return replayAdjustment(stock, command, actor, existingReceipt);
  if (stock.revision !== command.expectedRevision) throw new Error("INVENTORY_REVISION_CONFLICT");
  const recordedAt = InventoryInstantSchema.parse(recordedAtInput);
  if (Date.parse(recordedAt) < Date.parse(stock.effectiveAt)) throw new Error("INVENTORY_TIME_CONFLICT");
  const after = InventoryStockSchema.parse({ venueId: stock.venueId, assetDefinitionId: stock.assetDefinitionId,
    revision: addInventoryQuantities(stock.revision, 1), ownedQuantity: command.ownedQuantity,
    damagedQuantity: command.damagedQuantity, unavailableQuantity: command.unavailableQuantity,
    hires: command.hires, status: command.status, storageLocation: command.storageLocation, effectiveAt: recordedAt });
  const receipt = InventoryAdjustmentReceiptSchema.parse({ command, actorUserId: actor.userId, actorRole: "admin",
    reason: command.reason, recordedAt, before: stock, after });
  return { stock: after, receipt, replayed: false };
}
