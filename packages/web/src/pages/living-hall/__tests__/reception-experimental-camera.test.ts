import { describe, expect, it } from "vitest";
import {
  buildReceptionCandidateComparisonSearch,
  EXPERIMENTAL_E57_CAMERA_NOTICE,
  parseExperimentalReceptionCamera,
  resolveReceptionReviewView,
} from "../reception-experimental-camera.js";
import { RECEPTION_REVIEW_VIEWS } from "../reception-review-views.js";

function validParams(): URLSearchParams {
  return new URLSearchParams({
    camera: "10.5,2,-3",
    lookAt: "1,0,-8",
    up: "0,1,0",
    fov: "47.5",
    experimentalViewId: "e57-scan-122-camera-04",
  });
}

describe("experimental Reception E57 camera parser", () => {
  it("accepts one complete, finite, geometrically valid pose", () => {
    expect(parseExperimentalReceptionCamera(validParams())).toEqual({
      id: "experimental-e57:e57-scan-122-camera-04",
      label: EXPERIMENTAL_E57_CAMERA_NOTICE,
      featureClass: "experimental E57 camera comparison only",
      camera: [10.5, 2, -3],
      lookAt: [1, 0, -8],
      up: [0, 1, 0],
      verticalFovDegrees: 47.5,
      near: 0.1,
      far: 120,
      experimentalViewId: "e57-scan-122-camera-04",
    });
  });

  it.each([
    ["camera", "NaN,2,3"],
    ["lookAt", "1,Infinity,3"],
    ["up", "0,1,-Infinity"],
    ["fov", "NaN"],
    ["fov", "Infinity"],
  ])("rejects non-finite %s input %s", (key, value) => {
    const params = validParams();
    params.set(key, value);
    expect(parseExperimentalReceptionCamera(params)).toBeNull();
  });

  it("rejects a partial group and falls back atomically to the named view", () => {
    const params = new URLSearchParams({
      view: "timber-left",
      camera: "10.5,2,-3",
    });
    expect(parseExperimentalReceptionCamera(params)).toBeNull();
    expect(resolveReceptionReviewView(params)).toBe(RECEPTION_REVIEW_VIEWS[1]);
  });

  it("rejects duplicated fields instead of choosing one value", () => {
    const params = validParams();
    params.append("fov", "60");
    expect(parseExperimentalReceptionCamera(params)).toBeNull();
  });

  it("rejects huge coordinates and out-of-range fields", () => {
    const huge = validParams();
    huge.set("camera", "100001,2,-3");
    expect(parseExperimentalReceptionCamera(huge)).toBeNull();

    const wideFov = validParams();
    wideFov.set("fov", "121");
    expect(parseExperimentalReceptionCamera(wideFov)).toBeNull();
  });

  it("rejects coincident camera/look-at points and a zero up vector", () => {
    const coincident = validParams();
    coincident.set("lookAt", coincident.get("camera") ?? "");
    expect(parseExperimentalReceptionCamera(coincident)).toBeNull();

    const zeroUp = validParams();
    zeroUp.set("up", "0,0,0");
    expect(parseExperimentalReceptionCamera(zeroUp)).toBeNull();
  });

  it("rejects an up vector parallel or anti-parallel to the view direction", () => {
    const parallel = validParams();
    parallel.set("camera", "0,0,10");
    parallel.set("lookAt", "0,0,0");
    parallel.set("up", "0,0,-1");
    expect(parseExperimentalReceptionCamera(parallel)).toBeNull();

    parallel.set("up", "0,0,1");
    expect(parseExperimentalReceptionCamera(parallel)).toBeNull();
  });

  it.each(["__proto__", "constructor", "prototype", "has space", "../camera"])(
    "rejects prototype-weird or unsafe experiment id %s",
    (experimentalViewId) => {
      const params = validParams();
      params.set("experimentalViewId", experimentalViewId);
      expect(parseExperimentalReceptionCamera(params)).toBeNull();
    },
  );

  it("preserves the exact accepted pose when linking to the other hard-coded candidate", () => {
    const view = parseExperimentalReceptionCamera(validParams());
    expect(view).not.toBeNull();
    if (view === null) return;

    const comparison = new URLSearchParams(
      buildReceptionCandidateComparisonSearch("mobile", view, true),
    );
    expect(comparison.get("candidate")).toBe("mobile");
    expect(comparison.get("camera")).toBe("10.5,2,-3");
    expect(comparison.get("lookAt")).toBe("1,0,-8");
    expect(comparison.get("up")).toBe("0,1,0");
    expect(comparison.get("fov")).toBe("47.5");
    expect(comparison.get("experimentalViewId")).toBe(
      "e57-scan-122-camera-04",
    );
    expect(comparison.get("capture")).toBe("1");
    expect(comparison.has("asset")).toBe(false);
    expect(parseExperimentalReceptionCamera(comparison)).toEqual(view);
  });
});
