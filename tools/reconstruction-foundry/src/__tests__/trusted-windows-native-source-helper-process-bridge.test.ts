import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TRUSTED_WINDOWS_NATIVE_HELPER_BUILD_IDENTIFIER_V1,
  TRUSTED_WINDOWS_NATIVE_HELPER_CAPABILITIES_V1,
  deriveTrustedWindowsNativeHelperChallengeResponseV1,
} from "../trusted-windows-native-source-helper-protocol.js";
import {
  TrustedWindowsNativeHelperBridgeErrorV1,
  generateTrustedWindowsNativeHelperReferenceForTestingV1,
  launchTrustedWindowsNativeHelperProcessBridgeForTestingV1,
  mapTrustedWindowsNativeHelperFailureForBrowserV1,
  type TrustedWindowsNativeHelperBridgeConfigurationV1,
  type TrustedWindowsNativeHelperChildFactoryV1,
  type TrustedWindowsNativeHelperProcessBridgeV1,
} from "../trusted-windows-native-source-helper-process-bridge.js";

const MAX_HELPER_RESPONSE_BYTES = 32 * 1_024 * 1_024;
const temporaryDirectories: string[] = [];

interface SpawnCall {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: Parameters<TrustedWindowsNativeHelperChildFactoryV1>[2];
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

interface HostileThrownValue {
  readonly value: Error;
  readonly reads: {
    property: number;
    prototype: number;
  };
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolveValue) => {
    resolvePromise = resolveValue;
  });
  return { promise, resolve: resolvePromise };
}

function hostileThrownValue(): HostileThrownValue {
  const holder = { value: new Error("uninitialized hostile thrown value") };
  const reads = { property: 0, prototype: 0 };
  const propertyReads = (): never => {
    reads.property += 1;
    throw holder.value;
  };
  const prototypeReads = (): never => {
    reads.prototype += 1;
    throw holder.value;
  };
  const value = new Proxy(new Error("private hostile thrown value"), {
    get: propertyReads,
    getPrototypeOf: prototypeReads,
  });
  holder.value = value;
  return { value, reads };
}

function replaceInputWriteWithThrownValue(
  child: FakeNativeHelperChild,
  thrownValue: Error,
): void {
  Object.defineProperty(child.stdin, "write", {
    configurable: true,
    value: () => {
      throw thrownValue;
    },
  });
}

class ProtocolInput extends Writable {
  readonly messages: Record<string, unknown>[] = [];
  failWrites = false;
  #remainder = "";
  readonly #onMessage: (message: Record<string, unknown>) => void;

  constructor(onMessage: (message: Record<string, unknown>) => void) {
    super();
    this.#onMessage = onMessage;
  }

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    if (this.failWrites) {
      callback(new Error("private native write failure at C:\\secret\\source.e57"));
      return;
    }
    this.#remainder += chunk.toString("utf8");
    for (;;) {
      const newline = this.#remainder.indexOf("\n");
      if (newline < 0) break;
      const line = this.#remainder.slice(0, newline);
      this.#remainder = this.#remainder.slice(newline + 1);
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        callback(new Error("invalid test request"));
        return;
      }
      const message = parsed as Record<string, unknown>;
      this.messages.push(message);
      this.#onMessage(message);
    }
    callback();
  }
}

class FakeNativeHelperChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin: ProtocolInput;
  readonly killSignals: (NodeJS.Signals | number | undefined)[] = [];
  autoCloseOnKill = true;
  #closed = false;

  constructor(onMessage: (message: Record<string, unknown>) => void) {
    super();
    this.stdin = new ProtocolInput(onMessage);
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    this.killSignals.push(signal);
    if (this.autoCloseOnKill) {
      queueMicrotask(() => {
        this.close(null, typeof signal === "string" ? signal : "SIGKILL");
      });
    }
    return true;
  }

  send(message: Readonly<Record<string, unknown>>): void {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }

  sendOneByteFragments(bytes: Buffer): void {
    for (const byte of bytes) {
      this.stdout.emit("data", Buffer.from([byte]));
    }
  }

  close(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.#closed) return;
    this.#closed = true;
    this.stdout.end();
    this.stderr.end();
    this.stdin.end();
    this.emit("close", code, signal);
  }
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
    await rm(directory, { force: true, recursive: true });
  }));
});

