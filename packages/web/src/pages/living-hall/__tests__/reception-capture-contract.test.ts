import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  assertReceptionCaptureWithinDeadline,
  flipRgbaRows,
  scheduleReceptionCaptureDeadline,
  validateReceptionCaptureRequest,
} from "../ReceptionCaptureAdapter.js";
import {
  RECEPTION_CAPTURE_SCHEMA_VERSION,
  buildReceptionCaptureConfiguration,
  receptionAssetSetDigest,
} from "../reception-capture-contract.js";
import {
  parseReceptionCapturePageRequest,
} from "../LivingHallLocalPreflightPage.js";
import { selectReceptionLocalPreflight } from "../reception-local-preflight.js";
import { RECEPTION_REVIEW_VIEWS } from "../reception-review-views.js";

const SHA256 = /^[a-f0-9]{64}$/u;

function validCaptureQuery(): URLSearchParams {
  return new URLSearchParams({
    candidate: "quality",
    camera: "1,2,3",
    lookAt: "4,5,6",
    up: "0,1,0",
    fov: "48",
    experimentalViewId: "overview-fixture",
    capture: "1",
    captureNonce: "capture-001",
  });
}

describe("Reception renderer-owned capture contract", () => {
  it("accepts one complete capture query without a fallback", () => {
    const parsed = parseReceptionCapturePageRequest(validCaptureQuery());
    expect(parsed).not.toBeNull();
    expect(parsed?.candidateId).toBe("quality");
    expect(parsed?.captureNonce).toBe("capture-001");
    expect(parsed?.reviewView.experimentalViewId).toBe("overview-fixture");
  });

  it.each([
    ["missing challenge", (query: URLSearchParams) => { query.delete("captureNonce"); }],
    ["bad candidate", (query: URLSearchParams) => { query.set("candidate", "other"); }],
    ["partial camera", (query: URLSearchParams) => { query.delete("lookAt"); }],
    ["unknown field", (query: URLSearchParams) => {
      query.set("assetUrl", "https://example.test/a");
    }],
    ["duplicate candidate", (query: URLSearchParams) => {
      query.append("candidate", "quality");
    }],
  ])("rejects %s", (_label, mutate) => {
    const query = validCaptureQuery();
    mutate(query);
    expect(parseReceptionCapturePageRequest(query)).toBeNull();
  });

  it("matches the runner's sorted asset-set digest rule", () => {
    const selection = selectReceptionLocalPreflight("quality", RECEPTION_REVIEW_VIEWS[0]);
    const identity = [...selection.captureAssets]
      .sort((left, right) => left.requestPath.localeCompare(right.requestPath))
      .map(({ requestPath: requestedPath, sha256: digest, sizeBytes }) => ({
        requestedPath,
        digest,
        sizeBytes,
      }));
    const expected = createHash("sha256").update(JSON.stringify(identity)).digest("hex");
    expect(receptionAssetSetDigest(selection.captureAssets)).toBe(expected);
  });

  it("builds hashes from the real profile and injected build identity", () => {
    const selection = selectReceptionLocalPreflight("quality", RECEPTION_REVIEW_VIEWS[0]);
    const configuration = buildReceptionCaptureConfiguration(selection, "capture-001");
    expect(configuration.assetSetSha256).toMatch(SHA256);
    expect(Object.values(configuration.rendererBinding)).toHaveLength(7);
    expect(Object.values(configuration.rendererBinding).every((value) => SHA256.test(value))).toBe(true);
    expect(configuration.assets).toHaveLength(4);
  });

  it("requires exact request fields, the page challenge, and an independent deadline", () => {
    const request = {
      schemaVersion: RECEPTION_CAPTURE_SCHEMA_VERSION,
      protocolDigest: "a".repeat(64),
      challengeNonce: "capture-001",
    };
    expect(validateReceptionCaptureRequest(request, "capture-001")).toEqual(request);
    expect(() => validateReceptionCaptureRequest({ ...request, extra: true }, "capture-001"))
      .toThrow(/fields/u);
    expect(() => validateReceptionCaptureRequest(request, "capture-002"))
      .toThrow(/does not match/u);
    expect(() => { assertReceptionCaptureWithinDeadline(1_000, 60_999); }).not.toThrow();
    expect(() => { assertReceptionCaptureWithinDeadline(1_000, 61_000); })
      .toThrow(/within 60 seconds/u);
    vi.useFakeTimers();
    try {
      const onTimeout = vi.fn();
      const cancel = scheduleReceptionCaptureDeadline(onTimeout);
      vi.advanceTimersByTime(59_999);
      expect(onTimeout).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(onTimeout).toHaveBeenCalledOnce();
      cancel();
    } finally {
      vi.useRealTimers();
    }
  });

  it("turns WebGL bottom-up rows into presentation order", () => {
    const bottom = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(Array.from(flipRgbaRows(bottom, 1, 2))).toEqual([5, 6, 7, 8, 1, 2, 3, 4]);
  });
});
