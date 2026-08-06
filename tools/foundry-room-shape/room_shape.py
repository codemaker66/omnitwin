#!/usr/bin/env python3
"""Authority-none room-shape proposer: measure a room's bounding surfaces.

This module measures.  It does not approve, it does not compare against any
external figure, and it deliberately reads and writes no files -- the point
cloud arrives as arrays and the proposal leaves as a dict.  Everything it
asserts is derived from the capture itself: the scanner's own tripod height,
its own walked footprint, its own residual spread.

The discriminator that makes this work is a **conjunction**, not a single
ratio.  A bounding wall must simultaneously

  1. be areally complete within its own support, after enclosed holes are
     filled so that windows and doorways count as the masonry around them;
  2. span most of the measured floor-to-ceiling height; and
  3. span at least most of the scanner's own walked footprint along it.

A corridor wall glimpsed through a doorway is ~100% complete within the tiny
patch the door cone lights, so test (1) alone would accept it.  It fails (2)
and (3) by an order of magnitude.  A real wall passes all three.  Every
threshold is a ratio against a quantity this capture measured.

Dimensions are plane-to-plane distances between refit boundary planes, never
the bounding box of a cropped cloud, so an outward crop margin is structurally
incapable of inflating a measurement.

The output is a *proposal*.  It carries `authority: "none"` and defers to the
programme's existing human review seam,
`omnitwin.foundry.room-envelope-review.v0`.  It cannot approve itself.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
import hashlib
import json
import math
from typing import Any, Iterable, Sequence

import numpy as np

ROOM_SHAPE_SCHEMA_VERSION = "omnitwin.foundry.room-shape-proposal.v0"
ROOM_SHAPE_DIGEST_DOMAIN = b"OMNITWIN_FOUNDRY_ROOM_SHAPE_PROPOSAL_V0\0"
REVIEW_SEAM_SCHEMA_VERSION = "omnitwin.foundry.room-envelope-review.v0"
REVIEW_SEAM_MAX_VERTICES = 64

# --- thresholds -----------------------------------------------------------
# Each is a ratio against a quantity this capture measured, or a floor below
# which the instrument cannot speak.  None encodes a room dimension.
COMPLETENESS_ACCEPT = 0.60
COVERAGE_HEIGHT_ACCEPT = 0.60
COVERAGE_WALKED_ACCEPT = 0.75
CELL_M = 0.10
MIN_PLANE_TOLERANCE_M = 0.03
MEASUREMENT_FLOOR_M = 0.01
HORIZONTAL_NORMAL_MIN_COS = 0.85
VERTICAL_NORMAL_MAX_COS = 0.20
AXIS_NORMAL_MIN_COS = math.cos(math.radians(25.0))
MIN_NORMAL_COVERAGE = 0.99
PEAK_BIN_M = 0.05
PEAK_MERGE_M = 0.15
PEAK_MIN_SHARE = 0.01
MAX_CANDIDATES_PER_SIDE = 10
SPAN_ESTIMATOR_MAX_POINTS = 200_000
OUTBOARD_MASS_MARGIN_M = 0.25
OUTBOARD_REVIEW_MIN_POINTS = 1_000
OUTBOARD_REVIEW_MIN_RATIO = 0.10
DISPUTE_COMPLETENESS_MARGIN = 0.25
DISPUTE_SEPARATION_M = 0.50

WALL_NAMES = ("x_min", "x_max", "y_min", "y_max")

LIMITATION_NO_SWEEP_MULTIPLICITY = (
    "PER_POINT_SWEEP_IDENTITY_IS_ABSENT_FROM_THE_CACHED_CLOUD_SO_SWEEP_"
    "MULTIPLICITY_IS_NOT_A_DISCRIMINATOR_IN_THIS_REVISION"
)
LIMITATION_NO_MIRROR_ADJUDICATION = (
    "MIRRORS_ARE_NOT_ADJUDICATED_IN_THIS_REVISION_AND_A_LARGE_MIRROR_CAN_"
    "MANUFACTURE_A_DENSE_CORRECTLY_ORIENTED_VIRTUAL_ROOM"
)
LIMITATION_NO_VISIBILITY_CARVE = (
    "NO_VISIBILITY_CARVE_IS_PERFORMED_SO_AN_OPENING_THAT_LIGHTS_A_FULL_"
    "HEIGHT_FULL_LENGTH_SURFACE_BEYOND_IT_IS_NOT_SEPARATELY_REFUTED"
)
LIMITATION_CONVEX_FOOTPRINT = (
    "THE_PROPOSED_FOOTPRINT_IS_A_FOUR_PLANE_CONVEX_PRISM_AND_DOES_NOT_"
    "REPRESENT_ALCOVES_APSES_OR_ANY_NON_CONVEX_ARCHITECTURE"
)
LIMITATION_NOT_A_REVIEW = (
    "THIS_ARTIFACT_IS_A_MACHINE_PROPOSAL_WITH_NO_AUTHORITY_AND_ESTABLISHES_"
    "NO_ROOM_IDENTITY_RIGHTS_REGISTRATION_OR_VALIDATION_INDEPENDENCE"
)

ALL_LIMITATIONS = (
    LIMITATION_NO_SWEEP_MULTIPLICITY,
    LIMITATION_NO_MIRROR_ADJUDICATION,
    LIMITATION_NO_VISIBILITY_CARVE,
    LIMITATION_CONVEX_FOOTPRINT,
    LIMITATION_NOT_A_REVIEW,
)


# --------------------------------------------------------------------------
# Primitives
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Plane:
    """A plane written as ``normal . x = offset``, normal a unit vector."""

    normal: tuple[float, float, float]
    offset: float
    rms_m: float
    sigma_m: float
    inlier_count: int

    def signed_distance(self, points: np.ndarray) -> np.ndarray:
        return points @ np.asarray(self.normal) - self.offset


def _robust_sigma(residuals: np.ndarray) -> float:
    if residuals.size == 0:
        return 0.0
    median = float(np.median(residuals))
    mad = float(np.median(np.abs(residuals - median)))
    return 1.4826 * mad


def fit_plane(points: np.ndarray, *, orient_toward: np.ndarray | None = None) -> Plane:
    """Total-least-squares plane fit via the covariance's smallest eigenvector.

    ``orient_toward`` flips the normal so it points at that location, which is
    how every boundary plane in this module is made to face inward.
    """
    if points.shape[0] < 3:
        raise ValueError("a plane fit needs at least three points")
    centroid = points.mean(axis=0)
    centred = points - centroid
    covariance = centred.T @ centred / float(points.shape[0])
    _, vectors = np.linalg.eigh(covariance)
    normal = np.asarray(vectors[:, 0], dtype=float)
    norm = float(np.linalg.norm(normal))
    if norm == 0.0:
        raise ValueError("degenerate plane fit")
    normal = normal / norm
    if orient_toward is not None:
        if float(normal @ (np.asarray(orient_toward, dtype=float) - centroid)) < 0.0:
            normal = -normal
    offset = float(normal @ centroid)
    residuals = centred @ normal
    return Plane(
        normal=(float(normal[0]), float(normal[1]), float(normal[2])),
        offset=offset,
        rms_m=float(np.sqrt(np.mean(residuals**2))),
        sigma_m=_robust_sigma(residuals),
        inlier_count=int(points.shape[0]),
    )


def close_enclosed_holes(occupied: np.ndarray) -> np.ndarray:
    """Fill holes that the surrounding surface encloses.

    Indexed ``[iu, iv]`` with ``iv`` running vertically.  The first and last
    ``iv`` rows are *temporarily* sealed before flood-filling the background
    inward from the two ``iu`` borders, so a tall window running into the
    ceiling band still reads as enclosed masonry rather than as open edge.
    Those seeded rows never enter the returned mask on their own account.
    """
    if occupied.ndim != 2:
        raise ValueError("occupancy mask must be two-dimensional")
    n_u, n_v = occupied.shape
    if n_u == 0 or n_v == 0:
        return occupied.copy()

    sealed = occupied.copy()
    sealed[:, 0] = True
    sealed[:, n_v - 1] = True

    reachable = np.zeros_like(sealed)
    queue: deque[tuple[int, int]] = deque()
    for iu in (0, n_u - 1):
        for iv in range(n_v):
            if not sealed[iu, iv] and not reachable[iu, iv]:
                reachable[iu, iv] = True
                queue.append((iu, iv))
    while queue:
        iu, iv = queue.popleft()
        for du, dv in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ju, jv = iu + du, iv + dv
            if 0 <= ju < n_u and 0 <= jv < n_v:
                if not sealed[ju, jv] and not reachable[ju, jv]:
                    reachable[ju, jv] = True
                    queue.append((ju, jv))

    enclosed = (~sealed) & (~reachable)
    return occupied | enclosed


# --------------------------------------------------------------------------
# Frame
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class FloorFrame:
    up: tuple[float, float, float]
    floor_point: tuple[float, float, float]
    floor: Plane
    ceiling: Plane | None
    ceiling_height_m: float
    tripod_height_m: float
    tripod_height_spread_m: float
    ceiling_distance_m: float
    level_basis: tuple[tuple[float, float, float], tuple[float, float, float]]


def _level_basis(up: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    world = np.eye(3)
    seed = world[int(np.argmin(np.abs(world @ up)))]
    e1 = seed - float(seed @ up) * up
    e1 = e1 / float(np.linalg.norm(e1))
    e2 = np.cross(up, e1)
    return e1, e2


def _strongest_peak(
    values: np.ndarray,
    *,
    bin_m: float,
    window: tuple[float, float],
) -> float | None:
    inside = values[(values >= window[0]) & (values <= window[1])]
    if inside.size == 0 or window[1] <= window[0]:
        return None
    # Bin by count and range, never by an explicit arange edge list: numpy
    # drops samples above the final edge, and a float epsilon there silently
    # deletes whichever surface happens to sit at the extreme of the window.
    bin_count = max(1, int(math.ceil((window[1] - window[0]) / bin_m)))
    counts, edges = np.histogram(inside, bins=bin_count, range=window)
    if counts.max() == 0:
        return None
    index = int(np.argmax(counts))
    return float(0.5 * (edges[index] + edges[index + 1]))


def estimate_floor_frame(
    points: np.ndarray,
    normals: np.ndarray,
    origins: np.ndarray,
) -> FloorFrame:
    """Recover up, the floor plane, the ceiling plane and the tripod height.

    The up direction is seeded from the scanner origins themselves -- they sit
    at one constant tripod height on one floor, so their own best-fit plane is
    level by construction and is immune to whatever the scanner saw out through
    the windows.  It is then refined by refitting the floor.
    """
    if origins.shape[0] < 3:
        raise ValueError("the up seed needs at least three scanner origins")
    origin_centroid = origins.mean(axis=0)
    centred_origins = origins - origin_centroid
    _, vectors = np.linalg.eigh(centred_origins.T @ centred_origins)
    axis = np.asarray(vectors[:, 0], dtype=float)
    axis = axis / float(np.linalg.norm(axis))

    heights = points @ axis
    origin_height = float(origin_centroid @ axis)
    horizontal = np.abs(normals @ axis) > HORIZONTAL_NORMAL_MIN_COS
    horizontal_heights = heights[horizontal]
    if horizontal_heights.size == 0:
        raise ValueError("no horizontal surfaces found for a floor fit")

    below = _strongest_peak(
        horizontal_heights,
        bin_m=PEAK_BIN_M,
        window=(origin_height - 4.0, origin_height - 0.4),
    )
    above = _strongest_peak(
        horizontal_heights,
        bin_m=PEAK_BIN_M,
        window=(origin_height + 0.4, origin_height + 40.0),
    )
    # The tripod stands nearer the floor than the ceiling.  That is a fact
    # about the capture rig rather than about this building, and both distances
    # are reported so a reviewer can confirm the nearer surface is underfoot.
    ranked = [
        (abs(origin_height - height), height, sign)
        for height, sign in ((below, -1.0), (above, 1.0))
        if height is not None
    ]
    if not ranked:
        raise ValueError("no horizontal plane found on either side of the scanner")
    ranked.sort(key=lambda item: item[0])
    _, floor_axis_height, floor_sign = ranked[0]
    up = axis if floor_sign < 0.0 else -axis

    floor_band = horizontal & (
        np.abs(heights - floor_axis_height) < 4.0 * PEAK_BIN_M
    )
    if int(floor_band.sum()) < 3:
        raise ValueError("the floor band is too sparse to fit")
    floor = fit_plane(points[floor_band], orient_toward=origin_centroid)
    up = np.asarray(floor.normal, dtype=float)
    floor_point = origin_centroid - (float(up @ origin_centroid) - floor.offset) * up

    above_floor = (points - floor_point) @ up
    horizontal_refined = np.abs(normals @ up) > HORIZONTAL_NORMAL_MIN_COS
    ceiling_seed = _strongest_peak(
        above_floor[horizontal_refined],
        bin_m=PEAK_BIN_M,
        window=(float(np.max((origins - floor_point) @ up)) + 0.4, 60.0),
    )
    ceiling: Plane | None = None
    ceiling_height = 0.0
    if ceiling_seed is not None:
        band = horizontal_refined & (
            np.abs(above_floor - ceiling_seed) < 4.0 * PEAK_BIN_M
        )
        if int(band.sum()) >= 3:
            ceiling = fit_plane(points[band], orient_toward=origin_centroid)
            ceiling_height = float(np.mean(above_floor[band]))

    tripod = (origins - floor_point) @ up
    e1, e2 = _level_basis(up)
    return FloorFrame(
        up=(float(up[0]), float(up[1]), float(up[2])),
        floor_point=(
            float(floor_point[0]),
            float(floor_point[1]),
            float(floor_point[2]),
        ),
        floor=floor,
        ceiling=ceiling,
        ceiling_height_m=float(ceiling_height),
        tripod_height_m=float(np.mean(tripod)),
        tripod_height_spread_m=float(np.max(tripod) - np.min(tripod)),
        ceiling_distance_m=float(ceiling_height - float(np.mean(tripod))),
        level_basis=(
            (float(e1[0]), float(e1[1]), float(e1[2])),
            (float(e2[0]), float(e2[1]), float(e2[2])),
        ),
    )


# --------------------------------------------------------------------------
# Yaw
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class YawEstimate:
    normal_histogram_deg: float
    span_minimisation_deg: float
    disagreement_deg: float
    rectangularity: float


def _fold_to_quarter(degrees: float) -> float:
    folded = degrees % 90.0
    return folded - 90.0 if folded > 45.0 else folded


def estimate_yaw(
    points: np.ndarray,
    normals: np.ndarray,
    frame: FloorFrame,
) -> YawEstimate:
    """Two independent yaw estimates, reported rather than reconciled.

    The first reads the fourth circular moment of the vertical-surface normal
    directions -- a rectangular room puts its wall normals at psi, psi+90,
    psi+180, psi+270, so 4*theta collapses them onto one direction.  The second
    ignores normals entirely and minimises the summed robust span of a
    mid-height slab under rotation.  Disagreement is measured, never fatal.
    """
    up = np.asarray(frame.up, dtype=float)
    e1 = np.asarray(frame.level_basis[0], dtype=float)
    e2 = np.asarray(frame.level_basis[1], dtype=float)
    floor_point = np.asarray(frame.floor_point, dtype=float)
    height = (points - floor_point) @ up

    ceiling = (
        frame.ceiling_height_m
        if frame.ceiling_height_m > 0.0
        else float(np.percentile(height, 99.0))
    )
    vertical = (
        (np.abs(normals @ up) < VERTICAL_NORMAL_MAX_COS)
        & (height > 0.3)
        & (height < max(0.4, ceiling - 0.3))
    )
    if int(vertical.sum()) < 16:
        vertical = np.abs(normals @ up) < VERTICAL_NORMAL_MAX_COS

    wall_normals = normals[vertical]
    if wall_normals.shape[0] == 0:
        raise ValueError("no vertical surfaces found for a yaw estimate")
    theta = np.arctan2(wall_normals @ e2, wall_normals @ e1)
    moment = complex(np.exp(4j * theta).mean())
    psi_normals = math.degrees(math.atan2(moment.imag, moment.real)) / 4.0
    rectangularity = float(abs(moment))

    slab = (height > 0.35 * max(ceiling, 1.0)) & (height < 0.65 * max(ceiling, 1.0))
    slab_points = points[slab] if int(slab.sum()) >= 64 else points
    if slab_points.shape[0] > SPAN_ESTIMATOR_MAX_POINTS:
        # A fixed stride, never a random sample: the estimate must be
        # reproducible from the cloud alone.
        stride = int(slab_points.shape[0] // SPAN_ESTIMATOR_MAX_POINTS) + 1
        slab_points = slab_points[::stride]
    a1 = slab_points @ e1
    a2 = slab_points @ e2
    best_angle = 0.0
    best_span = math.inf
    for step in range(360):
        angle = math.radians(step * 0.25)
        cos_a, sin_a = math.cos(angle), math.sin(angle)
        low_u, high_u = np.percentile(a1 * cos_a + a2 * sin_a, (2.0, 98.0))
        low_v, high_v = np.percentile(-a1 * sin_a + a2 * cos_a, (2.0, 98.0))
        span = float((high_u - low_u) + (high_v - low_v))
        if span < best_span:
            best_span = span
            best_angle = step * 0.25

    psi_spans = _fold_to_quarter(best_angle)
    disagreement = abs(_fold_to_quarter(psi_normals - psi_spans))
    return YawEstimate(
        normal_histogram_deg=float(psi_normals),
        span_minimisation_deg=float(psi_spans),
        disagreement_deg=float(disagreement),
        rectangularity=rectangularity,
    )


def room_rotation(frame: FloorFrame, yaw_deg: float) -> np.ndarray:
    """Rows are the room's x, y and up directions in world coordinates."""
    e1 = np.asarray(frame.level_basis[0], dtype=float)
    e2 = np.asarray(frame.level_basis[1], dtype=float)
    up = np.asarray(frame.up, dtype=float)
    angle = math.radians(yaw_deg)
    r1 = math.cos(angle) * e1 + math.sin(angle) * e2
    r2 = -math.sin(angle) * e1 + math.cos(angle) * e2
    return np.vstack([r1, r2, up])


