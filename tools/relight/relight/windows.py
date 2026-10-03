"""Window volumes: the runtime twin of the proof's sun march (lt.trace_to_windows, lt.march, lt.sun_direct).

Each window keeps the part of the embrasure occupancy (3 cm cells, alpha as round(alpha * 255)) that a sun ray
through it can sample. A ray from point P toward the sun s (s_y < -0.001) belongs to the first window, in order,
that it enters: a point in the room (P_y > y0) enters where the ray crosses the wall's inner face y = y0 inside
the outline shrunk by 5 cm; a point already in the embrasure (P_y <= y0) with x0 - 0.25 < P_x < x1 + 0.25 starts
at P, skipping its first 4.5 cm. The ray is marched in 1.5 cm steps to 7 cm beyond the glass (nearest cell, each
sample adding the cell's -log(1 - alpha) x step / cell), is dark if that is longer than 2.2 m, and counts only if
it crosses the glass plane inside the outline shrunk by 3 cm. It is lit while the sun is above the window's
opposite-facade horizon (interpolated at the sun's azimuth), times the glass transmission at |s_y|.

Every derived constant (the grown outline edges, the arch's xc, zs and r^2, x0 - 0.25, x1 + 0.25, y0 - depth,
y0 - depth - 0.07 and 0.015 / res) is formed in float64 from the frame and rounded once to float32 where it meets
the float32 points; the march itself is float32 in the proof's order of operations, so the twin reproduces the
proof's cells exactly. Intended differences: the stored alpha's 8-bit quantisation; the glass transmission read
from its 101-entry table, interpolated linearly (within about 1e-4 of the proof's glass_t); and the horizon read
from its 360-entry table, interpolated linearly, which matches lt.horizon_deg except on [179, 180) degrees (up to
0.0042 degrees there).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

F32 = np.float32
STEP = 0.015             # march step along the ray (m)
CAP = 2.2                # a ray longer than this through the embrasure is dark (m)
BEYOND_GLASS = 0.07      # the march ends this far beyond the glass plane (m)
TAU_STOP = 6.0           # the march stops once the optical depth reaches this
ENTRY_GROW = -0.05       # a room ray enters inside the outline shrunk by 5 cm at the wall's inner face
EXIT_GROW = -0.03        # every ray leaves inside the outline shrunk by 3 cm at the glass
EMBRASURE_REACH = 0.25   # a point in the embrasure belongs to a window when x0 - 0.25 < x < x1 + 0.25 ...
EMBRASURE_SKIP = 0.045   # ... and skips its own first 4.5 cm
MIN_DOWN = 1e-3          # the sun must face the window wall: s_y < -0.001
ALPHA_MAX = 0.995        # the proof clamps alpha here before taking -log(1 - alpha)
CHUNK = 500_000

# {name}_frame in windows.npz, float64
FRAME_FIELDS = ("origin_x", "origin_y", "origin_z", "res", "nx", "ny", "nz", "x0", "x1", "depth", "sill", "top",
                "arch", "y0", "x_bearing", "offset_x", "offset_y", "offset_z", "grid_lo_x", "grid_lo_y", "grid_lo_z")


@dataclass(frozen=True, eq=False)
class WindowVolume:
    name: str
    origin: np.ndarray    # (3,) model-frame corner of cell (0, 0, 0) = grid_lo + offset * res
    res: float            # cell size (m), the occupancy's
    alpha: np.ndarray     # (nx, ny, nz) uint8 round(alpha * 255), x, y, z order (float alpha: verification only)
    offset: np.ndarray    # (3,) int64: this box's cell (0, 0, 0) in the occupancy grid
    grid_lo: np.ndarray   # (3,) float32: the occupancy grid's corner, from which the march computes cells
    x0: float
    x1: float
    depth: float          # glass plane at y0 - depth
    sill: float
    top: float            # the apex for an arch
    kind: str             # "rect" or "arch"
    y0: float             # the wall's inner face
    x_bearing: float      # compass bearing of the model's +x axis (the horizon tables are by compass azimuth)

    @property
    def window(self):
        return self.x0, self.x1, self.depth, self.sill, self.top, self.kind


def inside_outline(x, z, window, grow=0.0):
    """True inside a window's outline grown by `grow` metres (negative shrinks), as the proof's lt.inside_outline:
    the rectangle x0..x1, sill..top, and for an arch the semicircular head of radius half the width."""
    x0, x1, _depth, z0, z1, kind = window
    x0, x1, z0, z1 = x0 - grow, x1 + grow, z0 - grow, z1 + grow
    ins = (x > x0) & (x < x1) & (z > z0) & (z < z1)
    if kind == "arch":
        r = (x1 - x0) / 2
        xc, zs = (x0 + x1) / 2, z1 - r
        ins = ins & ((z <= zs) | ((x - xc) ** 2 + (z - zs) ** 2 < r * r))
    return ins


def reach_bounds(window, lo, res, dims, y0):
    """[start, stop) cells, per axis, of every cell that a ray of this window which can survive may sample.

    y: a surviving ray samples from where it starts (the wall face y0, or a point in the embrasure, below y0) to
       short of the end plane y0 - depth - 0.07, so y lies in [y0 - depth - 0.07, y0].
    x: a room ray enters inside the outline and leaves through it, so it stays inside the outline's x range up
       to the glass and drifts at most 0.07 tan(angle) beyond it; a ray starting in the embrasure starts within
       0.25 m of the outline and marches at most 2.2 m (the cap). So x lies in [x0 - 2.45, x1 + 2.45].
    z: nothing bounds where a point in the embrasure starts in z (a point beyond the glass, for one, may start far
       above the opening and still leave through it backwards), so z spans the whole grid.
    One cell of margin on each bounded side absorbs float32 rounding (y0 is itself a cell boundary of the grid).
    """
    x0, x1, depth, _sill, _top, _kind = window
    side = EMBRASURE_REACH + CAP
    lo_c = [int(np.floor((x0 - side - lo[0]) / res)) - 1, int(np.floor((y0 - depth - BEYOND_GLASS - lo[1]) / res)) - 1, 0]
    hi_c = [int(np.floor((x1 + side - lo[0]) / res)) + 2, int(np.floor((y0 - lo[1]) / res)) + 2, int(dims[2])]
    return [(max(a, 0), min(b, int(n))) for a, b, n in zip(lo_c, hi_c, dims)]


def _trim(alpha):
    """Start and stop of the smallest box holding every non-zero cell (one empty cell when there is none)."""
    spans = []
    for axis in range(3):
        used = np.nonzero(alpha.any(axis=tuple(a for a in range(3) if a != axis)))[0]
        spans.append((int(used[0]), int(used[-1]) + 1) if used.size else (0, 1))
    return spans


def volumes_from_occupancy(occ, lo, res, windows, y0, *, x_bearing, quantise=True) -> dict:
    """{name: WindowVolume} from the occupancy grid occ (X, Y, Z) alpha with corner lo and cell res (model frame).

    Each box is first the reach of reach_bounds(), every cell a surviving ray can sample; it is then cut to the
    cells there that hold any occupancy, which changes nothing, since an empty cell adds no optical depth and the
    march reads a sample outside the box as empty. quantise=False keeps float alpha, to verify the march itself.
    """
    alpha = np.clip(np.asarray(occ, np.float32), 0.0, 1.0)
    if quantise:
        alpha = np.rint(alpha * 255.0).astype(np.uint8)
    lo64 = np.asarray(lo, np.float64)
    out = {}
    for name, window in windows.items():
        (ax, bx), (ay, by), (az, bz) = reach_bounds(window, lo64, res, alpha.shape, y0)
        part = alpha[ax:bx, ay:by, az:bz]
        (tx, ux), (ty, uy), (tz, uz) = _trim(part)
        offset = np.array([ax + tx, ay + ty, az + tz], np.int64)
        x0, x1, depth, sill, top, kind = window
        out[name] = WindowVolume(name, lo64 + offset * res, float(res), np.ascontiguousarray(part[tx:ux, ty:uy, tz:uz]),
                                 offset, lo64.astype(F32), float(x0), float(x1), float(depth), float(sill), float(top),
                                 str(kind), float(y0), float(x_bearing))
    return out


def volume_arrays(vol: WindowVolume):
    """(alpha, frame) as windows.npz stores them; frame is float64 in FRAME_FIELDS order."""
    frame = np.concatenate([vol.origin, [vol.res], vol.alpha.shape, [vol.x0, vol.x1, vol.depth, vol.sill, vol.top],
                            [1.0 if vol.kind == "arch" else 0.0, vol.y0, vol.x_bearing], vol.offset,
                            vol.grid_lo.astype(np.float64)]).astype(np.float64)
    return vol.alpha, frame


def volume_from_arrays(name: str, alpha, frame) -> WindowVolume:
    f = [float(v) for v in frame]
    if len(f) != len(FRAME_FIELDS) or tuple(int(v) for v in f[4:7]) != tuple(alpha.shape):
        raise ValueError(f"{name}: frame of {len(f)} values does not describe an alpha of shape {alpha.shape}")
    return WindowVolume(name, np.array(f[0:3]), f[3], np.asarray(alpha), np.array(f[15:18], np.int64),
                        np.array(f[18:21], F32), f[7], f[8], f[9], f[10], f[11], "arch" if f[12] else "rect",
                        f[13], f[14])


_DENSITY_U8 = (-np.log1p(-np.minimum(np.arange(256) / 255.0, ALPHA_MAX))).astype(F32)


def _sample_depth(vol: WindowVolume, alpha):
    """Optical depth one march sample adds in cells of this alpha: -log(1 - alpha) x step / cell, as float32."""
    if alpha.dtype == np.uint8:
        dens = _DENSITY_U8[alpha]
    else:
        dens = -np.log1p(-np.clip(alpha.astype(F32), 0.0, ALPHA_MAX))
    return dens * F32(STEP / vol.res)


def _rays(vol: WindowVolume, P, D):
    """lt.trace_to_windows' set-up for this window, float32: (claimed, survives, start point, start offset, length).

    claimed: the window takes the ray (it enters through the room-side outline, or starts in this embrasure);
    survives: claimed, at most 2.2 m long and leaving through the glass outline, so the march decides its value."""
    dy = D[1]
    n = len(P)
    if not dy < -MIN_DOWN:
        return np.zeros(n, bool), np.zeros(n, bool), P, np.zeros(n, F32), np.zeros(n, F32)
    in_room = P[:, 1] > vol.y0
    tq = np.where(in_room, (vol.y0 - P[:, 1]) / dy, F32(0.0))
    Q = P + D * tq[:, None]
    claimed = (in_room & inside_outline(Q[:, 0], Q[:, 2], vol.window, ENTRY_GROW)) | \
              (~in_room & (P[:, 0] > vol.x0 - EMBRASURE_REACH) & (P[:, 0] < vol.x1 + EMBRASURE_REACH))
    length = np.maximum((Q[:, 1] - (vol.y0 - vol.depth - BEYOND_GLASS)) / -dy, F32(0.0))
    tg = (P[:, 1] - (vol.y0 - vol.depth)) / -dy
    G = P + D * tg[:, None]
    survives = claimed & ~(length > CAP) & inside_outline(G[:, 0], G[:, 2], vol.window, EXIT_GROW)
    start = np.where(in_room, F32(0.0), F32(EMBRASURE_SKIP))
    return claimed, survives, Q, start, length


def _march(vol: WindowVolume, Q, D, length, start):
    """lt.march over this window's box: float32 samples every STEP from `start` while t < length, at the cell the
    sample falls in (outside the box: empty), stopping once the depth reaches TAU_STOP. (transmittance, samples)."""
    tau = np.zeros(len(Q), F32)
    taken = np.zeros(len(Q), np.int32)
    t = np.asarray(start, F32).copy()
    live = np.nonzero(t < length)[0]
    dims = np.array(vol.alpha.shape)
    res, step = F32(vol.res), F32(STEP)
    while live.size:
        pos = Q[live] + D * t[live, None]
        cell = np.floor((pos - vol.grid_lo) / res).astype(np.int64) - vol.offset
        inside = np.all((cell >= 0) & (cell < dims), axis=1)
        add = np.zeros(live.size, F32)
        c = cell[inside]
        add[inside] = _sample_depth(vol, vol.alpha[c[:, 0], c[:, 1], c[:, 2]])
        tau[live] += add
        taken[live] += 1
        t[live] += step
        live = live[(t[live] < length[live]) & (tau[live] < TAU_STOP)]
    return np.exp(-tau), taken


def march_visibility(vol: WindowVolume, P, s) -> np.ndarray:
    """This window's transmittance of the sun ray from each point, as if it were the only window: no horizon and
    no glass transmission. (N,) float32."""
    D = np.asarray(s, F32)
    out = np.zeros(len(P), F32)
    for a in range(0, len(P), CHUNK):
        Pc = np.asarray(P[a:a + CHUNK], F32)
        _claimed, survives, Q, start, length = _rays(vol, Pc, D)
        idx = np.nonzero(survives)[0]
        if idx.size:
            out[a + idx] = _march(vol, Q[idx], D, length[idx], start[idx])[0]
    return out


def sun_az_el(s, x_bearing):
    """The sun's compass azimuth and elevation in degrees, as the proof takes them (lt.bearing_deg, asin s_z)."""
    s = np.asarray(s, np.float64)
    return float((x_bearing - np.degrees(np.arctan2(s[1], s[0]))) % 360.0), float(np.degrees(np.arcsin(np.clip(s[2], -1.0, 1.0))))


