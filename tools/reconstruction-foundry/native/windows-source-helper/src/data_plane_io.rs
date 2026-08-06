//! Cancellable, inherited-pipe transport for VNSDP01 frames on Windows.
//!
//! Node writes output frames to child CRT descriptor 3. The helper writes
//! source and catalog frames to child CRT descriptor 4. Every Win32 operation
//! uses its own `OVERLAPPED` and manual-reset completion event. Cancellation
//! targets that exact operation and always drains its final completion before
//! the buffer or `OVERLAPPED` can be reused or dropped.
//!
//! Buffers are overwritten on the error paths where this module still owns
//! them. This reduces ordinary process-memory lifetime; it is not a promise to
//! erase physical RAM, crash dumps, paging files, or storage outside this
//! process.

use std::cell::Cell;
use std::error::Error;
use std::ffi::{c_int, c_uint, c_void};
use std::fmt::{self, Display, Formatter};
use std::marker::PhantomData;
use std::sync::{Arc, Mutex, MutexGuard};

use windows::core::{HRESULT, PCWSTR};
use windows::Win32::Foundation::{
    CloseHandle, ERROR_BROKEN_PIPE, ERROR_HANDLE_EOF, ERROR_IO_PENDING, ERROR_NOT_FOUND,
    ERROR_NO_DATA, ERROR_OPERATION_ABORTED, HANDLE, WAIT_FAILED, WAIT_OBJECT_0, WIN32_ERROR,
};
use windows::Win32::Storage::FileSystem::{GetFileType, ReadFile, WriteFile, FILE_TYPE_PIPE};
use windows::Win32::System::Threading::{
    CreateEventW, ResetEvent, SetEvent, WaitForMultipleObjects, INFINITE,
};
use windows::Win32::System::IO::{CancelIoEx, GetOverlappedResult, OVERLAPPED};

use crate::data_plane_frame::{
    decode_data_plane_frame_header, encode_data_plane_frame_parts,
    finish_decoding_data_plane_frame, DataPlaneFrame, DataPlaneFrameDirection, DataPlaneFrameError,
    DataPlaneFrameKind, DATA_PLANE_FRAME_HEADER_BYTES,
};

pub const NODE_TO_HELPER_OUTPUT_FRAMES_FD: c_int = 3;
pub const HELPER_TO_NODE_SOURCE_CATALOG_FRAMES_FD: c_int = 4;

const CRT_INVALID_HANDLE: isize = -1;
const CRT_DETACHED_STREAM: isize = -2;

type InvalidParameterHandler = Option<
    unsafe extern "C" fn(
        expression: *const u16,
        function: *const u16,
        file: *const u16,
        line: c_uint,
        reserved: usize,
    ),
>;

unsafe extern "C" {
    #[link_name = "_get_osfhandle"]
    fn crt_get_osfhandle(descriptor: c_int) -> isize;

    #[link_name = "_close"]
    fn crt_close(descriptor: c_int) -> c_int;

    #[link_name = "_set_thread_local_invalid_parameter_handler"]
    fn crt_set_thread_invalid_parameter_handler(
        handler: InvalidParameterHandler,
    ) -> InvalidParameterHandler;
}