# --------------------------------------------------------------------------
# Candidates
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Candidate:
    name: str
    axis: int
    side: int
    plane: Plane
    offset_m: float
    tolerance_m: float
    completeness_raw: float
    completeness_closed: float
    coverage_height: float
    coverage_walked: float
    support_u_min_m: float
    support_u_max_m: float
    support_v_min_m: float
    support_v_max_m: float
    support_u_m: float
    support_v_m: float
    support_cells: int
    outboard_point_count: int
    outboard_to_inlier_ratio: float
    outboard_review_required: bool
    accepted: bool
    rejection: str | None


def _peaks(values: np.ndarray, *, minimum_share: float) -> list[float]:
    if values.size == 0:
        return []
    low, high = float(values.min()), float(values.max())
    if high - low < PEAK_BIN_M:
        return [0.5 * (low + high)]
    # See _strongest_peak: an explicit edge list loses the pool's own maximum,
    # which is always a real surface and is usually the densest one there is.
    bin_count = max(1, int(math.ceil((high - low) / PEAK_BIN_M)))
    counts, edges = np.histogram(values, bins=bin_count, range=(low, high))
    if counts.size == 0 or counts.max() == 0:
        return []
    threshold = float(counts.max()) * minimum_share
    order = np.argsort(counts)[::-1]
    chosen: list[float] = []
    for index in order:
        if counts[index] < threshold:
            break
        centre = float(0.5 * (edges[index] + edges[index + 1]))
        if all(abs(centre - existing) > PEAK_MERGE_M for existing in chosen):
            chosen.append(centre)
        if len(chosen) >= MAX_CANDIDATES_PER_SIDE:
            break
    return chosen


