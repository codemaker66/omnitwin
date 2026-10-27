import { z } from "zod";
import { EventIdSchema } from "./event-phase-graph.js";
import { HandoffPackIdSchema, SafeOpsTextSchema, SupplierIdSchema, SupplierInstructionIdSchema } from "./ops-compiler.js";
import { sha256Hex, stableCanonicalJson } from "./canonical-layout-snapshot.js";
import { UserIdSchema } from "./user.js";
import { VenueIdSchema } from "./venue.js";

const UUID = z.uuid();
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
  contactEmail: z.email().max(255).nullable(),
  contactPhone: z.string().trim().min(1).max(40).nullable(),
  status: SupplierCoordinationPackStatusSchema,
  sourceSnapshotHash: z.string().regex(SHA256_HEX),
  sourceDigest: z.string().regex(SHA256_HEX),
  sourceLabel: SupplierCoordinationTextSchema,
  safeStatus: z.literal("supplier_safe_operations_handoff"),
  createdBy: UserIdSchema.nullable(),
  issuedAt: z.iso.datetime().nullable(),
  acknowledgedAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
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
  createdAt: z.iso.datetime(),
}).strict();
export type SupplierCoordinationPackItem = z.infer<typeof SupplierCoordinationPackItemSchema>;

export const SupplierCoordinationShareTokenSchema = z.object({
  id: SupplierCoordinationShareTokenIdSchema,
  packId: SupplierCoordinationPackIdSchema,
  tokenHash: z.string().regex(SHA256_HEX),
  tokenPrefix: z.string().trim().min(6).max(16),
  createdBy: UserIdSchema.nullable(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  lastViewedAt: z.iso.datetime().nullable(),
}).strict();
export type SupplierCoordinationShareToken = z.infer<typeof SupplierCoordinationShareTokenSchema>;

export const SupplierAcknowledgementSchema = z.object({
  id: SupplierAcknowledgementIdSchema,
  packId: SupplierCoordinationPackIdSchema,
  shareTokenId: SupplierCoordinationShareTokenIdSchema.nullable(),
  status: SupplierAcknowledgementStatusSchema,
  acknowledgedByName: z.string().trim().min(1).max(160).nullable(),
  acknowledgedByEmail: z.email().max(255).nullable(),
  note: SupplierCoordinationTextSchema.nullable(),
  createdAt: z.iso.datetime(),
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
  contactEmail: z.email().max(255).nullable().optional(),
  contactPhone: z.string().trim().min(1).max(40).nullable().optional(),
  expiresAt: z.iso.datetime().nullable().optional(),
}).strict().superRefine((input, ctx) => {
  const uniqueIds = new Set(input.supplierInstructionIds);
  if (uniqueIds.size !== input.supplierInstructionIds.length) {
    ctx.addIssue({
      code: "custom",
      path: ["supplierInstructionIds"],
      message: "Supplier instruction IDs must be unique.",
    });
  }
});
export type CreateSupplierCoordinationPackInput = z.infer<typeof CreateSupplierCoordinationPackInputSchema>;

export const GenerateSupplierCoordinationShareTokenInputSchema = z.object({
  expiresAt: z.iso.datetime().nullable().optional(),
  /** A fresh pass replaces this earlier one for the same supplier and event:
   *  its links stop working once the new link exists. */
  supersedesPackId: SupplierCoordinationPackIdSchema.optional(),
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
  acknowledgedByEmail: z.email().max(255).nullable().optional(),
  note: SupplierCoordinationTextSchema.nullable().optional(),
}).strict().superRefine((input, ctx) => {
  if ((input.acknowledgedByName ?? null) === null && (input.acknowledgedByEmail ?? null) === null) {
    ctx.addIssue({
      code: "custom",
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
  createdAt: z.iso.datetime(),
}).strict();
export type SupplierSafeAcknowledgement = z.infer<typeof SupplierSafeAcknowledgementSchema>;

export const SupplierSafeChangeSummarySchema = z.object({
  summary: SupplierCoordinationTextSchema,
  addedCount: z.number().int().nonnegative(),
  removedCount: z.number().int().nonnegative(),
  changedCount: z.number().int().nonnegative(),
}).strict();
export type SupplierSafeChangeSummary = z.infer<typeof SupplierSafeChangeSummarySchema>;

/**
 * What the supplier's page says in plain words (A Door for Everyone Outside,
 * stage 1): the day and room, when the brief was last made, whether the
 * venue's plan has moved on since, what changed in their own part, and the
 * named person to call. Optional so a page served before the API carries it
 * still renders.
 */
export const SupplierPassChangesSchema = z.object({
  /** When the brief this one replaced was made. */
  since: z.iso.datetime(),
  added: z.array(SupplierCoordinationTextSchema).max(40),
  removed: z.array(SupplierCoordinationTextSchema).max(40),
  changed: z.array(SupplierCoordinationTextSchema).max(40),
}).strict();
export type SupplierPassChanges = z.infer<typeof SupplierPassChangesSchema>;

export const SupplierPassContactSchema = z.object({
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(1).max(40).nullable(),
}).strict();
export type SupplierPassContact = z.infer<typeof SupplierPassContactSchema>;

export const SupplierPassDetailsSchema = z.object({
  addressedTo: z.string().trim().min(1).max(160).nullable(),
  eventStartsAt: z.iso.datetime().nullable(),
  eventEndsAt: z.iso.datetime().nullable(),
  rooms: z.array(z.string().trim().min(1).max(200)).max(12),
  venueAddress: z.string().trim().min(1).max(500).nullable(),
  venueTimeZone: z.string().trim().min(1).max(100),
  /** When this brief was made from the venue's approved plan. */
  updatedAt: z.iso.datetime(),
  /** When the venue's plan changed after this brief was made, if it has. */
  planChangedAt: z.iso.datetime().nullable(),
  changesForYou: SupplierPassChangesSchema.nullable(),
  venueContact: SupplierPassContactSchema.nullable(),
}).strict();
export type SupplierPassDetails = z.infer<typeof SupplierPassDetailsSchema>;

export const SupplierSafePackViewSchema = z.object({
  title: SupplierCoordinationTextSchema,
  venueName: z.string().trim().min(1).max(200).nullable(),
  supplierName: z.string().trim().min(1).max(200).nullable(),
  contactName: z.string().trim().min(1).max(160).nullable(),
  contactEmail: z.email().max(255).nullable(),
  contactPhone: z.string().trim().min(1).max(40).nullable(),
  status: SupplierCoordinationPackStatusSchema,
  safeStatus: z.literal("supplier_safe_operations_handoff"),
  issuedAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  source: z.object({
    sourceLabel: SupplierCoordinationTextSchema,
    handoffVersion: z.number().int().positive(),
    compiledAt: z.iso.datetime(),
    snapshotHashPrefix: z.string().regex(/^[a-f0-9]{8,16}$/u),
    sourceDigest: z.string().regex(SHA256_HEX),
  }).strict(),
  changesSincePreviousHandoff: SupplierSafeChangeSummarySchema,
  items: z.array(SupplierSafePackItemSchema),
  acknowledgements: z.array(SupplierSafeAcknowledgementSchema),
  supplierNotice: SupplierCoordinationTextSchema,
  passDetails: SupplierPassDetailsSchema.optional(),
}).strict();
export type SupplierSafePackView = z.infer<typeof SupplierSafePackViewSchema>;

// ---------------------------------------------------------------------------
// Supplier passes — the staff side (A Door for Everyone Outside, stage 1).
//
// A pass is a supplier coordination pack with one live link. Every pass stops
// working on a date: by default seven days after the event, and never later
// than thirty days after it, so a forwarded link does not outlive the job.
// ---------------------------------------------------------------------------

export const SUPPLIER_PASS_GRACE_DAYS = 7;
export const SUPPLIER_PASS_MAX_DAYS_AFTER_EVENT = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The day a pass stops working unless someone chooses otherwise: seven days
 *  after the event's last moment. Null when the event has no date yet. */
export function defaultSupplierPassExpiry(eventLastMoment: Date | null): Date | null {
  return eventLastMoment === null ? null : new Date(eventLastMoment.getTime() + SUPPLIER_PASS_GRACE_DAYS * DAY_MS);
}

/** The latest a pass may stay open: thirty days after the event, or thirty
 *  days from now while the event has no date. */
export function latestSupplierPassExpiry(eventLastMoment: Date | null, now: Date): Date {
  const from = eventLastMoment ?? now;
  return new Date(from.getTime() + SUPPLIER_PASS_MAX_DAYS_AFTER_EVENT * DAY_MS);
}

export type SupplierPassExpiryCheck = "ok" | "missing" | "past" | "too_late";

/** Whether a chosen stop date is one a pass may carry. */
export function checkSupplierPassExpiry(expiresAt: Date | null, eventLastMoment: Date | null, now: Date): SupplierPassExpiryCheck {
  if (expiresAt === null || Number.isNaN(expiresAt.getTime())) return "missing";
  if (expiresAt.getTime() <= now.getTime()) return "past";
  if (expiresAt.getTime() > latestSupplierPassExpiry(eventLastMoment, now).getTime()) return "too_late";
  return "ok";
}

export const SupplierPassLinkSchema = z.object({
  tokenPrefix: z.string().trim().min(6).max(16),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  lastViewedAt: z.iso.datetime().nullable(),
}).strict();
export type SupplierPassLink = z.infer<typeof SupplierPassLinkSchema>;

export const SupplierPassSummarySchema = z.object({
  id: SupplierCoordinationPackIdSchema,
  title: SupplierCoordinationTextSchema,
  supplierId: SupplierIdSchema.nullable(),
  supplierName: z.string().trim().min(1).max(200).nullable(),
  contactName: z.string().trim().min(1).max(160).nullable(),
  contactEmail: z.email().max(255).nullable(),
  contactPhone: z.string().trim().min(1).max(40).nullable(),
  status: SupplierCoordinationPackStatusSchema,
  /** Whether the supplier can open it at this moment. */
  live: z.boolean(),
  createdAt: z.iso.datetime(),
  issuedAt: z.iso.datetime().nullable(),
  /** The stop date that applies, including the default for a pass made
   *  before every pass carried one. */
  expiresAt: z.iso.datetime().nullable(),
  /** True when no stop date was stored and the default is applied. */
  expiryAssumed: z.boolean(),
  revokedAt: z.iso.datetime().nullable(),
  /** When the plan this pass was made from was compiled. */
  builtFromCompiledAt: z.iso.datetime(),
  /** When the event's plan was compiled again after this pass was made. */
  planChangedAt: z.iso.datetime().nullable(),
  /** Who made the pass: the contact its page names. */
  madeBy: SupplierPassContactSchema.nullable(),
  items: z.array(z.object({
    title: SupplierCoordinationTextSchema,
    arrivalWindow: SupplierCoordinationTextSchema.nullable(),
  }).strict()),
  link: SupplierPassLinkSchema.nullable(),
  openedAt: z.iso.datetime().nullable(),
  acknowledgements: z.array(SupplierSafeAcknowledgementSchema),
}).strict();
export type SupplierPassSummary = z.infer<typeof SupplierPassSummarySchema>;

export const SupplierPassScopeItemSchema = z.object({
  instructionId: SupplierInstructionIdSchema,
  supplierId: SupplierIdSchema.nullable(),
  category: z.string().trim().min(1).max(80),
  title: SupplierCoordinationTextSchema,
  detail: SupplierCoordinationTextSchema,
  arrivalWindow: SupplierCoordinationTextSchema.nullable(),
}).strict();
export type SupplierPassScopeItem = z.infer<typeof SupplierPassScopeItemSchema>;

export const SupplierPassDirectoryEntrySchema = z.object({
  id: SupplierIdSchema,
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(80),
  contactName: z.string().trim().min(1).max(160).nullable(),
  email: z.string().trim().min(1).max(255).nullable(),
  phone: z.string().trim().min(1).max(40).nullable(),
}).strict();
export type SupplierPassDirectoryEntry = z.infer<typeof SupplierPassDirectoryEntrySchema>;

export const SupplierPassBoardSchema = z.object({
  eventId: EventIdSchema,
  venueName: z.string().trim().min(1).max(200).nullable(),
  venueAddress: z.string().trim().min(1).max(500).nullable(),
  venueTimeZone: z.string().trim().min(1).max(100),
  eventStartsAt: z.iso.datetime().nullable(),
  eventLastMomentAt: z.iso.datetime().nullable(),
  rooms: z.array(z.string().trim().min(1).max(200)).max(12),
  defaultExpiresAt: z.iso.datetime().nullable(),
  latestExpiresAt: z.iso.datetime(),
  /** Staff, managers and admins issue and withdraw; hallkeepers read. */
  canIssue: z.boolean(),
  /** The compiled plan new passes are made from; null until one exists. */
  handoff: z.object({
    id: HandoffPackIdSchema,
    compiledAt: z.iso.datetime(),
  }).strict().nullable(),
  /** Who a new pass names as the supplier's contact: the person issuing it. */
  issuer: SupplierPassContactSchema.nullable(),
  scope: z.array(SupplierPassScopeItemSchema),
  suppliers: z.array(SupplierPassDirectoryEntrySchema),
  passes: z.array(SupplierPassSummarySchema),
}).strict();
export type SupplierPassBoard = z.infer<typeof SupplierPassBoardSchema>;

export function supplierCoordinationPayloadDigest(payload: {
  readonly handoffPackId: string;
  readonly sourceSnapshotHash: string;
  readonly supplierInstructionIds: readonly string[];
  readonly itemTitles: readonly string[];
  readonly itemDetails: readonly string[];
}): string {
  return sha256Hex(`${SUPPLIER_COORDINATION_DIGEST_DOMAIN_PREFIX}${stableCanonicalJson(payload)}`);
}
