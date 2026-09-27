import { expect, test, type Page, type Route } from "@playwright/test";
import { EventDayIssueSchema, EventDayOpsBoardSchema, OpsTaskSchema, type EventDayOpsBoard } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// E2E: the event-day board without a connection (/ops/events/:id), roadmap N4.
//
// A hallkeeper loses the venue's wifi mid-setup. Marking a task done and
// logging an issue both keep on the device and say so, the header counts
// what waits, and when the connection returns each write reaches the server
// once and the board reads Synced. The API is intercepted before transport,
// and interception answers even an offline context, so while the phone is
// offline the fixture drops every API request as the network would; the
// context goes offline too, so the page hears the browser's own events.
// ---------------------------------------------------------------------------

const API = "http://localhost:3001";
const NOW = "2026-10-03T12:00:00.000Z";
const VENUE = "20000000-0000-4000-8000-000000000002";
const EVENT = "20000000-0000-4000-8000-000000000301";
const PACK = "20000000-0000-4000-8000-000000000302";
const TASK = "20000000-0000-4000-8000-000000000303";
const uuid = (n: number): string => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const HASH = "d".repeat(64);

function boardWith(taskStatus: "todo" | "done", issues: readonly unknown[]): EventDayOpsBoard {
  return EventDayOpsBoardSchema.parse({
    event: {
      id: EVENT, venueId: VENUE, createdBy: null, name: "Hammermen dinner", eventType: "dinner", status: "ready_for_ops",
      startsAt: NOW, endsAt: null, guestCount: 180, clientName: null, notes: null, createdAt: NOW, updatedAt: NOW,
    },
    phases: [],
    handoffPack: {
      pack: {
        id: PACK, eventId: EVENT, configId: uuid(304), snapshotId: uuid(305), snapshotHash: HASH, version: 2, status: "compiled",
        sourceLabel: "Approved configuration snapshot v2", summary: "Grand Hall dinner handoff.", createdBy: null, compiledAt: NOW, updatedAt: NOW,
      },
      taskGroups: [],
      opsTasks: [{
        id: TASK, handoffPackId: PACK, taskGroupId: null, phaseId: null, kind: "setup", title: "Set 18 round tables",
        detail: "From the approved Grand Hall dinner layout.", status: taskStatus, sortOrder: 0, dueLabel: "Before doors",
        sourceRef: "handoff-pack-v2", createdAt: NOW, updatedAt: NOW,
      }],
      furniturePickList: { id: uuid(306), handoffPackId: PACK, title: "Pick list", totalItems: 18, createdAt: NOW },
      pickListItems: [],
      supplierInstructions: [],
      loadInSequence: [],
      breakdownSequence: [],
      roomFlipPlans: [],
      beoDocument: {
        id: uuid(307), handoffPackId: PACK, title: "BEO", body: "Internal operations handoff.", sourceSnapshotHash: HASH,
        safeStatus: "internal_operations_handoff", createdAt: NOW,
      },
      snapshotDiff: {
        id: uuid(308), handoffPackId: PACK, previousSnapshotHash: null, currentSnapshotHash: HASH, addedCount: 0, removedCount: 0,
        changedCount: 0, summary: "No changes.", payload: { added: [], removed: [], changed: [] }, createdAt: NOW,
      },
    },
    assignments: [],
    issues,
    statusUpdates: [],
    setupProgress: { totalTasks: 1, doneTasks: taskStatus === "done" ? 1 : 0, blockedTasks: 0, activeTasks: taskStatus === "done" ? 0 : 1, percent: taskStatus === "done" ? 100 : 0 },
    supplierArrivals: [],
    escalationNotes: [],
    changesSinceLastHandoff: {
      handoffPackId: PACK, summary: "No changes.", added: [], removed: [], changed: [], currentSnapshotHash: HASH, previousSnapshotHash: null,
    },
    sourceStatus: "ready",
  });
}

interface Network {
  readonly taskWrites: string[];
  readonly issueWrites: string[];
  /** While true, every API request fails as a dropped connection would. */
  offline: boolean;
}

