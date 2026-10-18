"""Find how the native E57 skybox faces map to world directions, using the twin's world-aligned 512 px
equirect of the same station as the reference. Hypothesis: world = R(q) * local, q = manifest pose.q (w, x, y, z)."""
import sys, json, itertools; sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import numpy as np
from PIL import Image
from common import *
CUBE = __import__("os").environ.get("E57_CUBE_FACES", "work/cube-faces/")
S, m = stations()
def qmat(q, conj=False):
    w, x, y, z = q
    if conj: x, y, z = -x, -y, -z
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
def sample(img, v):
    H, W = img.shape[:2]
    az = np.arctan2(v[:, 1], v[:, 0]) % (2 * np.pi); el = np.arctan2(v[:, 2], np.hypot(v[:, 0], v[:, 1]))
    fx = np.clip((az / (2 * np.pi) * W).astype(int), 0, W - 1); fy = np.clip(((np.pi / 2 - el) / np.pi * H).astype(int), 0, H - 1)
    return img[fy, fx]
# 24 proper rotations as (forward, right, up) of the image
axes = [np.array(a, float) for a in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1))]
orients = []
for f in axes:
    for u in axes:
        if abs(f @ u) > 0.5: continue
        r = np.cross(f, u)  # right-handed image: right = forward x up
        orients.append((f, r, u))
for mirror in (False, True):
    pass
def face_dirs(n, f, r, u, mirror=False):
    t = (np.arange(n) + 0.5) / n * 2 - 1
    xx, yy = np.meshgrid(t, -t)  # image x right, image y down -> up = -y
    if mirror: xx = -xx
    return (f[None, None] + xx[..., None] * r[None, None] + yy[..., None] * u[None, None]).reshape(-1, 3)
sid = int(sys.argv[1]) if len(sys.argv) > 1 else 58
st = S[sid]
eq = np.asarray(Image.open(PANO + st["id"] + ".webp").convert("L")).astype(np.float32)
files = sorted(f for f in __import__("os").listdir(CUBE + st["id"]) if f.endswith(".jpg"))
res = {}
for conj in (False, True):
    R = qmat(st["q"], conj)
    for fi, fn in enumerate(files):
        im = Image.open(CUBE + st["id"] + "/" + fn).convert("L").resize((96, 96), Image.BILINEAR)
        a = np.asarray(im).astype(np.float32).ravel(); a = (a - a.mean()) / (a.std() + 1e-6)
        best = []
        for oi, (f, r, u) in enumerate(orients):
            for mir in (False, True):
                v = face_dirs(96, f, r, u, mir) @ R.T
                b = sample(eq, v); b = (b - b.mean()) / (b.std() + 1e-6)
                best.append((float((a * b).mean()), oi, mir))
        best.sort(reverse=True)
        c, oi, mir = best[0]
        f, r, u = orients[oi]
        res.setdefault(conj, []).append((fn, round(c, 3), f.tolist(), r.tolist(), u.tolist(), mir, round(best[1][0], 3)))
for conj, rows in res.items():
    print("conjugate" if conj else "q as given", "mean best corr", round(np.mean([r[1] for r in rows]), 3))
    for r in rows: print("   ", r)
