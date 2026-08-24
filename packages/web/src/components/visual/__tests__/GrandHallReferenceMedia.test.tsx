import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import {
  GrandHallReferenceMedia,
  type GrandHallReferenceMember,
} from "../GrandHallReferenceMedia.js";

function member(
  memberId: string,
  mediaType: string,
  role: string,
  classification?: string,
): GrandHallReferenceMember {
  return {
    memberId,
    url: `http://127.0.0.1:55982/api/local-room-evidence-candidate/members/${memberId}.${mediaType.startsWith("video/") ? "mov" : "jpg"}?token=${"t".repeat(43)}`,
    sha256: `sha256:${memberId.charCodeAt(0).toString(16).padStart(2, "0").repeat(32)}`,
    sizeBytes: mediaType.startsWith("video/") ? 75_597_063 : 530_489,
    role,
    mediaType,
    provenance: "exact_test_provenance",
    ...(classification === undefined ? {} : { classification }),
  };
}

const captured = [
  member("reference-room", "image/jpeg", "captured_reference_image", "captured_reference_image"),
  member("reference-floorplan", "image/jpeg", "reference_floorplan_image", "reference_floorplan_image"),
];
const unclassified = [
  member("operator-reference", "image/jpeg", "operator_supplied_reference_image", "capture_lineage_unverified"),
];
const generated = [
  member("operator-generated", "image/png", "generated_reference_image", "generated_reference_image"),
];
const videoMember = member(
  "edited-reference-video",
  "video/quicktime",
  "edited_reference_video",
  "capture_or_generation_lineage_unverified",
);

function view(): ReactElement {
  return (
    <GrandHallReferenceMedia
      capturedImages={captured}
      unclassifiedImages={unclassified}
      generatedImages={generated}
      video={{
        member: videoMember,
        provenanceClass: "edited_reference_video",
        lineage: "capture_or_generation_lineage_unverified",
        playback: "manual_only",
        preload: "metadata",
      }}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("GrandHallReferenceMedia", () => {
  it("loads only the selected captured member and keeps generated media off by default", () => {
    render(view());

    expect(document.querySelectorAll("img")).toHaveLength(1);
    expect(document.querySelectorAll("video")).toHaveLength(0);
    expect(screen.getByRole("button", { name: /generated concept/i }).getAttribute("aria-pressed"))
      .toBe("false");
    expect(screen.queryByText("GENERATED · CONCEPT ONLY")).toBeNull();
    expect((document.querySelector("img") as HTMLImageElement).crossOrigin).toBe("anonymous");

    fireEvent.load(document.querySelector("img") as HTMLImageElement);
    expect(screen.queryByText(/Loading selected evidence member/)).toBeNull();
  });

  it("keeps the generated badge persistent after selecting the C2PA-labelled derivative", () => {
    render(view());

    fireEvent.click(screen.getByRole("button", { name: /generated concept/i }));

    expect(document.querySelectorAll("img")).toHaveLength(1);
    expect(screen.getByText("GENERATED · CONCEPT ONLY")).toBeTruthy();
    expect(screen.getByText(/Embedded C2PA claim inspected; not cryptographically validated/i))
      .toBeTruthy();
    expect(screen.getByText(/no measurement, placement, collision, capacity, or export input/i))
      .toBeTruthy();
  });

  it("does not claim the MOV is playable until the browser can decode it", () => {
    render(view());

    fireEvent.click(screen.getByRole("button", { name: /edited reference video/i }));
    const video = document.querySelector("video") as HTMLVideoElement;
    expect(video.autoplay).toBe(false);
    expect(video.preload).toBe("metadata");
    expect(video.crossOrigin).toBe("anonymous");
    expect(screen.getByText(/Loading selected evidence member/)).toBeTruthy();

    fireEvent.loadedMetadata(video);
    expect(screen.getByText(/Metadata loaded · waiting for real browser decode/)).toBeTruthy();
    fireEvent.error(video);
    expect(screen.getByRole("alert").textContent).toContain("Browser derivative required");
    expect(screen.getByRole("alert").textContent).toContain("no playable claim is made");
  });

  it("does not make a captured-media claim for the lineage-unverified operator image", () => {
    render(view());

    fireEvent.click(screen.getByRole("button", { name: /operator reference/i }));

    expect(screen.getByText(/Operator-supplied reference image · capture lineage unverified/i))
      .toBeTruthy();
    expect(document.body.textContent).not.toContain("captured-reference claim");
  });

  it("ignores a late decode event from a media member that was switched away", () => {
    render(view());
    const oldImage = document.querySelector("img") as HTMLImageElement;

    fireEvent.click(screen.getByRole("button", { name: /edited reference video/i }));
    fireEvent.load(oldImage);

    expect(screen.getByText(/Loading selected evidence member/)).toBeTruthy();
    expect(document.querySelectorAll("video")).toHaveLength(1);
  });
});
