#![cfg(windows)]

mod path;
mod state;

use napi_sys::{napi_callback_info, napi_env, napi_status, napi_value};
use path::validate_existing_absolute_directory;
use state::{DirectoryHandleState, RemovalDecision};
use std::collections::btree_map::Entry;
use std::collections::BTreeMap;
use std::ffi::{c_void, CString, OsString};
use std::fs::{File, OpenOptions};
use std::mem::size_of;
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::os::windows::fs::OpenOptionsExt;
use std::os::windows::io::AsRawHandle;
use std::path::{Path, PathBuf};
use std::ptr::{null, null_mut};
use std::sync::{Arc, Mutex, Once, OnceLock};
use windows_sys::Win32::Foundation::{GetLastError, HMODULE};
use windows_sys::Win32::Storage::FileSystem::{
    GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_ATTRIBUTE_DIRECTORY,
    FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
    FILE_READ_ATTRIBUTES, FILE_SHARE_READ,
};
use windows_sys::Win32::System::LibraryLoader::{
    AddDllDirectory, RemoveDllDirectory, SetDefaultDllDirectories, LOAD_LIBRARY_SEARCH_DEFAULT_DIRS,
};
use windows_sys::Win32::System::ProcessStatus::{
    EnumProcessModulesEx, GetModuleFileNameExW, LIST_MODULES_ALL,
};
use windows_sys::Win32::System::Threading::GetCurrentProcess;

static DEFAULT_DLL_POLICY: OnceLock<Result<(), u32>> = OnceLock::new();
static NAPI_SETUP: Once = Once::new();
static DLL_DIRECTORY_OPERATION: Mutex<()> = Mutex::new(());
static HANDLE_REGISTRY: OnceLock<Mutex<BTreeMap<usize, Arc<RegisteredDirectoryHandle>>>> =
    OnceLock::new();

/// The address of one live allocation is the external's addon-local identity.
///
/// A sequential integer is not sufficient: two independently loaded copies of
/// this DLL each begin their counters at one, allowing an external from one
/// copy to resolve to an unrelated cookie in the other. The allocation remains
/// live until Node invokes this addon's finalizer, so its address cannot be
/// reused by this process while the external is usable.
struct HandleExternal {
    _private: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct DirectoryIdentity {
    volume_serial_number: u32,
    file_index: u64,
}

#[derive(Debug)]
struct DirectoryBinding {
    // This handle deliberately remains open until RemoveDllDirectory succeeds.
    _file: File,
    identity: DirectoryIdentity,
    canonical_path: PathBuf,
}

#[derive(Debug)]
struct RegisteredDirectoryHandle {
    cookie: DirectoryHandleState,
    directory: Mutex<Option<DirectoryBinding>>,
}

impl RegisteredDirectoryHandle {
    fn new(cookie: DirectoryHandleState, directory: DirectoryBinding) -> Self {
        Self {
            cookie,
            directory: Mutex::new(Some(directory)),
        }
    }

    fn release_directory_binding(&self) -> Result<(), String> {
        let mut binding = self
            .directory
            .lock()
            .map_err(|_| "the DLL-directory binding lock is poisoned".to_owned())?;
        binding.take();
        Ok(())
    }

    fn revalidate_directory_binding(&self) -> Result<(), String> {
        if !self.cookie.is_active()? {
            return Err("DLL-directory handle is no longer active".to_owned());
        }
        let binding = self
            .directory
            .lock()
            .map_err(|_| "the DLL-directory binding lock is poisoned".to_owned())?;
        let retained = binding
            .as_ref()
            .ok_or_else(|| "DLL-directory binding is unavailable".to_owned())?;
        let observed = open_directory_binding(&retained.canonical_path).map_err(|error| {
            format!("registered DLL-directory pathname is no longer exact: {error}")
        })?;
        if observed.identity != retained.identity {
            return Err("registered DLL-directory pathname identity changed".to_owned());
        }
        Ok(())
    }
}

fn handle_registry() -> &'static Mutex<BTreeMap<usize, Arc<RegisteredDirectoryHandle>>> {
    HANDLE_REGISTRY.get_or_init(|| Mutex::new(BTreeMap::new()))
}

