"""Strict authority-none panorama to native E57 Image2D candidate evidence.

This module owns custody, schemas, deterministic ranking and transactional
publication.  It deliberately has no OpenCV import: a pinned boundary adapter
supplies content-derived descriptors and diagnostic spherical verification.
"""

from __future__ import annotations

import base64
import binascii
import csv
from dataclasses import asdict, dataclass
import hashlib
import io
import json
import math
import os
from pathlib import Path, PurePosixPath
import platform
import re
import stat
import subprocess
import sys
import tarfile
import zipfile
from typing import Any, Callable, Protocol, Sequence

from e57_image2d_evidence import (
    CaptureIdentity,
    DecodedJpeg,
    EvidenceProfile,
    GRAND_HALL_PROFILE,
    canonical_json_bytes,
    load_canonical_json,
    publication_stage,
    sha256_file,
    verify_evidence_pack,
)


MATRIX_SCHEMA = "venviewer.panorama-e57-retrieval-matrix-authority-none.v1"
CROSSWALK_SCHEMA = "venviewer.panorama-e57-candidate-crosswalk-authority-none.v1"
RECEIPT_SCHEMA = "venviewer.panorama-e57-crosswalk-publication-authority-none.v1"
MATRIX_NAME = "candidate-score-matrix-authority-none.json"
CROSSWALK_NAME = "panorama-image2d-crosswalk-authority-none.json"
RECEIPT_NAME = "publication-receipt.json"
DEPENDENCY_SCHEMA = "venviewer.panorama-e57-crosswalk-dependencies.v1"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
GIT_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
PANORAMA_NAME_RE = re.compile(r"^sweep_(\d+)(jpg|pg)\.jpg$", re.IGNORECASE)
GENERATOR_PATHS = (
    "tools/twin-forge/e57-scripts/panorama_image2d_crosswalk.py",
    "tools/twin-forge/e57-scripts/build_panorama_image2d_crosswalk.py",
    "tools/twin-forge/e57-scripts/e57_image2d_evidence.py",
    "tools/twin-forge/e57-scripts/e57_stage_guard.py",
)
DEPENDENCY_LOCK_RELATIVE_PATH = "tools/twin-forge/e57-scripts/requirements-panorama-image2d-crosswalk.lock.json"
DEPENDENCY_IMPORT_ORIGIN_MEMBERS = {
    "numpy": "numpy/__init__.py",
    "opencv-python-headless": "cv2/__init__.py",
}
PYTHON_PROVENANCE_KEYS = {
    "pythonBaseCompleteFileCount",
    "pythonBaseCompleteTreeSha256",
    "pythonDistributionArchiveRelativePath",
    "pythonDistributionArchiveSha256",
    "pythonDistributionArchiveSizeBytes",
    "pythonDistributionLicenseRelativePath",
    "pythonDistributionLicenseSha256",
    "pythonDistributionLicenseSizeBytes",
    "pythonDistributionSourceUrl",
}


@dataclass(frozen=True)
class CrosswalkProfile:
    panorama_count: int
    data3d_count: int
    faces_per_data3d: int
    panorama_width: int
    panorama_height: int
    panorama_manifest_sha256: str
    panorama_manifest_size_bytes: int
    panorama_manifest_self_sha256: str
    panorama_inventory_sha256: str
    image2d_manifest_sha256: str
    image2d_manifest_size_bytes: int
    image2d_receipt_sha256: str
    image2d_receipt_size_bytes: int
    image2d_profile: EvidenceProfile


GRAND_HALL_CROSSWALK_PROFILE = CrosswalkProfile(
    panorama_count=148,
    data3d_count=149,
    faces_per_data3d=6,
    panorama_width=8192,
    panorama_height=4096,
    panorama_manifest_sha256="2c8b44ef2cd840fddc3f0a49e82b73fff37b33f1d546126ed941029c1cb52b86",
    panorama_manifest_size_bytes=208_604,
    panorama_manifest_self_sha256="4c23c3374dabd64e158c179ffaa38b32ae40876aaaf9da5f16ee57093f88f5bc",
    panorama_inventory_sha256="949f4cbf365f33d47c5e75f46b881aff857695fbbb70879e27c4f23f4b2af176",
    image2d_manifest_sha256="fd13da9638d1a1e194fb0c1acaedbe07dea15e65d9c16353d29f6542ce3ad344",
    image2d_manifest_size_bytes=663_151,
    image2d_receipt_sha256="a19b4058ab6006744184101d0b8287f14a64390065743dc5ff63fb73fa882415",
    image2d_receipt_size_bytes=600,
    image2d_profile=GRAND_HALL_PROFILE,
)


@dataclass(frozen=True)
class FileSnapshot:
    device: int
    inode: int
    mode: int
    size_bytes: int
    modified_ns: int
    changed_ns: int


@dataclass(frozen=True)
class InputCustody:
    file_snapshots: tuple[tuple[Path, FileSnapshot], ...]
    file_sha256: tuple[tuple[Path, str], ...]
    directory_inventories: tuple[tuple[Path, tuple[str, ...]], ...]


@dataclass(frozen=True)
class PanoramaSource:
    sha256: str
    size_bytes: int
    width: int
    height: int
    path: Path
    snapshot: FileSnapshot
    relative_path: str
    display_sweep_number: int
    display_digit_token: str


@dataclass(frozen=True)
class Intrinsics:
    width: int
    height: int
    focal_length: float
    pixel_width: float
    pixel_height: float
    principal_point_x: float
    principal_point_y: float


@dataclass(frozen=True)
class FaceSource:
    sha256: str
    face_index: int
    path: Path
    snapshot: FileSnapshot
    intrinsics: Intrinsics


@dataclass(frozen=True)
class Data3DSource:
    guid: str
    faces: tuple[FaceSource, ...]
    display_scan_index: int


@dataclass(frozen=True)
class FeatureArtifact:
    identity_sha256: str
    width: int
    height: int
    points: object
    descriptors: object


@dataclass(frozen=True)
class FaceFeature:
    face_sha256: str
    face_index: int
    intrinsics: Intrinsics
    feature: FeatureArtifact


@dataclass(frozen=True)
class ScanFeature:
    data3d_guid: str
    faces: tuple[FaceFeature, ...]


@dataclass(frozen=True)
class PanoramaFeature:
    panorama_sha256: str
    feature: FeatureArtifact


@dataclass(frozen=True)
class RetrievalScore:
    panorama_sha256: str
    data3d_guid: str
    score_micros: int
    match_count: int


@dataclass(frozen=True)
class CandidateVerification:
    panorama_sha256: str
    data3d_guid: str
    spherical_inliers: int
    supported_faces: int
    ratio_matches: int
    median_residual_microdegrees: int | None
    p95_residual_microdegrees: int | None
    global_reflection_applied: bool | None
    cube_coherent: bool
    face_inlier_counts: tuple[tuple[int, int], ...]


@dataclass(frozen=True)
class RankingPolicy:
    row_shortlist_count: int = 8
    column_shortlist_count: int = 8
    minimum_inliers: int = 100
    minimum_supported_faces: int = 3
    minimum_ratio_matches: int = 100
    minimum_inlier_delta: int = 100
    minimum_inlier_ratio_micros: int = 1_250_000


@dataclass(frozen=True)
class DetectorConfiguration:
    face_feature_limit: int
    face_max_width: int
    panorama_feature_limit: int
    panorama_max_width: int
    contrast_threshold_micros: int
    edge_threshold: int
    sigma_micros: int


@dataclass(frozen=True)
class RetrievalConfiguration:
    distance_threshold_micros: int
    flann_checks: int
    flann_trees: int
    nearest_descriptor_count: int
    score_scale: int


@dataclass(frozen=True)
class VerificationConfiguration:
    inlier_threshold_microdegrees: int
    iterations: int
    ratio_micros: int
    supported_face_inliers: int
    allow_global_reflection: bool
    global_reflection_axis: str


@dataclass(frozen=True)
class CubeFaceBasis:
    face_index: int
    forward: tuple[int, int, int]
    right: tuple[int, int, int]
    down: tuple[int, int, int]
    report_consensus_count: int
    report_sweep_count: int


@dataclass(frozen=True)
class CubeBasisProvenance:
    extractor_relative_path: str
    extractor_sha256: str
    extractor_size_bytes: int
    evidence_lines: tuple[int, int]
    report_label: str
    report_sha256: str
    report_size_bytes: int
    selection_rule: str


@dataclass(frozen=True)
class CrosswalkConfiguration:
    detector: DetectorConfiguration
    retrieval: RetrievalConfiguration
    verification: VerificationConfiguration
    ranking: RankingPolicy
    cube_faces: tuple[CubeFaceBasis, ...]
    cube_basis_provenance: CubeBasisProvenance
    determinism_scope: str
    thread_environment: tuple[tuple[str, str], ...]


FROZEN_CONFIGURATION = CrosswalkConfiguration(
    detector=DetectorConfiguration(400, 512, 3500, 2048, 15_000, 12, 1_600_000),
    retrieval=RetrievalConfiguration(260_000_000, 96, 4, 24, 1_000_000),
    verification=VerificationConfiguration(1_500_000, 300, 750_000, 6, True, "scanner_y"),
    ranking=RankingPolicy(),
    cube_faces=(
        CubeFaceBasis(0, (0, 0, 1), (0, -1, 0), (1, 0, 0), 149, 149),
        CubeFaceBasis(1, (1, 0, 0), (0, -1, 0), (0, 0, -1), 149, 149),
        CubeFaceBasis(2, (0, -1, 0), (-1, 0, 0), (0, 0, -1), 149, 149),
        CubeFaceBasis(3, (-1, 0, 0), (0, 1, 0), (0, 0, -1), 149, 149),
        CubeFaceBasis(4, (0, 1, 0), (1, 0, 0), (0, 0, -1), 149, 149),
        CubeFaceBasis(5, (0, 0, -1), (0, -1, 0), (-1, 0, 0), 148, 149),
    ),
    cube_basis_provenance=CubeBasisProvenance(
        "tools/twin-forge/e57-scripts/extract_equirect_v2.py",
        "f6d81da11e8a35c43b891c81ea08f0a2eca2c85f11344de897f47e552b4ed93a",
        33_196,
        (26, 44),
        "historical-capture-workspace/equirect_ss/_equirect_v2_report.json",
        "41ed3df8400b59508bd3dfb6bcbb95b17152edc15670ce32a18ec5f241d76df4",
        286_531,
        "reviewed_modal_proper_basis_per_face; scan_102_face_5_ambiguous_outlier_excluded",
    ),
    determinism_scope="same_host_same_binary_only",
    thread_environment=(("MKL_NUM_THREADS", "1"), ("NUMEXPR_NUM_THREADS", "1"), ("OMP_NUM_THREADS", "1"), ("OPENBLAS_NUM_THREADS", "1")),
)


@dataclass(frozen=True)
class GeneratorFileBinding:
    relative_path: str
    sha256: str
    size_bytes: int


@dataclass(frozen=True)
class GeneratorBinding:
    reviewed_git_sha: str
    files: tuple[GeneratorFileBinding, ...]


@dataclass(frozen=True)
class DependencyPackageAttestation:
    name: str
    installed_file_count: int
    installed_tree_sha256: str
    wheel_sha256: str


@dataclass(frozen=True)
class DependencyAttestation:
    determinism_scope: str
    lock_sha256: str
    packages: tuple[DependencyPackageAttestation, ...]
    runtime_identity_sha256: str


@dataclass(frozen=True)
class DependencyImportPlan:
    installed_versions: dict[str, str]
    distribution_roots: dict[str, Path]
    runtime_file_paths: dict[str, dict[str, Path]]
    runtime_controls: dict[str, Any]
    package_origin_paths: dict[str, Path]
    import_origin_paths: tuple[Path, ...]
    attestation: DependencyAttestation


@dataclass(frozen=True)
class SourceBindings:
    panorama_manifest_sha256: str
    panorama_manifest_size_bytes: int
    panorama_inventory_sha256: str
    image2d_manifest_sha256: str
    image2d_manifest_size_bytes: int
    image2d_receipt_sha256: str
    image2d_receipt_size_bytes: int
    panorama_identity_set_sha256: str
    data3d_identity_set_sha256: str


class MatcherBackend(Protocol):
    configuration: CrosswalkConfiguration
    dependency_versions: dict[str, str]
    distribution_roots: dict[str, Path]
    runtime_controls: dict[str, Any]
    runtime_file_paths: dict[str, dict[str, Path]]

    def decode_jpeg(self, content: bytes) -> DecodedJpeg: ...

    def extract_panorama(self, sha256: str, content: bytes) -> FeatureArtifact: ...

    def extract_face(
        self,
        sha256: str,
        intrinsics: Intrinsics,
        content: bytes,
    ) -> FeatureArtifact: ...

    def complete_retrieval(
        self,
        panoramas: Sequence[PanoramaFeature],
        scans: Sequence[ScanFeature],
    ) -> Sequence[RetrievalScore]: ...

    def verify_candidate(
        self,
        panorama: PanoramaFeature,
        scan: ScanFeature,
    ) -> CandidateVerification: ...


