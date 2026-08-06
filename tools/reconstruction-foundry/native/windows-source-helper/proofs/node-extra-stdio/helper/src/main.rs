#![forbid(unsafe_op_in_unsafe_fn)]

#[cfg(not(all(windows, target_arch = "x86_64")))]
compile_error!("the extra-stdio proof helper supports only x86_64 Windows");

use std::env;
use std::io::{self, Read, Write};
use std::process::ExitCode;
use std::sync::{Arc, Barrier};
use std::thread;

use venviewer_windows_source_helper::data_plane_frame::{DataPlaneFrame, DataPlaneFrameReferences};
use venviewer_windows_source_helper::data_plane_io::{
    DataPlaneCancelHandle, DataPlaneCancellation, DataPlaneIoError, InheritedDataPlanePipes,
};

const EXIT_ARGUMENT: u8 = 64;
const EXIT_MAPPING: u8 = 66;
const EXIT_FRAME: u8 = 67;
const EXIT_IO: u8 = 68;
const RACE_ITERATIONS: usize = 1_000;
const MAX_PAYLOAD_BYTES: usize = 1_048_576;

const SESSION: &str = "helper_session_000102030405060708090a0b0c0d0e0f";
const REQUEST: &str = "helper_request_101112131415161718191a1b1c1d1e1f";
const SCOPE: &str = "helper_scope_202122232425262728292a2b2c2d2e2f";
const SOURCE: &str = "helper_source_303132333435363738393a3b3c3d3e3f";
const SOURCE_FILE: &str = "helper_source_file_404142434445464748494a4b4c4d4e4f";
const RUN: &str = "helper_run_505152535455565758595a5b5c5d5e5f";
const OUTPUT_FILE: &str = "helper_output_file_606162636465666768696a6b6c6d6e6f";
const TRANSFER: &str = "helper_transfer_707172737475767778797a7b7c7d7e7f";
const CATALOG: &str = "helper_catalog_808182838485868788898a8b8c8d8e8f";

#[derive(Clone, Copy)]
enum Mode {
    RoundTrip,
    TwoFrames,
    ReadOnly,
    CancelRead,
    CancelWrite,
    CancelRace,
    WrongWriteDirection,
    MappingOnly,
}

impl Mode {
    fn parse() -> Result<Self, ProofFailure> {
        let mut arguments = env::args();
        let _program = arguments.next();
        let mode = match arguments.next().as_deref() {
            Some("roundtrip") => Self::RoundTrip,
            Some("two-frames") => Self::TwoFrames,
            Some("read-only") => Self::ReadOnly,
            Some("cancel-read") => Self::CancelRead,
            Some("cancel-write") => Self::CancelWrite,
            Some("cancel-race") => Self::CancelRace,
            Some("wrong-write-direction") => Self::WrongWriteDirection,
            Some("mapping-only") => Self::MappingOnly,
            _ => return Err(ProofFailure::argument("MODE_INVALID")),
        };
        if arguments.next().is_some() {
            return Err(ProofFailure::argument("TOO_MANY_ARGUMENTS"));
        }
        Ok(mode)
    }

    const fn label(self) -> &'static str {
        match self {
            Self::RoundTrip => "roundtrip",
            Self::TwoFrames => "two-frames",
            Self::ReadOnly => "read-only",
            Self::CancelRead => "cancel-read",
            Self::CancelWrite => "cancel-write",
            Self::CancelRace => "cancel-race",
            Self::WrongWriteDirection => "wrong-write-direction",
            Self::MappingOnly => "mapping-only",
        }
    }
}

struct ProofFailure {
    exit_code: u8,
    message: String,
}

impl ProofFailure {
    fn argument(message: &str) -> Self {
        Self {
            exit_code: EXIT_ARGUMENT,
            message: message.to_owned(),
        }
    }

    fn assertion(message: &str) -> Self {
        Self {
            exit_code: EXIT_IO,
            message: message.to_owned(),
        }
    }

    fn from_io(error: DataPlaneIoError) -> Self {
        let exit_code = match error {
            DataPlaneIoError::MissingDescriptor(_)
            | DataPlaneIoError::DetachedDescriptor(_)
            | DataPlaneIoError::DescriptorIsNotPipe(_)
            | DataPlaneIoError::PipeHandlesCollide => EXIT_MAPPING,
            DataPlaneIoError::InvalidFrame(_) | DataPlaneIoError::WrongFrameDirection => EXIT_FRAME,
            _ => EXIT_IO,
        };
        Self {
            exit_code,
            message: format!("DATA_PLANE_ERROR: {error:?}"),
        }
    }
}

fn main() -> ExitCode {
    match Mode::parse().and_then(run) {
        Ok(report) => {
            let stdout = io::stdout();
            let mut writer = stdout.lock();
            if writeln!(writer, "{report}")
                .and_then(|()| writer.flush())
                .is_err()
            {
                eprintln!("STDOUT_WRITE_FAILED");
                return ExitCode::from(EXIT_IO);
            }
            ExitCode::SUCCESS
        }
        Err(failure) => {
            eprintln!("{}", failure.message);
            ExitCode::from(failure.exit_code)
        }
    }
}

