import Fastify, { type FastifyInstance } from "fastify";
import rawBody from "fastify-raw-body";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { proposalVersionPayloadDigest, type ClientDepositView, type DepositRequestView, type StaffDepositView } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { proposalDepositRoutes, proposalShareDepositRoutes } from "../routes/deposits.js";
import { stripeWebhookRoutes } from "../routes/stripe-webhook.js";
import type { DepositPayments } from "../services/payments/deposit-gateway.js";
import {
  TestDepositGateway,
  openPaymentsDatabase,
  paymentsTestUrl,
  seedAcceptedProposal,
  stripeEvent,
  stripeSignature,
  type AcceptedProposalFixture,
} from "./helpers/payments-db.js";

// ---------------------------------------------------------------------------
// The deposit flow through its real routes on migrated PostgreSQL, with
// Stripe answered at the gateway (Plan 19 L5):
//
//   - the venue asks for an amount or a percentage of the ACCEPTED quote,
//     never of a version saved since, once, and can withdraw an unpaid one;
//   - only the venue's own commercial team can, and only at the venue whose
//     Stripe account is configured; another venue's staff are refused;
//   - the client's Pay opens one checkout page per request, re-opens the same
//     one, refuses a request that no longer matches what was accepted (an
//     amount mismatch), and refuses once the deposit is paid;
//   - with payments refused (a live key), no route takes a payment.
// ---------------------------------------------------------------------------

process.env["NODE_ENV"] = "test";

interface Reply<T> { readonly status: number; readonly body: { readonly data?: T; readonly code?: string; readonly error?: string } }

