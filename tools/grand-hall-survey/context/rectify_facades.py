"""Rectifies the public 8K panoramas onto the walls facade-survey.json reads, with a metre grid, for reading openings.

For each wall in the survey and each station it names, the station's world-aligned equirectangular panorama is
sampled onto the wall's plane (planner frame; planner = (8.795 - X, Z - 0.045, Y + 4.963) of the E57 frame, as
project.py and measure/glazing-bars.py have it) over the span of the wall's features, 3 m wider each way and from
the pavement (y -3.79) to 3 m above the highest, at --res metres a pixel, with a line every metre (labelled every
second: u along the wall in red, the height above the pavement in blue). The survey's rectangles were read by eye
from these images (2.5 cm for the frontage and Garth Street, 4 cm for its far end).

Inputs: --data holds manifest.json and pano8k/scan_NNN_8192.webp (fetch_inputs.py, or any copy whose SHA-256 matches
the manifest; --pano scan_NNN=path adds a station from elsewhere, scan_145 at the front door for one). Every
panorama is checked against the manifest's hash before use.

Usage: python3 rectify_facades.py --data DIR --out DIR [--res 0.025] [--pano scan_145=path ...] [--wall glassford-east]
Writes DIR/<wall>-<station>.png. About 3 s and 0.6 GB a panorama.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

Image.MAX_IMAGE_PIXELS = None
HERE = Path(__file__).resolve().parent
XC, YC, ZF = 8.795, -4.963, 0.045
PAVEMENT_Y = -3.79


def parse_args():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--data", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--survey", type=Path, default=HERE / "facade-survey.json")
    ap.add_argument("--res", type=float, default=0.025)
    ap.add_argument("--pano", action="append", default=[], help="station=path for a panorama outside --data/pano8k")
    ap.add_argument("--wall", action="append", default=[], help="only these walls (default: all)")
    return ap.parse_args()


def sample(img, v):
    """Bilinear sample of an equirectangular image along E57 directions v (..., 3), as project.py's sample_pano."""
    h, w = img.shape[:2]
    az = np.arctan2(v[..., 1], v[..., 0]) % (2 * np.pi)
    el = np.arctan2(v[..., 2], np.hypot(v[..., 0], v[..., 1]))
    fx = az / (2 * np.pi) * w - 0.5
    fy = (np.pi / 2 - el) / np.pi * h - 0.5
    x0, y0 = np.floor(fx).astype(int), np.floor(fy).astype(int)
    tx, ty = (fx - x0)[..., None], (fy - y0)[..., None]

    def at(y, x):
        return img[np.clip(y, 0, h - 1), x % w].astype(np.float32)

    return (at(y0, x0) * (1 - tx) + at(y0, x0 + 1) * tx) * (1 - ty) + (at(y0 + 1, x0) * (1 - tx) + at(y0 + 1, x0 + 1) * tx) * ty


def rectify(img, eye, wall, u_range, h_top, res):
    """The panorama seen from `eye` (planner) on the wall's plane: u along it, h above the pavement."""
    u = np.arange(u_range[0], u_range[1], res) + res / 2
    h = np.arange(h_top, 0, -res) - res / 2
    uu, hh = np.meshgrid(u, h)
    value = wall["plane"]["value"]
    if wall["plane"]["axis"] == "z":
        pts = np.stack([uu, hh + PAVEMENT_Y, np.full_like(uu, value)], -1)
    else:
        pts = np.stack([np.full_like(uu, value), hh + PAVEMENT_Y, uu], -1)
    d = pts - eye
    d /= np.linalg.norm(d, axis=-1, keepdims=True)
    return sample(img, np.stack([-d[..., 0], d[..., 2], d[..., 1]], -1))


def draw_grid(rgb, u_range, h_top, res):
    image = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8))
    pen = ImageDraw.Draw(image)
    for u in range(int(np.ceil(u_range[0])), int(np.floor(u_range[1])) + 1):
        x = (u - u_range[0]) / res
        pen.line([(x, 0), (x, image.height)], fill=(255, 0, 0) if u % 5 == 0 else (255, 170, 170))
        if u % 2 == 0:
            pen.text((x + 2, 2), str(u), fill=(255, 0, 0))
    for metre in range(0, int(h_top) + 1):
        y = (h_top - metre) / res
        pen.line([(0, y), (image.width, y)], fill=(0, 0, 255) if metre % 5 == 0 else (170, 170, 255))
        pen.text((2, y + 2), str(metre), fill=(0, 0, 255))
    return image


def main():
    args = parse_args()
    survey = json.loads(args.survey.read_text(encoding="utf-8"))
    manifest = json.loads((args.data / "manifest.json").read_text(encoding="utf-8"))
    nodes = {node["id"]: node for node in manifest["nodes"]}
    extra = dict(entry.split("=", 1) for entry in args.pano)
    args.out.mkdir(parents=True, exist_ok=True)
    for wall in survey["walls"]:
        if args.wall and wall["id"] not in args.wall:
            continue
        features = [f for f in survey["features"] if f["wall"] == wall["id"]]
        u_range = (min(f["u"][0] for f in features) - 3, max(f["u"][1] for f in features) + 3)
        h_top = max(f["h"][1] for f in features) + 3
        for station in wall["stations"]:
            path = Path(extra.get(station, args.data / "pano8k" / f"{station}_8192.webp"))
            expected = manifest["contentHashes"].get(f"tiles/{station}/equirect_8192.webp")
            if expected is None or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
                raise SystemExit(f"{path} is not the manifest's {station}")
            t = nodes[station]["pose"]["t"]
            eye = np.array([XC - t[0], t[2] - ZF, t[1] - YC])
            img = np.asarray(Image.open(path).convert("RGB"))
            draw_grid(rectify(img, eye, wall, u_range, h_top, args.res), u_range, h_top, args.res).save(args.out / f"{wall['id']}-{station}.png")
            print(wall["id"], station)


if __name__ == "__main__":
    main()