def _evaluate_candidate(
    *,
    name: str,
    axis: int,
    side: int,
    seed_offset: float,
    room_points: np.ndarray,
    room_normals: np.ndarray,
    room_origins: np.ndarray,
    ceiling_height: float,
    walked_span: float,
) -> Candidate | None:
    """Refit the candidate first, then judge it -- never the other way round."""
    inward = np.zeros(3)
    inward[axis] = -float(side)
    other = 1 - axis
    facing = room_normals @ inward > AXIS_NORMAL_MIN_COS
    coordinate = room_points[:, axis]
    interior_centroid = room_origins.mean(axis=0)

    tolerance = MIN_PLANE_TOLERANCE_M
    plane: Plane | None = None
    selected = np.zeros(room_points.shape[0], dtype=bool)
    offset = seed_offset
    for _ in range(3):
        selected = facing & (np.abs(coordinate - offset) < max(tolerance, PEAK_BIN_M))
        if int(selected.sum()) < 32:
            return None
        plane = fit_plane(room_points[selected], orient_toward=interior_centroid)
        tolerance = max(
            MIN_PLANE_TOLERANCE_M,
            3.0 * _robust_sigma(plane.signed_distance(room_points[selected])),
        )
        offset = float(np.median(coordinate[selected]))
    if plane is None:
        return None

    inliers = room_points[selected]
    u = inliers[:, other]
    v = inliers[:, 2]
    low_u, high_u = (float(value) for value in np.percentile(u, (2.0, 98.0)))
    low_v, high_v = (float(value) for value in np.percentile(v, (2.0, 98.0)))
    support_u = max(high_u - low_u, CELL_M)
    support_v = max(high_v - low_v, CELL_M)

    n_u = max(1, int(round(support_u / CELL_M)))
    n_v = max(1, int(round(support_v / CELL_M)))
    inside = (u >= low_u) & (u <= high_u) & (v >= low_v) & (v <= high_v)
    iu = np.clip(((u[inside] - low_u) / CELL_M).astype(int), 0, n_u - 1)
    iv = np.clip(((v[inside] - low_v) / CELL_M).astype(int), 0, n_v - 1)
    occupied = np.zeros((n_u, n_v), dtype=bool)
    occupied[iu, iv] = True
    closed = close_enclosed_holes(occupied)

    normal = np.asarray(plane.normal, dtype=float)
    if abs(normal[axis]) < 1e-6:
        return None
    centre_u = 0.5 * (low_u + high_u)
    centre_v = 0.5 * (low_v + high_v)
    plane_offset = (
        plane.offset - normal[other] * centre_u - normal[2] * centre_v
    ) / normal[axis]

    beyond = plane.signed_distance(room_points) < -OUTBOARD_MASS_MARGIN_M
    within = (
        (room_points[:, other] >= low_u)
        & (room_points[:, other] <= high_u)
        & (room_points[:, 2] >= low_v)
        & (room_points[:, 2] <= high_v)
    )
    outboard = int(np.count_nonzero(beyond & within))
    outboard_ratio = outboard / max(int(selected.sum()), 1)
    outboard_review_required = (
        outboard >= OUTBOARD_REVIEW_MIN_POINTS
        and outboard_ratio >= OUTBOARD_REVIEW_MIN_RATIO
    )

    completeness_closed = float(closed.mean())
    coverage_height = float(support_v / ceiling_height) if ceiling_height > 0 else 0.0
    coverage_walked = float(support_u / walked_span) if walked_span > 0 else 0.0

    rejection: str | None = None
    if completeness_closed < COMPLETENESS_ACCEPT:
        rejection = "INCOMPLETE_SURFACE"
    elif coverage_height < COVERAGE_HEIGHT_ACCEPT:
        rejection = "DOES_NOT_SPAN_MEASURED_HEIGHT"
    elif coverage_walked < COVERAGE_WALKED_ACCEPT:
        rejection = "DOES_NOT_SPAN_WALKED_FOOTPRINT"

    return Candidate(
        name=name,
        axis=axis,
        side=side,
        plane=plane,
        offset_m=float(plane_offset),
        tolerance_m=float(tolerance),
        completeness_raw=float(occupied.mean()),
        completeness_closed=completeness_closed,
        coverage_height=coverage_height,
        coverage_walked=coverage_walked,
        support_u_min_m=float(low_u),
        support_u_max_m=float(high_u),
        support_v_min_m=float(low_v),
        support_v_max_m=float(high_v),
        support_u_m=float(support_u),
        support_v_m=float(support_v),
        support_cells=int(n_u * n_v),
        outboard_point_count=outboard,
        outboard_to_inlier_ratio=float(outboard_ratio),
        outboard_review_required=bool(outboard_review_required),
        accepted=rejection is None,
        rejection=rejection,
    )


