#!/usr/bin/env python3
"""Geometry-only E57/Image2D edge-alignment primitives.

This module is intentionally independent of E57 point colour.  Its public core
accepts only organized XYZ fields and a separately decoded photograph.  It does
not open an E57 file, choose acceptance thresholds, or claim calibration.

Fixed formulas and assumptions
------------------------------

* ``range(p) = ||p||_2`` in metres, with the scan origin as the camera centre.
* The four-neighbour range signal at pixel ``i`` is
  ``max_j |log(range_i) - log(range_j)|`` for valid up/down/left/right
  neighbours.  This signal deliberately keeps large depth breaks.
* The organized grid is decimated first, anchored at row/column zero with a
  fixed stride of two.  Horizontal neighbours wrap across the panorama seam;
  vertical neighbours do not wrap.
* A neighbour ``n`` is allowed to influence the normal at centre ``i`` when
  ``||P_n-P_i|| < 0.10*range_i + 0.03 metres``.  A central normal requires all
  four gated neighbours and is
  ``normalize(cross(P_right-P_left, P_down-P_up))``.
* Normal direction is ignored.  Discontinuity is
  ``1-|dot(n_i,n_j)|``, maximized over gated four-neighbours.
* Projection is pinhole:
  ``u=cx+fx*(p dot right)/(p dot forward)`` and
  ``v=(height-cy)+fy*(p dot down)/(p dot forward)``.  Only ``0.05<depth<50``
  metres is kept.  The nearest point wins each integer pixel; source index
  breaks an exact depth tie.
* The two projected signals are independently empirical-CDF ranked over their
  positive occupied values.  Geometry strength is the larger rank.  Pixels at
  or above its 96th percentile form the geometry mask, followed by one SciPy
  default-cross dilation and an eight-pixel cleared border.
* Photo edges are luminance -> SciPy Gaussian sigma 1.2 -> Sobel magnitude.
  Positive pixels at or above the interior 90th percentile form the photo-edge
  mask; the same eight-pixel border is excluded.  Zero gradient is never an
  edge, including when the percentile itself is zero.
* Alignment is the fraction of geometry-edge pixels whose Euclidean distance
  to a photo-edge pixel is at most two pixels.

The 48 axis-aligned cube candidates remain available as diagnostics.  The
fixed v2 Skybox-name mapping is always reported as the primary candidate;
the diagnostic argmax never silently replaces it.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np
from scipy import ndimage


RANGE_GATE_RELATIVE = 0.10
RANGE_GATE_ABSOLUTE_METRES = 0.03
MIN_VALID_RANGE_METRES = 0.20
NORMAL_EPSILON = 1.0e-8
DECIMATION_STRIDE = 2
GEOMETRY_EDGE_FRACTION = 0.04
PHOTO_EDGE_FRACTION = 0.10
PHOTO_GAUSSIAN_SIGMA = 1.2
EDGE_BORDER_PIXELS = 8
GEOMETRY_DILATION_ITERATIONS = 1
PHOTO_MATCH_RADIUS_PIXELS = 2
MIN_POSITIVE_DEPTH_METRES = 0.05
MAX_POSITIVE_DEPTH_METRES = 50.0
XYZ_GRID_FIELDS = (
    "cartesianX",
    "cartesianY",
    "cartesianZ",
    "rowIndex",
    "columnIndex",
)

AXES = {
    "+X": np.asarray([1.0, 0.0, 0.0], dtype=np.float64),
    "-X": np.asarray([-1.0, 0.0, 0.0], dtype=np.float64),
    "+Y": np.asarray([0.0, 1.0, 0.0], dtype=np.float64),
    "-Y": np.asarray([0.0, -1.0, 0.0], dtype=np.float64),
    "+Z": np.asarray([0.0, 0.0, 1.0], dtype=np.float64),
    "-Z": np.asarray([0.0, 0.0, -1.0], dtype=np.float64),
}

FIXED_V2_MAPPING = {
    "Skybox 0": "forward_+Z_right_-Y_proper",
    "Skybox 1": "forward_+X_right_-Y_proper",
    "Skybox 2": "forward_-Y_right_-X_proper",
    "Skybox 3": "forward_-X_right_+Y_proper",
    "Skybox 4": "forward_+Y_right_+X_proper",
    "Skybox 5": "forward_-Z_right_-Y_proper",
}


def cube_orientation_candidates() -> list[dict[str, Any]]:
    """Return all 24 proper and 24 mirrored axis-aligned cube bases."""

    candidates: list[dict[str, Any]] = []
    for forward_name, forward in AXES.items():
        for right_name, right in AXES.items():
            if abs(float(np.dot(forward, right))) > 1.0e-12:
                continue
            proper_down = np.cross(forward, right)
            for mirrored, down in ((False, proper_down), (True, -proper_down)):
                handedness = "mirrored" if mirrored else "proper"
                basis = np.column_stack((right, down, forward))
                determinant = float(np.linalg.det(basis))
                candidates.append(
                    {
                        "id": (
                            f"forward_{forward_name}_right_{right_name}_{handedness}"
                        ),
                        "forward": forward.copy(),
                        "right": right.copy(),
                        "down": down.copy(),
                        "mirrored": mirrored,
                        "basisDeterminant": determinant,
                    }
                )
    if len(candidates) != 48 or len({row["id"] for row in candidates}) != 48:
        raise RuntimeError("internal error constructing 48 cube candidates")
    return candidates


CANDIDATES = cube_orientation_candidates()
CANDIDATE_BY_ID = {str(candidate["id"]): candidate for candidate in CANDIDATES}


def _one_dimensional_array(value: Any, *, name: str, length: int | None = None) -> np.ndarray:
    array = np.asarray(value)
    if array.ndim != 1:
        raise ValueError(f"{name} must be a one-dimensional array")
    if length is not None and len(array) != length:
        raise ValueError(f"{name} length {len(array)} does not match {length}")
    return array


def _integer_indexes(value: Any, *, name: str, length: int) -> np.ndarray:
    array = _one_dimensional_array(value, name=name, length=length)
    if np.issubdtype(array.dtype, np.bool_):
        raise ValueError(f"{name} must contain integer indexes, not booleans")
    try:
        numeric = array.astype(np.float64)
    except (TypeError, ValueError, OverflowError) as error:
        raise ValueError(f"{name} must contain numeric integer indexes") from error
    if not np.all(np.isfinite(numeric)) or not np.all(numeric == np.floor(numeric)):
        raise ValueError(f"{name} must contain finite integer indexes")
    if np.any(numeric < 0) or np.any(numeric > np.iinfo(np.int64).max):
        raise ValueError(f"{name} contains an out-of-range index")
    return numeric.astype(np.int64)


def reconstruct_organized_xyz(
    fields: Mapping[str, Any],
    *,
    row_count: int | None = None,
    column_count: int | None = None,
    maximum_cells: int = 100_000_000,
) -> np.ndarray:
    """Reconstruct a ``rows x columns x 3`` XYZ grid.

    Missing cells, non-finite XYZ triples, and records whose optional
    ``cartesianInvalidState`` is nonzero become NaN.  Duplicate organized cell
    indexes are rejected because silently choosing one return would make the
    geometry result input-order dependent.  Extra mapping fields, including
    point-colour fields, are never read.
    """

    arrays: dict[str, np.ndarray] = {}
    for name in XYZ_GRID_FIELDS[:3]:
        if name not in fields:
            raise ValueError(f"missing required field {name}")
        arrays[name] = _one_dimensional_array(fields[name], name=name)
    point_count = len(arrays["cartesianX"])
    if point_count == 0:
        raise ValueError("organized point arrays must not be empty")
    for name in XYZ_GRID_FIELDS[1:3]:
        if len(arrays[name]) != point_count:
            raise ValueError(f"{name} length does not match cartesianX")
    for name in XYZ_GRID_FIELDS[3:]:
        if name not in fields:
            raise ValueError(f"missing required field {name}")
        arrays[name] = _integer_indexes(fields[name], name=name, length=point_count)

    rows = arrays["rowIndex"]
    columns = arrays["columnIndex"]
    inferred_rows = int(rows.max()) + 1
    inferred_columns = int(columns.max()) + 1
    if row_count is None:
        row_count = inferred_rows
    if column_count is None:
        column_count = inferred_columns
    if not isinstance(row_count, int) or isinstance(row_count, bool) or row_count <= 0:
        raise ValueError("row_count must be a positive integer")
    if not isinstance(column_count, int) or isinstance(column_count, bool) or column_count <= 0:
        raise ValueError("column_count must be a positive integer")
    if inferred_rows > row_count or inferred_columns > column_count:
        raise ValueError("rowIndex or columnIndex falls outside the declared grid")
    cell_count = row_count * column_count
    if maximum_cells <= 0 or cell_count > maximum_cells:
        raise ValueError(
            f"organized grid has {cell_count} cells; safety limit is {maximum_cells}"
        )
    linear_cells = rows * column_count + columns
    if len(np.unique(linear_cells)) != point_count:
        raise ValueError("duplicate rowIndex/columnIndex cell in organized scan")

    xyz = np.column_stack(
        (
            arrays["cartesianX"],
            arrays["cartesianY"],
            arrays["cartesianZ"],
        )
    ).astype(np.float64, copy=False)
    grid = np.full((row_count, column_count, 3), np.nan, dtype=np.float64)
    finite = np.all(np.isfinite(xyz), axis=1)
    if "cartesianInvalidState" in fields:
        invalid_state = _integer_indexes(
            fields["cartesianInvalidState"],
            name="cartesianInvalidState",
            length=point_count,
        )
        finite &= invalid_state == 0
    grid[rows[finite], columns[finite]] = xyz[finite]
    return grid


def deterministic_decimate_grid(
    xyz_grid: np.ndarray,
    *,
    stride: int = DECIMATION_STRIDE,
) -> np.ndarray:
    """Decimate an organized grid with a fixed stride anchored at (0, 0)."""

    grid = np.asarray(xyz_grid, dtype=np.float64)
    if grid.ndim != 3 or grid.shape[2] != 3:
        raise ValueError("xyz_grid must have shape (rows, columns, 3)")
    if grid.shape[0] == 0 or grid.shape[1] == 0:
        raise ValueError("xyz_grid rows and columns must be non-empty")
    if not isinstance(stride, int) or isinstance(stride, bool) or stride <= 0:
        raise ValueError("decimation stride must be a positive integer")
    return np.ascontiguousarray(grid[0 : grid.shape[0] : stride, 0 : grid.shape[1] : stride])


def _four_neighbours(
    values: np.ndarray,
    valid: np.ndarray,
) -> list[tuple[str, np.ndarray, np.ndarray]]:
    """Return seam-aware L/R/U/D arrays and their centre-relative validity."""

    left = np.roll(values, 1, axis=1)
    left_valid = np.roll(valid, 1, axis=1)
    right = np.roll(values, -1, axis=1)
    right_valid = np.roll(valid, -1, axis=1)
    up = np.roll(values, 1, axis=0)
    up_valid = np.roll(valid, 1, axis=0)
    up_valid[0, :] = False
    down = np.roll(values, -1, axis=0)
    down_valid = np.roll(valid, -1, axis=0)
    down_valid[-1, :] = False
    return [
        ("left", left, left_valid),
        ("right", right, right_valid),
        ("up", up, up_valid),
        ("down", down, down_valid),
    ]


def geometry_signals(
    xyz_grid: np.ndarray,
    *,
    relative_gate: float = RANGE_GATE_RELATIVE,
    absolute_gate_metres: float = RANGE_GATE_ABSOLUTE_METRES,
    minimum_range_metres: float = MIN_VALID_RANGE_METRES,
) -> dict[str, np.ndarray]:
    """Compute the prototype's seam-aware organized-grid geometry signals."""

    grid = np.asarray(xyz_grid, dtype=np.float64)
    if grid.ndim != 3 or grid.shape[2] != 3:
        raise ValueError("xyz_grid must have shape (rows, columns, 3)")
    if grid.shape[0] == 0 or grid.shape[1] == 0:
        raise ValueError("xyz_grid rows and columns must be non-empty")
    gate_terms = (relative_gate, absolute_gate_metres, minimum_range_metres)
    if not all(np.isfinite(value) for value in gate_terms) or any(
        value < 0.0 for value in gate_terms
    ):
        raise ValueError("normal-neighbour gate terms must be finite and non-negative")
    ranges = np.linalg.norm(grid, axis=2)
    valid = (
        np.all(np.isfinite(grid), axis=2)
        & np.isfinite(ranges)
        & (ranges > minimum_range_metres)
    )
    safe_ranges = np.where(valid, ranges, 1.0)
    log_jump = np.zeros(grid.shape[:2], dtype=np.float64)
    range_neighbour_count = np.zeros(grid.shape[:2], dtype=np.int16)
    gated_neighbour_count = np.zeros(grid.shape[:2], dtype=np.int16)

    point_neighbours = _four_neighbours(grid, valid)
    range_neighbours = _four_neighbours(safe_ranges, valid)
    gate_limit = relative_gate * safe_ranges + absolute_gate_metres
    gated_by_name: dict[str, np.ndarray] = {}
    points_by_name: dict[str, np.ndarray] = {}
    valid_by_name: dict[str, np.ndarray] = {}
    for (name, neighbour_points, neighbour_valid), (_, neighbour_range, _) in zip(
        point_neighbours,
        range_neighbours,
        strict=True,
    ):
        pair_valid = valid & neighbour_valid
        difference = np.zeros(valid.shape, dtype=np.float64)
        difference[pair_valid] = np.abs(
            np.log(safe_ranges[pair_valid] / neighbour_range[pair_valid])
        )
        np.maximum(log_jump, difference, out=log_jump)
        range_neighbour_count += pair_valid
        distance = np.linalg.norm(neighbour_points - grid, axis=2)
        gated = pair_valid & np.isfinite(distance) & (distance < gate_limit)
        gated_by_name[name] = gated
        points_by_name[name] = neighbour_points
        valid_by_name[name] = neighbour_valid
        gated_neighbour_count += gated

    normal_stencil_valid = valid.copy()
    for name in ("left", "right", "up", "down"):
        normal_stencil_valid &= gated_by_name[name]
    horizontal = points_by_name["right"] - points_by_name["left"]
    vertical = points_by_name["down"] - points_by_name["up"]
    normals = np.cross(horizontal, vertical)
    normal_length = np.linalg.norm(normals, axis=2)
    normal_valid = (
        normal_stencil_valid
        & np.isfinite(normal_length)
        & (normal_length > NORMAL_EPSILON)
    )
    normals = np.divide(
        normals,
        normal_length[..., None],
        out=np.zeros_like(normals),
        where=normal_valid[..., None],
    )

    normal_discontinuity = np.zeros(valid.shape, dtype=np.float64)
    normal_neighbours = _four_neighbours(normals, normal_valid)
    for name, neighbour_normal, neighbour_normal_valid in normal_neighbours:
        comparable = (
            normal_valid
            & neighbour_normal_valid
            & gated_by_name[name]
        )
        crease = np.zeros(comparable.shape, dtype=np.float64)
        if np.any(comparable):
            dots = np.sum(normals * neighbour_normal, axis=2)
            crease[comparable] = 1.0 - np.abs(
                np.clip(dots[comparable], -1.0, 1.0)
            )
        np.maximum(normal_discontinuity, crease, out=normal_discontinuity)

    return {
        "rangeMetres": np.where(valid, ranges, 0.0),
        "validMask": valid,
        "absoluteLogRangeJump": log_jump,
        "rangeNeighbourCount": range_neighbour_count,
        "normalNeighbourCount": gated_neighbour_count,
        "surfaceNormals": normals,
        "normalValidMask": normal_valid,
        "surfaceNormalDiscontinuity": normal_discontinuity,
    }


