//! Request-bound source and output custody.
//!
//! This module deliberately stops at the native handle boundary. NDJSON,
//! session/request references, binary pipes, out-of-band cancellation control,
//! and packaged-process teardown are not implemented or verified here.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::rc::Rc;

use crate::custody::{
    CustodyError, FileIdentity, InventoryLimits, LocalVolumeEvidence, RetainedSource, SourceKind,
    SourceReadCustody, SourceReadEvidence, DEFAULT_MAX_BYTES, DEFAULT_MAX_ENTRIES,
    DEFAULT_MAX_FILES, DEFAULT_MAX_LAYOUT_MEMORY_BYTES,
};
use crate::output::{
    FreshRunDirectory, OutputError, OutputFile, OutputRootCustody, OutputWriteEvidence,
    RetainedOutputRoot,
};

pub const DEFAULT_MAX_SOURCE_ROOTS: usize = 128;
pub const DEFAULT_MAX_SCOPE_BYTES: u64 = 8 * 1024 * 1024 * 1024 * 1024;
pub const DEFAULT_MAX_OUTPUT_FILES: usize = 100_000;
pub const DEFAULT_MAX_RETAINED_LAYOUT_MEMORY_BYTES: u64 = DEFAULT_MAX_LAYOUT_MEMORY_BYTES;

/// Unforgeable in safe Rust outside this module. The output module requires a
/// borrowed token for every strict-root/run/file creation step, which prevents
/// another helper module from bypassing `CombinedCustodyScope` via crate-local
/// implementation types.
pub(crate) struct ActiveCombinedScopeToken(());

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CombinedCustodyLimits {
    pub per_source: InventoryLimits,
    pub max_source_roots: usize,
    pub max_total_entries: usize,
    pub max_total_files: usize,
    pub max_total_bytes: u64,
    pub max_retained_layout_memory_bytes: u64,
    pub max_output_files: usize,
}

impl Default for CombinedCustodyLimits {
    fn default() -> Self {
        Self {
            per_source: InventoryLimits::default(),
            max_source_roots: DEFAULT_MAX_SOURCE_ROOTS,
            max_total_entries: DEFAULT_MAX_ENTRIES,
            max_total_files: DEFAULT_MAX_FILES,
            max_total_bytes: DEFAULT_MAX_SCOPE_BYTES,
            max_retained_layout_memory_bytes: DEFAULT_MAX_RETAINED_LAYOUT_MEMORY_BYTES,
            max_output_files: DEFAULT_MAX_OUTPUT_FILES,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CombinedCustodyError {
    Cancelled,
    InvalidLimits,
    EmptySourceSet,
    SourceLimitExceeded,
    EntryLimitExceeded,
    FileLimitExceeded,
    ByteLimitExceeded,
    LayoutMemoryLimitExceeded,
    OutputFileLimitExceeded,
    IdentityCollision,
    SourceRejected(CustodyError),
    OutputRejected(OutputError),
    RunAlreadyCreated,
    RunRequired,
    SourceIdentityUnknown,
    OutputIdentityUnknown,
    OperationOrderRejected,
    ScopeTerminal,
}

impl fmt::Display for CombinedCustodyError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Cancelled => "the combined native custody operation was cancelled",
            Self::InvalidLimits => "the combined native custody limits are invalid",
            Self::EmptySourceSet => "the combined native custody source set is empty",
            Self::SourceLimitExceeded => "the combined native custody source limit was exceeded",
            Self::EntryLimitExceeded => "the combined native custody entry limit was exceeded",
            Self::FileLimitExceeded => "the combined native custody file limit was exceeded",
            Self::ByteLimitExceeded => "the combined native custody byte limit was exceeded",
            Self::LayoutMemoryLimitExceeded => {
                "the combined native custody layout memory limit was exceeded"
            }
            Self::OutputFileLimitExceeded => {
                "the combined native custody output-file limit was exceeded"
            }
            Self::IdentityCollision => "a filesystem identity collision was rejected",
            Self::SourceRejected(_) => "a source custody operation was rejected",
            Self::OutputRejected(_) => "an output custody operation was rejected",
            Self::RunAlreadyCreated => "the fresh run directory was already created",
            Self::RunRequired => "a fresh run directory has not been created",
            Self::SourceIdentityUnknown => "the source identity is not in this custody scope",
            Self::OutputIdentityUnknown => "the output identity is not in this custody scope",
            Self::OperationOrderRejected => "the custody operation order was rejected",
            Self::ScopeTerminal => "the custody scope is terminal and must be released",
        })
    }
}

