import { expect, test, type Page } from "@playwright/test";
import type { DeskProposal, ProposalHistoryEntry, StaffProposalVersion } from "../src/api/proposals.js";
import {
  collectAccessibilityAudit,
  expectAccessibilityAuditClean,
  watchPageProblems,
} from "./support/accessibility-audit.js";

// ---------------------------------------------------------------------------
// E2E: the Proposals desk (roadmap X1).
//
// The proposals API is emulated in memory as the real routes behave: the
// ledger is ordered as GET /proposals/desk orders it (what the client sent
// back, drafts, with the client, accepted, closed; newest change first in
// each) with every status counted over the whole list; a quote's totals are
// worked out from its lines in whole pence; a new version takes the next
// number; and making a link sends a draft or a proposal the client asked to
// change. Nothing about a step is mocked per test.
// ---------------------------------------------------------------------------

const API = "http://localhost:3001";
const VENUE_ID = "00000000-0000-4000-8000-000000009701";
const STAFF_ID = "00000000-0000-4000-8000-000000009791";
const CRAWFORD = "00000000-0000-4000-8000-000000009711";
const MERCHANTS = "00000000-0000-4000-8000-000000009712";
const ROBERTSON = "00000000-0000-4000-8000-000000009713";
const TOKEN = "proposals-desk-token";
/** 10:00 in Glasgow on Tuesday 6 October 2026. */
const NOW = new Date("2026-10-06T09:00:00.000Z");

const VENUE = {
  id: VENUE_ID, name: "Trades Hall Glasgow", slug: "trades-hall", address: "85 Glassford Street",
  logoUrl: null, brandColour: null, timezone: "Europe/London", spaces: [],
};

const RANK: Readonly<Record<string, number>> = { changes_requested: 0, draft: 1, sent: 2, accepted: 3 };
const GROUPS: Readonly<Record<string, readonly string[]>> = {
  waiting: ["changes_requested"], drafts: ["draft"], with_client: ["sent"], accepted: ["accepted"],
  closed: ["declined", "withdrawn", "expired", "archived"],
};

interface Emulator {
  readonly proposals: Map<string, DeskProposal>;
  readonly versions: Map<string, StaffProposalVersion[]>;
  readonly history: Map<string, ProposalHistoryEntry[]>;
  readonly quotes: { readonly lines: number; readonly totalMinor: number }[];
  readonly links: string[];
}

function proposal(id: string, title: string, status: string, extra: Partial<DeskProposal> = {}): DeskProposal {
  return {
    id, venueId: VENUE_ID, opportunityId: null, enquiryId: null, configurationId: null, title, status, currentVersion: 1,
    shareCode: null, sentAt: null, createdBy: STAFF_ID, createdAt: "2026-09-20T09:00:00.000Z", updatedAt: "2026-10-01T09:00:00.000Z",
    deletedAt: null, dealTitle: null, clientName: null, eventDate: null, guestCount: null, eventType: null,
    latestTotalMinor: null, latestCurrency: null, linkOpenedAt: null, sentVersion: null, lastSentAt: null, hasLink: true, linkOpen: true,
    ...extra,
  };
}

function version(proposalId: string, n: number, payload: Partial<StaffProposalVersion["payload"]>): StaffProposalVersion {
  return {
    id: `${proposalId.slice(0, -4)}f${String(n).padStart(3, "0")}`, proposalId, version: n, sourceHash: "a".repeat(64), createdBy: STAFF_ID,
    createdAt: "2026-09-28T10:00:00.000Z",
    payload: {
      schemaVersion: "venviewer.proposal-version.v1", title: "Proposal", clientMessage: null, configurationId: null, layoutRevision: null,
      capacityNote: null, quote: null, ...payload,
    },
  };
}

