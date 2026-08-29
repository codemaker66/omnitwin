import { describe, expect, it, vi } from "vitest";

import {
  __testOnlyGrandHallT554NativeReviewProductionAuthorityV2,
  assertGrandHallT554NativeReviewProductionAuthorityPairV2,
} from "../grand-hall-t554-native-review-production-authority-v2.js";

function rejecting(label: string) {
  return vi.fn(() => {
    throw new Error(label);
  });
}

describe("native-review correlated production authority", () => {
  it("selects V2 exclusively from the private V2 pack brand", () => {
    const pack = Object.freeze({ label: "v2-pack" });
    const runtime = Object.freeze({ label: "v2-runtime" });
    const assertV2Pack = vi.fn((value: unknown) => {
      if (value !== pack) throw new Error("not v2 pack");
    });
    const assertV2Runtime = vi.fn((value: unknown, exactPack: unknown) => {
      if (value !== runtime || exactPack !== pack)
        throw new Error("not v2 pair");
    });
    const assertV1Pack = rejecting("v1 must not run");
    const assertV1Runtime = rejecting("v1 must not run");

    const result =
      __testOnlyGrandHallT554NativeReviewProductionAuthorityV2.dispatchProductionAuthorityPair(
        pack,
        runtime,
        { assertV2Pack, assertV2Runtime, assertV1Pack, assertV1Runtime },
      );
    expect(result).toEqual({
      implementationPack: pack,
      runtimeAuthority: runtime,
    });
    expect(assertV1Pack).not.toHaveBeenCalled();
    expect(assertV1Runtime).not.toHaveBeenCalled();
  });

  it("falls back to the complete V1 pair only when the V2 pack brand fails", () => {
    const pack = Object.freeze({ label: "v1-pack" });
    const runtime = Object.freeze({ label: "v1-runtime" });
    const assertV1Pack = vi.fn((value: unknown) => {
      if (value !== pack) throw new Error("not v1 pack");
    });
    const assertV1Runtime = vi.fn((value: unknown, exactPack: unknown) => {
      if (value !== runtime || exactPack !== pack)
        throw new Error("not v1 pair");
    });
    const result =
      __testOnlyGrandHallT554NativeReviewProductionAuthorityV2.dispatchProductionAuthorityPair(
        pack,
        runtime,
        {
          assertV2Pack: rejecting("not v2 pack"),
          assertV2Runtime: rejecting("v2 runtime must not run"),
          assertV1Pack,
          assertV1Runtime,
        },
      );
    expect(result).toEqual({
      implementationPack: pack,
      runtimeAuthority: runtime,
    });
    expect(assertV1Runtime).toHaveBeenCalledWith(runtime, pack);
  });

  it("propagates the exact V1 runtime-pair failure after V1 pack admission", () => {
    const pack = Object.freeze({ label: "v1-pack" });
    const crossedRuntime = Object.freeze({ label: "v2-runtime" });
    const pairError = new Error("crossed v1 runtime pair");
    const assertV1Pack = vi.fn((value: unknown) => {
      if (value !== pack) throw new Error("not v1 pack");
    });
    const assertV1Runtime = vi.fn(() => {
      throw pairError;
    });

    expect(() =>
      __testOnlyGrandHallT554NativeReviewProductionAuthorityV2.dispatchProductionAuthorityPair(
        pack,
        crossedRuntime,
        {
          assertV2Pack: rejecting("not v2 pack"),
          assertV2Runtime: rejecting("v2 runtime must not run"),
          assertV1Pack,
          assertV1Runtime,
        },
      ),
    ).toThrow(pairError);
    expect(assertV1Pack).toHaveBeenCalledWith(pack);
    expect(assertV1Runtime).toHaveBeenCalledWith(crossedRuntime, pack);
  });

  it("rejects a cross-version runtime without falling through after V2 pack admission", () => {
    const pack = Object.freeze({ label: "v2-pack" });
    const v1Runtime = Object.freeze({ label: "v1-runtime" });
    const assertV1Pack = vi.fn();
    const assertV1Runtime = vi.fn();
    expect(() =>
      __testOnlyGrandHallT554NativeReviewProductionAuthorityV2.dispatchProductionAuthorityPair(
        pack,
        v1Runtime,
        {
          assertV2Pack: vi.fn(),
          assertV2Runtime: rejecting("cross-version runtime"),
          assertV1Pack,
          assertV1Runtime,
        },
      ),
    ).toThrow("cross-version runtime");
    expect(assertV1Pack).not.toHaveBeenCalled();
    expect(assertV1Runtime).not.toHaveBeenCalled();
  });

  it("rejects forged objects when neither private pack brand admits them", () => {
    const forgedPack = Object.freeze({
      schemaVersion:
        "venviewer.grand-hall-t554-verified-native-review-implementation-pack.v2",
    });
    expect(() =>
      __testOnlyGrandHallT554NativeReviewProductionAuthorityV2.dispatchProductionAuthorityPair(
        forgedPack,
        Object.freeze({}),
        {
          assertV2Pack: rejecting("forged v2"),
          assertV2Runtime: vi.fn(),
          assertV1Pack: rejecting("forged v1"),
          assertV1Runtime: vi.fn(),
        },
      ),
    ).toThrow("neither admitted private identity brand");

    expect(() => {
      assertGrandHallT554NativeReviewProductionAuthorityPairV2({
        implementationPack: forgedPack,
        runtimeAuthority: Object.freeze({}),
      });
    }).toThrow("neither admitted private identity brand");
  });
});
