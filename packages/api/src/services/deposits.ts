import { and, desc, eq, inArray } from "drizzle-orm";
import {
  CurrencySchema,
  ProposalVersionPayloadSchema,
  STRIPE_MINIMUM_CHARGE_MINOR,
  depositFromPercent,
  depositPaymentState,
  depositRequestState,
  type DepositAvailability,
  type DepositPaymentView,
  type DepositRequestView,
  type QuoteSnapshot,
} from "@omnitwin/types";
import { depositPayments, proposalDepositRequests, proposalVersions, proposals, venues } from "../db/schema.js";
import type { Database } from "../db/client.js";
import type { DepositPayments } from "./payments/deposit-gateway.js";
import { paymentFacts } from "./payments/deposit-ledger.js";

// ---------------------------------------------------------------------------
// Deposits on an accepted proposal (Plan 19 L5): what a request comes to,
// whether it still matches what was accepted, and how it stands.
//
// The accepted version is the proposal's sent_version — the version the
// client's link showed when they accepted — never current_version: a
// platform admin can save a version on an accepted proposal (the bypass in
// routes/proposals.ts), and that version is never what was accepted, so it
// never changes what is charged.
// ---------------------------------------------------------------------------

type ProposalRow = typeof proposals.$inferSelect;
type RequestRow = typeof proposalDepositRequests.$inferSelect;
type PaymentRow = typeof depositPayments.$inferSelect;
type Reader = Pick<Database, "select">;

/** The accepted version's row and quote, as the client accepted it. */
export interface AcceptedVersion {
  readonly version: number;
  readonly sourceHash: string;
  readonly title: string;
  readonly quote: QuoteSnapshot | null;
}

/** The version a client accepted: its number, its content hash and its quote. Null if it cannot be read. */
export async function acceptedVersion(db: Reader, proposal: Pick<ProposalRow, "id" | "status" | "sentVersion">): Promise<AcceptedVersion | null> {
  if (proposal.status !== "accepted" || proposal.sentVersion === null) return null;
  const [row] = await db.select({ version: proposalVersions.version, payload: proposalVersions.payload, sourceHash: proposalVersions.sourceHash })
    .from(proposalVersions)
    .where(and(eq(proposalVersions.proposalId, proposal.id), eq(proposalVersions.version, proposal.sentVersion)))
    .limit(1);
  if (row === undefined) return null;
  const payload = ProposalVersionPayloadSchema.safeParse(row.payload);
  if (!payload.success) return null;
  return { version: row.version, sourceHash: row.sourceHash, title: payload.data.title, quote: payload.data.quote };
}

/** Whether deposits are on for this venue: the one venue whose Stripe account the key belongs to. */
export async function depositAvailability(db: Reader, payments: DepositPayments, venueId: string): Promise<DepositAvailability> {
  if (payments.status !== "ready") return "off";
  const [venue] = await db.select({ slug: venues.slug }).from(venues).where(eq(venues.id, venueId)).limit(1);
  if (venue?.slug !== payments.venueSlug) return "off";
  return payments.gateway.mode;
}

export type IntegrityRefusal =
  | "not_accepted_version"
  | "version_changed"
  | "quote_changed"
  | "amount_changed";

/**
 * Whether a request still asks for exactly what the accepted version allows:
 * the same version and content hash, the same quote total and currency, and
 * an amount its basis gives. A request that does not is never charged.
 */
export function requestIntegrity(
  request: Pick<RequestRow, "proposalVersion" | "proposalVersionHash" | "basis" | "percentBasisPoints" | "quoteTotalMinor" | "amountMinor" | "currency">,
  accepted: AcceptedVersion | null,
): { readonly ok: true } | { readonly ok: false; readonly refusal: IntegrityRefusal } {
  if (accepted === null || accepted.version !== request.proposalVersion) return { ok: false, refusal: "not_accepted_version" };
  if (accepted.sourceHash !== request.proposalVersionHash) return { ok: false, refusal: "version_changed" };
  const quote = accepted.quote;
  if (quote === null || quote.totalMinor !== request.quoteTotalMinor || quote.currency !== request.currency) return { ok: false, refusal: "quote_changed" };
  const expected = request.basis === "percent"
    ? request.percentBasisPoints === null ? -1 : depositFromPercent(quote.totalMinor, request.percentBasisPoints)
    : request.amountMinor;
  if (expected !== request.amountMinor || request.amountMinor > quote.totalMinor || request.amountMinor < STRIPE_MINIMUM_CHARGE_MINOR[quote.currency]) {
    return { ok: false, refusal: "amount_changed" };
  }
  return { ok: true };
}

export function paymentView(row: PaymentRow): DepositPaymentView {
  const state = depositPaymentState({ ...paymentFacts(row), currency: row.currency });
  return {
    id: row.id,
    state,
    amountMinor: row.amountMinor,
    currency: CurrencySchema.parse(row.currency),
    amountReceivedMinor: row.amountReceivedMinor,
    amountRefundedMinor: row.amountRefundedMinor,
    failureMessage: row.failureMessage,
    createdAt: row.createdAt.toISOString(),
    paidAt: row.paidAt?.toISOString() ?? null,
    lastEventAt: row.lastEventAt?.toISOString() ?? null,
  };
}

export function requestView(row: RequestRow, payments: readonly PaymentRow[]): DepositRequestView {
  const views = payments.map(paymentView);
  return {
    id: row.id,
    state: depositRequestState(row.cancelledAt !== null, views),
    basis: row.basis,
    percentBasisPoints: row.percentBasisPoints,
    amountMinor: row.amountMinor,
    currency: CurrencySchema.parse(row.currency),
    quoteTotalMinor: row.quoteTotalMinor,
    proposalVersion: row.proposalVersion,
    createdAt: row.createdAt.toISOString(),
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    payments: views,
  };
}

/** Every request for a proposal with its attempts, newest first. */
export async function proposalDepositViews(db: Reader, proposalId: string): Promise<DepositRequestView[]> {
  const requests = await db.select().from(proposalDepositRequests)
    .where(eq(proposalDepositRequests.proposalId, proposalId))
    .orderBy(desc(proposalDepositRequests.createdAt));
  if (requests.length === 0) return [];
  const attempts = await db.select().from(depositPayments)
    .where(inArray(depositPayments.depositRequestId, requests.map((request) => request.id)))
    .orderBy(desc(depositPayments.createdAt));
  return requests.map((request) => requestView(request, attempts.filter((attempt) => attempt.depositRequestId === request.id)));
}