async function openDesk(page: Page, width = 1440, height = 900): Promise<Emulator> {
  await page.setViewportSize({ width, height });
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(({ venueId, staffId }) => {
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true, writable: false });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", {
      value: { id: staffId, email: "catherine@proposals.test", role: "staff", platformRole: "none", venueId, name: "Catherine Tait" },
      writable: false,
    });
  }, { venueId: VENUE_ID, staffId: STAFF_ID });

  const emulator: Emulator = {
    proposals: new Map([
      [CRAWFORD, proposal(CRAWFORD, "Crawford wedding proposal", "changes_requested", {
        clientName: "Elaine Crawford", eventDate: "2027-06-05", guestCount: 160, eventType: "wedding", updatedAt: "2026-10-05T15:00:00.000Z",
        latestTotalMinor: 1_840_000, latestCurrency: "GBP", sentAt: "2026-09-29T10:00:00.000Z", sentVersion: 1,
      })],
      [MERCHANTS, proposal(MERCHANTS, "Merchants' dinner proposal", "sent", {
        clientName: "Iain Robertson", eventDate: "2026-11-20", guestCount: 90, eventType: "dinner", sentAt: "2026-10-02T11:00:00.000Z",
        updatedAt: "2026-10-02T11:00:00.000Z",
      })],
      [ROBERTSON, proposal(ROBERTSON, "Spring gala proposal", "draft", { currentVersion: 0, updatedAt: "2026-10-04T09:00:00.000Z" })],
    ]),
    versions: new Map([
      [CRAWFORD, [version(CRAWFORD, 1, {
        title: "Crawford wedding proposal", clientMessage: "Planning-grade proposal for your wedding on 5 June.",
        quote: {
          quoteId: null, currency: "GBP", subtotalMinor: 1_840_000, totalMinor: 1_840_000,
          lineItems: [
            { description: "Grand Hall hire", quantity: 1, unitAmountMinor: 440_000, lineTotalMinor: 440_000 },
            { description: "Dinner", quantity: 160, unitAmountMinor: 8_750, lineTotalMinor: 1_400_000 },
          ],
        },
      })]],
      [MERCHANTS, [version(MERCHANTS, 1, { title: "Merchants' dinner proposal" })]],
    ]),
    history: new Map([[CRAWFORD, [{
      id: "00000000-0000-4000-8000-00000000d001", proposalId: CRAWFORD, fromStatus: "sent", toStatus: "changes_requested", changedBy: null,
      note: "Could the dinner be a little less per head?", createdAt: "2026-10-05T15:00:00.000Z",
    }]]]),
    quotes: [],
    links: [],
  };

  const desk = (url: URL): Record<string, unknown> => {
    const all = [...emulator.proposals.values()];
    const group = url.searchParams.get("group");
    const listed = all
      .filter((row) => group === null || (GROUPS[group] ?? []).includes(row.status))
      .sort((a, b) => (RANK[a.status] ?? 4) - (RANK[b.status] ?? 4) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    const statusCounts: Record<string, number> = {};
    for (const row of all) statusCounts[row.status] = (statusCounts[row.status] ?? 0) + 1;
    const limit = Number(url.searchParams.get("limit") ?? "50");
    const offset = Number(url.searchParams.get("offset") ?? "0");
    return { data: listed.slice(offset, offset + limit), meta: { total: listed.length, limit, offset }, statusCounts };
  };

  await page.route(`${API}/**`, (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    if (path === "/proposals/desk") {
      void route.fulfill({ json: desk(url) });
      return;
    }
    if (path === "/quotes" && method === "POST") {
      const body = request.postDataJSON() as { lineItems: { description: string; quantity: number; unitAmountMinor: number }[] };
      // Exact, as the API's money engine: whole pence times whole quantities.
      const lineItems = body.lineItems.map((line, index) => ({
        id: `00000000-0000-4000-8000-0000000e${String(index).padStart(4, "0")}`, quoteId: "00000000-0000-4000-8000-00000000e999",
        pricingRuleId: null, description: line.description, quantity: line.quantity, unitAmountMinor: line.unitAmountMinor,
        lineTotalMinor: line.quantity * line.unitAmountMinor, sortOrder: index,
      }));
      const total = lineItems.reduce((sum, line) => sum + line.lineTotalMinor, 0);
      emulator.quotes.push({ lines: lineItems.length, totalMinor: total });
      void route.fulfill({ status: 201, json: { data: {
        id: "00000000-0000-4000-8000-00000000e999", venueId: VENUE_ID, opportunityId: null, proposalId: null, enquiryId: null, spaceId: null,
        name: "Quote", status: "draft", currency: "GBP", subtotalMinor: total, totalMinor: total, validUntil: null, supersededByQuoteId: null,
        notes: null, createdBy: STAFF_ID, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), deletedAt: null, lineItems,
      } } });
      return;
    }
    const match = /^\/proposals\/([0-9a-f-]{36})(\/.*)?$/u.exec(path);
    const current = match === null ? undefined : emulator.proposals.get(match[1] ?? "");
    if (match !== null && current !== undefined) {
      const id = current.id;
      const rest = match[2] ?? "";
      if (rest === "" && method === "GET") {
        void route.fulfill({ json: { data: current } });
        return;
      }
      if (rest === "/preview" && method === "GET") {
        // The latest saved version, as the client's page would draw it.
        const latest = (emulator.versions.get(id) ?? []).at(-1);
        if (latest === undefined) {
          void route.fulfill({ status: 422, json: { error: "No version", code: "PROPOSAL_HAS_NO_VERSION" } });
          return;
        }
        void route.fulfill({ json: { data: {
          title: latest.payload.title, status: current.status, sentAt: current.sentAt, venueName: "Trades Hall Glasgow",
          venueSlug: "trades-hall-glasgow", venueAddress: "85 Glassford Street, Glasgow G1 1UH", preparedAt: latest.createdAt,
          sentVersion: current.sentVersion, accepted: null,
          facts: { eventDate: current.eventDate, guestCount: current.guestCount, occasion: current.eventType, roomName: "Grand Hall", roomSlug: "grand-hall" },
          clientMessage: latest.payload.clientMessage, capacityNote: latest.payload.capacityNote, quote: latest.payload.quote, version: latest.version,
        } } });
        return;
      }
      if (rest === "/versions/latest") {
        const latest = (emulator.versions.get(id) ?? []).at(-1);
        void route.fulfill(latest === undefined ? { status: 404, json: { error: "No version" } } : { json: { data: latest } });
        return;
      }
      if (rest === "/versions" && method === "POST") {
        const payload = request.postDataJSON() as StaffProposalVersion["payload"];
        const saved = { ...version(id, current.currentVersion + 1, payload), createdAt: NOW.toISOString() };
        emulator.versions.set(id, [...(emulator.versions.get(id) ?? []), saved]);
        emulator.proposals.set(id, {
          ...current, currentVersion: saved.version, updatedAt: NOW.toISOString(),
          latestTotalMinor: payload.quote?.totalMinor ?? null, latestCurrency: payload.quote === null ? null : "GBP",
        });
        void route.fulfill({ status: 201, json: { data: saved } });
        return;
      }
      if (rest === "/share-token" && method === "POST") {
        const sends = current.status === "draft" || current.status === "changes_requested";
        const next: DeskProposal = sends ? { ...current, status: "sent", sentAt: NOW.toISOString(), updatedAt: NOW.toISOString() } : current;
        emulator.proposals.set(id, next);
        emulator.links.push(id);
        if (sends) {
          emulator.history.set(id, [...(emulator.history.get(id) ?? []), {
            id: `00000000-0000-4000-8000-00000000d${String(emulator.links.length).padStart(3, "0")}`, proposalId: id,
            fromStatus: current.status, toStatus: "sent", changedBy: STAFF_ID, note: "Client share link generated", createdAt: NOW.toISOString(),
          }]);
        }
        void route.fulfill({ status: 201, json: { data: { token: TOKEN, shareUrl: `/proposal-share/${TOKEN}`, tokenPrefix: TOKEN.slice(0, 8), proposal: next } } });
        return;
      }
      if (rest === "/history") {
        void route.fulfill({ json: { data: [...(emulator.history.get(id) ?? [])].reverse() } });
        return;
      }
      if (rest === "/comments") {
        void route.fulfill({ json: { data: [] } });
        return;
      }
    }
    if (path === `/venues/${VENUE_ID}/spaces`) {
      void route.fulfill({ json: { data: [] } });
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

function proposalRow(page: Page, title: string) {
  return page.locator(`button[data-proposal-id][aria-label^="${title},"]`);
}

function groups(page: Page): Promise<string[]> {
  return page.locator(".enq-group").evaluateAll((headings) => headings.map((heading) => heading.firstChild?.textContent ?? ""));
}

test.describe("Proposals desk", () => {
  test("a booker answers the client who asked for changes: the next version starts from the last and is sent after asking", async ({ page }) => {
    const emulator = await openDesk(page);
    await page.goto("/dashboard?view=proposals");
    await expect(page.getByRole("main")).toHaveAccessibleName("Proposals");
    await expect(page.getByTestId("proposals-summary"))
      .toHaveText("1 client asked for changes, and 1 draft is yours to finish. 1 proposal is with a client.");
    await expect.poll(() => groups(page)).toEqual(["Waiting on you", "Drafts", "With the client"]);

    // The first row is the tab stop; Enter opens it.
    const crawford = proposalRow(page, "Crawford wedding proposal");
    await expect(crawford).toHaveAttribute("tabindex", "0");
    await crawford.focus();
    await page.keyboard.press("Enter");
    const panel = page.getByRole("region", { name: "Crawford wedding proposal" });
    await expect(panel.getByRole("heading", { level: 2, name: "Crawford wedding proposal" })).toBeFocused();
    await expect(page).toHaveURL(new RegExp(`[?&]proposal=${CRAWFORD}`, "u"));
    await expect(panel.getByText("The client asked for changes.")).toBeVisible();
    await expect(panel.getByText("Could the dinner be a little less per head?")).toBeVisible();

    // Version 2 starts from version 1: nothing is typed again.
    const composer = panel.getByTestId("composer");
    await expect(composer.getByTestId("composer-message")).toHaveValue("Planning-grade proposal for your wedding on 5 June.");
    await expect(composer.getByTestId("quote-price-1")).toHaveValue("87.50");
    await composer.getByTestId("quote-price-1").fill("82.50");
    await expect(composer.getByTestId("composer-start")).toHaveText("Starts from version 1. Changed: the quote, £18,400 to £17,600.");
    await composer.getByRole("button", { name: "Save version 2" }).click();
    await expect.poll(() => emulator.quotes).toEqual([{ lines: 2, totalMinor: 1_760_000 }]);
    await expect(composer.getByTestId("composer-start")).toHaveText("Starts from version 2. Nothing is changed from it yet.");
    await expect(panel.getByTestId("latest-quote-total")).toHaveText("£17,600.00");

    // Sending asks first, in place, and names who it goes to.
    await panel.getByRole("button", { name: "Send to the client…" }).click();
    await expect(panel.getByText("Send version 2 to Elaine Crawford?")).toBeVisible();
    expect(emulator.links).toEqual([]);
    await panel.getByRole("button", { name: "Make the link" }).click();
    await expect(panel.getByTestId("share-link")).toHaveText(new RegExp(`/proposal-share/${TOKEN}$`, "u"));
    await expect(panel.getByText("With the client", { exact: true }).first()).toBeVisible();
    await expect.poll(() => groups(page)).toEqual(["Drafts", "With the client"]);
  });

  test("the open proposal survives a reload through its address, and the desk reads cleanly with it open", async ({ page }) => {
    await openDesk(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const problems = watchPageProblems(page);
    await page.goto(`/dashboard?view=proposals&proposal=${MERCHANTS}`);
    const panel = page.getByRole("region", { name: "Merchants' dinner proposal" });
    await expect(panel.getByRole("heading", { level: 2, name: "Merchants' dinner proposal" })).toBeVisible();
    await page.reload();
    await expect(panel.getByRole("heading", { level: 2, name: "Merchants' dinner proposal" })).toBeVisible();
    await expect(proposalRow(page, "Merchants' dinner proposal")).toHaveAttribute("aria-current", "true");
    // With the client already: a new link is offered, and why none shows.
    await expect(panel.getByRole("button", { name: "Issue a new link…" })).toBeVisible();
    await expect(panel.getByTestId("share-link-unavailable")).toBeVisible();

    const result = await collectAccessibilityAudit(page, {
      name: "proposals desk with a proposal open", path: "/dashboard?view=proposals", problems, maxFocusSteps: 16,
    });
    expectAccessibilityAuditClean(result);
  });

  test("Preview as the client shows the latest version as the client's page draws it, and no client route is called", async ({ page }) => {
    await openDesk(page);
    const clientCalls: string[] = [];
    page.on("request", (request) => {
      if (/\/proposal-share\/|\/public\/proposals\//u.test(request.url())) clientCalls.push(request.url());
    });
    await page.goto("/dashboard?view=proposals");
    await proposalRow(page, "Crawford wedding proposal").click();
    const link = page.getByTestId("preview-link");
    // A tab of its own, so a version being written in the desk is never lost.
    await expect(link).toHaveAttribute("target", "_blank");
    const href = await link.getAttribute("href");
    expect(href).toBe(`/proposal-preview/${CRAWFORD}`);

    await page.goto(href ?? "");
    await expect(page.getByRole("heading", { level: 1, name: "Crawford wedding proposal" })).toBeVisible();
    await expect(page.getByTestId("preview-band")).toContainText("Preview of version 1, as the client sees it.");
    await expect(page.getByTestId("preview-band")).toContainText("This is the version the client's link shows.");
    await expect(page.getByTestId("proposal-facts")).toContainText("Saturday 5 June 2027");
    await expect(page.getByTestId("proposal-total")).toContainText("£18,400.00");
    await expect(page.getByTestId("preview-decision").getByRole("button")).toHaveCount(0);
    await expect(page).toHaveTitle("Preview — Crawford wedding proposal — Trades Hall Glasgow — version 1");
    expect(clientCalls).toEqual([]);
  });

  test("on a phone the proposal replaces the ledger, Back to proposals returns to it, and nothing scrolls sideways", async ({ page }) => {
    await openDesk(page, 390, 844);
    await page.goto("/dashboard?view=proposals");
    // The ledger fits too: "Version 1, changed yesterday" wraps beneath its
    // status rather than running past the edge.
    await expect(proposalRow(page, "Crawford wedding proposal")).toContainText("Version 1, changed yesterday");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    // And no row's status line passes its own row, here or at 320 px, where
    // the page's gutter would hide a smaller overrun from the scroll check.
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      const past = await page.$$eval(".enq-row", (rows) => Math.max(0, ...rows.map((row) => {
        const bound = row.getBoundingClientRect().right;
        return Math.max(0, ...[...row.querySelectorAll(".enq-row__side, .enq-row__side *")].map((part) => part.getBoundingClientRect().right - bound));
      })));
      expect(past, `at ${String(width)} px`).toBeLessThanOrEqual(0.5);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await proposalRow(page, "Spring gala proposal").click();
    await expect(page.getByRole("heading", { level: 2, name: "Spring gala proposal" })).toBeFocused();
    await expect(page.getByRole("heading", { level: 1, name: "Proposals" })).toHaveCount(0);
    await expect(page.getByText("Write the first version below, then send it.")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.getByRole("button", { name: "Back to proposals" }).click();
    await expect(proposalRow(page, "Spring gala proposal")).toBeFocused();
  });
});
