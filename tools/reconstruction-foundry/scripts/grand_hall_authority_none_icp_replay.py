"""Deterministic replay of the recovered Grand Hall authority-none ICP run.

This module reconstructs a historical diagnostic only.  Its result is not an
accepted room transform, a registration approval, or architectural evidence.
It deliberately has no CLI and writes no files.

Recovered algorithm, kept literal here:

* load every BIG OBJ vertex with trimesh ``process=False`` and
  ``maintain_order=True``;
* select MatterPak vertices referenced by faces whose active OBJ group ends in
  ``_group001_sub009``;
* apply the +90 degree Z / +2.3 m initial transform to every BIG vertex and
  retain vertices inside the MatterPak target AABB padded by 0.75 m;
* run exactly 40 mutual-nearest-neighbour/Kabsch updates, using the recovered
  0.6/0.35/0.2/0.12 m threshold schedule and the *original* selected source
  coordinates for every full Kabsch fit.

All receipt floats are emitted as exact big-endian IEEE-754 binary64 bit
patterns (16 lowercase hexadecimal characters), and all large ordered
inventories are represented by domain-separated SHA-256 digests. Paths,
timestamps, and host names are intentionally absent.
"""

from __future__ import annotations

import hashlib
import io
import json
import math
import os
from pathlib import Path
import platform
import re
import stat
import struct
from typing import Any, Callable, Sequence

import numpy as np
import scipy
from scipy.spatial import cKDTree
import trimesh


SCHEMA_VERSION = "venviewer.grand-hall.authority-none-icp-replay.v1"
SEED_ADAPTER_SCHEMA_VERSION = (
    "venviewer.grand-hall.authority-none-icp-seed-adapter.v1"
)
SOURCE_LOGICAL_ID = "xgrids-grand-hall-big-obj"
TARGET_LOGICAL_ID = "matterpak-grand-hall-room9-obj"
TARGET_GROUP_SUFFIX = "_group001_sub009"
ITERATION_COUNT = 40
ENVELOPE_PADDING_METRES = 0.75
TIE_ULP_FACTOR = 32.0
DEGENERACY_RELATIVE_LIMIT = 1e-12
LOGICAL_ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,127}$")

INITIAL_ROTATION = np.asarray(
    [[0.0, -1.0, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0]],
    dtype=np.float64,
)
INITIAL_TRANSLATION = np.asarray([0.0, 0.0, 2.3], dtype=np.float64)


class ReplayGuardError(RuntimeError):
    """Raised when replay evidence is ambiguous, degenerate, or non-finite."""


def canonical_json_bytes(value: Any) -> bytes:
    """Return the path-independent canonical JSON representation of ``value``."""

    return json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def canonical_json_sha256(value: Any) -> str:
    return hashlib.sha256(canonical_json_bytes(value)).hexdigest()


def _file_identity(value: os.stat_result) -> tuple[int, int, int, int, int]:
    return (
        value.st_dev,
        value.st_ino,
        stat.S_IFMT(value.st_mode),
        value.st_size,
        value.st_mtime_ns,
    )


def _stable_regular_file_snapshot(
    path: Path,
    *,
    label: str,
    after_read_before_final_stat: Callable[[], None] | None = None,
) -> tuple[bytes, str]:
    """Read one immutable byte snapshot and reject path/handle identity drift."""

    try:
        before = path.lstat()
        reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
        attributes = getattr(before, "st_file_attributes", 0)
        if stat.S_ISLNK(before.st_mode) or (
            reparse_flag and attributes & reparse_flag
        ):
            raise ReplayGuardError(f"{label} must not be a link or reparse point")
        if not stat.S_ISREG(before.st_mode):
            raise ReplayGuardError(f"{label} is not a regular file")
        with path.open("rb") as stream:
            opened = os.fstat(stream.fileno())
            payload = stream.read()
            after_open = os.fstat(stream.fileno())
        if after_read_before_final_stat is not None:
            after_read_before_final_stat()
        after = path.lstat()
    except ReplayGuardError:
        raise
    except OSError as error:
        raise ReplayGuardError(f"{label} could not be read stably") from error
    identities = {
        _file_identity(before),
        _file_identity(opened),
        _file_identity(after_open),
        _file_identity(after),
    }
    if len(identities) != 1 or len(payload) != opened.st_size:
        raise ReplayGuardError(f"{label} changed while it was being read")
    return payload, hashlib.sha256(payload).hexdigest()


def _validate_logical_id(value: str, field: str) -> str:
    if LOGICAL_ID_RE.fullmatch(value) is None:
        raise ReplayGuardError(
            f"{field} must be a path-free lowercase logical identifier"
        )
    return value


def _finite_float64_array(value: Any, *, name: str, ndim: int | None = None) -> np.ndarray:
    array = np.asarray(value, dtype=np.float64)
    if ndim is not None and array.ndim != ndim:
        raise ReplayGuardError(f"{name} must have {ndim} dimensions")
    if not np.all(np.isfinite(array)):
        raise ReplayGuardError(f"{name} contains a non-finite value")
    return np.ascontiguousarray(array, dtype=np.float64)


def _little_endian_array(value: Any, dtype: str, *, name: str) -> np.ndarray:
    array = np.asarray(value)
    target_dtype = np.dtype(dtype)
    try:
        converted = np.ascontiguousarray(array.astype(target_dtype, copy=False))
    except (OverflowError, TypeError, ValueError) as error:
        raise ReplayGuardError(f"{name} cannot be represented as {dtype}") from error
    if target_dtype.kind == "f" and not np.all(np.isfinite(converted)):
        raise ReplayGuardError(f"{name} contains a non-finite value")
    return converted


def _ordered_array_sha256(value: Any, dtype: str, *, name: str) -> str:
    """Hash shape, declared little-endian dtype, and C-order array bytes."""

    array = _little_endian_array(value, dtype, name=name)
    digest = hashlib.sha256()
    digest.update(b"venviewer.ordered-ndarray.v1\x00")
    digest.update(array.dtype.str.encode("ascii"))
    digest.update(b"\x00")
    digest.update(struct.pack("<Q", array.ndim))
    for dimension in array.shape:
        digest.update(struct.pack("<Q", int(dimension)))
    digest.update(array.tobytes(order="C"))
    return digest.hexdigest()


def _raw_array_sha256(value: Any, dtype: str, *, name: str) -> str:
    """Hash only the exact C-order bytes after conversion to ``dtype``."""

    array = _little_endian_array(value, dtype, name=name)
    return hashlib.sha256(array.tobytes(order="C")).hexdigest()


