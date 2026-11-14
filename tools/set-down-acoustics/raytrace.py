#!/usr/bin/env python3
"""Offline ray tracer for the set-down engine's rooms (T-700, Task 7).

It is the independent check on the planner's room model: Eyring with air,
times a per-band calibration (packages/web/src/lib/set-down/room-acoustics.ts).
It traces each Trades Hall room as a box with the model's volume and surface
areas (the Grand Hall with a spherical cap of the scanned dome's volume),
empty, half dressed and fully dressed, and fits T20 to each band's Schroeder
curve. So it checks Eyring's diffuse-field assumption on those boxes, with the
model's own absorption: not the absorption data, and not the rooms' real
outlines. It proves itself on textbook cases first (--selftest), on every run.

    python raytrace.py --selftest [rooms.json]
    python raytrace.py rooms.json results.json [--pause-while FILE]

numpy only. Run it with `python`, not `python -I`: numpy lives in the user
site-packages. results.json records the sha256 of the rooms.json it traced and
of this file (ruling R50), so editing either means a retrace. See README.md for
the model, its simplifications and the figures of the last run.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
import time
from dataclasses import dataclass, field

# numpy's OpenBLAS reserves buffers for every core's thread at import, about
# 0.5 GB of commit on a 16-thread PC; the tracer never uses BLAS threads.
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")

import numpy as np  # noqa: E402

C = 343.0  # speed of sound, m/s
BIN_S = 0.001  # histogram bin, s
T_MAX_S = 6.0  # a ray is followed for at most this long
STOP_ENERGY = 1e-7  # -70 dB of a ray's starting energy
SELFTEST_RAYS = 20000
# Rays per band for each room (ruling R31). The galleries' late decay rests on a
# few near-horizontal rays that miss the carpet for a long time, so their T20
# needs ten times the rays of the other rooms to agree between seeds within 3 %.
ROOM_RAYS = 200000
ROOM_RAYS_BY_SLUG = {"north-gallery": 2000000, "south-gallery": 2000000}
BATCH = 50000  # rays traced together; one batch holds a few MB
PAUSE_FILE: str | None = None  # while this file exists, tracing waits between batches (--pause-while)
RECEIVER_RADIUS_M = 0.6
EAR_HEIGHT_M = 1.2
SCATTER = 0.2  # every surface
SCATTER_DRESSED_FLOOR = 0.7  # a floor laid with tables and chairs (EST, seating-zone practice)
MAX_ALPHA = 0.99
SEEDS = (1, 2)
SEED_TOLERANCE = 0.03
MODEL_TOLERANCE = 0.15
CALIBRATION_MIN, CALIBRATION_MAX = 0.7, 1.3
MIN_FIT_R2 = 0.95
DOME_AREA_TOLERANCE = 0.03
BANDS_HZ = (125, 250, 500, 1000, 2000, 4000, 8000)
CHECKED = range(1, 7)  # 250 Hz to 8 kHz (ruling R40)
DRESSINGS = ("empty", "half", "dressed")
# Ruling R39: geometrical acoustics has no standing below a room's Schroeder
# frequency, 2000 sqrt(T / V), so the 125 Hz factor is 1 where that frequency
# (from the empty trace's 125 Hz T) is above the octave's lower edge.
SCHROEDER_K = 2000.0
LOW_OCTAVE_EDGE_HZ = 125.0 / math.sqrt(2.0)  # 88.4 Hz
# Kuttruff's correction to Eyring for the spread of free paths (self-test check 1).
KUTTRUFF_TOLERANCE = 0.02
LEAK_TOLERANCE_M = 1e-7

# Prism parts. The walls are one part: their materials are mixed by area.
FLOOR, CEILING, WALLS, DOME = 0, 1, 2, 3
PARTS = ("floor", "ceiling", "walls", "dome")
# What ends a ray's current segment.
EV_FLOOR, EV_CEILING, EV_WALL, EV_DOME, EV_ENTER_CAP, EV_LEAVE_CAP = range(6)


# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Cap:
    """A spherical cap over a circular opening in the ceiling plane."""

    base_radius: float  # a, the opening's radius
    height: float  # h, crown above the ceiling plane
    sphere_radius: float
    centre: np.ndarray  # the sphere's centre (x, y, z)

    @property
    def volume(self) -> float:
        a, h = self.base_radius, self.height
        return math.pi * h / 6.0 * (3.0 * a * a + h * h)

    @property
    def area(self) -> float:
        return math.pi * (self.base_radius**2 + self.height**2)


def cap_over(opening_m2: float, volume_m3: float, centre_x: float, ceiling_y: float, centre_z: float) -> Cap:
    """The cap whose base is the opening and whose volume is the dome's."""
    a = math.sqrt(opening_m2 / math.pi)
    lo, hi = 0.0, 4.0 * a
    for _ in range(200):  # (pi h / 6)(3 a^2 + h^2) rises with h: bisect
        mid = 0.5 * (lo + hi)
        if math.pi * mid / 6.0 * (3.0 * a * a + mid * mid) < volume_m3:
            lo = mid
        else:
            hi = mid
    h = 0.5 * (lo + hi)
    radius = (a * a + h * h) / (2.0 * h)
    centre = np.array([centre_x, ceiling_y + h - radius, centre_z])
    return Cap(a, h, radius, centre)


