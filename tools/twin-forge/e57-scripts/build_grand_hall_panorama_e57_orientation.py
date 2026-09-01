"""Build/check source-only Grand Hall panorama/E57 orientation evidence.

Consumes only eight external panoramas and the native cubefaces for the eight
selected T560 candidates plus the supported sweep-47/scan-10 alternate. It
never opens the E57 container and never promotes a candidate to authority.

Import order is load-bearing. The numeric-lazy orientation core loads before
the frozen T560 gate. NumPy and OpenCV then come only from T560's write-sealed
dependency runtime.
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager, nullcontext
from dataclasses import dataclass
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
from typing import Callable, Iterator, Sequence


SCRIPT_DIRECTORY = Path(__file__).resolve(strict=True).parent
if str(SCRIPT_DIRECTORY) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIRECTORY))
if "grand_hall_panorama_e57_orientation" in sys.modules:
    raise ValueError("orientation core loaded before the trusted builder entry point")
import grand_hall_panorama_e57_orientation as orientation_core
import build_panorama_image2d_crosswalk as t560
from e57_image2d_evidence import canonical_json_bytes, publication_stage
from e57_stage_guard import assert_disjoint_output
from panorama_image2d_crosswalk import (
    Data3DSource,
    FaceSource,
    FileSnapshot as CrosswalkFileSnapshot,
    Intrinsics,
    PanoramaSource,
    dependency_attestation_json,
)


RESULT_NAME = "panorama-e57-orientations-authority-none.json"
RECEIPT_NAME = "publication-receipt.json"
RESULT_SCHEMA = "venviewer.grand-hall.panorama-e57-orientation-pack-authority-none.v1"
RECEIPT_SCHEMA = "venviewer.panorama-e57-orientation-publication-authority-none.v1"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
GIT_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
EXPECTED_SWEEPS = tuple(range(41, 49))
EXPECTED_PRIMARY_SCANS = tuple(range(40, 48))
ALTERNATE_SWEEP = 47
ALTERNATE_SCAN = 10
ALTERNATE_GUID = "da5b07775692403689007251a2fe553d"
EXPECTED_GUIDS = (
    "358291034cad4ed6a2774ea12c6cb4c7",
    "7906a35c0ddc422fa3fa5fa2944c3367",
    "98dacd61bf414e09aa92e703b8c18c3b",
    "7f61dcb781a14dfda07adfa7b9a324d5",
    "0cbaccbbeed34aaf8790e71d5393cb3e",
    "e8fbbc0cb4a243278573a14ed341e13f",
    "2d837563cd3d4963a3456805b333942e",
    "5ba1879351274fd9ad1759f7a9394dff",
)
EXPECTED_BASIS_IDS = (
    "r-y_d+x_f+z", "r-y_d-z_f+x", "r-x_d-z_f-y",
    "r+y_d-z_f-x", "r+x_d-z_f+y", "r-y_d-x_f-z",
)
EXPECTED_T560_PRIMARY_INLIERS = (652, 876, 759, 844, 813, 702, 736, 808)
EXPECTED_T560_PRIMARY_RATIO_MATCHES = (672, 887, 780, 872, 834, 724, 744, 830)
EXPECTED_T560_ALTERNATE_INLIERS = 352
EXPECTED_T560_ALTERNATE_RATIO_MATCHES = 400
EXPECTED_SOURCE_IMAGE_COUNT = 62
PANORAMA_FEATURE_WIDTH = 2048
PANORAMA_FEATURE_HEIGHT = 1024
FACE_FEATURE_SIZE = 512
REVIEW_PANEL_WIDTH = 1600
REVIEW_PANEL_HEIGHT = 800
REVIEW_HEADER_HEIGHT = 112
REVIEW_FACE_HEIGHT = 480
REVIEW_TILE_PX = 100
CONTACT_COLUMNS = 3
CONTACT_THUMB_WIDTH = 960
CONTACT_THUMB_HEIGHT = 682
CONTACT_LABEL_HEIGHT = 52
INVALID_REPROJECTION_RGB = (255, 0, 255)
TRUTH_SCOPE = (
    "content-derived relative orientation between exact external panorama pixels "
    "and exact native E57 Image2D cubeface pixels for human review only"
)

FROZEN_T554_PANORAMA_MANIFEST = (208_604, "2c8b44ef2cd840fddc3f0a49e82b73fff37b33f1d546126ed941029c1cb52b86")
FROZEN_CAMERA_SUBSET = (46_000, "4498873b37d112486609b2174f03c2cd1832ac9d7ead33d502653a3a15c52b98")
FROZEN_T559_MANIFEST = (663_151, "fd13da9638d1a1e194fb0c1acaedbe07dea15e65d9c16353d29f6542ce3ad344")
FROZEN_T559_RECEIPT = (600, "a19b4058ab6006744184101d0b8287f14a64390065743dc5ff63fb73fa882415")
FROZEN_T560_MATRIX = (4_773_324, "7fc8c34eefda10890e462180fb59c9ffb8c9d7a4bfe56afdee5c1752c8b3bc36")
FROZEN_T560_CROSSWALK = (2_025_532, "3b0a7757395904233e5fa1436dfe68c0a0daa9539c48ef079f70dde528c82215")
FROZEN_T560_RECEIPT = (3_222, "219d5c79512844d3c078871433010447052e7f5e770d74a0da3acf714f62153d")
FROZEN_T561_INPUT = (173_677, "9b196214bab065ce353019797f81134ec782bf71cf9d9b203851911ae774f297")
FROZEN_T561_RESULT = (242_707, "6234491aeb52c39dbd230cb4268c62637c16fd35d664ece129f536e85d75eb1f")
FROZEN_T561_RECEIPT = (15_552, "bebdfc93eee8b6a99c7d9a67b5c3f3c8661e2cbc4df86712b7df86ba8e7260ed")
FROZEN_T564_RESULT = (744_483, "27d247086fbbf85e3ec53397dd8fa79616d7ceb0a9618345d57055c0e44e71bd")
FROZEN_T564_RECEIPT = (1_187, "5ae120e1c37641c58f83e38e6075ac06fd0dae9e9edba038726f4416b378c22f")

GENERATOR_RELATIVE_PATHS = (
    "tools/twin-forge/e57-scripts/grand_hall_panorama_e57_orientation.py",
    "tools/twin-forge/e57-scripts/build_grand_hall_panorama_e57_orientation.py",
    "tools/twin-forge/e57-scripts/build_panorama_image2d_crosswalk.py",
    "tools/twin-forge/e57-scripts/panorama_image2d_crosswalk.py",
    "tools/twin-forge/e57-scripts/requirements-panorama-image2d-crosswalk.lock.json",
    "tools/twin-forge/e57-scripts/e57_image2d_evidence.py",
    "tools/twin-forge/e57-scripts/e57_stage_guard.py",
)


@dataclass(frozen=True)
class FileSnapshot:
    device: int
    inode: int
    mode: int
    size_bytes: int
    modified_ns: int
    changed_ns: int
    link_count: int


@dataclass(frozen=True)
class DirectorySnapshot:
    device: int
    inode: int
    mode: int


@dataclass(frozen=True)
class BoundFile:
    label: str
    path: Path
    relative_path: str
    size_bytes: int
    sha256: str
    snapshot: FileSnapshot


@dataclass(frozen=True)
class AttentionRectangle:
    x: int
    y: int
    width: int
    height: int


@dataclass(frozen=True)
class PairSource:
    pair_id: str
    sweep_number: int
    scan_index: int
    data3d_guid: str
    is_primary: bool
    panorama: PanoramaSource
    scan: Data3DSource
    quaternion_wxyz: tuple[float, float, float, float] | None
    translation_m: tuple[float, float, float] | None
    t560_ratio_match_count: int
    t560_spherical_inliers: int
    t560_supported_candidate_count: int
    t560_caveat: str | None
    attention_rectangles: tuple[AttentionRectangle, ...]


@dataclass(frozen=True)
class FrozenInputs:
    panorama_root: Path
    panorama_manifest: Path
    image2d_root: Path
    crosswalk_root: Path
    t561_root: Path
    t561_input: Path
    cubeface_extrinsics_root: Path
    camera_subset: Path
    dependency_wheel_root: Path


@dataclass(frozen=True)
class PreparedInputs:
    control_files: tuple[BoundFile, ...]
    source_files: tuple[BoundFile, ...]
    pairs: tuple[PairSource, ...]
    unique_panoramas: tuple[PanoramaSource, ...]
    unique_scans: tuple[Data3DSource, ...]
    t564_by_scan: dict[int, dict[str, object]]


@dataclass(frozen=True)
class PairDerivation:
    pair: PairSource
    fit_json: dict[str, object]
    match_identity_digests: tuple[str, ...]
    match_records: tuple[dict[str, object], ...]
    candidate_pose: dict[str, object] | None
    review_name: str
    review_png: bytes
    review_width: int
    review_height: int


@dataclass(frozen=True)
class DerivedPack:
    result: dict[str, object]
    files: dict[str, bytes]


RaceHook = Callable[[str, Path], None]


def _noop_hook(_event: str, _path: Path) -> None:
    return


def _reject_constant(value: str) -> None:
    raise ValueError(f"JSON contains forbidden non-finite constant {value!r}")


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"JSON contains duplicate key {key!r}")
        result[key] = value
    return result


def load_strict_json(content: bytes, label: str) -> dict[str, object]:
    try:
        value = json.loads(
            content.decode("utf-8"),
            object_pairs_hook=_unique_object,
            parse_constant=_reject_constant,
        )
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"{label} is not strict UTF-8 JSON") from error
    if not isinstance(value, dict):
        raise ValueError(f"{label} must contain a JSON object")
    return value


def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _is_link_or_reparse(path: Path) -> bool:
    metadata = path.lstat()
    attributes = getattr(metadata, "st_file_attributes", 0)
    reparse = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    return path.is_symlink() or bool(reparse and attributes & reparse)


def _snapshot(path: Path, *, require_single_link: bool = True) -> FileSnapshot:
    if _is_link_or_reparse(path):
        raise ValueError(f"evidence path is a link or reparse point: {path}")
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode):
        raise ValueError(f"evidence path is not a regular file: {path}")
    if require_single_link and metadata.st_nlink != 1:
        raise ValueError(f"evidence path has multiple hard links: {path}")
    return FileSnapshot(
        metadata.st_dev,
        metadata.st_ino,
        metadata.st_mode,
        metadata.st_size,
        metadata.st_mtime_ns,
        metadata.st_ctime_ns,
        metadata.st_nlink,
    )


def _directory_snapshot(path: Path) -> DirectorySnapshot:
    if _is_link_or_reparse(path):
        raise ValueError(f"evidence directory is a link or reparse point: {path}")
    metadata = path.lstat()
    if not stat.S_ISDIR(metadata.st_mode):
        raise ValueError(f"evidence directory is not a directory: {path}")
    return DirectorySnapshot(metadata.st_dev, metadata.st_ino, metadata.st_mode)


def _same_open_file(actual: os.stat_result, expected: FileSnapshot) -> bool:
    mode_matches = (
        stat.S_ISREG(actual.st_mode) and stat.S_ISREG(expected.mode)
        if os.name == "nt"
        else actual.st_mode == expected.mode
    )
    return (
        actual.st_dev,
        actual.st_ino,
        actual.st_size,
        actual.st_mtime_ns,
        actual.st_nlink,
    ) == (
        expected.device,
        expected.inode,
        expected.size_bytes,
        expected.modified_ns,
        expected.link_count,
    ) and mode_matches


def _read_stable(path: Path, expected: FileSnapshot) -> bytes:
    if _snapshot(path) != expected:
        raise ValueError(f"evidence path changed before read: {path}")
    with path.open("rb") as stream:
        before = os.fstat(stream.fileno())
        content = stream.read()
        after = os.fstat(stream.fileno())
    if not _same_open_file(before, expected) or not _same_open_file(after, expected):
        raise ValueError(f"opened evidence identity changed during read: {path}")
    if _snapshot(path) != expected:
        raise ValueError(f"evidence path changed during read: {path}")
    return content


@contextmanager
def windows_read_leases(paths: Sequence[Path]) -> Iterator[None]:
    """Deny writes/deletes to exact source files for the complete solve."""
    if os.name != "nt":
        raise ValueError("strict source custody requires Windows sharing-deny leases")
    import ctypes
    from ctypes import wintypes

    create_file = ctypes.WinDLL("kernel32", use_last_error=True).CreateFileW
    create_file.argtypes = (
        wintypes.LPCWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.LPVOID,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.HANDLE,
    )
    create_file.restype = wintypes.HANDLE
    close_handle = ctypes.WinDLL("kernel32", use_last_error=True).CloseHandle
    close_handle.argtypes = (wintypes.HANDLE,)
    close_handle.restype = wintypes.BOOL
    invalid = wintypes.HANDLE(-1).value
    handles: list[int] = []
    unique = sorted(
        {path.resolve(strict=True) for path in paths},
        key=lambda value: os.path.normcase(str(value)),
    )
    try:
        for path in unique:
            handle = create_file(
                str(path), 0x80000000, 0x00000001, None, 3, 0x00000080, None
            )
            if handle == invalid:
                raise ctypes.WinError(ctypes.get_last_error())
            handles.append(handle)
        yield
    finally:
        for handle in reversed(handles):
            close_handle(handle)


@contextmanager
def windows_directory_identity_lease(path: Path) -> Iterator[DirectorySnapshot]:
    """Pin one directory identity while permitting direct child writes."""
    if os.name != "nt":
        raise ValueError("strict directory custody requires Windows sharing semantics")
    import ctypes
    from ctypes import wintypes

    resolved = _verify_path_chain(path, "leased directory", must_exist=True)
    before = _directory_snapshot(resolved)
    create_file = ctypes.WinDLL("kernel32", use_last_error=True).CreateFileW
    create_file.argtypes = (
        wintypes.LPCWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.LPVOID,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.HANDLE,
    )
    create_file.restype = wintypes.HANDLE
    close_handle = ctypes.WinDLL("kernel32", use_last_error=True).CloseHandle
    close_handle.argtypes = (wintypes.HANDLE,)
    close_handle.restype = wintypes.BOOL
    handle = create_file(
        str(resolved), 0x80000000, 0x00000001 | 0x00000002,
        None, 3, 0x02000000, None,
    )
    if handle == wintypes.HANDLE(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        if _directory_snapshot(resolved) != before:
            raise ValueError("leased directory identity changed while its handle opened")
        yield before
        if _directory_snapshot(resolved) != before:
            raise ValueError("leased directory identity changed while custody was held")
    finally:
        close_handle(handle)


def _verify_path_chain(path: Path, label: str, *, must_exist: bool) -> Path:
    if not path.is_absolute() or len(path.drive) != 2 or path.drive[1] != ":":
        raise ValueError(f"{label} must use an absolute ordinary local drive-letter path")
    raw = str(path)
    if raw.startswith(("\\\\", "\\\\?\\", "\\\\.\\")):
        raise ValueError(f"{label} cannot use UNC or device syntax")
    if any(":" in part for part in path.parts[1:]):
        raise ValueError(f"{label} cannot contain an alternate data stream")
    absolute = path.absolute()
    current = Path(path.anchor)
    for part in path.parts[1:]:
        current /= part
        if not os.path.lexists(current):
            if must_exist:
                raise ValueError(f"{label} is absent: {current}")
            break
        if _is_link_or_reparse(current):
            raise ValueError(f"{label} traverses a link or reparse point: {current}")
    if must_exist:
        resolved = absolute.resolve(strict=True)
        if os.path.normcase(str(resolved)) != os.path.normcase(str(absolute)):
            raise ValueError(f"{label} is not a canonical direct path")
        return resolved
    return absolute.resolve(strict=False)


def _bind_exact(
    path: Path,
    label: str,
    expected: tuple[int, str],
    relative_path: str,
) -> tuple[BoundFile, bytes]:
    resolved = _verify_path_chain(path, label, must_exist=True)
    snapshot = _snapshot(resolved)
    if snapshot.size_bytes != expected[0]:
        raise ValueError(f"{label} byte count differs from the frozen identity")
    content = _read_stable(resolved, snapshot)
    digest = sha256_bytes(content)
    if digest != expected[1]:
        raise ValueError(f"{label} SHA-256 differs from the frozen identity")
    return BoundFile(label, resolved, relative_path, len(content), digest, snapshot), content


def _bind_declared(
    path: Path, label: str, size_bytes: int, digest: str, relative_path: str
) -> BoundFile:
    if SHA256_RE.fullmatch(digest) is None or size_bytes <= 0:
        raise ValueError(f"{label} declared identity is invalid")
    resolved = _verify_path_chain(path, label, must_exist=True)
    snapshot = _snapshot(resolved)
    if snapshot.size_bytes != size_bytes:
        raise ValueError(f"{label} byte count differs from its exact declaration")
    content = _read_stable(resolved, snapshot)
    if sha256_bytes(content) != digest:
        raise ValueError(f"{label} SHA-256 differs from its exact declaration")
    return BoundFile(label, resolved, relative_path, size_bytes, digest, snapshot)


def _dict(value: object, label: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return value


def _list(value: object, label: str) -> list[object]:
    if not isinstance(value, list):
        raise ValueError(f"{label} must be an array")
    return value


def _string(value: object, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{label} must be a non-empty string")
    return value


def _integer(value: object, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError(f"{label} must be an integer")
    return value


def _finite_tuple(value: object, length: int, label: str) -> tuple[float, ...]:
    items = _list(value, label)
    if len(items) != length:
        raise ValueError(f"{label} must contain exactly {length} numbers")
    result: list[float] = []
    for item in items:
        if isinstance(item, bool) or not isinstance(item, (int, float)) or not math.isfinite(float(item)):
            raise ValueError(f"{label} values must be finite numbers")
        result.append(float(item))
    return tuple(result)


def _digest(value: object, label: str) -> str:
    raw = _string(value, label).removeprefix("sha256:")
    if SHA256_RE.fullmatch(raw) is None:
        raise ValueError(f"{label} must be a lowercase SHA-256 digest")
    return raw


def _canonical_json(bound: BoundFile, content: bytes) -> dict[str, object]:
    """Strictly parse one exact hash-sealed historical control file.

    T554 and the camera-subset artifact predate the current canonical encoder,
    so their reviewed byte identity—not re-encoding—is the custody boundary.
    """
    value = load_strict_json(content, bound.label)
    return value


def _crosswalk_snapshot(value: FileSnapshot) -> CrosswalkFileSnapshot:
    return CrosswalkFileSnapshot(
        value.device, value.inode, value.mode, value.size_bytes,
        value.modified_ns, value.changed_ns,
    )


def _bind_control_files(
    inputs: FrozenInputs, repo_root: Path
) -> tuple[tuple[BoundFile, ...], dict[str, dict[str, object]]]:
    specs = (
        ("t554PanoramaManifest", inputs.panorama_manifest, FROZEN_T554_PANORAMA_MANIFEST, "t554/panorama-review-manifest-authority-none.json"),
        ("cameraSubset", inputs.camera_subset, FROZEN_CAMERA_SUBSET, "t558/grand-hall-camera-metric-subset-authority-none-v1.json"),
        ("t559Manifest", inputs.image2d_root / "image2d-inventory-authority-none.json", FROZEN_T559_MANIFEST, "t559/image2d-inventory-authority-none.json"),
        ("t559Receipt", inputs.image2d_root / RECEIPT_NAME, FROZEN_T559_RECEIPT, "t559/publication-receipt.json"),
        ("t560Matrix", inputs.crosswalk_root / "candidate-score-matrix-authority-none.json", FROZEN_T560_MATRIX, "t560/candidate-score-matrix-authority-none.json"),
        ("t560Crosswalk", inputs.crosswalk_root / "panorama-image2d-crosswalk-authority-none.json", FROZEN_T560_CROSSWALK, "t560/panorama-image2d-crosswalk-authority-none.json"),
        ("t560Receipt", inputs.crosswalk_root / RECEIPT_NAME, FROZEN_T560_RECEIPT, "t560/publication-receipt.json"),
        ("t561Input", inputs.t561_input, FROZEN_T561_INPUT, "t561/panorama-visual-observations-input-authority-none.json"),
        ("t561Result", inputs.t561_root / "panorama-visual-observations-authority-none.json", FROZEN_T561_RESULT, "t561/panorama-visual-observations-authority-none.json"),
        ("t561Receipt", inputs.t561_root / RECEIPT_NAME, FROZEN_T561_RECEIPT, "t561/publication-receipt.json"),
        ("t561RepositoryReceipt", repo_root / "docs/operations/grand-hall-t561-panorama-visual-observation-v1.json", FROZEN_T561_RECEIPT, "repository/t561-publication-receipt.json"),
        ("t564Result", inputs.cubeface_extrinsics_root / "cubeface-extrinsics-authority-none.json", FROZEN_T564_RESULT, "t564/cubeface-extrinsics-authority-none.json"),
        ("t564Receipt", inputs.cubeface_extrinsics_root / RECEIPT_NAME, FROZEN_T564_RECEIPT, "t564/publication-receipt.json"),
        ("t564RepositoryReceipt", repo_root / "docs/operations/grand-hall-e57-cubeface-extrinsics-authority-none-v1.json", FROZEN_T564_RECEIPT, "repository/t564-publication-receipt.json"),
    )
    bound: list[BoundFile] = []
    values: dict[str, dict[str, object]] = {}
    for label, path, expected, relative in specs:
        item, content = _bind_exact(path, label, expected, relative)
        bound.append(item)
        values[label] = _canonical_json(item, content)
    if values["t561Receipt"] != values["t561RepositoryReceipt"]:
        raise ValueError("T561 local and repository receipt bytes diverged")
    if values["t564Receipt"] != values["t564RepositoryReceipt"]:
        raise ValueError("T564 local and repository receipt bytes diverged")
    return tuple(bound), values


def _selected_panorama_records(
    result: dict[str, object]
) -> dict[int, tuple[dict[str, object], tuple[AttentionRectangle, ...]]]:
    if result.get("schemaVersion") != "omnitwin.foundry.grand-hall-t561-panorama-visual-observation-pack.v1":
        raise ValueError("T561 result schema drifted")
    if (
        result.get("authority") != "none"
        or result.get("reviewState") != "agent_observation_complete_human_pending"
    ):
        raise ValueError("T561 authority or review state drifted")
    guards = _dict(result.get("guards"), "T561 guards")
    if guards.get("generatedContentUsed") is not False or any(
        value is True for value in guards.values()
    ):
        raise ValueError("T561 guards opened an authority or generated-content path")
    records: dict[int, tuple[dict[str, object], tuple[AttentionRectangle, ...]]] = {}
    for raw in _list(result.get("records"), "T561 records"):
        row = _dict(raw, "T561 record")
        sweep = _integer(row.get("sweepNumber"), "T561 sweep")
        if sweep not in EXPECTED_SWEEPS:
            continue
        if sweep in records:
            raise ValueError("T561 selected sweep is duplicated")
        if (
            row.get("authority") != "none"
            or row.get("humanReviewState") != "pending"
            or row.get("observationState") != "grand_hall_pixels_observed"
            or row.get("frameContext") != "mixed_boundary_frame"
            or row.get("boundarySensitive") is not True
            or row.get("roomMembershipAuthority") != "none"
            or row.get("cameraPoseAuthority") != "none"
            or row.get("maskAuthority") != "none"
            or any(row.get(key) is not False for key in (
                "trainingInputPermitted", "reconstructionInputPermitted",
                "runtimeInputPermitted", "publicEvidencePermitted",
            ))
        ):
            raise ValueError("T561 selected record authority or scope state drifted")
        rectangles: list[AttentionRectangle] = []
        for region_raw in _list(row.get("attentionRegions"), "T561 attention regions"):
            region = _dict(region_raw, "T561 attention region")
            if region.get("authority") != "none" or region.get("wrapsHorizontalSeam") is not False:
                raise ValueError("T561 attention region is authoritative or seam-wrapped")
            for rectangle_raw in _list(region.get("sourcePixelRectangles"), "T561 rectangles"):
                rectangle = _dict(rectangle_raw, "T561 rectangle")
                values = tuple(_integer(rectangle.get(key), f"rectangle {key}") for key in ("x", "y", "width", "height"))
                if min(values) < 0 or values[2] <= 0 or values[3] <= 0:
                    raise ValueError("T561 attention rectangle is outside valid bounds")
                rectangles.append(AttentionRectangle(*values))
        if not rectangles:
            raise ValueError("selected mixed-boundary frame lacks a visible attention rectangle")
        records[sweep] = row, tuple(rectangles)
    if tuple(sorted(records)) != EXPECTED_SWEEPS:
        raise ValueError("T561 does not bind exact external sweeps 41 through 48")
    return records


def _build_panoramas(
    root: Path,
    selected: dict[int, tuple[dict[str, object], tuple[AttentionRectangle, ...]]],
) -> tuple[tuple[PanoramaSource, ...], tuple[BoundFile, ...]]:
    panoramas: list[PanoramaSource] = []
    bound: list[BoundFile] = []
    for sweep in EXPECTED_SWEEPS:
        record = selected[sweep][0]
        relative = _string(record.get("relativePath"), "panorama relative path")
        if relative != f"sweep_{sweep:03d}jpg.jpg" or "\\" in relative:
            raise ValueError("selected panorama path is not the exact canonical display path")
        size = _integer(record.get("byteLength"), "panorama bytes")
        digest = _digest(record.get("sha256"), "panorama SHA-256")
        if record.get("widthPx") != 8192 or record.get("heightPx") != 4096:
            raise ValueError("selected panorama dimensions drifted")
        item = _bind_declared(
            root / PurePosixPath(relative), f"external panorama sweep {sweep}",
            size, digest, f"external-panoramas/{relative}",
        )
        bound.append(item)
        panoramas.append(PanoramaSource(
            digest, size, 8192, 4096, item.path, _crosswalk_snapshot(item.snapshot),
            relative, sweep, f"{sweep:03d}",
        ))
    return tuple(panoramas), tuple(bound)


def _image_intrinsics(record: dict[str, object]) -> Intrinsics:
    values = {
        "width": _integer(record.get("width"), "face width"),
        "height": _integer(record.get("height"), "face height"),
        "focal_length": float(record.get("focalLength", math.nan)),
        "pixel_width": float(record.get("pixelWidth", math.nan)),
        "pixel_height": float(record.get("pixelHeight", math.nan)),
        "principal_point_x": float(record.get("principalPointX", math.nan)),
        "principal_point_y": float(record.get("principalPointY", math.nan)),
    }
    if not all(math.isfinite(value) for value in values.values()):
        raise ValueError("native face intrinsics contain non-finite values")
    if values != {
        "width": 4096, "height": 4096, "focal_length": 0.5,
        "pixel_width": 1 / 4096, "pixel_height": 1 / 4096,
        "principal_point_x": 2048.0, "principal_point_y": 2048.0,
    }:
        raise ValueError("native face intrinsics differ from the exact square cube")
    return Intrinsics(**values)


def _build_scans(
    root: Path, manifest: dict[str, object]
) -> tuple[tuple[Data3DSource, ...], tuple[BoundFile, ...]]:
    if manifest.get("schemaVersion") != "venviewer.e57-image2d-evidence.v1" or manifest.get("authority") != "none":
        raise ValueError("T559 schema or authority drifted")
    selected_indices = (ALTERNATE_SCAN, *EXPECTED_PRIMARY_SCANS)
    expected_by_index = {ALTERNATE_SCAN: ALTERNATE_GUID, **dict(zip(EXPECTED_PRIMARY_SCANS, EXPECTED_GUIDS))}
    data3d_by_index: dict[int, str] = {}
    for raw in _list(manifest.get("data3D"), "T559 Data3D"):
        row = _dict(raw, "T559 Data3D row")
        index = _integer(row.get("scanIndex"), "T559 scan index")
        if index in selected_indices:
            data3d_by_index[index] = _string(row.get("guid"), "T559 Data3D GUID").lower()
    if data3d_by_index != expected_by_index:
        raise ValueError("T559 selected Data3D identities drifted")
    grouped: dict[int, list[FaceSource]] = {index: [] for index in selected_indices}
    bound: list[BoundFile] = []
    for raw in _list(manifest.get("images"), "T559 images"):
        record = _dict(raw, "T559 image")
        scan_index = _integer(record.get("data3DIndex"), "T559 image scan index")
        if scan_index not in grouped:
            continue
        face = _integer(record.get("faceIndex"), "T559 face index")
        guid = _string(record.get("associatedData3DGuid"), "T559 associated GUID").lower()
        if guid != expected_by_index[scan_index] or face not in range(6):
            raise ValueError("T559 selected image association drifted")
        relative = _string(record.get("relativePath"), "T559 image path")
        if relative != f"images/scan_{scan_index:03d}/image2d_{scan_index * 6 + face:03d}_skybox_{face}.jpg":
            raise ValueError("T559 selected image path is not canonical")
        size = _integer(record.get("sizeBytes"), "T559 image bytes")
        digest = _digest(record.get("sha256"), "T559 image SHA-256")
        if (
            record.get("decodedMode") != "RGB"
            or record.get("blob") != "jpegImage"
            or record.get("representation") != "pinholeRepresentation"
        ):
            raise ValueError("T559 selected image representation drifted")
        item = _bind_declared(
            root / PurePosixPath(relative), f"native scan {scan_index} face {face}",
            size, digest, f"t559/{relative}",
        )
        bound.append(item)
        grouped[scan_index].append(FaceSource(
            digest, face, item.path, _crosswalk_snapshot(item.snapshot),
            _image_intrinsics(record),
        ))
    scans: list[Data3DSource] = []
    for index in selected_indices:
        faces = tuple(sorted(grouped[index], key=lambda value: value.face_index))
        if len(faces) != 6 or tuple(value.face_index for value in faces) != tuple(range(6)):
            raise ValueError("selected T559 scan lacks its exact six unique faces")
        scans.append(Data3DSource(expected_by_index[index], faces, index))
    if len(bound) != 54 or len({item.sha256 for item in bound}) != 54:
        raise ValueError("selected native face set is not exactly 54 unique JPEG identities")
    return tuple(scans), tuple(bound)


def _crosswalk_candidates(
    crosswalk: dict[str, object], panorama_by_sweep: dict[int, PanoramaSource]
) -> dict[tuple[int, int], tuple[int, int, int]]:
    if (
        crosswalk.get("schemaVersion") != "venviewer.panorama-e57-candidate-crosswalk-authority-none.v1"
        or crosswalk.get("authority") != "none"
    ):
        raise ValueError("T560 crosswalk schema or authority drifted")
    selected: dict[tuple[int, int], tuple[int, int, int]] = {}
    for raw in _list(crosswalk.get("results"), "T560 results"):
        row = _dict(raw, "T560 result")
        display = _dict(row.get("display"), "T560 display")
        sweep = _integer(display.get("sweepNumber"), "T560 display sweep")
        if sweep not in EXPECTED_SWEEPS:
            continue
        if row.get("state") != "candidate_human_pending" or row.get("humanReviewRequired") is not True:
            raise ValueError("T560 selected row is no longer human-pending")
        panorama = panorama_by_sweep[sweep]
        if (
            _digest(row.get("panoramaSha256"), "T560 panorama SHA-256") != panorama.sha256
            or display.get("relativePath") != panorama.relative_path
        ):
            raise ValueError("T560 selected panorama binding drifted")
        expected_guid = EXPECTED_GUIDS[sweep - EXPECTED_SWEEPS[0]]
        if row.get("candidateData3DGuid") != expected_guid:
            raise ValueError("T560 selected primary candidate GUID drifted")
        supported: list[dict[str, object]] = []
        for candidate_raw in _list(row.get("candidates"), "T560 candidates"):
            candidate = _dict(candidate_raw, "T560 candidate")
            if candidate.get("supported") is True:
                supported.append(candidate)
        expected_supported = 2 if sweep == ALTERNATE_SWEEP else 1
        if len(supported) != expected_supported:
            raise ValueError("T560 supported-candidate multiplicity drifted")
        primary_scan = EXPECTED_PRIMARY_SCANS[sweep - EXPECTED_SWEEPS[0]]
        expected_rows = [(
            primary_scan,
            EXPECTED_T560_PRIMARY_RATIO_MATCHES[sweep - EXPECTED_SWEEPS[0]],
            EXPECTED_T560_PRIMARY_INLIERS[sweep - EXPECTED_SWEEPS[0]],
        )]
        if sweep == ALTERNATE_SWEEP:
            expected_rows.append((ALTERNATE_SCAN, EXPECTED_T560_ALTERNATE_RATIO_MATCHES, EXPECTED_T560_ALTERNATE_INLIERS))
        observed: list[tuple[int, int, int, str]] = []
        for candidate in supported:
            scan = _integer(candidate.get("displayScanIndex"), "T560 candidate scan")
            ratio_matches = _integer(candidate.get("ratioMatchCount"), "T560 ratio matches")
            inliers = _integer(candidate.get("sphericalInlierCount"), "T560 spherical inliers")
            guid = _string(candidate.get("data3DGuid"), "T560 candidate GUID").lower()
            if candidate.get("cubeCoherent") is not True or candidate.get("globalReflectionApplied") is not True:
                raise ValueError("T560 supported candidate lost coherent reflected-cube state")
            observed.append((scan, ratio_matches, inliers, guid))
            selected[(sweep, scan)] = (ratio_matches, inliers, expected_supported)
        expected_observed = [
            (
                scan,
                ratio_matches,
                inliers,
                ALTERNATE_GUID if scan == ALTERNATE_SCAN else EXPECTED_GUIDS[scan - 40],
            )
            for scan, ratio_matches, inliers in expected_rows
        ]
        if observed != expected_observed:
            raise ValueError("T560 selected primary/alternate candidate evidence drifted")
    expected_keys = {
        *((sweep, scan) for sweep, scan in zip(EXPECTED_SWEEPS, EXPECTED_PRIMARY_SCANS)),
        (ALTERNATE_SWEEP, ALTERNATE_SCAN),
    }
    if set(selected) != expected_keys:
        raise ValueError("T560 selected candidate set is incomplete or unexpected")
    return selected


def _camera_rows(camera_subset: dict[str, object]) -> dict[int, dict[str, object]]:
    if camera_subset.get("schemaVersion") != "venviewer.grand-hall.camera-metric-subset.v1" or camera_subset.get("authority") != "none":
        raise ValueError("camera subset schema or authority drifted")
    contract = _dict(camera_subset.get("contract"), "camera subset contract")
    if contract.get("authority") != "none" or any(
        value is True for key, value in contract.items() if key != "authority"
    ):
        raise ValueError("camera subset contract opened an authority path")
    rows: dict[int, dict[str, object]] = {}
    for raw in _list(camera_subset.get("rows"), "camera subset rows"):
        row = _dict(raw, "camera subset row")
        scanner = _dict(row.get("e57Scanner"), "camera subset scanner")
        panorama = _dict(row.get("externalPanorama"), "camera subset panorama")
        correspondence = _dict(row.get("candidateCorrespondence"), "camera subset correspondence")
        scan = _integer(scanner.get("scanIndex"), "camera subset scan")
        sweep = _integer(panorama.get("sweepNumber"), "camera subset sweep")
        if scan not in EXPECTED_PRIMARY_SCANS:
            continue
        if (
            row.get("authority") != "none"
            or correspondence.get("state") != "candidate_human_pending"
            or correspondence.get("humanReviewRequired") is not True
            or scanner.get("poseAuthority") != "none"
            or scanner.get("orientationUseBlocked") is not True
            or panorama.get("orientationAuthority") != "none"
            or panorama.get("poseAuthority") != "none"
            or sweep != scan + 1
            or scanner.get("data3DGuid") != EXPECTED_GUIDS[scan - 40]
        ):
            raise ValueError("camera subset selected row authority or identity drifted")
        rows[scan] = row
    if tuple(sorted(rows)) != EXPECTED_PRIMARY_SCANS:
        raise ValueError("camera subset does not contain exact primary scans 40 through 47")
    return rows


def _t564_rows(result: dict[str, object]) -> dict[int, dict[str, object]]:
    if result.get("schemaVersion") != "venviewer.e57-cubeface-extrinsics-authority-none.v1" or result.get("authority") != "none":
        raise ValueError("T564 schema or authority drifted")
    contract = _dict(result.get("contract"), "T564 contract")
    permissions = _dict(contract.get("permissions"), "T564 permissions")
    if contract.get("orientationAuthority") != "none" or any(permissions.values()):
        raise ValueError("T564 authority or downstream permission opened")
    rows: dict[int, dict[str, object]] = {}
    for raw in _list(result.get("scanResults"), "T564 scans"):
        row = _dict(raw, "T564 scan")
        scan = _integer(row.get("scanIndex"), "T564 scan index")
        if scan not in EXPECTED_PRIMARY_SCANS:
            continue
        candidate = _dict(row.get("candidateCorrespondence"), "T564 candidate")
        if (
            row.get("data3DGuid") != EXPECTED_GUIDS[scan - 40]
            or row.get("winningBasisIds") != list(EXPECTED_BASIS_IDS)
            or candidate.get("accepted") is not False
            or candidate.get("humanReviewRequired") is not True
            or candidate.get("sweepNumber") != scan + 1
        ):
            raise ValueError("T564 selected scan identity or candidate state drifted")
        rows[scan] = row
    if tuple(sorted(rows)) != EXPECTED_PRIMARY_SCANS:
        raise ValueError("T564 does not contain exact primary scans 40 through 47")
    return rows


def _verify_receipt_binding(
    receipt: dict[str, object], relative_path: str, expected: tuple[int, str], label: str
) -> None:
    if label == "T561":
        guards = _dict(receipt.get("guards"), "T561 receipt guards")
        if (
            receipt.get("authority") != "none"
            or receipt.get("state") != "complete"
            or any(value is True for value in guards.values())
            or any(
                value not in (False, "none")
                for value in guards.values()
            )
        ):
            raise ValueError("T561 legacy receipt completion or authority drifted")
        matching = [
            _dict(item, "T561 receipt payload")
            for item in _list(receipt.get("payloads"), "T561 receipt payloads")
            if isinstance(item, dict) and item.get("relativePath") == relative_path
        ]
        if (
            len(matching) != 1
            or matching[0].get("byteLength") != expected[0]
            or _digest(matching[0].get("sha256"), "T561 receipt payload SHA-256")
            != expected[1]
        ):
            raise ValueError("T561 legacy receipt no longer binds the exact result")
        return
    if receipt.get("authority") != "none" or receipt.get("publicationComplete") is not True or receipt.get("receiptWrittenLast") is not True:
        raise ValueError(f"{label} receipt completion or authority drifted")
    files = receipt.get("files")
    if isinstance(files, list):
        matching = [
            _dict(item, f"{label} receipt file") for item in files
            if isinstance(item, dict) and item.get("relativePath") == relative_path
        ]
        if len(matching) != 1 or matching[0].get("sizeBytes") != expected[0] or matching[0].get("sha256") != expected[1]:
            raise ValueError(f"{label} receipt no longer binds the exact result")
        return
    manifest = _dict(receipt.get("manifest"), f"{label} receipt manifest")
    if manifest.get("relativePath") != relative_path or manifest.get("sizeBytes") != expected[0] or manifest.get("sha256") != expected[1]:
        raise ValueError(f"{label} receipt no longer binds the exact manifest")


def prepare_inputs(inputs: FrozenInputs, repo_root: Path) -> PreparedInputs:
    control_files, values = _bind_control_files(inputs, repo_root)
    _verify_receipt_binding(values["t559Receipt"], "image2d-inventory-authority-none.json", FROZEN_T559_MANIFEST, "T559")
    _verify_receipt_binding(values["t560Receipt"], "panorama-image2d-crosswalk-authority-none.json", FROZEN_T560_CROSSWALK, "T560")
    _verify_receipt_binding(values["t561Receipt"], "panorama-visual-observations-authority-none.json", FROZEN_T561_RESULT, "T561")
    _verify_receipt_binding(values["t564Receipt"], "cubeface-extrinsics-authority-none.json", FROZEN_T564_RESULT, "T564")

    selected_t561 = _selected_panorama_records(values["t561Result"])
    panoramas, panorama_files = _build_panoramas(inputs.panorama_root, selected_t561)
    scans, face_files = _build_scans(inputs.image2d_root, values["t559Manifest"])
    panorama_by_sweep = {value.display_sweep_number: value for value in panoramas}
    scan_by_index = {value.display_scan_index: value for value in scans}
    candidates = _crosswalk_candidates(values["t560Crosswalk"], panorama_by_sweep)
    camera_rows = _camera_rows(values["cameraSubset"])
    t564_by_scan = _t564_rows(values["t564Result"])

    pairs: list[PairSource] = []
    for sweep, scan in zip(EXPECTED_SWEEPS, EXPECTED_PRIMARY_SCANS):
        row = camera_rows[scan]
        scanner = _dict(row.get("e57Scanner"), "camera subset scanner")
        panorama = _dict(row.get("externalPanorama"), "camera subset panorama")
        if (
            _digest(panorama.get("sha256"), "camera subset panorama SHA-256") != panorama_by_sweep[sweep].sha256
            or panorama.get("relativePath") != panorama_by_sweep[sweep].relative_path
        ):
            raise ValueError("camera subset panorama differs from exact T561 source")
        pose = _dict(t564_by_scan[scan].get("data3DPose"), "T564 Data3D pose")
        quaternion = _finite_tuple(scanner.get("rotationQuaternionWxyz"), 4, "camera subset quaternion")
        translation = _finite_tuple(scanner.get("translationM"), 3, "camera subset translation")
        if (
            pose.get("rotationQuaternionWxyz") != list(quaternion)
            or pose.get("translationM") != list(translation)
        ):
            raise ValueError("camera subset and T564 Data3D q/t differ")
        ratio_matches, inliers, supported_count = candidates[(sweep, scan)]
        caveat = "two_matcher_supported_candidates_human_review_required" if sweep == ALTERNATE_SWEEP else None
        pairs.append(PairSource(
            f"sweep-{sweep:03d}-scan-{scan:03d}-primary", sweep, scan,
            EXPECTED_GUIDS[scan - 40], True, panorama_by_sweep[sweep], scan_by_index[scan],
            quaternion, translation, ratio_matches, inliers, supported_count, caveat,
            selected_t561[sweep][1],
        ))
        if sweep == ALTERNATE_SWEEP:
            alternate_ratio, alternate_inliers, alternate_count = candidates[(sweep, ALTERNATE_SCAN)]
            pairs.append(PairSource(
                "sweep-047-scan-010-alternate", sweep, ALTERNATE_SCAN,
                ALTERNATE_GUID, False, panorama_by_sweep[sweep], scan_by_index[ALTERNATE_SCAN],
                None, None, alternate_ratio, alternate_inliers, alternate_count,
                "supported_same_or_near_station_revisit_human_comparison_required",
                selected_t561[sweep][1],
            ))
    if len(pairs) != 9 or sum(not pair.is_primary for pair in pairs) != 1:
        raise ValueError("candidate plan must contain eight primary rows and one visible alternate")
    source_files = (*panorama_files, *face_files)
    if len(source_files) != EXPECTED_SOURCE_IMAGE_COUNT or len({item.path for item in source_files}) != EXPECTED_SOURCE_IMAGE_COUNT:
        raise ValueError("source image custody is not the exact 62-file set")
    return PreparedInputs(
        control_files, tuple(source_files), tuple(pairs), panoramas, scans, t564_by_scan
    )


def _verify_prepared_inputs(prepared: PreparedInputs) -> None:
    for item in (*prepared.control_files, *prepared.source_files):
        if _snapshot(item.path) != item.snapshot:
            raise ValueError(f"bound input changed after preparation: {item.relative_path}")
    t560.verify_source_snapshots(prepared.unique_panoramas, prepared.unique_scans)


def _git_head(repo_root: Path) -> str:
    completed = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=repo_root,
        check=True, capture_output=True, text=True, timeout=30,
    )
    value = completed.stdout.strip()
    if GIT_SHA_RE.fullmatch(value) is None:
        raise ValueError("repository HEAD is not a concrete lowercase Git SHA")
    return value


def _generator_binding(repo_root: Path, reviewed_git_sha: str) -> dict[str, object]:
    if GIT_SHA_RE.fullmatch(reviewed_git_sha) is None or reviewed_git_sha == "0" * 40:
        raise ValueError("reviewed Git SHA must be a concrete lowercase commit")
    if _git_head(repo_root) != reviewed_git_sha:
        raise ValueError("reviewed Git SHA differs from checked-out HEAD")
    status = subprocess.run(
        ["git", "status", "--porcelain=v1", "--untracked-files=all", "--", *GENERATOR_RELATIVE_PATHS],
        cwd=repo_root, check=True, capture_output=True, text=True, timeout=30,
    )
    if status.stdout:
        raise ValueError("orientation generator surface is dirty or untracked")
    files: list[dict[str, object]] = []
    for relative in GENERATOR_RELATIVE_PATHS:
        path = repo_root / Path(relative)
        snapshot = _snapshot(path)
        working = _read_stable(path, snapshot)
        committed = subprocess.run(
            ["git", "show", f"{reviewed_git_sha}:{relative}"], cwd=repo_root,
            check=True, capture_output=True, timeout=30,
        ).stdout
        if working != committed:
            filtered_object = subprocess.run(
                ["git", "hash-object", f"--path={relative}", "--", relative],
                cwd=repo_root, check=True, capture_output=True, text=True, timeout=30,
            ).stdout.strip()
            committed_object = subprocess.run(
                ["git", "rev-parse", f"{reviewed_git_sha}:{relative}"],
                cwd=repo_root, check=True, capture_output=True, text=True, timeout=30,
            ).stdout.strip()
            if filtered_object != committed_object:
                raise ValueError(f"generator file differs from reviewed Git blob: {relative}")
        files.append({
            "relativePath": relative,
            "sha256": sha256_bytes(working),
            "sizeBytes": len(working),
        })
    expected_core = (repo_root / GENERATOR_RELATIVE_PATHS[0]).resolve(strict=True)
    expected_builder = (repo_root / GENERATOR_RELATIVE_PATHS[1]).resolve(strict=True)
    if Path(orientation_core.__file__).resolve(strict=True) != expected_core or Path(__file__).resolve(strict=True) != expected_builder:
        raise ValueError("loaded orientation generator module origin drifted")
    return {"files": files, "reviewedGitSha": reviewed_git_sha}


def _source_binding(item: BoundFile) -> dict[str, object]:
    return {
        "relativePath": item.relative_path,
        "sha256": item.sha256,
        "sizeBytes": item.size_bytes,
    }


def _decode_rgb(item: BoundFile, backend: t560.OpenCvSiftBackend) -> object:
    content = _read_stable(item.path, item.snapshot)
    if sha256_bytes(content) != item.sha256:
        raise ValueError(f"source bytes drifted before review rendering: {item.relative_path}")
    encoded = backend.np.frombuffer(content, dtype=backend.np.uint8)
    image = backend.cv2.imdecode(encoded, backend.cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"source JPEG failed exact OpenCV decode: {item.relative_path}")
    return backend.cv2.cvtColor(image, backend.cv2.COLOR_BGR2RGB)


def _encode_png(image_rgb: object, backend: t560.OpenCvSiftBackend) -> bytes:
    value = backend.np.asarray(image_rgb)
    if value.ndim != 3 or value.shape[2] != 3 or value.dtype != backend.np.uint8:
        raise ValueError("review image must be RGB8")
    bgr = backend.cv2.cvtColor(value, backend.cv2.COLOR_RGB2BGR)
    ok, encoded = backend.cv2.imencode(
        ".png", bgr, [backend.cv2.IMWRITE_PNG_COMPRESSION, 9]
    )
    if not ok:
        raise ValueError("OpenCV failed deterministic PNG encoding")
    content = bytes(encoded)
    if not content.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("review encoder did not return a PNG")
    return content


def _resize(image: object, width: int, height: int, backend: t560.OpenCvSiftBackend) -> object:
    interpolation = backend.cv2.INTER_AREA if image.shape[1] >= width else backend.cv2.INTER_LANCZOS4
    return backend.cv2.resize(image, (width, height), interpolation=interpolation)


def _label_panel(image: object, label: str, backend: t560.OpenCvSiftBackend) -> object:
    result = image.copy()
    backend.cv2.rectangle(result, (0, 0), (result.shape[1], 46), (0, 0, 0), -1)
    backend.cv2.putText(
        result, label, (18, 32), backend.cv2.FONT_HERSHEY_SIMPLEX,
        0.78, (255, 255, 255), 2, backend.cv2.LINE_AA,
    )
    return result


def _draw_attention(
    image: object, rectangles: tuple[AttentionRectangle, ...], backend: t560.OpenCvSiftBackend
) -> object:
    result = image.copy()
    sx, sy = REVIEW_PANEL_WIDTH / 8192, REVIEW_PANEL_HEIGHT / 4096
    for rectangle in rectangles:
        start = (round(rectangle.x * sx), round(rectangle.y * sy))
        end = (round((rectangle.x + rectangle.width) * sx), round((rectangle.y + rectangle.height) * sy))
        backend.cv2.rectangle(result, start, end, (255, 210, 0), 5)
    for degrees in (0, 90, 180, 270):
        x = min(REVIEW_PANEL_WIDTH - 1, round(REVIEW_PANEL_WIDTH * degrees / 360))
        backend.cv2.line(result, (x, 46), (x, 70), (255, 255, 255), 2)
        backend.cv2.putText(result, f"{degrees}d", (x + 5, 88), backend.cv2.FONT_HERSHEY_SIMPLEX, 0.48, (255, 255, 255), 1, backend.cv2.LINE_AA)
    return result


def _checkerboard(external: object, native: object, backend: t560.OpenCvSiftBackend) -> object:
    yy, xx = backend.np.indices((REVIEW_PANEL_HEIGHT, REVIEW_PANEL_WIDTH))
    select_native = ((xx // REVIEW_TILE_PX) + (yy // REVIEW_TILE_PX)) % 2 == 1
    return backend.np.where(select_native[..., None], native, external).astype(backend.np.uint8)


def _edge_overlay(external: object, native: object, backend: t560.OpenCvSiftBackend) -> object:
    gray_external = backend.cv2.cvtColor(external, backend.cv2.COLOR_RGB2GRAY)
    gray_native = backend.cv2.cvtColor(native, backend.cv2.COLOR_RGB2GRAY)
    edge_external = backend.cv2.Canny(gray_external, 60, 150) > 0
    edge_native = backend.cv2.Canny(gray_native, 60, 150) > 0
    base = ((external.astype(backend.np.uint16) + native.astype(backend.np.uint16)) // 5).astype(backend.np.uint8)
    base[edge_external] = (255, 0, 255)
    base[edge_native] = (0, 255, 255)
    base[edge_external & edge_native] = (255, 255, 255)
    return base


def _draw_match_points(
    image: object, panorama_points: object, final_inliers: object,
    feature_width: int, feature_height: int, backend: t560.OpenCvSiftBackend,
) -> object:
    result = image.copy()
    points = backend.np.asarray(panorama_points)
    mask = backend.np.asarray(final_inliers)
    if len(points) != len(mask):
        raise ValueError("match-point overlay vectors do not align")
    step = max(1, math.ceil(len(points) / 220))
    for index in range(0, len(points), step):
        point = points[index]
        x = round(float(point[0]) / feature_width * REVIEW_PANEL_WIDTH)
        y = round(float(point[1]) / feature_height * REVIEW_PANEL_HEIGHT)
        colour = (60, 255, 80) if bool(mask[index]) else (255, 150, 30)
        backend.cv2.circle(result, (x, y), 5, colour, 2, backend.cv2.LINE_AA)
    return result


def _face_strip(cubefaces: Sequence[object], backend: t560.OpenCvSiftBackend) -> object:
    canvas = backend.np.zeros((REVIEW_FACE_HEIGHT, REVIEW_PANEL_WIDTH * 2, 3), dtype=backend.np.uint8)
    tile = REVIEW_FACE_HEIGHT
    gap = (canvas.shape[1] - tile * 6) // 7
    for face_index, image in enumerate(cubefaces):
        thumb = _resize(image, tile, tile, backend)
        x = gap + face_index * (tile + gap)
        canvas[:, x:x + tile] = thumb
        backend.cv2.rectangle(canvas, (x, 0), (x + tile - 1, 44), (0, 0, 0), -1)
        backend.cv2.putText(canvas, f"native face {face_index}", (x + 12, 31), backend.cv2.FONT_HERSHEY_SIMPLEX, 0.62, (255, 255, 255), 2, backend.cv2.LINE_AA)
    return canvas


def _review_board(
    pair: PairSource,
    panorama_rgb: object,
    cubeface_rgbs: Sequence[object],
    native_rgb: object,
    valid_mask: object,
    panorama_points: object,
    final_inliers: object,
    feature_width: int,
    feature_height: int,
    backend: t560.OpenCvSiftBackend,
) -> object:
    external = _resize(panorama_rgb, REVIEW_PANEL_WIDTH, REVIEW_PANEL_HEIGHT, backend)
    native = backend.np.asarray(native_rgb).copy()
    valid = backend.np.asarray(valid_mask, dtype=bool)
    if native.shape != external.shape or valid.shape != external.shape[:2]:
        raise ValueError("reprojected review image shape drifted")
    native[~valid] = INVALID_REPROJECTION_RGB
    external = _draw_attention(external, pair.attention_rectangles, backend)
    external = _label_panel(external, "EXACT EXTERNAL PANORAMA - yellow = T561 boundary attention", backend)
    native = _label_panel(native, "SIX EXACT NATIVE FACES - rigid spherical reprojection; magenta = no sample", backend)
    checker = _checkerboard(external, native, backend)
    checker = _draw_match_points(checker, panorama_points, final_inliers, feature_width, feature_height, backend)
    checker = _label_panel(checker, "SOURCE CHECKERBOARD - green inlier / orange outlier; no deforming warp", backend)
    edges = _label_panel(_edge_overlay(external, native, backend), "SOURCE EDGES - magenta external / cyan native / white agreement", backend)
    upper = backend.np.concatenate((external, native), axis=1)
    middle = backend.np.concatenate((checker, edges), axis=1)
    faces = _face_strip(cubeface_rgbs, backend)
    header = backend.np.zeros((REVIEW_HEADER_HEIGHT, REVIEW_PANEL_WIDTH * 2, 3), dtype=backend.np.uint8)
    kind = "PRIMARY CANDIDATE" if pair.is_primary else "VISIBLE ALTERNATE - NO E57 PHYSICAL POSE COMPOSED"
    lines = (
        f"{kind}: sweep {pair.sweep_number:03d} <-> scan {pair.scan_index:03d} | authority NONE | HUMAN PENDING",
        "SOURCE-ONLY DIAGNOSTIC. Doorways, windows, capture occlusions and room-pixel scope remain unaccepted.",
    )
    for index, line in enumerate(lines):
        backend.cv2.putText(header, line, (22, 40 + index * 42), backend.cv2.FONT_HERSHEY_SIMPLEX, 0.82 if index == 0 else 0.62, (255, 255, 255), 2, backend.cv2.LINE_AA)
    return backend.np.concatenate((header, upper, middle, faces), axis=0)


def _contact_sheet(derivations: Sequence[PairDerivation], backend: t560.OpenCvSiftBackend) -> bytes:
    if len(derivations) != 9:
        raise ValueError("contact sheet requires eight primaries plus one alternate")
    cell_height = CONTACT_LABEL_HEIGHT + CONTACT_THUMB_HEIGHT
    canvas = backend.np.zeros((cell_height * 3, CONTACT_THUMB_WIDTH * CONTACT_COLUMNS, 3), dtype=backend.np.uint8)
    for index, derived in enumerate(derivations):
        encoded = backend.np.frombuffer(derived.review_png, dtype=backend.np.uint8)
        bgr = backend.cv2.imdecode(encoded, backend.cv2.IMREAD_COLOR)
        if bgr is None:
            raise ValueError("fresh review PNG failed contact-sheet decode")
        rgb = backend.cv2.cvtColor(bgr, backend.cv2.COLOR_BGR2RGB)
        thumb = _resize(rgb, CONTACT_THUMB_WIDTH, CONTACT_THUMB_HEIGHT, backend)
        row, column = divmod(index, CONTACT_COLUMNS)
        y, x = row * cell_height, column * CONTACT_THUMB_WIDTH
        canvas[y + CONTACT_LABEL_HEIGHT:y + cell_height, x:x + CONTACT_THUMB_WIDTH] = thumb
        label = f"{derived.pair.pair_id} | AUTHORITY NONE | HUMAN PENDING"
        backend.cv2.putText(canvas, label, (x + 12, y + 34), backend.cv2.FONT_HERSHEY_SIMPLEX, 0.56, (255, 255, 255), 1, backend.cv2.LINE_AA)
    return _encode_png(canvas, backend)


def _pair_correspondences(
    pair: PairSource,
    panorama_feature: object,
    scan_feature: object,
    backend: t560.OpenCvSiftBackend,
) -> tuple[
    object, object, object, object, object, tuple[str, ...],
    tuple[dict[str, object], ...], int, int,
]:
    selected = backend._unique_scan_matches(panorama_feature, scan_feature)
    source_parts: list[object] = []
    target_parts: list[object] = []
    panorama_point_parts: list[object] = []
    face_point_parts: list[object] = []
    face_indices: list[int] = []
    query_indices: list[int] = []
    train_indices: list[int] = []
    for face in sorted(scan_feature.faces, key=lambda value: value.face_index):
        matches = [match for owner, match in selected if owner.face_index == face.face_index]
        queries = [match.queryIdx for match in matches]
        trains = [match.trainIdx for match in matches]
        face_points = backend._points(face.feature)[queries]
        panorama_points = backend._points(panorama_feature.feature)[trains]
        source_parts.append(backend._cubemap_rays(face_points, face))
        # OpenCV keypoints are float32.  T560's inherited diagnostic helper
        # preserves that dtype through trigonometry, which is accurate enough
        # for matching but not for this pack's 1e-9 unit-ray provenance gate.
        # Recompute the identical spherical convention in the reviewed T565
        # float64 implementation so real pixels do not fail on representation
        # noise before the geometric evidence gates run.
        target_parts.append(orientation_core.equirectangular_pixels_to_rays(
            panorama_points,
            panorama_feature.feature.width,
            panorama_feature.feature.height,
        ))
        panorama_point_parts.append(panorama_points)
        face_point_parts.append(face_points)
        face_indices.extend([face.face_index] * len(matches))
        query_indices.extend(queries)
        train_indices.extend(trains)
    if not source_parts:
        raise ValueError(f"pair {pair.pair_id} produced no source-derived matches")
    source = backend.np.concatenate(source_parts)
    target = backend.np.concatenate(target_parts)
    panorama_points = backend.np.concatenate(panorama_point_parts)
    face_points = backend.np.concatenate(face_point_parts)
    faces = backend.np.asarray(face_indices, dtype=backend.np.int64)
    if len(source) != pair.t560_ratio_match_count:
        raise ValueError(f"pair {pair.pair_id} ratio-match count differs from frozen T560")
    partition = orientation_core.build_match_partition(
        f"sha256:{pair.panorama.sha256}", pair.data3d_guid,
        face_indices, query_indices, train_indices,
    )
    order = backend.np.asarray(
        sorted(range(len(source)), key=lambda index: partition.identity_digests[index]),
        dtype=backend.np.int64,
    )
    identities = tuple(partition.identity_digests[int(index)] for index in order)
    records = tuple(
        {
            "externalPanoramaFeaturePixel2048x1024": [
                float(panorama_points[int(index), 0]),
                float(panorama_points[int(index), 1]),
            ],
            "faceFeaturePixel512x512": [
                float(face_points[int(index), 0]),
                float(face_points[int(index), 1]),
            ],
            "faceIndex": int(face_indices[int(index)]),
            "faceQueryIndex": int(query_indices[int(index)]),
            "foldIndex": int(partition.fold_indices[int(index)]),
            "identitySha256": partition.identity_digests[int(index)],
            "panoramaTrainIndex": int(train_indices[int(index)]),
        }
        for index in order
    )
    return (
        source[order], target[order], faces[order],
        partition.fold_indices[order], panorama_points[order], identities, records,
        partition.seed, len(selected),
    )


def _derive_pair(
    pair: PairSource,
    panorama_feature: object,
    scan_feature: object,
    bound_by_path: dict[Path, BoundFile],
    backend: t560.OpenCvSiftBackend,
) -> PairDerivation:
    source, target, faces, folds, panorama_points, identities, records, seed, match_count = _pair_correspondences(
        pair, panorama_feature, scan_feature, backend
    )
    fit = orientation_core.solve_cross_validated_orientation(
        source, target, faces, seed, orientation_core.OrientationThresholds(),
        fold_indices=folds, match_identity_digests=identities,
    )
    fit_json = orientation_core.orientation_fit_json(fit)
    orientation_core.validate_authority_none_result(fit_json)
    if fit.match_count != match_count or not fit.global_reflection_applied:
        raise ValueError(f"pair {pair.pair_id} changed match population or chirality")

    candidate_pose: dict[str, object] | None = None
    if pair.is_primary:
        if pair.quaternion_wxyz is None or pair.translation_m is None:
            raise ValueError("primary orientation lacks exact authority-none Data3D q/t")
        e57_from_scanner, norm_error = orientation_core.quaternion_wxyz_to_rotation(pair.quaternion_wxyz)
        extrinsics = orientation_core.compose_panorama_camera_extrinsics(
            e57_from_scanner, pair.translation_m,
            fit.rotation_panorama_from_scanner, fit.global_reflection_applied,
        )
        candidate_pose = {
            "accepted": False,
            "authority": "none",
            "cameraCenterState": "conditional_scanner_origin_zero_offset_hypothesis_unaccepted",
            "compositionState": "candidate_only_requires_correspondence_and_orientation_human_acceptance",
            "data3DQuaternionNormError": norm_error,
            "data3DRotationQuaternionWxyz": list(pair.quaternion_wxyz),
            "data3DTranslationM": list(pair.translation_m),
            "extrinsics": extrinsics,
            "humanReviewRequired": True,
        }

    panorama_rgb = _decode_rgb(bound_by_path[pair.panorama.path], backend)
    cubeface_rgbs = [_decode_rgb(bound_by_path[face.path], backend) for face in pair.scan.faces]
    if panorama_rgb.shape != (4096, 8192, 3) or any(image.shape != (4096, 4096, 3) for image in cubeface_rgbs):
        raise ValueError("decoded source dimensions drifted before source-only rendering")
    native_rgb, valid = orientation_core.reproject_cubefaces_to_equirect(
        cubeface_rgbs, fit.rotation_panorama_from_scanner,
        fit.global_reflection_applied, REVIEW_PANEL_WIDTH, REVIEW_PANEL_HEIGHT,
    )
    board = _review_board(
        pair, panorama_rgb, cubeface_rgbs, native_rgb, valid,
        panorama_points, fit.final_inliers,
        panorama_feature.feature.width, panorama_feature.feature.height, backend,
    )
    png = _encode_png(board, backend)
    name = f"orientation-review-{pair.pair_id}-source-only.png"
    return PairDerivation(
        pair, fit_json, identities, records, candidate_pose, name, png,
        int(board.shape[1]), int(board.shape[0]),
    )


def _authority_guards() -> dict[str, object]:
    return dict(orientation_core.AUTHORITY_NONE_GUARDS)


def _pair_result(derived: PairDerivation) -> dict[str, object]:
    pair = derived.pair
    return {
        "authority": "none",
        "candidateCorrespondence": {
            "accepted": False,
            "candidateKind": "primary" if pair.is_primary else "supported_alternate",
            "caveat": pair.t560_caveat,
            "humanReviewRequired": True,
            "supportedCandidateCount": pair.t560_supported_candidate_count,
            "t560RatioMatchCount": pair.t560_ratio_match_count,
            "t560SphericalInlierCount": pair.t560_spherical_inliers,
        },
        "candidateE57Pose": derived.candidate_pose,
        "data3DGuid": pair.data3d_guid,
        "guards": _authority_guards(),
        "humanDecisionOptions": (
            ["scan46", "scan10", "both_same_station_revisit_unresolved", "neither", "unsure"]
            if pair.sweep_number == 47 else ["accept_candidate", "reject_candidate", "unsure"]
        ),
        "humanReviewGates": {
            "allVisiblePixelsGrandHall": "pending",
            "cameraCorrespondence": "pending",
            "cameraStationInsideGrandHall": "pending",
            "doorwayWindowOcclusionMasks": "pending",
            "externalPanoramaOrientation": "pending",
        },
        "matchIdentityDigests": list(derived.match_identity_digests),
        "matchRecords": list(derived.match_records),
        "nativeCubefaces": [
            {
                "faceIndex": face.face_index,
                "relativePath": f"t559/images/scan_{pair.scan_index:03d}/{face.path.name}",
                "sha256": face.sha256,
            }
            for face in pair.scan.faces
        ],
        "orientationProposal": derived.fit_json,
        "pairId": pair.pair_id,
        "physicalE57PoseComposed": derived.candidate_pose is not None,
        "reviewAid": {
            "authority": "none",
            "heightPx": derived.review_height,
            "relativePath": derived.review_name,
            "role": "source_only_human_review_diagnostic",
            "sha256": sha256_bytes(derived.review_png),
            "sizeBytes": len(derived.review_png),
            "widthPx": derived.review_width,
        },
        "scanIndex": pair.scan_index,
        "sourceExternalPanorama": {
            "relativePath": pair.panorama.relative_path,
            "sha256": pair.panorama.sha256,
            "sweepNumber": pair.sweep_number,
        },
        "state": "orientation_proposal_human_pending",
        "t561BoundaryAttentionRectangles": [
            {"height": value.height, "width": value.width, "x": value.x, "y": value.y}
            for value in pair.attention_rectangles
        ],
    }


def derive_pack(
    prepared: PreparedInputs,
    backend: t560.OpenCvSiftBackend,
    generator: dict[str, object],
    dependency: object,
) -> DerivedPack:
    _verify_prepared_inputs(prepared)
    panorama_features = {
        source.display_sweep_number: t560.build_panorama_descriptor(source, backend)
        for source in prepared.unique_panoramas
    }
    scan_features = {
        source.display_scan_index: t560.build_native_scan_descriptor(source, backend)
        for source in prepared.unique_scans
    }
    bound_by_path = {item.path: item for item in prepared.source_files}
    derivations = tuple(
        _derive_pair(
            pair, panorama_features[pair.sweep_number], scan_features[pair.scan_index],
            bound_by_path, backend,
        )
        for pair in prepared.pairs
    )
    contact = _contact_sheet(derivations, backend)
    contact_name = "orientation-review-contact-sheet-source-only.png"
    files = {derived.review_name: derived.review_png for derived in derivations}
    files[contact_name] = contact
    source_bindings = {
        "controlFiles": [_source_binding(item) for item in prepared.control_files],
        "sourceImages": [_source_binding(item) for item in prepared.source_files],
    }
    generator_digest = sha256_bytes(canonical_json_bytes(generator))
    result = {
        "authority": "none",
        "contract": {
            "exactSourceImageCount": EXPECTED_SOURCE_IMAGE_COUNT,
            "generatedContentUsed": False,
            "humanReviewRequired": True,
            "networkAccessUsed": False,
            "permissions": _authority_guards(),
            "sourceMutationPermitted": False,
            "truthScope": TRUTH_SCOPE,
        },
        "dependencyAttestation": dependency_attestation_json(dependency),
        "generator": generator,
        "generatorSha256": generator_digest,
        "pairResults": [_pair_result(value) for value in derivations],
        "reviewContactSheet": {
            "authority": "none",
            "heightPx": (CONTACT_LABEL_HEIGHT + CONTACT_THUMB_HEIGHT) * 3,
            "relativePath": contact_name,
            "role": "source_only_nine_candidate_contact_sheet",
            "sha256": sha256_bytes(contact),
            "sizeBytes": len(contact),
            "widthPx": CONTACT_THUMB_WIDTH * CONTACT_COLUMNS,
        },
        "schemaVersion": RESULT_SCHEMA,
        "sourceBindings": source_bindings,
        "sourceBindingsSha256": sha256_bytes(canonical_json_bytes(source_bindings)),
        "summary": {
            "acceptedCorrespondenceCount": 0,
            "acceptedOrientationCount": 0,
            "alternatePairCount": 1,
            "externalPanoramaCount": 8,
            "nativeCubefaceCount": 54,
            "pairCount": 9,
            "physicalCandidatePoseCount": 8,
            "reviewAidCount": 10,
            "winnerAuthority": "none",
        },
        "warnings": [
            "Every orientation and correspondence remains human-pending and authority-none.",
            "Sweep 47 has two visibly rendered supported candidates: primary scan 46 and alternate scan 10.",
            "The scan-10 alternate has no T564 solve, so no E57 physical pose was composed for it.",
            "Doorways, windows, capture occlusions and T561 attention regions are not accepted Grand Hall masks.",
            "Review PNGs are source-only diagnostics and are forbidden as training, reconstruction, runtime or public evidence inputs.",
        ],
    }
    validate_result(result)
    _verify_prepared_inputs(prepared)
    return DerivedPack(result, files)


def _require_exact_keys(
    value: dict[str, object], expected: set[str], label: str
) -> None:
    if set(value) != expected:
        raise ValueError(
            f"{label} keys differ; missing={sorted(expected - set(value))}, "
            f"unexpected={sorted(set(value) - expected)}"
        )


def _finite_json(value: object, label: str = "JSON") -> None:
    if value is None or isinstance(value, (str, bool, int)):
        return
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError(f"{label} contains a non-finite number")
        return
    if isinstance(value, list):
        for index, item in enumerate(value):
            _finite_json(item, f"{label}[{index}]")
        return
    if isinstance(value, dict):
        if any(not isinstance(key, str) for key in value):
            raise ValueError(f"{label} contains a non-string key")
        for key, item in value.items():
            _finite_json(item, f"{label}.{key}")
        return
    raise ValueError(f"{label} contains a non-JSON value")


def _validate_relative_path(value: object, label: str) -> str:
    text = _string(value, label)
    pure = PurePosixPath(text)
    if (
        "\\" in text
        or pure.is_absolute()
        or not pure.parts
        or any(part in ("", ".", "..") or ":" in part for part in pure.parts)
    ):
        raise ValueError(f"{label} is not a canonical relative path")
    return text


def _validate_binding(value: object, label: str) -> dict[str, object]:
    item = _dict(value, label)
    _require_exact_keys(item, {"relativePath", "sha256", "sizeBytes"}, label)
    _validate_relative_path(item.get("relativePath"), f"{label} path")
    if (
        SHA256_RE.fullmatch(_string(item.get("sha256"), f"{label} SHA-256")) is None
        or _integer(item.get("sizeBytes"), f"{label} size") <= 0
    ):
        raise ValueError(f"{label} identity is invalid")
    return item


def _warnings() -> list[str]:
    return [
        "Every orientation and correspondence remains human-pending and authority-none.",
        "Sweep 47 has two visibly rendered supported candidates: primary scan 46 and alternate scan 10.",
        "The scan-10 alternate has no T564 solve, so no E57 physical pose was composed for it.",
        "Doorways, windows, capture occlusions and T561 attention regions are not accepted Grand Hall masks.",
        "Review PNGs are source-only diagnostics and are forbidden as training, reconstruction, runtime or public evidence inputs.",
    ]


def _expected_pair_plan() -> list[tuple[str, int, int, bool]]:
    result: list[tuple[str, int, int, bool]] = []
    for sweep, scan in zip(EXPECTED_SWEEPS, EXPECTED_PRIMARY_SCANS):
        result.append((f"sweep-{sweep:03d}-scan-{scan:03d}-primary", sweep, scan, True))
        if sweep == ALTERNATE_SWEEP:
            result.append(("sweep-047-scan-010-alternate", sweep, ALTERNATE_SCAN, False))
    return result


def _validate_review_aid(value: object, expected_name: str, label: str) -> None:
    item = _dict(value, label)
    _require_exact_keys(
        item,
        {"authority", "heightPx", "relativePath", "role", "sha256", "sizeBytes", "widthPx"},
        label,
    )
    if (
        item.get("authority") != "none"
        or item.get("relativePath") != expected_name
        or item.get("role") != "source_only_human_review_diagnostic"
        or item.get("widthPx") != REVIEW_PANEL_WIDTH * 2
        or item.get("heightPx")
        != REVIEW_HEADER_HEIGHT + REVIEW_PANEL_HEIGHT * 2 + REVIEW_FACE_HEIGHT
        or _integer(item.get("sizeBytes"), f"{label} size") <= 0
        or SHA256_RE.fullmatch(_string(item.get("sha256"), f"{label} SHA-256")) is None
    ):
        raise ValueError(f"{label} identity or source-only role drifted")


def _matrix3(value: object, label: str) -> list[list[float]]:
    rows = _list(value, label)
    if len(rows) != 3:
        raise ValueError(f"{label} must be 3x3")
    return [list(_finite_tuple(row, 3, f"{label} row {index}")) for index, row in enumerate(rows)]


def _transpose3(value: list[list[float]]) -> list[list[float]]:
    return [[value[column][row] for column in range(3)] for row in range(3)]


def _matmul3(left: list[list[float]], right: list[list[float]]) -> list[list[float]]:
    return [
        [sum(left[row][inner] * right[inner][column] for inner in range(3)) for column in range(3)]
        for row in range(3)
    ]


def _matvec3(matrix: list[list[float]], vector: Sequence[float]) -> list[float]:
    return [sum(matrix[row][column] * vector[column] for column in range(3)) for row in range(3)]


def _determinant3(value: list[list[float]]) -> float:
    return (
        value[0][0] * (value[1][1] * value[2][2] - value[1][2] * value[2][1])
        - value[0][1] * (value[1][0] * value[2][2] - value[1][2] * value[2][0])
        + value[0][2] * (value[1][0] * value[2][1] - value[1][1] * value[2][0])
    )


def _assert_matrix_close(actual: list[list[float]], expected: list[list[float]], label: str) -> None:
    if max(abs(actual[row][column] - expected[row][column]) for row in range(3) for column in range(3)) > 1e-10:
        raise ValueError(f"{label} differs from the source-bound composition")


def _proper_matrix(value: object, label: str) -> list[list[float]]:
    matrix = _matrix3(value, label)
    identity = _matmul3(_transpose3(matrix), matrix)
    _assert_matrix_close(identity, [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]], label)
    if abs(_determinant3(matrix) - 1.0) > 1e-10:
        raise ValueError(f"{label} is not a proper rotation")
    return matrix


def _quaternion_rotation(value: Sequence[float], label: str) -> tuple[list[list[float]], float]:
    w, x, y, z = value
    norm = math.sqrt(sum(component * component for component in value))
    error = abs(norm - 1.0)
    if norm == 0.0 or error > 1e-6:
        raise ValueError(f"{label} norm exceeds tolerance")
    w, x, y, z = (component / norm for component in (w, x, y, z))
    return _proper_matrix(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ],
        label,
    ), error


def _validate_candidate_pose(
    value: object, primary: bool, label: str, orientation_proposal: dict[str, object]
) -> None:
    if not primary:
        if value is not None:
            raise ValueError("scan-10 alternate cannot claim a T564-composed E57 pose")
        return
    pose = _dict(value, label)
    _require_exact_keys(
        pose,
        {
            "accepted", "authority", "cameraCenterState", "compositionState",
            "data3DQuaternionNormError", "data3DRotationQuaternionWxyz",
            "data3DTranslationM", "extrinsics", "humanReviewRequired",
        },
        label,
    )
    if (
        pose.get("accepted") is not False
        or pose.get("authority") != "none"
        or pose.get("humanReviewRequired") is not True
        or pose.get("cameraCenterState")
        != "conditional_scanner_origin_zero_offset_hypothesis_unaccepted"
        or pose.get("compositionState")
        != "candidate_only_requires_correspondence_and_orientation_human_acceptance"
    ):
        raise ValueError(f"{label} opened orientation authority")
    norm_error = pose.get("data3DQuaternionNormError")
    if isinstance(norm_error, bool) or not isinstance(norm_error, (int, float)) or not 0 <= float(norm_error) <= 1e-6:
        raise ValueError(f"{label} quaternion norm evidence is invalid")
    quaternion = _finite_tuple(
        pose.get("data3DRotationQuaternionWxyz"), 4, f"{label} Data3D quaternion"
    )
    centre = _finite_tuple(pose.get("data3DTranslationM"), 3, f"{label} Data3D translation")
    e57_from_scanner, computed_norm_error = _quaternion_rotation(quaternion, f"{label} Data3D quaternion")
    if abs(float(norm_error) - computed_norm_error) > 1e-15:
        raise ValueError(f"{label} quaternion norm evidence drifted")
    extrinsics = _dict(pose.get("extrinsics"), f"{label} extrinsics")
    _require_exact_keys(
        extrinsics,
        {
            "cameraCenterE57M", "rotationDirection", "rotationE57FromPanoramaCamera",
            "rotationPanoramaCameraFromE57", "translationPanoramaCameraFromE57M",
        },
        f"{label} extrinsics",
    )
    if extrinsics.get("rotationDirection") != "e57_from_conventional_panorama_camera":
        raise ValueError(f"{label} frame convention drifted")
    if _finite_tuple(extrinsics.get("cameraCenterE57M"), 3, f"{label} centre") != centre:
        raise ValueError(f"{label} camera-centre hypothesis differs from Data3D translation")
    forward = _proper_matrix(extrinsics.get("rotationE57FromPanoramaCamera"), f"{label} forward rotation")
    inverse = _proper_matrix(extrinsics.get("rotationPanoramaCameraFromE57"), f"{label} inverse rotation")
    _assert_matrix_close(inverse, _transpose3(forward), f"{label} inverse rotation")
    orientation = _matrix3(
        orientation_proposal.get("rotationPanoramaCanonicalFromScanner"),
        f"{label} orientation proposal",
    )
    if orientation_proposal.get("globalReflectionApplied") is not True or abs(_determinant3(orientation) + 1.0) > 1e-10:
        raise ValueError(f"{label} orientation proposal lacks the required display reflection")
    scanner_from_camera = _matmul3(
        _transpose3(orientation),
        [list(row) for row in orientation_core.PANORAMA_FROM_CAMERA],
    )
    expected_forward = _matmul3(e57_from_scanner, scanner_from_camera)
    _assert_matrix_close(forward, expected_forward, f"{label} forward rotation")
    translation = list(_finite_tuple(
        extrinsics.get("translationPanoramaCameraFromE57M"), 3, f"{label} translation"
    ))
    expected_translation = [-value for value in _matvec3(inverse, centre)]
    if max(abs(actual - expected) for actual, expected in zip(translation, expected_translation)) > 1e-10:
        raise ValueError(f"{label} translation differs from the source-bound composition")


def _validate_pair_result(
    value: object, expected: tuple[str, int, int, bool]
) -> None:
    pair_id, sweep, scan, primary = expected
    row = _dict(value, f"pair {pair_id}")
    _require_exact_keys(
        row,
        {
            "authority", "candidateCorrespondence", "candidateE57Pose", "data3DGuid",
            "guards", "humanDecisionOptions", "humanReviewGates", "matchIdentityDigests", "nativeCubefaces",
            "matchRecords", "orientationProposal", "pairId", "physicalE57PoseComposed", "reviewAid",
            "scanIndex", "sourceExternalPanorama", "state", "t561BoundaryAttentionRectangles",
        },
        f"pair {pair_id}",
    )
    expected_guid = ALTERNATE_GUID if not primary else EXPECTED_GUIDS[scan - 40]
    if (
        row.get("authority") != "none"
        or row.get("pairId") != pair_id
        or row.get("scanIndex") != scan
        or row.get("data3DGuid") != expected_guid
        or row.get("state") != "orientation_proposal_human_pending"
        or row.get("guards") != _authority_guards()
        or row.get("physicalE57PoseComposed") is not primary
    ):
        raise ValueError(f"pair {pair_id} identity or authority drifted")
    source = _dict(row.get("sourceExternalPanorama"), f"pair {pair_id} panorama")
    _require_exact_keys(source, {"relativePath", "sha256", "sweepNumber"}, f"pair {pair_id} panorama")
    if (
        source.get("sweepNumber") != sweep
        or source.get("relativePath") != f"sweep_{sweep:03d}jpg.jpg"
        or SHA256_RE.fullmatch(_string(source.get("sha256"), f"pair {pair_id} panorama SHA")) is None
    ):
        raise ValueError(f"pair {pair_id} panorama binding drifted")
    correspondence = _dict(row.get("candidateCorrespondence"), f"pair {pair_id} correspondence")
    _require_exact_keys(
        correspondence,
        {
            "accepted", "candidateKind", "caveat", "humanReviewRequired",
            "supportedCandidateCount", "t560RatioMatchCount", "t560SphericalInlierCount",
        },
        f"pair {pair_id} correspondence",
    )
    index = sweep - EXPECTED_SWEEPS[0]
    expected_ratio = EXPECTED_T560_PRIMARY_RATIO_MATCHES[index] if primary else EXPECTED_T560_ALTERNATE_RATIO_MATCHES
    expected_inliers = EXPECTED_T560_PRIMARY_INLIERS[index] if primary else EXPECTED_T560_ALTERNATE_INLIERS
    expected_count = 2 if sweep == ALTERNATE_SWEEP else 1
    expected_caveat = (
        "two_matcher_supported_candidates_human_review_required"
        if primary and sweep == ALTERNATE_SWEEP
        else "supported_same_or_near_station_revisit_human_comparison_required"
        if not primary else None
    )
    if (
        correspondence.get("accepted") is not False
        or correspondence.get("humanReviewRequired") is not True
        or correspondence.get("candidateKind") != ("primary" if primary else "supported_alternate")
        or correspondence.get("caveat") != expected_caveat
        or correspondence.get("supportedCandidateCount") != expected_count
        or correspondence.get("t560RatioMatchCount") != expected_ratio
        or correspondence.get("t560SphericalInlierCount") != expected_inliers
    ):
        raise ValueError(f"pair {pair_id} no longer binds the exact T560 candidate")
    proposal = _dict(row.get("orientationProposal"), f"pair {pair_id} orientation")
    orientation_core.validate_authority_none_result(proposal)
    identities = _list(row.get("matchIdentityDigests"), f"pair {pair_id} identities")
    if (
        len(identities) != proposal.get("matchCount")
        or len(set(identities)) != len(identities)
        or any(not isinstance(item, str) or SHA256_RE.fullmatch(item) is None for item in identities)
        or identities != sorted(identities)
    ):
        raise ValueError(f"pair {pair_id} match identity partition drifted")
    records = [
        _dict(item, f"pair {pair_id} match record")
        for item in _list(row.get("matchRecords"), f"pair {pair_id} match records")
    ]
    proposal_folds = _list(proposal.get("foldIndexByMatch"), f"pair {pair_id} proposal folds")
    if len(records) != len(identities) or len(proposal_folds) != len(identities):
        raise ValueError(f"pair {pair_id} match records are incomplete")
    for index, record in enumerate(records):
        _require_exact_keys(
            record,
            {
                "externalPanoramaFeaturePixel2048x1024", "faceFeaturePixel512x512",
                "faceIndex", "faceQueryIndex", "foldIndex", "identitySha256",
                "panoramaTrainIndex",
            },
            f"pair {pair_id} match record",
        )
        face = _integer(record.get("faceIndex"), f"pair {pair_id} match face")
        query = _integer(record.get("faceQueryIndex"), f"pair {pair_id} face query")
        train = _integer(record.get("panoramaTrainIndex"), f"pair {pair_id} panorama train")
        fold = _integer(record.get("foldIndex"), f"pair {pair_id} match fold")
        face_pixel = _finite_tuple(record.get("faceFeaturePixel512x512"), 2, f"pair {pair_id} face pixel")
        panorama_pixel = _finite_tuple(
            record.get("externalPanoramaFeaturePixel2048x1024"), 2,
            f"pair {pair_id} panorama pixel",
        )
        if (
            record.get("identitySha256") != identities[index]
            or fold != proposal_folds[index]
            or not 0 <= face < 6
            or min(query, train) < 0
            or not (0 <= face_pixel[0] < FACE_FEATURE_SIZE and 0 <= face_pixel[1] < FACE_FEATURE_SIZE)
            or not (0 <= panorama_pixel[0] < PANORAMA_FEATURE_WIDTH and 0 <= panorama_pixel[1] < PANORAMA_FEATURE_HEIGHT)
        ):
            raise ValueError(f"pair {pair_id} match record identity or coordinates drifted")
    faces = [_dict(item, f"pair {pair_id} cubeface") for item in _list(row.get("nativeCubefaces"), f"pair {pair_id} cubefaces")]
    if len(faces) != 6:
        raise ValueError(f"pair {pair_id} must bind exactly six native cubefaces")
    for face_index, face in enumerate(faces):
        _require_exact_keys(face, {"faceIndex", "relativePath", "sha256"}, f"pair {pair_id} face")
        if (
            face.get("faceIndex") != face_index
            or face.get("relativePath")
            != f"t559/images/scan_{scan:03d}/image2d_{scan * 6 + face_index:03d}_skybox_{face_index}.jpg"
            or SHA256_RE.fullmatch(_string(face.get("sha256"), f"pair {pair_id} face SHA")) is None
        ):
            raise ValueError(f"pair {pair_id} cubeface identity drifted")
    rectangles = [_dict(item, f"pair {pair_id} attention rectangle") for item in _list(row.get("t561BoundaryAttentionRectangles"), f"pair {pair_id} attention rectangles")]
    if not rectangles:
        raise ValueError(f"pair {pair_id} lost its T561 boundary attention overlay")
    for rectangle in rectangles:
        _require_exact_keys(rectangle, {"height", "width", "x", "y"}, f"pair {pair_id} attention rectangle")
        values = tuple(_integer(rectangle.get(key), f"pair {pair_id} rectangle {key}") for key in ("x", "y", "width", "height"))
        if min(values[:2]) < 0 or values[2] <= 0 or values[3] <= 0:
            raise ValueError(f"pair {pair_id} attention rectangle is invalid")
    expected_decisions = (
        ["scan46", "scan10", "both_same_station_revisit_unresolved", "neither", "unsure"]
        if sweep == ALTERNATE_SWEEP
        else ["accept_candidate", "reject_candidate", "unsure"]
    )
    if row.get("humanDecisionOptions") != expected_decisions:
        raise ValueError(f"pair {pair_id} human decision gate drifted")
    if row.get("humanReviewGates") != {
        "allVisiblePixelsGrandHall": "pending",
        "cameraCorrespondence": "pending",
        "cameraStationInsideGrandHall": "pending",
        "doorwayWindowOcclusionMasks": "pending",
        "externalPanoramaOrientation": "pending",
    }:
        raise ValueError(f"pair {pair_id} independent human-review gates drifted")
    _validate_candidate_pose(
        row.get("candidateE57Pose"), primary, f"pair {pair_id} candidate pose", proposal
    )
    _validate_review_aid(
        row.get("reviewAid"), f"orientation-review-{pair_id}-source-only.png", f"pair {pair_id} review aid"
    )


def validate_result(result: dict[str, object]) -> None:
    """Validate the complete pack without granting geometric or room authority."""
    _finite_json(result, "orientation pack")
    _require_exact_keys(
        result,
        {
            "authority", "contract", "dependencyAttestation", "generator", "generatorSha256",
            "pairResults", "reviewContactSheet", "schemaVersion", "sourceBindings",
            "sourceBindingsSha256", "summary", "warnings",
        },
        "orientation pack",
    )
    if result.get("schemaVersion") != RESULT_SCHEMA or result.get("authority") != "none":
        raise ValueError("orientation pack schema or authority drifted")
    contract = _dict(result.get("contract"), "orientation pack contract")
    _require_exact_keys(
        contract,
        {
            "exactSourceImageCount", "generatedContentUsed", "humanReviewRequired",
            "networkAccessUsed", "permissions", "sourceMutationPermitted", "truthScope",
        },
        "orientation pack contract",
    )
    if (
        contract.get("exactSourceImageCount") != EXPECTED_SOURCE_IMAGE_COUNT
        or contract.get("generatedContentUsed") is not False
        or contract.get("humanReviewRequired") is not True
        or contract.get("networkAccessUsed") is not False
        or contract.get("sourceMutationPermitted") is not False
        or contract.get("permissions") != _authority_guards()
        or contract.get("truthScope") != TRUTH_SCOPE
    ):
        raise ValueError("orientation pack truth or permission contract drifted")
    generator = _dict(result.get("generator"), "orientation generator")
    _require_exact_keys(generator, {"files", "reviewedGitSha"}, "orientation generator")
    if (
        GIT_SHA_RE.fullmatch(_string(generator.get("reviewedGitSha"), "reviewed Git SHA")) is None
        or generator.get("reviewedGitSha") == "0" * 40
    ):
        raise ValueError("orientation generator lacks a concrete reviewed commit")
    generator_files = [_validate_binding(item, "orientation generator file") for item in _list(generator.get("files"), "orientation generator files")]
    if [item["relativePath"] for item in generator_files] != list(GENERATOR_RELATIVE_PATHS):
        raise ValueError("orientation generator surface drifted")
    if result.get("generatorSha256") != sha256_bytes(canonical_json_bytes(generator)):
        raise ValueError("orientation generator digest drifted")
    if not isinstance(result.get("dependencyAttestation"), dict):
        raise ValueError("orientation dependency attestation is absent")
    bindings = _dict(result.get("sourceBindings"), "source bindings")
    _require_exact_keys(bindings, {"controlFiles", "sourceImages"}, "source bindings")
    controls = [_validate_binding(item, "control binding") for item in _list(bindings.get("controlFiles"), "control bindings")]
    images = [_validate_binding(item, "source image binding") for item in _list(bindings.get("sourceImages"), "source image bindings")]
    if (
        len(controls) != 14
        or len(images) != EXPECTED_SOURCE_IMAGE_COUNT
        or len({item["relativePath"] for item in controls}) != len(controls)
        or len({item["relativePath"] for item in images}) != len(images)
        or result.get("sourceBindingsSha256") != sha256_bytes(canonical_json_bytes(bindings))
    ):
        raise ValueError("orientation source binding set or digest drifted")
    pairs = _list(result.get("pairResults"), "orientation pair results")
    plan = _expected_pair_plan()
    if len(pairs) != len(plan):
        raise ValueError("orientation pack must contain eight primaries and one alternate")
    for value, expected in zip(pairs, plan):
        _validate_pair_result(value, expected)
    contact = _dict(result.get("reviewContactSheet"), "review contact sheet")
    _require_exact_keys(
        contact,
        {"authority", "heightPx", "relativePath", "role", "sha256", "sizeBytes", "widthPx"},
        "review contact sheet",
    )
    if (
        contact.get("authority") != "none"
        or contact.get("relativePath") != "orientation-review-contact-sheet-source-only.png"
        or contact.get("role") != "source_only_nine_candidate_contact_sheet"
        or contact.get("widthPx") != CONTACT_THUMB_WIDTH * CONTACT_COLUMNS
        or contact.get("heightPx") != (CONTACT_LABEL_HEIGHT + CONTACT_THUMB_HEIGHT) * 3
        or _integer(contact.get("sizeBytes"), "contact-sheet size") <= 0
        or SHA256_RE.fullmatch(_string(contact.get("sha256"), "contact-sheet SHA-256")) is None
    ):
        raise ValueError("orientation contact sheet identity or source-only role drifted")
    summary = _dict(result.get("summary"), "orientation summary")
    expected_summary = {
        "acceptedCorrespondenceCount": 0,
        "acceptedOrientationCount": 0,
        "alternatePairCount": 1,
        "externalPanoramaCount": 8,
        "nativeCubefaceCount": 54,
        "pairCount": 9,
        "physicalCandidatePoseCount": 8,
        "reviewAidCount": 10,
        "winnerAuthority": "none",
    }
    if summary != expected_summary or result.get("warnings") != _warnings():
        raise ValueError("orientation summary or warnings drifted")


def _expected_file_bytes(pack: DerivedPack) -> dict[str, bytes]:
    validate_result(pack.result)
    expected_names = {
        f"orientation-review-{pair_id}-source-only.png"
        for pair_id, _sweep, _scan, _primary in _expected_pair_plan()
    } | {"orientation-review-contact-sheet-source-only.png"}
    if set(pack.files) != expected_names:
        raise ValueError("orientation review-aid inventory is incomplete or unexpected")
    files: dict[str, bytes] = {}
    for name in sorted(pack.files):
        _validate_relative_path(name, "review-aid filename")
        if PurePosixPath(name).parent != PurePosixPath("."):
            raise ValueError("orientation pack files must be direct children")
        content = pack.files[name]
        if not isinstance(content, bytes) or not content.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError(f"review aid is not an immutable PNG: {name}")
        files[name] = content
    files[RESULT_NAME] = canonical_json_bytes(pack.result)
    by_name = {
        _dict(value, "pair result").get("reviewAid", {}).get("relativePath"):
        _dict(value, "pair result").get("reviewAid")
        for value in _list(pack.result.get("pairResults"), "pair results")
    }
    by_name["orientation-review-contact-sheet-source-only.png"] = pack.result["reviewContactSheet"]
    for name, content in pack.files.items():
        aid = _dict(by_name.get(name), f"review aid {name}")
        if aid.get("sha256") != sha256_bytes(content) or aid.get("sizeBytes") != len(content):
            raise ValueError(f"review aid metadata does not bind exact PNG bytes: {name}")
    return files


def build_receipt(files: dict[str, bytes], result: dict[str, object]) -> dict[str, object]:
    return {
        "authority": "none",
        "files": [
            {"relativePath": name, "sha256": sha256_bytes(content), "sizeBytes": len(content)}
            for name, content in sorted(files.items())
        ],
        "generatorSha256": result["generatorSha256"],
        "permissions": _authority_guards(),
        "publicationComplete": True,
        "receiptWrittenLast": True,
        "schemaVersion": RECEIPT_SCHEMA,
        "sourceBindingsSha256": result["sourceBindingsSha256"],
    }


def _write_exclusive(path: Path, content: bytes) -> None:
    with path.open("xb") as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())


def _pack_inventory(root: Path) -> set[str]:
    if _is_link_or_reparse(root) or not root.is_dir():
        raise ValueError("orientation pack root must be a real directory")
    entries = list(root.iterdir())
    if any(
        _is_link_or_reparse(path)
        or not path.is_file()
        or _snapshot(path).link_count != 1
        for path in entries
    ):
        raise ValueError("orientation pack contains linked, hard-linked, or non-regular entries")
    return {path.name for path in entries}


def _verify_pack_contents(root: Path, expected_pack: DerivedPack) -> None:
    expected = _expected_file_bytes(expected_pack)
    expected_inventory = set(expected) | {RECEIPT_NAME}
    if _pack_inventory(root) != expected_inventory:
        raise ValueError("orientation pack inventory is incomplete or unexpected")
    paths = {name: root / name for name in expected_inventory}
    snapshots = {name: _snapshot(path) for name, path in paths.items()}
    actual = {name: _read_stable(paths[name], snapshots[name]) for name in expected}
    for name, content in expected.items():
        if actual[name] != content:
            raise ValueError(f"orientation pack differs from fresh recomputation: {name}")
    result = load_strict_json(actual[RESULT_NAME], "orientation pack result")
    if actual[RESULT_NAME] != canonical_json_bytes(result) or result != expected_pack.result:
        raise ValueError("orientation result is non-canonical or differs from fresh recomputation")
    validate_result(result)
    receipt_bytes = _read_stable(paths[RECEIPT_NAME], snapshots[RECEIPT_NAME])
    receipt = load_strict_json(receipt_bytes, "orientation publication receipt")
    if receipt_bytes != canonical_json_bytes(receipt):
        raise ValueError("orientation publication receipt is not canonical JSON")
    if receipt != build_receipt(expected, result):
        raise ValueError("orientation receipt does not bind the complete payload")
    if _pack_inventory(root) != expected_inventory or any(
        _snapshot(paths[name]) != snapshots[name] for name in expected_inventory
    ):
        raise ValueError("orientation pack changed during verification")


def verify_pack(root: Path, expected_pack: DerivedPack) -> None:
    resolved = _verify_path_chain(root, "orientation pack", must_exist=True)
    with windows_directory_identity_lease(resolved.parent):
        with windows_directory_identity_lease(resolved) as identity:
            _verify_pack_contents(resolved, expected_pack)
            if _directory_snapshot(resolved) != identity:
                raise ValueError("orientation pack directory identity changed")


def publish_pack(
    output: Path, pack: DerivedPack, race_hook: RaceHook = _noop_hook
) -> None:
    files = _expected_file_bytes(pack)
    receipt = build_receipt(files, pack.result)
    parent = _verify_path_chain(output.parent, "publication parent", must_exist=True)
    with windows_directory_identity_lease(parent):
        if output.parent.resolve(strict=True) != parent:
            raise ValueError("publication parent identity drifted")
        race_hook("before-publication-stage", output)
        staged_identity: DirectorySnapshot | None = None
        with publication_stage(output) as temporary:
            for name, content in sorted(files.items()):
                if name == RESULT_NAME:
                    continue
                _write_exclusive(temporary / name, content)
            race_hook("after-payload-write", temporary)
            _write_exclusive(temporary / RESULT_NAME, files[RESULT_NAME])
            race_hook("after-result-write", temporary)
            _write_exclusive(temporary / RECEIPT_NAME, canonical_json_bytes(receipt))
            race_hook("after-receipt-write", temporary)
            _verify_pack_contents(temporary, pack)
            staged_identity = _directory_snapshot(temporary)
            race_hook("before-no-replace-rename", output)
        if staged_identity is None:
            raise ValueError("publication stage identity was not captured")
        with windows_directory_identity_lease(output) as published_identity:
            if published_identity != staged_identity:
                raise ValueError("published pack is not the verified staged directory")
            race_hook("after-no-replace-rename", output)
            _verify_pack_contents(output, pack)
            if _directory_snapshot(output) != published_identity:
                raise ValueError("published orientation pack identity changed")


def _protected_inputs(inputs: FrozenInputs, repo_root: Path) -> list[Path]:
    return [
        inputs.panorama_root,
        inputs.panorama_manifest.parent,
        inputs.image2d_root,
        inputs.crosswalk_root,
        inputs.t561_root,
        inputs.t561_input.parent,
        inputs.cubeface_extrinsics_root,
        inputs.camera_subset,
        inputs.dependency_wheel_root,
        repo_root,
    ]


def _safe_output(output: Path, protected: Sequence[Path], *, must_exist: bool) -> Path:
    resolved = assert_disjoint_output(output, protected)
    resolved = _verify_path_chain(
        resolved, "orientation output", must_exist=must_exist
    )
    if os.name != "nt" or resolved.drive.upper() == "C:":
        raise ValueError("orientation evidence requires an ordinary non-system local Windows drive")
    if must_exist:
        if not resolved.is_dir():
            raise ValueError("orientation check output must be an existing directory")
    else:
        if not resolved.parent.is_dir():
            raise ValueError("orientation publication parent must already exist")
        if os.path.lexists(resolved):
            raise ValueError("refusing to replace an existing orientation output")
    return resolved


def run(
    inputs: FrozenInputs,
    output: Path,
    reviewed_git_sha: str,
    repo_root: Path,
    *,
    check: bool,
    backend: t560.OpenCvSiftBackend | None = None,
    race_hook: RaceHook = _noop_hook,
) -> DerivedPack:
    prepared = prepare_inputs(inputs, repo_root)
    protected = _protected_inputs(inputs, repo_root)
    resolved_output = _safe_output(output, protected, must_exist=check)
    generator = _generator_binding(repo_root, reviewed_git_sha)
    generator_paths = [repo_root / relative for relative in GENERATOR_RELATIVE_PATHS]
    lease_paths = [item.path for item in (*prepared.control_files, *prepared.source_files)] + generator_paths
    manager = t560.OpenCvSiftBackend(inputs.dependency_wheel_root) if backend is None else nullcontext(backend)
    with windows_read_leases(lease_paths):
        with manager as selected:
            dependency = t560._dependency_attestation(selected, inputs.dependency_wheel_root)
            selected.verify_dependency_bindings()
            _verify_prepared_inputs(prepared)
            race_hook("after-pre-read-custody", output)
            pack = derive_pack(prepared, selected, generator, dependency)
            _verify_prepared_inputs(prepared)
            if _generator_binding(repo_root, reviewed_git_sha) != generator:
                raise ValueError("orientation generator changed during derivation")
            if t560._dependency_attestation(selected, inputs.dependency_wheel_root) != dependency:
                raise ValueError("orientation dependency attestation changed during derivation")
            race_hook("after-post-read-custody", output)
            resolved_output = _safe_output(resolved_output, protected, must_exist=check)
            if check:
                verify_pack(resolved_output, pack)
            else:
                publish_pack(resolved_output, pack, race_hook)
            _verify_prepared_inputs(prepared)
            if _generator_binding(repo_root, reviewed_git_sha) != generator:
                raise ValueError("orientation generator changed during publication or check")
            if t560._dependency_attestation(selected, inputs.dependency_wheel_root) != dependency:
                raise ValueError("orientation dependency attestation changed during publication or check")
    return pack


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build/check the source-only, authority-none Grand Hall panorama/E57 orientation pack."
    )
    parser.add_argument("--panorama-root", required=True)
    parser.add_argument("--panorama-manifest", required=True)
    parser.add_argument("--image2d-evidence-root", required=True)
    parser.add_argument("--crosswalk-root", required=True)
    parser.add_argument("--t561-root", required=True)
    parser.add_argument("--t561-input", required=True)
    parser.add_argument("--cubeface-extrinsics-root", required=True)
    parser.add_argument("--camera-subset", required=True)
    parser.add_argument("--dependency-wheel-root", required=True)
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--reviewed-git-sha", required=True)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--verify-source-hashes", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    if not args.verify_source_hashes:
        parser.error("--verify-source-hashes is mandatory")
    inputs = FrozenInputs(
        Path(args.panorama_root),
        Path(args.panorama_manifest),
        Path(args.image2d_evidence_root),
        Path(args.crosswalk_root),
        Path(args.t561_root),
        Path(args.t561_input),
        Path(args.cubeface_extrinsics_root),
        Path(args.camera_subset),
        Path(args.dependency_wheel_root),
    )
    pack = run(
        inputs,
        Path(args.out),
        args.reviewed_git_sha,
        Path(args.repo_root),
        check=args.check,
    )
    print(
        f"Authority-none orientation pack verified: {len(pack.result['pairResults'])} "
        "visible candidate pairs; zero accepted."
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(f"Grand Hall panorama/E57 orientation failed: {error}", file=sys.stderr)
        sys.exit(1)