# --------------------------------------------------------------------------
# Certificate and separation
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class InteriorityCertificate:
    satisfied: bool
    origin_count: int
    violating_origin_count: int
    minimum_clearance_m: float


@dataclass(frozen=True)
class Separation:
    centre_m: float
    minimum_m: float
    maximum_m: float
    out_of_parallel_deg: float
    uncertainty_m: float


def certify_interiority(
    room_origins: np.ndarray,
    walls: Iterable[Candidate],
) -> InteriorityCertificate:
    """Every scanner origin must lie strictly inside every accepted wall.

    This is the one certificate in a single-room capture that cannot be faked:
    the scanner was demonstrably standing in the room it measured.
    """
    clearances = [wall.plane.signed_distance(room_origins) for wall in walls]
    if not clearances:
        return InteriorityCertificate(False, int(room_origins.shape[0]), 0, 0.0)
    per_origin = np.vstack(clearances).min(axis=0)
    return InteriorityCertificate(
        satisfied=bool(np.all(per_origin > 0.0)),
        origin_count=int(room_origins.shape[0]),
        violating_origin_count=int(np.count_nonzero(per_origin <= 0.0)),
        minimum_clearance_m=float(per_origin.min()),
    )


def measure_separation(near: Candidate, far: Candidate) -> Separation:
    """Perpendicular distance between two opposing refit planes.

    Sampled at the centre and the four corners of the region both planes
    actually support, so a genuinely splayed pair reports a range rather than
    one flattering number.
    """
    axis, other = near.axis, 1 - near.axis
    normal_a = np.asarray(near.plane.normal, dtype=float)
    normal_b = np.asarray(far.plane.normal, dtype=float)

    low_u = max(near.support_u_min_m, far.support_u_min_m)
    high_u = min(near.support_u_max_m, far.support_u_max_m)
    low_v = max(near.support_v_min_m, far.support_v_min_m)
    high_v = min(near.support_v_max_m, far.support_v_max_m)
    if high_u <= low_u or high_v <= low_v:
        raise ValueError("opposing planes have no common measured support")

    centre_u = 0.5 * (low_u + high_u)
    centre_v = 0.5 * (low_v + high_v)
    samples: list[tuple[float, float]] = [(centre_u, centre_v)]
    for sample_u in (low_u, high_u):
        for sample_v in (low_v, high_v):
            samples.append((sample_u, sample_v))

    distances: list[float] = []
    for sample_u, sample_v in samples:
        point = np.zeros(3)
        point[other] = sample_u
        point[2] = sample_v
        point[axis] = (
            near.plane.offset - normal_a[other] * point[other] - normal_a[2] * point[2]
        ) / normal_a[axis]
        distances.append(abs(float(normal_b @ point - far.plane.offset)))

    spread = max(distances) - min(distances)
    uncertainty = math.sqrt(
        near.plane.sigma_m**2
        + far.plane.sigma_m**2
        + (0.5 * spread) ** 2
        + MEASUREMENT_FLOOR_M**2
    )
    cosine = float(np.clip(-(normal_a @ normal_b), -1.0, 1.0))
    return Separation(
        centre_m=float(distances[0]),
        minimum_m=float(min(distances)),
        maximum_m=float(max(distances)),
        out_of_parallel_deg=float(math.degrees(math.acos(cosine))),
        uncertainty_m=float(uncertainty),
    )


