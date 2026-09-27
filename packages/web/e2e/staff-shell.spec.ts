import { expect, test } from "@playwright/test";

// ---------------------------------------------------------------------------
// E2E: the persistent staff shell (roadmap N2).
//
// The header is drawn once and stays while the staff pages beneath it change:
// from the Enquiries desk to the Diary to the Day Board it is the same
// element, its unread count is read once and never leaves the row, and after
// the first load it never says it is waiting for the venue. Each workspace
// is named after its page. The API and its live channels are emulated.
// ---------------------------------------------------------------------------

const API = "http://localhost:3001";
const VENUE_ID = "00000000-0000-4000-8000-000000008201";
const ROOM_ID = "00000000-0000-4000-8000-000000008202";
const STAFF_ID = "00000000-0000-4000-8000-000000008291";
/** 13:00 in Glasgow on Saturday 3 October 2026. */
const NOW = new Date("2026-10-03T12:00:00.000Z");

const VENUE = {
  id: VENUE_ID, name: "Trades Hall Glasgow", slug: "trades-hall", address: "85 Glassford Street",
  logoUrl: null, brandColour: null, timezone: "Europe/London",
  spaces: [{ id: ROOM_ID, venueId: VENUE_ID, name: "Grand Hall", slug: "grand-hall",
    widthM: "21", lengthM: "10.5", heightM: "7", floorPlanOutline: [] }],
};

declare global {
  interface Window {
    /** Every wait for the venue the header showed after the first load. */
    __venueWaits?: string[];
  }
}

test.describe("Staff shell", () => {
  test("keeps one header from the Enquiries desk to the Diary and the Day Board, and never waits for the venue again", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.clock.setFixedTime(NOW);
    await page.addInitScript(({ venueId, staffId }) => {
      Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true, writable: false });
      Object.defineProperty(window, "__OMNITWIN_SEED_USER__", {
        value: { id: staffId, email: "staff@shell.test", role: "staff", platformRole: "none", venueId, name: "Staff Shell" },
        writable: false,
      });
      window.localStorage.setItem(`venviewer:diary-welcome-seen:${staffId}`, "1");
    }, { venueId: VENUE_ID, staffId: STAFF_ID });
    let unreadReads = 0;
    await page.route(`${API}/**`, (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/enquiries") {
        void route.fulfill({ json: { data: [], meta: { total: 0, limit: 20, offset: 0, order: "created_desc" } } });
      } else if (url.pathname === "/calendar") {
        const from = url.searchParams.get("from") ?? NOW.toISOString();
        const to = url.searchParams.get("to") ?? NOW.toISOString();
        void route.fulfill({ json: { data: {
          venueId: VENUE_ID, range: { from, to },
          rooms: [{ id: ROOM_ID, name: "Grand Hall", slug: "grand-hall", sortOrder: 0 }],
          entries: [],
          conflicts: { conflicts: [], checks: {
            inkDoubleBook: { status: "checked" }, holdOverlap: { status: "checked" },
            turnaround: { status: "checked", uncoveredPairCount: 0, detail: "Every gap is covered by a turnaround rule." },
          } },
          turnaroundRules: [], decisionsDue: { holds: [], total: 0 }, nextActionsDue: { holds: [], total: 0 },
          contested: { dates: [], total: 0 },
        } } });
      } else if (url.pathname === `/venues/${VENUE_ID}` || url.pathname === "/venues") {
        void route.fulfill({ json: { data: url.pathname === "/venues" ? [VENUE] : VENUE } });
      } else if (url.pathname === `/venues/${VENUE_ID}/requests`) {
        void route.fulfill({ json: { data: [] } });
      } else if (url.pathname === "/notifications/unread-count") {
        unreadReads += 1;
        void route.fulfill({ json: { data: { unread: 2 } } });
      } else if (url.pathname.startsWith("/notifications")) {
        void route.fulfill({ json: { data: [] } });
      } else {
        void route.fulfill({ status: 404, json: { error: `Not emulated: ${url.pathname}` } });
      }
    });
    await page.routeWebSocket(/\/ws\//u, (ws) => {
      ws.onMessage((raw) => {
        const message = JSON.parse(String(raw)) as { type: string };
        if (message.type === "auth") ws.send(JSON.stringify({ type: "hello", venueId: VENUE_ID, presence: [] }));
      });
    });

    await page.goto("/dashboard?view=enquiries");
    const header = page.locator("header.dashboard-layout-header");
    await expect(header.locator(".dashboard-layout-title")).toHaveText("Trades Hall Glasgow");
    const unread = page.getByTestId("nav-unread-notifications");
    await expect(unread).toBeVisible();
    await expect(page.getByRole("main")).toHaveAccessibleName("Enquiries");
    const handle = await header.elementHandle();
    expect(handle).not.toBeNull();
    // Development's strict mode reads twice on the first mount; what matters
    // is that moving between pages reads nothing more.
    const readsOnArrival = unreadReads;
    expect(readsOnArrival).toBeGreaterThan(0);
    // From here on, the header never says it is waiting for the venue.
    await page.evaluate(() => {
      const waits: string[] = [];
      window.__venueWaits = waits;
      new MutationObserver(() => {
        const text = document.querySelector("header.dashboard-layout-header")?.textContent ?? "";
        for (const word of ["Your venue", "Opening venue…"]) if (text.includes(word)) waits.push(word);
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });

    await header.getByRole("link", { name: "Diary" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "The Diary" })).toBeVisible();
    await expect(page.getByRole("main")).toHaveAccessibleName("The Diary");
    await expect(page).toHaveTitle("The Diary · Trades Hall Glasgow — Venviewer");
    expect(await handle?.evaluate((element) => element.isConnected)).toBe(true);
    await expect(unread).toBeVisible();

    await header.getByRole("link", { name: "Hallkeeper" }).click();
    await expect(page).toHaveURL(/\/hallkeeper\/today$/u);
    await expect(page.getByRole("main")).toHaveAccessibleName("The Day Board");
    expect(await handle?.evaluate((element) => element.isConnected)).toBe(true);
    await expect(unread).toBeVisible();

    expect(await page.evaluate(() => window.__venueWaits)).toEqual([]);
    // The count read on arrival serves the whole journey: no page reads it again.
    expect(unreadReads).toBe(readsOnArrival);
  });
});
