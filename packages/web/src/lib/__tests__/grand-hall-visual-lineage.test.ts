import { describe, expect, it } from "vitest";
import { VisualLineageBenchmarkV0Schema } from "@omnitwin/types";
import {
  classifyWebGlRenderer,
  GRAND_HALL_CAPTURED_SPZ_MEMBERS,
  GRAND_HALL_LINEAGE_CAMERA,
  GRAND_HALL_LINEAGE_CAMERA_SOURCE,
  GRAND_HALL_LINEAGE_INITIAL_BENCHMARK,
  GRAND_HALL_LINEAGE_TARGET,
  grandHallLineageCameraMatches,
  grandHallLineageFixturePath,
  grandHallPlyLineageFixturePath,
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

  it("uses the identical camera contract for the exact-byte structural PLY lane", () => {
    const sogParams = new URL(
      grandHallLineageFixturePath("sog", "http://127.0.0.1:8123"),
      "http://localhost:5173",
    ).searchParams;
    const plyParams = new URL(
      grandHallPlyLineageFixturePath("http://127.0.0.1:8123"),
      "http://localhost:5173",
    ).searchParams;
    for (const key of ["zUp", "offset", "cam", "look", "fov", "near", "far", "dpr", "antialias", "fixed"]) {
      expect(plyParams.get(key)).toBe(sogParams.get(key));
    }
    expect(plyParams.get("meshUrl")).toContain("scans_BIG_MODEL_TH_GH_3/mesh-files/Grand_Hall.ply");
    expect(plyParams.has("splatUrl")).toBe(false);
  });

  it("pins every SPZ frontier member instead of trusting matching names", () => {
    expect(GRAND_HALL_CAPTURED_SPZ_MEMBERS).toHaveLength(11);
    expect(GRAND_HALL_CAPTURED_SPZ_MEMBERS.reduce(
      (total, member) => total + member.gaussianCount,
      0,
    )).toBe(6_019_684);
    expect(GRAND_HALL_CAPTURED_SPZ_MEMBERS.reduce(
      (total, member) => total + member.sizeBytes,
      0,
    )).toBe(178_415_360);
    expect(new Set(GRAND_HALL_CAPTURED_SPZ_MEMBERS.map((member) => member.sha256)).size).toBe(11);
  });

  it("requires the complete position, quaternion, projection, and clip-plane camera contract", () => {
    const exact = {
      position: GRAND_HALL_LINEAGE_CAMERA.position,
      quaternion: GRAND_HALL_LINEAGE_CAMERA.quaternion,
      projectionMatrix: GRAND_HALL_LINEAGE_CAMERA.projectionMatrix,
      fov: GRAND_HALL_LINEAGE_CAMERA.fov,
      near: GRAND_HALL_LINEAGE_CAMERA.near,
      far: GRAND_HALL_LINEAGE_CAMERA.far,
    };
    expect(grandHallLineageCameraMatches(exact)).toBe(true);
    expect(grandHallLineageCameraMatches({
      ...exact,
      projectionMatrix: exact.projectionMatrix.map((value, index) => index === 10 ? value + 0.01 : value),
    })).toBe(false);
    expect(grandHallLineageCameraMatches({
      ...exact,
      quaternion: [exact.quaternion[0], exact.quaternion[1], exact.quaternion[2] + 0.01, exact.quaternion[3]],
    })).toBe(false);
  });

  it("distinguishes hardware, software, and unproven WebGL renderers", () => {
    expect(classifyWebGlRenderer(
      "Google Inc. (NVIDIA)",
      "ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11 vs_5_0 ps_5_0)",
    )).toBe("hardware");
    expect(classifyWebGlRenderer(
      "Google Inc. (Google)",
      "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))",
    )).toBe("software");
    expect(classifyWebGlRenderer("WebKit", "WebKit WebGL")).toBe("unknown");
  });
});
