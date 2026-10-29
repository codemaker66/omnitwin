import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  CurrencySchema,
  DEPOSIT_HOLDING_STATES,
  DEPOSIT_PAYABLE_STATES,
  DEPOSIT_SETTLING_STATES,
  RequestDepositSchema,
  StartDepositCheckoutSchema,
  depositAmount,
  type ClientDepositView,
  type StaffDepositView,
} from "@omnitwin/types";
import { depositPayments, proposalDepositRequests, proposals } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate } from "../middleware/auth.js";
import { canManageCommercial } from "../utils/query.js";
import { CHECKOUT_SESSION_LIFETIME_MS, type DepositPayments } from "../services/payments/deposit-gateway.js";
import { paymentRowState } from "../services/payments/deposit-ledger.js";
import { acceptedVersion, depositAvailability, proposalDepositViews, requestIntegrity, requestView } from "../services/deposits.js";
import { proposalClient } from "../services/proposal-client.js";
import { notifyCommercialTeam } from "../services/commercial-notifications.js";
import { proposalDeskPath } from "../services/client-answer-notice.js";
import { loadProposalEventContext, resolveProposalShareToken } from "./proposals.js";

// ---------------------------------------------------------------------------
// Deposits (Plan 19 L5; goal 06 S6), in Stripe TEST MODE.
//
// Staff, on an accepted proposal (the venue's commercial roles, as every other
// proposal route):
//   GET  /proposals/:id/deposit                       every request and attempt
//   POST /proposals/:id/deposit                       ask for one: an amount, or a
//                                                     percentage of the accepted quote
//   POST /proposals/:id/deposit/:requestId/cancel     withdraw an unpaid request
//
// The client, through their share link:
//   GET  /proposal-share/:token/deposit               the request in force
//   POST /proposal-share/:token/deposit/checkout      open (or reopen) Stripe's
//                                                     checkout page and go to it
//
// Every request is figured from the accepted version (sent_version) and is
// checked against it again before Stripe is asked for anything: a request
// that no longer matches what was accepted is never charged. Only the venue
// whose Stripe account the key belongs to (STRIPE_DEPOSIT_VENUE_SLUG) offers
// deposits; for any other venue the routes say deposits are off. Paying a
// deposit confirms nothing in the Diary: accepted price, payment and a
// confirmed booking stay separate states (goal 06).
// ---------------------------------------------------------------------------

const IdParam = z.object({ id: z.uuid() });
const RequestParam = z.object({ id: z.uuid(), requestId: z.uuid() });
const ShareTokenParam = z.object({ token: z.string().min(32).max(96).regex(/^[A-Za-z0-9_-]+$/u) });

type DepositTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const DEPOSITS_OFF = {
  error: "Deposits are not set up for this venue.",
  code: "DEPOSITS_OFF",
} as const;

const VERSION_CHANGED = {
  error: "The accepted version is not the one this was asked from. Reload the proposal to see it.",
  code: "PROPOSAL_VERSION_CHANGED",
} as const;

const AMOUNT_MISMATCH = {
  error: "This deposit no longer matches the proposal that was accepted, so it cannot be paid. The venue team has been told.",
  code: "DEPOSIT_AMOUNT_MISMATCH",
} as const;

const PROVIDER_UNAVAILABLE = {
  error: "Stripe did not open the payment page. Nothing was charged. Please try again in a moment.",
  code: "PAYMENT_PROVIDER_UNAVAILABLE",
} as const;

/** Stripe has taken the payment; the webhook has not told us yet. */
const PAID_PENDING = {
  error: "Stripe has a payment for this deposit. It shows here as soon as Stripe confirms it.",
  code: "DEPOSIT_SETTLING",
} as const;

const REFUSAL_WORDS: Readonly<Record<"no_quote" | "zero_total" | "over_total" | "under_minimum", string>> = {
  no_quote: "The accepted version has no quote to take a deposit from.",
  zero_total: "The accepted quote comes to nothing, so there is no deposit to take.",
  over_total: "A deposit cannot be more than the accepted quote.",
  under_minimum: "Stripe cannot take a payment this small. The smallest is £0.30.",
};

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown; cause?: { code?: unknown } }).code
    ?? (error as { cause?: { code?: unknown } }).cause?.code;
  return code === "23505";
}

async function liveProposal(db: Pick<Database, "select">, id: string) {
  const [proposal] = await db.select().from(proposals)
    .where(and(eq(proposals.id, id), isNull(proposals.deletedAt)))
    .limit(1);
  return proposal;
}

