import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { emptyEventInstructions, type EventInstructions } from "@omnitwin/types";
import { EventDetailsPanel } from "../EventDetailsPanel.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { useActionLogStore } from "../../../stores/action-log-store.js";
import { useAuthStore } from "../../../stores/auth-store.js";

// T-648: Martyn's Law readiness in the event details panel. The PATCH
// replaces the whole instructions object, so the block must round-trip
// through every save, add nothing the operator did not enter, and vanish
// from the payload when removed or left empty.

const { getConfigMock, patchMock } = vi.hoisted(() => ({
  getConfigMock: vi.fn(),
  patchMock: vi.fn((_configId: string, _metadata: { instructions: EventInstructions }) => Promise.resolve({})),
}));

vi.mock("../../../api/configurations.js", () => ({
  getConfig: getConfigMock,
  patchConfigMetadata: patchMock,
}));

const SAVED_RECORD = {
  responsiblePerson: "The Trades House of Glasgow",
  dutyLead: { name: "Sarah Kerr", role: "Duty manager" },
  procedures: { evacuation: { briefed: true, note: "Evacuation plan v3" } },
  doorSupervision: { arranged: false },
};

function serverHolds(instructions: Record<string, unknown>): void {
  getConfigMock.mockResolvedValue({ metadata: { instructions: { ...emptyEventInstructions(), ...instructions } } });
}

/** The instructions object the last PATCH sent, as the API received it (JSON). */
function lastSentInstructions(): Record<string, unknown> {
  const call = patchMock.mock.calls.at(-1);
  if (call === undefined) throw new Error("expected a PATCH");
  return JSON.parse(JSON.stringify(call[1].instructions)) as Record<string, unknown>;
}

async function openPanel(): Promise<HTMLElement> {
  render(<EventDetailsPanel open onClose={() => undefined} />);
  await screen.findByDisplayValue("Old text");
  return screen.getByRole("dialog", { name: "Event details" });
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().setUser(null);
  useEditorStore.setState({ configId: "cfg-t648", isPublicPreview: false });
  useActionLogStore.getState().reset();
  useActionLogStore.getState().beginLog("cfg-t648");
});

afterEach(cleanup);

describe("Martyn's Law readiness in event details", () => {
  it("keeps a saved record through an unrelated edit and save", async () => {
    serverHolds({ specialInstructions: "Old text", protectedPremises: SAVED_RECORD });
    await openPanel();
    expect(screen.getByText("No unsaved changes")).toBeTruthy();
    expect(screen.getByDisplayValue("Sarah Kerr")).toBeTruthy();

    fireEvent.change(screen.getByDisplayValue("Old text"), { target: { value: "New text" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => { expect(patchMock).toHaveBeenCalledTimes(1); });

    const sent = lastSentInstructions();
    expect(sent["specialInstructions"]).toBe("New text");
    expect(sent["protectedPremises"]).toEqual(SAVED_RECORD);
  });

  it("starts every control unset and sends only what the operator chose", async () => {
    serverHolds({ specialInstructions: "Old text" });
    const dialog = await openPanel();
    fireEvent.click(within(dialog).getByRole("button", { name: "+ Add Martyn's Law readiness" }));

    const evacuation = within(dialog).getByRole("group", { name: "Evacuation" });
    expect(within(evacuation).getByRole<HTMLInputElement>("radio", { name: "Not checked" }).checked).toBe(true);
    const door = within(dialog).getByRole("group", { name: "Door supervision" });
    expect(within(door).getByRole<HTMLInputElement>("radio", { name: "Not set" }).checked).toBe(true);
    expect(within(dialog).getByLabelText<HTMLInputElement>("Team briefing time").value).toBe("");
    // An opened, untouched block is not an edit.
    expect(screen.getByText("No unsaved changes")).toBeTruthy();

    fireEvent.click(within(evacuation).getByRole("radio", { name: "Briefed" }));
    fireEvent.click(within(within(dialog).getByRole("group", { name: "Lockdown" })).getByRole("radio", { name: "Not briefed" }));
    fireEvent.change(within(dialog).getByLabelText("Lead on duty"), { target: { value: "  Sarah Kerr " } });
    fireEvent.change(within(dialog).getByLabelText("Team briefing time"), { target: { value: "2026-06-15T17:30" } });
    expect(screen.getByText("Unsaved changes")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => { expect(patchMock).toHaveBeenCalledTimes(1); });
    expect(lastSentInstructions()["protectedPremises"]).toEqual({
      dutyLead: { name: "Sarah Kerr" },
      procedures: { evacuation: { briefed: true }, lockdown: { briefed: false } },
      briefingAt: new Date("2026-06-15T17:30").toISOString(),
    });
  });

  it("returns a choice to unset and clears the briefing time without guessing one", async () => {
    serverHolds({ specialInstructions: "Old text", protectedPremises: { briefingAt: "2026-06-15T16:30:00.000Z", procedures: { invacuation: { briefed: true } } } });
    const dialog = await openPanel();
    const invacuation = within(dialog).getByRole("group", { name: "Invacuation" });
    fireEvent.click(within(invacuation).getByRole("radio", { name: "Not checked" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear time" }));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => { expect(patchMock).toHaveBeenCalledTimes(1); });
    expect("protectedPremises" in lastSentInstructions()).toBe(false);
  });

  it("writes no key for a block that was opened but left empty", async () => {
    serverHolds({ specialInstructions: "Old text" });
    const dialog = await openPanel();
    fireEvent.click(within(dialog).getByRole("button", { name: "+ Add Martyn's Law readiness" }));
    fireEvent.change(within(dialog).getByLabelText("Responsible person"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => { expect(patchMock).toHaveBeenCalledTimes(1); });
    expect("protectedPremises" in lastSentInstructions()).toBe(false);
  });

  it("removes a saved record when the block is removed", async () => {
    serverHolds({ specialInstructions: "Old text", protectedPremises: SAVED_RECORD });
    const dialog = await openPanel();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove Martyn's Law block" }));
    expect(within(dialog).getByRole("button", { name: "+ Add Martyn's Law readiness" })).toBeTruthy();
    expect(screen.getByText("Unsaved changes")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => { expect(patchMock).toHaveBeenCalledTimes(1); });
    const sent = lastSentInstructions();
    expect("protectedPremises" in sent).toBe(false);
    expect(sent["specialInstructions"]).toBe("Old text");
  });

  it("says plainly that it is not a legal assessment", async () => {
    serverHolds({ specialInstructions: "Old text" });
    const dialog = await openPanel();
    expect(within(dialog).getByText(/Not a legal assessment: the venue's responsible person decides what the Act requires\./u)).toBeTruthy();
    expect(dialog.textContent).not.toMatch(/\b(?:complian(?:t|ce)|certified|approved for|guarantee)\b/iu);
  });
});
