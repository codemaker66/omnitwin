import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startTransition } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { getVenue, type VenueDetail } from "../../../../api/spaces.js";
import { useEditorStore, type EditorSaveConflict } from "../../../../stores/editor-store.js";
import { useAuthStore } from "../../../../stores/auth-store.js";
import { useLayoutTimelinePreviewStore } from "../../../../stores/layout-timeline-preview-store.js";
import { useChromePresenceStore } from "../../../../stores/chrome-presence-store.js";
import { ReferenceRoomHeader } from "../ReferenceRoomHeader.js";
import { CREST_LABEL_DELAY_MS, focusCrestQuietly } from "../CrestLabel.js";
import { useChromePresence } from "../ChromeFold.js";

vi.mock("../../../../api/spaces.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../../api/spaces.js")>(),
  getVenue: vi.fn(),
}));

const venueRequest = vi.mocked(getVenue);
const tradesHall: VenueDetail = {
  id: "venue-trades",
  name: "Trades Hall Glasgow",
  slug: "trades-hall-glasgow",
  address: "85 Glassford Street",
  logoUrl: "https://example.com/old-trades-logo.png",
  brandColour: null,
  spaces: [],
};
const cityRooms: VenueDetail = {
  id: "venue-city",
  name: "City Rooms",
  slug: "city-rooms",
  address: "1 Example Street",
  logoUrl: "https://example.com/city-rooms-logo.png",
  brandColour: null,
  spaces: [],
};

