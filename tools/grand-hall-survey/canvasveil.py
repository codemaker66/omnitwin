"""The varnish veil on the portraits' canvases: what canvas-veil.py measures and pack-atlas.py and project-detail.py apply.

A varnished canvas reflects the room. The view that photographed a canvas most sharply (the near one label-views.py
chooses) can carry a broad veil of reflected light over its dark paint, which the Laplacian label-views.py scores by
does not see; the views without that veil saw the canvas three to five times less sharply (the fireplace portrait's
lower canvas: scan_034 at 2.2 mm a panorama pixel, every view without glare there at 7-11 mm), each with a sheen of
its own elsewhere. Choosing other labels would trade the veil for that blur. Instead the canvas keeps the composite's
detail and loses the veil, measured against all the views of it, in linear light:

- The reference is the station that labels most of the canvas. Every station that saw the whole canvas is registered
  to it by phase correlation of their band-passed log luminance (the scanned depth leaves the far views 5-30 mm off).
- The canvas as the views saw it without glare: per texel, low-passed (LOW_MM), the other views' lower quartile
  (label-views.py's reference for glare, here per texel), as exposure-corrected; and per channel the same.
- Where the reference is veiled: its broad light (GATE_MM) lifted over that quartile in all three channels (glare adds
  light to every channel; a warmer or cooler white balance lifts some channels and lowers others), as hysteresis
  thresholding finds edges (Canny): the veil is where the lift passes GATE_LIFT[1] and reaches out as far as it stays
  over GATE_LIFT[0]. The far views see the canvas's own bright paint (a face, a collar) with less contrast, which
  lifts the reference a little there; paint the other views themselves see as a local bright feature does not carry
  a veil outward. A veil every view shows (a bloom in the varnish itself) is the canvas's own and stays.
- The veil: the reference's light over the quartile there. The target: the reference's photograph as photographed
  (before the seam levelling's offsets), less its veil. Its colour is the reference's own, and where the veil is most
  of the reference's light, the other views' (their lower quartile per channel, smoothed over COLOUR_MM, in the
  reference's white balance as measured where the reference is itself among the clean views).
- The composite's detail (itself less its low frequencies) is kept in the share of its light the target leaves:
  where the veil was strong, its high frequencies hold the varnish's sparkle as well as the paint.
- Towards the frame: the return to the photograph's level, a smooth field, fades in over RAMP_LEVEL, so it makes no
  step at the frame's gilt slip; the veil's correction reaches INSET from the slip's edge, as the veil does. The frame
  and everything outside the canvas are untouched.

The result is a field per canvas on the wall's 5 mm grid: out = a x composite + b in linear light (a a scalar, b a
colour), sampled bilinearly at any resolution, so the atlas's 2.5 mm orthophoto and the 2 mm detail get the same
correction."""
import os

import numpy as np
from scipy import ndimage

import bestview as B

