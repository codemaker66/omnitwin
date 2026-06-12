import { z } from "zod";
import { VenueIdSchema } from "./venue.js";
import { SpaceIdSchema } from "./space.js";
import { ConfigurationIdSchema } from "./configuration.js";
import { EnquiryIdSchema } from "./enquiry.js";
import { UserIdSchema } from "./user.js";
import { CurrencySchema, PricingRuleIdSchema } from "./pricing.js";
import { ShortCodeSchema } from "./url-identifiers.js";
import {
  CanonicalJsonValueSchema,
  sha256Hex,
  stableCanonicalJson,
} from "./canonical-layout-snapshot.js";

// ---------------------------------------------------------------------------
// Proposal / Quote v0 — T-427 phase 1 (schema layer only)
//
// First-class commercial domain objects: a Proposal is the client-facing
// document built from an enquiry and (optionally) a planner configuration;
// a Quote is its priced component. Versions are immutable snapshots (the
// configuration_sheet_snapshots pattern); status changes are audited through
// a history table (the enquiry_status_history pattern); money is integer
// minor units only (the services/money.ts engine contract) — no
// floating-point amounts anywhere in this module.
//
// SAFE language: nothing here encodes or permits legal/fire/occupancy
// certainty claims. Client-facing payload text is guarded against
// unsupported claim phrases at the schema boundary.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// IDs — UUID v4
// ---------------------------------------------------------------------------

export const ProposalIdSchema = z.string().uuid();
export type ProposalId = z.infer<typeof ProposalIdSchema>;

export const ProposalVersionIdSchema = z.string().uuid();
export type ProposalVersionId = z.infer<typeof ProposalVersionIdSchema>;

export const QuoteIdSchema = z.string().uuid();
export type QuoteId = z.infer<typeof QuoteIdSchema>;

export const QuoteLineItemIdSchema = z.string().uuid();
export type QuoteLineItemId = z.infer<typeof QuoteLineItemIdSchema>;

// ---------------------------------------------------------------------------
// Money — integer minor units (pence). Mirrors the API money engine: amounts
// are NEVER floating-point major units. £1,000,000 ceiling matches the
// pricing module's MAX_PRICE at minor-unit scale.
// ---------------------------------------------------------------------------

export const MAX_MINOR_UNIT_AMOUNT = 100_000_000;

export const MinorUnitAmountSchema = z
  .number()
  .int("Money must be an integer count of minor units (pence)")
  .nonnegative("Money must not be negative")
  .max(MAX_MINOR_UNIT_AMOUNT, `Amount must be at most ${String(MAX_MINOR_UNIT_AMOUNT)} minor units`);

export type MinorUnitAmount = z.infer<typeof MinorUnitAmountSchema>;

// ---------------------------------------------------------------------------
// Proposal status — matches the role-gated lifecycle the phase-2 routes will
// enforce. `changes_requested` mirrors the configuration review vocabulary so
// client feedback loops read the same way across the product.
// ---------------------------------------------------------------------------

export const PROPOSAL_STATUSES = [
  "draft",
  "sent",
  "changes_requested",
  "accepted",
  "declined",
  "expired",
  "withdrawn",
  "archived",
] as const;

export const ProposalStatusSchema = z.enum(PROPOSAL_STATUSES);
export type ProposalStatus = z.infer<typeof ProposalStatusSchema>;

export const VALID_PROPOSAL_TRANSITIONS: Readonly<
  Record<ProposalStatus, readonly ProposalStatus[]>
> = {
  draft: ["sent", "withdrawn"],
  sent: ["accepted", "declined", "changes_requested", "expired", "withdrawn"],
  changes_requested: ["sent", "withdrawn"],
  accepted: ["archived"],
  declined: ["archived"],
  expired: ["archived"],
  withdrawn: ["archived"],
  archived: [],
};

/** Returns true if transitioning from `from` to `to` is a legal state change. */
export function isValidProposalTransition(
  from: ProposalStatus,
  to: ProposalStatus,
): boolean {
  return VALID_PROPOSAL_TRANSITIONS[from].includes(to);
}

/** Statuses in which the proposing team may still edit content. */
export function isProposalEditable(status: ProposalStatus): boolean {
  return status === "draft" || status === "changes_requested";
}