/** The request's row, held until the transaction ends. */
async function holdRequest(tx: DepositTransaction, id: string) {
  const [row] = await tx.select().from(proposalDepositRequests).where(eq(proposalDepositRequests.id, id)).limit(1).for("update");
  return row;
}

export async function proposalDepositRoutes(
  server: FastifyInstance,
  opts: { db: Database; payments: DepositPayments },
): Promise<void> {
  const { db, payments } = opts;

  server.get("/:id/deposit", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    const proposal = await liveProposal(db, params.data.id);
    if (proposal === undefined) return reply.status(404).send({ error: "Proposal not found", code: "NOT_FOUND" });
    if (!canManageCommercial(request.user, proposal.venueId)) return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    const view: StaffDepositView = {
      availability: await depositAvailability(db, payments, proposal.venueId),
      requests: await proposalDepositViews(db, proposal.id),
    };
    return { data: view };
  });

  server.post("/:id/deposit", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    const body = RequestDepositSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: body.error.issues });
    const proposal = await liveProposal(db, params.data.id);
    if (proposal === undefined) return reply.status(404).send({ error: "Proposal not found", code: "NOT_FOUND" });
    if (!canManageCommercial(request.user, proposal.venueId)) return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    if (await depositAvailability(db, payments, proposal.venueId) === "off") return reply.status(409).send(DEPOSITS_OFF);
    if (proposal.status !== "accepted") {
      return reply.status(422).send({ error: "A deposit can be asked for once the client has accepted the proposal.", code: "NOT_ACCEPTED" });
    }
    const accepted = await acceptedVersion(db, proposal);
    if (accepted === null) {
      request.log.error({ proposalId: proposal.id }, "accepted proposal version could not be read");
      return reply.status(422).send({ error: "The accepted version could not be read.", code: "ACCEPTED_VERSION_UNREADABLE" });
    }
    if (body.data.version !== accepted.version) return reply.status(409).send(VERSION_CHANGED);
    const amount = depositAmount(body.data, accepted.quote);
    if (!amount.ok) return reply.status(422).send({ error: REFUSAL_WORDS[amount.refusal], code: `DEPOSIT_${amount.refusal.toUpperCase()}` });
    const quote = accepted.quote;
    if (quote === null) return reply.status(422).send({ error: REFUSAL_WORDS.no_quote, code: "DEPOSIT_NO_QUOTE" });
    // The event it is for, when the proposal's layout belongs to one.
    const event = await loadProposalEventContext(db, proposal);

    const outcome = await db.transaction(async (tx) => {
      // Held, and read again: a proposal moved on since (archived, say) or
      // given another accepted version is not asked to pay.
      const [held] = await tx.select().from(proposals).where(eq(proposals.id, proposal.id)).limit(1).for("update");
      if (held?.status !== "accepted" || held.sentVersion !== accepted.version || held.deletedAt !== null) return "changed" as const;
      // Money already paid on this proposal (on a request withdrawn as the
      // client paid, say) is refunded before another deposit is asked for.
      const earlier = await tx.select().from(depositPayments)
        .innerJoin(proposalDepositRequests, eq(proposalDepositRequests.id, depositPayments.depositRequestId))
        .where(eq(proposalDepositRequests.proposalId, proposal.id));
      if (earlier.some(({ deposit_payments: attempt }) => DEPOSIT_HOLDING_STATES.includes(paymentRowState(attempt)))) return "held" as const;
      try {
        const [row] = await tx.insert(proposalDepositRequests).values({
          venueId: proposal.venueId,
          proposalId: proposal.id,
          eventId: event?.eventId ?? null,
          proposalVersion: accepted.version,
          proposalVersionHash: accepted.sourceHash,
          basis: body.data.basis,
          percentBasisPoints: body.data.basis === "percent" ? body.data.percentBasisPoints : null,
          quoteTotalMinor: quote.totalMinor,
          amountMinor: amount.amountMinor,
          currency: quote.currency,
          requestedBy: request.user.id,
        }).returning();
        if (row === undefined) throw new Error("deposit request insert returned no row");
        return row;
      } catch (error) {
        if (isUniqueViolation(error)) return "already" as const;
        throw error;
      }
    });
    if (outcome === "changed") return reply.status(409).send(VERSION_CHANGED);
    if (outcome === "held") {
      return reply.status(409).send({ error: "A deposit has been paid on this proposal already. Refund it in full in Stripe before asking for another.", code: "DEPOSIT_HELD" });
    }
    if (outcome === "already") {
      return reply.status(409).send({ error: "A deposit has already been asked for on this proposal. Withdraw it first to ask for another.", code: "DEPOSIT_ALREADY_REQUESTED" });
    }
    return reply.status(201).send({ data: requestView(outcome, []) });
  });

  server.post("/:id/deposit/:requestId/cancel", { preHandler: [authenticate] }, async (request, reply) => {
    const params = RequestParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    const proposal = await liveProposal(db, params.data.id);
    if (proposal === undefined) return reply.status(404).send({ error: "Proposal not found", code: "NOT_FOUND" });
    if (!canManageCommercial(request.user, proposal.venueId)) return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });

    // Withdrawn first, so no new page can be opened for it; then each page
    // still open is closed at Stripe, which says whether it was paid in the
    // meantime. Stripe, not our record (which can lag its webhook), decides.
    const outcome = await db.transaction(async (tx) => {
      const held = await holdRequest(tx, params.data.requestId);
      if (held?.proposalId !== proposal.id || held.venueId !== proposal.venueId) return "missing" as const;
      const attempts = await tx.select().from(depositPayments).where(eq(depositPayments.depositRequestId, held.id));
      if (attempts.some((attempt) => DEPOSIT_HOLDING_STATES.includes(paymentRowState(attempt)))) return "held" as const;
      if (held.cancelledAt !== null) return { row: held, attempts, open: [] as string[] };
      const [row] = await tx.update(proposalDepositRequests)
        .set({ cancelledAt: new Date(), cancelledBy: request.user.id })
        .where(eq(proposalDepositRequests.id, held.id))
        .returning();
      if (row === undefined) throw new Error("deposit request update returned no row");
      const open = attempts.filter((attempt) => DEPOSIT_PAYABLE_STATES.includes(paymentRowState(attempt)))
        .map((attempt) => attempt.stripeCheckoutSessionId);
      return { row, attempts, open };
    });
    if (outcome === "missing") return reply.status(404).send({ error: "Deposit request not found", code: "NOT_FOUND" });
    if (outcome === "held") {
      return reply.status(409).send({ error: "The client has paid, or is paying, this deposit. Refund it in full in Stripe first; it can then be withdrawn.", code: "DEPOSIT_SETTLING" });
    }
    let paidMeanwhile = false;
    let unreachable = false;
    if (payments.status === "ready") {
      for (const sessionId of outcome.open) {
        try {
          if (await payments.gateway.closeCheckoutSession(sessionId) === "complete") paidMeanwhile = true;
        } catch (err) {
          unreachable = true;
          request.log.warn({ event: "deposit.close_failed", sessionId, err }, "a withdrawn deposit's checkout page could not be closed");
        }
      }
    }
    if (paidMeanwhile) {
      return reply.status(409).send({
        error: "The client paid as this was withdrawn. The payment stays on record and shows here once Stripe confirms it; refund it in Stripe if it should not stand.",
        code: "DEPOSIT_PAID_AS_WITHDRAWN",
      });
    }
    if (unreachable) {
      return reply.status(502).send({
        error: "Withdrawn, but Stripe could not be reached to close the payment page the client has open. If they pay on it, the payment is recorded and shown here.",
        code: "PAYMENT_PROVIDER_UNAVAILABLE",
      });
    }
    return { data: requestView(outcome.row, outcome.attempts) };
  });
}

