//! One-shot, helper-owned Windows OLE file-system drop target.
//!
//! The browser never owns or registers this window. `CF_HDROP` locators are
//! treated as untrusted until the custody layer opens and validates them by
//! handle after this module returns.

use std::cell::{Cell, RefCell};
use std::ffi::c_void;
use std::fmt;
use std::ptr;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::thread::{self, JoinHandle};

use windows::core::{implement, w, PCWSTR};
use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, POINTL, WPARAM};
use windows::Win32::Graphics::Gdi::UpdateWindow;
use windows::Win32::System::Com::{
    IDataObject, DVASPECT_CONTENT, FORMATETC, STGMEDIUM, TYMED_HGLOBAL,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Ole::{
    IDropTarget, IDropTarget_Impl, OleInitialize, OleUninitialize, RegisterDragDrop,
    ReleaseStgMedium, RevokeDragDrop, CF_HDROP, DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_NONE,
};
use windows::Win32::System::SystemServices::MODIFIERKEYS_FLAGS;
use windows::Win32::UI::Shell::{DragQueryFileW, HDROP};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW,
    GetWindowLongPtrW, KillTimer, PostMessageW, RegisterClassW, SetForegroundWindow, SetTimer,
    SetWindowLongPtrW, ShowWindow, TranslateMessage, UnregisterClassW, CW_USEDEFAULT,
    GWLP_USERDATA, MSG, SW_SHOWNORMAL, WINDOW_EX_STYLE, WINDOW_STYLE, WM_APP, WM_CLOSE, WM_KEYDOWN,
    WNDCLASSW, WS_CAPTION, WS_CHILD, WS_EX_APPWINDOW, WS_EX_TOPMOST, WS_MINIMIZEBOX, WS_OVERLAPPED,
    WS_SYSMENU, WS_VISIBLE,
};

use crate::path::MAX_PRIVATE_PATH_UTF16_UNITS;

pub const MAX_DROPPED_ROOTS: u32 = 128;

const WM_DROP_TARGET_TERMINAL: u32 = WM_APP + 0x452;
const ESCAPE_VIRTUAL_KEY: usize = 0x1b;
const DROP_WINDOW_WIDTH: i32 = 560;
const DROP_WINDOW_HEIGHT: i32 = 220;
const CANCELLATION_POLL_TIMER_ID: usize = 1;
const CANCELLATION_POLL_MILLISECONDS: u32 = 100;
static WINDOW_CLASS_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DropTargetError {
    StartupFailed,
    ServiceUnavailable,
    Busy,
    RegistrationFailed,
    InvalidDrop,
    SelectionLimitExceeded,
    CleanupFailed,
}

impl fmt::Display for DropTargetError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::StartupFailed => "the Windows drop target could not start",
            Self::ServiceUnavailable => "the Windows drop target is unavailable",
            Self::Busy => "a Windows drop target request is already active",
            Self::RegistrationFailed => "the Windows drop target could not be registered",
            Self::InvalidDrop => "the Windows drop target received invalid items",
            Self::SelectionLimitExceeded => "the Windows drop selection limit was exceeded",
            Self::CleanupFailed => "the Windows drop target could not be confirmed closed",
        })
    }
}

impl std::error::Error for DropTargetError {}

pub enum DropTargetOutcome {
    Dropped(DroppedSelection),
    Cancelled,
}

impl fmt::Debug for DropTargetOutcome {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Dropped(selection) => formatter.debug_tuple("Dropped").field(selection).finish(),
            Self::Cancelled => formatter.write_str("Cancelled"),
        }
    }
}

pub struct DroppedSelection {
    locators: Vec<DroppedLocator>,
}

impl DroppedSelection {
    #[must_use]
    pub fn locators(&self) -> &[DroppedLocator] {
        &self.locators
    }

    #[must_use]
    pub fn into_locators(self) -> Vec<DroppedLocator> {
        self.locators
    }
}

impl fmt::Debug for DroppedSelection {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DroppedSelection")
            .field("locator_count", &self.locators.len())
            .finish()
    }
}

pub struct DroppedLocator {
    utf16_with_nul: Vec<u16>,
}

impl DroppedLocator {
    #[must_use]
    pub fn as_utf16(&self) -> &[u16] {
        &self.utf16_with_nul[..self.utf16_with_nul.len() - 1]
    }
}

impl fmt::Debug for DroppedLocator {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DroppedLocator")
            .field("utf16_units", &self.as_utf16().len())
            .finish()
    }
}

