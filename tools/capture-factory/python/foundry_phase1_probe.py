#!/usr/bin/env python3
"""Deterministic, read-only E57/COLMAP metadata and alignment probe.

The probe deliberately has no output-file option.  It reads metadata and emits
one canonical JSON document on stdout.  E57 point records are never read.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import math
import operator
import re
import sqlite3
import struct
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Protocol, Sequence

import numpy as np


SCHEMA_VERSION = "omnitwin.foundry.phase1-probe.v0"
REQUIRED_PYE57_VERSION = "0.4.19"
ENDIAN = "little"
FACES = ("front", "back", "left", "right", "up", "down")
FACE_ORDER = {face: index for index, face in enumerate(FACES)}
SWEEP_NAME_RE = re.compile(
    r"\Ascan_(?P<sweep>[0-9]{3})_(?P<face>front|back|left|right|up|down)\.jpg\Z"
)
ALL_FIT_SWEEPS = tuple(range(50))
PHASE1_CANDIDATE_SWEEPS = tuple(range(49))
HELD_OUT_SWEEPS = (5, 15, 25, 35, 44)
MAX_RECORDS = 10_000_000
MAX_NAME_BYTES = 1_048_576
MAX_COLMAP_BINARY_BYTES = 2 * 1024**3
MAX_COLMAP_DATABASE_BYTES = 16 * 1024**3
MAX_E57_FILE_BYTES = 4 * 1024**4
MAX_E57_METADATA_RECORDS = 1_000_000
MAX_E57_METADATA_SCALAR_BYTES = 1_048_576
MAX_E57_DISTINCT_POINT_FIELDS = 256
MAX_E57_DISTINCT_IMAGE_REPRESENTATIONS = 16
MAX_E57_DECLARED_UNSIGNED_INTEGER = 2**64 - 1
MAX_JPEG_BYTES = 64 * 1024**2
MAX_SQLITE_SCHEMA_OBJECTS = 128
QUATERNION_NORM_TOLERANCE = 1e-6
RANK_RELATIVE_TOLERANCE = 1e-12

COLMAP_DATABASE_TABLES = {
    "cameras",
    "descriptors",
    "frame_data",
    "frames",
    "images",
    "keypoints",
    "matches",
    "pose_priors",
    "rig_sensors",
    "rigs",
    "two_view_geometries",
}
REQUIRED_COLMAP_DATABASE_TABLES = {"cameras", "images"}
SQLITE_INTERNAL_TABLES = {
    "sqlite_sequence",
    "sqlite_stat1",
    "sqlite_stat2",
    "sqlite_stat3",
    "sqlite_stat4",
}
SQLITE_TABLE_ROW_LIMITS = {
    "cameras": 100_000,
    "descriptors": 1_000_000,
    "frame_data": MAX_RECORDS,
    "frames": 1_000_000,
    "images": 1_000_000,
    "keypoints": 1_000_000,
    "matches": MAX_RECORDS,
    "pose_priors": 1_000_000,
    "rig_sensors": 1_000_000,
    "rigs": 100_000,
    "sqlite_sequence": 100_000,
    "sqlite_stat1": 1_000_000,
    "sqlite_stat2": 1_000_000,
    "sqlite_stat3": 1_000_000,
    "sqlite_stat4": 1_000_000,
    "two_view_geometries": MAX_RECORDS,
}

DOCUMENTED_DIAGNOSTIC = {
    "scale": 1.7362602881,
    "rmseMeters": 0.0106706,
    "medianMeters": 0.0061596,
    "p95Meters": 0.0164002,
    "maxMeters": 0.0451409,
}

# COLMAP camera model ids and parameter counts, including the models added
# after the legacy read_write_model.py helper was frozen.
CAMERA_MODELS: dict[int, tuple[str, int]] = {
    0: ("SIMPLE_PINHOLE", 3),
    1: ("PINHOLE", 4),
    2: ("SIMPLE_RADIAL", 4),
    3: ("RADIAL", 5),
    4: ("OPENCV", 8),
    5: ("OPENCV_FISHEYE", 8),
    6: ("FULL_OPENCV", 12),
    7: ("FOV", 5),
    8: ("SIMPLE_RADIAL_FISHEYE", 4),
    9: ("RADIAL_FISHEYE", 5),
    10: ("THIN_PRISM_FISHEYE", 12),
    11: ("RAD_TAN_THIN_PRISM_FISHEYE", 16),
    12: ("SIMPLE_DIVISION", 4),
    13: ("DIVISION", 5),
    14: ("SIMPLE_FISHEYE", 3),
    15: ("FISHEYE", 4),
    16: ("EUCM", 6),
}


class ProbeError(Exception):
    """Expected, stable failure suitable for a machine-readable result."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class JsonArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        raise ProbeError("INVALID_ARGUMENTS", message)


def _finite(values: Sequence[float], label: str) -> None:
    if not all(math.isfinite(float(value)) for value in values):
        raise ProbeError("NONFINITE_VALUE", f"{label} contains a non-finite value")


def _validate_positive_id(value: int, label: str) -> None:
    if value <= 0:
        raise ProbeError("INVALID_ID", f"{label} must be positive")


def _validate_quaternion(values: Sequence[float], label: str) -> list[float]:
    if len(values) != 4:
        raise ProbeError("INVALID_QUATERNION", f"{label} must have four components")
    result = [float(value) for value in values]
    _finite(result, label)
    norm = math.sqrt(sum(value * value for value in result))
    if not math.isclose(norm, 1.0, rel_tol=0.0, abs_tol=QUATERNION_NORM_TOLERANCE):
        raise ProbeError(
            "INVALID_QUATERNION",
            f"{label} is not normalized within {QUATERNION_NORM_TOLERANCE:g}",
        )
    return result


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _bounded_regular_file_size(path: Path, limit: int, label: str) -> int:
    if path.is_symlink():
        raise ProbeError("UNSAFE_FILE", f"{label} must not be a symlink")
    if not path.exists():
        raise ProbeError("MISSING_FILE", f"missing required file {path.name}")
    if not path.is_file():
        raise ProbeError("UNSAFE_FILE", f"{label} is not a regular file")
    try:
        size = path.stat().st_size
    except OSError as error:
        raise ProbeError("READ_FAILED", f"could not stat {label}: {error.strerror}") from error
    if size > limit:
        raise ProbeError("FILE_TOO_LARGE", f"{label} exceeds {limit} bytes")
    return size


