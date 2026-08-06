//! Streaming private catalog codec for exact retained source layouts.
//!
//! Catalog names remain raw UTF-16 code units. Debug implementations redact names,
//! opaque references, and digests, and this module has no browser-facing surface.

use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;
use std::fmt::{self, Display, Formatter};
use std::io::Write;

use sha2::{Digest, Sha256};

use crate::custody::{
    modeled_layout_record_bytes_from_unit_counts, FileIdentity, RetainedSource, Sha256Digest,
    SourceCatalogLayoutView, SourceCatalogRecordKind as CustodyRecordKind, SourceCatalogRecordView,
    SourceKind, SourceLayoutDigestBuilder, DEFAULT_MAX_ENTRIES, DEFAULT_MAX_FILES,
    DEFAULT_MAX_LAYOUT_MEMORY_BYTES, MAX_OPEN_DIRECTORY_DEPTH,
};
use crate::path::{MAX_PRIVATE_PATH_SEGMENT_UTF16_UNITS, MAX_PRIVATE_PATH_UTF16_UNITS};

pub const SOURCE_CATALOG_HEADER_BYTES: usize = 80;
pub const SOURCE_CATALOG_RECORD_HEADER_BYTES: usize = 40;
pub const SOURCE_CATALOG_MAX_ENCODED_BYTES: usize = DEFAULT_MAX_LAYOUT_MEMORY_BYTES as usize;

const MAGIC: &[u8; 8] = b"VNSHCAT1";
const VERSION: u16 = 1;
const SOURCE_KIND_FILE: u8 = 1;
const SOURCE_KIND_FOLDER: u8 = 2;
const RECORD_KIND_DIRECTORY: u8 = 1;
const RECORD_KIND_FILE: u8 = 2;
const FILE_TRAILER_BYTES: usize = 24;
const REFERENCE_SUFFIX_BYTES: usize = 16;
const COMPONENT_WRITE_BUFFER_BYTES: usize = 8 * 1024;
const SOURCE_FILE_REF_PREFIX: &str = "helper_source_file_";

const VERSION_OFFSET: usize = 8;
const HEADER_SIZE_OFFSET: usize = 10;
const SOURCE_KIND_OFFSET: usize = 12;
const HEADER_RESERVED_U24_OFFSET: usize = 13;
const DIRECTORY_COUNT_OFFSET: usize = 16;
const FILE_COUNT_OFFSET: usize = 20;
const RECORD_COUNT_OFFSET: usize = 24;
const HEADER_RESERVED_U32_OFFSET: usize = 28;
const TOTAL_ENCODED_BYTES_OFFSET: usize = 32;
const LAYOUT_SHA256_OFFSET: usize = 40;
const HEADER_RESERVED_U64_OFFSET: usize = 72;

const RECORD_KIND_OFFSET: usize = 0;
const RECORD_FLAGS_OFFSET: usize = 1;
const RECORD_HEADER_SIZE_OFFSET: usize = 2;
const RECORD_LENGTH_OFFSET: usize = 4;
const RECORD_VOLUME_OFFSET: usize = 8;
const RECORD_FILE_ID_OFFSET: usize = 16;
const RECORD_COMPONENT_COUNT_OFFSET: usize = 32;
const RECORD_RESERVED_U32_OFFSET: usize = 36;

#[derive(Clone, Copy, Eq, Ord, PartialEq, PartialOrd)]
pub struct SourceCatalogFileReference {
    suffix: [u8; REFERENCE_SUFFIX_BYTES],
}

impl SourceCatalogFileReference {
    pub fn parse(reference: &str) -> Result<Self, SourceCatalogError> {
        let suffix = reference
            .strip_prefix(SOURCE_FILE_REF_PREFIX)
            .ok_or(SourceCatalogError::InvalidFileReference)?;
        if suffix.len() != REFERENCE_SUFFIX_BYTES * 2
            || !suffix
                .as_bytes()
                .iter()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
        {
            return Err(SourceCatalogError::InvalidFileReference);
        }
        let mut decoded = [0_u8; REFERENCE_SUFFIX_BYTES];
        hex::decode_to_slice(suffix, &mut decoded)
            .map_err(|_| SourceCatalogError::InvalidFileReference)?;
        Self::from_suffix(decoded)
    }

    fn from_suffix(suffix: [u8; REFERENCE_SUFFIX_BYTES]) -> Result<Self, SourceCatalogError> {
        if suffix.iter().all(|byte| *byte == 0) {
            return Err(SourceCatalogError::InvalidFileReference);
        }
        Ok(Self { suffix })
    }

    #[must_use]
    pub const fn suffix_bytes(&self) -> &[u8; REFERENCE_SUFFIX_BYTES] {
        &self.suffix
    }

    #[must_use]
    pub fn canonical(&self) -> String {
        format!("{SOURCE_FILE_REF_PREFIX}{}", hex::encode(self.suffix))
    }
}

impl fmt::Debug for SourceCatalogFileReference {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter.write_str("SourceCatalogFileReference(<redacted>)")
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SourceCatalogError {
    Cancelled,
    WriteFailed,
    TooShort,
    TooLarge,
    InvalidMagic,
    InvalidVersion,
    InvalidHeaderSize,
    InvalidSourceKind,
    NonzeroReserved,
    InvalidCounts,
    InvalidEncodedLength,
    Truncated,
    InvalidRecordKind,
    InvalidRecordFlags,
    InvalidRecordHeaderSize,
    InvalidRecordLength,
    InvalidRecordOrder,
    DuplicateIdentity,
    InvalidComponent,
    InvalidFileReference,
    DuplicateFileReference,
    LayoutDigestMismatch,
    LayoutRejected,
    ArithmeticOverflow,
}

impl Display for SourceCatalogError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Cancelled => "source catalog operation was cancelled",
            Self::WriteFailed => "source catalog write failed",
            Self::TooShort => "source catalog is shorter than its fixed header",
            Self::TooLarge => "source catalog exceeds its encoded-size limit",
            Self::InvalidMagic => "source catalog magic is invalid",
            Self::InvalidVersion => "source catalog version is invalid",
            Self::InvalidHeaderSize => "source catalog header size is invalid",
            Self::InvalidSourceKind => "source catalog source kind is invalid",
            Self::NonzeroReserved => "source catalog reserved bytes are nonzero",
            Self::InvalidCounts => "source catalog counts are invalid",
            Self::InvalidEncodedLength => "source catalog encoded length is invalid",
            Self::Truncated => "source catalog is truncated",
            Self::InvalidRecordKind => "source catalog record kind is invalid",
            Self::InvalidRecordFlags => "source catalog record flags are invalid",
            Self::InvalidRecordHeaderSize => "source catalog record header size is invalid",
            Self::InvalidRecordLength => "source catalog record length is invalid",
            Self::InvalidRecordOrder => "source catalog record order is invalid",
            Self::DuplicateIdentity => "source catalog contains a duplicate identity",
            Self::InvalidComponent => "source catalog contains an invalid private component",
            Self::InvalidFileReference => "source catalog file reference is invalid",
            Self::DuplicateFileReference => "source catalog file reference is duplicated",
            Self::LayoutDigestMismatch => "source catalog layout digest does not match",
            Self::LayoutRejected => "source catalog layout was rejected",
            Self::ArithmeticOverflow => "source catalog size arithmetic overflowed",
        })
    }
}

impl Error for SourceCatalogError {}

#[derive(Clone, Copy, Eq, PartialEq)]
pub struct SourceCatalogWriteEvidence {
    encoded_byte_count: u64,
    catalog_sha256: Sha256Digest,
    layout_sha256: Sha256Digest,
    directory_count: u32,
    file_count: u32,
    record_count: u32,
}

impl SourceCatalogWriteEvidence {
    #[must_use]
    pub const fn encoded_byte_count(&self) -> u64 {
        self.encoded_byte_count
    }

    #[must_use]
    pub const fn catalog_sha256_digest(&self) -> Sha256Digest {
        self.catalog_sha256
    }

    #[must_use]
    pub const fn layout_sha256_digest(&self) -> Sha256Digest {
        self.layout_sha256
    }

    #[must_use]
    pub const fn record_count(&self) -> u32 {
        self.record_count
    }

    #[must_use]
    pub const fn directory_count(&self) -> u32 {
        self.directory_count
    }

    #[must_use]
    pub const fn file_count(&self) -> u32 {
        self.file_count
    }
}