def _float_hex(value: Any) -> str:
    number = float(np.float64(value))
    if not math.isfinite(number):
        raise ReplayGuardError("receipt float is non-finite")
    return struct.pack(">d", number).hex()


def _float_hex_list(value: Any) -> list[Any]:
    array = _finite_float64_array(value, name="receipt float array")
    if array.ndim == 0:
        return [_float_hex(array.item())]
    if array.ndim == 1:
        return [_float_hex(item) for item in array]
    return [_float_hex_list(row) for row in array]


def _threshold_for_iteration(iteration_index: int) -> float:
    if not 0 <= iteration_index < ITERATION_COUNT:
        raise ReplayGuardError("iteration index is outside the recovered 40-step run")
    if iteration_index < 8:
        return 0.6
    if iteration_index < 20:
        return 0.35
    if iteration_index < 32:
        return 0.2
    return 0.12


def _transform_points(points: np.ndarray, rotation: np.ndarray, translation: np.ndarray) -> np.ndarray:
    return np.ascontiguousarray(points @ rotation.T + translation, dtype=np.float64)


def _homogeneous_matrix(rotation: np.ndarray, translation: np.ndarray) -> np.ndarray:
    matrix = np.eye(4, dtype=np.float64)
    matrix[:3, :3] = rotation
    matrix[:3, 3] = translation
    return matrix


def _transform_receipt(rotation: np.ndarray, translation: np.ndarray) -> dict[str, Any]:
    matrix = _homogeneous_matrix(rotation, translation)
    return {
        "rotationFloat64HexRowMajor": _float_hex_list(rotation),
        "translationFloat64Hex": _float_hex_list(translation),
        "homogeneousFloat64HexRowMajor": _float_hex_list(matrix),
        "rotationPackedLittleEndianFloat64RawSha256": _raw_array_sha256(
            rotation, "<f8", name="rotation matrix"
        ),
        "translationPackedLittleEndianFloat64RawSha256": _raw_array_sha256(
            translation, "<f8", name="translation vector"
        ),
        "homogeneousPackedLittleEndianFloat64RawSha256": _raw_array_sha256(
            matrix, "<f8", name="homogeneous matrix"
        ),
        "homogeneousPackedLittleEndianFloat64DomainSeparatedSha256": _ordered_array_sha256(
            matrix, "<f8", name="homogeneous matrix"
        ),
        "rotationDeterminantFloat64Hex": _float_hex(np.linalg.det(rotation)),
    }


def _load_big_obj_vertices(path: Path) -> tuple[np.ndarray, dict[str, Any]]:
    payload, file_sha256 = _stable_regular_file_snapshot(path, label="BIG OBJ input")
    try:
        loaded = trimesh.load_mesh(
            io.BytesIO(payload),
            file_type="obj",
            process=False,
            maintain_order=True,
        )
    except Exception as error:  # trimesh exposes several backend exception types
        raise ReplayGuardError("trimesh could not load the BIG OBJ") from error
    if not isinstance(loaded, trimesh.Trimesh):
        raise ReplayGuardError("BIG OBJ did not load as one trimesh.Trimesh")

    vertices = _finite_float64_array(loaded.vertices, name="BIG OBJ vertices", ndim=2)
    if vertices.shape[1] != 3 or vertices.shape[0] < 4:
        raise ReplayGuardError("BIG OBJ must contain at least four 3D vertices")
    faces = np.asarray(loaded.faces)
    if faces.ndim != 2 or faces.shape[1] != 3:
        raise ReplayGuardError("trimesh BIG OBJ face inventory is not triangular")
    faces = _little_endian_array(faces, "<u8", name="BIG OBJ faces")
    if faces.size > 0 and int(faces.max()) >= vertices.shape[0]:
        raise ReplayGuardError("trimesh BIG OBJ face index is out of range")

    inventory = {
        "fileSizeBytes": len(payload),
        "fileSha256": file_sha256,
        "loader": {
            "library": "trimesh",
            "process": False,
            "maintainOrder": True,
            "resultType": "Trimesh",
        },
        "orderedVertexCount": int(vertices.shape[0]),
        "orderedVerticesPackedLittleEndianFloat64RawSha256": _raw_array_sha256(
            vertices, "<f8", name="BIG OBJ ordered vertices"
        ),
        "orderedVerticesPackedLittleEndianFloat64DomainSeparatedSha256": _ordered_array_sha256(
            vertices, "<f8", name="BIG OBJ ordered vertices"
        ),
        "orderedTriangleCount": int(faces.shape[0]),
        "orderedTrianglesPackedLittleEndianUint64RawSha256": _raw_array_sha256(
            faces, "<u8", name="BIG OBJ ordered triangles"
        ),
        "orderedTrianglesPackedLittleEndianUint64DomainSeparatedSha256": _ordered_array_sha256(
            faces, "<u8", name="BIG OBJ ordered triangles"
        ),
    }
    return vertices, inventory


def _resolve_obj_vertex_index(reference: str, vertex_count: int) -> int:
    vertex_field = reference.split("/", 1)[0]
    if vertex_field == "":
        raise ReplayGuardError("MatterPak OBJ face has an empty vertex reference")
    try:
        parsed = int(vertex_field, 10)
    except ValueError as error:
        raise ReplayGuardError("MatterPak OBJ face has a non-integer vertex reference") from error
    if parsed == 0:
        raise ReplayGuardError("MatterPak OBJ uses the forbidden zero vertex index")
    resolved = parsed - 1 if parsed > 0 else vertex_count + parsed
    if not 0 <= resolved < vertex_count:
        raise ReplayGuardError("MatterPak OBJ face references an unavailable vertex")
    return resolved


def _selected_face_inventory_sha256(
    face_ordinals_and_indices: Sequence[tuple[int, tuple[int, ...]]],
) -> str:
    digest = hashlib.sha256()
    digest.update(b"venviewer.obj-selected-face-inventory.v1\x00")
    digest.update(struct.pack("<Q", len(face_ordinals_and_indices)))
    for ordinal, indices in face_ordinals_and_indices:
        digest.update(struct.pack("<Q", ordinal))
        digest.update(struct.pack("<Q", len(indices)))
        for index in indices:
            digest.update(struct.pack("<Q", index))
    return digest.hexdigest()


