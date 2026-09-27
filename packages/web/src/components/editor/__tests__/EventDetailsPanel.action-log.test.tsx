import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { emptyEventInstructions } from "@omnitwin/types";
import { EventDetailsPanel } from "../EventDetailsPanel.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { useActionLogStore } from "../../../stores/action-log-store.js";
import { useAuthStore } from "../../../stores/auth-store.js";

// G4 Slice 2: saving event details logs event.details.update whose inverse
// is the blob the server held BEFORE the save — hydrated at panel-open and
// advanced after each successful save, so chained saves chain their
// inverses. A save that changes nothing still PATCHes (behaviour is
// untouched) but stays out of the log.

const { getConfigMock, patchMock } = vi.hoisted(() => ({
  getConfigMock: vi.fn(),
  patchMock: vi.fn(() => Promise.resolve({})),
}));

vi.mock("../../../api/configurations.js", () => ({
  getConfig: getConfigMock,
  patchConfigMetadata: patchMock,
}));

function loggedIntents(): readonly string[] {
  return useActionLogStore.getState().entries.map((entry) => entry.intent);
}

beforeEach(() => {
  vi.clearAllMocks();
  getConfigMock.mockResolvedValue({
    metadata: {
      instructions: { ...emptyEventInstructions(), specialInstructions: "Old text" },
    },
  });
  useAuthStore.getState().setUser(null);
  useEditorStore.setState({ configId: "cfg-evt", isPublicPreview: false });
  useActionLogStore.getState().reset();
  useActionLogStore.getState().beginLog("cfg-evt");
});

afterEach(cleanup);

async function openPanelAndAwaitHydration(): Promise<HTMLElement> {
  render(<EventDetailsPanel open onClose={() => undefined} />);
  return await screen.findByDisplayValue("Old text");
}

describe("event details save actions", () => {
  it("a changed save logs event.details.update with the pre-save blob as inverse; chained saves chain inverses", async () => {
    const textarea = await openPanelAndAwaitHydration();

    fireEvent.change(textarea, { target: { value: "New text" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => { expect(patchMock).toHaveBeenCalledTimes(1); });

    await waitFor(() => { expect(loggedIntents()).toEqual(["event.details.update"]); });
    const first = useActionLogStore.getState().entries[0];
    if (first === undefined) throw new Error("expected a logged action");
    expect(first.provenance).toEqual({ surface: "planner", tool: "event-details" });
    const payload = first.payload as { instructions: { specialInstructions: string } };
    const inverse = first.inverse as { instructions: { specialInstructions: string } };
    expect(payload.instructions.specialInstructions).toBe("New text");
    expect(inverse.instructions.specialInstructions).toBe("Old text");

    // Second edit + save: the inverse must be the FIRST save's blob, not the
    // original hydration — the panel's notion of server truth advances.
    fireEvent.change(screen.getByDisplayValue("New text"), { target: { value: "Third text" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => { expect(patchMock).toHaveBeenCalledTimes(2); });

    await waitFor(() => {
      expect(loggedIntents()).toEqual(["event.details.update", "event.details.update"]);
    });
    const second = useActionLogStore.getState().entries[1];
    const secondInverse = second?.inverse as { instructions: { specialInstructions: string } };
    expect(secondInverse.instructions.specialInstructions).toBe("New text");
  });

  it("a save that changes nothing still PATCHes but stays out of the log", async () => {
    await openPanelAndAwaitHydration();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => { expect(patchMock).toHaveBeenCalledTimes(1); });

    expect(loggedIntents()).toEqual([]);
  });

  it("a save that resolves after a config switch logs nothing into the new config's log (reviewer CRITICAL)", async () => {
    // The panel survives client-side /plan/A → /plan/B navigation (same
    // route element, no remount). A PATCH for A resolving late must not
    // fabricate a record in B's freshly-opened log — its inverse would be
    // built from B's hydration and belong to no real state of either
    // config.
    let releasePatch: (() => void) | undefined;
    patchMock.mockImplementationOnce(
      () => new Promise<object>((resolve) => { releasePatch = () => { resolve({}); }; }),
    );
    const textarea = await openPanelAndAwaitHydration();

    fireEvent.change(textarea, { target: { value: "New text" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => { expect(patchMock).toHaveBeenCalledTimes(1); });

    // The config boundary while the PATCH is in flight (what
    // loadConfiguration does: store configId advances, log switches scope).
    useEditorStore.setState({ configId: "cfg-other" });
    useActionLogStore.getState().beginLog("cfg-other");

    if (releasePatch === undefined) throw new Error("patch was never started");
    releasePatch();
    await waitFor(() => { expect(screen.getByText(/Saved at/)).toBeTruthy(); });

    expect(loggedIntents()).toEqual([]); // B's log carries no fabricated A-record
  });

  it("a failed save logs nothing", async () => {
    patchMock.mockRejectedValueOnce(new Error("server down"));
    const textarea = await openPanelAndAwaitHydration();

    fireEvent.change(textarea, { target: { value: "New text" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => { expect(patchMock).toHaveBeenCalledTimes(1); });
    await screen.findByRole("alert");

    expect(loggedIntents()).toEqual([]);
  });
});

// T-635 N5, item 9: a click beside the sheet closed it and threw away edits
// that had not been saved.
describe("event details keep unsaved edits", () => {
  it("stays open when the space beside it is clicked with unsaved edits, and says so", async () => {
    const onClose = vi.fn();
    render(<EventDetailsPanel open onClose={onClose} />);
    const textarea = await screen.findByDisplayValue("Old text");
    expect(screen.getByText("No unsaved changes")).toBeTruthy();

    fireEvent.change(textarea, { target: { value: "New text" } });
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    fireEvent.click(screen.getByRole("dialog", { name: "Event details" }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => { expect(screen.queryByText("Unsaved changes")).toBeNull(); });
    expect(screen.getByText(/^Saved at /u)).toBeTruthy();
    fireEvent.click(screen.getByRole("dialog", { name: "Event details" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("still closes on the Close button with unsaved edits", async () => {
    const onClose = vi.fn();
    render(<EventDetailsPanel open onClose={onClose} />);
    fireEvent.change(await screen.findByDisplayValue("Old text"), { target: { value: "New text" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0] ?? document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