impl fmt::Debug for SourceCatalogWriteEvidence {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SourceCatalogWriteEvidence")
            .field("encoded_byte_count", &self.encoded_byte_count)
            .field("directory_count", &self.directory_count)
            .field("file_count", &self.file_count)
            .field("record_count", &self.record_count)
            .field("private_catalog_sha256", &"<redacted>")
            .field("private_layout_sha256", &"<redacted>")
            .finish()
    }
}

#[derive(Clone, Copy)]
struct CatalogInputRecord<'a> {
    kind: CustodyRecordKind,
    identity: FileIdentity,
    components: &'a [Vec<u16>],
    file_size: Option<u64>,
}

trait CatalogLayout {
    fn source_kind(&self) -> SourceKind;
    fn directory_count(&self) -> u32;
    fn file_count(&self) -> u32;
    fn modeled_memory_bytes(&self) -> u64;
    fn layout_sha256(&self) -> Sha256Digest;
    fn visit_records<E>(
        &self,
        visitor: &mut dyn for<'a> FnMut(CatalogInputRecord<'a>) -> Result<(), E>,
    ) -> Result<(), E>;
}

impl CatalogLayout for SourceCatalogLayoutView<'_> {
    fn source_kind(&self) -> SourceKind {
        (*self).source_kind()
    }

    fn directory_count(&self) -> u32 {
        (*self).directory_count()
    }

    fn file_count(&self) -> u32 {
        (*self).file_count()
    }

    fn modeled_memory_bytes(&self) -> u64 {
        (*self).modeled_memory_bytes()
    }

    fn layout_sha256(&self) -> Sha256Digest {
        (*self).layout_sha256()
    }

    fn visit_records<E>(
        &self,
        visitor: &mut dyn for<'a> FnMut(CatalogInputRecord<'a>) -> Result<(), E>,
    ) -> Result<(), E> {
        for record in (*self).records() {
            visitor(input_record(record))?;
        }
        Ok(())
    }
}

fn input_record(record: SourceCatalogRecordView<'_>) -> CatalogInputRecord<'_> {
    CatalogInputRecord {
        kind: record.kind(),
        identity: record.identity(),
        components: record.relative_components(),
        file_size: record.file_size(),
    }
}

#[derive(Clone, Copy)]
struct CatalogPlan {
    source_kind: SourceKind,
    directory_count: u32,
    file_count: u32,
    record_count: u32,
    total_encoded_bytes: u64,
    layout_sha256: Sha256Digest,
}

pub fn encode_source_catalog<W, F>(
    source: &RetainedSource,
    file_references: &BTreeMap<FileIdentity, SourceCatalogFileReference>,
    writer: &mut W,
    mut is_cancelled: F,
) -> Result<SourceCatalogWriteEvidence, SourceCatalogError>
where
    W: Write,
    F: FnMut() -> bool,
{
    encode_catalog_layout(
        &source.source_catalog_layout(),
        file_references,
        writer,
        &mut is_cancelled,
    )
}

fn encode_catalog_layout<L, W, F>(
    layout: &L,
    file_references: &BTreeMap<FileIdentity, SourceCatalogFileReference>,
    writer: &mut W,
    is_cancelled: &mut F,
) -> Result<SourceCatalogWriteEvidence, SourceCatalogError>
where
    L: CatalogLayout,
    W: Write,
    F: FnMut() -> bool,
{
    let plan = plan_catalog(layout, file_references, is_cancelled)?;
    let mut output = CatalogOutput::new(writer);
    write_header(&mut output, plan, is_cancelled)?;
    layout.visit_records(&mut |record| {
        write_record(&mut output, record, file_references, is_cancelled)
    })?;
    if output.byte_count != plan.total_encoded_bytes {
        return Err(SourceCatalogError::InvalidEncodedLength);
    }
    Ok(SourceCatalogWriteEvidence {
        encoded_byte_count: output.byte_count,
        catalog_sha256: Sha256Digest::from_bytes(output.sha256.finalize().into()),
        layout_sha256: plan.layout_sha256,
        directory_count: plan.directory_count,
        file_count: plan.file_count,
        record_count: plan.record_count,
    })
}

fn plan_catalog<L, F>(
    layout: &L,
    file_references: &BTreeMap<FileIdentity, SourceCatalogFileReference>,
    is_cancelled: &mut F,
) -> Result<CatalogPlan, SourceCatalogError>
where
    L: CatalogLayout,
    F: FnMut() -> bool,
{
    check_cancelled(is_cancelled)?;
    let directory_count = layout.directory_count();
    let file_count = layout.file_count();
    let record_count = validate_counts(layout.source_kind(), directory_count, file_count)?;
    if file_references.len() != file_count as usize {
        return Err(SourceCatalogError::InvalidCounts);
    }
    if layout.modeled_memory_bytes() > DEFAULT_MAX_LAYOUT_MEMORY_BYTES {
        return Err(SourceCatalogError::TooLarge);
    }

    let mut validation = LayoutValidation::new(
        layout.source_kind(),
        directory_count,
        file_count,
        file_references,
    );
    layout.visit_records(&mut |record| validation.observe(record, is_cancelled))?;
    let (total_encoded_bytes, modeled_memory_bytes, observed_digest) =
        validation.finish(is_cancelled)?;
    if modeled_memory_bytes != layout.modeled_memory_bytes() {
        return Err(SourceCatalogError::LayoutRejected);
    }
    let layout_sha256 = layout.layout_sha256();
    if observed_digest != layout_sha256 {
        return Err(SourceCatalogError::LayoutDigestMismatch);
    }
    Ok(CatalogPlan {
        source_kind: layout.source_kind(),
        directory_count,
        file_count,
        record_count,
        total_encoded_bytes,
        layout_sha256,
    })
}

struct LayoutValidation<'a> {
    source_kind: SourceKind,
    expected_directory_count: u32,
    expected_file_count: u32,
    file_references: &'a BTreeMap<FileIdentity, SourceCatalogFileReference>,
    observed_directory_count: u32,
    observed_file_count: u32,
    root_directory_count: u32,
    previous_key: Option<(u8, FileIdentity)>,
    identities: BTreeSet<FileIdentity>,
    reference_suffixes: BTreeSet<[u8; REFERENCE_SUFFIX_BYTES]>,
    modeled_memory_bytes: u64,
    total_encoded_bytes: u64,
    digest: SourceLayoutDigestBuilder,
}

impl<'a> LayoutValidation<'a> {
    fn new(
        source_kind: SourceKind,
        directory_count: u32,
        file_count: u32,
        file_references: &'a BTreeMap<FileIdentity, SourceCatalogFileReference>,
    ) -> Self {
        Self {
            source_kind,
            expected_directory_count: directory_count,
            expected_file_count: file_count,
            file_references,
            observed_directory_count: 0,
            observed_file_count: 0,
            root_directory_count: 0,
            previous_key: None,
            identities: BTreeSet::new(),
            reference_suffixes: BTreeSet::new(),
            modeled_memory_bytes: 0,
            total_encoded_bytes: SOURCE_CATALOG_HEADER_BYTES as u64,
            digest: SourceLayoutDigestBuilder::new(source_kind, directory_count, file_count),
        }
    }

    fn observe<F>(
        &mut self,
        record: CatalogInputRecord<'_>,
        is_cancelled: &mut F,
    ) -> Result<(), SourceCatalogError>
    where
        F: FnMut() -> bool,
    {
        check_cancelled(is_cancelled)?;
        let key = (record.kind.canonical_tag(), record.identity);
        if self.previous_key.is_some_and(|previous| previous >= key) {
            return Err(SourceCatalogError::InvalidRecordOrder);
        }
        if !self.identities.insert(record.identity) {
            return Err(SourceCatalogError::DuplicateIdentity);
        }
        self.previous_key = Some(key);
        validate_components(self.source_kind, record, &mut self.root_directory_count)?;

        match record.kind {
            CustodyRecordKind::Directory => {
                self.observed_directory_count = self
                    .observed_directory_count
                    .checked_add(1)
                    .ok_or(SourceCatalogError::ArithmeticOverflow)?;
            }
            CustodyRecordKind::File => {
                self.observed_file_count = self
                    .observed_file_count
                    .checked_add(1)
                    .ok_or(SourceCatalogError::ArithmeticOverflow)?;
                let reference = self
                    .file_references
                    .get(&record.identity)
                    .ok_or(SourceCatalogError::InvalidFileReference)?;
                if !self.reference_suffixes.insert(reference.suffix) {
                    return Err(SourceCatalogError::DuplicateFileReference);
                }
            }
        }

        let modeled = modeled_layout_record_bytes_from_unit_counts(
            record
                .components
                .iter()
                .map(|component| component.len() as u64),
        )
        .map_err(|_| SourceCatalogError::LayoutRejected)?;
        self.modeled_memory_bytes = self
            .modeled_memory_bytes
            .checked_add(modeled)
            .ok_or(SourceCatalogError::ArithmeticOverflow)?;
        if self.modeled_memory_bytes > DEFAULT_MAX_LAYOUT_MEMORY_BYTES {
            return Err(SourceCatalogError::TooLarge);
        }

        let record_length = encoded_record_length(record)?;
        self.total_encoded_bytes = self
            .total_encoded_bytes
            .checked_add(u64::from(record_length))
            .ok_or(SourceCatalogError::ArithmeticOverflow)?;
        if self.total_encoded_bytes > DEFAULT_MAX_LAYOUT_MEMORY_BYTES {
            return Err(SourceCatalogError::TooLarge);
        }
        self.digest
            .update_record(
                record.kind,
                record.identity,
                record.components,
                record.file_size,
                is_cancelled,
            )
            .map_err(|_| SourceCatalogError::InvalidComponent)
    }