/** Statuses that require `sentAt` to be populated (the row has left draft). */
export const PROPOSAL_STATUSES_REQUIRING_SENT_AT = [
  "sent",
  "changes_requested",
  "accepted",
  "declined",
  "expired",
] as const;

// ---------------------------------------------------------------------------
// Quote status — quotes are superseded (replaced by a sibling), not versioned.
// ---------------------------------------------------------------------------

export const QUOTE_STATUSES = [
  "draft",
  "issued",
  "accepted",
  "declined",
  "superseded",
  "expired",
] as const;

export const QuoteStatusSchema = z.enum(QUOTE_STATUSES);
export type QuoteStatus = z.infer<typeof QuoteStatusSchema>;

export const VALID_QUOTE_TRANSITIONS: Readonly<
  Record<QuoteStatus, readonly QuoteStatus[]>
> = {
  draft: ["issued"],
  issued: ["accepted", "declined", "superseded", "expired"],
  accepted: [],
  declined: [],
  superseded: [],
  expired: [],
};

/** Returns true if transitioning from `from` to `to` is a legal state change. */
export function isValidQuoteTransition(from: QuoteStatus, to: QuoteStatus): boolean {
  return VALID_QUOTE_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Claim guard — client-facing proposal text must not carry certainty claims
// the platform cannot support. Mirrors the public-claim-guard house tests at
// the schema boundary so unsupported wording cannot even be persisted.
// ---------------------------------------------------------------------------

export const PROPOSAL_UNSUPPORTED_CLAIM_PHRASES = [
  "fire approved",
  "certified safe",
  "legally compliant",
  "survey-grade",
  "approved for occupancy",
  "guaranteed accessible",
  "production ready",
  "photoreal digital twin",
] as const;

/** Returns the first unsupported claim phrase found in `text`, or null. */
export function findUnsupportedProposalClaim(text: string): string | null {
  const lower = text.toLowerCase();
  for (const phrase of PROPOSAL_UNSUPPORTED_CLAIM_PHRASES) {
    if (lower.includes(phrase)) {
      return phrase;
    }
  }
  return null;
}

const MAX_TITLE_LENGTH = 200;
const MAX_NAME_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_CLIENT_MESSAGE_LENGTH = 4000;
const MAX_CAPACITY_NOTE_LENGTH = 500;
const MAX_NOTES_LENGTH = 2000;

export const MAX_QUOTE_LINE_ITEMS = 200;
export const MAX_LINE_ITEM_QUANTITY = 10_000;

/** Date string in YYYY-MM-DD format. */
const DateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

/** Lowercase 64-hex SHA-256, matching the sheet-snapshot source_hash contract. */
const Sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/, "Hash must be 64 lowercase hex characters");

// ---------------------------------------------------------------------------
// Quote line item — quantity is an integer so unit × quantity is EXACT in
// minor units; `lineTotalMinor` must equal that product (no hidden rounding).
// ---------------------------------------------------------------------------

const QuoteLineItemBaseSchema = z.object({
  id: QuoteLineItemIdSchema,
  quoteId: QuoteIdSchema,
  pricingRuleId: PricingRuleIdSchema.nullable(),
  description: z.string().trim().min(1).max(MAX_DESCRIPTION_LENGTH),
  quantity: z.number().int().min(1).max(MAX_LINE_ITEM_QUANTITY),
  unitAmountMinor: MinorUnitAmountSchema,
  lineTotalMinor: MinorUnitAmountSchema,
  sortOrder: z.number().int().nonnegative(),
});

function lineTotalIsExact(
  item: { quantity: number; unitAmountMinor: number; lineTotalMinor: number },
  ctx: z.RefinementCtx,
): void {
  if (item.lineTotalMinor !== item.unitAmountMinor * item.quantity) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["lineTotalMinor"],
      message: "lineTotalMinor must equal unitAmountMinor × quantity exactly",
    });
  }
}

export const QuoteLineItemSchema = QuoteLineItemBaseSchema.superRefine(lineTotalIsExact);
export type QuoteLineItem = z.infer<typeof QuoteLineItemSchema>;

// ---------------------------------------------------------------------------
// Quote — venue-scoped, soft-deleted, minor-unit totals. A replaced quote is
// marked `superseded` and points at its successor.
// ---------------------------------------------------------------------------

