import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { EvidenceLensPanel } from "../EvidenceLensPanel.js";
import { useEditorStore } from "../../../../stores/editor-store.js";
import type { AuditLogEntry } from "../../../../api/action-log.js";

// G4 Slice 4: the Change-history section in the Evidence lens, reading the
// REAL audit trail (slice 3's read endpoint) through useChangeHistory.
// Claim-safe rendering is pinned at the model layer; this suite pins the
// data states: populated, empty, error, sign-in-required, and the
// truncation note when the trail exceeds the fetch cap.

const { getActionLogMock } = vi.hoisted(() => ({
  getActionLogMock: vi.fn(
    (_configId: string, _after?: number, _limit?: number) =>
      Promise.resolve({ entries: [] as AuditLogEntry[], nextAfter: 0 }),
  ),
}));
vi.mock("../../../../api/action-log.js", () => ({
  getActionLog: getActionLogMock,
}));

function entry(ordinal: number, overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    ordinal,
    id: `00000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`,
    batchId: "0d4d0b6e-3a63-4a5d-9c1e-2f6b8a7c5d4e",
    revision: 3,
    submittedBy: "00000000-0000-4000-8000-000000000099",
    actor: { kind: "operator" },
    intent: "object.place",
    payload: { label: "Place Round table" },
    inverse: { removed: [] },
    provenance: { surface: "planner" },
    recordedTs: "2026-07-18T10:15:00.000Z",
    receivedAt: "2026-07-18T10:15:01.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.setState({ configId: "cfg-history-test", isPublicPreview: false });
});

afterEach(cleanup);

describe("Evidence lens · Change history", () => {
  it("renders the recorded trail newest-first from real data", async () => {
    getActionLogMock.mockResolvedValueOnce({
      entries: [
        entry(1, { payload: { label: "Place Round table" } }),
        entry(2, { intent: "object.update", payload: { label: "Move 3 items" } }),
      ],
      nextAfter: 2,
    });

    render(<EvidenceLensPanel />);

    const section = await screen.findByTestId("evidence-change-history");
    expect(section.textContent).toContain("Change history");
    const rows = await screen.findAllByTestId("change-history-row");
    expect(rows[0]?.textContent).toContain("Move 3 items");
    expect(rows[1]?.textContent).toContain("Place Round table");
    expect(section.textContent).toContain("as recorded by the planner's device");
  });

  it("shows an honest empty state when nothing has been recorded", async () => {
    render(<EvidenceLensPanel />);
    await waitFor(() => {
      expect(screen.getByTestId("evidence-change-history").textContent).toContain("No changes recorded yet");
    });
  });

  it("shows a quiet failure note when the trail cannot be loaded — never a crash", async () => {
    getActionLogMock.mockRejectedValueOnce(new Error("network down"));
    render(<EvidenceLensPanel />);
    await waitFor(() => {
      expect(screen.getByTestId("evidence-change-history").textContent).toContain("Couldn't load the change history");
    });
  });

  it("asks for sign-in on public previews instead of firing unauthenticated requests", () => {
    useEditorStore.setState({ isPublicPreview: true });
    render(<EvidenceLensPanel />);
    expect(screen.getByTestId("evidence-change-history").textContent).toContain("Sign in");
    expect(getActionLogMock).not.toHaveBeenCalled();
  });

  it("notes truncation when the trail exceeds the fetch cap and offers to load earlier pages", async () => {
    // First page full (limit-sized) with an advancing cursor → more exists.
    const fullPage = Array.from({ length: 100 }, (_, i) => entry(i + 1));
    getActionLogMock
      .mockResolvedValueOnce({ entries: fullPage, nextAfter: 100 })
      .mockResolvedValueOnce({ entries: [entry(101, { payload: { label: "Late arrival" } })], nextAfter: 101 });

    render(<EvidenceLensPanel />);
    const more = await screen.findByRole("button", { name: /Load more/ });
    fireEvent.click(more);
    await waitFor(() => {
      expect(getActionLogMock).toHaveBeenCalledTimes(2);
    });
    expect((await screen.findAllByTestId("change-history-row")).length).toBeGreaterThan(100);
  });
});