def _load_matterpak_group_vertices(
    path: Path, group_suffix: str
) -> tuple[np.ndarray, dict[str, Any]]:
    payload, file_sha256 = _stable_regular_file_snapshot(
        path, label="MatterPak OBJ input"
    )
    if not group_suffix.startswith("_") or any(
        character in group_suffix for character in ("/", "\\", ":")
    ):
        raise ReplayGuardError("MatterPak group suffix is not a safe OBJ group suffix")

    vertices: list[tuple[float, float, float]] = []
    selected_faces: list[tuple[int, tuple[int, ...]]] = []
    active_group = ""
    global_face_ordinal = 0
    try:
        decoded = payload.decode("utf-8", errors="strict")
        with io.StringIO(decoded, newline=None) as stream:
            for line in stream:
                stripped = line.strip()
                if stripped == "" or stripped.startswith("#"):
                    continue
                fields = stripped.split()
                record = fields[0]
                if record == "v":
                    if len(fields) < 4:
                        raise ReplayGuardError("MatterPak OBJ vertex has fewer than three coordinates")
                    try:
                        point = tuple(float(value) for value in fields[1:4])
                    except ValueError as error:
                        raise ReplayGuardError("MatterPak OBJ vertex is not numeric") from error
                    if not all(math.isfinite(value) for value in point):
                        raise ReplayGuardError("MatterPak OBJ vertex is non-finite")
                    vertices.append((point[0], point[1], point[2]))
                elif record == "g":
                    active_group = stripped[1:].strip()
                elif record == "f":
                    if len(fields) < 4:
                        raise ReplayGuardError("MatterPak OBJ face has fewer than three vertices")
                    if active_group.endswith(group_suffix):
                        indices = tuple(
                            _resolve_obj_vertex_index(reference, len(vertices))
                            for reference in fields[1:]
                        )
                        selected_faces.append((global_face_ordinal, indices))
                    global_face_ordinal += 1
    except UnicodeError as error:
        raise ReplayGuardError("MatterPak OBJ is not strict UTF-8 text") from error

    if len(vertices) < 4:
        raise ReplayGuardError("MatterPak OBJ has fewer than four vertices")
    if len(selected_faces) == 0:
        raise ReplayGuardError("MatterPak OBJ has no faces in the required room9 group")

    # np.unique over face vertex indices was the recovered target selection.
    ordered_indices = np.asarray(
        sorted({index for _, indices in selected_faces for index in indices}),
        dtype=np.uint64,
    )
    all_vertices = _finite_float64_array(vertices, name="MatterPak OBJ vertices", ndim=2)
    target = np.ascontiguousarray(all_vertices[ordered_indices], dtype=np.float64)
    if target.shape[0] < 4:
        raise ReplayGuardError("MatterPak room9 target has fewer than four unique vertices")

    inventory = {
        "fileSizeBytes": len(payload),
        "fileSha256": file_sha256,
        "groupSelection": {
            "activeGroupPredicate": "active-group-string-ends-with",
            "suffix": group_suffix,
            "uniqueVertexOrdering": "ascending-global-zero-based-index",
        },
        "allOrderedVertexCount": int(all_vertices.shape[0]),
        "allOrderedVerticesPackedLittleEndianFloat64RawSha256": _raw_array_sha256(
            all_vertices, "<f8", name="MatterPak all vertices"
        ),
        "allOrderedVerticesPackedLittleEndianFloat64DomainSeparatedSha256": _ordered_array_sha256(
            all_vertices, "<f8", name="MatterPak all vertices"
        ),
        "globalFaceCount": global_face_ordinal,
        "selectedFaceCount": len(selected_faces),
        "selectedFaceInventoryDomainSeparatedSha256": _selected_face_inventory_sha256(
            selected_faces
        ),
        "selectedOrderedGlobalVertexIndexCount": int(ordered_indices.shape[0]),
        "selectedOrderedGlobalVertexIndicesPackedLittleEndianUint64RawSha256": _raw_array_sha256(
            ordered_indices, "<u8", name="MatterPak room9 ordered vertex indices"
        ),
        "selectedOrderedGlobalVertexIndicesPackedLittleEndianUint64DomainSeparatedSha256": _ordered_array_sha256(
            ordered_indices, "<u8", name="MatterPak room9 ordered vertex indices"
        ),
        "selectedOrderedVerticesPackedLittleEndianFloat64RawSha256": _raw_array_sha256(
            target, "<f8", name="MatterPak room9 ordered vertices"
        ),
        "selectedOrderedVerticesPackedLittleEndianFloat64DomainSeparatedSha256": _ordered_array_sha256(
            target, "<f8", name="MatterPak room9 ordered vertices"
        ),
    }
    return target, inventory