fn register_handle(token: usize, handle: Arc<RegisteredDirectoryHandle>) -> Result<(), String> {
    if token == 0 {
        return Err("DLL-directory external identity must be non-zero".to_owned());
    }
    let mut registry = handle_registry()
        .lock()
        .map_err(|_| "the DLL-directory handle registry is poisoned".to_owned())?;
    for existing in registry.values() {
        if existing.cookie.is_active()? {
            return Err(
                "this runtime-inspector image already has an active DLL directory".to_owned(),
            );
        }
    }
    match registry.entry(token) {
        Entry::Vacant(entry) => {
            entry.insert(handle);
            Ok(())
        }
        Entry::Occupied(_) => Err("DLL-directory external identity collision".to_owned()),
    }
}

fn ensure_no_active_handle() -> Result<(), String> {
    let registry = handle_registry()
        .lock()
        .map_err(|_| "the DLL-directory handle registry is poisoned".to_owned())?;
    for existing in registry.values() {
        if existing.cookie.is_active()? {
            return Err(
                "this runtime-inspector image already has an active DLL directory".to_owned(),
            );
        }
    }
    Ok(())
}

fn lookup_handle(token: usize) -> Result<Arc<RegisteredDirectoryHandle>, String> {
    handle_registry()
        .lock()
        .map_err(|_| "the DLL-directory handle registry is poisoned".to_owned())?
        .get(&token)
        .cloned()
        .ok_or_else(|| "DLL-directory handle was not created by this addon".to_owned())
}

fn take_handle(token: usize) -> Result<Option<Arc<RegisteredDirectoryHandle>>, String> {
    Ok(handle_registry()
        .lock()
        .map_err(|_| "the DLL-directory handle registry is poisoned".to_owned())?
        .remove(&token))
}

fn lock_directory_operation() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    DLL_DIRECTORY_OPERATION
        .lock()
        .map_err(|_| "the process-wide DLL-directory operation lock is poisoned".to_owned())
}

fn ensure_napi_setup() {
    // napi-sys resolves Node-API functions into a crate-owned mutable table on
    // MSVC. Registration can occur concurrently for context-aware addons, so
    // the table must be initialized exactly once for this loaded module.
    NAPI_SETUP.call_once(|| {
        // SAFETY: Required on MSVC so napi-sys resolves Node-API symbols from
        // the host process. `Once` serializes the crate's mutable table setup.
        let host_library = unsafe { napi_sys::setup() };
        // The generated function table stores pointers obtained through this
        // handle for the full lifetime of the loaded addon. Deliberately retain
        // it until process exit; dropping it here could invalidate that table.
        std::mem::forget(host_library);
    });
}

fn windows_error(operation: &str) -> String {
    // SAFETY: GetLastError takes no arguments and returns thread-local error state.
    let code = unsafe { GetLastError() };
    format!("{operation} failed with Windows error {code}")
}

fn ensure_default_dll_policy() -> Result<(), String> {
    let result = DEFAULT_DLL_POLICY.get_or_init(|| {
        // SAFETY: The constant is a documented SetDefaultDllDirectories flag.
        let success = unsafe { SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_DEFAULT_DIRS) };
        if success == 0 {
            // SAFETY: Read immediately after the failing Windows call.
            Err(unsafe { GetLastError() })
        } else {
            Ok(())
        }
    });
    result
        .as_ref()
        .copied()
        .map_err(|code| format!("SetDefaultDllDirectories failed with Windows error {code}"))
}

fn wide_nul(path: &Path) -> Result<Vec<u16>, String> {
    let mut wide: Vec<u16> = path.as_os_str().encode_wide().collect();
    if wide.contains(&0) {
        return Err("DLL directory contains an embedded NUL".to_owned());
    }
    wide.push(0);
    Ok(wide)
}

