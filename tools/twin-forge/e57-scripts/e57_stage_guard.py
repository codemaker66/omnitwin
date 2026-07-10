"""Fail-closed helpers for reading a verified capture stage.

This module deliberately uses only the Python standard library so its path,
manifest, and provenance rules can be tested without pye57, Blender, or a
point-cloud toolchain. Reconstruction scripts may read the stage, but their
outputs must be written to a disjoint working directory.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path, PurePosixPath
import re
import stat
from typing import Any, Iterable


CAPTURE_STAGE_SCHEMA_VERSION = "venviewer.capture-stage.v1"
LIDAR_TRUTH_SCHEMA_VERSION = "venviewer.lidar-truth-panos.v1"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


@dataclass(frozen=True)
class StageFile:
    source_relative_path: str
    target_relative_path: str
    size_bytes: int
    sha256: str
    role: str
    path: Path


@dataclass(frozen=True)
class StageContext:
    root: Path
    manifest_path: Path
    plan_sha256: str
    source_root: str
    files: tuple[StageFile, ...]
    primary_e57: StageFile


@dataclass(frozen=True)
class TruthPano:
    scan_index: int
    relative_path: str
    size_bytes: int
    sha256: str
    width: int
    height: int


@dataclass(frozen=True)
class TruthPanoContext:
    root: Path
    manifest_path: Path
    manifest_sha256: str
    generator_name: str
    generator_version: str
    generator_parameters_sha256: str
    panos: tuple[TruthPano, ...]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def canonical_json_sha256(value: Any) -> str:
    payload = json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _require_dict(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return value


def _require_exact_keys(value: dict[str, Any], expected: set[str], label: str) -> None:
    actual = set(value)
    if actual != expected:
        missing = sorted(expected - actual)
        unexpected = sorted(actual - expected)
        raise ValueError(
            f"{label} keys do not match contract; missing={missing}, unexpected={unexpected}"
        )


def _require_nonempty_string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a non-empty string")
    return value


def _require_sha256(value: Any, label: str) -> str:
    if not isinstance(value, str) or SHA256_RE.fullmatch(value) is None:
        raise ValueError(f"{label} must be a lowercase SHA-256 digest")
    return value


def _require_nonnegative_int(value: Any, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise ValueError(f"{label} must be a non-negative integer")
    return value


def _is_link_or_reparse(path: Path) -> bool:
    metadata = path.lstat()
    file_attributes = getattr(metadata, "st_file_attributes", 0)
    reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    return path.is_symlink() or (reparse_flag != 0 and bool(file_attributes & reparse_flag))


def _resolve_relative_file(root: Path, relative_path: str, label: str) -> Path:
    if "\\" in relative_path:
        raise ValueError(f"{label} must use forward slashes")
    pure = PurePosixPath(relative_path)
    if pure.is_absolute() or not pure.parts or any(part in ("", ".", "..") for part in pure.parts):
        raise ValueError(f"{label} must be a canonical relative path")
    candidate_unresolved = root
    for part in pure.parts:
        candidate_unresolved = candidate_unresolved / part
        try:
            linked = _is_link_or_reparse(candidate_unresolved)
        except FileNotFoundError as error:
            raise ValueError(f"{label} is absent: {candidate_unresolved}") from error
        if linked:
            raise ValueError(f"{label} traverses a symbolic link or reparse point")
    candidate = candidate_unresolved.resolve(strict=True)
    try:
        candidate.relative_to(root)
    except ValueError as error:
        raise ValueError(f"{label} escapes its declared root") from error
    if not candidate.is_file():
        raise ValueError(f"{label} is not a regular file: {candidate}")
    return candidate


def _is_relative_to(candidate: Path, parent: Path) -> bool:
    try:
        candidate.relative_to(parent)
        return True
    except ValueError:
        return False


def assert_disjoint_output(output: Path, protected_roots: Iterable[Path]) -> Path:
    """Resolve an output path and reject either direction of overlap."""
    resolved = output.expanduser().resolve(strict=False)
    if resolved == Path(resolved.anchor):
        raise ValueError("output cannot be a filesystem root")
    for protected in protected_roots:
        protected_resolved = protected.expanduser().resolve(strict=True)
        if _is_relative_to(resolved, protected_resolved) or _is_relative_to(
            protected_resolved, resolved
        ):
            raise ValueError(
                f"output {resolved} overlaps protected source {protected_resolved}"
            )
    return resolved


def load_stage(stage_root: Path) -> StageContext:
    stage_input = stage_root.expanduser()
    if _is_link_or_reparse(stage_input):
        raise ValueError("capture stage root cannot be a symbolic link or reparse point")
    root = stage_input.resolve(strict=True)
    if not root.is_dir():
        raise ValueError(f"capture stage is not a directory: {root}")
    manifest_path = _resolve_relative_file(
        root, "capture-stage-manifest.json", "capture stage manifest"
    )
    raw = _require_dict(json.loads(manifest_path.read_text(encoding="utf-8")), "stage manifest")
    _require_exact_keys(
        raw,
        {"schemaVersion", "sourceRoot", "planSha256", "fileCount", "totalBytes", "files"},
        "stage manifest",
    )
    if raw["schemaVersion"] != CAPTURE_STAGE_SCHEMA_VERSION:
        raise ValueError(f"unsupported capture stage schema: {raw['schemaVersion']!r}")
    source_root = _require_nonempty_string(raw["sourceRoot"], "stage sourceRoot")
    plan_sha256 = _require_sha256(raw["planSha256"], "stage planSha256")
    file_count = _require_nonnegative_int(raw["fileCount"], "stage fileCount")
    total_bytes = _require_nonnegative_int(raw["totalBytes"], "stage totalBytes")
    if not isinstance(raw["files"], list):
        raise ValueError("stage files must be an array")

    files: list[StageFile] = []
    source_paths: list[str] = []
    target_paths: set[str] = set()
    for index, entry_value in enumerate(raw["files"]):
        entry = _require_dict(entry_value, f"stage files[{index}]")
        _require_exact_keys(
            entry,
            {"sourceRelativePath", "targetRelativePath", "sizeBytes", "sha256", "role"},
            f"stage files[{index}]",
        )
        source_relative_path = _require_nonempty_string(
            entry["sourceRelativePath"], f"stage files[{index}].sourceRelativePath"
        )
        target_relative_path = _require_nonempty_string(
            entry["targetRelativePath"], f"stage files[{index}].targetRelativePath"
        )
        if target_relative_path in target_paths:
            raise ValueError(f"duplicate stage target path: {target_relative_path}")
        target_paths.add(target_relative_path)
        source_paths.append(source_relative_path)
        size_bytes = _require_nonnegative_int(
            entry["sizeBytes"], f"stage files[{index}].sizeBytes"
        )
        digest = _require_sha256(entry["sha256"], f"stage files[{index}].sha256")
        role = entry["role"]
        if role not in ("primary_capture", "vendor_control"):
            raise ValueError(f"unsupported stage role at files[{index}]: {role!r}")
        path = _resolve_relative_file(root, target_relative_path, f"stage files[{index}]")
        actual_size = path.stat().st_size
        if actual_size != size_bytes:
            raise ValueError(
                f"stage file size drift for {target_relative_path}: expected {size_bytes}, got {actual_size}"
            )
        files.append(
            StageFile(
                source_relative_path=source_relative_path,
                target_relative_path=target_relative_path,
                size_bytes=size_bytes,
                sha256=digest,
                role=role,
                path=path,
            )
        )

    if file_count != len(files):
        raise ValueError(f"stage fileCount mismatch: expected {file_count}, found {len(files)}")
    if total_bytes != sum(entry.size_bytes for entry in files):
        raise ValueError("stage totalBytes mismatch")
    if source_paths != sorted(source_paths) or len(source_paths) != len(set(source_paths)):
        raise ValueError("stage files must have unique source paths in sorted order")
    primary = [entry for entry in files if entry.role == "primary_capture"]
    if len(primary) != 1 or primary[0].path.suffix.lower() != ".e57":
        raise ValueError("stage must contain exactly one primary E57 capture")
    return StageContext(
        root=root,
        manifest_path=manifest_path,
        plan_sha256=plan_sha256,
        source_root=source_root,
        files=tuple(files),
        primary_e57=primary[0],
    )


def verify_stage_file(entry: StageFile) -> None:
    actual = sha256_file(entry.path)
    if actual != entry.sha256:
        raise ValueError(
            f"stage SHA-256 drift for {entry.target_relative_path}: expected {entry.sha256}, got {actual}"
        )


def load_truth_panos(
    stage: StageContext,
    truth_root: Path,
    truth_manifest_path: Path,
) -> TruthPanoContext:
    truth_input = truth_root.expanduser()
    if _is_link_or_reparse(truth_input):
        raise ValueError("truth panorama root cannot be a symbolic link or reparse point")
    root = truth_input.resolve(strict=True)
    if not root.is_dir():
        raise ValueError(f"truth panorama root is not a directory: {root}")
    manifest_input = truth_manifest_path.expanduser()
    if not manifest_input.is_absolute():
        manifest_input = truth_input / manifest_input
    manifest_input = manifest_input.absolute()
    try:
        manifest_relative = manifest_input.relative_to(root).as_posix()
    except ValueError as error:
        raise ValueError("truth manifest must be contained by the truth panorama root") from error
    manifest_path = _resolve_relative_file(root, manifest_relative, "truth panorama manifest")
    raw = _require_dict(json.loads(manifest_path.read_text(encoding="utf-8")), "truth manifest")
    _require_exact_keys(
        raw,
        {
            "schemaVersion",
            "provenanceStatus",
            "sourceE57Sha256",
            "sourceE57SizeBytes",
            "generator",
            "panos",
        },
        "truth manifest",
    )
    if raw["schemaVersion"] != LIDAR_TRUTH_SCHEMA_VERSION:
        raise ValueError(f"unsupported truth panorama schema: {raw['schemaVersion']!r}")
    if raw["provenanceStatus"] != "regenerated_from_staged_e57":
        raise ValueError("truth panoramas must be regenerated from the staged E57")
    if _require_sha256(raw["sourceE57Sha256"], "truth sourceE57Sha256") != stage.primary_e57.sha256:
        raise ValueError("truth panoramas cite a different E57 digest")
    if (
        _require_nonnegative_int(raw["sourceE57SizeBytes"], "truth sourceE57SizeBytes")
        != stage.primary_e57.size_bytes
    ):
        raise ValueError("truth panoramas cite a different E57 byte count")
    generator = _require_dict(raw["generator"], "truth generator")
    _require_exact_keys(generator, {"name", "version", "parametersSha256"}, "truth generator")
    generator_name = _require_nonempty_string(generator["name"], "truth generator.name")
    generator_version = _require_nonempty_string(generator["version"], "truth generator.version")
    parameters_sha256 = _require_sha256(
        generator["parametersSha256"], "truth generator.parametersSha256"
    )
    if not isinstance(raw["panos"], list) or not raw["panos"]:
        raise ValueError("truth panos must be a non-empty array")

    panos: list[TruthPano] = []
    for index, value in enumerate(raw["panos"]):
        item = _require_dict(value, f"truth panos[{index}]")
        _require_exact_keys(
            item,
            {"scanIndex", "relativePath", "sizeBytes", "sha256", "width", "height"},
            f"truth panos[{index}]",
        )
        scan_index = _require_nonnegative_int(item["scanIndex"], f"truth panos[{index}].scanIndex")
        relative_path = _require_nonempty_string(
            item["relativePath"], f"truth panos[{index}].relativePath"
        )
        expected_name = f"scan_{scan_index:03d}.jpg"
        if relative_path != expected_name:
            raise ValueError(
                f"truth panos[{index}].relativePath must be {expected_name!r}"
            )
        path = _resolve_relative_file(root, relative_path, f"truth panos[{index}]")
        size_bytes = _require_nonnegative_int(item["sizeBytes"], f"truth panos[{index}].sizeBytes")
        if path.stat().st_size != size_bytes:
            raise ValueError(f"truth panorama size drift for {relative_path}")
        width = _require_nonnegative_int(item["width"], f"truth panos[{index}].width")
        height = _require_nonnegative_int(item["height"], f"truth panos[{index}].height")
        if width <= 0 or height <= 0:
            raise ValueError(f"truth panorama dimensions must be positive for {relative_path}")
        panos.append(
            TruthPano(
                scan_index=scan_index,
                relative_path=relative_path,
                size_bytes=size_bytes,
                sha256=_require_sha256(item["sha256"], f"truth panos[{index}].sha256"),
                width=width,
                height=height,
            )
        )
    indices = [pano.scan_index for pano in panos]
    if indices != sorted(indices) or len(indices) != len(set(indices)):
        raise ValueError("truth panos must have unique scan indices in sorted order")
    return TruthPanoContext(
        root=root,
        manifest_path=manifest_path,
        manifest_sha256=sha256_file(manifest_path),
        generator_name=generator_name,
        generator_version=generator_version,
        generator_parameters_sha256=parameters_sha256,
        panos=tuple(panos),
    )


def verify_truth_panos(truth: TruthPanoContext, scan_indices: Iterable[int]) -> None:
    by_index = {pano.scan_index: pano for pano in truth.panos}
    missing = sorted(set(scan_indices) - set(by_index))
    if missing:
        raise ValueError(f"truth panorama manifest is missing scans: {missing}")
    for scan_index in sorted(set(scan_indices)):
        pano = by_index[scan_index]
        path = _resolve_relative_file(truth.root, pano.relative_path, "truth panorama")
        actual = sha256_file(path)
        if actual != pano.sha256:
            raise ValueError(
                f"truth panorama SHA-256 drift for {pano.relative_path}: expected {pano.sha256}, got {actual}"
            )


def require_finite_vector(values: Iterable[Any], length: int, label: str) -> list[float]:
    result = [float(value) for value in values]
    if len(result) != length or not all(math.isfinite(value) for value in result):
        raise ValueError(f"{label} must contain {length} finite numbers")
    return result
