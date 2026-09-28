"""Build a room's floor-skin package (T-639) from the 28 September floor research.

Reads the floor agent's floor.json, the 2 mm texture of one arm and its mask, and the
5 cm LiDAR height residual map; writes WebP texture tiers, an int16 height grid, a
floor-slab mask and floor-skin.json. Inputs are read-only; outputs go to --out.

  python tools/floor-skin/build_floor_skin.py --arm A --room grand-hall \
    --floor D:/claude/visual-firstprinciples-20260928/floor \
    --out D:/claude/splats/trades-hall/grand-hall/floor-skin/v1

Arms: A (textured OBJ), B (photo mosaic), C (raw cube faces, sharpest in the 28 September study).
--matched R,G,B sets the measured splat/photo colour ratio behind the web's `?floor=matched`
(default: the Arm A render-proof measurement). A ratio passed with --matched must name where
it was measured with --matched-source; the manifest records that text as provenance.matched.
"""
import argparse, datetime, hashlib, json, math, os
import numpy as np
import cv2
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ARMS = {"A": ("floor_A_obj_2mm.png", "floor_A_obj_mask.png", "Matterport textured OBJ floor, re-baked at 2 mm"),
        "B": ("floor_B_pano_2mm.png", "floor_B_pano_mask.png", "Matterport E57 photograph mosaic at 2 mm"),
        "C": ("floor_C_faces_2mm.png", "floor_C_faces_mask.png", "Matterport E57 raw 4096 px cube faces, jointly re-posed, at 2 mm")}
TIERS = {"high": 4096, "medium": 2048, "low": 1024}
MASK_W, MASK_H = 1024, 512
MATCHED = [0.708582, 0.575199, 0.62761]  # splat/photo floor ratio, linear RGB (render-proof gain.json)
MATCHED_SOURCE = "Arm A render-proof measurement"


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def colour_ratio(text):
    """--matched: three positive, finite linear-RGB factors written R,G,B."""
    try:
        values = [float(part) for part in text.split(",")]
    except ValueError:
        values = []
    if len(values) != 3 or not all(math.isfinite(v) and v > 0 for v in values):
        raise argparse.ArgumentTypeError(f"expected three positive numbers R,G,B, got {text!r}")
    return values


