import { z } from "zod";
import { EventIdSchema } from "./event-phase-graph.js";
import { HandoffPackIdSchema, SafeOpsTextSchema, SupplierIdSchema, SupplierInstructionIdSchema } from "./ops-compiler.js";
import { sha256Hex, stableCanonicalJson } from "./canonical-layout-snapshot.js";
import { UserIdSchema } from "./user.js";
import { VenueIdSchema } from "./venue.js";

const UUID = z.string().uuid();
const SHA256_HEX = /^[a-f0-9]{64}$/u;

export const SUPPLIER_COORDINATION_SCHEMA_VERSION = "supplier_coordination.v0";
export const SUPPLIER_COORDINATION_DIGEST_DOMAIN_PREFIX = "venviewer:supplier-coordination:v0:";

export const SUPPLIER_COORDINATION_PACK_STATUSES = [
  "draft",
  "issued",
  "acknowledged",
  "changes_requested",
  "revoked",
  "expired",
] as const;

export const SUPPLIER_COORDINATION_ITEM_KINDS = [
  "requirement",
  "load_in_window",
  "handoff_instruction",
  "contact_note",
] as const;

export const SUPPLIER_ACKNOWLEDGEMENT_STATUSES = [
  "acknowledged",
  "needs_clarification",
] as const;

export const SupplierCoordinationPackIdSchema = UUID;
export type SupplierCoordinationPackId = z.infer<typeof SupplierCoordinationPackIdSchema>;

export const SupplierCoordinationPackItemIdSchema = UUID;
export type SupplierCoordinationPackItemId = z.infer<typeof SupplierCoordinationPackItemIdSchema>;

export const SupplierCoordinationShareTokenIdSchema = UUID;
export type SupplierCoordinationShareTokenId = z.infer<typeof SupplierCoordinationShareTokenIdSchema>;

export const SupplierAcknowledgementIdSchema = UUID;
export type SupplierAcknowledgementId = z.infer<typeof SupplierAcknowledgementIdSchema>;

export const SupplierCoordinationPackStatusSchema = z.enum(SUPPLIER_COORDINATION_PACK_STATUSES);
export type SupplierCoordinationPackStatus = z.infer<typeof SupplierCoordinationPackStatusSchema>;

export const SupplierCoordinationItemKindSchema = z.enum(SUPPLIER_COORDINATION_ITEM_KINDS);
export type SupplierCoordinationItemKind = z.infer<typeof SupplierCoordinationItemKindSchema>;

export const SupplierAcknowledgementStatusSchema = z.enum(SUPPLIER_ACKNOWLEDGEMENT_STATUSES);
export type SupplierAcknowledgementStatus = z.infer<typeof SupplierAcknowledgementStatusSchema>;

export const SupplierCoordinationTextSchema = SafeOpsTextSchema;
export type SupplierCoordinationText = z.infer<typeof SupplierCoordinationTextSchema>;