fn open_directory_binding(path: &Path) -> Result<DirectoryBinding, String> {
    let file = OpenOptions::new()
        .access_mode(FILE_READ_ATTRIBUTES)
        .share_mode(FILE_SHARE_READ)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(|error| format!("failed to retain the exact DLL directory: {error}"))?;
    // SAFETY: This Windows output structure is plain integer fields. The API
    // initializes every field before it is observed after a successful call.
    let mut information: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
    // SAFETY: `file` owns a live Windows handle and `information` is writable.
    let success = unsafe {
        GetFileInformationByHandle(file.as_raw_handle().cast::<c_void>(), &mut information)
    };
    if success == 0 {
        return Err(windows_error("GetFileInformationByHandle(DLL directory)"));
    }
    if information.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY == 0 {
        return Err("retained DLL path is not a directory".to_owned());
    }
    if information.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err("retained DLL directory is a reparse point".to_owned());
    }
    Ok(DirectoryBinding {
        _file: file,
        identity: DirectoryIdentity {
            volume_serial_number: information.dwVolumeSerialNumber,
            file_index: (u64::from(information.nFileIndexHigh) << 32)
                | u64::from(information.nFileIndexLow),
        },
        canonical_path: path.to_path_buf(),
    })
}

fn remove_raw_cookie(cookie: usize) -> Result<(), String> {
    // SAFETY: The cookie was returned by AddDllDirectory and has not been
    // removed on this path.
    let success = unsafe { RemoveDllDirectory(cookie as *const c_void) };
    if success == 0 {
        Err(windows_error("RemoveDllDirectory"))
    } else {
        Ok(())
    }
}

fn add_directory(path: &Path) -> Result<RegisteredDirectoryHandle, String> {
    ensure_default_dll_policy()?;
    let directory = open_directory_binding(path)?;
    let wide = wide_nul(path)?;
    // SAFETY: `wide` is NUL-terminated and remains alive for the duration of the call.
    let cookie = unsafe { AddDllDirectory(wide.as_ptr()) };
    if cookie.is_null() {
        return Err(windows_error("AddDllDirectory"));
    }
    let cookie = cookie as usize;
    let after = match open_directory_binding(path) {
        Ok(binding) => binding,
        Err(error) => {
            if remove_raw_cookie(cookie).is_err() {
                std::process::abort();
            }
            return Err(format!(
                "failed to revalidate the retained DLL directory after AddDllDirectory: {error}"
            ));
        }
    };
    if after.identity != directory.identity {
        if remove_raw_cookie(cookie).is_err() {
            std::process::abort();
        }
        return Err("DLL directory identity changed during registration".to_owned());
    }
    drop(after);
    let cookie = match DirectoryHandleState::new(cookie) {
        Ok(cookie) => cookie,
        Err(error) => {
            if remove_raw_cookie(cookie).is_err() {
                std::process::abort();
            }
            return Err(error.to_owned());
        }
    };
    Ok(RegisteredDirectoryHandle::new(cookie, directory))
}

fn remove_directory(handle: &RegisteredDirectoryHandle) -> Result<bool, String> {
    match handle.cookie.remove_with(remove_raw_cookie)? {
        RemovalDecision::Invoke(_) => {
            handle.release_directory_binding()?;
            Ok(true)
        }
        RemovalDecision::AlreadyRemoved => Ok(false),
    }
}