def measure_plane_separation(
    near: Plane,
    far: Plane,
    support_points: np.ndarray,
) -> Separation:
    """Measure two planes over the region that was actually observed.

    The support points are projected onto ``near`` before distance to ``far``
    is evaluated.  This keeps the number plane-to-plane even when the capture
    frame is tilted, and makes non-parallelism widen the reported range rather
    than disappearing into one mean-height scalar.
    """
    support = np.asarray(support_points, dtype=float)
    if support.ndim != 2 or support.shape[1] != 3 or support.shape[0] < 1:
        raise ValueError("plane separation needs one or more 3D support points")
    if not np.isfinite(support).all():
        raise ValueError("plane separation support points must be finite")

    near_normal = np.asarray(near.normal, dtype=float)
    projected = support - near.signed_distance(support)[:, None] * near_normal
    distances = np.abs(far.signed_distance(projected))

    centre = support.mean(axis=0, keepdims=True)
    centre_on_near = centre - near.signed_distance(centre)[:, None] * near_normal
    centre_distance = abs(float(far.signed_distance(centre_on_near)[0]))
    spread = float(distances.max() - distances.min())
    far_normal = np.asarray(far.normal, dtype=float)
    cosine = float(np.clip(-(near_normal @ far_normal), -1.0, 1.0))
    return Separation(
        centre_m=centre_distance,
        minimum_m=float(distances.min()),
        maximum_m=float(distances.max()),
        out_of_parallel_deg=float(math.degrees(math.acos(cosine))),
        uncertainty_m=float(
            math.sqrt(
                near.sigma_m**2
                + far.sigma_m**2
                + (0.5 * spread) ** 2
                + MEASUREMENT_FLOOR_M**2
            )
        ),
    )


