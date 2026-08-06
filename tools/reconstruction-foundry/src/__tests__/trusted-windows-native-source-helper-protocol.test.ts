import { describe, expect, it } from "vitest";
import {
  TRUSTED_WINDOWS_NATIVE_HELPER_BUILD_IDENTIFIER_V1,
  TRUSTED_WINDOWS_NATIVE_HELPER_CAPABILITIES_V1,
  TRUSTED_WINDOWS_NATIVE_HELPER_HANDSHAKE_DOMAIN_V1,
  deriveTrustedWindowsNativeHelperChallengeResponseV1,
  isTrustedWindowsNativeHelperRequestRefV1,
  isTrustedWindowsNativeHelperSessionRefV1,
  parseTrustedWindowsNativeHelperResponseV1,
} from "../trusted-windows-native-source-helper-protocol.js";

const SESSION_REF = "helper_session_0123456789abcdef0123456789abcdef";
const REQUEST_REF = "helper_request_0123456789abcdef0123456789abcdef";
const SHA256 = `sha256:${"ab".repeat(32)}`;
const BASKET_REF = `basket_${"11".repeat(16)}`;
const NATIVE_REQUEST_REF = `native_request_${"22".repeat(16)}`;

function identity(seed: string): Record<string, unknown> {
  return {
    volume_serial_number_hex: "A1B2C3D4E5F60718",
    file_id_hex: seed.repeat(32),
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
    opened_handle_volume_serial_number_hex: "A1B2C3D4E5F60718",
    volume_root_handle_serial_number_hex: "A1B2C3D4E5F60718",
  };
}