export const SupplierCoordinationPackSchema = z.object({
  id: SupplierCoordinationPackIdSchema,
  venueId: VenueIdSchema,
  handoffPackId: HandoffPackIdSchema,
  eventId: EventIdSchema.nullable(),
  supplierId: SupplierIdSchema.nullable(),
  title: SupplierCoordinationTextSchema,
  contactName: z.string().trim().min(1).max(160).nullable(),
  contactEmail: z.string().email().max(255).nullable(),
  contactPhone: z.string().trim().min(1).max(40).nullable(),
  status: SupplierCoordinationPackStatusSchema,
  sourceSnapshotHash: z.string().regex(SHA256_HEX),
  sourceDigest: z.string().regex(SHA256_HEX),
  sourceLabel: SupplierCoordinationTextSchema,
  safeStatus: z.literal("supplier_safe_operations_handoff"),
  createdBy: UserIdSchema.nullable(),
  issuedAt: z.string().datetime().nullable(),
  acknowledgedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type SupplierCoordinationPack = z.infer<typeof SupplierCoordinationPackSchema>;

export const SupplierCoordinationPackItemSchema = z.object({
  id: SupplierCoordinationPackItemIdSchema,
  packId: SupplierCoordinationPackIdSchema,
  supplierInstructionId: SupplierInstructionIdSchema.nullable(),
  kind: SupplierCoordinationItemKindSchema,
  title: SupplierCoordinationTextSchema,
  detail: SupplierCoordinationTextSchema,
  arrivalWindow: SupplierCoordinationTextSchema.nullable(),
  sourceRef: z.string().trim().min(1).max(300).nullable(),
  sortOrder: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
}).strict();
export type SupplierCoordinationPackItem = z.infer<typeof SupplierCoordinationPackItemSchema>;

export const SupplierCoordinationShareTokenSchema = z.object({
  id: SupplierCoordinationShareTokenIdSchema,
  packId: SupplierCoordinationPackIdSchema,
  tokenHash: z.string().regex(SHA256_HEX),
  tokenPrefix: z.string().trim().min(6).max(16),
  createdBy: UserIdSchema.nullable(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
  lastViewedAt: z.string().datetime().nullable(),
}).strict();
export type SupplierCoordinationShareToken = z.infer<typeof SupplierCoordinationShareTokenSchema>;

export const SupplierAcknowledgementSchema = z.object({
  id: SupplierAcknowledgementIdSchema,
  packId: SupplierCoordinationPackIdSchema,
  shareTokenId: SupplierCoordinationShareTokenIdSchema.nullable(),
  status: SupplierAcknowledgementStatusSchema,
  acknowledgedByName: z.string().trim().min(1).max(160).nullable(),
  acknowledgedByEmail: z.string().email().max(255).nullable(),
  note: SupplierCoordinationTextSchema.nullable(),
  createdAt: z.string().datetime(),
}).strict();
export type SupplierAcknowledgement = z.infer<typeof SupplierAcknowledgementSchema>;

export const SupplierCoordinationPackBundleSchema = z.object({
  pack: SupplierCoordinationPackSchema,
  items: z.array(SupplierCoordinationPackItemSchema),
  shareTokens: z.array(SupplierCoordinationShareTokenSchema),
  acknowledgements: z.array(SupplierAcknowledgementSchema),
}).strict();
export type SupplierCoordinationPackBundle = z.infer<typeof SupplierCoordinationPackBundleSchema>;

export const CreateSupplierCoordinationPackInputSchema = z.object({
  handoffPackId: HandoffPackIdSchema,
  supplierInstructionIds: z.array(SupplierInstructionIdSchema).min(1).max(40),
  supplierId: SupplierIdSchema.nullable().optional(),
  title: SupplierCoordinationTextSchema.optional(),
  contactName: z.string().trim().min(1).max(160).nullable().optional(),
  contactEmail: z.string().email().max(255).nullable().optional(),
  contactPhone: z.string().trim().min(1).max(40).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
}).strict().superRefine((input, ctx) => {
  const uniqueIds = new Set(input.supplierInstructionIds);
  if (uniqueIds.size !== input.supplierInstructionIds.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["supplierInstructionIds"],
      message: "Supplier instruction IDs must be unique.",
    });
  }
});
export type CreateSupplierCoordinationPackInput = z.infer<typeof CreateSupplierCoordinationPackInputSchema>;

export const GenerateSupplierCoordinationShareTokenInputSchema = z.object({
  expiresAt: z.string().datetime().nullable().optional(),
}).strict();
export type GenerateSupplierCoordinationShareTokenInput = z.infer<typeof GenerateSupplierCoordinationShareTokenInputSchema>;

export const SupplierCoordinationShareTokenResultSchema = z.object({
  token: z.string().min(32).max(96).regex(/^[A-Za-z0-9_-]+$/u),
  shareUrl: z.string().trim().min(1).max(240),
  tokenPrefix: z.string().trim().min(6).max(16),
  pack: SupplierCoordinationPackSchema,
}).strict();
export type SupplierCoordinationShareTokenResult = z.infer<typeof SupplierCoordinationShareTokenResultSchema>;

export const CreateSupplierAcknowledgementInputSchema = z.object({
  status: SupplierAcknowledgementStatusSchema.default("acknowledged"),
  acknowledgedByName: z.string().trim().min(1).max(160).nullable().optional(),
  acknowledgedByEmail: z.string().email().max(255).nullable().optional(),
  note: SupplierCoordinationTextSchema.nullable().optional(),
}).strict().superRefine((input, ctx) => {
  if ((input.acknowledgedByName ?? null) === null && (input.acknowledgedByEmail ?? null) === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["acknowledgedByName"],
      message: "Supplier acknowledgement requires a name or email.",
    });
  }
});
export type CreateSupplierAcknowledgementInput = z.infer<typeof CreateSupplierAcknowledgementInputSchema>;

