import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PLANNER_SOUND_LEVEL_KEY,
  PLANNER_SOUND_STORAGE_KEY,
  __resetPlannerSoundForTests,
  __setPlannerContextFactoryForTests,
  getPlannerSoundSettings,
} from "../../../lib/sound-registry.js";
import { usePlannerHudStore } from "../../../stores/planner-hud-store.js";
import { HudFrame } from "../HudFrame.js";
import { HudSheets } from "../HudSheets.js";

// ---------------------------------------------------------------------------
// The HUD's Sound setting (T-700; the founder's D1 of 27 Oct: sound is a
// setting in a menu, never a button on the screen, and Shift M mutes). The HUD
// keeps it in More tools, as its spec says: Off, Quiet or Full, what each
// plays, the level and the keys that mute. The three sets are the HUD's own
// radio group, worked by the keys as the event sheet's is. The choice is the
// device's, kept by the registry, so it is the same in every planner chrome.
// ---------------------------------------------------------------------------

/** The speaker's name in the other chrome ("Sound: quiet"). The setting's own names never begin like this. */
const SPEAKER_NAME = /^Sound: /u;

function renderHud(): void {
  render(<HudFrame room={null} plaque={<p>The plaque</p>} eventGuests={null} sheets={<HudSheets />} />);
}

/** Opens More tools from the view's glyph, as a visitor does, and returns the sheet. */
function openTools(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: "More tools" }));
  return screen.getByRole("dialog", { name: "More tools" });
}

function soundGroup(sheet: HTMLElement): HTMLElement {
  return within(sheet).getByRole("radiogroup", { name: "Sound" });
}

function radio(group: HTMLElement, name: "Off" | "Quiet" | "Full"): HTMLElement {
  return within(group).getByRole("radio", { name });
}

beforeEach(() => {
  window.localStorage.clear();
  __resetPlannerSoundForTests();
  // The audio context is only stood in for: choosing a set arms it, and the engine has its own tests.
  __setPlannerContextFactoryForTests(() => null);
  usePlannerHudStore.setState({ firstOpenDone: true, sheet: null });
});

afterEach(() => {
  cleanup();
  act(() => { usePlannerHudStore.setState({ sheet: null }); });
  __setPlannerContextFactoryForTests(null);
  __resetPlannerSoundForTests();
  window.localStorage.clear();
});

