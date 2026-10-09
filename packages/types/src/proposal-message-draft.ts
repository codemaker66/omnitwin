import { z } from "zod";
import type { CanonicalJsonValue } from "./canonical-layout-snapshot.js";
import { CurrencySchema } from "./pricing.js";
import { MAX_LINE_ITEM_QUANTITY, MAX_QUOTE_LINE_ITEMS, MinorUnitAmountSchema } from "./proposal.js";

// ---------------------------------------------------------------------------
// Asking for an AI draft of a proposal's message (roadmap X1). The composer
// sends the quote it holds, the figures the coordinator is about to send, so
// the draft can state them; everything else the AI is told is built on the
// server from the proposal's own venue. A line is read as a version's quote
// line is, and its total is worked out on the server.
// ---------------------------------------------------------------------------

/** The longest line description, as a version's quote allows. */
const MAX_LINE_DESCRIPTION_LENGTH = 500;

export const ProposalMessageDraftQuoteLineSchema = z.object({
  description: z.string().trim().min(1).max(MAX_LINE_DESCRIPTION_LENGTH),
  quantity: z.number().int().min(1).max(MAX_LINE_ITEM_QUANTITY),
  unitAmountMinor: MinorUnitAmountSchema,
}).strict();

export const ProposalMessageDraftQuoteSchema = z.object({
  currency: CurrencySchema,
  lineItems: z.array(ProposalMessageDraftQuoteLineSchema).min(1).max(MAX_QUOTE_LINE_ITEMS),
}).strict();
export type ProposalMessageDraftQuote = z.infer<typeof ProposalMessageDraftQuoteSchema>;

/** What the composer may send. Anything else in the body is dropped: the
 *  server builds the rest of what the AI is told itself. */
export const ProposalMessageDraftRequestSchema = z.object({
  quote: ProposalMessageDraftQuoteSchema.optional(),
});
export type ProposalMessageDraftRequest = z.infer<typeof ProposalMessageDraftRequestSchema>;

/** An amount as the client reads it: "£17,600.00". Display only; never
 *  parsed back. */
export function moneyWords(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(minor / 100);
}

/** The most figures a draft's check reports, and the longest. */
export const MAX_FIGURES_TO_CHECK = 50;
const MAX_FIGURE_LENGTH = 40;

/**
 * Every number a draft states that appears nowhere in what the AI was given:
 * the evaluation's number rule, run on each draft in the product as well. A
 * time written "08:30" is read as "0830", as a client may write it, and a
 * list's own numbering ("1. ") is not a stated number. It reads digits only,
 * so a count the client wrote in words ("twelve") and the draft in digits is
 * reported for a person to check.
 */
export function figuresNotIn(draft: string, context: Record<string, CanonicalJsonValue>): string[] {
  const numbersIn = (text: string): string[] => (text
    .replace(/^\s*\d+[.)]\s/gmu, "")
    .replace(/(\d{1,2}):(\d{2})/gu, "$1$2")
    .match(/\d+/gu) ?? []).map((n) => String(Number(n)));
  const given = new Set(numbersIn(JSON.stringify(context)));
  return [...new Set(numbersIn(draft).filter((n) => !given.has(n)))]
    .slice(0, MAX_FIGURES_TO_CHECK)
    .map((n) => n.slice(0, MAX_FIGURE_LENGTH));
}

export const FiguresToCheckSchema = z.array(z.string().min(1).max(MAX_FIGURE_LENGTH)).max(MAX_FIGURES_TO_CHECK);
