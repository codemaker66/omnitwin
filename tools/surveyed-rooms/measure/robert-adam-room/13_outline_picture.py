"""A picture of the config's outline over the plan sections it was fitted to: the lower section's at 0.75 m
above its floor (red), the upper section's at 1.0 m above its own (green); the outline in white, floor
levels in yellow, ceiling regions in blue, columns and fittings as circles, stations as dots.

    python -X utf8 13_outline_picture.py [room.json]"""
import json
import os
import sys
from PIL import Image, ImageDraw
from ralib import OUT, FLOOR_LO, FLOOR_UP, room_mesh, sections_png, stations

HERE = os.path.dirname(os.path.abspath(__file__))
room = json.load(open(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "..", "robert-adam-room.room.json"), encoding="utf8"))
cx, cy = room["transform"]["centre"]
X0, X1, Y0, Y1, PPM = -7.0, 7.6, -12.2, 12.0, 52
f = OUT + "/img/outline.png"
sections_png(room_mesh(), [FLOOR_LO + 0.75, FLOOR_UP + 1.0], f, X0, X1, Y0, Y1, ppm=PPM, grid=1.0, label="outline over the sections")
im = Image.open(f)
d = ImageDraw.Draw(im)


def px(x, z):                                   # planner (x, z) at quarter turn 2 -> picture
    X, Y = cx - x, z + cy
    return ((X - X0) * PPM, (Y1 - Y) * PPM)


def poly(points, colour, width=1):
    q = [px(*p) for p in points]
    d.line(q + [q[0]], fill=colour, width=width)


for r in room["ceiling"].get("regions", []):
    poly(r["outline"], (70, 110, 255))
for lv in room["floor"]["levels"]:
    if "outline" in lv:
        poly(lv["outline"], (255, 230, 60))
poly(room["walls"]["vertices"], (255, 255, 255), 2)
for c in room["freeStanding"]:
    x, y = px(*c["centre"])
    d.ellipse([x - 4, y - 4, x + 4, y + 4], outline=(255, 120, 255))
for c in room["fittings"]:
    x, y = px(c["position"][0], c["position"][2])
    r = c.get("radius", 0.3) * PPM
    d.ellipse([x - r, y - r, x + r, y + r], outline=(255, 160, 60))
S, _ = stations()
for s in room["stations"]:
    t = S[int(s["id"][5:])]["t"]
    x, y = (t[0] - X0) * PPM, (Y1 - t[1]) * PPM
    d.ellipse([x - 2, y - 2, x + 2, y + 2], fill=(60, 255, 255))
im.save(f)
print(f, im.size)
