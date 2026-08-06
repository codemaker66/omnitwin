use std::collections::{BTreeMap, BTreeSet};
use std::ffi::c_void;
use std::fmt;
use std::mem::{align_of, offset_of, size_of};
use std::ptr;
use std::rc::Rc;

use sha2::{Digest, Sha256};
use windows::core::{HRESULT, PCWSTR};
use windows::Wdk::Foundation::OBJECT_ATTRIBUTES;
use windows::Wdk::Storage::FileSystem::{
    NtCreateFile, FILE_DIRECTORY_FILE, FILE_NON_DIRECTORY_FILE, FILE_OPEN,
    FILE_SYNCHRONOUS_IO_NONALERT, NTCREATEFILE_CREATE_OPTIONS,
};
use windows::Win32::Foundation::{
    CloseHandle, ERROR_NO_MORE_FILES, HANDLE, OBJ_CASE_INSENSITIVE, OBJ_DONT_REPARSE,
    UNICODE_STRING,
};
use windows::Win32::Storage::FileSystem::{
    FileAttributeTagInfo, FileBasicInfo, FileIdExtdDirectoryInfo, FileIdExtdDirectoryRestartInfo,
    FileIdInfo, FileStandardInfo, GetDriveTypeW, GetFileInformationByHandleEx, GetFileType,
    GetFinalPathNameByHandleW, GetVolumePathNameW, QueryDosDeviceW, ReadFile,
    FILE_ATTRIBUTE_REPARSE_POINT, FILE_ATTRIBUTE_TAG_INFO, FILE_BASIC_INFO,
    FILE_FLAGS_AND_ATTRIBUTES, FILE_ID_EXTD_DIR_INFO, FILE_ID_INFO, FILE_LIST_DIRECTORY,
    FILE_NAME_NORMALIZED, FILE_READ_ATTRIBUTES, FILE_READ_DATA, FILE_SHARE_DELETE, FILE_SHARE_READ,
    FILE_SHARE_WRITE, FILE_STANDARD_INFO, FILE_TRAVERSE, FILE_TYPE_DISK, SYNCHRONIZE,
    VOLUME_NAME_DOS,
};
use windows::Win32::System::WindowsProgramming::{DRIVE_FIXED, DRIVE_REMOVABLE};
use windows::Win32::System::IO::IO_STATUS_BLOCK;

use crate::path::{
    CanonicalDosPath, MAX_PRIVATE_PATH_SEGMENT_UTF16_UNITS, MAX_PRIVATE_PATH_UTF16_UNITS,
};

pub const DEFAULT_MAX_FILES: usize = 100_000;
pub const DEFAULT_MAX_ENTRIES: usize = 200_000;
pub const DEFAULT_MAX_BYTES: u64 = 4 * 1024 * 1024 * 1024 * 1024;
/// Hard cap for the conservative private-layout memory model. This is not an
/// allocator measurement: each retained record is charged 128 bytes and each
/// repeated path component is charged 64 bytes plus its 16-byte-aligned UTF-16
/// storage. The same 80 MiB cap is also enforced across a complete session.
pub const DEFAULT_MAX_LAYOUT_MEMORY_BYTES: u64 = 80 * 1024 * 1024;
pub const MAX_OPEN_DIRECTORY_DEPTH: usize = 1_024;
pub const MAX_READ_CHUNK_BYTES: usize = 1024 * 1024;

const DIRECTORY_BUFFER_BYTES: usize = 64 * 1024;
const DOS_DEVICE_BUFFER_UNITS: usize = 32_768;
const NT_DOS_PREFIX: &[u16] = &[0x5c, b'?' as u16, b'?' as u16, 0x5c];
const FINAL_DOS_PREFIX: &[u16] = &[0x5c, 0x5c, b'?' as u16, 0x5c];
const SOURCE_READ_DIGEST_DOMAIN: &[u8] = b"OMNITWIN.WINDOWS_SOURCE_HELPER.SOURCE_READ.V1\0";
const SOURCE_LAYOUT_DIGEST_DOMAIN: &[u8] = b"VNSH-LAYOUT-V1\0";
const SOURCE_LAYOUT_SOURCE_FILE_TAG: u8 = 1;
const SOURCE_LAYOUT_SOURCE_FOLDER_TAG: u8 = 2;
const SOURCE_LAYOUT_DIRECTORY_RECORD_TAG: u8 = 1;
const SOURCE_LAYOUT_FILE_RECORD_TAG: u8 = 2;
const SOURCE_LAYOUT_MODELED_RECORD_BYTES: u64 = 128;
const SOURCE_LAYOUT_MODELED_COMPONENT_BYTES: u64 = 64;
const SOURCE_LAYOUT_MODELED_ALIGNMENT_BYTES: u64 = 16;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct FileIdentity {
    volume_serial: u64,
    file_id: [u8; 16],
}

impl FileIdentity {
    #[must_use]
    pub const fn from_parts(volume_serial: u64, file_id: [u8; 16]) -> Self {
        Self {
            volume_serial,
            file_id,
        }
    }

    #[must_use]
    pub const fn volume_serial_number(&self) -> u64 {
        self.volume_serial
    }

    #[must_use]
    pub const fn file_id_bytes(&self) -> &[u8; 16] {
        &self.file_id
    }

    #[must_use]
    pub fn volume_serial_hex(&self) -> String {
        format!("{:016X}", self.volume_serial)
    }

    #[must_use]
    pub fn file_id_hex(&self) -> String {
        hex::encode_upper(self.file_id)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Sha256Digest([u8; 32]);

impl Sha256Digest {
    #[must_use]
    pub const fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    #[must_use]
    pub const fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    #[must_use]
    pub fn canonical(&self) -> String {
        let mut value = String::with_capacity(71);
        value.push_str("sha256:");
        value.push_str(&hex::encode(self.0));
        value
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SourceKind {
    File,
    Folder,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LocalDriveKind {
    Fixed,
    Removable,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DosDeviceMapping {
    DirectHarddiskVolume,
}

/// Path-free evidence that an opened handle was corroborated against a direct
/// local drive-letter mapping.
///
/// This records only the proof result needed by the private controller. It
/// deliberately does not retain or expose the drive letter, DOS-device target,
/// canonical path, or any other user-identifying locator.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct LocalVolumeEvidence {
    corroborated_volume_serial: u64,
    drive_kind: LocalDriveKind,
    dos_device_mapping: DosDeviceMapping,
}

impl LocalVolumeEvidence {
    #[must_use]
    pub const fn corroborated_volume_serial(&self) -> u64 {
        self.corroborated_volume_serial
    }

    #[must_use]
    pub const fn drive_kind(&self) -> LocalDriveKind {
        self.drive_kind
    }

    #[must_use]
    pub const fn dos_device_mapping(&self) -> DosDeviceMapping {
        self.dos_device_mapping
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct InventoryLimits {
    pub max_files: usize,
    pub max_entries: usize,
    pub max_total_bytes: u64,
    pub max_layout_memory_bytes: u64,
}

impl Default for InventoryLimits {
    fn default() -> Self {
        Self {
            max_files: DEFAULT_MAX_FILES,
            max_entries: DEFAULT_MAX_ENTRIES,
            max_total_bytes: DEFAULT_MAX_BYTES,
            max_layout_memory_bytes: DEFAULT_MAX_LAYOUT_MEMORY_BYTES,
        }
    }
}

#[derive(Debug)]
pub struct SourceInventory {
    root_identity: FileIdentity,
    directories: BTreeSet<FileIdentity>,
    files: BTreeMap<FileIdentity, u64>,
    total_bytes: u64,
    layout: SourceLayout,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
enum SourceLayoutRecordKind {
    Directory,
    File,
}

impl SourceLayoutRecordKind {
    const fn canonical_tag(self) -> u8 {
        match self {
            Self::Directory => SOURCE_LAYOUT_DIRECTORY_RECORD_TAG,
            Self::File => SOURCE_LAYOUT_FILE_RECORD_TAG,
        }
    }
}

#[derive(Eq, PartialEq)]
struct SourceLayoutRecord {
    kind: SourceLayoutRecordKind,
    identity: FileIdentity,
    relative_components: Vec<Vec<u16>>,
    file_size: Option<u64>,
}

#[derive(Eq, PartialEq)]
struct SourceLayout {
    records: BTreeMap<(u8, FileIdentity), SourceLayoutRecord>,
    directory_count: u32,
    file_count: u32,
    modeled_memory_bytes: u64,
    sha256: Sha256Digest,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum SourceCatalogRecordKind {
    Directory,
    File,
}

impl SourceCatalogRecordKind {
    pub(crate) const fn canonical_tag(self) -> u8 {
        match self {
            Self::Directory => SOURCE_LAYOUT_DIRECTORY_RECORD_TAG,
            Self::File => SOURCE_LAYOUT_FILE_RECORD_TAG,
        }
    }
}

#[derive(Clone, Copy)]
pub(crate) struct SourceCatalogRecordView<'a> {
    record: &'a SourceLayoutRecord,
}

impl fmt::Debug for SourceCatalogRecordView<'_> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SourceCatalogRecordView")
            .field("kind", &self.kind())
            .field("component_count", &self.relative_components().len())
            .field("private_identity", &"<redacted>")
            .field("private_components", &"<redacted>")
            .finish_non_exhaustive()
    }
}

impl<'a> SourceCatalogRecordView<'a> {
    pub(crate) const fn kind(self) -> SourceCatalogRecordKind {
        match self.record.kind {
            SourceLayoutRecordKind::Directory => SourceCatalogRecordKind::Directory,
            SourceLayoutRecordKind::File => SourceCatalogRecordKind::File,
        }
    }

    pub(crate) const fn identity(self) -> FileIdentity {
        self.record.identity
    }

    pub(crate) fn relative_components(self) -> &'a [Vec<u16>] {
        &self.record.relative_components
    }

    pub(crate) const fn file_size(self) -> Option<u64> {
        self.record.file_size
    }
}

#[derive(Clone, Copy)]
pub(crate) struct SourceCatalogLayoutView<'a> {
    source_kind: SourceKind,
    layout: &'a SourceLayout,
}

impl fmt::Debug for SourceCatalogLayoutView<'_> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SourceCatalogLayoutView")
            .field("source_kind", &self.source_kind)
            .field("directory_count", &self.layout.directory_count)
            .field("file_count", &self.layout.file_count)
            .field("private_records", &"<redacted>")
            .field("private_sha256", &"<redacted>")
            .finish()
    }
}

impl<'a> SourceCatalogLayoutView<'a> {
    pub(crate) const fn source_kind(self) -> SourceKind {
        self.source_kind
    }

    pub(crate) const fn directory_count(self) -> u32 {
        self.layout.directory_count
    }

    pub(crate) const fn file_count(self) -> u32 {
        self.layout.file_count
    }

    pub(crate) const fn modeled_memory_bytes(self) -> u64 {
        self.layout.modeled_memory_bytes
    }

    pub(crate) const fn layout_sha256(self) -> Sha256Digest {
        self.layout.sha256
    }

    pub(crate) fn records(self) -> impl ExactSizeIterator<Item = SourceCatalogRecordView<'a>> + 'a {
        self.layout
            .records
            .values()
            .map(|record| SourceCatalogRecordView { record })
    }
}

impl SourceLayout {
    fn matches_with_cancellation<F>(
        &self,
        other: &Self,
        is_cancelled: &mut F,
    ) -> Result<bool, CustodyError>
    where
        F: FnMut() -> bool,
    {
        check_cancelled(is_cancelled)?;
        if self.directory_count != other.directory_count
            || self.file_count != other.file_count
            || self.modeled_memory_bytes != other.modeled_memory_bytes
            || self.sha256 != other.sha256
            || self.records.len() != other.records.len()
        {
            return Ok(false);
        }
        for ((left_key, left), (right_key, right)) in self.records.iter().zip(&other.records) {
            check_cancelled(is_cancelled)?;
            if left_key != right_key
                || left.kind != right.kind
                || left.identity != right.identity
                || left.file_size != right.file_size
                || left.relative_components.len() != right.relative_components.len()
            {
                return Ok(false);
            }
            for (left_component, right_component) in left
                .relative_components
                .iter()
                .zip(&right.relative_components)
            {
                check_cancelled(is_cancelled)?;
                if left_component != right_component {
                    return Ok(false);
                }
            }
        }
        check_cancelled(is_cancelled)?;
        Ok(true)
    }
}

impl fmt::Debug for SourceLayout {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SourceLayout")
            .field("directory_count", &self.directory_count)
            .field("file_count", &self.file_count)
            .field("private_records", &"<redacted>")
            .field("private_sha256", &"<redacted>")
            .finish()
    }
}

impl Drop for SourceLayout {
    fn drop(&mut self) {
        for record in self.records.values_mut() {
            for component in &mut record.relative_components {
                component.fill(0);
            }
        }
        self.sha256 = Sha256Digest::from_bytes([0; 32]);
    }
}

struct SourceLayoutBuilder {
    records: BTreeMap<(u8, FileIdentity), SourceLayoutRecord>,
    identities: BTreeSet<FileIdentity>,
    modeled_memory_bytes: u64,
    max_modeled_memory_bytes: u64,
}

impl SourceLayoutBuilder {
    fn new(max_modeled_memory_bytes: u64) -> Self {
        Self {
            records: BTreeMap::new(),
            identities: BTreeSet::new(),
            modeled_memory_bytes: 0,
            max_modeled_memory_bytes,
        }
    }

