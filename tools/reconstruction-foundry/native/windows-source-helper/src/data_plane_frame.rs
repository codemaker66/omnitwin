//! Process-private codec for bounded source, output, and catalog byte frames.
//!
//! This module deliberately has no pipe or process-lifecycle behavior. It only
//! converts complete in-memory frames, or a fixed header plus borrowed/owned
//! payload parts, to and from the fixed VNSDP01 wire form.

use std::collections::HashSet;
use std::error::Error;
use std::fmt::{self, Display, Formatter};

use sha2::{Digest, Sha256};

pub const DATA_PLANE_FRAME_HEADER_BYTES: usize = 160;
pub const DATA_PLANE_FRAME_MAX_PAYLOAD_BYTES: usize = 1_048_576;
pub const DATA_PLANE_TRANSFER_MAX_OBJECTS: usize = 100_000;

const MAGIC: &[u8; 8] = b"VNSDP01\0";
const VERSION: u16 = 1;
const FLAG_TERMINAL: u8 = 0b0000_0001;
const KIND_SOURCE: u8 = 1;
const KIND_OUTPUT: u8 = 2;
const KIND_CATALOG: u8 = 3;
const REF_SUFFIX_BYTES: usize = 16;

const VERSION_OFFSET: usize = 8;
const HEADER_SIZE_OFFSET: usize = 10;
const KIND_OFFSET: usize = 12;
const FLAGS_OFFSET: usize = 13;
const RESERVED_U16_OFFSET: usize = 14;
const WORK_SEQUENCE_OFFSET: usize = 16;
const PAYLOAD_LENGTH_OFFSET: usize = 24;
const CHUNK_SEQUENCE_OFFSET: usize = 28;
const SESSION_REF_OFFSET: usize = 32;
const REQUEST_REF_OFFSET: usize = 48;
const SCOPE_REF_OFFSET: usize = 64;
const CONTAINER_REF_OFFSET: usize = 80;
const OBJECT_REF_OFFSET: usize = 96;
const TRANSFER_REF_OFFSET: usize = 112;
const PAYLOAD_SHA256_OFFSET: usize = 128;

const SESSION_REF_PREFIX: &str = "helper_session_";
const REQUEST_REF_PREFIX: &str = "helper_request_";
const SCOPE_REF_PREFIX: &str = "helper_scope_";
const SOURCE_REF_PREFIX: &str = "helper_source_";
const SOURCE_FILE_REF_PREFIX: &str = "helper_source_file_";
const RUN_REF_PREFIX: &str = "helper_run_";
const OUTPUT_FILE_REF_PREFIX: &str = "helper_output_file_";
const CATALOG_REF_PREFIX: &str = "helper_catalog_";
// Codec-private until a later control-plane request binds transfer references.
const TRANSFER_REF_PREFIX: &str = "helper_transfer_";

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum DataPlaneFrameKind {
    Source,
    Output,
    Catalog,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum DataPlaneFrameDirection {
    NodeToHelper,
    HelperToNode,
}

impl DataPlaneFrameKind {
    fn wire_value(self) -> u8 {
        match self {
            Self::Source => KIND_SOURCE,
            Self::Output => KIND_OUTPUT,
            Self::Catalog => KIND_CATALOG,
        }
    }

    fn from_wire(value: u8) -> Result<Self, DataPlaneFrameError> {
        match value {
            KIND_SOURCE => Ok(Self::Source),
            KIND_OUTPUT => Ok(Self::Output),
            KIND_CATALOG => Ok(Self::Catalog),
            _ => Err(DataPlaneFrameError::InvalidKind),
        }
    }

    pub const fn direction(self) -> DataPlaneFrameDirection {
        match self {
            Self::Source | Self::Catalog => DataPlaneFrameDirection::HelperToNode,
            Self::Output => DataPlaneFrameDirection::NodeToHelper,
        }
    }
}

#[derive(Clone, Eq, PartialEq)]
pub enum DataPlaneFrameReferences {
    Source {
        session_ref: String,
        request_ref: String,
        scope_ref: String,
        source_ref: String,
        source_file_ref: String,
        transfer_ref: String,
    },
    Output {
        session_ref: String,
        request_ref: String,
        scope_ref: String,
        run_ref: String,
        output_file_ref: String,
        transfer_ref: String,
    },
    Catalog {
        session_ref: String,
        request_ref: String,
        scope_ref: String,
        source_ref: String,
        catalog_ref: String,
        transfer_ref: String,
    },
}

impl fmt::Debug for DataPlaneFrameReferences {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DataPlaneFrameReferences")
            .field("kind", &self.kind())
            .finish_non_exhaustive()
    }
}

impl DataPlaneFrameReferences {
    pub fn kind(&self) -> DataPlaneFrameKind {
        match self {
            Self::Source { .. } => DataPlaneFrameKind::Source,
            Self::Output { .. } => DataPlaneFrameKind::Output,
            Self::Catalog { .. } => DataPlaneFrameKind::Catalog,
        }
    }

    fn wire_references(&self) -> [(&str, &str); 6] {
        match self {
            Self::Source {
                session_ref,
                request_ref,
                scope_ref,
                source_ref,
                source_file_ref,
                transfer_ref,
            } => [
                (session_ref, SESSION_REF_PREFIX),
                (request_ref, REQUEST_REF_PREFIX),
                (scope_ref, SCOPE_REF_PREFIX),
                (source_ref, SOURCE_REF_PREFIX),
                (source_file_ref, SOURCE_FILE_REF_PREFIX),
                (transfer_ref, TRANSFER_REF_PREFIX),
            ],
            Self::Output {
                session_ref,
                request_ref,
                scope_ref,
                run_ref,
                output_file_ref,
                transfer_ref,
            } => [
                (session_ref, SESSION_REF_PREFIX),
                (request_ref, REQUEST_REF_PREFIX),
                (scope_ref, SCOPE_REF_PREFIX),
                (run_ref, RUN_REF_PREFIX),
                (output_file_ref, OUTPUT_FILE_REF_PREFIX),
                (transfer_ref, TRANSFER_REF_PREFIX),
            ],
            Self::Catalog {
                session_ref,
                request_ref,
                scope_ref,
                source_ref,
                catalog_ref,
                transfer_ref,
            } => [
                (session_ref, SESSION_REF_PREFIX),
                (request_ref, REQUEST_REF_PREFIX),
                (scope_ref, SCOPE_REF_PREFIX),
                (source_ref, SOURCE_REF_PREFIX),
                (catalog_ref, CATALOG_REF_PREFIX),
                (transfer_ref, TRANSFER_REF_PREFIX),
            ],
        }
    }

    fn transfer_binding_references(&self) -> (&str, &str, &str, &str) {
        match self {
            Self::Source {
                session_ref,
                request_ref,
                scope_ref,
                transfer_ref,
                ..
            }
            | Self::Output {
                session_ref,
                request_ref,
                scope_ref,
                transfer_ref,
                ..
            }
            | Self::Catalog {
                session_ref,
                request_ref,
                scope_ref,
                transfer_ref,
                ..
            } => (session_ref, request_ref, scope_ref, transfer_ref),
        }
    }

    fn object_references(&self) -> (&str, &str) {
        match self {
            Self::Source {
                source_ref,
                source_file_ref,
                ..
            } => (source_ref, source_file_ref),
            Self::Output {
                run_ref,
                output_file_ref,
                ..
            } => (run_ref, output_file_ref),
            Self::Catalog {
                source_ref,
                catalog_ref,
                ..
            } => (source_ref, catalog_ref),
        }
    }

