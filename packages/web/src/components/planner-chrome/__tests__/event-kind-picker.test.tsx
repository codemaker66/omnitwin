import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useLayoutEffect, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventKindName, EventKindPicker } from "../EventKindPicker.js";
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
  openLayoutEventKind({ configId: CONFIG, isPublicPreview: true, search: "", metadata: null });
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
    expect(screen.getByText("Set up for a corporate event: rows of seats and the venue's pink chairs.")).toBeTruthy();
    await waitFor(() => { expect(screen.queryByRole("dialog")).toBeNull(); });
    expect(screen.getByRole("button", { name: "The event: Corporate event. Change it" })).toBeTruthy();
  });

  it("answers to 1, 2 and 3, and the planner's own keys never hear them", () => {
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

  it("skips on Escape, says where to answer later, and never asks that layout again", () => {
    openDraft();
    renderPlanner();
    fireEvent(question(), new Event("cancel", { cancelable: true }));
    expect(useEventKindQuestion.getState().answer).toBeNull();
    expect(deviceEventKind(CONFIG)).toBeNull();
    expect(screen.getByText("Noted. You can say what the event is any time, from the room's name.")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    cleanup();
    resetEventKindQuestionForTesting();
    openDraft();
    renderPlanner();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Say what the event is" })).toBeTruthy();
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

  it("does not ask a layout opened from an event", () => {
    openDraft();
    renderPlanner(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not ask a layout locked for review, and offers no change while it is", () => {
    openDraft({ inReview: true });
    renderPlanner();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Say what the event is" })).toBeNull();
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
    expect(screen.queryByRole("button", { name: "Say what the event is" })).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(within(question()).getByRole("button", { name: /^Corporate event.*chosen now$/u })).toBeTruthy();
  });
});