export const SupplierSafePackItemSchema = z.object({
  title: SupplierCoordinationTextSchema,
  detail: SupplierCoordinationTextSchema,
  kind: SupplierCoordinationItemKindSchema,
  arrivalWindow: SupplierCoordinationTextSchema.nullable(),
  sourceRef: z.string().trim().min(1).max(300).nullable(),
  sortOrder: z.number().int().nonnegative(),
}).strict();
export type SupplierSafePackItem = z.infer<typeof SupplierSafePackItemSchema>;

export const SupplierSafeAcknowledgementSchema = z.object({
  status: SupplierAcknowledgementStatusSchema,
  acknowledgedByName: z.string().trim().min(1).max(160).nullable(),
  note: SupplierCoordinationTextSchema.nullable(),
  createdAt: z.string().datetime(),
}).strict();
export type SupplierSafeAcknowledgement = z.infer<typeof SupplierSafeAcknowledgementSchema>;

export const SupplierSafeChangeSummarySchema = z.object({
  summary: SupplierCoordinationTextSchema,
  addedCount: z.number().int().nonnegative(),
  removedCount: z.number().int().nonnegative(),
  changedCount: z.number().int().nonnegative(),
}).strict();
export type SupplierSafeChangeSummary = z.infer<typeof SupplierSafeChangeSummarySchema>;

export const SupplierSafePackViewSchema = z.object({
  title: SupplierCoordinationTextSchema,
  venueName: z.string().trim().min(1).max(200).nullable(),
  supplierName: z.string().trim().min(1).max(200).nullable(),
  contactName: z.string().trim().min(1).max(160).nullable(),
  contactEmail: z.string().email().max(255).nullable(),
  contactPhone: z.string().trim().min(1).max(40).nullable(),
  status: SupplierCoordinationPackStatusSchema,
  safeStatus: z.literal("supplier_safe_operations_handoff"),
  issuedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  source: z.object({
    sourceLabel: SupplierCoordinationTextSchema,
    handoffVersion: z.number().int().positive(),
    compiledAt: z.string().datetime(),
    snapshotHashPrefix: z.string().regex(/^[a-f0-9]{8,16}$/u),
    sourceDigest: z.string().regex(SHA256_HEX),
  }).strict(),
  changesSincePreviousHandoff: SupplierSafeChangeSummarySchema,
  items: z.array(SupplierSafePackItemSchema),
  acknowledgements: z.array(SupplierSafeAcknowledgementSchema),
  supplierNotice: SupplierCoordinationTextSchema,
}).strict();
export type SupplierSafePackView = z.infer<typeof SupplierSafePackViewSchema>;

export function supplierCoordinationPayloadDigest(payload: {
  readonly handoffPackId: string;
  readonly sourceSnapshotHash: string;
  readonly supplierInstructionIds: readonly string[];
  readonly itemTitles: readonly string[];
  readonly itemDetails: readonly string[];
}): string {
  return sha256Hex(`${SUPPLIER_COORDINATION_DIGEST_DOMAIN_PREFIX}${stableCanonicalJson(payload)}`);
}