# The portraits' canvases: the edges of the paint inside each frame's gilt slip, u0, u1 along the wall and v0, v1
# above the floor (metres), located on the S4a build's 2.5 mm orthophoto (measure/locate-canvases.py: the strongest
# step down from the slip to the canvas, 1 cm either side), and whether the veil is taken off (True) or the canvas is
# only returned to its photograph's level (False).
# - fire-portrait, over the fireplace: scan_034 photographed it at 2.2 mm a pixel with a veil over its lower canvas.
# - end-portrait, the end wall's: scan_044's photograph, which the seam levelling took 9.5 levels under on its lower
#   canvas (the darkest of its 37 views there), with a veil of its own on its upper canvas and the floor at its foot
#   that the other views do not show.
# The portraits on the door and window walls were measured the same way and are not changed (README).
CANVASES = {
    'fire': [('fire-portrait', (4.489, 6.116, 1.911, 4.364), True)],
    'end': [('end-portrait', (4.569, 6.069, 2.226, 4.521), True)],
}
INSET = 0.0025           # metres inside the slip's edge (the 2.5 mm sub-samples stay clear of the slip)
RAMP_LEVEL = 0.04        # metres over which the return to the photograph's level fades in
LEVEL_MM = 50.0          # the smoothness of that level, measured where nothing is veiled
LOW_MM = 20.0            # the low frequencies the target sets
REG_MM = (10.0, 60.0)    # the band-pass the views are registered on
REG_MAX = 0.05           # metres: the largest registration shift accepted
QUANTILE = 25            # percent: the canvas without glare is this quantile of the other views (label-views.py's)
GLARE_FREE = 0.10        # lift within which the reference counts as clean (label-views.py's GLARE_FREE)
GATE_MM = 60.0           # the scale at which the reference's lift marks a veil
GATE_LIFT = (0.10, 0.40)  # lift over the quartile: a veil reaches out to the first (GLARE_FREE) from where it passes the second
GATE_SOFT = 0.10         # lift over GATE_LIFT[0] at which the veil counts fully
FEATURE = 0.25           # the other views' local brightening that marks paint, not veil
COLOUR_MM = 60.0         # where the veil dominates, the colour is the other views' lower quartile's, smoothed this far
VIEWS_MIN = 4            # views that must see a texel, the reference's own included
SEEN_MIN = 0.99          # a view counts if it saw this share of the canvas's texels
PITCH = 0.005            # metres a field texel (the wall's 5 mm grid)
MARGIN = 0.05            # metres of each view sampled beyond the canvas, for registration (REG_MAX)


def boxes(wall):
    return CANVASES.get(wall, [])


def extent(grid, box):
    """The canvas, INSET inside its edges, in fractional 5 mm texel positions on the wall's grid: first and last row
    (top to bottom), first and last column. apply() covers exactly this, whatever the grid's phase against the edges."""
    u0, u1, v0, v1 = box
    return [float(grid.row_at(v1 - INSET)), float(grid.row_at(v0 + INSET)), float(grid.col_at(u0 + INSET)), float(grid.col_at(u1 - INSET))]


def box_texels(grid, box):
    """Rows and columns (half-open) of the wall's 5 mm texels whose centres lie INSET inside the canvas's edges."""
    u0, u1, v0, v1 = box
    cols = np.nonzero((grid.ucol >= u0 + INSET) & (grid.ucol < u1 - INSET))[0]
    rows = np.nonzero((grid.vrow >= v0 + INSET) & (grid.vrow < v1 - INSET))[0]
    return int(rows[0]), int(rows[-1]) + 1, int(cols[0]), int(cols[-1]) + 1


def low(x, sigma):
    """Gaussian low-pass (sigma in texels) over the canvas, its edges normalised (nothing beyond them leaks in)."""
    den = ndimage.gaussian_filter(np.ones(x.shape[:2], np.float32), sigma, mode='constant')
    if x.ndim == 2:
        return ndimage.gaussian_filter(x.astype(np.float32), sigma, mode='constant') / den
    return np.stack([ndimage.gaussian_filter(x[..., c].astype(np.float32), sigma, mode='constant') / den for c in range(x.shape[-1])], -1)