def prepare_geometry_samples(
    fields: Mapping[str, Any],
    *,
    row_count: int | None = None,
    column_count: int | None = None,
    decimation_stride: int = DECIMATION_STRIDE,
) -> dict[str, Any]:
    """Reconstruct, stride-decimate, signal, and flatten valid geometry."""

    full_grid = reconstruct_organized_xyz(
        fields,
        row_count=row_count,
        column_count=column_count,
    )
    grid = deterministic_decimate_grid(full_grid, stride=decimation_stride)
    signals = geometry_signals(grid)
    indexes = np.flatnonzero(signals["validMask"])
    flat_points = grid.reshape(-1, 3)
    return {
        "fullGridShape": [int(full_grid.shape[0]), int(full_grid.shape[1])],
        "gridShape": [int(grid.shape[0]), int(grid.shape[1])],
        "decimationStride": decimation_stride,
        "validPointCount": int(np.count_nonzero(signals["validMask"])),
        "sampleCount": int(len(indexes)),
        "flatGridIndexes": indexes,
        "points": np.ascontiguousarray(flat_points[indexes]),
        "absoluteLogRangeJump": np.ascontiguousarray(
            signals["absoluteLogRangeJump"].reshape(-1)[indexes]
        ),
        "surfaceNormalDiscontinuity": np.ascontiguousarray(
            signals["surfaceNormalDiscontinuity"].reshape(-1)[indexes]
        ),
        "signals": signals,
    }


