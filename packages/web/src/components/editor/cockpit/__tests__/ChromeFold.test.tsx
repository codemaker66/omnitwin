import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { registerEscapeLayer } from "../../../../lib/planner-keys.js";
import { useChromePresenceStore } from "../../../../stores/chrome-presence-store.js";
import { useCockpitStore } from "../../../../stores/cockpit-store.js";
import { useEditorStore } from "../../../../stores/editor-store.js";
import { useToolStore } from "../../../../stores/tool-store.js";
import {
  CHROME_SETTLE_MS,
  CLEAR_HINT_MS,
  CLEAR_HINT_TEXT,
  CLEAR_HINT_VOICE,
  ChromeClearHint,
  ChromeFoldControls,
  ChromeFoldMark,
  ChromeSaveWord,
  ChromeSpine,
  PhoneChromeSeal,
  chromeSaveTrouble,
  settleChromeFocus,
  settleFocusAfterPreview,
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

function press(key: string, target: EventTarget = window, modifiers: KeyboardEventInit = {}): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...modifiers }));
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
  useToolStore.setState({ activeTool: "select" });
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

  // Found by the glide probe, 29 Oct: the cockpit leaves the store `instant`
  // as it goes (and React's development mount goes and comes back at once),
  // so motion stayed off, and with it the marks' fade and their moment of grace.
  it("brings motion back on the first frame after a cockpit that went before", async () => {
    const first = render(<Presence />);
    first.unmount();
    expect(useChromePresenceStore.getState().instant).toBe(true);
    render(<Presence />);
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
    act(() => { press("\\", field, { ctrlKey: true, altKey: true }); });
    expect(useChromePresenceStore.getState().cleared).toBe(false);
  });

  // Review finding, 28 Oct: \ is AltGr on German, French, Spanish and Nordic
  // keyboards (Ctrl and Alt as the browser reports it), and Option on a Mac's.
  it("backslash works wherever the keyboard keeps it", () => {
    render(<Presence />);
    act(() => { press("\\", window, { ctrlKey: true, altKey: true }); });
    expect(useChromePresenceStore.getState().cleared).toBe(true);
    act(() => { press("\\", window, { altKey: true, shiftKey: true }); });
    expect(useChromePresenceStore.getState().cleared).toBe(false);
    act(() => { press("\\", window, { ctrlKey: true }); });
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

  // Review finding, 28 Oct: keyboard focus never stays on chrome that has gone.
  it("moves focus off chrome that has gone: to the crest while cleared, to the left spine after", () => {
    useChromePresenceStore.setState({ folded: { ...ALL_OPEN, left: true } });
    render(
      <>
        <button type="button" data-planner-crest>Crest</button>
        <button type="button">On the dock</button>
        <ChromeSpine unit="left" />
      </>,
    );
    const crest = screen.getByRole("button", { name: "Crest" });
    const onTheDock = screen.getByRole("button", { name: "On the dock" });
    const spine = screen.getByRole("button", { name: "Show On the floor" });
    const hidden = new Set<Element>([onTheDock]);
    const onScreen = (element: Element): boolean => !hidden.has(element);

    onTheDock.focus();
    settleChromeFocus(document, onTheDock, true, onScreen);
    expect(document.activeElement).toBe(crest);

    // Brought back with the left dock folded, the crest goes with its dock.
    hidden.clear();
    hidden.add(crest);
    settleChromeFocus(document, crest, false, onScreen);
    expect(document.activeElement).toBe(spine);

    // Focus on something still seen stays put; nothing focused, nothing moves.
    settleChromeFocus(document, spine, true, onScreen);
    expect(document.activeElement).toBe(spine);
    spine.blur();
    settleChromeFocus(document, document.body, true, onScreen);
    expect(document.activeElement).toBe(document.body);
  });

  // Review finding, 28 Oct: a phone's first top-bar button can be disabled
  // (during a preview), and focus() on it does nothing; the next one takes it.
  it("passes over a control that will not take focus", () => {
    render(
      <>
        <div data-testid="mobile-planner-topbar">
          <button type="button" disabled>2D</button>
          <button type="button">More</button>
        </div>
        <button type="button" className="chrome-phone-seal">Seal</button>
      </>,
    );
    const seal = screen.getByRole("button", { name: "Seal" });
    seal.focus();
    // Restored: the seal has gone.
    settleChromeFocus(document, seal, false, (element) => element !== seal);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "More" }));
  });

  // Review finding, 28 Oct: ending a preview from the timeline bar while the
  // bottom unit is folded left focus on a control the fold then hid.
  it("moves focus to the spine when a preview ends inside a folded unit", async () => {
    useChromePresenceStore.setState({ folded: { ...ALL_OPEN, bottom: true } });
    render(
      <div className="reference-viewer">
        <footer className="cockpit-bottom"><button type="button">Collapse timeline</button></footer>
        <ChromeSpine unit="bottom" />
      </div>,
    );
    screen.getByRole("button", { name: "Collapse timeline" }).focus();
    settleFocusAfterPreview(document);
    await act(async () => { await nextFrame(); });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Show the bottom bar/u }));
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
      expect(screen.getByRole("button", { name: new RegExp(`^Show ${name}( · |$)`, "u") }).getAttribute("aria-expanded")).toBe("false");
    }
  });

  it("the tool bar's spine names the hand in use, in its name and on its face", () => {
    useToolStore.setState({ activeTool: "measure" });
    render(<ChromeSpine unit="top" />);
    const spine = screen.getByRole("button", { name: "Show the tool bar · Measure" });
    expect(spine.textContent).toContain("Measure");
    act(() => { useToolStore.setState({ activeTool: "add" }); });
    expect(screen.getByRole("button", { name: "Show the tool bar" }).textContent).toBe("");
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
    fireEvent.click(screen.getByRole("button", { name: /^Show the tool bar/u }));
    expect(useChromePresenceStore.getState().folded.top).toBe(false);
    await act(async () => { await nextFrame(); });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Fold the tool bar" }));
  });

  it("folded left spine shows save trouble, and describes it to a screen reader", () => {
    useChromePresenceStore.setState({ folded: { ...ALL_OPEN, left: true } });
    useEditorStore.setState({ isDirty: true, saveError: "Network error" });
    render(<ChromeSpine unit="left" />);
    const spine = screen.getByRole("button", { name: "Show On the floor" });
    expect(spine.textContent).toContain("Retry save");
    // What a screen reader hears besides the name: the count as the dock says it, then the trouble.
    const [count, trouble] = (spine.getAttribute("aria-describedby") ?? "").split(" ").map((id) => document.getElementById(id));
    expect(count?.querySelector(".chrome-sr-only")?.textContent).toBe("0 pieces on the floor.");
    expect(count?.querySelector("[aria-hidden='true']")?.textContent).toBe("0");
    expect(trouble?.textContent).toBe("Retry save");
  });

  // Review findings, 28 Oct: the header's live region goes with a folded or
  // cleared dock, so this one speaks for it: every change from the moment it
  // went, never what the header had already said (that would be said twice),
  // and on a phone only while cleared (its top bar has a voice of its own).
  it("speaks the header's save line while the header is away, from the next change on", () => {
    render(<ChromeSaveWord />);
    const voice = screen.getByRole("status");
    const word = voice.closest(".chrome-save-word");
    expect(voice.textContent).toBe("");
    act(() => { useEditorStore.setState({ saveError: "Network error" }); });
    expect(voice.textContent).toBe("");

    // Folded with trouble the header has already said: nothing more is said.
    act(() => { useChromePresenceStore.getState().fold("left"); });
    expect(voice.textContent).toBe("");
    expect(word?.getAttribute("data-shown")).toBe("false");

    // Then every change is said, recovery too.
    act(() => { useEditorStore.setState({ isSaving: true }); });
    expect(voice.textContent).toBe("Saving…");
    act(() => { useEditorStore.setState({ isSaving: false, saveError: null, isDirty: false }); });
    expect(voice.textContent).toBe("Layout saved");
    act(() => { useEditorStore.setState({ saveError: "Network error" }); });
    expect(voice.textContent).toBe("Retry save");

    // The ink shows only trouble, and only while cleared.
    act(() => { useChromePresenceStore.getState().clearAll(); });
    expect(word?.getAttribute("data-shown")).toBe("true");
    act(() => { useEditorStore.setState({ saveError: null }); });
    expect(word?.getAttribute("data-shown")).toBe("false");

    // Back in the header, the header speaks again.
    act(() => {
      useChromePresenceStore.getState().restoreAll();
      useChromePresenceStore.getState().unfold("left");
    });
    expect(voice.textContent).toBe("");
  });

  it("leaves a phone's top bar to speak while only a remembered left fold is in place", () => {
    useChromePresenceStore.setState({ folded: { ...ALL_OPEN, left: true } });
    render(<ChromeSaveWord mobile />);
    const voice = screen.getByRole("status");
    act(() => { useEditorStore.setState({ saveError: "Network error" }); });
    expect(voice.textContent).toBe("");
    act(() => { useChromePresenceStore.getState().clearAll(); });
    act(() => { useEditorStore.setState({ saveError: null, isDirty: false }); });
    expect(voice.textContent).toBe("Layout saved");
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
    // The voice is in the tree, empty, before the words arrive.
    const voice = screen.getByRole("status");
    const hint = voice.closest(".chrome-clear-hint");
    expect(voice.textContent).toBe("");
    const shown: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      act(() => { useChromePresenceStore.getState().clearAll(); });
      shown.push(hint?.getAttribute("data-shown") ?? "");
      act(() => { useChromePresenceStore.getState().restoreAll(); });
    }
    expect(shown).toEqual(["true", "true", "true", "false"]);

    useChromePresenceStore.setState({ hintsShown: 0 });
    act(() => { useChromePresenceStore.getState().clearAll(); });
    // The eye reads the \; the voice says the key's name, which a screen reader would otherwise drop.
    expect(hint?.textContent).toContain(CLEAR_HINT_TEXT);
    expect(CLEAR_HINT_TEXT).toBe("The tools are hidden · press \\ or the crest to bring them back");
    expect(voice.textContent).toBe(CLEAR_HINT_VOICE);
    expect(CLEAR_HINT_VOICE).toBe("The tools are hidden. Press backslash or the crest to bring them back.");
    act(() => { vi.advanceTimersByTime(CLEAR_HINT_MS); });
    expect(hint?.getAttribute("data-shown")).toBe("false");
    expect(voice.textContent).toBe("");
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
