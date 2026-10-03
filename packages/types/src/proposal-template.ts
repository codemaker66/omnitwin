import { z } from "zod";
import { PricingRuleIdSchema, PricingTypeSchema } from "./pricing.js";
import { SpaceIdSchema } from "./space.js";
import { VenueIdSchema } from "./venue.js";
import { findUnsupportedProposalClaim, MAX_LINE_ITEM_QUANTITY, ProposalFactsSchema } from "./proposal.js";

// ---------------------------------------------------------------------------
// Proposal templates (T-635, roadmap X1; Tier B #16; migration 0085).
//
// A venue keeps a proposal's message and quote lines for a room (or any room)
// and an occasion (or any occasion), so the next proposal starts from them
// instead of being typed again. A template holds no price. A price-list line
// is a reference to the entry, priced from the live list each time the
// template is used; a per-head or tiered line takes that event's guests; a
// typed line keeps its words and quantity and asks for its price. The
// message is the venue's words to a client, so it is held to the proposal
// claim guard, as a version's message is.
// ---------------------------------------------------------------------------

export const ProposalTemplateIdSchema = z.string().uuid();
export type ProposalTemplateId = z.infer<typeof ProposalTemplateIdSchema>;

export const MAX_TEMPLATE_LINES = 40;
export const MAX_TEMPLATE_NAME_LENGTH = 120;
export const MAX_TEMPLATE_MESSAGE_LENGTH = 4000;
export const MAX_TEMPLATE_OCCASION_LENGTH = 100;
/** As a quote line's description. */
const MAX_TEMPLATE_LINE_TEXT = 500;

/** Words PostgreSQL can keep: its text and jsonb hold no NUL character, and
 *  jsonb no unpaired UTF-16 surrogate (text would silently alter one). Words
 *  that could never be kept as sent are refused here, not failed on there.
 *  In `u` mode \p{Cs} matches only a surrogate that is not half of a pair. */
const keepable = (value: string): boolean => !value.includes("\u0000") && !/\p{Cs}/u.test(value);
const KEEPABLE_MESSAGE = "must not contain a NUL character or an unpaired surrogate";

/** A price-list entry, kept by reference: its name as saved (said if the
 *  entry is gone), its kind (a change is noticed), and a quantity only where
 *  the event cannot give one: the hours for a price an hour, a count for a
 *  flat rate. A price a head or a tiered price takes the event's guests. */
export const ProposalTemplatePriceListLineSchema = z.object({
  kind: z.literal("price_list"),
  pricingRuleId: PricingRuleIdSchema.transform((id) => id.toLowerCase()),
  name: z.string().trim().min(1).max(200).refine(keepable, KEEPABLE_MESSAGE),
  ruleType: PricingTypeSchema,
  quantity: z.number().int().min(1).max(MAX_LINE_ITEM_QUANTITY).nullable(),
}).strict();
export type ProposalTemplatePriceListLine = z.infer<typeof ProposalTemplatePriceListLineSchema>;

/** A line typed in: its words and quantity. Its price is asked for each time. */
export const ProposalTemplateTypedLineSchema = z.object({
  kind: z.literal("typed"),
  description: z.string().trim().min(1).max(MAX_TEMPLATE_LINE_TEXT).refine(keepable, KEEPABLE_MESSAGE),
  quantity: z.number().int().min(1).max(MAX_LINE_ITEM_QUANTITY),
}).strict();
export type ProposalTemplateTypedLine = z.infer<typeof ProposalTemplateTypedLineSchema>;

export const ProposalTemplateLineSchema = z.discriminatedUnion("kind", [
  ProposalTemplatePriceListLineSchema,
  ProposalTemplateTypedLineSchema,
]);
export type ProposalTemplateLine = z.infer<typeof ProposalTemplateLineSchema>;

/** A message of nothing but spaces is kept as none. */
const TemplateMessageSchema = z.string().max(MAX_TEMPLATE_MESSAGE_LENGTH).refine(keepable, KEEPABLE_MESSAGE)
  .transform((message) => (message.trim() === "" ? "" : message));

const TemplateLinesSchema = z.array(ProposalTemplateLineSchema).max(MAX_TEMPLATE_LINES);