def project_geometry_signals_zbuffer(
    points: np.ndarray,
    absolute_log_range_jump: np.ndarray,
    surface_normal_discontinuity: np.ndarray,
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
    minimum_depth: float = MIN_POSITIVE_DEPTH_METRES,
    maximum_depth: float = MAX_POSITIVE_DEPTH_METRES,
) -> dict[str, np.ndarray | int]:
    """Project geometry signals and retain the nearest point per output pixel."""

    xyz = np.asarray(points, dtype=np.float64)
    if xyz.ndim != 2 or xyz.shape[1] != 3:
        raise ValueError("points must have shape (point_count, 3)")
    point_count = len(xyz)
    jumps = _one_dimensional_array(
        absolute_log_range_jump,
        name="absolute_log_range_jump",
        length=point_count,
    ).astype(np.float64, copy=False)
    normals = _one_dimensional_array(
        surface_normal_discontinuity,
        name="surface_normal_discontinuity",
        length=point_count,
    ).astype(np.float64, copy=False)
    if (
        not isinstance(width, (int, np.integer))
        or isinstance(width, (bool, np.bool_))
        or not isinstance(height, (int, np.integer))
        or isinstance(height, (bool, np.bool_))
        or width <= 0
        or height <= 0
    ):
        raise ValueError("projection width and height must be positive")
    if (
        not np.all(np.isfinite(jumps))
        or not np.all(np.isfinite(normals))
        or np.any(jumps < 0.0)
        or np.any(normals < 0.0)
    ):
        raise ValueError("geometry signals must be finite and non-negative")
    if not all(
        np.isfinite(value)
        for value in (fx, fy, cx, cy, minimum_depth, maximum_depth)
    ):
        raise ValueError("projection parameters must be finite")
    if fx <= 0.0 or fy <= 0.0 or minimum_depth < 0.0 or maximum_depth <= minimum_depth:
        raise ValueError("invalid focal length or depth interval")
    basis_vectors = []
    for name, value in (("forward", forward), ("right", right), ("down", down)):
        vector = np.asarray(value, dtype=np.float64)
        if vector.shape != (3,) or not np.all(np.isfinite(vector)):
            raise ValueError(f"{name} must be a finite three-vector")
        basis_vectors.append(vector)
    forward_vector, right_vector, down_vector = basis_vectors
    depth = xyz @ forward_vector
    safe_depth = np.where(np.abs(depth) > 1.0e-15, depth, 1.0)
    u = cx + fx * (xyz @ right_vector) / safe_depth
    v = (height - cy) + fy * (xyz @ down_vector) / safe_depth
    valid = (
        np.all(np.isfinite(xyz), axis=1)
        & np.isfinite(depth)
        & np.isfinite(u)
        & np.isfinite(v)
        & (depth > minimum_depth)
        & (depth < maximum_depth)
        & (u >= 0.0)
        & (u < width)
        & (v >= 0.0)
        & (v < height)
    )
    source_indexes = np.flatnonzero(valid)
    pixel_x = np.floor(u[source_indexes]).astype(np.int64)
    pixel_y = np.floor(v[source_indexes]).astype(np.int64)
    pixel_ids = pixel_y * width + pixel_x
    # Primary sort key is pixel, then depth, then original source index.
    order = np.lexsort((source_indexes, depth[source_indexes], pixel_ids))
    sorted_pixel_ids = pixel_ids[order]
    first = np.ones(len(order), dtype=bool)
    if len(first) > 1:
        first[1:] = sorted_pixel_ids[1:] != sorted_pixel_ids[:-1]
    visible_indexes = source_indexes[order[first]]
    visible_x = np.floor(u[visible_indexes]).astype(np.int64)
    visible_y = np.floor(v[visible_indexes]).astype(np.int64)

    depth_image = np.zeros((height, width), dtype=np.float64)
    jump_image = np.zeros((height, width), dtype=np.float64)
    normal_image = np.zeros((height, width), dtype=np.float64)
    occupied = np.zeros((height, width), dtype=bool)
    source_index_image = np.full((height, width), -1, dtype=np.int64)
    depth_image[visible_y, visible_x] = depth[visible_indexes]
    jump_image[visible_y, visible_x] = jumps[visible_indexes]
    normal_image[visible_y, visible_x] = normals[visible_indexes]
    source_index_image[visible_y, visible_x] = visible_indexes
    occupied[visible_y, visible_x] = True
    return {
        "depthImage": depth_image,
        "absoluteLogRangeJumpImage": jump_image,
        "surfaceNormalDiscontinuityImage": normal_image,
        "occupiedMask": occupied,
        "sourceIndexImage": source_index_image,
        "projectedInputCount": int(len(source_indexes)),
        "visiblePixelCount": int(len(visible_indexes)),
    }


