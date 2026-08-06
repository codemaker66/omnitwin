import { describe, expect, it, vi } from "vitest";
import {
  StrictTrustedWindowsNativeSourceAdapterV1,
  TrustedWindowsNativeSourceAdapterImplementationErrorV1,
  createProcessBackedTrustedWindowsNativeSourceAdapterV1,
} from "../trusted-windows-native-source-adapter-v1.js";
import {
  TrustedWindowsNativeSourceBasketControllerV1,
  TrustedWindowsNativeSourceBasketV1Error,
  type TrustedWindowsNativeRevalidatedStartRequestV1,
  type TrustedWindowsSourceBasketEventV1,
  type TrustedWindowsSourceBasketViewV1,
} from "../trusted-windows-native-source-basket-v1.js";
import type {
  NativeAdapterRequestV0,
  NativePathComparisonRequestV0,
} from "../trusted-windows-native-source-basket.js";

const HELPER_SESSION_REF = `helper_session_${"a1".repeat(16)}`;
const BASKET_SESSION_REF = `basket_${"b2".repeat(16)}`;

type InjectedHelperClient = ConstructorParameters<
  typeof StrictTrustedWindowsNativeSourceAdapterV1
>[0];

function compareRequest(
  suffix = "01",
  sessionRef = BASKET_SESSION_REF,
): NativePathComparisonRequestV0 {
  return {
    schemaVersion: "trusted-windows-native-path-comparison-request.v0",
    requestRef: `native_compare_${suffix.repeat(16)}`,
    sessionRef,
    operation: "compare_paths",
    leftCanonicalAbsolutePath: "C:\\Room",
    rightCanonicalAbsolutePath: "C:\\Room\\Child",
    readOnly: true,
  };
}

function adapterRequest(
  operation: "add_files" | "add_folder" | "add_dropped" | "start",
  suffix = "c3",
): NativeAdapterRequestV0 {
  return {
    schemaVersion: "trusted-windows-native-adapter-request.v0",
    requestRef: `native_request_${suffix.repeat(16)}`,
    sessionRef: BASKET_SESSION_REF,
    operation,
    readOnly: true,
    browserPathInputAccepted: false,
  };
}

function rawIdentity(seed: number) {
  return {
    volume_serial_number_hex: "00000000A1B2C3D4",
    file_id_hex: seed.toString(16).toUpperCase().padStart(32, "0"),
  };
}

function rawLocalVolume(identity: ReturnType<typeof rawIdentity>) {
  return {
    opened_handle_file_type: "FILE_TYPE_DISK",
    volume_path_resolution: "get_volume_path_name_w",
    drive_type_query: "get_drive_type_w",
    drive_type: "DRIVE_FIXED",
    dos_device_query: "query_dos_device_w",
    dos_device_mapping: "direct_local_volume",
    dos_device_alias_chain_detected: false,
    subst_target_detected: false,
    unc_redirector_detected: false,
    network_device_target_detected: false,
    opened_handle_volume_corroboration:
      "file_id_info_volume_serial_matches_opened_volume_root_handle",
    opened_handle_volume_serial_number_hex: identity.volume_serial_number_hex,
    volume_root_handle_serial_number_hex: identity.volume_serial_number_hex,
  };
}

function rawSelection(
  sourceRef = `helper_source_${"d4".repeat(16)}`,
  path = "C:\\Private Source\\capture.e57",
  seed = 1,
  byteCountDecimal = "1024",
  acquisition:
    | "windows_native_picker_handle"
    | "windows_native_drop_cfhdrop_then_handle_open" = "windows_native_picker_handle",
) {
  const identity = rawIdentity(seed);
  return {
    source_ref: sourceRef,
    evidence: {
      kind: "file",
      canonical_absolute_path: path,
      resolved_absolute_path: path,
      byte_count_decimal: byteCountDecimal,
      file_count: 1,
      identity,
      inventory_file_identities: [identity],
      path_evidence: {
        acquisition,
        canonicalization: "final_path_by_handle",
        inspection_mode: "read_only",
        path_identity_checked_by_handle: true,
        reparse_inspection_scope: "volume_root_through_complete_selection",
        reparse_inspection_complete: true,
        reparse_points_encountered: 0,
        inventory_complete: true,
        regular_files_only: true,
      },
      local_volume_evidence: rawLocalVolume(identity),
    },
  };
}

function rawDirectorySelection(
  sourceRef: string,
  path: string,
  rootSeed: number,
  inventorySeeds: readonly number[],
  byteCountDecimal = inventorySeeds.length === 0 ? "0" : "1024",
  acquisition:
    | "windows_native_picker_handle"
    | "windows_native_drop_cfhdrop_then_handle_open" = "windows_native_picker_handle",
) {
  const rootIdentity = rawIdentity(rootSeed);
  return {
    source_ref: sourceRef,
    evidence: {
      kind: "directory",
      canonical_absolute_path: path,
      resolved_absolute_path: path,
      byte_count_decimal: byteCountDecimal,
      file_count: inventorySeeds.length,
      identity: rootIdentity,
      inventory_file_identities: inventorySeeds.map(rawIdentity),
      path_evidence: {
        acquisition,
        canonicalization: "final_path_by_handle",
        inspection_mode: "read_only",
        path_identity_checked_by_handle: true,
        reparse_inspection_scope: "volume_root_through_complete_selection",
        reparse_inspection_complete: true,
        reparse_points_encountered: 0,
        inventory_complete: true,
        regular_files_only: true,
      },
      local_volume_evidence: rawLocalVolume(rootIdentity),
    },
  };
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: Error) => void;
}

interface HostileThrownValue<T extends object> {
  readonly value: T;
  readonly thrownValue: Error;
  readonly requestReads: {
    property: number;
    prototype: number;
  };
  readonly thrownReads: {
    property: number;
    prototype: number;
  };
}

type ImmediateSettlement =
  | { readonly status: "resolved"; readonly value: unknown }
  | { readonly status: "rejected"; readonly error: unknown }
  | { readonly status: "pending" };

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => undefined;
  let rejectPromise: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function hostileThrownValue<T extends object>(): HostileThrownValue<T> {
  const thrownHolder = { value: new Error("uninitialized hostile thrown value") };
  const thrownReads = { property: 0, prototype: 0 };
  const thrownPropertyRead = (): never => {
    thrownReads.property += 1;
    throw thrownHolder.value;
  };
  const thrownPrototypeRead = (): never => {
    thrownReads.prototype += 1;
    throw thrownHolder.value;
  };
  const thrownValue = new Proxy(new Error("private hostile thrown value"), {
    get: thrownPropertyRead,
    getPrototypeOf: thrownPrototypeRead,
  });
  thrownHolder.value = thrownValue;

  const requestReads = { property: 0, prototype: 0 };
  const requestPropertyRead = (): never => {
    requestReads.property += 1;
    throw thrownValue;
  };
  const requestPrototypeRead = (): never => {
    requestReads.prototype += 1;
    throw thrownValue;
  };
  const value = new Proxy(Object.create(null) as T, {
    get: requestPropertyRead,
    getPrototypeOf: requestPrototypeRead,
  });
  return { value, thrownValue, requestReads, thrownReads };
}

async function immediateSettlement(promise: Promise<unknown>): Promise<ImmediateSettlement> {
  const completion: Promise<ImmediateSettlement> = promise.then(
    (value) => ({ status: "resolved", value }),
    (error: unknown) => ({ status: "rejected", error }),
  );
  const pending = new Promise<ImmediateSettlement>((resolve) => {
    setImmediate(() => {
      resolve({ status: "pending" });
    });
  });
  return await Promise.race([completion, pending]);
}

