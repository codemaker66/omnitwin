import {
  assertGrandHallT554NativeReviewFixedPackV2,
  assertGrandHallT554NativeReviewFixedRuntimeAuthorityV2,
  GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_ABI_WITNESS_V2,
  type GrandHallT554LoadedNativeReviewImplementationRuntimeAuthorityV2,
  type GrandHallT554NativeReviewStaticAssetsV2,
  type GrandHallT554VerifiedNativeReviewImplementationPackV2,
} from "./grand-hall-t554-native-review-fixed-admission-abi-v2.js";
import {
  createGrandHallT554NativeReviewOperatorSessionV2,
  openGrandHallT554NativeReviewOperatorSessionV2,
  takeOverGrandHallT554NativeReviewOperatorSessionAfterCrashV2,
  type GrandHallT554NativeReviewOperatorSessionV2,
} from "./grand-hall-t554-native-review-operator-session-v2.js";
import { loadGrandHallT554NativeReviewRegistry } from "./grand-hall-t554-native-review-registry.js";
import type { GrandHallT554NativeReviewPriorOwnerWitnessV2 } from "./grand-hall-t554-native-review-session-owner-v2.js";
import {
  createGrandHallT554NativeReviewRouterV2,
  type GrandHallT554NativeReviewRouterFatalEventV2,
  type GrandHallT554NativeReviewRouterV2,
} from "./grand-hall-t554-native-review-router-v2.js";
import {
  createLocalSessionTokenBroker,
  LocalSessionRequestGate,
} from "./local-session-http.js";

export const GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_V2 =
  "venviewer.grand-hall-t554-native-review-payload-core.v2";
export const GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_POLICY_V2 =
  Object.freeze({
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-payload-core-policy.v2" as const,
    authority: "none" as const,
    reviewState: "human_pending" as const,
    finalDecision: "PENDING" as const,
    acceptanceAuthorized: false as const,
    reconstructionAuthorized: false as const,
    runtimeAuthorized: false as const,
    exportAuthorized: false as const,
    generatedContentAuthorized: false as const,
    browserControlledTruthAuthorized: false as const,
    httpLaunchIncluded: false as const,
  });
export const GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_ABI_WITNESS_V2 =
  GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_ABI_WITNESS_V2;

interface PayloadWorkbenchBaseInputV2 {
  readonly implementationPack: GrandHallT554VerifiedNativeReviewImplementationPackV2;
  readonly runtimeAuthority: GrandHallT554LoadedNativeReviewImplementationRuntimeAuthorityV2;
  readonly reviewPackDirectory: string;
  readonly panoramaSourceRoot: string;
  readonly sessionRoot: string;
  readonly onFatal: (
    event: GrandHallT554NativeReviewRouterFatalEventV2,
  ) => Promise<void> | void;
}
export type GrandHallT554NativeReviewPayloadWorkbenchInputV2 =
  | (PayloadWorkbenchBaseInputV2 & { readonly mode: "create" })
  | (PayloadWorkbenchBaseInputV2 & { readonly mode: "open" })
  | (PayloadWorkbenchBaseInputV2 & {
      readonly mode: "crash_takeover";
      readonly priorOwnerWitness: GrandHallT554NativeReviewPriorOwnerWitnessV2;
    });

export interface GrandHallT554NativeReviewPayloadWorkbenchV2 {
  readonly schemaVersion: "venviewer.grand-hall-t554-native-review-payload-workbench.v2";
  readonly authority: "none";
  readonly reviewState: "human_pending";
  readonly finalDecision: "PENDING";
  readonly acceptanceAuthorized: false;
  readonly reconstructionAuthorized: false;
  readonly runtimeAuthorized: false;
  readonly exportAuthorized: false;
  readonly generatedContentAuthorized: false;
  readonly browserControlledTruthAuthorized: false;
  readonly httpLaunchIncluded: false;
  readonly router: GrandHallT554NativeReviewRouterV2;
  takeBootstrapFragmentForLaunch(): string | null;
  close(): Promise<void>;
}

class PayloadCoreReentryErrorV2 extends Error {
  readonly code = "PAYLOAD_CORE_REENTRY" as const;
  constructor() {
    super("The native-review payload core factory is one-shot.");
    this.name = "PayloadCoreReentryErrorV2";
  }
}

let factoryState: "idle" | "inflight" | "succeeded" | "failed" = "idle";
let poisonInFlight: ((error: Error) => void) | null = null;
let ownedWorkbench: GrandHallT554NativeReviewPayloadWorkbenchV2 | null = null;

function observeRejection<T>(promise: Promise<T>): Promise<T> {
  void promise.catch(() => undefined);
  return promise;
}