def horizon_at(horizon, az) -> float:
    """The horizon elevation at azimuth az: the 360-entry table (whole degrees) interpolated linearly, without
    wrapping past 359. lt.horizon_deg is linear between its 5-degree profile points, so this reproduces it."""
    i0 = min(int(np.floor(az)), 359)
    f = float(az) - i0
    return float(horizon[i0]) * (1.0 - f) + float(horizon[min(i0 + 1, 359)]) * f


def above_horizon(horizon, s, x_bearing) -> bool:
    az, el = sun_az_el(s, x_bearing)
    return el > horizon_at(horizon, az)


def fresnel_at(fresnel, s) -> float:
    """The glass transmission at |s_y|: the 101-entry table (|cos| 0.00..1.00) interpolated linearly."""
    c = min(abs(float(s[1])), 1.0) * 100.0
    i0 = min(int(c), 99)
    f = c - i0
    return float(fresnel[i0]) * (1.0 - f) + float(fresnel[i0 + 1]) * f


def sun_visibility(volumes, horizon_tables, fresnel_table, P, s, steps=None) -> np.ndarray:
    """lt.sun_direct from the window volumes and tables: each ray goes to the first window (in order) that claims
    it, counts while the sun is above that window's horizon, and is scaled by the glass transmission. (N,) float32.
    steps: an optional (N,) integer array; each marched point's entry is set to its number of samples, and every
    other entry is left as it was, so pass zeros."""
    D = np.asarray(s, F32)
    out = np.zeros(len(P), F32)
    if float(D[1]) >= -MIN_DOWN:
        return out
    gates = {name: above_horizon(horizon_tables[name], D, vol.x_bearing) for name, vol in volumes.items()}
    for a in range(0, len(P), CHUNK):
        Pc = np.asarray(P[a:a + CHUNK], F32)
        free = np.ones(len(Pc), bool)
        for name, vol in volumes.items():
            claimed, survives, Q, start, length = _rays(vol, Pc, D)
            idx = np.nonzero(free & survives)[0] if gates[name] else np.zeros(0, np.int64)
            free &= ~claimed
            if idx.size:
                out[a + idx], taken = _march(vol, Q[idx], D, length[idx], start[idx])
                if steps is not None:
                    steps[a + idx] = taken
    return out * F32(fresnel_at(fresnel_table, D))


