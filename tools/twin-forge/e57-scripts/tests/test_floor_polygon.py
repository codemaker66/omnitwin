"""Which atlas cells are REALLY floor — stated as tests.

accumulate_floor_atlas treats every grid cell as floor: it casts a ray to
z=z_floor and fuses whatever panorama pixel lands there. For a cell that is
actually wall, plinth, cabinet or outside the building, that sample is a
photograph of the obstruction, fused in as if it were oak. Walls smear across
the orthophoto and nothing downstream can ship.

The fix is geometric, and the mesh already on disk answers it. Two conditions,
and the second is the one that matters:

  (a) the mesh HAS a surface at this (x, y) within tol_m of z_floor
      -> there is floor here at all, rather than void outside the footprint;
  (b) there is clearance_m of free space directly above it
      -> nothing is STANDING on it.

(a) alone is not enough and that is the whole point: a wall's base sits AT
floor height, so a height-only rule admits the wall's own footprint. These
tests were written against a height-only implementation first and test_wall,
test_hollow_wall, test_table, test_doorway and the two measurement tests
failed; that is the only reason to believe (b) is doing work.

Fixture discipline: the atlas grid conventions and z_floor come from
tests/test_floor_atlas.py (GRID, Z_FLOOR) — there is one atlas fixture in this
tree, not two. The MESHES are new, because that file has none: they are built
here as plain numpy triangle arrays, in the E57 world frame (Z-up, metres),
the same frame the dollhouse GLB is co-registered into.

Run: python tests/test_floor_polygon.py
"""

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import floor_atlas as fa  # noqa: E402
import floor_polygon as fp  # noqa: E402
from test_floor_atlas import GRID, Z_FLOOR  # noqa: E402  (the ONE atlas fixture)

MM_PX_ROOM = 10.0        # room-scale grids: 10 mm/px keeps the sweeps quick


# --- mesh primitives -------------------------------------------------------
# Surfaces only, no volumes: this is how a photogrammetric dollhouse GLB
# actually carries a wall, and it is the hazard test_hollow_wall pins.

def _rect_z(x0, x1, y0, y1, z):
    """One horizontal rectangle as two triangles."""
    a, b = (x0, y0, z), (x1, y0, z)
    c, d = (x1, y1, z), (x0, y1, z)
    return [[a, b, c], [a, c, d]]


def _box(x0, x1, y0, y1, z0, z1):
    """A closed axis-aligned box as a SURFACE mesh (12 triangles, hollow)."""
    out = _rect_z(x0, x1, y0, y1, z0) + _rect_z(x0, x1, y0, y1, z1)
    for x in (x0, x1):
        out += [
            [(x, y0, z0), (x, y1, z0), (x, y1, z1)],
            [(x, y0, z0), (x, y1, z1), (x, y0, z1)],
        ]
    for y in (y0, y1):
        out += [
            [(x0, y, z0), (x1, y, z0), (x1, y, z1)],
            [(x0, y, z0), (x1, y, z1), (x0, y, z1)],
        ]
    return out


def _tris(*groups):
    out = []
    for g in groups:
        out += g
    return np.asarray(out, dtype=np.float64)


def _grid(x0, x1, y0, y1, mm_per_px=MM_PX_ROOM):
    s = mm_per_px / 1000.0
    return fa.AtlasGrid(
        origin_xy=(x0, y0),
        mm_per_px=mm_per_px,
        width=int(round((x1 - x0) / s)),
        height=int(round((y1 - y0) / s)),
    )


def _cells_in(grid, x0, x1, y0, y1):
    """Bool over the grid: pixel centres inside this world rectangle."""
    xs, ys = grid.pixel_centres_world()
    return (xs >= x0) & (xs <= x1) & (ys >= y0) & (ys <= y1)


# --- the realistic room, shared by the two measurement tests ---------------
# 8 x 6 m, 0.25 m walls, 3.2 m to the ceiling. The floor slab spans the FULL
# footprint including under every wall — the worst case for rule (a), and the
# case a laser-scanned slab plus modelled walls actually produces.

