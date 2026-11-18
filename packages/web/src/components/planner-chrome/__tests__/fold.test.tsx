import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useChromePresenceStore } from "../../../stores/chrome-presence-store.js";
import { ChromePresence, CLEAR_HINT_MS, settleChromeFocus } from "../../editor/cockpit/ChromeFold.js";
import { focusCrestQuietly } from "../../editor/cockpit/CrestLabel.js";
import { SlateCrest, crestName, crestNoteWords } from "../SlateCrest.js";
import { TOOLTIP_FIRST_DELAY_MS, TooltipHost, useTooltipStore } from "../Tooltip.js";

vi.mock("../../../api/spaces.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../api/spaces.js")>(),
  getVenue: vi.fn(() => new Promise(() => undefined)),
}));

// ---------------------------------------------------------------------------
// The new chrome clears away as today's planner does (T-680 in T-671's
// chrome). Blake, 28 Oct 2026: "Crest hides; name goes home". The crest on
// the slate is the switch and, cleared, the one mark left; \ and Esc work as
// they do in today's planner. Presses are real events through the planner's
// one keyboard owner; the page's state is read off <html>, as fold.css reads it.
// ---------------------------------------------------------------------------

const root = document.documentElement;
const ALL_OPEN = { left: false, right: false, top: false, bottom: false };

function press(key: string, target: EventTarget = window): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

function crest(): HTMLElement {
  return screen.getByRole("button", { name: /the tools$/u });
}

function tooltip(): HTMLElement | null {
  return screen.queryByTestId("planner-chrome-tooltip");
}

function planner(logoUrl: string | null = null, onLogoError: () => void = () => undefined): void {
  render(
    <>
      <SlateCrest logoUrl={logoUrl} onLogoError={onLogoError} />
      <TooltipHost />
      <ChromePresence />
    </>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  useChromePresenceStore.setState({ folded: ALL_OPEN, cleared: false, instant: false, hintPending: false, hintsShown: 0 });
  useTooltipStore.setState({ current: null, lastHiddenAt: Number.NEGATIVE_INFINITY });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the crest on the slate", () => {
  it("is the switch, named for what it does next, with its key", () => {
    planner();
    expect(crest().getAttribute("aria-label")).toBe("Hide the tools");
    expect(crest().getAttribute("aria-keyshortcuts")).toBe("\\");
    expect(crest().hasAttribute("data-planner-crest")).toBe(true);

    act(() => { fireEvent.click(crest()); });
    expect(useChromePresenceStore.getState().cleared).toBe(true);
    expect(root.getAttribute("data-planner-chrome")).toBe("cleared");
    expect(crest().getAttribute("aria-label")).toBe("Show the tools");

    act(() => { fireEvent.click(crest()); });
    expect(useChromePresenceStore.getState().cleared).toBe(false);
    expect(root.getAttribute("data-planner-chrome")).not.toBe("cleared");
    expect(crest().getAttribute("aria-label")).toBe("Hide the tools");
  });

  it("names the switch for both states", () => {
    expect(crestName(false)).toBe("Hide the tools");
    expect(crestName(true)).toBe("Show the tools");
  });

  it("shows the venue's crest, or the house mark for a venue without one", () => {
    const failed = vi.fn();
    planner("/venues/th/crest.webp", failed);
    const image = crest().querySelector("img");
    expect(image?.getAttribute("src")).toBe("/venues/th/crest.webp");
    expect(image?.getAttribute("alt")).toBe("");
    if (image !== null) fireEvent.error(image);
    expect(failed).toHaveBeenCalledTimes(1);
    cleanup();

    planner(null);
    expect(crest().querySelector("img")).toBeNull();
    expect(crest().querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("\\ and Esc under the new chrome", () => {
  it("\\ clears and brings the tools back; Esc brings them back", () => {
    planner();
    act(() => { press("\\"); });
    expect(root.getAttribute("data-planner-chrome")).toBe("cleared");
    act(() => { press("\\"); });
    expect(useChromePresenceStore.getState().cleared).toBe(false);

    act(() => { press("\\"); });
    act(() => { press("Escape"); });
    expect(useChromePresenceStore.getState().cleared).toBe(false);
  });

  it("puts away a name over chrome that has gone, so one Esc brings the tools back", () => {
    vi.useFakeTimers();
    planner();
    fireEvent.pointerEnter(crest(), { pointerType: "mouse" });
    act(() => { vi.advanceTimersByTime(TOOLTIP_FIRST_DELAY_MS); });
    expect(tooltip()?.textContent).toBe("Hide the tools\\");

    act(() => { press("\\"); });
    expect(tooltip()).toBeNull();
    act(() => { press("Escape"); });
    expect(useChromePresenceStore.getState().cleared).toBe(false);
  });

  it("gives the crest its name for the keyboard's focus, and not for the chrome's own", () => {
    // The keyboard's focus is :focus-visible; happy-dom has no notion of it.
    const matches = Object.getOwnPropertyDescriptor(Element.prototype, "matches")?.value as (this: Element, selector: string) => boolean;
    vi.spyOn(Element.prototype, "matches").mockImplementation(function (this: Element, selector: string) {
      return selector === ":focus-visible" ? true : matches.call(this, selector);
    });
    planner();
    act(() => { focusCrestQuietly(crest()); });
    expect(tooltip()).toBeNull();
    act(() => { crest().blur(); });
    act(() => { crest().focus(); });
    expect(tooltip()?.textContent).toBe("Hide the tools\\");
  });

  it("is where focus goes when the chrome it was on has gone", () => {
    render(<><button type="button">Lay out</button><SlateCrest logoUrl={null} onLogoError={() => undefined} /></>);
    const layOut = screen.getByRole("button", { name: "Lay out" });
    layOut.focus();
    settleChromeFocus(document, layOut, true, (element) => element !== layOut);
    expect(document.activeElement).toBe(crest());
  });
});

describe("the note beside the crest", () => {
  it("says the first three times on a device how the tools come back, then never", () => {
    vi.useFakeTimers();
    vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({ matches: false, media: query } as MediaQueryList));
    planner();
    const note = screen.getByTestId("crest-note");
    for (let time = 1; time <= 4; time += 1) {
      act(() => { press("\\"); });
      expect(note.getAttribute("data-shown"), `clear ${String(time)}`).toBe(time <= 3 ? "true" : "false");
      if (time <= 3) {
        expect(note.querySelector('[role="status"]')?.textContent).toBe(crestNoteWords(false).voice);
        expect(note.textContent).toContain("press \\ or the crest");
      }
      act(() => { vi.advanceTimersByTime(CLEAR_HINT_MS); });
      expect(note.getAttribute("data-shown")).toBe("false");
      act(() => { press("\\"); });
    }
  });

  it("tells a finger to tap the crest, and says backslash aloud for a keyboard", () => {
    expect(crestNoteWords(true).text).toBe("The tools are hidden · tap the crest to bring them back");
    expect(crestNoteWords(false).text).toBe("The tools are hidden · press \\ or the crest to bring them back");
    expect(crestNoteWords(false).voice).toContain("backslash");
    expect(crestNoteWords(true).voice).not.toContain("\\");
  });
});
