import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("../grand-hall-t554-native-review-fixed-admission-abi-v2.js");
  vi.doUnmock("../grand-hall-t554-native-review-implementation-manifest.js");
  vi.doUnmock("../grand-hall-t554-native-review-registry.js");
  vi.doUnmock("../grand-hall-t554-native-review-operator-session-v2.js");
  vi.doUnmock("../grand-hall-t554-native-review-router-v2.js");
  vi.doUnmock("../grand-hall-t554-native-review-payload-core-v2.js");
  vi.doUnmock("../local-session-http.js");
  vi.resetModules();
});

describe("fixed admission ABI v2", () => {
  it("is assertion-only and fails closed in the source tree", async () => {
    const abi =
      await import("../grand-hall-t554-native-review-fixed-admission-abi-v2.js");
    expect(
      abi.GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_ABI_WITNESS_V2,
    ).toEqual({
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-fixed-admission-abi.v2",
      sourceTreeAdmissionAvailable: false,
      authority: "none",
    });
    const assertPack: (value: unknown) => void =
      abi.assertGrandHallT554NativeReviewFixedPackV2;
    const assertRuntime: (value: unknown, pack: never) => void =
      abi.assertGrandHallT554NativeReviewFixedRuntimeAuthorityV2;
    expect(() => {
      assertPack({});
    }).toThrowError(
      expect.objectContaining({ code: "FIXED_ADMISSION_UNAVAILABLE" }),
    );
    expect(() => {
      assertRuntime({}, {} as never);
    }).toThrowError(
      expect.objectContaining({ code: "FIXED_ADMISSION_UNAVAILABLE" }),
    );
  });
});

