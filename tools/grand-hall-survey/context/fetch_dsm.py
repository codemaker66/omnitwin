"""Fetches the Scottish LiDAR Phase 5 50 cm DSM around Trades Hall and cuts the city grid.

The Scottish Government publishes the Phase 5 LiDAR (flown 2020 by Fugro) on its
Remote Sensing Portal (https://remotesensingdata.gov.scot), with the files in the
public bucket srsp-open-data. The DSM comes in 5 km GeoTIFF tiles on the British
National Grid (EPSG:27700): float32 metres above ODN, 0.5 m cells, pixel-is-area,
nodata -9999. The hall (HES listing LB32713, NGR NS 59329 65183) is 671 m from
the east edge and 183 m from the south edge of tile NS56NE, so a 3 km square
centred on it needs four tiles. Each is checked against its byte count and the
SHA-256 of the copy the published model was built from: a download as it
streams, before it is installed, and a copy already on disk before use (a
damaged one is moved aside to <file>.corrupt and fetched again).

The grid is the 3 km square centred on E 259329 N 665183, cut from the tiles at
their own 0.5 m cells (the window's edges fall on tile cell edges, so nothing is
resampled). Nodata cells, if any, are filled by OpenCV's Telea inpainting (the
four tiles have none inside the window). Heights are stored relative to 10.7 m
ODN, the Phase 5 DTM at the hall's street level.

Usage: python3 fetch_dsm.py <tiles-dir> <dsm-dir>
Downloads missing tiles into <tiles-dir> (about 1.65 GB) and writes
<dsm-dir>/heights_50cm.f32 (6000 x 6000 little-endian float32, row 0 = south,
column 0 = west; 144 MB) and <dsm-dir>/meta.json.
Requires numpy, tifffile and opencv-python.
"""
import argparse
import hashlib
import json
import os
import urllib.request
from pathlib import Path

# libtiff warns about every GeoTIFF tag OpenCV does not know; the tags are read with tifffile.
os.environ.setdefault("OPENCV_LOG_LEVEL", "ERROR")
import cv2  # noqa: E402
import numpy as np  # noqa: E402
import tifffile  # noqa: E402

BUCKET = "https://srsp-open-data.s3-eu-west-2.amazonaws.com/lidar/phase-5/dsm/27700/gridded"
# name: (bytes, SHA-256) of the tiles as downloaded on 23 September 2026
# (S3 Last-Modified 6 July 2022 for all four).
TILES = {
    "NS56NE": (417259095, "19b4472c5cd390c841a85532e16e757542cdecc631331bd0e71d209f61527a3e"),
    "NS56SE": (409688376, "a8d697f352e12e26367e31312be2e7bb1bdd7c86b71b1257aa25900c0fc43541"),
    "NS66NW": (419800871, "da06c7237795693cc56e056c2e83e76d2fce405f33cd090b08f6d76e5de99777"),
    "NS66SW": (405615130, "10115dd97929fdd3a4245b33217639fd4047be07be73f3b9d76fc0bb685814ee"),
}
HALL_E, HALL_N = 259329.0, 665183.0     # HES listing LB32713, NGR NS 59329 65183
REF_HEIGHT = 10.7                        # Phase 5 DTM at the hall's street level, m ODN
HALF = 1500.0                            # half the window, metres
RES = 0.5
CREDIT = "Contains LiDAR data: Crown copyright Scottish Government and Fugro (2020), OGL v3.0"
USER_AGENT = "venviewer-survey/1.0 (+https://venviewer.com)"


def tile_file(name):
    return f"{name}_50CM_DSM_PHASE5.tif"


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def download(name, path):
    """Streams the tile into <path>.part, checking it on the way, and installs it only if it is whole."""
    size, digest = TILES[name]
    url = f"{BUCKET}/{tile_file(name)}"
    print("downloading", url, flush=True)
    part = path.with_suffix(".part")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    hasher = hashlib.sha256()
    received = 0
    # A connection that closes early ends read() quietly rather than raising,
    # so the byte count and hash are the only proof the copy is whole.
    with urllib.request.urlopen(request, timeout=300) as response, open(part, "wb") as out:
        while block := response.read(1 << 22):
            out.write(block)
            hasher.update(block)
            received += len(block)
    if received != size or hasher.hexdigest() != digest:
        part.unlink(missing_ok=True)
        raise SystemExit(
            f"{url}: download incomplete or changed upstream (got {received} of {size} bytes, "
            f"SHA-256 {hasher.hexdigest()}); nothing was installed"
        )
    os.replace(part, path)


