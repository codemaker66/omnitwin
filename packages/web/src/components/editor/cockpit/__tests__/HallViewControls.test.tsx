import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useCockpitStore } from "../../../../stores/cockpit-store.js";
import { useHallTimeStore } from "../../../../stores/hall-time-store.js";
import { useHallViewStore } from "../../../../stores/hall-view-store.js";
import { HallViewControls } from "../HallViewControls.js";
import { registerEscapeLayer } from "../../../../lib/planner-keys.js";

/** Noon BST on midsummer's day 2026. */
const MIDSUMMER_NOON = Date.UTC(2026, 5, 21, 11, 0);

beforeEach(() => {
  window.localStorage.clear();
  useCockpitStore.getState().reset();
  useHallViewStore.setState({ mood: "daylight", viewRequest: null, activePreset: "room", surfaces: null });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The controls under the real sky (`?sky=1`, remembered on this device), with the hall at a set hour. */
function renderUnderSky(): HTMLElement {
  window.localStorage.setItem("venviewer.hall-sky", "1");
  useHallTimeStore.setState({ mode: "set", at: MIDSUMMER_NOON, scrubbing: false, openedFor: null, chosen: false });
  render(<HallViewControls captureAvailable={false} povActive={false} />);
  return screen.getByRole("button", { name: "Time of day, 12:00" });
}

describe("HallViewControls", () => {
  it("asks the scene for each named view", () => {
    render(<HallViewControls captureAvailable={false} povActive={false} />);
    fireEvent.click(screen.getByTestId("hall-view-plan"));
    expect(useHallViewStore.getState().viewRequest?.preset).toBe("plan");
    expect(screen.getByTestId("hall-view-plan").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTestId("planner-walk-toggle"));
    expect(useHallViewStore.getState().viewRequest?.preset).toBe("walk");
  });

  it("walks back out to the room from a walk", () => {
    useCockpitStore.setState({ walkMode: true });
    render(<HallViewControls captureAvailable={false} povActive={false} />);
    const walk = screen.getByTestId("planner-walk-toggle");
    expect(walk.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(walk);
    expect(useHallViewStore.getState().viewRequest?.preset).toBe("room");
  });

  it("holds every view while a saved viewpoint owns the camera", () => {
    render(<HallViewControls captureAvailable={false} povActive />);
    for (const id of ["hall-view-plan", "hall-view-room", "planner-walk-toggle"]) {
      expect(screen.getByTestId<HTMLButtonElement>(id).disabled).toBe(true);
    }
    // The light is not the camera's: it stays free.
    expect(screen.getByTestId<HTMLButtonElement>("hall-mood-evening").disabled).toBe(false);
  });

  it("changes the light and shows which light is on", () => {
    render(<HallViewControls captureAvailable={false} povActive={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Candlelight" }));
    expect(useHallViewStore.getState().mood).toBe("candlelight");
    expect(screen.getByRole("button", { name: "Candlelight" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Daylight" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("tells a sheet when a view was chosen, but not a light, and can name the lights", () => {
    let chosen = 0;
    const { rerender } = render(<HallViewControls captureAvailable={false} povActive={false} onViewChosen={() => { chosen += 1; }} />);
    expect(screen.queryByText("Evening")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Evening" }));
    expect(chosen).toBe(0);
    fireEvent.click(screen.getByTestId("hall-view-plan"));
    expect(chosen).toBe(1);
    act(() => { useCockpitStore.setState({ walkMode: true }); });
    fireEvent.click(screen.getByTestId("planner-walk-toggle"));
    expect(useHallViewStore.getState().viewRequest?.preset).toBe("room");
    expect(chosen).toBe(2);
    rerender(<HallViewControls captureAvailable={false} povActive={false} moodLabels />);
    expect(screen.getByText("Evening")).toBeTruthy();
  });

  it("offers the captured room only where it may be shown", () => {
    const { rerender } = render(<HallViewControls captureAvailable={false} povActive={false} />);
    expect(screen.queryByTestId("hall-capture-toggle")).toBeNull();
    rerender(<HallViewControls captureAvailable povActive={false} />);
    const capture = screen.getByTestId("hall-capture-toggle");
    act(() => { useCockpitStore.getState().setLayerMode("mesh"); });
    fireEvent.click(capture);
    expect(useCockpitStore.getState().layerMode).toBe("splat");
    expect(capture.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(capture);
    expect(useCockpitStore.getState().layerMode).toBe("mesh");
  });

  it("walks the drawn hall when the capture could not load", () => {
    useCockpitStore.getState().setLayerMode("splat");
    useCockpitStore.setState({ roomResolve: { ...useCockpitStore.getState().roomResolve, phase: "unavailable" } });
    render(<HallViewControls captureAvailable povActive={false} />);
    const capture = screen.getByTestId<HTMLButtonElement>("hall-capture-toggle");
    expect(capture.disabled).toBe(true);
    expect(capture.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByTestId("planner-walk-toggle"));
    expect(useCockpitStore.getState().layerMode).toBe("mesh");
    expect(useHallViewStore.getState().viewRequest?.preset).toBe("walk");
  });
});

describe("HallViewControls under the real sky", () => {
  it("keeps the Escape that closes the time of day from the planner, and gives focus back to its button", () => {
    const button = renderUnderSky();
    fireEvent.click(button);
    const dialog = screen.getByRole("dialog", { name: "Time of day" });
    // The planner's own Escape (clear the selection) sits below a popover in
    // the one Escape order.
    const planner = vi.fn();
    const stopPlanner = registerEscapeLayer({ kind: "selection", isOpen: () => true, escape: planner });
    try {
      const now = within(dialog).getByRole("button", { name: "Now" });
      now.focus();
      const notCancelled = fireEvent.keyDown(now, { key: "Escape", code: "Escape" });
      expect(notCancelled).toBe(false);
      expect(planner).not.toHaveBeenCalled();
      expect(dialog.getAttribute("data-open")).toBe("false");
      expect(button.getAttribute("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe(button);
      // With the panel shut, Escape is the planner's again.
      fireEvent.keyDown(button, { key: "Escape", code: "Escape" });
      expect(planner).toHaveBeenCalledTimes(1);
    } finally {
      stopPlanner();
    }
  });

  it("holds the time of day's panel to the room above its button, under the tool pill", () => {
    let anchorTop = 238;
    // A 1366 × 768 laptop with the timeline dock open: the stage is the
    // window (about 650 px tall), the tool pill's foot 69 px down, and the
    // controls' bar 376 px up from the bottom.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function rect(this: Element): DOMRect {
      if (this.classList.contains("cockpit-stage")) return new DOMRect(0, 0, 1366, 650);
      if (this.getAttribute("data-testid") === "planner-tool-pill") return new DOMRect(420, 21, 526, 48);
      if (this.classList.contains("hall-sun-anchor")) return new DOMRect(640, anchorTop, 86, 36);
      return new DOMRect(0, 0, 0, 0);
    });
    window.localStorage.setItem("venviewer.hall-sky", "1");
    useHallTimeStore.setState({ mode: "set", at: MIDSUMMER_NOON, scrubbing: false, openedFor: null, chosen: false });
    render(
      <main className="cockpit-stage">
        <div data-testid="planner-tool-pill" />
        <HallViewControls captureAvailable={false} povActive={false} />
      </main>,
    );
    fireEvent.click(screen.getByTestId("hall-sun-button"));
    const dial = screen.getByTestId("hall-sun-dial");
    // 238 − 12 (gap) − 8 (margin) − 69 (the pill's foot).
    expect(dial.style.maxHeight).toBe("149px");
    // A taller window gives it the room it needs.
    anchorTop = 520;
    act(() => { window.dispatchEvent(new Event("resize")); });
    expect(dial.style.maxHeight).toBe("431px");
  });
});