def _query_with_tie_audit(
    tree: cKDTree,
    query_points: np.ndarray,
    *,
    candidate_count: int,
    context: str,
) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    """Return historical k=1 choices and inventory every k=2 tie.

    The recovered real inputs contain duplicate coordinates in both point
    populations.  Rejecting their exact ties would make the historical run
    impossible to replay.  We therefore retain cKDTree's rank-1 choice, record
    every ambiguous query ordinal and candidate pair, and classify the replay
    as same-runtime/same-host only.  The two-run wrapper below is the fail-closed
    gate for this unavoidable implementation-defined choice.
    """

    if candidate_count < 2:
        raise ReplayGuardError(f"{context} has fewer than two nearest-neighbour candidates")
    # Preserve the recovered call literally for the neighbour used by ICP.
    # Asking cKDTree for k=2 can select a different ordinal at an exact tie, so
    # the second call below is evidence only and never supplies rank 1 to ICP.
    historical_distances, historical_indices = tree.query(query_points, workers=1)
    historical_distances = _finite_float64_array(
        historical_distances, name=f"{context} historical k=1 distances", ndim=1
    )
    historical_indices = np.ascontiguousarray(
        np.asarray(historical_indices, dtype=np.int64)
    )
    distances, indices = tree.query(query_points, k=2, workers=1)
    distances = _finite_float64_array(
        distances, name=f"{context} audit k=2 distances", ndim=2
    )
    indices = np.asarray(indices, dtype=np.int64)
    if (
        historical_distances.shape != (query_points.shape[0],)
        or historical_indices.shape != historical_distances.shape
        or distances.shape != (query_points.shape[0], 2)
        or indices.shape != distances.shape
    ):
        raise ReplayGuardError(f"{context} cKDTree query returned an unexpected shape")
    if (
        np.any(historical_indices < 0)
        or np.any(historical_indices >= candidate_count)
        or np.any(indices < 0)
        or np.any(indices >= candidate_count)
    ):
        raise ReplayGuardError(f"{context} cKDTree query returned an invalid index")

    audit_first = np.ascontiguousarray(distances[:, 0], dtype=np.float64)
    second = np.ascontiguousarray(distances[:, 1], dtype=np.float64)
    margin = second - audit_first
    scale = np.maximum(1.0, np.maximum(np.abs(audit_first), np.abs(second)))
    tolerance = TIE_ULP_FACTOR * np.finfo(np.float64).eps * scale
    if np.any(historical_distances != audit_first):
        raise ReplayGuardError(
            f"{context} historical k=1 and audit k=2 nearest distances differ"
        )
    exact_ties = second == audit_first
    guarded_ties = margin <= tolerance
    unambiguous = ~guarded_ties
    if np.any(historical_indices[unambiguous] != indices[unambiguous, 0]):
        raise ReplayGuardError(
            f"{context} historical k=1 and audit k=2 unambiguous indices differ"
        )
    exact_count = int(np.count_nonzero(exact_ties))
    guarded_count = int(np.count_nonzero(guarded_ties))
    exact_ordinals = np.ascontiguousarray(np.flatnonzero(exact_ties), dtype=np.int64)
    guarded_ordinals = np.ascontiguousarray(
        np.flatnonzero(guarded_ties), dtype=np.int64
    )
    tied_candidate_pairs = np.ascontiguousarray(
        indices[guarded_ordinals], dtype=np.int64
    )
    historical_choice_is_in_audited_pair = np.ascontiguousarray(
        np.any(
            tied_candidate_pairs
            == historical_indices[guarded_ordinals, np.newaxis],
            axis=1,
        ),
        dtype=np.uint8,
    )

    audit = {
        "queryCount": int(query_points.shape[0]),
        "candidateCount": candidate_count,
        "workers": 1,
        "auditNeighbourCount": 2,
        "historicalSelectionCall": "cKDTree.query(queryPoints, workers=1)",
        "auditCall": "cKDTree.query(queryPoints, k=2, workers=1)",
        "exactTieCount": exact_count,
        "guardedNearTieCountIncludingExact": guarded_count,
        "exactTieQueryOrdinals": [int(value) for value in exact_ordinals],
        "exactTieQueryOrdinalsPackedLittleEndianInt64RawSha256": _raw_array_sha256(
            exact_ordinals, "<i8", name=f"{context} exact tie query ordinals"
        ),
        "exactTieQueryOrdinalsPackedLittleEndianInt64DomainSeparatedSha256": _ordered_array_sha256(
            exact_ordinals, "<i8", name=f"{context} exact tie query ordinals"
        ),
        "guardedNearTieQueryOrdinalsIncludingExact": [
            int(value) for value in guarded_ordinals
        ],
        "guardedNearTieQueryOrdinalsPackedLittleEndianInt64DomainSeparatedSha256": _ordered_array_sha256(
            guarded_ordinals,
            "<i8",
            name=f"{context} guarded tie query ordinals",
        ),
        "guardedNearTieFirstSecondCandidateIndicesPackedLittleEndianInt64DomainSeparatedSha256": _ordered_array_sha256(
            tied_candidate_pairs,
            "<i8",
            name=f"{context} guarded tie candidate index pairs",
        ),
        "guardedNearTieHistoricalChoiceInAuditedPairPackedUint8DomainSeparatedSha256": _ordered_array_sha256(
            historical_choice_is_in_audited_pair,
            "|u1",
            name=f"{context} historical tied choice membership",
        ),
        "guardedNearTieHistoricalChoiceOutsideAuditedPairCount": int(
            np.count_nonzero(historical_choice_is_in_audited_pair == 0)
        ),
        "nearTieTolerance": "32 * float64-epsilon * max(1, abs(d1), abs(d2))",
        "minimumFirstToSecondDistanceMarginFloat64Hex": _float_hex(np.min(margin)),
        "nearestIndicesPackedLittleEndianInt64DomainSeparatedSha256": _ordered_array_sha256(
            historical_indices, "<i8", name=f"{context} nearest indices"
        ),
        "nearestDistancesPackedLittleEndianFloat64DomainSeparatedSha256": _ordered_array_sha256(
            historical_distances, "<f8", name=f"{context} nearest distances"
        ),
        "secondDistancesPackedLittleEndianFloat64DomainSeparatedSha256": _ordered_array_sha256(
            second, "<f8", name=f"{context} second distances"
        ),
    }
    return historical_distances, historical_indices, audit


def _mutual_correspondences(
    source_transformed: np.ndarray,
    target: np.ndarray,
    target_tree: cKDTree,
    threshold: float,
    *,
    context: str,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, dict[str, Any], np.ndarray]:
    forward_distances, forward_target_indices, forward_audit = _query_with_tie_audit(
        target_tree,
        source_transformed,
        candidate_count=target.shape[0],
        context=f"{context} source-to-target",
    )
    source_tree = cKDTree(source_transformed)
    _, reverse_source_indices, reverse_audit = _query_with_tie_audit(
        source_tree,
        target,
        candidate_count=source_transformed.shape[0],
        context=f"{context} target-to-source",
    )
    source_indices_all = np.arange(source_transformed.shape[0], dtype=np.int64)
    mutual_mask = (
        reverse_source_indices[forward_target_indices] == source_indices_all
    ) & (forward_distances < threshold)
    source_indices = np.ascontiguousarray(np.flatnonzero(mutual_mask), dtype=np.int64)
    target_indices = np.ascontiguousarray(
        forward_target_indices[source_indices], dtype=np.int64
    )
    selected_distances = np.ascontiguousarray(
        forward_distances[source_indices], dtype=np.float64
    )
    if source_indices.shape[0] < 4:
        raise ReplayGuardError(
            f"{context} has fewer than four mutual correspondences under the threshold"
        )

    pairs = np.column_stack((source_indices, target_indices)).astype(
        np.int64, copy=False
    )
    audit = {
        "forward": forward_audit,
        "reverse": reverse_audit,
        "thresholdComparison": "strict-less-than",
        "mutualPredicate": "reverseIndex[forwardIndex] == sourceIndex",
        "correspondenceCount": int(source_indices.shape[0]),
        "orderedSourceIndicesPackedLittleEndianInt64DomainSeparatedSha256": _ordered_array_sha256(
            source_indices, "<i8", name=f"{context} source correspondence indices"
        ),
        "orderedTargetIndicesPackedLittleEndianInt64DomainSeparatedSha256": _ordered_array_sha256(
            target_indices, "<i8", name=f"{context} target correspondence indices"
        ),
        "orderedSourceTargetPairsPackedLittleEndianInt64RawSha256": _raw_array_sha256(
            pairs, "<i8", name=f"{context} correspondence pairs"
        ),
        "orderedSourceTargetPairsPackedLittleEndianInt64DomainSeparatedSha256": _ordered_array_sha256(
            pairs, "<i8", name=f"{context} correspondence pairs"
        ),
        "prefitDistancesPackedLittleEndianFloat64RawSha256": _raw_array_sha256(
            selected_distances, "<f8", name=f"{context} correspondence distances"
        ),
        "prefitDistancesPackedLittleEndianFloat64DomainSeparatedSha256": _ordered_array_sha256(
            selected_distances, "<f8", name=f"{context} correspondence distances"
        ),
    }
    return source_indices, target_indices, selected_distances, audit, forward_distances


