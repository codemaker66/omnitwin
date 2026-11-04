import { readFileSync } from "node:fs";
import path from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { AssemblyReplay, REPLAY_SETTLE_MS } from "../AssemblyReplay.js";
import { resetAssemblyRecallForTests, useAssemblyRecallStore } from "../recall.js";
import { grandHallDinner180 } from "../fixture.js";

beforeEach(() => {
  resetAssemblyRecallForTests();
  usePlacementStore.setState({ placedItems: grandHallDinner180().slice(0, 11) });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetAssemblyRecallForTests();
  usePlacementStore.setState({ placedItems: [] });
});

/** The show ends as GrandAssembly ends it: the room is given back now. */
function giveTheRoomBack(at: number): void {
  act(() => { useAssemblyRecallStore.setState({ active: false, fast: false, restedAt: at }); });
}

describe("the Grand Assembly's Skip", () => {
  it("is not there without furniture", () => {
    usePlacementStore.setState({ placedItems: [] });
    act(() => { useAssemblyRecallStore.setState({ active: true }); });
    render(<AssemblyReplay />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("is absent at rest: Present replays the Assembly", () => {
    render(<AssemblyReplay />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("is the Skip while the Assembly plays: speeds it up, then sends it to the end", () => {
    act(() => { useAssemblyRecallStore.setState({ active: true }); });
    render(<AssemblyReplay />);
    const skip = screen.getByRole("button", { name: "Skip" });
    expect(skip.getAttribute("data-playing")).toBe("true");
    expect(skip.getAttribute("data-settling")).toBe("false");
    fireEvent.click(skip);
    expect(useAssemblyRecallStore.getState().fast).toBe(true);
    const toEnd = screen.getByRole("button", { name: "Skip to the end" });
    expect(toEnd.getAttribute("data-fast")).toBe("true");
    const before = useAssemblyRecallStore.getState().skipNonce;
    fireEvent.click(toEnd);
    expect(useAssemblyRecallStore.getState().skipNonce).toBe(before + 1);
  });

  it("stays as the show ends, fading and letting presses go, then is gone after the settle", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(performance, "now").mockReturnValue(5_000);
    act(() => { useAssemblyRecallStore.setState({ active: true, fast: true }); });
    render(<AssemblyReplay />);
    giveTheRoomBack(5_000);
    // It keeps the words it had: a press already on its way to "Skip to the end" lands here.
    const fading = screen.getByRole("button", { name: "Skip to the end" });
    expect(fading.getAttribute("data-playing")).toBe("false");
    expect(fading.getAttribute("data-settling")).toBe("true");
    expect(fading.getAttribute("tabindex")).toBe("-1");
    const before = useAssemblyRecallStore.getState().skipNonce;
    fireEvent.click(fading);
    expect(useAssemblyRecallStore.getState()).toMatchObject({ request: null, active: false, fast: false, skipNonce: before });
    act(() => { vi.advanceTimersByTime(REPLAY_SETTLE_MS - 1); });
    expect(screen.getByRole("button", { name: "Skip to the end" })).toBe(fading);
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("settles from when the room was given back, however late it hears of it", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const now = vi.spyOn(performance, "now").mockReturnValue(5_000);
    act(() => { useAssemblyRecallStore.setState({ active: true }); });
    render(<AssemblyReplay />);
    now.mockReturnValue(5_400);
    giveTheRoomBack(5_000);
    act(() => { vi.advanceTimersByTime(REPLAY_SETTLE_MS - 400 - 1); });
    expect(screen.queryByRole("button")).not.toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("is the Skip again if a show starts while it fades", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(performance, "now").mockReturnValue(5_000);
    act(() => { useAssemblyRecallStore.setState({ active: true }); });
    render(<AssemblyReplay />);
    giveTheRoomBack(5_000);
    act(() => { useAssemblyRecallStore.setState({ active: true }); });
    act(() => { vi.advanceTimersByTime(REPLAY_SETTLE_MS * 2); });
    const skip = screen.getByRole("button", { name: "Skip" });
    expect(skip.getAttribute("data-settling")).toBe("false");
    expect(skip.hasAttribute("tabindex")).toBe(false);
  });

  it("gives focus back where it came from as it goes", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(performance, "now").mockReturnValue(5_000);
    act(() => { useAssemblyRecallStore.setState({ active: true }); });
    render(<><button type="button">Present</button><AssemblyReplay /></>);
    const present = screen.getByRole("button", { name: "Present" });
    present.focus();
    screen.getByRole("button", { name: "Skip" }).focus();
    giveTheRoomBack(5_000);
    act(() => { vi.advanceTimersByTime(REPLAY_SETTLE_MS); });
    expect(screen.queryByRole("button", { name: /^Skip/u })).toBeNull();
    expect(document.activeElement).toBe(present);
  });

  it("leaves focus alone if it has moved on by the time the Skip goes", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(performance, "now").mockReturnValue(5_000);
    act(() => { useAssemblyRecallStore.setState({ active: true }); });
    render(<><button type="button">Present</button><button type="button">Add</button><AssemblyReplay /></>);
    screen.getByRole("button", { name: "Present" }).focus();
    screen.getByRole("button", { name: "Skip" }).focus();
    giveTheRoomBack(5_000);
    const add = screen.getByRole("button", { name: "Add" });
    add.focus();
    act(() => { vi.advanceTimersByTime(REPLAY_SETTLE_MS); });
    expect(document.activeElement).toBe(add);
  });

  it("fades across the same window it waits for (assembly.css)", () => {
    const css = readFileSync(path.resolve("src/floor/assembly/assembly.css"), "utf8");
    const settling = /\.assembly-replay\[data-settling="true"\]\s*\{([^}]*)\}/u.exec(css)?.[1] ?? "";
    expect(settling).toContain("opacity: 0;");
    expect(settling).toContain(`transition: opacity ${String(REPLAY_SETTLE_MS)}ms`);
    // It keeps taking presses as it fades: nothing lets them through to the room.
    expect(settling).not.toContain("pointer-events");
  });
});