impl Drop for DroppedLocator {
    fn drop(&mut self) {
        self.utf16_with_nul.fill(0);
    }
}

#[derive(Default)]
struct GateState {
    busy: bool,
    window: Option<usize>,
}

#[derive(Default)]
struct RequestGate {
    state: Mutex<GateState>,
    finished: Condvar,
}

impl RequestGate {
    fn begin(&self) -> Result<(), DropTargetError> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| DropTargetError::ServiceUnavailable)?;
        if state.busy {
            return Err(DropTargetError::Busy);
        }
        state.busy = true;
        state.window = None;
        Ok(())
    }

    fn set_window(&self, window: HWND) -> Result<(), DropTargetError> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| DropTargetError::ServiceUnavailable)?;
        if !state.busy {
            return Err(DropTargetError::ServiceUnavailable);
        }
        state.window = Some(hwnd_to_value(window));
        Ok(())
    }

    fn request_cancel(&self) -> Result<(), DropTargetError> {
        let state = self
            .state
            .lock()
            .map_err(|_| DropTargetError::ServiceUnavailable)?;
        let window = state.window;
        let Some(window) = window else {
            return Ok(());
        };
        let result = unsafe {
            PostMessageW(
                Some(hwnd_from_value(window)),
                WM_CLOSE,
                WPARAM(0),
                LPARAM(0),
            )
        };
        drop(state);
        result.map_err(|_| DropTargetError::ServiceUnavailable)
    }

    fn clear_window(&self, window: HWND) -> Result<(), DropTargetError> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| DropTargetError::ServiceUnavailable)?;
        if state.window != Some(hwnd_to_value(window)) {
            return Err(DropTargetError::ServiceUnavailable);
        }
        state.window = None;
        Ok(())
    }

    fn finish(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.busy = false;
            state.window = None;
            self.finished.notify_all();
        }
    }
}

pub struct PendingDrop {
    cancellation: Arc<AtomicBool>,
    gate: Arc<RequestGate>,
    receiver: Option<mpsc::Receiver<Result<DropTargetOutcome, DropTargetError>>>,
    thread: Option<JoinHandle<()>>,
    finished: bool,
}

impl PendingDrop {
    pub fn request_cancel(&self) -> Result<(), DropTargetError> {
        self.cancellation.store(true, Ordering::Release);
        self.gate.request_cancel()
    }

    pub fn wait(mut self) -> Result<DropTargetOutcome, DropTargetError> {
        let result = self
            .receiver
            .take()
            .ok_or(DropTargetError::ServiceUnavailable)?
            .recv()
            .unwrap_or(Err(DropTargetError::ServiceUnavailable));
        self.finish();
        result
    }

    fn finish(&mut self) {
        if self.finished {
            return;
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        self.gate.finish();
        self.finished = true;
    }
}

impl Drop for PendingDrop {
    fn drop(&mut self) {
        if !self.finished {
            let _ = self.request_cancel();
            self.finish();
        }
    }
}

pub struct DropTargetSta {
    gate: Arc<RequestGate>,
}

impl DropTargetSta {
    pub fn start() -> Result<Self, DropTargetError> {
        Ok(Self {
            gate: Arc::new(RequestGate::default()),
        })
    }

    pub fn begin(&self) -> Result<PendingDrop, DropTargetError> {
        self.gate.begin()?;
        let cancellation = Arc::new(AtomicBool::new(false));
        let thread_cancellation = Arc::clone(&cancellation);
        let thread_gate = Arc::clone(&self.gate);
        let (startup_sender, startup_receiver) = mpsc::sync_channel(1);
        let (result_sender, result_receiver) = mpsc::sync_channel(1);
        let thread = match thread::Builder::new()
            .name("windows-drop-target-sta".to_owned())
            .spawn(move || {
                drop_target_thread(
                    startup_sender,
                    result_sender,
                    thread_cancellation,
                    thread_gate,
                );
            }) {
            Ok(thread) => thread,
            Err(_) => {
                self.gate.finish();
                return Err(DropTargetError::StartupFailed);
            }
        };
        match startup_receiver.recv() {
            Ok(Ok(_window)) => {}
            Ok(Err(error)) => {
                let _ = thread.join();
                self.gate.finish();
                return Err(error);
            }
            Err(_) => {
                let _ = thread.join();
                self.gate.finish();
                return Err(DropTargetError::StartupFailed);
            }
        }
        Ok(PendingDrop {
            cancellation,
            gate: Arc::clone(&self.gate),
            receiver: Some(result_receiver),
            thread: Some(thread),
            finished: false,
        })
    }