unsafe extern "C" fn return_from_invalid_parameter(
    _expression: *const u16,
    _function: *const u16,
    _file: *const u16,
    _line: c_uint,
    _reserved: usize,
) {
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DataPlaneIoError {
    MissingDescriptor(c_int),
    DetachedDescriptor(c_int),
    DescriptorIsNotPipe(c_int),
    PipeHandlesCollide,
    EventUnavailable,
    CancellationAlreadyActive,
    CancellationGenerationExhausted,
    CancellationStatePoisoned,
    CancellationSignalFailed,
    Cancelled,
    PipeClosed,
    IncompleteFrame,
    ReadFailed,
    WriteFailed,
    CompletionFailed,
    WaitFailed,
    UnexpectedCompletion,
    ZeroProgress,
    WrongFrameDirection,
    InvalidFrame(DataPlaneFrameError),
    PipePoisoned,
    PipeClosedByOwner,
    DescriptorCloseFailed,
}

impl Display for DataPlaneIoError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        match self {
            Self::MissingDescriptor(descriptor) => {
                write!(
                    formatter,
                    "required inherited pipe descriptor {descriptor} is missing"
                )
            }
            Self::DetachedDescriptor(descriptor) => write!(
                formatter,
                "required inherited pipe descriptor {descriptor} is detached"
            ),
            Self::DescriptorIsNotPipe(descriptor) => write!(
                formatter,
                "required inherited descriptor {descriptor} is not a pipe"
            ),
            Self::PipeHandlesCollide => {
                formatter.write_str("inherited descriptors 3 and 4 resolve to the same pipe")
            }
            Self::EventUnavailable => {
                formatter.write_str("a required manual-reset event could not be created")
            }
            Self::CancellationAlreadyActive => {
                formatter.write_str("a cancellation generation is already active")
            }
            Self::CancellationGenerationExhausted => {
                formatter.write_str("the cancellation generation counter is exhausted")
            }
            Self::CancellationStatePoisoned => {
                formatter.write_str("the cancellation state is poisoned")
            }
            Self::CancellationSignalFailed => {
                formatter.write_str("the cancellation event could not be signalled")
            }
            Self::Cancelled => formatter.write_str("the data-plane operation was cancelled"),
            Self::PipeClosed => formatter.write_str("the other pipe endpoint closed"),
            Self::IncompleteFrame => {
                formatter.write_str("the pipe ended after only part of a frame was transferred")
            }
            Self::ReadFailed => formatter.write_str("the inherited pipe read failed"),
            Self::WriteFailed => formatter.write_str("the inherited pipe write failed"),
            Self::CompletionFailed => {
                formatter.write_str("the overlapped operation completion could not be observed")
            }
            Self::WaitFailed => formatter.write_str("waiting for I/O or cancellation failed"),
            Self::UnexpectedCompletion => {
                formatter.write_str("the overlapped operation had an unknown completion state")
            }
            Self::ZeroProgress => {
                formatter.write_str("the pipe operation completed without making progress")
            }
            Self::WrongFrameDirection => {
                formatter.write_str("the frame kind is not allowed on this pipe direction")
            }
            Self::InvalidFrame(_) => formatter.write_str("the data-plane frame is invalid"),
            Self::PipePoisoned => formatter.write_str("the data-plane pipe is poisoned"),
            Self::PipeClosedByOwner => {
                formatter.write_str("the data-plane pipe was closed by its owner")
            }
            Self::DescriptorCloseFailed => {
                formatter.write_str("a CRT pipe descriptor could not be closed")
            }
        }
    }
}

impl Error for DataPlaneIoError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::InvalidFrame(error) => Some(error),
            _ => None,
        }
    }
}

struct OwnedManualResetEvent {
    raw: isize,
}

impl OwnedManualResetEvent {
    fn new() -> Result<Self, DataPlaneIoError> {
        // This handle is created here and is therefore the only HANDLE in this
        // module that is closed with CloseHandle.
        let handle = unsafe { CreateEventW(None, true, false, PCWSTR::null()) }
            .map_err(|_| DataPlaneIoError::EventUnavailable)?;
        Ok(Self {
            raw: handle.0 as isize,
        })
    }

    fn handle(&self) -> HANDLE {
        HANDLE(self.raw as *mut c_void)
    }

    fn reset(&self) -> Result<(), DataPlaneIoError> {
        unsafe { ResetEvent(self.handle()) }.map_err(|_| DataPlaneIoError::CancellationSignalFailed)
    }

    fn signal(&self) -> Result<(), DataPlaneIoError> {
        unsafe { SetEvent(self.handle()) }.map_err(|_| DataPlaneIoError::CancellationSignalFailed)
    }
}

impl Drop for OwnedManualResetEvent {
    fn drop(&mut self) {
        let _ = unsafe { CloseHandle(self.handle()) };
    }
}

struct CancellationState {
    event: OwnedManualResetEvent,
    generation: Mutex<CancellationGenerationState>,
}

#[derive(Default)]
struct CancellationGenerationState {
    last: u64,
    active: Option<u64>,
    cancelled: Option<u64>,
}