def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _require_sha256(value: Any, label: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{label} must be a lowercase SHA-256 digest")
    normalized = value.removeprefix("sha256:")
    if SHA256_RE.fullmatch(normalized) is None:
        raise ValueError(f"{label} must be a lowercase SHA-256 digest")
    return normalized


def _require_int(value: Any, label: str, positive: bool = False) -> int:
    minimum = 1 if positive else 0
    if not isinstance(value, int) or isinstance(value, bool) or value < minimum:
        qualifier = "positive" if positive else "non-negative"
        raise ValueError(f"{label} must be a {qualifier} integer")
    return value


def _require_finite(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} must be a finite number")
    number = float(value)
    if not math.isfinite(number):
        raise ValueError(f"{label} must be a finite number")
    return number


def _require_dict(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return value


def _require_list(value: Any, label: str) -> list[Any]:
    if not isinstance(value, list):
        raise ValueError(f"{label} must be an array")
    return value


def _reject_constant(value: str) -> None:
    raise ValueError(f"JSON constant is not permitted: {value}")


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def load_strict_json_bytes(content: bytes, label: str) -> dict[str, Any]:
    try:
        decoded = content.decode("utf-8")
        value = json.loads(
            decoded,
            object_pairs_hook=_unique_object,
            parse_constant=_reject_constant,
        )
    except (UnicodeError, json.JSONDecodeError) as error:
        raise ValueError(f"{label} is not strict UTF-8 JSON") from error
    return _require_dict(value, label)


def _is_link_or_reparse(path: Path) -> bool:
    metadata = path.lstat()
    attributes = getattr(metadata, "st_file_attributes", 0)
    reparse = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    return path.is_symlink() or (reparse != 0 and bool(attributes & reparse))


def _snapshot(path: Path) -> FileSnapshot:
    if _is_link_or_reparse(path) or not path.is_file():
        raise ValueError(f"source must be a real regular file: {path.name}")
    metadata = path.stat()
    return FileSnapshot(
        device=metadata.st_dev,
        inode=metadata.st_ino,
        mode=metadata.st_mode,
        size_bytes=metadata.st_size,
        modified_ns=metadata.st_mtime_ns,
        changed_ns=metadata.st_ctime_ns,
    )


def _read_stable_bytes(path: Path, expected: FileSnapshot | None = None) -> bytes:
    before = _snapshot(path)
    if expected is not None and before != expected:
        raise ValueError(f"source identity drifted before read: {path.name}")
    content = path.read_bytes()
    after = _snapshot(path)
    if before != after or len(content) != before.size_bytes:
        raise ValueError(f"source changed during read: {path.name}")
    return content


def _safe_relative_path(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value or "\\" in value:
        raise ValueError(f"{label} must be a canonical relative path")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in ("", ".", "..") for part in path.parts):
        raise ValueError(f"{label} must be a canonical relative path")
    return value


def parse_panorama_display_name(name: str) -> tuple[int, str]:
    match = PANORAMA_NAME_RE.fullmatch(name)
    if match is None:
        raise ValueError(f"unsupported panorama display filename: {name!r}")
    token = match.group(1)
    number = int(token)
    if number <= 0:
        raise ValueError("panorama display sweep number must be positive")
    return number, token


def _panorama_records(manifest: dict[str, Any]) -> tuple[dict[str, Any], list[Any]]:
    if manifest.get("authority") != "none":
        raise ValueError("panorama inventory input must retain authority none")
    bindings = _require_dict(manifest.get("sourceBindings"), "panorama source bindings")
    inventory = _require_dict(bindings.get("panoramaInventory"), "panorama inventory")
    return inventory, _require_list(inventory.get("records"), "panorama inventory records")


def _validate_panorama_manifest(
    content: bytes,
    profile: CrosswalkProfile,
) -> list[Any]:
    if len(content) != profile.panorama_manifest_size_bytes:
        raise ValueError("panorama inventory manifest byte count drifted")
    if sha256_bytes(content) != profile.panorama_manifest_sha256:
        raise ValueError("panorama inventory manifest SHA-256 drifted")
    manifest = load_strict_json_bytes(content, "panorama inventory manifest")
    if _require_sha256(manifest.get("manifestSha256"), "panorama manifest self digest") != profile.panorama_manifest_self_sha256:
        raise ValueError("panorama inventory manifest self-digest drifted")
    inventory, records = _panorama_records(manifest)
    if _require_sha256(inventory.get("inventorySha256"), "panorama inventory digest") != profile.panorama_inventory_sha256:
        raise ValueError("panorama inventory digest drifted")
    if _require_int(inventory.get("fileCount"), "panorama file count") != profile.panorama_count:
        raise ValueError("panorama inventory file count drifted")
    if len(records) != profile.panorama_count:
        raise ValueError("panorama inventory records are incomplete")
    return records


def _panorama_record(
    root: Path,
    raw: Any,
    profile: CrosswalkProfile,
    decoder: Callable[[bytes], DecodedJpeg],
) -> PanoramaSource:
    record = _require_dict(raw, "panorama inventory record")
    relative = _safe_relative_path(record.get("relativePath"), "panorama relative path")
    number, token = parse_panorama_display_name(PurePosixPath(relative).name)
    if record.get("sweepNumber") != number or record.get("digitToken") != token:
        raise ValueError("panorama display metadata disagrees with its full filename token")
    path = root / PurePosixPath(relative)
    snapshot = _snapshot(path)
    content = _read_stable_bytes(path, snapshot)
    digest = _require_sha256(record.get("sha256"), "panorama record SHA-256")
    size = _require_int(record.get("byteLength"), "panorama byte length", positive=True)
    decoded = decoder(content)
    if len(content) != size or sha256_bytes(content) != digest:
        raise ValueError(f"panorama bytes drifted: {relative}")
    if decoded.format != "JPEG" or decoded.width != profile.panorama_width:
        raise ValueError(f"panorama JPEG contract drifted: {relative}")
    if decoded.height != profile.panorama_height:
        raise ValueError(f"panorama JPEG dimensions drifted: {relative}")
    return PanoramaSource(digest, size, decoded.width, decoded.height, path, snapshot, relative, number, token)


def _directory_files(root: Path) -> set[str]:
    if _is_link_or_reparse(root) or not root.is_dir():
        raise ValueError("source root must be a real directory")
    entries = list(root.iterdir())
    if any(_is_link_or_reparse(path) or not path.is_file() for path in entries):
        raise ValueError("source root contains a linked or non-regular entry")
    return {path.name for path in entries}


def _tree_inventory(root: Path) -> tuple[str, ...]:
    if _is_link_or_reparse(root) or not root.is_dir():
        raise ValueError("custody root must be a real directory")
    result: list[str] = []
    for directory, names, files in os.walk(root, followlinks=False):
        current = Path(directory)
        for name in sorted(names):
            path = current / name
            if _is_link_or_reparse(path) or not path.is_dir():
                raise ValueError("custody inventory contains a linked directory")
            result.append(path.relative_to(root).as_posix() + "/")
        for name in sorted(files):
            path = current / name
            if _is_link_or_reparse(path) or not path.is_file():
                raise ValueError("custody inventory contains a linked file")
            result.append(path.relative_to(root).as_posix())
    return tuple(sorted(result))


def capture_input_custody(
    panorama_root: Path,
    panorama_manifest: Path,
    image2d_root: Path,
) -> InputCustody:
    files = (panorama_manifest, image2d_root / "image2d-inventory-authority-none.json", image2d_root / RECEIPT_NAME)
    snapshots = tuple((path, _snapshot(path)) for path in files)
    digests = tuple((path, sha256_bytes(_read_stable_bytes(path, snapshot))) for path, snapshot in snapshots)
    inventories = ((panorama_root, _tree_inventory(panorama_root)), (image2d_root, _tree_inventory(image2d_root)))
    return InputCustody(snapshots, digests, inventories)


def verify_input_custody(custody: InputCustody) -> None:
    _verify_custody_metadata(custody)


def _verify_custody_metadata(custody: InputCustody) -> None:
    for path, expected in custody.file_snapshots:
        if _snapshot(path) != expected:
            raise ValueError(f"input custody file drifted: {path.name}")
    for root, expected in custody.directory_inventories:
        if _tree_inventory(root) != expected:
            raise ValueError(f"input custody inventory drifted: {root.name}")


def verify_input_source_hashes(
    panoramas: Sequence[PanoramaSource],
    scans: Sequence[Data3DSource],
) -> None:
    for source in panoramas:
        content = _read_stable_bytes(source.path, source.snapshot)
        if sha256_bytes(content) != source.sha256:
            raise ValueError(f"panorama custody SHA-256 drifted: {source.relative_path}")
    for scan in scans:
        for face in scan.faces:
            content = _read_stable_bytes(face.path, face.snapshot)
            if sha256_bytes(content) != face.sha256:
                raise ValueError("Image2D custody SHA-256 drifted")


def verify_final_input_custody(
    custody: InputCustody,
    panoramas: Sequence[PanoramaSource],
    scans: Sequence[Data3DSource],
) -> None:
    _verify_custody_metadata(custody)
    for path, digest in custody.file_sha256:
        if sha256_bytes(_read_stable_bytes(path)) != digest:
            raise ValueError(f"input custody file SHA-256 drifted: {path.name}")
    verify_input_source_hashes(panoramas, scans)
    _verify_custody_metadata(custody)


def collect_stable_panorama_inventory(
    root: Path,
    manifest_path: Path,
    profile: CrosswalkProfile,
    decoder: Callable[[bytes], DecodedJpeg],
) -> list[PanoramaSource]:
    manifest_snapshot = _snapshot(manifest_path)
    records = _validate_panorama_manifest(
        _read_stable_bytes(manifest_path, manifest_snapshot), profile
    )
    declared = {_safe_relative_path(_require_dict(raw, "panorama record").get("relativePath"), "panorama relative path") for raw in records}
    if _directory_files(root) != declared:
        raise ValueError("panorama directory inventory differs from the exact manifest")
    sources = [_panorama_record(root, raw, profile, decoder) for raw in records]
    if len({source.sha256 for source in sources}) != len(sources):
        raise ValueError("panorama byte identities must be unique")
    if _snapshot(manifest_path) != manifest_snapshot or _directory_files(root) != declared:
        raise ValueError("panorama inventory changed during collection")
    verify_source_snapshots(sources, ())
    return sorted(sources, key=lambda source: source.sha256)


def _capture_identity(manifest: dict[str, Any]) -> CaptureIdentity:
    source = _require_dict(manifest.get("source"), "Image2D manifest source")
    return CaptureIdentity(
        capture_stage_plan_sha256=_require_sha256(source.get("captureStagePlanSha256"), "capture plan digest"),
        e57_target_relative_path=_safe_relative_path(source.get("e57TargetRelativePath"), "E57 target path"),
        e57_size_bytes=_require_int(source.get("e57SizeBytes"), "E57 size", positive=True),
        e57_sha256=_require_sha256(source.get("e57Sha256"), "E57 digest"),
    )


def _intrinsics(record: dict[str, Any]) -> Intrinsics:
    result = Intrinsics(
        width=_require_int(record.get("width"), "Image2D width", positive=True),
        height=_require_int(record.get("height"), "Image2D height", positive=True),
        focal_length=_require_finite(record.get("focalLength"), "Image2D focal length"),
        pixel_width=_require_finite(record.get("pixelWidth"), "Image2D pixel width"),
        pixel_height=_require_finite(record.get("pixelHeight"), "Image2D pixel height"),
        principal_point_x=_require_finite(record.get("principalPointX"), "principal point X"),
        principal_point_y=_require_finite(record.get("principalPointY"), "principal point Y"),
    )
    if min(result.focal_length, result.pixel_width, result.pixel_height) <= 0:
        raise ValueError("Image2D intrinsic scales must be positive")
    return result


def _data3d_sources(root: Path, manifest: dict[str, Any], profile: CrosswalkProfile) -> list[Data3DSource]:
    data3d = _require_list(manifest.get("data3D"), "Image2D Data3D records")
    images = _require_list(manifest.get("images"), "Image2D image records")
    if len(data3d) != profile.data3d_count:
        raise ValueError("Image2D Data3D count drifted")
    grouped: dict[str, list[FaceSource]] = {}
    display: dict[str, int] = {}
    for raw in data3d:
        record = _require_dict(raw, "Data3D record")
        guid = str(record.get("guid", ""))
        if not guid or guid in grouped:
            raise ValueError("Data3D GUIDs must be unique non-empty strings")
        grouped[guid] = []
        display[guid] = _require_int(record.get("scanIndex"), "display scan index")
    for raw in images:
        _append_face_source(root, _require_dict(raw, "Image2D record"), grouped)
    return _finish_data3d_sources(grouped, display, profile)


def _append_face_source(root: Path, record: dict[str, Any], grouped: dict[str, list[FaceSource]]) -> None:
    guid = str(record.get("associatedData3DGuid", ""))
    if guid not in grouped:
        raise ValueError("Image2D associatedData3DGuid is unknown")
    relative = _safe_relative_path(record.get("relativePath"), "Image2D relative path")
    path = root / PurePosixPath(relative)
    snapshot = _snapshot(path)
    digest = _require_sha256(record.get("sha256"), "Image2D SHA-256")
    face_index = _require_int(record.get("faceIndex"), "Image2D face index")
    if snapshot.size_bytes != _require_int(record.get("sizeBytes"), "Image2D size", positive=True):
        raise ValueError("Image2D snapshot size drifted")
    grouped[guid].append(FaceSource(digest, face_index, path, snapshot, _intrinsics(record)))


def _finish_data3d_sources(
    grouped: dict[str, list[FaceSource]],
    display: dict[str, int],
    profile: CrosswalkProfile,
) -> list[Data3DSource]:
    result = []
    seen_faces: set[str] = set()
    for guid in sorted(grouped):
        faces = sorted(grouped[guid], key=lambda face: face.face_index)
        if len(faces) != profile.faces_per_data3d:
            raise ValueError("Data3D source lacks the exact native face count")
        if {face.face_index for face in faces} != set(range(profile.faces_per_data3d)):
            raise ValueError("Data3D source lacks the exact native face-index set")
        if any(face.sha256 in seen_faces for face in faces):
            raise ValueError("Image2D face byte identities must be unique")
        seen_faces.update(face.sha256 for face in faces)
        result.append(Data3DSource(guid, tuple(faces), display[guid]))
    return result


def load_verified_image2d_evidence(
    root: Path,
    profile: CrosswalkProfile,
    decoder: Callable[[bytes], DecodedJpeg],
) -> list[Data3DSource]:
    manifest_path = root / "image2d-inventory-authority-none.json"
    receipt_path = root / RECEIPT_NAME
    if manifest_path.stat().st_size != profile.image2d_manifest_size_bytes:
        raise ValueError("accepted Image2D manifest byte count drifted")
    if receipt_path.stat().st_size != profile.image2d_receipt_size_bytes:
        raise ValueError("accepted Image2D receipt byte count drifted")
    if sha256_file(manifest_path) != profile.image2d_manifest_sha256:
        raise ValueError("accepted Image2D manifest digest drifted")
    if sha256_file(receipt_path) != profile.image2d_receipt_sha256:
        raise ValueError("accepted Image2D receipt digest drifted")
    manifest = load_canonical_json(manifest_path, "accepted Image2D manifest")
    verified = verify_evidence_pack(root, _capture_identity(manifest), profile.image2d_profile, decoder)
    if verified != manifest:
        raise ValueError("accepted Image2D manifest changed during verification")
    sources = _data3d_sources(root, manifest, profile)
    verify_source_snapshots((), sources)
    return sources


def verify_source_snapshots(
    panoramas: Sequence[PanoramaSource],
    scans: Sequence[Data3DSource],
) -> None:
    for source in panoramas:
        if _snapshot(source.path) != source.snapshot:
            raise ValueError(f"panorama source drifted: {source.relative_path}")
    for scan in scans:
        for face in scan.faces:
            if _snapshot(face.path) != face.snapshot:
                raise ValueError("Image2D source drifted after verified pack loading")


def build_panorama_descriptor(source: PanoramaSource, backend: MatcherBackend) -> PanoramaFeature:
    content = _read_stable_bytes(source.path, source.snapshot)
    if sha256_bytes(content) != source.sha256:
        raise ValueError("panorama feature bytes differ from their exact SHA-256 identity")
    feature = backend.extract_panorama(source.sha256, content)
    if feature.identity_sha256 != source.sha256:
        raise ValueError("panorama descriptor identity drifted")
    return PanoramaFeature(source.sha256, feature)


def build_native_scan_descriptor(source: Data3DSource, backend: MatcherBackend) -> ScanFeature:
    faces = []
    for face in source.faces:
        content = _read_stable_bytes(face.path, face.snapshot)
        if sha256_bytes(content) != face.sha256:
            raise ValueError("Image2D feature bytes differ from their exact SHA-256 identity")
        feature = backend.extract_face(face.sha256, face.intrinsics, content)
        if feature.identity_sha256 != face.sha256:
            raise ValueError("Image2D descriptor identity drifted")
        faces.append(FaceFeature(face.sha256, face.face_index, face.intrinsics, feature))
    return ScanFeature(source.guid, tuple(sorted(faces, key=lambda item: item.face_index)))


def score_complete_candidate_matrix(
    panoramas: Sequence[PanoramaFeature],
    scans: Sequence[ScanFeature],
    backend: MatcherBackend,
) -> list[RetrievalScore]:
    panorama_ids = {item.panorama_sha256 for item in panoramas}
    scan_ids = {item.data3d_guid for item in scans}
    if len(panorama_ids) != len(panoramas) or len(scan_ids) != len(scans):
        raise ValueError("feature identities must be unique")
    raw = list(backend.complete_retrieval(panoramas, scans))
    expected = {(panorama, scan) for panorama in panorama_ids for scan in scan_ids}
    actual = {(item.panorama_sha256, item.data3d_guid) for item in raw}
    if len(raw) != len(actual) or actual != expected:
        raise ValueError("retrieval backend did not emit the complete candidate universe")
    for item in raw:
        _require_int(item.score_micros, "retrieval score")
        _require_int(item.match_count, "retrieval match count")
    return sorted(raw, key=lambda item: (item.panorama_sha256, item.data3d_guid))


def _row_sort_key(score: RetrievalScore) -> tuple[int, int, str]:
    return (-score.score_micros, -score.match_count, score.data3d_guid)


def _column_sort_key(score: RetrievalScore) -> tuple[int, int, str]:
    return (-score.score_micros, -score.match_count, score.panorama_sha256)


def select_bidirectional_shortlist(
    scores: Sequence[RetrievalScore],
    policy: RankingPolicy,
) -> list[tuple[str, str]]:
    rows: dict[str, list[RetrievalScore]] = {}
    columns: dict[str, list[RetrievalScore]] = {}
    for score in scores:
        rows.setdefault(score.panorama_sha256, []).append(score)
        columns.setdefault(score.data3d_guid, []).append(score)
    selected: set[tuple[str, str]] = set()
    for panorama, values in rows.items():
        for score in sorted(values, key=_row_sort_key)[: policy.row_shortlist_count]:
            selected.add((panorama, score.data3d_guid))
    for guid, values in columns.items():
        for score in sorted(values, key=_column_sort_key)[: policy.column_shortlist_count]:
            selected.add((score.panorama_sha256, guid))
    return sorted(selected)


def verify_shortlist_candidates(
    shortlist: Sequence[tuple[str, str]],
    panoramas: Sequence[PanoramaFeature],
    scans: Sequence[ScanFeature],
    backend: MatcherBackend,
) -> list[CandidateVerification]:
    panorama_by_id = {item.panorama_sha256: item for item in panoramas}
    scan_by_id = {item.data3d_guid: item for item in scans}
    results = [
        backend.verify_candidate(panorama_by_id[panorama], scan_by_id[guid])
        for panorama, guid in shortlist
    ]
    identities = {(item.panorama_sha256, item.data3d_guid) for item in results}
    if len(shortlist) != len(set(shortlist)) or len(results) != len(identities) or identities != set(shortlist):
        raise ValueError("candidate verifier returned incomplete or drifted identities")
    for result in results:
        _validate_verification(result)
    return sorted(results, key=lambda item: (item.panorama_sha256, item.data3d_guid))


def _validate_verification(value: CandidateVerification) -> None:
    for field in (value.spherical_inliers, value.supported_faces, value.ratio_matches):
        _require_int(field, "candidate verification count")
    for residual in (value.median_residual_microdegrees, value.p95_residual_microdegrees):
        if residual is not None:
            _require_int(residual, "candidate residual")
    if (value.median_residual_microdegrees is None) != (value.p95_residual_microdegrees is None):
        raise ValueError("candidate residual metrics must be jointly present or absent")
    if value.median_residual_microdegrees is not None and value.median_residual_microdegrees > value.p95_residual_microdegrees:
        raise ValueError("candidate median residual exceeds p95 residual")
    if not isinstance(value.cube_coherent, bool):
        raise ValueError("candidate cube-coherence flag must be boolean")
    if value.global_reflection_applied is not None and not isinstance(value.global_reflection_applied, bool):
        raise ValueError("candidate global-reflection flag must be boolean or null")
    if len(value.face_inlier_counts) != 6 or {index for index, _ in value.face_inlier_counts} != set(range(6)):
        raise ValueError("candidate face inliers must preserve all six face indices")
    for _, count in value.face_inlier_counts:
        _require_int(count, "candidate face inlier count")
    if sum(count for _, count in value.face_inlier_counts) != value.spherical_inliers:
        raise ValueError("candidate spherical inliers differ from per-face counts")
    supported = sum(count >= FROZEN_CONFIGURATION.verification.supported_face_inliers for _, count in value.face_inlier_counts)
    if supported != value.supported_faces:
        raise ValueError("candidate supported-face count differs from per-face counts")
    coherent = supported >= FROZEN_CONFIGURATION.ranking.minimum_supported_faces
    if value.cube_coherent != coherent or (value.global_reflection_applied is None) != (value.spherical_inliers == 0):
        raise ValueError("candidate cube-coherence or global-model consistency drifted")


def _supported(value: CandidateVerification, policy: RankingPolicy) -> bool:
    return (
        value.cube_coherent
        and
        value.spherical_inliers >= policy.minimum_inliers
        and value.supported_faces >= policy.minimum_supported_faces
        and value.ratio_matches >= policy.minimum_ratio_matches
    )


def _verification_sort_key(value: CandidateVerification) -> tuple[int, int, int, str]:
    return (
        -value.spherical_inliers,
        -value.supported_faces,
        -value.ratio_matches,
        value.data3d_guid,
    )


def _candidate_metrics(
    verification: CandidateVerification,
    retrieval: RetrievalScore,
    policy: RankingPolicy,
) -> dict[str, Any]:
    return {
        "data3DGuid": verification.data3d_guid,
        "cubeCoherent": verification.cube_coherent,
        "diagnosticModel": "single_scan_wide_cubemap_to_equirect_orthogonal_model_no_pose_authority",
        "faceInlierCounts": [{"faceIndex": index, "inlierCount": count} for index, count in verification.face_inlier_counts],
        "globalReflectionApplied": verification.global_reflection_applied,
        "medianResidualMicrodegrees": verification.median_residual_microdegrees,
        "p95ResidualMicrodegrees": verification.p95_residual_microdegrees,
        "ratioMatchCount": verification.ratio_matches,
        "retrievalMatchCount": retrieval.match_count,
        "retrievalScoreMicros": retrieval.score_micros,
        "sphericalInlierCount": verification.spherical_inliers,
        "supported": _supported(verification, policy),
        "supportedFaceCount": verification.supported_faces,
    }


def _row_state(values: list[CandidateVerification], policy: RankingPolicy) -> tuple[str, str | None]:
    supported = [value for value in values if _supported(value, policy)]
    if not supported:
        return "no_supported_candidate", None
    first = supported[0]
    if len(supported) == 1:
        return "candidate_human_pending", first.data3d_guid
    second = supported[1]
    delta = first.spherical_inliers - second.spherical_inliers
    ratio = first.spherical_inliers * 1_000_000 // max(1, second.spherical_inliers)
    if delta < policy.minimum_inlier_delta or ratio < policy.minimum_inlier_ratio_micros:
        return "ambiguous_human_pending", None
    return "candidate_human_pending", first.data3d_guid


def _apply_column_collisions(
    rows: list[dict[str, Any]],
) -> None:
    selected: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        if row["candidateData3DGuid"] is not None:
            selected.setdefault(row["candidateData3DGuid"], []).append(row)
    for competing in selected.values():
        if len(competing) < 2:
            continue
        for row in competing:
            row["ambiguityReasons"].append("duplicate_data3d_selection")
            row["candidateData3DGuid"] = None
            row["state"] = "ambiguous_human_pending"


def rank_candidate_correspondences(
    panorama_ids: Sequence[str],
    scores: Sequence[RetrievalScore],
    verifications: Sequence[CandidateVerification],
    policy: RankingPolicy,
) -> list[dict[str, Any]]:
    retrieval = {(item.panorama_sha256, item.data3d_guid): item for item in scores}
    grouped: dict[str, list[CandidateVerification]] = {identity: [] for identity in panorama_ids}
    for item in verifications:
        if item.panorama_sha256 not in grouped:
            raise ValueError("candidate verification cites an unknown panorama")
        grouped[item.panorama_sha256].append(item)
    results = []
    for identity in sorted(grouped):
        ranked = sorted(grouped[identity], key=_verification_sort_key)
        state, candidate = _row_state(ranked, policy)
        results.append(
            {
                "ambiguityReasons": [] if state == "candidate_human_pending" else ["row_score_ambiguous"] if state == "ambiguous_human_pending" else [],
                "candidateData3DGuid": candidate,
                "candidates": [_candidate_metrics(item, retrieval[(identity, item.data3d_guid)], policy) for item in ranked],
                "humanReviewRequired": True,
                "panoramaSha256": identity,
                "state": state,
            }
        )
    _apply_column_collisions(results)
    return results


def _authority_contract() -> dict[str, Any]:
    return {
        "cameraPoseAuthority": "none",
        "collisionAuthority": False,
        "correspondenceAuthority": "candidate_feature_match_unverified",
        "diagnosticRasterRotationAuthority": "none",
        "exportAuthority": False,
        "generatedContent": False,
        "geometryAuthority": "none",
        "maskAuthority": "none",
        "publicAuthority": False,
        "reconstructionAuthority": False,
        "roomMembershipAuthority": "none",
        "runtimeAuthority": False,
        "sequenceAssumptionUsed": False,
        "structuralAuthority": False,
        "trainingAuthority": False,
        "transformAuthority": "none",
    }


def _identity_digest(value: Any) -> str:
    return sha256_bytes(canonical_json_bytes(value))


def configuration_json(configuration: CrosswalkConfiguration) -> dict[str, Any]:
    if configuration != FROZEN_CONFIGURATION:
        raise ValueError("crosswalk behavior must use the frozen reviewed configuration")
    parameters = json.loads(canonical_json_bytes(asdict(configuration)))
    return {
        "authority": "none",
        "parameters": parameters,
        "schemaVersion": "venviewer.panorama-e57-crosswalk-configuration.v1",
    }


def configuration_digest(configuration: CrosswalkConfiguration) -> str:
    return _identity_digest(configuration_json(configuration))


def _require_git_sha(value: Any, label: str) -> str:
    if not isinstance(value, str) or GIT_SHA_RE.fullmatch(value) is None:
        raise ValueError(f"{label} must be a lowercase full Git SHA")
    return value


def _git_output(repo_root: Path, arguments: Sequence[str]) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo_root), *arguments],
        check=False,
        capture_output=True,
        encoding="utf-8",
        errors="strict",
    )
    if result.returncode != 0:
        raise ValueError(f"Git provenance check failed: {result.stderr.strip()}")
    return result.stdout.strip()