def empirical_cdf_rank_map(values: np.ndarray, occupied_mask: np.ndarray) -> np.ndarray:
    """Rank positive occupied values with the prototype's right-sided ECDF."""

    signal = np.asarray(values, dtype=np.float64)
    occupied = np.asarray(occupied_mask)
    if signal.ndim != 2 or occupied.shape != signal.shape or occupied.dtype.kind != "b":
        raise ValueError("signal and occupied mask must be matching two-dimensional images")
    if not np.all(np.isfinite(signal[occupied])):
        raise ValueError("occupied signal values must be finite")
    positive_values = signal[(signal > 0.0) & occupied]
    output = np.zeros(signal.shape, dtype=np.float64)
    if not len(positive_values):
        return output
    sorted_values = np.sort(positive_values)
    output[occupied] = (
        np.searchsorted(sorted_values, signal[occupied], side="right")
        / len(sorted_values)
    )
    return output


def geometry_edge_strength(
    absolute_log_range_jump: np.ndarray,
    surface_normal_discontinuity: np.ndarray,
    occupied_mask: np.ndarray,
) -> np.ndarray:
    jumps = np.asarray(absolute_log_range_jump, dtype=np.float64)
    normals = np.asarray(surface_normal_discontinuity, dtype=np.float64)
    if jumps.shape != normals.shape:
        raise ValueError("range-jump and normal-discontinuity images must match")
    return np.maximum(
        empirical_cdf_rank_map(jumps, occupied_mask),
        empirical_cdf_rank_map(normals, occupied_mask),
    )


