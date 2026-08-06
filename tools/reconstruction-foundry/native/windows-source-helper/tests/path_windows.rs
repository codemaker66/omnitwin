#![cfg(windows)]

use venviewer_windows_source_helper::path::{
    compare_canonical_dos_paths, CanonicalDosPath, PathComparisonError, PathRelation,
    PathValidationError, MAX_PRIVATE_PATH_UTF16_UNITS,
};

#[test]
fn accepts_v0_equivalent_canonical_paths() {
    for value in [
        r"C:\Reception Room\Scan_01.E57",
        r"D:\Réception\Straße\資料.bin",
        r"Z:\a",
        r"C:\COM0\LPT10\normal.txt",
    ] {
        let parsed = CanonicalDosPath::parse(value).expect("canonical path should be accepted");
        assert_eq!(parsed.as_str(), value);
    }
}

#[test]
fn rejects_non_drive_device_unc_relative_and_volume_root_paths() {
    let cases = [
        (r"C:\", PathValidationError::VolumeRoot),
        (r"c:\room", PathValidationError::DriveLetterNotUppercase),
        (
            r"\\?\C:\room",
            PathValidationError::NotCanonicalDriveAbsolute,
        ),
        (
            r"\\.\C:\room",
            PathValidationError::NotCanonicalDriveAbsolute,
        ),
        (
            r"\??\C:\room",
            PathValidationError::NotCanonicalDriveAbsolute,
        ),
        (
            r"\Device\HarddiskVolume1\room",
            PathValidationError::NotCanonicalDriveAbsolute,
        ),
        (
            r"\\server\share\room",
            PathValidationError::NotCanonicalDriveAbsolute,
        ),
        (r"C:room", PathValidationError::NotCanonicalDriveAbsolute),
        (r"room\file", PathValidationError::NotCanonicalDriveAbsolute),
    ];

    for (value, expected) in cases {
        assert_eq!(CanonicalDosPath::parse(value), Err(expected), "{value:?}");
    }
}

#[test]
fn rejects_v0_unsafe_and_ambiguous_segments() {
    let cases = [
        (r"C:\room\\file", PathValidationError::EmptyComponent),
        (r"C:\room\.", PathValidationError::DotComponent),
        (r"C:\room\..", PathValidationError::DotComponent),
        (r"C:\room\file\", PathValidationError::TrailingSeparator),
        (r"C:\room\file.", PathValidationError::TrailingDotOrSpace),
        (r"C:\room\file ", PathValidationError::TrailingDotOrSpace),
        (
            r"C:\room\file:stream",
            PathValidationError::InvalidSegmentCharacter,
        ),
        (
            r#"C:\room\fi"le"#,
            PathValidationError::InvalidSegmentCharacter,
        ),
        (
            r"C:\room\fi<le",
            PathValidationError::InvalidSegmentCharacter,
        ),
        (
            r"C:\room\fi>le",
            PathValidationError::InvalidSegmentCharacter,
        ),
        (
            r"C:\room\fi|le",
            PathValidationError::InvalidSegmentCharacter,
        ),
        (
            r"C:\room\fi?le",
            PathValidationError::InvalidSegmentCharacter,
        ),
        (
            r"C:\room\fi*le",
            PathValidationError::InvalidSegmentCharacter,
        ),
        (r"C:/room/file", PathValidationError::ForwardSlash),
    ];

    for (value, expected) in cases {
        assert_eq!(CanonicalDosPath::parse(value), Err(expected), "{value:?}");
    }
}

#[test]
fn rejects_controls_bidi_and_utf16_oversized_segments() {
    for control in ['\0', '\u{001f}', '\u{007f}'] {
        let value = format!("C:\\room\\fi{control}le");
        assert_eq!(
            CanonicalDosPath::parse(&value),
            Err(PathValidationError::ControlCharacter)
        );
    }
    for bidi in ['\u{202a}', '\u{202e}', '\u{2066}', '\u{2069}'] {
        let value = format!("C:\\room\\fi{bidi}le");
        assert_eq!(
            CanonicalDosPath::parse(&value),
            Err(PathValidationError::BidiControl)
        );
    }

    let exactly_255_units = format!("{}a", "😀".repeat(127));
    CanonicalDosPath::parse(&format!("C:\\{exactly_255_units}"))
        .expect("255 UTF-16 units should be accepted");
    let too_long = "😀".repeat(128);
    assert_eq!(
        CanonicalDosPath::parse(&format!("C:\\{too_long}")),
        Err(PathValidationError::SegmentTooLong)
    );
}

#[test]
fn rejects_all_reserved_dos_device_basenames() {
    for component in [
        "CON",
        "prn.txt",
        "AuX",
        "nul.bin",
        "CLOCK$",
        "conin$.txt",
        "CONOUT$",
        "COM¹",
        "com².txt",
        "COM³",
        "LPT¹",
        "lpt².dat",
        "LPT³",
    ] {
        assert_reserved(component);
    }
    for number in 1..=9 {
        assert_reserved(&format!("COM{number}.txt"));
        assert_reserved(&format!("LPT{number}"));
    }
}

#[test]
fn enforces_total_path_limit_in_utf16_units() {
    let maximum = path_with_utf16_length(MAX_PRIVATE_PATH_UTF16_UNITS);
    assert_eq!(maximum.encode_utf16().count(), MAX_PRIVATE_PATH_UTF16_UNITS);
    CanonicalDosPath::parse(&maximum).expect("maximum-length path should be accepted");

    let over_limit = format!("{maximum}a");
    assert_eq!(
        CanonicalDosPath::parse(&over_limit),
        Err(PathValidationError::TooLong)
    );
}

#[test]
fn compare_string_ordinal_drives_all_relations() {
    let cases = [
        (r"C:\Room\File.E57", r"C:\room\file.e57", PathRelation::Same),
        (r"C:\Room", r"C:\room\child\file", PathRelation::Ancestor),
        (r"C:\Room\child", r"C:\room", PathRelation::Descendant),
        (r"C:\Room", r"C:\Roommate", PathRelation::Disjoint),
        (r"C:\Room", r"D:\Room", PathRelation::Disjoint),
        (r"C:\RÉCEPTION", r"C:\réception", PathRelation::Same),
        (r"C:\é", "C:\\e\u{301}", PathRelation::Disjoint),
    ];

    for (left, right, expected) in cases {
        assert_eq!(
            compare_canonical_dos_paths(left, right),
            Ok(expected),
            "{left:?} versus {right:?}"
        );
    }
}

#[test]
fn comparison_reports_which_private_input_was_rejected() {
    assert_eq!(
        compare_canonical_dos_paths(r"C:\", r"C:\room"),
        Err(PathComparisonError::InvalidLeft(
            PathValidationError::VolumeRoot
        ))
    );
    assert_eq!(
        compare_canonical_dos_paths(r"C:\room", r"\\server\share"),
        Err(PathComparisonError::InvalidRight(
            PathValidationError::NotCanonicalDriveAbsolute
        ))
    );
}

fn assert_reserved(component: &str) {
    assert_eq!(
        CanonicalDosPath::parse(&format!("C:\\room\\{component}")),
        Err(PathValidationError::ReservedDosName),
        "{component:?}"
    );
}

fn path_with_utf16_length(target: usize) -> String {
    assert!(target > 3);
    let mut path = String::from("C:\\");
    while path.encode_utf16().count() < target {
        if path.len() > 3 {
            path.push('\\');
        }
        let remaining = target - path.encode_utf16().count();
        path.push_str(&"a".repeat(remaining.min(255)));
    }
    path
}
