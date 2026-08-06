use std::cell::{Cell, RefCell};
use std::collections::VecDeque;
use std::ffi::c_void;
use std::fmt;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::{self, JoinHandle};

use windows::core::{HRESULT, PCWSTR, PWSTR};
use windows::Win32::Foundation::{ERROR_CANCELLED, HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER,
    COINIT_APARTMENTTHREADED,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Shell::{
    FileOpenDialog, IFileOpenDialog, FILEOPENDIALOGOPTIONS, FOS_ALLOWMULTISELECT,
    FOS_DONTADDTORECENT, FOS_FILEMUSTEXIST, FOS_FORCEFILESYSTEM, FOS_NOCHANGEDIR,
    FOS_NODEREFERENCELINKS, FOS_PATHMUSTEXIST, FOS_PICKFOLDERS, SIGDN_FILESYSPATH,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW,
    GetWindowLongPtrW, PostMessageW, PostQuitMessage, RegisterClassW, SetWindowLongPtrW,
    TranslateMessage, UnregisterClassW, GWLP_USERDATA, HWND_MESSAGE, MSG, WINDOW_EX_STYLE,
    WINDOW_STYLE, WM_APP, WNDCLASSW,
};

use crate::path::MAX_PRIVATE_PATH_UTF16_UNITS;

pub const MAX_PICKED_ROOTS: u32 = 128;

pub const FILE_PICKER_OPTIONS: FILEOPENDIALOGOPTIONS = FILEOPENDIALOGOPTIONS(
    FOS_FORCEFILESYSTEM.0
        | FOS_PATHMUSTEXIST.0
        | FOS_FILEMUSTEXIST.0
        | FOS_ALLOWMULTISELECT.0
        | FOS_NODEREFERENCELINKS.0
        | FOS_DONTADDTORECENT.0
        | FOS_NOCHANGEDIR.0,
);

pub const FOLDER_PICKER_OPTIONS: FILEOPENDIALOGOPTIONS = FILEOPENDIALOGOPTIONS(
    FOS_FORCEFILESYSTEM.0
        | FOS_PATHMUSTEXIST.0
        | FOS_PICKFOLDERS.0
        | FOS_NODEREFERENCELINKS.0
        | FOS_DONTADDTORECENT.0
        | FOS_NOCHANGEDIR.0,
);

const WM_PICKER_DISPATCH: u32 = WM_APP + 0x451;
const CANCEL_HRESULT: HRESULT = HRESULT::from_win32(ERROR_CANCELLED.0);
static WINDOW_CLASS_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PickerMode {
    Files,
    Folder,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PickerError {
    StartupFailed,
    ServiceUnavailable,
    Busy,
    DialogFailed,
    InvalidResults,
    SelectionLimitExceeded,
}

impl fmt::Display for PickerError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::StartupFailed => "the Windows picker service could not start",
            Self::ServiceUnavailable => "the Windows picker service is unavailable",
            Self::Busy => "a Windows picker request is already active",
            Self::DialogFailed => "the Windows picker failed",
            Self::InvalidResults => "the Windows picker returned invalid results",
            Self::SelectionLimitExceeded => "the Windows picker selection limit was exceeded",
        })
    }
}

impl std::error::Error for PickerError {}

pub enum PickerOutcome {
    Selected(PickedSelection),
    Cancelled,
}

impl fmt::Debug for PickerOutcome {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Selected(selection) => {
                formatter.debug_tuple("Selected").field(selection).finish()
            }
            Self::Cancelled => formatter.write_str("Cancelled"),
        }
    }
}

pub struct PickedSelection {
    mode: PickerMode,
    locators: Vec<PickedLocator>,
}

impl PickedSelection {
    #[must_use]
    pub fn mode(&self) -> PickerMode {
        self.mode
    }

    #[must_use]
    pub fn locators(&self) -> &[PickedLocator] {
        &self.locators
    }

    #[must_use]
    pub fn into_locators(self) -> Vec<PickedLocator> {
        self.locators
    }
}

impl fmt::Debug for PickedSelection {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PickedSelection")
            .field("mode", &self.mode)
            .field("locator_count", &self.locators.len())
            .finish()
    }
}

