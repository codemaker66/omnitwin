#![cfg(all(windows, target_arch = "x86_64"))]

use std::cell::Cell;
use std::fs;
use std::fs::OpenOptions;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::rc::Rc;
use std::time::{SystemTime, UNIX_EPOCH};

use venviewer_windows_source_helper::custody::{
    CustodyError, DosDeviceMapping, InventoryLimits, LocalDriveKind, RetainedSource, SourceKind,
};
use venviewer_windows_source_helper::output::{OutputError, RetainedOutputRoot};
use venviewer_windows_source_helper::path::CanonicalDosPath;
use venviewer_windows_source_helper::scope::{
    CombinedCustodyError, CombinedCustodyLimits, CombinedCustodyScope,
};
use windows::core::PCWSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::Storage::FileSystem::{
    CreateFileW, DefineDosDeviceW, QueryDosDeviceW, DDD_EXACT_MATCH_ON_REMOVE,
    DDD_NO_BROADCAST_SYSTEM, DDD_RAW_TARGET_PATH, DDD_REMOVE_DEFINITION, DEFINE_DOS_DEVICE_FLAGS,
    FILE_ADD_FILE, FILE_FLAG_BACKUP_SEMANTICS, FILE_SHARE_DELETE, FILE_SHARE_READ,
    FILE_SHARE_WRITE, OPEN_EXISTING,
};

struct Fixture {
    root: PathBuf,
}

struct DosDeviceGuard {
    device: Vec<u16>,
    target: Vec<u16>,
}

struct DirectoryWriterHandle(HANDLE);

impl DirectoryWriterHandle {
    fn open(path: &Path) -> Self {
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain([0]).collect();
        // SAFETY: the path is NUL terminated, all optional pointers are absent,
        // and the returned handle is immediately owned by this guard.
        let handle = unsafe {
            CreateFileW(
                PCWSTR(wide.as_ptr()),
                FILE_ADD_FILE.0,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                None,
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS,
                None,
            )
        }
        .expect("directory writer handle should open");
        Self(handle)
    }
}

impl Drop for DirectoryWriterHandle {
    fn drop(&mut self) {
        // SAFETY: this guard owns one valid handle and Drop runs once.
        let _ = unsafe { CloseHandle(self.0) };
    }
}

impl DosDeviceGuard {
    fn create_subst(target: &str) -> Option<(Self, char)> {
        let target: Vec<u16> = target.encode_utf16().chain([0]).collect();
        for letter in (b'G'..=b'Z').rev() {
            let device_text = format!("{}:", char::from(letter));
            let device: Vec<u16> = device_text.encode_utf16().chain([0]).collect();
            let mut existing = [0u16; 512];
            // SAFETY: the device name is NUL terminated and the output buffer
            // is initialized writable storage.
            if unsafe { QueryDosDeviceW(PCWSTR(device.as_ptr()), Some(&mut existing)) } != 0 {
                continue;
            }
            let flags = DEFINE_DOS_DEVICE_FLAGS(DDD_RAW_TARGET_PATH.0 | DDD_NO_BROADCAST_SYSTEM.0);
            // SAFETY: both input strings are NUL terminated and remain alive
            // through the call.
            if unsafe { DefineDosDeviceW(flags, PCWSTR(device.as_ptr()), PCWSTR(target.as_ptr())) }
                .is_ok()
            {
                return Some((Self { device, target }, char::from(letter)));
            }
        }
        None
    }
}

impl Drop for DosDeviceGuard {
    fn drop(&mut self) {
        let flags = DEFINE_DOS_DEVICE_FLAGS(
            DDD_REMOVE_DEFINITION.0
                | DDD_EXACT_MATCH_ON_REMOVE.0
                | DDD_RAW_TARGET_PATH.0
                | DDD_NO_BROADCAST_SYSTEM.0,
        );
        // SAFETY: both stored strings remain NUL terminated through Drop.
        let _ = unsafe {
            DefineDosDeviceW(
                flags,
                PCWSTR(self.device.as_ptr()),
                PCWSTR(self.target.as_ptr()),
            )
        };
    }
}

