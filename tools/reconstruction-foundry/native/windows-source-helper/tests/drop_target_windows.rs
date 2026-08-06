#![cfg(windows)]

use venviewer_windows_source_helper::drop_target::{
    DropTargetError, DropTargetOutcome, DropTargetSta,
};

#[test]
fn drop_target_service_starts_and_stops_while_idle() {
    let drop_target = DropTargetSta::start().expect("drop target service should start");
    drop_target
        .shutdown()
        .expect("idle drop target service should stop cleanly");
}

#[test]
fn visible_registered_drop_panel_closes_as_native_cancellation() {
    let drop_target = DropTargetSta::start().expect("drop target service should start");
    let pending = drop_target
        .begin()
        .expect("visible OLE drop panel should register");
    pending
        .request_cancel()
        .expect("native panel close should be posted");
    pending
        .request_cancel()
        .expect("a repeated native cancellation wake-up should remain safe");
    assert!(matches!(
        pending.wait().expect("drop panel should close cleanly"),
        DropTargetOutcome::Cancelled
    ));
    drop_target
        .shutdown()
        .expect("drop registration should already be revoked");
}

#[test]
fn drop_target_errors_are_fixed_and_never_carry_native_or_private_text() {
    let private_markers = ["customer-secret", "C:\\", "\\\\server", "HRESULT"];
    for error in [
        DropTargetError::StartupFailed,
        DropTargetError::ServiceUnavailable,
        DropTargetError::Busy,
        DropTargetError::RegistrationFailed,
        DropTargetError::InvalidDrop,
        DropTargetError::SelectionLimitExceeded,
        DropTargetError::CleanupFailed,
    ] {
        let display = error.to_string();
        for marker in private_markers {
            assert!(!display.contains(marker), "unexpected marker in {error:?}");
        }
    }
}
