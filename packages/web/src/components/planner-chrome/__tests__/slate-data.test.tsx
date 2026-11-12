import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClientEventSchedule, EventPhaseGraph } from "@omnitwin/types";
import { useAuthStore } from "../../../stores/auth-store.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { useSlateAudience } from "../slate-data.js";

// ---------------------------------------------------------------------------
// The slate's event (T-671 slice 7) is named as the event is named everywhere
// else: an event stored without a name (made before eventNameFor named every
// new one) is called by its occasion and the venue's day, for the venue's
// staff through the event's graph and for a client through their schedule.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({ getEventPhaseGraph: vi.fn(), getClientEventSchedule: vi.fn(), getVenue: vi.fn() }));
vi.mock("../../../api/events.js", () => ({ getEventPhaseGraph: mocks.getEventPhaseGraph }));
vi.mock("../../../api/client-event-schedule.js", () => ({ getClientEventSchedule: mocks.getClientEventSchedule }));
// The staff name of an unnamed event reads its day on the venue's clock.
vi.mock("../../../api/spaces.js", async (importOriginal) => ({ ...await importOriginal<typeof import("../../../api/spaces.js")>(), getVenue: mocks.getVenue }));

const VENUE = "00000000-0000-4000-8000-0000000000f1";
const EVENT = "00000000-0000-4000-8000-0000000000e1";
const CONFIG = "00000000-0000-4000-8000-0000000000c1";
const STARTS = "2027-03-14T18:00:00.000Z";
const stored = { id: EVENT, venueId: VENUE, name: "", eventType: "wedding", startsAt: STARTS, endsAt: null, guestCount: 80 };

function wrapper({ children }: { readonly children: ReactNode }): ReactElement {
  return <MemoryRouter initialEntries={[`/plan/${CONFIG}?eventId=${EVENT}`]}>{children}</MemoryRouter>;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useAuthStore.getState().logout();
});

describe("the slate's event, stored without a name (the event-name ruling)", () => {
  it("is named by its occasion and day for the venue's staff", async () => {
    useEditorStore.setState({ venueId: VENUE, configId: CONFIG });
    useAuthStore.getState().setUser({ id: "staff-1", role: "staff", platformRole: "none", venueId: VENUE, name: "Isla Staff", email: "isla@example.test" });
    const graph: EventPhaseGraph = {
      event: { ...stored, createdBy: null, status: "confirmed", clientName: null, notes: null, createdAt: STARTS, updatedAt: STARTS },
      phases: [], scenarios: [], layoutVariants: [], configurationLinks: [], phaseLayoutSnapshots: [],
    };
    mocks.getEventPhaseGraph.mockResolvedValue(graph);
    mocks.getVenue.mockResolvedValue({ id: VENUE, timezone: "Europe/London", spaces: [] });
    const { result } = renderHook(() => useSlateAudience(), { wrapper });
    await waitFor(() => { expect(result.current.event?.name).toBe("Wedding, 14 March 2027"); });
  });

  it("is named by its occasion and day for the client", async () => {
    useEditorStore.setState({ venueId: VENUE, configId: CONFIG });
    useAuthStore.getState().setUser({ id: "client-1", role: "client", platformRole: "none", venueId: null, name: "Morag Client", email: "morag@example.test" });
    const schedule: ClientEventSchedule = {
      event: { ...stored, status: "confirmed" },
      venue: { id: VENUE, name: "Trades Hall", timezone: "Europe/London" },
      scheduleState: "working", phases: [],
      layouts: [{ id: CONFIG, name: "Dinner layout", space: { id: "00000000-0000-4000-8000-0000000000a1", name: "Grand Hall" } }],
      slots: [],
    };
    mocks.getClientEventSchedule.mockResolvedValue(schedule);
    const { result } = renderHook(() => useSlateAudience(), { wrapper });
    await waitFor(() => { expect(result.current.event?.name).toBe("Wedding, 14 March 2027"); });
  });
});