@dataclass(frozen=True)
class Geometry:
    """A box 0..W x 0..H x 0..L (x across the width, y up, z along the length), optionally with a cap."""

    width: float
    height: float
    length: float
    cap: Cap | None = None
    ear_height: float = EAR_HEIGHT_M  # the source's and the receiver's height

    @property
    def size(self) -> np.ndarray:
        return np.array([self.width, self.height, self.length])

    @property
    def volume(self) -> float:
        return self.width * self.height * self.length + (self.cap.volume if self.cap else 0.0)

    @property
    def source(self) -> np.ndarray:
        return np.array([0.3 * self.width, self.ear_height, 0.25 * self.length])

    @property
    def receiver(self) -> np.ndarray:
        return np.array([0.5 * self.width, self.ear_height, 0.5 * self.length])

    def part_areas(self) -> np.ndarray:
        floor = self.width * self.length
        opening = math.pi * self.cap.base_radius**2 if self.cap else 0.0
        walls = 2.0 * (self.width + self.length) * self.height
        dome = self.cap.area if self.cap else 0.0
        return np.array([floor, floor - opening, walls, dome])


# ---------------------------------------------------------------------------
# Tracing
# ---------------------------------------------------------------------------


@dataclass
class TraceStats:
    path_m: float = 0.0
    cap_path_m: float = 0.0
    steps: int = 0
    hits: int = 0
    seconds: float = 0.0
    extra: dict = field(default_factory=dict)


def isotropic(n: int, rng: np.random.Generator) -> np.ndarray:
    cos_t = 2.0 * rng.random(n) - 1.0
    phi = 2.0 * math.pi * rng.random(n)
    sin_t = np.sqrt(np.maximum(0.0, 1.0 - cos_t * cos_t))
    return np.stack([sin_t * np.cos(phi), cos_t, sin_t * np.sin(phi)], axis=1)


