import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Field, Segmented, Stepper, Switch, parseTypedNumber } from "../Controls.js";
import { Key, KeyRow, ariaKeyShortcut, keyAccessibleName } from "../Keys.js";
import { Chip, MarkLabel, Notice, StatusDot } from "../Surfaces.js";
import { TOOLTIP_FIRST_DELAY_MS, TooltipHost, placeTooltip, useTooltipStore } from "../Tooltip.js";
import { registerEscapeLayer } from "../../../lib/planner-keys.js";

/** A selection held under the chrome: an Escape that steps back only its own layer leaves it alone. */
function holdSelection(): { readonly cleared: ReturnType<typeof vi.fn>; readonly release: () => void } {
  const cleared = vi.fn();
  const release = registerEscapeLayer({ kind: "selection", isOpen: () => true, escape: cleared });
  return { cleared, release };
}

// ---------------------------------------------------------------------------
// The planner chrome's shared primitives (T-671, slice 4). Roles and names,
// keys that cannot act and say why, the tooltip's timing and placement, the
// controls' keyboard, and the stylesheet's focus, hover and reduced-motion
// contract.
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  useTooltipStore.setState({ current: null, lastHiddenAt: Number.NEGATIVE_INFINITY });
});

function mouseEnter(element: Element): void {
  fireEvent.pointerEnter(element, { pointerType: "mouse" });
}

