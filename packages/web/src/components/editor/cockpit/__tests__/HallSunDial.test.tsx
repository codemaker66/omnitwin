import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useHallTimeStore } from "../../../../stores/hall-time-store.js";
import { hallDay } from "../../../grand-hall/hall-sun-times.js";
import { HallSunDial, moonPhasePath } from "../HallSunDial.js";

const MINUTE = 60_000;
/** Noon BST on midsummer's day 2026. */
const MIDSUMMER_NOON = Date.UTC(2026, 5, 21, 11, 0);
const BAND_WIDTH = 344;

beforeAll(() => {
  // jsdom has no PointerEvent: a mouse event with an id carries the same fields.
  if (typeof window.PointerEvent === "undefined") {
    class TestPointerEvent extends MouseEvent {
      readonly pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    }
    Object.defineProperty(window, "PointerEvent", { value: TestPointerEvent, configurable: true });
  }
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(MIDSUMMER_NOON + 3 * 60 * MINUTE);
  useHallTimeStore.setState({ mode: "set", at: MIDSUMMER_NOON, scrubbing: false, openedFor: null, chosen: false });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function band(): SVGSVGElement {
  const slider = screen.getByRole("slider", { name: "Time of day" });
  if (!(slider instanceof SVGSVGElement)) throw new Error("The day band is not an SVG");
  // jsdom lays nothing out: give the band its drawn width at the page's origin.
  slider.getBoundingClientRect = () => new DOMRect(0, 0, BAND_WIDTH, 112);
  slider.setPointerCapture = () => undefined;
  slider.hasPointerCapture = () => true;
  slider.releasePointerCapture = () => undefined;
  return slider;
}

describe("HallSunDial", () => {
  it("reads the shown moment as the venue's own time, with the sun's place", () => {
    render(<HallSunDial />);
    const slider = band();
    expect(screen.getByText("12:00")).toBeTruthy();
    expect(slider.getAttribute("aria-valuenow")).toBe("720");
    expect(slider.getAttribute("aria-valuemax")).toBe("1440");
    expect(slider.getAttribute("aria-valuetext")).toMatch(/^12:00\. Sun \d+° up, /u);
    expect(screen.getByText(/^Sun on the floor \d\d:\d\d–\d\d:\d\d/u)).toBeTruthy();
  });

  it("moves the time by five minutes, an hour with Shift, and to sunrise and sunset", () => {
    render(<HallSunDial />);
    const slider = band();
    const day = hallDay(MIDSUMMER_NOON);
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(useHallTimeStore.getState().at).toBe(MIDSUMMER_NOON + 5 * MINUTE);
    fireEvent.keyDown(slider, { key: "ArrowLeft", shiftKey: true });
    expect(useHallTimeStore.getState().at).toBe(MIDSUMMER_NOON - 55 * MINUTE);
    fireEvent.keyDown(slider, { key: "PageUp" });
    expect(useHallTimeStore.getState().at).toBe(MIDSUMMER_NOON + 5 * MINUTE);
    fireEvent.keyDown(slider, { key: "Home" });
    expect(useHallTimeStore.getState().at).toBe(Math.round((day.times.sunrise ?? 0) / MINUTE) * MINUTE);
    fireEvent.keyDown(slider, { key: "End" });
    expect(useHallTimeStore.getState().at).toBe(Math.round((day.times.sunset ?? 0) / MINUTE) * MINUTE);
  });

  it("keeps the keys within the day", () => {
    const day = hallDay(MIDSUMMER_NOON);
    useHallTimeStore.setState({ at: day.dayEnd - 3 * MINUTE });
    render(<HallSunDial />);
    fireEvent.keyDown(band(), { key: "ArrowRight" });
    expect(useHallTimeStore.getState().at).toBe(day.dayEnd - MINUTE);
  });

  it("follows a dragging hand, then lets the room settle when it leaves", () => {
    render(<HallSunDial />);
    const slider = band();
    const day = hallDay(MIDSUMMER_NOON);
    fireEvent.pointerDown(slider, { button: 0, pointerId: 1, clientX: BAND_WIDTH * 0.25 });
    expect(useHallTimeStore.getState()).toMatchObject({ at: day.dayStart + 6 * 60 * MINUTE, scrubbing: true });
    fireEvent.pointerMove(slider, { pointerId: 1, clientX: BAND_WIDTH * 0.75 });
    expect(useHallTimeStore.getState()).toMatchObject({ at: day.dayStart + 18 * 60 * MINUTE, scrubbing: true });
    fireEvent.pointerUp(slider, { pointerId: 1, clientX: BAND_WIDTH * 0.75 });
    expect(useHallTimeStore.getState().scrubbing).toBe(false);
  });

  it("settles a dragged sun on solar noon as the hand passes it", () => {
    render(<HallSunDial />);
    const slider = band();
    const day = hallDay(MIDSUMMER_NOON);
    const noonX = ((day.times.solarNoon - day.dayStart) / (day.dayEnd - day.dayStart)) * BAND_WIDTH;
    fireEvent.pointerDown(slider, { button: 0, pointerId: 1, clientX: noonX + 3 });
    expect(useHallTimeStore.getState().at).toBe(Math.round(day.times.solarNoon / MINUTE) * MINUTE);
  });

  it("sends the sun to a named moment, and Now follows the clock again", () => {
    render(<HallSunDial />);
    const day = hallDay(MIDSUMMER_NOON);
    fireEvent.click(screen.getByRole("button", { name: "Noon" }));
    expect(useHallTimeStore.getState().at).toBe(Math.round(day.times.solarNoon / MINUTE) * MINUTE);
    const now = screen.getByRole("button", { name: "Now" });
    expect(now.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(now);
    expect(useHallTimeStore.getState().mode).toBe("now");
    expect(screen.getByRole("button", { name: "Now" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("shows the moon in its phase once the sun has set", () => {
    useHallTimeStore.setState({ at: Date.UTC(2026, 5, 21, 0, 30) });
    const { container } = render(<HallSunDial />);
    expect(container.querySelector(".hall-sun-dial__moon")).not.toBeNull();
    expect(container.querySelector(".hall-sun-dial__sun")).toBeNull();
    expect(band().getAttribute("aria-valuetext")).not.toMatch(/Sun \d+° up/u);
  });
});

describe("moonPhasePath", () => {
  it("draws a full moon as two half circles and a half moon with a straight terminator", () => {
    expect(moonPhasePath(7, 1, true)).toBe("M 0 -7 A 7 7 0 0 1 0 7 A 7.000 7 0 0 1 0 -7 Z");
    expect(moonPhasePath(7, 0.5, true)).toContain("A 0.000 7");
  });

  it("lights the right limb while waxing and the left while waning", () => {
    expect(moonPhasePath(7, 0.25, true)).toMatch(/^M 0 -7 A 7 7 0 0 1 /u);
    expect(moonPhasePath(7, 0.25, false)).toMatch(/^M 0 -7 A 7 7 0 0 0 /u);
  });

  it("clamps a lit share outside 0..1", () => {
    expect(moonPhasePath(7, 1.4, true)).toBe(moonPhasePath(7, 1, true));
    expect(moonPhasePath(7, -0.2, true)).toBe(moonPhasePath(7, 0, true));
  });
});