def _rank_guard_singular_values(centered: np.ndarray, *, name: str) -> np.ndarray:
    singular_values = _finite_float64_array(
        np.linalg.svd(centered, full_matrices=False, compute_uv=False),
        name=f"{name} singular values",
        ndim=1,
    )
    if singular_values.shape[0] != 3 or singular_values[0] <= 0.0:
        raise ReplayGuardError(f"{name} does not span three dimensions")
    limit = max(
        singular_values[0] * DEGENERACY_RELATIVE_LIMIT,
        np.finfo(np.float64).eps,
    )
    if singular_values[2] <= limit:
        raise ReplayGuardError(
            f"{name} is rank-deficient under the deterministic Kabsch guard"
        )
    return singular_values


def _fit_kabsch(
    source_original: np.ndarray,
    target_matched: np.ndarray,
    *,
    context: str,
) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    source = _finite_float64_array(source_original, name=f"{context} source", ndim=2)
    target = _finite_float64_array(target_matched, name=f"{context} target", ndim=2)
    if source.shape != target.shape or source.shape[1] != 3 or source.shape[0] < 4:
        raise ReplayGuardError(f"{context} Kabsch inputs must be matching N-by-3 arrays, N>=4")

    source_centroid = np.mean(source, axis=0, dtype=np.float64)
    target_centroid = np.mean(target, axis=0, dtype=np.float64)
    source_centered = source - source_centroid
    target_centered = target - target_centroid
    source_geometry_singular_values = _rank_guard_singular_values(
        source_centered, name=f"{context} source correspondence geometry"
    )
    target_geometry_singular_values = _rank_guard_singular_values(
        target_centered, name=f"{context} target correspondence geometry"
    )

    covariance = source_centered.T @ target_centered
    u, covariance_singular_values, vt = np.linalg.svd(covariance)
    u = _finite_float64_array(u, name=f"{context} Kabsch U", ndim=2)
    vt = _finite_float64_array(vt, name=f"{context} Kabsch Vt", ndim=2)
    covariance_singular_values = _finite_float64_array(
        covariance_singular_values,
        name=f"{context} covariance singular values",
        ndim=1,
    )
    uncorrected_rotation = vt.T @ u.T
    uncorrected_determinant = float(np.linalg.det(uncorrected_rotation))
    determinant_correction_applied = uncorrected_determinant < 0.0
    if determinant_correction_applied:
        vt = vt.copy()
        vt[-1, :] *= -1.0
    rotation = _finite_float64_array(
        vt.T @ u.T, name=f"{context} fitted rotation", ndim=2
    )
    translation = _finite_float64_array(
        target_centroid - rotation @ source_centroid,
        name=f"{context} fitted translation",
        ndim=1,
    )
    determinant = float(np.linalg.det(rotation))
    if abs(determinant - 1.0) > 1e-10:
        raise ReplayGuardError(f"{context} fitted rotation determinant is not +1")

    fit_audit = {
        "method": "numpy-svd-kabsch",
        "fitCoordinates": "full-original-selected-source-to-current-matched-target",
        "correspondenceCount": int(source.shape[0]),
        "sourceCentroidFloat64Hex": _float_hex_list(source_centroid),
        "targetCentroidFloat64Hex": _float_hex_list(target_centroid),
        "sourceGeometrySingularValuesFloat64Hex": _float_hex_list(
            source_geometry_singular_values
        ),
        "targetGeometrySingularValuesFloat64Hex": _float_hex_list(
            target_geometry_singular_values
        ),
        "covarianceSingularValuesFloat64Hex": _float_hex_list(
            covariance_singular_values
        ),
        "degeneracyRelativeLimitFloat64Hex": _float_hex(
            DEGENERACY_RELATIVE_LIMIT
        ),
        "uncorrectedRotationDeterminantFloat64Hex": _float_hex(
            uncorrected_determinant
        ),
        "determinantCorrectionApplied": determinant_correction_applied,
        "correctedRotationDeterminantFloat64Hex": _float_hex(determinant),
        "orderedSourcePointsPackedLittleEndianFloat64DomainSeparatedSha256": _ordered_array_sha256(
            source, "<f8", name=f"{context} Kabsch source points"
        ),
        "orderedTargetPointsPackedLittleEndianFloat64DomainSeparatedSha256": _ordered_array_sha256(
            target, "<f8", name=f"{context} Kabsch target points"
        ),
    }
    return rotation, translation, fit_audit


def _distance_stats(distances: np.ndarray) -> dict[str, Any]:
    values = _finite_float64_array(distances, name="distance statistics", ndim=1)
    if values.shape[0] == 0:
        raise ReplayGuardError("cannot summarize an empty distance inventory")
    return {
        "count": int(values.shape[0]),
        "minimumFloat64Hex": _float_hex(np.min(values)),
        "maximumFloat64Hex": _float_hex(np.max(values)),
        "meanFloat64Hex": _float_hex(np.mean(values, dtype=np.float64)),
        "medianFloat64Hex": _float_hex(np.median(values)),
        "rootMeanSquareFloat64Hex": _float_hex(
            np.sqrt(np.mean(values * values, dtype=np.float64))
        ),
        "p95LinearFloat64Hex": _float_hex(
            np.quantile(values, 0.95, method="linear")
        ),
        "packedLittleEndianFloat64RawSha256": _raw_array_sha256(
            values, "<f8", name="distance statistics inventory"
        ),
        "packedLittleEndianFloat64DomainSeparatedSha256": _ordered_array_sha256(
            values, "<f8", name="distance statistics inventory"
        ),
    }


