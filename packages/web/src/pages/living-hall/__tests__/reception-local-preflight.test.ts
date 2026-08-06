import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RECEPTION_FIXED_FINE_REVIEW_PROFILE } from "../reception-viewer-profile.js";
import {
  resolveReceptionLocalAssetOrigin,
  selectReceptionLocalPreflight,
} from "../reception-local-preflight.js";
import {
  findReceptionReviewView,
  RECEPTION_REVIEW_VIEWS,
} from "../reception-review-views.js";
import { parseReceptionCapturePageRequest } from "../LivingHallLocalPreflightPage.js";

describe("Reception local real-component preflight", () => {
  it("offers exactly six immutable review cameras", () => {
    expect(RECEPTION_REVIEW_VIEWS.map((view) => view.id)).toEqual([
      "overview",
      "timber-left",
      "timber-right",
      "floor-surface",
      "ceiling-moulding",
      "column-skirting",
    ]);
    expect(findReceptionReviewView("overview")).toEqual(RECEPTION_REVIEW_VIEWS[0]);
    expect(findReceptionReviewView("arbitrary-camera")).toBeNull();
  });

  it("selects only the four reviewed Quality files", () => {
    const selection = selectReceptionLocalPreflight("quality", RECEPTION_REVIEW_VIEWS[0]);
    expect(selection.runtimeProfileId).toBe("quality-sog-fine-v1");
    expect(selection.expectedGaussianCount).toBe(2_002_009);
    expect(selection.splatSources.map((source) =>
      source.kind === "url" ? source.url : "private-stream"
    )).toEqual([
      "/splats/reception/0_15_0_0.sog",
      "/splats/reception/0_1_0_5.sog",
      "/splats/reception/0_6_0_0.sog",
      "/splats/reception/0_7_0_0.sog",
    ]);
  });

  it("selects only the four reviewed Mobile files from one fixed local origin", () => {
    const selection = selectReceptionLocalPreflight("mobile", RECEPTION_REVIEW_VIEWS[0]);
    expect(selection.runtimeProfileId).toBe("mobile-spz-fine-v1");
    expect(selection.expectedGaussianCount).toBe(1_978_258);
    expect(selection.splatSources.map((source) =>
      source.kind === "url" ? source.url : "private-stream"
    )).toEqual([
      "http://127.0.0.1:4174/0_13_0_0.spz",
      "http://127.0.0.1:4174/0_3_0_0.spz",
      "http://127.0.0.1:4174/0_7_0_1.spz",
      "http://127.0.0.1:4174/0_8_0_0.spz",
    ]);
  });

  it("accepts only explicit loopback origins for a replay runner", () => {
    expect(resolveReceptionLocalAssetOrigin(undefined, "")).toBe("");
    expect(resolveReceptionLocalAssetOrigin("http://127.0.0.1:5190", "")).toBe(
      "http://127.0.0.1:5190",
    );
    expect(() =>
      resolveReceptionLocalAssetOrigin("https://127.0.0.1:5190", "")
    ).toThrow(/127\.0\.0\.1 HTTP port/u);
    expect(() =>
      resolveReceptionLocalAssetOrigin("http://localhost:5190", "")
    ).toThrow(/127\.0\.0\.1 HTTP port/u);
    expect(() =>
      resolveReceptionLocalAssetOrigin("http://127.0.0.1:5190/assets", "")
    ).toThrow(/127\.0\.0\.1 HTTP port/u);
  });

  it("accepts only one complete, challenge-bound capture query", () => {
    const valid = new URLSearchParams({
      candidate: "quality",
      camera: "0,1,4",
      lookAt: "0,1,0",
      up: "0,1,0",
      fov: "60",
      experimentalViewId: "station-01",
      capture: "1",
      captureNonce: "challenge-01",
    });
    expect(parseReceptionCapturePageRequest(valid)).toMatchObject({
      candidateId: "quality",
      captureNonce: "challenge-01",
      reviewView: { experimentalViewId: "station-01" },
    });
    const invalidQueries = [
      new URLSearchParams(valid),
      new URLSearchParams(valid),
      new URLSearchParams(valid),
      new URLSearchParams(valid),
    ];
    invalidQueries[0]?.append("candidate", "mobile");
    invalidQueries[1]?.set("unexpected", "1");
    invalidQueries[2]?.delete("camera");
    invalidQueries[3]?.set("captureNonce", "unsafe nonce");
    invalidQueries.forEach((query) => {
      expect(parseReceptionCapturePageRequest(query)).toBeNull();
    });
  });

  it("pins the inspected Spark, colour, and tone-mapping baseline", () => {
    expect(RECEPTION_FIXED_FINE_REVIEW_PROFILE).toMatchObject({
      canvasDpr: [1, 2],
      canvas: {
        antialias: false,
        powerPreference: "high-performance",
        outputColorSpace: "srgb",
        toneMapping: "ACESFilmicToneMapping",
        toneMappingExposure: 1,
      },
      spark: {
        maxSh: 3,
        enableLod: false,
        renderer: {
          encodeLinear: false,
          autoUpdate: true,
          preUpdate: true,
          enable2DGS: false,
          preBlurAmount: 0,
          blurAmount: 0.3,
          focalDistance: 0,
          apertureAngle: 0,
          falloff: 1,
          clipXY: 1.4,
          enableLod: false,
        },
      },
    });
  });

  it("keeps the route behind a compile-time development guard", () => {
    const router = readFileSync(resolve(process.cwd(), "src/router.tsx"), "utf8");
    const page = readFileSync(
      resolve(process.cwd(), "src/pages/living-hall/LivingHallPage.tsx"),
      "utf8",
    );
    expect(router).toContain("const LivingHallLocalPreflightPage = import.meta.env.DEV");
    expect(router).toContain('path: "/dev/reception-quality-preflight"');
    expect(page).toContain("const acceptedLocalPreflight = import.meta.env.DEV");
  });
});
