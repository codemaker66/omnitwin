use std::fmt;

use sha2::{Digest, Sha256};
use windows::Wdk::Storage::FileSystem::FILE_CREATE;
use windows::Win32::Foundation::STATUS_OBJECT_NAME_COLLISION;
use windows::Win32::Security::Cryptography::{BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG};
use windows::Win32::Storage::FileSystem::{
    FlushFileBuffers, WriteFile, FILE_ADD_FILE, FILE_ADD_SUBDIRECTORY, FILE_READ_ATTRIBUTES,
    FILE_WRITE_DATA, SYNCHRONIZE,
};

use crate::custody::{
    identity_for_created_handle, identity_for_created_output_file, open_relative,
    validate_output_file_handle, validate_retained_handle, FileIdentity, LocalVolumeEvidence,
    OwnedNtHandle, RetainedDirectory, RetainedSource, Sha256Digest,
};
use crate::path::{compare_canonical_dos_paths, CanonicalDosPath, PathRelation};
use crate::scope::ActiveCombinedScopeToken;

const WRITE_CHUNK_BYTES: usize = 1024 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OutputError {
    Cancelled,
    RootRejected,
    InvalidName,
    AlreadyExists,
    RandomFailed,
    CreateFailed,
    WriteFailed,
}

impl fmt::Display for OutputError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Cancelled => "the native output operation was cancelled",
            Self::RootRejected => "the output root was rejected",
            Self::InvalidName => "the output entry name was rejected",
            Self::AlreadyExists => "the fresh output entry already exists",
            Self::RandomFailed => "fresh output randomness was unavailable",
            Self::CreateFailed => "fresh output creation failed",
            Self::WriteFailed => "the retained output write failed",
        })
    }
}

impl std::error::Error for OutputError {}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OutputWriteEvidence {
    identity: FileIdentity,
    byte_count: u64,
    sha256: Sha256Digest,
}

impl OutputWriteEvidence {
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

pub struct RetainedOutputRoot {
    directory: RetainedDirectory,
}

impl RetainedOutputRoot {
    pub fn open(locator: &CanonicalDosPath) -> Result<Self, OutputError> {
        RetainedDirectory::open_output(locator)
            .map(|directory| Self { directory })
            .map_err(|_| OutputError::RootRejected)
    }

    #[must_use]
    pub const fn identity(&self) -> FileIdentity {
        self.directory.identity()
    }

    #[must_use]
    pub const fn local_volume_evidence(&self) -> LocalVolumeEvidence {
        self.directory.local_volume_evidence()
    }

    pub fn revalidate(&self) -> Result<(), OutputError> {
        validate_retained_handle(self.directory.handle(), self.directory.identity(), true)
            .map_err(|_| OutputError::RootRejected)
    }

    pub(crate) fn is_proven_disjoint_from_source(
        &self,
        source: &RetainedSource,
    ) -> Result<bool, OutputError> {
        let output_path = self.directory.canonical_path();
        let source_path = source.canonical_path();
        if same_volume_different_drive_is_ambiguous(
            output_path,
            self.identity().volume_serial_number(),
            source_path,
            source.local_volume_evidence().corroborated_volume_serial(),
        ) {
            // Two direct drive letters can address the same physical volume.
            // DOS-string ancestry is not authoritative across that alias, so
            // V1 rejects the pair rather than claiming it is disjoint.
            return Ok(false);
        }
        compare_canonical_dos_paths(output_path, source_path)
            .map(|relation| matches!(relation, PathRelation::Disjoint))
            .map_err(|_| OutputError::RootRejected)
    }

    pub(crate) fn acquire_custody<F>(
        &self,
        _authority: &ActiveCombinedScopeToken,
        mut is_cancelled: F,
    ) -> Result<OutputRootCustody, OutputError>
    where
        F: FnMut() -> bool,
    {
        check_cancelled(&mut is_cancelled)?;
        self.revalidate()?;
        check_cancelled(&mut is_cancelled)?;
        let handle = self
            .directory
            .acquire_output_custody()
            .map_err(|_| OutputError::RootRejected)?;
        check_cancelled(&mut is_cancelled)?;
        self.revalidate()?;
        validate_retained_handle(&handle, self.directory.identity(), true)
            .map_err(|_| OutputError::RootRejected)?;
        check_cancelled(&mut is_cancelled)?;
        Ok(OutputRootCustody {
            handle,
            identity: self.directory.identity(),
            local_volume_evidence: self.directory.local_volume_evidence(),
        })
    }
}

fn same_volume_different_drive_is_ambiguous(
    left_path: &str,
    left_volume_serial: u64,
    right_path: &str,
    right_volume_serial: u64,
) -> bool {
    left_volume_serial == right_volume_serial
        && !left_path[..1].eq_ignore_ascii_case(&right_path[..1])
}

pub(crate) struct OutputRootCustody {
    handle: OwnedNtHandle,
    identity: FileIdentity,
    local_volume_evidence: LocalVolumeEvidence,
}

impl OutputRootCustody {
    pub(crate) const fn identity(&self) -> FileIdentity {
        self.identity
    }

