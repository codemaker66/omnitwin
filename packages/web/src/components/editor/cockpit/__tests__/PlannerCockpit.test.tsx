import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useCockpitStore } from "../../../../stores/cockpit-store.js";
import { useHistoricalRuntimeStatusStore } from "../../../../stores/historical-runtime-status-store.js";
import { useLayoutTimelinePreviewStore } from "../../../../stores/layout-timeline-preview-store.js";
import { CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE } from "@omnitwin/types";

// The cockpit hosts the full editor (App) in its stage; mock it to a stand-in
// so the test stays a structural shell test (no WebGL). The top bar reads
// router + store context of its own, so mock it too for this shell test.
vi.mock("../../../../App.js", () => ({ App: () => <div data-testid="mock-editor-3d" /> }));
vi.mock("../CockpitTopBar.js", () => ({ CockpitTopBar: () => <header data-testid="cockpit-topbar-mock" /> }));
vi.mock("../CockpitRightDock.js", () => ({ CockpitRightDock: () => <aside data-testid="cockpit-dock-mock" /> }));
vi.mock("../CockpitBottom.js", () => ({ CockpitBottom: () => <footer data-testid="cockpit-bottom-mock" /> }));

const { PlannerCockpit } = await import("../PlannerCockpit.js");

afterEach(() => {
  cleanup();
  useCockpitStore.getState().reset();
  useLayoutTimelinePreviewStore.getState().clear();
  useHistoricalRuntimeStatusStore.getState().publish({
    state: "inactive",
    bindingId: null,
    message: null,
  });
});

