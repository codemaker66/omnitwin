"""Estimate the capture's light (the XGRIDS walk, 31 May 2026 ~10:18-11:35 BST): basis weights and light
colours that make the albedo flattest over large one-material surfaces, with inter-reflection.
Memory-lean rewrite (29 Sep): per-splat tables are memory-mapped (store.py) and processed in chunks.

Capture model (linear camera RGB), per splat and channel:
  E_cap = sum_w t_w col_day SKY_w + f_sun col_day SUN_cap + k_cove col_cove COVE
        + k_end col_house CH_end + k_cen col_house CH_centre + k_dome col_house DOME + inter-reflection
  SKY_w: window w's facade + three sky bands weighted [0.15, 0.66, 1.0, 1.21] (CIE overcast shape);
  SUN_cap: direct sun through the window cookie averaged over the capture period (8 positions).
Capture response: the splat colours are display-referred camera output, so C = (albedo * E)^gamma with the
capture's effective contrast gamma fitted (gamma < 1 = the camera compressed the light's dynamic range).
Fit: robust (pseudo-Huber) least squares on 0.5 m voxel log(C) - gamma (log(E) + mu_group) over six material
groups (floor, flat ceiling, panelling, frieze, band above the frieze, cream paint band), groups weighted
equally; weak priors keep the five window weights and the light colours from wandering. The absolute
scale is fixed by the cream paint: mean log green albedo of the paint band = log(0.60).
Outputs: work/fit.json, work/fit_state.npz (patch albedo, capture patch direct light), work/npy/E_cap.npy
"""
import json
import time
import numpy as np
import torch
from scipy.optimize import least_squares
from scipy.spatial import cKDTree
from common import *
import lt
from radiosity import form_factors, radiosity, probe_indirect, patch_sun, load_patches
from store import Store, Probes, eval_cubes, LUMW

torch.set_num_threads(8)
SKY_W = np.array([0.15, 0.66, 1.0, 1.21], np.float32)
CAPTURE_TIMES_UTC = [(9, m) for m in (18, 28, 38, 48, 58)] + [(10, m) for m in (8, 18, 28)]
BASES = ["W1", "W2", "W3", "W4", "W5", "sun_cap", "cove", "ch_end", "ch_centre", "dome"]
NB = len(BASES)
GROUPS = ["floor", "ceiling", "panelling", "frieze", "upper_band", "paint_band"]
PAINT = GROUPS.index("paint_band")
PAINT_ALBEDO = 0.60
HUBER = 0.25
GAMMA_FREE = False
# Light colour is poorly determined by albedo flatness (the free fit gave house/daylight = 1.16, 1, 0.87).
# Measured directly in the capture instead: unclipped lamp splats vs daylight seen through the glass.
_lr = f"{WORK}/lamp_daylight_ratio.json"
LAMP_RATIO = np.array(json.load(open(_lr))["lamp_over_daylight_rgb"]) if __import__("os").path.exists(_lr) else None


def direct(store, idx):
    Ew = np.asarray(store.E_win[idx], np.float32)
    D = np.empty((Ew.shape[0], NB), np.float32)
    for wi in range(5):
        D[:, wi] = Ew[:, wi * 4:(wi + 1) * 4] @ SKY_W
    D[:, 5] = store.E_sun_cap[idx]; D[:, 6] = store.E_cove[idx]
    ch = np.asarray(store.E_ch[idx]); D[:, 7] = ch[:, 0]; D[:, 8] = ch[:, 1]; D[:, 9] = store.E_dome[idx]
    return D


def patch_direct_capture(pt, occ):
    Psun = np.zeros(len(pt["P"]), np.float32)
    for hh, mi in CAPTURE_TIMES_UTC:
        Psun += patch_sun(occ, pt, sun_vec_e57(*solar_position(2026, 5, 31, hh, mi)))
    Psun /= len(CAPTURE_TIMES_UTC)
    D = np.zeros((len(pt["P"]), NB), np.float32)
    for wi in range(5):
        D[:, wi] = pt["E_win"][:, wi * 4:(wi + 1) * 4] @ SKY_W
    D[:, 5] = Psun; D[:, 6] = pt["E_cove"]; D[:, 7] = pt["E_ch"][:, 0]; D[:, 8] = pt["E_ch"][:, 1]; D[:, 9] = pt["E_dome"]
    return D


