import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { EventDayOpsBoardSchema, EventInstructionsSchema, EventPhaseGraphSchema, type EventInstructions } from "@omnitwin/types";
import { KeepInView } from "../KeepInView.js";
import type { HallkeeperContextResult, HallkeeperVerifiedContext } from "../useHallkeeperContext.js";

afterEach(cleanup);

const EVENT_ID = "00000000-0000-4000-8000-000000000004";
const VENUE_ID = "00000000-0000-4000-8000-000000000002";
const NOW = "2026-10-03T08:00:00.000Z";
// Saturday 3 October 2026, 09:00 in Glasgow.
const MORNING = Date.parse(NOW);

const FULL: EventInstructions = EventInstructionsSchema.parse({
  dayOfContact: { name: "Elaine Gray", role: "Events manager", phone: "0141 552 2418" },
  phaseDeadlines: [
    { phase: "dress", deadline: "2026-10-03T14:30:00.000Z" },
    { phase: "furniture", deadline: "2026-10-03T13:30:00.000Z", reason: "Florist arrives" },
  ],
  accessibility: { hearingLoopRequired: true, hearingLoopZone: "Centre", wheelchairSpaces: 4 },
  dietary: { nutFree: 3, glutenFree: 2, vegetarian: 12, otherAllergies: "Table 4: sesame." },
});

const idle: HallkeeperContextResult = { status: "idle", context: null, error: null, retry: vi.fn() };

/** A verified context whose event board carries these issue titles, the
 *  first open and the rest in progress. */
function withIssues(titles: readonly string[]): HallkeeperContextResult {
  const graph = EventPhaseGraphSchema.parse({
    event: { id: EVENT_ID, venueId: VENUE_ID, createdBy: null, name: "Hammermen dinner", eventType: "dinner", status: "ready_for_ops",
      startsAt: NOW, endsAt: null, guestCount: 180, clientName: null, notes: null, createdAt: NOW, updatedAt: NOW },
    phases: [], scenarios: [], layoutVariants: [], configurationLinks: [], phaseLayoutSnapshots: [],
  });
  const board = EventDayOpsBoardSchema.parse({
    event: graph.event, phases: [], handoffPack: null, assignments: [], statusUpdates: [],
    issues: titles.map((title, index) => ({
      id: `00000000-0000-4000-8000-0000000001${String(index).padStart(2, "0")}`, eventId: EVENT_ID, phaseId: null, opsTaskId: null,
      title, detail: "Reported on the floor.", status: index === 0 ? "open" : "in_progress", severity: "attention", source: "hallkeeper",
      reportedBy: null, assignedTo: null, escalationNote: null, createdAt: NOW, updatedAt: NOW, resolvedAt: null,
    })),
    setupProgress: { totalTasks: 0, doneTasks: 0, blockedTasks: 0, activeTasks: 0, percent: 0 },
    supplierArrivals: [], escalationNotes: [],
    changesSinceLastHandoff: { handoffPackId: null, summary: "No handoff", added: [], removed: [], changed: [], currentSnapshotHash: null, previousSnapshotHash: null },
    sourceStatus: "missing_handoff",
  });
  const context: HallkeeperVerifiedContext = {
    configId: "00000000-0000-4000-8000-000000000001",
    venue: { id: VENUE_ID, slug: "trades-hall-glasgow", name: "Trades Hall Glasgow" },
    room: { id: "00000000-0000-4000-8000-000000000003", slug: "grand-hall", name: "Grand Hall" },
    graph, board, layouts: [], unavailableLayoutCount: 0, opsError: null,
  };
  return { status: "ready", context, error: null, retry: vi.fn() };
}

function mount(instructions: EventInstructions | null, context: HallkeeperContextResult = idle, nowMs = MORNING) {
  render(<MemoryRouter><KeepInView instructions={instructions} timeZone="Europe/London" eventDay="2026-10-03" nowMs={nowMs} context={context} /></MemoryRouter>);
  return within(screen.getByRole("region", { name: "Keep in view" }));
}