/// Owns one reusable manual-reset cancellation event.
///
/// Start one generation for each logical operation. The returned cancellation
/// handle is cloneable and can safely be sent to the control thread.
#[derive(Clone)]
pub struct DataPlaneCancellation {
    inner: Arc<CancellationState>,
}

impl fmt::Debug for DataPlaneCancellation {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DataPlaneCancellation")
            .finish_non_exhaustive()
    }
}

impl DataPlaneCancellation {
    pub fn new() -> Result<Self, DataPlaneIoError> {
        Ok(Self {
            inner: Arc::new(CancellationState {
                event: OwnedManualResetEvent::new()?,
                generation: Mutex::new(CancellationGenerationState::default()),
            }),
        })
    }

    pub fn begin_generation(
        &self,
    ) -> Result<(DataPlaneCancellationScope, DataPlaneCancelHandle), DataPlaneIoError> {
        let mut state = lock_cancellation(&self.inner)?;
        if state.active.is_some() {
            return Err(DataPlaneIoError::CancellationAlreadyActive);
        }
        let generation = state
            .last
            .checked_add(1)
            .ok_or(DataPlaneIoError::CancellationGenerationExhausted)?;
        self.inner.event.reset()?;
        state.last = generation;
        state.active = Some(generation);
        state.cancelled = None;
        drop(state);

        Ok((
            DataPlaneCancellationScope {
                inner: Arc::clone(&self.inner),
                generation,
                _not_sync: PhantomData,
            },
            DataPlaneCancelHandle {
                inner: Arc::clone(&self.inner),
                generation,
            },
        ))
    }
}

/// The worker-side token for exactly one cancellation generation.
pub struct DataPlaneCancellationScope {
    inner: Arc<CancellationState>,
    generation: u64,
    // Operations are movable between threads but deliberately not shareable.
    _not_sync: PhantomData<Cell<()>>,
}

impl fmt::Debug for DataPlaneCancellationScope {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DataPlaneCancellationScope")
            .finish_non_exhaustive()
    }
}

impl DataPlaneCancellationScope {
    fn is_cancelled(&self) -> Result<bool, DataPlaneIoError> {
        let state = lock_cancellation(&self.inner)?;
        Ok(state.active == Some(self.generation) && state.cancelled == Some(self.generation))
    }

    fn event_handle(&self) -> HANDLE {
        self.inner.event.handle()
    }
}

impl Drop for DataPlaneCancellationScope {
    fn drop(&mut self) {
        if let Ok(mut state) = self.inner.generation.lock() {
            if state.active == Some(self.generation) {
                // Holding the lock prevents a stale cancel handle from racing
                // the reset and becoming a cancellation of the next generation.
                let _ = self.inner.event.reset();
                state.active = None;
                state.cancelled = None;
            }
        }
    }
}

/// A cloneable control-thread handle bound to one exact generation.
#[derive(Clone)]
pub struct DataPlaneCancelHandle {
    inner: Arc<CancellationState>,
    generation: u64,
}

impl fmt::Debug for DataPlaneCancelHandle {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DataPlaneCancelHandle")
            .finish_non_exhaustive()
    }
}

impl DataPlaneCancelHandle {
    /// Returns `true` only when this handle cancelled its still-active
    /// generation. A stale handle returns `false` and cannot affect later I/O.
    pub fn cancel(&self) -> Result<bool, DataPlaneIoError> {
        let mut state = lock_cancellation(&self.inner)?;
        if state.active != Some(self.generation) {
            return Ok(false);
        }
        if state.cancelled == Some(self.generation) {
            return Ok(true);
        }
        self.inner.event.signal()?;
        state.cancelled = Some(self.generation);
        Ok(true)
    }
}

fn lock_cancellation(
    state: &CancellationState,
) -> Result<MutexGuard<'_, CancellationGenerationState>, DataPlaneIoError> {
    state
        .generation
        .lock()
        .map_err(|_| DataPlaneIoError::CancellationStatePoisoned)
}

#[derive(Clone, Copy)]
struct BorrowedCrtPipe {
    descriptor: c_int,
    raw_handle: isize,
}