    fn finish<F>(self, is_cancelled: &mut F) -> Result<(u64, u64, Sha256Digest), SourceCatalogError>
    where
        F: FnMut() -> bool,
    {
        check_cancelled(is_cancelled)?;
        if self.observed_directory_count != self.expected_directory_count
            || self.observed_file_count != self.expected_file_count
            || self.reference_suffixes.len() != self.expected_file_count as usize
            || match self.source_kind {
                SourceKind::File => self.root_directory_count != 0,
                SourceKind::Folder => self.root_directory_count != 1,
            }
        {
            return Err(SourceCatalogError::InvalidCounts);
        }
        let digest = self
            .digest
            .finish(is_cancelled)
            .map_err(|_| SourceCatalogError::LayoutRejected)?;
        Ok((self.total_encoded_bytes, self.modeled_memory_bytes, digest))
    }
}

fn validate_counts(
    source_kind: SourceKind,
    directory_count: u32,
    file_count: u32,
) -> Result<u32, SourceCatalogError> {
    let record_count = directory_count
        .checked_add(file_count)
        .ok_or(SourceCatalogError::ArithmeticOverflow)?;
    if file_count as usize > DEFAULT_MAX_FILES
        || record_count as usize > DEFAULT_MAX_ENTRIES
        || match source_kind {
            SourceKind::File => directory_count != 0 || file_count != 1,
            SourceKind::Folder => directory_count == 0,
        }
    {
        return Err(SourceCatalogError::InvalidCounts);
    }
    Ok(record_count)
}

fn validate_components(
    source_kind: SourceKind,
    record: CatalogInputRecord<'_>,
    root_directory_count: &mut u32,
) -> Result<(), SourceCatalogError> {
    if record.components.len() > MAX_OPEN_DIRECTORY_DEPTH {
        return Err(SourceCatalogError::InvalidComponent);
    }
    match (record.kind, record.file_size) {
        (CustodyRecordKind::Directory, None) => {
            if record.components.is_empty() {
                if source_kind != SourceKind::Folder {
                    return Err(SourceCatalogError::InvalidComponent);
                }
                *root_directory_count = root_directory_count
                    .checked_add(1)
                    .ok_or(SourceCatalogError::ArithmeticOverflow)?;
            }
        }
        (CustodyRecordKind::File, Some(_)) if !record.components.is_empty() => {
            if source_kind == SourceKind::File && record.components.len() != 1 {
                return Err(SourceCatalogError::InvalidComponent);
            }
        }
        _ => return Err(SourceCatalogError::InvalidComponent),
    }

    let mut path_units = record.components.len().saturating_sub(1);
    for component in record.components {
        if component.is_empty() || component.len() > MAX_PRIVATE_PATH_SEGMENT_UTF16_UNITS {
            return Err(SourceCatalogError::InvalidComponent);
        }
        path_units = path_units
            .checked_add(component.len())
            .ok_or(SourceCatalogError::ArithmeticOverflow)?;
    }
    if path_units > MAX_PRIVATE_PATH_UTF16_UNITS {
        return Err(SourceCatalogError::InvalidComponent);
    }
    Ok(())
}

fn encoded_record_length(record: CatalogInputRecord<'_>) -> Result<u32, SourceCatalogError> {
    let mut length = SOURCE_CATALOG_RECORD_HEADER_BYTES as u64;
    for component in record.components {
        length = length
            .checked_add(4)
            .and_then(|value| value.checked_add((component.len() as u64).checked_mul(2)?))
            .ok_or(SourceCatalogError::ArithmeticOverflow)?;
    }
    if record.kind == CustodyRecordKind::File {
        length = length
            .checked_add(FILE_TRAILER_BYTES as u64)
            .ok_or(SourceCatalogError::ArithmeticOverflow)?;
    }
    u32::try_from(length).map_err(|_| SourceCatalogError::TooLarge)
}

struct CatalogOutput<'a, W> {
    writer: &'a mut W,
    sha256: Sha256,
    byte_count: u64,
}

impl<'a, W> CatalogOutput<'a, W>
where
    W: Write,
{
    fn new(writer: &'a mut W) -> Self {
        Self {
            writer,
            sha256: Sha256::new(),
            byte_count: 0,
        }
    }

    fn write_field<F>(
        &mut self,
        bytes: &[u8],
        is_cancelled: &mut F,
    ) -> Result<(), SourceCatalogError>
    where
        F: FnMut() -> bool,
    {
        check_cancelled(is_cancelled)?;
        self.writer
            .write_all(bytes)
            .map_err(|_| SourceCatalogError::WriteFailed)?;
        self.sha256.update(bytes);
        self.byte_count = self
            .byte_count
            .checked_add(bytes.len() as u64)
            .ok_or(SourceCatalogError::ArithmeticOverflow)?;
        Ok(())
    }
}

fn write_header<W, F>(
    output: &mut CatalogOutput<'_, W>,
    plan: CatalogPlan,
    is_cancelled: &mut F,
) -> Result<(), SourceCatalogError>
where
    W: Write,
    F: FnMut() -> bool,
{
    output.write_field(MAGIC, is_cancelled)?;
    output.write_field(&VERSION.to_be_bytes(), is_cancelled)?;
    output.write_field(
        &(SOURCE_CATALOG_HEADER_BYTES as u16).to_be_bytes(),
        is_cancelled,
    )?;
    output.write_field(&[source_kind_wire(plan.source_kind)], is_cancelled)?;
    output.write_field(&[0; 3], is_cancelled)?;
    output.write_field(&plan.directory_count.to_be_bytes(), is_cancelled)?;
    output.write_field(&plan.file_count.to_be_bytes(), is_cancelled)?;
    output.write_field(&plan.record_count.to_be_bytes(), is_cancelled)?;
    output.write_field(&0_u32.to_be_bytes(), is_cancelled)?;
    output.write_field(&plan.total_encoded_bytes.to_be_bytes(), is_cancelled)?;
    output.write_field(plan.layout_sha256.as_bytes(), is_cancelled)?;
    output.write_field(&[0; 8], is_cancelled)
}

fn write_record<W, F>(
    output: &mut CatalogOutput<'_, W>,
    record: CatalogInputRecord<'_>,
    file_references: &BTreeMap<FileIdentity, SourceCatalogFileReference>,
    is_cancelled: &mut F,
) -> Result<(), SourceCatalogError>
where
    W: Write,
    F: FnMut() -> bool,
{
    let record_length = encoded_record_length(record)?;
    output.write_field(&[record.kind.canonical_tag()], is_cancelled)?;
    output.write_field(&[0], is_cancelled)?;
    output.write_field(
        &(SOURCE_CATALOG_RECORD_HEADER_BYTES as u16).to_be_bytes(),
        is_cancelled,
    )?;
    output.write_field(&record_length.to_be_bytes(), is_cancelled)?;
    output.write_field(
        &record.identity.volume_serial_number().to_be_bytes(),
        is_cancelled,
    )?;
    output.write_field(record.identity.file_id_bytes(), is_cancelled)?;
    let component_count =
        u32::try_from(record.components.len()).map_err(|_| SourceCatalogError::TooLarge)?;
    output.write_field(&component_count.to_be_bytes(), is_cancelled)?;
    output.write_field(&0_u32.to_be_bytes(), is_cancelled)?;
    for component in record.components {
        write_component(output, component, is_cancelled)?;
    }
    if let Some(file_size) = record.file_size {
        output.write_field(&file_size.to_be_bytes(), is_cancelled)?;
        let reference = file_references
            .get(&record.identity)
            .ok_or(SourceCatalogError::InvalidFileReference)?;
        output.write_field(reference.suffix_bytes(), is_cancelled)?;
    }
    Ok(())
}