async function executableFixture(
  bytes = Buffer.from("trusted helper fixture bytes", "utf8"),
): Promise<TrustedWindowsNativeHelperBridgeConfigurationV1> {
  const directory = await mkdtemp(join(tmpdir(), "foundry-native-helper-"));
  temporaryDirectories.push(directory);
  const executablePath = join(directory, "venviewer-windows-source-helper.exe");
  await writeFile(executablePath, bytes);
  return {
    executablePath,
    expectedExecutableSha256:
      `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  };
}

function handshakeResponse(message: Record<string, unknown>): Record<string, unknown> {
  const sessionRef = message.session_ref;
  const challenge = message.challenge;
  const expectedHelperSha256 = message.expected_helper_sha256;
  if (typeof sessionRef !== "string" || typeof challenge !== "string" ||
    typeof expectedHelperSha256 !== "string") {
    throw new Error("invalid test handshake");
  }
  return {
    type: "handshake_ok",
    schema_version: 1,
    session_ref: sessionRef,
    process_architecture: "x86_64",
    build_identifier: TRUSTED_WINDOWS_NATIVE_HELPER_BUILD_IDENTIFIER_V1,
    self_observed_image_sha256: expectedHelperSha256,
    challenge_response_sha256:
      deriveTrustedWindowsNativeHelperChallengeResponseV1({
        challengeHex: challenge,
        expectedHelperSha256,
      }),
    capabilities: [...TRUSTED_WINDOWS_NATIVE_HELPER_CAPABILITIES_V1],
  };
}

function fakeFactory(
  onMessage: (
    child: FakeNativeHelperChild,
    message: Record<string, unknown>,
  ) => void = () => undefined,
): {
  readonly factory: TrustedWindowsNativeHelperChildFactoryV1;
  readonly spawned: Promise<FakeNativeHelperChild>;
  readonly calls: SpawnCall[];
} {
  const spawned = deferred<FakeNativeHelperChild>();
  const calls: SpawnCall[] = [];
  const factory: TrustedWindowsNativeHelperChildFactoryV1 = (
    command,
    args,
    options,
  ) => {
    const child = new FakeNativeHelperChild((message) => {
      if (message.type === "handshake") child.send(handshakeResponse(message));
      else onMessage(child, message);
    });
    calls.push({ command, args: [...args], options });
    spawned.resolve(child);
    return child;
  };
  return { factory, spawned: spawned.promise, calls };
}

async function launchWithFake(
  onMessage?: (child: FakeNativeHelperChild, message: Record<string, unknown>) => void,
): Promise<{
  readonly bridge: TrustedWindowsNativeHelperProcessBridgeV1;
  readonly child: FakeNativeHelperChild;
  readonly configuration: TrustedWindowsNativeHelperBridgeConfigurationV1;
  readonly calls: SpawnCall[];
}> {
  const configuration = await executableFixture();
  const fake = fakeFactory(onMessage);
  const bridge = await launchTrustedWindowsNativeHelperProcessBridgeForTestingV1(
    configuration,
    fake.factory,
  );
  return {
    bridge,
    child: await fake.spawned,
    configuration,
    calls: fake.calls,
  };
}

function respondToCompare(
  child: FakeNativeHelperChild,
  message: Record<string, unknown>,
  relation: "same" | "ancestor" | "descendant" | "disjoint" = "disjoint",
): void {
  child.send({
    type: "compare_paths_ok",
    schema_version: 1,
    session_ref: message.session_ref,
    request_ref: message.request_ref,
    sequence: message.sequence,
    relation,
  });
}

function respondToClose(
  child: FakeNativeHelperChild,
  message: Record<string, unknown>,
  code = 0,
): void {
  child.send({
    type: "close_ok",
    schema_version: 1,
    session_ref: message.session_ref,
    request_ref: message.request_ref,
    control_sequence: message.control_sequence,
  });
  queueMicrotask(() => {
    child.close(code);
  });
}

const BASKET_REF = `basket_${"1a".repeat(16)}`;
const NATIVE_REQUEST_REF = `native_request_${"2b".repeat(16)}`;
const OUTPUT_REQUEST_REF = `native_request_${"3c".repeat(16)}`;
const START_REQUEST_REF = `revalidated_start_${"4d".repeat(16)}`;
const SOURCE_REF = `helper_source_${"5e".repeat(16)}`;
const OUTPUT_REF = `helper_output_${"6f".repeat(16)}`;
const SCOPE_REF = `helper_scope_${"70".repeat(16)}`;
const SOURCE_FILE_REF = `helper_source_file_${"81".repeat(16)}`;
const RUN_REF = `helper_run_${"92".repeat(16)}`;
const OUTPUT_FILE_REF = `helper_output_file_${"a3".repeat(16)}`;
const VOLUME_SERIAL = "A1B2C3D4E5F60718";
const SOURCE_FILE_ID = "00112233445566778899AABBCCDDEEFF";
const OUTPUT_ROOT_ID = "102132435465768798A9BACBDCEDFE0F";
const RUN_ID = "2031425364758697A8B9CADBECFD0E1F";
const OUTPUT_FILE_ID = "30415263748596A7B8C9DAEBFC0D1E2F";

function identity(fileIdHex: string): Record<string, unknown> {
  return {
    volume_serial_number_hex: VOLUME_SERIAL,
    file_id_hex: fileIdHex,
  };
}

function localVolumeEvidence(): Record<string, unknown> {
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
    opened_handle_volume_serial_number_hex: VOLUME_SERIAL,
    volume_root_handle_serial_number_hex: VOLUME_SERIAL,
  };
}

function sourceSelection(
  acquisition:
    | "windows_native_picker_handle"
    | "windows_native_drop_cfhdrop_then_handle_open" = "windows_native_picker_handle",
): Record<string, unknown> {
  return {
    source_ref: SOURCE_REF,
    evidence: {
      kind: "file",
      canonical_absolute_path: "C:\\capture.e57",
      resolved_absolute_path: "C:\\capture.e57",
      byte_count_decimal: "4",
      file_count: 1,
      identity: identity(SOURCE_FILE_ID),
      inventory_file_identities: [identity(SOURCE_FILE_ID)],
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
      local_volume_evidence: localVolumeEvidence(),
    },
  };
}

function droppedDirectorySelection(): Record<string, unknown> {
  return {
    source_ref: `helper_source_${"7a".repeat(16)}`,
    evidence: {
      kind: "directory",
      canonical_absolute_path: "C:\\capture-folder",
      resolved_absolute_path: "C:\\capture-folder",
      byte_count_decimal: "0",
      file_count: 0,
      identity: identity("112233445566778899AABBCCDDEEFF00"),
      inventory_file_identities: [],
      path_evidence: {
        acquisition: "windows_native_drop_cfhdrop_then_handle_open",
        canonicalization: "final_path_by_handle",
        inspection_mode: "read_only",
        path_identity_checked_by_handle: true,
        reparse_inspection_scope: "volume_root_through_complete_selection",
        reparse_inspection_complete: true,
        reparse_points_encountered: 0,
        inventory_complete: true,
        regular_files_only: true,
      },
      local_volume_evidence: localVolumeEvidence(),
    },
  };
}

function droppedFileSelection(): Record<string, unknown> {
  return sourceSelection("windows_native_drop_cfhdrop_then_handle_open");
}

function outputBoundary(): Record<string, unknown> {
  return {
    output_ref: OUTPUT_REF,
    boundary: {
      kind: "directory",
      canonical_absolute_path: "D:\\output",
      resolved_absolute_path: "D:\\output",
      identity: identity(OUTPUT_ROOT_ID),
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
      local_volume_evidence: localVolumeEvidence(),
    },
  };
}

describe("trusted Windows native helper process bridge V1", () => {
  it("retries all-zero helper references and fails closed after eight attempts", () => {
    let sessionCalls = 0;
    const sessionRef = generateTrustedWindowsNativeHelperReferenceForTestingV1(
      "session",
      (size) => {
        sessionCalls += 1;
        return new Uint8Array(size).fill(sessionCalls === 1 ? 0 : 1);
      },
    );
    expect(sessionCalls).toBe(2);
    expect(sessionRef).toBe(`helper_session_${"01".repeat(16)}`);

    expect(generateTrustedWindowsNativeHelperReferenceForTestingV1(
      "request",
      (size) => new Uint8Array(size).fill(2),
    )).toBe(`helper_request_${"02".repeat(16)}`);

    let zeroCalls = 0;
    try {
      generateTrustedWindowsNativeHelperReferenceForTestingV1("request", (size) => {
        zeroCalls += 1;
        return new Uint8Array(size);
      });
      expect.fail("eight all-zero values must fail closed");
    } catch (error) {
      expect(error).toBeInstanceOf(TrustedWindowsNativeHelperBridgeErrorV1);
      if (!(error instanceof TrustedWindowsNativeHelperBridgeErrorV1)) throw error;
      expect(error.code).toBe("INVALID_TRUSTED_CONFIGURATION");
    }
    expect(zeroCalls).toBe(8);
  });

  it("verifies bytes before an exact, pipe-only, zero-argument spawn", async () => {
    const secretKey = "FOUNDRY_NATIVE_HELPER_TEST_SECRET";
    const previousSecret = process.env[secretKey];
    process.env[secretKey] = "must-not-cross";
    try {
      const launched = await launchWithFake((child, message) => {
        if (message.type === "close") respondToClose(child, message);
      });
      const call = launched.calls[0];
      expect(call).toBeDefined();
      expect(call?.command).toBe(launched.configuration.executablePath);
      expect(call?.args).toEqual([]);
      expect(call?.options).toMatchObject({
        cwd: join(launched.configuration.executablePath, ".."),
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
        windowsHide: true,
        detached: false,
      });
      expect(call?.options.env).not.toHaveProperty("PATH");
      expect(call?.options.env).not.toHaveProperty(secretKey);
      expect(call?.options.env).toEqual(expect.objectContaining({ NO_COLOR: "1" }));
      await launched.bridge.close();
    } finally {
      if (previousSecret === undefined) Reflect.deleteProperty(process.env, secretKey);
      else process.env[secretKey] = previousSecret;
    }
  });

  it("never spawns when the pre-launch digest does not match", async () => {
    const configuration = await executableFixture();
    const factory = vi.fn<TrustedWindowsNativeHelperChildFactoryV1>();
    await expect(launchTrustedWindowsNativeHelperProcessBridgeForTestingV1({
      ...configuration,
      expectedExecutableSha256: `sha256:${"0".repeat(64)}`,
    }, factory)).rejects.toMatchObject({ code: "HELPER_VERIFICATION_FAILED" });
    expect(factory).not.toHaveBeenCalled();
  });

  it("terminates and confirms the raw child if bridge listener construction fails", async () => {
    const configuration = await executableFixture();
    const spawned = deferred<FakeNativeHelperChild>();
    const factory: TrustedWindowsNativeHelperChildFactoryV1 = () => {
      const child = new FakeNativeHelperChild(() => undefined);
      Object.defineProperty(child.stdout, "on", {
        configurable: true,
        value: () => { throw new Error("listener setup failed"); },
      });
      spawned.resolve(child);
      return child;
    };
    await expect(launchTrustedWindowsNativeHelperProcessBridgeForTestingV1(
      configuration,
      factory,
    )).rejects.toMatchObject({ code: "HELPER_UNAVAILABLE" });
    const child = await spawned.promise;
    expect(child.killSignals).toEqual(["SIGKILL"]);
  });

  it("makes raw-child construction cleanup failure explicitly fatal", async () => {
    const configuration = await executableFixture();
    const spawned = deferred<FakeNativeHelperChild>();
    const factory: TrustedWindowsNativeHelperChildFactoryV1 = () => {
      const child = new FakeNativeHelperChild(() => undefined);
      child.autoCloseOnKill = false;
      Object.defineProperty(child.stdout, "on", {
        configurable: true,
        value: () => { throw new Error("listener setup failed"); },
      });
      spawned.resolve(child);
      return child;
    };
    const launching = launchTrustedWindowsNativeHelperProcessBridgeForTestingV1(
      configuration,
      factory,
    );
    const child = await spawned.promise;
    const rejection = expect(launching).rejects.toMatchObject({
      code: "HELPER_TEARDOWN_UNCONFIRMED",
    });
    await rejection;
    expect(child.killSignals.length).toBeGreaterThan(1);
    child.close(null, "SIGKILL");
  });

  it("rejects a repeated handshake response before any work can start", async () => {
    const configuration = await executableFixture();
    const spawned = deferred<FakeNativeHelperChild>();
    const factory: TrustedWindowsNativeHelperChildFactoryV1 = () => {
      const child = new FakeNativeHelperChild((message) => {
        if (message.type !== "handshake") return;
        const response = handshakeResponse(message);
        child.send(response);
        child.send(response);
      });
      spawned.resolve(child);
      return child;
    };
    const launching = launchTrustedWindowsNativeHelperProcessBridgeForTestingV1(
      configuration,
      factory,
    );
    await expect(launching).rejects.toMatchObject({ code: "HANDSHAKE_FAILED" });
    expect((await spawned.promise).killSignals).toEqual(["SIGKILL"]);
  });

  it("binds sequential comparisons to the private session and work sequence", async () => {
    const launched = await launchWithFake((child, message) => {
      if (message.type === "compare_paths") respondToCompare(child, message, "ancestor");
      else if (message.type === "close") respondToClose(child, message);
    });
    const first = await launched.bridge.compareCanonicalPaths({
      leftCanonicalAbsolutePath: "C:\\source",
      rightCanonicalAbsolutePath: "C:\\source\\room.e57",
    });
    const second = await launched.bridge.compareCanonicalPaths({
      leftCanonicalAbsolutePath: "D:\\output",
      rightCanonicalAbsolutePath: "C:\\source",
    });
    expect(first).toEqual({
      relation: "ancestor",
      comparisonAuthority: "windows_compare_string_ordinal_ignore_case",
    });
    expect(second.relation).toBe("ancestor");
    const comparisons = launched.child.stdin.messages.filter(
      (message) => message.type === "compare_paths",
    );
    expect(comparisons.map((message) => message.sequence)).toEqual([1, 2]);
    expect(new Set(comparisons.map((message) => message.request_ref)).size).toBe(2);
    await launched.bridge.close();
  });

  it("does not expose cancellation until the helper advertises a real OOB reader", async () => {
    const launched = await launchWithFake((child, message) => {
      if (message.type === "close") respondToClose(child, message);
    });
    expect(TRUSTED_WINDOWS_NATIVE_HELPER_CAPABILITIES_V1).not.toContain("cancel");
    expect(TRUSTED_WINDOWS_NATIVE_HELPER_CAPABILITIES_V1).not.toContain("read_source_bytes");
    expect(TRUSTED_WINDOWS_NATIVE_HELPER_CAPABILITIES_V1).not.toContain("write_output_bytes");
    expect("cancelActiveWork" in launched.bridge).toBe(false);
    expect(launched.child.stdin.messages.some(
      (message) => message.type === "cancel",
    )).toBe(false);
    await launched.bridge.close();
  });

  it("maps the complete retained-scope control lifecycle into the adapter's exact DTOs", async () => {
    const adapterId = "windows-native-v1";
    const adapterDigest = `sha256:${"ab".repeat(32)}`;
    const launched = await launchWithFake((child, message) => {
      const base = {
        schema_version: 1,
        session_ref: message.session_ref,
        request_ref: message.request_ref,
        sequence: message.sequence,
      };
      if (message.type === "pick_files") {
        child.send({
          type: "pick_files_ok", ...base,
          basket_session_ref: message.basket_session_ref,
          controller_request_ref: message.controller_request_ref,
          status: "selected",
          selections: [sourceSelection()],
        });
      } else if (message.type === "resolve_output") {
        child.send({
          type: "resolve_output_ok", ...base,
          basket_session_ref: message.basket_session_ref,
          controller_request_ref: message.controller_request_ref,
          status: "resolved",
          output: outputBoundary(),
        });
      } else if (message.type === "revalidate_start") {
        child.send({
          type: "revalidate_start_ok", ...base,
          basket_session_ref: message.basket_session_ref,
          controller_request_ref: message.controller_request_ref,
          status: "opened",
          scope_ref: SCOPE_REF,
          evidence: {
            adapter_id: adapterId,
            adapter_build_sha256: adapterDigest,
            identity_comparison_mechanism: "windows_volume_serial_plus_file_id_128",
            path_comparison_mechanism: "windows_compare_string_ordinal_ignore_case",
            output: outputBoundary(),
            selections: [sourceSelection()],
            native_path_comparisons: {
              source_pairs: [],
              output_pairs: [{ selection_index: 1, relation: "disjoint" }],
            },
          },
          source_files: [{
            source_file_ref: SOURCE_FILE_REF,
            identity: identity(SOURCE_FILE_ID),
          }],
        });
      } else if (message.type === "create_run_output") {
        child.send({
          type: "create_run_output_ok", ...base,
          scope_ref: SCOPE_REF,
          run_ref: RUN_REF,
          status: "created",
          identity: identity(RUN_ID),
        });
      } else if (message.type === "create_output_file") {
        child.send({
          type: "create_output_file_ok", ...base,
          scope_ref: SCOPE_REF,
          run_ref: RUN_REF,
          output_file_ref: OUTPUT_FILE_REF,
          status: "created",
          identity: identity(OUTPUT_FILE_ID),
        });
      } else if (message.type === "release_revalidated_start") {
        child.send({
          type: "release_revalidated_start_ok", ...base,
          basket_session_ref: message.basket_session_ref,
          controller_request_ref: message.controller_request_ref,
          scope_ref: SCOPE_REF,
          status: "released",
        });
      } else if (message.type === "close") respondToClose(child, message);
    });

    const picked = await launched.bridge.pick_files({
      schema_version: 1,
      operation: "pick_files",
      session_ref: launched.bridge.session_ref,
      basket_session_ref: BASKET_REF,
      request_ref: NATIVE_REQUEST_REF,
      read_only: true,
      browser_path_input_accepted: false,
    });
    expect(picked).toEqual({
      schema_version: 1,
      operation: "pick_files",
      session_ref: launched.bridge.session_ref,
      basket_session_ref: BASKET_REF,
      request_ref: NATIVE_REQUEST_REF,
      status: "selected",
      selections: [sourceSelection()],
    });
    await expect(launched.bridge.resolve_output({
      schema_version: 1,
      operation: "resolve_output",
      session_ref: launched.bridge.session_ref,
      basket_session_ref: BASKET_REF,
      request_ref: OUTPUT_REQUEST_REF,
      read_only: true,
      browser_path_input_accepted: false,
    })).resolves.toMatchObject({ status: "resolved", output: outputBoundary() });
    const opened = await launched.bridge.revalidate_start({
      schema_version: 1,
      operation: "revalidate_start",
      session_ref: launched.bridge.session_ref,
      basket_session_ref: BASKET_REF,
      request_ref: START_REQUEST_REF,
      adapter_id: adapterId,
      adapter_build_sha256: adapterDigest,
      expected_source_refs: [SOURCE_REF],
      expected_output_ref: OUTPUT_REF,
      read_only: true,
      browser_path_input_accepted: false,
    });
    expect(JSON.stringify(opened)).not.toContain("helper_source_file_");
    expect(opened).toMatchObject({ status: "opened", scope_ref: SCOPE_REF });
    await expect(launched.bridge.create_run_output()).resolves.toEqual({
      scope_ref: SCOPE_REF,
      run_ref: RUN_REF,
      identity: identity(RUN_ID),
    });
    await expect(launched.bridge.create_output_file({ component: "result.bin" }))
      .resolves.toEqual({
        scope_ref: SCOPE_REF,
        run_ref: RUN_REF,
        output_file_ref: OUTPUT_FILE_REF,
        identity: identity(OUTPUT_FILE_ID),
      });
    await expect(launched.bridge.release_revalidated_start({
      schema_version: 1,
      operation: "release_revalidated_start",
      session_ref: launched.bridge.session_ref,
      basket_session_ref: BASKET_REF,
      request_ref: START_REQUEST_REF,
      scope_ref: SCOPE_REF,
    })).resolves.toEqual({
      schema_version: 1,
      operation: "release_revalidated_start",
      session_ref: launched.bridge.session_ref,
      basket_session_ref: BASKET_REF,
      request_ref: START_REQUEST_REF,
      scope_ref: SCOPE_REF,
      status: "released",
    });
    expect(launched.child.stdin.messages.filter(
      (message) => typeof message.sequence === "number",
    ).map((message) => message.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
    await launched.bridge.close_and_confirm_no_live_scopes();
  });

  it("maps one exact mixed drop_sources request and response without browser locators", async () => {
    const selections = [droppedFileSelection(), droppedDirectorySelection()];
    const launched = await launchWithFake((child, message) => {
      if (message.type === "drop_sources") {
        child.send({
          type: "drop_sources_ok",
          schema_version: 1,
          session_ref: message.session_ref,
          request_ref: message.request_ref,
          sequence: message.sequence,
          basket_session_ref: message.basket_session_ref,
          controller_request_ref: message.controller_request_ref,
          status: "selected",
          selections,
        });
      } else if (message.type === "close") respondToClose(child, message);
    });

    await expect(launched.bridge.drop_sources({
      schema_version: 1,
      operation: "drop_sources",
      session_ref: launched.bridge.session_ref,
      basket_session_ref: BASKET_REF,
      request_ref: NATIVE_REQUEST_REF,
      read_only: true,
      browser_path_input_accepted: false,
    })).resolves.toEqual({
      schema_version: 1,
      operation: "drop_sources",
      session_ref: launched.bridge.session_ref,
      basket_session_ref: BASKET_REF,
      request_ref: NATIVE_REQUEST_REF,
      status: "selected",
      selections,
    });

    const request = launched.child.stdin.messages.find(
      (message) => message.type === "drop_sources",
    );
    expect(request).toEqual({
      type: "drop_sources",
      schema_version: 1,
      session_ref: launched.bridge.session_ref,
      request_ref: expect.stringMatching(/^helper_request_[a-f0-9]{32}$/u),
      sequence: 1,
      basket_session_ref: BASKET_REF,
      controller_request_ref: NATIVE_REQUEST_REF,
    });
    expect(JSON.stringify(request)).not.toContain("capture-folder");
    await launched.bridge.close();
  });

  it("allows only one active work request", async () => {
    const heldRequests: Record<string, unknown>[] = [];
    const launched = await launchWithFake((child, message) => {
      if (message.type === "compare_paths") heldRequests.push(message);
      else if (message.type === "close") respondToClose(child, message);
    });
    const first = launched.bridge.compareCanonicalPaths({
      leftCanonicalAbsolutePath: "C:\\source",
      rightCanonicalAbsolutePath: "D:\\output",
    });
    await new Promise<void>((resolveImmediate) => setImmediate(resolveImmediate));
    let busyError: unknown;
    try {
      await launched.bridge.compareCanonicalPaths({
        leftCanonicalAbsolutePath: "C:\\other",
        rightCanonicalAbsolutePath: "D:\\other",
      });
    } catch (error: unknown) {
      busyError = error;
    }
    expect(busyError).toMatchObject({ code: "OPERATION_BUSY" });
    expect(mapTrustedWindowsNativeHelperFailureForBrowserV1(busyError)).toEqual({
      status: "failed",
      code: "LOCAL_SELECTION_BUSY",
      message: "Another local selection is already in progress.",
    });
    const held = heldRequests[0];
    expect(held).toBeDefined();
    if (held === undefined) throw new Error("missing held test comparison");
    respondToCompare(launched.child, held);
    await expect(first).resolves.toMatchObject({ relation: "disjoint" });
    await launched.bridge.close();
  });

  it("does not consume a work sequence when concurrent adapter work is rejected", async () => {
    const heldRequests: Record<string, unknown>[] = [];
    const launched = await launchWithFake((child, message) => {
      if (message.type === "pick_files") heldRequests.push(message);
      else if (message.type === "close") respondToClose(child, message);
    });
    const request = (suffix: string) => ({
      schema_version: 1 as const,
      operation: "pick_files" as const,
      session_ref: launched.bridge.session_ref,
      basket_session_ref: BASKET_REF,
      request_ref: `native_request_${suffix.repeat(16)}`,
      read_only: true as const,
      browser_path_input_accepted: false as const,
    });
    const first = launched.bridge.pick_files(request("b1"));
    await new Promise<void>((resolveImmediate) => setImmediate(resolveImmediate));
    await expect(launched.bridge.pick_files(request("b2")))
      .rejects.toMatchObject({ code: "OPERATION_BUSY" });
    const held = heldRequests[0];
    if (held === undefined) throw new Error("missing held picker request");
    launched.child.send({
      type: "pick_files_ok",
      schema_version: 1,
      session_ref: held.session_ref,
      request_ref: held.request_ref,
      sequence: held.sequence,
      basket_session_ref: held.basket_session_ref,
      controller_request_ref: held.controller_request_ref,
      status: "cancelled",
    });
    await expect(first).resolves.toMatchObject({ status: "cancelled" });
    const third = launched.bridge.pick_files(request("b3"));
    await new Promise<void>((resolveImmediate) => setImmediate(resolveImmediate));
    const next = heldRequests[1];
    if (next === undefined) throw new Error("missing next picker request");
    expect(next.sequence).toBe(2);
    launched.child.send({
      type: "pick_files_ok",
      schema_version: 1,
      session_ref: next.session_ref,
      request_ref: next.request_ref,
      sequence: next.sequence,
      basket_session_ref: next.basket_session_ref,
      controller_request_ref: next.controller_request_ref,
      status: "cancelled",
    });
    await expect(third).resolves.toMatchObject({ status: "cancelled" });
    await launched.bridge.close();
  });

  it("treats a helper path rejection as terminal and kills the exact child", async () => {
    const launched = await launchWithFake((child, message) => {
      if (message.type === "compare_paths") {
        child.send({
          type: "error",
          schema_version: 1,
          session_ref: message.session_ref,
          request_ref: message.request_ref,
          sequence: message.sequence,
          control_sequence: null,
          code: "PATH_REJECTED",
        });
      }
    });
    await expect(launched.bridge.compareCanonicalPaths({
      leftCanonicalAbsolutePath: "C:\\source",
      rightCanonicalAbsolutePath: "D:\\output",
    })).rejects.toMatchObject({ code: "PROTOCOL_FAILURE" });
    expect(launched.child.killSignals).toEqual(["SIGKILL"]);
    await launched.bridge.close();
  });

  it("makes a real stdin write failure terminal without leaking its detail", async () => {
    const launched = await launchWithFake();
    launched.child.stdin.failWrites = true;
    await expect(launched.bridge.compareCanonicalPaths({
      leftCanonicalAbsolutePath: "C:\\source",
      rightCanonicalAbsolutePath: "D:\\output",
    })).rejects.toMatchObject({
      code: "HELPER_UNAVAILABLE",
      message: "The trusted local helper is unavailable.",
    });
    expect(launched.child.killSignals).toEqual(["SIGKILL"]);
    await launched.bridge.close();
  });

  it("rejects one oversized response before retaining an oversized line", async () => {
    const launched = await launchWithFake((child, message) => {
      if (message.type === "compare_paths") {
        child.stdout.write(Buffer.alloc(MAX_HELPER_RESPONSE_BYTES + 1, 0x61));
      }
    });
    await expect(launched.bridge.compareCanonicalPaths({
      leftCanonicalAbsolutePath: "C:\\source",
      rightCanonicalAbsolutePath: "D:\\output",
    })).rejects.toMatchObject({ code: "PROTOCOL_FAILURE" });
    expect(launched.child.killSignals).toEqual(["SIGKILL"]);
    await launched.bridge.close();
  });

  it("keeps response memory bounded across many one-byte pipe fragments", async () => {
    const launched = await launchWithFake((child, message) => {
      if (message.type === "compare_paths") {
        child.sendOneByteFragments(Buffer.concat([
          Buffer.alloc(16_384, 0x61),
          Buffer.from("\n", "ascii"),
        ]));
      }
    });
    await expect(launched.bridge.compareCanonicalPaths({
      leftCanonicalAbsolutePath: "C:\\source",
      rightCanonicalAbsolutePath: "D:\\output",
    })).rejects.toMatchObject({ code: "PROTOCOL_FAILURE" });
    expect(launched.child.killSignals).toEqual(["SIGKILL"]);
    await launched.bridge.close();
    await expect(launched.bridge.waitForConfirmedExit()).resolves.toBeUndefined();
  });

  it("keeps the graceful close error but confirms no live scopes after a nonzero exit", async () => {
    const launched = await launchWithFake((child, message) => {
      if (message.type === "close") respondToClose(child, message, 7);
    });
    await expect(launched.bridge.close()).rejects.toMatchObject({
      code: "PROTOCOL_FAILURE",
    });
    await expect(launched.bridge.close_and_confirm_no_live_scopes())
      .resolves.toBeUndefined();
  });

  it("confirms no live scopes after protocol failure and exact-child forced exit", async () => {
    const launched = await launchWithFake((child, message) => {
      if (message.type === "close") {
        child.send({ ...message, type: "untrusted_close_response" });
      }
    });

    await expect(launched.bridge.close_and_confirm_no_live_scopes())
      .resolves.toBeUndefined();
    expect(launched.child.killSignals).toEqual(["SIGKILL"]);
  });

  it("confirms no live scopes after the close grace deadline and exact-child forced exit", async () => {
    const closeSeen = deferred<undefined>();
    const launched = await launchWithFake((_child, message) => {
      if (message.type === "close") closeSeen.resolve(undefined);
    });
    vi.useFakeTimers();
    const shutdown = launched.bridge.close_and_confirm_no_live_scopes();
    await closeSeen.promise;
    const completion = expect(shutdown).resolves.toBeUndefined();

    await vi.advanceTimersByTimeAsync(5_000);

    await completion;
    expect(launched.child.killSignals).toEqual(["SIGKILL"]);
  });

  it("shares one failed teardown attempt, then lets a later lifecycle owner retry", async () => {
    const closeSeen = deferred<undefined>();
    const launched = await launchWithFake((_child, message) => {
      if (message.type === "close") closeSeen.resolve(undefined);
    });
    launched.child.autoCloseOnKill = false;
    vi.useFakeTimers();
    const firstShutdown = launched.bridge.close_and_confirm_no_live_scopes();
    await closeSeen.promise;
    const firstRejection = expect(firstShutdown).rejects.toMatchObject({
      code: "HELPER_TEARDOWN_UNCONFIRMED",
      message: "The trusted local helper process could not be confirmed stopped.",
    });
    let firstSettled = false;
    void firstShutdown.then(
      () => {
        firstSettled = true;
      },
      () => {
        firstSettled = true;
      },
    );

    await vi.advanceTimersByTimeAsync(5_000);
    expect(launched.child.killSignals.length).toBeGreaterThan(0);
    const secondShutdown = launched.bridge.close_and_confirm_no_live_scopes();
    const secondRejection = expect(secondShutdown).rejects.toMatchObject({
      code: "HELPER_TEARDOWN_UNCONFIRMED",
      message: "The trusted local helper process could not be confirmed stopped.",
    });
    let secondSettled = false;
    void secondShutdown.then(
      () => {
        secondSettled = true;
      },
      () => {
        secondSettled = true;
      },
    );

    await vi.advanceTimersByTimeAsync(4_999);
    expect(firstSettled).toBe(false);
    expect(secondSettled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(firstSettled).toBe(true);
    expect(secondSettled).toBe(true);
    await Promise.all([firstRejection, secondRejection]);
    const killsAfterSharedDeadline = launched.child.killSignals.length;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(launched.child.killSignals).toHaveLength(killsAfterSharedDeadline);

    const retry = launched.bridge.close_and_confirm_no_live_scopes();
    const retryCompletion = expect(retry).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(0);
    expect(launched.child.killSignals.length).toBeGreaterThan(killsAfterSharedDeadline);

    launched.child.close(null, "SIGKILL");
    await retryCompletion;
    await expect(launched.bridge.waitForConfirmedExit()).resolves.toBeUndefined();
  });

  it("resolves every concurrent lifecycle owner when exact-child exit wins", async () => {
    const closeSeen = deferred<undefined>();
    const launched = await launchWithFake((_child, message) => {
      if (message.type === "close") closeSeen.resolve(undefined);
    });
    launched.child.autoCloseOnKill = false;
    vi.useFakeTimers();

    const firstShutdown = launched.bridge.close_and_confirm_no_live_scopes();
    await closeSeen.promise;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(launched.child.killSignals.length).toBeGreaterThan(0);

    const secondShutdown = launched.bridge.close_and_confirm_no_live_scopes();
    const completions = Promise.all([
      expect(firstShutdown).resolves.toBeUndefined(),
      expect(secondShutdown).resolves.toBeUndefined(),
    ]);
    launched.child.close(null, "SIGKILL");

    await completions;
    const killsAtExit = launched.child.killSignals.length;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(launched.child.killSignals).toHaveLength(killsAtExit);
  });

  it("waits for the forced exact child to exit before a failed comparison rejects", async () => {
    const launched = await launchWithFake((child, message) => {
      if (message.type === "compare_paths") {
        child.send({ ...message, type: "unsolicited_private_response" });
      }
    });
    launched.child.autoCloseOnKill = false;
    const comparing = launched.bridge.compareCanonicalPaths({
      leftCanonicalAbsolutePath: "C:\\source",
      rightCanonicalAbsolutePath: "D:\\output",
    });
    let settled = false;
    void comparing.catch(() => {
      settled = true;
    });
    await new Promise<void>((resolveImmediate) => setImmediate(resolveImmediate));
    expect(settled).toBe(false);
    launched.child.close(null, "SIGKILL");
    await expect(comparing).rejects.toMatchObject({ code: "PROTOCOL_FAILURE" });
    await expect(launched.bridge.close()).resolves.toBeUndefined();
  });

  it("rejects both active work and an existing exit monitor when teardown is unconfirmed", async () => {
    const launched = await launchWithFake((child, message) => {
      if (message.type === "compare_paths") {
        child.send({ ...message, type: "unsolicited_private_response" });
      }
    });
    launched.child.autoCloseOnKill = false;
    vi.useFakeTimers();
    const exitMonitor = launched.bridge.waitForConfirmedExit();
    const comparing = launched.bridge.compareCanonicalPaths({
      leftCanonicalAbsolutePath: "C:\\source",
      rightCanonicalAbsolutePath: "D:\\output",
    });
    const comparisonRejection = expect(comparing).rejects.toMatchObject({
      code: "HELPER_TEARDOWN_UNCONFIRMED",
    });
    const exitRejection = expect(exitMonitor).rejects.toMatchObject({
      code: "HELPER_TEARDOWN_UNCONFIRMED",
    });
    await vi.advanceTimersByTimeAsync(5_000);
    await comparisonRejection;
    await exitRejection;
    launched.child.close(null, "SIGKILL");
    await expect(launched.bridge.waitForConfirmedExit()).resolves.toBeUndefined();
  });

  it("enforces the 10-second handshake and 5-second work deadlines", async () => {
    const configuration = await executableFixture();
    const noHandshake = deferred<FakeNativeHelperChild>();
    const handshakeSeen = deferred<undefined>();
    const factory: TrustedWindowsNativeHelperChildFactoryV1 = () => {
      const child = new FakeNativeHelperChild((message) => {
        if (message.type === "handshake") handshakeSeen.resolve(undefined);
      });
      noHandshake.resolve(child);
      return child;
    };
    vi.useFakeTimers();
    const launching = launchTrustedWindowsNativeHelperProcessBridgeForTestingV1(
      configuration,
      factory,
    );
    const child = await noHandshake.promise;
    await handshakeSeen.promise;
    const launchingRejection = expect(launching).rejects.toMatchObject({
      code: "HANDSHAKE_FAILED",
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await launchingRejection;
    expect(child.killSignals).toEqual(["SIGKILL"]);
    vi.useRealTimers();

    const workSeen = deferred<undefined>();
    const launched = await launchWithFake((_child, message) => {
      if (message.type === "compare_paths") workSeen.resolve(undefined);
    });
    vi.useFakeTimers();
    const comparing = launched.bridge.compareCanonicalPaths({
      leftCanonicalAbsolutePath: "C:\\source",
      rightCanonicalAbsolutePath: "D:\\output",
    });
    await workSeen.promise;
    const comparisonRejection = expect(comparing).rejects.toMatchObject({
      code: "DEADLINE_EXCEEDED",
    });
    await vi.advanceTimersByTimeAsync(5_000);
    await comparisonRejection;
    expect(launched.child.killSignals).toEqual(["SIGKILL"]);
    await launched.bridge.close();
  });

  it("surfaces a fatal error when forced teardown cannot confirm child exit", async () => {
    const configuration = await executableFixture();
    const spawned = deferred<FakeNativeHelperChild>();
    const handshakeSeen = deferred<undefined>();
    const factory: TrustedWindowsNativeHelperChildFactoryV1 = () => {
      const child = new FakeNativeHelperChild((message) => {
        if (message.type === "handshake") handshakeSeen.resolve(undefined);
      });
      child.autoCloseOnKill = false;
      spawned.resolve(child);
      return child;
    };
    vi.useFakeTimers();
    const launching = launchTrustedWindowsNativeHelperProcessBridgeForTestingV1(
      configuration,
      factory,
    );
    const child = await spawned.promise;
    await handshakeSeen.promise;
    const rejection = expect(launching).rejects.toMatchObject({
      code: "HELPER_TEARDOWN_UNCONFIRMED",
      message: "The trusted local helper process could not be confirmed stopped.",
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(5_000);
    await rejection;
    expect(child.killSignals.length).toBeGreaterThan(1);
    child.close(null, "SIGKILL");
  });

  it("settles launch when a handshake write throws a hostile Proxy", async () => {
    const configuration = await executableFixture();
    const hostile = hostileThrownValue();
    const spawned = deferred<FakeNativeHelperChild>();
    const factory: TrustedWindowsNativeHelperChildFactoryV1 = () => {
      const child = new FakeNativeHelperChild(() => undefined);
      replaceInputWriteWithThrownValue(child, hostile.value);
      spawned.resolve(child);
      return child;
    };

    const launching = launchTrustedWindowsNativeHelperProcessBridgeForTestingV1(
      configuration,
      factory,
    );
    await spawned.promise;

    await expect(launching).rejects.toMatchObject({
      code: "HELPER_UNAVAILABLE",
      message: "The trusted local helper is unavailable.",
    });
    expect(hostile.reads).toEqual({ property: 0, prototype: 0 });
  });

  it("settles work when an inherited-pipe write throws a hostile Proxy", async () => {
    const launched = await launchWithFake();
    const hostile = hostileThrownValue();
    replaceInputWriteWithThrownValue(launched.child, hostile.value);

    await expect(launched.bridge.compareCanonicalPaths({
      leftCanonicalAbsolutePath: "C:\\source",
      rightCanonicalAbsolutePath: "D:\\output",
    })).rejects.toMatchObject({
      code: "HELPER_UNAVAILABLE",
      message: "The trusted local helper is unavailable.",
    });
    expect(hostile.reads).toEqual({ property: 0, prototype: 0 });
    await expect(launched.bridge.close()).resolves.toBeUndefined();
  });

  it("settles lifecycle close when its control write throws a hostile Proxy", async () => {
    const launched = await launchWithFake();
    const hostile = hostileThrownValue();
    replaceInputWriteWithThrownValue(launched.child, hostile.value);

    await expect(launched.bridge.close()).rejects.toMatchObject({
      code: "HELPER_UNAVAILABLE",
      message: "The trusted local helper is unavailable.",
    });
    expect(hostile.reads).toEqual({ property: 0, prototype: 0 });
    await expect(launched.bridge.close_and_confirm_no_live_scopes()).resolves.toBeUndefined();
  });

  it("maps every untrusted detail to a small browser-safe DTO", () => {
    const secret = "C:\\private\\Reception Room\\scan-129.e57";
    const hostile = hostileThrownValue();
    const unknown = mapTrustedWindowsNativeHelperFailureForBrowserV1(
      new Error(`${secret} native code 0xC000050B sha256:${"a".repeat(64)}`),
    );
    const externallyConstructed = mapTrustedWindowsNativeHelperFailureForBrowserV1(
      new TrustedWindowsNativeHelperBridgeErrorV1("OPERATION_CANCELLED"),
    );
    const hostileFailure = mapTrustedWindowsNativeHelperFailureForBrowserV1(hostile.value);
    const serialized = JSON.stringify({ unknown, externallyConstructed, hostileFailure });
    expect(unknown).toEqual({
      status: "failed",
      code: "LOCAL_SELECTION_UNAVAILABLE",
      message: "The local Windows selection could not be completed.",
    });
    expect(externallyConstructed).toEqual(unknown);
    expect(hostileFailure).toEqual(unknown);
    expect(hostile.reads).toEqual({ property: 0, prototype: 0 });
    expect(serialized).not.toContain("Reception Room");
    expect(serialized).not.toContain("sha256:");
    expect(serialized).not.toContain("0xC000050B");
  });
});
