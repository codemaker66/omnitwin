import { resolve } from "node:path";
import Stripe from "stripe";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import * as schema from "../../db/schema.js";
import type { Database } from "../../db/client.js";
import {
  StripeDepositGateway,
  type CheckoutSessionCreated,
  type CheckoutSessionRequest,
} from "../../services/payments/deposit-gateway.js";

// ---------------------------------------------------------------------------
// The deposit and signature suites' disposable PostgreSQL (Plan 19 L5), and a
// Stripe gateway for tests: Stripe's own signature verification over the raw
// body, with the three calls that would reach Stripe answered here.
//
// Opt-in only, never DATABASE_URL or .env:
//   VENVIEWER_PAYMENTS_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55476/venviewer_payments_test
// ---------------------------------------------------------------------------

export const paymentsTestUrl = process.env["VENVIEWER_PAYMENTS_TEST_DATABASE_URL"];

export function assertPaymentsTestTarget(raw: string): void {
  const url = new URL(raw);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname !== "127.0.0.1"
    || url.pathname !== "/venviewer_payments_test" || url.search !== "" || url.hash !== "") {
    throw new Error("Deposit and signature tests require the explicit loopback venviewer_payments_test database");
  }
}

/** A pool on the disposable database, migrated with the whole set as production holds it. */
export async function openPaymentsDatabase(name: string): Promise<{ readonly pool: Pool; readonly db: Database }> {
  if (paymentsTestUrl === undefined) throw new Error("VENVIEWER_PAYMENTS_TEST_DATABASE_URL is required");
  assertPaymentsTestTarget(paymentsTestUrl);
  const pool = new Pool({ connectionString: paymentsTestUrl, application_name: name, max: 6 });
  const [row] = (await pool.query<{ name: string }>("SELECT current_database() AS name")).rows;
  if (row?.name !== "venviewer_payments_test") throw new Error("Connected to the wrong database");
  await migrate(drizzle(pool), { migrationsFolder: resolve(import.meta.dirname, "../../../drizzle") });
  const db: Database = drizzle(pool, { schema });
  return { pool, db };
}

export const TEST_WEBHOOK_SECRET = "whsec_test_venviewer_deposits_fixture";
const SIGNER = new Stripe("sk_test_signer_only_never_used_for_calls");

/** The Stripe-Signature header Stripe would send for this body. */
export function stripeSignature(payload: string, secret = TEST_WEBHOOK_SECRET, timestamp?: number): string {
  return SIGNER.webhooks.generateTestHeaderString({ payload, secret, ...(timestamp === undefined ? {} : { timestamp }) });
}

/** The real gateway's webhook verification; its calls to Stripe are answered here. */
export class TestDepositGateway extends StripeDepositGateway {
  readonly created: CheckoutSessionRequest[] = [];
  readonly expired: string[] = [];
  readonly intents = new Map<string, Readonly<Record<string, string>>>();
  failNextCreate = false;
  private sessions = 0;

  constructor(secretKey = "sk_test_fixture_key_never_sent", webhookSecret = TEST_WEBHOOK_SECRET) {
    super(secretKey, webhookSecret);
  }

  override createCheckoutSession(request: CheckoutSessionRequest): Promise<CheckoutSessionCreated> {
    if (this.failNextCreate) {
      this.failNextCreate = false;
      return Promise.reject(new Error("Stripe could not be reached"));
    }
    this.created.push(request);
    this.sessions += 1;
    const id = `cs_test_${request.metadata.deposit_payment_id.replaceAll("-", "")}${String(this.sessions)}`;
    return Promise.resolve({ id, url: `https://checkout.stripe.com/c/pay/${id}`, expiresAt: request.expiresAt, livemode: this.mode === "live" });
  }

  override expireCheckoutSession(sessionId: string): Promise<void> {
    this.expired.push(sessionId);
    return Promise.resolve();
  }

  override paymentIntentMetadata(paymentIntentId: string): Promise<Readonly<Record<string, string>> | null> {
    return Promise.resolve(this.intents.get(paymentIntentId) ?? null);
  }
}

let eventSequence = 0;

/** A Stripe event envelope as the webhook receives it. */
export function stripeEvent(type: string, object: Record<string, unknown>, options: { readonly id?: string; readonly created?: number; readonly livemode?: boolean } = {}): string {
  eventSequence += 1;
  return JSON.stringify({
    id: options.id ?? `evt_test_${String(Date.now())}_${String(eventSequence)}`,
    object: "event",
    type,
    created: options.created ?? Math.floor(Date.now() / 1000),
    livemode: options.livemode ?? false,
    api_version: "2026-08-26.dahlia",
    data: { object },
  });
}