    fn add_directory(
        &mut self,
        identity: FileIdentity,
        relative_components: Vec<Vec<u16>>,
    ) -> Result<(), CustodyError> {
        self.add_record(SourceLayoutRecord {
            kind: SourceLayoutRecordKind::Directory,
            identity,
            relative_components,
            file_size: None,
        })
    }

    fn add_file(
        &mut self,
        identity: FileIdentity,
        relative_components: Vec<Vec<u16>>,
        file_size: u64,
    ) -> Result<(), CustodyError> {
        if relative_components.is_empty() {
            return Err(CustodyError::PrivatePathRejected);
        }
        self.add_record(SourceLayoutRecord {
            kind: SourceLayoutRecordKind::File,
            identity,
            relative_components,
            file_size: Some(file_size),
        })
    }

    fn add_record(&mut self, record: SourceLayoutRecord) -> Result<(), CustodyError> {
        if self.identities.contains(&record.identity) {
            return Err(CustodyError::DuplicateIdentity);
        }
        let record_bytes = modeled_layout_record_bytes(&record.relative_components)?;
        let modeled_memory_bytes = self
            .modeled_memory_bytes
            .checked_add(record_bytes)
            .ok_or(CustodyError::LayoutMemoryLimitExceeded)?;
        if modeled_memory_bytes > self.max_modeled_memory_bytes {
            return Err(CustodyError::LayoutMemoryLimitExceeded);
        }
        let key = (record.kind.canonical_tag(), record.identity);
        if self.records.contains_key(&key) {
            return Err(CustodyError::DuplicateIdentity);
        }
        self.identities.insert(record.identity);
        self.records.insert(key, record);
        self.modeled_memory_bytes = modeled_memory_bytes;
        Ok(())
    }

    fn finish<F>(
        self,
        source_kind: SourceKind,
        is_cancelled: &mut F,
    ) -> Result<SourceLayout, CustodyError>
    where
        F: FnMut() -> bool,
    {
        let directory_count = u32::try_from(
            self.records
                .values()
                .filter(|record| record.kind == SourceLayoutRecordKind::Directory)
                .count(),
        )
        .map_err(|_| CustodyError::EntryLimitExceeded)?;
        let file_count = u32::try_from(
            self.records
                .values()
                .filter(|record| record.kind == SourceLayoutRecordKind::File)
                .count(),
        )
        .map_err(|_| CustodyError::FileLimitExceeded)?;
        let sha256 = source_layout_digest(
            source_kind,
            directory_count,
            file_count,
            &self.records,
            is_cancelled,
        )?;
        Ok(SourceLayout {
            records: self.records,
            directory_count,
            file_count,
            modeled_memory_bytes: self.modeled_memory_bytes,
            sha256,
        })
    }
}

fn modeled_layout_record_bytes(relative_components: &[Vec<u16>]) -> Result<u64, CustodyError> {
    modeled_layout_record_bytes_from_unit_counts(
        relative_components
            .iter()
            .map(|component| component.len() as u64),
    )
}

pub(crate) fn modeled_layout_record_bytes_from_unit_counts<I>(
    component_units: I,
) -> Result<u64, CustodyError>
where
    I: IntoIterator<Item = u64>,
{
    let mut modeled_bytes = SOURCE_LAYOUT_MODELED_RECORD_BYTES;
    for unit_count in component_units {
        let component_bytes = unit_count
            .checked_mul(2)
            .ok_or(CustodyError::LayoutMemoryLimitExceeded)?;
        let aligned_component_bytes = component_bytes
            .checked_add(SOURCE_LAYOUT_MODELED_ALIGNMENT_BYTES - 1)
            .map(|bytes| bytes & !(SOURCE_LAYOUT_MODELED_ALIGNMENT_BYTES - 1))
            .ok_or(CustodyError::LayoutMemoryLimitExceeded)?;
        modeled_bytes = modeled_bytes
            .checked_add(SOURCE_LAYOUT_MODELED_COMPONENT_BYTES)
            .and_then(|bytes| bytes.checked_add(aligned_component_bytes))
            .ok_or(CustodyError::LayoutMemoryLimitExceeded)?;
    }
    Ok(modeled_bytes)
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SourceFileReadEvidence {
    identity: FileIdentity,
    byte_count: u64,
    sha256: Sha256Digest,
}

impl SourceFileReadEvidence {
    #[must_use]
    pub const fn identity(&self) -> FileIdentity {
        self.identity
    }

    #[must_use]
    pub const fn byte_count(&self) -> u64 {
        self.byte_count
    }

    #[must_use]
    pub const fn sha256_digest(&self) -> Sha256Digest {
        self.sha256
    }

    #[must_use]
    pub fn sha256(&self) -> String {
        self.sha256.canonical()
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SourceReadEvidence {
    root_identity: FileIdentity,
    kind: SourceKind,
    files: BTreeMap<FileIdentity, SourceFileReadEvidence>,
    total_bytes: u64,
    aggregate_sha256: Sha256Digest,
}

impl SourceReadEvidence {
    #[must_use]
    pub const fn root_identity(&self) -> FileIdentity {
        self.root_identity
    }

    #[must_use]
    pub const fn kind(&self) -> SourceKind {
        self.kind
    }

    #[must_use]
    pub fn file_count(&self) -> usize {
        self.files.len()
    }

    #[must_use]
    pub const fn total_bytes(&self) -> u64 {
        self.total_bytes
    }

    pub fn files(&self) -> impl ExactSizeIterator<Item = &SourceFileReadEvidence> {
        self.files.values()
    }

    #[must_use]
    pub const fn aggregate_sha256_digest(&self) -> Sha256Digest {
        self.aggregate_sha256
    }

    #[must_use]
    pub fn aggregate_sha256(&self) -> String {
        self.aggregate_sha256.canonical()
    }
}

impl SourceInventory {
    #[must_use]
    pub const fn root_identity(&self) -> FileIdentity {
        self.root_identity
    }

    #[must_use]
    pub fn file_count(&self) -> usize {
        self.files.len()
    }

    #[must_use]
    pub fn directory_count(&self) -> usize {
        self.directories.len()
    }

    #[must_use]
    pub const fn total_bytes(&self) -> u64 {
        self.total_bytes
    }

    #[must_use]
    pub(crate) const fn modeled_layout_memory_bytes(&self) -> u64 {
        self.layout.modeled_memory_bytes
    }

    pub fn entries(&self) -> impl ExactSizeIterator<Item = (FileIdentity, u64)> + '_ {
        self.files.iter().map(|(identity, size)| (*identity, *size))
    }

    pub fn identities(&self) -> impl Iterator<Item = FileIdentity> + '_ {
        self.directories
            .iter()
            .copied()
            .chain(self.files.keys().copied())
    }

    fn matches_with_cancellation<F>(
        &self,
        other: &Self,
        is_cancelled: &mut F,
    ) -> Result<bool, CustodyError>
    where
        F: FnMut() -> bool,
    {
        check_cancelled(is_cancelled)?;
        if self.root_identity != other.root_identity
            || self.total_bytes != other.total_bytes
            || self.directories.len() != other.directories.len()
            || self.files.len() != other.files.len()
        {
            return Ok(false);
        }
        for (left, right) in self.directories.iter().zip(&other.directories) {
            check_cancelled(is_cancelled)?;
            if left != right {
                return Ok(false);
            }
        }
        for (left, right) in self.files.iter().zip(&other.files) {
            check_cancelled(is_cancelled)?;
            if left != right {
                return Ok(false);
            }
        }
        self.layout
            .matches_with_cancellation(&other.layout, is_cancelled)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CustodyError {
    Cancelled,
    InvalidLimits,
    OpenRejected,
    ReparsePointRejected,
    UnsupportedEntry,
    NotDirectLocalVolume,
    VolumeIdentityMismatch,
    IdentityUnavailable,
    PrivatePathRejected,
    EnumerationFailed,
    EntryLimitExceeded,
    FileLimitExceeded,
    ByteLimitExceeded,
    LayoutMemoryLimitExceeded,
    PathLimitExceeded,
    DepthLimitExceeded,
    DuplicateIdentity,
    SourceChanged,
    InvalidReadBuffer,
    ReadFailed,
    ReadIncomplete,
}

impl fmt::Display for CustodyError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Cancelled => "native custody operation was cancelled",
            Self::InvalidLimits => "native custody limits are invalid",
            Self::OpenRejected => "native handle open was rejected",
            Self::ReparsePointRejected => "a reparse point was rejected",
            Self::UnsupportedEntry => "an unsupported filesystem entry was rejected",
            Self::NotDirectLocalVolume => "the selected item is not on a direct local volume",
            Self::VolumeIdentityMismatch => "the opened handle volume could not be corroborated",
            Self::IdentityUnavailable => "the filesystem did not provide a supported identity",
            Self::PrivatePathRejected => "the private path was rejected",
            Self::EnumerationFailed => "complete native enumeration failed",
            Self::EntryLimitExceeded => "the native enumeration entry limit was exceeded",
            Self::FileLimitExceeded => "the native enumeration file limit was exceeded",
            Self::ByteLimitExceeded => "the native enumeration byte limit was exceeded",
            Self::LayoutMemoryLimitExceeded => "the native layout memory limit was exceeded",
            Self::PathLimitExceeded => "the native private path limit was exceeded",
            Self::DepthLimitExceeded => "the native enumeration depth limit was exceeded",
            Self::DuplicateIdentity => "a duplicate file identity was rejected",
            Self::SourceChanged => "the retained source changed during revalidation",
            Self::InvalidReadBuffer => "the native read buffer was rejected",
            Self::ReadFailed => "a retained source read failed",
            Self::ReadIncomplete => "a retained source was not read completely",
        })
    }
}

impl std::error::Error for CustodyError {}

pub struct RetainedSource {
    root: OwnedNtHandle,
    kind: SourceKind,
    local_volume_evidence: LocalVolumeEvidence,
    canonical_path: String,
    canonical_path_utf16_units: usize,
    inventory: SourceInventory,
}

impl RetainedSource {
    pub fn open<F>(
        locator: &CanonicalDosPath,
        limits: InventoryLimits,
        mut is_cancelled: F,
    ) -> Result<Self, CustodyError>
    where
        F: FnMut() -> bool,
    {
        validate_limits(limits)?;
        check_cancelled(&mut is_cancelled)?;
        direct_drive_root(locator)?;
        let root = open_absolute(locator.as_str(), None)?;
        let canonical = canonical_path_from_handle(root.raw())?;
        let locator_volume_evidence = prove_direct_local_volume(root.raw(), locator)?;
        let local_volume_evidence = prove_direct_local_volume(root.raw(), &canonical)?;
        if locator_volume_evidence != local_volume_evidence {
            return Err(CustodyError::VolumeIdentityMismatch);
        }
        let metadata =
            metadata_from_handle(root.raw(), local_volume_evidence.corroborated_volume_serial)?;
        let kind = if metadata.standard.Directory {
            SourceKind::Folder
        } else {
            SourceKind::File
        };
        let canonical_path_utf16_units = canonical.as_str().encode_utf16().count();
        let root_leaf = canonical_leaf_component(&canonical)?;
        let inventory = inventory_from_root(
            &root,
            kind,
            metadata,
            &root_leaf,
            canonical_path_utf16_units,
            limits,
            &mut is_cancelled,
        )?;
        check_cancelled(&mut is_cancelled)?;
        Ok(Self {
            root,
            kind,
            local_volume_evidence,
            canonical_path: canonical.as_str().to_owned(),
            canonical_path_utf16_units,
            inventory,
        })
    }

    #[must_use]
    pub const fn kind(&self) -> SourceKind {
        self.kind
    }

    #[must_use]
    pub(crate) fn canonical_path(&self) -> &str {
        &self.canonical_path
    }

    #[must_use]
    pub const fn inventory(&self) -> &SourceInventory {
        &self.inventory
    }

