import { expect, test, type Page, type Route } from "@playwright/test";
import {
  EventDayOpsBoardSchema,
  EventMissionBoardSchema,
  EventMissionEventSchema,
  EventMissionIncidentSchema,
  type EventMissionEvent,
  type EventMissionIncident,
} from "@omnitwin/types";
import { unreadableText } from "./support/readability.js";

// ---------------------------------------------------------------------------
// E2E: Mission Control on the event-day board (/ops/events/:id), roadmap N4.
//
// On a phone, mid-evening: a task was blocked early and twelve quieter events
// have happened since, more than the history shows. What waits for
// acknowledgement stays within reach, a failed acknowledgement says so beside
// its event, only the next phase is offered, and once every incident is
// resolved the list says so once. Nothing moves forever, and every label
// reads at 12 px and 4.5:1. The API is intercepted before transport.
// ---------------------------------------------------------------------------

const API = "http://localhost:3001";
const NOW = "2026-10-03T19:30:00.000Z";
const VENUE = "20000000-0000-4000-8000-000000000002";
const EVENT = "20000000-0000-4000-8000-000000000101";
const MISSION = "20000000-0000-4000-8000-000000000104";
const USER = "20000000-0000-4000-8000-000000000111";
const TASK = "20000000-0000-4000-8000-000000000107";
const PACK = "20000000-0000-4000-8000-000000000103";
const uuid = (n: number): string => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const BOARD = EventDayOpsBoardSchema.parse({
  event: {
    id: EVENT, venueId: VENUE, createdBy: null, name: "Incorporation dinner", eventType: "dinner", status: "ready_for_ops",
    startsAt: NOW, endsAt: null, guestCount: 180, clientName: "Incorporation of Hammermen", notes: null, createdAt: NOW, updatedAt: NOW,
  },
  phases: [],
  handoffPack: null,
  assignments: [],
  issues: [],
  statusUpdates: [],
  setupProgress: { totalTasks: 0, doneTasks: 0, blockedTasks: 0, activeTasks: 0, percent: 0 },
  supplierArrivals: [],
  escalationNotes: [],
  changesSinceLastHandoff: {
    handoffPackId: null, summary: "No handoff pack yet.", added: [], removed: [], changed: [], currentSnapshotHash: null, previousSnapshotHash: null,
  },
  sourceStatus: "missing_handoff",
});

function phase(sortOrder: number, name: string, status: "pending" | "active" | "completed"): unknown {
  return {
    id: uuid(300 + sortOrder), missionId: MISSION, eventId: EVENT, phaseId: uuid(400 + sortOrder), name, sortOrder, status,
    revision: 1, actualStartedAt: status === "pending" ? null : NOW, actualEndedAt: status === "completed" ? NOW : null,
    updatedBy: null, createdAt: NOW, updatedAt: NOW,
  };
}

const PHASES = [phase(0, "Arrival", "completed"), phase(1, "Dinner", "active"), phase(2, "Speeches", "pending"), phase(3, "Dancing", "pending")];

const MISSION_TASK = {
  id: TASK, missionId: MISSION, eventId: EVENT, handoffPackId: PACK, opsTaskId: uuid(108), phaseId: uuid(401), kind: "setup",
  title: "Place reception desk", detail: "Beside the north stair.", status: "blocked", revision: 2, assignedTo: null, assigneeLabel: null,
  spatialAnchors: [], actualStartedAt: NOW, actualEndedAt: null, updatedBy: USER, createdAt: NOW, updatedAt: NOW,
};

function incident(n: number, title: string, severity: "urgent" | "attention", status: "open" | "in_progress"): EventMissionIncident {
  return EventMissionIncidentSchema.parse({
    id: uuid(120 + n), missionId: MISSION, eventId: EVENT, phaseId: null, missionTaskId: null, title,
    detail: severity === "urgent" ? "North stair, beside the cloakroom." : "Mopped; sign still out.",
    status, severity, spatialAnchor: null, assignedTo: null, reportedBy: USER, revision: 1, resolvedAt: null, createdAt: NOW, updatedAt: NOW,
  });
}

