use std::env;
use std::fs::File;
use std::io::{self, BufReader, Write};
use std::process::ExitCode;

use venviewer_windows_source_helper::protocol::{
    encode_response_line, read_bounded_frame, sha256_reader, FrameRead, ProtocolEngine,
    ProtocolErrorCode, ProtocolResponse, MAX_WORK_REQUEST_BYTES,
};

const EXIT_PROTOCOL_FAILURE: u8 = 65;
const EXIT_INTERNAL_FAILURE: u8 = 70;

fn main() -> ExitCode {
    if env::args_os().nth(1).is_some() {
        let _ = emit_response(&ProtocolResponse::unbound_error(
            ProtocolErrorCode::InvalidMessage,
        ));
        return ExitCode::from(EXIT_PROTOCOL_FAILURE);
    }
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(()) => ExitCode::from(EXIT_INTERNAL_FAILURE),
    }
}

fn run() -> Result<(), ()> {
    let self_digest = inspect_current_executable().map_err(|_| {
        let _ = emit_response(&ProtocolResponse::unbound_error(
            ProtocolErrorCode::InternalFailure,
        ));
    })?;
    let mut engine = ProtocolEngine::new(&self_digest).map_err(|_| {
        let _ = emit_response(&ProtocolResponse::unbound_error(
            ProtocolErrorCode::InternalFailure,
        ));
    })?;

    let stdin = io::stdin();
    let mut reader = BufReader::new(stdin.lock());
    loop {
        let frame = read_bounded_frame(&mut reader, MAX_WORK_REQUEST_BYTES).map_err(|_| {
            let response = engine.terminate_with_error(ProtocolErrorCode::InternalFailure);
            let _ = emit_response(&response);
        })?;
        let response = match frame {
            FrameRead::Frame(frame) => engine.handle_frame(&frame),
            FrameRead::EndOfStream => return Ok(()),
            FrameRead::MessageTooLarge => {
                engine.terminate_with_error(ProtocolErrorCode::MessageTooLarge)
            }
            FrameRead::Unterminated => {
                engine.terminate_with_error(ProtocolErrorCode::InvalidMessage)
            }
        };
        let close_acknowledged = response.is_close_acknowledgement();
        emit_response(&response)?;
        if close_acknowledged || engine.is_terminal() {
            return Ok(());
        }
    }
}

fn inspect_current_executable() -> io::Result<String> {
    let executable = env::current_exe()?;
    let file = File::open(executable)?;
    sha256_reader(file)
}

fn emit_response(response: &ProtocolResponse) -> Result<(), ()> {
    let encoded = encode_response_line(response).map_err(|_| ())?;
    let stdout = io::stdout();
    let mut writer = stdout.lock();
    writer.write_all(&encoded).map_err(|_| ())?;
    writer.flush().map_err(|_| ())
}