describe.skipIf(paymentsTestUrl === undefined)("deposits through the routes on migrated PostgreSQL", () => {
  let pool: Pool;
  let db: Database;
  let server: FastifyInstance;
  let refusedServer: FastifyInstance;
  const gateway = new TestDepositGateway();
  // Each fixture's venue is the one the key belongs to; set per test.
  const payments = { status: "ready" as const, gateway, venueSlug: "unset", frontendUrl: "https://venviewer.test" };

  async function serve(config: DepositPayments): Promise<FastifyInstance> {
    const app = Fastify();
    await app.register(rawBody, { field: "rawBody", global: false, runFirst: true, encoding: false });
    await app.register(proposalDepositRoutes, { db, payments: config, prefix: "/proposals" });
    await app.register(proposalShareDepositRoutes, { db, payments: config, prefix: "/proposal-share" });
    await app.register(stripeWebhookRoutes, { db, payments: config, prefix: "/webhooks" });
    await app.ready();
    return app;
  }

  beforeAll(async () => {
    ({ pool, db } = await openPaymentsDatabase(`deposits_${randomUUID()}`));
    server = await serve(payments);
    refusedServer = await serve({ status: "refused", reason: "a live key without the live flag" });
  }, 180_000);

  afterAll(async () => {
    await server?.close();
    await refusedServer?.close();
    await pool?.end();
  });

  async function call<T>(method: "GET" | "POST", url: string, headers: Record<string, string> = {}, payload?: unknown, app = server): Promise<Reply<T>> {
    const res = await app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });
    return { status: res.statusCode, body: res.body === "" ? {} : res.json() };
  }

  async function accepted(options: Parameters<typeof seedAcceptedProposal>[1] = {}): Promise<AcceptedProposalFixture> {
    const slug = `th-${randomUUID().slice(0, 12)}`;
    payments.venueSlug = slug;
    return seedAcceptedProposal(pool, { venueSlug: slug, ...options });
  }

  const ask = (f: AcceptedProposalFixture, body: Record<string, unknown>, headers = f.staff) =>
    call<DepositRequestView>("POST", `/proposals/${f.proposalId}/deposit`, headers, { version: 1, ...body });
  const pay = (f: AcceptedProposalFixture, requestId: string) =>
    call<{ url: string }>("POST", `/proposal-share/${f.token}/deposit/checkout`, {}, { requestId });

  describe("the venue asks", () => {
    it("for a percentage of the accepted quote, in whole pence, against the proposal's event", async () => {
      const f = await accepted({ totalMinor: 333_333 });
      const res = await ask(f, { basis: "percent", percentBasisPoints: 2_500 });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ state: "requested", basis: "percent", percentBasisPoints: 2_500, amountMinor: 83_333, quoteTotalMinor: 333_333, proposalVersion: 1 });
      const { rows } = await pool.query("SELECT event_id, proposal_version_hash FROM proposal_deposit_requests WHERE proposal_id = $1", [f.proposalId]);
      expect(rows[0]).toEqual({ event_id: f.eventId, proposal_version_hash: proposalVersionPayloadDigest(f.payload) });
      const view = await call<StaffDepositView>("GET", `/proposals/${f.proposalId}/deposit`, f.staff);
      expect(view.body.data?.availability).toBe("test");
      expect(view.body.data?.requests).toHaveLength(1);
    });

    it("from the accepted version even after a platform admin saves another on the accepted proposal", async () => {
      const f = await accepted();
      const later = { ...f.payload, quote: { ...f.payload.quote, lineItems: [{ description: "Grand Hall hire", quantity: 1, unitAmountMinor: 900_000, lineTotalMinor: 900_000 }], subtotalMinor: 900_000, totalMinor: 900_000 } };
      await pool.query("INSERT INTO proposal_versions (proposal_id, version, payload, source_hash) VALUES ($1, 2, $2, $3)", [f.proposalId, JSON.stringify(later), proposalVersionPayloadDigest(later as typeof f.payload)]);
      await pool.query("UPDATE proposals SET current_version = 2 WHERE id = $1", [f.proposalId]);
      expect((await ask(f, { basis: "percent", percentBasisPoints: 1_000, version: 2 })).body.code).toBe("PROPOSAL_VERSION_CHANGED");
      const res = await ask(f, { basis: "percent", percentBasisPoints: 1_000 });
      expect(res.body.data).toMatchObject({ amountMinor: 25_000, quoteTotalMinor: 250_000, proposalVersion: 1 });
    });

    it("once: a second request waits until the first is withdrawn", async () => {
      const f = await accepted();
      const first = await ask(f, { basis: "amount", amountMinor: 50_000 });
      expect((await ask(f, { basis: "amount", amountMinor: 60_000 })).body.code).toBe("DEPOSIT_ALREADY_REQUESTED");
      const withdrawn = await call<DepositRequestView>("POST", `/proposals/${f.proposalId}/deposit/${first.body.data?.id ?? ""}/cancel`, f.staff);
      expect(withdrawn.body.data?.state).toBe("cancelled");
      expect((await ask(f, { basis: "amount", amountMinor: 60_000 })).status).toBe(201);
    });

    it("never for more than the quote, less than Stripe takes, or before acceptance", async () => {
      const f = await accepted();
      expect((await ask(f, { basis: "amount", amountMinor: 250_001 })).body.code).toBe("DEPOSIT_OVER_TOTAL");
      expect((await ask(f, { basis: "amount", amountMinor: 29 })).body.code).toBe("DEPOSIT_UNDER_MINIMUM");
      expect((await ask(f, { basis: "percent", percentBasisPoints: 10_001 })).status).toBe(400);
      const sent = await accepted({ status: "sent" });
      expect((await ask(sent, { basis: "amount", amountMinor: 50_000 })).body.code).toBe("NOT_ACCEPTED");
    });

    it("only as the venue's own commercial team: another venue's staff and the floor are refused", async () => {
      const f = await accepted();
      const made = await ask(f, { basis: "amount", amountMinor: 50_000 });
      const requestId = made.body.data?.id ?? "";
      for (const headers of [f.otherStaff, f.hallkeeper]) {
        expect((await call("GET", `/proposals/${f.proposalId}/deposit`, headers)).status).toBe(403);
        expect((await ask(f, { basis: "amount", amountMinor: 1_000 }, headers)).status).toBe(403);
        expect((await call("POST", `/proposals/${f.proposalId}/deposit/${requestId}/cancel`, headers)).status).toBe(403);
      }
      expect((await call("GET", `/proposals/${f.proposalId}/deposit`)).status).toBe(401);
      // A request is withdrawn only through its own proposal.
      const other = await accepted();
      expect((await call("POST", `/proposals/${other.proposalId}/deposit/${requestId}/cancel`, other.staff)).status).toBe(404);
    });

    it("only at the venue whose Stripe account is configured", async () => {
      const f = await accepted();
      payments.venueSlug = "another-venues-account";
      expect((await ask(f, { basis: "amount", amountMinor: 50_000 })).body.code).toBe("DEPOSITS_OFF");
      expect((await call<StaffDepositView>("GET", `/proposals/${f.proposalId}/deposit`, f.staff)).body.data?.availability).toBe("off");
      expect((await call("GET", `/proposal-share/${f.token}/deposit`)).status).toBe(404);
    });
  });

  describe("the client pays", () => {
    it("through one checkout page per request, opened again rather than twice", async () => {
      const f = await accepted();
      const requestId = (await ask(f, { basis: "percent", percentBasisPoints: 2_000 })).body.data?.id ?? "";
      const before = gateway.created.length;
      const first = await pay(f, requestId);
      expect(first.status).toBe(200);
      expect(first.body.data?.url).toMatch(/^https:\/\/checkout\.stripe\.com\//u);
      expect((await pay(f, requestId)).body.data?.url).toBe(first.body.data?.url);
      expect(gateway.created.length - before).toBe(1);
      const sent = gateway.created.at(-1);
      expect(sent).toMatchObject({ amountMinor: 50_000, currency: "GBP", customerEmail: f.clientEmail });
      expect(sent?.successUrl).toBe(`https://venviewer.test/proposal-share/${f.token}?deposit=returned`);
      expect(sent?.metadata).toMatchObject({ venue_id: f.venueId, proposal_id: f.proposalId, deposit_request_id: requestId });
      const view = await call<ClientDepositView>("GET", `/proposal-share/${f.token}/deposit`);
      expect(view.body.data).toMatchObject({ mode: "test", request: { id: requestId, state: "requested", amountMinor: 50_000 } });
    });

    it("keeps one page when Pay is pressed twice at once, closing the spare at Stripe", async () => {
      const f = await accepted();
      const requestId = (await ask(f, { basis: "amount", amountMinor: 40_000 })).body.data?.id ?? "";
      const expiredBefore = gateway.expired.length;
      const [a, b] = await Promise.all([pay(f, requestId), pay(f, requestId)]);
      expect(a.body.data?.url).toBe(b.body.data?.url);
      const { rows } = await pool.query("SELECT count(*)::int AS n FROM deposit_payments WHERE deposit_request_id = $1", [requestId]);
      expect(rows[0]).toEqual({ n: 1 });
      expect(gateway.expired.length - expiredBefore).toBeLessThanOrEqual(1);
    });

    it("is refused a request that no longer matches what was accepted, and nothing reaches Stripe", async () => {
      const f = await accepted();
      const requestId = (await ask(f, { basis: "percent", percentBasisPoints: 2_000 })).body.data?.id ?? "";
      // Tampered after it was asked for: 20% of £2,500 is £500, not £400.
      await pool.query("UPDATE proposal_deposit_requests SET amount_minor = 40000 WHERE id = $1", [requestId]);
      const before = gateway.created.length;
      const res = await pay(f, requestId);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("DEPOSIT_AMOUNT_MISMATCH");
      expect(gateway.created.length).toBe(before);
      const { rows } = await pool.query("SELECT title FROM event_plan_notifications WHERE venue_id = $1", [f.venueId]);
      expect(rows.map((row: { title: string }) => row.title)).toContain("Deposit could not be paid");
    });

    it("is refused once paid, and the venue can no longer withdraw it", async () => {
      const f = await accepted();
      const requestId = (await ask(f, { basis: "amount", amountMinor: 50_000 })).body.data?.id ?? "";
      await pay(f, requestId);
      const session = gateway.created.at(-1);
      const { rows } = await pool.query<{ stripe_checkout_session_id: string; id: string }>("SELECT id, stripe_checkout_session_id FROM deposit_payments WHERE deposit_request_id = $1", [requestId]);
      const body = stripeEvent("checkout.session.completed", {
        id: rows[0]?.stripe_checkout_session_id, payment_status: "paid", amount_total: 50_000, currency: "gbp", payment_intent: `pi_${randomUUID().replaceAll("-", "")}`, metadata: session?.metadata,
      });
      const delivered = await server.inject({ method: "POST", url: "/webhooks/stripe", payload: body, headers: { "content-type": "application/json", "stripe-signature": stripeSignature(body) } });
      expect(delivered.json()).toMatchObject({ outcome: "applied" });
      const view = await call<ClientDepositView>("GET", `/proposal-share/${f.token}/deposit`);
      expect(view.body.data?.request?.state).toBe("paid");
      expect(view.body.data?.request?.payments[0]?.paidAt).not.toBeNull();
      expect((await pay(f, requestId)).body.code).toBe("DEPOSIT_SETTLING");
      expect((await call("POST", `/proposals/${f.proposalId}/deposit/${requestId}/cancel`, f.staff)).body.code).toBe("DEPOSIT_SETTLING");
    });

    it("cannot pay a withdrawn request: its open page is closed at Stripe", async () => {
      const f = await accepted();
      const requestId = (await ask(f, { basis: "amount", amountMinor: 50_000 })).body.data?.id ?? "";
      await pay(f, requestId);
      const { rows } = await pool.query<{ stripe_checkout_session_id: string }>("SELECT stripe_checkout_session_id FROM deposit_payments WHERE deposit_request_id = $1", [requestId]);
      await call("POST", `/proposals/${f.proposalId}/deposit/${requestId}/cancel`, f.staff);
      expect(gateway.expired).toContain(rows[0]?.stripe_checkout_session_id);
      expect((await call<ClientDepositView>("GET", `/proposal-share/${f.token}/deposit`)).body.data?.request).toBeNull();
      expect((await pay(f, requestId)).body.code).toBe("DEPOSIT_REQUEST_CHANGED");
    });

    it("only through a link to this proposal: another proposal's request is not theirs", async () => {
      const f = await accepted();
      const theirs = await accepted();
      const requestId = (await ask(theirs, { basis: "amount", amountMinor: 50_000 })).body.data?.id ?? "";
      payments.venueSlug = (await pool.query<{ slug: string }>("SELECT slug FROM venues WHERE id = $1", [f.venueId])).rows[0]?.slug ?? "";
      expect((await pay(f, requestId)).body.code).toBe("DEPOSIT_REQUEST_CHANGED");
      expect((await call("GET", "/proposal-share/not-a-real-token-but-long-enough-to-pass-the-shape/deposit")).status).toBe(404);
    });

    it("hears plainly when Stripe cannot be reached, and nothing is written", async () => {
      const f = await accepted();
      const requestId = (await ask(f, { basis: "amount", amountMinor: 50_000 })).body.data?.id ?? "";
      gateway.failNextCreate = true;
      const res = await pay(f, requestId);
      expect(res.status).toBe(502);
      expect(res.body.code).toBe("PAYMENT_PROVIDER_UNAVAILABLE");
      const { rows } = await pool.query("SELECT count(*)::int AS n FROM deposit_payments WHERE deposit_request_id = $1", [requestId]);
      expect(rows[0]).toEqual({ n: 0 });
    });
  });

  describe("with payments refused (a live key without the live flag)", () => {
    it("takes nothing: the venue cannot ask, the client finds nothing to pay, and the webhook answers 503", async () => {
      const f = await accepted();
      expect((await ask(f, { basis: "amount", amountMinor: 50_000 })).status).toBe(201);
      const requestId = (await pool.query<{ id: string }>("SELECT id FROM proposal_deposit_requests WHERE proposal_id = $1", [f.proposalId])).rows[0]?.id ?? "";
      expect((await call("POST", `/proposals/${f.proposalId}/deposit`, f.staff, { basis: "amount", amountMinor: 1_000, version: 1 }, refusedServer)).body.code).toBe("DEPOSITS_OFF");
      expect((await call<StaffDepositView>("GET", `/proposals/${f.proposalId}/deposit`, f.staff, undefined, refusedServer)).body.data?.availability).toBe("off");
      expect((await call("GET", `/proposal-share/${f.token}/deposit`, {}, undefined, refusedServer)).status).toBe(404);
      expect((await call("POST", `/proposal-share/${f.token}/deposit/checkout`, {}, { requestId }, refusedServer)).status).toBe(404);
      const body = stripeEvent("checkout.session.completed", {});
      expect((await refusedServer.inject({ method: "POST", url: "/webhooks/stripe", payload: body, headers: { "content-type": "application/json", "stripe-signature": stripeSignature(body) } })).statusCode).toBe(503);
    });
  });
});