    #[must_use]
    pub(crate) const fn source_catalog_layout(&self) -> SourceCatalogLayoutView<'_> {
        SourceCatalogLayoutView {
            source_kind: self.kind,
            layout: &self.inventory.layout,
        }
    }

    #[must_use]
    pub const fn local_volume_evidence(&self) -> LocalVolumeEvidence {
        self.local_volume_evidence
    }

    pub fn revalidate<F>(
        &self,
        limits: InventoryLimits,
        mut is_cancelled: F,
    ) -> Result<(), CustodyError>
    where
        F: FnMut() -> bool,
    {
        validate_limits(limits)?;
        check_cancelled(&mut is_cancelled)?;
        let current_canonical = canonical_path_from_handle(self.root.raw())?;
        if current_canonical.as_str() != self.canonical_path {
            return Err(CustodyError::SourceChanged);
        }
        let root_leaf = canonical_leaf_component(&current_canonical)?;
        let metadata =
            metadata_from_handle(self.root.raw(), self.inventory.root_identity.volume_serial)?;
        let current = inventory_from_root(
            &self.root,
            self.kind,
            metadata,
            &root_leaf,
            self.canonical_path_utf16_units,
            limits,
            &mut is_cancelled,
        )?;
        if !current.matches_with_cancellation(&self.inventory, &mut is_cancelled)? {
            return Err(CustodyError::SourceChanged);
        }
        check_cancelled(&mut is_cancelled)?;
        Ok(())
    }

    pub fn begin_read_custody<F>(
        self: &Rc<Self>,
        limits: InventoryLimits,
        mut is_cancelled: F,
    ) -> Result<SourceReadCustody, CustodyError>
    where
        F: FnMut() -> bool,
    {
        validate_limits(limits)?;
        check_cancelled(&mut is_cancelled)?;
        self.revalidate(limits, &mut is_cancelled)?;

        let directory = self.kind == SourceKind::Folder;
        let strict_root = open_absolute_with_access_and_share(
            &self.canonical_path,
            Some(directory),
            windows::Win32::Storage::FileSystem::FILE_ACCESS_RIGHTS(0),
            FILE_SHARE_READ,
        )?;
        let canonical = CanonicalDosPath::parse(&self.canonical_path)
            .map_err(|_| CustodyError::PrivatePathRejected)?;
        let strict_volume_evidence = prove_direct_local_volume(strict_root.raw(), &canonical)?;
        if strict_volume_evidence != self.local_volume_evidence {
            return Err(CustodyError::VolumeIdentityMismatch);
        }
        let root_metadata = metadata_from_handle(
            strict_root.raw(),
            self.inventory.root_identity.volume_serial,
        )?;
        if root_metadata.identity != self.inventory.root_identity
            || root_metadata.standard.Directory != directory
        {
            return Err(CustodyError::SourceChanged);
        }

        let mut files = BTreeMap::new();
        let mut directories = BTreeMap::new();
        let (current, directory_root) = if directory {
            let current = inventory_from_folder_with_custody(
                &strict_root,
                root_metadata,
                self.canonical_path_utf16_units,
                limits,
                &mut is_cancelled,
                &mut files,
                &mut directories,
            )?;
            (current, Some(strict_root))
        } else {
            let root_leaf = canonical_leaf_component(&canonical)?;
            let current =
                inventory_from_file(root_metadata, &root_leaf, limits, &mut is_cancelled)?;
            files.insert(
                root_metadata.identity,
                CustodiedFile::new(strict_root, root_metadata),
            );
            (current, None)
        };
        if !current.matches_with_cancellation(&self.inventory, &mut is_cancelled)? {
            return Err(CustodyError::SourceChanged);
        }
        // `SourceLayout` has an explicit Drop, so make the lifetime boundary
        // equally explicit before `self.revalidate` builds the second transient
        // inventory. This keeps the modeled peak at retained + one rebuild.
        drop(current);
        // Re-enumerate once more after every restrictive file handle has been
        // acquired. This is the immediate pre-handoff checkpoint; the scope's
        // `finish` performs the matching post-read checkpoint.
        self.revalidate(limits, &mut is_cancelled)?;
        check_cancelled(&mut is_cancelled)?;

        Ok(SourceReadCustody {
            origin: Rc::clone(self),
            directory_root,
            directories,
            files,
        })
    }
}

impl Drop for RetainedSource {
    fn drop(&mut self) {
        // SAFETY: replacing every byte with zero preserves UTF-8 validity and
        // the string is not observed after Drop begins. This only minimizes the
        // lifetime of this logical copy; it is not a physical-RAM sanitization
        // claim. Process teardown remains the address-space cleanup boundary.
        unsafe { self.canonical_path.as_bytes_mut() }.fill(0);
    }
}

pub struct SourceReadCustody {
    origin: Rc<RetainedSource>,
    directory_root: Option<OwnedNtHandle>,
    directories: BTreeMap<FileIdentity, OwnedNtHandle>,
    files: BTreeMap<FileIdentity, CustodiedFile>,
}

impl SourceReadCustody {
    pub fn file_identities(&self) -> impl ExactSizeIterator<Item = FileIdentity> + '_ {
        self.files.keys().copied()
    }

    #[must_use]
    pub fn root_identity(&self) -> FileIdentity {
        self.origin.inventory.root_identity
    }

    #[must_use]
    pub fn kind(&self) -> SourceKind {
        self.origin.kind
    }

    #[must_use]
    pub fn inventory(&self) -> &SourceInventory {
        &self.origin.inventory
    }

    #[must_use]
    pub fn local_volume_evidence(&self) -> LocalVolumeEvidence {
        self.origin.local_volume_evidence
    }

    pub fn read_chunk<F>(
        &mut self,
        identity: FileIdentity,
        buffer: &mut [u8],
        mut is_cancelled: F,
    ) -> Result<usize, CustodyError>
    where
        F: FnMut() -> bool,
    {
        check_cancelled(&mut is_cancelled)?;
        if buffer.is_empty() || buffer.len() > MAX_READ_CHUNK_BYTES {
            return Err(CustodyError::InvalidReadBuffer);
        }
        let read = self
            .files
            .get_mut(&identity)
            .ok_or(CustodyError::ReadFailed)?
            .read_chunk(buffer)?;
        check_cancelled(&mut is_cancelled)?;
        Ok(read)
    }

    pub fn finish<F>(
        self,
        limits: InventoryLimits,
        mut is_cancelled: F,
    ) -> Result<SourceReadEvidence, CustodyError>
    where
        F: FnMut() -> bool,
    {
        self.finish_evidence(limits, &mut is_cancelled)
    }

    pub(crate) fn revalidate_live<F>(
        &self,
        limits: InventoryLimits,
        mut is_cancelled: F,
    ) -> Result<(), CustodyError>
    where
        F: FnMut() -> bool,
    {
        check_cancelled(&mut is_cancelled)?;
        if let Some(root) = &self.directory_root {
            validate_retained_handle(root, self.origin.inventory.root_identity, true)?;
        }
        for (identity, directory) in &self.directories {
            validate_retained_handle(directory, *identity, true)?;
            check_cancelled(&mut is_cancelled)?;
        }
        for file in self.files.values() {
            file.validate_metadata()?;
            check_cancelled(&mut is_cancelled)?;
        }
        self.origin.revalidate(limits, &mut is_cancelled)?;
        check_cancelled(&mut is_cancelled)
    }

    pub(crate) fn finish_evidence<F>(
        &self,
        limits: InventoryLimits,
        mut is_cancelled: F,
    ) -> Result<SourceReadEvidence, CustodyError>
    where
        F: FnMut() -> bool,
    {
        check_cancelled(&mut is_cancelled)?;
        for file in self.files.values() {
            file.validate_complete()?;
            check_cancelled(&mut is_cancelled)?;
        }
        self.revalidate_live(limits, &mut is_cancelled)?;
        check_cancelled(&mut is_cancelled)?;

        let mut files = BTreeMap::new();
        for file in self.files.values() {
            let evidence = file.evidence();
            files.insert(evidence.identity, evidence);
            check_cancelled(&mut is_cancelled)?;
        }
        let aggregate_sha256 = source_read_aggregate(
            self.origin.inventory.root_identity,
            self.origin.kind,
            self.origin.inventory.total_bytes,
            &files,
            &mut is_cancelled,
        )?;
        check_cancelled(&mut is_cancelled)?;
        Ok(SourceReadEvidence {
            root_identity: self.origin.inventory.root_identity,
            kind: self.origin.kind,
            files,
            total_bytes: self.origin.inventory.total_bytes,
            aggregate_sha256,
        })
    }
}

struct CustodiedFile {
    handle: OwnedNtHandle,
    identity: FileIdentity,
    expected_size: u64,
    stable_metadata: StableMetadata,
    bytes_read: u64,
    sha256: Sha256,
}

#[derive(Clone, Copy, Eq, PartialEq)]
struct StableMetadata {
    creation_time: i64,
    last_write_time: i64,
    change_time: i64,
    file_attributes: u32,
    allocation_size: i64,
    number_of_links: u32,
}

impl From<HandleMetadata> for StableMetadata {
    fn from(metadata: HandleMetadata) -> Self {
        Self {
            creation_time: metadata.basic.CreationTime,
            last_write_time: metadata.basic.LastWriteTime,
            change_time: metadata.basic.ChangeTime,
            file_attributes: metadata.basic.FileAttributes,
            allocation_size: metadata.standard.AllocationSize,
            number_of_links: metadata.standard.NumberOfLinks,
        }
    }
}

impl CustodiedFile {
    fn new(handle: OwnedNtHandle, metadata: HandleMetadata) -> Self {
        Self {
            handle,
            identity: metadata.identity,
            expected_size: metadata.standard.EndOfFile as u64,
            stable_metadata: metadata.into(),
            bytes_read: 0,
            sha256: Sha256::new(),
        }
    }

    fn read_chunk(&mut self, buffer: &mut [u8]) -> Result<usize, CustodyError> {
        if self.bytes_read == self.expected_size {
            return Ok(0);
        }
        let remaining = self.expected_size - self.bytes_read;
        let request_bytes = buffer.len().min(remaining as usize);
        let mut bytes_read = 0u32;
        // SAFETY: the handle is retained, synchronous, and opened for read.
        // The bounded output slice is initialized writable storage and the
        // byte-count pointer remains valid for the duration of the call.
        unsafe {
            ReadFile(
                self.handle.raw(),
                Some(&mut buffer[..request_bytes]),
                Some(&mut bytes_read),
                None,
            )
        }
        .map_err(|_| CustodyError::ReadFailed)?;
        if bytes_read == 0 {
            return Err(CustodyError::ReadIncomplete);
        }
        self.sha256.update(&buffer[..bytes_read as usize]);
        self.bytes_read = self
            .bytes_read
            .checked_add(u64::from(bytes_read))
            .ok_or(CustodyError::ReadFailed)?;
        if self.bytes_read > self.expected_size {
            return Err(CustodyError::ReadFailed);
        }
        if self.bytes_read == self.expected_size {
            self.validate_metadata()?;
        }
        Ok(bytes_read as usize)
    }

    fn validate_metadata(&self) -> Result<(), CustodyError> {
        let metadata = metadata_from_handle(self.handle.raw(), self.identity.volume_serial)?;
        if metadata.identity != self.identity
            || metadata.standard.Directory
            || metadata.standard.EndOfFile < 0
            || metadata.standard.EndOfFile as u64 != self.expected_size
            || StableMetadata::from(metadata) != self.stable_metadata
        {
            return Err(CustodyError::SourceChanged);
        }
        Ok(())
    }

    fn validate_complete(&self) -> Result<(), CustodyError> {
        if self.bytes_read != self.expected_size {
            return Err(CustodyError::ReadIncomplete);
        }
        self.validate_metadata()
    }

    fn evidence(&self) -> SourceFileReadEvidence {
        SourceFileReadEvidence {
            identity: self.identity,
            byte_count: self.bytes_read,
            sha256: finalize_sha256(&self.sha256),
        }
    }
}

pub(crate) struct RetainedDirectory {
    handle: OwnedNtHandle,
    identity: FileIdentity,
    local_volume_evidence: LocalVolumeEvidence,
    canonical_path: String,
}

impl RetainedDirectory {
    pub(crate) fn open_output(locator: &CanonicalDosPath) -> Result<Self, CustodyError> {
        direct_drive_root(locator)?;
        let handle = open_absolute(locator.as_str(), Some(true))?;
        let canonical = canonical_path_from_handle(handle.raw())?;
        let locator_volume_evidence = prove_direct_local_volume(handle.raw(), locator)?;
        let local_volume_evidence = prove_direct_local_volume(handle.raw(), &canonical)?;
        if locator_volume_evidence != local_volume_evidence {
            return Err(CustodyError::VolumeIdentityMismatch);
        }
        let metadata = metadata_from_handle(
            handle.raw(),
            local_volume_evidence.corroborated_volume_serial,
        )?;
        if !metadata.standard.Directory {
            return Err(CustodyError::UnsupportedEntry);
        }
        Ok(Self {
            handle,
            identity: metadata.identity,
            local_volume_evidence,
            canonical_path: canonical.as_str().to_owned(),
        })
    }

