use std::fmt;

use windows::Win32::Globalization::{CompareStringOrdinal, CSTR_EQUAL};

pub const MAX_PRIVATE_PATH_UTF16_UNITS: usize = 32_767;
pub const MAX_PRIVATE_PATH_SEGMENT_UTF16_UNITS: usize = 255;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CanonicalDosPath {
    value: String,
    utf16: Vec<u16>,
}

impl CanonicalDosPath {
    pub fn parse(value: &str) -> Result<Self, PathValidationError> {
        let utf16: Vec<u16> = value.encode_utf16().collect();
        if utf16.len() > MAX_PRIVATE_PATH_UTF16_UNITS {
            return Err(PathValidationError::TooLong);
        }
        validate_path_shape(value)?;
        Ok(Self {
            value: value.to_owned(),
            utf16,
        })
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.value
    }

    fn utf16(&self) -> &[u16] {
        &self.utf16
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PathRelation {
    Same,
    Ancestor,
    Descendant,
    Disjoint,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PathValidationError {
    Empty,
    TooLong,
    NotCanonicalDriveAbsolute,
    DriveLetterNotUppercase,
    VolumeRoot,
    ForwardSlash,
    ControlCharacter,
    BidiControl,
    EmptyComponent,
    SegmentTooLong,
    DotComponent,
    TrailingSeparator,
    TrailingDotOrSpace,
    InvalidSegmentCharacter,
    ReservedDosName,
}

impl fmt::Display for PathValidationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Empty => "path is empty",
            Self::TooLong => "path is too long",
            Self::NotCanonicalDriveAbsolute => "path is not a canonical drive-absolute DOS path",
            Self::DriveLetterNotUppercase => "drive letter is not uppercase",
            Self::VolumeRoot => "volume roots are not accepted",
            Self::ForwardSlash => "path contains a forward slash",
            Self::ControlCharacter => "path contains a control character",
            Self::BidiControl => "path contains a bidirectional text control",
            Self::EmptyComponent => "path contains an empty component",
            Self::SegmentTooLong => "path component is too long",
            Self::DotComponent => "path contains a dot component",
            Self::TrailingSeparator => "non-root path has a trailing separator",
            Self::TrailingDotOrSpace => "path component ends with a dot or space",
            Self::InvalidSegmentCharacter => "path contains an invalid Windows name character",
            Self::ReservedDosName => "path contains a reserved DOS device name",
        })
    }
}

impl std::error::Error for PathValidationError {}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PathComparisonError {
    InvalidLeft(PathValidationError),
    InvalidRight(PathValidationError),
    WindowsComparisonFailed,
}

impl fmt::Display for PathComparisonError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidLeft(error) => write!(formatter, "invalid left path: {error}"),
            Self::InvalidRight(error) => write!(formatter, "invalid right path: {error}"),
            Self::WindowsComparisonFailed => formatter.write_str("Windows path comparison failed"),
        }
    }
}

impl std::error::Error for PathComparisonError {}

pub fn compare_canonical_dos_paths(
    left: &str,
    right: &str,
) -> Result<PathRelation, PathComparisonError> {
    let left = CanonicalDosPath::parse(left).map_err(PathComparisonError::InvalidLeft)?;
    let right = CanonicalDosPath::parse(right).map_err(PathComparisonError::InvalidRight)?;

    if ordinal_equal(left.utf16(), right.utf16())? {
        return Ok(PathRelation::Same);
    }
    if is_ancestor(&left, &right)? {
        return Ok(PathRelation::Ancestor);
    }
    if is_ancestor(&right, &left)? {
        return Ok(PathRelation::Descendant);
    }
    Ok(PathRelation::Disjoint)
}

