import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useHallTimeStore } from "../../../../stores/hall-time-store.js";
import { hallDay, hallDayStart } from "../../../grand-hall/hall-sun-times.js";
import { HALL_OBSERVER } from "../../../grand-hall/hall-site.js";
import { SUN_EVENT_ALTITUDE, sunPosition } from "../../../../lib/sky/ephemeris.js";
import { formatWallTime, wallInputToMs } from "../../../../pages/diary/lib/board-time.js";
import { HallSunButton, HallSunDial, moonPhasePath } from "../HallSunDial.js";

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
    const { container } = render(<HallSunDial />);
    const slider = band();
    const day = hallDay(MIDSUMMER_NOON);
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(useHallTimeStore.getState().at).toBe(MIDSUMMER_NOON + 5 * MINUTE);
    fireEvent.keyDown(slider, { key: "ArrowLeft", shiftKey: true });
    expect(useHallTimeStore.getState().at).toBe(MIDSUMMER_NOON - 55 * MINUTE);
    fireEvent.keyDown(slider, { key: "PageUp" });
    expect(useHallTimeStore.getState().at).toBe(MIDSUMMER_NOON + 5 * MINUTE);
    // Sunrise and sunset are the first and last whole minutes the sun is up,
    // and the sun is drawn at both.
    fireEvent.keyDown(slider, { key: "Home" });
    expect(useHallTimeStore.getState().at).toBe(Math.ceil((day.times.sunrise ?? 0) / MINUTE) * MINUTE);
    expect(container.querySelector(".hall-sun-dial__sun")).not.toBeNull();
    fireEvent.keyDown(slider, { key: "End" });
    expect(useHallTimeStore.getState().at).toBe(Math.floor((day.times.sunset ?? 0) / MINUTE) * MINUTE);
    expect(container.querySelector(".hall-sun-dial__sun")).not.toBeNull();
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

  it("keeps a hand dragged past either end of the band within the day", () => {
    render(<HallSunDial />);
    const slider = band();
    const day = hallDay(MIDSUMMER_NOON);
    // The band's right end is the next midnight: a captured hand held past it
    // once carried the date on by a day at every move.
    fireEvent.pointerDown(slider, { button: 0, pointerId: 1, clientX: BAND_WIDTH + 40 });
    expect(useHallTimeStore.getState().at).toBe(day.dayEnd - MINUTE);
    for (const clientX of [BAND_WIDTH + 80, BAND_WIDTH + 120]) {
      fireEvent.pointerMove(slider, { pointerId: 1, clientX });
      expect(useHallTimeStore.getState().at).toBe(day.dayEnd - MINUTE);
      expect(hallDayStart(useHallTimeStore.getState().at)).toBe(day.dayStart);
    }
    for (const clientX of [-40, -80]) {
      fireEvent.pointerMove(slider, { pointerId: 1, clientX });
      expect(useHallTimeStore.getState().at).toBe(day.dayStart);
    }
    fireEvent.pointerUp(slider, { pointerId: 1, clientX: -80 });
    expect(useHallTimeStore.getState()).toMatchObject({ at: day.dayStart, scrubbing: false });
  });

  it("ends the scrub when the band loses the pointer, or the dial closes mid-drag", () => {
    const { unmount } = render(<HallSunDial />);
    const slider = band();
    fireEvent.pointerDown(slider, { button: 0, pointerId: 1, clientX: BAND_WIDTH * 0.5 });
    expect(useHallTimeStore.getState().scrubbing).toBe(true);
    fireEvent.lostPointerCapture(slider, { pointerId: 1 });
    expect(useHallTimeStore.getState().scrubbing).toBe(false);
    fireEvent.pointerDown(slider, { button: 0, pointerId: 1, clientX: BAND_WIDTH * 0.25 });
    expect(useHallTimeStore.getState().scrubbing).toBe(true);
    unmount();
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

  it("shows no sun before the sunrise it lists, and the sun from that minute", () => {
    const day = hallDay(MIDSUMMER_NOON);
    const listed = Math.ceil((day.times.sunrise ?? Number.NaN) / MINUTE) * MINUTE;
    const before = listed - 2 * MINUTE;
    // The old rule (apparent altitude above −0.8°) already called the sun up
    // here, below the horizon the listed sunrise is reckoned by.
    const early = sunPosition(before, HALL_OBSERVER);
    expect(early.altitude).toBeGreaterThan(-0.8);
    expect(early.trueAltitude).toBeLessThan(SUN_EVENT_ALTITUDE.horizon);

    useHallTimeStore.setState({ at: before });
    const { container } = render(
      <>
        <HallSunDial />
        <HallSunButton open={false} onToggle={() => undefined} />
      </>,
    );
    expect(screen.getByText(`Sunrise ${formatWallTime(listed)}`)).toBeTruthy();
    expect(container.querySelector(".hall-sun-dial__sun")).toBeNull();
    expect(band().getAttribute("aria-valuetext")).not.toMatch(/Sun -?\d+° up/u);
    expect(container.querySelector(".hall-sun-button .lucide-moon")).not.toBeNull();

    act(() => { useHallTimeStore.setState({ at: listed }); });
    expect(container.querySelector(".hall-sun-dial__sun")).not.toBeNull();
    expect(band().getAttribute("aria-valuetext")).toMatch(/^\d\d:\d\d\. Sun \d+° up, /u);
    expect(container.querySelector(".hall-sun-button .lucide-sun")).not.toBeNull();
  });

  it("reads the clock afresh as Now is pressed, then again as each minute turns", () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(MIDSUMMER_NOON + 30_000);
    const { container } = render(
      <>
        <HallSunDial />
        <HallSunButton open={false} onToggle={() => undefined} />
      </>,
    );
    // Two hours on, with the hall still at a set time: nothing has read the clock.
    vi.setSystemTime(MIDSUMMER_NOON + 2 * 60 * MINUTE + 30_000);
    fireEvent.click(screen.getByRole("button", { name: "Now" }));
    expect(container.querySelector(".hall-sun-dial__clock")?.textContent).toBe("14:00");
    expect(screen.getByRole("button", { name: "Time of day, 14:00" })).toBeTruthy();
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(container.querySelector(".hall-sun-dial__clock")?.textContent).toBe("14:01");
    expect(screen.getByRole("button", { name: "Time of day, 14:01" })).toBeTruthy();
  });

  it("names its button for what it is, keeping the hour in the name", () => {
    render(<HallSunButton open={false} onToggle={() => undefined} />);
    const button = screen.getByRole("button", { name: "Time of day, 12:00" });
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows the year on the date once it is not this year's", () => {
    const { container } = render(<HallSunDial />);
    const chip = (): string | null | undefined => container.querySelector(".hall-sun-dial__date-text")?.textContent;
    expect(chip()).toBe("Sun 21 Jun");
    act(() => { useHallTimeStore.setState({ at: Date.UTC(2027, 5, 12, 11, 0) }); });
    expect(chip()).toBe("Sat 12 Jun 2027");
  });

  it("holds a year being typed until it is a whole one, then takes it", () => {
    const { container } = render(<HallSunDial />);
    const input = screen.getByLabelText<HTMLInputElement>("Date");
    // A typed year passes through each partial one; none may send the hall there.
    for (const partial of ["0002-06-21", "0020-06-21", "0202-06-21"]) {
      fireEvent.change(input, { target: { value: partial } });
      expect(useHallTimeStore.getState().at).toBe(MIDSUMMER_NOON);
      expect(input.value).toBe(partial);
    }
    fireEvent.change(input, { target: { value: "2027-06-21" } });
    expect(useHallTimeStore.getState().at).toBe(wallInputToMs("2027-06-21T12:00"));
    expect(container.querySelector(".hall-sun-dial__date-text")?.textContent).toBe("Mon 21 Jun 2027");
    fireEvent.change(input, { target: { value: "2201-06-21" } });
    expect(useHallTimeStore.getState().at).toBe(wallInputToMs("2027-06-21T12:00"));
    // Left part-typed, the field shows the hall's own date again.
    fireEvent.blur(input);
    expect(input.value).toBe("2027-06-21");
  });

  it("carries the LiDAR survey's credit at its foot, with the licence a link away", () => {
    const credit = "Contains LiDAR data: Crown copyright Scottish Government and Fugro (2020), OGL v3.0";
    const { rerender } = render(<HallSunDial />);
    for (const inline of [false, true]) {
      rerender(<HallSunDial inline={inline} />);
      const foot = screen.getByTestId("hall-sun-dial").lastElementChild;
      expect(foot?.textContent).toBe(credit);
      const licence = screen.getByRole("link", { name: "OGL v3.0" });
      expect(foot?.contains(licence)).toBe(true);
      expect(licence.getAttribute("href")).toBe("https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/");
      expect(licence.getAttribute("target")).toBe("_blank");
      expect(licence.getAttribute("rel")?.split(" ")).toContain("noopener");
    }
  });

  it("is held to a given height, and scrolls within", () => {
    render(<HallSunDial maxHeight={180} />);
    expect(screen.getByTestId("hall-sun-dial").style.maxHeight).toBe("180px");
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

describe("HallSunDial's sunrise and sunset minutes", () => {
  it("lists minutes the sun is up even where the crossing falls on a minute's edge", () => {
    // 11 January 2028: sunset's floored minute was a whisker below the horizon.
    const noon = Date.UTC(2028, 0, 11, 12, 0);
    vi.setSystemTime(noon);
    useHallTimeStore.setState({ mode: "set", at: noon });
    const { container } = render(<HallSunDial />);
    const slider = band();
    for (const key of ["End", "Home"]) {
      fireEvent.keyDown(slider, { key });
      const shown = sunPosition(useHallTimeStore.getState().at, HALL_OBSERVER);
      expect(shown.trueAltitude).toBeGreaterThan(SUN_EVENT_ALTITUDE.horizon);
      expect(container.querySelector(".hall-sun-dial__sun")).not.toBeNull();
    }
  });
});