def _clear_image_border(mask: np.ndarray, border_pixels: int) -> np.ndarray:
    if not isinstance(border_pixels, int) or isinstance(border_pixels, bool) or border_pixels < 0:
        raise ValueError("border_pixels must be a non-negative integer")
    output = np.asarray(mask, dtype=bool).copy()
    if border_pixels == 0:
        return output
    if output.shape[0] <= 2 * border_pixels or output.shape[1] <= 2 * border_pixels:
        output[:] = False
        return output
    output[:border_pixels, :] = False
    output[-border_pixels:, :] = False
    output[:, :border_pixels] = False
    output[:, -border_pixels:] = False
    return output


def strongest_geometry_edge_mask(
    absolute_log_range_jump_image: np.ndarray,
    surface_normal_discontinuity_image: np.ndarray,
    occupied_mask: np.ndarray,
    *,
    fraction: float = GEOMETRY_EDGE_FRACTION,
    dilation_iterations: int = GEOMETRY_DILATION_ITERATIONS,
    border_pixels: int = EDGE_BORDER_PIXELS,
) -> tuple[np.ndarray, np.ndarray]:
    strength = geometry_edge_strength(
        absolute_log_range_jump_image,
        surface_normal_discontinuity_image,
        occupied_mask,
    )
    if not (0.0 < fraction <= 1.0):
        raise ValueError("geometry edge fraction must be in (0, 1]")
    if (
        not isinstance(dilation_iterations, int)
        or isinstance(dilation_iterations, bool)
        or dilation_iterations < 0
    ):
        raise ValueError("dilation_iterations must be a non-negative integer")
    occupied = np.asarray(occupied_mask)
    positive_values = strength[(strength > 0.0) & occupied]
    mask = np.zeros(strength.shape, dtype=bool)
    if len(positive_values):
        threshold = float(np.percentile(positive_values, 100.0 * (1.0 - fraction)))
        mask = (strength >= threshold) & occupied
        if dilation_iterations:
            mask = ndimage.binary_dilation(mask, iterations=dilation_iterations)
    return _clear_image_border(mask, border_pixels), strength


