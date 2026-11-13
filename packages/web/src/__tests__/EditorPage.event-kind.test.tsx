import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// The event question in the planner's page (T-674): it is mounted once,
// beside the 3D and 2D views, so the event's name opens it in either, and a
// layout opened from an event is never asked. The heavy views are stand-ins;
// the phone's top bar stand-in carries the real event name, as the real bar
// does in both views.
// ---------------------------------------------------------------------------

vi.mock("../App.js", () => ({ App: () => <div data-testid="mock-editor-3d" /> }));
vi.mock("../components/editor/cockpit/PlannerCockpit.js", () => ({ PlannerCockpit: () => <div data-testid="planner-cockpit" /> }));
vi.mock("../pages/BlueprintPage.js", () => ({ BlueprintPage: () => <div data-testid="mock-blueprint" /> }));
vi.mock("../components/editor/MobilePlannerTopBar.js", async () => {
  const { EventKindName } = await import("../components/planner-chrome/EventKindPicker.js");
  return {
    MobilePlannerTopBar: ({ mode, onModeChange }: { mode: "3d" | "2d"; onModeChange: (mode: "2d" | "3d") => void }) => (
      <div data-testid="mock-top-bar" data-mode={mode}>
        <EventKindName className="is-phone" />
        <button type="button" onClick={() => { onModeChange(mode === "3d" ? "2d" : "3d"); }}>Switch view</button>
      </div>
    ),
  };
});
vi.mock("../components/editor/SaveSendPanel.js", () => ({ SaveSendPanel: () => null }));
vi.mock("../components/editor/SubmitForReviewPanel.js", () => ({ SubmitForReviewPanel: () => null }));
vi.mock("../components/editor/EditorBridge.js", () => ({ EditorBridge: () => null }));
vi.mock("../components/editor/ObjectNotePanel.js", () => ({ ObjectNotePanel: () => null }));
vi.mock("../components/editor/EventDetailsPanel.js", () => ({ EventDetailsPanel: () => null }));
vi.mock("../components/truth/TruthModeIndicator.js", () => ({ TruthModeIndicator: () => null }));
const media = vi.hoisted(() => ({ mobile: true }));
vi.mock("../hooks/use-media-query.js", () => ({
  useIsCoarsePointer: () => false,
  useIsNarrowViewport: () => media.mobile,
}));

const { EditorPage } = await import("../pages/EditorPage.js");
const { useEditorStore } = await import("../stores/editor-store.js");
const { useCockpitStore } = await import("../stores/cockpit-store.js");
const record = await import("../lib/event-kind-record.js");
const originalLoadConfiguration = useEditorStore.getState().loadConfiguration;

const CONFIG = "cfg-event";

/** A guest's empty draft, open and read as its load leaves it. */
function openDraft(answer?: "wedding"): void {
  if (answer !== undefined) record.rememberDeviceEventKind(CONFIG, answer);
  useEditorStore.setState({ configId: CONFIG, isPublicPreview: true, objects: [], reviewStatus: null, isLoading: false, error: null });
  record.openLayoutEventKind({ configId: CONFIG, isPublicPreview: true, search: "", metadata: null, floorEmptyAtOpen: true });
}

function renderPlanner(address = `/plan/${CONFIG}`): void {
  render(<MemoryRouter initialEntries={[address]}><Routes><Route path="/plan/:code" element={<EditorPage />} /></Routes></MemoryRouter>);
}

const asking = (): HTMLElement | null => screen.queryByRole("dialog", { name: "What are you planning?" });

beforeEach(() => {
  media.mobile = true;
  window.localStorage.clear();
  record.resetEventKindQuestionForTesting();
  useCockpitStore.getState().reset();
  useEditorStore.setState({ loadConfiguration: originalLoadConfiguration });
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function showModal(this: HTMLDialogElement) { this.open = true; });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function close(this: HTMLDialogElement) { this.open = false; });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  record.resetEventKindQuestionForTesting();
  useEditorStore.setState({ configId: null, isPublicPreview: false, objects: [] });
});

describe("the event question in the planner's page", () => {
  it("opens from the phone's event name in the 2D plan, and never on its own as the view changes", () => {
    openDraft("wedding");
    renderPlanner();
    fireEvent.click(screen.getByRole("button", { name: "Switch view" }));
    expect(screen.getByTestId("mock-blueprint")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "The event: Wedding. Change it" }));
    expect(asking()).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Keep it as it is" }));
    expect(asking()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Switch view" }));
    expect(screen.getByTestId("planner-cockpit")).toBeTruthy();
    expect(asking()).toBeNull();
  });

  it("asks a new layout in the 3D view, and keeps asking if the view changes under it (a 3D view that cannot draw goes on in 2D)", () => {
    openDraft();
    renderPlanner();
    expect(asking()).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Switch view" }));
    expect(screen.getByTestId("mock-blueprint")).toBeTruthy();
    expect(asking()).not.toBeNull();
  });

  it("does not ask a new layout opened from an event, though its name still opens it", () => {
    openDraft();
    renderPlanner(`/plan/${CONFIG}?eventId=event-1`);
    expect(screen.getByTestId("planner-cockpit")).toBeTruthy();
    expect(asking()).toBeNull();
    act(() => { record.changeEventKind(); });
    expect(asking()).not.toBeNull();
  });
});