fn enumerate_modules() -> Result<Vec<PathBuf>, String> {
    // SAFETY: GetCurrentProcess returns a valid pseudo-handle for this process.
    let process = unsafe { GetCurrentProcess() };
    let mut modules = vec![0 as HMODULE; 128];

    loop {
        let byte_capacity = modules
            .len()
            .checked_mul(size_of::<HMODULE>())
            .and_then(|bytes| u32::try_from(bytes).ok())
            .ok_or_else(|| "loaded-module buffer exceeds the Windows API limit".to_owned())?;
        let mut needed = 0_u32;
        // SAFETY: The module buffer is writable for `byte_capacity` bytes and `needed` is valid.
        let success = unsafe {
            EnumProcessModulesEx(
                process,
                modules.as_mut_ptr(),
                byte_capacity,
                &mut needed,
                LIST_MODULES_ALL,
            )
        };
        if success == 0 {
            return Err(windows_error("EnumProcessModulesEx"));
        }
        if needed <= byte_capacity {
            let count = usize::try_from(needed)
                .map_err(|_| "loaded-module byte count cannot fit usize".to_owned())?
                / size_of::<HMODULE>();
            modules.truncate(count);
            break;
        }
        let required = usize::try_from(needed)
            .map_err(|_| "loaded-module byte count cannot fit usize".to_owned())?
            / size_of::<HMODULE>();
        modules.resize(required.saturating_add(16), 0 as HMODULE);
    }

    let mut canonical_paths = Vec::with_capacity(modules.len());
    for module in modules {
        let path = module_path(process, module)?;
        let canonical = std::fs::canonicalize(&path).map_err(|error| {
            format!(
                "failed to canonicalize loaded module {}: {error}",
                path.display()
            )
        })?;
        canonical_paths.push(canonical);
    }
    canonical_paths.sort_by(|left, right| {
        left.as_os_str()
            .encode_wide()
            .cmp(right.as_os_str().encode_wide())
    });
    Ok(canonical_paths)
}

fn module_path(
    process: windows_sys::Win32::Foundation::HANDLE,
    module: HMODULE,
) -> Result<PathBuf, String> {
    let mut buffer = vec![0_u16; 512];
    loop {
        let capacity = u32::try_from(buffer.len())
            .map_err(|_| "module path buffer exceeds the Windows API limit".to_owned())?;
        // SAFETY: `buffer` is writable for `capacity` UTF-16 code units.
        let length =
            unsafe { GetModuleFileNameExW(process, module, buffer.as_mut_ptr(), capacity) };
        if length == 0 {
            return Err(windows_error("GetModuleFileNameExW"));
        }
        let length = usize::try_from(length)
            .map_err(|_| "module path length cannot fit usize".to_owned())?;
        if length < buffer.len() {
            buffer.truncate(length);
            return Ok(PathBuf::from(OsString::from_wide(&buffer)));
        }
        let next = buffer
            .len()
            .checked_mul(2)
            .filter(|length| *length <= 32_768)
            .ok_or_else(|| "loaded module path exceeds 32768 UTF-16 code units".to_owned())?;
        buffer.resize(next, 0);
    }
}

unsafe fn throw(env: napi_env, message: &str) -> napi_value {
    let sanitized = message.replace('\0', " ");
    let c_message = CString::new(sanitized).expect("embedded NUL was replaced");
    // SAFETY: `env` comes from Node and the C string is valid for the call.
    unsafe { napi_sys::napi_throw_error(env, null(), c_message.as_ptr()) };
    null_mut()
}

unsafe fn check(status: napi_status, operation: &str) -> Result<(), String> {
    if status == napi_sys::Status::napi_ok {
        Ok(())
    } else {
        Err(format!("{operation} failed with Node-API status {status}"))
    }
}

unsafe fn exact_arguments(
    env: napi_env,
    info: napi_callback_info,
    expected: usize,
) -> Result<Vec<napi_value>, String> {
    let mut actual = 0_usize;
    // SAFETY: Null argv asks Node-API for the actual argument count.
    unsafe {
        check(
            napi_sys::napi_get_cb_info(env, info, &mut actual, null_mut(), null_mut(), null_mut()),
            "napi_get_cb_info(argument count)",
        )?;
    }
    if actual != expected {
        return Err(format!(
            "expected exactly {expected} argument(s), received {actual}"
        ));
    }
    let mut arguments = vec![null_mut(); expected];
    let mut capacity = expected;
    // SAFETY: The vector has capacity for exactly `expected` Node values.
    unsafe {
        check(
            napi_sys::napi_get_cb_info(
                env,
                info,
                &mut capacity,
                arguments.as_mut_ptr(),
                null_mut(),
                null_mut(),
            ),
            "napi_get_cb_info(arguments)",
        )?;
    }
    Ok(arguments)
}

