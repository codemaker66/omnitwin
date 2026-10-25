import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PLANNER_SOUND_LEVEL_KEY,
  PLANNER_SOUND_STORAGE_KEY,
  __resetPlannerSoundForTests,
  __setPlannerContextFactoryForTests,
  getPlannerSoundSettings,
  setPlannerSoundMode,
} from "../../../lib/sound-registry.js";
import { Key } from "../Keys.js";
import { SOUND_MODE_LINES, SoundControl, soundKeyLabel } from "../SoundControl.js";
import { TOOLTIP_FIRST_DELAY_MS, useTooltipStore } from "../Tooltip.js";
import { registerEscapeLayer } from "../../../lib/planner-keys.js";

// ---------------------------------------------------------------------------
// The speaker (T-671, slice 3; spec 9): it names the set in use, opens Off ·
// Quiet · Full with the level from its own edge, closes on Esc, a press
// elsewhere or tabbing away, and Shift M mutes and brings back what was muted.
// Choosing is silent; a choice of a set arms the one context.
// ---------------------------------------------------------------------------

let made = 0;

beforeEach(() => {
  localStorage.clear();
  __resetPlannerSoundForTests();
  useTooltipStore.setState({ current: null, lastHiddenAt: Number.NEGATIVE_INFINITY });
  made = 0;
  // The context is only counted here: the engine's own tests cover what it builds.
  __setPlannerContextFactoryForTests(() => {
    made += 1;
    return null;
  });
});

afterEach(() => {
  cleanup();
  __setPlannerContextFactoryForTests(null);
  __resetPlannerSoundForTests();
  localStorage.clear();
  vi.useRealTimers();
});

function speaker(): HTMLElement {
  return screen.getByRole("button", { name: /^Sound: / });
}

function openPanel(): HTMLElement {
  fireEvent.click(speaker());
  return screen.getByRole("dialog", { name: "Sound" });
}