ROOM_W, ROOM_D, WALL_T, WALL_H = 8.0, 6.0, 0.25, 3.2
DOOR_Y0, DOOR_Y1, LINTEL_Z = 2.50, 3.40, 2.05     # a 0.90 m opening


def _room_tris():
    return _tris(
        _rect_z(0, ROOM_W, 0, ROOM_D, 0.0),                       # floor slab
        _box(0, ROOM_W, 0, WALL_T, 0, WALL_H),                    # south wall
        _box(0, ROOM_W, ROOM_D - WALL_T, ROOM_D, 0, WALL_H),      # north wall
        _box(0, WALL_T, 0, ROOM_D, 0, WALL_H),                    # west wall
        _box(ROOM_W - WALL_T, ROOM_W, 0, DOOR_Y0, 0, WALL_H),     # east, S of door
        _box(ROOM_W - WALL_T, ROOM_W, DOOR_Y1, ROOM_D, 0, WALL_H),  # east, N
        _box(ROOM_W - WALL_T, ROOM_W, DOOR_Y0, DOOR_Y1, LINTEL_Z, WALL_H),  # lintel
        _box(5.0, 5.4, 3.8, 4.2, 0, WALL_H),                      # column
        _rect_z(2.0, 3.6, 2.0, 2.9, 0.75),                        # table top
        _box(2.03, 2.09, 2.03, 2.09, 0, 0.75),                    # table legs
        _box(3.51, 3.57, 2.03, 2.09, 0, 0.75),
        _box(2.03, 2.09, 2.81, 2.87, 0, 0.75),
        _box(3.51, 3.57, 2.81, 2.87, 0, 0.75),
        _box(0.25, 0.70, 1.0, 3.0, 0, 0.45),                      # bench + plinth
        _box(4.2, 4.65, 1.2, 1.65, 0, 0.45),                      # stools
        _box(6.0, 6.45, 1.2, 1.65, 0, 0.45),
        _box(6.0, 6.45, 4.6, 5.05, 0, 0.45),
    )


ROOM_GRID = _grid(0.0, ROOM_W, 0.0, ROOM_D)


# --- 1. a bare slab --------------------------------------------------------

def test_a_bare_slab_is_floor_inside_and_void_outside():
    # The floor of the building is not the extent of the atlas grid. A cell
    # off the slab has no floor to photograph and must come back False.
    g = _grid(-0.5, 6.5, -0.5, 4.5)
    tris = _tris(_rect_z(0.0, 6.0, 0.0, 4.0, Z_FLOOR))
    m = fp.floor_mask(g, Z_FLOOR, tris)

    px = g.metres_per_px
    inside = _cells_in(g, 0.0 + px, 6.0 - px, 0.0 + px, 4.0 - px)
    outside = ~_cells_in(g, 0.0 - px, 6.0 + px, 0.0 - px, 4.0 + px)
    print(f"  bare slab: {m.mean() * 100:.2f}% of grid is floor "
          f"(slab is {24.0 / (7.0 * 5.0) * 100:.2f}% of it); "
          f"inside kept {m[inside].mean() * 100:.2f}%, "
          f"outside kept {m[outside].mean() * 100:.2f}%")
    assert m.shape == (g.height, g.width) and m.dtype == np.bool_
    assert m[inside].all(), "real floor was rejected"
    assert not m[outside].any(), "void outside the slab was called floor"


# --- 2. THE TEST THAT MATTERS ---------------------------------------------