unsafe fn get_utf16_path(env: napi_env, value: napi_value) -> Result<PathBuf, String> {
    let mut value_type = napi_sys::ValueType::napi_undefined;
    // SAFETY: `value` is supplied by Node for this callback.
    unsafe {
        check(
            napi_sys::napi_typeof(env, value, &mut value_type),
            "napi_typeof",
        )?;
    };
    if value_type != napi_sys::ValueType::napi_string {
        return Err("DLL directory must be a string".to_owned());
    }
    let mut length = 0_usize;
    // SAFETY: Null buffer requests the UTF-16 code-unit length.
    unsafe {
        check(
            napi_sys::napi_get_value_string_utf16(env, value, null_mut(), 0, &mut length),
            "napi_get_value_string_utf16(length)",
        )?;
    }
    let capacity = length
        .checked_add(1)
        .ok_or_else(|| "DLL directory string is too large".to_owned())?;
    let mut code_units = vec![0_u16; capacity];
    let mut written = 0_usize;
    // SAFETY: `code_units` is writable for `capacity` UTF-16 code units.
    unsafe {
        check(
            napi_sys::napi_get_value_string_utf16(
                env,
                value,
                code_units.as_mut_ptr(),
                capacity,
                &mut written,
            ),
            "napi_get_value_string_utf16(value)",
        )?;
    }
    code_units.truncate(written);
    if code_units.contains(&0) {
        return Err("DLL directory contains an embedded NUL".to_owned());
    }
    let mut index = 0;
    while index < code_units.len() {
        let code_unit = code_units[index];
        if (0xD800..=0xDBFF).contains(&code_unit) {
            let Some(next) = code_units.get(index + 1) else {
                return Err("DLL directory contains an unpaired UTF-16 surrogate".to_owned());
            };
            if !(0xDC00..=0xDFFF).contains(next) {
                return Err("DLL directory contains an unpaired UTF-16 surrogate".to_owned());
            }
            index += 2;
            continue;
        }
        if (0xDC00..=0xDFFF).contains(&code_unit) {
            return Err("DLL directory contains an unpaired UTF-16 surrogate".to_owned());
        }
        index += 1;
    }
    Ok(PathBuf::from(OsString::from_wide(&code_units)))
}

unsafe extern "C" fn finalize_handle(_env: napi_env, data: *mut c_void, _hint: *mut c_void) {
    let token = data as usize;
    if token == 0 {
        return;
    }
    let Ok(_operation) = lock_directory_operation() else {
        std::process::abort();
    };
    let Ok(handle) = take_handle(token) else {
        std::process::abort();
    };
    if let Some(handle) = handle {
        if remove_directory(&handle).is_err() {
            // Continuing after losing an active process-wide DLL search cookie
            // would invalidate every later module-load observation.
            std::process::abort();
        }
    }
    // SAFETY: `data` was allocated by this addon immediately before
    // `napi_create_external`, and Node invokes this registered finalizer once.
    unsafe { drop(Box::from_raw(data.cast::<HandleExternal>())) };
}