impl std::error::Error for CombinedCustodyError {}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CustodiedSourceSummary {
    root_identity: FileIdentity,
    kind: SourceKind,
    directory_count: usize,
    file_count: usize,
    total_bytes: u64,
    local_volume_evidence: LocalVolumeEvidence,
}

impl CustodiedSourceSummary {
    #[must_use]
    pub const fn root_identity(&self) -> FileIdentity {
        self.root_identity
    }

    #[must_use]
    pub const fn kind(&self) -> SourceKind {
        self.kind
    }

    #[must_use]
    pub const fn directory_count(&self) -> usize {
        self.directory_count
    }

    #[must_use]
    pub const fn file_count(&self) -> usize {
        self.file_count
    }

    #[must_use]
    pub const fn total_bytes(&self) -> u64 {
        self.total_bytes
    }

    #[must_use]
    pub const fn local_volume_evidence(&self) -> LocalVolumeEvidence {
        self.local_volume_evidence
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CustodiedOutputSummary {
    root_identity: FileIdentity,
    local_volume_evidence: LocalVolumeEvidence,
}

impl CustodiedOutputSummary {
    #[must_use]
    pub const fn root_identity(&self) -> FileIdentity {
        self.root_identity
    }

    #[must_use]
    pub const fn local_volume_evidence(&self) -> LocalVolumeEvidence {
        self.local_volume_evidence
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[must_use]
pub struct CustodyReleaseEvidence {
    source_count: usize,
    source_file_count: usize,
    output_root_identity: FileIdentity,
    had_run_directory: bool,
    retained_output_file_count: usize,
}

impl CustodyReleaseEvidence {
    #[must_use]
    pub const fn source_count(&self) -> usize {
        self.source_count
    }

    #[must_use]
    pub const fn source_file_count(&self) -> usize {
        self.source_file_count
    }

    #[must_use]
    pub const fn output_root_identity(&self) -> FileIdentity {
        self.output_root_identity
    }

    #[must_use]
    pub const fn had_run_directory(&self) -> bool {
        self.had_run_directory
    }

    #[must_use]
    pub const fn retained_output_file_count(&self) -> usize {
        self.retained_output_file_count
    }
}

/// Owns the exact restrictive source handles and output-root handle for one
/// native request. Every later run/file handle is also stored inside this
/// object, so no child object can outlive a consuming [`Self::release`].
///
/// Run creation is intentionally absent from [`RetainedOutputRoot`]:
///
/// ```compile_fail
/// use venviewer_windows_source_helper::output::RetainedOutputRoot;
/// fn cannot_create_before_scope(root: &RetainedOutputRoot) {
///     let _ = root.create_run_directory(|| false);
/// }
/// ```
pub struct CombinedCustodyScope {
    authority: ActiveCombinedScopeToken,
    sources: Vec<SourceReadCustody>,
    source_index_by_file: BTreeMap<FileIdentity, usize>,
    source_summaries: Vec<CustodiedSourceSummary>,
    output_root: OutputRootCustody,
    run: Option<FreshRunDirectory>,
    pending_output_file: Option<OutputFile>,
    output_files: BTreeMap<FileIdentity, OutputFile>,
    finished_output_files: BTreeSet<FileIdentity>,
    claimed_identities: BTreeSet<FileIdentity>,
    source_reads_finished: bool,
    output_files_created: usize,
    terminal: bool,
    limits: CombinedCustodyLimits,
}

impl CombinedCustodyScope {
    /// Acquires the output root and every source as one fail-closed unit.
    /// Locals own each successfully acquired handle, so any later rejection or
    /// cancellation automatically rolls the partial set back before returning.
    /// This is logical all-or-none ownership, not a transactional filesystem
    /// snapshot; the final revalidation and retained restrictive handles are
    /// the observable race checks supplied by this slice.
    pub fn acquire<F>(
        sources: &[Rc<RetainedSource>],
        output_root: &RetainedOutputRoot,
        limits: CombinedCustodyLimits,
        mut is_cancelled: F,
    ) -> Result<Self, CombinedCustodyError>
    where
        F: FnMut() -> bool,
    {
        validate_limits(limits)?;
        check_cancelled(&mut is_cancelled)?;
        if sources.is_empty() {
            return Err(CombinedCustodyError::EmptySourceSet);
        }
        if sources.len() > limits.max_source_roots {
            return Err(CombinedCustodyError::SourceLimitExceeded);
        }

        let mut claimed_identities = BTreeSet::new();
        let mut total_entries = 0usize;
        let mut total_files = 0usize;
        let mut total_bytes = 0u64;
        let mut retained_layout_memory_bytes = 0u64;
        let output_identity = output_root.identity();
        let output_volume = output_root.local_volume_evidence();
        if output_volume.corroborated_volume_serial() != output_identity.volume_serial_number() {
            return Err(CombinedCustodyError::OutputRejected(
                OutputError::RootRejected,
            ));
        }
        claimed_identities.insert(output_identity);

        for source in sources {
            check_cancelled(&mut is_cancelled)?;
            if !output_root
                .is_proven_disjoint_from_source(source)
                .map_err(map_output_error)?
            {
                return Err(CombinedCustodyError::IdentityCollision);
            }
            let inventory = source.inventory();
            let volume = source.local_volume_evidence();
            if volume.corroborated_volume_serial()
                != inventory.root_identity().volume_serial_number()
            {
                return Err(CombinedCustodyError::SourceRejected(
                    CustodyError::VolumeIdentityMismatch,
                ));
            }
            retained_layout_memory_bytes = checked_add_retained_layout_memory(
                retained_layout_memory_bytes,
                inventory.modeled_layout_memory_bytes(),
                limits.max_retained_layout_memory_bytes,
                &mut is_cancelled,
            )?;
            total_entries = total_entries
                .checked_add(inventory.directory_count())
                .and_then(|count| count.checked_add(inventory.file_count()))
                .ok_or(CombinedCustodyError::EntryLimitExceeded)?;
            if total_entries > limits.max_total_entries {
                return Err(CombinedCustodyError::EntryLimitExceeded);
            }
            total_files = total_files
                .checked_add(inventory.file_count())
                .ok_or(CombinedCustodyError::FileLimitExceeded)?;
            if total_files > limits.max_total_files {
                return Err(CombinedCustodyError::FileLimitExceeded);
            }
            total_bytes = total_bytes
                .checked_add(inventory.total_bytes())
                .ok_or(CombinedCustodyError::ByteLimitExceeded)?;
            if total_bytes > limits.max_total_bytes {
                return Err(CombinedCustodyError::ByteLimitExceeded);
            }
            for identity in inventory.identities() {
                check_cancelled(&mut is_cancelled)?;
                if identity.volume_serial_number() != volume.corroborated_volume_serial() {
                    return Err(CombinedCustodyError::SourceRejected(
                        CustodyError::VolumeIdentityMismatch,
                    ));
                }
                if !claimed_identities.insert(identity) {
                    return Err(CombinedCustodyError::IdentityCollision);
                }
            }
        }
        check_cancelled(&mut is_cancelled)?;

        let authority = ActiveCombinedScopeToken(());
        let output_root = output_root
            .acquire_custody(&authority, &mut is_cancelled)
            .map_err(map_output_error)?;
        check_cancelled(&mut is_cancelled)?;

        let mut source_custodies = Vec::with_capacity(sources.len());
        for source in sources {
            check_cancelled(&mut is_cancelled)?;
            let custody = source
                .begin_read_custody(limits.per_source, &mut is_cancelled)
                .map_err(map_source_error)?;
            source_custodies.push(custody);
            check_cancelled(&mut is_cancelled)?;
        }

        output_root.revalidate().map_err(map_output_error)?;
        for source in &source_custodies {
            source
                .revalidate_live(limits.per_source, &mut is_cancelled)
                .map_err(map_source_error)?;
            check_cancelled(&mut is_cancelled)?;
        }
        output_root.revalidate().map_err(map_output_error)?;
        check_cancelled(&mut is_cancelled)?;

        let mut source_index_by_file = BTreeMap::new();
        let mut source_summaries = Vec::with_capacity(source_custodies.len());
        for (source_index, source) in source_custodies.iter().enumerate() {
            for identity in source.file_identities() {
                check_cancelled(&mut is_cancelled)?;
                if source_index_by_file
                    .insert(identity, source_index)
                    .is_some()
                {
                    return Err(CombinedCustodyError::IdentityCollision);
                }
            }
            source_summaries.push(CustodiedSourceSummary {
                root_identity: source.root_identity(),
                kind: source.kind(),
                directory_count: source.inventory().directory_count(),
                file_count: source.inventory().file_count(),
                total_bytes: source.inventory().total_bytes(),
                local_volume_evidence: source.local_volume_evidence(),
            });
        }
        check_cancelled(&mut is_cancelled)?;

        Ok(Self {
            authority,
            sources: source_custodies,
            source_index_by_file,
            source_summaries,
            output_root,
            run: None,
            pending_output_file: None,
            output_files: BTreeMap::new(),
            finished_output_files: BTreeSet::new(),
            claimed_identities,
            source_reads_finished: false,
            output_files_created: 0,
            terminal: false,
            limits,
        })
    }

    pub fn source_summaries(&self) -> impl ExactSizeIterator<Item = CustodiedSourceSummary> + '_ {
        self.source_summaries.iter().copied()
    }

    #[must_use]
    pub const fn output_summary(&self) -> CustodiedOutputSummary {
        CustodiedOutputSummary {
            root_identity: self.output_root.identity(),
            local_volume_evidence: self.output_root.local_volume_evidence(),
        }
    }

    pub fn source_file_identities(&self) -> impl ExactSizeIterator<Item = FileIdentity> + '_ {
        self.source_index_by_file.keys().copied()
    }

    pub fn read_source_chunk<F>(
        &mut self,
        identity: FileIdentity,
        buffer: &mut [u8],
        is_cancelled: F,
    ) -> Result<usize, CombinedCustodyError>
    where
        F: FnMut() -> bool,
    {
        self.ensure_active()?;
        let result = self.read_source_chunk_inner(identity, buffer, is_cancelled);
        self.record_safety_result(result)
    }

    fn read_source_chunk_inner<F>(
        &mut self,
        identity: FileIdentity,
        buffer: &mut [u8],
        mut is_cancelled: F,
    ) -> Result<usize, CombinedCustodyError>
    where
        F: FnMut() -> bool,
    {
        if self.source_reads_finished {
            return Err(CombinedCustodyError::OperationOrderRejected);
        }
        check_cancelled(&mut is_cancelled)?;
        let source_index = *self
            .source_index_by_file
            .get(&identity)
            .ok_or(CombinedCustodyError::SourceIdentityUnknown)?;
        let read = self.sources[source_index]
            .read_chunk(identity, buffer, &mut is_cancelled)
            .map_err(map_source_error)?;
        check_cancelled(&mut is_cancelled)?;
        Ok(read)
    }

    pub fn finish_source_reads<F>(
        &mut self,
        is_cancelled: F,
    ) -> Result<Vec<SourceReadEvidence>, CombinedCustodyError>
    where
        F: FnMut() -> bool,
    {
        self.ensure_active()?;
        let result = self.finish_source_reads_inner(is_cancelled);
        self.record_safety_result(result)
    }

    fn finish_source_reads_inner<F>(
        &mut self,
        mut is_cancelled: F,
    ) -> Result<Vec<SourceReadEvidence>, CombinedCustodyError>
    where
        F: FnMut() -> bool,
    {
        if self.source_reads_finished {
            return Err(CombinedCustodyError::OperationOrderRejected);
        }
        check_cancelled(&mut is_cancelled)?;
        let mut evidence = Vec::with_capacity(self.sources.len());
        for source in &self.sources {
            evidence.push(
                source
                    .finish_evidence(self.limits.per_source, &mut is_cancelled)
                    .map_err(map_source_error)?,
            );
            check_cancelled(&mut is_cancelled)?;
        }
        self.output_root.revalidate().map_err(map_output_error)?;
        check_cancelled(&mut is_cancelled)?;
        self.source_reads_finished = true;
        Ok(evidence)
    }

    pub fn create_run_directory<F>(
        &mut self,
        is_cancelled: F,
    ) -> Result<FileIdentity, CombinedCustodyError>
    where
        F: FnMut() -> bool,
    {
        self.ensure_active()?;
        let result = self.create_run_directory_inner(is_cancelled);
        self.record_safety_result(result)
    }

    fn create_run_directory_inner<F>(
        &mut self,
        mut is_cancelled: F,
    ) -> Result<FileIdentity, CombinedCustodyError>
    where
        F: FnMut() -> bool,
    {
        if self.run.is_some() {
            return Err(CombinedCustodyError::RunAlreadyCreated);
        }
        check_cancelled(&mut is_cancelled)?;
        self.revalidate_sources(&mut is_cancelled)?;
        self.output_root.revalidate().map_err(map_output_error)?;
        let pending_run = self
            .output_root
            .create_run_directory(&self.authority, &mut is_cancelled)
            .map_err(map_output_error)?;
        // Adopt the FILE_CREATE handle before any post-create validation or
        // final cancellation poll. A later error poisons the scope, but release
        // still owns and closes this exact handle.
        self.run = Some(pending_run);
        let identity = self
            .run
            .as_mut()
            .expect("pending run was just stored")
            .validate_created(self.output_root.identity().volume_serial_number())
            .map_err(map_output_error)?;
        if self.claimed_identities.contains(&identity) {
            return Err(CombinedCustodyError::IdentityCollision);
        }
        self.claimed_identities.insert(identity);
        self.run
            .as_ref()
            .expect("validated run remains stored")
            .revalidate()
            .map_err(map_output_error)?;
        self.output_root.revalidate().map_err(map_output_error)?;
        self.revalidate_sources(&mut is_cancelled)?;
        check_cancelled(&mut is_cancelled)?;
        Ok(identity)
    }

    pub fn create_output_file<F>(
        &mut self,
        component: &str,
        is_cancelled: F,
    ) -> Result<FileIdentity, CombinedCustodyError>
    where
        F: FnMut() -> bool,
    {
        self.ensure_active()?;
        let result = self.create_output_file_inner(component, is_cancelled);
        self.record_safety_result(result)
    }

    fn create_output_file_inner<F>(
        &mut self,
        component: &str,
        mut is_cancelled: F,
    ) -> Result<FileIdentity, CombinedCustodyError>
    where
        F: FnMut() -> bool,
    {
        if self.pending_output_file.is_some() {
            return Err(CombinedCustodyError::OperationOrderRejected);
        }
        if self.output_files_created >= self.limits.max_output_files {
            return Err(CombinedCustodyError::OutputFileLimitExceeded);
        }
        check_cancelled(&mut is_cancelled)?;
        self.validate_output_base(&mut is_cancelled)?;
        let pending_output = self
            .run
            .as_ref()
            .ok_or(CombinedCustodyError::RunRequired)?
            .create_file(&self.authority, component, &mut is_cancelled)
            .map_err(map_output_error)?;
        // Count and adopt the successful FILE_CREATE immediately. Even if its
        // identity check or final cancellation poll fails, the terminal scope
        // retains the handle and the bounded attempt cannot be repeated.
        self.output_files_created += 1;
        self.pending_output_file = Some(pending_output);
        let identity = self
            .pending_output_file
            .as_mut()
            .expect("pending output was just stored")
            .validate_created(self.output_root.identity().volume_serial_number())
            .map_err(map_output_error)?;
        if self.claimed_identities.contains(&identity) {
            return Err(CombinedCustodyError::IdentityCollision);
        }
        self.claimed_identities.insert(identity);
        self.pending_output_file
            .as_ref()
            .expect("validated output remains stored")
            .revalidate()
            .map_err(map_output_error)?;
        self.validate_output_base(&mut is_cancelled)?;
        check_cancelled(&mut is_cancelled)?;
        let output = self
            .pending_output_file
            .take()
            .expect("validated output remains stored");
        self.output_files.insert(identity, output);
        Ok(identity)
    }

    pub fn output_file_identities(&self) -> impl ExactSizeIterator<Item = FileIdentity> + '_ {
        self.output_files.keys().copied()
    }

    pub fn output_bytes_written(
        &self,
        identity: FileIdentity,
    ) -> Result<u64, CombinedCustodyError> {
        self.ensure_active()?;
        self.output_files
            .get(&identity)
            .map(OutputFile::bytes_written)
            .ok_or(CombinedCustodyError::OutputIdentityUnknown)
    }

    pub fn write_output_bytes<F>(
        &mut self,
        identity: FileIdentity,
        bytes: &[u8],
        is_cancelled: F,
    ) -> Result<(), CombinedCustodyError>
    where
        F: FnMut() -> bool,
    {
        self.ensure_active()?;
        let result = self.write_output_bytes_inner(identity, bytes, is_cancelled);
        self.record_safety_result(result)
    }

    fn write_output_bytes_inner<F>(
        &mut self,
        identity: FileIdentity,
        bytes: &[u8],
        mut is_cancelled: F,
    ) -> Result<(), CombinedCustodyError>
    where
        F: FnMut() -> bool,
    {
        if self.finished_output_files.contains(&identity) {
            return Err(CombinedCustodyError::OperationOrderRejected);
        }
        check_cancelled(&mut is_cancelled)?;
        self.validate_output_base(&mut is_cancelled)?;
        self.output_files
            .get_mut(&identity)
            .ok_or(CombinedCustodyError::OutputIdentityUnknown)?
            .write_all(bytes, &mut is_cancelled)
            .map_err(map_output_error)?;
        self.validate_output_base(&mut is_cancelled)?;
        check_cancelled(&mut is_cancelled)
    }

    pub fn finish_output_file<F>(
        &mut self,
        identity: FileIdentity,
        is_cancelled: F,
    ) -> Result<OutputWriteEvidence, CombinedCustodyError>
    where
        F: FnMut() -> bool,
    {
        self.ensure_active()?;
        let result = self.finish_output_file_inner(identity, is_cancelled);
        self.record_safety_result(result)
    }

    fn finish_output_file_inner<F>(
        &mut self,
        identity: FileIdentity,
        mut is_cancelled: F,
    ) -> Result<OutputWriteEvidence, CombinedCustodyError>
    where
        F: FnMut() -> bool,
    {
        if self.finished_output_files.contains(&identity) {
            return Err(CombinedCustodyError::OperationOrderRejected);
        }
        check_cancelled(&mut is_cancelled)?;
        self.validate_output_base(&mut is_cancelled)?;
        let evidence = self
            .output_files
            .get(&identity)
            .ok_or(CombinedCustodyError::OutputIdentityUnknown)?
            .finish(&mut is_cancelled)
            .map_err(map_output_error)?;
        self.validate_output_base(&mut is_cancelled)?;
        check_cancelled(&mut is_cancelled)?;
        self.finished_output_files.insert(identity);
        Ok(evidence)
    }

    pub fn release(self) -> CustodyReleaseEvidence {
        let evidence = CustodyReleaseEvidence {
            source_count: self.sources.len(),
            source_file_count: self.source_index_by_file.len(),
            output_root_identity: self.output_root.identity(),
            had_run_directory: self.run.is_some(),
            retained_output_file_count: self.output_files.len()
                + usize::from(self.pending_output_file.is_some()),
        };
        // Explicitly destroy the complete object before acknowledging release.
        // Since no handle-owning child is returned from this API, this closes
        // every restrictive source/output/run/file handle owned by the scope.
        drop(self);
        evidence
    }

    #[must_use]
    pub const fn is_terminal(&self) -> bool {
        self.terminal
    }

    fn revalidate_sources<F>(&self, mut is_cancelled: F) -> Result<(), CombinedCustodyError>
    where
        F: FnMut() -> bool,
    {
        check_cancelled(&mut is_cancelled)?;
        for source in &self.sources {
            source
                .revalidate_live(self.limits.per_source, &mut is_cancelled)
                .map_err(map_source_error)?;
            check_cancelled(&mut is_cancelled)?;
        }
        Ok(())
    }

    fn validate_output_base<F>(&self, mut is_cancelled: F) -> Result<(), CombinedCustodyError>
    where
        F: FnMut() -> bool,
    {
        check_cancelled(&mut is_cancelled)?;
        self.output_root.revalidate().map_err(map_output_error)?;
        check_cancelled(&mut is_cancelled)?;
        if let Some(run) = &self.run {
            run.revalidate().map_err(map_output_error)?;
            check_cancelled(&mut is_cancelled)?;
        }
        Ok(())
    }

    fn ensure_active(&self) -> Result<(), CombinedCustodyError> {
        if self.terminal {
            Err(CombinedCustodyError::ScopeTerminal)
        } else {
            Ok(())
        }
    }

    fn record_safety_result<T>(
        &mut self,
        result: Result<T, CombinedCustodyError>,
    ) -> Result<T, CombinedCustodyError> {
        if result.as_ref().is_err_and(|error| {
            matches!(
                error,
                CombinedCustodyError::Cancelled
                    | CombinedCustodyError::IdentityCollision
                    | CombinedCustodyError::SourceRejected(_)
                    | CombinedCustodyError::OutputRejected(_)
            )
        }) {
            self.terminal = true;
        }
        result
    }
}

fn checked_add_retained_layout_memory<F>(
    retained_bytes: u64,
    source_bytes: u64,
    maximum_bytes: u64,
    is_cancelled: &mut F,
) -> Result<u64, CombinedCustodyError>
where
    F: FnMut() -> bool,
{
    check_cancelled(is_cancelled)?;
    let retained_bytes = retained_bytes
        .checked_add(source_bytes)
        .ok_or(CombinedCustodyError::LayoutMemoryLimitExceeded)?;
    if retained_bytes > maximum_bytes {
        return Err(CombinedCustodyError::LayoutMemoryLimitExceeded);
    }
    check_cancelled(is_cancelled)?;
    Ok(retained_bytes)
}

fn validate_limits(limits: CombinedCustodyLimits) -> Result<(), CombinedCustodyError> {
    if limits.per_source.max_files == 0
        || limits.per_source.max_files > DEFAULT_MAX_FILES
        || limits.per_source.max_entries < limits.per_source.max_files
        || limits.per_source.max_entries > DEFAULT_MAX_ENTRIES
        || limits.per_source.max_total_bytes == 0
        || limits.per_source.max_total_bytes > DEFAULT_MAX_BYTES
        || limits.per_source.max_layout_memory_bytes == 0
        || limits.per_source.max_layout_memory_bytes > DEFAULT_MAX_LAYOUT_MEMORY_BYTES
        || limits.max_source_roots == 0
        || limits.max_source_roots > DEFAULT_MAX_SOURCE_ROOTS
        || limits.max_total_entries == 0
        || limits.max_total_entries > DEFAULT_MAX_ENTRIES
        || limits.max_total_files == 0
        || limits.max_total_files > DEFAULT_MAX_FILES
        || limits.max_total_bytes == 0
        || limits.max_total_bytes > DEFAULT_MAX_SCOPE_BYTES
        || limits.max_retained_layout_memory_bytes == 0
        || limits.max_retained_layout_memory_bytes > DEFAULT_MAX_RETAINED_LAYOUT_MEMORY_BYTES
        || limits.per_source.max_layout_memory_bytes > limits.max_retained_layout_memory_bytes
        || limits.max_output_files == 0
        || limits.max_output_files > DEFAULT_MAX_OUTPUT_FILES
    {
        return Err(CombinedCustodyError::InvalidLimits);
    }
    Ok(())
}

fn check_cancelled<F>(is_cancelled: &mut F) -> Result<(), CombinedCustodyError>
where
    F: FnMut() -> bool,
{
    if is_cancelled() {
        Err(CombinedCustodyError::Cancelled)
    } else {
        Ok(())
    }
}

const fn map_source_error(error: CustodyError) -> CombinedCustodyError {
    if matches!(error, CustodyError::Cancelled) {
        CombinedCustodyError::Cancelled
    } else {
        CombinedCustodyError::SourceRejected(error)
    }
}

const fn map_output_error(error: OutputError) -> CombinedCustodyError {
    if matches!(error, OutputError::Cancelled) {
        CombinedCustodyError::Cancelled
    } else {
        CombinedCustodyError::OutputRejected(error)
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use super::*;

    #[test]
    fn default_limits_match_the_v1_hard_caps() {
        let limits = CombinedCustodyLimits::default();
        assert_eq!(limits.max_source_roots, 128);
        assert_eq!(limits.max_total_entries, 200_000);
        assert_eq!(limits.max_total_files, 100_000);
        assert_eq!(limits.max_total_bytes, 8 * 1024 * 1024 * 1024 * 1024);
        assert_eq!(limits.max_retained_layout_memory_bytes, 80 * 1024 * 1024);
        assert_eq!(
            limits.per_source.max_layout_memory_bytes,
            limits.max_retained_layout_memory_bytes
        );
        assert_eq!(limits.max_output_files, 100_000);
        assert_eq!(validate_limits(limits), Ok(()));
    }

    #[test]
    fn caller_cannot_relax_native_hard_caps() {
        let mut limits = CombinedCustodyLimits::default();
        limits.max_source_roots += 1;
        assert_eq!(
            validate_limits(limits),
            Err(CombinedCustodyError::InvalidLimits)
        );

        let mut limits = CombinedCustodyLimits::default();
        limits.max_retained_layout_memory_bytes -= 1;
        assert_eq!(
            validate_limits(limits),
            Err(CombinedCustodyError::InvalidLimits),
            "the per-source allowance cannot exceed the whole-scope allowance"
        );
    }

    #[test]
    fn retained_layout_aggregation_has_checked_bound_overflow_and_cancellation() {
        let mut never_cancelled = || false;
        assert_eq!(
            checked_add_retained_layout_memory(40, 40, 80, &mut never_cancelled),
            Ok(80)
        );
        assert_eq!(
            checked_add_retained_layout_memory(40, 41, 80, &mut never_cancelled),
            Err(CombinedCustodyError::LayoutMemoryLimitExceeded)
        );
        assert_eq!(
            checked_add_retained_layout_memory(u64::MAX, 1, u64::MAX, &mut never_cancelled),
            Err(CombinedCustodyError::LayoutMemoryLimitExceeded)
        );

        let polls = Cell::new(0usize);
        assert_eq!(
            checked_add_retained_layout_memory(1, 1, 2, &mut || {
                let next = polls.get() + 1;
                polls.set(next);
                next == 2
            }),
            Err(CombinedCustodyError::Cancelled)
        );
        assert_eq!(polls.get(), 2);
    }
}
