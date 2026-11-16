import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetPlacedIdCounter, type PlacedItem } from "../../../lib/placement.js";
import { setPlannerChromeFeatures, setPlannerFeaturesForTesting } from "../../../lib/planner-features.js";
import { cardParamsFor, stampSetup } from "../../../lib/setup-cards.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { useLayoutTimelinePreviewStore } from "../../../stores/layout-timeline-preview-store.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { HUD_SENT_STORAGE_KEY, usePlannerHudStore } from "../../../stores/planner-hud-store.js";
import { HudFrame } from "../HudFrame.js";
import { HudSheets } from "../HudSheets.js";

// ---------------------------------------------------------------------------
// The Send sheet's own wiring (review of 189d0c52, HB1, HB2 and HB6).
//
// Continue saves the layout and only then asks for the guest's details; the
// form is the whole planner's, so it stands outside this screen's element and
// keeps its own focus ring; and the plan is called sent only when the form
// says the enquiry has arrived, never because the form was put away.
//
// The save and the form are stood in for here: each has its own tests
// (send-layout-flow, GuestEnquiryModal.test.tsx). What is under test is what
// the sheet does with them.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({ prepare: vi.fn<(configId: string) => Promise<boolean>>() }));

vi.mock("../../editor/send-layout-flow.js", () => ({ prepareLayoutForGuestEnquiry: mocks.prepare }));
vi.mock("../../editor/GuestEnquiryModal.js", () => ({
  GuestEnquiryModal: ({ configId, onClose, onSubmitted }: { readonly configId: string; readonly onClose: () => void; readonly onSubmitted?: () => void }) => (
    <div data-testid="enquiry-form" data-config={configId} role="dialog" aria-modal="true" aria-label="Your details">
      <button type="button" onClick={() => { onSubmitted?.(); }}>The enquiry arrives</button>
      <button type="button" onClick={onClose}>Put the form away</button>
    </div>
  ),
}));

let sequence = 0;
function threeRounds(): readonly PlacedItem[] {
  const params = cardParamsFor("round", { seats: 10 });
  if (params === null) throw new Error("no round card");
  const newId = (): string => { sequence += 1; return `send-piece-${String(sequence)}`; };
  return [-4.5, 0, 4.5].flatMap((x) => stampSetup(params, { x, z: 0 }, 0, newId));
}

/** A save that has not finished: settled by the test. */
function pendingSave(): { readonly settle: (ready: boolean) => Promise<void>; readonly fail: () => Promise<void> } {
  let resolveSave: (ready: boolean) => void = () => undefined;
  let rejectSave: (reason: Error) => void = () => undefined;
  mocks.prepare.mockReturnValueOnce(new Promise<boolean>((done, failed) => { resolveSave = done; rejectSave = failed; }));
  return {
    settle: async (ready) => { await act(async () => { resolveSave(ready); await Promise.resolve(); }); },
    fail: async () => { await act(async () => { rejectSave(new Error("the save did not go through")); await Promise.resolve(); }); },
  };
}

function openSend(): HTMLElement {
  render(<HudFrame room={null} plaque={<p>The plaque</p>} eventGuests={null} sheets={<HudSheets />} />);
  act(() => { usePlannerHudStore.getState().openSheet("send"); });
  return screen.getByRole("dialog", { name: "Send to the events team" });
}

function primaryKey(): HTMLElement {
  const found = document.querySelector<HTMLElement>(".hud-shelf__act .hud-act");
  if (found === null) throw new Error("no primary key on the shelf");
  return found;
}

beforeEach(() => {
  sequence = 0;
  resetPlacedIdCounter();
  mocks.prepare.mockReset();
  window.localStorage.removeItem(HUD_SENT_STORAGE_KEY);
  usePlannerHudStore.setState({ sheet: null, sentLayoutIds: [], firstOpenDone: true });
  useEditorStore.setState({ configId: "layout-a", isPublicPreview: true });
  usePlacementStore.setState({ placedItems: threeRounds(), ghostPosition: null });
  act(() => { useCockpitStore.getState().setPlannedGuestCount(30); });
});

afterEach(() => {
  cleanup();
  usePlacementStore.setState({ placedItems: [], ghostPosition: null });
  useCockpitStore.getState().setPlannedGuestCount(null);
  useLayoutTimelinePreviewStore.getState().clear();
  usePlannerHudStore.setState({ sheet: null, sentLayoutIds: [] });
  window.localStorage.removeItem(HUD_SENT_STORAGE_KEY);
  useEditorStore.setState({ configId: null, isPublicPreview: false });
  setPlannerFeaturesForTesting(null);
  setPlannerChromeFeatures({});
});

