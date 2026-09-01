"""Deterministic, authority-none panorama-to-E57 orientation mathematics.

NumPy is resolved only after T560's guarded runtime has loaded it.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import math
import re
import sys
from typing import Any, Sequence

RESULT_SCHEMA = "venviewer.grand-hall.panorama-e57-orientation-authority-none.v1"
MODEL_NAME = "deterministic_five_fold_spherical_rotation_authority_none_v1"
SCANNER_Y_REFLECTION = ((1., 0., 0.), (0., -1., 0.), (0., 0., 1.))
PANORAMA_FROM_CAMERA = ((0., 0., 1.), (1., 0., 0.), (0., -1., 0.))
CANONICAL_CUBEFACE_BASES = (
    ((0., -1., 0.), (1., 0., 0.), (0., 0., 1.)),
    ((0., -1., 0.), (0., 0., -1.), (1., 0., 0.)),
    ((-1., 0., 0.), (0., 0., -1.), (0., -1., 0.)),
    ((0., 1., 0.), (0., 0., -1.), (-1., 0., 0.)),
    ((1., 0., 0.), (0., 0., -1.), (0., 1., 0.)),
    ((0., -1., 0.), (-1., 0., 0.), (0., 0., -1.)),
)
AUTHORITY_NONE_GUARDS = {
    "authority": "none", "correspondenceAccepted": False,
    "e57CubefaceOrientationBasisAccepted": False, "e57ToObjTransformAccepted": False,
    "e57ToXgridsTransformAccepted": False, "externalPanoramaOrientationAccepted": False,
    "externalPanoramaPoseAccepted": False, "generatedContentUsed": False,
    "grandHallPixelMaskAccepted": False, "productionTrustPermitted": False,
    "providerInputPermitted": False, "publicationPermitted": False,
    "reconstructionInputPermitted": False, "roomMembershipAccepted": False,
    "runtimeInputPermitted": False, "stagingPermitted": False,
    "trainingInputPermitted": False,
}

@dataclass(frozen=True)
class OrientationThresholds:
    fold_count: int = 5
    fold_ransac_iterations: int = 450
    final_ransac_iterations: int = 900
    refit_cycles: int = 3
    inlier_threshold_degrees: float = 1.5
    minimum_correspondences: int = 100
    minimum_final_inliers: int = 100
    minimum_held_out_inliers: int = 100
    minimum_supported_faces: int = 3
    minimum_inliers_per_supported_face: int = 6

@dataclass(frozen=True)
class MatchPartition:
    panorama_sha256: str
    data3d_guid: str
    seed: int
    fold_indices: Any
    identity_digests: tuple[str, ...]

@dataclass(frozen=True)
class FitMetrics:
    total_count: int
    inlier_count: int
    inlier_median_error_degrees: float | None
    inlier_p95_error_degrees: float | None
    all_median_error_degrees: float | None
    all_p95_error_degrees: float | None

@dataclass(frozen=True)
class FoldOrientationFit:
    fold_index: int
    global_reflection_applied: bool
    rotation: Any
    training_inliers: Any
    held_out_inliers: Any
    training_metrics: FitMetrics
    held_out_metrics: FitMetrics

@dataclass(frozen=True)
class ChiralityFit:
    global_reflection_applied: bool
    folds: tuple[FoldOrientationFit, ...]
    held_out_errors_degrees: Any
    held_out_inliers: Any
    held_out_metrics: FitMetrics

@dataclass(frozen=True)
class OrientationFit:
    seed: int
    thresholds: OrientationThresholds
    match_count: int
    fold_indices: Any
    chirality_candidates: tuple[ChiralityFit, ...]
    fold_chirality_winners: tuple[bool, ...]
    folds: tuple[FoldOrientationFit, ...]
    global_reflection_applied: bool
    rotation_panorama_from_reflected_scanner: Any
    rotation_panorama_from_scanner: Any
    final_errors_degrees: Any
    final_inliers: Any
    final_metrics: FitMetrics
    held_out_errors_degrees: Any
    held_out_inliers: Any
    held_out_metrics: FitMetrics
    face_inlier_counts: tuple[int, ...]

@dataclass(frozen=True)
class CubefaceIntrinsics:
    width: int
    height: int
    focal_x: float
    focal_y: float
    principal_x: float
    principal_y: float

@dataclass(frozen=True)
class _RobustFit:
    rotation: Any
    errors: Any
    inliers: Any
    metrics: FitMetrics

def _np() -> Any:
    value = sys.modules.get("numpy")
    if value is None:
        raise RuntimeError("verified NumPy must already be loaded before numeric work")
    return value

def _ro(value: Any) -> Any:
    result = _np().ascontiguousarray(value)
    result.setflags(write=False)
    return result

def _ints(value: Any, length: int, label: str) -> Any:
    np = _np(); result = np.asarray(value)
    if result.shape != (length,) or not np.issubdtype(result.dtype, np.integer):
        raise ValueError(f"{label} must be an integral vector of length {length}")
    return np.asarray(result, dtype=np.int64)

def _rays(value: Any, label: str) -> Any:
    np = _np(); result = np.asarray(value, dtype=np.float64)
    if result.ndim != 2 or result.shape[1] != 3 or not np.isfinite(result).all():
        raise ValueError(f"{label} must have finite shape (N,3)")
    norms = np.linalg.norm(result, axis=1)
    if np.any(norms <= 1e-12): raise ValueError(f"{label} rays must be non-zero")
    if np.any(np.abs(norms - 1.) > 1e-9): raise ValueError(f"{label} rays must be unit length")
    return result / norms[:, None]

def _limits(value: OrientationThresholds) -> None:
    integer_values = (value.fold_count, value.fold_ransac_iterations,
                      value.final_ransac_iterations, value.refit_cycles,
                      value.minimum_correspondences, value.minimum_final_inliers,
                      value.minimum_held_out_inliers, value.minimum_supported_faces,
                      value.minimum_inliers_per_supported_face)
    if any(isinstance(item, bool) or not isinstance(item, int) for item in integer_values):
        raise ValueError("orientation fitting integer limits must be integers")
    if value.fold_count != 5 or value.refit_cycles != 3:
        raise ValueError("orientation fitting requires exactly five folds and three refit cycles")
    numbers = integer_values[1:3] + integer_values[4:]
    if any(item <= 0 for item in numbers) or value.minimum_supported_faces > 6:
        raise ValueError("orientation fitting limits must be positive")
    if (isinstance(value.inlier_threshold_degrees, bool)
            or not isinstance(value.inlier_threshold_degrees, (int, float))
            or not math.isfinite(value.inlier_threshold_degrees)
            or not 0 < value.inlier_threshold_degrees < 180):
        raise ValueError("orientation inlier threshold must be finite and angular")

def build_match_partition(panorama_sha256: str, data3d_guid: str,
                          face_indices: Sequence[int], query_indices: Sequence[int],
                          train_indices: Sequence[int], *, fold_count: int = 5) -> MatchPartition:
    if re.fullmatch(r"sha256:[0-9a-f]{64}", panorama_sha256) is None:
        raise ValueError("panorama identity must include canonical sha256: prefix")
    if re.fullmatch(r"[0-9a-f]{32}", data3d_guid) is None:
        raise ValueError("Data3D GUID must be lowercase hexadecimal")
    if fold_count != 5: raise ValueError("partition requires five folds")
    length = len(face_indices); np = _np()
    faces, queries, trains = (_ints(face_indices, length, "faces"),
                              _ints(query_indices, length, "queries"),
                              _ints(train_indices, length, "trains"))
    if length < 15 or np.any((faces < 0) | (faces > 5)) or np.any(queries < 0) or np.any(trains < 0):
        raise ValueError("matches require valid faces and non-negative descriptor indices")
    digests = tuple(hashlib.sha256(f"{panorama_sha256}|{data3d_guid}|{int(f)}|{int(q)}|{int(t)}".encode()).hexdigest()
                    for f, q, t in zip(faces, queries, trains))
    if len(set(digests)) != length: raise ValueError("match identity collision or duplicate")
    folds = np.empty(length, dtype=np.int8)
    for face in range(6):
        for rank, (_digest, index) in enumerate(sorted((digests[int(i)], int(i)) for i in np.flatnonzero(faces == face))):
            folds[index] = rank % 5
    raw_seed = hashlib.sha256((panorama_sha256 + data3d_guid).encode()).digest()[:8]
    return MatchPartition(panorama_sha256, data3d_guid, int.from_bytes(raw_seed, "little"), _ro(folds), digests)

def _inputs(source: Any, target: Any, faces: Any, folds: Any,
            limits: OrientationThresholds) -> tuple[Any, Any, Any, Any]:
    _limits(limits); source, target = _rays(source, "scanner"), _rays(target, "panorama")
    if len(source) != len(target) or len(source) < limits.minimum_correspondences:
        raise ValueError("orientation correspondences are insufficient")
    faces, folds = _ints(faces, len(source), "faces"), _ints(folds, len(source), "folds")
    np = _np()
    if np.any((faces < 0) | (faces > 5)) or set(map(int, folds)) != set(range(5)):
        raise ValueError("orientation correspondences must cover exactly five folds")
    return source, target, faces, folds

def _order(source: Any, target: Any, faces: Any, folds: Any,
           identities: Sequence[str] | None) -> Any:
    np = _np()
    if identities is not None:
        if len(identities) != len(source) or len(set(identities)) != len(source):
            raise ValueError("match identity digests must be complete and unique")
        return np.asarray(sorted(range(len(source)), key=lambda i: identities[i]))
    keys = []
    for index in range(len(source)):
        material = np.asarray(source[index], dtype="<f8").tobytes() + np.asarray(target[index], dtype="<f8").tobytes()
        keys.append((hashlib.sha256(material + bytes((int(faces[index]), int(folds[index])))).hexdigest(), index))
    return np.asarray([index for _key, index in sorted(keys)])

def _orthogonal(value: Any, determinant: int, label: str) -> Any:
    np = _np(); matrix = np.asarray(value, dtype=np.float64)
    if matrix.shape != (3, 3) or not np.isfinite(matrix).all(): raise ValueError(f"{label} must be finite 3x3")
    if np.max(np.abs(matrix.T @ matrix - np.eye(3))) > 1e-10 or abs(np.linalg.det(matrix) - determinant) > 1e-10:
        raise ValueError(f"{label} must be orthogonal with determinant {determinant}")
    if not np.allclose(np.cross(matrix[:, 0], matrix[:, 1]), determinant * matrix[:, 2], atol=1e-10, rtol=0):
        raise ValueError(f"{label} fails cross-product handedness")
    return matrix

def _kabsch(source: Any, target: Any) -> Any:
    np = _np(); left, singular, right = np.linalg.svd(source.T @ target)
    if len(source) < 3 or singular[1] <= 1e-12: raise ValueError("rotationally degenerate rays")
    rotation = right.T @ left.T
    if np.linalg.det(rotation) < 0: right[-1] *= -1; rotation = right.T @ left.T
    return _orthogonal(rotation, 1, "Kabsch rotation")

def _errors(source: Any, target: Any, rotation: Any) -> Any:
    np = _np(); cosine = np.sum((source @ rotation.T) * target, axis=1)
    return np.degrees(np.arccos(np.clip(cosine, -1, 1)))

def _metrics(errors: Any, mask: Any) -> FitMetrics:
    np = _np(); all_values = np.sort(errors); selected = np.sort(errors[mask])
    def quantile(values: Any, fraction: float) -> float | None:
        count = len(values)
        if not count:
            return None
        position = (count - 1) * fraction; low, high = math.floor(position), math.ceil(position)
        return float(values[low] if low == high else values[low] * (high-position) + values[high] * (position-low))
    return FitMetrics(
        len(all_values),
        len(selected),
        quantile(selected, .5),
        quantile(selected, .95),
        quantile(all_values, .5),
        quantile(all_values, .95),
    )

def _score(metrics: FitMetrics) -> tuple[int, float, float]:
    median = (
        math.inf
        if metrics.inlier_median_error_degrees is None
        else metrics.inlier_median_error_degrees
    )
    p95 = (
        math.inf
        if metrics.inlier_p95_error_degrees is None
        else metrics.inlier_p95_error_degrees
    )
    return (metrics.inlier_count, -median, -p95)

def _robust(source: Any, target: Any, seed: int, iterations: int,
            limits: OrientationThresholds) -> _RobustFit:
    np = _np(); generator = np.random.default_rng(seed); best = None
    for _ in range(iterations):
        sample = generator.choice(len(source), 3, replace=False)
        try: rotation = _kabsch(source[sample], target[sample])
        except ValueError: continue
        mask = _errors(source, target, rotation) < limits.inlier_threshold_degrees
        valid = True
        for _cycle in range(limits.refit_cycles):
            if mask.sum() < 3: valid = False; break
            try: rotation = _kabsch(source[mask], target[mask])
            except ValueError: valid = False; break
            errors = _errors(source, target, rotation); mask = errors < limits.inlier_threshold_degrees
        if valid:
            candidate = _RobustFit(rotation, errors, mask, _metrics(errors, mask))
            if best is None or _score(candidate.metrics) > _score(best.metrics): best = candidate
    if best is None: raise ValueError("robust orientation fit found no model")
    return best

def fit_fold_orientation(source_rays: Any, target_rays: Any, face_labels: Any,
                         fold_indices: Any, *, held_out_fold: int, reflected: bool,
                         seed: int, thresholds: OrientationThresholds = OrientationThresholds(),
                         match_identity_digests: Sequence[str] | None = None) -> FoldOrientationFit:
    source, target, faces, folds = _inputs(source_rays, target_rays, face_labels, fold_indices, thresholds)
    if held_out_fold not in range(5): raise ValueError("held-out fold must be zero through four")
    order = _order(source, target, faces, folds, match_identity_digests)
    source, target, faces, folds = (value[order] for value in (source, target, faces, folds))
    train, held = folds != held_out_fold, folds == held_out_fold
    reflection = _np().asarray(SCANNER_Y_REFLECTION if reflected else _np().eye(3))
    candidate = source @ reflection.T
    model = _robust(candidate[train], target[train], seed, thresholds.fold_ransac_iterations, thresholds)
    errors = _errors(candidate, target, model.rotation); inliers = errors < thresholds.inlier_threshold_degrees
    np = _np(); train_mask, held_mask = np.zeros(len(source), bool), np.zeros(len(source), bool)
    train_mask[train], held_mask[held] = inliers[train], inliers[held]
    inverse = np.empty(len(order), np.int64); inverse[order] = np.arange(len(order))
    return FoldOrientationFit(held_out_fold, reflected, _ro(model.rotation), _ro(train_mask[inverse]),
                              _ro(held_mask[inverse]), _metrics(errors[train], inliers[train]),
                              _metrics(errors[held], inliers[held]))

def _chirality(source: Any, target: Any, faces: Any, folds: Any, seed: int,
               reflected: bool, limits: OrientationThresholds,
               identities: Sequence[str] | None) -> ChiralityFit:
    results = tuple(fit_fold_orientation(source, target, faces, folds, held_out_fold=fold,
                    reflected=reflected, seed=seed ^ fold, thresholds=limits,
                    match_identity_digests=identities) for fold in range(5))
    np = _np(); reflection = np.asarray(SCANNER_Y_REFLECTION if reflected else np.eye(3))
    candidate = source @ reflection.T; errors = np.empty(len(source)); mask = np.zeros(len(source), bool)
    for result in results:
        selected = folds == result.fold_index
        errors[selected] = _errors(candidate[selected], target[selected], result.rotation)
        mask[selected] = errors[selected] < limits.inlier_threshold_degrees
    return ChiralityFit(reflected, results, _ro(errors), _ro(mask), _metrics(errors, mask))

def solve_cross_validated_orientation(source_rays: Any, target_rays: Any, face_labels: Any,
                                      seed: int, thresholds: OrientationThresholds = OrientationThresholds(),
                                      *, fold_indices: Any,
                                      match_identity_digests: Sequence[str] | None = None) -> OrientationFit:
    source, target, faces, folds = _inputs(source_rays, target_rays, face_labels, fold_indices, thresholds)
    if isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed < 2**64:
        raise ValueError("seed must be unsigned 64-bit")
    order = _order(source, target, faces, folds, match_identity_digests)
    source, target, faces, folds = (value[order] for value in (source, target, faces, folds))
    ordered_identities = (None if match_identity_digests is None else
                          tuple(match_identity_digests[int(index)] for index in order))
    candidates = tuple(_chirality(source, target, faces, folds, seed, reflected,
                                  thresholds, ordered_identities)
                       for reflected in (False, True))
    left, right = candidates; left_score, right_score = _score(left.held_out_metrics), _score(right.held_out_metrics)
    fold_chirality_winners = tuple(
        _score(left.folds[index].held_out_metrics)
        < _score(right.folds[index].held_out_metrics)
        for index in range(thresholds.fold_count)
    )
    if len(set(fold_chirality_winners)) != 1:
        raise ValueError("held-out folds disagree on orientation chirality")
    selected_reflection = fold_chirality_winners[0]
    aggregate_reflection = left_score < right_score
    if selected_reflection is not aggregate_reflection:
        raise ValueError("aggregate and held-out-fold chirality decisions disagree")
    selected = right if selected_reflection else left
    np = _np(); reflection = np.asarray(SCANNER_Y_REFLECTION if selected.global_reflection_applied else np.eye(3))
    final = _robust(source @ reflection.T, target, seed ^ 0xA5A5,
                    thresholds.final_ransac_iterations, thresholds)
    orientation = final.rotation @ reflection
    _orthogonal(orientation, -1 if selected.global_reflection_applied else 1, "panorama orientation")
    counts = tuple(int(np.sum(final.inliers & (faces == face))) for face in range(6))
    result = OrientationFit(seed, thresholds, len(source), _ro(folds), candidates,
             fold_chirality_winners, selected.folds,
             selected.global_reflection_applied, _ro(final.rotation), _ro(orientation), _ro(final.errors),
             _ro(final.inliers), final.metrics, selected.held_out_errors_degrees,
             selected.held_out_inliers, selected.held_out_metrics, counts)
    if final.metrics.inlier_count < thresholds.minimum_final_inliers or selected.held_out_metrics.inlier_count < thresholds.minimum_held_out_inliers:
        raise ValueError("orientation has insufficient robust or held-out inliers")
    if sum(
        count >= thresholds.minimum_inliers_per_supported_face for count in counts
    ) < thresholds.minimum_supported_faces:
        raise ValueError("orientation has insufficient cubeface support")
    return result

def compose_e57_from_panorama_camera(rotation_e57_from_scanner: Any,
                                      rotation_panorama_from_scanner: Any,
                                      global_reflection_applied: bool) -> Any:
    e57 = _orthogonal(rotation_e57_from_scanner, 1, "E57-from-scanner rotation")
    orientation = _orthogonal(rotation_panorama_from_scanner,
                              -1 if global_reflection_applied else 1, "panorama orientation")
    if not global_reflection_applied: raise ValueError("proper camera composition requires reflection")
    scanner_from_camera = orientation.T @ _np().asarray(PANORAMA_FROM_CAMERA)
    _orthogonal(scanner_from_camera, 1, "scanner-from-camera rotation")
    return _ro(_orthogonal(e57 @ scanner_from_camera, 1, "E57-from-camera rotation"))

def quaternion_wxyz_to_rotation(value: Sequence[float]) -> tuple[Any, float]:
    np = _np(); q = np.asarray(value, dtype=np.float64)
    if q.shape != (4,) or not np.isfinite(q).all(): raise ValueError("quaternion must be four finite wxyz values")
    norm = float(np.linalg.norm(q)); error = abs(norm - 1.)
    if not norm or error > 1e-6: raise ValueError("quaternion norm exceeds tolerance")
    w, x, y, z = q / norm
    rotation = np.asarray(((1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)),
                           (2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)),
                           (2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y))))
    return _ro(_orthogonal(rotation, 1, "Data3D rotation")), error

def compose_panorama_camera_extrinsics(rotation_e57_from_scanner: Any,
                                       data3d_translation_m: Sequence[float],
                                       rotation_panorama_from_scanner: Any,
                                       global_reflection_applied: bool) -> dict[str, object]:
    np = _np(); centre = np.asarray(data3d_translation_m, dtype=np.float64)
    if centre.shape != (3,) or not np.isfinite(centre).all(): raise ValueError("translation must be finite xyz metres")
    forward = compose_e57_from_panorama_camera(rotation_e57_from_scanner,
              rotation_panorama_from_scanner, global_reflection_applied); inverse = forward.T
    return {"cameraCenterE57M": centre.tolist(), "rotationDirection": "e57_from_conventional_panorama_camera",
            "rotationE57FromPanoramaCamera": forward.tolist(), "rotationPanoramaCameraFromE57": inverse.tolist(),
            "translationPanoramaCameraFromE57M": (-(inverse @ centre)).tolist()}

def equirectangular_pixel_centres(width: int, height: int, *, row_start: int = 0,
                                  row_stop: int | None = None) -> Any:
    np = _np(); stop = height if row_stop is None else row_stop
    if width <= 0 or height <= 0 or not 0 <= row_start <= stop <= height: raise ValueError("invalid raster range")
    x, y = np.arange(width) + .5, np.arange(row_start, stop) + .5; gx, gy = np.meshgrid(x, y)
    return np.column_stack((gx.ravel(), gy.ravel()))

def equirectangular_pixels_to_rays(pixels: Any, width: int, height: int) -> Any:
    np = _np(); pixels = np.asarray(pixels, dtype=np.float64)
    if pixels.ndim != 2 or pixels.shape[1] != 2 or not np.isfinite(pixels).all(): raise ValueError("pixels must be finite Nx2")
    if width <= 0 or height <= 0: raise ValueError("raster dimensions must be positive")
    lon = pixels[:, 0] / width * 2*np.pi; lat = np.pi/2 - pixels[:, 1]/height*np.pi; cosine = np.cos(lat)
    return np.column_stack((cosine*np.cos(lon), cosine*np.sin(lon), np.sin(lat)))

def scanner_rays_to_cubeface_pixels(scanner_rays: Any, intrinsics: CubefaceIntrinsics) -> tuple[Any, Any, Any]:
    np = _np(); rays = _rays(scanner_rays, "scanner projection")
    numeric = (intrinsics.focal_x, intrinsics.focal_y, intrinsics.principal_x, intrinsics.principal_y)
    if intrinsics.width <= 0 or intrinsics.height <= 0 or intrinsics.focal_x <= 0 or intrinsics.focal_y <= 0 or any(not math.isfinite(item) for item in numeric):
        raise ValueError("cubeface intrinsics must be finite and positive")
    rights = np.asarray([x[0] for x in CANONICAL_CUBEFACE_BASES]); downs = np.asarray([x[1] for x in CANONICAL_CUBEFACE_BASES]); forwards = np.asarray([x[2] for x in CANONICAL_CUBEFACE_BASES])
    face = np.argmax(rays @ forwards.T, axis=1); depth = np.sum(rays * forwards[face], axis=1)
    u = intrinsics.principal_x + intrinsics.focal_x*np.sum(rays*rights[face], axis=1)/depth
    v = intrinsics.principal_y + intrinsics.focal_y*np.sum(rays*downs[face], axis=1)/depth
    valid = (u >= 0) & (u < intrinsics.width) & (v >= 0) & (v < intrinsics.height)
    return face, np.column_stack((u, v)), valid

def reproject_cubefaces_to_equirect(cubefaces: Sequence[Any], rotation_panorama_from_scanner: Any,
                                    global_reflection_applied: bool, out_width: int, out_height: int) -> tuple[Any, Any]:
    np = _np()
    if out_width <= 0 or out_height <= 0: raise ValueError("output dimensions must be positive")
    if len(cubefaces) != 6: raise ValueError("six cubefaces required")
    images = [np.asarray(image) for image in cubefaces]; shape = images[0].shape
    if len(shape) != 3 or shape[0] != shape[1] or shape[2] != 3 or any(image.shape != shape or image.dtype != np.uint8 for image in images):
        raise ValueError("cubefaces must be equal square uint8 RGB")
    orientation = _orthogonal(rotation_panorama_from_scanner, -1 if global_reflection_applied else 1, "panorama orientation")
    size = shape[0]; intrinsics = CubefaceIntrinsics(size, size, size/2, size/2, size/2, size/2)
    output, valid_output = np.zeros((out_height, out_width, 3), np.uint8), np.zeros((out_height, out_width), bool)
    for row in range(out_height):
        pixels = equirectangular_pixel_centres(out_width, out_height, row_start=row, row_stop=row+1)
        scanner = equirectangular_pixels_to_rays(pixels, out_width, out_height) @ orientation
        faces, uv, valid = scanner_rays_to_cubeface_pixels(scanner, intrinsics)
        x0 = np.floor(uv[:, 0]).astype(int)
        y0 = np.floor(uv[:, 1]).astype(int)
        x1 = np.minimum(x0 + 1, size - 1)
        y1 = np.minimum(y0 + 1, size - 1)
        wx = uv[:, 0] - x0
        wy = uv[:, 1] - y0
        for face, image in enumerate(images):
            selected = valid & (faces == face)
            if not np.any(selected):
                continue
            top = (
                image[y0[selected], x0[selected]].astype(np.float64)
                * (1.0 - wx[selected, None])
                + image[y0[selected], x1[selected]].astype(np.float64)
                * wx[selected, None]
            )
            bottom = (
                image[y1[selected], x0[selected]].astype(np.float64)
                * (1.0 - wx[selected, None])
                + image[y1[selected], x1[selected]].astype(np.float64)
                * wx[selected, None]
            )
            sampled = top * (1.0 - wy[selected, None]) + bottom * wy[selected, None]
            output[row, selected] = np.floor(sampled + 0.5).astype(np.uint8)
        valid_output[row] = valid
    return output, valid_output

def _metrics_json(value: FitMetrics) -> dict[str, object]:
    return {
        "allMedianErrorDegrees": value.all_median_error_degrees,
        "allP95ErrorDegrees": value.all_p95_error_degrees,
        "inlierCount": value.inlier_count,
        "inlierMedianErrorDegrees": value.inlier_median_error_degrees,
        "inlierP95ErrorDegrees": value.inlier_p95_error_degrees,
        "totalCount": value.total_count,
    }

def _thresholds_json(value: OrientationThresholds) -> dict[str, object]:
    return {"finalRansacIterations": value.final_ransac_iterations, "foldCount": value.fold_count,
            "foldRansacIterations": value.fold_ransac_iterations,
            "inlierThresholdDegrees": value.inlier_threshold_degrees,
            "minimumCorrespondences": value.minimum_correspondences,
            "minimumFinalInliers": value.minimum_final_inliers,
            "minimumHeldOutInliers": value.minimum_held_out_inliers,
            "minimumInliersPerSupportedFace": value.minimum_inliers_per_supported_face,
            "minimumSupportedFaces": value.minimum_supported_faces, "refitCycles": value.refit_cycles}

def orientation_fit_json(value: OrientationFit) -> dict[str, object]:
    return {
        "authority": "none",
        "chiralityCandidates": [
            {
                "folds": [
                    {
                        "foldIndex": fold.fold_index,
                        "heldOut": _metrics_json(fold.held_out_metrics),
                    }
                    for fold in item.folds
                ],
                "globalReflectionApplied": item.global_reflection_applied,
                "heldOut": _metrics_json(item.held_out_metrics),
            }
            for item in value.chirality_candidates
        ],
        "configuration": _thresholds_json(value.thresholds),
        "faceFinalInlierCounts": list(value.face_inlier_counts),
        "finalFit": _metrics_json(value.final_metrics),
        "finalInlierByMatch": value.final_inliers.tolist(),
        "foldChiralityWinners": list(value.fold_chirality_winners),
        "foldIndexByMatch": value.fold_indices.tolist(),
        "folds": [{"foldIndex": item.fold_index,
                   "globalReflectionApplied": item.global_reflection_applied,
                   "heldOut": _metrics_json(item.held_out_metrics),
                   "rotationPanoramaCanonicalFromReflectedScanner": item.rotation.tolist(),
                   "training": _metrics_json(item.training_metrics)} for item in value.folds],
        "frames": {"panoramaCamera": "right_down_forward_conventional_camera",
                   "panoramaCanonical": "coslat_coslon__coslat_sinlon__sinlat_left_handed",
                   "scanner": "e57_data3d_scanner_local"},
        "globalReflectionApplied": value.global_reflection_applied,
        "guards": dict(AUTHORITY_NONE_GUARDS),
        "heldOut": _metrics_json(value.held_out_metrics),
        "heldOutInlierByMatch": value.held_out_inliers.tolist(),
        "humanReviewRequired": True, "matchCount": value.match_count, "model": MODEL_NAME,
        "rotationPanoramaCanonicalFromReflectedScanner": value.rotation_panorama_from_reflected_scanner.tolist(),
        "rotationPanoramaCanonicalFromScanner": value.rotation_panorama_from_scanner.tolist(),
        "schemaVersion": RESULT_SCHEMA, "seedUint64": value.seed,
    }

def _finite_json(value: Any, label: str = "JSON") -> None:
    if value is None or isinstance(value, (str, bool, int)): return
    if isinstance(value, float):
        if not math.isfinite(value): raise ValueError(f"{label} must contain finite numbers")
        return
    if isinstance(value, list):
        for index, item in enumerate(value): _finite_json(item, f"{label}[{index}]")
        return
    if isinstance(value, dict):
        if any(not isinstance(key, str) for key in value): raise ValueError(f"{label} keys must be strings")
        for key, item in value.items(): _finite_json(item, f"{label}.{key}")
        return
    raise ValueError(f"{label} contains a non-JSON value")

def canonical_finite_json_bytes(value: Any) -> bytes:
    _finite_json(value)
    return (json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2, sort_keys=True) + "\n").encode()

def _exact(value: dict[str, Any], expected: set[str], label: str) -> None:
    if set(value) != expected:
        raise ValueError(f"{label} keys differ; missing={sorted(expected-set(value))}, unexpected={sorted(set(value)-expected)}")

def _metric_record(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict): raise ValueError(f"{label} must be an object")
    _exact(
        value,
        {
            "allMedianErrorDegrees", "allP95ErrorDegrees", "inlierCount",
            "inlierMedianErrorDegrees", "inlierP95ErrorDegrees", "totalCount",
        },
        label,
    )
    count, total = value["inlierCount"], value["totalCount"]
    if isinstance(count, bool) or isinstance(total, bool) or not isinstance(count, int) or not isinstance(total, int) or not 0 <= count <= total:
        raise ValueError(f"{label} counts are invalid")
    median, p95 = value["inlierMedianErrorDegrees"], value["inlierP95ErrorDegrees"]
    if (median is None) != (p95 is None) or (median is None) != (count == 0):
        raise ValueError(f"{label} residual nullability is invalid")
    if median is not None and (median < 0 or p95 < median): raise ValueError(f"{label} residual ordering is invalid")
    all_median, all_p95 = value["allMedianErrorDegrees"], value["allP95ErrorDegrees"]
    if (all_median is None) != (all_p95 is None) or (all_median is None) != (total == 0):
        raise ValueError(f"{label} all-residual nullability is invalid")
    if all_median is not None and (all_median < 0 or all_p95 < all_median):
        raise ValueError(f"{label} all-residual ordering is invalid")
    return value

def validate_authority_none_result(result: Any) -> None:
    """Fail closed on unknown fields, non-finite values, or opened authority."""
    _finite_json(result, "orientation result")
    if not isinstance(result, dict): raise ValueError("orientation result must be an object")
    keys = {"authority", "chiralityCandidates", "configuration", "faceFinalInlierCounts",
            "finalFit", "finalInlierByMatch", "foldChiralityWinners", "foldIndexByMatch", "folds", "frames",
            "globalReflectionApplied", "guards", "heldOut", "heldOutInlierByMatch",
            "humanReviewRequired", "matchCount", "model",
            "rotationPanoramaCanonicalFromReflectedScanner", "rotationPanoramaCanonicalFromScanner",
            "schemaVersion", "seedUint64"}
    _exact(result, keys, "orientation result")
    if result["schemaVersion"] != RESULT_SCHEMA or result["authority"] != "none" or result["humanReviewRequired"] is not True or result["model"] != MODEL_NAME:
        raise ValueError("orientation schema or authority header drifted")
    if result["guards"] != AUTHORITY_NONE_GUARDS: raise ValueError("orientation guard or authority state opened")
    expected_frames = {"panoramaCamera": "right_down_forward_conventional_camera",
                       "panoramaCanonical": "coslat_coslon__coslat_sinlon__sinlat_left_handed",
                       "scanner": "e57_data3d_scanner_local"}
    if result["frames"] != expected_frames: raise ValueError("orientation frames drifted")
    count = result["matchCount"]
    if isinstance(count, bool) or not isinstance(count, int) or count < 15: raise ValueError("match count invalid")
    folds, final_mask, held_mask = result["foldIndexByMatch"], result["finalInlierByMatch"], result["heldOutInlierByMatch"]
    if any(not isinstance(value, list) or len(value) != count for value in (folds, final_mask, held_mask)):
        raise ValueError("per-match vectors incomplete")
    if (set(folds) != set(range(5))
            or any(isinstance(value, bool) or not isinstance(value, int) for value in folds)
            or any(not isinstance(value, bool) for value in final_mask + held_mask)):
        raise ValueError("fold or inlier vector invalid")
    final, held = _metric_record(result["finalFit"], "final fit"), _metric_record(result["heldOut"], "held-out fit")
    if final["totalCount"] != count or final["inlierCount"] != sum(final_mask) or held["totalCount"] != count or held["inlierCount"] != sum(held_mask):
        raise ValueError("aggregate metrics disagree with masks")
    face_counts = result["faceFinalInlierCounts"]
    if (not isinstance(face_counts, list) or len(face_counts) != 6
            or any(isinstance(value, bool) or not isinstance(value, int) or value < 0 for value in face_counts)
            or sum(face_counts) != sum(final_mask)):
        raise ValueError("face counts disagree with final mask")
    reflected = result["globalReflectionApplied"]
    if not isinstance(reflected, bool): raise ValueError("reflection flag invalid")
    fold_winners = result["foldChiralityWinners"]
    if (
        not isinstance(fold_winners, list)
        or len(fold_winners) != 5
        or any(not isinstance(value, bool) for value in fold_winners)
        or any(value is not reflected for value in fold_winners)
    ):
        raise ValueError("held-out fold chirality decisions are not unanimous")
    proper = _orthogonal(result["rotationPanoramaCanonicalFromReflectedScanner"], 1, "fit rotation")
    orientation = _orthogonal(result["rotationPanoramaCanonicalFromScanner"], -1 if reflected else 1, "orientation")
    if not _np().allclose(proper @ _np().asarray(SCANNER_Y_REFLECTION if reflected else _np().eye(3)), orientation, atol=1e-12, rtol=0):
        raise ValueError("orientation composition drifted")
    candidates = result["chiralityCandidates"]
    if not isinstance(candidates, list) or [item.get("globalReflectionApplied") for item in candidates] != [False, True]:
        raise ValueError("chirality candidates drifted")
    for item in candidates:
        _exact(item, {"folds", "globalReflectionApplied", "heldOut"}, "chirality candidate")
        if not isinstance(item["globalReflectionApplied"], bool): raise ValueError("chirality flag invalid")
        if _metric_record(item["heldOut"], "chirality held-out")["totalCount"] != count:
            raise ValueError("chirality held-out total drifted")
        candidate_folds = item["folds"]
        if not isinstance(candidate_folds, list) or len(candidate_folds) != 5:
            raise ValueError("chirality candidate must report all five held-out folds")
        for index, candidate_fold in enumerate(candidate_folds):
            _exact(candidate_fold, {"foldIndex", "heldOut"}, "chirality candidate fold")
            if candidate_fold["foldIndex"] != index:
                raise ValueError("chirality candidate fold identity drifted")
            if _metric_record(
                candidate_fold["heldOut"], "chirality candidate fold held-out"
            )["totalCount"] != sum(value == index for value in folds):
                raise ValueError("chirality candidate fold population drifted")
    selected_folds = result["folds"]
    if not isinstance(selected_folds, list) or len(selected_folds) != 5: raise ValueError("five selected folds required")
    for index, item in enumerate(selected_folds):
        _exact(item, {"foldIndex", "globalReflectionApplied", "heldOut", "rotationPanoramaCanonicalFromReflectedScanner", "training"}, "fold")
        if item["foldIndex"] != index or item["globalReflectionApplied"] is not reflected: raise ValueError("fold identity drifted")
        held_metric = _metric_record(item["heldOut"], "fold held-out")
        train_metric = _metric_record(item["training"], "fold training")
        if held_metric["totalCount"] != sum(value == index for value in folds) or held_metric["totalCount"] + train_metric["totalCount"] != count:
            raise ValueError("fold metric population drifted")
        _orthogonal(item["rotationPanoramaCanonicalFromReflectedScanner"], 1, "fold rotation")
    configuration = result["configuration"]
    if not isinstance(configuration, dict): raise ValueError("configuration must be object")
    _exact(configuration, set(_thresholds_json(OrientationThresholds())), "configuration")
    parsed = OrientationThresholds(
        fold_count=configuration["foldCount"],
        fold_ransac_iterations=configuration["foldRansacIterations"],
        final_ransac_iterations=configuration["finalRansacIterations"],
        refit_cycles=configuration["refitCycles"],
        inlier_threshold_degrees=configuration["inlierThresholdDegrees"],
        minimum_correspondences=configuration["minimumCorrespondences"],
        minimum_final_inliers=configuration["minimumFinalInliers"],
        minimum_held_out_inliers=configuration["minimumHeldOutInliers"],
        minimum_supported_faces=configuration["minimumSupportedFaces"],
        minimum_inliers_per_supported_face=configuration["minimumInliersPerSupportedFace"],
    )
    _limits(parsed)
    if count < parsed.minimum_correspondences:
        raise ValueError("match count is below the declared configuration")
    if isinstance(result["seedUint64"], bool) or not isinstance(result["seedUint64"], int) or not 0 <= result["seedUint64"] < 2**64:
        raise ValueError("orientation seed invalid")
