export const GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_ABI_V2 =
  "venviewer.grand-hall-t554-native-review-fixed-admission-abi.v2";

export interface GrandHallT554NativeReviewImplementationBindingV2 {
  readonly schemaVersion: "venviewer.grand-hall-t554-native-review-implementation-manifest-binding.v2";
  readonly implementationId: "grand-hall-t554-native-review-workbench-v2";
  readonly semanticSha256: `sha256:${string}`;
  readonly fileSha256: `sha256:${string}`;
  readonly byteLength: number;
}

export interface GrandHallT554NativeReviewStaticAssetsV2 {
  readonly documentHtml: Buffer;
  readonly stylesheetCss: Buffer;
  readonly applicationJavascript: Buffer;
}

export interface GrandHallT554VerifiedNativeReviewImplementationPackV2 {
  readonly schemaVersion: "venviewer.grand-hall-t554-verified-native-review-implementation-pack.v2";
  readonly authority: "none";
  readonly manifestBinding: GrandHallT554NativeReviewImplementationBindingV2;
  readonly memberInventorySha256: `sha256:${string}`;
  copyExactManifestBytes(): Buffer;
  copyExactStaticAssetsV2(): GrandHallT554NativeReviewStaticAssetsV2;
}

export interface GrandHallT554LoadedNativeReviewImplementationRuntimeAuthorityV2 {
  readonly schemaVersion: "venviewer.grand-hall-t554-loaded-native-review-implementation-runtime-authority.v2";
  readonly authority: "none";
  readonly manifestBinding: GrandHallT554NativeReviewImplementationBindingV2;
  readonly memberInventorySha256: `sha256:${string}`;
  readonly decoderRuntimeLoaded: true;
  readonly safeEntrypointImportAvailable: true;
  readonly sameInstanceDecoderAttested: true;
}

export interface GrandHallT554NativeReviewFixedAdmissionAbiWitnessV2 {
  readonly schemaVersion: typeof GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_ABI_V2;
  readonly sourceTreeAdmissionAvailable: false;
  readonly authority: "none";
}

export const GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_ABI_WITNESS_V2: GrandHallT554NativeReviewFixedAdmissionAbiWitnessV2 =
  Object.freeze({
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_ABI_V2,
    sourceTreeAdmissionAvailable: false,
    authority: "none",
  });

export class GrandHallT554NativeReviewFixedAdmissionUnavailableErrorV2 extends Error {
  readonly code = "FIXED_ADMISSION_UNAVAILABLE" as const;
  constructor() {
    super(
      "The source-tree fixed-admission ABI cannot admit a production native-review payload.",
    );
    this.name = "GrandHallT554NativeReviewFixedAdmissionUnavailableErrorV2";
  }
}

export function assertGrandHallT554NativeReviewFixedPackV2(
  _value: unknown,
): asserts _value is GrandHallT554VerifiedNativeReviewImplementationPackV2 {
  throw new GrandHallT554NativeReviewFixedAdmissionUnavailableErrorV2();
}

export function assertGrandHallT554NativeReviewFixedRuntimeAuthorityV2(
  _value: unknown,
  _pack: GrandHallT554VerifiedNativeReviewImplementationPackV2,
): asserts _value is GrandHallT554LoadedNativeReviewImplementationRuntimeAuthorityV2 {
  throw new GrandHallT554NativeReviewFixedAdmissionUnavailableErrorV2();
}
