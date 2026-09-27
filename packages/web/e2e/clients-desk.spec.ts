import { expect, test, type Page } from "@playwright/test";
import type { ContactProfile, RecentEnquiry, SearchResults } from "../src/api/clients.js";
import {
  collectAccessibilityAudit,
  expectAccessibilityAuditClean,
  watchPageProblems,
} from "./support/accessibility-audit.js";

// ---------------------------------------------------------------------------
// E2E: the Clients desk (roadmap X1).
//
// What the search finds is the API's to decide: that "Mcdonald" finds
// "MacDonald" and "henderson" brings back the contact, the deal and the
// proposal is proven against real PostgreSQL and pg_trgm in
// packages/api/src/__tests__/client-search-postgres.test.ts. Here the
// /clients routes answer with what that test's rows return, and the spec
// proves the desk: that what is typed reaches the search exactly as typed,
// that every kind of finding is shown and reachable from the keyboard, that
// an open client survives a reload through its address, and that the
// browser's Back closes it onto the same results.
// ---------------------------------------------------------------------------

const API = "http://localhost:3001";
const VENUE_ID = "00000000-0000-4000-8000-000000009501";
const STAFF_ID = "00000000-0000-4000-8000-000000009591";
const AILSA_ID = "00000000-0000-4000-8000-000000009511";
const FIONA_ID = "00000000-0000-4000-8000-000000009512";
const ACCOUNT_ID = "00000000-0000-4000-8000-000000009521";
const DEAL_ID = "00000000-0000-4000-8000-000000009531";
const PROPOSAL_ID = "00000000-0000-4000-8000-000000009541";
const LEAD_ID = "00000000-0000-4000-8000-000000009551";
/** 10:00 in Glasgow on Tuesday 6 October 2026. */
const NOW = new Date("2026-10-06T09:00:00.000Z");

const VENUE = {
  id: VENUE_ID, name: "Trades Hall Glasgow", slug: "trades-hall", address: "85 Glassford Street",
  logoUrl: null, brandColour: null, timezone: "Europe/London", spaces: [],
};

const NOTHING: SearchResults = { users: [], guestLeads: [], configurations: [], contacts: [], accounts: [], deals: [], proposals: [] };

/** What the client search answers, row for row, on the API test's venue. */
const FOUND: Readonly<Record<string, SearchResults>> = {
  henderson: {
    ...NOTHING,
    contacts: [{ id: AILSA_ID, name: "Ailsa Henderson", email: "ailsa.henderson@example.test", phone: "0141 555 0142", accountName: "Henderson Family" }],
    accounts: [{ id: ACCOUNT_ID, name: "Henderson Family", accountType: "individual", primaryContactId: AILSA_ID }],
    deals: [{ id: DEAL_ID, title: "Wedding reception, 5 June", stage: "proposal_sent", preferredDate: "2027-06-05", guestCount: 160, contactName: "Ailsa Henderson" }],
    proposals: [{ id: PROPOSAL_ID, title: "Henderson wedding proposal", status: "sent", currentVersion: 2, opportunityId: DEAL_ID, sentAt: "2026-09-30T14:00:00.000Z" }],
  },
  mcdonald: {
    ...NOTHING,
    contacts: [{ id: FIONA_ID, name: "Fiona MacDonald", email: "fiona.macdonald@example.test", phone: null, accountName: null }],
  },
};

const AILSA: ContactProfile = {
  contact: {
    id: AILSA_ID, venueId: VENUE_ID, name: "Ailsa Henderson", email: "ailsa.henderson@example.test", phone: "0141 555 0142",
    roleLabel: "Bride", sourceEnquiryId: null, createdAt: "2026-08-14T10:00:00.000Z",
    account: { id: ACCOUNT_ID, name: "Henderson Family" },
  },
  deals: [{ id: DEAL_ID, title: "Wedding reception, 5 June", stage: "proposal_sent", preferredDate: "2027-06-05", guestCount: 160,
    estimatedValueMinor: 1_840_000, currency: "GBP", updatedAt: "2026-09-30T14:00:00.000Z" }],
  proposals: [{ id: PROPOSAL_ID, opportunityId: DEAL_ID, title: "Henderson wedding proposal", status: "sent", currentVersion: 2,
    sentAt: "2026-09-30T14:00:00.000Z" }],
};