fn run(mode: Mode) -> Result<String, ProofFailure> {
    let mut pipes = InheritedDataPlanePipes::resolve().map_err(ProofFailure::from_io)?;
    let operation_result = match mode {
        Mode::RoundTrip => round_trip(&mut pipes).map(|payload_bytes| payload_bytes.to_string()),
        Mode::TwoFrames => two_frames(&mut pipes).map(|count| count.to_string()),
        Mode::ReadOnly => read_only(&mut pipes).map(|payload_bytes| payload_bytes.to_string()),
        Mode::CancelRead => cancel_read(&mut pipes).map(|()| "1".to_owned()),
        Mode::CancelWrite => cancel_write(&mut pipes).map(|()| "1".to_owned()),
        Mode::CancelRace => cancel_race().map(|iterations| iterations.to_string()),
        Mode::WrongWriteDirection => wrong_write_direction(&mut pipes).map(|()| "1".to_owned()),
        Mode::MappingOnly => Ok("0".to_owned()),
    };

    let close_result = pipes.close().map_err(ProofFailure::from_io);
    let count = operation_result?;
    close_result?;
    Ok(format!(
        concat!(
            "{{\"status\":\"ok\",\"mode\":\"{}\",",
            "\"fd3\":\"node_to_helper_output\",",
            "\"fd4\":\"helper_to_node_source_catalog\",",
            "\"count\":{}}}"
        ),
        mode.label(),
        count
    ))
}

fn round_trip(pipes: &mut InheritedDataPlanePipes) -> Result<usize, ProofFailure> {
    let received = read_output(pipes)?;
    let payload_bytes = received.payload.len();
    let response = DataPlaneFrame {
        work_sequence: received.work_sequence,
        chunk_sequence: received.chunk_sequence,
        terminal: received.terminal,
        references: source_references(),
        payload: received.payload,
    };
    write_source_or_catalog(pipes, &response)?;
    Ok(payload_bytes)
}

fn two_frames(pipes: &mut InheritedDataPlanePipes) -> Result<usize, ProofFailure> {
    let first = read_output(pipes)?;
    let second = read_output(pipes)?;
    let source = DataPlaneFrame {
        work_sequence: first.work_sequence,
        chunk_sequence: first.chunk_sequence,
        terminal: first.terminal,
        references: source_references(),
        payload: first.payload,
    };
    let catalog = DataPlaneFrame {
        work_sequence: second.work_sequence,
        chunk_sequence: second.chunk_sequence,
        terminal: second.terminal,
        references: catalog_references(),
        payload: second.payload,
    };
    write_source_or_catalog(pipes, &source)?;
    write_source_or_catalog(pipes, &catalog)?;
    Ok(2)
}

fn read_only(pipes: &mut InheritedDataPlanePipes) -> Result<usize, ProofFailure> {
    Ok(read_output(pipes)?.payload.len())
}

fn read_output(pipes: &mut InheritedDataPlanePipes) -> Result<DataPlaneFrame, ProofFailure> {
    let cancellation = DataPlaneCancellation::new().map_err(ProofFailure::from_io)?;
    let (scope, _cancel) = cancellation
        .begin_generation()
        .map_err(ProofFailure::from_io)?;
    let result = pipes.output_reader_mut().read_output_frame(&scope);
    drop(scope);
    result.map_err(ProofFailure::from_io)
}

fn write_source_or_catalog(
    pipes: &mut InheritedDataPlanePipes,
    frame: &DataPlaneFrame,
) -> Result<(), ProofFailure> {
    let cancellation = DataPlaneCancellation::new().map_err(ProofFailure::from_io)?;
    let (scope, _cancel) = cancellation
        .begin_generation()
        .map_err(ProofFailure::from_io)?;
    let result = pipes
        .source_catalog_writer_mut()
        .write_source_or_catalog_frame(frame, &scope);
    drop(scope);
    result.map_err(ProofFailure::from_io)
}

fn cancel_read(pipes: &mut InheritedDataPlanePipes) -> Result<(), ProofFailure> {
    let cancellation = DataPlaneCancellation::new().map_err(ProofFailure::from_io)?;
    let (scope, cancel) = cancellation
        .begin_generation()
        .map_err(ProofFailure::from_io)?;
    let control = spawn_control_cancellation(cancel);
    let result = pipes.output_reader_mut().read_output_frame(&scope);
    let control_result = control
        .join()
        .map_err(|_| ProofFailure::assertion("CONTROL_THREAD_PANICKED"))??;
    if !control_result || result != Err(DataPlaneIoError::Cancelled) {
        return Err(ProofFailure::assertion("READ_CANCELLATION_NOT_EXACT"));
    }
    drop(scope);

    let (probe_scope, _probe_cancel) = cancellation
        .begin_generation()
        .map_err(ProofFailure::from_io)?;
    let probe = pipes.output_reader_mut().read_output_frame(&probe_scope);
    if probe != Err(DataPlaneIoError::PipePoisoned) {
        return Err(ProofFailure::assertion("CANCELLED_READER_NOT_POISONED"));
    }
    Ok(())
}