def fetch(name, tiles_dir):
    path = tiles_dir / tile_file(name)
    size, digest = TILES[name]
    if path.exists() and (path.stat().st_size != size or sha256(path) != digest):
        # The copy on disk is damaged (an interrupted older download, say), not
        # the upstream tile: keep it aside for a look and fetch a fresh one.
        corrupt = path.with_name(path.name + ".corrupt")
        os.replace(path, corrupt)
        print(f"{path.name}: corrupt local copy (size or SHA-256 differs); moved aside to {corrupt.name}", flush=True)
    if not path.exists():
        download(name, path)
    print("ok", path.name, flush=True)
    return path


def tile_origin(path):
    """Top-left corner (E, N) and pixel size from the GeoTIFF tie point and scale tags."""
    with tifffile.TiffFile(path) as tif:
        tags = tif.pages[0].tags
        tie = tags["ModelTiepointTag"].value
        scale = tags["ModelPixelScaleTag"].value
    return float(tie[3]), float(tie[4]), float(scale[0])


def build_window(paths):
    n = int(round(2 * HALF / RES))
    win = np.full((n, n), np.nan, dtype=np.float32)
    w_e0, w_n0 = HALL_E - HALF, HALL_N + HALF          # window top-left
    for path in paths:
        e0, n0, px = tile_origin(path)
        if abs(px - RES) > 1e-6:
            raise ValueError(f"{path.name}: unexpected pixel size {px}")
        arr = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
        if arr is None or arr.dtype != np.float32:
            raise RuntimeError(f"{path.name}: could not read a float32 raster (got {None if arr is None else arr.dtype})")
        # tile pixel (r, c) covers E = e0 + c*px, N = n0 - r*px
        c0 = int(round((w_e0 - e0) / px))
        r0 = int(round((n0 - w_n0) / px))
        rs, cs = max(r0, 0), max(c0, 0)
        re, ce = min(r0 + n, arr.shape[0]), min(c0 + n, arr.shape[1])
        if rs < re and cs < ce:
            win[rs - r0:re - r0, cs - c0:ce - c0] = arr[rs:re, cs:ce]
        print(f"{path.name}: origin E{e0:.0f} N{n0:.0f}, rows {rs}-{re}, cols {cs}-{ce}", flush=True)
        del arr
    bad = ~np.isfinite(win) | (win < -100)
    print(f"nodata cells: {int(bad.sum())} of {win.size}")
    if bad.any():
        fill = cv2.inpaint(np.nan_to_num(win, nan=0).astype(np.float32), bad.astype(np.uint8), 3, cv2.INPAINT_TELEA)
        win[bad] = fill[bad]
    return win


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("tiles_dir", type=Path, help="where the four GeoTIFF tiles are kept (downloaded if missing)")
    ap.add_argument("dsm_dir", type=Path, help="where heights_50cm.f32 and meta.json are written")
    args = ap.parse_args()
    args.tiles_dir.mkdir(parents=True, exist_ok=True)
    args.dsm_dir.mkdir(parents=True, exist_ok=True)
    paths = [fetch(name, args.tiles_dir) for name in TILES]
    rel = build_window(paths) - REF_HEIGHT
    np.flipud(rel).astype("<f4").tofile(args.dsm_dir / "heights_50cm.f32")
    centre = int(HALF / RES)
    hall = rel[centre - 10:centre + 10, centre - 10:centre + 10]
    meta = {
        "originE": HALL_E, "originN": HALL_N, "refHeight": REF_HEIGHT, "sizeM": 2 * HALF, "res": RES,
        "grid": rel.shape[0], "hallRoofMax": float(hall.max()), "min": float(rel.min()), "max": float(rel.max()),
        "credit": CREDIT,
        "tiles": {tile_file(name): f"{BUCKET}/{tile_file(name)}" for name in TILES},
    }
    (args.dsm_dir / "meta.json").write_text(json.dumps(meta, indent=1) + "\n", encoding="utf-8")
    print("heights_50cm.f32", sha256(args.dsm_dir / "heights_50cm.f32"))


if __name__ == "__main__":
    main()