/** The occasion as templates are matched: a key ("wedding"), or the event's
 *  own wording, lower-cased. */
export const ProposalTemplateOccasionSchema = z.string().trim().toLowerCase().min(1).max(MAX_TEMPLATE_OCCASION_LENGTH)
  .refine(keepable, KEEPABLE_MESSAGE);

function checkContent(content: { readonly message: string; readonly lines: readonly ProposalTemplateLine[] }, ctx: z.RefinementCtx): void {
  const claim = findUnsupportedProposalClaim(content.message);
  if (claim !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["message"],
      message: `Unsupported claim phrase "${claim}" is not allowed in client-facing proposal text`,
    });
  }
  content.lines.forEach((line, index) => {
    if (line.kind === "price_list" && line.quantity !== null && (line.ruleType === "per_head" || line.ruleType === "tiered")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lines", index, "quantity"],
        message: "A price a head or a tiered price takes the event's guests, so keeps no quantity",
      });
    }
  });
  if (content.message === "" && content.lines.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["message"], message: "A template keeps a message or at least one line" });
  }
}

/** What a template keeps: the message and the lines. Stored lines are read
 *  through this too, so a row that no longer parses is said, not used. */
export const ProposalTemplateContentSchema = z.object({
  message: TemplateMessageSchema,
  lines: TemplateLinesSchema,
}).superRefine(checkContent);
export type ProposalTemplateContent = z.infer<typeof ProposalTemplateContentSchema>;

const TemplateWriteShape = {
  name: z.string().trim().min(1).max(MAX_TEMPLATE_NAME_LENGTH).refine(keepable, KEEPABLE_MESSAGE),
  /** Null for any room. */
  spaceId: SpaceIdSchema.transform((id) => id.toLowerCase()).nullable(),
  /** Null for any occasion. */
  occasion: ProposalTemplateOccasionSchema.nullable(),
  message: TemplateMessageSchema,
  lines: TemplateLinesSchema,
};

export const CreateProposalTemplateSchema = z.object(TemplateWriteShape).strict().superRefine(checkContent);
export type CreateProposalTemplate = z.infer<typeof CreateProposalTemplateSchema>;
/** What the composer sends to keep a template. */
export type CreateProposalTemplateInput = z.input<typeof CreateProposalTemplateSchema>;

/** Replacing a template names the moment it was read: a template changed
 *  since is not overwritten. The moment is one PostgreSQL can hold, years
 *  1 to 9999 in UTC, so an offset past either end is refused, not failed on. */
export const ReplaceProposalTemplateSchema = z.object({
  ...TemplateWriteShape,
  expectedUpdatedAt: z.string().datetime({ offset: true }).refine((value) => {
    const year = new Date(value).getUTCFullYear();
    return year >= 1 && year <= 9999;
  }, "must be a time from year 1 to 9999"),
}).strict().superRefine(checkContent);
export type ReplaceProposalTemplate = z.infer<typeof ReplaceProposalTemplateSchema>;
export type ReplaceProposalTemplateInput = z.input<typeof ReplaceProposalTemplateSchema>;

/** A template as the venue's commercial team reads it. */
export const ProposalTemplateSchema = z.object({
  id: ProposalTemplateIdSchema,
  venueId: VenueIdSchema,
  spaceId: SpaceIdSchema.nullable(),
  /** The room's name, or null for any room or a room no longer listed. */
  roomName: z.string().nullable(),
  /** False when the template names a room the venue no longer lists. */
  roomListed: z.boolean(),
  occasion: z.string().nullable(),
  name: z.string(),
  message: z.string(),
  lines: z.array(ProposalTemplateLineSchema),
  /** False when the stored lines no longer parse: listed, to be removed,
   *  never used. Its message and lines are then empty. */
  readable: z.boolean(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  /** Who last saved it; null when not known. */
  updatedByName: z.string().nullable(),
});
export type ProposalTemplate = z.infer<typeof ProposalTemplateSchema>;

/** A proposal's event as the composer needs it before any version exists:
 *  the facts a version would take, and the room's id for the price list. */
export const ProposalEventSchema = z.object({
  facts: ProposalFactsSchema,
  spaceId: SpaceIdSchema.nullable(),
});
export type ProposalEvent = z.infer<typeof ProposalEventSchema>;