    fn from_suffixes(
        kind: DataPlaneFrameKind,
        suffixes: [[u8; REF_SUFFIX_BYTES]; 6],
    ) -> Result<Self, DataPlaneFrameError> {
        let [session, request, scope, container, object, transfer] = suffixes;
        let session_ref = reference_from_suffix(SESSION_REF_PREFIX, session)?;
        let request_ref = reference_from_suffix(REQUEST_REF_PREFIX, request)?;
        let scope_ref = reference_from_suffix(SCOPE_REF_PREFIX, scope)?;
        let transfer_ref = reference_from_suffix(TRANSFER_REF_PREFIX, transfer)?;
        match kind {
            DataPlaneFrameKind::Source => Ok(Self::Source {
                session_ref,
                request_ref,
                scope_ref,
                source_ref: reference_from_suffix(SOURCE_REF_PREFIX, container)?,
                source_file_ref: reference_from_suffix(SOURCE_FILE_REF_PREFIX, object)?,
                transfer_ref,
            }),
            DataPlaneFrameKind::Output => Ok(Self::Output {
                session_ref,
                request_ref,
                scope_ref,
                run_ref: reference_from_suffix(RUN_REF_PREFIX, container)?,
                output_file_ref: reference_from_suffix(OUTPUT_FILE_REF_PREFIX, object)?,
                transfer_ref,
            }),
            DataPlaneFrameKind::Catalog => Ok(Self::Catalog {
                session_ref,
                request_ref,
                scope_ref,
                source_ref: reference_from_suffix(SOURCE_REF_PREFIX, container)?,
                catalog_ref: reference_from_suffix(CATALOG_REF_PREFIX, object)?,
                transfer_ref,
            }),
        }
    }
}

#[derive(Clone, Eq, PartialEq)]
pub struct DataPlaneFrame {
    pub work_sequence: u64,
    pub chunk_sequence: u32,
    /// Wire flag bit 0: the final chunk for this source, output, or catalog object.
    pub terminal: bool,
    pub references: DataPlaneFrameReferences,
    pub payload: Vec<u8>,
}

/// An encoded header and a borrowed payload.
///
/// Pipe writers use this form so a frame's payload is never copied into a
/// second full-frame buffer merely to write it.
pub struct EncodedDataPlaneFrameParts<'a> {
    pub header: [u8; DATA_PLANE_FRAME_HEADER_BYTES],
    pub payload: &'a [u8],
}

impl fmt::Debug for EncodedDataPlaneFrameParts<'_> {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("EncodedDataPlaneFrameParts")
            .field("header_length", &self.header.len())
            .field("payload_length", &self.payload.len())
            .finish_non_exhaustive()
    }
}

/// A fully preflighted fixed header whose payload has not been read yet.
///
/// Decoding this value checks the 1 MiB bound before a caller allocates a
/// payload buffer. The payload digest is intentionally not exposed.
#[derive(Clone, Eq, PartialEq)]
pub struct DecodedDataPlaneFrameHeader {
    kind: DataPlaneFrameKind,
    work_sequence: u64,
    chunk_sequence: u32,
    terminal: bool,
    references: DataPlaneFrameReferences,
    payload_length: usize,
    payload_sha256: [u8; 32],
}

impl fmt::Debug for DecodedDataPlaneFrameHeader {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DecodedDataPlaneFrameHeader")
            .field("kind", &self.kind)
            .field("work_sequence", &self.work_sequence)
            .field("chunk_sequence", &self.chunk_sequence)
            .field("terminal", &self.terminal)
            .field("payload_length", &self.payload_length)
            .finish_non_exhaustive()
    }
}

impl DecodedDataPlaneFrameHeader {
    pub const fn kind(&self) -> DataPlaneFrameKind {
        self.kind
    }

    pub const fn payload_length(&self) -> usize {
        self.payload_length
    }
}

impl fmt::Debug for DataPlaneFrame {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DataPlaneFrame")
            .field("kind", &self.references.kind())
            .field("work_sequence", &self.work_sequence)
            .field("chunk_sequence", &self.chunk_sequence)
            .field("terminal", &self.terminal)
            .field("payload_length", &self.payload.len())
            .finish_non_exhaustive()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DataPlaneFrameError {
    FrameTooShort,
    FrameTooLarge,
    InvalidMagic,
    InvalidVersion,
    InvalidHeaderSize,
    InvalidKind,
    InvalidFlags,
    NonzeroReserved,
    InvalidWorkSequence,
    InvalidChunkSequence,
    ZeroLengthNonTerminal,
    InvalidEmptyObject,
    InvalidReference,
    LengthMismatch,
    PayloadHashMismatch,
}

impl Display for DataPlaneFrameError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::FrameTooShort => "data-plane frame is shorter than its fixed header",
            Self::FrameTooLarge => "data-plane frame exceeds its payload limit",
            Self::InvalidMagic => "data-plane frame magic is invalid",
            Self::InvalidVersion => "data-plane frame version is invalid",
            Self::InvalidHeaderSize => "data-plane frame header size is invalid",
            Self::InvalidKind => "data-plane frame kind is invalid",
            Self::InvalidFlags => "data-plane frame flags are invalid",
            Self::NonzeroReserved => "data-plane frame reserved bytes are nonzero",
            Self::InvalidWorkSequence => "data-plane frame work sequence is invalid",
            Self::InvalidChunkSequence => "data-plane frame chunk sequence is invalid",
            Self::ZeroLengthNonTerminal => {
                "data-plane frame has a zero-length non-terminal payload"
            }
            Self::InvalidEmptyObject => "data-plane empty object is not its first terminal chunk",
            Self::InvalidReference => "data-plane frame reference is invalid",
            Self::LengthMismatch => "data-plane frame payload length does not match",
            Self::PayloadHashMismatch => "data-plane frame payload hash does not match",
        })
    }
}

impl Error for DataPlaneFrameError {}

struct FixedHeaderFields {
    kind: DataPlaneFrameKind,
    flags: u8,
    work_sequence: u64,
    chunk_sequence: u32,
    payload_length: usize,
}

pub fn encode_data_plane_frame(frame: &DataPlaneFrame) -> Result<Vec<u8>, DataPlaneFrameError> {
    let parts = encode_data_plane_frame_parts(frame)?;
    let mut encoded = Vec::with_capacity(DATA_PLANE_FRAME_HEADER_BYTES + parts.payload.len());
    encoded.extend_from_slice(&parts.header);
    encoded.extend_from_slice(parts.payload);
    Ok(encoded)
}

/// Encodes only the fixed header while borrowing the original payload.
pub fn encode_data_plane_frame_parts(
    frame: &DataPlaneFrame,
) -> Result<EncodedDataPlaneFrameParts<'_>, DataPlaneFrameError> {
    validate_frame_shape(frame)?;

    let mut encoded = [0_u8; DATA_PLANE_FRAME_HEADER_BYTES];
    encoded[..MAGIC.len()].copy_from_slice(MAGIC);
    encoded[VERSION_OFFSET..HEADER_SIZE_OFFSET].copy_from_slice(&VERSION.to_be_bytes());
    encoded[HEADER_SIZE_OFFSET..KIND_OFFSET]
        .copy_from_slice(&(DATA_PLANE_FRAME_HEADER_BYTES as u16).to_be_bytes());
    encoded[KIND_OFFSET] = frame.references.kind().wire_value();
    encoded[FLAGS_OFFSET] = if frame.terminal { FLAG_TERMINAL } else { 0 };
    encoded[WORK_SEQUENCE_OFFSET..PAYLOAD_LENGTH_OFFSET]
        .copy_from_slice(&frame.work_sequence.to_be_bytes());
    encoded[PAYLOAD_LENGTH_OFFSET..CHUNK_SEQUENCE_OFFSET]
        .copy_from_slice(&(frame.payload.len() as u32).to_be_bytes());
    encoded[CHUNK_SEQUENCE_OFFSET..SESSION_REF_OFFSET]
        .copy_from_slice(&frame.chunk_sequence.to_be_bytes());

    let reference_offsets = [
        SESSION_REF_OFFSET,
        REQUEST_REF_OFFSET,
        SCOPE_REF_OFFSET,
        CONTAINER_REF_OFFSET,
        OBJECT_REF_OFFSET,
        TRANSFER_REF_OFFSET,
    ];
    for ((value, prefix), offset) in frame
        .references
        .wire_references()
        .into_iter()
        .zip(reference_offsets)
    {
        let suffix = decode_reference_suffix(value, prefix)?;
        encoded[offset..offset + REF_SUFFIX_BYTES].copy_from_slice(&suffix);
    }

    let digest = Sha256::digest(&frame.payload);
    encoded[PAYLOAD_SHA256_OFFSET..DATA_PLANE_FRAME_HEADER_BYTES].copy_from_slice(&digest);
    Ok(EncodedDataPlaneFrameParts {
        header: encoded,
        payload: &frame.payload,
    })
}