function deferredVenue(): {
  readonly promise: Promise<VenueDetail>;
  readonly resolve: (venue: VenueDetail) => void;
  readonly reject: (error: Error) => void;
} {
  let resolve: (venue: VenueDetail) => void = () => { throw new Error("Promise not initialized"); };
  let reject: (error: Error) => void = () => { throw new Error("Promise not initialized"); };
  const promise = new Promise<VenueDetail>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const originalSave = useEditorStore.getState().saveToServer;
const save = vi.fn<typeof originalSave>().mockResolvedValue(true);
const originalReload = useEditorStore.getState().reloadAfterConflict;
const reload = vi.fn<typeof originalReload>().mockResolvedValue(undefined);

beforeEach(() => {
  save.mockClear();
  reload.mockClear();
  venueRequest.mockReset();
  useEditorStore.setState({ configId: "cfg-demo", venueId: null, space: null, isSaving: false, isDirty: true, saveError: null, saveConflict: null, saveToServer: save, reloadAfterConflict: reload });
  useAuthStore.getState().setUser({ id: "staff-user", role: "staff", platformRole: "none", venueId: cityRooms.id, name: "Staff", email: "staff@example.test" });
  useLayoutTimelinePreviewStore.getState().clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useEditorStore.setState({ saveToServer: originalSave, reloadAfterConflict: originalReload, saveConflict: null });
  useLayoutTimelinePreviewStore.getState().clear();
  useChromePresenceStore.getState().resetCleared();
});

/** The venue's crest: since T-680 its own button (the switch for the tools), beside the name that goes home. */
function crest(): HTMLElement {
  return screen.getByRole("button", { name: /the tools$/u });
}

const CHANGED_ELSEWHERE: EditorSaveConflict = {
  expectedRevision: 1, currentRevision: 2, message: "Changed",
  changedBy: null, changedAt: null, byYou: false, theirChange: null,
};

function showHeader(): void {
  render(<MemoryRouter><ReferenceRoomHeader /></MemoryRouter>);
}

/** The cockpit's side of the chrome: its Esc rung brings cleared tools back. */
function Presence(): null {
  useChromePresence();
  return null;
}

function showHeaderInCockpit(): void {
  render(<MemoryRouter><Presence /><ReferenceRoomHeader /></MemoryRouter>);
}

describe("ReferenceRoomHeader", () => {
  it.each(["client", "planner"])("takes a linked %s to their event instead of the venue diary", (role) => {
    useAuthStore.getState().setUser({ id: "customer", role, platformRole: "none", venueId: null, name: "Customer", email: "customer@example.test" });
    render(<MemoryRouter initialEntries={["/plan/layout?eventId=11111111-1111-4111-8111-111111111111"]}><ReferenceRoomHeader /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Venue planner event details" }).getAttribute("href")).toBe("/events/11111111-1111-4111-8111-111111111111");
  });
  it("uses the selected Trades Hall venue and supplied crest while retaining its room subtitle", async () => {
    venueRequest.mockResolvedValue(tradesHall);
    useEditorStore.setState({
      venueId: tradesHall.id,
      space: { id: "space-grand", venueId: tradesHall.id, name: "Grand Hall", slug: "grand-hall", widthM: "21", lengthM: "10.5", heightM: "7.5", floorPlanOutline: [] },
    });
    useAuthStore.setState({ user: { id: "user-city", email: "planner@example.com", name: "City Planner", role: "planner", platformRole: "none", venueId: cityRooms.id } });
    showHeader();
    const identity = await screen.findByRole("link", { name: "Trades Hall of Glasgow home" });
    expect(venueRequest).toHaveBeenCalledWith(tradesHall.id);
    expect(venueRequest).not.toHaveBeenCalledWith(cityRooms.id);
    expect(identity.textContent).toContain("Grand Hall");
    expect(crest().querySelector("img")?.getAttribute("src")).toBe("/images/venues/trades-hall-glasgow-crest-200.webp");
    expect(screen.queryByText("VENVIEWER")).toBeNull();
  });

  it("uses another selected venue's own name and logo", async () => {
    venueRequest.mockResolvedValue(cityRooms);
    useEditorStore.setState({ venueId: cityRooms.id });
    showHeader();
    await screen.findByRole("link", { name: "City Rooms diary" });
    expect(crest().querySelector("img")?.getAttribute("src")).toBe(cityRooms.logoUrl);
    act(() => { useAuthStore.setState({ isAuthenticated: false }); });
    expect(screen.getByRole("link", { name: "City Rooms home" }).getAttribute("href")).toBe("/");
  });

  it("keeps the current venue when an older selection's request resolves last", async () => {
    const first = deferredVenue();
    const second = deferredVenue();
    venueRequest.mockImplementation((venueId) => venueId === tradesHall.id ? first.promise : second.promise);
    useEditorStore.setState({ venueId: tradesHall.id });
    showHeader();
    expect(screen.getByRole("link", { name: "Venue planner diary" }).querySelector("[data-activity-indicator]")).not.toBeNull();
    act(() => { useEditorStore.setState({ venueId: cityRooms.id }); });
    await act(async () => { second.resolve(cityRooms); await second.promise; });
    expect(screen.getByRole("link", { name: "City Rooms diary" })).toBeTruthy();
    await act(async () => { first.resolve(tradesHall); await first.promise; });
    expect(screen.getByRole("link", { name: "City Rooms diary" })).toBeTruthy();
    expect(crest().querySelector("img")?.getAttribute("src")).toBe(cityRooms.logoUrl);
    expect(screen.queryByRole("link", { name: "Trades Hall of Glasgow diary" })).toBeNull();
  });

  it("clears the previous identity during a selection change and reports a failed lookup without its crest", async () => {
    const second = deferredVenue();
    venueRequest.mockImplementation((venueId) => venueId === tradesHall.id ? Promise.resolve(tradesHall) : second.promise);
    useEditorStore.setState({ venueId: tradesHall.id });
    showHeader();
    await screen.findByRole("link", { name: "Trades Hall of Glasgow diary" });
    act(() => { useEditorStore.setState({ venueId: cityRooms.id }); });
    expect(screen.getByRole("link", { name: "Venue planner diary" })).toBeTruthy();
    expect(crest().querySelector("img")).toBeNull();
    expect(screen.queryByRole("link", { name: "Trades Hall of Glasgow diary" })).toBeNull();
    await act(async () => { second.reject(new Error("Venue lookup failed")); await second.promise.catch(() => undefined); });
    const unavailable = screen.getByRole("link", { name: "Venue unavailable diary" });
    expect(crest().querySelector("img")).toBeNull();
    expect(unavailable.querySelector("[data-activity-indicator]")).toBeNull();
  });

  it("uses a neutral mark when the selected venue has no logo", async () => {
    venueRequest.mockResolvedValue({ ...cityRooms, logoUrl: null });
    useEditorStore.setState({ venueId: cityRooms.id });
    showHeader();
    await screen.findByRole("link", { name: "City Rooms diary" });
    expect(crest().querySelector("img")).toBeNull();
    expect(crest().querySelector("svg")).not.toBeNull();
  });

  it("falls back to a neutral mark if the selected venue's logo fails to load", async () => {
    venueRequest.mockResolvedValue(cityRooms);
    useEditorStore.setState({ venueId: cityRooms.id });
    showHeader();
    const identity = await screen.findByRole("link", { name: "City Rooms diary" });
    const logo = crest().querySelector("img");
    expect(logo).not.toBeNull();
    if (logo === null) throw new Error("Expected the venue logo before simulating a failed image load");
    fireEvent.error(logo);
    expect(crest().querySelector("img")).toBeNull();
    expect(crest().querySelector("svg")).not.toBeNull();
    expect(identity.textContent).toContain("City Rooms");
  });

  // Blake, 28 Oct 2026: "Crest hides; name goes home" (T-680).
  it("the crest hides and shows the tools, and the name still goes home", async () => {
    venueRequest.mockResolvedValue(cityRooms);
    useEditorStore.setState({ venueId: cityRooms.id });
    showHeader();
    const home = await screen.findByRole("link", { name: "City Rooms diary" });
    expect(home.getAttribute("href")).toBe("/diary");
    expect(home.querySelector("img")).toBeNull();

    const hide = screen.getByRole("button", { name: "Hide the tools" });
    expect(hide.getAttribute("aria-keyshortcuts")).toBe("\\");
    expect(hide.querySelector(".reference-crest__label")?.textContent).toBe("Hide the tools · \\");
    fireEvent.click(hide);
    expect(useChromePresenceStore.getState().cleared).toBe(true);

    const show = screen.getByRole("button", { name: "Show the tools" });
    expect(show.querySelector(".reference-crest__label")?.textContent).toBe("Show the tools · \\");
    fireEvent.click(show);
    expect(useChromePresenceStore.getState().cleared).toBe(false);
    expect(screen.getByRole("button", { name: "Hide the tools" })).toBeTruthy();
  });

  // WCAG 1.4.13 (review finding, 28 Oct): the crest's name shows when the hand
  // rests on the crest, the hand can move onto it, and Esc puts it away
  // without moving either and without touching the tools.
  it("names the crest when a hand rests on it, and Esc puts the name away alone", () => {
    vi.useFakeTimers();
    showHeaderInCockpit();
    const button = crest();
    const label = button.querySelector(".reference-crest__label");
    expect(label?.getAttribute("aria-hidden")).toBe("true");
    fireEvent.pointerEnter(button, { pointerType: "touch" });
    act(() => { vi.advanceTimersByTime(CREST_LABEL_DELAY_MS); });
    expect(label?.getAttribute("data-shown")).toBe("false");
    fireEvent.pointerLeave(button, { pointerType: "touch" });

    // The tools are cleared first, so an Esc that also brought them back would show.
    act(() => { useChromePresenceStore.setState({ cleared: true, hintPending: false }); });
    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    act(() => { vi.advanceTimersByTime(CREST_LABEL_DELAY_MS - 10); });
    expect(label?.getAttribute("data-shown")).toBe("false");
    act(() => { vi.advanceTimersByTime(10); });
    expect(label?.getAttribute("data-shown")).toBe("true");

    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    expect(label?.getAttribute("data-shown")).toBe("false");
    expect(useChromePresenceStore.getState().cleared).toBe(true);
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    expect(useChromePresenceStore.getState().cleared).toBe(false);

    // Put away, it stays away until the hand leaves; the next rest shows it again.
    act(() => { vi.advanceTimersByTime(CREST_LABEL_DELAY_MS); });
    expect(label?.getAttribute("data-shown")).toBe("false");
    fireEvent.pointerLeave(button, { pointerType: "mouse" });
    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    act(() => { vi.advanceTimersByTime(CREST_LABEL_DELAY_MS); });
    expect(label?.getAttribute("data-shown")).toBe("true");
  });

  it("shows the crest's name to the keyboard, but not when the chrome moves focus there itself", () => {
    showHeader();
    const button = crest();
    const label = button.querySelector(".reference-crest__label");
    act(() => { focusCrestQuietly(button); });
    expect(document.activeElement).toBe(button);
    expect(label?.getAttribute("data-shown")).toBe("false");
    act(() => { button.blur(); });
    act(() => { button.focus(); });
    expect(label?.getAttribute("data-shown")).toBe("true");
  });

  // Review finding, 28 Oct: a crest pressed from the keyboard kept its name,
  // so the next Esc only put the name away.
  it("puts the name away once the crest is pressed, so the next Esc restores", () => {
    showHeaderInCockpit();
    const button = crest();
    const label = button.querySelector(".reference-crest__label");
    act(() => { button.focus(); });
    expect(label?.getAttribute("data-shown")).toBe("true");
    act(() => { useChromePresenceStore.setState({ hintsShown: 3 }); });
    fireEvent.click(button);
    expect(useChromePresenceStore.getState().cleared).toBe(true);
    expect(label?.getAttribute("data-shown")).toBe("false");
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    expect(useChromePresenceStore.getState().cleared).toBe(false);
  });

  // 4 Nov (frame 09, then a probe of it in Chromium): a press in the frame the
  // hand arrives in lands before React has drawn the hand (an arrival is a
  // continuous update, a press a discrete one), so the name came back 400 ms
  // later under the hand that had just pressed it, and the next Esc only put
  // that name away. A transition stands in for the arrival's lower priority.
  it("puts the name away for a press that lands before the hand's arrival is drawn", () => {
    vi.useFakeTimers();
    showHeaderInCockpit();
    act(() => { useChromePresenceStore.setState({ hintsShown: 3 }); });
    const button = crest();
    const label = button.querySelector(".reference-crest__label");
    act(() => {
      startTransition(() => { fireEvent.pointerEnter(button, { pointerType: "mouse" }); });
      fireEvent.pointerDown(button, { pointerType: "mouse" });
      fireEvent.click(button);
    });
    expect(useChromePresenceStore.getState().cleared).toBe(true);
    act(() => { vi.advanceTimersByTime(CREST_LABEL_DELAY_MS * 3); });
    expect(label?.getAttribute("data-shown")).toBe("false");
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    expect(useChromePresenceStore.getState().cleared).toBe(false);
    // Once the hand has left, a rest names the crest again.
    fireEvent.pointerLeave(button, { pointerType: "mouse" });
    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    act(() => { vi.advanceTimersByTime(CREST_LABEL_DELAY_MS); });
    expect(label?.getAttribute("data-shown")).toBe("true");
  });

  it("puts the name away for a \\ pressed before the hand's arrival is drawn", () => {
    vi.useFakeTimers();
    showHeaderInCockpit();
    act(() => { useChromePresenceStore.setState({ hintsShown: 3 }); });
    const button = crest();
    const label = button.querySelector(".reference-crest__label");
    act(() => {
      startTransition(() => { fireEvent.pointerEnter(button, { pointerType: "mouse" }); });
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "\\", bubbles: true, cancelable: true }));
    });
    expect(useChromePresenceStore.getState().cleared).toBe(true);
    act(() => { vi.advanceTimersByTime(CREST_LABEL_DELAY_MS * 3); });
    expect(label?.getAttribute("data-shown")).toBe("false");
  });

  // Review, 4 Nov: answering the name on pointerdown took the name's hit area
  // away before the release, so a press on its words never reached the crest.
  // Only a press that toggles the tools answers the name.
  it("keeps the name for a press that toggles nothing, such as the context menu's", () => {
    vi.useFakeTimers();
    showHeaderInCockpit();
    const button = crest();
    const label = button.querySelector(".reference-crest__label");
    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    act(() => { vi.advanceTimersByTime(CREST_LABEL_DELAY_MS); });
    expect(label?.getAttribute("data-shown")).toBe("true");
    fireEvent.pointerDown(button, { pointerType: "mouse", button: 2 });
    fireEvent.contextMenu(button);
    expect(useChromePresenceStore.getState().cleared).toBe(false);
    expect(label?.getAttribute("data-shown")).toBe("true");
  });

  it("names the crest at the next rest when hand and keyboard leave in one frame", () => {
    vi.useFakeTimers();
    showHeaderInCockpit();
    const button = crest();
    const label = button.querySelector(".reference-crest__label");
    act(() => { button.focus(); });
    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    expect(label?.getAttribute("data-shown")).toBe("true");
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    expect(label?.getAttribute("data-shown")).toBe("false");
    act(() => {
      startTransition(() => { fireEvent.pointerLeave(button, { pointerType: "mouse" }); });
      button.blur();
    });
    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    act(() => { vi.advanceTimersByTime(CREST_LABEL_DELAY_MS); });
    expect(label?.getAttribute("data-shown")).toBe("true");
  });

  it("lets the first-use note speak instead of the crest's name", () => {
    vi.useFakeTimers();
    showHeader();
    act(() => { useChromePresenceStore.setState({ hintPending: true }); });
    fireEvent.pointerEnter(crest(), { pointerType: "mouse" });
    act(() => { vi.advanceTimersByTime(CREST_LABEL_DELAY_MS); });
    expect(crest().querySelector(".reference-crest__label")?.getAttribute("data-shown")).toBe("false");
  });

  it("checks the live preview lock even before React replaces the prior click handler", () => {
    useEditorStore.setState({ saveError: "Changed elsewhere", saveConflict: CHANGED_ELSEWHERE });
    showHeader();
    const recovery = screen.getByRole("button", { name: "Reload layout" });
    act(() => {
      useLayoutTimelinePreviewStore.getState().showPending("Loading phase");
      // Both actions are in one batch: the button still has its old closure.
      fireEvent.click(recovery);
    });
    expect(reload).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("reloads a conflicted layout instead of resending a stale revision, respecting preview lock", () => {
    useEditorStore.setState({ saveError: "Changed elsewhere", saveConflict: CHANGED_ELSEWHERE });
    showHeader();
    expect(screen.getByRole("status").textContent).toBe("Reload layout");
    fireEvent.click(screen.getByRole("button", { name: "Reload layout" }));
    expect(reload).toHaveBeenCalledWith(true);
    expect(save).not.toHaveBeenCalled();
    act(() => { useLayoutTimelinePreviewStore.getState().showPending("Loading phase"); });
    fireEvent.click(screen.getByRole("button", { name: "Reload layout" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("uses the current authentication route and real save action", () => {
    showHeader();
    expect(screen.getByRole("link", { name: "Venue planner diary" }).getAttribute("href")).toBe("/diary");
    fireEvent.click(screen.getByRole("button", { name: "Save layout" }));
    expect(save).toHaveBeenCalledWith(true);
    act(() => { useAuthStore.setState({ isAuthenticated: false }); });
    expect(screen.getByRole("link", { name: "Venue planner home" }).getAttribute("href")).toBe("/");
    fireEvent.click(screen.getByRole("button", { name: "Save layout" }));
    expect(save).toHaveBeenLastCalledWith(false);
  });

  it("shows pending and failed save states without claiming success or allowing duplicate saves", () => {
    showHeader();
    act(() => { useEditorStore.setState({ isSaving: true }); });
    const pending = screen.getByRole("button", { name: "Saving…" });
    expect(screen.getByRole("status").textContent).toBe("Saving…");
    expect(pending.getAttribute("aria-busy")).toBe("true");
    expect(pending.querySelector("[data-activity-indicator]")).not.toBeNull();
    fireEvent.click(pending);
    expect(save).not.toHaveBeenCalled();
    act(() => { useEditorStore.setState({ isSaving: false, saveError: "Offline" }); });
    expect(screen.getByRole("status").textContent).toBe("Retry save");
    fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
    expect(save).toHaveBeenCalledTimes(1);
  });

  // A save the API refused because it would change a note this browser is not
  // shown (409 NOTE_HELD): the same save meets the same refusal, so the header
  // says the API's own sentence and nothing about retrying.
  it("says a save refused over a held note in the API's own words, with no Retry", () => {
    const refusal = "A note on this plan cannot be changed from here, and this save tried to change it. Reload the page, or clear the note you wrote on that piece.";
    showHeader();
    act(() => { useEditorStore.setState({ isSaving: false, isDirty: true, saveError: refusal, saveErrorCode: "NOTE_HELD" }); });
    expect(screen.getByRole("status").textContent).toBe(refusal);
    expect(document.body.textContent).not.toMatch(/retry/iu);
    expect(screen.queryByRole("button", { name: /retry/iu })).toBeNull();
    // The header's one save control is still that: it saves once the note is cleared.
    fireEvent.click(screen.getByRole("button", { name: refusal }));
    expect(save).toHaveBeenCalledTimes(1);
    // Any other failed save reads as it did.
    act(() => { useEditorStore.setState({ saveError: "Network error", saveErrorCode: "NETWORK_ERROR" }); });
    expect(screen.getByRole("status").textContent).toBe("Retry save");
    act(() => { useEditorStore.setState({ saveError: null, saveErrorCode: null }); });
  });

  it("never reads saved while the browser is offline with unsaved changes (D-03)", () => {
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    showHeader();
    act(() => { useEditorStore.setState({ isDirty: false, saveError: null }); });
    expect(screen.getByRole("status").textContent).toBe("Layout saved");
    onLine.mockReturnValue(false);
    act(() => { window.dispatchEvent(new Event("offline")); });
    // Offline with nothing unsaved is still true.
    expect(screen.getByRole("status").textContent).toBe("Layout saved");
    act(() => { useEditorStore.setState({ isDirty: true }); });
    expect(screen.getByRole("status").textContent).toBe("Offline · not saved yet");
    expect(screen.getByRole("button", { name: "Offline · not saved yet" }).getAttribute("title")).toBe("The connection has dropped. Press to save once it is back.");
    act(() => { useEditorStore.setState({ isSaving: false, saveError: "Network error" }); });
    expect(screen.getByRole("status").textContent).toBe("Offline · not saved yet");
    onLine.mockReturnValue(true);
    act(() => { window.dispatchEvent(new Event("online")); });
    expect(screen.getByRole("status").textContent).toBe("Retry save");
  });

  it("prevents saving a frozen phase preview or absent configuration", () => {
    showHeader();
    act(() => { useLayoutTimelinePreviewStore.getState().showPending("Loading saved phase"); });
    fireEvent.click(screen.getByRole("button", { name: "Save layout" }));
    expect(save).not.toHaveBeenCalled();
    act(() => { useLayoutTimelinePreviewStore.getState().clear(); useEditorStore.setState({ configId: null, isDirty: false }); });
    fireEvent.click(screen.getByRole("button", { name: "No saved layout" }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("No saved layout");
  });
});