describe("Sound in the HUD's More tools", () => {
  it("is a radio group of Off, Quiet and Full, Quiet chosen until the visitor chooses", () => {
    renderHud();
    const group = soundGroup(openTools());
    expect(within(group).getAllByRole("radio").map((one) => one.textContent)).toEqual(["Off", "Quiet", "Full"]);
    expect(radio(group, "Quiet").getAttribute("aria-checked")).toBe("true");
    expect(radio(group, "Off").getAttribute("aria-checked")).toBe("false");
    expect(radio(group, "Full").getAttribute("aria-checked")).toBe("false");
    // Nothing is written to the device until a choice is made.
    expect(window.localStorage.getItem(PLANNER_SOUND_STORAGE_KEY)).toBeNull();
    // The HUD's own choices, as the event sheet draws them.
    expect(group.classList.contains("hud-choices")).toBe(true);
    for (const one of within(group).getAllByRole("radio")) expect(one.classList.contains("hud-choice")).toBe(true);
  });

  it("follows the tools' keys, and says what the chosen set plays", () => {
    renderHud();
    const sheet = openTools();
    const group = soundGroup(sheet);
    const snapping = within(sheet).getByRole("button", { name: /Snapping to the grid|Placing freely/u });
    expect(snapping.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(sheet).getByText(/^Pieces set down in the room/u)).toBeTruthy();
  });

  it("keeps a choice of Off on the device, and leaves the sheet open", () => {
    renderHud();
    const sheet = openTools();
    const group = soundGroup(sheet);
    fireEvent.click(radio(group, "Off"));
    expect(window.localStorage.getItem(PLANNER_SOUND_STORAGE_KEY)).toBe("off");
    expect(getPlannerSoundSettings().mode).toBe("off");
    expect(radio(group, "Off").getAttribute("aria-checked")).toBe("true");
    expect(radio(group, "Quiet").getAttribute("aria-checked")).toBe("false");
    expect(within(sheet).getByText("Nothing plays.")).toBeTruthy();
    // A setting is set without leaving the sheet.
    expect(screen.getByRole("dialog", { name: "More tools" })).toBe(sheet);
    expect(usePlannerHudStore.getState().sheet).toBe("tools");
  });

  it("is one stop in the Tab order, and the arrows move the choice and wrap, as the event sheet's do", () => {
    renderHud();
    const group = soundGroup(openTools());
    expect(within(group).getAllByRole("radio").map((one) => one.tabIndex)).toEqual([-1, 0, -1]);
    act(() => { radio(group, "Quiet").focus(); });
    fireEvent.keyDown(radio(group, "Quiet"), { key: "ArrowRight" });
    expect(getPlannerSoundSettings().mode).toBe("full");
    expect(document.activeElement).toBe(radio(group, "Full"));
    expect(radio(group, "Full").getAttribute("aria-checked")).toBe("true");
    expect(within(group).getAllByRole("radio").map((one) => one.tabIndex)).toEqual([-1, -1, 0]);
    fireEvent.keyDown(radio(group, "Full"), { key: "ArrowRight" });
    expect(getPlannerSoundSettings().mode).toBe("off");
    expect(document.activeElement).toBe(radio(group, "Off"));
    fireEvent.keyDown(radio(group, "Off"), { key: "ArrowLeft" });
    expect(getPlannerSoundSettings().mode).toBe("full");
    fireEvent.keyDown(radio(group, "Full"), { key: "Home" });
    expect(getPlannerSoundSettings().mode).toBe("off");
    expect(window.localStorage.getItem(PLANNER_SOUND_STORAGE_KEY)).toBe("off");
  });

  it("sets the level from its range, and keeps it on the device", () => {
    renderHud();
    const sheet = openTools();
    const level = within(sheet).getByRole("slider", { name: "Level" });
    expect(level.getAttribute("aria-valuetext")).toBe(`${String(Math.round(getPlannerSoundSettings().level * 100))}%`);
    fireEvent.change(level, { target: { value: "35" } });
    expect(getPlannerSoundSettings().level).toBeCloseTo(0.35, 5);
    expect(level.getAttribute("aria-valuetext")).toBe("35%");
    expect(window.localStorage.getItem(PLANNER_SOUND_LEVEL_KEY)).not.toBeNull();
    expect(level.classList.contains("hud-sound__range")).toBe(true);
  });

  it("names Shift M, in the HUD's own key caps", () => {
    renderHud();
    const sheet = openTools();
    const caps = Array.from(sheet.querySelectorAll("kbd.hud-sound__key"), (cap) => cap.textContent);
    expect(caps).toEqual(["Shift", "M"]);
    expect(within(sheet).getByText("mutes and unmutes")).toBeTruthy();
  });

  it("wears none of the other chromes' looks", () => {
    renderHud();
    const setting = soundGroup(openTools()).closest(".hud-sound");
    if (!(setting instanceof HTMLElement)) throw new Error("the sound setting is not the HUD's");
    const names = [setting, ...setting.querySelectorAll("*")].flatMap((element) => [...element.classList]);
    expect(names.filter((name) => !name.startsWith("hud-"))).toEqual([]);
  });
});

describe("no button on the HUD's screen", () => {
  it("names nothing like the other chrome's speaker, with More tools shut or open", () => {
    renderHud();
    const speakers = (): readonly HTMLElement[] => [...new Set([
      ...screen.queryAllByRole("button", { name: SPEAKER_NAME, hidden: true }),
      ...screen.queryAllByLabelText(SPEAKER_NAME),
      ...screen.queryAllByText(SPEAKER_NAME),
      ...screen.queryAllByTitle(SPEAKER_NAME),
    ])];
    expect(speakers()).toEqual([]);
    // Nothing on the shut screen speaks of sound at all: the setting is only in the sheet.
    expect(screen.queryByRole("radiogroup", { name: "Sound" })).toBeNull();
    openTools();
    expect(speakers()).toEqual([]);
    expect(screen.queryAllByRole("button", { name: /sound|mute/iu })).toEqual([]);
  });
});
