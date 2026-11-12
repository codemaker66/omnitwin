import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The director in react-dom with R3F's hooks faked, as the cockpit scene suites do: useFrame hands its callback to
// the test, which steps the frame loop itself, and three's intrinsics (group, primitive) render as inert elements.
// performance.now() is the test's clock, so the hold's beat and the control's settle are exact.
const r3f = vi.hoisted(() => ({
  frame: null as ((state: unknown, delta: number) => void) | null,
  now: 1_000,
  room: null as HTMLElement | null,
  camera: null as { readonly position: { toArray(): number[] } } | null,
}));
vi.mock("@react-three/fiber", async () => {
  const { PerspectiveCamera, Scene, Vector3 } = await import("three");
  const canvas = document.createElement("canvas");
  const room = document.createElement("div");
  room.append(canvas);
  const camera = new PerspectiveCamera(50, 1600 / 900, 0.1, 500);
  r3f.room = room;
  r3f.camera = camera;
  const three = {
    camera,
    controls: { target: new Vector3(), enabled: true },
    size: { width: 1600, height: 900 },
    gl: { domElement: canvas },
    scene: new Scene(),
    invalidate: (): void => undefined,
    get: (): unknown => three,
  };
  return {
    useThree: (selector: (state: typeof three) => unknown) => selector(three),
    useFrame: (callback: (state: unknown, delta: number) => void) => { r3f.frame = callback; },
  };
});

const { useEditorStore } = await import("../../../stores/editor-store.js");
const { useHallViewStore } = await import("../../../stores/hall-view-store.js");
const { usePlacementStore } = await import("../../../stores/placement-store.js");
const { currentFurniturePresentation } = await import("../../presentation-channel.js");
const { ACCIO_CAMERA_LANDSCAPE } = await import("../accio.js");
const { AssemblyReplay, REPLAY_SETTLE_MS } = await import("../AssemblyReplay.js");
const { GrandAssembly } = await import("../GrandAssembly.js");
const { requestAssemblyReplay, resetAssemblyRecallForTests, useAssemblyRecallStore } = await import("../recall.js");
const { grandHallDinner180 } = await import("../fixture.js");

// Three rounds of ten from the 180-seat dinner, as the e2e opens them.
const SEATED = new Set(["ga-group-01", "ga-group-02", "ga-group-03"]);
const layout = grandHallDinner180().filter((item) => item.groupId !== null && SEATED.has(item.groupId));
const FRAME = 1 / 60;

/** One frame of the planner's loop, `seconds` after the last. */
function frame(seconds = FRAME): void {
  r3f.now += seconds * 1_000;
  act(() => { r3f.frame?.({}, seconds); });
}

function control(): HTMLElement {
  return screen.getByRole("button");
}

/** A real press: the window's capture listener sees its pointerdown before the control sees its click. */
function press(target: HTMLElement): boolean {
  const down = fireEvent.pointerDown(target);
  fireEvent.pointerUp(target);
  fireEvent.click(target);
  return down;
}

/** The planner with the Assembly and its control; a replay asked for, held through its empty beat to its first frame. */
function startShow(): void {
  render(<><GrandAssembly onCamera={() => undefined} /><AssemblyReplay /></>);
  act(() => { requestAssemblyReplay(); });
  for (let i = 0; i < 6; i += 1) frame(0.1);
  expect(useAssemblyRecallStore.getState().active).toBe(true);
  expect(currentFurniturePresentation()).not.toBeNull();
}

/** Frames until the show has played to its end (the room then holds its last frame for a beat), or `limit`. */
function playToRest(limit = 2_000): number {
  let frames = 0;
  while (currentFurniturePresentation() !== null && frames < limit) {
    frame();
    frames += 1;
  }
  return frames;
}

/** Console errors other than react-dom naming three's intrinsics as unknown tags: each test ends with none. */
let unexpectedErrors: unknown[][] = [];

beforeEach(() => {
  resetAssemblyRecallForTests();
  r3f.now = 1_000;
  vi.spyOn(performance, "now").mockImplementation(() => r3f.now);
  unexpectedErrors = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    const message = typeof args[0] === "string" ? args[0] : "";
    if (/unrecognized in this browser|incorrect casing|Invalid value for prop|React does not recognize/u.test(message)) return;
    unexpectedErrors.push(args);
  });
  usePlacementStore.setState({ placedItems: layout });
  useEditorStore.setState({ configId: "config-a" });
  useHallViewStore.setState({ surfaces: { total: 0, loaded: 0, failed: 0 } });
  if (r3f.room !== null) document.body.append(r3f.room);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  expect(unexpectedErrors).toEqual([]);
  resetAssemblyRecallForTests();
  usePlacementStore.setState({ placedItems: [] });
  useHallViewStore.setState({ surfaces: null });
  r3f.room?.remove();
});

