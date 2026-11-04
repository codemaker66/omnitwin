import Fastify, { type FastifyInstance } from "fastify";
import rawBody from "fastify-raw-body";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../db/client.js";
import { stripeWebhookRoutes } from "../routes/stripe-webhook.js";
import {
  TestDepositGateway,
  assertPaymentsTestTarget,
  openPaymentsDatabase,
  paymentsTestUrl,
  stripeEvent,
  stripeSignature,
} from "./helpers/payments-db.js";

// ---------------------------------------------------------------------------
// Migration 0103 and POST /webhooks/stripe on a database migrated with the
// whole set (Plan 19 L5):
//
//   - the tables hold their promises: test mode only, tenancy by composite
//     keys, one request in force, a signature only of its version's own hash,
//     contract records that no statement changes or removes, and a reversal
//     that runs;
//   - the webhook applies each event once, in any order, ignores what is not
//     ours, and tells the venue team when a deposit is paid.
//
// Opt-in, disposable loopback PostgreSQL only (helpers/payments-db.ts).
// ---------------------------------------------------------------------------

process.env["NODE_ENV"] = "test";

describe("payments PostgreSQL target guard", () => {
  it.each([
    "postgresql://user@production.example/venviewer_payments_test",
    "postgresql://postgres@127.0.0.1/production",
    "postgresql://postgres@127.0.0.1/venviewer_payments_test?host=production.example",
  ])("rejects an unsafe target: %s", (url) => {
    expect(() => { assertPaymentsTestTarget(url); }).toThrow();
  });
});

const HASH = "a".repeat(64);
// Each run its own Stripe ids: the disposable database keeps earlier runs' rows.
const RUN = randomUUID().replaceAll("-", "").slice(0, 12);
const pi = (name: string): string => `pi_${name}_${RUN}`;