# --------------------------------------------------------------------------
# Measurement
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class RoomShapeMeasurement:
    state: str
    refusals: tuple[str, ...]
    frame: FloorFrame
    yaw: YawEstimate
    rotation: tuple[tuple[float, float, float], ...]
    candidates: tuple[Candidate, ...]
    accepted_walls: tuple[Candidate, ...]
    interiority: InteriorityCertificate
    axis_separations: dict[str, Separation | None]
    long_axis_m: Separation | None
    short_axis_m: Separation | None
    height_m: Separation | None
    footprint_polygon_m: tuple[tuple[float, float], ...] | None
    input_point_count: int
    usable_normal_count: int

    def wall(self, name: str) -> Candidate | None:
        for candidate in self.accepted_walls:
            if candidate.name == name:
                return candidate
        return None


def _footprint(
    walls: dict[str, Candidate],
) -> tuple[tuple[float, float], ...] | None:
    if not set(WALL_NAMES).issubset(walls.keys()):
        return None
    corners: list[tuple[float, float]] = []
    for x_name, y_name in (
        ("x_min", "y_min"),
        ("x_max", "y_min"),
        ("x_max", "y_max"),
        ("x_min", "y_max"),
    ):
        a = walls[x_name].plane
        b = walls[y_name].plane
        matrix = np.array(
            [[a.normal[0], a.normal[1]], [b.normal[0], b.normal[1]]], dtype=float
        )
        if abs(float(np.linalg.det(matrix))) < 1e-9:
            return None
        solution = np.linalg.solve(matrix, np.array([a.offset, b.offset], dtype=float))
        corners.append((float(solution[0]), float(solution[1])))
    return tuple(corners)


def _validated_inputs(
    points: np.ndarray,
    normals: np.ndarray,
    origins: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, int]:
    points = np.asarray(points, dtype=float)
    normals = np.asarray(normals, dtype=float)
    origins = np.asarray(origins, dtype=float)
    if points.ndim != 2 or points.shape[1:] != (3,) or points.shape[0] < 64:
        raise ValueError("points must contain at least 64 finite XYZ rows")
    if normals.shape != points.shape:
        raise ValueError("normals must have exactly one XYZ row per point")
    if origins.ndim != 2 or origins.shape[1:] != (3,) or origins.shape[0] < 3:
        raise ValueError("origins must contain at least three XYZ scanner centres")
    if not (
        np.isfinite(points).all()
        and np.isfinite(normals).all()
        and np.isfinite(origins).all()
    ):
        raise ValueError("points, normals and origins must all be finite")
    lengths = np.linalg.norm(normals, axis=1)
    usable = lengths > 1e-12
    usable_count = int(np.count_nonzero(usable))
    if usable_count == 0:
        raise ValueError("at least one normal must be non-zero")
    normalised = np.zeros_like(normals)
    normalised[usable] = normals[usable] / lengths[usable, None]
    return points, normalised, origins, usable_count


