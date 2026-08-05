"""Which atlas cells are REALLY floor.

THE BLOCKER THIS REMOVES. accumulate_floor_atlas treats every cell of the grid
as floor: it casts a ray from each scanner to (x, y, z_floor) and fuses
whatever panorama pixel lands there. For a cell that is actually wall, plinth,
cabinet or outside the building, the pixel it lands on is a photograph of the
obstruction — and it gets averaged into the shared surface as if it were oak.
The atlas is a measuring surface, so a wall smeared across it is not a cosmetic
fault: it is a measurement of something that is not there.

The mesh already on disk answers the question, and the answer is two
conditions, not one:

  (a) THERE IS FLOOR HERE. Some mesh surface at this (x, y) sits within tol_m
      of z_floor. Without this the grid's corners, light wells and everything
      outside the footprint get fused from whatever the ray happens to hit.
  (b) NOTHING IS STANDING ON IT. The column of space directly above the cell
      is free for clearance_m.

(b) is the one that does the work. A wall's base sits AT floor height, so (a)
alone ADMITS every wall in the building — measured on the room fixture in
tests/test_floor_polygon.py, where the slab spans the whole footprint, (a)
alone rejects 0.0% of the grid while the full rule rejects 22.8%. That is the
entire reason this module is not a one-liner.

WHY THE TWO CONDITIONS ARE MEASURED DIFFERENTLY, which looks inconsistent
until you try it the other way round:

  * (a) is rasterised from the TRIANGLES, exactly, at grid resolution. The
    footprint boundary is where the room ends; quantising it to a 100 mm voxel
    lattice would throw away 95% of the grid's precision (at 5 mm/px a voxel is
    20 px) at exactly the place the stakes are highest — the wall line. The
    rasteriser is pinned to grid.world_to_atlas to the pixel by
    test_the_mask_lines_up_with_world_to_atlas (measured error: 0 px on all
    four edges of an off-lattice slab).

  * (b) is a column query on a VOXELISED mesh, reusing
    nadir_fill.VoxelOccluder.from_triangles rather than a second voxeliser.
    Rasterising triangles cannot answer (b) at all: a wall is a VERTICAL
    surface, so its projection onto the floor plane is a sliver of zero area
    and an exact rasteriser reports no obstruction whatsoever. Voxelisation is
    precisely the operation that converts a thin vertical surface into the
    solid footprint the question is about. Its cost is a collar of at most one
    voxel of real floor beside every obstruction: measured on a 300 mm wall
    (true extent 2.000-2.300 m) on a 10 mm/px grid, the rejected span runs
    1.905-2.395 m at 100 mm voxels, so 95 mm of real floor is taken either
    side; at 50 mm voxels it runs 2.005-2.295 m and takes none. That errs in
    the safe direction, since a cell 50 mm from a wall base viewed at 80
    degrees from ten metres away lands on the wall, not the floor.

VoxelOccluder.blocked() is deliberately NOT used for the column query even
though it is right there. It marches a segment with near_skip/far_skip trims
tuned for donor visibility, it would run one ray per atlas pixel (millions),
and the quantity wanted here is not "is this segment interrupted" but "is this
COLUMN of the occupancy grid empty" — which is one vectorised any() over a
z-slice for the whole grid at once. The helper below reads occluder.grid
directly; nothing is added to nadir_fill.py.

THE HOLLOW-WALL TRAP, which is not obvious and silently ruins the result.
A dollhouse GLB carries walls as SURFACES. Voxelising a 300 mm wall marks the
two faces and leaves the space between them empty, so a plain column query
punches a floor-wide slot down the middle of every wall in the building — and
those are the worst cells in the atlas, since the ray to them is inside
masonry. Measured with the closing switched off, the fraction of a wall's own
footprint that comes back as floor: 100 mm wall 0%, 200 mm 25%, 300 mm 33%,
400 mm 51%, 500 mm 66%, 700 mm 77%. The 2-D obstruction footprint is therefore
closed (morphologically) over gaps up to solid_gap_m before it is applied,
which takes all of those to 0% up to 500 mm. Closing, not hole-filling:
binary_fill_holes on a room's wall loop would fill the entire room.

WHAT IT COSTS TO RUN THIS, measured on a 3000x2000 px grid at 8 mm/px, by
count of triangles surviving the near-floor prefilter: 9.6k -> (a) 0.52 s,
(b) 0.56 s; 47k -> 2.73 s, 0.98 s; 182k -> 10.05 s, 0.55 s; 502k -> 26.04 s,
1.20 s. (b) is flat because nadir_fill's voxeliser is already vectorised; (a)
is a per-triangle Python loop and it is the scaling limit. It has NOT been
optimised further, deliberately: nobody has yet counted how many triangles of
a real Matterpak mesh survive the prefilter, and tuning against a synthetic
tessellation would be tuning against a number we made up. If a real mesh puts
that count above ~100k, the fix is the one VoxelOccluder.from_triangles
already uses — group triangles by bounding-box size and rasterise each group
as one array op.

Frame: E57 world, Z-up, metres — the frame the dollhouse GLB is co-registered
into (twin-basis.ts) and the frame AtlasGrid maps to pixels. Pure: no I/O, no
global state, numpy + scipy.ndimage only.
"""

