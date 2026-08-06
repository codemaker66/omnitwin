#!/usr/bin/env python3
"""Fail-closed Reception E57 to XGRIDS alignment preflight and diagnostic.

This command has two deliberately narrow modes:

``preflight`` fingerprints and validates the local evidence without importing a
point-cloud stack. ``diagnose`` additionally samples the staged E57 and XGRIDS
PLY, fits one *proper rigid* diagnostic transform, and evaluates a frozen E57
holdout.  Both modes create only an authority-none JSON receipt at a new path.

The command never mutates an input, registers or signs a TransformArtifactV0,
starts training, contacts a provider, uploads, publishes, or grants rights or
room-identity approval.  Its output cannot complete T-505.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import importlib
import json
import math
import os
import platform
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path, PurePosixPath
import re
import stat
import struct
import sys
import tempfile
from typing import Any, Iterable, Sequence


SCHEMA_VERSION = "omnitwin.reception.e57-xgrids-alignment-diagnostic.v1"
RECEPTION_EVIDENCE_SCHEMA = "omnitwin.reception.e57-room-image-audit.v1"
STAGE_SCHEMA = "venviewer.capture-stage.v1"
RECEPTION_EVIDENCE_DIGEST_DOMAIN = (
    b"OMNITWIN_RECEPTION_E57_ROOM_IMAGE_AUDIT_V1\0"
)
RECEIPT_DIGEST_DOMAIN = b"OMNITWIN_RECEPTION_E57_XGRIDS_ALIGNMENT_V1\0"
RECEPTION_E57_SHA256 = "975039d11fc04ca681f038e499f358124bbcab178ad5ce6324fa912212729cdd"
RECEPTION_E57_SIZE_BYTES = 20_518_437_888
RECEPTION_E57_SCAN_COUNT = 149
RECEPTION_E57_ORGANIZED_ROWS = 1800
RECEPTION_E57_ORGANIZED_COLUMNS = 3600
RECEPTION_E57_ORGANIZED_SAMPLE_STRIDE = 18

RECEPTION_SCAN_IDS = tuple(range(122, 145))
FROZEN_FIT_SCAN_IDS = (
    124,
    125,
    127,
    128,
    130,
    132,
    133,
    135,
    136,
    137,
    139,
    142,
    143,
    144,
)
FROZEN_VALIDATION_SCAN_IDS = (131, 134, 138)
FROZEN_TEST_SCAN_IDS = (126, 129, 141)
FROZEN_QUARANTINED_SCAN_IDS = (122, 123, 140)

SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
SCAN_RANGE_RE = re.compile(r"^([0-9]{1,6})-([0-9]{1,6})$")
SAFE_RELATIVE_PART_RE = re.compile(r"^[^\x00-\x1f/\\]+$")

MAX_STAGE_MANIFEST_BYTES = 16 * 1024 * 1024
MAX_RECEPTION_EVIDENCE_BYTES = 128 * 1024 * 1024
MAX_POSES_BYTES = 128 * 1024 * 1024
MAX_PLY_BYTES = 256 * 1024**3
MAX_E57_BYTES = 4 * 1024**4
MAX_PLY_HEADER_BYTES = 1024 * 1024
MAX_VERTEX_COUNT = 2_000_000_000
MAX_POSE_COUNT = 5_000_000
HASH_CHUNK_BYTES = 8 * 1024 * 1024
QUATERNION_NORM_TOLERANCE = 1e-3
MIN_DIAGNOSTIC_POINTS = 32

PLY_SCALAR_TYPES: dict[str, tuple[str, int]] = {
    "char": ("b", 1),
    "int8": ("b", 1),
    "uchar": ("B", 1),
    "uint8": ("B", 1),
    "short": ("h", 2),
    "int16": ("h", 2),
    "ushort": ("H", 2),
    "uint16": ("H", 2),
    "int": ("i", 4),
    "int32": ("i", 4),
    "uint": ("I", 4),
    "uint32": ("I", 4),
    "float": ("f", 4),
    "float32": ("f", 4),
    "double": ("d", 8),
    "float64": ("d", 8),
}


class AlignmentError(RuntimeError):
    """Stable, expected refusal or invalid-input error."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def fail(code: str, message: str) -> None:
    raise AlignmentError(code, message)


class JsonArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        fail("INVALID_ARGUMENTS", message)


@dataclass(frozen=True)
class FileSnapshot:
    size_bytes: int
    mtime_ns: int
    inode: int | None
    device: int | None


@dataclass(frozen=True)
class PlyProperty:
    name: str
    scalar_type: str | None
    list_count_type: str | None = None
    list_item_type: str | None = None


@dataclass(frozen=True)
class PlyLayout:
    format_name: str
    vertex_count: int
    vertex_properties: tuple[PlyProperty, ...]
    data_offset: int
    vertex_stride_bytes: int | None
    header_sha256: str


@dataclass
class InputBundle:
    paths: dict[str, Path]
    snapshots: dict[str, FileSnapshot]
    evidence: dict[str, Any]
    ply_layout: PlyLayout
    pose_summary: dict[str, Any]
    tool_snapshot: FileSnapshot
    tool_evidence: dict[str, Any]
    protected_roots: tuple[Path, ...]