function snapshotExactInput(
  input: unknown,
  admission: Readonly<{
    implementationPack: GrandHallT554VerifiedNativeReviewImplementationPackV2;
    runtimeAuthority: GrandHallT554LoadedNativeReviewImplementationRuntimeAuthorityV2;
  }>,
): GrandHallT554NativeReviewPayloadWorkbenchInputV2 {
  if (input === null || typeof input !== "object") {
    throw new TypeError("Payload workbench input must be an object.");
  }
  const candidate = input as Record<string, unknown>;
  const mode: unknown = Reflect.get(candidate, "mode");
  const expected = new Set([
    "implementationPack",
    "runtimeAuthority",
    "reviewPackDirectory",
    "panoramaSourceRoot",
    "sessionRoot",
    "onFatal",
    "mode",
    ...(mode === "crash_takeover" ? ["priorOwnerWitness"] : []),
  ]);
  const keys = Reflect.ownKeys(input);
  if (
    keys.some((key) => typeof key !== "string" || !expected.has(key)) ||
    keys.length !== expected.size ||
    (mode !== "create" && mode !== "open" && mode !== "crash_takeover")
  ) {
    throw new TypeError(
      "Payload workbench input is not the exact closed v2 shape.",
    );
  }
  const reviewPackDirectory: unknown = Reflect.get(
    candidate,
    "reviewPackDirectory",
  );
  const panoramaSourceRoot: unknown = Reflect.get(
    candidate,
    "panoramaSourceRoot",
  );
  const sessionRoot: unknown = Reflect.get(candidate, "sessionRoot");
  const onFatal: unknown = Reflect.get(candidate, "onFatal");
  if (typeof onFatal !== "function") {
    throw new TypeError(
      "Payload workbench input is not the exact closed v2 shape.",
    );
  }
  if (
    typeof reviewPackDirectory !== "string" ||
    reviewPackDirectory.length === 0 ||
    typeof panoramaSourceRoot !== "string" ||
    panoramaSourceRoot.length === 0 ||
    typeof sessionRoot !== "string" ||
    sessionRoot.length === 0
  ) {
    throw new TypeError("Payload workbench paths must be non-empty strings.");
  }
  const base = {
    implementationPack: admission.implementationPack,
    runtimeAuthority: admission.runtimeAuthority,
    reviewPackDirectory,
    panoramaSourceRoot,
    sessionRoot,
    onFatal: onFatal as PayloadWorkbenchBaseInputV2["onFatal"],
  };
  if (mode === "create") return Object.freeze({ ...base, mode });
  if (mode === "open") return Object.freeze({ ...base, mode });
  const priorOwnerWitness: unknown = Reflect.get(
    candidate,
    "priorOwnerWitness",
  );
  return Object.freeze({
    ...base,
    mode,
    priorOwnerWitness:
      priorOwnerWitness as GrandHallT554NativeReviewPriorOwnerWitnessV2,
  });
}

function copyOwnedStaticAssets(
  pack: GrandHallT554VerifiedNativeReviewImplementationPackV2,
): GrandHallT554NativeReviewStaticAssetsV2 {
  const temporary: unknown = pack.copyExactStaticAssetsV2();
  const buffers: Buffer[] = [];
  try {
    if (temporary === null || typeof temporary !== "object") {
      throw new TypeError("The capsule returned invalid static assets.");
    }
    const candidate = temporary as Record<string, unknown>;
    const keys = Reflect.ownKeys(temporary);
    const ownKeys = new Set(keys);
    const values: unknown[] = [];
    for (const key of [
      "documentHtml",
      "stylesheetCss",
      "applicationJavascript",
    ] as const) {
      const value: unknown = ownKeys.has(key)
        ? Reflect.get(candidate, key)
        : undefined;
      values.push(value);
      if (Buffer.isBuffer(value)) buffers.push(value);
    }
    if (
      keys.length !== 3 ||
      keys.some(
        (key) =>
          key !== "documentHtml" &&
          key !== "stylesheetCss" &&
          key !== "applicationJavascript",
      )
    ) {
      throw new TypeError("The capsule returned invalid static assets.");
    }
    for (const value of values) {
      if (!Buffer.isBuffer(value) || value.length === 0) {
        throw new TypeError("The capsule returned invalid static assets.");
      }
    }
    return Object.freeze({
      documentHtml: Buffer.from(values[0] as Buffer),
      stylesheetCss: Buffer.from(values[1] as Buffer),
      applicationJavascript: Buffer.from(values[2] as Buffer),
    });
  } finally {
    for (const buffer of buffers) buffer.fill(0);
  }
}

async function cleanupPartial(
  router: GrandHallT554NativeReviewRouterV2 | null,
  operator: GrandHallT554NativeReviewOperatorSessionV2 | null,
  broker: ReturnType<typeof createLocalSessionTokenBroker> | null,
): Promise<void> {
  if (router !== null) {
    await router.close();
    return;
  }
  const failures: unknown[] = [];
  try {
    broker?.destroy();
  } catch (error) {
    failures.push(error);
  }
  if (operator !== null) {
    try {
      await operator.close();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "Partial payload resources could not be closed.",
    );
  }
}