impl Fixture {
    fn new(label: &str) -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after the Unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "venviewer-native-{label}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir(&root).expect("fixture directory should be created");
        Self { root }
    }

    fn canonical(&self, path: &Path) -> CanonicalDosPath {
        let absolute = fs::canonicalize(path).expect("fixture path should canonicalize");
        Self::locator(&absolute)
    }

    fn locator(path: &Path) -> CanonicalDosPath {
        let mut value = path
            .to_str()
            .expect("fixture path should be Unicode")
            .strip_prefix(r"\\?\")
            .unwrap_or_else(|| path.to_str().expect("fixture path should be Unicode"))
            .to_owned();
        value.replace_range(..1, &value[..1].to_ascii_uppercase());
        CanonicalDosPath::parse(&value).expect("fixture path should be canonical DOS form")
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn create_directory_reparse(target: &Path, link: &Path) {
    if std::os::windows::fs::symlink_dir(target, link).is_ok() {
        return;
    }
    // Developer Mode or SeCreateSymbolicLinkPrivilege is not guaranteed on a
    // release-test host. A directory junction is still a real reparse point and
    // can be created without that privilege. This fallback exists only in the
    // integration-test binary; it is not compiled into the helper executable.
    let output = Command::new("cmd.exe")
        .args(["/d", "/c", "mklink", "/J"])
        .arg(link)
        .arg(target)
        .output()
        .expect("the junction fixture command should start");
    assert!(
        output.status.success() && link.exists(),
        "a real directory reparse fixture must be created for this test to pass"
    );
}

#[test]
fn retained_file_identity_revalidates_and_detects_size_change() {
    let fixture = Fixture::new("file");
    let source_path = fixture.root.join("source.bin");
    fs::write(&source_path, b"first").expect("source fixture should be written");
    let locator = fixture.canonical(&source_path);

    let retained = RetainedSource::open(&locator, InventoryLimits::default(), || false)
        .expect("direct local source should be retained");
    assert_eq!(retained.kind(), SourceKind::File);
    assert_eq!(retained.inventory().file_count(), 1);
    assert_eq!(retained.inventory().total_bytes(), 5);
    assert_eq!(
        retained
            .inventory()
            .root_identity()
            .volume_serial_hex()
            .len(),
        16
    );
    assert_eq!(retained.inventory().root_identity().file_id_hex().len(), 32);
    retained
        .revalidate(InventoryLimits::default(), || false)
        .expect("unchanged retained file should revalidate");

    fs::write(&source_path, b"changed-size").expect("source fixture should mutate");
    assert_eq!(
        retained.revalidate(InventoryLimits::default(), || false),
        Err(CustodyError::SourceChanged)
    );
}

#[test]
fn subst_locator_is_rejected_even_when_the_resolved_handle_is_local() {
    let fixture = Fixture::new("subst");
    fs::write(fixture.root.join("source.bin"), b"source")
        .expect("source fixture should be written");
    let root = fixture.canonical(&fixture.root);
    let target = format!(r"\??\{}", root.as_str());
    let (_mapping, letter) = DosDeviceGuard::create_subst(&target)
        .expect("the SUBST adversarial fixture must be created for this test to pass");
    let locator = CanonicalDosPath::parse(&format!(r"{letter}:\source.bin"))
        .expect("SUBST locator should have canonical DOS syntax");
    let error = match RetainedSource::open(&locator, InventoryLimits::default(), || false) {
        Err(error) => error,
        Ok(_) => panic!("a SUBST locator must fail closed"),
    };
    assert!(matches!(
        error,
        CustodyError::ReparsePointRejected | CustodyError::NotDirectLocalVolume
    ));
}

#[test]
fn restrictive_read_custody_blocks_writers_and_reads_the_retained_identity() {
    let fixture = Fixture::new("read-custody");
    let source_path = fixture.root.join("source.bin");
    let expected = b"retained bytes";
    fs::write(&source_path, expected).expect("source fixture should be written");
    let locator = fixture.canonical(&source_path);
    let retained = Rc::new(
        RetainedSource::open(&locator, InventoryLimits::default(), || false)
            .expect("source should be retained for inspection"),
    );

    let preexisting_writer = OpenOptions::new()
        .write(true)
        .open(&source_path)
        .expect("permissive inspection phase should coexist with a writer");
    assert!(matches!(
        retained.begin_read_custody(InventoryLimits::default(), || false),
        Err(CustodyError::OpenRejected)
    ));
    drop(preexisting_writer);

    let mut custody = retained
        .begin_read_custody(InventoryLimits::default(), || false)
        .expect("restrictive read custody should be acquired");
    assert!(OpenOptions::new().write(true).open(&source_path).is_err());
    assert!(fs::rename(&source_path, fixture.root.join("renamed.bin")).is_err());

    let identity = custody
        .file_identities()
        .next()
        .expect("the selected file identity should be present");
    let mut actual = Vec::new();
    let mut buffer = [0u8; 4];
    loop {
        let count = custody
            .read_chunk(identity, &mut buffer, || false)
            .expect("retained chunk read should succeed");
        if count == 0 {
            break;
        }
        actual.extend_from_slice(&buffer[..count]);
    }
    assert_eq!(actual, expected);
    let evidence = custody
        .finish(InventoryLimits::default(), || false)
        .expect("fully read unchanged custody should finish");
    assert_eq!(evidence.file_count(), 1);
    assert_eq!(evidence.total_bytes(), expected.len() as u64);
    let file_evidence = evidence
        .files()
        .next()
        .expect("the complete file digest should be present");
    assert_eq!(file_evidence.identity(), identity);
    assert_eq!(file_evidence.byte_count(), expected.len() as u64);
    assert_eq!(
        file_evidence.sha256(),
        "sha256:fb256b25e0c6295ffe7f2d26c984d128075acbf4ac614fbed75887eebe83fc0b"
    );
    assert!(evidence.aggregate_sha256().starts_with("sha256:"));
    assert_eq!(evidence.aggregate_sha256().len(), 71);

    OpenOptions::new()
        .write(true)
        .open(&source_path)
        .expect("writer should be allowed after restrictive custody is released");
}

#[test]
fn folder_inventory_is_complete_bounded_and_revalidated() {
    let fixture = Fixture::new("folder");
    let source_path = fixture.root.join("source");
    let nested = source_path.join("nested");
    fs::create_dir_all(&nested).expect("nested fixture should be created");
    fs::write(source_path.join("one.bin"), b"1").expect("first fixture should be written");
    fs::write(nested.join("two.bin"), b"22").expect("second fixture should be written");
    let locator = fixture.canonical(&source_path);

    let retained = RetainedSource::open(&locator, InventoryLimits::default(), || false)
        .expect("folder should be enumerated");
    assert_eq!(retained.kind(), SourceKind::Folder);
    assert_eq!(retained.inventory().file_count(), 2);
    assert_eq!(retained.inventory().total_bytes(), 3);
    retained
        .revalidate(InventoryLimits::default(), || false)
        .expect("unchanged folder should revalidate");

    let late_empty = source_path.join("late-empty");
    fs::create_dir(&late_empty).expect("empty directory mutation should be created");
    assert_eq!(
        retained.revalidate(InventoryLimits::default(), || false),
        Err(CustodyError::SourceChanged)
    );
    fs::remove_dir(&late_empty).expect("empty directory mutation should be removed");
    retained
        .revalidate(InventoryLimits::default(), || false)
        .expect("restored folder should revalidate");

    fs::write(source_path.join("three.bin"), b"333").expect("additional fixture should be written");
    assert_eq!(
        retained.revalidate(InventoryLimits::default(), || false),
        Err(CustodyError::SourceChanged)
    );

    let strict_limits = InventoryLimits {
        max_files: 1,
        max_entries: 8,
        max_total_bytes: 1024,
        ..InventoryLimits::default()
    };
    assert_eq!(
        match RetainedSource::open(&locator, strict_limits, || false) {
            Err(error) => error,
            Ok(_) => panic!("the file limit must fail closed"),
        },
        CustodyError::FileLimitExceeded
    );
}

#[test]
fn folder_layout_memory_budget_is_enforced_at_the_exact_modeled_boundary() {
    let fixture = Fixture::new("folder-layout-memory-budget");
    let source_path = fixture.root.join("source");
    fs::create_dir(&source_path).expect("source folder should be created");
    fs::write(source_path.join("one.bin"), b"one").expect("source file should be written");
    let locator = fixture.canonical(&source_path);

    // Folder root: 128 bytes. `one.bin`: 128-byte record + 64-byte
    // component + align16(7 UTF-16 units * 2) = 208 bytes. Total: 336.
    let exact = InventoryLimits {
        max_layout_memory_bytes: 336,
        ..InventoryLimits::default()
    };
    RetainedSource::open(&locator, exact, || false)
        .expect("layout ending exactly at the modeled limit should open");

    let one_byte_short = InventoryLimits {
        max_layout_memory_bytes: 335,
        ..InventoryLimits::default()
    };
    assert_eq!(
        match RetainedSource::open(&locator, one_byte_short, || false) {
            Err(error) => error,
            Ok(_) => panic!("layout exceeding the modeled limit must fail closed"),
        },
        CustodyError::LayoutMemoryLimitExceeded
    );
}

#[test]
fn retained_single_file_detects_an_identity_preserving_case_only_rename() {
    let fixture = Fixture::new("file-layout-case-rename");
    let original_path = fixture.root.join("source.ply");
    let intermediate_path = fixture.root.join("case-hop.tmp");
    let renamed_path = fixture.root.join("SOURCE.PLY");
    fs::write(&original_path, b"same bytes").expect("source fixture should be written");
    let retained = RetainedSource::open(
        &fixture.canonical(&original_path),
        InventoryLimits::default(),
        || false,
    )
    .expect("single file should be retained");
    let original_identity = retained.inventory().root_identity();

    fs::rename(&original_path, &intermediate_path).expect("first rename should succeed");
    fs::rename(&intermediate_path, &renamed_path).expect("case-only rename should succeed");
    let renamed = RetainedSource::open(
        &fixture.canonical(&renamed_path),
        InventoryLimits::default(),
        || false,
    )
    .expect("renamed file should still be a valid source");
    assert_eq!(renamed.inventory().root_identity(), original_identity);
    assert_eq!(
        renamed.inventory().total_bytes(),
        retained.inventory().total_bytes()
    );
    assert_eq!(
        retained.revalidate(InventoryLimits::default(), || false),
        Err(CustodyError::SourceChanged),
        "the retained leaf spelling is part of the private layout"
    );
}

#[test]
fn folder_layout_detects_an_identity_preserving_child_case_rename() {
    let fixture = Fixture::new("folder-layout-case-rename");
    let source_path = fixture.root.join("source");
    fs::create_dir(&source_path).expect("source folder should be created");
    let original_path = source_path.join("scan.ply");
    let intermediate_path = source_path.join("case-hop.tmp");
    let renamed_path = source_path.join("SCAN.PLY");
    fs::write(&original_path, b"same bytes").expect("source fixture should be written");
    let retained = RetainedSource::open(
        &fixture.canonical(&source_path),
        InventoryLimits::default(),
        || false,
    )
    .expect("folder should be retained");
    let original_identities: Vec<_> = retained.inventory().identities().collect();

    fs::rename(&original_path, &intermediate_path).expect("first rename should succeed");
    fs::rename(&intermediate_path, &renamed_path).expect("case-only rename should succeed");
    let renamed = RetainedSource::open(
        &fixture.canonical(&source_path),
        InventoryLimits::default(),
        || false,
    )
    .expect("renamed folder contents should still enumerate");
    assert_eq!(
        renamed.inventory().identities().collect::<Vec<_>>(),
        original_identities,
        "the filesystem identities should be unchanged by the rename"
    );
    assert_eq!(
        renamed.inventory().total_bytes(),
        retained.inventory().total_bytes()
    );
    assert_eq!(
        retained.revalidate(InventoryLimits::default(), || false),
        Err(CustodyError::SourceChanged)
    );
}

#[test]
fn folder_layout_detects_an_identity_preserving_move() {
    let fixture = Fixture::new("folder-layout-move");
    let source_path = fixture.root.join("source");
    let first_parent = source_path.join("first");
    let second_parent = source_path.join("second");
    fs::create_dir_all(&first_parent).expect("first parent should be created");
    fs::create_dir(&second_parent).expect("second parent should be created");
    let original_path = first_parent.join("scan.ply");
    let moved_path = second_parent.join("scan.ply");
    fs::write(&original_path, b"same bytes").expect("source fixture should be written");
    let retained = RetainedSource::open(
        &fixture.canonical(&source_path),
        InventoryLimits::default(),
        || false,
    )
    .expect("folder should be retained");
    let original_identities: Vec<_> = retained.inventory().identities().collect();

    fs::rename(&original_path, &moved_path).expect("same-volume move should succeed");
    let moved = RetainedSource::open(
        &fixture.canonical(&source_path),
        InventoryLimits::default(),
        || false,
    )
    .expect("moved folder contents should still enumerate");
    assert_eq!(
        moved.inventory().identities().collect::<Vec<_>>(),
        original_identities
    );
    assert_eq!(
        moved.inventory().total_bytes(),
        retained.inventory().total_bytes()
    );
    assert_eq!(
        retained.revalidate(InventoryLimits::default(), || false),
        Err(CustodyError::SourceChanged)
    );
}

#[test]
fn folder_layout_detects_an_identity_preserving_empty_directory_rename() {
    let fixture = Fixture::new("folder-layout-empty-rename");
    let source_path = fixture.root.join("source");
    fs::create_dir_all(source_path.join("empty-original"))
        .expect("empty directory should be created");
    let retained = RetainedSource::open(
        &fixture.canonical(&source_path),
        InventoryLimits::default(),
        || false,
    )
    .expect("folder should be retained");
    let original_identities: Vec<_> = retained.inventory().identities().collect();

    fs::rename(
        source_path.join("empty-original"),
        source_path.join("empty-renamed"),
    )
    .expect("empty directory rename should succeed");
    let renamed = RetainedSource::open(
        &fixture.canonical(&source_path),
        InventoryLimits::default(),
        || false,
    )
    .expect("renamed empty directory should still enumerate");
    assert_eq!(
        renamed.inventory().identities().collect::<Vec<_>>(),
        original_identities
    );
    assert_eq!(renamed.inventory().file_count(), 0);
    assert_eq!(
        retained.revalidate(InventoryLimits::default(), || false),
        Err(CustodyError::SourceChanged)
    );
}

#[test]
fn folder_layout_preserves_unicode_code_units_without_normalising_names() {
    let fixture = Fixture::new("folder-layout-unicode-rename");
    let source_path = fixture.root.join("source");
    fs::create_dir(&source_path).expect("source folder should be created");
    let composed_path = source_path.join("café.ply");
    let decomposed_path = source_path.join("cafe\u{301}.ply");
    fs::write(&composed_path, b"same bytes").expect("Unicode source should be written");
    let retained = RetainedSource::open(
        &fixture.canonical(&source_path),
        InventoryLimits::default(),
        || false,
    )
    .expect("folder should be retained");
    let original_identities: Vec<_> = retained.inventory().identities().collect();

    fs::rename(&composed_path, &decomposed_path).expect("Unicode rename should succeed");
    let renamed = RetainedSource::open(
        &fixture.canonical(&source_path),
        InventoryLimits::default(),
        || false,
    )
    .expect("renamed Unicode source should still enumerate");
    assert_eq!(
        renamed.inventory().identities().collect::<Vec<_>>(),
        original_identities
    );
    assert_eq!(
        renamed.inventory().total_bytes(),
        retained.inventory().total_bytes()
    );
    assert_eq!(
        retained.revalidate(InventoryLimits::default(), || false),
        Err(CustodyError::SourceChanged)
    );
}

#[test]
fn folder_read_custody_holds_every_file_and_final_revalidation_catches_additions() {
    let fixture = Fixture::new("folder-read-custody");
    let source_path = fixture.root.join("source");
    let nested = source_path.join("nested");
    fs::create_dir_all(&nested).expect("nested fixture should be created");
    fs::write(source_path.join("one.bin"), b"one").expect("first fixture should be written");
    fs::write(nested.join("two.bin"), b"two-two").expect("second fixture should be written");
    let locator = fixture.canonical(&source_path);
    let retained = Rc::new(
        RetainedSource::open(&locator, InventoryLimits::default(), || false)
            .expect("folder should be retained"),
    );
    let other_path = fixture.root.join("other-source");
    fs::create_dir(&other_path).expect("other source fixture should be created");
    fs::write(other_path.join("unchanged.bin"), b"other")
        .expect("other source fixture should be written");
    let other_locator = fixture.canonical(&other_path);
    let other_retained = RetainedSource::open(&other_locator, InventoryLimits::default(), || false)
        .expect("other source should be retained");
    let mut custody = retained
        .begin_read_custody(InventoryLimits::default(), || false)
        .expect("all folder file handles should enter restrictive custody");

    assert!(OpenOptions::new()
        .write(true)
        .open(source_path.join("one.bin"))
        .is_err());
    let identities: Vec<_> = custody.file_identities().collect();
    assert_eq!(identities.len(), 2);
    for identity in identities {
        let mut buffer = [0u8; 8];
        while custody
            .read_chunk(identity, &mut buffer, || false)
            .expect("custodied folder read should succeed")
            != 0
        {}
    }

    fs::write(nested.join("added.bin"), b"late")
        .expect("a nested addition should demonstrate final revalidation");
    other_retained
        .revalidate(InventoryLimits::default(), || false)
        .expect("the unrelated retained source should remain unchanged");
    // `finish` has no source parameter: it is lifetime-bound to `retained`, so
    // an unchanged unrelated source cannot be substituted for the changed one.
    assert_eq!(
        custody.finish(InventoryLimits::default(), || false),
        Err(CustodyError::SourceChanged)
    );
}

#[test]
fn fresh_outputs_never_reuse_or_truncate_existing_entries() {
    let fixture = Fixture::new("output");
    let source_path = fixture.root.join("source-input.bin");
    fs::write(&source_path, b"source input").expect("source fixture should be written");
    let source = Rc::new(
        RetainedSource::open(
            &fixture.canonical(&source_path),
            InventoryLimits::default(),
            || false,
        )
        .expect("source should be retained"),
    );
    let output_path = fixture.root.join("output");
    fs::create_dir(&output_path).expect("output fixture should be created");
    let locator = fixture.canonical(&output_path);
    let root = RetainedOutputRoot::open(&locator).expect("output root should be retained");
    let mut scope = CombinedCustodyScope::acquire(
        &[Rc::clone(&source)],
        &root,
        CombinedCustodyLimits::default(),
        || false,
    )
    .expect("combined source and output custody should be acquired");

    let first_identity = scope
        .create_run_directory(|| false)
        .expect("fresh random run should be created");
    assert!(fs::rename(&output_path, fixture.root.join("moved-output")).is_err());
    let run_paths: Vec<PathBuf> = fs::read_dir(&output_path)
        .expect("output root should enumerate")
        .map(|entry| entry.expect("run entry should be readable").path())
        .collect();
    assert_eq!(run_paths.len(), 1);
    let run_path = &run_paths[0];
    let run_name = run_path
        .file_name()
        .and_then(|name| name.to_str())
        .expect("run name should be Unicode");
    assert!(run_name.starts_with("run-"));
    assert_eq!(run_name.len(), 36);

    let protected_source = fixture.root.join("protected.bin");
    fs::write(&protected_source, b"do-not-truncate").expect("protected fixture should be written");
    assert!(
        fs::hard_link(&protected_source, run_path.join("racing-hardlink.bin")).is_err(),
        "the retained fresh directory must deny a racing external hardlink"
    );
    let existing = scope
        .create_output_file("existing.bin", || false)
        .expect("first fresh entry should be created");
    scope
        .write_output_bytes(existing, b"existing-output", || false)
        .expect("existing fixture should be written");
    let existing_evidence = scope
        .finish_output_file(existing, || false)
        .expect("existing fixture should flush and produce evidence");
    assert_eq!(existing_evidence.byte_count(), 15);
    assert_eq!(
        existing_evidence.sha256(),
        "sha256:74241030e48b43b9ad89f2fe385c95d67b3c8897674edd487344bbe8337f1b5b"
    );
    assert_eq!(
        fs::read(&protected_source).expect("protected fixture should remain readable"),
        b"do-not-truncate"
    );
    assert_eq!(
        fs::read(run_path.join("existing.bin")).expect("existing output should be readable"),
        b"existing-output"
    );

    let output = scope
        .create_output_file("fresh.bin", || false)
        .expect("fresh output should be created");
    scope
        .write_output_bytes(output, b"fresh-output", || false)
        .expect("retained output write should succeed");
    assert_eq!(scope.output_bytes_written(output), Ok(12));
    let output_evidence = scope
        .finish_output_file(output, || false)
        .expect("retained output should flush and produce evidence");
    assert_eq!(output_evidence.byte_count(), 12);
    assert_eq!(
        output_evidence.sha256(),
        "sha256:aecd06e04135df8e9a18cf0e3457af9509c05281ee5ffd98bb26c562e3c7b4be"
    );
    assert!(matches!(
        scope.create_output_file("existing.bin", || false),
        Err(CombinedCustodyError::OutputRejected(
            OutputError::AlreadyExists
        ))
    ));
    assert!(scope.is_terminal());
    assert_eq!(
        scope.create_output_file("fresh.bin", || false),
        Err(CombinedCustodyError::ScopeTerminal)
    );
    assert_eq!(
        fs::read(run_path.join("fresh.bin")).expect("fresh output should be readable"),
        b"fresh-output"
    );

    let _ = scope.release();
    let mut second_scope =
        CombinedCustodyScope::acquire(&[source], &root, CombinedCustodyLimits::default(), || false)
            .expect("a second combined custody scope should be acquired");
    let second_run = second_scope
        .create_run_directory(|| false)
        .expect("a second fresh random run should be created");
    assert_ne!(first_identity, second_run);
}

#[test]
fn cancellation_is_polled_after_reads_and_between_bounded_writes() {
    let fixture = Fixture::new("custody-cancel");
    let source_path = fixture.root.join("source.bin");
    let source_bytes = b"one retained read";
    fs::write(&source_path, source_bytes).expect("source fixture should be written");
    let source = Rc::new(
        RetainedSource::open(
            &fixture.canonical(&source_path),
            InventoryLimits::default(),
            || false,
        )
        .expect("source should be retained"),
    );
    let mut custody = source
        .begin_read_custody(InventoryLimits::default(), || false)
        .expect("read custody should be acquired");
    let identity = custody
        .file_identities()
        .next()
        .expect("source identity should exist");
    let mut buffer = [0u8; 64];
    let read_polls = Cell::new(0usize);
    assert_eq!(
        custody.read_chunk(identity, &mut buffer, || {
            let next = read_polls.get() + 1;
            read_polls.set(next);
            next == 2
        }),
        Err(CustodyError::Cancelled)
    );
    assert_eq!(&buffer[..source_bytes.len()], source_bytes);
    drop(custody);

    let output_path = fixture.root.join("output");
    fs::create_dir(&output_path).expect("output fixture should be created");
    let output_root = RetainedOutputRoot::open(&fixture.canonical(&output_path))
        .expect("output root should be retained");
    let mut scope = CombinedCustodyScope::acquire(
        &[source],
        &output_root,
        CombinedCustodyLimits::default(),
        || false,
    )
    .expect("combined custody should be acquired");
    scope
        .create_run_directory(|| false)
        .expect("fresh run should be created");
    let run_path = fs::read_dir(&output_path)
        .expect("output root should enumerate")
        .next()
        .expect("run entry should exist")
        .expect("run entry should be readable")
        .path();
    let output = scope
        .create_output_file("cancelled.bin", || false)
        .expect("fresh file should be created");
    let write_bytes = vec![0x5au8; 1024 * 1024 + 1];
    let write_polls = Cell::new(0usize);
    assert_eq!(
        scope.write_output_bytes(output, &write_bytes, || {
            let next = write_polls.get() + 1;
            write_polls.set(next);
            next == 8
        }),
        Err(CombinedCustodyError::Cancelled)
    );
    assert!(scope.is_terminal());
    assert_eq!(
        scope.output_bytes_written(output),
        Err(CombinedCustodyError::ScopeTerminal)
    );
    assert_eq!(
        scope.write_output_bytes(output, b"retry", || false),
        Err(CombinedCustodyError::ScopeTerminal)
    );
    let partial_bytes = fs::metadata(run_path.join("cancelled.bin"))
        .expect("partial fresh output should remain retained")
        .len();
    assert!(partial_bytes > 0);
    assert!(partial_bytes <= 1024 * 1024);
    let released = scope.release();
    assert_eq!(released.retained_output_file_count(), 1);
}

#[test]
fn persistent_reverse_hardlink_invalidates_fresh_output_evidence() {
    let fixture = Fixture::new("output-reverse-hardlink");
    let source_path = fixture.root.join("source.bin");
    fs::write(&source_path, b"source").expect("source fixture should be written");
    let source = Rc::new(
        RetainedSource::open(
            &fixture.canonical(&source_path),
            InventoryLimits::default(),
            || false,
        )
        .expect("source should be retained"),
    );
    let output_path = fixture.root.join("output");
    let outside_path = fixture.root.join("outside");
    fs::create_dir(&output_path).expect("output fixture should be created");
    fs::create_dir(&outside_path).expect("outside fixture should be created");
    let output_root = RetainedOutputRoot::open(&fixture.canonical(&output_path))
        .expect("output root should be retained");
    let mut scope = CombinedCustodyScope::acquire(
        &[source],
        &output_root,
        CombinedCustodyLimits::default(),
        || false,
    )
    .expect("combined custody should be acquired");
    scope
        .create_run_directory(|| false)
        .expect("fresh run should be created");
    let run_path = fs::read_dir(&output_path)
        .expect("output root should enumerate")
        .next()
        .expect("run entry should exist")
        .expect("run entry should be readable")
        .path();
    let output_file_path = run_path.join("fresh.bin");
    let outside_alias_path = outside_path.join("outside-alias.bin");
    let output = scope
        .create_output_file("fresh.bin", || false)
        .expect("fresh output should be created with one link");
    scope
        .write_output_bytes(output, b"fresh output under custody", || false)
        .expect("fresh output write should succeed before the reverse link");

    fs::hard_link(&output_file_path, &outside_alias_path)
        .expect("Windows permits the reverse hardlink despite the file share posture");
    assert_eq!(
        scope.finish_output_file(output, || false),
        Err(CombinedCustodyError::OutputRejected(
            OutputError::WriteFailed
        )),
        "a persistent outside alias must prevent trusted output evidence"
    );
    assert_eq!(
        fs::read(&outside_alias_path).expect("outside alias should address the same bytes"),
        b"fresh output under custody"
    );
    assert!(scope.is_terminal());
    fs::remove_file(&outside_alias_path).expect("outside alias should be removed for retry test");
    assert_eq!(
        scope.finish_output_file(output, || false),
        Err(CombinedCustodyError::ScopeTerminal),
        "removing the observed mutation must not make terminal evidence retryable"
    );
    let released = scope.release();
    assert_eq!(released.retained_output_file_count(), 1);
}

#[test]
fn selected_reparse_root_is_rejected_when_symlinks_are_available() {
    let fixture = Fixture::new("reparse");
    let target = fixture.root.join("target");
    let link = fixture.root.join("link");
    fs::create_dir(&target).expect("target fixture should be created");
    create_directory_reparse(&target, &link);
    let locator = Fixture::locator(&link);
    assert_eq!(
        match RetainedSource::open(&locator, InventoryLimits::default(), || false) {
            Err(error) => error,
            Ok(_) => panic!("a selected reparse root must fail closed"),
        },
        CustodyError::ReparsePointRejected
    );
}

#[test]
fn ancestor_and_enumerated_descendant_reparse_points_are_rejected() {
    let fixture = Fixture::new("reparse-chain");
    let target = fixture.root.join("target");
    let nested = target.join("nested");
    fs::create_dir_all(&nested).expect("target fixture should be created");
    fs::write(nested.join("source.bin"), b"source").expect("source fixture should be written");
    let alias = fixture.root.join("alias");
    create_directory_reparse(&target, &alias);

    let through_reparse_ancestor = Fixture::locator(&alias.join("nested").join("source.bin"));
    assert_eq!(
        match RetainedSource::open(
            &through_reparse_ancestor,
            InventoryLimits::default(),
            || false,
        ) {
            Err(error) => error,
            Ok(_) => panic!("a reparse ancestor must fail closed"),
        },
        CustodyError::ReparsePointRejected
    );

    let source_folder = fixture.root.join("source-folder");
    fs::create_dir(&source_folder).expect("source folder fixture should be created");
    create_directory_reparse(&target, &source_folder.join("linked-child"));
    let folder_locator = fixture.canonical(&source_folder);
    assert_eq!(
        match RetainedSource::open(&folder_locator, InventoryLimits::default(), || false) {
            Err(error) => error,
            Ok(_) => panic!("an enumerated reparse descendant must fail closed"),
        },
        CustodyError::ReparsePointRejected
    );
}

#[test]
fn combined_scope_rolls_back_output_and_earlier_sources_on_partial_acquisition_failure() {
    let fixture = Fixture::new("combined-rollback");
    let first_path = fixture.root.join("first.bin");
    let second_path = fixture.root.join("second.bin");
    let output_path = fixture.root.join("output");
    fs::write(&first_path, b"first").expect("first source should be written");
    fs::write(&second_path, b"second").expect("second source should be written");
    fs::create_dir(&output_path).expect("output root should be created");
    let first = Rc::new(
        RetainedSource::open(
            &fixture.canonical(&first_path),
            InventoryLimits::default(),
            || false,
        )
        .expect("first source should be retained"),
    );
    let second = Rc::new(
        RetainedSource::open(
            &fixture.canonical(&second_path),
            InventoryLimits::default(),
            || false,
        )
        .expect("second source should be retained"),
    );
    let output = RetainedOutputRoot::open(&fixture.canonical(&output_path))
        .expect("output root should be retained");
    let second_writer = OpenOptions::new()
        .write(true)
        .open(&second_path)
        .expect("a preexisting second-source writer should open");

    assert!(matches!(
        CombinedCustodyScope::acquire(
            &[Rc::clone(&first), Rc::clone(&second)],
            &output,
            CombinedCustodyLimits::default(),
            || false,
        ),
        Err(CombinedCustodyError::SourceRejected(
            CustodyError::OpenRejected
        ))
    ));

    OpenOptions::new()
        .write(true)
        .open(&first_path)
        .expect("the earlier source lock must roll back after later failure");
    let moved_output = fixture.root.join("moved-output");
    fs::rename(&output_path, &moved_output)
        .expect("the output lock must roll back after source acquisition failure");
    fs::rename(&moved_output, &output_path).expect("output fixture should be restored");
    drop(second_writer);
}

#[test]
fn combined_scope_enforces_one_aggregate_layout_budget_across_sources() {
    let fixture = Fixture::new("combined-layout-budget");
    let first_path = fixture.root.join("first");
    let second_path = fixture.root.join("second");
    let output_path = fixture.root.join("output");
    fs::create_dir(&first_path).expect("first source should be created");
    fs::create_dir(&second_path).expect("second source should be created");
    fs::create_dir(&output_path).expect("output should be created");
    fs::write(first_path.join("one.bin"), b"one").expect("first file should be written");
    fs::write(second_path.join("two.bin"), b"two").expect("second file should be written");
    let per_source = InventoryLimits {
        // Each source is exactly 336 modeled bytes: a 128-byte folder root and
        // a 208-byte seven-unit file record.
        max_layout_memory_bytes: 336,
        ..InventoryLimits::default()
    };
    let first = Rc::new(
        RetainedSource::open(&fixture.canonical(&first_path), per_source, || false)
            .expect("first source should be retained"),
    );
    let second = Rc::new(
        RetainedSource::open(&fixture.canonical(&second_path), per_source, || false)
            .expect("second source should be retained"),
    );
    let output = RetainedOutputRoot::open(&fixture.canonical(&output_path))
        .expect("output should be retained");

    let one_byte_short = CombinedCustodyLimits {
        per_source,
        max_retained_layout_memory_bytes: 671,
        ..CombinedCustodyLimits::default()
    };
    assert!(matches!(
        CombinedCustodyScope::acquire(
            &[Rc::clone(&first), Rc::clone(&second)],
            &output,
            one_byte_short,
            || false,
        ),
        Err(CombinedCustodyError::LayoutMemoryLimitExceeded)
    ));

    let exact = CombinedCustodyLimits {
        max_retained_layout_memory_bytes: 672,
        ..one_byte_short
    };
    let scope = CombinedCustodyScope::acquire(&[first, second], &output, exact, || false)
        .expect("two sources ending exactly at the aggregate limit should be acquired");
    assert_eq!(scope.release().source_count(), 2);
}

#[test]
fn combined_scope_rejects_output_replacement_and_preexisting_directory_writer() {
    let fixture = Fixture::new("combined-output-race");
    let source_path = fixture.root.join("source.bin");
    let output_path = fixture.root.join("output");
    fs::write(&source_path, b"source").expect("source should be written");
    fs::create_dir(&output_path).expect("output root should be created");
    let source = Rc::new(
        RetainedSource::open(
            &fixture.canonical(&source_path),
            InventoryLimits::default(),
            || false,
        )
        .expect("source should be retained"),
    );
    let output = RetainedOutputRoot::open(&fixture.canonical(&output_path))
        .expect("output root should be retained");

    let writer = DirectoryWriterHandle::open(&output_path);
    assert!(matches!(
        CombinedCustodyScope::acquire(
            &[Rc::clone(&source)],
            &output,
            CombinedCustodyLimits::default(),
            || false,
        ),
        Err(CombinedCustodyError::OutputRejected(
            OutputError::RootRejected
        ))
    ));
    drop(writer);

    let moved_output = fixture.root.join("original-output");
    fs::rename(&output_path, &moved_output).expect("retained output should permit test rename");
    fs::create_dir(&output_path).expect("replacement output directory should be created");
    assert!(matches!(
        CombinedCustodyScope::acquire(&[source], &output, CombinedCustodyLimits::default(), || {
            false
        },),
        Err(CombinedCustodyError::OutputRejected(
            OutputError::RootRejected
        ))
    ));
    fs::remove_dir(&output_path).expect("replacement output should be removed");
    fs::rename(&moved_output, &output_path).expect("original output should be restored");
}

#[test]
fn combined_scope_lifetime_and_consuming_release_close_every_restrictive_handle() {
    let fixture = Fixture::new("combined-release");
    let source_path = fixture.root.join("source.bin");
    let output_path = fixture.root.join("output");
    fs::write(&source_path, b"source bytes").expect("source should be written");
    fs::create_dir(&output_path).expect("output root should be created");
    let source = Rc::new(
        RetainedSource::open(
            &fixture.canonical(&source_path),
            InventoryLimits::default(),
            || false,
        )
        .expect("source should be retained"),
    );
    let output = RetainedOutputRoot::open(&fixture.canonical(&output_path))
        .expect("output root should be retained");
    let mut scope =
        CombinedCustodyScope::acquire(&[source], &output, CombinedCustodyLimits::default(), || {
            false
        })
        .expect("combined custody should be acquired");

    let source_summary = scope
        .source_summaries()
        .next()
        .expect("source summary should exist");
    let output_summary = scope.output_summary();
    for (identity, volume) in [
        (
            source_summary.root_identity(),
            source_summary.local_volume_evidence(),
        ),
        (
            output_summary.root_identity(),
            output_summary.local_volume_evidence(),
        ),
    ] {
        assert_eq!(
            volume.corroborated_volume_serial(),
            identity.volume_serial_number()
        );
        assert!(matches!(
            volume.drive_kind(),
            LocalDriveKind::Fixed | LocalDriveKind::Removable
        ));
        assert_eq!(
            volume.dos_device_mapping(),
            DosDeviceMapping::DirectHarddiskVolume
        );
    }
    assert!(OpenOptions::new().write(true).open(&source_path).is_err());
    assert!(fs::rename(&output_path, fixture.root.join("blocked-output")).is_err());
    assert_eq!(
        fs::read_dir(&output_path)
            .expect("custodied output should enumerate")
            .count(),
        0,
        "acquiring the combined scope must not create a run"
    );
    assert_eq!(
        scope.create_output_file("too-early.bin", || false),
        Err(CombinedCustodyError::RunRequired)
    );

    scope
        .create_run_directory(|| false)
        .expect("run should be created only through the active combined scope");
    assert_eq!(
        scope.create_run_directory(|| false),
        Err(CombinedCustodyError::RunAlreadyCreated)
    );
    let run_path = fs::read_dir(&output_path)
        .expect("run should enumerate")
        .next()
        .expect("run should exist")
        .expect("run entry should be readable")
        .path();
    let output_identity = scope
        .create_output_file("active.bin", || false)
        .expect("output file should be created through the scope");
    scope
        .write_output_bytes(output_identity, b"active output", || false)
        .expect("active output should be written");
    let output_file_path = run_path.join("active.bin");
    assert!(fs::rename(&run_path, output_path.join("blocked-run")).is_err());
    assert!(fs::rename(&output_file_path, run_path.join("blocked-file.bin")).is_err());

    let released = scope.release();
    assert_eq!(released.source_count(), 1);
    assert_eq!(released.source_file_count(), 1);
    assert!(released.had_run_directory());
    assert_eq!(released.retained_output_file_count(), 1);

    OpenOptions::new()
        .write(true)
        .open(&source_path)
        .expect("source writer should open after consuming release");
    let moved_file = run_path.join("released-file.bin");
    fs::rename(&output_file_path, &moved_file)
        .expect("output file handle must close before release is acknowledged");
    let moved_run = output_path.join("released-run");
    fs::rename(&run_path, &moved_run)
        .expect("run handle must close before release is acknowledged");
    let moved_output = fixture.root.join("released-output");
    fs::rename(&output_path, &moved_output)
        .expect("output-root handle must close before release is acknowledged");
}

#[test]
fn combined_scope_rejects_duplicate_and_nested_source_identities() {
    let fixture = Fixture::new("combined-identity-collision");
    let folder_path = fixture.root.join("source-folder");
    let nested_path = folder_path.join("nested");
    let file_path = folder_path.join("source.bin");
    let output_path = fixture.root.join("output");
    fs::create_dir_all(&nested_path).expect("nested source should be created");
    fs::write(&file_path, b"source").expect("outer source should be written");
    fs::create_dir(&output_path).expect("output should be created");
    let folder = Rc::new(
        RetainedSource::open(
            &fixture.canonical(&folder_path),
            InventoryLimits::default(),
            || false,
        )
        .expect("folder should be retained"),
    );
    let nested = Rc::new(
        RetainedSource::open(
            &fixture.canonical(&nested_path),
            InventoryLimits::default(),
            || false,
        )
        .expect("nested folder should be retained"),
    );
    let output = RetainedOutputRoot::open(&fixture.canonical(&output_path))
        .expect("output should be retained");

    assert!(matches!(
        CombinedCustodyScope::acquire(
            &[Rc::clone(&folder), Rc::clone(&folder)],
            &output,
            CombinedCustodyLimits::default(),
            || false,
        ),
        Err(CombinedCustodyError::IdentityCollision)
    ));
    assert!(matches!(
        CombinedCustodyScope::acquire(
            &[folder, nested],
            &output,
            CombinedCustodyLimits::default(),
            || false,
        ),
        Err(CombinedCustodyError::IdentityCollision)
    ));
}

#[test]
fn combined_scope_rejects_an_output_directory_inside_the_source_inventory() {
    let fixture = Fixture::new("combined-output-source-collision");
    let folder_path = fixture.root.join("source-folder");
    let output_path = folder_path.join("output");
    fs::create_dir_all(&output_path).expect("nested output should be created");
    fs::write(folder_path.join("source.bin"), b"source").expect("source should be written");
    let source = Rc::new(
        RetainedSource::open(
            &fixture.canonical(&folder_path),
            InventoryLimits::default(),
            || false,
        )
        .expect("source folder should be retained"),
    );
    let output = RetainedOutputRoot::open(&fixture.canonical(&output_path))
        .expect("nested output should be retained");

    assert!(matches!(
        CombinedCustodyScope::acquire(&[source], &output, CombinedCustodyLimits::default(), || {
            false
        },),
        Err(CombinedCustodyError::IdentityCollision)
    ));
}

#[test]
fn combined_scope_rejects_an_output_root_that_contains_the_selected_source() {
    let fixture = Fixture::new("combined-output-ancestor");
    let output_path = fixture.root.join("output");
    let source_path = output_path.join("source.bin");
    fs::create_dir(&output_path).expect("output should be created");
    fs::write(&source_path, b"source").expect("nested source should be written");
    let source = Rc::new(
        RetainedSource::open(
            &fixture.canonical(&source_path),
            InventoryLimits::default(),
            || false,
        )
        .expect("nested source should be retained"),
    );
    let output = RetainedOutputRoot::open(&fixture.canonical(&output_path))
        .expect("ancestor output should be retained");

    assert!(matches!(
        CombinedCustodyScope::acquire(&[source], &output, CombinedCustodyLimits::default(), || {
            false
        },),
        Err(CombinedCustodyError::IdentityCollision)
    ));
}

#[test]
fn combined_scope_rejects_cross_drive_alias_ancestry_on_the_same_physical_volume() {
    let fixture = Fixture::new("combined-drive-alias-overlap");
    let output_path = fixture.root.join("output");
    let source_path = output_path.join("source.bin");
    fs::create_dir(&output_path).expect("output should be created");
    fs::write(&source_path, b"source").expect("nested source should be written");
    let canonical_source = fixture.canonical(&source_path);
    let drive = canonical_source
        .as_str()
        .encode_utf16()
        .next()
        .expect("drive");
    let drive_name = [drive, b':' as u16, 0];
    let mut target = vec![0u16; 32_768];
    // SAFETY: the drive name is NUL terminated and the target is initialized
    // writable UTF-16 storage.
    let units = unsafe { QueryDosDeviceW(PCWSTR(drive_name.as_ptr()), Some(&mut target)) } as usize;
    assert!(units > 0 && units <= target.len());
    let target_end = target[..units]
        .iter()
        .position(|unit| *unit == 0)
        .expect("drive mapping should be NUL terminated");
    let direct_target =
        String::from_utf16(&target[..target_end]).expect("drive mapping should be valid UTF-16");
    let (_alias_guard, alias_letter) = DosDeviceGuard::create_subst(&direct_target)
        .expect("a second direct drive-letter alias should be created");
    let mut alias_source = canonical_source.as_str().to_owned();
    alias_source.replace_range(..1, &alias_letter.to_string());
    let alias_source = CanonicalDosPath::parse(&alias_source)
        .expect("aliased source locator should remain canonical");
    let source = match RetainedSource::open(&alias_source, InventoryLimits::default(), || false) {
        Ok(source) => Rc::new(source),
        Err(CustodyError::ReparsePointRejected | CustodyError::NotDirectLocalVolume) => {
            // OBJ_DONT_REPARSE may reject the additional object-manager drive
            // alias before local-volume proof. That is an equally fail-closed
            // outcome for this exact adversarial fixture.
            return;
        }
        Err(error) => panic!("unexpected same-volume alias result: {error}"),
    };
    let output = RetainedOutputRoot::open(&fixture.canonical(&output_path))
        .expect("original-drive output should be retained");

    assert!(matches!(
        CombinedCustodyScope::acquire(&[source], &output, CombinedCustodyLimits::default(), || {
            false
        },),
        Err(CombinedCustodyError::IdentityCollision)
    ));
}

#[test]
fn observed_source_mutation_poison_is_not_retryable_after_mutation_is_removed() {
    let fixture = Fixture::new("combined-source-poison");
    let source_path = fixture.root.join("source");
    let source_file_path = source_path.join("source.bin");
    let output_path = fixture.root.join("output");
    fs::create_dir(&source_path).expect("source folder should be created");
    fs::write(&source_file_path, b"source bytes").expect("source should be written");
    fs::create_dir(&output_path).expect("output should be created");
    let source = Rc::new(
        RetainedSource::open(
            &fixture.canonical(&source_path),
            InventoryLimits::default(),
            || false,
        )
        .expect("source folder should be retained"),
    );
    let output = RetainedOutputRoot::open(&fixture.canonical(&output_path))
        .expect("output should be retained");
    let mut scope =
        CombinedCustodyScope::acquire(&[source], &output, CombinedCustodyLimits::default(), || {
            false
        })
        .expect("combined custody should be acquired");
    let identities: Vec<_> = scope.source_file_identities().collect();
    for identity in identities {
        let mut buffer = [0u8; 64];
        while scope
            .read_source_chunk(identity, &mut buffer, || false)
            .expect("source read should succeed")
            != 0
        {}
    }

    let mutation = source_path.join("added.bin");
    fs::write(&mutation, b"late").expect("source mutation should be created");
    assert!(matches!(
        scope.finish_source_reads(|| false),
        Err(CombinedCustodyError::SourceRejected(
            CustodyError::SourceChanged
        ))
    ));
    assert!(scope.is_terminal());
    fs::remove_file(&mutation).expect("source mutation should be removed");
    assert_eq!(
        scope.finish_source_reads(|| false),
        Err(CombinedCustodyError::ScopeTerminal),
        "removing an observed mutation must not make evidence retryable"
    );
    let _ = scope.release();
}

#[test]
fn combined_scope_honours_the_final_acquisition_cancellation_poll_and_rolls_back() {
    let fixture = Fixture::new("combined-final-cancel");
    let source_path = fixture.root.join("source.bin");
    let output_path = fixture.root.join("output");
    fs::write(&source_path, b"source").expect("source should be written");
    fs::create_dir(&output_path).expect("output should be created");
    let source = Rc::new(
        RetainedSource::open(
            &fixture.canonical(&source_path),
            InventoryLimits::default(),
            || false,
        )
        .expect("source should be retained"),
    );
    let output = RetainedOutputRoot::open(&fixture.canonical(&output_path))
        .expect("output should be retained");

    let baseline_polls = Cell::new(0usize);
    let baseline = CombinedCustodyScope::acquire(
        &[Rc::clone(&source)],
        &output,
        CombinedCustodyLimits::default(),
        || {
            baseline_polls.set(baseline_polls.get() + 1);
            false
        },
    )
    .expect("baseline acquisition should succeed");
    let _ = baseline.release();
    let cancel_at = baseline_polls.get();
    assert!(cancel_at > 1);

    let replay_polls = Cell::new(0usize);
    assert!(matches!(
        CombinedCustodyScope::acquire(&[source], &output, CombinedCustodyLimits::default(), || {
            let next = replay_polls.get() + 1;
            replay_polls.set(next);
            next == cancel_at
        },),
        Err(CombinedCustodyError::Cancelled)
    ));
    assert_eq!(replay_polls.get(), cancel_at);

    OpenOptions::new()
        .write(true)
        .open(&source_path)
        .expect("final cancellation must release the source lock");
    let moved_output = fixture.root.join("cancelled-output");
    fs::rename(&output_path, &moved_output)
        .expect("final cancellation must release the output lock");
}

#[test]
fn post_create_run_cancellation_keeps_the_run_owned_and_makes_scope_release_only() {
    let fixture = Fixture::new("combined-run-post-create-cancel");
    let source_path = fixture.root.join("source.bin");
    let output_path = fixture.root.join("output");
    fs::write(&source_path, b"source").expect("source should be written");
    fs::create_dir(&output_path).expect("output should be created");
    let source = Rc::new(
        RetainedSource::open(
            &fixture.canonical(&source_path),
            InventoryLimits::default(),
            || false,
        )
        .expect("source should be retained"),
    );
    let output = RetainedOutputRoot::open(&fixture.canonical(&output_path))
        .expect("output should be retained");

    let mut baseline = CombinedCustodyScope::acquire(
        &[Rc::clone(&source)],
        &output,
        CombinedCustodyLimits::default(),
        || false,
    )
    .expect("baseline scope should be acquired");
    let baseline_polls = Cell::new(0usize);
    baseline
        .create_run_directory(|| {
            baseline_polls.set(baseline_polls.get() + 1);
            false
        })
        .expect("baseline run should be created");
    let _ = baseline.release();
    let cancel_at = baseline_polls.get();
    assert!(cancel_at > 1);

    let before: std::collections::BTreeSet<_> = fs::read_dir(&output_path)
        .expect("output should enumerate")
        .map(|entry| entry.expect("run entry should be readable").path())
        .collect();
    let mut scope =
        CombinedCustodyScope::acquire(&[source], &output, CombinedCustodyLimits::default(), || {
            false
        })
        .expect("second scope should be acquired");
    let replay_polls = Cell::new(0usize);
    assert_eq!(
        scope.create_run_directory(|| {
            let next = replay_polls.get() + 1;
            replay_polls.set(next);
            next == cancel_at
        }),
        Err(CombinedCustodyError::Cancelled)
    );
    assert!(scope.is_terminal());
    assert_eq!(
        scope.create_run_directory(|| false),
        Err(CombinedCustodyError::ScopeTerminal)
    );
    let after: std::collections::BTreeSet<_> = fs::read_dir(&output_path)
        .expect("output should enumerate after cancellation")
        .map(|entry| entry.expect("run entry should be readable").path())
        .collect();
    let created: Vec<_> = after.difference(&before).cloned().collect();
    assert_eq!(created.len(), 1);
    let cancelled_run = &created[0];
    assert!(fs::rename(cancelled_run, output_path.join("blocked-run")).is_err());

    let released = scope.release();
    assert!(released.had_run_directory());
    fs::rename(cancelled_run, output_path.join("released-run"))
        .expect("release must close the post-create-cancelled run handle");
}

#[test]
fn post_create_file_cancellation_keeps_the_file_owned_and_accounts_for_release() {
    let fixture = Fixture::new("combined-file-post-create-cancel");
    let source_path = fixture.root.join("source.bin");
    let output_path = fixture.root.join("output");
    fs::write(&source_path, b"source").expect("source should be written");
    fs::create_dir(&output_path).expect("output should be created");
    let source = Rc::new(
        RetainedSource::open(
            &fixture.canonical(&source_path),
            InventoryLimits::default(),
            || false,
        )
        .expect("source should be retained"),
    );
    let output = RetainedOutputRoot::open(&fixture.canonical(&output_path))
        .expect("output should be retained");

    let mut baseline = CombinedCustodyScope::acquire(
        &[Rc::clone(&source)],
        &output,
        CombinedCustodyLimits::default(),
        || false,
    )
    .expect("baseline scope should be acquired");
    baseline
        .create_run_directory(|| false)
        .expect("baseline run should be created");
    let baseline_polls = Cell::new(0usize);
    baseline
        .create_output_file("baseline.bin", || {
            baseline_polls.set(baseline_polls.get() + 1);
            false
        })
        .expect("baseline output should be created");
    let _ = baseline.release();
    let cancel_at = baseline_polls.get();
    assert!(cancel_at > 1);

    let before: std::collections::BTreeSet<_> = fs::read_dir(&output_path)
        .expect("output should enumerate")
        .map(|entry| entry.expect("run entry should be readable").path())
        .collect();
    let mut scope =
        CombinedCustodyScope::acquire(&[source], &output, CombinedCustodyLimits::default(), || {
            false
        })
        .expect("second scope should be acquired");
    scope
        .create_run_directory(|| false)
        .expect("second run should be created");
    let after_run: std::collections::BTreeSet<_> = fs::read_dir(&output_path)
        .expect("output should enumerate after run creation")
        .map(|entry| entry.expect("run entry should be readable").path())
        .collect();
    let run_paths: Vec<_> = after_run.difference(&before).cloned().collect();
    assert_eq!(run_paths.len(), 1);
    let run_path = &run_paths[0];
    let replay_polls = Cell::new(0usize);
    assert_eq!(
        scope.create_output_file("cancelled.bin", || {
            let next = replay_polls.get() + 1;
            replay_polls.set(next);
            next == cancel_at
        }),
        Err(CombinedCustodyError::Cancelled)
    );
    assert!(scope.is_terminal());
    assert_eq!(
        scope.create_output_file("retry.bin", || false),
        Err(CombinedCustodyError::ScopeTerminal)
    );
    let cancelled_file = run_path.join("cancelled.bin");
    assert!(cancelled_file.is_file());
    assert!(fs::rename(&cancelled_file, run_path.join("blocked.bin")).is_err());

    let released = scope.release();
    assert_eq!(released.retained_output_file_count(), 1);
    fs::rename(&cancelled_file, run_path.join("released.bin"))
        .expect("release must close the post-create-cancelled file handle");
}