fn cancel_write(pipes: &mut InheritedDataPlanePipes) -> Result<(), ProofFailure> {
    let cancellation = DataPlaneCancellation::new().map_err(ProofFailure::from_io)?;
    let (scope, cancel) = cancellation
        .begin_generation()
        .map_err(ProofFailure::from_io)?;
    let control = spawn_control_cancellation(cancel);
    let frame = DataPlaneFrame {
        work_sequence: 1,
        chunk_sequence: 1,
        terminal: true,
        references: source_references(),
        payload: vec![0xa5; MAX_PAYLOAD_BYTES],
    };
    let result = pipes
        .source_catalog_writer_mut()
        .write_source_or_catalog_frame(&frame, &scope);
    let control_result = control
        .join()
        .map_err(|_| ProofFailure::assertion("CONTROL_THREAD_PANICKED"))??;
    if !control_result || result != Err(DataPlaneIoError::Cancelled) {
        return Err(ProofFailure::assertion("WRITE_CANCELLATION_NOT_EXACT"));
    }
    drop(scope);

    let (probe_scope, _probe_cancel) = cancellation
        .begin_generation()
        .map_err(ProofFailure::from_io)?;
    let probe = pipes
        .source_catalog_writer_mut()
        .write_source_or_catalog_frame(&frame, &probe_scope);
    if probe != Err(DataPlaneIoError::PipePoisoned) {
        return Err(ProofFailure::assertion("CANCELLED_WRITER_NOT_POISONED"));
    }
    Ok(())
}

fn spawn_control_cancellation(
    cancel: DataPlaneCancelHandle,
) -> thread::JoinHandle<Result<bool, ProofFailure>> {
    thread::spawn(move || {
        let mut command = [0_u8; 1];
        io::stdin()
            .read_exact(&mut command)
            .map_err(|_| ProofFailure::assertion("CONTROL_READ_FAILED"))?;
        if command[0] != b'c' {
            return Err(ProofFailure::assertion("CONTROL_COMMAND_INVALID"));
        }
        cancel.cancel().map_err(ProofFailure::from_io)
    })
}

fn cancel_race() -> Result<usize, ProofFailure> {
    let cancellation = DataPlaneCancellation::new().map_err(ProofFailure::from_io)?;
    for iteration in 0..RACE_ITERATIONS {
        let (scope, cancel) = cancellation
            .begin_generation()
            .map_err(ProofFailure::from_io)?;
        let barrier = Arc::new(Barrier::new(2));
        let worker_barrier = Arc::clone(&barrier);
        let worker = thread::spawn(move || {
            worker_barrier.wait();
            cancel.cancel()
        });
        barrier.wait();
        if iteration % 2 == 0 {
            thread::yield_now();
        }
        drop(scope);
        worker
            .join()
            .map_err(|_| ProofFailure::assertion("RACE_THREAD_PANICKED"))?
            .map_err(ProofFailure::from_io)?;
    }
    Ok(RACE_ITERATIONS)
}

fn wrong_write_direction(pipes: &mut InheritedDataPlanePipes) -> Result<(), ProofFailure> {
    let cancellation = DataPlaneCancellation::new().map_err(ProofFailure::from_io)?;
    let (scope, _cancel) = cancellation
        .begin_generation()
        .map_err(ProofFailure::from_io)?;
    let output = DataPlaneFrame {
        work_sequence: 1,
        chunk_sequence: 1,
        terminal: true,
        references: output_references(),
        payload: b"wrong direction".to_vec(),
    };
    let result = pipes
        .source_catalog_writer_mut()
        .write_source_or_catalog_frame(&output, &scope);
    if result != Err(DataPlaneIoError::WrongFrameDirection) {
        return Err(ProofFailure::assertion("WRONG_WRITE_DIRECTION_ACCEPTED"));
    }
    Ok(())
}

fn source_references() -> DataPlaneFrameReferences {
    DataPlaneFrameReferences::Source {
        session_ref: SESSION.to_owned(),
        request_ref: REQUEST.to_owned(),
        scope_ref: SCOPE.to_owned(),
        source_ref: SOURCE.to_owned(),
        source_file_ref: SOURCE_FILE.to_owned(),
        transfer_ref: TRANSFER.to_owned(),
    }
}

fn catalog_references() -> DataPlaneFrameReferences {
    DataPlaneFrameReferences::Catalog {
        session_ref: SESSION.to_owned(),
        request_ref: REQUEST.to_owned(),
        scope_ref: SCOPE.to_owned(),
        source_ref: SOURCE.to_owned(),
        catalog_ref: CATALOG.to_owned(),
        transfer_ref: TRANSFER.to_owned(),
    }
}

fn output_references() -> DataPlaneFrameReferences {
    DataPlaneFrameReferences::Output {
        session_ref: SESSION.to_owned(),
        request_ref: REQUEST.to_owned(),
        scope_ref: SCOPE.to_owned(),
        run_ref: RUN.to_owned(),
        output_file_ref: OUTPUT_FILE.to_owned(),
        transfer_ref: TRANSFER.to_owned(),
    }
}
