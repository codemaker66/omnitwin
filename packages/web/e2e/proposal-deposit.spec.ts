import { expect, test, type Page } from "@playwright/test";

const API = "http://localhost:3001";
const TOKEN = "clientDepositToken_0123456789abcdefghijklmnopqrstuv";
const CHECKOUT = "https://checkout.stripe.com/c/pay/cs_test_e2e_deposit";

// ---------------------------------------------------------------------------
// The client's deposit (Plan 19 L5), against route-mocked API responses
// (house pattern): below an accepted proposal, what is asked and from which
// version, the test-mode line, Pay that opens Stripe's own page, the page on
// return once Stripe has confirmed, and a declined attempt the client can try
// again. Stripe's page itself is stubbed: nothing leaves the browser.
// ---------------------------------------------------------------------------

const ACCEPTED = {
  title: "Autumn gala — Grand Hall",
  status: "accepted",
  sentAt: "2026-10-20T10:00:00.000Z",
  venueName: "Trades Hall Glasgow",
  venueSlug: "trades-hall-glasgow",
  venueAddress: "85 Glassford Street, Glasgow G1 1UH",
  preparedAt: "2026-10-20T09:30:00.000Z",
  facts: { eventDate: "2026-12-05", guestCount: 180, occasion: "gala", roomName: "Grand Hall", roomSlug: "grand-hall" },
  accepted: { by: "Ada Client", at: "2026-10-21T12:00:00.000Z" },
  clientMessage: null,
  capacityNote: null,
  quote: {
    quoteId: null, currency: "GBP",
    lineItems: [{ description: "Grand Hall hire", quantity: 1, unitAmountMinor: 250000, lineTotalMinor: 250000 }],
    subtotalMinor: 250000, totalMinor: 250000,
  },
  version: 1,
  comments: [],
};

const REQUEST = {
  id: "8c6d4f7e-1d0b-4e37-9a38-7b1f2f0c9d11", state: "requested", basis: "percent", percentBasisPoints: 2500,
  amountMinor: 62500, currency: "GBP", quoteTotalMinor: 250000, proposalVersion: 1,
  createdAt: "2026-10-27T10:00:00.000Z", cancelledAt: null, payments: [] as unknown[],
};

const attempt = (state: string, extra: Record<string, unknown> = {}) => ({
  id: "2a6d4f7e-1d0b-4e37-9a38-7b1f2f0c9d11", state, amountMinor: 62500, currency: "GBP", amountReceivedMinor: null,
  amountRefundedMinor: 0, failureMessage: null, createdAt: "2026-10-27T11:00:00.000Z", paidAt: null, lastEventAt: null, ...extra,
});

async function serve(page: Page, deposit: unknown, onCheckout?: (body: unknown) => void): Promise<void> {
  await page.route(`${API}/proposal-share/${TOKEN}`, (route) => { void route.fulfill({ json: { data: ACCEPTED } }); });
  await page.route(`${API}/proposal-share/${TOKEN}/deposit`, (route) => { void route.fulfill({ json: { data: { mode: "test", request: deposit } } }); });
  // No contract prepared here (proposal-contract.spec.ts signs one).
  await page.route(`${API}/proposal-share/${TOKEN}/contract`, (route) => { void route.fulfill({ json: { data: { consentStatement: "I agree.", contract: null } } }); });
  await page.route(`${API}/proposal-share/${TOKEN}/deposit/checkout`, (route) => {
    onCheckout?.(route.request().postDataJSON());
    void route.fulfill({ json: { data: { url: CHECKOUT } } });
  });
  await page.route("https://checkout.stripe.com/**", (route) => {
    void route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Stripe test checkout</title><h1>Stripe test checkout</h1>" });
  });
}

test.describe("the deposit on an accepted proposal", () => {
  test("asks from the accepted version, says it is a test, and Pay opens Stripe's page", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => { errors.push(error.message); });
    let sent: unknown = null;
    await serve(page, REQUEST, (body) => { sent = body; });
    await page.goto(`/proposal-share/${TOKEN}`);

    const deposit = page.getByTestId("client-deposit");
    await expect(deposit.getByRole("heading", { level: 2, name: "Your deposit" })).toBeVisible();
    await expect(deposit).toContainText("A deposit of £625.00, 25% of the £2,500.00 you accepted in version 1.");
    await expect(page.getByTestId("deposit-test-mode")).toContainText("Stripe takes no real money");
    await expect(deposit).toContainText("Paying the deposit does not confirm the booking");

    await page.getByRole("button", { name: "Pay £625.00" }).click();
    await expect(page).toHaveURL(CHECKOUT);
    await expect(page.getByRole("heading", { name: "Stripe test checkout" })).toBeVisible();
    expect(sent).toEqual({ requestId: REQUEST.id });
    expect(errors).toEqual([]);
  });

  test("shows the deposit paid once Stripe has confirmed it, with no Pay", async ({ page }) => {
    await serve(page, { ...REQUEST, state: "paid", payments: [attempt("paid", { paidAt: "2026-10-27T11:05:00.000Z", amountReceivedMinor: 62500 })] });
    await page.goto(`/proposal-share/${TOKEN}?deposit=returned`);
    await expect(page.getByTestId("deposit-standing")).toHaveText("£625.00 paid on 27 October 2026.");
    await expect(page.getByRole("button", { name: /^Pay/u })).toHaveCount(0);
  });

  test("says a declined card in Stripe's words and lets the client try again", async ({ page }) => {
    await serve(page, { ...REQUEST, payments: [attempt("declined", { failureMessage: "Your card was declined." })] });
    await page.goto(`/proposal-share/${TOKEN}?deposit=left`);
    await expect(page.getByTestId("deposit-standing")).toHaveText("Your last attempt did not go through: Your card was declined. You can try again.");
    await expect(page.getByText("You left Stripe's page before paying. Nothing was charged.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Pay £625.00" })).toBeEnabled();
  });

  test("keeps the deposit readable on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await serve(page, REQUEST);
    await page.goto(`/proposal-share/${TOKEN}`);
    const pay = page.getByRole("button", { name: "Pay £625.00" });
    await expect(pay).toBeVisible();
    const box = await pay.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
