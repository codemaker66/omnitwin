import sys, json; sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from common import *
S, m = stations()
OL = json.load(open(OUT + "/scripts/outlines.json"))
acc = np.load(OUT + "/scripts/raster_band1.0-1.6.npy")  # 1 cm, box X -7.5..4.5, Y 0..15
X0, X1, Y0, Y1 = -6.6, 8.0, 0.5, 14.4
K = 100  # px per m
W, H = int((X1 - X0) * K), int((Y1 - Y0) * K)
def px(X, Y): return ((X - X0) * K, (Y1 - Y) * K)
# background: slice raster resampled
c0 = int((X0 + 7.5) * 100); r0 = int((15 - Y1) * 100)
sub = acc[r0:r0 + H, c0:c0 + W]
bg = np.full((H, W), 255, np.uint8); bg[:sub.shape[0], :sub.shape[1]] = (255 - np.clip(sub / 3 * 140, 0, 140)).astype(np.uint8)
im = Image.fromarray(bg).convert("RGB"); d = ImageDraw.Draw(im)
try: F = ImageFont.truetype("arial.ttf", 13); Fb = ImageFont.truetype("arialbd.ttf", 15)
except Exception: F = Fb = None
for gx in np.arange(np.ceil(X0), X1, 1.0):
    d.line([px(gx, Y0), px(gx, Y1)], fill=(225, 225, 240)); d.text((px(gx, Y1)[0] + 2, 2), f"X {gx:.0f}", fill=(120, 120, 160), font=F)
for gy in np.arange(np.ceil(Y0), Y1, 1.0):
    d.line([px(X0, gy), px(X1, gy)], fill=(225, 225, 240)); d.text((2, px(X0, gy)[1] + 2), f"Y {gy:.0f}", fill=(120, 120, 160), font=F)
# ceiling coffers and panels (faint)
cp = json.load(open(OUT + "/scripts/ceiling_parts.json"))
for c in cp["coffers"]:
    x, y = px(c["cx"], c["cy"]); r = 0.31 * K
    d.ellipse([x - r, y - r, x + r, y + r], outline=(210, 200, 235))
for sq in cp["squares"] + cp["raised"]:
    a, b = px(sq["x"][0], sq["y"][1]), px(sq["x"][1], sq["y"][0]); d.rectangle([a, b], outline=(210, 200, 235))
# outlines
def poly(pts, col, w, dash=False):
    P = [px(x, y) for x, y in pts] + [px(*pts[0])]
    if not dash: d.line(P, fill=col, width=w); return
    for (a, b) in zip(P[:-1], P[1:]):
        L = np.hypot(b[0] - a[0], b[1] - a[1]); n = max(1, int(L / 8))
        for i in range(0, n, 2):
            t0, t1 = i / n, min(1, (i + 1) / n)
            d.line([(a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0), (a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1)], fill=col, width=w)
poly(OL["pedestal / floor line (0.3-1.0 m fits)"]["e57"], (40, 150, 60), 2, dash=True)
poly(OL["plaster (3.4-5.2 m fits)"]["e57"], (60, 90, 220), 1)
poly(OL["panelling (wall face, 1.6-2.8 m fits)"]["e57"], (210, 30, 30), 3)
# window bays: pier face to glass
for cy, w in ((4.926, 1.90), (7.499, 1.88), (10.075, 1.90)):
    pts = [(1.669, cy - w / 2), (2.215, cy - 0.83), (2.215, cy + 0.83), (1.669, cy + w / 2)]
    d.line([px(*p) for p in pts], fill=(230, 120, 0), width=3)
    d.line([px(2.215, cy - 0.81), px(2.215, cy + 0.81)], fill=(80, 170, 255), width=5)
    d.text((px(2.3, cy)[0], px(2.3, cy)[1] - 8), f"bay {w:.2f} w\nglass X 2.215\nsill 1.20 spring 4.44\napex 5.39", fill=(200, 90, 0), font=F)
# doors
doors = [("D1 1.10 open (to GH lobby)", "Y", 1.470, -0.555, 0.545), ("D3 1.19", "Y", 1.470, -4.675, -3.485), ("D2 1.12 open (passage)", "X", 1.429, 1.80, 2.92),
         ("D6 1.09 (Stair 8)", "X", 1.475, 12.125, 13.215), ("D4 1.23", "X", -5.626, 12.10, 13.325), ("D5 1.22", "X", -5.579, 1.81, 3.025)]
for lab, ax, off, a, b in doors:
    if ax == "Y": p0, p1 = px(a, off), px(b, off); tp = (min(p0[0], p1[0]), p0[1] + 6)
    else: p0, p1 = px(off, a), px(off, b); tp = (p0[0] + (8 if off < 0 else -8 - 7 * len(lab)), min(p0[1], p1[1]) + 10)
    d.line([p0, p1], fill=(255, 255, 255), width=7); d.line([p0, p1], fill=(150, 0, 150), width=3)
    d.text(tp, lab, fill=(150, 0, 150), font=F)
