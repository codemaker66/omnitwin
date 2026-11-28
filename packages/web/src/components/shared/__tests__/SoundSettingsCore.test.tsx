import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PLANNER_SOUND_LEVEL_KEY,
  PLANNER_SOUND_STORAGE_KEY,
  __resetPlannerSoundForTests,
  __setPlannerContextFactoryForTests,
  getPlannerSoundSettings,
} from "../../../lib/sound-registry.js";
import { SOUND_MODE_LINES, SoundSettingsCore } from "../SoundSettingsCore.js";

// ---------------------------------------------------------------------------
// The sound setting's chrome-free core (T-700, T-671): a plain radio group for
// Off · Quiet · Full that keeps the keyboard's radio rules, the level, and the
// keys that mute. A chrome may lend it its own control, key caps, class names
// and drawn track; with none it is plain HTML.
// ---------------------------------------------------------------------------

let armed = 0;

beforeEach(() => {
  localStorage.clear();
  __resetPlannerSoundForTests();
  armed = 0;
  __setPlannerContextFactoryForTests(() => {
    armed += 1;
    return null;
  });
});

afterEach(() => {
  cleanup();
  __setPlannerContextFactoryForTests(null);
  __resetPlannerSoundForTests();
  localStorage.clear();
});

function radio(name: string): HTMLElement {
  return within(screen.getByRole("radiogroup", { name: "Sound" })).getByRole("radio", { name });
}

describe("the plain radio group", () => {
  it("is Off · Quiet · Full with Quiet chosen, one tab stop on the chosen set, and says what it plays", () => {
    render(<SoundSettingsCore />);
    const radios = within(screen.getByRole("radiogroup", { name: "Sound" })).getAllByRole("radio");
    expect(radios.map((option) => option.textContent)).toEqual(["Off", "Quiet", "Full"]);
    expect(radios.map((option) => option.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    expect(radios.map((option) => option.tabIndex)).toEqual([-1, 0, -1]);
    expect(screen.getByText(SOUND_MODE_LINES.quiet)).toBeTruthy();
  });

  it("moves the choice with the arrows, wrapping, and goes to the ends with Home and End", () => {
    render(<SoundSettingsCore />);
    const group = screen.getByRole("radiogroup", { name: "Sound" });
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(getPlannerSoundSettings().mode).toBe("full");
    expect(document.activeElement).toBe(radio("Full"));
    fireEvent.keyDown(group, { key: "ArrowDown" });
    expect(getPlannerSoundSettings().mode, "past the end it wraps").toBe("off");
    fireEvent.keyDown(group, { key: "ArrowLeft" });
    expect(getPlannerSoundSettings().mode).toBe("full");
    fireEvent.keyDown(group, { key: "Home" });
    expect(getPlannerSoundSettings().mode).toBe("off");
    expect(radio("Off").tabIndex).toBe(0);
    fireEvent.keyDown(group, { key: "End" });
    expect(getPlannerSoundSettings().mode).toBe("full");
    fireEvent.keyDown(group, { key: "ArrowUp" });
    expect(getPlannerSoundSettings().mode).toBe("quiet");
    expect(screen.getByText(SOUND_MODE_LINES.quiet)).toBeTruthy();
  });

  it("keeps a choice on the device, and arms the planner's sound when a set is chosen", () => {
    render(<SoundSettingsCore />);
    fireEvent.click(radio("Off"));
    expect(localStorage.getItem(PLANNER_SOUND_STORAGE_KEY)).toBe("off");
    expect(armed).toBe(0);
    fireEvent.click(radio("Full"));
    expect(localStorage.getItem(PLANNER_SOUND_STORAGE_KEY)).toBe("full");
    expect(armed, "choosing Full is a deliberate gesture").toBe(1);
  });
});

describe("the level and the keys", () => {
  it("sets the level from a tenth up, with its figure, and names Shift M as plain keys", () => {
    render(<SoundSettingsCore />);
    const level = screen.getByRole("slider", { name: "Level" });
    expect(level.getAttribute("min")).toBe("10");
    fireEvent.change(level, { target: { value: "35" } });
    expect(getPlannerSoundSettings().level).toBeCloseTo(0.35, 9);
    expect(localStorage.getItem(PLANNER_SOUND_LEVEL_KEY)).not.toBeNull();
    expect(level.getAttribute("aria-valuetext")).toBe("35%");
    expect(screen.getByText("35%")).toBeTruthy();
    expect([...document.querySelectorAll("kbd")].map((key) => key.textContent)).toEqual(["Shift", "M"]);
    expect(level.style.length, "no drawn track asked for, so no style is written").toBe(0);
  });
});

describe("dressed by a chrome", () => {
  it("takes the chrome's class names, control, key caps and drawn track", () => {
    render(
      <SoundSettingsCore
        classes={{ root: "look", section: "look__section", line: "look__line", range: "look__range", keys: "look__keys" }}
        renderModes={(modes) => (
          <div role="radiogroup" aria-label={modes.label} data-lent="">
            {modes.options.map((option) => (
              <button key={option.value} type="button" role="radio" aria-checked={option.value === modes.value} onClick={() => { modes.onChange(option.value); }}>
                {option.label}
              </button>
            ))}
          </div>
        )}
        renderKey={(key) => <kbd className="cap">{key}</kbd>}
        levelFillProperty="--fill"
      />,
    );
    const group = screen.getByRole("radiogroup", { name: "Sound" });
    expect(group.hasAttribute("data-lent")).toBe(true);
    fireEvent.click(within(group).getByRole("radio", { name: "Off" }));
    expect(getPlannerSoundSettings().mode).toBe("off");
    expect(document.querySelector(".look > .look__section > .look__line")?.textContent).toBe(SOUND_MODE_LINES.off);
    expect([...document.querySelectorAll(".look__keys > kbd.cap")].map((key) => key.textContent)).toEqual(["Shift", "M"]);
    const level = screen.getByRole("slider", { name: "Level" });
    expect(level.className).toBe("look__range");
    // The default level, 0.6, is 50/90 of the way from a tenth to the top.
    expect(level.style.getPropertyValue("--fill")).toBe((50 / 90).toFixed(3));
    fireEvent.change(level, { target: { value: "100" } });
    expect(level.style.getPropertyValue("--fill")).toBe("1.000");
  });
});