def fit_groups(store):
    gg = np.load(f"{WORK}/geom.npz")
    dome_c = gg["dome_c"].astype(np.float32); ch = gg["chandeliers"].astype(np.float32)
    out = {k: [] for k in GROUPS}
    for sl in store.chunks(1_000_000):
        p = np.asarray(store.pos[sl]); n, iso = store.normals(sl); cls = np.asarray(store.cls[sl])
        rel = (cls == 0) & ~iso
        inner = (p[:, 0] > X0 + 0.35) & (p[:, 0] < X1 - 0.35) & (p[:, 1] > Y0 + 0.35) & (p[:, 1] < Y1 - 0.35)
        rd = np.hypot(p[:, 0] - dome_c[0], p[:, 1] - dome_c[1])
        near_ch = np.zeros(len(p), bool)
        for c in ch:
            near_ch |= np.hypot(p[:, 0] - c[0], p[:, 1] - c[1]) < 0.8
        wall = rel & (np.abs(n[:, 2]) < 0.3) & ~inner & (p[:, 1] > Y0 - 0.02)
        m = {"floor": rel & (n[:, 2] > 0.95) & (p[:, 2] < FLOOR_Z + 0.12) & inner & (p[:, 1] > Y0 + 0.6),
             "ceiling": rel & (n[:, 2] < -0.95) & (p[:, 2] > CEIL_Z - 0.30) & inner & (rd > 3.9) & ~near_ch,
             "panelling": wall & (p[:, 2] > 0.35) & (p[:, 2] < 1.6),
             "frieze": wall & (p[:, 2] > 4.45) & (p[:, 2] < 5.35),
             "upper_band": wall & (p[:, 2] > 5.9) & (p[:, 2] < 6.4),
             "paint_band": wall & (p[:, 2] > 2.1) & (p[:, 2] < 3.9)}
        for k in GROUPS:
            out[k].append(np.where(m[k])[0] + sl.start)
    return {k: np.concatenate(v) for k, v in out.items()}


def voxel_keys(p, size=0.5):
    key = np.floor(np.asarray(p, np.float64) / size).astype(np.int64) + 1000
    return (key[:, 0] * 10_000 + key[:, 1]) * 10_000 + key[:, 2]