from __future__ import annotations

import numpy as np

DEFAULT_CLEARANCE_M = 1.2
DEFAULT_TOL_M = 0.05
DEFAULT_VOXEL_M = 0.10
DEFAULT_SOLID_GAP_M = 0.40


def _rasterise_band(grid, tris: np.ndarray, z_lo: float, z_hi: float) -> np.ndarray:
    """Mark every pixel whose covering triangle interpolates to a z inside
    [z_lo, z_hi]. Exact at grid resolution: a pixel is covered when its CENTRE
    is inside the triangle's projection, which is the same convention
    AtlasGrid.pixel_centres_world uses, so the mask and the samples it gates
    are talking about the same points.

    Triangles are pre-filtered by z-range before the loop. That is what keeps
    this affordable on a building mesh — only near-floor triangles survive —
    and it is why the per-triangle Python loop is not the wrong shape here.

    Triangles whose PROJECTION is degenerate (|2A| < 1e-9 px^2, i.e. vertical
    surfaces) are skipped. They enclose no floor area, and the barycentric
    solve is meaningless for them. Winding is not consulted: a co-registered
    photogrammetric mesh has no trustworthy normals, so "there is a surface
    here" is deliberately not "there is an UPWARD-FACING surface here".
    """
    out = np.zeros((grid.height, grid.width), dtype=bool)
    tris = np.asarray(tris, dtype=np.float64)
    if tris.size == 0:
        return out
    if tris.ndim != 3 or tris.shape[1:] != (3, 3):
        raise ValueError(f"tris must be (N, 3, 3), got {tris.shape}")

    keep = (tris[..., 2].max(axis=1) >= z_lo) & (tris[..., 2].min(axis=1) <= z_hi)
    tris = tris[keep]
    if tris.shape[0] == 0:
        return out

    s = grid.metres_per_px
    ox, oy = grid.origin_xy
    cx = (tris[..., 0] - ox) / s - 0.5          # == grid.world_to_atlas, vectorised
    cy = (tris[..., 1] - oy) / s - 0.5
    zz = tris[..., 2]

    for i in range(tris.shape[0]):
        ax, bx, gx = cx[i]
        ay, by, gy = cy[i]
        c0 = max(int(np.ceil(min(ax, bx, gx))), 0)
        c1 = min(int(np.floor(max(ax, bx, gx))), grid.width - 1)
        r0 = max(int(np.ceil(min(ay, by, gy))), 0)
        r1 = min(int(np.floor(max(ay, by, gy))), grid.height - 1)
        if c1 < c0 or r1 < r0:
            continue                            # covers no pixel centre
        det = (by - gy) * (ax - gx) + (gx - bx) * (ay - gy)
        if abs(det) < 1e-9:
            continue                            # vertical: no floor area
        C = np.arange(c0, c1 + 1, dtype=np.float64)[None, :]
        R = np.arange(r0, r1 + 1, dtype=np.float64)[:, None]
        l0 = ((by - gy) * (C - gx) + (gx - bx) * (R - gy)) / det
        l1 = ((gy - ay) * (C - gx) + (ax - gx) * (R - gy)) / det
        l2 = 1.0 - l0 - l1
        inside = (l0 >= -1e-9) & (l1 >= -1e-9) & (l2 >= -1e-9)
        z = l0 * zz[i, 0] + l1 * zz[i, 1] + l2 * zz[i, 2]
        out[r0:r1 + 1, c0:c1 + 1] |= inside & (z >= z_lo) & (z <= z_hi)
    return out