def measure_room_shape(
    points: np.ndarray,
    normals: np.ndarray,
    origins: np.ndarray,
) -> RoomShapeMeasurement:
    points, normals, origins, usable_normal_count = _validated_inputs(
        points, normals, origins
    )

    frame = estimate_floor_frame(points, normals, origins)
    yaw = estimate_yaw(points, normals, frame)
    rotation = room_rotation(frame, yaw.normal_histogram_deg)
    floor_point = np.asarray(frame.floor_point, dtype=float)

    room_points = (points - floor_point) @ rotation.T
    room_normals = normals @ rotation.T
    room_origins = (origins - floor_point) @ rotation.T

    ceiling_height = frame.ceiling_height_m
    if ceiling_height <= 0.0:
        ceiling_height = float(np.percentile(room_points[:, 2], 99.0))

    refusals: list[str] = []
    if usable_normal_count / float(points.shape[0]) < MIN_NORMAL_COVERAGE:
        refusals.append("INSUFFICIENT_NORMAL_COVERAGE")
    if frame.ceiling is None:
        refusals.append("CEILING_AMBIGUOUS")

    all_candidates: list[Candidate] = []
    accepted: dict[str, Candidate] = {}
    disputes: list[str] = []

    for axis in (0, 1):
        other = 1 - axis
        walked_span = float(
            room_origins[:, other].max() - room_origins[:, other].min()
        )
        for side in (-1, 1):
            name = f"{'xy'[axis]}_{'min' if side < 0 else 'max'}"
            inward = np.zeros(3)
            inward[axis] = -float(side)
            facing = room_normals @ inward > AXIS_NORMAL_MIN_COS
            limit = (
                room_origins[:, axis].min()
                if side < 0
                else room_origins[:, axis].max()
            )
            beyond_walked = (
                room_points[:, axis] < limit
                if side < 0
                else room_points[:, axis] > limit
            )
            side_candidates: list[Candidate] = []
            for seed in _peaks(
                room_points[facing & beyond_walked, axis],
                minimum_share=PEAK_MIN_SHARE,
            ):
                candidate = _evaluate_candidate(
                    name=name,
                    axis=axis,
                    side=side,
                    seed_offset=seed,
                    room_points=room_points,
                    room_normals=room_normals,
                    room_origins=room_origins,
                    ceiling_height=ceiling_height,
                    walked_span=walked_span,
                )
                if candidate is not None:
                    side_candidates.append(candidate)
            all_candidates.extend(side_candidates)

            passing = [item for item in side_candidates if item.accepted]
            if not passing:
                refusals.append(f"WALL_NOT_FOUND:{name}")
                continue
            # The outermost surface that passes bounds the room; an inboard
            # colonnade that also passes is recorded but does not win.
            passing.sort(key=lambda item: item.offset_m * side, reverse=True)
            chosen = passing[0]
            accepted[name] = chosen
            if chosen.outboard_review_required:
                disputes.append(f"OUTBOARD_MASS_UNADJUDICATED:{name}")
            if len(passing) > 1:
                runner = passing[1]
                if (
                    abs(chosen.offset_m - runner.offset_m) > DISPUTE_SEPARATION_M
                    and runner.completeness_closed - chosen.completeness_closed
                    > DISPUTE_COMPLETENESS_MARGIN
                ):
                    disputes.append(f"WALL_DISPUTED:{name}")

    refusals.extend(disputes)
    interiority = certify_interiority(room_origins, accepted.values())
    if accepted and not interiority.satisfied:
        refusals.append("INTERIORITY_VIOLATED")

    separations: dict[str, Separation | None] = {"x": None, "y": None, "z": None}
    for axis_index, key in ((0, "x"), (1, "y")):
        low = accepted.get(f"{key}_min")
        high = accepted.get(f"{key}_max")
        if low is not None and high is not None and interiority.satisfied:
            try:
                separations[key] = measure_separation(low, high)
            except ValueError:
                refusals.append(f"OPPOSING_SUPPORT_DOES_NOT_OVERLAP:{key}")

    if frame.ceiling is not None and ceiling_height > 0.0:
        x_low, x_high = float(room_origins[:, 0].min()), float(room_origins[:, 0].max())
        y_low, y_high = float(room_origins[:, 1].min()), float(room_origins[:, 1].max())
        z_support = float(room_origins[:, 2].mean())
        support_room = np.array(
            [
                [0.5 * (x_low + x_high), 0.5 * (y_low + y_high), z_support],
                [x_low, y_low, z_support],
                [x_low, y_high, z_support],
                [x_high, y_low, z_support],
                [x_high, y_high, z_support],
            ],
            dtype=float,
        )
        support_world = floor_point + support_room @ rotation
        separations["z"] = measure_plane_separation(
            frame.floor,
            frame.ceiling,
            support_world,
        )

    horizontal = [separations["x"], separations["y"]]
    if all(item is not None for item in horizontal):
        ordered = sorted(
            (item for item in horizontal if item is not None),
            key=lambda item: item.centre_m,
        )
        short_axis, long_axis = ordered[0], ordered[1]
    else:
        short_axis, long_axis = None, None

    footprint = (
        _footprint(accepted)
        if interiority.satisfied and not refusals
        else None
    )
    state = (
        "measured"
        if long_axis is not None
        and short_axis is not None
        and separations["z"] is not None
        and interiority.satisfied
        and not refusals
        else "unmeasurable"
    )
    if state == "unmeasurable" and not refusals:
        refusals.append("UNMEASURABLE:NO_REASON_RECORDED")

    return RoomShapeMeasurement(
        state=state,
        refusals=tuple(refusals),
        frame=frame,
        yaw=yaw,
        rotation=tuple(
            (float(row[0]), float(row[1]), float(row[2])) for row in rotation
        ),
        candidates=tuple(all_candidates),
        accepted_walls=tuple(
            accepted[name] for name in WALL_NAMES if name in accepted
        ),
        interiority=interiority,
        axis_separations=separations,
        long_axis_m=long_axis,
        short_axis_m=short_axis,
        height_m=separations["z"],
        footprint_polygon_m=footprint,
        input_point_count=int(points.shape[0]),
        usable_normal_count=usable_normal_count,
    )


# --------------------------------------------------------------------------
# Proposal artifact
# --------------------------------------------------------------------------


def _round(value: float) -> float:
    return float(round(float(value), 9))


