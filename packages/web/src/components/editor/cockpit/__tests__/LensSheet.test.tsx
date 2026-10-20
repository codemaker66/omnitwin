import type { ReactElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCockpitStore } from "../../../../stores/cockpit-store.js";
import { useLayoutTimelinePreviewStore } from "../../../../stores/layout-timeline-preview-store.js";

const motionPreference = vi.hoisted(() => ({ reduced: true }));
vi.mock("../../../../lib/reduced-motion.js", () => ({
  prefersReducedMotion: () => motionPreference.reduced,
}));

// The real panels read venue data and the network; these stand-ins keep this
// a test of the sheet. Each lens gets one stable component, as the registry does.
vi.mock("../CockpitRightDock.js", () => {
  const panels = new Map<string, () => ReactElement>();
  return {
    panelForMode: (mode: string) => {
      if (mode === "design") return null;
      let panel = panels.get(mode);
      if (panel === undefined) {
        panel = () => (
          <aside className="lens-panel" aria-label={`Stub ${mode}`}>
            <header className="lens-panel__head" data-testid="stub-lens-head"><span>{mode} title</span></header>
            <div className="lens-panel__body">
              <a href="mailto:events@example.test">Ask us for a quote</a>
            </div>
          </aside>
        );
        panels.set(mode, panel);
      }
      return panel;
    },
  };
});

const { LensSheet } = await import("../LensSheet.js");

function chooseLens(mode: "guests" | "costs" | "flow" | "design"): void {
  act(() => { useCockpitStore.getState().setMode(mode); });
}

function sheetOffset(): number {
  const transform = screen.getByTestId("lens-sheet").style.transform;
  const match = /translate3d\(0, (-?[\d.]+)px, 0\)/.exec(transform);
  if (match === null || match[1] === undefined) throw new Error(`No sheet offset in "${transform}"`);
  return Number(match[1]);
}

/** A touch pointer event at an exact time, so release speed is deterministic. */
function touch(
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  target: Element,
  clientY: number,
  atMs: number,
  pointerId = 7,
): void {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId,
    isPrimary: true,
    pointerType: "touch",
    clientY,
  });
  Object.defineProperty(event, "timeStamp", { value: atMs });
  fireEvent(target, event);
}

beforeEach(() => {
  motionPreference.reduced = true;
  useCockpitStore.getState().reset();
  useLayoutTimelinePreviewStore.getState().clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useCockpitStore.getState().reset();
  useLayoutTimelinePreviewStore.getState().clear();
  document.body.innerHTML = "";
});