impl BorrowedCrtPipe {
    fn handle(self) -> HANDLE {
        HANDLE(self.raw_handle as *mut c_void)
    }
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum PipeState {
    Ready,
    Poisoned,
    Closed,
}

impl PipeState {
    fn ensure_ready(self) -> Result<(), DataPlaneIoError> {
        match self {
            Self::Ready => Ok(()),
            Self::Poisoned => Err(DataPlaneIoError::PipePoisoned),
            Self::Closed => Err(DataPlaneIoError::PipeClosedByOwner),
        }
    }
}

/// Read-only fd 3 endpoint. Only output frames are accepted.
pub struct NodeToHelperOutputPipe {
    pipe: BorrowedCrtPipe,
    state: PipeState,
    _not_sync: PhantomData<Cell<()>>,
}

impl fmt::Debug for NodeToHelperOutputPipe {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("NodeToHelperOutputPipe")
            .field("descriptor", &self.pipe.descriptor)
            .field("poisoned", &(self.state == PipeState::Poisoned))
            .finish_non_exhaustive()
    }
}

impl NodeToHelperOutputPipe {
    pub fn read_output_frame(
        &mut self,
        cancellation: &DataPlaneCancellationScope,
    ) -> Result<DataPlaneFrame, DataPlaneIoError> {
        self.state.ensure_ready()?;
        let result = self.read_output_frame_inner(cancellation);
        if result.is_err() {
            self.state = PipeState::Poisoned;
        }
        result
    }

    fn read_output_frame_inner(
        &mut self,
        cancellation: &DataPlaneCancellationScope,
    ) -> Result<DataPlaneFrame, DataPlaneIoError> {
        let mut header_bytes = [0_u8; DATA_PLANE_FRAME_HEADER_BYTES];
        if let Err(error) = read_exact_overlapped(self.pipe, &mut header_bytes, cancellation) {
            wipe_bytes(&mut header_bytes);
            return Err(error);
        }

        let header = match decode_data_plane_frame_header(&header_bytes) {
            Ok(header) => header,
            Err(error) => {
                wipe_bytes(&mut header_bytes);
                return Err(DataPlaneIoError::InvalidFrame(error));
            }
        };
        wipe_bytes(&mut header_bytes);

        if header.kind() != DataPlaneFrameKind::Output
            || header.kind().direction() != DataPlaneFrameDirection::NodeToHelper
        {
            return Err(DataPlaneIoError::WrongFrameDirection);
        }

        // This is the first payload allocation, and the fixed-header decoder
        // has already enforced the 1 MiB maximum.
        let mut payload = vec![0_u8; header.payload_length()];
        if !payload.is_empty() {
            if let Err(error) = read_exact_overlapped(self.pipe, &mut payload, cancellation) {
                wipe_bytes(&mut payload);
                return Err(match error {
                    DataPlaneIoError::Cancelled => DataPlaneIoError::Cancelled,
                    _ => DataPlaneIoError::IncompleteFrame,
                });
            }
        }

        finish_decoding_data_plane_frame(header, payload).map_err(DataPlaneIoError::InvalidFrame)
    }
}

/// Write-only fd 4 endpoint. Only source and catalog frames are accepted.
///
/// `&mut self` and the deliberately non-`Sync` type serialize every write at
/// the endpoint owner; header and payload bytes from two frames cannot mingle.
pub struct HelperToNodeSourceCatalogPipe {
    pipe: BorrowedCrtPipe,
    state: PipeState,
    _not_sync: PhantomData<Cell<()>>,
}

impl fmt::Debug for HelperToNodeSourceCatalogPipe {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("HelperToNodeSourceCatalogPipe")
            .field("descriptor", &self.pipe.descriptor)
            .field("poisoned", &(self.state == PipeState::Poisoned))
            .finish_non_exhaustive()
    }
}

impl HelperToNodeSourceCatalogPipe {
    pub fn write_source_or_catalog_frame(
        &mut self,
        frame: &DataPlaneFrame,
        cancellation: &DataPlaneCancellationScope,
    ) -> Result<(), DataPlaneIoError> {
        self.state.ensure_ready()?;
        let result = self.write_source_or_catalog_frame_inner(frame, cancellation);
        if result.is_err() {
            self.state = PipeState::Poisoned;
        }
        result
    }