unsafe extern "C" fn add_dll_directory_js(env: napi_env, info: napi_callback_info) -> napi_value {
    let result = (|| -> Result<napi_value, String> {
        // SAFETY: `env` and `info` are provided by Node for this callback.
        let arguments = unsafe { exact_arguments(env, info, 1)? };
        // SAFETY: The sole argument is a valid Node value. Reading UTF-16
        // exactly prevents an unpaired surrogate from aliasing to U+FFFD.
        let input = unsafe { get_utf16_path(env, arguments[0])? };
        let canonical = validate_existing_absolute_directory(&input)?;
        let _operation = lock_directory_operation()?;
        ensure_no_active_handle()?;
        let external_data = Box::into_raw(Box::new(HandleExternal { _private: 0 }));
        let token = external_data as usize;
        let handle = match add_directory(&canonical) {
            Ok(handle) => Arc::new(handle),
            Err(error) => {
                // SAFETY: No external or registry entry owns this allocation.
                unsafe { drop(Box::from_raw(external_data)) };
                return Err(error);
            }
        };
        if let Err(error) = register_handle(token, Arc::clone(&handle)) {
            let cleanup = remove_directory(&handle);
            // SAFETY: Registration failed and no external owns this allocation.
            unsafe { drop(Box::from_raw(external_data)) };
            if cleanup.is_err() {
                std::process::abort();
            }
            return Err(error);
        }
        let mut external = null_mut();
        // SAFETY: The allocation address is opaque and is resolved through this
        // loaded addon's private registry before its state can be accessed.
        let status = unsafe {
            napi_sys::napi_create_external(
                env,
                external_data.cast::<c_void>(),
                Some(finalize_handle),
                null_mut(),
                &mut external,
            )
        };
        if let Err(error) = unsafe { check(status, "napi_create_external") } {
            if let Some(handle) = take_handle(token)? {
                if remove_directory(&handle).is_err() {
                    std::process::abort();
                }
            }
            // SAFETY: Node rejected the external, so its finalizer cannot own
            // the allocation.
            unsafe { drop(Box::from_raw(external_data)) };
            return Err(error);
        }
        Ok(external)
    })();
    match result {
        Ok(value) => value,
        // SAFETY: `env` is valid for this callback.
        Err(error) => unsafe { throw(env, &error) },
    }
}

unsafe extern "C" fn remove_dll_directory_js(
    env: napi_env,
    info: napi_callback_info,
) -> napi_value {
    let result = (|| -> Result<napi_value, String> {
        // SAFETY: `env` and `info` are provided by Node for this callback.
        let arguments = unsafe { exact_arguments(env, info, 1)? };
        let mut raw = null_mut();
        // SAFETY: Node validates that the value is an external.
        unsafe {
            check(
                napi_sys::napi_get_value_external(env, arguments[0], &mut raw),
                "napi_get_value_external",
            )?;
        }
        let token = raw as usize;
        if token == 0 {
            return Err("DLL-directory handle is invalid".to_owned());
        }
        let _operation = lock_directory_operation()?;
        let handle = lookup_handle(token)?;
        let removed = remove_directory(&handle)?;
        let mut value = null_mut();
        // SAFETY: `env` and the output pointer are valid.
        unsafe {
            check(
                napi_sys::napi_get_boolean(env, removed, &mut value),
                "napi_get_boolean",
            )?;
        }
        Ok(value)
    })();
    match result {
        Ok(value) => value,
        // SAFETY: `env` is valid for this callback.
        Err(error) => unsafe { throw(env, &error) },
    }
}

unsafe extern "C" fn revalidate_dll_directory_js(
    env: napi_env,
    info: napi_callback_info,
) -> napi_value {
    let result = (|| -> Result<napi_value, String> {
        // SAFETY: `env` and `info` are provided by Node for this callback.
        let arguments = unsafe { exact_arguments(env, info, 1)? };
        let mut raw = null_mut();
        // SAFETY: Node validates that the value is an external.
        unsafe {
            check(
                napi_sys::napi_get_value_external(env, arguments[0], &mut raw),
                "napi_get_value_external",
            )?;
        }
        let token = raw as usize;
        if token == 0 {
            return Err("DLL-directory handle is invalid".to_owned());
        }
        let _operation = lock_directory_operation()?;
        let handle = lookup_handle(token)?;
        handle.revalidate_directory_binding()?;
        let mut value = null_mut();
        // SAFETY: `env` and the output pointer are valid.
        unsafe {
            check(
                napi_sys::napi_get_boolean(env, true, &mut value),
                "napi_get_boolean",
            )?;
        }
        Ok(value)
    })();
    match result {
        Ok(value) => value,
        // SAFETY: `env` is valid for this callback.
        Err(error) => unsafe { throw(env, &error) },
    }
}

