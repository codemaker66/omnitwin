import { z } from "zod";
import { InventoryAdjustmentCommandSchema, InventoryAdjustmentReceiptSchema, InventoryIdSchema, InventoryInstantSchema,
  InventoryQuantitySchema, InventoryStockSchema, validateInventoryStockCounts } from "./venue-inventory.js";

export const VenueInventoryParamsSchema = z.object({ venueId: InventoryIdSchema }).strict();
export const VenueInventoryItemParamsSchema = VenueInventoryParamsSchema.extend({ assetDefinitionId: InventoryIdSchema });

/** null explicitly records previously unknown stock; a number updates that revision. */
export const VenueInventoryWriteInputSchema = InventoryAdjustmentCommandSchema.innerType()
  .omit({ venueId: true, assetDefinitionId: true }).extend({ expectedRevision: InventoryQuantitySchema.nullable() })
  .strict().superRefine(validateInventoryStockCounts);
export type VenueInventoryWriteInput = z.infer<typeof VenueInventoryWriteInputSchema>;

export const VenueInventoryWriteCommandSchema = VenueInventoryWriteInputSchema.innerType()
  .extend(VenueInventoryItemParamsSchema.shape).strict().superRefine(validateInventoryStockCounts);
export type VenueInventoryWriteCommand = z.infer<typeof VenueInventoryWriteCommandSchema>;

const CreatedReceiptSchema = z.object({
  kind: z.literal("created"), command: VenueInventoryWriteCommandSchema,
  actorUserId: InventoryIdSchema, actorRole: z.literal("admin"), reason: z.string().trim().min(1).max(1000),
  recordedAt: InventoryInstantSchema, before: z.null(), after: InventoryStockSchema,
}).strict().superRefine((receipt, context) => {
  const { command, after } = receipt;
  const expected = { venueId: command.venueId, assetDefinitionId: command.assetDefinitionId, revision: 1,
    ownedQuantity: command.ownedQuantity, damagedQuantity: command.damagedQuantity,
    unavailableQuantity: command.unavailableQuantity, hires: command.hires,
    storageLocation: command.storageLocation, status: command.status, effectiveAt: receipt.recordedAt };
  if (command.expectedRevision !== null || receipt.reason !== command.reason || JSON.stringify(expected) !== JSON.stringify(after)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "INVENTORY_RECEIPT_INTEGRITY" });
  }
});
const AdjustedReceiptSchema = InventoryAdjustmentReceiptSchema.innerType()
  .extend({ kind: z.literal("adjusted") }).strict().superRefine((value, context) => {
    const { kind: _kind, ...receipt } = value;
    const parsed = InventoryAdjustmentReceiptSchema.safeParse(receipt);
    if (!parsed.success) for (const issue of parsed.error.issues) context.addIssue(issue);
  });

export const VenueInventoryReceiptSchema = z.union([CreatedReceiptSchema, AdjustedReceiptSchema]);
export type VenueInventoryReceipt = z.infer<typeof VenueInventoryReceiptSchema>;
export const VenueInventoryWriteResponseSchema = z.object({ data: z.object({
  stock: InventoryStockSchema, receipt: VenueInventoryReceiptSchema, replayed: z.boolean(),
}).strict() }).strict();
export type VenueInventoryWriteResponse = z.infer<typeof VenueInventoryWriteResponseSchema>;

export const VenueInventoryListResponseSchema = z.object({ data: z.object({
  items: z.array(z.object({ catalogue: z.object({ id: InventoryIdSchema, name: z.string(), category: z.string() }).strict(),
    stock: InventoryStockSchema.nullable() }).strict()),
  // Dated commitments are assessed separately; an undated stock count is not availability.
  availability: z.object({ status: z.literal("requires_assessment"), reason: z.literal("TIME_WINDOW_REQUIRED") }).strict(),
}).strict() }).strict();
export type VenueInventoryListResponse = z.infer<typeof VenueInventoryListResponseSchema>;

export const VenueInventoryHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
}).strict();
export const VenueInventoryHistoryResponseSchema = z.object({
  data: z.array(VenueInventoryReceiptSchema), total: InventoryQuantitySchema,
  limit: z.number().int().min(1).max(100), offset: InventoryQuantitySchema,
}).strict();
export type VenueInventoryHistoryResponse = z.infer<typeof VenueInventoryHistoryResponseSchema>;