function afterMicrotasks(count: number, action: () => void): void {
  if (count === 0) {
    action();
    return;
  }
  queueMicrotask(() => {
    afterMicrotasks(count - 1, action);
  });
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

function basketEvent(
  view: TrustedWindowsSourceBasketViewV1,
  action: "add_files" | "start",
): TrustedWindowsSourceBasketEventV1 {
  if (view.nextEvent === null) throw new Error("The basket has no next event binding.");
  return action === "add_files"
    ? { ...view.nextEvent, action: "add_files" }
    : { ...view.nextEvent, action: "start" };
}

function rawOutput(outputRef = `helper_output_${"e5".repeat(16)}`) {
  const identity = rawIdentity(2);
  return {
    output_ref: outputRef,
    boundary: {
      kind: "directory",
      canonical_absolute_path: "D:\\Trusted Output",
      resolved_absolute_path: "D:\\Trusted Output",
      identity,
      path_evidence: {
        acquisition: "windows_native_output_directory_handle",
        canonicalization: "final_path_by_handle",
        inspection_mode: "read_only",
        path_identity_checked_by_handle: true,
        directory_type_checked_by_handle: true,
        reparse_inspection_scope: "volume_root_through_output_directory",
        reparse_inspection_complete: true,
        reparse_points_encountered: 0,
      },
      local_volume_evidence: rawLocalVolume(identity),
    },
  };
}

function boundResponse(
  request: {
    readonly operation: string;
    readonly session_ref: string;
    readonly basket_session_ref: string;
    readonly request_ref: string;
  },
  extra: Readonly<Record<string, unknown>>,
) {
  return {
    schema_version: 1,
    operation: request.operation,
    session_ref: request.session_ref,
    basket_session_ref: request.basket_session_ref,
    request_ref: request.request_ref,
    ...extra,
  };
}

function revalidationRequest(
  selection: Awaited<ReturnType<StrictTrustedWindowsNativeSourceAdapterV1["pickFiles"]>>,
  output: Awaited<ReturnType<StrictTrustedWindowsNativeSourceAdapterV1["resolveOutputBoundary"]>>,
  suffix = "f6",
): TrustedWindowsNativeRevalidatedStartRequestV1 {
  if (selection.status !== "selected" || output.status !== "resolved") {
    throw new Error("The fixture requires selected source and output evidence.");
  }
  return {
    schemaVersion: "trusted-windows-native-revalidated-start-request.v1",
    requestRef: `revalidated_start_${suffix.repeat(16)}`,
    sessionRef: BASKET_SESSION_REF,
    operation: "revalidate_start",
    adapterId: "venviewer.windows-native-picker.v1",
    adapterBuildSha256: `sha256:${"a1".repeat(32)}`,
    readOnly: true,
    browserPathInputAccepted: false,
    expectedOutputBoundary: output.outputBoundary,
    expectedSelections: selection.selections,
  };
}

function helperClient(
  overrides: Partial<InjectedHelperClient> = {},
): InjectedHelperClient {
  return {
    session_ref: HELPER_SESSION_REF,
    capabilities: [
      "pick_files",
      "pick_folder",
      "drop_sources",
      "resolve_output",
      "compare_paths",
      "revalidate_start",
      "release_revalidated_start",
      "close",
    ],
    pick_files: vi.fn(() => Promise.resolve({ status: "unused" })),
    pick_folder: vi.fn(() => Promise.resolve({ status: "unused" })),
    drop_sources: vi.fn(() => Promise.resolve({ status: "unused" })),
    resolve_output: vi.fn(() => Promise.resolve({ status: "unused" })),
    compare_paths: vi.fn((request) => Promise.resolve({
      schema_version: 1,
      operation: "compare_paths",
      session_ref: request.session_ref,
      basket_session_ref: request.basket_session_ref,
      request_ref: request.request_ref,
      status: "compared",
      comparison_authority: "windows_compare_string_ordinal_ignore_case",
      relation: "ancestor",
    })),
    revalidate_start: vi.fn(() => Promise.resolve({ status: "unused" })),
    release_revalidated_start: vi.fn(() => Promise.resolve({ status: "unused" })),
    close_and_confirm_no_live_scopes: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

function custodyClient(
  overrides: Partial<InjectedHelperClient> = {},
): InjectedHelperClient {
  const selection = rawSelection();
  const output = rawOutput();
  return helperClient({
    pick_files: vi.fn((request) => Promise.resolve(boundResponse(request, {
      status: "selected",
      selections: [selection],
    }))),
    resolve_output: vi.fn((request) => Promise.resolve(boundResponse(request, {
      status: "resolved",
      output,
    }))),
    revalidate_start: vi.fn((request) => Promise.resolve(boundResponse(request, {
      status: "opened",
      scope_ref: `helper_scope_${"f7".repeat(16)}`,
      evidence: {
        adapter_id: request.adapter_id,
        adapter_build_sha256: request.adapter_build_sha256,
        identity_comparison_mechanism: "windows_volume_serial_plus_file_id_128",
        path_comparison_mechanism: "windows_compare_string_ordinal_ignore_case",
        output,
        selections: [selection],
        native_path_comparisons: {
          source_pairs: [],
          output_pairs: [{ selection_index: 1, relation: "disjoint" }],
        },
      },
    }))),
    release_revalidated_start: vi.fn((request) => Promise.resolve(boundResponse(request, {
      scope_ref: request.scope_ref,
      status: "released",
    }))),
    ...overrides,
  });
}

type DeferredAdapterOperation = "compare" | "pick" | "resolve" | "revalidate" | "release";

async function runDeferredLifecycleRace(
  operation: DeferredAdapterOperation,
  closeFails: boolean,
  explicitRejectedResponse = false,
): Promise<void> {
  const pending = deferred<unknown>();
  const close = vi.fn(() => closeFails
    ? Promise.reject(new Error("private teardown failure"))
    : Promise.resolve());
  let settle: () => void = () => {
    throw new Error("The deferred helper request was not captured.");
  };
  let adapter: StrictTrustedWindowsNativeSourceAdapterV1;
  let operationPromise: Promise<unknown>;

  if (operation === "compare") {
    let captured: Parameters<InjectedHelperClient["compare_paths"]>[0] | null = null;
    const client = helperClient({
      compare_paths: vi.fn((request) => {
        captured = request;
        return pending.promise;
      }),
      close_and_confirm_no_live_scopes: close,
    });
    adapter = new StrictTrustedWindowsNativeSourceAdapterV1(client);
    operationPromise = adapter.compareCanonicalPaths(compareRequest("31"));
    settle = () => {
      if (captured === null) throw new Error("Missing compare request.");
      pending.resolve(boundResponse(captured, {
        status: "compared",
        comparison_authority: "windows_compare_string_ordinal_ignore_case",
        relation: "ancestor",
      }));
    };
  } else if (operation === "pick") {
    let captured: Parameters<InjectedHelperClient["pick_files"]>[0] | null = null;
    const client = helperClient({
      pick_files: vi.fn((request) => {
        captured = request;
        return pending.promise;
      }),
      close_and_confirm_no_live_scopes: close,
    });
    adapter = new StrictTrustedWindowsNativeSourceAdapterV1(client);
    operationPromise = adapter.pickFiles(adapterRequest("add_files", "32"));
    settle = () => {
      if (captured === null) throw new Error("Missing picker request.");
      pending.resolve(boundResponse(captured, {
        status: "selected",
        selections: [rawSelection()],
      }));
    };
  } else if (operation === "resolve") {
    let captured: Parameters<InjectedHelperClient["resolve_output"]>[0] | null = null;
    const client = helperClient({
      resolve_output: vi.fn((request) => {
        captured = request;
        return pending.promise;
      }),
      close_and_confirm_no_live_scopes: close,
    });
    adapter = new StrictTrustedWindowsNativeSourceAdapterV1(client);
    operationPromise = adapter.resolveOutputBoundary(adapterRequest("start", "33"));
    settle = () => {
      if (captured === null) throw new Error("Missing output request.");
      pending.resolve(boundResponse(captured, { status: "resolved", output: rawOutput() }));
    };
  } else if (operation === "revalidate") {
    let captured: Parameters<InjectedHelperClient["revalidate_start"]>[0] | null = null;
    const client = custodyClient({
      revalidate_start: vi.fn((request) => {
        captured = request;
        return pending.promise;
      }),
      close_and_confirm_no_live_scopes: close,
    });
    adapter = new StrictTrustedWindowsNativeSourceAdapterV1(client);
    const picked = await adapter.pickFiles(adapterRequest("add_files", "34"));
    const output = await adapter.resolveOutputBoundary(adapterRequest("start", "35"));
    operationPromise = adapter.openRevalidatedStartScope(
      revalidationRequest(picked, output, "36"),
    );
    settle = () => {
      if (captured === null) throw new Error("Missing revalidation request.");
      pending.resolve(explicitRejectedResponse
        ? boundResponse(captured, { status: "rejected", no_live_scope: true })
        : boundResponse(captured, {
          status: "opened",
          scope_ref: `helper_scope_${"f7".repeat(16)}`,
          evidence: {
            adapter_id: captured.adapter_id,
            adapter_build_sha256: captured.adapter_build_sha256,
            identity_comparison_mechanism: "windows_volume_serial_plus_file_id_128",
            path_comparison_mechanism: "windows_compare_string_ordinal_ignore_case",
            output: rawOutput(),
            selections: [rawSelection()],
            native_path_comparisons: {
              source_pairs: [],
              output_pairs: [{ selection_index: 1, relation: "disjoint" }],
            },
          },
        }));
    };
  } else {
    let captured: Parameters<InjectedHelperClient["release_revalidated_start"]>[0] | null = null;
    const client = custodyClient({
      release_revalidated_start: vi.fn((request) => {
        captured = request;
        return pending.promise;
      }),
      close_and_confirm_no_live_scopes: close,
    });
    adapter = new StrictTrustedWindowsNativeSourceAdapterV1(client);
    const picked = await adapter.pickFiles(adapterRequest("add_files", "37"));
    const output = await adapter.resolveOutputBoundary(adapterRequest("start", "38"));
    const scope = await adapter.openRevalidatedStartScope(
      revalidationRequest(picked, output, "39"),
    );
    operationPromise = scope.release();
    settle = () => {
      if (captured === null) throw new Error("Missing release request.");
      pending.resolve(boundResponse(captured, {
        scope_ref: captured.scope_ref,
        status: "released",
      }));
    };
  }

  void operationPromise.catch(() => undefined);
  const closing = adapter.closeAndConfirmNoLiveScopes();
  if (closeFails) {
    await expect(closing).rejects.toMatchObject({ code: "HELPER_TEARDOWN_UNCONFIRMED" });
  } else {
    await expect(closing).resolves.toBeUndefined();
  }
  expect(close).toHaveBeenCalledOnce();
  settle();
  await expect(operationPromise).rejects.toMatchObject({
    code: closeFails ? "HELPER_TEARDOWN_UNCONFIRMED" : "ADAPTER_SESSION_CLOSED",
  });
  await expect(adapter.compareCanonicalPaths(compareRequest("40"))).rejects.toMatchObject({
    code: closeFails ? "HELPER_TEARDOWN_UNCONFIRMED" : "ADAPTER_SESSION_CLOSED",
  });
}

describe("StrictTrustedWindowsNativeSourceAdapterV1", () => {
  it("maps the helper's left-relative relation and emits an exact camelCase response", async () => {
    const client = helperClient();
    const adapter = new StrictTrustedWindowsNativeSourceAdapterV1(client);
    const request = compareRequest();

    await expect(adapter.compareCanonicalPaths(request)).resolves.toEqual({
      schemaVersion: "trusted-windows-native-path-comparison.v0",
      requestRef: request.requestRef,
      status: "compared",
      comparisonAuthority: "windows_compare_string_ordinal_ignore_case",
      relation: "left_ancestor",
    });
    // The fake is an object method only because it mirrors the private helper client.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const comparePaths = vi.mocked(client.compare_paths);
    expect(comparePaths).toHaveBeenCalledWith({
      schema_version: 1,
      operation: "compare_paths",
      session_ref: HELPER_SESSION_REF,
      basket_session_ref: BASKET_SESSION_REF,
      request_ref: request.requestRef,
      left_canonical_absolute_path: "C:\\Room",
      right_canonical_absolute_path: "C:\\Room\\Child",
      read_only: true,
    });
  });

  it("binds one helper adapter to exactly one basket session", async () => {
    const client = helperClient();
    const adapter = new StrictTrustedWindowsNativeSourceAdapterV1(client);
    await adapter.compareCanonicalPaths(compareRequest("02"));

    const otherSession = `basket_${"d4".repeat(16)}`;
    await expect(adapter.compareCanonicalPaths(compareRequest("03", otherSession)))
      .rejects.toMatchObject({ code: "ADAPTER_SESSION_MISMATCH" });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const comparePaths = vi.mocked(client.compare_paths);
    expect(comparePaths).toHaveBeenCalledTimes(1);
  });

  it("never includes a private helper error or path in its public error", async () => {
    const privateText = "C:\\Secret Person\\Private Room\\capture.e57";
    const client = helperClient({
      compare_paths: vi.fn(() => Promise.reject(new Error(privateText))),
    });
    const adapter = new StrictTrustedWindowsNativeSourceAdapterV1(client);

    let thrown: unknown;
    try {
      await adapter.compareCanonicalPaths(compareRequest("04"));
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TrustedWindowsNativeSourceAdapterImplementationErrorV1);
    expect((thrown as Error).message).not.toContain(privateText);
    expect((thrown as Error).message).not.toContain("Secret Person");
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const closeAndConfirm = vi.mocked(client.close_and_confirm_no_live_scopes);
    expect(closeAndConfirm).toHaveBeenCalledOnce();
  });

  it("settles every request-entry path when validation throws a hostile Proxy", async () => {
    for (const operation of [
      "pickFiles",
      "pickFolder",
      "resolveOutputBoundary",
    ] as const) {
      const adapter = new StrictTrustedWindowsNativeSourceAdapterV1(helperClient());
      const hostile = hostileThrownValue<NativeAdapterRequestV0>();
      const settlement = await immediateSettlement(adapter[operation](hostile.value));

      expect(settlement).toMatchObject({
        status: "rejected",
        error: { code: "PRIVATE_HELPER_PROTOCOL_FAILURE" },
      });
      expect(hostile.requestReads).toEqual({ property: 0, prototype: 1 });
      expect(hostile.thrownReads).toEqual({ property: 0, prototype: 0 });
    }

    const adapter = new StrictTrustedWindowsNativeSourceAdapterV1(helperClient());
    const hostile = hostileThrownValue<NativePathComparisonRequestV0>();
    const settlement = await immediateSettlement(
      adapter.compareCanonicalPaths(hostile.value),
    );

    expect(settlement).toMatchObject({
      status: "rejected",
      error: { code: "PRIVATE_HELPER_PROTOCOL_FAILURE" },
    });
    expect(hostile.requestReads).toEqual({ property: 0, prototype: 1 });
    expect(hostile.thrownReads).toEqual({ property: 0, prototype: 0 });
  });

  it("does not trust an externally constructed adapter error", async () => {
    const externallyConstructed =
      new TrustedWindowsNativeSourceAdapterImplementationErrorV1("ADAPTER_OPERATION_BUSY");
    const prototypeReads = vi.fn(() => {
      throw externallyConstructed;
    });
    const request = new Proxy(Object.create(null) as NativePathComparisonRequestV0, {
      getPrototypeOf: prototypeReads,
    });
    const adapter = new StrictTrustedWindowsNativeSourceAdapterV1(helperClient());

    const settlement = await immediateSettlement(adapter.compareCanonicalPaths(request));

    expect(settlement).toMatchObject({
      status: "rejected",
      error: { code: "PRIVATE_HELPER_PROTOCOL_FAILURE" },
    });
    expect(prototypeReads).toHaveBeenCalledOnce();
  });

  it("settles scope opening when request validation throws a hostile Proxy", async () => {
    const close = vi.fn(() => Promise.resolve());
    const adapter = new StrictTrustedWindowsNativeSourceAdapterV1(custodyClient({
      close_and_confirm_no_live_scopes: close,
    }));
    await adapter.pickFiles(adapterRequest("add_files", "a2"));
    await adapter.resolveOutputBoundary(adapterRequest("start", "a3"));
    const hostile = hostileThrownValue<TrustedWindowsNativeRevalidatedStartRequestV1>();

    const settlement = await immediateSettlement(
      adapter.openRevalidatedStartScope(hostile.value),
    );

    expect(settlement).toMatchObject({
      status: "rejected",
      error: { code: "PRIVATE_HELPER_PROTOCOL_FAILURE" },
    });
    expect(hostile.requestReads).toEqual({ property: 0, prototype: 1 });
    expect(hostile.thrownReads).toEqual({ property: 0, prototype: 0 });
    expect(close).toHaveBeenCalledOnce();
  });

  it("settles scope release without inspecting a hostile helper rejection", async () => {
    const hostile = hostileThrownValue<object>();
    const close = vi.fn(() => Promise.resolve());
    const adapter = new StrictTrustedWindowsNativeSourceAdapterV1(custodyClient({
      release_revalidated_start: vi.fn(() => Promise.reject(hostile.thrownValue)),
      close_and_confirm_no_live_scopes: close,
    }));
    const picked = await adapter.pickFiles(adapterRequest("add_files", "a4"));
    const output = await adapter.resolveOutputBoundary(adapterRequest("start", "a5"));
    const scope = await adapter.openRevalidatedStartScope(
      revalidationRequest(picked, output, "a6"),
    );

    const settlement = await immediateSettlement(scope.release());

    expect(settlement).toMatchObject({
      status: "rejected",
      error: { code: "REVALIDATED_SCOPE_RELEASE_FAILED" },
    });
    expect(hostile.requestReads).toEqual({ property: 0, prototype: 0 });
    expect(hostile.thrownReads).toEqual({ property: 0, prototype: 0 });
    expect(close).toHaveBeenCalledOnce();
  });

  it("settles lifecycle close and permits retry after a hostile helper rejection", async () => {
    const hostile = hostileThrownValue<object>();
    const close = vi.fn()
      .mockRejectedValueOnce(hostile.thrownValue)
      .mockResolvedValueOnce(undefined);
    const adapter = new StrictTrustedWindowsNativeSourceAdapterV1(helperClient({
      close_and_confirm_no_live_scopes: close,
    }));

    const settlement = await immediateSettlement(adapter.closeAndConfirmNoLiveScopes());

    expect(settlement).toMatchObject({
      status: "rejected",
      error: { code: "HELPER_TEARDOWN_UNCONFIRMED" },
    });
    expect(hostile.requestReads).toEqual({ property: 0, prototype: 0 });
    expect(hostile.thrownReads).toEqual({ property: 0, prototype: 0 });
    await expect(adapter.closeAndConfirmNoLiveScopes()).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("keeps unconfirmed teardown distinct and permits an exact lifecycle retry", async () => {
    const close = vi.fn()
      .mockRejectedValueOnce(new Error("private teardown detail"))
      .mockResolvedValueOnce(undefined);
    const client = helperClient({
      compare_paths: vi.fn(() => Promise.reject(new Error("private operation detail"))),
      close_and_confirm_no_live_scopes: close,
    });
    const adapter = new StrictTrustedWindowsNativeSourceAdapterV1(client);

    await expect(adapter.compareCanonicalPaths(compareRequest("05"))).rejects.toMatchObject({
      code: "HELPER_TEARDOWN_UNCONFIRMED",
      message: "The trusted Windows helper process could not be confirmed stopped.",
    });
    await expect(adapter.closeAndConfirmNoLiveScopes()).resolves.toBeUndefined();
    await expect(adapter.closeAndConfirmNoLiveScopes()).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["compare", false], ["compare", true],
    ["pick", false], ["pick", true],
    ["resolve", false], ["resolve", true],
    ["revalidate", false], ["revalidate", true],
    ["release", false], ["release", true],
  ] as const)(
    "makes close authoritative over a deferred %s operation (closeFails=%s)",
    async (operation, closeFails) => {
      await runDeferredLifecycleRace(operation, closeFails);
    },
  );

  it("lets close win during the final public-promise handoff", async () => {
    const pending = deferred<unknown>();
    let captured: Parameters<InjectedHelperClient["compare_paths"]>[0] | null = null;
    const close = vi.fn(() => Promise.resolve());
    const adapter = new StrictTrustedWindowsNativeSourceAdapterV1(helperClient({
      compare_paths: vi.fn((request) => {
        captured = request;
        return pending.promise;
      }),
      close_and_confirm_no_live_scopes: close,
    }));
    const operation = adapter.compareCanonicalPaths(compareRequest("66"));
    void operation.catch(() => undefined);
    if (captured === null) throw new Error("Missing compare request.");
    pending.resolve(boundResponse(captured, {
      status: "compared",
      comparison_authority: "windows_compare_string_ordinal_ignore_case",
      relation: "ancestor",
    }));

    const closeStarted = deferred<undefined>();
    let closing: Promise<void> | null = null;
    let stateProbe: Promise<"pending" | "settled"> | null = null;
    afterMicrotasks(4, () => {
      stateProbe = Promise.race([
        operation.then(
          () => "settled" as const,
          () => "settled" as const,
        ),
        Promise.resolve("pending" as const),
      ]);
      closing = adapter.closeAndConfirmNoLiveScopes();
      closeStarted.resolve(undefined);
    });

    await closeStarted.promise;
    await expect(stateProbe).resolves.toBe("pending");
    await expect(closing).resolves.toBeUndefined();
    await expect(operation).rejects.toMatchObject({ code: "ADAPTER_SESSION_CLOSED" });
    expect(close).toHaveBeenCalledOnce();
  });

  it("lets teardown uncertainty override a deferred explicit scope rejection", async () => {
    await runDeferredLifecycleRace("revalidate", true, true);
  });

  it("shares one exact confirmation across concurrent close callers", async () => {
    const pendingClose = deferred<undefined>();
    const close = vi.fn(() => pendingClose.promise);
    const adapter = new StrictTrustedWindowsNativeSourceAdapterV1(helperClient({
      close_and_confirm_no_live_scopes: close,
    }));

    const first = adapter.closeAndConfirmNoLiveScopes();
    const second = adapter.closeAndConfirmNoLiveScopes();
    expect(second).toBe(first);
    expect(close).toHaveBeenCalledOnce();
    pendingClose.resolve(undefined);
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    await expect(adapter.closeAndConfirmNoLiveScopes()).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledOnce();
  });

  it("stores the close attempt before a synchronous client re-entry", async () => {
    let reentered: Promise<void> | null = null;
    const close = vi.fn(() => {
      if (reentered === null) reentered = adapter.closeAndConfirmNoLiveScopes();
      return Promise.resolve();
    });
    const adapter = new StrictTrustedWindowsNativeSourceAdapterV1(helperClient({
      close_and_confirm_no_live_scopes: close,
    }));

    const first = adapter.closeAndConfirmNoLiveScopes();
    expect(reentered).toBe(first);
    await expect(first).resolves.toBeUndefined();
    await expect(reentered).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledOnce();
  });

  it("keeps teardown uncertainty authoritative throughout a failed retry", async () => {
    const retryClose = deferred<undefined>();
    const close = vi.fn()
      .mockRejectedValueOnce(new Error("first private teardown failure"))
      .mockImplementationOnce(() => retryClose.promise);
    const adapter = new StrictTrustedWindowsNativeSourceAdapterV1(custodyClient({
      close_and_confirm_no_live_scopes: close,
    }));
    const picked = await adapter.pickFiles(adapterRequest("add_files", "76"));
    const output = await adapter.resolveOutputBoundary(adapterRequest("start", "77"));
    const scope = await adapter.openRevalidatedStartScope(
      revalidationRequest(picked, output, "78"),
    );

    await expect(adapter.closeAndConfirmNoLiveScopes()).rejects.toMatchObject({
      code: "HELPER_TEARDOWN_UNCONFIRMED",
    });
    const retry = adapter.closeAndConfirmNoLiveScopes();
    void retry.catch(() => undefined);
    const comparison = adapter.compareCanonicalPaths(compareRequest("79"));
    const release = scope.release();

    await expect(comparison).rejects.toMatchObject({
      code: "HELPER_TEARDOWN_UNCONFIRMED",
    });
    await expect(release).rejects.toMatchObject({
      code: "HELPER_TEARDOWN_UNCONFIRMED",
    });
    retryClose.reject(new Error("second private teardown failure"));
    await expect(retry).rejects.toMatchObject({ code: "HELPER_TEARDOWN_UNCONFIRMED" });
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("converts exact picker and output DTOs without exposing opaque references", async () => {
    const client = custodyClient();
    const adapter = new StrictTrustedWindowsNativeSourceAdapterV1(client);

    const picked = await adapter.pickFiles(adapterRequest("add_files", "11"));
    const output = await adapter.resolveOutputBoundary(adapterRequest("start", "12"));

    expect(picked).toMatchObject({
      status: "selected",
      selections: [{
        kind: "file",
        canonicalAbsolutePath: "C:\\Private Source\\capture.e57",
        fileCount: 1,
        identity: {
          volumeSerialNumberHex: "00000000A1B2C3D4",
          fileIdHex: "00000000000000000000000000000001",
        },
        pathEvidence: { inspectionMode: "read_only" },
        localVolumeEvidence: { dosDeviceMapping: "direct_local_volume" },
      }],
    });
    expect(output).toMatchObject({
      status: "resolved",
      outputBoundary: {
        kind: "directory",
        canonicalAbsolutePath: "D:\\Trusted Output",
        pathEvidence: { directoryTypeCheckedByHandle: true },
      },
    });
    const publicJson = JSON.stringify({ picked, output });
    expect(publicJson).not.toContain("helper_source_");
    expect(publicJson).not.toContain("helper_output_");
    expect(publicJson).not.toContain("source_ref");
    expect(publicJson).not.toContain("output_ref");
  });

  it("maps one atomic mixed drop and preserves its truthful acquisition through revalidation", async () => {
    const droppedFile = rawSelection(
      `helper_source_${"17".repeat(16)}`,
      "C:\\Dropped\\capture.e57",
      17,
      "1024",
      "windows_native_drop_cfhdrop_then_handle_open",
    );
    const droppedFolder = rawDirectorySelection(
      `helper_source_${"18".repeat(16)}`,
      "C:\\Dropped Folder",
      18,
      [],
      "0",
      "windows_native_drop_cfhdrop_then_handle_open",
    );
    const selections = [droppedFile, droppedFolder];
    const output = rawOutput();
    const dropSources = vi.fn((request) => Promise.resolve(boundResponse(request, {
      status: "selected",
      selections,
    })));
    const client = helperClient({
      drop_sources: dropSources,
      resolve_output: vi.fn((request) => Promise.resolve(boundResponse(request, {
        status: "resolved",
        output,
      }))),
      revalidate_start: vi.fn((request) => Promise.resolve(boundResponse(request, {
        status: "opened",
        scope_ref: `helper_scope_${"19".repeat(16)}`,
        evidence: {
          adapter_id: request.adapter_id,
          adapter_build_sha256: request.adapter_build_sha256,
          identity_comparison_mechanism: "windows_volume_serial_plus_file_id_128",
          path_comparison_mechanism: "windows_compare_string_ordinal_ignore_case",
          output,
          selections,
          native_path_comparisons: {
            source_pairs: [{
              left_selection_index: 1,
              right_selection_index: 2,
              relation: "disjoint",
            }],
            output_pairs: [
              { selection_index: 1, relation: "disjoint" },
              { selection_index: 2, relation: "disjoint" },
            ],
          },
        },
      }))),
    });
    const adapter = new StrictTrustedWindowsNativeSourceAdapterV1(client);

    const dropped = await adapter.dropSources(adapterRequest("add_dropped", "81"));
    expect(dropped).toMatchObject({
      operation: "add_dropped",
      status: "selected",
      selections: [
        {
          kind: "file",
          pathEvidence: {
            acquisition: "windows_native_drop_cfhdrop_then_handle_open",
          },
        },
        {
          kind: "directory",
          pathEvidence: {
            acquisition: "windows_native_drop_cfhdrop_then_handle_open",
          },
        },
      ],
    });
    expect(dropSources).toHaveBeenCalledWith({
      schema_version: 1,
      operation: "drop_sources",
      session_ref: HELPER_SESSION_REF,
      basket_session_ref: BASKET_SESSION_REF,
      request_ref: `native_request_${"81".repeat(16)}`,
      read_only: true,
      browser_path_input_accepted: false,
    });

    const resolved = await adapter.resolveOutputBoundary(adapterRequest("start", "82"));
    const scope = await adapter.openRevalidatedStartScope(
      revalidationRequest(dropped, resolved, "83"),
    );
    expect(scope.evidence.selections.map(
      (selection) => selection.pathEvidence.acquisition,
    )).toEqual([
      "windows_native_drop_cfhdrop_then_handle_open",
      "windows_native_drop_cfhdrop_then_handle_open",
    ]);
  });

  it("rejects picker evidence on drop and dropped evidence on picker", async () => {
    const pickerSelection = rawSelection(
      `helper_source_${"21".repeat(16)}`,
      "C:\\Picker\\capture.e57",
      21,
    );
    const droppedSelection = rawSelection(
      `helper_source_${"22".repeat(16)}`,
      "C:\\Dropped\\capture.e57",
      22,
      "1024",
      "windows_native_drop_cfhdrop_then_handle_open",
    );
    const dropClose = vi.fn(() => Promise.resolve());
    const pickClose = vi.fn(() => Promise.resolve());
    const dropAdapter = new StrictTrustedWindowsNativeSourceAdapterV1(helperClient({
      drop_sources: vi.fn((request) => Promise.resolve(boundResponse(request, {
        status: "selected",
        selections: [pickerSelection],
      }))),
      close_and_confirm_no_live_scopes: dropClose,
    }));
    const pickAdapter = new StrictTrustedWindowsNativeSourceAdapterV1(helperClient({
      pick_files: vi.fn((request) => Promise.resolve(boundResponse(request, {
        status: "selected",
        selections: [droppedSelection],
      }))),
      close_and_confirm_no_live_scopes: pickClose,
    }));

    await expect(dropAdapter.dropSources(adapterRequest("add_dropped", "84")))
      .rejects.toMatchObject({ code: "PRIVATE_HELPER_PROTOCOL_FAILURE" });
    await expect(pickAdapter.pickFiles(adapterRequest("add_files", "85")))
      .rejects.toMatchObject({ code: "PRIVATE_HELPER_PROTOCOL_FAILURE" });
    expect(dropClose).toHaveBeenCalledOnce();
    expect(pickClose).toHaveBeenCalledOnce();
  });

  it("keeps picker modes homogeneous while drop alone may mix kinds", async () => {
    const directory = rawDirectorySelection(
      `helper_source_${"23".repeat(16)}`,
      "C:\\Directory",
      23,
      [],
    );
    const close = vi.fn(() => Promise.resolve());
    const adapter = new StrictTrustedWindowsNativeSourceAdapterV1(helperClient({
      pick_files: vi.fn((request) => Promise.resolve(boundResponse(request, {
        status: "selected",
        selections: [directory],
      }))),
      close_and_confirm_no_live_scopes: close,
    }));

    await expect(adapter.pickFiles(adapterRequest("add_files", "86")))
      .rejects.toMatchObject({ code: "PRIVATE_HELPER_PROTOCOL_FAILURE" });
    expect(close).toHaveBeenCalledOnce();
  });

  it("poisons when a resolved output reuses a retained source identity", async () => {
    const selection = rawSelection();
    const output = rawOutput();
    const sourceIdentity = rawIdentity(1);
    output.boundary.identity = sourceIdentity;
    output.boundary.local_volume_evidence = rawLocalVolume(sourceIdentity);
    const close = vi.fn(() => Promise.resolve());
    const client = helperClient({
      pick_files: vi.fn((request) => Promise.resolve(boundResponse(request, {
        status: "selected",
        selections: [selection],
      }))),
      resolve_output: vi.fn((request) => Promise.resolve(boundResponse(request, {
        status: "resolved",
        output,
      }))),
      close_and_confirm_no_live_scopes: close,
    });
    const adapter = new StrictTrustedWindowsNativeSourceAdapterV1(client);

    await expect(adapter.pickFiles(adapterRequest("add_files", "55")))
      .resolves.toMatchObject({ status: "selected" });
    await expect(adapter.resolveOutputBoundary(adapterRequest("start", "56")))
      .rejects.toMatchObject({ code: "PRIVATE_HELPER_PROTOCOL_FAILURE" });
    expect(close).toHaveBeenCalledOnce();
  });

  it("poisons when a later picker reply reuses the retained output identity", async () => {
    const selection = rawSelection(
      `helper_source_${"57".repeat(16)}`,
      "C:\\Output Alias\\capture.e57",
      2,
    );
    const close = vi.fn(() => Promise.resolve());
    const client = helperClient({
      resolve_output: vi.fn((request) => Promise.resolve(boundResponse(request, {
        status: "resolved",
        output: rawOutput(),
      }))),
      pick_files: vi.fn((request) => Promise.resolve(boundResponse(request, {
        status: "selected",
        selections: [selection],
      }))),
      close_and_confirm_no_live_scopes: close,
    });
    const adapter = new StrictTrustedWindowsNativeSourceAdapterV1(client);

    await expect(adapter.resolveOutputBoundary(adapterRequest("start", "58")))
      .resolves.toMatchObject({ status: "resolved" });
    await expect(adapter.pickFiles(adapterRequest("add_files", "59")))
      .rejects.toMatchObject({ code: "PRIVATE_HELPER_PROTOCOL_FAILURE" });
    expect(close).toHaveBeenCalledOnce();
  });

  it("also rejects a retained output identity hidden in a later folder inventory", async () => {
    const selection = rawDirectorySelection(
      `helper_source_${"63".repeat(16)}`,
      "C:\\Output Inventory Alias",
      3,
      [2],
    );
    const close = vi.fn(() => Promise.resolve());
    const client = helperClient({
      resolve_output: vi.fn((request) => Promise.resolve(boundResponse(request, {
        status: "resolved",
        output: rawOutput(),
      }))),
      pick_folder: vi.fn((request) => Promise.resolve(boundResponse(request, {
        status: "selected",
        selections: [selection],
      }))),
      close_and_confirm_no_live_scopes: close,
    });
    const adapter = new StrictTrustedWindowsNativeSourceAdapterV1(client);

    await expect(adapter.resolveOutputBoundary(adapterRequest("start", "64")))
      .resolves.toMatchObject({ status: "resolved" });
    await expect(adapter.pickFolder(adapterRequest("add_folder", "65")))
      .rejects.toMatchObject({ code: "PRIVATE_HELPER_PROTOCOL_FAILURE" });
    expect(close).toHaveBeenCalledOnce();
  });

  it("poisons instead of retaining a second successfully resolved output", async () => {
    let invocation = 0;
    const first = rawOutput();
    const second = rawOutput(`helper_output_${"60".repeat(16)}`);
    const secondIdentity = rawIdentity(3);
    second.boundary.identity = secondIdentity;
    second.boundary.local_volume_evidence = rawLocalVolume(secondIdentity);
    const close = vi.fn(() => Promise.resolve());
    const resolveOutput = vi.fn((request) => {
      invocation += 1;
      return Promise.resolve(boundResponse(request, {
        status: "resolved",
        output: invocation === 1 ? first : second,
      }));
    });
    const adapter = new StrictTrustedWindowsNativeSourceAdapterV1(helperClient({
      resolve_output: resolveOutput,
      close_and_confirm_no_live_scopes: close,
    }));

    await expect(adapter.resolveOutputBoundary(adapterRequest("start", "61")))
      .resolves.toMatchObject({ status: "resolved" });
    await expect(adapter.resolveOutputBoundary(adapterRequest("start", "62")))
      .rejects.toMatchObject({ code: "PRIVATE_HELPER_PROTOCOL_FAILURE" });
    expect(resolveOutput).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledOnce();
  });

  it.each([
    "Room\\capture.e57",
    "\\\\server\\share\\capture.e57",
    "\\\\?\\C:\\Room\\capture.e57",
    "\\\\.\\C:\\Room\\capture.e57",
    "\\??\\C:\\Room\\capture.e57",
    "c:\\Room\\capture.e57",
    "C:/Room/capture.e57",
    "C:\\Room\\..\\capture.e57",
    "C:\\Room\\CON.txt",
    "C:\\Room\\bad\u202Ename.e57",
    "C:\\Room\\bad\u0001name.e57",
    "C:\\Room\\trailing.\\capture.e57",
    "C:\\Room\\trailing \\capture.e57",
  ])("rejects a non-canonical or unsafe private path: %s", async (path) => {
    const close = vi.fn(() => Promise.resolve());
    const client = helperClient({
      pick_files: vi.fn((request) => Promise.resolve(boundResponse(request, {
        status: "selected",
        selections: [rawSelection(undefined, path)],
      }))),
      close_and_confirm_no_live_scopes: close,
    });
    const adapter = new StrictTrustedWindowsNativeSourceAdapterV1(client);

    await expect(adapter.pickFiles(adapterRequest("add_files", "41")))
      .rejects.toMatchObject({ code: "PRIVATE_HELPER_PROTOCOL_FAILURE" });
    expect(close).toHaveBeenCalledOnce();
  });

  it("requires canonical and resolved paths to be exactly equal", async () => {
    const selection = rawSelection();
    selection.evidence.resolved_absolute_path = "C:\\Private Source\\other.e57";
    const client = helperClient({
      pick_files: vi.fn((request) => Promise.resolve(boundResponse(request, {
        status: "selected",
        selections: [selection],
      }))),
    });
    const adapter = new StrictTrustedWindowsNativeSourceAdapterV1(client);

    await expect(adapter.pickFiles(adapterRequest("add_files", "42")))
      .rejects.toMatchObject({ code: "PRIVATE_HELPER_PROTOCOL_FAILURE" });
  });

  it("rejects duplicate inventory identities and cross-volume inventory entries", async () => {
    const duplicateInventory = rawDirectorySelection(
      `helper_source_${"41".repeat(16)}`,
      "C:\\Directory One",
      10,
      [11, 11],
    );
    const crossVolume = rawDirectorySelection(
      `helper_source_${"42".repeat(16)}`,
      "C:\\Directory Two",
      20,
      [21],
    );
    crossVolume.evidence.inventory_file_identities[0]!.volume_serial_number_hex =
      "00000000DEADBEEF";
    for (const [index, selection] of [duplicateInventory, crossVolume].entries()) {
      const client = helperClient({
        pick_folder: vi.fn((request) => Promise.resolve(boundResponse(request, {
          status: "selected",
          selections: [selection],
        }))),
      });
      const adapter = new StrictTrustedWindowsNativeSourceAdapterV1(client);
      await expect(adapter.pickFolder(adapterRequest("add_folder", index === 0 ? "43" : "44")))
        .rejects.toMatchObject({ code: "PRIVATE_HELPER_PROTOCOL_FAILURE" });
    }
  });

  it("requires a file root to equal its sole inventory identity", async () => {
    const selection = rawSelection();
    selection.evidence.inventory_file_identities = [rawIdentity(99)];
    const client = helperClient({
      pick_files: vi.fn((request) => Promise.resolve(boundResponse(request, {
        status: "selected",
        selections: [selection],
      }))),
    });
    const adapter = new StrictTrustedWindowsNativeSourceAdapterV1(client);
    await expect(adapter.pickFiles(adapterRequest("add_files", "45")))
      .rejects.toMatchObject({ code: "PRIVATE_HELPER_PROTOCOL_FAILURE" });
  });

  it("rejects duplicate identities within one reply and across picker calls", async () => {
    const first = rawSelection(
      `helper_source_${"43".repeat(16)}`,
      "C:\\Source One\\capture.e57",
      71,
    );
    const duplicate = rawSelection(
      `helper_source_${"44".repeat(16)}`,
      "C:\\Source Two\\capture.e57",
      71,
    );
    const withinClient = helperClient({
      pick_files: vi.fn((request) => Promise.resolve(boundResponse(request, {
        status: "selected",
        selections: [first, duplicate],
      }))),
    });
    await expect(new StrictTrustedWindowsNativeSourceAdapterV1(withinClient)
      .pickFiles(adapterRequest("add_files", "46")))
      .rejects.toMatchObject({ code: "PRIVATE_HELPER_PROTOCOL_FAILURE" });

    let invocation = 0;
    const acrossClient = helperClient({
      pick_files: vi.fn((request) => {
        invocation += 1;
        return Promise.resolve(boundResponse(request, {
          status: "selected",
          selections: [invocation === 1 ? first : duplicate],
        }));
      }),
    });
    const acrossAdapter = new StrictTrustedWindowsNativeSourceAdapterV1(acrossClient);
    await expect(acrossAdapter.pickFiles(adapterRequest("add_files", "47")))
      .resolves.toMatchObject({ status: "selected" });
    await expect(acrossAdapter.pickFiles(adapterRequest("add_files", "48")))
      .rejects.toMatchObject({ code: "PRIVATE_HELPER_PROTOCOL_FAILURE" });
  });

  it("enforces cumulative retained bytes across picker calls", async () => {
    let invocation = 0;
    const selections = [1, 2, 3].map((seed) => rawSelection(
      `helper_source_${String(50 + seed).repeat(16)}`,
      `C:\\Source ${String(seed)}\\capture.e57`,
      80 + seed,
      "4398046511104",
    ));
    const client = helperClient({
      pick_files: vi.fn((request) => {
        const selection = selections[invocation];
        invocation += 1;
        return Promise.resolve(boundResponse(request, {
          status: "selected",
          selections: selection === undefined ? [] : [selection],
        }));
      }),
    });
    const adapter = new StrictTrustedWindowsNativeSourceAdapterV1(client);
    await expect(adapter.pickFiles(adapterRequest("add_files", "49")))
      .resolves.toMatchObject({ status: "selected" });
    await expect(adapter.pickFiles(adapterRequest("add_files", "50")))
      .resolves.toMatchObject({ status: "selected" });
    await expect(adapter.pickFiles(adapterRequest("add_files", "51")))
      .rejects.toMatchObject({ code: "PRIVATE_HELPER_PROTOCOL_FAILURE" });
  });

  it("enforces cumulative retained file count across picker calls", async () => {
    const manyFiles = rawDirectorySelection(
      `helper_source_${"54".repeat(16)}`,
      "C:\\Large Directory",
      100,
      Array.from({ length: 100_000 }, (_, index) => 1_000 + index),
      "100000",
    );
    const client = helperClient({
      pick_folder: vi.fn((request) => Promise.resolve(boundResponse(request, {
        status: "selected",
        selections: [manyFiles],
      }))),
      pick_files: vi.fn((request) => Promise.resolve(boundResponse(request, {
        status: "selected",
        selections: [rawSelection(`helper_source_${"55".repeat(16)}`, undefined, 200_000)],
      }))),
    });
    const adapter = new StrictTrustedWindowsNativeSourceAdapterV1(client);
    await expect(adapter.pickFolder(adapterRequest("add_folder", "52")))
      .resolves.toMatchObject({ status: "selected" });
    await expect(adapter.pickFiles(adapterRequest("add_files", "53")))
      .rejects.toMatchObject({ code: "PRIVATE_HELPER_PROTOCOL_FAILURE" });
  });

  it("rejects adapter-shaped relation names from the raw helper vocabulary", async () => {
    const client = helperClient({
      compare_paths: vi.fn((request) => Promise.resolve(boundResponse(request, {
        status: "compared",
        comparison_authority: "windows_compare_string_ordinal_ignore_case",
        relation: "left_ancestor",
      }))),
    });
    const adapter = new StrictTrustedWindowsNativeSourceAdapterV1(client);
    await expect(adapter.compareCanonicalPaths(compareRequest("54")))
      .rejects.toMatchObject({ code: "PRIVATE_HELPER_PROTOCOL_FAILURE" });
  });

  it("opens one opaque retained scope and returns an own data-property release", async () => {
    const client = custodyClient();
    const adapter = new StrictTrustedWindowsNativeSourceAdapterV1(client);
    const picked = await adapter.pickFiles(adapterRequest("add_files", "13"));
    const output = await adapter.resolveOutputBoundary(adapterRequest("start", "14"));
    const request = revalidationRequest(picked, output, "15");

    const scope = await adapter.openRevalidatedStartScope(request);
    const descriptor = Object.getOwnPropertyDescriptor(scope, "release");
    expect(descriptor).toMatchObject({ enumerable: true });
    expect(descriptor === undefined || "get" in descriptor).toBe(false);
    expect(typeof descriptor?.value).toBe("function");
    expect(JSON.stringify(scope.evidence)).not.toContain("helper_scope_");
    expect(JSON.stringify(scope.evidence)).not.toContain("helper_source_");
    expect(JSON.stringify(scope.evidence)).not.toContain("helper_output_");

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const open = vi.mocked(client.revalidate_start);
    expect(open).toHaveBeenCalledWith({
      schema_version: 1,
      operation: "revalidate_start",
      session_ref: HELPER_SESSION_REF,
      basket_session_ref: BASKET_SESSION_REF,
      request_ref: request.requestRef,
      adapter_id: request.adapterId,
      adapter_build_sha256: request.adapterBuildSha256,
      expected_source_refs: [`helper_source_${"d4".repeat(16)}`],
      expected_output_ref: `helper_output_${"e5".repeat(16)}`,
      read_only: true,
      browser_path_input_accepted: false,
    });

    await expect(scope.release()).resolves.toEqual({
      schemaVersion: "trusted-windows-native-revalidated-start-release.v1",
      requestRef: request.requestRef,
      sessionRef: request.sessionRef,
      operation: "release_revalidated_start",
      status: "released",
    });
    await expect(scope.release()).rejects.toMatchObject({
      code: "REVALIDATED_SCOPE_RELEASE_FAILED",
    });
  });

  it("lets close win during the release public-promise handoff", async () => {
    const pending = deferred<unknown>();
    let settleRelease: () => void = () => {
      throw new Error("Missing release request.");
    };
    const close = vi.fn(() => Promise.resolve());
    const client = custodyClient({
      release_revalidated_start: vi.fn((request) => {
        settleRelease = () => {
          pending.resolve(boundResponse(request, {
            scope_ref: request.scope_ref,
            status: "released",
          }));
        };
        return pending.promise;
      }),
      close_and_confirm_no_live_scopes: close,
    });
    const adapter = new StrictTrustedWindowsNativeSourceAdapterV1(client);
    const picked = await adapter.pickFiles(adapterRequest("add_files", "73"));
    const output = await adapter.resolveOutputBoundary(adapterRequest("start", "74"));
    const scope = await adapter.openRevalidatedStartScope(
      revalidationRequest(picked, output, "75"),
    );
    const releasing = scope.release();
    void releasing.catch(() => undefined);
    settleRelease();

    const closeStarted = deferred<undefined>();
    let closing: Promise<void> | null = null;
    let stateProbe: Promise<"pending" | "settled"> | null = null;
    afterMicrotasks(2, () => {
      stateProbe = Promise.race([
        releasing.then(
          () => "settled" as const,
          () => "settled" as const,
        ),
        Promise.resolve("pending" as const),
      ]);
      closing = adapter.closeAndConfirmNoLiveScopes();
      closeStarted.resolve(undefined);
    });

    await closeStarted.promise;
    await expect(stateProbe).resolves.toBe("pending");
    await expect(closing).resolves.toBeUndefined();
    await expect(releasing).rejects.toMatchObject({ code: "ADAPTER_SESSION_CLOSED" });
    expect(close).toHaveBeenCalledOnce();
  });

  it("confirms full-session cleanup after an exact no-live-scope rejection", async () => {
    const release = vi.fn(() => Promise.resolve({ status: "should_not_run" }));
    const close = vi.fn(() => Promise.resolve());
    const client = custodyClient({
      revalidate_start: vi.fn((request) => Promise.resolve(boundResponse(request, {
        status: "rejected",
        no_live_scope: true,
      }))),
      release_revalidated_start: release,
      close_and_confirm_no_live_scopes: close,
    });
    const adapter = new StrictTrustedWindowsNativeSourceAdapterV1(client);
    const picked = await adapter.pickFiles(adapterRequest("add_files", "16"));
    const output = await adapter.resolveOutputBoundary(adapterRequest("start", "17"));

    await expect(adapter.openRevalidatedStartScope(revalidationRequest(picked, output, "18")))
      .rejects.toMatchObject({ code: "REVALIDATED_SCOPE_REJECTED" });
    expect(release).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes before rejecting a pre-helper revalidation evidence mismatch", async () => {
    const close = vi.fn(() => Promise.resolve());
    const client = custodyClient({ close_and_confirm_no_live_scopes: close });
    const adapter = new StrictTrustedWindowsNativeSourceAdapterV1(client);
    const picked = await adapter.pickFiles(adapterRequest("add_files", "67"));
    const output = await adapter.resolveOutputBoundary(adapterRequest("start", "68"));
    const request = revalidationRequest(picked, output, "69");
    const expected = request.expectedSelections[0];
    if (expected === undefined) throw new Error("Missing expected selection.");
    const mismatched: TrustedWindowsNativeRevalidatedStartRequestV1 = {
      ...request,
      expectedSelections: [{ ...expected, byteCountDecimal: "2048" }],
    };

    await expect(adapter.openRevalidatedStartScope(mismatched)).rejects.toMatchObject({
      code: "PRIVATE_HELPER_PROTOCOL_FAILURE",
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(vi.mocked(client.revalidate_start)).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it("lets cleanup uncertainty override an exact no-live-scope rejection", async () => {
    const close = vi.fn(() => Promise.reject(new Error("private teardown detail")));
    const client = custodyClient({
      revalidate_start: vi.fn((request) => Promise.resolve(boundResponse(request, {
        status: "rejected",
        no_live_scope: true,
      }))),
      close_and_confirm_no_live_scopes: close,
    });
    const adapter = new StrictTrustedWindowsNativeSourceAdapterV1(client);
    const picked = await adapter.pickFiles(adapterRequest("add_files", "70"));
    const output = await adapter.resolveOutputBoundary(adapterRequest("start", "71"));

    await expect(adapter.openRevalidatedStartScope(revalidationRequest(picked, output, "72")))
      .rejects.toMatchObject({
        code: "HELPER_TEARDOWN_UNCONFIRMED",
        message: "The trusted Windows helper process could not be confirmed stopped.",
      });
    expect(close).toHaveBeenCalledOnce();
  });

  it("confirms teardown when an open-scope response is lost", async () => {
    const privateText = "scope may exist at C:\\Private Source\\capture.e57";
    const close = vi.fn(() => Promise.resolve());
    const client = custodyClient({
      revalidate_start: vi.fn(() => Promise.reject(new Error(privateText))),
      close_and_confirm_no_live_scopes: close,
    });
    const adapter = new StrictTrustedWindowsNativeSourceAdapterV1(client);
    const picked = await adapter.pickFiles(adapterRequest("add_files", "23"));
    const output = await adapter.resolveOutputBoundary(adapterRequest("start", "24"));

    let thrown: unknown;
    try {
      await adapter.openRevalidatedStartScope(revalidationRequest(picked, output, "25"));
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: "PRIVATE_HELPER_OPERATION_FAILED" });
    expect((thrown as Error).message).not.toContain(privateText);
    expect(close).toHaveBeenCalledOnce();
  });

  it("reports unconfirmed teardown when a lost open reply cannot be cleaned up", async () => {
    const close = vi.fn(() => Promise.reject(new Error("private process detail")));
    const client = custodyClient({
      revalidate_start: vi.fn(() => Promise.reject(new Error("private scope detail"))),
      close_and_confirm_no_live_scopes: close,
    });
    const adapter = new StrictTrustedWindowsNativeSourceAdapterV1(client);
    const picked = await adapter.pickFiles(adapterRequest("add_files", "26"));
    const output = await adapter.resolveOutputBoundary(adapterRequest("start", "27"));

    await expect(adapter.openRevalidatedStartScope(revalidationRequest(picked, output, "28")))
      .rejects.toMatchObject({
        code: "HELPER_TEARDOWN_UNCONFIRMED",
        message: "The trusted Windows helper process could not be confirmed stopped.",
      });
    expect(close).toHaveBeenCalledOnce();
  });

  it("preserves teardown uncertainty across the strict adapter and V1 controller boundary", async () => {
    const privateText = "helper may still hold C:\\Private Source\\capture.e57";
    const close = vi.fn()
      .mockRejectedValueOnce(new Error(privateText))
      .mockResolvedValueOnce(undefined);
    const client = custodyClient({
      compare_paths: vi.fn((request) => Promise.resolve(boundResponse(request, {
        status: "compared",
        comparison_authority: "windows_compare_string_ordinal_ignore_case",
        relation: "disjoint",
      }))),
      revalidate_start: vi.fn(() => Promise.reject(new Error(privateText))),
      close_and_confirm_no_live_scopes: close,
    });
    const adapter = new StrictTrustedWindowsNativeSourceAdapterV1(client);
    let sinkCalls = 0;
    const basket = new TrustedWindowsNativeSourceBasketControllerV1({
      adapter,
      adapterId: "venviewer.windows-native-picker.v1",
      trustedAdapterBuildSha256: `sha256:${"a1".repeat(32)}`,
      randomBytes: deterministicRandomBytes(81),
      acceptTrustedStartInput() {
        sinkCalls += 1;
      },
    });
    const added = await basket.dispatch(basketEvent(basket.getView(), "add_files"));

    let thrown: unknown;
    try {
      await basket.dispatch(basketEvent(added.view, "start"));
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TrustedWindowsNativeSourceBasketV1Error);
    expect(thrown).toMatchObject({
      code: "HELPER_TEARDOWN_UNCONFIRMED",
      message: "The trusted Windows helper process could not be confirmed stopped.",
    });
    expect((thrown as Error).message).not.toContain(privateText);
    expect((thrown as Error).message).not.toContain("Private Source");
    expect(basket.getView()).toMatchObject({ status: "cancelled", nextEvent: null });
    expect(sinkCalls).toBe(0);
    expect(close).toHaveBeenCalledOnce();

    await expect(adapter.closeAndConfirmNoLiveScopes()).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("closes and poisons the helper on an inexact private picker response", async () => {
    const privateText = "C:\\Private Person\\never-public.e57";
    const close = vi.fn(() => Promise.resolve());
    const client = helperClient({
      pick_files: vi.fn((request) => Promise.resolve({
        ...boundResponse(request, { status: "selected", selections: [rawSelection()] }),
        private_debug: privateText,
      })),
      close_and_confirm_no_live_scopes: close,
    });
    const adapter = new StrictTrustedWindowsNativeSourceAdapterV1(client);

    let thrown: unknown;
    try {
      await adapter.pickFiles(adapterRequest("add_files", "19"));
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: "PRIVATE_HELPER_PROTOCOL_FAILURE" });
    expect((thrown as Error).message).not.toContain(privateText);
    expect((thrown as Error).message).not.toContain("Private Person");
    expect(close).toHaveBeenCalledOnce();
  });

  it("preserves release failure after confirmed cleanup", async () => {
    const close = vi.fn(() => Promise.resolve());
    const client = custodyClient({
      release_revalidated_start: vi.fn((request) => Promise.resolve(boundResponse(request, {
        scope_ref: `helper_scope_${"00".repeat(16)}`,
        status: "released",
      }))),
      close_and_confirm_no_live_scopes: close,
    });
    const adapter = new StrictTrustedWindowsNativeSourceAdapterV1(client);
    const picked = await adapter.pickFiles(adapterRequest("add_files", "20"));
    const output = await adapter.resolveOutputBoundary(adapterRequest("start", "21"));
    const scope = await adapter.openRevalidatedStartScope(
      revalidationRequest(picked, output, "22"),
    );

    await expect(scope.release()).rejects.toMatchObject({
      code: "REVALIDATED_SCOPE_RELEASE_FAILED",
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects missing helper capabilities before any private operation", () => {
    expect(() => new StrictTrustedWindowsNativeSourceAdapterV1(helperClient({
      capabilities: ["compare_paths", "close"],
    }))).toThrow(expect.objectContaining({
      code: "INVALID_HELPER_CLIENT",
      message: "The trusted Windows helper client is unavailable.",
    }));
  });

  it("rejects all-zero helper, basket, and request references before use", async () => {
    expect(() => new StrictTrustedWindowsNativeSourceAdapterV1(helperClient({
      session_ref: `helper_session_${"0".repeat(32)}`,
    }))).toThrow(expect.objectContaining({
      code: "INVALID_HELPER_CLIENT",
      message: "The trusted Windows helper client is unavailable.",
    }));

    const adapter = new StrictTrustedWindowsNativeSourceAdapterV1(helperClient());
    await expect(adapter.compareCanonicalPaths(compareRequest("00"))).rejects.toMatchObject({
      code: "PRIVATE_HELPER_PROTOCOL_FAILURE",
    });

    const secondAdapter = new StrictTrustedWindowsNativeSourceAdapterV1(helperClient());
    await expect(secondAdapter.compareCanonicalPaths(compareRequest(
      "01",
      `basket_${"0".repeat(32)}`,
    ))).rejects.toMatchObject({
      code: "PRIVATE_HELPER_PROTOCOL_FAILURE",
    });

    const thirdAdapter = new StrictTrustedWindowsNativeSourceAdapterV1(helperClient());
    await expect(thirdAdapter.pickFiles(adapterRequest("add_files", "00")))
      .rejects.toMatchObject({ code: "PRIVATE_HELPER_PROTOCOL_FAILURE" });
  });

  it("keeps the current process-backed factory explicitly unavailable", async () => {
    const adapter = createProcessBackedTrustedWindowsNativeSourceAdapterV1();
    await expect(adapter.pickFiles(adapterRequest("add_files"))).resolves.toMatchObject({
      status: "unavailable",
      code: "WINDOWS_NATIVE_BRIDGE_UNAVAILABLE",
    });
    await expect(adapter.closeAndConfirmNoLiveScopes()).resolves.toBeUndefined();
  });
});