def surface_at_floor_height(
    grid, z_floor: float, tris: np.ndarray, *, tol_m: float = DEFAULT_TOL_M
) -> np.ndarray:
    """Condition (a): the mesh has a surface within tol_m of z_floor here.

    Symmetric about z_floor, because z_floor is an estimate too — floor_atlas
    _build defaults it to `median scanner z - 1.5`, and _align_pose_heights
    exists precisely because sweeps disagree about the floor by centimetres.
    A one-sided band would make the mask's footprint depend on which side of
    the truth that estimate landed.
    """
    return _rasterise_band(grid, tris, z_floor - tol_m, z_floor + tol_m)


def floor_height_agrees_with_mesh(
    grid,
    z_floor: float,
    tris: np.ndarray,
    *,
    tol_m: float = DEFAULT_TOL_M,
    max_spread: float = 0.05,
) -> tuple[bool, dict]:
    """Does `z_floor` actually name the mesh's floor? Ask three heights, not one.

    THE GUARD THIS REPLACES WAS ONLY EVER TRUE OF A PERFECT PLANE. The obvious
    check is `mask.any()` — no surface at the claimed height means nothing is
    floor, so refuse. On the synthetic slab that is a cliff: correct to 50 mm
    out changes the kept fraction by 0.2 points, and at 52 mm the mask is
    empty. But a laser-scanned floor is not mathematically flat, and on real
    undulation the cliff becomes a RAMP. Measured on a tessellated slab with
    uniform vertical noise, `z_floor` 60 mm too high:

        undulation +/- 0 mm  ->  mask empty          (the cliff: caught)
        undulation +/-10 mm  ->  47.2% of floor kept (not empty: MISSED)
        undulation +/-20 mm  ->  46.0% of floor kept (not empty: MISSED)

    So `mask.any()` passes, the caller proceeds, and most of a real floor is
    quietly ANDed out of the atlas. Worse, the failure hides itself: report
    coverage over the mask rather than over the grid and the loss vanishes
    from the one number anybody checks.

    The honest contract is SHAPE, and specifically that z_floor sits at the
    PEAK of the coverage profile. Probe the kept fraction at z_floor and at
    z_floor +/- tol_m; a correct height is a local maximum with symmetric
    shoulders, because the band then straddles the whole undulation while
    either offset probe sheds roughly half of it. A height on the slope of the
    profile is not a maximum, and that survives undulation because undulation
    moves all three probes together.

    Note what this does NOT test, since the first draft of this function got it
    wrong and the suite caught it: the shoulders are not expected to be CLOSE
    to the peak. With +/-20 mm of undulation and a +/-50 mm band, a correct
    z_floor measures 84% at the peak and ~42% at each shoulder — a spread of
    42 points that says nothing is amiss. Testing the spread would reject every
    real floor. It is the asymmetry that carries the signal, not the depth.

    Returns (ok, detail) rather than raising: the caller decides whether a
    disagreement is fatal or merely worth logging, and `detail` carries the
    three fractions so a refusal can say what it actually saw.
    """
    below, at, above = (
        float(surface_at_floor_height(grid, z_floor + dz, tris, tol_m=tol_m).mean())
        for dz in (-tol_m, 0.0, tol_m)
    )
    # Guard against a division by zero on a grid with no mesh over it at all;
    # `at > 0.0` below is what actually rejects that case.
    asymmetry = abs(below - above) / at if at > 0.0 else 1.0
    is_peak = at >= below and at >= above
    ok = at > 0.0 and is_peak and asymmetry <= max_spread
    return ok, {
        "kept_below": below,
        "kept_at": at,
        "kept_above": above,
        "is_peak": is_peak,
        "asymmetry": asymmetry,
        "max_spread": max_spread,
        "z_floor": float(z_floor),
        "tol_m": float(tol_m),
    }