function recorded(sequence: number, payload: unknown, requiresAcknowledgement = false): EventMissionEvent {
  const kind = (payload as { readonly kind: string }).kind;
  return EventMissionEventSchema.parse({
    id: uuid(900 + sequence), missionId: MISSION, eventId: EVENT, venueId: VENUE, sequence, kind, entityType: "mission", entityId: null,
    entityRevision: null, actorUserId: USER, actorRole: "hallkeeper", actorLabel: "Duty manager", actorKey: `user:${USER}`,
    idempotencyKey: `e2e-event:${String(sequence)}`, requiresAcknowledgement, payload, occurredAt: NOW, createdAt: NOW,
  });
}

/** A blocked task at 2, then twelve events that ask nothing of anyone. */
const TIMELINE: readonly EventMissionEvent[] = [
  recorded(1, { kind: "mission_started", baselineHash: "b".repeat(64) }),
  recorded(2, { kind: "task_status_changed", fromStatus: "in_progress", task: MISSION_TASK, note: "Lift out of service." }, true),
  ...Array.from({ length: 12 }, (_, index) => recorded(3 + index, {
    kind: "phase_status_changed", fromStatus: "pending", phase: PHASES[1], note: null,
  })),
];

async function openEvening(page: Page): Promise<{ readonly acknowledgements: string[] }> {
  const incidents = [incident(0, "Fire door propped open", "urgent", "open"), incident(1, "Spill by the bar", "attention", "in_progress")];
  const acknowledgements: string[] = [];
  let acknowledgeAttempts = 0;
  let sequence = TIMELINE.length;

  const missionBoard = (): unknown => EventMissionBoardSchema.parse({
    mission: {
      id: MISSION, eventId: EVENT, venueId: VENUE, handoffPackId: PACK, sourceSnapshotHash: "a".repeat(64), status: "live",
      baselineHash: "b".repeat(64), lastSequence: sequence, createdBy: USER, startedAt: NOW, completedAt: null, cancelledAt: null,
      createdAt: NOW, updatedAt: NOW,
    },
    phases: PHASES,
    tasks: [MISSION_TASK],
    incidents,
    acknowledgements: acknowledgements.map((eventId, index) => ({
      id: uuid(500 + index), missionId: MISSION, eventId: EVENT, acknowledgedEventId: eventId, acknowledgedBy: USER,
      acknowledgedByRole: "hallkeeper", note: null, createdAt: NOW,
    })),
    presence: [],
    latestSequence: sequence,
  });

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
  await page.route(`${API}/venues/${VENUE}`, (route) => {
    json(route, { id: VENUE, name: "Trades Hall Glasgow", slug: "trades-hall-glasgow", address: "85 Glassford Street", logoUrl: null, brandColour: null, timezone: "Europe/London", spaces: [] });
  });
  await page.route(`${API}/events/${EVENT}/ops-board`, (route) => { json(route, BOARD); });
  await page.route(`${API}/events/${EVENT}/change-feed**`, (route) => { json(route, []); });
  await page.route(`${API}/events/${EVENT}/change-acknowledgements**`, (route) => { json(route, []); });
  await page.route(`${API}/events/${EVENT}/mission`, (route) => { json(route, missionBoard()); });
  await page.route(`${API}/event-missions/${MISSION}/timeline**`, (route) => {
    const after = Number(new URL(route.request().url()).searchParams.get("afterSequence") ?? "0");
    json(route, { missionId: MISSION, events: TIMELINE.filter((event) => event.sequence > after), latestSequence: sequence, hasMore: false });
  });
  await page.route(`${API}/event-missions/${MISSION}/presence**`, (route) => {
    if (route.request().method() === "DELETE") { void route.fulfill({ status: 204 }); return; }
    json(route, {
      missionId: MISSION, sessionId: uuid(600), userId: USER, displayName: "E2E Hallkeeper", role: "hallkeeper",
      activePhaseId: null, activeTaskId: null, view: "board", lastSeenAt: NOW,
    });
  });
  await page.route(`${API}/event-missions/${MISSION}/acknowledgements`, (route) => {
    acknowledgeAttempts += 1;
    // The first reaches a server that is down; the second lands.
    if (acknowledgeAttempts === 1) { void route.fulfill({ status: 503, json: { error: "e2e acknowledgement failure", code: "UNAVAILABLE" } }); return; }
    const body = route.request().postDataJSON() as { readonly eventId: string };
    acknowledgements.push(body.eventId);
    sequence += 1;
    json(route, recorded(sequence, {
      kind: "event_acknowledged",
      acknowledgement: {
        id: uuid(550), missionId: MISSION, eventId: EVENT, acknowledgedEventId: body.eventId, acknowledgedBy: USER,
        acknowledgedByRole: "hallkeeper", note: null, createdAt: NOW,
      },
    }), 201);
  });
  await page.route(`${API}/event-missions/${MISSION}/incidents/*`, (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1);
    const index = incidents.findIndex((entry) => entry.id === id);
    const current = incidents[index];
    if (current === undefined) { void route.fulfill({ status: 404, json: { error: "Mission resource not found", code: "NOT_FOUND" } }); return; }
    const updated = { ...current, status: "resolved" as const, revision: current.revision + 1, resolvedAt: NOW };
    incidents[index] = updated;
    sequence += 1;
    json(route, recorded(sequence, { kind: "incident_updated", fromStatus: current.status, incident: updated }));
  });

  await page.goto(`/ops/events/${EVENT}`);
  return { acknowledgements };
}