fn write_component<W, F>(
    output: &mut CatalogOutput<'_, W>,
    component: &[u16],
    is_cancelled: &mut F,
) -> Result<(), SourceCatalogError>
where
    W: Write,
    F: FnMut() -> bool,
{
    let unit_count = u32::try_from(component.len()).map_err(|_| SourceCatalogError::TooLarge)?;
    output.write_field(&unit_count.to_be_bytes(), is_cancelled)?;
    let mut buffer = [0_u8; COMPONENT_WRITE_BUFFER_BYTES];
    for units in component.chunks(buffer.len() / 2) {
        for (index, unit) in units.iter().enumerate() {
            buffer[index * 2..index * 2 + 2].copy_from_slice(&unit.to_be_bytes());
        }
        let write_result = output.write_field(&buffer[..units.len() * 2], is_cancelled);
        buffer[..units.len() * 2].fill(0);
        write_result?;
    }
    Ok(())
}

fn source_kind_wire(kind: SourceKind) -> u8 {
    match kind {
        SourceKind::File => SOURCE_KIND_FILE,
        SourceKind::Folder => SOURCE_KIND_FOLDER,
    }
}

fn source_kind_from_wire(value: u8) -> Result<SourceKind, SourceCatalogError> {
    match value {
        SOURCE_KIND_FILE => Ok(SourceKind::File),
        SOURCE_KIND_FOLDER => Ok(SourceKind::Folder),
        _ => Err(SourceCatalogError::InvalidSourceKind),
    }
}

fn check_cancelled<F>(is_cancelled: &mut F) -> Result<(), SourceCatalogError>
where
    F: FnMut() -> bool,
{
    if is_cancelled() {
        Err(SourceCatalogError::Cancelled)
    } else {
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DecodedSourceCatalogRecordKind {
    Directory,
    File,
}

impl DecodedSourceCatalogRecordKind {
    fn custody_kind(self) -> CustodyRecordKind {
        match self {
            Self::Directory => CustodyRecordKind::Directory,
            Self::File => CustodyRecordKind::File,
        }
    }

    const fn canonical_tag(self) -> u8 {
        match self {
            Self::Directory => RECORD_KIND_DIRECTORY,
            Self::File => RECORD_KIND_FILE,
        }
    }
}

#[derive(Eq, PartialEq)]
pub struct DecodedSourceCatalogRecord {
    kind: DecodedSourceCatalogRecordKind,
    identity: FileIdentity,
    relative_components: Vec<Vec<u16>>,
    expected_size: Option<u64>,
    source_file_reference: Option<SourceCatalogFileReference>,
}

impl DecodedSourceCatalogRecord {
    #[must_use]
    pub const fn kind(&self) -> DecodedSourceCatalogRecordKind {
        self.kind
    }

    #[must_use]
    pub const fn identity(&self) -> FileIdentity {
        self.identity
    }

    #[must_use]
    pub fn relative_components(&self) -> &[Vec<u16>] {
        &self.relative_components
    }

    #[must_use]
    pub const fn expected_size(&self) -> Option<u64> {
        self.expected_size
    }

    #[must_use]
    pub const fn source_file_reference(&self) -> Option<SourceCatalogFileReference> {
        self.source_file_reference
    }
}

impl fmt::Debug for DecodedSourceCatalogRecord {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DecodedSourceCatalogRecord")
            .field("kind", &self.kind)
            .field("component_count", &self.relative_components.len())
            .field("has_expected_size", &self.expected_size.is_some())
            .field(
                "has_source_file_reference",
                &self.source_file_reference.is_some(),
            )
            .field("private_identity", &"<redacted>")
            .field("private_components", &"<redacted>")
            .finish_non_exhaustive()
    }
}

impl Drop for DecodedSourceCatalogRecord {
    fn drop(&mut self) {
        for component in &mut self.relative_components {
            component.fill(0);
        }
    }
}

#[derive(Eq, PartialEq)]
pub struct DecodedSourceCatalog {
    source_kind: SourceKind,
    directory_count: u32,
    file_count: u32,
    total_encoded_bytes: u64,
    layout_sha256: Sha256Digest,
    catalog_sha256: Sha256Digest,
    records: Vec<DecodedSourceCatalogRecord>,
}

impl DecodedSourceCatalog {
    #[must_use]
    pub const fn source_kind(&self) -> SourceKind {
        self.source_kind
    }

    #[must_use]
    pub const fn directory_count(&self) -> u32 {
        self.directory_count
    }

    #[must_use]
    pub const fn file_count(&self) -> u32 {
        self.file_count
    }

    #[must_use]
    pub const fn total_encoded_bytes(&self) -> u64 {
        self.total_encoded_bytes
    }

    #[must_use]
    pub const fn layout_sha256_digest(&self) -> Sha256Digest {
        self.layout_sha256
    }

    #[must_use]
    pub const fn catalog_sha256_digest(&self) -> Sha256Digest {
        self.catalog_sha256
    }

    pub fn records(&self) -> impl ExactSizeIterator<Item = &DecodedSourceCatalogRecord> {
        self.records.iter()
    }
}

impl fmt::Debug for DecodedSourceCatalog {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DecodedSourceCatalog")
            .field("source_kind", &self.source_kind)
            .field("directory_count", &self.directory_count)
            .field("file_count", &self.file_count)
            .field("total_encoded_bytes", &self.total_encoded_bytes)
            .field("private_records", &"<redacted>")
            .field("private_layout_sha256", &"<redacted>")
            .field("private_catalog_sha256", &"<redacted>")
            .finish()
    }
}

impl Drop for DecodedSourceCatalog {
    fn drop(&mut self) {
        self.layout_sha256 = Sha256Digest::from_bytes([0; 32]);
        self.catalog_sha256 = Sha256Digest::from_bytes([0; 32]);
    }
}