def test_a_wall_standing_on_the_floor_is_not_floor():
    # A height-only rule PASSES the wall: the slab continues under it, so
    # there is a mesh surface at floor height inside the wall's own footprint.
    # Only the clearance term can reject it, and it must, or every wall in the
    # building smears across the orthophoto.
    g = _grid(-0.5, 6.5, -0.5, 4.5)
    x0, x1 = 2.00, 2.30                       # a 0.30 m wall, 3 m tall
    tris = _tris(
        _rect_z(0.0, 6.0, 0.0, 4.0, Z_FLOOR),
        _box(x0, x1, 0.0, 4.0, Z_FLOOR, Z_FLOOR + 3.0),
    )
    surf = fp.surface_at_floor_height(g, Z_FLOOR, tris)
    m = fp.floor_mask(g, Z_FLOOR, tris)

    wall = _cells_in(g, x0, x1, 0.2, 3.8)
    v = fp.DEFAULT_VOXEL_M
    clear_w = _cells_in(g, 0.5, x0 - 2 * v, 0.5, 3.5)
    clear_e = _cells_in(g, x1 + 2 * v, 5.5, 0.5, 3.5)

    # how far past the wall faces the rejection actually reaches
    xs, _ = g.pixel_centres_world()
    row = g.height // 2
    rej = (~m[row]) & (xs[row] > 0.5) & (xs[row] < 5.5)
    collar_w = x0 - float(xs[row][rej].min()) if rej.any() else 0.0
    collar_e = float(xs[row][rej].max()) - x1 if rej.any() else 0.0
    print(f"  wall {x0}-{x1} m: height-only rule keeps "
          f"{surf[wall].mean() * 100:.1f}% of the wall footprint as floor, "
          f"clearance rule keeps {m[wall].mean() * 100:.1f}%; "
          f"collar into real floor {collar_w * 1000:.0f} mm west / "
          f"{collar_e * 1000:.0f} mm east (voxel {v * 1000:.0f} mm)")

    assert surf[wall].all(), "fixture is wrong: (a) must admit the wall base"
    assert not m[wall].any(), "the wall's footprint was called floor"
    assert m[clear_w].all() and m[clear_e].all(), "floor beside the wall was lost"
    assert max(collar_w, collar_e) <= 1.5 * v, (collar_w, collar_e)


def test_a_hollow_thick_wall_is_solid_not_a_slot():
    # A dollhouse GLB carries walls as SURFACES. Voxelising a 0.30 m wall
    # marks the two faces and leaves the space between them empty, so a naive
    # column query punches a floor-wide slot straight down the middle of every
    # wall in the building — the exact pixels that then get wall colour.
    g = _grid(-0.5, 6.5, -0.5, 4.5)
    for thick in (0.0, 0.10, 0.30, 0.50):
        x0, x1 = 2.00, 2.00 + thick
        wall = (
            _box(x0, x1, 0.0, 4.0, Z_FLOOR, Z_FLOOR + 3.0)
            if thick > 0
            else [
                [(x0, 0.0, Z_FLOOR), (x0, 4.0, Z_FLOOR), (x0, 4.0, Z_FLOOR + 3.0)],
                [(x0, 0.0, Z_FLOOR), (x0, 4.0, Z_FLOOR + 3.0), (x0, 0.0, Z_FLOOR + 3.0)],
            ]
        )
        tris = _tris(_rect_z(0.0, 6.0, 0.0, 4.0, Z_FLOOR), wall)
        m = fp.floor_mask(g, Z_FLOOR, tris)
        # a zero-thickness wall still occupies one voxel column
        hi = x1 if thick > 0 else x0 + fp.DEFAULT_VOXEL_M * 0.5
        core = _cells_in(g, x0, hi, 0.5, 3.5)
        kept = float(m[core].mean())
        print(f"  wall thickness {thick * 1000:4.0f} mm -> "
              f"{kept * 100:5.1f}% of its footprint still called floor")
        assert kept == 0.0, f"{thick * 1000:.0f} mm wall leaked a floor slot"


# --- 3. a table -----------------------------------------------------------