    pub(crate) const fn handle(&self) -> &OwnedNtHandle {
        &self.handle
    }

    pub(crate) const fn identity(&self) -> FileIdentity {
        self.identity
    }

    pub(crate) const fn local_volume_evidence(&self) -> LocalVolumeEvidence {
        self.local_volume_evidence
    }

    pub(crate) fn canonical_path(&self) -> &str {
        &self.canonical_path
    }

    pub(crate) fn acquire_output_custody(&self) -> Result<OwnedNtHandle, CustodyError> {
        let strict = open_absolute_with_access_and_share(
            &self.canonical_path,
            Some(true),
            windows::Win32::Storage::FileSystem::FILE_ADD_FILE
                | windows::Win32::Storage::FileSystem::FILE_ADD_SUBDIRECTORY,
            FILE_SHARE_READ,
        )?;
        let canonical = CanonicalDosPath::parse(&self.canonical_path)
            .map_err(|_| CustodyError::PrivatePathRejected)?;
        let strict_volume_evidence = prove_direct_local_volume(strict.raw(), &canonical)?;
        if strict_volume_evidence != self.local_volume_evidence {
            return Err(CustodyError::VolumeIdentityMismatch);
        }
        validate_retained_handle(&strict, self.identity, true)?;
        Ok(strict)
    }
}

impl Drop for RetainedDirectory {
    fn drop(&mut self) {
        // SAFETY: replacing every byte with zero preserves UTF-8 validity and
        // the path is not observed after Drop begins. This is best-effort
        // lifetime reduction for this copy, not a physical erasure guarantee.
        unsafe { self.canonical_path.as_bytes_mut() }.fill(0);
    }
}

pub(crate) struct OwnedNtHandle(HANDLE);

impl OwnedNtHandle {
    pub(crate) const fn raw(&self) -> HANDLE {
        self.0
    }
}

impl Drop for OwnedNtHandle {
    fn drop(&mut self) {
        // SAFETY: this type is constructed only from a successful NtCreateFile
        // call and owns exactly one handle. Drop runs exactly once.
        let _ = unsafe { CloseHandle(self.0) };
    }
}

pub(crate) fn open_relative(
    parent: &OwnedNtHandle,
    component: &str,
    directory: bool,
    desired_access: windows::Win32::Storage::FileSystem::FILE_ACCESS_RIGHTS,
    create_disposition: windows::Wdk::Storage::FileSystem::NTCREATEFILE_CREATE_DISPOSITION,
) -> Result<OwnedNtHandle, windows::Win32::Foundation::NTSTATUS> {
    let component = validate_component(component)
        .map_err(|_| windows::Win32::Foundation::STATUS_OBJECT_NAME_INVALID)?;
    let options = if directory {
        FILE_DIRECTORY_FILE
    } else {
        FILE_NON_DIRECTORY_FILE
    } | FILE_SYNCHRONOUS_IO_NONALERT;
    nt_create_with_share(
        &component,
        parent.raw(),
        desired_access,
        create_disposition,
        options,
        FILE_SHARE_READ,
    )
}

fn open_absolute(
    canonical_dos_path: &str,
    directory: Option<bool>,
) -> Result<OwnedNtHandle, CustodyError> {
    open_absolute_with_extra_access(
        canonical_dos_path,
        directory,
        windows::Win32::Storage::FileSystem::FILE_ACCESS_RIGHTS(0),
    )
}

fn open_absolute_with_extra_access(
    canonical_dos_path: &str,
    directory: Option<bool>,
    extra_access: windows::Win32::Storage::FileSystem::FILE_ACCESS_RIGHTS,
) -> Result<OwnedNtHandle, CustodyError> {
    open_absolute_with_access_and_share(
        canonical_dos_path,
        directory,
        extra_access,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
    )
}

fn open_absolute_with_access_and_share(
    canonical_dos_path: &str,
    directory: Option<bool>,
    extra_access: windows::Win32::Storage::FileSystem::FILE_ACCESS_RIGHTS,
    share: windows::Win32::Storage::FileSystem::FILE_SHARE_MODE,
) -> Result<OwnedNtHandle, CustodyError> {
    let mut nt_path = NT_DOS_PREFIX.to_vec();
    nt_path.extend(canonical_dos_path.encode_utf16());
    let mut options = FILE_SYNCHRONOUS_IO_NONALERT;
    let desired_access = match directory {
        Some(true) => {
            options |= FILE_DIRECTORY_FILE;
            FILE_LIST_DIRECTORY | FILE_TRAVERSE | FILE_READ_ATTRIBUTES | SYNCHRONIZE
        }
        Some(false) => {
            options |= FILE_NON_DIRECTORY_FILE;
            FILE_READ_DATA | FILE_READ_ATTRIBUTES | SYNCHRONIZE
        }
        None => FILE_READ_DATA | FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
    } | extra_access;
    match nt_create_with_share(
        &nt_path,
        HANDLE::default(),
        desired_access,
        FILE_OPEN,
        options,
        share,
    ) {
        Ok(handle) => Ok(handle),
        Err(status) if status == windows::Win32::Foundation::STATUS_REPARSE_POINT_ENCOUNTERED => {
            Err(CustodyError::ReparsePointRejected)
        }
        Err(_) => Err(CustodyError::OpenRejected),
    }
}

fn nt_create(
    name: &[u16],
    root: HANDLE,
    desired_access: windows::Win32::Storage::FileSystem::FILE_ACCESS_RIGHTS,
    create_disposition: windows::Wdk::Storage::FileSystem::NTCREATEFILE_CREATE_DISPOSITION,
    create_options: NTCREATEFILE_CREATE_OPTIONS,
) -> Result<OwnedNtHandle, windows::Win32::Foundation::NTSTATUS> {
    nt_create_with_share(
        name,
        root,
        desired_access,
        create_disposition,
        create_options,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
    )
}

fn nt_create_with_share(
    name: &[u16],
    root: HANDLE,
    desired_access: windows::Win32::Storage::FileSystem::FILE_ACCESS_RIGHTS,
    create_disposition: windows::Wdk::Storage::FileSystem::NTCREATEFILE_CREATE_DISPOSITION,
    create_options: NTCREATEFILE_CREATE_OPTIONS,
    share: windows::Win32::Storage::FileSystem::FILE_SHARE_MODE,
) -> Result<OwnedNtHandle, windows::Win32::Foundation::NTSTATUS> {
    let byte_length = name
        .len()
        .checked_mul(size_of::<u16>())
        .and_then(|length| u16::try_from(length).ok())
        .ok_or(windows::Win32::Foundation::STATUS_NAME_TOO_LONG)?;
    let unicode_name = UNICODE_STRING {
        Length: byte_length,
        MaximumLength: byte_length,
        Buffer: windows::core::PWSTR(name.as_ptr().cast_mut()),
    };
    // Microsoft documents OBJ_DONT_REPARSE as refusing to follow any reparse
    // point encountered while parsing the object name and returning
    // STATUS_REPARSE_POINT_ENCOUNTERED. Relative names are one validated
    // component, while absolute opens use the same fail-closed attribute for
    // their entire ancestor chain.
    let attributes = OBJECT_ATTRIBUTES {
        Length: size_of::<OBJECT_ATTRIBUTES>() as u32,
        RootDirectory: root,
        ObjectName: &unicode_name,
        Attributes: OBJ_CASE_INSENSITIVE | OBJ_DONT_REPARSE,
        SecurityDescriptor: ptr::null(),
        SecurityQualityOfService: ptr::null(),
    };
    let mut handle = HANDLE::default();
    let mut io_status = IO_STATUS_BLOCK::default();
    // SAFETY: all pointers refer to initialized values for the duration of the
    // call. `name` remains alive through the call. The returned handle is
    // accepted only for a successful NTSTATUS and immediately becomes owned.
    let status = unsafe {
        NtCreateFile(
            &mut handle,
            desired_access,
            &attributes,
            &mut io_status,
            None,
            FILE_FLAGS_AND_ATTRIBUTES(0),
            share,
            create_disposition,
            create_options,
            None,
            0,
        )
    };
    if status.0 < 0 || handle.is_invalid() {
        return Err(status);
    }
    Ok(OwnedNtHandle(handle))
}

#[derive(Clone, Copy)]
struct HandleMetadata {
    identity: FileIdentity,
    basic: FILE_BASIC_INFO,
    standard: FILE_STANDARD_INFO,
}

fn metadata_from_handle(
    handle: HANDLE,
    expected_volume_serial: u64,
) -> Result<HandleMetadata, CustodyError> {
    if unsafe { GetFileType(handle) } != FILE_TYPE_DISK {
        return Err(CustodyError::UnsupportedEntry);
    }
    let tag: FILE_ATTRIBUTE_TAG_INFO = query_handle_info(handle, FileAttributeTagInfo)
        .map_err(|_| CustodyError::UnsupportedEntry)?;
    if tag.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0 || tag.ReparseTag != 0 {
        return Err(CustodyError::ReparsePointRejected);
    }
    let standard: FILE_STANDARD_INFO =
        query_handle_info(handle, FileStandardInfo).map_err(|_| CustodyError::UnsupportedEntry)?;
    if standard.DeletePending || (!standard.Directory && standard.EndOfFile < 0) {
        return Err(CustodyError::UnsupportedEntry);
    }
    let identity = identity_from_handle(handle)?;
    if identity.volume_serial != expected_volume_serial {
        return Err(CustodyError::VolumeIdentityMismatch);
    }
    let basic: FILE_BASIC_INFO =
        query_handle_info(handle, FileBasicInfo).map_err(|_| CustodyError::UnsupportedEntry)?;
    Ok(HandleMetadata {
        identity,
        basic,
        standard,
    })
}

pub(crate) fn validate_retained_handle(
    handle: &OwnedNtHandle,
    expected_identity: FileIdentity,
    directory: bool,
) -> Result<(), CustodyError> {
    let metadata = metadata_from_handle(handle.raw(), expected_identity.volume_serial)?;
    if metadata.identity != expected_identity || metadata.standard.Directory != directory {
        return Err(CustodyError::SourceChanged);
    }
    Ok(())
}

pub(crate) fn validate_output_file_handle(
    handle: &OwnedNtHandle,
    expected_identity: FileIdentity,
    expected_size: u64,
    expected_number_of_links: u32,
) -> Result<(), CustodyError> {
    let metadata = metadata_from_handle(handle.raw(), expected_identity.volume_serial)?;
    if metadata.identity != expected_identity
        || metadata.standard.Directory
        || metadata.standard.EndOfFile < 0
        || metadata.standard.EndOfFile as u64 != expected_size
        || metadata.standard.NumberOfLinks != expected_number_of_links
    {
        return Err(CustodyError::SourceChanged);
    }
    Ok(())
}

pub(crate) fn identity_for_created_output_file(
    handle: &OwnedNtHandle,
    expected_volume_serial: u64,
) -> Result<FileIdentity, CustodyError> {
    let metadata = metadata_from_handle(handle.raw(), expected_volume_serial)?;
    if metadata.standard.Directory
        || metadata.standard.EndOfFile != 0
        || metadata.standard.NumberOfLinks != 1
    {
        return Err(CustodyError::UnsupportedEntry);
    }
    Ok(metadata.identity)
}

pub(crate) fn identity_for_created_handle(
    handle: &OwnedNtHandle,
    expected_volume_serial: u64,
    directory: bool,
) -> Result<FileIdentity, CustodyError> {
    let metadata = metadata_from_handle(handle.raw(), expected_volume_serial)?;
    if metadata.standard.Directory != directory {
        return Err(CustodyError::UnsupportedEntry);
    }
    Ok(metadata.identity)
}

fn identity_from_handle(handle: HANDLE) -> Result<FileIdentity, CustodyError> {
    let info: FILE_ID_INFO =
        query_handle_info(handle, FileIdInfo).map_err(|_| CustodyError::IdentityUnavailable)?;
    Ok(FileIdentity::from_parts(
        info.VolumeSerialNumber,
        info.FileId.Identifier,
    ))
}