/// An untrusted, picker-returned UTF-16 locator. The authoritative custody
/// layer must consume it immediately; selecting it does not establish trust.
pub struct PickedLocator {
    utf16_with_nul: Vec<u16>,
}

impl PickedLocator {
    #[must_use]
    pub fn as_utf16(&self) -> &[u16] {
        &self.utf16_with_nul[..self.utf16_with_nul.len() - 1]
    }

    #[must_use]
    pub fn as_pcwstr(&self) -> PCWSTR {
        PCWSTR(self.utf16_with_nul.as_ptr())
    }
}

impl fmt::Debug for PickedLocator {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PickedLocator")
            .field("utf16_units", &self.as_utf16().len())
            .finish()
    }
}

impl Drop for PickedLocator {
    fn drop(&mut self) {
        self.utf16_with_nul.fill(0);
    }
}

pub struct PendingPick {
    request_id: u64,
    cancellation: Arc<AtomicBool>,
    transport: Arc<Transport>,
    receiver: Option<mpsc::Receiver<Result<PickerOutcome, PickerError>>>,
}

impl PendingPick {
    pub fn request_cancel(&self) -> Result<(), PickerError> {
        if self.cancellation.swap(true, Ordering::AcqRel) {
            return Ok(());
        }
        self.transport.post(Command::Cancel(self.request_id))
    }

    pub fn wait(mut self) -> Result<PickerOutcome, PickerError> {
        let receiver = self
            .receiver
            .take()
            .ok_or(PickerError::ServiceUnavailable)?;
        receiver
            .recv()
            .unwrap_or(Err(PickerError::ServiceUnavailable))
    }
}

impl Drop for PendingPick {
    fn drop(&mut self) {
        if self.receiver.is_some() {
            let _ = self.request_cancel();
        }
    }
}

pub struct PickerSta {
    transport: Arc<Transport>,
    gate: Arc<RequestGate>,
    next_request_id: AtomicU64,
    thread: Option<JoinHandle<()>>,
}

impl PickerSta {
    pub fn start() -> Result<Self, PickerError> {
        let queue = Arc::new(Mutex::new(VecDeque::new()));
        let thread_queue = Arc::clone(&queue);
        let (startup_sender, startup_receiver) = mpsc::sync_channel(1);
        let thread = thread::Builder::new()
            .name("windows-picker-sta".to_owned())
            .spawn(move || picker_thread(thread_queue, startup_sender))
            .map_err(|_| PickerError::StartupFailed)?;
        let hwnd_value = match startup_receiver.recv() {
            Ok(Ok(value)) => value,
            _ => {
                let _ = thread.join();
                return Err(PickerError::StartupFailed);
            }
        };
        Ok(Self {
            transport: Arc::new(Transport {
                hwnd_value,
                queue,
                next_dispatch_id: AtomicU64::new(1),
            }),
            gate: Arc::new(RequestGate::default()),
            next_request_id: AtomicU64::new(1),
            thread: Some(thread),
        })
    }

    pub fn begin_files(&self) -> Result<PendingPick, PickerError> {
        self.begin(PickerMode::Files)
    }

    pub fn begin_folder(&self) -> Result<PendingPick, PickerError> {
        self.begin(PickerMode::Folder)
    }

    pub fn shutdown(mut self) -> Result<(), PickerError> {
        if let Err(error) = self.request_shutdown() {
            let _ = self.thread.take();
            return Err(error);
        }
        let Some(thread) = self.thread.take() else {
            return Ok(());
        };
        thread.join().map_err(|_| PickerError::ServiceUnavailable)
    }

    fn begin(&self, mode: PickerMode) -> Result<PendingPick, PickerError> {
        let request_id = self.next_request_id.fetch_add(1, Ordering::Relaxed);
        if request_id == 0 {
            return Err(PickerError::ServiceUnavailable);
        }
        let cancellation = Arc::new(AtomicBool::new(false));
        self.gate.begin(request_id, Arc::clone(&cancellation))?;
        let (sender, receiver) = mpsc::channel();
        let command = Command::Pick(PickRequest {
            request_id,
            mode,
            cancellation: Arc::clone(&cancellation),
            gate: Arc::clone(&self.gate),
            sender,
        });
        if let Err(error) = self.transport.post(command) {
            self.gate.finish(request_id);
            return Err(error);
        }
        Ok(PendingPick {
            request_id,
            cancellation,
            transport: Arc::clone(&self.transport),
            receiver: Some(receiver),
        })
    }