describe("the Send sheet", () => {
  it("has nothing to send from an empty room, and offers no key", () => {
    usePlacementStore.setState({ placedItems: [] });
    const sheet = openSend();
    expect(sheet.textContent).toContain("There is nothing in the room yet.");
    expect(within(sheet).queryByRole("button", { name: "Continue" })).toBeNull();
  });

  it("sends a plan saved to an account for approval elsewhere, not as an enquiry", () => {
    useEditorStore.setState({ isPublicPreview: false });
    const sheet = openSend();
    expect(sheet.textContent).toContain("it goes to the venue for approval");
    expect(within(sheet).queryByRole("button", { name: "Continue" })).toBeNull();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("saves the layout first, saying so on a key at work, and only then asks for the guest's details", async () => {
    const save = pendingSave();
    const sheet = openSend();
    fireEvent.click(within(sheet).getByRole("button", { name: "Continue" }));
    expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith("layout-a");

    // While the save is on its way: the key says what is happening, is off, and no form is up.
    const working = within(sheet).getByRole("button", { name: "Preparing the layout" });
    expect(working.getAttribute("aria-busy")).toBe("true");
    expect((working as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId("enquiry-form")).toBeNull();
    // A second press while it works starts no second save.
    fireEvent.click(working);
    expect(mocks.prepare).toHaveBeenCalledTimes(1);

    await save.settle(true);
    expect(screen.getByTestId("enquiry-form").getAttribute("data-config")).toBe("layout-a");
    expect(within(sheet).getByRole("button", { name: "Continue" }).getAttribute("aria-busy")).toBe("false");
  });

  // The form is the whole planner's. Inside this screen's element it took the screen's page-wide rules: a focus ring
  // in the screen's ink on the form's dark glass, and its working state faded with the screen's disabled keys.
  it("stands the form outside this screen's own element", async () => {
    const save = pendingSave();
    const sheet = openSend();
    fireEvent.click(within(sheet).getByRole("button", { name: "Continue" }));
    await save.settle(true);
    const form = screen.getByTestId("enquiry-form");
    expect(screen.getByTestId("planner-hud").contains(form)).toBe(false);
    expect(form.closest(".hud-root")).toBeNull();
    expect(form.parentElement).toBe(document.body);
  });

  it("asks for nothing when the save says no, or fails", async () => {
    const refused = pendingSave();
    const sheet = openSend();
    fireEvent.click(within(sheet).getByRole("button", { name: "Continue" }));
    await refused.settle(false);
    expect(screen.queryByTestId("enquiry-form")).toBeNull();
    expect(within(sheet).getByRole("button", { name: "Continue" })).toBeTruthy();

    const failed = pendingSave();
    fireEvent.click(within(sheet).getByRole("button", { name: "Continue" }));
    await failed.fail();
    await waitFor(() => { expect(within(sheet).getByRole("button", { name: "Continue" })).toBeTruthy(); });
    expect(screen.queryByTestId("enquiry-form")).toBeNull();
  });

  it("asks for nothing when another layout has been opened while the first was saving", async () => {
    const save = pendingSave();
    const sheet = openSend();
    fireEvent.click(within(sheet).getByRole("button", { name: "Continue" }));
    act(() => { useEditorStore.setState({ configId: "layout-b" }); });
    await save.settle(true);
    expect(screen.queryByTestId("enquiry-form")).toBeNull();
  });

  it("leaves the plan unsent when the form is put away, and calls it sent only when the enquiry has arrived", async () => {
    const first = pendingSave();
    const sheet = openSend();
    fireEvent.click(within(sheet).getByRole("button", { name: "Continue" }));
    await first.settle(true);

    // Put away unsent: nothing has gone anywhere.
    fireEvent.click(screen.getByRole("button", { name: "Put the form away" }));
    expect(screen.queryByTestId("enquiry-form")).toBeNull();
    expect(primaryKey().getAttribute("data-move")).toBe("send");
    expect(usePlannerHudStore.getState().sentLayoutIds).toEqual([]);
    expect(within(sheet).getByRole("button", { name: "Continue" })).toBeTruthy();

    // Opened again, and this time it arrives.
    const second = pendingSave();
    fireEvent.click(within(sheet).getByRole("button", { name: "Continue" }));
    await second.settle(true);
    fireEvent.click(screen.getByRole("button", { name: "The enquiry arrives" }));
    expect(usePlannerHudStore.getState().sentLayoutIds).toEqual(["layout-a"]);
    expect(primaryKey().getAttribute("data-move")).toBe("sent");
    expect(primaryKey().textContent).toBe("Sent to the events team");
    expect(document.querySelector('[data-step="send"]')?.getAttribute("data-state")).toBe("done");
    // The sheet now offers to send it again, in those words.
    fireEvent.click(screen.getByRole("button", { name: "Put the form away" }));
    expect(within(sheet).getByRole("button", { name: "Send it again" })).toBeTruthy();

    // Another layout on the same page has gone nowhere.
    act(() => { useEditorStore.setState({ configId: "layout-b" }); });
    act(() => { useCockpitStore.getState().setPlannedGuestCount(30); });
    expect(primaryKey().getAttribute("data-move")).toBe("send");
  });

  // The form leaves the page with the keyboard in it. Put away, the keyboard is the sheet's own key's again, so the
  // next Escape shuts the sheet and the reader is not sent back to the top of the page.
  it("takes the keyboard back to its own key when the form is put away, and takes it from no control that has it", async () => {
    const first = pendingSave();
    const sheet = openSend();
    fireEvent.click(within(sheet).getByRole("button", { name: "Continue" }));
    await first.settle(true);
    const away = screen.getByRole("button", { name: "Put the form away" });
    act(() => { away.focus(); });
    expect(document.activeElement).toBe(away);
    fireEvent.click(away);
    expect(screen.queryByTestId("enquiry-form")).toBeNull();
    expect(document.activeElement).toBe(within(sheet).getByRole("button", { name: "Continue" }));

    // Where the keyboard is already on a control of the page, it stays there.
    const second = pendingSave();
    fireEvent.click(within(sheet).getByRole("button", { name: "Continue" }));
    await second.settle(true);
    const closeKey = within(sheet).getByRole("button", { name: "Close" });
    act(() => { closeKey.focus(); });
    fireEvent.click(screen.getByRole("button", { name: "Put the form away" }));
    expect(screen.queryByTestId("enquiry-form")).toBeNull();
    expect(document.activeElement).toBe(closeKey);
  });

  it("says in the sheet's own words why it cannot send during a preview, and keeps the key's label", () => {
    act(() => { useLayoutTimelinePreviewStore.getState().showPending("Reading the day"); });
    const sheet = openSend();
    const key = within(sheet).getByRole("button", { name: "Continue" });
    expect((key as HTMLButtonElement).disabled).toBe(true);
    // Not at work: it is simply off, and the reason is a line of the sheet, tied to the key for a screen reader.
    expect(key.getAttribute("aria-busy")).toBe("false");
    const reason = document.getElementById(key.getAttribute("aria-describedby") ?? "");
    expect(reason?.textContent).toBe("Leave the preview to send.");
    expect(reason?.classList.contains("hud-sheet__say")).toBe(true);
    expect(sheet.contains(reason)).toBe(true);
    fireEvent.click(key);
    expect(mocks.prepare).not.toHaveBeenCalled();

    // Out of the preview the line goes and the key is on.
    act(() => { useLayoutTimelinePreviewStore.getState().clear(); });
    expect(sheet.querySelector(".hud-sheet__say")).toBeNull();
    expect(within(sheet).getByRole<HTMLButtonElement>("button", { name: "Continue" }).disabled).toBe(false);
  });
});

// The screen fades a key that is off (--hud-off, 0.36). A key that is off because it is AT WORK carries the working
// state's words and motion, and faded they fell to about 2:1 on the ground. The stylesheet is read as text: a test's
// page lays nothing out and computes no cascade.
describe("the stylesheet's word on a key at work", () => {
  it("keeps a busy primary key at full strength, by a rule that outranks the one that fades keys that are off", async () => {
    const css = (await readFile(resolve("src/components/planner-hud/hud.css"), "utf-8")).replace(/\/\*[\s\S]*?\*\//g, "");
    const fades = /\.hud-root :is\(button, input\):disabled,\s*\.hud-root \[aria-disabled="true"\]\s*\{[^}]*opacity:\s*var\(--hud-off\)/.exec(css);
    const busy = /\.hud-root \.hud-act\[aria-busy="true"\]:disabled\s*\{\s*opacity:\s*1;\s*\}/.exec(css);
    expect(fades, "the rule that fades keys that are off").not.toBeNull();
    expect(busy, "the rule that keeps a busy key at full strength").not.toBeNull();
    // Later in the sheet and more specific (a class and an attribute more), so it wins on both counts.
    expect(busy?.index ?? 0).toBeGreaterThan(fades?.index ?? Number.POSITIVE_INFINITY);
  });
});