export const QuoteSchema = z.object({
  id: QuoteIdSchema,
  venueId: VenueIdSchema,
  proposalId: ProposalIdSchema.nullable(),
  enquiryId: EnquiryIdSchema.nullable(),
  spaceId: SpaceIdSchema.nullable(),
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  status: QuoteStatusSchema,
  currency: CurrencySchema,
  subtotalMinor: MinorUnitAmountSchema,
  totalMinor: MinorUnitAmountSchema,
  validUntil: DateStringSchema.nullable(),
  supersededByQuoteId: QuoteIdSchema.nullable(),
  notes: z.string().max(MAX_NOTES_LENGTH).nullable(),
  createdBy: UserIdSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});

export type Quote = z.infer<typeof QuoteSchema>;

/** Quote with its line items; subtotal must be the EXACT sum of line totals. */
export const QuoteWithLineItemsSchema = QuoteSchema.extend({
  lineItems: z.array(QuoteLineItemSchema).max(MAX_QUOTE_LINE_ITEMS),
}).superRefine((quote, ctx) => {
  let sum = 0;
  for (const item of quote.lineItems) {
    sum += item.lineTotalMinor;
  }
  if (quote.subtotalMinor !== sum) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["subtotalMinor"],
      message: "subtotalMinor must equal the exact sum of line item totals",
    });
  }
});

export type QuoteWithLineItems = z.infer<typeof QuoteWithLineItemsSchema>;

// ---------------------------------------------------------------------------
// Create inputs — totals are NOT accepted from clients; the API computes them
// with the exact minor-unit engine in phase 2.
// ---------------------------------------------------------------------------

export const CreateQuoteLineItemSchema = z.object({
  pricingRuleId: PricingRuleIdSchema.nullable().optional(),
  description: z.string().trim().min(1).max(MAX_DESCRIPTION_LENGTH),
  quantity: z.number().int().min(1).max(MAX_LINE_ITEM_QUANTITY),
  unitAmountMinor: MinorUnitAmountSchema,
});

export type CreateQuoteLineItem = z.infer<typeof CreateQuoteLineItemSchema>;

export const CreateQuoteSchema = z.object({
  venueId: VenueIdSchema,
  proposalId: ProposalIdSchema.nullable().optional(),
  enquiryId: EnquiryIdSchema.nullable().optional(),
  spaceId: SpaceIdSchema.nullable().optional(),
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  currency: CurrencySchema.default("GBP"),
  validUntil: DateStringSchema.nullable().optional(),
  notes: z.string().max(MAX_NOTES_LENGTH).nullable().optional(),
  lineItems: z.array(CreateQuoteLineItemSchema).min(1).max(MAX_QUOTE_LINE_ITEMS),
});

export type CreateQuote = z.infer<typeof CreateQuoteSchema>;

// ---------------------------------------------------------------------------
// Proposal version payload — the immutable client-facing content snapshot.
// Hash policy mirrors canonical layout snapshots: domain-prefixed SHA-256 of
// the stable canonical JSON.
// ---------------------------------------------------------------------------

export const PROPOSAL_VERSION_PAYLOAD_SCHEMA_VERSION = "venviewer.proposal-version.v1";
export const PROPOSAL_VERSION_DIGEST_DOMAIN_PREFIX = "venviewer.proposal-version.v1:";

export const QuoteSnapshotLineItemSchema = z
  .object({
    description: z.string().trim().min(1).max(MAX_DESCRIPTION_LENGTH),
    quantity: z.number().int().min(1).max(MAX_LINE_ITEM_QUANTITY),
    unitAmountMinor: MinorUnitAmountSchema,
    lineTotalMinor: MinorUnitAmountSchema,
  })
  .superRefine(lineTotalIsExact);

export type QuoteSnapshotLineItem = z.infer<typeof QuoteSnapshotLineItemSchema>;

export const QuoteSnapshotSchema = z
  .object({
    quoteId: QuoteIdSchema.nullable(),
    currency: CurrencySchema,
    lineItems: z.array(QuoteSnapshotLineItemSchema).max(MAX_QUOTE_LINE_ITEMS),
    subtotalMinor: MinorUnitAmountSchema,
    totalMinor: MinorUnitAmountSchema,
  })
  .superRefine((snapshot, ctx) => {
    let sum = 0;
    for (const item of snapshot.lineItems) {
      sum += item.lineTotalMinor;
    }
    if (snapshot.subtotalMinor !== sum) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["subtotalMinor"],
        message: "subtotalMinor must equal the exact sum of line item totals",
      });
    }
  });