def lambert(normals: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Cosine-weighted directions about each unit normal (Duff et al.'s branchless basis)."""
    n = normals.shape[0]
    u1 = rng.random(n)
    phi = 2.0 * math.pi * rng.random(n)
    r = np.sqrt(u1)
    lx, ly, lz = r * np.cos(phi), r * np.sin(phi), np.sqrt(np.maximum(0.0, 1.0 - u1))
    nx, ny, nz = normals[:, 0], normals[:, 1], normals[:, 2]
    sign = np.where(nz >= 0.0, 1.0, -1.0)
    a = -1.0 / (sign + nz)
    b = nx * ny * a
    t1 = np.stack([1.0 + sign * nx * nx * a, sign * b, -sign * nx], axis=1)
    t2 = np.stack([b, sign + ny * ny * a, -ny], axis=1)
    return lx[:, None] * t1 + ly[:, None] * t2 + lz[:, None] * normals


def trace(
    geo: Geometry,
    alpha: np.ndarray,
    scatter: np.ndarray,
    air: np.ndarray,
    rays: int,
    seed: int,
    t_max: float = T_MAX_S,
) -> tuple[np.ndarray, TraceStats]:
    """Energy arriving at the receiver per 1 ms bin, per band: (bands, bins).

    alpha is (4 parts, bands); scatter is (4,); air is m per band (1/m, energy).
    The scattering coefficients do not vary with frequency, so each ray carries
    one energy per band along a single path.
    """
    started = time.perf_counter()
    rng = np.random.default_rng(seed)
    bins = int(round(t_max / BIN_S))
    hist = np.zeros((alpha.shape[1], bins))
    stats = TraceStats()
    for first in range(0, rays, BATCH):
        _wait_while_paused()
        _trace_batch(geo, alpha, scatter, air, min(BATCH, rays - first), rng, hist, stats, t_max)
    stats.seconds = time.perf_counter() - started
    return hist, stats


def _wait_while_paused() -> None:
    """Holds the run while the pause file exists (a shared PC's quiet flag); the results do not change."""
    if PAUSE_FILE is None or not os.path.exists(PAUSE_FILE):
        return
    print(f"  paused while {PAUSE_FILE} exists", flush=True)
    while os.path.exists(PAUSE_FILE):
        time.sleep(15)
    print("  resumed", flush=True)


def _trace_batch(geo, alpha, scatter, air, n, rng, hist, stats, t_max):
    bands = alpha.shape[1]
    nbins = hist.shape[1]
    size = geo.size
    cap = geo.cap
    receiver = geo.receiver
    r2_receiver = RECEIVER_RADIUS_M**2
    receiver_volume = 4.0 / 3.0 * math.pi * RECEIVER_RADIUS_M**3
    max_path = C * t_max

    p = np.repeat(geo.source[None, :], n, axis=0)
    d = isotropic(n, rng)
    dist = np.zeros(n)
    energy = np.ones((n, bands))
    in_cap = np.zeros(n, dtype=bool)

    while p.shape[0] > 0:
        m = p.shape[0]
        rows = np.arange(m)
        stats.steps += 1

        # The next boundary of the box: the face each ray is heading for.
        with np.errstate(divide="ignore", invalid="ignore"):
            tb = np.where(d > 0.0, (size - p) / d, np.where(d < 0.0, -p / d, np.inf))
        axis = np.argmin(tb, axis=1)
        t = tb[rows, axis]
        event = np.where(axis == 1, np.where(d[:, 1] < 0.0, EV_FLOOR, EV_CEILING), EV_WALL)

        if cap is not None:
            ci = np.nonzero(in_cap)[0]
            if ci.size:
                oc = p[ci] - cap.centre
                b = np.einsum("ij,ij->i", d[ci], oc)
                c = np.einsum("ij,ij->i", oc, oc) - cap.sphere_radius**2
                t_sphere = -b + np.sqrt(np.maximum(b * b - c, 0.0))
                dy = d[ci, 1]
                with np.errstate(divide="ignore", invalid="ignore"):
                    t_plane = np.where(dy < 0.0, (geo.height - p[ci, 1]) / dy, np.inf)
                t[ci] = np.minimum(t_sphere, t_plane)
                event[ci] = np.where(t_sphere <= t_plane, EV_DOME, EV_LEAVE_CAP)
            # A box ray reaching the ceiling inside the opening goes on into the cap.
            up = np.nonzero(event == EV_CEILING)[0]
            if up.size:
                hx = p[up, 0] + t[up] * d[up, 0] - cap.centre[0]
                hz = p[up, 2] + t[up] * d[up, 2] - cap.centre[2]
                event[up[hx * hx + hz * hz < cap.base_radius**2]] = EV_ENTER_CAP
        t = np.maximum(t, 0.0)

        # The receiver: each pass leaves energy x chord / sphere volume at its arrival time.
        oc = p - receiver
        b = np.einsum("ij,ij->i", d, oc)
        c = np.einsum("ij,ij->i", oc, oc) - r2_receiver
        disc = b * b - c
        hi = np.nonzero(disc > 0.0)[0]
        if hi.size:
            root = np.sqrt(disc[hi])
            t_in = np.maximum(-b[hi] - root, 0.0)
            t_out = np.minimum(-b[hi] + root, t[hi])
            chord = t_out - t_in
            ok = chord > 0.0
            if ok.any():
                hi, t_in, chord = hi[ok], t_in[ok], chord[ok]
                arrival = dist[hi] + t_in
                k = np.floor(arrival / C / BIN_S).astype(np.int64)
                keep = k < nbins
                if keep.any():
                    hi, arrival, chord, k = hi[keep], arrival[keep], chord[keep], k[keep]
                    weight = energy[hi] * np.exp(-np.outer(arrival, air)) * (chord / receiver_volume)[:, None]
                    for band in range(bands):
                        hist[band] += np.bincount(k, weights=weight[:, band], minlength=nbins)
                    stats.hits += int(hi.size)

        stats.path_m += float(t.sum())
        if cap is not None:
            stats.cap_path_m += float(t[in_cap].sum())

        # Move, and put each ray exactly on the boundary it reached.
        p = p + t[:, None] * d
        dist = dist + t
        box = event != EV_DOME
        box &= event != EV_LEAVE_CAP
        bi = np.nonzero(box)[0]
        ax = axis[bi]
        p[bi, ax] = np.where(d[bi, ax] > 0.0, size[ax], 0.0)
        if cap is not None:
            di = np.nonzero(event == EV_DOME)[0]
            if di.size:
                rel = p[di] - cap.centre
                p[di] = cap.centre + rel * (cap.sphere_radius / np.linalg.norm(rel, axis=1))[:, None]
            p[event == EV_LEAVE_CAP, 1] = geo.height
            in_cap[event == EV_ENTER_CAP] = True
            in_cap[event == EV_LEAVE_CAP] = False

        # Reflect: lose (1 - alpha), then go Lambertian with probability s, else specular.
        ri = np.nonzero(event <= EV_DOME)[0]
        if ri.size:
            ev = event[ri]
            normals = np.zeros((ri.size, 3))
            part = np.full(ri.size, WALLS)
            wall = ev == EV_WALL
            wax = axis[ri][wall]
            normals[np.nonzero(wall)[0], wax] = -np.sign(d[ri[wall], wax])
            floor = ev == EV_FLOOR
            normals[floor, 1] = 1.0
            part[floor] = FLOOR
            ceiling = ev == EV_CEILING
            normals[ceiling, 1] = -1.0
            part[ceiling] = CEILING
            dome = ev == EV_DOME
            if dome.any():
                normals[dome] = (cap.centre - p[ri[dome]]) / cap.sphere_radius
                part[dome] = DOME
            energy[ri] *= 1.0 - alpha[part]
            dr = d[ri]
            new = dr - 2.0 * np.einsum("ij,ij->i", dr, normals)[:, None] * normals
            diffuse = rng.random(ri.size) < scatter[part]
            if diffuse.any():
                new[diffuse] = lambert(normals[diffuse], rng)
            d[ri] = new / np.linalg.norm(new, axis=1)[:, None]

        _check_inside(geo, p, in_cap)

        # A band stops at -70 dB (air included); a ray stops when all have, or at 6 s.
        level = energy * np.exp(-np.outer(dist, air))
        energy[level < STOP_ENERGY] = 0.0
        alive = (dist < max_path) & (energy.max(axis=1) > 0.0)
        if not alive.all():
            p, d, dist, energy, in_cap = p[alive], d[alive], dist[alive], energy[alive], in_cap[alive]


def _check_inside(geo: Geometry, p: np.ndarray, in_cap: np.ndarray) -> None:
    """Every ray must still be inside the room; a leak is a geometry bug."""
    box = p[~in_cap]
    tol = LEAK_TOLERANCE_M
    if box.size and ((box < -tol).any() or (box > geo.size + tol).any()):
        raise RuntimeError("a ray left the box")
    if geo.cap is not None and in_cap.any():
        inside = p[in_cap]
        dist = np.linalg.norm(inside - geo.cap.centre, axis=1)
        if (inside[:, 1] < geo.height - tol).any() or (dist > geo.cap.sphere_radius + tol).any():
            raise RuntimeError("a ray left the dome")


# ---------------------------------------------------------------------------
# Decay analysis
# ---------------------------------------------------------------------------


def schroeder_db(hist: np.ndarray) -> np.ndarray:
    tail = np.cumsum(hist[::-1])[::-1]
    with np.errstate(divide="ignore"):
        return 10.0 * np.log10(tail / tail[0])


def t20(hist: np.ndarray) -> tuple[float, float]:
    """T20 from the Schroeder curve's -5 to -25 dB by least squares, and the fit's r2."""
    if not hist.sum() > 0.0:
        return float("nan"), 0.0
    level = schroeder_db(hist)
    times = np.arange(hist.size) * BIN_S
    sel = (level <= -5.0) & (level >= -25.0)
    if sel.sum() < 10:
        return float("nan"), 0.0
    x, y = times[sel], level[sel]
    slope, intercept = np.polyfit(x, y, 1)
    residual = y - (slope * x + intercept)
    r2 = 1.0 - float((residual**2).sum()) / float(((y - y.mean()) ** 2).sum())
    return -60.0 / slope, r2


# ---------------------------------------------------------------------------
# Self-test: the tracer against textbook answers
# ---------------------------------------------------------------------------


def eyring(volume: float, area: float, alpha: float) -> float:
    return 0.161 * volume / (-area * math.log(1.0 - alpha))


def window_energies(hist: np.ndarray, start_s: float = 0.05, width_s: float = 0.1) -> np.ndarray:
    first = int(round(start_s / BIN_S))
    step = int(round(width_s / BIN_S))
    count = (hist.size - first) // step
    return hist[first : first + count * step].reshape(count, step).sum(axis=1)


def lambertian_cube_path_variance(chords: int = 1000000, seed: int = 7) -> tuple[float, float]:
    """The mean free path (in edge lengths) and its relative variance gamma^2 in a unit cube with Lambertian walls.

    Sampled directly and independently of the tracer: chords from uniform
    points on the six faces, leaving cosine-weighted about the inward normal,
    to the first face they reach. The mean must come out at 4V/S = 2/3.
    """
    rng = np.random.default_rng(seed)
    rows = np.arange(chords)
    face = rng.integers(0, 6, chords)
    axis, side = face // 2, face % 2
    others = np.array([[1, 2], [0, 2], [0, 1]])[axis]
    start = np.zeros((chords, 3))
    start[rows, others[:, 0]] = rng.random(chords)
    start[rows, others[:, 1]] = rng.random(chords)
    start[rows, axis] = side
    u = rng.random(chords)
    phi = 2.0 * math.pi * rng.random(chords)
    direction = np.zeros((chords, 3))
    direction[rows, axis] = np.where(side == 0, 1.0, -1.0) * np.sqrt(1.0 - u)
    direction[rows, others[:, 0]] = np.sqrt(u) * np.cos(phi)
    direction[rows, others[:, 1]] = np.sqrt(u) * np.sin(phi)
    with np.errstate(divide="ignore", invalid="ignore"):
        reach = np.where(direction > 0.0, (1.0 - start) / direction, np.where(direction < 0.0, -start / direction, np.inf))
    reach[rows, axis] = 1.0 / np.abs(direction[rows, axis])  # the starting face's own axis: the opposite face
    path = reach.min(axis=1)
    return float(path.mean()), float(path.var() / path.mean() ** 2)


def kuttruff(volume: float, area: float, alpha: float, gamma2: float) -> float:
    """Eyring corrected for the spread of free paths: 0.161 V / (-S ln(1 - a) (1 + gamma^2 ln(1 - a) / 2))."""
    log = math.log(1.0 - alpha)
    return 0.161 * volume / (-area * log * (1.0 + gamma2 * log / 2.0))


def selftest(m8k: float) -> bool:
    """The tracer against textbook answers. m8k is the exported 8 kHz air attenuation (1/m)."""
    print("Self-test (each check must pass before any room is traced)")
    passed = True

    def report(ok: bool, text: str) -> None:
        nonlocal passed
        passed &= ok
        print(f"  {'PASS' if ok else 'FAIL'} {text}", flush=True)

    cube = Geometry(10.0, 10.0, 10.0)
    no_air = np.zeros(1)
    mean_path, gamma2 = lambertian_cube_path_variance()

    # 1. A uniform, fully diffuse cube against Eyring, and against Eyring
    #    corrected for the cube's spread of free paths (Kuttruff).
    hist, stats = trace(cube, np.full((4, 1), 0.2), np.ones(4), no_air, SELFTEST_RAYS, 1)
    t, r2 = t20(hist[0])
    expected = eyring(cube.volume, 600.0, 0.2)
    corrected = kuttruff(cube.volume, 600.0, 0.2, gamma2)
    error = t / expected - 1.0
    error_k = t / corrected - 1.0
    report(
        abs(error) <= 0.05 and r2 >= 0.99 and abs(error_k) <= KUTTRUFF_TOLERANCE,
        f"1. uniform diffuse cube (10 m, alpha 0.2, s 1, no air, {SELFTEST_RAYS} rays): "
        f"T20 {t:.4f} s against Eyring {expected:.4f} s ({100 * error:+.2f} %, limit 5 %), r2 {r2:.5f} (limit 0.99); "
        f"against Kuttruff's corrected Eyring {corrected:.4f} s ({100 * error_k:+.2f} %, limit 2 %), with the cube's "
        f"gamma^2 {gamma2:.4f} from 1,000,000 Lambertian chords (their mean {mean_path:.4f} of an edge, 4V/S 0.6667) "
        f"[{stats.seconds:.1f} s]",
    )

    # 2. Air only: the decay is exp(-m c t), so T = ln(1e6) / (c m).
    hist, stats = trace(cube, np.zeros((4, 1)), np.full(4, SCATTER), np.array([m8k]), SELFTEST_RAYS, 1)
    t, r2 = t20(hist[0])
    expected = 13.82 / (C * m8k)
    error = t / expected - 1.0
    report(
        abs(error) <= 0.03,
        f"2. air only (10 m cube, alpha 0, s {SCATTER}, m {m8k} 1/m, rooms.json's 8 kHz, {SELFTEST_RAYS} rays): "
        f"T20 {t:.4f} s against 13.82/(c m) {expected:.4f} s ({100 * error:+.2f} %, limit 3 %), r2 {r2:.5f} "
        f"[{stats.seconds:.1f} s]",
    )

    # 3. No loss at all: the energy density stays N / V for ever.
    lossless_rays = 400000
    hist, stats = trace(cube, np.zeros((4, 1)), np.full(4, SCATTER), no_air, lossless_rays, 1)
    windows = window_energies(hist[0])
    spread = float(np.abs(windows / windows.mean() - 1.0).max())
    theory = lossless_rays * C * 0.1 / cube.volume
    level = float(windows.mean() / theory - 1.0)
    report(
        spread <= 0.05 and abs(level) <= 0.02,
        f"3. no loss (10 m cube, alpha 0, no air, s {SCATTER}, {lossless_rays} rays): {windows.size} windows of 100 ms "
        f"from 50 ms to 6 s within {100 * spread:.2f} % of their mean (limit 5 %); mean {100 * level:+.2f} % "
        f"from N c dt / V (limit 2 %) [{stats.seconds:.1f} s]",
    )

    # 4. The Grand Hall's box and dome, lossless: no ray leaves (every step is checked),
    #    the density is N / V of the whole volume, and the share of path in the
    #    dome is the dome's share of the volume.
    hall = Geometry(10.59, 6.7, 21.135, cap_over(math.pi * 3.32**2, 50.1, 10.59 / 2, 6.7, 21.135 / 2))
    hist, stats = trace(hall, np.zeros((4, 1)), np.full(4, SCATTER), no_air, lossless_rays, 1)
    windows = window_energies(hist[0])
    spread = float(np.abs(windows / windows.mean() - 1.0).max())
    theory = lossless_rays * C * 0.1 / hall.volume
    level = float(windows.mean() / theory - 1.0)
    share = stats.cap_path_m / stats.path_m
    expected_share = hall.cap.volume / hall.volume
    share_error = share / expected_share - 1.0
    report(
        spread <= 0.05 and abs(level) <= 0.02 and abs(share_error) <= 0.02,
        f"4. the hall's box and dome, no loss ({lossless_rays} rays): windows within {100 * spread:.2f} % "
        f"(limit 5 %); mean {100 * level:+.2f} % from N c dt / V (limit 2 %); path in the dome "
        f"{100 * share:.3f} % against its {100 * expected_share:.3f} % of the volume ({100 * share_error:+.2f} %, "
        f"limit 2 %); no ray left the room [{stats.seconds:.1f} s]",
    )

    # 5. Checks 1 and 2 again in one two-band trace, as the rooms run: one ray
    #    path carrying both bands' energies, each band with its own losses.
    alpha2 = np.zeros((4, 2))
    alpha2[:, 0] = 0.2
    hist, stats = trace(cube, alpha2, np.ones(4), np.array([0.0, m8k]), SELFTEST_RAYS, 1)
    (t_a, r2_a), (t_b, _) = t20(hist[0]), t20(hist[1])
    error_a = t_a / eyring(cube.volume, 600.0, 0.2) - 1.0
    error_ak = t_a / corrected - 1.0
    error_b = t_b / (13.82 / (C * m8k)) - 1.0
    report(
        abs(error_a) <= 0.05 and abs(error_ak) <= KUTTRUFF_TOLERANCE and r2_a >= 0.99 and abs(error_b) <= 0.03,
        f"5. checks 1 and 2 in one two-band trace (s 1, {SELFTEST_RAYS} rays): band A T20 {t_a:.4f} s "
        f"({100 * error_a:+.2f} % from Eyring, {100 * error_ak:+.2f} % from Kuttruff, r2 {r2_a:.5f}); band B T20 "
        f"{t_b:.4f} s ({100 * error_b:+.2f} % from 13.82/(c m)) [{stats.seconds:.1f} s]",
    )

    # 6. Symmetry: absorption on the floor only, then on the ceiling only, with
    #    the source and receiver at mid-height, are mirror images and must decay alike.
    mirror = Geometry(10.0, 10.0, 10.0, ear_height=5.0)
    symmetry_rays = 400000
    fits = []
    for part, seed in ((FLOOR, 1), (CEILING, 2)):
        alpha1 = np.zeros((4, 1))
        alpha1[part] = 0.5
        hist, stats = trace(mirror, alpha1, np.full(4, SCATTER), no_air, symmetry_rays, seed)
        fits.append((t20(hist[0])[0], float(hist[0].sum()), stats.seconds))
    (t_floor, e_floor, s_floor), (t_ceiling, e_ceiling, s_ceiling) = fits
    t_gap = abs(t_ceiling / t_floor - 1.0)
    e_gap = abs(e_ceiling / e_floor - 1.0)
    report(
        t_gap <= 0.03 and e_gap <= 0.04,
        f"6. symmetry (10 m cube, source and receiver at 5 m, alpha 0.5 on one face, s {SCATTER}, {symmetry_rays} rays): "
        f"floor-only T20 {t_floor:.4f} s, ceiling-only {t_ceiling:.4f} s ({100 * t_gap:.2f} % apart, limit 3 %); "
        f"received energy {100 * e_gap:.2f} % apart (limit 4 %) [{s_floor + s_ceiling:.1f} s]",
    )
    return passed


# ---------------------------------------------------------------------------
# The rooms
# ---------------------------------------------------------------------------


def room_geometry(room: dict) -> Geometry:
    prism = room["prism"]
    width, length, height = prism["widthM"], prism["lengthM"], prism["heightM"]
    cap = None
    if room["dome"] is not None:
        cap = cap_over(room["dome"]["openingM2"], room["dome"]["volumeM3"], width / 2, height, length / 2)
    return Geometry(width, height, length, cap)


def part_absorption(room: dict) -> np.ndarray:
    """The model's absorption, m2 per band, gathered onto the prism's parts."""
    absorption = np.zeros((4, len(BANDS_HZ)))
    for surface in room["surfaces"]:
        absorption[PARTS.index(surface["part"])] += surface["areaM2"] * np.array(surface["alpha"])
    return absorption


def part_alphas(geo: Geometry, room: dict, dressing: str) -> np.ndarray:
    """Each part's alpha: its absorption over its area, the contents added to the floor, capped at 0.99.

    The walls' materials become one mixture: their total absorption over the
    prism's wall area. Curtains hang in front of the walls and the model counts
    them on top of the wall area, so dividing by the prism's walls keeps the
    model's absorption exactly.
    """
    absorption = part_absorption(room)
    if dressing != "empty":
        absorption[FLOOR] += np.array(room["contents"][dressing])
    areas = geo.part_areas()
    alpha = np.zeros_like(absorption)
    for part in range(4):
        if areas[part] > 0.0:
            alpha[part] = np.minimum(MAX_ALPHA, absorption[part] / areas[part])
    return alpha


def scatter_for(dressing: str) -> np.ndarray:
    scatter = np.full(4, SCATTER)
    if dressing != "empty":
        scatter[FLOOR] = SCATTER_DRESSED_FLOOR
    return scatter


def trace_room(
    geo: Geometry, room: dict, dressing: str, air: np.ndarray, seed: int, rays: int
) -> tuple[list, list, TraceStats]:
    """Each band's T20 (rounded to 0.1 ms) and r2 (to 5 places), as results.json keeps them."""
    hist, stats = trace(geo, part_alphas(geo, room, dressing), scatter_for(dressing), air, rays, seed)
    fits = [t20(hist[band]) for band in range(len(BANDS_HZ))]
    return [round(f[0], 4) for f in fits], [round(f[1], 5) for f in fits], stats


def round_half_up(value: float, places: int) -> float:
    scale = 10**places
    return math.floor(value * scale + 0.5) / scale


def schroeder_frequency(t125: float, volume_m3: float) -> float:
    """2000 sqrt(T / V), Hz: below it a room's response is modal, beyond geometrical acoustics."""
    return SCHROEDER_K * math.sqrt(t125 / volume_m3)


def calibration_factor(traced: float, model: float, r2: float, band: int, empty_t125: float, volume_m3: float) -> float:
    """tracer / Eyring, clamped to 0.7-1.3 and rounded half up to 3 places (as Math.round does).

    It is 1 where the fit's r2 is under 0.95, and at 125 Hz where the room's
    Schroeder frequency (from its empty 125 Hz T) is above the octave's lower
    edge (ruling R39). The same rule is fittedCalibration's in
    packages/web/src/lib/set-down/__tests__/tracer-results.ts.
    """
    if not r2 >= MIN_FIT_R2:
        return 1.0
    if band == 0 and schroeder_frequency(empty_t125, volume_m3) > LOW_OCTAVE_EDGE_HZ:
        return 1.0
    return round_half_up(min(CALIBRATION_MAX, max(CALIBRATION_MIN, traced / model)), 3)


def seed_spread(first: list, second: list) -> float:
    return max(abs(second[b] - first[b]) / first[b] for b in CHECKED)


def fmt(values) -> str:
    return " ".join(f"{v:7.3f}" for v in values)


def trace_one_room(slug: str, room: dict, air: np.ndarray, rays: int) -> tuple[dict, bool]:
    """Traces one room (seed 1 empty, half, dressed; seed 2 empty, dressed) and prints its checks."""
    ok = True
    geo = room_geometry(room)
    areas = geo.part_areas()
    print(f"\n{slug}: {rays} rays a trace; prism {geo.length:.3f} x {geo.width:.3f} x {geo.height:.3f} m "
          f"({room['prism']['rule']}), V {geo.volume:.2f} m3 against the model's {room['volumeM3']:.2f}", flush=True)
    model_areas = np.zeros(4)
    for surface in room["surfaces"]:
        model_areas[PARTS.index(surface["part"])] += surface["areaM2"]
    print("  areas, prism / model: " + ", ".join(
        f"{PARTS[i]} {areas[i]:.2f}/{model_areas[i]:.2f}" for i in range(4) if model_areas[i] > 0))
    if geo.cap is not None:
        dome = room["dome"]
        area_error = geo.cap.area / dome["surfaceM2"] - 1.0
        dome_ok = abs(area_error) <= DOME_AREA_TOLERANCE
        ok &= dome_ok
        print(f"  dome: cap a {geo.cap.base_radius:.4f} m, h {geo.cap.height:.4f} m, sphere r {geo.cap.sphere_radius:.4f} m; "
              f"volume {geo.cap.volume:.3f} m3 (scan {dome['volumeM3']:.3f}); area {geo.cap.area:.3f} m2 against the "
              f"scanned {dome['surfaceM2']:.3f} m2 ({100 * area_error:+.2f} %, limit 3 %) {'PASS' if dome_ok else 'FAIL'}")
    for dressing in DRESSINGS:
        alpha = part_alphas(geo, room, dressing)
        print(f"  {dressing:7s} alpha  floor {fmt(alpha[FLOOR])} | walls {fmt(alpha[WALLS])} | ceiling {fmt(alpha[CEILING])}")

    traced: dict = {}
    r2: dict = {}
    for seed in SEEDS:
        for dressing in DRESSINGS if seed == SEEDS[0] else ("empty", "dressed"):
            times, fits, stats = trace_room(geo, room, dressing, air, seed, rays)
            traced[(seed, dressing)], r2[(seed, dressing)] = times, fits
            print(f"  seed {seed} {dressing:7s} T20 {fmt(times)}  r2 min {min(fits):.4f}  "
                  f"[{stats.steps} steps, {stats.hits} hits, {stats.seconds:.1f} s]", flush=True)

    for dressing in ("empty", "dressed"):
        spread = seed_spread(traced[(1, dressing)], traced[(2, dressing)])
        agree = spread <= SEED_TOLERANCE
        print(f"  seeds 1 and 2, {dressing}: largest spread 250 Hz-8 kHz {100 * spread:.2f} % (limit 3 %) "
              f"{'PASS' if agree else 'FAIL'}", flush=True)
        if not agree:
            # The silent-corruption rule: rerun both seeds once and compare the rerun with the first run.
            # The seeds are fixed, so a sound computation repeats itself to the bit: any difference is
            # corruption, and an identical rerun means the disagreement is the trace's own spread. Either
            # way the disagreement stands; nothing is averaged away.
            for seed in SEEDS:
                times, fits, _ = trace_room(geo, room, dressing, air, seed, rays)
                if (times, fits) != (traced[(seed, dressing)], r2[(seed, dressing)]):
                    print(f"  FAIL seed {seed} {dressing}: the rerun differs from the first run (silent corruption): "
                          f"{fmt(times)} against {fmt(traced[(seed, dressing)])}")
                else:
                    print(f"  seed {seed} {dressing}: the rerun repeats the first run to the bit; "
                          f"the disagreement is the trace's spread")
        ok &= agree

    eyring_times = room["eyringUncalibrated"]
    t125, volume = traced[(1, "empty")][0], room["volumeM3"]
    calibration = [calibration_factor(traced[(1, "empty")][b], eyring_times["empty"][b], r2[(1, "empty")][b],
                                      b, t125, volume) for b in range(len(BANDS_HZ))]
    print(f"  Schroeder frequency {schroeder_frequency(t125, volume):.1f} Hz (125 Hz factor 1 above "
          f"{LOW_OCTAVE_EDGE_HZ:.1f} Hz)")
    print(f"  calibration (tracer empty / Eyring empty) {fmt(calibration)}")
    for dressing in DRESSINGS:
        ratio = [traced[(1, dressing)][b] / eyring_times[dressing][b] for b in range(len(BANDS_HZ))]
        model = [eyring_times[dressing][b] * calibration[b] for b in range(len(BANDS_HZ))]
        errors = [model[b] / traced[(1, dressing)][b] - 1.0 for b in range(len(BANDS_HZ))]
        worst = max(abs(errors[b]) for b in CHECKED)
        beyond = [BANDS_HZ[b] for b in CHECKED if ratio[b] > CALIBRATION_MAX]
        print(f"  {dressing:7s} Eyring {fmt(eyring_times[dressing])} | model {fmt(model)} | tracer/Eyring {fmt(ratio)}")
        print(f"          model/tracer-1 {' '.join(f'{100 * e:+6.1f}%' for e in errors)}  worst 250-8k {100 * worst:.1f} %"
              f"{'' if worst <= MODEL_TOLERANCE else '  OVER 15 %'}"
              f"{f'; tracer/Eyring over 1.3 at {beyond} Hz' if beyond else ''}")
    dressed_factor = [
        calibration_factor(traced[(1, "dressed")][b], eyring_times["dressed"][b] * calibration[b],
                           r2[(1, "dressed")][b], b, t125, volume) for b in range(len(BANDS_HZ))]
    print(f"  a second, dressed factor (tracer dressed / calibrated Eyring dressed) would be {fmt(dressed_factor)}")

    values = [v for key in traced for v in traced[key]] + [v for key in r2 for v in r2[key]]
    if not all(math.isfinite(v) for v in values):
        print("  FAIL a band has no T20 fit")
        ok = False

    result = {
        "empty": traced[(1, "empty")],
        "half": traced[(1, "half")],
        "dressed": traced[(1, "dressed")],
        "r2": {dressing: r2[(1, dressing)] for dressing in DRESSINGS},
        "rays": rays,
        "seed": SEEDS[0],
        "seed2": {dressing: traced[(2, dressing)] for dressing in ("empty", "dressed")},
    }
    return result, ok


def lf_sha256(content: bytes) -> str:
    """sha256 with CRLF line ends read as LF, so a Windows checkout hashes as the committed (LF) file does."""
    return hashlib.sha256(content.replace(b"\r\n", b"\n")).hexdigest()


def tracer_sha256() -> str:
    """This file's own lf_sha256: the code that wrote a results.json (ruling R50)."""
    with open(os.path.abspath(__file__), "rb") as handle:
        return lf_sha256(handle.read())


def trace_metadata(rooms_content: bytes, raytrace_sha256: str) -> dict:
    """What results.json records of the run that wrote it (rulings R38 and R50)."""
    return {
        "roomsSha256": lf_sha256(rooms_content),
        "raytraceSha256": raytrace_sha256,
        "batch": BATCH,
        "numpy": np.__version__,
    }


def read_rooms(rooms_path: str) -> tuple[bytes, dict]:
    with open(rooms_path, "rb") as handle:
        content = handle.read()
    return content, json.loads(content.decode("utf-8"))


def write_results(results_path: str, results: dict) -> None:
    with open(results_path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(results, handle, indent=2)
        handle.write("\n")


def run_rooms(rooms_path: str, results_path: str) -> bool:
    # Both hashes are taken before tracing, so they name the files the run actually read and ran.
    raytrace_sha256 = tracer_sha256()
    rooms_content, exported = read_rooms(rooms_path)
    print(f"rooms.json sha256 {lf_sha256(rooms_content)}; raytrace.py sha256 {raytrace_sha256} (LF)")
    air = np.array(exported["airAttenuationPerM"])
    if list(exported["bandsHz"]) != list(BANDS_HZ):
        raise ValueError("rooms.json bands differ from the tracer's")
    ok = True
    results: dict = {}
    traced_rooms: dict[str, str] = {}  # a room's export, as JSON, to the slug that was traced for it
    print(f"\nRooms (seeds {SEEDS[0]} and {SEEDS[1]}, bands {' '.join(map(str, BANDS_HZ))} Hz)")
    for slug, room in exported["rooms"].items():
        key = json.dumps(room, sort_keys=True)
        twin = traced_rooms.get(key)
        if twin is not None:
            # The same room exported twice (the North and South Galleries): its trace is its twin's.
            results[slug] = {**results[twin], "sameRoomAs": twin}
            print(f"\n{slug}: the same room as {twin} in every exported figure; its result is {twin}'s")
            continue
        result, room_ok = trace_one_room(slug, room, air, ROOM_RAYS_BY_SLUG.get(slug, ROOM_RAYS))
        results[slug] = result
        traced_rooms[key] = slug
        ok &= room_ok

    if ok:
        write_results(results_path, {"trace": trace_metadata(rooms_content, raytrace_sha256), **results})
        print(f"\nwrote {results_path}")
    else:
        print("\na check failed: results.json not written")
    return ok


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--selftest", action="store_true", help="run the self-test only")
    parser.add_argument("rooms", nargs="?", help="rooms.json from the exporter")
    parser.add_argument("results", nargs="?", help="results.json to write")
    parser.add_argument("--pause-while", metavar="FILE", help="wait between batches while FILE exists")
    args = parser.parse_args()
    if not args.selftest and (args.rooms is None or args.results is None):
        parser.error("give rooms.json and results.json, or --selftest")
    global PAUSE_FILE
    PAUSE_FILE = args.pause_while
    # The self-test's air-only check uses the exported 8 kHz attenuation.
    rooms_path = args.rooms or os.path.join(os.path.dirname(os.path.abspath(__file__)), "rooms.json")
    _, exported = read_rooms(rooms_path)
    if list(exported["bandsHz"]) != list(BANDS_HZ):
        raise ValueError("rooms.json bands differ from the tracer's")
    started = time.perf_counter()
    if not selftest(float(exported["airAttenuationPerM"][BANDS_HZ.index(8000)])):
        print("self-test FAILED")
        return 1
    if args.selftest:
        print(f"self-test passed [{time.perf_counter() - started:.1f} s]")
        return 0
    ok = run_rooms(args.rooms, args.results)
    print(f"[{time.perf_counter() - started:.1f} s in all]")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