def test_a_table_top_footprint_is_not_floor():
    # The top is at 0.75 m with 60 mm legs. Its footprint must be False.
    #
    # WHAT HAPPENS BETWEEN THE LEGS, and why it is right: the whole footprint
    # goes False, not just the four leg squares. The column test asks about a
    # vertical column of free space, and between the legs that column runs
    # straight into the underside of the top at 0.75 m. That is the answer we
    # want. Floor under a table top is floor no panorama can photograph — every
    # ray from a tripod-height scanner to it passes through the top — so a True
    # there would ask accumulate_floor_atlas to fuse a sample it can only get
    # by looking THROUGH the table, and without a mesh occluder in the loop it
    # would cheerfully fuse the table's own colour as oak. The alternative
    # (True, then let the occluder report it unobserved) leaves the answer
    # depending on whether the caller passed an occluder at all. Answering it
    # here, from geometry, does not.
    g = _grid(-0.5, 6.5, -0.5, 4.5)
    tris = _tris(
        _rect_z(0.0, 6.0, 0.0, 4.0, Z_FLOOR),
        _rect_z(1.0, 2.6, 1.0, 1.9, Z_FLOOR + 0.75),
        _box(1.03, 1.09, 1.03, 1.09, Z_FLOOR, Z_FLOOR + 0.75),
        _box(2.51, 2.57, 1.03, 1.09, Z_FLOOR, Z_FLOOR + 0.75),
        _box(1.03, 1.09, 1.81, 1.87, Z_FLOOR, Z_FLOOR + 0.75),
        _box(2.51, 2.57, 1.81, 1.87, Z_FLOOR, Z_FLOOR + 0.75),
    )
    surf = fp.surface_at_floor_height(g, Z_FLOOR, tris)
    m = fp.floor_mask(g, Z_FLOOR, tris)

    top = _cells_in(g, 1.0, 2.6, 1.0, 1.9)
    between = _cells_in(g, 1.3, 2.3, 1.3, 1.6)          # clear of every leg
    away = _cells_in(g, 3.5, 5.5, 0.5, 3.5)
    print(f"  table top 1.6x0.9 m at 0.75 m: height-only keeps "
          f"{surf[top].mean() * 100:.1f}% of its footprint, clearance keeps "
          f"{m[top].mean() * 100:.1f}% (between the legs "
          f"{m[between].mean() * 100:.1f}%); open floor keeps "
          f"{m[away].mean() * 100:.1f}%")
    assert surf[top].all(), "fixture is wrong: (a) must admit under the table"
    assert not m[top].any(), "the table top's footprint was called floor"
    assert not m[between].any(), "floor under the top was admitted"
    assert m[away].all(), "open floor was lost"


# --- 4. a doorway ---------------------------------------------------------

def test_a_doorway_stays_open_under_its_lintel():
    # Floor runs through a threshold. A lintel at 2.05 m is not standing on
    # the floor, and a clearance that reaches it would wall off every doorway
    # in the building — which is the constraint that sets clearance_m.
    tris = _room_tris()
    m = fp.floor_mask(ROOM_GRID, Z_FLOOR, tris)

    thresh = _cells_in(ROOM_GRID, ROOM_W - WALL_T + 0.05, ROOM_W - 0.05,
                       DOOR_Y0 + 0.15, DOOR_Y1 - 0.15)
    solid = _cells_in(ROOM_GRID, ROOM_W - WALL_T, ROOM_W, 0.5, DOOR_Y0 - 0.3)
    print(f"  doorway (0.90 m opening, lintel at {LINTEL_Z} m): threshold "
          f"floor kept {m[thresh].mean() * 100:.1f}%, solid wall beside it "
          f"kept {m[solid].mean() * 100:.1f}%")
    assert m[thresh].all(), "the lintel closed the doorway"
    assert not m[solid].any(), "the wall beside the door was called floor"


# --- 5. metric exactness --------------------------------------------------

