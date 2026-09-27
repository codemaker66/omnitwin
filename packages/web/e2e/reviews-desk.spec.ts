import { expect, test, type Page } from "@playwright/test";
import { VALID_CONFIGURATION_REVIEW_TRANSITIONS, type ConfigurationReviewStatus } from "@omnitwin/types";
import type { PendingReviewEntry, ReviewHistoryEntry } from "../src/api/configuration-reviews.js";

// ---------------------------------------------------------------------------
// E2E: the Layout reviews desk (roadmap X2).
//
// The review API is emulated in memory over the real state machine: each
// review's gates are the transitions `@omnitwin/types` allows from where it
// stands (a staff reviewer holds every venue and submitter edge), a move the
// machine forbids is refused with the API's 409, and every move is written to
// the review's timeline. Nothing about a transition is mocked per test.
// ---------------------------------------------------------------------------

const API = "http://localhost:3001";
const VENUE_ID = "00000000-0000-4000-8000-000000009201";
const ROOM_ID = "00000000-0000-4000-8000-000000009202";
const STAFF_ID = "00000000-0000-4000-8000-000000009291";
const PLANNER_ID = "00000000-0000-4000-8000-000000009292";
const WEDDING_ID = "00000000-0000-4000-8000-000000009211";
const DINNER_ID = "00000000-0000-4000-8000-000000009212";
const BALL_ID = "00000000-0000-4000-8000-000000009213";
/** 13:00 in Glasgow on Saturday 3 October 2026. */
const NOW = new Date("2026-10-03T12:00:00.000Z");

const VENUE = {
  id: VENUE_ID, name: "Trades Hall Glasgow", slug: "trades-hall", address: "85 Glassford Street",
  logoUrl: null, brandColour: null, timezone: "Europe/London",
  spaces: [{ id: ROOM_ID, venueId: VENUE_ID, name: "Grand Hall", slug: "grand-hall",
    widthM: "21", lengthM: "10.5", heightM: "7", floorPlanOutline: [] }],
};

interface EmulatedReview {
  entry: PendingReviewEntry;
  history: ReviewHistoryEntry[];
}

interface ReviewEmulator {
  readonly reviews: Map<string, EmulatedReview>;
  readonly moves: { readonly id: string; readonly to: string; readonly body: unknown }[];
}

const PENDING = new Set<ConfigurationReviewStatus>(["submitted", "under_review", "changes_requested"]);
const MOVE_PATHS: Readonly<Record<string, ConfigurationReviewStatus>> = {
  "start-review": "under_review",
  approve: "approved",
  "request-changes": "changes_requested",
  reject: "rejected",
  withdraw: "withdrawn",
};

function review(id: string, name: string, status: ConfigurationReviewStatus, submittedAt: string, eventStartsAt: string | null): EmulatedReview {
  const history: ReviewHistoryEntry[] = [{
    id: `${id.slice(0, -4)}a001`, configurationId: id, fromStatus: "draft", toStatus: "submitted",
    changedByName: "Fiona Grant", note: null, createdAt: submittedAt,
  }];
  if (status === "under_review") {
    history.push({ id: `${id.slice(0, -4)}a002`, configurationId: id, fromStatus: "submitted", toStatus: "under_review",
      changedByName: "Catherine Tait", note: null, createdAt: "2026-10-03T08:14:00.000Z" });
  }
  return {
    entry: {
      id, name, venueId: VENUE_ID, spaceId: ROOM_ID, userId: PLANNER_ID, reviewStatus: status,
      submittedAt, updatedAt: submittedAt, guestCount: 160, spaceName: "Grand Hall", plannerName: "Fiona Grant",
      eventStartsAt, stageSince: history.at(-1)?.createdAt ?? submittedAt, stageByName: history.at(-1)?.changedByName ?? null,
    },
    history,
  };
}

function snapshot(id: string, name: string) {
  return {
    id: `${id.slice(0, -4)}b001`, configurationId: id, version: 1,
    payload: {
      config: { id, name, guestCount: 160, layoutStyle: "dinner-rounds" },
      venue: { name: "Trades Hall Glasgow", address: "85 Glassford Street", logoUrl: null, timezone: "Europe/London" },
      space: { name: "Grand Hall", widthM: 21, lengthM: 10.5, heightM: 7 },
      timing: null, instructions: null, phases: [],
      totals: { entries: [{ name: "Round table", category: "table", qty: 16 }, { name: "Banquet chair", category: "chair", qty: 160 }], totalRows: 2, totalItems: 176 },
      diagramUrl: null,
      floorPlan: {
        coordinateSpace: "real_m_v1",
        outline: [{ x: 0, z: 0 }, { x: 21, z: 0 }, { x: 21, z: 10.5 }, { x: 0, z: 10.5 }],
        objects: Array.from({ length: 8 }, (_, index) => ({
          objectId: `00000000-0000-4000-8000-0000000093${String(10 + index)}`,
          assetDefinitionId: "00000000-0000-4000-8000-000000009399",
          name: "Round table", category: "table", x: 3 + (index % 4) * 5, z: 3 + Math.floor(index / 4) * 4.5,
          rotationY: 0, scale: 1, widthM: 1.8, depthM: 1.8, collisionType: "cylinder",
        })),
      },
      webViewUrl: `http://localhost:5173/hallkeeper/${id}`, generatedAt: "2026-10-01T09:00:00.000Z", approval: null,
    },
    diagramUrl: null, pdfUrl: null, sourceHash: "c".repeat(64), createdAt: "2026-10-01T09:00:00.000Z",
    createdBy: null, approvedAt: null, approvedBy: null,
  };
}