/** The client's request in force, or none. */
async function inForce(db: Pick<Database, "select">, proposalId: string) {
  const [row] = await db.select().from(proposalDepositRequests)
    .where(and(eq(proposalDepositRequests.proposalId, proposalId), isNull(proposalDepositRequests.cancelledAt)))
    .orderBy(desc(proposalDepositRequests.createdAt))
    .limit(1);
  return row;
}

/**
 * What the client's link shows: the request in force, else the latest
 * withdrawn request that a payment settled on, read only. A payment made is
 * never hidden from the person who made it.
 */
async function clientView(db: Pick<Database, "select">, mode: "test" | "live", proposal: { readonly id: string; readonly status: string }): Promise<ClientDepositView> {
  const requests = await db.select().from(proposalDepositRequests)
    .where(eq(proposalDepositRequests.proposalId, proposal.id))
    .orderBy(desc(proposalDepositRequests.createdAt));
  if (requests.length === 0) return { mode, request: null, payable: false };
  const attempts = await db.select().from(depositPayments)
    .where(inArray(depositPayments.depositRequestId, requests.map((row) => row.id)))
    .orderBy(desc(depositPayments.createdAt));
  const views = requests.map((row) => requestView(row, attempts.filter((attempt) => attempt.depositRequestId === row.id)));
  const current = views.find((view) => view.cancelledAt === null)
    ?? views.find((view) => view.state !== "cancelled" && view.state !== "requested")
    ?? null;
  return { mode, request: current, payable: current !== null && current.cancelledAt === null && proposal.status === "accepted" };
}