export type QuoteSnapshot = z.infer<typeof QuoteSnapshotSchema>;

export const ProposalVersionPayloadSchema = z
  .object({
    schemaVersion: z.literal(PROPOSAL_VERSION_PAYLOAD_SCHEMA_VERSION),
    title: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
    clientMessage: z.string().max(MAX_CLIENT_MESSAGE_LENGTH).nullable(),
    configurationId: ConfigurationIdSchema.nullable(),
    layoutRevision: z.number().int().positive().nullable(),
    capacityNote: z.string().max(MAX_CAPACITY_NOTE_LENGTH).nullable(),
    quote: QuoteSnapshotSchema.nullable(),
  })
  .superRefine((payload, ctx) => {
    const guarded: ReadonlyArray<readonly [string, string | null]> = [
      ["title", payload.title],
      ["clientMessage", payload.clientMessage],
      ["capacityNote", payload.capacityNote],
    ];
    for (const [field, text] of guarded) {
      if (text === null) continue;
      const claim = findUnsupportedProposalClaim(text);
      if (claim !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `Unsupported claim phrase "${claim}" is not allowed in client-facing proposal text`,
        });
      }
    }
  });

export type ProposalVersionPayload = z.infer<typeof ProposalVersionPayloadSchema>;

/** Domain-prefixed SHA-256 of the payload's stable canonical JSON. */
export function proposalVersionPayloadDigest(payload: ProposalVersionPayload): string {
  const canonical = CanonicalJsonValueSchema.parse(payload);
  return sha256Hex(`${PROPOSAL_VERSION_DIGEST_DOMAIN_PREFIX}${stableCanonicalJson(canonical)}`);
}

// ---------------------------------------------------------------------------
// Proposal — venue-scoped, soft-deleted, share-linked via the house nanoid
// shortcode. `currentVersion` is 0 until the first version snapshot exists.
// ---------------------------------------------------------------------------

export const ProposalSchema = z.object({
  id: ProposalIdSchema,
  venueId: VenueIdSchema,
  enquiryId: EnquiryIdSchema.nullable(),
  configurationId: ConfigurationIdSchema.nullable(),
  title: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
  status: ProposalStatusSchema,
  currentVersion: z.number().int().nonnegative(),
  shareCode: ShortCodeSchema.nullable(),
  sentAt: z.string().datetime().nullable(),
  createdBy: UserIdSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});

export type Proposal = z.infer<typeof ProposalSchema>;

export const CreateProposalSchema = z.object({
  venueId: VenueIdSchema,
  enquiryId: EnquiryIdSchema.nullable().optional(),
  configurationId: ConfigurationIdSchema.nullable().optional(),
  title: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
});

export type CreateProposal = z.infer<typeof CreateProposalSchema>;

// ---------------------------------------------------------------------------
// Proposal version — immutable snapshot row (unique per proposal+version,
// versions start at 1 and are gapless; enforced by the API in phase 2 and by
// DB constraints).
// ---------------------------------------------------------------------------

export const ProposalVersionSchema = z.object({
  id: ProposalVersionIdSchema,
  proposalId: ProposalIdSchema,
  version: z.number().int().positive(),
  payload: ProposalVersionPayloadSchema,
  sourceHash: Sha256HexSchema,
  createdBy: UserIdSchema.nullable(),
  createdAt: z.string().datetime(),
});

export type ProposalVersion = z.infer<typeof ProposalVersionSchema>;

// ---------------------------------------------------------------------------
// Proposal status history — mirrors enquiry_status_history /
// configuration_review_history so the web timeline component renders all
// three the same way.
// ---------------------------------------------------------------------------

export const ProposalStatusHistoryEntryIdSchema = z.string().uuid();
export type ProposalStatusHistoryEntryId = z.infer<typeof ProposalStatusHistoryEntryIdSchema>;

export const ProposalStatusHistoryEntrySchema = z.object({
  id: ProposalStatusHistoryEntryIdSchema,
  proposalId: ProposalIdSchema,
  fromStatus: ProposalStatusSchema,
  toStatus: ProposalStatusSchema,
  changedBy: UserIdSchema.nullable(),
  note: z.string().max(MAX_NOTES_LENGTH).nullable(),
  createdAt: z.string().datetime(),
});

export type ProposalStatusHistoryEntry = z.infer<typeof ProposalStatusHistoryEntrySchema>;
