import { describe, expect, it } from "vitest";
import {
  FAIL_CLOSED_WINDOWS_NATIVE_ADAPTER_BLOCKERS_V0,
  FailClosedWindowsNativeSourceAdapterV0,
  TrustedWindowsNativeSourceBasketControllerV0,
  TrustedWindowsNativeSourceBasketError,
  type NativeAdapterRequestV0,
  type NativeOutputBoundaryResponseV0,
  type NativePathComparisonRequestV0,
  type NativePathComparisonResponseV0,
  type NativeSourcePickerResponseV0,
  type TrustedWindowsNativeSourceAdapterV0,
  type TrustedWindowsNativeSourceSetInputV0,
  type TrustedWindowsSourceBasketEventV0,
  type TrustedWindowsSourceBasketViewV0,
  type TrustedWindowsSourceSelectionEvidenceV0,
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

const DROPPED_SOURCE_PATH_EVIDENCE = Object.freeze({
  ...SOURCE_PATH_EVIDENCE,
  acquisition: "windows_native_drop_cfhdrop_then_handle_open" as const,
});

const OUTPUT_PATH_EVIDENCE = Object.freeze({
  acquisition: "trusted_launcher_output_configuration" as const,
  canonicalization: "resolved_existing_ancestor_and_validated_suffix" as const,
  inspectionMode: "read_only" as const,
  reparseInspectionScope: "volume_root_through_output_parent" as const,
  reparseInspectionComplete: true as const,
  reparsePointsEncountered: 0,
});

function evidence(
  path: string,
  kind: "file" | "directory",
  seed: number,
  byteCountDecimal = "1024",
  fileCount = kind === "file" ? 1 : 10,
  acquisition: "picker" | "drop" = "picker",
): TrustedWindowsSourceSelectionEvidenceV0 {
  const rootIdentity = {
    volumeSerialNumberHex: "A1B2C3D4",
    fileIdHex: seed.toString(16).toUpperCase().padStart(32, "0"),
  };
  return {
    kind,
    canonicalAbsolutePath: path,
    resolvedAbsolutePath: path,
    byteCountDecimal,
    fileCount,
    identity: rootIdentity,
    inventoryFileIdentities: kind === "file"
      ? [rootIdentity]
      : Array.from({ length: fileCount }, (_, index) => ({
        volumeSerialNumberHex: "A1B2C3D4",
        fileIdHex: (seed * 1_000 + index + 1).toString(16).toUpperCase().padStart(32, "0"),
      })),
    pathEvidence: acquisition === "drop" ? DROPPED_SOURCE_PATH_EVIDENCE : SOURCE_PATH_EVIDENCE,
  };
}

function selected(
  request: NativeAdapterRequestV0,
  selections: readonly TrustedWindowsSourceSelectionEvidenceV0[],
): NativeSourcePickerResponseV0 {
  if (
    request.operation !== "add_files" &&
    request.operation !== "add_folder" &&
    request.operation !== "add_dropped"
  ) {
    throw new Error("A native selection response requires an add request.");
  }
  return {
    schemaVersion: "trusted-windows-native-adapter-response.v0",
    requestRef: request.requestRef,
    operation: request.operation,
    status: "selected",
    selections,
  };
}

function outputResolved(request: NativeAdapterRequestV0): NativeOutputBoundaryResponseV0 {
  if (request.operation !== "start") throw new Error("An output response requires a start request.");
  return {
    schemaVersion: "trusted-windows-native-adapter-response.v0",
    requestRef: request.requestRef,
    operation: "start",
    status: "resolved",
    outputBoundary: {
      canonicalAbsolutePath: "D:\\Foundry Output\\Run 1",
      resolvedAbsolutePath: "D:\\Foundry Output\\Run 1",
      pathEvidence: OUTPUT_PATH_EVIDENCE,
    },
  };
}

function cancelled(request: NativeAdapterRequestV0): NativeSourcePickerResponseV0 {
  if (
    request.operation !== "add_files" &&
    request.operation !== "add_folder" &&
    request.operation !== "add_dropped"
  ) {
    throw new Error("A native selection cancellation requires an add request.");
  }
  return {
    schemaVersion: "trusted-windows-native-adapter-response.v0",
    requestRef: request.requestRef,
    operation: request.operation,
    status: "cancelled",
  };
}

function deterministicRandomBytes(): (size: number) => Uint8Array {
  let invocation = 0;
  return (size) => {
    invocation += 1;
    return Uint8Array.from({ length: size }, (_, index) => (invocation + index) % 256);
  };
}

interface AdapterQueues {
  readonly files: Array<(request: NativeAdapterRequestV0) => NativeSourcePickerResponseV0>;
  readonly folders: Array<(request: NativeAdapterRequestV0) => NativeSourcePickerResponseV0>;
  readonly drops?: Array<(request: NativeAdapterRequestV0) => NativeSourcePickerResponseV0>;
  readonly outputs: Array<(request: NativeAdapterRequestV0) => NativeOutputBoundaryResponseV0>;
}

function compareOrdinalPaths(request: NativePathComparisonRequestV0): NativePathComparisonResponseV0 {
  const left = request.leftCanonicalAbsolutePath.toLocaleLowerCase("en-US");
  const right = request.rightCanonicalAbsolutePath.toLocaleLowerCase("en-US");
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

function queuedAdapter(queues: AdapterQueues): TrustedWindowsNativeSourceAdapterV0 {
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
      return Promise.resolve(compareOrdinalPaths(request));
    },
  };
}

