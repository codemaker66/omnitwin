"""What the wall measuring scripts beside this file share: a finished build's own files, read as the build steps
read them, and the measure they all use.

The measure. A texel's luminance is set against its clean surroundings: the median over the texels within REACH
(10 cm at 5 mm a texel) that are known to be clean and lie within NEAR_DEPTH (10 mm) of the texel's own depth, so
on the same surface. With fewer than FEW such neighbours a texel is not judged. A texel is DARK where it is under
85% of its surroundings (the measure of 16 November 2026 for an occluder's rim printed on plaster) and OFF where
it is more than 12 sRGB levels from them either way.

It is a loose measure beside mouldings: on the Saloon it calls 14 in 100 clean texels dark and 26 in 100 off
there, because a real shadow or a moulding's edge also differs from the wall beside it. So it is for COMPARING the
same texels in two builds, or two views of one texel, never for an absolute count; compare_builds.py prints the
rate on clean texels beside the ones it judges, so that every count can be read against it.

Two builds are counted as pairs, not as two rates: of the same texels, how many turned worse, how many better and
how many are as they were (paired_counts), with the exact sign test on the ones that changed (sign_test; McNemar's
exact test). That p takes each texel for an independent pair, which a wall's texels are not: a patch that changes
station changes together. So it is the least the chance can be, and compare_builds.py counts by connected patch as
well, and counts the clean texels beside them, whose station did not change, in the same way.

Nothing here writes into a build's folder, and no scan data is kept with these scripts: they take the work
folders of builds made on the reader's own machine."""
import glob
import os
import re
import sys

for _name in ('OPENBLAS_NUM_THREADS', 'OMP_NUM_THREADS', 'MKL_NUM_THREADS'):
    os.environ.setdefault(_name, '1')                  # one BLAS thread, as the build's own steps run, unless the caller said otherwise
ROOMS = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))    # tools/surveyed-rooms
sys.path.insert(0, ROOMS)

import numpy as np  # noqa: E402

REACH, NEAR_DEPTH, FEW = 20, 0.010, 30                 # texels, metres, least clean neighbours
DARK, OFF = 0.85, 12.0
LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)


def setup(work):
    """The room of a finished build's work folder, with bestview and label-views pointed at it as its own steps
    had them. The working directory becomes the work folder (project.py reads data/ and out-walls/ from it)."""
    from roombuild import legacy  # noqa: PLC0415 - after the BLAS threads are set
    from roombuild.context import Room  # noqa: PLC0415
    os.environ.pop('SURVEYED_ROOMS_TEST_DEPTH_SIZE', None)         # a real build's depth maps, never the tests' small ones
    os.environ.pop('SURVEY_PAUSE_FILE', None)                      # a few minutes of reading: nothing here waits on a gate
    work = os.path.abspath(work)
    os.chdir(work)
    room = Room(os.path.join(work, 'room.json'), work)
    B = legacy.best_view(room)
    lv = legacy.label_views()
    if not B.OCCLUDER_MARGIN > 0:
        raise SystemExit('this room sets no occluder margin (survey.projection.walls.occluderMargin): it has no doubtful views to measure')
    return room, B, lv


def walls_of(work):
    proj = os.path.join(work, 'proj')
    return sorted(f[7:-4] for f in os.listdir(proj) if f.startswith('labels-') and f.endswith('.npz'))


def bit(bits, s, r, c):
    """Packed per-station bits (stations, rows, bytes) at texels (r, c) for stations s, as bool."""
    return ((bits[s, r, c >> 3] >> (7 - (c & 7))) & 1).astype(bool)


def levels(rgb):
    """Luminance in sRGB levels (0 to 255) of linear RGB (a wall photograph's own units)."""
    y = np.clip(rgb @ LUMA, 0.0, 1.0)
    return 255.0 * np.where(y <= 0.0031308, 12.92 * y, 1.055 * np.power(y, 1 / 2.4) - 0.055)


def photograph(work, wall):
    """A wall's photograph as the walls step wrote it (proj/wall-<wall>-<tile>.npz, before the atlas and its
    patches), its tiles side by side in the wall's own grid: linear RGB and where it is coloured."""
    exact = re.compile(rf'^wall-{re.escape(wall)}-(\d+)\.npz$')              # "window" must not take "window-front-end"'s tiles
    tiles = sorted((f for f in glob.glob(os.path.join(work, 'proj', f'wall-{wall}-*.npz')) if exact.match(os.path.basename(f))),
                   key=lambda f: int(exact.match(os.path.basename(f)).group(1)))
    if not tiles:
        raise SystemExit(f'{work}: no photograph of wall {wall} (the walls step has not run there)')
    parts = [np.load(f) for f in tiles]
    return np.concatenate([p['rgb'] for p in parts], 1), np.concatenate([p['valid'] for p in parts], 1)