def photo_luminance(photo: np.ndarray) -> np.ndarray:
    image = np.asarray(photo)
    if image.ndim not in (2, 3) or (image.ndim == 3 and image.shape[2] not in (3, 4)):
        raise ValueError("photo must be grayscale, RGB, or RGBA")
    if min(image.shape[:2]) < 3:
        raise ValueError("photo must be at least 3 by 3 pixels")
    if np.issubdtype(image.dtype, np.integer):
        if np.issubdtype(image.dtype, np.signedinteger) and np.any(image < 0):
            raise ValueError("integer photo samples must be non-negative")
        maximum = float(np.iinfo(image.dtype).max)
        normalized = image.astype(np.float64) / maximum
    else:
        normalized = image.astype(np.float64)
        if not np.all(np.isfinite(normalized)):
            raise ValueError("floating-point photo samples must be finite")
        if np.any(normalized < 0.0) or np.any(normalized > 1.0):
            raise ValueError("floating-point photo samples must be in [0, 1]")
    if normalized.ndim == 2:
        return normalized
    rgb = normalized[..., :3]
    return (
        0.2126 * rgb[..., 0]
        + 0.7152 * rgb[..., 1]
        + 0.0722 * rgb[..., 2]
    )


def gaussian_sobel_photo_edges(
    photo: np.ndarray,
    *,
    sigma: float = PHOTO_GAUSSIAN_SIGMA,
) -> np.ndarray:
    """Return the prototype's SciPy Gaussian/Sobel gradient magnitude."""

    if not np.isfinite(sigma) or sigma <= 0.0:
        raise ValueError("Gaussian sigma must be positive and finite")
    luminance = photo_luminance(photo)
    blurred = ndimage.gaussian_filter(luminance, sigma=sigma)
    gradient_x = ndimage.sobel(blurred, axis=1, mode="reflect") / 8.0
    gradient_y = ndimage.sobel(blurred, axis=0, mode="reflect") / 8.0
    return np.hypot(gradient_x, gradient_y)