def capture_generator_binding(repo_root: Path, reviewed_git_sha: str) -> GeneratorBinding:
    reviewed = _require_git_sha(reviewed_git_sha, "reviewed Git SHA")
    if _git_output(repo_root, ["rev-parse", "HEAD"]) != reviewed:
        raise ValueError("reviewed Git SHA is not the checked-out commit")
    evidence_path = FROZEN_CONFIGURATION.cube_basis_provenance.extractor_relative_path
    tracked = (*GENERATOR_PATHS, DEPENDENCY_LOCK_RELATIVE_PATH, evidence_path)
    _git_output(repo_root, ["ls-files", "--error-unmatch", "--", *tracked])
    if _git_output(repo_root, ["status", "--porcelain=v1", "--untracked-files=all", "--", *tracked]):
        raise ValueError("generator or cube-basis evidence files are not clean")
    files = tuple(_generator_file_binding(repo_root, path) for path in GENERATOR_PATHS)
    _verify_extractor_source(repo_root / PurePosixPath(evidence_path))
    final_files = tuple(_generator_file_binding(repo_root, path) for path in GENERATOR_PATHS)
    if files != final_files or _git_output(repo_root, ["rev-parse", "HEAD"]) != reviewed:
        raise ValueError("generator source changed during binding")
    if _git_output(repo_root, ["status", "--porcelain=v1", "--untracked-files=all", "--", *tracked]):
        raise ValueError("generator or cube-basis evidence files changed during binding")
    return GeneratorBinding(reviewed, files)


