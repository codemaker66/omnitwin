import {
  assertGrandHallT554NativeReviewFixedPackV2,
  assertGrandHallT554NativeReviewFixedRuntimeAuthorityV2,
  type GrandHallT554LoadedNativeReviewImplementationRuntimeAuthorityV2,
  type GrandHallT554VerifiedNativeReviewImplementationPackV2,
} from "./grand-hall-t554-native-review-fixed-admission-abi-v2.js";
import {
  assertGrandHallT554LoadedNativeReviewImplementationRuntimeAuthorityV1,
  assertGrandHallT554VerifiedNativeReviewImplementationPackV1,
  type GrandHallT554LoadedNativeReviewImplementationRuntimeAuthorityV1,
  type GrandHallT554VerifiedNativeReviewImplementationPackV1,
} from "./grand-hall-t554-native-review-implementation-manifest.js";

export type GrandHallT554NativeReviewProductionAuthorityPairV2 =
  | {
      readonly implementationPack: GrandHallT554VerifiedNativeReviewImplementationPackV1;
      readonly runtimeAuthority: GrandHallT554LoadedNativeReviewImplementationRuntimeAuthorityV1;
    }
  | {
      readonly implementationPack: GrandHallT554VerifiedNativeReviewImplementationPackV2;
      readonly runtimeAuthority: GrandHallT554LoadedNativeReviewImplementationRuntimeAuthorityV2;
    };

interface AuthorityAssertionsV2 {
  readonly assertV2Pack: (value: unknown) => void;
  readonly assertV2Runtime: (value: unknown, pack: unknown) => void;
  readonly assertV1Pack: (value: unknown) => void;
  readonly assertV1Runtime: (value: unknown, pack: unknown) => void;
}

function dispatchProductionAuthorityPair(
  implementationPack: unknown,
  runtimeAuthority: unknown,
  assertions: AuthorityAssertionsV2,
): GrandHallT554NativeReviewProductionAuthorityPairV2 {
  try {
    assertions.assertV2Pack(implementationPack);
  } catch (v2PackError) {
    try {
      assertions.assertV1Pack(implementationPack);
    } catch (v1PackError) {
      throw new AggregateError(
        [v2PackError, v1PackError],
        "The implementation pack has neither admitted private identity brand.",
      );
    }
    // A V1-branded pack selects V1 conclusively. Its exact-pack runtime-pair
    // failure must remain terminal rather than being misreported as a pack-
    // brand failure or considered for any other version.
    assertions.assertV1Runtime(runtimeAuthority, implementationPack);
    return {
      implementationPack,
      runtimeAuthority,
    } as GrandHallT554NativeReviewProductionAuthorityPairV2;
  }

  // Once the V2 pack brand succeeds, runtime failure is terminal. Falling back
  // here would permit a cross-version pair.
  assertions.assertV2Runtime(runtimeAuthority, implementationPack);
  return {
    implementationPack,
    runtimeAuthority,
  } as GrandHallT554NativeReviewProductionAuthorityPairV2;
}

export function assertGrandHallT554NativeReviewProductionAuthorityPairV2(input: {
  readonly implementationPack: unknown;
  readonly runtimeAuthority: unknown;
}): asserts input is GrandHallT554NativeReviewProductionAuthorityPairV2 {
  dispatchProductionAuthorityPair(
    input.implementationPack,
    input.runtimeAuthority,
    {
      assertV2Pack: assertGrandHallT554NativeReviewFixedPackV2,
      assertV2Runtime: (value, pack) => {
        assertGrandHallT554NativeReviewFixedPackV2(pack);
        assertGrandHallT554NativeReviewFixedRuntimeAuthorityV2(value, pack);
      },
      assertV1Pack: assertGrandHallT554VerifiedNativeReviewImplementationPackV1,
      assertV1Runtime: (value, pack) => {
        assertGrandHallT554VerifiedNativeReviewImplementationPackV1(pack);
        assertGrandHallT554LoadedNativeReviewImplementationRuntimeAuthorityV1(
          value,
          pack,
        );
      },
    },
  );
}

export const __testOnlyGrandHallT554NativeReviewProductionAuthorityV2 =
  /* @__PURE__ */ Object.freeze({ dispatchProductionAuthorityPair });