fn query_handle_info<T: Default>(
    handle: HANDLE,
    class: windows::Win32::Storage::FileSystem::FILE_INFO_BY_HANDLE_CLASS,
) -> windows::core::Result<T> {
    let mut value = T::default();
    // SAFETY: `value` is initialized and its exact type matches `class` at all
    // call sites. The byte size is the size of that concrete output type.
    unsafe {
        GetFileInformationByHandleEx(
            handle,
            class,
            (&mut value as *mut T).cast::<c_void>(),
            size_of::<T>() as u32,
        )?;
    }
    Ok(value)
}

fn canonical_path_from_handle(handle: HANDLE) -> Result<CanonicalDosPath, CustodyError> {
    let mut buffer = vec![0u16; MAX_PRIVATE_PATH_UTF16_UNITS + FINAL_DOS_PREFIX.len() + 1];
    // SAFETY: `buffer` is initialized writable storage and `handle` remains
    // owned and open for the duration of the call.
    let length = unsafe {
        GetFinalPathNameByHandleW(
            handle,
            &mut buffer,
            windows::Win32::Storage::FileSystem::GETFINALPATHNAMEBYHANDLE_FLAGS(
                FILE_NAME_NORMALIZED.0 | VOLUME_NAME_DOS.0,
            ),
        )
    } as usize;
    if length == 0 || length >= buffer.len() || !buffer[..length].starts_with(FINAL_DOS_PREFIX) {
        return Err(CustodyError::PrivatePathRejected);
    }
    let value = String::from_utf16(&buffer[FINAL_DOS_PREFIX.len()..length])
        .map_err(|_| CustodyError::PrivatePathRejected)?;
    CanonicalDosPath::parse(&value).map_err(|_| CustodyError::PrivatePathRejected)
}

fn prove_direct_local_volume(
    handle: HANDLE,
    canonical_path: &CanonicalDosPath,
) -> Result<LocalVolumeEvidence, CustodyError> {
    if unsafe { GetFileType(handle) } != FILE_TYPE_DISK {
        return Err(CustodyError::NotDirectLocalVolume);
    }
    let direct_root = direct_drive_root(canonical_path)?;
    let mut nt_root = NT_DOS_PREFIX.to_vec();
    nt_root.extend_from_slice(&direct_root.normalized_root[..3]);
    let root_handle = nt_create(
        &nt_root,
        HANDLE::default(),
        FILE_READ_ATTRIBUTES | SYNCHRONIZE,
        FILE_OPEN,
        FILE_DIRECTORY_FILE | FILE_SYNCHRONOUS_IO_NONALERT,
    )
    .map_err(|_| CustodyError::NotDirectLocalVolume)?;
    if unsafe { GetFileType(root_handle.raw()) } != FILE_TYPE_DISK {
        return Err(CustodyError::NotDirectLocalVolume);
    }
    let selected = identity_from_handle(handle)?;
    let root = identity_from_handle(root_handle.raw())?;
    if selected.volume_serial != root.volume_serial {
        return Err(CustodyError::VolumeIdentityMismatch);
    }
    Ok(LocalVolumeEvidence {
        corroborated_volume_serial: selected.volume_serial,
        drive_kind: direct_root.drive_kind,
        dos_device_mapping: DosDeviceMapping::DirectHarddiskVolume,
    })
}

struct DirectDriveRoot {
    normalized_root: [u16; 4],
    drive_kind: LocalDriveKind,
}

fn direct_drive_root(canonical_path: &CanonicalDosPath) -> Result<DirectDriveRoot, CustodyError> {
    let path_wide = nul_terminated(canonical_path.as_str());
    let mut volume_path = vec![0u16; MAX_PRIVATE_PATH_UTF16_UNITS + 1];
    // SAFETY: both input and output are valid NUL-terminated/writable UTF-16
    // buffers for the duration of the call.
    unsafe { GetVolumePathNameW(PCWSTR(path_wide.as_ptr()), &mut volume_path) }
        .map_err(|_| CustodyError::NotDirectLocalVolume)?;
    let volume_length = volume_path
        .iter()
        .position(|unit| *unit == 0)
        .ok_or(CustodyError::NotDirectLocalVolume)?;
    let volume = &volume_path[..volume_length];
    if volume.len() != 3
        || !is_ascii_letter(volume[0])
        || volume[1] != b':' as u16
        || volume[2] != 0x5c
    {
        return Err(CustodyError::NotDirectLocalVolume);
    }
    let drive = upper_ascii(volume[0]);
    if canonical_path.as_str().as_bytes()[0] != drive as u8 {
        return Err(CustodyError::NotDirectLocalVolume);
    }
    let normalized_root = [drive, b':' as u16, 0x5c, 0];
    // SAFETY: `normalized_root` is NUL terminated.
    let drive_type = unsafe { GetDriveTypeW(PCWSTR(normalized_root.as_ptr())) };
    let drive_kind = if drive_type == DRIVE_FIXED {
        LocalDriveKind::Fixed
    } else if drive_type == DRIVE_REMOVABLE {
        LocalDriveKind::Removable
    } else {
        return Err(CustodyError::NotDirectLocalVolume);
    };

    let drive_name = [drive, b':' as u16, 0];
    let mut target_buffer = vec![0u16; DOS_DEVICE_BUFFER_UNITS];
    // SAFETY: both input and output are valid NUL-terminated/writable UTF-16
    // buffers for the duration of the call.
    let target_units = unsafe {
        QueryDosDeviceW(
            PCWSTR(drive_name.as_ptr()),
            Some(target_buffer.as_mut_slice()),
        )
    } as usize;
    if target_units == 0 || target_units > target_buffer.len() {
        return Err(CustodyError::NotDirectLocalVolume);
    }
    let first_length = target_buffer[..target_units]
        .iter()
        .position(|unit| *unit == 0)
        .ok_or(CustodyError::NotDirectLocalVolume)?;
    if !is_direct_local_dos_device_target(&target_buffer[..first_length]) {
        return Err(CustodyError::NotDirectLocalVolume);
    }
    Ok(DirectDriveRoot {
        normalized_root,
        drive_kind,
    })
}

#[must_use]
pub fn is_direct_local_dos_device_target(target: &[u16]) -> bool {
    const PREFIX: &[u8] = b"\\Device\\HarddiskVolume";
    if target.len() <= PREFIX.len() {
        return false;
    }
    if !target[..PREFIX.len()]
        .iter()
        .zip(PREFIX)
        .all(|(actual, expected)| upper_ascii(*actual) == u16::from(expected.to_ascii_uppercase()))
    {
        return false;
    }
    target[PREFIX.len()..]
        .iter()
        .all(|unit| matches!(*unit, 0x30..=0x39))
}

fn inventory_from_root<F>(
    root: &OwnedNtHandle,
    kind: SourceKind,
    root_metadata: HandleMetadata,
    root_leaf: &[u16],
    root_path_units: usize,
    limits: InventoryLimits,
    is_cancelled: &mut F,
) -> Result<SourceInventory, CustodyError>
where
    F: FnMut() -> bool,
{
    if kind == SourceKind::File {
        return inventory_from_file(root_metadata, root_leaf, limits, is_cancelled);
    }
    let mut directories = BTreeSet::new();
    let mut files = BTreeMap::new();
    let mut total_bytes = 0u64;
    let mut layout = SourceLayoutBuilder::new(limits.max_layout_memory_bytes);
    directories.insert(root_metadata.identity);
    layout.add_directory(root_metadata.identity, Vec::new())?;
    {
        let mut collector = EnumerationCollector {
            limits,
            directories: &mut directories,
            files: &mut files,
            total_bytes: &mut total_bytes,
            layout: &mut layout,
            share: FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            custodied_files: None,
            custodied_directories: None,
        };
        enumerate_folder(
            root,
            root_metadata.identity,
            root_path_units,
            is_cancelled,
            &mut collector,
        )?;
    }
    let layout = layout.finish(SourceKind::Folder, is_cancelled)?;
    Ok(SourceInventory {
        root_identity: root_metadata.identity,
        directories,
        files,
        total_bytes,
        layout,
    })
}

fn inventory_from_file<F>(
    root_metadata: HandleMetadata,
    root_leaf: &[u16],
    limits: InventoryLimits,
    is_cancelled: &mut F,
) -> Result<SourceInventory, CustodyError>
where
    F: FnMut() -> bool,
{
    validate_private_component_utf16(root_leaf)?;
    let mut files = BTreeMap::new();
    let mut total_bytes = 0;
    add_file(&mut files, &mut total_bytes, root_metadata, limits)?;
    let mut layout = SourceLayoutBuilder::new(limits.max_layout_memory_bytes);
    layout.add_file(
        root_metadata.identity,
        vec![root_leaf.to_vec()],
        root_metadata.standard.EndOfFile as u64,
    )?;
    let layout = layout.finish(SourceKind::File, is_cancelled)?;
    Ok(SourceInventory {
        root_identity: root_metadata.identity,
        directories: BTreeSet::new(),
        files,
        total_bytes,
        layout,
    })
}

fn inventory_from_folder_with_custody<F>(
    root: &OwnedNtHandle,
    root_metadata: HandleMetadata,
    root_path_units: usize,
    limits: InventoryLimits,
    is_cancelled: &mut F,
    custodied_files: &mut BTreeMap<FileIdentity, CustodiedFile>,
    custodied_directories: &mut BTreeMap<FileIdentity, OwnedNtHandle>,
) -> Result<SourceInventory, CustodyError>
where
    F: FnMut() -> bool,
{
    let mut directories = BTreeSet::from([root_metadata.identity]);
    let mut files = BTreeMap::new();
    let mut total_bytes = 0;
    let mut layout = SourceLayoutBuilder::new(limits.max_layout_memory_bytes);
    layout.add_directory(root_metadata.identity, Vec::new())?;
    {
        let mut collector = EnumerationCollector {
            limits,
            directories: &mut directories,
            files: &mut files,
            total_bytes: &mut total_bytes,
            layout: &mut layout,
            share: FILE_SHARE_READ,
            custodied_files: Some(custodied_files),
            custodied_directories: Some(custodied_directories),
        };
        enumerate_folder(
            root,
            root_metadata.identity,
            root_path_units,
            is_cancelled,
            &mut collector,
        )?;
    }
    let layout = layout.finish(SourceKind::Folder, is_cancelled)?;
    Ok(SourceInventory {
        root_identity: root_metadata.identity,
        directories,
        files,
        total_bytes,
        layout,
    })
}

struct DirectoryCursor {
    handle: HANDLE,
    _owned_handle: Option<OwnedNtHandle>,
    restart: bool,
    depth: usize,
    relative_units: usize,
    relative_components: Vec<Vec<u16>>,
}

struct EnumerationCollector<'a> {
    limits: InventoryLimits,
    directories: &'a mut BTreeSet<FileIdentity>,
    files: &'a mut BTreeMap<FileIdentity, u64>,
    total_bytes: &'a mut u64,
    layout: &'a mut SourceLayoutBuilder,
    share: windows::Win32::Storage::FileSystem::FILE_SHARE_MODE,
    custodied_files: Option<&'a mut BTreeMap<FileIdentity, CustodiedFile>>,
    custodied_directories: Option<&'a mut BTreeMap<FileIdentity, OwnedNtHandle>>,
}

