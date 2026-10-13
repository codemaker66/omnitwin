"""Measurement helpers over the Matterport dollhouse mesh (E57 frame, Z up, metres)."""
import json
import os
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.getcwd(), "data")
MESH = os.path.join(DATA, "mesh")


def load_mesh():
    pos = np.fromfile(os.path.join(MESH, "positions.f32"), dtype=np.float32).reshape(-1, 3).astype(np.float64)
    idx = np.fromfile(os.path.join(MESH, "indices.u32"), dtype=np.uint32).reshape(-1, 3)
    uv = np.fromfile(os.path.join(MESH, "uvs.f32"), dtype=np.float32).reshape(-1, 2)
    chunk = np.fromfile(os.path.join(MESH, "chunks.u16"), dtype=np.uint16)
    return pos, idx, uv, chunk


def triangles(pos, idx):
    a, b, c = pos[idx[:, 0]], pos[idx[:, 1]], pos[idx[:, 2]]
    n = np.cross(b - a, c - a)
    area2 = np.linalg.norm(n, axis=1)
    normal = n / np.maximum(area2[:, None], 1e-12)
    return a, b, c, normal, area2 / 2


def stations():
    m = json.load(open(os.path.join(DATA, "manifest.json")))
    out = {}
    for node in m["nodes"]:
        out[node["id"]] = (np.array(node["pose"]["t"]), np.array(node["pose"]["q"]))
    return out


def crop(a, b, c, lo, hi):
    """Triangles with any vertex inside the axis-aligned box."""
    def inside(p):
        return np.all((p >= lo) & (p <= hi), axis=1)
    return inside(a) | inside(b) | inside(c)


def plane_section(a, b, c, origin, normal):
    """Segments where triangles cross the plane n·(p - o) = 0. Returns (k, 2, 3)."""
    da = (a - origin) @ normal
    db = (b - origin) @ normal
    dc = (c - origin) @ normal
    segs = []
    for (p, dp), (q, dq), (r, dr) in [((a, da), (b, db), (c, dc))]:
        pass
    s = np.stack([da, db, dc], axis=1)
    sign = np.sign(s)
    crosses = (sign.max(axis=1) > 0) & (sign.min(axis=1) < 0)
    verts = [a, b, c]
    d = [da, db, dc]
    pts = []
    for i, j in [(0, 1), (1, 2), (2, 0)]:
        di, dj = d[i], d[j]
        edge = crosses & (np.sign(di) != np.sign(dj)) & (np.sign(di) != 0) & (np.sign(dj) != 0)
        t = np.where(edge, di / np.where(edge, di - dj, 1), 0)
        p = verts[i] + (verts[j] - verts[i]) * t[:, None]
        pts.append((edge, p))
    out = []
    for k in np.nonzero(crosses)[0]:
        found = [p[k] for e, p in pts if e[k]]
        if len(found) >= 2:
            out.append((found[0], found[1]))
    return np.array(out) if out else np.zeros((0, 2, 3))


def draw_segments(segs2d, lo, hi, scale, path, grid=1.0, marks=None, width=1):
    """Draws 2-D segments (k,2,2) into an image with a metric grid."""
    w = int((hi[0] - lo[0]) * scale) + 1
    h = int((hi[1] - lo[1]) * scale) + 1
    im = Image.new("RGB", (w, h), (255, 255, 255))
    dr = ImageDraw.Draw(im)

    def px(p):
        return ((p[0] - lo[0]) * scale, (hi[1] - p[1]) * scale)

    g = np.floor(lo[0] / grid) * grid
    while g <= hi[0]:
        x = (g - lo[0]) * scale
        dr.line([(x, 0), (x, h)], fill=(225, 225, 235) if abs(g - round(g)) > 1e-6 else (200, 200, 220))
        g += grid
    g = np.floor(lo[1] / grid) * grid
    while g <= hi[1]:
        y = (hi[1] - g) * scale
        dr.line([(0, y), (w, y)], fill=(225, 225, 235) if abs(g - round(g)) > 1e-6 else (200, 200, 220))
        g += grid
    for s in segs2d:
        dr.line([px(s[0]), px(s[1])], fill=(20, 20, 20), width=width)
    if marks:
        for (p, label, col) in marks:
            x, y = px(p)
            dr.ellipse([x - 3, y - 3, x + 3, y + 3], outline=col, width=2)
            if label:
                dr.text((x + 4, y - 6), label, fill=col)
    im.save(path)
    return im


def quat_to_matrix(q):
    w, x, y, z = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
        [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
        [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
    ])
