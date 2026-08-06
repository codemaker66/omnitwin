use std::borrow::Borrow;
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::fmt;
use std::io::{self, BufRead, Read};
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::de::{self, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
use sha2::{Digest, Sha256};
use windows::Win32::Security::Cryptography::{BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG};

use crate::custody::{
    FileIdentity, LocalDriveKind, LocalVolumeEvidence, RetainedSource, SourceKind,
};
use crate::drop_target::{DropTargetOutcome, DropTargetSta};
use crate::output::RetainedOutputRoot;
use crate::path::{
    compare_canonical_dos_paths, CanonicalDosPath, PathComparisonError, PathRelation,
};
use crate::picker::{PickerOutcome, PickerSta};
use crate::scope::{
    CombinedCustodyLimits, CombinedCustodyScope, DEFAULT_MAX_RETAINED_LAYOUT_MEMORY_BYTES,
};

pub const PROTOCOL_SCHEMA_VERSION: u32 = 1;
pub const BUILD_IDENTIFIER: &str = "venviewer-windows-source-helper/0.2.0";
pub const HANDSHAKE_DOMAIN: &str = "OMNITWIN.WINDOWS_SOURCE_HELPER.HANDSHAKE.V1";
pub const MAX_WORK_REQUEST_BYTES: usize = 1024 * 1024;
pub const MAX_CONTROL_MESSAGE_BYTES: usize = 64 * 1024;
pub const MAX_HELPER_RESPONSE_BYTES: usize = 32 * 1024 * 1024;
const MAX_TRACKED_REQUEST_REFERENCES: usize = 100_000;
const MAX_PROTOCOL_STRING_UTF16_UNITS: usize = 32_767;
const MAX_JSON_DEPTH: usize = 32;
const SHA256_PREFIX: &str = "sha256:";
const SHA256_HEX_LENGTH: usize = 64;
const CHALLENGE_HEX_LENGTH: usize = 64;
const MAX_SAFE_SEQUENCE: u64 = 9_007_199_254_740_991;
const MAX_ADAPTER_ID_BYTES: usize = 96;
const MAX_OUTPUT_COMPONENT_UTF16_UNITS: usize = 255;
const OPAQUE_REFERENCE_RANDOM_BYTES: usize = 16;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProtocolErrorCode {
    InvalidMessage,
    MessageTooLarge,
    UnsupportedOperation,
    SessionMismatch,
    SequenceMismatch,
    PathRejected,
    ComparisonFailed,
    CancelTargetUnknown,
    ReferenceUnknown,
    OperationOrderRejected,
    CustodyRejected,
    InternalFailure,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Capability {
    PickFiles,
    PickFolder,
    DropSources,
    ResolveOutput,
    ComparePaths,
    RevalidateStart,
    ReleaseRevalidatedStart,
    CreateRunOutput,
    CreateOutputFile,
    Close,
}

pub const CAPABILITIES: [Capability; 10] = [
    Capability::PickFiles,
    Capability::PickFolder,
    Capability::DropSources,
    Capability::ResolveOutput,
    Capability::ComparePaths,
    Capability::RevalidateStart,
    Capability::ReleaseRevalidatedStart,
    Capability::CreateRunOutput,
    Capability::CreateOutputFile,
    Capability::Close,
];

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PathRelationWire {
    Same,
    Ancestor,
    Descendant,
    Disjoint,
}

impl From<PathRelation> for PathRelationWire {
    fn from(value: PathRelation) -> Self {
        match value {
            PathRelation::Same => Self::Same,
            PathRelation::Ancestor => Self::Ancestor,
            PathRelation::Descendant => Self::Descendant,
            PathRelation::Disjoint => Self::Disjoint,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CancelOutcome {
    Requested,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SelectionStatus {
    Selected,
    Cancelled,
    Failed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OutputResolutionStatus {
    Resolved,
    Cancelled,
    Failed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RevalidationStatus {
    Opened,
    Rejected,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReleasedStatus {
    Released,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CreatedStatus {
    Created,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct FileIdentityWire {
    volume_serial_number_hex: String,
    file_id_hex: String,
}

impl From<FileIdentity> for FileIdentityWire {
    fn from(value: FileIdentity) -> Self {
        Self {
            volume_serial_number_hex: value.volume_serial_hex(),
            file_id_hex: value.file_id_hex(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct LocalVolumeEvidenceWire {
    opened_handle_file_type: &'static str,
    volume_path_resolution: &'static str,
    drive_type_query: &'static str,
    drive_type: &'static str,
    dos_device_query: &'static str,
    dos_device_mapping: &'static str,
    dos_device_alias_chain_detected: bool,
    subst_target_detected: bool,
    unc_redirector_detected: bool,
    network_device_target_detected: bool,
    opened_handle_volume_corroboration: &'static str,
    opened_handle_volume_serial_number_hex: String,
    volume_root_handle_serial_number_hex: String,
}

impl From<LocalVolumeEvidence> for LocalVolumeEvidenceWire {
    fn from(value: LocalVolumeEvidence) -> Self {
        let volume_serial = format!("{:016X}", value.corroborated_volume_serial());
        Self {
            opened_handle_file_type: "FILE_TYPE_DISK",
            volume_path_resolution: "get_volume_path_name_w",
            drive_type_query: "get_drive_type_w",
            drive_type: match value.drive_kind() {
                LocalDriveKind::Fixed => "DRIVE_FIXED",
                LocalDriveKind::Removable => "DRIVE_REMOVABLE",
            },
            dos_device_query: "query_dos_device_w",
            dos_device_mapping: "direct_local_volume",
            dos_device_alias_chain_detected: false,
            subst_target_detected: false,
            unc_redirector_detected: false,
            network_device_target_detected: false,
            opened_handle_volume_corroboration:
                "file_id_info_volume_serial_matches_opened_volume_root_handle",
            opened_handle_volume_serial_number_hex: volume_serial.clone(),
            volume_root_handle_serial_number_hex: volume_serial,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub struct SourcePathEvidenceWire {
    acquisition: &'static str,
    canonicalization: &'static str,
    inspection_mode: &'static str,
    path_identity_checked_by_handle: bool,
    reparse_inspection_scope: &'static str,
    reparse_inspection_complete: bool,
    reparse_points_encountered: u8,
    inventory_complete: bool,
    regular_files_only: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SourceAcquisition {
    Picker,
    Drop,
}

impl SourceAcquisition {
    fn path_evidence(self) -> SourcePathEvidenceWire {
        SourcePathEvidenceWire {
            acquisition: match self {
                Self::Picker => "windows_native_picker_handle",
                Self::Drop => "windows_native_drop_cfhdrop_then_handle_open",
            },
            canonicalization: "final_path_by_handle",
            inspection_mode: "read_only",
            path_identity_checked_by_handle: true,
            reparse_inspection_scope: "volume_root_through_complete_selection",
            reparse_inspection_complete: true,
            reparse_points_encountered: 0,
            inventory_complete: true,
            regular_files_only: true,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub struct OutputPathEvidenceWire {
    acquisition: &'static str,
    canonicalization: &'static str,
    inspection_mode: &'static str,
    path_identity_checked_by_handle: bool,
    directory_type_checked_by_handle: bool,
    reparse_inspection_scope: &'static str,
    reparse_inspection_complete: bool,
    reparse_points_encountered: u8,
}

const OUTPUT_PATH_EVIDENCE: OutputPathEvidenceWire = OutputPathEvidenceWire {
    acquisition: "windows_native_output_directory_handle",
    canonicalization: "final_path_by_handle",
    inspection_mode: "read_only",
    path_identity_checked_by_handle: true,
    directory_type_checked_by_handle: true,
    reparse_inspection_scope: "volume_root_through_output_directory",
    reparse_inspection_complete: true,
    reparse_points_encountered: 0,
};

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct SourceEvidenceWire {
    kind: &'static str,
    canonical_absolute_path: String,
    resolved_absolute_path: String,
    byte_count_decimal: String,
    file_count: usize,
    identity: FileIdentityWire,
    inventory_file_identities: Vec<FileIdentityWire>,
    path_evidence: SourcePathEvidenceWire,
    local_volume_evidence: LocalVolumeEvidenceWire,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct SourceSelectionWire {
    source_ref: String,
    evidence: SourceEvidenceWire,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct OutputBoundaryEvidenceWire {
    kind: &'static str,
    canonical_absolute_path: String,
    resolved_absolute_path: String,
    identity: FileIdentityWire,
    path_evidence: OutputPathEvidenceWire,
    local_volume_evidence: LocalVolumeEvidenceWire,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct OutputBoundaryWire {
    output_ref: String,
    boundary: OutputBoundaryEvidenceWire,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct SourcePairWire {
    left_selection_index: usize,
    right_selection_index: usize,
    relation: &'static str,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct OutputPairWire {
    selection_index: usize,
    relation: &'static str,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct NativePathComparisonsWire {
    source_pairs: Vec<SourcePairWire>,
    output_pairs: Vec<OutputPairWire>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct RevalidatedEvidenceWire {
    adapter_id: String,
    adapter_build_sha256: String,
    identity_comparison_mechanism: &'static str,
    path_comparison_mechanism: &'static str,
    output: OutputBoundaryWire,
    selections: Vec<SourceSelectionWire>,
    native_path_comparisons: NativePathComparisonsWire,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct SourceFileReferenceWire {
    source_file_ref: String,
    identity: FileIdentityWire,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ProtocolResponse {
    HandshakeOk {
        schema_version: u32,
        session_ref: String,
        process_architecture: &'static str,
        build_identifier: &'static str,
        self_observed_image_sha256: String,
        challenge_response_sha256: String,
        capabilities: [Capability; 10],
    },
    PickFilesOk {
        schema_version: u32,
        session_ref: String,
        request_ref: String,
        sequence: u64,
        basket_session_ref: String,
        controller_request_ref: String,
        status: SelectionStatus,
        #[serde(skip_serializing_if = "Option::is_none")]
        selections: Option<Vec<SourceSelectionWire>>,
    },
    PickFolderOk {
        schema_version: u32,
        session_ref: String,
        request_ref: String,
        sequence: u64,
        basket_session_ref: String,
        controller_request_ref: String,
        status: SelectionStatus,
        #[serde(skip_serializing_if = "Option::is_none")]
        selections: Option<Vec<SourceSelectionWire>>,
    },
    DropSourcesOk {
        schema_version: u32,
        session_ref: String,
        request_ref: String,
        sequence: u64,
        basket_session_ref: String,
        controller_request_ref: String,
        status: SelectionStatus,
        #[serde(skip_serializing_if = "Option::is_none")]
        selections: Option<Vec<SourceSelectionWire>>,
    },
    ResolveOutputOk {
        schema_version: u32,
        session_ref: String,
        request_ref: String,
        sequence: u64,
        basket_session_ref: String,
        controller_request_ref: String,
        status: OutputResolutionStatus,
        #[serde(skip_serializing_if = "Option::is_none")]
        output: Option<Box<OutputBoundaryWire>>,
    },
    ComparePathsOk {
        schema_version: u32,
        session_ref: String,
        request_ref: String,
        sequence: u64,
        relation: PathRelationWire,
    },
    RevalidateStartOk {
        schema_version: u32,
        session_ref: String,
        request_ref: String,
        sequence: u64,
        basket_session_ref: String,
        controller_request_ref: String,
        status: RevalidationStatus,
        #[serde(skip_serializing_if = "Option::is_none")]
        scope_ref: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        evidence: Option<Box<RevalidatedEvidenceWire>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        source_files: Option<Vec<SourceFileReferenceWire>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        no_live_scope: Option<bool>,
    },
    ReleaseRevalidatedStartOk {
        schema_version: u32,
        session_ref: String,
        request_ref: String,
        sequence: u64,
        basket_session_ref: String,
        controller_request_ref: String,
        scope_ref: String,
        status: ReleasedStatus,
    },
    CreateRunOutputOk {
        schema_version: u32,
        session_ref: String,
        request_ref: String,
        sequence: u64,
        scope_ref: String,
        run_ref: String,
        status: CreatedStatus,
        identity: FileIdentityWire,
    },
    CreateOutputFileOk {
        schema_version: u32,
        session_ref: String,
        request_ref: String,
        sequence: u64,
        scope_ref: String,
        run_ref: String,
        output_file_ref: String,
        status: CreatedStatus,
        identity: FileIdentityWire,
    },
    CancelOk {
        schema_version: u32,
        session_ref: String,
        request_ref: String,
        control_sequence: u64,
        target_request_ref: String,
        outcome: CancelOutcome,
    },
    CloseOk {
        schema_version: u32,
        session_ref: String,
        request_ref: String,
        control_sequence: u64,
    },
    Error {
        schema_version: u32,
        session_ref: Option<String>,
        request_ref: Option<String>,
        sequence: Option<u64>,
        control_sequence: Option<u64>,
        code: ProtocolErrorCode,
    },
}

impl ProtocolResponse {
    #[must_use]
    pub fn unbound_error(code: ProtocolErrorCode) -> Self {
        Self::Error {
            schema_version: PROTOCOL_SCHEMA_VERSION,
            session_ref: None,
            request_ref: None,
            sequence: None,
            control_sequence: None,
            code,
        }
    }

    #[must_use]
    pub fn is_close_acknowledgement(&self) -> bool {
        matches!(self, Self::CloseOk { .. })
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum InboundMessage {
    Handshake {
        schema_version: u32,
        session_ref: String,
        challenge: String,
        expected_helper_sha256: String,
    },
    ComparePaths {
        schema_version: u32,
        session_ref: String,
        request_ref: String,
        sequence: u64,
        left_path: String,
        right_path: String,
    },
    Cancel {
        schema_version: u32,
        session_ref: String,
        request_ref: String,
        control_sequence: u64,
        target_request_ref: String,
    },
    Close {
        schema_version: u32,
        session_ref: String,
        request_ref: String,
        control_sequence: u64,
    },
    PickFiles {
        schema_version: u32,
        session_ref: String,
        request_ref: String,
        sequence: u64,
        basket_session_ref: String,
        controller_request_ref: String,
    },
    PickFolder {
        schema_version: u32,
        session_ref: String,
        request_ref: String,
        sequence: u64,
        basket_session_ref: String,
        controller_request_ref: String,
    },
    DropSources {
        schema_version: u32,
        session_ref: String,
        request_ref: String,
        sequence: u64,
        basket_session_ref: String,
        controller_request_ref: String,
    },
    ResolveOutput {
        schema_version: u32,
        session_ref: String,
        request_ref: String,
        sequence: u64,
        basket_session_ref: String,
        controller_request_ref: String,
    },
    RevalidateStart {
        schema_version: u32,
        session_ref: String,
        request_ref: String,
        sequence: u64,
        basket_session_ref: String,
        controller_request_ref: String,
        adapter_id: String,
        adapter_build_sha256: String,
        expected_source_refs: Vec<String>,
        expected_output_ref: String,
    },
    ReleaseRevalidatedStart {
        schema_version: u32,
        session_ref: String,
        request_ref: String,
        sequence: u64,
        basket_session_ref: String,
        controller_request_ref: String,
        scope_ref: String,
    },
    CreateRunOutput {
        schema_version: u32,
        session_ref: String,
        request_ref: String,
        sequence: u64,
        scope_ref: String,
    },
    CreateOutputFile {
        schema_version: u32,
        session_ref: String,
        request_ref: String,
        sequence: u64,
        scope_ref: String,
        run_ref: String,
        component: String,
    },
}

impl InboundMessage {
    fn byte_cap(&self) -> usize {
        match self {
            Self::Handshake { .. } | Self::Cancel { .. } | Self::Close { .. } => {
                MAX_CONTROL_MESSAGE_BYTES
            }
            Self::ComparePaths { .. }
            | Self::PickFiles { .. }
            | Self::PickFolder { .. }
            | Self::DropSources { .. }
            | Self::ResolveOutput { .. }
            | Self::RevalidateStart { .. }
            | Self::ReleaseRevalidatedStart { .. }
            | Self::CreateRunOutput { .. }
            | Self::CreateOutputFile { .. } => MAX_WORK_REQUEST_BYTES,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkRequestBinding {
    pub schema_version: u32,
    pub session_ref: String,
    pub request_ref: String,
    pub sequence: u64,
}

#[derive(Clone, Debug)]
pub struct CancellationToken {
    cancelled: Arc<AtomicBool>,
}

impl CancellationToken {
    #[must_use]
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }
}

#[derive(Debug)]
pub enum ProtocolEngineInitError {
    InvalidSelfDigest,
}

impl fmt::Display for ProtocolEngineInitError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("the self-observed helper digest is not canonical")
    }
}

impl std::error::Error for ProtocolEngineInitError {}

pub struct ProtocolEngine {
    phase: Phase,
    self_observed_image_sha256: String,
}

enum Phase {
    AwaitingHandshake,
    Ready(Box<SessionState>),
    Failed,
    Closed,
}

struct SessionState {
    session_ref: PrivateAscii,
    basket_session_ref: Option<PrivateAscii>,
    next_work_sequence: u64,
    next_control_sequence: u64,
    seen_request_refs: HashSet<PrivateAscii>,
    active_work: Option<ActiveWork>,
    picker: Option<PickerSta>,
    drop_target: Option<DropTargetSta>,
    sources: Vec<SelectedSource>,
    output: Option<SelectedOutput>,
    active_scope: Option<ActiveScope>,
}

impl SessionState {
    fn new(session_ref: &str) -> Self {
        Self {
            session_ref: PrivateAscii::new(session_ref),
            basket_session_ref: None,
            next_work_sequence: 1,
            next_control_sequence: 1,
            seen_request_refs: HashSet::new(),
            active_work: None,
            picker: None,
            drop_target: None,
            sources: Vec::new(),
            output: None,
            active_scope: None,
        }
    }

    fn session_ref(&self) -> &str {
        self.session_ref.expose()
    }
}

struct SelectedSource {
    source_ref: PrivateAscii,
    retained: Rc<RetainedSource>,
    acquisition: SourceAcquisition,
}

struct SelectedOutput {
    output_ref: PrivateAscii,
    retained: RetainedOutputRoot,
    canonical_path: PrivateText,
}

struct ActiveScope {
    scope_ref: PrivateAscii,
    basket_session_ref: PrivateAscii,
    controller_request_ref: PrivateAscii,
    custody: CombinedCustodyScope,
    source_files: BTreeMap<PrivateAscii, FileIdentity>,
    run_ref: Option<PrivateAscii>,
    output_files: BTreeMap<PrivateAscii, FileIdentity>,
}

#[derive(Debug)]
struct ActiveWork {
    request_ref: PrivateAscii,
    cancellation: CancellationToken,
}

#[derive(Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
struct PrivateAscii(Vec<u8>);

impl PrivateAscii {
    fn new(value: &str) -> Self {
        Self(value.as_bytes().to_vec())
    }

    fn expose(&self) -> &str {
        std::str::from_utf8(&self.0).expect("PrivateAscii is constructed only from validated ASCII")
    }
}

struct PrivateText(String);

impl PrivateText {
    fn new(value: String) -> Self {
        Self(value)
    }

    fn expose(&self) -> &str {
        &self.0
    }
}

impl Drop for PrivateText {
    fn drop(&mut self) {
        // This only shortens the lifetime of this logical copy. It is not a
        // physical-memory sanitisation claim; process teardown is the final
        // address-space boundary.
        unsafe { self.0.as_bytes_mut() }.fill(0);
    }
}

impl Borrow<[u8]> for PrivateAscii {
    fn borrow(&self) -> &[u8] {
        &self.0
    }
}

impl Drop for PrivateAscii {
    fn drop(&mut self) {
        self.0.fill(0);
    }
}

impl ProtocolEngine {
    pub fn new(self_observed_image_sha256: &str) -> Result<Self, ProtocolEngineInitError> {
        if !is_canonical_sha256(self_observed_image_sha256) {
            return Err(ProtocolEngineInitError::InvalidSelfDigest);
        }
        Ok(Self {
            phase: Phase::AwaitingHandshake,
            self_observed_image_sha256: self_observed_image_sha256.to_owned(),
        })
    }

    pub fn handle_frame(&mut self, frame: &[u8]) -> ProtocolResponse {
        if frame.len() > MAX_WORK_REQUEST_BYTES {
            return self.terminal_error(ProtocolErrorCode::MessageTooLarge, None, None, None);
        }
        let Ok(text) = std::str::from_utf8(frame) else {
            return self.terminal_error(ProtocolErrorCode::InvalidMessage, None, None, None);
        };
        let Ok(strict_json) = serde_json::from_str::<StrictJson>(text) else {
            return self.terminal_error(ProtocolErrorCode::InvalidMessage, None, None, None);
        };
        if !strict_json.is_within_depth_limit(0) {
            return self.terminal_error(ProtocolErrorCode::InvalidMessage, None, None, None);
        }
        let Ok(message) = serde_json::from_value::<InboundMessage>(strict_json.into()) else {
            return self.terminal_error(ProtocolErrorCode::InvalidMessage, None, None, None);
        };
        if frame.len() > message.byte_cap() {
            return self.terminal_error(ProtocolErrorCode::MessageTooLarge, None, None, None);
        }
        self.handle_message(message)
    }

    pub fn begin_retained_native_work(
        &mut self,
        binding: WorkRequestBinding,
    ) -> Result<CancellationToken, ProtocolErrorCode> {
        self.accept_work_binding(&binding)?;
        let token = CancellationToken {
            cancelled: Arc::new(AtomicBool::new(false)),
        };
        let Phase::Ready(session) = &mut self.phase else {
            return Err(ProtocolErrorCode::InternalFailure);
        };
        session.active_work = Some(ActiveWork {
            request_ref: PrivateAscii::new(&binding.request_ref),
            cancellation: token.clone(),
        });
        Ok(token)
    }

    pub fn complete_retained_native_work(&mut self, request_ref: &str) -> bool {
        let Phase::Ready(session) = &mut self.phase else {
            return false;
        };
        if session
            .active_work
            .as_ref()
            .is_some_and(|active| active.request_ref.expose() == request_ref)
        {
            session.active_work = None;
            return true;
        }
        false
    }

    #[must_use]
    pub fn is_terminal(&self) -> bool {
        matches!(self.phase, Phase::Failed | Phase::Closed)
    }

    pub fn terminate_with_error(&mut self, code: ProtocolErrorCode) -> ProtocolResponse {
        self.terminal_error(code, None, None, None)
    }

    fn handle_message(&mut self, message: InboundMessage) -> ProtocolResponse {
        match message {
            InboundMessage::Handshake {
                schema_version,
                session_ref,
                challenge,
                expected_helper_sha256,
            } => self.handle_handshake(
                schema_version,
                &session_ref,
                &challenge,
                &expected_helper_sha256,
            ),
            InboundMessage::ComparePaths {
                schema_version,
                session_ref,
                request_ref,
                sequence,
                left_path,
                right_path,
            } => self.handle_compare_paths(
                WorkRequestBinding {
                    schema_version,
                    session_ref,
                    request_ref,
                    sequence,
                },
                &left_path,
                &right_path,
            ),
            InboundMessage::Cancel {
                schema_version,
                session_ref,
                request_ref,
                control_sequence,
                target_request_ref,
            } => self.handle_cancel(
                ControlRequestBinding {
                    schema_version,
                    session_ref,
                    request_ref,
                    control_sequence,
                },
                &target_request_ref,
            ),
            InboundMessage::Close {
                schema_version,
                session_ref,
                request_ref,
                control_sequence,
            } => self.handle_close(ControlRequestBinding {
                schema_version,
                session_ref,
                request_ref,
                control_sequence,
            }),
            InboundMessage::PickFiles {
                schema_version,
                session_ref,
                request_ref,
                sequence,
                basket_session_ref,
                controller_request_ref,
            } => self.handle_pick(
                WorkRequestBinding {
                    schema_version,
                    session_ref,
                    request_ref,
                    sequence,
                },
                &basket_session_ref,
                &controller_request_ref,
                SourceKind::File,
            ),
            InboundMessage::PickFolder {
                schema_version,
                session_ref,
                request_ref,
                sequence,
                basket_session_ref,
                controller_request_ref,
            } => self.handle_pick(
                WorkRequestBinding {
                    schema_version,
                    session_ref,
                    request_ref,
                    sequence,
                },
                &basket_session_ref,
                &controller_request_ref,
                SourceKind::Folder,
            ),
            InboundMessage::DropSources {
                schema_version,
                session_ref,
                request_ref,
                sequence,
                basket_session_ref,
                controller_request_ref,
            } => self.handle_drop_sources(
                WorkRequestBinding {
                    schema_version,
                    session_ref,
                    request_ref,
                    sequence,
                },
                &basket_session_ref,
                &controller_request_ref,
            ),
            InboundMessage::ResolveOutput {
                schema_version,
                session_ref,
                request_ref,
                sequence,
                basket_session_ref,
                controller_request_ref,
            } => self.handle_resolve_output(
                WorkRequestBinding {
                    schema_version,
                    session_ref,
                    request_ref,
                    sequence,
                },
                &basket_session_ref,
                &controller_request_ref,
            ),
            InboundMessage::RevalidateStart {
                schema_version,
                session_ref,
                request_ref,
                sequence,
                basket_session_ref,
                controller_request_ref,
                adapter_id,
                adapter_build_sha256,
                expected_source_refs,
                expected_output_ref,
            } => self.handle_revalidate_start(
                WorkRequestBinding {
                    schema_version,
                    session_ref,
                    request_ref,
                    sequence,
                },
                &basket_session_ref,
                &controller_request_ref,
                &adapter_id,
                &adapter_build_sha256,
                &expected_source_refs,
                &expected_output_ref,
            ),
            InboundMessage::ReleaseRevalidatedStart {
                schema_version,
                session_ref,
                request_ref,
                sequence,
                basket_session_ref,
                controller_request_ref,
                scope_ref,
            } => self.handle_release_revalidated_start(
                WorkRequestBinding {
                    schema_version,
                    session_ref,
                    request_ref,
                    sequence,
                },
                &basket_session_ref,
                &controller_request_ref,
                &scope_ref,
            ),
            InboundMessage::CreateRunOutput {
                schema_version,
                session_ref,
                request_ref,
                sequence,
                scope_ref,
            } => self.handle_create_run_output(
                WorkRequestBinding {
                    schema_version,
                    session_ref,
                    request_ref,
                    sequence,
                },
                &scope_ref,
            ),
            InboundMessage::CreateOutputFile {
                schema_version,
                session_ref,
                request_ref,
                sequence,
                scope_ref,
                run_ref,
                component,
            } => self.handle_create_output_file(
                WorkRequestBinding {
                    schema_version,
                    session_ref,
                    request_ref,
                    sequence,
                },
                &scope_ref,
                &run_ref,
                &component,
            ),
        }
    }

    fn handle_handshake(
        &mut self,
        schema_version: u32,
        session_ref: &str,
        challenge: &str,
        expected_helper_sha256: &str,
    ) -> ProtocolResponse {
        if !matches!(self.phase, Phase::AwaitingHandshake)
            || schema_version != PROTOCOL_SCHEMA_VERSION
            || !is_valid_session_ref(session_ref)
            || !is_lower_hex(challenge, CHALLENGE_HEX_LENGTH)
            || !is_canonical_sha256(expected_helper_sha256)
        {
            return self.terminal_error(ProtocolErrorCode::InvalidMessage, None, None, None);
        }
        if expected_helper_sha256 != self.self_observed_image_sha256 {
            return self.terminal_error(ProtocolErrorCode::InternalFailure, None, None, None);
        }
        let Ok(challenge_response_sha256) =
            derive_challenge_response(challenge, expected_helper_sha256)
        else {
            return self.terminal_error(ProtocolErrorCode::InternalFailure, None, None, None);
        };
        self.phase = Phase::Ready(Box::new(SessionState::new(session_ref)));
        ProtocolResponse::HandshakeOk {
            schema_version: PROTOCOL_SCHEMA_VERSION,
            session_ref: session_ref.to_owned(),
            process_architecture: "x86_64",
            build_identifier: BUILD_IDENTIFIER,
            self_observed_image_sha256: self.self_observed_image_sha256.clone(),
            challenge_response_sha256,
            capabilities: CAPABILITIES,
        }
    }

    fn handle_compare_paths(
        &mut self,
        binding: WorkRequestBinding,
        left_path: &str,
        right_path: &str,
    ) -> ProtocolResponse {
        if let Err(code) = self.accept_work_binding(&binding) {
            return self.binding_error(code, &binding);
        }
        let relation = match compare_canonical_dos_paths(left_path, right_path) {
            Ok(relation) => relation.into(),
            Err(PathComparisonError::WindowsComparisonFailed) => {
                return self.terminal_binding_error(ProtocolErrorCode::ComparisonFailed, &binding)
            }
            Err(PathComparisonError::InvalidLeft(_) | PathComparisonError::InvalidRight(_)) => {
                return self.terminal_binding_error(ProtocolErrorCode::PathRejected, &binding)
            }
        };
        ProtocolResponse::ComparePathsOk {
            schema_version: PROTOCOL_SCHEMA_VERSION,
            session_ref: binding.session_ref,
            request_ref: binding.request_ref,
            sequence: binding.sequence,
            relation,
        }
    }

    fn handle_pick(
        &mut self,
        binding: WorkRequestBinding,
        basket_session_ref: &str,
        controller_request_ref: &str,
        expected_kind: SourceKind,
    ) -> ProtocolResponse {
        let token = match self.begin_retained_native_work(binding.clone()) {
            Ok(token) => token,
            Err(code) => return self.binding_error(code, &binding),
        };
        let result = match &mut self.phase {
            Phase::Ready(session) => run_pick_operation(
                session,
                basket_session_ref,
                controller_request_ref,
                expected_kind,
                &token,
            ),
            _ => Err(NativeOperationError::Internal),
        };
        let _ = self.complete_retained_native_work(&binding.request_ref);
        match result {
            Ok(PickOperationOutcome::Selected(selections)) => self.pick_response(
                binding,
                basket_session_ref,
                controller_request_ref,
                expected_kind,
                SelectionStatus::Selected,
                Some(selections),
            ),
            Ok(PickOperationOutcome::Cancelled) | Err(NativeOperationError::Cancelled) => self
                .pick_response(
                    binding,
                    basket_session_ref,
                    controller_request_ref,
                    expected_kind,
                    SelectionStatus::Cancelled,
                    None,
                ),
            Err(NativeOperationError::Rejected) => self.pick_response(
                binding,
                basket_session_ref,
                controller_request_ref,
                expected_kind,
                SelectionStatus::Failed,
                None,
            ),
            Err(NativeOperationError::Binding(code)) => self.terminal_binding_error(code, &binding),
            Err(NativeOperationError::Internal) => {
                self.terminal_binding_error(ProtocolErrorCode::InternalFailure, &binding)
            }
        }
    }

    fn pick_response(
        &self,
        binding: WorkRequestBinding,
        basket_session_ref: &str,
        controller_request_ref: &str,
        expected_kind: SourceKind,
        status: SelectionStatus,
        selections: Option<Vec<SourceSelectionWire>>,
    ) -> ProtocolResponse {
        let fields = (
            PROTOCOL_SCHEMA_VERSION,
            binding.session_ref,
            binding.request_ref,
            binding.sequence,
            basket_session_ref.to_owned(),
            controller_request_ref.to_owned(),
            status,
            selections,
        );
        match expected_kind {
            SourceKind::File => ProtocolResponse::PickFilesOk {
                schema_version: fields.0,
                session_ref: fields.1,
                request_ref: fields.2,
                sequence: fields.3,
                basket_session_ref: fields.4,
                controller_request_ref: fields.5,
                status: fields.6,
                selections: fields.7,
            },
            SourceKind::Folder => ProtocolResponse::PickFolderOk {
                schema_version: fields.0,
                session_ref: fields.1,
                request_ref: fields.2,
                sequence: fields.3,
                basket_session_ref: fields.4,
                controller_request_ref: fields.5,
                status: fields.6,
                selections: fields.7,
            },
        }
    }

    fn handle_drop_sources(
        &mut self,
        binding: WorkRequestBinding,
        basket_session_ref: &str,
        controller_request_ref: &str,
    ) -> ProtocolResponse {
        let token = match self.begin_retained_native_work(binding.clone()) {
            Ok(token) => token,
            Err(code) => return self.binding_error(code, &binding),
        };
        let result = match &mut self.phase {
            Phase::Ready(session) => {
                run_drop_operation(session, basket_session_ref, controller_request_ref, &token)
            }
            _ => Err(NativeOperationError::Internal),
        };
        let _ = self.complete_retained_native_work(&binding.request_ref);
        let (status, selections) = match result {
            Ok(PickOperationOutcome::Selected(selections)) => {
                (SelectionStatus::Selected, Some(selections))
            }
            Ok(PickOperationOutcome::Cancelled) | Err(NativeOperationError::Cancelled) => {
                (SelectionStatus::Cancelled, None)
            }
            Err(NativeOperationError::Rejected) => (SelectionStatus::Failed, None),
            Err(NativeOperationError::Binding(code)) => {
                return self.terminal_binding_error(code, &binding)
            }
            Err(NativeOperationError::Internal) => {
                return self.terminal_binding_error(ProtocolErrorCode::InternalFailure, &binding)
            }
        };
        ProtocolResponse::DropSourcesOk {
            schema_version: PROTOCOL_SCHEMA_VERSION,
            session_ref: binding.session_ref,
            request_ref: binding.request_ref,
            sequence: binding.sequence,
            basket_session_ref: basket_session_ref.to_owned(),
            controller_request_ref: controller_request_ref.to_owned(),
            status,
            selections,
        }
    }

    fn handle_resolve_output(
        &mut self,
        binding: WorkRequestBinding,
        basket_session_ref: &str,
        controller_request_ref: &str,
    ) -> ProtocolResponse {
        let token = match self.begin_retained_native_work(binding.clone()) {
            Ok(token) => token,
            Err(code) => return self.binding_error(code, &binding),
        };
        let result = match &mut self.phase {
            Phase::Ready(session) => run_resolve_output_operation(
                session,
                basket_session_ref,
                controller_request_ref,
                &token,
            ),
            _ => Err(NativeOperationError::Internal),
        };
        let _ = self.complete_retained_native_work(&binding.request_ref);
        match result {
            Ok(OutputOperationOutcome::Resolved(output)) => ProtocolResponse::ResolveOutputOk {
                schema_version: PROTOCOL_SCHEMA_VERSION,
                session_ref: binding.session_ref,
                request_ref: binding.request_ref,
                sequence: binding.sequence,
                basket_session_ref: basket_session_ref.to_owned(),
                controller_request_ref: controller_request_ref.to_owned(),
                status: OutputResolutionStatus::Resolved,
                output: Some(output),
            },
            Ok(OutputOperationOutcome::Cancelled) | Err(NativeOperationError::Cancelled) => {
                ProtocolResponse::ResolveOutputOk {
                    schema_version: PROTOCOL_SCHEMA_VERSION,
                    session_ref: binding.session_ref,
                    request_ref: binding.request_ref,
                    sequence: binding.sequence,
                    basket_session_ref: basket_session_ref.to_owned(),
                    controller_request_ref: controller_request_ref.to_owned(),
                    status: OutputResolutionStatus::Cancelled,
                    output: None,
                }
            }
            Err(NativeOperationError::Rejected) => ProtocolResponse::ResolveOutputOk {
                schema_version: PROTOCOL_SCHEMA_VERSION,
                session_ref: binding.session_ref,
                request_ref: binding.request_ref,
                sequence: binding.sequence,
                basket_session_ref: basket_session_ref.to_owned(),
                controller_request_ref: controller_request_ref.to_owned(),
                status: OutputResolutionStatus::Failed,
                output: None,
            },
            Err(NativeOperationError::Binding(code)) => self.terminal_binding_error(code, &binding),
            Err(NativeOperationError::Internal) => {
                self.terminal_binding_error(ProtocolErrorCode::InternalFailure, &binding)
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn handle_revalidate_start(
        &mut self,
        binding: WorkRequestBinding,
        basket_session_ref: &str,
        controller_request_ref: &str,
        adapter_id: &str,
        adapter_build_sha256: &str,
        expected_source_refs: &[String],
        expected_output_ref: &str,
    ) -> ProtocolResponse {
        let token = match self.begin_retained_native_work(binding.clone()) {
            Ok(token) => token,
            Err(code) => return self.binding_error(code, &binding),
        };
        let result = match &mut self.phase {
            Phase::Ready(session) => run_revalidate_start_operation(
                session,
                basket_session_ref,
                controller_request_ref,
                adapter_id,
                adapter_build_sha256,
                expected_source_refs,
                expected_output_ref,
                &token,
            ),
            _ => Err(NativeOperationError::Internal),
        };
        let _ = self.complete_retained_native_work(&binding.request_ref);
        match result {
            Ok(RevalidationOperationOutcome {
                scope_ref,
                evidence,
                source_files,
            }) => ProtocolResponse::RevalidateStartOk {
                schema_version: PROTOCOL_SCHEMA_VERSION,
                session_ref: binding.session_ref,
                request_ref: binding.request_ref,
                sequence: binding.sequence,
                basket_session_ref: basket_session_ref.to_owned(),
                controller_request_ref: controller_request_ref.to_owned(),
                status: RevalidationStatus::Opened,
                scope_ref: Some(scope_ref),
                evidence: Some(Box::new(evidence)),
                source_files: Some(source_files),
                no_live_scope: None,
            },
            Err(NativeOperationError::Rejected | NativeOperationError::Cancelled) => {
                ProtocolResponse::RevalidateStartOk {
                    schema_version: PROTOCOL_SCHEMA_VERSION,
                    session_ref: binding.session_ref,
                    request_ref: binding.request_ref,
                    sequence: binding.sequence,
                    basket_session_ref: basket_session_ref.to_owned(),
                    controller_request_ref: controller_request_ref.to_owned(),
                    status: RevalidationStatus::Rejected,
                    scope_ref: None,
                    evidence: None,
                    source_files: None,
                    no_live_scope: Some(true),
                }
            }
            Err(NativeOperationError::Binding(code)) => self.terminal_binding_error(code, &binding),
            Err(NativeOperationError::Internal) => {
                self.terminal_binding_error(ProtocolErrorCode::InternalFailure, &binding)
            }
        }
    }

    fn handle_release_revalidated_start(
        &mut self,
        binding: WorkRequestBinding,
        basket_session_ref: &str,
        controller_request_ref: &str,
        scope_ref: &str,
    ) -> ProtocolResponse {
        let token = match self.begin_retained_native_work(binding.clone()) {
            Ok(token) => token,
            Err(code) => return self.binding_error(code, &binding),
        };
        let result = match &mut self.phase {
            Phase::Ready(session) => run_release_scope_operation(
                session,
                basket_session_ref,
                controller_request_ref,
                scope_ref,
                &token,
            ),
            _ => Err(NativeOperationError::Internal),
        };
        let _ = self.complete_retained_native_work(&binding.request_ref);
        match result {
            Ok(()) => ProtocolResponse::ReleaseRevalidatedStartOk {
                schema_version: PROTOCOL_SCHEMA_VERSION,
                session_ref: binding.session_ref,
                request_ref: binding.request_ref,
                sequence: binding.sequence,
                basket_session_ref: basket_session_ref.to_owned(),
                controller_request_ref: controller_request_ref.to_owned(),
                scope_ref: scope_ref.to_owned(),
                status: ReleasedStatus::Released,
            },
            Err(NativeOperationError::Binding(code)) => self.terminal_binding_error(code, &binding),
            Err(NativeOperationError::Rejected | NativeOperationError::Cancelled) => {
                self.terminal_binding_error(ProtocolErrorCode::ReferenceUnknown, &binding)
            }
            Err(NativeOperationError::Internal) => {
                self.terminal_binding_error(ProtocolErrorCode::InternalFailure, &binding)
            }
        }
    }

    fn handle_create_run_output(
        &mut self,
        binding: WorkRequestBinding,
        scope_ref: &str,
    ) -> ProtocolResponse {
        let token = match self.begin_retained_native_work(binding.clone()) {
            Ok(token) => token,
            Err(code) => return self.binding_error(code, &binding),
        };
        let result = match &mut self.phase {
            Phase::Ready(session) => run_create_run_operation(session, scope_ref, &token),
            _ => Err(NativeOperationError::Internal),
        };
        let _ = self.complete_retained_native_work(&binding.request_ref);
        match result {
            Ok((run_ref, identity)) => ProtocolResponse::CreateRunOutputOk {
                schema_version: PROTOCOL_SCHEMA_VERSION,
                session_ref: binding.session_ref,
                request_ref: binding.request_ref,
                sequence: binding.sequence,
                scope_ref: scope_ref.to_owned(),
                run_ref,
                status: CreatedStatus::Created,
                identity: identity.into(),
            },
            Err(NativeOperationError::Binding(code)) => self.terminal_binding_error(code, &binding),
            Err(NativeOperationError::Rejected | NativeOperationError::Cancelled) => {
                self.terminal_binding_error(ProtocolErrorCode::CustodyRejected, &binding)
            }
            Err(NativeOperationError::Internal) => {
                self.terminal_binding_error(ProtocolErrorCode::InternalFailure, &binding)
            }
        }
    }

    fn handle_create_output_file(
        &mut self,
        binding: WorkRequestBinding,
        scope_ref: &str,
        run_ref: &str,
        component: &str,
    ) -> ProtocolResponse {
        let token = match self.begin_retained_native_work(binding.clone()) {
            Ok(token) => token,
            Err(code) => return self.binding_error(code, &binding),
        };
        let result = match &mut self.phase {
            Phase::Ready(session) => {
                run_create_output_file_operation(session, scope_ref, run_ref, component, &token)
            }
            _ => Err(NativeOperationError::Internal),
        };
        let _ = self.complete_retained_native_work(&binding.request_ref);
        match result {
            Ok((output_file_ref, identity)) => ProtocolResponse::CreateOutputFileOk {
                schema_version: PROTOCOL_SCHEMA_VERSION,
                session_ref: binding.session_ref,
                request_ref: binding.request_ref,
                sequence: binding.sequence,
                scope_ref: scope_ref.to_owned(),
                run_ref: run_ref.to_owned(),
                output_file_ref,
                status: CreatedStatus::Created,
                identity: identity.into(),
            },
            Err(NativeOperationError::Binding(code)) => self.terminal_binding_error(code, &binding),
            Err(NativeOperationError::Rejected | NativeOperationError::Cancelled) => {
                self.terminal_binding_error(ProtocolErrorCode::CustodyRejected, &binding)
            }
            Err(NativeOperationError::Internal) => {
                self.terminal_binding_error(ProtocolErrorCode::InternalFailure, &binding)
            }
        }
    }

    fn handle_cancel(
        &mut self,
        binding: ControlRequestBinding,
        target_request_ref: &str,
    ) -> ProtocolResponse {
        if let Err(code) = self.accept_control_binding(&binding) {
            return self.control_binding_error(code, &binding);
        }
        if !is_valid_request_ref(target_request_ref) {
            return self
                .terminal_control_binding_error(ProtocolErrorCode::InvalidMessage, &binding);
        }
        let Phase::Ready(session) = &mut self.phase else {
            return self.control_error(ProtocolErrorCode::InternalFailure, &binding);
        };
        let Some(active) = &session.active_work else {
            return self.control_error(ProtocolErrorCode::CancelTargetUnknown, &binding);
        };
        if active.request_ref.expose() != target_request_ref {
            return self.control_error(ProtocolErrorCode::CancelTargetUnknown, &binding);
        }
        active.cancellation.cancelled.store(true, Ordering::Release);
        ProtocolResponse::CancelOk {
            schema_version: PROTOCOL_SCHEMA_VERSION,
            session_ref: binding.session_ref,
            request_ref: binding.request_ref,
            control_sequence: binding.control_sequence,
            target_request_ref: target_request_ref.to_owned(),
            outcome: CancelOutcome::Requested,
        }
    }

    fn handle_close(&mut self, binding: ControlRequestBinding) -> ProtocolResponse {
        if let Err(code) = self.accept_control_binding(&binding) {
            return self.control_binding_error(code, &binding);
        }
        if let Phase::Ready(session) = &mut self.phase {
            if let Some(active) = &session.active_work {
                active.cancellation.cancelled.store(true, Ordering::Release);
            }
        }
        let response = ProtocolResponse::CloseOk {
            schema_version: PROTOCOL_SCHEMA_VERSION,
            session_ref: binding.session_ref,
            request_ref: binding.request_ref,
            control_sequence: binding.control_sequence,
        };
        self.phase = Phase::Closed;
        response
    }

    fn accept_work_binding(
        &mut self,
        binding: &WorkRequestBinding,
    ) -> Result<(), ProtocolErrorCode> {
        let Phase::Ready(session) = &mut self.phase else {
            return Err(ProtocolErrorCode::InvalidMessage);
        };
        if binding.schema_version != PROTOCOL_SCHEMA_VERSION
            || !is_valid_request_ref(&binding.request_ref)
            || !(1..=MAX_SAFE_SEQUENCE).contains(&binding.sequence)
        {
            return Err(ProtocolErrorCode::InvalidMessage);
        }
        if binding.session_ref != session.session_ref() {
            return Err(ProtocolErrorCode::SessionMismatch);
        }
        if binding.sequence != session.next_work_sequence
            || session
                .seen_request_refs
                .contains(binding.request_ref.as_bytes())
            || session.active_work.is_some()
        {
            return Err(ProtocolErrorCode::SequenceMismatch);
        }
        track_request_reference(session, &binding.request_ref)?;
        session.next_work_sequence = session
            .next_work_sequence
            .checked_add(1)
            .ok_or(ProtocolErrorCode::InternalFailure)?;
        Ok(())
    }

    fn accept_control_binding(
        &mut self,
        binding: &ControlRequestBinding,
    ) -> Result<(), ProtocolErrorCode> {
        let Phase::Ready(session) = &mut self.phase else {
            return Err(ProtocolErrorCode::InvalidMessage);
        };
        if binding.schema_version != PROTOCOL_SCHEMA_VERSION
            || !is_valid_request_ref(&binding.request_ref)
            || !(1..=MAX_SAFE_SEQUENCE).contains(&binding.control_sequence)
        {
            return Err(ProtocolErrorCode::InvalidMessage);
        }
        if binding.session_ref != session.session_ref() {
            return Err(ProtocolErrorCode::SessionMismatch);
        }
        if binding.control_sequence != session.next_control_sequence
            || session
                .seen_request_refs
                .contains(binding.request_ref.as_bytes())
        {
            return Err(ProtocolErrorCode::SequenceMismatch);
        }
        track_request_reference(session, &binding.request_ref)?;
        session.next_control_sequence = session
            .next_control_sequence
            .checked_add(1)
            .ok_or(ProtocolErrorCode::InternalFailure)?;
        Ok(())
    }

    fn binding_error(
        &mut self,
        code: ProtocolErrorCode,
        binding: &WorkRequestBinding,
    ) -> ProtocolResponse {
        let _ = binding;
        self.fully_unbound_terminal_error(code)
    }

    fn control_binding_error(
        &mut self,
        code: ProtocolErrorCode,
        binding: &ControlRequestBinding,
    ) -> ProtocolResponse {
        let _ = binding;
        self.fully_unbound_terminal_error(code)
    }

    fn terminal_binding_error(
        &mut self,
        code: ProtocolErrorCode,
        binding: &WorkRequestBinding,
    ) -> ProtocolResponse {
        let response = self.work_error(code, binding);
        self.phase = Phase::Failed;
        response
    }

    fn terminal_control_binding_error(
        &mut self,
        code: ProtocolErrorCode,
        binding: &ControlRequestBinding,
    ) -> ProtocolResponse {
        let response = self.control_error(code, binding);
        self.phase = Phase::Failed;
        response
    }

    fn work_error(
        &self,
        code: ProtocolErrorCode,
        binding: &WorkRequestBinding,
    ) -> ProtocolResponse {
        ProtocolResponse::Error {
            schema_version: PROTOCOL_SCHEMA_VERSION,
            session_ref: self.accepted_session_ref(),
            request_ref: Some(binding.request_ref.clone()),
            sequence: Some(binding.sequence),
            control_sequence: None,
            code,
        }
    }

    fn control_error(
        &self,
        code: ProtocolErrorCode,
        binding: &ControlRequestBinding,
    ) -> ProtocolResponse {
        ProtocolResponse::Error {
            schema_version: PROTOCOL_SCHEMA_VERSION,
            session_ref: self.accepted_session_ref(),
            request_ref: Some(binding.request_ref.clone()),
            sequence: None,
            control_sequence: Some(binding.control_sequence),
            code,
        }
    }

    fn terminal_error(
        &mut self,
        code: ProtocolErrorCode,
        request_ref: Option<String>,
        sequence: Option<u64>,
        control_sequence: Option<u64>,
    ) -> ProtocolResponse {
        let response = ProtocolResponse::Error {
            schema_version: PROTOCOL_SCHEMA_VERSION,
            session_ref: self.accepted_session_ref(),
            request_ref,
            sequence,
            control_sequence,
            code,
        };
        self.phase = Phase::Failed;
        response
    }

    fn fully_unbound_terminal_error(&mut self, code: ProtocolErrorCode) -> ProtocolResponse {
        self.phase = Phase::Failed;
        ProtocolResponse::unbound_error(code)
    }

    fn accepted_session_ref(&self) -> Option<String> {
        let Phase::Ready(session) = &self.phase else {
            return None;
        };
        Some(session.session_ref().to_owned())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum NativeOperationError {
    Cancelled,
    Rejected,
    Binding(ProtocolErrorCode),
    Internal,
}

enum PickOperationOutcome {
    Selected(Vec<SourceSelectionWire>),
    Cancelled,
}

enum OutputOperationOutcome {
    Resolved(Box<OutputBoundaryWire>),
    Cancelled,
}

struct RevalidationOperationOutcome {
    scope_ref: String,
    evidence: RevalidatedEvidenceWire,
    source_files: Vec<SourceFileReferenceWire>,
}

fn run_pick_operation(
    session: &mut SessionState,
    basket_session_ref: &str,
    controller_request_ref: &str,
    expected_kind: SourceKind,
    token: &CancellationToken,
) -> Result<PickOperationOutcome, NativeOperationError> {
    validate_adapter_binding(session, basket_session_ref, controller_request_ref, false)?;
    if session.active_scope.is_some() {
        return Err(NativeOperationError::Binding(
            ProtocolErrorCode::OperationOrderRejected,
        ));
    }
    check_native_cancelled(token)?;
    if session.picker.is_none() {
        session.picker = Some(PickerSta::start().map_err(|_| NativeOperationError::Rejected)?);
    }
    let picker = session
        .picker
        .as_ref()
        .ok_or(NativeOperationError::Internal)?;
    let pending = match expected_kind {
        SourceKind::File => picker.begin_files(),
        SourceKind::Folder => picker.begin_folder(),
    }
    .map_err(|_| NativeOperationError::Rejected)?;
    if token.is_cancelled() {
        pending
            .request_cancel()
            .map_err(|_| NativeOperationError::Rejected)?;
    }
    let outcome = pending.wait().map_err(|_| NativeOperationError::Rejected)?;
    check_native_cancelled(token)?;
    let selection = match outcome {
        PickerOutcome::Cancelled => return Ok(PickOperationOutcome::Cancelled),
        PickerOutcome::Selected(selection) => selection,
    };
    let locators = selection.into_locators();
    if locators.is_empty() || (expected_kind == SourceKind::Folder && locators.len() != 1) {
        return Err(NativeOperationError::Rejected);
    }
    let locator_views = locators
        .iter()
        .map(|locator| locator.as_utf16())
        .collect::<Vec<_>>();
    retain_source_locators(
        session,
        &locator_views,
        Some(expected_kind),
        SourceAcquisition::Picker,
        token,
    )
    .map(PickOperationOutcome::Selected)
}

fn run_drop_operation(
    session: &mut SessionState,
    basket_session_ref: &str,
    controller_request_ref: &str,
    token: &CancellationToken,
) -> Result<PickOperationOutcome, NativeOperationError> {
    validate_adapter_binding(session, basket_session_ref, controller_request_ref, false)?;
    if session.active_scope.is_some() {
        return Err(NativeOperationError::Binding(
            ProtocolErrorCode::OperationOrderRejected,
        ));
    }
    check_native_cancelled(token)?;
    if session.drop_target.is_none() {
        session.drop_target =
            Some(DropTargetSta::start().map_err(|_| NativeOperationError::Rejected)?);
    }
    let pending = session
        .drop_target
        .as_ref()
        .ok_or(NativeOperationError::Internal)?
        .begin()
        .map_err(|_| NativeOperationError::Rejected)?;
    if token.is_cancelled() {
        pending
            .request_cancel()
            .map_err(|_| NativeOperationError::Rejected)?;
    }
    let outcome = pending.wait().map_err(|_| NativeOperationError::Rejected)?;
    check_native_cancelled(token)?;
    let selection = match outcome {
        DropTargetOutcome::Cancelled => return Ok(PickOperationOutcome::Cancelled),
        DropTargetOutcome::Dropped(selection) => selection,
    };
    let locators = selection.into_locators();
    let locator_views = locators
        .iter()
        .map(|locator| locator.as_utf16())
        .collect::<Vec<_>>();
    retain_source_locators(
        session,
        &locator_views,
        None,
        SourceAcquisition::Drop,
        token,
    )
    .map(PickOperationOutcome::Selected)
}

fn retain_source_locators(
    session: &mut SessionState,
    locators: &[&[u16]],
    expected_kind: Option<SourceKind>,
    acquisition: SourceAcquisition,
    token: &CancellationToken,
) -> Result<Vec<SourceSelectionWire>, NativeOperationError> {
    if locators.is_empty() || session.sources.len().saturating_add(locators.len()) > 128 {
        return Err(NativeOperationError::Rejected);
    }
    let mut candidates = Vec::with_capacity(locators.len());
    for locator in locators {
        check_native_cancelled(token)?;
        let locator_text =
            String::from_utf16(locator).map_err(|_| NativeOperationError::Rejected)?;
        let canonical =
            CanonicalDosPath::parse(&locator_text).map_err(|_| NativeOperationError::Rejected)?;
        let retained = Rc::new(
            RetainedSource::open(
                &canonical,
                CombinedCustodyLimits::default().per_source,
                || token.is_cancelled(),
            )
            .map_err(|_| NativeOperationError::Rejected)?,
        );
        if expected_kind.is_some_and(|kind| retained.kind() != kind) {
            return Err(NativeOperationError::Rejected);
        }
        check_native_cancelled(token)?;
        candidates.push(retained);
    }
    validate_candidate_sources(session, &candidates)?;
    check_native_cancelled(token)?;

    let mut used_refs = collect_opaque_references(session);
    let mut selected = Vec::with_capacity(candidates.len());
    for retained in candidates {
        check_native_cancelled(token)?;
        let source_ref = generate_opaque_reference("helper_source_", &used_refs)?;
        used_refs.insert(source_ref.clone());
        selected.push(SelectedSource {
            source_ref: PrivateAscii::new(&source_ref),
            retained,
            acquisition,
        });
    }
    let wire = selected.iter().map(source_selection_wire).collect();
    check_native_cancelled(token)?;
    session.sources.extend(selected);
    Ok(wire)
}

fn run_resolve_output_operation(
    session: &mut SessionState,
    basket_session_ref: &str,
    controller_request_ref: &str,
    token: &CancellationToken,
) -> Result<OutputOperationOutcome, NativeOperationError> {
    validate_adapter_binding(session, basket_session_ref, controller_request_ref, false)?;
    if session.active_scope.is_some() || session.output.is_some() {
        return Err(NativeOperationError::Binding(
            ProtocolErrorCode::OperationOrderRejected,
        ));
    }
    check_native_cancelled(token)?;
    if session.picker.is_none() {
        session.picker = Some(PickerSta::start().map_err(|_| NativeOperationError::Rejected)?);
    }
    let pending = session
        .picker
        .as_ref()
        .ok_or(NativeOperationError::Internal)?
        .begin_folder()
        .map_err(|_| NativeOperationError::Rejected)?;
    if token.is_cancelled() {
        pending
            .request_cancel()
            .map_err(|_| NativeOperationError::Rejected)?;
    }
    let outcome = pending.wait().map_err(|_| NativeOperationError::Rejected)?;
    check_native_cancelled(token)?;
    let selection = match outcome {
        PickerOutcome::Cancelled => return Ok(OutputOperationOutcome::Cancelled),
        PickerOutcome::Selected(selection) => selection,
    };
    let mut locators = selection.into_locators();
    if locators.len() != 1 {
        return Err(NativeOperationError::Rejected);
    }
    let locator = locators.pop().ok_or(NativeOperationError::Rejected)?;
    let locator_text =
        String::from_utf16(locator.as_utf16()).map_err(|_| NativeOperationError::Rejected)?;
    let canonical =
        CanonicalDosPath::parse(&locator_text).map_err(|_| NativeOperationError::Rejected)?;
    let retained =
        RetainedOutputRoot::open(&canonical).map_err(|_| NativeOperationError::Rejected)?;
    let output_identity = retained.identity();
    if all_source_identities(&session.sources).contains(&output_identity) {
        return Err(NativeOperationError::Rejected);
    }
    let used_refs = collect_opaque_references(session);
    let output_ref = generate_opaque_reference("helper_output_", &used_refs)?;
    let selected = SelectedOutput {
        output_ref: PrivateAscii::new(&output_ref),
        retained,
        canonical_path: PrivateText::new(canonical.as_str().to_owned()),
    };
    let wire = output_boundary_wire(&selected);
    session.output = Some(selected);
    Ok(OutputOperationOutcome::Resolved(Box::new(wire)))
}

fn validate_candidate_sources(
    session: &SessionState,
    candidates: &[Rc<RetainedSource>],
) -> Result<(), NativeOperationError> {
    let limits = CombinedCustodyLimits::default();
    let mut identities = all_source_identities(&session.sources);
    if let Some(output) = &session.output {
        identities.insert(output.retained.identity());
    }
    let mut total_files = session
        .sources
        .iter()
        .map(|source| source.retained.inventory().file_count())
        .sum::<usize>();
    let mut total_entries = session
        .sources
        .iter()
        .map(|source| {
            source.retained.inventory().file_count() + source.retained.inventory().directory_count()
        })
        .sum::<usize>();
    let mut total_bytes = session
        .sources
        .iter()
        .try_fold(0u64, |total, source| {
            total.checked_add(source.retained.inventory().total_bytes())
        })
        .ok_or(NativeOperationError::Rejected)?;
    let mut retained_layout_memory_bytes =
        session.sources.iter().try_fold(0u64, |total, source| {
            checked_add_retained_layout_memory(
                total,
                source.retained.inventory().modeled_layout_memory_bytes(),
            )
        })?;
    for source in candidates {
        let inventory = source.inventory();
        total_files = total_files
            .checked_add(inventory.file_count())
            .ok_or(NativeOperationError::Rejected)?;
        total_entries = total_entries
            .checked_add(inventory.file_count())
            .and_then(|total| total.checked_add(inventory.directory_count()))
            .ok_or(NativeOperationError::Rejected)?;
        total_bytes = total_bytes
            .checked_add(inventory.total_bytes())
            .ok_or(NativeOperationError::Rejected)?;
        retained_layout_memory_bytes = checked_add_retained_layout_memory(
            retained_layout_memory_bytes,
            inventory.modeled_layout_memory_bytes(),
        )?;
        if !identities.insert(inventory.root_identity()) {
            return Err(NativeOperationError::Rejected);
        }
        for identity in inventory.identities() {
            if identity == inventory.root_identity() {
                continue;
            }
            if !identities.insert(identity) {
                return Err(NativeOperationError::Rejected);
            }
        }
    }
    if total_files > limits.max_total_files
        || total_entries > limits.max_total_entries
        || total_bytes > limits.max_total_bytes
        || retained_layout_memory_bytes > DEFAULT_MAX_RETAINED_LAYOUT_MEMORY_BYTES
    {
        return Err(NativeOperationError::Rejected);
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn run_revalidate_start_operation(
    session: &mut SessionState,
    basket_session_ref: &str,
    controller_request_ref: &str,
    adapter_id: &str,
    adapter_build_sha256: &str,
    expected_source_refs: &[String],
    expected_output_ref: &str,
    token: &CancellationToken,
) -> Result<RevalidationOperationOutcome, NativeOperationError> {
    validate_adapter_binding(session, basket_session_ref, controller_request_ref, true)?;
    if !is_valid_adapter_id(adapter_id)
        || !is_canonical_sha256(adapter_build_sha256)
        || !is_valid_output_ref(expected_output_ref)
        || expected_source_refs.is_empty()
        || expected_source_refs.len() > 128
        || expected_source_refs
            .iter()
            .any(|reference| !is_valid_source_ref(reference))
    {
        return Err(NativeOperationError::Binding(
            ProtocolErrorCode::InvalidMessage,
        ));
    }
    if session.active_scope.is_some() {
        return Err(NativeOperationError::Binding(
            ProtocolErrorCode::OperationOrderRejected,
        ));
    }
    if expected_source_refs.len() != session.sources.len()
        || !expected_source_refs
            .iter()
            .zip(&session.sources)
            .all(|(expected, retained)| expected == retained.source_ref.expose())
    {
        return Err(NativeOperationError::Rejected);
    }
    let output = session
        .output
        .as_ref()
        .ok_or(NativeOperationError::Rejected)?;
    if output.output_ref.expose() != expected_output_ref {
        return Err(NativeOperationError::Rejected);
    }
    check_native_cancelled(token)?;
    let comparisons = build_disjoint_comparisons(&session.sources, output)?;

    let mut used_refs = collect_opaque_references(session);
    let scope_ref = generate_opaque_reference("helper_scope_", &used_refs)?;
    used_refs.insert(scope_ref.clone());
    let source_identities = session
        .sources
        .iter()
        .flat_map(|source| source.retained.inventory().entries().map(|entry| entry.0))
        .collect::<BTreeSet<_>>();
    let mut source_files = Vec::with_capacity(source_identities.len());
    let mut source_file_map = BTreeMap::new();
    for identity in source_identities {
        let source_file_ref = generate_opaque_reference("helper_source_file_", &used_refs)?;
        used_refs.insert(source_file_ref.clone());
        source_files.push(SourceFileReferenceWire {
            source_file_ref: source_file_ref.clone(),
            identity: identity.into(),
        });
        source_file_map.insert(PrivateAscii::new(&source_file_ref), identity);
    }

    let retained_sources = session
        .sources
        .iter()
        .map(|source| Rc::clone(&source.retained))
        .collect::<Vec<_>>();
    let custody = CombinedCustodyScope::acquire(
        &retained_sources,
        &output.retained,
        CombinedCustodyLimits::default(),
        || token.is_cancelled(),
    )
    .map_err(|_| NativeOperationError::Rejected)?;
    check_native_cancelled(token)?;

    let evidence = RevalidatedEvidenceWire {
        adapter_id: adapter_id.to_owned(),
        adapter_build_sha256: adapter_build_sha256.to_owned(),
        identity_comparison_mechanism: "windows_volume_serial_plus_file_id_128",
        path_comparison_mechanism: "windows_compare_string_ordinal_ignore_case",
        output: output_boundary_wire(output),
        selections: session.sources.iter().map(source_selection_wire).collect(),
        native_path_comparisons: comparisons,
    };
    session.active_scope = Some(ActiveScope {
        scope_ref: PrivateAscii::new(&scope_ref),
        basket_session_ref: PrivateAscii::new(basket_session_ref),
        controller_request_ref: PrivateAscii::new(controller_request_ref),
        custody,
        source_files: source_file_map,
        run_ref: None,
        output_files: BTreeMap::new(),
    });
    Ok(RevalidationOperationOutcome {
        scope_ref,
        evidence,
        source_files,
    })
}

fn run_release_scope_operation(
    session: &mut SessionState,
    basket_session_ref: &str,
    controller_request_ref: &str,
    scope_ref: &str,
    _token: &CancellationToken,
) -> Result<(), NativeOperationError> {
    if !is_valid_basket_session_ref(basket_session_ref)
        || !is_valid_revalidated_request_ref(controller_request_ref)
        || !is_valid_scope_ref(scope_ref)
    {
        return Err(NativeOperationError::Binding(
            ProtocolErrorCode::InvalidMessage,
        ));
    }
    let active = session
        .active_scope
        .as_ref()
        .ok_or(NativeOperationError::Rejected)?;
    if active.scope_ref.expose() != scope_ref
        || active.basket_session_ref.expose() != basket_session_ref
        || active.controller_request_ref.expose() != controller_request_ref
    {
        return Err(NativeOperationError::Rejected);
    }
    let active = session
        .active_scope
        .take()
        .ok_or(NativeOperationError::Internal)?;
    let _release_evidence = active.custody.release();
    session.sources.clear();
    session.output = None;
    Ok(())
}

fn run_create_run_operation(
    session: &mut SessionState,
    scope_ref: &str,
    token: &CancellationToken,
) -> Result<(String, FileIdentity), NativeOperationError> {
    if !is_valid_scope_ref(scope_ref) {
        return Err(NativeOperationError::Binding(
            ProtocolErrorCode::InvalidMessage,
        ));
    }
    let used_refs = collect_opaque_references(session);
    let run_ref = generate_opaque_reference("helper_run_", &used_refs)?;
    let active = session
        .active_scope
        .as_mut()
        .ok_or(NativeOperationError::Rejected)?;
    if active.scope_ref.expose() != scope_ref || active.run_ref.is_some() {
        return Err(NativeOperationError::Rejected);
    }
    let identity = active
        .custody
        .create_run_directory(|| token.is_cancelled())
        .map_err(|_| NativeOperationError::Rejected)?;
    active.run_ref = Some(PrivateAscii::new(&run_ref));
    Ok((run_ref, identity))
}

fn run_create_output_file_operation(
    session: &mut SessionState,
    scope_ref: &str,
    run_ref: &str,
    component: &str,
    token: &CancellationToken,
) -> Result<(String, FileIdentity), NativeOperationError> {
    if !is_valid_scope_ref(scope_ref)
        || !is_valid_run_ref(run_ref)
        || component.is_empty()
        || component.encode_utf16().count() > MAX_OUTPUT_COMPONENT_UTF16_UNITS
    {
        return Err(NativeOperationError::Binding(
            ProtocolErrorCode::InvalidMessage,
        ));
    }
    let used_refs = collect_opaque_references(session);
    let output_file_ref = generate_opaque_reference("helper_output_file_", &used_refs)?;
    let active = session
        .active_scope
        .as_mut()
        .ok_or(NativeOperationError::Rejected)?;
    if active.scope_ref.expose() != scope_ref
        || active.run_ref.as_ref().map(PrivateAscii::expose) != Some(run_ref)
    {
        return Err(NativeOperationError::Rejected);
    }
    let identity = active
        .custody
        .create_output_file(component, || token.is_cancelled())
        .map_err(|_| NativeOperationError::Rejected)?;
    active
        .output_files
        .insert(PrivateAscii::new(&output_file_ref), identity);
    Ok((output_file_ref, identity))
}

fn source_selection_wire(source: &SelectedSource) -> SourceSelectionWire {
    let inventory = source.retained.inventory();
    let canonical_path = source.retained.canonical_path().to_owned();
    SourceSelectionWire {
        source_ref: source.source_ref.expose().to_owned(),
        evidence: SourceEvidenceWire {
            kind: match source.retained.kind() {
                SourceKind::File => "file",
                SourceKind::Folder => "directory",
            },
            canonical_absolute_path: canonical_path.clone(),
            resolved_absolute_path: canonical_path,
            byte_count_decimal: inventory.total_bytes().to_string(),
            file_count: inventory.file_count(),
            identity: inventory.root_identity().into(),
            inventory_file_identities: inventory
                .entries()
                .map(|(identity, _)| identity.into())
                .collect(),
            path_evidence: source.acquisition.path_evidence(),
            local_volume_evidence: source.retained.local_volume_evidence().into(),
        },
    }
}

fn output_boundary_wire(output: &SelectedOutput) -> OutputBoundaryWire {
    let canonical_path = output.canonical_path.expose().to_owned();
    OutputBoundaryWire {
        output_ref: output.output_ref.expose().to_owned(),
        boundary: OutputBoundaryEvidenceWire {
            kind: "directory",
            canonical_absolute_path: canonical_path.clone(),
            resolved_absolute_path: canonical_path,
            identity: output.retained.identity().into(),
            path_evidence: OUTPUT_PATH_EVIDENCE,
            local_volume_evidence: output.retained.local_volume_evidence().into(),
        },
    }
}

fn build_disjoint_comparisons(
    sources: &[SelectedSource],
    output: &SelectedOutput,
) -> Result<NativePathComparisonsWire, NativeOperationError> {
    let mut source_pairs = Vec::with_capacity(sources.len().saturating_sub(1) * sources.len() / 2);
    for left in 0..sources.len() {
        for right in (left + 1)..sources.len() {
            let relation = compare_canonical_dos_paths(
                sources[left].retained.canonical_path(),
                sources[right].retained.canonical_path(),
            )
            .map_err(|_| NativeOperationError::Rejected)?;
            if relation != PathRelation::Disjoint {
                return Err(NativeOperationError::Rejected);
            }
            source_pairs.push(SourcePairWire {
                left_selection_index: left + 1,
                right_selection_index: right + 1,
                relation: "disjoint",
            });
        }
    }
    let mut output_pairs = Vec::with_capacity(sources.len());
    for (index, source) in sources.iter().enumerate() {
        let relation = compare_canonical_dos_paths(
            source.retained.canonical_path(),
            output.canonical_path.expose(),
        )
        .map_err(|_| NativeOperationError::Rejected)?;
        if relation != PathRelation::Disjoint {
            return Err(NativeOperationError::Rejected);
        }
        output_pairs.push(OutputPairWire {
            selection_index: index + 1,
            relation: "disjoint",
        });
    }
    Ok(NativePathComparisonsWire {
        source_pairs,
        output_pairs,
    })
}

fn validate_adapter_binding(
    session: &mut SessionState,
    basket_session_ref: &str,
    controller_request_ref: &str,
    revalidation: bool,
) -> Result<(), NativeOperationError> {
    if !is_valid_basket_session_ref(basket_session_ref)
        || if revalidation {
            !is_valid_revalidated_request_ref(controller_request_ref)
        } else {
            !is_valid_native_request_ref(controller_request_ref)
        }
    {
        return Err(NativeOperationError::Binding(
            ProtocolErrorCode::InvalidMessage,
        ));
    }
    match &session.basket_session_ref {
        Some(bound) if bound.expose() != basket_session_ref => Err(NativeOperationError::Binding(
            ProtocolErrorCode::SessionMismatch,
        )),
        Some(_) => Ok(()),
        None => {
            session.basket_session_ref = Some(PrivateAscii::new(basket_session_ref));
            Ok(())
        }
    }
}

fn all_source_identities(sources: &[SelectedSource]) -> BTreeSet<FileIdentity> {
    let mut identities = BTreeSet::new();
    for source in sources {
        identities.insert(source.retained.inventory().root_identity());
        identities.extend(source.retained.inventory().identities());
    }
    identities
}

fn collect_opaque_references(session: &SessionState) -> BTreeSet<String> {
    let mut references = BTreeSet::new();
    for source in &session.sources {
        references.insert(source.source_ref.expose().to_owned());
    }
    if let Some(output) = &session.output {
        references.insert(output.output_ref.expose().to_owned());
    }
    if let Some(active) = &session.active_scope {
        references.insert(active.scope_ref.expose().to_owned());
        references.extend(
            active
                .source_files
                .keys()
                .map(|reference| reference.expose().to_owned()),
        );
        if let Some(run_ref) = &active.run_ref {
            references.insert(run_ref.expose().to_owned());
        }
        references.extend(
            active
                .output_files
                .keys()
                .map(|reference| reference.expose().to_owned()),
        );
    }
    references
}

fn generate_opaque_reference(
    prefix: &str,
    used: &BTreeSet<String>,
) -> Result<String, NativeOperationError> {
    generate_opaque_reference_with(prefix, used, |random| {
        // SAFETY: `random` is initialized writable memory and a null algorithm
        // handle is required with `BCRYPT_USE_SYSTEM_PREFERRED_RNG`.
        let status = unsafe { BCryptGenRandom(None, random, BCRYPT_USE_SYSTEM_PREFERRED_RNG) };
        if status.0 < 0 {
            Err(NativeOperationError::Internal)
        } else {
            Ok(())
        }
    })
}

fn generate_opaque_reference_with(
    prefix: &str,
    used: &BTreeSet<String>,
    mut fill_random: impl FnMut(
        &mut [u8; OPAQUE_REFERENCE_RANDOM_BYTES],
    ) -> Result<(), NativeOperationError>,
) -> Result<String, NativeOperationError> {
    for _ in 0..8 {
        let mut random = [0u8; OPAQUE_REFERENCE_RANDOM_BYTES];
        fill_random(&mut random)?;
        if random.iter().all(|byte| *byte == 0) {
            continue;
        }
        let reference = format!("{prefix}{}", hex::encode(random));
        if !used.contains(&reference) {
            return Ok(reference);
        }
    }
    Err(NativeOperationError::Internal)
}

fn checked_add_retained_layout_memory(
    retained_bytes: u64,
    source_bytes: u64,
) -> Result<u64, NativeOperationError> {
    let retained_bytes = retained_bytes
        .checked_add(source_bytes)
        .ok_or(NativeOperationError::Rejected)?;
    if retained_bytes > DEFAULT_MAX_RETAINED_LAYOUT_MEMORY_BYTES {
        return Err(NativeOperationError::Rejected);
    }
    Ok(retained_bytes)
}

fn check_native_cancelled(token: &CancellationToken) -> Result<(), NativeOperationError> {
    if token.is_cancelled() {
        Err(NativeOperationError::Cancelled)
    } else {
        Ok(())
    }
}

#[derive(Debug)]
enum StrictJson {
    Null,
    Bool(bool),
    Signed(i64),
    Unsigned(u64),
    String(String),
    Array(Vec<Self>),
    Object(BTreeMap<String, Self>),
}

impl StrictJson {
    fn is_within_depth_limit(&self, depth: usize) -> bool {
        if depth > MAX_JSON_DEPTH {
            return false;
        }
        match self {
            Self::Array(values) => values
                .iter()
                .all(|value| value.is_within_depth_limit(depth + 1)),
            Self::Object(values) => values.iter().all(|(key, value)| {
                key.encode_utf16().count() <= MAX_PROTOCOL_STRING_UTF16_UNITS
                    && value.is_within_depth_limit(depth + 1)
            }),
            Self::Null | Self::Bool(_) | Self::Signed(_) | Self::Unsigned(_) | Self::String(_) => {
                true
            }
        }
    }
}

impl<'de> Deserialize<'de> for StrictJson {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_any(StrictJsonVisitor)
    }
}

struct StrictJsonVisitor;

impl<'de> Visitor<'de> for StrictJsonVisitor {
    type Value = StrictJson;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("strict JSON with unique object names and integer numbers")
    }

    fn visit_unit<E>(self) -> Result<Self::Value, E> {
        Ok(StrictJson::Null)
    }

    fn visit_bool<E>(self, value: bool) -> Result<Self::Value, E> {
        Ok(StrictJson::Bool(value))
    }

    fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E> {
        Ok(StrictJson::Signed(value))
    }

    fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E> {
        Ok(StrictJson::Unsigned(value))
    }

    fn visit_f64<E>(self, _value: f64) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        Err(E::custom("non-integer JSON numbers are not accepted"))
    }

    fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        if value.encode_utf16().count() > MAX_PROTOCOL_STRING_UTF16_UNITS {
            return Err(E::custom("JSON string exceeds the fixed UTF-16 limit"));
        }
        Ok(StrictJson::String(value.to_owned()))
    }

    fn visit_string<E>(self, value: String) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        if value.encode_utf16().count() > MAX_PROTOCOL_STRING_UTF16_UNITS {
            return Err(E::custom("JSON string exceeds the fixed UTF-16 limit"));
        }
        Ok(StrictJson::String(value))
    }

    fn visit_none<E>(self) -> Result<Self::Value, E> {
        Ok(StrictJson::Null)
    }

    fn visit_some<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: Deserializer<'de>,
    {
        StrictJson::deserialize(deserializer)
    }

    fn visit_seq<A>(self, mut sequence: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        let mut values = Vec::new();
        while let Some(value) = sequence.next_element::<StrictJson>()? {
            values.push(value);
        }
        Ok(StrictJson::Array(values))
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut values = BTreeMap::new();
        while let Some(key) = map.next_key::<String>()? {
            if values.contains_key(&key) {
                return Err(de::Error::custom("duplicate JSON object name"));
            }
            let value = map.next_value::<StrictJson>()?;
            values.insert(key, value);
        }
        Ok(StrictJson::Object(values))
    }
}

impl From<StrictJson> for serde_json::Value {
    fn from(value: StrictJson) -> Self {
        match value {
            StrictJson::Null => Self::Null,
            StrictJson::Bool(value) => Self::Bool(value),
            StrictJson::Signed(value) => Self::Number(value.into()),
            StrictJson::Unsigned(value) => Self::Number(value.into()),
            StrictJson::String(value) => Self::String(value),
            StrictJson::Array(values) => Self::Array(values.into_iter().map(Self::from).collect()),
            StrictJson::Object(values) => Self::Object(
                values
                    .into_iter()
                    .map(|(key, value)| (key, Self::from(value)))
                    .collect(),
            ),
        }
    }
}

#[derive(Clone, Debug)]
struct ControlRequestBinding {
    schema_version: u32,
    session_ref: String,
    request_ref: String,
    control_sequence: u64,
}

fn track_request_reference(
    session: &mut SessionState,
    request_ref: &str,
) -> Result<(), ProtocolErrorCode> {
    if session.seen_request_refs.len() >= MAX_TRACKED_REQUEST_REFERENCES {
        return Err(ProtocolErrorCode::InternalFailure);
    }
    session
        .seen_request_refs
        .insert(PrivateAscii::new(request_ref));
    Ok(())
}

fn is_valid_session_ref(value: &str) -> bool {
    has_fixed_lower_hex_suffix(value, "helper_session_")
}

fn is_valid_request_ref(value: &str) -> bool {
    has_fixed_lower_hex_suffix(value, "helper_request_")
}

fn is_valid_basket_session_ref(value: &str) -> bool {
    has_fixed_lower_hex_suffix(value, "basket_")
}

fn is_valid_native_request_ref(value: &str) -> bool {
    has_fixed_lower_hex_suffix(value, "native_request_")
}

fn is_valid_revalidated_request_ref(value: &str) -> bool {
    has_fixed_lower_hex_suffix(value, "revalidated_start_")
}

fn is_valid_source_ref(value: &str) -> bool {
    has_fixed_lower_hex_suffix(value, "helper_source_")
}

fn is_valid_output_ref(value: &str) -> bool {
    has_fixed_lower_hex_suffix(value, "helper_output_")
}

fn is_valid_scope_ref(value: &str) -> bool {
    has_fixed_lower_hex_suffix(value, "helper_scope_")
}

fn is_valid_run_ref(value: &str) -> bool {
    has_fixed_lower_hex_suffix(value, "helper_run_")
}

fn is_valid_adapter_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    (3..=MAX_ADAPTER_ID_BYTES).contains(&bytes.len())
        && bytes[0].is_ascii_lowercase_or_digit()
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_lowercase_or_digit() || matches!(byte, b'.' | b'_' | b'-'))
}

trait AsciiLowercaseOrDigit {
    fn is_ascii_lowercase_or_digit(&self) -> bool;
}

impl AsciiLowercaseOrDigit for u8 {
    fn is_ascii_lowercase_or_digit(&self) -> bool {
        self.is_ascii_digit() || self.is_ascii_lowercase()
    }
}

fn has_fixed_lower_hex_suffix(value: &str, prefix: &str) -> bool {
    value
        .strip_prefix(prefix)
        .is_some_and(|suffix| is_lower_hex(suffix, 32) && suffix.bytes().any(|byte| byte != b'0'))
}

fn is_canonical_sha256(value: &str) -> bool {
    value
        .strip_prefix(SHA256_PREFIX)
        .is_some_and(|hex| is_lower_hex(hex, SHA256_HEX_LENGTH))
}

fn is_lower_hex(value: &str, exact_length: usize) -> bool {
    value.len() == exact_length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
}

pub fn derive_challenge_response(
    challenge: &str,
    expected_helper_sha256: &str,
) -> Result<String, ChallengeResponseError> {
    if !is_lower_hex(challenge, CHALLENGE_HEX_LENGTH) {
        return Err(ChallengeResponseError::InvalidChallenge);
    }
    if !is_canonical_sha256(expected_helper_sha256) {
        return Err(ChallengeResponseError::InvalidDigest);
    }
    let mut challenge_bytes = [0_u8; 32];
    hex::decode_to_slice(challenge, &mut challenge_bytes)
        .map_err(|_| ChallengeResponseError::InvalidChallenge)?;

    let mut hasher = Sha256::new();
    hasher.update(HANDSHAKE_DOMAIN.as_bytes());
    hasher.update([0]);
    hasher.update(challenge_bytes);
    hasher.update([0]);
    hasher.update(expected_helper_sha256.as_bytes());
    hasher.update([0]);
    hasher.update(BUILD_IDENTIFIER.as_bytes());
    Ok(format!("{SHA256_PREFIX}{}", hex::encode(hasher.finalize())))
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ChallengeResponseError {
    InvalidChallenge,
    InvalidDigest,
}

impl fmt::Display for ChallengeResponseError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::InvalidChallenge => "challenge is not canonical 32-byte lowercase hexadecimal",
            Self::InvalidDigest => "helper digest is not canonical SHA-256 text",
        })
    }
}

impl std::error::Error for ChallengeResponseError {}

pub fn sha256_reader(mut reader: impl Read) -> io::Result<String> {
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{SHA256_PREFIX}{}", hex::encode(hasher.finalize())))
}

pub fn encode_response_line(response: &ProtocolResponse) -> Result<Vec<u8>, ProtocolErrorCode> {
    let mut encoded =
        serde_json::to_vec(response).map_err(|_| ProtocolErrorCode::InternalFailure)?;
    if encoded.len() > MAX_HELPER_RESPONSE_BYTES {
        return Err(ProtocolErrorCode::InternalFailure);
    }
    encoded.push(b'\n');
    Ok(encoded)
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum FrameRead {
    Frame(Vec<u8>),
    EndOfStream,
    MessageTooLarge,
    Unterminated,
}

pub fn read_bounded_frame(reader: &mut impl BufRead, byte_cap: usize) -> io::Result<FrameRead> {
    let mut frame = Vec::with_capacity(byte_cap.min(8 * 1024));
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return Ok(if frame.is_empty() {
                FrameRead::EndOfStream
            } else {
                FrameRead::Unterminated
            });
        }
        if let Some(newline_index) = available.iter().position(|byte| *byte == b'\n') {
            if frame.len().saturating_add(newline_index) > byte_cap {
                reader.consume(newline_index + 1);
                return Ok(FrameRead::MessageTooLarge);
            }
            frame.extend_from_slice(&available[..newline_index]);
            reader.consume(newline_index + 1);
            if frame.last() == Some(&b'\r') {
                frame.pop();
            }
            return Ok(FrameRead::Frame(frame));
        }

        let available_length = available.len();
        if frame.len().saturating_add(available_length) > byte_cap {
            reader.consume(available_length);
            drain_through_newline(reader)?;
            return Ok(FrameRead::MessageTooLarge);
        }
        frame.extend_from_slice(available);
        reader.consume(available_length);
    }
}

fn drain_through_newline(reader: &mut impl BufRead) -> io::Result<()> {
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return Ok(());
        }
        let newline_index = available.iter().position(|byte| *byte == b'\n');
        let consumed = newline_index.map_or(available.len(), |index| index + 1);
        let found_newline = newline_index.is_some();
        reader.consume(consumed);
        if found_newline {
            return Ok(());
        }
    }
}

#[cfg(test)]
mod opaque_reference_tests {
    use std::collections::BTreeSet;

    use super::*;

    #[test]
    fn every_control_reference_prefix_rejects_an_all_zero_suffix() {
        for prefix in [
            "helper_session_",
            "helper_request_",
            "basket_",
            "native_request_",
            "revalidated_start_",
            "helper_source_",
            "helper_output_",
            "helper_scope_",
            "helper_source_file_",
            "helper_run_",
            "helper_output_file_",
        ] {
            assert!(!has_fixed_lower_hex_suffix(
                &format!("{prefix}00000000000000000000000000000000"),
                prefix
            ));
            assert!(has_fixed_lower_hex_suffix(
                &format!("{prefix}00000000000000000000000000000001"),
                prefix
            ));
        }
    }

    #[test]
    fn generator_retries_zero_and_colliding_random_values() {
        let collision = format!("helper_source_{}", "01".repeat(16));
        let used = BTreeSet::from([collision]);
        let mut calls = 0;
        let generated = generate_opaque_reference_with("helper_source_", &used, |random| {
            calls += 1;
            random.fill(match calls {
                1 => 0,
                2 => 1,
                _ => 2,
            });
            Ok(())
        })
        .expect("third bounded attempt should be nonzero and unique");

        assert_eq!(calls, 3);
        assert_eq!(generated, format!("helper_source_{}", "02".repeat(16)));
    }

    #[test]
    fn generator_fails_closed_after_eight_zero_values() {
        let mut calls = 0;
        let result = generate_opaque_reference_with("helper_source_", &BTreeSet::new(), |random| {
            calls += 1;
            random.fill(0);
            Ok(())
        });

        assert_eq!(calls, 8);
        assert_eq!(result, Err(NativeOperationError::Internal));
    }
}

#[cfg(test)]
mod retained_layout_memory_tests {
    use super::*;

    #[test]
    fn session_layout_aggregation_is_exact_bounded_and_overflow_checked() {
        let half = DEFAULT_MAX_RETAINED_LAYOUT_MEMORY_BYTES / 2;
        assert_eq!(
            [half, half]
                .into_iter()
                .try_fold(0u64, checked_add_retained_layout_memory),
            Ok(DEFAULT_MAX_RETAINED_LAYOUT_MEMORY_BYTES)
        );
        assert_eq!(
            checked_add_retained_layout_memory(DEFAULT_MAX_RETAINED_LAYOUT_MEMORY_BYTES, 1),
            Err(NativeOperationError::Rejected)
        );
        assert_eq!(
            checked_add_retained_layout_memory(u64::MAX, 1),
            Err(NativeOperationError::Rejected)
        );
    }
}

#[cfg(test)]
mod candidate_source_tests {
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;
    use crate::path::CanonicalDosPath;

    struct Fixture {
        root: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock should be after the Unix epoch")
                .as_nanos();
            let root = std::env::temp_dir().join(format!(
                "venviewer-native-folder-candidate-{}-{nonce}",
                std::process::id()
            ));
            fs::create_dir(&root).expect("fixture directory should be created");
            Self { root }
        }

        fn canonical(&self, path: &Path) -> CanonicalDosPath {
            let absolute = fs::canonicalize(path).expect("fixture path should canonicalize");
            let text = absolute
                .to_str()
                .expect("fixture path should be Unicode")
                .strip_prefix(r"\\?\")
                .unwrap_or_else(|| absolute.to_str().expect("fixture path should be Unicode"));
            let mut canonical = text.to_owned();
            canonical.replace_range(..1, &canonical[..1].to_ascii_uppercase());
            CanonicalDosPath::parse(&canonical).expect("fixture path should be canonical DOS form")
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn folder_root_identity_is_not_treated_as_a_duplicate_candidate() {
        let fixture = Fixture::new();
        let folder = fixture.root.join("folder-source");
        let nested = folder.join("photos");
        fs::create_dir_all(&nested).expect("nested fixture directory should be created");
        fs::write(nested.join("frame-0001.txt"), b"frame")
            .expect("nested fixture file should be written");

        let retained = Rc::new(
            RetainedSource::open(
                &fixture.canonical(&folder),
                CombinedCustodyLimits::default().per_source,
                || false,
            )
            .expect("folder fixture should acquire native custody"),
        );
        assert_eq!(retained.kind(), SourceKind::Folder);
        assert_eq!(retained.inventory().file_count(), 1);
        assert_eq!(retained.inventory().directory_count(), 2);

        let session = SessionState::new("helper_session_00000000000000000000000000000001");
        assert_eq!(
            validate_candidate_sources(&session, &[Rc::clone(&retained)]),
            Ok(())
        );
        assert_eq!(
            validate_candidate_sources(&session, &[Rc::clone(&retained), retained]),
            Err(NativeOperationError::Rejected),
            "the root exception must not permit duplicate sources"
        );
    }

    #[test]
    fn mixed_file_and_folder_drop_commits_once_with_truthful_acquisition() {
        let fixture = Fixture::new();
        let standalone = fixture.root.join("standalone-source.e57");
        fs::write(&standalone, b"standalone").expect("standalone file should be written");
        let folder = fixture.root.join("folder-source");
        fs::create_dir(&folder).expect("folder source should be created");
        fs::write(folder.join("nested.txt"), b"nested").expect("nested file should be written");

        let file_locator = fixture
            .canonical(&standalone)
            .as_str()
            .encode_utf16()
            .collect::<Vec<_>>();
        let folder_locator = fixture
            .canonical(&folder)
            .as_str()
            .encode_utf16()
            .collect::<Vec<_>>();
        let locators = [file_locator.as_slice(), folder_locator.as_slice()];
        let token = CancellationToken {
            cancelled: Arc::new(AtomicBool::new(false)),
        };
        let mut session = SessionState::new("helper_session_00000000000000000000000000000001");

        let selections = retain_source_locators(
            &mut session,
            &locators,
            None,
            SourceAcquisition::Drop,
            &token,
        )
        .expect("one mixed drop should acquire every source atomically");

        assert_eq!(session.sources.len(), 2);
        assert_eq!(selections.len(), 2);
        assert_eq!(selections[0].evidence.kind, "file");
        assert_eq!(selections[1].evidence.kind, "directory");
        assert!(selections.iter().all(|selection| {
            selection.evidence.path_evidence.acquisition
                == "windows_native_drop_cfhdrop_then_handle_open"
        }));
        assert!(session.sources.iter().all(|source| {
            source_selection_wire(source)
                .evidence
                .path_evidence
                .acquisition
                == "windows_native_drop_cfhdrop_then_handle_open"
        }));
    }

    #[test]
    fn duplicate_in_mixed_drop_rejects_the_entire_batch_without_session_mutation() {
        let fixture = Fixture::new();
        let standalone = fixture.root.join("duplicate-source.e57");
        fs::write(&standalone, b"duplicate").expect("standalone file should be written");
        let locator = fixture
            .canonical(&standalone)
            .as_str()
            .encode_utf16()
            .collect::<Vec<_>>();
        let locators = [locator.as_slice(), locator.as_slice()];
        let token = CancellationToken {
            cancelled: Arc::new(AtomicBool::new(false)),
        };
        let mut session = SessionState::new("helper_session_00000000000000000000000000000001");

        assert_eq!(
            retain_source_locators(
                &mut session,
                &locators,
                None,
                SourceAcquisition::Drop,
                &token,
            ),
            Err(NativeOperationError::Rejected)
        );
        assert!(session.sources.is_empty());
    }
}