def test_the_mask_lines_up_with_world_to_atlas():
    # The atlas is a measuring surface. The mask decides which of its pixels
    # carry a measurement, so its edges have to be the grid's own edges — not
    # the 100 mm voxel lattice the clearance term runs on. Deliberately
    # off-lattice slab bounds, on the shared GRID fixture.
    x0, x1, y0, y1 = -0.6131, 0.3573, -0.4427, 0.5089
    tris = _tris(_rect_z(x0, x1, y0, y1, Z_FLOOR))
    m = fp.floor_mask(GRID, Z_FLOOR, tris)
    assert m.any(), "nothing rasterised"

    cols, rows = m.any(axis=0), m.any(axis=1)
    got = (
        int(np.argmax(cols)),
        len(cols) - 1 - int(np.argmax(cols[::-1])),
        int(np.argmax(rows)),
        len(rows) - 1 - int(np.argmax(rows[::-1])),
    )
    want = (
        int(np.ceil(GRID.world_to_atlas(x0, y0)[0])),
        int(np.floor(GRID.world_to_atlas(x1, y1)[0])),
        int(np.ceil(GRID.world_to_atlas(x0, y0)[1])),
        int(np.floor(GRID.world_to_atlas(x1, y1)[1])),
    )
    err = [abs(a - b) for a, b in zip(got, want)]
    print(f"  slab edges (5 mm px): mask {got} vs world_to_atlas {want} "
          f"-> max error {max(err)} px")
    assert max(err) == 0, (got, want)
    # and it is exactly a rectangle: no ragged edge, no interior dropout
    assert np.array_equal(m, np.outer(rows, cols))


# --- evidence for the recommended clearance -------------------------------

def test_clearance_frontier_is_measured_not_assumed():
    # clearance_m is squeezed from both sides: too small and a table top stops
    # counting as standing on the floor, too large and a lintel closes the
    # doorway. This prints the frontier so the default is a measurement.
    tris = _room_tris()
    table = _cells_in(ROOM_GRID, 2.2, 3.4, 2.2, 2.7)
    thresh = _cells_in(ROOM_GRID, ROOM_W - WALL_T + 0.05, ROOM_W - 0.05,
                       DOOR_Y0 + 0.15, DOOR_Y1 - 0.15)
    bench = _cells_in(ROOM_GRID, 0.35, 0.60, 1.2, 2.8)
    rows = []
    for c in (0.30, 0.50, 0.80, 1.20, 1.60, 1.90, 2.10, 2.40):
        m = fp.floor_mask(ROOM_GRID, Z_FLOOR, tris, clearance_m=c)
        rows.append((c, float(m[table].mean()), float(m[bench].mean()),
                     float(m[thresh].mean()), 1.0 - float(m.mean())))
    for c, t, b, d, rej in rows:
        print(f"  clearance {c:4.2f} m -> table kept {t * 100:5.1f}%, "
              f"bench kept {b * 100:5.1f}%, doorway kept {d * 100:5.1f}%, "
              f"grid rejected {rej * 100:5.1f}%")
    by_c = {c: (t, b, d, rej) for c, t, b, d, rej in rows}
    # the default must reject a 0.75 m table AND a 0.45 m bench, and keep the door
    t, b, d, _ = by_c[fp.DEFAULT_CLEARANCE_M]
    assert t == 0.0 and b == 0.0 and d == 1.0, by_c[fp.DEFAULT_CLEARANCE_M]
    # and the lintel constraint is real, not hypothetical
    assert by_c[2.40][2] == 0.0, "a 2.40 m clearance should close this doorway"
    # a clearance below the table top cannot see it
    assert by_c[0.30][0] > 0.0, "a 0.30 m clearance should miss a 0.75 m table"


def _undulating_slab(x0, x1, y0, y1, z, amp, n=32, seed=7):
    """A slab with the vertical noise a laser-scanned floor actually has.

    Every other fixture in this file is a mathematically perfect plane, which
    is precisely why the emptiness guard looked sound: on a plane, a z_floor
    error either catches the surface or misses it entirely. Real floors sag,
    and this is the smallest fixture that reproduces that.
    """
    rng = np.random.default_rng(seed)
    xs = np.linspace(x0, x1, n + 1)
    ys = np.linspace(y0, y1, n + 1)
    zz = z + rng.uniform(-amp, amp, size=(n + 1, n + 1))
    out = []
    for i in range(n):
        for j in range(n):
            a = (xs[i], ys[j], zz[i, j])
            b = (xs[i + 1], ys[j], zz[i + 1, j])
            c = (xs[i + 1], ys[j + 1], zz[i + 1, j + 1])
            d = (xs[i], ys[j + 1], zz[i, j + 1])
            out += [[a, b, c], [a, c, d]]
    return out