def sunlit_area(vol: WindowVolume, s) -> float:
    """The glass area lit through the embrasure (m2) times the cosine to the wall normal: points 1 cm into the room
    at the grid's cell centres across the opening's bounding box, marched, times the cell area and |s_y|.
    No horizon, no glass transmission: callers apply them."""
    s = np.asarray(s, np.float64)
    if not s[1] < -MIN_DOWN:
        return 0.0
    lo = vol.grid_lo.astype(np.float64)
    centres = [lo[k] + (np.arange(int(np.floor((b - lo[k]) / vol.res)), int(np.ceil((e - lo[k]) / vol.res))) + 0.5) * vol.res
               for k, b, e in ((0, vol.x0, vol.x1), (2, vol.sill, vol.top))]
    X, Z = np.meshgrid(*centres, indexing="ij")
    P = np.stack([X.ravel(), np.full(X.size, vol.y0 + 0.01), Z.ravel()], 1)
    return float(march_visibility(vol, P, s).sum(dtype=np.float64)) * vol.res * vol.res * -float(s[1])


def fresnel_table(glass_t) -> list[float]:
    return [float(glass_t(c / 100.0)) for c in range(101)]


def horizon_table(horizon_fn, w_index: int) -> list[float]:
    return [float(horizon_fn(w_index, float(az))) for az in range(360)]


