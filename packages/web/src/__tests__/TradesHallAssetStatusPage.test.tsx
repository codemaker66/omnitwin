import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
      reviewedTransformSafeCopy: "runtime package required before transform review",
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
      runtimePackageExists: true,
      reviewedTransformStatus: "registered",
      reviewedTransformArtifactCount: 1,
      latestTransformArtifactId: "grand-hall-transform-v0",
      reviewedTransformSafeCopy: "reviewed runtime transform artifact registered",
      reviewedQaStatus: "blocked_internal_only",
      latestQaRecordId: "grand-hall-runtime-qa-2026-06-16",
      qaSignedTransformArtifactId: "grand-hall-transform-v0",
      qaSignedTransformLinked: true,
      reviewedQaSafeCopy: "runtime QA recorded; public exposure blocked",
      captureControlStatus: "linked_to_transform",
      captureControlSourceCount: 1,
      latestCaptureControlSourceRecordId: "10000000-0000-4000-8000-000000000021",
      latestCaptureControlSourceId: "grand-hall-control-network-v0",
      latestCaptureControlSourceClass: "manual_landmarks",
      latestCaptureControlPoseAuthorityLevel: "manual_landmark_control",
      latestCaptureControlAlignmentMethods: ["landmark_solve"],
      latestCaptureControlStalenessTriggers: ["landmark_set_changed", "runtime_package_changed"],
      latestCaptureControlActiveStalenessTriggers: [],
      captureControlFreshnessStatus: "current_for_runtime_package",
      latestCaptureControlQaStatus: "requires_human_review",
      captureControlLinkedTransformArtifactId: "grand-hall-transform-v0",
      captureControlTransformLinked: true,
      captureControlAuthoritySafeCopy: "manual landmark control source recorded; reviewer confirmation required",
      captureControlStalenessSafeCopy: "capture-control source has 2 staleness triggers recorded",
      captureControlSafeCopy: "capture-control source linked to latest transform artifact",
    }),
    roomStatus({
      roomSlug: "reception-room",
      displayName: "Reception Room",
      roomGroup: "support-room",
      defaultStatus: "needs_registration",
      captureStatus: "processed_needs_registration",
      currentState: "processed_output_found",
      splatStatus: "registered splat asset",
      safeCopy: "runtime asset loaded, human review required",
      nextAction: "Open the internal runtime view",
      runtimePackageExists: true,
      captureControlStatus: "source_registered",
      captureControlSourceCount: 1,
      latestCaptureControlSourceRecordId: "10000000-0000-4000-8000-000000000022",
      latestCaptureControlSourceId: "reception-room-approximate-view-transform-v0",
      latestCaptureControlSourceClass: "artist_blender_alignment_refs",
      latestCaptureControlPoseAuthorityLevel: "visual_alignment_only",
      latestCaptureControlAlignmentMethods: ["visual_alignment"],
      latestCaptureControlStalenessTriggers: ["runtime_package_changed", "scene_authority_map_changed"],
      latestCaptureControlActiveStalenessTriggers: ["runtime_package_changed"],
      captureControlFreshnessStatus: "stale_for_runtime_package",
      latestCaptureControlQaStatus: "requires_human_review",
      captureControlAuthoritySafeCopy: "visual-only alignment source recorded; not measurement control",
      captureControlStalenessSafeCopy: "capture-control source has 2 staleness triggers recorded",
      captureControlSafeCopy: "capture-control source registered; stale evidence review required",
      runtimeControlEvidenceChainStatus: "blocked_missing_coordinate_pair_intake",
      runtimeControlEvidenceChainRef: "docs/operations/reception-room-runtime-control-evidence-chain-status-2026-06-16.json",
      runtimeControlRequiredCoordinatePairCount: 4,
      runtimeControlReviewedCoordinatePairCount: 0,
      runtimeControlEvidenceChainSafeCopy: "runtime-control chain blocked because reviewed coordinate-pair intake is missing",
      runtimeControlEvidenceChainNextAction: "Collect the four reviewed ARF to CVF landmark measurements",
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
    reviewedTransformStatus: "missing",
    reviewedTransformArtifactCount: 0,
    latestTransformArtifactId: null,
    reviewedTransformSafeCopy: "no reviewed runtime transform registered",
    reviewedQaStatus: "missing",
    latestQaRecordId: null,
    qaSignedTransformArtifactId: null,
    qaSignedTransformLinked: false,
    reviewedQaSafeCopy: "no runtime QA record registered",
    captureControlStatus: "missing",
    captureControlSourceCount: 0,
    latestCaptureControlSourceRecordId: null,
    latestCaptureControlSourceId: null,
    latestCaptureControlSourceClass: null,
    latestCaptureControlPoseAuthorityLevel: null,
    latestCaptureControlAlignmentMethods: [],
    latestCaptureControlStalenessTriggers: [],
    latestCaptureControlActiveStalenessTriggers: [],
    captureControlFreshnessStatus: "missing",
    latestCaptureControlQaStatus: null,
    captureControlLinkedTransformArtifactId: null,
    captureControlTransformLinked: false,
    captureControlAuthoritySafeCopy: "no capture-control authority recorded",
    captureControlStalenessSafeCopy: "no capture-control staleness policy recorded",
    captureControlSafeCopy: "no capture-control source registered",
    runtimeControlEvidenceChainStatus: "not_recorded",
    runtimeControlEvidenceChainRef: null,
    runtimeControlRequiredCoordinatePairCount: null,
    runtimeControlReviewedCoordinatePairCount: null,
    runtimeControlEvidenceChainSafeCopy: "runtime-control evidence chain not recorded for this room",
    runtimeControlEvidenceChainNextAction: "Create runtime-control source evidence before signed-transform review",
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
    expect(screen.getByText("runtime package required before transform review")).toBeTruthy();
    expect(screen.getByText("reviewed runtime transform artifact registered")).toBeTruthy();
    expect(screen.getByText("grand-hall-transform-v0")).toBeTruthy();
    expect(screen.getByText("blocked internal only")).toBeTruthy();
    expect(screen.getByText("runtime QA recorded; public exposure blocked")).toBeTruthy();
    expect(screen.getByText("QA grand-hall-runtime-qa-2026-06-16")).toBeTruthy();
    expect(screen.getAllByText("transform link current: grand-hall-transform-v0")).toHaveLength(2);
    expect(screen.getByText("linked to transform")).toBeTruthy();
    expect(screen.getByText("capture-control source linked to latest transform artifact")).toBeTruthy();
    expect(screen.getByText("manual landmark control source recorded; reviewer confirmation required")).toBeTruthy();
    expect(screen.getByText("current for runtime package")).toBeTruthy();
    expect(screen.getAllByText("capture-control source has 2 staleness triggers recorded").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Record 10000000-0000-4000-8000-000000000021")).toBeTruthy();
    expect(screen.getByText("Source grand-hall-control-network-v0")).toBeTruthy();
    expect(screen.getByText("Class manual landmarks")).toBeTruthy();
    expect(screen.getByText("Authority manual landmark control")).toBeTruthy();
    expect(screen.getByText("Methods landmark solve")).toBeTruthy();
    expect(screen.getByText("Stale when landmark set changed, runtime package changed")).toBeTruthy();
    expect(screen.getAllByText("QA requires human review").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Reception Room")).toBeTruthy();
    expect(screen.getByText("visual-only alignment source recorded; not measurement control")).toBeTruthy();
    expect(screen.getByText("stale for runtime package")).toBeTruthy();
    expect(screen.getByText("capture-control source registered; stale evidence review required")).toBeTruthy();
    expect(screen.getByText("Record 10000000-0000-4000-8000-000000000022")).toBeTruthy();
    expect(screen.getByText("Source reception-room-approximate-view-transform-v0")).toBeTruthy();
    expect(screen.getByText("Class artist blender alignment refs")).toBeTruthy();
    expect(screen.getByText("Authority visual alignment only")).toBeTruthy();
    expect(screen.getByText("Methods visual alignment")).toBeTruthy();
    expect(screen.getByText("Stale when runtime package changed, scene authority map changed")).toBeTruthy();
    expect(screen.getByText("Active stale trigger runtime package changed")).toBeTruthy();
    expect(screen.getByText("blocked missing coordinate pair intake")).toBeTruthy();
    expect(screen.getByText("runtime-control chain blocked because reviewed coordinate-pair intake is missing")).toBeTruthy();
    expect(screen.getByText("Coordinate pairs 0 / 4")).toBeTruthy();
    expect(screen.getByText("Evidence docs/operations/reception-room-runtime-control-evidence-chain-status-2026-06-16.json")).toBeTruthy();
    expect(screen.getByText("Collect the four reviewed ARF to CVF landmark measurements")).toBeTruthy();
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
    expect(screen.getByRole("button", { name: "Retry asset registry" })).toBeTruthy();
  });

  it("retries the asset registry after a transient failure", async () => {
    getAdminAssetRoomsMock.mockRejectedValueOnce(new Error("registry unavailable"));
    mount();

    fireEvent.click(await screen.findByRole("button", { name: "Retry asset registry" }));

    await waitFor(() => {
      expect(getAdminAssetRoomsMock).toHaveBeenCalledTimes(2);
      expect(screen.getByText("Lady Convenor's Room")).toBeTruthy();
    });
  });
});
