"""Memory-lean access to the per-splat tables (memory-mapped work/npy/*.npy) and the irradiance-probe
volume, shared by 04_fit.py and 05_relight.py. Everything N-sized stays on disk; callers work in chunks.

Per-splat arrays (N = 6,030,980, product merge order):
  splats_pos f32 (N,3) E57 frame | splats_rgb u8 (N,3) stored sRGB DC | splats_opa f16 (N,)
  geom_cls u8 (N,) 0 interior, 1 embrasure, 2 exterior, 3 chandelier emitter, 4 dome-ring emitter
  bases_n f16 (N,3) receiver normal | bases_iso bool (N,) isotropic receiver
  bases_E_win f16 (N,20) window w x {facade, sky 0-35, 35-55, 55-90} | bases_E_ch f32 (N,2) [end, centre]
  bases_E_dome f32 (N,) | bases_E_cove f32 (N,) | sun_cap_E f32 (N,) capture-period direct sun
"""
from importlib import import_module
import numpy as np
import torch
from common import *
import lt

NPY = f"{WORK}/npy"
LUT = srgb_to_linear(np.arange(256) / 255.0).astype(np.float32)
LUMW = np.array([0.2126, 0.7152, 0.0722], np.float32)
b3 = import_module("03_bases")


def mm(name):
    return np.load(f"{NPY}/{name}.npy", mmap_mode="r")


class Store:
    def __init__(self):
        self.pos = mm("splats_pos"); self.rgb = mm("splats_rgb"); self.opa = mm("splats_opa")
        self.cls = mm("geom_cls"); self.n = mm("bases_n"); self.iso = mm("bases_iso")
        self.E_win = mm("bases_E_win"); self.E_ch = mm("bases_E_ch"); self.E_dome = mm("bases_E_dome")
        self.E_cove = mm("bases_E_cove"); self.E_sun_cap = mm("sun_cap_E")
        self.N = self.pos.shape[0]

    def chunks(self, size=500_000):
        for a in range(0, self.N, size):
            yield slice(a, min(self.N, a + size))

    def colour(self, idx):
        return LUT[np.asarray(self.rgb[idx])]

    def normals(self, idx):
        return np.asarray(self.n[idx], np.float32), np.asarray(self.iso[idx])


class Probes:
    def __init__(self):
        pr = np.load(f"{WORK}/probes.npz")
        self.P = pr["P"]; self.keep = pr["keep"]
        self.shape = tuple(int(v) for v in pr["shape"]); self.origin = tuple(float(v) for v in pr["origin"])
        self.kp = np.where(self.keep)[0]
        self.remap = np.zeros(len(self.P), np.int64); self.remap[self.kp] = np.arange(len(self.kp))
        self.valid = self.keep.astype(np.float32)

    def win_cubes(self):
        """(kp, 20, 6) float32 window ambient cubes at the kept probes."""
        return np.load(f"{WORK}/probes.npz")["win_cubes"][self.kp].astype(np.float32)

    def lookup(self, pos):
        q = np.asarray(pos, np.float64).copy()
        q[:, 0] = np.clip(q[:, 0], X0 + 0.02, X1 - 0.02); q[:, 1] = np.clip(q[:, 1], Y0 + 0.02, Y1 - 0.02)
        q[:, 2] = np.clip(q[:, 2], FLOOR_Z + 0.02, 9.8)
        ti, tw, _ = b3.trilinear_weights(q, self.origin, self.shape, self.valid)
        return self.remap[ti], tw


def eval_cubes(probes, cubes, pos, n, iso):
    """cubes torch (kp, K, 6) -> irradiance (m, K) at points pos with normals n / isotropic flags."""
    ti, tw = probes.lookup(pos)
    c = (cubes[torch.from_numpy(ti)] * torch.from_numpy(tw)[..., None, None]).sum(1)
    return lt.cube_eval(c, torch.from_numpy(n), torch.from_numpy(iso)).numpy()