export async function proposalShareDepositRoutes(
  server: FastifyInstance,
  opts: { db: Database; payments: DepositPayments },
): Promise<void> {
  const { db, payments } = opts;

  /**
   * The proposal behind a link that reads as accepted (an accepted proposal
   * the team has since archived still does), at a venue that takes deposits.
   * Reading needs no more; paying also needs the proposal still accepted.
   */
  async function resolve(token: string, reply: FastifyReply) {
    const resolved = await resolveProposalShareToken(db, token);
    if (resolved?.presented !== "accepted") {
      void reply.status(404).send({ error: "Not found", code: "NOT_FOUND" });
      return null;
    }
    const mode = await depositAvailability(db, payments, resolved.proposal.venueId);
    if (mode === "off" || payments.status !== "ready") {
      void reply.status(404).send({ error: "Not found", code: "NOT_FOUND" });
      return null;
    }
    return { ...resolved, mode, payments };
  }

  server.get("/:token/deposit", async (request, reply) => {
    const params = ShareTokenParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid share token", code: "VALIDATION_ERROR" });
    const resolved = await resolve(params.data.token, reply);
    if (resolved === null) return reply;
    return { data: await clientView(db, resolved.mode, resolved.proposal) };
  });

  server.post("/:token/deposit/checkout", {
    config: { rateLimit: { max: 20, timeWindow: "1 hour" } },
  }, async (request, reply) => {
    const params = ShareTokenParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid share token", code: "VALIDATION_ERROR" });
    const body = StartDepositCheckoutSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: body.error.issues });
    const resolved = await resolve(params.data.token, reply);
    if (resolved === null) return reply;
    const { proposal } = resolved;
    const gateway = resolved.payments.gateway;
    if (proposal.status !== "accepted") {
      return reply.status(409).send({ error: "This proposal is no longer taking payments here. Please contact the venue team.", code: "DEPOSIT_REQUEST_CHANGED" });
    }

    const row = await inForce(db, proposal.id);
    if (row?.id !== body.data.requestId) {
      return reply.status(409).send({ error: "This deposit request has changed. Reload the page to see the one in force.", code: "DEPOSIT_REQUEST_CHANGED" });
    }
    // Checked against the accepted version before Stripe is asked for anything.
    const accepted = await acceptedVersion(db, proposal);
    const integrity = requestIntegrity(row, accepted);
    if (!integrity.ok) {
      request.log.error({ event: "deposit.amount_mismatch", proposalId: proposal.id, depositRequestId: row.id, refusal: integrity.refusal }, "a deposit request no longer matches its accepted version");
      try {
        await notifyCommercialTeam(db, {
          venueId: proposal.venueId,
          title: "Deposit could not be paid",
          body: `The client tried to pay the deposit on ${proposal.title}, but it no longer matches the version they accepted, so nothing was charged. Withdraw it and ask again.`,
          severity: "attention",
          actionPath: proposalDeskPath(proposal.id),
        });
      } catch (err) {
        request.log.error({ event: "deposit.notice_failed", depositRequestId: row.id, err }, "the team could not be told of a deposit mismatch");
      }
      return reply.status(409).send(AMOUNT_MISMATCH);
    }

    const attempts = await db.select().from(depositPayments).where(eq(depositPayments.depositRequestId, row.id)).orderBy(desc(depositPayments.createdAt));
    if (attempts.some((attempt) => DEPOSIT_SETTLING_STATES.includes(paymentRowState(attempt)))) {
      return reply.status(409).send({ error: "This deposit has been paid, or is being paid.", code: "DEPOSIT_SETTLING" });
    }
    // A checkout page still open for a while is the same page again. One
    // about to lapse is closed at Stripe before another is opened, and if
    // Stripe says it was paid (our record can lag its webhook) no second page
    // is opened: one request never has two pages that could both be paid.
    const reopenBy = Date.now() + 5 * 60 * 1000;
    const payable = attempts.filter((attempt) => DEPOSIT_PAYABLE_STATES.includes(paymentRowState(attempt)));
    const reusable = payable.find((attempt) => attempt.sessionExpiresAt.getTime() > reopenBy);
    if (reusable !== undefined) return { data: { url: reusable.checkoutUrl } };
    for (const lapsing of payable) {
      let closed: "closed" | "complete";
      try {
        closed = await gateway.closeCheckoutSession(lapsing.stripeCheckoutSessionId);
      } catch (err) {
        request.log.error({ event: "deposit.close_failed", sessionId: lapsing.stripeCheckoutSessionId, err }, "a lapsing checkout page could not be closed");
        return reply.status(502).send(PROVIDER_UNAVAILABLE);
      }
      if (closed === "complete") return reply.status(409).send(PAID_PENDING);
    }

    const paymentId = randomUUID();
    const client = await proposalClient(db, proposal);
    // Back to a page with no share token in its address: Stripe keeps these
    // URLs and shows the cancel one on its page, and the token is the
    // client's key to their proposal. The browser that left keeps the token
    // for this tab and returns to it (pages/DepositReturnPage.tsx).
    const back = `${resolved.payments.frontendUrl}/deposit-return`;
    let session;
    try {
      session = await gateway.createCheckoutSession({
        amountMinor: row.amountMinor,
        currency: CurrencySchema.parse(row.currency),
        description: `Deposit: ${accepted?.title ?? proposal.title}`.slice(0, 200),
        customerEmail: client.email,
        successUrl: `${back}?outcome=returned`,
        cancelUrl: `${back}?outcome=left`,
        expiresAt: new Date(Date.now() + CHECKOUT_SESSION_LIFETIME_MS),
        metadata: { venue_id: proposal.venueId, proposal_id: proposal.id, deposit_request_id: row.id, deposit_payment_id: paymentId },
        idempotencyKey: `venviewer-deposit-${paymentId}`,
      });
    } catch (err) {
      request.log.error({ event: "deposit.checkout_failed", depositRequestId: row.id, err }, "Stripe did not open a checkout page");
      return reply.status(502).send(PROVIDER_UNAVAILABLE);
    }
    if (session.livemode && gateway.mode !== "live") {
      await gateway.closeCheckoutSession(session.id).catch(() => undefined);
      request.log.error({ event: "deposit.live_session_refused", depositRequestId: row.id }, "Stripe opened a live checkout page for a test-mode deployment");
      return reply.status(503).send({ error: "Payments are switched off for this deployment", code: "PAYMENTS_REFUSED" });
    }

    // Written under the request's lock, and only if nothing changed while
    // Stripe was asked: no lock is held across the call to Stripe.
    const written = await db.transaction(async (tx) => {
      const held = await holdRequest(tx, row.id);
      if (held === undefined || held.cancelledAt !== null) return { kind: "withdrawn" as const };
      const now = await tx.select().from(depositPayments).where(eq(depositPayments.depositRequestId, row.id)).orderBy(desc(depositPayments.createdAt));
      const settling = now.some((attempt) => DEPOSIT_SETTLING_STATES.includes(paymentRowState(attempt)));
      const other = now.find((attempt) => DEPOSIT_PAYABLE_STATES.includes(paymentRowState(attempt)) && attempt.sessionExpiresAt.getTime() > reopenBy);
      if (settling) return { kind: "settling" as const };
      if (other !== undefined) return { kind: "other" as const, url: other.checkoutUrl };
      await tx.insert(depositPayments).values({
        id: paymentId,
        venueId: proposal.venueId,
        depositRequestId: row.id,
        stripeCheckoutSessionId: session.id,
        checkoutUrl: session.url,
        sessionExpiresAt: session.expiresAt,
        livemode: session.livemode,
        amountMinor: row.amountMinor,
        currency: row.currency,
      });
      return { kind: "written" as const, url: session.url };
    });
    if (written.kind !== "written") {
      // Ours is not needed: close it so it can never be paid.
      await gateway.closeCheckoutSession(session.id).catch((err: unknown) => {
        request.log.warn({ event: "deposit.close_failed", sessionId: session.id, err }, "an unneeded checkout page could not be closed");
      });
    }
    if (written.kind === "withdrawn") return reply.status(409).send({ error: "The venue team has withdrawn this deposit request.", code: "DEPOSIT_REQUEST_CHANGED" });
    if (written.kind === "settling") return reply.status(409).send({ error: "This deposit has been paid, or is being paid.", code: "DEPOSIT_SETTLING" });
    return { data: { url: written.url } };
  });
}
