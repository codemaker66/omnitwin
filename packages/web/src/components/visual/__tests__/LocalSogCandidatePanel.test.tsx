import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LocalSogCandidatePanel,
  type LocalSogCandidatePanelState,
} from "../LocalSogCandidatePanel.js";

afterEach(cleanup);

function readyState(retry: () => void): LocalSogCandidatePanelState {
  const members = ["desktop-0", "desktop-1", "desktop-2", "desktop-3"].map((memberId, index) => ({
    memberId,
    relativePath: `lcc2-result/data/3dgs/member-${String(index)}.sog`,
    sha256: `sha256:${String(index + 1).repeat(64)}`,
  }));
  return {
    status: "ready",
    retry,
    candidate: {
      candidateId: "grand-hall-small-lcc2-8539a478-v1",
      candidateRevision: 1,
      candidateDigest: `sha256:${"a".repeat(64)}`,
      runtimeRegistration: "not_registered",
      labels: {
        title: "Grand Hall — captured visual candidate",
        source: "XGRIDS PortalCam · Grand Hall Small",
        status: "Owner-authorized Venviewer use · unreviewed visual only",
        caveat: "Appearance only; no placement, measurement, collision, operational export, or production activation authority. Publication rights are owner-authorized; this unregistered candidate remains technically QA-inactive.",
      },
      source: {
        manifestSha256: `sha256:${"b".repeat(64)}`,
        frontierReceiptSha256: `sha256:${"c".repeat(64)}`,
        inventory: {
          sog: { count: 19 },
          meshPly: { count: 14 },
          bvh: { count: 14 },
          obj: { count: 1 },
          poses: { count: 2_894 },
        },
      },
      rights: {
        evidenceState: "operator_supplied_unverified",
        licensedUse: "authorized_for_all_venviewer_product_purposes",
        publicationAndDistributionRights: "owner_authorized",
        licensingBlocker: false,
        runtimeActivation: "technically_inactive_pending_alignment_qa_and_promotion",
      },
      authority: {
        appearance: "local_unreviewed_candidate",
        geometry: "none",
        placement: "none",
        measurement: "none",
        collision: "none",
        export: "none",
      },
      availableEvidence: { operationalAuthority: "none" },
    },
    selection: {
      tier: {
        id: "desktop",
        memberCount: 4,
        splatCount: 2_482_968,
        sizeBytes: 44_988_345,
      },
      members,
    },
  };
}

describe("LocalSogCandidatePanel", () => {
  it("keeps the authority boundary and retained-evidence coverage visible", () => {
    render(<LocalSogCandidatePanel state={readyState(vi.fn())} />);

    expect(screen.getByText("Local candidate")).toBeTruthy();
    expect(screen.getByText("Use rights · owner authorized")).toBeTruthy();
    expect(screen.getByText("Appearance-only review")).toBeTruthy();
    expect(screen.getByText("Operational scene authority · unregistered")).toBeTruthy();
    expect(screen.queryByText("Coverage and provenance")).toBeNull();

    const showDetails = screen.getByRole("button", { name: "Show candidate details" });
    expect(showDetails.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(showDetails);
    expect(screen.getByText("2,482,968")).toBeTruthy();
    expect(screen.getByText("45.0 MB")).toBeTruthy();

    fireEvent.click(screen.getByText("Coverage and provenance"));
    expect(screen.getByText(/19 SOG .* 14 mesh PLY .* 14 BVH .* 1 OBJ .* 2,894 poses/)).toBeTruthy();
    expect(screen.getByText(/not rendered here and have no operational authority/i)).toBeTruthy();
    expect(screen.getByRole("list", { name: "Rendered SOG member identities" }).textContent)
      .toContain("desktop-0");
    expect(document.body.textContent).not.toContain("token=");

    fireEvent.click(screen.getByRole("button", { name: "Hide details" }));
    expect(screen.queryByText("Coverage and provenance")).toBeNull();
    expect(screen.getByText("Operational scene authority · unregistered")).toBeTruthy();
  });

  it("reports descriptor and stream failures without exposing a retry for invalid requests", () => {
    const retry = vi.fn();
    const { rerender } = render(
      <LocalSogCandidatePanel
        state={{ status: "error", retry, retryable: false, message: "Local candidates are disabled." }}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("Local candidates are disabled.");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();

    rerender(<LocalSogCandidatePanel state={readyState(retry)} streamError="Spark decoder failed." />);
    expect(screen.getByText(/SOG rendering failed: Spark decoder failed/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show candidate details" }));
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
