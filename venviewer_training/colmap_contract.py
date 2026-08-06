"""Deterministic, CPU-only validation for a COLMAP training fixture.

This module validates the *shape* of a training input without importing
PyTorch, gsplat, pycolmap, or any provider SDK.  It intentionally does not
train a model, contact a network service, or produce a D-014 candidate.

The contract is deliberately narrower than "COLMAP can read this directory":

* the three standard sparse-model binary files must be bounded and internally
  consistent;
* SIMPLE_PINHOLE and PINHOLE are the only accepted camera models;
* every registered source image and factor-specific runtime image must have an
  exact safe mapping and dimensions matching the pinned parser;
* ``splits.json`` must exactly record gsplat's sorted-index modulo split; and
* when depth is required, every training image must have one exact sparse-depth
  NPZ while held-out images must have none.

The returned value contains only JSON-ready, deterministic data.  It has no
timestamps, generated identifiers, or absolute host paths.
"""

from __future__ import annotations

import binascii
import hashlib
import io
import json
import math
import os
import re
import struct
import warnings
import zipfile
import zlib
from dataclasses import dataclass
from numbers import Integral
from pathlib import Path, PurePosixPath
from typing import Any, Iterable, Sequence

import numpy as np


MAX_CAMERAS_BINARY_BYTES = 16 * 1024 * 1024
MAX_IMAGES_BINARY_BYTES = 256 * 1024 * 1024
MAX_POINTS3D_BINARY_BYTES = 512 * 1024 * 1024
MAX_SPLITS_BYTES = 1 * 1024 * 1024
MAX_IMAGE_BYTES = 256 * 1024 * 1024
MAX_DECODED_IMAGE_BYTES = 512 * 1024 * 1024
MAX_DEPTH_NPZ_BYTES = 128 * 1024 * 1024
MAX_DEPTH_UNCOMPRESSED_BYTES = 256 * 1024 * 1024

MAX_CAMERAS = 100_000
MAX_IMAGES = 1_000_000
MAX_POINTS3D = 10_000_000
MAX_OBSERVATIONS_PER_IMAGE = 10_000_000
MAX_TRACK_LENGTH = 1_000_000
MAX_IMAGE_NAME_BYTES = 1_024
MAX_IMAGE_COMPONENT_BYTES = 255
MAX_IMAGE_DIMENSION = 1_000_000
MAX_IMAGE_PIXELS = 1_000_000_000
MAX_DEPTH_SAMPLES = 10_000_000
QUATERNION_NORM_TOLERANCE = 1e-5

_DEPTH_KEYS = frozenset({"uv", "depth_m", "width", "height"})
_DEPTH_ARCHIVE_NAMES = frozenset(f"{name}.npy" for name in _DEPTH_KEYS)
_WINDOWS_RESERVED_COMPONENT = re.compile(
    r"^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$", re.IGNORECASE
)


# COLMAP model ids and parameter counts.  This includes the newer models so a
# bounded parser does not silently lose byte alignment when it encounters one.
_CAMERA_MODELS: dict[int, tuple[str, int, tuple[int, ...], tuple[int, int]]] = {
    0: ("SIMPLE_PINHOLE", 3, (0,), (1, 2)),
    1: ("PINHOLE", 4, (0, 1), (2, 3)),
    2: ("SIMPLE_RADIAL", 4, (0,), (1, 2)),
    3: ("RADIAL", 5, (0,), (1, 2)),
    4: ("OPENCV", 8, (0, 1), (2, 3)),
    5: ("OPENCV_FISHEYE", 8, (0, 1), (2, 3)),
    6: ("FULL_OPENCV", 12, (0, 1), (2, 3)),
    7: ("FOV", 5, (0, 1), (2, 3)),
    8: ("SIMPLE_RADIAL_FISHEYE", 4, (0,), (1, 2)),
    9: ("RADIAL_FISHEYE", 5, (0,), (1, 2)),
    10: ("THIN_PRISM_FISHEYE", 12, (0, 1), (2, 3)),
    11: ("RAD_TAN_THIN_PRISM_FISHEYE", 16, (0, 1), (2, 3)),
    12: ("SIMPLE_DIVISION", 4, (0,), (1, 2)),
    13: ("DIVISION", 5, (0,), (1, 2)),
    14: ("SIMPLE_FISHEYE", 3, (0,), (1, 2)),
    15: ("FISHEYE", 4, (0, 1), (2, 3)),
    16: ("EUCM", 6, (0, 1), (2, 3)),
}
_EXTERNAL_DEPTH_CAMERA_MODEL_IDS = frozenset({0, 1})