def test_the_z_floor_guard_survives_an_undulating_floor():
    # The guard the module used to recommend was true only of a perfect plane.
    #
    # `mask.any()` catches a bad z_floor on a flat slab because the failure is
    # a cliff — at 52 mm out, nothing is within the band and the mask is empty.
    # Undulate the slab and the cliff becomes a ramp: the mask stays non-empty
    # while most of the real floor is quietly ANDed away. The emptiness test
    # therefore passes in exactly the case that matters, which is worse than
    # having no guard, because it reads as one.
    grid = _grid(0.0, 6.0, 0.0, 4.0)
    tris = _tris(_undulating_slab(0.2, 5.8, 0.2, 3.8, 0.0, amp=0.020))
    wrong = 0.060  # 60 mm out — inside the range a `median z - 1.5` guess lands

    kept_wrong = float(fp.surface_at_floor_height(grid, wrong, tris).mean())
    emptiness_guard_passes = kept_wrong > 0.0

    ok_right, d_right = fp.floor_height_agrees_with_mesh(grid, 0.0, tris)
    ok_wrong, d_wrong = fp.floor_height_agrees_with_mesh(grid, wrong, tris)

    print(
        f"  undulating +/-20 mm: emptiness guard at +60 mm passes="
        f"{emptiness_guard_passes} (keeps {kept_wrong * 100:.1f}% — it MISSES)"
    )
    print(
        f"  correct z_floor: kept {d_right['kept_below'] * 100:.0f}/"
        f"{d_right['kept_at'] * 100:.0f}/{d_right['kept_above'] * 100:.0f}% "
        f"peak={d_right['is_peak']} asym={d_right['asymmetry'] * 100:.1f}% -> ok={ok_right}"
    )
    print(
        f"  +60 mm out:      kept {d_wrong['kept_below'] * 100:.0f}/"
        f"{d_wrong['kept_at'] * 100:.0f}/{d_wrong['kept_above'] * 100:.0f}% "
        f"peak={d_wrong['is_peak']} asym={d_wrong['asymmetry'] * 100:.1f}% -> ok={ok_wrong}"
    )

    # The old guard is demonstrably useless here — this is the whole point.
    assert emptiness_guard_passes, "fixture no longer reproduces the ramp"
    # The new one must accept the truth and refuse the error.
    assert ok_right, d_right
    assert not ok_wrong, d_wrong


def test_exact_rasterisation_is_not_a_bounding_box_fill():
    # "Exact triangle rasterisation" was untested: every fixture here is an
    # axis-aligned rectangle, whose union-of-two-triangles IS its own bounding
    # box, so a bbox fill passes the entire suite unchanged. The Grand Hall is
    # not aligned to the atlas grid, so the difference is not academic.
    grid = _grid(0.0, 6.0, 0.0, 4.0, mm_per_px=10.0)
    th = np.radians(30.0)
    cx, cy, hx, hy = 3.0, 2.0, 2.0, 1.2
    corners = []
    for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        x, y = sx * hx, sy * hy
        corners.append(
            (cx + x * np.cos(th) - y * np.sin(th), cy + x * np.sin(th) + y * np.cos(th), 0.0)
        )
    a, b, c, d = corners
    tris = np.asarray([[a, b, c], [a, c, d]], dtype=np.float64)

    exact = fp.surface_at_floor_height(grid, 0.0, tris)

    # The bounding box a naive implementation would fill instead.
    xs = [p[0] for p in corners]
    ys = [p[1] for p in corners]
    gx, gy = grid.pixel_centres_world()
    bbox = (gx >= min(xs)) & (gx <= max(xs)) & (gy >= min(ys)) & (gy <= max(ys))

    differ = int((exact ^ bbox).sum())
    print(
        f"  30-deg rotated slab: exact keeps {exact.mean() * 100:.2f}%, "
        f"bbox keeps {bbox.mean() * 100:.2f}% — they differ on {differ} px"
    )
    # A rotated rectangle's area is unchanged by rotation; its bbox grows.
    assert exact.any(), "the rotated slab rasterised to nothing"
    assert differ > 50_000, f"only {differ} px differ — is this really exact?"
    assert exact.sum() < bbox.sum(), "exact must be a strict subset of the bbox"
    # And the kept area must match the true rectangle area, not the bbox's.
    true_frac = (2 * hx) * (2 * hy) / (6.0 * 4.0)
    assert abs(exact.mean() - true_frac) < 0.01, (exact.mean(), true_frac)