def _generator_file_binding(repo_root: Path, relative: str) -> GeneratorFileBinding:
    path = repo_root / PurePosixPath(relative)
    snapshot = _snapshot(path)
    content = _read_stable_bytes(path, snapshot)
    return GeneratorFileBinding(relative, sha256_bytes(content), len(content))


def _verify_extractor_source(path: Path) -> None:
    evidence = FROZEN_CONFIGURATION.cube_basis_provenance
    snapshot = _snapshot(path)
    content = _read_stable_bytes(path, snapshot)
    if len(content) != evidence.extractor_size_bytes or sha256_bytes(content) != evidence.extractor_sha256:
        raise ValueError("frozen cubeface basis extractor source drifted")


def verify_frozen_basis_report(path: Path) -> FileSnapshot:
    evidence = FROZEN_CONFIGURATION.cube_basis_provenance
    snapshot = _snapshot(path)
    content = _read_stable_bytes(path, snapshot)
    if len(content) != evidence.report_size_bytes or sha256_bytes(content) != evidence.report_sha256:
        raise ValueError("frozen cubeface basis report drifted")
    _validate_basis_report(load_strict_json_bytes(content, "frozen cubeface basis report"))
    return snapshot


def _validate_basis_report(value: dict[str, Any]) -> None:
    keys = {"ambiguous_photos", "az_shift0", "fit", "raster", "supersample", "sweeps", "truth"}
    _require_exact_keys(value, keys, "frozen cubeface basis report")
    sweeps = _require_dict(value.get("sweeps"), "frozen basis sweeps")
    if len(sweeps) != 149 or "scan_102#5" not in _require_list(value.get("ambiguous_photos"), "basis ambiguities"):
        raise ValueError("frozen cubeface basis report coverage drifted")
    observed = [dict() for _ in range(6)]
    for sweep in sweeps.values():
        photos = _require_list(_require_dict(sweep, "basis sweep").get("photos"), "basis photos")
        if len(photos) != 6:
            raise ValueError("frozen cubeface basis report lacks six faces")
        for index, raw in enumerate(photos):
            basis = str(_require_dict(raw, "basis photo").get("basis", ""))
            observed[index][basis] = observed[index].get(basis, 0) + 1
    _validate_basis_consensus(observed)


def _validate_basis_consensus(observed: list[dict[str, int]]) -> None:
    expected_names = ("f+z_r-y_p", "f+x_r-y_p", "f-y_r-x_p", "f-x_r+y_p", "f+y_r+x_p", "f-z_r-y_p")
    for face, name in zip(FROZEN_CONFIGURATION.cube_faces, expected_names):
        if observed[face.face_index].get(name) != face.report_consensus_count:
            raise ValueError("frozen cubeface basis report consensus drifted")
        if sum(observed[face.face_index].values()) != face.report_sweep_count:
            raise ValueError("frozen cubeface basis report sweep count drifted")
    if set(observed[5]) != {"f-z_r-y_p", "f-y_r+x_p"} or observed[5]["f-y_r+x_p"] != 1:
        raise ValueError("frozen cubeface basis outlier record drifted")


def generator_binding_json(binding: GeneratorBinding) -> dict[str, Any]:
    _require_git_sha(binding.reviewed_git_sha, "generator reviewed Git SHA")
    if tuple(item.relative_path for item in binding.files) != GENERATOR_PATHS:
        raise ValueError("generator executable source inventory drifted")
    for item in binding.files:
        _require_sha256(item.sha256, "generator source digest")
        _require_int(item.size_bytes, "generator source size", positive=True)
    return {
        "files": [{"relativePath": item.relative_path, "sha256": item.sha256, "sizeBytes": item.size_bytes} for item in binding.files],
        "reviewedGitSha": binding.reviewed_git_sha,
    }


def dependency_attestation_json(value: DependencyAttestation) -> dict[str, Any]:
    _validate_dependency_attestation(value)
    return {
        "determinismScope": value.determinism_scope,
        "lockSha256": value.lock_sha256,
        "packages": [
            {"installedFileCount": item.installed_file_count, "installedTreeSha256": item.installed_tree_sha256, "name": item.name, "wheelSha256": item.wheel_sha256}
            for item in value.packages
        ],
        "runtimeIdentitySha256": value.runtime_identity_sha256,
    }


def _validate_dependency_attestation(value: DependencyAttestation) -> None:
    if value.determinism_scope != FROZEN_CONFIGURATION.determinism_scope:
        raise ValueError("dependency determinism scope drifted")
    _require_sha256(value.lock_sha256, "dependency lock attestation")
    _require_sha256(value.runtime_identity_sha256, "dependency runtime attestation")
    expected = {"numpy", "opencv-python-headless"}
    if {item.name for item in value.packages} != expected or len(value.packages) != len(expected):
        raise ValueError("dependency package attestation inventory drifted")
    for item in value.packages:
        _require_int(item.installed_file_count, "installed dependency file count", positive=True)
        _require_sha256(item.installed_tree_sha256, "installed dependency tree digest")
        _require_sha256(item.wheel_sha256, "dependency wheel attestation")


def build_source_bindings(
    panoramas: Sequence[PanoramaSource],
    scans: Sequence[Data3DSource],
    profile: CrosswalkProfile,
) -> SourceBindings:
    panorama_material = [{"sha256": item.sha256, "sizeBytes": item.size_bytes} for item in sorted(panoramas, key=lambda item: item.sha256)]
    scan_material = [
        {"data3DGuid": scan.guid, "faces": [{"faceIndex": face.face_index, "sha256": face.sha256} for face in scan.faces]}
        for scan in sorted(scans, key=lambda item: item.guid)
    ]
    return SourceBindings(
        profile.panorama_manifest_sha256,
        profile.panorama_manifest_size_bytes,
        profile.panorama_inventory_sha256,
        profile.image2d_manifest_sha256,
        profile.image2d_manifest_size_bytes,
        profile.image2d_receipt_sha256,
        profile.image2d_receipt_size_bytes,
        _identity_digest(panorama_material),
        _identity_digest(scan_material),
    )


def _source_bindings_json(bindings: SourceBindings) -> dict[str, Any]:
    return {
        "data3DIdentitySetSha256": bindings.data3d_identity_set_sha256,
        "image2DManifest": {"sha256": bindings.image2d_manifest_sha256, "sizeBytes": bindings.image2d_manifest_size_bytes},
        "image2DReceipt": {"sha256": bindings.image2d_receipt_sha256, "sizeBytes": bindings.image2d_receipt_size_bytes},
        "panoramaIdentitySetSha256": bindings.panorama_identity_set_sha256,
        "panoramaInventorySha256": bindings.panorama_inventory_sha256,
        "panoramaManifest": {"sha256": bindings.panorama_manifest_sha256, "sizeBytes": bindings.panorama_manifest_size_bytes},
    }


def build_score_matrix_manifest(
    scores: Sequence[RetrievalScore],
    bindings: SourceBindings,
    configuration: CrosswalkConfiguration,
    generator: GeneratorBinding,
    dependency: DependencyAttestation,
    panorama_ids: Sequence[str],
    scan_ids: Sequence[str],
) -> dict[str, Any]:
    if len(scores) != len(panorama_ids) * len(scan_ids):
        raise ValueError("score matrix does not contain the complete Cartesian product")
    result = {
        "authority": "none",
        "configuration": configuration_json(configuration),
        "configurationSha256": configuration_digest(configuration),
        "contract": _authority_contract(),
        "dependencyAttestation": dependency_attestation_json(dependency),
        "generator": generator_binding_json(generator),
        "schemaVersion": MATRIX_SCHEMA,
        "scores": [
            {"data3DGuid": item.data3d_guid, "matchCount": item.match_count, "panoramaSha256": item.panorama_sha256, "scoreMicros": item.score_micros}
            for item in scores
        ],
        "sourceBindings": _source_bindings_json(bindings),
        "summary": {"candidatePairCount": len(scores), "data3DCount": len(scan_ids), "panoramaCount": len(panorama_ids)},
    }
    validate_matrix_manifest(result, bindings, configuration, generator, dependency, panorama_ids, scan_ids)
    return result


def _display_metadata(
    panoramas: Sequence[PanoramaSource],
    scans: Sequence[Data3DSource],
) -> tuple[dict[str, dict[str, Any]], dict[str, int]]:
    panorama_display = {
        item.sha256: {"digitToken": item.display_digit_token, "relativePath": item.relative_path, "sweepNumber": item.display_sweep_number}
        for item in panoramas
    }
    scan_display = {item.guid: item.display_scan_index for item in scans}
    return panorama_display, scan_display


def _attach_display(
    rows: list[dict[str, Any]],
    panorama_display: dict[str, dict[str, Any]],
    scan_display: dict[str, int],
) -> list[dict[str, Any]]:
    result = []
    for row in rows:
        item = dict(row)
        item["display"] = panorama_display[row["panoramaSha256"]]
        item["candidates"] = [
            {**candidate, "displayScanIndex": scan_display[candidate["data3DGuid"]]}
            for candidate in row["candidates"]
        ]
        result.append(item)
    return result


def build_crosswalk_manifest(
    rows: list[dict[str, Any]],
    panoramas: Sequence[PanoramaSource],
    scans: Sequence[Data3DSource],
    bindings: SourceBindings,
    matrix_sha256: str,
    matrix_size_bytes: int,
    configuration: CrosswalkConfiguration,
    generator: GeneratorBinding,
    dependency: DependencyAttestation,
) -> dict[str, Any]:
    panorama_display, scan_display = _display_metadata(panoramas, scans)
    attached = _attach_display(rows, panorama_display, scan_display)
    selected = {row["candidateData3DGuid"] for row in rows if row["candidateData3DGuid"]}
    states = {name: sum(row["state"] == name for row in rows) for name in ("candidate_human_pending", "ambiguous_human_pending", "no_supported_candidate")}
    result = {
        "authority": "none",
        "configuration": configuration_json(configuration),
        "configurationSha256": configuration_digest(configuration),
        "contract": _authority_contract(),
        "dependencyAttestation": dependency_attestation_json(dependency),
        "generator": generator_binding_json(generator),
        "matrix": {"relativePath": MATRIX_NAME, "sha256": _require_sha256(matrix_sha256, "matrix digest"), "sizeBytes": matrix_size_bytes},
        "results": attached,
        "schemaVersion": CROSSWALK_SCHEMA,
        "sourceBindings": _source_bindings_json(bindings),
        "summary": {**states, "data3DWithoutUnambiguousCandidateCount": len(scans) - len(selected), "panoramaCount": len(rows)},
    }
    validate_crosswalk_manifest(result, bindings, configuration, generator, dependency, panoramas, scans)
    return result


def build_publication_receipt(
    matrix_bytes: bytes,
    crosswalk_bytes: bytes,
    bindings: SourceBindings,
    configuration: CrosswalkConfiguration,
    generator: GeneratorBinding,
    dependency: DependencyAttestation,
) -> dict[str, Any]:
    result = {
        "authority": "none",
        "configurationSha256": configuration_digest(configuration),
        "dependencyAttestation": dependency_attestation_json(dependency),
        "files": [
            {"relativePath": MATRIX_NAME, "sha256": sha256_bytes(matrix_bytes), "sizeBytes": len(matrix_bytes)},
            {"relativePath": CROSSWALK_NAME, "sha256": sha256_bytes(crosswalk_bytes), "sizeBytes": len(crosswalk_bytes)},
        ],
        "publicationComplete": True,
        "receiptWrittenLast": True,
        "schemaVersion": RECEIPT_SCHEMA,
        "generator": generator_binding_json(generator),
        "sourceBindings": _source_bindings_json(bindings),
    }
    validate_receipt_manifest(result, matrix_bytes, crosswalk_bytes, bindings, configuration, generator, dependency)
    return result


def _require_exact_keys(value: dict[str, Any], expected: set[str], label: str) -> None:
    if set(value) != expected:
        raise ValueError(f"{label} keys drifted")