async function openBoard(page: Page): Promise<Network> {
  const taskWrites: string[] = [];
  const issueWrites: string[] = [];
  let taskStatus: "todo" | "done" = "todo";
  const issues: unknown[] = [];
  await page.addInitScript((venueId) => {
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true, writable: false });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", {
      value: { id: "e2e-user-hallkeeper", email: "hallkeeper@e2e.test", role: "hallkeeper", venueId, name: "E2E Hallkeeper" },
      writable: false,
    });
  }, VENUE);
  const json = (route: Route, data: unknown, status = 200): void => { void route.fulfill({ status, json: { data } }); };
  await page.route(`${API}/**`, (route) => { void route.fulfill({ status: 404, json: { error: "Not in this fixture", code: "NOT_FOUND" } }); });
  await page.route(`${API}/notifications**`, (route) => {
    json(route, new URL(route.request().url()).pathname.endsWith("unread-count") ? { unread: 0 } : []);
  });
  await page.route(`${API}/events/${EVENT}/ops-board`, (route) => { json(route, boardWith(taskStatus, issues)); });
  await page.route(`${API}/events/${EVENT}/change-feed**`, (route) => { json(route, []); });
  await page.route(`${API}/events/${EVENT}/change-acknowledgements**`, (route) => { json(route, []); });
  await page.route(`${API}/events/${EVENT}/mission`, (route) => { void route.fulfill({ status: 404, json: { error: "No mission", code: "NOT_FOUND" } }); });
  await page.route(`${API}/ops-tasks/${TASK}/status`, (route) => {
    const body = route.request().postDataJSON() as { readonly status: "todo" | "done"; readonly idempotencyKey: string };
    taskWrites.push(body.idempotencyKey);
    taskStatus = body.status;
    json(route, OpsTaskSchema.parse({
      id: TASK, handoffPackId: PACK, taskGroupId: null, phaseId: null, kind: "setup", title: "Set 18 round tables",
      detail: "From the approved Grand Hall dinner layout.", status: body.status, sortOrder: 0, dueLabel: "Before doors",
      sourceRef: "handoff-pack-v2", createdAt: NOW, updatedAt: NOW,
    }));
  });
  await page.route(`${API}/events/${EVENT}/issues`, (route) => {
    const body = route.request().postDataJSON() as { readonly title: string; readonly detail: string; readonly severity: "info" | "attention" | "urgent" };
    issueWrites.push(body.title);
    const issue = EventDayIssueSchema.parse({
      id: uuid(320 + issues.length), eventId: EVENT, phaseId: null, opsTaskId: null, title: body.title, detail: body.detail,
      status: "open", severity: body.severity, source: "hallkeeper", reportedBy: null, assignedTo: null, escalationNote: null,
      createdAt: NOW, updatedAt: NOW, resolvedAt: null,
    });
    issues.push(issue);
    json(route, issue, 201);
  });
  const network: Network = { taskWrites, issueWrites, offline: false };
  // Registered last, so it runs first: no answer while the phone is offline.
  await page.route(`${API}/**`, (route) => {
    if (network.offline) void route.abort("internetdisconnected");
    else void route.fallback();
  });
  await page.goto(`/ops/events/${EVENT}`);
  await expect(page.getByRole("heading", { name: "Hammermen dinner" })).toBeVisible();
  return network;
}

test.describe("Event-day board offline", () => {
  test("keeps a task marked done and an issue logged on the device while offline, then sends each once on reconnect", async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const network = await openBoard(page);
    await expect(page.getByText("Synced", { exact: true })).toBeVisible();

    network.offline = true;
    await context.setOffline(true);

    // The task keeps on the device, and says so.
    await page.getByLabel("Set 18 round tables status actions").getByRole("button", { name: "Done" }).click();
    await expect(page.getByText("Task saved on this device and will sync when the connection returns.")).toBeVisible();
    await expect(page.getByText("1 pending sync", { exact: true })).toBeVisible();

    // So does the issue, and the form clears for the next one.
    await page.getByLabel("Title").fill("Fire door propped open");
    await page.getByLabel("Detail").fill("North stair, beside the cloakroom.");
    await page.getByRole("button", { name: "Log issue" }).click();
    await expect(page.getByText("Issue saved on this device and will sync when the connection returns.")).toBeVisible();
    await expect(page.getByText("2 pending sync", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Title")).toHaveValue("");
    expect(network.taskWrites).toEqual([]);
    expect(network.issueWrites).toEqual([]);

    // The connection returns: each write reaches the server once.
    network.offline = false;
    await context.setOffline(false);
    await expect(page.getByText("Synced", { exact: true })).toBeVisible();
    await expect.poll(() => network.issueWrites).toEqual(["Fire door propped open"]);
    expect(network.taskWrites).toHaveLength(1);
    await expect(page.getByText("Fire door propped open")).toBeVisible();
  });
});