def _disc(r: int) -> np.ndarray:
    k = np.arange(-r, r + 1)
    return (k[:, None] ** 2 + k[None, :] ** 2) <= r * r + 1e-9


def standing_obstruction(
    grid,
    z_floor: float,
    tris: np.ndarray,
    *,
    clearance_m: float = DEFAULT_CLEARANCE_M,
    tol_m: float = DEFAULT_TOL_M,
    voxel: float = DEFAULT_VOXEL_M,
    solid_gap_m: float = DEFAULT_SOLID_GAP_M,
    occluder=None,
) -> np.ndarray:
    """Condition (b), negated: something is standing on this cell.

    True where the column above the cell is interrupted anywhere between
    z_floor + tol_m + voxel and z_floor + clearance_m.

    WHERE THE BAND STARTS, and why it is not simply z_floor + tol_m. The
    occupancy grid is a lattice, and the floor's own surface occupies a whole
    voxel LAYER. Start the query inside that layer and every cell in the
    building reports an obstruction — the failure is total and silent. Adding
    one voxel to the lower bound makes the exclusion provable rather than
    lucky: the lowest layer the query can reach has its floor at
    >= z_floor + tol_m for any lattice phase, so no geometry the tolerance band
    has already called "floor" can be counted as standing on it.

    The price is that obstructions shorter than tol_m + voxel (150 mm at the
    defaults) are invisible to this test. That is the right price. Skirting,
    thresholds and cable trunking at that height do not hide the floor from a
    tripod-height donor — nadir_fill's own occlusion query makes the same call
    with z_exempt_below = z_floor + 0.30 — and the alternative is a mask that
    rejects the whole room the moment z_floor is estimated a centimetre low.

    WHY THE FOOTPRINT IS CLOSED. See the module docstring: a surface-only mesh
    voxelises to a hollow shell, so a thick wall's interior columns are empty
    and would come back as floor. binary_closing over a disc of
    r = round(solid_gap_m / 2 voxel) voxels seals gaps up to 2*r voxels without
    growing the outer boundary (closing is dilate-then-erode; an isolated line
    comes back unchanged).

    That radius is QUANTISED to the lattice, so the effective fill is 2*r*voxel
    and not solid_gap_m: at 0.40 m it is 400 mm for a 50 mm voxel, 320 mm for
    80 mm, 400 mm for 100 mm, 300 mm for 150 mm. Wall thicknesses between the
    effective fill and solid_gap_m therefore still leak, which is why the
    hollow-wall test measures the frontier instead of trusting the parameter.

    ITS KNOWN COST, measured, because it is not small: a genuine strip of floor
    between two obstructions is rejected if it is narrower than the fill. With
    two 0.9 m benches either side of it, a slot of 100-500 mm comes back 0.0%
    floor; 600 mm comes back 60.8%; 800 mm comes back 78.8%. That floor is
    unphotographable at grazing incidence and unplannable, so taking it is the
    better side of the trade against leaking wall interiors — but a caller who
    cares more about narrow slots than about thick walls should lower this,
    reading the leak table in the module docstring as the price. Set
    solid_gap_m=0 to disable it entirely and accept a 25% leak on 200 mm walls.

    VOXEL SIZE IS NOT FREE EITHER, measured on the room fixture (rejected
    fraction / walled interior kept / doorway threshold kept): 50 mm ->
    20.65% / 89.87% / 100%; 80 mm -> 19.57% / 88.48% / 100%; 100 mm ->
    22.77% / 87.25% / 100%; 150 mm -> 24.78% / 85.62% / 100%; 200 mm ->
    32.58% / 78.08% / 91.7%. It is not monotonic, because both the collar and
    the quantised closing radius move with the lattice. 200 mm is past the
    point where a 900 mm doorway starts to close and should not be used;
    100 mm is the default because it is what floor_atlas_build already builds
    its occluder at, so the mask costs nothing extra there.

    occluder: a prebuilt nadir_fill.VoxelOccluder over the SAME triangles, to
    avoid voxelising a building mesh twice (floor_atlas_build already builds
    one). Its own voxel size wins over the argument, because the lattice the
    query runs on is its lattice.
    """
    from scipy import ndimage

    out = np.zeros((grid.height, grid.width), dtype=bool)
    tris = np.asarray(tris, dtype=np.float64)
    if occluder is None:
        if tris.size == 0:
            return out
        import nadir_fill as nf
        occluder = nf.VoxelOccluder.from_triangles(tris, voxel=voxel)
    voxel = float(occluder.voxel)

    occ = occluder.grid
    oz = float(occluder.origin[2])
    z_lo = z_floor + tol_m + voxel
    z_hi = z_floor + clearance_m
    if z_hi <= z_lo:
        return out
    # layers whose TOP face is above z_lo, up to those whose BOTTOM face is
    # within reach of z_hi
    k_lo = int(np.floor((z_lo - oz) / voxel))
    k_hi = int(np.floor((z_hi - oz) / voxel))
    k_lo = max(k_lo, 0)
    k_hi = min(k_hi, occ.shape[2] - 1)
    if k_hi < k_lo:
        return out

    band = occ[:, :, k_lo:k_hi + 1].any(axis=2)
    r = int(round(solid_gap_m / (2.0 * voxel)))
    if r >= 1 and band.any():
        # pad with free space (outside the mesh bbox nothing stands) so the
        # erosion half of the closing sees real neighbours, not the array edge
        p = np.pad(band, r + 1, constant_values=False)
        band = ndimage.binary_closing(p, structure=_disc(r))[r + 1:-r - 1,
                                                            r + 1:-r - 1]

    xs, ys = grid.pixel_centres_world()
    ix = np.floor((xs - occluder.origin[0]) / voxel).astype(np.int64)
    iy = np.floor((ys - occluder.origin[1]) / voxel).astype(np.int64)
    inb = (ix >= 0) & (ix < band.shape[0]) & (iy >= 0) & (iy < band.shape[1])
    out[inb] = band[ix[inb], iy[inb]]
    return out


