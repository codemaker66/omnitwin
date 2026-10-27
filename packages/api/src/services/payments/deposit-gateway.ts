import Stripe from "stripe";
import type { Currency } from "@omnitwin/types";
import { isStripeTestSecretKey } from "./stripe-mode.js";

// ---------------------------------------------------------------------------
// The deposit gateway (Plan 19 L5) — the one boundary between Venviewer and
// Stripe. Routes and the webhook speak to this interface only; tests replace
// it with a fake, and the Stripe implementation below is the only code that
// holds the secret key.
//
// TEST MODE ONLY. A secret key that is not a test key (sk_test_…) is refused
// here as well as at startup (env.ts), so a configuration that slipped past
// startup still opens no payment route: depositPaymentsFrom answers
// "refused" and every payment route says so. STRIPE_LIVE_PAYMENTS_ALLOWED is
// the only way past it, and nothing in this lane sets it.
//
// Checkout (Stripe's hosted page), not the Payment Element: the card number
// never reaches a Venviewer page, so the web app loads no Stripe script and
// needs no key; Stripe handles 3-D Secure, wallets and receipts; and the
// API's one call opens a page Stripe keeps for an hour.
// ---------------------------------------------------------------------------

/** Stripe API version this code is written against (stripe-node 22.6.2). */
export const STRIPE_API_VERSION = "2026-08-26.dahlia";

/** How long a client's checkout page stays open (Stripe allows 30 min to 24 h). */
export const CHECKOUT_SESSION_LIFETIME_MS = 60 * 60 * 1000;

export interface CheckoutSessionRequest {
  readonly amountMinor: number;
  readonly currency: Currency;
  /** The line the client reads on Stripe's page. */
  readonly description: string;
  readonly customerEmail: string | null;
  readonly successUrl: string;
  readonly cancelUrl: string;
  readonly expiresAt: Date;
  /** Ours, copied onto the session and its PaymentIntent. */
  readonly metadata: {
    readonly venue_id: string;
    readonly proposal_id: string;
    readonly deposit_request_id: string;
    readonly deposit_payment_id: string;
  };
  /** One payment row, one session, whatever the retries. */
  readonly idempotencyKey: string;
}

export interface CheckoutSessionCreated {
  readonly id: string;
  readonly url: string;
  readonly expiresAt: Date;
  readonly livemode: boolean;
}

export class WebhookSignatureError extends Error {
  constructor() {
    super("The Stripe-Signature header does not verify against this body");
    this.name = "WebhookSignatureError";
  }
}

export interface DepositGateway {
  readonly mode: "test" | "live";
  createCheckoutSession(request: CheckoutSessionRequest): Promise<CheckoutSessionCreated>;
  /** Closes a checkout page so it can no longer be paid. */
  expireCheckoutSession(sessionId: string): Promise<void>;
  /** A PaymentIntent's metadata, to tell whether an event is about one of ours. */
  paymentIntentMetadata(paymentIntentId: string): Promise<Readonly<Record<string, string>> | null>;
  /**
   * The event the raw body carries, once its signature verifies against the
   * endpoint's secret within Stripe's tolerance; WebhookSignatureError if not.
   */
  verifyWebhook(rawBody: Buffer, signatureHeader: string | undefined): unknown;
}

export type DepositPayments =
  | { readonly status: "off" }
  | { readonly status: "refused"; readonly reason: string }
  | { readonly status: "ready"; readonly gateway: DepositGateway; readonly venueSlug: string; readonly frontendUrl: string };

export interface DepositPaymentsConfig {
  readonly STRIPE_SECRET_KEY?: string | undefined;
  readonly STRIPE_WEBHOOK_SECRET?: string | undefined;
  readonly STRIPE_DEPOSIT_VENUE_SLUG?: string | undefined;
  readonly STRIPE_LIVE_PAYMENTS_ALLOWED?: "true" | "false" | undefined;
  readonly FRONTEND_URL?: string | undefined;
}

