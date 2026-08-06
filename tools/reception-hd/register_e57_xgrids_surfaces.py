#!/usr/bin/env python3
"""Private structural computer-vision alignment diagnostic for Reception.

This bounded T-505 experiment uses Gaussian covariance normals and local-PCA
E57 normals to compare walls, floor, and ceiling.  It fits only a fixed-scale,
+Z-up yaw and translation.  A reflected family is optimized and reported as a
forbidden negative control.

The command is deliberately incapable of approving a transform, rights,
training, runtime use, or publication.  It reads only the frozen fit and
validation stations.  Frozen test-station geometry is never requested.
"""

from __future__ import annotations

import argparse
import copy
from dataclasses import dataclass, replace
import hashlib
import importlib
import io
import itertools
import json
import math
import numbers
import operator
import os
from pathlib import Path
import platform
import struct
import sys
import tempfile
import types
from typing import Any, Iterable, Mapping, Sequence


SCHEMA_VERSION = "omnitwin.reception.e57-xgrids-structural-cv-diagnostic.v1"
RECEIPT_DOMAIN = b"OMNITWIN_RECEPTION_E57_XGRIDS_STRUCTURAL_CV_V1\0"
EXPECTED_ALIGNMENT_TOOL_SIZE_BYTES = 90_503
EXPECTED_ALIGNMENT_TOOL_SHA256 = (
    "d8c5b1c00505a9ae3fb90071fe351bf3003330a784f724facb8d67c34761092d"
)
ALIGNMENT_TOOL_PATH = Path(__file__).with_name("align_e57_xgrids.py")

FIT_SCAN_IDS = (124, 125, 127, 128, 130, 132, 133, 135, 136, 137, 139, 142, 143, 144)
VALIDATION_SCAN_IDS = (131, 134, 138)
TEST_SCAN_IDS = (126, 129, 141)
UNASSIGNED_EXCLUDED_SCAN_IDS = (122, 123, 140)
DIAGNOSTIC_SCAN_IDS = FIT_SCAN_IDS + VALIDATION_SCAN_IDS

GAUSSIAN_FIELDS = (
    "x",
    "y",
    "z",
    "opacity",
    "scale_0",
    "scale_1",
    "scale_2",
    "rot_0",
    "rot_1",
    "rot_2",
    "rot_3",
)
LABEL_WALL = 0
LABEL_FLOOR = 1
LABEL_CEILING = 2
LABEL_NAMES = {LABEL_WALL: "wall", LABEL_FLOOR: "floor", LABEL_CEILING: "ceiling"}
MIN_SURFACES_PER_CLASS = 8
GAUSSIAN_SEQUENTIAL_SAMPLE_DENSITY_THRESHOLD = 0.01
PRIVATE_BLOCKED_BANNER = (
    "PRIVATE | AUTHORITY NONE | T-505 BLOCKED | test geometry 126/129/141 "
    "not decoded/scored; container bytes hashed"
)


class SurfaceAlignmentError(RuntimeError):
    """Stable fail-closed error for the structural diagnostic."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def fail(code: str, message: str) -> None:
    raise SurfaceAlignmentError(code, message)


_ALIGNMENT_MODULE: Any | None = None


def _get_alignment() -> Any:
    """Hash exact helper bytes before Python is allowed to execute them."""

    global _ALIGNMENT_MODULE
    if _ALIGNMENT_MODULE is not None:
        return _ALIGNMENT_MODULE
    try:
        payload = ALIGNMENT_TOOL_PATH.read_bytes()
    except OSError as error:
        fail("ALIGNMENT_TOOL_UNREADABLE", f"could not read pinned alignment tool: {error}")
    verify_alignment_tool_pin(payload)
    module_name = "_omnitwin_pinned_align_e57_xgrids_structural_cv"
    module = types.ModuleType(module_name)
    module.__file__ = str(ALIGNMENT_TOOL_PATH)
    module.__package__ = ""
    sys.modules[module_name] = module
    try:
        # Compile exactly the bytes that passed the pin.  A SourceFileLoader is
        # intentionally not used because it may consult __pycache__.
        code = compile(payload, str(ALIGNMENT_TOOL_PATH), "exec", dont_inherit=True)
        exec(code, module.__dict__)
        # Detect an edit that raced the exact-byte execution.
        if ALIGNMENT_TOOL_PATH.read_bytes() != payload:
            fail("ALIGNMENT_TOOL_CHANGED_DURING_IMPORT", "alignment helper changed during import")
    except Exception:
        sys.modules.pop(module_name, None)
        raise
    _ALIGNMENT_MODULE = module
    return module


@dataclass(frozen=True)
class SurfaceSet:
    points: Any
    normals: Any
    labels: Any
    weights: Any


@dataclass(frozen=True)
class StructuralConfig:
    gaussian_min_opacity: float = 0.08
    gaussian_min_scale_m: float = 1e-5
    gaussian_max_scale_m: float = 0.45
    gaussian_min_planar_ratio: float = 1.6
    gaussian_max_tangent_ratio: float = 30.0
    maximum_abs_coordinate_m: float = 1_000.0
    pca_neighbors: int = 24
    pca_max_neighbor_radius_m: float = 0.50
    pca_min_planarity: float = 0.35
    pca_max_surface_variation: float = 0.08
    pca_max_plane_residual_m: float = 0.06
    wall_max_abs_normal_z: float = 0.35
    horizontal_min_abs_normal_z: float = 0.90
    floor_ceiling_band_fraction: float = 0.24
    fit_points_per_class: int = 3_000
    yaw_start_count: int = 24
    maximum_iterations: int = 24
    trim_fraction: float = 0.80
    normal_alignment_min_abs_dot: float = 0.70
    continuous_refinement_yaw_window_degrees: float = 10.0
    continuous_refinement_translation_window_m: float = 0.75
    continuous_refinement_max_evaluations: int = 2_000
    continuous_refinement_xtol: float = 1e-7
    continuous_refinement_ftol: float = 1e-9
    handedness_min_absolute_advantage: float = 0.005
    handedness_min_relative_advantage: float = 0.20
    gaussian_normal_max_median_angle_degrees: float = 20.0
    gaussian_normal_min_fraction_within_15_degrees: float = 0.50
    gaussian_normal_min_relative_advantage_degrees: float = 2.0
    plane_normal_min_abs_dot: float = 0.94
    plane_max_point_residual_m: float = 0.08
    plane_min_support_count: int = 12
    plane_min_support_fraction: float = 0.025
    plane_seed_limit: int = 384
    plane_max_count: int = 16
    plane_min_pair_angle_degrees: float = 20.0
    plane_hypothesis_normal_tolerance_degrees: float = 8.0
    plane_match_normal_tolerance_degrees: float = 10.0
    plane_match_max_offset_m: float = 0.35
    plane_occupancy_cell_m: float = 0.15
    plane_occupancy_dilation_cells: int = 1
    plane_min_occupied_cells: int = 6
    plane_max_height_mismatch_m: float = 0.15
    metric_boundary_comparison_epsilon_m: float = 1e-9
    angular_boundary_comparison_epsilon: float = 1e-12
    horizontal_level_max_residual_m: float = 0.06
    horizontal_level_min_support_count: int = 12
    horizontal_level_max_count: int = 8
    horizontal_level_mode_suppression_factor: float = 3.0
    horizontal_level_point_dedup_tolerance_m: float = 1e-5
    horizontal_level_min_footprint_area_m2: float = 0.135
    horizontal_level_min_footprint_fraction: float = 0.05
    horizontal_level_min_relative_footprint: float = 0.20
    horizontal_level_footprint_max_triangle_edge_m: float = 0.80
    horizontal_level_footprint_min_triangle_quality: float = 0.20
    horizontal_level_footprint_density_sliver_max_width_m: float = 0.025
    horizontal_level_min_wall_columns: int = 3
    horizontal_level_min_wall_vertical_span_fraction: float = 0.50
    horizontal_level_wall_endpoint_trim_fraction: float = 0.02
    horizontal_level_max_wall_endpoint_tolerance_m: float = 0.45
    horizontal_level_min_wall_contact_points: int = 3
    horizontal_level_wall_contact_dedup_tolerance_m: float = 1e-5
    horizontal_level_wall_segment_max_tangent_gap_m: float = 0.75
    horizontal_level_min_wall_segment_tangent_positions: int = 3
    horizontal_level_min_wall_segment_tangent_span_m: float = 0.75
    horizontal_level_min_wall_contact_total_coverage_m: float = 0.45
    horizontal_level_min_wall_contact_contiguous_coverage_m: float = 0.30
    horizontal_level_parallel_wall_angle_tolerance_degrees: float = 2.0
    horizontal_level_min_parallel_wall_separation_m: float = 1.0
    plane_refinement_yaw_window_degrees: float = 3.0
    plane_refinement_translation_window_m: float = 0.25
    plane_refinement_max_score_increase_m: float = 0.005


@dataclass(frozen=True)
class WallTangentSegment:
    segment_id: int
    tangent_range_m: tuple[float, float]
    raw_point_count: int
    distinct_tangent_position_count: int
    endpoint_column_count: int
    robust_z_range_m: tuple[float, float]
    typical_vertical_sampling_gap_m: float
    lower_endpoint_support_tangent_positions_m: tuple[float, ...]
    upper_endpoint_support_tangent_positions_m: tuple[float, ...]


@dataclass(frozen=True)
class WallPlanePatch:
    plane_id: int
    normal_xy: Any
    offset_m: float
    point_indices: Any
    support_count: int
    support_area_proxy_m2: float
    tangent_range_m: tuple[float, float]
    tangent_segments: tuple[WallTangentSegment, ...]
    z_range_m: tuple[float, float]
    robust_z_range_m: tuple[float, float]
    occupied_cells: frozenset[tuple[int, int]]
    residual_median_m: float
    residual_p95_m: float


@dataclass(frozen=True)
class HorizontalLevelMode:
    level_m: float
    point_indices: Any
    support_count: int
    support_fraction: float
    weighted_support: float
    median_absolute_deviation_m: float
    p95_absolute_residual_m: float


@dataclass(frozen=True)
class StructuralInventory:
    wall_planes: tuple[WallPlanePatch, ...]
    floor_z_m: float
    ceiling_z_m: float
    floor_level_mad_m: float
    ceiling_level_mad_m: float
    ceiling_levels_m: tuple[float, ...]
    ceiling_level_mads_m: tuple[float, ...]
    unassigned_wall_fraction: float


@dataclass(frozen=True)
class PlaneHypothesis:
    yaw_radians: float
    translation: Any
    source_seed_plane_ids: tuple[int, int]
    target_seed_plane_ids: tuple[int, int]
    mirrored: bool


@dataclass(frozen=True)
class _PlaneAssignmentState:
    """One exact partial wall matching retained by the Pareto search."""

    edges: tuple[tuple[int, int], ...]
    offset_square_sum_m2: float
    linear_numerator_sum_m: float
    normalized_coverage_sum: float


# Exact matching is deliberately bounded by deterministic work counters.  If
# adversarial geometry exceeds a proof budget, the scorer raises and returns no
# transform; it never substitutes a heuristic incumbent.
PLANE_ASSIGNMENT_MAX_LIVE_STATES = 100_000
PLANE_ASSIGNMENT_MAX_TRANSITIONS = 500_000
PLANE_ASSIGNMENT_MAX_STATES_PER_FRONTIER = 2_048


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
        fail("INVALID_JSON_VALUE", "diagnostic contains a non-canonical JSON value")
        raise AssertionError from error


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _read_structural_tool_snapshot() -> tuple[bytes, dict[str, Any]]:
    path = Path(__file__).resolve()
    try:
        payload = path.read_bytes()
    except OSError as error:
        fail("STRUCTURAL_TOOL_UNREADABLE", f"could not read the running structural tool: {error}")
    return payload, {
        "fileName": path.name,
        "sizeBytes": len(payload),
        "sha256": _sha256_bytes(payload),
        "recordedToDetectSourcePackageDrift": True,
        "isSignature": False,
    }


def verify_alignment_tool_pin(payload: bytes | None = None) -> dict[str, Any]:
    """Refuse to reuse alignment internals if their reviewed bytes drift."""

    if payload is None:
        try:
            payload = ALIGNMENT_TOOL_PATH.read_bytes()
        except OSError as error:
            fail("ALIGNMENT_TOOL_UNREADABLE", f"could not read pinned alignment tool: {error}")
    actual_size = len(payload)
    actual_sha = _sha256_bytes(payload)
    if actual_size != EXPECTED_ALIGNMENT_TOOL_SIZE_BYTES or actual_sha != EXPECTED_ALIGNMENT_TOOL_SHA256:
        fail(
            "ALIGNMENT_TOOL_PIN_MISMATCH",
            "align_e57_xgrids.py changed; review and repin it before structural diagnosis",
        )
    return {
        "fileName": ALIGNMENT_TOOL_PATH.name,
        "sizeBytes": actual_size,
        "sha256": actual_sha,
        "reuseScope": (
            "frozen scan roles, protected input inspection, deterministic sampling, "
            "read-only E57 adapter, snapshot checks, and create-only path guards"
        ),
    }


def _require_finite_matrix(value: Any, columns: int, label: str, np: Any) -> Any:
    try:
        array = np.asarray(value, dtype=np.float64)
    except (TypeError, ValueError, OverflowError):
        fail("INVALID_ARRAY", f"{label} must be a numeric Nx{columns} array")
    if array.ndim != 2 or array.shape[1] != columns or array.shape[0] == 0:
        fail("INVALID_ARRAY", f"{label} must be a non-empty Nx{columns} array")
    if not np.all(np.isfinite(array)):
        fail("NONFINITE_ARRAY", f"{label} contains a non-finite value")
    return array


def _is_finite_real(value: Any) -> bool:
    if isinstance(value, bool) or not isinstance(value, numbers.Real):
        return False
    try:
        return math.isfinite(float(value))
    except (TypeError, ValueError, OverflowError):
        return False


def _is_integer_at_least(value: Any, minimum: int) -> bool:
    if isinstance(value, bool):
        return False
    try:
        return operator.index(value) >= minimum
    except TypeError:
        return False


def _stable_sigmoid(values: Any, np: Any) -> Any:
    values = np.asarray(values, dtype=np.float64)
    result = np.empty_like(values)
    positive = values >= 0.0
    result[positive] = 1.0 / (1.0 + np.exp(-values[positive]))
    exp_values = np.exp(values[~positive])
    result[~positive] = exp_values / (1.0 + exp_values)
    return result


def quaternion_wxyz_matrices(quaternions: Any, np: Any) -> Any:
    """Convert the diagnostic candidate ``rot_0=w`` convention to matrices."""

    quaternions = _require_finite_matrix(quaternions, 4, "Gaussian quaternions", np)
    norms = np.linalg.norm(quaternions, axis=1)
    if np.any(norms <= 1e-12):
        fail("INVALID_GAUSSIAN_QUATERNION", "Gaussian quaternion has near-zero norm")
    q = quaternions / norms[:, None]
    w, x, y, z = (q[:, index] for index in range(4))
    matrices = np.empty((q.shape[0], 3, 3), dtype=np.float64)
    matrices[:, 0, 0] = 1.0 - 2.0 * (y * y + z * z)
    matrices[:, 0, 1] = 2.0 * (x * y - z * w)
    matrices[:, 0, 2] = 2.0 * (x * z + y * w)
    matrices[:, 1, 0] = 2.0 * (x * y + z * w)
    matrices[:, 1, 1] = 1.0 - 2.0 * (x * x + z * z)
    matrices[:, 1, 2] = 2.0 * (y * z - x * w)
    matrices[:, 2, 0] = 2.0 * (x * z - y * w)
    matrices[:, 2, 1] = 2.0 * (y * z + x * w)
    matrices[:, 2, 2] = 1.0 - 2.0 * (x * x + y * y)
    return matrices


def gaussian_covariance_normals(log_scales: Any, quaternions_wxyz: Any, np: Any) -> tuple[Any, Any]:
    """Return the smallest covariance axis and positive metric axis scales."""

    log_scales = _require_finite_matrix(log_scales, 3, "Gaussian log scales", np)
    if np.any(log_scales < -30.0) or np.any(log_scales > 10.0):
        fail("UNSAFE_GAUSSIAN_SCALE", "Gaussian log scale is outside the bounded decode range")
    rotations = quaternion_wxyz_matrices(quaternions_wxyz, np)
    scales = np.exp(log_scales)
    minimum_axes = np.argmin(scales * scales, axis=1)
    normals = np.take_along_axis(
        rotations,
        minimum_axes[:, None, None].repeat(3, axis=1),
        axis=2,
    )[:, :, 0]
    normals /= np.linalg.norm(normals, axis=1)[:, None]
    return normals, scales


def filter_gaussian_surfaces(
    positions: Any,
    opacity_logits: Any,
    log_scales: Any,
    quaternions_wxyz: Any,
    *,
    config: StructuralConfig,
    np: Any,
) -> tuple[Any, Any, Any, dict[str, Any]]:
    """Keep visible, bounded, disk-like Gaussians and derive their normals."""

    positions = _require_finite_matrix(positions, 3, "Gaussian positions", np)
    opacity_logits = np.asarray(opacity_logits, dtype=np.float64)
    if opacity_logits.shape != (positions.shape[0],) or not np.all(np.isfinite(opacity_logits)):
        fail("INVALID_GAUSSIAN_OPACITY", "Gaussian opacity must be one finite value per position")
    log_scales = _require_finite_matrix(log_scales, 3, "Gaussian log scales", np)
    quaternions_wxyz = _require_finite_matrix(
        quaternions_wxyz, 4, "Gaussian quaternions", np
    )
    if log_scales.shape[0] != positions.shape[0] or quaternions_wxyz.shape[0] != positions.shape[0]:
        fail("GAUSSIAN_FIELD_COUNT_MISMATCH", "Gaussian field arrays have different row counts")
    normals, scales = gaussian_covariance_normals(log_scales, quaternions_wxyz, np)
    sorted_scales = np.sort(scales, axis=1)
    opacity = _stable_sigmoid(opacity_logits, np)
    bounded_position = np.max(np.abs(positions), axis=1) <= config.maximum_abs_coordinate_m
    bounded_scale = (
        (sorted_scales[:, 0] >= config.gaussian_min_scale_m)
        & (sorted_scales[:, 2] <= config.gaussian_max_scale_m)
    )
    planar_ratio = sorted_scales[:, 1] / sorted_scales[:, 0]
    tangent_ratio = sorted_scales[:, 2] / sorted_scales[:, 1]
    visible = opacity >= config.gaussian_min_opacity
    planar = (
        (planar_ratio >= config.gaussian_min_planar_ratio)
        & (tangent_ratio <= config.gaussian_max_tangent_ratio)
    )
    keep = bounded_position & bounded_scale & visible & planar
    if int(np.count_nonzero(keep)) < 3 * MIN_SURFACES_PER_CLASS:
        fail("INSUFFICIENT_GAUSSIAN_SURFACES", "too few visible bounded planar Gaussians remain")
    evidence = {
        "inputGaussianCount": int(positions.shape[0]),
        "retainedGaussianCount": int(np.count_nonzero(keep)),
        "rejectedCountsNotMutuallyExclusive": {
            "invisible": int(np.count_nonzero(~visible)),
            "positionOutOfBounds": int(np.count_nonzero(~bounded_position)),
            "scaleOutOfBounds": int(np.count_nonzero(~bounded_scale)),
            "notPlanarOrNeedleLike": int(np.count_nonzero(~planar)),
        },
        "conventions": {
            "opacity": "sigmoid(opacity)",
            "scale": "exp(scale_0..2) in assumed metres",
            "quaternion": (
                "diagnostic candidate rot_0=w, rot_1=x, rot_2=y, rot_3=z; normalized before use; "
                "cross-checked against source-local PCA but not established as per-Gaussian truth"
            ),
            "normal": "smallest eigen-axis of R diag(exp(scale)^2) R^T",
            "storedNxNyNzUsed": False,
        },
        "thresholds": {
            "minimumOpacity": config.gaussian_min_opacity,
            "minimumScaleMeters": config.gaussian_min_scale_m,
            "maximumScaleMeters": config.gaussian_max_scale_m,
            "minimumMiddleToSmallScaleRatio": config.gaussian_min_planar_ratio,
            "maximumLargeToMiddleScaleRatio": config.gaussian_max_tangent_ratio,
            "maximumAbsoluteCoordinateMeters": config.maximum_abs_coordinate_m,
        },
    }
    return positions[keep], normals[keep], opacity[keep], evidence


def assess_gaussian_normal_convention(
    positions: Any,
    log_scales: Any,
    quaternions_wxyz_fields: Any,
    *,
    query_limit: int,
    config: StructuralConfig,
    np: Any,
    cKDTree: Any,
) -> dict[str, Any]:
    """Cross-check quaternion interpretations against source-position local PCA.

    This is a coherence check, not ground truth.  It is included because the
    PLY header names quaternion fields but does not itself define component
    order, and its stored nx/ny/nz values are not used.
    """

    positions = _require_finite_matrix(positions, 3, "Gaussian coherence positions", np)
    log_scales = _require_finite_matrix(log_scales, 3, "Gaussian coherence scales", np)
    quaternions = _require_finite_matrix(
        quaternions_wxyz_fields, 4, "Gaussian coherence quaternions", np
    )
    if positions.shape[0] < config.pca_neighbors:
        fail("INSUFFICIENT_GAUSSIAN_COHERENCE_POINTS", "too few Gaussians for normal coherence")
    indexes = _get_alignment()._deterministic_indices(
        int(positions.shape[0]), query_limit, "gaussian-normal-convention-coherence-v1"
    )
    indexes_array = np.asarray(indexes, dtype=np.int64)
    queries = positions[indexes_array]
    tree = cKDTree(positions)
    distances, neighbors = tree.query(queries, k=config.pca_neighbors, workers=1)
    if not np.all(np.isfinite(distances)):
        fail("INVALID_GAUSSIAN_COHERENCE_NEIGHBORHOOD", "Gaussian PCA neighborhood is invalid")
    neighborhoods = positions[neighbors]
    centered = neighborhoods - np.mean(neighborhoods, axis=1, keepdims=True)
    covariance = np.einsum("nki,nkj->nij", centered, centered) / float(config.pca_neighbors)
    eigenvalues, eigenvectors = np.linalg.eigh(covariance)
    largest = eigenvalues[:, 2]
    total = np.sum(eigenvalues, axis=1)
    planarity = np.zeros_like(largest)
    variation = np.ones_like(largest)
    valid = (
        (largest > 1e-12)
        & (total > 1e-12)
        & (distances[:, -1] <= config.pca_max_neighbor_radius_m)
    )
    planarity[valid] = (eigenvalues[valid, 1] - eigenvalues[valid, 0]) / largest[valid]
    variation[valid] = eigenvalues[valid, 0] / total[valid]
    provisional_normals = eigenvectors[:, :, 0]
    plane_residual = np.abs(np.einsum("nki,ni->nk", centered, provisional_normals))
    p95_plane_residual = np.percentile(plane_residual, 95, axis=1, method="linear")
    valid &= (
        (planarity >= config.pca_min_planarity)
        & (variation <= config.pca_max_surface_variation)
        & (p95_plane_residual <= config.pca_max_plane_residual_m)
    )
    if int(np.count_nonzero(valid)) < 32:
        fail("INSUFFICIENT_GAUSSIAN_COHERENCE_PLANES", "too few source-local planar neighborhoods")
    pca_normals = eigenvectors[valid, :, 0]
    selected_scales = log_scales[indexes_array][valid]
    selected_quaternions = quaternions[indexes_array][valid]
    wxyz_normals, _ = gaussian_covariance_normals(
        selected_scales, selected_quaternions, np
    )
    # Alternative interpretation: the same rot_0..3 fields are x,y,z,w.
    xyzw_as_wxyz = selected_quaternions[:, [3, 0, 1, 2]]
    xyzw_normals, _ = gaussian_covariance_normals(selected_scales, xyzw_as_wxyz, np)

    def row(candidate: Any) -> dict[str, Any]:
        dots = np.clip(np.abs(np.einsum("ni,ni->n", candidate, pca_normals)), 0.0, 1.0)
        angles = np.degrees(np.arccos(dots))
        return {
            "assessedCount": int(angles.size),
            "medianUnsignedAngleDegrees": float(np.percentile(angles, 50, method="linear")),
            "p95UnsignedAngleDegrees": float(np.percentile(angles, 95, method="linear")),
            "fractionWithin15Degrees": float(np.mean(angles <= 15.0)),
            "fractionWithin30Degrees": float(np.mean(angles <= 30.0)),
        }

    wxyz = row(wxyz_normals)
    xyzw = row(xyzw_normals)
    median_advantage = (
        xyzw["medianUnsignedAngleDegrees"] - wxyz["medianUnsignedAngleDegrees"]
    )
    if median_advantage <= -config.gaussian_normal_min_relative_advantage_degrees:
        fail(
            "WXYZ_NORMAL_CONVENTION_CONTRADICTED",
            "the selected rot_0=w convention is less coherent than the xyzw control",
        )
    absolute_reasons: list[str] = []
    if (
        wxyz["medianUnsignedAngleDegrees"]
        > config.gaussian_normal_max_median_angle_degrees
    ):
        absolute_reasons.append("median_unsigned_angle_exceeds_20_degrees")
    if (
        wxyz["fractionWithin15Degrees"]
        < config.gaussian_normal_min_fraction_within_15_degrees
    ):
        absolute_reasons.append("fraction_within_15_degrees_below_0.5")
    absolute_pass = not absolute_reasons
    relative_pass = (
        median_advantage >= config.gaussian_normal_min_relative_advantage_degrees
    )
    use_covariance_normals = absolute_pass and relative_pass
    status = (
        "wxyz_meets_absolute_coherence_thresholds_but_not_proven"
        if use_covariance_normals
        else "covariance_normals_rejected_use_source_local_pca"
    )
    return {
        "status": status,
        "selectedForDiagnostic": (
            "rot_0=w_rot_1=x_rot_2=y_rot_3=z"
            if use_covariance_normals
            else "source_position_local_pca"
        ),
        "useCovarianceNormalsForFit": use_covariance_normals,
        "absoluteCoherenceGate": {
            "passed": absolute_pass,
            "maximumMedianUnsignedAngleDegrees": config.gaussian_normal_max_median_angle_degrees,
            "minimumFractionWithin15Degrees": config.gaussian_normal_min_fraction_within_15_degrees,
            "failureRule": "reject_if_either_threshold_fails",
            "reasons": absolute_reasons,
        },
        "relativeConventionGate": {
            "passed": relative_pass,
            "minimumWxyzMedianAdvantageDegrees": config.gaussian_normal_min_relative_advantage_degrees,
            "actualWxyzMedianAdvantageDegrees": float(median_advantage),
            "failureFallsBackToSourceLocalPca": True,
        },
        "selectedConventionIsPerGaussianNormalTruth": False,
        "ambiguousConventionAllowedForAuthorityNoneDiagnostic": False,
        "sourceLocalPcaIsGroundTruth": False,
        "storedNxNyNzUsed": False,
        "wxyz": wxyz,
        "xyzwAlternativeControl": xyzw,
        "wxyzMedianAngleAdvantageDegrees": float(median_advantage),
        "plainLanguage": (
            "Nearby Gaussian positions provide a consistency check. Weak or ambiguous covariance "
            "directions are not used for fitting; the tool falls back to normals measured from "
            "nearby source positions. Neither route proves a surveyed surface direction."
        ),
    }


def gaussian_mask_sensitivity(
    positions: Any,
    opacity_logits: Any,
    log_scales: Any,
    quaternions_wxyz: Any,
    *,
    use_covariance_normals_for_classification: bool,
    local_pca_seed_prefix: str,
    local_pca_query_limit: int,
    config: StructuralConfig,
    np: Any,
    cKDTree: Any,
) -> dict[str, Any]:
    """Report broad/core/strict retained structure without selecting on validation."""

    variants = {
        "broad": replace(
            config,
            gaussian_min_opacity=0.03,
            gaussian_max_scale_m=0.65,
            gaussian_min_planar_ratio=1.25,
        ),
        "core": config,
        "strict": replace(
            config,
            gaussian_min_opacity=0.20,
            gaussian_max_scale_m=0.25,
            gaussian_min_planar_ratio=2.5,
        ),
    }
    rows: dict[str, Any] = {}
    for name, selected in variants.items():
        try:
            points, normals, weights, filtering = filter_gaussian_surfaces(
                positions,
                opacity_logits,
                log_scales,
                quaternions_wxyz,
                config=selected,
                np=np,
            )
            pca_evidence: dict[str, Any] | None = None
            if not use_covariance_normals_for_classification:
                points, normals, weights, pca_evidence = estimate_local_pca_surfaces(
                    points,
                    query_limit=min(int(points.shape[0]), local_pca_query_limit),
                    seed=f"{local_pca_seed_prefix}-{name}",
                    config=selected,
                    np=np,
                    cKDTree=cKDTree,
                )
            _surfaces, classification = classify_zup_surfaces(
                points, normals, weights, config=selected, np=np
            )
            rows[name] = {
                "assessable": True,
                "retainedGaussianCount": filtering["retainedGaussianCount"],
                "classCounts": classification["classCounts"],
                "thresholds": filtering["thresholds"],
                "classificationNormalMethod": (
                    "Gaussian covariance smallest axis"
                    if use_covariance_normals_for_classification
                    else "source-position deterministic local PCA"
                ),
                "localPcaEvidence": pca_evidence,
            }
        except SurfaceAlignmentError as error:
            rows[name] = {
                "assessable": False,
                "errorCode": error.code,
                "thresholds": {
                    "minimumOpacity": selected.gaussian_min_opacity,
                    "maximumScaleMeters": selected.gaussian_max_scale_m,
                    "minimumMiddleToSmallScaleRatio": selected.gaussian_min_planar_ratio,
                },
            }
    return {
        "selectedMask": "core_fixed_before_fit_or_validation",
        "classificationUsesSameNormalRouteAsFit": True,
        "variants": rows,
        "fitStabilityAcrossMasksEvaluated": False,
        "meaning": "Counts expose mask sensitivity; they do not claim the transform is stable across masks.",
    }


def validate_gaussian_ply_layout(layout: Any) -> dict[str, Any]:
    if layout.format_name != "binary_little_endian":
        fail("UNSUPPORTED_GAUSSIAN_PLY_FORMAT", "structural diagnosis requires binary_little_endian PLY")
    properties = list(layout.vertex_properties)
    names = [prop.name for prop in properties]
    if len(names) != len(set(names)):
        fail("DUPLICATE_GAUSSIAN_FIELD", "Gaussian PLY repeats a vertex property")
    missing = [name for name in GAUSSIAN_FIELDS if name not in names]
    if missing:
        fail("MISSING_GAUSSIAN_FIELD", f"Gaussian PLY is missing required fields: {missing}")
    for prop in properties:
        if prop.scalar_type is None or prop.list_count_type is not None:
            fail("UNSAFE_GAUSSIAN_FIELD", "all Gaussian vertex properties must be fixed-width scalars")
    wrong_types = {
        name: properties[names.index(name)].scalar_type
        for name in GAUSSIAN_FIELDS
        if properties[names.index(name)].scalar_type not in {"float", "float32"}
    }
    if wrong_types:
        fail("GAUSSIAN_FIELD_TYPE_MISMATCH", f"required Gaussian fields must be float32: {wrong_types}")
    if layout.vertex_stride_bytes is None:
        fail("UNSAFE_GAUSSIAN_LAYOUT", "Gaussian PLY has no fixed vertex stride")
    return {
        "format": layout.format_name,
        "declaredVertexCount": layout.vertex_count,
        "vertexStrideBytes": layout.vertex_stride_bytes,
        "requiredFields": list(GAUSSIAN_FIELDS),
        "quaternionComponentOrderCandidate": "rot_0_w_rot_1_x_rot_2_y_rot_3_z",
        "additionalFieldsIgnored": [name for name in names if name not in GAUSSIAN_FIELDS],
        "storedNxNyNzUsed": False,
    }


def load_gaussian_ply_sample(
    path: Path,
    snapshot: Any,
    layout: Any,
    limit: int,
    sample_seed: str,
    np: Any,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Read deterministic fixed-width records without random-I/O amplification.

    A production sample is dense enough that one seek per selected Gaussian is
    much slower than reading the bounded vertex region once.  Dense samples are
    therefore decoded from fixed-size sequential chunks.  Sparse fixtures keep
    the direct-read path.  Both paths fill the same deterministic sample order
    and validate the same selected fields.
    """

    layout_evidence = validate_gaussian_ply_layout(layout)
    if limit < 3 * MIN_SURFACES_PER_CLASS:
        fail("GAUSSIAN_SAMPLE_LIMIT_TOO_SMALL", "Gaussian sample limit is too small")
    helper = _get_alignment()
    indices = helper._deterministic_indices(layout.vertex_count, limit, sample_seed)
    properties = list(layout.vertex_properties)
    names = [prop.name for prop in properties]
    endian_format = "<" + "".join(
        helper.PLY_SCALAR_TYPES[prop.scalar_type][0] for prop in properties
    )
    record = struct.Struct(endian_format)
    stride = layout.vertex_stride_bytes
    if stride is None or record.size != stride:
        fail("GAUSSIAN_STRIDE_MISMATCH", "Gaussian PLY record size differs from its header")
    field_indexes = {name: names.index(name) for name in GAUSSIAN_FIELDS}
    rows = np.empty((len(indices), len(GAUSSIAN_FIELDS)), dtype=np.float64)
    ordered = sorted(enumerate(indices), key=lambda item: item[1])
    sample_density = len(indices) / float(layout.vertex_count)
    sequential = sample_density >= GAUSSIAN_SEQUENTIAL_SAMPLE_DENSITY_THRESHOLD

    def decode_into(payload: bytes, byte_offset: int, destination: int) -> None:
        values = record.unpack_from(payload, byte_offset)
        row = [float(values[field_indexes[name]]) for name in GAUSSIAN_FIELDS]
        if not all(math.isfinite(value) for value in row):
            fail("NONFINITE_GAUSSIAN_FIELD", "sampled Gaussian field is non-finite")
        rows[destination] = row

    try:
        with path.open("rb") as source:
            if sequential:
                chunk_vertices = max(1, (4 * 1024 * 1024) // stride)
                cursor = 0
                for chunk_start in range(0, layout.vertex_count, chunk_vertices):
                    chunk_count = min(chunk_vertices, layout.vertex_count - chunk_start)
                    chunk_end = chunk_start + chunk_count
                    source.seek(layout.data_offset + chunk_start * stride)
                    payload = source.read(chunk_count * stride)
                    if len(payload) != chunk_count * stride:
                        fail(
                            "TRUNCATED_GAUSSIAN_PLY",
                            "Gaussian PLY ended inside sequential vertex data",
                        )
                    while cursor < len(ordered) and ordered[cursor][1] < chunk_end:
                        destination, vertex_index = ordered[cursor]
                        if vertex_index < chunk_start:
                            fail("INTERNAL_SAMPLE_ORDER", "Gaussian sample ordering regressed")
                        decode_into(
                            payload,
                            (vertex_index - chunk_start) * stride,
                            destination,
                        )
                        cursor += 1
                if cursor != len(ordered):
                    fail("TRUNCATED_GAUSSIAN_PLY", "Gaussian sample index left vertex data")
            else:
                for destination, vertex_index in ordered:
                    source.seek(layout.data_offset + vertex_index * stride)
                    payload = source.read(stride)
                    if len(payload) != stride:
                        fail(
                            "TRUNCATED_GAUSSIAN_PLY",
                            "Gaussian PLY ended inside sampled vertex data",
                        )
                    decode_into(payload, 0, destination)
    except SurfaceAlignmentError:
        raise
    except OSError as error:
        fail("GAUSSIAN_PLY_READ_FAILED", f"could not sample Gaussian PLY: {error}")
    helper._snapshot_matches(path, snapshot, "XGRIDS PLY")
    array = rows
    if array.shape != (len(indices), len(GAUSSIAN_FIELDS)):
        fail("GAUSSIAN_SAMPLE_SHAPE_MISMATCH", "Gaussian sample shape is inconsistent")
    decoded = {
        "positions": array[:, 0:3],
        "opacityLogits": array[:, 3],
        "logScales": array[:, 4:7],
        "quaternionsWxyz": array[:, 7:11],
    }
    layout_evidence.update(
        {
            "sampleCount": int(array.shape[0]),
            "sampleMethod": (
                "hash-seeded coprime-stride vertex indexes; bounded sequential fixed-width chunks"
                if sequential
                else "hash-seeded coprime-stride vertex indexes; sparse sorted fixed-width reads"
            ),
            "sampleDensity": sample_density,
            "sequentialVertexRegionRead": sequential,
            "allDeclaredVertexBytesRead": sequential,
            "allDeclaredVerticesDecoded": len(indices) == layout.vertex_count,
            "selectedVerticesDecoded": int(array.shape[0]),
            "unsampledVertexFieldsValidated": False,
        }
    )
    return decoded, layout_evidence


def estimate_local_pca_surfaces(
    points: Any,
    *,
    query_limit: int,
    seed: str,
    config: StructuralConfig,
    np: Any,
    cKDTree: Any,
) -> tuple[Any, Any, Any, dict[str, Any]]:
    """Estimate unsigned surface normals from deterministic local neighborhoods."""

    points = _require_finite_matrix(points, 3, "E57 points", np)
    neighbor_count = config.pca_neighbors
    if neighbor_count < 8 or points.shape[0] < neighbor_count:
        fail("INSUFFICIENT_PCA_NEIGHBORS", "E57 sample is too small for local PCA")
    query_indices = _get_alignment()._deterministic_indices(int(points.shape[0]), query_limit, seed)
    queries = points[query_indices]
    tree = cKDTree(points)
    distances, neighbors = tree.query(queries, k=neighbor_count, workers=1)
    if not np.all(np.isfinite(distances)):
        fail("INVALID_PCA_NEIGHBORHOOD", "E57 PCA neighborhood contains an infinite distance")
    neighborhoods = points[neighbors]
    centered = neighborhoods - np.mean(neighborhoods, axis=1, keepdims=True)
    covariance = np.einsum("nki,nkj->nij", centered, centered) / float(neighbor_count)
    eigenvalues, eigenvectors = np.linalg.eigh(covariance)
    largest = eigenvalues[:, 2]
    total = np.sum(eigenvalues, axis=1)
    local_radius = distances[:, -1]
    numerically_valid = (
        (largest > 1e-12)
        & (total > 1e-12)
        & (local_radius <= config.pca_max_neighbor_radius_m)
    )
    planarity = np.zeros_like(largest)
    variation = np.ones_like(largest)
    planarity[numerically_valid] = (
        eigenvalues[numerically_valid, 1] - eigenvalues[numerically_valid, 0]
    ) / largest[numerically_valid]
    variation[numerically_valid] = eigenvalues[numerically_valid, 0] / total[numerically_valid]
    provisional_normals = eigenvectors[:, :, 0]
    plane_residual = np.abs(np.einsum("nki,ni->nk", centered, provisional_normals))
    p95_plane_residual = np.percentile(plane_residual, 95, axis=1, method="linear")
    keep = (
        numerically_valid
        & (planarity >= config.pca_min_planarity)
        & (variation <= config.pca_max_surface_variation)
        & (p95_plane_residual <= config.pca_max_plane_residual_m)
    )
    normals = eigenvectors[:, :, 0]
    if int(np.count_nonzero(keep)) < 3 * MIN_SURFACES_PER_CLASS:
        fail("INSUFFICIENT_E57_PLANAR_POINTS", "too few local-PCA E57 surfaces remain")
    quality = planarity * np.maximum(0.0, 1.0 - variation)
    return queries[keep], normals[keep], quality[keep], {
        "inputPointCount": int(points.shape[0]),
        "queryPointCount": int(queries.shape[0]),
        "retainedPlanarPointCount": int(np.count_nonzero(keep)),
        "neighborCount": neighbor_count,
        "maximumNeighborRadiusMeters": config.pca_max_neighbor_radius_m,
        "rejectedForNonlocalNeighborhoodCount": int(
            np.count_nonzero(local_radius > config.pca_max_neighbor_radius_m)
        ),
        "normalMethod": "smallest eigenvector of deterministic local covariance",
        "minimumPlanarity": config.pca_min_planarity,
        "maximumSurfaceVariation": config.pca_max_surface_variation,
        "maximumP95PointToLocalPlaneResidualMeters": config.pca_max_plane_residual_m,
        "cornerAndNonplanarRejectionMethod": (
            "planarity, surface variation, local radius, and p95 residual to the fitted local plane"
        ),
    }


def classify_zup_surfaces(
    points: Any,
    normals: Any,
    weights: Any,
    *,
    config: StructuralConfig,
    np: Any,
    z_bounds: tuple[float, float] | None = None,
    require_all_classes: bool = True,
) -> tuple[SurfaceSet, dict[str, Any]]:
    points = _require_finite_matrix(points, 3, "surface points", np)
    normals = _require_finite_matrix(normals, 3, "surface normals", np)
    weights = np.asarray(weights, dtype=np.float64)
    if normals.shape != points.shape or weights.shape != (points.shape[0],):
        fail("SURFACE_FIELD_COUNT_MISMATCH", "surface point, normal, and weight counts differ")
    normal_norms = np.linalg.norm(normals, axis=1)
    if np.any(normal_norms <= 1e-12) or not np.all(np.isfinite(weights)) or np.any(weights <= 0.0):
        fail("INVALID_SURFACE_FIELDS", "surface normals and weights must be finite and positive")
    normals = normals / normal_norms[:, None]
    if z_bounds is None:
        low_z, high_z = np.percentile(points[:, 2], [2.0, 98.0], method="linear")
        bounds_source = "this surface set robust 2nd/98th percentiles"
    else:
        low_z, high_z = (float(z_bounds[0]), float(z_bounds[1]))
        bounds_source = "frozen aggregate role bounds"
    height = float(high_z - low_z)
    if not math.isfinite(height) or height <= 0.25:
        fail("DEGENERATE_ZUP_HEIGHT", "surface set lacks a usable floor-to-ceiling height")
    band = config.floor_ceiling_band_fraction * height
    abs_z = np.abs(normals[:, 2])
    wall = abs_z <= config.wall_max_abs_normal_z
    horizontal = abs_z >= config.horizontal_min_abs_normal_z
    floor = horizontal & (points[:, 2] <= low_z + band)
    ceiling = horizontal & (points[:, 2] >= high_z - band)
    labels = np.full(points.shape[0], -1, dtype=np.int8)
    labels[wall] = LABEL_WALL
    labels[floor] = LABEL_FLOOR
    labels[ceiling] = LABEL_CEILING
    keep = labels >= 0
    counts = {
        LABEL_NAMES[label]: int(np.count_nonzero(labels == label)) for label in LABEL_NAMES
    }
    if require_all_classes and any(count < MIN_SURFACES_PER_CLASS for count in counts.values()):
        fail("MISSING_STRUCTURAL_CLASS", f"wall/floor/ceiling evidence is incomplete: {counts}")
    if int(np.count_nonzero(keep)) < MIN_SURFACES_PER_CLASS:
        fail("INSUFFICIENT_CLASSIFIED_SURFACES", "too few wall/floor/ceiling surfaces remain")
    surface_set = SurfaceSet(points[keep], normals[keep], labels[keep], weights[keep])
    return surface_set, {
        "zUpAssumption": True,
        "robustLowZMeters": float(low_z),
        "robustHighZMeters": float(high_z),
        "robustHeightMeters": height,
        "zBoundsSource": bounds_source,
        "classCounts": counts,
        "unclassifiedCount": int(np.count_nonzero(~keep)),
        "thresholds": {
            "wallMaximumAbsoluteNormalZ": config.wall_max_abs_normal_z,
            "horizontalMinimumAbsoluteNormalZ": config.horizontal_min_abs_normal_z,
            "floorCeilingBandFractionOfRobustHeight": config.floor_ceiling_band_fraction,
        },
    }


def validate_scan_mapping(
    mapping: Mapping[int, Any], role: str, *, np: Any, require_all: bool = True
) -> dict[int, Any]:
    if role == "fit":
        allowed = set(FIT_SCAN_IDS)
    elif role == "validation":
        allowed = set(VALIDATION_SCAN_IDS)
    else:
        fail("INVALID_SCAN_ROLE", "scan role must be fit or validation")
    normalized: dict[int, Any] = {}
    for raw_scan, raw_points in mapping.items():
        if isinstance(raw_scan, bool) or not isinstance(raw_scan, int):
            fail("INVALID_SCAN_ID", f"{role} mapping contains a non-integer scan id")
        if raw_scan in TEST_SCAN_IDS:
            fail("FROZEN_TEST_LEAK", f"frozen test scan {raw_scan} was supplied to structural CV")
        if raw_scan not in allowed:
            fail("SCAN_ROLE_MISMATCH", f"scan {raw_scan} is not in the frozen {role} role")
        normalized[raw_scan] = _require_finite_matrix(raw_points, 3, f"{role} scan {raw_scan}", np)
    if require_all and set(normalized) != allowed:
        fail("INCOMPLETE_SCAN_ROLE", f"{role} mapping must contain its frozen station set exactly")
    return normalized


def e57_surface_set_from_scans(
    mapping: Mapping[int, Any],
    role: str,
    *,
    query_limit_per_scan: int,
    config: StructuralConfig,
    np: Any,
    cKDTree: Any,
) -> tuple[SurfaceSet, dict[str, Any], dict[int, SurfaceSet]]:
    normalized = validate_scan_mapping(mapping, role, np=np)
    point_rows: list[Any] = []
    normal_rows: list[Any] = []
    weight_rows: list[Any] = []
    scans: list[dict[str, Any]] = []
    unclassified_by_scan: dict[int, tuple[Any, Any, Any]] = {}
    for scan_id in sorted(normalized):
        points, normals, weights, evidence = estimate_local_pca_surfaces(
            normalized[scan_id],
            query_limit=query_limit_per_scan,
            seed=f"structural-pca-{role}-{scan_id}",
            config=config,
            np=np,
            cKDTree=cKDTree,
        )
        point_rows.append(points)
        normal_rows.append(normals)
        weight_rows.append(weights)
        unclassified_by_scan[scan_id] = (points, normals, weights)
        scans.append({"scanId": scan_id, **evidence})
    classified, classification = classify_zup_surfaces(
        np.vstack(point_rows),
        np.vstack(normal_rows),
        np.concatenate(weight_rows),
        config=config,
        np=np,
    )
    z_bounds = (
        float(classification["robustLowZMeters"]),
        float(classification["robustHighZMeters"]),
    )
    classified_by_scan: dict[int, SurfaceSet] = {}
    per_scan_classes: dict[str, Any] = {}
    for scan_id, (points, normals, weights) in sorted(unclassified_by_scan.items()):
        per_scan, per_scan_evidence = classify_zup_surfaces(
            points,
            normals,
            weights,
            config=config,
            np=np,
            z_bounds=z_bounds,
            require_all_classes=False,
        )
        classified_by_scan[scan_id] = per_scan
        per_scan_classes[str(scan_id)] = per_scan_evidence["classCounts"]
    return classified, {
        "role": role,
        "scanIds": sorted(normalized),
        "usedDuringFit": role == "fit",
        "scans": scans,
        "classification": classification,
        "perScanClassCountsUsingFrozenAggregateRoleZBounds": per_scan_classes,
    }, classified_by_scan


def _balanced_sample(surface_set: SurfaceSet, per_class: int, seed: str, np: Any) -> SurfaceSet:
    indexes: list[int] = []
    for label in LABEL_NAMES:
        available = np.flatnonzero(surface_set.labels == label)
        chosen = _get_alignment()._deterministic_indices(
            int(available.size), per_class, f"{seed}-{LABEL_NAMES[label]}"
        )
        indexes.extend(int(available[index]) for index in chosen)
    selected = np.asarray(indexes, dtype=np.int64)
    return SurfaceSet(
        surface_set.points[selected],
        surface_set.normals[selected],
        surface_set.labels[selected],
        surface_set.weights[selected],
    )


def yaw_rotation(angle_radians: float, np: Any) -> Any:
    cosine = math.cos(angle_radians)
    sine = math.sin(angle_radians)
    return np.array(
        [[cosine, -sine, 0.0], [sine, cosine, 0.0], [0.0, 0.0, 1.0]],
        dtype=np.float64,
    )


def _canonical_xy_plane(normal_xy: Any, offset_m: float, *, np: Any) -> tuple[Any, float]:
    """Return one deterministic representation of an unsigned 2D plane.

    The signed offset must be flipped with the normal.  Treating the angle as
    modulo pi without also flipping the offset silently produces a wrong XY
    translation.
    """

    normal = np.asarray(normal_xy, dtype=np.float64)
    if normal.shape != (2,) or not np.all(np.isfinite(normal)) or not math.isfinite(offset_m):
        fail("INVALID_WALL_PLANE", "wall plane normal and offset must be finite")
    norm = float(np.linalg.norm(normal))
    if norm <= 1e-12:
        fail("INVALID_WALL_PLANE", "wall plane normal is degenerate")
    normal = normal / norm
    offset = float(offset_m) / norm
    if float(normal[0]) < -1e-12 or (
        abs(float(normal[0])) <= 1e-12 and float(normal[1]) < 0.0
    ):
        normal = -normal
        offset = -offset
    return normal, offset


def _plane_occupancy_cells(
    points: Any,
    normal_xy: Any,
    cell_m: float,
    *,
    comparison_epsilon_m: float,
    np: Any,
) -> frozenset[tuple[int, int]]:
    patch = _require_finite_matrix(points, 3, "wall-plane occupancy points", np)
    if (
        cell_m <= 0.0
        or not math.isfinite(cell_m)
        or comparison_epsilon_m < 0.0
        or not math.isfinite(comparison_epsilon_m)
    ):
        fail("INVALID_PLANE_CONFIG", "wall-plane occupancy cell size must be positive")
    tangent = np.asarray([-normal_xy[1], normal_xy[0]], dtype=np.float64)
    tangent_height = np.column_stack(
        (patch[:, :2] @ tangent, patch[:, 2])
    )
    anchor = np.mean(np.unique(tangent_height, axis=0), axis=0)
    local = tangent_height - anchor

    def axis_cells(value: float) -> tuple[int, ...]:
        scaled = float(value) / cell_m
        nearest = int(round(scaled))
        if abs(float(value) - nearest * cell_m) <= comparison_epsilon_m:
            return nearest - 1, nearest
        return (int(math.floor(scaled)),)

    return frozenset(
        (u_cell, z_cell)
        for u, z in local
        for u_cell in axis_cells(float(u))
        for z_cell in axis_cells(float(z))
    )


def _merged_scalar_coverage_intervals(
    values: Any, *, half_width_m: float, np: Any
) -> tuple[tuple[float, float], ...]:
    """Return a rigid-transform-invariant union of equal-radius 1D intervals."""

    array = np.asarray(values, dtype=np.float64)
    if (
        array.ndim != 1
        or array.size == 0
        or not np.all(np.isfinite(array))
        or not math.isfinite(half_width_m)
        or half_width_m <= 0.0
    ):
        fail("INVALID_SCALAR_COVERAGE", "coverage values and radius must be finite and nonempty")
    ordered = np.unique(array)
    intervals: list[tuple[float, float]] = []
    start = float(ordered[0] - half_width_m)
    end = float(ordered[0] + half_width_m)
    for raw_value in ordered[1:]:
        next_start = float(raw_value - half_width_m)
        next_end = float(raw_value + half_width_m)
        if next_start <= end + 1e-12:
            end = max(end, next_end)
        else:
            intervals.append((start, end))
            start, end = next_start, next_end
    intervals.append((start, end))
    return tuple(intervals)


def _cluster_scalar_positions(values: Any, *, tolerance_m: float, np: Any) -> Any:
    """Merge numerically repeated 1D positions using a physical tolerance."""

    array = np.asarray(values, dtype=np.float64)
    if (
        array.ndim != 1
        or not np.all(np.isfinite(array))
        or not math.isfinite(tolerance_m)
        or tolerance_m <= 0.0
    ):
        fail("INVALID_SCALAR_CLUSTER", "scalar cluster input and tolerance must be finite")
    if array.size == 0:
        return np.empty(0, dtype=np.float64)
    ordered = np.sort(array)
    clusters: list[list[float]] = [[float(ordered[0])]]
    for raw_value in ordered[1:]:
        value = float(raw_value)
        if value - clusters[-1][-1] <= tolerance_m:
            clusters[-1].append(value)
        else:
            clusters.append([value])
    return np.asarray(
        [math.fsum(cluster) / len(cluster) for cluster in clusters],
        dtype=np.float64,
    )


def _bounded_component_geometric_anchor(
    rows: Any,
    component: list[int],
    *,
    maximum_diameter_m: float,
    numerical_epsilon_m: float,
    geometric_tie_epsilon_m: float,
    np: Any,
) -> tuple[Any | None, float, str | None]:
    """Return a multiplicity-insensitive anchor for one tiny physical cluster."""

    if not component:
        return None, 0.0, "empty component"
    component_points = np.unique(
        np.asarray(rows[component], dtype=np.float64), axis=0
    )
    if component_points.shape[0] > 2_048:
        return (
            None,
            float("inf"),
            "component exceeds the finite 2048-distinct-position audit cap",
        )
    if component_points.shape[0] == 1:
        return component_points[0].copy(), 0.0, None
    maximum_distance_m = 0.0
    diameter_rows: list[tuple[float, Any]] = []
    for first_index, second_index in itertools.combinations(
        range(component_points.shape[0]), 2
    ):
        distance_m = math.dist(
            tuple(float(value) for value in component_points[first_index]),
            tuple(float(value) for value in component_points[second_index]),
        )
        midpoint = (
            0.5 * component_points[first_index]
            + 0.5 * component_points[second_index]
        )
        if distance_m > maximum_distance_m + geometric_tie_epsilon_m:
            maximum_distance_m = distance_m
            diameter_rows = [(distance_m, midpoint)]
        elif maximum_distance_m - distance_m <= geometric_tie_epsilon_m:
            maximum_distance_m = max(maximum_distance_m, distance_m)
            diameter_rows.append((distance_m, midpoint))
    if maximum_distance_m > maximum_diameter_m + numerical_epsilon_m:
        return (
            None,
            maximum_distance_m,
            "single-link component diameter exceeds the declared physical tolerance",
        )
    diameter_midpoints = np.unique(
        np.asarray(
            [
                midpoint
                for distance_m, midpoint in diameter_rows
                if maximum_distance_m - distance_m <= geometric_tie_epsilon_m
            ],
            dtype=np.float64,
        ),
        axis=0,
    )
    anchor = np.asarray(
        [
            math.fsum(
                sorted(
                    float(midpoint[axis]) / diameter_midpoints.shape[0]
                    for midpoint in diameter_midpoints
                )
            )
            for axis in range(component_points.shape[1])
        ],
        dtype=np.float64,
    )
    if not np.all(np.isfinite(anchor)):
        return None, maximum_distance_m, "bounded component anchor is nonfinite"
    return anchor, maximum_distance_m, None


def _localized_metric_rows(
    rows: Any,
    *,
    pair_radius_m: float,
    comparison_epsilon_m: float,
    np: Any,
) -> tuple[Any, Any, float, float, float]:
    """Localize distance work and derive a tightly bounded numeric allowance.

    A world-coordinate-sized epsilon changes physical topology when the same
    room is expressed far from the origin.  Local coordinates remove that
    dependency.  Four input-coordinate ULPs are used only to over-fetch tree
    candidates.  They never widen the explicit physical decision.  If that
    unavoidable stored-coordinate uncertainty exceeds the caller's declared
    comparison allowance, the comparison is rejected instead of guessed.
    """

    if not math.isfinite(pair_radius_m) or pair_radius_m <= 0.0:
        fail(
            "INVALID_PHYSICAL_POINT_DEDUPLICATION",
            "the combined physical point radius must be finite and positive",
        )
    minimum = np.min(rows, axis=0)
    maximum = np.max(rows, axis=0)
    origin = 0.5 * minimum + 0.5 * maximum
    local_rows = np.asarray(rows - origin, dtype=np.float64)
    if not np.all(np.isfinite(origin)) or not np.all(np.isfinite(local_rows)):
        fail(
            "INSUFFICIENT_PHYSICAL_POINT_PRECISION",
            "point coordinates cannot be localized finitely for physical deduplication",
        )
    maximum_input_coordinate_ulp_m = max(
        math.ulp(float(value)) for value in np.asarray(rows).reshape(-1)
    )
    decision_epsilon_m = max(
        16.0 * math.ulp(pair_radius_m),
        64.0 * float(np.finfo(np.float64).eps) * max(1.0, pair_radius_m),
    )
    coordinate_resolution_allowance_m = 4.0 * maximum_input_coordinate_ulp_m
    if (
        not math.isfinite(decision_epsilon_m)
        or not math.isfinite(coordinate_resolution_allowance_m)
        or coordinate_resolution_allowance_m
        > max(comparison_epsilon_m, decision_epsilon_m)
    ):
        fail(
            "INSUFFICIENT_PHYSICAL_POINT_PRECISION",
            "stored coordinate precision is too coarse for the declared physical deduplication radius",
        )
    tree_candidate_epsilon_m = max(
        decision_epsilon_m, coordinate_resolution_allowance_m
    )
    return (
        local_rows,
        origin,
        decision_epsilon_m,
        tree_candidate_epsilon_m,
        maximum_input_coordinate_ulp_m,
    )


def _deduplicate_physical_points(
    points: Any,
    weights: Any,
    *,
    tolerance_m: float,
    comparison_epsilon_m: float,
    np: Any,
) -> tuple[Any, Any, dict[str, Any]]:
    """Collapse connected clouds of physically indistinguishable samples.

    Exact-row uniqueness is not a physical density control: a scanner or file
    conversion can jitter repeated samples by a few nanometres.  The neighbour
    graph below is defined only by Euclidean distance, so its connected
    components are independent of input order, coordinate origin, and rigid
    orientation.  A multiplicity-insensitive diameter anchor and a physical
    configuration center with one vote per component define a continuous
    outward support point.  This keeps a nanometre duplicate from shrinking a
    genuine boundary merely because the room was rotated.  A deliberately
    chained or oversized component is omitted and therefore cannot add votes.
    """

    rows = _require_finite_matrix(points, 3, "physical point deduplication", np)
    sample_weights = np.asarray(weights, dtype=np.float64)
    if (
        sample_weights.shape != (rows.shape[0],)
        or not np.all(np.isfinite(sample_weights))
        or np.any(sample_weights <= 0.0)
        or not math.isfinite(tolerance_m)
        or tolerance_m <= 0.0
        or not math.isfinite(comparison_epsilon_m)
        or comparison_epsilon_m < 0.0
    ):
        fail(
            "INVALID_PHYSICAL_POINT_DEDUPLICATION",
            "physical point samples, weights, and tolerances must be finite",
        )
    if rows.shape[0] <= 1:
        return rows.copy(), sample_weights.copy(), {
            "rawPointCount": int(rows.shape[0]),
            "physicalPointCount": int(rows.shape[0]),
            "removedPointCount": 0,
            "componentCount": int(rows.shape[0]),
            "largestComponentRawPointCount": int(rows.shape[0]),
            "distanceToleranceMeters": tolerance_m,
            "comparisonEpsilonMeters": comparison_epsilon_m,
            "componentRule": "Euclidean-distance connected components",
            "workingPointRule": "single observed point",
            "provenanceRule": "observed component medoid nearest the arithmetic center",
            "representativeInputIndexes": list(range(rows.shape[0])),
        }
    try:
        from scipy.spatial import cKDTree
    except Exception as error:  # pragma: no cover - production dependency gate
        fail(
            "PHYSICAL_POINT_DEDUPLICATION_DEPENDENCY_UNAVAILABLE",
            f"SciPy cKDTree is required for physical point deduplication: {error}",
        )
    pair_radius_m = tolerance_m + comparison_epsilon_m
    (
        localized_rows,
        localization_origin,
        numerical_epsilon_m,
        tree_candidate_epsilon_m,
        maximum_input_coordinate_ulp_m,
    ) = _localized_metric_rows(
        rows,
        pair_radius_m=pair_radius_m,
        comparison_epsilon_m=comparison_epsilon_m,
        np=np,
    )
    geometric_anchor_tie_epsilon_m = max(
        numerical_epsilon_m,
        8.0 * maximum_input_coordinate_ulp_m,
    )
    pairs = cKDTree(localized_rows).query_pairs(
        pair_radius_m + tree_candidate_epsilon_m, output_type="ndarray"
    )
    parent = np.arange(rows.shape[0], dtype=np.int64)
    component_size = np.ones(rows.shape[0], dtype=np.int64)

    def find(raw_index: int) -> int:
        index = raw_index
        while int(parent[index]) != index:
            parent[index] = parent[int(parent[index])]
            index = int(parent[index])
        return index

    for raw_left, raw_right in pairs:
        if (
            math.dist(
                tuple(float(value) for value in localized_rows[int(raw_left)]),
                tuple(float(value) for value in localized_rows[int(raw_right)]),
            )
            > pair_radius_m + numerical_epsilon_m
        ):
            continue
        left = find(int(raw_left))
        right = find(int(raw_right))
        if left == right:
            continue
        if int(component_size[left]) < int(component_size[right]):
            left, right = right, left
        parent[right] = left
        component_size[left] += component_size[right]
    components: dict[int, list[int]] = {}
    for raw_index in range(rows.shape[0]):
        components.setdefault(find(raw_index), []).append(raw_index)
    ordered_components = sorted(
        components.values(),
        key=lambda component: tuple(
            float(value)
            for value in rows[
                min(component, key=lambda index: tuple(float(v) for v in rows[index]))
            ]
        ),
    )
    eligible_components: list[list[int]] = []
    component_anchors: list[Any] = []
    component_diameters_m: list[float] = []
    omitted_component_reasons: list[str] = []
    for component in ordered_components:
        local_anchor, diameter_m, omitted_reason = _bounded_component_geometric_anchor(
            localized_rows,
            component,
            maximum_diameter_m=pair_radius_m,
            numerical_epsilon_m=numerical_epsilon_m,
            geometric_tie_epsilon_m=geometric_anchor_tie_epsilon_m,
            np=np,
        )
        if local_anchor is None:
            omitted_component_reasons.append(str(omitted_reason))
            continue
        anchor = np.asarray(local_anchor + localization_origin, dtype=np.float64)
        eligible_components.append(component)
        component_anchors.append(anchor)
        component_diameters_m.append(diameter_m)
    representatives: list[list[float]] = []
    representative_weights: list[float] = []
    representative_input_indexes: list[int] = []
    physical_configuration_center = (
        np.asarray(
            [
                math.fsum(
                    sorted(
                        float(anchor[axis]) / len(component_anchors)
                        for anchor in component_anchors
                    )
                )
                for axis in range(3)
            ],
            dtype=np.float64,
        )
        if component_anchors
        else np.mean(rows, axis=0)
    )
    for component, component_anchor in zip(
        eligible_components, component_anchors, strict=True
    ):
        outward = component_anchor - physical_configuration_center
        outward_norm = float(np.linalg.norm(outward))
        representative_point = component_anchor.copy()
        if outward_norm > numerical_epsilon_m:
            outward_unit = outward / outward_norm
            outward_projections_m = {
                index: float((rows[index] - component_anchor) @ outward_unit)
                for index in component
            }
            maximum_outward_projection_m = max(outward_projections_m.values())
            support_rows = np.unique(
                np.asarray(
                    [
                        rows[index]
                        for index in component
                        if maximum_outward_projection_m
                        - outward_projections_m[index]
                        <= numerical_epsilon_m
                    ],
                    dtype=np.float64,
                ),
                axis=0,
            )
            representative_point = np.asarray(
                [
                    math.fsum(
                        sorted(
                            float(value) / support_rows.shape[0]
                            for value in support_rows[:, axis]
                        )
                    )
                    for axis in range(3)
                ],
                dtype=np.float64,
            )
        representative_index = min(
            component,
            key=lambda index: (
                float(np.sum((rows[index] - representative_point) ** 2)),
                tuple(float(value) for value in rows[index]),
            ),
        )
        representatives.append([float(value) for value in representative_point])
        representative_input_indexes.append(representative_index)
        representative_weights.append(
            max(float(sample_weights[index]) for index in component)
        )
    largest_component_size = max(len(component) for component in components.values())
    return (
        (
            np.asarray(representatives, dtype=np.float64)
            if representatives
            else np.empty((0, 3), dtype=np.float64)
        ),
        np.asarray(representative_weights, dtype=np.float64),
        {
            "rawPointCount": int(rows.shape[0]),
            "physicalPointCount": len(eligible_components),
            "removedPointCount": int(rows.shape[0] - len(eligible_components)),
            "componentCount": len(ordered_components),
            "eligibleBoundedComponentCount": len(eligible_components),
            "ambiguousOrOversizedComponentsOmitted": len(
                omitted_component_reasons
            ),
            "omittedComponentReasons": omitted_component_reasons[:8],
            "largestComponentRawPointCount": largest_component_size,
            "distanceToleranceMeters": tolerance_m,
            "comparisonEpsilonMeters": comparison_epsilon_m,
            "componentRule": "Euclidean-distance candidates with explicit metric recheck; single-link chains wider than the declared tolerance are omitted",
            "maximumEligibleComponentDiameterMeters": pair_radius_m,
            "largestEligibleComponentDiameterMeters": max(
                component_diameters_m, default=0.0
            ),
            "floatingPointDistanceComparisonEpsilonMeters": numerical_epsilon_m,
            "geometricAnchorTieEpsilonMeters": geometric_anchor_tie_epsilon_m,
            "geometricAnchorTieEpsilonDoesNotWidenPhysicalDiameterGate": True,
            "treeCandidateSearchEpsilonMeters": tree_candidate_epsilon_m,
            "maximumInputCoordinateUlpMeters": maximum_input_coordinate_ulp_m,
            "distanceLocalizationOriginMeters": [
                float(value) for value in localization_origin
            ],
            "distanceCandidateSearchUsesLocalizedCoordinates": True,
            "coordinateResolutionMustFitDeclaredComparisonEpsilon": True,
            "workingPointRule": "multiplicity-insensitive observed support point facing away from the one-vote-per-component configuration center; exact projection ties average unique coordinates",
            "physicalConfigurationCenterMeters": [
                float(value) for value in physical_configuration_center
            ],
            "provenanceRule": "observed member nearest the synthetic working point; provenance does not define working geometry",
            "representativeInputIndexes": representative_input_indexes,
        },
    )


def _physical_wall_representative_indexes(
    points: Any,
    normals_xy: Any,
    *,
    distance_tolerance_m: float,
    comparison_epsilon_m: float,
    minimum_normal_dot: float,
    np: Any,
) -> tuple[Any, Any, Any, dict[str, Any]]:
    """Collapse one mutually compatible near-coincident wall-normal family.

    The returned input index is provenance only.  Working geometry uses the
    multiplicity-insensitive diameter anchor and the midpoint of the smallest
    axial angular arc.  Coordinate-axis ties therefore cannot choose a
    different observed working sample after a rigid yaw, and repeated interior
    samples cannot steer either the point or normal consensus.  A transitive
    spatial or normal chain wider than one compatible family is omitted
    fail-closed.
    """

    rows = _require_finite_matrix(points, 3, "physical wall deduplication", np)
    normals = _require_finite_matrix(
        normals_xy, 2, "physical wall deduplication normals", np
    )
    normal_norms = np.linalg.norm(normals, axis=1)
    if (
        normals.shape[0] != rows.shape[0]
        or np.any(np.abs(normal_norms - 1.0) > 1e-6)
        or not math.isfinite(distance_tolerance_m)
        or distance_tolerance_m <= 0.0
        or not math.isfinite(comparison_epsilon_m)
        or comparison_epsilon_m < 0.0
        or not math.isfinite(minimum_normal_dot)
        or not 0.0 < minimum_normal_dot <= 1.0
    ):
        fail(
            "INVALID_PHYSICAL_WALL_DEDUPLICATION",
            "wall points, normals, and physical tolerances are invalid",
        )
    normals = np.asarray(normals / normal_norms[:, None], dtype=np.float64)
    if rows.shape[0] <= 1:
        indexes = np.arange(rows.shape[0], dtype=np.int64)
        return indexes, rows.copy(), normals.copy(), {
            "rawWallSurfaceCount": int(rows.shape[0]),
            "physicalWallSurfaceCount": int(rows.shape[0]),
            "removedWallSurfaceCount": 0,
            "distanceToleranceMeters": distance_tolerance_m,
            "comparisonEpsilonMeters": comparison_epsilon_m,
            "minimumCompatibleNormalDot": minimum_normal_dot,
            "acceptedNearUnitNormalsRenormalizedBeforeComparison": True,
            "workingPointRule": "single observed point",
            "workingNormalRule": "axial angular midrange",
            "provenanceRule": "the single observed input row",
            "ambiguousSpatialComponentsOmitted": 0,
            "ambiguousNormalComponentsOmitted": 0,
            "ambiguousComponentsOmitted": 0,
        }
    try:
        from scipy.spatial import cKDTree
    except Exception as error:  # pragma: no cover - production dependency gate
        fail(
            "PHYSICAL_WALL_DEDUPLICATION_DEPENDENCY_UNAVAILABLE",
            f"SciPy cKDTree is required for wall deduplication: {error}",
        )
    pair_radius_m = distance_tolerance_m + comparison_epsilon_m
    (
        localized_rows,
        localization_origin,
        numerical_epsilon_m,
        tree_candidate_epsilon_m,
        maximum_input_coordinate_ulp_m,
    ) = _localized_metric_rows(
        rows,
        pair_radius_m=pair_radius_m,
        comparison_epsilon_m=comparison_epsilon_m,
        np=np,
    )
    geometric_anchor_tie_epsilon_m = max(
        numerical_epsilon_m,
        8.0 * maximum_input_coordinate_ulp_m,
    )
    pairs = cKDTree(localized_rows).query_pairs(
        pair_radius_m + tree_candidate_epsilon_m, output_type="ndarray"
    )
    parent = np.arange(rows.shape[0], dtype=np.int64)
    component_size = np.ones(rows.shape[0], dtype=np.int64)

    def find(raw_index: int) -> int:
        index = raw_index
        while int(parent[index]) != index:
            parent[index] = parent[int(parent[index])]
            index = int(parent[index])
        return index

    for raw_first, raw_second in pairs:
        first_index = int(raw_first)
        second_index = int(raw_second)
        if (
            math.dist(
                tuple(float(value) for value in localized_rows[first_index]),
                tuple(float(value) for value in localized_rows[second_index]),
            )
            > pair_radius_m + numerical_epsilon_m
        ):
            continue
        if (
            abs(float(normals[first_index] @ normals[second_index])) + 1e-12
            < minimum_normal_dot
        ):
            continue
        first = find(first_index)
        second = find(second_index)
        if first == second:
            continue
        if int(component_size[first]) < int(component_size[second]):
            first, second = second, first
        parent[second] = first
        component_size[first] += component_size[second]
    components: dict[int, list[int]] = {}
    for raw_index in range(rows.shape[0]):
        components.setdefault(find(raw_index), []).append(raw_index)
    representatives: list[int] = []
    working_points: list[Any] = []
    working_normals: list[Any] = []
    ambiguous_spatial_components_omitted = 0
    ambiguous_normal_components_omitted = 0
    omitted_spatial_component_reasons: list[str] = []
    eligible_component_diameters_m: list[float] = []
    maximum_family_width_radians = math.acos(
        min(1.0, max(-1.0, float(minimum_normal_dot)))
    )
    for component in components.values():
        local_anchor, component_diameter_m, omitted_reason = (
            _bounded_component_geometric_anchor(
                localized_rows,
                component,
                maximum_diameter_m=pair_radius_m,
                numerical_epsilon_m=numerical_epsilon_m,
                geometric_tie_epsilon_m=geometric_anchor_tie_epsilon_m,
                np=np,
            )
        )
        if local_anchor is None:
            ambiguous_spatial_components_omitted += 1
            omitted_spatial_component_reasons.append(str(omitted_reason))
            continue
        anchor = np.asarray(local_anchor + localization_origin, dtype=np.float64)
        eligible_component_diameters_m.append(component_diameter_m)
        axial_angles = sorted(
            {
                float(math.atan2(float(normals[index, 1]), float(normals[index, 0])))
                % math.pi
                for index in component
            }
        )
        if len(axial_angles) == 1:
            covering_arc_start = axial_angles[0]
            covering_arc_width = 0.0
        else:
            circular_gaps = [
                axial_angles[index + 1] - axial_angles[index]
                for index in range(len(axial_angles) - 1)
            ] + [axial_angles[0] + math.pi - axial_angles[-1]]
            largest_gap_index = max(
                range(len(circular_gaps)), key=lambda index: circular_gaps[index]
            )
            covering_arc_start = axial_angles[
                (largest_gap_index + 1) % len(axial_angles)
            ]
            covering_arc_width = math.pi - circular_gaps[largest_gap_index]
        if covering_arc_width > maximum_family_width_radians + 1e-12:
            ambiguous_normal_components_omitted += 1
            continue
        consensus_angle = (
            covering_arc_start + 0.5 * covering_arc_width
        ) % math.pi
        consensus_normal = np.asarray(
            [math.cos(consensus_angle), math.sin(consensus_angle)],
            dtype=np.float64,
        )
        consensus_normal, _unused_offset = _canonical_xy_plane(
            consensus_normal, 0.0, np=np
        )
        representative = min(
            component,
            key=lambda index: (
                float(np.sum((rows[index] - anchor) ** 2)),
                -abs(float(normals[index] @ consensus_normal)),
                tuple(float(value) for value in rows[index]),
                tuple(float(value) for value in normals[index]),
            ),
        )
        representatives.append(representative)
        working_points.append(anchor)
        working_normals.append(consensus_normal)
    indexes = np.asarray(representatives, dtype=np.int64)
    working_point_rows = (
        np.vstack(working_points)
        if working_points
        else np.empty((0, 3), dtype=np.float64)
    )
    working_normal_rows = (
        np.vstack(working_normals)
        if working_normals
        else np.empty((0, 2), dtype=np.float64)
    )
    return indexes, working_point_rows, working_normal_rows, {
        "rawWallSurfaceCount": int(rows.shape[0]),
        "physicalWallSurfaceCount": int(indexes.size),
        "removedWallSurfaceCount": int(rows.shape[0] - indexes.size),
        "distanceToleranceMeters": distance_tolerance_m,
        "comparisonEpsilonMeters": comparison_epsilon_m,
        "minimumCompatibleNormalDot": minimum_normal_dot,
        "acceptedNearUnitNormalsRenormalizedBeforeComparison": True,
        "componentRule": "Euclidean-distance candidates with explicit metric recheck within one compatible wall-normal family; single-link spatial chains wider than the declared tolerance are omitted",
        "maximumEligibleComponentDiameterMeters": pair_radius_m,
        "largestEligibleComponentDiameterMeters": max(
            eligible_component_diameters_m, default=0.0
        ),
        "floatingPointDistanceComparisonEpsilonMeters": numerical_epsilon_m,
        "geometricAnchorTieEpsilonMeters": geometric_anchor_tie_epsilon_m,
        "geometricAnchorTieEpsilonDoesNotWidenPhysicalDiameterGate": True,
        "treeCandidateSearchEpsilonMeters": tree_candidate_epsilon_m,
        "maximumInputCoordinateUlpMeters": maximum_input_coordinate_ulp_m,
        "distanceLocalizationOriginMeters": [
            float(value) for value in localization_origin
        ],
        "distanceCandidateSearchUsesLocalizedCoordinates": True,
        "coordinateResolutionMustFitDeclaredComparisonEpsilon": True,
        "maximumMutuallyCompatibleNormalFamilyWidthDegrees": math.degrees(
            maximum_family_width_radians
        ),
        "workingPointRule": "multiplicity-insensitive midpoint consensus of all diameter-tied pairs within a bounded component",
        "workingNormalRule": "midpoint of the smallest axial angular covering arc; multiplicity cannot steer it",
        "provenanceRule": "observed member nearest the synthetic working point, then closest to the consensus normal; provenance does not define working geometry",
        "ambiguousSpatialComponentsOmitted": ambiguous_spatial_components_omitted,
        "omittedSpatialComponentReasons": omitted_spatial_component_reasons[:8],
        "ambiguousNormalComponentsOmitted": ambiguous_normal_components_omitted,
        "ambiguousComponentsOmitted": (
            ambiguous_spatial_components_omitted
            + ambiguous_normal_components_omitted
        ),
    }


def _within_scalar_support_distance(
    values: Any,
    support_positions: Any,
    *,
    maximum_distance_m: float,
    physical_epsilon_m: float,
    np: Any,
) -> Any:
    """Return which values have a real support position within a fixed distance."""

    query = np.asarray(values, dtype=np.float64)
    support = np.sort(np.asarray(support_positions, dtype=np.float64))
    if (
        query.ndim != 1
        or support.ndim != 1
        or not np.all(np.isfinite(query))
        or not np.all(np.isfinite(support))
        or maximum_distance_m <= 0.0
        or physical_epsilon_m <= 0.0
    ):
        fail("INVALID_SCALAR_SUPPORT", "scalar support inputs and distances must be finite")
    if support.size == 0:
        return np.zeros(query.size, dtype=bool)
    insertion = np.searchsorted(support, query, side="left")
    left_index = np.clip(insertion - 1, 0, support.size - 1)
    right_index = np.clip(insertion, 0, support.size - 1)
    nearest_distance = np.minimum(
        np.abs(query - support[left_index]),
        np.abs(query - support[right_index]),
    )
    return nearest_distance <= maximum_distance_m + physical_epsilon_m


def _physical_scalar_run_intervals(
    values: Any,
    *,
    maximum_gap_m: float,
    endpoint_padding_m: float,
    physical_epsilon_m: float,
    np: Any,
) -> tuple[tuple[float, float], ...]:
    """Measure sampled 1D runs without inflating one sample to the gap limit."""

    ordered = _cluster_scalar_positions(
        values,
        tolerance_m=physical_epsilon_m,
        np=np,
    )
    if (
        maximum_gap_m <= 0.0
        or endpoint_padding_m <= 0.0
        or not math.isfinite(maximum_gap_m)
        or not math.isfinite(endpoint_padding_m)
    ):
        fail("INVALID_SCALAR_COVERAGE", "physical coverage thresholds must be positive")
    if ordered.size == 0:
        return ()
    intervals: list[tuple[float, float]] = []
    start = float(ordered[0])
    previous = float(ordered[0])
    for raw_value in ordered[1:]:
        value = float(raw_value)
        if value - previous > maximum_gap_m + physical_epsilon_m:
            intervals.append(
                (start - endpoint_padding_m, previous + endpoint_padding_m)
            )
            start = value
        previous = value
    intervals.append((start - endpoint_padding_m, previous + endpoint_padding_m))
    return tuple(intervals)


def _wall_tangent_segments(
    patch_points: Any,
    tangent_values: Any,
    *,
    config: StructuralConfig,
    np: Any,
) -> tuple[WallTangentSegment, ...]:
    """Split a wall into local runs with density-equalized vertical endpoints.

    Tangent bins are anchored to each segment's own minimum and maximum rather
    than to the map origin.  Each bin contributes at most one lower and one
    upper endpoint, so duplicating mid-wall points cannot move an endpoint.
    Bins without a meaningful vertical span are not allowed to claim that they
    reach the floor or ceiling.
    """

    points = _require_finite_matrix(patch_points, 3, "wall patch points", np)
    tangent = np.asarray(tangent_values, dtype=np.float64)
    if tangent.shape != (points.shape[0],) or not np.all(np.isfinite(tangent)):
        fail("INVALID_WALL_SEGMENT_INPUT", "wall tangent coordinates must match wall points")
    if (
        config.plane_occupancy_cell_m <= 0.0
        or config.horizontal_level_wall_segment_max_tangent_gap_m <= 0.0
        or config.horizontal_level_wall_contact_dedup_tolerance_m <= 0.0
        or not 0.0
        < config.horizontal_level_min_wall_vertical_span_fraction
        <= 1.0
    ):
        fail("INVALID_WALL_SEGMENT_CONFIG", "local wall-segment thresholds are invalid")
    order = np.argsort(tangent, kind="stable")
    groups: list[list[int]] = []
    current: list[int] = []
    previous_value: float | None = None
    for raw_index in order:
        index = int(raw_index)
        value = float(tangent[index])
        if (
            previous_value is not None
            and value - previous_value
            > config.horizontal_level_wall_segment_max_tangent_gap_m
            + config.horizontal_level_wall_contact_dedup_tolerance_m
        ):
            groups.append(current)
            current = []
        current.append(index)
        previous_value = value
    if current:
        groups.append(current)
    segments: list[WallTangentSegment] = []
    cell_m = config.plane_occupancy_cell_m
    physical_epsilon_m = config.horizontal_level_wall_contact_dedup_tolerance_m
    for segment_id, group in enumerate(groups):
        group_indexes = np.asarray(group, dtype=np.int64)
        group_tangent = tangent[group_indexes]
        group_z = points[group_indexes, 2]
        distinct_tangent = _cluster_scalar_positions(
            group_tangent,
            tolerance_m=config.horizontal_level_wall_contact_dedup_tolerance_m,
            np=np,
        )
        tangent_low = float(np.min(group_tangent))
        tangent_high = float(np.max(group_tangent))
        tangent_span = tangent_high - tangent_low
        bin_count = max(
            1,
            int(math.ceil(max(0.0, tangent_span - physical_epsilon_m) / cell_m)),
        )
        if tangent_span <= physical_epsilon_m:
            bin_ids = np.zeros(group_tangent.size, dtype=np.int64)
            bin_width_m = cell_m
        else:
            normalized = (group_tangent - tangent_low) / tangent_span
            bin_ids = np.floor(normalized * bin_count).astype(np.int64)
            bin_ids = np.clip(bin_ids, 0, bin_count - 1)
            bin_width_m = tangent_span / bin_count

        endpoint_columns: list[dict[str, float]] = []
        for bin_id in sorted(int(value) for value in np.unique(bin_ids)):
            column_z = group_z[bin_ids == bin_id]
            distinct_z = _cluster_scalar_positions(
                column_z,
                tolerance_m=physical_epsilon_m,
                np=np,
            )
            positive_z_gaps = np.diff(distinct_z)
            endpoint_columns.append(
                {
                    "tangentCenterMeters": float(
                        tangent_low + (bin_id + 0.5) * bin_width_m
                    ),
                    "lowerEndpointMeters": float(np.min(column_z)),
                    "upperEndpointMeters": float(np.max(column_z)),
                    "verticalSpanMeters": float(np.max(column_z) - np.min(column_z)),
                    "typicalVerticalSamplingGapMeters": (
                        float(np.median(positive_z_gaps))
                        if positive_z_gaps.size
                        else cell_m
                    ),
                }
            )
        consensus_span_candidates = np.asarray(
            [
                column["verticalSpanMeters"]
                for column in endpoint_columns
                if column["verticalSpanMeters"] + physical_epsilon_m
                >= 2.0 * cell_m
            ],
            dtype=np.float64,
        )
        reference_column_span_m = (
            float(np.median(consensus_span_candidates))
            if consensus_span_candidates.size
            else 0.0
        )
        minimum_endpoint_column_span_m = max(
            2.0 * cell_m,
            reference_column_span_m
            * config.horizontal_level_min_wall_vertical_span_fraction,
        )
        full_height_columns = [
            column
            for column in endpoint_columns
            if column["verticalSpanMeters"] + physical_epsilon_m
            >= minimum_endpoint_column_span_m
        ]
        if full_height_columns:
            robust_lower = float(
                np.median(
                    np.asarray(
                        [column["lowerEndpointMeters"] for column in full_height_columns],
                        dtype=np.float64,
                    )
                )
            )
            robust_upper = float(
                np.median(
                    np.asarray(
                        [column["upperEndpointMeters"] for column in full_height_columns],
                        dtype=np.float64,
                    )
                )
            )
            typical_z_gap = float(
                np.median(
                    np.asarray(
                        [
                            column["typicalVerticalSamplingGapMeters"]
                            for column in full_height_columns
                        ],
                        dtype=np.float64,
                    )
                )
            )
            endpoint_consistency_tolerance_m = min(
                max(
                    4.0 * config.horizontal_level_max_residual_m,
                    1.5 * cell_m,
                    typical_z_gap + 0.5 * cell_m,
                ),
                config.horizontal_level_max_wall_endpoint_tolerance_m,
            )
            lower_endpoint_support_positions = tuple(
                column["tangentCenterMeters"]
                for column in full_height_columns
                if abs(column["lowerEndpointMeters"] - robust_lower)
                <= endpoint_consistency_tolerance_m + physical_epsilon_m
            )
            upper_endpoint_support_positions = tuple(
                column["tangentCenterMeters"]
                for column in full_height_columns
                if abs(column["upperEndpointMeters"] - robust_upper)
                <= endpoint_consistency_tolerance_m + physical_epsilon_m
            )
        else:
            robust_lower = float(np.min(group_z))
            robust_upper = float(np.max(group_z))
            typical_z_gap = cell_m
            lower_endpoint_support_positions = ()
            upper_endpoint_support_positions = ()
        segments.append(
            WallTangentSegment(
                segment_id=segment_id,
                tangent_range_m=(tangent_low, tangent_high),
                raw_point_count=int(group_indexes.size),
                distinct_tangent_position_count=int(distinct_tangent.size),
                endpoint_column_count=len(full_height_columns),
                robust_z_range_m=(robust_lower, robust_upper),
                typical_vertical_sampling_gap_m=typical_z_gap,
                lower_endpoint_support_tangent_positions_m=(
                    lower_endpoint_support_positions
                ),
                upper_endpoint_support_tangent_positions_m=(
                    upper_endpoint_support_positions
                ),
            )
        )
    if not segments:
        fail("INVALID_WALL_SEGMENT_INPUT", "wall patch yielded no tangent segment")
    return tuple(segments)


def _convex_hull_area_xy(points_xy: Any, *, np: Any) -> float:
    """Return rotation/translation-invariant 2D hull area without a global grid."""

    points = _require_finite_matrix(points_xy, 2, "horizontal footprint XY", np)
    unique = np.unique(points, axis=0)
    if unique.shape[0] < 3:
        return 0.0
    # Keep the shoelace arithmetic near a local origin.  Large map offsets can
    # otherwise lose enough precision to flip an exact physical boundary.
    local_origin = np.min(unique, axis=0) + 0.5 * (
        np.max(unique, axis=0) - np.min(unique, axis=0)
    )
    unique = unique - local_origin
    order = np.lexsort((unique[:, 1], unique[:, 0]))
    rows = [(float(unique[index, 0]), float(unique[index, 1])) for index in order]

    def cross(origin: tuple[float, float], first: tuple[float, float], second: tuple[float, float]) -> float:
        return (first[0] - origin[0]) * (second[1] - origin[1]) - (
            first[1] - origin[1]
        ) * (second[0] - origin[0])

    lower: list[tuple[float, float]] = []
    for row in rows:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], row) <= 0.0:
            lower.pop()
        lower.append(row)
    upper: list[tuple[float, float]] = []
    for row in reversed(rows):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], row) <= 0.0:
            upper.pop()
        upper.append(row)
    hull = lower[:-1] + upper[:-1]
    if len(hull) < 3:
        return 0.0
    twice_area = math.fsum(
        hull[index][0] * hull[(index + 1) % len(hull)][1]
        - hull[index][1] * hull[(index + 1) % len(hull)][0]
        for index in range(len(hull))
    )
    return 0.5 * abs(twice_area)


def _stabilize_cocircular_delaunay_diagonals(
    points_xy: Any,
    simplices: Any,
    *,
    metric_boundary_epsilon_m: float,
    np: Any,
) -> tuple[Any, int]:
    """Choose the shorter diagonal for numerically cocircular quadrilaterals."""

    points = _require_finite_matrix(points_xy, 2, "local Delaunay XY", np)
    triangles = np.asarray(simplices, dtype=np.int64).copy()
    if triangles.ndim != 2 or triangles.shape[1] != 3:
        fail("INVALID_DELAUNAY_INPUT", "Delaunay simplices must be N by 3")
    flip_count = 0
    maximum_flips = max(1, 2 * triangles.shape[0])
    cocircular_angle_tolerance_radians = 1e-10

    def cross(first: Any, second: Any) -> float:
        return float(first[0] * second[1] - first[1] * second[0])

    for _flip_number in range(maximum_flips):
        triangle_by_edge: dict[tuple[int, int], list[int]] = {}
        for triangle_index, simplex in enumerate(triangles):
            for first_vertex, second_vertex in (
                (int(simplex[0]), int(simplex[1])),
                (int(simplex[1]), int(simplex[2])),
                (int(simplex[2]), int(simplex[0])),
            ):
                triangle_by_edge.setdefault(
                    tuple(sorted((first_vertex, second_vertex))), []
                ).append(triangle_index)
        flipped = False
        for (first_vertex, second_vertex), triangle_indexes in sorted(
            triangle_by_edge.items()
        ):
            if len(triangle_indexes) != 2:
                continue
            first_triangle_index, second_triangle_index = triangle_indexes
            first_opposite = [
                int(value)
                for value in triangles[first_triangle_index]
                if int(value) not in {first_vertex, second_vertex}
            ]
            second_opposite = [
                int(value)
                for value in triangles[second_triangle_index]
                if int(value) not in {first_vertex, second_vertex}
            ]
            if len(first_opposite) != 1 or len(second_opposite) != 1:
                continue
            third_vertex = first_opposite[0]
            fourth_vertex = second_opposite[0]
            first_point = points[first_vertex]
            second_point = points[second_vertex]
            third_point = points[third_vertex]
            fourth_point = points[fourth_vertex]
            current_diagonal_m = float(
                np.linalg.norm(first_point - second_point)
            )
            alternate_diagonal_m = float(
                np.linalg.norm(third_point - fourth_point)
            )
            if (
                current_diagonal_m
                <= alternate_diagonal_m + metric_boundary_epsilon_m
            ):
                continue
            alternate_axis = fourth_point - third_point
            first_side = cross(first_point - third_point, alternate_axis)
            second_side = cross(second_point - third_point, alternate_axis)
            if first_side * second_side >= 0.0:
                continue

            def angle_at(vertex: Any, first: Any, second: Any) -> float:
                first_vector = first - vertex
                second_vector = second - vertex
                return math.atan2(
                    abs(cross(first_vector, second_vector)),
                    float(first_vector @ second_vector),
                )

            opposite_angle_sum = angle_at(
                third_point, first_point, second_point
            ) + angle_at(fourth_point, first_point, second_point)
            if (
                abs(opposite_angle_sum - math.pi)
                > cocircular_angle_tolerance_radians
            ):
                continue
            triangles[first_triangle_index] = np.asarray(
                [third_vertex, fourth_vertex, first_vertex], dtype=np.int64
            )
            triangles[second_triangle_index] = np.asarray(
                [fourth_vertex, third_vertex, second_vertex], dtype=np.int64
            )
            flip_count += 1
            flipped = True
            break
        if not flipped:
            return triangles, flip_count
    fail(
        "DELAUNAY_DIAGONAL_STABILIZATION_DID_NOT_CONVERGE",
        "cocircular shorter-diagonal stabilization exceeded its finite flip budget",
    )


def _is_multi_point_cocircular(
    points_xy: Any,
    *,
    minimum_point_count: int = 5,
    metric_boundary_epsilon_m: float,
    np: Any,
) -> bool:
    """Return whether enough points form one numerically clear circle."""

    points = _require_finite_matrix(points_xy, 2, "cocircular XY", np)
    if minimum_point_count < 4 or points.shape[0] < minimum_point_count:
        return False
    local = points - np.mean(points, axis=0)
    design = np.column_stack(
        (2.0 * local[:, 0], 2.0 * local[:, 1], np.ones(local.shape[0]))
    )
    rhs = np.sum(local * local, axis=1)
    solution, _residuals, rank, _singular = np.linalg.lstsq(design, rhs, rcond=None)
    if int(rank) < 3:
        return False
    fitted_radius_squared = (
        solution[2] + solution[0] * solution[0] + solution[1] * solution[1]
    )
    if fitted_radius_squared <= 0.0:
        return False
    algebraic_residual = np.abs(design @ solution - rhs)
    radius_m = math.sqrt(float(fitted_radius_squared))
    # Convert the algebraic r^2 residual to a conservative radial tolerance.
    radial_residual = algebraic_residual / max(2.0 * radius_m, 1e-12)
    tolerance_m = max(1e-8, 10.0 * metric_boundary_epsilon_m)
    return bool(float(np.max(radial_residual)) <= tolerance_m)


def _circular_boundary_interior_support_evidence(
    points_xy: Any,
    *,
    metric_boundary_epsilon_m: float,
    np: Any,
) -> dict[str, Any]:
    """Measure whether a well-sampled outer boundary has distributed fill.

    Exact cocircularity is not a useful scanner predicate: nanometre noise can
    turn it off, while a genuinely filled disk can still have an exact circular
    outer sample.  A circle fit is retained as diagnostic evidence, but the
    fail-closed screen applies to any outer trace with at least eight boundary
    samples, including ellipses and collinear samples along polygon edges.
    Interior support requires enough strictly interior points, substantial
    convex-hull area, and rotation-invariant angular coverage.
    """

    points = _require_finite_matrix(points_xy, 2, "circular boundary XY", np)
    if (
        not _is_finite_real(metric_boundary_epsilon_m)
        or metric_boundary_epsilon_m < 0.0
    ):
        fail(
            "INVALID_HORIZONTAL_ENVELOPE_INPUT",
            "outer-boundary support tolerance must be finite and nonnegative",
        )
    evidence: dict[str, Any] = {
        "assessable": False,
        "convexHullVertexCount": 0,
        "approximatelyCircularBoundary": False,
        "boundaryTraceScreenTriggered": False,
        "convexBoundaryPointCount": 0,
        "strictInteriorPointCount": 0,
        "interiorSupportSufficient": False,
        "minimumStrictInteriorPointCount": 8,
        "minimumInteriorGeometricCoverageFraction": 0.10,
        "interiorGeometricCoverageFraction": 0.0,
        "angularCoverageMethod": "largest circular gap around fitted-center sensitivity anchor",
        "maximumInteriorAngularGapDegrees": None,
        "maximumAllowedInteriorAngularGapDegrees": 180.0,
        "fixedGlobalPolarSectorBinsUsedForDecision": False,
        "interiorLocallyTwoDimensionalPointCount": 0,
        "interiorLocallyTwoDimensionalPointFraction": 0.0,
        "minimumInteriorLocallyTwoDimensionalPointFraction": 0.50,
        "interiorLocalNeighbourRadiusFactor": 1.50,
        "interiorLocalDirectionAngleRangeDegrees": [60.0, 120.0],
        "interiorExtendedNeighbourRadiusFactorForAxialBracketing": 3.0,
        "interiorOppositeDirectionMinimumAngleDegrees": 150.0,
        "interiorLocalTwoDimensionalSupportSufficient": False,
    }
    if points.shape[0] < 8:
        return evidence
    spatial = importlib.import_module("scipy.spatial")
    try:
        hull = spatial.ConvexHull(points)
        hull_vertex_indexes = np.asarray(hull.vertices, dtype=np.int64)
    except Exception as error:
        if type(error).__name__ == "QhullError":
            return evidence
        raise
    evidence["convexHullVertexCount"] = int(hull_vertex_indexes.size)
    hull_points = points[hull_vertex_indexes]
    local_origin = np.mean(hull_points, axis=0)
    local_hull = hull_points - local_origin
    design = np.column_stack(
        (2.0 * local_hull[:, 0], 2.0 * local_hull[:, 1], np.ones(local_hull.shape[0]))
    )
    rhs = np.sum(local_hull * local_hull, axis=1)
    solution, _residuals, rank, _singular = np.linalg.lstsq(
        design, rhs, rcond=None
    )
    fitted_radius_m: float | None = None
    fitted_center = np.mean(hull_points, axis=0)
    radial_residuals = np.empty(0, dtype=np.float64)
    circular_tolerance_m: float | None = None
    approximately_circular = False
    if int(rank) >= 3:
        fitted_radius_squared = (
            float(solution[2])
            + float(solution[0]) ** 2
            + float(solution[1]) ** 2
        )
        if fitted_radius_squared > 0.0:
            fitted_radius_m = math.sqrt(fitted_radius_squared)
            fitted_center = local_origin + np.asarray(
                solution[:2], dtype=np.float64
            )
            hull_radii = np.linalg.norm(hull_points - fitted_center, axis=1)
            radial_residuals = np.abs(hull_radii - fitted_radius_m)
            circular_tolerance_m = max(
                1e-6,
                10.0 * metric_boundary_epsilon_m,
                0.02 * fitted_radius_m,
            )
            approximately_circular = bool(
                float(np.max(radial_residuals)) <= circular_tolerance_m
            )
    hull_equations = np.asarray(hull.equations, dtype=np.float64)
    equation_norms = np.linalg.norm(hull_equations[:, :2], axis=1)
    signed_boundary_distances = (
        points @ hull_equations[:, :2].T + hull_equations[:, 2]
    ) / equation_norms[None, :]
    inward_distance_to_boundary_m = -np.max(
        signed_boundary_distances, axis=1
    )
    strict_boundary_tolerance_m = max(
        1e-8, 10.0 * metric_boundary_epsilon_m
    )
    strict_interior_mask = (
        inward_distance_to_boundary_m > strict_boundary_tolerance_m
    )
    interior_points = points[strict_interior_mask]
    boundary_point_count = int(
        points.shape[0] - interior_points.shape[0]
    )
    boundary_trace_screen_triggered = boundary_point_count >= 8
    evidence.update(
        {
            "assessable": True,
            "fittedCenterXYMeters": [float(value) for value in fitted_center],
            "fittedRadiusMeters": fitted_radius_m,
            "maximumHullRadialResidualMeters": (
                float(np.max(radial_residuals))
                if radial_residuals.size
                else None
            ),
            "p95HullRadialResidualMeters": (
                float(np.percentile(radial_residuals, 95, method="linear"))
                if radial_residuals.size
                else None
            ),
            "circularBoundaryToleranceMeters": circular_tolerance_m,
            "circularBoundaryRelativeToleranceFraction": 0.02,
            "approximatelyCircularBoundary": approximately_circular,
            "strictBoundaryDistanceToleranceMeters": (
                strict_boundary_tolerance_m
            ),
            "convexBoundaryPointCount": boundary_point_count,
            "strictInteriorPointCount": int(interior_points.shape[0]),
            "boundaryTraceScreenTriggered": (
                boundary_trace_screen_triggered
            ),
        }
    )
    outer_hull_area_m2 = _convex_hull_area_xy(hull_points, np=np)
    interior_hull_area_m2 = (
        _convex_hull_area_xy(interior_points, np=np)
        if interior_points.shape[0] >= 3
        else 0.0
    )
    coverage_fraction = (
        interior_hull_area_m2 / outer_hull_area_m2
        if outer_hull_area_m2 > 1e-15
        else 0.0
    )
    interior_deltas = interior_points - fitted_center
    noncentral = np.linalg.norm(interior_deltas, axis=1) > max(
        1e-12, strict_boundary_tolerance_m
    )
    interior_angles = sorted(
        math.atan2(float(delta[1]), float(delta[0])) % (2.0 * math.pi)
        for delta in interior_deltas[noncentral]
    )
    if len(interior_angles) >= 2:
        angular_gaps = [
            interior_angles[index + 1] - interior_angles[index]
            for index in range(len(interior_angles) - 1)
        ] + [
            interior_angles[0] + 2.0 * math.pi - interior_angles[-1]
        ]
        maximum_angular_gap_radians = max(angular_gaps)
    else:
        maximum_angular_gap_radians = 2.0 * math.pi
    angular_coverage_sufficient = (
        maximum_angular_gap_radians
        <= math.pi + 1e-12
    )
    # A second sampled outline can sit strictly inside the outer hull and pass
    # both the count and hull-coverage checks above even though no 2-D surface
    # was observed.  Concave outline edges have the same failure mode because
    # they lie inside the convex hull.  Require most strict-interior samples to
    # have two genuinely different *local* directions among other strict-
    # interior samples.  The radius is tied to each point's nearest-neighbour
    # spacing, so a remote outer ring cannot turn an inner ring into apparent
    # fill.  A compact 60--120 degree pair accepts square/triangular sampling.
    # An anisotropic grid may have its second axis farther away; it is accepted
    # only when two separately bracketed (opposite-sided) axes exist within
    # three nearest-neighbour spacings.  A sampled curve has at most one such
    # local axis and therefore remains fail-closed.
    local_two_dimensional_count = 0
    local_two_dimensional_fraction = 0.0
    local_two_dimensional_support_sufficient = False
    if interior_points.shape[0] >= 2:
        interior_tree = spatial.cKDTree(interior_points)
        nearest_distances, _nearest_indexes = interior_tree.query(
            interior_points, k=2, workers=1
        )
        minimum_direction_dot = math.cos(math.radians(120.0))
        maximum_direction_dot = math.cos(math.radians(60.0))
        maximum_opposite_direction_dot = math.cos(math.radians(150.0))
        for point_index, point in enumerate(interior_points):
            nearest_distance_m = float(nearest_distances[point_index, 1])
            if (
                not math.isfinite(nearest_distance_m)
                or nearest_distance_m <= strict_boundary_tolerance_m
            ):
                continue
            compact_local_radius_m = (
                1.50 * nearest_distance_m + strict_boundary_tolerance_m
            )
            extended_local_radius_m = (
                3.00 * nearest_distance_m + strict_boundary_tolerance_m
            )
            candidate_indexes = interior_tree.query_ball_point(
                point, extended_local_radius_m
            )
            compact_directions: list[Any] = []
            extended_directions: list[Any] = []
            for candidate_index in candidate_indexes:
                if int(candidate_index) == point_index:
                    continue
                delta = interior_points[int(candidate_index)] - point
                distance_m = float(np.linalg.norm(delta))
                if (
                    distance_m <= strict_boundary_tolerance_m
                    or distance_m
                    > extended_local_radius_m + strict_boundary_tolerance_m
                ):
                    continue
                direction = delta / distance_m
                extended_directions.append(direction)
                if (
                    distance_m
                    <= compact_local_radius_m + strict_boundary_tolerance_m
                ):
                    compact_directions.append(direction)
            has_local_two_dimensional_support = False
            for first_index, first_direction in enumerate(compact_directions):
                for second_direction in compact_directions[first_index + 1 :]:
                    direction_dot = float(first_direction @ second_direction)
                    if (
                        minimum_direction_dot - 1e-12
                        <= direction_dot
                        <= maximum_direction_dot + 1e-12
                    ):
                        has_local_two_dimensional_support = True
                        break
                if has_local_two_dimensional_support:
                    break
            if not has_local_two_dimensional_support:
                bracketed_axes: list[Any] = []
                for first_index, first_direction in enumerate(
                    extended_directions
                ):
                    for second_direction in extended_directions[
                        first_index + 1 :
                    ]:
                        if (
                            float(first_direction @ second_direction)
                            > maximum_opposite_direction_dot + 1e-12
                        ):
                            continue
                        axis = first_direction - second_direction
                        axis_norm = float(np.linalg.norm(axis))
                        if axis_norm <= 1e-12:
                            continue
                        bracketed_axes.append(axis / axis_norm)
                has_local_two_dimensional_support = any(
                    abs(float(first_axis @ second_axis))
                    <= maximum_direction_dot + 1e-12
                    for first_index, first_axis in enumerate(bracketed_axes)
                    for second_axis in bracketed_axes[first_index + 1 :]
                )
            if has_local_two_dimensional_support:
                local_two_dimensional_count += 1
        local_two_dimensional_fraction = float(
            local_two_dimensional_count / interior_points.shape[0]
        )
        local_two_dimensional_support_sufficient = (
            local_two_dimensional_fraction + 1e-12 >= 0.50
        )
    interior_support_sufficient = (
        boundary_trace_screen_triggered
        and interior_points.shape[0] >= 8
        and coverage_fraction + 1e-12 >= 0.10
        and angular_coverage_sufficient
        and local_two_dimensional_support_sufficient
    )
    evidence.update(
        {
            "outerHullAreaSquareMeters": outer_hull_area_m2,
            "interiorPointCount": int(interior_points.shape[0]),
            "interiorSupportHullAreaSquareMeters": interior_hull_area_m2,
            "interiorGeometricCoverageFraction": coverage_fraction,
            "maximumInteriorAngularGapDegrees": math.degrees(
                maximum_angular_gap_radians
            ),
            "interiorAngularCoverageSufficient": (
                angular_coverage_sufficient
            ),
            "interiorLocallyTwoDimensionalPointCount": (
                local_two_dimensional_count
            ),
            "interiorLocallyTwoDimensionalPointFraction": (
                local_two_dimensional_fraction
            ),
            "interiorLocalTwoDimensionalSupportSufficient": (
                local_two_dimensional_support_sufficient
            ),
            "interiorSupportSufficient": interior_support_sufficient,
        }
    )
    return evidence


def _local_two_dimensional_support_scales(
    points_xy: Any,
    *,
    maximum_radius_m: float,
    metric_boundary_epsilon_m: float,
    np: Any,
) -> tuple[Any, int]:
    """Find the nearest radius that proves two non-collinear neighbour directions.

    A line or isolated trace has no 2-D scale.  The finite neighbour cap is
    intentionally fail-closed: an extremely dense 1-D run cannot search past
    arbitrarily many collinear samples to borrow a remote surface point.
    """

    points = _require_finite_matrix(points_xy, 2, "local 2-D support XY", np)
    if (
        not math.isfinite(maximum_radius_m)
        or maximum_radius_m <= 0.0
        or not math.isfinite(metric_boundary_epsilon_m)
        or metric_boundary_epsilon_m < 0.0
    ):
        fail("INVALID_LOCAL_2D_SCALE_INPUT", "local 2-D scale thresholds are invalid")
    if points.shape[0] < 3:
        return np.zeros(points.shape[0], dtype=np.float64), 0
    spatial = importlib.import_module("scipy.spatial")
    neighbour_cap = min(points.shape[0], 32)
    distances, indexes = spatial.cKDTree(points).query(
        points, k=neighbour_cap, workers=1
    )
    if neighbour_cap == 1:
        distances = distances[:, None]
        indexes = indexes[:, None]
    scales = np.zeros(points.shape[0], dtype=np.float64)
    cosine_30 = math.cos(math.radians(30.0))
    cosine_150 = math.cos(math.radians(150.0))
    for point_index in range(points.shape[0]):
        candidates: list[tuple[float, Any]] = []
        for raw_distance, raw_neighbour in zip(
            distances[point_index], indexes[point_index], strict=True
        ):
            distance = float(raw_distance)
            neighbour = int(raw_neighbour)
            if neighbour == point_index or distance <= metric_boundary_epsilon_m:
                continue
            if distance > maximum_radius_m + metric_boundary_epsilon_m:
                continue
            direction = (points[neighbour] - points[point_index]) / distance
            candidates.append((distance, direction))
        candidates.sort(key=lambda row: row[0])
        directions: list[Any] = []
        candidate_index = 0
        while candidate_index < len(candidates):
            shell_distance = candidates[candidate_index][0]
            shell_directions: list[Any] = []
            while (
                candidate_index < len(candidates)
                and abs(candidates[candidate_index][0] - shell_distance)
                <= metric_boundary_epsilon_m
            ):
                shell_directions.append(candidates[candidate_index][1])
                candidate_index += 1
            directions.extend(shell_directions)
            has_two_dimensional_pair = any(
                cosine_150 - 1e-12
                <= float(first @ second)
                <= cosine_30 + 1e-12
                for first, second in itertools.combinations(directions, 2)
            )
            if has_two_dimensional_pair:
                scales[point_index] = shell_distance
                break
    return scales, neighbour_cap


def _has_anomalous_parallel_sampling_seam(
    points_xy: Any,
    *,
    maximum_seam_width_m: float,
    maximum_neighbour_radius_m: float,
    metric_boundary_epsilon_m: float,
    np: Any,
) -> tuple[bool, dict[str, Any]]:
    """Detect a narrow paired boundary that is anomalous to both side spacings.

    Unorganized XY points cannot prove whether a narrow unsampled strip is a
    physical slit or an irregular sampling row.  This deliberately conservative
    veto looks for two parallel boundary chains whose separation is materially
    smaller than the inward sampling interval on both sides.  Uniform dense
    grids do not trigger because their cross-row and inward spacings agree.
    """

    points = _require_finite_matrix(points_xy, 2, "parallel seam XY", np)
    if (
        not math.isfinite(maximum_seam_width_m)
        or maximum_seam_width_m <= 0.0
        or not math.isfinite(maximum_neighbour_radius_m)
        or maximum_neighbour_radius_m <= maximum_seam_width_m
        or not math.isfinite(metric_boundary_epsilon_m)
        or metric_boundary_epsilon_m < 0.0
    ):
        fail("INVALID_PARALLEL_SEAM_INPUT", "parallel seam thresholds are invalid")
    if points.shape[0] < 6:
        return False, {"candidatePairCount": 0, "qualifiedPairCount": 0}
    spatial = importlib.import_module("scipy.spatial")
    tree = spatial.cKDTree(points)
    candidate_neighbour_cap = min(points.shape[0], 9)
    candidate_distances, candidate_indexes = tree.query(
        points,
        k=candidate_neighbour_cap,
        distance_upper_bound=maximum_seam_width_m + metric_boundary_epsilon_m,
        workers=1,
    )
    if candidate_neighbour_cap == 1:
        candidate_distances = candidate_distances[:, None]
        candidate_indexes = candidate_indexes[:, None]
    candidate_pair_set: set[tuple[int, int]] = set()
    for point_index in range(points.shape[0]):
        for distance, raw_neighbour in zip(
            candidate_distances[point_index],
            candidate_indexes[point_index],
            strict=True,
        ):
            neighbour = int(raw_neighbour)
            if (
                neighbour >= points.shape[0]
                or neighbour == point_index
                or not math.isfinite(float(distance))
            ):
                continue
            candidate_pair_set.add(tuple(sorted((point_index, neighbour))))
    candidate_pairs = np.asarray(
        sorted(candidate_pair_set), dtype=np.int64
    ).reshape((-1, 2))
    local_neighbour_cap = min(points.shape[0], 32)
    local_distances, local_indexes = tree.query(
        points,
        k=local_neighbour_cap,
        distance_upper_bound=maximum_neighbour_radius_m + metric_boundary_epsilon_m,
        workers=1,
    )
    if local_neighbour_cap == 1:
        local_distances = local_distances[:, None]
        local_indexes = local_indexes[:, None]
    cosine_20 = math.cos(math.radians(20.0))
    sine_25 = math.sin(math.radians(25.0))
    qualified_rows: list[dict[str, Any]] = []
    for raw_first, raw_second in candidate_pairs:
        first = int(raw_first)
        second = int(raw_second)
        delta = points[second] - points[first]
        separation_m = float(np.linalg.norm(delta))
        if separation_m <= max(
            metric_boundary_epsilon_m,
            0.10 * maximum_seam_width_m,
        ):
            continue
        normal = delta / separation_m
        tangent = np.asarray([-normal[1], normal[0]], dtype=np.float64)

        def local_evidence(index: int, inward_sign: float) -> tuple[float | None, float, int]:
            inward_distances: list[float] = []
            tangent_positions = [0.0]
            for raw_distance, raw_neighbour in zip(
                local_distances[index], local_indexes[index], strict=True
            ):
                neighbour = int(raw_neighbour)
                distance = float(raw_distance)
                if (
                    neighbour >= points.shape[0]
                    or neighbour in {index, first, second}
                    or not math.isfinite(distance)
                ):
                    continue
                displacement = points[neighbour] - points[index]
                if distance <= metric_boundary_epsilon_m:
                    continue
                unit = displacement / distance
                normal_dot = float(unit @ normal)
                if inward_sign * normal_dot >= cosine_20:
                    inward_distances.append(distance)
                if abs(normal_dot) <= sine_25:
                    tangent_positions.append(float(displacement @ tangent))
            tangent_span = max(tangent_positions) - min(tangent_positions)
            return (
                min(inward_distances) if inward_distances else None,
                tangent_span,
                len(tangent_positions) - 1,
            )

        first_inward, first_tangent_span, first_tangent_count = local_evidence(
            first, -1.0
        )
        second_inward, second_tangent_span, second_tangent_count = local_evidence(
            second, 1.0
        )
        minimum_chain_span_m = max(0.075, 3.0 * separation_m)
        if (
            first_inward is None
            or second_inward is None
            or first_tangent_count < 2
            or second_tangent_count < 2
            or first_tangent_span + metric_boundary_epsilon_m < minimum_chain_span_m
            or second_tangent_span + metric_boundary_epsilon_m < minimum_chain_span_m
            or separation_m + metric_boundary_epsilon_m
            >= 0.85 * first_inward
            or separation_m + metric_boundary_epsilon_m
            >= 0.85 * second_inward
        ):
            continue
        qualified_rows.append(
            {
                "separationMeters": separation_m,
                "firstInwardSpacingMeters": first_inward,
                "secondInwardSpacingMeters": second_inward,
                "firstTangentChainSpanMeters": first_tangent_span,
                "secondTangentChainSpanMeters": second_tangent_span,
            }
        )
    return bool(qualified_rows), {
        "candidatePairCount": int(candidate_pairs.shape[0]),
        "candidateNeighbourCap": candidate_neighbour_cap,
        "localEvidenceNeighbourCap": local_neighbour_cap,
        "qualifiedPairCount": len(qualified_rows),
        "maximumSeamWidthMeters": maximum_seam_width_m,
        "minimumSeamWidthMeters": 0.10 * maximum_seam_width_m,
        "maximumNeighbourRadiusMeters": maximum_neighbour_radius_m,
        "separationMustBeLessThanFractionOfBothInwardSpacings": 0.85,
        "minimumTangentChainNeighbourCountPerSide": 2,
        "qualifiedPairs": qualified_rows[:8],
    }


def _robust_xy_footprint_area(
    points_xy: Any,
    *,
    maximum_triangle_edge_m: float,
    minimum_triangle_quality: float,
    density_sliver_max_width_m: float,
    metric_boundary_epsilon_m: float,
    np: Any,
) -> tuple[float, dict[str, Any], Any]:
    """Measure one largest compact-triangle 2D surface component."""

    points = _require_finite_matrix(points_xy, 2, "horizontal footprint XY", np)
    if (
        not _is_finite_real(maximum_triangle_edge_m)
        or maximum_triangle_edge_m <= 0.0
        or not _is_finite_real(minimum_triangle_quality)
        or not 0.0 < minimum_triangle_quality <= 1.0
        or not _is_finite_real(density_sliver_max_width_m)
        or density_sliver_max_width_m <= 0.0
        or density_sliver_max_width_m >= maximum_triangle_edge_m
        or not _is_finite_real(metric_boundary_epsilon_m)
        or metric_boundary_epsilon_m < 0.0
    ):
        fail("INVALID_HORIZONTAL_ENVELOPE_INPUT", "robust footprint thresholds must be positive")
    # Do not prefilter around a point-count-weighted global center.  A tiny but
    # densely sampled disconnected patch can otherwise move that center and
    # erase a much larger, more sparsely sampled physical room surface.  Local
    # compact Delaunay triangles define components first; physical area, not
    # point count, selects the authoritative component below.
    retained_points, retained_input_indexes = np.unique(
        points, axis=0, return_index=True
    )
    triangulation_origin = np.min(retained_points, axis=0) + 0.5 * (
        np.max(retained_points, axis=0) - np.min(retained_points, axis=0)
    )
    triangulation_points = retained_points - triangulation_origin
    # Narrow missing strips and uneven sampling rows are identical in an
    # unordered XY point set.  They are therefore recorded as topology
    # ambiguity per provisional local component below; no remote component may
    # globally veto a separate, clear surface.
    anomalous_parallel_sampling_seam_detected = False
    parallel_sampling_seam_evidence: dict[str, Any] = {
        "scope": "provisional local Delaunay component",
        "interpretation": "narrow gap or sampling irregularity; physical slit is not claimed",
        "ambiguousComponents": [],
    }
    robust_hull_area = 0.0
    local_triangle_area = 0.0
    accepted_triangle_area_sum = 0.0
    accepted_triangle_count = 0
    total_triangle_count = 0
    connected_component_areas_m2: list[float] = []
    connected_component_accepted_triangle_areas_m2: list[float] = []
    authoritative_component_input_indices = np.empty(0, dtype=np.int64)
    points_in_any_accepted_triangle_count = 0
    authoritative_area_vertex_count = 0
    component_selection_ambiguous = False
    authoritative_component_center = np.mean(points, axis=0)
    maximum_observed_triangle_edge_m = 0.0
    rejected_for_edge_length_count = 0
    rejected_for_shape_quality_count = 0
    rejected_for_subresolution_altitude_count = 0
    rejected_for_mutual_local_scale_count = 0
    rejected_density_sliver_triangle_count = 0
    cocircular_shorter_diagonal_flip_count = 0
    cocircular_quad_shorter_diagonal_policy = False
    cocircular_local_quad_group_count = 0
    cocircular_local_quad_rejected_triangle_count = 0
    cocircular_embedded_quad_shorter_diagonal_certification_count = 0
    cocircular_input_rejected_fail_closed = False
    circular_boundary_insufficient_interior_support = False
    sampled_outer_boundary_insufficient_interior_support = False
    local_two_dimensional_scale_neighbour_cap = 0
    local_two_dimensional_scale_count = 0
    mutual_local_edge_scale_factor = 1.0
    raw_accepted_triangle_component_count = 0
    density_sliver_merged_group_count = 0
    density_sliver_single_component_repair_count = 0
    density_sliver_filled_area_m2 = 0.0
    density_transition_relaxation_factor = 2.0
    density_transition_minimum_scale_ratio = 1.5
    density_transition_certified_triangle_count = 0
    density_transition_certified_group_count = 0
    ambiguous_provisional_component_count = 0
    ambiguous_provisional_component_upper_areas_m2: list[float] = []
    ambiguous_provisional_component_could_be_authoritative = False
    broad_sampling_bridge_ratio = 1.5
    broad_sampling_bridge_ambiguous_component_count = 0
    broad_sampling_bridge_contact_excluded_vertices: set[int] = set()
    broad_sampling_bridge_diagnostics: list[dict[str, Any]] = []
    if retained_points.shape[0] >= 3:
        try:
            spatial = importlib.import_module("scipy.spatial")
            triangulation = spatial.Delaunay(triangulation_points)
            simplices = np.asarray(triangulation.simplices, dtype=np.int64)
            # Iterative cocircular edge flips are deliberately not used.  A
            # large common-circle cell is rejected above; an ordinary four-
            # point cell is small enough for Qhull's two triangles to carry the
            # same total hull area without a convergence process.
            if (
                retained_points.shape[0] == 4
                and _is_multi_point_cocircular(
                    triangulation_points,
                    minimum_point_count=4,
                    metric_boundary_epsilon_m=metric_boundary_epsilon_m,
                    np=np,
                )
            ):
                hull_vertices = np.asarray(
                    spatial.ConvexHull(triangulation_points).vertices,
                    dtype=np.int64,
                )
                if hull_vertices.size == 4:
                    first_diagonal_m = float(
                        np.linalg.norm(
                            triangulation_points[hull_vertices[0]]
                            - triangulation_points[hull_vertices[2]]
                        )
                    )
                    second_diagonal_m = float(
                        np.linalg.norm(
                            triangulation_points[hull_vertices[1]]
                            - triangulation_points[hull_vertices[3]]
                        )
                    )
                    if first_diagonal_m <= second_diagonal_m + metric_boundary_epsilon_m:
                        simplices = np.asarray(
                            [
                                [hull_vertices[0], hull_vertices[1], hull_vertices[2]],
                                [hull_vertices[0], hull_vertices[2], hull_vertices[3]],
                            ],
                            dtype=np.int64,
                        )
                    else:
                        simplices = np.asarray(
                            [
                                [hull_vertices[1], hull_vertices[2], hull_vertices[3]],
                                [hull_vertices[1], hull_vertices[3], hull_vertices[0]],
                            ],
                            dtype=np.int64,
                        )
                    cocircular_quad_shorter_diagonal_policy = True
            local_scales, local_two_dimensional_scale_neighbour_cap = (
                _local_two_dimensional_support_scales(
                    triangulation_points,
                    maximum_radius_m=maximum_triangle_edge_m,
                    metric_boundary_epsilon_m=metric_boundary_epsilon_m,
                    np=np,
                )
            )
            local_two_dimensional_scale_count = int(np.count_nonzero(local_scales > 0.0))
            total_triangle_count = int(simplices.shape[0])
            triangles = triangulation_points[simplices]
            edge_first = np.linalg.norm(triangles[:, 0] - triangles[:, 1], axis=1)
            edge_second = np.linalg.norm(triangles[:, 1] - triangles[:, 2], axis=1)
            edge_third = np.linalg.norm(triangles[:, 2] - triangles[:, 0], axis=1)

            # Form a density-agnostic provisional topology from bounded
            # Delaunay edges before applying triangle quality/local-support
            # gates.  Ambiguity is attached to this local component, so a tiny
            # remote suspect patch cannot erase an unrelated clear floor.
            provisional_parent = np.arange(
                triangulation_points.shape[0], dtype=np.int64
            )
            provisional_size = np.ones(
                triangulation_points.shape[0], dtype=np.int64
            )

            def find_provisional_root(raw_index: int) -> int:
                index = raw_index
                while int(provisional_parent[index]) != index:
                    provisional_parent[index] = provisional_parent[
                        int(provisional_parent[index])
                    ]
                    index = int(provisional_parent[index])
                return index

            def unite_provisional_vertices(first: int, second: int) -> None:
                first_root = find_provisional_root(first)
                second_root = find_provisional_root(second)
                if first_root == second_root:
                    return
                if int(provisional_size[first_root]) < int(
                    provisional_size[second_root]
                ):
                    first_root, second_root = second_root, first_root
                provisional_parent[second_root] = first_root
                provisional_size[first_root] += provisional_size[second_root]

            for simplex, first_length, second_length, third_length in zip(
                simplices,
                edge_first,
                edge_second,
                edge_third,
                strict=True,
            ):
                for first_vertex, second_vertex, edge_length in (
                    (int(simplex[0]), int(simplex[1]), float(first_length)),
                    (int(simplex[1]), int(simplex[2]), float(second_length)),
                    (int(simplex[2]), int(simplex[0]), float(third_length)),
                ):
                    if (
                        edge_length
                        <= maximum_triangle_edge_m
                        + metric_boundary_epsilon_m
                    ):
                        unite_provisional_vertices(first_vertex, second_vertex)
            provisional_component_vertices: dict[int, list[int]] = {}
            for vertex_index in range(triangulation_points.shape[0]):
                provisional_component_vertices.setdefault(
                    find_provisional_root(vertex_index), []
                ).append(vertex_index)
            provisional_root_by_vertex = np.asarray(
                [
                    find_provisional_root(vertex_index)
                    for vertex_index in range(triangulation_points.shape[0])
                ],
                dtype=np.int64,
            )
            nearest_neighbour_distances, _nearest_neighbour_indexes = (
                spatial.cKDTree(triangulation_points).query(
                    triangulation_points, k=2, workers=1
                )
            )
            nearest_neighbour_distance_m = np.asarray(
                nearest_neighbour_distances[:, 1], dtype=np.float64
            )
            ambiguous_provisional_roots: set[int] = set()
            ambiguous_upper_area_by_root: dict[int, float] = {}
            for provisional_root, raw_vertex_indexes in sorted(
                provisional_component_vertices.items(),
                key=lambda row: min(row[1]),
            ):
                vertex_indexes = np.asarray(raw_vertex_indexes, dtype=np.int64)
                component_points = triangulation_points[vertex_indexes]
                seam_ambiguous, seam_evidence = (
                    _has_anomalous_parallel_sampling_seam(
                        component_points,
                        maximum_seam_width_m=3.0
                        * density_sliver_max_width_m,
                        maximum_neighbour_radius_m=maximum_triangle_edge_m,
                        metric_boundary_epsilon_m=metric_boundary_epsilon_m,
                        np=np,
                    )
                )
                circular_support_evidence = (
                    _circular_boundary_interior_support_evidence(
                    component_points,
                    metric_boundary_epsilon_m=metric_boundary_epsilon_m,
                    np=np,
                    )
                )
                hull_vertex_count = int(
                    circular_support_evidence["convexHullVertexCount"]
                )
                circular_boundary = bool(
                    circular_support_evidence[
                        "approximatelyCircularBoundary"
                    ]
                    and hull_vertex_count >= 8
                )
                sampled_outer_boundary = bool(
                    circular_support_evidence[
                        "boundaryTraceScreenTriggered"
                    ]
                )
                # A coarse 3x3 or 3x4 scanner grid legitimately has eight or
                # more samples on its convex boundary and only one or two
                # strictly inside it, so the eight-interior-sample gate cannot
                # be imposed on every small polygonal patch.  Once a
                # non-circular trace has at least eight interior rows, however,
                # those rows must prove local 2-D fill too: otherwise nested
                # outlines or concave outline edges can masquerade as a room
                # surface.  Circular traces retain the stronger rule at every
                # interior count because even a few center points can fill an
                # otherwise empty disk in Delaunay triangulation.
                strict_interior_point_count = int(
                    circular_support_evidence["strictInteriorPointCount"]
                )
                outer_boundary_support_insufficient = bool(
                    sampled_outer_boundary
                    and (
                        not bool(
                            circular_support_evidence[
                                "interiorSupportSufficient"
                            ]
                        )
                        if circular_boundary
                        else (
                            strict_interior_point_count == 0
                            or (
                                strict_interior_point_count >= 8
                                and not bool(
                                    circular_support_evidence[
                                        "interiorSupportSufficient"
                                    ]
                                )
                            )
                        )
                    )
                )
                distributed_outer_boundary_interior_support = (
                    sampled_outer_boundary
                    and bool(
                        circular_support_evidence[
                            "interiorSupportSufficient"
                        ]
                    )
                )
                seam_ambiguity_overridden_by_circular_fill = (
                    seam_ambiguous
                    and circular_boundary
                    and distributed_outer_boundary_interior_support
                )
                effective_seam_ambiguity = (
                    seam_ambiguous
                    and not seam_ambiguity_overridden_by_circular_fill
                )
                all_points_cocircular = (
                    circular_boundary
                    and outer_boundary_support_insufficient
                    and int(
                        strict_interior_point_count
                    )
                    == 0
                )
                cocircular_input_rejected_fail_closed = (
                    cocircular_input_rejected_fail_closed
                    or all_points_cocircular
                )
                circular_boundary_insufficient_interior_support = (
                    circular_boundary_insufficient_interior_support
                    or (
                        circular_boundary
                        and outer_boundary_support_insufficient
                    )
                )
                sampled_outer_boundary_insufficient_interior_support = (
                    sampled_outer_boundary_insufficient_interior_support
                    or outer_boundary_support_insufficient
                )
                anomalous_parallel_sampling_seam_detected = (
                    anomalous_parallel_sampling_seam_detected
                    or effective_seam_ambiguity
                )
                reasons = []
                if effective_seam_ambiguity:
                    reasons.append(
                        "narrow gap or sampling irregularity is topologically ambiguous"
                    )
                if all_points_cocircular:
                    reasons.append(
                        "all points lie on one approximately circular boundary trace"
                    )
                elif outer_boundary_support_insufficient:
                    reasons.append(
                        "well-sampled outer boundary trace lacks distributed strict-interior support"
                    )
                if reasons:
                    ambiguous_provisional_roots.add(provisional_root)
                    upper_area_m2 = _convex_hull_area_xy(
                        component_points, np=np
                    )
                    ambiguous_upper_area_by_root[provisional_root] = (
                        upper_area_m2
                    )
                    parallel_sampling_seam_evidence[
                        "ambiguousComponents"
                    ].append(
                        {
                            "provisionalComponentMinimumVertexIndex": int(
                                np.min(vertex_indexes)
                            ),
                            "pointCount": int(vertex_indexes.size),
                            "convexHullUpperBoundAreaSquareMeters": (
                                upper_area_m2
                            ),
                            "reasons": reasons,
                            "allPointsCocircular": all_points_cocircular,
                            "circularHullVertexCount": hull_vertex_count,
                            "circularBoundary": circular_boundary,
                            "circularBoundaryInteriorSupportEvidence": (
                                circular_support_evidence
                            ),
                            "narrowGapOrSamplingIrregularity": (
                                effective_seam_ambiguity
                            ),
                            "rawNarrowGapDetectorTriggered": seam_ambiguous,
                            "narrowGapDetectorOverriddenByDistributedCircularInteriorSupport": (
                                seam_ambiguity_overridden_by_circular_fill
                            ),
                            "gapEvidence": seam_evidence,
                        }
                    )
            ambiguous_provisional_component_count = len(
                ambiguous_provisional_roots
            )
            ambiguous_provisional_component_upper_areas_m2 = sorted(
                ambiguous_upper_area_by_root.values(), reverse=True
            )
            twice_areas = np.abs(
                (triangles[:, 1, 0] - triangles[:, 0, 0])
                * (triangles[:, 2, 1] - triangles[:, 0, 1])
                - (triangles[:, 1, 1] - triangles[:, 0, 1])
                * (triangles[:, 2, 0] - triangles[:, 0, 0])
            )
            edge_square_sum = (
                edge_first * edge_first
                + edge_second * edge_second
                + edge_third * edge_third
            )
            triangle_quality = np.divide(
                2.0 * math.sqrt(3.0) * twice_areas,
                edge_square_sum,
                out=np.zeros_like(twice_areas),
                where=edge_square_sum > 1e-24,
            )
            maximum_triangle_edges = np.maximum(
                np.maximum(edge_first, edge_second), edge_third
            )
            minimum_triangle_altitudes = np.divide(
                twice_areas,
                maximum_triangle_edges,
                out=np.zeros_like(twice_areas),
                where=maximum_triangle_edges > 1e-24,
            )
            maximum_observed_triangle_edge_m = float(
                np.max(maximum_triangle_edges)
            )
            edge_length_accepted = (
                maximum_triangle_edges
                <= maximum_triangle_edge_m + metric_boundary_epsilon_m
            )
            shape_quality_accepted = (
                triangle_quality + 1e-12 >= minimum_triangle_quality
            )
            minimum_vertex_local_scale = np.minimum(
                np.minimum(
                    local_scales[simplices[:, 0]],
                    local_scales[simplices[:, 1]],
                ),
                local_scales[simplices[:, 2]],
            )
            minimum_altitude_fraction_of_local_scale = 0.20
            altitude_accepted = (
                minimum_triangle_altitudes + metric_boundary_epsilon_m
                >= minimum_altitude_fraction_of_local_scale
                * minimum_vertex_local_scale
            )
            first_local_limit = mutual_local_edge_scale_factor * (
                local_scales[simplices[:, 0]]
                + local_scales[simplices[:, 1]]
            )
            second_local_limit = mutual_local_edge_scale_factor * (
                local_scales[simplices[:, 1]]
                + local_scales[simplices[:, 2]]
            )
            third_local_limit = mutual_local_edge_scale_factor * (
                local_scales[simplices[:, 2]]
                + local_scales[simplices[:, 0]]
            )
            local_scale_accepted = (
                (first_local_limit > 0.0)
                & (second_local_limit > 0.0)
                & (third_local_limit > 0.0)
                & (
                    edge_first
                    <= first_local_limit + metric_boundary_epsilon_m
                )
                & (
                    edge_second
                    <= second_local_limit + metric_boundary_epsilon_m
                )
                & (
                    edge_third
                    <= third_local_limit + metric_boundary_epsilon_m
                )
            )
            accepted = (
                edge_length_accepted
                & shape_quality_accepted
                & altitude_accepted
                & local_scale_accepted
            )
            if cocircular_quad_shorter_diagonal_policy:
                # For an isolated four-vertex cell the chosen shorter diagonal
                # is an internal bookkeeping edge, not an observed surface
                # gap.  Its four boundary edges already define the cell.
                accepted = (
                    edge_length_accepted
                    & shape_quality_accepted
                    & altitude_accepted
                )
            if retained_points.shape[0] > 4 and simplices.shape[0] > 1:
                base_accepted = accepted.copy()
                cocircular_rejected = np.zeros(simplices.shape[0], dtype=bool)
                cocircular_certified = np.zeros(simplices.shape[0], dtype=bool)
                triangle_by_edge: dict[tuple[int, int], list[int]] = {}
                for triangle_index, simplex in enumerate(simplices):
                    for first_vertex, second_vertex in (
                        (int(simplex[0]), int(simplex[1])),
                        (int(simplex[1]), int(simplex[2])),
                        (int(simplex[2]), int(simplex[0])),
                    ):
                        triangle_by_edge.setdefault(
                            tuple(sorted((first_vertex, second_vertex))), []
                        ).append(triangle_index)

                def cross(first: Any, second: Any) -> float:
                    return float(first[0] * second[1] - first[1] * second[0])

                def angle_at(vertex: Any, first: Any, second: Any) -> float:
                    first_vector = first - vertex
                    second_vector = second - vertex
                    return math.atan2(
                        abs(cross(first_vector, second_vector)),
                        float(first_vector @ second_vector),
                    )

                def triangle_shape_passes(vertices: tuple[int, int, int]) -> bool:
                    first_point, second_point, third_point = (
                        triangulation_points[index] for index in vertices
                    )
                    first_edge = float(np.linalg.norm(first_point - second_point))
                    second_edge = float(np.linalg.norm(second_point - third_point))
                    third_edge = float(np.linalg.norm(third_point - first_point))
                    maximum_edge = max(first_edge, second_edge, third_edge)
                    twice_area = abs(
                        cross(second_point - first_point, third_point - first_point)
                    )
                    quality_denominator = (
                        first_edge * first_edge
                        + second_edge * second_edge
                        + third_edge * third_edge
                    )
                    quality = (
                        2.0 * math.sqrt(3.0) * twice_area / quality_denominator
                        if quality_denominator > 1e-24
                        else 0.0
                    )
                    altitude = twice_area / maximum_edge if maximum_edge > 1e-24 else 0.0
                    minimum_scale = min(float(local_scales[index]) for index in vertices)
                    edges_are_locally_supported = (
                        first_edge
                        <= mutual_local_edge_scale_factor
                        * (
                            float(local_scales[vertices[0]])
                            + float(local_scales[vertices[1]])
                        )
                        + metric_boundary_epsilon_m
                        and second_edge
                        <= mutual_local_edge_scale_factor
                        * (
                            float(local_scales[vertices[1]])
                            + float(local_scales[vertices[2]])
                        )
                        + metric_boundary_epsilon_m
                        and third_edge
                        <= mutual_local_edge_scale_factor
                        * (
                            float(local_scales[vertices[2]])
                            + float(local_scales[vertices[0]])
                        )
                        + metric_boundary_epsilon_m
                    )
                    return (
                        maximum_edge
                        <= maximum_triangle_edge_m + metric_boundary_epsilon_m
                        and quality + 1e-12 >= minimum_triangle_quality
                        and altitude + metric_boundary_epsilon_m
                        >= minimum_altitude_fraction_of_local_scale * minimum_scale
                        and minimum_scale > 0.0
                        and edges_are_locally_supported
                    )

                for (first_vertex, second_vertex), triangle_indexes in sorted(
                    triangle_by_edge.items()
                ):
                    if len(triangle_indexes) != 2:
                        continue
                    first_triangle_index, second_triangle_index = triangle_indexes
                    first_opposite = next(
                        int(value)
                        for value in simplices[first_triangle_index]
                        if int(value) not in {first_vertex, second_vertex}
                    )
                    second_opposite = next(
                        int(value)
                        for value in simplices[second_triangle_index]
                        if int(value) not in {first_vertex, second_vertex}
                    )
                    first_point = triangulation_points[first_vertex]
                    second_point = triangulation_points[second_vertex]
                    first_opposite_point = triangulation_points[first_opposite]
                    second_opposite_point = triangulation_points[second_opposite]
                    opposite_angle_sum = angle_at(
                        first_opposite_point, first_point, second_point
                    ) + angle_at(second_opposite_point, first_point, second_point)
                    if abs(opposite_angle_sum - math.pi) > 1e-10:
                        continue
                    cocircular_local_quad_group_count += 1
                    boundary_edges = (
                        (first_vertex, first_opposite),
                        (first_opposite, second_vertex),
                        (second_vertex, second_opposite),
                        (second_opposite, first_vertex),
                    )
                    boundary_edges_are_mutually_local = all(
                        float(
                            np.linalg.norm(
                                triangulation_points[first_boundary_vertex]
                                - triangulation_points[second_boundary_vertex]
                            )
                        )
                        <= mutual_local_edge_scale_factor
                        * (
                            float(local_scales[first_boundary_vertex])
                            + float(local_scales[second_boundary_vertex])
                        )
                        + metric_boundary_epsilon_m
                        for first_boundary_vertex, second_boundary_vertex in boundary_edges
                    )
                    current_diagonal_shapes_pass = triangle_shape_passes(
                        (first_vertex, second_vertex, first_opposite)
                    ) and triangle_shape_passes(
                        (first_vertex, second_vertex, second_opposite)
                    )
                    alternate_diagonal_shapes_pass = triangle_shape_passes(
                        (first_opposite, second_opposite, first_vertex)
                    ) and triangle_shape_passes(
                        (first_opposite, second_opposite, second_vertex)
                    )
                    all_four_shapes_pass = (
                        current_diagonal_shapes_pass
                        and alternate_diagonal_shapes_pass
                    )
                    quad_is_embedded_in_more_certified_cells = any(
                        any(
                            external_triangle_index
                            not in {first_triangle_index, second_triangle_index}
                            and bool(base_accepted[external_triangle_index])
                            for external_triangle_index in triangle_by_edge.get(
                                tuple(
                                    sorted(
                                        (
                                            first_boundary_vertex,
                                            second_boundary_vertex,
                                        )
                                    )
                                ),
                                [],
                            )
                        )
                        for first_boundary_vertex, second_boundary_vertex in boundary_edges
                    )
                    embedded_one_diagonal_certified = (
                        quad_is_embedded_in_more_certified_cells
                        and (
                            current_diagonal_shapes_pass
                            or alternate_diagonal_shapes_pass
                        )
                    )
                    if boundary_edges_are_mutually_local and (
                        all_four_shapes_pass or embedded_one_diagonal_certified
                    ):
                        cocircular_certified[first_triangle_index] = True
                        cocircular_certified[second_triangle_index] = True
                        if embedded_one_diagonal_certified and not all_four_shapes_pass:
                            cocircular_embedded_quad_shorter_diagonal_certification_count += 1
                    else:
                        cocircular_rejected[first_triangle_index] = True
                        cocircular_rejected[second_triangle_index] = True
                accepted = (base_accepted | cocircular_certified) & ~cocircular_rejected
                cocircular_local_quad_rejected_triangle_count = int(
                    np.count_nonzero(cocircular_rejected)
                )
            strict_accepted = accepted.copy()
            relaxed_first_local_limit = density_transition_relaxation_factor * np.maximum(
                local_scales[simplices[:, 0]],
                local_scales[simplices[:, 1]],
            )
            relaxed_second_local_limit = density_transition_relaxation_factor * np.maximum(
                local_scales[simplices[:, 1]],
                local_scales[simplices[:, 2]],
            )
            relaxed_third_local_limit = density_transition_relaxation_factor * np.maximum(
                local_scales[simplices[:, 2]],
                local_scales[simplices[:, 0]],
            )
            relaxed_local_scale_accepted = (
                (minimum_vertex_local_scale > 0.0)
                & (edge_first <= relaxed_first_local_limit + metric_boundary_epsilon_m)
                & (edge_second <= relaxed_second_local_limit + metric_boundary_epsilon_m)
                & (edge_third <= relaxed_third_local_limit + metric_boundary_epsilon_m)
            )
            triangle_local_scale_ratio = np.divide(
                np.max(local_scales[simplices], axis=1),
                np.maximum(np.min(local_scales[simplices], axis=1), 1e-15),
            )
            transition_candidates = (
                (~strict_accepted)
                & edge_length_accepted
                & shape_quality_accepted
                & altitude_accepted
                & relaxed_local_scale_accepted
                & (
                    triangle_local_scale_ratio + 1e-12
                    >= density_transition_minimum_scale_ratio
                )
            )
            strict_triangle_indexes = np.flatnonzero(strict_accepted)
            strict_component_by_triangle: dict[int, int] = {}
            strict_components_by_vertex: dict[int, set[int]] = {}
            if strict_triangle_indexes.size:
                strict_parent = {
                    int(index): int(index) for index in strict_triangle_indexes
                }

                def find_strict_triangle_root(index: int) -> int:
                    while strict_parent[index] != index:
                        strict_parent[index] = strict_parent[strict_parent[index]]
                        index = strict_parent[index]
                    return index

                strict_triangle_by_edge: dict[tuple[int, int], int] = {}
                for raw_triangle_index in strict_triangle_indexes:
                    triangle_index = int(raw_triangle_index)
                    for first_vertex, second_vertex in (
                        (int(simplices[triangle_index, 0]), int(simplices[triangle_index, 1])),
                        (int(simplices[triangle_index, 1]), int(simplices[triangle_index, 2])),
                        (int(simplices[triangle_index, 2]), int(simplices[triangle_index, 0])),
                    ):
                        edge = tuple(sorted((first_vertex, second_vertex)))
                        previous = strict_triangle_by_edge.get(edge)
                        if previous is None:
                            strict_triangle_by_edge[edge] = triangle_index
                            continue
                        first_root = find_strict_triangle_root(triangle_index)
                        second_root = find_strict_triangle_root(previous)
                        if first_root != second_root:
                            strict_parent[second_root] = first_root
                for raw_triangle_index in strict_triangle_indexes:
                    triangle_index = int(raw_triangle_index)
                    root = find_strict_triangle_root(triangle_index)
                    strict_component_by_triangle[triangle_index] = root
                    for vertex in simplices[triangle_index]:
                        strict_components_by_vertex.setdefault(
                            int(vertex), set()
                        ).add(root)
            eligible_transition_indexes: list[int] = []
            for raw_triangle_index in np.flatnonzero(transition_candidates):
                triangle_index = int(raw_triangle_index)
                provisional_root = int(
                    provisional_root_by_vertex[int(simplices[triangle_index, 0])]
                )
                if provisional_root in ambiguous_provisional_roots:
                    continue
                memberships = [
                    strict_components_by_vertex.get(int(vertex), set())
                    for vertex in simplices[triangle_index]
                ]
                if any(not rows for rows in memberships):
                    continue
                if len(set().union(*memberships)) < 2:
                    continue
                eligible_transition_indexes.append(triangle_index)
            transition_parent = {
                index: index for index in eligible_transition_indexes
            }

            def find_transition_root(index: int) -> int:
                while transition_parent[index] != index:
                    transition_parent[index] = transition_parent[
                        transition_parent[index]
                    ]
                    index = transition_parent[index]
                return index

            transition_by_edge: dict[tuple[int, int], int] = {}
            for triangle_index in eligible_transition_indexes:
                for first_vertex, second_vertex in (
                    (int(simplices[triangle_index, 0]), int(simplices[triangle_index, 1])),
                    (int(simplices[triangle_index, 1]), int(simplices[triangle_index, 2])),
                    (int(simplices[triangle_index, 2]), int(simplices[triangle_index, 0])),
                ):
                    edge = tuple(sorted((first_vertex, second_vertex)))
                    previous = transition_by_edge.get(edge)
                    if previous is None:
                        transition_by_edge[edge] = triangle_index
                        continue
                    first_root = find_transition_root(triangle_index)
                    second_root = find_transition_root(previous)
                    if first_root != second_root:
                        transition_parent[second_root] = first_root
            transition_groups: dict[int, list[int]] = {}
            for triangle_index in eligible_transition_indexes:
                transition_groups.setdefault(
                    find_transition_root(triangle_index), []
                ).append(triangle_index)
            certified_transition = np.zeros(simplices.shape[0], dtype=bool)
            for triangle_indexes in transition_groups.values():
                if len(triangle_indexes) < 2:
                    continue
                bridged_strict_components: set[int] = set()
                for triangle_index in triangle_indexes:
                    for vertex in simplices[triangle_index]:
                        bridged_strict_components.update(
                            strict_components_by_vertex.get(int(vertex), set())
                        )
                if len(bridged_strict_components) < 2:
                    continue
                certified_transition[triangle_indexes] = True
                density_transition_certified_group_count += 1
            density_transition_certified_triangle_count = int(
                np.count_nonzero(certified_transition)
            )
            accepted = strict_accepted | certified_transition
            first_edge_is_broad_sampling_bridge = edge_first > (
                broad_sampling_bridge_ratio
                * np.maximum(
                    nearest_neighbour_distance_m[simplices[:, 0]],
                    nearest_neighbour_distance_m[simplices[:, 1]],
                )
                + metric_boundary_epsilon_m
            )
            second_edge_is_broad_sampling_bridge = edge_second > (
                broad_sampling_bridge_ratio
                * np.maximum(
                    nearest_neighbour_distance_m[simplices[:, 1]],
                    nearest_neighbour_distance_m[simplices[:, 2]],
                )
                + metric_boundary_epsilon_m
            )
            third_edge_is_broad_sampling_bridge = edge_third > (
                broad_sampling_bridge_ratio
                * np.maximum(
                    nearest_neighbour_distance_m[simplices[:, 2]],
                    nearest_neighbour_distance_m[simplices[:, 0]],
                )
                + metric_boundary_epsilon_m
            )
            triangle_has_broad_sampling_bridge = (
                first_edge_is_broad_sampling_bridge
                | second_edge_is_broad_sampling_bridge
                | third_edge_is_broad_sampling_bridge
            )
            accepted_without_broad_sampling_bridge = accepted & (
                ~triangle_has_broad_sampling_bridge
            )
            two_dimensional_core_vertices = set(
                int(value)
                for value in simplices[
                    accepted_without_broad_sampling_bridge
                ].reshape(-1)
            )
            accepted_core_to_noncore_bridge = np.zeros(
                simplices.shape[0], dtype=bool
            )
            for triangle_index, simplex in enumerate(simplices):
                if not (
                    bool(accepted[triangle_index])
                    and bool(triangle_has_broad_sampling_bridge[triangle_index])
                ):
                    continue
                core_membership = [
                    int(vertex) in two_dimensional_core_vertices
                    for vertex in simplex
                ]
                accepted_core_to_noncore_bridge[triangle_index] = any(
                    core_membership
                ) and not all(core_membership)
            broad_sampling_bridge_roots = {
                int(provisional_root_by_vertex[int(simplex[0])])
                for simplex in simplices[accepted_core_to_noncore_bridge]
            }
            broad_sampling_bridge_ambiguous_component_count = 0
            for provisional_root in broad_sampling_bridge_roots:
                vertex_indexes = np.asarray(
                    provisional_component_vertices[provisional_root],
                    dtype=np.int64,
                )
                root_vertex_set = {int(value) for value in vertex_indexes}
                root_core_vertices = np.asarray(
                    sorted(root_vertex_set & two_dimensional_core_vertices),
                    dtype=np.int64,
                )
                root_bridge_triangles = simplices[
                    accepted_core_to_noncore_bridge
                    & np.asarray(
                        [
                            int(provisional_root_by_vertex[int(simplex[0])])
                            == provisional_root
                            for simplex in simplices
                        ],
                        dtype=bool,
                    )
                ]
                root_bridged_noncore_vertices = np.asarray(
                    sorted(
                        {
                            int(value)
                            for value in root_bridge_triangles.reshape(-1)
                            if int(value) not in two_dimensional_core_vertices
                        }
                    ),
                    dtype=np.int64,
                )
                root_core_hull_area_m2 = _convex_hull_area_xy(
                    triangulation_points[root_core_vertices], np=np
                )
                minimum_vertex_index = int(np.min(vertex_indexes))
                component_upper_area_m2 = _convex_hull_area_xy(
                    triangulation_points[vertex_indexes], np=np
                )
                broad_sampling_bridge_contact_excluded_vertices.update(
                    int(value) for value in root_bridged_noncore_vertices
                )
                broad_sampling_bridge_diagnostics.append(
                    {
                        "provisionalComponentMinimumVertexIndex": minimum_vertex_index,
                        "pointCount": int(vertex_indexes.size),
                        "convexHullUpperBoundAreaSquareMeters": component_upper_area_m2,
                        "twoDimensionalCoreVertexCount": int(
                            root_core_vertices.size
                        ),
                        "bridgedNoncoreVertexCount": int(
                            root_bridged_noncore_vertices.size
                        ),
                        "twoDimensionalCoreConvexHullAreaSquareMeters": (
                            root_core_hull_area_m2
                        ),
                        "broadBridgeConvexHullExpansionSquareMeters": max(
                            0.0,
                            component_upper_area_m2 - root_core_hull_area_m2,
                        ),
                        "broadSamplingBridgeNearestNeighbourRatio": (
                            broad_sampling_bridge_ratio
                        ),
                        "effect": "non-core bridge vertices are excluded from wall contact but certified triangle area is retained",
                    }
                )
            ambiguous_provisional_component_count = len(
                ambiguous_provisional_roots
            )
            ambiguous_provisional_component_upper_areas_m2 = sorted(
                ambiguous_upper_area_by_root.values(), reverse=True
            )
            rejected_for_edge_length_count = int(
                np.count_nonzero(~edge_length_accepted)
            )
            rejected_for_shape_quality_count = int(
                np.count_nonzero(edge_length_accepted & ~shape_quality_accepted)
            )
            rejected_for_subresolution_altitude_count = int(
                np.count_nonzero(
                    edge_length_accepted
                    & shape_quality_accepted
                    & ~altitude_accepted
                )
            )
            rejected_for_mutual_local_scale_count = int(
                np.count_nonzero(
                    edge_length_accepted
                    & shape_quality_accepted
                    & altitude_accepted
                    & ~local_scale_accepted
                    & ~certified_transition
                )
            )
            minimum_triangle_edges = np.minimum(
                np.minimum(edge_first, edge_second), edge_third
            )
            density_sliver_rejected = (
                edge_length_accepted
                & local_scale_accepted
                & (~shape_quality_accepted | ~altitude_accepted)
                & (
                    minimum_triangle_edges
                    <= density_sliver_max_width_m
                    + metric_boundary_epsilon_m
                )
            )
            rejected_density_sliver_triangle_count = int(
                np.count_nonzero(density_sliver_rejected)
            )
            rejected_density_sliver_simplices = simplices[
                density_sliver_rejected
            ]
            accepted_triangle_count = int(np.count_nonzero(accepted))
            accepted_twice_areas = twice_areas[accepted]
            if accepted_twice_areas.size:
                accepted_triangle_area_sum = math.fsum(
                    0.5 * float(value) for value in accepted_twice_areas
                )
                accepted_simplices = simplices[accepted]
                parent = list(range(accepted_simplices.shape[0]))

                def find_root(index: int) -> int:
                    while parent[index] != index:
                        parent[index] = parent[parent[index]]
                        index = parent[index]
                    return index

                def unite(first: int, second: int) -> None:
                    first_root = find_root(first)
                    second_root = find_root(second)
                    if first_root != second_root:
                        parent[second_root] = first_root

                triangle_by_edge: dict[tuple[int, int], int] = {}
                for triangle_index, simplex in enumerate(accepted_simplices):
                    for first_vertex, second_vertex in (
                        (int(simplex[0]), int(simplex[1])),
                        (int(simplex[1]), int(simplex[2])),
                        (int(simplex[2]), int(simplex[0])),
                    ):
                        edge = tuple(sorted((first_vertex, second_vertex)))
                        previous_triangle = triangle_by_edge.get(edge)
                        if previous_triangle is None:
                            triangle_by_edge[edge] = triangle_index
                        else:
                            unite(triangle_index, previous_triangle)
                component_triangle_indexes: dict[int, list[int]] = {}
                for triangle_index in range(accepted_simplices.shape[0]):
                    component_triangle_indexes.setdefault(
                        find_root(triangle_index), []
                    ).append(triangle_index)
                points_in_any_accepted_triangle_count = int(
                    np.unique(accepted_simplices.reshape(-1)).size
                )
                component_rows: list[tuple[float, float, Any, Any, Any]] = []
                raw_component_count_before_ambiguity_filter = 0
                for triangle_indexes in component_triangle_indexes.values():
                    triangle_index_array = np.asarray(
                        triangle_indexes, dtype=np.int64
                    )
                    component_triangle_areas_m2 = (
                        0.5 * accepted_twice_areas[triangle_index_array]
                    )
                    component_area_m2 = math.fsum(
                        float(value) for value in component_triangle_areas_m2
                    )
                    retained_vertex_indexes = np.unique(
                        accepted_simplices[
                            triangle_index_array
                        ].reshape(-1)
                    )
                    provisional_roots = np.unique(
                        provisional_root_by_vertex[retained_vertex_indexes]
                    )
                    if provisional_roots.size != 1:
                        fail(
                            "INTERNAL_FOOTPRINT_COMPONENT_ERROR",
                            "one accepted triangle component crossed provisional topology components",
                        )
                    raw_component_count_before_ambiguity_filter += 1
                    if int(provisional_roots[0]) in ambiguous_provisional_roots:
                        continue
                    contact_vertex_indexes = np.asarray(
                        [
                            int(value)
                            for value in retained_vertex_indexes
                            if int(value)
                            not in broad_sampling_bridge_contact_excluded_vertices
                        ],
                        dtype=np.int64,
                    )
                    component_triangle_centroids = np.mean(
                        triangulation_points[
                            accepted_simplices[triangle_index_array]
                        ],
                        axis=1,
                    )
                    component_area_centroid = np.sum(
                        component_triangle_centroids
                        * component_triangle_areas_m2[:, None],
                        axis=0,
                    ) / float(component_area_m2)
                    component_rows.append(
                        (
                            component_area_m2,
                            component_area_m2,
                            retained_vertex_indexes,
                            contact_vertex_indexes,
                            component_area_centroid,
                        )
                    )
                raw_accepted_triangle_component_count = (
                    raw_component_count_before_ambiguity_filter
                )
                maximum_density_sliver_area_m2 = (
                    0.5
                    * maximum_triangle_edge_m
                    * density_sliver_max_width_m
                )
                if rejected_density_sliver_triangle_count:
                    repaired_rows: list[
                        tuple[float, float, Any, Any, Any]
                    ] = []
                    vertex_component_memberships: dict[int, set[int]] = {}
                    for component_index, row in enumerate(component_rows):
                        for vertex_index in row[2]:
                            vertex_component_memberships.setdefault(
                                int(vertex_index), set()
                            ).add(component_index)
                    for component_index, (
                        selection_area_m2,
                        triangle_area_m2,
                        vertex_indexes,
                        contact_vertex_indexes,
                        area_centroid,
                    ) in enumerate(component_rows):
                        repair_vertex_indexes = vertex_indexes
                        for rejected_simplex in rejected_density_sliver_simplices:
                            if (
                                np.intersect1d(
                                    vertex_indexes,
                                    rejected_simplex,
                                    assume_unique=True,
                                ).size
                                >= 2
                                and not any(
                                    any(
                                        membership != component_index
                                        for membership in vertex_component_memberships.get(
                                            int(vertex_index), set()
                                        )
                                    )
                                    for vertex_index in rejected_simplex
                                )
                            ):
                                repair_vertex_indexes = np.union1d(
                                    repair_vertex_indexes,
                                    rejected_simplex,
                                )
                        component_hull_area_m2 = _convex_hull_area_xy(
                            triangulation_points[repair_vertex_indexes], np=np
                        )
                        component_gap_area_m2 = max(
                            0.0,
                            component_hull_area_m2 - triangle_area_m2,
                        )
                        if (
                            component_gap_area_m2
                            <= maximum_density_sliver_area_m2
                            + maximum_triangle_edge_m
                            * metric_boundary_epsilon_m
                        ):
                            repaired_selection_area_m2 = max(
                                selection_area_m2,
                                component_hull_area_m2,
                            )
                            if (
                                repaired_selection_area_m2
                                > selection_area_m2 + 1e-15
                            ):
                                density_sliver_single_component_repair_count += 1
                            repaired_rows.append(
                                (
                                    repaired_selection_area_m2,
                                    triangle_area_m2,
                                    vertex_indexes,
                                    contact_vertex_indexes,
                                    area_centroid,
                                )
                            )
                        else:
                            repaired_rows.append(
                                (
                                    selection_area_m2,
                                    triangle_area_m2,
                                    vertex_indexes,
                                    contact_vertex_indexes,
                                    area_centroid,
                                )
                            )
                    component_rows = repaired_rows

                # A redundant point very near an existing sample can replace
                # one healthy Delaunay edge with rejected skinny slivers and
                # split one physical surface into two artificial components.
                # Rejoin only nearby component groups whose complete convex-
                # hull gap is physically tiny.  The gap area is restored so a
                # redundant sample cannot break an equal-area ambiguity.  A
                # long 1-D trace fails the complete-group hull-gap test and is
                # therefore not imported as room area or wall contact.
                component_parent = list(range(len(component_rows)))

                def find_component_root(index: int) -> int:
                    while component_parent[index] != index:
                        component_parent[index] = component_parent[
                            component_parent[index]
                        ]
                        index = component_parent[index]
                    return index

                def unite_components(first: int, second: int) -> None:
                    first_root = find_component_root(first)
                    second_root = find_component_root(second)
                    if first_root != second_root:
                        component_parent[second_root] = first_root

                for first_index, second_index in itertools.combinations(
                    range(len(component_rows)), 2
                ):
                    first_vertices = component_rows[first_index][2]
                    second_vertices = component_rows[second_index][2]
                    if not np.intersect1d(
                        first_vertices,
                        second_vertices,
                        assume_unique=True,
                    ).size:
                        continue
                    combined_vertices = np.unique(
                        np.concatenate((first_vertices, second_vertices))
                    )
                    combined_hull_area_m2 = _convex_hull_area_xy(
                        triangulation_points[combined_vertices], np=np
                    )
                    pair_triangle_area_m2 = float(
                        component_rows[first_index][1]
                        + component_rows[second_index][1]
                    )
                    pair_gap_area_m2 = max(
                        0.0,
                        combined_hull_area_m2 - pair_triangle_area_m2,
                    )
                    if (
                        pair_gap_area_m2
                        <= maximum_density_sliver_area_m2
                        + maximum_triangle_edge_m
                        * metric_boundary_epsilon_m
                    ):
                        unite_components(first_index, second_index)

                component_groups: dict[int, list[int]] = {}
                for component_index in range(len(component_rows)):
                    component_groups.setdefault(
                        find_component_root(component_index), []
                    ).append(component_index)
                stabilized_component_rows: list[
                    tuple[float, float, Any, Any, Any]
                ] = []
                for group_indexes in component_groups.values():
                    if len(group_indexes) == 1:
                        stabilized_component_rows.append(
                            component_rows[group_indexes[0]]
                        )
                        continue
                    group_vertices = np.unique(
                        np.concatenate(
                            [component_rows[index][2] for index in group_indexes]
                        )
                    )
                    group_contact_vertices = np.unique(
                        np.concatenate(
                            [component_rows[index][3] for index in group_indexes]
                        )
                    )
                    group_triangle_area_m2 = math.fsum(
                        float(component_rows[index][1])
                        for index in group_indexes
                    )
                    group_hull_area_m2 = _convex_hull_area_xy(
                        triangulation_points[group_vertices], np=np
                    )
                    group_gap_area_m2 = max(
                        0.0, group_hull_area_m2 - group_triangle_area_m2
                    )
                    if (
                        group_gap_area_m2
                        > maximum_density_sliver_area_m2
                        + maximum_triangle_edge_m
                        * metric_boundary_epsilon_m
                    ):
                        stabilized_component_rows.extend(
                            component_rows[index] for index in group_indexes
                        )
                        continue
                    group_centroid = math.fsum(
                        float(component_rows[index][1])
                        for index in group_indexes
                    )
                    weighted_center = np.sum(
                        np.vstack(
                            [
                                component_rows[index][4]
                                * float(component_rows[index][1])
                                for index in group_indexes
                            ]
                        ),
                        axis=0,
                    ) / group_centroid
                    stabilized_component_rows.append(
                        (
                            max(group_triangle_area_m2, group_hull_area_m2),
                            group_triangle_area_m2,
                            group_vertices,
                            group_contact_vertices,
                            weighted_center,
                        )
                    )
                    density_sliver_merged_group_count += 1
                component_rows = stabilized_component_rows
                density_sliver_filled_area_m2 = math.fsum(
                    max(0.0, float(row[0]) - float(row[1]))
                    for row in component_rows
                )
                component_rows.sort(key=lambda row: row[0], reverse=True)
                connected_component_areas_m2 = [
                    float(row[0]) for row in component_rows
                ]
                connected_component_accepted_triangle_areas_m2 = [
                    float(row[1]) for row in component_rows
                ]
                if component_rows:
                    (
                        largest_selection_area_m2,
                        largest_accepted_triangle_area_m2,
                        largest_retained_vertex_indexes,
                        largest_contact_vertex_indexes,
                        largest_component_area_centroid,
                    ) = component_rows[0]
                    area_tie_tolerance_m2 = max(
                        1e-12,
                        1e-9 * float(largest_selection_area_m2),
                    )
                    clear_component_tie = (
                        len(component_rows) > 1
                        and abs(
                            float(component_rows[1][0])
                            - float(largest_selection_area_m2)
                        )
                        <= area_tie_tolerance_m2
                    )
                    if ambiguous_provisional_component_upper_areas_m2:
                        ambiguous_provisional_component_could_be_authoritative = (
                            ambiguous_provisional_component_upper_areas_m2[0]
                            + area_tie_tolerance_m2
                            >= float(largest_selection_area_m2)
                        )
                    component_selection_ambiguous = (
                        clear_component_tie
                        or ambiguous_provisional_component_could_be_authoritative
                    )
                    if not component_selection_ambiguous:
                        local_triangle_area = float(largest_selection_area_m2)
                        authoritative_area_vertex_count = int(
                            largest_retained_vertex_indexes.size
                        )
                        # Wall contact is allowed only from certified compact-cell
                        # vertices.  Bounded area repair is selection-only: its
                        # rejected vertices cannot lend wall contact or create a
                        # bridge to another component.
                        authoritative_component_input_indices = retained_input_indexes[
                            largest_contact_vertex_indexes
                        ].astype(
                            np.int64, copy=True
                        )
                        authoritative_component_center = (
                            largest_component_area_centroid
                            + triangulation_origin
                        )
                elif ambiguous_provisional_component_upper_areas_m2:
                    component_selection_ambiguous = True
                    ambiguous_provisional_component_could_be_authoritative = True
        except (ImportError, AttributeError) as error:
            fail("SCIPY_SPATIAL_UNAVAILABLE", f"local footprint area needs SciPy spatial: {error}")
        except Exception as error:
            # Collinear or otherwise non-triangulable points carry no 2D area.
            if type(error).__name__ != "QhullError":
                raise
    raw_area = _convex_hull_area_xy(points, np=np)
    if authoritative_component_input_indices.size:
        robust_hull_area = _convex_hull_area_xy(
            points[authoritative_component_input_indices], np=np
        )
    return local_triangle_area, {
        "method": "area of one largest clear edge-connected certified Delaunay-cell surface; every triangle must have 2-D local support, endpoint support radii overlapping within the declared topology resolution, physical width above that resolution, bounded edge length, and sufficient quality; narrow-gap and sampled-boundary uncertainty is scoped to one provisional local component, and bounded repair cannot create wall contact",
        "globalPointDensityWeightedRadialPrefilterUsed": False,
        "componentSelectionUsesPhysicalAreaNotPointCount": True,
        "triangulationUsesLocalCoordinateOrigin": True,
        "triangulationOriginXYMeters": [
            float(triangulation_origin[0]),
            float(triangulation_origin[1]),
        ],
        "inputPointCount": int(points.shape[0]),
        "exactDuplicateXYPointsRemovedBeforeTriangulation": int(
            points.shape[0] - retained_points.shape[0]
        ),
        "uniqueTriangulationPointCount": int(retained_points.shape[0]),
        "pointCountInAnyAcceptedTriangle": points_in_any_accepted_triangle_count,
        "nonAuthoritativeInputPointCount": int(
            points.shape[0] - authoritative_component_input_indices.size
        ),
        "rawConvexHullAreaSquareMetersSensitivityOnly": raw_area,
        "authoritativeComponentConvexHullAreaSquareMetersSensitivityOnly": robust_hull_area,
        "maximumAcceptedTriangleEdgeMeters": maximum_triangle_edge_m,
        "metricBoundaryComparisonEpsilonMeters": metric_boundary_epsilon_m,
        "maximumObservedDelaunayTriangleEdgeMeters": maximum_observed_triangle_edge_m,
        "rejectedTriangleCountForExcessiveEdgeLength": rejected_for_edge_length_count,
        "minimumAcceptedTriangleQuality": minimum_triangle_quality,
        "rejectedTriangleCountForInsufficientShapeQuality": rejected_for_shape_quality_count,
        "absoluteMinimumTriangleAltitudeUsed": False,
        "minimumCertifiedTriangleAltitudeFractionOfLocalScale": 0.20,
        "rejectedForSubresolutionAltitudeCount": rejected_for_subresolution_altitude_count,
        "localTwoDimensionalScaleAngleRangeDegrees": [30.0, 150.0],
        "localTwoDimensionalScaleNeighbourCap": local_two_dimensional_scale_neighbour_cap,
        "pointCountWithLocalTwoDimensionalScale": local_two_dimensional_scale_count,
        "mutualLocalEdgeScaleFactor": mutual_local_edge_scale_factor,
        "mutualLocalEdgeRule": "edge length must not exceed the sum of both endpoint 2-D support radii",
        "densityTransitionRelaxationFactorTimesLargerEndpointScale": (
            density_transition_relaxation_factor
        ),
        "densityTransitionMinimumEndpointScaleRatio": (
            density_transition_minimum_scale_ratio
        ),
        "densityTransitionCertifiedTriangleCount": (
            density_transition_certified_triangle_count
        ),
        "densityTransitionCertifiedGroupCount": (
            density_transition_certified_group_count
        ),
        "densityTransitionCertificationRule": "at least two edge-connected relaxed triangles with a declared local-scale mismatch must join vertices already owned by two strict 2-D core components inside one unambiguous provisional component; only actual triangle area is added",
        "rejectedForMutualLocalScaleCount": rejected_for_mutual_local_scale_count,
        "rejectedDensitySliverTriangleCount": rejected_density_sliver_triangle_count,
        "minimumTwoDimensionalSampleDensityRequirementIsIntentional": True,
        "delaunayTriangleCount": total_triangle_count,
        "cocircularShorterDiagonalPolicy": cocircular_quad_shorter_diagonal_policy,
        "cocircularShorterDiagonalFlipCount": cocircular_shorter_diagonal_flip_count,
        "iterativeCocircularFlipsUsed": False,
        "cocircularInputRejectedFailClosed": cocircular_input_rejected_fail_closed,
        "circularBoundaryInsufficientInteriorSupportRejectedFailClosed": (
            circular_boundary_insufficient_interior_support
        ),
        "sampledOuterBoundaryInsufficientStrictInteriorSupportRejectedFailClosed": (
            sampled_outer_boundary_insufficient_interior_support
        ),
        "anomalousParallelSamplingSeamRejectedFailClosed": (
            anomalous_parallel_sampling_seam_detected
        ),
        "narrowGapOrSamplingIrregularityIsReportedAsAmbiguityNotPhysicalSlit": True,
        "topologyAmbiguityScope": "provisional local Delaunay component",
        "broadSamplingBridgeEdgeDefinition": "an accepted edge longer than 1.5 times both endpoint nearest-neighbour distances is treated as a contact-only bridge when its triangle joins a certified 2-D core to vertices not supported by any non-broad certified triangle",
        "broadSamplingBridgeNearestNeighbourRatio": broad_sampling_bridge_ratio,
        "broadSamplingBridgeAmbiguousComponentCount": (
            broad_sampling_bridge_ambiguous_component_count
        ),
        "broadSamplingBridgeMayRejectWholeAreaComponent": False,
        "broadSamplingBridgeContactExcludedVertexCount": len(
            broad_sampling_bridge_contact_excluded_vertices
        ),
        "broadSamplingBridgeDiagnostics": broad_sampling_bridge_diagnostics,
        "ambiguousProvisionalComponentCount": (
            ambiguous_provisional_component_count
        ),
        "ambiguousProvisionalComponentConvexHullUpperBoundAreasSquareMeters": (
            ambiguous_provisional_component_upper_areas_m2
        ),
        "ambiguousProvisionalComponentCouldBeAuthoritative": (
            ambiguous_provisional_component_could_be_authoritative
        ),
        "parallelSamplingSeamEvidence": parallel_sampling_seam_evidence,
        "cocircularLocalQuadGroupCount": cocircular_local_quad_group_count,
        "cocircularLocalQuadRejectedTriangleCount": (
            cocircular_local_quad_rejected_triangle_count
        ),
        "cocircularEmbeddedQuadShorterDiagonalCertificationCount": (
            cocircular_embedded_quad_shorter_diagonal_certification_count
        ),
        "cocircularLocalQuadPolicy": "isolated quads require both diagonals to pass; a quad embedded in other cells may use either fully certified diagonal because the diagonal is internal bookkeeping",
        "acceptedLocalTriangleCount": accepted_triangle_count,
        "acceptedLocalTriangleAreaSumSquareMetersSensitivityOnly": accepted_triangle_area_sum,
        "acceptedTriangleConnectedComponentCount": len(
            connected_component_areas_m2
        ),
        "rawAcceptedTriangleConnectedComponentCountBeforeDensitySliverRepair": (
            raw_accepted_triangle_component_count
        ),
        "densitySliverMaximumWidthMeters": density_sliver_max_width_m,
        "densitySliverMaximumFilledAreaSquareMeters": (
            0.5 * maximum_triangle_edge_m * density_sliver_max_width_m
        ),
        "densitySliverMergedGroupCount": density_sliver_merged_group_count,
        "densitySliverSingleComponentRepairCount": (
            density_sliver_single_component_repair_count
        ),
        "densitySliverFilledAreaSquareMeters": density_sliver_filled_area_m2,
        "acceptedTriangleConnectedComponentAreasSquareMeters": (
            connected_component_areas_m2
        ),
        "acceptedTriangleCoverageAreasSquareMetersExcludingDensitySliverFill": (
            connected_component_accepted_triangle_areas_m2
        ),
        "densitySliverFillIsBoundedByDeclaredPhysicalGapArea": True,
        "densitySliverFillMayContributeWithinDeclaredResolution": True,
        "densitySliverRepairCanCreateConnectivity": False,
        "densitySliverRepairCanExpandWallContact": False,
        "rejectedDensitySliverVerticesCannotExpandWallContact": True,
        "authoritativeLargestComponentSelectionAmbiguous": (
            component_selection_ambiguous
        ),
        "authoritativeComponentInputPointCount": int(
            authoritative_component_input_indices.size
        ),
        "authoritativeAreaDefiningVertexCount": authoritative_area_vertex_count,
        "wallContactPointsRestrictedToAuthoritativeAcceptedOrSameComponentDensitySliverVertices": True,
        "wallContactPointsRestrictedToCertifiedVertices": True,
        "wallContactDensitySliverCollarMaximumWidthMeters": density_sliver_max_width_m,
        "authoritativeComponentAreaCentroidXYMeters": [
            float(authoritative_component_center[0]),
            float(authoritative_component_center[1]),
        ],
        "localTriangleCoverageAreaSquareMeters": local_triangle_area,
        "globalXYGridUsed": False,
    }, authoritative_component_input_indices


def _horizontal_mode_public(mode: HorizontalLevelMode) -> dict[str, Any]:
    return {
        "levelMeters": mode.level_m,
        "supportCount": mode.support_count,
        "supportFractionOfInput": mode.support_fraction,
        "weightedSupport": mode.weighted_support,
        "medianAbsoluteDeviationMeters": mode.median_absolute_deviation_m,
        "p95AbsoluteResidualMeters": mode.p95_absolute_residual_m,
    }


def _extract_horizontal_level_modes(
    values: Any,
    weights: Any,
    *,
    role: str,
    config: StructuralConfig,
    np: Any,
) -> tuple[tuple[HorizontalLevelMode, ...], dict[str, Any]]:
    """Extract distinct, well-supported horizontal density modes in Z."""

    if not isinstance(config, StructuralConfig):
        fail("INVALID_HORIZONTAL_LEVEL_INPUT", "horizontal level config has the wrong type")
    try:
        values = np.asarray(values, dtype=np.float64)
        weights = np.asarray(weights, dtype=np.float64)
    except (TypeError, ValueError, OverflowError):
        fail("INVALID_HORIZONTAL_LEVEL_INPUT", "horizontal levels and weights must be numeric")
    if (
        role not in {"floor", "ceiling"}
        or values.ndim != 1
        or weights.shape != values.shape
        or not _is_integer_at_least(config.horizontal_level_min_support_count, 4)
        or values.size < operator.index(config.horizontal_level_min_support_count)
        or not np.all(np.isfinite(values))
        or not np.all(np.isfinite(weights))
        or np.any(weights <= 0.0)
        or not _is_finite_real(config.horizontal_level_max_residual_m)
        or config.horizontal_level_max_residual_m <= 0.0
        or not _is_integer_at_least(config.horizontal_level_max_count, 1)
        or not _is_finite_real(config.horizontal_level_mode_suppression_factor)
        or config.horizontal_level_mode_suppression_factor < 2.0
        or not _is_finite_real(config.metric_boundary_comparison_epsilon_m)
        or config.metric_boundary_comparison_epsilon_m < 0.0
    ):
        fail("INVALID_HORIZONTAL_LEVEL_INPUT", "horizontal level inputs or thresholds are invalid")
    minimum_support = config.horizontal_level_min_support_count
    radius = config.horizontal_level_max_residual_m
    metric_epsilon = config.metric_boundary_comparison_epsilon_m
    suppression_radius = radius * config.horizontal_level_mode_suppression_factor
    remaining = np.ones(values.size, dtype=bool)
    candidates: list[HorizontalLevelMode] = []

    def mode_from_mask(initial_mask: Any, allowed_mask: Any) -> HorizontalLevelMode:
        """Choose a robust level without invalidating its exact support window."""

        initial_indexes = np.flatnonzero(initial_mask)
        if initial_indexes.size < minimum_support:
            fail(
                "HORIZONTAL_LEVEL_UNSTABLE",
                f"{role} seed does not retain its declared minimum support",
            )
        initial_values = values[initial_indexes]
        # Every seed mask comes from one exact 2r sliding window.  Its feasible
        # center interval is therefore nonempty.  A raw median may sit outside
        # that interval for asymmetric endpoint multiplicities (for example
        # four samples at z=0 and eight at z=2r), so clamp it to the interval
        # rather than entering a density-driven iterative drift.
        feasible_low = float(np.max(initial_values) - radius)
        feasible_high = float(np.min(initial_values) + radius)
        if feasible_low > feasible_high + metric_epsilon:
            fail(
                "HORIZONTAL_LEVEL_UNSTABLE",
                f"{role} exact support window has no feasible center",
            )
        raw_median = float(np.median(initial_values))
        level = min(max(raw_median, feasible_low), feasible_high)
        best_mask = allowed_mask & (
            np.abs(values - level) <= radius + metric_epsilon
        )
        if int(np.count_nonzero(best_mask)) < minimum_support:
            fail(
                "HORIZONTAL_LEVEL_UNSTABLE",
                f"{role} level lost support after bounded median selection",
            )
        residual = np.abs(values[best_mask] - level)
        if residual.size == 0 or float(np.max(residual)) > radius + metric_epsilon:
            fail(
                "HORIZONTAL_LEVEL_RESIDUAL_CAP_VIOLATED",
                f"{role} mode contains a point outside its declared residual cap",
            )
        point_indices = np.flatnonzero(best_mask)
        return HorizontalLevelMode(
            level_m=level,
            point_indices=point_indices,
            support_count=int(point_indices.size),
            support_fraction=float(point_indices.size / values.size),
            weighted_support=math.fsum(
                float(value)
                for value in np.sort(weights[best_mask], kind="stable")
            ),
            median_absolute_deviation_m=float(np.median(residual)),
            p95_absolute_residual_m=float(
                np.percentile(residual, 95, method="linear")
            ),
        )

    def role_extreme_supported_seed(available_mask: Any) -> float | None:
        """Return the exact supported seed nearest the physical role extreme."""

        remaining_rows = np.flatnonzero(available_mask)
        if remaining_rows.size < minimum_support:
            return None
        sorted_values = np.sort(values[remaining_rows], kind="stable")
        window_spans = (
            sorted_values[minimum_support - 1 :]
            - sorted_values[: -(minimum_support - 1)]
        )
        supported_window_starts = np.flatnonzero(
            window_spans <= 2.0 * radius + metric_epsilon
        )
        if not supported_window_starts.size:
            return None
        window_start = int(
            supported_window_starts[0]
            if role == "floor"
            else supported_window_starts[-1]
        )
        window_end = window_start + minimum_support - 1
        return 0.5 * float(
            sorted_values[window_start] + sorted_values[window_end]
        )

    # Visit supported basins in physical role order (lowest first for a floor,
    # highest first for a ceiling).  Raw point count is eligibility evidence,
    # never a priority that dense clutter can exploit to hide the true edge.
    for _level_number in range(config.horizontal_level_max_count):
        seed = role_extreme_supported_seed(remaining)
        if seed is None:
            break
        seed_mask = remaining & (
            np.abs(values - seed) <= radius + metric_epsilon
        )
        mode = mode_from_mask(seed_mask, remaining)
        candidates.append(mode)
        # Remove only the points that were actually assessed in this mode.
        # A broader Z-only suppression band could silently erase a physically
        # separate floor or ceiling before its footprint and wall contacts are
        # checked.  Extra shoulders therefore become explicit candidates; if
        # they exceed the finite budget, the sentinel below fails closed.
        remaining[mode.point_indices] = False
    if not candidates:
        fail("HORIZONTAL_LEVEL_NOT_FOUND", f"no supported {role} level was found")
    next_supported_seed = role_extreme_supported_seed(remaining)
    if next_supported_seed is not None:
        fail(
            "HORIZONTAL_LEVEL_CANDIDATE_BUDGET_EXHAUSTED",
            f"more than {config.horizontal_level_max_count} distinct supported {role} levels exist; the next untested role-ordered level is {next_supported_seed:.9f} m, so no room envelope can be selected safely",
        )
    return tuple(candidates), {
        "maximumPointToLevelResidualMeters": radius,
        "modeSuppressionRadiusMeters": suppression_radius,
        "candidatePointExclusionRule": "only points assessed in a returned mode are removed",
        "supportedZWindowCanBeSilentlyRemovedBeforeSpatialQualification": False,
        "minimumSupportCount": minimum_support,
        "supportFractionIsDescriptiveOnly": True,
        "authoritativeSupportRule": "fixed absolute point count independent of other horizontal modes",
        "candidateTraversalIndependentOfRawSupportRanking": True,
        "candidateTraversalRoleOrder": (
            "lowest_to_highest" if role == "floor" else "highest_to_lowest"
        ),
        "firstRoleExtremeLevelMeters": candidates[0].level_m,
        "candidateCountLimit": config.horizontal_level_max_count,
        "candidateCountLimitReached": len(candidates) >= config.horizontal_level_max_count,
        "exactSlidingWindowSupportedBasinSentinelCheckedAfterLimit": True,
        "potentialAdditionalSupportedBasinRemainsAfterLimit": False,
        "supportedDistinctLevelCount": len(candidates),
    }


def _dominant_horizontal_level(
    values: Any,
    weights: Any,
    *,
    role: str,
    config: StructuralConfig,
    np: Any,
) -> tuple[float, float, dict[str, Any]]:
    """Z-only helper for testing mode extraction; production also requires wall support."""

    candidates, extraction = _extract_horizontal_level_modes(
        values, weights, role=role, config=config, np=np
    )
    selected_index = (
        min(range(len(candidates)), key=lambda index: candidates[index].level_m)
        if role == "floor"
        else max(range(len(candidates)), key=lambda index: candidates[index].level_m)
    )
    selected = candidates[selected_index]
    return selected.level_m, selected.median_absolute_deviation_m, {
        "role": role,
        "method": "Z-only distinct supported level extraction; production room envelopes additionally require wall-endpoint and footprint support",
        "selectionRule": "lowest supported distinct mode" if role == "floor" else "highest supported distinct mode",
        "boundaryQualifiedProductionSelection": False,
        "inputHorizontalSurfaceCount": int(np.asarray(values).size),
        "supportCount": selected.support_count,
        "supportFraction": selected.support_fraction,
        **extraction,
        "supportedDistinctLevels": [_horizontal_mode_public(mode) for mode in candidates],
        "selectedDistinctLevelIndex": selected_index,
        "levelMeters": selected.level_m,
        "medianAbsoluteDeviationMeters": selected.median_absolute_deviation_m,
        "p95AbsoluteResidualMeters": selected.p95_absolute_residual_m,
    }


def _boundary_wall_profiles(
    wall_planes: tuple[WallPlanePatch, ...],
    *,
    config: StructuralConfig,
    np: Any,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Find physically long local wall runs with density-equalized endpoints."""

    if not isinstance(config, StructuralConfig):
        fail("INVALID_HORIZONTAL_BOUNDARY_CONFIG", "wall-boundary config has the wrong type")
    if (
        not _is_finite_real(config.plane_occupancy_cell_m)
        or config.plane_occupancy_cell_m < 1e-6
        or not _is_integer_at_least(config.horizontal_level_min_wall_columns, 3)
        or not _is_finite_real(
            config.horizontal_level_min_wall_vertical_span_fraction
        )
        or not 0.0
        < config.horizontal_level_min_wall_vertical_span_fraction
        <= 1.0
        or not _is_finite_real(config.horizontal_level_wall_endpoint_trim_fraction)
        or not 0.0 <= config.horizontal_level_wall_endpoint_trim_fraction < 0.25
        or not _is_integer_at_least(
            config.horizontal_level_min_wall_segment_tangent_positions, 3
        )
        or not _is_finite_real(
            config.horizontal_level_min_wall_segment_tangent_span_m
        )
        or config.horizontal_level_min_wall_segment_tangent_span_m <= 0.0
        or not _is_finite_real(
            config.horizontal_level_wall_contact_dedup_tolerance_m
        )
        or config.horizontal_level_wall_contact_dedup_tolerance_m <= 0.0
    ):
        fail("INVALID_HORIZONTAL_BOUNDARY_CONFIG", "wall-boundary thresholds are invalid")
    cell_m = config.plane_occupancy_cell_m
    physical_epsilon_m = config.horizontal_level_wall_contact_dedup_tolerance_m
    reference_span_m = max(
        (
            float(segment.robust_z_range_m[1] - segment.robust_z_range_m[0])
            for plane in wall_planes
            for segment in plane.tangent_segments
            if segment.endpoint_column_count > 0
        ),
        default=0.0,
    )
    if reference_span_m <= 0.0:
        fail(
            "INSUFFICIENT_BOUNDARY_WALL_GEOMETRY",
            "local wall segments have no density-equalized vertical endpoints",
        )
    minimum_span_m = max(
        2.0 * cell_m,
        reference_span_m
        * config.horizontal_level_min_wall_vertical_span_fraction,
    )
    profiles: list[dict[str, Any]] = []
    public_profiles: list[dict[str, Any]] = []
    for plane in wall_planes:
        boundary_segments: list[dict[str, Any]] = []
        public_segments: list[dict[str, Any]] = []
        for segment in plane.tangent_segments:
            tangent_span_m = float(
                segment.tangent_range_m[1] - segment.tangent_range_m[0]
            )
            vertical_span_m = float(
                segment.robust_z_range_m[1] - segment.robust_z_range_m[0]
            )
            lower_support_count = len(
                segment.lower_endpoint_support_tangent_positions_m
            )
            upper_support_count = len(
                segment.upper_endpoint_support_tangent_positions_m
            )
            boundary_grade = (
                vertical_span_m + physical_epsilon_m >= minimum_span_m
                and tangent_span_m + physical_epsilon_m
                >= config.horizontal_level_min_wall_segment_tangent_span_m
                and segment.distinct_tangent_position_count
                >= config.horizontal_level_min_wall_segment_tangent_positions
                and segment.endpoint_column_count
                >= config.horizontal_level_min_wall_columns
                and max(lower_support_count, upper_support_count)
                >= config.horizontal_level_min_wall_columns
            )
            segment_profile = {
                "segment": segment,
                "boundaryGrade": boundary_grade,
                "lowerEndpointMeters": float(segment.robust_z_range_m[0]),
                "upperEndpointMeters": float(segment.robust_z_range_m[1]),
                "representativeVerticalSpanMeters": vertical_span_m,
                "tangentSpanMeters": tangent_span_m,
                "typicalVerticalSamplingGapMeters": float(
                    segment.typical_vertical_sampling_gap_m
                ),
            }
            if boundary_grade:
                boundary_segments.append(segment_profile)
            public_segments.append(
                {
                    "segmentId": segment.segment_id,
                    "tangentRangeMeters": [
                        float(segment.tangent_range_m[0]),
                        float(segment.tangent_range_m[1]),
                    ],
                    "tangentSpanMeters": tangent_span_m,
                    "rawPointCount": segment.raw_point_count,
                    "distinctTangentPositionCount": (
                        segment.distinct_tangent_position_count
                    ),
                    "densityEqualizedEndpointColumnCount": (
                        segment.endpoint_column_count
                    ),
                    "densityEqualizedLowerEndpointMeters": float(
                        segment.robust_z_range_m[0]
                    ),
                    "densityEqualizedUpperEndpointMeters": float(
                        segment.robust_z_range_m[1]
                    ),
                    "representativeVerticalSpanMeters": vertical_span_m,
                    "typicalVerticalSamplingGapMeters": float(
                        segment.typical_vertical_sampling_gap_m
                    ),
                    "lowerEndpointSupportTangentPositionCount": (
                        lower_support_count
                    ),
                    "upperEndpointSupportTangentPositionCount": (
                        upper_support_count
                    ),
                    "boundaryGrade": boundary_grade,
                }
            )
        profile = {
            "plane": plane,
            "boundaryGrade": bool(boundary_segments),
            "boundarySegments": boundary_segments,
        }
        if boundary_segments:
            profiles.append(profile)
        public_profiles.append(
            {
                "planeId": plane.plane_id,
                "normalXY": [float(value) for value in plane.normal_xy],
                "rawPlaneOccupiedCellCountSensitivityOnly": len(
                    plane.occupied_cells
                ),
                "localTangentSegmentCount": len(plane.tangent_segments),
                "boundaryGradeLocalTangentSegmentCount": len(
                    boundary_segments
                ),
                "boundaryGrade": bool(boundary_segments),
                "localTangentSegments": public_segments,
            }
        )
    if len(profiles) < 2:
        fail(
            "INSUFFICIENT_BOUNDARY_WALL_GEOMETRY",
            "fewer than two repeated room-height wall patches support a horizontal envelope",
        )
    return profiles, {
        "method": "map-origin-independent local tangent runs; one min/max endpoint vote per local tangent bin; short vertical columns and short wall fragments are rejected before ceiling/floor contact",
        "localTangentEndpointBinTargetWidthMeters": cell_m,
        "referenceRepresentativeWallVerticalSpanMeters": reference_span_m,
        "minimumBoundaryWallVerticalSpanMeters": minimum_span_m,
        "minimumBoundaryWallTangentSpanMeters": config.horizontal_level_min_wall_segment_tangent_span_m,
        "minimumDistinctTangentPositionsPerSegment": config.horizontal_level_min_wall_segment_tangent_positions,
        "minimumDensityEqualizedEndpointColumnsPerSegment": config.horizontal_level_min_wall_columns,
        "globalTangentGridUsedForEnvelopeQualification": False,
        "profiles": public_profiles,
    }


def _has_nonparallel_supporting_walls(
    profiles: list[dict[str, Any]], *, config: StructuralConfig
) -> bool:
    minimum_cross = math.sin(math.radians(config.plane_min_pair_angle_degrees))
    for first, second in itertools.combinations(profiles, 2):
        first_normal = first["plane"].normal_xy
        second_normal = second["plane"].normal_xy
        cross = abs(
            float(
                first_normal[0] * second_normal[1]
                - first_normal[1] * second_normal[0]
            )
        )
        if cross + config.angular_boundary_comparison_epsilon >= minimum_cross:
            return True
    return False


def _well_separated_parallel_support(
    profiles: list[dict[str, Any]],
    *,
    anchor_xy: Any,
    config: StructuralConfig,
    np: Any,
) -> tuple[bool, list[dict[str, Any]]]:
    """Test an origin-invariant parallel-wall fallback at a geometry-derived anchor."""

    anchor = np.asarray(anchor_xy, dtype=np.float64)
    if anchor.shape != (2,) or not np.all(np.isfinite(anchor)):
        fail("INVALID_PARALLEL_WALL_ANCHOR", "parallel-wall anchor must be one finite XY point")
    maximum_angle = config.horizontal_level_parallel_wall_angle_tolerance_degrees
    pair_evidence: list[dict[str, Any]] = []
    accepted = False
    for first, second in itertools.combinations(profiles, 2):
        first_plane = first["plane"]
        second_plane = second["plane"]
        raw_dot = float(first_plane.normal_xy @ second_plane.normal_xy)
        alignment_sign = 1.0 if raw_dot >= 0.0 else -1.0
        aligned_second_normal = alignment_sign * second_plane.normal_xy
        aligned_second_offset = alignment_sign * second_plane.offset_m
        absolute_dot = min(1.0, max(0.0, abs(raw_dot)))
        angle_degrees = math.degrees(math.acos(absolute_dot))
        # Compare signed plane positions at the same footprint-derived anchor.
        # Unlike abs(d1-d2) for merely near-parallel normals, this value is
        # invariant when the complete room and anchor are rigidly transformed.
        first_position = float(first_plane.offset_m - first_plane.normal_xy @ anchor)
        second_position = float(aligned_second_offset - aligned_second_normal @ anchor)
        separation = abs(first_position - second_position)
        metric_epsilon_m = config.metric_boundary_comparison_epsilon_m
        brackets_anchor = (
            first_position <= metric_epsilon_m
            and second_position >= -metric_epsilon_m
        ) or (
            second_position <= metric_epsilon_m
            and first_position >= -metric_epsilon_m
        )
        qualifies = (
            angle_degrees
            <= maximum_angle + config.angular_boundary_comparison_epsilon
            and separation + metric_epsilon_m
            >= config.horizontal_level_min_parallel_wall_separation_m
            and brackets_anchor
        )
        accepted = accepted or qualifies
        pair_evidence.append(
            {
                "firstPlaneId": first_plane.plane_id,
                "secondPlaneId": second_plane.plane_id,
                "absoluteNormalAngleDegrees": angle_degrees,
                "maximumParallelAngleDegrees": maximum_angle,
                "anchorXYMeters": [float(anchor[0]), float(anchor[1])],
                "anchorMeasuredSeparationMeters": separation,
                "minimumSeparationMeters": config.horizontal_level_min_parallel_wall_separation_m,
                "metricBoundaryComparisonEpsilonMeters": metric_epsilon_m,
                "angularBoundaryComparisonEpsilon": config.angular_boundary_comparison_epsilon,
                "firstSignedPositionFromAnchorMeters": first_position,
                "secondSignedPositionFromAnchorMeters": second_position,
                "wallsBracketFootprintAnchor": brackets_anchor,
                "qualifiesAsWellSeparatedParallelPair": qualifies,
            }
        )
    return accepted, pair_evidence


def _select_room_envelope_level(
    horizontal_points: Any,
    weights: Any,
    wall_planes: tuple[WallPlanePatch, ...],
    *,
    role: str,
    allow_multiple_ceiling_levels: bool = False,
    config: StructuralConfig,
    np: Any,
) -> tuple[float, float, dict[str, Any]]:
    """Select an authoritative floor/top envelope and report secondary ceiling bands."""

    if not isinstance(config, StructuralConfig):
        fail("INVALID_HORIZONTAL_ENVELOPE_INPUT", "horizontal envelope config has the wrong type")
    points = _require_finite_matrix(horizontal_points, 3, f"{role} horizontal points", np)
    try:
        weights = np.asarray(weights, dtype=np.float64)
    except (TypeError, ValueError, OverflowError):
        fail("INVALID_HORIZONTAL_ENVELOPE_INPUT", "horizontal envelope weights must be numeric")
    if (
        role not in {"floor", "ceiling"}
        or (allow_multiple_ceiling_levels and role != "ceiling")
        or weights.shape != (points.shape[0],)
        or not np.all(np.isfinite(weights))
        or np.any(weights <= 0.0)
        or not _is_finite_real(config.horizontal_level_point_dedup_tolerance_m)
        or config.horizontal_level_point_dedup_tolerance_m <= 0.0
        or not _is_finite_real(config.horizontal_level_min_footprint_area_m2)
        or config.horizontal_level_min_footprint_area_m2 <= 0.0
        or not _is_finite_real(config.horizontal_level_min_footprint_fraction)
        or not 0.0 < config.horizontal_level_min_footprint_fraction <= 1.0
        or not _is_finite_real(config.horizontal_level_min_relative_footprint)
        or not 0.0 < config.horizontal_level_min_relative_footprint <= 1.0
        or not _is_finite_real(
            config.horizontal_level_footprint_max_triangle_edge_m
        )
        or config.horizontal_level_footprint_max_triangle_edge_m <= 0.0
        or not _is_finite_real(
            config.horizontal_level_footprint_min_triangle_quality
        )
        or not 0.0
        < config.horizontal_level_footprint_min_triangle_quality
        <= 1.0
        or not _is_finite_real(
            config.horizontal_level_footprint_density_sliver_max_width_m
        )
        or config.horizontal_level_footprint_density_sliver_max_width_m <= 0.0
        or config.horizontal_level_footprint_density_sliver_max_width_m
        >= config.horizontal_level_footprint_max_triangle_edge_m
        or not _is_finite_real(config.metric_boundary_comparison_epsilon_m)
        or config.metric_boundary_comparison_epsilon_m < 0.0
        or not _is_finite_real(
            config.horizontal_level_max_wall_endpoint_tolerance_m
        )
        or config.horizontal_level_max_wall_endpoint_tolerance_m <= 0.0
        or not _is_integer_at_least(
            config.horizontal_level_min_wall_contact_points, 2
        )
        or not _is_finite_real(
            config.horizontal_level_wall_contact_dedup_tolerance_m
        )
        or config.horizontal_level_wall_contact_dedup_tolerance_m <= 0.0
        or not _is_finite_real(
            config.horizontal_level_wall_segment_max_tangent_gap_m
        )
        or config.horizontal_level_wall_segment_max_tangent_gap_m <= 0.0
        or not _is_integer_at_least(
            config.horizontal_level_min_wall_segment_tangent_positions, 3
        )
        or not _is_finite_real(
            config.horizontal_level_min_wall_segment_tangent_span_m
        )
        or config.horizontal_level_min_wall_segment_tangent_span_m <= 0.0
        or not _is_finite_real(
            config.horizontal_level_min_wall_contact_total_coverage_m
        )
        or config.horizontal_level_min_wall_contact_total_coverage_m <= 0.0
        or not _is_finite_real(
            config.horizontal_level_min_wall_contact_contiguous_coverage_m
        )
        or config.horizontal_level_min_wall_contact_contiguous_coverage_m <= 0.0
        or config.horizontal_level_min_wall_contact_contiguous_coverage_m
        > config.horizontal_level_min_wall_contact_total_coverage_m
        or not _is_finite_real(
            config.horizontal_level_parallel_wall_angle_tolerance_degrees
        )
        or not _is_finite_real(config.plane_min_pair_angle_degrees)
        or not 0.0
        < config.horizontal_level_parallel_wall_angle_tolerance_degrees
        < config.plane_min_pair_angle_degrees
        or not _is_finite_real(
            config.horizontal_level_min_parallel_wall_separation_m
        )
        or config.horizontal_level_min_parallel_wall_separation_m <= 0.0
        or not _is_finite_real(config.angular_boundary_comparison_epsilon)
        or config.angular_boundary_comparison_epsilon < 0.0
    ):
        fail("INVALID_HORIZONTAL_ENVELOPE_INPUT", "horizontal envelope inputs or thresholds are invalid")
    raw_horizontal_point_count = int(points.shape[0])
    exact_duplicate_horizontal_point_count = int(
        points.shape[0] - np.unique(points, axis=0).shape[0]
    )
    points, weights, physical_deduplication = _deduplicate_physical_points(
        points,
        weights,
        tolerance_m=config.horizontal_level_point_dedup_tolerance_m,
        comparison_epsilon_m=config.metric_boundary_comparison_epsilon_m,
        np=np,
    )
    modes, extraction = _extract_horizontal_level_modes(
        points[:, 2], weights, role=role, config=config, np=np
    )
    wall_profiles, wall_evidence = _boundary_wall_profiles(
        wall_planes, config=config, np=np
    )
    cell_m = config.plane_occupancy_cell_m
    mode_footprint_rows = [
        _robust_xy_footprint_area(
            points[mode.point_indices, :2],
            maximum_triangle_edge_m=config.horizontal_level_footprint_max_triangle_edge_m,
            minimum_triangle_quality=config.horizontal_level_footprint_min_triangle_quality,
            density_sliver_max_width_m=config.horizontal_level_footprint_density_sliver_max_width_m,
            metric_boundary_epsilon_m=config.metric_boundary_comparison_epsilon_m,
            np=np,
        )
        for mode in modes
    ]
    mode_footprint_areas_m2 = [row[0] for row in mode_footprint_rows]
    total_mode_footprint_area_m2 = math.fsum(mode_footprint_areas_m2)
    largest_mode_footprint_area_m2 = max(mode_footprint_areas_m2, default=0.0)
    minimum_absolute_or_role_fraction_area_m2 = max(
        config.horizontal_level_min_footprint_area_m2,
        total_mode_footprint_area_m2 * config.horizontal_level_min_footprint_fraction,
    )
    minimum_relative_footprint_area_m2 = (
        largest_mode_footprint_area_m2 * config.horizontal_level_min_relative_footprint
    )
    endpoint_tolerance_m = max(
        4.0 * config.horizontal_level_max_residual_m,
        1.5 * config.plane_occupancy_cell_m,
    )
    if endpoint_tolerance_m > config.horizontal_level_max_wall_endpoint_tolerance_m:
        fail(
            "INVALID_HORIZONTAL_ENVELOPE_INPUT",
            "base wall-endpoint tolerance exceeds its hard maximum",
        )
    wall_contact_tolerance_m = max(
        4.0 * config.horizontal_level_max_residual_m,
        2.0 * config.plane_occupancy_cell_m,
    )
    footprint_qualified_by_index = [
        area_m2 + 1e-12 >= config.horizontal_level_min_footprint_area_m2
        for area_m2 in mode_footprint_areas_m2
    ]
    physical_epsilon_m = config.horizontal_level_wall_contact_dedup_tolerance_m
    mode_wall_edges: list[dict[tuple[int, int], dict[str, Any]]] = []
    for mode_index, mode in enumerate(modes):
        authoritative_component_local_indexes = mode_footprint_rows[mode_index][2]
        mode_xy = points[
            mode.point_indices[authoritative_component_local_indexes],
            :2,
        ]
        mode_edges: dict[tuple[int, int], dict[str, Any]] = {}
        for profile in wall_profiles:
            plane = profile["plane"]
            tangent = np.asarray([-plane.normal_xy[1], plane.normal_xy[0]], dtype=np.float64)
            normal_distance = np.abs(mode_xy @ plane.normal_xy - plane.offset_m)
            tangent_coordinate = mode_xy @ tangent
            near_plane_tangent_values = tangent_coordinate[
                normal_distance <= wall_contact_tolerance_m + physical_epsilon_m
            ]
            for segment_profile in profile["boundarySegments"]:
                segment = segment_profile["segment"]
                segment_key = (plane.plane_id, segment.segment_id)
                endpoint = float(
                    segment_profile["lowerEndpointMeters"]
                    if role == "floor"
                    else segment_profile["upperEndpointMeters"]
                )
                endpoint_support_positions = np.asarray(
                    segment.lower_endpoint_support_tangent_positions_m
                    if role == "floor"
                    else segment.upper_endpoint_support_tangent_positions_m,
                    dtype=np.float64,
                )
                endpoint_delta_m = abs(endpoint - mode.level_m)
                uncapped_wall_endpoint_tolerance_m = max(
                    endpoint_tolerance_m,
                    float(segment_profile["typicalVerticalSamplingGapMeters"])
                    + 0.5 * config.plane_occupancy_cell_m,
                )
                wall_endpoint_tolerance_m = min(
                    uncapped_wall_endpoint_tolerance_m,
                    config.horizontal_level_max_wall_endpoint_tolerance_m,
                )
                within_endpoint_tolerance = (
                    endpoint_delta_m
                    <= wall_endpoint_tolerance_m + physical_epsilon_m
                )
                candidate_has_local_wall_support = _within_scalar_support_distance(
                    near_plane_tangent_values,
                    endpoint_support_positions,
                    maximum_distance_m=wall_contact_tolerance_m,
                    physical_epsilon_m=physical_epsilon_m,
                    np=np,
                )
                contact_tangent_values = near_plane_tangent_values[
                    candidate_has_local_wall_support
                ]
                clustered_contact_tangent_values = _cluster_scalar_positions(
                    contact_tangent_values,
                    tolerance_m=physical_epsilon_m,
                    np=np,
                )
                endpoint_position_has_candidate_contact = (
                    _within_scalar_support_distance(
                        endpoint_support_positions,
                        clustered_contact_tangent_values,
                        maximum_distance_m=wall_contact_tolerance_m,
                        physical_epsilon_m=physical_epsilon_m,
                        np=np,
                    )
                    if clustered_contact_tangent_values.size
                    else np.zeros(endpoint_support_positions.size, dtype=bool)
                )
                contacted_endpoint_support_positions = endpoint_support_positions[
                    endpoint_position_has_candidate_contact
                ]
                candidate_contact_intervals = _physical_scalar_run_intervals(
                    clustered_contact_tangent_values,
                    maximum_gap_m=2.0 * wall_contact_tolerance_m,
                    endpoint_padding_m=0.5 * cell_m,
                    physical_epsilon_m=physical_epsilon_m,
                    np=np,
                )
                local_wall_contact_intervals = _physical_scalar_run_intervals(
                    contacted_endpoint_support_positions,
                    maximum_gap_m=config.horizontal_level_wall_segment_max_tangent_gap_m,
                    endpoint_padding_m=0.5 * cell_m,
                    physical_epsilon_m=physical_epsilon_m,
                    np=np,
                )
                candidate_total_contact_coverage_m = math.fsum(
                    high - low for low, high in candidate_contact_intervals
                )
                candidate_longest_contact_coverage_m = max(
                    (high - low for low, high in candidate_contact_intervals),
                    default=0.0,
                )
                local_wall_total_contact_coverage_m = math.fsum(
                    high - low for low, high in local_wall_contact_intervals
                )
                local_wall_longest_contact_coverage_m = max(
                    (high - low for low, high in local_wall_contact_intervals),
                    default=0.0,
                )
                unique_contact_tangent_count = int(
                    clustered_contact_tangent_values.size
                )
                contacted_endpoint_support_position_count = int(
                    contacted_endpoint_support_positions.size
                )
                total_contact_coverage_m = min(
                    candidate_total_contact_coverage_m,
                    local_wall_total_contact_coverage_m,
                )
                longest_contact_coverage_m = min(
                    candidate_longest_contact_coverage_m,
                    local_wall_longest_contact_coverage_m,
                )
                spatially_contacts_wall = (
                    unique_contact_tangent_count
                    >= config.horizontal_level_min_wall_contact_points
                    and contacted_endpoint_support_position_count
                    >= config.horizontal_level_min_wall_contact_points
                    and total_contact_coverage_m + physical_epsilon_m
                    >= config.horizontal_level_min_wall_contact_total_coverage_m
                    and longest_contact_coverage_m + physical_epsilon_m
                    >= config.horizontal_level_min_wall_contact_contiguous_coverage_m
                )
                role_endpoint_support_sufficient = (
                    endpoint_support_positions.size
                    >= config.horizontal_level_min_wall_columns
                )
                eligible = (
                    footprint_qualified_by_index[mode_index]
                    and role_endpoint_support_sufficient
                    and within_endpoint_tolerance
                    and spatially_contacts_wall
                )
                mode_edges[segment_key] = {
                    "profile": profile,
                    "segmentProfile": segment_profile,
                    "endpointDeltaMeters": endpoint_delta_m,
                    "eligibleBeforeExclusiveAssignment": eligible,
                    "publicEvidence": {
                        "planeId": plane.plane_id,
                        "segmentId": segment.segment_id,
                        "normalXY": [float(value) for value in plane.normal_xy],
                        "localSegmentTangentRangeMeters": [
                            float(segment.tangent_range_m[0]),
                            float(segment.tangent_range_m[1]),
                        ],
                        "localSegmentTangentSpanMeters": float(
                            segment_profile["tangentSpanMeters"]
                        ),
                        "localSegmentRawPointCount": segment.raw_point_count,
                        "localSegmentDistinctTangentPositionCount": (
                            segment.distinct_tangent_position_count
                        ),
                        "densityEqualizedEndpointColumnCount": (
                            segment.endpoint_column_count
                        ),
                        "roleEndpointSupportTangentPositionCount": int(
                            endpoint_support_positions.size
                        ),
                        "roleEndpointSupportSufficient": role_endpoint_support_sufficient,
                        "densityEqualizedLocalEndpointMeters": endpoint,
                        "absoluteEndpointDeltaMeters": endpoint_delta_m,
                        "baseMaximumEndpointDeltaMeters": endpoint_tolerance_m,
                        "uncappedVerticalSamplingAdjustedMaximumEndpointDeltaMeters": uncapped_wall_endpoint_tolerance_m,
                        "verticalSamplingAdjustedMaximumEndpointDeltaMeters": wall_endpoint_tolerance_m,
                        "hardMaximumEndpointDeltaMeters": config.horizontal_level_max_wall_endpoint_tolerance_m,
                        "endpointToleranceCapped": (
                            uncapped_wall_endpoint_tolerance_m
                            > config.horizontal_level_max_wall_endpoint_tolerance_m
                        ),
                        "withinEndpointTolerance": within_endpoint_tolerance,
                        "spatialContactPointCount": int(contact_tangent_values.size),
                        "spatialContactUniqueTangentPositionCount": unique_contact_tangent_count,
                        "contactedLocalWallEndpointPositionCount": contacted_endpoint_support_position_count,
                        "spatialContactTangentDedupToleranceMeters": physical_epsilon_m,
                        "minimumSpatialContactPointCount": config.horizontal_level_min_wall_contact_points,
                        "candidateContactContinuousIntervalCount": len(
                            candidate_contact_intervals
                        ),
                        "localWallContactContinuousIntervalCount": len(
                            local_wall_contact_intervals
                        ),
                        "candidateContactTotalCoverageMeters": candidate_total_contact_coverage_m,
                        "localWallContactTotalCoverageMeters": local_wall_total_contact_coverage_m,
                        "spatialContactTotalCoverageMeters": total_contact_coverage_m,
                        "minimumSpatialContactTotalCoverageMeters": config.horizontal_level_min_wall_contact_total_coverage_m,
                        "candidateContactLongestContiguousCoverageMeters": candidate_longest_contact_coverage_m,
                        "localWallContactLongestContiguousCoverageMeters": local_wall_longest_contact_coverage_m,
                        "spatialContactLongestContiguousCoverageMeters": longest_contact_coverage_m,
                        "minimumSpatialContactContiguousCoverageMeters": config.horizontal_level_min_wall_contact_contiguous_coverage_m,
                        "maximumWallDistanceMeters": wall_contact_tolerance_m,
                        "localEndpointAndTangentSupportMustBothBePresent": True,
                        "spatiallyContactsWallPatch": spatially_contacts_wall,
                        "eligibleBeforeExclusiveAssignment": eligible,
                    },
                }
        mode_wall_edges.append(mode_edges)

    # One physical local wall-segment endpoint can authorize only its nearest
    # horizontal mode.  This competition is authoritative: a nearby lower band
    # cannot lend the same endpoint to a higher band (or vice versa).
    endpoint_assignment_by_segment_key: dict[tuple[int, int], int] = {}
    ambiguous_endpoint_segment_keys: set[tuple[int, int]] = set()
    segment_keys = sorted(
        {segment_key for mode_edges in mode_wall_edges for segment_key in mode_edges}
    )
    for segment_key in segment_keys:
        eligible_modes = [
            (mode_index, mode_wall_edges[mode_index][segment_key])
            for mode_index in range(len(modes))
            if mode_wall_edges[mode_index][segment_key][
                "eligibleBeforeExclusiveAssignment"
            ]
        ]
        if eligible_modes:
            eligible_modes.sort(
                key=lambda item: (item[1]["endpointDeltaMeters"], item[0])
            )
            best_delta_m = float(eligible_modes[0][1]["endpointDeltaMeters"])
            equally_near = [
                item
                for item in eligible_modes
                if abs(float(item[1]["endpointDeltaMeters"]) - best_delta_m)
                <= physical_epsilon_m
            ]
            if len(equally_near) == 1:
                endpoint_assignment_by_segment_key[segment_key] = equally_near[0][0]
            else:
                ambiguous_endpoint_segment_keys.add(segment_key)

    candidate_evidence: list[dict[str, Any]] = []
    qualified_indexes: list[int] = []
    for mode_index, (mode, footprint_area_m2) in enumerate(
        zip(modes, mode_footprint_areas_m2, strict=True)
    ):
        raw_eligible_plane_ids = {
            edge["profile"]["plane"].plane_id
            for edge in mode_wall_edges[mode_index].values()
            if edge["eligibleBeforeExclusiveAssignment"]
        }
        assigned_edges = [
            edge
            for segment_key, edge in mode_wall_edges[mode_index].items()
            if edge["eligibleBeforeExclusiveAssignment"]
            and endpoint_assignment_by_segment_key.get(segment_key) == mode_index
        ]
        best_assigned_edge_by_plane_id: dict[int, dict[str, Any]] = {}
        for edge in assigned_edges:
            plane_id = edge["profile"]["plane"].plane_id
            current = best_assigned_edge_by_plane_id.get(plane_id)
            if current is None or (
                edge["endpointDeltaMeters"],
                edge["segmentProfile"]["segment"].segment_id,
            ) < (
                current["endpointDeltaMeters"],
                current["segmentProfile"]["segment"].segment_id,
            ):
                best_assigned_edge_by_plane_id[plane_id] = edge
        supporting_profiles = [
            edge["profile"]
            for _plane_id, edge in sorted(best_assigned_edge_by_plane_id.items())
        ]
        wall_support: list[dict[str, Any]] = []
        for segment_key, edge in sorted(mode_wall_edges[mode_index].items()):
            profile = edge["profile"]
            plane = profile["plane"]
            assigned_to_candidate = (
                endpoint_assignment_by_segment_key.get(segment_key) == mode_index
            )
            supports_boundary_qualification = bool(
                best_assigned_edge_by_plane_id.get(plane.plane_id) is edge
            )
            wall_support.append(
                {
                    **edge["publicEvidence"],
                    "supportsBoundaryQualification": supports_boundary_qualification,
                    "assignedExclusivelyToCandidate": assigned_to_candidate,
                    "endpointAssignmentAmbiguousAndRejected": (
                        segment_key in ambiguous_endpoint_segment_keys
                    ),
                }
            )
        footprint_qualified = footprint_qualified_by_index[mode_index]
        nonparallel_walls = _has_nonparallel_supporting_walls(
            supporting_profiles, config=config
        )
        footprint_anchor_xy = np.asarray(
            mode_footprint_rows[mode_index][1][
                "authoritativeComponentAreaCentroidXYMeters"
            ],
            dtype=np.float64,
        )
        separated_parallel_walls, parallel_pair_evidence = _well_separated_parallel_support(
            supporting_profiles,
            anchor_xy=footprint_anchor_xy,
            config=config,
            np=np,
        )
        rejection_reasons: list[str] = []
        if not footprint_qualified:
            rejection_reasons.append("insufficient_horizontal_XY_footprint")
        if len(supporting_profiles) < 2:
            rejection_reasons.append("fewer_than_two_boundary_walls_reach_level")
        elif not nonparallel_walls and not separated_parallel_walls:
            rejection_reasons.append("parallel_supporting_walls_are_not_well_separated")
        qualified = (
            footprint_qualified
            and len(supporting_profiles) >= 2
            and (
                nonparallel_walls or separated_parallel_walls
            )
        )
        if qualified:
            qualified_indexes.append(mode_index)
        candidate_evidence.append(
            {
                **_horizontal_mode_public(mode),
                "horizontalFootprintAreaSquareMeters": footprint_area_m2,
                "horizontalFootprintEvidence": mode_footprint_rows[mode_index][1],
                "footprintQualified": footprint_qualified,
                "roleFractionFootprintQualifiedSensitivityOnly": (
                    footprint_area_m2 + 1e-12
                    >= minimum_absolute_or_role_fraction_area_m2
                ),
                "largestModeRelativeFootprintQualifiedSensitivityOnly": (
                    footprint_area_m2 + 1e-12
                    >= minimum_relative_footprint_area_m2
                ),
                "supportingBoundaryWallCount": len(supporting_profiles),
                "rawEligibleBoundaryWallCountBeforeExclusiveAssignment": len(raw_eligible_plane_ids),
                "rawEligibleLocalWallSegmentCountBeforeExclusiveAssignment": sum(
                    int(bool(edge["eligibleBeforeExclusiveAssignment"]))
                    for edge in mode_wall_edges[mode_index].values()
                ),
                "hasTwoNonparallelSupportingBoundaryWalls": nonparallel_walls,
                "hasTwoWellSeparatedParallelSupportingBoundaryWalls": separated_parallel_walls,
                "parallelSupportingWallPairEvidence": parallel_pair_evidence,
                "wallEndpointSupport": wall_support,
                "qualifiedAsBoundarySupportedLevel": qualified,
                "selectedAsRoomEnvelope": False,
                "includedInReportedBoundarySupportedBands": qualified,
                "usedForFixedScaleGate": False,
                "reportedOnlyLowerBand": False,
                "rejectionReasons": rejection_reasons,
            }
        )
    if not qualified_indexes:
        fail(
            "HORIZONTAL_ROOM_ENVELOPE_NOT_FOUND",
            f"no {role} level satisfies the continuous-footprint, capped-endpoint, actual-wall-contact boundary test",
        )
    if role == "ceiling":
        highest_qualified_level = max(float(modes[index].level_m) for index in qualified_indexes)
        plausible_but_under_supported_higher_levels = [
            float(modes[index].level_m)
            for index, candidate in enumerate(candidate_evidence)
            if float(modes[index].level_m) > highest_qualified_level
            and bool(candidate["footprintQualified"])
        ]
        if plausible_but_under_supported_higher_levels:
            fail(
                "HIGHER_CEILING_BAND_INSUFFICIENT_BOUNDARY_SUPPORT",
                "a higher broad ceiling band exists but lacks the required distinct-wall support, so the lower multiwall band cannot honestly be called the top envelope: "
                f"{sorted(plausible_but_under_supported_higher_levels)}",
            )
    if len(qualified_indexes) > 1 and not allow_multiple_ceiling_levels:
        levels = sorted(float(modes[index].level_m) for index in qualified_indexes)
        if levels[-1] - levels[0] > extraction["modeSuppressionRadiusMeters"]:
            fail(
                "MULTI_LEVEL_HORIZONTAL_ENVELOPE",
                f"multiple separated {role} levels meet the room-boundary test: {levels}",
            )
    selected_index = (
        min(qualified_indexes, key=lambda index: modes[index].level_m)
        if role == "floor"
        else max(qualified_indexes, key=lambda index: modes[index].level_m)
    )
    selected = modes[selected_index]
    candidate_evidence[selected_index]["selectedAsRoomEnvelope"] = True
    candidate_evidence[selected_index]["usedForFixedScaleGate"] = role == "ceiling"
    for candidate_index in qualified_indexes:
        if role == "ceiling" and candidate_index != selected_index:
            candidate_evidence[candidate_index]["reportedOnlyLowerBand"] = True
    return selected.level_m, selected.median_absolute_deviation_m, {
        "role": role,
        "method": (
            "distinct horizontal Z modes tested by local 2D coverage, density-equalized local wall-segment endpoints, and mutual physical wall/level contact on "
            + (
                "at least two room-height wall patches; each local endpoint is assigned to its nearest candidate, the highest qualified mode is authoritative, and lower qualified bands are report-only"
                if allow_multiple_ceiling_levels
                else "two spatially contacted nonparallel wall patches or a well-separated parallel pair that brackets the floor footprint"
            )
        ),
        "selectionRule": (
            "assign each physical local wall-segment endpoint to only its nearest unambiguous broad ceiling mode, use the highest strict multiwall mode as the top envelope, and report other qualified lower bands without using their heights in the scale gate"
            if allow_multiple_ceiling_levels
            else (
                "choose the lowest boundary after exclusive nearest-endpoint competition, supported by either nonparallel walls or a well-separated parallel pair that brackets its footprint"
                if role == "floor"
                else "choose the highest boundary after exclusive nearest-endpoint competition"
            )
        ),
        "multipleCeilingLevelsAllowed": allow_multiple_ceiling_levels,
        "eachLocalWallSegmentEndpointAssignedToAtMostOneCandidateMode": True,
        "nearestEndpointCompetitionIsAuthoritative": True,
        "ambiguousEqualDistanceEndpointAssignmentsRejected": True,
        "footprintQualifiedCandidateIndexesBeforeWallQualification": [
            index
            for index, qualified in enumerate(footprint_qualified_by_index)
            if qualified
        ],
        "rawInputHorizontalSurfaceCount": raw_horizontal_point_count,
        "inputHorizontalSurfaceCount": int(points.shape[0]),
        "physicallyIndistinguishableHorizontalSurfaceCountRemoved": int(
            raw_horizontal_point_count - points.shape[0]
        ),
        "exactDuplicateHorizontalSurfaceCountRemoved": exact_duplicate_horizontal_point_count,
        "horizontalSurfacePhysicalDeduplication": physical_deduplication,
        "physicallyIndistinguishableRowsCannotIncreaseLevelSupport": True,
        "exactDuplicateRowsCannotIncreaseLevelSupport": True,
        "supportCount": selected.support_count,
        "supportFraction": selected.support_fraction,
        **extraction,
        "horizontalFootprint": {
            "method": "largest unambiguous connected compact-triangle surface selected by physical area; wall contacts come from accepted vertices plus only a bounded same-component rejected-sliver collar, while cross-component gaps remain disconnected; the parallel-wall anchor is the accepted-area centroid; fixed absolute gate with no global radial prefilter, no global XY grid, and no cross-mode threshold",
            "authoritativeMinimumAreaSquareMeters": config.horizontal_level_min_footprint_area_m2,
            "authoritativeGateIndependentOfOtherModeAreas": True,
            "totalCandidateFootprintAreaSquareMeters": total_mode_footprint_area_m2,
            "largestCandidateFootprintAreaSquareMeters": largest_mode_footprint_area_m2,
            "minimumAbsoluteOrRoleFractionFootprintAreaSquareMetersSensitivityOnly": minimum_absolute_or_role_fraction_area_m2,
            "minimumRelativeToLargestCandidateFootprintAreaSquareMetersSensitivityOnly": minimum_relative_footprint_area_m2,
        },
        "wallBoundaryEvidence": wall_evidence,
        "endpointToleranceMeters": endpoint_tolerance_m,
        "hardMaximumEndpointToleranceMeters": config.horizontal_level_max_wall_endpoint_tolerance_m,
        "wallContactToleranceMeters": wall_contact_tolerance_m,
        "minimumWallContactPoints": config.horizontal_level_min_wall_contact_points,
        "minimumWallContactTotalCoverageMeters": config.horizontal_level_min_wall_contact_total_coverage_m,
        "minimumWallContactContiguousCoverageMeters": config.horizontal_level_min_wall_contact_contiguous_coverage_m,
        "supportedDistinctLevels": candidate_evidence,
        "reportedBoundarySupportedBandIndexes": qualified_indexes,
        "reportedBoundarySupportedBandMeters": sorted(
            float(modes[index].level_m) for index in qualified_indexes
        ),
        "selectedDistinctLevelIndex": selected_index,
        "levelMeters": selected.level_m,
        "medianAbsoluteDeviationMeters": selected.median_absolute_deviation_m,
        "p95AbsoluteResidualMeters": selected.p95_absolute_residual_m,
        "selectionLeakageControls": {
            "otherSourceHeightUsed": False,
            "validationGeometryUsed": False,
            "frozenTestGeometryUsed": False,
        },
    }


def extract_structural_inventory(
    surface_set: SurfaceSet,
    *,
    config: StructuralConfig,
    np: Any,
) -> tuple[StructuralInventory, dict[str, Any]]:
    """Extract deterministic, distinct vertical planes and horizontal levels."""

    if not isinstance(config, StructuralConfig):
        fail("INVALID_PLANE_CONFIG", "structural extraction config has the wrong type")
    if (
        not _is_finite_real(config.plane_normal_min_abs_dot)
        or not 0.0 < config.plane_normal_min_abs_dot <= 1.0
        or not _is_finite_real(config.plane_max_point_residual_m)
        or config.plane_max_point_residual_m <= 0.0
        or not _is_integer_at_least(config.plane_min_support_count, 4)
        or not _is_finite_real(config.plane_min_support_fraction)
        or not 0.0 <= config.plane_min_support_fraction < 1.0
        or not _is_integer_at_least(config.plane_seed_limit, 4)
        or not _is_integer_at_least(config.plane_max_count, 2)
        or not _is_finite_real(config.horizontal_level_point_dedup_tolerance_m)
        or config.horizontal_level_point_dedup_tolerance_m <= 0.0
        or not _is_finite_real(config.metric_boundary_comparison_epsilon_m)
        or config.metric_boundary_comparison_epsilon_m < 0.0
    ):
        fail("INVALID_PLANE_CONFIG", "wall-plane extraction thresholds are invalid")
    raw_surface_count = int(surface_set.points.shape[0])
    surface_row_keys = np.column_stack(
        (
            surface_set.points,
            surface_set.normals,
            np.asarray(surface_set.labels, dtype=np.float64),
        )
    )
    _unique_keys, working_to_original_indexes, inverse_surface_rows = np.unique(
        surface_row_keys,
        axis=0,
        return_index=True,
        return_inverse=True,
    )
    deduplicated_weights = np.full(
        working_to_original_indexes.size, -np.inf, dtype=np.float64
    )
    np.maximum.at(
        deduplicated_weights,
        inverse_surface_rows,
        np.asarray(surface_set.weights, dtype=np.float64),
    )
    surface_set = SurfaceSet(
        np.asarray(surface_set.points)[working_to_original_indexes],
        np.asarray(surface_set.normals)[working_to_original_indexes],
        np.asarray(surface_set.labels)[working_to_original_indexes],
        deduplicated_weights,
    )
    wall_surface_indexes = np.flatnonzero(surface_set.labels == LABEL_WALL)
    raw_wall_surface_count_after_exact_row_deduplication = int(
        wall_surface_indexes.size
    )
    if wall_surface_indexes.size < max(2 * config.plane_min_support_count, 8):
        fail("INSUFFICIENT_DISTINCT_WALL_GEOMETRY", "too few wall surfaces remain for plane extraction")
    wall_points = surface_set.points[wall_surface_indexes]
    wall_normals_xy = surface_set.normals[wall_surface_indexes, :2].astype(np.float64, copy=True)
    xy_norms = np.linalg.norm(wall_normals_xy, axis=1)
    if np.any(xy_norms <= 1e-12) or not np.all(np.isfinite(xy_norms)):
        fail("INVALID_WALL_NORMALS", "classified wall normals lack a usable XY direction")
    wall_normals_xy /= xy_norms[:, None]
    flip = (wall_normals_xy[:, 0] < -1e-12) | (
        (np.abs(wall_normals_xy[:, 0]) <= 1e-12) & (wall_normals_xy[:, 1] < 0.0)
    )
    wall_normals_xy[flip] *= -1.0
    (
        physical_wall_representatives,
        physical_wall_points,
        physical_wall_normals_xy,
        physical_wall_deduplication,
    ) = (
        _physical_wall_representative_indexes(
            wall_points,
            wall_normals_xy,
            distance_tolerance_m=config.horizontal_level_point_dedup_tolerance_m,
            comparison_epsilon_m=config.metric_boundary_comparison_epsilon_m,
            minimum_normal_dot=config.plane_normal_min_abs_dot,
            np=np,
        )
    )
    wall_surface_indexes = wall_surface_indexes[physical_wall_representatives]
    wall_points = physical_wall_points
    wall_normals_xy = physical_wall_normals_xy
    if wall_surface_indexes.size < max(2 * config.plane_min_support_count, 8):
        fail(
            "INSUFFICIENT_DISTINCT_WALL_GEOMETRY",
            "too few physically distinct wall surfaces remain for plane extraction",
        )

    minimum_support = max(
        config.plane_min_support_count,
        int(
            math.ceil(
                float(np.unique(wall_points, axis=0).shape[0])
                * config.plane_min_support_fraction
            )
        ),
    )

    def unique_wall_position_rows(rows: Any) -> Any:
        _unique_points, unique_local_indexes = np.unique(
            wall_points[rows], axis=0, return_index=True
        )
        return rows[unique_local_indexes]

    remaining = np.ones(wall_surface_indexes.size, dtype=bool)
    extracted: list[WallPlanePatch] = []
    for _plane_number in range(config.plane_max_count):
        remaining_rows = np.flatnonzero(remaining)
        if remaining_rows.size < minimum_support:
            break
        # Seed selection is stable under input permutation because it starts
        # from a lexicographic ordering of geometric values.
        rem_points = wall_points[remaining_rows]
        rem_normals = wall_normals_xy[remaining_rows]
        seed_offsets = np.einsum("ni,ni->n", rem_points[:, :2], rem_normals)
        seed_angles = np.arctan2(rem_normals[:, 1], rem_normals[:, 0])
        order = np.lexsort(
            (
                rem_points[:, 2],
                rem_points[:, 1],
                rem_points[:, 0],
                seed_offsets,
                seed_angles,
            )
        )
        if order.size > config.plane_seed_limit:
            seed_positions = np.linspace(
                0, order.size - 1, config.plane_seed_limit, dtype=np.int64
            )
            seed_rows = remaining_rows[order[seed_positions]]
        else:
            seed_rows = remaining_rows[order]

        best_rows: Any | None = None
        best_key: tuple[Any, ...] | None = None
        for seed_row in seed_rows:
            normal = wall_normals_xy[seed_row]
            offset = float(normal @ wall_points[seed_row, :2])
            agreement = np.abs(wall_normals_xy[remaining_rows] @ normal)
            residual = np.abs(wall_points[remaining_rows, :2] @ normal - offset)
            local_keep = (agreement >= config.plane_normal_min_abs_dot) & (
                residual <= config.plane_max_point_residual_m
            )
            candidate_rows = unique_wall_position_rows(
                remaining_rows[local_keep]
            )
            count = int(candidate_rows.size)
            if count < minimum_support:
                continue
            kept_residual = np.abs(
                wall_points[candidate_rows, :2] @ normal - offset
            )
            key = (
                -count,
                float(np.median(kept_residual)),
                float(math.atan2(float(normal[1]), float(normal[0]))),
                offset,
            )
            if best_key is None or key < best_key:
                best_key = key
                best_rows = candidate_rows
        if best_rows is None:
            break

        # Two deterministic refit/reassignment passes make the seed tolerance
        # an acquisition aid rather than the reported plane equation.
        plane_rows = best_rows
        assigned_rows_all = best_rows
        normal = wall_normals_xy[int(plane_rows[0])]
        offset = float(normal @ wall_points[int(plane_rows[0]), :2])
        for _refit in range(2):
            xy = wall_points[plane_rows, :2]
            center = np.mean(xy, axis=0)
            covariance = (xy - center).T @ (xy - center) / float(xy.shape[0])
            eigenvalues, eigenvectors = np.linalg.eigh(covariance)
            if not np.all(np.isfinite(eigenvalues)) or float(eigenvalues[1]) <= 1e-12:
                plane_rows = np.asarray([], dtype=np.int64)
                break
            normal = eigenvectors[:, 0]
            offset = float(np.median(xy @ normal))
            normal, offset = _canonical_xy_plane(normal, offset, np=np)
            agreement = np.abs(wall_normals_xy[remaining_rows] @ normal)
            residual = np.abs(wall_points[remaining_rows, :2] @ normal - offset)
            local_keep = (agreement >= config.plane_normal_min_abs_dot) & (
                residual <= config.plane_max_point_residual_m
            )
            assigned_rows_all = remaining_rows[local_keep]
            plane_rows = unique_wall_position_rows(assigned_rows_all)
            if plane_rows.size < minimum_support:
                break
        if plane_rows.size < minimum_support:
            break
        residual = np.abs(wall_points[plane_rows, :2] @ normal - offset)
        patch_points = wall_points[plane_rows]
        tangent = np.asarray([-normal[1], normal[0]], dtype=np.float64)
        tangent_values = patch_points[:, :2] @ tangent
        cells = _plane_occupancy_cells(
            patch_points,
            normal,
            config.plane_occupancy_cell_m,
            comparison_epsilon_m=config.metric_boundary_comparison_epsilon_m,
            np=np,
        )
        extracted.append(
            WallPlanePatch(
                plane_id=-1,
                normal_xy=normal,
                offset_m=float(offset),
                point_indices=working_to_original_indexes[
                    wall_surface_indexes[plane_rows]
                ],
                support_count=int(plane_rows.size),
                support_area_proxy_m2=float(
                    max(len(cells), 1) * config.plane_occupancy_cell_m**2
                ),
                tangent_range_m=(float(np.min(tangent_values)), float(np.max(tangent_values))),
                tangent_segments=_wall_tangent_segments(
                    patch_points,
                    tangent_values,
                    config=config,
                    np=np,
                ),
                z_range_m=(float(np.min(patch_points[:, 2])), float(np.max(patch_points[:, 2]))),
                robust_z_range_m=tuple(
                    float(value)
                    for value in np.percentile(
                        patch_points[:, 2],
                        [
                            100.0 * config.horizontal_level_wall_endpoint_trim_fraction,
                            100.0
                            * (1.0 - config.horizontal_level_wall_endpoint_trim_fraction),
                        ],
                        method="linear",
                    )
                ),
                occupied_cells=cells,
                residual_median_m=float(np.median(residual)),
                residual_p95_m=float(np.percentile(residual, 95, method="linear")),
            )
        )
        remaining[assigned_rows_all] = False

    if len(extracted) < 2:
        fail("INSUFFICIENT_DISTINCT_WALL_GEOMETRY", "fewer than two distinct wall planes were extracted")
    extracted.sort(
        key=lambda plane: (
            math.atan2(float(plane.normal_xy[1]), float(plane.normal_xy[0])),
            plane.offset_m,
            -plane.support_count,
        )
    )
    planes = tuple(replace(plane, plane_id=index) for index, plane in enumerate(extracted))

    horizontal_levels: dict[int, tuple[float, float]] = {}
    horizontal_level_evidence: dict[str, Any] = {}
    for label in (LABEL_FLOOR, LABEL_CEILING):
        class_mask = surface_set.labels == label
        horizontal_points = surface_set.points[class_mask]
        if horizontal_points.shape[0] < MIN_SURFACES_PER_CLASS:
            fail("MISSING_STRUCTURAL_CLASS", "floor and ceiling levels are required for plane fitting")
        role = LABEL_NAMES[label]
        level, mad, level_evidence = _select_room_envelope_level(
            horizontal_points,
            surface_set.weights[class_mask],
            planes,
            role=role,
            allow_multiple_ceiling_levels=label == LABEL_CEILING,
            config=config,
            np=np,
        )
        horizontal_levels[label] = (level, mad)
        horizontal_level_evidence[role] = level_evidence
    floor_z, floor_mad = horizontal_levels[LABEL_FLOOR]
    ceiling_z, ceiling_mad = horizontal_levels[LABEL_CEILING]
    ceiling_evidence = horizontal_level_evidence["ceiling"]
    ceiling_candidates = ceiling_evidence["supportedDistinctLevels"]
    ceiling_reported_indexes = ceiling_evidence["reportedBoundarySupportedBandIndexes"]
    ceiling_reported_bands = tuple(
        sorted(float(ceiling_candidates[index]["levelMeters"]) for index in ceiling_reported_indexes)
    )
    ceiling_reported_band_mads = tuple(
        float(
            next(
                candidate["medianAbsoluteDeviationMeters"]
                for candidate in ceiling_candidates
                if float(candidate["levelMeters"]) == level
            )
        )
        for level in ceiling_reported_bands
    )
    if not ceiling_reported_bands or ceiling_z != ceiling_reported_bands[-1]:
        fail("INVALID_CEILING_ENVELOPE", "highest ceiling envelope and reported bands disagree")
    if ceiling_z <= floor_z:
        fail("DEGENERATE_ZUP_HEIGHT", "ceiling level must be above floor level")
    inventory = StructuralInventory(
        wall_planes=planes,
        floor_z_m=floor_z,
        ceiling_z_m=ceiling_z,
        floor_level_mad_m=floor_mad,
        ceiling_level_mad_m=ceiling_mad,
        ceiling_levels_m=ceiling_reported_bands,
        ceiling_level_mads_m=ceiling_reported_band_mads,
        unassigned_wall_fraction=float(np.mean(remaining)),
    )
    return inventory, {
        "rawInputSurfaceCount": raw_surface_count,
        "inventoryInputSurfaceCountAfterExactRowDeduplication": int(
            surface_set.points.shape[0]
        ),
        "exactDuplicateSurfaceRowsRemovedBeforeStructuralSupport": int(
            raw_surface_count - surface_set.points.shape[0]
        ),
        "exactDuplicateRowsCannotIncreasePlaneOrLevelSupport": True,
        "wallPlaneSupportUsesUniquePhysicalXYZPositions": True,
        "rawWallSurfaceCountAfterExactRowDeduplication": (
            raw_wall_surface_count_after_exact_row_deduplication
        ),
        "wallSurfacePhysicalDeduplication": physical_wall_deduplication,
        "physicallyIndistinguishableWallRowsCannotIncreasePlaneSupport": True,
        "wallPlaneCount": len(planes),
        "unassignedWallSurfaceFraction": inventory.unassigned_wall_fraction,
        "floorZMeters": floor_z,
        "ceilingZMeters": ceiling_z,
        "reportedBoundarySupportedCeilingBandsMeters": list(ceiling_reported_bands),
        "highestBoundarySupportedCeilingZMeters": ceiling_z,
        "roomHeightMeters": ceiling_z - floor_z,
        "horizontalLevels": horizontal_level_evidence,
        "planes": [
            {
                "planeId": plane.plane_id,
                "normalXY": [float(value) for value in plane.normal_xy],
                "offsetMeters": plane.offset_m,
                "supportCount": plane.support_count,
                "occupiedCellCount": len(plane.occupied_cells),
                "residualP95Meters": plane.residual_p95_m,
            }
            for plane in planes
        ],
    }


def _validate_plane_matching_config(config: StructuralConfig) -> None:
    """Reject malformed matching thresholds before numerical work begins."""

    if not isinstance(config, StructuralConfig):
        fail("INVALID_PLANE_CONFIG", "plane matching config has the wrong type")
    float_fields = (
        "maximum_abs_coordinate_m",
        "plane_max_point_residual_m",
        "plane_max_height_mismatch_m",
        "metric_boundary_comparison_epsilon_m",
        "angular_boundary_comparison_epsilon",
        "plane_min_pair_angle_degrees",
        "plane_hypothesis_normal_tolerance_degrees",
        "plane_match_normal_tolerance_degrees",
        "plane_match_max_offset_m",
        "plane_occupancy_cell_m",
    )
    values: dict[str, float] = {}
    for field in float_fields:
        raw_value = getattr(config, field)
        if not _is_finite_real(raw_value):
            fail("INVALID_PLANE_CONFIG", f"{field} must be a finite real number")
        try:
            values[field] = float(raw_value)
        except (TypeError, ValueError, OverflowError):
            fail("INVALID_PLANE_CONFIG", f"{field} must be a finite real number")
    try:
        dilation = operator.index(config.plane_occupancy_dilation_cells)
        minimum_cells = operator.index(config.plane_min_occupied_cells)
        maximum_planes = operator.index(config.plane_max_count)
    except TypeError:
        fail(
            "INVALID_PLANE_CONFIG",
            "plane occupancy dilation, minimum cell count, and maximum plane count must be integers",
        )
    if isinstance(config.plane_occupancy_dilation_cells, bool) or isinstance(
        config.plane_min_occupied_cells, bool
    ) or isinstance(
        config.plane_max_count, bool
    ):
        fail(
            "INVALID_PLANE_CONFIG",
            "plane occupancy dilation, minimum cell count, and maximum plane count cannot be booleans",
        )
    if (
        values["maximum_abs_coordinate_m"] <= 0.0
        or values["maximum_abs_coordinate_m"] > 1_000_000.0
        or values["plane_max_point_residual_m"] <= 0.0
        or values["plane_max_height_mismatch_m"] <= 0.0
        or values["metric_boundary_comparison_epsilon_m"] < 0.0
        or values["angular_boundary_comparison_epsilon"] < 0.0
        or not 1.0 <= values["plane_min_pair_angle_degrees"] <= 90.0
        or not 0.0
        <= values["plane_hypothesis_normal_tolerance_degrees"]
        < 90.0
        or not 0.0
        <= values["plane_match_normal_tolerance_degrees"]
        < 90.0
        or values["plane_match_max_offset_m"] <= 0.0
        or values["plane_occupancy_cell_m"] < 1e-6
        or not 0 <= dilation <= 16
        or minimum_cells < 1
        or not 2 <= maximum_planes <= 16
        or values["plane_max_point_residual_m"]
        > values["maximum_abs_coordinate_m"]
        or values["plane_max_height_mismatch_m"]
        > values["maximum_abs_coordinate_m"]
        or values["plane_match_max_offset_m"]
        > values["maximum_abs_coordinate_m"]
        or values["plane_occupancy_cell_m"]
        > values["maximum_abs_coordinate_m"]
    ):
        fail(
            "INVALID_PLANE_CONFIG",
            "plane matching thresholds are out of range; the coordinate domain must be at most one million metres, independent wall pairs need at least one degree of separation, occupancy cells at least one micrometre, and dilation at most 16 cells",
        )
    minimum_cross = math.sin(
        math.radians(values["plane_min_pair_angle_degrees"])
    )
    if values["angular_boundary_comparison_epsilon"] > 0.01 * minimum_cross:
        fail(
            "INVALID_PLANE_CONFIG",
            "angular comparison epsilon cannot erase the independent-wall threshold",
        )
    minimum_physical_threshold_m = min(
        values["plane_max_point_residual_m"],
        values["plane_max_height_mismatch_m"],
        values["plane_match_max_offset_m"],
        values["plane_occupancy_cell_m"],
    )
    if values["metric_boundary_comparison_epsilon_m"] > 0.01 * minimum_physical_threshold_m:
        fail(
            "INVALID_PLANE_CONFIG",
            "metric comparison epsilon cannot erase a physical plane threshold",
        )


def _validate_plane_matching_inventory(
    inventory: StructuralInventory,
    role: str,
    *,
    config: StructuralConfig,
    error_code: str,
    np: Any,
) -> None:
    """Validate envelope and plane equations used to create or score a fit."""

    if not isinstance(inventory, StructuralInventory):
        fail(error_code, f"{role} plane inventory has the wrong type")
    scalar_rows = {
        "floor": inventory.floor_z_m,
        "ceiling": inventory.ceiling_z_m,
        "floor MAD": inventory.floor_level_mad_m,
        "ceiling MAD": inventory.ceiling_level_mad_m,
        "unassigned wall fraction": inventory.unassigned_wall_fraction,
    }
    normalized_scalars: dict[str, float] = {}
    for name, raw_value in scalar_rows.items():
        if not _is_finite_real(raw_value):
            fail(error_code, f"{role} {name} must be a finite real number")
        try:
            normalized_scalars[name] = float(raw_value)
        except (TypeError, ValueError, OverflowError):
            fail(error_code, f"{role} {name} must be a finite real number")
    floor_z = normalized_scalars["floor"]
    ceiling_z = normalized_scalars["ceiling"]
    floor_mad = normalized_scalars["floor MAD"]
    ceiling_mad = normalized_scalars["ceiling MAD"]
    unassigned_fraction = normalized_scalars["unassigned wall fraction"]
    if (
        not math.isfinite(ceiling_z - floor_z)
        or ceiling_z <= floor_z
        or floor_mad < 0.0
        or ceiling_mad < 0.0
        or not 0.0 <= unassigned_fraction <= 1.0
        or max(abs(floor_z), abs(ceiling_z)) > config.maximum_abs_coordinate_m
    ):
        fail(error_code, f"{role} envelope scalars are out of range")
    try:
        raw_ceiling_levels = tuple(inventory.ceiling_levels_m)
        raw_ceiling_mads = tuple(inventory.ceiling_level_mads_m)
        if any(
            isinstance(value, bool) or not isinstance(value, numbers.Real)
            for value in raw_ceiling_levels + raw_ceiling_mads
        ):
            raise TypeError
        ceiling_levels = tuple(float(value) for value in raw_ceiling_levels)
        ceiling_mads = tuple(float(value) for value in raw_ceiling_mads)
    except (TypeError, ValueError, OverflowError):
        fail(error_code, f"{role} ceiling evidence must be finite numeric sequences")
    if (
        not ceiling_levels
        or len(ceiling_levels) != len(ceiling_mads)
        or any(not math.isfinite(value) for value in ceiling_levels + ceiling_mads)
        or any(value < 0.0 for value in ceiling_mads)
        or any(
            second <= first
            for first, second in zip(
                ceiling_levels, ceiling_levels[1:]
            )
        )
        or any(
            level <= floor_z
            or level
            > ceiling_z
            + config.metric_boundary_comparison_epsilon_m
            for level in ceiling_levels
        )
        or abs(ceiling_levels[-1] - ceiling_z)
        > config.metric_boundary_comparison_epsilon_m
    ):
        fail(error_code, f"{role} ceiling evidence is incomplete or inconsistent")
    planes = inventory.wall_planes
    if (
        not isinstance(planes, tuple)
        or not 2 <= len(planes) <= operator.index(config.plane_max_count)
    ):
        fail(
            error_code,
            f"{role} inventory needs from two through {operator.index(config.plane_max_count)} wall planes",
        )
    plane_ids: set[int] = set()
    normalized_rows: list[tuple[Any, float]] = []
    for plane_index, plane in enumerate(planes):
        if not isinstance(plane, WallPlanePatch):
            fail(error_code, f"{role} plane {plane_index} has the wrong type")
        if isinstance(plane.plane_id, bool):
            fail(error_code, f"{role} plane IDs must be integers")
        try:
            plane_id = operator.index(plane.plane_id)
        except TypeError:
            fail(error_code, f"{role} plane IDs must be integers")
        if plane_id in plane_ids:
            fail(error_code, f"{role} plane IDs must be unique")
        plane_ids.add(plane_id)
        try:
            raw_normal = np.asarray(plane.normal_xy)
            if (
                raw_normal.shape != (2,)
                or not np.issubdtype(raw_normal.dtype, np.number)
                or np.issubdtype(raw_normal.dtype, np.bool_)
                or np.issubdtype(raw_normal.dtype, np.complexfloating)
                or isinstance(plane.offset_m, bool)
                or not isinstance(plane.offset_m, numbers.Real)
                or isinstance(plane.support_area_proxy_m2, bool)
                or not isinstance(plane.support_area_proxy_m2, numbers.Real)
            ):
                raise TypeError
            normal = np.asarray(raw_normal, dtype=np.float64)
            offset = float(plane.offset_m)
            area = float(plane.support_area_proxy_m2)
        except (TypeError, ValueError, OverflowError):
            fail(
                error_code,
                f"{role} plane {plane_index} needs a finite unit normal, an offset inside the declared coordinate-domain precision limit, and positive bounded support area",
            )
        if (
            normal.shape != (2,)
            or not np.all(np.isfinite(normal))
            or abs(float(np.linalg.norm(normal)) - 1.0) > 1e-6
            or not math.isfinite(offset)
            or not math.isfinite(area)
            or area <= 0.0
            or abs(offset)
            > math.sqrt(2.0) * config.maximum_abs_coordinate_m
            + config.plane_max_point_residual_m
            or area > (2.0 * config.maximum_abs_coordinate_m) ** 2
        ):
            fail(
                error_code,
                f"{role} plane {plane_index} needs a finite unit normal, an offset inside the declared coordinate-domain precision limit, and positive bounded support area",
            )
        normalized_rows.append((normal, offset))
    for first_index, second_index in itertools.combinations(
        range(len(normalized_rows)), 2
    ):
        first_normal, first_offset = normalized_rows[first_index]
        second_normal, second_offset = normalized_rows[second_index]
        dot = float(first_normal @ second_normal)
        sign = 1.0 if dot >= 0.0 else -1.0
        signed_second_normal = sign * second_normal
        signed_second_offset = sign * second_offset
        if (
            np.array_equal(first_normal, signed_second_normal)
            and abs(first_offset - signed_second_offset)
            <= config.metric_boundary_comparison_epsilon_m
        ):
            fail(error_code, f"{role} inventory contains duplicate wall-plane equations")


def _deduplicate_plane_hypotheses_invariantly(
    raw_hypotheses: list[PlaneHypothesis],
    *,
    source_anchor_xy: Any,
    config: StructuralConfig,
    np: Any,
) -> tuple[list[PlaneHypothesis], dict[str, Any]]:
    """Collapse only bounded near-identical transforms without a global grid tie."""

    if not raw_hypotheses:
        return [], {
            "rawHypothesisCount": 0,
            "exactGeometryHypothesisCount": 0,
            "boundedNearDuplicateComponentCount": 0,
            "transitiveChainComponentCountRetainedWithoutCollapse": 0,
        }
    exact: dict[tuple[float, float, float, float], PlaneHypothesis] = {}
    for hypothesis in raw_hypotheses:
        values = (
            float(hypothesis.yaw_radians),
            float(hypothesis.translation[0]),
            float(hypothesis.translation[1]),
            float(hypothesis.translation[2]),
        )
        key = tuple(0.0 if value == 0.0 else value for value in values)
        previous = exact.get(key)
        tie_key = (
            hypothesis.source_seed_plane_ids,
            hypothesis.target_seed_plane_ids,
        )
        previous_tie_key = (
            previous.source_seed_plane_ids,
            previous.target_seed_plane_ids,
        ) if previous is not None else None
        if previous is None or tie_key < previous_tie_key:
            exact[key] = hypothesis
    candidates = sorted(
        exact.values(),
        key=lambda row: (
            row.yaw_radians,
            float(row.translation[0]),
            float(row.translation[1]),
            float(row.translation[2]),
            row.source_seed_plane_ids,
            row.target_seed_plane_ids,
        ),
    )
    metric_tolerance_m = 0.005
    yaw_tolerance_radians = math.radians(0.05)
    mapped_anchors = np.vstack(
        [
            yaw_rotation(hypothesis.yaw_radians, np)[:2, :2]
            @ source_anchor_xy
            + hypothesis.translation[:2]
            for hypothesis in candidates
        ]
    )
    if not np.all(np.isfinite(mapped_anchors)):
        fail(
            "INVALID_PLANE_HYPOTHESIS_INPUT",
            "mapped hypothesis anchors must be finite",
        )
    parent = list(range(len(candidates)))
    component_size = [1] * len(candidates)

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def unite(first: int, second: int) -> None:
        first_root = find(first)
        second_root = find(second)
        if first_root == second_root:
            return
        if component_size[first_root] < component_size[second_root]:
            first_root, second_root = second_root, first_root
        parent[second_root] = first_root
        component_size[first_root] += component_size[second_root]

    def wrapped_yaw_distance(first: float, second: float) -> float:
        return abs((first - second + math.pi) % (2.0 * math.pi) - math.pi)

    # The hash is only a candidate-search accelerator.  Its cells must be at
    # least as wide as the complete comparison threshold, including the
    # explicit boundary epsilon; otherwise two accepted neighbours can land
    # two cells apart and the absolute grid origin changes the result.
    metric_search_cell_m = (
        metric_tolerance_m + config.metric_boundary_comparison_epsilon_m
    )
    yaw_search_tolerance_radians = (
        yaw_tolerance_radians + config.angular_boundary_comparison_epsilon
    )
    yaw_bin_count = max(
        1, int(math.floor(2.0 * math.pi / yaw_search_tolerance_radians))
    )
    yaw_search_cell_radians = 2.0 * math.pi / yaw_bin_count
    buckets: dict[tuple[int, int, int, int], list[int]] = {}
    for candidate_index, hypothesis in enumerate(candidates):
        anchor = mapped_anchors[candidate_index]
        yaw_bin = int(
            math.floor(
                ((hypothesis.yaw_radians + math.pi) % (2.0 * math.pi))
                / (2.0 * math.pi)
                * yaw_bin_count
            )
        ) % yaw_bin_count
        bucket = (
            int(math.floor(float(anchor[0]) / metric_search_cell_m)),
            int(math.floor(float(anchor[1]) / metric_search_cell_m)),
            int(
                math.floor(
                    float(hypothesis.translation[2]) / metric_search_cell_m
                )
            ),
            yaw_bin,
        )
        for delta_x in (-1, 0, 1):
            for delta_y in (-1, 0, 1):
                for delta_z in (-1, 0, 1):
                    for delta_yaw in (-1, 0, 1):
                        neighbour_bucket = (
                            bucket[0] + delta_x,
                            bucket[1] + delta_y,
                            bucket[2] + delta_z,
                            (bucket[3] + delta_yaw) % yaw_bin_count,
                        )
                        for previous_index in buckets.get(neighbour_bucket, ()):
                            previous = candidates[previous_index]
                            if (
                                math.dist(
                                    tuple(float(value) for value in anchor),
                                    tuple(
                                        float(value)
                                        for value in mapped_anchors[previous_index]
                                    ),
                                )
                                <= metric_tolerance_m
                                + config.metric_boundary_comparison_epsilon_m
                                and abs(
                                    float(hypothesis.translation[2])
                                    - float(previous.translation[2])
                                )
                                <= metric_tolerance_m
                                + config.metric_boundary_comparison_epsilon_m
                                and wrapped_yaw_distance(
                                    hypothesis.yaw_radians,
                                    previous.yaw_radians,
                                )
                                <= yaw_tolerance_radians
                                + config.angular_boundary_comparison_epsilon
                            ):
                                unite(candidate_index, previous_index)
        buckets.setdefault(bucket, []).append(candidate_index)
    components: dict[int, list[int]] = {}
    for candidate_index in range(len(candidates)):
        components.setdefault(find(candidate_index), []).append(candidate_index)
    retained_indexes: list[int] = []
    bounded_component_count = 0
    transitive_chain_count = 0
    medoid_tie_component_count = 0
    for component in components.values():
        if len(component) == 1:
            retained_indexes.extend(component)
            continue
        if len(component) > 512:
            fail(
                "TOO_MANY_DISTINCT_PLANE_HYPOTHESES",
                "one near-duplicate hypothesis group exceeds the finite 512-candidate audit cap",
            )
        bounded = True
        pair_costs: dict[tuple[int, int], float] = {}
        for first_index, second_index in itertools.combinations(component, 2):
            anchor_distance = math.dist(
                tuple(float(value) for value in mapped_anchors[first_index]),
                tuple(float(value) for value in mapped_anchors[second_index]),
            )
            z_distance = abs(
                float(candidates[first_index].translation[2])
                - float(candidates[second_index].translation[2])
            )
            yaw_distance = wrapped_yaw_distance(
                candidates[first_index].yaw_radians,
                candidates[second_index].yaw_radians,
            )
            if (
                anchor_distance
                > metric_tolerance_m
                + config.metric_boundary_comparison_epsilon_m
                or z_distance
                > metric_tolerance_m
                + config.metric_boundary_comparison_epsilon_m
                or yaw_distance
                > yaw_tolerance_radians
                + config.angular_boundary_comparison_epsilon
            ):
                bounded = False
                break
            pair_costs[(first_index, second_index)] = (
                (anchor_distance / metric_tolerance_m) ** 2
                + (z_distance / metric_tolerance_m) ** 2
                + (yaw_distance / yaw_tolerance_radians) ** 2
            )
        if not bounded:
            transitive_chain_count += 1
            retained_indexes.extend(component)
            continue
        bounded_component_count += 1
        costs = {
            candidate_index: math.fsum(
                pair_costs[tuple(sorted((candidate_index, other_index)))]
                for other_index in component
                if other_index != candidate_index
            )
            for candidate_index in component
        }
        minimum_cost = min(costs.values())
        medoids = [
            candidate_index
            for candidate_index, cost in costs.items()
            if abs(cost - minimum_cost) <= 1e-15
        ]
        if len(medoids) > 1:
            medoid_tie_component_count += 1
        retained_indexes.extend(medoids)
    result = sorted(
        (candidates[index] for index in set(retained_indexes)),
        key=lambda row: (
            row.yaw_radians,
            float(row.translation[0]),
            float(row.translation[1]),
            float(row.translation[2]),
            row.source_seed_plane_ids,
            row.target_seed_plane_ids,
        ),
    )
    return result, {
        "rawHypothesisCount": len(raw_hypotheses),
        "exactGeometryHypothesisCount": len(candidates),
        "boundedNearDuplicateComponentCount": bounded_component_count,
        "transitiveChainComponentCountRetainedWithoutCollapse": transitive_chain_count,
        "boundedComponentMedoidTieCountRetainedAsNonunique": medoid_tie_component_count,
        "mappedSourceAnchorComparisonToleranceMeters": metric_tolerance_m,
        "yawComparisonToleranceDegrees": math.degrees(yaw_tolerance_radians),
        "candidateSearchMetricCellWidthMeters": metric_search_cell_m,
        "candidateSearchYawCellWidthDegrees": math.degrees(
            yaw_search_cell_radians
        ),
        "candidateSearchNeighbourRadiusCellsPerDimension": 1,
        "candidateSearchCellWidthsIncludeBoundaryComparisonEpsilon": True,
        "absoluteWorldTranslationQuantizationUsed": False,
        "candidateSearchGridDefinesGeometry": False,
        "candidateSearchGridChecksAllNeighbourCellsThenExplicitInvariantDistances": True,
    }


def generate_plane_pair_hypotheses(
    source: StructuralInventory,
    target: StructuralInventory,
    *,
    mirrored: bool,
    config: StructuralConfig,
    np: Any,
) -> tuple[list[PlaneHypothesis], dict[str, Any]]:
    """Generate fixed-scale +Z-up transforms from two nonparallel wall planes."""

    _validate_plane_matching_config(config)
    if not isinstance(mirrored, bool):
        fail(
            "INVALID_PLANE_HYPOTHESIS_INPUT",
            "mirrored hypothesis family flag must be boolean",
        )
    _validate_plane_matching_inventory(
        source,
        "source",
        config=config,
        error_code="INVALID_PLANE_HYPOTHESIS_INPUT",
        np=np,
    )
    _validate_plane_matching_inventory(
        target,
        "target",
        config=config,
        error_code="INVALID_PLANE_HYPOTHESIS_INPUT",
        np=np,
    )

    # Validation intentionally accepts ordinary finite numeric sequences.
    # Convert them once here and use only these normalized immutable copies in
    # generation math, so a list-valued unit normal cannot pass validation and
    # then fail later in NumPy/scalar arithmetic.
    def normalized_for_generation(
        inventory: StructuralInventory,
    ) -> StructuralInventory:
        return replace(
            inventory,
            wall_planes=tuple(
                replace(
                    plane,
                    normal_xy=np.asarray(plane.normal_xy, dtype=np.float64),
                    offset_m=float(plane.offset_m),
                    support_area_proxy_m2=float(plane.support_area_proxy_m2),
                )
                for plane in inventory.wall_planes
            ),
            floor_z_m=float(inventory.floor_z_m),
            ceiling_z_m=float(inventory.ceiling_z_m),
            floor_level_mad_m=float(inventory.floor_level_mad_m),
            ceiling_level_mad_m=float(inventory.ceiling_level_mad_m),
            ceiling_levels_m=tuple(
                float(value) for value in inventory.ceiling_levels_m
            ),
            ceiling_level_mads_m=tuple(
                float(value) for value in inventory.ceiling_level_mads_m
            ),
            unassigned_wall_fraction=float(inventory.unassigned_wall_fraction),
        )

    source = normalized_for_generation(source)
    target = normalized_for_generation(target)

    source_reported_ceiling_bands = tuple(
        float(level - source.floor_z_m) for level in source.ceiling_levels_m
    )
    target_reported_ceiling_bands = tuple(
        float(level - target.floor_z_m) for level in target.ceiling_levels_m
    )
    if not source_reported_ceiling_bands or not target_reported_ceiling_bands:
        fail("EMPTY_CEILING_LEVEL_EVIDENCE", "fixed-scale check requires a top ceiling envelope")
    source_height = float(source.ceiling_z_m - source.floor_z_m)
    target_height = float(target.ceiling_z_m - target.floor_z_m)
    top_envelope_height_difference = abs(target_height - source_height)
    noise_indicator = 3.0 * (
        source.floor_level_mad_m
        + target.floor_level_mad_m
        + max(source.ceiling_level_mads_m)
        + max(target.ceiling_level_mads_m)
    )
    if (
        top_envelope_height_difference
        > config.plane_max_height_mismatch_m
        + config.metric_boundary_comparison_epsilon_m
    ):
        fail(
            "FIXED_SCALE_HEIGHT_MISMATCH",
            "source and target floor-to-top-ceiling envelope heights disagree beyond the hard fixed-scale cap: "
            f"difference={top_envelope_height_difference:.6f} m, "
            f"cap={config.plane_max_height_mismatch_m:.6f} m",
        )
    tz = target.floor_z_m - source.floor_z_m
    minimum_cross = math.sin(math.radians(config.plane_min_pair_angle_degrees))
    normal_tolerance = math.radians(config.plane_hypothesis_normal_tolerance_degrees)
    raw_hypotheses: list[PlaneHypothesis] = []
    source_unordered_pairs = [
        pair
        for pair in itertools.combinations(source.wall_planes, 2)
        if abs(
            float(
                pair[0].normal_xy[0] * pair[1].normal_xy[1]
                - pair[0].normal_xy[1] * pair[1].normal_xy[0]
            )
        )
        + config.angular_boundary_comparison_epsilon
        >= minimum_cross
    ]
    # The first plane is aligned exactly and the second plane is checked
    # against the angular tolerance.  Both source orders are therefore
    # geometrically meaningful when the two fitted plane angles differ
    # slightly.  Enumerating both prevents tuple order (including the order
    # change caused by canonical normals crossing +/-90 degrees under a rigid
    # rotation) from steering the candidate set.
    source_pairs = [
        ordered_pair
        for first, second in source_unordered_pairs
        for ordered_pair in ((first, second), (second, first))
    ]
    target_pairs = [
        pair
        for pair in itertools.permutations(target.wall_planes, 2)
        if pair[0].plane_id != pair[1].plane_id
        and abs(
            float(
                pair[0].normal_xy[0] * pair[1].normal_xy[1]
                - pair[0].normal_xy[1] * pair[1].normal_xy[0]
            )
        )
        + config.angular_boundary_comparison_epsilon
        >= minimum_cross
    ]
    if not source_unordered_pairs or not target_pairs:
        fail(
            "INSUFFICIENT_DISTINCT_WALL_GEOMETRY",
            "two nonparallel wall planes are required in both sources",
        )
    source_pair_intersections = [
        np.linalg.solve(
            np.vstack((first.normal_xy, second.normal_xy)),
            np.asarray([first.offset_m, second.offset_m], dtype=np.float64),
        )
        for first, second in source_unordered_pairs
    ]
    source_anchor_xy = np.asarray(
        [
            math.fsum(
                sorted(
                    float(intersection[axis]) / len(source_pair_intersections)
                    for intersection in source_pair_intersections
                )
            )
            for axis in range(2)
        ],
        dtype=np.float64,
    )
    if not np.all(np.isfinite(source_anchor_xy)):
        fail(
            "INVALID_PLANE_HYPOTHESIS_INPUT",
            "source plane intersections do not define a finite equivariant anchor",
        )
    for source_first, source_second in source_pairs:
        for target_first, target_second in target_pairs:
            for target_first_sign in (-1.0, 1.0):
                signed_first_normal = target_first_sign * target_first.normal_xy
                signed_first_offset = target_first_sign * target_first.offset_m
                numerator = float(
                    source_first.normal_xy[0] * signed_first_normal[1]
                    - source_first.normal_xy[1] * signed_first_normal[0]
                )
                denominator = float(source_first.normal_xy @ signed_first_normal)
                yaw_angle = math.atan2(numerator, denominator)
                yaw_xy = yaw_rotation(yaw_angle, np)[:2, :2]
                mapped_second_normal = yaw_xy @ source_second.normal_xy
                second_dot = float(mapped_second_normal @ target_second.normal_xy)
                target_second_sign = 1.0 if second_dot >= 0.0 else -1.0
                signed_second_normal = target_second_sign * target_second.normal_xy
                signed_second_offset = target_second_sign * target_second.offset_m
                angular_residual = math.acos(
                    min(1.0, max(-1.0, float(mapped_second_normal @ signed_second_normal)))
                )
                if (
                    angular_residual
                    > normal_tolerance
                    + config.angular_boundary_comparison_epsilon
                ):
                    continue
                equations = np.vstack((signed_first_normal, signed_second_normal))
                if (
                    abs(float(np.linalg.det(equations)))
                    + config.angular_boundary_comparison_epsilon
                    < minimum_cross
                ):
                    continue
                source_equations = np.vstack(
                    (source_first.normal_xy, source_second.normal_xy)
                )
                source_intersection_xy = np.linalg.solve(
                    source_equations,
                    np.asarray(
                        [source_first.offset_m, source_second.offset_m],
                        dtype=np.float64,
                    ),
                )
                target_intersection_xy = np.linalg.solve(
                    equations,
                    np.asarray(
                        [signed_first_offset, signed_second_offset],
                        dtype=np.float64,
                    ),
                )
                translation_xy = (
                    target_intersection_xy
                    - yaw_xy @ source_intersection_xy
                )
                translation = np.asarray([translation_xy[0], translation_xy[1], tz], dtype=np.float64)
                wrapped_yaw = (yaw_angle + math.pi) % (2.0 * math.pi) - math.pi
                hypothesis = PlaneHypothesis(
                    yaw_radians=wrapped_yaw,
                    translation=translation,
                    source_seed_plane_ids=(source_first.plane_id, source_second.plane_id),
                    target_seed_plane_ids=(target_first.plane_id, target_second.plane_id),
                    mirrored=mirrored,
                )
                raw_hypotheses.append(hypothesis)
    if not raw_hypotheses:
        fail("NO_DISTINCT_PLANE_HYPOTHESIS", "no compatible two-plane transform hypothesis exists")
    result, hypothesis_deduplication = _deduplicate_plane_hypotheses_invariantly(
        raw_hypotheses,
        source_anchor_xy=source_anchor_xy,
        config=config,
        np=np,
    )
    return result, {
        "hypothesisCount": len(result),
        "hypothesisDeduplication": hypothesis_deduplication,
        "sourcePlaneIntersectionAnchorXYMeters": [
            float(value) for value in source_anchor_xy
        ],
        "sourceNonparallelPairCount": len(source_unordered_pairs),
        "sourceOrderedNonparallelPairCount": len(source_pairs),
        "bothSourcePairOrientationsEnumeratedForOrderInvariance": True,
        "targetOrderedNonparallelPairCount": len(target_pairs),
        "floorOnlyZTranslationMeters": float(tz),
        "xyTranslationMethod": "target plane-pair intersection minus yaw-rotated source plane-pair intersection",
        "zTranslationUsesCeilingLevels": False,
        "topCeilingEnvelopeUsedForFixedScaleCheck": True,
        "topCeilingEnvelopeRequiresStrictMultiwallBoundarySupport": True,
        "sourceFloorToTopCeilingEnvelopeHeightMeters": source_height,
        "targetFloorToTopCeilingEnvelopeHeightMeters": target_height,
        "topEnvelopeHeightDifferenceMeters": top_envelope_height_difference,
        "reportedSourceFloorRelativeBoundarySupportedCeilingBandsMeters": list(
            source_reported_ceiling_bands
        ),
        "reportedTargetFloorRelativeBoundarySupportedCeilingBandsMeters": list(
            target_reported_ceiling_bands
        ),
        "reportedLowerBandCountsMatch": (
            max(len(source_reported_ceiling_bands) - 1, 0)
            == max(len(target_reported_ceiling_bands) - 1, 0)
        ),
        "secondaryCeilingBandsUsedToAdmitRejectSteerOrRelaxTopCap": False,
        "hardMaximumHeightMismatchMeters": config.plane_max_height_mismatch_m,
        "metricBoundaryComparisonEpsilonMeters": config.metric_boundary_comparison_epsilon_m,
        "noiseIndicatorMetersReportedButCannotRelaxHardCap": noise_indicator,
        "floorCeilingXYUsedForYawOrXYTranslation": False,
    }


def _occupancy_bidirectional_coverage(
    source_cells: frozenset[tuple[int, int]],
    target_cells: frozenset[tuple[int, int]],
    dilation: int,
) -> tuple[float, float, float]:
    if not source_cells or not target_cells:
        return 0.0, 0.0, 0.0

    def covered(query: frozenset[tuple[int, int]], reference: frozenset[tuple[int, int]]) -> float:
        hits = 0
        for u, z in query:
            if any(
                (u + du, z + dz) in reference
                for du in range(-dilation, dilation + 1)
                for dz in range(-dilation, dilation + 1)
            ):
                hits += 1
        return hits / float(len(query))

    forward = covered(source_cells, target_cells)
    reverse = covered(target_cells, source_cells)
    harmonic = 0.0 if forward + reverse <= 0.0 else 2.0 * forward * reverse / (forward + reverse)
    return forward, reverse, harmonic


def _exact_partial_plane_matching_one_orientation(
    pair_rows: dict[tuple[int, int], dict[str, Any]],
    source_planes: tuple[WallPlanePatch, ...],
    target_planes: tuple[WallPlanePatch, ...],
    source_plane_areas_m2: tuple[float, ...],
    target_plane_areas_m2: tuple[float, ...],
    *,
    source_total_area_m2: float,
    target_total_area_m2: float,
    config: StructuralConfig,
    transpose: bool,
) -> tuple[list[tuple[int, int]] | None, dict[str, Any]]:
    """Minimize the reported nonlinear score over every partial matching.

    A state is discarded only when another state with the same remaining
    choices is no worse in squared offset error, the complete additive score
    numerator, and covered physical area.  This is an exact Pareto dominance
    rule: every future completion changes both states by the same values and
    leaves their final match-count denominator identical.

    The search also carries a bit mask of future edges that could form a
    jointly nonparallel witness with an already selected edge.  Consequently
    it accepts a completed matching only after the *same two correspondences*
    prove independent wall directions in both inventories.
    """

    maximum_live_states = PLANE_ASSIGNMENT_MAX_LIVE_STATES
    maximum_transition_count = PLANE_ASSIGNMENT_MAX_TRANSITIONS
    maximum_states_per_frontier = PLANE_ASSIGNMENT_MAX_STATES_PER_FRONTIER
    if not pair_rows:
        return None, {
            "exactSearchMethod": "Pareto dynamic program",
            "compatibleEdgeCount": 0,
            "jointlyNonparallelWitnessPairCount": 0,
            "transitionCount": 0,
            "peakLiveStateCount": 1,
            "dominatedStateCount": 0,
        }

    source_area_fractions = tuple(
        float(area / source_total_area_m2) for area in source_plane_areas_m2
    )
    target_area_fractions = tuple(
        float(area / target_total_area_m2) for area in target_plane_areas_m2
    )

    def edge_invariant_signature(edge: tuple[int, int]) -> tuple[Any, ...]:
        source_index, target_index = edge
        row = pair_rows[edge]
        return (
            float(row["offsetResidualMeters"]),
            float(row["normalAngleRadians"]),
            tuple(
                sorted(
                    (
                        source_area_fractions[source_index],
                        target_area_fractions[target_index],
                    )
                )
            ),
            float(row["patchBidirectionalRmseMeters"] or 0.0),
            bool(row["occupancyAssessable"]),
            float(row["occupancyF1"] or 0.0),
            float(row["exactLinearNumeratorMeters"]),
        )

    # Sorting is only a search accelerator; IDs, tuple positions, absolute
    # normal angles, and absolute offsets are excluded.  Exact profile ties
    # are physically equivalent to this scorer and cannot change its result.
    def source_profile(index: int) -> tuple[Any, ...]:
        return (
            source_area_fractions[index],
            tuple(
                sorted(
                    edge_invariant_signature(edge)
                    for edge in pair_rows
                    if edge[0] == index
                )
            ),
        )

    def target_profile(index: int) -> tuple[Any, ...]:
        return (
            target_area_fractions[index],
            tuple(
                sorted(
                    edge_invariant_signature(edge)
                    for edge in pair_rows
                    if edge[1] == index
                )
            ),
        )

    source_order = sorted(range(len(source_planes)), key=source_profile)
    target_order = sorted(range(len(target_planes)), key=target_profile)
    if transpose:
        processed_order = target_order
        mask_order = source_order
    else:
        processed_order = source_order
        mask_order = target_order
    processed_position = {
        original_index: position for position, original_index in enumerate(processed_order)
    }
    mask_position = {
        original_index: position for position, original_index in enumerate(mask_order)
    }

    ordered_edges = sorted(
        pair_rows,
        key=lambda edge: (
            processed_position[edge[1] if transpose else edge[0]],
            mask_position[edge[0] if transpose else edge[1]],
            edge_invariant_signature(edge),
        ),
    )
    edge_id = {edge: index for index, edge in enumerate(ordered_edges)}
    edges_by_processed_row: list[list[tuple[int, tuple[int, int], int]]] = [
        [] for _ in processed_order
    ]
    for edge in ordered_edges:
        source_index, target_index = edge
        row_index = processed_position[target_index if transpose else source_index]
        column_index = mask_position[source_index if transpose else target_index]
        edges_by_processed_row[row_index].append(
            (column_index, edge, edge_id[edge])
        )
    for options in edges_by_processed_row:
        options.sort(key=lambda row: (row[0], edge_invariant_signature(row[1])))

    minimum_cross = math.sin(math.radians(config.plane_min_pair_angle_degrees))

    def jointly_nonparallel(
        first: tuple[int, int], second: tuple[int, int]
    ) -> bool:
        first_source, first_target = first
        second_source, second_target = second
        if first_source == second_source or first_target == second_target:
            return False
        source_cross = abs(
            float(
                source_planes[first_source].normal_xy[0]
                * source_planes[second_source].normal_xy[1]
                - source_planes[first_source].normal_xy[1]
                * source_planes[second_source].normal_xy[0]
            )
        )
        target_cross = abs(
            float(
                target_planes[first_target].normal_xy[0]
                * target_planes[second_target].normal_xy[1]
                - target_planes[first_target].normal_xy[1]
                * target_planes[second_target].normal_xy[0]
            )
        )
        return bool(
            source_cross + config.angular_boundary_comparison_epsilon
            >= minimum_cross
            and target_cross + config.angular_boundary_comparison_epsilon
            >= minimum_cross
        )

    compatible_future_masks = [0] * len(ordered_edges)
    witness_pair_count = 0
    for first_index, second_index in itertools.combinations(
        range(len(ordered_edges)), 2
    ):
        if jointly_nonparallel(
            ordered_edges[first_index], ordered_edges[second_index]
        ):
            compatible_future_masks[first_index] |= 1 << second_index
            compatible_future_masks[second_index] |= 1 << first_index
            witness_pair_count += 1
    if witness_pair_count == 0:
        return None, {
            "exactSearchMethod": "Pareto dynamic program",
            "compatibleEdgeCount": len(ordered_edges),
            "jointlyNonparallelWitnessPairCount": 0,
            "transitionCount": 0,
            "peakLiveStateCount": 1,
            "dominatedStateCount": 0,
        }

    future_edge_mask_after_row: list[int] = []
    for row_index in range(len(processed_order)):
        mask = 0
        for later_options in edges_by_processed_row[row_index + 1 :]:
            for _column_index, _edge, later_edge_id in later_options:
                mask |= 1 << later_edge_id
        future_edge_mask_after_row.append(mask)

    def make_state(edges: tuple[tuple[int, int], ...]) -> _PlaneAssignmentState:
        canonical_edges = tuple(sorted(set(edges)))
        offset_square_sum = math.fsum(
            sorted(
                float(pair_rows[edge]["offsetResidualMeters"]) ** 2
                for edge in canonical_edges
            )
        )
        linear_sum = math.fsum(
            sorted(
                float(pair_rows[edge]["exactLinearNumeratorMeters"])
                for edge in canonical_edges
            )
        )
        coverage_sum = math.fsum(
            sorted(
                source_area_fractions[edge[0]]
                + target_area_fractions[edge[1]]
                for edge in canonical_edges
            )
        )
        if not all(
            math.isfinite(value)
            for value in (offset_square_sum, linear_sum, coverage_sum)
        ):
            fail(
                "INVALID_PLANE_SCORE_INPUT",
                "plane assignment aggregates must remain finite",
            )
        return _PlaneAssignmentState(
            canonical_edges,
            float(offset_square_sum),
            float(linear_sum),
            float(coverage_sum),
        )

    def dominates(
        first: _PlaneAssignmentState, second: _PlaneAssignmentState
    ) -> bool:
        no_worse = (
            first.offset_square_sum_m2 <= second.offset_square_sum_m2
            and first.linear_numerator_sum_m <= second.linear_numerator_sum_m
            and first.normalized_coverage_sum >= second.normalized_coverage_sum
        )
        strictly_better = (
            first.offset_square_sum_m2 < second.offset_square_sum_m2
            or first.linear_numerator_sum_m < second.linear_numerator_sum_m
            or first.normalized_coverage_sum > second.normalized_coverage_sum
        )
        return bool(no_worse and strictly_better)

    def state_physical_signature(state: _PlaneAssignmentState) -> tuple[Any, ...]:
        return tuple(sorted(edge_invariant_signature(edge) for edge in state.edges))

    transition_count = 0
    dominated_state_count = 0
    peak_live_state_count = 1
    current_layer_live_state_count = 0
    current: dict[tuple[int, int], list[_PlaneAssignmentState]] = {
        (0, 0): [make_state(())]
    }

    def raise_search_limit(message: str) -> None:
        error = SurfaceAlignmentError("PLANE_ASSIGNMENT_SEARCH_LIMIT", message)
        error.search_evidence = {
            "transitionCount": int(transition_count),
            "peakCompletedLayerLiveStateCount": int(peak_live_state_count),
            "currentLayerLiveStateCount": int(current_layer_live_state_count),
            "dominatedStateCount": int(dominated_state_count),
            "internalBitMaskUsesSourceInventory": bool(transpose),
            "maximumTransitionProofLimit": maximum_transition_count,
            "maximumLiveStateProofLimit": maximum_live_states,
            "maximumStatesPerFrontierProofLimit": maximum_states_per_frontier,
        }
        raise error

    def retain(
        table: dict[tuple[int, int], list[_PlaneAssignmentState]],
        key: tuple[int, int],
        candidate: _PlaneAssignmentState,
    ) -> None:
        nonlocal dominated_state_count, current_layer_live_state_count
        frontier = table.setdefault(key, [])
        previous_frontier_size = len(frontier)
        candidate_values = (
            candidate.offset_square_sum_m2,
            candidate.linear_numerator_sum_m,
            candidate.normalized_coverage_sum,
        )
        survivors: list[_PlaneAssignmentState] = []
        for existing in frontier:
            existing_values = (
                existing.offset_square_sum_m2,
                existing.linear_numerator_sum_m,
                existing.normalized_coverage_sum,
            )
            if dominates(existing, candidate):
                dominated_state_count += 1
                return
            if existing_values == candidate_values:
                dominated_state_count += 1
                if state_physical_signature(existing) <= state_physical_signature(
                    candidate
                ):
                    return
                continue
            if dominates(candidate, existing):
                dominated_state_count += 1
                continue
            survivors.append(existing)
        survivors.append(candidate)
        if len(survivors) > maximum_states_per_frontier:
            raise_search_limit(
                "exact plane matching exceeded the per-frontier proof limit",
            )
        table[key] = survivors
        current_layer_live_state_count += len(survivors) - previous_frontier_size
        if current_layer_live_state_count > maximum_live_states:
            raise_search_limit(
                "exact plane matching exceeded the live-state proof limit",
            )

    for row_index, options in enumerate(edges_by_processed_row):
        next_states: dict[tuple[int, int], list[_PlaneAssignmentState]] = {}
        current_layer_live_state_count = 0
        future_mask = future_edge_mask_after_row[row_index]
        for (used_columns, witness_mask), frontier in current.items():
            for state in frontier:
                transition_count += 1
                if transition_count > maximum_transition_count:
                    raise_search_limit(
                        "exact plane matching exceeded the transition proof limit",
                    )
                retained_witness_mask = (
                    -1 if witness_mask == -1 else witness_mask & future_mask
                )
                retain(
                    next_states,
                    (used_columns, retained_witness_mask),
                    state,
                )
                for column_index, edge, current_edge_id in options:
                    if used_columns & (1 << column_index):
                        continue
                    transition_count += 1
                    if transition_count > maximum_transition_count:
                        raise_search_limit(
                            "exact plane matching exceeded the transition proof limit",
                        )
                    if witness_mask == -1 or witness_mask & (
                        1 << current_edge_id
                    ):
                        next_witness_mask = -1
                    else:
                        next_witness_mask = (
                            witness_mask
                            | compatible_future_masks[current_edge_id]
                        ) & future_mask
                    retain(
                        next_states,
                        (used_columns | (1 << column_index), next_witness_mask),
                        make_state(state.edges + (edge,)),
                    )
        live_state_count = current_layer_live_state_count
        peak_live_state_count = max(peak_live_state_count, live_state_count)
        if live_state_count > maximum_live_states:
            raise_search_limit(
                "exact plane matching exceeded the live-state proof limit",
            )
        current = next_states

    candidates = [
        state
        for (_used_columns, witness_mask), frontier in current.items()
        if witness_mask == -1
        for state in frontier
        if len(state.edges) >= 2
    ]
    if not candidates:
        return None, {
            "exactSearchMethod": "Pareto dynamic program",
            "compatibleEdgeCount": len(ordered_edges),
            "jointlyNonparallelWitnessPairCount": witness_pair_count,
            "transitionCount": transition_count,
            "peakLiveStateCount": peak_live_state_count,
            "dominatedStateCount": dominated_state_count,
        }

    def state_score(state: _PlaneAssignmentState) -> float:
        match_count = len(state.edges)
        unmatched_penalty = 0.25 * max(
            0.0, 2.0 - state.normalized_coverage_sum
        )
        return float(
            math.sqrt(state.offset_square_sum_m2 / match_count)
            + state.linear_numerator_sum_m / match_count
            + unmatched_penalty
        )

    def state_role_symmetric_coverage_pair(
        state: _PlaneAssignmentState,
    ) -> tuple[float, float]:
        source_coverage = math.fsum(
            sorted(source_area_fractions[source_index] for source_index, _ in state.edges)
        )
        target_coverage = math.fsum(
            sorted(target_area_fractions[target_index] for _, target_index in state.edges)
        )
        weaker, stronger = sorted((source_coverage, target_coverage))
        return float(weaker), float(stronger)

    candidates.sort(
        key=lambda state: (
            state_score(state),
            -state_role_symmetric_coverage_pair(state)[0],
            -state_role_symmetric_coverage_pair(state)[1],
            state.offset_square_sum_m2,
            state.linear_numerator_sum_m,
            -state.normalized_coverage_sum,
            len(state.edges),
            state_physical_signature(state),
        )
    )
    best = candidates[0]
    best_score = state_score(best)
    best_coverage_pair = state_role_symmetric_coverage_pair(best)
    optimal_score_multiplicity = sum(
        1 for state in candidates if state_score(state) == best_score
    )
    return list(best.edges), {
        "exactSearchMethod": "Pareto dynamic program over every compatible partial one-to-one matching",
        "exactForReturnedNonlinearScore": True,
        "compatiblePlanesMayRemainUnmatched": True,
        "compatibleEdgeCount": len(ordered_edges),
        "jointlyNonparallelWitnessPairCount": witness_pair_count,
        "transitionCount": transition_count,
        "peakLiveStateCount": peak_live_state_count,
        "dominatedStateCount": dominated_state_count,
        "terminalNondominatedStateCount": len(candidates),
        "optimalScoreMultiplicity": optimal_score_multiplicity,
        "selectedRoleSymmetricCoveragePair": list(best_coverage_pair),
        "exactScoreTiePrefersMaximumWeakerThenStrongerCoverage": True,
        "planeIdsUsedForSearchOrTies": False,
        "absoluteWorldAnglesOrOffsetsUsedForSearchTies": False,
        "sourceTargetRoleSymmetricPhysicalTieEvidenceUsed": True,
        "maximumLiveStateProofLimit": maximum_live_states,
        "maximumTransitionProofLimit": maximum_transition_count,
        "maximumStatesPerFrontierProofLimit": maximum_states_per_frontier,
    }


def _exact_partial_plane_matching(
    pair_rows: dict[tuple[int, int], dict[str, Any]],
    source_planes: tuple[WallPlanePatch, ...],
    target_planes: tuple[WallPlanePatch, ...],
    source_plane_areas_m2: tuple[float, ...],
    target_plane_areas_m2: tuple[float, ...],
    *,
    source_total_area_m2: float,
    target_total_area_m2: float,
    config: StructuralConfig,
) -> tuple[list[tuple[int, int]] | None, dict[str, Any]]:
    """Run the exact matcher with source/target-symmetric cap behavior."""

    common_arguments = (
        pair_rows,
        source_planes,
        target_planes,
        source_plane_areas_m2,
        target_plane_areas_m2,
    )
    common_keywords = {
        "source_total_area_m2": source_total_area_m2,
        "target_total_area_m2": target_total_area_m2,
        "config": config,
    }
    if len(source_planes) != len(target_planes):
        transpose = len(source_planes) < len(target_planes)
        matches, evidence = _exact_partial_plane_matching_one_orientation(
            *common_arguments,
            **common_keywords,
            transpose=transpose,
        )
        evidence["internalBitMaskUsesSourceInventory"] = bool(transpose)
        evidence["equalCardinalityOppositeOrientationRetryUsed"] = False
        evidence["combinedTransitionCount"] = int(
            evidence.get("transitionCount", 0)
        )
        evidence["maximumCombinedTransitionBound"] = (
            PLANE_ASSIGNMENT_MAX_TRANSITIONS
        )
        return matches, evidence

    # With equal cardinalities either inventory can be the bit-mask axis.  A
    # finite proof cap can be reached at slightly different times for a graph
    # and its transpose even though their mathematical problem is identical.
    # Try the opposite internal orientation only when the first exact search
    # reaches a proof limit.  A proven result from either orientation is exact;
    # if both reach a limit, return no incumbent.
    try:
        matches, evidence = _exact_partial_plane_matching_one_orientation(
            *common_arguments,
            **common_keywords,
            transpose=False,
        )
    except SurfaceAlignmentError as first_error:
        if first_error.code != "PLANE_ASSIGNMENT_SEARCH_LIMIT":
            raise
        try:
            matches, evidence = _exact_partial_plane_matching_one_orientation(
                *common_arguments,
                **common_keywords,
                transpose=True,
            )
        except SurfaceAlignmentError as second_error:
            if second_error.code != "PLANE_ASSIGNMENT_SEARCH_LIMIT":
                raise
            first_search = getattr(first_error, "search_evidence", {})
            second_search = getattr(second_error, "search_evidence", {})
            combined_transition_count = int(
                first_search.get("transitionCount", 0)
            ) + int(second_search.get("transitionCount", 0))
            combined_error = SurfaceAlignmentError(
                "PLANE_ASSIGNMENT_SEARCH_LIMIT",
                "both source/target-symmetric orientations exceeded the exact plane-matching proof limits after "
                f"{combined_transition_count} combined transitions; no incumbent was returned",
            )
            combined_error.search_evidence = {
                "firstOrientation": first_search,
                "secondOrientation": second_search,
                "combinedTransitionCount": combined_transition_count,
                "maximumCombinedTransitionBound": (
                    2 * PLANE_ASSIGNMENT_MAX_TRANSITIONS + 2
                ),
                "noIncumbentReturned": True,
            }
            raise combined_error
        first_search = getattr(first_error, "search_evidence", {})
        evidence["internalBitMaskUsesSourceInventory"] = True
        evidence["equalCardinalityOppositeOrientationRetryUsed"] = True
        evidence["firstOrientationFailureCode"] = first_error.code
        evidence["failedFirstOrientationSearch"] = first_search
        evidence["combinedTransitionCount"] = int(
            first_search.get("transitionCount", 0)
        ) + int(evidence.get("transitionCount", 0))
        evidence["maximumCombinedTransitionBound"] = (
            2 * PLANE_ASSIGNMENT_MAX_TRANSITIONS + 2
        )
        return matches, evidence
    evidence["internalBitMaskUsesSourceInventory"] = False
    evidence["equalCardinalityOppositeOrientationRetryUsed"] = False
    evidence["combinedTransitionCount"] = int(
        evidence.get("transitionCount", 0)
    )
    evidence["maximumCombinedTransitionBound"] = (
        2 * PLANE_ASSIGNMENT_MAX_TRANSITIONS + 2
    )
    return matches, evidence


def _score_plane_hypothesis(
    source_surfaces: SurfaceSet,
    target_surfaces: SurfaceSet,
    source_inventory: StructuralInventory,
    target_inventory: StructuralInventory,
    hypothesis: PlaneHypothesis,
    *,
    full_patch_score: bool,
    config: StructuralConfig,
    linear_sum_assignment: Any,
    np: Any,
    cKDTree: Any,
) -> tuple[float, dict[str, Any]]:
    """Score one-to-one plane matches; never allow nearest-wall hopping."""

    if not isinstance(full_patch_score, bool):
        fail(
            "INVALID_PLANE_SCORE_INPUT",
            "full-patch scoring mode must be exactly true or false",
        )
    _validate_plane_matching_config(config)
    _validate_plane_matching_inventory(
        source_inventory,
        "source",
        config=config,
        error_code="INVALID_PLANE_SCORE_INPUT",
        np=np,
    )
    _validate_plane_matching_inventory(
        target_inventory,
        "target",
        config=config,
        error_code="INVALID_PLANE_SCORE_INPUT",
        np=np,
    )

    def normalized_planes(
        inventory: StructuralInventory,
    ) -> tuple[WallPlanePatch, ...]:
        return tuple(
            replace(
                plane,
                normal_xy=np.asarray(plane.normal_xy, dtype=np.float64),
                offset_m=float(plane.offset_m),
                point_indices=np.asarray(plane.point_indices),
                support_area_proxy_m2=float(plane.support_area_proxy_m2),
            )
            for plane in inventory.wall_planes
        )

    source_planes = normalized_planes(source_inventory)
    target_planes = normalized_planes(target_inventory)
    if not isinstance(source_surfaces, SurfaceSet) or not isinstance(
        target_surfaces, SurfaceSet
    ):
        fail("INVALID_PLANE_SCORE_INPUT", "plane-score surface sets have the wrong type")
    source_surface_points = _require_finite_matrix(
        source_surfaces.points, 3, "source plane-score points", np
    )
    target_surface_points = _require_finite_matrix(
        target_surfaces.points, 3, "target plane-score points", np
    )
    maximum_abs_coordinate_m = max(
        float(np.max(np.abs(source_surface_points))),
        float(np.max(np.abs(target_surface_points))),
    )
    if (
        maximum_abs_coordinate_m
        > config.maximum_abs_coordinate_m
        + config.metric_boundary_comparison_epsilon_m
    ):
        fail(
            "INVALID_PLANE_SCORE_INPUT",
            "plane-score points exceed the configured coordinate domain; offset comparisons would not have declared numerical precision",
        )
    if not isinstance(hypothesis, PlaneHypothesis):
        fail(
            "INVALID_PLANE_SCORE_INPUT",
            "plane hypothesis has the wrong type",
        )
    try:
        raw_translation = np.asarray(hypothesis.translation)
        if (
            isinstance(hypothesis.yaw_radians, bool)
            or not isinstance(hypothesis.yaw_radians, numbers.Real)
            or not np.issubdtype(raw_translation.dtype, np.number)
            or np.issubdtype(raw_translation.dtype, np.bool_)
            or np.issubdtype(raw_translation.dtype, np.complexfloating)
        ):
            raise TypeError
        yaw_radians = float(hypothesis.yaw_radians)
        translation = np.asarray(raw_translation, dtype=np.float64)
    except (TypeError, ValueError, OverflowError):
        fail(
            "INVALID_PLANE_SCORE_INPUT",
            "plane hypothesis yaw and three-dimensional translation must be finite",
        )
    if (
        not math.isfinite(yaw_radians)
        or translation.shape != (3,)
        or not np.all(np.isfinite(translation))
        or not isinstance(hypothesis.mirrored, bool)
    ):
        fail(
            "INVALID_PLANE_SCORE_INPUT",
            "plane hypothesis yaw and three-dimensional translation must be finite",
        )
    if (
        yaw_radians
        < -math.pi - config.angular_boundary_comparison_epsilon
        or yaw_radians
        > math.pi + config.angular_boundary_comparison_epsilon
        or float(np.max(np.abs(translation)))
        > 2.0 * config.maximum_abs_coordinate_m
        + config.metric_boundary_comparison_epsilon_m
    ):
        fail(
            "INVALID_PLANE_SCORE_INPUT",
            "plane hypothesis yaw must already be reduced to [-pi, pi] and translation must stay inside the declared coordinate domain",
        )
    yaw_radians = (yaw_radians + math.pi) % (2.0 * math.pi) - math.pi
    hypothesis = replace(
        hypothesis,
        yaw_radians=yaw_radians,
        translation=translation,
    )
    for role, seed_ids, planes in (
        ("source", hypothesis.source_seed_plane_ids, source_planes),
        ("target", hypothesis.target_seed_plane_ids, target_planes),
    ):
        if (
            not isinstance(seed_ids, tuple)
            or len(seed_ids) != 2
            or any(isinstance(value, bool) for value in seed_ids)
        ):
            fail(
                "INVALID_PLANE_SCORE_INPUT",
                f"{role} seed plane IDs must be two distinct integers",
            )
        try:
            normalized_seed_ids = tuple(operator.index(value) for value in seed_ids)
        except TypeError:
            fail(
                "INVALID_PLANE_SCORE_INPUT",
                f"{role} seed plane IDs must be two distinct integers",
            )
        known_ids = {operator.index(plane.plane_id) for plane in planes}
        if (
            normalized_seed_ids[0] == normalized_seed_ids[1]
            or any(value not in known_ids for value in normalized_seed_ids)
        ):
            fail(
                "INVALID_PLANE_SCORE_INPUT",
                f"{role} seed plane IDs must identify two distinct inventory planes",
            )

    def validate_planes(
        planes: tuple[WallPlanePatch, ...],
        *,
        surface_points: Any,
        role: str,
    ) -> tuple[float, tuple[float, ...]]:
        if len(planes) < 2:
            fail(
                "INVALID_PLANE_SCORE_INPUT",
                f"{role} inventory needs at least two wall planes",
            )
        areas: list[float] = []
        claimed_point_indexes: set[int] = set()
        for plane_index, plane in enumerate(planes):
            area = float(plane.support_area_proxy_m2)
            normal = np.asarray(plane.normal_xy, dtype=np.float64)
            offset = float(plane.offset_m)
            if not math.isfinite(area) or area <= 0.0:
                fail(
                    "INVALID_PLANE_SCORE_INPUT",
                    f"{role} plane {plane_index} support area must be finite and positive",
                )
            if (
                normal.shape != (2,)
                or not np.all(np.isfinite(normal))
                or abs(float(np.linalg.norm(normal)) - 1.0) > 1e-6
                or not math.isfinite(offset)
            ):
                fail(
                    "INVALID_PLANE_SCORE_INPUT",
                    f"{role} plane {plane_index} must have a finite unit XY normal and offset",
                )
            raw_indexes = np.asarray(plane.point_indices)
            if raw_indexes.ndim != 1 or not np.issubdtype(
                raw_indexes.dtype, np.integer
            ):
                fail(
                    "INVALID_PLANE_SCORE_INPUT",
                    f"{role} plane {plane_index} point indexes must be a one-dimensional integer array",
                )
            indexes = raw_indexes.astype(np.int64, copy=False)
            if (
                np.unique(indexes).size != indexes.size
                or np.any(indexes < 0)
                or np.any(indexes >= surface_points.shape[0])
            ):
                fail(
                    "INVALID_PLANE_SCORE_INPUT",
                    f"{role} plane {plane_index} point indexes must be unique and inside the surface set",
                )
            index_set = {int(value) for value in indexes}
            if claimed_point_indexes & index_set:
                fail(
                    "INVALID_PLANE_SCORE_INPUT",
                    f"{role} wall patch point indexes cannot belong to multiple planes",
                )
            claimed_point_indexes.update(index_set)
            if indexes.size:
                physical_patch_points = surface_points[indexes]
                if (
                    full_patch_score
                    and np.unique(physical_patch_points, axis=0).shape[0]
                    != indexes.size
                ):
                    fail(
                        "INVALID_PLANE_SCORE_INPUT",
                        f"{role} plane {plane_index} patch rows must represent distinct physical points",
                    )
                declared_plane_residuals_m = np.abs(
                    physical_patch_points[:, :2] @ normal - offset
                )
                if (
                    not np.all(np.isfinite(declared_plane_residuals_m))
                    or float(np.max(declared_plane_residuals_m))
                    > config.plane_max_point_residual_m
                    + config.metric_boundary_comparison_epsilon_m
                ):
                    fail(
                        "INVALID_PLANE_SCORE_INPUT",
                        f"{role} plane {plane_index} indexed points do not lie on its declared plane within the hard residual cap",
                    )
            if indexes.size:
                if full_patch_score:
                    if isinstance(plane.support_count, bool):
                        fail(
                            "INVALID_PLANE_SCORE_INPUT",
                            f"{role} plane {plane_index} support count must equal its distinct physical patch-row count",
                        )
                    try:
                        support_count = operator.index(plane.support_count)
                    except TypeError:
                        fail(
                            "INVALID_PLANE_SCORE_INPUT",
                            f"{role} plane {plane_index} support count must equal its distinct physical patch-row count",
                        )
                    if support_count != indexes.size:
                        fail(
                            "INVALID_PLANE_SCORE_INPUT",
                            f"{role} plane {plane_index} support count must equal its distinct physical patch-row count",
                        )
                physical_cells = _plane_occupancy_cells(
                    surface_points[indexes],
                    normal,
                    config.plane_occupancy_cell_m,
                    comparison_epsilon_m=(
                        config.metric_boundary_comparison_epsilon_m
                    ),
                    np=np,
                )
                authoritative_area = float(
                    len(physical_cells) * config.plane_occupancy_cell_m**2
                )
            elif full_patch_score:
                # Empty patches remain cleanly unassignable in full mode.
                # Their declared metadata cannot add coverage.
                authoritative_area = 0.0
            else:
                # Equation-only patches are permitted in the non-authoritative
                # cheap prefilter used by focused synthetic tests.  Production
                # inventories contain physical rows and are measured above.
                authoritative_area = area
            if not math.isfinite(authoritative_area) or authoritative_area < 0.0:
                fail(
                    "INVALID_PLANE_SCORE_INPUT",
                    f"{role} plane {plane_index} physical support area is invalid",
                )
            areas.append(authoritative_area)
        try:
            total_area = math.fsum(areas)
        except OverflowError:
            fail(
                "INVALID_PLANE_SCORE_INPUT",
                f"{role} total wall support area overflows finite arithmetic",
            )
        if (
            not math.isfinite(total_area)
            or total_area < 0.0
            or (not full_patch_score and total_area <= 0.0)
        ):
            fail(
                "INVALID_PLANE_SCORE_INPUT",
                f"{role} total wall support area must be finite and positive",
            )
        return total_area, tuple(areas)

    source_total_area, source_plane_areas = validate_planes(
        source_planes,
        surface_points=source_surface_points,
        role="source",
    )
    target_total_area, target_plane_areas = validate_planes(
        target_planes,
        surface_points=target_surface_points,
        role="target",
    )
    if full_patch_score and (
        source_total_area <= 0.0 or target_total_area <= 0.0
    ):
        return float("inf"), {
            "assessable": False,
            "reason": "fewer than two compatible one-to-one plane matches",
            "emptyFullPatchPairCount": len(source_planes) * len(target_planes),
            "physicalSupportAreaRecomputedFromIndexedPatchRows": True,
            "declaredSupportAreaCannotSteerFullPatchScore": True,
        }
    yaw = yaw_rotation(yaw_radians, np)
    yaw_xy = yaw[:2, :2]
    pair_rows: dict[tuple[int, int], dict[str, Any]] = {}
    empty_full_patch_pair_count = 0
    maximum_angle = math.radians(config.plane_match_normal_tolerance_degrees)
    unique_target_xy = np.unique(target_surface_points[:, :2], axis=0)
    if not unique_target_xy.size:
        fail("INVALID_PLANE_SCORE_INPUT", "target surfaces need a finite XY anchor")
    fallback_offset_comparison_anchor_xy = np.mean(unique_target_xy, axis=0)
    for source_index, source_plane in enumerate(source_planes):
        mapped_normal = yaw_xy @ np.asarray(source_plane.normal_xy, dtype=np.float64)
        mapped_offset = source_plane.offset_m + float(mapped_normal @ translation[:2])
        if not np.all(np.isfinite(mapped_normal)) or not math.isfinite(mapped_offset):
            fail(
                "INVALID_PLANE_SCORE_INPUT",
                "mapped plane equations must remain finite inside the declared coordinate domain",
            )
        for target_index, target_plane in enumerate(target_planes):
            target_normal = np.asarray(target_plane.normal_xy, dtype=np.float64)
            dot = float(mapped_normal @ target_normal)
            sign = 1.0 if dot >= 0.0 else -1.0
            signed_target_normal = sign * target_normal
            signed_target_offset = sign * target_plane.offset_m
            angle = math.acos(
                min(1.0, max(-1.0, float(mapped_normal @ signed_target_normal)))
            )
            source_patch_points = source_surface_points[
                source_plane.point_indices
            ]
            target_patch_points = target_surface_points[
                target_plane.point_indices
            ]
            if full_patch_score and (
                source_patch_points.shape[0] == 0
                or target_patch_points.shape[0] == 0
            ):
                # A geometric plane equation without any physical patch rows
                # can be compared cheaply, but it cannot support a full patch
                # distance or occupancy score.  Leave this pair unassignable
                # instead of allowing empty-tree NaNs to escape as a raw error.
                empty_full_patch_pair_count += 1
                continue
            if source_patch_points.size and target_patch_points.size:
                mapped_source_patch_xy = (
                    source_patch_points @ yaw.T + translation
                )[:, :2]
                pair_offset_anchor_xy = 0.5 * (
                    np.mean(np.unique(mapped_source_patch_xy, axis=0), axis=0)
                    + np.mean(
                        np.unique(target_patch_points[:, :2], axis=0), axis=0
                    )
                )
                offset_anchor_method = "mean of unique mapped-source and target wall-patch positions"
            else:
                pair_offset_anchor_xy = fallback_offset_comparison_anchor_xy
                offset_anchor_method = "fallback mean of all unique target XY positions because a patch index set was empty"
            mapped_position_at_anchor = float(
                mapped_offset - mapped_normal @ pair_offset_anchor_xy
            )
            target_position_at_anchor = float(
                signed_target_offset
                - signed_target_normal @ pair_offset_anchor_xy
            )
            offset_residual = abs(
                target_position_at_anchor - mapped_position_at_anchor
            )
            if not all(
                math.isfinite(value)
                for value in (
                    dot,
                    angle,
                    mapped_position_at_anchor,
                    target_position_at_anchor,
                    offset_residual,
                )
            ) or not np.all(np.isfinite(pair_offset_anchor_xy)):
                fail(
                    "INVALID_PLANE_SCORE_INPUT",
                    "derived plane comparison values must remain finite",
                )
            if (
                angle
                > maximum_angle + config.angular_boundary_comparison_epsilon
                or offset_residual
                > config.plane_match_max_offset_m
                + config.metric_boundary_comparison_epsilon_m
            ):
                continue
            pair_cost = offset_residual + 0.05 * angle
            patch_rmse: float | None = None
            occupancy_assessable = False
            occupancy_f1: float | None = None
            if full_patch_score:
                mapped_points = (
                    source_surface_points[source_plane.point_indices] @ yaw.T
                    + translation
                )
                target_points = target_surface_points[target_plane.point_indices]
                if not np.all(np.isfinite(mapped_points)):
                    fail(
                        "INVALID_PLANE_SCORE_INPUT",
                        "mapped wall-patch points must remain finite",
                    )
                target_tangent = np.asarray(
                    [-signed_target_normal[1], signed_target_normal[0]], dtype=np.float64
                )
                mapped_patch = np.column_stack(
                    (mapped_points[:, :2] @ target_tangent, mapped_points[:, 2])
                )
                target_patch = np.column_stack(
                    (target_points[:, :2] @ target_tangent, target_points[:, 2])
                )
                cell_m = config.plane_occupancy_cell_m
                occupancy_anchor = 0.5 * (
                    np.mean(np.unique(mapped_patch, axis=0), axis=0)
                    + np.mean(np.unique(target_patch, axis=0), axis=0)
                )
                mapped_patch_local = mapped_patch - occupancy_anchor
                target_patch_local = target_patch - occupancy_anchor
                if (
                    not np.all(np.isfinite(occupancy_anchor))
                    or not np.all(np.isfinite(mapped_patch_local))
                    or not np.all(np.isfinite(target_patch_local))
                ):
                    fail(
                        "INVALID_PLANE_SCORE_INPUT",
                        "wall-patch occupancy coordinates must remain finite",
                    )
                forward_distance, _ = cKDTree(target_patch_local).query(
                    mapped_patch_local, k=1, workers=1
                )
                reverse_distance, _ = cKDTree(mapped_patch_local).query(
                    target_patch_local, k=1, workers=1
                )
                patch_rmse = 0.5 * (
                    float(np.sqrt(np.mean(forward_distance * forward_distance)))
                    + float(np.sqrt(np.mean(reverse_distance * reverse_distance)))
                )
                if not math.isfinite(patch_rmse):
                    fail(
                        "INVALID_PLANE_SCORE_INPUT",
                        "wall-patch bidirectional distance must remain finite",
                    )

                def occupancy_axis_cells(value: float) -> tuple[int, ...]:
                    scaled = float(value) / cell_m
                    nearest = int(round(scaled))
                    if (
                        abs(float(value) - nearest * cell_m)
                        <= config.metric_boundary_comparison_epsilon_m
                    ):
                        return nearest - 1, nearest
                    return (int(math.floor(scaled)),)

                def occupancy_cells(patch: Any) -> frozenset[tuple[int, int]]:
                    return frozenset(
                        (u_cell, z_cell)
                        for u, z in patch
                        for u_cell in occupancy_axis_cells(float(u))
                        for z_cell in occupancy_axis_cells(float(z))
                    )

                source_cells = occupancy_cells(mapped_patch_local)
                target_cells = occupancy_cells(target_patch_local)
                occupancy_assessable = (
                    len(source_cells) >= config.plane_min_occupied_cells
                    and len(target_cells) >= config.plane_min_occupied_cells
                )
                if occupancy_assessable:
                    _forward, _reverse, occupancy_f1 = _occupancy_bidirectional_coverage(
                        source_cells,
                        target_cells,
                        config.plane_occupancy_dilation_cells,
                    )
                pair_cost += 0.15 * patch_rmse
                # No occupancy evidence is not perfect occupancy.  Every
                # matched patch contributes one bounded term; an unassessable
                # patch therefore has F1=0 for scoring.
                pair_cost += config.plane_occupancy_cell_m * (
                    1.0 - occupancy_f1 if occupancy_f1 is not None else 1.0
                )
            normalized_coverage_reward_m = 0.25 * (
                source_plane_areas[source_index] / source_total_area
                + target_plane_areas[target_index] / target_total_area
            )
            assignment_cost = pair_cost - normalized_coverage_reward_m
            pair_rows[(source_index, target_index)] = {
                "offsetResidualMeters": offset_residual,
                "offsetComparisonAnchorXYMeters": [
                    float(pair_offset_anchor_xy[0]),
                    float(pair_offset_anchor_xy[1]),
                ],
                "offsetComparisonAnchorMethod": offset_anchor_method,
                "normalAngleRadians": angle,
                "signedTargetNormal": signed_target_normal,
                "signedTargetOffsetMeters": signed_target_offset,
                "geometricAssignmentCostBeforeCoverageRewardMeters": float(pair_cost),
                "normalizedCoverageRewardMeters": float(normalized_coverage_reward_m),
                "assignmentCostMeters": float(assignment_cost),
                "exactLinearNumeratorMeters": float(
                    0.05 * angle
                    + (
                        0.15 * patch_rmse
                        + config.plane_occupancy_cell_m
                        * (1.0 - (occupancy_f1 or 0.0))
                        if full_patch_score and patch_rmse is not None
                        else 0.0
                    )
                ),
                "patchBidirectionalRmseMeters": patch_rmse,
                "occupancyAssessable": occupancy_assessable,
                "occupancyF1": occupancy_f1,
                "occupancyAnchorTangentHeightMeters": (
                    [float(value) for value in occupancy_anchor]
                    if full_patch_score
                    else None
                ),
                "occupancyUsesSharedPairLocalAnchor": full_patch_score,
            }
    # ``linear_sum_assignment`` remains an injected dependency for API
    # compatibility with older callers, but the authoritative selection is
    # now the exact nonlinear partial-matching search below.
    _ = linear_sum_assignment
    matches, exact_search = _exact_partial_plane_matching(
        pair_rows,
        source_planes,
        target_planes,
        source_plane_areas,
        target_plane_areas,
        source_total_area_m2=source_total_area,
        target_total_area_m2=target_total_area,
        config=config,
    )
    constrained_assignment_recovery_used = True
    constrained_assignment_candidate_count = int(
        exact_search.get("jointlyNonparallelWitnessPairCount", 0)
    )
    if matches is None or len(matches) < 2:
        reason = (
            "no matched correspondence pair contains independent wall directions in both source and target"
            if pair_rows
            and exact_search.get("jointlyNonparallelWitnessPairCount", 0) == 0
            else "fewer than two compatible one-to-one plane matches"
        )
        return float("inf"), {
            "assessable": False,
            "reason": reason,
            "emptyFullPatchPairCount": empty_full_patch_pair_count,
            "constrainedIndependentWallAssignmentRecoveryUsed": (
                constrained_assignment_recovery_used
            ),
            "constrainedIndependentWallAssignmentCandidateCount": (
                constrained_assignment_candidate_count
            ),
            "exactPartialMatchingSearch": exact_search,
        }
    matched_source_area = math.fsum(
        source_plane_areas[index] for index, _ in matches
    )
    matched_target_area = math.fsum(
        target_plane_areas[index] for _, index in matches
    )
    source_coverage = matched_source_area / source_total_area
    target_coverage = matched_target_area / target_total_area
    offset_values = [
        float(pair_rows[pair]["offsetResidualMeters"]) for pair in matches
    ]
    angle_values = [
        float(pair_rows[pair]["normalAngleRadians"]) for pair in matches
    ]
    offset_rmse = math.sqrt(
        math.fsum(sorted(value * value for value in offset_values))
        / len(matches)
    )
    mean_angle_radians = math.fsum(sorted(angle_values)) / len(matches)
    unmatched_penalty = 0.25 * max(
        0.0, (1.0 - source_coverage) + (1.0 - target_coverage)
    )
    cheap_score = offset_rmse + 0.05 * mean_angle_radians + unmatched_penalty
    patch_rmse_values: list[float] = []
    occupancy_values: list[float] = []
    occupancy_assessable_count = 0
    match_evidence: list[dict[str, Any]] = []
    if full_patch_score:
        for source_index, target_index in matches:
            source_plane = source_planes[source_index]
            target_plane = target_planes[target_index]
            pair = pair_rows[(source_index, target_index)]
            patch_rmse = float(pair["patchBidirectionalRmseMeters"])
            patch_rmse_values.append(patch_rmse)
            occupancy_assessable = bool(pair["occupancyAssessable"])
            occupancy_f1 = pair["occupancyF1"]
            if occupancy_assessable:
                if occupancy_f1 is None:
                    fail("INTERNAL_OCCUPANCY_ERROR", "assessable occupancy has no score")
                occupancy_assessable_count += 1
            occupancy_values.append(
                float(occupancy_f1) if occupancy_f1 is not None else 0.0
            )
            match_evidence.append(
                {
                    "sourcePlaneId": source_plane.plane_id,
                    "targetPlaneId": target_plane.plane_id,
                    "offsetResidualMeters": pair["offsetResidualMeters"],
                    "normalAngleDegrees": math.degrees(pair["normalAngleRadians"]),
                    "assignmentCostMeters": pair["assignmentCostMeters"],
                    "patchBidirectionalRmseMeters": patch_rmse,
                    "occupancyAssessable": occupancy_assessable,
                    "occupancyF1": occupancy_f1,
                }
            )
    patch_rmse_mean = (
        float(math.fsum(sorted(patch_rmse_values)) / len(patch_rmse_values))
        if patch_rmse_values
        else None
    )
    occupancy_f1_mean = (
        float(math.fsum(occupancy_values) / len(matches))
        if full_patch_score
        else None
    )
    score = cheap_score
    if patch_rmse_mean is not None:
        score += 0.15 * patch_rmse_mean
    if full_patch_score and occupancy_f1_mean is not None:
        score += config.plane_occupancy_cell_m * (1.0 - occupancy_f1_mean)
    return float(score), {
        "assessable": True,
        "scoreMeters": float(score),
        "oneToOneMatchedPlaneCount": len(matches),
        "matchedSourceAreaFraction": float(source_coverage),
        "matchedTargetAreaFraction": float(target_coverage),
        "planeOffsetRmseMeters": offset_rmse,
        "meanNormalAngleDegrees": math.degrees(mean_angle_radians),
        "unmatchedAreaPenaltyMeters": float(unmatched_penalty),
        "patchBidirectionalRmseMeters": patch_rmse_mean,
        "occupancyF1": occupancy_f1_mean,
        "occupancyAssessablePlaneCount": occupancy_assessable_count,
        "emptyFullPatchPairCount": empty_full_patch_pair_count,
        "occupancyUsesSharedPairLocalTangentHeightAnchor": full_patch_score,
        "matches": match_evidence if full_patch_score else [],
        "oneToOneAssignmentCostUsesPatchAndOccupancyWhenFullyScored": full_patch_score,
        "assignmentOptimizesExactReturnedNonlinearScore": True,
        "compatiblePlanesMayRemainUnmatched": True,
        "unassessableOccupancyF1ForScore": 0.0 if full_patch_score else None,
        "occupancyMeanDenominator": (
            "all matched physical wall patches" if full_patch_score else None
        ),
        "physicalSupportAreaRecomputedFromIndexedPatchRows": full_patch_score,
        "declaredSupportAreaCannotSteerFullPatchScore": full_patch_score,
        "exactAssignmentCostTieBreakRule": "source/target-symmetric rigid-invariant physical score components only; plane IDs, tuple positions, world angles, and world offsets excluded",
        "exactPartialMatchingSearch": exact_search,
        "constrainedIndependentWallAssignmentRecoveryUsed": (
            constrained_assignment_recovery_used
        ),
        "constrainedIndependentWallAssignmentCandidateCount": (
            constrained_assignment_candidate_count
        ),
        "floorCeilingXYContributedToScore": False,
    }


def _structural_center(surface_set: SurfaceSet, np: Any) -> Any:
    centers = [
        np.median(surface_set.points[surface_set.labels == label], axis=0)
        for label in LABEL_NAMES
    ]
    return np.mean(np.vstack(centers), axis=0)


def _solve_absolute_yaw_translation(source: Any, target: Any, np: Any) -> tuple[float, Any]:
    if source.shape != target.shape or source.shape[0] < 4:
        fail("INSUFFICIENT_STRUCTURAL_PAIRS", "yaw fit needs at least four matched surfaces")
    source_xy = source[:, :2]
    target_xy = target[:, :2]
    source_center = np.mean(source_xy, axis=0)
    target_center = np.mean(target_xy, axis=0)
    left = source_xy - source_center
    right = target_xy - target_center
    denominator = float(np.sum(left[:, 0] * right[:, 0] + left[:, 1] * right[:, 1]))
    numerator = float(np.sum(left[:, 0] * right[:, 1] - left[:, 1] * right[:, 0]))
    if math.hypot(denominator, numerator) <= 1e-12:
        fail("DEGENERATE_STRUCTURAL_PAIRS", "matched structural surfaces cannot constrain yaw")
    angle = math.atan2(numerator, denominator)
    rotation = yaw_rotation(angle, np)
    translation = np.empty(3, dtype=np.float64)
    translation[:2] = target_center - source_center @ rotation[:2, :2].T
    translation[2] = float(np.median(target[:, 2] - source[:, 2]))
    return angle, translation


def _make_class_trees(target: SurfaceSet, cKDTree: Any) -> dict[int, tuple[Any, Any, Any]]:
    result: dict[int, tuple[Any, Any, Any]] = {}
    for label in LABEL_NAMES:
        indexes = target.labels == label
        result[label] = (
            cKDTree(target.points[indexes]),
            target.points[indexes],
            target.normals[indexes],
        )
    return result


def _match_structures(
    source_base: SurfaceSet,
    rotation: Any,
    translation: Any,
    trees: dict[int, tuple[Any, Any, Any]],
    *,
    trim_fraction: float,
    minimum_abs_dot: float,
    np: Any,
) -> tuple[Any, Any, dict[str, Any]]:
    mapped_points = source_base.points @ rotation.T + translation
    mapped_normals = source_base.normals @ rotation.T
    source_rows: list[Any] = []
    target_rows: list[Any] = []
    kept_by_class: dict[str, int] = {}
    rejected_normal = 0
    for label in LABEL_NAMES:
        source_indexes = np.flatnonzero(source_base.labels == label)
        tree, target_points, target_normals = trees[label]
        k = min(6, int(target_points.shape[0]))
        distances, nearest = tree.query(mapped_points[source_indexes], k=k, workers=1)
        if k == 1:
            distances = distances[:, None]
            nearest = nearest[:, None]
        candidate_normals = target_normals[nearest]
        normal_dots = np.abs(
            np.einsum("nkj,nj->nk", candidate_normals, mapped_normals[source_indexes])
        )
        costs = distances + 0.15 * (1.0 - normal_dots)
        costs[normal_dots < minimum_abs_dot] = np.inf
        choice = np.argmin(costs, axis=1)
        rows = np.arange(choice.size)
        selected_cost = costs[rows, choice]
        valid = np.isfinite(selected_cost)
        rejected_normal += int(np.count_nonzero(~valid))
        if int(np.count_nonzero(valid)) < 4:
            fail("INSUFFICIENT_NORMAL_MATCHES", f"too few aligned {LABEL_NAMES[label]} matches")
        valid_rows = rows[valid]
        valid_cost = selected_cost[valid]
        retain_count = max(4, int(math.floor(valid_cost.size * trim_fraction)))
        order = np.argsort(valid_cost, kind="stable")[:retain_count]
        chosen_rows = valid_rows[order]
        chosen_targets = nearest[chosen_rows, choice[chosen_rows]]
        source_rows.append(source_base.points[source_indexes[chosen_rows]])
        target_rows.append(target_points[chosen_targets])
        kept_by_class[LABEL_NAMES[label]] = int(retain_count)
    return np.vstack(source_rows), np.vstack(target_rows), {
        "retainedPairCountByClass": kept_by_class,
        "normalRejectedPairCount": rejected_normal,
    }


def _statistics(values: Any, np: Any) -> dict[str, Any]:
    values = np.asarray(values, dtype=np.float64)
    if values.ndim != 1 or values.size == 0 or not np.all(np.isfinite(values)):
        fail("INVALID_METRICS", "structural residuals must be a non-empty finite vector")
    return {
        "count": int(values.size),
        "mean": float(np.mean(values)),
        "median": float(np.percentile(values, 50, method="linear")),
        "p95": float(np.percentile(values, 95, method="linear")),
        "rmse": float(np.sqrt(np.mean(values * values))),
        "maximum": float(np.max(values)),
    }


def _directional_metrics(
    source: SurfaceSet,
    target: SurfaceSet,
    *,
    normal_compatibility_min_abs_dot: float,
    np: Any,
    cKDTree: Any,
) -> dict[str, Any]:
    rows: dict[str, Any] = {}
    class_scores: list[float] = []
    for label in LABEL_NAMES:
        source_mask = source.labels == label
        target_mask = target.labels == label
        tree = cKDTree(target.points[target_mask])
        distances, nearest = tree.query(source.points[source_mask], k=1, workers=1)
        nearest_points = target.points[target_mask][nearest]
        nearest_normals = target.normals[target_mask][nearest]
        plane = np.abs(np.einsum("ni,ni->n", source.points[source_mask] - nearest_points, nearest_normals))
        normal_dot = np.abs(np.einsum("ni,ni->n", source.normals[source_mask], nearest_normals))
        normal_compatible = normal_dot >= normal_compatibility_min_abs_dot
        retain_count = max(1, int(math.floor(distances.size * 0.90)))
        retained = np.argsort(distances, kind="stable")[:retain_count]
        raw_distance_stats = _statistics(distances, np)
        distance_stats = _statistics(distances[retained], np)
        plane_stats = _statistics(plane[retained], np)
        mean_dot = float(np.mean(normal_dot[retained]))
        raw_mean_dot = float(np.mean(normal_dot))
        # Candidate selection uses every classified source surface.  The
        # closest-90% view remains visible but cannot hide false geometry.
        score = raw_distance_stats["rmse"] + 0.10 * (1.0 - raw_mean_dot)
        class_scores.append(score)
        rows[LABEL_NAMES[label]] = {
            "sourceSurfaceCount": int(np.count_nonzero(source_mask)),
            "targetSurfaceCount": int(np.count_nonzero(target_mask)),
            "rawNearestDistanceMeters": raw_distance_stats,
            "fixedDistanceCoverageFractions": {
                "within20mm": float(np.mean(distances <= 0.02)),
                "within50mm": float(np.mean(distances <= 0.05)),
                "within100mm": float(np.mean(distances <= 0.10)),
                "within200mm": float(np.mean(distances <= 0.20)),
                "within500mm": float(np.mean(distances <= 0.50)),
            },
            "nearestDistanceMetersWithinClosest90Percent": distance_stats,
            "pointToPlaneMetersWithinClosest90Percent": plane_stats,
            "closest90PercentP95EquivalentRawPercentile": 85.5,
            "normalCompatibleCoverage": {
                "minimumAbsoluteNormalDot": normal_compatibility_min_abs_dot,
                "compatibleCount": int(np.count_nonzero(normal_compatible)),
                "sourceFraction": float(np.mean(normal_compatible)),
            },
            "normalCompatiblePointToPlaneMeters": (
                _statistics(plane[normal_compatible], np)
                if int(np.count_nonzero(normal_compatible)) > 0
                else None
            ),
            "meanAbsoluteNormalDotTrimmed90Percent": mean_dot,
            "rawMeanAbsoluteNormalDot": raw_mean_dot,
            "score": score,
            "scoreUsesAllClassifiedSurfaces": True,
        }
    return {
        "classes": rows,
        "classBalancedScore": float(np.mean(class_scores)),
        "rawEuclideanAndNormalCompatiblePointToPlaneReportedSeparately": True,
    }


def transform_surfaces(surface_set: SurfaceSet, rotation: Any, translation: Any, np: Any) -> SurfaceSet:
    return SurfaceSet(
        surface_set.points @ rotation.T + translation,
        surface_set.normals @ rotation.T,
        surface_set.labels.copy(),
        surface_set.weights.copy(),
    )


def evaluate_structural_alignment(
    source: SurfaceSet,
    target: SurfaceSet,
    rotation: Any,
    translation: Any,
    *,
    normal_compatibility_min_abs_dot: float = 0.70,
    np: Any,
    cKDTree: Any,
) -> dict[str, Any]:
    mapped = transform_surfaces(source, rotation, translation, np)
    forward = _directional_metrics(
        mapped,
        target,
        normal_compatibility_min_abs_dot=normal_compatibility_min_abs_dot,
        np=np,
        cKDTree=cKDTree,
    )
    reverse = _directional_metrics(
        target,
        mapped,
        normal_compatibility_min_abs_dot=normal_compatibility_min_abs_dot,
        np=np,
        cKDTree=cKDTree,
    )
    return {
        "sourceToTarget": forward,
        "targetToSource": reverse,
        "bidirectionalClassBalancedScore": 0.5
        * (forward["classBalancedScore"] + reverse["classBalancedScore"]),
        "scoreMeaning": (
            "equal wall/floor/ceiling contribution; untrimmed nearest-distance RMSE plus unsigned-normal mismatch; "
            "diagnostic score is not a surveyed accuracy value"
        ),
    }


def derive_fit_supported_crop(fit_target: SurfaceSet, *, np: Any) -> tuple[Any, Any, dict[str, Any]]:
    """Freeze target-frame bounds from fit stations before validation is examined."""

    low = np.percentile(fit_target.points, 0.5, axis=0, method="linear")
    high = np.percentile(fit_target.points, 99.5, axis=0, method="linear")
    span = high - low
    if np.any(span <= 0.25) or not np.all(np.isfinite(span)):
        fail("DEGENERATE_FIT_CROP", "fit surfaces cannot define a three-dimensional crop")
    margin = np.array(
        [max(0.25, 0.03 * span[0]), max(0.25, 0.03 * span[1]), max(0.15, 0.03 * span[2])],
        dtype=np.float64,
    )
    low = low - margin
    high = high + margin
    return low, high, {
        "derivedOnlyFromFrozenFitSurfaces": True,
        "validationExaminedDuringCropDefinition": False,
        "lowerMeters": [float(value) for value in low],
        "upperMeters": [float(value) for value in high],
        "percentileBoundsBeforeMargin": [0.5, 99.5],
        "marginMeters": [float(value) for value in margin],
        "reviewedOrApproved": False,
    }


def crop_surfaces(
    surface_set: SurfaceSet, low: Any, high: Any, *, label: str, np: Any
) -> tuple[SurfaceSet, dict[str, Any]]:
    inside = np.all((surface_set.points >= low) & (surface_set.points <= high), axis=1)
    retained_counts = {
        LABEL_NAMES[class_id]: int(np.count_nonzero(inside & (surface_set.labels == class_id)))
        for class_id in LABEL_NAMES
    }
    input_counts = {
        LABEL_NAMES[class_id]: int(np.count_nonzero(surface_set.labels == class_id))
        for class_id in LABEL_NAMES
    }
    if any(count < MIN_SURFACES_PER_CLASS for count in retained_counts.values()):
        fail("CROP_MISSING_STRUCTURAL_CLASS", f"{label} crop loses structural coverage: {retained_counts}")
    cropped = SurfaceSet(
        surface_set.points[inside],
        surface_set.normals[inside],
        surface_set.labels[inside],
        surface_set.weights[inside],
    )
    return cropped, {
        "label": label,
        "inputCount": int(surface_set.points.shape[0]),
        "retainedCount": int(cropped.points.shape[0]),
        "retainedFraction": float(np.mean(inside)),
        "inputCountByClass": input_counts,
        "retainedCountByClass": retained_counts,
    }


def evaluate_in_fit_supported_crop(
    source: SurfaceSet,
    target: SurfaceSet,
    rotation: Any,
    translation: Any,
    low: Any,
    high: Any,
    *,
    normal_compatibility_min_abs_dot: float,
    np: Any,
    cKDTree: Any,
) -> tuple[dict[str, Any], SurfaceSet, SurfaceSet]:
    mapped = transform_surfaces(source, rotation, translation, np)
    mapped_crop, source_coverage = crop_surfaces(
        mapped, low, high, label="mapped XGRIDS", np=np
    )
    target_crop, target_coverage = crop_surfaces(
        target, low, high, label="E57 target", np=np
    )
    identity = np.eye(3, dtype=np.float64)
    zero = np.zeros(3, dtype=np.float64)
    metrics = evaluate_structural_alignment(
        mapped_crop,
        target_crop,
        identity,
        zero,
        normal_compatibility_min_abs_dot=normal_compatibility_min_abs_dot,
        np=np,
        cKDTree=cKDTree,
    )
    metrics["coverage"] = {
        "mappedXgrids": source_coverage,
        "e57Target": target_coverage,
    }
    return metrics, mapped_crop, target_crop


def evaluate_validation_scans_separately(
    source: SurfaceSet,
    validation_by_scan: Mapping[int, SurfaceSet],
    proper_rotation: Any,
    proper_translation: Any,
    mirror_rotation: Any,
    mirror_translation: Any,
    low: Any,
    high: Any,
    *,
    config: StructuralConfig,
    np: Any,
    cKDTree: Any,
) -> dict[str, Any]:
    if set(validation_by_scan) != set(VALIDATION_SCAN_IDS):
        if any(scan in TEST_SCAN_IDS for scan in validation_by_scan):
            fail("FROZEN_TEST_LEAK", "frozen test scan supplied for per-scan validation")
        fail("INCOMPLETE_SCAN_ROLE", "per-scan validation must contain 131, 134, and 138 exactly")
    rows: dict[str, Any] = {}
    for scan_id in VALIDATION_SCAN_IDS:
        try:
            proper, _proper_source, _target = evaluate_in_fit_supported_crop(
                source,
                validation_by_scan[scan_id],
                proper_rotation,
                proper_translation,
                low,
                high,
                normal_compatibility_min_abs_dot=config.normal_alignment_min_abs_dot,
                np=np,
                cKDTree=cKDTree,
            )
            mirror, _mirror_source, _target_again = evaluate_in_fit_supported_crop(
                source,
                validation_by_scan[scan_id],
                mirror_rotation,
                mirror_translation,
                low,
                high,
                normal_compatibility_min_abs_dot=config.normal_alignment_min_abs_dot,
                np=np,
                cKDTree=cKDTree,
            )
            proper_score = proper["bidirectionalClassBalancedScore"]
            mirror_score = mirror["bidirectionalClassBalancedScore"]
            rows[str(scan_id)] = {
                "assessable": True,
                "properCandidate": proper,
                "forbiddenMirror": mirror,
                "properAdvantageOverMirror": float(mirror_score - proper_score),
            }
        except SurfaceAlignmentError as error:
            rows[str(scan_id)] = {
                "assessable": False,
                "errorCode": error.code,
                "meaning": "This station cannot be hidden by the aggregate; its missing coverage is explicit.",
            }
    return {
        "aggregationCannotSubstituteForTheseRows": True,
        "scans": rows,
    }


def _matrix_evidence(rotation: Any, translation: Any, np: Any) -> dict[str, Any]:
    matrix = np.eye(4, dtype=np.float64)
    matrix[:3, :3] = rotation
    matrix[:3, 3] = translation
    yaw = math.degrees(math.atan2(float(rotation[1, 0]), float(rotation[0, 0])))
    return {
        "rotationRowMajor": [[float(value) for value in row] for row in rotation],
        "translationMeters": [float(value) for value in translation],
        "matrixColumnMajor": [float(value) for value in matrix.flatten(order="F")],
        "determinantRotation": float(np.linalg.det(rotation)),
        "yawDegreesDiagnostic": yaw,
        "zAxis": [float(value) for value in rotation[:, 2]],
        "fixedScale": 1.0,
        "isTransformArtifact": False,
    }


def _refine_structural_zup_candidate(
    source: SurfaceSet,
    target: SurfaceSet,
    initial_rotation: Any,
    initial_translation: Any,
    reflection: Any,
    *,
    config: StructuralConfig,
    np: Any,
    cKDTree: Any,
) -> tuple[Any, Any, dict[str, Any]]:
    """Continuously refine the selected yaw/translation without changing its family.

    The plane-pair search provides a structurally meaningful starting point.
    This second stage minimizes untrimmed bidirectional wall distances in yaw
    and XY only.  The floor-derived Z translation is frozen; the independently
    extracted top ceiling envelope checks fixed scale; lower bands are report-only,
    and neither can steer the transform. Reverse wall distances are evaluated in the unchanged source
    frame, so every objective call can reuse fixed deterministic KD trees.
    """

    if (
        config.continuous_refinement_yaw_window_degrees <= 0.0
        or config.continuous_refinement_translation_window_m <= 0.0
        or config.continuous_refinement_max_evaluations <= 0
    ):
        fail("INVALID_REFINEMENT_CONFIG", "continuous structural refinement bounds are invalid")
    try:
        optimize = importlib.import_module("scipy.optimize")
    except ImportError as error:
        fail("SCIPY_OPTIMIZE_UNAVAILABLE", "continuous structural refinement needs SciPy optimize")
        raise AssertionError from error

    source_rows: dict[int, tuple[Any, Any, Any]] = {}
    target_rows: dict[int, tuple[Any, Any, Any]] = {}
    for label in (LABEL_WALL,):
        source_mask = source.labels == label
        target_mask = target.labels == label
        source_points = source.points[source_mask]
        source_normals = source.normals[source_mask]
        target_points = target.points[target_mask]
        target_normals = target.normals[target_mask]
        if source_points.shape[0] < MIN_SURFACES_PER_CLASS or target_points.shape[0] < MIN_SURFACES_PER_CLASS:
            fail("MISSING_STRUCTURAL_CLASS", "continuous refinement lacks a wall class")
        source_rows[label] = (source_points, source_normals, cKDTree(source_points))
        target_rows[label] = (target_points, target_normals, cKDTree(target_points))

    def directional_score(
        query_points: Any,
        query_normals: Any,
        reference_points: Any,
        reference_normals: Any,
        reference_tree: Any,
    ) -> float:
        distances, nearest = reference_tree.query(query_points, k=1, workers=1)
        nearest_normals = reference_normals[nearest]
        normal_dot = np.abs(np.einsum("ni,ni->n", query_normals, nearest_normals))
        rmse = float(np.sqrt(np.mean(distances * distances)))
        return rmse + 0.10 * (1.0 - float(np.mean(normal_dot)))

    evaluation_count = 0

    def objective(parameters: Any) -> float:
        nonlocal evaluation_count
        evaluation_count += 1
        values = np.asarray(parameters, dtype=np.float64)
        if values.shape != (3,) or not np.all(np.isfinite(values)):
            return float("inf")
        yaw = yaw_rotation(float(values[0]), np)
        total_rotation = yaw @ reflection
        translation = np.asarray(
            [values[1], values[2], float(initial_translation[2])], dtype=np.float64
        )
        forward_scores: list[float] = []
        reverse_scores: list[float] = []
        for label in (LABEL_WALL,):
            source_points, source_normals, source_tree = source_rows[label]
            target_points, target_normals, target_tree = target_rows[label]
            mapped_points = source_points @ total_rotation.T + translation
            mapped_normals = source_normals @ total_rotation.T
            forward_scores.append(
                directional_score(
                    mapped_points,
                    mapped_normals,
                    target_points,
                    target_normals,
                    target_tree,
                )
            )
            # Transform target queries into the fixed source frame.  Euclidean
            # distance and unsigned normal agreement are invariant under this
            # orthogonal proper-or-mirror transform.
            inverse_points = (target_points - translation) @ total_rotation
            inverse_normals = target_normals @ total_rotation
            reverse_scores.append(
                directional_score(
                    inverse_points,
                    inverse_normals,
                    source_points,
                    source_normals,
                    source_tree,
                )
            )
        return 0.5 * (float(np.mean(forward_scores)) + float(np.mean(reverse_scores)))

    yaw_without_reflection = initial_rotation @ reflection
    initial_yaw = math.atan2(
        float(yaw_without_reflection[1, 0]), float(yaw_without_reflection[0, 0])
    )
    initial = np.asarray(
        [initial_yaw, float(initial_translation[0]), float(initial_translation[1])],
        dtype=np.float64,
    )
    yaw_window = math.radians(config.continuous_refinement_yaw_window_degrees)
    translation_window = config.continuous_refinement_translation_window_m
    bounds = [
        (initial_yaw - yaw_window, initial_yaw + yaw_window),
        *[
            (float(initial[index]) - translation_window, float(initial[index]) + translation_window)
            for index in range(1, 3)
        ],
    ]
    initial_score = objective(initial)
    result = optimize.minimize(
        objective,
        initial,
        method="Nelder-Mead",
        bounds=bounds,
        options={
            "xatol": config.continuous_refinement_xtol,
            "fatol": config.continuous_refinement_ftol,
            "maxfev": config.continuous_refinement_max_evaluations,
            "disp": False,
        },
    )
    optimizer_candidate = np.asarray(result.x, dtype=np.float64)
    optimizer_score = objective(optimizer_candidate)
    if not bool(result.success):
        fail("STRUCTURAL_REFINEMENT_FAILED", f"continuous refinement failed: {result.message}")
    if not np.all(np.isfinite(optimizer_candidate)) or not math.isfinite(optimizer_score):
        fail("NONFINITE_STRUCTURAL_REFINEMENT", "continuous refinement returned a non-finite candidate")
    optimizer_candidate_accepted = optimizer_score <= initial_score + 1e-10
    refined = optimizer_candidate if optimizer_candidate_accepted else initial
    final_score = optimizer_score if optimizer_candidate_accepted else initial_score
    bound_clearances = [
        min(float(refined[index]) - bounds[index][0], bounds[index][1] - float(refined[index]))
        for index in range(3)
    ]
    refined_rotation = yaw_rotation(float(refined[0]), np) @ reflection
    refined_translation = np.asarray(
        [refined[1], refined[2], float(initial_translation[2])], dtype=np.float64
    )
    return refined_rotation, refined_translation, {
        "method": "bounded deterministic scipy.optimize Nelder-Mead",
        "objective": (
            "untrimmed bidirectional nearest-wall score with floor-derived Z translation frozen"
        ),
        "zTranslationFrozenDuringContinuousRefinement": True,
        "zTranslationMeters": float(initial_translation[2]),
        "initialScore": float(initial_score),
        "finalScore": float(final_score),
        "optimizerCandidateScore": float(optimizer_score),
        "optimizerCandidateAccepted": bool(optimizer_candidate_accepted),
        "scoreImprovement": float(initial_score - final_score),
        "optimizerSuccess": bool(result.success),
        "optimizerMessage": str(result.message),
        "objectiveEvaluationCount": int(evaluation_count),
        "optimizerReportedFunctionEvaluationCount": int(result.nfev),
        "yawWindowDegreesAroundDiscreteCandidate": config.continuous_refinement_yaw_window_degrees,
        "translationWindowMetersAroundDiscreteCandidate": config.continuous_refinement_translation_window_m,
        "minimumDistanceToAnyBoundInNativeUnits": float(min(bound_clearances)),
        "hitSearchBoundary": bool(min(bound_clearances) <= 1e-7),
        "cannotChangeScaleGravityOrHandednessFamily": True,
    }


def fit_structural_zup_family(
    source: SurfaceSet,
    target: SurfaceSet,
    *,
    mirrored: bool,
    config: StructuralConfig,
    np: Any,
    cKDTree: Any,
) -> tuple[Any, Any, dict[str, Any]]:
    """Fit one handedness family from distinct structural plane hypotheses."""

    source = _balanced_sample(source, config.fit_points_per_class, "fit-source", np)
    target = _balanced_sample(target, config.fit_points_per_class * 2, "fit-target", np)
    reflection = np.diag([-1.0, 1.0, 1.0]) if mirrored else np.eye(3, dtype=np.float64)
    base = transform_surfaces(source, reflection, np.zeros(3, dtype=np.float64), np)
    source_inventory, source_inventory_evidence = extract_structural_inventory(
        base, config=config, np=np
    )
    target_inventory, target_inventory_evidence = extract_structural_inventory(
        target, config=config, np=np
    )
    hypotheses, hypothesis_evidence = generate_plane_pair_hypotheses(
        source_inventory,
        target_inventory,
        mirrored=mirrored,
        config=config,
        np=np,
    )
    try:
        optimize = importlib.import_module("scipy.optimize")
        linear_sum_assignment = optimize.linear_sum_assignment
    except (ImportError, AttributeError) as error:
        fail("SCIPY_OPTIMIZE_UNAVAILABLE", "distinct-plane assignment needs SciPy optimize")
        raise AssertionError from error

    cheap_candidates: list[tuple[float, int, PlaneHypothesis, dict[str, Any]]] = []
    rejected_hypothesis_count = 0
    for hypothesis_index, hypothesis in enumerate(hypotheses):
        score, evidence = _score_plane_hypothesis(
            base,
            target,
            source_inventory,
            target_inventory,
            hypothesis,
            full_patch_score=False,
            config=config,
            linear_sum_assignment=linear_sum_assignment,
            np=np,
            cKDTree=cKDTree,
        )
        if not math.isfinite(score):
            rejected_hypothesis_count += 1
            continue
        cheap_candidates.append((score, hypothesis_index, hypothesis, evidence))
    if not cheap_candidates:
        fail(
            "NO_DISTINCT_PLANE_FIT_CANDIDATE",
            "no two-plane hypothesis retained two compatible one-to-one plane matches",
        )
    cheap_candidates.sort(
        key=lambda row: (
            row[0],
            row[2].yaw_radians,
            float(row[2].translation[0]),
            float(row[2].translation[1]),
            row[1],
        )
    )
    full_candidates: list[
        tuple[float, int, PlaneHypothesis, dict[str, Any], float]
    ] = []
    full_score_attempt_count = 0
    full_score_nonfinite_count = 0
    # Fully score every assessable hypothesis.  A cheap offset score is not a
    # mathematical lower bound on patch/extent/occupancy score, so truncating
    # this list could hide the actual winner or a material near-tie.
    for cheap_score, hypothesis_index, hypothesis, _cheap_evidence in cheap_candidates:
        full_score_attempt_count += 1
        score, evidence = _score_plane_hypothesis(
            base,
            target,
            source_inventory,
            target_inventory,
            hypothesis,
            full_patch_score=True,
            config=config,
            linear_sum_assignment=linear_sum_assignment,
            np=np,
            cKDTree=cKDTree,
        )
        if math.isfinite(score):
            full_candidates.append(
                (score, hypothesis_index, hypothesis, evidence, cheap_score)
            )
        else:
            full_score_nonfinite_count += 1
    if not full_candidates:
        fail("NO_DISTINCT_PLANE_FIT_CANDIDATE", "no plane hypothesis could be fully scored")
    full_candidates.sort(
        key=lambda row: (
            row[0],
            row[2].yaw_radians,
            float(row[2].translation[0]),
            float(row[2].translation[1]),
            row[1],
        )
    )
    best = full_candidates[0]
    best_hypothesis = best[2]
    best_rotation = yaw_rotation(best_hypothesis.yaw_radians, np) @ reflection
    best_translation = best_hypothesis.translation
    best_reported_metrics = evaluate_structural_alignment(
        source,
        target,
        best_rotation,
        best_translation,
        np=np,
        cKDTree=cKDTree,
    )
    best_reported_score = float(best_reported_metrics["bidirectionalClassBalancedScore"])
    best_wall_only_score = 0.5 * (
        float(best_reported_metrics["sourceToTarget"]["classes"]["wall"]["score"])
        + float(best_reported_metrics["targetToSource"]["classes"]["wall"]["score"])
    )
    runner_up = next(
        (
            row
            for row in full_candidates[1:]
            if abs(
                (row[2].yaw_radians - best_hypothesis.yaw_radians + math.pi)
                % (2.0 * math.pi)
                - math.pi
            )
            > math.radians(0.25)
            or float(np.linalg.norm(row[2].translation - best_translation)) > 0.02
        ),
        None,
    )
    runner_up_reported_score: float | None = None
    if runner_up is not None:
        runner_up_rotation = yaw_rotation(runner_up[2].yaw_radians, np) @ reflection
        runner_up_reported_score = float(
            evaluate_structural_alignment(
                source,
                target,
                runner_up_rotation,
                runner_up[2].translation,
                np=np,
                cKDTree=cKDTree,
            )["bidirectionalClassBalancedScore"]
        )

    refinement_config = replace(
        config,
        continuous_refinement_yaw_window_degrees=min(
            config.continuous_refinement_yaw_window_degrees,
            config.plane_refinement_yaw_window_degrees,
        ),
        continuous_refinement_translation_window_m=min(
            config.continuous_refinement_translation_window_m,
            config.plane_refinement_translation_window_m,
        ),
    )
    refined_rotation, refined_translation, refinement = _refine_structural_zup_candidate(
        source,
        target,
        best_rotation,
        best_translation,
        reflection,
        config=refinement_config,
        np=np,
        cKDTree=cKDTree,
    )
    refined_metrics = evaluate_structural_alignment(
        source,
        target,
        refined_rotation,
        refined_translation,
        np=np,
        cKDTree=cKDTree,
    )
    refined_score = float(refined_metrics["bidirectionalClassBalancedScore"])
    refined_wall_only_score = 0.5 * (
        float(refined_metrics["sourceToTarget"]["classes"]["wall"]["score"])
        + float(refined_metrics["targetToSource"]["classes"]["wall"]["score"])
    )
    refinement["reportedScoreAfterRefinement"] = refined_score
    refinement["reportedMinusOptimizerObjectiveScore"] = float(
        refined_score - refinement["finalScore"]
    )
    refinement["reportedScoringPathIsAuthoritative"] = False
    refinement["allClassReportedScoreCannotAcceptOrRejectYawXYRefinement"] = True
    refinement["wallOnlyAcceptanceScoreBeforeRefinement"] = best_wall_only_score
    refinement["wallOnlyAcceptanceScoreAfterRefinement"] = refined_wall_only_score
    refined_yaw_without_reflection = refined_rotation @ reflection
    refined_yaw = math.atan2(
        float(refined_yaw_without_reflection[1, 0]),
        float(refined_yaw_without_reflection[0, 0]),
    )
    refined_hypothesis = PlaneHypothesis(
        yaw_radians=refined_yaw,
        translation=refined_translation,
        source_seed_plane_ids=best_hypothesis.source_seed_plane_ids,
        target_seed_plane_ids=best_hypothesis.target_seed_plane_ids,
        mirrored=mirrored,
    )
    refined_plane_score, refined_plane_evidence = _score_plane_hypothesis(
        base,
        target,
        source_inventory,
        target_inventory,
        refined_hypothesis,
        full_patch_score=True,
        config=config,
        linear_sum_assignment=linear_sum_assignment,
        np=np,
        cKDTree=cKDTree,
    )
    refinement["planeAwareScoreBeforeRefinementMeters"] = float(best[0])
    refinement["planeAwareScoreAfterRefinementMeters"] = (
        float(refined_plane_score) if math.isfinite(refined_plane_score) else None
    )
    plane_preserved = math.isfinite(refined_plane_score) and refined_plane_score <= (
        float(best[0]) + config.plane_refinement_max_score_increase_m
    )
    broad_preserved = refined_wall_only_score <= best_wall_only_score + 1e-10
    if not plane_preserved or not broad_preserved:
        refined_rotation = best_rotation
        refined_translation = best_translation
        refined_score = best_reported_score
        refined_plane_score = float(best[0])
        refined_plane_evidence = best[3]
        refinement["acceptedByWallOnlyScoringPath"] = False
    else:
        refinement["acceptedByWallOnlyScoringPath"] = True
    refinement["acceptedByPlaneAwareScoringPath"] = bool(plane_preserved)
    refinement["boundedAroundDistinctPlaneHypothesis"] = True
    determinant = float(np.linalg.det(refined_rotation))
    expected_sign = -1.0 if mirrored else 1.0
    if determinant * expected_sign <= 0.0 or abs(abs(determinant) - 1.0) > 1e-8:
        fail("HANDEDNESS_FAMILY_DRIFT", "structural fit left its declared handedness family")
    if not np.allclose(refined_rotation[:, 2], np.array([0.0, 0.0, 1.0]), atol=1e-10):
        fail("GRAVITY_FAMILY_DRIFT", "structural fit left the fixed +Z-up family")
    return refined_rotation, refined_translation, {
        "family": "improper_mirror_forbidden" if mirrored else "proper_zup",
        "fixedScale": 1.0,
        "fitMethod": "distinct wall-plane pair hypotheses with one-to-one patch scoring",
        "trimFraction": None,
        "selectedDiscreteHypothesisIndex": int(best[1]),
        "discreteCandidateFitScore": best_reported_score,
        "fitScore": refined_score,
        "runnerUpFitScore": runner_up_reported_score,
        "iterationCount": 0,
        "selectedIterations": [],
        "distinctPlaneFit": {
            "sourceInventory": source_inventory_evidence,
            "targetInventory": target_inventory_evidence,
            "hypothesisGeneration": hypothesis_evidence,
            "cheapAssessableHypothesisCount": len(cheap_candidates),
            "cheapScoreNonfiniteRejectedHypothesisCount": rejected_hypothesis_count,
            "fullScoreAttemptCount": full_score_attempt_count,
            "fullScoreFiniteResultCount": len(full_candidates),
            "fullScoreNonfiniteRejectedCount": full_score_nonfinite_count,
            "attemptedFullScoreForEveryCheapAssessableHypothesis": (
                full_score_attempt_count == len(cheap_candidates)
            ),
            "selectedPlaneAwareScoreMeters": float(refined_plane_score),
            "selectedPlaneEvidence": refined_plane_evidence,
            "runnerUpPlaneAwareScoreMeters": float(runner_up[0]) if runner_up is not None else None,
            "runnerUpSeparationMeters": (
                float(runner_up[0] - best[0]) if runner_up is not None else None
            ),
            "withinFamilyNearTie": bool(
                runner_up is not None
                and float(runner_up[0] - best[0])
                <= max(config.handedness_min_absolute_advantage, 0.05 * float(best[0]))
            ),
            "floorAndTopCeilingUsedOnlyForZFamilyChecks": True,
            "floorUsedForZTranslation": True,
            "topCeilingEnvelopeUsedForFixedScaleCheck": True,
            "reportedSecondaryCeilingBandsUsedForFit": False,
            "ceilingLevelsUsedForZTranslation": False,
            "zTranslationFrozenDuringContinuousRefinement": True,
            "horizontalSurfacesUsedForYawOrXYTranslation": False,
            "classWideNearestWallIcpUsedAsProof": False,
        },
        "continuousRefinement": refinement,
    }


def build_structural_diagnostic(
    source: SurfaceSet,
    fit_target: SurfaceSet,
    validation_target: SurfaceSet,
    *,
    config: StructuralConfig,
    np: Any,
    cKDTree: Any,
    validation_by_scan: Mapping[int, SurfaceSet] | None = None,
) -> tuple[dict[str, Any], dict[str, SurfaceSet]]:
    proper_rotation, proper_translation, proper_trace = fit_structural_zup_family(
        source, fit_target, mirrored=False, config=config, np=np, cKDTree=cKDTree
    )
    mirror_rotation, mirror_translation, mirror_trace = fit_structural_zup_family(
        source, fit_target, mirrored=True, config=config, np=np, cKDTree=cKDTree
    )
    proper_fit = evaluate_structural_alignment(
        source, fit_target, proper_rotation, proper_translation, np=np, cKDTree=cKDTree
    )
    mirror_fit = evaluate_structural_alignment(
        source, fit_target, mirror_rotation, mirror_translation, np=np, cKDTree=cKDTree
    )
    proper_validation_full = evaluate_structural_alignment(
        source, validation_target, proper_rotation, proper_translation, np=np, cKDTree=cKDTree
    )
    mirror_validation_full = evaluate_structural_alignment(
        source, validation_target, mirror_rotation, mirror_translation, np=np, cKDTree=cKDTree
    )
    crop_low, crop_high, crop_evidence = derive_fit_supported_crop(fit_target, np=np)
    proper_validation, proper_overlay, validation_overlay = evaluate_in_fit_supported_crop(
        source,
        validation_target,
        proper_rotation,
        proper_translation,
        crop_low,
        crop_high,
        normal_compatibility_min_abs_dot=config.normal_alignment_min_abs_dot,
        np=np,
        cKDTree=cKDTree,
    )
    mirror_validation, mirror_overlay, mirror_validation_overlay = evaluate_in_fit_supported_crop(
        source,
        validation_target,
        mirror_rotation,
        mirror_translation,
        crop_low,
        crop_high,
        normal_compatibility_min_abs_dot=config.normal_alignment_min_abs_dot,
        np=np,
        cKDTree=cKDTree,
    )
    if validation_overlay.points.shape != mirror_validation_overlay.points.shape or not np.array_equal(
        validation_overlay.points, mirror_validation_overlay.points
    ):
        fail("INTERNAL_CROP_DRIFT", "proper and mirror controls saw different validation crop points")
    per_scan_validation = (
        evaluate_validation_scans_separately(
            source,
            validation_by_scan,
            proper_rotation,
            proper_translation,
            mirror_rotation,
            mirror_translation,
            crop_low,
            crop_high,
            config=config,
            np=np,
            cKDTree=cKDTree,
        )
        if validation_by_scan is not None
        else {"notProvided": True}
    )
    proper_score = proper_validation["bidirectionalClassBalancedScore"]
    mirror_score = mirror_validation["bidirectionalClassBalancedScore"]
    absolute_margin = float(mirror_score - proper_score)
    relative_margin = float(absolute_margin / max(proper_score, 1e-12))
    score_tie_limit = max(
        config.handedness_min_absolute_advantage,
        config.handedness_min_relative_advantage
        * max(min(proper_score, mirror_score), 1e-12),
    )
    if absolute_margin > score_tie_limit:
        sample_preference = "proper_candidate_lower_score"
    elif absolute_margin < -score_tie_limit:
        sample_preference = "forbidden_mirror_lower_score"
    else:
        sample_preference = "sample_scores_tied"
    proper_plane_trace = proper_trace["distinctPlaneFit"]
    mirror_plane_trace = mirror_trace["distinctPlaneFit"]
    proper_plane_score = float(proper_plane_trace["selectedPlaneAwareScoreMeters"])
    mirror_plane_score = float(mirror_plane_trace["selectedPlaneAwareScoreMeters"])
    plane_margin = mirror_plane_score - proper_plane_score
    plane_tie_limit = max(
        config.handedness_min_absolute_advantage,
        config.handedness_min_relative_advantage
        * max(min(proper_plane_score, mirror_plane_score), 1e-12),
    )
    if bool(proper_plane_trace["withinFamilyNearTie"]):
        structural_ambiguity_state = "proper_transform_nonunique"
    elif abs(plane_margin) <= plane_tie_limit:
        structural_ambiguity_state = "mirror_tie_underdetermined"
    elif plane_margin > 0.0:
        structural_ambiguity_state = "proper_structural_candidate_lower_score"
    else:
        structural_ambiguity_state = "forbidden_mirror_lower_score"
    document = {
        "authority": "none",
        "status": "private_structural_cv_diagnostic_t505_blocked",
        "resultType": "not_a_transform_artifact_or_approval",
        "fit": {
            "method": (
                "distinct wall-plane pair hypotheses with one-to-one patch, extent, and occupancy scoring; "
                "the floor fixes Z, the independently extracted highest multiwall-supported ceiling envelope checks fixed scale, "
                "lower stepped ceiling bands are report-only, "
                "and horizontal surfaces never steer yaw or XY; fixed scale and +Z-up"
            ),
            "usesOnlyFrozenFitScans": list(FIT_SCAN_IDS),
            "validationUsedDuringFit": False,
            "testUsedDuringFitOrEvaluation": False,
            "properCandidate": {
                "transform": _matrix_evidence(proper_rotation, proper_translation, np),
                "trace": proper_trace,
                "fitMetrics": proper_fit,
            },
            "forbiddenMirrorControl": {
                "transform": _matrix_evidence(mirror_rotation, mirror_translation, np),
                "trace": mirror_trace,
                "fitMetrics": mirror_fit,
                "mayNeverBeRegisteredOrUsedAsPhysicalTransform": True,
            },
            "planeAwareAmbiguityOnFitSurfaces": {
                "state": structural_ambiguity_state,
                "properPlaneScoreMeters": proper_plane_score,
                "forbiddenMirrorPlaneScoreMeters": mirror_plane_score,
                "properAdvantageMeters": float(plane_margin),
                "tieLimitMeters": float(plane_tie_limit),
                "properWithinFamilyNearTie": bool(
                    proper_plane_trace["withinFamilyNearTie"]
                ),
                "mirrorWithinFamilyNearTie": bool(
                    mirror_plane_trace["withinFamilyNearTie"]
                ),
                "oneToOnePlaneIdentitiesUsed": True,
                "openingEvidenceMethod": "matched-plane tangent/Z occupancy cells",
                "usesFitSurfacesOnly": True,
                "usesValidationSurfaces": False,
                "cannotSubstituteForFrozenValidation": True,
                "provesPhysicalHandedness": False,
            },
        },
        "frozenValidation": {
            "scanIds": list(VALIDATION_SCAN_IDS),
            "usedDuringFit": False,
            "fitSupportedCropFrozenBeforeValidation": crop_evidence,
            "properCandidateMetricsInFitSupportedCrop": proper_validation,
            "forbiddenMirrorMetricsInFitSupportedCrop": mirror_validation,
            "uncroppedCoverageSensitivity": {
                "properCandidateMetrics": proper_validation_full,
                "forbiddenMirrorMetrics": mirror_validation_full,
            },
            "perScanEvaluation": per_scan_validation,
            "samplePreference": sample_preference,
            "samplePreferenceTieLimit": {
                "classBalancedScore": float(score_tie_limit),
                "minimumAbsoluteAdvantage": config.handedness_min_absolute_advantage,
                "minimumRelativeAdvantage": config.handedness_min_relative_advantage,
                "tinyNumericalDifferencesAreIndeterminate": True,
            },
            "properAdvantageOverMirror": {
                "absoluteClassBalancedScore": absolute_margin,
                "relativeToProperScore": relative_margin,
                "positiveMeansProperLowerAndBetter": True,
            },
            "provesPhysicalHandedness": False,
        },
        "frozenTest": {
            "scanIds": list(TEST_SCAN_IDS),
            "geometryRequested": False,
            "geometryDecoded": False,
            "geometrySampled": False,
            "geometryRendered": False,
            "geometryFitted": False,
            "geometryScored": False,
        },
        "decision": {
            "eligibleForT505Completion": False,
            "eligibleForTransformRegistration": False,
            "eligibleForTraining": False,
            "eligibleForRuntime": False,
            "eligibleForPublication": False,
            "plainLanguage": (
                "This is a computer-vision measuring experiment, not an approved alignment. "
                "It cannot change the scan, start training, or enter the product."
            ),
            "remainingGates": [
                "reviewed point-level Reception boundary and fit-supported crop",
                "independent metric controls",
                "physical handedness control",
                "authoritative rights approval",
                "qualified human review of fixed views",
                "reviewed T-505 accuracy contract",
            ],
        },
        "limitations": [
            "Repeated or nearly rectangular walls can make proper and mirrored rooms look equally good.",
            "Gaussian scale, opacity, quaternion, coordinate, and metre conventions are assumptions bound to this source layout.",
            "Local PCA normals depend on deterministic sample density and neighborhood size.",
            "Nearest-surface scores are not surveyed control-point errors.",
            "Floor and top-ceiling-envelope classification assumes both sources are already +Z-up.",
        ],
    }
    overlays = {
        "validation": validation_overlay,
        "proper": proper_overlay,
        "mirror": mirror_overlay,
    }
    return document, overlays


def _sample_for_render(surface_set: SurfaceSet, limit: int, seed: str, np: Any) -> SurfaceSet:
    indexes = _get_alignment()._deterministic_indices(int(surface_set.points.shape[0]), limit, seed)
    indexes = np.asarray(indexes, dtype=np.int64)
    return SurfaceSet(
        surface_set.points[indexes],
        surface_set.normals[indexes],
        surface_set.labels[indexes],
        surface_set.weights[indexes],
    )


def render_comparison_png(
    overlays: Mapping[str, SurfaceSet], projection: str, *, np: Any
) -> bytes:
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError as error:
        fail("PILLOW_UNAVAILABLE", "visual overlays require Pillow")
        raise AssertionError from error
    if projection not in {"top", "side"}:
        fail("INVALID_PROJECTION", "projection must be top or side")
    sampled = {
        key: _sample_for_render(value, 20_000, f"render-{projection}-{key}", np)
        for key, value in overlays.items()
    }
    axes = (0, 1) if projection == "top" else (0, 2)
    all_projected = np.vstack([value.points[:, axes] for value in sampled.values()])
    low = np.percentile(all_projected, 1.0, axis=0, method="linear")
    high = np.percentile(all_projected, 99.0, axis=0, method="linear")
    span = np.maximum(high - low, 1e-3)
    margin = 0.08 * span
    low -= margin
    high += margin
    width, height = 1600, 900
    panel_width = width // 2
    image = Image.new("RGB", (width, height), (9, 15, 25))
    draw = ImageDraw.Draw(image, "RGBA")
    font = ImageFont.load_default()
    colors = {"validation": (56, 189, 248, 170), "proper": (251, 146, 60, 155), "mirror": (244, 114, 182, 155)}
    for panel, candidate in enumerate(("proper", "mirror")):
        left = panel * panel_width
        draw.rectangle((left, 0, left + panel_width - 1, height - 1), outline=(71, 85, 105, 255), width=2)
        draw.text(
            (left + 18, 16),
            f"{projection.upper()} | E57 validation (blue) + {candidate} candidate",
            fill=(226, 232, 240, 255),
            font=font,
        )
        for key in ("validation", candidate):
            projected = sampled[key].points[:, axes]
            x = left + 24 + (projected[:, 0] - low[0]) / (high[0] - low[0]) * (panel_width - 48)
            y = height - 28 - (projected[:, 1] - low[1]) / (high[1] - low[1]) * (height - 78)
            color = colors[key]
            for px, py in zip(x.astype(int), y.astype(int), strict=True):
                draw.point((int(px), int(py)), fill=color)
    draw.text(
        (18, height - 18),
        PRIVATE_BLOCKED_BANNER,
        fill=(248, 113, 113, 255),
        font=font,
    )
    output = io.BytesIO()
    image.save(output, format="PNG", optimize=False)
    return output.getvalue()


def _seal(document: dict[str, Any]) -> dict[str, Any]:
    unsigned = copy.deepcopy(document)
    unsigned.pop("receipt", None)
    document["receipt"] = {
        "algorithm": "SHA-256",
        "domain": "OMNITWIN_RECEPTION_E57_XGRIDS_STRUCTURAL_CV_V1\\0",
        "sha256": _sha256_bytes(RECEIPT_DOMAIN + _canonical_json_bytes(unsigned)),
        "isSignature": False,
        "authenticatesCreatorOrTruth": False,
    }
    return document


def _artifact_paths(output: Path) -> dict[str, Path]:
    if output.suffix.lower() != ".json":
        fail("INVALID_OUTPUT_PATH", "output must end in .json")
    return {
        "receipt": output,
        "top": output.with_name(output.stem + "-top.png"),
        "side": output.with_name(output.stem + "-side.png"),
    }


def _write_artifacts_create_only(
    paths: Mapping[str, Path],
    payloads: Mapping[str, bytes],
    *,
    protected_paths: Iterable[Path],
    protected_roots: Iterable[Path],
) -> None:
    if set(paths) != set(payloads):
        fail("INTERNAL_ARTIFACT_ERROR", "artifact paths and payloads differ")
    resolved: dict[str, Path] = {}
    parents: set[Path] = set()
    for key, raw_path in paths.items():
        if raw_path.exists() or raw_path.is_symlink():
            fail("OUTPUT_EXISTS", f"{key} output already exists")
        helper = _get_alignment()
        helper._assert_no_link_ancestors(raw_path.parent, f"{key} output path")
        parent = raw_path.parent.resolve(strict=True)
        if not parent.is_dir() or helper._is_link_like(parent):
            fail("UNSAFE_OUTPUT_PARENT", "output parent must be an existing non-link directory")
        resolved[key] = parent / raw_path.name
        parents.add(parent)
    if len(parents) != 1:
        fail("OUTPUT_PARENT_MISMATCH", "all structural artifacts must share one directory")
    protected_files = {path.resolve(strict=True) for path in protected_paths}
    for path in resolved.values():
        if path in protected_files:
            fail("OUTPUT_OVERLAPS_INPUT", "output path equals an input path")
        for root in protected_roots:
            if helper._is_within(path, root.resolve(strict=True)):
                fail("OUTPUT_OVERLAPS_SOURCE_ROOT", "output is inside a protected source root")
    temp_paths: dict[str, Path] = {}
    published: list[Path] = []
    publication_error: tuple[str, str] | None = None
    cleanup_failures: list[str] = []
    try:
        parent = next(iter(parents))
        for key in sorted(payloads):
            descriptor, name = tempfile.mkstemp(prefix=f".{resolved[key].name}.", suffix=".private-tmp", dir=parent)
            temp = Path(name)
            temp_paths[key] = temp
            with os.fdopen(descriptor, "wb") as target:
                target.write(payloads[key])
                target.flush()
                os.fsync(target.fileno())
        # PNG evidence is committed first.  The JSON receipt is the final
        # package commit marker and is never left behind without both images.
        publication_order = [key for key in ("top", "side", "receipt") if key in payloads]
        publication_order.extend(key for key in sorted(payloads) if key not in publication_order)
        for key in publication_order:
            os.link(temp_paths[key], resolved[key])
            published.append(resolved[key])
    except FileExistsError:
        publication_error = (
            "OUTPUT_EXISTS",
            "an output appeared during create-only publication",
        )
    except OSError as error:
        publication_error = (
            "OUTPUT_WRITE_FAILED",
            f"could not publish structural artifacts: {error}",
        )
    finally:
        if len(published) != len(payloads):
            for path in published:
                try:
                    path.unlink(missing_ok=True)
                except OSError as error:
                    cleanup_failures.append(
                        f"published artifact {path.name}: {type(error).__name__}"
                    )
        for path in temp_paths.values():
            try:
                path.unlink(missing_ok=True)
            except OSError as error:
                cleanup_failures.append(
                    f"temporary artifact {path.name}: {type(error).__name__}"
                )
    if cleanup_failures:
        original = (
            f" Original publication error: {publication_error[0]}."
            if publication_error is not None
            else ""
        )
        fail(
            "OUTPUT_CLEANUP_UNCONFIRMED",
            "artifact cleanup could not be confirmed; inspect these residual file names: "
            + ", ".join(cleanup_failures)
            + original,
        )
    if publication_error is not None:
        fail(*publication_error)


def _positive_int(maximum: int) -> Any:
    def parse(value: str) -> int:
        try:
            parsed = int(value, 10)
        except ValueError as error:
            raise argparse.ArgumentTypeError("must be an integer") from error
        if parsed <= 0 or parsed > maximum:
            raise argparse.ArgumentTypeError(f"must be from 1 to {maximum}")
        return parsed

    return parse


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="register_e57_xgrids_surfaces.py",
        description=(
            "Fit a private, authority-none wall/floor/ceiling computer-vision alignment diagnostic. "
            "Frozen test-station geometry is never decoded or scored; the complete E57 container is byte-hashed."
        ),
    )
    parser.add_argument("--stage-manifest", type=Path, required=True)
    parser.add_argument("--reception-evidence", type=Path, required=True)
    parser.add_argument("--xgrids-root", type=Path, required=True)
    parser.add_argument("--xgrids-ply", type=Path, required=True)
    parser.add_argument("--xgrids-poses", type=Path, required=True)
    parser.add_argument("--scan-range", required=True, help="must be 122-144")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--verify-e57-bytes", action="store_true", required=True)
    parser.add_argument("--expected-stage-manifest-sha256", required=True)
    parser.add_argument("--expected-reception-evidence-sha256", required=True)
    parser.add_argument("--expected-ply-sha256", required=True)
    parser.add_argument("--expected-poses-sha256", required=True)
    parser.add_argument("--points-per-scan", type=_positive_int(100_000), default=20_000)
    parser.add_argument("--pca-query-points-per-scan", type=_positive_int(20_000), default=4_000)
    parser.add_argument("--xgrids-sample-gaussians", type=_positive_int(2_000_000), default=160_000)
    return parser


def execute(
    argv: Sequence[str], *, e57_adapter: Any | None = None, write_output: bool = True
) -> dict[str, Any]:
    structural_tool_payload, structural_tool_evidence = _read_structural_tool_snapshot()
    pin = verify_alignment_tool_pin()
    arguments = build_parser().parse_args(list(argv))
    custom_e57_adapter_used = e57_adapter is not None
    if custom_e57_adapter_used and write_output:
        fail(
            "CUSTOM_E57_ADAPTER_PUBLICATION_FORBIDDEN",
            "an injected E57 adapter is outside the pinned geometry-decode boundary; it may be used only for a no-write diagnostic",
        )
    helper = _get_alignment()
    bundle = helper.inspect_inputs(arguments)
    helper._verify_expected_digests(arguments, bundle)
    np, _scipy, cKDTree, dependencies = helper._load_geometry_dependencies()
    config = StructuralConfig()
    gaussian, ply_evidence = load_gaussian_ply_sample(
        bundle.paths["xgridsPly"],
        bundle.snapshots["xgridsPly"],
        bundle.ply_layout,
        arguments.xgrids_sample_gaussians,
        bundle.evidence["xgridsPly"]["sha256"] + "-structural-cv-v1",
        np,
    )
    points, normals, weights, gaussian_filter = filter_gaussian_surfaces(
        gaussian["positions"],
        gaussian["opacityLogits"],
        gaussian["logScales"],
        gaussian["quaternionsWxyz"],
        config=config,
        np=np,
    )
    normal_convention = assess_gaussian_normal_convention(
        gaussian["positions"],
        gaussian["logScales"],
        gaussian["quaternionsWxyz"],
        query_limit=min(arguments.xgrids_sample_gaussians, 20_000),
        config=config,
        np=np,
        cKDTree=cKDTree,
    )
    if bool(normal_convention.get("useCovarianceNormalsForFit", False)):
        source_normal_method = {
            "method": "Gaussian covariance smallest axis",
            "covarianceNormalsUsedForFit": True,
            "sourcePositionLocalPcaFallbackUsed": False,
            "surfaceCount": int(points.shape[0]),
        }
    else:
        fallback_query_limit = min(int(points.shape[0]), 50_000)
        points, normals, weights, fallback_evidence = estimate_local_pca_surfaces(
            points,
            query_limit=fallback_query_limit,
            seed=bundle.evidence["xgridsPly"]["sha256"] + "-source-local-pca-v1",
            config=config,
            np=np,
            cKDTree=cKDTree,
        )
        source_normal_method = {
            "method": "source-position deterministic local PCA",
            "covarianceNormalsUsedForFit": False,
            "sourcePositionLocalPcaFallbackUsed": True,
            "fallbackQueryLimit": fallback_query_limit,
            "fallbackEvidence": fallback_evidence,
            "plainLanguage": (
                "The Gaussian rotation fields did not agree strongly enough with nearby geometry, "
                "so the fit used surface directions measured from neighbouring XGRIDS positions."
            ),
        }
    mask_sensitivity = gaussian_mask_sensitivity(
        gaussian["positions"],
        gaussian["opacityLogits"],
        gaussian["logScales"],
        gaussian["quaternionsWxyz"],
        use_covariance_normals_for_classification=bool(
            normal_convention["useCovarianceNormalsForFit"]
        ),
        local_pca_seed_prefix=(
            bundle.evidence["xgridsPly"]["sha256"] + "-mask-local-pca-v1"
        ),
        local_pca_query_limit=30_000,
        config=config,
        np=np,
        cKDTree=cKDTree,
    )
    source, source_classification = classify_zup_surfaces(
        points, normals, weights, config=config, np=np
    )
    if any(scan in TEST_SCAN_IDS for scan in DIAGNOSTIC_SCAN_IDS):
        fail("INTERNAL_TEST_LEAK", "ordinary structural diagnostic requested a frozen test scan")
    points_by_scan, e57_read = helper._read_e57_point_samples(
        bundle.paths["e57"],
        bundle.snapshots["e57"],
        DIAGNOSTIC_SCAN_IDS,
        arguments.points_per_scan,
        np,
        e57_adapter,
    )
    expected_range = set(range(122, 145))
    assigned_range = (
        set(FIT_SCAN_IDS)
        | set(VALIDATION_SCAN_IDS)
        | set(TEST_SCAN_IDS)
        | set(UNASSIGNED_EXCLUDED_SCAN_IDS)
    )
    if assigned_range != expected_range:
        fail("INTERNAL_SCAN_ROLE_GAP", "scan roles do not account for every scan from 122 through 144")
    try:
        metadata = importlib.import_module("importlib.metadata")
        dependencies["pye57"] = str(metadata.version("pye57"))
        dependencies["Pillow"] = str(metadata.version("Pillow"))
    except Exception as error:
        fail("DEPENDENCY_VERSION_UNAVAILABLE", f"could not resolve image/E57 dependency versions: {error}")
    adapter_evidence = dict(e57_read.get("adapter", {}))
    adapter_evidence["customInjectedAdapterUsed"] = custom_e57_adapter_used
    adapter_evidence["decodeBoundaryEnforcedByPinnedDefaultAdapter"] = not custom_e57_adapter_used
    if not custom_e57_adapter_used:
        adapter_evidence["version"] = dependencies["pye57"]
        adapter_evidence["versionSource"] = "importlib.metadata distribution pye57"
    else:
        adapter_evidence["injectedAdapterInternalDecodeScopeIndependentlyVerified"] = False
        adapter_evidence["publicationPermitted"] = False
    adapter_evidence["moduleReprPathDiscarded"] = True
    e57_read["adapter"] = adapter_evidence
    fit_mapping = {scan: points_by_scan[scan] for scan in FIT_SCAN_IDS}
    validation_mapping = {scan: points_by_scan[scan] for scan in VALIDATION_SCAN_IDS}
    fit_target, fit_evidence, _fit_by_scan_surfaces = e57_surface_set_from_scans(
        fit_mapping,
        "fit",
        query_limit_per_scan=arguments.pca_query_points_per_scan,
        config=config,
        np=np,
        cKDTree=cKDTree,
    )
    validation_target, validation_evidence, validation_by_scan_surfaces = e57_surface_set_from_scans(
        validation_mapping,
        "validation",
        query_limit_per_scan=arguments.pca_query_points_per_scan,
        config=config,
        np=np,
        cKDTree=cKDTree,
    )
    diagnostic, overlays = build_structural_diagnostic(
        source,
        fit_target,
        validation_target,
        config=config,
        np=np,
        cKDTree=cKDTree,
        validation_by_scan=validation_by_scan_surfaces,
    )
    diagnostic["frozenTest"].update(
        {
            "completeE57ContainerBytesReadForWholeFileHashVerification": True,
            "wholeFileHashingDecodedStationGeometry": False,
            "customE57AdapterUsed": custom_e57_adapter_used,
            "geometryDecodeStatus": (
                "not decoded by pinned default adapter"
                if not custom_e57_adapter_used
                else "not independently verifiable inside injected adapter"
            ),
        }
    )
    if custom_e57_adapter_used:
        for field in (
            "geometryDecoded",
            "geometrySampled",
            "geometryRendered",
            "geometryFitted",
            "geometryScored",
        ):
            diagnostic["frozenTest"][field] = None
    top_png = render_comparison_png(overlays, "top", np=np)
    side_png = render_comparison_png(overlays, "side", np=np)
    paths = _artifact_paths(arguments.output)
    document = {
        "schemaVersion": SCHEMA_VERSION,
        **diagnostic,
        "scope": {
            "roomLabel": "Reception Room",
            "roomIdentificationBasis": "operator objective asserts E57 scans 122-144 are Reception",
            "roomIdentityQuestionedByThisDiagnostic": False,
            "scanRange": "122-144",
            "fitScanIds": list(FIT_SCAN_IDS),
            "validationScanIds": list(VALIDATION_SCAN_IDS),
            "testScanIdsNotRequestedByThisTool": list(TEST_SCAN_IDS),
            "testScanGeometryDecodeSampleRenderFitScoreStatus": (
                "not performed under the pinned default adapter"
                if not custom_e57_adapter_used
                else "not independently verifiable inside injected adapter"
            ),
            "unassignedExcludedScanIds": list(UNASSIGNED_EXCLUDED_SCAN_IDS),
            "unassignedExclusionReason": (
                "These range members are outside the frozen fit/validation/test roles; no station "
                "geometry was requested or decoded for this diagnostic. Scan 122 was boundary-only "
                "context in T-516, while 123 and 140 remain unassigned context."
            ),
            "geometryRequestedScanIds": list(DIAGNOSTIC_SCAN_IDS),
            "requestedScanIdsEqualDecodedScanIdsUnderPinnedDefaultAdapter": (
                not custom_e57_adapter_used
            ),
            "completeContainerBytesReadForWholeFileHashVerification": True,
        },
        "inputEvidence": bundle.evidence,
        "surfaceEvidence": {
            "gaussianPly": ply_evidence,
            "gaussianFilter": gaussian_filter,
            "gaussianNormalConventionCrossCheck": normal_convention,
            "gaussianSourceNormalMethod": source_normal_method,
            "gaussianMaskSensitivity": mask_sensitivity,
            "gaussianClassification": source_classification,
            "e57Read": e57_read,
            "e57Fit": fit_evidence,
            "e57Validation": validation_evidence,
        },
        "runtime": {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "dependencies": dependencies,
            "structuralTool": structural_tool_evidence,
            "pinnedAlignmentTool": pin,
            "configuration": {
                name: getattr(config, name) for name in config.__dataclass_fields__
            },
        },
        "safety": {
            "sourceMutationPermitted": False,
            "sourceMutationPerformed": False,
            "completeE57ContainerBytesReadForHashVerification": True,
            "frozenTestStationGeometryDecodedOrUsed": (
                False if not custom_e57_adapter_used else None
            ),
            "frozenTestStationGeometryDecodeStatus": (
                "not decoded or used under the pinned default adapter"
                if not custom_e57_adapter_used
                else "unknown inside injected adapter; output publication is forbidden"
            ),
            "networkPermitted": False,
            "networkPerformed": False,
            "trainingPermitted": False,
            "trainingPerformed": False,
            "transformApprovalOrRegistrationPermitted": False,
            "transformApprovalOrRegistrationPerformed": False,
            "outputTypes": ["authority-none JSON", "private PNG visual overlays"],
        },
        "artifacts": {
            "topOverlay": {"fileName": paths["top"].name, "sha256": _sha256_bytes(top_png)},
            "sideOverlay": {"fileName": paths["side"].name, "sha256": _sha256_bytes(side_png)},
        },
    }
    helper._verify_bundle_unchanged(bundle)
    try:
        current_structural_tool_payload = Path(__file__).resolve().read_bytes()
    except OSError as error:
        fail("STRUCTURAL_TOOL_UNREADABLE", f"could not re-read the running structural tool: {error}")
    if current_structural_tool_payload != structural_tool_payload:
        fail("STRUCTURAL_TOOL_CHANGED_DURING_RUN", "structural tool bytes changed during diagnosis")
    document = _seal(document)
    if write_output:
        receipt_bytes = json.dumps(
            document, allow_nan=False, ensure_ascii=False, indent=2, sort_keys=True
        ).encode("utf-8") + b"\n"
        _write_artifacts_create_only(
            paths,
            {"receipt": receipt_bytes, "top": top_png, "side": side_png},
            protected_paths=bundle.paths.values(),
            protected_roots=bundle.protected_roots,
        )
    return document


def main(argv: Sequence[str] | None = None) -> int:
    selected = list(sys.argv[1:] if argv is None else argv)
    try:
        document = execute(selected)
        sys.stdout.write(
            json.dumps(
                {
                    "authority": "none",
                    "receiptSha256": document["receipt"]["sha256"],
                    "status": document["status"],
                    "t505Eligible": False,
                },
                separators=(",", ":"),
                sort_keys=True,
            )
            + "\n"
        )
        return 0
    except SurfaceAlignmentError as error:
        artifact_state_requires_inspection = error.code.startswith("OUTPUT_")
        sys.stdout.write(
            json.dumps(
                {
                    "error": {"code": error.code, "message": error.message},
                    "schemaVersion": SCHEMA_VERSION,
                    "status": (
                        "error_artifact_state_requires_inspection"
                        if artifact_state_requires_inspection
                        else "error_no_artifacts_created"
                    ),
                    "artifactsConfirmedAbsent": (
                        False if artifact_state_requires_inspection else True
                    ),
                },
                separators=(",", ":"),
                sort_keys=True,
            )
            + "\n"
        )
        return 2
    except Exception as error:  # pragma: no cover - helper errors and last-resort secrecy boundary
        if hasattr(error, "code") and hasattr(error, "message"):
            error_code = str(error.code)
            artifact_state_requires_inspection = error_code.startswith("OUTPUT_")
            sys.stdout.write(
                json.dumps(
                    {
                        "error": {"code": error_code, "message": str(error.message)},
                        "schemaVersion": SCHEMA_VERSION,
                        "status": (
                            "error_artifact_state_requires_inspection"
                            if artifact_state_requires_inspection
                            else "error_no_artifacts_created"
                        ),
                        "artifactsConfirmedAbsent": (
                            False if artifact_state_requires_inspection else True
                        ),
                    },
                    separators=(",", ":"),
                    sort_keys=True,
                )
                + "\n"
            )
            return 2
        sys.stdout.write(
            json.dumps(
                {
                    "error": {"code": "INTERNAL_ERROR", "message": f"unexpected {type(error).__name__}"},
                    "schemaVersion": SCHEMA_VERSION,
                    "status": "error_no_artifacts_created",
                },
                separators=(",", ":"),
                sort_keys=True,
            )
            + "\n"
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