    pub fn shutdown(self) -> Result<(), DropTargetError> {
        let state = self
            .gate
            .state
            .lock()
            .map_err(|_| DropTargetError::ServiceUnavailable)?;
        if state.busy {
            return Err(DropTargetError::Busy);
        }
        Ok(())
    }
}

impl Drop for DropTargetSta {
    fn drop(&mut self) {
        let _ = self.gate.request_cancel();
    }
}

struct DropShared {
    outcome: RefCell<Option<Result<DropTargetOutcome, DropTargetError>>>,
    hover_valid: Cell<bool>,
    drag_over_logged: Cell<bool>,
}

impl DropShared {
    fn new() -> Self {
        Self {
            outcome: RefCell::new(None),
            hover_valid: Cell::new(false),
            drag_over_logged: Cell::new(false),
        }
    }

    fn complete(&self, outcome: Result<DropTargetOutcome, DropTargetError>) {
        if self.outcome.borrow().is_none() {
            self.outcome.replace(Some(outcome));
        }
    }

    fn is_terminal(&self) -> bool {
        self.outcome.borrow().is_some()
    }

    fn take_outcome(&self) -> Option<Result<DropTargetOutcome, DropTargetError>> {
        self.outcome.borrow_mut().take()
    }
}

#[implement(IDropTarget)]
struct FileSystemDropTarget {
    window: HWND,
    shared: Rc<DropShared>,
}

#[allow(non_snake_case)]
impl IDropTarget_Impl for FileSystemDropTarget_Impl {
    fn DragEnter(
        &self,
        data_object: windows_core::Ref<'_, IDataObject>,
        _key_state: MODIFIERKEYS_FLAGS,
        _point: &POINTL,
        effect: *mut DROPEFFECT,
    ) -> windows::core::Result<()> {
        let offered_effect = effect_bits(effect);
        let has_cfhdrop = data_object.as_ref().is_some_and(query_cfhdrop);
        let valid = has_cfhdrop && copy_is_allowed(effect);
        self.shared.hover_valid.set(valid);
        self.shared.drag_over_logged.set(false);
        debug_drop_trace(
            DropTraceStage::DragEnter,
            Some(has_cfhdrop),
            valid,
            offered_effect,
            valid,
        );
        set_effect(effect, valid);
        Ok(())
    }

    fn DragOver(
        &self,
        _key_state: MODIFIERKEYS_FLAGS,
        _point: &POINTL,
        effect: *mut DROPEFFECT,
    ) -> windows::core::Result<()> {
        let offered_effect = effect_bits(effect);
        let valid = drop_is_acceptable(self.shared.hover_valid.get(), effect);
        if !self.shared.drag_over_logged.replace(true) {
            debug_drop_trace(
                DropTraceStage::DragOver,
                None,
                self.shared.hover_valid.get(),
                offered_effect,
                valid,
            );
        }
        set_effect(effect, valid);
        Ok(())
    }

    fn DragLeave(&self) -> windows::core::Result<()> {
        debug_drop_trace(
            DropTraceStage::DragLeave,
            None,
            self.shared.hover_valid.get(),
            0,
            false,
        );
        self.shared.hover_valid.set(false);
        self.shared.drag_over_logged.set(false);
        Ok(())
    }