def build_fit_set(store):
    groups = fit_groups(store)
    parts = []
    for gi, k in enumerate(GROUPS):
        idx = groups[k]
        C = store.colour(idx); lum = C @ LUMW
        keys = voxel_keys(store.pos[idx])
        if k == "paint_band":
            # brightest 35% per 0.5 m wall voxel: the cream paint, not boards or portraits hung on it
            u, inv = np.unique(keys, return_inverse=True)
            cnt = np.bincount(inv); starts = np.r_[0, np.cumsum(cnt)]
            order = np.lexsort((lum, inv))
            thr = np.full(len(u), np.inf)
            big = cnt > 3
            thr[big] = lum[order[starts[:-1][big] + (0.65 * cnt[big]).astype(int)]]
            sel = lum >= thr[inv]
            idx, keys, C = idx[sel], keys[sel], C[sel]
        parts.append((gi, idx, keys, C))
        print(f"  group {k}: {len(idx)} splats", flush=True)
    idx = np.concatenate([q[1] for q in parts]); g = np.concatenate([np.full(len(q[1]), q[0], np.int64) for q in parts])
    key = np.concatenate([q[2] for q in parts]); C = np.concatenate([q[3] for q in parts])
    o = np.argsort(idx)
    idx, g, key, C = idx[o], g[o], key[o], C[o]
    assert np.all(np.diff(idx) > 0), "fit groups must be disjoint"
    uv, vid = np.unique(g * 10 ** 13 + key, return_inverse=True)
    w = np.asarray(store.opa[idx], np.float32)
    return dict(idx=idx, vid=vid, V=len(uv), vgroup=(uv // 10 ** 13).astype(np.int64), w=w, C=C)


def patch_samples(store, pt):
    """Every 4th interior splat (opacity > 0.2) within 0.5 m of a box plane -> its nearest patch on that plane."""
    Pp = pt["P"]
    planes = [(2, FLOOR_Z), (2, CEIL_Z), (0, X0), (0, X1), (1, Y1), (1, Y0)]
    ps_list = [np.where(np.abs(Pp[:, a] - v) < 1e-6)[0] for a, v in planes]
    trees = [cKDTree(Pp[ps]) for ps in ps_list]
    S_idx, S_patch = [], []
    for sl in store.chunks(1_000_000):
        cand = np.where((np.asarray(store.cls[sl]) == 0) & (np.asarray(store.opa[sl]) > 0.2))[0][::4]
        q = np.asarray(store.pos[sl])[cand].astype(np.float64)
        dist = np.stack([np.abs(q[:, a] - v) for a, v in planes], 1)
        pl = np.argmin(dist, 1); ok = dist[np.arange(len(q)), pl] < 0.5
        for k, (a, v) in enumerate(planes):
            m = ok & (pl == k)
            if m.any():
                proj = q[m].copy(); proj[:, a] = v
                _, j = trees[k].query(proj)
                S_idx.append(cand[m] + sl.start); S_patch.append(ps_list[k][j])
    S_idx = np.concatenate(S_idx); S_patch = np.concatenate(S_patch)
    o = np.argsort(S_idx)
    return S_idx[o], S_patch[o]


def E_capture_at(store, probes, idx, Wc, Imix, chunk=100_000):
    out = np.empty((len(idx), 3), np.float32)
    for a in range(0, len(idx), chunk):
        ii = idx[a:a + chunk]
        n, iso = store.normals(ii)
        out[a:a + chunk] = direct(store, ii) @ Wc + eval_cubes(probes, Imix, store.pos[ii], n, iso)
    return out


def main():
    t0 = time.time()
    store = Store(); probes = Probes()
    pt = load_patches()
    occ = lt.load_occ()
    Pdir = patch_direct_capture(pt, occ)
    F = form_factors(pt["P"], pt["N"], pt["A"], pt["opening"])
    print("form factors", tuple(F.shape), f"{time.time() - t0:.0f}s", flush=True)
    fs = build_fit_set(store)
    V, vid, w = fs["V"], fs["vid"], fs["w"]
    wsum = np.bincount(vid, w, V); ncount = np.bincount(vid, minlength=V)
    Cv = np.stack([np.bincount(vid, w * fs["C"][:, c], V) for c in range(3)], 1) / np.maximum(wsum, 1e-9)[:, None]
    Dv = np.zeros((V, NB))
    for a in range(0, len(fs["idx"]), 200_000):
        D = direct(store, fs["idx"][a:a + 200_000])
        for j in range(NB):
            Dv[:, j] += np.bincount(vid[a:a + 200_000], w[a:a + 200_000] * D[:, j], V)
    Dv /= np.maximum(wsum, 1e-9)[:, None]
    ok = (ncount >= 12) & (Cv.min(1) > 0.004) & (Cv.max(1) < 0.97)
    okv = np.where(ok)[0]; g_ok = fs["vgroup"][okv]
    ng = np.bincount(g_ok, minlength=len(GROUPS)); wg = 1.0 / np.sqrt(ng[g_ok])
    logC = np.log(Cv[okv]); Dv_ok = Dv[okv]
    print("voxels per group", dict(zip(GROUPS, ng.tolist())), f"{time.time() - t0:.0f}s", flush=True)
    sub = np.arange(0, len(fs["idx"]), 3)            # indirect is smooth: a third of the fit splats suffices
    S_idx, S_patch = patch_samples(store, pt)
    print("patch albedo samples", len(S_idx), f"{time.time() - t0:.0f}s", flush=True)

    def unpack(x):
        wts = np.exp(x[:NB])
        cday = np.exp([x[NB], 0.0, x[NB + 1]]); ccove = np.exp([x[NB + 2], 0.0, x[NB + 3]]); chouse = np.exp([x[NB + 4], 0.0, x[NB + 5]])
        if LAMP_RATIO is not None:            # house-light colour measured in the capture, not fitted
            ccove = cday * LAMP_RATIO; chouse = cday * LAMP_RATIO
        mu = np.insert(x[NB + 6:-1], PAINT * 3 + 1, np.log(PAINT_ALBEDO)).reshape(len(GROUPS), 3)
        cols = np.stack([cday] * 6 + [ccove] + [chouse] * 3, 0)
        return wts, cols, mu, float(np.exp(x[-1]))

    def model_E(x, Iv_ok):
        wts, cols, mu, gam = unpack(x)
        return np.einsum("vbc,bc->vc", Dv_ok[:, :, None] + Iv_ok, wts[:, None] * cols), mu, gam

    # initial weights: every light contributes ~0.2 where it is typical, mu from the implied albedo
    Dnz = [np.median(Dv_ok[Dv_ok[:, j] > 0, j]) if (Dv_ok[:, j] > 0).any() else 1.0 for j in range(NB)]
    x = np.zeros(NB + 6 + len(GROUPS) * 3 - 1 + 1)       # ..., log gamma (last)
    x[:NB] = np.log(0.2 / np.maximum(Dnz, 1e-9))
    rho = np.full((len(pt["P"]), 3), 0.35, np.float32); rho[pt["opening"]] = 0.0
    history = []
    for it in range(4):
        B = radiosity(F, rho, Pdir)                                          # (P,10,3)
        Iprobe = probe_indirect(probes.P[probes.kp], pt, B)                  # (kp,10,3,6)
        Iflat = Iprobe.reshape(len(probes.kp), NB * 3, 6)
        Iv = np.zeros((V, NB * 3))
        for a in range(0, len(sub), 25_000):
            jj = sub[a:a + 25_000]; ii = fs["idx"][jj]
            n, iso = store.normals(ii)
            I = eval_cubes(probes, Iflat, store.pos[ii], n, iso)
            for j in range(NB * 3):
                Iv[:, j] += np.bincount(vid[jj], w[jj] * I[:, j], V)
        Iv /= np.maximum(np.bincount(vid[sub], w[sub], V), 1e-9)[:, None]
        Iv_ok = Iv[okv].reshape(len(okv), NB, 3)
        print(f"iter {it}: radiosity + indirect at fit voxels {time.time() - t0:.0f}s", flush=True)
        if it == 0:
            E0, _, _ = model_E(x, Iv_ok)
            mu0 = np.stack([np.mean(logC[g_ok == gi] - np.log(E0[g_ok == gi]), 0) for gi in range(len(GROUPS))])
            shift = mu0[PAINT, 1] - np.log(PAINT_ALBEDO)
            x[:NB] += shift
            mu0 -= shift
            x[NB + 6:-1] = np.delete(mu0.ravel(), PAINT * 3 + 1)

        def resid(x):
            E, mu, gam = model_E(x, Iv_ok)
            r = logC - gam * (np.log(np.maximum(E, 1e-9)) + mu[g_ok])
            rt = np.sign(r) * HUBER * np.sqrt(2.0 * (np.sqrt(1.0 + (r / HUBER) ** 2) - 1.0))
            lw = x[:5]
            return np.concatenate([(rt * wg[:, None]).ravel(), 0.15 * (lw - lw.mean()) / 0.6, 0.15 * x[NB:NB + 6] / 0.5])

        lo = np.full(len(x), -np.inf); hi = np.full(len(x), np.inf)
        lo[:NB] = -25.0; hi[:NB] = 12.0
        if LAMP_RATIO is not None:
            lo[NB + 2:NB + 6] = -1e-9; hi[NB + 2:NB + 6] = 1e-9
        # gamma: free it and the fit trades light structure for contrast (29 Sep: gamma -> 0.49 with every
        # chandelier and the dome switched off, albedos near black) -- not identifiable; fixed at 1 (linear light)
        lo[-1], hi[-1] = (np.log(0.3), np.log(1.5)) if GAMMA_FREE else (-1e-9, 1e-9)
        sol = least_squares(resid, np.clip(x, lo + 1e-9, hi - 1e-9), bounds=(lo, hi), method="trf", x_scale="jac", max_nfev=4000)
        x = sol.x
        wts, cols, mu, gam = unpack(x)
        Wc = (wts[:, None] * cols).astype(np.float32)
        Imix = torch.einsum("pbcd,bc->pcd", Iprobe, torch.from_numpy(Wc))
        Es = E_capture_at(store, probes, S_idx, Wc, Imix)
        alb = np.clip(store.colour(S_idx) ** (1.0 / gam) / np.maximum(Es, 1e-6), 0, 1)
        sums = np.stack([np.bincount(S_patch, alb[:, c], len(pt["P"])) for c in range(3)], 1)
        cnts = np.bincount(S_patch, minlength=len(pt["P"]))
        rho_new = sums / np.maximum(cnts, 1)[:, None]
        rho_new[cnts <= 5] = np.median(rho_new[cnts > 5], 0)
        rho_new[pt["opening"]] = 0.0
        rho = np.clip(rho_new, 0.01, 0.9).astype(np.float32)
        rec = dict(iter=it, cost=round(float(sol.cost), 5), nfev=int(sol.nfev), gamma=round(gam, 4),
                   weights={b: float(f"{v:.5g}") for b, v in zip(BASES, wts)},
                   col_day=cols[0].round(3).tolist(), col_cove=cols[6].round(3).tolist(), col_house=cols[7].round(3).tolist(),
                   group_albedo_mean=dict(zip(GROUPS, np.exp(mu).round(3).tolist())),
                   patch_rho_median=np.median(rho[~pt["opening"]], 0).round(3).tolist())
        history.append(rec)
        print(json.dumps(rec), f"{time.time() - t0:.0f}s", flush=True)

    # diagnostics: flatness per group and the light budget (share of each light in the modelled irradiance)
    E, mu, gam = model_E(x, Iv_ok)
    wts, cols, _, _ = unpack(x)
    spread, budget = {}, {}
    for gi, k in enumerate(GROUPS):
        m = g_ok == gi
        lc = np.log2(Cv[okv][m]); la = lc - gam * np.log2(np.maximum(E[m], 1e-9))
        lum_c = np.log2(Cv[okv][m] @ LUMW); lum_a = lum_c - gam * np.log2(np.maximum(E[m] @ LUMW, 1e-9))
        spread[k] = dict(voxels=int(m.sum()), sd_log2_captured_lum=round(float(np.std(lum_c)), 3), sd_log2_albedo_lum=round(float(np.std(lum_a)), 3),
                         sd_log2_captured_rgb=np.std(lc, 0).round(3).tolist(), sd_log2_albedo_rgb=np.std(la, 0).round(3).tolist())
        contrib = ((Dv_ok[m][:, :, None] + Iv_ok[m]) * (wts[:, None] * cols)[None]) @ LUMW          # (v, NB)
        ind = (Iv_ok[m] * (wts[:, None] * cols)[None]) @ LUMW
        budget[k] = dict(zip(BASES, (contrib.sum(0) / contrib.sum()).round(3).tolist()))
        budget[k]["indirect_share"] = round(float(ind.sum() / contrib.sum()), 3)
    print(json.dumps(spread, indent=1)); print(json.dumps(budget, indent=1))

    # final: capture irradiance for every splat (memory-mapped output)
    B = radiosity(F, rho, Pdir)
    Iprobe = probe_indirect(probes.P[probes.kp], pt, B)                                # (kp,10,3,6)
    Wc = (wts[:, None] * cols).astype(np.float32)
    Imix = torch.einsum("pbcd,bc->pcd", Iprobe, torch.from_numpy(Wc))
    out = np.lib.format.open_memmap(f"{WORK}/npy/E_cap.npy", mode="w+", dtype=np.float32, shape=(store.N, 3))
    for sl in store.chunks(200_000):
        n, iso = store.normals(sl)
        out[sl] = direct(store, sl) @ Wc + eval_cubes(probes, Imix, store.pos[sl], n, iso)
    out.flush(); del out
    np.savez(f"{WORK}/fit_state.npz", rho=rho, Pdir_cap=Pdir, weights=wts, cols=cols, Wc=Wc, gamma=np.array(gam))
    json.dump({"bases": BASES, "weights": wts.tolist(), "colours": cols.tolist(), "sky_weights_capture": SKY_W.tolist(),
               "gamma": gam, "groups": GROUPS, "group_albedo_mean": np.exp(mu).tolist(), "paint_albedo_green": PAINT_ALBEDO,
               "history": history, "spread": spread, "budget": budget},
              open(f"{WORK}/fit.json", "w"), indent=1)
    print("done", f"{time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