    fn request_shutdown(&self) -> Result<(), PickerError> {
        if let Some((request_id, cancellation)) = self.gate.active() {
            cancellation.store(true, Ordering::Release);
            let _ = self.transport.post(Command::Cancel(request_id));
        }
        self.transport.post(Command::Shutdown)
    }
}

impl Drop for PickerSta {
    fn drop(&mut self) {
        if self.thread.is_some() {
            let _ = self.request_shutdown();
            let _ = self.thread.take();
        }
    }
}

#[derive(Default)]
struct RequestGate {
    busy: AtomicBool,
    active_id: AtomicU64,
    cancellation: Mutex<Option<Arc<AtomicBool>>>,
}

impl RequestGate {
    fn begin(&self, request_id: u64, cancellation: Arc<AtomicBool>) -> Result<(), PickerError> {
        self.busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| PickerError::Busy)?;
        self.active_id.store(request_id, Ordering::Release);
        *self
            .cancellation
            .lock()
            .map_err(|_| PickerError::ServiceUnavailable)? = Some(cancellation);
        Ok(())
    }

    fn finish(&self, request_id: u64) {
        if self.active_id.load(Ordering::Acquire) == request_id {
            if let Ok(mut cancellation) = self.cancellation.lock() {
                *cancellation = None;
            }
            self.active_id.store(0, Ordering::Release);
            self.busy.store(false, Ordering::Release);
        }
    }

    fn active(&self) -> Option<(u64, Arc<AtomicBool>)> {
        let request_id = self.active_id.load(Ordering::Acquire);
        if request_id == 0 {
            return None;
        }
        self.cancellation
            .lock()
            .ok()?
            .as_ref()
            .map(|token| (request_id, Arc::clone(token)))
    }
}

struct Transport {
    hwnd_value: usize,
    queue: Arc<Mutex<VecDeque<QueuedCommand>>>,
    next_dispatch_id: AtomicU64,
}

impl Transport {
    fn post(&self, command: Command) -> Result<(), PickerError> {
        let dispatch_id = self.next_dispatch_id.fetch_add(1, Ordering::Relaxed);
        if dispatch_id == 0 {
            return Err(PickerError::ServiceUnavailable);
        }
        self.queue
            .lock()
            .map_err(|_| PickerError::ServiceUnavailable)?
            .push_back(QueuedCommand {
                dispatch_id,
                command,
            });
        let posted = unsafe {
            PostMessageW(
                Some(hwnd_from_value(self.hwnd_value)),
                WM_PICKER_DISPATCH,
                WPARAM(0),
                LPARAM(0),
            )
        };
        if posted.is_ok() {
            return Ok(());
        }
        let mut queue = self
            .queue
            .lock()
            .map_err(|_| PickerError::ServiceUnavailable)?;
        if let Some(index) = queue
            .iter()
            .position(|queued| queued.dispatch_id == dispatch_id)
        {
            queue.remove(index);
            return Err(PickerError::ServiceUnavailable);
        }
        Ok(())
    }
}

struct QueuedCommand {
    dispatch_id: u64,
    command: Command,
}

enum Command {
    Pick(PickRequest),
    Cancel(u64),
    Shutdown,
}

struct PickRequest {
    request_id: u64,
    mode: PickerMode,
    cancellation: Arc<AtomicBool>,
    gate: Arc<RequestGate>,
    sender: mpsc::Sender<Result<PickerOutcome, PickerError>>,
}

struct ActiveDialog {
    request_id: u64,
    dialog: IFileOpenDialog,
}

struct PickerThreadState {
    queue: Arc<Mutex<VecDeque<QueuedCommand>>>,
    active: RefCell<Option<ActiveDialog>>,
    shutdown_requested: Cell<bool>,
}

