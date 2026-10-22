import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Key } from "../Keys.js";
import { POPOVER_GAP_PX, Popover, usePopoverState } from "../Popover.js";

// ---------------------------------------------------------------------------
// The popover (T-671; spec 4.5, 8, 12): it opens off the bar that holds its
// key, above everything beside it, takes focus and gives it back, closes on
// Esc and a press elsewhere, and never traps Tab.
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) };
}

function Harness({ side = "below", align = "end" }: { readonly side?: "below" | "above"; readonly align?: "start" | "end" }): ReactElement {
  const popover = usePopoverState();
  return (
    <>
      <button type="button">Before</button>
      <div className="pc-lacquer" data-testid="bar">
        <Key ref={popover.triggerRef} label="Sound" iconOnly expanded={popover.open} {...popover.triggerProps} onPress={popover.toggle} />
      </div>
      <button type="button">After</button>
      <Popover state={popover} label="Sound" side={side} align={align} chrome="sound">
        <button type="button">First</button>
        <button type="button" tabIndex={-1}>Not a stop</button>
        <input aria-label="Last" />
      </Popover>
    </>
  );
}

function open(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: "Sound" }));
  return screen.getByRole("dialog", { name: "Sound" });
}

describe("Popover", () => {
  it("sits at the top of the page, not inside the bar, so nothing beside it paints over it", () => {
    render(<Harness />);
    const panel = open();
    expect(panel.parentElement).toBe(document.body);
    expect(screen.getByTestId("bar").contains(panel)).toBe(false);
    expect(panel.getAttribute("data-pc-chrome")).toBe("sound");
  });

  it("opens 8 px off the bar that holds its key, lined up with the bar's edge", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("pc-lacquer") ? rect(1400, 20, 180, 46) : rect(0, 0, 0, 0);
    });
    render(<Harness />);
    const panel = open();
    expect(panel.style.getPropertyValue("--pc-popover-top")).toBe(`${String(66 + POPOVER_GAP_PX)}px`);
    expect(panel.style.getPropertyValue("--pc-popover-right")).toBe(`${String(window.innerWidth - 1580)}px`);
    expect(panel.className).toContain("pc-popover--end");
  });

  it("opens upward from a bar at the foot, from its left edge", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("pc-lacquer") ? rect(400, 920, 800, 56) : rect(0, 0, 0, 0);
    });
    render(<Harness side="above" align="start" />);
    const panel = open();
    expect(panel.style.getPropertyValue("--pc-popover-bottom")).toBe(`${String(window.innerHeight - 920 + POPOVER_GAP_PX)}px`);
    expect(panel.style.getPropertyValue("--pc-popover-left")).toBe("400px");
  });

  it("takes focus on opening and gives it back to its key on Esc", () => {
    render(<Harness />);
    const panel = open();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "First" }));
    const key = screen.getByRole("button", { name: "Sound" });
    expect(key.getAttribute("aria-expanded")).toBe("true");
    expect(key.getAttribute("aria-controls")).toBe(panel.id);
    fireEvent.keyDown(screen.getByRole("button", { name: "First" }), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(key);
    expect(key.getAttribute("aria-controls")).toBeNull();
  });

  it("closes on Esc while its key has focus", () => {
    render(<Harness />);
    open();
    const key = screen.getByRole("button", { name: "Sound" });
    key.focus();
    fireEvent.keyDown(key, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("never traps Tab: Shift Tab from its first stop goes back to its key", () => {
    render(<Harness />);
    open();
    fireEvent.keyDown(screen.getByRole("button", { name: "First" }), { key: "Tab", shiftKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Sound" }));
  });

  it("never traps Tab: Tab from its last stop goes on to what follows its key", () => {
    render(<Harness />);
    open();
    const last = screen.getByRole("textbox", { name: "Last" });
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "After" }));
  });

  it("lets Tab move between its own stops", () => {
    render(<Harness />);
    open();
    fireEvent.keyDown(screen.getByRole("button", { name: "First" }), { key: "Tab" });
    expect(screen.queryByRole("dialog"), "Tab inside is the browser's to move").not.toBeNull();
  });

  it("closes on a press elsewhere, but not on its key or inside it", () => {
    render(<Harness />);
    open();
    fireEvent.pointerDown(screen.getByRole("textbox", { name: "Last" }));
    expect(screen.queryByRole("dialog")).not.toBeNull();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Before" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes when focus leaves for somewhere else on the page", () => {
    render(<Harness />);
    open();
    fireEvent.focusOut(screen.getByRole("button", { name: "First" }), { relatedTarget: screen.getByRole("button", { name: "Before" }) });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("toggles from its key", () => {
    render(<Harness />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Sound" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("chrome.css — the popover's contract", () => {
  it("is fixed above the chrome, scales from its key's edge, and only fades under reduced motion", async () => {
    const css = await readFile(resolve(import.meta.dirname, "../chrome.css"), "utf8");
    expect(css).toMatch(/\.pc-popover \{[^}]*position: fixed;[^}]*z-index: 50;[^}]*transform: scale\(0\.96\);[^}]*var\(--house-motion-reveal\)/s);
    expect(css, "solid under its lacquer, so a panel beneath never shows through").toMatch(/\.pc-popover \{[^}]*var\(--house-lacquer-bottom\)\),\s*var\(--house-bg-0\);/s);
    expect(css).toMatch(/\.pc-popover--end \{[^}]*transform-origin: 100% 0;/s);
    expect(css).toMatch(/\.pc-tooltip \{[^}]*z-index: 60;/s);
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/\.pc-popover,\s*\.pc-popover\.is-shown \{[^}]*transform: none;/s);
  });
});
