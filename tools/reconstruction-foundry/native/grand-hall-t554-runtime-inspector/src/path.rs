use std::os::windows::fs::MetadataExt;
use std::path::{Component, Path, PathBuf, Prefix};

const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;

fn require_local_drive_path(path: &Path, canonical: bool) -> Result<(), String> {
    let Some(Component::Prefix(prefix)) = path.components().next() else {
        return Err("DLL directory must use an absolute local drive path".to_owned());
    };
    let allowed = if canonical {
        matches!(prefix.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_))
    } else {
        matches!(prefix.kind(), Prefix::Disk(_))
    };
    if !allowed || !path.is_absolute() {
        return Err(
            "DLL directory must use an absolute local drive path; UNC, device, and drive-relative paths are forbidden"
                .to_owned(),
        );
    }
    Ok(())
}

fn reject_reparse_components(path: &Path) -> Result<(), String> {
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component.as_os_str());
        if matches!(component, Component::Prefix(_)) {
            // `C:` alone is drive-relative. Inspect after RootDir produces C:\.
            continue;
        }
        let metadata = std::fs::symlink_metadata(&current).map_err(|error| {
            format!(
                "DLL directory component does not exist or is inaccessible: {}: {error}",
                current.display()
            )
        })?;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(format!(
                "DLL directory and every ancestor must be non-reparse local directories: {}",
                current.display()
            ));
        }
    }
    Ok(())
}

pub(crate) fn validate_existing_absolute_directory(path: &Path) -> Result<PathBuf, String> {
    if path.as_os_str().is_empty() {
        return Err("DLL directory must not be empty".to_owned());
    }
    require_local_drive_path(path, false)?;
    reject_reparse_components(path)?;
    let metadata = std::fs::metadata(path)
        .map_err(|error| format!("DLL directory does not exist or is inaccessible: {error}"))?;
    if !metadata.is_dir() {
        return Err("DLL directory must identify an existing directory".to_owned());
    }
    let canonical = std::fs::canonicalize(path)
        .map_err(|error| format!("failed to canonicalize DLL directory: {error}"))?;
    if !canonical.is_absolute() {
        return Err("canonical DLL directory is unexpectedly not absolute".to_owned());
    }
    require_local_drive_path(&canonical, true)?;
    reject_reparse_components(&canonical)?;
    Ok(canonical)
}

#[cfg(test)]
mod tests {
    use super::validate_existing_absolute_directory;
    use std::path::Path;

    #[test]
    fn rejects_empty_and_relative_paths() {
        assert!(validate_existing_absolute_directory(Path::new("")).is_err());
        assert!(validate_existing_absolute_directory(Path::new("relative")).is_err());
        assert!(validate_existing_absolute_directory(Path::new("C:relative")).is_err());
    }

    #[test]
    fn rejects_unc_and_device_paths_before_access() {
        assert!(
            validate_existing_absolute_directory(Path::new(r"\\localhost\c$\Windows")).is_err()
        );
        assert!(
            validate_existing_absolute_directory(Path::new(r"\\?\UNC\localhost\c$\Windows"))
                .is_err()
        );
        assert!(validate_existing_absolute_directory(Path::new(r"\\.\C:\Windows")).is_err());
    }

    #[test]
    fn canonicalizes_an_existing_absolute_directory() {
        let current = std::env::current_dir().expect("current directory");
        let canonical = validate_existing_absolute_directory(&current).expect("valid directory");
        assert!(canonical.is_absolute());
        assert!(canonical.is_dir());
    }

    #[test]
    fn rejects_an_existing_file() {
        let file = Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml");
        assert!(validate_existing_absolute_directory(&file).is_err());
    }
}
