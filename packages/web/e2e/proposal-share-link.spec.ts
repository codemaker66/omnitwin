import { expect, test } from "@playwright/test";

const API = "http://localhost:3001";
const SHARE_CODE = "abcdef";
const TOKEN = "clientPageToken_0123456789abcdefghijklmnopqrstuv";

// ---------------------------------------------------------------------------
// The client's proposal page (roadmap X1; T-427 phase 5), against
// route-mocked API responses (house pattern: no live API needed): the ivory
// document, the decision at its foot, and the plain-English unavailable state.
// Accepting on a link asks the name it is given in; every answer names the
// version the client read, and one made on an older page is refused and the
// newer version shown instead.
// ---------------------------------------------------------------------------

const QUOTE = {
  quoteId: null,
  currency: "GBP",
  lineItems: [
    { description: "Grand Hall hire", quantity: 1, unitAmountMinor: 250000, lineTotalMinor: 250000 },
    { description: "Round table", quantity: 12, unitAmountMinor: 1250, lineTotalMinor: 15000 },
  ],
  subtotalMinor: 265000,
  totalMinor: 265000,
};

const SENT = {
  title: "Summer wedding — Grand Hall",
  status: "sent",
  sentAt: "2026-06-11T10:00:00.000Z",
  venueName: "Trades Hall Glasgow",
  venueSlug: "trades-hall-glasgow",
  venueAddress: "85 Glassford Street, Glasgow G1 1UH",
  preparedAt: "2026-06-11T09:30:00.000Z",
  facts: { eventDate: "2027-06-05", guestCount: 120, occasion: "wedding", roomName: "Grand Hall", roomSlug: "grand-hall" },
  accepted: null,
  clientMessage: "Planning-grade draft for your review.",
  capacityNote: "Grand Hall: comfortable for around 140 guests as seated dinner on round tables.",
  quote: QUOTE,
  version: 1,
};

