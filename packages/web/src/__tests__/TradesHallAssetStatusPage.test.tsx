import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { RoomAssetStatus } from "@omnitwin/types";

const { getAdminAssetRoomsMock } = vi.hoisted(() => ({
  getAdminAssetRoomsMock: vi.fn(),
}));

vi.mock("../api/asset-status.js", () => ({
  getAdminAssetRooms: getAdminAssetRoomsMock,
}));

import { TradesHallAssetStatusPage } from "../pages/TradesHallAssetStatusPage.js";

const FORBIDDEN_PUBLIC_CLAIMS = [
  "fire approved",
  "certified safe",
  "legally compliant",
  "survey-grade",
  "approved for occupancy",
  "guaranteed accessible",
  "black label",
  "production ready",
  "photoreal digital twin",
] as const;

beforeEach(() => {
  getAdminAssetRoomsMock.mockResolvedValue([
    roomStatus({
      roomSlug: "lady-convenors-room",
      displayName: "Lady Convenor's Room",
      roomGroup: "support-room",
      defaultStatus: "needs_registration",
      captureStatus: "splat_exists_outside_repo_needs_registration",
      currentState: "splat_done_outside_repo",
      splatStatus: "splat exists outside repo / needs registration",
      safeCopy: "splat exists outside repo / needs registration",
      nextAction: "Register external splat asset and runtime package",
    }),
    roomStatus({
      roomSlug: "grand-hall",
      displayName: "Grand Hall",
      roomGroup: "principal-room",
      defaultStatus: "needs_processing",
      captureStatus: "captured_needs_processing",
      currentState: "captured_needs_processing",
      splatStatus: "captured / needs processing",
      safeCopy: "captured / needs processing",
      nextAction: "Process captured room into a runtime splat",
    }),
  ]);
});

afterEach(() => {
  cleanup();
  getAdminAssetRoomsMock.mockReset();
});

function roomStatus(overrides: Partial<RoomAssetStatus>): RoomAssetStatus {
  return {
    venueSlug: "trades-hall",
    roomSlug: "north-gallery",
    displayName: "North Gallery",
    roomGroup: "gallery",
    defaultStatus: "needs_registration",
    captureStatus: "splat_exists_outside_repo_needs_registration",
    registryRuntimeStatus: "not_registered",
    publicShowcaseEnabled: false,
    internalVisualEnabled: true,
    primaryCaptureSource: "xgrids",
    currentState: "splat_done_outside_repo",
    splatStatus: "splat exists outside repo / needs registration",
    splatExists: false,
    runtimePackageStatus: "no runtime package registered",
    runtimePackageExists: false,
    evidenceStatus: null,
    runtimeStatus: null,
    nextAction: "Register external splat asset and runtime package",
    safeCopy: "splat exists outside repo / needs registration",
    ...overrides,
  };
}

function mount(): void {
  render(
    <MemoryRouter>
      <TradesHallAssetStatusPage />
    </MemoryRouter>,
  );
}

describe("TradesHallAssetStatusPage", () => {
  it("renders room registry status from the admin asset API", async () => {
    mount();

    expect(screen.getByText(/Loading room runtime status/i)).toBeTruthy();
    await waitFor(() => {
      expect(getAdminAssetRoomsMock).toHaveBeenCalledWith("trades-hall");
      expect(screen.getByText("Lady Convenor's Room")).toBeTruthy();
    });

    expect(screen.getByText("Grand Hall")).toBeTruthy();
    expect(screen.getAllByText("splat exists outside repo / needs registration").length).toBeGreaterThan(0);
    expect(screen.getAllByText("captured / needs processing").length).toBeGreaterThan(0);
    expect(screen.getByText(/Human review required before operational reliance/i)).toBeTruthy();

    const firstRoomLink = screen.getAllByRole("link", { name: /Open room view/i })[0];
    expect(firstRoomLink?.getAttribute("href")).toBe(
      "/dev/trades-hall-visual?venue=trades-hall&room=lady-convenors-room",
    );
  });

  it("keeps asset status copy within safe planning language", async () => {
    mount();

    await screen.findByText("Lady Convenor's Room");
    const bodyText = document.body.textContent?.toLowerCase() ?? "";
    for (const claim of FORBIDDEN_PUBLIC_CLAIMS) {
      expect(bodyText).not.toContain(claim);
    }
  });

  it("shows an operator-readable error state", async () => {
    getAdminAssetRoomsMock.mockRejectedValueOnce(new Error("registry unavailable"));
    mount();

    expect((await screen.findByRole("alert")).textContent).toContain("Asset status unavailable.");
    expect(screen.getByText("registry unavailable")).toBeTruthy();
  });
});