function enquiry(overrides: Partial<RecentEnquiry>): RecentEnquiry {
  return {
    id: "00000000-0000-4000-8000-000000009561", state: "submitted", name: "Kirsty Fraser", email: "kirsty@example.test",
    guestEmail: "kirsty@example.test", guestPhone: null, guestName: "Kirsty Fraser", userId: null, eventType: "wedding",
    preferredDate: "2026-11-14", createdAt: "2026-10-05T16:20:00.000Z", leadId: LEAD_ID, ...overrides,
  };
}

const UPCOMING = [enquiry({})];
const RECENT = [
  enquiry({}),
  enquiry({ id: "00000000-0000-4000-8000-000000009562", name: "Merchants' Guild", guestName: "Iain Robertson", guestEmail: "iain@example.test",
    email: "iain@example.test", eventType: "dinner", preferredDate: null, createdAt: "2026-10-02T11:00:00.000Z", leadId: null }),
];

interface Emulator {
  readonly searches: string[];
}

async function openDesk(page: Page, width = 1440, height = 900): Promise<Emulator> {
  await page.setViewportSize({ width, height });
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(({ venueId, staffId }) => {
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true, writable: false });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", {
      value: { id: staffId, email: "catherine@clients.test", role: "staff", platformRole: "none", venueId, name: "Catherine Tait" },
      writable: false,
    });
  }, { venueId: VENUE_ID, staffId: STAFF_ID });

  const emulator: Emulator = { searches: [] };
  await page.route(`${API}/**`, (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/clients/search") {
      const q = url.searchParams.get("q") ?? "";
      emulator.searches.push(q);
      void route.fulfill({ json: { data: FOUND[q.toLowerCase()] ?? NOTHING } });
    } else if (path === "/clients/upcoming") {
      void route.fulfill({ json: { data: UPCOMING } });
    } else if (path === "/clients/recent") {
      void route.fulfill({ json: { data: RECENT } });
    } else if (path === `/clients/contacts/${AILSA_ID}/profile`) {
      void route.fulfill({ json: { data: AILSA } });
    } else if (path === `/venues/${VENUE_ID}` || path === "/venues") {
      void route.fulfill({ json: { data: path === "/venues" ? [VENUE] : VENUE } });
    } else if (path === "/notifications/unread-count") {
      void route.fulfill({ json: { data: { unread: 0 } } });
    } else if (path.startsWith("/notifications")) {
      void route.fulfill({ json: { data: [] } });
    } else {
      void route.fulfill({ status: 404, json: { error: `Not emulated: ${path}` } });
    }
  });
  return emulator;
}

function resultRow(page: Page, label: string) {
  return page.locator(`[data-row-key][aria-label^="${label}"]`);
}