def floor_mask(
    grid,
    z_floor: float,
    tris: np.ndarray,
    *,
    clearance_m: float = DEFAULT_CLEARANCE_M,
    tol_m: float = DEFAULT_TOL_M,
    voxel: float = DEFAULT_VOXEL_M,
    solid_gap_m: float = DEFAULT_SOLID_GAP_M,
    occluder=None,
) -> np.ndarray:
    """(grid.height, grid.width) bool: cells that are really floor.

    floor  ==  there is a surface at floor height here (a)
               AND nothing is standing on it (b)

    CHOOSING clearance_m. It is squeezed from both sides and the frontier is
    measured, not assumed, in test_clearance_frontier_is_measured_not_assumed
    on an 8 x 6 m room with 250 mm walls, a 900 mm doorway under a lintel at
    2.05 m, a 750 mm table, a 450 mm bench and three stools:

        clearance   table kept   bench kept   doorway kept   grid rejected
          0.30 m      100.0%         0.0%        100.0%          19.1%
          0.50 m      100.0%         0.0%        100.0%          19.1%
          0.80 m        0.0%         0.0%        100.0%          22.7%
          1.20 m        0.0%         0.0%        100.0%          22.8%
          1.60 m        0.0%         0.0%        100.0%          22.8%
          1.90 m        0.0%         0.0%        100.0%          22.9%
          2.10 m        0.0%         0.0%          0.0%          23.3%
          2.40 m        0.0%         0.0%          0.0%          23.3%

    Swept at 0.02 m the two frontiers are sharp: the table's footprint goes
    fully rejected AT 0.72 m, and the doorway closes AT 2.02 m. So the usable
    window on this room is [0.72, 2.00], and the recommendation is 1.2 m.

    WHY 1.2 AND NOT THE MIDPOINT. The two ends are not symmetric in cost. Too
    low and the rule stops seeing table tops — a table smears a 1.6 x 0.9 m
    rectangle of oak-coloured nonsense into a plan people will measure
    against. Too high and it eats doorways, which is worse: it disconnects the
    floor plan between rooms, and a hole in a floor plan reads as a fact about
    the building. 1.2 m sits 0.48 m above the measured 0.72 m frontier and
    0.80 m below the measured 2.02 m one. That upper margin is deliberate
    headroom for furniture taller than anything this fixture contains — a bar
    counter, a high console — which is not measured here and is the reason not
    to sit at the low edge. Inside the window the choice is nearly free: the
    rejected fraction moves only from 22.688% at 0.80 m to 22.875% at 1.90 m,
    about 0.19 points of the grid, which is itself the reason to sit in the
    middle rather than at an edge.

    Move it only for a capture with head-height things that are NOT standing
    on the floor — a low soffit, a projector rig, a suspended banner — where
    ~0.9 m is the right answer.

    z_floor MUST BE THE MESH'S FLOOR, not a guess. tol_m is +/-50 mm and on a
    PERFECTLY FLAT slab the failure is a cliff: an error up to 50 mm changes
    the result by 0.2 points, and at 52 mm the mask is EMPTY — no mesh surface
    is at the claimed height, so nothing is floor. That is the correct answer
    to the question asked and a catastrophe if it is ANDed into an atlas
    unexamined. floor_atlas_build.py defaults z_floor to `median scanner z -
    1.5`, which is a guess and can be 52 mm out.

    DO NOT GUARD THIS WITH `mask.any()`. On a real, undulating floor the cliff
    becomes a ramp: the mask stays non-empty while most of the floor silently
    disappears, so the emptiness test passes precisely when it matters. Call
    floor_height_agrees_with_mesh instead, which compares the kept fraction
    across three probe heights and survives undulation. Pinned by
    test_z_floor_must_agree_with_the_mesh and by
    test_the_z_floor_guard_survives_an_undulating_floor.

    WHAT THIS DOES NOT DO, said plainly because the mask is about to gate a
    measuring surface: it is not a room polygon and it does not know about
    storeys. It rejects a cell whose column happens to be blocked, whether the
    blocker is a wall or a person's chair, and it will happily return a
    disconnected archipelago if the mesh is holed. Downstream may well want to
    take the largest connected component or intersect with a room boundary;
    that is a policy decision and it is not made here.

    Requires a mesh. With no mesh there is no evidence about where the floor
    is, and this must not be called with an empty array in the hope of a
    permissive answer — empty tris return an all-False mask (nothing is known
    to be floor), which is the honest answer and NOT the same as the current
    everything-is-floor behaviour. A caller without a mesh should skip masking
    and say so.
    """
    ok = surface_at_floor_height(grid, z_floor, tris, tol_m=tol_m)
    if not ok.any():
        return ok
    blocked = standing_obstruction(
        grid, z_floor, tris,
        clearance_m=clearance_m, tol_m=tol_m, voxel=voxel,
        solid_gap_m=solid_gap_m, occluder=occluder,
    )
    return ok & ~blocked