def _json_ready(value: Any) -> Any:
    """Convert NumPy scalars and normalize negative zero before JSON output."""
    if isinstance(value, dict):
        return {str(key): _json_ready(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_ready(item) for item in value]
    if isinstance(value, np.ndarray):
        return [_json_ready(item) for item in value.tolist()]
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.floating):
        value = float(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ProbeError("NONFINITE_OUTPUT", "result contains a non-finite value")
        return 0.0 if value == 0.0 else value
    return value


def canonical_json_line(value: dict[str, Any]) -> str:
    return json.dumps(
        _json_ready(value),
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ) + "\n"


def runtime_versions(*, include_sqlite: bool) -> dict[str, str]:
    versions = {
        "numpy": np.__version__,
        "python": ".".join(str(value) for value in sys.version_info[:3]),
    }
    if include_sqlite:
        versions["sqlite"] = sqlite3.sqlite_version
    return versions


@dataclass
class BinaryReader:
    label: str
    data: bytes
    offset: int = 0

    @classmethod
    def from_path(cls, path: Path) -> "BinaryReader":
        expected_size = _bounded_regular_file_size(
            path, MAX_COLMAP_BINARY_BYTES, path.name
        )
        try:
            data = path.read_bytes()
        except OSError as error:
            raise ProbeError("READ_FAILED", f"could not read {path.name}: {error.strerror}") from error
        if len(data) > MAX_COLMAP_BINARY_BYTES:
            raise ProbeError(
                "FILE_TOO_LARGE", f"{path.name} exceeds {MAX_COLMAP_BINARY_BYTES} bytes"
            )
        if len(data) != expected_size:
            raise ProbeError(
                "FILE_CHANGED_DURING_READ", f"{path.name} changed size while being read"
            )
        return cls(path.name, data)

    @property
    def remaining(self) -> int:
        return len(self.data) - self.offset

    def unpack(self, format_characters: str, description: str) -> tuple[Any, ...]:
        fmt = struct.Struct("<" + format_characters)
        if fmt.size > self.remaining:
            raise ProbeError(
                "TRUNCATED_BINARY",
                f"{self.label} is truncated while reading {description} at byte {self.offset}",
            )
        values = fmt.unpack_from(self.data, self.offset)
        self.offset += fmt.size
        return values

    def require_count(self, count: int, minimum_record_bytes: int, description: str) -> None:
        if count > MAX_RECORDS:
            raise ProbeError(
                "MALICIOUS_COUNT",
                f"{self.label} {description} count exceeds {MAX_RECORDS}",
            )
        if minimum_record_bytes > 0 and count > self.remaining // minimum_record_bytes:
            raise ProbeError(
                "MALICIOUS_COUNT",
                f"{self.label} {description} count cannot fit in remaining bytes",
            )

    def skip_records(self, count: int, record_bytes: int, description: str) -> None:
        self.require_count(count, record_bytes, description)
        byte_count = count * record_bytes
        self.offset += byte_count

    def read_cstring(self, description: str) -> str:
        limit = min(len(self.data), self.offset + MAX_NAME_BYTES + 1)
        terminator = self.data.find(b"\0", self.offset, limit)
        if terminator < 0:
            raise ProbeError(
                "UNTERMINATED_NAME",
                f"{self.label} has no bounded NUL terminator for {description}",
            )
        raw = self.data[self.offset:terminator]
        self.offset = terminator + 1
        if not raw:
            raise ProbeError("INVALID_NAME", f"{self.label} {description} is empty")
        try:
            name = raw.decode("utf-8", errors="strict")
        except UnicodeDecodeError as error:
            raise ProbeError(
                "INVALID_NAME_ENCODING", f"{self.label} {description} is not UTF-8"
            ) from error
        if any(ord(character) < 32 for character in name):
            raise ProbeError(
                "INVALID_NAME", f"{self.label} {description} contains a control character"
            )
        return name

    def finish(self) -> None:
        if self.remaining != 0:
            raise ProbeError(
                "TRAILING_BYTES",
                f"{self.label} has {self.remaining} unexpected trailing bytes",
            )

    def evidence(self) -> dict[str, Any]:
        return {
            "byteSize": len(self.data),
            "sha256": _sha256_bytes(self.data),
        }


def parse_cameras_binary(path: Path) -> dict[str, Any]:
    reader = BinaryReader.from_path(path)
    count = int(reader.unpack("Q", "camera count")[0])
    reader.require_count(count, 24, "camera")
    records: list[dict[str, Any]] = []
    seen_ids: set[int] = set()
    for index in range(count):
        camera_id, model_id, width, height = reader.unpack("iiQQ", f"camera {index}")
        _validate_positive_id(camera_id, f"camera {index} id")
        if camera_id in seen_ids:
            raise ProbeError("DUPLICATE_ID", f"duplicate camera id {camera_id}")
        seen_ids.add(camera_id)
        model = CAMERA_MODELS.get(model_id)
        if model is None:
            raise ProbeError("UNKNOWN_CAMERA_MODEL", f"unknown camera model id {model_id}")
        if width <= 0 or height <= 0 or width > 1_000_000 or height > 1_000_000:
            raise ProbeError("INVALID_DIMENSIONS", f"camera {camera_id} has invalid dimensions")
        model_name, parameter_count = model
        params = list(reader.unpack("d" * parameter_count, f"camera {camera_id} parameters"))
        _finite(params, f"camera {camera_id} parameters")
        records.append(
            {
                "cameraId": camera_id,
                "height": height,
                "modelId": model_id,
                "modelName": model_name,
                "params": params,
                "width": width,
            }
        )
    reader.finish()
    return {"count": count, "evidence": reader.evidence(), "records": sorted(records, key=lambda x: x["cameraId"])}


def parse_images_binary(path: Path) -> dict[str, Any]:
    reader = BinaryReader.from_path(path)
    count = int(reader.unpack("Q", "registered image count")[0])
    reader.require_count(count, 73, "registered image")
    records: list[dict[str, Any]] = []
    seen_ids: set[int] = set()
    seen_names: set[str] = set()
    for index in range(count):
        values = reader.unpack("idddddddi", f"registered image {index}")
        image_id = int(values[0])
        qvec = _validate_quaternion(values[1:5], f"image {image_id} qvec")
        tvec = [float(value) for value in values[5:8]]
        camera_id = int(values[8])
        _validate_positive_id(image_id, f"image {index} id")
        _validate_positive_id(camera_id, f"image {image_id} camera id")
        _finite(tvec, f"image {image_id} tvec")
        if image_id in seen_ids:
            raise ProbeError("DUPLICATE_ID", f"duplicate image id {image_id}")
        seen_ids.add(image_id)
        name = reader.read_cstring(f"image {image_id} name")
        if name in seen_names:
            raise ProbeError("DUPLICATE_NAME", f"duplicate image name {name}")
        seen_names.add(name)
        point_count = int(reader.unpack("Q", f"image {image_id} point2D count")[0])
        reader.skip_records(point_count, 24, f"image {image_id} point2D")
        records.append(
            {
                "cameraId": camera_id,
                "imageId": image_id,
                "name": name,
                "point2DCount": point_count,
                "qvecHamiltonWxyz": qvec,
                "tvec": tvec,
            }
        )
    reader.finish()
    return {"count": count, "evidence": reader.evidence(), "records": sorted(records, key=lambda x: x["imageId"])}


def parse_points3d_binary(path: Path) -> dict[str, Any]:
    reader = BinaryReader.from_path(path)
    count = int(reader.unpack("Q", "point3D count")[0])
    reader.require_count(count, 51, "point3D")
    seen_ids: set[int] = set()
    xyz_min = [math.inf, math.inf, math.inf]
    xyz_max = [-math.inf, -math.inf, -math.inf]
    errors: list[float] = []
    total_track_length = 0
    for index in range(count):
        values = reader.unpack("QdddBBBd", f"point3D {index}")
        point_id = int(values[0])
        _validate_positive_id(point_id, f"point3D {index} id")
        if point_id in seen_ids:
            raise ProbeError("DUPLICATE_ID", f"duplicate point3D id {point_id}")
        seen_ids.add(point_id)
        xyz = [float(value) for value in values[1:4]]
        error = float(values[7])
        _finite([*xyz, error], f"point3D {point_id}")
        if error < 0:
            raise ProbeError("INVALID_RESIDUAL", f"point3D {point_id} error is negative")
        for axis in range(3):
            xyz_min[axis] = min(xyz_min[axis], xyz[axis])
            xyz_max[axis] = max(xyz_max[axis], xyz[axis])
        errors.append(error)
        track_length = int(reader.unpack("Q", f"point3D {point_id} track count")[0])
        reader.skip_records(track_length, 8, f"point3D {point_id} track")
        total_track_length += track_length
    reader.finish()
    error_stats = residual_statistics(errors) if errors else None
    return {
        "bounds": {"maximum": xyz_max, "minimum": xyz_min} if count else None,
        "count": count,
        "errorStatisticsPixels": error_stats,
        "evidence": reader.evidence(),
        "totalTrackElements": total_track_length,
    }


def parse_frames_binary(path: Path) -> dict[str, Any]:
    reader = BinaryReader.from_path(path)
    count = int(reader.unpack("Q", "frame count")[0])
    reader.require_count(count, 68, "frame")
    records: list[dict[str, Any]] = []
    seen_ids: set[int] = set()
    seen_data_ids: set[tuple[int, int, int]] = set()
    for index in range(count):
        frame_id, rig_id = reader.unpack("II", f"frame {index} ids")
        _validate_positive_id(frame_id, f"frame {index} id")
        _validate_positive_id(rig_id, f"frame {frame_id} rig id")
        if frame_id in seen_ids:
            raise ProbeError("DUPLICATE_ID", f"duplicate frame id {frame_id}")
        seen_ids.add(frame_id)
        pose = reader.unpack("ddddddd", f"frame {frame_id} pose")
        qvec = _validate_quaternion(pose[:4], f"frame {frame_id} qvec")
        translation = [float(value) for value in pose[4:]]
        _finite(translation, f"frame {frame_id} translation")
        data_count = int(reader.unpack("I", f"frame {frame_id} data count")[0])
        reader.require_count(data_count, 16, f"frame {frame_id} data")
        data_ids: list[dict[str, int]] = []
        local_data_ids: set[tuple[int, int, int]] = set()
        for _ in range(data_count):
            sensor_type, sensor_id, data_id = reader.unpack("IIQ", f"frame {frame_id} data id")
            key = (int(sensor_type), int(sensor_id), int(data_id))
            if key in local_data_ids or key in seen_data_ids:
                raise ProbeError("DUPLICATE_ID", f"duplicate frame data id {key}")
            local_data_ids.add(key)
            seen_data_ids.add(key)
            data_ids.append(
                {"dataId": data_id, "sensorId": sensor_id, "sensorType": sensor_type}
            )
        records.append(
            {
                "dataIds": sorted(data_ids, key=lambda x: (x["sensorType"], x["sensorId"], x["dataId"])),
                "frameId": frame_id,
                "qvecHamiltonWxyz": qvec,
                "rigId": rig_id,
                "translation": translation,
            }
        )
    reader.finish()
    return {"count": count, "evidence": reader.evidence(), "records": sorted(records, key=lambda x: x["frameId"])}


def _parse_rig(reader: BinaryReader, index: int, seen_ids: set[int]) -> dict[str, Any]:
    rig_id, sensor_count = reader.unpack("II", f"rig {index}")
    _validate_positive_id(rig_id, f"rig {index} id")
    if rig_id in seen_ids:
        raise ProbeError("DUPLICATE_ID", f"duplicate rig id {rig_id}")
    seen_ids.add(rig_id)
    if sensor_count > MAX_RECORDS:
        raise ProbeError("MALICIOUS_COUNT", f"rig {rig_id} sensor count exceeds {MAX_RECORDS}")
    reference_sensor: dict[str, int] | None = None
    sensors: list[dict[str, Any]] = []
    sensor_keys: set[tuple[int, int]] = set()
    if sensor_count:
        sensor_type, sensor_id = reader.unpack("II", f"rig {rig_id} reference sensor")
        reference_sensor = {"sensorId": sensor_id, "sensorType": sensor_type}
        sensor_keys.add((sensor_type, sensor_id))
        sensors.append({**reference_sensor, "sensorFromRig": None})
    for _ in range(max(0, sensor_count - 1)):
        sensor_type, sensor_id, has_pose = reader.unpack("III", f"rig {rig_id} sensor")
        key = (sensor_type, sensor_id)
        if key in sensor_keys:
            raise ProbeError("DUPLICATE_ID", f"duplicate rig {rig_id} sensor id {key}")
        sensor_keys.add(key)
        if has_pose not in (0, 1):
            raise ProbeError("INVALID_BOOLEAN", f"rig {rig_id} sensor has invalid pose flag")
        sensor_pose: dict[str, Any] | None = None
        if has_pose:
            pose = reader.unpack("ddddddd", f"rig {rig_id} sensor pose")
            sensor_pose = {
                "qvecHamiltonWxyz": _validate_quaternion(pose[:4], f"rig {rig_id} sensor qvec"),
                "translation": [float(value) for value in pose[4:]],
            }
            _finite(sensor_pose["translation"], f"rig {rig_id} sensor translation")
        sensors.append(
            {"sensorFromRig": sensor_pose, "sensorId": sensor_id, "sensorType": sensor_type}
        )
    return {
        "referenceSensor": reference_sensor,
        "rigId": rig_id,
        "sensorCount": sensor_count,
        "sensors": sorted(sensors, key=lambda item: (item["sensorType"], item["sensorId"])),
    }


def parse_rigs_binary(path: Path) -> dict[str, Any]:
    reader = BinaryReader.from_path(path)
    count = int(reader.unpack("Q", "rig count")[0])
    reader.require_count(count, 8, "rig")
    seen_ids: set[int] = set()
    records = [_parse_rig(reader, index, seen_ids) for index in range(count)]
    reader.finish()
    return {"count": count, "evidence": reader.evidence(), "records": sorted(records, key=lambda x: x["rigId"])}


def parse_optional_binary(
    path: Path, parser: Callable[[Path], dict[str, Any]]
) -> dict[str, Any]:
    if not path.exists():
        return {"status": "not_present"}
    if not path.is_file() or path.is_symlink():
        raise ProbeError("UNSAFE_FILE", f"{path.name} is not a regular non-symlink file")
    return {"status": "parsed", **parser(path)}


SOF_MARKERS = {
    0xC0: "SOF0",
    0xC1: "SOF1",
    0xC2: "SOF2",
    0xC3: "SOF3",
    0xC5: "SOF5",
    0xC6: "SOF6",
    0xC7: "SOF7",
    0xC9: "SOF9",
    0xCA: "SOF10",
    0xCB: "SOF11",
    0xCD: "SOF13",
    0xCE: "SOF14",
    0xCF: "SOF15",
}


def parse_jpeg_sof_bytes(data: bytes, label: str = "JPEG") -> dict[str, Any]:
    if len(data) < 4 or data[:2] != b"\xff\xd8":
        raise ProbeError("INVALID_JPEG", f"{label} is missing the JPEG SOI marker")
    offset = 2
    while offset < len(data):
        if data[offset] != 0xFF:
            raise ProbeError("INVALID_JPEG", f"{label} has invalid marker framing")
        while offset < len(data) and data[offset] == 0xFF:
            offset += 1
        if offset >= len(data):
            raise ProbeError("TRUNCATED_JPEG", f"{label} ends inside a marker")
        marker = data[offset]
        offset += 1
        if marker in (0x00, 0xD8) or 0xD0 <= marker <= 0xD7 or marker == 0x01:
            continue
        if marker in (0xD9, 0xDA):
            break
        if offset + 2 > len(data):
            raise ProbeError("TRUNCATED_JPEG", f"{label} lacks a segment length")
        segment_length = int.from_bytes(data[offset : offset + 2], "big")
        if segment_length < 2:
            raise ProbeError("INVALID_JPEG", f"{label} has an invalid segment length")
        segment_end = offset + segment_length
        if segment_end > len(data):
            raise ProbeError("TRUNCATED_JPEG", f"{label} has a truncated segment")
        if marker in SOF_MARKERS:
            if segment_length < 8:
                raise ProbeError("INVALID_JPEG", f"{label} has a short SOF segment")
            precision = data[offset + 2]
            height = int.from_bytes(data[offset + 3 : offset + 5], "big")
            width = int.from_bytes(data[offset + 5 : offset + 7], "big")
            component_count = data[offset + 7]
            expected_length = 8 + 3 * component_count
            if width <= 0 or height <= 0 or component_count <= 0:
                raise ProbeError("INVALID_JPEG", f"{label} has invalid SOF dimensions/components")
            if segment_length != expected_length:
                raise ProbeError("INVALID_JPEG", f"{label} SOF component length is inconsistent")
            return {
                "components": component_count,
                "height": height,
                "precisionBits": precision,
                "sofMarker": SOF_MARKERS[marker],
                "width": width,
            }
        offset = segment_end
    raise ProbeError("INVALID_JPEG", f"{label} has no SOF marker before image data")


def parse_jpeg_file(path: Path) -> dict[str, Any]:
    expected_size = _bounded_regular_file_size(path, MAX_JPEG_BYTES, path.name)
    try:
        data = path.read_bytes()
    except OSError as error:
        raise ProbeError("READ_FAILED", f"could not read {path.name}: {error.strerror}") from error
    if len(data) > MAX_JPEG_BYTES:
        raise ProbeError("FILE_TOO_LARGE", f"{path.name} exceeds {MAX_JPEG_BYTES} bytes")
    if len(data) != expected_size:
        raise ProbeError(
            "FILE_CHANGED_DURING_READ", f"{path.name} changed size while being read"
        )
    return {
        "byteSize": len(data),
        "sha256": _sha256_bytes(data),
        **parse_jpeg_sof_bytes(data, path.name),
    }


def parse_sweep_name(name: str) -> tuple[int, str]:
    match = SWEEP_NAME_RE.fullmatch(name)
    if match is None:
        raise ProbeError(
            "INVALID_IMAGE_NAME",
            "COLMAP image names must exactly match scan_NNN_{front,back,left,right,up,down}.jpg",
        )
    return int(match.group("sweep")), match.group("face")


def group_sweep_records(
    records: Sequence[dict[str, Any]], expected_sweeps: Sequence[int] | None = None
) -> list[dict[str, Any]]:
    grouped: dict[int, dict[str, dict[str, Any]]] = {}
    for record in records:
        sweep, face = parse_sweep_name(str(record["name"]))
        by_face = grouped.setdefault(sweep, {})
        if face in by_face:
            raise ProbeError("DUPLICATE_FACE", f"sweep {sweep} has duplicate {face} face")
        by_face[face] = record
    if expected_sweeps is None:
        sweep_indices = sorted(grouped)
    else:
        expected_set = set(expected_sweeps)
        extra = sorted(set(grouped) - expected_set)
        missing = sorted(expected_set - set(grouped))
        if extra or missing:
            raise ProbeError(
                "INVALID_SWEEP_SET",
                f"sweep set mismatch; missing={missing}, extra={extra}",
            )
        sweep_indices = list(expected_sweeps)
    result: list[dict[str, Any]] = []
    for sweep in sweep_indices:
        by_face = grouped[sweep]
        present = [face for face in FACES if face in by_face]
        result.append(
            {
                "missingFaces": [face for face in FACES if face not in by_face],
                "presentFaces": present,
                "records": [by_face[face] for face in present],
                "sweepIndex": sweep,
            }
        )
    return result


def inspect_image_directory(path: Path) -> dict[str, Any]:
    if not path.is_dir():
        raise ProbeError("MISSING_DIRECTORY", "COLMAP image directory does not exist")
    records: list[dict[str, Any]] = []
    for child in sorted(path.iterdir(), key=lambda item: item.name):
        if len(records) >= len(ALL_FIT_SWEEPS) * len(FACES):
            raise ProbeError(
                "UNEXPECTED_FILE_COUNT",
                "COLMAP image directory exceeds the expected 300 files",
            )
        if not child.is_file() or child.is_symlink():
            raise ProbeError("UNSAFE_FILE", "COLMAP image directory must contain only regular files")
        sweep, face = parse_sweep_name(child.name)
        records.append(
            {
                "face": face,
                "name": child.name,
                "sweepIndex": sweep,
                **parse_jpeg_file(child),
            }
        )
    groups = group_sweep_records(records, ALL_FIT_SWEEPS)
    incomplete = [group["sweepIndex"] for group in groups if group["missingFaces"]]
    if incomplete:
        raise ProbeError("INCOMPLETE_IMAGE_SET", f"image directory has incomplete sweeps {incomplete}")
    return {"count": len(records), "groups": groups, "records": records}


def _sqlite_schema_table_names(connection: sqlite3.Connection) -> list[str]:
    rows = connection.execute(
        "SELECT type,name,tbl_name FROM sqlite_master ORDER BY type,name LIMIT ?",
        (MAX_SQLITE_SCHEMA_OBJECTS + 1,),
    ).fetchall()
    if len(rows) > MAX_SQLITE_SCHEMA_OBJECTS:
        raise ProbeError(
            "SQLITE_SCHEMA_LIMIT",
            f"SQLite schema object count exceeds {MAX_SQLITE_SCHEMA_OBJECTS}",
        )
    table_names: set[str] = set()
    allowed_index_owners = COLMAP_DATABASE_TABLES | SQLITE_INTERNAL_TABLES
    for object_type_raw, name_raw, table_name_raw in rows:
        object_type = str(object_type_raw)
        name = str(name_raw)
        table_name = str(table_name_raw)
        if object_type == "table":
            if name not in allowed_index_owners:
                raise ProbeError(
                    "UNSAFE_SQLITE_SCHEMA", f"unexpected SQLite table {name}"
                )
            table_names.add(name)
        elif object_type == "view":
            raise ProbeError("UNSAFE_SQLITE_SCHEMA", f"SQLite views are forbidden: {name}")
        elif object_type == "trigger":
            raise ProbeError(
                "UNSAFE_SQLITE_SCHEMA", f"SQLite triggers are forbidden: {name}"
            )
        elif object_type == "index":
            if table_name not in allowed_index_owners:
                raise ProbeError(
                    "UNSAFE_SQLITE_SCHEMA",
                    f"SQLite index {name} belongs to unexpected table {table_name}",
                )
        else:
            raise ProbeError(
                "UNSAFE_SQLITE_SCHEMA",
                f"unexpected SQLite schema object type {object_type}: {name}",
            )
    missing = sorted(REQUIRED_COLMAP_DATABASE_TABLES - table_names)
    if missing:
        raise ProbeError(
            "INVALID_COLMAP_DATABASE",
            f"COLMAP database lacks required tables {missing}",
        )
    return sorted(table_names)


def _sqlite_table_counts(
    connection: sqlite3.Connection, table_names: Sequence[str]
) -> dict[str, int]:
    counts: dict[str, int] = {}
    for name in table_names:
        limit = SQLITE_TABLE_ROW_LIMITS[name]
        count = int(connection.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0])
        if count > limit:
            raise ProbeError(
                "SQLITE_ROW_LIMIT",
                f"SQLite table {name} row count exceeds {limit}",
            )
        counts[name] = count
    return counts


