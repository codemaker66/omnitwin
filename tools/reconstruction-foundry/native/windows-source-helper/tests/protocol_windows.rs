#![cfg(windows)]

use std::fs::File;
use std::io::{Cursor, Write};
use std::process::{Command, Stdio};

use venviewer_windows_source_helper::protocol::{
    derive_challenge_response, encode_response_line, read_bounded_frame, sha256_reader,
    CancelOutcome, FrameRead, PathRelationWire, ProtocolEngine, ProtocolErrorCode,
    ProtocolResponse, RevalidationStatus, SelectionStatus, WorkRequestBinding, BUILD_IDENTIFIER,
    CAPABILITIES, HANDSHAKE_DOMAIN, MAX_CONTROL_MESSAGE_BYTES, MAX_WORK_REQUEST_BYTES,
    PROTOCOL_SCHEMA_VERSION,
};

const CHALLENGE: &str = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const SELF_DIGEST: &str = "sha256:abababababababababababababababababababababababababababababababab";
const VECTOR_RESPONSE: &str =
    "sha256:a2d319a17c56f8755cf37077967ab50f97a6529fda17ac809e4443ffa247873a";
const SESSION: &str = "helper_session_0123456789abcdef0123456789abcdef";
const OTHER_SESSION: &str = "helper_session_ffffffffffffffffffffffffffffffff";
const REQUEST_A: &str = "helper_request_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const REQUEST_B: &str = "helper_request_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const REQUEST_C: &str = "helper_request_cccccccccccccccccccccccccccccccc";
const BASKET: &str = "basket_11111111111111111111111111111111";
const NATIVE_REQUEST: &str = "native_request_22222222222222222222222222222222";
const REVALIDATED_REQUEST: &str = "revalidated_start_22222222222222222222222222222222";
const SOURCE_REF: &str = "helper_source_33333333333333333333333333333333";
const OUTPUT_REF: &str = "helper_output_44444444444444444444444444444444";

#[test]
fn shared_handshake_vector_is_exact_and_unambiguous() {
    assert_eq!(HANDSHAKE_DOMAIN.len(), 43);
    assert_eq!(BUILD_IDENTIFIER.len(), 37);
    assert_eq!(CHALLENGE.len(), 64);
    assert_eq!(SELF_DIGEST.len(), 71);
    assert_eq!(
        derive_challenge_response(CHALLENGE, SELF_DIGEST),
        Ok(VECTOR_RESPONSE.to_owned())
    );
}

#[test]
fn handshake_response_serialization_is_deterministic() {
    let mut engine = fresh_engine();
    let response = engine.handle_frame(handshake().as_bytes());
    assert_eq!(
        response,
        ProtocolResponse::HandshakeOk {
            schema_version: PROTOCOL_SCHEMA_VERSION,
            session_ref: SESSION.to_owned(),
            process_architecture: "x86_64",
            build_identifier: BUILD_IDENTIFIER,
            self_observed_image_sha256: SELF_DIGEST.to_owned(),
            challenge_response_sha256: VECTOR_RESPONSE.to_owned(),
            capabilities: CAPABILITIES,
        }
    );
    let encoded = encode_response_line(&response).expect("response should serialize");
    let expected = concat!(
        r#"{"type":"handshake_ok","schema_version":1,"session_ref":"helper_session_0123456789abcdef0123456789abcdef","#,
        r#""process_architecture":"x86_64","build_identifier":"venviewer-windows-source-helper/0.2.0","#,
        r#""self_observed_image_sha256":"sha256:abababababababababababababababababababababababababababababababab","#,
        r#""challenge_response_sha256":"sha256:a2d319a17c56f8755cf37077967ab50f97a6529fda17ac809e4443ffa247873a","#,
        r#""capabilities":["pick_files","pick_folder","drop_sources","resolve_output","compare_paths","revalidate_start","release_revalidated_start","create_run_output","create_output_file","close"]}"#,
        "\n"
    );
    assert_eq!(encoded, expected.as_bytes());
}

