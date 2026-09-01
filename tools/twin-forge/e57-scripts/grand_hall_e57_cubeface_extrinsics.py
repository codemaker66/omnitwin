"""Pose-blind cubeface orientation recovery from coloured E57 points.

The scoring API in this module has no representation for an E57 Image2D pose.
It accepts only scanner-local coloured points and decoded cubeface pixels.  That
boundary is deliberate: a caller cannot accidentally make a stored Image2D
transform influence the recovered signed-axis basis.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import itertools
import math
from typing import Sequence

import numpy as np
from numpy.typing import NDArray


RESULT_SCHEMA = "venviewer.e57-cubeface-extrinsics-authority-none.v1"
AXIS_LABELS = ("+x", "-x", "+y", "-y", "+z", "-z")
CANONICAL_FACE_BASIS_IDS = (
    "r-y_d+x_f+z",
    "r-y_d-z_f+x",
    "r-x_d-z_f-y",
    "r+y_d-z_f-x",
    "r+x_d-z_f+y",
    "r-y_d-x_f-z",
)


@dataclass(frozen=True)
class ScoringThresholds:
    minimum_samples_per_face: int = 10_000
    minimum_coverage_bins: int = 32
    minimum_luminance_ncc: float = 0.90
    minimum_ncc_margin: float = 0.15
    maximum_rgb_mae: float = 8.0
    minimum_runner_mae_ratio: float = 2.0


@dataclass(frozen=True)
class CameraIntrinsics:
    width: int = 4096
    height: int = 4096
    focal_x: float = 2048.0
    focal_y: float = 2048.0
    principal_x: float = 2048.0
    principal_y: float = 2048.0


@dataclass(frozen=True)
class SignedAxisBasis:
    basis_id: str
    right: tuple[int, int, int]
    down: tuple[int, int, int]
    forward: tuple[int, int, int]
    determinant: int

    def matrix(self) -> NDArray[np.float64]:
        """Return scanner-from-camera rotation with [right, down, forward] columns."""
        return np.asarray(
            [self.right, self.down, self.forward], dtype=np.float64
        ).T


@dataclass(frozen=True)
class BasisScore:
    basis_id: str
    determinant: int
    sample_count: int
    coverage_bin_count: int
    luminance_ncc: float | None
    rgb_mae: float | None


@dataclass(frozen=True)
class FaceSolve:
    face_index: int
    winner: BasisScore
    runner_up: BasisScore
    scores: tuple[BasisScore, ...]


@dataclass(frozen=True)
class ScannerSample:
    points: NDArray[np.float64]
    colors: NDArray[np.uint8]
    row_indices: NDArray[np.uint16]
    column_indices: NDArray[np.uint16]
    digest: str


def _axis_label(vector: tuple[int, int, int]) -> str:
    axes = ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1))
    return AXIS_LABELS[axes.index(vector)]


def enumerate_signed_axis_bases() -> tuple[SignedAxisBasis, ...]:
    """Enumerate all 48 signed permutation bases in a stable order."""
    axes = (
        (1, 0, 0),
        (-1, 0, 0),
        (0, 1, 0),
        (0, -1, 0),
        (0, 0, 1),
        (0, 0, -1),
    )
    result: list[SignedAxisBasis] = []
    for right, down, forward in itertools.product(axes, repeat=3):
        matrix = np.asarray([right, down, forward], dtype=np.int8).T
        gram = matrix.T @ matrix
        if not np.array_equal(gram, np.eye(3, dtype=np.int8)):
            continue
        determinant = int(round(float(np.linalg.det(matrix))))
        basis_id = (
            f"r{_axis_label(right)}_d{_axis_label(down)}_f{_axis_label(forward)}"
        )
        result.append(SignedAxisBasis(basis_id, right, down, forward, determinant))
    result.sort(key=lambda item: item.basis_id)
    if len(result) != 48 or len({item.basis_id for item in result}) != 48:
        raise RuntimeError("signed-axis basis enumeration is not the complete 48-element set")
    return tuple(result)


SIGNED_AXIS_BASES = enumerate_signed_axis_bases()
BASIS_BY_ID = {item.basis_id: item for item in SIGNED_AXIS_BASES}


def deterministic_scanner_sample(
    points: NDArray[np.floating],
    colors: NDArray[np.integer],
    row_indices: NDArray[np.integer],
    column_indices: NDArray[np.integer],
    invalid_state: NDArray[np.integer],
    *,
    modulus: int = 8,
    minimum_range_m: float = 0.0,
) -> ScannerSample:
    """Select a stable row/column lattice from scanner-local coloured points."""
    if modulus <= 0 or not math.isfinite(minimum_range_m) or minimum_range_m < 0:
        raise ValueError("sampling modulus and minimum range must be valid")
    arrays = (points, colors, row_indices, column_indices, invalid_state)
    lengths = {len(value) for value in arrays}
    if len(lengths) != 1:
        raise ValueError("point, colour, row, column, and invalid-state arrays must align")
    point_values = np.asarray(points, dtype=np.float64)
    color_values = np.asarray(colors)
    rows = np.asarray(row_indices)
    columns = np.asarray(column_indices)
    invalid = np.asarray(invalid_state)
    if point_values.ndim != 2 or point_values.shape[1] != 3:
        raise ValueError("points must have shape (N,3)")
    if color_values.ndim != 2 or color_values.shape[1] != 3:
        raise ValueError("colours must have shape (N,3)")
    if rows.ndim != 1 or columns.ndim != 1 or invalid.ndim != 1:
        raise ValueError("row, column, and invalid-state arrays must be one-dimensional")
    if not np.isfinite(point_values).all():
        raise ValueError("scanner points contain NaN or infinity")
    if not np.issubdtype(color_values.dtype, np.integer):
        raise ValueError("scanner colours must be integral code values")
    if np.any(color_values < 0) or np.any(color_values > 255):
        raise ValueError("scanner colours must be uint8-range values")
    if (
        np.any(rows < 0)
        or np.any(columns < 0)
        or np.any(rows > np.iinfo(np.uint16).max)
        or np.any(columns > np.iinfo(np.uint16).max)
    ):
        raise ValueError("scanner row and column indices must fit unsigned 16-bit values")
    ranges = np.linalg.norm(point_values, axis=1)
    selected = (
        (invalid == 0)
        & (rows % modulus == 0)
        & (columns % modulus == 0)
        & (ranges > minimum_range_m)
    )
    indices = np.flatnonzero(selected)
    if indices.size == 0:
        raise ValueError("deterministic scanner sample is empty")
    order = np.lexsort((indices, columns[indices], rows[indices]))
    indices = indices[order]
    selected_rows = np.asarray(rows[indices], dtype=np.uint16)
    selected_columns = np.asarray(columns[indices], dtype=np.uint16)
    keys = (selected_rows.astype(np.uint64) << 32) | selected_columns.astype(np.uint64)
    if len(np.unique(keys)) != len(keys):
        raise ValueError("deterministic scanner sample has duplicate row/column identities")
    selected_points = np.asarray(point_values[indices], dtype="<f8", order="C")
    selected_colors = np.asarray(color_values[indices], dtype=np.uint8, order="C")
    selected_rows = np.asarray(selected_rows, dtype="<u2", order="C")
    selected_columns = np.asarray(selected_columns, dtype="<u2", order="C")
    digest = hashlib.sha256()
    digest.update(b"venviewer.e57-scanner-sample.v1\0")
    for value in (selected_rows, selected_columns, selected_points, selected_colors):
        digest.update(memoryview(value).cast("B"))
    return ScannerSample(
        selected_points,
        selected_colors,
        selected_rows,
        selected_columns,
        digest.hexdigest(),
    )


def _validate_image(image: NDArray[np.integer], intrinsics: CameraIntrinsics) -> NDArray[np.uint8]:
    value = np.asarray(image)
    if value.shape != (intrinsics.height, intrinsics.width, 3):
        raise ValueError("decoded cubeface shape differs from frozen intrinsics")
    if not np.issubdtype(value.dtype, np.integer) or np.any(value < 0) or np.any(value > 255):
        raise ValueError("decoded cubeface must contain uint8-range RGB values")
    return np.asarray(value, dtype=np.uint8)


def _luminance(rgb: NDArray[np.uint8]) -> NDArray[np.float64]:
    values = rgb.astype(np.float64)
    return values[:, 0] * 0.2126 + values[:, 1] * 0.7152 + values[:, 2] * 0.0722


def score_basis(
    sample: ScannerSample,
    image: NDArray[np.integer],
    basis: SignedAxisBasis,
    intrinsics: CameraIntrinsics = CameraIntrinsics(),
) -> BasisScore:
    pixels = _validate_image(image, intrinsics)
    camera = sample.points @ basis.matrix()
    depth = camera[:, 2]
    positive = depth > 1e-9
    x = np.full(depth.shape, -1.0, dtype=np.float64)
    y = np.full(depth.shape, -1.0, dtype=np.float64)
    x[positive] = intrinsics.principal_x + intrinsics.focal_x * (
        camera[positive, 0] / depth[positive]
    )
    y[positive] = intrinsics.principal_y + intrinsics.focal_y * (
        camera[positive, 1] / depth[positive]
    )
    inside = (
        positive
        & (x >= 0.0)
        & (x < intrinsics.width)
        & (y >= 0.0)
        & (y < intrinsics.height)
    )
    indices = np.flatnonzero(inside)
    if indices.size == 0:
        return BasisScore(basis.basis_id, basis.determinant, 0, 0, None, None)
    pixel_x = np.floor(x[indices]).astype(np.int64)
    pixel_y = np.floor(y[indices]).astype(np.int64)
    observed = pixels[pixel_y, pixel_x]
    expected = sample.colors[indices]
    difference = np.abs(observed.astype(np.int16) - expected.astype(np.int16))
    mae = float(np.mean(difference, dtype=np.float64))
    expected_luma = _luminance(expected)
    observed_luma = _luminance(observed)
    expected_luma -= float(np.mean(expected_luma))
    observed_luma -= float(np.mean(observed_luma))
    denominator = math.sqrt(
        float(np.dot(expected_luma, expected_luma))
        * float(np.dot(observed_luma, observed_luma))
    )
    ncc = None if denominator <= 1e-12 else float(np.dot(expected_luma, observed_luma) / denominator)
    bin_x = np.minimum((pixel_x * 8) // intrinsics.width, 7)
    bin_y = np.minimum((pixel_y * 8) // intrinsics.height, 7)
    coverage = int(np.unique(bin_y * 8 + bin_x).size)
    return BasisScore(
        basis.basis_id,
        basis.determinant,
        int(indices.size),
        coverage,
        ncc,
        mae,
    )


def _score_sort_key(value: BasisScore) -> tuple[float, float, str]:
    ncc = -2.0 if value.luminance_ncc is None else value.luminance_ncc
    mae = math.inf if value.rgb_mae is None else value.rgb_mae
    return (-ncc, mae, value.basis_id)


def solve_face(
    sample: ScannerSample,
    image: NDArray[np.integer],
    face_index: int,
    intrinsics: CameraIntrinsics = CameraIntrinsics(),
    thresholds: ScoringThresholds = ScoringThresholds(),
) -> FaceSolve:
    if face_index not in range(6):
        raise ValueError("cubeface index must be 0 through 5")
    scores = tuple(score_basis(sample, image, basis, intrinsics) for basis in SIGNED_AXIS_BASES)
    ranked = sorted(scores, key=_score_sort_key)
    winner, runner = ranked[:2]
    _require_face_gates(winner, runner, thresholds, face_index)
    return FaceSolve(face_index, winner, runner, scores)


def _require_face_gates(
    winner: BasisScore,
    runner: BasisScore,
    thresholds: ScoringThresholds,
    face_index: int,
) -> None:
    label = f"cubeface {face_index}"
    if winner.determinant != 1:
        raise ValueError(f"{label} winning basis is a reflection")
    if winner.sample_count < thresholds.minimum_samples_per_face:
        raise ValueError(f"{label} has insufficient projected samples")
    if winner.coverage_bin_count < thresholds.minimum_coverage_bins:
        raise ValueError(f"{label} has insufficient image coverage")
    if winner.luminance_ncc is None or winner.luminance_ncc < thresholds.minimum_luminance_ncc:
        raise ValueError(f"{label} luminance correlation is below threshold")
    if runner.luminance_ncc is None or winner.luminance_ncc - runner.luminance_ncc < thresholds.minimum_ncc_margin:
        raise ValueError(f"{label} winner/runner NCC margin is below threshold")
    if winner.rgb_mae is None or winner.rgb_mae > thresholds.maximum_rgb_mae:
        raise ValueError(f"{label} colour error is above threshold")
    if runner.rgb_mae is None or winner.rgb_mae < 0.0:
        raise ValueError(f"{label} colour-error ratio is undefined")
    if winner.rgb_mae == 0.0:
        if runner.rgb_mae == 0.0:
            raise ValueError(f"{label} colour-error ratio is ambiguous")
        return
    if runner.rgb_mae / winner.rgb_mae < thresholds.minimum_runner_mae_ratio:
        raise ValueError(f"{label} winner/runner colour-error ratio is below threshold")


def validate_cube_solution(face_solves: Sequence[FaceSolve]) -> tuple[str, ...]:
    if len(face_solves) != 6 or [item.face_index for item in face_solves] != list(range(6)):
        raise ValueError("cube solution must contain faces 0 through 5 in order")
    winners = tuple(item.winner.basis_id for item in face_solves)
    if len(set(winners)) != 6:
        raise ValueError("cube solution reuses a winning basis")
    bases = [BASIS_BY_ID[value] for value in winners]
    if any(item.determinant != 1 for item in bases):
        raise ValueError("cube solution contains a reflected basis")
    forwards = {item.forward for item in bases}
    required = {(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)}
    if forwards != required:
        raise ValueError("cube solution does not cover all six scanner-local directions")
    return winners


def quaternion_wxyz_to_rotation(value: Sequence[float]) -> tuple[NDArray[np.float64], float]:
    quaternion = np.asarray(value, dtype=np.float64)
    if quaternion.shape != (4,) or not np.isfinite(quaternion).all():
        raise ValueError("Data3D quaternion must be four finite wxyz values")
    norm = float(np.linalg.norm(quaternion))
    error = abs(norm - 1.0)
    if error > 1e-6 or norm == 0.0:
        raise ValueError("Data3D quaternion norm exceeds the frozen tolerance")
    w, x, y, z = quaternion / norm
    rotation = np.asarray(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ],
        dtype=np.float64,
    )
    orthogonality_error = float(np.max(np.abs(rotation.T @ rotation - np.eye(3))))
    determinant_error = abs(float(np.linalg.det(rotation)) - 1.0)
    if orthogonality_error > 1e-12 or determinant_error > 1e-12:
        raise ValueError("normalized Data3D rotation is not a proper orthogonal matrix")
    return rotation, error


def compose_camera_extrinsics(
    data3d_rotation: NDArray[np.float64],
    data3d_translation_m: Sequence[float],
    basis_id: str,
) -> dict[str, object]:
    translation = np.asarray(data3d_translation_m, dtype=np.float64)
    if translation.shape != (3,) or not np.isfinite(translation).all():
        raise ValueError("Data3D translation must contain three finite metre values")
    basis = BASIS_BY_ID.get(basis_id)
    if basis is None or basis.determinant != 1:
        raise ValueError("camera extrinsics require a known proper signed-axis basis")
    scanner_from_camera = basis.matrix()
    e57_from_camera = np.asarray(data3d_rotation, dtype=np.float64) @ scanner_from_camera
    camera_from_e57 = e57_from_camera.T
    camera_translation = -(camera_from_e57 @ translation)
    return {
        "basisId": basis_id,
        "cameraCenterE57M": translation.tolist(),
        "rotationE57FromCamera": e57_from_camera.tolist(),
        "rotationCameraFromE57": camera_from_e57.tolist(),
        "translationCameraFromE57M": camera_translation.tolist(),
    }


def basis_score_json(value: BasisScore) -> dict[str, object]:
    return {
        "basisId": value.basis_id,
        "coverageBinCount": value.coverage_bin_count,
        "determinant": value.determinant,
        "luminanceNcc": value.luminance_ncc,
        "rgbMae": value.rgb_mae,
        "sampleCount": value.sample_count,
    }


def face_solve_json(value: FaceSolve) -> dict[str, object]:
    return {
        "faceIndex": value.face_index,
        "runnerUp": basis_score_json(value.runner_up),
        "scores": [basis_score_json(item) for item in value.scores],
        "winner": basis_score_json(value.winner),
    }


def thresholds_json(value: ScoringThresholds) -> dict[str, object]:
    return {
        "maximumRgbMae": value.maximum_rgb_mae,
        "minimumCoverageBins": value.minimum_coverage_bins,
        "minimumLuminanceNcc": value.minimum_luminance_ncc,
        "minimumNccMargin": value.minimum_ncc_margin,
        "minimumRunnerMaeRatio": value.minimum_runner_mae_ratio,
        "minimumSamplesPerFace": value.minimum_samples_per_face,
    }