    fn write_source_or_catalog_frame_inner(
        &mut self,
        frame: &DataPlaneFrame,
        cancellation: &DataPlaneCancellationScope,
    ) -> Result<(), DataPlaneIoError> {
        if !matches!(
            frame.references.kind(),
            DataPlaneFrameKind::Source | DataPlaneFrameKind::Catalog
        ) || frame.references.kind().direction() != DataPlaneFrameDirection::HelperToNode
        {
            return Err(DataPlaneIoError::WrongFrameDirection);
        }

        let parts = encode_data_plane_frame_parts(frame).map_err(DataPlaneIoError::InvalidFrame)?;
        let mut header = parts.header;
        if let Err(error) = write_all_overlapped(self.pipe, &header, cancellation) {
            wipe_bytes(&mut header);
            return Err(error);
        }
        wipe_bytes(&mut header);

        if !parts.payload.is_empty() {
            if let Err(error) = write_all_overlapped(self.pipe, parts.payload, cancellation) {
                return Err(match error {
                    DataPlaneIoError::Cancelled => DataPlaneIoError::Cancelled,
                    _ => DataPlaneIoError::IncompleteFrame,
                });
            }
        }
        Ok(())
    }
}

/// The two canonical inherited data-plane endpoints.
///
/// Resolving a CRT descriptor borrows its HANDLE. Drop intentionally does not
/// close either descriptor or call `CloseHandle`. The eventual process owner
/// may consume this value with [`Self::close`] after all I/O has returned; that
/// method closes only the CRT descriptors with `_close`.
pub struct InheritedDataPlanePipes {
    output_reader: NodeToHelperOutputPipe,
    source_catalog_writer: HelperToNodeSourceCatalogPipe,
}

impl fmt::Debug for InheritedDataPlanePipes {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("InheritedDataPlanePipes")
            .field("output_reader", &self.output_reader)
            .field("source_catalog_writer", &self.source_catalog_writer)
            .finish_non_exhaustive()
    }
}

impl InheritedDataPlanePipes {
    pub fn resolve() -> Result<Self, DataPlaneIoError> {
        let input = resolve_crt_pipe(NODE_TO_HELPER_OUTPUT_FRAMES_FD)?;
        let output = resolve_crt_pipe(HELPER_TO_NODE_SOURCE_CATALOG_FRAMES_FD)?;
        if input.raw_handle == output.raw_handle {
            return Err(DataPlaneIoError::PipeHandlesCollide);
        }
        Ok(Self {
            output_reader: NodeToHelperOutputPipe {
                pipe: input,
                state: PipeState::Ready,
                _not_sync: PhantomData,
            },
            source_catalog_writer: HelperToNodeSourceCatalogPipe {
                pipe: output,
                state: PipeState::Ready,
                _not_sync: PhantomData,
            },
        })
    }

    pub fn output_reader_mut(&mut self) -> &mut NodeToHelperOutputPipe {
        &mut self.output_reader
    }

    pub fn source_catalog_writer_mut(&mut self) -> &mut HelperToNodeSourceCatalogPipe {
        &mut self.source_catalog_writer
    }

    pub fn close(mut self) -> Result<(), DataPlaneIoError> {
        self.output_reader.state = PipeState::Closed;
        self.source_catalog_writer.state = PipeState::Closed;

        // `_get_osfhandle` returns borrowed handles. Closing the owning CRT
        // descriptors is the only valid teardown; CloseHandle must not be used.
        let input_result = unsafe { crt_close(NODE_TO_HELPER_OUTPUT_FRAMES_FD) };
        let output_result = unsafe { crt_close(HELPER_TO_NODE_SOURCE_CATALOG_FRAMES_FD) };
        if input_result != 0 || output_result != 0 {
            return Err(DataPlaneIoError::DescriptorCloseFailed);
        }
        Ok(())
    }
}