/**
 * Deposits as the environment allows them: off without all three Stripe
 * variables, refused with a key that is not a test key (unless the live flag
 * is set), else ready. The gateway is built only when ready.
 */
export function depositPaymentsFrom(
  config: DepositPaymentsConfig,
  build: (secretKey: string, webhookSecret: string) => DepositGateway = (secretKey, webhookSecret) => new StripeDepositGateway(secretKey, webhookSecret),
): DepositPayments {
  const secretKey = config.STRIPE_SECRET_KEY;
  const webhookSecret = config.STRIPE_WEBHOOK_SECRET;
  const venueSlug = config.STRIPE_DEPOSIT_VENUE_SLUG;
  if (secretKey === undefined || webhookSecret === undefined || venueSlug === undefined) return { status: "off" };
  const liveAllowed = config.STRIPE_LIVE_PAYMENTS_ALLOWED === "true";
  if (!isStripeTestSecretKey(secretKey) && !liveAllowed) {
    return { status: "refused", reason: "The Stripe secret key is not a test-mode key, and live payments are not allowed." };
  }
  const gateway = build(secretKey, webhookSecret);
  if (gateway.mode === "live" && !liveAllowed) {
    return { status: "refused", reason: "The Stripe gateway is in live mode, and live payments are not allowed." };
  }
  return { status: "ready", gateway, venueSlug, frontendUrl: (config.FRONTEND_URL ?? "http://localhost:5173").replace(/\/+$/u, "") };
}

/** The Stripe SDK behind the gateway. */
export class StripeDepositGateway implements DepositGateway {
  readonly mode: "test" | "live";
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;

  constructor(secretKey: string, webhookSecret: string) {
    this.mode = isStripeTestSecretKey(secretKey) ? "test" : "live";
    // Bounded: a client waiting on Pay never waits Stripe's default 80 s.
    this.stripe = new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION, maxNetworkRetries: 1, timeout: 15_000 });
    this.webhookSecret = webhookSecret;
  }

  async createCheckoutSession(request: CheckoutSessionRequest): Promise<CheckoutSessionCreated> {
    const session = await this.stripe.checkout.sessions.create({
      mode: "payment",
      submit_type: "pay",
      line_items: [{
        quantity: 1,
        price_data: {
          currency: request.currency.toLowerCase(),
          unit_amount: request.amountMinor,
          product_data: { name: request.description },
        },
      }],
      client_reference_id: request.metadata.deposit_payment_id,
      ...(request.customerEmail === null ? {} : { customer_email: request.customerEmail }),
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
      expires_at: Math.floor(request.expiresAt.getTime() / 1000),
      metadata: { ...request.metadata },
      payment_intent_data: { metadata: { ...request.metadata }, description: request.description },
    }, { idempotencyKey: request.idempotencyKey });
    if (session.url === null) throw new Error("Stripe returned a checkout session without a page");
    return {
      id: session.id,
      url: session.url,
      expiresAt: new Date(session.expires_at * 1000),
      livemode: session.livemode,
    };
  }

  async expireCheckoutSession(sessionId: string): Promise<void> {
    await this.stripe.checkout.sessions.expire(sessionId);
  }

  async paymentIntentMetadata(paymentIntentId: string): Promise<Readonly<Record<string, string>> | null> {
    try {
      const intent = await this.stripe.paymentIntents.retrieve(paymentIntentId);
      return intent.metadata;
    } catch (error) {
      if (error instanceof Stripe.errors.StripeInvalidRequestError && error.statusCode === 404) return null;
      throw error;
    }
  }

  verifyWebhook(rawBody: Buffer, signatureHeader: string | undefined): unknown {
    if (signatureHeader === undefined || signatureHeader === "") throw new WebhookSignatureError();
    try {
      return this.stripe.webhooks.constructEvent(rawBody, signatureHeader, this.webhookSecret);
    } catch (error) {
      if (error instanceof Stripe.errors.StripeSignatureVerificationError) throw new WebhookSignatureError();
      throw error;
    }
  }
}