#[test]
fn drop_response_is_one_atomic_command_and_omits_selections_when_cancelled() {
    let response = ProtocolResponse::DropSourcesOk {
        schema_version: 1,
        session_ref: SESSION.to_owned(),
        request_ref: REQUEST_A.to_owned(),
        sequence: 1,
        basket_session_ref: BASKET.to_owned(),
        controller_request_ref: NATIVE_REQUEST.to_owned(),
        status: SelectionStatus::Cancelled,
        selections: None,
    };
    let encoded = encode_response_line(&response).expect("response should serialize");
    assert_eq!(
        String::from_utf8(encoded).expect("response should be UTF-8"),
        format!(
            "{{\"type\":\"drop_sources_ok\",\"schema_version\":1,\"session_ref\":\"{SESSION}\",\"request_ref\":\"{REQUEST_A}\",\"sequence\":1,\"basket_session_ref\":\"{BASKET}\",\"controller_request_ref\":\"{NATIVE_REQUEST}\",\"status\":\"cancelled\"}}\n"
        )
    );
}

#[test]
fn drop_command_binding_and_shape_fail_before_starting_the_native_panel() {
    let mut skipped = handshaken_engine();
    assert_unbound_error(
        skipped.handle_frame(drop_sources_for(SESSION, REQUEST_A, 2, BASKET).as_bytes()),
        ProtocolErrorCode::SequenceMismatch,
    );

    let mut cross_session = handshaken_engine();
    assert_unbound_error(
        cross_session
            .handle_frame(drop_sources_for(OTHER_SESSION, REQUEST_A, 1, BASKET).as_bytes()),
        ProtocolErrorCode::SessionMismatch,
    );

    let mut invalid_basket = handshaken_engine();
    assert_eq!(
        invalid_basket
            .handle_frame(drop_sources_for(SESSION, REQUEST_A, 1, "basket-not-opaque").as_bytes(),),
        ProtocolResponse::Error {
            schema_version: 1,
            session_ref: Some(SESSION.to_owned()),
            request_ref: Some(REQUEST_A.to_owned()),
            sequence: Some(1),
            control_sequence: None,
            code: ProtocolErrorCode::InvalidMessage,
        }
    );
    assert!(invalid_basket.is_terminal());

    let malformed = drop_sources_for(SESSION, REQUEST_A, 1, BASKET).replace(
        r#""controller_request_ref""#,
        r#""unexpected":true,"controller_request_ref""#,
    );
    let mut malformed_engine = handshaken_engine();
    assert_eq!(
        malformed_engine.handle_frame(malformed.as_bytes()),
        ProtocolResponse::Error {
            schema_version: 1,
            session_ref: Some(SESSION.to_owned()),
            request_ref: None,
            sequence: None,
            control_sequence: None,
            code: ProtocolErrorCode::InvalidMessage,
        }
    );
}

#[test]
fn duplicate_keys_including_escape_equivalent_and_nested_names_fail_closed() {
    let ordinary = format!(
        r#"{{"type":"handshake","type":"handshake","schema_version":1,"session_ref":"{SESSION}","challenge":"{CHALLENGE}","expected_helper_sha256":"{SELF_DIGEST}"}}"#
    );
    let escaped = format!(
        r#"{{"type":"handshake","t\u0079pe":"handshake","schema_version":1,"session_ref":"{SESSION}","challenge":"{CHALLENGE}","expected_helper_sha256":"{SELF_DIGEST}"}}"#
    );
    let nested = format!(
        r#"{{"type":"handshake","schema_version":1,"session_ref":"{SESSION}","challenge":"{CHALLENGE}","expected_helper_sha256":"{SELF_DIGEST}","extra":{{"a":1,"a":2}}}}"#
    );
    for payload in [ordinary, escaped, nested] {
        let mut engine = fresh_engine();
        assert_unbound_error(
            engine.handle_frame(payload.as_bytes()),
            ProtocolErrorCode::InvalidMessage,
        );
        assert!(engine.is_terminal());
    }
}