    fn Drop(
        &self,
        data_object: windows_core::Ref<'_, IDataObject>,
        _key_state: MODIFIERKEYS_FLAGS,
        _point: &POINTL,
        effect: *mut DROPEFFECT,
    ) -> windows::core::Result<()> {
        let offered_effect = effect_bits(effect);
        let hover_valid = self.shared.hover_valid.get();
        let eligible = drop_is_acceptable(hover_valid, effect);
        debug_drop_trace(
            DropTraceStage::DropBegin,
            None,
            hover_valid,
            offered_effect,
            eligible,
        );
        let result = if eligible {
            data_object
                .as_ref()
                .ok_or(DropTargetError::InvalidDrop)
                .and_then(extract_cfhdrop_selection)
                .map(DropTargetOutcome::Dropped)
        } else {
            Err(DropTargetError::InvalidDrop)
        };
        let accepted = result.is_ok();
        debug_drop_trace(
            DropTraceStage::DropComplete,
            None,
            hover_valid,
            offered_effect,
            accepted,
        );
        set_effect(effect, accepted);
        self.shared.hover_valid.set(false);
        self.shared.drag_over_logged.set(false);
        self.shared.complete(result);
        let _ = unsafe {
            PostMessageW(
                Some(self.window),
                WM_DROP_TARGET_TERMINAL,
                WPARAM(0),
                LPARAM(0),
            )
        };
        Ok(())
    }
}

fn query_cfhdrop(data_object: &IDataObject) -> bool {
    let format = cfhdrop_format();
    unsafe { data_object.QueryGetData(&format) }.is_ok()
}

fn cfhdrop_format() -> FORMATETC {
    FORMATETC {
        cfFormat: CF_HDROP.0,
        ptd: ptr::null_mut(),
        dwAspect: DVASPECT_CONTENT.0,
        lindex: -1,
        tymed: TYMED_HGLOBAL.0 as u32,
    }
}

fn copy_is_allowed(effect: *mut DROPEFFECT) -> bool {
    !effect.is_null() && unsafe { (*effect).0 & DROPEFFECT_COPY.0 != 0 }
}

fn effect_bits(effect: *mut DROPEFFECT) -> u32 {
    if effect.is_null() {
        0
    } else {
        unsafe { (*effect).0 }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DropTraceStage {
    DragEnter,
    DragOver,
    DragLeave,
    DropBegin,
    DropComplete,
}

#[cfg(debug_assertions)]
impl DropTraceStage {
    fn as_str(self) -> &'static str {
        match self {
            Self::DragEnter => "drag_enter",
            Self::DragOver => "drag_over",
            Self::DragLeave => "drag_leave",
            Self::DropBegin => "drop_begin",
            Self::DropComplete => "drop_complete",
        }
    }
}

#[cfg(debug_assertions)]
fn debug_drop_trace_line(
    stage: DropTraceStage,
    has_cfhdrop: Option<bool>,
    hover_valid: bool,
    offered_effect: u32,
    accepted: bool,
) -> String {
    format!(
        "omnitwin_drop_trace stage={} cfhdrop={has_cfhdrop:?} hover_valid={hover_valid} effect=0x{offered_effect:08x} accepted={accepted}",
        stage.as_str()
    )
}

#[cfg(debug_assertions)]
fn debug_drop_trace(
    stage: DropTraceStage,
    has_cfhdrop: Option<bool>,
    hover_valid: bool,
    offered_effect: u32,
    accepted: bool,
) {
    eprintln!(
        "{}",
        debug_drop_trace_line(stage, has_cfhdrop, hover_valid, offered_effect, accepted)
    );
}

#[cfg(not(debug_assertions))]
fn debug_drop_trace(
    _stage: DropTraceStage,
    _has_cfhdrop: Option<bool>,
    _hover_valid: bool,
    _offered_effect: u32,
    _accepted: bool,
) {
}

fn drop_is_acceptable(hover_valid: bool, effect: *mut DROPEFFECT) -> bool {
    hover_valid && copy_is_allowed(effect)
}

fn set_effect(effect: *mut DROPEFFECT, accepted: bool) {
    if !effect.is_null() {
        unsafe {
            *effect = if accepted {
                DROPEFFECT_COPY
            } else {
                DROPEFFECT_NONE
            }
        };
    }
}

fn drop_window_ex_style() -> WINDOW_EX_STYLE {
    WINDOW_EX_STYLE(WS_EX_APPWINDOW.0 | WS_EX_TOPMOST.0)
}

struct StgMediumGuard(STGMEDIUM);

impl Drop for StgMediumGuard {
    fn drop(&mut self) {
        unsafe { ReleaseStgMedium(&mut self.0) };
    }
}

fn extract_cfhdrop_selection(
    data_object: &IDataObject,
) -> Result<DroppedSelection, DropTargetError> {
    let format = cfhdrop_format();
    let medium =
        unsafe { data_object.GetData(&format) }.map_err(|_| DropTargetError::InvalidDrop)?;
    let medium = StgMediumGuard(medium);
    if medium.0.tymed != TYMED_HGLOBAL.0 as u32 {
        return Err(DropTargetError::InvalidDrop);
    }
    let hglobal = unsafe { medium.0.u.hGlobal };
    if hglobal.0.is_null() {
        return Err(DropTargetError::InvalidDrop);
    }
    extract_hdrop_selection(HDROP(hglobal.0))
}

fn extract_hdrop_selection(hdrop: HDROP) -> Result<DroppedSelection, DropTargetError> {
    let count = unsafe { DragQueryFileW(hdrop, u32::MAX, None) };
    validate_drop_count(count)?;
    let mut locators = Vec::with_capacity(count as usize);
    for index in 0..count {
        let length = unsafe { DragQueryFileW(hdrop, index, None) } as usize;
        if length == 0 {
            return Err(DropTargetError::InvalidDrop);
        }
        if length > MAX_PRIVATE_PATH_UTF16_UNITS {
            return Err(DropTargetError::SelectionLimitExceeded);
        }
        let mut utf16_with_nul = vec![0u16; length + 1];
        let copied = unsafe { DragQueryFileW(hdrop, index, Some(&mut utf16_with_nul)) } as usize;
        if copied != length || utf16_with_nul[length] != 0 {
            utf16_with_nul.fill(0);
            return Err(DropTargetError::InvalidDrop);
        }
        locators.push(DroppedLocator { utf16_with_nul });
    }
    Ok(DroppedSelection { locators })
}

fn validate_drop_count(count: u32) -> Result<(), DropTargetError> {
    if count == 0 {
        Err(DropTargetError::InvalidDrop)
    } else if count > MAX_DROPPED_ROOTS {
        Err(DropTargetError::SelectionLimitExceeded)
    } else {
        Ok(())
    }
}

struct OleApartment;

impl OleApartment {
    fn initialize() -> Result<Self, DropTargetError> {
        unsafe { OleInitialize(None) }.map_err(|_| DropTargetError::StartupFailed)?;
        Ok(Self)
    }
}

impl Drop for OleApartment {
    fn drop(&mut self) {
        unsafe { OleUninitialize() };
    }
}

struct WindowClassRegistration {
    name: Vec<u16>,
    instance: HINSTANCE,
}

impl Drop for WindowClassRegistration {
    fn drop(&mut self) {
        let _ = unsafe { UnregisterClassW(PCWSTR(self.name.as_ptr()), Some(self.instance)) };
    }
}

struct OwnedWindow(HWND);

impl OwnedWindow {
    fn destroy(&mut self) -> Result<(), DropTargetError> {
        if self.0 .0.is_null() {
            return Ok(());
        }
        unsafe { SetWindowLongPtrW(self.0, GWLP_USERDATA, 0) };
        unsafe { DestroyWindow(self.0) }.map_err(|_| DropTargetError::CleanupFailed)?;
        self.0 = HWND::default();
        Ok(())
    }
}

impl Drop for OwnedWindow {
    fn drop(&mut self) {
        let _ = self.destroy();
    }
}

struct DropRegistration {
    window: HWND,
    active: bool,
}

impl DropRegistration {
    fn revoke(&mut self) -> Result<(), DropTargetError> {
        if !self.active {
            return Ok(());
        }
        unsafe { RevokeDragDrop(self.window) }.map_err(|_| DropTargetError::CleanupFailed)?;
        self.active = false;
        Ok(())
    }
}

impl Drop for DropRegistration {
    fn drop(&mut self) {
        let _ = self.revoke();
    }
}

struct CancellationPollTimer {
    window: HWND,
    active: bool,
}

impl CancellationPollTimer {
    fn start(window: HWND) -> Result<Self, DropTargetError> {
        let timer = unsafe {
            SetTimer(
                Some(window),
                CANCELLATION_POLL_TIMER_ID,
                CANCELLATION_POLL_MILLISECONDS,
                None,
            )
        };
        if timer == 0 {
            return Err(DropTargetError::StartupFailed);
        }
        Ok(Self {
            window,
            active: true,
        })
    }

    fn stop(&mut self) -> Result<(), DropTargetError> {
        if !self.active {
            return Ok(());
        }
        unsafe { KillTimer(Some(self.window), CANCELLATION_POLL_TIMER_ID) }
            .map_err(|_| DropTargetError::CleanupFailed)?;
        self.active = false;
        Ok(())
    }
}

impl Drop for CancellationPollTimer {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

struct PublishedWindow {
    gate: Arc<RequestGate>,
    window: HWND,
    active: bool,
}

impl PublishedWindow {
    fn publish(gate: Arc<RequestGate>, window: HWND) -> Result<Self, DropTargetError> {
        gate.set_window(window)?;
        Ok(Self {
            gate,
            window,
            active: true,
        })
    }

    fn clear(&mut self) -> Result<(), DropTargetError> {
        if !self.active {
            return Ok(());
        }
        self.gate.clear_window(self.window)?;
        self.active = false;
        Ok(())
    }
}

impl Drop for PublishedWindow {
    fn drop(&mut self) {
        let _ = self.clear();
    }
}

fn drop_target_thread(
    startup_sender: mpsc::SyncSender<Result<usize, DropTargetError>>,
    result_sender: mpsc::SyncSender<Result<DropTargetOutcome, DropTargetError>>,
    cancellation: Arc<AtomicBool>,
    gate: Arc<RequestGate>,
) {
    let mut startup_sender = Some(startup_sender);
    let result = run_drop_target(&mut startup_sender, &cancellation, gate);
    if let Some(sender) = startup_sender {
        let error = match result {
            Err(error) => error,
            Ok(_) => DropTargetError::StartupFailed,
        };
        let _ = sender.send(Err(error));
    } else {
        let _ = result_sender.send(result);
    }
}

fn run_drop_target(
    startup_sender: &mut Option<mpsc::SyncSender<Result<usize, DropTargetError>>>,
    cancellation: &AtomicBool,
    gate: Arc<RequestGate>,
) -> Result<DropTargetOutcome, DropTargetError> {
    let _apartment = OleApartment::initialize()?;
    let module = unsafe { GetModuleHandleW(None) }.map_err(|_| DropTargetError::StartupFailed)?;
    let instance = HINSTANCE(module.0);
    let sequence = WINDOW_CLASS_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let class_name: Vec<u16> = format!("OmniTwinDropTargetWindow{sequence}")
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let window_class = WNDCLASSW {
        lpfnWndProc: Some(drop_window_proc),
        hInstance: instance,
        lpszClassName: PCWSTR(class_name.as_ptr()),
        ..Default::default()
    };
    if unsafe { RegisterClassW(&window_class) } == 0 {
        return Err(DropTargetError::StartupFailed);
    }
    let _class_registration = WindowClassRegistration {
        name: class_name.clone(),
        instance,
    };
    let style = WINDOW_STYLE(WS_OVERLAPPED.0 | WS_CAPTION.0 | WS_SYSMENU.0 | WS_MINIMIZEBOX.0);
    let window = unsafe {
        CreateWindowExW(
            drop_window_ex_style(),
            PCWSTR(class_name.as_ptr()),
            w!("OmniTwin local intake — drop files or folders"),
            style,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            DROP_WINDOW_WIDTH,
            DROP_WINDOW_HEIGHT,
            None,
            None,
            Some(instance),
            None,
        )
    }
    .map_err(|_| DropTargetError::StartupFailed)?;
    let mut window = OwnedWindow(window);
    let shared = Rc::new(DropShared::new());
    unsafe {
        SetWindowLongPtrW(window.0, GWLP_USERDATA, Rc::as_ptr(&shared) as isize);
    }
    let child_style = WINDOW_STYLE(WS_CHILD.0 | WS_VISIBLE.0);
    let instruction = unsafe {
        CreateWindowExW(
            WINDOW_EX_STYLE(0),
            w!("STATIC"),
            w!("Drop local files and folders into this Windows panel.\r\nPress Escape or close the panel to cancel."),
            child_style,
            28,
            48,
            DROP_WINDOW_WIDTH - 72,
            84,
            Some(window.0),
            None,
            Some(instance),
            None,
        )
    }
    .map_err(|_| DropTargetError::StartupFailed)?;
    let target: IDropTarget = FileSystemDropTarget {
        window: window.0,
        shared: Rc::clone(&shared),
    }
    .into();
    unsafe { RegisterDragDrop(window.0, &target) }
        .map_err(|_| DropTargetError::RegistrationFailed)?;
    let mut window_registration = DropRegistration {
        window: window.0,
        active: true,
    };
    unsafe { RegisterDragDrop(instruction, &target) }
        .map_err(|_| DropTargetError::RegistrationFailed)?;
    let mut instruction_registration = DropRegistration {
        window: instruction,
        active: true,
    };
    let mut cancellation_timer = CancellationPollTimer::start(window.0)?;
    unsafe {
        let _ = ShowWindow(window.0, SW_SHOWNORMAL);
        // The first ShowWindow can honor the hidden process startup flag. A
        // second explicit call makes the helper-owned panel visible.
        let _ = ShowWindow(window.0, SW_SHOWNORMAL);
        let _ = UpdateWindow(window.0);
        let _ = SetForegroundWindow(window.0);
    }
    let mut published_window = PublishedWindow::publish(gate, window.0)?;
    let sender = startup_sender
        .take()
        .ok_or(DropTargetError::ServiceUnavailable)?;
    sender
        .send(Ok(hwnd_to_value(window.0)))
        .map_err(|_| DropTargetError::ServiceUnavailable)?;
    let mut message = MSG::default();
    while !shared.is_terminal() {
        if cancellation.load(Ordering::Acquire) {
            shared.complete(Ok(DropTargetOutcome::Cancelled));
            break;
        }
        let result = unsafe { GetMessageW(&mut message, None, 0, 0) };
        if result.0 <= 0 {
            if !shared.is_terminal() {
                shared.complete(Err(DropTargetError::ServiceUnavailable));
            }
            break;
        }
        unsafe {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
    let outcome = shared
        .take_outcome()
        .unwrap_or(Err(DropTargetError::ServiceUnavailable));
    let unpublished = published_window.clear();
    let timer_stopped = cancellation_timer.stop();
    let instruction_revoked = instruction_registration.revoke();
    let window_revoked = window_registration.revoke();
    let destroyed = window.destroy();
    drop(target);
    if unpublished.is_err()
        || timer_stopped.is_err()
        || instruction_revoked.is_err()
        || window_revoked.is_err()
        || destroyed.is_err()
    {
        return Err(DropTargetError::CleanupFailed);
    }
    outcome
}

unsafe extern "system" fn drop_window_proc(
    window: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if message == WM_DROP_TARGET_TERMINAL {
        return LRESULT(0);
    }
    if is_native_cancel_message(message, wparam) {
        let shared = unsafe { GetWindowLongPtrW(window, GWLP_USERDATA) } as *const DropShared;
        if !shared.is_null() {
            unsafe { &*shared }.complete(Ok(DropTargetOutcome::Cancelled));
            let _ = unsafe {
                PostMessageW(Some(window), WM_DROP_TARGET_TERMINAL, WPARAM(0), LPARAM(0))
            };
        }
        return LRESULT(0);
    }
    unsafe { DefWindowProcW(window, message, wparam, lparam) }
}

fn is_native_cancel_message(message: u32, wparam: WPARAM) -> bool {
    message == WM_CLOSE || (message == WM_KEYDOWN && wparam.0 == ESCAPE_VIRTUAL_KEY)
}

fn hwnd_to_value(window: HWND) -> usize {
    window.0 as usize
}

fn hwnd_from_value(value: usize) -> HWND {
    HWND(value as *mut c_void)
}

#[cfg(test)]
mod tests {
    use std::mem::size_of;

    use super::*;
    use windows::Win32::Foundation::{GlobalFree, HGLOBAL};
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
    use windows::Win32::UI::Shell::DROPFILES;
    use windows_core::BOOL;

    struct TestGlobal(HGLOBAL);

    impl Drop for TestGlobal {
        fn drop(&mut self) {
            let _ = unsafe { GlobalFree(Some(self.0)) };
        }
    }

    #[test]
    fn drop_count_limits_fail_closed() {
        assert_eq!(validate_drop_count(0), Err(DropTargetError::InvalidDrop));
        assert_eq!(validate_drop_count(1), Ok(()));
        assert_eq!(validate_drop_count(128), Ok(()));
        assert_eq!(
            validate_drop_count(129),
            Err(DropTargetError::SelectionLimitExceeded)
        );
    }

    #[test]
    fn explorer_format_wide_cfhdrop_extracts_every_locator_exactly() {
        let expected = [r"C:\capture\scan.e57", r"D:\project-folder"];
        let mut wide = Vec::<u16>::new();
        for path in expected {
            wide.extend(path.encode_utf16());
            wide.push(0);
        }
        wide.push(0);
        let header = DROPFILES {
            pFiles: size_of::<DROPFILES>() as u32,
            pt: Default::default(),
            fNC: BOOL(0),
            fWide: BOOL(1),
        };
        let allocation_bytes = size_of::<DROPFILES>() + wide.len() * size_of::<u16>();
        let allocation =
            TestGlobal(unsafe { GlobalAlloc(GMEM_MOVEABLE, allocation_bytes) }.expect("allocate"));
        let memory = unsafe { GlobalLock(allocation.0) };
        assert!(!memory.is_null());
        unsafe {
            ptr::write_unaligned(memory.cast::<DROPFILES>(), header);
            ptr::copy_nonoverlapping(
                wide.as_ptr().cast::<u8>(),
                memory.cast::<u8>().add(size_of::<DROPFILES>()),
                wide.len() * size_of::<u16>(),
            );
            let _ = GlobalUnlock(allocation.0);
        }

        let selection = extract_hdrop_selection(HDROP(allocation.0 .0))
            .expect("valid wide CF_HDROP should extract");
        let actual = selection
            .locators()
            .iter()
            .map(|locator| String::from_utf16(locator.as_utf16()).expect("valid UTF-16"))
            .collect::<Vec<_>>();
        assert_eq!(actual, expected);
    }

    #[test]
    fn copy_effect_is_intersection_of_source_and_target_support() {
        let mut copy = DROPEFFECT_COPY;
        assert!(copy_is_allowed(&mut copy));
        assert!(drop_is_acceptable(true, &mut copy));
        assert!(!drop_is_acceptable(false, &mut copy));
        set_effect(&mut copy, true);
        assert_eq!(copy, DROPEFFECT_COPY);

        let mut none = DROPEFFECT_NONE;
        assert!(!copy_is_allowed(&mut none));
        set_effect(&mut none, false);
        assert_eq!(none, DROPEFFECT_NONE);

        let mut move_only = windows::Win32::System::Ole::DROPEFFECT_MOVE;
        assert!(!copy_is_allowed(&mut move_only));
        assert!(!drop_is_acceptable(true, &mut move_only));
        set_effect(&mut move_only, false);
        assert_eq!(move_only, DROPEFFECT_NONE);
        assert!(!copy_is_allowed(ptr::null_mut()));
    }

    #[test]
    fn one_shot_panel_is_explicitly_topmost_while_visible() {
        let style = drop_window_ex_style();
        assert_ne!(style.0 & WS_EX_APPWINDOW.0, 0);
        assert_ne!(style.0 & WS_EX_TOPMOST.0, 0);
    }

    #[test]
    fn debug_drop_telemetry_schema_has_no_locator_or_name_input_channel() {
        let stages = [
            DropTraceStage::DragEnter,
            DropTraceStage::DragOver,
            DropTraceStage::DragLeave,
            DropTraceStage::DropBegin,
            DropTraceStage::DropComplete,
        ];
        for stage in stages {
            let line = debug_drop_trace_line(stage, Some(true), true, 7, true);
            assert!(line.starts_with("omnitwin_drop_trace stage="));
            assert!(line.contains("cfhdrop=Some(true)"));
            assert!(line.contains("effect=0x00000007"));
            for private_marker in ["C:\\", "\\\\server", "customer-secret", ".e57"] {
                assert!(!line.contains(private_marker));
            }
        }
    }

    #[test]
    fn window_close_and_escape_are_the_only_native_cancel_messages() {
        assert!(is_native_cancel_message(WM_CLOSE, WPARAM(0)));
        assert!(is_native_cancel_message(
            WM_KEYDOWN,
            WPARAM(ESCAPE_VIRTUAL_KEY)
        ));
        assert!(!is_native_cancel_message(WM_KEYDOWN, WPARAM(0x0d)));
        assert!(!is_native_cancel_message(WM_APP, WPARAM(0)));
    }

    #[test]
    fn private_locator_debug_never_discloses_the_path() {
        let locator = DroppedLocator {
            utf16_with_nul: "C:\\private\\customer-secret.e57\0"
                .encode_utf16()
                .collect(),
        };
        let debug = format!("{locator:?}");
        assert!(!debug.contains("private"));
        assert!(!debug.contains("customer"));
        assert!(debug.contains("utf16_units"));
    }

    #[test]
    fn errors_are_fixed_and_never_carry_native_or_private_text() {
        for error in [
            DropTargetError::StartupFailed,
            DropTargetError::ServiceUnavailable,
            DropTargetError::Busy,
            DropTargetError::RegistrationFailed,
            DropTargetError::InvalidDrop,
            DropTargetError::SelectionLimitExceeded,
            DropTargetError::CleanupFailed,
        ] {
            let text = error.to_string();
            assert!(!text.contains(':'));
            assert!(!text.contains('\\'));
        }
    }
}
