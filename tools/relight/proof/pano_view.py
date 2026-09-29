"""Perspective views from the Matterport 8K station panoramas (reference photographs, read-only), using
the audit's pano<->E57 alignment (rows flipped, columns mirrored + rolled, 4-row shift) and each scan's
E57 pose, so the view can be matched exactly by a harness render from the same station position.
  python pano_view.py <scan> <room_target_x,y,z> <fov> <out.png> [W H]"""
import json, sys
import numpy as np
from PIL import Image
from common import *

Image.MAX_IMAGE_PIXELS = None
PANO = CFG.paths["panoramas"] + "/sweep_{:03d}jpg.jpg"


def station(scan):
    d = np.load(f"{AUDIT}/e57grid/s{scan:02d}.npz")
    return d["origin"].astype(np.float64), d["R"].astype(np.float64)


def view(scan, tgt_room, fov, W=1920, H=1080):
    o, R = station(scan)
    al = json.load(open(f"{AUDIT}/out/B_pano_e57_alignment.json"))[str(scan)]
    pano = np.asarray(Image.open(PANO.format(scan + 1)).convert("RGB"), dtype=np.float32)
    PH, PW = pano.shape[:2]
    cam_room = e57_to_room(o[None])[0]
    fwd_r = np.array(tgt_room) - cam_room; fwd_r /= np.linalg.norm(fwd_r)
    up_r = np.array([0, 1.0, 0]); right_r = np.cross(fwd_r, up_r); right_r /= np.linalg.norm(right_r); upv = np.cross(right_r, fwd_r)
    t = np.tan(np.radians(fov / 2))
    xs = ((np.arange(W) + 0.5) / W * 2 - 1) * t * W / H; ys = (1 - (np.arange(H) + 0.5) / H * 2) * t
    X, Y = np.meshgrid(xs, ys)
    Dr = fwd_r[None, None] + X[..., None] * right_r + Y[..., None] * upv
    Dr /= np.linalg.norm(Dr, axis=-1, keepdims=True)
    Dj = np.stack([Dr[..., 0], -Dr[..., 2], Dr[..., 1]], -1)          # room dir -> json dir
    De = Dj @ T_JE[:3, :3]                                              # json dir -> e57 dir (R^T d)
    v = De @ R                                                          # e57 world -> scan local
    az = np.degrees(np.arctan2(v[..., 1], v[..., 0])) % 360
    el = np.degrees(np.arcsin(np.clip(v[..., 2], -1, 1)))
    r = (el + 90) / 0.1; c = (az - 0.05) / 0.1
    rowp = 1799 - r + (-al["best_row_shift"])
    k = al["roll_cols_at_3600"]
    colp = (3599 - ((c - k) % 3600)) if al["pano_cols_flipped"] else ((c - k) % 3600)
    px = (colp + 0.5) * PW / 3600 - 0.5; py = (rowp + 0.5) * PH / 1800 - 0.5
    x0 = np.floor(px).astype(int); y0 = np.floor(py).astype(int); fx = px - x0; fy = py - y0
    def at(yy, xx): return pano[np.clip(yy, 0, PH - 1), xx % PW]
    img = (at(y0, x0) * ((1 - fx) * (1 - fy))[..., None] + at(y0, x0 + 1) * (fx * (1 - fy))[..., None]
           + at(y0 + 1, x0) * ((1 - fx) * fy)[..., None] + at(y0 + 1, x0 + 1) * (fx * fy)[..., None])
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)), cam_room


if __name__ == "__main__":
    scan = int(sys.argv[1]); tgt = [float(v) for v in sys.argv[2].split(",")]; fov = float(sys.argv[3])
    W, H = (int(sys.argv[5]), int(sys.argv[6])) if len(sys.argv) > 6 else (1920, 1080)
    im, cam = view(scan, tgt, fov, W, H)
    im.save(sys.argv[4])
    print("camera room", np.round(cam, 4).tolist())