impl PickerThreadState {
    fn dispatch_one(&self) {
        let queued = self
            .queue
            .lock()
            .ok()
            .and_then(|mut queue| queue.pop_front());
        let Some(queued) = queued else {
            return;
        };
        match queued.command {
            Command::Pick(request) => self.run_pick(request),
            Command::Cancel(request_id) => self.cancel(request_id),
            Command::Shutdown => {
                self.shutdown_requested.set(true);
                self.close_active();
                if self.active.borrow().is_none() {
                    unsafe { PostQuitMessage(0) };
                }
            }
        }
    }

    fn run_pick(&self, request: PickRequest) {
        let result = if request.cancellation.load(Ordering::Acquire) {
            Ok(PickerOutcome::Cancelled)
        } else {
            self.show_dialog(request.request_id, request.mode, &request.cancellation)
        };
        request.gate.finish(request.request_id);
        let _ = request.sender.send(result);
        if self.shutdown_requested.get() {
            unsafe { PostQuitMessage(0) };
        }
    }

    fn show_dialog(
        &self,
        request_id: u64,
        mode: PickerMode,
        cancellation: &AtomicBool,
    ) -> Result<PickerOutcome, PickerError> {
        let dialog: IFileOpenDialog = unsafe {
            CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)
                .map_err(|_| PickerError::DialogFailed)?
        };
        let options = match mode {
            PickerMode::Files => FILE_PICKER_OPTIONS,
            PickerMode::Folder => FOLDER_PICKER_OPTIONS,
        };
        unsafe { dialog.SetOptions(options) }.map_err(|_| PickerError::DialogFailed)?;
        self.active.replace(Some(ActiveDialog {
            request_id,
            dialog: dialog.clone(),
        }));
        let show_result = if cancellation.load(Ordering::Acquire) {
            Err(windows::core::Error::from_hresult(CANCEL_HRESULT))
        } else {
            unsafe { dialog.Show(None) }
        };
        self.active.replace(None);
        match show_result {
            Ok(()) => collect_results(&dialog, mode).map(PickerOutcome::Selected),
            Err(error) => classify_show_failure(&error),
        }
    }

    fn cancel(&self, request_id: u64) {
        let dialog = self
            .active
            .borrow()
            .as_ref()
            .filter(|active| active.request_id == request_id)
            .map(|active| active.dialog.clone());
        if let Some(dialog) = dialog {
            let _ = unsafe { dialog.Close(CANCEL_HRESULT) };
        }
    }

    fn close_active(&self) {
        let dialog = self
            .active
            .borrow()
            .as_ref()
            .map(|active| active.dialog.clone());
        if let Some(dialog) = dialog {
            let _ = unsafe { dialog.Close(CANCEL_HRESULT) };
        }
    }

    fn reject_queued(&self) {
        let Ok(mut queue) = self.queue.lock() else {
            return;
        };
        while let Some(queued) = queue.pop_front() {
            if let Command::Pick(request) = queued.command {
                request.gate.finish(request.request_id);
                let _ = request.sender.send(Err(PickerError::ServiceUnavailable));
            }
        }
    }
}