fn validate_path_shape(value: &str) -> Result<(), PathValidationError> {
    if value.is_empty() {
        return Err(PathValidationError::Empty);
    }
    if value.contains('/') {
        return Err(PathValidationError::ForwardSlash);
    }
    if value
        .chars()
        .any(|character| matches!(character as u32, 0x00..=0x1f | 0x7f))
    {
        return Err(PathValidationError::ControlCharacter);
    }
    if value
        .chars()
        .any(|character| matches!(character as u32, 0x202a..=0x202e | 0x2066..=0x2069))
    {
        return Err(PathValidationError::BidiControl);
    }

    let bytes = value.as_bytes();
    if bytes.len() < 3 || !bytes[0].is_ascii_alphabetic() || bytes[1] != b':' || bytes[2] != b'\\' {
        return Err(PathValidationError::NotCanonicalDriveAbsolute);
    }
    if !bytes[0].is_ascii_uppercase() {
        return Err(PathValidationError::DriveLetterNotUppercase);
    }
    if value.len() == 3 {
        return Err(PathValidationError::VolumeRoot);
    }
    if value.len() > 3 && value.ends_with('\\') {
        return Err(PathValidationError::TrailingSeparator);
    }

    for component in value[3..].split('\\') {
        validate_component(component)?;
    }
    Ok(())
}

fn validate_component(component: &str) -> Result<(), PathValidationError> {
    if component.is_empty() {
        return Err(PathValidationError::EmptyComponent);
    }
    if component.encode_utf16().count() > MAX_PRIVATE_PATH_SEGMENT_UTF16_UNITS {
        return Err(PathValidationError::SegmentTooLong);
    }
    if component == "." || component == ".." {
        return Err(PathValidationError::DotComponent);
    }
    if component.ends_with(['.', ' ']) {
        return Err(PathValidationError::TrailingDotOrSpace);
    }
    if component.chars().any(|character| {
        matches!(
            character,
            '<' | '>' | '"' | '/' | '\\' | '|' | '?' | '*' | ':'
        )
    }) {
        return Err(PathValidationError::InvalidSegmentCharacter);
    }
    if is_reserved_dos_name(component) {
        return Err(PathValidationError::ReservedDosName);
    }
    Ok(())
}

fn is_reserved_dos_name(component: &str) -> bool {
    let stem = component.split('.').next().unwrap_or(component);
    let upper = stem.to_ascii_uppercase();
    matches!(
        upper.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CLOCK$" | "CONIN$" | "CONOUT$"
    ) || has_reserved_numeric_suffix(&upper, "COM")
        || has_reserved_numeric_suffix(&upper, "LPT")
}

fn has_reserved_numeric_suffix(value: &str, prefix: &str) -> bool {
    let Some(suffix) = value.strip_prefix(prefix) else {
        return false;
    };
    (suffix.len() == 1 && matches!(suffix.as_bytes()[0], b'1'..=b'9'))
        || matches!(suffix, "¹" | "²" | "³")
}

fn is_ancestor(
    candidate: &CanonicalDosPath,
    descendant: &CanonicalDosPath,
) -> Result<bool, PathComparisonError> {
    if candidate.utf16().len() >= descendant.utf16().len() {
        return Ok(false);
    }
    let candidate_length = candidate.utf16().len();
    if !ordinal_equal(candidate.utf16(), &descendant.utf16()[..candidate_length])? {
        return Ok(false);
    }
    Ok(candidate.as_str().ends_with('\\')
        || descendant.utf16().get(candidate_length).copied() == Some(u16::from(b'\\')))
}

fn ordinal_equal(left: &[u16], right: &[u16]) -> Result<bool, PathComparisonError> {
    // SAFETY: both slices are valid, initialized UTF-16 buffers. The generated
    // binding passes their explicit lengths, and the protocol path cap keeps
    // each length well within the API's i32 count range.
    let result = unsafe { CompareStringOrdinal(left, right, true) };
    if result.0 == 0 {
        return Err(PathComparisonError::WindowsComparisonFailed);
    }
    Ok(result == CSTR_EQUAL)
}