async function openDesk(page: Page, viewers: readonly string[] = []): Promise<ReviewEmulator> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(({ venueId, staffId }) => {
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true, writable: false });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", {
      value: { id: staffId, email: "catherine@reviews.test", role: "staff", platformRole: "none", venueId, name: "Catherine Tait" },
      writable: false,
    });
  }, { venueId: VENUE_ID, staffId: STAFF_ID });

  const emulator: ReviewEmulator = {
    reviews: new Map([
      [WEDDING_ID, review(WEDDING_ID, "Anderson wedding reception", "submitted", "2026-10-02T15:00:00.000Z", "2027-06-05T13:00:00.000Z")],
      [DINNER_ID, review(DINNER_ID, "Merchants' dinner", "submitted", "2026-10-03T09:30:00.000Z", "2026-11-20T18:30:00.000Z")],
      [BALL_ID, review(BALL_ID, "Hogmanay ball", "under_review", "2026-10-01T10:00:00.000Z", "2026-12-31T19:00:00.000Z")],
    ]),
    moves: [],
  };

  await page.route(`${API}/**`, (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === "/configurations/reviews/pending") {
      const entries = [...emulator.reviews.values()].filter((item) => PENDING.has(item.entry.reviewStatus)).map((item) => item.entry);
      void route.fulfill({ json: { data: { entries } } });
      return;
    }
    const match = /^\/configurations\/([0-9a-f-]{36})\/(review\/[a-z-/]+|snapshot\/latest)$/u.exec(path);
    const item = match === null ? undefined : emulator.reviews.get(match[1] ?? "");
    if (match !== null && item !== undefined) {
      const [, id = "", rest = ""] = match;
      if (rest === "review/history") {
        void route.fulfill({ json: { data: { configurationId: id, entries: item.history } } });
      } else if (rest === "review/available-transitions") {
        void route.fulfill({ json: { data: {
          configurationId: id, currentStatus: item.entry.reviewStatus,
          availableTransitions: VALID_CONFIGURATION_REVIEW_TRANSITIONS[item.entry.reviewStatus], internalDemoReviewEligible: false,
        } } });
      } else if (rest === "snapshot/latest") {
        void route.fulfill({ json: { data: snapshot(id, item.entry.name) } });
      } else if (rest === "review/viewers/heartbeat") {
        void route.fulfill({ json: { data: { ok: true } } });
      } else if (rest === "review/viewers") {
        void route.fulfill({ json: { data: { configurationId: id,
          viewers: viewers.map((displayName, index) => ({ userId: `00000000-0000-4000-8000-00000000948${String(index)}`, displayName, lastSeenAt: NOW.toISOString() })) } } });
      } else if (rest === "review/viewers/self") {
        void route.fulfill({ status: 204 });
      } else {
        const to = MOVE_PATHS[rest.replace("review/", "")];
        if (to === undefined || request.method() !== "POST") {
          void route.fulfill({ status: 404, json: { error: `Not emulated: ${path}` } });
          return;
        }
        const from = item.entry.reviewStatus;
        if (!VALID_CONFIGURATION_REVIEW_TRANSITIONS[from].includes(to)) {
          void route.fulfill({ status: 409, json: { error: `Cannot move from ${from} to ${to}`, code: "INVALID_TRANSITION" } });
          return;
        }
        const body: unknown = request.postDataJSON();
        const note = typeof body === "object" && body !== null && "note" in body && typeof body.note === "string" ? body.note : null;
        emulator.moves.push({ id, to, body });
        const at = NOW.toISOString();
        item.history.push({ id: `${id.slice(0, -4)}c${String(item.history.length).padStart(3, "0")}`, configurationId: id,
          fromStatus: from, toStatus: to, changedByName: "Catherine Tait", note, createdAt: at });
        item.entry = { ...item.entry, reviewStatus: to, updatedAt: at, stageSince: at, stageByName: "Catherine Tait" };
        void route.fulfill({ json: { data: to === "approved"
          ? { reviewStatus: to, notificationPolicy: "team_requested", snapshot: snapshot(id, item.entry.name) }
          : { reviewStatus: to } } });
      }
      return;
    }
    if (path === `/venues/${VENUE_ID}` || path === "/venues") {
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

function queueRow(page: Page, name: string) {
  return page.locator(`button[data-review-id][aria-label^="${name},"]`);
}

test.describe("Layout reviews desk", () => {
  test("a reviewer triages three layouts with the keyboard alone, deciding each without opening a tab", async ({ page, context }) => {
    const emulator = await openDesk(page);
    const pagesOpened: string[] = [];
    context.on("page", (opened) => { pagesOpened.push(opened.url()); });

    await page.goto("/dashboard?view=reviews");
    await expect(page.getByRole("main")).toHaveAccessibleName("Pending reviews");
    await expect(page.getByRole("button", { name: "To start, 2" })).toBeVisible();
    await expect(page.getByRole("button", { name: "In review, 1" })).toBeVisible();
    const wedding = queueRow(page, "Anderson wedding reception");
    await expect(wedding).toHaveAttribute("tabindex", "0");
    await wedding.focus();

    // The first layout: open it, start the review, approve it.
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 2, name: "Anderson wedding reception" })).toBeFocused();
    await expect(page).toHaveURL(new RegExp(`review=${WEDDING_ID}`, "u"));
    // The steps arrive with the review's gates; the reader tabs to them once shown.
    await expect(page.getByRole("button", { name: "Start review" })).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Start review" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Approve…" })).toBeFocused();
    await expect(page.getByTestId("review-claim")).toHaveText("In review with you since 13:00");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("approve-consequence")).toHaveText("Approving emails the planner and your venue's hallkeepers.");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Approve and email" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Approved. The planner and your hallkeepers are being emailed.")).toBeVisible();
    await expect(queueRow(page, "Anderson wedding reception")).toHaveCount(0);

    // The next layout: send it back to its planner with a note.
    await expect(page.getByRole("button", { name: "Open the next review" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 2, name: "Merchants' dinner" })).toBeFocused();
    await expect(page.getByRole("button", { name: "Start review" })).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Start review" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Approve…" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Ask for changes…" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("What needs to change")).toBeFocused();
    await page.keyboard.type("Keep the 1.2 m route clear beside the main doors.");
    await page.keyboard.press("Control+Enter");
    await expect(page.getByText("Back with Fiona Grant for changes. It returns to To start when it is submitted again.")).toBeVisible();
    await expect(queueRow(page, "Merchants' dinner")).toHaveAttribute("aria-label", /With planner/u);

    // The third, already in review: j carries on down the queue from here.
    await page.keyboard.press("j");
    await expect(page.getByRole("heading", { level: 2, name: "Hogmanay ball" })).toBeFocused();
    await expect(page.getByRole("button", { name: "Approve…" })).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Approve…" })).toBeFocused();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Approve and email" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Approved. The planner and your hallkeepers are being emailed.")).toBeVisible();
    await expect(page.getByText("Nothing else is waiting on you.")).toBeVisible();

    expect(emulator.moves.map((move) => `${move.id === WEDDING_ID ? "wedding" : move.id === DINNER_ID ? "dinner" : "ball"}:${move.to}`)).toEqual([
      "wedding:under_review", "wedding:approved", "dinner:under_review", "dinner:changes_requested", "ball:approved",
    ]);
    expect(emulator.moves.find((move) => move.to === "changes_requested")?.body).toEqual({ note: "Keep the 1.2 m route clear beside the main doors." });
    await expect(page.getByTestId("reviews-summary")).toHaveText("Nothing is waiting to be started. 1 layout with its planner for changes.");
    // Every decision was made here: no tab or window opened.
    expect(pagesOpened).toEqual([]);
    expect(context.pages()).toHaveLength(1);
  });

  test("the open review survives a reload through its address, and a colleague looking at it reads at 4.5:1 or better", async ({ page }) => {
    await openDesk(page, ["Ross Kerr"]);
    await page.goto(`/dashboard?view=reviews&review=${DINNER_ID}`);
    await expect(page.getByRole("heading", { level: 2, name: "Merchants' dinner" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { level: 2, name: "Merchants' dinner" })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`review=${DINNER_ID}`, "u"));
    await expect(queueRow(page, "Merchants' dinner")).toHaveAttribute("aria-current", "true");

    const presence = page.getByTestId("review-presence");
    await expect(presence).toHaveText("Ross Kerr is looking at this too.");
    const ratio = await presence.evaluate((element) => {
      const channel = (value: number): number => {
        const c = value / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      const rgb = (css: string): [number, number, number] => {
        const parts = /rgba?\(([^)]+)\)/u.exec(css)?.[1]?.split(",").map((part) => Number.parseFloat(part)) ?? [];
        return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
      };
      const luminance = ([r, g, b]: [number, number, number]): number => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      let ground: Element | null = element;
      while (ground !== null && /rgba?\(0, 0, 0, 0\)|transparent/u.test(getComputedStyle(ground).backgroundColor)) ground = ground.parentElement;
      const text = luminance(rgb(getComputedStyle(element).color));
      const back = luminance(rgb(ground === null ? "rgb(255, 255, 255)" : getComputedStyle(ground).backgroundColor));
      return (Math.max(text, back) + 0.05) / (Math.min(text, back) + 0.05);
    });
    expect(ratio).toBeGreaterThanOrEqual(4.5);

    // Closing the review takes it out of the address.
    await page.getByRole("button", { name: "Close review" }).click();
    await expect(page).not.toHaveURL(/review=/u);
    await expect(page.getByRole("complementary", { name: "Queue overview" })).toBeVisible();
  });
});
