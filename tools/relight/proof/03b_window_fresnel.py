"""Recompute only the daylight bases after adding the glass's angular (Fresnel) transmittance to lt.py:
probe-volume window cubes, per-splat window irradiance (embrasure splats traced individually), patch
window irradiance, and the capture-period sun basis. House-light bases are unchanged and reused.
Memory-lean: per-splat outputs are written to memory-mapped .npy files in chunks.
"""
import gc
import os
import time
import numpy as np
import torch
from common import *
import lt
from store import Store, b3

torch.set_num_threads(8)
CAPTURE_TIMES_UTC = [(9, m) for m in (18, 28, 38, 48, 58)] + [(10, m) for m in (8, 18, 28)]


def load_npz(path):
    with np.load(path) as z:
        return {k: z[k] for k in z.files}


def main():
    t0 = time.time()
    occ = lt.load_occ()
    store = Store()
    pr = load_npz(f"{WORK}/probes.npz")
    P, keep = pr["P"], pr["keep"]
    shape = tuple(int(v) for v in pr["shape"]); origin = tuple(float(v) for v in pr["origin"])
    kp = np.where(keep)[0]
    ck = np.zeros((len(kp), lt.N_WBASES, 6), np.float32)
    for a in range(0, len(kp), 20000):
        ck[a:a + 20000] = lt.window_cubes(occ, P[kp[a:a + 20000]], nx=12, nz=18).numpy()
        print(f"  probes {min(a + 20000, len(kp))}/{len(kp)} {time.time() - t0:.0f}s", flush=True)
    full = np.zeros((len(P), lt.N_WBASES, 6), np.float16); full[kp] = ck
    pr["win_cubes"] = full
    np.savez(f"{WORK}/probes.npz", **pr)
    del full, pr
    remap = np.zeros(len(P), np.int64); remap[kp] = np.arange(len(kp))
    ckt = torch.from_numpy(ck); valid = keep.astype(np.float32)

    tmp = f"{WORK}/npy/bases_E_win.new.npy"
    Ew = np.lib.format.open_memmap(tmp, mode="w+", dtype=np.float16, shape=(store.N, lt.N_WBASES))
    for sl in store.chunks(100_000):
        p = np.asarray(store.pos[sl], np.float64); n, iso = store.normals(sl)
        q = p.copy()
        q[:, 0] = np.clip(q[:, 0], X0 + 0.02, X1 - 0.02); q[:, 1] = np.clip(q[:, 1], Y0 + 0.02, Y1 - 0.02); q[:, 2] = np.clip(q[:, 2], FLOOR_Z + 0.02, 9.8)
        ti, tw, _ = b3.trilinear_weights(q, origin, shape, valid)
        cube = (ckt[torch.from_numpy(remap[ti])] * torch.from_numpy(tw)[..., None, None]).sum(1)
        Ew[sl] = lt.cube_eval(cube, torch.from_numpy(n), torch.from_numpy(iso)).numpy().astype(np.float16)
    print("per-splat window light interpolated", f"{time.time() - t0:.0f}s", flush=True)
    emb = np.concatenate([np.where(np.asarray(store.cls[sl]) == 1)[0] + sl.start for sl in store.chunks(1_000_000)])
    pe = np.asarray(store.pos[emb], np.float64)
    for wi, w in enumerate(lt.WIN_NAMES):
        x0, x1 = WINDOWS[w][0], WINDOWS[w][1]
        sel = np.where((pe[:, 0] > x0 - 0.3) & (pe[:, 0] < x1 + 0.3))[0]
        for a in range(0, len(sel), 60000):
            jj = sel[a:a + 60000]; ii = emb[jj]
            n, iso = store.normals(ii)
            c = lt.window_cubes(occ, pe[jj], nx=6, nz=9, windows=[wi])
            Ew[ii] = lt.cube_eval(c, torch.from_numpy(n), torch.from_numpy(iso)).numpy().astype(np.float16)
        print(f"  embrasure {w}: {len(sel)} splats {time.time() - t0:.0f}s", flush=True)
    Ew.flush(); del Ew

    pt = load_npz(f"{WORK}/patches.npz")
    q = pt["P"] + pt["N"] * 0.03
    q = np.c_[np.clip(q[:, 0], X0 + 0.02, X1 - 0.02), np.clip(q[:, 1], Y0 + 0.02, Y1 - 0.02), np.clip(q[:, 2], FLOOR_Z + 0.02, 9.8)]
    ti, tw, _ = b3.trilinear_weights(q, origin, shape, valid)
    cube = (ckt[torch.from_numpy(remap[ti])] * torch.from_numpy(tw)[..., None, None]).sum(1)
    pt["E_win"] = lt.cube_eval(cube, torch.from_numpy(pt["N"]).float(), torch.zeros(len(q), dtype=torch.bool)).numpy()
    np.savez(f"{WORK}/patches.npz", **pt)
    print("patch window light", f"{time.time() - t0:.0f}s", flush=True)

    sun = np.lib.format.open_memmap(f"{WORK}/npy/sun_cap_E.new.npy", mode="w+", dtype=np.float32, shape=(store.N,))
    for sl in store.chunks(500_000):
        p = np.asarray(store.pos[sl]); cls = np.asarray(store.cls[sl]); n, iso = store.normals(sl)
        ii = np.where((cls == 0) | (cls == 1))[0]
        acc = np.zeros(len(p), np.float32)
        for hh, mi in CAPTURE_TIMES_UTC:
            s = sun_vec_e57(*solar_position(2026, 5, 31, hh, mi))
            acc[ii] += lt.sun_direct(occ, p[ii], s).numpy() * np.where(iso[ii], 0.25, np.clip(n[ii] @ s, 0, None))
        sun[sl] = acc / len(CAPTURE_TIMES_UTC)
    sun.flush(); del sun
    del store
    gc.collect()
    os.replace(tmp, f"{WORK}/npy/bases_E_win.npy")
    os.replace(f"{WORK}/npy/sun_cap_E.new.npy", f"{WORK}/npy/sun_cap_E.npy")
    print("done", f"{time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