def _canonical_json_bytes(value: Any) -> bytes:
    try:
        return json.dumps(
            value,
            allow_nan=False,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    except (TypeError, ValueError) as error:
        fail("INVALID_JSON_VALUE", "receipt contains a non-canonical JSON value")
        raise AssertionError from error


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _is_link_like(path: Path) -> bool:
    try:
        metadata = path.lstat()
    except OSError as error:
        fail("FILE_INSPECTION_FAILED", f"could not inspect {path.name}: {error}")
    reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    attributes = getattr(metadata, "st_file_attributes", 0)
    return path.is_symlink() or bool(reparse_flag and attributes & reparse_flag)


def _assert_no_link_ancestors(path: Path, label: str) -> None:
    """Reject a path whose existing route contains a symlink or junction."""

    absolute = path.expanduser().absolute()
    chain = list(reversed(absolute.parents)) + [absolute]
    for component in chain:
        if not component.exists():
            continue
        if _is_link_like(component):
            fail("UNSAFE_LINK", f"{label} traverses a symbolic link or reparse point")


def _safe_regular_file(
    path: Path, label: str, maximum_bytes: int, *, allow_empty: bool = False
) -> tuple[Path, FileSnapshot]:
    expanded = path.expanduser()
    _assert_no_link_ancestors(expanded, label)
    if _is_link_like(expanded):
        fail("UNSAFE_LINK", f"{label} must not be a symbolic link or reparse point")
    try:
        resolved = expanded.resolve(strict=True)
        metadata = resolved.stat()
    except FileNotFoundError:
        fail("MISSING_FILE", f"missing {label}: {expanded}")
    except OSError as error:
        fail("FILE_INSPECTION_FAILED", f"could not inspect {label}: {error}")
    if not resolved.is_file():
        fail("NOT_REGULAR_FILE", f"{label} is not a regular file")
    if metadata.st_size < 0 or (metadata.st_size == 0 and not allow_empty):
        fail("EMPTY_FILE", f"{label} is empty")
    if metadata.st_size > maximum_bytes:
        fail("FILE_TOO_LARGE", f"{label} exceeds {maximum_bytes} bytes")
    return resolved, FileSnapshot(
        size_bytes=metadata.st_size,
        mtime_ns=metadata.st_mtime_ns,
        inode=getattr(metadata, "st_ino", None),
        device=getattr(metadata, "st_dev", None),
    )


def _safe_directory(path: Path, label: str) -> Path:
    expanded = path.expanduser()
    _assert_no_link_ancestors(expanded, label)
    try:
        resolved = expanded.resolve(strict=True)
    except FileNotFoundError:
        fail("MISSING_DIRECTORY", f"missing {label}: {expanded}")
    except OSError as error:
        fail("FILE_INSPECTION_FAILED", f"could not inspect {label}: {error}")
    if not resolved.is_dir():
        fail("NOT_DIRECTORY", f"{label} is not a directory")
    return resolved


def _snapshot_matches(path: Path, expected: FileSnapshot, label: str) -> None:
    _, current = _safe_regular_file(path, label, max(expected.size_bytes, 1))
    if current != expected:
        fail("FILE_CHANGED_DURING_RUN", f"{label} changed during the run")


def _hash_file(path: Path, snapshot: FileSnapshot, label: str) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as source:
            for block in iter(lambda: source.read(HASH_CHUNK_BYTES), b""):
                digest.update(block)
    except OSError as error:
        fail("READ_FAILED", f"could not hash {label}: {error}")
    _snapshot_matches(path, snapshot, label)
    return digest.hexdigest()


def _read_bound_bytes(
    path: Path, label: str, maximum_bytes: int
) -> tuple[Path, FileSnapshot, bytes, str]:
    resolved, snapshot = _safe_regular_file(path, label, maximum_bytes)
    try:
        payload = resolved.read_bytes()
    except OSError as error:
        fail("READ_FAILED", f"could not read {label}: {error}")
    _snapshot_matches(resolved, snapshot, label)
    return resolved, snapshot, payload, _sha256_bytes(payload)


def _strict_json(payload: bytes, label: str) -> dict[str, Any]:
    def reject_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                fail("DUPLICATE_JSON_KEY", f"{label} contains duplicate key {key!r}")
            result[key] = value
        return result

    def reject_constant(value: str) -> None:
        fail("NONFINITE_JSON_NUMBER", f"{label} contains unsupported number {value}")

    try:
        value = json.loads(
            payload.decode("utf-8"),
            object_pairs_hook=reject_duplicates,
            parse_constant=reject_constant,
        )
    except UnicodeDecodeError as error:
        fail("INVALID_UTF8_JSON", f"{label} is not UTF-8: {error}")
    except json.JSONDecodeError as error:
        fail("INVALID_JSON", f"could not parse {label}: {error}")
    if not isinstance(value, dict):
        fail("INVALID_JSON_ROOT", f"{label} must contain one JSON object")
    return value


def _require_exact_keys(value: dict[str, Any], expected: set[str], label: str) -> None:
    actual = set(value)
    if actual != expected:
        fail(
            "INVALID_KEYS",
            f"{label} keys differ; missing={sorted(expected-actual)}, "
            f"unexpected={sorted(actual-expected)}",
        )


def _require_int(value: Any, label: str, *, minimum: int = 0) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < minimum:
        fail("INVALID_INTEGER", f"{label} must be an integer >= {minimum}")
    return value


def _require_sha256(value: Any, label: str) -> str:
    if not isinstance(value, str) or SHA256_RE.fullmatch(value) is None:
        fail("INVALID_SHA256", f"{label} must be a lowercase SHA-256 digest")
    return value


def _finite_vector(value: Any, length: int, label: str) -> list[float]:
    if not isinstance(value, list) or len(value) != length:
        fail("INVALID_VECTOR", f"{label} must contain exactly {length} numbers")
    result: list[float] = []
    for item in value:
        if isinstance(item, bool) or not isinstance(item, (int, float)):
            fail("INVALID_VECTOR", f"{label} contains a non-number")
        number = float(item)
        if not math.isfinite(number):
            fail("NONFINITE_VALUE", f"{label} contains a non-finite number")
        result.append(number)
    return result


def parse_scan_range(value: str) -> tuple[int, ...]:
    match = SCAN_RANGE_RE.fullmatch(value.strip())
    if match is None:
        fail("INVALID_SCAN_RANGE", "scan range must look exactly like 122-144")
    first, last = int(match.group(1)), int(match.group(2))
    if first > last or last - first > 10_000:
        fail("INVALID_SCAN_RANGE", "scan range is reversed or unreasonably large")
    scans = tuple(range(first, last + 1))
    if scans != RECEPTION_SCAN_IDS:
        fail(
            "UNSUPPORTED_RECEPTION_SCOPE",
            "this tool is pinned to the Reception evidence scope 122-144",
        )
    return scans


def _resolve_stage_relative(root: Path, raw_relative: Any, label: str) -> Path:
    if not isinstance(raw_relative, str) or not raw_relative:
        fail("INVALID_STAGE_PATH", f"{label} must be a non-empty relative path")
    if "\\" in raw_relative:
        fail("INVALID_STAGE_PATH", f"{label} must use forward slashes")
    pure = PurePosixPath(raw_relative)
    if (
        pure.is_absolute()
        or not pure.parts
        or any(part in ("", ".", "..") for part in pure.parts)
        or any(SAFE_RELATIVE_PART_RE.fullmatch(part) is None for part in pure.parts)
    ):
        fail("INVALID_STAGE_PATH", f"{label} is not a canonical relative path")
    current = root
    for part in pure.parts:
        current = current / part
        if _is_link_like(current):
            fail("UNSAFE_LINK", f"{label} traverses a link or reparse point")
    try:
        resolved = current.resolve(strict=True)
        resolved.relative_to(root)
    except (FileNotFoundError, ValueError) as error:
        fail("INVALID_STAGE_PATH", f"{label} is missing or escapes the stage root")
        raise AssertionError from error
    return resolved


def _load_stage_manifest(
    manifest_path: Path, verify_e57_bytes: bool
) -> tuple[dict[str, Any], dict[str, Path], dict[str, FileSnapshot]]:
    manifest, manifest_snapshot, payload, manifest_sha = _read_bound_bytes(
        manifest_path, "capture stage manifest", MAX_STAGE_MANIFEST_BYTES
    )
    if manifest.name != "capture-stage-manifest.json":
        fail("INVALID_STAGE_MANIFEST_NAME", "stage manifest name must be capture-stage-manifest.json")
    raw = _strict_json(payload, "capture stage manifest")
    _require_exact_keys(
        raw,
        {"schemaVersion", "sourceRoot", "planSha256", "fileCount", "totalBytes", "files"},
        "capture stage manifest",
    )
    if raw["schemaVersion"] != STAGE_SCHEMA:
        fail("UNSUPPORTED_STAGE_SCHEMA", f"unsupported stage schema {raw['schemaVersion']!r}")
    if not isinstance(raw["sourceRoot"], str) or not raw["sourceRoot"].strip():
        fail("INVALID_STAGE_MANIFEST", "stage sourceRoot must be a non-empty string")
    _require_sha256(raw["planSha256"], "stage planSha256")
    files = raw["files"]
    if not isinstance(files, list):
        fail("INVALID_STAGE_MANIFEST", "stage files must be an array")
    file_count = _require_int(raw["fileCount"], "stage fileCount")
    total_bytes = _require_int(raw["totalBytes"], "stage totalBytes")
    if file_count != len(files):
        fail("STAGE_COUNT_MISMATCH", "stage fileCount does not equal files length")
    source_paths: list[str] = []
    target_paths: set[str] = set()
    total = 0
    primary: dict[str, Any] | None = None
    for index, item in enumerate(files):
        if not isinstance(item, dict):
            fail("INVALID_STAGE_MANIFEST", f"stage files[{index}] must be an object")
        _require_exact_keys(
            item,
            {"sourceRelativePath", "targetRelativePath", "sizeBytes", "sha256", "role"},
            f"stage files[{index}]",
        )
        source_relative = item["sourceRelativePath"]
        target_relative = item["targetRelativePath"]
        if not isinstance(source_relative, str) or not source_relative:
            fail("INVALID_STAGE_MANIFEST", f"stage files[{index}].sourceRelativePath is invalid")
        if not isinstance(target_relative, str) or not target_relative:
            fail("INVALID_STAGE_MANIFEST", f"stage files[{index}].targetRelativePath is invalid")
        if target_relative in target_paths:
            fail("DUPLICATE_STAGE_PATH", f"duplicate stage target {target_relative}")
        target_paths.add(target_relative)
        source_paths.append(source_relative)
        size = _require_int(item["sizeBytes"], f"stage files[{index}].sizeBytes")
        _require_sha256(item["sha256"], f"stage files[{index}].sha256")
        if item["role"] not in ("primary_capture", "vendor_control"):
            fail("INVALID_STAGE_ROLE", f"unsupported stage role {item['role']!r}")
        total += size
        if item["role"] == "primary_capture":
            if primary is not None:
                fail("MULTIPLE_PRIMARY_CAPTURES", "stage must contain exactly one primary capture")
            primary = item
    if source_paths != sorted(source_paths) or len(source_paths) != len(set(source_paths)):
        fail("UNSORTED_STAGE_FILES", "stage source paths must be sorted and unique")
    if total != total_bytes:
        fail("STAGE_SIZE_MISMATCH", "stage totalBytes does not equal file sizes")
    if primary is None or not str(primary["targetRelativePath"]).lower().endswith(".e57"):
        fail("MISSING_PRIMARY_E57", "stage must contain exactly one primary E57")

    root = manifest.parent.resolve(strict=True)
    e57 = _resolve_stage_relative(root, primary["targetRelativePath"], "primary E57")
    e57, e57_snapshot = _safe_regular_file(e57, "primary E57", MAX_E57_BYTES)
    if e57_snapshot.size_bytes != primary["sizeBytes"]:
        fail("E57_SIZE_DRIFT", "primary E57 size differs from its stage manifest")
    full_hash: str | None = None
    if verify_e57_bytes:
        full_hash = _hash_file(e57, e57_snapshot, "primary E57")
        if full_hash != primary["sha256"]:
            fail("E57_HASH_DRIFT", "primary E57 SHA-256 differs from its stage manifest")
    return (
        {
            "captureStageManifest": {
                "fileName": manifest.name,
                "schemaVersion": STAGE_SCHEMA,
                "sha256": manifest_sha,
                "sizeBytes": manifest_snapshot.size_bytes,
                "planSha256": raw["planSha256"],
            },
            "e57": {
                "fileName": e57.name,
                "manifestDeclaredSha256": primary["sha256"],
                "sizeBytes": e57_snapshot.size_bytes,
                "stageTargetRelativePath": primary["targetRelativePath"],
                "currentBytesFullyHashedThisRun": verify_e57_bytes,
                "currentBytesSha256": full_hash,
                "identityPosture": (
                    "stage_manifest_bound_size_and_sha256_reverified"
                    if verify_e57_bytes
                    else "stage_manifest_bound_size_checked_sha256_not_recomputed"
                ),
            },
        },
        {"stageManifest": manifest, "e57": e57},
        {"stageManifest": manifest_snapshot, "e57": e57_snapshot},
    )


def _load_reception_evidence(
    path: Path, e57_evidence: dict[str, Any]
) -> tuple[dict[str, Any], Path, FileSnapshot]:
    resolved, snapshot, payload, file_sha = _read_bound_bytes(
        path, "Reception evidence", MAX_RECEPTION_EVIDENCE_BYTES
    )
    raw = _strict_json(payload, "Reception evidence")
    if raw.get("schemaVersion") != RECEPTION_EVIDENCE_SCHEMA:
        fail("UNSUPPORTED_RECEPTION_EVIDENCE", "unexpected Reception evidence schema")
    if raw.get("authority") != "none":
        fail(
            "UNSUPPORTED_EVIDENCE_AUTHORITY",
            "this diagnostic accepts only the authority-none Reception audit",
        )
    payload_digest = _require_sha256(raw.get("payloadSha256"), "Reception payloadSha256")
    unsigned = copy.deepcopy(raw)
    unsigned.pop("payloadSha256", None)
    computed_payload_digest = hashlib.sha256(
        RECEPTION_EVIDENCE_DIGEST_DOMAIN + _canonical_json_bytes(unsigned)
    ).hexdigest()
    if computed_payload_digest != payload_digest:
        fail("RECEPTION_EVIDENCE_DIGEST_MISMATCH", "Reception evidence self-digest is invalid")

    scope = raw.get("scope")
    if not isinstance(scope, dict):
        fail("INVALID_RECEPTION_SCOPE", "Reception evidence scope is missing")
    if scope.get("scanIds") != list(RECEPTION_SCAN_IDS):
        fail("INVALID_RECEPTION_SCOPE", "Reception evidence must bind scans 122-144 exactly")
    source_sha = _require_sha256(scope.get("sourceE57Sha256"), "Reception source E57 SHA-256")
    source_size = _require_int(scope.get("sourceE57SizeBytes"), "Reception source E57 size", minimum=1)
    if (
        source_sha != RECEPTION_E57_SHA256
        or source_size != RECEPTION_E57_SIZE_BYTES
        or scope.get("sourceE57ScanCount") != RECEPTION_E57_SCAN_COUNT
    ):
        fail(
            "UNEXPECTED_RECEPTION_E57_IDENTITY",
            "Reception alignment is pinned to the known 20.5 GB, 149-scan E57 identity",
        )
    if source_sha != e57_evidence["manifestDeclaredSha256"]:
        fail("E57_IDENTITY_MISMATCH", "Reception evidence and stage manifest name different E57 bytes")
    if source_size != e57_evidence["sizeBytes"]:
        fail("E57_IDENTITY_MISMATCH", "Reception evidence and stage manifest disagree on E57 size")

    split = raw.get("technicalDecision", {}).get("proposedStationSplit")
    if not isinstance(split, dict):
        fail("MISSING_FROZEN_SPLIT", "Reception evidence lacks the proposed station split")
    expected_split = {
        "trainingScanIds": list(FROZEN_FIT_SCAN_IDS),
        "validationScanIds": list(FROZEN_VALIDATION_SCAN_IDS),
        "testScanIds": list(FROZEN_TEST_SCAN_IDS),
    }
    for key, expected in expected_split.items():
        if split.get(key) != expected:
            fail("FROZEN_SPLIT_DRIFT", f"Reception evidence {key} differs from the frozen split")
    if set(FROZEN_FIT_SCAN_IDS) & set(FROZEN_VALIDATION_SCAN_IDS):
        fail("INTERNAL_SPLIT_ERROR", "fit and validation scans overlap")

    authorization = raw.get("authorizationDecision")
    visual_review = raw.get("visualReview")
    if not isinstance(authorization, dict) or authorization.get("trainingPermitted") is not False:
        fail(
            "UNSUPPORTED_RIGHTS_CLAIM",
            "authority-none Reception evidence must keep training permission false",
        )
    if not isinstance(visual_review, dict) or visual_review.get("nativeImageReviewComplete") is not False:
        fail(
            "UNSUPPORTED_HUMAN_REVIEW_CLAIM",
            "authority-none Reception evidence must keep native review incomplete",
        )
    return (
        {
            "fileName": resolved.name,
            "fileSha256": file_sha,
            "payloadSha256": payload_digest,
            "schemaVersion": raw["schemaVersion"],
            "sizeBytes": snapshot.size_bytes,
            "authority": "none",
            "scanIds": list(RECEPTION_SCAN_IDS),
            "roomIdentityPosture": "visual_compatibility_only_not_reviewed_identity",
            "rightsPosture": authorization.get("status"),
            "nativeImageReviewComplete": False,
            "requiresHumanConfirmation": bool(visual_review.get("requiresHumanConfirmation", True)),
        },
        resolved,
        snapshot,
    )


def _read_ply_header(path: Path, snapshot: FileSnapshot) -> PlyLayout:
    lines: list[str] = []
    header_bytes = bytearray()
    try:
        with path.open("rb") as source:
            while True:
                line = source.readline()
                if not line:
                    fail("TRUNCATED_PLY_HEADER", "PLY ended before end_header")
                header_bytes.extend(line)
                if len(header_bytes) > MAX_PLY_HEADER_BYTES:
                    fail("PLY_HEADER_TOO_LARGE", "PLY header exceeds the safety limit")
                try:
                    text = line.decode("ascii").rstrip("\r\n")
                except UnicodeDecodeError:
                    fail("INVALID_PLY_HEADER", "PLY header is not ASCII")
                lines.append(text)
                if text == "end_header":
                    data_offset = source.tell()
                    break
    except OSError as error:
        fail("READ_FAILED", f"could not read PLY header: {error}")
    _snapshot_matches(path, snapshot, "XGRIDS PLY")
    if not lines or lines[0] != "ply":
        fail("INVALID_PLY_MAGIC", "PLY must start with the exact line 'ply'")

    format_name: str | None = None
    elements: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    for line in lines[1:-1]:
        if not line:
            fail("INVALID_PLY_HEADER", "blank PLY header lines are not accepted")
        parts = line.split()
        directive = parts[0]
        if directive in ("comment", "obj_info"):
            continue
        if directive == "format":
            if len(parts) != 3 or parts[2] != "1.0" or format_name is not None:
                fail("INVALID_PLY_FORMAT", "PLY needs one supported format ... 1.0 declaration")
            if parts[1] not in ("ascii", "binary_little_endian", "binary_big_endian"):
                fail("INVALID_PLY_FORMAT", f"unsupported PLY format {parts[1]!r}")
            format_name = parts[1]
            continue
        if directive == "element":
            if len(parts) != 3:
                fail("INVALID_PLY_ELEMENT", f"invalid PLY element line {line!r}")
            try:
                count = int(parts[2], 10)
            except ValueError:
                fail("INVALID_PLY_ELEMENT", f"invalid element count {parts[2]!r}")
            if count < 0 or count > MAX_VERTEX_COUNT:
                fail("INVALID_PLY_ELEMENT", "PLY element count is outside the safety limit")
            current = {"name": parts[1], "count": count, "properties": []}
            elements.append(current)
            continue
        if directive == "property":
            if current is None:
                fail("INVALID_PLY_PROPERTY", "PLY property appears before an element")
            if len(parts) == 3:
                scalar_type, name = parts[1], parts[2]
                if scalar_type not in PLY_SCALAR_TYPES:
                    fail("UNSUPPORTED_PLY_TYPE", f"unsupported PLY scalar type {scalar_type!r}")
                prop = PlyProperty(name=name, scalar_type=scalar_type)
            elif len(parts) == 5 and parts[1] == "list":
                count_type, item_type, name = parts[2], parts[3], parts[4]
                if count_type not in PLY_SCALAR_TYPES or item_type not in PLY_SCALAR_TYPES:
                    fail("UNSUPPORTED_PLY_TYPE", "unsupported PLY list scalar type")
                prop = PlyProperty(
                    name=name,
                    scalar_type=None,
                    list_count_type=count_type,
                    list_item_type=item_type,
                )
            else:
                fail("INVALID_PLY_PROPERTY", f"invalid PLY property line {line!r}")
            if any(existing.name == prop.name for existing in current["properties"]):
                fail("DUPLICATE_PLY_PROPERTY", f"duplicate PLY property {prop.name!r}")
            current["properties"].append(prop)
            continue
        fail("UNSUPPORTED_PLY_DIRECTIVE", f"unsupported PLY header directive {directive!r}")

    if format_name is None:
        fail("MISSING_PLY_FORMAT", "PLY has no format declaration")
    vertices = [element for element in elements if element["name"] == "vertex"]
    if len(vertices) != 1:
        fail("INVALID_VERTEX_ELEMENT", "PLY must contain exactly one vertex element")
    vertex = vertices[0]
    if elements[0] is not vertex:
        fail("UNSUPPORTED_PLY_LAYOUT", "vertex must be the first PLY element")
    if vertex["count"] < MIN_DIAGNOSTIC_POINTS:
        fail("INSUFFICIENT_PLY_VERTICES", f"PLY needs at least {MIN_DIAGNOSTIC_POINTS} vertices")
    properties: tuple[PlyProperty, ...] = tuple(vertex["properties"])
    if any(prop.scalar_type is None for prop in properties):
        fail("UNSUPPORTED_VERTEX_LIST", "list properties are forbidden on PLY vertices")
    names = {prop.name for prop in properties}
    if not {"x", "y", "z"}.issubset(names):
        fail("MISSING_XYZ", "PLY vertex properties must include x, y, and z")
    stride = sum(PLY_SCALAR_TYPES[prop.scalar_type or ""][1] for prop in properties)
    if format_name != "ascii":
        required = data_offset + stride * vertex["count"]
        if required > snapshot.size_bytes:
            fail("TRUNCATED_PLY_VERTICES", "PLY is too short for its declared binary vertices")
    return PlyLayout(
        format_name=format_name,
        vertex_count=vertex["count"],
        vertex_properties=properties,
        data_offset=data_offset,
        vertex_stride_bytes=None if format_name == "ascii" else stride,
        header_sha256=_sha256_bytes(bytes(header_bytes)),
    )


def _ply_layout_evidence(layout: PlyLayout) -> dict[str, Any]:
    return {
        "format": layout.format_name,
        "vertexCount": layout.vertex_count,
        "vertexProperties": [prop.name for prop in layout.vertex_properties],
        "vertexScalarTypes": {
            prop.name: prop.scalar_type for prop in layout.vertex_properties
        },
        "vertexStrideBytes": layout.vertex_stride_bytes,
        "headerSha256": layout.header_sha256,
        "faceDataIgnored": True,
        "completePlyContainerValidated": False,
        "preflightValidationScope": "header structure and binary vertex byte-length lower bound only",
        "allDeclaredVertexXyzValidatedInDiagnostic": False,
        "diagnosticValidationScope": None,
    }


def _parse_poses(payload: bytes) -> dict[str, Any]:
    raw = _strict_json(payload, "XGRIDS poses")
    _require_exact_keys(raw, {"poses", "fusionPoses"}, "XGRIDS poses")
    if raw["fusionPoses"] is not None:
        fail("UNSUPPORTED_FUSION_POSES", "non-null fusionPoses are not admitted by this tool")
    poses = raw["poses"]
    if not isinstance(poses, list) or not poses:
        fail("INVALID_POSES", "poses must be a non-empty array")
    if len(poses) > MAX_POSE_COUNT:
        fail("TOO_MANY_POSES", f"poses exceeds {MAX_POSE_COUNT} records")
    previous_timestamp: Decimal | None = None
    translations: list[list[float]] = []
    path_length = 0.0
    maximum_norm_error = 0.0
    for index, record in enumerate(poses):
        if not isinstance(record, dict):
            fail("INVALID_POSE", f"poses[{index}] must be an object")
        _require_exact_keys(record, {"ts", "T", "R", "RGB"}, f"poses[{index}]")
        timestamp_raw = record["ts"]
        if not isinstance(timestamp_raw, str) or len(timestamp_raw) > 64:
            fail("INVALID_TIMESTAMP", f"poses[{index}].ts must be a short decimal string")
        try:
            timestamp = Decimal(timestamp_raw)
        except InvalidOperation:
            fail("INVALID_TIMESTAMP", f"poses[{index}].ts is not a decimal")
        if not timestamp.is_finite():
            fail("INVALID_TIMESTAMP", f"poses[{index}].ts must be finite")
        if previous_timestamp is not None and timestamp <= previous_timestamp:
            fail("NONMONOTONIC_POSES", "pose timestamps must be strictly increasing")
        previous_timestamp = timestamp
        translation = _finite_vector(record["T"], 3, f"poses[{index}].T")
        quaternion = _finite_vector(record["R"], 4, f"poses[{index}].R")
        norm = math.sqrt(sum(component * component for component in quaternion))
        norm_error = abs(norm - 1.0)
        maximum_norm_error = max(maximum_norm_error, norm_error)
        if norm <= 0 or norm_error > QUATERNION_NORM_TOLERANCE:
            fail("INVALID_QUATERNION", f"poses[{index}].R norm {norm} is not unit length")
        if record["RGB"] is not None:
            fail("UNSUPPORTED_RGB_POSE_FIELD", "non-null pose RGB fields are not admitted")
        if translations:
            path_length += math.dist(translations[-1], translation)
            if not math.isfinite(path_length):
                fail("NONFINITE_POSE_PATH", "pose translation path length overflowed")
        translations.append(translation)
    axes = list(zip(*translations, strict=True))
    return {
        "poseCount": len(poses),
        "timestampFirst": str(poses[0]["ts"]),
        "timestampLast": str(poses[-1]["ts"]),
        "timestampsStrictlyIncreasing": True,
        "translationBounds": {
            axis: {"minimum": min(values), "maximum": max(values)}
            for axis, values in zip(("x", "y", "z"), axes, strict=True)
        },
        "translationPathLength": path_length,
        "maximumQuaternionNormError": maximum_norm_error,
        "quaternionComponentOrder": "source_declared_R_order_not_reinterpreted",
        "fusionPoses": None,
    }


def _capture_tool_identity() -> tuple[Path, FileSnapshot, dict[str, Any]]:
    path, snapshot = _safe_regular_file(Path(__file__), "alignment tool source", 16 * 1024 * 1024)
    digest = _hash_file(path, snapshot, "alignment tool source")
    return path, snapshot, {
        "fileName": path.name,
        "sha256": digest,
        "sizeBytes": snapshot.size_bytes,
    }


def inspect_inputs(arguments: argparse.Namespace) -> InputBundle:
    scans = parse_scan_range(arguments.scan_range)
    xgrids_root = _safe_directory(arguments.xgrids_root, "XGRIDS source root")
    stage_evidence, stage_paths, stage_snapshots = _load_stage_manifest(
        arguments.stage_manifest, bool(arguments.verify_e57_bytes)
    )
    reception, reception_path, reception_snapshot = _load_reception_evidence(
        arguments.reception_evidence, stage_evidence["e57"]
    )
    ply_path, ply_snapshot = _safe_regular_file(arguments.xgrids_ply, "XGRIDS PLY", MAX_PLY_BYTES)
    try:
        ply_path.relative_to(xgrids_root)
    except ValueError:
        fail("XGRIDS_ROOT_MISMATCH", "XGRIDS PLY must be inside --xgrids-root")
    ply_sha = _hash_file(ply_path, ply_snapshot, "XGRIDS PLY")
    layout = _read_ply_header(ply_path, ply_snapshot)
    poses_path, poses_snapshot, poses_payload, poses_sha = _read_bound_bytes(
        arguments.xgrids_poses, "XGRIDS poses", MAX_POSES_BYTES
    )
    try:
        poses_path.relative_to(xgrids_root)
    except ValueError:
        fail("XGRIDS_ROOT_MISMATCH", "XGRIDS poses must be inside --xgrids-root")
    pose_summary = _parse_poses(poses_payload)
    tool_path, tool_snapshot, tool_evidence = _capture_tool_identity()

    evidence = {
        **stage_evidence,
        "receptionScopeEvidence": reception,
        "xgridsPly": {
            "fileName": ply_path.name,
            "sha256": ply_sha,
            "sizeBytes": ply_snapshot.size_bytes,
            "layout": _ply_layout_evidence(layout),
        },
        "xgridsPoses": {
            "fileName": poses_path.name,
            "sha256": poses_sha,
            "sizeBytes": poses_snapshot.size_bytes,
            "summary": pose_summary,
        },
        "toolSource": tool_evidence,
    }
    paths = {
        **stage_paths,
        "receptionEvidence": reception_path,
        "xgridsPly": ply_path,
        "xgridsPoses": poses_path,
        "toolSource": tool_path,
    }
    snapshots = {
        **stage_snapshots,
        "receptionEvidence": reception_snapshot,
        "xgridsPly": ply_snapshot,
        "xgridsPoses": poses_snapshot,
        "toolSource": tool_snapshot,
    }
    if scans != RECEPTION_SCAN_IDS:
        fail("INTERNAL_SCOPE_ERROR", "Reception scan scope changed unexpectedly")
    return InputBundle(
        paths=paths,
        snapshots=snapshots,
        evidence=evidence,
        ply_layout=layout,
        pose_summary=pose_summary,
        tool_snapshot=tool_snapshot,
        tool_evidence=tool_evidence,
        protected_roots=(
            stage_paths["stageManifest"].parent,
            xgrids_root,
            reception_path.parent,
            tool_path.parent,
        ),
    )


def _verify_expected_digests(arguments: argparse.Namespace, bundle: InputBundle) -> None:
    expected = {
        "captureStageManifest": arguments.expected_stage_manifest_sha256,
        "receptionScopeEvidence": arguments.expected_reception_evidence_sha256,
        "xgridsPly": arguments.expected_ply_sha256,
        "xgridsPoses": arguments.expected_poses_sha256,
    }
    actual = {
        "captureStageManifest": bundle.evidence["captureStageManifest"]["sha256"],
        "receptionScopeEvidence": bundle.evidence["receptionScopeEvidence"]["fileSha256"],
        "xgridsPly": bundle.evidence["xgridsPly"]["sha256"],
        "xgridsPoses": bundle.evidence["xgridsPoses"]["sha256"],
    }
    for key, raw_expected in expected.items():
        pinned = _require_sha256(raw_expected, f"expected {key} SHA-256")
        if pinned != actual[key]:
            fail("PINNED_DIGEST_MISMATCH", f"pinned {key} SHA-256 does not match current bytes")


def _deterministic_indices(
    count: int, limit: int, seed: bytes | str = b"omnitwin-deterministic-sample-v1"
) -> list[int]:
    """Select a reproducible, full-cycle pseudorandom subset of source indices.

    A coprime modular stride avoids always preferring early or evenly spaced
    file records.  This is deterministic sampling, not cryptographic random
    selection.
    """

    if count <= 0 or limit <= 0:
        return []
    selected = min(count, limit)
    if selected == count:
        return list(range(count))
    seed_bytes = seed.encode("utf-8") if isinstance(seed, str) else seed
    digest = hashlib.sha256(
        seed_bytes + b"\0" + str(count).encode("ascii") + b"\0" + str(limit).encode("ascii")
    ).digest()
    start = int.from_bytes(digest[:8], "big") % count
    step = 1 + int.from_bytes(digest[8:16], "big") % (count - 1)
    while math.gcd(step, count) != 1:
        step = 1 if step + 1 >= count else step + 1
    return [(start + index * step) % count for index in range(selected)]


def _load_ply_sample(
    path: Path,
    snapshot: FileSnapshot,
    layout: PlyLayout,
    limit: int,
    sample_seed: str,
    np: Any,
) -> Any:
    indices = _deterministic_indices(layout.vertex_count, limit, sample_seed)
    wanted = set(indices)
    property_names = [prop.name for prop in layout.vertex_properties]
    xyz_indices = tuple(property_names.index(axis) for axis in ("x", "y", "z"))
    points: list[tuple[float, float, float]] = []
    try:
        with path.open("rb") as source:
            source.seek(layout.data_offset)
            if layout.format_name == "ascii":
                for vertex_index in range(layout.vertex_count):
                    line = source.readline()
                    if not line:
                        fail("TRUNCATED_PLY_VERTICES", "ASCII PLY ended inside vertex data")
                    try:
                        fields = line.decode("ascii").split()
                    except UnicodeDecodeError:
                        fail("INVALID_ASCII_PLY", "ASCII PLY vertex is not ASCII")
                    if len(fields) != len(layout.vertex_properties):
                        fail("INVALID_ASCII_PLY", "ASCII PLY vertex field count differs from header")
                    try:
                        point = tuple(float(fields[position]) for position in xyz_indices)
                    except ValueError:
                        fail("INVALID_ASCII_PLY", "ASCII PLY xyz field is not numeric")
                    if not all(math.isfinite(value) for value in point):
                        fail("NONFINITE_PLY_POINT", "PLY contains a non-finite vertex xyz value")
                    if vertex_index in wanted:
                        points.append(point)
            else:
                endian = "<" if layout.format_name == "binary_little_endian" else ">"
                record = struct.Struct(
                    endian + "".join(
                        PLY_SCALAR_TYPES[prop.scalar_type or ""][0]
                        for prop in layout.vertex_properties
                    )
                )
                stride = layout.vertex_stride_bytes
                if stride is None or record.size != stride:
                    fail("INTERNAL_PLY_LAYOUT_ERROR", "binary PLY stride calculation drifted")
                for vertex_index in range(layout.vertex_count):
                    payload = source.read(stride)
                    if len(payload) != stride:
                        fail("TRUNCATED_PLY_VERTICES", "binary PLY ended inside vertex data")
                    values = record.unpack(payload)
                    point = tuple(float(values[position]) for position in xyz_indices)
                    if not all(math.isfinite(value) for value in point):
                        fail("NONFINITE_PLY_POINT", "PLY contains a non-finite vertex xyz value")
                    if vertex_index in wanted:
                        points.append(point)
    except OSError as error:
        fail("READ_FAILED", f"could not sample XGRIDS PLY: {error}")
    _snapshot_matches(path, snapshot, "XGRIDS PLY")
    array = np.asarray(points, dtype=np.float64)
    if array.shape != (len(indices), 3) or array.shape[0] < MIN_DIAGNOSTIC_POINTS:
        fail("INSUFFICIENT_PLY_SAMPLE", "PLY sample does not contain enough finite xyz points")
    return array


def _load_geometry_dependencies() -> tuple[Any, Any, Any, dict[str, str]]:
    try:
        np = importlib.import_module("numpy")
    except ImportError as error:
        fail("NUMPY_UNAVAILABLE", "diagnose mode needs NumPy; preflight mode does not")
        raise AssertionError from error
    try:
        scipy = importlib.import_module("scipy")
        spatial = importlib.import_module("scipy.spatial")
    except ImportError as error:
        fail("SCIPY_UNAVAILABLE", "diagnose mode needs SciPy; preflight mode does not")
        raise AssertionError from error
    return np, scipy, spatial.cKDTree, {
        "numpy": str(getattr(np, "__version__", "unknown")),
        "scipy": str(getattr(scipy, "__version__", "unknown")),
    }


def _organized_e57_sample(
    record: dict[str, Any], scan_id: int, limit: int, np: Any
) -> tuple[Any, dict[str, Any]]:
    expected_fields = {
        "cartesianX",
        "cartesianY",
        "cartesianZ",
        "rowIndex",
        "columnIndex",
    }
    returned_fields = {str(key) for key in record}
    if returned_fields != expected_fields:
        fail(
            "UNEXPECTED_E57_POINT_FIELDS",
            f"scan {scan_id} fields differ; missing={sorted(expected_fields-returned_fields)}, "
            f"unexpected={sorted(returned_fields-expected_fields)}",
        )
    arrays = {
        name: np.asarray(record[name])
        for name in expected_fields
    }
    point_count = int(arrays["cartesianX"].size)
    if point_count < MIN_DIAGNOSTIC_POINTS:
        fail("INSUFFICIENT_E57_POINTS", f"scan {scan_id} returned too few organized points")
    for name, array in arrays.items():
        if array.ndim != 1 or int(array.size) != point_count:
            fail("INVALID_E57_SCAN", f"scan {scan_id} field {name} is not a matching vector")
    x = arrays["cartesianX"].astype(np.float64, copy=False)
    y = arrays["cartesianY"].astype(np.float64, copy=False)
    z = arrays["cartesianZ"].astype(np.float64, copy=False)
    rows_float = arrays["rowIndex"].astype(np.float64, copy=False)
    columns_float = arrays["columnIndex"].astype(np.float64, copy=False)
    if (
        not np.all(np.isfinite(rows_float))
        or not np.all(np.isfinite(columns_float))
        or not np.all(rows_float == np.floor(rows_float))
        or not np.all(columns_float == np.floor(columns_float))
    ):
        fail("INVALID_ORGANIZED_INDEX", f"scan {scan_id} has non-integer row/column indexes")
    rows = rows_float.astype(np.int64)
    columns = columns_float.astype(np.int64)
    if (
        int(np.min(rows)) < 0
        or int(np.max(rows)) >= RECEPTION_E57_ORGANIZED_ROWS
        or int(np.min(columns)) < 0
        or int(np.max(columns)) >= RECEPTION_E57_ORGANIZED_COLUMNS
    ):
        fail("ORGANIZED_INDEX_OUT_OF_RANGE", f"scan {scan_id} index leaves the frozen 1800x3600 grid")
    linear_cells = rows * RECEPTION_E57_ORGANIZED_COLUMNS + columns
    if int(np.unique(linear_cells).size) != point_count:
        fail("DUPLICATE_ORGANIZED_CELL", f"scan {scan_id} repeats an organized row/column cell")
    finite = np.isfinite(x) & np.isfinite(y) & np.isfinite(z)
    stride = RECEPTION_E57_ORGANIZED_SAMPLE_STRIDE
    grid_selected = finite & (rows % stride == 0) & (columns % stride == 0)
    selected_positions = np.flatnonzero(grid_selected)
    if int(selected_positions.size) < MIN_DIAGNOSTIC_POINTS:
        fail("INSUFFICIENT_ORGANIZED_SAMPLE", f"scan {scan_id} has too few stride-selected cells")
    selected_positions = selected_positions[
        np.argsort(linear_cells[selected_positions], kind="stable")
    ]
    capped_positions = _deterministic_indices(
        int(selected_positions.size), limit, f"organized-e57-scan-{scan_id}"
    )
    selected_positions = selected_positions[capped_positions]
    points = np.column_stack(
        (x[selected_positions], y[selected_positions], z[selected_positions])
    ).astype(np.float64, copy=False)
    return points, {
        "returnedPointCount": point_count,
        "finitePointCount": int(np.count_nonzero(finite)),
        "organizedRows": RECEPTION_E57_ORGANIZED_ROWS,
        "organizedColumns": RECEPTION_E57_ORGANIZED_COLUMNS,
        "rowAnchor": 0,
        "columnAnchor": 0,
        "rowStride": stride,
        "columnStride": stride,
        "strideSelectedFiniteCellCount": int(np.count_nonzero(grid_selected)),
        "samplePointCountAfterLimit": int(points.shape[0]),
        "compactedFiniteStreamOrderUsedForGridSelection": False,
    }


class Pye57PointAdapter:
    adapter_name = "pye57.read_scan(transform=True)"

    def read_samples(
        self, e57_path: Path, scan_ids: Sequence[int], per_scan_limit: int
    ) -> dict[str, Any]:
        try:
            pye57 = importlib.import_module("pye57")
        except ImportError as error:
            fail("PYE57_UNAVAILABLE", "diagnose mode needs pye57; preflight mode does not")
            raise AssertionError from error
        np = importlib.import_module("numpy")
        points_by_scan: dict[int, Any] = {}
        raw_counts: dict[int, int] = {}
        organized_sampling: dict[int, dict[str, Any]] = {}
        try:
            with pye57.E57(str(e57_path), mode="r") as source:
                scan_count = int(source.scan_count)
                for scan_id in scan_ids:
                    if scan_id < 0 or scan_id >= scan_count:
                        fail("MISSING_E57_SCAN", f"E57 has no scan index {scan_id}")
                    record = source.read_scan(
                        scan_id,
                        intensity=False,
                        colors=False,
                        row_column=True,
                        transform=True,
                    )
                    if not isinstance(record, dict):
                        fail("INVALID_E57_SCAN", f"pye57 scan {scan_id} returned no field mapping")
                    points, sampling = _organized_e57_sample(
                        record, scan_id, per_scan_limit, np
                    )
                    raw_counts[scan_id] = sampling["returnedPointCount"]
                    organized_sampling[scan_id] = sampling
                    points_by_scan[scan_id] = points
        except AlignmentError:
            raise
        except Exception as error:
            fail("E57_READ_FAILED", f"pye57 could not read selected scans: {error}")
        version = str(getattr(pye57, "__version__", "unknown"))
        return {
            "adapter": {"name": self.adapter_name, "version": version},
            "scanCount": scan_count,
            "rawPointCounts": raw_counts,
            "organizedSampling": organized_sampling,
            "pointsByScan": points_by_scan,
        }


def _read_e57_point_samples(
    path: Path,
    snapshot: FileSnapshot,
    scan_ids: Sequence[int],
    per_scan_limit: int,
    np: Any,
    adapter: Any | None,
) -> tuple[dict[int, Any], dict[str, Any]]:
    selected = adapter if adapter is not None else Pye57PointAdapter()
    result = selected.read_samples(path, scan_ids, per_scan_limit)
    if not isinstance(result, dict) or not isinstance(result.get("pointsByScan"), dict):
        fail("INVALID_E57_ADAPTER", "E57 point adapter returned an invalid result")
    scan_count = _require_int(result.get("scanCount"), "E57 adapter scanCount", minimum=1)
    if scan_count != RECEPTION_E57_SCAN_COUNT:
        fail("E57_SCAN_COUNT_MISMATCH", "Reception evidence is pinned to a 149-scan E57")
    points_by_scan: dict[int, Any] = {}
    evidence_rows: list[dict[str, Any]] = []
    for scan_id in scan_ids:
        raw_points = result["pointsByScan"].get(scan_id)
        if raw_points is None:
            raw_points = result["pointsByScan"].get(str(scan_id))
        if raw_points is None:
            fail("MISSING_E57_SCAN_SAMPLE", f"adapter returned no points for scan {scan_id}")
        points = np.asarray(raw_points, dtype=np.float64)
        if points.ndim != 2 or points.shape[1] != 3:
            fail("INVALID_E57_SCAN_SAMPLE", f"scan {scan_id} sample must be Nx3")
        finite = np.all(np.isfinite(points), axis=1)
        points = points[finite]
        indices = _deterministic_indices(
            int(points.shape[0]), per_scan_limit, f"e57-scan-{scan_id}"
        )
        points = points[indices]
        if points.shape[0] < MIN_DIAGNOSTIC_POINTS:
            fail("INSUFFICIENT_E57_POINTS", f"scan {scan_id} has too few finite sampled points")
        points_by_scan[scan_id] = points
        raw_counts = result.get("rawPointCounts", {})
        raw_count = raw_counts.get(scan_id, raw_counts.get(str(scan_id))) if isinstance(raw_counts, dict) else None
        organized_rows = result.get("organizedSampling", {})
        organized_row = (
            organized_rows.get(scan_id, organized_rows.get(str(scan_id)))
            if isinstance(organized_rows, dict)
            else None
        )
        evidence_rows.append(
            {
                "scanId": scan_id,
                "rawPointCount": raw_count,
                "samplePointCount": int(points.shape[0]),
                "organizedSampling": organized_row,
            }
        )
    _snapshot_matches(path, snapshot, "primary E57")
    adapter_evidence = result.get("adapter")
    if not isinstance(adapter_evidence, dict):
        adapter_evidence = {"name": type(selected).__name__, "version": "test-or-custom"}
    return points_by_scan, {
        "adapter": adapter_evidence,
        "openMode": "read-only",
        "pointSampling": (
            "production pye57 adapter selects fixed organized row/column cells before any deterministic cap; "
            "custom test adapters are identified explicitly"
        ),
        "productionAdapterRequiresOrganizedRowsAndColumns": True,
        "scanCount": scan_count,
        "scans": evidence_rows,
    }


def _axis_rotations(np: Any, determinant_sign: int) -> list[Any]:
    if determinant_sign not in (-1, 1):
        fail("INTERNAL_ROTATION_ERROR", "axis determinant sign must be -1 or +1")
    rotations: list[Any] = []
    import itertools

    identity = np.eye(3, dtype=np.float64)
    for permutation in itertools.permutations(range(3)):
        permuted = identity[:, permutation]
        for signs in itertools.product((-1.0, 1.0), repeat=3):
            candidate = permuted @ np.diag(signs)
            determinant = float(np.linalg.det(candidate))
            if determinant * determinant_sign > 0.5:
                rotations.append(candidate)
    rotations.sort(key=lambda matrix: tuple(float(value) for value in matrix.ravel()))
    if len(rotations) != 24:
        fail("INTERNAL_ROTATION_ERROR", "axis rotation family is not 24")
    return rotations


def _proper_axis_rotations(np: Any) -> list[Any]:
    return _axis_rotations(np, 1)


def _geometry_conditioning(points: Any, label: str, np: Any) -> dict[str, Any]:
    centered = points - np.mean(points, axis=0)
    singular_values = np.linalg.svd(centered, compute_uv=False)
    if singular_values.size != 3 or singular_values[0] <= 0:
        fail("RANK_DEFICIENT", f"{label} point sample has no three-dimensional spread")
    relative = float(singular_values[-1] / singular_values[0])
    minimum_relative = 1e-5
    if relative < minimum_relative:
        fail(
            "ILL_CONDITIONED_GEOMETRY",
            f"{label} smallest/largest singular-value ratio {relative} is below {minimum_relative}",
        )
    return {
        "pointCount": int(points.shape[0]),
        "singularValues": [float(value) for value in singular_values],
        "smallestToLargestRatio": relative,
        "minimumAcceptedRatio": minimum_relative,
        "passes": True,
    }


def fit_proper_rigid(source: Any, target: Any, np: Any) -> tuple[Any, Any, bool]:
    source = np.asarray(source, dtype=np.float64)
    target = np.asarray(target, dtype=np.float64)
    if source.shape != target.shape or source.ndim != 2 or source.shape[1] != 3:
        fail("INVALID_CORRESPONDENCES", "rigid correspondences must be matching Nx3 arrays")
    if source.shape[0] < 4 or not np.all(np.isfinite(source)) or not np.all(np.isfinite(target)):
        fail("INVALID_CORRESPONDENCES", "rigid fit needs at least four finite pairs")
    source_mean = np.mean(source, axis=0)
    target_mean = np.mean(target, axis=0)
    source_centered = source - source_mean
    target_centered = target - target_mean
    if int(np.linalg.matrix_rank(source_centered)) < 3 or int(np.linalg.matrix_rank(target_centered)) < 3:
        fail("RANK_DEFICIENT", "rigid correspondences must span three dimensions")
    covariance = target_centered.T @ source_centered
    left, _, right_t = np.linalg.svd(covariance)
    unconstrained = left @ right_t
    reflection_corrected = float(np.linalg.det(unconstrained)) < 0.0
    diagonal = np.eye(3, dtype=np.float64)
    if reflection_corrected:
        diagonal[-1, -1] = -1.0
    rotation = left @ diagonal @ right_t
    if float(np.linalg.det(rotation)) <= 0.0:
        fail("IMPROPER_TRANSFORM", "proper rigid fit produced a non-positive determinant")
    translation = target_mean - rotation @ source_mean
    return rotation, translation, reflection_corrected


def _residual_statistics(values: Any, np: Any) -> dict[str, Any]:
    array = np.asarray(values, dtype=np.float64)
    if array.ndim != 1 or array.size == 0 or not np.all(np.isfinite(array)) or np.any(array < 0):
        fail("INVALID_RESIDUALS", "residuals must be a non-empty finite nonnegative vector")
    return {
        "count": int(array.size),
        "maximum": float(np.max(array)),
        "mean": float(np.mean(array)),
        "median": float(np.percentile(array, 50, method="linear")),
        "p95": float(np.percentile(array, 95, method="linear")),
        "rmse": float(np.sqrt(np.mean(array * array))),
    }


def _trimmed_statistics(values: Any, retain_fraction: float, np: Any) -> dict[str, Any]:
    array = np.sort(np.asarray(values, dtype=np.float64))
    retain_count = max(1, int(math.floor(array.size * retain_fraction)))
    return {
        "retainFraction": retain_fraction,
        "retainedCount": retain_count,
        "statisticsMeters": _residual_statistics(array[:retain_count], np),
    }


def _evaluate_bidirectional(
    source: Any,
    target: Any,
    rotation: Any,
    translation: Any,
    overlap_distance: float,
    np: Any,
    cKDTree: Any,
) -> dict[str, Any]:
    transformed = source @ rotation.T + translation
    target_tree = cKDTree(target)
    source_tree = cKDTree(transformed)
    source_to_target, _ = target_tree.query(transformed, k=1, workers=1)
    target_to_source, _ = source_tree.query(target, k=1, workers=1)
    combined = np.concatenate((source_to_target, target_to_source))

    def direction(values: Any) -> dict[str, Any]:
        return {
            "statisticsMeters": _residual_statistics(values, np),
            "trimmed95Percent": _trimmed_statistics(values, 0.95, np),
            "overlapFractionAtThreshold": float(np.mean(values <= overlap_distance)),
        }

    forward = direction(source_to_target)
    reverse = direction(target_to_source)
    return {
        "sourceToTarget": forward,
        "targetToSource": reverse,
        "combinedStatisticsMeters": _residual_statistics(combined, np),
        "combinedTrimmed95Percent": _trimmed_statistics(combined, 0.95, np),
        "minimumDirectionalOverlapFraction": min(
            forward["overlapFractionAtThreshold"], reverse["overlapFractionAtThreshold"]
        ),
        "overlapDistanceMeters": overlap_distance,
    }


def _sample_array(points: Any, limit: int, seed: str, np: Any) -> Any:
    indices = _deterministic_indices(int(points.shape[0]), limit, seed)
    return points[indices]


def _fit_rigid_icp(
    source: Any,
    target: Any,
    *,
    maximum_iterations: int,
    trim_fraction: float,
    determinant_sign: int = 1,
    np: Any,
    cKDTree: Any,
) -> tuple[Any, Any, dict[str, Any]]:
    handedness = "proper" if determinant_sign == 1 else "improper_mirror_competitor"
    # Proper and improper competitors must see identical optimization samples;
    # only the determinant family is allowed to differ.
    fit_source = _sample_array(source, 40_000, "icp-fit-source-common", np)
    fit_target = _sample_array(target, 80_000, "icp-fit-target-common", np)
    init_source = _sample_array(fit_source, 8_000, "icp-init-source-common", np)
    init_target = _sample_array(fit_target, 16_000, "icp-init-target-common", np)
    conditioning = {
        "source": _geometry_conditioning(fit_source, "source", np),
        "target": _geometry_conditioning(fit_target, "target", np),
    }
    source_center = np.mean(init_source, axis=0)
    target_center = np.mean(init_target, axis=0)
    init_tree = cKDTree(init_target)
    candidates: list[tuple[float, tuple[float, ...], Any, Any]] = []
    for rotation in _axis_rotations(np, determinant_sign):
        translation = target_center - rotation @ source_center
        transformed = init_source @ rotation.T + translation
        distances, _ = init_tree.query(transformed, k=1, workers=1)
        score = float(np.percentile(distances, 50, method="linear"))
        candidates.append((score, tuple(float(value) for value in rotation.ravel()), rotation, translation))
    candidates.sort(key=lambda row: (row[0], row[1]))
    initial_score = candidates[0][0]
    second_initial_score = candidates[1][0]
    initialization_margin = second_initial_score - initial_score
    target_tree = cKDTree(fit_target)
    multi_start_count = 24
    refined: list[tuple[float, tuple[float, ...], Any, Any, list[dict[str, Any]], int, int]] = []
    for start_rank, (_, tie_break, initial_rotation, initial_translation) in enumerate(
        candidates[:multi_start_count]
    ):
        rotation = initial_rotation.copy()
        translation = initial_translation.copy()
        iterations: list[dict[str, Any]] = []
        previous_rmse: float | None = None
        reflection_correction_count = 0
        for iteration in range(maximum_iterations):
            transformed = fit_source @ rotation.T + translation
            distances, nearest = target_tree.query(transformed, k=1, workers=1)
            cutoff = float(np.quantile(distances, trim_fraction, method="linear"))
            keep = distances <= cutoff
            if int(np.count_nonzero(keep)) < 4:
                fail("INSUFFICIENT_ICP_PAIRS", "trimmed ICP retained fewer than four pairs")
            delta_rotation, delta_translation, corrected = fit_proper_rigid(
                transformed[keep], fit_target[nearest[keep]], np
            )
            reflection_correction_count += int(corrected)
            rotation = delta_rotation @ rotation
            translation = delta_rotation @ translation + delta_translation
            rmse = float(np.sqrt(np.mean(distances[keep] * distances[keep])))
            iterations.append(
                {
                    "iteration": iteration,
                    "retainedPairCount": int(np.count_nonzero(keep)),
                    "trimCutoffMeters": cutoff,
                    "preUpdateTrimmedRmseMeters": rmse,
                }
            )
            if previous_rmse is not None and abs(previous_rmse - rmse) <= 1e-9:
                break
            previous_rmse = rmse
        final_transformed = fit_source @ rotation.T + translation
        final_distances, _ = target_tree.query(final_transformed, k=1, workers=1)
        final_cutoff = float(np.quantile(final_distances, trim_fraction, method="linear"))
        retained = final_distances <= final_cutoff
        final_score = float(np.sqrt(np.mean(final_distances[retained] ** 2)))
        determinant = float(np.linalg.det(rotation))
        if determinant * determinant_sign <= 0.0 or abs(abs(determinant) - 1.0) > 1e-6:
            fail("INVALID_HANDEDNESS", f"{handedness} fit determinant is {determinant}")
        refined.append(
            (
                final_score,
                tie_break,
                rotation,
                translation,
                iterations,
                reflection_correction_count,
                start_rank,
            )
        )
    refined.sort(key=lambda row: (row[0], row[1]))
    best_score, _, rotation, translation, iterations, correction_count, best_start_rank = refined[0]
    distinct_solutions = [refined[0]]
    for candidate in refined[1:]:
        candidate_rotation = candidate[2]
        candidate_translation = candidate[3]
        if all(
            float(np.linalg.norm(candidate_rotation - existing[2])) > 1e-5
            or float(np.linalg.norm(candidate_translation - existing[3])) > 1e-5
            for existing in distinct_solutions
        ):
            distinct_solutions.append(candidate)
    runner_up_score = distinct_solutions[1][0] if len(distinct_solutions) > 1 else None
    refined_margin = runner_up_score - best_score if runner_up_score is not None else None
    initialization_unambiguous = (
        True
        if runner_up_score is None
        else runner_up_score >= max(best_score + 1e-6, best_score * 1.05)
    )
    return rotation, translation, {
        "handednessFamily": handedness,
        "axisInitializationCandidateCount": 24,
        "axisInitializationMedianNearestMeters": initial_score,
        "axisInitializationRunnerUpMedianNearestMeters": second_initial_score,
        "axisInitializationMarginMeters": initialization_margin,
        "refinedMultiStartCount": multi_start_count,
        "selectedRefinedStartRank": best_start_rank,
        "refinedTrimmedRmseMeters": best_score,
        "refinedRunnerUpTrimmedRmseMeters": runner_up_score,
        "refinedMarginMeters": refined_margin,
        "refinedDistinctSolutionCount": len(distinct_solutions),
        "distinctSolutionTolerance": {
            "rotationFrobeniusNorm": 1e-5,
            "translationMeters": 1e-5,
        },
        "axisInitializationUnambiguous": initialization_unambiguous,
        "geometryConditioning": conditioning,
        "convergedByAbsoluteTrimmedRmseDeltaMeters": 1e-9,
        "iterationCount": len(iterations),
        "iterations": iterations,
        "maximumIterations": maximum_iterations,
        "reflectionCorrectionsDuringProperKabsch": correction_count,
        "trimFraction": trim_fraction,
    }


def _axis_angle_rotation(axis: Sequence[float], angle_radians: float, np: Any) -> Any:
    vector = np.asarray(axis, dtype=np.float64)
    vector /= np.linalg.norm(vector)
    x, y, z = vector
    skew = np.array([[0.0, -z, y], [z, 0.0, -x], [-y, x, 0.0]], dtype=np.float64)
    identity = np.eye(3, dtype=np.float64)
    return identity + math.sin(angle_radians) * skew + (1.0 - math.cos(angle_radians)) * (skew @ skew)


def _matrix_evidence(rotation: Any, translation: Any, np: Any) -> dict[str, Any]:
    matrix = np.eye(4, dtype=np.float64)
    matrix[:3, :3] = rotation
    matrix[:3, 3] = translation
    cosine = min(1.0, max(-1.0, (float(np.trace(rotation)) - 1.0) / 2.0))
    return {
        "determinantRotation": float(np.linalg.det(rotation)),
        "matrixColumnMajor": [float(value) for value in matrix.flatten(order="F")],
        "rotationAngleDegrees": math.degrees(math.acos(cosine)),
        "rotationRowMajor": [[float(value) for value in row] for row in rotation],
        "scaleFixed": 1.0,
        "translationMeters": [float(value) for value in translation],
    }


def _build_diagnostic(
    arguments: argparse.Namespace,
    bundle: InputBundle,
    e57_adapter: Any | None,
) -> dict[str, Any]:
    _verify_expected_digests(arguments, bundle)
    np, _scipy, cKDTree, dependency_versions = _load_geometry_dependencies()
    source = _load_ply_sample(
        bundle.paths["xgridsPly"],
        bundle.snapshots["xgridsPly"],
        bundle.ply_layout,
        arguments.xgrids_sample_points,
        bundle.evidence["xgridsPly"]["sha256"],
        np,
    )
    bundle.evidence["xgridsPly"]["layout"][
        "allDeclaredVertexXyzValidatedInDiagnostic"
    ] = True
    bundle.evidence["xgridsPly"]["layout"]["diagnosticValidationScope"] = (
        "all declared scalar vertex records and every vertex xyz; non-vertex elements and trailing payload unparsed"
    )
    scan_ids = FROZEN_FIT_SCAN_IDS + FROZEN_VALIDATION_SCAN_IDS
    points_by_scan, e57_read = _read_e57_point_samples(
        bundle.paths["e57"],
        bundle.snapshots["e57"],
        scan_ids,
        arguments.points_per_scan,
        np,
        e57_adapter,
    )
    training_target = np.vstack([points_by_scan[index] for index in FROZEN_FIT_SCAN_IDS])
    validation_target = np.vstack(
        [points_by_scan[index] for index in FROZEN_VALIDATION_SCAN_IDS]
    )
    rotation, translation, fit_trace = _fit_rigid_icp(
        source,
        training_target,
        maximum_iterations=arguments.maximum_iterations,
        trim_fraction=arguments.trim_fraction,
        np=np,
        cKDTree=cKDTree,
    )
    mirror_rotation, mirror_translation, mirror_fit_trace = _fit_rigid_icp(
        source,
        training_target,
        maximum_iterations=arguments.maximum_iterations,
        trim_fraction=arguments.trim_fraction,
        determinant_sign=-1,
        np=np,
        cKDTree=cKDTree,
    )
    training_metrics = _evaluate_bidirectional(
        source,
        training_target,
        rotation,
        translation,
        arguments.overlap_distance_m,
        np,
        cKDTree,
    )
    validation_metrics = _evaluate_bidirectional(
        source,
        validation_target,
        rotation,
        translation,
        arguments.overlap_distance_m,
        np,
        cKDTree,
    )

    source_center = np.mean(source, axis=0)
    mapped_center = rotation @ source_center + translation
    wrong_delta = _axis_angle_rotation((1.0, 2.0, 3.0), math.radians(37.0), np)
    wrong_rotation = wrong_delta @ rotation
    wrong_translation = mapped_center - wrong_rotation @ source_center
    wrong_metrics = _evaluate_bidirectional(
        source,
        validation_target,
        wrong_rotation,
        wrong_translation,
        arguments.overlap_distance_m,
        np,
        cKDTree,
    )
    mirror_metrics = _evaluate_bidirectional(
        source,
        validation_target,
        mirror_rotation,
        mirror_translation,
        arguments.overlap_distance_m,
        np,
        cKDTree,
    )
    primary_rmse = validation_metrics["combinedStatisticsMeters"]["rmse"]
    wrong_rmse = wrong_metrics["combinedStatisticsMeters"]["rmse"]
    mirror_rmse = mirror_metrics["combinedStatisticsMeters"]["rmse"]
    separation_pass = primary_rmse < 0.95 * min(wrong_rmse, mirror_rmse)
    initialization_unambiguous = bool(fit_trace["axisInitializationUnambiguous"])
    source_rms_radius = float(
        np.sqrt(np.mean(np.sum((source - np.mean(source, axis=0)) ** 2, axis=1)))
    )
    target_rms_radius = float(
        np.sqrt(
            np.mean(
                np.sum(
                    (training_target - np.mean(training_target, axis=0)) ** 2,
                    axis=1,
                )
            )
        )
    )
    unit_scale_ratio = target_rms_radius / source_rms_radius
    unit_scale_plausible = 0.8 <= unit_scale_ratio <= 1.25
    accuracy_pass = (
        validation_metrics["combinedStatisticsMeters"]["rmse"] <= arguments.max_rmse_m
        and validation_metrics["combinedStatisticsMeters"]["p95"] <= arguments.max_p95_m
        and validation_metrics["minimumDirectionalOverlapFraction"] >= arguments.min_overlap_fraction
    )
    return {
        "classification": "authority_none_private_local_geometric_diagnostic",
        "dependencies": dependency_versions,
        "e57Read": e57_read,
        "sampling": {
            "xgridsDeclaredVertexCount": bundle.ply_layout.vertex_count,
            "xgridsSamplePointCount": int(source.shape[0]),
            "pointsPerE57ScanLimit": arguments.points_per_scan,
            "sourceSelection": "deterministic hash-seeded coprime-stride PLY vertex indices",
            "fitE57PointCount": int(training_target.shape[0]),
            "validationE57PointCount": int(validation_target.shape[0]),
        },
        "fit": {
            "method": "24 proper axis initializations; all 24 refined with trimmed point-to-point ICP and proper Kabsch updates",
            "sourceFrame": "xgrids_ply_local_unreviewed",
            "targetFrame": "e57_root_unreviewed",
            "transform": _matrix_evidence(rotation, translation, np),
            "trace": fit_trace,
            "unitsAssumption": "both point sources are assumed metres; scale is fixed to exactly 1",
            "handednessPosture": (
                "The fitted matrix is proper (determinant +1). Sampled-geometry separation from an optimized "
                "improper competitor does not prove the physical source handedness."
            ),
        },
        "trainingEvaluation": training_metrics,
        "frozenValidationEvaluation": {
            "scanIds": list(FROZEN_VALIDATION_SCAN_IDS),
            "usedDuringFit": False,
            "metrics": validation_metrics,
        },
        "negativeControls": {
            "separationRule": (
                "proper candidate validation RMSE must be at least 5% lower than the wrong-angle control "
                "and the separately refined 24-start improper/mirrored axis family"
            ),
            "separationPass": separation_pass,
            "separationMeaning": (
                "A pass only reduces ambiguity in these deterministic point samples. It does not prove physical handedness."
            ),
            "wrongAngle37DegreesAroundAxis123": {
                "determinantRotation": float(np.linalg.det(wrong_rotation)),
                "metrics": wrong_metrics,
            },
            "optimizedImproperMirrorCompetitor": {
                "determinantRotation": float(np.linalg.det(mirror_rotation)),
                "isForbiddenCandidate": True,
                "fitTrace": mirror_fit_trace,
                "metrics": mirror_metrics,
            },
        },
        "operatorProposedAccuracyThresholds": {
            "reviewedOrApproved": False,
            "maximumValidationCombinedRmseMeters": arguments.max_rmse_m,
            "maximumValidationCombinedP95Meters": arguments.max_p95_m,
            "minimumValidationDirectionalOverlapFraction": arguments.min_overlap_fraction,
            "overlapDistanceMeters": arguments.overlap_distance_m,
        },
        "fixedUnitScaleDiagnostic": {
            "scaleIsFitted": False,
            "fixedRigidScale": 1.0,
            "e57ToXgridsRmsRadiusRatio": unit_scale_ratio,
            "diagnosticPlausibilityRangeInclusive": [0.8, 1.25],
            "passes": unit_scale_plausible,
            "notIndependentScaleControl": True,
        },
        "diagnosticThresholdResult": {
            "passesOperatorProposedNumbers": accuracy_pass,
            "passesNegativeControlSeparation": separation_pass,
            "passesAxisInitializationAmbiguityGate": initialization_unambiguous,
            "passesFixedUnitScalePlausibilityGate": unit_scale_plausible,
            "passesAllDiagnosticChecks": (
                accuracy_pass
                and separation_pass
                and initialization_unambiguous
                and unit_scale_plausible
            ),
            "notAReviewedT505AccuracyDecision": True,
        },
    }


def _scope_evidence() -> dict[str, Any]:
    return {
        "roomLabel": "Reception Room",
        "roomSlug": "reception-room",
        "requestedScanIds": list(RECEPTION_SCAN_IDS),
        "frozenFitScanIds": list(FROZEN_FIT_SCAN_IDS),
        "frozenValidationScanIds": list(FROZEN_VALIDATION_SCAN_IDS),
        "frozenTestScanIdsNotReadOrUsed": list(FROZEN_TEST_SCAN_IDS),
        "quarantinedOrBoundaryScanIdsNotFitOrValidated": list(FROZEN_QUARANTINED_SCAN_IDS),
        "leakageGuard": "validation/test stations never initialize or update the fitted transform",
    }


def _eligibility(mode: str, diagnostic: dict[str, Any] | None) -> dict[str, Any]:
    diagnostic_pass = bool(
        diagnostic
        and diagnostic["diagnosticThresholdResult"]["passesAllDiagnosticChecks"]
    )
    if mode == "diagnose":
        ply_container_status = "failed_nonvertex_payload_unparsed"
        ply_container_meaning = (
            "Every declared vertex xyz is checked in diagnostic mode, but faces and trailing "
            "non-vertex payload are deliberately not parsed."
        )
    else:
        ply_container_status = "failed_vertex_and_nonvertex_payload_unparsed"
        ply_container_meaning = (
            "Preflight checks the PLY header and binary length lower bound only; it does not read "
            "or validate declared vertex xyz values, faces, or trailing non-vertex payload."
        )
    gates = [
        {
            "gate": "exact_input_receipt_binding",
            "status": "passed_local_bytes_and_stage_declaration",
            "meaning": "The receipt binds the stage manifest, PLY, poses, audit, and tool bytes. It does not authenticate their creator.",
        },
        {
            "gate": "reviewed_reception_room_identity",
            "status": "failed_absent",
            "meaning": "Visual compatibility and scan numbering do not prove the physical room identity.",
        },
        {
            "gate": "authoritative_processing_and_commercial_rights",
            "status": "failed_absent",
            "meaning": "This tool accepts no rights approval and grants none.",
        },
        {
            "gate": "independent_metric_controls",
            "status": "failed_absent",
            "meaning": "Cloud-to-cloud nearest neighbours are not independent surveyed controls.",
        },
        {
            "gate": "reviewed_room_local_e57_crop",
            "status": "failed_absent",
            "meaning": "The frozen station list is not a human-reviewed spatial crop of the room surfaces.",
        },
        {
            "gate": "independent_physical_handedness_control",
            "status": "failed_absent",
            "meaning": "An optimized improper competitor tests sampled ambiguity but does not prove physical handedness.",
        },
        {
            "gate": "complete_ply_container_validation",
            "status": ply_container_status,
            "meaning": ply_container_meaning,
        },
        {
            "gate": "full_resolution_human_privacy_review",
            "status": "failed_incomplete",
            "meaning": "The bound Reception audit says native-image human review is incomplete.",
        },
        {
            "gate": "reviewed_t505_accuracy_contract",
            "status": "failed_absent",
            "meaning": "Diagnostic command-line numbers are not reviewed T-505 acceptance gates.",
        },
        {
            "gate": "heldout_geometric_diagnostic",
            "status": (
                "passed_operator_proposed_numbers_only"
                if diagnostic_pass
                else "failed_or_not_run"
            ),
            "meaning": "Even a pass is diagnostic-only and cannot replace controls or review.",
        },
        {
            "gate": "fixed_view_human_review",
            "status": "failed_absent",
            "meaning": "This command creates no screenshots and accepts no visual sign-off.",
        },
        {
            "gate": "qualified_transform_review_and_registration",
            "status": "failed_absent",
            "meaning": "No TransformArtifactV0 is proposed, reviewed, signed, or registered.",
        },
    ]
    blockers = [row["gate"] for row in gates if row["status"].startswith("failed")]
    return {
        "eligibleForT505Completion": False,
        "eligibleForT502Training": False,
        "eligibleForRuntimeOrPublicUse": False,
        "mode": mode,
        "gates": gates,
        "blockers": blockers,
        "plainLanguage": (
            "This is a private measuring aid. It cannot approve the room, rights, alignment, "
            "training, runtime use, or publication. T-505 remains open."
        ),
    }


def _base_receipt(mode: str, bundle: InputBundle) -> dict[str, Any]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "mode": mode,
        "status": (
            "preflight_complete_t505_blocked"
            if mode == "preflight"
            else "diagnostic_complete_t505_blocked"
        ),
        "authority": "none",
        "resultType": "not_a_transform_artifact_or_approval",
        "scope": _scope_evidence(),
        "inputEvidence": bundle.evidence,
        "runtime": {
            "python": platform.python_version(),
            "platform": platform.platform(),
        },
        "safety": {
            "sourceMutationPermitted": False,
            "sourceMutationPerformed": False,
            "networkAccessPermitted": False,
            "networkAccessPerformed": False,
            "providerUsePermitted": False,
            "providerUsePerformed": False,
            "trainingPermitted": False,
            "trainingPerformed": False,
            "registrationSigningOrPublicationPermitted": False,
            "registrationSigningOrPublicationPerformed": False,
            "outputPolicy": (
                "one final create-only authority-none JSON receipt; a private same-directory temp is "
                "fsynced, hard-linked without clobber, then removed"
            ),
        },
        "limitations": [
            "Nearest-neighbour cloud agreement can be fooled by repeated walls, floors, ceilings, mirrors, and incomplete coverage.",
            "The XGRIDS poses are syntax- and continuity-checked but are not used as surveyed controls.",
            "A self-digest detects an unrecomputed edit; it does not authenticate author, time, truth, rights, or immutability.",
            "No universal T-505 geometric threshold is asserted by this tool.",
            "The station split is frozen, but no reviewed room-local spatial crop is claimed.",
            "Twenty-four proper and twenty-four improper axis starts reduce sampled ambiguity but do not exhaust every continuous rotation or prove physical handedness.",
            "Hashing before and after detects persistent or checkpoint-visible changes, but cannot exclude an adversarial mutate-then-restore while pye57 has the path open; stronger assurance requires externally immutable or read-only source custody.",
        ],
    }


