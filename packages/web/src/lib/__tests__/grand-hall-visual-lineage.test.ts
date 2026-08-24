import { describe, expect, it } from "vitest";
import { VisualLineageBenchmarkV0Schema } from "@omnitwin/types";
import {
  GRAND_HALL_LINEAGE_CAMERA,
  GRAND_HALL_LINEAGE_CAMERA_SOURCE,
  GRAND_HALL_LINEAGE_INITIAL_BENCHMARK,
  GRAND_HALL_LINEAGE_TARGET,
  grandHallLineageFixturePath,
} from "../grand-hall-visual-lineage.js";

describe("Grand Hall fixed-camera lineage configuration", () => {
  it("pins the camera, viewport, and renderer variables", () => {
    expect(GRAND_HALL_LINEAGE_CAMERA).toMatchObject({
      id: "source-pose-19890-interior-v1",
      revision: 1,
      position: [-0.03426186932373998, 2.15606153541565, 8.015104841842623],
      quaternion: [0, -0.01170873415725777, 0, 0.999931450422695],
      fov: 60,
      near: 0.05,
      far: 80,
    });
    expect(GRAND_HALL_LINEAGE_CAMERA_SOURCE).toEqual({
      poseIndex: 19_890,
      timestamp: "1780223098.347440958",
      translation: [-4.774913, -16.59914, -0.687065],
      rotation: [-0.048216, 0.041399, -0.623453, 0.779274],
      targetDerivation: "pose_q05_q95_horizontal_centre_at_source_pose_height",
    });
    expect(GRAND_HALL_LINEAGE_TARGET).toEqual([
      0.15796363067625974,
      GRAND_HALL_LINEAGE_CAMERA.position[1],
      -0.19184415815737577,
    ]);
    expect(GRAND_HALL_LINEAGE_INITIAL_BENCHMARK.viewport).toEqual({
      width: 1600,
      height: 900,
      devicePixelRatio: 1,
    });
    expect(GRAND_HALL_LINEAGE_INITIAL_BENCHMARK.rendererSettings.antialias).toBe(false);
    const parsed = VisualLineageBenchmarkV0Schema.parse(GRAND_HALL_LINEAGE_INITIAL_BENCHMARK);
    expect(parsed.worktreeDirty).toBe(true);
    expect(parsed.representations.find((item) => item.id === "supplied-ply-mesh")?.sourceRefs).toEqual([
      "sha256:be8d7a47c021c4299c554d5e325740c06238c078da6fee72b884807e19528fea",
    ]);
    expect(parsed.representations.find((item) => item.id === "native-lcc")?.sourceRefs).toEqual([
      "sha256:ce2a539483c7c2a271ca2555f6390e16425bb911851a8a56c2f16b17c248cac1",
    ]);
    expect(parsed.representations.find((item) => item.id === "independent-viewer-sog")?.status)
      .toBe("not_run");
  });

  it("builds matched SOG and SPZ fixture paths with one transform and camera", () => {
    const sog = grandHallLineageFixturePath("sog", "http://127.0.0.1:8123");
    const spz = grandHallLineageFixturePath("spz", "http://127.0.0.1:8123");
    const sogParams = new URL(sog, "http://localhost:5173").searchParams;
    const spzParams = new URL(spz, "http://localhost:5173").searchParams;

    expect(sogParams.get("cam")).toBe(spzParams.get("cam"));
    expect(sogParams.get("look")).toBe(spzParams.get("look"));
    expect(sogParams.get("offset")).toBe(spzParams.get("offset"));
    expect(sogParams.get("splatUrl")).toContain("scans_BIG_MODEL_TH_GH_1");
    expect(spzParams.get("splatUrl")).toContain("scans_BIG_MODEL_TH_GH_4");
    expect(sogParams.get("fixed")).toBe("1");
    expect(sogParams.get("antialias")).toBe("0");
  });
});