fn resolve_crt_pipe(descriptor: c_int) -> Result<BorrowedCrtPipe, DataPlaneIoError> {
    // A missing descriptor invokes the Universal CRT invalid-parameter handler
    // before `_get_osfhandle` returns -1. Install a returning handler only for
    // this thread and restore the exact prior handler immediately afterward.
    let previous =
        unsafe { crt_set_thread_invalid_parameter_handler(Some(return_from_invalid_parameter)) };
    let restore = InvalidParameterHandlerRestore(previous);
    let raw_handle = unsafe { crt_get_osfhandle(descriptor) };
    drop(restore);

    if raw_handle == CRT_INVALID_HANDLE {
        return Err(DataPlaneIoError::MissingDescriptor(descriptor));
    }
    if raw_handle == CRT_DETACHED_STREAM {
        return Err(DataPlaneIoError::DetachedDescriptor(descriptor));
    }
    let pipe = BorrowedCrtPipe {
        descriptor,
        raw_handle,
    };
    if unsafe { GetFileType(pipe.handle()) } != FILE_TYPE_PIPE {
        return Err(DataPlaneIoError::DescriptorIsNotPipe(descriptor));
    }
    Ok(pipe)
}

struct InvalidParameterHandlerRestore(InvalidParameterHandler);

impl Drop for InvalidParameterHandlerRestore {
    fn drop(&mut self) {
        unsafe {
            crt_set_thread_invalid_parameter_handler(self.0);
        }
    }
}

struct OverlappedOperation {
    event: OwnedManualResetEvent,
    overlapped: OVERLAPPED,
}

impl OverlappedOperation {
    fn new() -> Result<Self, DataPlaneIoError> {
        let event = OwnedManualResetEvent::new()?;
        let overlapped = OVERLAPPED {
            hEvent: event.handle(),
            ..OVERLAPPED::default()
        };
        Ok(Self { event, overlapped })
    }
}