def sun_directions(solar_position, sun_vec, year=2026, step_min=15):
    """Unit sun vectors (model frame): the 21st of each month, 04:00-22:00 UTC every step_min minutes, sun up."""
    out = []
    for month in range(1, 13):
        for minute in range(4 * 60, 22 * 60, step_min):
            az, el = solar_position(year, month, 21, minute // 60, minute % 60)
            if el > 0.5:
                out.append(sun_vec(az, el))
    return np.array(out)


def ray_survives(vol: WindowVolume, P, s) -> np.ndarray:
    """Where march_visibility(vol, P, s) is non-zero: the window takes the ray, it is within the cap and it leaves
    through the glass outline (the march's geometry alone, occupancy ignored). (N,) bool."""
    D = np.asarray(s, F32)
    out = np.zeros(len(P), bool)
    for a in range(0, len(P), CHUNK):
        out[a:a + CHUNK] = _rays(vol, np.asarray(P[a:a + CHUNK], F32), D)[1]
    return out


SUN_DECLINATION_MAX = 23.45   # degrees; the proof's solar model (NOAA) peaks at 23.4385 in 2026
SUN_REFRACTION_MAX = 0.6      # degrees; the proof's refraction peaks at 0.574 on the horizon
REACH_PAD = 0.5               # degrees, on both axes of every opening's direction box


def opening_directions(vol: WindowVolume, P):
    """Bearing and elevation ranges (degrees) of the directions s (s_y < 0) whose line through each point crosses
    the glass plane inside the bounding rectangle of the outline: toward the opening for a point in front of the
    glass, away from it for a point beyond it. Exact for the rectangle: the bearing depends only on the horizontal
    offset and falls as it grows; the elevation is highest at the top edge and lowest at the bottom, at the nearest
    or farthest point of the edge by the sign of the height difference. A point on the glass plane gets everything.
    Returns (bearing_lo, bearing_hi, elevation_lo, elevation_hi), each (N,)."""
    P = np.asarray(P, np.float64)
    yg = vol.y0 - vol.depth
    side = np.where(P[:, 1] >= yg, 1.0, -1.0)
    h = np.abs(P[:, 1] - yg)
    dx = side[:, None] * (np.array([vol.x0, vol.x1]) - P[:, :1])
    dz = side[:, None] * (np.array([vol.sill, vol.top]) - P[:, 2:])
    dx_lo, dx_hi, dz_lo, dz_hi = dx.min(1), dx.max(1), dz.min(1), dz.max(1)
    near = np.hypot(np.clip(0.0, dx_lo, dx_hi), h)
    far = np.hypot(np.maximum(np.abs(dx_lo), np.abs(dx_hi)), h)
    el_hi = np.degrees(np.arctan2(dz_hi, np.where(dz_hi >= 0, near, far)))
    el_lo = np.degrees(np.arctan2(dz_lo, np.where(dz_lo >= 0, far, near)))
    az_lo = vol.x_bearing - np.degrees(np.arctan2(-h, dx_hi))     # the bearing falls as the offset grows
    az_hi = vol.x_bearing - np.degrees(np.arctan2(-h, dx_lo))
    flat = h < 1e-6
    return (np.where(flat, vol.x_bearing, az_lo), np.where(flat, vol.x_bearing + 180.0, az_hi),
            np.where(flat, -90.0, el_lo), np.where(flat, 90.0, el_hi))


def sun_band_meets(bearing_lo, bearing_hi, el_lo, el_hi, latitude) -> np.ndarray:
    """True where the box of directions (degrees, padded by REACH_PAD) holds a possible apparent sun: its elevation
    less up to SUN_REFRACTION_MAX lies on a daily circle of declination within +-SUN_DECLINATION_MAX at this
    latitude, above the horizon. A direction's declination is asin(g), g = D . pole = cos(el) cos(az) cos(lat) +
    sin(el) sin(lat); over the box g is extremal only at its corners, on the lines of azimuth -180, 0, 180, 360,
    540 (where dg/daz = 0) and where dg/del = 0 (el = theta(az) or theta(az) - 180), so its range is exact."""
    a0, a1 = np.asarray(bearing_lo, np.float64) - REACH_PAD, np.asarray(bearing_hi, np.float64) + REACH_PAD
    e1 = np.minimum(np.asarray(el_hi, np.float64) + REACH_PAD, 90.0)
    e0 = np.maximum(np.asarray(el_lo, np.float64) - REACH_PAD - SUN_REFRACTION_MAX, -SUN_REFRACTION_MAX - REACH_PAD)
    lat = np.radians(latitude)
    g_lo, g_hi = np.full(a0.shape, np.inf), np.full(a0.shape, -np.inf)
    for az in [a0, a1] + [np.where((a0 < c) & (c < a1), c, a0) for c in (-180.0, 0.0, 180.0, 360.0, 540.0)]:
        ca = np.cos(np.radians(az))
        theta = np.degrees(np.arctan2(np.sin(lat), ca * np.cos(lat)))
        for el in (e0, e1, theta, theta - 180.0):
            el = np.radians(np.where((e0 <= el) & (el <= e1), el, e0))
            g = np.cos(el) * ca * np.cos(lat) + np.sin(el) * np.sin(lat)
            g_lo, g_hi = np.minimum(g_lo, g), np.maximum(g_hi, g)
    band = np.sin(np.radians(SUN_DECLINATION_MAX))
    return (e0 <= e1) & (g_lo <= band) & (g_hi >= -band)


def sun_reach(volumes, P, latitude, chunk=CHUNK) -> np.ndarray:
    """True where some real sun position can light the point through some window: the directions through a window's
    glass rectangle (opening_directions) meet the sun's annual envelope (sun_band_meets). A non-zero march needs
    the ray to leave through the glass outline, inside that rectangle, so this is a superset of where
    march_visibility can be non-zero for any sun; occupancy, the entry, the cap and the horizon are ignored."""
    reach = np.zeros(len(P), bool)
    for a in range(0, len(P), chunk):
        Pc = np.asarray(P[a:a + chunk], np.float64)
        for vol in volumes.values():
            reach[a:a + chunk] |= sun_band_meets(*opening_directions(vol, Pc), latitude)
    return reach