def _seal_receipt(document: dict[str, Any]) -> dict[str, Any]:
    unsigned = copy.deepcopy(document)
    unsigned.pop("receipt", None)
    digest = hashlib.sha256(RECEIPT_DIGEST_DOMAIN + _canonical_json_bytes(unsigned)).hexdigest()
    document["receipt"] = {
        "algorithm": "SHA-256",
        "domain": "OMNITWIN_RECEPTION_E57_XGRIDS_ALIGNMENT_V1\\0",
        "sha256": digest,
        "authenticatesCreator": False,
        "provesTimestamp": False,
        "isSignature": False,
    }
    return document


def _verify_bundle_unchanged(bundle: InputBundle) -> None:
    for label, path in bundle.paths.items():
        _snapshot_matches(path, bundle.snapshots[label], label)
    current_tool_sha = _hash_file(
        bundle.paths["toolSource"], bundle.snapshots["toolSource"], "toolSource"
    )
    if current_tool_sha != bundle.tool_evidence["sha256"]:
        fail("TOOL_CHANGED_DURING_RUN", "alignment tool source changed during the run")
    expected_hashes = {
        "stageManifest": bundle.evidence["captureStageManifest"]["sha256"],
        "receptionEvidence": bundle.evidence["receptionScopeEvidence"]["fileSha256"],
        "xgridsPly": bundle.evidence["xgridsPly"]["sha256"],
        "xgridsPoses": bundle.evidence["xgridsPoses"]["sha256"],
    }
    for label, expected in expected_hashes.items():
        actual = _hash_file(bundle.paths[label], bundle.snapshots[label], label)
        if actual != expected:
            fail("FILE_CHANGED_DURING_RUN", f"{label} bytes changed during the run")
    if bundle.evidence["e57"]["currentBytesFullyHashedThisRun"]:
        actual_e57 = _hash_file(bundle.paths["e57"], bundle.snapshots["e57"], "primary E57")
        if actual_e57 != bundle.evidence["e57"]["manifestDeclaredSha256"]:
            fail("FILE_CHANGED_DURING_RUN", "primary E57 bytes changed during the run")