def slab_without_floor(slab, valid):
    """Slab-mask cells that hide splats (>= 128) where the 2 mm texture's alpha is below 128.

    The alpha is read at the texel under each mask cell's centre. Such a cell would hide
    the captured floor where the floor skin draws nothing, leaving a hole in the floor.
    """
    H, W = valid.shape
    mh, mw = slab.shape
    cols = np.minimum(W - 1, np.floor((np.arange(mw) + 0.5) * W / mw).astype(np.int64))
    rows = np.minimum(H - 1, np.floor((np.arange(mh) + 0.5) * H / mh).astype(np.int64))
    return (slab >= 128) & (valid[np.ix_(rows, cols)] < 128)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--arm", choices=sorted(ARMS), required=True)
    ap.add_argument("--room", required=True)
    ap.add_argument("--floor", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--matched", type=colour_ratio, default=None,
                    help="measured splat/photo floor colour ratio R,G,B, linear RGB (default: the Arm A measurement)")
    ap.add_argument("--matched-source", default=None,
                    help=f"where the --matched ratio was measured, recorded as provenance.matched (default: {MATCHED_SOURCE!r})")
    a = ap.parse_args()
    if a.matched is not None and a.matched_source is None:
        ap.error("--matched needs --matched-source naming where that ratio was measured")
    matched = MATCHED if a.matched is None else a.matched
    matched_source = MATCHED_SOURCE if a.matched_source is None else a.matched_source

    # Every input is read and checked before anything is written.
    fj_path = os.path.join(a.floor, "floor.json")
    fj = json.load(open(fj_path, encoding="utf-8"))
    tex_name, mask_name, description = ARMS[a.arm]
    W, H = fj["texture"]["size_px"]
    texel = fj["texture"]["texel_m"]
    mapping = fj["texture"]["texel_to_hallframe"]
    if (W, H) != (10600, 5300):
        raise SystemExit(f"unexpected texture size {W}x{H}")
    rgb = np.asarray(Image.open(os.path.join(a.floor, tex_name)).convert("RGB"))
    valid = np.asarray(Image.open(os.path.join(a.floor, mask_name)).convert("L"))
    if rgb.shape[:2] != (H, W) or valid.shape != (H, W):
        raise SystemExit("texture and mask must both be 10600x5300")

    resid = np.asarray(Image.open(os.path.join(a.floor, "floor_height_resid_5cm.png")))
    if resid.dtype != np.uint16 or resid.shape != (212, 424):
        raise SystemExit(f"unexpected height map {resid.dtype} {resid.shape}")
    heights = (resid.astype(np.int32) - 32768).astype("<i2")  # 0.1 mm units; -32768 = outside

    poly = np.asarray(fj["floor_polygon"]["texel_col_row"], dtype=np.float64)
    scaled = np.round(poly * [MASK_W / W, MASK_H / H] * 8).astype(np.int32)  # 3 fractional bits
    slab = np.zeros((MASK_H, MASK_W), np.uint8)
    cv2.fillPoly(slab, [scaled.reshape(-1, 1, 2)], 255, lineType=cv2.LINE_8, shift=3)
    slab = cv2.erode(slab, np.ones((3, 3), np.uint8), iterations=2)  # about 4 cm more inset (about 9 cm in all)
    holes = slab_without_floor(slab, valid)
    if holes.any():
        ys, xs = np.nonzero(holes)
        raise SystemExit(f"the slab mask would hide splats where the arm {a.arm} texture has no floor (alpha < 128): "
                         f"{int(holes.sum())} of {int((slab >= 128).sum())} cells, the first at x={int(xs[0])}, y={int(ys[0])} "
                         f"of the {MASK_W}x{MASK_H} mask")

    os.makedirs(a.out, exist_ok=True)
    files = {}
    tiles = [{"col0": 0, "row0": 0, "cols": 5300, "rows": 5300}, {"col0": 5300, "row0": 0, "cols": 5300, "rows": 5300}]
    tiers = {}
    for tier, size in TIERS.items():
        names = []
        for t, tile in enumerate(tiles):
            c0, r0, cw, rh = tile["col0"], tile["row0"], tile["cols"], tile["rows"]
            crop = rgb[r0:r0 + rh, c0:c0 + cw]
            alpha = valid[r0:r0 + rh, c0:c0 + cw]
            colour = cv2.resize(crop, (size, size), interpolation=cv2.INTER_AREA)
            a8 = cv2.resize(alpha, (size, size), interpolation=cv2.INTER_AREA)
            rgba = np.dstack([colour, a8]).astype(np.uint8)
            name = f"albedo-{size}-{t}.webp"
            path = os.path.join(a.out, name)
            Image.fromarray(rgba, "RGBA").save(path, "WEBP", quality=90, method=6)
            files[name] = sha256(path)
            names.append(name)
        tiers[tier] = {"size": size, "files": names}

    heights.tofile(os.path.join(a.out, "height-5cm.i16"))
    files["height-5cm.i16"] = sha256(os.path.join(a.out, "height-5cm.i16"))
    slab.tofile(os.path.join(a.out, "slab-mask-1024x512.u8"))
    files["slab-mask-1024x512.u8"] = sha256(os.path.join(a.out, "slab-mask-1024x512.u8"))

    manifest = {
        "schema": "venviewer.floor-skin.v1",
        "venue": "trades-hall",
        "room": a.room,
        "frame": "capture",
        "provenance": {
            "kind": "measured-photographic", "arm": a.arm, "source": description,
            "built": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "inputs": {"floor.json": sha256(fj_path), tex_name: sha256(os.path.join(a.floor, tex_name))},
            "matched": matched_source,
        },
        "grid": {"widthPx": W, "heightPx": H, "texelM": texel,
                 "origin": mapping["origin_corner"], "uAxis": mapping["u_axis_per_texel"], "vAxis": mapping["v_axis_per_texel"]},
        "plane": {"normal": fj["floor_plane"]["hallframe_unit_normal"], "d": fj["floor_plane"]["hallframe_n_dot_x_eq_d"]},
        "tiles": tiles,
        "tiers": tiers,
        "height": {"file": "height-5cm.i16", "cols": 424, "rows": 212, "cellPx": 25, "unitM": 0.0001, "outside": -32768},
        "slab": {"file": "slab-mask-1024x512.u8", "width": MASK_W, "height": MASK_H, "below": 0.15, "above": 0.12},
        "colour": {"matched": matched},
        "files": files,
    }
    with open(os.path.join(a.out, "floor-skin.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, indent=1)
    print(json.dumps({"out": a.out, "files": len(files), "slab_pixels": int((slab > 0).sum()),
                      "slab_under_floor": True, "matched": matched, "matched_source": matched_source}))


if __name__ == "__main__":
    main()