def _sqlite_camera_records(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = connection.execute(
        "SELECT camera_id,model,width,height,length(params),prior_focal_length "
        "FROM cameras ORDER BY camera_id"
    )
    records: list[dict[str, Any]] = []
    seen_ids: set[int] = set()
    for row in rows:
        camera_id = int(row[0])
        if camera_id in seen_ids:
            raise ProbeError("DUPLICATE_ID", f"database duplicate camera id {camera_id}")
        seen_ids.add(camera_id)
        records.append(
            {
                "cameraId": camera_id,
                "height": int(row[3]),
                "modelId": int(row[1]),
                "paramsByteCount": int(row[4]),
                "priorFocalLength": bool(row[5]),
                "width": int(row[2]),
            }
        )
    return records


def _sqlite_image_records(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = connection.execute("SELECT image_id,name,camera_id FROM images ORDER BY image_id")
    records: list[dict[str, Any]] = []
    seen_ids: set[int] = set()
    seen_names: set[str] = set()
    for row in rows:
        image_id = int(row[0])
        name = str(row[1])
        if image_id in seen_ids:
            raise ProbeError("DUPLICATE_ID", f"database duplicate image id {image_id}")
        if name in seen_names:
            raise ProbeError("DUPLICATE_NAME", f"database duplicate image name {name}")
        seen_ids.add(image_id)
        seen_names.add(name)
        parse_sweep_name(name)
        records.append({"cameraId": int(row[2]), "imageId": image_id, "name": name})
    return records


def _read_sqlite_metadata(connection: sqlite3.Connection) -> dict[str, Any]:
    connection.execute("PRAGMA trusted_schema=OFF")
    trusted_schema = int(connection.execute("PRAGMA trusted_schema").fetchone()[0])
    if trusted_schema != 0:
        raise ProbeError(
            "SQLITE_TRUSTED_SCHEMA_ENABLED", "SQLite trusted_schema could not be disabled"
        )
    connection.execute("PRAGMA query_only=ON")
    query_only = int(connection.execute("PRAGMA query_only").fetchone()[0])
    if query_only != 1:
        raise ProbeError("SQLITE_NOT_QUERY_ONLY", "SQLite query_only could not be enabled")
    table_names = _sqlite_schema_table_names(connection)
    table_counts = _sqlite_table_counts(connection, table_names)
    return {
        "applicationId": int(connection.execute("PRAGMA application_id").fetchone()[0]),
        "cameras": _sqlite_camera_records(connection) if "cameras" in table_counts else [],
        "images": _sqlite_image_records(connection) if "images" in table_counts else [],
        "queryOnly": True,
        "schemaVersion": int(connection.execute("PRAGMA schema_version").fetchone()[0]),
        "tableCounts": table_counts,
        "trustedSchema": False,
        "userVersion": int(connection.execute("PRAGMA user_version").fetchone()[0]),
    }


def _sqlite_sidecar_size(path: Path, suffix: str) -> int:
    sidecar = Path(str(path) + suffix)
    if not sidecar.exists() and not sidecar.is_symlink():
        return 0
    if sidecar.is_symlink() or not sidecar.is_file():
        raise ProbeError(
            "UNSAFE_SQLITE_SIDECAR",
            f"SQLite {suffix.removeprefix('-')} sidecar must be a regular non-symlink file",
        )
    return sidecar.stat().st_size


def inspect_colmap_database(path: Path) -> dict[str, Any]:
    database_size = _bounded_regular_file_size(
        path, MAX_COLMAP_DATABASE_BYTES, "database.db"
    )
    resolved_path = path.resolve(strict=True)
    journal_path = Path(str(resolved_path) + "-journal")
    if journal_path.exists() or journal_path.is_symlink():
        raise ProbeError(
            "SQLITE_ROLLBACK_JOURNAL_PRESENT",
            "read-only immutable inspection refuses a database with a rollback journal",
        )
    wal_size = _sqlite_sidecar_size(resolved_path, "-wal")
    if wal_size:
        raise ProbeError(
            "NONEMPTY_SQLITE_WAL",
            "read-only immutable inspection refuses a database with a non-empty WAL",
        )
    shm_size = _sqlite_sidecar_size(resolved_path, "-shm")
    uri = resolved_path.as_uri() + "?mode=ro&immutable=1"
    try:
        connection = sqlite3.connect(uri, uri=True)
        try:
            metadata = _read_sqlite_metadata(connection)
        finally:
            connection.close()
    except sqlite3.Error as error:
        raise ProbeError("SQLITE_READ_FAILED", f"SQLite read failed: {error}") from error
    if resolved_path.stat().st_size != database_size:
        raise ProbeError(
            "FILE_CHANGED_DURING_READ", "database.db changed size during inspection"
        )
    return {
        "byteSize": database_size,
        "immutable": True,
        "rollbackJournalPresent": False,
        "shmByteSize": shm_size,
        "walByteSize": wal_size,
        **metadata,
    }


class E57MetadataAdapter(Protocol):
    adapter_name: str
    adapter_version: str

    def inspect(self, path: Path) -> dict[str, Any]: ...


class E57AggregateAdapter(Protocol):
    adapter_name: str
    adapter_version: str

    def inspect(self, path: Path) -> dict[str, Any]: ...


E57_IMAGE_REPRESENTATION_FIELDS = (
    "cylindricalRepresentation",
    "pinholeRepresentation",
    "sphericalRepresentation",
    "visualReferenceRepresentation",
)
E57_IMAGE_BLOB_FIELDS = ("imageMask", "jpegImage", "pngImage")


def _bounded_e57_declaration(
    value: Any,
    label: str,
    maximum: int,
    *,
    overflow_code: str = "MALICIOUS_COUNT",
) -> int:
    try:
        result = operator.index(value)
    except TypeError as error:
        raise ProbeError(
            "INVALID_E57_METADATA", f"{label} is not an integer declaration"
        ) from error
    if result < 0:
        raise ProbeError("MALICIOUS_COUNT", f"{label} is negative")
    if result > maximum:
        raise ProbeError(overflow_code, f"{label} exceeds {maximum}")
    return result


def _bounded_e57_utf8_scalar(value: Any, label: str) -> tuple[int, str]:
    if not isinstance(value, str):
        raise ProbeError("INVALID_E57_METADATA", f"{label} is not a string scalar")
    try:
        encoded = value.encode("utf-8")
    except UnicodeEncodeError as error:
        raise ProbeError("INVALID_E57_METADATA", f"{label} is not valid UTF-8") from error
    if len(encoded) > MAX_E57_METADATA_SCALAR_BYTES:
        raise ProbeError(
            "E57_METADATA_SCALAR_TOO_LARGE",
            f"{label} exceeds {MAX_E57_METADATA_SCALAR_BYTES} UTF-8 bytes",
        )
    return len(encoded), _sha256_bytes(encoded)


def _validate_e57_aggregate_pose(node: Any, label: str) -> bool:
    """Validate only known pose scalars; aggregate output never exposes pose values."""
    if not node.isDefined("pose"):
        return False
    pose = node["pose"]
    if not hasattr(pose, "isDefined"):
        raise ProbeError("INVALID_E57_POSE", f"{label} pose is not a structure")
    for structure_name, axes in (
        ("rotation", ("w", "x", "y", "z")),
        ("translation", ("x", "y", "z")),
    ):
        if not pose.isDefined(structure_name):
            raise ProbeError(
                "INVALID_E57_POSE",
                f"{label} pose lacks {structure_name}",
            )
        structure = pose[structure_name]
        if not hasattr(structure, "isDefined"):
            raise ProbeError(
                "INVALID_E57_POSE",
                f"{label} pose {structure_name} is not a structure",
            )
        for axis in axes:
            if not structure.isDefined(axis):
                raise ProbeError(
                    "INVALID_E57_POSE",
                    f"{label} pose {structure_name} lacks {axis}",
                )
            raw_value = _node_value(structure, axis, required=True)
            try:
                value = float(raw_value)
            except (TypeError, ValueError, OverflowError) as error:
                raise ProbeError(
                    "INVALID_E57_POSE",
                    f"{label} pose {structure_name}.{axis} is not numeric",
                ) from error
            if not math.isfinite(value):
                raise ProbeError(
                    "NONFINITE_VALUE",
                    f"{label} pose {structure_name}.{axis} is non-finite",
                )
    return True


def _aggregate_e57_scans(e57: Any) -> dict[str, Any]:
    scan_count = _bounded_e57_declaration(
        e57.scan_count, "E57 scan count", MAX_E57_METADATA_RECORDS
    )
    declared_point_total = 0
    pose_present = 0
    point_field_coverage: dict[str, int] = {}
    for index in range(scan_count):
        node = e57.data3d[index]
        if not node.isDefined("points"):
            raise ProbeError(
                "INVALID_E57_METADATA", f"E57 scan {index} lacks required points"
            )
        points = node["points"]
        if not hasattr(points, "childCount") or not hasattr(points, "prototype"):
            raise ProbeError(
                "INVALID_E57_METADATA",
                f"E57 scan {index} points is not a compressed vector",
            )
        point_count = _bounded_e57_declaration(
            points.childCount(),
            f"E57 scan {index} point-record count",
            MAX_E57_DECLARED_UNSIGNED_INTEGER,
        )
        declared_point_total += point_count
        if _validate_e57_aggregate_pose(node, f"E57 scan {index}"):
            pose_present += 1

        fields_for_scan: set[str] = set()
        prototype = points.prototype()
        if not hasattr(prototype, "childCount") or not hasattr(prototype, "get"):
            try:
                import pye57

                prototype = pye57.libe57.StructureNode(prototype)
            except (ImportError, TypeError, ValueError) as error:
                raise ProbeError(
                    "INVALID_E57_METADATA",
                    f"E57 scan {index} point prototype is not a structure",
                ) from error
        if not hasattr(prototype, "childCount") or not hasattr(prototype, "get"):
            raise ProbeError(
                "INVALID_E57_METADATA",
                f"E57 scan {index} point prototype is not a structure",
            )
        field_count = _bounded_e57_declaration(
            prototype.childCount(),
            f"E57 scan {index} point-field declaration count",
            MAX_E57_DISTINCT_POINT_FIELDS,
            overflow_code="E57_POINT_FIELD_LIMIT",
        )
        for field_index in range(field_count):
            child = prototype.get(field_index)
            if not hasattr(child, "elementName"):
                raise ProbeError(
                    "INVALID_E57_METADATA",
                    f"E57 scan {index} point field lacks an element name",
                )
            raw_field = str(child.elementName())
            _bounded_e57_utf8_scalar(raw_field, f"E57 scan {index} point field")
            fields_for_scan.add(raw_field)
        if len(point_field_coverage.keys() | fields_for_scan) > MAX_E57_DISTINCT_POINT_FIELDS:
            raise ProbeError(
                "E57_POINT_FIELD_LIMIT",
                "E57 distinct point-field declarations exceed "
                f"{MAX_E57_DISTINCT_POINT_FIELDS}",
            )
        for field in fields_for_scan:
            point_field_coverage[field] = point_field_coverage.get(field, 0) + 1

    return {
        "declaredPointRecordTotal": str(declared_point_total),
        "pointFieldCoverage": [
            {"field": field, "scanCount": point_field_coverage[field]}
            for field in sorted(point_field_coverage)
        ],
        "scanCount": scan_count,
        "scanPoseCounts": {
            "absent": scan_count - pose_present,
            "present": pose_present,
        },
    }


def _aggregate_e57_images(root: Any, file_size: int) -> dict[str, Any]:
    if not root.isDefined("images2D"):
        return {
            "blobDeclarationHistogram": [],
            "declaredImageBlobByteTotal": "0",
            "imageCount": 0,
            "imagePoseCounts": {"absent": 0, "present": 0},
            "imageRepresentationCardinality": {"absent": 0, "multiple": 0, "single": 0},
            "imageRepresentationHistogram": [],
        }

    images_node = root["images2D"]
    image_count = _bounded_e57_declaration(
        len(images_node), "E57 image metadata count", MAX_E57_METADATA_RECORDS
    )
    if len(E57_IMAGE_REPRESENTATION_FIELDS) > MAX_E57_DISTINCT_IMAGE_REPRESENTATIONS:
        raise ProbeError(
            "E57_IMAGE_REPRESENTATION_LIMIT",
            "recognized E57 image representation declarations exceed "
            f"{MAX_E57_DISTINCT_IMAGE_REPRESENTATIONS}",
        )

    pose_present = 0
    representation_histogram: dict[str, int] = {}
    representation_cardinality = {"absent": 0, "multiple": 0, "single": 0}
    blob_histogram: dict[str, dict[str, int]] = {}
    declared_blob_total = 0
    for index in range(image_count):
        image_node = images_node[index]
        if _validate_e57_aggregate_pose(image_node, f"E57 image {index}"):
            pose_present += 1
        representations = [
            name
            for name in E57_IMAGE_REPRESENTATION_FIELDS
            if image_node.isDefined(name)
        ]
        if not representations:
            representation_cardinality["absent"] += 1
        elif len(representations) == 1:
            representation_cardinality["single"] += 1
        else:
            representation_cardinality["multiple"] += 1

        for representation_name in representations:
            representation_histogram[representation_name] = (
                representation_histogram.get(representation_name, 0) + 1
            )
            representation = image_node[representation_name]
            for blob_name in E57_IMAGE_BLOB_FIELDS:
                if not representation.isDefined(blob_name):
                    continue
                blob = representation[blob_name]
                if not hasattr(blob, "byteCount"):
                    raise ProbeError(
                        "INVALID_E57_IMAGE",
                        f"E57 image {index} {representation_name}.{blob_name} is not a blob",
                    )
                byte_count = _bounded_e57_declaration(
                    blob.byteCount(),
                    f"E57 image {index} {representation_name}.{blob_name} byte count",
                    file_size,
                )
                declared_blob_total += byte_count
                if declared_blob_total > file_size:
                    raise ProbeError(
                        "MALICIOUS_COUNT",
                        "E57 declared image blob byte total exceeds E57 file byte size",
                    )
                aggregate = blob_histogram.setdefault(
                    blob_name, {"declarationCount": 0, "declaredByteTotal": 0}
                )
                aggregate["declarationCount"] += 1
                aggregate["declaredByteTotal"] += byte_count

    return {
        "blobDeclarationHistogram": [
            {
                "declarationCount": blob_histogram[kind]["declarationCount"],
                "declaredByteTotal": str(blob_histogram[kind]["declaredByteTotal"]),
                "kind": kind,
            }
            for kind in sorted(blob_histogram)
        ],
        "declaredImageBlobByteTotal": str(declared_blob_total),
        "imageCount": image_count,
        "imagePoseCounts": {
            "absent": image_count - pose_present,
            "present": pose_present,
        },
        "imageRepresentationCardinality": representation_cardinality,
        "imageRepresentationHistogram": [
            {"declarationCount": representation_histogram[kind], "kind": kind}
            for kind in sorted(representation_histogram)
        ],
    }


def _aggregate_e57_open_file(e57: Any, file_size: int) -> dict[str, Any]:
    file_size = _bounded_e57_declaration(
        file_size, "E57 file byte size", MAX_E57_FILE_BYTES
    )
    root = e57.root
    if root.isDefined("coordinateMetadata"):
        coordinate_metadata = _node_value(root, "coordinateMetadata", required=True)
        byte_count, digest = _bounded_e57_utf8_scalar(
            coordinate_metadata, "E57 coordinateMetadata"
        )
        coordinate_metadata_result: dict[str, Any] = {
            "present": True,
            "sha256": digest,
            "utf8ByteCount": byte_count,
        }
    else:
        coordinate_metadata_result = {
            "present": False,
            "sha256": None,
            "utf8ByteCount": 0,
        }
    return {
        "coordinateMetadata": coordinate_metadata_result,
        "file": {"byteSize": file_size},
        **_aggregate_e57_images(root, file_size),
        **_aggregate_e57_scans(e57),
    }


class Pye57AggregateAdapter:
    adapter_name = "pye57"

    def __init__(self) -> None:
        try:
            self.adapter_version = importlib.metadata.version("pye57")
        except importlib.metadata.PackageNotFoundError as error:
            raise ProbeError("PYE57_UNAVAILABLE", "pye57 0.4.19 is not installed") from error
        if self.adapter_version != REQUIRED_PYE57_VERSION:
            raise ProbeError(
                "PYE57_VERSION_MISMATCH",
                f"pye57 {REQUIRED_PYE57_VERSION} is required; found {self.adapter_version}",
            )

    def inspect(self, path: Path) -> dict[str, Any]:
        try:
            import pye57
        except ImportError as error:
            raise ProbeError("PYE57_UNAVAILABLE", "pye57 0.4.19 is not importable") from error
        file_size = _bounded_regular_file_size(path, MAX_E57_FILE_BYTES, "E57 source")
        try:
            with pye57.E57(str(path), mode="r") as e57:
                result = _aggregate_e57_open_file(e57, file_size)
        except ProbeError:
            raise
        except Exception as error:
            raise ProbeError("E57_READ_FAILED", f"pye57 metadata read failed: {error}") from error
        if path.stat().st_size != file_size:
            raise ProbeError(
                "FILE_CHANGED_DURING_READ",
                "E57 source changed size during inspection",
            )
        return result


def inspect_e57_aggregate(
    path: Path, adapter: E57AggregateAdapter | None = None
) -> dict[str, Any]:
    selected_adapter = adapter if adapter is not None else Pye57AggregateAdapter()
    result = selected_adapter.inspect(path)
    required_keys = {
        "coordinateMetadata",
        "declaredImageBlobByteTotal",
        "declaredPointRecordTotal",
        "file",
        "imageCount",
        "scanCount",
    }
    if not isinstance(result, dict) or not required_keys.issubset(result):
        raise ProbeError("INVALID_E57_ADAPTER", "E57 aggregate adapter returned an invalid result")
    return {
        "adapter": {
            "name": selected_adapter.adapter_name,
            "version": selected_adapter.adapter_version,
        },
        "imageBlobBytesRead": False,
        "openMode": "read-only",
        "pointRecordsRead": False,
        "runtimeVersions": runtime_versions(include_sqlite=False),
        **result,
    }


def _node_child_names(node: Any) -> list[str]:
    return [str(node.get(index).elementName()) for index in range(node.childCount())]


def _node_value(node: Any, name: str, required: bool = False) -> Any:
    if not node.isDefined(name):
        if required:
            raise ProbeError("INVALID_E57_METADATA", f"E57 node lacks required {name}")
        return None
    child = node[name]
    if not hasattr(child, "value"):
        raise ProbeError("INVALID_E57_METADATA", f"E57 {name} is not a scalar")
    return child.value()


def _e57_pose(node: Any, label: str, required: bool = True) -> dict[str, Any] | None:
    if not node.isDefined("pose"):
        if required:
            raise ProbeError("INVALID_E57_POSE", f"{label} has no pose")
        return None
    pose = node["pose"]
    if not pose.isDefined("rotation") or not pose.isDefined("translation"):
        raise ProbeError("INVALID_E57_POSE", f"{label} pose is incomplete")
    rotation = pose["rotation"]
    translation = pose["translation"]
    qvec = _validate_quaternion(
        [_node_value(rotation, axis, required=True) for axis in ("w", "x", "y", "z")],
        f"{label} qvec",
    )
    vector = [float(_node_value(translation, axis, required=True)) for axis in ("x", "y", "z")]
    _finite(vector, f"{label} translation")
    return {"qvecHamiltonWxyz": qvec, "translation": vector}


def _e57_representation(image_node: Any, label: str) -> dict[str, Any]:
    representation_names = [
        name
        for name in (
            "pinholeRepresentation",
            "sphericalRepresentation",
            "cylindricalRepresentation",
            "visualReferenceRepresentation",
        )
        if image_node.isDefined(name)
    ]
    if len(representation_names) != 1:
        raise ProbeError(
            "INVALID_E57_IMAGE",
            f"{label} must have exactly one recognized image representation",
        )
    kind = representation_names[0]
    representation = image_node[kind]
    result: dict[str, Any] = {"kind": kind}
    scalar_fields = (
        "imageWidth",
        "imageHeight",
        "focalLength",
        "pixelWidth",
        "pixelHeight",
        "principalPointX",
        "principalPointY",
    )
    for field in scalar_fields:
        value = _node_value(representation, field)
        if value is not None:
            numeric = float(value) if isinstance(value, float) else int(value)
            if isinstance(numeric, float) and not math.isfinite(numeric):
                raise ProbeError("NONFINITE_VALUE", f"{label} {field} is non-finite")
            result[field] = numeric
    blob_fields = ("jpegImage", "pngImage", "imageMask")
    blobs: list[dict[str, Any]] = []
    for field in blob_fields:
        if representation.isDefined(field):
            blob = representation[field]
            byte_count = int(blob.byteCount())
            if byte_count < 0:
                raise ProbeError("INVALID_E57_IMAGE", f"{label} {field} size is negative")
            blobs.append({"byteCount": byte_count, "kind": field})
    if not blobs:
        raise ProbeError("INVALID_E57_IMAGE", f"{label} has no recognized image blob")
    result["blobs"] = blobs
    return result


def _inspect_e57_scans(e57: Any) -> tuple[list[dict[str, Any]], set[str]]:
    scans: list[dict[str, Any]] = []
    scan_guids: set[str] = set()
    scan_count = int(e57.scan_count)
    if scan_count < 0:
        raise ProbeError("MALICIOUS_COUNT", "E57 scan count is negative")
    if scan_count > MAX_E57_METADATA_RECORDS:
        raise ProbeError(
            "MALICIOUS_COUNT",
            f"E57 scan count exceeds {MAX_E57_METADATA_RECORDS}",
        )
    for index in range(scan_count):
        node = e57.data3d[index]
        header = e57.get_header(index)
        guid = str(_node_value(node, "guid", required=True))
        if guid in scan_guids:
            raise ProbeError("DUPLICATE_ID", f"duplicate E57 scan guid {guid}")
        scan_guids.add(guid)
        scans.append(
            {
                "guid": guid,
                "index": index,
                "name": _node_value(node, "name"),
                "pointCount": int(header.point_count),
                "pointFields": sorted(str(field) for field in header.point_fields),
                "pose": _e57_pose(node, f"E57 scan {index}"),
                "sensorModel": _node_value(node, "sensorModel"),
                "sensorSerialNumber": _node_value(node, "sensorSerialNumber"),
                "sensorVendor": _node_value(node, "sensorVendor"),
            }
        )
    return scans, scan_guids


def _inspect_e57_images(root: Any, scan_guids: set[str]) -> list[dict[str, Any]]:
    if not root.isDefined("images2D"):
        return []
    images_node = root["images2D"]
    images: list[dict[str, Any]] = []
    image_guids: set[str] = set()
    image_count = len(images_node)
    if image_count > MAX_E57_METADATA_RECORDS:
        raise ProbeError(
            "MALICIOUS_COUNT",
            f"E57 image metadata count exceeds {MAX_E57_METADATA_RECORDS}",
        )
    for index in range(image_count):
        node = images_node[index]
        guid = str(_node_value(node, "guid", required=True))
        if guid in image_guids:
            raise ProbeError("DUPLICATE_ID", f"duplicate E57 image guid {guid}")
        image_guids.add(guid)
        associated_guid = str(_node_value(node, "associatedData3DGuid", required=True))
        if associated_guid not in scan_guids:
            raise ProbeError(
                "DANGLING_REFERENCE", f"E57 image {index} references an unknown scan guid"
            )
        images.append(
            {
                "associatedData3DGuid": associated_guid,
                "guid": guid,
                "index": index,
                "name": _node_value(node, "name"),
                "pose": _e57_pose(node, f"E57 image {index}"),
                "representation": _e57_representation(node, f"E57 image {index}"),
            }
        )
    return images


class Pye57MetadataAdapter:
    adapter_name = "pye57"

    def __init__(self) -> None:
        try:
            self.adapter_version = importlib.metadata.version("pye57")
        except importlib.metadata.PackageNotFoundError as error:
            raise ProbeError("PYE57_UNAVAILABLE", "pye57 0.4.19 is not installed") from error
        if self.adapter_version != REQUIRED_PYE57_VERSION:
            raise ProbeError(
                "PYE57_VERSION_MISMATCH",
                f"pye57 {REQUIRED_PYE57_VERSION} is required; found {self.adapter_version}",
            )

    def inspect(self, path: Path) -> dict[str, Any]:
        try:
            import pye57
        except ImportError as error:
            raise ProbeError("PYE57_UNAVAILABLE", "pye57 0.4.19 is not importable") from error
        file_size = _bounded_regular_file_size(path, MAX_E57_FILE_BYTES, "E57 source")
        try:
            with pye57.E57(str(path), mode="r") as e57:
                root = e57.root
                root_metadata = {
                    field: _node_value(root, field)
                    for field in (
                        "formatName",
                        "guid",
                        "versionMajor",
                        "versionMinor",
                        "e57LibraryVersion",
                        "coordinateMetadata",
                    )
                    if root.isDefined(field)
                }
                scans, scan_guids = _inspect_e57_scans(e57)
                images = _inspect_e57_images(root, scan_guids)
        except ProbeError:
            raise
        except Exception as error:
            raise ProbeError("E57_READ_FAILED", f"pye57 metadata read failed: {error}") from error
        if path.stat().st_size != file_size:
            raise ProbeError("FILE_CHANGED_DURING_READ", "E57 source changed size during inspection")
        return {
            "file": {"byteSize": file_size},
            "imageCount": len(images),
            "images2D": images,
            "root": root_metadata,
            "scanCount": len(scans),
            "scans": scans,
        }


def inspect_e57_metadata(
    path: Path, adapter: E57MetadataAdapter | None = None
) -> dict[str, Any]:
    selected_adapter = adapter if adapter is not None else Pye57MetadataAdapter()
    result = selected_adapter.inspect(path)
    if not isinstance(result, dict) or not isinstance(result.get("scans"), list):
        raise ProbeError("INVALID_E57_ADAPTER", "E57 adapter returned an invalid result")
    return {
        "adapter": {
            "name": selected_adapter.adapter_name,
            "version": selected_adapter.adapter_version,
        },
        "openMode": "read-only",
        "pointDataRead": False,
        "runtimeVersions": runtime_versions(include_sqlite=False),
        **result,
    }


def _validate_sparse_references(
    cameras: dict[str, Any],
    images: dict[str, Any],
    frames: dict[str, Any],
    rigs: dict[str, Any],
) -> None:
    camera_ids = {record["cameraId"] for record in cameras["records"]}
    for image in images["records"]:
        if image["cameraId"] not in camera_ids:
            raise ProbeError(
                "DANGLING_REFERENCE",
                f"image {image['imageId']} references unknown camera {image['cameraId']}",
            )
    image_ids = {record["imageId"] for record in images["records"]}
    if frames["status"] == "parsed" and rigs["status"] == "parsed":
        rig_ids = {record["rigId"] for record in rigs["records"]}
        rig_sensor_ids = {
            (sensor["sensorType"], sensor["sensorId"])
            for rig in rigs["records"]
            for sensor in rig["sensors"]
        }
        camera_data_ids: set[int] = set()
        for frame in frames["records"]:
            if frame["rigId"] not in rig_ids:
                raise ProbeError(
                    "DANGLING_REFERENCE",
                    f"frame {frame['frameId']} references unknown rig {frame['rigId']}",
                )
            for data_id in frame["dataIds"]:
                sensor_key = (data_id["sensorType"], data_id["sensorId"])
                if sensor_key not in rig_sensor_ids:
                    raise ProbeError(
                        "DANGLING_REFERENCE",
                        f"frame {frame['frameId']} references unknown rig sensor {sensor_key}",
                    )
                if data_id["sensorType"] == 0:
                    if data_id["sensorId"] not in camera_ids:
                        raise ProbeError(
                            "DANGLING_REFERENCE",
                            f"frame {frame['frameId']} references unknown camera sensor",
                        )
                    camera_data_ids.add(data_id["dataId"])
        if camera_data_ids != image_ids:
            missing = sorted(image_ids - camera_data_ids)
            extra = sorted(camera_data_ids - image_ids)
            raise ProbeError(
                "FRAME_IMAGE_MISMATCH",
                f"frame camera data mismatch; missing={missing}, extra={extra}",
            )


def inspect_sparse_model(model_path: Path) -> dict[str, Any]:
    if not model_path.is_dir():
        raise ProbeError("MISSING_DIRECTORY", "COLMAP sparse model directory does not exist")
    cameras = parse_cameras_binary(model_path / "cameras.bin")
    images = parse_images_binary(model_path / "images.bin")
    points = parse_points3d_binary(model_path / "points3D.bin")
    frames = parse_optional_binary(model_path / "frames.bin", parse_frames_binary)
    rigs = parse_optional_binary(model_path / "rigs.bin", parse_rigs_binary)
    _validate_sparse_references(cameras, images, frames, rigs)
    registered_groups = group_sweep_records(images["records"], ALL_FIT_SWEEPS)
    return {
        "binaryFormat": {"endianness": ENDIAN, "format": "COLMAP sparse binary"},
        "cameras": cameras,
        "frames": frames,
        "images": images,
        "points3D": points,
        "registeredSweepGroups": registered_groups,
        "rigs": rigs,
    }


def inspect_colmap(model_path: Path, image_path: Path, database_path: Path | None) -> dict[str, Any]:
    result = {
        "database": inspect_colmap_database(database_path) if database_path is not None else None,
        "imageFiles": inspect_image_directory(image_path),
        "runtimeVersions": runtime_versions(include_sqlite=True),
        "sparseModel": inspect_sparse_model(model_path),
    }
    file_names = {record["name"] for record in result["imageFiles"]["records"]}
    registered_names = {
        record["name"] for record in result["sparseModel"]["images"]["records"]
    }
    if not registered_names.issubset(file_names):
        raise ProbeError(
            "MISSING_REGISTERED_IMAGE",
            f"registered image files are missing: {sorted(registered_names - file_names)}",
        )
    if result["database"] is not None:
        database_names = {record["name"] for record in result["database"]["images"]}
        if database_names != file_names:
            missing = sorted(database_names - file_names)
            extra = sorted(file_names - database_names)
            raise ProbeError(
                "DATABASE_IMAGE_MISMATCH",
                f"database/image-directory mismatch; missing={missing}, extra={extra}",
            )
    return result


def quaternion_world_to_camera_rotation(qvec: Sequence[float]) -> np.ndarray:
    w, x, y, z = _validate_quaternion(qvec, "COLMAP world-to-camera qvec")
    return np.array(
        [
            [1.0 - 2.0 * y * y - 2.0 * z * z, 2.0 * x * y - 2.0 * w * z, 2.0 * z * x + 2.0 * w * y],
            [2.0 * x * y + 2.0 * w * z, 1.0 - 2.0 * x * x - 2.0 * z * z, 2.0 * y * z - 2.0 * w * x],
            [2.0 * z * x - 2.0 * w * y, 2.0 * y * z + 2.0 * w * x, 1.0 - 2.0 * x * x - 2.0 * y * y],
        ],
        dtype=np.float64,
    )


def colmap_camera_center(qvec: Sequence[float], tvec: Sequence[float]) -> np.ndarray:
    translation = np.asarray(tvec, dtype=np.float64)
    if translation.shape != (3,) or not np.all(np.isfinite(translation)):
        raise ProbeError("INVALID_TRANSLATION", "COLMAP tvec must be three finite values")
    rotation = quaternion_world_to_camera_rotation(qvec)
    return -(rotation.T @ translation)


@dataclass(frozen=True)
class SimilarityTransform:
    scale: float
    rotation: np.ndarray
    translation: np.ndarray

    def apply(self, points: np.ndarray) -> np.ndarray:
        return self.scale * (points @ self.rotation.T) + self.translation

    def as_json(self) -> dict[str, Any]:
        matrix = np.eye(4, dtype=np.float64)
        matrix[:3, :3] = self.scale * self.rotation
        matrix[:3, 3] = self.translation
        return {
            "determinantRotation": float(np.linalg.det(self.rotation)),
            "matrixColumnMajor": matrix.flatten(order="F").tolist(),
            "rotationRowMajor": self.rotation.tolist(),
            "scale": self.scale,
            "translation": self.translation.tolist(),
        }


def _matrix_rank_strict(points: np.ndarray) -> int:
    singular_values = np.linalg.svd(points, compute_uv=False)
    if singular_values.size == 0 or singular_values[0] == 0:
        return 0
    threshold = singular_values[0] * RANK_RELATIVE_TOLERANCE
    return int(np.count_nonzero(singular_values > threshold))


def fit_similarity_umeyama(source: np.ndarray, target: np.ndarray) -> SimilarityTransform:
    source = np.asarray(source, dtype=np.float64)
    target = np.asarray(target, dtype=np.float64)
    if source.shape != target.shape or source.ndim != 2 or source.shape[1] != 3:
        raise ProbeError("INVALID_CORRESPONDENCES", "source and target must be matching Nx3 arrays")
    if source.shape[0] < 4:
        raise ProbeError("INSUFFICIENT_CORRESPONDENCES", "at least four correspondences are required")
    if not np.all(np.isfinite(source)) or not np.all(np.isfinite(target)):
        raise ProbeError("NONFINITE_VALUE", "correspondences contain a non-finite value")
    source_mean = np.mean(source, axis=0)
    target_mean = np.mean(target, axis=0)
    source_centered = source - source_mean
    target_centered = target - target_mean
    if _matrix_rank_strict(source_centered) < 3 or _matrix_rank_strict(target_centered) < 3:
        raise ProbeError("RANK_DEFICIENT", "similarity correspondences do not span 3D")
    source_variance = float(np.mean(np.sum(source_centered * source_centered, axis=1)))
    if not math.isfinite(source_variance) or source_variance <= 0:
        raise ProbeError("RANK_DEFICIENT", "source correspondence variance is zero")
    covariance = (target_centered.T @ source_centered) / source.shape[0]
    left, singular_values, right_transpose = np.linalg.svd(covariance)
    unconstrained_rotation = left @ right_transpose
    if float(np.linalg.det(unconstrained_rotation)) < 0.0:
        raise ProbeError(
            "REFLECTION_REQUIRED",
            "best orthogonal fit is a reflection; improper transforms are forbidden",
        )
    rotation = unconstrained_rotation
    scale = float(np.sum(singular_values) / source_variance)
    if not math.isfinite(scale) or scale <= 0:
        raise ProbeError("INVALID_SCALE", "similarity scale must be finite and positive")
    translation = target_mean - scale * (rotation @ source_mean)
    if not np.all(np.isfinite(translation)):
        raise ProbeError("NONFINITE_VALUE", "similarity translation is non-finite")
    return SimilarityTransform(scale, rotation, translation)


def residual_statistics(values: Sequence[float]) -> dict[str, Any]:
    array = np.asarray(values, dtype=np.float64)
    if array.ndim != 1 or array.size == 0:
        raise ProbeError("EMPTY_RESIDUALS", "residual statistics require at least one value")
    if not np.all(np.isfinite(array)) or np.any(array < 0):
        raise ProbeError("INVALID_RESIDUAL", "residuals must be finite and nonnegative")
    return {
        "count": int(array.size),
        "maximum": float(np.max(array)),
        "mean": float(np.mean(array)),
        "median": float(np.percentile(array, 50, method="linear")),
        "p95": float(np.percentile(array, 95, method="linear")),
        "rmse": float(np.sqrt(np.mean(array * array))),
    }


def evaluate_transform(
    transform: SimilarityTransform,
    source: np.ndarray,
    target: np.ndarray,
    sweep_indices: Sequence[int],
) -> dict[str, Any]:
    predicted = transform.apply(source)
    residuals = np.linalg.norm(predicted - target, axis=1)
    return {
        "perSweep": [
            {"residualMeters": float(residual), "sweepIndex": int(sweep)}
            for sweep, residual in zip(sweep_indices, residuals, strict=True)
        ],
        "statisticsMeters": residual_statistics(residuals),
    }


def _e57_scan_centers(e57_result: dict[str, Any]) -> dict[int, np.ndarray]:
    result: dict[int, np.ndarray] = {}
    for scan in e57_result["scans"]:
        index = int(scan["index"])
        pose = scan.get("pose")
        if pose is None:
            raise ProbeError("INVALID_E57_POSE", f"E57 scan {index} has no pose")
        translation = np.asarray(pose["translation"], dtype=np.float64)
        if translation.shape != (3,) or not np.all(np.isfinite(translation)):
            raise ProbeError("INVALID_E57_POSE", f"E57 scan {index} translation is invalid")
        result[index] = translation
    return result


def build_correspondences(
    image_records: Sequence[dict[str, Any]], e57_result: dict[str, Any]
) -> list[dict[str, Any]]:
    groups = group_sweep_records(image_records, ALL_FIT_SWEEPS)
    e57_centers = _e57_scan_centers(e57_result)
    missing_e57 = [index for index in ALL_FIT_SWEEPS if index not in e57_centers]
    if missing_e57:
        raise ProbeError("MISSING_E57_SWEEP", f"E57 lacks required sweeps {missing_e57}")
    correspondences: list[dict[str, Any]] = []
    for group in groups:
        centers: list[np.ndarray] = []
        face_centers: list[dict[str, Any]] = []
        for image in group["records"]:
            _, face = parse_sweep_name(image["name"])
            center = colmap_camera_center(image["qvecHamiltonWxyz"], image["tvec"])
            centers.append(center)
            face_centers.append(
                {
                    "centerColmapWorld": center.tolist(),
                    "face": face,
                    "imageName": image["name"],
                }
            )
        if not centers:
            raise ProbeError("MISSING_REGISTERED_SWEEP", f"sweep {group['sweepIndex']} has no registered face")
        colmap_mean = np.mean(np.stack(centers, axis=0), axis=0)
        sweep_index = int(group["sweepIndex"])
        correspondences.append(
            {
                "colmapFaceCenters": face_centers,
                "colmapMeanCameraCenter": colmap_mean.tolist(),
                "e57ScanCenter": e57_centers[sweep_index].tolist(),
                "registeredFaceCount": len(centers),
                "registeredFaces": group["presentFaces"],
                "sweepIndex": sweep_index,
            }
        )
    return correspondences


def _select_correspondences(
    correspondences: Sequence[dict[str, Any]], selected: Sequence[int]
) -> tuple[np.ndarray, np.ndarray]:
    by_sweep = {int(item["sweepIndex"]): item for item in correspondences}
    source = np.asarray([by_sweep[index]["colmapMeanCameraCenter"] for index in selected])
    target = np.asarray([by_sweep[index]["e57ScanCenter"] for index in selected])
    return source, target


def _documented_reproduction(
    source: np.ndarray, target: np.ndarray
) -> dict[str, Any]:
    transform = fit_similarity_umeyama(source, target)
    evaluation = evaluate_transform(transform, source, target, ALL_FIT_SWEEPS)
    statistics = evaluation["statisticsMeters"]
    documented_delta = {
        "maxMeters": statistics["maximum"] - DOCUMENTED_DIAGNOSTIC["maxMeters"],
        "medianMeters": statistics["median"] - DOCUMENTED_DIAGNOSTIC["medianMeters"],
        "p95Meters": statistics["p95"] - DOCUMENTED_DIAGNOSTIC["p95Meters"],
        "rmseMeters": statistics["rmse"] - DOCUMENTED_DIAGNOSTIC["rmseMeters"],
        "scale": transform.scale - DOCUMENTED_DIAGNOSTIC["scale"],
    }
    return {
        "evaluation": evaluation,
        "fitSweepIndices": list(ALL_FIT_SWEEPS),
        "reproductionDelta": documented_delta,
        "transform": transform.as_json(),
    }


def _phase1_candidate(correspondences: Sequence[dict[str, Any]]) -> dict[str, Any]:
    holdout_set = set(HELD_OUT_SWEEPS)
    training_sweeps = tuple(
        index for index in PHASE1_CANDIDATE_SWEEPS if index not in holdout_set
    )
    train_source, train_target = _select_correspondences(correspondences, training_sweeps)
    held_source, held_target = _select_correspondences(correspondences, HELD_OUT_SWEEPS)
    candidate_source, candidate_target = _select_correspondences(
        correspondences, PHASE1_CANDIDATE_SWEEPS
    )
    transform = fit_similarity_umeyama(train_source, train_target)
    return {
        "candidateSweepIndices": list(PHASE1_CANDIDATE_SWEEPS),
        "fitSweepIndices": list(training_sweeps),
        "heldOutEvaluation": evaluate_transform(
            transform, held_source, held_target, HELD_OUT_SWEEPS
        ),
        "heldOutSweepIndices": list(HELD_OUT_SWEEPS),
        "pilotEvaluation": evaluate_transform(
            transform, candidate_source, candidate_target, PHASE1_CANDIDATE_SWEEPS
        ),
        "trainingEvaluation": evaluate_transform(
            transform, train_source, train_target, training_sweeps
        ),
        "transform": transform.as_json(),
    }


def _alignment_input_evidence(
    e57: dict[str, Any], sparse: dict[str, Any]
) -> dict[str, Any]:
    sparse_evidence = {
        name: sparse[name]["evidence"] for name in ("cameras", "images", "points3D")
    }
    sparse_evidence.update(
        {
            name: sparse[name]["evidence"]
            for name in ("frames", "rigs")
            if sparse[name]["status"] == "parsed"
        }
    )
    return {
        "e57": {
            "adapter": e57["adapter"],
            "byteSize": e57["file"]["byteSize"],
            "imageCount": e57.get("imageCount"),
            "pointDataRead": e57["pointDataRead"],
            "scanCount": e57.get("scanCount"),
        },
        "sparseModel": sparse_evidence,
    }


def run_alignment(e57_path: Path, model_path: Path, adapter: E57MetadataAdapter | None = None) -> dict[str, Any]:
    e57 = inspect_e57_metadata(e57_path, adapter)
    sparse = inspect_sparse_model(model_path)
    correspondences = build_correspondences(sparse["images"]["records"], e57)
    all_source, all_target = _select_correspondences(correspondences, ALL_FIT_SWEEPS)
    return {
        "conventions": {
            "colmapCameraCenter": "C=-R^T*t",
            "colmapPose": "Hamilton qvec [w,x,y,z], world-to-camera",
            "correspondenceAggregation": "unweighted arithmetic mean of registered face camera centres per sweep",
            "e57ScanCenter": "data3D pose.translation in the E57 root frame",
            "matrixLayout": "4x4 column-major; target=scale*rotation*source+translation",
            "outlierRejection": "none",
            "percentileMethod": "linear",
            "reflectionPolicy": "forbidden; determinant(rotation) must be +1",
            "similarityMethod": "isotropic Umeyama/SVD, unweighted",
            "units": {"source": "COLMAP arbitrary units", "target": "E57 metres"},
        },
        "correspondences": correspondences,
        "documentedDiagnostic": {
            **DOCUMENTED_DIAGNOSTIC,
            "classification": "prior unreviewed diagnostic",
        },
        "fullFit": _documented_reproduction(all_source, all_target),
        "inputEvidence": _alignment_input_evidence(e57, sparse),
        "phase1CandidateWithHoldout": _phase1_candidate(correspondences),
        "runtimeVersions": runtime_versions(include_sqlite=False),
        "scope": {
            "documentedDiagnosticReproductionSweepIndices": list(ALL_FIT_SWEEPS),
            "excludedSweeps": [
                {
                    "disposition": "excluded_adjacent_space",
                    "sweepIndex": 49,
                    "use": "reproduction_only",
                }
            ],
            "phase1CandidateSweepIndices": list(PHASE1_CANDIDATE_SWEEPS),
        },
    }


def build_parser() -> JsonArgumentParser:
    parser = JsonArgumentParser(prog="foundry_phase1_probe.py")
    subparsers = parser.add_subparsers(dest="mode", required=True)
    e57_parser = subparsers.add_parser("inspect-e57")
    e57_parser.add_argument("--e57", type=Path, required=True)
    e57_aggregate_parser = subparsers.add_parser("inspect-e57-aggregate")
    e57_aggregate_parser.add_argument("--e57", type=Path, required=True)
    colmap_parser = subparsers.add_parser("inspect-colmap")
    colmap_parser.add_argument("--model", type=Path, required=True)
    colmap_parser.add_argument("--images", type=Path, required=True)
    colmap_parser.add_argument("--database", type=Path)
    align_parser = subparsers.add_parser("align")
    align_parser.add_argument("--e57", type=Path, required=True)
    align_parser.add_argument("--model", type=Path, required=True)
    return parser


def execute(argv: Sequence[str]) -> dict[str, Any]:
    arguments = build_parser().parse_args(list(argv))
    if arguments.mode == "inspect-e57":
        result = inspect_e57_metadata(arguments.e57)
    elif arguments.mode == "inspect-e57-aggregate":
        result = inspect_e57_aggregate(arguments.e57)
    elif arguments.mode == "inspect-colmap":
        result = inspect_colmap(arguments.model, arguments.images, arguments.database)
    elif arguments.mode == "align":
        result = run_alignment(arguments.e57, arguments.model)
    else:
        raise ProbeError("INVALID_ARGUMENTS", "unknown mode")
    return {"mode": arguments.mode, "result": result, "schemaVersion": SCHEMA_VERSION, "status": "ok"}


def main(argv: Sequence[str] | None = None) -> int:
    selected_argv = list(sys.argv[1:] if argv is None else argv)
    mode = selected_argv[0] if selected_argv else "unknown"
    try:
        document = execute(selected_argv)
        exit_code = 0
    except ProbeError as error:
        document = {
            "error": {"code": error.code, "message": error.message},
            "mode": mode,
            "schemaVersion": SCHEMA_VERSION,
            "status": "error",
        }
        exit_code = 2
    except (OSError, ValueError) as error:
        document = {
            "error": {"code": "UNEXPECTED_INPUT_ERROR", "message": str(error)},
            "mode": mode,
            "schemaVersion": SCHEMA_VERSION,
            "status": "error",
        }
        exit_code = 2
    except Exception as error:
        document = {
            "error": {
                "code": "INTERNAL_ERROR",
                "message": f"unexpected {type(error).__name__}",
            },
            "mode": mode,
            "schemaVersion": SCHEMA_VERSION,
            "status": "error",
        }
        exit_code = 2
    sys.stdout.write(canonical_json_line(document))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
