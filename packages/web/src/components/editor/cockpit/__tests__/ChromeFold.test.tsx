import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { registerEscapeLayer } from "../../../../lib/planner-keys.js";
import { useChromePresenceStore } from "../../../../stores/chrome-presence-store.js";
import { useCockpitStore } from "../../../../stores/cockpit-store.js";
import { useEditorStore } from "../../../../stores/editor-store.js";
import {
  CHROME_SETTLE_MS,
  CLEAR_HINT_MS,
  ChromeClearHint,
  ChromeFoldControls,
  ChromeFoldMark,
  ChromeSaveWord,
  ChromeSpine,
  PhoneChromeSeal,
  chromeSaveTrouble,
  useChromePresence,
} from "../ChromeFold.js";

vi.mock("../../../../api/spaces.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../../api/spaces.js")>(),
  getVenue: vi.fn(() => new Promise(() => undefined)),
}));

// ---------------------------------------------------------------------------
// The planner's chrome folds away (T-680). Blake, 28 Oct 2026: each panel
// folds to a spine and back, and one clear-all (\, the crest, Esc) leaves the
// hall and the crest. Presses are real events through the planner's one
// keyboard owner; the page's state is read off <html>, as the CSS reads it.
// ---------------------------------------------------------------------------

const root = document.documentElement;
const ALL_OPEN = { left: false, right: false, top: false, bottom: false };

function Presence(): null {
  useChromePresence();
  return null;
}

function press(key: string, target: EventTarget = window): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

/** The person's last input was the pointer, so motion plays. */
function pointerFirst(): void {
  window.dispatchEvent(new Event("pointerdown"));
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => { window.requestAnimationFrame(() => { resolve(); }); });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => { window.setTimeout(resolve, ms); });
}

beforeEach(() => {
  window.localStorage.clear();
  useChromePresenceStore.setState({ folded: ALL_OPEN, cleared: false, instant: false, hintPending: false, hintsShown: 0 });
  useCockpitStore.setState({ activeMode: "design" });
  useEditorStore.setState({ configId: "cfg-demo", venueId: null, isSaving: false, isDirty: false, saveError: null, saveConflict: null });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the page-wide side", () => {
  it("mirrors folds and clearing onto the document", () => {
    render(<Presence />);
    act(() => { useChromePresenceStore.getState().fold("left"); });
    expect(root.getAttribute("data-planner-fold-left")).toBe("folded");
    expect(root.hasAttribute("data-planner-fold-right")).toBe(false);
    act(() => { useChromePresenceStore.getState().clearAll(); });
    expect(root.getAttribute("data-planner-chrome")).toBe("cleared");
  });

  it("lets an unfolded unit pass through unfolding, then rest in its own CSS", async () => {
    render(<Presence />);
    pointerFirst();
    act(() => { useChromePresenceStore.getState().fold("bottom"); });
    act(() => { useChromePresenceStore.getState().unfold("bottom"); });
    expect(root.getAttribute("data-planner-fold-bottom")).toBe("unfolding");
    await act(async () => { await wait(CHROME_SETTLE_MS + 40); });
    expect(root.hasAttribute("data-planner-fold-bottom")).toBe(false);
  });

  it("removes its attributes on unmount and ends a clear-all, keeping the folds", () => {
    const { unmount } = render(<Presence />);
    act(() => {
      useChromePresenceStore.getState().fold("right");
      useChromePresenceStore.getState().clearAll();
    });
    unmount();
    for (const name of ["data-planner-fold-right", "data-planner-chrome", "data-planner-chrome-motion"]) {
      expect(root.hasAttribute(name), name).toBe(false);
    }
    expect(useChromePresenceStore.getState().cleared).toBe(false);
    expect(useChromePresenceStore.getState().folded.right).toBe(true);
  });

  it("shows remembered folds as they are on the first frame, without folding", async () => {
    useChromePresenceStore.setState({ folded: { ...ALL_OPEN, left: true } });
    render(<Presence />);
    expect(root.getAttribute("data-planner-fold-left")).toBe("folded");
    expect(root.getAttribute("data-planner-chrome-motion")).toBe("instant");
    await act(async () => { await nextFrame(); });
    expect(root.hasAttribute("data-planner-chrome-motion")).toBe(false);
  });

  it("backslash clears and restores", () => {
    render(<Presence />);
    act(() => { press("\\"); });
    expect(useChromePresenceStore.getState().cleared).toBe(true);
    act(() => { press("\\"); });
    expect(useChromePresenceStore.getState().cleared).toBe(false);
  });

  it("ignores backslash typed in a field", () => {
    render(<><Presence /><input type="search" aria-label="Find a table or piece" /></>);
    const field = screen.getByRole("searchbox", { name: "Find a table or piece" });
    field.focus();
    act(() => { press("\\", field); });
    expect(useChromePresenceStore.getState().cleared).toBe(false);
  });

  it("Esc restores a cleared screen, after the selection", () => {
    render(<Presence />);
    let selected = true;
    const stop = registerEscapeLayer({ kind: "selection", isOpen: () => selected, escape: () => { selected = false; } });
    act(() => { useChromePresenceStore.getState().clearAll(); });
    act(() => { press("Escape"); });
    expect(selected).toBe(false);
    expect(useChromePresenceStore.getState().cleared).toBe(true);
    act(() => { press("Escape"); });
    expect(useChromePresenceStore.getState().cleared).toBe(false);
    stop();
  });

  it("keyboard changes are instant; pointer changes are not", () => {
    render(<Presence />);
    act(() => { press("\\"); });
    expect(root.getAttribute("data-planner-chrome-motion")).toBe("instant");
    act(() => { press("\\"); });
    expect(root.hasAttribute("data-planner-chrome")).toBe(false);
    pointerFirst();
    act(() => { useChromePresenceStore.getState().fold("top"); });
    expect(root.hasAttribute("data-planner-chrome-motion")).toBe(false);
  });
});

