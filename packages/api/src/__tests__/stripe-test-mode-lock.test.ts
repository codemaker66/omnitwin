import Fastify, { type FastifyInstance } from "fastify";
import rawBody from "fastify-raw-body";
import { afterEach, describe, expect, it } from "vitest";
import { EnvSchema } from "../env.js";
import type { Database } from "../db/client.js";
import { depositPaymentsFrom, WebhookSignatureError, type DepositPayments } from "../services/payments/deposit-gateway.js";
import { stripeWebhookRoutes } from "../routes/stripe-webhook.js";
import { TEST_WEBHOOK_SECRET, TestDepositGateway, stripeEvent, stripeSignature } from "./helpers/payments-db.js";

// ---------------------------------------------------------------------------
// The hard safety rule (Plan 19 L5): deposits take no real money. The API will
// not start with a Stripe secret key that is not a test key unless the live
// flag is set (nothing in this lane sets it), every payment route refuses one
// that slipped past, deposits are off without all three variables, and the
// webhook believes nothing whose signature does not verify against the raw
// body. None of these cases reaches the database.
// ---------------------------------------------------------------------------

const BASE = { NODE_ENV: "test", DATABASE_URL: "postgresql://unused.invalid/none" };
const TEST_KEY = "sk_test_51Fixture";
const LIVE_KEY = "sk_live_51Fixture";

