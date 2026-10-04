import { expect, test, type Page } from "@playwright/test";
import type { ProposalEvent, ProposalTemplate } from "@omnitwin/types";
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
  /** The venue's price list, as the pricing route answers it now. */
  prices: Record<string, unknown>[];
  /** The venue's templates, live and removed, as the templates route keeps them. */
  readonly templates: Map<string, ProposalTemplate>;
  readonly removedTemplates: Set<string>;
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

/** The venue's rooms, price list and templates, which most cases leave
 *  empty, and each proposal's event as the venue holds it. */
interface World {
  readonly rooms?: readonly Record<string, unknown>[];
  readonly prices?: readonly Record<string, unknown>[];
  readonly templates?: readonly ProposalTemplate[];
  readonly events?: Readonly<Record<string, ProposalEvent>>;
}

async function openDesk(page: Page, width = 1440, height = 900, world: World = {}): Promise<Emulator> {
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
    prices: [...(world.prices ?? [])],
    templates: new Map((world.templates ?? []).map((template) => [template.id, template])),
    removedTemplates: new Set(),
  };

  // Templates as the route keeps them: one live template per name whatever
  // its case, a replace only from the moment it was read, removal undone
  // unless the name has been taken since.
  const templatesPath = `/venues/${VENUE_ID}/proposal-templates`;
  const liveTemplates = (): ProposalTemplate[] => [...emulator.templates.values()]
    .filter((template) => !emulator.removedTemplates.has(template.id))
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  const nameTaken = (name: string, except: string | null): ProposalTemplate | undefined =>
    liveTemplates().find((template) => template.id !== except && template.name.toLowerCase() === name.trim().toLowerCase());
  const keptTemplate = (id: string, body: Record<string, unknown>): ProposalTemplate => {
    const spaceId = typeof body["spaceId"] === "string" ? body["spaceId"] : null;
    const room = (world.rooms ?? []).find((candidate) => candidate["id"] === spaceId);
    return {
      id, venueId: VENUE_ID, spaceId, roomName: typeof room?.["name"] === "string" ? room["name"] : null, roomListed: true,
      occasion: typeof body["occasion"] === "string" ? body["occasion"].trim().toLowerCase() : null,
      name: String(body["name"]).trim(), message: typeof body["message"] === "string" ? body["message"] : "",
      lines: body["lines"] as ProposalTemplate["lines"], readable: true,
      createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), updatedByName: "Catherine Tait",
    };
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
    if (path === templatesPath && method === "GET") {
      void route.fulfill({ json: { data: liveTemplates() } });
      return;
    }
    if (path === templatesPath && method === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      const taken = nameTaken(String(body["name"]), null);
      if (taken !== undefined) {
        void route.fulfill({ status: 409, json: { error: "A template already has that name", code: "NAME_TAKEN", details: taken } });
        return;
      }
      const created = keptTemplate(`00000000-0000-4000-8000-0000000f${String(emulator.templates.size + 1).padStart(4, "0")}`, body);
      emulator.templates.set(created.id, created);
      void route.fulfill({ status: 201, json: { data: created } });
      return;
    }
    const templateMatch = /^\/venues\/[0-9a-f-]{36}\/proposal-templates\/([0-9a-f-]{36})(\/restore)?$/u.exec(path);
    if (templateMatch !== null) {
      const id = templateMatch[1] ?? "";
      const stored = emulator.templates.get(id);
      const live = stored !== undefined && !emulator.removedTemplates.has(id);
      if (templateMatch[2] === "/restore" && method === "POST") {
        const taken = stored === undefined ? undefined : nameTaken(stored.name, id);
        if (stored === undefined || live) {
          void route.fulfill({ status: 404, json: { error: "Template not found", code: "NOT_FOUND" } });
        } else if (taken !== undefined) {
          void route.fulfill({ status: 409, json: { error: "A template already has that name", code: "NAME_TAKEN", details: taken } });
        } else {
          emulator.removedTemplates.delete(id);
          void route.fulfill({ json: { data: stored } });
        }
        return;
      }
      if (!live) {
        void route.fulfill({ status: 404, json: { error: "Template not found", code: "NOT_FOUND" } });
        return;
      }
      if (method === "DELETE") {
        emulator.removedTemplates.add(id);
        void route.fulfill({ status: 204, body: "" });
        return;
      }
      if (method === "PATCH") {
        const body = request.postDataJSON() as Record<string, unknown>;
        if (body["expectedUpdatedAt"] !== stored.updatedAt) {
          void route.fulfill({ status: 409, json: { error: "Someone changed this template", code: "TEMPLATE_CHANGED", details: stored } });
          return;
        }
        const replaced = keptTemplate(id, body);
        emulator.templates.set(id, replaced);
        void route.fulfill({ json: { data: replaced } });
        return;
      }
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
      if (rest === "" && method === "PATCH") {
        // As the route: only where the screen showed it, while in hand, and a
        // layout named only if it is their enquiry's own (A10).
        const body = request.postDataJSON() as { configurationId?: string | null; expectedStatus?: string };
        const theirs = current.enquiryLayoutId ?? null;
        if (body.expectedStatus !== undefined && body.expectedStatus !== current.status) {
          void route.fulfill({ status: 409, json: { error: "The proposal changed", code: "PROPOSAL_STATUS_CHANGED" } });
          return;
        }
        if (current.status !== "draft" && current.status !== "changes_requested") {
          void route.fulfill({ status: 422, json: { error: "Proposal is not editable in its current status", code: "NOT_EDITABLE" } });
          return;
        }
        if (typeof body.configurationId === "string" && body.configurationId !== theirs) {
          void route.fulfill({ status: 422, json: { error: "That layout is not the one on their enquiry.", code: "LINK_MISMATCH" } });
          return;
        }
        const configurationId = body.configurationId === undefined ? current.configurationId : body.configurationId;
        const next: DeskProposal = {
          ...current, configurationId, layoutRoomName: configurationId === null ? null : current.enquiryLayoutRoomName ?? null,
          layoutFromEnquiry: configurationId !== null && configurationId === theirs, updatedAt: NOW.toISOString(),
        };
        emulator.proposals.set(id, next);
        void route.fulfill({ json: { data: next } });
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
      if (rest === "/versions/next") {
        // What a save would take beside the words: the same facts, and the
        // drawing as the route finds it against the latest version's, here
        // by whether each carries a layout.
        const facts = { eventDate: current.eventDate, guestCount: current.guestCount, occasion: current.eventType, roomName: "Grand Hall", roomSlug: "grand-hall" };
        const saved = (emulator.versions.get(id) ?? []).at(-1)?.payload.configurationId ?? null;
        const now = current.configurationId;
        const layout = saved === null ? (now === null ? "none" : "added") : now === null ? "removed" : "same";
        void route.fulfill(current.currentVersion < 1 ? { status: 404, json: { error: "No version" } } : { json: { data: {
          basedOn: current.currentVersion, layout, facts: { saved: facts, now: facts }, basis: "0".repeat(64),
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
      if (rest === "/event" && method === "GET") {
        const event: ProposalEvent = world.events?.[id] ?? {
          facts: { eventDate: current.eventDate, guestCount: current.guestCount, occasion: current.eventType, roomName: null, roomSlug: null },
          spaceId: null,
        };
        void route.fulfill({ json: { data: event } });
        return;
      }
    }
    if (path === `/venues/${VENUE_ID}/spaces`) {
      void route.fulfill({ json: { data: world.rooms ?? [] } });
    } else if (path === `/venues/${VENUE_ID}/pricing`) {
      void route.fulfill({ json: { data: emulator.prices } });
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
    await expect(composer.getByTestId("composer-start")).toHaveText("Starts from version 1. Changed: the quote from £18,400 to £17,600.");
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

  test("the proposal says which layout goes out, across the panel, on a desk and on a phone", async ({ page }) => {
    const emulator = await openDesk(page);
    const crawford = emulator.proposals.get(CRAWFORD);
    if (crawford === undefined) throw new Error("Missing the Crawford fixture");
    const theirs = "00000000-0000-4000-8000-00000000c0f1";
    emulator.proposals.set(CRAWFORD, {
      ...crawford, configurationId: theirs, layoutRoomName: "Grand Hall", layoutFromEnquiry: true,
      enquiryLayoutId: theirs, enquiryLayoutRoomName: "Grand Hall",
    });
    // Version 1 was saved carrying their layout.
    const [saved] = emulator.versions.get(CRAWFORD) ?? [];
    if (saved === undefined) throw new Error("Missing the Crawford version");
    emulator.versions.set(CRAWFORD, [{ ...saved, payload: { ...saved.payload, configurationId: theirs } }]);
    await page.goto(`/dashboard?view=proposals&proposal=${CRAWFORD}`);
    const panel = page.getByRole("region", { name: "Crawford wedding proposal" });
    const layout = panel.getByTestId("proposal-layout");
    await expect(layout).toHaveText("Their own, Grand Hall");
    await expect(panel.getByTestId("composer-layout"))
      .toHaveText("Their layout is taken as it stands when you save. Once the version is saved, Preview as the client shows it as they will see it.");
    // It reads across the panel, under the other facts, not squeezed into a column.
    const [fact, facts] = await layout.evaluate((dd) => [
      dd.parentElement?.getBoundingClientRect().width ?? 0, dd.closest("dl")?.getBoundingClientRect().width ?? 1,
    ]);
    expect(fact / facts).toBeGreaterThan(0.9);
    await page.screenshot({ path: test.info().outputPath("proposal-layout-desk.png") });

    // Staff may leave their layout out of the versions saved from now, and
    // include it again (A10), from the keyboard, where focus stays; the facts, the
    // composer and a line on the version Send shares say which goes out.
    const choice = panel.getByTestId("layout-choice");
    await expect(choice).toHaveText("Leave their layout out");
    await expect(panel.getByTestId("layout-saved")).toHaveCount(0);
    await choice.focus();
    await page.keyboard.press("Enter");
    await expect(layout).toHaveText("None");
    await expect(choice).toHaveText("Include their Grand Hall layout");
    await expect(choice).toBeFocused();
    await expect(panel.getByTestId("composer-layout")).toHaveCount(0);
    await expect(panel.getByTestId("layout-saved"))
      .toHaveText("Version 1, the one Send shares, still shows their layout. Save version 2 to send it without.");
    await expect(panel.getByRole("status").filter({ hasText: "Their Grand Hall layout is left out of the versions you save from now." }))
      .toHaveCount(1);
    expect(emulator.proposals.get(CRAWFORD)?.configurationId).toBeNull();
    await page.screenshot({ path: test.info().outputPath("proposal-layout-left-out.png") });
    await page.keyboard.press("Enter");
    await expect(layout).toHaveText("Their own, Grand Hall");
    await expect(choice).toHaveText("Leave their layout out");
    await expect(choice).toBeFocused();
    await expect(panel.getByTestId("layout-saved")).toHaveCount(0);
    expect(emulator.proposals.get(CRAWFORD)?.configurationId).toBe(theirs);

    await page.setViewportSize({ width: 390, height: 844 });
    // The desk becomes one column when the page hears the new width, a moment
    // after it is set: measure once the proposal has replaced the ledger.
    await expect(panel.getByRole("button", { name: "Back to proposals" })).toBeVisible();
    await expect(layout).toBeVisible();
    await expect(choice).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: test.info().outputPath("proposal-layout-phone.png"), fullPage: true });
  });

  test("a price from the venue's list becomes a quote line priced for the event, from the keyboard, on a desk and on a phone", async ({ page }) => {
    const room = (id: string, name: string, slug: string): Record<string, unknown> => ({
      id, venueId: VENUE_ID, name, slug, widthM: "30", lengthM: "15", heightM: "10", floorPlanOutline: [],
    });
    const price = (id: string, spaceId: string | null, name: string, type: string, amount: string): Record<string, unknown> => ({
      id, venueId: VENUE_ID, spaceId, name, type, amount, currency: "GBP", minHours: null, minGuests: null, tiers: null,
      dayOfWeekModifiers: null, seasonalModifiers: null, isActive: true, validFrom: null, validTo: null,
    });
    const GRAND_HALL = "00000000-0000-4000-8000-00000000c001";
    const SALOON = "00000000-0000-4000-8000-00000000c002";
    const emulator = await openDesk(page, 1440, 900, {
      rooms: [room(GRAND_HALL, "Grand Hall", "grand-hall"), room(SALOON, "Saloon", "saloon")],
      prices: [
        price("00000000-0000-4000-8000-00000000b001", GRAND_HALL, "Grand Hall — Evening Event (19:00–00:30)", "flat_rate", "2400.00"),
        price("00000000-0000-4000-8000-00000000b002", SALOON, "Saloon — Evening Event (19:00–00:30)", "flat_rate", "900.00"),
        price("00000000-0000-4000-8000-00000000b003", null, "Exclusive Use of Full Venue", "flat_rate", "2500.00"),
        price("00000000-0000-4000-8000-00000000b004", null, "Drinks reception", "per_head", "12.50"),
      ],
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const problems = watchPageProblems(page);
    await page.goto(`/dashboard?view=proposals&proposal=${CRAWFORD}`);
    const panel = page.getByRole("region", { name: "Crawford wedding proposal" });
    const composer = panel.getByTestId("composer");
    await expect(composer.getByTestId("quote-price-1")).toHaveValue("87.50");

    // The list opens from the keyboard: the event's room first, then any room's.
    const toggle = composer.getByRole("button", { name: "Add from price list" });
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const list = composer.getByRole("region", { name: "Price list" });
    await expect(list.locator(".pr-prices__heading")).toHaveText(["Grand Hall", "Venue-wide"]);
    await expect(list.getByRole("button", { name: /^Saloon/u })).toHaveCount(0);

    // Each pick is a line, said, and the list stays for the next.
    const evening = list.getByRole("button", { name: /^Grand Hall — Evening Event/u });
    await evening.focus();
    await page.keyboard.press("Enter");
    await expect(composer.getByTestId("quote-desc-2")).toHaveValue("Grand Hall — Evening Event (19:00–00:30)");
    await expect(composer.getByTestId("quote-qty-2")).toHaveValue("1");
    await expect(composer.getByTestId("quote-price-2")).toHaveValue("2400");
    await expect(list.getByRole("status").filter({ hasText: "Added" })).toHaveText("Added Grand Hall — Evening Event (19:00–00:30) at £2,400 as line 3.");
    await expect(evening).toBeFocused();
    const drinks = list.getByRole("button", { name: /^Drinks reception/u });
    await expect(drinks).toContainText("£12.50 a head");
    await drinks.focus();
    await page.keyboard.press("Enter");
    // A price a head is for the event's 160 guests; nothing is typed again.
    await expect(composer.getByTestId("quote-qty-3")).toHaveValue("160");
    await expect(composer.getByTestId("quote-price-3")).toHaveValue("12.50");
    await expect(list.getByRole("status").filter({ hasText: "Added" })).toHaveText("Added Drinks reception at £12.50 a head for 160 guests as line 4.");

    // Other rooms' prices wait behind their own button.
    const others = list.getByRole("button", { name: "Other rooms' prices" });
    await others.click();
    await expect(others).toHaveAttribute("aria-expanded", "true");
    await expect(list.locator(".pr-prices__heading")).toHaveText(["Grand Hall", "Venue-wide", "Saloon"]);

    // Read cleanly with the list open: contrast, names, focus and motion.
    const result = await collectAccessibilityAudit(page, {
      name: "proposals desk with the price list open", path: `/dashboard?view=proposals&proposal=${CRAWFORD}`, problems, maxFocusSteps: 16,
    });
    expectAccessibilityAuditClean(result);

    // Escape closes the list and nothing else; focus goes back to its button.
    await list.getByRole("button", { name: /^Exclusive Use of Full Venue/u }).focus();
    await page.keyboard.press("Escape");
    await expect(list).toHaveCount(0);
    await expect(toggle).toBeFocused();
    await expect(panel.getByRole("heading", { level: 2, name: "Crawford wedding proposal" })).toBeVisible();
    // And from its button, opened again (read afresh) and closed at once.
    await page.keyboard.press("Enter");
    await expect(list.getByRole("button", { name: /^Grand Hall — Evening Event/u })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(list).toHaveCount(0);
    await expect(toggle).toBeFocused();
    await expect(panel.getByRole("heading", { level: 2, name: "Crawford wedding proposal" })).toBeVisible();

    await expect(composer.getByTestId("composer-start")).toHaveText("Starts from version 1. Changed: the quote from £18,400 to £22,800.");
    await composer.getByRole("button", { name: "Save version 2" }).click();
    await expect.poll(() => emulator.quotes).toEqual([{ lines: 4, totalMinor: 2_280_000 }]);

    // On a phone each price sits under its name, and nothing scrolls sideways.
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      if (await list.count() === 0) await toggle.click();
      const first = list.getByRole("button", { name: /^Grand Hall — Evening Event/u });
      await expect(first).toBeVisible();
      const name = await first.locator(".pr-price__name").boundingBox();
      const figure = await first.locator(".pr-price__figure").boundingBox();
      if (name === null || figure === null) throw new Error("expected the price's name and figure on screen");
      expect(figure.y, `at ${String(width)} px`).toBeGreaterThanOrEqual(name.y + name.height - 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `at ${String(width)} px`)
        .toBeLessThanOrEqual(0);
    }
  });

  test("a proposal kept as a template starts the next, priced from the list as it stands, from the keyboard, on a desk and on a phone", async ({ page }) => {
    const GRAND_HALL = "00000000-0000-4000-8000-00000000c001";
    const HALL = "00000000-0000-4000-8000-00000000b001";
    const DINNER = "00000000-0000-4000-8000-00000000b002";
    const BAR = "00000000-0000-4000-8000-00000000b003";
    const price = (id: string, spaceId: string | null, name: string, type: string, amount: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
      id, venueId: VENUE_ID, spaceId, name, type, amount, currency: "GBP", minHours: null, minGuests: null, tiers: null,
      dayOfWeekModifiers: null, seasonalModifiers: null, isActive: true, validFrom: null, validTo: null, ...extra,
    });
    const inGrandHall = (eventDate: string, guestCount: number): ProposalEvent => ({
      facts: { eventDate, guestCount, occasion: "wedding", roomName: "Grand Hall", roomSlug: "grand-hall" }, spaceId: GRAND_HALL,
    });
    const emulator = await openDesk(page, 1440, 900, {
      rooms: [{ id: GRAND_HALL, venueId: VENUE_ID, name: "Grand Hall", slug: "grand-hall", widthM: "30", lengthM: "15", heightM: "10", floorPlanOutline: [] }],
      prices: [
        price(HALL, GRAND_HALL, "Grand Hall — Evening Event", "flat_rate", "2400.00"),
        price(DINNER, null, "Dinner", "per_head", "65.00"),
        price(BAR, null, "Late bar", "per_hour", "180.00", { minHours: 3 }),
      ],
      events: { [CRAWFORD]: inGrandHall("2027-06-05", 160), [ROBERTSON]: inGrandHall("2027-07-10", 120) },
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const problems = watchPageProblems(page);
    await page.goto(`/dashboard?view=proposals&proposal=${CRAWFORD}`);
    const composer = page.getByRole("region", { name: "Crawford wedding proposal" }).getByTestId("composer");
    await expect(composer.getByTestId("quote-price-1")).toHaveValue("87.50");

    // Crawford's quote, from the price list and one typed line.
    await composer.getByRole("button", { name: "Remove quote line 2" }).click();
    await composer.getByRole("button", { name: "Remove quote line 1" }).click();
    await composer.getByRole("button", { name: "Add from price list" }).click();
    const prices = composer.getByRole("region", { name: "Price list" });
    await prices.getByRole("button", { name: /^Grand Hall — Evening Event/u }).click();
    await prices.getByRole("button", { name: /^Dinner/u }).click();
    await prices.getByRole("button", { name: /^Late bar/u }).click();
    await composer.getByTestId("quote-qty-2").fill("4");
    await prices.getByRole("button", { name: "Done" }).click();
    await composer.getByTestId("add-quote-line").click();
    await composer.getByTestId("quote-desc-3").fill("Piper");
    await composer.getByTestId("quote-price-3").fill("250");
    await composer.getByTestId("composer-message").fill("Thank you for thinking of the Grand Hall.");

    // Kept as a template, from the keyboard: named for the event's room and occasion.
    const keep = composer.getByRole("button", { name: "Save as template" });
    await keep.focus();
    await page.keyboard.press("Enter");
    const form = composer.getByTestId("template-save");
    await expect(form.getByLabel("Name")).toHaveValue("Grand Hall wedding");
    await expect(form.getByLabel("Room")).toHaveValue(GRAND_HALL);
    await expect(form.getByLabel("Occasion")).toHaveValue("wedding");
    await expect(form.getByTestId("template-kept")).toContainText(
      "From the price list, priced each time it is used: Grand Hall — Evening Event; Dinner, for the event's guests; Late bar, 4 hours.");
    await expect(form.getByTestId("template-kept")).toContainText("Typed, with the price entered each time: Piper.");
    await page.screenshot({ path: test.info().outputPath("template-save-desk.png") });
    await form.getByRole("button", { name: "Save template" }).focus();
    await page.keyboard.press("Enter");
    await expect(composer.getByTestId("template-save-said")).toHaveText("Saved the template Grand Hall wedding.");
    await expect(keep).toBeFocused();
    expect([...emulator.templates.values()].map((template) => template.lines.map((line) => line.kind))).toEqual([
      ["price_list", "price_list", "price_list", "typed"],
    ]);

    // The list changes: the hall costs more and the late bar is withdrawn.
    emulator.prices = [price(HALL, GRAND_HALL, "Grand Hall — Evening Event", "flat_rate", "2600.00"), price(DINNER, null, "Dinner", "per_head", "65.00")];

    // The spring gala's first version starts from it.
    await page.goto(`/dashboard?view=proposals&proposal=${ROBERTSON}`);
    const gala = page.getByRole("region", { name: "Spring gala proposal" }).getByTestId("composer");
    const start = gala.getByRole("button", { name: "Start from a template" });
    await start.focus();
    await page.keyboard.press("Enter");
    const templates = gala.getByRole("region", { name: "Templates" });
    await expect(templates.locator(".pr-prices__heading")).toHaveText(["For this event"]);
    await expect(templates.locator(".pr-template").first()).toContainText("Grand Hall · Wedding");
    const audit = await collectAccessibilityAudit(page, {
      name: "proposals desk with the templates open", path: `/dashboard?view=proposals&proposal=${ROBERTSON}`, problems, maxFocusSteps: 16,
    });
    expectAccessibilityAuditClean(audit);
    await templates.getByRole("button", { name: "Use Grand Hall wedding" }).focus();
    await page.keyboard.press("Enter");

    // Priced as the list stands, for this event's 120 guests; what could not be used is said.
    await expect(gala.getByTestId("composer-message")).toHaveValue("Thank you for thinking of the Grand Hall.");
    await expect(gala.getByTestId("quote-desc-0")).toHaveValue("Grand Hall — Evening Event");
    await expect(gala.getByTestId("quote-price-0")).toHaveValue("2600");
    await expect(gala.getByTestId("quote-qty-1")).toHaveValue("120");
    await expect(gala.getByTestId("quote-desc-2")).toHaveValue("Piper");
    const said = gala.getByTestId("template-said");
    await expect(said).toContainText("Started from Grand Hall wedding: the message and 3 of its 4 lines.");
    await expect(said).toContainText("No longer on the price list: Late bar.");
    await expect(said).toContainText("Enter the price for Piper (line 3).");
    await expect(gala.getByTestId("quote-price-2")).toBeFocused();
    await page.screenshot({ path: test.info().outputPath("template-started-desk.png") });
    await page.keyboard.type("250");
    await gala.getByRole("button", { name: "Save version 1" }).click();
    await expect.poll(() => emulator.quotes).toEqual([{ lines: 3, totalMinor: 1_065_000 }]);

    // On a phone the templates fit, and nothing scrolls sideways.
    await page.goto(`/dashboard?view=proposals&proposal=${ROBERTSON}`);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      const again = page.getByRole("region", { name: "Spring gala proposal" }).getByTestId("composer");
      const toggle = again.getByRole("button", { name: "Start from a template" });
      if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
      await expect(again.getByRole("button", { name: "Use Grand Hall wedding" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `at ${String(width)} px`)
        .toBeLessThanOrEqual(0);
      await page.screenshot({ path: test.info().outputPath(`templates-phone-${String(width)}.png`), fullPage: true });
    }
  });

  test("a template over words already written adds only what is new or keeps them to copy, and a removed one comes back with Undo", async ({ page }) => {
    const GRAND_HALL = "00000000-0000-4000-8000-00000000c001";
    const DINNER = "00000000-0000-4000-8000-00000000b002";
    const WEDDING = "00000000-0000-4000-8000-0000000f0001";
    const emulator = await openDesk(page, 1440, 900, {
      rooms: [{ id: GRAND_HALL, venueId: VENUE_ID, name: "Grand Hall", slug: "grand-hall", widthM: "30", lengthM: "15", heightM: "10", floorPlanOutline: [] }],
      prices: [{
        id: DINNER, venueId: VENUE_ID, spaceId: null, name: "Dinner", type: "per_head", amount: "65.00", currency: "GBP", minHours: null,
        minGuests: null, tiers: null, dayOfWeekModifiers: null, seasonalModifiers: null, isActive: true, validFrom: null, validTo: null,
      }],
      templates: [{
        id: WEDDING, venueId: VENUE_ID, spaceId: GRAND_HALL, roomName: "Grand Hall", roomListed: true, occasion: "wedding", name: "Grand Hall wedding",
        message: "Thank you for thinking of the Grand Hall.",
        lines: [{ kind: "price_list", pricingRuleId: DINNER, name: "Dinner", ruleType: "per_head", quantity: null }, { kind: "typed", description: "Piper", quantity: 1 }],
        readable: true, createdAt: "2026-10-01T09:00:00.000Z", updatedAt: "2026-10-01T09:00:00.000Z", updatedByName: "Anna Reid",
      }],
      events: { [CRAWFORD]: { facts: { eventDate: "2027-06-05", guestCount: 160, occasion: "wedding", roomName: "Grand Hall", roomSlug: "grand-hall" }, spaceId: GRAND_HALL } },
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const problems = watchPageProblems(page);
    await page.goto(`/dashboard?view=proposals&proposal=${CRAWFORD}`);
    const panel = page.getByRole("region", { name: "Crawford wedding proposal" });
    const composer = panel.getByTestId("composer");
    await expect(composer.getByTestId("quote-price-1")).toHaveValue("87.50");
    const start = composer.getByRole("button", { name: "Start from a template" });
    const templates = composer.getByRole("region", { name: "Templates" });

    // Over the words carried from version 1, it asks first. Escape takes back
    // the question, then closes the list, and focus returns to its button.
    await start.click();
    await expect(templates.getByTestId(`template-${WEDDING}`)).toContainText("Saved by Anna Reid");
    // From the keyboard, focus goes to the question, so it is heard.
    await templates.getByRole("button", { name: "Use Grand Hall wedding" }).focus();
    await page.keyboard.press("Enter");
    const choice = templates.getByTestId("template-choice");
    await expect(choice.getByTestId("template-question")).toBeFocused();
    await expect(choice.getByRole("button", { name: "Replace them" })).toBeVisible();
    await expect(choice.getByRole("button", { name: "Add its lines" })).toBeVisible();
    const audit = await collectAccessibilityAudit(page, {
      name: "proposals desk asking before a template replaces words", path: `/dashboard?view=proposals&proposal=${CRAWFORD}`, problems, maxFocusSteps: 16,
    });
    expectAccessibilityAuditClean(audit);
    await choice.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath("template-choice-desk.png") });
    await choice.getByRole("button", { name: "Replace them" }).focus();
    await page.keyboard.press("Escape");
    await expect(choice).toHaveCount(0);
    await expect(templates).toBeVisible();
    await templates.getByRole("button", { name: "Use Grand Hall wedding" }).focus();
    await page.keyboard.press("Escape");
    await expect(templates).toHaveCount(0);
    await expect(start).toBeFocused();

    // Adding its lines keeps the message and every line there, and skips the dinner already quoted.
    await start.click();
    await templates.getByRole("button", { name: "Use Grand Hall wedding" }).click();
    await templates.getByRole("button", { name: "Add its lines" }).click();
    await expect(composer.getByTestId("quote-desc-2")).toHaveValue("Piper");
    await expect(composer.getByTestId("quote-price-1")).toHaveValue("87.50");
    await expect(composer.getByTestId("template-said")).toContainText("Added 1 of Grand Hall wedding's 2 lines.");
    await expect(composer.getByTestId("template-said")).toContainText("Already in the quote, so not added again: Dinner.");
    await expect(composer.getByTestId("quote-price-2")).toBeFocused();

    // Replacing them keeps what was written to copy, beside a composer the template starts.
    await start.click();
    await templates.getByRole("button", { name: "Use Grand Hall wedding" }).click();
    await templates.getByRole("button", { name: "Replace them" }).click();
    const fresh = panel.getByTestId("composer");
    await expect(fresh.getByTestId("composer-message")).toHaveValue("Thank you for thinking of the Grand Hall.");
    await expect(fresh.getByTestId("quote-desc-0")).toHaveValue("Dinner");
    await expect(fresh.getByTestId("quote-price-0")).toHaveValue("65");
    await expect(fresh.getByTestId("quote-qty-0")).toHaveValue("160");
    await expect(fresh.getByTestId("quote-desc-1")).toHaveValue("Piper");
    const kept = panel.getByTestId("kept-version");
    await expect(kept.getByTestId("kept-version-why")).toHaveText("You started from Grand Hall wedding.");
    await expect(kept).toContainText("Grand Hall hire · 1 × £4400");
    await expect(fresh.getByTestId("quote-price-1")).toBeFocused();
    await page.screenshot({ path: test.info().outputPath("template-replaced-desk.png"), fullPage: true });

    // Removed for everyone at the venue, then back with Undo.
    await fresh.getByRole("button", { name: "Start from a template" }).click();
    const list = fresh.getByRole("region", { name: "Templates" });
    await list.getByRole("button", { name: "Remove Grand Hall wedding" }).click();
    await expect(list.getByTestId("templates-said")).toHaveText("Removed Grand Hall wedding for everyone at the venue.");
    await expect(list.getByTestId("templates-empty")).toBeVisible();
    expect(emulator.removedTemplates.has(WEDDING)).toBe(true);
    await list.getByRole("button", { name: "Undo" }).click();
    await expect(list.getByTestId("templates-said")).toHaveText("Grand Hall wedding is back.");
    await expect(list.getByRole("button", { name: "Use Grand Hall wedding" })).toBeVisible();
    expect(emulator.removedTemplates.has(WEDDING)).toBe(false);

    // On a phone the question fits, and nothing scrolls sideways.
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await list.getByRole("button", { name: "Use Grand Hall wedding" }).click();
      await expect(list.getByTestId("template-choice")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `at ${String(width)} px`)
        .toBeLessThanOrEqual(0);
      await page.screenshot({ path: test.info().outputPath(`template-choice-phone-${String(width)}.png`), fullPage: true });
      await list.getByRole("button", { name: "Cancel" }).click();
    }
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
