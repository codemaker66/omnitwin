import {
  assertGrandHallT554NativeReviewFixedPackV2,
  GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_ABI_WITNESS_V2,
  type GrandHallT554VerifiedNativeReviewImplementationPackV2,
} from "./grand-hall-t554-native-review-fixed-admission-abi-v2.js";

export const GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_GATE_V2 =
  "venviewer.grand-hall-t554-native-review-payload-gate.v2";
export const GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_POLICY_V2 = Object.freeze({
  schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_GATE_V2,
  authority: "none" as const,
  reviewState: "human_pending" as const,
  finalDecision: "PENDING" as const,
  acceptanceAuthorized: false as const,
  reconstructionAuthorized: false as const,
  exportAuthorized: false as const,
  generatedContentAuthorized: false as const,
  runtimeAuthorized: false as const,
  browserControlledTruthAuthorized: false as const,
  httpLaunchIncluded: false as const,
});
export const GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_GATE_ABI_WITNESS_V2 =
  GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_ABI_WITNESS_V2;

export interface GrandHallT554NativeReviewPayloadCoreNamespaceV2 {
  readonly GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_V2: "venviewer.grand-hall-t554-native-review-payload-core.v2";
  readonly GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_POLICY_V2: object;
  readonly GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_ABI_WITNESS_V2: typeof GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_ABI_WITNESS_V2;
  readonly createGrandHallT554NativeReviewPayloadWorkbenchV2: (
    ...args: readonly unknown[]
  ) => Promise<unknown>;
}

class PayloadGateReentryErrorV2 extends Error {
  readonly code = "PAYLOAD_GATE_REENTRY" as const;
  constructor() {
    super(
      "The native-review payload gate is one-shot and was entered more than once.",
    );
    this.name = "PayloadGateReentryErrorV2";
  }
}

let entered = false;
let poisonInFlight: ((error: Error) => void) | null = null;

function observeRejection<T>(promise: Promise<T>): Promise<T> {
  void promise.catch(() => undefined);
  return promise;
}

function validateCoreNamespace(
  value: unknown,
): GrandHallT554NativeReviewPayloadCoreNamespaceV2 {
  if (
    value === null ||
    typeof value !== "object" ||
    Object.getOwnPropertyNames(value).length !== 4 ||
    Reflect.get(value, "GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_V2") !==
      "venviewer.grand-hall-t554-native-review-payload-core.v2" ||
    Reflect.get(
      value,
      "GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_ABI_WITNESS_V2",
    ) !== GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_ABI_WITNESS_V2 ||
    typeof Reflect.get(
      value,
      "createGrandHallT554NativeReviewPayloadWorkbenchV2",
    ) !== "function"
  ) {
    throw new TypeError(
      "The fixed native-review payload core namespace is invalid.",
    );
  }
  const policy: unknown = (value as Record<string, unknown>)[
    "GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_POLICY_V2"
  ];
  if (
    policy === null ||
    typeof policy !== "object" ||
    !Object.isFrozen(policy) ||
    Object.getOwnPropertyNames(policy).length !== 11 ||
    Reflect.get(policy, "schemaVersion") !==
      "venviewer.grand-hall-t554-native-review-payload-core-policy.v2" ||
    Reflect.get(policy, "authority") !== "none" ||
    Reflect.get(policy, "reviewState") !== "human_pending" ||
    Reflect.get(policy, "finalDecision") !== "PENDING" ||
    Reflect.get(policy, "acceptanceAuthorized") !== false ||
    Reflect.get(policy, "reconstructionAuthorized") !== false ||
    Reflect.get(policy, "exportAuthorized") !== false ||
    Reflect.get(policy, "generatedContentAuthorized") !== false ||
    Reflect.get(policy, "runtimeAuthorized") !== false ||
    Reflect.get(policy, "browserControlledTruthAuthorized") !== false ||
    Reflect.get(policy, "httpLaunchIncluded") !== false
  ) {
    throw new TypeError(
      "The fixed native-review payload core policy is invalid.",
    );
  }
  return value as GrandHallT554NativeReviewPayloadCoreNamespaceV2;
}

export function loadGrandHallT554NativeReviewPayloadCoreV2(
  pack: GrandHallT554VerifiedNativeReviewImplementationPackV2,
): Promise<GrandHallT554NativeReviewPayloadCoreNamespaceV2> {
  if (entered) {
    const error = new PayloadGateReentryErrorV2();
    poisonInFlight?.(error);
    poisonInFlight = null;
    return observeRejection(Promise.reject(error));
  }
  entered = true;
  const poisonState: { error: Error | null } = { error: null };
  let rejectResult: (error: Error) => void = () => undefined;
  const result = observeRejection(
    new Promise<GrandHallT554NativeReviewPayloadCoreNamespaceV2>(
      (_resolve, reject) => {
        rejectResult = reject;
      },
    ),
  );
  poisonInFlight = (error) => {
    poisonState.error = error;
    rejectResult(error);
  };
  try {
    assertGrandHallT554NativeReviewFixedPackV2(pack);
    if (poisonState.error !== null) return result;
    const imported = observeRejection(
      import("./grand-hall-t554-native-review-payload-core-v2.js").then(
        validateCoreNamespace,
      ),
    );
    const raced = observeRejection(Promise.race([result, imported]));
    void raced.then(
      () => {
        poisonInFlight = null;
      },
      () => {
        poisonInFlight = null;
      },
    );
    return raced;
  } catch (error) {
    if (poisonState.error !== null) return result;
    poisonInFlight = null;
    rejectResult(
      error instanceof Error
        ? error
        : new Error("Fixed pack assertion failed.", { cause: error }),
    );
    return result;
  }
}