describe("payload gate v2", () => {
  it("poisons assertion-hook reentry before any core import starts", async () => {
    let coreImports = 0;
    let nested: Promise<unknown> | null = null;
    let gateModule:
      | typeof import("../grand-hall-t554-native-review-payload-gate-v2.js")
      | null = null;
    vi.doMock("../grand-hall-t554-native-review-payload-core-v2.js", () => {
      coreImports += 1;
      return {};
    });
    vi.doMock(
      "../grand-hall-t554-native-review-fixed-admission-abi-v2.js",
      () => ({
        GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_ABI_WITNESS_V2:
          Object.freeze({}),
        assertGrandHallT554NativeReviewFixedPackV2: () => {
          nested =
            gateModule?.loadGrandHallT554NativeReviewPayloadCoreV2(
              {} as never,
            ) ?? null;
        },
      }),
    );
    gateModule =
      await import("../grand-hall-t554-native-review-payload-gate-v2.js");
    const first = gateModule.loadGrandHallT554NativeReviewPayloadCoreV2(
      {} as never,
    );
    await expect(first).rejects.toMatchObject({ code: "PAYLOAD_GATE_REENTRY" });
    await expect(nested).rejects.toMatchObject({
      code: "PAYLOAD_GATE_REENTRY",
    });
    expect(coreImports).toBe(0);
  });

  it("loads the exact frozen authority-none core namespace once", async () => {
    const witness = Object.freeze({ marker: "same-instance" });
    vi.doMock(
      "../grand-hall-t554-native-review-fixed-admission-abi-v2.js",
      () => ({
        GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_ABI_WITNESS_V2: witness,
        assertGrandHallT554NativeReviewFixedPackV2: () => undefined,
        assertGrandHallT554NativeReviewFixedRuntimeAuthorityV2: () => undefined,
      }),
    );
    const gate =
      await import("../grand-hall-t554-native-review-payload-gate-v2.js");
    const core = await gate.loadGrandHallT554NativeReviewPayloadCoreV2(
      {} as never,
    );
    expect(Object.getOwnPropertyNames(core).sort()).toEqual([
      "GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_ABI_WITNESS_V2",
      "GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_POLICY_V2",
      "GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_V2",
      "createGrandHallT554NativeReviewPayloadWorkbenchV2",
    ]);
    expect(core.GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_ABI_WITNESS_V2).toBe(
      witness,
    );
    expect(
      core.GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_POLICY_V2,
    ).toMatchObject({
      authority: "none",
      reviewState: "human_pending",
      finalDecision: "PENDING",
      acceptanceAuthorized: false,
      reconstructionAuthorized: false,
      runtimeAuthorized: false,
      exportAuthorized: false,
      generatedContentAuthorized: false,
      browserControlledTruthAuthorized: false,
      httpLaunchIncluded: false,
    });
    expect(
      Object.isFrozen(
        core.GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_POLICY_V2,
      ),
    ).toBe(true);
  });

  it("does not import the core before the first fixed-pack assertion succeeds", async () => {
    let coreImports = 0;
    vi.doMock("../grand-hall-t554-native-review-payload-core-v2.js", () => {
      coreImports += 1;
      return {
        GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_V2:
          "venviewer.grand-hall-t554-native-review-payload-core.v2",
        createGrandHallT554NativeReviewPayloadWorkbenchV2: () =>
          Promise.resolve(),
      };
    });
    vi.doMock(
      "../grand-hall-t554-native-review-fixed-admission-abi-v2.js",
      () => ({
        GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_ABI_WITNESS_V2:
          Object.freeze({}),
        assertGrandHallT554NativeReviewFixedPackV2: () => {
          throw new Error("brand rejected");
        },
      }),
    );
    const gate =
      await import("../grand-hall-t554-native-review-payload-gate-v2.js");
    await expect(
      gate.loadGrandHallT554NativeReviewPayloadCoreV2({} as never),
    ).rejects.toThrow("brand rejected");
    expect(coreImports).toBe(0);
  });

  it("poisons an in-flight import when a concurrent caller reenters", async () => {
    const asserted: unknown[] = [];
    vi.doMock(
      "../grand-hall-t554-native-review-fixed-admission-abi-v2.js",
      () => ({
        GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_ABI_WITNESS_V2:
          Object.freeze({}),
        assertGrandHallT554NativeReviewFixedPackV2: (value: unknown) =>
          asserted.push(value),
      }),
    );
    const gate =
      await import("../grand-hall-t554-native-review-payload-gate-v2.js");
    const pack = {} as never;
    const first = gate.loadGrandHallT554NativeReviewPayloadCoreV2(pack);
    const second = gate.loadGrandHallT554NativeReviewPayloadCoreV2(pack);
    await expect(first).rejects.toMatchObject({ code: "PAYLOAD_GATE_REENTRY" });
    await expect(second).rejects.toMatchObject({
      code: "PAYLOAD_GATE_REENTRY",
    });
    expect(asserted).toEqual([pack]);
    await expect(
      gate.loadGrandHallT554NativeReviewPayloadCoreV2(pack),
    ).rejects.toMatchObject({ code: "PAYLOAD_GATE_REENTRY" });
  });

  it("makes an assertion failure terminal and non-retryable", async () => {
    let assertions = 0;
    vi.doMock(
      "../grand-hall-t554-native-review-fixed-admission-abi-v2.js",
      () => ({
        GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_ABI_WITNESS_V2:
          Object.freeze({}),
        assertGrandHallT554NativeReviewFixedPackV2: () => {
          assertions += 1;
          throw new Error("terminal");
        },
      }),
    );
    const gate =
      await import("../grand-hall-t554-native-review-payload-gate-v2.js");
    const first = gate.loadGrandHallT554NativeReviewPayloadCoreV2({} as never);
    await expect(first).rejects.toThrow("terminal");
    const second = gate.loadGrandHallT554NativeReviewPayloadCoreV2({} as never);
    await expect(second).rejects.toMatchObject({
      code: "PAYLOAD_GATE_REENTRY",
    });
    expect(assertions).toBe(1);
  });
});