class ColmapContractError(ValueError):
    """Stable validation failure with a machine-readable code."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def resolve_split_image_name(
    image_names: Sequence[str], split_indices: Sequence[int], item: int
) -> str:
    """Resolve a split-local item to its underlying registered image name.

    gsplat's dataset first maps ``item`` through ``self.indices``.  Resolving
    ``image_names[item]`` directly is wrong whenever held-outs are interleaved.
    This helper makes that two-step lookup explicit and independently testable.
    """

    if isinstance(image_names, (str, bytes)) or isinstance(split_indices, (str, bytes)):
        raise ColmapContractError(
            "INVALID_SPLIT_INDEX", "image names and split indices must be sequences"
        )
    if isinstance(item, bool) or not isinstance(item, Integral):
        raise ColmapContractError("INVALID_SPLIT_ITEM", "split item must be an integer")
    item = int(item)
    if item < 0 or item >= len(split_indices):
        raise ColmapContractError(
            "INVALID_SPLIT_ITEM",
            f"split item {item} is outside 0..{len(split_indices) - 1}",
        )
    dataset_index = split_indices[item]
    if isinstance(dataset_index, bool) or not isinstance(dataset_index, Integral):
        raise ColmapContractError(
            "INVALID_SPLIT_INDEX", "split indices must contain only integers"
        )
    dataset_index = int(dataset_index)
    if dataset_index < 0 or dataset_index >= len(image_names):
        raise ColmapContractError(
            "INVALID_SPLIT_INDEX",
            f"dataset index {dataset_index} is outside 0..{len(image_names) - 1}",
        )
    name = image_names[dataset_index]
    if not isinstance(name, str) or not name:
        raise ColmapContractError(
            "INVALID_IMAGE_NAME", "resolved image name must be a non-empty string"
        )
    return name


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _file_identity(stat_result: os.stat_result) -> tuple[int, int, int, int]:
    return (
        int(stat_result.st_dev),
        int(stat_result.st_ino),
        int(stat_result.st_size),
        int(stat_result.st_mtime_ns),
    )


def _read_bounded_regular_file(path: Path, limit: int, label: str) -> bytes:
    if path.is_symlink():
        raise ColmapContractError("UNSAFE_FILE", f"{label} must not be a symlink")
    if not path.exists():
        raise ColmapContractError("MISSING_FILE", f"missing required file: {label}")
    if not path.is_file():
        raise ColmapContractError("UNSAFE_FILE", f"{label} must be a regular file")
    try:
        before = path.stat()
    except OSError as error:
        raise ColmapContractError(
            "READ_FAILED", f"could not stat {label}: {error}"
        ) from error
    if before.st_size > limit:
        raise ColmapContractError(
            "FILE_TOO_LARGE", f"{label} exceeds the {limit}-byte safety limit"
        )
    try:
        data = path.read_bytes()
        after = path.stat()
    except OSError as error:
        raise ColmapContractError(
            "READ_FAILED", f"could not read {label}: {error}"
        ) from error
    if len(data) != before.st_size or _file_identity(before) != _file_identity(after):
        raise ColmapContractError("FILE_CHANGED", f"{label} changed while it was read")
    return data


@dataclass
class _BinaryReader:
    label: str
    data: bytes
    offset: int = 0

    @property
    def remaining(self) -> int:
        return len(self.data) - self.offset

    def unpack(self, format_characters: str, description: str) -> tuple[Any, ...]:
        parser = struct.Struct("<" + format_characters)
        if parser.size > self.remaining:
            raise ColmapContractError(
                "TRUNCATED_COLMAP_BINARY",
                f"{self.label} is truncated while reading {description} at byte {self.offset}",
            )
        values = parser.unpack_from(self.data, self.offset)
        self.offset += parser.size
        return values

    def count(
        self,
        *,
        maximum: int,
        minimum_record_bytes: int,
        description: str,
    ) -> int:
        (value,) = self.unpack("Q", f"{description} count")
        count = int(value)
        if count > maximum:
            raise ColmapContractError(
                "MALICIOUS_COUNT", f"{self.label} {description} count exceeds {maximum}"
            )
        if count > self.remaining // minimum_record_bytes:
            raise ColmapContractError(
                "TRUNCATED_COLMAP_BINARY",
                f"{self.label} cannot contain its declared {description} count",
            )
        return count

    def cstring(self, description: str) -> str:
        end_limit = min(len(self.data), self.offset + MAX_IMAGE_NAME_BYTES + 1)
        end = self.data.find(b"\0", self.offset, end_limit)
        if end < 0:
            raise ColmapContractError(
                "INVALID_IMAGE_NAME",
                f"{self.label} {description} is not NUL-terminated within "
                f"{MAX_IMAGE_NAME_BYTES} bytes",
            )
        raw = self.data[self.offset : end]
        self.offset = end + 1
        try:
            return raw.decode("utf-8", errors="strict")
        except UnicodeDecodeError as error:
            raise ColmapContractError(
                "INVALID_IMAGE_NAME", f"{self.label} {description} is not valid UTF-8"
            ) from error

    def finish(self) -> None:
        if self.remaining != 0:
            raise ColmapContractError(
                "TRAILING_COLMAP_BYTES",
                f"{self.label} has {self.remaining} unexplained trailing bytes",
            )


def _finite(values: Iterable[float], label: str) -> None:
    if not all(math.isfinite(float(value)) for value in values):
        raise ColmapContractError(
            "NONFINITE_VALUE", f"{label} contains a non-finite value"
        )


def _validate_positive_id(value: int, label: str) -> None:
    if value <= 0:
        raise ColmapContractError("INVALID_ID", f"{label} must be positive")


def _validate_image_name(name: str) -> str:
    if not name:
        raise ColmapContractError("INVALID_IMAGE_NAME", "image name must not be empty")
    if len(name.encode("utf-8")) > MAX_IMAGE_NAME_BYTES:
        raise ColmapContractError(
            "INVALID_IMAGE_NAME",
            f"image name exceeds {MAX_IMAGE_NAME_BYTES} UTF-8 bytes",
        )
    if "\\" in name or name.startswith("/") or re.match(r"^[A-Za-z]:", name):
        raise ColmapContractError(
            "UNSAFE_IMAGE_NAME", f"image name is not a portable relative path: {name!r}"
        )
    path = PurePosixPath(name)
    if path.is_absolute() or not path.parts or path.as_posix() != name:
        raise ColmapContractError("UNSAFE_IMAGE_NAME", f"unsafe image name: {name!r}")
    for component in path.parts:
        encoded = component.encode("utf-8")
        if (
            component in {"", ".", ".."}
            or len(encoded) > MAX_IMAGE_COMPONENT_BYTES
            or component.endswith((" ", "."))
            or any(ord(character) < 32 for character in component)
            or any(character in '<>:"|?*' for character in component)
            or _WINDOWS_RESERVED_COMPONENT.match(component) is not None
        ):
            raise ColmapContractError(
                "UNSAFE_IMAGE_NAME", f"unsafe image path component {component!r}"
            )
    return path.as_posix()


def _parse_cameras(data: bytes) -> list[dict[str, Any]]:
    reader = _BinaryReader("cameras.bin", data)
    count = reader.count(
        maximum=MAX_CAMERAS,
        minimum_record_bytes=48,
        description="camera",
    )
    if count == 0:
        raise ColmapContractError("EMPTY_CAMERAS", "cameras.bin contains no cameras")
    records: list[dict[str, Any]] = []
    ids: set[int] = set()
    for position in range(count):
        camera_id, model_id, width, height = reader.unpack(
            "iiQQ", f"camera record {position} header"
        )
        camera_id = int(camera_id)
        model_id = int(model_id)
        width = int(width)
        height = int(height)
        _validate_positive_id(camera_id, "camera_id")
        if camera_id in ids:
            raise ColmapContractError(
                "DUPLICATE_CAMERA_ID", f"duplicate camera_id {camera_id}"
            )
        ids.add(camera_id)
        model = _CAMERA_MODELS.get(model_id)
        if model is None:
            raise ColmapContractError(
                "UNKNOWN_CAMERA_MODEL",
                f"camera {camera_id} uses unknown model id {model_id}",
            )
        model_name, parameter_count, focal_indices, principal_indices = model
        if model_id not in _EXTERNAL_DEPTH_CAMERA_MODEL_IDS:
            raise ColmapContractError(
                "UNSUPPORTED_CAMERA_MODEL",
                f"camera {camera_id} uses {model_name}; the external-depth contract "
                "supports only SIMPLE_PINHOLE and PINHOLE",
            )
        params = [
            float(value)
            for value in reader.unpack(
                "d" * parameter_count, f"camera {camera_id} parameters"
            )
        ]
        _finite(params, f"camera {camera_id} parameters")
        if (
            width <= 0
            or height <= 0
            or width > MAX_IMAGE_DIMENSION
            or height > MAX_IMAGE_DIMENSION
            or width * height > MAX_IMAGE_PIXELS
        ):
            raise ColmapContractError(
                "INVALID_CAMERA_DIMENSIONS",
                f"camera {camera_id} has unsafe dimensions {width}x{height}",
            )
        if any(params[index] <= 0 for index in focal_indices):
            raise ColmapContractError(
                "INVALID_CAMERA_INTRINSICS",
                f"camera {camera_id} focal length must be positive",
            )
        cx, cy = (params[principal_indices[0]], params[principal_indices[1]])
        if not (0.0 <= cx <= float(width) and 0.0 <= cy <= float(height)):
            raise ColmapContractError(
                "INVALID_CAMERA_INTRINSICS",
                f"camera {camera_id} principal point ({cx}, {cy}) is outside {width}x{height}",
            )
        records.append(
            {
                "cameraId": camera_id,
                "modelId": model_id,
                "model": model_name,
                "width": width,
                "height": height,
                "params": params,
            }
        )
    reader.finish()
    return sorted(records, key=lambda item: item["cameraId"])


def _parse_images(data: bytes) -> list[dict[str, Any]]:
    reader = _BinaryReader("images.bin", data)
    count = reader.count(
        maximum=MAX_IMAGES,
        minimum_record_bytes=73,
        description="image",
    )
    if count < 2:
        raise ColmapContractError(
            "TOO_FEW_IMAGES", "a training contract needs at least two registered images"
        )
    records: list[dict[str, Any]] = []
    ids: set[int] = set()
    exact_names: set[str] = set()
    folded_names: set[str] = set()
    for position in range(count):
        values = reader.unpack("i7di", f"image record {position} header")
        image_id = int(values[0])
        qvec = [float(value) for value in values[1:5]]
        tvec = [float(value) for value in values[5:8]]
        camera_id = int(values[8])
        _validate_positive_id(image_id, "image_id")
        _validate_positive_id(camera_id, "image camera_id")
        if image_id in ids:
            raise ColmapContractError(
                "DUPLICATE_IMAGE_ID", f"duplicate image_id {image_id}"
            )
        ids.add(image_id)
        _finite(qvec, f"image {image_id} quaternion")
        _finite(tvec, f"image {image_id} translation")
        qnorm = math.sqrt(sum(value * value for value in qvec))
        if not math.isclose(qnorm, 1.0, rel_tol=0.0, abs_tol=QUATERNION_NORM_TOLERANCE):
            raise ColmapContractError(
                "INVALID_QUATERNION",
                f"image {image_id} quaternion norm {qnorm} is not 1 within "
                f"{QUATERNION_NORM_TOLERANCE}",
            )
        name = _validate_image_name(reader.cstring(f"image {image_id} name"))
        folded = name.casefold()
        if name in exact_names or folded in folded_names:
            raise ColmapContractError(
                "DUPLICATE_IMAGE_NAME",
                f"duplicate or case-ambiguous image name {name!r}",
            )
        exact_names.add(name)
        folded_names.add(folded)
        observation_count = reader.count(
            maximum=MAX_OBSERVATIONS_PER_IMAGE,
            minimum_record_bytes=24,
            description=f"image {image_id} observation",
        )
        observations: list[dict[str, Any]] = []
        for observation_index in range(observation_count):
            x, y, point3d_id = reader.unpack(
                "ddq", f"image {image_id} observation {observation_index}"
            )
            x = float(x)
            y = float(y)
            point3d_id = int(point3d_id)
            _finite((x, y), f"image {image_id} observation {observation_index}")
            if point3d_id < -1:
                raise ColmapContractError(
                    "INVALID_POINT_REFERENCE",
                    f"image {image_id} observation {observation_index} has invalid point id {point3d_id}",
                )
            observations.append({"x": x, "y": y, "point3DId": point3d_id})
        records.append(
            {
                "imageId": image_id,
                "cameraId": camera_id,
                "name": name,
                "qvec": qvec,
                "tvec": tvec,
                "observations": observations,
            }
        )
    reader.finish()
    return records


def _parse_points3d(data: bytes) -> list[dict[str, Any]]:
    reader = _BinaryReader("points3D.bin", data)
    count = reader.count(
        maximum=MAX_POINTS3D,
        minimum_record_bytes=51,
        description="3D point",
    )
    if count == 0:
        raise ColmapContractError(
            "EMPTY_POINTS3D", "points3D.bin contains no sparse initialization points"
        )
    records: list[dict[str, Any]] = []
    ids: set[int] = set()
    for position in range(count):
        values = reader.unpack("QdddBBBd", f"3D point record {position}")
        point_id = int(values[0])
        xyz = [float(value) for value in values[1:4]]
        rgb = [int(value) for value in values[4:7]]
        error = float(values[7])
        _validate_positive_id(point_id, "point3D_id")
        if point_id in ids:
            raise ColmapContractError(
                "DUPLICATE_POINT_ID", f"duplicate point3D_id {point_id}"
            )
        ids.add(point_id)
        _finite((*xyz, error), f"3D point {point_id}")
        if error < 0:
            raise ColmapContractError(
                "INVALID_POINT_ERROR",
                f"3D point {point_id} has negative reprojection error",
            )
        track_count = reader.count(
            maximum=MAX_TRACK_LENGTH,
            minimum_record_bytes=8,
            description=f"3D point {point_id} track",
        )
        if track_count == 0:
            raise ColmapContractError(
                "EMPTY_POINT_TRACK", f"3D point {point_id} has no image observations"
            )
        track: list[dict[str, int]] = []
        seen_track_entries: set[tuple[int, int]] = set()
        for track_position in range(track_count):
            image_id, observation_index = reader.unpack(
                "ii", f"3D point {point_id} track entry {track_position}"
            )
            image_id = int(image_id)
            observation_index = int(observation_index)
            _validate_positive_id(image_id, "track image_id")
            if observation_index < 0:
                raise ColmapContractError(
                    "INVALID_TRACK_INDEX",
                    f"3D point {point_id} has negative observation index",
                )
            key = (image_id, observation_index)
            if key in seen_track_entries:
                raise ColmapContractError(
                    "DUPLICATE_TRACK_ENTRY",
                    f"3D point {point_id} repeats track entry {key}",
                )
            seen_track_entries.add(key)
            track.append({"imageId": image_id, "observationIndex": observation_index})
        records.append(
            {
                "point3DId": point_id,
                "xyz": xyz,
                "rgb": rgb,
                "error": error,
                "track": track,
            }
        )
    reader.finish()
    return records


def _validate_sparse_references(
    cameras: list[dict[str, Any]],
    images: list[dict[str, Any]],
    points: list[dict[str, Any]],
) -> None:
    cameras_by_id = {record["cameraId"]: record for record in cameras}
    images_by_id = {record["imageId"]: record for record in images}
    points_by_id = {record["point3DId"]: record for record in points}
    referenced_camera_ids: set[int] = set()
    for image in images:
        camera = cameras_by_id.get(image["cameraId"])
        if camera is None:
            raise ColmapContractError(
                "MISSING_CAMERA_REFERENCE",
                f"image {image['imageId']} references absent camera {image['cameraId']}",
            )
        referenced_camera_ids.add(image["cameraId"])
        for observation_index, observation in enumerate(image["observations"]):
            if not (
                0.0 <= observation["x"] < camera["width"]
                and 0.0 <= observation["y"] < camera["height"]
            ):
                raise ColmapContractError(
                    "OBSERVATION_OUT_OF_BOUNDS",
                    f"image {image['imageId']} observation {observation_index} is outside "
                    f"camera {camera['cameraId']} dimensions",
                )
            point_id = observation["point3DId"]
            if point_id == -1:
                continue
            point = points_by_id.get(point_id)
            if point is None:
                raise ColmapContractError(
                    "MISSING_POINT_REFERENCE",
                    f"image {image['imageId']} references absent 3D point {point_id}",
                )
            expected = {
                "imageId": image["imageId"],
                "observationIndex": observation_index,
            }
            if expected not in point["track"]:
                raise ColmapContractError(
                    "INCONSISTENT_POINT_TRACK",
                    f"3D point {point_id} does not link back to image {image['imageId']} "
                    f"observation {observation_index}",
                )
    for point in points:
        for track_entry in point["track"]:
            image = images_by_id.get(track_entry["imageId"])
            if image is None:
                raise ColmapContractError(
                    "MISSING_TRACK_IMAGE",
                    f"3D point {point['point3DId']} track references absent image "
                    f"{track_entry['imageId']}",
                )
            observation_index = track_entry["observationIndex"]
            if observation_index >= len(image["observations"]):
                raise ColmapContractError(
                    "INVALID_TRACK_INDEX",
                    f"3D point {point['point3DId']} track index {observation_index} is outside "
                    f"image {image['imageId']} observations",
                )
            if (
                image["observations"][observation_index]["point3DId"]
                != point["point3DId"]
            ):
                raise ColmapContractError(
                    "INCONSISTENT_POINT_TRACK",
                    f"3D point {point['point3DId']} track and image {image['imageId']} disagree",
                )
    unreferenced_cameras = sorted(set(cameras_by_id) - referenced_camera_ids)
    if unreferenced_cameras:
        raise ColmapContractError(
            "UNREFERENCED_CAMERA",
            f"camera records are not referenced by any registered image: {unreferenced_cameras}",
        )


def _png_dimensions(data: bytes, label: str) -> tuple[int, int]:
    signature = b"\x89PNG\r\n\x1a\n"
    if not data.startswith(signature):
        raise ColmapContractError("INVALID_IMAGE", f"{label} is not a PNG file")
    offset = len(signature)
    ihdr: tuple[int, int] | None = None
    ihdr_encoding: tuple[int, int, int] | None = None
    idat_parts: list[bytes] = []
    saw_idat = False
    saw_iend = False
    chunk_index = 0
    while offset < len(data):
        if len(data) - offset < 12:
            raise ColmapContractError(
                "INVALID_IMAGE", f"{label} has a truncated PNG chunk"
            )
        length = struct.unpack_from(">I", data, offset)[0]
        chunk_type = data[offset + 4 : offset + 8]
        chunk_end = offset + 12 + length
        if chunk_end > len(data):
            raise ColmapContractError(
                "INVALID_IMAGE", f"{label} has a truncated PNG payload"
            )
        payload = data[offset + 8 : offset + 8 + length]
        expected_crc = struct.unpack_from(">I", data, offset + 8 + length)[0]
        actual_crc = zlib.crc32(chunk_type + payload) & 0xFFFFFFFF
        if expected_crc != actual_crc:
            raise ColmapContractError("INVALID_IMAGE", f"{label} has a bad PNG CRC")
        if chunk_index == 0 and chunk_type != b"IHDR":
            raise ColmapContractError(
                "INVALID_IMAGE", f"{label} PNG does not start with IHDR"
            )
        if chunk_type == b"IHDR":
            if ihdr is not None or length != 13:
                raise ColmapContractError(
                    "INVALID_IMAGE", f"{label} has an invalid PNG IHDR"
                )
            width, height, bit_depth, color_type, compression, filtering, interlace = (
                struct.unpack(">IIBBBBB", payload)
            )
            valid_depths = {
                2: {8},
                6: {8},
            }
            if (
                width <= 0
                or height <= 0
                or color_type not in valid_depths
                or bit_depth not in valid_depths[color_type]
                or compression != 0
                or filtering != 0
                or interlace != 0
            ):
                raise ColmapContractError(
                    "INVALID_IMAGE",
                    f"{label} must be a non-interlaced 8-bit RGB or RGBA PNG",
                )
            ihdr = (int(width), int(height))
            ihdr_encoding = (int(bit_depth), int(color_type), int(interlace))
        elif chunk_type == b"IDAT":
            saw_idat = True
            idat_parts.append(payload)
        elif chunk_type == b"IEND":
            if length != 0:
                raise ColmapContractError(
                    "INVALID_IMAGE", f"{label} has an invalid PNG IEND"
                )
            saw_iend = True
            offset = chunk_end
            break
        offset = chunk_end
        chunk_index += 1
    if (
        ihdr is None
        or ihdr_encoding is None
        or not saw_idat
        or not saw_iend
        or offset != len(data)
    ):
        raise ColmapContractError(
            "INVALID_IMAGE", f"{label} is not a complete PNG file"
        )
    decoder = zlib.decompressobj()
    try:
        decoded = decoder.decompress(b"".join(idat_parts), MAX_DECODED_IMAGE_BYTES + 1)
    except zlib.error as error:
        raise ColmapContractError(
            "INVALID_IMAGE", f"{label} has invalid PNG image data"
        ) from error
    if (
        len(decoded) > MAX_DECODED_IMAGE_BYTES
        or decoder.unconsumed_tail
        or not decoder.eof
        or decoder.unused_data
    ):
        raise ColmapContractError(
            "INVALID_IMAGE",
            f"{label} PNG image data is incomplete or exceeds the decode limit",
        )
    bit_depth, color_type, interlace = ihdr_encoding
    if interlace == 0:
        channels = {2: 3, 6: 4}[color_type]
        row_bytes = (ihdr[0] * channels * bit_depth + 7) // 8
        expected_bytes = ihdr[1] * (row_bytes + 1)
        if len(decoded) != expected_bytes:
            raise ColmapContractError(
                "INVALID_IMAGE",
                f"{label} PNG decoded byte count does not match its dimensions",
            )
        for offset in range(0, len(decoded), row_bytes + 1):
            if decoded[offset] > 4:
                raise ColmapContractError(
                    "INVALID_IMAGE", f"{label} uses an invalid PNG row filter"
                )
    _verify_pillow_decode(data, label, ihdr, expected_format="PNG")
    return ihdr


_JPEG_SOF_MARKERS = frozenset(
    {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
)


def _jpeg_marker(data: bytes, offset: int, label: str) -> tuple[int, int]:
    if offset >= len(data) or data[offset] != 0xFF:
        raise ColmapContractError(
            "INVALID_IMAGE", f"{label} has malformed JPEG markers"
        )
    while offset < len(data) and data[offset] == 0xFF:
        offset += 1
    if offset >= len(data) or data[offset] == 0x00:
        raise ColmapContractError(
            "INVALID_IMAGE", f"{label} has a truncated JPEG marker"
        )
    return int(data[offset]), offset + 1


def _jpeg_entropy_end(data: bytes, offset: int, label: str) -> int:
    """Find the next non-stuffed, non-restart marker in entropy data."""

    while offset < len(data):
        marker_start = data.find(b"\xff", offset)
        if marker_start < 0:
            break
        cursor = marker_start + 1
        while cursor < len(data) and data[cursor] == 0xFF:
            cursor += 1
        if cursor >= len(data):
            break
        marker = data[cursor]
        if marker == 0x00 or 0xD0 <= marker <= 0xD7:
            offset = cursor + 1
            continue
        return marker_start
    raise ColmapContractError("INVALID_IMAGE", f"{label} has an unterminated JPEG scan")


def _verify_pillow_decode(
    data: bytes,
    label: str,
    expected_dimensions: tuple[int, int],
    *,
    expected_format: str,
) -> None:
    width, height = expected_dimensions
    if width * height * 4 > MAX_DECODED_IMAGE_BYTES:
        raise ColmapContractError(
            "INVALID_IMAGE", f"{label} exceeds the decoded-image safety limit"
        )
    try:
        from PIL import Image, ImageFile
    except ImportError as error:
        raise ColmapContractError(
            "IMAGE_DECODER_UNAVAILABLE",
            "Pillow is required to verify encoded image data",
        ) from error
    if ImageFile.LOAD_TRUNCATED_IMAGES:
        raise ColmapContractError(
            "IMAGE_DECODER_UNSAFE", "Pillow truncated-image loading must be disabled"
        )
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                if image.format != expected_format or image.size != expected_dimensions:
                    raise ColmapContractError(
                        "INVALID_IMAGE",
                        f"{label} decoder metadata disagrees with its header",
                    )
                image.load()
                pixels = np.asarray(image)
                if (
                    image.mode not in {"RGB", "RGBA"}
                    or pixels.dtype != np.dtype(np.uint8)
                    or pixels.ndim != 3
                    or pixels.shape[:2] != (height, width)
                    or pixels.shape[2] not in {3, 4}
                ):
                    raise ColmapContractError(
                        "UNSUPPORTED_IMAGE_ENCODING",
                        f"{label} must decode as 8-bit RGB or RGBA for gsplat v1.5.3",
                    )
    except ColmapContractError:
        raise
    except (
        OSError,
        ValueError,
        SyntaxError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ) as error:
        raise ColmapContractError(
            "INVALID_IMAGE", f"{label} pixels could not be decoded"
        ) from error


def _jpeg_dimensions(data: bytes, label: str) -> tuple[int, int]:
    if len(data) < 4 or data[:2] != b"\xff\xd8":
        raise ColmapContractError("INVALID_IMAGE", f"{label} is not a JPEG file")
    offset = 2
    dimensions: tuple[int, int] | None = None
    saw_scan = False
    while offset < len(data):
        marker, marker_end = _jpeg_marker(data, offset, label)
        offset = marker_end
        if marker == 0xD9:
            if not saw_scan or dimensions is None or offset != len(data):
                raise ColmapContractError(
                    "INVALID_IMAGE", f"{label} has an early JPEG EOI or trailing bytes"
                )
            _verify_pillow_decode(data, label, dimensions, expected_format="JPEG")
            return dimensions
        if marker in {0x01, 0xD8} or 0xD0 <= marker <= 0xD7:
            raise ColmapContractError(
                "INVALID_IMAGE",
                f"{label} has a standalone JPEG marker outside scan data",
            )
        if offset + 2 > len(data):
            raise ColmapContractError(
                "INVALID_IMAGE", f"{label} has a truncated JPEG segment"
            )
        segment_length = int(struct.unpack_from(">H", data, offset)[0])
        segment_end = offset + segment_length
        if segment_length < 2 or segment_end > len(data):
            raise ColmapContractError(
                "INVALID_IMAGE", f"{label} has an invalid JPEG segment"
            )
        if marker in _JPEG_SOF_MARKERS:
            if segment_length < 8:
                raise ColmapContractError(
                    "INVALID_IMAGE", f"{label} has an invalid JPEG SOF"
                )
            height, width = struct.unpack_from(">HH", data, offset + 3)
            component_count = int(data[offset + 7])
            if (
                width <= 0
                or height <= 0
                or component_count <= 0
                or segment_length != 8 + 3 * component_count
            ):
                raise ColmapContractError(
                    "INVALID_IMAGE", f"{label} has an invalid JPEG SOF"
                )
            candidate = (int(width), int(height))
            if dimensions is not None and dimensions != candidate:
                raise ColmapContractError(
                    "INVALID_IMAGE", f"{label} has conflicting JPEG dimensions"
                )
            dimensions = candidate
        if marker == 0xDA:
            component_count = int(data[offset + 2]) if segment_length >= 3 else 0
            if component_count <= 0 or segment_length != 6 + 2 * component_count:
                raise ColmapContractError(
                    "INVALID_IMAGE", f"{label} has an invalid JPEG SOS"
                )
            saw_scan = True
            offset = _jpeg_entropy_end(data, segment_end, label)
        else:
            offset = segment_end
    raise ColmapContractError(
        "INVALID_IMAGE", f"{label} has no complete JPEG scan and EOI"
    )


def _encoded_image_dimensions(data: bytes, name: str) -> tuple[int, int]:
    suffix = PurePosixPath(name).suffix.casefold()
    if suffix == ".png":
        return _png_dimensions(data, name)
    if suffix in {".jpg", ".jpeg"}:
        return _jpeg_dimensions(data, name)
    raise ColmapContractError(
        "UNSUPPORTED_IMAGE_FORMAT",
        f"{name!r} must be a PNG or JPEG for deterministic dimension validation",
    )


def _reject_duplicate_json_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ColmapContractError(
                "INVALID_SPLITS", f"splits.json repeats key {key!r}"
            )
        result[key] = value
    return result


def _reject_json_constant(value: str) -> None:
    raise ColmapContractError(
        "INVALID_SPLITS", f"splits.json contains invalid number {value}"
    )


def _parse_splits(
    data: bytes,
    registered_names: set[str],
    *,
    test_every: int,
) -> dict[str, list[str]]:
    try:
        text = data.decode("utf-8", errors="strict")
    except UnicodeDecodeError as error:
        raise ColmapContractError(
            "INVALID_SPLITS", "splits.json is not valid UTF-8"
        ) from error
    if text.startswith("\ufeff"):
        raise ColmapContractError(
            "INVALID_SPLITS", "splits.json must not contain a byte-order mark"
        )
    try:
        payload = json.loads(
            text,
            object_pairs_hook=_reject_duplicate_json_keys,
            parse_constant=_reject_json_constant,
        )
    except ColmapContractError:
        raise
    except json.JSONDecodeError as error:
        raise ColmapContractError(
            "INVALID_SPLITS", f"splits.json is invalid JSON: {error.msg}"
        ) from error
    if not isinstance(payload, dict) or set(payload) != {"train", "heldout"}:
        raise ColmapContractError(
            "INVALID_SPLITS", "splits.json must contain exactly 'train' and 'heldout'"
        )
    normalized: dict[str, list[str]] = {}
    for split_name in ("train", "heldout"):
        value = payload[split_name]
        if not isinstance(value, list) or not value:
            raise ColmapContractError(
                "INVALID_SPLITS", f"splits.json {split_name} must be a non-empty list"
            )
        names: list[str] = []
        folded: set[str] = set()
        for raw_name in value:
            if not isinstance(raw_name, str):
                raise ColmapContractError(
                    "INVALID_SPLITS", f"splits.json {split_name} names must be strings"
                )
            name = _validate_image_name(raw_name)
            if name.casefold() in folded:
                raise ColmapContractError(
                    "INVALID_SPLITS", f"splits.json {split_name} repeats {name!r}"
                )
            folded.add(name.casefold())
            names.append(name)
        normalized[split_name] = names
    train = set(normalized["train"])
    heldout = set(normalized["heldout"])
    overlap = sorted(train & heldout)
    if overlap:
        raise ColmapContractError(
            "HELDOUT_LEAKAGE", f"images appear in both train and heldout: {overlap}"
        )
    supplied = train | heldout
    if supplied != registered_names:
        missing = sorted(registered_names - supplied)
        extra = sorted(supplied - registered_names)
        raise ColmapContractError(
            "INCOMPLETE_SPLITS",
            f"splits must cover registered images exactly; missing={missing}, extra={extra}",
        )

    # gsplat v1.5.3 sorts COLMAP image names, assigns those sorted positions
    # as dataset indices, and holds out index % test_every == 0.  splits.json
    # is evidence of that runtime rule; it is not a user-defined split.
    ordered_names = sorted(registered_names)
    expected = {
        "train": [
            name for index, name in enumerate(ordered_names) if index % test_every != 0
        ],
        "heldout": [
            name for index, name in enumerate(ordered_names) if index % test_every == 0
        ],
    }
    if normalized != expected:
        raise ColmapContractError(
            "SPLIT_SEMANTICS_MISMATCH",
            "splits.json must exactly follow gsplat v1.5.3 filename sorting and "
            f"index % test_every ({test_every}); expected={expected}",
        )
    return expected


def _validate_npz_archive(data: bytes, label: str) -> None:
    try:
        with zipfile.ZipFile(io.BytesIO(data), mode="r") as archive:
            infos = archive.infolist()
            names = [info.filename for info in infos]
            if len(names) != len(set(names)):
                raise ColmapContractError(
                    "INVALID_DEPTH", f"{label} repeats an archive member"
                )
            if set(names) != _DEPTH_ARCHIVE_NAMES:
                raise ColmapContractError(
                    "INVALID_DEPTH",
                    f"{label} must contain exactly {sorted(_DEPTH_ARCHIVE_NAMES)}",
                )
            total_uncompressed = 0
            for info in infos:
                if info.is_dir() or info.flag_bits & 0x1:
                    raise ColmapContractError(
                        "INVALID_DEPTH",
                        f"{label} contains a directory or encrypted member",
                    )
                total_uncompressed += info.file_size
                if total_uncompressed > MAX_DEPTH_UNCOMPRESSED_BYTES:
                    raise ColmapContractError(
                        "DEPTH_TOO_LARGE", f"{label} expands beyond the safety limit"
                    )
                # Reading validates CRC before NumPy interprets the member.
                with archive.open(info, mode="r") as member:
                    while member.read(1024 * 1024):
                        pass
    except ColmapContractError:
        raise
    except (OSError, zipfile.BadZipFile, RuntimeError, binascii.Error) as error:
        raise ColmapContractError(
            "INVALID_DEPTH", f"{label} is not a valid NPZ archive"
        ) from error


def _integer_scalar(array: np.ndarray, label: str) -> int:
    if array.shape != () or array.dtype != np.dtype(np.int32):
        raise ColmapContractError("INVALID_DEPTH", f"{label} must be one int32 scalar")
    return int(array.item())


def _read_depth_prior(
    path: Path,
    *,
    image_name: str,
    expected_width: int,
    expected_height: int,
) -> dict[str, Any]:
    data = _read_bounded_regular_file(path, MAX_DEPTH_NPZ_BYTES, path.name)
    _validate_npz_archive(data, path.name)
    try:
        with np.load(io.BytesIO(data), allow_pickle=False) as payload:
            if set(payload.files) != _DEPTH_KEYS:
                raise ColmapContractError(
                    "INVALID_DEPTH",
                    f"{path.name} must expose exactly {sorted(_DEPTH_KEYS)}",
                )
            uv = np.asarray(payload["uv"])
            depth = np.asarray(payload["depth_m"])
            width = _integer_scalar(np.asarray(payload["width"]), f"{path.name} width")
            height = _integer_scalar(
                np.asarray(payload["height"]), f"{path.name} height"
            )
    except ColmapContractError:
        raise
    except (OSError, ValueError, EOFError, zipfile.BadZipFile) as error:
        raise ColmapContractError(
            "INVALID_DEPTH", f"could not decode {path.name}"
        ) from error
    if uv.dtype != np.dtype(np.float32):
        raise ColmapContractError("INVALID_DEPTH", f"{path.name} uv must be float32")
    if depth.dtype != np.dtype(np.float32):
        raise ColmapContractError(
            "INVALID_DEPTH", f"{path.name} depth_m must be float32"
        )
    if uv.ndim != 2 or uv.shape[1:] != (2,):
        raise ColmapContractError(
            "INVALID_DEPTH", f"{path.name} uv must have shape (M, 2)"
        )
    if depth.ndim != 1 or depth.shape[0] != uv.shape[0]:
        raise ColmapContractError(
            "INVALID_DEPTH", f"{path.name} depth_m must have shape (M,) matching uv"
        )
    sample_count = int(uv.shape[0])
    if sample_count <= 0 or sample_count > MAX_DEPTH_SAMPLES:
        raise ColmapContractError(
            "INVALID_DEPTH",
            f"{path.name} sample count must be between 1 and {MAX_DEPTH_SAMPLES}",
        )
    if width != expected_width or height != expected_height:
        raise ColmapContractError(
            "DEPTH_DIMENSION_MISMATCH",
            f"{path.name} declares {width}x{height}, expected {expected_width}x{expected_height}",
        )
    if not bool(np.isfinite(uv).all()) or not bool(np.isfinite(depth).all()):
        raise ColmapContractError(
            "INVALID_DEPTH", f"{path.name} contains non-finite values"
        )
    if not bool((depth > 0).all()):
        raise ColmapContractError(
            "INVALID_DEPTH", f"{path.name} depth values must be positive"
        )
    if not bool(
        (
            (uv[:, 0] >= 0) & (uv[:, 0] < width) & (uv[:, 1] >= 0) & (uv[:, 1] < height)
        ).all()
    ):
        raise ColmapContractError(
            "DEPTH_UV_OUT_OF_BOUNDS",
            f"{path.name} contains UV coordinates outside the image",
        )
    return {
        "fileName": path.name,
        "imageName": image_name,
        "sha256": _sha256(data),
        "sampleCount": sample_count,
        "width": width,
        "height": height,
        "uvDtype": "float32",
        "depthDtype": "float32",
    }


def _check_directory(path: Path, label: str, *, required: bool = True) -> bool:
    if path.is_symlink():
        raise ColmapContractError("UNSAFE_DIRECTORY", f"{label} must not be a symlink")
    if not path.exists():
        if required:
            raise ColmapContractError(
                "MISSING_DIRECTORY", f"missing directory: {label}"
            )
        return False
    if not path.is_dir():
        raise ColmapContractError("UNSAFE_DIRECTORY", f"{label} must be a directory")
    return True


def _image_file_map(images_root: Path, label: str) -> dict[str, Path]:
    """Enumerate exactly the files that gsplat's recursive loader will see."""

    result: dict[str, Path] = {}
    folded_names: dict[str, str] = {}

    def visit(directory: Path, components: tuple[str, ...]) -> None:
        try:
            entries = sorted(
                directory.iterdir(),
                key=lambda path: (path.name.casefold(), path.name),
            )
        except OSError as error:
            raise ColmapContractError(
                "READ_FAILED", f"could not enumerate {label}: {error}"
            ) from error
        for entry in entries:
            relative_name = PurePosixPath(*components, entry.name).as_posix()
            _validate_image_name(relative_name)
            if entry.is_symlink():
                raise ColmapContractError(
                    "UNSAFE_IMAGE_ENTRY",
                    f"{label}/{relative_name} must not be a symlink",
                )
            if entry.is_dir():
                visit(entry, (*components, entry.name))
                continue
            if not entry.is_file():
                raise ColmapContractError(
                    "UNSAFE_IMAGE_ENTRY",
                    f"{label}/{relative_name} must be a regular file or directory",
                )
            folded = relative_name.casefold()
            other = folded_names.get(folded)
            if other is not None:
                raise ColmapContractError(
                    "DUPLICATE_IMAGE_NAME",
                    f"{label} contains case-ambiguous files {other!r} and {relative_name!r}",
                )
            folded_names[folded] = relative_name
            result[relative_name] = entry

    visit(images_root, ())
    return result


