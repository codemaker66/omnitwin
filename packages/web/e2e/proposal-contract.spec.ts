import { expect, test, type Page } from "@playwright/test";

const API = "http://localhost:3001";
const TOKEN = "clientContractToken_0123456789abcdefghijklmnopqrstuv";
const STATEMENT = "I have read this contract and agree to its terms. I understand that typing my name and pressing Sign is my electronic signature, and that it binds me as my handwritten signature would.";

// ---------------------------------------------------------------------------
// The client's contract (Plan 19 L5), against route-mocked API responses
// (house pattern): the document generated from the accepted proposal, read
// and signed with a typed name and a ticked statement; what the record keeps
// said before signing; a contract changed while the page was open refused,
// the new one shown, the name kept; readable and signable on a phone.
// ---------------------------------------------------------------------------

const ACCEPTED = {
  title: "Autumn gala — Grand Hall", status: "accepted", sentAt: "2026-10-20T10:00:00.000Z",
  venueName: "Trades Hall Glasgow", venueSlug: "trades-hall-glasgow", venueAddress: "85 Glassford Street, Glasgow G1 1UH",
  preparedAt: "2026-10-20T09:30:00.000Z",
  facts: { eventDate: "2026-12-05", guestCount: 180, occasion: "gala", roomName: "Grand Hall", roomSlug: "grand-hall" },
  accepted: { by: "Ada Client", at: "2026-10-21T12:00:00.000Z" }, clientMessage: null, capacityNote: null,
  quote: { quoteId: null, currency: "GBP", lineItems: [{ description: "Grand Hall hire", quantity: 1, unitAmountMinor: 250000, lineTotalMinor: 250000 }], subtotalMinor: 250000, totalMinor: 250000 },
  version: 1, comments: [],
};

const contractDocument = (contractVersion: number, terms: string) => ({
  schemaVersion: "venviewer.contract.v1", contractVersion, preparedAt: "2026-10-27T10:00:00.000Z",
  venue: { name: "Trades Hall Glasgow", address: "85 Glassford Street, Glasgow G1 1UH" },
  client: { name: "Ada Client", email: "ada@example.test" },
  proposal: { title: "Autumn gala — Grand Hall", version: 1, versionHash: "b".repeat(64) },
  event: ACCEPTED.facts, quote: ACCEPTED.quote, terms,
});
const TERMS = "1. A deposit of 25% of the hire fee secures the date.\n2. Cancellation within 90 days of the event forfeits the deposit.\n3. The Grand Hall is available from 10:00 on the day.";

/** The contract as the API holds it: `before` until a signature is sent, `after` from then on. */
async function serve(page: Page, before: unknown, after: unknown = before, onSign?: (body: unknown) => number): Promise<void> {
  let sentSignature = false;
  await page.route(`${API}/proposal-share/${TOKEN}`, (route) => { void route.fulfill({ json: { data: ACCEPTED } }); });
  await page.route(`${API}/proposal-share/${TOKEN}/deposit`, (route) => { void route.fulfill({ status: 404, json: { error: "Not found", code: "NOT_FOUND" } }); });
  await page.route(`${API}/proposal-share/${TOKEN}/contract`, (route) => {
    void route.fulfill({ json: { data: { consentStatement: STATEMENT, contract: sentSignature ? after : before } } });
  });
  await page.route(`${API}/proposal-share/${TOKEN}/contract/sign`, (route) => {
    sentSignature = true;
    const status = onSign?.(route.request().postDataJSON()) ?? 201;
    void route.fulfill(status === 201
      ? { status, json: { data: { signerName: "Ada Client", signedAt: "2026-10-27T11:00:00.000Z", already: false } } }
      : { status, json: { error: "changed", code: "CONTRACT_VERSION_CHANGED" } });
  });
}

const unsigned = { version: 1, document: contractDocument(1, TERMS), documentHash: "c".repeat(64), signature: null, signable: true };
const signed = { ...unsigned, signature: { signerName: "Ada Client", signedAt: "2026-10-27T11:00:00.000Z" } };

test.describe("the contract on an accepted proposal", () => {
  test("is read and signed with a typed name and the ticked statement", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => { errors.push(error.message); });
    let sent: unknown = null;
    await serve(page, unsigned, signed, (body) => { sent = body; return 201; });
    await page.goto(`/proposal-share/${TOKEN}`);

    const contract = page.getByTestId("client-contract");
    await expect(contract.getByRole("heading", { level: 2, name: "Your contract" })).toBeVisible();
    await expect(contract).toContainText("Version 1 of the contract, prepared 27 October 2026, for the proposal you accepted (version 1).");
    await expect(page.getByTestId("contract-document")).toContainText("Ada Client (ada@example.test)");
    await expect(page.getByTestId("contract-document")).toContainText("2. Cancellation within 90 days of the event forfeits the deposit.");
    await expect(contract).toContainText("The venue keeps a record of your signature");

    await contract.getByLabel("Your full name").fill("Ada Client");
    await contract.getByRole("checkbox", { name: STATEMENT }).check();
    await contract.getByRole("button", { name: "Sign version 1" }).click();
    await expect(page.getByTestId("contract-signed")).toHaveText("Signed by Ada Client on 27 October 2026.");
    await expect(page.getByTestId("contract-signed")).toBeFocused();
    expect(sent).toEqual({ contractVersion: 1, documentHash: "c".repeat(64), signerName: "Ada Client", consent: true, consentStatement: STATEMENT });
    expect(errors).toEqual([]);
  });

  test("refuses a contract the venue changed while the page was open, shows the new one, and keeps the name", async ({ page }) => {
    const changed = { version: 2, document: contractDocument(2, `${TERMS}\n4. Music ends at midnight.`), documentHash: "d".repeat(64), signature: null, signable: true };
    await serve(page, unsigned, changed, () => 409);
    await page.goto(`/proposal-share/${TOKEN}`);
    const contract = page.getByTestId("client-contract");
    await contract.getByLabel("Your full name").fill("Ada Client");
    await contract.getByRole("checkbox", { name: STATEMENT }).check();
    await contract.getByRole("button", { name: "Sign version 1" }).click();
    await expect(contract.getByRole("alert")).toContainText("changed the contract after you opened this page");
    await expect(page.getByTestId("contract-document")).toContainText("4. Music ends at midnight.");
    await expect(contract.getByLabel("Your full name")).toHaveValue("Ada Client");
    await expect(contract.getByRole("checkbox", { name: STATEMENT })).not.toBeChecked();
    await expect(contract.getByRole("button", { name: "Sign version 2" })).toBeVisible();
  });

  test("is readable and signable on a phone, with nothing scrolling sideways", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await serve(page, unsigned);
    await page.goto(`/proposal-share/${TOKEN}`);
    const sign = page.getByRole("button", { name: "Sign version 1" });
    await sign.scrollIntoViewIfNeeded();
    await expect(sign).toBeVisible();
    expect((await sign.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