def _is_within(candidate: Path, root: Path) -> bool:
    try:
        candidate.relative_to(root)
        return True
    except ValueError:
        return False


def _write_create_only(
    path: Path,
    document: dict[str, Any],
    protected_paths: Iterable[Path],
    protected_roots: Iterable[Path],
    *,
    _write_hook: Any | None = None,
) -> None:
    output = path.expanduser()
    if output.suffix.lower() != ".json":
        fail("INVALID_OUTPUT_PATH", "output must end in .json")
    if output.exists() or output.is_symlink():
        fail("OUTPUT_EXISTS", "output already exists; receipts are create-only")
    _assert_no_link_ancestors(output.parent, "output path")
    parent = output.parent.resolve(strict=True)
    if not parent.is_dir() or _is_link_like(parent):
        fail("UNSAFE_OUTPUT_PARENT", "output parent must be an existing non-link directory")
    resolved = parent / output.name
    for protected in protected_paths:
        if resolved == protected:
            fail("OUTPUT_OVERLAPS_INPUT", "output path equals an input path")
    for protected_root in protected_roots:
        root = protected_root.resolve(strict=True)
        if _is_within(resolved, root):
            fail("OUTPUT_OVERLAPS_SOURCE_ROOT", f"output is inside protected source root {root.name}")
    payload = json.dumps(
        document,
        allow_nan=False,
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    ).encode("utf-8") + b"\n"
    temp_path: Path | None = None
    published = False
    try:
        descriptor, temp_name = tempfile.mkstemp(
            prefix=f".{output.name}.", suffix=".private-tmp", dir=parent
        )
        temp_path = Path(temp_name)
        with os.fdopen(descriptor, "wb") as target:
            if _write_hook is None:
                target.write(payload)
            else:
                _write_hook(target, payload)
            target.flush()
            os.fsync(target.fileno())
        # A hard link is an atomic, same-filesystem no-clobber publication: it
        # fails if another process created the final path. os.replace is not
        # used because it could overwrite that process's file.
        os.link(temp_path, resolved)
        published = True
        try:
            temp_path.unlink()
        except OSError:
            # The final path already names fully written, fsynced bytes. A
            # leftover private hard-link name is harmless and never mistaken
            # for the final receipt.
            pass
    except FileExistsError:
        fail("OUTPUT_EXISTS", "output appeared before the create-only write")
    except OSError as error:
        fail("OUTPUT_WRITE_FAILED", f"could not create receipt: {error}")
    finally:
        if not published and temp_path is not None:
            try:
                temp_path.unlink(missing_ok=True)
            except OSError:
                pass