describe("LensSheet", () => {
  it("shows nothing in Design, which has no lens panel", () => {
    render(<LensSheet />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the chosen lens as a labelled modal sheet above the planner", () => {
    render(<LensSheet />);
    chooseLens("guests");
    const sheet = screen.getByRole("dialog", { name: "Guests" });
    expect(sheet.getAttribute("aria-modal")).toBe("true");
    expect(within(sheet).getByText("guests title")).toBeTruthy();
    expect(within(sheet).getByRole("link", { name: "Ask us for a quote" })).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: "Close Guests" }).textContent).toBe("Close");
    // Portalled to the body, outside the stage's stacking context.
    expect(screen.getByTestId("lens-sheet-layer").parentElement).toBe(document.body);
    expect(sheetOffset()).toBe(0);
  });

  it("moves focus into the sheet and gives it back to the opener on Close", async () => {
    const opener = document.createElement("button");
    opener.textContent = "More";
    document.body.append(opener);
    opener.focus();
    render(<LensSheet />);
    chooseLens("guests");
    const close = screen.getByRole("button", { name: "Close Guests" });
    await waitFor(() => { expect(document.activeElement).toBe(close); });
    fireEvent.click(close);
    expect(useCockpitStore.getState().activeMode).toBe("design");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("keeps Tab inside the sheet", async () => {
    render(<LensSheet />);
    chooseLens("costs");
    const close = screen.getByRole("button", { name: "Close Costs" });
    const ask = screen.getByRole("link", { name: "Ask us for a quote" });
    await waitFor(() => { expect(document.activeElement).toBe(close); });
    ask.focus();
    fireEvent.keyDown(ask, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(ask);
  });

  it("closes with Escape and returns the planner to Design", () => {
    render(<LensSheet />);
    chooseLens("flow");
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Flow" }), { key: "Escape" });
    expect(useCockpitStore.getState().activeMode).toBe("design");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes when the dimmed room behind it is tapped", () => {
    render(<LensSheet />);
    chooseLens("guests");
    fireEvent.click(screen.getByTestId("lens-sheet-scrim"));
    expect(useCockpitStore.getState().activeMode).toBe("design");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the planner's single-key shortcuts off the scene behind it", () => {
    const behind = vi.fn();
    window.addEventListener("keydown", behind);
    try {
      render(<LensSheet />);
      chooseLens("guests");
      fireEvent.keyDown(screen.getByRole("button", { name: "Close Guests" }), { key: "f", code: "KeyF" });
      expect(behind).not.toHaveBeenCalled();
      expect(useCockpitStore.getState().activeMode).toBe("guests");
    } finally {
      window.removeEventListener("keydown", behind);
    }
  });

  it("follows the finger, and a short slow drag returns it to its seat", () => {
    render(<LensSheet />);
    chooseLens("guests");
    const grab = screen.getByTestId("lens-sheet-grab");
    touch("pointerdown", grab, 100, 0);
    touch("pointermove", grab, 160, 120);
    expect(sheetOffset()).toBe(60);
    touch("pointerup", grab, 160, 500);
    expect(useCockpitStore.getState().activeMode).toBe("guests");
    expect(screen.getByRole("dialog", { name: "Guests" })).toBeTruthy();
    expect(sheetOffset()).toBe(0);
  });

  it("closes on a long, slow swipe down from the handle", () => {
    render(<LensSheet />);
    chooseLens("guests");
    const grab = screen.getByTestId("lens-sheet-grab");
    touch("pointerdown", grab, 200, 0);
    touch("pointermove", grab, 310, 200);
    touch("pointermove", grab, 420, 400);
    touch("pointerup", grab, 420, 700);
    expect(useCockpitStore.getState().activeMode).toBe("design");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on a quick, short flick down from the lens header", () => {
    render(<LensSheet />);
    chooseLens("guests");
    const head = screen.getByTestId("stub-lens-head");
    touch("pointerdown", head, 200, 0);
    touch("pointermove", head, 215, 10);
    touch("pointermove", head, 230, 20);
    touch("pointerup", head, 230, 24);
    expect(useCockpitStore.getState().activeMode).toBe("design");
  });

  it("stays open when a long drag ends moving back up", () => {
    render(<LensSheet />);
    chooseLens("guests");
    const grab = screen.getByTestId("lens-sheet-grab");
    touch("pointerdown", grab, 200, 0);
    touch("pointermove", grab, 500, 300);
    touch("pointermove", grab, 470, 310);
    touch("pointerup", grab, 470, 314);
    expect(useCockpitStore.getState().activeMode).toBe("guests");
    expect(sheetOffset()).toBe(0);
  });

  it("returns to its seat when the system cancels the drag", () => {
    render(<LensSheet />);
    chooseLens("guests");
    const grab = screen.getByTestId("lens-sheet-grab");
    touch("pointerdown", grab, 200, 0);
    touch("pointermove", grab, 500, 300);
    touch("pointercancel", grab, 500, 310);
    expect(useCockpitStore.getState().activeMode).toBe("guests");
    expect(sheetOffset()).toBe(0);
  });

  it("does not start a drag from a control or a link inside the sheet", () => {
    render(<LensSheet />);
    chooseLens("guests");
    for (const origin of [
      screen.getByRole("button", { name: "Close Guests" }),
      screen.getByRole("link", { name: "Ask us for a quote" }),
    ]) {
      touch("pointerdown", origin, 100, 0, 4);
      touch("pointermove", origin, 400, 300, 4);
      expect(sheetOffset()).toBe(0);
      touch("pointerup", origin, 400, 700, 4);
    }
    expect(useCockpitStore.getState().activeMode).toBe("guests");
  });

  it("stands aside during a room timeline preview and returns after it", () => {
    act(() => { useLayoutTimelinePreviewStore.getState().showPending("Reading phase"); });
    render(<LensSheet />);
    chooseLens("guests");
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => { useLayoutTimelinePreviewStore.getState().clear(); });
    expect(screen.getByRole("dialog", { name: "Guests" })).toBeTruthy();
  });

  describe("with motion allowed", () => {
    let frames: FrameRequestCallback[] = [];
    let clock = 0;

    function runFrame(): void {
      const pending = frames;
      frames = [];
      clock += 1000 / 60;
      act(() => { for (const frame of pending) frame(clock); });
    }

    function flushFrames(limit = 400): void {
      for (let i = 0; i < limit && frames.length > 0; i += 1) runFrame();
    }

    beforeEach(() => {
      motionPreference.reduced = false;
      frames = [];
      clock = 0;
      vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      });
      vi.stubGlobal("cancelAnimationFrame", () => undefined);
    });

    it("rises on the spring from below the screen without overshooting its seat", () => {
      render(<LensSheet />);
      chooseLens("guests");
      const start = sheetOffset();
      expect(start).toBeGreaterThan(0);
      const seen: number[] = [];
      for (let i = 0; i < 6; i += 1) {
        runFrame();
        seen.push(sheetOffset());
      }
      // Moving up frame by frame: a spring, not a jump.
      expect(seen[0]).toBeLessThan(start);
      expect(seen[5]).toBeLessThan(seen[0] ?? start);
      expect(seen[5]).toBeGreaterThan(0);
      flushFrames();
      expect(sheetOffset()).toBe(0);
      expect(Math.min(...seen)).toBeGreaterThanOrEqual(0);
    });

    it("stays on screen while it leaves, then unmounts once it is away", () => {
      render(<LensSheet />);
      chooseLens("guests");
      flushFrames();
      fireEvent.click(screen.getByRole("button", { name: "Close Guests" }));
      expect(useCockpitStore.getState().activeMode).toBe("design");
      expect(screen.getByTestId("lens-sheet-layer").getAttribute("data-state")).toBe("closing");
      runFrame();
      expect(sheetOffset()).toBeGreaterThan(0);
      flushFrames();
      expect(screen.queryByTestId("lens-sheet-layer")).toBeNull();
    });

    it("turns back if a lens is chosen again while the sheet is leaving", () => {
      render(<LensSheet />);
      chooseLens("guests");
      flushFrames();
      fireEvent.click(screen.getByRole("button", { name: "Close Guests" }));
      runFrame();
      chooseLens("costs");
      expect(screen.getByTestId("lens-sheet-layer").getAttribute("data-state")).toBe("open");
      flushFrames();
      expect(screen.getByRole("dialog", { name: "Costs" })).toBeTruthy();
      expect(sheetOffset()).toBe(0);
    });
  });
});
