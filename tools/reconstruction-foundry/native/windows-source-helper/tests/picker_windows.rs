#![cfg(windows)]

use venviewer_windows_source_helper::picker::{PickerError, PickerSta};

#[test]
fn dedicated_picker_sta_starts_and_stops_without_showing_ui() {
    let picker = PickerSta::start().expect("dedicated picker STA should start");
    picker
        .shutdown()
        .expect("dedicated picker STA should stop cleanly");
}

#[test]
fn picker_errors_are_fixed_and_never_carry_native_or_private_text() {
    let private_markers = ["customer-secret", "C:\\", "\\\\server", "HRESULT"];
    for error in [
        PickerError::StartupFailed,
        PickerError::ServiceUnavailable,
        PickerError::Busy,
        PickerError::DialogFailed,
        PickerError::InvalidResults,
        PickerError::SelectionLimitExceeded,
    ] {
        let display = error.to_string();
        for marker in private_markers {
            assert!(!display.contains(marker), "unexpected marker in {error:?}");
        }
    }
}
