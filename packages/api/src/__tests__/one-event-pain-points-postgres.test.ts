import Fastify, { type FastifyInstance } from "fastify";
import rawBody from "fastify-raw-body";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CONTRACT_CONSENT_STATEMENT,
  PROPOSAL_VERSION_PAYLOAD_SCHEMA_VERSION,
  contractDocumentDigest,
  proposalVersionPayloadDigest,
  type ClientContractView,
  type ClientDepositView,
  type DepositRequestView,
  type StaffContractVersion,
  type StaffContractView,
} from "@omnitwin/types";
import { proposalRoutes } from "../routes/proposals.js";
import { proposalDepositRoutes, proposalShareDepositRoutes } from "../routes/deposits.js";
import { proposalContractRoutes, proposalShareContractRoutes } from "../routes/contracts.js";
import { stripeWebhookRoutes } from "../routes/stripe-webhook.js";
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
// Goal 06's twelve pain points as acceptance lines (Plan 19 L5).
//
// "Each of the twelve pain points has a passing acceptance test or a recorded
// reason it waits." The lines L5 touches — the contract and the deposit that
// follow an accepted proposal — run here end to end through the real routes
// on migrated PostgreSQL, with Stripe answered at the gateway (test mode).
// The others wait, each with the reason and the slice that owns it.
// ---------------------------------------------------------------------------

process.env["NODE_ENV"] = "test";

interface Reply<T> { readonly status: number; readonly body: { readonly data?: T; readonly code?: string } }

const TERMS = "1. A deposit of 20% of the hire fee secures the date.\n2. Cancellation within 90 days forfeits the deposit.";

