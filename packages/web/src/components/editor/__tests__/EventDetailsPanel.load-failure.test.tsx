import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { emptyEventInstructions } from "@omnitwin/types";
import { EventDetailsPanel } from "../EventDetailsPanel.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { useActionLogStore } from "../../../stores/action-log-store.js";
import { useAuthStore } from "../../../stores/auth-store.js";

// A failed load used to open a blank form with Save enabled. The PATCH
// replaces the whole instructions blob, so one Save then erased the stored
// diets, day-of contact and door times the load never reached. A layout whose
// details could not be read now shows no form and cannot save until a load
// succeeds.

const { getConfigMock, patchMock } = vi.hoisted(() => ({
  getConfigMock: vi.fn(),
  patchMock: vi.fn(() => Promise.resolve({})),
}));

vi.mock("../../../api/configurations.js", () => ({
  getConfig: getConfigMock,
  patchConfigMetadata: patchMock,
}));

const stored = {
  metadata: {
    instructions: {
      ...emptyEventInstructions(),
      specialInstructions: "Two guests need the lift. Nut allergy at table 4.",
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().setUser(null);
  useEditorStore.setState({ configId: "cfg-evt", isPublicPreview: false });
  useActionLogStore.getState().reset();
  useActionLogStore.getState().beginLog("cfg-evt");
});

afterEach(cleanup);

describe("event details after a failed load", () => {
  it("shows no form and cannot save, so a failed load never overwrites stored details", async () => {
    getConfigMock.mockRejectedValueOnce(new Error("Network request failed"));
    render(<EventDetailsPanel open onClose={() => undefined} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("couldn't be loaded");
    expect(alert.textContent).toContain("Nothing here can overwrite them");
    expect(screen.queryByRole("textbox")).toBeNull();

    const save = screen.getByRole("button", { name: "Save" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(save);
    expect(patchMock).not.toHaveBeenCalled();
  });

  it("loads the stored details when Try again succeeds", async () => {
    getConfigMock.mockRejectedValueOnce(new Error("Network request failed"));
    getConfigMock.mockResolvedValueOnce(stored);
    render(<EventDetailsPanel open onClose={() => undefined} />);

    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

    await screen.findByDisplayValue("Two guests need the lift. Nut allergy at table 4.");
    expect(getConfigMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/couldn't be loaded/)).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", false);
  });

  it("keeps Try again where the focus is, busy, while the retry runs", async () => {
    let rejectRetry: ((reason: Error) => void) | undefined;
    getConfigMock.mockRejectedValueOnce(new Error("Network request failed"));
    getConfigMock.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRetry = reject; }));
    render(<EventDetailsPanel open onClose={() => undefined} />);

    const retry = await screen.findByRole("button", { name: "Try again" });
    retry.focus();
    fireEvent.click(retry);

    const busy = await screen.findByRole("button", { name: "Trying again…" });
    expect(busy).toBe(retry);
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(busy.querySelector("[data-activity-indicator]")).not.toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("couldn't be loaded");

    if (rejectRetry === undefined) throw new Error("retry was never started");
    rejectRetry(new Error("Still offline"));
    const again = await screen.findByRole("button", { name: "Try again" });
    expect(again).toBe(retry);
    expect(screen.getByRole("alert").textContent).toContain("Still offline");
  });

  it("stays unable to save when Try again fails too", async () => {
    getConfigMock.mockRejectedValue(new Error("Network request failed"));
    render(<EventDetailsPanel open onClose={() => undefined} />);

    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => { expect(getConfigMock).toHaveBeenCalledTimes(2); });
    await screen.findByRole("button", { name: "Try again" });

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
    expect(patchMock).not.toHaveBeenCalled();
  });
});