def _relative_stem(name: str) -> str:
    return PurePosixPath(name).with_suffix("").as_posix()


def _depth_file_map(depth_dir: Path) -> dict[str, Path]:
    result: dict[str, Path] = {}
    folded_names: dict[str, str] = {}
    for entry in sorted(depth_dir.iterdir(), key=lambda path: path.name.casefold()):
        if entry.is_symlink():
            raise ColmapContractError(
                "UNSAFE_FILE", f"depth entry {entry.name!r} is a symlink"
            )
        if entry.is_dir():
            raise ColmapContractError(
                "UNEXPECTED_DEPTH_ENTRY",
                f"depth directory contains subdirectory {entry.name!r}",
            )
        if not entry.is_file() or entry.suffix.casefold() != ".npz":
            continue
        folded = entry.name.casefold()
        other = folded_names.get(folded)
        if other is not None:
            raise ColmapContractError(
                "DUPLICATE_DEPTH_PRIOR",
                f"case-ambiguous depth priors {other!r} and {entry.name!r}",
            )
        folded_names[folded] = entry.name
        result[entry.name] = entry
    return result


def validate_colmap_training_contract(
    dataset_root: Path,
    depth_dir: Path,
    *,
    depth_required: bool,
    data_factor: int,
    test_every: int,
) -> dict[str, Any]:
    """Validate a local COLMAP/depth input and return a deterministic summary.

    ``depth_required`` controls whether every training image must have a prior.
    ``data_factor`` and ``test_every`` are explicit because they change which
    bytes and images the pinned parser consumes.  Held-out priors are rejected
    in either mode because their presence makes accidental evaluation leakage
    too easy.
    """

    if not isinstance(depth_required, bool):
        raise ColmapContractError(
            "INVALID_ARGUMENT", "depth_required must be true or false"
        )
    if (
        isinstance(data_factor, bool)
        or not isinstance(data_factor, Integral)
        or int(data_factor) < 1
        or int(data_factor) > MAX_IMAGE_DIMENSION
    ):
        raise ColmapContractError(
            "INVALID_ARGUMENT",
            f"data_factor must be an integer between 1 and {MAX_IMAGE_DIMENSION}",
        )
    if (
        isinstance(test_every, bool)
        or not isinstance(test_every, Integral)
        or int(test_every) < 2
        or int(test_every) > MAX_IMAGES
    ):
        raise ColmapContractError(
            "INVALID_ARGUMENT",
            f"test_every must be an integer between 2 and {MAX_IMAGES}",
        )
    data_factor = int(data_factor)
    test_every = int(test_every)
    dataset_root = Path(dataset_root)
    depth_dir = Path(depth_dir)
    _check_directory(dataset_root, "dataset root")
    sparse_parent = dataset_root / "sparse"
    sparse_root = dataset_root / "sparse" / "0"
    images_root = dataset_root / "images"
    _check_directory(sparse_parent, "sparse")
    _check_directory(sparse_root, "sparse/0")
    _check_directory(images_root, "images")
    ext_metadata_path = dataset_root / "ext_metadata.json"
    if ext_metadata_path.is_symlink() or ext_metadata_path.exists():
        raise ColmapContractError(
            "UNSUPPORTED_EXT_METADATA",
            "ext_metadata.json is not accepted because its gsplat parser overrides are not "
            "part of this source-locked external-depth contract",
        )

    cameras_data = _read_bounded_regular_file(
        sparse_root / "cameras.bin", MAX_CAMERAS_BINARY_BYTES, "sparse/0/cameras.bin"
    )
    images_data = _read_bounded_regular_file(
        sparse_root / "images.bin", MAX_IMAGES_BINARY_BYTES, "sparse/0/images.bin"
    )
    points_data = _read_bounded_regular_file(
        sparse_root / "points3D.bin", MAX_POINTS3D_BINARY_BYTES, "sparse/0/points3D.bin"
    )
    splits_data = _read_bounded_regular_file(
        dataset_root / "splits.json", MAX_SPLITS_BYTES, "splits.json"
    )

    cameras = _parse_cameras(cameras_data)
    images = _parse_images(images_data)
    points = _parse_points3d(points_data)
    _validate_sparse_references(cameras, images, points)
    cameras_by_id = {record["cameraId"]: record for record in cameras}
    registered_names = {record["name"] for record in images}
    splits = _parse_splits(
        splits_data,
        registered_names,
        test_every=test_every,
    )

    source_image_files = _image_file_map(images_root, "images")
    missing_source_images = sorted(registered_names - set(source_image_files))
    if missing_source_images:
        raise ColmapContractError(
            "MISSING_FILE",
            f"images is missing registered files: {missing_source_images}",
        )
    unexpected_source_images = sorted(set(source_image_files) - registered_names)
    if unexpected_source_images:
        raise ColmapContractError(
            "UNEXPECTED_IMAGE_ENTRY",
            f"images contains files not registered by COLMAP: {unexpected_source_images}",
        )

    runtime_directory_name = "images" if data_factor == 1 else f"images_{data_factor}"
    runtime_images_root = dataset_root / runtime_directory_name
    if data_factor == 1:
        runtime_image_files = source_image_files
    else:
        _check_directory(runtime_images_root, runtime_directory_name)
        runtime_image_files = _image_file_map(
            runtime_images_root, runtime_directory_name
        )
    source_file_names = sorted(source_image_files)
    runtime_file_names = sorted(runtime_image_files)
    if len(runtime_file_names) != len(source_file_names):
        raise ColmapContractError(
            "RUNTIME_IMAGE_COUNT_MISMATCH",
            f"{runtime_directory_name} has {len(runtime_file_names)} files, expected "
            f"{len(source_file_names)} to match images exactly",
        )
    runtime_name_by_source: dict[str, str] = {}
    for source_name, runtime_name in zip(
        source_file_names, runtime_file_names, strict=True
    ):
        if _relative_stem(source_name) != _relative_stem(runtime_name):
            raise ColmapContractError(
                "RUNTIME_IMAGE_MAPPING_MISMATCH",
                f"gsplat's sorted mapping pairs images/{source_name} with "
                f"{runtime_directory_name}/{runtime_name}, but their relative stems differ",
            )
        runtime_name_by_source[source_name] = runtime_name
    if (
        data_factor > 1
        and runtime_file_names
        and PurePosixPath(runtime_file_names[0]).suffix.casefold() == ".jpg"
    ):
        raise ColmapContractError(
            "UNSUPPORTED_RUNTIME_IMAGE_REWRITE",
            f"{runtime_directory_name}'s first sorted file is .jpg, which makes gsplat "
            "generate and consume a different directory at runtime",
        )

    stems: dict[str, str] = {}
    image_summaries: list[dict[str, Any]] = []
    images_by_name: dict[str, dict[str, Any]] = {}
    for image in sorted(images, key=lambda item: item["name"]):
        camera = cameras_by_id[image["cameraId"]]
        stem = PurePosixPath(image["name"]).stem
        folded_stem = stem.casefold()
        if not stem or folded_stem in stems:
            other = stems.get(folded_stem)
            raise ColmapContractError(
                "AMBIGUOUS_DEPTH_STEM",
                f"image {image['name']!r} shares depth stem {stem!r} with {other!r}",
            )
        stems[folded_stem] = image["name"]
        if camera["width"] % data_factor != 0 or camera["height"] % data_factor != 0:
            raise ColmapContractError(
                "DATA_FACTOR_NOT_DIVISIBLE",
                f"camera {camera['cameraId']} dimensions {camera['width']}x{camera['height']} "
                f"are not exactly divisible by data_factor {data_factor}",
            )
        physical_path = source_image_files[image["name"]]
        image_bytes = _read_bounded_regular_file(
            physical_path, MAX_IMAGE_BYTES, f"images/{image['name']}"
        )
        actual_width, actual_height = _encoded_image_dimensions(
            image_bytes, image["name"]
        )
        if actual_width != camera["width"] or actual_height != camera["height"]:
            raise ColmapContractError(
                "IMAGE_DIMENSION_MISMATCH",
                f"image {image['name']!r} is {actual_width}x{actual_height}, but camera "
                f"{camera['cameraId']} declares {camera['width']}x{camera['height']}",
            )
        summary = {
            "imageId": image["imageId"],
            "name": image["name"],
            "cameraId": image["cameraId"],
            "cameraModel": camera["model"],
            "width": actual_width,
            "height": actual_height,
            "observationCount": len(image["observations"]),
            "sha256": _sha256(image_bytes),
        }
        image_summaries.append(summary)
        images_by_name[image["name"]] = summary

    runtime_image_summaries: list[dict[str, Any]] = []
    if data_factor == 1:
        for image in image_summaries:
            runtime_image_summaries.append(
                {
                    "sourceName": image["name"],
                    "name": image["name"],
                    "width": image["width"],
                    "height": image["height"],
                    "sha256": image["sha256"],
                }
            )
    else:
        for source_name in source_file_names:
            runtime_name = runtime_name_by_source[source_name]
            runtime_path = runtime_image_files[runtime_name]
            runtime_bytes = _read_bounded_regular_file(
                runtime_path,
                MAX_IMAGE_BYTES,
                f"{runtime_directory_name}/{runtime_name}",
            )
            actual_width, actual_height = _encoded_image_dimensions(
                runtime_bytes,
                runtime_name,
            )
            source_image = images_by_name[source_name]
            expected_width = source_image["width"] // data_factor
            expected_height = source_image["height"] // data_factor
            if actual_width != expected_width or actual_height != expected_height:
                raise ColmapContractError(
                    "RUNTIME_IMAGE_DIMENSION_MISMATCH",
                    f"{runtime_directory_name}/{runtime_name} is "
                    f"{actual_width}x{actual_height}, expected "
                    f"{expected_width}x{expected_height} from camera "
                    f"{source_image['cameraId']} and data_factor {data_factor}",
                )
            runtime_image_summaries.append(
                {
                    "sourceName": source_name,
                    "name": runtime_name,
                    "width": actual_width,
                    "height": actual_height,
                    "sha256": _sha256(runtime_bytes),
                }
            )

    depth_exists = _check_directory(
        depth_dir, "depth directory", required=depth_required
    )
    depth_files = _depth_file_map(depth_dir) if depth_exists else {}
    expected_depth_names = {
        f"{PurePosixPath(name).stem}.npz": name
        for name in (*splits["train"], *splits["heldout"])
    }
    expected_folded_names = {
        file_name.casefold(): file_name for file_name in expected_depth_names
    }
    for actual_name in depth_files:
        expected_name = expected_folded_names.get(actual_name.casefold())
        if expected_name is not None and actual_name != expected_name:
            raise ColmapContractError(
                "DEPTH_FILENAME_CASE_MISMATCH",
                f"depth prior {actual_name!r} must be named exactly {expected_name!r} for "
                "case-sensitive RunPod Linux",
            )
    for heldout_name in splits["heldout"]:
        expected_file_name = f"{PurePosixPath(heldout_name).stem}.npz"
        prior = depth_files.get(expected_file_name)
        if prior is not None:
            raise ColmapContractError(
                "HELDOUT_DEPTH_PRIOR",
                f"held-out image {heldout_name!r} must not have depth prior {prior.name!r}",
            )
    orphan_files = sorted(set(depth_files) - set(expected_depth_names))
    if orphan_files:
        raise ColmapContractError(
            "ORPHAN_DEPTH_PRIOR",
            f"depth priors do not match registered images: {orphan_files}",
        )

    depth_summaries: list[dict[str, Any]] = []
    missing_depth: list[str] = []
    for name in splits["train"]:
        expected_file_name = f"{PurePosixPath(name).stem}.npz"
        prior_path = depth_files.get(expected_file_name)
        if prior_path is None:
            if depth_required:
                missing_depth.append(name)
            continue
        image = images_by_name[name]
        depth_summaries.append(
            _read_depth_prior(
                prior_path,
                image_name=name,
                expected_width=image["width"],
                expected_height=image["height"],
            )
        )
    if missing_depth:
        raise ColmapContractError(
            "MISSING_DEPTH_PRIOR",
            f"training images lack required depth priors: {missing_depth}",
        )

    camera_summaries = [
        {
            "cameraId": camera["cameraId"],
            "modelId": camera["modelId"],
            "model": camera["model"],
            "width": camera["width"],
            "height": camera["height"],
            "params": camera["params"],
        }
        for camera in cameras
    ]
    return {
        "schemaVersion": "omnitwin.colmap-training-contract.v0",
        "binaryFormat": {"format": "COLMAP sparse binary", "endianness": "little"},
        "parserSemantics": {
            "implementation": "gsplat v1.5.3 examples/datasets/colmap.py",
            "dataFactor": data_factor,
            "testEvery": test_every,
            "splitRule": "sorted_filename_index_modulo_test_every",
            "runtimeImageDirectory": runtime_directory_name,
            "extMetadataAccepted": False,
        },
        "files": {
            "cameras.bin": {
                "bytes": len(cameras_data),
                "sha256": _sha256(cameras_data),
            },
            "images.bin": {"bytes": len(images_data), "sha256": _sha256(images_data)},
            "points3D.bin": {"bytes": len(points_data), "sha256": _sha256(points_data)},
            "splits.json": {"bytes": len(splits_data), "sha256": _sha256(splits_data)},
        },
        "cameraCount": len(camera_summaries),
        "cameras": camera_summaries,
        "imageCount": len(image_summaries),
        "images": image_summaries,
        "runtimeImageCount": len(runtime_image_summaries),
        "runtimeImages": runtime_image_summaries,
        "point3DCount": len(points),
        "pointObservationCount": sum(len(point["track"]) for point in points),
        "splits": {
            "train": splits["train"],
            "heldout": splits["heldout"],
            "trainCount": len(splits["train"]),
            "heldoutCount": len(splits["heldout"]),
        },
        "depth": {
            "required": bool(depth_required),
            "priorCount": len(depth_summaries),
            "priors": sorted(depth_summaries, key=lambda item: item["imageName"]),
        },
    }


__all__ = [
    "ColmapContractError",
    "resolve_split_image_name",
    "validate_colmap_training_contract",
]
