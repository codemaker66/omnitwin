import { describe, expect, it } from "vitest";
import {
  doesWindowsSourceSetManifestMatchExpectedDigestV1,
  type TrustedWindowsLocalVolumeEvidenceV1,
} from "@omnitwin/reconstruction-foundry";
import {
  FAIL_CLOSED_WINDOWS_NATIVE_ADAPTER_BLOCKERS_V1,
  TRUSTED_WINDOWS_NATIVE_START_RECEIPT_LIMITATIONS_V1,
  FailClosedWindowsNativeSourceAdapterV1,
  TrustedWindowsNativeSourceBasketControllerV1,
  TrustedWindowsNativeSourceBasketV1Error,
  type TrustedWindowsNativeRevalidatedStartEvidenceV1,
  type TrustedWindowsNativeRevalidatedStartRequestV1,
  type TrustedWindowsNativeRevalidatedStartScopeV1,
  type TrustedWindowsNativeFreshSourceSelectionEvidenceV1,
  type TrustedWindowsNativeOutputBoundaryResponseV1,
  type TrustedWindowsNativeSourcePickerResponseV1,
  type TrustedWindowsNativeSourceAdapterV1,
  type TrustedWindowsNativeStartReceiptV1,
  type TrustedWindowsSourceBasketEventV1,
  type TrustedWindowsSourceBasketViewV1,
} from "../trusted-windows-native-source-basket-v1.js";
import {
  TrustedWindowsNativeSourceBasketError,
  type NativeAdapterRequestV0,
  type NativePathComparisonRequestV0,
  type NativePathComparisonResponseV0,
} from "../trusted-windows-native-source-basket.js";

const SOURCE_PATH_EVIDENCE = Object.freeze({
  acquisition: "windows_native_picker_handle" as const,
  canonicalization: "final_path_by_handle" as const,
  inspectionMode: "read_only" as const,
  pathIdentityCheckedByHandle: true as const,
  reparseInspectionScope: "volume_root_through_complete_selection" as const,
  reparseInspectionComplete: true as const,
  reparsePointsEncountered: 0,
  inventoryComplete: true as const,
  regularFilesOnly: true as const,
});

const OUTPUT_PATH_EVIDENCE = Object.freeze({
  acquisition: "windows_native_output_directory_handle" as const,
  canonicalization: "final_path_by_handle" as const,
  inspectionMode: "read_only" as const,
  pathIdentityCheckedByHandle: true as const,
  directoryTypeCheckedByHandle: true as const,
  reparseInspectionScope: "volume_root_through_output_directory" as const,
  reparseInspectionComplete: true as const,
  reparsePointsEncountered: 0,
});

const LEGACY_OUTPUT_PATH_EVIDENCE = Object.freeze({
  acquisition: "trusted_launcher_output_configuration" as const,
  canonicalization: "resolved_existing_ancestor_and_validated_suffix" as const,
  inspectionMode: "read_only" as const,
  reparseInspectionScope: "volume_root_through_output_parent" as const,
  reparseInspectionComplete: true as const,
  reparsePointsEncountered: 0,
});

const ADAPTER_ID = "venviewer.windows-native-picker.v1";
const ADAPTER_BUILD_SHA256 = `sha256:${"a1".repeat(32)}`;

function identity(seed: number): { readonly volumeSerialNumberHex: string; readonly fileIdHex: string } {
  return {
    volumeSerialNumberHex: "00000000A1B2C3D4",
    fileIdHex: seed.toString(16).toUpperCase().padStart(32, "0"),
  };
}

function localVolumeEvidence(
  sourceIdentity: ReturnType<typeof identity>,
  driveType: "DRIVE_FIXED" | "DRIVE_REMOVABLE" = "DRIVE_FIXED",
): TrustedWindowsLocalVolumeEvidenceV1 {
  return {
    openedHandleFileType: "FILE_TYPE_DISK",
    volumePathResolution: "get_volume_path_name_w",
    driveTypeQuery: "get_drive_type_w",
    driveType,
    dosDeviceQuery: "query_dos_device_w",
    dosDeviceMapping: "direct_local_volume",
    dosDeviceAliasChainDetected: false,
    substTargetDetected: false,
    uncRedirectorDetected: false,
    networkDeviceTargetDetected: false,
    openedHandleVolumeCorroboration:
      "file_id_info_volume_serial_matches_opened_volume_root_handle",
    openedHandleVolumeSerialNumberHex: sourceIdentity.volumeSerialNumberHex,
    volumeRootHandleSerialNumberHex: sourceIdentity.volumeSerialNumberHex,
  };
}

function evidence(
  path: string,
  kind: "file" | "directory",
  seed: number,
  byteCountDecimal = "1024",
  fileCount = kind === "file" ? 1 : 2,
): TrustedWindowsNativeFreshSourceSelectionEvidenceV1 {
  const rootIdentity = identity(seed);
  return {
    kind,
    canonicalAbsolutePath: path,
    resolvedAbsolutePath: path,
    byteCountDecimal,
    fileCount,
    identity: rootIdentity,
    inventoryFileIdentities: kind === "file"
      ? [rootIdentity]
      : Array.from({ length: fileCount }, (_, index) => identity((seed * 1_000) + index + 1)),
    pathEvidence: SOURCE_PATH_EVIDENCE,
    localVolumeEvidence: localVolumeEvidence(rootIdentity),
  };
}

function selected(
  request: NativeAdapterRequestV0,
  selections: readonly TrustedWindowsNativeFreshSourceSelectionEvidenceV1[],
): TrustedWindowsNativeSourcePickerResponseV1 {
  if (request.operation !== "add_files" && request.operation !== "add_folder") {
    throw new Error("A picker response requires an add request.");
  }
  return {
    schemaVersion: "trusted-windows-native-adapter-response.v0",
    requestRef: request.requestRef,
    operation: request.operation,
    status: "selected",
    selections,
  };
}

function outputResolved(request: NativeAdapterRequestV0): TrustedWindowsNativeOutputBoundaryResponseV1 {
  if (request.operation !== "start") throw new Error("An output response requires start.");
  return {
    schemaVersion: "trusted-windows-native-adapter-response.v0",
    requestRef: request.requestRef,
    operation: "start",
    status: "resolved",
    outputBoundary: {
      kind: "directory",
      canonicalAbsolutePath: "D:\\Foundry Output\\Run 1",
      resolvedAbsolutePath: "D:\\Foundry Output\\Run 1",
      identity: identity(900_001),
      pathEvidence: OUTPUT_PATH_EVIDENCE,
      localVolumeEvidence: localVolumeEvidence(identity(900_001), "DRIVE_REMOVABLE"),
    },
  };
}

function legacyOutputResolved(request: NativeAdapterRequestV0): TrustedWindowsNativeOutputBoundaryResponseV1 {
  if (request.operation !== "start") throw new Error("An output response requires start.");
  const response = outputResolved(request);
  if (response.status !== "resolved") throw new Error("Expected a resolved output.");
  Object.defineProperty(response, "outputBoundary", {
    configurable: true,
    enumerable: true,
    value: {
      canonicalAbsolutePath: "D:\\Foundry Output\\Run 1",
      resolvedAbsolutePath: "D:\\Foundry Output\\Run 1",
      pathEvidence: LEGACY_OUTPUT_PATH_EVIDENCE,
    },
    writable: true,
  });
  return response;
}

function cancelled(request: NativeAdapterRequestV0): TrustedWindowsNativeSourcePickerResponseV1 {
  if (request.operation !== "add_files" && request.operation !== "add_folder") {
    throw new Error("A picker cancellation requires an add request.");
  }
  return {
    schemaVersion: "trusted-windows-native-adapter-response.v0",
    requestRef: request.requestRef,
    operation: request.operation,
    status: "cancelled",
  };
}