describe("payload core v2", () => {
  async function mockedCore(options?: {
    readonly routerFailure?: boolean;
    readonly brokerDestroyFailure?: boolean;
    readonly registryPromise?: Promise<object>;
    readonly operatorPromise?: Promise<{ close(): Promise<void> }>;
    readonly onRouterConstruction?: () => void;
  }) {
    const calls: string[] = [];
    const operator = {
      close: vi.fn(() => {
        calls.push("operator.close");
        return Promise.resolve();
      }),
    };
    const broker = {
      destroy: vi.fn(() => {
        calls.push("broker.destroy");
        if (options?.brokerDestroyFailure === true) {
          throw new Error("broker destroy failed");
        }
      }),
    };
    const router = {
      schemaVersion: "venviewer.grand-hall-t554-native-review-router.v2",
      takeBootstrapFragmentForLaunch: vi.fn(() => "#fragment"),
      handle: vi.fn(() => Promise.resolve()),
      close: vi.fn(() => {
        calls.push("router.close");
        return Promise.resolve();
      }),
    };
    let receivedFatal: unknown;
    let receivedAssets: unknown;
    vi.doMock(
      "../grand-hall-t554-native-review-fixed-admission-abi-v2.js",
      () => ({
        GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_ABI_WITNESS_V2:
          Object.freeze({}),
        assertGrandHallT554NativeReviewFixedPackV2: () =>
          calls.push("fixed.pack"),
        assertGrandHallT554NativeReviewFixedRuntimeAuthorityV2: () =>
          calls.push("fixed.runtime"),
      }),
    );
    vi.doMock("../grand-hall-t554-native-review-registry.js", () => ({
      loadGrandHallT554NativeReviewRegistry: () => {
        calls.push("registry");
        return options?.registryPromise ?? Promise.resolve({});
      },
    }));
    vi.doMock(
      "../grand-hall-t554-native-review-operator-session-v2.js",
      () => ({
        createGrandHallT554NativeReviewOperatorSessionV2: () => {
          calls.push("operator.create");
          return Promise.resolve(operator);
        },
        openGrandHallT554NativeReviewOperatorSessionV2: () => {
          calls.push("operator.open");
          return options?.operatorPromise ?? Promise.resolve(operator);
        },
        takeOverGrandHallT554NativeReviewOperatorSessionAfterCrashV2: () => {
          calls.push("operator.takeover");
          return Promise.resolve(operator);
        },
      }),
    );
    vi.doMock("../local-session-http.js", () => ({
      createLocalSessionTokenBroker: () => {
        calls.push("broker");
        return broker;
      },
      LocalSessionRequestGate: class {
        constructor() {
          calls.push("gate");
        }

        enter(): () => void {
          return () => undefined;
        }
      },
    }));
    vi.doMock("../grand-hall-t554-native-review-router-v2.js", () => ({
      createGrandHallT554NativeReviewRouterV2: (input: {
        readonly onFatal: unknown;
        readonly staticAssets: unknown;
      }) => {
        calls.push("router");
        receivedFatal = input.onFatal;
        receivedAssets = input.staticAssets;
        options?.onRouterConstruction?.();
        if (options?.routerFailure === true) throw new Error("router failed");
        return router;
      },
    }));
    const core =
      await import("../grand-hall-t554-native-review-payload-core-v2.js");
    return {
      core,
      calls,
      operator,
      broker,
      router,
      receivedFatal: () => receivedFatal,
      receivedAssets: () => receivedAssets,
    };
  }

  function baseInput(mode: "create" | "open" = "open") {
    const sourceAssets = {
      documentHtml: Buffer.from("html"),
      stylesheetCss: Buffer.from("css"),
      applicationJavascript: Buffer.from("js"),
    };
    return {
      implementationPack: {
        copyExactStaticAssetsV2: () => sourceAssets,
      },
      runtimeAuthority: {},
      reviewPackDirectory: "D:\\review-pack",
      panoramaSourceRoot: "F:\\panoramas",
      sessionRoot: "D:\\session",
      onFatal: () => undefined,
      mode,
    } as const;
  }

  it("asserts both fixed brands before registry, filesystem, session, or token effects", async () => {
    const { core, calls, receivedFatal } = await mockedCore();
    const input = baseInput();
    const workbench =
      await core.createGrandHallT554NativeReviewPayloadWorkbenchV2(
        input as never,
      );
    expect(calls).toEqual([
      "fixed.pack",
      "fixed.runtime",
      "registry",
      "operator.open",
      "broker",
      "gate",
      "router",
    ]);
    expect(Object.isFrozen(workbench)).toBe(true);
    expect(workbench).toMatchObject({
      authority: "none",
      reviewState: "human_pending",
      finalDecision: "PENDING",
      acceptanceAuthorized: false,
      reconstructionAuthorized: false,
      runtimeAuthorized: false,
      exportAuthorized: false,
      generatedContentAuthorized: false,
      browserControlledTruthAuthorized: false,
      httpLaunchIncluded: false,
    });
    expect(workbench.takeBootstrapFragmentForLaunch()).toBe("#fragment");
    expect(receivedFatal()).toBe(input.onFatal);
  });

  it("supports create and exact crash takeover modes", async () => {
    const created = await mockedCore();
    await created.core.createGrandHallT554NativeReviewPayloadWorkbenchV2(
      baseInput("create") as never,
    );
    expect(created.calls).toContain("operator.create");
    vi.resetModules();
    const taken = await mockedCore();
    await taken.core.createGrandHallT554NativeReviewPayloadWorkbenchV2({
      ...baseInput(),
      mode: "crash_takeover",
      priorOwnerWitness: {},
    } as never);
    expect(taken.calls).toContain("operator.takeover");
  });

  it("cleans broker and operator exactly once if router construction fails", async () => {
    const { core, calls, broker, operator } = await mockedCore({
      routerFailure: true,
    });
    await expect(
      core.createGrandHallT554NativeReviewPayloadWorkbenchV2(
        baseInput() as never,
      ),
    ).rejects.toThrow("router failed");
    expect(broker.destroy).toHaveBeenCalledTimes(1);
    expect(operator.close).toHaveBeenCalledTimes(1);
    expect(calls.slice(-2)).toEqual(["broker.destroy", "operator.close"]);
  });

  it("still closes the operator when broker cleanup throws", async () => {
    const { core, broker, operator } = await mockedCore({
      routerFailure: true,
      brokerDestroyFailure: true,
    });
    await expect(
      core.createGrandHallT554NativeReviewPayloadWorkbenchV2(
        baseInput() as never,
      ),
    ).rejects.toThrow("creation and cleanup both failed");
    expect(broker.destroy).toHaveBeenCalledTimes(1);
    expect(operator.close).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown input keys before registry or token effects", async () => {
    const { core, calls } = await mockedCore();
    await expect(
      core.createGrandHallT554NativeReviewPayloadWorkbenchV2({
        ...baseInput(),
        forbidden: true,
      } as never),
    ).rejects.toThrow("exact closed v2 shape");
    expect(calls).toEqual(["fixed.pack", "fixed.runtime"]);
  });

  it("rejects null and primitive containers before brand property access", async () => {
    const first = await mockedCore();
    await expect(
      first.core.createGrandHallT554NativeReviewPayloadWorkbenchV2(
        null as never,
      ),
    ).rejects.toThrow("must be an object");
    expect(first.calls).toEqual([]);
    vi.resetModules();
    const second = await mockedCore();
    await expect(
      second.core.createGrandHallT554NativeReviewPayloadWorkbenchV2(7 as never),
    ).rejects.toThrow("must be an object");
    expect(second.calls).toEqual([]);
  });

  it("poisons concurrent construction at registry and operator await boundaries", async () => {
    let resolveRegistry: ((value: object) => void) | null = null;
    const registryPromise = new Promise<object>((resolve) => {
      resolveRegistry = resolve;
    });
    const atRegistry = await mockedCore({ registryPromise });
    const firstRegistry =
      atRegistry.core.createGrandHallT554NativeReviewPayloadWorkbenchV2(
        baseInput(),
      );
    const secondRegistry =
      atRegistry.core.createGrandHallT554NativeReviewPayloadWorkbenchV2(
        baseInput(),
      );
    (resolveRegistry as ((value: object) => void) | null)?.({});
    await expect(firstRegistry).rejects.toMatchObject({
      code: "PAYLOAD_CORE_REENTRY",
    });
    await expect(secondRegistry).rejects.toMatchObject({
      code: "PAYLOAD_CORE_REENTRY",
    });

    vi.resetModules();
    let resolveOperator: ((value: { close(): Promise<void> }) => void) | null =
      null;
    const operatorPromise = new Promise<{ close(): Promise<void> }>(
      (resolve) => {
        resolveOperator = resolve;
      },
    );
    const atOperator = await mockedCore({
      operatorPromise: operatorPromise as never,
    });
    const firstOperator =
      atOperator.core.createGrandHallT554NativeReviewPayloadWorkbenchV2(
        baseInput(),
      );
    await Promise.resolve();
    const secondOperator =
      atOperator.core.createGrandHallT554NativeReviewPayloadWorkbenchV2(
        baseInput(),
      );
    (resolveOperator as ((value: { close(): Promise<void> }) => void) | null)?.(
      atOperator.operator,
    );
    await expect(firstOperator).rejects.toMatchObject({
      code: "PAYLOAD_CORE_REENTRY",
    });
    await expect(secondOperator).rejects.toMatchObject({
      code: "PAYLOAD_CORE_REENTRY",
    });
    expect(atOperator.operator.close).toHaveBeenCalledTimes(1);
  });

  it("snapshots stateful accessors and cleans a router after late construction reentry", async () => {
    let reenterDuringRouterConstruction: (() => void) | null = null;
    const fixture = await mockedCore({
      onRouterConstruction: () => reenterDuringRouterConstruction?.(),
    });
    const input = { ...baseInput() };
    let onFatalReads = 0;
    Object.defineProperty(input, "onFatal", {
      configurable: false,
      enumerable: true,
      get: () => {
        onFatalReads += 1;
        if (onFatalReads > 1) {
          throw new Error("onFatal accessor was read more than once");
        }
        return () => undefined;
      },
    });
    let second: Promise<unknown> | null = null;
    reenterDuringRouterConstruction = () => {
      second =
        fixture.core.createGrandHallT554NativeReviewPayloadWorkbenchV2(
          baseInput(),
        );
    };

    const first =
      fixture.core.createGrandHallT554NativeReviewPayloadWorkbenchV2(input);
    await expect(first).rejects.toMatchObject({ code: "PAYLOAD_CORE_REENTRY" });
    expect(second).not.toBeNull();
    await expect(second).rejects.toMatchObject({
      code: "PAYLOAD_CORE_REENTRY",
    });
    expect(onFatalReads).toBe(1);
    expect(fixture.router.close).toHaveBeenCalledTimes(1);
  });

  it("closes the successful workbench immediately on later reentry", async () => {
    const fixture = await mockedCore();
    await fixture.core.createGrandHallT554NativeReviewPayloadWorkbenchV2(
      baseInput(),
    );
    await expect(
      fixture.core.createGrandHallT554NativeReviewPayloadWorkbenchV2(
        baseInput(),
      ),
    ).rejects.toMatchObject({ code: "PAYLOAD_CORE_REENTRY" });
    expect(fixture.router.close).toHaveBeenCalledTimes(1);
  });

  it("owns static bytes before awaited work and rejects malformed capsule output", async () => {
    let resolveRegistry: ((value: object) => void) | null = null;
    const fixture = await mockedCore({
      registryPromise: new Promise<object>((resolve) => {
        resolveRegistry = resolve;
      }),
    });
    const input = baseInput();
    const temporary = input.implementationPack.copyExactStaticAssetsV2();
    const pending =
      fixture.core.createGrandHallT554NativeReviewPayloadWorkbenchV2(input);
    temporary.documentHtml.fill(9);
    temporary.stylesheetCss.fill(9);
    temporary.applicationJavascript.fill(9);
    (resolveRegistry as ((value: object) => void) | null)?.({});
    await pending;
    const owned = fixture.receivedAssets() as {
      readonly documentHtml: Buffer;
      readonly stylesheetCss: Buffer;
      readonly applicationJavascript: Buffer;
    };
    expect(owned.documentHtml.toString()).toBe("html");
    expect(owned.stylesheetCss.toString()).toBe("css");
    expect(owned.applicationJavascript.toString()).toBe("js");

    vi.resetModules();
    let resolveOperator: ((value: { close(): Promise<void> }) => void) | null =
      null;
    const atOperator = await mockedCore({
      operatorPromise: new Promise<{ close(): Promise<void> }>((resolve) => {
        resolveOperator = resolve;
      }),
    });
    const operatorInput = baseInput();
    const operatorTemporary =
      operatorInput.implementationPack.copyExactStaticAssetsV2();
    const operatorPending =
      atOperator.core.createGrandHallT554NativeReviewPayloadWorkbenchV2(
        operatorInput,
      );
    await Promise.resolve();
    operatorTemporary.documentHtml.fill(8);
    operatorTemporary.stylesheetCss.fill(8);
    operatorTemporary.applicationJavascript.fill(8);
    (resolveOperator as ((value: { close(): Promise<void> }) => void) | null)?.(
      atOperator.operator,
    );
    await operatorPending;
    const operatorOwned = atOperator.receivedAssets() as {
      readonly documentHtml: Buffer;
      readonly stylesheetCss: Buffer;
      readonly applicationJavascript: Buffer;
    };
    expect(operatorOwned.documentHtml.toString()).toBe("html");
    expect(operatorOwned.stylesheetCss.toString()).toBe("css");
    expect(operatorOwned.applicationJavascript.toString()).toBe("js");

    vi.resetModules();
    const malformed = await mockedCore();
    const bad = {
      ...baseInput(),
      implementationPack: {
        copyExactStaticAssetsV2: () => ({
          documentHtml: Buffer.alloc(0),
          stylesheetCss: Buffer.from("css"),
          applicationJavascript: Buffer.from("js"),
        }),
      },
    };
    await expect(
      malformed.core.createGrandHallT554NativeReviewPayloadWorkbenchV2(bad),
    ).rejects.toThrow("invalid static assets");
    expect(malformed.calls).toEqual(["fixed.pack", "fixed.runtime"]);
  });

  it("zeroes recognized temporary buffers when an extra key invalidates the static shape", async () => {
    const fixture = await mockedCore();
    const temporary = {
      documentHtml: Buffer.from("html"),
      stylesheetCss: Buffer.from("css"),
      applicationJavascript: Buffer.from("js"),
      unexpected: true,
    };
    const input = {
      ...baseInput(),
      implementationPack: {
        copyExactStaticAssetsV2: () => temporary,
      },
    };

    await expect(
      fixture.core.createGrandHallT554NativeReviewPayloadWorkbenchV2(input),
    ).rejects.toThrow("invalid static assets");
    expect([...temporary.documentHtml]).toEqual([0, 0, 0, 0]);
    expect([...temporary.stylesheetCss]).toEqual([0, 0, 0]);
    expect([...temporary.applicationJavascript]).toEqual([0, 0]);
    expect(fixture.calls).toEqual(["fixed.pack", "fixed.runtime"]);
  });
});