#[test]
fn malformed_extra_noninteger_and_unknown_messages_fail_closed() {
    let extra = handshake().replace(
        r#""schema_version":1"#,
        r#""schema_version":1,"private_path":"C:\\secret.e57""#,
    );
    let noninteger = handshake().replace(r#""schema_version":1"#, r#""schema_version":1.0"#);
    let array = "[]".to_owned();
    let unknown = r#"{"type":"run_command","schema_version":1}"#.to_owned();
    for payload in [extra, noninteger, array, unknown] {
        let mut engine = fresh_engine();
        let response = engine.handle_frame(payload.as_bytes());
        assert_unbound_error(response, ProtocolErrorCode::InvalidMessage);
    }
}

#[test]
fn protocol_strings_and_json_depth_have_fixed_limits() {
    let oversized_type = format!(r#"{{"type":"{}"}}"#, "a".repeat(32_768));
    let oversized_key = format!(r#"{{"type":"handshake","{}":null}}"#, "k".repeat(32_768));
    let nested_value = format!("{}null{}", "[".repeat(33), "]".repeat(33));
    let excessive_depth = handshake().replace(
        r#""schema_version":1"#,
        &format!(r#""schema_version":1,"extra":{nested_value}"#),
    );

    for payload in [oversized_type, oversized_key, excessive_depth] {
        assert!(payload.len() < MAX_WORK_REQUEST_BYTES);
        let mut engine = fresh_engine();
        assert_unbound_error(
            engine.handle_frame(payload.as_bytes()),
            ProtocolErrorCode::InvalidMessage,
        );
    }
}

#[test]
fn handshake_rejects_noncanonical_or_mismatched_bindings() {
    let bad_session = handshake().replace(
        SESSION,
        "session_reference_0123456789abcdef0123456789abcdef",
    );
    let uppercase_challenge = handshake().replace(CHALLENGE, &CHALLENGE.to_ascii_uppercase());
    let raw_digest = handshake().replace(SELF_DIGEST, &SELF_DIGEST[7..]);
    let bad_schema = handshake().replace(r#""schema_version":1"#, r#""schema_version":2"#);
    for payload in [bad_session, uppercase_challenge, raw_digest, bad_schema] {
        let mut engine = fresh_engine();
        assert_unbound_error(
            engine.handle_frame(payload.as_bytes()),
            ProtocolErrorCode::InvalidMessage,
        );
    }

    let mismatched_digest = handshake().replace(
        SELF_DIGEST,
        "sha256:cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd",
    );
    let mut engine = fresh_engine();
    assert_unbound_error(
        engine.handle_frame(mismatched_digest.as_bytes()),
        ProtocolErrorCode::InternalFailure,
    );
}

#[test]
fn fixed_message_caps_apply_before_any_private_value_is_echoed() {
    let padded_handshake = format!("{}{}", " ".repeat(MAX_CONTROL_MESSAGE_BYTES), handshake());
    assert!(padded_handshake.len() < MAX_WORK_REQUEST_BYTES);
    let mut engine = fresh_engine();
    assert_unbound_error(
        engine.handle_frame(padded_handshake.as_bytes()),
        ProtocolErrorCode::MessageTooLarge,
    );

    let oversized = vec![b' '; MAX_WORK_REQUEST_BYTES + 1];
    let mut engine = fresh_engine();
    assert_unbound_error(
        engine.handle_frame(&oversized),
        ProtocolErrorCode::MessageTooLarge,
    );
}

#[test]
fn frame_reader_is_bounded_drains_oversize_and_requires_newline() {
    let mut exact = vec![b'a'; 8];
    exact.extend_from_slice(b"\r\n");
    let mut reader = Cursor::new(exact);
    assert_eq!(
        read_bounded_frame(&mut reader, 8).expect("read should succeed"),
        FrameRead::MessageTooLarge
    );

    let mut input = vec![b'a'; 9];
    input.extend_from_slice(b"\nnext\n");
    let mut reader = Cursor::new(input);
    assert_eq!(
        read_bounded_frame(&mut reader, 8).expect("read should succeed"),
        FrameRead::MessageTooLarge
    );
    assert_eq!(
        read_bounded_frame(&mut reader, 8).expect("read should succeed"),
        FrameRead::Frame(b"next".to_vec())
    );

    let mut unterminated = Cursor::new(b"{}".to_vec());
    assert_eq!(
        read_bounded_frame(&mut unterminated, 8).expect("read should succeed"),
        FrameRead::Unterminated
    );
}

#[test]
fn compare_uses_monotonic_work_sequence_and_returns_no_paths() {
    let mut engine = handshaken_engine();
    let response =
        engine.handle_frame(compare(REQUEST_A, 1, r"C:\Room", r"C:\Room\Child").as_bytes());
    assert_eq!(
        response,
        ProtocolResponse::ComparePathsOk {
            schema_version: 1,
            session_ref: SESSION.to_owned(),
            request_ref: REQUEST_A.to_owned(),
            sequence: 1,
            relation: PathRelationWire::Ancestor,
        }
    );
    let serialized = String::from_utf8(encode_response_line(&response).expect("encode"))
        .expect("response is UTF-8");
    assert!(!serialized.contains("Room"));
    assert!(!serialized.contains("Child"));
}

#[test]
fn path_rejection_is_bound_but_never_leaks_the_private_path() {
    let mut engine = handshaken_engine();
    let private_path = r"\\server\secret\customer.e57";
    let response =
        engine.handle_frame(compare(REQUEST_A, 1, private_path, r"C:\Output").as_bytes());
    assert_eq!(
        response,
        ProtocolResponse::Error {
            schema_version: 1,
            session_ref: Some(SESSION.to_owned()),
            request_ref: Some(REQUEST_A.to_owned()),
            sequence: Some(1),
            control_sequence: None,
            code: ProtocolErrorCode::PathRejected,
        }
    );
    let serialized = String::from_utf8(encode_response_line(&response).expect("encode"))
        .expect("response is UTF-8");
    assert!(!serialized.contains("customer"));
    assert!(!serialized.contains("server"));
}

#[test]
fn stale_replay_skipped_cross_session_and_unsafe_sequences_are_unbound() {
    let cases = [
        (
            compare(REQUEST_A, 2, r"C:\Room", r"C:\Other"),
            ProtocolErrorCode::SequenceMismatch,
        ),
        (
            compare_for_session(OTHER_SESSION, REQUEST_A, 1, r"C:\Room", r"C:\Other"),
            ProtocolErrorCode::SessionMismatch,
        ),
        (
            compare(REQUEST_A, 9_007_199_254_740_992, r"C:\Room", r"C:\Other"),
            ProtocolErrorCode::InvalidMessage,
        ),
    ];
    for (payload, expected) in cases {
        let mut engine = handshaken_engine();
        let response = engine.handle_frame(payload.as_bytes());
        assert_unbound_error(response, expected);
    }

    let mut engine = handshaken_engine();
    let first = engine.handle_frame(compare(REQUEST_A, 1, r"C:\Room", r"C:\Other").as_bytes());
    assert!(matches!(first, ProtocolResponse::ComparePathsOk { .. }));
    assert_unbound_error(
        engine.handle_frame(compare(REQUEST_A, 1, r"C:\Room", r"C:\Other").as_bytes()),
        ProtocolErrorCode::SequenceMismatch,
    );
}

#[test]
fn every_pre_handshake_operation_error_is_fully_unbound() {
    let messages = [
        compare(REQUEST_A, 1, r"C:\Room", r"C:\Other"),
        format!(
            r#"{{"type":"cancel","schema_version":1,"session_ref":"{SESSION}","request_ref":"{REQUEST_B}","control_sequence":1,"target_request_ref":"bad"}}"#
        ),
        format!(
            r#"{{"type":"close","schema_version":1,"session_ref":"{SESSION}","request_ref":"{REQUEST_B}","control_sequence":1}}"#
        ),
        unavailable("pick_files"),
        unavailable("pick_folder"),
        unavailable("drop_sources"),
        unavailable("resolve_output"),
        unavailable("revalidate_start"),
    ];
    for message in messages {
        let mut engine = fresh_engine();
        assert_unbound_error(
            engine.handle_frame(message.as_bytes()),
            ProtocolErrorCode::InvalidMessage,
        );
    }
}

#[test]
fn rejected_revalidation_proves_no_live_scope_and_keeps_the_session_usable() {
    let mut engine = handshaken_engine();
    let revalidate = format!(
        r#"{{"type":"revalidate_start","schema_version":1,"session_ref":"{SESSION}","request_ref":"{REQUEST_A}","sequence":1,"basket_session_ref":"{BASKET}","controller_request_ref":"{REVALIDATED_REQUEST}","adapter_id":"windows-native-v1","adapter_build_sha256":"{SELF_DIGEST}","expected_source_refs":["{SOURCE_REF}"],"expected_output_ref":"{OUTPUT_REF}"}}"#
    );
    assert_eq!(
        engine.handle_frame(revalidate.as_bytes()),
        ProtocolResponse::RevalidateStartOk {
            schema_version: 1,
            session_ref: SESSION.to_owned(),
            request_ref: REQUEST_A.to_owned(),
            sequence: 1,
            basket_session_ref: BASKET.to_owned(),
            controller_request_ref: REVALIDATED_REQUEST.to_owned(),
            status: RevalidationStatus::Rejected,
            scope_ref: None,
            evidence: None,
            source_files: None,
            no_live_scope: Some(true),
        }
    );
    assert!(!engine.is_terminal());
    assert!(matches!(
        engine.handle_frame(compare(REQUEST_B, 2, r"C:\Room", r"C:\Other").as_bytes()),
        ProtocolResponse::ComparePathsOk { .. }
    ));
}

#[test]
fn output_creation_without_a_live_scope_fails_closed_and_terminates_the_session() {
    let mut engine = handshaken_engine();
    let create_run = format!(
        r#"{{"type":"create_run_output","schema_version":1,"session_ref":"{SESSION}","request_ref":"{REQUEST_A}","sequence":1,"scope_ref":"helper_scope_55555555555555555555555555555555"}}"#
    );

    assert_eq!(
        engine.handle_frame(create_run.as_bytes()),
        ProtocolResponse::Error {
            schema_version: 1,
            session_ref: Some(SESSION.to_owned()),
            request_ref: Some(REQUEST_A.to_owned()),
            sequence: Some(1),
            control_sequence: None,
            code: ProtocolErrorCode::CustodyRejected,
        }
    );
    assert!(engine.is_terminal());
}

#[test]
fn work_and_control_sequences_are_independent() {
    let mut engine = handshaken_engine();
    assert!(matches!(
        engine.handle_frame(compare(REQUEST_A, 1, r"C:\Room", r"C:\Other").as_bytes()),
        ProtocolResponse::ComparePathsOk { .. }
    ));

    let cancel = format!(
        r#"{{"type":"cancel","schema_version":1,"session_ref":"{SESSION}","request_ref":"{REQUEST_B}","control_sequence":1,"target_request_ref":"{REQUEST_C}"}}"#
    );
    assert_eq!(
        engine.handle_frame(cancel.as_bytes()),
        ProtocolResponse::Error {
            schema_version: 1,
            session_ref: Some(SESSION.to_owned()),
            request_ref: Some(REQUEST_B.to_owned()),
            sequence: None,
            control_sequence: Some(1),
            code: ProtocolErrorCode::CancelTargetUnknown,
        }
    );
    assert!(matches!(
        engine.handle_frame(compare(REQUEST_C, 2, r"C:\Room", r"C:\Other").as_bytes()),
        ProtocolResponse::ComparePathsOk { .. }
    ));
}

#[test]
fn control_sequence_skip_replay_and_cross_session_fail_unbound() {
    let control = |session_ref: &str, request_ref: &str, control_sequence: u64| {
        format!(
            r#"{{"type":"cancel","schema_version":1,"session_ref":"{session_ref}","request_ref":"{request_ref}","control_sequence":{control_sequence},"target_request_ref":"{REQUEST_C}"}}"#
        )
    };

    let mut skipped = handshaken_engine();
    assert_unbound_error(
        skipped.handle_frame(control(SESSION, REQUEST_B, 2).as_bytes()),
        ProtocolErrorCode::SequenceMismatch,
    );

    let mut cross_session = handshaken_engine();
    assert_unbound_error(
        cross_session.handle_frame(control(OTHER_SESSION, REQUEST_B, 1).as_bytes()),
        ProtocolErrorCode::SessionMismatch,
    );

    let mut replay = handshaken_engine();
    assert!(matches!(
        replay.handle_frame(control(SESSION, REQUEST_B, 1).as_bytes()),
        ProtocolResponse::Error {
            code: ProtocolErrorCode::CancelTargetUnknown,
            ..
        }
    ));
    assert_unbound_error(
        replay.handle_frame(control(SESSION, REQUEST_C, 1).as_bytes()),
        ProtocolErrorCode::SequenceMismatch,
    );
}

#[test]
fn cancellation_sets_atomic_token_and_close_clears_session() {
    let mut engine = handshaken_engine();
    let token = engine
        .begin_retained_native_work(WorkRequestBinding {
            schema_version: 1,
            session_ref: SESSION.to_owned(),
            request_ref: REQUEST_A.to_owned(),
            sequence: 1,
        })
        .expect("retained work should begin");
    assert!(!token.is_cancelled());

    let cancel = format!(
        r#"{{"type":"cancel","schema_version":1,"session_ref":"{SESSION}","request_ref":"{REQUEST_B}","control_sequence":1,"target_request_ref":"{REQUEST_A}"}}"#
    );
    assert_eq!(
        engine.handle_frame(cancel.as_bytes()),
        ProtocolResponse::CancelOk {
            schema_version: 1,
            session_ref: SESSION.to_owned(),
            request_ref: REQUEST_B.to_owned(),
            control_sequence: 1,
            target_request_ref: REQUEST_A.to_owned(),
            outcome: CancelOutcome::Requested,
        }
    );
    assert!(token.is_cancelled());

    let close = format!(
        r#"{{"type":"close","schema_version":1,"session_ref":"{SESSION}","request_ref":"{REQUEST_C}","control_sequence":2}}"#
    );
    assert!(matches!(
        engine.handle_frame(close.as_bytes()),
        ProtocolResponse::CloseOk {
            control_sequence: 2,
            ..
        }
    ));
    assert!(engine.is_terminal());
}

#[test]
fn request_references_cannot_cross_work_and_control_channels() {
    let mut engine = handshaken_engine();
    assert!(matches!(
        engine.handle_frame(compare(REQUEST_A, 1, r"C:\Room", r"C:\Other").as_bytes()),
        ProtocolResponse::ComparePathsOk { .. }
    ));
    let close = format!(
        r#"{{"type":"close","schema_version":1,"session_ref":"{SESSION}","request_ref":"{REQUEST_A}","control_sequence":1}}"#
    );
    assert_unbound_error(
        engine.handle_frame(close.as_bytes()),
        ProtocolErrorCode::SequenceMismatch,
    );
}

#[test]
fn sha256_reader_matches_standard_vector() {
    assert_eq!(
        sha256_reader(Cursor::new(b"abc")).expect("hash should succeed"),
        "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
}

#[test]
fn executable_rejects_cli_path_injection_without_echoing_it() {
    let secret = r"C:\private\customer-secret.e57";
    let output = Command::new(env!("CARGO_BIN_EXE_venviewer-windows-source-helper"))
        .arg(secret)
        .output()
        .expect("helper should launch");
    assert_eq!(output.status.code(), Some(65));
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).expect("stdout should be UTF-8");
    assert!(!stdout.contains(secret));
    assert_eq!(
        stdout,
        "{\"type\":\"error\",\"schema_version\":1,\"session_ref\":null,\"request_ref\":null,\"sequence\":null,\"control_sequence\":null,\"code\":\"INVALID_MESSAGE\"}\n"
    );
}

#[test]
fn real_process_roundtrip_is_pipe_only_and_ordered() {
    let executable = env!("CARGO_BIN_EXE_venviewer-windows-source-helper");
    let digest = sha256_reader(File::open(executable).expect("helper should be readable"))
        .expect("helper should hash");
    let handshake = format!(
        r#"{{"type":"handshake","schema_version":1,"session_ref":"{SESSION}","challenge":"{CHALLENGE}","expected_helper_sha256":"{digest}"}}"#
    );
    let close = format!(
        r#"{{"type":"close","schema_version":1,"session_ref":"{SESSION}","request_ref":"{REQUEST_B}","control_sequence":1}}"#
    );
    let input = format!(
        "{handshake}\n{}\n{close}\n",
        compare(REQUEST_A, 1, r"C:\Room", r"C:\Room\Child")
    );

    let mut child = Command::new(executable)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("helper should launch");
    child
        .stdin
        .take()
        .expect("stdin should be piped")
        .write_all(input.as_bytes())
        .expect("request should write");
    let output = child.wait_with_output().expect("helper should exit");
    assert!(output.status.success());
    assert!(output.stderr.is_empty());

    let stdout = String::from_utf8(output.stdout).expect("stdout should be UTF-8");
    let lines: Vec<&str> = stdout.lines().collect();
    assert_eq!(lines.len(), 3);
    assert!(lines[0].contains(r#""type":"handshake_ok""#));
    assert!(lines[0].contains(
        r#""capabilities":["pick_files","pick_folder","drop_sources","resolve_output","compare_paths","revalidate_start","release_revalidated_start","create_run_output","create_output_file","close"]"#
    ));
    assert!(lines[1].contains(r#""type":"compare_paths_ok""#));
    assert!(lines[1].contains(r#""relation":"ancestor""#));
    assert!(lines[2].contains(r#""type":"close_ok""#));
}

fn fresh_engine() -> ProtocolEngine {
    ProtocolEngine::new(SELF_DIGEST).expect("fixture digest is canonical")
}

fn handshaken_engine() -> ProtocolEngine {
    let mut engine = fresh_engine();
    assert!(matches!(
        engine.handle_frame(handshake().as_bytes()),
        ProtocolResponse::HandshakeOk { .. }
    ));
    engine
}

fn handshake() -> String {
    format!(
        r#"{{"type":"handshake","schema_version":1,"session_ref":"{SESSION}","challenge":"{CHALLENGE}","expected_helper_sha256":"{SELF_DIGEST}"}}"#
    )
}

fn compare(request_ref: &str, sequence: u64, left_path: &str, right_path: &str) -> String {
    compare_for_session(SESSION, request_ref, sequence, left_path, right_path)
}

fn compare_for_session(
    session_ref: &str,
    request_ref: &str,
    sequence: u64,
    left_path: &str,
    right_path: &str,
) -> String {
    format!(
        r#"{{"type":"compare_paths","schema_version":1,"session_ref":"{session_ref}","request_ref":"{request_ref}","sequence":{sequence},"left_path":{},"right_path":{}}}"#,
        serde_json::to_string(left_path).expect("left path should serialize"),
        serde_json::to_string(right_path).expect("right path should serialize"),
    )
}

fn drop_sources_for(
    session_ref: &str,
    request_ref: &str,
    sequence: u64,
    basket_session_ref: &str,
) -> String {
    format!(
        r#"{{"type":"drop_sources","schema_version":1,"session_ref":"{session_ref}","request_ref":"{request_ref}","sequence":{sequence},"basket_session_ref":"{basket_session_ref}","controller_request_ref":"{NATIVE_REQUEST}"}}"#
    )
}

fn unavailable(message_type: &str) -> String {
    format!(
        r#"{{"type":"{message_type}","schema_version":1,"session_ref":"{SESSION}","request_ref":"{REQUEST_A}","sequence":1}}"#
    )
}

fn assert_unbound_error(response: ProtocolResponse, expected_code: ProtocolErrorCode) {
    assert_eq!(
        response,
        ProtocolResponse::Error {
            schema_version: 1,
            session_ref: None,
            request_ref: None,
            sequence: None,
            control_sequence: None,
            code: expected_code,
        }
    );
}
