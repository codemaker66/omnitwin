import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventPhaseGraph } from "@omnitwin/types";
import type { VenueDetail } from "../../../api/spaces.js";

// ---------------------------------------------------------------------------
// The slate's day (#407 review, B3). An event stored without a name is called
// by its occasion and its venue's own day, and the slate's eyebrow and its
// link to the Diary read the same day, so the card never puts the name of one
// day over another, nor opens the Diary on the wrong one. On a venue keeping
// London's clock nothing changes.
//
// The whole slate is rendered for venue staff from the event's graph and its
// venue, as the planner reads them; only the reads themselves are stand-ins.
// ---------------------------------------------------------------------------

const api = vi.hoisted(() => ({ getEventPhaseGraph: vi.fn(), getVenue: vi.fn(), getCalendar: vi.fn() }));
vi.mock("../../../api/events.js", () => ({ getEventPhaseGraph: api.getEventPhaseGraph }));
vi.mock("../../../api/spaces.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../api/spaces.js")>(),
  getVenue: api.getVenue,
}));
vi.mock("../../../api/diary.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../api/diary.js")>(),
  getCalendar: api.getCalendar,
}));
vi.mock("../../../hooks/use-planner-venue-identity.js", () => ({
  usePlannerVenueIdentity: () => ({ name: "TEST ONLY venue", logoUrl: null, loading: false, known: true }),
}));

const { Slate } = await import("../Slate.js");
const { useAuthStore } = await import("../../../stores/auth-store.js");
const { useEditorStore } = await import("../../../stores/editor-store.js");

const VENUE = "00000000-0000-4000-8000-0000000000f1";
const EVENT = "00000000-0000-4000-8000-0000000000e1";
const CONFIG = "00000000-0000-4000-8000-0000000000c1";
// 06:30 UTC on Monday 15 March 2027: 23:30 on Sunday the 14th in Los Angeles.
const STARTS = "2027-03-15T06:30:00.000Z";

function graphNamed(name: string): EventPhaseGraph {
  return {
    event: {
      id: EVENT, venueId: VENUE, createdBy: null, name, eventType: "wedding", status: "confirmed", startsAt: STARTS, endsAt: null,
      guestCount: 80, clientName: null, notes: null, createdAt: STARTS, updatedAt: STARTS,
    },
    phases: [], scenarios: [], layoutVariants: [], configurationLinks: [], phaseLayoutSnapshots: [],
  };
}

function venueIn(timezone: string): VenueDetail {
  return { id: VENUE, name: "TEST ONLY venue", address: "Disposable fixture", slug: "test-only-venue", logoUrl: null, brandColour: null, timezone, spaces: [] };
}

/** The slate for venue staff on an event at a venue keeping `timezone`: its eyebrow and where it opens the Diary. */
async function slateFor(name: string, timezone: string, title: string): Promise<{ readonly eyebrow: string; readonly diary: string | null }> {
  api.getEventPhaseGraph.mockResolvedValue(graphNamed(name));
  api.getVenue.mockResolvedValue(venueIn(timezone));
  // The hold chip's read: none here, so the slate shows no chip.
  api.getCalendar.mockRejectedValue(new Error("TEST ONLY no Diary read"));
  useEditorStore.setState({
    venueId: VENUE, configId: CONFIG, configName: "TEST ONLY layout",
    space: { id: "00000000-0000-4000-8000-0000000000a1", venueId: VENUE, name: "Grand Hall", slug: "grand-hall" } as never,
  });
  useAuthStore.getState().setUser({ id: "staff-1", role: "staff", platformRole: "none", venueId: VENUE, name: "Isla Staff", email: "isla@example.test" });
  render(<MemoryRouter initialEntries={[`/plan/${CONFIG}?eventId=${EVENT}`]}><Slate /></MemoryRouter>);
  const plate = await screen.findByRole("region", { name: title });
  const eyebrow = within(plate).getByText(/ · Grand Hall$/u).textContent ?? "";
  fireEvent.click(within(plate).getByRole("button", { name: title }));
  const diary = (await screen.findByRole("link", { name: "Open in the Diary" })).getAttribute("href");
  return { eyebrow, diary };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useEditorStore.getState().reset();
  useAuthStore.getState().logout();
});

describe("the slate's day, for venue staff", () => {
  it("reads the eyebrow and the Diary's day on the venue's clock, the day the event's name carries", async () => {
    const slate = await slateFor("", "America/Los_Angeles", "Wedding, 14 March 2027");
    expect(slate.eyebrow).toBe("Sun 14 Mar 2027 · Grand Hall");
    expect(slate.diary).toBe("/diary?date=2027-03-14");
  });

  it("changes nothing for a venue on London's clock", async () => {
    const unnamed = await slateFor("", "Europe/London", "Wedding, 15 March 2027");
    expect(unnamed).toEqual({ eyebrow: "Mon 15 Mar 2027 · Grand Hall", diary: "/diary?date=2027-03-15" });
    cleanup();
    const named = await slateFor("TEST ONLY Fraser wedding", "Europe/London", "TEST ONLY Fraser wedding");
    expect(named).toEqual({ eyebrow: "Mon 15 Mar 2027 · Grand Hall", diary: "/diary?date=2027-03-15" });
  });
});
