import sys, json; sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import numpy as np
from PIL import Image, ImageDraw
from common import *
meta = json.load(open(OUT + "/scripts/elev_meta.json"))
def crop(name, wa, wb, v0, v1, out, scale=4, kind="photo"):
    """wa, wb: world along-wall coordinate (Y for X walls, X for Y walls) range; v in metres."""
    mt = meta[name]; r = mt["res"]
    sgn = mt["right"][0] + mt["right"][1]   # u = sgn * world
    ua, ub = sorted([sgn * wa, sgn * wb])
    im = Image.open(OUT + f"/elevation_{name}_photo.png") if kind == "photo" else Image.open(OUT + f"/scripts/elev_{name}_depth.png")
    c0 = int((ua - mt["urange"][0]) / r); c1 = int((ub - mt["urange"][0]) / r)
    r0 = int((mt["vrange"][1] - v1) / r); r1 = int((mt["vrange"][1] - v0) / r)
    im = im.crop((c0, r0, c1, r1)).resize(((c1 - c0) * scale, (r1 - r0) * scale), Image.BICUBIC)
    d = ImageDraw.Draw(im)
    for wv in np.arange(np.ceil(min(wa, wb) * 10) / 10, max(wa, wb), 0.1):
        x = (sgn * wv - ua) / r * scale
        major = abs(wv * 2 - round(wv * 2)) < 1e-6
        d.line([(x, 0), (x, im.size[1])], fill=(255, 60, 60) if major else (255, 160, 160), width=1)
        if major: d.text((x + 2, 2), f"{wv:.1f}", fill=(255, 255, 0))
    for vv in np.arange(np.ceil(v0 * 10) / 10, v1, 0.1):
        y = (v1 - vv) / r * scale
        major = abs(vv * 2 - round(vv * 2)) < 1e-6
        d.line([(0, y), (im.size[0], y)], fill=(60, 60, 255) if major else (150, 150, 255), width=1)
        if major: d.text((2, y + 2), f"{vv:.1f}", fill=(0, 255, 255))
    im.save(out)
if __name__ == "__main__":
    a = sys.argv
    crop(a[1], float(a[2]), float(a[3]), float(a[4]), float(a[5]), a[6], kind=a[7] if len(a) > 7 else "photo")