describe("PlannerCockpit", () => {
  it("renders the grid regions, the live editor, and the nav rail", () => {
    render(<PlannerCockpit />);
    expect(screen.getByTestId("cockpit-shell")).toBeTruthy();
    expect(screen.getByTestId("mock-editor-3d")).toBeTruthy();
    expect(screen.getByTestId("cockpit-rail")).toBeTruthy();
  });

  it("hosts the editor inside the stage region", () => {
    const { container } = render(<PlannerCockpit />);
    const stage = container.querySelector(".cockpit-stage");
    expect(stage).not.toBeNull();
    expect(stage?.querySelector('[data-testid="mock-editor-3d"]')).not.toBeNull();
  });

  it("marks the stage with the active lens (Design by default) so CSS shows tools only in Design", () => {
    const { container } = render(<PlannerCockpit />);
    expect(container.querySelector(".cockpit-stage")?.getAttribute("data-cockpit-mode")).toBe("design");
    fireEvent.click(screen.getByRole("button", { name: /flow/i }));
    expect(container.querySelector(".cockpit-stage")?.getAttribute("data-cockpit-mode")).toBe("flow");
  });

  // CARD A2: the stage exposes the resolve phase as an honesty attribute and
  // hosts the quiet caption while the captured room develops. No spinner.
  it("exposes the resolve phase on the stage and shows the quiet caption while developing", () => {
    useCockpitStore.getState().setRoomResolve({ phase: "developing", loadedChunks: 2, totalChunks: 7 });
    const { container } = render(<PlannerCockpit />);

    expect(container.querySelector(".cockpit-stage")?.getAttribute("data-resolve-phase")).toBe("developing");
    const caption = screen.getByTestId("room-resolve-caption");
    expect(caption.getAttribute("data-visible")).toBe("true");
    expect(caption.textContent).toContain("Loading captured room");
    expect(caption.textContent).toContain("2 of 7 chunks");
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
  });

  it("keeps the caption hidden outside the developing phase", () => {
    useCockpitStore.getState().setRoomResolve({ phase: "fallback", loadedChunks: 0, totalChunks: 0 });
    const { container } = render(<PlannerCockpit />);

    expect(container.querySelector(".cockpit-stage")?.getAttribute("data-resolve-phase")).toBe("fallback");
    expect(screen.getByTestId("room-resolve-caption").getAttribute("data-visible")).toBe("false");
  });

  it("marks timeline preview as read-only and shows the saved-plan honesty caption", () => {
    useLayoutTimelinePreviewStore.getState().settle({
      id: "event-a:phase-dinner",
      eventId: "event-a",
      eventName: "Wedding Dinner",
      phaseId: "phase-dinner",
      phaseName: "Dinner service",
      startsAt: "2026-07-18T19:00:00.000Z",
      endsAt: "2026-07-18T21:15:00.000Z",
      historicalRuntime: null,
      venueRuntime: CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.venueRuntime,
    }, []);

    const { container } = render(<PlannerCockpit />);
    expect(screen.getByTestId("cockpit-shell").getAttribute("data-layout-timeline-preview")).toBe("true");
    expect(container.querySelector(".cockpit-stage")?.getAttribute("data-layout-timeline-preview")).toBe("true");
    expect(screen.getByTestId("layout-timeline-preview-caption").textContent).toBe(
      "Visualizing phase change · frozen room outline + furniture are the plan · motion is not saved",
    );
    expect(screen.queryByTestId("room-resolve-caption")).toBeNull();
    expect(container.querySelector(".cockpit-layer-controls")).toBeNull();
    expect(screen.queryByTestId("cockpit-dock-mock")).toBeNull();
    expect(screen.getByTestId("cockpit-preview-lock").textContent).toContain("Editing is paused");
  });

  it("states that the saved plan is hidden when the selected timeline interval has no keyframe", () => {
    useLayoutTimelinePreviewStore.getState().showUnavailable({
      id: "event-a:phase-arrival",
      eventId: "event-a",
      eventName: "Wedding Dinner",
      phaseId: "phase-arrival",
      phaseName: "Guest arrival",
      startsAt: "2026-07-18T18:00:00.000Z",
      endsAt: "2026-07-18T19:00:00.000Z",
      historicalRuntime: null,
      venueRuntime: null,
    }, "No frozen layout was saved for this phase.");

    render(<PlannerCockpit />);

    expect(screen.getByTestId("layout-timeline-preview-caption").textContent).toBe(
      "Layout unavailable · No frozen layout was saved for this phase. · no room shell or saved layout shown",
    );
    expect(screen.getByTestId("cockpit-preview-lock").textContent).toContain("Editing is paused");
  });

  it("states that the scene is empty during a real schedule gap", () => {
    useLayoutTimelinePreviewStore.getState().showScheduleGap("No room phase is scheduled now.");
    render(<PlannerCockpit />);

    expect(screen.getByTestId("layout-timeline-preview-caption").textContent).toBe(
      "Schedule gap · No room phase is scheduled now. · no room shell or saved layout shown",
    );
    expect(screen.getByTestId("cockpit-preview-lock").textContent).toContain("Editing is paused");
  });

  it("offers an explicit retry after historical capture verification fails", () => {
    useLayoutTimelinePreviewStore.getState().settle({
      id: "event-a:phase-dinner",
      eventId: "event-a",
      eventName: "Wedding Dinner",
      phaseId: "phase-dinner",
      phaseName: "Dinner service",
      startsAt: "2026-07-18T19:00:00.000Z",
      endsAt: "2026-07-18T21:15:00.000Z",
      historicalRuntime: null,
      venueRuntime: CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.venueRuntime,
    }, []);
    useHistoricalRuntimeStatusStore.getState().publish({
      state: "error",
      bindingId: "11111111-1111-4111-8111-111111111111",
      message: "The exact historical room capture could not be verified.",
    });
    const before = useHistoricalRuntimeStatusStore.getState().retryRevision;

    render(<PlannerCockpit />);
    fireEvent.click(screen.getByRole("button", { name: "Retry capture" }));

    expect(useHistoricalRuntimeStatusStore.getState().retryRevision).toBe(before + 1);
  });
});