function envIssues(extra: Record<string, string>): string[] {
  const result = EnvSchema.safeParse({ ...BASE, ...extra });
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

describe("startup refuses anything but a test key", () => {
  const stripe = { STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET, STRIPE_DEPOSIT_VENUE_SLUG: "trades-hall-glasgow" };

  it("starts with a test key and the other two variables", () => {
    expect(envIssues({ ...stripe, STRIPE_SECRET_KEY: TEST_KEY })).toEqual([]);
  });

  it.each([LIVE_KEY, "rk_live_51Fixture", "rk_test_51Fixture", "pk_test_51Fixture", "sk_test51Fixture"])("will not start with %s", (key) => {
    const issues = envIssues({ ...stripe, STRIPE_SECRET_KEY: key });
    expect(issues.some((issue) => issue.startsWith("STRIPE_SECRET_KEY: STRIPE_SECRET_KEY is not a Stripe test-mode secret key"))).toBe(true);
    // The key itself is never echoed into a log.
    expect(issues.join("\n")).not.toContain("51Fixture");
  });

  it("starts with a live key only when the live flag is set, which this lane never does", () => {
    expect(envIssues({ ...stripe, STRIPE_SECRET_KEY: LIVE_KEY, STRIPE_LIVE_PAYMENTS_ALLOWED: "true" })).toEqual([]);
    expect(envIssues({ ...stripe, STRIPE_SECRET_KEY: LIVE_KEY, STRIPE_LIVE_PAYMENTS_ALLOWED: "false" })).not.toEqual([]);
  });

  it("refuses half a configuration and a webhook secret that is not one", () => {
    expect(envIssues({ STRIPE_SECRET_KEY: TEST_KEY })[0]).toContain("incomplete");
    expect(envIssues({ STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET })[0]).toContain("incomplete");
    expect(envIssues({ ...stripe, STRIPE_SECRET_KEY: TEST_KEY, STRIPE_WEBHOOK_SECRET: "secret" }).join()).toContain("whsec_");
  });

  it("starts with deposits off when none of the three is set", () => {
    expect(envIssues({})).toEqual([]);
  });
});

describe("the payment routes refuse what startup would", () => {
  const config = { STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET, STRIPE_DEPOSIT_VENUE_SLUG: "trades-hall-glasgow" };

  it("is off without all three variables", () => {
    expect(depositPaymentsFrom({}).status).toBe("off");
    expect(depositPaymentsFrom({ ...config }).status).toBe("off");
    expect(depositPaymentsFrom({ STRIPE_SECRET_KEY: TEST_KEY, STRIPE_DEPOSIT_VENUE_SLUG: "x" }).status).toBe("off");
  });

  it("is refused for a live key without the flag, and never builds a gateway for it", () => {
    let built = false;
    const payments = depositPaymentsFrom({ ...config, STRIPE_SECRET_KEY: LIVE_KEY }, () => { built = true; return new TestDepositGateway(); });
    expect(payments.status).toBe("refused");
    expect(built).toBe(false);
  });

  it("is refused if a gateway reports live mode without the flag, whatever the key looked like", () => {
    const live = new TestDepositGateway(LIVE_KEY);
    expect(live.mode).toBe("live");
    expect(depositPaymentsFrom({ ...config, STRIPE_SECRET_KEY: TEST_KEY }, () => live).status).toBe("refused");
  });

  it("is ready, in test mode, with a test key", () => {
    const payments = depositPaymentsFrom({ ...config, STRIPE_SECRET_KEY: TEST_KEY, FRONTEND_URL: "https://venviewer.com/" }, () => new TestDepositGateway());
    expect(payments.status).toBe("ready");
    if (payments.status === "ready") {
      expect(payments.gateway.mode).toBe("test");
      expect(payments.frontendUrl).toBe("https://venviewer.com");
    }
  });
});

describe("Stripe's signature over the raw body", () => {
  const gateway = new TestDepositGateway();
  const body = stripeEvent("checkout.session.expired", { id: "cs_test_x" });

  it("verifies Stripe's own header for this body", () => {
    expect(gateway.verifyWebhook(Buffer.from(body), stripeSignature(body))).toMatchObject({ type: "checkout.session.expired" });
  });

  it.each([
    ["another endpoint's secret", (): [string, string] => [body, stripeSignature(body, "whsec_someone_else")]],
    ["a body changed after signing", (): [string, string] => [body.replace("expired", "completed"), stripeSignature(body)]],
    ["a body re-serialised after signing", (): [string, string] => [JSON.stringify(JSON.parse(body), null, 1), stripeSignature(body)]],
    ["a signature older than five minutes", (): [string, string] => [body, stripeSignature(body, TEST_WEBHOOK_SECRET, Math.floor(Date.now() / 1000) - 600)]],
    ["no signature", (): [string, string] => [body, ""]],
  ])("refuses %s", (_name, make) => {
    const [payload, header] = make();
    expect(() => gateway.verifyWebhook(Buffer.from(payload), header)).toThrow(WebhookSignatureError);
  });
});

describe("POST /webhooks/stripe before the database", () => {
  let server: FastifyInstance | undefined;
  // Any use of the database fails the test: none of these cases may reach it.
  const untouchable = new Proxy({}, { get: () => { throw new Error("the database was reached"); } }) as Database;

  async function serve(payments: DepositPayments): Promise<FastifyInstance> {
    const app = Fastify();
    await app.register(rawBody, { field: "rawBody", global: false, runFirst: true, encoding: false });
    await app.register(stripeWebhookRoutes, { db: untouchable, payments, prefix: "/webhooks" });
    await app.ready();
    server = app;
    return app;
  }
  afterEach(async () => { await server?.close(); server = undefined; });

  const ready = (gateway = new TestDepositGateway()): DepositPayments => ({ status: "ready", gateway, venueSlug: "trades-hall-glasgow", frontendUrl: "https://venviewer.com" });
  const post = (app: FastifyInstance, payload: string, signature?: string) => app.inject({
    method: "POST", url: "/webhooks/stripe", payload,
    headers: { "content-type": "application/json", ...(signature === undefined ? {} : { "stripe-signature": signature }) },
  });

  it("does not exist while deposits are off", async () => {
    const app = await serve({ status: "off" });
    const body = stripeEvent("checkout.session.completed", {});
    expect((await post(app, body, stripeSignature(body))).statusCode).toBe(404);
  });

  it("answers 503 while payments are refused, so Stripe shows the misconfiguration", async () => {
    const app = await serve({ status: "refused", reason: "live key" });
    const body = stripeEvent("checkout.session.completed", {});
    const res = await post(app, body, stripeSignature(body));
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: "PAYMENTS_REFUSED" });
  });

  it("refuses a signature that does not verify, and a missing one", async () => {
    const app = await serve(ready());
    const body = stripeEvent("checkout.session.completed", { id: "cs_test_x", payment_status: "paid", amount_total: 1, currency: "gbp", payment_intent: null });
    const forged = await post(app, body, stripeSignature(body, "whsec_attacker"));
    expect(forged.statusCode).toBe(400);
    expect(forged.json()).toMatchObject({ code: "INVALID_SIGNATURE" });
    expect((await post(app, body)).statusCode).toBe(400);
  });

  it("refuses a live-mode event while payments are in test mode", async () => {
    const app = await serve(ready());
    const body = stripeEvent("checkout.session.completed", { id: "cs_live_x", payment_status: "paid", amount_total: 1, currency: "gbp", payment_intent: null }, { livemode: true });
    const res = await post(app, body, stripeSignature(body));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "LIVE_EVENT_REFUSED" });
  });

  it("refuses a signed event it cannot read rather than guess", async () => {
    const app = await serve(ready());
    const body = stripeEvent("checkout.session.completed", { id: "not-a-session" });
    const res = await post(app, body, stripeSignature(body));
    expect(res.statusCode).toBe(400);
  });
});