def register(ref_lum, lum):
    """The integer texel shift (dy, dx) that best aligns `lum` on `ref_lum` (phase correlation of their band-passed log
    luminance, Hann-windowed), and the correlation peak."""
    h, w = ref_lum.shape
    win = np.outer(np.hanning(h), np.hanning(w)).astype(np.float32)
    s1, s2 = (x / 1000 / PITCH for x in REG_MM)

    def bp(x):
        x = np.log(np.maximum(x, 1e-4))
        return (low(x, s1) - low(x, s2)) * win
    X = np.fft.rfft2(bp(ref_lum)) * np.conj(np.fft.rfft2(bp(lum)))
    X /= np.maximum(np.abs(X), 1e-12)
    c = np.fft.irfft2(X, s=(h, w))
    lim = int(round(REG_MAX / PITCH))
    c[lim + 1:h - lim] = -1
    c[:, lim + 1:w - lim] = -1
    iy, ix = np.unravel_index(np.argmax(c), c.shape)
    return (int(iy - h if iy > h // 2 else iy), int(ix - w if ix > w // 2 else ix)), float(c.max())


def shifted(x, dy, dx):
    """x moved by (dy, dx) texels, its edge repeated (no wrap)."""
    return ndimage.shift(x, (dy, dx) + (0,) * (x.ndim - 2), order=0, mode='nearest')


def masked_low(x, m, sigma):
    """Gaussian low-pass (sigma in texels) of x over the texels m only, normalised (NaN where m has no weight)."""
    den = ndimage.gaussian_filter(m.astype(np.float32), sigma, mode='constant')
    xm = np.where(m[..., None] if x.ndim == 3 else m, x, 0).astype(np.float32)
    if x.ndim == 2:
        num = ndimage.gaussian_filter(xm, sigma, mode='constant')
        return np.where(den > 0.05, num / np.maximum(den, 1e-6), np.nan)
    num = np.stack([ndimage.gaussian_filter(xm[..., c], sigma, mode='constant') for c in range(x.shape[-1])], -1)
    return np.where((den > 0.05)[..., None], num / np.maximum(den, 1e-6)[..., None], np.nan)


def field(views, comp, ref, margin, veil_on=True):
    """The canvas's correction. views (S, h + 2 margin, w + 2 margin, 3): every station that saw the whole canvas, on the
    canvas's 5 mm texels and `margin` texels beyond each edge (so a view moved into register keeps its own canvas);
    comp (h, w, 3): the composite on the canvas's texels; both in linear light; ref: the reference station's index.
    Returns a (h, w), b (h, w, 3) and a report; a and b are None (and the report says why) if too few views agree."""
    S = views.shape[0]
    M = margin
    h, w = comp.shape[:2]
    sig = LOW_MM / 1000 / PITCH
    canvas = np.zeros(views.shape[1:3], bool)
    canvas[M:M + h, M:M + w] = True
    lum = views @ B.LUMA
    others = [s for s in range(S) if s != ref]
    shifts, peaks = [(0, 0)] * S, [1.0] * S
    lows = np.full((S, h, w), np.nan, np.float32)
    rgb_lows = np.full((S, h, w, 3), np.nan, np.float32)
    ref_lum = lum[ref][M:M + h, M:M + w]
    for s in range(S):
        if s != ref:
            shifts[s], peaks[s] = register(ref_lum, lum[s][M:M + h, M:M + w])
        dy, dx = shifts[s]
        # a texel of the moved view counts only if it shows that view's own canvas
        own = ndimage.shift(canvas, (dy, dx), order=0, mode='constant', cval=False)[M:M + h, M:M + w]
        moved = shifted(views[s], dy, dx)[M:M + h, M:M + w]
        rgb_lows[s] = masked_low(moved, own, sig)
        lows[s] = rgb_lows[s] @ B.LUMA
    rep = dict(shifts_mm=[(dy * PITCH * 1000, dx * PITCH * 1000) for dy, dx in shifts], peaks=peaks)
    count = np.isfinite(lows[others]).sum(axis=0)
    if len(others) + 1 < VIEWS_MIN or (count >= VIEWS_MIN - 1).mean() < 0.5:
        rep['reason'] = f'{len(others) + 1} views, {float((count >= VIEWS_MIN - 1).mean()):.2f} of the canvas seen by {VIEWS_MIN - 1} others'
        return None, None, rep
    ref_low = rgb_lows[ref]
    # the canvas as the views that saw it without glare saw it: the other views' lower quartile, per texel
    quart = np.nanpercentile(lows[others], QUANTILE, axis=0).astype(np.float32)
    quart = np.where(count >= VIEWS_MIN - 1, quart, lows[ref])
    # where the reference is lifted over it broadly (GATE_MM), it is veiled; finer, the far views' lower contrast would
    # read the reference's own bright paint (a face, a collar) as lifted, so the veil is taken only there. Glare lifts
    # every channel; a warmer or cooler white balance lifts some and lowers others, so the lift is the least of the
    # three channels' (each against the other views' lower quartile in that channel)
    sg = GATE_MM / 1000 / PITCH
    quart_rgb = np.nanpercentile(rgb_lows[others], QUANTILE, axis=0)
    quart_rgb = np.where(np.isfinite(quart_rgb), quart_rgb, ref_low).astype(np.float32)
    lift = (low(ref_low, sg) / np.maximum(low(quart_rgb, sg), 1e-6)).min(axis=-1) - 1
    # paint the other views themselves see as a local bright feature (a face, a collar, paper: their 20 mm light over
    # their 60 mm by FEATURE or more) does not carry a veil outward unless it is lifted strongly itself
    feature = quart >= (1 + FEATURE) * low(quart, sg)
    weak = (lift >= GATE_LIFT[0]) & ~(feature & (lift < GATE_LIFT[1]))
    lab, n = ndimage.label(weak)
    keep = np.zeros(n + 1, bool)
    keep[np.unique(lab[lift >= GATE_LIFT[1]])] = True
    keep[0] = False
    # the veil's regions, the paint they enclose included, softened over a centimetre; within them the veil counts in
    # proportion to the lift, fully from GATE_LIFT[0] + GATE_SOFT
    region = ndimage.binary_fill_holes(keep[lab]) if veil_on else np.zeros((h, w), bool)
    region = np.clip(ndimage.gaussian_filter(region.astype(np.float32), 0.01 / PITCH), 0, 1)
    gate = np.clip((lift - GATE_LIFT[0]) / GATE_SOFT, 0, 1)
    gate = gate * gate * (3 - 2 * gate) * region
    veil = low(gate * np.maximum(lows[ref] - quart, 0), 1.0)
    # the target's luminance: the reference's less its veil. Its colour: the reference's own where the veil is a small
    # part of its light; where the veil is most of it, what the reference's colour shows is the reflected light's (and
    # a smooth estimate of that leaves coloured residue on the dark paint), so the colour there is the other views'
    # lower quartile's, per channel, smoothed (COLOUR_MM), in the reference's white balance
    t_lum = np.maximum((ref_low @ B.LUMA) - veil, 1e-6)
    clean = (ref_low @ B.LUMA) <= (1 + GLARE_FREE) * quart          # where the reference is itself among the clean views
    wb = np.ones(3)
    if clean.sum() >= 200:
        wb = np.median(ref_low[clean], axis=0) / np.maximum(np.median(quart_rgb[clean], axis=0), 1e-9)
        wb /= float(B.LUMA @ (np.median(quart_rgb[clean], axis=0) * wb)) / float(B.LUMA @ np.median(quart_rgb[clean], axis=0))
    chroma_q = low(quart_rgb * wb[None, None, :].astype(np.float32), COLOUR_MM / 1000 / PITCH)
    chroma_q /= np.maximum(chroma_q @ B.LUMA, 1e-9)[..., None]
    chroma_r = ref_low / np.maximum(ref_low @ B.LUMA, 1e-9)[..., None]
    f = np.clip(veil / np.maximum(ref_low @ B.LUMA, 1e-9), 0, 1)[..., None]
    target = t_lum[..., None] * ((1 - f) * chroma_r + f * chroma_q)
    colour = chroma_q
    comp_low = low(comp, sig)
    share = np.clip((target @ B.LUMA) / np.maximum(comp_low @ B.LUMA, 1e-6), 0, 1)
    share = np.where(veil > 0, share, 1.0).astype(np.float32)
    share = np.clip(low(share, 2.0), 0, 1)
    # Towards the frame: the return to the photograph's level (the smooth difference between the reference and the
    # composite where nothing was veiled) fades in over RAMP_LEVEL from the field's edge, so it makes no step at the
    # frame: C1 = C + r_level x level. The veil's correction reaches the canvas's edge (the veil does, and a band of it
    # left along the slip reads as a pale line): out = C1 + (share - 1)(C1 - low C1) + target1 - low C1, target1 =
    # target - (1 - r_level) level, the target at C1's level. That is a C + b with:
    dist = ndimage.distance_transform_edt(np.pad(np.ones((h, w), bool), 1))[1:-1, 1:-1] * PITCH
    x = np.clip((dist - PITCH) / RAMP_LEVEL, 0, 1)
    rl = (x * x * (3 - 2 * x)).astype(np.float32)
    unveiled = (gate < 0.05).astype(np.float32)
    sl = LEVEL_MM / 1000 / PITCH
    den = ndimage.gaussian_filter(unveiled, sl, mode='constant')
    level = np.stack([ndimage.gaussian_filter(unveiled * (ref_low[..., c] - comp_low[..., c]), sl, mode='constant') for c in range(3)], -1)
    level = np.where((den > 0.02)[..., None], level / np.maximum(den, 1e-6)[..., None], 0).astype(np.float32)
    a = share.astype(np.float32)
    b = (rl[..., None] * level + target - share[..., None] * comp_low - level).astype(np.float32)
    rep.update(veil=veil, veil_colour=colour, bound=quart, gate=gate, lift=lift, target=target, ref_low=ref_low, comp_low=comp_low,
               share=share, ramp=rl, views_per_texel=count)
    return a, b, rep


def apply(fields, r, c, srgb):
    """Applies a wall's canvas fields to colours srgb (n, 3; sRGB 0-255 floats) sampled at fractional 5 mm texel
    positions r, c (texel centres at integers). A field covers its canvas's extent (INSET inside the slip's edges),
    holding its outermost texels' values beyond their centres. Returns new sRGB floats; samples outside every canvas
    are unchanged."""
    out = srgb
    for f in fields:
        r0, r1, c0, c1 = f['box']
        h, w = f['a'].shape
        y = np.asarray(r, np.float64) - r0
        x = np.asarray(c, np.float64) - c0
        e0, e1, e2, e3 = f['extent']
        inside = (np.asarray(r) >= e0) & (np.asarray(r) <= e1) & (np.asarray(c) >= e2) & (np.asarray(c) <= e3)
        if not inside.any():
            continue
        yy, xx = np.clip(y[inside], 0, h - 1), np.clip(x[inside], 0, w - 1)
        y0 = np.minimum(np.floor(yy).astype(np.int64), h - 2)
        x0 = np.minimum(np.floor(xx).astype(np.int64), w - 2)
        ty = (yy - y0).astype(np.float32)
        tx = (xx - x0).astype(np.float32)

        def bil(g):
            t_y, t_x = (ty[:, None], tx[:, None]) if g.ndim == 3 else (ty, tx)
            return (g[y0, x0] * (1 - t_x) + g[y0, x0 + 1] * t_x) * (1 - t_y) + (g[y0 + 1, x0] * (1 - t_x) + g[y0 + 1, x0 + 1] * t_x) * t_y
        lin = B.to_linear(srgb[inside])
        res = B.to_srgb(np.clip(bil(f['a'])[:, None] * lin + bil(f['b']), 0, 1))
        if out is srgb:
            out = srgb.copy()
        out[inside] = res
    return out


def load(proj, wall):
    """The wall's canvas fields written by canvas-veil.py (proj/canvas-<wall>.npz), or [] if the wall has none."""
    path = os.path.join(proj, f'canvas-{wall}.npz')
    if not os.path.exists(path):
        return []
    z = np.load(path)
    return [dict(name=str(n), box=tuple(int(x) for x in z[f'{n}.box']), extent=tuple(float(x) for x in z[f'{n}.extent']),
                 a=z[f'{n}.a'], b=z[f'{n}.b']) for n in z['names']]
