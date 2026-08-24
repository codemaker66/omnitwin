import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GrandHallEvidenceDock,
  type GrandHallEvidenceSummary,
} from "../GrandHallEvidenceDock.js";

const summary: GrandHallEvidenceSummary = {
  candidateId: "grand-hall-owner-authorized-local-evidence-v1",
  candidateRevision: 1,
  candidateDigest: `sha256:${"a".repeat(64)}`,
  splatFiles: 19,
  selectedSplatTier: "desktop",
  selectedSplatMembers: 4,
  declaredSplats: 2_482_968,
  panoramaViewpoints: 49,
  capturedImages: 5,
  unclassifiedImages: 1,
  generatedImages: 1,
  editedReferenceVideos: 1,
  meshPlyFiles: 14,
  smallObjFiles: 1,
  btreeFiles: 14,
  poseCount: 2_894,
  historicalCubefaces: 300,
  excludedDerivativeReason: "Exact per-member identities were not supplied; each file exceeds the bounded browser-member policy.",
  rawXgridsBytes: 5_637_931_654,
  e57Bytes: 20_518_437_888,
  matterpakObjBytes: 38_381_816,
  technicalSlots: [
    { id: "registered_metric_room_mesh", state: "not_produced", reason: "Registration review pending." },
    { id: "e57_bounded_room_crop", state: "not_produced", reason: "Bounded derivative pending." },
    { id: "obj_normalized_room_glb", state: "not_produced", reason: "Units and transform pending." },
    { id: "movable_object_mask", state: "not_produced", reason: "Classification artifact pending." },
  ],
};

afterEach(cleanup);

describe("GrandHallEvidenceDock", () => {
  it("keeps rights, operational authority, and alignment as separate persistent boundaries", () => {
    render(
      <GrandHallEvidenceDock
        state={{ status: "ready", summary, retry: vi.fn() }}
        mode="spatial"
        onModeChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Use rights · owner authorized · licensing blocker none")).toBeTruthy();
    expect(screen.getByText("Operational scene authority · unregistered")).toBeTruthy();
    expect(screen.getByText("Alignment · source-frame only / sources not registered")).toBeTruthy();
    expect(document.body.textContent).not.toContain("Legal approval");
    expect(document.body.textContent).not.toContain("Authority none");
  });

  it("exposes the three mutually exclusive master modes without hiding evidence roles", () => {
    const onModeChange = vi.fn();
    render(
      <GrandHallEvidenceDock
        state={{ status: "ready", summary, retry: vi.fn() }}
        mode="spatial"
        onModeChange={onModeChange}
      />,
    );

    expect(screen.getByRole("button", { name: /Spatial capture/i }).getAttribute("aria-pressed"))
      .toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /Walk \+ mesh/i }));
    fireEvent.click(screen.getByRole("button", { name: /Reference media/i }));
    expect(onModeChange).toHaveBeenNthCalledWith(1, "twin");
    expect(onModeChange).toHaveBeenNthCalledWith(2, "reference");
  });

  it("accounts for every streamable and retained modality in the expanded ledger", () => {
    render(
      <GrandHallEvidenceDock
        state={{ status: "ready", summary, retry: vi.fn() }}
        mode="reference"
        onModeChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show evidence ledger" }));

    expect(screen.getByText("19 SOG")).toBeTruthy();
    expect(screen.getByText("49 viewpoints")).toBeTruthy();
    expect(screen.getByText("1 exact MOV")).toBeTruthy();
    expect(screen.getByText(/1 generated concept · embedded C2PA claim inspected, not cryptographically validated/i)).toBeTruthy();
    expect(screen.getByText(/20\.5 GB · stage\/inspection verified; large-member hash not recomputed/i)).toBeTruthy();
    expect(screen.getByText(/5\.6 GB · current sizes matched; audit hashes not recomputed/i)).toBeTruthy();
    expect(screen.getByText("14 PLY + 1 OBJ")).toBeTruthy();
    expect(screen.getByText(/Excluded · Exact per-member identities were not supplied/i)).toBeTruthy();
    expect(screen.getByText("2,894")).toBeTruthy();
    expect(screen.getByText(/Furniture, planner dimensions, placement, collision, capacity, and exports remain independent/i))
      .toBeTruthy();
  });

  it("does not assert owner authorization until the sealed profile is ready", () => {
    const { rerender } = render(
      <GrandHallEvidenceDock
        state={{ status: "loading" }}
        mode="spatial"
        onModeChange={vi.fn()}
      />,
    );

    expect(screen.queryByText(/owner authorized/i)).toBeNull();
    expect(screen.getByText(/verifying sealed owner attestation/i)).toBeTruthy();

    rerender(
      <GrandHallEvidenceDock
        state={{ status: "error", message: "Profile rejected.", retryable: false, retry: vi.fn() }}
        mode="spatial"
        onModeChange={vi.fn()}
      />,
    );
    expect(screen.queryByText(/owner authorized/i)).toBeNull();
    expect(screen.getByText(/not asserted while profile is unavailable/i)).toBeTruthy();
  });

  it("keeps actual spatial loading and sanitized member failures visible beside ready inventory", () => {
    const { rerender } = render(
      <GrandHallEvidenceDock
        state={{ status: "ready", summary, retry: vi.fn() }}
        mode="spatial"
        onModeChange={vi.fn()}
        spatialRuntime={{
          status: "loading",
          loadedMembers: 2,
          totalMembers: 4,
          browserReportedSplats: 1_292_445,
          message: null,
          retry: vi.fn(),
        }}
      />,
    );
    expect(screen.getByText("2/4 selected members")).toBeTruthy();
    expect(document.body.textContent).not.toContain("splats rendered");

    rerender(
      <GrandHallEvidenceDock
        state={{ status: "ready", summary, retry: vi.fn() }}
        mode="spatial"
        onModeChange={vi.fn()}
        spatialRuntime={{
          status: "error",
          loadedMembers: 2,
          totalMembers: 4,
          browserReportedSplats: null,
          message: "A selected SOG member could not be decoded.",
          retry: vi.fn(),
        }}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("Spatial capture render failed");
    expect(screen.getByRole("alert").textContent).toContain("could not be decoded");
    expect(screen.getByRole("button", { name: "Retry spatial evidence" })).toBeTruthy();
  });

  it("disables mode switches until the exact profile verifies and offers only safe retry errors", () => {
    const retry = vi.fn();
    const { rerender } = render(
      <GrandHallEvidenceDock
        state={{ status: "loading" }}
        mode="spatial"
        onModeChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /Spatial capture/i }).hasAttribute("disabled"))
      .toBe(true);

    rerender(
      <GrandHallEvidenceDock
        state={{ status: "error", message: "Exact profile mismatch.", retryable: true, retry }}
        mode="spatial"
        onModeChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("Exact profile mismatch.");
    fireEvent.click(screen.getByRole("button", { name: "Retry evidence profile" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
