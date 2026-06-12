import { expect, test } from "@playwright/test";

const API = "http://localhost:3001";
const SHARE_CODE = "abcdef";

// ---------------------------------------------------------------------------
// Client share-link flow — T-427 phase 5.
//
// Exercises the public proposal page end-to-end against route-mocked API
// responses (house pattern: no live API needed). Covers the client-safe
// render (quote, planning-grade capacity guidance, SAFE disclosure), the
// accept flow, the note-gated request-changes flow, and the plain-English
// unavailable state.
// ---------------------------------------------------------------------------

const SENT_PROPOSAL = {
  data: {
    title: "Summer wedding — Grand Hall",
    status: "sent",
    sentAt: "2026-06-11T10:00:00.000Z",
    venueName: "Trades Hall Glasgow",
    clientMessage:
      "Planning-grade draft for your review. Human review required before anything is finalised.",
    capacityNote:
      "Grand Hall: comfortable for around 140 guests as seated dinner on round tables — for 120 guests: Comfortable — within planning guidance. Planning estimate only, human review required — not a legal occupancy or fire-capacity figure.",
    quote: {
      quoteId: null,
      currency: "GBP",
      lineItems: [
        { description: "Grand Hall hire", quantity: 1, unitAmountMinor: 250000, lineTotalMinor: 250000 },
        { description: "Round table", quantity: 12, unitAmountMinor: 1250, lineTotalMinor: 15000 },
      ],
      subtotalMinor: 265000,
      totalMinor: 265000,
    },
    version: 1,
  },
};

test.describe("proposal share link", () => {
  test("renders a client-safe sent proposal with quote, capacity guidance, and SAFE disclosure", async ({ page }) => {
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => { runtimeErrors.push(error.message); });
    page.on("console", (message) => {
      if (message.type() === "error") runtimeErrors.push(message.text());
    });

    await page.route(`${API}/public/proposals/${SHARE_CODE}`, (route) => {
      void route.fulfill({ json: SENT_PROPOSAL });
    });

    await page.goto(`/proposal/${SHARE_CODE}`);

    await expect(page.getByRole("heading", { name: "Summer wedding — Grand Hall" })).toBeVisible();
    await expect(page.getByText("Trades Hall Glasgow")).toBeVisible();

    // Quote renders from integer minor units, formatted display-only.
    await expect(page.getByText("£2,650.00")).toBeVisible();
    await expect(page.getByText("Grand Hall hire")).toBeVisible();

    // Planning-grade capacity guidance (T-429) under its SAFE label.
    await expect(page.getByText("Capacity guidance — planning estimate")).toBeVisible();
    await expect(page.getByText(/comfortable for around 140 guests/)).toBeVisible();
    await expect(page.getByText(/not a legal occupancy or fire-capacity figure/)).toBeVisible();

    // Standing footer disclosure.
    await expect(page.getByText(/reviewed by a human before anything/)).toBeVisible();

    // Client actions available while status is "sent".
    await expect(page.getByRole("button", { name: "Approve proposal" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Request changes" })).toBeVisible();

    expect(runtimeErrors).toEqual([]);
  });

  test("accepts the proposal and shows the accepted banner", async ({ page }) => {
    await page.route(`${API}/public/proposals/${SHARE_CODE}`, (route) => {
      void route.fulfill({ json: SENT_PROPOSAL });
    });
    await page.route(`${API}/public/proposals/${SHARE_CODE}/respond`, (route) => {
      void route.fulfill({ json: { data: { status: "accepted" } } });
    });

    await page.goto(`/proposal/${SHARE_CODE}`);
    await page.getByRole("button", { name: "Approve proposal" }).click();

    await expect(page.getByText("Proposal accepted")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve proposal" })).toHaveCount(0);
  });

  test("request changes is note-gated and sends the note", async ({ page }) => {
    let respondBody: unknown = null;
    await page.route(`${API}/public/proposals/${SHARE_CODE}`, (route) => {
      void route.fulfill({ json: SENT_PROPOSAL });
    });
    await page.route(`${API}/public/proposals/${SHARE_CODE}/respond`, (route) => {
      respondBody = route.request().postDataJSON();
      void route.fulfill({ json: { data: { status: "changes_requested" } } });
    });

    await page.goto(`/proposal/${SHARE_CODE}`);
    await page.getByRole("button", { name: "Request changes" }).click();

    const sendButton = page.getByRole("button", { name: "Send request" });
    await expect(sendButton).toBeDisabled();

    await page.getByLabel(/what you'd like changed/i).fill("Could we move the bar to the north wall?");
    await expect(sendButton).toBeEnabled();
    await sendButton.click();

    await expect(page.getByText("Changes requested")).toBeVisible();
    expect(respondBody).toMatchObject({
      action: "request_changes",
      note: "Could we move the bar to the north wall?",
    });
  });

  test("shows the plain-English unavailable state for unknown codes", async ({ page }) => {
    await page.route(`${API}/public/proposals/zzzzzz`, (route) => {
      void route.fulfill({ status: 404, json: { error: "Proposal not found", code: "NOT_FOUND" } });
    });

    await page.goto("/proposal/zzzzzz");
    await expect(page.getByText("This proposal link isn't available")).toBeVisible();
    await expect(page.getByText(/contact the venue team/)).toBeVisible();
  });
});
