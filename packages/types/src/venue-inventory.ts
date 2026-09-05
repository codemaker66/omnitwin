import { z } from "zod";

// Venue stock is separate from the global visual catalogue. These contracts
// calculate availability from a complete, trusted set of commitments; they do
// not themselves persist stock, reserve a booking or grant a user's authority.
// PostgreSQL UUID identity is case-insensitive and serializes in lowercase.
// Normalize before constructing command identities or comparing audit snapshots.
export const InventoryIdSchema = z.string().uuid().transform((value) => value.toLowerCase());
const Id = InventoryIdSchema;
export const InventoryQuantitySchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const InventoryInstantSchema = z.string().datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());
const WindowFields = { startsAt: InventoryInstantSchema, endsAt: InventoryInstantSchema };

function orderedWindow(value: { startsAt: string; endsAt: string }): boolean {
  return Date.parse(value.startsAt) < Date.parse(value.endsAt);
}

export const InventoryWindowSchema = z.object(WindowFields).strict()
  .refine(orderedWindow, { message: "Inventory windows must have positive duration", path: ["endsAt"] });
export type InventoryWindow = z.infer<typeof InventoryWindowSchema>;

export const InventoryHireSchema = z.object({
  id: Id,
  quantity: InventoryQuantitySchema,
  ...WindowFields,
}).strict().refine(orderedWindow, { message: "Hire windows must have positive duration", path: ["endsAt"] });
export type InventoryHire = z.infer<typeof InventoryHireSchema>;

const StockFields = {
  ownedQuantity: InventoryQuantitySchema,
  damagedQuantity: InventoryQuantitySchema,
  // Other owned units unavailable for use, excluding damaged units above.
  unavailableQuantity: InventoryQuantitySchema,
  // Hired quantities are usable units within each half-open validity window.
  hires: z.array(InventoryHireSchema).max(2000),
  storageLocation: z.string().trim().min(1).max(240).nullable(),
  status: z.enum(["active", "retired"]),
};

export function validateInventoryStockCounts(
  value: { ownedQuantity: number; damagedQuantity: number; unavailableQuantity: number; hires: InventoryHire[] },
  context: z.RefinementCtx,
): void {
  if (value.damagedQuantity > value.ownedQuantity ||
      value.unavailableQuantity > value.ownedQuantity - value.damagedQuantity) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["unavailableQuantity"],
      message: "Damaged and other unavailable units cannot exceed owned stock" });
  }
  if (new Set(value.hires.map((hire) => hire.id)).size !== value.hires.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["hires"], message: "INVENTORY_DUPLICATE_ID" });
  }
}

export const InventoryStockSchema = z.object({
  venueId: Id,
  assetDefinitionId: Id,
  revision: InventoryQuantitySchema,
  ...StockFields,
  // This snapshot describes stock from this instant onward. Earlier forecasts
  // require historical stock, not an application of today's counts to the past.
  effectiveAt: InventoryInstantSchema,
}).strict().superRefine(validateInventoryStockCounts);
export type InventoryStock = z.infer<typeof InventoryStockSchema>;

export const InventoryCommitmentSchema = z.object({
  id: Id,
  venueId: Id,
  assetDefinitionId: Id,
  eventId: Id,
  quantity: InventoryQuantitySchema,
  status: z.enum(["reserved", "released"]),
  // Use the whole occupied interval, including setup/movement/breakdown.
  ...WindowFields,
}).strict().refine(orderedWindow, { message: "Commitment windows must have positive duration", path: ["endsAt"] });
export type InventoryCommitment = z.infer<typeof InventoryCommitmentSchema>;

export const InventoryActorSchema = z.object({
  userId: Id, venueId: Id.nullable(), role: z.string().min(1),
}).strict();
export type InventoryActor = z.infer<typeof InventoryActorSchema>;

/** Actor fields must come from authenticated server authority, never a body. */
export function canAdjustVenueInventory(actor: InventoryActor, venueId: string): boolean {
  const parsed = InventoryActorSchema.parse(actor);
  return parsed.role === "admin" && parsed.venueId === Id.parse(venueId);
}

export const InventoryAdjustmentCommandSchema = z.object({
  commandId: Id, venueId: Id, assetDefinitionId: Id,
  expectedRevision: InventoryQuantitySchema,
  reason: z.string().trim().min(1).max(1000),
  ...StockFields,
}).strict().superRefine(validateInventoryStockCounts);
export type InventoryAdjustmentCommand = z.infer<typeof InventoryAdjustmentCommandSchema>;

export const InventoryAdjustmentReceiptSchema = z.object({
  command: InventoryAdjustmentCommandSchema,
  actorUserId: Id,
  actorRole: z.literal("admin"),
  reason: z.string().trim().min(1).max(1000),
  recordedAt: InventoryInstantSchema,
  before: InventoryStockSchema,
  after: InventoryStockSchema,
}).strict().superRefine((receipt, context) => {
  const { command, before, after } = receipt;
  const expectedAfter = { venueId: command.venueId, assetDefinitionId: command.assetDefinitionId,
    revision: before.revision + 1, ownedQuantity: command.ownedQuantity,
    damagedQuantity: command.damagedQuantity, unavailableQuantity: command.unavailableQuantity,
    hires: command.hires, storageLocation: command.storageLocation, status: command.status,
    effectiveAt: receipt.recordedAt };
  if (command.venueId !== before.venueId || command.assetDefinitionId !== before.assetDefinitionId ||
      command.expectedRevision !== before.revision || receipt.reason !== command.reason ||
      Date.parse(receipt.recordedAt) < Date.parse(before.effectiveAt) ||
      JSON.stringify(expectedAfter) !== JSON.stringify(after)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "INVENTORY_RECEIPT_INTEGRITY" });
  }
});
export type InventoryAdjustmentReceipt = z.infer<typeof InventoryAdjustmentReceiptSchema>;

export interface InventoryAvailabilitySegment {
  readonly startsAt: string;
  readonly endsAt: string;
  readonly ownedQuantity: number;
  readonly hiredQuantity: number;
  readonly totalQuantity: number;
  readonly usableQuantity: number;
  readonly reservedQuantity: number;
  /** Signed: a negative remainder is truthful, not clamped to zero. */
  readonly remainingQuantity: number;
  readonly shortageQuantity: number;
  readonly commitmentIds: readonly string[];
  readonly eventIds: readonly string[];
}

export interface InventoryAvailability {
  readonly venueId: string;
  readonly assetDefinitionId: string;
  readonly stockRevision: number;
  readonly minimumRemainingQuantity: number;
  readonly maximumShortageQuantity: number;
  readonly segments: readonly InventoryAvailabilitySegment[];
}

export function addInventoryQuantities(left: number, right: number): number {
  const sum = left + right;
  if (!Number.isSafeInteger(left) || left < 0 || !Number.isSafeInteger(right) || right < 0 ||
      !Number.isSafeInteger(sum)) throw new Error("INVENTORY_QUANTITY_OVERFLOW");
  return sum;
}