describe("the Grand Assembly's Skip, through the director", () => {
  it("plays the show on at four times its pace", () => {
    startShow();
    const ownPace = playToRest();
    cleanup();
    resetAssemblyRecallForTests();
    startShow();
    press(control());
    const atSpeed = playToRest();
    expect(ownPace).toBeLessThan(2_000);
    expect(atSpeed).toBeGreaterThan(0);
    expect(atSpeed).toBeLessThan(ownPace / 3);
  });

  it("sends the show straight to its end on the second press, on its final framing", () => {
    startShow();
    for (let i = 0; i < 30; i += 1) frame();
    press(control());
    expect(useAssemblyRecallStore.getState().fast).toBe(true);
    expect(control().textContent).toBe("Skip to the end");
    press(control());
    expect(useAssemblyRecallStore.getState()).toMatchObject({ active: false, fast: false, request: null });
    expect(currentFurniturePresentation()).toBeNull();
    const last = ACCIO_CAMERA_LANDSCAPE[ACCIO_CAMERA_LANDSCAPE.length - 1];
    expect(r3f.camera?.position.toArray()).toEqual(last?.position);
  });

  it("ends the show on a press that lands as it comes to rest; a late press is swallowed, then the Skip is gone (CI, 26 Oct 2026)", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    startShow();
    press(control());
    playToRest();
    // The held ending: the show is over, the room holds its last frame, the control is still the Skip.
    expect(useAssemblyRecallStore.getState().active).toBe(true);
    expect(control().textContent).toBe("Skip to the end");
    press(control());
    expect(useAssemblyRecallStore.getState()).toMatchObject({ active: false, request: null });
    // It stays a moment, fading, with the words it had.
    expect(control().textContent).toBe("Skip to the end");
    expect(control().getAttribute("data-settling")).toBe("true");
    // A press a moment later was aimed at the Skip too: it lands there, and nothing starts.
    press(control());
    expect(useAssemblyRecallStore.getState()).toMatchObject({ active: false, request: null });
    // Then the Skip is gone: Present replays the show.
    act(() => { vi.advanceTimersByTime(REPLAY_SETTLE_MS); });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("brings the planner back at once on the Skip's first press once the show is over, by pointer or by key", () => {
    startShow();
    playToRest();
    expect(useAssemblyRecallStore.getState().active).toBe(true);
    expect(control().textContent).toBe("Skip");
    // Enter or Space on the focused control: a click alone.
    fireEvent.click(control());
    expect(useAssemblyRecallStore.getState()).toMatchObject({ active: false, fast: false, request: null });
    cleanup();
    resetAssemblyRecallForTests();
    startShow();
    playToRest();
    press(control());
    expect(useAssemblyRecallStore.getState()).toMatchObject({ active: false, fast: false, request: null });
  });

  it("swallows a press that lands just after the show has come to rest on its own, then the Skip is gone", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    startShow();
    press(control());
    playToRest();
    // Through the held ending to rest, on the show's clock.
    for (let i = 0; i < 120 && useAssemblyRecallStore.getState().active; i += 1) frame();
    expect(useAssemblyRecallStore.getState().active).toBe(false);
    press(control());
    expect(useAssemblyRecallStore.getState()).toMatchObject({ active: false, request: null });
    act(() => { vi.advanceTimersByTime(REPLAY_SETTLE_MS); });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("lets a press on Present as the show ends bring the planner back, and never start the show again with it", () => {
    let asked: boolean | null = null;
    render(<>
      <GrandAssembly onCamera={() => undefined} />
      <AssemblyReplay />
      <button type="button" onClick={() => { asked = requestAssemblyReplay(); }}>Present</button>
    </>);
    act(() => { requestAssemblyReplay(); });
    for (let i = 0; i < 6; i += 1) frame(0.1);
    playToRest();
    // The held ending: a press on Present, outside the room, brings the planner back on its way down...
    expect(useAssemblyRecallStore.getState().active).toBe(true);
    press(screen.getByRole("button", { name: "Present" }));
    // ...and its click, a moment later, asks for nothing.
    expect(asked).toBe(false);
    expect(useAssemblyRecallStore.getState()).toMatchObject({ active: false, request: null });
    // Once that moment has passed, Present replays the show.
    r3f.now += REPLAY_SETTLE_MS;
    press(screen.getByRole("button", { name: "Present" }));
    expect(asked).toBe(true);
    expect(useAssemblyRecallStore.getState().request).toMatchObject({ reason: "replay" });
  });

  it("is on its stage only while it is mounted: a replay asked for then plays, and none is asked for once it has gone", () => {
    const view = render(<><GrandAssembly onCamera={() => undefined} /><AssemblyReplay /></>);
    expect(useAssemblyRecallStore.getState().onStage).toBe(true);
    let asked = false;
    act(() => { asked = requestAssemblyReplay(); });
    expect(asked).toBe(true);
    for (let i = 0; i < 6; i += 1) frame(0.1);
    expect(useAssemblyRecallStore.getState()).toMatchObject({ active: true, request: null });
    // Mid-show a second request would start the show over: none is asked for.
    expect(requestAssemblyReplay()).toBe(false);
    view.unmount();
    expect(useAssemblyRecallStore.getState()).toMatchObject({ onStage: false, active: false });
    expect(requestAssemblyReplay()).toBe(false);
    expect(useAssemblyRecallStore.getState().request).toBeNull();
    expect(currentFurniturePresentation()).toBeNull();
  });

  it("takes a press on the room as the Skip and keeps it from the planner; in the held ending it brings the planner back", () => {
    startShow();
    const canvas = r3f.room?.querySelector("canvas");
    if (canvas === null || canvas === undefined) throw new Error("no canvas");
    expect(press(canvas)).toBe(false);
    expect(useAssemblyRecallStore.getState().fast).toBe(true);
    playToRest();
    expect(useAssemblyRecallStore.getState().active).toBe(true);
    press(canvas);
    expect(useAssemblyRecallStore.getState()).toMatchObject({ active: false, request: null });
  });
});