def _seed_adapter_metrics(statistics: dict[str, Any]) -> dict[str, Any]:
    return {
        "minimumDistanceMetresFloat64Hex": statistics["minimumFloat64Hex"],
        "rootMeanSquareDistanceMetresFloat64Hex": statistics[
            "rootMeanSquareFloat64Hex"
        ],
        "meanDistanceMetresFloat64Hex": statistics["meanFloat64Hex"],
        "medianDistanceMetresFloat64Hex": statistics["medianFloat64Hex"],
        "p95DistanceMetresFloat64Hex": statistics["p95LinearFloat64Hex"],
        "maximumDistanceMetresFloat64Hex": statistics["maximumFloat64Hex"],
    }


def _build_seed_adapter(receipt: dict[str, Any]) -> dict[str, Any]:
    moving = receipt["inputs"]["moving"]
    fixed = receipt["inputs"]["fixed"]
    selection = receipt["sourceSelection"]
    iterations = receipt["iterations"]
    result = receipt["result"]
    last_iteration = iterations[-1]
    postfit_audit = result["finalMutualUnderLastThresholdAudit"]
    final_transform = result["finalTransform"]
    matrix = final_transform["homogeneousFloat64HexRowMajor"]
    flattened_matrix = [value for row in matrix for value in row]
    return {
        "schemaVersion": SEED_ADAPTER_SCHEMA_VERSION,
        "workerSchemaVersion": receipt["schemaVersion"],
        "authority": "none",
        "architecturalEvidence": False,
        "humanReviewRequiredBeforeAnyPromotion": True,
        "algorithmCanonicalJsonSha256": receipt[
            "algorithmCanonicalJsonSha256"
        ],
        "source": {
            "fileSha256": moving["fileSha256"],
            "fileSizeBytes": moving["fileSizeBytes"],
            "orderedVertexCount": moving["orderedVertexCount"],
            "orderedTriangleCount": moving["orderedTriangleCount"],
            "orderedVerticesPackedLittleEndianFloat64RawSha256": moving[
                "orderedVerticesPackedLittleEndianFloat64RawSha256"
            ],
            "selectedVertexCount": selection["selectedOrderedSourceIndexCount"],
            "selectedOrderedSourceIndicesPackedLittleEndianInt64RawSha256": selection[
                "selectedOrderedSourceIndicesPackedLittleEndianInt64RawSha256"
            ],
            "selectedOriginalVerticesPackedLittleEndianFloat64RawSha256": selection[
                "selectedOriginalVerticesPackedLittleEndianFloat64RawSha256"
            ],
        },
        "target": {
            "fileSha256": fixed["fileSha256"],
            "fileSizeBytes": fixed["fileSizeBytes"],
            "allOrderedVertexCount": fixed["allOrderedVertexCount"],
            "globalFaceCount": fixed["globalFaceCount"],
            "allOrderedVerticesPackedLittleEndianFloat64RawSha256": fixed[
                "allOrderedVerticesPackedLittleEndianFloat64RawSha256"
            ],
            "selectedFaceCount": fixed["selectedFaceCount"],
            "selectedVertexCount": fixed[
                "selectedOrderedGlobalVertexIndexCount"
            ],
            "selectedOrderedGlobalVertexIndicesPackedLittleEndianUint64RawSha256": fixed[
                "selectedOrderedGlobalVertexIndicesPackedLittleEndianUint64RawSha256"
            ],
            "selectedOrderedVerticesPackedLittleEndianFloat64RawSha256": fixed[
                "selectedOrderedVerticesPackedLittleEndianFloat64RawSha256"
            ],
        },
        "iterations": [
            {
                "iterationOrdinal": iteration["iterationIndex"] + 1,
                "thresholdMetresFloat64Hex": iteration[
                    "thresholdMetresFloat64Hex"
                ],
                "sourceVertexCount": selection[
                    "selectedOrderedSourceIndexCount"
                ],
                "targetVertexCount": fixed[
                    "selectedOrderedGlobalVertexIndexCount"
                ],
                "mutualCorrespondenceCount": iteration["correspondences"][
                    "correspondenceCount"
                ],
                "correspondencePairInventoryRawSha256": iteration[
                    "correspondences"
                ]["orderedSourceTargetPairsPackedLittleEndianInt64RawSha256"],
            }
            for iteration in iterations
        ],
        "lastFitInput": {
            "iterationOrdinal": ITERATION_COUNT,
            "correspondenceCount": last_iteration["correspondences"][
                "correspondenceCount"
            ],
            "correspondencePairInventoryRawSha256": last_iteration[
                "correspondences"
            ]["orderedSourceTargetPairsPackedLittleEndianInt64RawSha256"],
            "distanceInventoryRawSha256": last_iteration[
                "prefitCorrespondenceDistanceStats"
            ]["packedLittleEndianFloat64RawSha256"],
            "metrics": _seed_adapter_metrics(
                last_iteration["prefitCorrespondenceDistanceStats"]
            ),
        },
        "candidateArfToCvfRowMajorMatrixFloat64Hex": flattened_matrix,
        "finalTransformedSelectedSourcePackedLittleEndianFloat64RawSha256": result[
            "finalTransformedSelectedSourcePackedLittleEndianFloat64RawSha256"
        ],
        "postfitAllSourceToTarget": {
            "sourceVertexCount": result["finalAllSourceToTargetDistanceStats"][
                "count"
            ],
            "distanceInventoryRawSha256": result[
                "finalAllSourceToTargetDistanceStats"
            ]["packedLittleEndianFloat64RawSha256"],
            "metrics": _seed_adapter_metrics(
                result["finalAllSourceToTargetDistanceStats"]
            ),
        },
        "postfitMutualAudit": {
            "thresholdMetresFloat64Hex": _float_hex(
                _threshold_for_iteration(ITERATION_COUNT - 1)
            ),
            "correspondenceCount": result[
                "finalMutualUnderLastThresholdCount"
            ],
            "correspondencePairInventoryRawSha256": postfit_audit[
                "orderedSourceTargetPairsPackedLittleEndianInt64RawSha256"
            ],
            "distanceInventoryRawSha256": result[
                "finalMutualUnderLastThresholdDistanceStats"
            ]["packedLittleEndianFloat64RawSha256"],
            "metrics": _seed_adapter_metrics(
                result["finalMutualUnderLastThresholdDistanceStats"]
            ),
            "exactNearestNeighbourTies": [
                {
                    "direction": "source_to_target",
                    "tiedQueryVertexCount": postfit_audit["forward"][
                        "exactTieCount"
                    ],
                    "tiedQueryVertexOrdinalsPackedLittleEndianInt64RawSha256": postfit_audit[
                        "forward"
                    ]["exactTieQueryOrdinalsPackedLittleEndianInt64RawSha256"],
                },
                {
                    "direction": "target_to_source",
                    "tiedQueryVertexCount": postfit_audit["reverse"][
                        "exactTieCount"
                    ],
                    "tiedQueryVertexOrdinalsPackedLittleEndianInt64RawSha256": postfit_audit[
                        "reverse"
                    ]["exactTieQueryOrdinalsPackedLittleEndianInt64RawSha256"],
                },
            ],
        },
    }