fn picker_thread(
    queue: Arc<Mutex<VecDeque<QueuedCommand>>>,
    startup: mpsc::SyncSender<Result<usize, PickerError>>,
) {
    let Ok(_apartment) = ComApartment::initialize() else {
        let _ = startup.send(Err(PickerError::StartupFailed));
        return;
    };
    let Ok(module) = (unsafe { GetModuleHandleW(None) }) else {
        let _ = startup.send(Err(PickerError::StartupFailed));
        return;
    };
    let instance = HINSTANCE(module.0);
    let class_sequence = WINDOW_CLASS_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let class_name: Vec<u16> = format!("OmniTwinPickerStaWindow{class_sequence}")
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let window_class = WNDCLASSW {
        lpfnWndProc: Some(picker_window_proc),
        hInstance: instance,
        lpszClassName: PCWSTR(class_name.as_ptr()),
        ..Default::default()
    };
    if unsafe { RegisterClassW(&window_class) } == 0 {
        let _ = startup.send(Err(PickerError::StartupFailed));
        return;
    }
    let state = Box::new(PickerThreadState {
        queue,
        active: RefCell::new(None),
        shutdown_requested: Cell::new(false),
    });
    let window = unsafe {
        CreateWindowExW(
            WINDOW_EX_STYLE(0),
            PCWSTR(class_name.as_ptr()),
            PCWSTR(class_name.as_ptr()),
            WINDOW_STYLE(0),
            0,
            0,
            0,
            0,
            Some(HWND_MESSAGE),
            None,
            Some(instance),
            None,
        )
    };
    let Ok(window) = window else {
        let _ = unsafe { UnregisterClassW(PCWSTR(class_name.as_ptr()), Some(instance)) };
        let _ = startup.send(Err(PickerError::StartupFailed));
        return;
    };
    unsafe {
        SetWindowLongPtrW(
            window,
            GWLP_USERDATA,
            (&*state as *const PickerThreadState) as isize,
        )
    };
    if startup.send(Ok(hwnd_to_value(window))).is_err() {
        let _ = unsafe { DestroyWindow(window) };
        let _ = unsafe { UnregisterClassW(PCWSTR(class_name.as_ptr()), Some(instance)) };
        return;
    }

    let mut message = MSG::default();
    loop {
        let result = unsafe { GetMessageW(&mut message, None, 0, 0) };
        if result.0 <= 0 {
            break;
        }
        unsafe {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
    state.reject_queued();
    unsafe { SetWindowLongPtrW(window, GWLP_USERDATA, 0) };
    let _ = unsafe { DestroyWindow(window) };
    let _ = unsafe { UnregisterClassW(PCWSTR(class_name.as_ptr()), Some(instance)) };
}

unsafe extern "system" fn picker_window_proc(
    window: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if message == WM_PICKER_DISPATCH {
        let state_pointer =
            unsafe { GetWindowLongPtrW(window, GWLP_USERDATA) } as *const PickerThreadState;
        if !state_pointer.is_null() {
            unsafe { &*state_pointer }.dispatch_one();
        }
        return LRESULT(0);
    }
    unsafe { DefWindowProcW(window, message, wparam, lparam) }
}

struct ComApartment;

impl ComApartment {
    fn initialize() -> Result<Self, PickerError> {
        let result = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
        if result.is_err() {
            return Err(PickerError::StartupFailed);
        }
        Ok(Self)
    }
}

impl Drop for ComApartment {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

fn collect_results(
    dialog: &IFileOpenDialog,
    mode: PickerMode,
) -> Result<PickedSelection, PickerError> {
    let results = unsafe { dialog.GetResults() }.map_err(|_| PickerError::DialogFailed)?;
    let count = unsafe { results.GetCount() }.map_err(|_| PickerError::DialogFailed)?;
    validate_result_count(mode, count)?;
    let mut locators = Vec::with_capacity(count as usize);
    for index in 0..count {
        let item = unsafe { results.GetItemAt(index) }.map_err(|_| PickerError::DialogFailed)?;
        let display_name = unsafe { item.GetDisplayName(SIGDN_FILESYSPATH) }
            .map_err(|_| PickerError::InvalidResults)?;
        locators.push(CoTaskMemWide(display_name).into_locator()?);
    }
    Ok(PickedSelection { mode, locators })
}

fn classify_show_failure(error: &windows::core::Error) -> Result<PickerOutcome, PickerError> {
    if error.code() == CANCEL_HRESULT {
        Ok(PickerOutcome::Cancelled)
    } else {
        Err(PickerError::DialogFailed)
    }
}

fn validate_result_count(mode: PickerMode, count: u32) -> Result<(), PickerError> {
    match mode {
        PickerMode::Files if count == 0 => Err(PickerError::InvalidResults),
        PickerMode::Files if count > MAX_PICKED_ROOTS => Err(PickerError::SelectionLimitExceeded),
        PickerMode::Files => Ok(()),
        PickerMode::Folder if count == 1 => Ok(()),
        PickerMode::Folder if count > 1 => Err(PickerError::SelectionLimitExceeded),
        PickerMode::Folder => Err(PickerError::InvalidResults),
    }
}

struct CoTaskMemWide(PWSTR);

impl CoTaskMemWide {
    fn into_locator(mut self) -> Result<PickedLocator, PickerError> {
        if self.0.is_null() {
            return Err(PickerError::InvalidResults);
        }
        let mut length = None;
        for index in 0..=MAX_PRIVATE_PATH_UTF16_UNITS {
            if unsafe { *self.0 .0.add(index) } == 0 {
                length = Some(index);
                break;
            }
        }
        let Some(length) = length else {
            unsafe { std::slice::from_raw_parts_mut(self.0 .0, MAX_PRIVATE_PATH_UTF16_UNITS + 1) }
                .fill(0);
            return Err(PickerError::SelectionLimitExceeded);
        };
        if length == 0 {
            return Err(PickerError::InvalidResults);
        }
        let utf16_with_nul = unsafe { std::slice::from_raw_parts(self.0 .0, length + 1) }.to_vec();
        unsafe { std::slice::from_raw_parts_mut(self.0 .0, length + 1) }.fill(0);
        CoTaskMemFreeGuard::free(&mut self.0);
        debug_assert_eq!(utf16_with_nul.last(), Some(&0));
        Ok(PickedLocator { utf16_with_nul })
    }
}

impl Drop for CoTaskMemWide {
    fn drop(&mut self) {
        CoTaskMemFreeGuard::free(&mut self.0);
    }
}

struct CoTaskMemFreeGuard;

impl CoTaskMemFreeGuard {
    fn free(value: &mut PWSTR) {
        if !value.is_null() {
            unsafe { CoTaskMemFree(Some(value.0.cast::<c_void>())) };
            *value = PWSTR::null();
        }
    }
}

fn hwnd_to_value(window: HWND) -> usize {
    window.0 as usize
}

fn hwnd_from_value(value: usize) -> HWND {
    HWND(value as *mut c_void)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn options_are_exactly_the_spec_sets() {
        assert_eq!(
            FILE_PICKER_OPTIONS.0,
            FOS_FORCEFILESYSTEM.0
                | FOS_PATHMUSTEXIST.0
                | FOS_FILEMUSTEXIST.0
                | FOS_ALLOWMULTISELECT.0
                | FOS_NODEREFERENCELINKS.0
                | FOS_DONTADDTORECENT.0
                | FOS_NOCHANGEDIR.0
        );
        assert_eq!(
            FOLDER_PICKER_OPTIONS.0,
            FOS_FORCEFILESYSTEM.0
                | FOS_PATHMUSTEXIST.0
                | FOS_PICKFOLDERS.0
                | FOS_NODEREFERENCELINKS.0
                | FOS_DONTADDTORECENT.0
                | FOS_NOCHANGEDIR.0
        );
        assert_eq!(FILE_PICKER_OPTIONS.0 & FOS_PICKFOLDERS.0, 0);
        assert_eq!(FOLDER_PICKER_OPTIONS.0 & FOS_ALLOWMULTISELECT.0, 0);
        assert_eq!(FOLDER_PICKER_OPTIONS.0 & FOS_FILEMUSTEXIST.0, 0);
    }

    #[test]
    fn result_count_limits_fail_closed() {
        assert_eq!(
            validate_result_count(PickerMode::Files, 0),
            Err(PickerError::InvalidResults)
        );
        assert_eq!(validate_result_count(PickerMode::Files, 128), Ok(()));
        assert_eq!(
            validate_result_count(PickerMode::Files, 129),
            Err(PickerError::SelectionLimitExceeded)
        );
        assert_eq!(validate_result_count(PickerMode::Folder, 1), Ok(()));
        assert_eq!(
            validate_result_count(PickerMode::Folder, 2),
            Err(PickerError::SelectionLimitExceeded)
        );
    }

    #[test]
    fn cancellation_is_distinct_from_dialog_failure() {
        assert!(matches!(
            classify_show_failure(&windows::core::Error::from_hresult(CANCEL_HRESULT)),
            Ok(PickerOutcome::Cancelled)
        ));
        assert!(matches!(
            classify_show_failure(&windows::core::Error::from_hresult(HRESULT(
                0x8000_4005_u32 as i32
            ))),
            Err(PickerError::DialogFailed)
        ));
    }

    #[test]
    fn private_locator_debug_is_redacted() {
        let locator = PickedLocator {
            utf16_with_nul: "C:\\private\\customer-secret.e57\0"
                .encode_utf16()
                .collect(),
        };
        let debug = format!("{locator:?}");
        assert!(!debug.contains("private"));
        assert!(!debug.contains("customer"));
        assert!(debug.contains("utf16_units"));
    }
}