    pub(crate) const fn local_volume_evidence(&self) -> LocalVolumeEvidence {
        self.local_volume_evidence
    }

    pub(crate) fn revalidate(&self) -> Result<(), OutputError> {
        validate_retained_handle(&self.handle, self.identity, true)
            .map_err(|_| OutputError::RootRejected)
    }

    pub(crate) fn create_run_directory<F>(
        &self,
        _authority: &ActiveCombinedScopeToken,
        mut is_cancelled: F,
    ) -> Result<FreshRunDirectory, OutputError>
    where
        F: FnMut() -> bool,
    {
        check_cancelled(&mut is_cancelled)?;
        self.revalidate()?;
        let mut random_nonce = [0u8; 16];
        // SAFETY: the buffer is initialized writable memory. A null algorithm
        // handle is required with BCRYPT_USE_SYSTEM_PREFERRED_RNG.
        let status =
            unsafe { BCryptGenRandom(None, &mut random_nonce, BCRYPT_USE_SYSTEM_PREFERRED_RNG) };
        if status.0 < 0 {
            return Err(OutputError::RandomFailed);
        }
        check_cancelled(&mut is_cancelled)?;
        self.create_run_directory_from_nonce(random_nonce, &mut is_cancelled)
    }

    fn create_run_directory_from_nonce<F>(
        &self,
        random_nonce: [u8; 16],
        is_cancelled: &mut F,
    ) -> Result<FreshRunDirectory, OutputError>
    where
        F: FnMut() -> bool,
    {
        check_cancelled(is_cancelled)?;
        self.revalidate()?;
        let component = run_component(random_nonce);
        let handle = create_fresh(
            &self.handle,
            &component,
            true,
            FILE_ADD_FILE | FILE_ADD_SUBDIRECTORY | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
        )?;
        // Once FILE_CREATE succeeds, no fallible validation or cancellation
        // poll occurs before ownership returns to CombinedCustodyScope. The
        // scope stores this pending handle first, then validates and polls, so
        // every created artifact remains release-owned even on a later error.
        Ok(FreshRunDirectory {
            handle,
            identity: None,
        })
    }
}

pub(crate) struct FreshRunDirectory {
    handle: OwnedNtHandle,
    identity: Option<FileIdentity>,
}

impl FreshRunDirectory {
    pub(crate) fn validate_created(
        &mut self,
        expected_volume_serial: u64,
    ) -> Result<FileIdentity, OutputError> {
        if self.identity.is_some() {
            return Err(OutputError::CreateFailed);
        }
        let identity = identity_for_created_handle(&self.handle, expected_volume_serial, true)
            .map_err(|_| OutputError::CreateFailed)?;
        self.identity = Some(identity);
        Ok(identity)
    }

    pub(crate) fn create_file<F>(
        &self,
        _authority: &ActiveCombinedScopeToken,
        component: &str,
        mut is_cancelled: F,
    ) -> Result<OutputFile, OutputError>
    where
        F: FnMut() -> bool,
    {
        check_cancelled(&mut is_cancelled)?;
        self.revalidate()?;
        let handle = create_fresh(
            &self.handle,
            component,
            false,
            FILE_WRITE_DATA | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
        )?;
        // As with a run directory, the combined scope adopts this handle
        // before performing any fallible post-create work.
        Ok(OutputFile {
            handle,
            identity: None,
            bytes_written: 0,
            expected_number_of_links: 1,
            sha256: Sha256::new(),
        })
    }

    pub(crate) fn revalidate(&self) -> Result<(), OutputError> {
        validate_retained_handle(
            &self.handle,
            self.identity.ok_or(OutputError::CreateFailed)?,
            true,
        )
        .map_err(|_| OutputError::CreateFailed)
    }
}

pub(crate) struct OutputFile {
    handle: OwnedNtHandle,
    identity: Option<FileIdentity>,
    bytes_written: u64,
    expected_number_of_links: u32,
    sha256: Sha256,
}

impl OutputFile {
    pub(crate) fn validate_created(
        &mut self,
        expected_volume_serial: u64,
    ) -> Result<FileIdentity, OutputError> {
        if self.identity.is_some() {
            return Err(OutputError::CreateFailed);
        }
        let identity = identity_for_created_output_file(&self.handle, expected_volume_serial)
            .map_err(|_| OutputError::CreateFailed)?;
        self.identity = Some(identity);
        Ok(identity)
    }

