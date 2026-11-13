import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useLayoutEffect, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT_KIND_RECEIPT_MS, EventKindName, EventKindPicker } from "../EventKindPicker.js";
import {
  deviceEventKind,
  openLayoutEventKind,
  rememberDeviceEventKind,
  resetEventKindQuestionForTesting,
  useEventKindQuestion,
} from "../../../lib/event-kind-record.js";
import { registerKeyBindings } from "../../../lib/planner-keys.js";
import { usePlannerEventStore } from "../../../stores/planner-event-store.js";
import { useEditorStore, type EditorObject } from "../../../stores/editor-store.js";

// ---------------------------------------------------------------------------
// "What are you planning?" (T-674): the first open of a new, empty layout
// asks with three panels; one tap, a number key or Enter answers, Escape or
// "Not sure yet" skips for good, the room's name changes it, and nothing it
// hears reaches the planner's own keys.
// ---------------------------------------------------------------------------

const CONFIG = "draft-1";

const TABLE: EditorObject = {
  id: "local-1",
  assetDefinitionId: "round-table-6ft",
  positionX: 1,
  positionY: 0,
  positionZ: 2,
  rotationX: 0,
  rotationY: 0,
  rotationZ: 0,
  scale: 1,
  sortOrder: 0,
  clothed: false, clothStyle: null, tableSetting: null, chairStyle: null, centerpiece: null,
  groupId: null,
  notes: "",
};