def test_z_floor_must_agree_with_the_mesh():
    # THE INTEGRATION LANDMINE. floor_atlas_build.py defaults z_floor to
    # `median scanner z - 1.5` — a guess, not a measurement. tol_m is +/-50 mm,
    # so a guess 52 mm out finds NO mesh surface at the claimed floor height
    # and the mask comes back entirely empty. That is the honest answer to the
    # question asked, and it is catastrophic if a caller ANDs it into the atlas
    # without looking: every pixel becomes unobserved.
    #
    # Pinned here so the cliff is a contract rather than a surprise — stable
    # inside tol_m, empty outside it, and `mask.any()` is the check that
    # catches it. A caller must either derive z_floor from the mesh or refuse
    # to mask when the mask is empty.
    tris = _room_tris()
    base = float(fp.floor_mask(ROOM_GRID, Z_FLOOR, tris).mean())
    kept, gone = [], []
    for dz in (-0.048, -0.020, 0.0, 0.020, 0.048):
        m = fp.floor_mask(ROOM_GRID, Z_FLOOR + dz, tris)
        kept.append((dz, float(m.mean())))
        assert m.any(), f"mask collapsed {dz * 1000:.0f} mm inside tol_m"
        assert abs(m.mean() - base) < 0.01, (dz, m.mean(), base)
    for dz in (-0.200, -0.052, 0.052, 0.200):
        m = fp.floor_mask(ROOM_GRID, Z_FLOOR + dz, tris)
        gone.append((dz, float(m.mean())))
        assert not m.any(), f"mask survived {dz * 1000:.0f} mm outside tol_m"
    print(f"  z_floor error (tol_m {fp.DEFAULT_TOL_M * 1000:.0f} mm): stable at "
          f"{[f'{d * 1000:+.0f}mm:{k * 100:.1f}%' for d, k in kept]}; "
          f"empty at {[f'{d * 1000:+.0f}mm' for d, _ in gone]}")


def test_realistic_room_reject_fraction_is_reported():
    # What this costs on a real-shaped room: how much of the grid, and how
    # much of the mesh floor, the mask refuses.
    tris = _room_tris()
    surf = fp.surface_at_floor_height(ROOM_GRID, Z_FLOOR, tris)
    m = fp.floor_mask(ROOM_GRID, Z_FLOOR, tris)
    inner = _cells_in(ROOM_GRID, WALL_T, ROOM_W - WALL_T, WALL_T, ROOM_D - WALL_T)
    print(f"  room {ROOM_W}x{ROOM_D} m @ {ROOM_GRID.mm_per_px:.0f} mm/px "
          f"({ROOM_GRID.width}x{ROOM_GRID.height} px): "
          f"height-only keeps {surf.mean() * 100:.1f}% of the grid; "
          f"full mask keeps {m.mean() * 100:.1f}% "
          f"(rejects {(1 - m.mean()) * 100:.1f}%); of the mesh floor it "
          f"rejects {(1 - m[surf].mean()) * 100:.1f}%; "
          f"of the walled interior it keeps {m[inner].mean() * 100:.1f}%")
    assert surf.mean() > 0.99, "the slab spans the grid; (a) alone rejects nothing"
    assert 0.15 < (1 - m.mean()) < 0.60, float(1 - m.mean())
    assert m[inner].mean() > 0.60, "the mask ate the room"


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"PASS {fn.__name__}")
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"FAIL {fn.__name__}: {exc}")
    print(f"\n{len(fns) - failed}/{len(fns)} passed")
    sys.exit(1 if failed else 0)