fn read_exact_overlapped(
    pipe: BorrowedCrtPipe,
    buffer: &mut [u8],
    cancellation: &DataPlaneCancellationScope,
) -> Result<(), DataPlaneIoError> {
    let mut offset = 0_usize;
    while offset < buffer.len() {
        match read_once_overlapped(pipe, &mut buffer[offset..], cancellation) {
            Ok(transferred) => offset += transferred,
            Err(DataPlaneIoError::PipeClosed) if offset != 0 => {
                return Err(DataPlaneIoError::IncompleteFrame);
            }
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

fn write_all_overlapped(
    pipe: BorrowedCrtPipe,
    buffer: &[u8],
    cancellation: &DataPlaneCancellationScope,
) -> Result<(), DataPlaneIoError> {
    let mut offset = 0_usize;
    while offset < buffer.len() {
        match write_once_overlapped(pipe, &buffer[offset..], cancellation) {
            Ok(transferred) => offset += transferred,
            Err(DataPlaneIoError::PipeClosed) if offset != 0 => {
                return Err(DataPlaneIoError::IncompleteFrame);
            }
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

fn read_once_overlapped(
    pipe: BorrowedCrtPipe,
    buffer: &mut [u8],
    cancellation: &DataPlaneCancellationScope,
) -> Result<usize, DataPlaneIoError> {
    if cancellation.is_cancelled()? {
        return Err(DataPlaneIoError::Cancelled);
    }
    let mut operation = OverlappedOperation::new()?;
    let issued = unsafe {
        ReadFile(
            pipe.handle(),
            Some(buffer),
            None,
            Some(&mut operation.overlapped),
        )
    };
    let transferred = match issued {
        // Microsoft requires the byte-count pointer to be null for an
        // overlapped handle and directs callers to GetOverlappedResult for the
        // count. TRUE means this exact OVERLAPPED already completed, so a
        // non-waiting result query is valid and also gives one common race
        // recheck path for immediate and pending completions.
        Ok(()) => observe_completed_operation(pipe, &operation, cancellation)?,
        Err(error) if is_win32_error(&error, ERROR_IO_PENDING) => {
            wait_for_operation(pipe, &operation, cancellation)?
        }
        Err(error) if is_broken_pipe_error(&error) => {
            return Err(DataPlaneIoError::PipeClosed);
        }
        Err(error)
            if is_win32_error(&error, ERROR_OPERATION_ABORTED)
                && cancellation.is_cancelled()? =>
        {
            return Err(DataPlaneIoError::Cancelled);
        }
        Err(_) => return Err(DataPlaneIoError::ReadFailed),
    };
    validate_progress(transferred, buffer.len())
}

fn write_once_overlapped(
    pipe: BorrowedCrtPipe,
    buffer: &[u8],
    cancellation: &DataPlaneCancellationScope,
) -> Result<usize, DataPlaneIoError> {
    if cancellation.is_cancelled()? {
        return Err(DataPlaneIoError::Cancelled);
    }
    let mut operation = OverlappedOperation::new()?;
    let issued = unsafe {
        WriteFile(
            pipe.handle(),
            Some(buffer),
            None,
            Some(&mut operation.overlapped),
        )
    };
    let transferred = match issued {
        // The synchronous-success case follows the same documented
        // GetOverlappedResult byte-count path as ReadFile above.
        Ok(()) => observe_completed_operation(pipe, &operation, cancellation)?,
        Err(error) if is_win32_error(&error, ERROR_IO_PENDING) => {
            wait_for_operation(pipe, &operation, cancellation)?
        }
        Err(error) if is_broken_pipe_error(&error) => {
            return Err(DataPlaneIoError::PipeClosed);
        }
        Err(error)
            if is_win32_error(&error, ERROR_OPERATION_ABORTED)
                && cancellation.is_cancelled()? =>
        {
            return Err(DataPlaneIoError::Cancelled);
        }
        Err(_) => return Err(DataPlaneIoError::WriteFailed),
    };
    validate_progress(transferred, buffer.len())
}

fn observe_completed_operation(
    pipe: BorrowedCrtPipe,
    operation: &OverlappedOperation,
    cancellation: &DataPlaneCancellationScope,
) -> Result<u32, DataPlaneIoError> {
    let mut transferred = 0_u32;
    let completion = unsafe {
        GetOverlappedResult(
            pipe.handle(),
            &operation.overlapped,
            &mut transferred,
            false,
        )
    };
    // Completion and cancellation can win in either order. Recheck this exact
    // generation after every observed completion, including synchronous ones.
    if cancellation.is_cancelled()? {
        return Err(DataPlaneIoError::Cancelled);
    }
    completion.map_err(|error| {
        if is_broken_pipe_error(&error) {
            DataPlaneIoError::PipeClosed
        } else {
            DataPlaneIoError::CompletionFailed
        }
    })?;
    Ok(transferred)
}

fn wait_for_operation(
    pipe: BorrowedCrtPipe,
    operation: &OverlappedOperation,
    cancellation: &DataPlaneCancellationScope,
) -> Result<u32, DataPlaneIoError> {
    let handles = [operation.event.handle(), cancellation.event_handle()];
    let wait = unsafe { WaitForMultipleObjects(&handles, false, INFINITE) };
    if wait == WAIT_OBJECT_0 {
        return observe_completed_operation(pipe, operation, cancellation);
    }
    if wait.0 == WAIT_OBJECT_0.0 + 1 {
        return cancel_and_observe_operation(pipe, operation, cancellation);
    }

    // Even an impossible/failed wait must not let a pending kernel operation
    // outlive its stack OVERLAPPED or borrowed buffer.
    drain_pending_operation(pipe, operation);
    if wait == WAIT_FAILED {
        Err(DataPlaneIoError::WaitFailed)
    } else {
        Err(DataPlaneIoError::UnexpectedCompletion)
    }
}

fn cancel_and_observe_operation(
    pipe: BorrowedCrtPipe,
    operation: &OverlappedOperation,
    cancellation: &DataPlaneCancellationScope,
) -> Result<u32, DataPlaneIoError> {
    let cancel_result = unsafe { CancelIoEx(pipe.handle(), Some(&operation.overlapped)) };
    let cancel_failed = match cancel_result {
        Ok(()) => false,
        Err(error) if is_win32_error(&error, ERROR_NOT_FOUND) => false,
        Err(_) => true,
    };

    // `ERROR_NOT_FOUND` means completion raced cancellation. In every case,
    // wait for and query the final status before this function returns.
    let mut transferred = 0_u32;
    let completion = unsafe {
        GetOverlappedResult(pipe.handle(), &operation.overlapped, &mut transferred, true)
    };
    let generation_cancelled = cancellation.is_cancelled()?;
    if cancel_failed {
        return Err(DataPlaneIoError::CompletionFailed);
    }
    if generation_cancelled {
        return Err(DataPlaneIoError::Cancelled);
    }
    completion.map_err(|_| DataPlaneIoError::CompletionFailed)?;
    Ok(transferred)
}

fn drain_pending_operation(pipe: BorrowedCrtPipe, operation: &OverlappedOperation) {
    let _ = unsafe { CancelIoEx(pipe.handle(), Some(&operation.overlapped)) };
    let mut ignored = 0_u32;
    let _ =
        unsafe { GetOverlappedResult(pipe.handle(), &operation.overlapped, &mut ignored, true) };
}

fn validate_progress(transferred: u32, requested: usize) -> Result<usize, DataPlaneIoError> {
    let transferred = transferred as usize;
    if transferred == 0 {
        return Err(DataPlaneIoError::ZeroProgress);
    }
    if transferred > requested {
        return Err(DataPlaneIoError::UnexpectedCompletion);
    }
    Ok(transferred)
}

fn is_win32_error(error: &windows::core::Error, expected: WIN32_ERROR) -> bool {
    error.code() == HRESULT::from_win32(expected.0)
}

fn is_broken_pipe_error(error: &windows::core::Error) -> bool {
    [ERROR_BROKEN_PIPE, ERROR_NO_DATA, ERROR_HANDLE_EOF]
        .into_iter()
        .any(|expected| is_win32_error(error, expected))
}

fn wipe_bytes(bytes: &mut [u8]) {
    for byte in bytes {
        // Volatile writes make this best-effort overwrite observable to the
        // compiler. They still cannot guarantee erasure outside process RAM.
        unsafe { std::ptr::write_volatile(byte, 0) };
    }
    std::sync::atomic::compiler_fence(std::sync::atomic::Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancellation_generations_are_exact_and_stale_handles_are_harmless() {
        let cancellation = DataPlaneCancellation::new().expect("event should be created");
        let (scope_one, cancel_one) = cancellation
            .begin_generation()
            .expect("first generation should start");
        assert!(!scope_one.is_cancelled().expect("state should be readable"));
        assert!(cancel_one
            .cancel()
            .expect("active generation should cancel"));
        assert!(scope_one.is_cancelled().expect("state should be readable"));
        drop(scope_one);

        let (scope_two, cancel_two) = cancellation
            .begin_generation()
            .expect("second generation should start");
        assert!(!cancel_one
            .cancel()
            .expect("stale cancellation should be safe"));
        assert!(!scope_two.is_cancelled().expect("new generation stays live"));
        assert!(cancel_two.cancel().expect("new generation should cancel"));
        assert!(scope_two.is_cancelled().expect("state should be readable"));
    }

    #[test]
    fn only_one_generation_can_be_active() {
        let cancellation = DataPlaneCancellation::new().expect("event should be created");
        let (_scope, _handle) = cancellation
            .begin_generation()
            .expect("first generation should start");
        assert!(matches!(
            cancellation.begin_generation(),
            Err(DataPlaneIoError::CancellationAlreadyActive)
        ));
    }

    #[test]
    fn progress_validation_rejects_zero_and_impossible_counts() {
        assert_eq!(
            validate_progress(0, 10),
            Err(DataPlaneIoError::ZeroProgress)
        );
        assert_eq!(
            validate_progress(11, 10),
            Err(DataPlaneIoError::UnexpectedCompletion)
        );
        assert_eq!(validate_progress(10, 10), Ok(10));
    }

    #[test]
    fn debug_and_display_do_not_expose_native_handles() {
        let cancellation = DataPlaneCancellation::new().expect("event should be created");
        let (scope, handle) = cancellation
            .begin_generation()
            .expect("generation should start");
        assert_eq!(format!("{cancellation:?}"), "DataPlaneCancellation { .. }");
        assert_eq!(format!("{scope:?}"), "DataPlaneCancellationScope { .. }");
        assert_eq!(format!("{handle:?}"), "DataPlaneCancelHandle { .. }");
        assert!(!DataPlaneIoError::ReadFailed.to_string().contains("error="));
    }
}