describe.skipIf(paymentsTestUrl === undefined)("goal 06's twelve pain points (the lines Plan 19 L5 touches)", () => {
  let pool: Pool;
  let server: FastifyInstance;
  const gateway = new TestDepositGateway();
  const payments = { status: "ready" as const, gateway, venueSlug: "unset", frontendUrl: "https://venviewer.test" };

  beforeAll(async () => {
    const opened = await openPaymentsDatabase(`pain_points_${randomUUID()}`);
    pool = opened.pool;
    server = Fastify();
    await server.register(rawBody, { field: "rawBody", global: false, runFirst: true, encoding: false });
    await server.register(proposalRoutes, { db: opened.db, prefix: "/proposals" });
    await server.register(proposalDepositRoutes, { db: opened.db, payments, prefix: "/proposals" });
    await server.register(proposalContractRoutes, { db: opened.db, prefix: "/proposals" });
    await server.register(proposalShareDepositRoutes, { db: opened.db, payments, prefix: "/proposal-share" });
    await server.register(proposalShareContractRoutes, { db: opened.db, prefix: "/proposal-share" });
    await server.register(stripeWebhookRoutes, { db: opened.db, payments, prefix: "/webhooks" });
    await server.ready();
  }, 180_000);

  afterAll(async () => {
    await server?.close();
    await pool?.end();
  });

  async function call<T>(method: "GET" | "POST", url: string, headers: Record<string, string> = {}, payload?: unknown): Promise<Reply<T>> {
    const res = await server.inject({ method, url, headers, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });
    return { status: res.statusCode, body: res.body === "" ? {} : res.json() };
  }

  async function accepted(): Promise<AcceptedProposalFixture> {
    const slug = `th-${randomUUID().slice(0, 12)}`;
    payments.venueSlug = slug;
    return seedAcceptedProposal(pool, { venueSlug: slug });
  }

  async function stripeReports(type: string, object: Record<string, unknown>): Promise<string | undefined> {
    const body = stripeEvent(type, object);
    const res = await server.inject({ method: "POST", url: "/webhooks/stripe", payload: body, headers: { "content-type": "application/json", "stripe-signature": stripeSignature(body) } });
    return res.json<{ outcome?: string }>().outcome;
  }

  it("1. The brief retyped across enquiry, CRM, proposal and BEO — the contract takes the client, the event and the price from what was accepted; the venue writes only its terms", async () => {
    const f = await accepted();
    const made = await call<StaffContractVersion>("POST", `/proposals/${f.proposalId}/contract`, f.staff, { terms: TERMS, version: 1 });
    expect(made.status).toBe(201);
    const document = made.body.data?.document;
    // From the enquiry: who it is with. From the accepted version: the event and the price.
    expect(document?.client).toEqual({ name: "Ada Client", email: f.clientEmail });
    expect(document?.event).toEqual(f.payload.facts);
    expect(document?.quote).toEqual(f.payload.quote);
    expect(document?.terms).toBe(TERMS);
    // And the client reads exactly that, fingerprinted.
    const shown = (await call<ClientContractView>("GET", `/proposal-share/${f.token}/contract`)).body.data?.contract;
    expect(shown?.document).toEqual(document);
    expect(shown?.documentHash).toBe(contractDocumentDigest(shown?.document as StaffContractVersion["document"]));
  });

  it.todo("2. Capacity as one misleading number — waits for S2, the visual enquiry; L5 adds no capacity figure");
  it.todo("3. The proposal as a PDF of a screenshot — waits for S4, the living proposal; the client page already renders the proposal from data, and L5's contract is generated from it rather than attached as a file");

  it("4. A quote that drifts silently from the version the client accepted — the deposit and the contract hold to the accepted version, through the platform admin's bypass, to the penny Stripe is asked for", async () => {
    const f = await accepted();
    // The venue asks for 20% of the accepted £2,500.
    const asked = await call<DepositRequestView>("POST", `/proposals/${f.proposalId}/deposit`, f.staff, { basis: "percent", percentBasisPoints: 2_000, version: 1 });
    expect(asked.body.data).toMatchObject({ amountMinor: 50_000, quoteTotalMinor: 250_000, proposalVersion: 1 });
    // A platform admin saves a new version, at £9,000, on the accepted proposal (the bypass, proposals.ts).
    const later = {
      schemaVersion: PROPOSAL_VERSION_PAYLOAD_SCHEMA_VERSION, title: "A later version nobody accepted", clientMessage: null,
      configurationId: null, layoutRevision: null, capacityNote: null,
      quote: { quoteId: null, currency: "GBP", lineItems: [{ description: "Grand Hall hire", quantity: 1, unitAmountMinor: 900_000, lineTotalMinor: 900_000 }], subtotalMinor: 900_000, totalMinor: 900_000 },
    };
    const saved = await call("POST", `/proposals/${f.proposalId}/versions`, f.platformAdmin, later);
    expect(saved.status).toBe(201);
    expect((await pool.query<{ current_version: number; sent_version: number }>("SELECT current_version, sent_version FROM proposals WHERE id = $1", [f.proposalId])).rows[0])
      .toEqual({ current_version: 2, sent_version: 1 });

    // The contract is still made from what was accepted.
    const contract = await call<StaffContractVersion>("POST", `/proposals/${f.proposalId}/contract`, f.staff, { terms: TERMS, version: 1 });
    expect(contract.body.data?.document.proposal).toEqual({ title: "Autumn gala, Grand Hall", version: 1, versionHash: proposalVersionPayloadDigest(f.payload) });
    expect(contract.body.data?.document.quote?.totalMinor).toBe(250_000);

    // The client pays what the accepted version allows, and Stripe is asked for exactly that.
    const requestId = asked.body.data?.id ?? "";
    expect((await call<{ url: string }>("POST", `/proposal-share/${f.token}/deposit/checkout`, {}, { requestId })).status).toBe(200);
    const opened = gateway.created.at(-1);
    expect(opened).toMatchObject({ amountMinor: 50_000, currency: "GBP" });
    const { rows } = await pool.query<{ stripe_checkout_session_id: string }>("SELECT stripe_checkout_session_id FROM deposit_payments WHERE deposit_request_id = $1", [requestId]);
    expect(await stripeReports("checkout.session.completed", {
      id: rows[0]?.stripe_checkout_session_id, payment_status: "paid", amount_total: 50_000, currency: "gbp",
      payment_intent: `pi_${randomUUID().replaceAll("-", "")}`, metadata: opened?.metadata,
    })).toBe("applied");
    // Recorded against the proposal and its event.
    const paid = await pool.query("SELECT r.proposal_id, r.event_id, r.proposal_version, p.amount_received_minor, p.paid_at IS NOT NULL AS paid FROM deposit_payments p JOIN proposal_deposit_requests r ON r.id = p.deposit_request_id WHERE r.id = $1", [requestId]);
    expect(paid.rows[0]).toEqual({ proposal_id: f.proposalId, event_id: f.eventId, proposal_version: 1, amount_received_minor: 50_000, paid: true });
    expect((await call<ClientDepositView>("GET", `/proposal-share/${f.token}/deposit`)).body.data?.request?.state).toBe("paid");

    // A request that no longer matches what was accepted is never charged.
    const g = await accepted();
    const second = await call<DepositRequestView>("POST", `/proposals/${g.proposalId}/deposit`, g.staff, { basis: "percent", percentBasisPoints: 2_000, version: 1 });
    await pool.query("UPDATE proposal_deposit_requests SET amount_minor = 45000 WHERE id = $1", [second.body.data?.id]);
    const before = gateway.created.length;
    expect((await call("POST", `/proposal-share/${g.token}/deposit/checkout`, {}, { requestId: second.body.data?.id })).body.code).toBe("DEPOSIT_AMOUNT_MISMATCH");
    expect(gateway.created.length).toBe(before);
  });

  it.todo("5. A hold that expires unnoticed — waits for S3, the pipeline; holds live in the Diary and L5 does not touch them");
  it.todo("6. Stock promised to two events at once — waits for S8 and goal 05 S7, inventory; L5 does not touch stock");
  it.todo("7. The BEO retyped by every department — waits for S9 and goal 05, the release; L5 ends at the contract and the deposit");
  it.todo("8. The client's change lost in an email thread — waits for S7, the client workspace; a change asked for on the link is kept today (proposals-client-response tests) and L5 does not change it");

  it("9. Staff working from the wrong version — the desk names which version of the contract the client signed, and that a newer one awaits signature; a signature on a superseded version is refused", async () => {
    const f = await accepted();
    const first = (await call<StaffContractVersion>("POST", `/proposals/${f.proposalId}/contract`, f.staff, { terms: TERMS, version: 1 })).body.data as StaffContractVersion;
    expect((await call("POST", `/proposal-share/${f.token}/contract/sign`, {}, { contractVersion: 1, documentHash: first.documentHash, signerName: "Ada Client", consent: true, consentStatement: CONTRACT_CONSENT_STATEMENT })).status).toBe(201);
    await call("POST", `/proposals/${f.proposalId}/contract`, f.staff, { terms: `${TERMS}\n3. Music ends at midnight.`, version: 1 });
    const desk = (await call<StaffContractView>("GET", `/proposals/${f.proposalId}/contract`, f.staff)).body.data;
    expect(desk?.versions.map((version) => ({ version: version.version, signedBy: version.signature?.signerName ?? null }))).toEqual([
      { version: 2, signedBy: null },
      { version: 1, signedBy: "Ada Client" },
    ]);
    // The client's stale page cannot sign version 1 over version 2.
    expect((await call("POST", `/proposal-share/${f.token}/contract/sign`, {}, { contractVersion: 1, documentHash: first.documentHash, signerName: "Ada Client", consent: true, consentStatement: CONTRACT_CONSENT_STATEMENT })).body.code)
      .toBe("CONTRACT_VERSION_CHANGED");
  });

  it.todo("10. No actuals, so nothing learned — waits for S9, close-out and actuals; L5 records the deposit actually paid but not the event's actuals");
  it.todo("11. Slow, clunky, ugly software — judged by goal 01's sublime test on every surface of the journey, by Blake, not by a unit test; L5's surfaces have browser evidence in their PRs");
  it.todo("12. The venue's own data locked in — waits for S11, exports; the deposit and signature records are in the venue's database but not yet in an export");
});