fn validate_frame_shape(frame: &DataPlaneFrame) -> Result<(), DataPlaneFrameError> {
    if frame.payload.len() > DATA_PLANE_FRAME_MAX_PAYLOAD_BYTES {
        return Err(DataPlaneFrameError::FrameTooLarge);
    }
    if frame.work_sequence == 0 {
        return Err(DataPlaneFrameError::InvalidWorkSequence);
    }
    if frame.chunk_sequence == 0 {
        return Err(DataPlaneFrameError::InvalidChunkSequence);
    }
    if frame.payload.is_empty() && !frame.terminal {
        return Err(DataPlaneFrameError::ZeroLengthNonTerminal);
    }
    if frame.payload.is_empty() && frame.chunk_sequence != 1 {
        return Err(DataPlaneFrameError::InvalidEmptyObject);
    }
    for (value, prefix) in frame.references.wire_references() {
        decode_reference_suffix(value, prefix)?;
    }
    Ok(())
}

pub fn decode_data_plane_frame(bytes: &[u8]) -> Result<DataPlaneFrame, DataPlaneFrameError> {
    if bytes.len() < DATA_PLANE_FRAME_HEADER_BYTES {
        return Err(DataPlaneFrameError::FrameTooShort);
    }
    if bytes.len() > DATA_PLANE_FRAME_HEADER_BYTES + DATA_PLANE_FRAME_MAX_PAYLOAD_BYTES {
        return Err(DataPlaneFrameError::FrameTooLarge);
    }
    let header = decode_data_plane_frame_header(&bytes[..DATA_PLANE_FRAME_HEADER_BYTES])?;
    if bytes.len() != DATA_PLANE_FRAME_HEADER_BYTES + header.payload_length() {
        return Err(DataPlaneFrameError::LengthMismatch);
    }

    finish_decoding_data_plane_frame(header, bytes[DATA_PLANE_FRAME_HEADER_BYTES..].to_vec())
}

/// Decodes and validates exactly one fixed header before payload allocation.
pub fn decode_data_plane_frame_header(
    bytes: &[u8],
) -> Result<DecodedDataPlaneFrameHeader, DataPlaneFrameError> {
    if bytes.len() < DATA_PLANE_FRAME_HEADER_BYTES {
        return Err(DataPlaneFrameError::FrameTooShort);
    }
    if bytes.len() != DATA_PLANE_FRAME_HEADER_BYTES {
        return Err(DataPlaneFrameError::LengthMismatch);
    }

    let fixed = decode_fixed_header(bytes)?;

    let suffixes = [
        read_ref_suffix(bytes, SESSION_REF_OFFSET),
        read_ref_suffix(bytes, REQUEST_REF_OFFSET),
        read_ref_suffix(bytes, SCOPE_REF_OFFSET),
        read_ref_suffix(bytes, CONTAINER_REF_OFFSET),
        read_ref_suffix(bytes, OBJECT_REF_OFFSET),
        read_ref_suffix(bytes, TRANSFER_REF_OFFSET),
    ];
    let references = DataPlaneFrameReferences::from_suffixes(fixed.kind, suffixes)?;
    let mut payload_sha256 = [0_u8; 32];
    payload_sha256.copy_from_slice(&bytes[PAYLOAD_SHA256_OFFSET..DATA_PLANE_FRAME_HEADER_BYTES]);

    Ok(DecodedDataPlaneFrameHeader {
        kind: fixed.kind,
        work_sequence: fixed.work_sequence,
        chunk_sequence: fixed.chunk_sequence,
        terminal: fixed.flags & FLAG_TERMINAL != 0,
        references,
        payload_length: fixed.payload_length,
        payload_sha256,
    })
}

/// Validates an owned payload against a preflighted header and moves it into a
/// complete frame without copying it.
pub fn finish_decoding_data_plane_frame(
    header: DecodedDataPlaneFrameHeader,
    mut payload: Vec<u8>,
) -> Result<DataPlaneFrame, DataPlaneFrameError> {
    if payload.len() != header.payload_length {
        wipe_rejected_payload(&mut payload);
        return Err(DataPlaneFrameError::LengthMismatch);
    }
    if Sha256::digest(&payload).as_slice() != header.payload_sha256 {
        wipe_rejected_payload(&mut payload);
        return Err(DataPlaneFrameError::PayloadHashMismatch);
    }

    Ok(DataPlaneFrame {
        work_sequence: header.work_sequence,
        chunk_sequence: header.chunk_sequence,
        terminal: header.terminal,
        references: header.references,
        payload,
    })
}

fn wipe_rejected_payload(payload: &mut [u8]) {
    for byte in payload {
        // Best-effort process-memory overwrite. This cannot promise physical
        // RAM, paging-file, or crash-dump erasure.
        unsafe { std::ptr::write_volatile(byte, 0) };
    }
    std::sync::atomic::compiler_fence(std::sync::atomic::Ordering::SeqCst);
}

fn decode_fixed_header(bytes: &[u8]) -> Result<FixedHeaderFields, DataPlaneFrameError> {
    if &bytes[..MAGIC.len()] != MAGIC {
        return Err(DataPlaneFrameError::InvalidMagic);
    }
    if read_u16(bytes, VERSION_OFFSET) != VERSION {
        return Err(DataPlaneFrameError::InvalidVersion);
    }
    if usize::from(read_u16(bytes, HEADER_SIZE_OFFSET)) != DATA_PLANE_FRAME_HEADER_BYTES {
        return Err(DataPlaneFrameError::InvalidHeaderSize);
    }
    let kind = DataPlaneFrameKind::from_wire(bytes[KIND_OFFSET])?;
    let flags = bytes[FLAGS_OFFSET];
    if flags & !FLAG_TERMINAL != 0 {
        return Err(DataPlaneFrameError::InvalidFlags);
    }
    if read_u16(bytes, RESERVED_U16_OFFSET) != 0 {
        return Err(DataPlaneFrameError::NonzeroReserved);
    }
    let work_sequence = read_u64(bytes, WORK_SEQUENCE_OFFSET);
    if work_sequence == 0 {
        return Err(DataPlaneFrameError::InvalidWorkSequence);
    }
    let chunk_sequence = read_u32(bytes, CHUNK_SEQUENCE_OFFSET);
    if chunk_sequence == 0 {
        return Err(DataPlaneFrameError::InvalidChunkSequence);
    }
    let payload_length = read_u32(bytes, PAYLOAD_LENGTH_OFFSET) as usize;
    if payload_length > DATA_PLANE_FRAME_MAX_PAYLOAD_BYTES {
        return Err(DataPlaneFrameError::FrameTooLarge);
    }
    if payload_length == 0 && flags & FLAG_TERMINAL == 0 {
        return Err(DataPlaneFrameError::ZeroLengthNonTerminal);
    }
    if payload_length == 0 && chunk_sequence != 1 {
        return Err(DataPlaneFrameError::InvalidEmptyObject);
    }

    Ok(FixedHeaderFields {
        kind,
        flags,
        work_sequence,
        chunk_sequence,
        payload_length,
    })
}

fn decode_reference_suffix(
    value: &str,
    expected_prefix: &str,
) -> Result<[u8; REF_SUFFIX_BYTES], DataPlaneFrameError> {
    let suffix = value
        .strip_prefix(expected_prefix)
        .ok_or(DataPlaneFrameError::InvalidReference)?;
    if suffix.len() != REF_SUFFIX_BYTES * 2
        || !suffix
            .as_bytes()
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
    {
        return Err(DataPlaneFrameError::InvalidReference);
    }
    let mut decoded = [0_u8; REF_SUFFIX_BYTES];
    hex::decode_to_slice(suffix, &mut decoded)
        .map_err(|_| DataPlaneFrameError::InvalidReference)?;
    if decoded.iter().all(|byte| *byte == 0) {
        return Err(DataPlaneFrameError::InvalidReference);
    }
    Ok(decoded)
}

fn reference_from_suffix(
    prefix: &str,
    suffix: [u8; REF_SUFFIX_BYTES],
) -> Result<String, DataPlaneFrameError> {
    if suffix.iter().all(|byte| *byte == 0) {
        return Err(DataPlaneFrameError::InvalidReference);
    }
    Ok(format!("{prefix}{}", hex::encode(suffix)))
}

fn read_ref_suffix(bytes: &[u8], offset: usize) -> [u8; REF_SUFFIX_BYTES] {
    let mut value = [0_u8; REF_SUFFIX_BYTES];
    value.copy_from_slice(&bytes[offset..offset + REF_SUFFIX_BYTES]);
    value
}