function event(
  view: TrustedWindowsSourceBasketViewV0,
  action: TrustedWindowsSourceBasketEventV0["action"],
  sourceRef?: string,
): TrustedWindowsSourceBasketEventV0 {
  if (view.nextEvent === null) throw new Error("The basket has no next event binding.");
  return action === "remove"
    ? { ...view.nextEvent, action, sourceRef: sourceRef ?? "missing" }
    : { ...view.nextEvent, action };
}

function expectControllerCode(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(TrustedWindowsNativeSourceBasketError);
  if (!(error instanceof TrustedWindowsNativeSourceBasketError)) return;
  expect(error.code).toBe(code);
  expect(error.message).not.toMatch(/[A-Z]:\\/u);
  expect(error.message).not.toContain("\\");
}

async function expectRejectsCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (error: unknown) {
    expectControllerCode(error, code);
    return;
  }
  throw new Error(`Expected controller error ${code}.`);
}

function controller(options: {
  readonly adapter: TrustedWindowsNativeSourceAdapterV0;
  readonly acceptedInputs?: TrustedWindowsNativeSourceSetInputV0[];
  readonly assertInput?: (input: TrustedWindowsNativeSourceSetInputV0) => void;
  readonly acceptInput?: (input: TrustedWindowsNativeSourceSetInputV0) => Promise<void> | void;
}): TrustedWindowsNativeSourceBasketControllerV0 {
  return new TrustedWindowsNativeSourceBasketControllerV0({
    adapter: options.adapter,
    randomBytes: deterministicRandomBytes(),
    assertSourceSetInput: options.assertInput ?? (() => undefined),
    acceptTrustedStartInput: options.acceptInput ?? ((input) => {
      options.acceptedInputs?.push(input);
    }),
  });
}

