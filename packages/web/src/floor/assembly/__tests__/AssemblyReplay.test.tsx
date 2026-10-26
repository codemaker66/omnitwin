import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { AssemblyReplay } from "../AssemblyReplay.js";
import { resetAssemblyRecallForTests, useAssemblyRecallStore } from "../recall.js";
import { grandHallDinner180 } from "../fixture.js";

beforeEach(() => {
  resetAssemblyRecallForTests();
  usePlacementStore.setState({ placedItems: grandHallDinner180().slice(0, 11) });
});

afterEach(() => {
  cleanup();
  resetAssemblyRecallForTests();
  usePlacementStore.setState({ placedItems: [] });
});

describe("the Grand Assembly's control", () => {
  it("is not there without furniture", () => {
    usePlacementStore.setState({ placedItems: [] });
    render(<AssemblyReplay />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("replays the Assembly at rest", () => {
    render(<AssemblyReplay />);
    const control = screen.getByRole("button", { name: "Replay the assembly" });
    expect(control.getAttribute("data-playing")).toBe("false");
    fireEvent.click(control);
    expect(useAssemblyRecallStore.getState().request).toMatchObject({ reason: "replay" });
  });

  it("is the Skip while the Assembly plays: speeds it up, then sends it to the end", () => {
    act(() => { useAssemblyRecallStore.setState({ active: true }); });
    render(<AssemblyReplay />);
    const skip = screen.getByRole("button", { name: "Skip" });
    expect(skip.getAttribute("data-playing")).toBe("true");
    fireEvent.click(skip);
    expect(useAssemblyRecallStore.getState().fast).toBe(true);
    const toEnd = screen.getByRole("button", { name: "Skip to the end" });
    expect(toEnd.getAttribute("data-fast")).toBe("true");
    const before = useAssemblyRecallStore.getState().skipNonce;
    fireEvent.click(toEnd);
    expect(useAssemblyRecallStore.getState().skipNonce).toBe(before + 1);
  });
});
