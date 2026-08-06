#!/usr/bin/env python3
"""Hash-bound LiDAR-colour to E57 Image2D orientation audit.

For each selected E57 station, this tool projects deterministic samples of the
station's coloured 3D points into each embedded skybox JPEG. It scores every
axis-aligned cube orientation, including mirrored alternatives, and compares
the winner with the E57-declared Image2D rotation.

This is a read-only calibration experiment. It does not establish training
rights, clear people/privacy content, or materialize a COLMAP dataset.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import io
import json
import math
import os
import platform
import sys
import tempfile
from pathlib import Path
from typing import Any, Sequence

import numpy as np
from PIL import Image, ImageDraw

import audit_e57_room_images as room_audit
from audit_e57_room_images import (
    AuditError,
    MAX_E57_BYTES,
    MAX_IMAGE_BYTES,
    _canonical_json_bytes,
    _finite,
    _intrinsic_record,
    _node_quaternion,
    _node_translation,
    _quat_to_matrix,
    _rotation_matrix_to_quaternion,
    _safe_regular_file,
    _same_file_identity,
    _sha256_file,
    e57_pose_to_colmap_vertical_flip,
    fail,
    parse_scan_ids,
    write_create_only,
)


SCHEMA_VERSION = "omnitwin.reception.e57-lidar-image-reprojection.v1"
DIGEST_DOMAIN = b"OMNITWIN_RECEPTION_E57_LIDAR_IMAGE_REPROJECTION_V1\0"
MIN_WINNER_NCC = 0.85
MIN_WINNER_MARGIN = 0.10
MIN_OVERLAP_POINTS = 5000
MIN_UNIQUE_VISIBLE_PIXELS = 5000
SPATIAL_GRID_SIZE = 8
MIN_OCCUPIED_GRID_CELLS = 24
MAX_STORED_POSE_GAP = 0.02
MIN_DEPTH = 0.05
MAX_TOOL_SOURCE_BYTES = 5_000_000
AXES = {
    "+X": np.asarray([1.0, 0.0, 0.0], dtype=np.float64),
    "-X": np.asarray([-1.0, 0.0, 0.0], dtype=np.float64),
    "+Y": np.asarray([0.0, 1.0, 0.0], dtype=np.float64),
    "-Y": np.asarray([0.0, -1.0, 0.0], dtype=np.float64),
    "+Z": np.asarray([0.0, 0.0, 1.0], dtype=np.float64),
    "-Z": np.asarray([0.0, 0.0, -1.0], dtype=np.float64),
}


def cube_orientation_candidates() -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for forward_name, forward in AXES.items():
        for right_name, right in AXES.items():
            if abs(float(np.dot(forward, right))) > 1e-9:
                continue
            proper_down = np.cross(forward, right)
            for mirrored, down in ((False, proper_down), (True, -proper_down)):
                handedness = "mirrored" if mirrored else "proper"
                candidates.append(
                    {
                        "id": f"forward_{forward_name}_right_{right_name}_{handedness}",
                        "forward": forward,
                        "right": right,
                        "down": down,
                        "mirrored": mirrored,
                    }
                )
    if len(candidates) != 48:
        fail("INTERNAL_CANDIDATE_ERROR", f"expected 48 cube candidates, got {len(candidates)}")
    return candidates


CANDIDATES = cube_orientation_candidates()
CANDIDATE_BY_ID = {str(candidate["id"]): candidate for candidate in CANDIDATES}


def _round(value: float, digits: int = 6) -> float:
    result = round(float(value), digits)
    return 0.0 if result == 0.0 else result


def _basis_record(forward: np.ndarray, right: np.ndarray, down: np.ndarray) -> dict[str, Any]:
    return {
        "forwardInData3DFrame": [_round(value, 9) for value in forward],
        "imageRightInData3DFrame": [_round(value, 9) for value in right],
        "imageDownInData3DFrame": [_round(value, 9) for value in down],
        "rightCrossDownDotForward": _round(float(np.dot(np.cross(right, down), forward)), 9),
    }


def project_points(
    points: np.ndarray,
    *,
    forward: np.ndarray,
    right: np.ndarray,
    down: np.ndarray,
    fx: float,
    fy: float,
    cx: float,
    cy: float,
    width: int,
    height: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    depth = points @ forward
    safe_depth = np.where(np.abs(depth) > 1e-12, depth, 1.0)
    u = cx + fx * (points @ right) / safe_depth
    v = cy + fy * (points @ down) / safe_depth
    valid = (
        (depth > MIN_DEPTH)
        & (u >= 0)
        & (u < width)
        & (v >= 0)
        & (v < height)
    )
    return u, v, depth, valid


def visible_pixel_selection(
    u: np.ndarray,
    v: np.ndarray,
    depth: np.ndarray,
    valid: np.ndarray,
    *,
    width: int,
    height: int,
) -> dict[str, Any]:
    """Select the nearest sampled point per quantized pixel and measure spread."""

    indexes = np.flatnonzero(valid)
    if not len(indexes):
        return {
            "indexes": indexes,
            "pixelX": np.asarray([], dtype=np.int64),
            "pixelY": np.asarray([], dtype=np.int64),
            "rawOverlapPoints": 0,
            "uniqueVisiblePixels": 0,
            "occupiedGridCells": 0,
            "occupiedGridFraction": 0.0,
        }
    pixel_x = np.floor(u[indexes]).astype(np.int64)
    pixel_y = np.floor(v[indexes]).astype(np.int64)
    pixel_ids = pixel_y * width + pixel_x
    order = np.lexsort((depth[indexes], pixel_ids))
    sorted_pixel_ids = pixel_ids[order]
    first = np.ones(len(order), dtype=bool)
    first[1:] = sorted_pixel_ids[1:] != sorted_pixel_ids[:-1]
    visible_indexes = indexes[order[first]]
    visible_x = np.floor(u[visible_indexes]).astype(np.int64)
    visible_y = np.floor(v[visible_indexes]).astype(np.int64)
    grid_x = np.minimum(visible_x * SPATIAL_GRID_SIZE // width, SPATIAL_GRID_SIZE - 1)
    grid_y = np.minimum(visible_y * SPATIAL_GRID_SIZE // height, SPATIAL_GRID_SIZE - 1)
    occupied_cells = int(len(np.unique(grid_y * SPATIAL_GRID_SIZE + grid_x)))
    return {
        "indexes": visible_indexes,
        "pixelX": visible_x,
        "pixelY": visible_y,
        "rawOverlapPoints": int(len(indexes)),
        "uniqueVisiblePixels": int(len(visible_indexes)),
        "occupiedGridCells": occupied_cells,
        "occupiedGridFraction": _round(
            occupied_cells / (SPATIAL_GRID_SIZE * SPATIAL_GRID_SIZE), 6
        ),
    }


def score_orientation(
    points: np.ndarray,
    point_luma: np.ndarray,
    image_luma: np.ndarray,
    *,
    forward: np.ndarray,
    right: np.ndarray,
    down: np.ndarray,
    fx: float,
    fy: float,
    cx: float,
    cy: float,
) -> dict[str, Any]:
    height, width = image_luma.shape
    u, v, depth, valid = project_points(
        points,
        forward=forward,
        right=right,
        down=down,
        fx=fx,
        fy=fy,
        cx=cx,
        cy=cy,
        width=width,
        height=height,
    )
    selection = visible_pixel_selection(
        u,
        v,
        depth,
        valid,
        width=width,
        height=height,
    )
    indexes = selection["indexes"]
    if len(indexes) < 2:
        return {
            "ncc": None,
            **{key: value for key, value in selection.items() if key not in {"indexes", "pixelX", "pixelY"}},
            "assessable": False,
        }
    pixel_y = selection["pixelY"]
    pixel_x = selection["pixelX"]
    sampled = image_luma[pixel_y, pixel_x].astype(np.float64)
    truth = point_luma[indexes].astype(np.float64)
    sampled -= float(np.mean(sampled))
    truth -= float(np.mean(truth))
    denominator = math.sqrt(float(np.dot(sampled, sampled) * np.dot(truth, truth)))
    if denominator <= 1e-12:
        return {
            "ncc": None,
            **{key: value for key, value in selection.items() if key not in {"indexes", "pixelX", "pixelY"}},
            "assessable": False,
        }
    return {
        "ncc": _round(float(np.dot(sampled, truth) / denominator), 6),
        **{key: value for key, value in selection.items() if key not in {"indexes", "pixelX", "pixelY"}},
        "assessable": True,
    }


def score_has_required_coverage(score: dict[str, Any]) -> bool:
    """Return whether a score is usable as a winner or hard negative."""

    return bool(
        score.get("assessable")
        and score.get("ncc") is not None
        and int(score.get("rawOverlapPoints", 0)) >= MIN_OVERLAP_POINTS
        and int(score.get("uniqueVisiblePixels", 0)) >= MIN_UNIQUE_VISIBLE_PIXELS
        and int(score.get("occupiedGridCells", 0)) >= MIN_OCCUPIED_GRID_CELLS
    )


def _angular_difference_degrees(first: np.ndarray, second: np.ndarray) -> float:
    first_vector = np.asarray(first, dtype=np.float64)
    second_vector = np.asarray(second, dtype=np.float64)
    denominator = float(np.linalg.norm(first_vector) * np.linalg.norm(second_vector))
    if denominator <= 1e-15:
        fail("INVALID_AXIS", "cannot compare a zero-length orientation axis")
    cosine = float(
        np.clip(np.dot(first_vector, second_vector) / denominator, -1.0, 1.0)
    )
    return _round(math.degrees(math.acos(cosine)), 6)


def _rotation_gap(first: np.ndarray, second: np.ndarray) -> dict[str, float]:
    relative = first.T @ second
    cosine = float(np.clip((np.trace(relative) - 1.0) / 2.0, -1.0, 1.0))
    return {
        "angleDegrees": _round(math.degrees(math.acos(cosine)), 9),
        "frobeniusNorm": _round(float(np.linalg.norm(first - second)), 12),
    }


def _basis_axis_gap_degrees(
    basis_record: dict[str, Any], candidate: dict[str, Any]
) -> float | None:
    try:
        forward = np.asarray(basis_record["forwardInData3DFrame"], dtype=np.float64)
        right = np.asarray(basis_record["imageRightInData3DFrame"], dtype=np.float64)
        down = np.asarray(basis_record["imageDownInData3DFrame"], dtype=np.float64)
    except (KeyError, TypeError, ValueError):
        return None
    if forward.shape != (3,) or right.shape != (3,) or down.shape != (3,):
        return None
    return max(
        _angular_difference_degrees(forward, candidate["forward"]),
        _angular_difference_degrees(right, candidate["right"]),
        _angular_difference_degrees(down, candidate["down"]),
    )


def _block_continuous_pose(row: dict[str, Any], status: str) -> None:
    continuous = row.get("continuousRawRasterColmapPoseCandidate")
    if isinstance(continuous, dict):
        continuous["status"] = status
        continuous["worldToCameraQuaternionWxyz"] = None
        continuous["translation"] = None
        continuous["meaning"] = (
            "No usable pose is emitted because this image did not pass the frozen mapping and declared-raster relationship gates."
        )


def derive_and_evaluate_fixed_mapping(
    rows: list[dict[str, Any]], discovery_scan_ids: Sequence[int]
) -> dict[str, Any]:
    """Freeze the six-name mapping on discovery scans, then test every row against it.

    The independent 48-way winner remains useful as a diagnostic on held-out scans,
    but it is never substituted for the discovery mapping during primary acceptance.
    """

    discovery_set = set(discovery_scan_ids)
    expected_names = {f"Skybox {index}" for index in range(6)}
    discovery_rows = [row for row in rows if int(row["scanId"]) in discovery_set]
    held_out_rows = [row for row in rows if int(row["scanId"]) not in discovery_set]
    winners_by_name: dict[str, set[str]] = {name: set() for name in expected_names}
    counts_by_name: dict[str, int] = {name: 0 for name in expected_names}
    for row in discovery_rows:
        name = str(row.get("name"))
        if name in expected_names:
            counts_by_name[name] += 1
            winners_by_name[name].add(str(row["winner"]["candidateId"]))

    expected_count = len(discovery_set)
    discovery_complete = bool(
        discovery_set
        and all(counts_by_name[name] == expected_count for name in expected_names)
    )
    discovery_unanimous = bool(
        discovery_complete
        and all(len(winners_by_name[name]) == 1 for name in expected_names)
    )
    fixed_mapping = (
        {
            name: next(iter(winners_by_name[name]))
            for name in sorted(expected_names)
        }
        if discovery_unanimous
        else {}
    )
    fixed_candidates = [
        CANDIDATE_BY_ID[candidate_id]
        for candidate_id in fixed_mapping.values()
        if candidate_id in CANDIDATE_BY_ID
    ]
    forward_axes = {
        tuple(float(value) for value in candidate["forward"])
        for candidate in fixed_candidates
    }
    mapping_is_bijection = bool(
        len(fixed_candidates) == 6
        and len(set(fixed_mapping.values())) == 6
        and all(not bool(candidate["mirrored"]) for candidate in fixed_candidates)
        and forward_axes
        == {tuple(float(value) for value in axis) for axis in AXES.values()}
    )

    for row in rows:
        role = "discovery" if int(row["scanId"]) in discovery_set else "held_out"
        row["evaluationRole"] = role
        name = str(row.get("name"))
        fixed_candidate_id = fixed_mapping.get(name)
        if not fixed_candidate_id:
            row["fixedMappingEvaluation"] = {
                "status": "blocked_discovery_mapping_not_unanimous_or_complete",
                "candidateId": None,
                "passesFixedRunAcceptanceThresholds": False,
                "declaredRawRasterRelationMatchesFixedCandidate": False,
            }
            _block_continuous_pose(
                row, "blocked_fixed_mapping_or_relation_failure"
            )
            continue

        diagnostics = {
            str(diagnostic.get("candidateId")): diagnostic
            for diagnostic in row.get("candidateDiagnostics", [])
        }
        fixed_score = diagnostics.get(fixed_candidate_id)
        if fixed_score is None:
            row["fixedMappingEvaluation"] = {
                "status": "blocked_fixed_candidate_missing_from_diagnostics",
                "candidateId": fixed_candidate_id,
                "passesFixedRunAcceptanceThresholds": False,
                "declaredRawRasterRelationMatchesFixedCandidate": False,
            }
            _block_continuous_pose(
                row, "blocked_fixed_mapping_or_relation_failure"
            )
            continue

        valid_alternatives = [
            diagnostic
            for candidate_id, diagnostic in diagnostics.items()
            if candidate_id != fixed_candidate_id
            and score_has_required_coverage(diagnostic)
        ]
        valid_alternatives.sort(
            key=lambda diagnostic: (
                float(diagnostic["ncc"]),
                str(diagnostic["candidateId"]),
            ),
            reverse=True,
        )
        best_alternative = valid_alternatives[0] if valid_alternatives else None
        fixed_coverage_pass = score_has_required_coverage(fixed_score)
        fixed_ncc = (
            float(fixed_score["ncc"])
            if fixed_score.get("ncc") is not None
            else None
        )
        fixed_margin = (
            fixed_ncc - float(best_alternative["ncc"])
            if fixed_ncc is not None and best_alternative is not None
            else None
        )
        fixed_score_pass = bool(
            fixed_coverage_pass
            and fixed_ncc is not None
            and fixed_ncc >= MIN_WINNER_NCC
            and fixed_margin is not None
            and fixed_margin >= MIN_WINNER_MARGIN
        )
        argmax_agrees = bool(
            str(row["winner"]["candidateId"]) == fixed_candidate_id
        )
        if fixed_score_pass and not argmax_agrees:
            fail(
                "INTERNAL_FIXED_MAPPING_RANKING_MISMATCH",
                "a fixed candidate passed its positive margin but did not equal the covered-candidate argmax",
            )

        relation = row.get(
            "declaredRotationPlusFileSpecificRawRasterRelation", {}
        )
        fixed_candidate = CANDIDATE_BY_ID.get(fixed_candidate_id)
        relation_axis_gap = (
            _basis_axis_gap_degrees(relation, fixed_candidate)
            if fixed_candidate is not None
            else None
        )
        relation_ncc = (
            float(relation["ncc"]) if relation.get("ncc") is not None else None
        )
        relation_gap = (
            fixed_ncc - relation_ncc
            if fixed_ncc is not None and relation_ncc is not None
            else None
        )
        converted_gap = relation.get(
            "convertedPoseGapFromSnappedEmpiricalWinner", {}
        )
        converted_gap_degrees = converted_gap.get("angleDegrees")
        relation_matches_fixed = bool(
            fixed_score_pass
            and score_has_required_coverage(relation)
            and relation_ncc is not None
            and relation_ncc >= MIN_WINNER_NCC
            and relation_gap is not None
            and relation_gap <= MAX_STORED_POSE_GAP
            and relation_axis_gap is not None
            and relation_axis_gap <= 0.05
            and converted_gap_degrees is not None
            and float(converted_gap_degrees) <= 0.05
        )
        primary_pass = bool(
            mapping_is_bijection and fixed_score_pass and relation_matches_fixed
        )
        row["fixedMappingEvaluation"] = {
            "status": "passes" if primary_pass else "fails",
            "candidateId": fixed_candidate_id,
            "ncc": fixed_score.get("ncc"),
            "rawOverlapPoints": fixed_score.get("rawOverlapPoints"),
            "uniqueVisiblePixels": fixed_score.get("uniqueVisiblePixels"),
            "occupiedGridCells": fixed_score.get("occupiedGridCells"),
            "bestCoveredAlternativeCandidateId": (
                best_alternative.get("candidateId")
                if best_alternative is not None
                else None
            ),
            "bestCoveredAlternativeNcc": (
                best_alternative.get("ncc")
                if best_alternative is not None
                else None
            ),
            "marginOverBestCoveredAlternative": (
                _round(fixed_margin, 6) if fixed_margin is not None else None
            ),
            "diagnosticArgmaxCandidateId": row["winner"]["candidateId"],
            "diagnosticArgmaxAgreesWithFixedMapping": argmax_agrees,
            "passesFixedRunAcceptanceThresholds": fixed_score_pass,
            "declaredRelationAxisGapFromFixedCandidateDegrees": relation_axis_gap,
            "declaredRelationNccGapBehindFixedCandidate": (
                _round(relation_gap, 6) if relation_gap is not None else None
            ),
            "declaredRawRasterRelationMatchesFixedCandidate": relation_matches_fixed,
            "primaryPass": primary_pass,
        }

        if not primary_pass:
            _block_continuous_pose(
                row, "blocked_fixed_mapping_or_relation_failure"
            )

    discovery_primary_pass = bool(
        discovery_unanimous
        and mapping_is_bijection
        and discovery_rows
        and all(
            bool(row["fixedMappingEvaluation"].get("primaryPass"))
            for row in discovery_rows
        )
    )
    held_out_primary_pass = bool(
        discovery_unanimous
        and mapping_is_bijection
        and held_out_rows
        and all(
            bool(row["fixedMappingEvaluation"].get("primaryPass"))
            for row in held_out_rows
        )
    )
    return {
        "discoveryRowsComplete": discovery_complete,
        "discoveryMappingUnanimous": discovery_unanimous,
        "discoveryMappingIsProperSixFaceBijection": mapping_is_bijection,
        "fixedMappingBySkyboxName": fixed_mapping,
        "discoveryWinnerCandidatesBySkyboxName": {
            name: sorted(winners_by_name[name]) for name in sorted(expected_names)
        },
        "discoveryPrimaryPass": discovery_primary_pass,
        "heldOutPrimaryPass": held_out_primary_pass,
        "allRowsPrimaryPass": bool(discovery_primary_pass and held_out_primary_pass),
    }


def _sample_scan(source: Any, scan_id: int, maximum_points: int) -> dict[str, Any]:
    header = source.get_header(scan_id)
    if not header.has_pose():
        fail("MISSING_DATA3D_POSE", f"scan {scan_id} has no declared Data3D pose")
    required = {"colorRed", "colorGreen", "colorBlue"}
    if not required.issubset(set(header.point_fields)):
        fail("POINT_COLOUR_UNAVAILABLE", f"scan {scan_id} has no complete RGB point colour")
    data = source.read_scan(scan_id, colors=True, transform=False)
    points = np.column_stack(
        [data["cartesianX"], data["cartesianY"], data["cartesianZ"]]
    ).astype(np.float32)
    colours = np.column_stack(
        [data["colorRed"], data["colorGreen"], data["colorBlue"]]
    ).astype(np.uint8)
    valid = np.all(np.isfinite(points), axis=1) & (np.linalg.norm(points, axis=1) > 0.2)
    valid_indexes = np.flatnonzero(valid)
    if not len(valid_indexes):
        fail("NO_VALID_POINTS", f"scan {scan_id} has no valid points")
    sample_count = min(maximum_points, len(valid_indexes))
    offsets = (np.arange(sample_count, dtype=np.int64) * len(valid_indexes)) // sample_count
    indexes = valid_indexes[offsets]
    sampled_points = np.ascontiguousarray(points[indexes].astype("<f4", copy=False))
    sampled_colours = np.ascontiguousarray(colours[indexes])
    digest = hashlib.sha256(
        b"OMNITWIN_E57_REPROJECTION_POINT_SAMPLE_V1\0"
        + sampled_points.tobytes()
        + sampled_colours.tobytes()
    ).hexdigest()
    point_luma = (
        0.2126 * sampled_colours[:, 0]
        + 0.7152 * sampled_colours[:, 1]
        + 0.0722 * sampled_colours[:, 2]
    ).astype(np.float32)
    scan_quaternion = _finite(header.rotation, f"scan {scan_id} quaternion")
    scan_translation = _finite(header.translation, f"scan {scan_id} translation")
    return {
        "header": header,
        "points": sampled_points,
        "colours": sampled_colours,
        "luma": point_luma,
        "sampleDigest": digest,
        "sourceValidPointCount": int(len(valid_indexes)),
        "sampleCount": int(sample_count),
        "scanQuaternion": scan_quaternion,
        "scanTranslation": scan_translation,
    }


def _jpeg_record(representation: Any, analysis_size: int, label: str) -> dict[str, Any]:
    intrinsic = _intrinsic_record(representation, label)
    blob = representation["jpegImage"]
    size_bytes = int(blob.byteCount())
    if size_bytes <= 0 or size_bytes > MAX_IMAGE_BYTES:
        fail("INVALID_EMBEDDED_IMAGE_SIZE", f"{label} has invalid JPEG byte count {size_bytes}")
    payload = bytearray(size_bytes)
    blob.read(payload, 0, size_bytes)
    digest = hashlib.sha256(payload).hexdigest()
    try:
        with Image.open(io.BytesIO(payload)) as opened:
            if opened.format != "JPEG":
                fail("IMAGE_FORMAT_MISMATCH", f"{label} blob is {opened.format}, expected JPEG")
            opened.load()
            rgb_full = opened.convert("RGB")
    except AuditError:
        raise
    except Exception as error:
        fail("IMAGE_DECODE_FAILED", f"could not decode {label}: {error}")
    source_width, source_height = rgb_full.size
    if (source_width, source_height) != (intrinsic["width"], intrinsic["height"]):
        fail(
            "IMAGE_DIMENSION_MISMATCH",
            f"{label} decoded dimensions do not match its E57 representation",
        )
    rgb = rgb_full.resize((analysis_size, analysis_size), Image.Resampling.LANCZOS)
    rgb_array = np.asarray(rgb, dtype=np.uint8)
    luma = (
        0.2126 * rgb_array[:, :, 0]
        + 0.7152 * rgb_array[:, :, 1]
        + 0.0722 * rgb_array[:, :, 2]
    ).astype(np.float32)
    fx_source = float(intrinsic["fxPixels"])
    fy_source = float(intrinsic["fyPixels"])
    principal_x = float(intrinsic["principalPointX"])
    principal_y = float(intrinsic["principalPointY"])
    return {
        "sizeBytes": size_bytes,
        "sha256": digest,
        "sourceWidth": source_width,
        "sourceHeight": source_height,
        "rgb": rgb_array,
        "luma": luma,
        "fx": fx_source * analysis_size / source_width,
        "fy": fy_source * analysis_size / source_height,
        "cx": principal_x * analysis_size / source_width,
        "cy": principal_y * analysis_size / source_height,
        "sourceIntrinsics": {
            "fx": _round(fx_source, 9),
            "fy": _round(fy_source, 9),
            "cx": _round(principal_x, 9),
            "cy": _round(principal_y, 9),
        },
    }


def _render_overlay(
    *,
    source_rgb: np.ndarray,
    points: np.ndarray,
    colours: np.ndarray,
    basis: dict[str, Any],
    fx: float,
    fy: float,
    cx: float,
    cy: float,
    label: str,
) -> bytes:
    height, width = source_rgb.shape[:2]
    u, v, depth, valid = project_points(
        points,
        forward=basis["forward"],
        right=basis["right"],
        down=basis["down"],
        fx=fx,
        fy=fy,
        cx=cx,
        cy=cy,
        width=width,
        height=height,
    )
    selection = visible_pixel_selection(
        u,
        v,
        depth,
        valid,
        width=width,
        height=height,
    )
    indexes = selection["indexes"]
    x = selection["pixelX"]
    y = selection["pixelY"]
    point_render = np.zeros_like(source_rgb)
    point_mask = np.zeros((height, width), dtype=bool)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            xx = np.clip(x + dx, 0, width - 1)
            yy = np.clip(y + dy, 0, height - 1)
            point_render[yy, xx] = colours[indexes]
            point_mask[yy, xx] = True
    blend = source_rgb.copy()
    blend[point_mask] = (
        0.45 * source_rgb[point_mask] + 0.55 * point_render[point_mask]
    ).astype(np.uint8)
    panel = np.concatenate([source_rgb, point_render, blend], axis=1)
    image = Image.fromarray(panel, mode="RGB")
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, panel.shape[1], 18), fill=(0, 0, 0))
    draw.text((4, 3), f"source | projected coloured LiDAR | blend — {label}", fill=(255, 255, 255))
    output = io.BytesIO()
    image.save(output, format="PNG", optimize=False)
    return output.getvalue()


def _finalize(report: dict[str, Any]) -> dict[str, Any]:
    payload = dict(report)
    payload.pop("payloadSha256", None)
    digest = hashlib.sha256(DIGEST_DOMAIN + _canonical_json_bytes(payload)).hexdigest()
    return {**payload, "payloadSha256": digest}


def _capture_code_sources() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    specifications = [
        ("reprojectionAuditTool", Path(__file__).resolve()),
        ("roomAuditDependency", Path(room_audit.__file__).resolve()),
    ]
    public_records: list[dict[str, Any]] = []
    private_records: list[dict[str, Any]] = []
    for role, path in specifications:
        stat = _safe_regular_file(path, role, MAX_TOOL_SOURCE_BYTES)
        digest = _sha256_file(path, stat, MAX_TOOL_SOURCE_BYTES)
        public_records.append(
            {
                "role": role,
                "fileName": path.name,
                "sizeBytes": stat.st_size,
                "sha256": digest,
            }
        )
        private_records.append(
            {"role": role, "path": path, "stat": stat, "sha256": digest}
        )
    return public_records, private_records


def _verify_code_sources_unchanged(captures: Sequence[dict[str, Any]]) -> None:
    for capture in captures:
        path = Path(capture["path"])
        after = _safe_regular_file(path, str(capture["role"]), MAX_TOOL_SOURCE_BYTES)
        if not _same_file_identity(capture["stat"], after):
            fail(
                "TOOL_CHANGED_DURING_AUDIT",
                f"{path.name} changed while the audit was running",
            )
        after_digest = _sha256_file(path, after, MAX_TOOL_SOURCE_BYTES)
        if after_digest != capture["sha256"]:
            fail(
                "TOOL_CHANGED_DURING_AUDIT",
                f"{path.name} content changed while the audit was running",
            )


def build_reprojection_audit(
    *,
    e57_path: Path,
    scan_ids: Sequence[int],
    maximum_points: int,
    analysis_size: int,
    overlay_dir: Path | None,
    overlay_scan_ids: Sequence[int] | None = None,
    discovery_scan_ids: Sequence[int] | None = None,
) -> dict[str, Any]:
    if not scan_ids or list(scan_ids) != sorted(set(scan_ids)):
        fail("INVALID_SCAN_SET", "scan IDs must be a non-empty, increasing unique list")
    if not (MIN_OVERLAP_POINTS <= maximum_points <= 2_000_000):
        fail("INVALID_ARGUMENT", "maximum points must be between 5,000 and 2,000,000")
    if not (128 <= analysis_size <= 2048):
        fail("INVALID_ARGUMENT", "analysis size must be between 128 and 2048")
    overlay_scan_set = set(overlay_scan_ids or [])
    if not overlay_scan_set.issubset(set(scan_ids)):
        fail("INVALID_ARGUMENT", "overlay scans must be a subset of audited scans")
    if bool(overlay_dir is not None) != bool(overlay_scan_set):
        fail(
            "INVALID_ARGUMENT",
            "overlay output directory and overlay scan IDs must be supplied together",
        )
    discovery_scan_set = set(discovery_scan_ids or [])
    if (
        len(discovery_scan_set) < 3
        or not discovery_scan_set.issubset(set(scan_ids))
        or discovery_scan_set == set(scan_ids)
    ):
        fail(
            "INVALID_ARGUMENT",
            "discovery scans must be at least three audited scans and leave at least one held-out scan",
        )
    code_source_records, code_source_captures = _capture_code_sources()
    before = _safe_regular_file(e57_path, "E57 source", MAX_E57_BYTES)
    source_sha256 = _sha256_file(e57_path, before, MAX_E57_BYTES)
    try:
        import pye57
    except ImportError:
        fail("PYE57_UNAVAILABLE", "pye57 is required")
    source = pye57.E57(str(e57_path))
    root = source.image_file.root()
    data3d = root["data3D"]
    images = root["images2D"]
    if any(scan_id < 0 or scan_id >= data3d.childCount() for scan_id in scan_ids):
        fail("SCAN_OUT_OF_RANGE", "selected scan is outside the E57")
    guid_to_images: dict[str, list[int]] = {}
    for image_index in range(images.childCount()):
        guid = str(images[image_index]["associatedData3DGuid"].value())
        guid_to_images.setdefault(guid, []).append(image_index)

    rows: list[dict[str, Any]] = []
    scan_records: list[dict[str, Any]] = []
    overlay_records: list[dict[str, Any]] = []
    mapping_by_name: dict[str, set[str]] = {}
    all_image_guids: set[str] = set()
    all_jpeg_hashes: set[str] = set()
    overlay_staging: Any | None = None
    overlay_write_dir: Path | None = None
    if overlay_dir is not None:
        if overlay_dir.exists():
            fail(
                "OUTPUT_EXISTS",
                "overlay directory already exists; evidence outputs are create-only",
            )
        overlay_dir.parent.mkdir(parents=True, exist_ok=True)
        overlay_staging = tempfile.TemporaryDirectory(
            prefix=f".{overlay_dir.name}.",
            suffix=".staging",
            dir=overlay_dir.parent,
        )
        overlay_write_dir = Path(overlay_staging.name)

    for scan_id in scan_ids:
        sampled = _sample_scan(source, scan_id, maximum_points)
        data3d_guid = str(data3d[scan_id]["guid"].value())
        image_indexes = sorted(
            guid_to_images.get(data3d_guid, []),
            key=lambda index: (
                str(images[index]["name"].value()),
                str(images[index]["guid"].value()),
            ),
        )
        if len(image_indexes) != 6:
            fail("IMAGE_COUNT_MISMATCH", f"scan {scan_id} has {len(image_indexes)} Image2D records")
        names = [str(images[index]["name"].value()) for index in image_indexes]
        if set(names) != {f"Skybox {index}" for index in range(6)} or len(set(names)) != 6:
            fail("IMAGE_NAME_SET_MISMATCH", f"scan {scan_id} does not contain Skybox 0 through Skybox 5 exactly once")
        image_guids = [str(images[index]["guid"].value()) for index in image_indexes]
        if len(set(image_guids)) != 6:
            fail("DUPLICATE_IMAGE2D_GUID", f"scan {scan_id} repeats an Image2D GUID")
        duplicates = all_image_guids.intersection(image_guids)
        if duplicates:
            fail(
                "DUPLICATE_IMAGE2D_GUID",
                f"scan {scan_id} repeats an Image2D GUID used by another selected scan",
            )
        all_image_guids.update(image_guids)
        scan_rotation = _quat_to_matrix(sampled["scanQuaternion"])
        scan_rows: list[dict[str, Any]] = []
        scan_jpeg_hashes: list[str] = []
        for image_index in image_indexes:
            image_node = images[image_index]
            name = str(image_node["name"].value())
            label = f"scan {scan_id} {name}"
            representation = image_node["pinholeRepresentation"]
            jpeg = _jpeg_record(representation, analysis_size, label)
            if str(jpeg["sha256"]) in all_jpeg_hashes:
                fail(
                    "DUPLICATE_IMAGE_BYTES",
                    f"{label} repeats embedded JPEG bytes used by another selected image",
                )
            all_jpeg_hashes.add(str(jpeg["sha256"]))
            image_quaternion, source_quaternion_norm = _node_quaternion(
                image_node["pose"]["rotation"], f"{label} quaternion"
            )
            image_translation = _node_translation(
                image_node["pose"]["translation"], f"{label} translation"
            )
            centre_delta = float(
                np.linalg.norm(
                    np.asarray(image_translation, dtype=np.float64)
                    - np.asarray(sampled["scanTranslation"], dtype=np.float64)
                )
            )
            if centre_delta > 1e-6:
                fail(
                    "IMAGE_SCAN_CENTRE_MISMATCH",
                    f"{label} centre differs from its Data3D centre by {centre_delta}",
                )
            local_camera = scan_rotation.T @ _quat_to_matrix(image_quaternion)
            stored_forward = local_camera @ np.asarray([0.0, 0.0, -1.0])
            legacy_positive_z_forward = local_camera @ np.asarray([0.0, 0.0, 1.0])
            stored_right = local_camera @ np.asarray([1.0, 0.0, 0.0])
            stored_down = local_camera @ np.asarray([0.0, 1.0, 0.0])
            stored_score = score_orientation(
                sampled["points"],
                sampled["luma"],
                jpeg["luma"],
                forward=stored_forward,
                right=stored_right,
                down=stored_down,
                fx=jpeg["fx"],
                fy=jpeg["fy"],
                cx=jpeg["cx"],
                cy=jpeg["cy"],
            )
            raw_raster_relation_down = -stored_down
            raw_raster_relation_score = score_orientation(
                sampled["points"],
                sampled["luma"],
                jpeg["luma"],
                forward=stored_forward,
                right=stored_right,
                down=raw_raster_relation_down,
                fx=jpeg["fx"],
                fy=jpeg["fy"],
                cx=jpeg["cx"],
                cy=analysis_size - jpeg["cy"],
            )
            legacy_positive_z_score = score_orientation(
                sampled["points"],
                sampled["luma"],
                jpeg["luma"],
                forward=legacy_positive_z_forward,
                right=stored_right,
                down=stored_down,
                fx=jpeg["fx"],
                fy=jpeg["fy"],
                cx=jpeg["cx"],
                cy=jpeg["cy"],
            )
            scored: list[tuple[float, str, dict[str, Any], dict[str, Any]]] = []
            for candidate in CANDIDATES:
                score = score_orientation(
                    sampled["points"],
                    sampled["luma"],
                    jpeg["luma"],
                    forward=candidate["forward"],
                    right=candidate["right"],
                    down=candidate["down"],
                    fx=jpeg["fx"],
                    fy=jpeg["fy"],
                    cx=jpeg["cx"],
                    cy=jpeg["cy"],
                )
                numeric = float(score["ncc"]) if score["ncc"] is not None else -2.0
                scored.append((numeric, str(candidate["id"]), candidate, score))
            scored.sort(key=lambda item: (item[0], item[1]), reverse=True)
            covered_scored = [
                item for item in scored if score_has_required_coverage(item[3])
            ]
            if len(covered_scored) < 2:
                fail(
                    "REPROJECTION_UNASSESSABLE",
                    f"{label} has fewer than two orientations with sufficient overlap and coverage",
                )
            winner_ncc, _, winner, winner_score = covered_scored[0]
            runner_ncc, _, runner, runner_score = covered_scored[1]
            margin = winner_ncc - runner_ncc
            stored_ncc = (
                float(stored_score["ncc"]) if stored_score["ncc"] is not None else -2.0
            )
            legacy_positive_z_ncc = (
                float(legacy_positive_z_score["ncc"])
                if legacy_positive_z_score["ncc"] is not None
                else -2.0
            )
            raw_raster_relation_ncc = (
                float(raw_raster_relation_score["ncc"])
                if raw_raster_relation_score["ncc"] is not None
                else -2.0
            )
            passes = bool(
                winner_ncc >= MIN_WINNER_NCC
                and margin >= MIN_WINNER_MARGIN
                and score_has_required_coverage(winner_score)
                and score_has_required_coverage(runner_score)
            )
            empirical_colmap_camera_to_scan = np.column_stack(
                [winner["right"], winner["down"], winner["forward"]]
            )
            empirical_colmap_camera_to_world = (
                scan_rotation @ empirical_colmap_camera_to_scan
            )
            colmap_pose_encodable = bool(
                not winner["mirrored"]
                and math.isclose(
                    float(np.linalg.det(empirical_colmap_camera_to_world)),
                    1.0,
                    abs_tol=1e-8,
                )
            )
            if colmap_pose_encodable:
                empirical_colmap_world_to_camera = empirical_colmap_camera_to_world.T
                empirical_colmap_translation = -empirical_colmap_world_to_camera @ np.asarray(
                    sampled["scanTranslation"], dtype=np.float64
                )
                empirical_colmap_quaternion = _rotation_matrix_to_quaternion(
                    empirical_colmap_world_to_camera
                )
            else:
                empirical_colmap_translation = None
                empirical_colmap_quaternion = None
            converted_world_to_camera, converted_translation = (
                e57_pose_to_colmap_vertical_flip(image_quaternion, image_translation)
            )
            converted_camera_to_world = converted_world_to_camera.T
            converted_pose_gap = _rotation_gap(
                empirical_colmap_camera_to_world,
                converted_camera_to_world,
            )
            raw_raster_relation_axis_gap = max(
                _angular_difference_degrees(stored_forward, winner["forward"]),
                _angular_difference_degrees(stored_right, winner["right"]),
                _angular_difference_degrees(raw_raster_relation_down, winner["down"]),
            )
            raw_raster_relation_matches = bool(
                passes
                and raw_raster_relation_score["assessable"]
                and raw_raster_relation_ncc >= MIN_WINNER_NCC
                and winner_ncc - raw_raster_relation_ncc <= MAX_STORED_POSE_GAP
                and score_has_required_coverage(raw_raster_relation_score)
                and raw_raster_relation_axis_gap <= 0.05
                and converted_pose_gap["angleDegrees"] <= 0.05
            )
            row = {
                "scanId": scan_id,
                "data3DGuid": data3d_guid,
                "image2DIndex": image_index,
                "image2DGuid": str(image_node["guid"].value()),
                "name": name,
                "jpeg": {
                    "sha256": jpeg["sha256"],
                    "sizeBytes": jpeg["sizeBytes"],
                    "width": jpeg["sourceWidth"],
                    "height": jpeg["sourceHeight"],
                },
                "declaredIntrinsics": jpeg["sourceIntrinsics"],
                "winner": {
                    "candidateId": winner["id"],
                    **_basis_record(winner["forward"], winner["right"], winner["down"]),
                    **winner_score,
                    "runnerUpCandidateId": runner["id"],
                    "runnerUpNcc": runner_score["ncc"],
                    "winnerMargin": _round(margin, 6),
                    "passesFixedRunAcceptanceThresholds": passes,
                },
                "candidateDiagnostics": [
                    {"candidateId": candidate["id"], **score}
                    for _, _, candidate, score in scored
                ],
                "declaredImage2DRotation": {
                    "status": "diagnostic_only_raw_raster_not_transformed",
                    "testedProjectionConvention": "official_E57_negative_camera_Z_applied_directly_to_raw_JPEG",
                    "sourceQuaternionNorm": _round(source_quaternion_norm, 10),
                    **_basis_record(stored_forward, stored_right, stored_down),
                    **stored_score,
                    "gapBehindWinner": _round(winner_ncc - stored_ncc, 6),
                    "forwardAngleFromWinnerDegrees": _angular_difference_degrees(
                        stored_forward, winner["forward"]
                    ),
                    "rightAngleFromWinnerDegrees": _angular_difference_degrees(
                        stored_right, winner["right"]
                    ),
                    "downAngleFromWinnerDegrees": _angular_difference_degrees(
                        stored_down, winner["down"]
                    ),
                    "meaning": "This deliberately omits the file-specific raw-raster vertical relation and is not the accepted conversion path.",
                },
                "declaredImage2DRotationLegacyPositiveZCheck": {
                    "status": "diagnostic_only_nonstandard_local_script_assumption",
                    "testedProjectionConvention": "legacy_local_script_positive_camera_Z_assumption",
                    **legacy_positive_z_score,
                    "gapBehindWinner": _round(winner_ncc - legacy_positive_z_ncc, 6),
                },
                "declaredRotationPlusFileSpecificRawRasterRelation": {
                    "status": (
                        "internally_consistent_coarse_axis_candidate"
                        if raw_raster_relation_matches
                        else "does_not_match_empirical_winner"
                    ),
                    "relationship": "raw JPEG vertical order is reversed relative to the documented E57 pinhole raster relationship",
                    "rasterTransformForMaterializer": "none_already_reflected_in_embedded_JPEG_relationship",
                    **_basis_record(
                        stored_forward,
                        stored_right,
                        raw_raster_relation_down,
                    ),
                    **raw_raster_relation_score,
                    "gapBehindWinner": _round(
                        winner_ncc - raw_raster_relation_ncc, 6
                    ),
                    "maximumAxisGapFromWinnerDegrees": raw_raster_relation_axis_gap,
                    "convertedPoseGapFromSnappedEmpiricalWinner": converted_pose_gap,
                    "matchesEmpiricalWinner": raw_raster_relation_matches,
                },
                "coarseEmpiricalRawRasterColmapPoseDiagnostic": {
                    "status": (
                        "internally_consistent_coarse_axis_candidate"
                        if colmap_pose_encodable and passes
                        else "blocked_mirrored_or_below_threshold"
                    ),
                    "rasterTransform": "none",
                    "worldToCameraQuaternionWxyz": empirical_colmap_quaternion,
                    "translation": (
                        [_round(value, 10) for value in empirical_colmap_translation]
                        if empirical_colmap_translation is not None
                        else None
                    ),
                    "cameraCentre": [_round(value, 10) for value in sampled["scanTranslation"]],
                    "meaning": "This snapped cardinal pose is a diagnostic cross-check. It discards the declared quaternion's small continuous precision and is not the preferred pose candidate.",
                },
                "continuousRawRasterColmapPoseCandidate": {
                    "status": (
                        "candidate_requires_continuous_and_independent_geometry_validation"
                        if raw_raster_relation_matches
                        else "blocked_relation_mismatch"
                    ),
                    "source": "E57 Image2D rotation transformed by diag(1,-1,-1), tested against the file-specific raw-JPEG/point-colour vertical relation",
                    "rasterTransform": "none",
                    "camera": {
                        "model": "PINHOLE",
                        "parameters": [
                            jpeg["sourceIntrinsics"]["fx"],
                            jpeg["sourceIntrinsics"]["fy"],
                            jpeg["sourceIntrinsics"]["cx"],
                            _round(
                                jpeg["sourceHeight"]
                                - jpeg["sourceIntrinsics"]["cy"],
                                9,
                            ),
                        ],
                        "principalYRule": "cy_raw_colmap = imageHeight - cy_e57 under the file-specific vertical raster relationship",
                    },
                    "worldToCameraQuaternionWxyz": (
                        _rotation_matrix_to_quaternion(converted_world_to_camera)
                        if raw_raster_relation_matches
                        else None
                    ),
                    "translation": (
                        [_round(value, 10) for value in converted_translation]
                        if raw_raster_relation_matches
                        else None
                    ),
                    "cameraCentre": [
                        _round(value, 10) for value in image_translation
                    ],
                    "meaning": (
                        "Use of the unchanged embedded JPEG is supported internally. Physical calibration still requires independent structural/depth-edge reprojection; no dataset is materialized."
                        if raw_raster_relation_matches
                        else "No usable pose is emitted because the declared-raster relationship did not pass this image's internal colour gate."
                    ),
                },
            }
            rows.append(row)
            scan_rows.append(row)
            scan_jpeg_hashes.append(str(jpeg["sha256"]))
            mapping_by_name.setdefault(name, set()).add(str(winner["id"]))
            if overlay_write_dir is not None and scan_id in overlay_scan_set:
                overlay_payload = _render_overlay(
                    source_rgb=jpeg["rgb"],
                    points=sampled["points"],
                    colours=sampled["colours"],
                    basis=winner,
                    fx=jpeg["fx"],
                    fy=jpeg["fy"],
                    cx=jpeg["cx"],
                    cy=jpeg["cy"],
                    label=f"scan {scan_id} {name} {winner['id']} NCC {winner_ncc:.3f}",
                )
                overlay_name = (
                    f"scan_{scan_id:03d}_image2d_{image_index:04d}_reprojection.png"
                )
                overlay_path = overlay_write_dir / overlay_name
                write_create_only(overlay_path, overlay_payload)
                overlay_records.append(
                    {
                        "scanId": scan_id,
                        "image2DGuid": row["image2DGuid"],
                        "fileName": overlay_name,
                        "sizeBytes": len(overlay_payload),
                        "sha256": hashlib.sha256(overlay_payload).hexdigest(),
                    }
                )
        if len(set(scan_jpeg_hashes)) != 6:
            fail("DUPLICATE_IMAGE_BYTES", f"scan {scan_id} repeats embedded JPEG bytes")
        winner_forward_axes = {
            tuple(float(value) for value in row["winner"]["forwardInData3DFrame"])
            for row in scan_rows
        }
        rig_bijection = bool(
            len({row["winner"]["candidateId"] for row in scan_rows}) == 6
            and winner_forward_axes
            == {tuple(float(value) for value in axis) for axis in AXES.values()}
        )
        scan_records.append(
            {
                "scanId": scan_id,
                "data3DGuid": data3d_guid,
                "sourceValidPointCount": sampled["sourceValidPointCount"],
                "deterministicPointSampleCount": sampled["sampleCount"],
                "pointSampleSha256": sampled["sampleDigest"],
                "allSixImagesPass": all(
                    row["winner"]["passesFixedRunAcceptanceThresholds"] for row in scan_rows
                ),
                "winnerRigIsSixFaceBijection": rig_bijection,
            }
        )

    after = _safe_regular_file(e57_path, "E57 source", MAX_E57_BYTES)
    if not _same_file_identity(before, after):
        fail("FILE_CHANGED_DURING_READ", "E57 source changed during the audit")
    _verify_code_sources_unchanged(code_source_captures)
    fixed_mapping_result = derive_and_evaluate_fixed_mapping(
        rows, sorted(discovery_scan_set)
    )
    for scan_record in scan_records:
        scan_rows = [
            row for row in rows if int(row["scanId"]) == int(scan_record["scanId"])
        ]
        scan_record["evaluationRole"] = (
            "discovery"
            if int(scan_record["scanId"]) in discovery_scan_set
            else "held_out"
        )
        scan_record["allSixFixedMappingScoresPass"] = bool(
            len(scan_rows) == 6
            and all(
                bool(
                    row["fixedMappingEvaluation"].get(
                        "passesFixedRunAcceptanceThresholds"
                    )
                )
                for row in scan_rows
            )
        )
        scan_record["allSixFixedMappingPrimaryPass"] = bool(
            len(scan_rows) == 6
            and all(
                bool(row["fixedMappingEvaluation"].get("primaryPass"))
                for row in scan_rows
            )
        )
    mapping_consistent = all(len(candidate_ids) == 1 for candidate_ids in mapping_by_name.values())
    all_winners_pass = all(
        row["winner"]["passesFixedRunAcceptanceThresholds"] for row in rows
    )
    all_winners_proper = all("_proper" in row["winner"]["candidateId"] for row in rows)
    all_scan_rigs_bijective = all(
        bool(scan["winnerRigIsSixFaceBijection"]) for scan in scan_records
    )
    all_raw_raster_relations_match_fixed = bool(
        rows
        and all(
            bool(
                row["fixedMappingEvaluation"].get(
                    "declaredRawRasterRelationMatchesFixedCandidate"
                )
            )
            for row in rows
        )
    )
    winner_values = [float(row["winner"]["ncc"]) for row in rows]
    margins = [float(row["winner"]["winnerMargin"]) for row in rows]
    fixed_values = [
        float(row["fixedMappingEvaluation"]["ncc"])
        for row in rows
        if row["fixedMappingEvaluation"].get("ncc") is not None
    ]
    fixed_margins = [
        float(row["fixedMappingEvaluation"]["marginOverBestCoveredAlternative"])
        for row in rows
        if row["fixedMappingEvaluation"].get("marginOverBestCoveredAlternative")
        is not None
    ]
    declared_rotation_status = (
        "declared_rotation_plus_file_specific_vertical_raster_relation_matches"
        if all_raw_raster_relations_match_fixed
        else "declared_rotation_raw_raster_relation_mismatch"
    )
    mapping_pass = bool(fixed_mapping_result["allRowsPrimaryPass"])
    mapping_sentence = (
        "The six-name mapping learned only from the discovery scans remained unchanged on every held-out scan, and every fixed face passed the NCC, hard-negative margin, unique-pixel, spatial-coverage, handedness, and declared-raster relationship gates."
        if mapping_pass
        else "The discovery-to-held-out test does not satisfy every frozen-mapping, threshold, handedness, and declared-raster relationship gate; inspect the per-image failures before drawing a pose conclusion."
    )
    declared_rotation_sentence = (
        "The raw-JPEG/point-colour relationship is vertically reversed relative to E57's documented pinhole raster convention; applying the standard camera-axis conversion to the stored rotation predicts the empirical raw-raster pose."
        if all_raw_raster_relations_match_fixed
        else "The stored rotation plus the tested file-specific vertical raster relationship does not consistently predict the frozen mapping."
    )
    report = {
        "schemaVersion": SCHEMA_VERSION,
        "scope": {
            "sourceE57FileName": e57_path.name,
            "sourceE57SizeBytes": before.st_size,
            "sourceE57Sha256": source_sha256,
            "scanIds": list(scan_ids),
            "imageCount": len(rows),
            "analysisSize": analysis_size,
            "maximumSamplePointsPerScan": maximum_points,
            "overlayScanIds": sorted(overlay_scan_set),
            "discoveryScanIds": sorted(discovery_scan_set),
            "heldOutScanIds": sorted(set(scan_ids).difference(discovery_scan_set)),
        },
        "runtime": {
            "python": platform.python_version(),
            "numpy": np.__version__,
            "pillow": getattr(Image, "__version__", "unknown"),
            "pye57": importlib.metadata.version("pye57"),
            "codeSourcesHashedBeforeAuditAndReverifiedAfter": code_source_records,
        },
        "fixedRunAcceptanceThresholds": {
            "minimumWinnerNcc": MIN_WINNER_NCC,
            "minimumWinnerMargin": MIN_WINNER_MARGIN,
            "minimumOverlapPoints": MIN_OVERLAP_POINTS,
            "minimumUniqueVisiblePixels": MIN_UNIQUE_VISIBLE_PIXELS,
            "spatialGridSize": SPATIAL_GRID_SIZE,
            "minimumOccupiedGridCells": MIN_OCCUPIED_GRID_CELLS,
            "maximumDeclaredPoseGapBehindWinner": MAX_STORED_POSE_GAP,
        },
        "method": {
            "candidateCountPerImage": len(CANDIDATES),
            "candidateFamily": "six forward axes x four perpendicular right axes x proper-or-mirrored down axis",
            "projection": "u=cx+fx*(point dot right)/(point dot forward); v=cy+fy*(point dot down)/(point dot forward)",
            "score": "Pearson normalized cross-correlation between embedded JPEG luminance and E57 point-colour luminance at projected samples",
            "sample": "deterministic equal-index sampling after invalid and sub-0.2-distance points are removed",
            "discoveryHeldOutProtocol": "The 48-way winner is used to freeze one Skybox-name mapping on discovery scans only. Held-out acceptance scores that frozen candidate against the best sufficiently covered alternative; the held-out 48-way argmax is diagnostic only.",
            "importantLimit": "E57 point colours may themselves derive from these embedded skyboxes. That makes this a strong internal orientation/registration test, not independent proof of external radiometric truth.",
            "additionalLimits": [
                "The search covers 48 discrete axis-aligned cube orientations, not continuous calibration offsets.",
                "The declared pinhole intrinsics are assumed; lens distortion is not fitted or independently tested.",
                "The score uses point colours and geometry directions but does not independently validate depth edges, metric depth, Data3D scan-to-world poses, or inter-station registration.",
            ],
        },
        "result": {
            "discoveryRowsComplete": fixed_mapping_result["discoveryRowsComplete"],
            "discoveryMappingUnanimous": fixed_mapping_result["discoveryMappingUnanimous"],
            "discoveryMappingIsProperSixFaceBijection": fixed_mapping_result[
                "discoveryMappingIsProperSixFaceBijection"
            ],
            "discoveryPrimaryPass": fixed_mapping_result["discoveryPrimaryPass"],
            "heldOutPrimaryPass": fixed_mapping_result["heldOutPrimaryPass"],
            "allFixedMappingRowsPrimaryPass": fixed_mapping_result[
                "allRowsPrimaryPass"
            ],
            "allEmpiricalWinnersPassDiagnostic": all_winners_pass,
            "empiricalWinnerMappingConsistentAcrossAllSelectedScansDiagnostic": mapping_consistent,
            "allEmpiricalWinnersAreProperRawRasterRotationsDiagnostic": all_winners_proper,
            "everyEmpiricalWinnerScanRigIsSixFaceBijectionDiagnostic": all_scan_rigs_bijective,
            "declaredRotationPlusFileSpecificRawRasterRelationMatchesFixedMapping": all_raw_raster_relations_match_fixed,
            "coarseDiscreteRigAxisMappingPassesInternalColourGate": mapping_pass,
            "declaredImage2DRotationStatus": declared_rotation_status,
            "declaredImage2DRotationDecision": declared_rotation_sentence,
            "winnerNcc": {
                "minimum": _round(min(winner_values), 6),
                "median": _round(float(np.median(winner_values)), 6),
                "maximum": _round(max(winner_values), 6),
            },
            "winnerMargin": {
                "minimum": _round(min(margins), 6),
                "median": _round(float(np.median(margins)), 6),
                "maximum": _round(max(margins), 6),
            },
            "fixedMappingNcc": (
                {
                    "minimum": _round(min(fixed_values), 6),
                    "median": _round(float(np.median(fixed_values)), 6),
                    "maximum": _round(max(fixed_values), 6),
                }
                if fixed_values
                else None
            ),
            "fixedMappingMargin": (
                {
                    "minimum": _round(min(fixed_margins), 6),
                    "median": _round(float(np.median(fixed_margins)), 6),
                    "maximum": _round(max(fixed_margins), 6),
                }
                if fixed_margins
                else None
            ),
            "fixedMappingBySkyboxName": fixed_mapping_result[
                "fixedMappingBySkyboxName"
            ],
            "discoveryWinnerCandidatesBySkyboxName": fixed_mapping_result[
                "discoveryWinnerCandidatesBySkyboxName"
            ],
            "empiricalMappingBySkyboxNameAcrossAllScansDiagnostic": {
                name: sorted(candidate_ids) for name, candidate_ids in sorted(mapping_by_name.items())
            },
            "knownPoseMaterializationPermitted": False,
            "trainingPermitted": False,
            "plainLanguage": (
                mapping_sentence
                + " "
                + declared_rotation_sentence
                + " This is a coarse internal colour gate, not continuous or independent physical calibration; no dataset is materialized or approved for training."
            ),
        },
        "scans": scan_records,
        "images": rows,
        "overlays": overlay_records,
        "requiredBeforeMaterialization": [
            "Independently validate structural or depth edges; point colours may come from the same JPEGs and therefore cannot prove physical calibration by themselves.",
            "Validate continuous focal length, principal point, distortion assumptions, and inter-station geometry rather than relying only on the 48 snapped cube directions.",
            "A person reviews every embedded 4096x4096 Image2D JPEG at full resolution and approves explicit privacy/tripod masks.",
            "Authoritative rights approval permits the intended commercial processing and training purpose.",
            "A separate materializer uses the transformed stored Image2D rotations only after the independent geometry gate passes, then verifies the emitted COLMAP fixture.",
        ],
        "authority": "none",
        "selfDigestMeaning": {
            "authenticatesCreator": False,
            "provesTimestamp": False,
            "provesImmutability": False,
            "plainLanguage": "The payload digest detects unrecomputed changes only; it is not a signature or trusted timestamp.",
        },
    }
    final_e57_stat = _safe_regular_file(e57_path, "E57 source", MAX_E57_BYTES)
    if not _same_file_identity(before, final_e57_stat):
        fail("FILE_CHANGED_DURING_READ", "E57 source changed before report publication")
    _verify_code_sources_unchanged(code_source_captures)
    finalized = _finalize(report)
    if overlay_dir is not None:
        if overlay_write_dir is None or overlay_staging is None:
            fail("INTERNAL_OVERLAY_ERROR", "overlay staging was not initialized")
        try:
            overlay_write_dir.rename(overlay_dir)
        except FileExistsError:
            fail(
                "OUTPUT_EXISTS",
                "overlay directory appeared during the audit; evidence outputs are create-only",
            )
        except OSError as error:
            fail("OUTPUT_WRITE_FAILED", f"could not publish overlay bundle: {error}")
        overlay_staging.cleanup()
    return finalized


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Audit E57 Image2D orientation by projecting coloured LiDAR points."
    )
    parser.add_argument("--e57", required=True, type=Path)
    parser.add_argument("--scans", required=True)
    parser.add_argument(
        "--discovery-scans",
        required=True,
        help="Audited scans used to learn and freeze the six-name mapping",
    )
    parser.add_argument("--maximum-points", type=int, default=120000)
    parser.add_argument("--analysis-size", type=int, default=512)
    parser.add_argument("--overlays", type=Path)
    parser.add_argument(
        "--overlay-scans",
        help="Optional audited scan subset for visual overlays, for example 125,130,144",
    )
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        output_path = args.output.resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        if output_path.exists():
            fail("OUTPUT_EXISTS", "output already exists; evidence files are create-only")
        if bool(args.overlays) != bool(args.overlay_scans):
            fail(
                "INVALID_ARGUMENT",
                "--overlays and --overlay-scans must be supplied together",
            )
        overlay_dir = args.overlays.resolve() if args.overlays else None
        report = build_reprojection_audit(
            e57_path=args.e57.resolve(strict=True),
            scan_ids=parse_scan_ids(args.scans),
            maximum_points=args.maximum_points,
            analysis_size=args.analysis_size,
            overlay_dir=overlay_dir,
            overlay_scan_ids=(
                parse_scan_ids(args.overlay_scans) if args.overlay_scans else []
            ),
            discovery_scan_ids=parse_scan_ids(args.discovery_scans),
        )
        write_create_only(output_path, _canonical_json_bytes(report) + b"\n")
        return 0
    except (AuditError, FileNotFoundError, ValueError) as error:
        if isinstance(error, AuditError):
            payload = {"error": {"code": error.code, "message": error.message}}
        else:
            payload = {"error": {"code": "INVALID_ARGUMENT", "message": str(error)}}
        sys.stderr.write(_canonical_json_bytes(payload).decode("utf-8") + "\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