pub fn decode_source_catalog(bytes: &[u8]) -> Result<DecodedSourceCatalog, SourceCatalogError> {
    if bytes.len() < SOURCE_CATALOG_HEADER_BYTES {
        return Err(SourceCatalogError::TooShort);
    }
    if bytes.len() > SOURCE_CATALOG_MAX_ENCODED_BYTES {
        return Err(SourceCatalogError::TooLarge);
    }
    if &bytes[..MAGIC.len()] != MAGIC {
        return Err(SourceCatalogError::InvalidMagic);
    }
    if read_u16(bytes, VERSION_OFFSET)? != VERSION {
        return Err(SourceCatalogError::InvalidVersion);
    }
    if usize::from(read_u16(bytes, HEADER_SIZE_OFFSET)?) != SOURCE_CATALOG_HEADER_BYTES {
        return Err(SourceCatalogError::InvalidHeaderSize);
    }
    let source_kind = source_kind_from_wire(bytes[SOURCE_KIND_OFFSET])?;
    if bytes[HEADER_RESERVED_U24_OFFSET..DIRECTORY_COUNT_OFFSET]
        .iter()
        .any(|byte| *byte != 0)
        || read_u32(bytes, HEADER_RESERVED_U32_OFFSET)? != 0
        || bytes[HEADER_RESERVED_U64_OFFSET..SOURCE_CATALOG_HEADER_BYTES]
            .iter()
            .any(|byte| *byte != 0)
    {
        return Err(SourceCatalogError::NonzeroReserved);
    }
    let directory_count = read_u32(bytes, DIRECTORY_COUNT_OFFSET)?;
    let file_count = read_u32(bytes, FILE_COUNT_OFFSET)?;
    let record_count = read_u32(bytes, RECORD_COUNT_OFFSET)?;
    let expected_record_count = validate_counts(source_kind, directory_count, file_count)?;
    if record_count != expected_record_count {
        return Err(SourceCatalogError::InvalidCounts);
    }
    let total_encoded_bytes = read_u64(bytes, TOTAL_ENCODED_BYTES_OFFSET)?;
    if total_encoded_bytes > DEFAULT_MAX_LAYOUT_MEMORY_BYTES
        || usize::try_from(total_encoded_bytes).ok() != Some(bytes.len())
    {
        return Err(SourceCatalogError::InvalidEncodedLength);
    }
    let layout_sha256 = Sha256Digest::from_bytes(read_array::<32>(bytes, LAYOUT_SHA256_OFFSET)?);

    let mut cursor = SOURCE_CATALOG_HEADER_BYTES;
    let mut records = Vec::with_capacity(record_count as usize);
    let mut previous_key = None;
    let mut identities = BTreeSet::new();
    let mut reference_suffixes = BTreeSet::new();
    let mut observed_directory_count = 0_u32;
    let mut observed_file_count = 0_u32;
    let mut root_directory_count = 0_u32;
    let mut modeled_memory_bytes = 0_u64;
    let mut digest = SourceLayoutDigestBuilder::new(source_kind, directory_count, file_count);

    for _ in 0..record_count {
        let parsed = decode_record(bytes, cursor, source_kind)?;
        let key = (parsed.record.kind.canonical_tag(), parsed.record.identity);
        if previous_key.is_some_and(|previous| previous >= key) {
            return Err(SourceCatalogError::InvalidRecordOrder);
        }
        if !identities.insert(parsed.record.identity) {
            return Err(SourceCatalogError::DuplicateIdentity);
        }
        previous_key = Some(key);
        if parsed.record.relative_components.is_empty() {
            root_directory_count = root_directory_count
                .checked_add(1)
                .ok_or(SourceCatalogError::ArithmeticOverflow)?;
        }
        match parsed.record.kind {
            DecodedSourceCatalogRecordKind::Directory => {
                observed_directory_count = observed_directory_count
                    .checked_add(1)
                    .ok_or(SourceCatalogError::ArithmeticOverflow)?;
            }
            DecodedSourceCatalogRecordKind::File => {
                observed_file_count = observed_file_count
                    .checked_add(1)
                    .ok_or(SourceCatalogError::ArithmeticOverflow)?;
                let reference = parsed
                    .record
                    .source_file_reference
                    .ok_or(SourceCatalogError::InvalidFileReference)?;
                if !reference_suffixes.insert(reference.suffix) {
                    return Err(SourceCatalogError::DuplicateFileReference);
                }
            }
        }
        let modeled = modeled_layout_record_bytes_from_unit_counts(
            parsed
                .record
                .relative_components
                .iter()
                .map(|component| component.len() as u64),
        )
        .map_err(|_| SourceCatalogError::LayoutRejected)?;
        modeled_memory_bytes = modeled_memory_bytes
            .checked_add(modeled)
            .ok_or(SourceCatalogError::ArithmeticOverflow)?;
        if modeled_memory_bytes > DEFAULT_MAX_LAYOUT_MEMORY_BYTES {
            return Err(SourceCatalogError::TooLarge);
        }
        digest
            .update_record(
                parsed.record.kind.custody_kind(),
                parsed.record.identity,
                &parsed.record.relative_components,
                parsed.record.expected_size,
                &mut || false,
            )
            .map_err(|_| SourceCatalogError::InvalidComponent)?;
        cursor = parsed.next_offset;
        records.push(parsed.record);
    }
    if cursor != bytes.len() {
        return Err(SourceCatalogError::InvalidEncodedLength);
    }
    if observed_directory_count != directory_count
        || observed_file_count != file_count
        || reference_suffixes.len() != file_count as usize
        || match source_kind {
            SourceKind::File => root_directory_count != 0,
            SourceKind::Folder => root_directory_count != 1,
        }
    {
        return Err(SourceCatalogError::InvalidCounts);
    }
    let observed_layout_sha256 = digest
        .finish(&mut || false)
        .map_err(|_| SourceCatalogError::LayoutRejected)?;
    if observed_layout_sha256 != layout_sha256 {
        return Err(SourceCatalogError::LayoutDigestMismatch);
    }
    Ok(DecodedSourceCatalog {
        source_kind,
        directory_count,
        file_count,
        total_encoded_bytes,
        layout_sha256,
        catalog_sha256: Sha256Digest::from_bytes(Sha256::digest(bytes).into()),
        records,
    })
}

struct ParsedRecord {
    record: DecodedSourceCatalogRecord,
    next_offset: usize,
}

struct PrivateComponents(Vec<Vec<u16>>);

impl Drop for PrivateComponents {
    fn drop(&mut self) {
        for component in &mut self.0 {
            component.fill(0);
        }
    }
}

fn decode_record(
    bytes: &[u8],
    offset: usize,
    source_kind: SourceKind,
) -> Result<ParsedRecord, SourceCatalogError> {
    let header_end = offset
        .checked_add(SOURCE_CATALOG_RECORD_HEADER_BYTES)
        .ok_or(SourceCatalogError::ArithmeticOverflow)?;
    if header_end > bytes.len() {
        return Err(SourceCatalogError::Truncated);
    }
    let kind = match bytes[offset + RECORD_KIND_OFFSET] {
        RECORD_KIND_DIRECTORY => DecodedSourceCatalogRecordKind::Directory,
        RECORD_KIND_FILE => DecodedSourceCatalogRecordKind::File,
        _ => return Err(SourceCatalogError::InvalidRecordKind),
    };
    if bytes[offset + RECORD_FLAGS_OFFSET] != 0 {
        return Err(SourceCatalogError::InvalidRecordFlags);
    }
    if usize::from(read_u16(bytes, offset + RECORD_HEADER_SIZE_OFFSET)?)
        != SOURCE_CATALOG_RECORD_HEADER_BYTES
    {
        return Err(SourceCatalogError::InvalidRecordHeaderSize);
    }
    if read_u32(bytes, offset + RECORD_RESERVED_U32_OFFSET)? != 0 {
        return Err(SourceCatalogError::NonzeroReserved);
    }
    let record_length = read_u32(bytes, offset + RECORD_LENGTH_OFFSET)? as usize;
    let minimum_length = SOURCE_CATALOG_RECORD_HEADER_BYTES
        + if kind == DecodedSourceCatalogRecordKind::File {
            FILE_TRAILER_BYTES
        } else {
            0
        };
    if record_length < minimum_length {
        return Err(SourceCatalogError::InvalidRecordLength);
    }
    let record_end = offset
        .checked_add(record_length)
        .ok_or(SourceCatalogError::ArithmeticOverflow)?;
    if record_end > bytes.len() {
        return Err(SourceCatalogError::Truncated);
    }
    let identity = FileIdentity::from_parts(
        read_u64(bytes, offset + RECORD_VOLUME_OFFSET)?,
        read_array::<16>(bytes, offset + RECORD_FILE_ID_OFFSET)?,
    );
    let component_count = read_u32(bytes, offset + RECORD_COMPONENT_COUNT_OFFSET)? as usize;
    if component_count > MAX_OPEN_DIRECTORY_DEPTH {
        return Err(SourceCatalogError::InvalidComponent);
    }
    if kind == DecodedSourceCatalogRecordKind::File && component_count == 0 {
        return Err(SourceCatalogError::InvalidComponent);
    }
    if source_kind == SourceKind::File && component_count != 1 {
        return Err(SourceCatalogError::InvalidComponent);
    }
    if kind == DecodedSourceCatalogRecordKind::Directory
        && component_count == 0
        && source_kind != SourceKind::Folder
    {
        return Err(SourceCatalogError::InvalidComponent);
    }

    let trailer_bytes = if kind == DecodedSourceCatalogRecordKind::File {
        FILE_TRAILER_BYTES
    } else {
        0
    };
    let payload_end = record_end
        .checked_sub(trailer_bytes)
        .ok_or(SourceCatalogError::InvalidRecordLength)?;
    let mut cursor = header_end;
    let mut components = PrivateComponents(Vec::with_capacity(component_count));
    let mut path_units = component_count.saturating_sub(1);
    for _ in 0..component_count {
        if cursor.checked_add(4).is_none_or(|end| end > payload_end) {
            return Err(SourceCatalogError::Truncated);
        }
        let unit_count = read_u32(bytes, cursor)? as usize;
        cursor += 4;
        if unit_count == 0 || unit_count > MAX_PRIVATE_PATH_SEGMENT_UTF16_UNITS {
            return Err(SourceCatalogError::InvalidComponent);
        }
        path_units = path_units
            .checked_add(unit_count)
            .ok_or(SourceCatalogError::ArithmeticOverflow)?;
        if path_units > MAX_PRIVATE_PATH_UTF16_UNITS {
            return Err(SourceCatalogError::InvalidComponent);
        }
        let component_bytes = unit_count
            .checked_mul(2)
            .ok_or(SourceCatalogError::ArithmeticOverflow)?;
        let component_end = cursor
            .checked_add(component_bytes)
            .ok_or(SourceCatalogError::ArithmeticOverflow)?;
        if component_end > payload_end {
            return Err(SourceCatalogError::Truncated);
        }
        let mut component = Vec::with_capacity(unit_count);
        for unit_offset in (cursor..component_end).step_by(2) {
            component.push(read_u16(bytes, unit_offset)?);
        }
        components.0.push(component);
        cursor = component_end;
    }
    if cursor != payload_end {
        return Err(SourceCatalogError::InvalidRecordLength);
    }

    let (expected_size, source_file_reference) = if kind == DecodedSourceCatalogRecordKind::File {
        let expected_size = read_u64(bytes, payload_end)?;
        let suffix = read_array::<REFERENCE_SUFFIX_BYTES>(bytes, payload_end + 8)?;
        (
            Some(expected_size),
            Some(SourceCatalogFileReference::from_suffix(suffix)?),
        )
    } else {
        (None, None)
    };
    Ok(ParsedRecord {
        record: DecodedSourceCatalogRecord {
            kind,
            identity,
            relative_components: std::mem::take(&mut components.0),
            expected_size,
            source_file_reference,
        },
        next_offset: record_end,
    })
}