unsafe extern "C" fn enumerate_loaded_modules_js(
    env: napi_env,
    info: napi_callback_info,
) -> napi_value {
    let result = (|| -> Result<napi_value, String> {
        // SAFETY: `env` and `info` are provided by Node for this callback.
        unsafe { exact_arguments(env, info, 0)? };
        let paths = enumerate_modules()?;
        let length = u32::try_from(paths.len())
            .map_err(|_| "too many loaded modules for a JavaScript array".to_owned())?;
        let mut array = null_mut();
        // SAFETY: `env` and output pointer are valid.
        unsafe {
            check(
                napi_sys::napi_create_array_with_length(env, paths.len(), &mut array),
                "napi_create_array_with_length",
            )?;
        }
        for (index, path) in paths.iter().enumerate() {
            let text: Vec<u16> = path.as_os_str().encode_wide().collect();
            let mut string = null_mut();
            // SAFETY: UTF-16 code units remain valid for the duration of the
            // call and preserve every Windows path code unit exactly.
            unsafe {
                check(
                    napi_sys::napi_create_string_utf16(env, text.as_ptr(), text.len(), &mut string),
                    "napi_create_string_utf16",
                )?;
                check(
                    napi_sys::napi_set_element(
                        env,
                        array,
                        u32::try_from(index)
                            .map_err(|_| "module array index exceeds u32".to_owned())?,
                        string,
                    ),
                    "napi_set_element",
                )?;
            }
        }
        debug_assert_eq!(length as usize, paths.len());
        Ok(array)
    })();
    match result {
        Ok(value) => value,
        // SAFETY: `env` is valid for this callback.
        Err(error) => unsafe { throw(env, &error) },
    }
}

unsafe fn export_function(
    env: napi_env,
    exports: napi_value,
    name: &str,
    callback: napi_sys::napi_callback,
) -> Result<(), String> {
    let c_name = CString::new(name).map_err(|_| "export name contains NUL".to_owned())?;
    let mut function = null_mut();
    // SAFETY: All pointers are valid for the duration of the Node-API calls.
    unsafe {
        check(
            napi_sys::napi_create_function(
                env,
                c_name.as_ptr(),
                name.len(),
                callback,
                null_mut(),
                &mut function,
            ),
            "napi_create_function",
        )?;
        check(
            napi_sys::napi_set_named_property(env, exports, c_name.as_ptr(), function),
            "napi_set_named_property",
        )?;
    }
    Ok(())
}

#[no_mangle]
/// Registers the runtime-inspector exports in the Node-API module.
///
/// # Safety
///
/// Node.js must call this function with a valid Node-API environment and the
/// exports object allocated for this native module. It must not be invoked by
/// ordinary Rust callers.
pub unsafe extern "C" fn napi_register_module_v1(env: napi_env, exports: napi_value) -> napi_value {
    ensure_napi_setup();
    let registration = (|| -> Result<(), String> {
        // SAFETY: `env` and `exports` are supplied by Node during module registration.
        unsafe {
            export_function(env, exports, "addDllDirectory", Some(add_dll_directory_js))?;
            export_function(
                env,
                exports,
                "removeDllDirectory",
                Some(remove_dll_directory_js),
            )?;
            export_function(
                env,
                exports,
                "revalidateDllDirectory",
                Some(revalidate_dll_directory_js),
            )?;
            export_function(
                env,
                exports,
                "enumerateLoadedModules",
                Some(enumerate_loaded_modules_js),
            )?;
        }
        Ok(())
    })();
    if let Err(error) = registration {
        // SAFETY: `env` is valid during registration.
        return unsafe { throw(env, &error) };
    }
    exports
}
