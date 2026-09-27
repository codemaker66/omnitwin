import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { HallkeeperStatusBanner } from "../HallkeeperStatusBanner.js";
import { getAvailableTransitions, getLatestSnapshot, type SnapshotEnvelope } from "../../../api/configuration-reviews.js";

// ---------------------------------------------------------------------------
// The approval time is the venue's (roadmap N4): a sheet approved at noon in
// Glasgow reads 12:00 on any phone, in British 24-hour time.
// ---------------------------------------------------------------------------

vi.mock("../../../api/configuration-reviews.js", () => ({
  getAvailableTransitions: vi.fn(),
  getLatestSnapshot: vi.fn(),
}));

const CONFIG = "00000000-0000-4000-8000-000000000001";
const SNAPSHOT: SnapshotEnvelope = {
  id: "00000000-0000-4000-8000-000000000101", configurationId: CONFIG, version: 3, payload: {},
  diagramUrl: null, pdfUrl: null, sourceHash: "a".repeat(64), createdAt: "2026-09-19T10:30:00.000Z", createdBy: null,
  // Saturday 19 September 2026, 12:00 in Glasgow (BST).
  approvedAt: "2026-09-19T11:00:00.000Z", approvedBy: null,
};

afterEach(cleanup);

describe("HallkeeperStatusBanner", () => {
  it("gives the approval time on the venue's clock, in British 24-hour time", async () => {
    vi.mocked(getAvailableTransitions).mockResolvedValue({ currentStatus: "approved", availableTransitions: [], internalDemoReviewEligible: false });
    vi.mocked(getLatestSnapshot).mockResolvedValue(SNAPSHOT);
    render(<HallkeeperStatusBanner configId={CONFIG} timeZone="Europe/London" />);
    expect((await screen.findByRole("status")).textContent).toMatch(/Sheet · v3 · approved Sat 19 Sept?, 12:00$/u);
  });
});
