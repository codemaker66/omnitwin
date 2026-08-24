import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  GRAND_HALL_NAVIGATION_PROFILE,
  GRAND_HALL_NAVIGATION_PROFILE_PAYLOAD,
  GRAND_HALL_NAVIGATION_PROFILE_SHA256,
  clampGrandHallHumanPosition,
  grandHallStructuralProxyBoxes,
  isInsideGrandHallDiagnosticBounds,
} from "../grand-hall-navigation-profile.js";

describe("Grand Hall source-derived navigation profile", () => {
  it("pins the complete mixed-source diagnostic profile receipt", () => {
    const digest = createHash("sha256")
      .update(JSON.stringify(GRAND_HALL_NAVIGATION_PROFILE_PAYLOAD))
      .digest("hex");
    expect(GRAND_HALL_NAVIGATION_PROFILE_SHA256).toBe(`sha256:${digest}`);
  });

  it("pins human camera scale and source provenance without claiming reviewed floor geometry", () => {
    expect(GRAND_HALL_NAVIGATION_PROFILE.eyeHeightM).toBe(1.65);
    expect(GRAND_HALL_NAVIGATION_PROFILE.capsuleRadiusM).toBe(0.3);
    expect(GRAND_HALL_NAVIGATION_PROFILE.humanCamera).toMatchObject({
      fov: 60,
      near: 0.05,
    });
    expect(GRAND_HALL_NAVIGATION_PROFILE.source.poseCount).toBe(21_417);
    expect(GRAND_HALL_NAVIGATION_PROFILE.source.sha256).toBe(
      "sha256:7a020e5f1cc00029ce773d1f448804fa1b7f16355412b023320975122556418d",
    );
    expect(GRAND_HALL_NAVIGATION_PROFILE.floorCandidate.reviewStatus).toBe("unreviewed");
    expect(GRAND_HALL_NAVIGATION_PROFILE.inspectionCamera).toMatchObject({
      sourcePose: {
        index: 19_890,
        timestamp: "1780223098.347440958",
        translation: [-4.774913, -16.59914, -0.687065],
      },
      position: [-0.03426186932373998, 2.15606153541565, 8.015104841842623],
      target: [0.15796363067625974, 2.15606153541565, -0.19184415815737577],
      reviewStatus: "source_position_derived_inspection_only",
    });
    expect(GRAND_HALL_NAVIGATION_PROFILE.truthClass).toBe("RECONSTRUCTED");
  });

  it("clamps repeated movement to the captured pose envelope and fixes eye height", () => {
    let position: readonly [number, number, number] = [0, 99, 0];
    for (let index = 0; index < 1_000; index += 1) {
      position = clampGrandHallHumanPosition([
        position[0] + 10,
        position[1] - 10,
        position[2] - 10,
      ]);
    }

    expect(isInsideGrandHallDiagnosticBounds(position)).toBe(true);
    expect(position[1]).toBeCloseTo(
      GRAND_HALL_NAVIGATION_PROFILE.floorCandidate.worldY
        + GRAND_HALL_NAVIGATION_PROFILE.eyeHeightM,
      8,
    );
    expect(position[0]).toBeLessThanOrEqual(
      GRAND_HALL_NAVIGATION_PROFILE.navigationBounds.max[0]
        - GRAND_HALL_NAVIGATION_PROFILE.capsuleRadiusM,
    );
  });

  it("describes only source and pose envelopes for the structural debug view", () => {
    const boxes = grandHallStructuralProxyBoxes();

    expect(boxes.map((box) => box.id)).toEqual([
      "captured-fine-frontier-envelope",
      "captured-pose-centre-envelope",
    ]);
    expect(boxes.every((box) => box.claim === "source_extent_not_room_shell")).toBe(true);
  });
});