def _validate_common_manifest(
    value: dict[str, Any],
    bindings: SourceBindings,
    configuration: CrosswalkConfiguration,
    generator: GeneratorBinding,
    dependency: DependencyAttestation,
) -> None:
    if value.get("authority") != "none" or value.get("contract") != _authority_contract():
        raise ValueError("manifest authority contract drifted")
    if value.get("configuration") != configuration_json(configuration):
        raise ValueError("manifest frozen configuration drifted")
    if value.get("configurationSha256") != configuration_digest(configuration):
        raise ValueError("manifest configuration digest drifted")
    if value.get("generator") != generator_binding_json(generator):
        raise ValueError("manifest generator binding drifted")
    if value.get("dependencyAttestation") != dependency_attestation_json(dependency):
        raise ValueError("manifest dependency attestation drifted")
    if value.get("sourceBindings") != _source_bindings_json(bindings):
        raise ValueError("manifest source bindings drifted")


def validate_matrix_manifest(
    value: dict[str, Any],
    bindings: SourceBindings,
    configuration: CrosswalkConfiguration,
    generator: GeneratorBinding,
    dependency: DependencyAttestation,
    panorama_ids: Sequence[str],
    scan_ids: Sequence[str],
) -> None:
    keys = {"authority", "configuration", "configurationSha256", "contract", "dependencyAttestation", "generator", "schemaVersion", "scores", "sourceBindings", "summary"}
    _require_exact_keys(value, keys, "matrix")
    if value["schemaVersion"] != MATRIX_SCHEMA:
        raise ValueError("matrix schema drifted")
    _validate_common_manifest(value, bindings, configuration, generator, dependency)
    pairs = _validate_matrix_scores(value.get("scores"), set(panorama_ids), set(scan_ids))
    expected = {(panorama, scan) for panorama in panorama_ids for scan in scan_ids}
    if pairs != expected:
        raise ValueError("matrix is not the complete candidate Cartesian product")
    summary = {"candidatePairCount": len(expected), "data3DCount": len(set(scan_ids)), "panoramaCount": len(set(panorama_ids))}
    if value.get("summary") != summary:
        raise ValueError("matrix summary drifted")


def _validate_matrix_scores(value: Any, panorama_ids: set[str], scan_ids: set[str]) -> set[tuple[str, str]]:
    scores = _require_list(value, "matrix scores")
    pairs: set[tuple[str, str]] = set()
    order = []
    for raw in scores:
        item = _require_dict(raw, "matrix score")
        _require_exact_keys(item, {"data3DGuid", "matchCount", "panoramaSha256", "scoreMicros"}, "matrix score")
        panorama = _require_sha256(item.get("panoramaSha256"), "matrix panorama identity")
        guid = item.get("data3DGuid")
        if not isinstance(guid, str) or not guid:
            raise ValueError("matrix Data3D GUID is invalid")
        _require_int(item.get("matchCount"), "matrix match count")
        _require_int(item.get("scoreMicros"), "matrix retrieval score")
        if panorama not in panorama_ids or guid not in scan_ids or (panorama, guid) in pairs:
            raise ValueError("matrix contains unknown or duplicate identities")
        pairs.add((panorama, guid))
        order.append((panorama, guid))
    if order != sorted(order):
        raise ValueError("matrix score order drifted")
    return pairs


def _matrix_identity_sets(value: dict[str, Any]) -> tuple[list[str], list[str]]:
    scores = _require_list(value.get("scores"), "matrix scores")
    panoramas = sorted({_require_sha256(_require_dict(item, "matrix score").get("panoramaSha256"), "matrix panorama") for item in scores})
    scans = sorted({str(_require_dict(item, "matrix score").get("data3DGuid", "")) for item in scores})
    if not panoramas or not scans or any(not guid for guid in scans):
        raise ValueError("matrix identity sets are empty or invalid")
    return panoramas, scans


def validate_crosswalk_manifest(
    value: dict[str, Any],
    bindings: SourceBindings,
    configuration: CrosswalkConfiguration,
    generator: GeneratorBinding,
    dependency: DependencyAttestation,
    panoramas: Sequence[PanoramaSource],
    scans: Sequence[Data3DSource],
) -> None:
    panorama_display, scan_display = _display_metadata(panoramas, scans)
    _validate_crosswalk(value, bindings, configuration, generator, dependency, panorama_display, scan_display, None)


def validate_crosswalk_manifest_without_sources(
    value: dict[str, Any],
    matrix: dict[str, Any],
    bindings: SourceBindings,
    configuration: CrosswalkConfiguration,
    generator: GeneratorBinding,
    dependency: DependencyAttestation,
) -> None:
    panoramas, scans = _matrix_identity_sets(matrix)
    _validate_crosswalk(value, bindings, configuration, generator, dependency, {name: None for name in panoramas}, {name: None for name in scans}, matrix)
    matrix_bytes = canonical_json_bytes(matrix)
    reference = _require_dict(value.get("matrix"), "crosswalk matrix reference")
    if reference.get("sha256") != sha256_bytes(matrix_bytes) or reference.get("sizeBytes") != len(matrix_bytes):
        raise ValueError("crosswalk matrix byte binding drifted")


def _validate_crosswalk(
    value: dict[str, Any],
    bindings: SourceBindings,
    configuration: CrosswalkConfiguration,
    generator: GeneratorBinding,
    dependency: DependencyAttestation,
    panorama_display: dict[str, dict[str, Any] | None],
    scan_display: dict[str, int | None],
    matrix: dict[str, Any] | None,
) -> None:
    keys = {"authority", "configuration", "configurationSha256", "contract", "dependencyAttestation", "generator", "matrix", "results", "schemaVersion", "sourceBindings", "summary"}
    _require_exact_keys(value, keys, "crosswalk")
    if value["schemaVersion"] != CROSSWALK_SCHEMA:
        raise ValueError("crosswalk schema drifted")
    _validate_common_manifest(value, bindings, configuration, generator, dependency)
    _validate_matrix_reference(value.get("matrix"))
    rows = _validate_crosswalk_rows(value.get("results"), panorama_display, scan_display)
    if matrix is not None:
        _validate_verified_shortlist(matrix, rows, configuration)
        _validate_ranked_rows(matrix, rows, configuration)
    _validate_crosswalk_summary(value.get("summary"), rows, len(scan_display))


def _validate_verified_shortlist(
    matrix: dict[str, Any],
    rows: list[dict[str, Any]],
    configuration: CrosswalkConfiguration,
) -> None:
    scores = [_retrieval_from_json(_require_dict(item, "matrix score")) for item in _require_list(matrix.get("scores"), "matrix scores")]
    expected = set(select_bidirectional_shortlist(scores, configuration.ranking))
    actual: dict[tuple[str, str], dict[str, Any]] = {}
    for row in rows:
        for candidate in row["candidates"]:
            actual[(row["panoramaSha256"], candidate["data3DGuid"])] = candidate
    if set(actual) != expected:
        raise ValueError("crosswalk verified candidates differ from the matrix-derived shortlist")
    score_map = {(item.panorama_sha256, item.data3d_guid): item for item in scores}
    for pair, candidate in actual.items():
        score = score_map[pair]
        if candidate["retrievalMatchCount"] != score.match_count or candidate["retrievalScoreMicros"] != score.score_micros:
            raise ValueError("crosswalk candidate retrieval evidence differs from the matrix")


def _retrieval_from_json(item: dict[str, Any]) -> RetrievalScore:
    return RetrievalScore(
        str(item["panoramaSha256"]), str(item["data3DGuid"]),
        int(item["scoreMicros"]), int(item["matchCount"]),
    )


def _validate_ranked_rows(
    matrix: dict[str, Any],
    rows: list[dict[str, Any]],
    configuration: CrosswalkConfiguration,
) -> None:
    scores = [_retrieval_from_json(_require_dict(item, "matrix score")) for item in matrix["scores"]]
    verifications = [_verification_from_json(row["panoramaSha256"], candidate) for row in rows for candidate in row["candidates"]]
    panorama_ids = [row["panoramaSha256"] for row in rows]
    expected = rank_candidate_correspondences(panorama_ids, scores, verifications, configuration.ranking)
    actual = [_row_without_display(row) for row in rows]
    if actual != expected:
        raise ValueError("crosswalk states or candidate ranking differ from independent derivation")


def _verification_from_json(panorama: str, item: dict[str, Any]) -> CandidateVerification:
    counts = tuple((face["faceIndex"], face["inlierCount"]) for face in item["faceInlierCounts"])
    return CandidateVerification(
        panorama, item["data3DGuid"], item["sphericalInlierCount"],
        item["supportedFaceCount"], item["ratioMatchCount"],
        item["medianResidualMicrodegrees"], item["p95ResidualMicrodegrees"],
        item["globalReflectionApplied"], item["cubeCoherent"], counts,
    )


def _row_without_display(row: dict[str, Any]) -> dict[str, Any]:
    result = {name: value for name, value in row.items() if name != "display"}
    result["candidates"] = [
        {name: value for name, value in item.items() if name != "displayScanIndex"}
        for item in row["candidates"]
    ]
    return result


def _validate_matrix_reference(value: Any) -> None:
    item = _require_dict(value, "crosswalk matrix reference")
    _require_exact_keys(item, {"relativePath", "sha256", "sizeBytes"}, "crosswalk matrix reference")
    if item.get("relativePath") != MATRIX_NAME:
        raise ValueError("crosswalk matrix path drifted")
    _require_sha256(item.get("sha256"), "crosswalk matrix digest")
    _require_int(item.get("sizeBytes"), "crosswalk matrix size", positive=True)


def _validate_crosswalk_rows(
    value: Any,
    panorama_display: dict[str, dict[str, Any] | None],
    scan_display: dict[str, int | None],
) -> list[dict[str, Any]]:
    rows = [_require_dict(item, "crosswalk row") for item in _require_list(value, "crosswalk results")]
    identities: set[str] = set()
    selected: set[str] = set()
    for row in rows:
        candidate = _validate_crosswalk_row(row, panorama_display, scan_display)
        panorama = row["panoramaSha256"]
        if panorama in identities or (candidate is not None and candidate in selected):
            raise ValueError("crosswalk duplicates a panorama or Data3D selection")
        identities.add(panorama)
        if candidate is not None:
            selected.add(candidate)
    if identities != set(panorama_display):
        raise ValueError("crosswalk panorama identity set drifted")
    if [row["panoramaSha256"] for row in rows] != sorted(identities):
        raise ValueError("crosswalk row order drifted")
    return rows


def _validate_crosswalk_row(
    row: dict[str, Any],
    panorama_display: dict[str, dict[str, Any] | None],
    scan_display: dict[str, int | None],
) -> str | None:
    keys = {"ambiguityReasons", "candidateData3DGuid", "candidates", "display", "humanReviewRequired", "panoramaSha256", "state"}
    _require_exact_keys(row, keys, "crosswalk row")
    panorama = _require_sha256(row.get("panoramaSha256"), "crosswalk panorama identity")
    if panorama not in panorama_display or row.get("humanReviewRequired") is not True:
        raise ValueError("crosswalk row identity or review gate drifted")
    expected_display = panorama_display[panorama]
    if expected_display is not None and row.get("display") != expected_display:
        raise ValueError("crosswalk display metadata drifted")
    candidate = row.get("candidateData3DGuid")
    state = row.get("state")
    reasons = _require_list(row.get("ambiguityReasons"), "crosswalk ambiguity reasons")
    _validate_row_state(state, candidate, reasons, scan_display)
    candidate_items = [_require_dict(item, "crosswalk candidate") for item in _require_list(row.get("candidates"), "crosswalk candidates")]
    for item in candidate_items:
        _validate_candidate_json(item, scan_display)
    candidate_ids = [item["data3DGuid"] for item in candidate_items]
    if len(candidate_ids) != len(set(candidate_ids)) or (candidate is not None and candidate not in candidate_ids):
        raise ValueError("crosswalk candidate list is duplicate or omits its selection")
    candidate_order = sorted(candidate_items, key=lambda item: (-item["sphericalInlierCount"], -item["supportedFaceCount"], -item["ratioMatchCount"], item["data3DGuid"]))
    if candidate_items != candidate_order:
        raise ValueError("crosswalk candidate ranking order drifted")
    return candidate


def _validate_row_state(state: Any, candidate: Any, reasons: list[Any], scans: dict[str, int | None]) -> None:
    states = {"candidate_human_pending", "ambiguous_human_pending", "no_supported_candidate"}
    if state not in states or any(not isinstance(reason, str) or not reason for reason in reasons):
        raise ValueError("crosswalk state or ambiguity reason drifted")
    if state == "candidate_human_pending" and (candidate not in scans or reasons):
        raise ValueError("candidate row lacks one unambiguous known candidate")
    if state != "candidate_human_pending" and candidate is not None:
        raise ValueError("non-candidate row must not select a Data3D identity")
    if state == "ambiguous_human_pending" and not reasons:
        raise ValueError("ambiguous row lacks an explicit reason")


def _validate_candidate_json(item: dict[str, Any], scans: dict[str, int | None]) -> None:
    keys = {"cubeCoherent", "data3DGuid", "diagnosticModel", "displayScanIndex", "faceInlierCounts", "globalReflectionApplied", "medianResidualMicrodegrees", "p95ResidualMicrodegrees", "ratioMatchCount", "retrievalMatchCount", "retrievalScoreMicros", "sphericalInlierCount", "supported", "supportedFaceCount"}
    _require_exact_keys(item, keys, "crosswalk candidate")
    guid = item.get("data3DGuid")
    if guid not in scans or not isinstance(item.get("cubeCoherent"), bool) or not isinstance(item.get("supported"), bool):
        raise ValueError("crosswalk candidate identity or coherence drifted")
    expected_display = scans[guid]
    if expected_display is not None and item.get("displayScanIndex") != expected_display:
        raise ValueError("crosswalk candidate display index drifted")
    reflection = item.get("globalReflectionApplied")
    if reflection is not None and not isinstance(reflection, bool):
        raise ValueError("crosswalk global reflection flag drifted")
    model = "single_scan_wide_cubemap_to_equirect_orthogonal_model_no_pose_authority"
    if item.get("diagnosticModel") != model:
        raise ValueError("crosswalk candidate diagnostic model drifted")
    _validate_candidate_counts(item)