    pub(crate) fn write_all<F>(
        &mut self,
        bytes: &[u8],
        mut is_cancelled: F,
    ) -> Result<(), OutputError>
    where
        F: FnMut() -> bool,
    {
        check_cancelled(&mut is_cancelled)?;
        self.revalidate()?;
        for chunk in bytes.chunks(WRITE_CHUNK_BYTES) {
            let mut consumed = 0usize;
            while consumed < chunk.len() {
                check_cancelled(&mut is_cancelled)?;
                let mut written = 0u32;
                // SAFETY: the retained handle is synchronous and open for
                // FILE_WRITE_DATA. The input slice remains alive for the call,
                // and `written` is valid writable storage.
                unsafe {
                    WriteFile(
                        self.handle.raw(),
                        Some(&chunk[consumed..]),
                        Some(&mut written),
                        None,
                    )
                }
                .map_err(|_| OutputError::WriteFailed)?;
                if written == 0 {
                    return Err(OutputError::WriteFailed);
                }
                let next_consumed = consumed
                    .checked_add(written as usize)
                    .ok_or(OutputError::WriteFailed)?;
                if next_consumed > chunk.len() {
                    return Err(OutputError::WriteFailed);
                }
                self.sha256.update(&chunk[consumed..next_consumed]);
                consumed = next_consumed;
                self.bytes_written = self
                    .bytes_written
                    .checked_add(u64::from(written))
                    .ok_or(OutputError::WriteFailed)?;
                check_cancelled(&mut is_cancelled)?;
            }
        }
        self.revalidate()?;
        check_cancelled(&mut is_cancelled)?;
        Ok(())
    }

    pub(crate) fn flush<F>(&self, mut is_cancelled: F) -> Result<(), OutputError>
    where
        F: FnMut() -> bool,
    {
        check_cancelled(&mut is_cancelled)?;
        self.revalidate()?;
        // SAFETY: the retained handle remains open for this call.
        unsafe { FlushFileBuffers(self.handle.raw()) }.map_err(|_| OutputError::WriteFailed)?;
        check_cancelled(&mut is_cancelled)?;
        self.revalidate()?;
        check_cancelled(&mut is_cancelled)
    }

    pub(crate) fn finish<F>(&self, mut is_cancelled: F) -> Result<OutputWriteEvidence, OutputError>
    where
        F: FnMut() -> bool,
    {
        check_cancelled(&mut is_cancelled)?;
        self.flush(&mut is_cancelled)?;
        let evidence = OutputWriteEvidence {
            identity: self.identity.ok_or(OutputError::WriteFailed)?,
            byte_count: self.bytes_written,
            sha256: Sha256Digest::from_bytes(self.sha256.clone().finalize().into()),
        };
        check_cancelled(&mut is_cancelled)?;
        Ok(evidence)
    }

    #[must_use]
    pub(crate) const fn bytes_written(&self) -> u64 {
        self.bytes_written
    }

    pub(crate) fn revalidate(&self) -> Result<(), OutputError> {
        // This detects a persistent reverse hardlink at every observable
        // checkpoint. A link created and removed wholly between checkpoints is
        // not observable from FILE_STANDARD_INFO; excluding that stronger race
        // requires an additional OS policy or separately specified oplock.
        validate_output_file_handle(
            &self.handle,
            self.identity.ok_or(OutputError::WriteFailed)?,
            self.bytes_written,
            self.expected_number_of_links,
        )
        .map_err(|_| OutputError::WriteFailed)
    }
}

fn check_cancelled<F>(is_cancelled: &mut F) -> Result<(), OutputError>
where
    F: FnMut() -> bool,
{
    if is_cancelled() {
        Err(OutputError::Cancelled)
    } else {
        Ok(())
    }
}

fn create_fresh(
    parent: &OwnedNtHandle,
    component: &str,
    directory: bool,
    desired_access: windows::Win32::Storage::FileSystem::FILE_ACCESS_RIGHTS,
) -> Result<OwnedNtHandle, OutputError> {
    match open_relative(parent, component, directory, desired_access, FILE_CREATE) {
        Ok(handle) => Ok(handle),
        Err(status) if status == STATUS_OBJECT_NAME_COLLISION => Err(OutputError::AlreadyExists),
        Err(status) if status == windows::Win32::Foundation::STATUS_OBJECT_NAME_INVALID => {
            Err(OutputError::InvalidName)
        }
        Err(_) => Err(OutputError::CreateFailed),
    }
}

fn run_component(random_nonce: [u8; 16]) -> String {
    let mut component = String::with_capacity(36);
    component.push_str("run-");
    component.push_str(&hex::encode_upper(random_nonce));
    component
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_component_is_fixed_and_neutral() {
        assert_eq!(
            run_component([0xab; 16]),
            "run-ABABABABABABABABABABABABABABABAB"
        );
    }

    #[test]
    fn same_volume_cross_drive_alias_is_never_claimed_disjoint() {
        assert!(same_volume_different_drive_is_ambiguous(
            r"C:\output",
            7,
            r"Z:\output\source.bin",
            7
        ));
        assert!(!same_volume_different_drive_is_ambiguous(
            r"C:\output",
            7,
            r"D:\source.bin",
            8
        ));
        assert!(!same_volume_different_drive_is_ambiguous(
            r"C:\output",
            7,
            r"C:\source.bin",
            7
        ));
    }
}
