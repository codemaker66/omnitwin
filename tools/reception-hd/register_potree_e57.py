#!/usr/bin/env python3
"""Read-only Reception Potree-v2 to E57 registration diagnostic.

This command decodes the exact, vendor-produced Reception Potree preview,
requests only the frozen fit and validation E57 stations, and compares a
proper rigid fit with a separately optimized improper/mirrored competitor.

It writes one create-only, authority-none JSON receipt.  It never writes a
point cloud or transform artifact, starts training, contacts a provider,
publishes, grants rights, or treats nearest-neighbour agreement as approval.
"""

from __future__ import annotations

import argparse
import copy
from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path
import platform
import struct
import sys
from typing import Any, Sequence

import align_e57_xgrids as alignment


SCHEMA_VERSION = "omnitwin.reception.potree-e57-registration-diagnostic.v1"
RECEIPT_DIGEST_DOMAIN = b"OMNITWIN_RECEPTION_POTREE_E57_DIAGNOSTIC_V1\0"
RECEIPT_DIGEST_DOMAIN_LABEL = "OMNITWIN_RECEPTION_POTREE_E57_DIAGNOSTIC_V1\\0"

FIT_SCAN_IDS = (
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
VALIDATION_SCAN_IDS = (131, 134, 138)
FROZEN_TEST_SCAN_IDS = (126, 129, 141)
QUARANTINED_SCAN_IDS = (122, 123, 140)
REQUESTED_SCAN_IDS = FIT_SCAN_IDS + VALIDATION_SCAN_IDS
FORBIDDEN_SCAN_IDS = frozenset(FROZEN_TEST_SCAN_IDS + QUARANTINED_SCAN_IDS)

RECEPTION_E57_SIZE_BYTES = 20_518_437_888
RECEPTION_E57_SHA256 = "975039d11fc04ca681f038e499f358124bbcab178ad5ce6324fa912212729cdd"

POTREE_POINTS = 175_237
POTREE_RECORD_BYTES = 14
POTREE_HIERARCHY_NODE_BYTES = 22
POTREE_FILE_PINS = {
    "metadata.json": {
        "sizeBytes": 1_299,
        "sha256": "65e314ff0908ba9a87a4e149f82c3bc76fe529fd0aa63b621c7c69b8e94a0d7e",
    },
    "octree.bin": {
        "sizeBytes": 2_453_318,
        "sha256": "c49eb7a959be867ef27b63ca1e17b36505566a882f359b642b268afb979e98f5",
    },
    "hierarchy.bin": {
        "sizeBytes": 2_046,
        "sha256": "40d1fe4a74f7cd5f92ec6752bc9f5aebe5ba262795da8748c00363017f76e21b",
    },
}

MAX_METADATA_BYTES = 1024 * 1024
MAX_OCTREE_BYTES = 4 * 1024**3
MAX_HIERARCHY_BYTES = 64 * 1024**2
MAX_TOOL_BYTES = 16 * 1024**2
MAX_POINTS = 100_000_000
MAX_ABSOLUTE_COORDINATE_METERS = 10_000_000.0
MAX_BOUNDING_EXTENT_METERS = 1_000_000.0
MIN_POINTS = alignment.MIN_DIAGNOSTIC_POINTS

# A sub-millimetre or sub-percent nearest-neighbour difference is not a
# defensible handedness preference.  Keep a deliberately conservative band so
# BLAS, SciPy, or platform-level floating-point noise cannot turn a practical
# tie into a winner.
MIRROR_COMPARISON_ABSOLUTE_TOLERANCE_METERS = 0.001
MIRROR_COMPARISON_RELATIVE_TOLERANCE = 0.005

TOP_LEVEL_KEYS = {
    "version",
    "name",
    "description",
    "points",
    "projection",
    "hierarchy",
    "offset",
    "scale",
    "spacing",
    "boundingBox",
    "encoding",
    "attributes",
}
ATTRIBUTE_KEYS = {
    "name",
    "description",
    "size",
    "numElements",
    "elementSize",
    "type",
    "min",
    "max",
    "scale",
    "offset",
}


@dataclass(frozen=True)
class PotreeBundle:
    root: Path
    paths: dict[str, Path]
    snapshots: dict[str, alignment.FileSnapshot]
    hashes: dict[str, str]
    metadata: dict[str, Any]
    sampled_points: Any
    evidence: dict[str, Any]


class _ExactScanScopeAdapter:
    """Fail closed if an E57 adapter returns data outside the requested split.

    The shared E57 helper intentionally normalizes adapter output.  This proxy
    validates the raw adapter result *before* that normalization can discard an
    unexpected scan key.
    """

    def __init__(self, delegate: Any, expected_scan_ids: Sequence[int]) -> None:
        self._delegate = delegate
        self._expected_scan_ids = tuple(expected_scan_ids)

    @staticmethod
    def _scan_id(raw: Any, field: str) -> int:
        if isinstance(raw, bool):
            fail("E57_ADAPTER_SCAN_SCOPE_MISMATCH", f"{field} contains a boolean scan key")
        if isinstance(raw, int):
            return raw
        if isinstance(raw, str) and raw and raw == str(int(raw, 10)):
            return int(raw, 10)
        fail("E57_ADAPTER_SCAN_SCOPE_MISMATCH", f"{field} contains a non-canonical scan key")
        raise AssertionError("unreachable")

    @classmethod
    def _normalized_keys(cls, value: Any, field: str) -> set[int]:
        if not isinstance(value, dict):
            fail("INVALID_E57_ADAPTER", f"E57 point adapter {field} must be an object")
        normalized: set[int] = set()
        for raw in value:
            try:
                scan_id = cls._scan_id(raw, field)
            except ValueError:
                fail(
                    "E57_ADAPTER_SCAN_SCOPE_MISMATCH",
                    f"{field} contains a non-canonical scan key",
                )
            if scan_id in normalized:
                fail(
                    "E57_ADAPTER_SCAN_SCOPE_MISMATCH",
                    f"{field} contains duplicate representations of scan {scan_id}",
                )
            normalized.add(scan_id)
        return normalized

    def read_samples(
        self,
        path: Path,
        scan_ids: Sequence[int],
        per_scan_limit: int,
    ) -> dict[str, Any]:
        requested = tuple(scan_ids)
        if requested != self._expected_scan_ids:
            fail(
                "E57_ADAPTER_SCAN_SCOPE_MISMATCH",
                "E57 helper requested a scan set other than the frozen fit and validation split",
            )
        result = self._delegate.read_samples(path, requested, per_scan_limit)
        if not isinstance(result, dict):
            fail("INVALID_E57_ADAPTER", "E57 point adapter returned a non-object result")

        expected = set(requested)
        point_keys = self._normalized_keys(result.get("pointsByScan"), "pointsByScan")
        if point_keys != expected:
            fail(
                "E57_ADAPTER_SCAN_SCOPE_MISMATCH",
                "pointsByScan keys differ from the exact requested fit and validation scans",
            )
        for field in ("rawPointCounts", "organizedSampling"):
            value = result.get(field)
            if value is None:
                continue
            if not self._normalized_keys(value, field).issubset(expected):
                fail(
                    "E57_ADAPTER_SCAN_SCOPE_MISMATCH",
                    f"{field} contains a scan outside the exact request",
                )
        return result


def fail(code: str, message: str) -> None:
    alignment.fail(code, message)


def _canonical_json_bytes(value: Any) -> bytes:
    return alignment._canonical_json_bytes(value)


def _snapshot_evidence(snapshot: alignment.FileSnapshot) -> dict[str, Any]:
    return {
        "sizeBytes": snapshot.size_bytes,
        "mtimeNs": snapshot.mtime_ns,
        "fileId": snapshot.inode,
        "deviceId": snapshot.device,
    }


def _number(value: Any, label: str, *, positive: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        fail("INVALID_METADATA_NUMBER", f"{label} must be a number")
    result = float(value)
    if not math.isfinite(result):
        fail("NONFINITE_METADATA", f"{label} must be finite")
    if positive and result <= 0.0:
        fail("INVALID_METADATA_NUMBER", f"{label} must be greater than zero")
    return result


def _vector(value: Any, length: int, label: str) -> list[float]:
    if not isinstance(value, list) or len(value) != length:
        fail("INVALID_METADATA_VECTOR", f"{label} must contain exactly {length} numbers")
    return [_number(item, f"{label}[{index}]") for index, item in enumerate(value)]


def _exact_keys(value: Any, expected: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        fail("INVALID_METADATA_OBJECT", f"{label} must be an object")
    actual = set(value)
    if actual != expected:
        fail(
            "INVALID_METADATA_KEYS",
            f"{label} keys differ; missing={sorted(expected-actual)}, unexpected={sorted(actual-expected)}",
        )
    return value


def _validate_attribute(
    raw: Any,
    *,
    expected_name: str,
    expected_size: int,
    expected_elements: int,
    expected_element_size: int,
    expected_type: str,
) -> dict[str, Any]:
    attribute = _exact_keys(raw, ATTRIBUTE_KEYS, f"attribute {expected_name!r}")
    if attribute["name"] != expected_name:
        fail("UNEXPECTED_ATTRIBUTE_ORDER", "Potree attributes must be position, intensity, lcc prediction")
    if not isinstance(attribute["description"], str):
        fail("INVALID_METADATA_ATTRIBUTE", f"{expected_name} description must be text")
    integer_expectations = {
        "size": expected_size,
        "numElements": expected_elements,
        "elementSize": expected_element_size,
    }
    for key, expected in integer_expectations.items():
        if (
            not isinstance(attribute[key], int)
            or isinstance(attribute[key], bool)
            or attribute[key] != expected
        ):
            fail("UNEXPECTED_ATTRIBUTE_LAYOUT", f"{expected_name} {key} must equal {expected}")
    if attribute["type"] != expected_type:
        fail("UNEXPECTED_ATTRIBUTE_LAYOUT", f"{expected_name} type must be {expected_type}")
    minimum = _vector(attribute["min"], expected_elements, f"{expected_name}.min")
    maximum = _vector(attribute["max"], expected_elements, f"{expected_name}.max")
    scale = _vector(attribute["scale"], expected_elements, f"{expected_name}.scale")
    offset = _vector(attribute["offset"], expected_elements, f"{expected_name}.offset")
    if any(low > high for low, high in zip(minimum, maximum, strict=True)):
        fail("INVERTED_ATTRIBUTE_BOUNDS", f"{expected_name} min exceeds max")
    if expected_name == "position":
        if scale != [1.0, 1.0, 1.0] or offset != [0.0, 0.0, 0.0]:
            fail("UNEXPECTED_POSITION_AFFINE", "position attribute affine metadata must be identity")
    else:
        if scale != [1.0] or offset != [0.0]:
            fail("UNEXPECTED_ATTRIBUTE_AFFINE", f"{expected_name} affine metadata must be identity")
        if minimum[0] < 0.0 or maximum[0] > 255.0:
            fail("ATTRIBUTE_BOUNDS_OUT_OF_RANGE", f"{expected_name} bounds leave uint8 range")
    return {
        "name": expected_name,
        "size": expected_size,
        "numElements": expected_elements,
        "elementSize": expected_element_size,
        "type": expected_type,
        "min": minimum,
        "max": maximum,
    }


def _parse_metadata(payload: bytes) -> dict[str, Any]:
    metadata = alignment._strict_json(payload, "Potree metadata.json")
    _exact_keys(metadata, TOP_LEVEL_KEYS, "Potree metadata")
    if metadata["version"] != "2.0" or metadata["encoding"] != "DEFAULT":
        fail("UNSUPPORTED_POTREE_FORMAT", "only Potree v2 DEFAULT encoding is supported")
    if metadata["name"] != "potree":
        fail("UNEXPECTED_POTREE_NAME", "Potree metadata name must be 'potree'")
    if not isinstance(metadata["description"], str) or not isinstance(metadata["projection"], str):
        fail("INVALID_METADATA_TEXT", "description and projection must be text")
    points = alignment._require_int(metadata["points"], "Potree points", minimum=MIN_POINTS)
    if points > MAX_POINTS:
        fail("POINT_COUNT_TOO_LARGE", f"Potree points exceeds {MAX_POINTS}")

    hierarchy = _exact_keys(
        metadata["hierarchy"], {"firstChunkSize", "stepSize", "depth"}, "Potree hierarchy"
    )
    first_chunk = alignment._require_int(
        hierarchy["firstChunkSize"], "Potree hierarchy firstChunkSize", minimum=POTREE_HIERARCHY_NODE_BYTES
    )
    step_size = alignment._require_int(hierarchy["stepSize"], "Potree hierarchy stepSize", minimum=1)
    depth = alignment._require_int(hierarchy["depth"], "Potree hierarchy depth", minimum=0)
    if first_chunk > MAX_HIERARCHY_BYTES or step_size > 64 or depth > 64:
        fail("HIERARCHY_METADATA_OUT_OF_RANGE", "Potree hierarchy metadata is unreasonably large")

    offset = _vector(metadata["offset"], 3, "Potree offset")
    scale = _vector(metadata["scale"], 3, "Potree scale")
    if any(item <= 0.0 or item > 1.0 for item in scale):
        fail("SCALE_OUT_OF_RANGE", "Potree scale must be finite, positive, and at most one metre")
    spacing = _number(metadata["spacing"], "Potree spacing", positive=True)
    if spacing > MAX_BOUNDING_EXTENT_METERS:
        fail("SPACING_OUT_OF_RANGE", "Potree spacing is unreasonably large")

    bounds = _exact_keys(metadata["boundingBox"], {"min", "max"}, "Potree boundingBox")
    bounds_min = _vector(bounds["min"], 3, "Potree boundingBox.min")
    bounds_max = _vector(bounds["max"], 3, "Potree boundingBox.max")
    extents = [high - low for low, high in zip(bounds_min, bounds_max, strict=True)]
    if any(extent <= 0.0 or extent > MAX_BOUNDING_EXTENT_METERS for extent in extents):
        fail("BOUNDING_BOX_OUT_OF_RANGE", "Potree bounding-box extents must be positive and bounded")
    if any(abs(item) > MAX_ABSOLUTE_COORDINATE_METERS for item in bounds_min + bounds_max + offset):
        fail("COORDINATE_OVERFLOW_RISK", "Potree coordinates exceed the decoder safety bound")
    if offset != bounds_min:
        fail("UNEXPECTED_POTREE_OFFSET", "Potree v2 offset must equal boundingBox.min")

    attributes = metadata["attributes"]
    if not isinstance(attributes, list) or len(attributes) != 3:
        fail("UNEXPECTED_ATTRIBUTES", "exactly position, intensity, and lcc prediction are required")
    parsed_attributes = [
        _validate_attribute(
            attributes[0],
            expected_name="position",
            expected_size=12,
            expected_elements=3,
            expected_element_size=4,
            expected_type="int32",
        ),
        _validate_attribute(
            attributes[1],
            expected_name="intensity",
            expected_size=1,
            expected_elements=1,
            expected_element_size=1,
            expected_type="uint8",
        ),
        _validate_attribute(
            attributes[2],
            expected_name="lcc prediction",
            expected_size=1,
            expected_elements=1,
            expected_element_size=1,
            expected_type="uint8",
        ),
    ]
    if sum(item["size"] for item in parsed_attributes) != POTREE_RECORD_BYTES:
        fail("UNEXPECTED_RECORD_SIZE", "Potree point record must be exactly 14 bytes")
    position_bounds = parsed_attributes[0]
    if any(
        low < box_low or high > box_high
        for low, high, box_low, box_high in zip(
            position_bounds["min"],
            position_bounds["max"],
            bounds_min,
            bounds_max,
            strict=True,
        )
    ):
        fail("ATTRIBUTE_OUTSIDE_BOUNDING_BOX", "declared occupied position bounds leave boundingBox")
    return {
        "points": points,
        "hierarchy": {
            "firstChunkSize": first_chunk,
            "stepSize": step_size,
            "depth": depth,
        },
        "offset": offset,
        "scale": scale,
        "spacing": spacing,
        "boundingBox": {"min": bounds_min, "max": bounds_max},
        "attributes": parsed_attributes,
        "recordBytes": POTREE_RECORD_BYTES,
    }


def _validate_hierarchy(payload: bytes, octree_size: int, point_count: int) -> dict[str, Any]:
    if len(payload) % POTREE_HIERARCHY_NODE_BYTES != 0:
        fail("INVALID_HIERARCHY_LENGTH", "hierarchy.bin length is not a multiple of 22 bytes")
    rows = list(struct.iter_unpack("<BBIQQ", payload))
    if not rows:
        fail("EMPTY_HIERARCHY", "hierarchy.bin contains no nodes")
    intervals: list[tuple[int, int]] = []
    total_points = 0
    types: set[int] = set()
    for node_type, _child_mask, points, byte_offset, byte_size in rows:
        types.add(node_type)
        if node_type not in (0, 1):
            fail("UNSUPPORTED_HIERARCHY_NODE", "proxy or unknown hierarchy nodes are not accepted")
        if points <= 0 or byte_size != points * POTREE_RECORD_BYTES:
            fail("INVALID_HIERARCHY_NODE", "hierarchy node byte size must equal points * 14")
        end = byte_offset + byte_size
        if end < byte_offset or end > octree_size:
            fail("HIERARCHY_RANGE_OUT_OF_BOUNDS", "hierarchy node leaves octree.bin")
        intervals.append((byte_offset, end))
        total_points += points
    intervals.sort()
    cursor = 0
    for start, end in intervals:
        if start != cursor:
            fail("HIERARCHY_COVERAGE_MISMATCH", "hierarchy ranges overlap or leave an octree gap")
        cursor = end
    if cursor != octree_size or total_points != point_count:
        fail("HIERARCHY_TOTAL_MISMATCH", "hierarchy totals differ from metadata/octree totals")
    return {
        "nodeCount": len(rows),
        "nodeTypes": sorted(types),
        "pointCountSum": total_points,
        "byteRangesAreDisjointAndGapless": True,
        "coveredOctreeBytes": cursor,
    }


def _decode_octree(
    payload: bytes,
    metadata: dict[str, Any],
    sample_limit: int,
    np: Any,
) -> tuple[Any, dict[str, Any]]:
    points = metadata["points"]
    expected_size = points * POTREE_RECORD_BYTES
    if expected_size > MAX_OCTREE_BYTES or len(payload) != expected_size:
        fail("OCTREE_LENGTH_MISMATCH", "octree.bin length must equal metadata points * 14")
    dtype = np.dtype(
        [
            ("position", "<i4", (3,)),
            ("intensity", "u1"),
            ("lcc_prediction", "u1"),
        ],
        align=False,
    )
    if int(dtype.itemsize) != POTREE_RECORD_BYTES:
        fail("INTERNAL_DECODER_LAYOUT", "NumPy Potree record layout is not 14 bytes")
    records = np.frombuffer(payload, dtype=dtype, count=points)
    raw_position = records["position"].astype(np.float64)
    scale = np.asarray(metadata["scale"], dtype=np.float64)
    offset = np.asarray(metadata["offset"], dtype=np.float64)
    decoded = raw_position * scale + offset
    if decoded.shape != (points, 3) or not np.all(np.isfinite(decoded)):
        fail("NONFINITE_DECODED_POSITION", "decoded Potree positions must be finite Nx3 coordinates")
    if float(np.max(np.abs(decoded))) > MAX_ABSOLUTE_COORDINATE_METERS:
        fail("DECODED_COORDINATE_OUT_OF_RANGE", "decoded Potree coordinate exceeds safety bound")

    actual_min = np.min(decoded, axis=0)
    actual_max = np.max(decoded, axis=0)
    occupied = metadata["attributes"][0]
    declared_min = np.asarray(occupied["min"], dtype=np.float64)
    declared_max = np.asarray(occupied["max"], dtype=np.float64)
    tolerance = np.maximum(scale * 1.01, 1e-9)
    if np.any(actual_min < declared_min - tolerance) or np.any(actual_max > declared_max + tolerance):
        fail("DECODED_POSITION_OUTSIDE_DECLARED_BOUNDS", "decoded points leave position bounds")
    if np.any(np.abs(actual_min - declared_min) > tolerance) or np.any(
        np.abs(actual_max - declared_max) > tolerance
    ):
        fail("DECLARED_POSITION_EXTREMA_MISMATCH", "declared position extrema do not match decoded data")

    scalar_evidence: dict[str, Any] = {}
    for field, attribute in (
        ("intensity", metadata["attributes"][1]),
        ("lcc_prediction", metadata["attributes"][2]),
    ):
        actual_low = int(np.min(records[field]))
        actual_high = int(np.max(records[field]))
        if actual_low != int(attribute["min"][0]) or actual_high != int(attribute["max"][0]):
            fail("DECLARED_ATTRIBUTE_EXTREMA_MISMATCH", f"{attribute['name']} extrema do not match data")
        scalar_evidence[attribute["name"]] = {"minimum": actual_low, "maximum": actual_high}

    indices = alignment._deterministic_indices(points, sample_limit, "reception-potree-v2-sample-v1")
    sample = decoded[np.asarray(indices, dtype=np.int64)]
    if sample.shape[0] < MIN_POINTS:
        fail("INSUFFICIENT_POTREE_SAMPLE", "Potree sample has too few points for a diagnostic")
    sample_bytes = np.asarray(sample, dtype="<f8").tobytes(order="C")
    return sample, {
        "decodedPointCount": points,
        "everyRecordDecodedAndValidated": True,
        "actualPositionBoundsMeters": {
            "min": [float(item) for item in actual_min],
            "max": [float(item) for item in actual_max],
        },
        "scalarAttributeExtrema": scalar_evidence,
        "samplePointCount": int(sample.shape[0]),
        "sampleSelection": "deterministic hash-seeded coprime-stride record indices",
        "sampleFloat64LittleEndianSha256": hashlib.sha256(sample_bytes).hexdigest(),
    }


def load_potree_model(
    model_root: Path,
    *,
    sample_limit: int,
    np: Any,
    enforce_production_pins: bool = True,
) -> PotreeBundle:
    root = alignment._safe_directory(model_root, "Potree model root")
    limits = {
        "metadata.json": MAX_METADATA_BYTES,
        "octree.bin": MAX_OCTREE_BYTES,
        "hierarchy.bin": MAX_HIERARCHY_BYTES,
    }
    paths: dict[str, Path] = {}
    snapshots: dict[str, alignment.FileSnapshot] = {}
    payloads: dict[str, bytes] = {}
    hashes: dict[str, str] = {}

    # In production mode, inspect every member and compare its exact frozen
    # size before reading any payload into memory.  The second snapshot below
    # must match this one, retaining the existing link and race protections.
    pinned_preflight: dict[str, tuple[Path, alignment.FileSnapshot]] = {}
    if enforce_production_pins:
        for name, limit in limits.items():
            path, snapshot = alignment._safe_regular_file(root / name, name, limit)
            try:
                path.relative_to(root)
            except ValueError:
                fail("POTREE_PATH_ESCAPE", f"{name} escapes the Potree model root")
            pin = POTREE_FILE_PINS[name]
            if snapshot.size_bytes != pin["sizeBytes"]:
                fail(
                    "POTREE_PIN_SIZE_MISMATCH",
                    f"{name} size differs from the frozen Reception preview",
                )
            pinned_preflight[name] = (path, snapshot)

    for name, limit in limits.items():
        read_limit = POTREE_FILE_PINS[name]["sizeBytes"] if enforce_production_pins else limit
        path, snapshot, payload, sha256 = alignment._read_bound_bytes(
            root / name, name, read_limit
        )
        try:
            path.relative_to(root)
        except ValueError:
            fail("POTREE_PATH_ESCAPE", f"{name} escapes the Potree model root")
        if enforce_production_pins and (path, snapshot) != pinned_preflight[name]:
            fail("FILE_CHANGED_DURING_RUN", f"{name} changed after pinned-size preflight")
        paths[name] = path
        snapshots[name] = snapshot
        payloads[name] = payload
        hashes[name] = sha256
        if enforce_production_pins:
            pin = POTREE_FILE_PINS[name]
            if snapshot.size_bytes != pin["sizeBytes"] or sha256 != pin["sha256"]:
                fail("POTREE_PIN_MISMATCH", f"{name} does not match the frozen Reception preview")

    metadata = _parse_metadata(payloads["metadata.json"])
    if enforce_production_pins and metadata["points"] != POTREE_POINTS:
        fail("POTREE_POINT_COUNT_MISMATCH", "Reception preview must declare exactly 175237 points")
    if metadata["hierarchy"]["firstChunkSize"] != len(payloads["hierarchy.bin"]):
        fail("HIERARCHY_CHUNK_LENGTH_MISMATCH", "firstChunkSize differs from hierarchy.bin length")
    expected_octree_size = metadata["points"] * POTREE_RECORD_BYTES
    if len(payloads["octree.bin"]) != expected_octree_size:
        fail("OCTREE_LENGTH_MISMATCH", "octree.bin length must equal metadata points * 14")
    hierarchy_evidence = _validate_hierarchy(
        payloads["hierarchy.bin"], len(payloads["octree.bin"]), metadata["points"]
    )
    sample, decode_evidence = _decode_octree(
        payloads["octree.bin"], metadata, sample_limit, np
    )
    return PotreeBundle(
        root=root,
        paths=paths,
        snapshots=snapshots,
        hashes=hashes,
        metadata=metadata,
        sampled_points=sample,
        evidence={
            "format": "Potree v2 DEFAULT",
            "sourceRole": "vendor_produced_decimated_preview_not_raw_lidar",
            "productionPinsEnforced": enforce_production_pins,
            "files": {
                name: {
                    "path": str(paths[name]),
                    "sha256": hashes[name],
                    "fullyHashedThisRun": True,
                    "snapshot": _snapshot_evidence(snapshots[name]),
                }
                for name in sorted(paths)
            },
            "metadata": metadata,
            "hierarchyValidation": hierarchy_evidence,
            "decoderValidation": decode_evidence,
        },
    )


def _source_binding(path: Path, label: str) -> tuple[Path, alignment.FileSnapshot, dict[str, Any]]:
    resolved, snapshot = alignment._safe_regular_file(path, label, MAX_TOOL_BYTES)
    sha256 = alignment._hash_file(resolved, snapshot, label)
    return resolved, snapshot, {
        "path": str(resolved),
        "sha256": sha256,
        "fullyHashedThisRun": True,
        "snapshot": _snapshot_evidence(snapshot),
    }


def _verify_helper_contract() -> None:
    expected = {
        "fit": FIT_SCAN_IDS,
        "validation": VALIDATION_SCAN_IDS,
        "test": FROZEN_TEST_SCAN_IDS,
        "quarantine": QUARANTINED_SCAN_IDS,
    }
    actual = {
        "fit": tuple(alignment.FROZEN_FIT_SCAN_IDS),
        "validation": tuple(alignment.FROZEN_VALIDATION_SCAN_IDS),
        "test": tuple(alignment.FROZEN_TEST_SCAN_IDS),
        "quarantine": tuple(alignment.FROZEN_QUARANTINED_SCAN_IDS),
    }
    if actual != expected:
        fail("ALIGNMENT_HELPER_SCOPE_DRIFT", "align_e57_xgrids scan firewall differs from this tool")
    if (
        alignment.RECEPTION_E57_SIZE_BYTES != RECEPTION_E57_SIZE_BYTES
        or alignment.RECEPTION_E57_SHA256 != RECEPTION_E57_SHA256
    ):
        fail("ALIGNMENT_HELPER_IDENTITY_DRIFT", "align_e57_xgrids Reception E57 identity drifted")
    required_callables = (
        "Pye57PointAdapter",
        "_read_e57_point_samples",
        "_fit_rigid_icp",
        "_evaluate_bidirectional",
        "_matrix_evidence",
        "_write_create_only",
    )
    if any(not callable(getattr(alignment, name, None)) for name in required_callables):
        fail("ALIGNMENT_HELPER_API_DRIFT", "required hardened helper function is missing")
    if set(REQUESTED_SCAN_IDS) & FORBIDDEN_SCAN_IDS or set(FIT_SCAN_IDS) & set(VALIDATION_SCAN_IDS):
        fail("INTERNAL_SCAN_FIREWALL_ERROR", "fit/validation scan partitions overlap forbidden scans")


def _metric_comparison(proper: dict[str, Any], mirror: dict[str, Any]) -> dict[str, Any]:
    proper_rmse = float(proper["combinedStatisticsMeters"]["rmse"])
    mirror_rmse = float(mirror["combinedStatisticsMeters"]["rmse"])
    delta = mirror_rmse - proper_rmse
    tolerance = max(
        MIRROR_COMPARISON_ABSOLUTE_TOLERANCE_METERS,
        MIRROR_COMPARISON_RELATIVE_TOLERANCE * max(proper_rmse, mirror_rmse),
    )
    if delta > tolerance:
        preference = "proper_lower_validation_rmse"
    elif delta < -tolerance:
        preference = "mirror_lower_validation_rmse_geometry_ambiguous"
    else:
        preference = "validation_rmse_within_tolerance_geometry_ambiguous"
    relative = None if mirror_rmse <= 0.0 else delta / mirror_rmse
    return {
        "comparisonMetric": "held-validation combined bidirectional nearest-neighbour RMSE",
        "properCombinedRmseMeters": proper_rmse,
        "mirrorCombinedRmseMeters": mirror_rmse,
        "mirrorMinusProperRmseMeters": delta,
        "properRelativeImprovementVersusMirror": relative,
        "ambiguityToleranceMeters": tolerance,
        "ambiguityAbsoluteFloorMeters": MIRROR_COMPARISON_ABSOLUTE_TOLERANCE_METERS,
        "ambiguityRelativeFraction": MIRROR_COMPARISON_RELATIVE_TOLERANCE,
        "differenceExceedsAmbiguityTolerance": abs(delta) > tolerance,
        "ambiguityRule": (
            "no winner unless the absolute RMSE difference exceeds both a 1 mm floor "
            "and 0.5% of the larger candidate RMSE"
        ),
        "samplePreference": preference,
        "isPhysicalHandednessDecision": False,
        "isTransformApproval": False,
    }


def _transform_evidence(
    rotation: Any,
    translation: Any,
    np: Any,
    *,
    determinant_sign: int,
) -> dict[str, Any]:
    """Describe a transform without assigning an SO(3) angle to a mirror."""

    evidence = alignment._matrix_evidence(rotation, translation, np)
    determinant = float(evidence["determinantRotation"])
    if determinant_sign == 1:
        if determinant <= 0.0:
            fail("INVALID_HANDEDNESS", "proper transform evidence has a non-positive determinant")
        evidence["rotationAngleApplicability"] = "proper_SO3_rotation"
    elif determinant_sign == -1:
        if determinant >= 0.0:
            fail("INVALID_HANDEDNESS", "mirror transform evidence has a non-negative determinant")
        evidence["rotationAngleDegrees"] = None
        evidence["rotationAngleApplicability"] = (
            "not_applicable_improper_orthogonal_transform"
        )
    else:
        fail("INTERNAL_ROTATION_ERROR", "determinant sign must be -1 or +1")
    return evidence


def _seal_receipt(document: dict[str, Any]) -> dict[str, Any]:
    unsigned = copy.deepcopy(document)
    unsigned.pop("receipt", None)
    digest = hashlib.sha256(RECEIPT_DIGEST_DOMAIN + _canonical_json_bytes(unsigned)).hexdigest()
    sealed = copy.deepcopy(unsigned)
    sealed["receipt"] = {
        "algorithm": "SHA-256",
        "domain": RECEIPT_DIGEST_DOMAIN_LABEL,
        "sha256": digest,
        "authenticatesCreator": False,
        "provesTimestamp": False,
        "isSignature": False,
    }
    return sealed


def _verify_small_sources_unchanged(
    potree: PotreeBundle,
    source_rows: Sequence[tuple[Path, alignment.FileSnapshot, str, str]],
) -> None:
    for name, path in potree.paths.items():
        current = alignment._hash_file(path, potree.snapshots[name], name)
        if current != potree.hashes[name]:
            fail("FILE_CHANGED_DURING_RUN", f"{name} bytes changed during the diagnostic")
    for path, snapshot, label, expected_sha in source_rows:
        current = alignment._hash_file(path, snapshot, label)
        if current != expected_sha:
            fail("FILE_CHANGED_DURING_RUN", f"{label} bytes changed during the diagnostic")


def _publish_receipt(
    output: Path,
    document: dict[str, Any],
    protected_paths: Sequence[Path],
    protected_roots: Sequence[Path],
    *,
    _write_hook: Any | None = None,
) -> None:
    """Delegate to the audited atomic no-clobber writer without weakening it."""

    alignment._write_create_only(
        output,
        document,
        protected_paths,
        protected_roots,
        _write_hook=_write_hook,
    )


def run_diagnostic(
    arguments: argparse.Namespace,
    *,
    e57_adapter: Any | None = None,
    enforce_production_pins: bool = True,
    _test_only_allow_custom_e57_adapter: bool = False,
) -> dict[str, Any]:
    _verify_helper_contract()
    test_adapter_mode = e57_adapter is not None
    if test_adapter_mode and (
        enforce_production_pins or not _test_only_allow_custom_e57_adapter
    ):
        fail(
            "CUSTOM_E57_ADAPTER_FORBIDDEN",
            "custom E57 adapters require the internal test-only switch and disabled production pins",
        )
    if _test_only_allow_custom_e57_adapter and not test_adapter_mode:
        fail(
            "INVALID_TEST_ADAPTER_MODE",
            "the internal test-only adapter switch requires a custom E57 adapter",
        )
    np, _scipy, cKDTree, dependency_versions = alignment._load_geometry_dependencies()

    tool_path, tool_snapshot, tool_evidence = _source_binding(Path(__file__), "diagnostic tool source")
    helper_path, helper_snapshot, helper_evidence = _source_binding(
        Path(alignment.__file__), "alignment helper source"
    )
    potree = load_potree_model(
        Path(arguments.potree_model),
        sample_limit=arguments.potree_sample_points,
        np=np,
        enforce_production_pins=enforce_production_pins,
    )

    e57_path, e57_snapshot = alignment._safe_regular_file(
        Path(arguments.e57), "Reception E57", alignment.MAX_E57_BYTES
    )
    if e57_snapshot.size_bytes != RECEPTION_E57_SIZE_BYTES:
        fail("E57_SIZE_MISMATCH", "Reception E57 size differs from the frozen identity")
    e57_full_sha256: str | None = None
    if arguments.verify_e57_bytes:
        e57_full_sha256 = alignment._hash_file(e57_path, e57_snapshot, "Reception E57")
        if e57_full_sha256 != RECEPTION_E57_SHA256:
            fail("E57_SHA256_MISMATCH", "fully read Reception E57 bytes differ from the frozen identity")

    selected_adapter = (
        e57_adapter if e57_adapter is not None else alignment.Pye57PointAdapter()
    )
    strict_adapter = _ExactScanScopeAdapter(selected_adapter, REQUESTED_SCAN_IDS)
    points_by_scan, e57_read = alignment._read_e57_point_samples(
        e57_path,
        e57_snapshot,
        REQUESTED_SCAN_IDS,
        arguments.points_per_scan,
        np,
        strict_adapter,
    )
    if test_adapter_mode:
        e57_read = copy.deepcopy(e57_read)
        e57_read["openMode"] = "unestablished_custom_test_adapter"
        e57_read["customAdapterSideEffectsEstablished"] = False
    if set(points_by_scan) != set(REQUESTED_SCAN_IDS):
        fail("E57_SCAN_FIREWALL_BREACH", "E57 reader returned scans outside the exact request")
    fit_target = np.vstack([points_by_scan[scan_id] for scan_id in FIT_SCAN_IDS])
    validation_target = np.vstack([points_by_scan[scan_id] for scan_id in VALIDATION_SCAN_IDS])
    source = potree.sampled_points

    proper_rotation, proper_translation, proper_trace = alignment._fit_rigid_icp(
        source,
        fit_target,
        maximum_iterations=arguments.maximum_iterations,
        trim_fraction=arguments.trim_fraction,
        determinant_sign=1,
        np=np,
        cKDTree=cKDTree,
    )
    mirror_rotation, mirror_translation, mirror_trace = alignment._fit_rigid_icp(
        source,
        fit_target,
        maximum_iterations=arguments.maximum_iterations,
        trim_fraction=arguments.trim_fraction,
        determinant_sign=-1,
        np=np,
        cKDTree=cKDTree,
    )
    proper_fit_metrics = alignment._evaluate_bidirectional(
        source,
        fit_target,
        proper_rotation,
        proper_translation,
        arguments.overlap_distance_m,
        np,
        cKDTree,
    )
    mirror_fit_metrics = alignment._evaluate_bidirectional(
        source,
        fit_target,
        mirror_rotation,
        mirror_translation,
        arguments.overlap_distance_m,
        np,
        cKDTree,
    )
    proper_validation_metrics = alignment._evaluate_bidirectional(
        source,
        validation_target,
        proper_rotation,
        proper_translation,
        arguments.overlap_distance_m,
        np,
        cKDTree,
    )
    mirror_validation_metrics = alignment._evaluate_bidirectional(
        source,
        validation_target,
        mirror_rotation,
        mirror_translation,
        arguments.overlap_distance_m,
        np,
        cKDTree,
    )

    alignment._snapshot_matches(e57_path, e57_snapshot, "Reception E57")
    _verify_small_sources_unchanged(
        potree,
        (
            (tool_path, tool_snapshot, "diagnostic tool source", tool_evidence["sha256"]),
            (helper_path, helper_snapshot, "alignment helper source", helper_evidence["sha256"]),
        ),
    )
    if e57_full_sha256 is not None:
        current_e57_sha = alignment._hash_file(e57_path, e57_snapshot, "Reception E57")
        if current_e57_sha != e57_full_sha256:
            fail("FILE_CHANGED_DURING_RUN", "Reception E57 bytes changed during the diagnostic")

    scope: dict[str, Any] = {
        "roomLabel": "Reception Room",
        "potreeRole": "XGRIDS_vendor_preview_in_shared_room_local_frame",
        "fitScanIds": list(FIT_SCAN_IDS),
        "validationScanIds": list(VALIDATION_SCAN_IDS),
        "validationUsedDuringFit": False,
        "exactE57ScanIdsRequested": list(REQUESTED_SCAN_IDS),
        "testOnlyCustomAdapterMode": test_adapter_mode,
    }
    if test_adapter_mode:
        scope.update(
            {
                "frozenTestScanIdsNotRequestedByDiagnostic": list(FROZEN_TEST_SCAN_IDS),
                "quarantinedScanIdsNotRequestedByDiagnostic": list(QUARANTINED_SCAN_IDS),
                "customAdapterReadOrUseOfUnrequestedScans": "unestablished",
            }
        )
    else:
        scope.update(
            {
                "frozenTestScanIdsNotRequestedReadOrUsed": list(FROZEN_TEST_SCAN_IDS),
                "quarantinedScanIdsNotRequestedReadOrUsed": list(QUARANTINED_SCAN_IDS),
            }
        )

    safety: dict[str, Any] = {
        "sourceMutationPermitted": False,
        "sourceMutationPerformed": None if test_adapter_mode else False,
        "derivedPointCloudOrModelFileCreated": None if test_adapter_mode else False,
        "transformArtifactCreatedRegisteredOrSigned": None if test_adapter_mode else False,
        "trainingPermitted": False,
        "trainingPerformed": None if test_adapter_mode else False,
        "networkOrProviderUsePermitted": False,
        "networkOrProviderUsePerformed": None if test_adapter_mode else False,
        "publicationOrPromotionPermitted": False,
        "publicationOrPromotionPerformed": None if test_adapter_mode else False,
        "rightsEvaluated": None if test_adapter_mode else False,
        "rightsGrantedOrClaimed": None if test_adapter_mode else False,
        "customAdapterSideEffectsEstablished": not test_adapter_mode,
        "outputPolicy": (
            "test-only receipt; custom adapter side effects unestablished; unusable as evidence"
            if test_adapter_mode
            else "one create-only authority-none JSON receipt; no source-derived geometry bytes"
        ),
    }
    limitations = [
        "The Potree cloud is a vendor-produced decimated preview, not raw LiDAR.",
        "Nearest-neighbour agreement can be fooled by repeated walls, floors, ceilings, mirrors, and incomplete coverage.",
        "A proper-versus-mirror sample preference does not prove physical handedness or transform accuracy.",
        "Validation stations were not used for fitting, but they are not independent surveyed controls.",
        "Without --verify-e57-bytes the E57 evidence is not a current full-content SHA-256 binding.",
        "The self-digest detects an unrecomputed edit; it does not authenticate creator, time, rights, or truth.",
    ]
    if test_adapter_mode:
        limitations.append(
            "A custom test adapter ran arbitrary Python; its reads and side effects are unestablished, so this receipt is unusable as evidence."
        )

    document = {
        "schemaVersion": SCHEMA_VERSION,
        "status": (
            "diagnostic_complete_test_adapter_unusable_authority_none"
            if test_adapter_mode
            else "diagnostic_complete_authority_none"
        ),
        "authority": "none",
        "resultType": (
            "test_adapter_result_unusable_as_evidence"
            if test_adapter_mode
            else "read_only_geometric_diagnostic_not_transform_artifact"
        ),
        "scope": scope,
        "inputEvidence": {
            "potreePreview": potree.evidence,
            "e57": {
                "path": str(e57_path),
                "snapshot": _snapshot_evidence(e57_snapshot),
                "openMode": (
                    "unestablished_custom_test_adapter"
                    if test_adapter_mode
                    else "read-only"
                ),
                "adapterExecutionMode": (
                    "internal_test_only_untrusted"
                    if test_adapter_mode
                    else "pinned_production_adapter"
                ),
                "currentBytesFullyHashedThisRun": e57_full_sha256 is not None,
                "currentFullSha256": e57_full_sha256,
                "frozenExpectedSha256": RECEPTION_E57_SHA256,
                "frozenExpectedSha256ComparedToCurrentBytes": e57_full_sha256 is not None,
                "bindingWithoutFullHash": (
                    None
                    if e57_full_sha256 is not None
                    else "size, file snapshot, 149-scan adapter report, and before/after identity checks; not a full-content hash"
                ),
                "readEvidence": e57_read,
            },
            "code": {
                "diagnosticTool": tool_evidence,
                "alignmentHelper": helper_evidence,
                "helperReuse": [
                    "safe file and E57 sampling",
                    "deterministic sampling",
                    "proper and improper 24-start trimmed ICP",
                    "bidirectional nearest-neighbour metrics",
                    "create-only atomic publication",
                ],
            },
        },
        "diagnostic": {
            "dependencies": dependency_versions,
            "sampling": {
                "potreeDecodedPointCount": potree.metadata["points"],
                "potreeFitSamplePointCount": int(source.shape[0]),
                "pointsPerE57ScanLimit": arguments.points_per_scan,
                "fitE57SamplePointCount": int(fit_target.shape[0]),
                "validationE57SamplePointCount": int(validation_target.shape[0]),
            },
            "properCandidate": {
                "isPermittedHandednessFamily": True,
                "transform": _transform_evidence(
                    proper_rotation,
                    proper_translation,
                    np,
                    determinant_sign=1,
                ),
                "fitTrace": proper_trace,
                "fitMetrics": proper_fit_metrics,
                "heldValidationMetrics": proper_validation_metrics,
            },
            "improperMirrorCompetitor": {
                "isPermittedTransformCandidate": False,
                "purpose": "negative control for sampled geometric handedness ambiguity",
                "transform": _transform_evidence(
                    mirror_rotation,
                    mirror_translation,
                    np,
                    determinant_sign=-1,
                ),
                "fitTrace": mirror_trace,
                "fitMetrics": mirror_fit_metrics,
                "heldValidationMetrics": mirror_validation_metrics,
            },
            "heldValidationComparison": _metric_comparison(
                proper_validation_metrics, mirror_validation_metrics
            ),
            "units": "metres assumed for both sources; scale fixed to exactly 1 and not fitted",
        },
        "safety": safety,
        "eligibility": {
            "eligibleForTraining": False,
            "eligibleForRuntimeUse": False,
            "eligibleForPublicUse": False,
            "eligibleForTransformRegistration": False,
            "eligibleForEvidenceUse": False if test_adapter_mode else None,
            "requiresIndependentControlsAndHumanReview": True,
        },
        "limitations": limitations,
        "runtime": {"python": platform.python_version(), "platform": platform.platform()},
    }
    sealed = _seal_receipt(document)
    protected_paths = tuple(potree.paths.values()) + (e57_path, tool_path, helper_path)
    protected_roots = (potree.root, e57_path.parent, tool_path.parent)
    _publish_receipt(Path(arguments.output), sealed, protected_paths, protected_roots)
    return sealed


def _positive_int(maximum: int) -> Any:
    def parse(raw: str) -> int:
        try:
            value = int(raw, 10)
        except ValueError as error:
            raise argparse.ArgumentTypeError("must be an integer") from error
        if value <= 0 or value > maximum:
            raise argparse.ArgumentTypeError(f"must be between 1 and {maximum}")
        return value

    return parse


def _fraction(raw: str) -> float:
    try:
        value = float(raw)
    except ValueError as error:
        raise argparse.ArgumentTypeError("must be a number") from error
    if not math.isfinite(value) or not 0.0 < value <= 1.0:
        raise argparse.ArgumentTypeError("must be finite, greater than 0, and at most 1")
    return value


def _positive_float(raw: str) -> float:
    try:
        value = float(raw)
    except ValueError as error:
        raise argparse.ArgumentTypeError("must be a number") from error
    if not math.isfinite(value) or value <= 0.0:
        raise argparse.ArgumentTypeError("must be finite and greater than zero")
    return value


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--potree-model", required=True, type=Path)
    parser.add_argument("--e57", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--potree-sample-points", type=_positive_int(POTREE_POINTS), default=POTREE_POINTS)
    parser.add_argument("--points-per-scan", type=_positive_int(100_000), default=2_000)
    parser.add_argument("--maximum-iterations", type=_positive_int(100), default=30)
    parser.add_argument("--trim-fraction", type=_fraction, default=0.80)
    parser.add_argument("--overlap-distance-m", type=_positive_float, default=0.20)
    parser.add_argument(
        "--verify-e57-bytes",
        action="store_true",
        help="read and SHA-256 all 20.5 GB before and after sampling; off by default",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    try:
        arguments = build_parser().parse_args(argv)
        receipt = run_diagnostic(arguments)
        print(
            json.dumps(
                {
                    "status": receipt["status"],
                    "output": str(arguments.output),
                    "receiptSha256": receipt["receipt"]["sha256"],
                    "authority": "none",
                },
                sort_keys=True,
            )
        )
        return 0
    except alignment.AlignmentError as error:
        print(
            json.dumps(
                {"status": "error_no_receipt_created", "code": error.code, "message": error.message},
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