describe("the speaker", () => {
  it("names the set in use and its keys, and says it opens a panel", () => {
    render(<SoundControl />);
    const key = screen.getByRole("button", { name: "Sound: quiet, Shift M" });
    expect(key.getAttribute("aria-keyshortcuts")).toBe("Shift+M");
    expect(key.getAttribute("aria-haspopup")).toBe("dialog");
    expect(key.getAttribute("aria-expanded")).toBe("false");
    expect(soundKeyLabel("quiet")).toBe("Sound: quiet");
  });

  it("opens Off · Quiet · Full with focus on the set in use", () => {
    render(<SoundControl />);
    const panel = openPanel();
    expect(speaker().getAttribute("aria-expanded")).toBe("true");
    expect(speaker().getAttribute("aria-controls")).toBe(panel.id);
    const group = within(panel).getByRole("radiogroup", { name: "Sound" });
    const options = within(group).getAllByRole("radio").map((radio) => radio.textContent);
    expect(options).toEqual(["Off", "Quiet", "Full"]);
    expect(document.activeElement).toBe(within(group).getByRole("radio", { name: "Quiet" }));
    expect(within(panel).getByText(SOUND_MODE_LINES.quiet)).toBeTruthy();
  });

  it("keeps a chosen set, names it on the speaker and arms the context, without a sound", () => {
    render(<SoundControl />);
    const panel = openPanel();
    fireEvent.click(within(panel).getByRole("radio", { name: "Full" }));
    expect(localStorage.getItem(PLANNER_SOUND_STORAGE_KEY)).toBe("full");
    expect(speaker().getAttribute("aria-label")).toBe("Sound: full, Shift M");
    expect(within(panel).getByText(SOUND_MODE_LINES.full)).toBeTruthy();
    expect(made, "choosing a set is a deliberate gesture: the context is made then").toBe(1);
    fireEvent.click(within(panel).getByRole("radio", { name: "Off" }));
    expect(getPlannerSoundSettings().mode).toBe("off");
    expect(made, "choosing Off makes nothing").toBe(1);
  });

  it("closes on Escape, returns focus to the speaker, and lets that Escape do nothing else", () => {
    // A selection held under the panel: Esc steps back one layer, the panel's.
    const clearSelection = vi.fn();
    const stop = registerEscapeLayer({ kind: "selection", isOpen: () => true, escape: clearSelection });
    try {
      render(<SoundControl />);
      const panel = openPanel();
      fireEvent.keyDown(within(panel).getByRole("radio", { name: "Off" }), { key: "Escape" });
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(speaker());
      expect(clearSelection).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });

  it("closes on a press elsewhere, not on a press inside", () => {
    render(<><SoundControl /><button type="button">Elsewhere</button></>);
    const panel = openPanel();
    fireEvent.pointerDown(within(panel).getByRole("slider", { name: "Level" }));
    expect(screen.queryByRole("dialog")).not.toBeNull();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Elsewhere" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes when focus leaves it", () => {
    render(<><SoundControl /><button type="button">Next</button></>);
    const panel = openPanel();
    const next = screen.getByRole("button", { name: "Next" });
    fireEvent.focusOut(within(panel).getByRole("radio", { name: "Off" }), { relatedTarget: next });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("toggles from the speaker itself", () => {
    render(<SoundControl />);
    openPanel();
    fireEvent.click(speaker());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(speaker().getAttribute("aria-expanded")).toBe("false");
  });

  it("sets the level from a tenth to all of it, kept per device", () => {
    render(<SoundControl />);
    const panel = openPanel();
    const level = within(panel).getByRole<HTMLInputElement>("slider", { name: "Level" });
    expect(level.getAttribute("min")).toBe("10");
    expect(level.getAttribute("max")).toBe("100");
    expect(level.getAttribute("step")).toBe("5");
    expect(level.value).toBe("60");
    expect(level.getAttribute("aria-valuetext")).toBe("60%");
    expect(level.style.getPropertyValue("--pc-range-f")).toBe("0.556");
    fireEvent.change(level, { target: { value: "80" } });
    expect(localStorage.getItem(PLANNER_SOUND_LEVEL_KEY)).toBe("0.8");
    expect(level.getAttribute("aria-valuetext")).toBe("80%");
    expect(level.style.getPropertyValue("--pc-range-f")).toBe("0.778");
  });

  it("shows no tooltip while its panel is open", () => {
    vi.useFakeTimers();
    render(<Key label="Sound: quiet" iconOnly shortcut={["Shift", "M"]} expanded />);
    fireEvent.pointerEnter(screen.getByRole("button"), { pointerType: "mouse" });
    act(() => { vi.advanceTimersByTime(TOOLTIP_FIRST_DELAY_MS + 10); });
    expect(useTooltipStore.getState().current).toBeNull();
    expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("true");
  });
});

describe("Shift M", () => {
  it("mutes and brings back what was muted", () => {
    render(<SoundControl />);
    act(() => { setPlannerSoundMode("full"); });
    fireEvent.keyDown(document.body, { key: "M", shiftKey: true });
    expect(getPlannerSoundSettings().mode).toBe("off");
    expect(speaker().getAttribute("aria-label")).toBe("Sound: off, Shift M");
    const before = made;
    fireEvent.keyDown(document.body, { key: "M", shiftKey: true });
    expect(getPlannerSoundSettings().mode).toBe("full");
    expect(made - before, "turning sound on from the keyboard arms it").toBe(1);
  });

  it("starts a new device on Quiet (Blake's D1), and Shift M turns it off", () => {
    render(<SoundControl />);
    expect(getPlannerSoundSettings().mode).toBe("quiet");
    fireEvent.keyDown(document.body, { key: "M", shiftKey: true });
    expect(getPlannerSoundSettings().mode).toBe("off");
  });

  it("leaves typing, other chords and held keys alone", () => {
    render(<><SoundControl /><input aria-label="Guest name" /></>);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Guest name" }), { key: "M", shiftKey: true });
    fireEvent.keyDown(document.body, { key: "M", shiftKey: true, ctrlKey: true });
    fireEvent.keyDown(document.body, { key: "M", shiftKey: true, repeat: true });
    fireEvent.keyDown(document.body, { key: "m" });
    expect(getPlannerSoundSettings().mode).toBe("quiet");
  });

  it("reads only Shift with M, outside text", () => {
    render(<><SoundControl /><input type="range" aria-label="Level" /><textarea aria-label="Note" /></>);
    const mode = (): string => getPlannerSoundSettings().mode;
    fireEvent.keyDown(document.body, { key: "M", shiftKey: true, altKey: true });
    fireEvent.keyDown(document.body, { key: "M", shiftKey: true, metaKey: true });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Note" }), { key: "M", shiftKey: true });
    expect(mode()).toBe("quiet");
    fireEvent.keyDown(document.body, { key: "m", shiftKey: true });
    expect(mode(), "the layout's M, in either case (Caps Lock)").toBe("off");
    fireEvent.keyDown(screen.getByRole("slider", { name: "Level" }), { key: "M", shiftKey: true });
    expect(mode(), "a slider types nothing").toBe("quiet");
  });
});