def _validate_candidate_counts(item: dict[str, Any]) -> None:
    for name in ("ratioMatchCount", "retrievalMatchCount", "retrievalScoreMicros", "sphericalInlierCount", "supportedFaceCount"):
        _require_int(item.get(name), f"crosswalk candidate {name}")
    faces = [_require_dict(value, "candidate face count") for value in _require_list(item.get("faceInlierCounts"), "candidate face counts")]
    if len(faces) != 6 or [face.get("faceIndex") for face in faces] != list(range(6)):
        raise ValueError("candidate face-index coverage drifted")
    for face in faces:
        _require_exact_keys(face, {"faceIndex", "inlierCount"}, "candidate face count")
        _require_int(face.get("inlierCount"), "candidate face inlier count")
    total = sum(face["inlierCount"] for face in faces)
    supported_faces = sum(face["inlierCount"] >= FROZEN_CONFIGURATION.verification.supported_face_inliers for face in faces)
    coherent = supported_faces >= FROZEN_CONFIGURATION.ranking.minimum_supported_faces
    if total != item["sphericalInlierCount"] or supported_faces != item["supportedFaceCount"]:
        raise ValueError("candidate aggregate inlier counts drifted")
    if coherent != item["cubeCoherent"]:
        raise ValueError("candidate cube-coherence derivation drifted")
    expected_supported = _candidate_json_supported(item)
    if item["supported"] != expected_supported:
        raise ValueError("candidate support state drifted")
    _validate_candidate_residuals(item, total)


def _candidate_json_supported(item: dict[str, Any]) -> bool:
    policy = FROZEN_CONFIGURATION.ranking
    return (
        item["cubeCoherent"]
        and item["sphericalInlierCount"] >= policy.minimum_inliers
        and item["supportedFaceCount"] >= policy.minimum_supported_faces
        and item["ratioMatchCount"] >= policy.minimum_ratio_matches
    )


def _validate_candidate_residuals(item: dict[str, Any], total: int) -> None:
    median = item.get("medianResidualMicrodegrees")
    p95 = item.get("p95ResidualMicrodegrees")
    if (median is None) != (p95 is None) or (item.get("globalReflectionApplied") is None) != (total == 0):
        raise ValueError("candidate residual or global-reflection nullability drifted")
    if median is not None:
        _require_int(median, "candidate median residual")
        _require_int(p95, "candidate p95 residual")
        if median > p95:
            raise ValueError("candidate residual ordering drifted")


def _validate_crosswalk_summary(value: Any, rows: list[dict[str, Any]], scan_count: int) -> None:
    selected = {row["candidateData3DGuid"] for row in rows if row["candidateData3DGuid"] is not None}
    states = {name: sum(row["state"] == name for row in rows) for name in ("candidate_human_pending", "ambiguous_human_pending", "no_supported_candidate")}
    expected = {**states, "data3DWithoutUnambiguousCandidateCount": scan_count - len(selected), "panoramaCount": len(rows)}
    if value != expected:
        raise ValueError("crosswalk summary drifted")


def validate_receipt_manifest(
    value: dict[str, Any],
    matrix_bytes: bytes,
    crosswalk_bytes: bytes,
    bindings: SourceBindings,
    configuration: CrosswalkConfiguration,
    generator: GeneratorBinding,
    dependency: DependencyAttestation,
) -> None:
    keys = {"authority", "configurationSha256", "dependencyAttestation", "files", "generator", "publicationComplete", "receiptWrittenLast", "schemaVersion", "sourceBindings"}
    _require_exact_keys(value, keys, "publication receipt")
    if value.get("authority") != "none" or value.get("schemaVersion") != RECEIPT_SCHEMA:
        raise ValueError("publication receipt authority or schema drifted")
    if value.get("publicationComplete") is not True or value.get("receiptWrittenLast") is not True:
        raise ValueError("publication receipt completion gate drifted")
    if value.get("configurationSha256") != configuration_digest(configuration):
        raise ValueError("publication receipt configuration drifted")
    if value.get("generator") != generator_binding_json(generator) or value.get("dependencyAttestation") != dependency_attestation_json(dependency):
        raise ValueError("publication receipt generator or dependency binding drifted")
    if value.get("sourceBindings") != _source_bindings_json(bindings):
        raise ValueError("publication receipt source binding drifted")
    if value.get("files") != _receipt_files(matrix_bytes, crosswalk_bytes):
        raise ValueError("publication receipt file binding drifted")


def _receipt_files(matrix_bytes: bytes, crosswalk_bytes: bytes) -> list[dict[str, Any]]:
    return [
        {"relativePath": MATRIX_NAME, "sha256": sha256_bytes(matrix_bytes), "sizeBytes": len(matrix_bytes)},
        {"relativePath": CROSSWALK_NAME, "sha256": sha256_bytes(crosswalk_bytes), "sizeBytes": len(crosswalk_bytes)},
    ]


def _write_exclusive(path: Path, content: bytes) -> None:
    with path.open("xb") as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())


def publish_crosswalk_pack(
    output: Path,
    matrix: dict[str, Any],
    crosswalk_builder: Callable[[int, str], dict[str, Any]],
    bindings: SourceBindings,
    configuration: CrosswalkConfiguration,
    generator: GeneratorBinding,
    dependency: DependencyAttestation,
) -> tuple[dict[str, Any], dict[str, Any]]:
    matrix_bytes = canonical_json_bytes(matrix)
    with publication_stage(output) as temporary:
        _write_exclusive(temporary / MATRIX_NAME, matrix_bytes)
        crosswalk = crosswalk_builder(len(matrix_bytes), sha256_bytes(matrix_bytes))
        crosswalk_bytes = canonical_json_bytes(crosswalk)
        _write_exclusive(temporary / CROSSWALK_NAME, crosswalk_bytes)
        receipt = build_publication_receipt(matrix_bytes, crosswalk_bytes, bindings, configuration, generator, dependency)
        _write_exclusive(temporary / RECEIPT_NAME, canonical_json_bytes(receipt))
        verify_crosswalk_pack(temporary, matrix, crosswalk, bindings, configuration, generator, dependency)
    verify_crosswalk_pack(output, matrix, crosswalk, bindings, configuration, generator, dependency)
    return matrix, crosswalk


def _pack_files(root: Path) -> set[str]:
    if _is_link_or_reparse(root) or not root.is_dir():
        raise ValueError("crosswalk pack root must be a real directory")
    entries = list(root.iterdir())
    if any(_is_link_or_reparse(path) or not path.is_file() for path in entries):
        raise ValueError("crosswalk pack contains linked or non-regular entries")
    return {path.name for path in entries}


def _load_canonical_stable(path: Path, snapshot: FileSnapshot, label: str) -> tuple[dict[str, Any], bytes]:
    content = _read_stable_bytes(path, snapshot)
    value = load_strict_json_bytes(content, label)
    if content != canonical_json_bytes(value):
        raise ValueError(f"{label} is not canonical evidence JSON")
    return value, content


def verify_crosswalk_pack(
    root: Path,
    expected_matrix: dict[str, Any],
    expected_crosswalk: dict[str, Any],
    bindings: SourceBindings,
    configuration: CrosswalkConfiguration,
    generator: GeneratorBinding,
    dependency: DependencyAttestation,
) -> None:
    names = {MATRIX_NAME, CROSSWALK_NAME, RECEIPT_NAME}
    if _pack_files(root) != names:
        raise ValueError("crosswalk pack inventory is incomplete or unexpected")
    snapshots = {name: _snapshot(root / name) for name in names}
    matrix, matrix_bytes = _load_canonical_stable(root / MATRIX_NAME, snapshots[MATRIX_NAME], "candidate score matrix")
    crosswalk, crosswalk_bytes = _load_canonical_stable(root / CROSSWALK_NAME, snapshots[CROSSWALK_NAME], "candidate crosswalk")
    panorama_ids, scan_ids = _matrix_identity_sets(matrix)
    validate_matrix_manifest(matrix, bindings, configuration, generator, dependency, panorama_ids, scan_ids)
    validate_crosswalk_manifest_without_sources(crosswalk, matrix, bindings, configuration, generator, dependency)
    if matrix != expected_matrix or crosswalk != expected_crosswalk:
        raise ValueError("crosswalk pack differs from source recomputation")
    expected_receipt = build_publication_receipt(matrix_bytes, crosswalk_bytes, bindings, configuration, generator, dependency)
    receipt, _ = _load_canonical_stable(root / RECEIPT_NAME, snapshots[RECEIPT_NAME], "publication receipt")
    validate_receipt_manifest(receipt, matrix_bytes, crosswalk_bytes, bindings, configuration, generator, dependency)
    if receipt != expected_receipt:
        raise ValueError("publication receipt does not bind the exact completed pack")
    if _pack_files(root) != names or any(_snapshot(root / name) != snapshots[name] for name in names):
        raise ValueError("crosswalk pack changed during strict verification")


def matcher_parameter_digest(parameters: dict[str, Any]) -> str:
    return sha256_bytes(canonical_json_bytes(parameters))


def current_runtime_identity(runtime_controls: dict[str, Any] | None = None) -> dict[str, Any]:
    executable = Path(sys.executable)
    core_library = Path(sys.base_prefix) / "python312.dll"
    controls = _default_runtime_controls() if runtime_controls is None else runtime_controls
    _validate_runtime_controls(controls)
    return {
        **controls,
        "determinismScope": FROZEN_CONFIGURATION.determinism_scope,
        "logicalProcessorCount": os.cpu_count(),
        "platformMachine": platform.machine(),
        "platformProcessor": platform.processor(),
        "platformRelease": platform.release(),
        "platformSystem": platform.system(),
        "platformVersion": platform.version(),
        "processorArchitecture": os.environ.get("PROCESSOR_ARCHITECTURE", ""),
        "processorIdentifier": os.environ.get("PROCESSOR_IDENTIFIER", ""),
        "pythonCompiler": platform.python_compiler(),
        "pythonCoreLibrarySha256": _stable_file_sha256(core_library),
        "pythonExecutableSha256": _stable_file_sha256(executable),
        "pythonImplementation": platform.python_implementation(),
        "pythonTag": "cp312-win_amd64",
        "pythonVersion": platform.python_version(),
    }


def _default_runtime_controls() -> dict[str, Any]:
    return {
        "dependencyExistingPathsWriteSealed": True,
        "dependencyImportAllowlistEnforced": True,
        "environmentControls": dict(FROZEN_CONFIGURATION.thread_environment),
        "environmentControlsSetBeforeImports": True,
        "opencvBuildInformationSha256": "0" * 64,
        "opencvCpuFeaturesLine": "unavailable_without_boundary_import",
        "opencvOpenCl": False,
        "opencvThreads": 1,
        "pythonBytecodeCachePrefix": "NUL",
        "pythonPathEnvironmentAbsent": True,
        "pythonDontWriteBytecode": True,
        "pythonIgnoreEnvironment": True,
        "pythonIsolated": True,
        "pythonNoSite": True,
        "pythonSafePath": True,
        "reviewedLocalModulesExplicitlyLoaded": True,
        "startupHookFiles": [],
        "userSiteEnabled": False,
        "verifiedSiteRootAddedAfterSeal": True,
    }


def _runtime_fixed_names() -> tuple[str, ...]:
    return (
        "dependencyExistingPathsWriteSealed",
        "dependencyImportAllowlistEnforced",
        "environmentControls",
        "environmentControlsSetBeforeImports",
        "opencvOpenCl",
        "opencvThreads",
        "pythonBytecodeCachePrefix",
        "pythonDontWriteBytecode",
        "pythonIgnoreEnvironment",
        "pythonIsolated",
        "pythonNoSite",
        "pythonPathEnvironmentAbsent",
        "pythonSafePath",
        "reviewedLocalModulesExplicitlyLoaded",
        "startupHookFiles",
        "userSiteEnabled",
        "verifiedSiteRootAddedAfterSeal",
    )


def _verify_active_python_controls(controls: dict[str, Any]) -> None:
    if controls["pythonDontWriteBytecode"] is not bool(sys.dont_write_bytecode):
        raise ValueError("Python bytecode-write control does not match the active interpreter")
    if controls["pythonPathEnvironmentAbsent"] is not ("PYTHONPATH" not in os.environ):
        raise ValueError("PYTHONPATH absence control does not match the active interpreter")
    active_flags = {
        "pythonIgnoreEnvironment": bool(sys.flags.ignore_environment),
        "pythonIsolated": bool(sys.flags.isolated),
        "pythonNoSite": bool(sys.flags.no_site),
        "pythonSafePath": bool(sys.flags.safe_path),
        "userSiteEnabled": not bool(sys.flags.no_user_site),
    }
    if any(controls[name] is not value for name, value in active_flags.items()):
        raise ValueError("Python isolation controls do not match the active interpreter")
    if controls["pythonBytecodeCachePrefix"] != sys.pycache_prefix:
        raise ValueError("Python bytecode-cache prefix does not match the active interpreter")


