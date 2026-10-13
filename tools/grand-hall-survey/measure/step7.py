import os, sys, numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from buffers import load
FLOOR = 0.045
# wall plane (interior) and which axis is depth / along
WALLS = {
  'elev-window': dict(axis=1, plane=-10.255, inward=+1, along=0),
  'elev-door':   dict(axis=1, plane=0.335, inward=-1, along=0),
  'elev-fire':   dict(axis=0, plane=-1.775, inward=+1, along=1),
  'elev-end':    dict(axis=0, plane=19.36, inward=-1, along=1),
}
def relief(name):
    cfg = WALLS[name]
    v, P = load(name)
    valid = P[..., 3] > 0.5
    D = P[..., cfg['axis']]
    off = (D - cfg['plane']) * cfg['inward']   # + = protrudes into the room, - = recessed
    H, W = off.shape
    img = np.zeros((H, W, 3), np.uint8)
    o = np.clip(off, -0.6, 0.6)
    # protrusion: warm; recess: blue; plane: grey
    img[..., 0] = np.where(valid, np.clip(128 + o * 400, 0, 255), 0)
    img[..., 1] = np.where(valid, np.clip(128 - np.abs(o) * 150, 0, 255), 0)
    img[..., 2] = np.where(valid, np.clip(128 - o * 400, 0, 255), 0)
    im = Image.fromarray(img)
    # metric grid every 0.5 m, using the position buffer's own coordinates at the plane
    dr = ImageDraw.Draw(im)
    alongs = np.nanmedian(np.where(valid, P[..., cfg['along']], np.nan), axis=0)
    zs = np.nanmedian(np.where(valid, P[..., 2], np.nan), axis=1)
    for c in range(1, W):
        a0, a1 = alongs[c - 1], alongs[c]
        if np.isnan(a0) or np.isnan(a1): continue
        for g in np.arange(-3, 22, 0.5):
            if (a0 - g) * (a1 - g) <= 0 and a0 != a1:
                dr.line([(c, 0), (c, H)], fill=(255, 255, 255) if abs(g - round(g)) < 1e-6 else (90, 90, 90))
                if abs(g - round(g)) < 1e-6: dr.text((c + 2, 2), f'{g:.0f}', fill=(255, 255, 0))
    for r in range(1, H):
        z0, z1 = zs[r - 1], zs[r]
        if np.isnan(z0) or np.isnan(z1): continue
        for g in np.arange(0, 9.5, 0.5):
            zz = g + FLOOR
            if (z0 - zz) * (z1 - zz) <= 0 and z0 != z1:
                dr.line([(0, r), (W, r)], fill=(255, 255, 255) if abs(g - round(g)) < 1e-6 else (90, 90, 90))
                if abs(g - round(g)) < 1e-6: dr.text((2, r - 12), f'h{g:.0f}', fill=(255, 255, 0))
    im.save(f'analysis/relief-{name}.png')
    np.save(f'analysis/off-{name}.npy', np.where(valid, off, np.nan).astype(np.float32))
    np.save(f'analysis/along-{name}.npy', P[..., cfg['along']].astype(np.float32))
    np.save(f'analysis/z-{name}.npy', (P[..., 2] - FLOOR).astype(np.float32))
for n in WALLS: relief(n)
print('ok')