fn enumerate_folder<F>(
    root: &OwnedNtHandle,
    root_identity: FileIdentity,
    root_path_units: usize,
    is_cancelled: &mut F,
    collector: &mut EnumerationCollector<'_>,
) -> Result<(), CustodyError>
where
    F: FnMut() -> bool,
{
    let mut stack = vec![DirectoryCursor {
        handle: root.raw(),
        _owned_handle: None,
        restart: true,
        depth: 0,
        relative_units: 0,
        relative_components: Vec::new(),
    }];
    let mut entries_seen = 0usize;
    while let Some(cursor) = stack.last_mut() {
        check_cancelled(is_cancelled)?;
        let entries = next_directory_batch(cursor.handle, cursor.restart)?;
        cursor.restart = false;
        let Some(entries) = entries else {
            stack.pop();
            continue;
        };
        let parent_depth = cursor.depth;
        let parent_units = cursor.relative_units;
        let parent_components = cursor.relative_components.clone();
        let parent_handle = cursor.handle;
        for component in entries {
            check_cancelled(is_cancelled)?;
            if component.as_slice() == [b'.' as u16]
                || component.as_slice() == [b'.' as u16, b'.' as u16]
            {
                continue;
            }
            entries_seen = entries_seen
                .checked_add(1)
                .ok_or(CustodyError::EntryLimitExceeded)?;
            if entries_seen > collector.limits.max_entries {
                return Err(CustodyError::EntryLimitExceeded);
            }
            let child_units = parent_units
                .checked_add(usize::from(parent_units != 0))
                .and_then(|units| units.checked_add(component.len()))
                .ok_or(CustodyError::PathLimitExceeded)?;
            if root_path_units
                .checked_add(usize::from(child_units != 0))
                .and_then(|units| units.checked_add(child_units))
                .is_none_or(|units| units > MAX_PRIVATE_PATH_UTF16_UNITS)
            {
                return Err(CustodyError::PathLimitExceeded);
            }
            let mut child_components = parent_components.clone();
            child_components.push(component.clone());
            let relative_parent = BorrowedNtHandle(parent_handle);
            let child = open_relative_borrowed(
                &relative_parent,
                &component,
                FILE_READ_DATA
                    | FILE_LIST_DIRECTORY
                    | FILE_TRAVERSE
                    | FILE_READ_ATTRIBUTES
                    | SYNCHRONIZE,
                collector.share,
            )?;
            let metadata = metadata_from_handle(child.raw(), root_identity.volume_serial)?;
            if metadata.standard.Directory {
                let child_depth = parent_depth + 1;
                if child_depth > MAX_OPEN_DIRECTORY_DEPTH {
                    return Err(CustodyError::DepthLimitExceeded);
                }
                if !collector.directories.insert(metadata.identity) {
                    return Err(CustodyError::DuplicateIdentity);
                }
                collector
                    .layout
                    .add_directory(metadata.identity, child_components.clone())?;
                let child_handle = child.raw();
                let owned_handle = if let Some(custodied) = collector.custodied_directories.as_mut()
                {
                    if custodied.insert(metadata.identity, child).is_some() {
                        return Err(CustodyError::DuplicateIdentity);
                    }
                    None
                } else {
                    Some(child)
                };
                stack.push(DirectoryCursor {
                    handle: child_handle,
                    _owned_handle: owned_handle,
                    restart: true,
                    depth: child_depth,
                    relative_units: child_units,
                    relative_components: child_components,
                });
            } else {
                add_file(
                    collector.files,
                    collector.total_bytes,
                    metadata,
                    collector.limits,
                )?;
                collector.layout.add_file(
                    metadata.identity,
                    child_components,
                    metadata.standard.EndOfFile as u64,
                )?;
                if let Some(custodied) = collector.custodied_files.as_mut() {
                    custodied.insert(metadata.identity, CustodiedFile::new(child, metadata));
                }
            }
        }
    }
    check_cancelled(is_cancelled)?;
    Ok(())
}

struct BorrowedNtHandle(HANDLE);

fn open_relative_borrowed(
    parent: &BorrowedNtHandle,
    component: &[u16],
    desired_access: windows::Win32::Storage::FileSystem::FILE_ACCESS_RIGHTS,
    share: windows::Win32::Storage::FileSystem::FILE_SHARE_MODE,
) -> Result<OwnedNtHandle, CustodyError> {
    validate_private_component_utf16(component)?;
    match nt_create_with_share(
        component,
        parent.0,
        desired_access,
        FILE_OPEN,
        FILE_SYNCHRONOUS_IO_NONALERT,
        share,
    ) {
        Ok(handle) => Ok(handle),
        Err(status) if status == windows::Win32::Foundation::STATUS_REPARSE_POINT_ENCOUNTERED => {
            Err(CustodyError::ReparsePointRejected)
        }
        Err(_) => Err(CustodyError::EnumerationFailed),
    }
}

fn next_directory_batch(
    handle: HANDLE,
    restart: bool,
) -> Result<Option<Vec<Vec<u16>>>, CustodyError> {
    let mut storage = vec![0u64; DIRECTORY_BUFFER_BYTES / size_of::<u64>()];
    let class = if restart {
        FileIdExtdDirectoryRestartInfo
    } else {
        FileIdExtdDirectoryInfo
    };
    // SAFETY: `storage` is aligned writable storage of exactly the supplied
    // size, and the information class returns FILE_ID_EXTD_DIR_INFO records.
    let result = unsafe {
        GetFileInformationByHandleEx(
            handle,
            class,
            storage.as_mut_ptr().cast::<c_void>(),
            DIRECTORY_BUFFER_BYTES as u32,
        )
    };
    if let Err(error) = result {
        if error.code() == HRESULT::from_win32(ERROR_NO_MORE_FILES.0) {
            return Ok(None);
        }
        return Err(CustodyError::EnumerationFailed);
    }
    let bytes = unsafe {
        std::slice::from_raw_parts(storage.as_ptr().cast::<u8>(), DIRECTORY_BUFFER_BYTES)
    };
    parse_directory_records(bytes).map(Some)
}

fn parse_directory_records(bytes: &[u8]) -> Result<Vec<Vec<u16>>, CustodyError> {
    let header_bytes = offset_of!(FILE_ID_EXTD_DIR_INFO, FileName);
    let mut offset = 0usize;
    let mut entries = Vec::new();
    loop {
        if offset
            .checked_add(header_bytes)
            .is_none_or(|end| end > bytes.len())
        {
            return Err(CustodyError::EnumerationFailed);
        }
        let record = bytes[offset..].as_ptr().cast::<FILE_ID_EXTD_DIR_INFO>();
        // SAFETY: the fixed header was bounds checked above. Fields are read
        // unaligned defensively even though valid record boundaries are required
        // to have the generated structure's documented LONGLONG alignment.
        let next = unsafe { ptr::addr_of!((*record).NextEntryOffset).read_unaligned() } as usize;
        let name_bytes =
            unsafe { ptr::addr_of!((*record).FileNameLength).read_unaligned() } as usize;
        if name_bytes == 0 || name_bytes % size_of::<u16>() != 0 {
            return Err(CustodyError::EnumerationFailed);
        }
        let name_start = offset + header_bytes;
        let name_end = name_start
            .checked_add(name_bytes)
            .ok_or(CustodyError::EnumerationFailed)?;
        let record_end = if next == 0 {
            bytes.len()
        } else {
            offset
                .checked_add(next)
                .ok_or(CustodyError::EnumerationFailed)?
        };
        if name_end > record_end
            || record_end > bytes.len()
            || (next != 0
                && (next < header_bytes || next % align_of::<FILE_ID_EXTD_DIR_INFO>() != 0))
        {
            return Err(CustodyError::EnumerationFailed);
        }
        let mut name = Vec::with_capacity(name_bytes / 2);
        for pair in bytes[name_start..name_end].chunks_exact(2) {
            name.push(u16::from_ne_bytes([pair[0], pair[1]]));
        }
        if name.as_slice() != [b'.' as u16] && name.as_slice() != [b'.' as u16, b'.' as u16] {
            validate_private_component_utf16(&name)?;
        }
        entries.push(name);
        if next == 0 {
            break;
        }
        offset = record_end;
    }
    Ok(entries)
}

fn add_file(
    files: &mut BTreeMap<FileIdentity, u64>,
    total_bytes: &mut u64,
    metadata: HandleMetadata,
    limits: InventoryLimits,
) -> Result<(), CustodyError> {
    if metadata.standard.Directory || metadata.standard.EndOfFile < 0 {
        return Err(CustodyError::UnsupportedEntry);
    }
    if files.len() >= limits.max_files {
        return Err(CustodyError::FileLimitExceeded);
    }
    let size = metadata.standard.EndOfFile as u64;
    let new_total = total_bytes
        .checked_add(size)
        .ok_or(CustodyError::ByteLimitExceeded)?;
    if new_total > limits.max_total_bytes {
        return Err(CustodyError::ByteLimitExceeded);
    }
    if files.insert(metadata.identity, size).is_some() {
        return Err(CustodyError::DuplicateIdentity);
    }
    *total_bytes = new_total;
    Ok(())
}

fn validate_limits(limits: InventoryLimits) -> Result<(), CustodyError> {
    if limits.max_files == 0
        || limits.max_files > DEFAULT_MAX_FILES
        || limits.max_entries < limits.max_files
        || limits.max_entries > DEFAULT_MAX_ENTRIES
        || limits.max_total_bytes == 0
        || limits.max_total_bytes > DEFAULT_MAX_BYTES
        || limits.max_layout_memory_bytes == 0
        || limits.max_layout_memory_bytes > DEFAULT_MAX_LAYOUT_MEMORY_BYTES
    {
        return Err(CustodyError::InvalidLimits);
    }
    Ok(())
}

fn check_cancelled<F>(is_cancelled: &mut F) -> Result<(), CustodyError>
where
    F: FnMut() -> bool,
{
    if is_cancelled() {
        Err(CustodyError::Cancelled)
    } else {
        Ok(())
    }
}

fn finalize_sha256(hasher: &Sha256) -> Sha256Digest {
    Sha256Digest::from_bytes(hasher.clone().finalize().into())
}

fn source_read_aggregate<F>(
    root_identity: FileIdentity,
    kind: SourceKind,
    total_bytes: u64,
    files: &BTreeMap<FileIdentity, SourceFileReadEvidence>,
    is_cancelled: &mut F,
) -> Result<Sha256Digest, CustodyError>
where
    F: FnMut() -> bool,
{
    // This is a domain-separated, fixed-width manifest digest. Its preimage is:
    // domain || root-volume(u64 BE) || root-file-id(16 bytes) || kind(u8) ||
    // file-count(u64 BE) || total-bytes(u64 BE), followed in ascending
    // FileIdentity order by volume(u64 BE) || file-id(16 bytes) ||
    // byte-count(u64 BE) || the helper-computed file SHA-256 (32 bytes).
    let mut aggregate = Sha256::new();
    aggregate.update(SOURCE_READ_DIGEST_DOMAIN);
    aggregate.update(root_identity.volume_serial.to_be_bytes());
    aggregate.update(root_identity.file_id);
    aggregate.update([match kind {
        SourceKind::File => 0,
        SourceKind::Folder => 1,
    }]);
    aggregate.update((files.len() as u64).to_be_bytes());
    aggregate.update(total_bytes.to_be_bytes());
    for (identity, evidence) in files {
        check_cancelled(is_cancelled)?;
        debug_assert_eq!(*identity, evidence.identity);
        aggregate.update(identity.volume_serial.to_be_bytes());
        aggregate.update(identity.file_id);
        aggregate.update(evidence.byte_count.to_be_bytes());
        aggregate.update(evidence.sha256.as_bytes());
    }
    check_cancelled(is_cancelled)?;
    Ok(Sha256Digest::from_bytes(aggregate.finalize().into()))
}

pub(crate) struct SourceLayoutDigestBuilder {
    sha256: Sha256,
    expected_directory_count: u32,
    expected_file_count: u32,
    observed_directory_count: u32,
    observed_file_count: u32,
}

impl SourceLayoutDigestBuilder {
    pub(crate) fn new(source_kind: SourceKind, directory_count: u32, file_count: u32) -> Self {
        let mut sha256 = Sha256::new();
        sha256.update(SOURCE_LAYOUT_DIGEST_DOMAIN);
        sha256.update([match source_kind {
            SourceKind::File => SOURCE_LAYOUT_SOURCE_FILE_TAG,
            SourceKind::Folder => SOURCE_LAYOUT_SOURCE_FOLDER_TAG,
        }]);
        sha256.update(directory_count.to_be_bytes());
        sha256.update(file_count.to_be_bytes());
        Self {
            sha256,
            expected_directory_count: directory_count,
            expected_file_count: file_count,
            observed_directory_count: 0,
            observed_file_count: 0,
        }
    }

    pub(crate) fn update_record<F>(
        &mut self,
        kind: SourceCatalogRecordKind,
        identity: FileIdentity,
        relative_components: &[Vec<u16>],
        file_size: Option<u64>,
        is_cancelled: &mut F,
    ) -> Result<(), CustodyError>
    where
        F: FnMut() -> bool,
    {
        check_cancelled(is_cancelled)?;
        match kind {
            SourceCatalogRecordKind::Directory => {
                self.observed_directory_count = self
                    .observed_directory_count
                    .checked_add(1)
                    .ok_or(CustodyError::EntryLimitExceeded)?;
                if self.observed_directory_count > self.expected_directory_count
                    || file_size.is_some()
                {
                    return Err(CustodyError::EnumerationFailed);
                }
            }
            SourceCatalogRecordKind::File => {
                self.observed_file_count = self
                    .observed_file_count
                    .checked_add(1)
                    .ok_or(CustodyError::FileLimitExceeded)?;
                if self.observed_file_count > self.expected_file_count
                    || file_size.is_none()
                    || relative_components.is_empty()
                {
                    return Err(CustodyError::EnumerationFailed);
                }
            }
        }

        let component_count = u32::try_from(relative_components.len())
            .map_err(|_| CustodyError::DepthLimitExceeded)?;
        self.sha256.update([kind.canonical_tag()]);
        self.sha256.update(identity.volume_serial.to_be_bytes());
        self.sha256.update(identity.file_id);
        self.sha256.update(component_count.to_be_bytes());
        for component in relative_components {
            check_cancelled(is_cancelled)?;
            validate_private_component_utf16(component)?;
            let unit_count =
                u32::try_from(component.len()).map_err(|_| CustodyError::PathLimitExceeded)?;
            self.sha256.update(unit_count.to_be_bytes());
            for unit in component {
                self.sha256.update(unit.to_be_bytes());
            }
        }
        if let Some(file_size) = file_size {
            self.sha256.update(file_size.to_be_bytes());
        }
        Ok(())
    }