fn read_u16(bytes: &[u8], offset: usize) -> u16 {
    u16::from_be_bytes([bytes[offset], bytes[offset + 1]])
}

fn read_u32(bytes: &[u8], offset: usize) -> u32 {
    u32::from_be_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
    ])
}

fn read_u64(bytes: &[u8], offset: usize) -> u64 {
    u64::from_be_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
        bytes[offset + 4],
        bytes[offset + 5],
        bytes[offset + 6],
        bytes[offset + 7],
    ])
}

#[derive(Clone, Eq, Hash, PartialEq)]
struct TransferBinding {
    direction: DataPlaneFrameDirection,
    kind: DataPlaneFrameKind,
    work_sequence: u64,
    session_ref: String,
    request_ref: String,
    scope_ref: String,
    transfer_ref: String,
}

impl TransferBinding {
    fn from_frame(frame: &DataPlaneFrame) -> Self {
        let kind = frame.references.kind();
        let (session_ref, request_ref, scope_ref, transfer_ref) =
            frame.references.transfer_binding_references();
        Self {
            direction: kind.direction(),
            kind,
            work_sequence: frame.work_sequence,
            session_ref: session_ref.to_owned(),
            request_ref: request_ref.to_owned(),
            scope_ref: scope_ref.to_owned(),
            transfer_ref: transfer_ref.to_owned(),
        }
    }
}

#[derive(Clone, Eq, Hash, PartialEq)]
struct ObjectBinding {
    container_ref: String,
    object_ref: String,
}

impl ObjectBinding {
    fn from_frame(frame: &DataPlaneFrame) -> Self {
        let (container_ref, object_ref) = frame.references.object_references();
        Self {
            container_ref: container_ref.to_owned(),
            object_ref: object_ref.to_owned(),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DataPlaneTransferOrderError {
    InvalidFrame(DataPlaneFrameError),
    AlreadyFinished,
    BindingMismatch,
    InvalidFirstChunkSequence,
    UnexpectedChunkSequence,
    ObjectSwitchBeforeTerminal,
    ObjectReturned,
    FrameAfterTerminal,
    ChunkSequenceExhausted,
    TooManyObjects,
    NoFrames,
    UnterminatedObject,
}

impl Display for DataPlaneTransferOrderError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::InvalidFrame(_) => "data-plane transfer contains an invalid frame",
            Self::AlreadyFinished => "data-plane transfer is already finished",
            Self::BindingMismatch => "data-plane transfer binding or direction changed",
            Self::InvalidFirstChunkSequence => {
                "data-plane object does not start at chunk sequence one"
            }
            Self::UnexpectedChunkSequence => {
                "data-plane object chunk sequence is not the exact successor"
            }
            Self::ObjectSwitchBeforeTerminal => {
                "data-plane transfer switched objects before the terminal chunk"
            }
            Self::ObjectReturned => "data-plane transfer returned to an already completed object",
            Self::FrameAfterTerminal => {
                "data-plane transfer contains a frame after an object's terminal chunk"
            }
            Self::ChunkSequenceExhausted => {
                "data-plane object exhausted chunk sequence before its terminal chunk"
            }
            Self::TooManyObjects => "data-plane transfer exceeds its object limit",
            Self::NoFrames => "data-plane transfer has no frames",
            Self::UnterminatedObject => {
                "data-plane transfer finished before the current object's terminal chunk"
            }
        })
    }
}

impl Error for DataPlaneTransferOrderError {}

/// Checks ordering for one bound, single-direction transfer without exposing references.
///
/// An object is the kind-specific `(container_ref, object_ref)` pair. Objects must be
/// contiguous: a new object can begin only after the current object's terminal frame,
/// and a completed object can never reappear. Call [`Self::finish`] after the final frame.
pub struct DataPlaneTransferOrderValidator {
    binding: Option<TransferBinding>,
    current_object: Option<ObjectBinding>,
    completed_objects: HashSet<ObjectBinding>,
    max_objects: usize,
    next_chunk_sequence: u32,
    current_terminal: bool,
    finished: bool,
}

impl fmt::Debug for DataPlaneTransferOrderValidator {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DataPlaneTransferOrderValidator")
            .field(
                "direction",
                &self.binding.as_ref().map(|binding| binding.direction),
            )
            .field("kind", &self.binding.as_ref().map(|binding| binding.kind))
            .field("object_count", &self.object_count())
            .field("has_current_object", &self.current_object.is_some())
            .field("current_terminal", &self.current_terminal)
            .field("finished", &self.finished)
            .finish_non_exhaustive()
    }
}

impl Default for DataPlaneTransferOrderValidator {
    fn default() -> Self {
        Self::new()
    }
}

impl DataPlaneTransferOrderValidator {
    pub fn new() -> Self {
        Self {
            binding: None,
            current_object: None,
            completed_objects: HashSet::new(),
            max_objects: DATA_PLANE_TRANSFER_MAX_OBJECTS,
            next_chunk_sequence: 1,
            current_terminal: false,
            finished: false,
        }
    }

    pub fn object_count(&self) -> usize {
        self.completed_objects.len() + usize::from(self.current_object.is_some())
    }

    pub fn validate_frame(
        &mut self,
        frame: &DataPlaneFrame,
    ) -> Result<(), DataPlaneTransferOrderError> {
        if self.finished {
            return Err(DataPlaneTransferOrderError::AlreadyFinished);
        }
        validate_frame_shape(frame).map_err(DataPlaneTransferOrderError::InvalidFrame)?;

        let binding = TransferBinding::from_frame(frame);
        if let Some(expected) = &self.binding {
            if expected != &binding {
                return Err(DataPlaneTransferOrderError::BindingMismatch);
            }
        }

        let object = ObjectBinding::from_frame(frame);
        match &self.current_object {
            None => {
                validate_first_chunk(frame)?;
                self.binding = Some(binding);
                self.current_object = Some(object);
            }
            Some(current) if current == &object => {
                if self.current_terminal {
                    return Err(DataPlaneTransferOrderError::FrameAfterTerminal);
                }
                if frame.chunk_sequence != self.next_chunk_sequence {
                    return Err(DataPlaneTransferOrderError::UnexpectedChunkSequence);
                }
                validate_sequence_capacity(frame)?;
            }
            Some(_) => {
                if !self.current_terminal {
                    return Err(DataPlaneTransferOrderError::ObjectSwitchBeforeTerminal);
                }
                if self.completed_objects.contains(&object) {
                    return Err(DataPlaneTransferOrderError::ObjectReturned);
                }
                if self.object_count() >= self.max_objects {
                    return Err(DataPlaneTransferOrderError::TooManyObjects);
                }
                validate_first_chunk(frame)?;
                let completed = self
                    .current_object
                    .replace(object)
                    .expect("the current object was matched above");
                self.completed_objects.insert(completed);
            }
        }

        self.current_terminal = frame.terminal;
        self.next_chunk_sequence = frame.chunk_sequence.saturating_add(1);
        Ok(())
    }

    pub fn finish(&mut self) -> Result<(), DataPlaneTransferOrderError> {
        if self.finished {
            return Err(DataPlaneTransferOrderError::AlreadyFinished);
        }
        if self.current_object.is_none() {
            return Err(DataPlaneTransferOrderError::NoFrames);
        }
        if !self.current_terminal {
            return Err(DataPlaneTransferOrderError::UnterminatedObject);
        }
        self.finished = true;
        Ok(())
    }
}

fn validate_first_chunk(frame: &DataPlaneFrame) -> Result<(), DataPlaneTransferOrderError> {
    if frame.chunk_sequence != 1 {
        return Err(DataPlaneTransferOrderError::InvalidFirstChunkSequence);
    }
    validate_sequence_capacity(frame)
}