def _validate_runtime_controls(controls: dict[str, Any]) -> None:
    expected = _default_runtime_controls()
    if set(controls) != set(expected):
        raise ValueError("runtime control keys drifted")
    fixed_names = _runtime_fixed_names()
    fixed = {name: expected[name] for name in fixed_names}
    if any(controls[name] != value for name, value in fixed.items()):
        raise ValueError("deterministic runtime controls are not active")
    boolean_names = (
        "dependencyExistingPathsWriteSealed",
        "dependencyImportAllowlistEnforced",
        "environmentControlsSetBeforeImports",
        "opencvOpenCl",
        "pythonDontWriteBytecode",
        "pythonIgnoreEnvironment",
        "pythonIsolated",
        "pythonNoSite",
        "pythonPathEnvironmentAbsent",
        "pythonSafePath",
        "reviewedLocalModulesExplicitlyLoaded",
        "userSiteEnabled",
        "verifiedSiteRootAddedAfterSeal",
    )
    if any(type(controls[name]) is not bool for name in boolean_names):
        raise ValueError("runtime control booleans must use exact JSON boolean values")
    _verify_active_python_controls(controls)
    _require_sha256(controls.get("opencvBuildInformationSha256"), "OpenCV build-information digest")
    if not isinstance(controls.get("opencvCpuFeaturesLine"), str) or not controls["opencvCpuFeaturesLine"]:
        raise ValueError("OpenCV CPU feature evidence is missing")


def _stable_file_sha256(path: Path) -> str:
    snapshot = _snapshot(path)
    digest = sha256_file(path)
    if _snapshot(path) != snapshot:
        raise ValueError(f"runtime file changed during verification: {path.name}")
    return digest


def _dependency_import_maps(
    values: list[Any], site_root: Path
) -> tuple[dict[str, str], dict[str, Path], dict[str, dict[str, Path]]]:
    versions: dict[str, str] = {}
    origins: dict[str, Path] = {}
    runtime_paths: dict[str, dict[str, Path]] = {}
    for raw in values:
        item = _require_dict(raw, "dependency package")
        name = item.get("name")
        version = item.get("version")
        if not isinstance(name, str) or name in versions:
            raise ValueError("dependency import-plan package names must be unique")
        if not isinstance(version, str) or not version:
            raise ValueError("dependency import-plan version is missing")
        origin_member = DEPENDENCY_IMPORT_ORIGIN_MEMBERS.get(name)
        if origin_member is None:
            raise ValueError("dependency import-plan package set drifted")
        records = _require_list(item.get("runtimeFiles"), "dependency runtime files")
        paths: dict[str, Path] = {}
        for raw_record in records:
            record = _require_dict(raw_record, "dependency runtime file")
            label = record.get("name")
            member = _safe_relative_path(
                record.get("wheelRuntimeMember"), "wheel runtime member"
            )
            if not isinstance(label, str) or not label or label in paths:
                raise ValueError("dependency runtime file names must be unique")
            paths[label] = site_root / PurePosixPath(member)
        versions[name] = version
        origins[name] = site_root / PurePosixPath(origin_member)
        runtime_paths[name] = paths
    if set(versions) != set(DEPENDENCY_IMPORT_ORIGIN_MEMBERS):
        raise ValueError("dependency import-plan package set drifted")
    return versions, origins, runtime_paths


def _package_import_origin_paths(
    item: dict[str, Any], wheel_root: Path, site_root: Path
) -> list[Path]:
    wheel_path, wheel_snapshot = _verify_wheel(item, wheel_root)
    members = _verified_wheel_members(wheel_path)
    paths = []
    for name, content in sorted(members.items()):
        member = PurePosixPath(name)
        if member.suffix.lower() not in {".py", ".pyw", ".pyd"}:
            continue
        if any(part.endswith(".dist-info") for part in member.parts):
            continue
        path = site_root / member
        if _is_link_or_reparse(path) or not path.is_file():
            raise ValueError("dependency import origin is not a real installed file")
        snapshot = _snapshot(path)
        if _read_stable_bytes(path, snapshot) != content:
            raise ValueError("dependency import origin differs from its exact wheel")
        paths.append(path.resolve(strict=True))
    if _snapshot(wheel_path) != wheel_snapshot:
        raise ValueError("dependency wheel changed during import-origin binding")
    return paths


def _locked_import_origin_paths(
    values: list[Any], wheel_root: Path, site_root: Path
) -> tuple[Path, ...]:
    paths = []
    for raw in values:
        paths.extend(
            _package_import_origin_paths(
                _require_dict(raw, "dependency package"), wheel_root, site_root
            )
        )
    if len(paths) != len(set(paths)) or not paths:
        raise ValueError("dependency import-origin inventory is empty or duplicate")
    return tuple(sorted(paths))


def prepare_dependency_import(
    path: Path, wheel_root: Path, site_root: Path
) -> DependencyImportPlan:
    root = site_root.resolve(strict=True)
    if _is_link_or_reparse(root) or not root.is_dir():
        raise ValueError("dependency import site root must be a real directory")
    snapshot = _snapshot(path)
    lock, _ = _load_canonical_stable(path, snapshot, "crosswalk dependency lock")
    if set(lock) != {"authority", "packages", "runtime", "schemaVersion"}:
        raise ValueError("dependency lock keys drifted")
    if lock["schemaVersion"] != DEPENDENCY_SCHEMA or lock["authority"] != "none":
        raise ValueError("unsupported or authoritative dependency lock")
    packages = _require_list(lock["packages"], "dependency packages")
    versions, origins, runtime_paths = _dependency_import_maps(packages, root)
    runtime = _require_dict(lock["runtime"], "dependency runtime")
    names = set(_default_runtime_controls())
    if not names.issubset(runtime):
        raise ValueError("dependency runtime lacks import-plan controls")
    controls = {name: runtime[name] for name in names}
    roots = {name: root for name in versions}
    _, attestation = verify_dependency_lock(
        path, wheel_root, versions, runtime_paths, controls, roots
    )
    import_origins = _locked_import_origin_paths(packages, wheel_root, root)
    if _snapshot(path) != snapshot:
        raise ValueError("dependency lock changed during import planning")
    resolved_origins = {name: value.resolve(strict=True) for name, value in origins.items()}
    resolved_runtime = {
        name: {label: value.resolve(strict=True) for label, value in values.items()}
        for name, values in runtime_paths.items()
    }
    return DependencyImportPlan(
        versions, roots, resolved_runtime, controls, resolved_origins,
        import_origins, attestation,
    )


def verify_dependency_lock(
    path: Path,
    wheel_root: Path,
    installed_versions: dict[str, str],
    runtime_file_paths: dict[str, dict[str, Path]],
    runtime_controls: dict[str, Any],
    distribution_roots: dict[str, Path],
) -> tuple[dict[str, Any], DependencyAttestation]:
    snapshot = _snapshot(path)
    lock, content = _load_canonical_stable(path, snapshot, "crosswalk dependency lock")
    if set(lock) != {"authority", "packages", "runtime", "schemaVersion"}:
        raise ValueError("dependency lock keys drifted")
    if lock["schemaVersion"] != DEPENDENCY_SCHEMA or lock["authority"] != "none":
        raise ValueError("unsupported or authoritative dependency lock")
    runtime = _require_dict(lock["runtime"], "dependency runtime")
    _verify_python_runtime(runtime, wheel_root.parent, runtime_controls)
    packages = _verify_dependency_packages(
        _require_list(lock["packages"], "dependency packages"),
        wheel_root,
        installed_versions,
        runtime_file_paths,
        distribution_roots,
    )
    if _snapshot(path) != snapshot:
        raise ValueError("dependency lock changed during verification")
    lock_sha256 = sha256_bytes(content)
    attestation = DependencyAttestation(
        FROZEN_CONFIGURATION.determinism_scope,
        lock_sha256,
        tuple(packages),
        _identity_digest(runtime),
    )
    return lock, attestation


def _verify_python_runtime(
    runtime: dict[str, Any],
    artifact_root: Path,
    runtime_controls: dict[str, Any],
) -> None:
    current = current_runtime_identity(runtime_controls)
    if set(runtime) != set(current) | PYTHON_PROVENANCE_KEYS:
        raise ValueError("dependency runtime keys drifted")
    if {name: runtime[name] for name in current} != current:
        raise ValueError("dependency runtime controls drifted")
    source_url = runtime.get("pythonDistributionSourceUrl")
    if not isinstance(source_url, str) or not source_url.startswith("https://github.com/astral-sh/python-build-standalone/releases/download/"):
        raise ValueError("Python distribution source URL drifted")
    archive, archive_snapshot = _verify_python_artifact(runtime, artifact_root, "Archive")
    _verify_python_artifact(runtime, artifact_root, "License")
    _verify_python_base_distribution(archive, runtime)
    if _snapshot(archive) != archive_snapshot:
        raise ValueError("Python distribution archive changed after base verification")


def _verify_python_artifact(runtime: dict[str, Any], root: Path, kind: str) -> tuple[Path, FileSnapshot]:
    relative = _safe_relative_path(runtime.get(f"pythonDistribution{kind}RelativePath"), f"Python {kind} path")
    path = root / PurePosixPath(relative)
    snapshot = _snapshot(path)
    size = _require_int(runtime.get(f"pythonDistribution{kind}SizeBytes"), f"Python {kind} size", positive=True)
    digest = _require_sha256(runtime.get(f"pythonDistribution{kind}Sha256"), f"Python {kind} digest")
    if snapshot.size_bytes != size or sha256_file(path) != digest:
        raise ValueError(f"Python distribution {kind.lower()} bytes differ from the exact lock")
    if _snapshot(path) != snapshot:
        raise ValueError(f"Python distribution {kind.lower()} changed during verification")
    return path, snapshot


def _verify_python_base_distribution(archive_path: Path, runtime: dict[str, Any]) -> None:
    expected = _archive_comparable_members(archive_path)
    root = Path(sys.base_prefix)
    actual = _base_comparable_inventory(root)
    if set(expected) != actual:
        raise ValueError("active Python base distribution inventory differs from its exact archive")
    for name, content in sorted(expected.items()):
        _verify_base_member(root, name, content)
    material = _complete_tree_material(root, "active Python base distribution")
    final = _complete_tree_material(root, "active Python base distribution")
    if _base_comparable_inventory(root) != actual or final != material:
        raise ValueError("active Python base distribution changed during verification")
    count = _require_int(runtime.get("pythonBaseCompleteFileCount"), "Python base file count", positive=True)
    digest = _require_sha256(runtime.get("pythonBaseCompleteTreeSha256"), "Python base tree digest")
    if count != len(material) or digest != _identity_digest(material):
        raise ValueError("active Python base distribution attestation drifted")


def _archive_comparable_members(path: Path) -> dict[str, bytes]:
    try:
        with tarfile.open(path, "r:gz") as archive:
            members = [_archive_member_name(item) for item in archive.getmembers()]
            if any(name is None for name in members):
                raise ValueError("Python distribution archive member contract drifted")
            names = [name for name in members if name is not None and not _ignored_python_cache(name)]
            if len(names) != len(set(names)):
                raise ValueError("Python distribution archive contains duplicate comparable members")
            return {name: _read_archive_member(archive, "python/" + name) for name in names}
    except (OSError, tarfile.TarError) as error:
        raise ValueError("Python distribution archive is invalid") from error


def _archive_member_name(member: tarfile.TarInfo) -> str | None:
    path = PurePosixPath(member.name)
    if not member.isfile() or len(path.parts) < 2 or path.parts[0] != "python":
        return None
    relative = PurePosixPath(*path.parts[1:])
    if any(part in ("", ".", "..") for part in relative.parts):
        return None
    return relative.as_posix()


def _read_archive_member(archive: tarfile.TarFile, name: str) -> bytes:
    stream = archive.extractfile(name)
    if stream is None:
        raise ValueError("Python distribution archive member is unreadable")
    return stream.read()


def _ignored_python_cache(relative: str) -> bool:
    path = PurePosixPath(relative)
    return "__pycache__" in path.parts or path.suffix == ".pyc"


def _base_comparable_inventory(root: Path) -> set[str]:
    if _is_link_or_reparse(root) or not root.is_dir():
        raise ValueError("active Python base distribution must be a real directory")
    result = set()
    for directory, names, files in os.walk(root, followlinks=False):
        current = Path(directory)
        if any(_is_link_or_reparse(current / name) for name in names):
            raise ValueError("active Python base distribution contains a linked directory")
        for name in files:
            path = current / name
            if _is_link_or_reparse(path) or not path.is_file():
                raise ValueError("active Python base distribution contains a linked file")
            relative = path.relative_to(root).as_posix()
            if not _ignored_python_cache(relative):
                result.add(relative)
    return result


def _verify_base_member(root: Path, relative: str, archive_content: bytes) -> dict[str, Any]:
    path = root / PurePosixPath(relative)
    snapshot = _snapshot(path)
    content = _read_stable_bytes(path, snapshot)
    if content != archive_content:
        raise ValueError(f"active Python base file differs from archive: {relative}")
    return {"relativePath": relative, "sha256": sha256_bytes(content), "sizeBytes": len(content)}


def _complete_tree_material(root: Path, label: str) -> list[dict[str, Any]]:
    material = []
    for directory, names, files in os.walk(root, followlinks=False):
        current = Path(directory)
        if any(_is_link_or_reparse(current / name) for name in names):
            raise ValueError(f"{label} contains a linked directory")
        for name in sorted(files):
            path = current / name
            if _is_link_or_reparse(path) or not path.is_file():
                raise ValueError(f"{label} contains a linked file")
            content = _read_stable_bytes(path, _snapshot(path))
            material.append({"relativePath": path.relative_to(root).as_posix(), "sha256": sha256_bytes(content), "sizeBytes": len(content)})
    return sorted(material, key=lambda item: item["relativePath"])


