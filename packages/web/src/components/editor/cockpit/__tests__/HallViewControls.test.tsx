import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useCockpitStore } from "../../../../stores/cockpit-store.js";
import { useHallViewStore } from "../../../../stores/hall-view-store.js";
import { HallViewControls } from "../HallViewControls.js";

beforeEach(() => {
  window.localStorage.clear();
  useCockpitStore.getState().reset();
  useHallViewStore.setState({ mood: "daylight", viewRequest: null, activePreset: "room", surfaces: null });
});
afterEach(() => { cleanup(); });

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