function compareOrdinalPaths(request: NativePathComparisonRequestV0): NativePathComparisonResponseV0 {
  const ordinalAsciiFold = (value: string): string => value.replace(/[A-Z]/gu, (character) =>
    String.fromCharCode(character.charCodeAt(0) + 32)
  );
  const left = ordinalAsciiFold(request.leftCanonicalAbsolutePath);
  const right = ordinalAsciiFold(request.rightCanonicalAbsolutePath);
  const relation = left === right
    ? "same"
    : left.startsWith(`${right}\\`)
      ? "left_descendant"
      : right.startsWith(`${left}\\`)
        ? "left_ancestor"
        : "disjoint";
  return {
    schemaVersion: "trusted-windows-native-path-comparison.v0",
    requestRef: request.requestRef,
    status: "compared",
    comparisonAuthority: "windows_compare_string_ordinal_ignore_case",
    relation,
  };
}

interface AdapterQueues {
  readonly files: Array<(request: NativeAdapterRequestV0) => TrustedWindowsNativeSourcePickerResponseV1>;
  readonly folders: Array<(request: NativeAdapterRequestV0) => TrustedWindowsNativeSourcePickerResponseV1>;
  readonly drops?: Array<(request: NativeAdapterRequestV0) => TrustedWindowsNativeSourcePickerResponseV1>;
  readonly outputs: Array<(request: NativeAdapterRequestV0) => TrustedWindowsNativeOutputBoundaryResponseV1>;
  readonly comparisons?: NativePathComparisonRequestV0[];
  readonly revalidate?: (request: TrustedWindowsNativeRevalidatedStartRequestV1) => unknown;
}

function freshComparisons(selectionCount: number): TrustedWindowsNativeRevalidatedStartEvidenceV1["nativePathComparisons"] {
  const sourcePairs: TrustedWindowsNativeRevalidatedStartEvidenceV1["nativePathComparisons"]["sourcePairs"][number][] = [];
  for (let left = 1; left <= selectionCount; left += 1) {
    for (let right = left + 1; right <= selectionCount; right += 1) {
      sourcePairs.push({ leftSelectionIndex: left, rightSelectionIndex: right, relation: "disjoint" });
    }
  }
  return {
    sourcePairs,
    outputPairs: Array.from({ length: selectionCount }, (_, index) => ({
      selectionIndex: index + 1,
      relation: "disjoint" as const,
    })),
  };
}

function freshEvidence(
  request: TrustedWindowsNativeRevalidatedStartRequestV1,
  overrides: Partial<TrustedWindowsNativeRevalidatedStartEvidenceV1> = {},
): TrustedWindowsNativeRevalidatedStartEvidenceV1 {
  return {
    schemaVersion: "trusted-windows-native-revalidated-start-evidence.v1",
    requestRef: request.requestRef,
    sessionRef: request.sessionRef,
    operation: "revalidate_start",
    adapterId: request.adapterId,
    adapterBuildSha256: request.adapterBuildSha256,
    identityComparisonMechanism: "windows_volume_serial_plus_file_id_128",
    pathComparisonMechanism: "windows_compare_string_ordinal_ignore_case",
    outputBoundary: {
      ...request.expectedOutputBoundary,
      localVolumeEvidence: localVolumeEvidence(request.expectedOutputBoundary.identity, "DRIVE_REMOVABLE"),
    },
    selections: request.expectedSelections.map((selection) => ({
      ...selection,
      localVolumeEvidence: localVolumeEvidence(selection.identity),
    })),
    nativePathComparisons: freshComparisons(request.expectedSelections.length),
    ...overrides,
  };
}

function releaseEvidence(request: TrustedWindowsNativeRevalidatedStartRequestV1) {
  return {
    schemaVersion: "trusted-windows-native-revalidated-start-release.v1" as const,
    requestRef: request.requestRef,
    sessionRef: request.sessionRef,
    operation: "release_revalidated_start" as const,
    status: "released" as const,
  };
}

function revalidatedScope(
  request: TrustedWindowsNativeRevalidatedStartRequestV1,
  scopeEvidence: unknown = freshEvidence(request),
  release: () => Promise<ReturnType<typeof releaseEvidence>> =
    () => Promise.resolve(releaseEvidence(request)),
): TrustedWindowsNativeRevalidatedStartScopeV1 {
  return {
    evidence: scopeEvidence as TrustedWindowsNativeRevalidatedStartEvidenceV1,
    release,
  };
}

function queuedAdapter(queues: AdapterQueues): TrustedWindowsNativeSourceAdapterV1 {
  return {
    pickFiles(request) {
      const next = queues.files.shift();
      return next === undefined
        ? Promise.reject(new Error("No file response was queued."))
        : Promise.resolve(next(request));
    },
    pickFolder(request) {
      const next = queues.folders.shift();
      return next === undefined
        ? Promise.reject(new Error("No folder response was queued."))
        : Promise.resolve(next(request));
    },
    dropSources(request) {
      const next = queues.drops?.shift();
      return next === undefined
        ? Promise.reject(new Error("No dropped-source response was queued."))
        : Promise.resolve(next(request));
    },
    resolveOutputBoundary(request) {
      const next = queues.outputs.shift();
      return next === undefined
        ? Promise.reject(new Error("No output response was queued."))
        : Promise.resolve(next(request));
    },
    compareCanonicalPaths(request) {
      queues.comparisons?.push(request);
      return Promise.resolve(compareOrdinalPaths(request));
    },
    async openRevalidatedStartScope(request) {
      if (queues.revalidate !== undefined) {
        return await queues.revalidate(request) as TrustedWindowsNativeRevalidatedStartScopeV1;
      }
      return revalidatedScope(request);
    },
  };
}

function deterministicRandomBytes(seed = 1): (size: number) => Uint8Array {
  let invocation = 0;
  return (size) => {
    invocation += 1;
    return Uint8Array.from(
      { length: size },
      (_, index) => ((seed + invocation + index) % 254) + 1,
    );
  };
}

function event(
  view: TrustedWindowsSourceBasketViewV1,
  action: TrustedWindowsSourceBasketEventV1["action"],
  basketPosition?: number,
): TrustedWindowsSourceBasketEventV1 {
  if (view.nextEvent === null) throw new Error("The basket has no next event binding.");
  return action === "remove"
    ? { ...view.nextEvent, action, basketPosition: basketPosition ?? 1 }
    : { ...view.nextEvent, action };
}

function controllerErrorCode(error: unknown): string | undefined {
  if (error instanceof TrustedWindowsNativeSourceBasketError) return error.code;
  if (error instanceof TrustedWindowsNativeSourceBasketV1Error) return error.code;
  return undefined;
}

async function expectRejectsCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (error: unknown) {
    expect(controllerErrorCode(error)).toBe(code);
    if (error instanceof Error) {
      expect(error.message).not.toMatch(/[A-Z]:\\/u);
      expect(error.message).not.toContain("\\");
    }
    return;
  }
  throw new Error(`Expected controller error ${code}.`);
}

