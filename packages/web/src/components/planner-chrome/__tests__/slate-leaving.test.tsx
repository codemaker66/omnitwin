import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { LayoutChangeOutcome } from "../../../stores/editor-store.js";
import type { SlateAudience } from "../slate-data.js";

// ---------------------------------------------------------------------------
// The slate's room and layout switches (QoL D-X3). The planner page stays the
// same, so on master the outgoing layout's waiting autosave woke to find the
// next layout loaded and clean, and its last edits never left. The slate now
// gives the open layout's work up to 2 s to save (its line says "Saving"),
// then opens the room or layout; work this device cannot keep holds the
// switch with a way forward. It also says what came back from this device
// (D-01) and what stayed behind on the way here.
// ---------------------------------------------------------------------------

const leave = vi.hoisted(() => ({
  outcome: null as null | ((value: LayoutChangeOutcome) => void),
  calls: 0,
}));

vi.mock("../../../stores/editor-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../stores/editor-store.js")>();
  return {
    ...actual,
    saveBeforeLayoutChange: vi.fn(() => {
      leave.calls += 1;
      return new Promise<LayoutChangeOutcome>((resolve) => { leave.outcome = resolve; });
    }),
  };
});

const audience = vi.hoisted(() => ({ value: null as null | SlateAudience }));
vi.mock("../slate-data.js", () => ({
  useSlateAudience: () => audience.value,
  useEventHold: () => null,
}));
vi.mock("../../../hooks/use-planner-venue-identity.js", () => ({
  usePlannerVenueIdentity: () => ({ name: "Trades Hall", logoUrl: null, loading: false, known: true }),
}));

const { Slate } = await import("../Slate.js");
const { useEditorStore } = await import("../../../stores/editor-store.js");

const GRAND_HALL_LAYOUT = "cfg-grand-hall";

function Where(): ReactElement {
  const location = useLocation();
  return <output data-testid="where" data-state={JSON.stringify(location.state ?? null)}>{`${location.pathname}${location.search}`}</output>;
}

function openSlate(): void {
  render(
    <MemoryRouter initialEntries={[`/plan/${GRAND_HALL_LAYOUT}?chrome=v2`]}>
      <Routes><Route path="*" element={<><Slate /><Where /></>} /></Routes>
    </MemoryRouter>,
  );
}

function where(): string {
  return screen.getByTestId("where").textContent ?? "";
}

async function settle(outcome: LayoutChangeOutcome): Promise<void> {
  await act(async () => {
    leave.outcome?.(outcome);
    await Promise.resolve();
  });
}

function chooseSaloon(): void {
  fireEvent.click(screen.getByRole("button", { name: /Grand Hall/u }));
  fireEvent.click(screen.getByRole("button", { name: /^Saloon,/u }));
}

beforeEach(() => {
  leave.outcome = null;
  leave.calls = 0;
  audience.value = { event: null, graph: null, staff: false, signedIn: true, eventId: null };
  useEditorStore.setState({
    configId: GRAND_HALL_LAYOUT,
    configName: "Wedding breakfast",
    venueId: "venue-trades-hall",
    space: { id: "space-grand-hall", venueId: "venue-trades-hall", name: "Grand Hall", slug: "grand-hall" } as never,
    isDirty: true,
    isSaving: false,
    pendingChanges: 2,
    isOnline: true,
    saveError: null,
    saveConflict: null,
    lockReason: null,
    restoredFromDevice: null,
    leftBehind: null,
  });
});

afterEach(() => {
  cleanup();
  useEditorStore.getState().reset();
  useEditorStore.setState({ leftBehind: null });
});

describe("switching room from the slate", () => {
  it("waits for this layout's save before opening the room, then says which layout it left", async () => {
    openSlate();
    chooseSaloon();
    expect(leave.calls).toBe(1);
    expect(where()).toBe(`/plan/${GRAND_HALL_LAYOUT}?chrome=v2`);

    await settle("saved");
    await waitFor(() => { expect(where()).toBe("/plan?space=saloon&chrome=v2"); });
    const state: unknown = JSON.parse(screen.getByTestId("where").dataset["state"] ?? "null");
    expect(state).toMatchObject({ leavingLayout: GRAND_HALL_LAYOUT });
    expect(typeof Reflect.get(state as object, "approval")).toBe("string");
  });

  it("goes on when the work stays on this device", async () => {
    openSlate();
    chooseSaloon();
    await settle("kept");
    await waitFor(() => { expect(where()).toBe("/plan?space=saloon&chrome=v2"); });
  });

  it("holds the switch for work this device cannot keep, and lets the person wait or go", async () => {
    const saveToServer = vi.fn(() => {
      useEditorStore.setState({ isDirty: false });
      return Promise.resolve(true);
    });
    useEditorStore.setState({ saveToServer });
    openSlate();
    chooseSaloon();
    await settle("not-kept");

    const held = await screen.findByRole("alert");
    expect(held.textContent).toContain("Your changes to this layout have not reached Venviewer yet.");
    expect(held.textContent).toContain("This browser cannot keep them on this device, so the Saloon waits until they are saved.");
    expect(where()).toBe(`/plan/${GRAND_HALL_LAYOUT}?chrome=v2`);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => { expect(where()).toBe("/plan?space=saloon&chrome=v2"); });
    expect(saveToServer).toHaveBeenCalledTimes(1);
  });

  it("goes without the work only when the person says so", async () => {
    openSlate();
    chooseSaloon();
    await settle("not-kept");
    fireEvent.click(await screen.findByRole("button", { name: "Open the Saloon without them" }));
    await waitFor(() => { expect(where()).toBe("/plan?space=saloon&chrome=v2"); });
  });
});

describe("opening another of the event's layouts from the slate", () => {
  it("waits for this layout's save first", async () => {
    audience.value = {
      event: { id: "event-1", name: "Duncan wedding", startsAt: null, guestCount: 120, timeZone: "Europe/London",
        layouts: [{ id: "cfg-drinks", name: "Drinks reception", spaceName: "Saloon" }] },
      graph: null, staff: false, signedIn: true, eventId: "event-1",
    };
    openSlate();
    fireEvent.click(screen.getByRole("button", { name: /Duncan wedding/u }));
    fireEvent.click(screen.getByRole("link", { name: /Drinks reception/u }));
    expect(leave.calls).toBe(1);
    expect(where()).toBe(`/plan/${GRAND_HALL_LAYOUT}?chrome=v2`);
    await settle("saved");
    await waitFor(() => { expect(where()).toBe("/plan/cfg-drinks?chrome=v2"); });
  });
});

describe("what the slate says about work that outlived its page", () => {
  it("gives the restore receipt while the restored work saves", () => {
    useEditorStore.setState({
      isSaving: true,
      savingChanges: 2,
      restoredFromDevice: { changes: 2, editedAt: new Date() },
    });
    openSlate();
    const receipt = screen.getAllByRole("status").find((region) => region.classList.contains("pc-notice"));
    expect(receipt?.textContent).toMatch(/^Restored 2 changes you made at \d\d:\d\d on this deviceSaving$/u);
    expect(screen.getByTestId("slate-line").textContent).toContain("Saving · 2 changes");
  });

  it("says what stayed behind in the layout it came from", () => {
    useEditorStore.setState({
      isDirty: false,
      pendingChanges: 0,
      leftBehind: { configId: "cfg-other", roomName: "Grand Hall", kept: true, savesOnReturn: true },
    });
    openSlate();
    expect(document.body.textContent).toContain("Your changes to the Grand Hall layout are kept on this device and save when you open it again.");
  });
});
