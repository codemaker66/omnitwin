"""Embrasure splats (curtains, glazing bars, reveals, columns) lit from the room side they are seen from.
They were isotropic receivers, so a back-lit curtain's brightness was credited to the huge window light
behind it and its fabric came out dark (black-brown curtains at night, where the Matterport night photo
shows cream ones). Now: normal +y (facing into the hall), so the capture irradiance and every scenario
irradiance count only light arriving from the room side. Updates the embrasure rows in place of
bases_n / bases_iso / bases_E_win / bases_E_ch / bases_E_dome / bases_E_cove / E_cap (work/npy)."""
import time
import numpy as np
import torch
from common import *
import lt
from radiosity import form_factors, radiosity, probe_indirect, load_patches
from store import Store, Probes, eval_cubes, NPY

torch.set_num_threads(8)
SKY_W = np.array([0.15, 0.66, 1.0, 1.21], np.float32)


def rw(name):
    return np.load(f"{NPY}/{name}.npy", mmap_mode="r+")


def main():
    t0 = time.time()
    st = Store(); probes = Probes()
    emb = np.concatenate([np.where(np.asarray(st.cls[sl]) == 1)[0] + sl.start for sl in st.chunks(1_000_000)])
    pe = np.asarray(st.pos[emb], np.float64)
    n = np.tile(np.array([[0.0, 1.0, 0.0]], np.float32), (len(emb), 1)); iso = np.zeros(len(emb), bool)
    nt = torch.from_numpy(n); isot = torch.from_numpy(iso)
    occ = lt.load_occ()
    Ew = np.zeros((len(emb), lt.N_WBASES), np.float32)
    for wi, w in enumerate(lt.WIN_NAMES):
        x0, x1 = WINDOWS[w][0], WINDOWS[w][1]
        sel = np.where((pe[:, 0] > x0 - 0.3) & (pe[:, 0] < x1 + 0.3))[0]
        for a in range(0, len(sel), 60000):
            jj = sel[a:a + 60000]
            c = lt.window_cubes(occ, pe[jj], nx=6, nz=9, windows=[wi])
            Ew[jj] = lt.cube_eval(c, nt[jj], isot[jj]).numpy()
        print(f"  window light {w}: {len(sel)} {time.time() - t0:.0f}s", flush=True)
    g = np.load(f"{WORK}/geom.npz"); ring = np.load(f"{WORK}/bases.npz")["ring"]
    ch = g["chandeliers"]
    Ech = np.zeros((len(emb), 2), np.float32); Ed = np.zeros(len(emb), np.float32); Ec = np.zeros(len(emb), np.float32)
    for a in range(0, len(emb), 200000):
        sl = slice(a, a + 200000)
        pc = torch.from_numpy(pe[sl]).float()
        e = lt.cube_eval(lt.point_cubes(pc, ch, rmin=0.30), nt[sl], isot[sl]).numpy()
        Ech[sl, 0] = e[:, [0, 1, 3, 4]].sum(1); Ech[sl, 1] = e[:, 2]
        Ed[sl] = lt.cube_eval(lt.point_cubes(pc, ring, rmin=0.30) * lt.dome_visible(pc, ring, g["dome_c"])[..., None], nt[sl], isot[sl]).sum(1).numpy()
        up = np.where(pe[sl, 2] > lt.COVE_Z - 0.02)[0]
        if len(up):
            Ec[a + up] = lt.cube_eval(lt.cove_cubes(pe[sl][up]), nt[sl][up], isot[sl][up]).numpy()
    print("house light", f"{time.time() - t0:.0f}s", flush=True)
    del st
    for name, val in (("bases_n", n.astype(np.float16)), ("bases_iso", iso), ("bases_E_win", Ew.astype(np.float16)),
                      ("bases_E_ch", Ech), ("bases_E_dome", Ed), ("bases_E_cove", Ec)):
        m = rw(name); m[emb] = val; m.flush(); del m
    # capture irradiance for the embrasure rows, from the unchanged fit (weights, colours, patch albedo)
    st = Store()
    fs = np.load(f"{WORK}/fit_state.npz"); Wc = fs["Wc"]
    pt = load_patches()
    F = form_factors(pt["P"], pt["N"], pt["A"], pt["opening"])
    B = radiosity(F, fs["rho"], fs["Pdir_cap"])
    Imix = torch.einsum("pbcd,bc->pcd", probe_indirect(probes.P[probes.kp], pt, B), torch.from_numpy(Wc))
    D = np.zeros((len(emb), 10), np.float32)
    for wi in range(5):
        D[:, wi] = Ew[:, wi * 4:(wi + 1) * 4] @ SKY_W
    D[:, 5] = np.asarray(st.E_sun_cap[emb]); D[:, 6] = Ec; D[:, 7] = Ech[:, 0]; D[:, 8] = Ech[:, 1]; D[:, 9] = Ed
    E = D @ Wc
    for a in range(0, len(emb), 150000):
        sl = slice(a, a + 150000)
        E[sl] += eval_cubes(probes, Imix, pe[sl], n[sl], iso[sl])
    del st
    m = rw("E_cap"); m[emb] = E; m.flush(); del m
    print("embrasure rows updated:", len(emb), f"{time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