def _round_all(value: Any) -> Any:
    if isinstance(value, float):
        return _round(value)
    if isinstance(value, dict):
        return {key: _round_all(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_round_all(item) for item in value]
    return value


def polygon_is_simple(vertices: Sequence[Sequence[float]]) -> bool:
    """The review seam's own rule: unique vertices, no self-intersection."""

    def orientation(
        a: Sequence[float], b: Sequence[float], c: Sequence[float]
    ) -> float:
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

    def on_segment(a: Sequence[float], b: Sequence[float], p: Sequence[float]) -> bool:
        return (
            abs(orientation(a, b, p)) < 1e-12
            and min(a[0], b[0]) <= p[0] <= max(a[0], b[0])
            and min(a[1], b[1]) <= p[1] <= max(a[1], b[1])
        )

    def intersects(
        a: Sequence[float],
        b: Sequence[float],
        c: Sequence[float],
        d: Sequence[float],
    ) -> bool:
        o1, o2 = orientation(a, b, c), orientation(a, b, d)
        o3, o4 = orientation(c, d, a), orientation(c, d, b)
        if ((o1 > 0) != (o2 > 0)) and ((o3 > 0) != (o4 > 0)):
            return True
        return (
            on_segment(a, b, c)
            or on_segment(a, b, d)
            or on_segment(c, d, a)
            or on_segment(c, d, b)
        )

    count = len(vertices)
    if count < 3:
        return False
    if len({tuple(vertex) for vertex in vertices}) != count:
        return False
    for left in range(count):
        a, b = vertices[left], vertices[(left + 1) % count]
        for right in range(left + 1, count):
            if (
                left == right
                or (left + 1) % count == right
                or (right + 1) % count == left
            ):
                continue
            c, d = vertices[right], vertices[(right + 1) % count]
            if intersects(a, b, c, d):
                return False
    return True


def _plane_json(plane: Plane) -> dict[str, Any]:
    return {
        "normal": [_round(value) for value in plane.normal],
        "offsetM": _round(plane.offset),
        "rmsM": _round(plane.rms_m),
        "sigmaM": _round(plane.sigma_m),
        "inlierCount": int(plane.inlier_count),
    }


def _separation_json(separation: Separation | None) -> dict[str, Any] | None:
    if separation is None:
        return None
    return {
        "centreM": _round(separation.centre_m),
        "minimumM": _round(separation.minimum_m),
        "maximumM": _round(separation.maximum_m),
        "outOfParallelDeg": _round(separation.out_of_parallel_deg),
        "uncertaintyM": _round(separation.uncertainty_m),
    }


def _candidate_json(candidate: Candidate) -> dict[str, Any]:
    return {
        "name": candidate.name,
        "axis": int(candidate.axis),
        "side": int(candidate.side),
        "offsetM": _round(candidate.offset_m),
        "toleranceM": _round(candidate.tolerance_m),
        "completenessRaw": _round(candidate.completeness_raw),
        "completenessClosed": _round(candidate.completeness_closed),
        "coverageHeight": _round(candidate.coverage_height),
        "coverageWalked": _round(candidate.coverage_walked),
        "supportBoundsM": {
            "u": [
                _round(candidate.support_u_min_m),
                _round(candidate.support_u_max_m),
            ],
            "v": [
                _round(candidate.support_v_min_m),
                _round(candidate.support_v_max_m),
            ],
        },
        "supportUM": _round(candidate.support_u_m),
        "supportVM": _round(candidate.support_v_m),
        "supportCells": int(candidate.support_cells),
        "outboardPointCount": int(candidate.outboard_point_count),
        "outboardToInlierRatio": _round(candidate.outboard_to_inlier_ratio),
        "outboardReviewRequired": bool(candidate.outboard_review_required),
        "accepted": bool(candidate.accepted),
        "rejection": candidate.rejection,
        "plane": _plane_json(candidate.plane),
    }


def proposal_digest(payload: dict[str, Any]) -> str:
    canonical = json.dumps(
        _round_all(payload),
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
        ensure_ascii=True,
    )
    return hashlib.sha256(
        ROOM_SHAPE_DIGEST_DOMAIN + canonical.encode("utf-8")
    ).hexdigest()


def build_proposal(
    measurement: RoomShapeMeasurement,
    *,
    source_binding: dict[str, Any],
) -> dict[str, Any]:
    """Serialise one machine proposal.

    Deliberately carries no wall-clock stamp: two runs over the same cloud must
    produce the same digest, so a reviewer can tell a re-run from a re-tune.
    The timestamp belongs to the run receipt, not to the measurement.
    """
    frame = measurement.frame
    polygon = (
        [[_round(x), _round(y)] for x, y in measurement.footprint_polygon_m]
        if measurement.footprint_polygon_m is not None
        else None
    )
    payload: dict[str, Any] = {
        "schemaVersion": ROOM_SHAPE_SCHEMA_VERSION,
        "authority": "none",
        "reviewStatus": "unreviewed",
        "source": dict(source_binding),
        "frame": {
            "up": [_round(value) for value in frame.up],
            "floorPointM": [_round(value) for value in frame.floor_point],
            "floorPlane": _plane_json(frame.floor),
            "ceilingPlane": None
            if frame.ceiling is None
            else _plane_json(frame.ceiling),
            "ceilingHeightM": _round(frame.ceiling_height_m),
            "tripodHeightM": _round(frame.tripod_height_m),
            "tripodHeightSpreadM": _round(frame.tripod_height_spread_m),
            "scannerToCeilingM": _round(frame.ceiling_distance_m),
            "rotationRows": [
                [_round(value) for value in row] for row in measurement.rotation
            ],
        },
        "yaw": {
            "normalHistogramDeg": _round(measurement.yaw.normal_histogram_deg),
            "spanMinimisationDeg": _round(measurement.yaw.span_minimisation_deg),
            "disagreementDeg": _round(measurement.yaw.disagreement_deg),
            "rectangularity": _round(measurement.yaw.rectangularity),
        },
        "measurement": {
            "state": measurement.state,
            "longAxisM": _separation_json(measurement.long_axis_m),
            "shortAxisM": _separation_json(measurement.short_axis_m),
            "heightM": _separation_json(measurement.height_m),
            "axisSeparations": {
                key: _separation_json(value)
                for key, value in measurement.axis_separations.items()
            },
        },
        "inputQuality": {
            "pointCount": int(measurement.input_point_count),
            "usableNormalCount": int(measurement.usable_normal_count),
            "unusableNormalCount": int(
                measurement.input_point_count - measurement.usable_normal_count
            ),
            "usableNormalFraction": _round(
                measurement.usable_normal_count / measurement.input_point_count
            ),
        },
        "interiority": {
            "satisfied": bool(measurement.interiority.satisfied),
            "originCount": int(measurement.interiority.origin_count),
            "violatingOriginCount": int(
                measurement.interiority.violating_origin_count
            ),
            "minimumClearanceM": _round(measurement.interiority.minimum_clearance_m),
        },
        "candidates": [
            _candidate_json(candidate) for candidate in measurement.candidates
        ],
        "acceptedWalls": [candidate.name for candidate in measurement.accepted_walls],
        "refusals": list(measurement.refusals),
        "reviewSeam": {
            "targetSchemaVersion": REVIEW_SEAM_SCHEMA_VERSION,
            "selfApproved": False,
            "role": "proposer_only",
            "compatibility": "proposal_overlay_only_not_a_review_artifact",
            "directImportCompatible": False,
            "coordinateFrame": "room_local_xy_metres",
            "requiredAdapter": "room_shape_proposal_human_review_adapter_not_implemented",
            "proposedFootprintPolygonM": polygon,
        },
        "limitations": list(ALL_LIMITATIONS),
    }
    payload = _round_all(payload)
    payload["proposalSha256"] = proposal_digest(payload)
    return payload