fn read_u16(bytes: &[u8], offset: usize) -> Result<u16, SourceCatalogError> {
    Ok(u16::from_be_bytes(read_array(bytes, offset)?))
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, SourceCatalogError> {
    Ok(u32::from_be_bytes(read_array(bytes, offset)?))
}

fn read_u64(bytes: &[u8], offset: usize) -> Result<u64, SourceCatalogError> {
    Ok(u64::from_be_bytes(read_array(bytes, offset)?))
}

fn read_array<const N: usize>(bytes: &[u8], offset: usize) -> Result<[u8; N], SourceCatalogError> {
    let end = offset
        .checked_add(N)
        .ok_or(SourceCatalogError::ArithmeticOverflow)?;
    let slice = bytes
        .get(offset..end)
        .ok_or(SourceCatalogError::Truncated)?;
    let mut value = [0_u8; N];
    value.copy_from_slice(slice);
    Ok(value)
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;
    use std::io;
    use std::rc::Rc;

    use serde::Deserialize;

    use super::*;

    const VOLUME: u64 = 0x0102_0304_0506_0708;
    const ROOT_ID: [u8; 16] = [
        0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e,
        0x0f,
    ];
    const EMPTY_DIRECTORY_ID: [u8; 16] = [
        0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e,
        0x1f,
    ];
    const FILE_ID: [u8; 16] = [
        0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x2b, 0x2c, 0x2d, 0x2e,
        0x2f,
    ];
    const FILE_REFERENCE: &str = "helper_source_file_303132333435363738393a3b3c3d3e3f";

    #[derive(Deserialize)]
    struct GoldenFixture {
        format: String,
        version: u16,
        header_size_bytes: usize,
        record_header_size_bytes: usize,
        max_encoded_bytes: usize,
        vectors: Vec<GoldenVector>,
    }

    #[derive(Deserialize)]
    struct GoldenVector {
        name: String,
        source_kind: String,
        directory_count: u32,
        file_count: u32,
        record_count: u32,
        total_encoded_bytes_decimal: String,
        layout_sha256_hex: String,
        catalog_sha256_hex: String,
        source_file_ref: String,
        catalog_hex: String,
    }

    #[derive(Clone)]
    struct TestRecord {
        kind: CustodyRecordKind,
        identity: FileIdentity,
        components: Vec<Vec<u16>>,
        file_size: Option<u64>,
    }

    #[derive(Clone)]
    struct TestLayout {
        source_kind: SourceKind,
        directory_count: u32,
        file_count: u32,
        modeled_memory_bytes: u64,
        layout_sha256: Sha256Digest,
        records: Vec<TestRecord>,
    }

    impl TestLayout {
        fn new(source_kind: SourceKind, records: Vec<TestRecord>) -> Self {
            let directory_count = records
                .iter()
                .filter(|record| record.kind == CustodyRecordKind::Directory)
                .count() as u32;
            let file_count = records
                .iter()
                .filter(|record| record.kind == CustodyRecordKind::File)
                .count() as u32;
            let modeled_memory_bytes = records
                .iter()
                .map(|record| {
                    modeled_layout_record_bytes_from_unit_counts(
                        record
                            .components
                            .iter()
                            .map(|component| component.len() as u64),
                    )
                    .expect("test layout should have a modeled size")
                })
                .sum();
            let mut digest =
                SourceLayoutDigestBuilder::new(source_kind, directory_count, file_count);
            for record in &records {
                digest
                    .update_record(
                        record.kind,
                        record.identity,
                        &record.components,
                        record.file_size,
                        &mut || false,
                    )
                    .expect("test layout should digest");
            }
            let layout_sha256 = digest
                .finish(&mut || false)
                .expect("test digest should finish");
            Self {
                source_kind,
                directory_count,
                file_count,
                modeled_memory_bytes,
                layout_sha256,
                records,
            }
        }
    }

    impl CatalogLayout for TestLayout {
        fn source_kind(&self) -> SourceKind {
            self.source_kind
        }

        fn directory_count(&self) -> u32 {
            self.directory_count
        }

        fn file_count(&self) -> u32 {
            self.file_count
        }

        fn modeled_memory_bytes(&self) -> u64 {
            self.modeled_memory_bytes
        }

        fn layout_sha256(&self) -> Sha256Digest {
            self.layout_sha256
        }

        fn visit_records<E>(
            &self,
            visitor: &mut dyn for<'a> FnMut(CatalogInputRecord<'a>) -> Result<(), E>,
        ) -> Result<(), E> {
            for record in &self.records {
                visitor(CatalogInputRecord {
                    kind: record.kind,
                    identity: record.identity,
                    components: &record.components,
                    file_size: record.file_size,
                })?;
            }
            Ok(())
        }
    }

    #[test]
    fn shared_golden_vector_is_byte_exact_and_preserves_raw_utf16() {
        let fixture = golden_fixture();
        assert_eq!(fixture.format, "VNSHCAT1");
        assert_eq!(fixture.version, VERSION);
        assert_eq!(fixture.header_size_bytes, SOURCE_CATALOG_HEADER_BYTES);
        assert_eq!(
            fixture.record_header_size_bytes,
            SOURCE_CATALOG_RECORD_HEADER_BYTES
        );
        assert_eq!(fixture.max_encoded_bytes, SOURCE_CATALOG_MAX_ENCODED_BYTES);
        assert_eq!(fixture.vectors.len(), 1);
        let vector = &fixture.vectors[0];
        assert_eq!(
            vector.name,
            "folder-root-empty-directory-file-unpaired-surrogate"
        );
        assert_eq!(vector.source_kind, "folder");
        assert_eq!(vector.directory_count, 2);
        assert_eq!(vector.file_count, 1);
        assert_eq!(vector.record_count, 3);
        assert_eq!(vector.source_file_ref, FILE_REFERENCE);

        let layout = golden_layout();
        let references = golden_references();
        let mut encoded = Vec::new();
        let evidence = encode_catalog_layout(&layout, &references, &mut encoded, &mut || false)
            .expect("golden catalog should encode");
        assert_eq!(hex::encode(&encoded), vector.catalog_hex);
        assert_eq!(
            evidence.encoded_byte_count().to_string(),
            vector.total_encoded_bytes_decimal
        );
        assert_eq!(evidence.directory_count(), vector.directory_count);
        assert_eq!(evidence.file_count(), vector.file_count);
        assert_eq!(evidence.record_count(), vector.record_count);
        assert_eq!(
            hex::encode(evidence.layout_sha256_digest().as_bytes()),
            vector.layout_sha256_hex
        );
        assert_eq!(
            hex::encode(evidence.catalog_sha256_digest().as_bytes()),
            vector.catalog_sha256_hex
        );

        let decoded = decode_source_catalog(&encoded).expect("golden catalog should decode");
        assert_eq!(decoded.source_kind(), SourceKind::Folder);
        assert_eq!(decoded.directory_count(), 2);
        assert_eq!(decoded.file_count(), 1);
        assert_eq!(
            hex::encode(decoded.catalog_sha256_digest().as_bytes()),
            vector.catalog_sha256_hex
        );
        let records = decoded.records().collect::<Vec<_>>();
        assert_eq!(records.len(), 3);
        assert!(records[0].relative_components().is_empty());
        assert_eq!(
            records[1].relative_components(),
            &[vec![0x0045, 0xd800, 0x006d, 0x0070, 0x0074, 0x0079]]
        );
        assert_eq!(records[2].expected_size(), Some(3));
        assert_eq!(
            records[2]
                .source_file_reference()
                .expect("file reference")
                .canonical(),
            FILE_REFERENCE
        );
    }

    #[test]
    fn direct_file_catalog_roundtrips_with_exact_leaf_and_reference() {
        let identity = FileIdentity::from_parts(VOLUME, FILE_ID);
        let layout = TestLayout::new(
            SourceKind::File,
            vec![TestRecord {
                kind: CustodyRecordKind::File,
                identity,
                components: vec!["single.bin".encode_utf16().collect()],
                file_size: Some(0),
            }],
        );
        let reference = SourceCatalogFileReference::parse(FILE_REFERENCE).expect("reference");
        let references = BTreeMap::from([(identity, reference)]);
        let mut encoded = Vec::new();
        encode_catalog_layout(&layout, &references, &mut encoded, &mut || false)
            .expect("file catalog should encode");
        let decoded = decode_source_catalog(&encoded).expect("file catalog should decode");
        assert_eq!(decoded.source_kind(), SourceKind::File);
        assert_eq!(decoded.directory_count(), 0);
        assert_eq!(decoded.file_count(), 1);
        let record = decoded.records().next().expect("file record");
        assert_eq!(record.relative_components().len(), 1);
        assert_eq!(record.expected_size(), Some(0));
        assert_eq!(record.source_file_reference(), Some(reference));
    }

    #[test]
    fn references_require_exact_lowercase_nonzero_suffixes() {
        for invalid in [
            "helper_source_file_00000000000000000000000000000000",
            "helper_source_file_303132333435363738393A3B3C3D3E3F",
            "helper_source_303132333435363738393a3b3c3d3e3f",
            "helper_source_file_303132333435363738393a3b3c3d3e",
        ] {
            assert_eq!(
                SourceCatalogFileReference::parse(invalid),
                Err(SourceCatalogError::InvalidFileReference)
            );
        }
        let valid = SourceCatalogFileReference::parse(FILE_REFERENCE).expect("valid reference");
        assert_eq!(valid.canonical(), FILE_REFERENCE);
        assert_eq!(
            format!("{valid:?}"),
            "SourceCatalogFileReference(<redacted>)"
        );
    }

    #[test]
    fn decoder_rejects_hostile_fixed_headers_counts_and_sizes() {
        let valid = golden_bytes();
        assert_eq!(
            decode_source_catalog(&valid[..SOURCE_CATALOG_HEADER_BYTES - 1]),
            Err(SourceCatalogError::TooShort)
        );
        assert_eq!(
            decode_source_catalog(&vec![0; SOURCE_CATALOG_MAX_ENCODED_BYTES + 1]),
            Err(SourceCatalogError::TooLarge)
        );
        let cases = [
            (mutated(&valid, 0, b'X'), SourceCatalogError::InvalidMagic),
            (
                mutated(&valid, VERSION_OFFSET + 1, 2),
                SourceCatalogError::InvalidVersion,
            ),
            (
                mutated(&valid, HEADER_SIZE_OFFSET + 1, 79),
                SourceCatalogError::InvalidHeaderSize,
            ),
            (
                mutated(&valid, SOURCE_KIND_OFFSET, 3),
                SourceCatalogError::InvalidSourceKind,
            ),
            (
                mutated(&valid, HEADER_RESERVED_U24_OFFSET, 1),
                SourceCatalogError::NonzeroReserved,
            ),
            (
                mutated(&valid, HEADER_RESERVED_U32_OFFSET + 3, 1),
                SourceCatalogError::NonzeroReserved,
            ),
            (
                mutated(&valid, HEADER_RESERVED_U64_OFFSET + 7, 1),
                SourceCatalogError::NonzeroReserved,
            ),
        ];
        for (bytes, expected) in cases {
            assert_eq!(decode_source_catalog(&bytes), Err(expected));
        }

        let mut bad_record_count = valid.clone();
        write_u32(&mut bad_record_count, RECORD_COUNT_OFFSET, 4);
        assert_eq!(
            decode_source_catalog(&bad_record_count),
            Err(SourceCatalogError::InvalidCounts)
        );
        let mut bad_total = valid.clone();
        write_u64(
            &mut bad_total,
            TOTAL_ENCODED_BYTES_OFFSET,
            valid.len() as u64 - 1,
        );
        assert_eq!(
            decode_source_catalog(&bad_total),
            Err(SourceCatalogError::InvalidEncodedLength)
        );
    }

    #[test]
    fn decoder_rejects_truncation_and_every_record_header_violation() {
        let valid = golden_bytes();
        let root_offset = SOURCE_CATALOG_HEADER_BYTES;
        let cases = [
            (
                mutated(&valid, root_offset + RECORD_KIND_OFFSET, 3),
                SourceCatalogError::InvalidRecordKind,
            ),
            (
                mutated(&valid, root_offset + RECORD_FLAGS_OFFSET, 1),
                SourceCatalogError::InvalidRecordFlags,
            ),
            (
                mutated(&valid, root_offset + RECORD_HEADER_SIZE_OFFSET + 1, 39),
                SourceCatalogError::InvalidRecordHeaderSize,
            ),
            (
                mutated(&valid, root_offset + RECORD_RESERVED_U32_OFFSET + 3, 1),
                SourceCatalogError::NonzeroReserved,
            ),
        ];
        for (bytes, expected) in cases {
            assert_eq!(decode_source_catalog(&bytes), Err(expected));
        }

        let mut short_record = valid.clone();
        write_u32(&mut short_record, root_offset + RECORD_LENGTH_OFFSET, 39);
        assert_eq!(
            decode_source_catalog(&short_record),
            Err(SourceCatalogError::InvalidRecordLength)
        );

        let mut truncated = valid[..valid.len() - 1].to_vec();
        let truncated_len = truncated.len() as u64;
        write_u64(&mut truncated, TOTAL_ENCODED_BYTES_OFFSET, truncated_len);
        assert_eq!(
            decode_source_catalog(&truncated),
            Err(SourceCatalogError::Truncated)
        );
    }

    #[test]
    fn decoder_rejects_order_identity_reference_and_digest_attacks() {
        let valid = golden_bytes();
        let second_record_offset = SOURCE_CATALOG_HEADER_BYTES + 40;
        let file_record_offset = second_record_offset + 56;

        let mut out_of_order = valid.clone();
        out_of_order[second_record_offset + RECORD_FILE_ID_OFFSET
            ..second_record_offset + RECORD_FILE_ID_OFFSET + 16]
            .fill(0);
        assert_eq!(
            decode_source_catalog(&out_of_order),
            Err(SourceCatalogError::InvalidRecordOrder)
        );

        let mut duplicate_identity = valid.clone();
        duplicate_identity[file_record_offset + RECORD_FILE_ID_OFFSET
            ..file_record_offset + RECORD_FILE_ID_OFFSET + 16]
            .copy_from_slice(&ROOT_ID);
        assert_eq!(
            decode_source_catalog(&duplicate_identity),
            Err(SourceCatalogError::DuplicateIdentity)
        );

        let mut zero_reference = valid.clone();
        zero_reference[valid.len() - REFERENCE_SUFFIX_BYTES..].fill(0);
        assert_eq!(
            decode_source_catalog(&zero_reference),
            Err(SourceCatalogError::InvalidFileReference)
        );

        let mut bad_digest = valid;
        bad_digest[LAYOUT_SHA256_OFFSET] ^= 1;
        assert_eq!(
            decode_source_catalog(&bad_digest),
            Err(SourceCatalogError::LayoutDigestMismatch)
        );
    }

    #[test]
    fn encoder_and_decoder_reject_duplicate_file_references() {
        let root = TestRecord {
            kind: CustodyRecordKind::Directory,
            identity: FileIdentity::from_parts(VOLUME, ROOT_ID),
            components: Vec::new(),
            file_size: None,
        };
        let first = TestRecord {
            kind: CustodyRecordKind::File,
            identity: FileIdentity::from_parts(VOLUME, FILE_ID),
            components: vec!["a.bin".encode_utf16().collect()],
            file_size: Some(1),
        };
        let second_identity = FileIdentity::from_parts(VOLUME, [0x40; 16]);
        let second = TestRecord {
            kind: CustodyRecordKind::File,
            identity: second_identity,
            components: vec!["b.bin".encode_utf16().collect()],
            file_size: Some(1),
        };
        let layout = TestLayout::new(SourceKind::Folder, vec![root, first, second]);
        let reference = SourceCatalogFileReference::parse(FILE_REFERENCE).expect("reference");
        let duplicate_references = BTreeMap::from([
            (FileIdentity::from_parts(VOLUME, FILE_ID), reference),
            (second_identity, reference),
        ]);
        let mut writer = Vec::new();
        assert_eq!(
            encode_catalog_layout(&layout, &duplicate_references, &mut writer, &mut || false,),
            Err(SourceCatalogError::DuplicateFileReference)
        );
        assert!(
            writer.is_empty(),
            "size/reference proof must precede writes"
        );

        let other_reference = SourceCatalogFileReference::parse(
            "helper_source_file_505152535455565758595a5b5c5d5e5f",
        )
        .expect("second reference");
        let valid_references = BTreeMap::from([
            (FileIdentity::from_parts(VOLUME, FILE_ID), reference),
            (second_identity, other_reference),
        ]);
        encode_catalog_layout(&layout, &valid_references, &mut writer, &mut || false)
            .expect("two-file catalog");
        let file_offsets = file_record_offsets(&writer);
        assert_eq!(file_offsets.len(), 2);
        let first_suffix = writer[file_offsets[0].1 - 16..file_offsets[0].1].to_vec();
        writer[file_offsets[1].1 - 16..file_offsets[1].1].copy_from_slice(&first_suffix);
        assert_eq!(
            decode_source_catalog(&writer),
            Err(SourceCatalogError::DuplicateFileReference)
        );
    }

    #[test]
    fn encoder_rejects_bad_layouts_and_oversize_before_writing() {
        let references = golden_references();
        let mut bad_order = golden_layout();
        bad_order.records.swap(0, 1);
        let mut writer = Vec::new();
        assert_eq!(
            encode_catalog_layout(&bad_order, &references, &mut writer, &mut || false,),
            Err(SourceCatalogError::InvalidRecordOrder)
        );
        assert!(writer.is_empty());

        let mut no_root = golden_layout();
        no_root.records[0].components = vec!["not-root".encode_utf16().collect()];
        assert_eq!(
            encode_catalog_layout(&no_root, &references, &mut writer, &mut || false),
            Err(SourceCatalogError::InvalidCounts)
        );
        assert!(writer.is_empty());

        let mut oversize = golden_layout();
        oversize.modeled_memory_bytes = DEFAULT_MAX_LAYOUT_MEMORY_BYTES + 1;
        assert_eq!(
            encode_catalog_layout(&oversize, &references, &mut writer, &mut || false),
            Err(SourceCatalogError::TooLarge)
        );
        assert!(writer.is_empty());
    }

    #[test]
    fn cancellation_is_checked_before_and_during_incremental_writes() {
        let layout = golden_layout();
        let references = golden_references();
        let mut writer = Vec::new();
        assert_eq!(
            encode_catalog_layout(&layout, &references, &mut writer, &mut || true),
            Err(SourceCatalogError::Cancelled)
        );
        assert!(writer.is_empty());

        let wrote = Rc::new(Cell::new(false));
        let mut signalling = SignallingWriter {
            bytes: Vec::new(),
            wrote: Rc::clone(&wrote),
        };
        assert_eq!(
            encode_catalog_layout(&layout, &references, &mut signalling, &mut || wrote.get(),),
            Err(SourceCatalogError::Cancelled)
        );
        assert_eq!(signalling.bytes, MAGIC);
    }

    #[test]
    fn writer_failures_are_fixed_and_streaming_writes_are_bounded() {
        let layout = golden_layout();
        let references = golden_references();
        let mut failing = FailingWriter {
            bytes: Vec::new(),
            limit: 20,
        };
        assert_eq!(
            encode_catalog_layout(&layout, &references, &mut failing, &mut || false,),
            Err(SourceCatalogError::WriteFailed)
        );
        assert_eq!(failing.bytes.len(), 20);

        let mut bounded = BoundedWriter::default();
        let evidence = encode_catalog_layout(&layout, &references, &mut bounded, &mut || false)
            .expect("bounded writer");
        assert_eq!(bounded.bytes.len() as u64, evidence.encoded_byte_count());
        assert!(bounded.maximum_write <= COMPONENT_WRITE_BUFFER_BYTES);
        assert!(bounded.maximum_write < bounded.bytes.len());
    }

    #[test]
    fn decoded_and_evidence_debug_output_is_redacted() {
        let bytes = golden_bytes();
        let decoded = decode_source_catalog(&bytes).expect("golden decode");
        let decoded_debug = format!("{decoded:?}");
        let record_debug = format!("{:?}", decoded.records().nth(1).expect("record"));
        for private in ["d800", FILE_REFERENCE, "b2976137", "30313233"] {
            assert!(!decoded_debug.contains(private));
            assert!(!record_debug.contains(private));
        }

        let layout = golden_layout();
        let mut writer = Vec::new();
        let evidence =
            encode_catalog_layout(&layout, &golden_references(), &mut writer, &mut || false)
                .expect("evidence");
        let evidence_debug = format!("{evidence:?}");
        assert!(evidence_debug.contains("record_count: 3"));
        assert!(!evidence_debug.contains("b2976137"));
        assert!(!evidence_debug.contains("883abdb8"));
    }

    fn golden_fixture() -> GoldenFixture {
        serde_json::from_str(include_str!("../test-vectors/vnshcat1-golden-vectors.json"))
            .expect("golden fixture should parse")
    }

    fn golden_bytes() -> Vec<u8> {
        hex::decode(&golden_fixture().vectors[0].catalog_hex).expect("golden hex")
    }

    fn golden_layout() -> TestLayout {
        TestLayout::new(
            SourceKind::Folder,
            vec![
                TestRecord {
                    kind: CustodyRecordKind::Directory,
                    identity: FileIdentity::from_parts(VOLUME, ROOT_ID),
                    components: Vec::new(),
                    file_size: None,
                },
                TestRecord {
                    kind: CustodyRecordKind::Directory,
                    identity: FileIdentity::from_parts(VOLUME, EMPTY_DIRECTORY_ID),
                    components: vec![vec![0x0045, 0xd800, 0x006d, 0x0070, 0x0074, 0x0079]],
                    file_size: None,
                },
                TestRecord {
                    kind: CustodyRecordKind::File,
                    identity: FileIdentity::from_parts(VOLUME, FILE_ID),
                    components: vec!["file.bin".encode_utf16().collect()],
                    file_size: Some(3),
                },
            ],
        )
    }

    fn golden_references() -> BTreeMap<FileIdentity, SourceCatalogFileReference> {
        BTreeMap::from([(
            FileIdentity::from_parts(VOLUME, FILE_ID),
            SourceCatalogFileReference::parse(FILE_REFERENCE).expect("golden reference"),
        )])
    }

    fn mutated(bytes: &[u8], offset: usize, value: u8) -> Vec<u8> {
        let mut result = bytes.to_vec();
        result[offset] = value;
        result
    }

    fn write_u32(bytes: &mut [u8], offset: usize, value: u32) {
        bytes[offset..offset + 4].copy_from_slice(&value.to_be_bytes());
    }

    fn write_u64(bytes: &mut [u8], offset: usize, value: u64) {
        bytes[offset..offset + 8].copy_from_slice(&value.to_be_bytes());
    }

    fn file_record_offsets(bytes: &[u8]) -> Vec<(usize, usize)> {
        let record_count = read_u32(bytes, RECORD_COUNT_OFFSET).expect("record count");
        let mut cursor = SOURCE_CATALOG_HEADER_BYTES;
        let mut offsets = Vec::new();
        for _ in 0..record_count {
            let length = read_u32(bytes, cursor + RECORD_LENGTH_OFFSET).expect("length") as usize;
            let end = cursor + length;
            if bytes[cursor + RECORD_KIND_OFFSET] == RECORD_KIND_FILE {
                offsets.push((cursor, end));
            }
            cursor = end;
        }
        offsets
    }

    struct SignallingWriter {
        bytes: Vec<u8>,
        wrote: Rc<Cell<bool>>,
    }

    impl Write for SignallingWriter {
        fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
            self.bytes.extend_from_slice(buffer);
            self.wrote.set(true);
            Ok(buffer.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    struct FailingWriter {
        bytes: Vec<u8>,
        limit: usize,
    }

    impl Write for FailingWriter {
        fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
            if self.bytes.len() == self.limit {
                return Err(io::Error::other("private writer failure"));
            }
            let writable = (self.limit - self.bytes.len()).min(buffer.len());
            self.bytes.extend_from_slice(&buffer[..writable]);
            Ok(writable)
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    #[derive(Default)]
    struct BoundedWriter {
        bytes: Vec<u8>,
        maximum_write: usize,
    }

    impl Write for BoundedWriter {
        fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
            self.maximum_write = self.maximum_write.max(buffer.len());
            self.bytes.extend_from_slice(buffer);
            Ok(buffer.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }
}
