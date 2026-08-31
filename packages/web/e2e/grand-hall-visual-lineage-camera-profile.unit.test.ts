import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { GRAND_HALL_LINEAGE_CAMERA } from "../src/lib/grand-hall-visual-lineage.js";
import {
  GRAND_HALL_SHARED_CAMERA_PROFILE_EVIDENCE_PREFIX,
  GRAND_HALL_SHARED_CAMERA_PROFILE_RELATIVE_PATH,
  grandHallSharedCameraProfileEvidence,
  grandHallSharedCameraProfileMatchesActual,
  parseGrandHallSharedCameraProfile,
} from "./grand-hall-visual-lineage-camera-profile.js";

describe("Grand Hall shared native/browser camera profile", () => {
  it("binds the exact native-owned profile bytes to the browser camera contract", async () => {
    const bytes = await readFile(path.resolve(
      process.cwd(),
      "../..",
      GRAND_HALL_SHARED_CAMERA_PROFILE_RELATIVE_PATH,
    ));
    const binding = parseGrandHallSharedCameraProfile(bytes);
    expect(binding).toMatchObject({
      profileId: "source-pose-19890-interior-v1",
      threePosition: GRAND_HALL_LINEAGE_CAMERA.position,
      threeTarget: [0.15796363067625974, 2.15606153541565, -0.19184415815737577],
      width: 1_600,
      height: 900,
      devicePixelRatio: 1,
    });
    expect(binding.sha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(grandHallSharedCameraProfileMatchesActual(binding, {
      position: GRAND_HALL_LINEAGE_CAMERA.position,
      quaternion: GRAND_HALL_LINEAGE_CAMERA.quaternion,
      projectionMatrix: GRAND_HALL_LINEAGE_CAMERA.projectionMatrix,
      fov: GRAND_HALL_LINEAGE_CAMERA.fov,
      near: GRAND_HALL_LINEAGE_CAMERA.near,
      far: GRAND_HALL_LINEAGE_CAMERA.far,
    })).toBe(true);
    expect(grandHallSharedCameraProfileEvidence(binding).startsWith(
      GRAND_HALL_SHARED_CAMERA_PROFILE_EVIDENCE_PREFIX,
    )).toBe(true);
  });

  it("rejects a profile whose exact Three target drifts", async () => {
    const bytes = await readFile(path.resolve(
      process.cwd(),
      "../..",
      GRAND_HALL_SHARED_CAMERA_PROFILE_RELATIVE_PATH,
    ));
    const profile: unknown = JSON.parse(bytes.toString("utf8"));
    if (typeof profile !== "object" || profile === null || !("frames" in profile)) {
      throw new Error("Test profile shape is invalid.");
    }
    const changed = JSON.stringify(profile).replace(
      "-0.19184415815737577",
      "-0.29184415815737577",
    );
    expect(() => parseGrandHallSharedCameraProfile(Buffer.from(changed, "utf8"))).toThrow(
      /deviates/u,
    );
  });
});
