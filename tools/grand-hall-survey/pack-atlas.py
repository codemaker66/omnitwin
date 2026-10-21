"""Packs the four wall orthophotos into the wall atlas (hall-atlas.ts layout).

Fills the few texels no panorama saw, patches movable equipment (speakers,
a lectern, an equipment rack) out with matching panelling copied from the
same wall, and resamples every wall to the atlas scale. The window wall's glass
mask (window-relief.py) goes into the alpha channel.

Where project-walls.py --labels wrote a wall's 2.5 mm orthophoto
(proj/<view>.fine.npz), its colour comes from that, so it reaches the atlas's
5.2 mm through one Lanczos reduction: going through the 5 mm orthophoto first
(two reductions) left a third as many of the deacon boards' names legible.
The patches are the same in metres, and the glass mask is the 5 mm one.

With --alpha-from <dir>, the alpha channel is the one of <dir>/walls-4096.webp (the published atlas)
instead of window-relief.py's mask: a rebuild of the walls' colour keeps the glass that the windows'
panes, and their measurements, were made against. (The best-view photograph moved window-relief's
colour test: 10,830 texels of the published glass, a median 28 mm in from its edge, read as opaque.)
Usage (in the work directory): python3 $SURVEY/pack-atlas.py [--alpha-from <dir>]
Writes proj/walls-4096.webp and proj/walls-2048.webp."""
import os, sys, json, numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
SRC_PPM = 200.0
SRC_TOP = 7.0          # v at the top edge of the orthophotos
L, W = 21.135, 10.59
SIZE = 4096
PPM = (SIZE / 2) / W
V_MIN, V_MAX = -0.02, 6.72
ROW = int(np.ceil((V_MAX - V_MIN) * PPM))
ORIGIN = {'window': (0, 0), 'door': (0, ROW), 'end': (0, 2 * ROW), 'fire': (SIZE // 2, 2 * ROW)}
LENGTH = {'window': L, 'door': L, 'end': W, 'fire': W}
# (wall, dst u0, u1, v0, v1, mode, arg): mode 'shift' copies from u + arg; 'mirror' reflects about u = arg
door_u = lambda scan_x: L / 2 - 8.795 + scan_x
DOOR_END, DOOR_FIRE = door_u(-0.025), door_u(17.665)
PATCHES = [
    ('window', 0.0, 0.8, 0.0, 1.6, 'mirror', L / 2),
    ('door', 0.0, 0.75, 0.0, 1.54, 'shift', 2.72),
    # The end door stood open: give it the fireplace-end door's closed leaves.
    ('door', DOOR_END - 0.54, DOOR_END + 0.54, 0.0, 2.35, 'shift', DOOR_FIRE - DOOR_END),
    ('end', 10.12, 10.59, 0.3, 1.48, 'shift', -1.06),
    ('fire', 3.15, 3.58, 0.0, 1.48, 'mirror', 5.332),
    ('fire', 9.6, 10.59, 0.0, 1.72, 'shift', -3.18),
]

def load(wall):
    """The wall's orthophoto (sRGB floats), the texels that carry colour, and texels per 5 mm (1, or
    2 for the best-view build's 2.5 mm orthophoto)."""
    tiles = range(4 if LENGTH[wall] > 15 else 2)
    if all(os.path.exists(f'proj/wall-{wall}-{t}.fine.npz') for t in tiles):
        d = [np.load(f'proj/wall-{wall}-{t}.fine.npz') for t in tiles]
        img = np.concatenate([x['rgb8'] for x in d], axis=1).astype(np.float32)
        valid = np.concatenate([x['valid'] for x in d], axis=1)
        return img, valid, 2
    d = [np.load(f'proj/wall-{wall}-{t}.npz') for t in tiles]
    from project import linear_to_srgb
    rgb = np.concatenate([x['rgb'] for x in d], axis=1)
    weight = np.concatenate([x['weight'] for x in d], axis=1)
    valid = np.concatenate([x['valid'] for x in d], axis=1) & (weight > 0)
    img = linear_to_srgb(rgb).astype(np.float32)
    return img, valid, 1

def fill_sparse(img, valid, passes):
    """fill(), visiting only the texels still empty (the fine orthophoto is too large to copy whole
    each pass); edges do not wrap."""
    H, W = valid.shape
    img = img.copy(); valid = valid.copy()
    for _ in range(passes):
        ys, xs = np.nonzero(~valid)
        if not len(ys): break
        acc = np.zeros((len(ys), 3), np.float32); cnt = np.zeros(len(ys), np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = ys - dy, xs - dx
            ok = (ny >= 0) & (ny < H) & (nx >= 0) & (nx < W)
            ny, nx = np.clip(ny, 0, H - 1), np.clip(nx, 0, W - 1)
            sv = ok & valid[ny, nx]
            acc += img[ny, nx] * sv[:, None]; cnt += sv
        grow = cnt > 0
        img[ys[grow], xs[grow]] = acc[grow] / cnt[grow][:, None]
        valid[ys[grow], xs[grow]] = True
    if not valid.all():
        img[~valid] = img[valid].mean(axis=0)
    return img

def fill(img, valid, passes=40):
    """Grow valid colour into invalid texels (simple 4-neighbour dilation)."""
    img = img.copy(); valid = valid.copy()
    for _ in range(passes):
        if valid.all(): break
        acc = np.zeros_like(img); cnt = np.zeros(valid.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sv = np.roll(valid, (dy, dx), (0, 1)); si = np.roll(img, (dy, dx), (0, 1))
            acc += si * sv[..., None]; cnt += sv
        grow = (~valid) & (cnt > 0)
        img[grow] = acc[grow] / cnt[grow][:, None]
        valid = valid | grow
    if not valid.all():
        img[~valid] = img[valid].mean(axis=0)
    return img

def px(u, v, ppm=SRC_PPM):
    return int(round(u * ppm)), int(round((SRC_TOP - v) * ppm))

def patch(img, u0, u1, v0, v1, mode, arg, length, feather=10, ppm=SRC_PPM):
    c0, r1 = px(u0, v0, ppm); c1, r0 = px(u1, v1, ppm)
    if mode == 'shift':
        s0 = int(round((u0 + arg) * ppm)); src = img[r0:r1, s0:s0 + (c1 - c0)].copy()
    else:
        m0 = int(round((2 * arg - u1) * ppm)); src = img[r0:r1, m0:m0 + (c1 - c0)][:, ::-1].copy()
    h, w = src.shape[:2]
    # Feather the seams, except along the wall's own ends and the floor.
    ramp = lambda n: np.clip(np.arange(n) / feather, 0, 1)
    wx = np.ones(w); wy = np.ones(h)
    if u0 > 0.01: wx = np.minimum(wx, ramp(w))
    if u1 < length - 0.01: wx = np.minimum(wx, ramp(w)[::-1])
    wy = np.minimum(wy, ramp(h))
    if v0 > 0.01: wy = np.minimum(wy, ramp(h)[::-1])
    alpha = np.minimum.outer(wy, wx)[..., None]
    img[r0:r1, c0:c1] = img[r0:r1, c0:c1] * (1 - alpha) + src * alpha
    return img

atlas = np.zeros((SIZE, SIZE, 3), np.float32)
# Alpha carries the glass mask (glazing seen between the curtains): opaque
# everywhere else, half where the photograph shows the view out.
alpha = np.full((SIZE, SIZE), 255.0, np.float32)
glass = np.load('proj/window-glass.npy').astype(np.float32)
for wall in ['window', 'door', 'end', 'fire']:
    img, valid, scale = load(wall)
    img = fill(img, valid) if scale == 1 else fill_sparse(img, valid, 40 * scale)
    ppm = SRC_PPM * scale
    for p in PATCHES:
        if p[0] == wall: img = patch(img, *p[1:], LENGTH[wall], feather=10 * scale, ppm=ppm)
    width_src = int(round(LENGTH[wall] * SRC_PPM))
    r_top = int(round((SRC_TOP - V_MAX) * SRC_PPM)); r_bot = int(round((SRC_TOP - V_MIN) * SRC_PPM))
    crop = img[r_top * scale:r_bot * scale, :width_src * scale]
    shape = crop.shape
    w_dst = int(np.ceil(LENGTH[wall] * PPM))
    im = Image.fromarray(np.clip(crop, 0, 255).astype(np.uint8)).resize((w_dst, ROW), Image.LANCZOS)
    del img, crop
    x0, y0 = ORIGIN[wall]
    atlas[y0:y0 + ROW, x0:x0 + w_dst] = np.asarray(im, np.float32)
    if wall == 'window':
        g = Image.fromarray((glass[r_top:r_bot, :width_src] * 255).astype(np.uint8)).resize((w_dst, ROW), Image.BILINEAR)
        alpha[y0:y0 + ROW, x0:x0 + w_dst] = 255 - np.asarray(g, np.float32) / 255 * 127
    print(wall, shape, '->', (ROW, w_dst), 'at', (x0, y0), flush=True)
# the unused bottom strip repeats the last rows (keeps mipmaps clean)
atlas[3 * ROW:] = atlas[3 * ROW - 1]
if '--alpha-from' in sys.argv:
    previous = os.path.join(sys.argv[sys.argv.index('--alpha-from') + 1], 'walls-4096.webp')
    alpha = np.asarray(Image.open(previous).convert('RGBA'), np.float32)[..., 3]
    print('alpha from', previous, 'glass texels', int((alpha < 192).sum()), flush=True)
rgba = np.dstack([atlas, alpha]).astype(np.uint8)
out = Image.fromarray(rgba, 'RGBA')
out.save('proj/walls-4096.png')
out.save('proj/walls-4096.webp', quality=86, alpha_quality=90, method=6)
out.resize((2048, 2048), Image.LANCZOS).save('proj/walls-2048.webp', quality=86, alpha_quality=90, method=6)
print({f: round(os.path.getsize(f'proj/{f}') / 1e6, 2) for f in ['walls-4096.webp', 'walls-2048.webp']})