async function runFactory(
  input: unknown,
  readPoison: () => Error | null,
): Promise<GrandHallT554NativeReviewPayloadWorkbenchV2> {
  if (input === null || typeof input !== "object") {
    throw new TypeError("Payload workbench input must be an object.");
  }
  const untrusted = input as Record<string, unknown>;
  const implementationPack: unknown = Reflect.get(
    untrusted,
    "implementationPack",
  );
  const runtimeAuthority: unknown = Reflect.get(untrusted, "runtimeAuthority");
  assertGrandHallT554NativeReviewFixedPackV2(implementationPack);
  assertGrandHallT554NativeReviewFixedRuntimeAuthorityV2(
    runtimeAuthority,
    implementationPack,
  );
  const afterAuthority = readPoison();
  if (afterAuthority !== null) throw afterAuthority;
  const ownedInput = snapshotExactInput(input, {
    implementationPack,
    runtimeAuthority,
  });
  const afterSnapshot = readPoison();
  if (afterSnapshot !== null) throw afterSnapshot;
  const staticAssets = copyOwnedStaticAssets(ownedInput.implementationPack);
  const afterStaticAssets = readPoison();
  if (afterStaticAssets !== null) throw afterStaticAssets;

  let operator: GrandHallT554NativeReviewOperatorSessionV2 | null = null;
  let broker: ReturnType<typeof createLocalSessionTokenBroker> | null = null;
  let router: GrandHallT554NativeReviewRouterV2 | null = null;
  try {
    const registry = await loadGrandHallT554NativeReviewRegistry({
      reviewPackDirectory: ownedInput.reviewPackDirectory,
      panoramaSourceRoot: ownedInput.panoramaSourceRoot,
    });
    const afterRegistry = readPoison();
    if (afterRegistry !== null) throw afterRegistry;
    const options = {
      sessionRoot: ownedInput.sessionRoot,
      registry,
      implementationPack: ownedInput.implementationPack,
      runtimeAuthority: ownedInput.runtimeAuthority,
    };
    operator =
      ownedInput.mode === "create"
        ? await createGrandHallT554NativeReviewOperatorSessionV2(options)
        : ownedInput.mode === "open"
          ? await openGrandHallT554NativeReviewOperatorSessionV2(options)
          : await takeOverGrandHallT554NativeReviewOperatorSessionAfterCrashV2({
              ...options,
              priorOwnerWitness: ownedInput.priorOwnerWitness,
            });
    const afterOperator = readPoison();
    if (afterOperator !== null) throw afterOperator;
    broker = createLocalSessionTokenBroker();
    router = createGrandHallT554NativeReviewRouterV2({
      operatorSession: operator,
      tokenBroker: broker,
      requestGate: new LocalSessionRequestGate(),
      staticAssets,
      onFatal: ownedInput.onFatal,
    });
    const afterRouter = readPoison();
    if (afterRouter !== null) throw afterRouter;
    const ownedRouter = router;
    return Object.freeze({
      ...GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_POLICY_V2,
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-payload-workbench.v2",
      router: ownedRouter,
      takeBootstrapFragmentForLaunch: () =>
        ownedRouter.takeBootstrapFragmentForLaunch(),
      close: async () => {
        await ownedRouter.close();
      },
    });
  } catch (error) {
    try {
      await cleanupPartial(router, operator, broker);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Payload workbench creation and cleanup both failed.",
      );
    }
    throw error;
  }
}

export function createGrandHallT554NativeReviewPayloadWorkbenchV2(
  input: unknown,
): Promise<GrandHallT554NativeReviewPayloadWorkbenchV2> {
  const reentry = new PayloadCoreReentryErrorV2();
  if (factoryState !== "idle") {
    if (factoryState === "inflight") poisonInFlight?.(reentry);
    if (factoryState === "succeeded" && ownedWorkbench !== null) {
      const workbench = ownedWorkbench;
      ownedWorkbench = null;
      factoryState = "failed";
      return observeRejection(
        workbench.close().then(
          () => Promise.reject(reentry),
          (error: unknown) =>
            Promise.reject(
              new AggregateError(
                [reentry, error],
                "Payload core reentry cleanup failed.",
              ),
            ),
        ),
      );
    }
    return observeRejection(Promise.reject(reentry));
  }
  factoryState = "inflight";
  let poison: Error | null = null;
  poisonInFlight = (error) => {
    poison = error;
  };
  const result = observeRejection(runFactory(input, () => poison));
  void result.then(
    (workbench) => {
      poisonInFlight = null;
      ownedWorkbench = workbench;
      factoryState = "succeeded";
    },
    () => {
      poisonInFlight = null;
      factoryState = "failed";
    },
  );
  return result;
}