fn validate_sequence_capacity(frame: &DataPlaneFrame) -> Result<(), DataPlaneTransferOrderError> {
    if frame.chunk_sequence == u32::MAX && !frame.terminal {
        return Err(DataPlaneTransferOrderError::ChunkSequenceExhausted);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde::Deserialize;

    use super::*;

    const SESSION: &str = "helper_session_000102030405060708090a0b0c0d0e0f";
    const REQUEST: &str = "helper_request_101112131415161718191a1b1c1d1e1f";
    const SCOPE: &str = "helper_scope_202122232425262728292a2b2c2d2e2f";
    const SOURCE: &str = "helper_source_303132333435363738393a3b3c3d3e3f";
    const SOURCE_FILE: &str = "helper_source_file_404142434445464748494a4b4c4d4e4f";
    const RUN: &str = "helper_run_505152535455565758595a5b5c5d5e5f";
    const OUTPUT_FILE: &str = "helper_output_file_606162636465666768696a6b6c6d6e6f";
    const TRANSFER: &str = "helper_transfer_707172737475767778797a7b7c7d7e7f";
    const CATALOG: &str = "helper_catalog_e0e1e2e3e4e5e6e7e8e9eaebecedeeef";
    const OTHER_SOURCE: &str = "helper_source_f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff";
    const OTHER_SOURCE_FILE: &str = "helper_source_file_d0d1d2d3d4d5d6d7d8d9dadbdcdddedf";
    const THIRD_SOURCE_FILE: &str = "helper_source_file_c1c2c3c4c5c6c7c8c9cacbcccdcecfd0";
    const OTHER_SESSION: &str = "helper_session_8182838485868788898a8b8c8d8e8f90";
    const OTHER_REQUEST: &str = "helper_request_9192939495969798999a9b9c9d9e9fa0";
    const OTHER_SCOPE: &str = "helper_scope_a1a2a3a4a5a6a7a8a9aaabacadaeafb0";
    const OTHER_TRANSFER: &str = "helper_transfer_b1b2b3b4b5b6b7b8b9babbbcbdbebfc0";

    #[derive(Deserialize)]
    struct GoldenFixture {
        format: String,
        version: u16,
        header_size_bytes: usize,
        max_payload_bytes: usize,
        vectors: Vec<GoldenVector>,
    }

    #[derive(Deserialize)]
    struct GoldenVector {
        name: String,
        kind: String,
        terminal: bool,
        work_sequence_decimal: String,
        chunk_sequence_decimal: String,
        session_ref: String,
        request_ref: String,
        scope_ref: String,
        container_ref: String,
        object_ref: String,
        transfer_ref: String,
        payload_hex: String,
        payload_sha256_hex: String,
        frame_hex: String,
    }

    #[test]
    fn shared_golden_vectors_encode_and_decode_exactly() {
        let fixture: GoldenFixture =
            serde_json::from_str(include_str!("../test-vectors/vnsdp01-golden-vectors.json"))
                .expect("golden fixture should parse");
        assert_eq!(fixture.format, "VNSDP01");
        assert_eq!(fixture.version, VERSION);
        assert_eq!(fixture.header_size_bytes, DATA_PLANE_FRAME_HEADER_BYTES);
        assert_eq!(
            fixture.max_payload_bytes,
            DATA_PLANE_FRAME_MAX_PAYLOAD_BYTES
        );
        assert_eq!(fixture.vectors.len(), 3);

        for vector in fixture.vectors {
            let payload = hex::decode(&vector.payload_hex).expect("payload should be hex");
            assert_eq!(
                hex::encode(Sha256::digest(&payload)),
                vector.payload_sha256_hex
            );
            let references = match vector.kind.as_str() {
                "source" => DataPlaneFrameReferences::Source {
                    session_ref: vector.session_ref,
                    request_ref: vector.request_ref,
                    scope_ref: vector.scope_ref,
                    source_ref: vector.container_ref,
                    source_file_ref: vector.object_ref,
                    transfer_ref: vector.transfer_ref,
                },
                "output" => DataPlaneFrameReferences::Output {
                    session_ref: vector.session_ref,
                    request_ref: vector.request_ref,
                    scope_ref: vector.scope_ref,
                    run_ref: vector.container_ref,
                    output_file_ref: vector.object_ref,
                    transfer_ref: vector.transfer_ref,
                },
                "catalog" => DataPlaneFrameReferences::Catalog {
                    session_ref: vector.session_ref,
                    request_ref: vector.request_ref,
                    scope_ref: vector.scope_ref,
                    source_ref: vector.container_ref,
                    catalog_ref: vector.object_ref,
                    transfer_ref: vector.transfer_ref,
                },
                _ => panic!("fixture kind should be supported"),
            };
            let expected = DataPlaneFrame {
                work_sequence: vector
                    .work_sequence_decimal
                    .parse()
                    .expect("sequence should be u64"),
                chunk_sequence: vector
                    .chunk_sequence_decimal
                    .parse()
                    .expect("chunk sequence should be u32"),
                terminal: vector.terminal,
                references,
                payload,
            };
            let golden_bytes = hex::decode(vector.frame_hex).expect("frame should be hex");
            assert_eq!(encode_data_plane_frame(&expected), Ok(golden_bytes.clone()));
            assert_eq!(decode_data_plane_frame(&golden_bytes), Ok(expected));
            if vector.name == "catalog-raw-utf16-unpaired-surrogate" {
                assert_eq!(vector.payload_hex, "0041d8000042");
            }
        }
    }

    #[test]
    fn debug_output_never_contains_references_hashes_or_payload_bytes() {
        let frame = source_frame(b"PRIVATE_PAYLOAD_MARKER".to_vec());
        let references_debug = format!("{:?}", frame.references);
        let frame_debug = format!("{frame:?}");
        let parts = encode_data_plane_frame_parts(&frame).expect("parts should encode");
        let decoded_header =
            decode_data_plane_frame_header(&parts.header).expect("header should decode");
        let parts_debug = format!("{parts:?}");
        let header_debug = format!("{decoded_header:?}");

        assert_eq!(
            references_debug,
            "DataPlaneFrameReferences { kind: Source, .. }"
        );
        assert_eq!(
            frame_debug,
            "DataPlaneFrame { kind: Source, work_sequence: 1, chunk_sequence: 1, terminal: false, payload_length: 22, .. }"
        );
        for private_marker in ["helper_", "00010203", "PRIVATE_PAYLOAD_MARKER", "sha256"] {
            assert!(!references_debug.contains(private_marker));
            assert!(!frame_debug.contains(private_marker));
            assert!(!parts_debug.contains(private_marker));
            assert!(!header_debug.contains(private_marker));
        }
    }

    #[test]
    fn streaming_parts_borrow_on_encode_and_move_on_decode() {
        let frame = source_frame(b"borrowed-payload".to_vec());
        let original_pointer = frame.payload.as_ptr();
        let parts = encode_data_plane_frame_parts(&frame).expect("parts should encode");
        assert_eq!(parts.payload.as_ptr(), original_pointer);
        assert_eq!(parts.payload, frame.payload);

        let header =
            decode_data_plane_frame_header(&parts.header).expect("header should preflight");
        assert_eq!(header.kind(), DataPlaneFrameKind::Source);
        assert_eq!(header.payload_length(), frame.payload.len());

        let owned_payload = frame.payload.clone();
        let owned_pointer = owned_payload.as_ptr();
        let decoded = finish_decoding_data_plane_frame(header, owned_payload)
            .expect("payload should finish decoding");
        assert_eq!(decoded.payload.as_ptr(), owned_pointer);
        assert_eq!(decoded, frame);
    }

    #[test]
    fn one_mebibyte_boundary_roundtrips_without_a_large_fixture() {
        let frame = source_frame(vec![0xa5; DATA_PLANE_FRAME_MAX_PAYLOAD_BYTES]);
        let encoded = encode_data_plane_frame(&frame).expect("maximum payload should encode");
        assert_eq!(
            encoded.len(),
            DATA_PLANE_FRAME_HEADER_BYTES + DATA_PLANE_FRAME_MAX_PAYLOAD_BYTES
        );
        assert_eq!(decode_data_plane_frame(&encoded), Ok(frame));

        let oversized = source_frame(vec![0; DATA_PLANE_FRAME_MAX_PAYLOAD_BYTES + 1]);
        assert_eq!(
            encode_data_plane_frame(&oversized),
            Err(DataPlaneFrameError::FrameTooLarge)
        );
        let oversized_wire =
            vec![0; DATA_PLANE_FRAME_HEADER_BYTES + DATA_PLANE_FRAME_MAX_PAYLOAD_BYTES + 1];
        assert_eq!(
            decode_data_plane_frame(&oversized_wire),
            Err(DataPlaneFrameError::FrameTooLarge)
        );
    }

    #[test]
    fn malformed_fixed_header_fields_fail_closed() {
        let valid = encode_data_plane_frame(&source_frame(b"abc".to_vec())).expect("valid frame");
        let cases = [
            (mutated(&valid, 0, b'X'), DataPlaneFrameError::InvalidMagic),
            (
                mutated(&valid, VERSION_OFFSET + 1, 2),
                DataPlaneFrameError::InvalidVersion,
            ),
            (
                mutated(&valid, HEADER_SIZE_OFFSET + 1, 159),
                DataPlaneFrameError::InvalidHeaderSize,
            ),
            (
                mutated(&valid, KIND_OFFSET, 4),
                DataPlaneFrameError::InvalidKind,
            ),
            (
                mutated(&valid, FLAGS_OFFSET, 2),
                DataPlaneFrameError::InvalidFlags,
            ),
            (
                mutated(&valid, RESERVED_U16_OFFSET, 1),
                DataPlaneFrameError::NonzeroReserved,
            ),
        ];
        for (bytes, expected) in cases {
            assert_eq!(decode_data_plane_frame(&bytes), Err(expected));
        }
    }

    #[test]
    fn short_length_mismatch_hash_and_zero_sequences_fail_closed() {
        assert_eq!(
            decode_data_plane_frame(&[0; DATA_PLANE_FRAME_HEADER_BYTES - 1]),
            Err(DataPlaneFrameError::FrameTooShort)
        );
        let valid = encode_data_plane_frame(&source_frame(b"abc".to_vec())).expect("valid frame");

        let mut declared_shorter = valid.clone();
        declared_shorter[PAYLOAD_LENGTH_OFFSET..CHUNK_SEQUENCE_OFFSET]
            .copy_from_slice(&2_u32.to_be_bytes());
        assert_eq!(
            decode_data_plane_frame(&declared_shorter),
            Err(DataPlaneFrameError::LengthMismatch)
        );
        let mut truncated = valid.clone();
        truncated.pop();
        assert_eq!(
            decode_data_plane_frame(&truncated),
            Err(DataPlaneFrameError::LengthMismatch)
        );
        let mut bad_hash = valid.clone();
        bad_hash[PAYLOAD_SHA256_OFFSET] ^= 1;
        assert_eq!(
            decode_data_plane_frame(&bad_hash),
            Err(DataPlaneFrameError::PayloadHashMismatch)
        );
        let mut zero_sequence = valid;
        zero_sequence[WORK_SEQUENCE_OFFSET..PAYLOAD_LENGTH_OFFSET].fill(0);
        assert_eq!(
            decode_data_plane_frame(&zero_sequence),
            Err(DataPlaneFrameError::InvalidWorkSequence)
        );

        let mut zero_chunk =
            encode_data_plane_frame(&source_frame(b"abc".to_vec())).expect("valid frame");
        zero_chunk[CHUNK_SEQUENCE_OFFSET..SESSION_REF_OFFSET].fill(0);
        assert_eq!(
            decode_data_plane_frame(&zero_chunk),
            Err(DataPlaneFrameError::InvalidChunkSequence)
        );
    }

    #[test]
    fn declared_oversize_fails_before_length_mismatch() {
        let mut frame = encode_data_plane_frame(&source_frame(Vec::new())).expect("valid frame");
        frame[PAYLOAD_LENGTH_OFFSET..CHUNK_SEQUENCE_OFFSET]
            .copy_from_slice(&((DATA_PLANE_FRAME_MAX_PAYLOAD_BYTES + 1) as u32).to_be_bytes());
        assert_eq!(
            decode_data_plane_frame_header(&frame[..DATA_PLANE_FRAME_HEADER_BYTES]),
            Err(DataPlaneFrameError::FrameTooLarge)
        );
        assert_eq!(
            decode_data_plane_frame(&frame),
            Err(DataPlaneFrameError::FrameTooLarge)
        );
    }

    #[test]
    fn zero_length_is_only_the_first_terminal_chunk_of_an_empty_object() {
        for references in [
            source_references(SESSION, REQUEST, SCOPE, SOURCE, SOURCE_FILE, TRANSFER),
            output_references(SESSION, REQUEST, SCOPE, RUN, OUTPUT_FILE, TRANSFER),
            catalog_references(SESSION, REQUEST, SCOPE, SOURCE, CATALOG, TRANSFER),
        ] {
            let canonical = DataPlaneFrame {
                work_sequence: 1,
                chunk_sequence: 1,
                terminal: true,
                references: references.clone(),
                payload: Vec::new(),
            };
            let encoded = encode_data_plane_frame(&canonical).expect("canonical empty object");
            assert_eq!(decode_data_plane_frame(&encoded), Ok(canonical));

            let nonterminal = DataPlaneFrame {
                work_sequence: 1,
                chunk_sequence: 1,
                terminal: false,
                references: references.clone(),
                payload: Vec::new(),
            };
            assert_eq!(
                encode_data_plane_frame(&nonterminal),
                Err(DataPlaneFrameError::ZeroLengthNonTerminal)
            );
            let mut nonterminal_wire = encoded.clone();
            nonterminal_wire[FLAGS_OFFSET] = 0;
            assert_eq!(
                decode_data_plane_frame(&nonterminal_wire),
                Err(DataPlaneFrameError::ZeroLengthNonTerminal)
            );

            let late_terminal = DataPlaneFrame {
                work_sequence: 1,
                chunk_sequence: 2,
                terminal: true,
                references,
                payload: Vec::new(),
            };
            assert_eq!(
                encode_data_plane_frame(&late_terminal),
                Err(DataPlaneFrameError::InvalidEmptyObject)
            );
            let mut late_terminal_wire = encoded.clone();
            late_terminal_wire[CHUNK_SEQUENCE_OFFSET..SESSION_REF_OFFSET]
                .copy_from_slice(&2_u32.to_be_bytes());
            assert_eq!(
                decode_data_plane_frame(&late_terminal_wire),
                Err(DataPlaneFrameError::InvalidEmptyObject)
            );
        }
    }

    #[test]
    fn kinds_have_fixed_pipe_directions() {
        assert_eq!(
            DataPlaneFrameKind::Source.direction(),
            DataPlaneFrameDirection::HelperToNode
        );
        assert_eq!(
            DataPlaneFrameKind::Catalog.direction(),
            DataPlaneFrameDirection::HelperToNode
        );
        assert_eq!(
            DataPlaneFrameKind::Output.direction(),
            DataPlaneFrameDirection::NodeToHelper
        );
    }

    #[test]
    fn every_reference_is_required_and_canonical_when_encoding() {
        let invalid_values = [
            "helper_session_00000000000000000000000000000000",
            "helper_session_000102030405060708090A0B0C0D0E0F",
            "wrong_000102030405060708090a0b0c0d0e0f",
            "helper_session_000102030405060708090a0b0c0d0e",
        ];
        for invalid in invalid_values {
            let mut frame = source_frame(Vec::new());
            if let DataPlaneFrameReferences::Source { session_ref, .. } = &mut frame.references {
                *session_ref = invalid.to_owned();
            }
            assert_eq!(
                encode_data_plane_frame(&frame),
                Err(DataPlaneFrameError::InvalidReference)
            );
        }

        let invalid_source_fields = [
            source_references("bad", REQUEST, SCOPE, SOURCE, SOURCE_FILE, TRANSFER),
            source_references(SESSION, "bad", SCOPE, SOURCE, SOURCE_FILE, TRANSFER),
            source_references(SESSION, REQUEST, "bad", SOURCE, SOURCE_FILE, TRANSFER),
            source_references(SESSION, REQUEST, SCOPE, "bad", SOURCE_FILE, TRANSFER),
            source_references(SESSION, REQUEST, SCOPE, SOURCE, "bad", TRANSFER),
            source_references(SESSION, REQUEST, SCOPE, SOURCE, SOURCE_FILE, "bad"),
        ];
        for references in invalid_source_fields {
            let frame = DataPlaneFrame {
                work_sequence: 1,
                chunk_sequence: 1,
                terminal: true,
                references,
                payload: Vec::new(),
            };
            assert_eq!(
                encode_data_plane_frame(&frame),
                Err(DataPlaneFrameError::InvalidReference)
            );
        }

        let wrong_output_prefixes = DataPlaneFrame {
            work_sequence: 1,
            chunk_sequence: 1,
            terminal: true,
            references: DataPlaneFrameReferences::Output {
                session_ref: SESSION.to_owned(),
                request_ref: REQUEST.to_owned(),
                scope_ref: SCOPE.to_owned(),
                run_ref: SOURCE.to_owned(),
                output_file_ref: SOURCE_FILE.to_owned(),
                transfer_ref: TRANSFER.to_owned(),
            },
            payload: Vec::new(),
        };
        assert_eq!(
            encode_data_plane_frame(&wrong_output_prefixes),
            Err(DataPlaneFrameError::InvalidReference)
        );

        let wrong_catalog_prefix = DataPlaneFrame {
            work_sequence: 1,
            chunk_sequence: 1,
            terminal: true,
            references: DataPlaneFrameReferences::Catalog {
                session_ref: SESSION.to_owned(),
                request_ref: REQUEST.to_owned(),
                scope_ref: SCOPE.to_owned(),
                source_ref: SOURCE.to_owned(),
                catalog_ref: OUTPUT_FILE.to_owned(),
                transfer_ref: TRANSFER.to_owned(),
            },
            payload: Vec::new(),
        };
        assert_eq!(
            encode_data_plane_frame(&wrong_catalog_prefix),
            Err(DataPlaneFrameError::InvalidReference)
        );
    }

    #[test]
    fn zero_reference_suffixes_and_zero_encode_sequences_fail_closed() {
        let encoded = encode_data_plane_frame(&source_frame(Vec::new())).expect("valid frame");
        for offset in [
            SESSION_REF_OFFSET,
            REQUEST_REF_OFFSET,
            SCOPE_REF_OFFSET,
            CONTAINER_REF_OFFSET,
            OBJECT_REF_OFFSET,
            TRANSFER_REF_OFFSET,
        ] {
            let mut zero_reference = encoded.clone();
            zero_reference[offset..offset + REF_SUFFIX_BYTES].fill(0);
            assert_eq!(
                decode_data_plane_frame(&zero_reference),
                Err(DataPlaneFrameError::InvalidReference)
            );
        }
        let mut frame = source_frame(Vec::new());
        frame.work_sequence = 0;
        assert_eq!(
            encode_data_plane_frame(&frame),
            Err(DataPlaneFrameError::InvalidWorkSequence)
        );

        let mut frame = source_frame(Vec::new());
        frame.chunk_sequence = 0;
        assert_eq!(
            encode_data_plane_frame(&frame),
            Err(DataPlaneFrameError::InvalidChunkSequence)
        );
    }

    #[test]
    fn u64_work_sequence_is_big_endian_and_lossless() {
        let mut frame = source_frame(Vec::new());
        frame.work_sequence = 0x0102_0304_0506_0708;
        let encoded = encode_data_plane_frame(&frame).expect("valid frame");
        assert_eq!(
            &encoded[WORK_SEQUENCE_OFFSET..PAYLOAD_LENGTH_OFFSET],
            &[1, 2, 3, 4, 5, 6, 7, 8]
        );
        assert_eq!(decode_data_plane_frame(&encoded), Ok(frame));

        let mut maximum = source_frame(Vec::new());
        maximum.work_sequence = u64::MAX;
        let maximum_encoded = encode_data_plane_frame(&maximum).expect("maximum u64 should encode");
        assert_eq!(
            &maximum_encoded[WORK_SEQUENCE_OFFSET..PAYLOAD_LENGTH_OFFSET],
            &[0xff; 8]
        );
        assert_eq!(decode_data_plane_frame(&maximum_encoded), Ok(maximum));
    }

    #[test]
    fn u32_chunk_sequence_is_big_endian_and_lossless() {
        let mut frame = source_frame(b"chunk".to_vec());
        frame.chunk_sequence = 0x0102_0304;
        let encoded = encode_data_plane_frame(&frame).expect("valid frame");
        assert_eq!(
            &encoded[CHUNK_SEQUENCE_OFFSET..SESSION_REF_OFFSET],
            &[1, 2, 3, 4]
        );
        assert_eq!(decode_data_plane_frame(&encoded), Ok(frame));

        let mut maximum = source_frame(b"terminal".to_vec());
        maximum.chunk_sequence = u32::MAX;
        maximum.terminal = true;
        let encoded = encode_data_plane_frame(&maximum).expect("maximum u32 should encode");
        assert_eq!(
            &encoded[CHUNK_SEQUENCE_OFFSET..SESSION_REF_OFFSET],
            &[0xff; 4]
        );
        assert_eq!(decode_data_plane_frame(&encoded), Ok(maximum));
    }

    #[test]
    fn transfer_validator_accepts_contiguous_multi_object_source_order() {
        let frames = [
            source_object_frame(SOURCE, SOURCE_FILE, 1, false, b"first"),
            source_object_frame(SOURCE, SOURCE_FILE, 2, true, b"last"),
            source_object_frame(OTHER_SOURCE, OTHER_SOURCE_FILE, 1, true, b""),
        ];
        let mut validator = DataPlaneTransferOrderValidator::new();
        for frame in &frames {
            validator
                .validate_frame(frame)
                .expect("ordered source frame should validate");
        }
        assert_eq!(validator.object_count(), 2);

        let debug = format!("{validator:?}");
        assert!(debug.contains("direction: Some(HelperToNode)"));
        assert!(debug.contains("kind: Some(Source)"));
        assert!(!debug.contains("helper_"));
        assert!(!debug.contains("00010203"));
        validator.finish().expect("terminal transfer should finish");
    }

    #[test]
    fn transfer_validator_binds_direction_kind_work_and_common_references() {
        let first = source_object_frame(SOURCE, SOURCE_FILE, 1, true, b"one");
        let changed_frames = [
            DataPlaneFrame {
                work_sequence: 2,
                ..source_object_frame(OTHER_SOURCE, OTHER_SOURCE_FILE, 1, true, b"two")
            },
            DataPlaneFrame {
                references: source_references(
                    OTHER_SESSION,
                    REQUEST,
                    SCOPE,
                    OTHER_SOURCE,
                    OTHER_SOURCE_FILE,
                    TRANSFER,
                ),
                ..source_object_frame(OTHER_SOURCE, OTHER_SOURCE_FILE, 1, true, b"two")
            },
            DataPlaneFrame {
                references: source_references(
                    SESSION,
                    OTHER_REQUEST,
                    SCOPE,
                    OTHER_SOURCE,
                    OTHER_SOURCE_FILE,
                    TRANSFER,
                ),
                ..source_object_frame(OTHER_SOURCE, OTHER_SOURCE_FILE, 1, true, b"two")
            },
            DataPlaneFrame {
                references: source_references(
                    SESSION,
                    REQUEST,
                    OTHER_SCOPE,
                    OTHER_SOURCE,
                    OTHER_SOURCE_FILE,
                    TRANSFER,
                ),
                ..source_object_frame(OTHER_SOURCE, OTHER_SOURCE_FILE, 1, true, b"two")
            },
            DataPlaneFrame {
                references: source_references(
                    SESSION,
                    REQUEST,
                    SCOPE,
                    OTHER_SOURCE,
                    OTHER_SOURCE_FILE,
                    OTHER_TRANSFER,
                ),
                ..source_object_frame(OTHER_SOURCE, OTHER_SOURCE_FILE, 1, true, b"two")
            },
            DataPlaneFrame {
                work_sequence: 1,
                chunk_sequence: 1,
                terminal: true,
                references: output_references(SESSION, REQUEST, SCOPE, RUN, OUTPUT_FILE, TRANSFER),
                payload: b"output".to_vec(),
            },
            DataPlaneFrame {
                work_sequence: 1,
                chunk_sequence: 1,
                terminal: true,
                references: catalog_references(
                    SESSION,
                    REQUEST,
                    SCOPE,
                    OTHER_SOURCE,
                    CATALOG,
                    TRANSFER,
                ),
                payload: b"catalog".to_vec(),
            },
        ];

        for changed in &changed_frames {
            let mut validator = DataPlaneTransferOrderValidator::new();
            validator.validate_frame(&first).expect("first frame");
            assert_eq!(
                validator.validate_frame(changed),
                Err(DataPlaneTransferOrderError::BindingMismatch)
            );
        }
    }

    #[test]
    fn transfer_validator_requires_exact_per_object_successors() {
        let mut validator = DataPlaneTransferOrderValidator::new();
        assert_eq!(
            validator.validate_frame(&source_object_frame(SOURCE, SOURCE_FILE, 2, false, b"late")),
            Err(DataPlaneTransferOrderError::InvalidFirstChunkSequence)
        );
        assert_eq!(validator.object_count(), 0);

        validator
            .validate_frame(&source_object_frame(SOURCE, SOURCE_FILE, 1, false, b"one"))
            .expect("first chunk");
        for sequence in [1, 3] {
            assert_eq!(
                validator.validate_frame(&source_object_frame(
                    SOURCE,
                    SOURCE_FILE,
                    sequence,
                    false,
                    b"wrong",
                )),
                Err(DataPlaneTransferOrderError::UnexpectedChunkSequence)
            );
        }
        validator
            .validate_frame(&source_object_frame(SOURCE, SOURCE_FILE, 2, false, b"two"))
            .expect("second chunk");
        assert_eq!(
            validator.validate_frame(&source_object_frame(
                SOURCE,
                SOURCE_FILE,
                2,
                true,
                b"duplicate",
            )),
            Err(DataPlaneTransferOrderError::UnexpectedChunkSequence)
        );
        validator
            .validate_frame(&source_object_frame(SOURCE, SOURCE_FILE, 3, true, b"three"))
            .expect("terminal successor");
    }

    #[test]
    fn transfer_validator_rejects_switches_returns_and_post_terminal_frames() {
        let first_open = source_object_frame(SOURCE, SOURCE_FILE, 1, false, b"open");
        let other_terminal =
            source_object_frame(OTHER_SOURCE, OTHER_SOURCE_FILE, 1, true, b"other");
        let mut open_validator = DataPlaneTransferOrderValidator::new();
        open_validator
            .validate_frame(&first_open)
            .expect("first object opens");
        assert_eq!(
            open_validator.validate_frame(&other_terminal),
            Err(DataPlaneTransferOrderError::ObjectSwitchBeforeTerminal)
        );

        let first_terminal = source_object_frame(SOURCE, SOURCE_FILE, 1, true, b"done");
        let mut post_terminal = DataPlaneTransferOrderValidator::new();
        post_terminal
            .validate_frame(&first_terminal)
            .expect("terminal first object");
        assert_eq!(
            post_terminal.validate_frame(&source_object_frame(
                SOURCE,
                SOURCE_FILE,
                2,
                true,
                b"again",
            )),
            Err(DataPlaneTransferOrderError::FrameAfterTerminal)
        );
        assert_eq!(
            post_terminal.validate_frame(&source_object_frame(
                OTHER_SOURCE,
                OTHER_SOURCE_FILE,
                2,
                true,
                b"bad start",
            )),
            Err(DataPlaneTransferOrderError::InvalidFirstChunkSequence)
        );

        post_terminal
            .validate_frame(&other_terminal)
            .expect("second object starts after terminal");
        assert_eq!(
            post_terminal.validate_frame(&first_terminal),
            Err(DataPlaneTransferOrderError::ObjectReturned)
        );
    }

    #[test]
    fn transfer_validator_requires_explicit_complete_finish() {
        let mut empty = DataPlaneTransferOrderValidator::new();
        assert_eq!(empty.finish(), Err(DataPlaneTransferOrderError::NoFrames));

        let mut open = DataPlaneTransferOrderValidator::new();
        open.validate_frame(&source_object_frame(SOURCE, SOURCE_FILE, 1, false, b"open"))
            .expect("open object");
        assert_eq!(
            open.finish(),
            Err(DataPlaneTransferOrderError::UnterminatedObject)
        );

        let terminal = source_object_frame(SOURCE, SOURCE_FILE, 1, true, b"done");
        let mut complete = DataPlaneTransferOrderValidator::new();
        complete.validate_frame(&terminal).expect("terminal frame");
        complete.finish().expect("explicit finish");
        assert_eq!(
            complete.finish(),
            Err(DataPlaneTransferOrderError::AlreadyFinished)
        );
        assert_eq!(
            complete.validate_frame(&terminal),
            Err(DataPlaneTransferOrderError::AlreadyFinished)
        );
    }

    #[test]
    fn transfer_validator_has_a_fixed_object_bound() {
        let mut validator = DataPlaneTransferOrderValidator::new();
        validator.max_objects = 2;
        validator
            .validate_frame(&source_object_frame(SOURCE, SOURCE_FILE, 1, true, b"one"))
            .expect("first object");
        validator
            .validate_frame(&source_object_frame(
                OTHER_SOURCE,
                OTHER_SOURCE_FILE,
                1,
                true,
                b"two",
            ))
            .expect("second object");
        assert_eq!(
            validator.validate_frame(&source_object_frame(
                OTHER_SOURCE,
                THIRD_SOURCE_FILE,
                1,
                true,
                b"three",
            )),
            Err(DataPlaneTransferOrderError::TooManyObjects)
        );
        assert_eq!(validator.object_count(), 2);
    }

    #[test]
    fn transfer_validator_rejects_invalid_frames_and_sequence_exhaustion() {
        let zero_progress = DataPlaneFrame {
            terminal: false,
            payload: Vec::new(),
            ..source_object_frame(SOURCE, SOURCE_FILE, 1, true, b"ignored")
        };
        let mut validator = DataPlaneTransferOrderValidator::new();
        assert_eq!(
            validator.validate_frame(&zero_progress),
            Err(DataPlaneTransferOrderError::InvalidFrame(
                DataPlaneFrameError::ZeroLengthNonTerminal
            ))
        );

        let exhausted = source_object_frame(SOURCE, SOURCE_FILE, u32::MAX, false, b"not terminal");
        assert_eq!(
            validate_sequence_capacity(&exhausted),
            Err(DataPlaneTransferOrderError::ChunkSequenceExhausted)
        );
    }

    fn source_object_frame(
        source_ref: &str,
        source_file_ref: &str,
        chunk_sequence: u32,
        terminal: bool,
        payload: &[u8],
    ) -> DataPlaneFrame {
        DataPlaneFrame {
            work_sequence: 1,
            chunk_sequence,
            terminal,
            references: source_references(
                SESSION,
                REQUEST,
                SCOPE,
                source_ref,
                source_file_ref,
                TRANSFER,
            ),
            payload: payload.to_vec(),
        }
    }

    fn source_frame(payload: Vec<u8>) -> DataPlaneFrame {
        let terminal = payload.is_empty();
        DataPlaneFrame {
            work_sequence: 1,
            chunk_sequence: 1,
            terminal,
            references: source_references(SESSION, REQUEST, SCOPE, SOURCE, SOURCE_FILE, TRANSFER),
            payload,
        }
    }

    fn output_references(
        session_ref: &str,
        request_ref: &str,
        scope_ref: &str,
        run_ref: &str,
        output_file_ref: &str,
        transfer_ref: &str,
    ) -> DataPlaneFrameReferences {
        DataPlaneFrameReferences::Output {
            session_ref: session_ref.to_owned(),
            request_ref: request_ref.to_owned(),
            scope_ref: scope_ref.to_owned(),
            run_ref: run_ref.to_owned(),
            output_file_ref: output_file_ref.to_owned(),
            transfer_ref: transfer_ref.to_owned(),
        }
    }

    fn catalog_references(
        session_ref: &str,
        request_ref: &str,
        scope_ref: &str,
        source_ref: &str,
        catalog_ref: &str,
        transfer_ref: &str,
    ) -> DataPlaneFrameReferences {
        DataPlaneFrameReferences::Catalog {
            session_ref: session_ref.to_owned(),
            request_ref: request_ref.to_owned(),
            scope_ref: scope_ref.to_owned(),
            source_ref: source_ref.to_owned(),
            catalog_ref: catalog_ref.to_owned(),
            transfer_ref: transfer_ref.to_owned(),
        }
    }

    fn source_references(
        session_ref: &str,
        request_ref: &str,
        scope_ref: &str,
        source_ref: &str,
        source_file_ref: &str,
        transfer_ref: &str,
    ) -> DataPlaneFrameReferences {
        DataPlaneFrameReferences::Source {
            session_ref: session_ref.to_owned(),
            request_ref: request_ref.to_owned(),
            scope_ref: scope_ref.to_owned(),
            source_ref: source_ref.to_owned(),
            source_file_ref: source_file_ref.to_owned(),
            transfer_ref: transfer_ref.to_owned(),
        }
    }

    fn mutated(bytes: &[u8], offset: usize, value: u8) -> Vec<u8> {
        let mut mutated = bytes.to_vec();
        mutated[offset] = value;
        mutated
    }
}