describe("trusted Windows native source basket controller V0", () => {
  it("supports add files, add folder, remove, clear, and cancel without exposing paths", async () => {
    const adapter = queuedAdapter({
      files: [
        (request) => selected(request, [
          evidence("C:\\Private Client\\Reception.e57", "file", 1, "8000000000"),
          evidence("C:\\Private Client\\Reception.obj", "file", 2, "700000000"),
        ]),
      ],
      folders: [
        (request) => selected(request, [
          evidence("C:\\Private Client\\Photos", "directory", 3, "4500000000", 30),
        ]),
      ],
      outputs: [],
    });
    const basket = controller({ adapter });

    const filesAdded = await basket.dispatch(event(basket.getView(), "add_files"));
    expect(filesAdded.status).toBe("updated");
    expect(filesAdded.view.sources.map((source) => source.displayName)).toEqual([
      "Reception.e57",
      "Reception.obj",
    ]);
    expect(filesAdded.view.totals).toEqual({
      selectedRoots: 2,
      discoveredFiles: 2,
      totalBytesDecimal: "8700000000",
    });

    const folderAdded = await basket.dispatch(event(filesAdded.view, "add_folder"));
    expect(folderAdded.view.sources.map((source) => source.displayName)).toEqual([
      "Reception.e57",
      "Reception.obj",
      "Photos",
    ]);
    expect(folderAdded.view.totals.discoveredFiles).toBe(32);
    expect(JSON.stringify(folderAdded)).not.toMatch(/[A-Z]:\\/u);
    expect(JSON.stringify(folderAdded)).not.toContain("Private Client");

    const firstRef = folderAdded.view.sources[0]?.sourceRef;
    expect(firstRef).toBeDefined();
    const removed = await basket.dispatch(event(folderAdded.view, "remove", firstRef));
    expect(removed.view.sources.map((source) => source.displayName)).toEqual([
      "Reception.obj",
      "Photos",
    ]);

    const cleared = await basket.dispatch(event(removed.view, "clear"));
    expect(cleared.view.sources).toEqual([]);
    expect(cleared.view.totals.totalBytesDecimal).toBe("0");

    const cancelledResult = await basket.dispatch(event(cleared.view, "cancel"));
    expect(cancelledResult.status).toBe("cancelled");
    expect(cancelledResult.view.status).toBe("cancelled");
    expect(cancelledResult.view.nextEvent).toBeNull();
    expect(JSON.stringify(cancelledResult)).not.toMatch(/nonce|canonical|resolved|fileId|volumeSerial/iu);
  });

  it("adds one mixed Explorer drop atomically and keeps its origin truthful", async () => {
    const adapter = queuedAdapter({
      files: [],
      folders: [],
      drops: [
        (request) => selected(request, [
          evidence("C:\\Private Client\\scan.e57", "file", 11, "2048", 1, "drop"),
          evidence("C:\\Private Client\\photos", "directory", 12, "4096", 3, "drop"),
        ]),
      ],
      outputs: [outputResolved],
    });
    const acceptedInputs: TrustedWindowsNativeSourceSetInputV0[] = [];
    const basket = controller({ adapter, acceptedInputs });

    const dropped = await basket.dispatch(event(basket.getView(), "add_dropped"));

    expect(dropped).toMatchObject({ status: "updated", code: "DROPPED_ITEMS_ADDED" });
    expect(dropped.view.sources.map(({ kind }) => kind)).toEqual(["file", "directory"]);
    expect(dropped.view.totals).toEqual({
      selectedRoots: 2,
      discoveredFiles: 4,
      totalBytesDecimal: "6144",
    });
    expect(JSON.stringify(dropped)).not.toContain("Private Client");

    const started = await basket.dispatch(event(dropped.view, "start"));
    expect(started.status).toBe("started");
    expect(acceptedInputs[0]?.selections.map((selection) => selection.pathEvidence.acquisition))
      .toEqual([
        "windows_native_drop_cfhdrop_then_handle_open",
        "windows_native_drop_cfhdrop_then_handle_open",
      ]);
  });

  it("keeps a cancelled native drop non-destructive and rotates the one-use event", async () => {
    const adapter = queuedAdapter({
      files: [],
      folders: [],
      drops: [(request) => cancelled(request)],
      outputs: [],
    });
    const basket = controller({ adapter });
    const before = basket.getView();

    const result = await basket.dispatch(event(before, "add_dropped"));

    expect(result.status).toBe("drop_cancelled");
    expect(result.code).toBe("DROP_CANCELLED");
    expect(result.view.sources).toEqual([]);
    expect(result.view.nextEvent?.eventToken).not.toBe(before.nextEvent?.eventToken);
  });

  it("binds picker and Explorer-drop acquisition evidence to the requested action", async () => {
    const pickerClaimingDrop = controller({
      adapter: queuedAdapter({
        files: [(request) => selected(request, [
          evidence("C:\\Capture\\scan.e57", "file", 21, "1024", 1, "drop"),
        ])],
        folders: [],
        outputs: [],
      }),
    });
    await expectRejectsCode(
      pickerClaimingDrop.dispatch(event(pickerClaimingDrop.getView(), "add_files")),
      "FORGED_ADAPTER_RESULT",
    );

    const dropClaimingPicker = controller({
      adapter: queuedAdapter({
        files: [],
        folders: [],
        drops: [(request) => selected(request, [
          evidence("C:\\Capture\\scan.e57", "file", 22),
        ])],
        outputs: [],
      }),
    });
    await expectRejectsCode(
      dropClaimingPicker.dispatch(event(dropClaimingPicker.getView(), "add_dropped")),
      "FORGED_ADAPTER_RESULT",
    );
  });

  it("emits the complete private contract only to the injected native start sink", async () => {
    const acceptedInputs: TrustedWindowsNativeSourceSetInputV0[] = [];
    const checkedInputs: TrustedWindowsNativeSourceSetInputV0[] = [];
    const adapter = queuedAdapter({
      files: [(request) => selected(request, [
        evidence("C:\\Users\\Blake\\Reception.e57", "file", 1, "8000000000"),
      ])],
      folders: [],
      outputs: [outputResolved],
    });
    const basket = controller({
      adapter,
      acceptedInputs,
      assertInput: (input) => { checkedInputs.push(input); },
    });
    const added = await basket.dispatch(event(basket.getView(), "add_files"));
    const started = await basket.dispatch(event(added.view, "start"));

    expect(started.status).toBe("started");
    expect(started.view.status).toBe("started");
    expect(started.view.nextEvent).toBeNull();
    expect(started.view.sources[0]?.displayName).toBe("Reception.e57");
    expect(JSON.stringify(started)).not.toContain("C:\\");
    expect(JSON.stringify(started)).not.toContain("sessionNonceHex");
    expect(checkedInputs).toHaveLength(1);
    expect(acceptedInputs).toHaveLength(1);
    expect(acceptedInputs[0]).toEqual(checkedInputs[0]);
    expect(acceptedInputs[0]).toMatchObject({
      schemaVersion: "trusted-windows-native-source-set-input.v0",
      origin: "trusted_windows_native_launcher",
      browserPathInputAccepted: false,
      outputBoundary: {
        canonicalAbsolutePath: "D:\\Foundry Output\\Run 1",
      },
      selections: [{
        canonicalAbsolutePath: "C:\\Users\\Blake\\Reception.e57",
        resolvedAbsolutePath: "C:\\Users\\Blake\\Reception.e57",
        pathEvidence: {
          inspectionMode: "read_only",
          reparsePointsEncountered: 0,
        },
      }],
    });
    expect(acceptedInputs[0]?.sessionNonceHex).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("rejects forged fields, wrong sessions, wrong tokens, and stale replayed events", async () => {
    const adapter = queuedAdapter({
      files: [(request) => selected(request, [
        evidence("C:\\Capture\\Reception.e57", "file", 1),
      ])],
      folders: [],
      outputs: [],
    });
    const basket = controller({ adapter });
    const view = basket.getView();
    const valid = event(view, "add_files");

    await expectRejectsCode(
      basket.dispatch({ ...valid, path: "C:\\forged.e57" }),
      "FORGED_EVENT",
    );
    await expectRejectsCode(
      basket.dispatch({ ...valid, sessionRef: "basket_forged" }),
      "FORGED_EVENT",
    );
    await expectRejectsCode(
      basket.dispatch({ ...valid, eventToken: "evt_forged" }),
      "FORGED_EVENT",
    );
    await expectRejectsCode(
      basket.dispatch({ ...valid, revision: -0 }),
      "FORGED_EVENT",
    );

    const added = await basket.dispatch(valid);
    expect(added.status).toBe("updated");
    await expectRejectsCode(basket.dispatch(valid), "STALE_EVENT");
  });

  it("consumes an event before awaiting the adapter so concurrent replay is stale", async () => {
    let release: ((response: NativeSourcePickerResponseV0) => void) | undefined;
    let capturedRequest: NativeAdapterRequestV0 | undefined;
    const adapter: TrustedWindowsNativeSourceAdapterV0 = {
      pickFiles(request) {
        capturedRequest = request;
        return new Promise((resolve) => {
          release = (response) => { resolve(response); };
        });
      },
      pickFolder(request) { return Promise.resolve(cancelled(request)); },
      dropSources(request) { return Promise.resolve(cancelled(request)); },
      resolveOutputBoundary(request) { return Promise.resolve(outputResolved(request)); },
      compareCanonicalPaths(request) { return Promise.resolve(compareOrdinalPaths(request)); },
    };
    const basket = controller({ adapter });
    const initial = basket.getView();
    const addEvent = event(initial, "add_files");
    const pending = basket.dispatch(addEvent);

    await expectRejectsCode(basket.dispatch(addEvent), "STALE_EVENT");
    expect(basket.getView().busy).toBe(true);
    expect(basket.getView().nextEvent).toBeNull();

    if (release === undefined) throw new Error("The adapter request was not started.");
    if (capturedRequest === undefined) throw new Error("The adapter request was not captured.");
    release(selected(capturedRequest, [evidence("C:\\Capture\\Reception.e57", "file", 1)]));
    const result = await pending;
    expect(result.status).toBe("updated");
  });

  it("rejects a forged adapter challenge and incomplete reparse evidence", async () => {
    const forgedChallengeAdapter = queuedAdapter({
      files: [(request) => ({
        ...selected(request, [evidence("C:\\Capture\\Reception.e57", "file", 1)]),
        requestRef: "native_request_forged",
      })],
      folders: [],
      outputs: [],
    });
    const forgedBasket = controller({ adapter: forgedChallengeAdapter });
    await expectRejectsCode(
      forgedBasket.dispatch(event(forgedBasket.getView(), "add_files")),
      "FORGED_ADAPTER_RESULT",
    );
    expect(forgedBasket.getView().nextEvent).not.toBeNull();

    const incompleteAdapter = queuedAdapter({
      files: [(request) => {
        const source = evidence("C:\\Capture\\Reception.e57", "file", 1);
        return selected(request, [{
          ...source,
          pathEvidence: {
            ...source.pathEvidence,
            reparsePointsEncountered: 1,
          },
        }]);
      }],
      folders: [],
      outputs: [],
    });
    const incompleteBasket = controller({ adapter: incompleteAdapter });
    await expectRejectsCode(
      incompleteBasket.dispatch(event(incompleteBasket.getView(), "add_files")),
      "FORGED_ADAPTER_RESULT",
    );

    const negativeZeroReparseAdapter = queuedAdapter({
      files: [(request) => {
        const source = evidence("C:\\Capture\\Reception.e57", "file", 1);
        return selected(request, [{
          ...source,
          pathEvidence: {
            ...source.pathEvidence,
            reparsePointsEncountered: -0,
          },
        }]);
      }],
      folders: [],
      outputs: [],
    });
    const negativeZeroReparseBasket = controller({ adapter: negativeZeroReparseAdapter });
    await expectRejectsCode(
      negativeZeroReparseBasket.dispatch(
        event(negativeZeroReparseBasket.getView(), "add_files"),
      ),
      "FORGED_ADAPTER_RESULT",
    );
  });

  it("rejects negative-zero empty-directory counts and output reparse counts", async () => {
    const selectionBasket = controller({
      adapter: queuedAdapter({
        files: [],
        folders: [(request) => selected(request, [{
          ...evidence("C:\\Capture\\Empty", "directory", 9, "0", 0),
          fileCount: -0,
        }])],
        outputs: [],
      }),
    });
    await expectRejectsCode(
      selectionBasket.dispatch(event(selectionBasket.getView(), "add_folder")),
      "FORGED_ADAPTER_RESULT",
    );

    const outputBasket = controller({
      adapter: queuedAdapter({
        files: [(request) => selected(request, [
          evidence("C:\\Capture\\Reception.e57", "file", 10),
        ])],
        folders: [],
        outputs: [(request) => ({
          schemaVersion: "trusted-windows-native-adapter-response.v0",
          requestRef: request.requestRef,
          operation: "start",
          status: "resolved",
          outputBoundary: {
            canonicalAbsolutePath: "D:\\Foundry Output\\Run 1",
            resolvedAbsolutePath: "D:\\Foundry Output\\Run 1",
            pathEvidence: { ...OUTPUT_PATH_EVIDENCE, reparsePointsEncountered: -0 },
          },
        })],
      }),
    });
    const added = await outputBasket.dispatch(event(outputBasket.getView(), "add_files"));
    await expectRejectsCode(
      outputBasket.dispatch(event(added.view, "start")),
      "FORGED_ADAPTER_RESULT",
    );
  });

  it("rejects sparse adapter selection arrays instead of silently skipping an item", async () => {
    const adapter: TrustedWindowsNativeSourceAdapterV0 = {
      pickFiles(request) {
        const sparse = new Array<TrustedWindowsSourceSelectionEvidenceV0>(1);
        return Promise.resolve({
          schemaVersion: "trusted-windows-native-adapter-response.v0",
          requestRef: request.requestRef,
          operation: "add_files",
          status: "selected",
          selections: sparse,
        });
      },
      pickFolder(request) { return Promise.resolve(cancelled(request)); },
      dropSources(request) { return Promise.resolve(cancelled(request)); },
      resolveOutputBoundary(request) { return Promise.resolve(outputResolved(request)); },
      compareCanonicalPaths(request) { return Promise.resolve(compareOrdinalPaths(request)); },
    };
    const basket = controller({ adapter });

    await expectRejectsCode(
      basket.dispatch(event(basket.getView(), "add_files")),
      "FORGED_ADAPTER_RESULT",
    );
  });

  it("rejects Windows device aliases that use superscript digits", async () => {
    for (const reservedName of ["COM¹.e57", "COM².e57", "COM³.e57", "LPT¹", "LPT²", "LPT³"]) {
      const adapter = queuedAdapter({
        files: [(request) => selected(request, [
          evidence(`C:\\Capture\\${reservedName}`, "file", 1),
        ])],
        folders: [],
        outputs: [],
      });
      const basket = controller({ adapter });

      await expectRejectsCode(
        basket.dispatch(event(basket.getView(), "add_files")),
        "FORGED_ADAPTER_RESULT",
      );
    }
  });

  it("irreversibly clears private state when a stricter wrapper poisons the session", async () => {
    const adapter = queuedAdapter({
      files: [(request) => selected(request, [
        evidence("C:\\Private Client\\Reception.e57", "file", 1),
      ])],
      folders: [],
      outputs: [],
    });
    const basket = controller({ adapter });
    const added = await basket.dispatch(event(basket.getView(), "add_files"));
    expect(added.view.sources).toHaveLength(1);

    basket.disposePrivateState();
    basket.disposePrivateState();

    expect(basket.getView()).toMatchObject({
      status: "cancelled",
      sources: [],
      totals: { selectedRoots: 0, discoveredFiles: 0, totalBytesDecimal: "0" },
      nextEvent: null,
    });
    await expectRejectsCode(
      basket.dispatch(event(added.view, "clear")),
      "CONTROLLER_TERMINAL",
    );
  });

  it("rejects duplicate and parent-child additions without partially changing the basket", async () => {
    const adapter = queuedAdapter({
      files: [
        (request) => selected(request, [evidence("C:\\Capture\\Reception.e57", "file", 1)]),
        (request) => selected(request, [evidence("C:\\CAPTURE\\RECEPTION.E57", "file", 2)]),
        (request) => selected(request, [evidence("C:\\Capture\\Photos\\001.jpg", "file", 4)]),
      ],
      folders: [
        (request) => selected(request, [evidence("C:\\Capture\\Photos", "directory", 3)]),
      ],
      outputs: [],
    });
    const basket = controller({ adapter });
    const first = await basket.dispatch(event(basket.getView(), "add_files"));
    const duplicate = await basket.dispatch(event(first.view, "add_files"));
    expect(duplicate.status).toBe("selection_rejected");
    expect(duplicate.code).toBe("DUPLICATE_SOURCE");
    expect(duplicate.view.sources).toHaveLength(1);

    const folder = await basket.dispatch(event(duplicate.view, "add_folder"));
    const child = await basket.dispatch(event(folder.view, "add_files"));
    expect(child.status).toBe("selection_rejected");
    expect(child.code).toBe("SOURCE_OVERLAP");
    expect(child.view.sources).toHaveLength(2);
  });

  it("rejects duplicate discovered file identities across disjoint folders", async () => {
    const first = evidence("C:\\Capture A", "directory", 1, "100", 1);
    const secondBase = evidence("D:\\Capture B", "directory", 2, "100", 1);
    const second = {
      ...secondBase,
      inventoryFileIdentities: first.inventoryFileIdentities,
    };
    const adapter = queuedAdapter({
      files: [],
      folders: [
        (request) => selected(request, [first]),
        (request) => selected(request, [second]),
      ],
      outputs: [],
    });
    const basket = controller({ adapter });
    const added = await basket.dispatch(event(basket.getView(), "add_folder"));
    const duplicate = await basket.dispatch(event(added.view, "add_folder"));

    expect(duplicate.status).toBe("selection_rejected");
    expect(duplicate.code).toBe("DUPLICATE_DISCOVERED_FILE");
    expect(duplicate.view.sources).toHaveLength(1);
  });

  it("rejects an empty directory that claims positive bytes", async () => {
    const adapter = queuedAdapter({
      files: [],
      folders: [(request) => selected(request, [
        evidence("C:\\Capture\\Empty", "directory", 1, "1", 0),
      ])],
      outputs: [],
    });
    const basket = controller({ adapter });

    await expectRejectsCode(
      basket.dispatch(event(basket.getView(), "add_folder")),
      "FORGED_ADAPTER_RESULT",
    );
  });

  it("does not start an empty or contract-rejected basket", async () => {
    const emptyAdapter = queuedAdapter({ files: [], folders: [], outputs: [] });
    const emptyBasket = controller({ adapter: emptyAdapter });
    const empty = await emptyBasket.dispatch(event(emptyBasket.getView(), "start"));
    expect(empty.status).toBe("start_rejected");
    expect(empty.code).toBe("EMPTY_BASKET");

    let sinkCalled = false;
    const adapter = queuedAdapter({
      files: [(request) => selected(request, [evidence("C:\\Capture\\Reception.e57", "file", 1)])],
      folders: [],
      outputs: [outputResolved],
    });
    const rejectedBasket = controller({
      adapter,
      assertInput: () => { throw new Error("Contract rejection with a private path."); },
      acceptInput: () => { sinkCalled = true; },
    });
    const added = await rejectedBasket.dispatch(event(rejectedBasket.getView(), "add_files"));
    const rejected = await rejectedBasket.dispatch(event(added.view, "start"));
    expect(rejected.status).toBe("start_rejected");
    expect(rejected.code).toBe("SOURCE_SET_CONTRACT_REJECTED");
    expect(sinkCalled).toBe(false);
    expect(JSON.stringify(rejected)).not.toContain("private path");
    expect(rejected.view.nextEvent).not.toBeNull();
  });

  it("uses the native ordinal comparator to reject source/output overlap before handoff", async () => {
    let sinkCalled = false;
    const adapter = queuedAdapter({
      files: [],
      folders: [(request) => selected(request, [
        evidence("C:\\Capture", "directory", 1, "100", 1),
      ])],
      outputs: [(request) => ({
        ...outputResolved(request),
        outputBoundary: {
          canonicalAbsolutePath: "C:\\Capture\\Output",
          resolvedAbsolutePath: "C:\\Capture\\Output",
          pathEvidence: OUTPUT_PATH_EVIDENCE,
        },
      })],
    });
    const basket = controller({
      adapter,
      acceptInput: () => { sinkCalled = true; },
    });
    const added = await basket.dispatch(event(basket.getView(), "add_folder"));
    const rejected = await basket.dispatch(event(added.view, "start"));

    expect(rejected.status).toBe("start_rejected");
    expect(rejected.code).toBe("SOURCE_OUTPUT_OVERLAP");
    expect(sinkCalled).toBe(false);
  });

  it("makes a failed native handoff terminal and uncertain instead of retrying", async () => {
    let handoffCalls = 0;
    const adapter = queuedAdapter({
      files: [(request) => selected(request, [evidence("C:\\Capture\\Reception.e57", "file", 1)])],
      folders: [],
      outputs: [outputResolved],
    });
    const basket = controller({
      adapter,
      acceptInput: () => {
        handoffCalls += 1;
        throw new Error("The receiver may have accepted the input.");
      },
    });
    const added = await basket.dispatch(event(basket.getView(), "add_files"));
    const startEvent = event(added.view, "start");
    const uncertain = await basket.dispatch(startEvent);

    expect(uncertain.status).toBe("start_uncertain");
    expect(uncertain.view.status).toBe("start_uncertain");
    expect(uncertain.view.nextEvent).toBeNull();
    expect(handoffCalls).toBe(1);
    await expectRejectsCode(basket.dispatch(startEvent), "STALE_EVENT");
    expect(handoffCalls).toBe(1);
  });

  it("keeps picker cancellation non-destructive and rotates the one-use event", async () => {
    const adapter = queuedAdapter({
      files: [(request) => cancelled(request)],
      folders: [],
      outputs: [],
    });
    const basket = controller({ adapter });
    const initial = basket.getView();
    const result = await basket.dispatch(event(initial, "add_files"));

    expect(result.status).toBe("picker_cancelled");
    expect(result.view.sources).toEqual([]);
    expect(result.view.revision).toBe(initial.revision + 1);
    expect(result.view.nextEvent?.eventToken).not.toBe(initial.nextEvent?.eventToken);
  });

  it("ships an explicit fail-closed adapter instead of accepting typed paths", async () => {
    const failClosed = new FailClosedWindowsNativeSourceAdapterV0();
    const basket = controller({ adapter: failClosed });
    const result = await basket.dispatch(event(basket.getView(), "add_files"));

    expect(result.status).toBe("adapter_unavailable");
    expect(result.code).toBe("WINDOWS_NATIVE_BRIDGE_UNAVAILABLE");
    expect(result.view.sources).toEqual([]);
    expect(FAIL_CLOSED_WINDOWS_NATIVE_ADAPTER_BLOCKERS_V0).toEqual([
      "Node.js has no built-in Windows Common Item Dialog API for trusted file and folder selection.",
      "Node.js file statistics do not expose the opened handle's Windows volume serial and 128-bit file ID.",
      "Node.js does not provide race-resistant handle traversal for every ancestor, descendant, junction, and reparse tag.",
      "A not-yet-created output needs native existing-ancestor resolution and reparse checks before its suffix is accepted.",
    ]);
    expect(JSON.stringify(result)).not.toMatch(/[A-Z]:\\|cloud|bucket|command|permit/iu);
  });

  it("rejects negative-zero configured file limits", () => {
    const adapter = new FailClosedWindowsNativeSourceAdapterV0();
    expect(() => new TrustedWindowsNativeSourceBasketControllerV0({
      adapter,
      randomBytes: deterministicRandomBytes(),
      maxFilesPerSelection: -0,
      acceptTrustedStartInput() { return undefined; },
    })).toThrow(TypeError);
    expect(() => new TrustedWindowsNativeSourceBasketControllerV0({
      adapter,
      randomBytes: deterministicRandomBytes(),
      maxDiscoveredFiles: -0,
      acceptTrustedStartInput() { return undefined; },
    })).toThrow(TypeError);
  });
});
