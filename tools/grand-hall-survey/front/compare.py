"""Lay the photo-match render's edges on photograph A's (photomatch.mjs; README "The front").

Usage: python tools/grand-hall-survey/front/compare.py <photomatch dir> [<photograph>]

Turns the pitched render level about its camera's centre (H = K R K^-1) and keeps the photograph's
1400 x 990 frame (the level render's horizon is its centre row, the photograph's row 731.1, at the
same focal length), then writes into the folder:
  render.png   the level render, framed as the photograph
  blend.png    the two half and half
  edges.png    the photograph's edges red, the render's cyan (white where they meet)
  compare.json the chamfer distance from each image's edges to the other's over the front, the rows
               of four skyline lines in each, and the 2D similarity (a scale about the principal point
               on the horizon, and a shift) that best lays the render's edges on the photograph's:
               about 1 when the camera's distance is right, since the front is nearly a plane.
"""
import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[3]
out = Path(sys.argv[1])
photo_path = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "packages/web/public/images/venue/grand-hall-facade-3.jpg"
cam = json.loads((out / "camera.json").read_text(encoding="utf-8"))
render = cv2.imread(str(out / "render-full.png"))
photo = cv2.imread(str(photo_path))
if render is None or photo is None:
    sys.exit(f"compare.py: cannot read {out / 'render-full.png'} or {photo_path}")
H_img, W_img = render.shape[:2]
focal = (H_img / 2) / math.tan(math.radians(cam["camera"]["fov"]) / 2)
cx, cy = W_img / 2, H_img / 2
forward = np.array(cam["camera"]["forward"], float)
pitch = -math.asin(forward[1] / np.linalg.norm(forward))  # positive when the camera looks down


def level_pixel(u, v):
    # A ray through the pitched camera's pixel, turned level about the camera's x axis.
    d = np.array([(u - cx) / focal, -(v - cy) / focal, -1.0])
    c, s = math.cos(-pitch), math.sin(-pitch)
    e = np.array([[1, 0, 0], [0, c, -s], [0, s, c]]) @ d
    return cx + focal * e[0] / -e[2], cy - focal * e[1] / -e[2]


src = np.float32([[0, 0], [W_img, 0], [W_img, H_img], [0, H_img]])
dst = np.float32([level_pixel(u, v) for u, v in src])
level = cv2.warpPerspective(render, cv2.getPerspectiveTransform(src, dst), (W_img, H_img))
top = int(round(cy - cam["horizon"]))
crop = level[top:top + photo.shape[0], :photo.shape[1]]
cv2.imwrite(str(out / "render.png"), crop)
cv2.imwrite(str(out / "blend.png"), cv2.addWeighted(photo, 0.5, crop, 0.5, 0))

gray_p = cv2.GaussianBlur(cv2.cvtColor(photo, cv2.COLOR_BGR2GRAY), (3, 3), 0)
gray_r = cv2.GaussianBlur(cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY), (3, 3), 0)
edge_p = cv2.Canny(gray_p, 60, 150)
edge_r = cv2.Canny(gray_r, 40, 110)
overlay = np.zeros_like(photo)
overlay[..., 2] = edge_p
overlay[..., 0] = edge_r
overlay[..., 1] = edge_r
cv2.imwrite(str(out / "edges.png"), cv2.addWeighted(photo, 0.35, overlay, 0.9, 0))

# The front's own part of the frame (the photograph's crop of it).
mask = np.zeros_like(edge_p)
mask[300:900, 140:1270] = 1
dist_p = cv2.distanceTransform((edge_p == 0).astype(np.uint8), cv2.DIST_L2, 3)
dist_r = cv2.distanceTransform((edge_r == 0).astype(np.uint8), cv2.DIST_L2, 3)


def stats(values):
    if values.size == 0:
        return None
    return {"n": int(values.size), "median_px": float(np.median(values)), "p75_px": float(np.percentile(values, 75)),
            "within_3px": float(np.mean(values <= 3))}


# Horizontal lines on the skyline: the strongest horizontal edge within 25 px of the row the spec's
# heights put each at from this camera, per image.
sobel_p = np.abs(cv2.Sobel(gray_p, cv2.CV_32F, 0, 1, ksize=3))
sobel_r = np.abs(cv2.Sobel(gray_r, cv2.CV_32F, 0, 1, ksize=3))
lines = {
    "end-bay balustrade top 12.02 m": (452.5, (150, 250)),
    "links' balustrade top 14.11 m": (376.0, (480, 560)),
    "rosette attic top 14.69 m": (353.0, (600, 800)),
    "pavilion parapet top 14.95 m": (339.5, (300, 450)),
}
rows = {}
for name, (row, (u0, u1)) in lines.items():
    lo, hi = int(row) - 25, int(row) + 25
    photo_row = lo + int(np.argmax(sobel_p[lo:hi, u0:u1].mean(axis=1)))
    render_row = lo + int(np.argmax(sobel_r[lo:hi, u0:u1].mean(axis=1)))
    rows[name] = {"photo_row": photo_row, "render_row": render_row, "render_minus_photo_px": render_row - photo_row}

# The similarity that best lays the render's edges on the photograph's (mean distance, capped at 20 px).
ys, xs = np.nonzero((edge_r > 0) & (mask > 0))
xs, ys = xs.astype(np.float64), ys.astype(np.float64)
pcx, pcy = photo.shape[1] / 2, cam["horizon"]


def mean_distance(s, tx, ty):
    u = pcx + s * (xs - pcx) + tx
    v = pcy + s * (ys - pcy) + ty
    ok = (u >= 0) & (u < photo.shape[1] - 1) & (v >= 0) & (v < photo.shape[0] - 1)
    return float(np.mean(np.minimum(dist_p[v[ok].astype(int), u[ok].astype(int)], 20)))


best = min(((mean_distance(s, tx, ty), s, tx, ty) for s in np.arange(0.97, 1.0601, 0.0025)
            for tx in np.arange(-8, 8.1, 1.0) for ty in np.arange(-12, 12.1, 1.0)))
_, s0, tx0, ty0 = best
best = min(((mean_distance(s, tx, ty), s, tx, ty) for s in np.arange(s0 - 0.003, s0 + 0.0031, 0.0005)
            for tx in np.arange(tx0 - 1, tx0 + 1.01, 0.25) for ty in np.arange(ty0 - 1, ty0 + 1.01, 0.25)))

result = {
    "backend": cam.get("backend"),
    "camera_z": cam["camera"]["position"][2],
    "pitch_deg": math.degrees(pitch),
    "focal_px": focal,
    "render_edges_to_photo": stats(dist_p[(edge_r > 0) & (mask > 0)]),
    "photo_edges_to_render": stats(dist_r[(edge_p > 0) & (mask > 0)]),
    "rows": rows,
    "similarity": {"scale": float(best[1]), "tx_px": float(best[2]), "ty_px": float(best[3]), "mean_capped_px": best[0]},
    "px_per_m_at_the_links_face": focal / (-cam["camera"]["position"][2] - 6.312),
}
(out / "compare.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
print(json.dumps(result, indent=1))
