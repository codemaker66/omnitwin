import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureIntakeOperatorStatus } from "@omnitwin/types";
import { CaptureIntakePage } from "../pages/CaptureIntakePage.js";

// These pages now wear the app shell (DashboardLayout), which renders a Clerk
// sign-out and fetches the venue name for its topbar. In production every one
// of these routes is withClerk()-wrapped so both are real; here they are
// stubbed so each spec keeps testing its PAGE, not the chrome around it.
vi.mock("@clerk/react", () => ({
  useClerk: () => ({ signOut: vi.fn() }),
}));

vi.mock("../api/spaces.js", () => ({
  getVenue: vi.fn().mockResolvedValue({ id: "venue-1", name: "Trades Hall" }),
}));

vi.mock("../components/dashboard/NotificationCenter.js", () => ({
  NotificationCenter: () => null,
}));


const mocks = vi.hoisted(() => ({ getStatus: vi.fn() }));

vi.mock("../api/capture-intake.js", () => ({
  getCaptureIntakeOperatorStatus: mocks.getStatus,
}));

const status: CaptureIntakeOperatorStatus = {
  status: "staged",
  consistencyStatus: "consistent",
  qaStatus: "intake_verified",
  inspection: {
    schemaVersion: "venviewer.capture-intake.v1",
    planSha256: "a".repeat(64),
    inventoryFileCount: 9_364,
    inventoryBytes: 89_601_723_000,
    hashedFileCount: 156,
    plannedFileCount: 156,
    plannedBytes: 22_277_494_876,
    primaryCaptureFiles: 1,
    vendorControlFiles: 155,
    duplicateGroups: 0,
  },
  stageManifest: {
    schemaVersion: "venviewer.capture-stage.v1",
    planSha256: "a".repeat(64),
    fileCount: 156,
    totalBytes: 22_277_494_876,
  },
  caveats: [
    "SOURCE_BYTES_ARE_NOT_RUNTIME_READY",
    "NO_RECONSTRUCTION_QA",
    "NO_SPATIAL_ACCURACY_CERTIFICATION",
    "DERIVED_REFERENCES_EXCLUDED_FROM_TRUTH_INPUTS",
  ],
  roots: {
    sourceRoot: "F:\\E57",
    stagingRoot: "F:\\VenviewerCaptureStaging\\trades-hall-2026-07-10",
  },
};

describe("CaptureIntakePage", () => {
  beforeEach(() => { mocks.getStatus.mockReset(); });
  afterEach(cleanup);

  it("renders the verified ledger boundary without claiming runtime readiness", async () => {
    mocks.getStatus.mockResolvedValue(status);
    render(<MemoryRouter><CaptureIntakePage /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: /verified candidate source stage/i })).toBeTruthy();
    expect(screen.getByText("9364")).toBeTruthy();
    expect(screen.getByText("20.75 GiB")).toBeTruthy();
    expect(screen.getByText(/verified source bytes are not a loadable runtime twin/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /open runtime asset registry/i })).toBeTruthy();
  });

  it("shows a fail-closed configured-state result", async () => {
    mocks.getStatus.mockResolvedValue({
      status: "unavailable",
      consistencyStatus: "not_checkable",
      qaStatus: "blocked",
      inspection: null,
      stageManifest: null,
      caveats: ["INSPECTION_NOT_CONFIGURED"],
      roots: { sourceRoot: null, stagingRoot: null },
    } satisfies CaptureIntakeOperatorStatus);
    render(<MemoryRouter><CaptureIntakePage /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: /capture intake unavailable/i })).toBeTruthy();
    expect(screen.getByText(/no configured inspection ledger path/i)).toBeTruthy();
  });
});
