import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DIETARY_NOTE_RETENTION, emptyEventInstructions } from "@omnitwin/types";
import { EventDetailsPanel } from "../EventDetailsPanel.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { useAuthStore } from "../../../stores/auth-store.js";

// The allergy note says, where it is written, what to put in it and what
// happens to it (fix-first item 18): the same period the privacy policy and
// the API's retention pass use.

const { getConfigMock } = vi.hoisted(() => ({ getConfigMock: vi.fn() }));
vi.mock("../../../api/configurations.js", () => ({
  getConfig: getConfigMock,
  patchConfigMetadata: vi.fn(() => Promise.resolve({})),
}));

beforeEach(() => {
  vi.clearAllMocks();
  getConfigMock.mockResolvedValue({ metadata: { instructions: { ...emptyEventInstructions(), specialInstructions: "Loaded" } } });
  useAuthStore.getState().setUser(null);
  useEditorStore.setState({ configId: "cfg-diet", isPublicPreview: false });
});
afterEach(cleanup);

describe("the allergy note", () => {
  it("is described by a line asking for allergens, not names, and saying when it is removed", async () => {
    render(<EventDetailsPanel open onClose={() => undefined} />);
    await screen.findByDisplayValue("Loaded");
    fireEvent.click(screen.getByRole("button", { name: /Add dietary counts/u }));

    const note = screen.getByPlaceholderText(/One guest: shellfish/u);
    const hintId = note.getAttribute("aria-describedby");
    expect(hintId).not.toBeNull();
    const hint = document.getElementById(hintId ?? "");
    expect(hint?.textContent).toContain("Allergens and numbers, not guests' names.");
    expect(hint?.textContent).toContain(`removed ${String(DIETARY_NOTE_RETENTION.daysAfterEvent)} days after the event`);
  });
});