def _verify_dependency_packages(
    values: list[Any],
    wheel_root: Path,
    installed_versions: dict[str, str],
    runtime_file_paths: dict[str, dict[str, Path]],
    distribution_roots: dict[str, Path],
) -> list[DependencyPackageAttestation]:
    if _is_link_or_reparse(wheel_root) or not wheel_root.is_dir():
        raise ValueError("dependency wheel root must be a real directory")
    packages: set[str] = set()
    attestations = []
    verified_wheels: dict[str, tuple[Path, FileSnapshot]] = {}
    verified_items: dict[str, dict[str, Any]] = {}
    expected_keys = {"installedFileCount", "installedTreeSha256", "license", "licenseFile", "licenseFileSha256", "name", "runtimeFiles", "sourceUrl", "thirdPartyNoticeFile", "thirdPartyNoticeFileSha256", "version", "wheelFile", "wheelSha256", "wheelSizeBytes"}
    for raw in values:
        item = _require_dict(raw, "dependency package")
        if set(item) != expected_keys:
            raise ValueError("dependency package keys drifted")
        name = str(item.get("name", ""))
        if not name or name in packages or installed_versions.get(name) != item.get("version"):
            raise ValueError("installed dependency version differs from the exact lock")
        packages.add(name)
        verified_items[name] = item
        wheel_path, wheel_snapshot = _verify_wheel(item, wheel_root)
        verified_wheels[name] = (wheel_path, wheel_snapshot)
        count, tree_sha = _verify_installed_distribution(wheel_path, distribution_roots.get(name))
        locked_count = _require_int(
            item.get("installedFileCount"), "installed dependency file count", positive=True
        )
        locked_tree = _require_sha256(
            item.get("installedTreeSha256"), "installed dependency tree digest"
        )
        if (count, tree_sha) != (locked_count, locked_tree):
            raise ValueError("installed dependency tree differs from the exact lock")
        _verify_runtime_files(
            item, wheel_path, runtime_file_paths.get(name), distribution_roots.get(name)
        )
        if _snapshot(wheel_path) != wheel_snapshot:
            raise ValueError("dependency wheel changed after complete package verification")
        attestations.append(DependencyPackageAttestation(name, count, tree_sha, str(item["wheelSha256"])))
    expected_sets = (set(installed_versions), set(runtime_file_paths), set(distribution_roots))
    if any(packages != values for values in expected_sets):
        raise ValueError("dependency lock and installed package sets differ")
    _verify_complete_site_roots(verified_wheels, distribution_roots)
    _verify_final_dependency_state(attestations, verified_items, verified_wheels, runtime_file_paths, distribution_roots)
    if any(_snapshot(path) != snapshot for path, snapshot in verified_wheels.values()):
        raise ValueError("dependency wheel changed after complete package verification")
    return sorted(attestations, key=lambda item: item.name)


def _verify_final_dependency_state(
    attestations: list[DependencyPackageAttestation],
    items: dict[str, dict[str, Any]],
    wheels: dict[str, tuple[Path, FileSnapshot]],
    runtime_paths: dict[str, dict[str, Path]],
    distribution_roots: dict[str, Path],
) -> None:
    expected = {item.name: (item.installed_file_count, item.installed_tree_sha256) for item in attestations}
    for name in sorted(expected):
        wheel_path = wheels[name][0]
        actual = _verify_installed_distribution(wheel_path, distribution_roots[name])
        if actual != expected[name]:
            raise ValueError("installed dependency changed after complete package verification")
        _verify_runtime_files(
            items[name], wheel_path, runtime_paths[name], distribution_roots[name]
        )
    _verify_complete_site_roots(wheels, distribution_roots)


def _verify_complete_site_roots(
    wheels: dict[str, tuple[Path, FileSnapshot]],
    distribution_roots: dict[str, Path],
) -> None:
    grouped: dict[Path, list[Path]] = {}
    for name, root in distribution_roots.items():
        grouped.setdefault(root.resolve(strict=True), []).append(wheels[name][0])
    for root, wheel_paths in grouped.items():
        expected = set()
        for wheel_path in wheel_paths:
            expected.update(PurePosixPath(name).parts[0] for name in _verified_wheel_members(wheel_path))
        actual = {path.name for path in root.iterdir()}
        if actual != expected:
            raise ValueError("active site-packages contains content outside the exact dependency wheels")
        if any(_is_link_or_reparse(path) for path in root.iterdir()):
            raise ValueError("active site-packages contains a linked top-level entry")


def _verify_wheel(item: dict[str, Any], wheel_root: Path) -> tuple[Path, FileSnapshot]:
    filename = _safe_relative_path(item.get("wheelFile"), "dependency wheel filename")
    if PurePosixPath(filename).parent != PurePosixPath("."):
        raise ValueError("dependency wheel must be a direct child of its root")
    path = wheel_root / filename
    snapshot = _snapshot(path)
    expected_size = _require_int(item.get("wheelSizeBytes"), "wheel byte count", positive=True)
    expected_sha = _require_sha256(item.get("wheelSha256"), "wheel SHA-256")
    if snapshot.size_bytes != expected_size or sha256_file(path) != expected_sha:
        raise ValueError("dependency wheel bytes differ from the exact lock")
    if _snapshot(path) != snapshot:
        raise ValueError("dependency wheel changed during verification")
    if not isinstance(item.get("license"), str) or not item["license"]:
        raise ValueError("dependency license identifier is missing")
    if not isinstance(item.get("sourceUrl"), str) or not item["sourceUrl"].startswith("https://files.pythonhosted.org/"):
        raise ValueError("dependency source URL is not an exact Python package artifact URL")
    _verify_wheel_notice(path, item, "licenseFile", "licenseFileSha256")
    _verify_wheel_notice(path, item, "thirdPartyNoticeFile", "thirdPartyNoticeFileSha256")
    _verified_wheel_members(path)
    if _snapshot(path) != snapshot:
        raise ValueError("dependency wheel changed during complete verification")
    return path, snapshot


def _verify_wheel_notice(path: Path, item: dict[str, Any], name_key: str, hash_key: str) -> None:
    member = _safe_relative_path(item.get(name_key), f"dependency {name_key}")
    expected = _require_sha256(item.get(hash_key), f"dependency {hash_key}")
    try:
        with zipfile.ZipFile(path) as archive:
            content = archive.read(member)
    except (OSError, KeyError, zipfile.BadZipFile) as error:
        raise ValueError(f"dependency wheel lacks its exact {name_key}") from error
    if sha256_bytes(content) != expected:
        raise ValueError(f"dependency wheel {name_key} digest drifted")


def _verified_wheel_members(path: Path) -> dict[str, bytes]:
    try:
        with zipfile.ZipFile(path) as archive:
            names = [name for name in archive.namelist() if not name.endswith("/")]
            if len(names) != len(set(names)):
                raise ValueError("dependency wheel contains duplicate members")
            members = {name: archive.read(name) for name in names}
    except (OSError, zipfile.BadZipFile) as error:
        raise ValueError("dependency wheel is not a stable ZIP archive") from error
    record_names = [name for name in members if name.endswith(".dist-info/RECORD")]
    if len(record_names) != 1:
        raise ValueError("dependency wheel must contain one RECORD")
    _verify_wheel_record(members, record_names[0])
    return members


def _verify_wheel_record(members: dict[str, bytes], record_name: str) -> None:
    try:
        rows = list(csv.reader(io.StringIO(members[record_name].decode("utf-8"))))
    except (UnicodeError, csv.Error) as error:
        raise ValueError("dependency wheel RECORD is invalid") from error
    records = {row[0]: row[1:] for row in rows if len(row) == 3}
    if len(records) != len(rows) or set(records) != set(members):
        raise ValueError("dependency wheel RECORD inventory drifted")
    for name, content in members.items():
        digest, size = records[name]
        if name == record_name:
            if digest or size:
                raise ValueError("dependency wheel RECORD self-entry must be unhashed")
            continue
        _verify_record_member(name, content, digest, size)


def _verify_record_member(name: str, content: bytes, digest: str, size: str) -> None:
    if not digest.startswith("sha256=") or not size.isdigit() or int(size) != len(content):
        raise ValueError(f"dependency wheel RECORD metadata drifted: {name}")
    encoded = digest.removeprefix("sha256=")
    try:
        expected = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)).hex()
    except (ValueError, binascii.Error) as error:
        raise ValueError("dependency wheel RECORD digest is invalid") from error
    if sha256_bytes(content) != expected:
        raise ValueError(f"dependency wheel RECORD digest drifted: {name}")


def _verify_installed_distribution(wheel_path: Path, site_root: Path | None) -> tuple[int, str]:
    if site_root is None or _is_link_or_reparse(site_root) or not site_root.is_dir():
        raise ValueError("installed distribution root must be a real directory")
    members = _verified_wheel_members(wheel_path)
    expected = {name: content for name, content in members.items() if not name.endswith(".dist-info/RECORD")}
    actual = _installed_distribution_files(site_root, {PurePosixPath(name).parts[0] for name in members})
    extras = {name for name in actual if name not in expected and not _allowed_installer_file(name)}
    if extras or set(expected) - actual:
        raise ValueError("installed distribution tree differs from wheel RECORD inventory")
    for name, content in sorted(expected.items()):
        _verify_installed_member(site_root, name, content)
    material = [_installed_file_material(site_root, name) for name in sorted(actual)]
    final = [_installed_file_material(site_root, name) for name in sorted(actual)]
    if _installed_distribution_files(site_root, {PurePosixPath(name).parts[0] for name in members}) != actual or final != material:
        raise ValueError("installed distribution tree changed during verification")
    return len(material), _identity_digest(material)


def _installed_distribution_files(site_root: Path, top_levels: set[str]) -> set[str]:
    result: set[str] = set()
    for name in sorted(top_levels):
        path = site_root / name
        if not path.exists():
            raise ValueError("installed distribution is missing a wheel top-level entry")
        if _is_link_or_reparse(path):
            raise ValueError("installed distribution contains a linked top-level entry")
        if path.is_file():
            result.add(name)
            continue
        if not path.is_dir():
            raise ValueError("installed distribution is missing a wheel top-level entry")
        result.update(_walk_installed_files(site_root, path))
    return result


def _walk_installed_files(site_root: Path, root: Path) -> set[str]:
    result: set[str] = set()
    for directory, names, files in os.walk(root, followlinks=False):
        current = Path(directory)
        if any(_is_link_or_reparse(current / name) for name in names):
            raise ValueError("installed distribution contains a linked directory")
        for name in files:
            path = current / name
            if _is_link_or_reparse(path) or not path.is_file():
                raise ValueError("installed distribution contains a linked file")
            result.add(path.relative_to(site_root).as_posix())
    return result


def _allowed_installer_file(relative: str) -> bool:
    path = PurePosixPath(relative)
    return path.name in {"INSTALLER", "REQUESTED", "direct_url.json", "RECORD"} and ".dist-info" in path.parent.name


def _verify_installed_member(site_root: Path, relative: str, wheel_content: bytes) -> dict[str, Any]:
    path = site_root / PurePosixPath(relative)
    snapshot = _snapshot(path)
    content = _read_stable_bytes(path, snapshot)
    digest = sha256_bytes(content)
    if content != wheel_content:
        raise ValueError(f"installed distribution member differs from exact wheel: {relative}")
    return {"relativePath": relative, "sha256": digest, "sizeBytes": len(content)}


def _installed_file_material(site_root: Path, relative: str) -> dict[str, Any]:
    path = site_root / PurePosixPath(relative)
    content = _read_stable_bytes(path, _snapshot(path))
    return {"relativePath": relative, "sha256": sha256_bytes(content), "sizeBytes": len(content)}


def _verify_runtime_file(
    item: dict[str, Any],
    wheel_path: Path,
    runtime_path: Path | None,
    site_root: Path | None,
) -> None:
    if runtime_path is None or set(item) != {"name", "runtimeFileSha256", "wheelRuntimeMember"}:
        raise ValueError("loaded dependency runtime file declaration drifted")
    expected = _require_sha256(item.get("runtimeFileSha256"), "loaded runtime digest")
    member = _safe_relative_path(item.get("wheelRuntimeMember"), "wheel runtime member")
    if site_root is None:
        raise ValueError("loaded dependency runtime file lacks its distribution root")
    expected_path = (site_root / PurePosixPath(member)).resolve(strict=True)
    if runtime_path.resolve(strict=True) != expected_path:
        raise ValueError("loaded dependency runtime path differs from its wheel member")
    if _stable_file_sha256(runtime_path) != expected:
        raise ValueError("loaded dependency runtime bytes differ from the exact lock")
    try:
        with zipfile.ZipFile(wheel_path) as archive:
            wheel_runtime = archive.read(member)
    except (OSError, KeyError, zipfile.BadZipFile) as error:
        raise ValueError("dependency wheel lacks its loaded runtime member") from error
    if sha256_bytes(wheel_runtime) != expected:
        raise ValueError("loaded dependency runtime does not match the exact wheel")


def _verify_runtime_files(
    package: dict[str, Any],
    wheel_path: Path,
    runtime_paths: dict[str, Path] | None,
    site_root: Path | None,
) -> None:
    values = _require_list(package.get("runtimeFiles"), "dependency runtime files")
    if runtime_paths is None or not values:
        raise ValueError("loaded dependency runtime file paths are missing")
    records = [_require_dict(value, "dependency runtime file") for value in values]
    names = [str(value.get("name", "")) for value in records]
    if any(not name for name in names) or len(names) != len(set(names)):
        raise ValueError("dependency runtime file names must be unique")
    if set(names) != set(runtime_paths):
        raise ValueError("loaded dependency runtime file set differs from the exact lock")
    for value, name in zip(records, names):
        _verify_runtime_file(value, wheel_path, runtime_paths[name], site_root)