    pub(crate) fn finish<F>(self, is_cancelled: &mut F) -> Result<Sha256Digest, CustodyError>
    where
        F: FnMut() -> bool,
    {
        check_cancelled(is_cancelled)?;
        if self.observed_directory_count != self.expected_directory_count
            || self.observed_file_count != self.expected_file_count
        {
            return Err(CustodyError::EnumerationFailed);
        }
        Ok(Sha256Digest::from_bytes(self.sha256.finalize().into()))
    }
}

fn source_layout_digest<F>(
    source_kind: SourceKind,
    directory_count: u32,
    file_count: u32,
    records: &BTreeMap<(u8, FileIdentity), SourceLayoutRecord>,
    is_cancelled: &mut F,
) -> Result<Sha256Digest, CustodyError>
where
    F: FnMut() -> bool,
{
    // Canonical VNSH-LAYOUT-V1 preimage (all integers are big-endian):
    // domain || source-kind(u8: file=1, folder=2) || directory-count(u32) ||
    // file-count(u32), followed by records held in a canonical BTreeMap keyed by
    // (kind, volume-serial, file-id). Each record is kind(u8: directory=1,
    // file=2) || volume-serial(u64) || file-id(16 raw bytes) ||
    // component-count(u32), followed by each exact, unnormalised component as
    // UTF-16-code-unit-count(u32) || repeated UTF-16 unit(u16). File records
    // alone end with file-size(u64). Folder roots use zero components; a
    // single selected file uses its leaf name as exactly one component.
    let mut digest = SourceLayoutDigestBuilder::new(source_kind, directory_count, file_count);

    for (stored_key, record) in records {
        check_cancelled(is_cancelled)?;
        let key = (record.kind.canonical_tag(), record.identity);
        if *stored_key != key {
            return Err(CustodyError::EnumerationFailed);
        }
        let kind = match record.kind {
            SourceLayoutRecordKind::Directory => SourceCatalogRecordKind::Directory,
            SourceLayoutRecordKind::File => SourceCatalogRecordKind::File,
        };
        digest.update_record(
            kind,
            record.identity,
            &record.relative_components,
            record.file_size,
            is_cancelled,
        )?;
    }
    digest.finish(is_cancelled)
}

fn canonical_leaf_component(path: &CanonicalDosPath) -> Result<Vec<u16>, CustodyError> {
    let path: Vec<u16> = path.as_str().encode_utf16().collect();
    let separator = path
        .iter()
        .rposition(|unit| *unit == b'\\' as u16)
        .ok_or(CustodyError::PrivatePathRejected)?;
    let leaf = path
        .get(separator + 1..)
        .ok_or(CustodyError::PrivatePathRejected)?;
    validate_private_component_utf16(leaf)?;
    Ok(leaf.to_vec())
}

fn validate_private_component_utf16(component: &[u16]) -> Result<(), CustodyError> {
    if component.is_empty()
        || component.len() > MAX_PRIVATE_PATH_SEGMENT_UTF16_UNITS
        || component == [b'.' as u16]
        || component == [b'.' as u16, b'.' as u16]
        || component
            .last()
            .is_some_and(|unit| matches!(*unit, 0x2e | 0x20))
        || component.iter().any(|unit| {
            matches!(
                *unit,
                0x0000..=0x001f
                    | 0x007f
                    | 0x0022
                    | 0x002a
                    | 0x002f
                    | 0x003a
                    | 0x003c
                    | 0x003e
                    | 0x003f
                    | 0x005c
                    | 0x007c
                    | 0x202a..=0x202e
                    | 0x2066..=0x2069
            )
        })
        || is_reserved_dos_name_utf16(component)
    {
        return Err(CustodyError::PrivatePathRejected);
    }
    Ok(())
}

fn is_reserved_dos_name_utf16(component: &[u16]) -> bool {
    let stem_end = component
        .iter()
        .position(|unit| *unit == b'.' as u16)
        .unwrap_or(component.len());
    let stem = &component[..stem_end];
    [
        b"CON".as_slice(),
        b"PRN".as_slice(),
        b"AUX".as_slice(),
        b"NUL".as_slice(),
        b"CLOCK$".as_slice(),
        b"CONIN$".as_slice(),
        b"CONOUT$".as_slice(),
    ]
    .iter()
    .any(|reserved| utf16_ascii_eq_ignore_case(stem, reserved))
        || has_reserved_numeric_suffix_utf16(stem, b"COM")
        || has_reserved_numeric_suffix_utf16(stem, b"LPT")
}

fn utf16_ascii_eq_ignore_case(actual: &[u16], expected: &[u8]) -> bool {
    actual.len() == expected.len()
        && actual
            .iter()
            .zip(expected)
            .all(|(actual, expected)| upper_ascii(*actual) == u16::from(*expected))
}

fn has_reserved_numeric_suffix_utf16(value: &[u16], prefix: &[u8; 3]) -> bool {
    value.len() == 4
        && utf16_ascii_eq_ignore_case(&value[..3], prefix)
        && matches!(value[3], 0x31..=0x39 | 0x00b9 | 0x00b2 | 0x00b3)
}

pub(crate) fn validate_component(component: &str) -> Result<Vec<u16>, CustodyError> {
    let component: Vec<u16> = component.encode_utf16().collect();
    validate_private_component_utf16(&component)?;
    Ok(component)
}

fn nul_terminated(value: &str) -> Vec<u16> {
    value.encode_utf16().chain([0]).collect()
}

const fn is_ascii_letter(unit: u16) -> bool {
    matches!(unit, 0x41..=0x5a | 0x61..=0x7a)
}

