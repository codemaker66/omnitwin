import { createHash, randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import Stripe from "stripe";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { PROPOSAL_VERSION_PAYLOAD_SCHEMA_VERSION, proposalVersionPayloadDigest, type ProposalVersionPayload } from "@omnitwin/types";
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

export interface AcceptedProposalFixture {
  readonly venueId: string;
  readonly otherVenueId: string;
  readonly proposalId: string;
  readonly eventId: string;
  readonly token: string;
  readonly shareTokenId: string;
  readonly clientEmail: string;
  readonly payload: ProposalVersionPayload;
  readonly staff: Record<string, string>;
  readonly otherStaff: Record<string, string>;
  readonly hallkeeper: Record<string, string>;
  readonly platformAdmin: Record<string, string>;
}

function bearer(user: { readonly id: string; readonly role: string; readonly venueId: string | null; readonly platformRole?: string }): Record<string, string> {
  return { authorization: `Bearer ${JSON.stringify({ id: user.id, email: `${user.role}-${user.id}@example.test`, role: user.role, venueId: user.venueId, platformRole: user.platformRole ?? "none" })}` };
}

/**
 * A venue (with the slug deposits are configured for, unless told otherwise),
 * a room, a layout that belongs to an event, an enquiry with the client's
 * email, and a proposal accepted on version 1 through a share link.
 */
export async function seedAcceptedProposal(pool: Pool, options: {
  readonly venueSlug?: string;
  readonly totalMinor?: number;
  readonly status?: "accepted" | "sent";
} = {}): Promise<AcceptedProposalFixture> {
  const venueId = randomUUID();
  const otherVenueId = randomUUID();
  const spaceId = randomUUID();
  const configurationId = randomUUID();
  const eventId = randomUUID();
  const enquiryId = randomUUID();
  const proposalId = randomUUID();
  const users = { staff: randomUUID(), otherStaff: randomUUID(), hallkeeper: randomUUID(), platformAdmin: randomUUID() };
  const clientEmail = `ada-${proposalId.slice(0, 8)}@example.test`;
  const totalMinor = options.totalMinor ?? 250_000;
  await pool.query("INSERT INTO venues (id, name, slug, address) VALUES ($1, 'TEST ONLY Trades Hall', $2, '85 Glassford Street'), ($3, 'TEST ONLY other venue', $4, 'Elsewhere')",
    [venueId, options.venueSlug ?? `deposits-${venueId.slice(0, 8)}`, otherVenueId, `other-${otherVenueId.slice(0, 8)}`]);
  await pool.query(
    `INSERT INTO users (id, email, name, role, venue_id, platform_role) VALUES
      ($1, $2, 'Fixture staff', 'staff', $3, 'none'), ($4, $5, 'Other venue staff', 'staff', $6, 'none'),
      ($7, $8, 'Fixture hallkeeper', 'hallkeeper', $3, 'none'), ($9, $10, 'Platform admin', 'admin', NULL, 'admin')`,
    [users.staff, `staff-${users.staff}@example.test`, venueId, users.otherStaff, `staff-${users.otherStaff}@example.test`, otherVenueId,
      users.hallkeeper, `hallkeeper-${users.hallkeeper}@example.test`, users.platformAdmin, `admin-${users.platformAdmin}@example.test`],
  );
  await pool.query(
    `INSERT INTO spaces (id, venue_id, name, slug, width_m, length_m, height_m, floor_plan_outline)
     VALUES ($1, $2, 'Grand Hall', 'grand-hall', 10, 20, 8, '[{"x":0,"y":0},{"x":10,"y":0},{"x":10,"y":20},{"x":0,"y":20}]')`,
    [spaceId, venueId],
  );
  await pool.query("INSERT INTO configurations (id, space_id, venue_id, name, layout_style) VALUES ($1, $2, $3, 'Autumn gala', 'dinner-rounds')", [configurationId, spaceId, venueId]);
  await pool.query("INSERT INTO events (id, venue_id, name) VALUES ($1, $2, 'Autumn gala')", [eventId, venueId]);
  await pool.query("INSERT INTO event_configuration_links (event_id, configuration_id, link_type) VALUES ($1, $2, 'source_configuration')", [eventId, configurationId]);
  await pool.query("INSERT INTO enquiries (id, venue_id, space_id, name, email) VALUES ($1, $2, $3, 'Ada Client', $4)", [enquiryId, venueId, spaceId, clientEmail]);
  const payload: ProposalVersionPayload = {
    schemaVersion: PROPOSAL_VERSION_PAYLOAD_SCHEMA_VERSION,
    title: "Autumn gala, Grand Hall",
    clientMessage: null,
    configurationId,
    layoutRevision: null,
    capacityNote: null,
    quote: {
      quoteId: null, currency: "GBP",
      lineItems: [{ description: "Grand Hall hire", quantity: 1, unitAmountMinor: totalMinor, lineTotalMinor: totalMinor }],
      subtotalMinor: totalMinor, totalMinor,
    },
    facts: { eventDate: "2026-12-05", guestCount: 180, occasion: "gala", roomName: "Grand Hall", roomSlug: "grand-hall" },
  };
  const status = options.status ?? "accepted";
  await pool.query(
    `INSERT INTO proposals (id, venue_id, enquiry_id, configuration_id, title, status, current_version, sent_version, sent_at, accepted_name)
     VALUES ($1, $2, $3, $4, 'Autumn gala', $5, 1, 1, now(), $6)`,
    [proposalId, venueId, enquiryId, configurationId, status, status === "accepted" ? "Ada Client" : null],
  );
  await pool.query("INSERT INTO proposal_versions (proposal_id, version, payload, source_hash) VALUES ($1, 1, $2, $3)",
    [proposalId, JSON.stringify(payload), proposalVersionPayloadDigest(payload)]);
  const token = randomBytes(32).toString("base64url");
  const shareTokenId = randomUUID();
  await pool.query("INSERT INTO proposal_share_tokens (id, proposal_id, token_hash, token_prefix) VALUES ($1, $2, $3, $4)",
    [shareTokenId, proposalId, createHash("sha256").update(token, "utf8").digest("hex"), token.slice(0, 8)]);
  return {
    venueId, otherVenueId, proposalId, eventId, token, shareTokenId, clientEmail, payload,
    staff: bearer({ id: users.staff, role: "staff", venueId }),
    otherStaff: bearer({ id: users.otherStaff, role: "staff", venueId: otherVenueId }),
    hallkeeper: bearer({ id: users.hallkeeper, role: "hallkeeper", venueId }),
    platformAdmin: bearer({ id: users.platformAdmin, role: "admin", venueId: null, platformRole: "admin" }),
  };
}