def surroundings(L, clean, depth, r, c):
    """For texels (r, c): the median of L over their clean neighbours on their own surface, and how many there
    were. L is a whole wall (NaN where unknown), clean its mask, depth the wall's relief (metres). A texel is
    never its own surroundings, clean or not: a clean texel judged as a control is then judged exactly as a
    changed one is, which has no place in `clean`."""
    Lp = np.pad(L, REACH, constant_values=np.nan)
    cp = np.pad(clean, REACH, constant_values=False)
    dp = np.pad(depth, REACH, constant_values=np.inf)
    dy, dx = np.mgrid[-REACH:REACH + 1, -REACH:REACH + 1]
    others = (dy != 0) | (dx != 0)
    dy, dx = dy[others], dx[others]
    ref = np.full(len(r), np.nan, np.float32)
    count = np.zeros(len(r), np.int32)
    for a in range(0, len(r), 2000):
        rr = r[a:a + 2000, None] + dy[None, :] + REACH
        cc = c[a:a + 2000, None] + dx[None, :] + REACH
        ok = cp[rr, cc] & (np.abs(dp[rr, cc] - depth[r[a:a + 2000], c[a:a + 2000]][:, None]) <= NEAR_DEPTH)
        vals = np.where(ok, Lp[rr, cc], np.nan)
        count[a:a + 2000] = ok.sum(1)
        some = count[a:a + 2000] > 0
        if some.any():
            ref[a:a + 2000][some] = np.nanmedian(vals[some], axis=1)
    return ref, count


def sign_test(worse, better):
    """How likely a split at least this lopsided is, were each thing that changed as likely to have turned worse
    as better: the exact two-sided sign test on the changed pairs alone (McNemar's exact test). 1.0 where nothing
    changed, or as many turned each way."""
    worse, better = int(worse), int(better)                # a numpy integer would wrap round in the sums below, silently
    n, k = worse + better, min(worse, better)
    term = total = 1                                       # C(n, 0); whole numbers, so nothing is rounded before the end
    for i in range(k):
        term = term * (n - i) // (i + 1)                   # C(n, i + 1)
        total += term
    return min(1.0, 2 * total / 2 ** n)


def paired_counts(worse, better, among):
    """McNemar's counts for one yes-or-no judgement of the same texels in two builds: of the texels in `among`,
    how many turned worse, how many better and how many are as they were, with the sign test on the first two."""
    w, b = int((worse & among).sum()), int((better & among).sum())
    return dict(worse=w, better=b, unchanged=int(among.sum()) - w - b, p_exact=sign_test(w, b))


def patch_image(mask):
    """The connected patches (8 neighbours) of a wall's texels in `mask`, numbered from 1, and how many there are.
    Texels that change station together are one patch: patch_counts' unit."""
    from scipy import ndimage  # noqa: PLC0415 - the comparing script alone needs it
    return ndimage.label(mask, structure=np.ones((3, 3)))


def patch_counts(patch, worse, better, among):
    """paired_counts with the patch as the unit, since a patch's texels are not independent pairs. `patch` is each
    texel's patch in a numbering of ALL the texels that changed (patch_image), so that a patch is not cut in two
    where some of its texels are left out of `among` (not judged, or of another kind). Of the patches that hold a
    texel of `among`: how many turned worse (more of those texels worse than better), how many better, how many
    neither, with the sign test on the first two."""
    ids = patch[among]
    if not len(ids):
        return dict(patches=0, worse=0, better=0, unchanged=0, p_exact=1.0)
    top = int(patch.max()) + 1
    held = np.bincount(ids, minlength=top) > 0
    net = np.bincount(ids, weights=worse[among].astype(np.float64) - better[among], minlength=top)
    n, w, b = int(held.sum()), int((net[held] > 0).sum()), int((net[held] < 0).sum())
    return dict(patches=n, worse=w, better=b, unchanged=n - w - b, p_exact=sign_test(w, b))


def under_a_patch(room, grid, wall):
    """Where a photo patch of the room's config covers this wall (a door drawn shut from its twin, a dado from the
    wall opposite): the atlas replaces the photograph there, so what is measured there is never seen."""
    covered = np.zeros(grid.depth.shape, bool)
    for pw, u0, u1, v0, v1, _mode, _arg in room.patches('photo'):
        if pw['id'] == wall:
            covered |= ((grid.vrow >= v0) & (grid.vrow < v1))[:, None] & ((grid.ucol >= u0) & (grid.ucol < u1))[None, :]
    return covered