describe("trusted Windows native source basket controller V1", () => {
  it("derives the complete final V1 input, manifest, and controller-authenticated receipt", async () => {
    const first = evidence("C:\\Private Client\\Reception.e57", "file", 1, "8000000000");
    const second = evidence("C:\\Private Client\\Reception.obj", "file", 2, "700000000");
    const comparisons: NativePathComparisonRequestV0[] = [];
    let handlesHeld = false;
    let releaseCalls = 0;
    const adapter = queuedAdapter({
      files: [(request) => selected(request, [first, second])],
      folders: [],
      outputs: [outputResolved],
      comparisons,
      revalidate(request, ...extraArguments: never[]) {
        expect(extraArguments).toHaveLength(0);
        expect(request).toMatchObject({
          schemaVersion: "trusted-windows-native-revalidated-start-request.v1",
          sessionRef: expect.stringMatching(/^basket_[a-f0-9]{32}$/u),
          operation: "revalidate_start",
          adapterId: ADAPTER_ID,
          adapterBuildSha256: ADAPTER_BUILD_SHA256,
          readOnly: true,
          browserPathInputAccepted: false,
        });
        expect(request.expectedSelections).toEqual([first, second]);
        expect(request.expectedOutputBoundary.kind).toBe("directory");
        expect(Object.isFrozen(request)).toBe(true);
        handlesHeld = true;
        return revalidatedScope(request, freshEvidence(request), () => {
          releaseCalls += 1;
          handlesHeld = false;
          return Promise.resolve(releaseEvidence(request));
        });
      },
    });
    let received: Parameters<
      NonNullable<ConstructorParameters<typeof TrustedWindowsNativeSourceBasketControllerV1>[0]["acceptTrustedStartInput"]>
    > | undefined;
    const basket = new TrustedWindowsNativeSourceBasketControllerV1({
      adapter,
      adapterId: ADAPTER_ID,
      trustedAdapterBuildSha256: ADAPTER_BUILD_SHA256,
      randomBytes: deterministicRandomBytes(),
      acceptTrustedStartInput(input, manifest, receipt, receiptGuard) {
        expect(handlesHeld).toBe(true);
        received = [input, manifest, receipt, receiptGuard];
        expect(doesWindowsSourceSetManifestMatchExpectedDigestV1(
          manifest,
          receipt.expectedManifestDigestSha256,
        )).toBe(true);
        expect(receiptGuard.consume(receipt)).toBe(true);
        expect(receiptGuard.consume(receipt)).toBe(false);
      },
    });

    const added = await basket.dispatch(event(basket.getView(), "add_files"));
    expect(added.view.sources.map((source) => source.label)).toEqual(["File 1", "File 2"]);
    const started = await basket.dispatch(event(added.view, "start"));

    expect(started.status).toBe("started");
    expect(handlesHeld).toBe(false);
    expect(releaseCalls).toBe(1);
    expect("withRevalidatedStart" in adapter).toBe(false);
    expect(comparisons).toHaveLength(3);
    if (received === undefined) throw new Error("The native sink was not called.");
    const [input, manifest, receipt] = received;
    expect(input.selections.map((selection) => selection.inventoryFileIdentities)).toEqual([
      first.inventoryFileIdentities,
      second.inventoryFileIdentities,
    ]);
    expect(input.selections.map((selection) => selection.localVolumeEvidence)).toEqual([
      first.localVolumeEvidence,
      second.localVolumeEvidence,
    ]);
    expect(input.outputBoundary.localVolumeEvidence.driveType).toBe("DRIVE_REMOVABLE");
    expect(input.nativePathComparisons).toEqual({
      sourcePairs: [{ leftSelectionIndex: 1, rightSelectionIndex: 2, relation: "disjoint" }],
      outputPairs: [
        { selectionIndex: 1, relation: "disjoint" },
        { selectionIndex: 2, relation: "disjoint" },
      ],
    });
    expect(input.adapterEvidence).toMatchObject({
      adapterId: ADAPTER_ID,
      adapterBuildSha256: ADAPTER_BUILD_SHA256,
      identityComparisonMechanism: "windows_volume_serial_plus_file_id_128",
      pathComparisonMechanism: "windows_compare_string_ordinal_ignore_case",
    });
    expect(manifest.authority).toBe("none");
    expect(manifest.use).toBe("inspection_only");
    expect(receipt).toMatchObject({
      schemaVersion: "trusted-windows-native-start-receipt.v1",
      expectedManifestDigestSha256: manifest.manifestDigestSha256,
      adapterBuildSha256: ADAPTER_BUILD_SHA256,
      selectedRoots: 2,
      discoveredFiles: 2,
      totalBytesDecimal: "8700000000",
      issuedRevision: 2,
      authentication: "controller_authenticated",
      authority: "none",
      use: "inspection_only",
    });
    expect(Object.keys(receipt)).toEqual([
      "schemaVersion", "receiptRef", "sessionRef", "expectedManifestDigestSha256",
      "adapterBuildSha256", "selectedRoots", "discoveredFiles", "totalBytesDecimal",
      "issuedRevision", "authentication", "authority", "use", "authenticationHmacSha256",
    ]);
    expect(JSON.stringify(receipt)).not.toMatch(/fresh|unchanged|reopen|execution|publication/iu);
    expect(TRUSTED_WINDOWS_NATIVE_START_RECEIPT_LIMITATIONS_V1).toContain(
      "The receipt does not attest that source bytes stayed unchanged after the retained handle scope is released.",
    );
    expect(basket.verifyAndConsumeTrustedStartReceipt(receipt)).toBe(false);
  });

  it("makes a resolved response without an own callable release terminally uncertain", async () => {
    const attacks: readonly NonNullable<AdapterQueues["revalidate"]>[] = [
      () => undefined,
      () => true,
      (request) => ({ evidence: freshEvidence(request) }),
    ];

    for (const attack of attacks) {
      let sinkCalls = 0;
      const basket = new TrustedWindowsNativeSourceBasketControllerV1({
        adapter: queuedAdapter({
          files: [(request) => selected(request, [
            evidence("C:\\Capture\\Reception.e57", "file", 1),
          ])],
          folders: [],
          outputs: [outputResolved],
          revalidate: attack,
        }),
        adapterId: ADAPTER_ID,
        trustedAdapterBuildSha256: ADAPTER_BUILD_SHA256,
        randomBytes: deterministicRandomBytes(31),
        acceptTrustedStartInput() { sinkCalls += 1; },
      });
      const added = await basket.dispatch(event(basket.getView(), "add_files"));
      const uncertain = await basket.dispatch(event(added.view, "start"));
      expect(uncertain.status).toBe("start_uncertain");
      expect(uncertain.view.status).toBe("start_uncertain");
      expect(uncertain.view.nextEvent).toBeNull();
      expect(sinkCalls).toBe(0);
    }
  });

  it("does not invoke an unsafe teardown-code getter or relabel an ordinary open rejection", async () => {
    const privateText = "C:\\Private Client\\Reception.e57";
    const rejection = new Error(privateText);
    let getterCalls = 0;
    Object.defineProperty(rejection, "code", {
      configurable: true,
      enumerable: true,
      get() {
        getterCalls += 1;
        return "HELPER_TEARDOWN_UNCONFIRMED";
      },
    });
    const basket = new TrustedWindowsNativeSourceBasketControllerV1({
      adapter: queuedAdapter({
        files: [(request) => selected(request, [
          evidence("C:\\Capture\\Reception.e57", "file", 101),
        ])],
        folders: [],
        outputs: [outputResolved],
        revalidate() {
          return Promise.reject(rejection);
        },
      }),
      adapterId: ADAPTER_ID,
      trustedAdapterBuildSha256: ADAPTER_BUILD_SHA256,
      randomBytes: deterministicRandomBytes(82),
      acceptTrustedStartInput() {
        throw new Error("The sink must not run after an open rejection.");
      },
    });
    const added = await basket.dispatch(event(basket.getView(), "add_files"));

    await expectRejectsCode(
      basket.dispatch(event(added.view, "start")),
      "PRIVATE_EVIDENCE_MISMATCH",
    );
    expect(getterCalls).toBe(0);
    expect(basket.getView()).toMatchObject({ status: "cancelled", nextEvent: null });
  });

  it("releases malformed candidate scopes once before rejecting their strict envelope", async () => {
    const attacks: readonly ((
      request: TrustedWindowsNativeRevalidatedStartRequestV1,
      released: () => void,
    ) => unknown)[] = [
      (request, released) => revalidatedScope(request, {
        schemaVersion: "trusted-windows-native-revalidated-start-evidence.v1",
        requestRef: request.requestRef,
      }, () => {
        released();
        return Promise.resolve(releaseEvidence(request));
      }),
      (request, released) => ({
        ...revalidatedScope(request, freshEvidence(request), () => {
          released();
          return Promise.resolve(releaseEvidence(request));
        }),
        unexpected: true,
      }),
    ];

    for (const attack of attacks) {
      let releaseCalls = 0;
      let sinkCalls = 0;
      const basket = new TrustedWindowsNativeSourceBasketControllerV1({
        adapter: queuedAdapter({
          files: [(request) => selected(request, [
            evidence("C:\\Capture\\Reception.e57", "file", 2),
          ])],
          folders: [],
          outputs: [outputResolved],
          revalidate(request) {
            return attack(request, () => { releaseCalls += 1; });
          },
        }),
        adapterId: ADAPTER_ID,
        trustedAdapterBuildSha256: ADAPTER_BUILD_SHA256,
        randomBytes: deterministicRandomBytes(32),
        acceptTrustedStartInput() { sinkCalls += 1; },
      });
      const added = await basket.dispatch(event(basket.getView(), "add_files"));
      await expectRejectsCode(
        basket.dispatch(event(added.view, "start")),
        "PRIVATE_EVIDENCE_MISMATCH",
      );
      expect(releaseCalls).toBe(1);
      expect(sinkCalls).toBe(0);
      expect(basket.getView().status).toBe("cancelled");
    }
  });

  it("lets a missing or forged release acknowledgement dominate pre-sink evidence errors", async () => {
    const releases: readonly ((
      request: TrustedWindowsNativeRevalidatedStartRequestV1,
    ) => Promise<unknown>)[] = [
      () => Promise.reject(new Error("Release failed.")),
      (request) => Promise.resolve({ ...releaseEvidence(request), requestRef: "forged" }),
    ];

    for (const release of releases) {
      let releaseCalls = 0;
      let sinkCalls = 0;
      const basket = new TrustedWindowsNativeSourceBasketControllerV1({
        adapter: queuedAdapter({
          files: [(request) => selected(request, [
            evidence("C:\\Capture\\Reception.e57", "file", 3),
          ])],
          folders: [],
          outputs: [outputResolved],
          revalidate(request) {
            return revalidatedScope(request, { malformed: true }, async () => {
              releaseCalls += 1;
              return await release(request) as ReturnType<typeof releaseEvidence>;
            });
          },
        }),
        adapterId: ADAPTER_ID,
        trustedAdapterBuildSha256: ADAPTER_BUILD_SHA256,
        randomBytes: deterministicRandomBytes(33),
        acceptTrustedStartInput() { sinkCalls += 1; },
      });
      const added = await basket.dispatch(event(basket.getView(), "add_files"));
      const uncertain = await basket.dispatch(event(added.view, "start"));
      expect(uncertain.status).toBe("start_uncertain");
      expect(uncertain.view.status).toBe("start_uncertain");
      expect(releaseCalls).toBe(1);
      expect(sinkCalls).toBe(0);
    }
  });

  it("poisons changed or mis-bound fresh evidence before receipt issuance", async () => {
    const attacks: ReadonlyArray<{
      readonly evidenceFor: (
        request: TrustedWindowsNativeRevalidatedStartRequestV1,
      ) => TrustedWindowsNativeRevalidatedStartEvidenceV1;
    }> = [
      {
        evidenceFor: (request) => freshEvidence(request, { requestRef: "revalidated_start_forged" }),
      },
      {
        evidenceFor: (request) => {
          const complete = freshEvidence(request);
          return { ...complete, selections: [...complete.selections].reverse() };
        },
      },
      {
        evidenceFor: (request) => {
          const complete = freshEvidence(request);
          return {
            ...complete,
            selections: complete.selections.map((selection, index) => index === 0
              ? { ...selection, byteCountDecimal: "1025" }
              : selection),
          };
        },
      },
      {
        evidenceFor: (request) => {
          const complete = freshEvidence(request);
          const changedIdentity = identity(900_002);
          return {
            ...complete,
            outputBoundary: {
              ...complete.outputBoundary,
              identity: changedIdentity,
              localVolumeEvidence: localVolumeEvidence(changedIdentity),
            },
          };
        },
      },
      {
        evidenceFor: (request) => {
          const complete = freshEvidence(request);
          return {
            ...complete,
            nativePathComparisons: {
              ...complete.nativePathComparisons,
              outputPairs: complete.nativePathComparisons.outputPairs.slice(1),
            },
          };
        },
      },
    ];

    for (const attack of attacks) {
      let sinkCalls = 0;
      const basket = new TrustedWindowsNativeSourceBasketControllerV1({
        adapter: queuedAdapter({
          files: [(request) => selected(request, [
            evidence("C:\\Capture\\First.e57", "file", 1),
            evidence("C:\\Capture\\Second.e57", "file", 2),
          ])],
          folders: [],
          outputs: [outputResolved],
          revalidate(request) {
            return revalidatedScope(request, attack.evidenceFor(request));
          },
        }),
        adapterId: ADAPTER_ID,
        trustedAdapterBuildSha256: ADAPTER_BUILD_SHA256,
        randomBytes: deterministicRandomBytes(37),
        acceptTrustedStartInput() { sinkCalls += 1; },
      });
      const added = await basket.dispatch(event(basket.getView(), "add_files"));
      await expectRejectsCode(
        basket.dispatch(event(added.view, "start")),
        "PRIVATE_EVIDENCE_MISMATCH",
      );
      expect(sinkCalls).toBe(0);
      expect(basket.getView().status).toBe("cancelled");
    }
  });

  it("rejects V0 suffix-configured output semantics before revalidation", async () => {
    let revalidationCalls = 0;
    let sinkCalls = 0;
    const basket = new TrustedWindowsNativeSourceBasketControllerV1({
      adapter: queuedAdapter({
        files: [(request) => selected(request, [
          evidence("C:\\Capture\\Reception.e57", "file", 1),
        ])],
        folders: [],
        outputs: [legacyOutputResolved],
        revalidate(request) {
          revalidationCalls += 1;
          return revalidatedScope(request);
        },
      }),
      adapterId: ADAPTER_ID,
      trustedAdapterBuildSha256: ADAPTER_BUILD_SHA256,
      randomBytes: deterministicRandomBytes(41),
      acceptTrustedStartInput() { sinkCalls += 1; },
    });
    const added = await basket.dispatch(event(basket.getView(), "add_files"));
    await expectRejectsCode(
      basket.dispatch(event(added.view, "start")),
      "PRIVATE_EVIDENCE_MISMATCH",
    );
    expect(revalidationCalls).toBe(0);
    expect(sinkCalls).toBe(0);
    expect(basket.getView().status).toBe("cancelled");
  });

  it("rejects a cross-path output alias with the same Windows identity before revalidation", async () => {
    const source = evidence("C:\\Capture\\Reception", "directory", 61);
    let revalidationCalls = 0;
    let sinkCalls = 0;
    const basket = new TrustedWindowsNativeSourceBasketControllerV1({
      adapter: queuedAdapter({
        files: [],
        folders: [(request) => selected(request, [source])],
        outputs: [(request) => {
          const response = outputResolved(request);
          if (response.status !== "resolved") throw new Error("Expected a resolved output.");
          return {
            ...response,
            outputBoundary: {
              ...response.outputBoundary,
              canonicalAbsolutePath: "E:\\Alias\\Different Name",
              resolvedAbsolutePath: "E:\\Alias\\Different Name",
              identity: source.identity,
              localVolumeEvidence: source.localVolumeEvidence,
            },
          };
        }],
        revalidate(request) {
          revalidationCalls += 1;
          return revalidatedScope(request);
        },
      }),
      adapterId: ADAPTER_ID,
      trustedAdapterBuildSha256: ADAPTER_BUILD_SHA256,
      randomBytes: deterministicRandomBytes(67),
      acceptTrustedStartInput() { sinkCalls += 1; },
    });
    const added = await basket.dispatch(event(basket.getView(), "add_folder"));
    await expectRejectsCode(
      basket.dispatch(event(added.view, "start")),
      "PRIVATE_EVIDENCE_MISMATCH",
    );
    expect(revalidationCalls).toBe(0);
    expect(sinkCalls).toBe(0);
    expect(basket.getView().status).toBe("cancelled");
  });

  it("rejects an initial empty-directory selection whose file count is negative zero", async () => {
    let sinkCalls = 0;
    const empty = evidence("C:\\Capture\\Empty", "directory", 70, "0", 0);
    const basket = new TrustedWindowsNativeSourceBasketControllerV1({
      adapter: queuedAdapter({
        files: [],
        folders: [(request) => selected(request, [{ ...empty, fileCount: -0 }])],
        outputs: [],
      }),
      adapterId: ADAPTER_ID,
      trustedAdapterBuildSha256: ADAPTER_BUILD_SHA256,
      randomBytes: deterministicRandomBytes(71),
      acceptTrustedStartInput() { sinkCalls += 1; },
    });

    await expectRejectsCode(
      basket.dispatch(event(basket.getView(), "add_folder")),
      "FORGED_ADAPTER_RESULT",
    );
    expect(basket.getView().sources).toEqual([]);
    expect(sinkCalls).toBe(0);
  });

  it("rejects missing, forged, and network local-volume evidence at initial selection", async () => {
    const valid = evidence("C:\\Capture\\Reception.e57", "file", 71);
    const { localVolumeEvidence: _missing, ...withoutVolume } = valid;
    const attacks: readonly unknown[] = [
      withoutVolume,
      {
        ...valid,
        localVolumeEvidence: {
          ...valid.localVolumeEvidence,
          openedHandleFileType: "FILE_TYPE_PIPE",
        },
      },
      {
        ...valid,
        localVolumeEvidence: {
          ...valid.localVolumeEvidence,
          driveType: "DRIVE_REMOTE",
          networkDeviceTargetDetected: true,
        },
      },
    ];
    for (const attack of attacks) {
      let sinkCalls = 0;
      const basket = new TrustedWindowsNativeSourceBasketControllerV1({
        adapter: queuedAdapter({
          files: [(request) => selected(request, [
            attack as TrustedWindowsNativeFreshSourceSelectionEvidenceV1,
          ])],
          folders: [],
          outputs: [],
        }),
        adapterId: ADAPTER_ID,
        trustedAdapterBuildSha256: ADAPTER_BUILD_SHA256,
        randomBytes: deterministicRandomBytes(73),
        acceptTrustedStartInput() { sinkCalls += 1; },
      });
      await expectRejectsCode(
        basket.dispatch(event(basket.getView(), "add_files")),
        "PRIVATE_EVIDENCE_MISMATCH",
      );
      expect(sinkCalls).toBe(0);
      expect(basket.getView().status).toBe("cancelled");
    }
  });

  it("requires unchanged exact local-volume proof during fresh revalidation", async () => {
    const attacks: ReadonlyArray<(
      complete: TrustedWindowsNativeRevalidatedStartEvidenceV1,
    ) => TrustedWindowsNativeRevalidatedStartEvidenceV1> = [
      (complete) => ({
        ...complete,
        selections: complete.selections.map((selection, index) => index === 0
          ? {
              ...selection,
              localVolumeEvidence: {
                ...selection.localVolumeEvidence,
                dosDeviceMapping: "subst_alias" as "direct_local_volume",
                substTargetDetected: true as false,
              },
            }
          : selection),
      }),
      (complete) => ({
        ...complete,
        outputBoundary: {
          ...complete.outputBoundary,
          localVolumeEvidence: {
            ...complete.outputBoundary.localVolumeEvidence,
            driveType: "DRIVE_REMOTE" as "DRIVE_FIXED",
            networkDeviceTargetDetected: true as false,
          },
        },
      }),
    ];
    for (const attack of attacks) {
      let releaseCalls = 0;
      let sinkCalls = 0;
      const basket = new TrustedWindowsNativeSourceBasketControllerV1({
        adapter: queuedAdapter({
          files: [(request) => selected(request, [
            evidence("C:\\Capture\\Reception.e57", "file", 81),
          ])],
          folders: [],
          outputs: [outputResolved],
          revalidate(request) {
            return revalidatedScope(request, attack(freshEvidence(request)), () => {
              releaseCalls += 1;
              return Promise.resolve(releaseEvidence(request));
            });
          },
        }),
        adapterId: ADAPTER_ID,
        trustedAdapterBuildSha256: ADAPTER_BUILD_SHA256,
        randomBytes: deterministicRandomBytes(83),
        acceptTrustedStartInput() { sinkCalls += 1; },
      });
      const added = await basket.dispatch(event(basket.getView(), "add_files"));
      await expectRejectsCode(
        basket.dispatch(event(added.view, "start")),
        "PRIVATE_EVIDENCE_MISMATCH",
      );
      expect(releaseCalls).toBe(1);
      expect(sinkCalls).toBe(0);
      expect(basket.getView().status).toBe("cancelled");
    }
  });

  it("maps release failure after sink entry to terminal start_uncertain", async () => {
    let sinkCalls = 0;
    let releaseCalls = 0;
    let handlesHeld = false;
    const basket = new TrustedWindowsNativeSourceBasketControllerV1({
      adapter: queuedAdapter({
        files: [(request) => selected(request, [
          evidence("C:\\Capture\\Reception.e57", "file", 91),
        ])],
        folders: [],
        outputs: [outputResolved],
        revalidate(request) {
          handlesHeld = true;
          return revalidatedScope(request, freshEvidence(request), () => {
            releaseCalls += 1;
            return Promise.reject(new Error("Release confirmation failed."));
          });
        },
      }),
      adapterId: ADAPTER_ID,
      trustedAdapterBuildSha256: ADAPTER_BUILD_SHA256,
      randomBytes: deterministicRandomBytes(89),
      acceptTrustedStartInput(_input, _manifest, receipt, receiptGuard) {
        sinkCalls += 1;
        expect(handlesHeld).toBe(true);
        expect(receiptGuard.consume(receipt)).toBe(true);
      },
    });
    const added = await basket.dispatch(event(basket.getView(), "add_files"));
    const uncertain = await basket.dispatch(event(added.view, "start"));
    expect(uncertain.status).toBe("start_uncertain");
    expect(uncertain.view.status).toBe("start_uncertain");
    expect(uncertain.view.nextEvent).toBeNull();
    expect(sinkCalls).toBe(1);
    expect(releaseCalls).toBe(1);
    expect(handlesHeld).toBe(true);
  });

  it("rejects selections above the V1 per-selection and total 100,000-file caps", async () => {
    let perSelectionSinkCalls = 0;
    const perSelectionBasket = new TrustedWindowsNativeSourceBasketControllerV1({
      adapter: queuedAdapter({
        files: [],
        folders: [(request) => selected(request, [
          evidence("C:\\Capture\\Oversized", "directory", 100, "0", 100_001),
        ])],
        outputs: [],
      }),
      adapterId: ADAPTER_ID,
      trustedAdapterBuildSha256: ADAPTER_BUILD_SHA256,
      randomBytes: deterministicRandomBytes(43),
      acceptTrustedStartInput() { perSelectionSinkCalls += 1; },
    });
    const perSelectionRejected = await perSelectionBasket.dispatch(
      event(perSelectionBasket.getView(), "add_folder"),
    );
    expect(perSelectionRejected.status).toBe("selection_rejected");
    expect(perSelectionRejected.code).toBe("SOURCE_SET_LIMIT");
    expect(perSelectionRejected.view.totals.discoveredFiles).toBe(0);
    expect(perSelectionSinkCalls).toBe(0);

    let totalSinkCalls = 0;
    const totalBasket = new TrustedWindowsNativeSourceBasketControllerV1({
      adapter: queuedAdapter({
        files: [],
        folders: [
          (request) => selected(request, [
            evidence("C:\\Capture\\First", "directory", 200, "0", 50_001),
          ]),
          (request) => selected(request, [
            evidence("D:\\Capture\\Second", "directory", 300, "0", 50_000),
          ]),
        ],
        outputs: [],
      }),
      adapterId: ADAPTER_ID,
      trustedAdapterBuildSha256: ADAPTER_BUILD_SHA256,
      randomBytes: deterministicRandomBytes(47),
      acceptTrustedStartInput() { totalSinkCalls += 1; },
    });
    const firstAccepted = await totalBasket.dispatch(event(totalBasket.getView(), "add_folder"));
    expect(firstAccepted.status).toBe("updated");
    expect(firstAccepted.view.totals.discoveredFiles).toBe(50_001);
    const totalRejected = await totalBasket.dispatch(event(firstAccepted.view, "add_folder"));
    expect(totalRejected.status).toBe("selection_rejected");
    expect(totalRejected.code).toBe("SOURCE_SET_LIMIT");
    expect(totalRejected.view.totals.discoveredFiles).toBe(50_001);
    expect(totalSinkCalls).toBe(0);
  });

  it("makes every browser DTO structurally filename-free and digest-free", async () => {
    const source = evidence("C:\\Users\\Blake\\Private Client\\Reception.e57", "file", 17);
    const adapter = queuedAdapter({
      files: [(request) => selected(request, [source])],
      folders: [],
      outputs: [outputResolved],
    });
    let privateNonce = "";
    let privateReceipt: TrustedWindowsNativeStartReceiptV1 | undefined;
    const basket = new TrustedWindowsNativeSourceBasketControllerV1({
      adapter,
      adapterId: ADAPTER_ID,
      trustedAdapterBuildSha256: ADAPTER_BUILD_SHA256,
      randomBytes: deterministicRandomBytes(8),
      acceptTrustedStartInput(input, _manifest, receipt, receiptGuard) {
        privateNonce = input.sessionNonceHex;
        privateReceipt = receipt;
        expect(receiptGuard.consume(receipt)).toBe(true);
      },
    });

    const added = await basket.dispatch(event(basket.getView(), "add_files"));
    expect(added.view.sources).toEqual([{
      basketPosition: 1,
      kind: "file",
      label: "File 1",
      labelSafety: "generated_kind_and_position_only",
      fileCount: 1,
      byteCountDecimal: "1024",
    }]);
    expect(Object.keys(added.view.sources[0] ?? {})).toEqual([
      "basketPosition", "kind", "label", "labelSafety", "fileCount", "byteCountDecimal",
    ]);
    const started = await basket.dispatch(event(added.view, "start"));
    const serialized = JSON.stringify({ added, started });

    expect(serialized).not.toContain("C:\\");
    expect(serialized).not.toContain("Reception.e57");
    expect(serialized).not.toContain("Private Client");
    expect(serialized).not.toContain(source.identity.fileIdHex);
    expect(serialized).not.toContain(privateNonce);
    expect(serialized).not.toContain(ADAPTER_ID);
    expect(serialized).not.toContain(ADAPTER_BUILD_SHA256);
    expect(serialized).not.toContain(privateReceipt?.receiptRef);
    expect(serialized).not.toContain(privateReceipt?.expectedManifestDigestSha256);
    expect(serialized).not.toMatch(/sourceRef|displayName|manifest|receipt|Hmac|identitySet|transcript/iu);
  });

  it("derives only the final basket after a middle removal and a later addition", async () => {
    const retainedFirst = evidence("C:\\Capture\\First.e57", "file", 1, "100");
    const removedMiddle = evidence("C:\\Capture\\Remove Me.e57", "file", 2, "200");
    const retainedLast = evidence("C:\\Capture\\Third.e57", "file", 3, "300");
    const addedLater = evidence("E:\\Later\\Fourth.e57", "file", 4, "400");
    const comparisons: NativePathComparisonRequestV0[] = [];
    const adapter = queuedAdapter({
      files: [
        (request) => selected(request, [retainedFirst, removedMiddle, retainedLast]),
        (request) => selected(request, [addedLater]),
      ],
      folders: [],
      outputs: [outputResolved],
      comparisons,
    });
    let finalInput: Parameters<
      ConstructorParameters<typeof TrustedWindowsNativeSourceBasketControllerV1>[0]["acceptTrustedStartInput"]
    >[0] | undefined;
    let finalManifest: Parameters<
      ConstructorParameters<typeof TrustedWindowsNativeSourceBasketControllerV1>[0]["acceptTrustedStartInput"]
    >[1] | undefined;
    const basket = new TrustedWindowsNativeSourceBasketControllerV1({
      adapter,
      adapterId: ADAPTER_ID,
      trustedAdapterBuildSha256: ADAPTER_BUILD_SHA256,
      randomBytes: deterministicRandomBytes(12),
      acceptTrustedStartInput(input, manifest, receipt, receiptGuard) {
        finalInput = input;
        finalManifest = manifest;
        expect(receiptGuard.consume(receipt)).toBe(true);
      },
    });

    const firstAdd = await basket.dispatch(event(basket.getView(), "add_files"));
    const removed = await basket.dispatch(event(firstAdd.view, "remove", 2));
    expect(removed.view.sources.map((source) => source.label)).toEqual(["File 1", "File 2"]);
    const laterAdd = await basket.dispatch(event(removed.view, "add_files"));
    expect(laterAdd.view.sources.map((source) => source.label)).toEqual([
      "File 1", "File 2", "File 3",
    ]);
    const started = await basket.dispatch(event(laterAdd.view, "start"));

    expect(started.status).toBe("started");
    if (finalInput === undefined || finalManifest === undefined) {
      throw new Error("The final native handoff was not captured.");
    }
    expect(finalInput.selections.map((selection) => selection.canonicalAbsolutePath)).toEqual([
      retainedFirst.canonicalAbsolutePath,
      retainedLast.canonicalAbsolutePath,
      addedLater.canonicalAbsolutePath,
    ]);
    expect(JSON.stringify(finalInput)).not.toContain(removedMiddle.canonicalAbsolutePath);
    expect(JSON.stringify(finalInput)).not.toContain(removedMiddle.identity.fileIdHex);
    expect(finalInput.nativePathComparisons.sourcePairs).toHaveLength(3);
    expect(finalInput.nativePathComparisons.outputPairs).toHaveLength(3);
    expect(finalManifest.nativeEvidence.sourcePairCount).toBe(3);
    expect(finalManifest.totals).toMatchObject({
      selectedRoots: 3,
      discoveredFiles: 3,
      totalBytesDecimal: "800",
      inventoryIdentityCount: 3,
    });
    expect(comparisons).toHaveLength(8);
  });

  it("keeps native ordinal comparisons authoritative for Unicode-divergent paths", async () => {
    expect("K".toLocaleLowerCase("en-US")).toBe("k");
    let acceptedPaths: readonly string[] = [];
    const basket = new TrustedWindowsNativeSourceBasketControllerV1({
      adapter: queuedAdapter({
        files: [(request) => selected(request, [
          evidence("C:\\Capture\\K.e57", "file", 101),
          evidence("C:\\Capture\\K.e57", "file", 102),
        ])],
        folders: [],
        outputs: [outputResolved],
      }),
      adapterId: ADAPTER_ID,
      trustedAdapterBuildSha256: ADAPTER_BUILD_SHA256,
      randomBytes: deterministicRandomBytes(103),
      acceptTrustedStartInput(input, _manifest, receipt, receiptGuard) {
        acceptedPaths = input.selections.map((selection) => selection.canonicalAbsolutePath);
        expect(receiptGuard.consume(receipt)).toBe(true);
      },
    });
    const added = await basket.dispatch(event(basket.getView(), "add_files"));
    expect(added.status).toBe("updated");
    const started = await basket.dispatch(event(added.view, "start"));
    expect(started.status).toBe("started");
    expect(acceptedPaths).toEqual(["C:\\Capture\\K.e57", "C:\\Capture\\K.e57"]);
  });

  it("rejects forged and stale events without invoking getters or accepting __proto__", async () => {
    const adapter = queuedAdapter({
      files: [(request) => selected(request, [evidence("C:\\Capture\\Reception.e57", "file", 1)])],
      folders: [],
      outputs: [],
    });
    const basket = new TrustedWindowsNativeSourceBasketControllerV1({
      adapter,
      adapterId: ADAPTER_ID,
      trustedAdapterBuildSha256: ADAPTER_BUILD_SHA256,
      randomBytes: deterministicRandomBytes(),
      acceptTrustedStartInput() { throw new Error("The sink must not run."); },
    });
    const valid = event(basket.getView(), "add_files");
    await expectRejectsCode(basket.dispatch({ ...valid, path: "C:\\forged.e57" }), "FORGED_EVENT");
    await expectRejectsCode(
      basket.dispatch({ ...valid, sessionRef: "basket_forged" }),
      "FORGED_EVENT",
    );
    await expectRejectsCode(
      basket.dispatch({ ...valid, eventToken: "evt_forged" }),
      "FORGED_EVENT",
    );
    await expectRejectsCode(basket.dispatch({ ...valid, revision: -0 }), "FORGED_EVENT");
    await expectRejectsCode(basket.dispatch({
      ...valid,
      action: "remove",
      basketPosition: -0,
    }), "FORGED_EVENT");
    const protoEvent = { ...valid, ["__proto__"]: { poisoned: true } };
    await expectRejectsCode(basket.dispatch(protoEvent), "FORGED_EVENT");

    let getterCalled = false;
    const accessorEvent = { ...valid };
    Object.defineProperty(accessorEvent, "eventToken", {
      enumerable: true,
      get() {
        getterCalled = true;
        throw new Error("The getter must not run.");
      },
    });
    await expectRejectsCode(basket.dispatch(accessorEvent), "FORGED_EVENT");
    expect(getterCalled).toBe(false);

    const added = await basket.dispatch(valid);
    expect(added.status).toBe("updated");
    await expectRejectsCode(basket.dispatch(valid), "STALE_EVENT");
  });

  it("strictly authenticates one receipt once and rejects mutation, cross-session use, and replay", async () => {
    const adapter = queuedAdapter({
      files: [],
      folders: [(request) => selected(request, [
        evidence("C:\\Capture\\Empty", "directory", 1, "0", 0),
      ])],
      outputs: [outputResolved],
    });
    const other = new TrustedWindowsNativeSourceBasketControllerV1({
      adapter: new FailClosedWindowsNativeSourceAdapterV1(),
      adapterId: ADAPTER_ID,
      trustedAdapterBuildSha256: ADAPTER_BUILD_SHA256,
      randomBytes: deterministicRandomBytes(40),
      acceptTrustedStartInput() { return undefined; },
    });
    let authenticReceipt: TrustedWindowsNativeStartReceiptV1 | undefined;
    let getterCalled = false;
    const basket = new TrustedWindowsNativeSourceBasketControllerV1({
      adapter,
      adapterId: ADAPTER_ID,
      trustedAdapterBuildSha256: ADAPTER_BUILD_SHA256,
      randomBytes: deterministicRandomBytes(2),
      acceptTrustedStartInput(_input, _manifest, receipt, receiptGuard) {
        authenticReceipt = receipt;
        expect(other.verifyAndConsumeTrustedStartReceipt(receipt)).toBe(false);
        expect(receiptGuard.consume({
          ...receipt,
          expectedManifestDigestSha256: `sha256:${"00".repeat(32)}`,
        })).toBe(false);
        expect(receiptGuard.consume({
          ...receipt,
          totalBytesDecimal: "1".repeat(33),
        })).toBe(false);
        expect(receiptGuard.consume({ ...receipt, selectedRoots: -0 })).toBe(false);
        expect(receiptGuard.consume({ ...receipt, discoveredFiles: -0 })).toBe(false);
        expect(receiptGuard.consume({ ...receipt, issuedRevision: -0 })).toBe(false);
        expect(receiptGuard.consume({
          ...receipt,
          ["__proto__"]: { poisoned: true },
        })).toBe(false);
        const accessor = { ...receipt };
        Object.defineProperty(accessor, "receiptRef", {
          enumerable: true,
          get() {
            getterCalled = true;
            throw new Error("The receipt getter must not run.");
          },
        });
        expect(receiptGuard.consume(accessor)).toBe(false);
        expect(getterCalled).toBe(false);
        expect(receiptGuard.consume(receipt)).toBe(true);
        expect(receiptGuard.consume({ ...receipt })).toBe(false);
      },
    });
    const added = await basket.dispatch(event(basket.getView(), "add_folder"));
    const started = await basket.dispatch(event(added.view, "start"));

    expect(started.status).toBe("started");
    expect(authenticReceipt).toBeDefined();
    expect(basket.verifyAndConsumeTrustedStartReceipt(authenticReceipt)).toBe(false);
  });

  it("makes sink failure terminal start_uncertain and never retries", async () => {
    let sinkCalls = 0;
    let receipt: TrustedWindowsNativeStartReceiptV1 | undefined;
    let handlesHeld = false;
    const adapter = queuedAdapter({
      files: [(request) => selected(request, [evidence("C:\\Capture\\Reception.e57", "file", 1)])],
      folders: [],
      outputs: [outputResolved],
      revalidate(request) {
        handlesHeld = true;
        return revalidatedScope(request, freshEvidence(request), () => {
          handlesHeld = false;
          return Promise.resolve(releaseEvidence(request));
        });
      },
    });
    const basket = new TrustedWindowsNativeSourceBasketControllerV1({
      adapter,
      adapterId: ADAPTER_ID,
      trustedAdapterBuildSha256: ADAPTER_BUILD_SHA256,
      randomBytes: deterministicRandomBytes(),
      acceptTrustedStartInput(_input, _manifest, value) {
        sinkCalls += 1;
        receipt = value;
        expect(handlesHeld).toBe(true);
        throw new Error("The receiver may already have accepted the handoff.");
      },
    });
    const added = await basket.dispatch(event(basket.getView(), "add_files"));
    const startEvent = event(added.view, "start");
    const uncertain = await basket.dispatch(startEvent);

    expect(uncertain.status).toBe("start_uncertain");
    expect(uncertain.view.status).toBe("start_uncertain");
    expect(uncertain.view.nextEvent).toBeNull();
    expect(sinkCalls).toBe(1);
    expect(handlesHeld).toBe(false);
    expect(basket.verifyAndConsumeTrustedStartReceipt(receipt)).toBe(false);
    await expectRejectsCode(basket.dispatch(startEvent), "STALE_EVENT");
    expect(sinkCalls).toBe(1);
  });

  it("requires the native sink to consume the exact one-use receipt", async () => {
    const adapter = queuedAdapter({
      files: [(request) => selected(request, [evidence("C:\\Capture\\Reception.e57", "file", 1)])],
      folders: [],
      outputs: [outputResolved],
    });
    let sinkCalls = 0;
    const basket = new TrustedWindowsNativeSourceBasketControllerV1({
      adapter,
      adapterId: ADAPTER_ID,
      trustedAdapterBuildSha256: ADAPTER_BUILD_SHA256,
      randomBytes: deterministicRandomBytes(60),
      acceptTrustedStartInput() {
        sinkCalls += 1;
        // Returning without consuming the receipt must never confirm the handoff.
      },
    });
    const added = await basket.dispatch(event(basket.getView(), "add_files"));
    const uncertain = await basket.dispatch(event(added.view, "start"));

    expect(uncertain.status).toBe("start_uncertain");
    expect(uncertain.view.status).toBe("start_uncertain");
    expect(uncertain.view.nextEvent).toBeNull();
    expect(sinkCalls).toBe(1);
  });

  it("poisons a post-V0 private-evidence mismatch so no later start or sink is possible", async () => {
    let sinkCalls = 0;
    const adapter = queuedAdapter({
      files: [(request) => selected(request, [evidence("C:\\Capture\\Reception.e57", "file", 1)])],
      folders: [],
      outputs: [outputResolved],
    });
    const basket = new TrustedWindowsNativeSourceBasketControllerV1({
      adapter,
      adapterId: ADAPTER_ID,
      trustedAdapterBuildSha256: ADAPTER_BUILD_SHA256,
      randomBytes: deterministicRandomBytes(),
      assertSourceSetInput() {
        throw new TrustedWindowsNativeSourceBasketV1Error("PRIVATE_EVIDENCE_MISMATCH");
      },
      acceptTrustedStartInput() { sinkCalls += 1; },
    });
    const added = await basket.dispatch(event(basket.getView(), "add_files"));
    await expectRejectsCode(
      basket.dispatch(event(added.view, "start")),
      "PRIVATE_EVIDENCE_MISMATCH",
    );
    expect(basket.getView().status).toBe("cancelled");
    expect(basket.getView().nextEvent).toBeNull();
    await expectRejectsCode(
      basket.dispatch({
        schemaVersion: "trusted-windows-native-source-basket-event.v1",
        sessionRef: added.view.sessionRef,
        revision: added.view.revision + 1,
        eventToken: "evt_forged",
        action: "start",
      }),
      "CONTROLLER_TERMINAL",
    );
    expect(sinkCalls).toBe(0);
  });

  it("preserves the explicit unavailable adapter and rejects poisoned adapter records", async () => {
    const failClosed = new FailClosedWindowsNativeSourceAdapterV1();
    const basket = new TrustedWindowsNativeSourceBasketControllerV1({
      adapter: failClosed,
      adapterId: ADAPTER_ID,
      trustedAdapterBuildSha256: ADAPTER_BUILD_SHA256,
      randomBytes: deterministicRandomBytes(),
      acceptTrustedStartInput() { throw new Error("The sink must not run."); },
    });
    const unavailable = await basket.dispatch(event(basket.getView(), "add_files"));
    expect(unavailable.status).toBe("adapter_unavailable");
    expect(unavailable.code).toBe("WINDOWS_NATIVE_BRIDGE_UNAVAILABLE");
    expect(FAIL_CLOSED_WINDOWS_NATIVE_ADAPTER_BLOCKERS_V1).toEqual([
      "Node.js has no built-in Windows Common Item Dialog API for trusted file and folder selection.",
      "Node.js file statistics do not expose the opened handle's Windows volume serial and 128-bit file ID.",
      "Node.js does not provide race-resistant handle traversal for every ancestor, descendant, junction, and reparse tag.",
      "Node.js does not provide the existing output-directory handle, final-path identity, and complete root-through-directory reparse evidence required by V1.",
      "Node.js does not provide a native handle scope that freshly revalidates and retains every source and output handle through native sink settlement.",
    ]);

    const poisonedAdapter: TrustedWindowsNativeSourceAdapterV1 = {
      pickFiles(request) {
        const response = selected(request, [evidence("C:\\Capture\\Reception.e57", "file", 1)]);
        Object.defineProperty(response, "__proto__", {
          configurable: true,
          enumerable: true,
          value: { poisoned: true },
          writable: true,
        });
        return Promise.resolve(response);
      },
      pickFolder(request) { return Promise.resolve(cancelled(request)); },
      dropSources(request) { return Promise.resolve(cancelled(request)); },
      resolveOutputBoundary(request) { return Promise.resolve(outputResolved(request)); },
      compareCanonicalPaths(request) { return Promise.resolve(compareOrdinalPaths(request)); },
      openRevalidatedStartScope(request) {
        return Promise.resolve(revalidatedScope(request));
      },
    };
    const poisonedBasket = new TrustedWindowsNativeSourceBasketControllerV1({
      adapter: poisonedAdapter,
      adapterId: ADAPTER_ID,
      trustedAdapterBuildSha256: ADAPTER_BUILD_SHA256,
      randomBytes: deterministicRandomBytes(20),
      acceptTrustedStartInput() { throw new Error("The sink must not run."); },
    });
    await expectRejectsCode(
      poisonedBasket.dispatch(event(poisonedBasket.getView(), "add_files")),
      "FORGED_ADAPTER_RESULT",
    );
  });

  it("requires a canonical adapter identity, trusted build digest, receipt key, and random source", () => {
    const adapter = new FailClosedWindowsNativeSourceAdapterV1();
    const create = (overrides: Partial<
      ConstructorParameters<typeof TrustedWindowsNativeSourceBasketControllerV1>[0]
    > = {}): TrustedWindowsNativeSourceBasketControllerV1 =>
      new TrustedWindowsNativeSourceBasketControllerV1({
        adapter,
        adapterId: ADAPTER_ID,
        trustedAdapterBuildSha256: ADAPTER_BUILD_SHA256,
        randomBytes: deterministicRandomBytes(),
        acceptTrustedStartInput() { return undefined; },
        ...overrides,
      });

    expect(() => create({ adapterId: "X" })).toThrowError(
      expect.objectContaining({ code: "INVALID_ADAPTER_ID" }),
    );
    expect(() => create({ trustedAdapterBuildSha256: "sha256:not-a-digest" })).toThrowError(
      expect.objectContaining({ code: "INVALID_TRUSTED_ADAPTER_BUILD_SHA256" }),
    );
    expect(() => create({ receiptAuthenticationKey: new Uint8Array(32) })).toThrowError(
      expect.objectContaining({ code: "INVALID_RECEIPT_AUTHENTICATION_KEY" }),
    );
    expect(() => create({ randomBytes: (size) => new Uint8Array(size) })).toThrowError(
      expect.objectContaining({ code: "RANDOM_SOURCE_FAILED" }),
    );
  });
});