describe("Key", () => {
  it("is named by its words, or by its label when it is an icon", () => {
    render(<><Key label="Add" /><Key label="Find" iconOnly /></>);
    expect(screen.getByRole("button", { name: "Add" }).getAttribute("aria-label")).toBeNull();
    expect(screen.getByRole("button", { name: "Find" })).toBeTruthy();
  });

  it("names its keys in its accessible name and as aria-keyshortcuts", () => {
    render(<Key label="Duplicate" iconOnly shortcut={["Ctrl", "D"]} />);
    const key = screen.getByRole("button", { name: "Duplicate, Ctrl D" });
    expect(key.getAttribute("aria-keyshortcuts")).toBe("Control+D");
    expect(ariaKeyShortcut(["Ctrl", "Shift", "Z"])).toBe("Control+Shift+Z");
  });

  it("keeps a text key's visible words inside its name (WCAG 2.5.3)", () => {
    render(<Key label="Lay out" shortcut={["L"]} />);
    expect(screen.getByRole("button", { name: "Lay out, L" }).textContent).toContain("Lay out");
  });

  it("stays in place when it cannot act, dimmed, and says why", () => {
    const onPress = vi.fn();
    render(<Key label="Undo" iconOnly disabledReason="Nothing to undo yet" onPress={onPress} />);
    const key = screen.getByRole("button", { name: "Undo: Nothing to undo yet" });
    expect(key.getAttribute("aria-disabled")).toBe("true");
    expect(key.hasAttribute("disabled")).toBe(false);
    fireEvent.click(key);
    expect(onPress).not.toHaveBeenCalled();
  });

  it("presses when it can", () => {
    const onPress = vi.fn();
    render(<Key label="Measure" onPress={onPress} />);
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("reports a tool's state with aria-pressed and a view's with aria-checked", () => {
    render(
      <>
        <Key label="Draw" toggle on />
        <Key label="Room" radio on />
        <Key label="Walk" radio on={false} />
      </>,
    );
    expect(screen.getByRole("button", { name: "Draw" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("radio", { name: "Room" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Walk" }).getAttribute("aria-checked")).toBe("false");
  });

  it("builds the name from the step it would undo", () => {
    expect(keyAccessibleName({ label: "Undo", tip: "Undo Move Table 8", shortcut: ["Ctrl", "Z"] })).toBe("Undo Move Table 8, Ctrl Z");
  });
});

describe("Tooltip", () => {
  it("waits 400 ms the first time, then shows the words and the keys", () => {
    vi.useFakeTimers();
    render(<><Key label="Duplicate" iconOnly shortcut={["Ctrl", "D"]} /><TooltipHost /></>);
    mouseEnter(screen.getByRole("button", { name: "Duplicate, Ctrl D" }));
    expect(screen.queryByTestId("planner-chrome-tooltip")).toBeNull();
    act(() => { vi.advanceTimersByTime(TOOLTIP_FIRST_DELAY_MS); });
    const tip = screen.getByTestId("planner-chrome-tooltip");
    expect(tip.textContent).toBe("DuplicateCtrlD");
    expect(tip.getAttribute("aria-hidden")).toBe("true");
  });

  it("shows a neighbour at once while one is up", () => {
    vi.useFakeTimers();
    render(<><Key label="Turn" iconOnly /><Key label="Remove" iconOnly /><TooltipHost /></>);
    mouseEnter(screen.getByRole("button", { name: "Turn" }));
    act(() => { vi.advanceTimersByTime(TOOLTIP_FIRST_DELAY_MS); });
    fireEvent.pointerLeave(screen.getByRole("button", { name: "Turn" }), { pointerType: "mouse" });
    mouseEnter(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByTestId("planner-chrome-tooltip").textContent).toBe("Remove");
  });

  it("names the reason, not the action, when the key cannot act", () => {
    vi.useFakeTimers();
    render(<><Key label="Undo" iconOnly disabledReason="Nothing to undo yet" tooltipImmediate /><TooltipHost /></>);
    mouseEnter(screen.getByRole("button", { name: "Undo: Nothing to undo yet" }));
    expect(screen.getByTestId("planner-chrome-tooltip").textContent).toBe("Nothing to undo yet");
  });

  it("never shows for touch", () => {
    vi.useFakeTimers();
    render(<><Key label="Find" iconOnly /><TooltipHost /></>);
    fireEvent.pointerEnter(screen.getByRole("button", { name: "Find" }), { pointerType: "touch" });
    act(() => { vi.advanceTimersByTime(TOOLTIP_FIRST_DELAY_MS * 2); });
    expect(screen.queryByTestId("planner-chrome-tooltip")).toBeNull();
  });

  it("goes on Escape, and that Escape does nothing else", () => {
    vi.useFakeTimers();
    const selection = holdSelection();
    render(<><Key label="Find" iconOnly tooltipImmediate /><TooltipHost /></>);
    mouseEnter(screen.getByRole("button", { name: "Find" }));
    expect(screen.queryByTestId("planner-chrome-tooltip")).not.toBeNull();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByTestId("planner-chrome-tooltip")).toBeNull();
    expect(selection.cleared).not.toHaveBeenCalled();
    selection.release();
  });

  it("sits on its side of the key, flips when there is no room, and stays on screen", () => {
    const viewport = { width: 1600, height: 1000 };
    const size = { width: 120, height: 30 };
    const dockKey = { left: 1200, right: 1240, top: 924, bottom: 964 };
    expect(placeTooltip(dockKey, size, "above", viewport)).toEqual({ left: 1160, top: 886, side: "above" });
    const topKey = { left: 1550, right: 1590, top: 24, bottom: 60 };
    const flipped = placeTooltip(topKey, size, "above", viewport);
    expect(flipped.side).toBe("below");
    expect(flipped.top).toBe(68);
    expect(flipped.left).toBe(1600 - 8 - 120);
  });
});

describe("KeyRow", () => {
  it("draws one underline, shown only while a key is active", () => {
    const { container, rerender } = render(
      <KeyRow role="radiogroup" label="View" activeKey={null}>
        <Key label="Plan" radio rowKey="plan" />
        <Key label="Room" radio rowKey="room" />
      </KeyRow>,
    );
    expect(screen.getByRole("radiogroup", { name: "View" })).toBeTruthy();
    const line = container.querySelector(".pc-underline");
    expect(line?.classList.contains("is-shown")).toBe(false);
    rerender(
      <KeyRow role="radiogroup" label="View" activeKey="room">
        <Key label="Plan" radio rowKey="plan" />
        <Key label="Room" radio rowKey="room" on />
      </KeyRow>,
    );
    expect(container.querySelectorAll(".pc-underline")).toHaveLength(1);
    expect(container.querySelector(".pc-underline")?.classList.contains("is-shown")).toBe(true);
  });
});

describe("Segmented", () => {
  const options = [
    { value: "bare", label: "Bare" },
    { value: "white", label: "White cloth" },
    { value: "black", label: "Black cloth" },
  ] as const;

  it("is a radio group with one tab stop on the choice", () => {
    render(<Segmented label="Cloth" value="white" options={options} onChange={() => undefined} />);
    expect(screen.getByRole("radiogroup", { name: "Cloth" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "White cloth" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "White cloth" }).tabIndex).toBe(0);
    expect(screen.getByRole("radio", { name: "Bare" }).tabIndex).toBe(-1);
  });

  it("moves the choice with the arrows, wrapping, and to the ends with Home and End", () => {
    const onChange = vi.fn();
    const { rerender } = render(<Segmented label="Cloth" value="black" options={options} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("radio", { name: "Black cloth" }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("bare");
    rerender(<Segmented label="Cloth" value="bare" options={options} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("radio", { name: "Bare" }), { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("black");
  });

  it("skips a choice that is not available, and says why", () => {
    const onChange = vi.fn();
    const seats = [
      { value: "10", label: "10" },
      { value: "11", label: "11", disabledReason: "Odd counts leave a gap" },
      { value: "12", label: "12" },
    ] as const;
    render(<Segmented label="Seats" value="10" options={seats} onChange={onChange} />);
    const unavailable = screen.getByRole("radio", { name: "11: Odd counts leave a gap" });
    expect(unavailable.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(unavailable);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("radio", { name: "10" }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("12");
  });
});

describe("Stepper", () => {
  it("is a slider to assistive technology, reading the count in its unit", () => {
    render(<Stepper label="Seats at Table 8" value={10} min={6} max={12} unit="seats" onChange={() => undefined} />);
    const slider = screen.getByRole("slider", { name: "Seats at Table 8" });
    expect(slider.getAttribute("aria-valuemin")).toBe("6");
    expect(slider.getAttribute("aria-valuemax")).toBe("12");
    expect(slider.getAttribute("aria-valuenow")).toBe("10");
    expect(slider.getAttribute("aria-valuetext")).toBe("10 seats");
    expect(slider.tabIndex).toBe(0);
  });

  it("counts with the arrows and goes to the ends with Home and End", () => {
    const onChange = vi.fn();
    render(<Stepper label="Seats" value={10} min={6} max={12} onChange={onChange} />);
    const slider = screen.getByRole("slider", { name: "Seats" });
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith(11);
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith(9);
    fireEvent.keyDown(slider, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(6);
  });

  it("dims + at the most, says why, and does not pass it", () => {
    const onChange = vi.fn();
    render(<Stepper label="Seats" value={12} min={6} max={12} unit="seats" maxReason="12 is the most at a 1.83 m round" onChange={onChange} />);
    const more = screen.getByRole("button", { name: "More seats: 12 is the most at a 1.83 m round" });
    fireEvent.click(more);
    fireEvent.keyDown(screen.getByRole("slider", { name: "Seats" }), { key: "ArrowUp" });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Fewer seats" }));
    expect(onChange).toHaveBeenLastCalledWith(11);
  });
});

describe("Switch", () => {
  it("is a switch named by its words, and turns", () => {
    const onChange = vi.fn();
    render(<Switch label="She can change the layout" checked onChange={onChange} />);
    const control = screen.getByRole("switch", { name: "She can change the layout" });
    expect(control.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(control);
    expect(onChange).toHaveBeenCalledWith(false);
  });
});

describe("Field", () => {
  it("shows the value with its unit and keeps a typed one on Enter", () => {
    const onCommit = vi.fn();
    render(<Field label="From the fireplace wall" value={8.34} unit="m" format={(n) => n.toFixed(2)} onCommit={onCommit} />);
    const input = screen.getByLabelText<HTMLInputElement>("From the fireplace wall");
    expect(input.value).toBe("8.34");
    fireEvent.change(input, { target: { value: "8,5" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith(8.5);
  });

  it("refuses what it cannot use, says why, and keeps the typing", () => {
    const onCommit = vi.fn();
    render(<Field label="From the window wall" value={7.13} unit="m" problemFor={(n) => (n > 20 ? "The hall is 21 m long" : null)} onCommit={onCommit} />);
    const input = screen.getByLabelText<HTMLInputElement>("From the window wall");
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("alert").textContent).toBe("Type a number");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(input, { target: { value: "25" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("alert").textContent).toBe("The hall is 21 m long");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("puts the value back on Escape, and that Escape goes no further", () => {
    const selection = holdSelection();
    render(<Field label="Turned" value={0} unit="°" onCommit={() => undefined} />);
    const input = screen.getByLabelText<HTMLInputElement>("Turned");
    input.focus();
    fireEvent.change(input, { target: { value: "45" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("0");
    expect(selection.cleared).not.toHaveBeenCalled();
    // With nothing typed, the next Escape steps back the next layer.
    fireEvent.keyDown(input, { key: "Escape" });
    expect(selection.cleared).toHaveBeenCalledTimes(1);
    selection.release();
  });

  it("reads numbers the way people type them", () => {
    expect(parseTypedNumber(" 8.34 m")).toBe(8.34);
    expect(parseTypedNumber("8,34")).toBe(8.34);
    expect(parseTypedNumber("")).toBeNull();
    expect(parseTypedNumber("m")).toBeNull();
  });
});

describe("surfaces", () => {
  it("announces a state quietly, or at once when it needs the person", () => {
    render(
      <>
        <Notice lead="Offline" body="3 changes kept on this device." />
        <Notice lead="Not saved" urgency="alert" body="The last save did not reach Venviewer." />
      </>,
    );
    expect(screen.getByRole("status").textContent).toContain("Offline");
    expect(screen.getByRole("alert").textContent).toContain("Not saved");
  });

  it("gives chips, dots and floor marks their tones", () => {
    const { container } = render(
      <>
        <Chip tone="hold">1st option</Chip>
        <StatusDot tone="saved" />
        <MarkLabel tone="amber">1.0 m · tight</MarkLabel>
      </>,
    );
    expect(container.querySelector(".pc-chip--hold")?.textContent).toBe("1st option");
    expect(container.querySelector(".pc-dot--saved")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".pc-mark--amber")?.textContent).toBe("1.0 m · tight");
  });
});

describe("chrome.css — focus, hover and reduced motion", () => {
  async function stylesheet(): Promise<string> {
    return (await readFile(resolve("src/components/planner-chrome/chrome.css"), "utf-8")).replace(/\/\*[\s\S]*?\*\//g, "");
  }

  it("gives every interactive primitive the one visible focus ring", async () => {
    const css = await stylesheet();
    const rule = /([^{}]*):focus-visible[^{}]*\{([^}]*)\}/g;
    const covered = new Set<string>();
    for (const match of css.matchAll(rule)) {
      if (!(match[2] ?? "").includes("outline: var(--vv-focus-ring)")) continue;
      for (const selector of (match[0].split("{")[0] ?? "").split(",")) covered.add(selector.trim().replace(/:focus-visible$/, ""));
    }
    for (const primitive of [".pc-key", ".pc-cream", ".pc-quiet", ".pc-seg__option", ".pc-switch", ".pc-stepper__value", ".pc-field__input"]) {
      expect(covered.has(primitive), `${primitive} has the focus ring`).toBe(true);
    }
  });

  it("changes colour on hover only for a fine pointer, and never by scale", async () => {
    const css = await stylesheet();
    const hoverBlock = /@media \(hover: hover\) and \(pointer: fine\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(hoverBlock).toContain(".pc-key:hover");
    expect(hoverBlock).not.toMatch(/transform|scale/);
    const outside = css.replace(/@media \(hover: hover\) and \(pointer: fine\) \{[\s\S]*?\n\}/g, "");
    expect(outside).not.toMatch(/:hover/);
  });

  it("drops the press-down and the tooltip's scale under reduced motion", async () => {
    const css = await stylesheet();
    const reduced = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(reduced).toMatch(/\.pc-key:active[^{]*\{\s*transform: none;/);
    expect(reduced).toMatch(/\.pc-tooltip[^{]*\{\s*transform: none;/);
  });
});