function reducedMotion(reduce: boolean): void {
  vi.spyOn(window, "matchMedia").mockImplementation((query: string): MediaQueryList => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

/** A guest's draft as the editor holds it once open, its answer read from this device as the load does. */
function openDraft(options: { readonly furnished?: boolean; readonly inReview?: boolean } = {}): void {
  useEditorStore.setState({
    configId: CONFIG,
    isPublicPreview: true,
    objects: options.furnished === true ? [TABLE] : [],
    reviewStatus: options.inReview === true ? "submitted" : null,
  });
  openLayoutEventKind({ configId: CONFIG, isPublicPreview: true, search: "", metadata: null, floorEmptyAtOpen: options.furnished !== true });
}

/** The arrival's welcome, or any other dialog the page holds, as the browser shows it. */
function otherDialog(): HTMLDialogElement {
  const dialog = document.createElement("dialog");
  dialog.setAttribute("aria-label", "Opening the Grand Hall");
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

/** The room's name and the question, as the cockpit mounts them (it says whether the layout came from an event). */
function renderPlanner(eventLinked = false): void {
  render(
    <>
      <EventKindName />
      <EventKindPicker eventLinked={eventLinked} />
    </>,
  );
}

const question = (): HTMLElement => screen.getByRole("dialog", { name: "What are you planning?" });

beforeEach(() => {
  window.localStorage.clear();
  resetEventKindQuestionForTesting();
  reducedMotion(false);
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function showModal(this: HTMLDialogElement) { this.open = true; });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function close(this: HTMLDialogElement) { this.open = false; });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetEventKindQuestionForTesting();
  useEditorStore.setState({ configId: null, isPublicPreview: false, objects: [], reviewStatus: null });
});

describe("the first open of a new layout", () => {
  it("asks what the event is with three named panels, the first in hand, and a way to skip", () => {
    openDraft();
    renderPlanner();
    const dialog = question();
    const wedding = within(dialog).getByRole("button", { name: "Wedding: Round tables and gold Chiavari chairs" });
    expect(within(dialog).getByRole("button", { name: "Corporate event: Rows of seats and the venue's pink chairs" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Something else: The venue's pink chairs, laid out your way" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Not sure yet" })).toBeTruthy();
    expect(document.activeElement).toBe(wedding);
  });

  it("sets up the room for the pick, keeps it on this device and says what it set", async () => {
    openDraft();
    renderPlanner();
    fireEvent.click(within(question()).getByRole("button", { name: /^Corporate event/u }));
    expect(usePlannerEventStore.getState().eventKind).toBe("corporate");
    expect(deviceEventKind(CONFIG)).toBe("corporate");
    await waitFor(() => { expect(screen.queryByRole("dialog")).toBeNull(); });
    expect(await screen.findByText("Set up for a corporate event: rows of seats and the venue's pink chairs.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "The event: Corporate event. Change it" })).toBeTruthy();
  });

  it("answers to 1, 2 and 3", () => {
    openDraft();
    renderPlanner();
    const plannerKey = vi.fn();
    const stop = registerKeyBindings([{ keys: [{ code: "Digit3" }], run: plannerKey }]);
    fireEvent.keyDown(question(), { key: "3", code: "Digit3" });
    stop();
    expect(usePlannerEventStore.getState().eventKind).toBe("other");
    expect(plannerKey).not.toHaveBeenCalled();
  });

  it("moves between the panels with the arrows", () => {
    openDraft();
    renderPlanner();
    const dialog = question();
    fireEvent.keyDown(dialog, { key: "ArrowRight", code: "ArrowRight" });
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: /^Corporate event/u }));
    fireEvent.keyDown(dialog, { key: "ArrowLeft", code: "ArrowLeft" });
    fireEvent.keyDown(dialog, { key: "ArrowLeft", code: "ArrowLeft" });
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: /^Something else/u }));
  });

  it("skips on Escape, says where to answer later, and never asks that layout again", async () => {
    openDraft();
    renderPlanner();
    fireEvent(question(), new Event("cancel", { cancelable: true }));
    expect(useEventKindQuestion.getState().answer).toBeNull();
    expect(deviceEventKind(CONFIG)).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await screen.findByText("Noted. You can add the event any time, by the room's name.")).toBeTruthy();
    cleanup();
    resetEventKindQuestionForTesting();
    openDraft();
    renderPlanner();
    expect(screen.queryByRole("dialog")).toBeNull();
    // Unanswered, the name is its visible words, so a voice saying them finds it.
    expect(screen.getByRole("button", { name: "Add the event" })).toBeTruthy();
  });

  it("skips on Not sure yet in the same way", () => {
    openDraft();
    renderPlanner();
    fireEvent.click(within(question()).getByRole("button", { name: "Not sure yet" }));
    expect(useEventKindQuestion.getState()).toMatchObject({ known: true, answer: null });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("hands the room back at once under reduced motion", () => {
    reducedMotion(true);
    openDraft();
    renderPlanner();
    fireEvent.click(within(question()).getByRole("button", { name: /^Wedding/u }));
    expect(usePlannerEventStore.getState().eventKind).toBe("wedding");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("never over someone's work", () => {
  it("does not ask a layout with something on the floor", () => {
    openDraft({ furnished: true });
    renderPlanner();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("never asks a layout that was furnished as it opened, however empty its floor becomes", () => {
    openDraft({ furnished: true });
    renderPlanner();
    // Select all and Delete, the last table deleted, or a co-editor clearing the room.
    act(() => { useEditorStore.setState({ objects: [] }); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Add the event" })).toBeTruthy();
  });

  it("stops asking a new layout once something has stood on it, even after the floor is cleared", () => {
    openDraft();
    // Opened from an event, so not asked; then furnished, and cleared again.
    const { rerender } = render(<><EventKindName /><EventKindPicker eventLinked /></>);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => { useEditorStore.setState({ objects: [TABLE] }); });
    act(() => { useEditorStore.setState({ objects: [] }); });
    rerender(<><EventKindName /><EventKindPicker eventLinked={false} /></>);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not ask a layout opened from an event", () => {
    openDraft();
    renderPlanner(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not ask a layout locked for review, and offers no change while it is", () => {
    openDraft({ inReview: true });
    renderPlanner();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add the event" })).toBeNull();
  });

  it("does not ask on a device told not to", () => {
    window.localStorage.setItem("venviewer.planner.eventKind", JSON.stringify({ version: 1, entries: [], quiet: true }));
    openDraft();
    renderPlanner();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not ask until the layout's answer has been read", () => {
    useEditorStore.setState({ configId: CONFIG, isPublicPreview: false, objects: [], reviewStatus: null });
    renderPlanner();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add the event" })).toBeNull();
  });

  it("keeps the name's row while it is hidden, so nothing below it moves as the layout opens", () => {
    useEditorStore.setState({ configId: CONFIG, isPublicPreview: false, objects: [], reviewStatus: null });
    const { container } = render(<EventKindName />);
    const reserved = container.querySelector(".ekp-name.is-reserved");
    expect(reserved?.getAttribute("aria-hidden")).toBe("true");
    act(() => { openLayoutEventKind({ configId: CONFIG, isPublicPreview: false, search: "", metadata: { eventKind: "wedding" }, floorEmptyAtOpen: true }); });
    expect(container.querySelector(".ekp-name.is-reserved")).toBeNull();
    expect(screen.getByRole("button", { name: "The event: Wedding. Change it" })).toBeTruthy();
  });
});

/**
 * Stands in for the arrival's welcome closing over the question. The welcome is the later top-layer dialog and
 * holds the focus; PlannerArrival closes it in its layout cleanup, and the browser hands focus back to the panel
 * in hand inside the commit that removes the welcome, while React's own events are paused.
 */
function WelcomeClosingOver(): ReactElement {
  useLayoutEffect(() => () => {
    document.querySelector<HTMLElement>("[data-testid=event-kind-wedding]")?.focus();
  }, []);
  return <a href="/">Venviewer home</a>;
}

describe("the panel in hand", () => {
  it("rises when focus comes back to it as the arrival's welcome closes", () => {
    reducedMotion(true);
    openDraft();
    const { rerender } = render(<><EventKindPicker /><WelcomeClosingOver /></>);
    const wedding = within(question()).getByRole("button", { name: /^Wedding/u });
    expect(wedding.style.getPropertyValue("--ekp-lift")).toBe("1");
    // The welcome opens over the question and takes the focus.
    act(() => { screen.getByRole("link", { name: "Venviewer home" }).focus(); });
    expect(wedding.style.getPropertyValue("--ekp-lift")).toBe("0");
    rerender(<EventKindPicker />);
    expect(document.activeElement).toBe(wedding);
    expect(wedding.style.getPropertyValue("--ekp-lift")).toBe("1");
  });

  it("stays in hand when the pointer passes over it and leaves", () => {
    reducedMotion(true);
    openDraft();
    renderPlanner();
    const wedding = within(question()).getByRole("button", { name: /^Wedding/u });
    fireEvent.pointerEnter(wedding, { pointerType: "mouse" });
    fireEvent.pointerLeave(wedding, { pointerType: "mouse" });
    expect(document.activeElement).toBe(wedding);
    expect(wedding.style.getPropertyValue("--ekp-lift")).toBe("1");
  });

  it("is carried by the mouse, one panel at a time, and a touch does not move it", () => {
    reducedMotion(true);
    openDraft();
    renderPlanner();
    const dialog = question();
    const wedding = within(dialog).getByRole("button", { name: /^Wedding/u });
    const corporate = within(dialog).getByRole("button", { name: /^Corporate event/u });
    const other = within(dialog).getByRole("button", { name: /^Something else/u });
    fireEvent.pointerEnter(corporate, { pointerType: "mouse" });
    expect(document.activeElement).toBe(corporate);
    expect(corporate.style.getPropertyValue("--ekp-lift")).toBe("1");
    expect(wedding.style.getPropertyValue("--ekp-lift")).toBe("0");
    fireEvent.pointerEnter(other, { pointerType: "touch" });
    expect(document.activeElement).toBe(corporate);
    expect(other.style.getPropertyValue("--ekp-lift")).toBe("0");
  });
});

describe("changing the answer", () => {
  it("opens from the room's name with the answer marked, and Keep leaves it as it was", () => {
    rememberDeviceEventKind(CONFIG, "wedding");
    openDraft();
    renderPlanner();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "The event: Wedding. Change it" }));
    const dialog = question();
    expect(within(dialog).getByRole("button", { name: "Wedding: Round tables and gold Chiavari chairs, chosen now" })).toBe(document.activeElement);
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep it as it is" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(usePlannerEventStore.getState().eventKind).toBe("wedding");
  });

  it("takes a new answer, and the receipt can open it again", async () => {
    rememberDeviceEventKind(CONFIG, "wedding");
    openDraft();
    renderPlanner();
    fireEvent.click(screen.getByRole("button", { name: "The event: Wedding. Change it" }));
    fireEvent.click(within(question()).getByRole("button", { name: /^Corporate event/u }));
    expect(deviceEventKind(CONFIG)).toBe("corporate");
    await waitFor(() => { expect(screen.queryByRole("dialog")).toBeNull(); });
    fireEvent.click(await screen.findByRole("button", { name: "Change" }));
    expect(within(question()).getByRole("button", { name: /^Corporate event.*chosen now$/u })).toBeTruthy();
  });

  it("hands focus back to the event's name after a change opened from the receipt, whose button went as it opened", async () => {
    reducedMotion(true);
    openDraft();
    renderPlanner();
    fireEvent.click(within(question()).getByRole("button", { name: /^Wedding/u }));
    const change = await screen.findByRole("button", { name: "Change" });
    act(() => { change.focus(); });
    fireEvent.click(change);
    fireEvent.click(within(question()).getByRole("button", { name: "Keep it as it is" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "The event: Wedding. Change it" }));
  });
});

describe("the receipt", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("speaks only once no dialog holds the page, so its words are read out", async () => {
    reducedMotion(true);
    const welcome = otherDialog();
    openDraft();
    renderPlanner();
    fireEvent.click(within(question()).getByRole("button", { name: /^Wedding/u }));
    expect(screen.queryByRole("dialog", { name: "What are you planning?" })).toBeNull();
    await new Promise((resolve) => { window.setTimeout(resolve, 60); });
    // The welcome still holds the page: everything outside it is inert.
    expect(screen.queryByTestId("event-kind-receipt")).toBeNull();
    act(() => {
      welcome.close();
      welcome.dispatchEvent(new Event("close"));
    });
    expect(await screen.findByText("Set up for a wedding: round tables and gold Chiavari chairs.")).toBeTruthy();
    welcome.remove();
  });

  it("stays while a pointer is over it or focus is in it, and goes once neither is", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
    reducedMotion(true);
    openDraft();
    renderPlanner();
    fireEvent.click(within(question()).getByRole("button", { name: /^Wedding/u }));
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    const receipt = screen.getByTestId("event-kind-receipt");
    fireEvent.pointerEnter(receipt);
    await act(async () => { await vi.advanceTimersByTimeAsync(EVENT_KIND_RECEIPT_MS * 2); });
    expect(screen.getByTestId("event-kind-receipt")).toBe(receipt);
    act(() => { within(receipt).getByRole("button", { name: "Change" }).focus(); });
    fireEvent.pointerLeave(receipt);
    await act(async () => { await vi.advanceTimersByTimeAsync(EVENT_KIND_RECEIPT_MS * 2); });
    expect(screen.getByTestId("event-kind-receipt")).toBe(receipt);
    act(() => { within(receipt).getByRole("button", { name: "Change" }).blur(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(EVENT_KIND_RECEIPT_MS - 1); });
    expect(screen.getByTestId("event-kind-receipt")).toBe(receipt);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.queryByTestId("event-kind-receipt")).toBeNull();
  });
});

describe("Escape, and the welcome above it", () => {
  it("stays when a press reached the welcome above it first, and shows itself again if the browser closed it anyway", () => {
    openDraft();
    renderPlanner();
    const asking = question() as HTMLDialogElement;
    const welcome = otherDialog();
    // One press reaches every dialog opened together, the top one first, in one task.
    act(() => {
      welcome.dispatchEvent(new Event("cancel", { cancelable: false }));
      fireEvent(asking, new Event("cancel", { cancelable: false }));
    });
    expect(useEventKindQuestion.getState().answer).toBeUndefined();
    // On a page nobody has touched yet, the browser closes both regardless.
    act(() => {
      asking.close();
      fireEvent(asking, new Event("close"));
    });
    expect(asking.open).toBe(true);
    expect(useEventKindQuestion.getState().answer).toBeUndefined();
    expect(document.activeElement).toBe(within(asking).getByRole("button", { name: /^Wedding/u }));
    welcome.remove();
  });

  it("skips on a press of its own once the welcome's press is over", async () => {
    openDraft();
    renderPlanner();
    const asking = question() as HTMLDialogElement;
    const welcome = otherDialog();
    act(() => { welcome.dispatchEvent(new Event("cancel", { cancelable: false })); });
    await new Promise((resolve) => { window.setTimeout(resolve, 0); });
    act(() => { fireEvent(asking, new Event("cancel", { cancelable: true })); });
    expect(useEventKindQuestion.getState().answer).toBeNull();
    welcome.remove();
  });
});

describe("the planner's keys while it asks", () => {
  it.each<[string, { readonly key: string; readonly code: string; readonly ctrlKey?: boolean }]>([
    ["a tool's letter", { key: "t", code: "KeyT" }],
    ["Delete", { key: "Delete", code: "Delete" }],
    ["undo", { key: "z", code: "KeyZ", ctrlKey: true }],
  ])("keeps %s from the planner's keymap, pressed and let go", (_, press) => {
    openDraft();
    renderPlanner();
    const run = vi.fn();
    const release = vi.fn();
    // Bound to run even under a dialog: only the question's own keys stop it hearing them.
    const stop = registerKeyBindings([{ keys: [{ code: press.code, mod: press.ctrlKey === true }], run, release, duringModal: true }]);
    fireEvent.keyDown(question(), press);
    fireEvent.keyUp(question(), press);
    stop();
    expect(run).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it("holds the keymap while it is the dialog on top, wherever focus has gone, and an Escape there skips", () => {
    openDraft();
    renderPlanner();
    const plannerKey = vi.fn();
    const stop = registerKeyBindings([{ keys: [{ code: "KeyM" }], run: plannerKey }]);
    act(() => { (document.activeElement as HTMLElement | null)?.blur(); });
    fireEvent.keyDown(document.body, { key: "m", code: "KeyM" });
    expect(plannerKey).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });
    stop();
    expect(useEventKindQuestion.getState().answer).toBeNull();
  });

  it("lets the welcome above it have its own Escape", () => {
    openDraft();
    renderPlanner();
    const welcome = otherDialog();
    act(() => { (document.activeElement as HTMLElement | null)?.blur(); });
    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });
    expect(useEventKindQuestion.getState().answer).toBeUndefined();
    welcome.remove();
  });
});