def strongest_photo_edge_mask(
    photo_edge_magnitude: np.ndarray,
    *,
    fraction: float = PHOTO_EDGE_FRACTION,
    border_pixels: int = EDGE_BORDER_PIXELS,
) -> np.ndarray:
    values = np.asarray(photo_edge_magnitude, dtype=np.float64)
    if values.ndim != 2 or not np.all(np.isfinite(values)):
        raise ValueError("photo edge magnitude must be a finite two-dimensional image")
    if not (0.0 < fraction <= 1.0):
        raise ValueError("photo edge fraction must be in (0, 1]")
    interior = np.ones(values.shape, dtype=bool)
    interior = _clear_image_border(interior, border_pixels)
    if not np.any(interior):
        return interior
    threshold = float(np.percentile(values[interior], 100.0 * (1.0 - fraction)))
    # A flat image has a zero percentile threshold.  Treating ``value >= 0``
    # as an edge would then turn every interior pixel into a photo edge and
    # make an uninformative photograph look like a perfect geometry match.
    # The same failure occurs when genuine gradients occupy less than the
    # requested fraction.  Zero gradient is never an edge.
    return (values > 0.0) & (values >= threshold) & interior


def edge_alignment_metrics(
    geometry_edge_mask: np.ndarray,
    photo_edge_mask: np.ndarray,
    *,
    radius: float = PHOTO_MATCH_RADIUS_PIXELS,
) -> dict[str, int | float | None]:
    geometry = np.asarray(geometry_edge_mask)
    photo = np.asarray(photo_edge_mask)
    if (
        geometry.shape != photo.shape
        or geometry.ndim != 2
        or geometry.dtype.kind != "b"
        or photo.dtype.kind != "b"
    ):
        raise ValueError("geometry and photo edge masks must be matching boolean images")
    if not np.isfinite(radius) or radius < 0.0:
        raise ValueError("match radius must be non-negative and finite")
    geometry_count = int(np.count_nonzero(geometry))
    photo_count = int(np.count_nonzero(photo))
    if photo_count:
        distance_to_photo_edge = ndimage.distance_transform_edt(~photo)
        matched_count = int(
            np.count_nonzero(geometry & (distance_to_photo_edge <= radius))
        )
    else:
        # SciPy's EDT has no in-array zero to measure from when ``photo`` is
        # empty and assigns distances from an implementation-defined virtual
        # background.  Those are not distances to photo edges.
        matched_count = 0
    return {
        "geometryEdgePixelCount": geometry_count,
        "photoEdgePixelCount": photo_count,
        "matchedGeometryEdgePixelCount": matched_count,
        "matchRadiusPixels": radius,
        "matchedFraction": (
            matched_count / geometry_count if geometry_count else None
        ),
    }