/** The value beside a fact's label. */
function fact(band: ReturnType<typeof mount>, label: string): HTMLElement {
  const term = band.getByText(label, { selector: "dt" });
  const value = term.nextElementSibling;
  if (!(value instanceof HTMLElement)) throw new Error(`No value for ${label}`);
  return value;
}

describe("Keep in view", () => {
  it("holds the guest's needs, who to call and the next deadline", () => {
    const band = mount(FULL);
    expect(fact(band, "Access needs").textContent).toBe("Hearing loop in Centre4 wheelchair spaces");
    expect(fact(band, "Allergies").textContent).toBe("3 nut-free and 2 gluten-free mealsTable 4: sesame.");
    const call = band.getByRole("link", { name: "Call Elaine Gray on 0141 552 2418" });
    expect(call.getAttribute("href")).toBe("tel:01415522418");
    expect(fact(band, "Day-of contact").textContent).toContain("Events manager");
    // The earliest deadline still ahead, on the venue's clock, with its reason.
    expect(fact(band, "Next deadline").textContent).toBe("Furniture by 14:30Florist arrives");
    // Diets are the brief's; the band claims only what answers to allergens.
    expect(band.queryByText(/vegetarian/iu)).toBeNull();
  });

  it("moves to the next deadline once one passes, and drops the fact once all have", () => {
    expect(fact(mount(FULL, idle, Date.parse("2026-10-03T13:45:00.000Z")), "Next deadline").textContent).toBe("Dress by 15:30");
    cleanup();
    expect(mount(FULL, idle, Date.parse("2026-10-03T16:00:00.000Z")).queryByText("Next deadline")).toBeNull();
  });

  it("says what nobody recorded rather than claiming there is nothing", () => {
    const band = mount(null);
    expect(fact(band, "Access and allergies").textContent).toBe("None recorded on this sheet");
    expect(fact(band, "Day-of contact").textContent).toBe("None on this sheet");
    expect(band.queryByText("Access needs")).toBeNull();
    expect(band.queryByText("Allergies")).toBeNull();
    expect(band.queryByText("Next deadline")).toBeNull();
    expect(band.queryByRole("link")).toBeNull();
  });

  it("offers email when the contact left no phone", () => {
    const band = mount(EventInstructionsSchema.parse({ dayOfContact: { name: "Sam Reid", email: "sam@example.test" } }));
    expect(band.getByRole("link", { name: "Email Sam Reid at sam@example.test" }).getAttribute("href")).toBe("mailto:sam@example.test");
  });
});

describe("Keep in view: the event's issues", () => {
  it("counts the open issues, names the first and links to the event's list", () => {
    const band = mount(FULL, withIssues(["Lift out of service", "Cloakroom rail missing"]));
    const issues = fact(band, "Event issues");
    expect(issues.textContent).toContain("2 open issues");
    expect(issues.textContent).toContain("Lift out of service");
    expect(within(issues).getByRole("link", { name: "Review issues" }).getAttribute("href")).toBe(`/ops/events/${EVENT_ID}`);
  });

  it("says when none are open, and when the sheet was opened without its event", () => {
    expect(fact(mount(FULL, withIssues([])), "Event issues").textContent).toBe("No open issues.");
    cleanup();
    expect(fact(mount(FULL), "Event issues").textContent).toBe("Open it from its event to see issues.");
  });

  it("shows loading as activity, and a failure with its retry", () => {
    expect(fact(mount(FULL, { ...idle, status: "loading" }), "Event issues").textContent).toContain("Loading the event's issues");
    cleanup();
    const retry = vi.fn();
    const band = mount(FULL, { status: "error", context: null, error: "The linked event's schedule could not be loaded.", retry });
    expect(fact(band, "Event issues").textContent).toContain("The linked event's schedule could not be loaded.");
    fireEvent.click(band.getByRole("button", { name: "Retry context" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