def _positive_int(value: str) -> int:
    try:
        parsed = int(value, 10)
    except ValueError as error:
        raise argparse.ArgumentTypeError("must be an integer") from error
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be greater than zero")
    return parsed


def _bounded_positive_int(maximum: int) -> Any:
    def parse(value: str) -> int:
        parsed = _positive_int(value)
        if parsed > maximum:
            raise argparse.ArgumentTypeError(f"must be at most {maximum}")
        return parsed

    return parse


def _fraction(value: str) -> float:
    try:
        parsed = float(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("must be a number") from error
    if not math.isfinite(parsed) or not 0.0 < parsed <= 1.0:
        raise argparse.ArgumentTypeError("must be greater than 0 and at most 1")
    return parsed


def _positive_float(value: str) -> float:
    try:
        parsed = float(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("must be a number") from error
    if not math.isfinite(parsed) or parsed <= 0.0:
        raise argparse.ArgumentTypeError("must be finite and greater than zero")
    return parsed


def build_parser() -> JsonArgumentParser:
    parser = JsonArgumentParser(
        prog="align_e57_xgrids.py",
        description=(
            "Safely inspect or measure the local Reception Room E57 and XGRIDS geometry. "
            "The result is a private diagnostic receipt, never an approval."
        ),
        epilog=(
            "Run preflight first. Copy its four input hashes from the receipt into diagnose. "
            "Both commands fully hash the E57 and refuse to replace an existing output file."
        ),
    )
    subparsers = parser.add_subparsers(dest="mode", required=True)

    def common(selected: argparse.ArgumentParser) -> None:
        selected.add_argument(
            "--stage-manifest", type=Path, required=True, help="capture-stage-manifest.json for the E57"
        )
        selected.add_argument(
            "--reception-evidence", type=Path, required=True, help="authority-none Reception audit JSON"
        )
        selected.add_argument(
            "--xgrids-root", type=Path, required=True, help="protected folder containing both XGRIDS inputs"
        )
        selected.add_argument(
            "--xgrids-ply", type=Path, required=True, help="XGRIDS mesh or point-cloud PLY"
        )
        selected.add_argument(
            "--xgrids-poses", type=Path, required=True, help="XGRIDS poses.json"
        )
        selected.add_argument(
            "--scan-range", required=True, help="must be the audited Reception range 122-144"
        )
        selected.add_argument(
            "--output", type=Path, required=True, help="new .json receipt path outside every source folder"
        )
        selected.add_argument(
            "--verify-e57-bytes",
            action="store_true",
            required=True,
            help="rehash the complete staged E57; required for exact local-byte identity",
        )

    preflight = subparsers.add_parser(
        "preflight", help="validate and fingerprint inputs without reading point geometry"
    )
    common(preflight)

    diagnose = subparsers.add_parser(
        "diagnose", help="fit and measure an authority-none rigid-transform candidate"
    )
    common(diagnose)
    diagnose.add_argument("--expected-stage-manifest-sha256", required=True)
    diagnose.add_argument("--expected-reception-evidence-sha256", required=True)
    diagnose.add_argument("--expected-ply-sha256", required=True)
    diagnose.add_argument("--expected-poses-sha256", required=True)
    diagnose.add_argument(
        "--points-per-scan", type=_bounded_positive_int(100_000), default=20_000
    )
    diagnose.add_argument(
        "--xgrids-sample-points", type=_bounded_positive_int(2_000_000), default=40_000
    )
    diagnose.add_argument(
        "--maximum-iterations", type=_bounded_positive_int(200), default=40
    )
    diagnose.add_argument("--trim-fraction", type=_fraction, default=0.8)
    diagnose.add_argument("--overlap-distance-m", type=_positive_float, required=True)
    diagnose.add_argument("--max-rmse-m", type=_positive_float, required=True)
    diagnose.add_argument("--max-p95-m", type=_positive_float, required=True)
    diagnose.add_argument("--min-overlap-fraction", type=_fraction, required=True)
    return parser


def execute(
    argv: Sequence[str], *, e57_adapter: Any | None = None, write_output: bool = True
) -> dict[str, Any]:
    arguments = build_parser().parse_args(list(argv))
    bundle = inspect_inputs(arguments)
    document = _base_receipt(arguments.mode, bundle)
    diagnostic: dict[str, Any] | None = None
    if arguments.mode == "diagnose":
        diagnostic = _build_diagnostic(arguments, bundle, e57_adapter)
        document["diagnostic"] = diagnostic
        document["runtime"]["geometryDependencies"] = diagnostic["dependencies"]
    document["t505Eligibility"] = _eligibility(arguments.mode, diagnostic)
    _verify_bundle_unchanged(bundle)
    document = _seal_receipt(document)
    if write_output:
        _write_create_only(
            arguments.output,
            document,
            bundle.paths.values(),
            bundle.protected_roots,
        )
    return document


def main(argv: Sequence[str] | None = None) -> int:
    selected = list(sys.argv[1:] if argv is None else argv)
    mode = selected[0] if selected else "unknown"
    try:
        document = execute(selected)
        sys.stdout.write(
            json.dumps(
                {
                    "authority": document["authority"],
                    "mode": document["mode"],
                    "receiptSha256": document["receipt"]["sha256"],
                    "status": document["status"],
                    "t505Eligible": False,
                },
                allow_nan=False,
                separators=(",", ":"),
                sort_keys=True,
            )
            + "\n"
        )
        return 0
    except AlignmentError as error:
        sys.stdout.write(
            json.dumps(
                {
                    "error": {"code": error.code, "message": error.message},
                    "mode": mode,
                    "schemaVersion": SCHEMA_VERSION,
                    "status": "error_no_receipt_created",
                },
                allow_nan=False,
                separators=(",", ":"),
                sort_keys=True,
            )
            + "\n"
        )
        return 2
    except Exception as error:  # pragma: no cover - last-resort secrecy boundary
        sys.stdout.write(
            json.dumps(
                {
                    "error": {
                        "code": "INTERNAL_ERROR",
                        "message": f"unexpected {type(error).__name__}",
                    },
                    "mode": mode,
                    "schemaVersion": SCHEMA_VERSION,
                    "status": "error_no_receipt_created",
                },
                separators=(",", ":"),
                sort_keys=True,
            )
            + "\n"
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