const fn upper_ascii(unit: u16) -> u16 {
    if matches!(unit, 0x61..=0x7a) {
        unit - 0x20
    } else {
        unit
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use super::*;

    #[test]
    fn identities_use_fixed_uppercase_hex() {
        let identity = FileIdentity::from_parts(
            0x0123_abcd_0000_00ef,
            [
                0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
            ],
        );
        assert_eq!(identity.volume_serial_hex(), "0123ABCD000000EF");
        assert_eq!(identity.file_id_hex(), "00010203040506070809AABBCCDDEEFF");
    }

    #[test]
    fn source_read_aggregate_has_a_fixed_domain_separated_vector() {
        let volume_serial = 0x0102_0304_0506_0708;
        let root = FileIdentity::from_parts(
            volume_serial,
            [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        );
        let first = FileIdentity::from_parts(
            volume_serial,
            [
                0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d,
                0x1e, 0x1f,
            ],
        );
        let second = FileIdentity::from_parts(
            volume_serial,
            [
                0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x2b, 0x2c, 0x2d,
                0x2e, 0x2f,
            ],
        );
        let mut files = BTreeMap::new();
        files.insert(
            first,
            SourceFileReadEvidence {
                identity: first,
                byte_count: 3,
                sha256: Sha256Digest::from_bytes(Sha256::digest(b"abc").into()),
            },
        );
        files.insert(
            second,
            SourceFileReadEvidence {
                identity: second,
                byte_count: 0,
                sha256: Sha256Digest::from_bytes(Sha256::digest([]).into()),
            },
        );

        assert_eq!(
            source_read_aggregate(root, SourceKind::Folder, 3, &files, &mut || false)
                .expect("fixed evidence should hash")
                .canonical(),
            "sha256:df7cf0030b9f819de788d0bc87582ebd79826099856c2a2f4c18452376bbb9db"
        );
    }

    #[test]
    fn source_layout_has_a_fixed_canonical_utf16_big_endian_vector() {
        assert_eq!(SOURCE_LAYOUT_SOURCE_FILE_TAG, 1);
        assert_eq!(SOURCE_LAYOUT_SOURCE_FOLDER_TAG, 2);
        assert_eq!(SOURCE_LAYOUT_DIRECTORY_RECORD_TAG, 1);
        assert_eq!(SOURCE_LAYOUT_FILE_RECORD_TAG, 2);

        let volume = 0x0102_0304_0506_0708;
        let root = FileIdentity::from_parts(
            volume,
            [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        );
        let empty_directory = FileIdentity::from_parts(
            volume,
            [
                0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d,
                0x1e, 0x1f,
            ],
        );
        let file = FileIdentity::from_parts(
            0x1112_1314_1516_1718,
            [
                0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x2b, 0x2c, 0x2d,
                0x2e, 0x2f,
            ],
        );
        let name: Vec<u16> = "Näme".encode_utf16().collect();
        let empty_leaf: Vec<u16> = "空".encode_utf16().collect();
        let file_leaf: Vec<u16> = "scan🧪.bin".encode_utf16().collect();

        // Insert deliberately out of order. The canonical table must still be
        // directory-first and then identity-ordered within each record kind.
        let mut builder = SourceLayoutBuilder::new(DEFAULT_MAX_LAYOUT_MEMORY_BYTES);
        builder
            .add_file(
                file,
                vec![name.clone(), file_leaf.clone()],
                0x2122_2324_2526_2728,
            )
            .expect("file layout record should be accepted");
        builder
            .add_directory(empty_directory, vec![name.clone(), empty_leaf.clone()])
            .expect("empty-directory layout record should be accepted");
        builder
            .add_directory(root, Vec::new())
            .expect("folder-root layout record should be accepted");
        let layout = builder
            .finish(SourceKind::Folder, &mut || false)
            .expect("fixed layout should hash");

        assert_eq!(layout.directory_count, 2);
        assert_eq!(layout.file_count, 1);
        assert_eq!(layout.records.len(), 3);
        let records: Vec<_> = layout.records.values().collect();
        assert_eq!(records[0].kind, SourceLayoutRecordKind::Directory);
        assert_eq!(records[0].identity, root);
        assert!(records[0].relative_components.is_empty());
        assert_eq!(records[1].identity, empty_directory);
        assert_eq!(records[1].relative_components, [name.clone(), empty_leaf]);
        assert_eq!(records[2].kind, SourceLayoutRecordKind::File);
        assert_eq!(records[2].identity, file);
        assert_eq!(records[2].relative_components, [name, file_leaf]);
        assert_eq!(records[2].file_size, Some(0x2122_2324_2526_2728));
        assert_eq!(
            layout.sha256.canonical(),
            "sha256:d65dfe65dd3db42dee0f7aaf166ecb4a71b45ead6e4e67d3b87019bc385de46e"
        );
    }

    #[test]
    fn source_layout_is_order_independent_but_exact_path_sensitive() {
        let volume = 7;
        let root = FileIdentity::from_parts(volume, [1; 16]);
        let file = FileIdentity::from_parts(volume, [2; 16]);
        let empty = FileIdentity::from_parts(volume, [3; 16]);

        let build = |path: Vec<Vec<u16>>, include_empty: bool, reverse: bool| {
            let mut builder = SourceLayoutBuilder::new(DEFAULT_MAX_LAYOUT_MEMORY_BYTES);
            if reverse {
                builder
                    .add_file(file, path.clone(), 11)
                    .expect("file should be accepted");
            }
            builder
                .add_directory(root, Vec::new())
                .expect("root should be accepted");
            if include_empty {
                builder
                    .add_directory(empty, vec!["empty".encode_utf16().collect()])
                    .expect("empty directory should be accepted");
            }
            if !reverse {
                builder
                    .add_file(file, path, 11)
                    .expect("file should be accepted");
            }
            builder
                .finish(SourceKind::Folder, &mut || false)
                .expect("layout should hash")
        };

        let original_path = vec![
            "parent".encode_utf16().collect(),
            "scan.ply".encode_utf16().collect(),
        ];
        assert_eq!(
            build(original_path.clone(), true, false),
            build(original_path.clone(), true, true),
            "enumeration order must not affect the canonical table or digest"
        );
        assert_ne!(
            build(original_path.clone(), true, false),
            build(
                vec![
                    "parent".encode_utf16().collect(),
                    "SCAN.ply".encode_utf16().collect(),
                ],
                true,
                false,
            ),
            "case-only renames must change the layout"
        );
        assert_ne!(
            build(original_path.clone(), true, false),
            build(
                vec![
                    "other-parent".encode_utf16().collect(),
                    "scan.ply".encode_utf16().collect(),
                ],
                true,
                false,
            ),
            "moves must change the layout"
        );
        assert_ne!(
            build(original_path.clone(), true, false),
            build(original_path, false, false),
            "empty-directory removal must change the layout"
        );
        assert_ne!(
            build(vec!["café.ply".encode_utf16().collect()], false, false,),
            build(
                vec!["cafe\u{301}.ply".encode_utf16().collect()],
                false,
                false,
            ),
            "canonically equivalent Unicode spellings must remain distinct"
        );
    }

    #[test]
    fn source_layout_rejects_identity_aliases_and_preserves_raw_utf16_units() {
        let identity = FileIdentity::from_parts(9, [4; 16]);
        let mut duplicate = SourceLayoutBuilder::new(DEFAULT_MAX_LAYOUT_MEMORY_BYTES);
        duplicate
            .add_directory(identity, vec!["first".encode_utf16().collect()])
            .expect("first identity use should be accepted");
        assert_eq!(
            duplicate.add_file(identity, vec!["second.bin".encode_utf16().collect()], 0),
            Err(CustodyError::DuplicateIdentity),
            "one filesystem identity cannot occupy two relative paths"
        );

        let raw_units = vec![0xd800, b'x' as u16];
        let mut raw = SourceLayoutBuilder::new(DEFAULT_MAX_LAYOUT_MEMORY_BYTES);
        raw.add_file(identity, vec![raw_units.clone()], 0)
            .expect("an exact NT UTF-16 component need not round-trip through UTF-8");
        let raw = raw
            .finish(SourceKind::File, &mut || false)
            .expect("raw UTF-16 layout should hash");
        assert_eq!(raw.directory_count, 0);
        assert_eq!(raw.file_count, 1);
        assert_eq!(
            raw.records
                .values()
                .next()
                .expect("one raw record should exist")
                .relative_components,
            [raw_units]
        );
    }

    #[test]
    fn single_file_layout_uses_exactly_one_leaf_component() {
        let identity = FileIdentity::from_parts(11, [5; 16]);
        let leaf: Vec<u16> = "Source.PLY".encode_utf16().collect();
        let mut builder = SourceLayoutBuilder::new(DEFAULT_MAX_LAYOUT_MEMORY_BYTES);
        builder
            .add_file(identity, vec![leaf.clone()], 123)
            .expect("single-file record should be accepted");
        let layout = builder
            .finish(SourceKind::File, &mut || false)
            .expect("single-file layout should hash");
        assert_eq!(layout.directory_count, 0);
        assert_eq!(layout.file_count, 1);
        let record = layout
            .records
            .values()
            .next()
            .expect("one single-file record should exist");
        assert_eq!(record.relative_components, [leaf]);
        assert_eq!(record.file_size, Some(123));
    }

    #[test]
    fn layout_memory_model_has_an_exact_boundary_and_keeps_flat_maximum_names_viable() {
        let root = FileIdentity::from_parts(12, [1; 16]);
        let file = FileIdentity::from_parts(12, [2; 16]);
        let maximum_leaf = vec![b'x' as u16; MAX_PRIVATE_PATH_SEGMENT_UTF16_UNITS];
        let file_record_bytes = modeled_layout_record_bytes(std::slice::from_ref(&maximum_leaf))
            .expect("maximum valid leaf should have a modeled size");
        assert_eq!(file_record_bytes, 704);
        let exact_budget = SOURCE_LAYOUT_MODELED_RECORD_BYTES + file_record_bytes;

        let mut exact = SourceLayoutBuilder::new(exact_budget);
        exact
            .add_directory(root, Vec::new())
            .expect("root should fit the exact budget");
        exact
            .add_file(file, vec![maximum_leaf.clone()], 0)
            .expect("record ending exactly at the limit should be retained");
        assert_eq!(exact.modeled_memory_bytes, exact_budget);

        let mut one_byte_short = SourceLayoutBuilder::new(exact_budget - 1);
        one_byte_short
            .add_directory(root, Vec::new())
            .expect("root should fit before the boundary failure");
        assert_eq!(
            one_byte_short.add_file(file, vec![maximum_leaf], 0),
            Err(CustodyError::LayoutMemoryLimitExceeded)
        );
        assert_eq!(
            one_byte_short.modeled_memory_bytes, SOURCE_LAYOUT_MODELED_RECORD_BYTES,
            "a rejected record must not consume the modeled budget"
        );
        assert!(!one_byte_short.identities.contains(&file));

        let realistic_flat_maximum = SOURCE_LAYOUT_MODELED_RECORD_BYTES
            .checked_add(
                file_record_bytes
                    .checked_mul(DEFAULT_MAX_FILES as u64)
                    .expect("flat source model should not overflow"),
            )
            .expect("flat source model should not overflow");
        assert!(realistic_flat_maximum <= DEFAULT_MAX_LAYOUT_MEMORY_BYTES);
    }

    #[test]
    fn layout_memory_model_fails_closed_on_checked_overflow_and_deep_repetition() {
        assert_eq!(
            modeled_layout_record_bytes_from_unit_counts([u64::MAX]),
            Err(CustodyError::LayoutMemoryLimitExceeded)
        );
        assert_eq!(
            CustodyError::LayoutMemoryLimitExceeded.to_string(),
            "the native layout memory limit was exceeded"
        );

        let maximum_component_bytes = modeled_layout_record_bytes_from_unit_counts([
            MAX_PRIVATE_PATH_SEGMENT_UTF16_UNITS as u64,
        ])
        .expect("one maximum component should be representable")
            - SOURCE_LAYOUT_MODELED_RECORD_BYTES;
        let deep_record_bytes = SOURCE_LAYOUT_MODELED_RECORD_BYTES
            + maximum_component_bytes * MAX_OPEN_DIRECTORY_DEPTH as u64;
        assert!(deep_record_bytes < DEFAULT_MAX_LAYOUT_MEMORY_BYTES);
        assert!(
            deep_record_bytes
                .checked_mul(143)
                .expect("test model should not overflow")
                > DEFAULT_MAX_LAYOUT_MEMORY_BYTES,
            "repeated deep paths must be bounded even while flat sources remain viable"
        );
    }

    #[test]
    fn canonical_layout_digest_and_deep_comparison_remain_cancellable() {
        fn build_layout() -> SourceLayout {
            let root = FileIdentity::from_parts(13, [1; 16]);
            let file = FileIdentity::from_parts(13, [2; 16]);
            let mut builder = SourceLayoutBuilder::new(DEFAULT_MAX_LAYOUT_MEMORY_BYTES);
            builder
                .add_directory(root, Vec::new())
                .expect("root should be accepted");
            builder
                .add_file(
                    file,
                    ["one", "two", "three", "scan.ply"]
                        .into_iter()
                        .map(|component| component.encode_utf16().collect())
                        .collect(),
                    17,
                )
                .expect("nested file should be accepted");
            builder
                .finish(SourceKind::Folder, &mut || false)
                .expect("layout should hash")
        }

        let left = build_layout();
        let right = build_layout();
        let comparison_polls = Cell::new(0usize);
        assert_eq!(
            left.matches_with_cancellation(&right, &mut || {
                let next = comparison_polls.get() + 1;
                comparison_polls.set(next);
                next == 4
            }),
            Err(CustodyError::Cancelled)
        );
        assert_eq!(comparison_polls.get(), 4);

        let root = FileIdentity::from_parts(14, [1; 16]);
        let file = FileIdentity::from_parts(14, [2; 16]);
        let mut builder = SourceLayoutBuilder::new(DEFAULT_MAX_LAYOUT_MEMORY_BYTES);
        builder
            .add_directory(root, Vec::new())
            .expect("root should be accepted");
        builder
            .add_file(file, vec!["scan.ply".encode_utf16().collect()], 17)
            .expect("file should be accepted");
        let digest_polls = Cell::new(0usize);
        assert!(matches!(
            builder.finish(SourceKind::Folder, &mut || {
                let next = digest_polls.get() + 1;
                digest_polls.set(next);
                next == 2
            }),
            Err(CustodyError::Cancelled)
        ));
        assert_eq!(digest_polls.get(), 2);
    }

    #[test]
    fn only_direct_harddisk_volume_targets_are_accepted() {
        let accepted: Vec<u16> = r"\Device\HarddiskVolume12".encode_utf16().collect();
        assert!(is_direct_local_dos_device_target(&accepted));
        for rejected in [
            r"\??\C:\private",
            r"\??\UNC\server\share",
            r"\Device\Mup\server\share",
            r"\Device\LanmanRedirector\;Z:000\server\share",
            r"\Device\HarddiskVolume",
            r"\Device\HarddiskVolume1\alias",
        ] {
            let rejected: Vec<u16> = rejected.encode_utf16().collect();
            assert!(!is_direct_local_dos_device_target(&rejected));
        }
    }

    #[test]
    fn private_component_validation_rejects_paths_and_devices() {
        assert!(validate_component("result.bin").is_ok());
        for rejected in ["", ".", "..", "a\\b", "a/b", "CON", "COM¹.txt"] {
            assert_eq!(
                validate_component(rejected),
                Err(CustodyError::PrivatePathRejected)
            );
        }
    }

    #[test]
    fn public_inventory_limits_cannot_relax_v1_hard_caps() {
        for limits in [
            InventoryLimits {
                max_files: DEFAULT_MAX_FILES + 1,
                ..InventoryLimits::default()
            },
            InventoryLimits {
                max_entries: DEFAULT_MAX_ENTRIES + 1,
                ..InventoryLimits::default()
            },
            InventoryLimits {
                max_total_bytes: DEFAULT_MAX_BYTES + 1,
                ..InventoryLimits::default()
            },
            InventoryLimits {
                max_layout_memory_bytes: 0,
                ..InventoryLimits::default()
            },
            InventoryLimits {
                max_layout_memory_bytes: DEFAULT_MAX_LAYOUT_MEMORY_BYTES + 1,
                ..InventoryLimits::default()
            },
        ] {
            assert_eq!(validate_limits(limits), Err(CustodyError::InvalidLimits));
        }
    }

    #[test]
    fn directory_record_parser_enforces_alignment_progress_and_bounds() {
        let first = directory_record("one.bin", true);
        let second = directory_record("two.bin", false);
        let mut valid = first.clone();
        valid.extend_from_slice(&second);
        assert_eq!(
            parse_directory_records(&valid).expect("valid record chain should parse"),
            [
                "one.bin".encode_utf16().collect::<Vec<_>>(),
                "two.bin".encode_utf16().collect::<Vec<_>>()
            ]
        );

        let mut unaligned = first.clone();
        write_u32(
            &mut unaligned,
            offset_of!(FILE_ID_EXTD_DIR_INFO, NextEntryOffset),
            (first.len() - 4) as u32,
        );
        assert_eq!(
            parse_directory_records(&unaligned),
            Err(CustodyError::EnumerationFailed)
        );

        let mut no_progress = first.clone();
        write_u32(
            &mut no_progress,
            offset_of!(FILE_ID_EXTD_DIR_INFO, NextEntryOffset),
            4,
        );
        assert_eq!(
            parse_directory_records(&no_progress),
            Err(CustodyError::EnumerationFailed)
        );

        let mut name_crosses_record = first;
        write_u32(
            &mut name_crosses_record,
            offset_of!(FILE_ID_EXTD_DIR_INFO, FileNameLength),
            u32::MAX,
        );
        assert_eq!(
            parse_directory_records(&name_crosses_record),
            Err(CustodyError::EnumerationFailed)
        );
    }

    fn directory_record(name: &str, has_next: bool) -> Vec<u8> {
        let encoded: Vec<u16> = name.encode_utf16().collect();
        let header = offset_of!(FILE_ID_EXTD_DIR_INFO, FileName);
        let used = header + encoded.len() * size_of::<u16>();
        let alignment = align_of::<FILE_ID_EXTD_DIR_INFO>();
        assert_eq!(alignment, 8);
        let record_size = (used + alignment - 1) & !(alignment - 1);
        let mut record = vec![0u8; record_size];
        write_u32(
            &mut record,
            offset_of!(FILE_ID_EXTD_DIR_INFO, NextEntryOffset),
            if has_next { record_size as u32 } else { 0 },
        );
        write_u32(
            &mut record,
            offset_of!(FILE_ID_EXTD_DIR_INFO, FileNameLength),
            (encoded.len() * size_of::<u16>()) as u32,
        );
        for (index, unit) in encoded.into_iter().enumerate() {
            let offset = header + index * 2;
            record[offset..offset + 2].copy_from_slice(&unit.to_ne_bytes());
        }
        record
    }

    fn write_u32(bytes: &mut [u8], offset: usize, value: u32) {
        bytes[offset..offset + size_of::<u32>()].copy_from_slice(&value.to_ne_bytes());
    }
}
