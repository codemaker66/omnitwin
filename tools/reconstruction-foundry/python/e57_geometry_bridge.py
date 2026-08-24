"""Bounded read-only pye57 bridge for the authority-none Foundry E57 worker.

All modes expose only data3D metadata and Cartesian point records. They never
invoke an images2D decoder, extract image payloads, write output, open network
sockets, or perform inference/training. Full-file hashes include any embedded
image-blob bytes without decoding them.

Legacy ``describe`` and ``read-batch`` commands hash before and after each
command; ``read-batch`` replays its requested scan prefix. Persistent ``stream``
mode hashes before opening and after closing one process/session, keeps one
sequential low-level reader per scan, and does not replay within that
uninterrupted run. A resumed worker still opens a new stream and reconstructs
its complete checkpoint prefix. Every mode remains capped at a 256 MiB
container, 1,000,000 source points, and 64 scans. The accepted pye57 binding
exposes ``seek``, but a genuine ASTM-E57 fixture call returned libE57Format
``ErrorNotImplemented``; no Grand Hall-scale claim follows from this bridge.

Authority-none ``reduce-stream`` is a separate bounded candidate contract. It
accepts metadata up to 32 GiB, 2,000,000,000 raw records, and 256 scans, but
keeps raw Cartesian records inside this process. It reads one selected scan
sequentially from source point zero, applies one exact normalized pose, metric
AABB, and fixed voxel-first policy, then emits only bounded representatives.
Resume can select the first incomplete scan but cannot seek within that scan.
This is not executor custody, masking, measurement authority, or proof that a
recorded large capture finishes within any time or resource budget.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
from typing import Any, NoReturn


REVIEWED_MAXIMUM_TOTAL_POINTS = 1_000_000
REVIEWED_MAXIMUM_SOURCE_BYTES = 256 * 1024 * 1024
REVIEWED_MAXIMUM_SCANS = 64
REVIEWED_MAXIMUM_BATCH_POINTS = 65_536
STREAM_PROTOCOL_VERSION = "omnitwin.foundry.e57-sequential-stream.v0"
STREAM_MAXIMUM_COMMAND_BYTES = 512
REDUCTION_PROTOCOL_VERSION = "omnitwin.foundry.e57-scan-sharded-reduction-stream.v0"
REDUCTION_MAXIMUM_SOURCE_BYTES = 32 * 1024 * 1024 * 1024
REDUCTION_MAXIMUM_TOTAL_POINTS = 2_000_000_000
REDUCTION_MAXIMUM_SCANS = 256
REDUCTION_MAXIMUM_REPRESENTATIVES_PER_SCAN = 100_000
REDUCTION_MAXIMUM_TOTAL_REPRESENTATIVES = 2_000_000
REDUCTION_MAXIMUM_ABSOLUTE_METRIC_COMPONENT = 1_000_000_000.0
REDUCTION_MINIMUM_VOXEL_SIZE_M = 0.000_001
REDUCTION_MAXIMUM_VOXEL_SIZE_M = 1_000_000.0
MAXIMUM_SAFE_INTEGER = 9_007_199_254_740_991


class BridgeError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def fail(code: str, message: str) -> NoReturn:
    raise BridgeError(code, message)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return f"sha256:{digest.hexdigest()}"


def source_path(value: str) -> Path:
    unresolved = Path(value).expanduser()
    try:
        if unresolved.is_symlink():
            fail(
                "E57_PYE57_SOURCE_UNSAFE",
                "The local pye57 bridge refuses symbolic-link source paths.",
            )
        path = unresolved.resolve(strict=True)
    except FileNotFoundError:
        fail(
            "E57_PYE57_SOURCE_MISSING",
            "The exact local E57 source path does not exist.",
        )
    if not path.is_file():
        fail(
            "E57_PYE57_SOURCE_UNSAFE",
            "The local pye57 bridge requires one regular source file.",
        )
    return path


def verify_source(
    path: Path,
    expected_size: int,
    expected_sha256: str,
    maximum_source_bytes: int = REVIEWED_MAXIMUM_SOURCE_BYTES,
) -> dict[str, Any]:
    if expected_size <= 0:
        fail(
            "E57_PYE57_SOURCE_BINDING_INVALID",
            "Expected E57 source size must be positive.",
        )
    if expected_size > maximum_source_bytes:
        fail(
            "E57_PYE57_SOURCE_SIZE_LIMIT_EXCEEDED",
            "The E57 container exceeds the fixed source-size limit for this bridge mode.",
        )
    if path.stat().st_size != expected_size or sha256_file(path) != expected_sha256:
        fail(
            "E57_PYE57_SOURCE_BINDING_MISMATCH",
            "The local E57 source does not match its exact expected size and SHA-256.",
        )
    return {"sizeBytes": expected_size, "sha256": expected_sha256}


def require_positive(value: int, label: str) -> int:
    if value <= 0:
        fail("E57_PYE57_LIMIT_INVALID", f"{label} must be positive.")
    return value


def require_bounded(
    value: int,
    label: str,
    maximum: int,
    code: str,
) -> int:
    result = require_positive(value, label)
    if result > maximum:
        fail(code, f"{label} exceeds the fixed V0 {maximum:,} limit.")
    return result


def finite_vector(value: Any, length: int, label: str) -> list[float]:
    try:
        result = [float(component) for component in value]
    except (TypeError, ValueError, OverflowError):
        fail("E57_PYE57_POSE_INVALID", f"{label} is not a finite vector.")
    if len(result) != length or not all(math.isfinite(component) for component in result):
        fail("E57_PYE57_POSE_INVALID", f"{label} is not a finite vector.")
    return [0.0 if component == 0.0 else component for component in result]


def load_dependencies() -> tuple[Any, str, str, str]:
    try:
        import numpy
        import pye57
        from pye57.__version__ import __version__ as pye57_version
    except Exception as error:
        fail(
            "E57_PYE57_DEPENDENCY_UNAVAILABLE",
            f"Local dependency pye57 0.4.19 and NumPy are required: {type(error).__name__}.",
        )
    if pye57_version != "0.4.19":
        fail(
            "E57_PYE57_VERSION_UNSUPPORTED",
            f"The V0 bridge accepts pye57 0.4.19, found {pye57_version}.",
        )
    return pye57, pye57_version, str(numpy.__version__), sys.version.split()[0]


def describe_capture(
    capture: Any,
    maximum_total_points: int,
    maximum_scans: int,
) -> tuple[list[dict[str, Any]], int]:
    scan_count = int(capture.scan_count)
    if scan_count <= 0:
        fail("E57_PYE57_NO_SCANS", "The E57 source contains no data3D scans.")
    if scan_count > maximum_scans:
        fail(
            "E57_PYE57_SCAN_LIMIT_EXCEEDED",
            "The E57 data3D scan count exceeds the fixed V0 invocation limit.",
        )
    scans: list[dict[str, Any]] = []
    guids: set[str] = set()
    total_points = 0
    required_fields = {"cartesianX", "cartesianY", "cartesianZ"}
    for scan_index in range(scan_count):
        header = capture.get_header(scan_index)
        point_count = int(header.point_count)
        if point_count <= 0:
            fail(
                "E57_PYE57_EMPTY_SCAN_UNSUPPORTED",
                f"E57 scan {scan_index} has no points; V0 requires non-empty scans.",
            )
        total_points += point_count
        if total_points > maximum_total_points:
            fail(
                "E57_PYE57_POINT_LIMIT_EXCEEDED",
                "The E57 point total exceeds the fixed V0 invocation limit.",
            )
        fields = sorted(str(field) for field in header.point_fields)
        if not required_fields.issubset(fields):
            fail(
                "E57_PYE57_CARTESIAN_FIELDS_REQUIRED",
                f"E57 scan {scan_index} does not expose Cartesian X, Y, and Z.",
            )
        explicit_pose_paths = (
            "pose/rotation/w",
            "pose/rotation/x",
            "pose/rotation/y",
            "pose/rotation/z",
            "pose/translation/x",
            "pose/translation/y",
            "pose/translation/z",
        )
        try:
            has_explicit_pose = all(
                bool(header.node.isDefined(path)) for path in explicit_pose_paths
            )
        except Exception as error:
            fail(
                "E57_PYE57_EXPLICIT_SCAN_POSE_REQUIRED",
                f"E57 scan {scan_index} pose children could not be inspected: {type(error).__name__}.",
            )
        if not has_explicit_pose:
            fail(
                "E57_PYE57_EXPLICIT_SCAN_POSE_REQUIRED",
                f"E57 scan {scan_index} must define every rotation and translation child of its data3D pose.",
            )
        rotation = finite_vector(header.rotation, 4, f"scan {scan_index} rotation")
        translation = finite_vector(
            header.translation, 3, f"scan {scan_index} translation"
        )
        quaternion_norm = math.sqrt(sum(component * component for component in rotation))
        if abs(quaternion_norm - 1.0) > 1e-6:
            fail(
                "E57_PYE57_POSE_INVALID",
                f"E57 scan {scan_index} quaternion is not normalized within 1e-6.",
            )
        guid = str(header.guid)
        if not guid or len(guid) > 512 or guid in guids:
            fail(
                "E57_PYE57_GUID_INVALID",
                "E57 data3D GUIDs must be non-empty, bounded, and unique.",
            )
        guids.add(guid)
        scans.append(
            {
                "scanIndex": scan_index,
                "data3dGuid": guid,
                "pointCount": point_count,
                "pointFields": fields,
                "pose": {
                    "rotationWxyz": rotation,
                    "translationM": translation,
                },
            }
        )
    return scans, total_points


def open_capture(pye57: Any, path: Path) -> Any:
    try:
        return pye57.E57(str(path), mode="r")
    except Exception as error:
        fail(
            "E57_PYE57_OPEN_FAILED",
            f"pye57 could not open the exact E57 source: {type(error).__name__}.",
        )


def close_capture(capture: Any) -> None:
    try:
        capture.close()
    except Exception as error:
        fail(
            "E57_PYE57_CLOSE_FAILED",
            f"pye57 could not close the exact E57 source: {type(error).__name__}.",
        )


def describe(args: argparse.Namespace) -> dict[str, Any]:
    maximum_total_points = require_bounded(
        args.maximum_total_points,
        "maximum-total-points",
        REVIEWED_MAXIMUM_TOTAL_POINTS,
        "E57_PYE57_TOTAL_POINT_LIMIT_EXCEEDED",
    )
    maximum_scans = require_bounded(
        args.maximum_scans,
        "maximum-scans",
        REVIEWED_MAXIMUM_SCANS,
        "E57_PYE57_SCAN_LIMIT_EXCEEDED",
    )
    pye57, adapter_version, numpy_version, python_version = load_dependencies()
    path = source_path(args.source)
    verify_source(path, args.expected_size, args.expected_sha256)
    capture = open_capture(pye57, path)
    try:
        scans, total_points = describe_capture(
            capture, maximum_total_points, maximum_scans
        )
    finally:
        try:
            close_capture(capture)
        finally:
            verify_source(path, args.expected_size, args.expected_sha256)
    return {
        "adapterVersion": adapter_version,
        "numpyVersion": numpy_version,
        "pythonVersion": python_version,
        "scans": scans,
        "totalPointCount": total_points,
    }


def read_cartesian_batch(
    capture: Any,
    scan_index: int,
    point_count: int,
    start_point_index: int,
    end_point_index: int,
) -> list[dict[str, Any]]:
    header = capture.get_header(scan_index)
    fields = ["cartesianX", "cartesianY", "cartesianZ"]
    has_invalid_state = "cartesianInvalidState" in header.point_fields
    if has_invalid_state:
        fields.append("cartesianInvalidState")
    buffer_capacity = min(REVIEWED_MAXIMUM_BATCH_POINTS, point_count)
    points: list[dict[str, Any]] = []
    try:
        data, buffers = capture.make_buffers(fields, buffer_capacity)
        reader = header.points.reader(buffers)
        try:
            observed_total = 0
            while observed_total < end_point_index:
                observed = int(reader.read())
                if (
                    observed <= 0
                    or observed > buffer_capacity
                    or observed_total + observed > point_count
                ):
                    fail(
                        "E57_PYE57_POINT_COUNT_MISMATCH",
                        "pye57 point payload length does not match the exact data3D header.",
                    )
                overlap_start = max(start_point_index, observed_total)
                overlap_end = min(end_point_index, observed_total + observed)
                for point_index in range(overlap_start, overlap_end):
                    buffer_index = point_index - observed_total
                    invalid_state = (
                        int(data["cartesianInvalidState"][buffer_index])
                        if has_invalid_state
                        else 0
                    )
                    if invalid_state not in (0, 1, 2):
                        fail(
                            "E57_PYE57_INVALID_STATE_UNSUPPORTED",
                            "pye57 returned a Cartesian invalid-state value outside the V0 0..2 range.",
                        )
                    coordinates = [
                        float(data["cartesianX"][buffer_index]),
                        float(data["cartesianY"][buffer_index]),
                        float(data["cartesianZ"][buffer_index]),
                    ]
                    if not all(math.isfinite(value) for value in coordinates):
                        fail(
                            "E57_PYE57_NONFINITE_POINT",
                            "pye57 returned a non-finite Cartesian point component.",
                        )
                    points.append(
                        {
                            "x": 0.0 if coordinates[0] == 0.0 else coordinates[0],
                            "y": 0.0 if coordinates[1] == 0.0 else coordinates[1],
                            "z": 0.0 if coordinates[2] == 0.0 else coordinates[2],
                            "cartesianInvalidState": invalid_state,
                        }
                    )
                observed_total += observed
            if end_point_index == point_count and int(reader.read()) != 0:
                fail(
                    "E57_PYE57_POINT_COUNT_MISMATCH",
                    "pye57 point payload length does not match the exact data3D header.",
                )
        finally:
            reader.close()
    except BridgeError:
        raise
    except Exception as error:
        fail(
            "E57_PYE57_READ_FAILED",
            f"pye57 could not read the bounded Cartesian point fields: {type(error).__name__}.",
        )
    if len(points) != end_point_index - start_point_index:
        fail(
            "E57_PYE57_POINT_COUNT_MISMATCH",
            "pye57 did not return the exact requested Cartesian point interval.",
        )
    return points


def read_batch(args: argparse.Namespace) -> dict[str, Any]:
    maximum_total_points = require_bounded(
        args.maximum_total_points,
        "maximum-total-points",
        REVIEWED_MAXIMUM_TOTAL_POINTS,
        "E57_PYE57_TOTAL_POINT_LIMIT_EXCEEDED",
    )
    maximum_scans = require_bounded(
        args.maximum_scans,
        "maximum-scans",
        REVIEWED_MAXIMUM_SCANS,
        "E57_PYE57_SCAN_LIMIT_EXCEEDED",
    )
    maximum_points = require_bounded(
        args.maximum_points,
        "maximum-points",
        REVIEWED_MAXIMUM_BATCH_POINTS,
        "E57_PYE57_BATCH_LIMIT_EXCEEDED",
    )
    if args.scan_index < 0 or args.start_point_index < 0:
        fail(
            "E57_PYE57_CURSOR_INVALID",
            "scan-index and start-point-index must be non-negative.",
        )
    pye57, _adapter_version, _numpy_version, _python_version = load_dependencies()
    path = source_path(args.source)
    verify_source(path, args.expected_size, args.expected_sha256)
    capture = open_capture(pye57, path)
    try:
        scans, _total_points = describe_capture(
            capture, maximum_total_points, maximum_scans
        )
        if args.scan_index >= len(scans):
            fail(
                "E57_PYE57_CURSOR_INVALID",
                "scan-index is outside the exact data3D scan inventory.",
            )
        scan = scans[args.scan_index]
        point_count = int(scan["pointCount"])
        if args.start_point_index >= point_count:
            fail(
                "E57_PYE57_CURSOR_INVALID",
                "start-point-index is outside the exact data3D scan.",
            )
        expected_maximum_points = min(
            REVIEWED_MAXIMUM_BATCH_POINTS,
            point_count - args.start_point_index,
        )
        if maximum_points != expected_maximum_points:
            fail(
                "E57_PYE57_FIXED_BATCH_REQUIRED",
                "maximum-points must equal the fixed 65,536-point batch or the exact final scan remainder.",
            )
        end = args.start_point_index + maximum_points
        points = read_cartesian_batch(
            capture,
            args.scan_index,
            point_count,
            args.start_point_index,
            end,
        )
    finally:
        try:
            close_capture(capture)
        finally:
            verify_source(path, args.expected_size, args.expected_sha256)
    return {
        "sourceSha256": args.expected_sha256,
        "scanIndex": args.scan_index,
        "data3dGuid": scan["data3dGuid"],
        "startPointIndex": args.start_point_index,
        "points": points,
    }


def regular_file_identity(path: Path, label: str) -> dict[str, Any]:
    try:
        resolved = path.resolve(strict=True)
    except FileNotFoundError:
        fail(
            "E57_PYE57_STREAM_IDENTITY_MISMATCH",
            f"The exact {label} artifact is unavailable.",
        )
    if not resolved.is_file():
        fail(
            "E57_PYE57_STREAM_IDENTITY_MISMATCH",
            f"The exact {label} artifact is not a regular file.",
        )
    return {
        "sizeBytes": resolved.stat().st_size,
        "sha256": sha256_file(resolved),
    }


def verify_stream_runtime_identities(args: argparse.Namespace) -> tuple[dict[str, Any], dict[str, Any]]:
    bridge = regular_file_identity(Path(__file__), "bridge")
    interpreter = regular_file_identity(Path(sys.executable), "Python interpreter")
    if (
        bridge["sizeBytes"] != args.expected_bridge_size
        or bridge["sha256"] != args.expected_bridge_sha256
        or interpreter["sizeBytes"] != args.expected_python_size
        or interpreter["sha256"] != args.expected_python_sha256
    ):
        fail(
            "E57_PYE57_STREAM_IDENTITY_MISMATCH",
            "The running bridge or Python interpreter does not match its exact caller-pinned size and SHA-256 identity.",
        )
    return bridge, interpreter


def emit_stream_message(message: dict[str, Any]) -> None:
    encoded = json.dumps(
        message,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    sys.stdout.buffer.write(encoded + b"\n")
    sys.stdout.buffer.flush()


def read_stream_command(
    expected_sequence: int,
    protocol_version: str = STREAM_PROTOCOL_VERSION,
) -> str:
    encoded = sys.stdin.buffer.readline(STREAM_MAXIMUM_COMMAND_BYTES + 1)
    if not encoded:
        fail(
            "E57_PYE57_STREAM_COMMAND_EOF",
            "The sequential E57 stream ended before its next bounded-batch command.",
        )
    if len(encoded) > STREAM_MAXIMUM_COMMAND_BYTES or not encoded.endswith(b"\n"):
        fail(
            "E57_PYE57_STREAM_COMMAND_INVALID",
            "The sequential E57 stream command exceeded its bounded one-line contract.",
        )
    try:
        command = json.loads(encoded.decode("utf-8", errors="strict"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        fail(
            "E57_PYE57_STREAM_COMMAND_INVALID",
            "The sequential E57 stream command is not one strict UTF-8 JSON object.",
        )
    if (
        not isinstance(command, dict)
        or set(command)
        != {"command", "protocolVersion", "requestNonce", "sequence"}
        or command.get("command") != "next"
        or command.get("protocolVersion") != protocol_version
        or isinstance(command.get("sequence"), bool)
        or not isinstance(command.get("sequence"), int)
        or command.get("sequence") != expected_sequence
        or not isinstance(command.get("requestNonce"), str)
        or len(command.get("requestNonce")) != 64
        or any(
            character not in "0123456789abcdef"
            for character in command.get("requestNonce")
        )
    ):
        fail(
            "E57_PYE57_STREAM_COMMAND_INVALID",
            "The sequential E57 stream command has an unexpected protocol, key, command, or sequence.",
        )
    return str(command["requestNonce"])


def cartesian_point_from_buffer(
    data: dict[str, Any],
    buffer_index: int,
    has_invalid_state: bool,
) -> dict[str, Any]:
    invalid_state = (
        int(data["cartesianInvalidState"][buffer_index])
        if has_invalid_state
        else 0
    )
    if invalid_state not in (0, 1, 2):
        fail(
            "E57_PYE57_INVALID_STATE_UNSUPPORTED",
            "pye57 returned a Cartesian invalid-state value outside the V0 0..2 range.",
        )
    if invalid_state != 0:
        return {
            "x": 0.0,
            "y": 0.0,
            "z": 0.0,
            "cartesianInvalidState": invalid_state,
        }
    coordinates = [
        float(data["cartesianX"][buffer_index]),
        float(data["cartesianY"][buffer_index]),
        float(data["cartesianZ"][buffer_index]),
    ]
    if not all(math.isfinite(value) for value in coordinates):
        fail(
            "E57_PYE57_NONFINITE_POINT",
            "pye57 returned a non-finite Cartesian point component.",
        )
    return {
        "x": 0.0 if coordinates[0] == 0.0 else coordinates[0],
        "y": 0.0 if coordinates[1] == 0.0 else coordinates[1],
        "z": 0.0 if coordinates[2] == 0.0 else coordinates[2],
        "cartesianInvalidState": invalid_state,
    }


class SequentialScanReader:
    def __init__(
        self,
        capture: Any,
        scan: dict[str, Any],
        batch_points: int,
    ) -> None:
        self.scan = scan
        self.batch_points = batch_points
        self.point_count = int(scan["pointCount"])
        self.emitted_count = 0
        self.observed_count = 0
        self.pending: list[dict[str, Any]] = []
        header = capture.get_header(int(scan["scanIndex"]))
        observed_fields = sorted(str(field) for field in header.point_fields)
        observed_rotation = finite_vector(
            header.rotation,
            4,
            f"scan {scan['scanIndex']} rotation",
        )
        observed_translation = finite_vector(
            header.translation,
            3,
            f"scan {scan['scanIndex']} translation",
        )
        if (
            int(header.point_count) != self.point_count
            or str(header.guid) != str(scan["data3dGuid"])
            or observed_fields != list(scan["pointFields"])
            or observed_rotation != list(scan["pose"]["rotationWxyz"])
            or observed_translation != list(scan["pose"]["translationM"])
        ):
            fail(
                "E57_PYE57_SCAN_DESCRIPTION_DRIFT",
                "The sequential E57 scan header changed in count, GUID, fields, or pose after its exact description was emitted.",
            )
        fields = ["cartesianX", "cartesianY", "cartesianZ"]
        self.has_invalid_state = "cartesianInvalidState" in header.point_fields
        if self.has_invalid_state:
            fields.append("cartesianInvalidState")
        self.capacity = min(batch_points, self.point_count)
        self.data, buffers = capture.make_buffers(fields, self.capacity)
        self.reader = header.points.reader(buffers)
        self.closed = False

    def _read_into_pending(self) -> None:
        observed = int(self.reader.read())
        if (
            observed <= 0
            or observed > self.capacity
            or self.observed_count + observed > self.point_count
        ):
            fail(
                "E57_PYE57_POINT_COUNT_MISMATCH",
                "pye57 point payload length does not match the exact data3D header.",
            )
        for buffer_index in range(observed):
            self.pending.append(
                cartesian_point_from_buffer(
                    self.data,
                    buffer_index,
                    self.has_invalid_state,
                )
            )
        self.observed_count += observed

    def next_batch(self) -> tuple[int, list[dict[str, Any]], bool]:
        if self.closed or self.emitted_count >= self.point_count:
            fail(
                "E57_PYE57_STREAM_CURSOR_INVALID",
                "The sequential E57 stream attempted to read beyond its exact scan.",
            )
        start_point_index = self.emitted_count
        target = min(self.batch_points, self.point_count - self.emitted_count)
        while len(self.pending) < target:
            self._read_into_pending()
        points = self.pending[:target]
        del self.pending[:target]
        self.emitted_count += target
        complete = self.emitted_count == self.point_count
        if complete:
            if self.pending or self.observed_count != self.point_count:
                fail(
                    "E57_PYE57_POINT_COUNT_MISMATCH",
                    "pye57 point payload length does not match the exact data3D header.",
                )
            if int(self.reader.read()) != 0:
                fail(
                    "E57_PYE57_POINT_COUNT_MISMATCH",
                    "pye57 returned records beyond the exact data3D header point count.",
                )
        return start_point_index, points, complete

    def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        try:
            self.reader.close()
        except Exception as error:
            fail(
                "E57_PYE57_CLOSE_FAILED",
                f"pye57 could not close the sequential scan reader: {type(error).__name__}.",
            )


def stream(args: argparse.Namespace) -> None:
    maximum_total_points = require_bounded(
        args.maximum_total_points,
        "maximum-total-points",
        REVIEWED_MAXIMUM_TOTAL_POINTS,
        "E57_PYE57_TOTAL_POINT_LIMIT_EXCEEDED",
    )
    maximum_scans = require_bounded(
        args.maximum_scans,
        "maximum-scans",
        REVIEWED_MAXIMUM_SCANS,
        "E57_PYE57_SCAN_LIMIT_EXCEEDED",
    )
    batch_points = require_bounded(
        args.batch_points,
        "batch-points",
        REVIEWED_MAXIMUM_BATCH_POINTS,
        "E57_PYE57_BATCH_LIMIT_EXCEEDED",
    )
    if batch_points != REVIEWED_MAXIMUM_BATCH_POINTS:
        fail(
            "E57_PYE57_FIXED_BATCH_REQUIRED",
            "The V0 sequential stream requires the fixed 65,536-point batch capacity.",
        )
    bridge_identity, interpreter_identity = verify_stream_runtime_identities(args)
    path = source_path(args.source)
    source_before = verify_source(path, args.expected_size, args.expected_sha256)
    pye57, adapter_version, numpy_version, python_version = load_dependencies()
    capture = open_capture(pye57, path)
    current_reader: SequentialScanReader | None = None
    capture_open = True
    try:
        scans, total_points = describe_capture(
            capture, maximum_total_points, maximum_scans
        )
        emit_stream_message(
            {
                "protocolVersion": STREAM_PROTOCOL_VERSION,
                "messageType": "description",
                "sequence": 0,
                "sourceBefore": source_before,
                "bridge": bridge_identity,
                "interpreter": interpreter_identity,
                "adapterVersion": adapter_version,
                "numpyVersion": numpy_version,
                "pythonVersion": python_version,
                "batchPoints": batch_points,
                "scans": scans,
                "totalPointCount": total_points,
                "readPolicy": {
                    "pointPayload": "cartesian_fields_only",
                    "imageDecoderAccess": False,
                    "imageExtraction": False,
                    "network": "none",
                    "modelInference": "none",
                    "modelTraining": "none",
                },
            }
        )
        sequence = 1
        emitted_total = 0
        batch_count = 0
        for scan in scans:
            current_reader = SequentialScanReader(capture, scan, batch_points)
            while current_reader.emitted_count < current_reader.point_count:
                request_nonce = read_stream_command(sequence)
                start_point_index, points, scan_complete = current_reader.next_batch()
                emitted_total += len(points)
                batch_count += 1
                terminal = emitted_total == total_points
                if terminal:
                    if not scan_complete or int(scan["scanIndex"]) != len(scans) - 1:
                        fail(
                            "E57_PYE57_POINT_COUNT_MISMATCH",
                            "The sequential E57 stream reached a terminal count before the exact final scan boundary.",
                        )
                    current_reader.close()
                    current_reader = None
                    close_capture(capture)
                    capture_open = False
                    source_after = verify_source(
                        path, args.expected_size, args.expected_sha256
                    )
                else:
                    source_after = None
                emit_stream_message(
                    {
                        "protocolVersion": STREAM_PROTOCOL_VERSION,
                        "messageType": "batch",
                        "sequence": sequence,
                        "requestNonce": request_nonce,
                        "sourceSha256": args.expected_sha256,
                        "scanIndex": int(scan["scanIndex"]),
                        "data3dGuid": str(scan["data3dGuid"]),
                        "startPointIndex": start_point_index,
                        "points": points,
                        "terminal": (
                            {
                                "sourceAfter": source_after,
                                "totalPointCount": total_points,
                                "emittedPointCount": emitted_total,
                                "batchCount": batch_count,
                            }
                            if terminal
                            else None
                        ),
                    }
                )
                sequence += 1
                if terminal:
                    return
            if current_reader is not None:
                current_reader.close()
                current_reader = None
        if capture_open or emitted_total != total_points:
            fail(
                "E57_PYE57_POINT_COUNT_MISMATCH",
                "The sequential E57 stream did not close on its exact final point count.",
            )
    finally:
        if current_reader is not None:
            current_reader.close()
        if capture_open:
            try:
                close_capture(capture)
            finally:
                verify_source(path, args.expected_size, args.expected_sha256)


def reduction_metric_vector(values: list[float], label: str) -> list[float]:
    result = finite_vector(values, 3, label)
    if any(
        abs(component) > REDUCTION_MAXIMUM_ABSOLUTE_METRIC_COMPONENT
        for component in result
    ):
        fail(
            "E57_PYE57_REDUCTION_POLICY_INVALID",
            f"{label} exceeds the fixed metric component bound.",
        )
    return result


def normalized_rotation(rotation: list[float], scan_index: int) -> list[float]:
    norm = math.sqrt(sum(component * component for component in rotation))
    if not math.isfinite(norm) or norm <= 0.0 or abs(norm - 1.0) > 1e-6:
        fail(
            "E57_PYE57_POSE_INVALID",
            f"E57 scan {scan_index} quaternion is not normalized within 1e-6.",
        )
    return [
        0.0 if component / norm == 0.0 else component / norm
        for component in rotation
    ]


def transform_reduction_point(
    point: dict[str, Any],
    rotation: list[float],
    translation: list[float],
) -> list[float]:
    w, qx, qy, qz = rotation
    x, y, z = float(point["x"]), float(point["y"]), float(point["z"])
    tx = 2.0 * (qy * z - qz * y)
    ty = 2.0 * (qz * x - qx * z)
    tz = 2.0 * (qx * y - qy * x)
    transformed = [
        x + w * tx + (qy * tz - qz * ty) + translation[0],
        y + w * ty + (qz * tx - qx * tz) + translation[1],
        z + w * tz + (qx * ty - qy * tx) + translation[2],
    ]
    if not all(
        math.isfinite(component)
        and abs(component) <= REDUCTION_MAXIMUM_ABSOLUTE_METRIC_COMPONENT
        for component in transformed
    ):
        fail(
            "E57_PYE57_REDUCTION_TRANSFORM_INVALID",
            "A valid Cartesian point produced an out-of-contract transformed metric coordinate.",
        )
    return [0.0 if component == 0.0 else component for component in transformed]


def reduction_voxel_index(
    coordinate: float,
    origin: float,
    voxel_size: float,
) -> int:
    ratio = (coordinate - origin) / voxel_size
    if not math.isfinite(ratio):
        fail(
            "E57_PYE57_REDUCTION_VOXEL_INDEX_OVERFLOW",
            "A reduced point produced a non-finite voxel ratio.",
        )
    index = math.floor(ratio)
    if abs(index) > MAXIMUM_SAFE_INTEGER:
        fail(
            "E57_PYE57_REDUCTION_VOXEL_INDEX_OVERFLOW",
            "A reduced point produced a voxel index outside the exact safe-integer contract.",
        )
    return int(index)


def reduce_one_scan(
    capture: Any,
    scan: dict[str, Any],
    batch_points: int,
    crop_minimum: list[float],
    crop_maximum: list[float],
    voxel_origin: list[float],
    voxel_size: float,
    maximum_representatives_per_scan: int,
    aggregate_representatives_before_scan: int,
    maximum_total_representatives: int,
) -> tuple[dict[str, int], list[list[int | float]]]:
    reader = SequentialScanReader(capture, scan, batch_points)
    representatives: dict[tuple[int, int, int], list[int | float]] = {}
    processed = 0
    invalid = 0
    cropped_out = 0
    valid_inside_crop = 0
    rotation = normalized_rotation(
        list(scan["pose"]["rotationWxyz"]), int(scan["scanIndex"])
    )
    translation = list(scan["pose"]["translationM"])
    try:
        while reader.emitted_count < reader.point_count:
            start_point_index, points, _scan_complete = reader.next_batch()
            for offset, point in enumerate(points):
                source_point_index = start_point_index + offset
                processed += 1
                if int(point["cartesianInvalidState"]) != 0:
                    invalid += 1
                    continue
                transformed = transform_reduction_point(
                    point, rotation, translation
                )
                if any(
                    transformed[component] < crop_minimum[component]
                    or transformed[component] > crop_maximum[component]
                    for component in range(3)
                ):
                    cropped_out += 1
                    continue
                valid_inside_crop += 1
                voxel = tuple(
                    reduction_voxel_index(
                        transformed[component],
                        voxel_origin[component],
                        voxel_size,
                    )
                    for component in range(3)
                )
                if voxel in representatives:
                    continue
                if len(representatives) >= maximum_representatives_per_scan:
                    fail(
                        "E57_PYE57_REDUCTION_SCAN_OUTPUT_LIMIT_EXCEEDED",
                        "A scan exceeded its exact representative cap; increase voxel size or tighten the crop.",
                    )
                if (
                    aggregate_representatives_before_scan
                    + len(representatives)
                    + 1
                    > maximum_total_representatives
                ):
                    fail(
                        "E57_PYE57_REDUCTION_AGGREGATE_OUTPUT_LIMIT_EXCEEDED",
                        "The scan sequence exceeded its exact aggregate representative cap; increase voxel size or tighten the crop.",
                    )
                representatives[voxel] = [
                    source_point_index,
                    voxel[0],
                    voxel[1],
                    voxel[2],
                    transformed[0],
                    transformed[1],
                    transformed[2],
                ]
    finally:
        reader.close()
    if processed != int(scan["pointCount"]):
        fail(
            "E57_PYE57_POINT_COUNT_MISMATCH",
            "The scan reducer did not process the exact data3D point count.",
        )
    return (
        {
            "source": int(scan["pointCount"]),
            "processed": processed,
            "invalid": invalid,
            "croppedOut": cropped_out,
            "validInsideCrop": valid_inside_crop,
            "representatives": len(representatives),
        },
        list(representatives.values()),
    )


def reduce_stream(args: argparse.Namespace) -> None:
    maximum_total_points = require_bounded(
        args.maximum_total_points,
        "maximum-total-points",
        REDUCTION_MAXIMUM_TOTAL_POINTS,
        "E57_PYE57_REDUCTION_TOTAL_POINT_LIMIT_EXCEEDED",
    )
    maximum_scans = require_bounded(
        args.maximum_scans,
        "maximum-scans",
        REDUCTION_MAXIMUM_SCANS,
        "E57_PYE57_REDUCTION_SCAN_LIMIT_EXCEEDED",
    )
    batch_points = require_bounded(
        args.batch_points,
        "batch-points",
        REVIEWED_MAXIMUM_BATCH_POINTS,
        "E57_PYE57_REDUCTION_BATCH_LIMIT_EXCEEDED",
    )
    if batch_points != REVIEWED_MAXIMUM_BATCH_POINTS:
        fail(
            "E57_PYE57_FIXED_BATCH_REQUIRED",
            "The scan reducer requires the fixed 65,536-point native read buffer.",
        )
    maximum_representatives_per_scan = require_bounded(
        args.maximum_representatives_per_scan,
        "maximum-representatives-per-scan",
        REDUCTION_MAXIMUM_REPRESENTATIVES_PER_SCAN,
        "E57_PYE57_REDUCTION_SCAN_OUTPUT_LIMIT_EXCEEDED",
    )
    maximum_total_representatives = require_bounded(
        args.maximum_total_representatives,
        "maximum-total-representatives",
        REDUCTION_MAXIMUM_TOTAL_REPRESENTATIVES,
        "E57_PYE57_REDUCTION_AGGREGATE_OUTPUT_LIMIT_EXCEEDED",
    )
    if maximum_representatives_per_scan > maximum_total_representatives:
        fail(
            "E57_PYE57_REDUCTION_POLICY_INVALID",
            "The per-scan representative cap cannot exceed the aggregate cap.",
        )
    if (
        args.completed_representative_count < 0
        or args.completed_representative_count > maximum_total_representatives
    ):
        fail(
            "E57_PYE57_REDUCTION_POLICY_INVALID",
            "The completed representative count is outside the aggregate cap.",
        )
    crop_minimum = reduction_metric_vector(
        [args.crop_min_x, args.crop_min_y, args.crop_min_z],
        "reduction crop minimum",
    )
    crop_maximum = reduction_metric_vector(
        [args.crop_max_x, args.crop_max_y, args.crop_max_z],
        "reduction crop maximum",
    )
    if any(
        crop_minimum[component] > crop_maximum[component]
        for component in range(3)
    ):
        fail(
            "E57_PYE57_REDUCTION_POLICY_INVALID",
            "Reduction crop minimum cannot exceed crop maximum.",
        )
    voxel_origin = reduction_metric_vector(
        [args.voxel_origin_x, args.voxel_origin_y, args.voxel_origin_z],
        "voxel origin",
    )
    voxel_size = float(args.voxel_size)
    if (
        not math.isfinite(voxel_size)
        or voxel_size < REDUCTION_MINIMUM_VOXEL_SIZE_M
        or voxel_size > REDUCTION_MAXIMUM_VOXEL_SIZE_M
    ):
        fail(
            "E57_PYE57_REDUCTION_POLICY_INVALID",
            "Voxel size is outside the fixed finite metric bound.",
        )
    bridge_identity, interpreter_identity = verify_stream_runtime_identities(args)
    path = source_path(args.source)
    source_before = verify_source(
        path,
        args.expected_size,
        args.expected_sha256,
        REDUCTION_MAXIMUM_SOURCE_BYTES,
    )
    pye57, adapter_version, numpy_version, python_version = load_dependencies()
    capture = open_capture(pye57, path)
    capture_open = True
    try:
        scans, total_points = describe_capture(
            capture, maximum_total_points, maximum_scans
        )
        if args.start_scan_index < 0 or args.start_scan_index >= len(scans):
            fail(
                "E57_PYE57_REDUCTION_START_SCAN_INVALID",
                "The reducer start scan is outside the exact data3D inventory.",
            )
        emit_stream_message(
            {
                "protocolVersion": REDUCTION_PROTOCOL_VERSION,
                "messageType": "description",
                "sequence": 0,
                "requestedStartScanIndex": args.start_scan_index,
                "completedRepresentativeCount": args.completed_representative_count,
                "sourceBefore": source_before,
                "bridge": bridge_identity,
                "interpreter": interpreter_identity,
                "adapterVersion": adapter_version,
                "numpyVersion": numpy_version,
                "pythonVersion": python_version,
                "internalBatchPoints": batch_points,
                "scans": scans,
                "totalPointCount": total_points,
                "crop": {
                    "frame": "e57_root",
                    "units": "metre",
                    "minimum": crop_minimum,
                    "maximum": crop_maximum,
                    "boundary": "inclusive",
                },
                "voxelPolicy": {
                    "kind": "fixed_metric_grid_first_source_point",
                    "voxelSizeM": voxel_size,
                    "originM": voxel_origin,
                    "indexRule": "ieee754_binary64_floor_toward_negative_infinity",
                    "representativeRule": "first_valid_crop_point_in_source_order",
                    "outputOrder": "source_point_index_ascending",
                },
                "limits": {
                    "maximumInputPoints": maximum_total_points,
                    "maximumScans": maximum_scans,
                    "internalBatchPoints": batch_points,
                    "maximumRepresentativesPerScan": maximum_representatives_per_scan,
                    "maximumTotalRepresentatives": maximum_total_representatives,
                },
                "readPolicy": {
                    "rawPointTransport": "kept_inside_pinned_python_bridge",
                    "emittedPayload": "bounded_reduced_representatives_only",
                    "imageDecoderAccess": False,
                    "imageExtraction": False,
                    "network": "none",
                    "modelInference": "none",
                    "modelTraining": "none",
                },
            }
        )
        sequence = 1
        aggregate_representatives = args.completed_representative_count
        for scan_index in range(args.start_scan_index, len(scans)):
            request_nonce = read_stream_command(
                sequence, REDUCTION_PROTOCOL_VERSION
            )
            scan = scans[scan_index]
            counts, points = reduce_one_scan(
                capture,
                scan,
                batch_points,
                crop_minimum,
                crop_maximum,
                voxel_origin,
                voxel_size,
                maximum_representatives_per_scan,
                aggregate_representatives,
                maximum_total_representatives,
            )
            aggregate_representatives += counts["representatives"]
            terminal = scan_index == len(scans) - 1
            if terminal:
                close_capture(capture)
                capture_open = False
                source_after = verify_source(
                    path,
                    args.expected_size,
                    args.expected_sha256,
                    REDUCTION_MAXIMUM_SOURCE_BYTES,
                )
            else:
                source_after = None
            emit_stream_message(
                {
                    "protocolVersion": REDUCTION_PROTOCOL_VERSION,
                    "messageType": "scan",
                    "sequence": sequence,
                    "requestNonce": request_nonce,
                    "sourceSha256": args.expected_sha256,
                    "scanIndex": scan_index,
                    "data3dGuid": str(scan["data3dGuid"]),
                    "counts": counts,
                    "points": points,
                    "aggregateRepresentativeCount": aggregate_representatives,
                    "terminalSourceAfter": source_after,
                }
            )
            sequence += 1
        if capture_open:
            fail(
                "E57_PYE57_REDUCTION_TERMINAL_MISSING",
                "The reducer did not close on the exact final scan boundary.",
            )
    finally:
        if capture_open:
            try:
                close_capture(capture)
            finally:
                verify_source(
                    path,
                    args.expected_size,
                    args.expected_sha256,
                    REDUCTION_MAXIMUM_SOURCE_BYTES,
                )


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser()
    commands = root.add_subparsers(dest="command", required=True)
    for name in ("describe", "read-batch", "stream", "reduce-stream"):
        command = commands.add_parser(name)
        command.add_argument("--source", required=True)
        command.add_argument("--expected-size", type=int, required=True)
        command.add_argument("--expected-sha256", required=True)
        command.add_argument("--maximum-total-points", type=int, required=True)
        command.add_argument("--maximum-scans", type=int, required=True)
        if name == "read-batch":
            command.add_argument("--scan-index", type=int, required=True)
            command.add_argument("--start-point-index", type=int, required=True)
            command.add_argument("--maximum-points", type=int, required=True)
        if name in ("stream", "reduce-stream"):
            command.add_argument("--batch-points", type=int, required=True)
            command.add_argument("--expected-bridge-size", type=int, required=True)
            command.add_argument("--expected-bridge-sha256", required=True)
            command.add_argument("--expected-python-size", type=int, required=True)
            command.add_argument("--expected-python-sha256", required=True)
        if name == "reduce-stream":
            command.add_argument("--start-scan-index", type=int, required=True)
            command.add_argument(
                "--completed-representative-count", type=int, required=True
            )
            command.add_argument("--crop-min-x", type=float, required=True)
            command.add_argument("--crop-min-y", type=float, required=True)
            command.add_argument("--crop-min-z", type=float, required=True)
            command.add_argument("--crop-max-x", type=float, required=True)
            command.add_argument("--crop-max-y", type=float, required=True)
            command.add_argument("--crop-max-z", type=float, required=True)
            command.add_argument("--voxel-origin-x", type=float, required=True)
            command.add_argument("--voxel-origin-y", type=float, required=True)
            command.add_argument("--voxel-origin-z", type=float, required=True)
            command.add_argument("--voxel-size", type=float, required=True)
            command.add_argument(
                "--maximum-representatives-per-scan", type=int, required=True
            )
            command.add_argument(
                "--maximum-total-representatives", type=int, required=True
            )
    return root


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    if args.command == "stream":
        stream(args)
        return 0
    if args.command == "reduce-stream":
        reduce_stream(args)
        return 0
    result = describe(args) if args.command == "describe" else read_batch(args)
    sys.stdout.write(
        json.dumps(
            result,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except BridgeError as error:
        sys.stderr.write(
            json.dumps(
                {"code": error.code, "message": error.message},
                ensure_ascii=False,
                allow_nan=False,
                separators=(",", ":"),
                sort_keys=True,
            )
            + "\n"
        )
        sys.exit(2)
    except Exception as error:
        sys.stderr.write(
            json.dumps(
                {
                    "code": "E57_PYE57_BRIDGE_UNEXPECTED_FAILURE",
                    "message": f"Unexpected local pye57 bridge failure: {type(error).__name__}.",
                },
                ensure_ascii=False,
                allow_nan=False,
                separators=(",", ":"),
                sort_keys=True,
            )
            + "\n"
        )
        sys.exit(3)