test.describe("Mission Control", () => {
  test("keeps what waits within reach, says a failure beside its event, offers only the next phase and seals a resolved list", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const evening = await openEvening(page);
    const shell = page.getByRole("region", { name: "Event mission record" });
    await expect(shell.getByRole("heading", { name: "Now · Dinner" })).toBeVisible();

    // The blocked task is twelve events back, and still offers Acknowledge.
    const waiting = shell.getByRole("region", { name: "Waiting for acknowledgement" });
    await expect(waiting.getByText("Task blocked: Place reception desk")).toBeVisible();
    await expect(shell.getByRole("region", { name: "History" }).getByText("#2", { exact: true })).toHaveCount(0);

    // Dinner is live, so no phase may go live; Speeches is next and may be skipped.
    const rail = shell.getByRole("region", { name: "Phases" });
    await expect(rail.getByRole("button", { name: "Go live" })).toHaveCount(0);
    await expect(rail.getByRole("button", { name: "Complete" })).toBeVisible();
    await expect(rail.getByRole("listitem").filter({ hasText: "Speeches" }).getByText("Next", { exact: true })).toBeVisible();
    await expect(rail.getByRole("button", { name: "Skip" })).toBeVisible();

    // Nothing moves forever, and everything reads.
    const endless = await page.evaluate(() => Array.from(document.querySelectorAll(".mission-shell, .mission-shell *"))
      .flatMap((element) => [getComputedStyle(element), getComputedStyle(element, "::before"), getComputedStyle(element, "::after")])
      .filter((style) => style.animationName !== "none" && style.animationIterationCount === "infinite").length);
    expect(endless).toBe(0);
    expect(await unreadableText(page, ".mission-shell", "mission record on a phone")).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);

    // From the keyboard: a failed acknowledgement says so beside its event
    // and keeps focus where it was; the retry lands, and focus goes to a
    // heading rather than to the top of the page or another action.
    const acknowledge = waiting.getByRole("button", { name: "Acknowledge" });
    await acknowledge.focus();
    await page.keyboard.press("Enter");
    await expect(waiting.getByRole("alert")).toHaveText("Not acknowledged. Check the connection and try again.");
    await expect(acknowledge).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(waiting).toHaveCount(0);
    expect(evening.acknowledgements).toEqual([TIMELINE[1]?.id]);
    await expect(shell.getByRole("heading", { name: "Now · Dinner" })).toBeFocused();

    // Resolve every incident: the list says so once.
    const incidents = shell.getByRole("region", { name: "Incident channel" });
    await expect(incidents.getByText("No open incidents.")).toHaveCount(0);
    await incidents.getByRole("button", { name: "Resolve" }).first().focus();
    await page.keyboard.press("Enter");
    await expect(incidents.getByRole("button", { name: "Resolve" })).toHaveCount(1);
    await expect(incidents.getByRole("heading", { name: "Incident channel" })).toBeFocused();
    await incidents.getByRole("button", { name: "Resolve" }).click();
    await expect(incidents.getByText("No open incidents.")).toBeVisible();
    await expect(incidents.getByRole("list", { name: "Resolved and closed incidents" }).getByRole("button", { name: "Reopen" })).toHaveCount(2);
    await expect(shell.getByText("open incidents").locator("xpath=preceding-sibling::strong")).toHaveText("0");
    expect(await unreadableText(page, ".mission-shell", "sealed incident list on a phone")).toEqual([]);
  });
});