test.describe("Clients desk", () => {
  test("a booker finds the Hendersons from the keyboard, opens Ailsa, reloads, and Back returns to the results", async ({ page }) => {
    const emulator = await openDesk(page);
    await page.goto("/dashboard?view=search");
    await expect(page.getByRole("main")).toHaveAccessibleName("Clients");
    await expect(page.getByRole("heading", { level: 1, name: "Clients" })).toBeVisible();

    // Before anything is typed: whose events come next, then who was last in touch.
    await expect(page.getByRole("heading", { level: 2, name: /^Coming up/u })).toBeVisible();
    await expect(resultRow(page, "Kirsty Fraser, enquiry, Saturday 14 November 2026")).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: /^Recently in touch/u })).toBeVisible();
    await expect(resultRow(page, "Iain Robertson, enquiry")).toBeVisible();

    await page.locator("body").press("/");
    const search = page.getByRole("searchbox", { name: "Search clients" });
    await expect(search).toBeFocused();
    await page.keyboard.type("henderson");
    await expect(page.getByTestId("clients-count")).toHaveText("4 found for “henderson”.");
    await expect(page).toHaveURL(/[?&]q=henderson(&|$)/u);
    expect(emulator.searches).toEqual(["henderson"]);
    for (const group of ["People", "Organisations", "Deals", "Proposals"]) {
      await expect(page.getByRole("heading", { level: 2, name: new RegExp(`^${group}`, "u") })).toBeVisible();
    }
    await expect(resultRow(page, "Wedding reception, 5 June, deal, Saturday 5 June 2027, Proposal sent")).toBeVisible();
    await expect(resultRow(page, "Henderson wedding proposal, proposal, With the client")).toBeVisible();

    await search.press("ArrowDown");
    await expect(resultRow(page, "Ailsa Henderson, contact")).toBeFocused();
    await page.keyboard.press("Enter");
    const heading = page.getByRole("heading", { level: 2, name: "Ailsa Henderson" });
    await expect(heading).toBeFocused();
    await expect(page).toHaveURL(new RegExp(`client=contact(%3A|:)${AILSA_ID}`, "u"));
    const panel = page.locator(".cl-panel").filter({ has: heading });
    await expect(panel.getByRole("link", { name: "ailsa.henderson@example.test" })).toHaveAttribute("href", "mailto:ailsa.henderson@example.test");
    await expect(panel.getByRole("link", { name: "0141 555 0142" })).toHaveAttribute("href", "tel:01415550142");
    await expect(panel.locator(".cl-facts")).toContainText("None yet");

    // The browser's Back closes the client and returns the reader to its row;
    // Forward opens it again.
    await page.goBack();
    await expect(page.getByRole("heading", { level: 2, name: "Ailsa Henderson" })).toHaveCount(0);
    await expect(resultRow(page, "Ailsa Henderson, contact")).toBeFocused();
    await page.goForward();
    await expect(page.getByRole("heading", { level: 2, name: "Ailsa Henderson" })).toBeVisible();

    // The client and what was searched survive a reload.
    await page.reload();
    await expect(page.getByRole("heading", { level: 2, name: "Ailsa Henderson" })).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "Search clients" })).toHaveValue("henderson");
    await expect(resultRow(page, "Ailsa Henderson, contact")).toHaveAttribute("aria-current", "true");

    // Back closes the client onto the same results.
    await page.goBack();
    await expect(page.getByRole("heading", { level: 2, name: "Ailsa Henderson" })).toHaveCount(0);
    await expect(page.getByRole("complementary", { name: "Clients overview" })).toBeVisible();
    await expect(page).toHaveURL(/[?&]q=henderson(&|$)/u);
    await expect(page).not.toHaveURL(/client=/u);
    await expect(page.getByTestId("clients-count")).toHaveText("4 found for “henderson”.");
  });

  test("a name spelt as it was heard reaches the search as typed, and the desk reads cleanly", async ({ page }) => {
    const emulator = await openDesk(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const problems = watchPageProblems(page);
    await page.goto("/dashboard?view=search");
    const search = page.getByRole("searchbox", { name: "Search clients" });
    await search.fill("Mcdonald");
    await expect(resultRow(page, "Fiona MacDonald, contact")).toBeVisible();
    expect(emulator.searches).toEqual(["Mcdonald"]);

    await search.fill("henderson");
    await resultRow(page, "Ailsa Henderson, contact").click();
    await expect(page.getByRole("heading", { level: 2, name: "Ailsa Henderson" })).toBeFocused();
    const result = await collectAccessibilityAudit(page, {
      name: "clients desk with a client open", path: "/dashboard?view=search", problems, maxFocusSteps: 16,
    });
    expectAccessibilityAuditClean(result);
  });

  test("on a phone the client replaces the list, Back to clients returns to it, and nothing scrolls sideways", async ({ page }) => {
    await openDesk(page, 390, 844);
    await page.goto("/dashboard?view=search&q=henderson");
    await resultRow(page, "Ailsa Henderson, contact").click();
    await expect(page.getByRole("heading", { level: 2, name: "Ailsa Henderson" })).toBeFocused();
    await expect(page.getByRole("searchbox", { name: "Search clients" })).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await page.getByRole("button", { name: "Back to clients" }).click();
    await expect(resultRow(page, "Ailsa Henderson, contact")).toBeFocused();
    await expect(page).not.toHaveURL(/client=/u);
  });
});