def replay_grand_hall_authority_none_icp(
    big_obj_path: str | Path,
    matterpak_obj_path: str | Path,
    *,
    source_logical_id: str = SOURCE_LOGICAL_ID,
    target_logical_id: str = TARGET_LOGICAL_ID,
) -> dict[str, Any]:
    """Replay the recovered 24,977-point diagnostic and return its receipt.

    The paths are used only for reading and hashing.  Neither path is copied to
    the result.  A guard failure raises ``ReplayGuardError`` and produces no
    partial receipt.
    """

    source_id = _validate_logical_id(source_logical_id, "source_logical_id")
    target_id = _validate_logical_id(target_logical_id, "target_logical_id")
    big_path = Path(big_obj_path)
    matterpak_path = Path(matterpak_obj_path)

    source_all, source_inventory = _load_big_obj_vertices(big_path)
    target, target_inventory = _load_matterpak_group_vertices(
        matterpak_path, TARGET_GROUP_SUFFIX
    )

    target_minimum = np.min(target, axis=0)
    target_maximum = np.max(target, axis=0)
    initial_transformed_all = _transform_points(
        source_all, INITIAL_ROTATION, INITIAL_TRANSLATION
    )
    lower_bound = target_minimum - ENVELOPE_PADDING_METRES
    upper_bound = target_maximum + ENVELOPE_PADDING_METRES
    selection_mask = np.all(
        (initial_transformed_all >= lower_bound)
        & (initial_transformed_all <= upper_bound),
        axis=1,
    )
    selected_source_indices = np.ascontiguousarray(
        np.flatnonzero(selection_mask), dtype=np.int64
    )
    if selected_source_indices.shape[0] < 4:
        raise ReplayGuardError("padded target envelope selected fewer than four BIG vertices")
    source = np.ascontiguousarray(
        source_all[selected_source_indices], dtype=np.float64
    )
    selected_initial_transformed = np.ascontiguousarray(
        initial_transformed_all[selected_source_indices], dtype=np.float64
    )

    source_selection = {
        "selectionAuthority": "none-diagnostic-replay-only",
        "inputVertexPopulation": "all-trimesh-loaded-big-obj-vertices",
        "predicate": "all((Q >= targetMin - 0.75) & (Q <= targetMax + 0.75))",
        "comparison": "inclusive-lower-and-upper",
        "qDefinition": "Q = Xall @ initialRotation.T + initialTranslation",
        "paddingMetresFloat64Hex": _float_hex(ENVELOPE_PADDING_METRES),
        "targetMinimumFloat64Hex": _float_hex_list(target_minimum),
        "targetMaximumFloat64Hex": _float_hex_list(target_maximum),
        "paddedLowerBoundFloat64Hex": _float_hex_list(lower_bound),
        "paddedUpperBoundFloat64Hex": _float_hex_list(upper_bound),
        "selectedOrderedSourceIndexCount": int(selected_source_indices.shape[0]),
        "selectedOrderedSourceIndicesPackedLittleEndianInt64RawSha256": _raw_array_sha256(
            selected_source_indices, "<i8", name="selected BIG vertex indices"
        ),
        "selectedOrderedSourceIndicesPackedLittleEndianInt64DomainSeparatedSha256": _ordered_array_sha256(
            selected_source_indices, "<i8", name="selected BIG vertex indices"
        ),
        "selectedOriginalVerticesPackedLittleEndianFloat64RawSha256": _raw_array_sha256(
            source, "<f8", name="selected BIG original vertices"
        ),
        "selectedOriginalVerticesPackedLittleEndianFloat64DomainSeparatedSha256": _ordered_array_sha256(
            source, "<f8", name="selected BIG original vertices"
        ),
        "selectedInitialTransformedVerticesPackedLittleEndianFloat64RawSha256": _raw_array_sha256(
            selected_initial_transformed,
            "<f8",
            name="selected BIG initial transformed vertices",
        ),
        "selectedInitialTransformedVerticesPackedLittleEndianFloat64DomainSeparatedSha256": _ordered_array_sha256(
            selected_initial_transformed,
            "<f8",
            name="selected BIG initial transformed vertices",
        ),
    }

    rotation = INITIAL_ROTATION.copy()
    translation = INITIAL_TRANSLATION.copy()
    target_tree = cKDTree(target)
    iterations: list[dict[str, Any]] = []
    for iteration_index in range(ITERATION_COUNT):
        threshold = _threshold_for_iteration(iteration_index)
        transform_before = _transform_receipt(rotation, translation)
        source_transformed = _transform_points(source, rotation, translation)
        source_indices, target_indices, prefit_distances, correspondence_audit, _ = (
            _mutual_correspondences(
                source_transformed,
                target,
                target_tree,
                threshold,
                context=f"iteration-{iteration_index}",
            )
        )
        rotation, translation, fit_audit = _fit_kabsch(
            source[source_indices],
            target[target_indices],
            context=f"iteration-{iteration_index}",
        )
        iterations.append(
            {
                "iterationIndex": iteration_index,
                "thresholdMetresFloat64Hex": _float_hex(threshold),
                "transformBefore": transform_before,
                "correspondences": correspondence_audit,
                "prefitCorrespondenceDistanceStats": _distance_stats(prefit_distances),
                "fit": fit_audit,
                "transformAfter": _transform_receipt(rotation, translation),
            }
        )

    final_transformed = _transform_points(source, rotation, translation)
    (
        final_source_indices,
        _,
        final_distances,
        final_query_audit,
        final_tree_distances,
    ) = _mutual_correspondences(
        final_transformed,
        target,
        target_tree,
        _threshold_for_iteration(ITERATION_COUNT - 1),
        context="final-audit",
    )

    receipt: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "authority": {
            "classification": "none",
            "acceptedTransform": False,
            "architecturalEvidence": False,
            "claim": "recovered-historical-diagnostic-replay-only",
            "humanReviewRequiredBeforeAnyPromotion": True,
        },
        "runtime": {
            "pythonVersion": platform.python_version(),
            "numpyVersion": np.__version__,
            "scipyVersion": scipy.__version__,
            "trimeshVersion": trimesh.__version__,
            "bitExactComparisonRequiresSamePinnedNumericalRuntime": True,
        },
        "inputs": {
            "moving": {"logicalId": source_id, **source_inventory},
            "fixed": {"logicalId": target_id, **target_inventory},
        },
        "sourceSelection": source_selection,
        "algorithm": {
            "transformDirection": "xgrids-big-selected-source-to-matterpak-room9-target",
            "initialTransform": _transform_receipt(
                INITIAL_ROTATION, INITIAL_TRANSLATION
            ),
            "iterationPolicy": "fixed-count-with-no-early-exit",
            "iterationCount": ITERATION_COUNT,
            "convergenceClaim": False,
            "thresholdSchedule": [
                {
                    "startIterationInclusive": 0,
                    "endIterationInclusive": 7,
                    "metresFloat64Hex": _float_hex(0.6),
                },
                {
                    "startIterationInclusive": 8,
                    "endIterationInclusive": 19,
                    "metresFloat64Hex": _float_hex(0.35),
                },
                {
                    "startIterationInclusive": 20,
                    "endIterationInclusive": 31,
                    "metresFloat64Hex": _float_hex(0.2),
                },
                {
                    "startIterationInclusive": 32,
                    "endIterationInclusive": 39,
                    "metresFloat64Hex": _float_hex(0.12),
                },
            ],
            "nearestNeighbour": {
                "implementation": "scipy.spatial.cKDTree",
                "workers": 1,
                "directions": ["source-to-target", "target-to-source"],
                "tieAudit": "k=2; inventory exact and 32-float64-epsilon guarded near ties",
                "knownDuplicateCoordinatePolicy": "retain-cKDTree-rank1-and-require-exact-same-process-repeat",
                "determinismClassification": "same-runtime-same-host-only",
            },
            "correspondencePolicy": {
                "kind": "mutual-nearest-neighbour",
                "thresholdComparison": "strict-less-than",
            },
            "fit": {
                "kind": "Kabsch",
                "implementation": "numpy.linalg.svd",
                "sourceCoordinates": "full-original-selected-source",
                "determinantCorrection": True,
            },
        },
        "iterations": iterations,
        "result": {
            "status": "diagnostic-not-accepted",
            "iterationsExecuted": len(iterations),
            "convergenceClaim": False,
            "finalTransform": _transform_receipt(rotation, translation),
            "finalTransformedSelectedSourcePackedLittleEndianFloat64RawSha256": _raw_array_sha256(
                final_transformed,
                "<f8",
                name="final transformed selected source",
            ),
            "finalTransformedSelectedSourcePackedLittleEndianFloat64DomainSeparatedSha256": _ordered_array_sha256(
                final_transformed,
                "<f8",
                name="final transformed selected source",
            ),
            "finalAllSourceToTargetDistanceStats": _distance_stats(
                final_tree_distances
            ),
            "finalAllSourceToTargetQueryAudit": final_query_audit["forward"],
            "finalMutualUnderLastThresholdCount": int(final_source_indices.shape[0]),
            "finalMutualUnderLastThresholdDistanceStats": _distance_stats(
                final_distances
            ),
            "finalMutualUnderLastThresholdAudit": final_query_audit,
        },
        "guardrails": {
            "pathsIncludedInReceipt": False,
            "timestampsIncludedInReceipt": False,
            "writesFiles": False,
            "fixedIterationCount": True,
            "failsOnNonFiniteValues": True,
            "nearestNeighbourTiesInventoried": True,
            "nearestNeighbourTiesAloneRejected": False,
            "exactSameProcessRepeatedReceiptRequired": True,
            "failsOnRankDeficientKabschInputs": True,
            "doesNotInferArchitecture": True,
            "doesNotClaimRegistrationAcceptance": True,
        },
        "digestConventions": {
            "fileSha256": "sha256 of exact file bytes",
            "rawArraySha256": "sha256 of exact C-order bytes after the field-named explicit little-endian dtype conversion",
            "domainSeparatedArraySha256": "sha256 of venviewer.ordered-ndarray.v1 NUL, numpy dtype string, rank, uint64-le shape, then exact C-order array bytes",
            "canonicalReceiptSha256": "sha256 of UTF-8 canonical JSON with sorted keys, compact separators, finite values, and no path or timestamp fields",
        },
    }
    receipt["algorithmCanonicalJsonSha256"] = canonical_json_sha256(
        receipt["algorithm"]
    )
    receipt["seedAdapterV1"] = _build_seed_adapter(receipt)
    # Prove canonical JSON construction now; allow_nan=False is an additional
    # fail-closed check even though all receipt floats are hexadecimal strings.
    canonical_json_bytes(receipt)
    return receipt