# open leaf of D1
d.line([px(-0.58, 1.55), px(-1.25, 2.45)], fill=(150, 0, 150), width=2)
# chimneypiece and hearth
d.rectangle([px(-5.804, 8.75), px(-5.66, 6.30)], outline=(90, 90, 90), width=2)
d.rectangle([px(-6.0, 8.16), px(-5.804, 6.925)], fill=(60, 60, 60))
d.rectangle([px(-5.804, 8.87), px(-5.21, 6.29)], outline=(140, 110, 60), width=1)
d.text(px(-5.15, 8.3), "chimneypiece\nshelf 1.55, Y 6.30-8.75\nopening 1.24 x 0.99\nhearth/fender 0.59 deep", fill=(70, 70, 70), font=F)
# electroliers
for (x, y, lo) in ((-2.096, 4.882, 3.62), (-2.111, 10.189, 3.61)):
    a, b = px(x, y); r = 0.70 * K
    d.ellipse([a - r, b - r, a + r, b + r], outline=(200, 160, 0), width=3); d.ellipse([a - 4, b - 4, a + 4, b + 4], fill=(200, 160, 0))
    d.text((a + 18, b - 62), f"electrolier\nlowest {lo:.2f} m\nreach 0.70", fill=(150, 110, 0), font=F)
# movable items
for lab, (xa, xb, ya, yb) in (("piano (movable)", (-5.58, -4.06, 11.71, 13.62)), ("console table", (-3.32, -1.0, 1.50, 1.85))):
    a, b = px(xa, yb), px(xb, ya); d.rectangle([a, b], outline=(120, 120, 120), width=2)
    for k in range(int(a[0]), int(b[0]), 10): d.line([(k, a[1]), (min(k + 10, b[0]), b[1])], fill=(170, 170, 170))
    d.text((a[0] + 4, a[1] + 4), lab, fill=(90, 90, 90), font=F)
# stations
for i in range(48, 75):
    x, y = px(*S[i]["t"][:2]); d.ellipse([x - 5, y - 5, x + 5, y + 5], fill=(0, 150, 0)); d.text((x + 6, y - 7), str(i), fill=(0, 110, 0), font=F)
# planner axes at origin
ox, oy = px(-2.065, 7.565)
d.line([(ox, oy), px(-2.065, 6.565)], fill=(0, 0, 0), width=2); d.text((px(-2.065, 6.565)[0] + 4, px(-2.065, 6.565)[1] - 6), "+x (101.1 deg true)", fill=(0, 0, 0), font=F)
d.line([(ox, oy), px(-1.065, 7.565)], fill=(0, 0, 0), width=2); d.text((px(-1.065, 7.565)[0] - 30, px(-1.065, 7.565)[1] + 4), "-z (11.1 deg)", fill=(0, 0, 0), font=F)
d.ellipse([ox - 4, oy - 4, ox + 4, oy + 4], outline=(0, 0, 0), width=2)
# legend and scale
lg = [((210, 30, 30), "config outline = panelling face 1.6-2.8 m: 12.19 x 7.47 (ends 7.01), 89.3 m2"), ((60, 90, 220), "plaster face 3.4-5.2 m: 12.22 x 7.52 (ends 7.05)"),
      ((40, 150, 60), "pedestal / floor line 0.3-1.0 m: 12.13 x 7.35 (ends 6.88), 87.0 m2"), ((230, 120, 0), "window bay reveal (glass in blue)"), ((150, 0, 150), "doors (leaf / clear width, m)"),
      ((0, 150, 0), "stations 48-74"), ((140, 140, 140), "grey: mesh section 1.0-1.6 m; lilac: ceiling coffers and raised panels")]
LX = int(px(3.6, 0)[0]); y = H - 20 * len(lg) - 60
d.rectangle([LX - 6, y - 26, W - 6, H - 8], fill=(255, 255, 255), outline=(180, 180, 180))
d.text((LX, y - 22), "Saloon, E57 frame (+X right, +Y up), 1 m grid", fill=(0, 0, 0), font=Fb)
for col, t in lg:
    d.line([(LX, y + 8), (LX + 30, y + 8)], fill=col, width=3); d.text((LX + 38, y), t, fill=(0, 0, 0), font=F); y += 20
d.line([(LX, H - 22), (LX + 2 * K, H - 22)], fill=(0, 0, 0), width=3); d.text((LX + 2 * K + 6, H - 30), "2 m", fill=(0, 0, 0), font=F)
im.save(OUT + "/saloon_plan.png"); print(im.size)