describe("spines, marks and the crest's companions", () => {
  it("names every spine and mark", () => {
    render(
      <>
        <ChromeFoldMark unit="left" />
        <ChromeSpine unit="left" />
        <ChromeFoldControls unit="right" />
        <ChromeFoldControls unit="top" />
        <ChromeFoldControls unit="bottom" />
      </>,
    );
    for (const name of ["On the floor", "Details", "the tool bar", "the bottom bar"]) {
      expect(screen.getByRole("button", { name: `Fold ${name}` }).getAttribute("aria-expanded")).toBe("true");
      expect(screen.getByRole("button", { name: `Show ${name}` }).getAttribute("aria-expanded")).toBe("false");
    }
  });

  it("names the right dock after the open lens", () => {
    useCockpitStore.setState({ activeMode: "guests" });
    render(<ChromeFoldControls unit="right" />);
    expect(screen.getByRole("button", { name: "Fold Guests" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show Guests" })).toBeTruthy();
  });

  it("a mark folds its unit and focus moves to the spine", async () => {
    render(<ChromeFoldControls unit="right" />);
    fireEvent.click(screen.getByRole("button", { name: "Fold Details" }));
    expect(useChromePresenceStore.getState().folded.right).toBe(true);
    await act(async () => { await nextFrame(); });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Show Details" }));
  });

  it("a spine unfolds and focus returns to the mark", async () => {
    useChromePresenceStore.setState({ folded: { ...ALL_OPEN, top: true } });
    render(<ChromeFoldControls unit="top" />);
    fireEvent.click(screen.getByRole("button", { name: "Show the tool bar" }));
    expect(useChromePresenceStore.getState().folded.top).toBe(false);
    await act(async () => { await nextFrame(); });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Fold the tool bar" }));
  });

  it("folded left spine names save trouble", () => {
    useChromePresenceStore.setState({ folded: { ...ALL_OPEN, left: true } });
    useEditorStore.setState({ isDirty: true, saveError: "Network error" });
    render(<ChromeSpine unit="left" />);
    expect(screen.getByRole("button", { name: "Show On the floor" }).textContent).toContain("Retry save");
  });

  it("says save trouble beside the crest, and only trouble", () => {
    render(<ChromeSaveWord />);
    const word = screen.getByRole("status");
    expect(word.getAttribute("data-trouble")).toBe("false");
    act(() => { useEditorStore.setState({ saveError: "Network error" }); });
    expect(word.textContent).toBe("Retry save");
    expect(word.getAttribute("data-trouble")).toBe("true");
  });

  it("chromeSaveTrouble keeps quiet unless saving is in trouble", () => {
    const base = { configId: "cfg", saving: false, dirty: false, saveError: null, conflicted: false, online: true };
    expect(chromeSaveTrouble(base)).toBeNull();
    expect(chromeSaveTrouble({ ...base, dirty: true })).toBeNull();
    expect(chromeSaveTrouble({ ...base, saving: true, saveError: "x" })).toBeNull();
    expect(chromeSaveTrouble({ ...base, configId: null, saveError: "x" })).toBeNull();
    expect(chromeSaveTrouble({ ...base, conflicted: true })).toBe("Reload layout");
    expect(chromeSaveTrouble({ ...base, online: false, dirty: true })).toBe("Offline · not saved yet");
    expect(chromeSaveTrouble({ ...base, saveError: "Network error" })).toBe("Retry save");
  });

  it("the hint shows three times then never, and leaves on its own", () => {
    vi.useFakeTimers();
    render(<ChromeClearHint />);
    const hint = screen.getByRole("status");
    const shown: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      act(() => { useChromePresenceStore.getState().clearAll(); });
      shown.push(hint.getAttribute("data-shown") ?? "");
      act(() => { useChromePresenceStore.getState().restoreAll(); });
    }
    expect(shown).toEqual(["true", "true", "true", "false"]);

    useChromePresenceStore.setState({ hintsShown: 0 });
    act(() => { useChromePresenceStore.getState().clearAll(); });
    expect(hint.textContent).toBe("The tools are hidden · press \\ or the crest to bring them back");
    act(() => { vi.advanceTimersByTime(CLEAR_HINT_MS); });
    expect(hint.getAttribute("data-shown")).toBe("false");
    expect(hint.textContent).toBe("");
  });

  it("the phone seal restores", () => {
    render(<PhoneChromeSeal />);
    expect(screen.queryByRole("button", { name: "Show the tools" })).toBeNull();
    act(() => { useChromePresenceStore.getState().clearAll(); });
    const seal = screen.getByRole("button", { name: "Show the tools" });
    expect(seal.getAttribute("aria-keyshortcuts")).toBe("\\");
    fireEvent.click(seal);
    expect(useChromePresenceStore.getState().cleared).toBe(false);
    expect(screen.queryByRole("button", { name: "Show the tools" })).toBeNull();
  });
});