def replay_grand_hall_authority_none_icp_twice(
    big_obj_path: str | Path,
    matterpak_obj_path: str | Path,
    *,
    source_logical_id: str = SOURCE_LOGICAL_ID,
    target_logical_id: str = TARGET_LOGICAL_ID,
) -> dict[str, Any]:
    """Replay twice and fail unless every canonical receipt byte is identical."""

    first = replay_grand_hall_authority_none_icp(
        big_obj_path,
        matterpak_obj_path,
        source_logical_id=source_logical_id,
        target_logical_id=target_logical_id,
    )
    second = replay_grand_hall_authority_none_icp(
        big_obj_path,
        matterpak_obj_path,
        source_logical_id=source_logical_id,
        target_logical_id=target_logical_id,
    )
    first_bytes = canonical_json_bytes(first)
    second_bytes = canonical_json_bytes(second)
    if first_bytes != second_bytes:
        raise ReplayGuardError(
            "same-process repeated replay differed; tied cKDTree choices are not reproducible"
        )
    validated = dict(first)
    validated["repeatedReplayValidation"] = {
        "sameProcessRunCount": 2,
        "canonicalReceiptBytesIdentical": True,
        "canonicalUnvalidatedReceiptSha256": hashlib.sha256(first_bytes).hexdigest(),
        "scope": "exact-full-receipt-including-correspondence-and-matrix-bytes",
    }
    canonical_json_bytes(validated)
    return validated


__all__ = [
    "ENVELOPE_PADDING_METRES",
    "INITIAL_ROTATION",
    "INITIAL_TRANSLATION",
    "ITERATION_COUNT",
    "ReplayGuardError",
    "SCHEMA_VERSION",
    "SEED_ADAPTER_SCHEMA_VERSION",
    "TARGET_GROUP_SUFFIX",
    "canonical_json_bytes",
    "canonical_json_sha256",
    "replay_grand_hall_authority_none_icp",
    "replay_grand_hall_authority_none_icp_twice",
]