def _canonical_skybox_name(name: str) -> str:
    match = re.fullmatch(r"\s*Skybox\s*([0-5])\s*", str(name), flags=re.IGNORECASE)
    if not match:
        raise ValueError("skybox name must identify Skybox 0 through Skybox 5")
    return f"Skybox {match.group(1)}"


def compare_cube_candidates(
    points: np.ndarray,
    absolute_log_range_jump: np.ndarray,
    surface_normal_discontinuity: np.ndarray,
    photo: np.ndarray,
    *,
    skybox_name: str,
    fx: float,
    fy: float,
    cx: float,
    cy: float,
    geometry_fraction: float = GEOMETRY_EDGE_FRACTION,
    photo_fraction: float = PHOTO_EDGE_FRACTION,
    match_radius: int = PHOTO_MATCH_RADIUS_PIXELS,
    candidates: Sequence[Mapping[str, Any]] = CANDIDATES,
) -> dict[str, Any]:
    """Score cube candidates while retaining the fixed v2 mapping as primary."""

    canonical_name = _canonical_skybox_name(skybox_name)
    primary_candidate_id = FIXED_V2_MAPPING[canonical_name]
    photo_edges = gaussian_sobel_photo_edges(photo)
    photo_mask = strongest_photo_edge_mask(photo_edges, fraction=photo_fraction)
    height, width = photo_mask.shape
    rows: list[dict[str, Any]] = []
    for candidate in candidates:
        candidate_id = str(candidate["id"])
        projection = project_geometry_signals_zbuffer(
            points,
            absolute_log_range_jump,
            surface_normal_discontinuity,
            forward=np.asarray(candidate["forward"]),
            right=np.asarray(candidate["right"]),
            down=np.asarray(candidate["down"]),
            fx=fx,
            fy=fy,
            cx=cx,
            cy=cy,
            width=width,
            height=height,
        )
        geometry_mask, _ = strongest_geometry_edge_mask(
            np.asarray(projection["absoluteLogRangeJumpImage"]),
            np.asarray(projection["surfaceNormalDiscontinuityImage"]),
            np.asarray(projection["occupiedMask"]),
            fraction=geometry_fraction,
        )
        metrics = edge_alignment_metrics(
            geometry_mask,
            photo_mask,
            radius=match_radius,
        )
        rows.append(
            {
                "candidateId": candidate_id,
                "mirrored": bool(candidate["mirrored"]),
                "basisDeterminant": float(candidate["basisDeterminant"]),
                "visiblePixelCount": int(projection["visiblePixelCount"]),
                **metrics,
            }
        )
    rows.sort(
        key=lambda row: (
            -(
                float(row["matchedFraction"])
                if row["matchedFraction"] is not None
                else -1.0
            ),
            str(row["candidateId"]),
        )
    )
    row_by_id = {str(row["candidateId"]): row for row in rows}
    if primary_candidate_id not in row_by_id:
        raise ValueError("candidate set does not contain the fixed v2 primary mapping")
    return {
        "skyboxName": canonical_name,
        "primaryMappingVersion": "fixed-v2",
        "primaryCandidateId": primary_candidate_id,
        "primaryEvaluation": row_by_id[primary_candidate_id],
        "diagnosticWinnerCandidateId": rows[0]["candidateId"] if rows else None,
        "candidateComparisons": rows,
        "photoEdgePixelCount": int(np.count_nonzero(photo_mask)),
    }