describe.skipIf(paymentsTestUrl === undefined)("deposits on migrated PostgreSQL: migration 0103 and the Stripe webhook", () => {
  let pool: Pool;
  let db: Database;
  let server: FastifyInstance;
  const gateway = new TestDepositGateway();

  beforeAll(async () => {
    ({ pool, db } = await openPaymentsDatabase(`stripe_webhook_${randomUUID()}`));
    server = Fastify();
    await server.register(rawBody, { field: "rawBody", global: false, runFirst: true, encoding: false });
    await server.register(stripeWebhookRoutes, {
      db, payments: { status: "ready", gateway, venueSlug: "unused", frontendUrl: "https://venviewer.test" }, prefix: "/webhooks",
    });
    await server.ready();
  }, 180_000);

  afterAll(async () => {
    await server?.close();
    await pool?.end();
  });

  /** A venue, an accepted proposal and a request with one open checkout. */
  async function fixture(amountMinor = 50_000) {
    const venueId = randomUUID();
    const proposalId = randomUUID();
    const requestId = randomUUID();
    const paymentId = randomUUID();
    const sessionId = `cs_test_${randomUUID().replaceAll("-", "")}`;
    await pool.query("INSERT INTO venues (id, name, slug, address) VALUES ($1, 'TEST ONLY venue', $2, 'Disposable fixture')", [venueId, `v-${venueId}`]);
    await pool.query(
      "INSERT INTO proposals (id, venue_id, title, status, current_version, sent_version, sent_at) VALUES ($1, $2, 'Autumn gala', 'accepted', 1, 1, now())",
      [proposalId, venueId],
    );
    await pool.query(
      `INSERT INTO proposal_deposit_requests (id, venue_id, proposal_id, proposal_version, proposal_version_hash, basis, quote_total_minor, amount_minor, currency)
       VALUES ($1, $2, $3, 1, $4, 'amount', 250000, $5, 'GBP')`,
      [requestId, venueId, proposalId, HASH, amountMinor],
    );
    await pool.query(
      `INSERT INTO deposit_payments (id, venue_id, deposit_request_id, stripe_checkout_session_id, checkout_url, session_expires_at, amount_minor, currency)
       VALUES ($1, $2, $3, $4, $5, now() + interval '1 hour', $6, 'GBP')`,
      [paymentId, venueId, requestId, sessionId, `https://checkout.stripe.com/c/pay/${sessionId}`, amountMinor],
    );
    return { venueId, proposalId, requestId, paymentId, sessionId, metadata: { deposit_payment_id: paymentId, venue_id: venueId } };
  }

  async function deliver(body: string): Promise<{ readonly status: number; readonly outcome: string | undefined }> {
    const res = await server.inject({ method: "POST", url: "/webhooks/stripe", payload: body, headers: { "content-type": "application/json", "stripe-signature": stripeSignature(body) } });
    const json = res.json<{ outcome?: string }>();
    return { status: res.statusCode, outcome: json.outcome };
  }

  async function payment(id: string): Promise<Record<string, unknown>> {
    const { rows } = await pool.query("SELECT * FROM deposit_payments WHERE id = $1", [id]);
    const [row] = rows as Record<string, unknown>[];
    if (row === undefined) throw new Error("payment missing");
    return row;
  }

  const completed = (f: Awaited<ReturnType<typeof fixture>>, paymentIntent: string, extra: Record<string, unknown> = {}) => ({
    id: f.sessionId, object: "checkout.session", payment_status: "paid", amount_total: 50_000, currency: "gbp", payment_intent: paymentIntent, metadata: f.metadata, ...extra,
  });

  describe("the tables", () => {
    it("refuse a live-mode payment: this lane takes no real money", async () => {
      const f = await fixture();
      await expect(pool.query("UPDATE deposit_payments SET livemode = true WHERE id = $1", [f.paymentId])).rejects.toMatchObject({ code: "23514" });
    });

    it("refuse a request against another venue's proposal", async () => {
      const f = await fixture();
      const other = await fixture();
      // Withdrawn first, so only the venue key can refuse the second request.
      await pool.query("UPDATE proposal_deposit_requests SET cancelled_at = now() WHERE id = $1", [f.requestId]);
      await expect(pool.query(
        `INSERT INTO proposal_deposit_requests (venue_id, proposal_id, proposal_version, proposal_version_hash, basis, quote_total_minor, amount_minor, currency)
         VALUES ($1, $2, 1, $3, 'amount', 1000, 100, 'GBP')`,
        [other.venueId, f.proposalId, HASH],
      )).rejects.toMatchObject({ code: "23503" });
    });

    it("refuse a second request in force, and a deposit above the quote", async () => {
      const f = await fixture();
      await expect(pool.query(
        `INSERT INTO proposal_deposit_requests (venue_id, proposal_id, proposal_version, proposal_version_hash, basis, quote_total_minor, amount_minor, currency)
         VALUES ($1, $2, 1, $3, 'amount', 1000, 100, 'GBP')`,
        [f.venueId, f.proposalId, HASH],
      )).rejects.toMatchObject({ code: "23505" });
      await pool.query("UPDATE proposal_deposit_requests SET cancelled_at = now() WHERE id = $1", [f.requestId]);
      await expect(pool.query(
        `INSERT INTO proposal_deposit_requests (venue_id, proposal_id, proposal_version, proposal_version_hash, basis, quote_total_minor, amount_minor, currency)
         VALUES ($1, $2, 1, $3, 'amount', 1000, 1001, 'GBP')`,
        [f.venueId, f.proposalId, HASH],
      )).rejects.toMatchObject({ code: "23514" });
    });

    it("keep contract versions and signatures exactly as written, and a signature only of its version's hash", async () => {
      const f = await fixture();
      const versionId = randomUUID();
      await pool.query(
        `INSERT INTO proposal_contract_versions (id, venue_id, proposal_id, version, proposal_version, proposal_version_hash, document, document_hash)
         VALUES ($1, $2, $3, 1, 1, $4, '{"terms":"x"}', $5)`,
        [versionId, f.venueId, f.proposalId, HASH, "b".repeat(64)],
      );
      await expect(pool.query(
        `INSERT INTO proposal_contract_signatures (venue_id, contract_version_id, document_hash, signer_name, signer_email, consent_statement)
         VALUES ($1, $2, $3, 'Ada Client', 'ada@example.test', 'I agree')`,
        [f.venueId, versionId, "c".repeat(64)],
      )).rejects.toMatchObject({ code: "23503" });
      await pool.query(
        `INSERT INTO proposal_contract_signatures (venue_id, contract_version_id, document_hash, signer_name, signer_email, consent_statement)
         VALUES ($1, $2, $3, 'Ada Client', 'ada@example.test', 'I agree')`,
        [f.venueId, versionId, "b".repeat(64)],
      );
      await expect(pool.query("UPDATE proposal_contract_signatures SET signer_name = 'Someone else' WHERE contract_version_id = $1", [versionId])).rejects.toThrow(/cannot be changed or removed/u);
      await expect(pool.query("DELETE FROM proposal_contract_signatures WHERE contract_version_id = $1", [versionId])).rejects.toThrow(/cannot be changed or removed/u);
      await expect(pool.query("UPDATE proposal_contract_versions SET document = '{}' WHERE id = $1", [versionId])).rejects.toThrow(/cannot be changed or removed/u);
      await expect(pool.query("DELETE FROM proposal_contract_versions WHERE id = $1", [versionId])).rejects.toThrow(/cannot be changed or removed/u);
      await expect(pool.query("TRUNCATE proposal_contract_signatures")).rejects.toThrow(/cannot be changed or removed/u);
      await expect(pool.query(
        `INSERT INTO proposal_contract_signatures (venue_id, contract_version_id, document_hash, signer_name, signer_email, consent_statement)
         VALUES ($1, $2, $3, 'Ada Client', 'ada@example.test', 'I agree')`,
        [f.venueId, versionId, "b".repeat(64)],
      )).rejects.toMatchObject({ code: "23505" });
    });

    it("can be reversed by the statements the migration names", async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`DROP TABLE IF EXISTS "proposal_contract_signatures";
          DROP TABLE IF EXISTS "proposal_contract_versions";
          DROP TABLE IF EXISTS "deposit_payments";
          DROP TABLE IF EXISTS "proposal_deposit_requests";
          DROP FUNCTION IF EXISTS "proposal_contract_record_is_immutable"();`);
        const { rows } = await client.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM pg_tables WHERE tablename IN ('proposal_contract_signatures','proposal_contract_versions','deposit_payments','proposal_deposit_requests')",
        );
        expect(rows[0]?.n).toBe(0);
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    });
  });

  describe("the webhook", () => {
    it("records a paid deposit once, however often Stripe delivers it, and tells the venue team", async () => {
      const f = await fixture();
      const body = stripeEvent("checkout.session.completed", completed(f, pi("paid_once")));
      expect(await deliver(body)).toEqual({ status: 200, outcome: "applied" });
      expect(await deliver(body)).toEqual({ status: 200, outcome: "duplicate" });
      const row = await payment(f.paymentId);
      expect(row["paid_at"]).not.toBeNull();
      expect(row["stripe_payment_intent_id"]).toBe(pi("paid_once"));
      expect(row["amount_received_minor"]).toBe(50_000);
      const { rows } = await pool.query("SELECT title, body FROM event_plan_notifications WHERE venue_id = $1", [f.venueId]);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((notice: { title: string }) => notice.title === "Deposit paid")).toBe(true);
      expect((rows[0] as { body: string }).body).toContain("£500.00");
    });

    it("applies the same event delivered twice at once exactly once", async () => {
      const f = await fixture();
      const body = stripeEvent("payment_intent.payment_failed", {
        id: pi("twice"), amount_received: 0, currency: "gbp", metadata: f.metadata, last_payment_error: { message: "Your card was declined." },
      });
      const outcomes = (await Promise.all([deliver(body), deliver(body), deliver(body)])).map((r) => r.outcome).sort();
      expect(outcomes).toEqual(["applied", "duplicate", "duplicate"]);
      expect((await payment(f.paymentId))["failure_message"]).toBe("Your card was declined.");
    });

    it("keeps a payment paid when a decline from before it arrives after it", async () => {
      const f = await fixture();
      const now = Math.floor(Date.now() / 1000);
      await deliver(stripeEvent("checkout.session.completed", completed(f, pi("late_decline")), { created: now }));
      await deliver(stripeEvent("payment_intent.payment_failed", {
        id: pi("late_decline"), amount_received: 0, currency: "gbp", metadata: f.metadata, last_payment_error: { message: "Your card was declined." },
      }, { created: now - 60 }));
      const row = await payment(f.paymentId);
      expect(row["paid_at"]).not.toBeNull();
      expect(row["declined_at"]).not.toBeNull();
    });

    it("records a refund that arrives before the payment's own report, finding the payment through its PaymentIntent", async () => {
      const f = await fixture();
      gateway.intents.set(pi("refund_first"), f.metadata);
      const charged = Math.floor(Date.now() / 1000) - 120;
      expect((await deliver(stripeEvent("charge.refunded", {
        id: `ch_refund_first_${RUN}`, payment_intent: pi("refund_first"), amount_captured: 50_000, amount_refunded: 50_000, currency: "gbp", created: charged, paid: true,
      }))).outcome).toBe("applied");
      expect((await deliver(stripeEvent("checkout.session.completed", completed(f, pi("refund_first"))))).outcome).toBe("applied");
      const row = await payment(f.paymentId);
      expect(row["amount_refunded_minor"]).toBe(50_000);
      expect(row["stripe_payment_intent_id"]).toBe(pi("refund_first"));
      expect((row["paid_at"] as Date).getTime()).toBe(charged * 1000);
    });

    it("never takes a smaller refund report over a larger one", async () => {
      const f = await fixture();
      await deliver(stripeEvent("checkout.session.completed", completed(f, pi("refunds"))));
      const refund = (amount: number) => stripeEvent("charge.refunded", {
        id: `ch_refunds_${RUN}`, payment_intent: pi("refunds"), amount_captured: 50_000, amount_refunded: amount, currency: "gbp", created: Math.floor(Date.now() / 1000), paid: true,
      });
      await deliver(refund(30_000));
      await deliver(refund(10_000));
      expect((await payment(f.paymentId))["amount_refunded_minor"]).toBe(30_000);
    });

    it("marks a payment Stripe reports at another amount as a mismatch for the team, never paid", async () => {
      const f = await fixture();
      await deliver(stripeEvent("checkout.session.completed", completed(f, pi("short"), { amount_total: 100 })));
      const row = await payment(f.paymentId);
      expect(row["amount_received_minor"]).toBe(100);
      const { rows } = await pool.query("SELECT title FROM event_plan_notifications WHERE venue_id = $1", [f.venueId]);
      expect(rows.map((r: { title: string }) => r.title)).toContain("Deposit payment does not match the request");
    });

    it("records and ignores an event about nothing of ours", async () => {
      const unknown = stripeEvent("checkout.session.completed", {
        id: `cs_test_someone_elses_${RUN}`, payment_status: "paid", amount_total: 999, currency: "gbp", payment_intent: pi("other"), metadata: {},
      });
      expect(await deliver(unknown)).toEqual({ status: 200, outcome: "ignored" });
      expect(await deliver(unknown)).toEqual({ status: 200, outcome: "duplicate" });
      expect(await deliver(stripeEvent("customer.created", { id: `cus_${RUN}` }))).toEqual({ status: 200, outcome: "ignored" });
    });

    it("does not let an intent event carrying our payment id take a payment that has another PaymentIntent", async () => {
      const f = await fixture();
      await deliver(stripeEvent("checkout.session.completed", completed(f, pi("first"))));
      expect((await deliver(stripeEvent("payment_intent.payment_failed", {
        id: pi("impostor"), amount_received: 0, currency: "gbp", metadata: f.metadata, last_payment_error: { message: "Declined" },
      }))).outcome).toBe("ignored");
      expect((await payment(f.paymentId))["declined_at"]).toBeNull();
    });
  });
});