const SENT_PROPOSAL = { data: SENT };

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

    await expect(page.getByRole("heading", { level: 1, name: "Summer wedding — Grand Hall" })).toBeVisible();
    await expect(page.getByText("Version 1 · prepared 11 June 2026")).toBeVisible();
    // The event, as the venue holds it.
    const facts = page.getByTestId("proposal-facts");
    await expect(facts).toContainText("Saturday 5 June 2027");
    await expect(facts).toContainText("120");
    await expect(facts).toContainText("Wedding");
    await expect(facts).toContainText("Grand Hall");
    await expect(page.getByRole("img", { name: "The Grand Hall" })).toBeVisible();

    // The quote, exact to the penny, with its total on the copper plane.
    await expect(page.getByTestId("proposal-total")).toContainText("£2,650.00");
    await expect(page.getByText("Grand Hall hire")).toBeVisible();

    // Capacity is guidance; one line at the foot says so, and leaves the price alone.
    await expect(page.getByRole("heading", { level: 2, name: "Capacity" })).toBeVisible();
    await expect(page.getByText(/comfortable for around 140 guests/u)).toBeVisible();
    await expect(page.getByText("Numbers and layout are planning estimates; the events team confirms them. Nothing here is a safety, occupancy or compliance determination.")).toBeVisible();

    // The decision, last, while it is the client's to make.
    await expect(page.getByRole("button", { name: "Accept version 1" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ask for changes…" })).toBeVisible();
    await expect(page.getByText("The venue team is told at once. Accepting does not hold the date or take a payment.")).toBeVisible();
    await expect(page).toHaveTitle("Summer wedding — Grand Hall — Trades Hall Glasgow — version 1");

    expect(runtimeErrors).toEqual([]);
  });

  test("accepts the proposal and shows the accepted banner", async ({ page }) => {
    let accepted = false;
    let respondBody: unknown = null;
    await page.route(`${API}/public/proposals/${SHARE_CODE}`, (route) => {
      void route.fulfill({ json: { data: accepted ? { ...SENT, status: "accepted", accepted: { by: null, at: "2026-06-12T09:00:00.000Z" } } : SENT } });
    });
    await page.route(`${API}/public/proposals/${SHARE_CODE}/respond`, (route) => {
      respondBody = route.request().postDataJSON();
      accepted = true;
      void route.fulfill({ json: { data: { status: "accepted" } } });
    });

    await page.goto(`/proposal/${SHARE_CODE}`);
    await page.getByRole("button", { name: "Accept version 1" }).click();

    // The answer names the version read; the page reads the proposal again.
    await expect(page.getByTestId("proposal-standing")).toHaveText("Accepted on 12 June 2026.");
    expect(respondBody).toMatchObject({ action: "accept", version: 1 });
    await expect(page.getByRole("button", { name: "Accept version 1" })).toHaveCount(0);
    // The client answered at the foot of the page, and the button they
    // pressed is gone: the sentence in its place takes focus and comes into view.
    const result = page.getByRole("status").filter({ hasText: "You accepted this version. The venue team has been told." });
    await expect(result).toBeFocused();
    await expect(result).toBeInViewport();
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
    await page.getByRole("button", { name: "Ask for changes…" }).click();

    const note = page.getByLabel("What would you like changed?");
    await expect(note).toBeFocused();
    const sendButton = page.getByRole("button", { name: "Send to the venue team" });
    await expect(sendButton).toBeDisabled();

    await note.fill("Could we move the bar to the north wall?");
    await expect(sendButton).toBeEnabled();
    await sendButton.click();

    await expect(page.getByText("Your changes went to the venue team. This version is on hold until they send the next one.")).toBeVisible();
    expect(respondBody).toMatchObject({
      action: "request_changes",
      note: "Could we move the bar to the north wall?",
      version: 1,
    });
  });

  test("shows the plain-English unavailable state for unknown codes", async ({ page }) => {
    await page.route(`${API}/public/proposals/zzzzzz`, (route) => {
      void route.fulfill({ status: 404, json: { error: "Proposal not found", code: "NOT_FOUND" } });
    });

    await page.goto("/proposal/zzzzzz");
    await expect(page.getByText("This proposal link isn't available")).toBeVisible();
    await expect(page.getByText(/ask the venue team who sent it/u)).toBeVisible();
  });

  test("on a link, accepting asks the name and sends it with the version read; a newer version is shown, not accepted unseen", async ({ page }) => {
    const bodies: unknown[] = [];
    let current = 1;
    await page.route(`${API}/proposal-share/${TOKEN}`, (route) => {
      void route.fulfill({ json: { data: current === 1 ? SENT : {
        ...SENT, version: 2, preparedAt: "2026-06-12T09:00:00.000Z",
        quote: { ...QUOTE, subtotalMinor: 270000, totalMinor: 270000, lineItems: [{ description: "Grand Hall hire", quantity: 1, unitAmountMinor: 270000, lineTotalMinor: 270000 }] },
      } } });
    });
    await page.route(`${API}/proposal-share/${TOKEN}/approve`, (route) => {
      bodies.push(route.request().postDataJSON());
      // The venue sent version 2 while this page showed version 1.
      current = 2;
      void route.fulfill({ status: 409, json: { error: "A newer version was sent.", code: "PROPOSAL_VERSION_CHANGED" } });
    });

    await page.goto(`/proposal-share/${TOKEN}`);
    await page.getByRole("button", { name: "Accept version 1" }).click();
    const name = page.getByLabel("Your name");
    await expect(page.getByText("Please give your name to accept.")).toBeVisible();
    await expect(name).toBeFocused();
    expect(bodies).toEqual([]);

    await name.fill("Elaine Crawford");
    await page.getByRole("button", { name: "Accept version 1" }).click();
    await expect(page.getByRole("alert")).toHaveText("A newer version arrived after you opened this page. It is shown above now; what you typed is still here.");
    expect(bodies).toEqual([{ authorName: "Elaine Crawford", version: 1 }]);
    await expect(page.getByRole("button", { name: "Accept version 2" })).toBeVisible();
    await expect(page.getByTestId("proposal-total")).toContainText("£2,700.00");
    await expect(name).toHaveValue("Elaine Crawford");
  });

  test("prints as a document: ink on white, the decision as one sentence, no forms", async ({ page }) => {
    await page.route(`${API}/proposal-share/${TOKEN}`, (route) => {
      void route.fulfill({ json: SENT_PROPOSAL });
    });
    await page.goto(`/proposal-share/${TOKEN}`);
    await expect(page.getByRole("button", { name: "Accept version 1" })).toBeVisible();

    await page.emulateMedia({ media: "print" });
    await expect(page.getByTestId("proposal-decision")).toBeHidden();
    await expect(page.getByTestId("proposal-comments")).toBeHidden();
    await expect(page.getByText("Not yet accepted.")).toBeVisible();
    const printed = await page.evaluate(() => {
      const sheet = document.querySelector(".pd-sheet");
      const total = document.querySelector("[data-testid='proposal-total'] strong");
      return {
        sheet: sheet === null ? "" : getComputedStyle(sheet).backgroundColor,
        total: total === null ? "" : getComputedStyle(total).color,
      };
    });
    expect(printed).toEqual({ sheet: "rgb(255, 255, 255)", total: "rgb(17, 17, 17)" });
  });
});