function sourceSelection(input: {
  readonly kind: "file" | "directory";
  readonly acquisition:
    | "windows_native_picker_handle"
    | "windows_native_drop_cfhdrop_then_handle_open";
  readonly suffix: string;
}): Record<string, unknown> {
  const fileIdentity = identity(input.suffix);
  return {
    source_ref: `helper_source_${input.suffix.repeat(32)}`,
    evidence: {
      kind: input.kind,
      canonical_absolute_path: input.kind === "file" ? "C:\\capture.e57" : "C:\\capture",
      resolved_absolute_path: input.kind === "file" ? "C:\\capture.e57" : "C:\\capture",
      byte_count_decimal: input.kind === "file" ? "4" : "0",
      file_count: input.kind === "file" ? 1 : 0,
      identity: fileIdentity,
      inventory_file_identities: input.kind === "file" ? [fileIdentity] : [],
      path_evidence: {
        acquisition: input.acquisition,
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

function handshakeFixture(): Record<string, unknown> {
  return {
    type: "handshake_ok",
    schema_version: 1,
    session_ref: SESSION_REF,
    process_architecture: "x86_64",
    build_identifier: TRUSTED_WINDOWS_NATIVE_HELPER_BUILD_IDENTIFIER_V1,
    self_observed_image_sha256: SHA256,
    challenge_response_sha256: SHA256,
    capabilities: [...TRUSTED_WINDOWS_NATIVE_HELPER_CAPABILITIES_V1],
  };
}

describe("trusted Windows native helper V1 protocol", () => {
  it("pins the shared non-authenticating challenge-response vector", () => {
    expect(TRUSTED_WINDOWS_NATIVE_HELPER_BUILD_IDENTIFIER_V1).toBe(
      "venviewer-windows-source-helper/0.2.0",
    );
    expect(TRUSTED_WINDOWS_NATIVE_HELPER_HANDSHAKE_DOMAIN_V1).toBe(
      "OMNITWIN.WINDOWS_SOURCE_HELPER.HANDSHAKE.V1",
    );
    expect(deriveTrustedWindowsNativeHelperChallengeResponseV1({
      challengeHex:
        "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
      expectedHelperSha256: SHA256,
    })).toBe(
      "sha256:a2d319a17c56f8755cf37077967ab50f97a6529fda17ac809e4443ffa247873a",
    );
  });

  it("accepts only the exact pinned handshake and capability order", () => {
    expect(parseTrustedWindowsNativeHelperResponseV1(
      JSON.stringify(handshakeFixture()),
    )).toEqual(handshakeFixture());

    const reordered = handshakeFixture();
    reordered.capabilities = ["close", "compare_paths"];
    expect(() => parseTrustedWindowsNativeHelperResponseV1(
      JSON.stringify(reordered),
    )).toThrow("invalid protocol data");
  });

  it("shares the data-plane rule that opaque reference suffixes cannot be all zero", () => {
    const zeroSession = `helper_session_${"0".repeat(32)}`;
    const zeroRequest = `helper_request_${"0".repeat(32)}`;
    expect(isTrustedWindowsNativeHelperSessionRefV1(zeroSession)).toBe(false);
    expect(isTrustedWindowsNativeHelperRequestRefV1(zeroRequest)).toBe(false);
    expect(isTrustedWindowsNativeHelperSessionRefV1(SESSION_REF)).toBe(true);
    expect(isTrustedWindowsNativeHelperRequestRefV1(REQUEST_REF)).toBe(true);

    expect(() => parseTrustedWindowsNativeHelperResponseV1(JSON.stringify({
      ...handshakeFixture(),
      session_ref: zeroSession,
    }))).toThrow("invalid protocol data");
    expect(() => parseTrustedWindowsNativeHelperResponseV1(JSON.stringify({
      type: "compare_paths_ok",
      schema_version: 1,
      session_ref: SESSION_REF,
      request_ref: zeroRequest,
      sequence: 1,
      relation: "same",
    }))).toThrow("invalid protocol data");

    const rejected = {
      type: "revalidate_start_ok",
      schema_version: 1,
      session_ref: SESSION_REF,
      request_ref: REQUEST_REF,
      sequence: 1,
      basket_session_ref: `basket_${"1".repeat(32)}`,
      controller_request_ref: `revalidated_start_${"2".repeat(32)}`,
      status: "rejected",
      no_live_scope: true,
    };
    for (const replacement of [
      { basket_session_ref: `basket_${"0".repeat(32)}` },
      { controller_request_ref: `revalidated_start_${"0".repeat(32)}` },
    ]) {
      expect(() => parseTrustedWindowsNativeHelperResponseV1(JSON.stringify({
        ...rejected,
        ...replacement,
      }))).toThrow("invalid protocol data");
    }
  });

  it("parses independently sequenced work and control acknowledgements", () => {
    expect(parseTrustedWindowsNativeHelperResponseV1(JSON.stringify({
      type: "compare_paths_ok",
      schema_version: 1,
      session_ref: SESSION_REF,
      request_ref: REQUEST_REF,
      sequence: 3,
      relation: "ancestor",
    }))).toMatchObject({ type: "compare_paths_ok", sequence: 3 });

    expect(parseTrustedWindowsNativeHelperResponseV1(JSON.stringify({
      type: "cancel_ok",
      schema_version: 1,
      session_ref: SESSION_REF,
      request_ref: REQUEST_REF,
      control_sequence: 2,
      target_request_ref: "helper_request_11111111111111111111111111111111",
      outcome: "requested",
    }))).toMatchObject({ type: "cancel_ok", control_sequence: 2 });
  });

  it("accepts one exact mixed drop response and keeps picker acquisitions homogeneous", () => {
    const droppedFile = sourceSelection({
      kind: "file",
      acquisition: "windows_native_drop_cfhdrop_then_handle_open",
      suffix: "1",
    });
    const droppedFolder = sourceSelection({
      kind: "directory",
      acquisition: "windows_native_drop_cfhdrop_then_handle_open",
      suffix: "2",
    });
    const dropped = {
      type: "drop_sources_ok",
      schema_version: 1,
      session_ref: SESSION_REF,
      request_ref: REQUEST_REF,
      sequence: 1,
      basket_session_ref: BASKET_REF,
      controller_request_ref: NATIVE_REQUEST_REF,
      status: "selected",
      selections: [droppedFile, droppedFolder],
    };

    expect(parseTrustedWindowsNativeHelperResponseV1(JSON.stringify(dropped)))
      .toEqual(dropped);

    expect(() => parseTrustedWindowsNativeHelperResponseV1(JSON.stringify({
      ...dropped,
      type: "pick_files_ok",
    }))).toThrow("invalid protocol data");
    expect(() => parseTrustedWindowsNativeHelperResponseV1(JSON.stringify({
      ...dropped,
      selections: [sourceSelection({
        kind: "file",
        acquisition: "windows_native_picker_handle",
        suffix: "3",
      })],
    }))).toThrow("invalid protocol data");
    expect(() => parseTrustedWindowsNativeHelperResponseV1(JSON.stringify({
      ...dropped,
      type: "pick_folder_ok",
      selections: [droppedFolder],
    }))).toThrow("invalid protocol data");
  });

  it("requires drop cancellation and failure responses to omit selections", () => {
    const base = {
      type: "drop_sources_ok",
      schema_version: 1,
      session_ref: SESSION_REF,
      request_ref: REQUEST_REF,
      sequence: 2,
      basket_session_ref: BASKET_REF,
      controller_request_ref: NATIVE_REQUEST_REF,
    };
    for (const status of ["cancelled", "failed"] as const) {
      expect(parseTrustedWindowsNativeHelperResponseV1(JSON.stringify({ ...base, status })))
        .toEqual({ ...base, status });
      expect(() => parseTrustedWindowsNativeHelperResponseV1(JSON.stringify({
        ...base,
        status,
        selections: [],
      }))).toThrow("invalid protocol data");
    }
  });

  it("requires an exact no-live-scope proof for a rejected revalidation", () => {
    const rejected = {
      type: "revalidate_start_ok",
      schema_version: 1,
      session_ref: SESSION_REF,
      request_ref: REQUEST_REF,
      sequence: 4,
      basket_session_ref: `basket_${"11".repeat(16)}`,
      controller_request_ref: `revalidated_start_${"22".repeat(16)}`,
      status: "rejected",
      no_live_scope: true,
    };
    expect(parseTrustedWindowsNativeHelperResponseV1(JSON.stringify(rejected)))
      .toEqual(rejected);
    expect(() => parseTrustedWindowsNativeHelperResponseV1(JSON.stringify({
      ...rejected,
      source_files: [],
    }))).toThrow("invalid protocol data");
    expect(() => parseTrustedWindowsNativeHelperResponseV1(JSON.stringify({
      ...rejected,
      no_live_scope: false,
    }))).toThrow("invalid protocol data");
  });

  it.each([
    ["unknown field", JSON.stringify({ ...handshakeFixture(), detail: "private" })],
    [
      "duplicate field",
      `{"type":"close_ok","type":"close_ok","schema_version":1,` +
        `"session_ref":"${SESSION_REF}","request_ref":"${REQUEST_REF}",` +
        '"control_sequence":1}',
    ],
    [
      "escape-equivalent duplicate field",
      `{"type":"close_ok","t\\u0079pe":"close_ok","schema_version":1,` +
        `"session_ref":"${SESSION_REF}","request_ref":"${REQUEST_REF}",` +
        '"control_sequence":1}',
    ],
    [
      "fractional sequence",
      JSON.stringify({
        type: "close_ok",
        schema_version: 1,
        session_ref: SESSION_REF,
        request_ref: REQUEST_REF,
        control_sequence: 1.5,
      }),
    ],
    ["unknown response", '{"type":"native_detail","schema_version":1}'],
  ])("rejects %s", (_label, serialized) => {
    expect(() => parseTrustedWindowsNativeHelperResponseV1(serialized))
      .toThrow("invalid protocol data");
  });

  it("accepts only fixed, detail-free error records", () => {
    expect(parseTrustedWindowsNativeHelperResponseV1(JSON.stringify({
      type: "error",
      schema_version: 1,
      session_ref: SESSION_REF,
      request_ref: REQUEST_REF,
      sequence: 1,
      control_sequence: null,
      code: "PATH_REJECTED",
    }))).toMatchObject({ code: "PATH_REJECTED", sequence: 1 });

    expect(() => parseTrustedWindowsNativeHelperResponseV1(JSON.stringify({
      type: "error",
      schema_version: 1,
      session_ref: SESSION_REF,
      request_ref: REQUEST_REF,
      sequence: 1,
      control_sequence: null,
      code: "PATH_REJECTED",
      native_error: "C:\\private\\secret.e57",
    }))).toThrow("invalid protocol data");
  });
});
