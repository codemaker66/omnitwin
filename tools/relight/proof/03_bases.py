"""Direct-light bases for every splat, plus the patch model used for inter-reflection.

Per splat (receiver normal = architecture normal near the box planes, else local splat-centre PCA
when planar, else isotropic):
  E_ch  (N,2)   chandeliers: [4 end chandeliers, centre chandelier], unit intensity each
  E_dome(N,)    dome ring lights (seen through the dome opening), unit intensity each
  E_cove(N,)    cove line lights on the picture rail under the frieze, unit intensity per metre
  E_win (N,20)  exterior radiance through window w x {facade, sky 0-35, 35-55, 55-90 deg}, unit radiance
Window light is computed on a 0.2 m irradiance volume (ambient cubes, trilinear), except for
embrasure splats (curtains, columns, reveals), which are traced individually to their own window.

Patches: 0.5 m tiles on floor, flat ceiling (dome included) and the four walls, with the same
direct bases, for the radiosity solve in 04_fit.py.
Outputs work/bases.npz, work/probes.npz, work/patches.npz
"""
import time
import numpy as np
import torch
from common import *
import lt

PROBE = 0.2


def final_normals(p, cls, n_s, reliable):
    n = n_s.astype(np.float32).copy()
    iso = ~reliable.copy()
    near = 0.35
    g = np.load(f"{WORK}/geom.npz")
    dome_c = g["dome_c"]
    rd = np.hypot(p[:, 0] - dome_c[0], p[:, 1] - dome_c[1])
    inbox = (p[:, 0] > X0 - 0.3) & (p[:, 0] < X1 + 0.3) & (p[:, 1] > Y0 - 0.1) & (p[:, 1] < Y1 + 0.3)
    rules = [
        (inbox & (p[:, 2] < FLOOR_Z + 0.22), (0, 0, 1)),
        (inbox & (p[:, 2] > CEIL_Z - 0.30) & (p[:, 2] < CEIL_Z + 0.25) & (rd > 3.7), (0, 0, -1)),
        (inbox & (p[:, 0] < X0 + near) & (p[:, 2] > FLOOR_Z + 0.22) & (p[:, 2] < CEIL_Z - 0.3), (1, 0, 0)),
        (inbox & (p[:, 0] > X1 - near) & (p[:, 2] > FLOOR_Z + 0.22) & (p[:, 2] < CEIL_Z - 0.3), (-1, 0, 0)),
        (inbox & (p[:, 1] > Y1 - near) & (p[:, 2] > FLOOR_Z + 0.22) & (p[:, 2] < CEIL_Z - 0.3), (0, -1, 0)),
        (inbox & (p[:, 1] < Y0 + near) & (p[:, 1] > Y0 - 0.02) & (p[:, 2] > FLOOR_Z + 0.22) & (p[:, 2] < CEIL_Z - 0.3), (0, 1, 0)),
    ]
    for m, nv in rules:
        m = m & (cls == 0)
        nv = np.array(nv, np.float32)
        # keep a confident PCA normal that disagrees strongly (ledges, sills, mouldings), else the plane
        idx = np.where(m)[0]
        keep_pca = reliable[idx] & (np.abs(n[idx] @ nv) < 0.5)
        use = idx[~keep_pca]
        n[use] = nv
        iso[use] = False
    # dome interior: normal toward the dome centre point
    dm = (cls == 0) & (rd < 3.7) & (p[:, 2] > CEIL_Z - 0.3)
    c = np.array([dome_c[0], dome_c[1], CEIL_Z])
    v = c[None] - p[dm]
    n[dm] = (v / np.maximum(np.linalg.norm(v, axis=1, keepdims=True), 1e-6)).astype(np.float32)
    iso[dm] = False
    iso[cls != 0] = True
    return n, iso


def probe_grid(p, cls):
    xs = np.arange(X0 - 0.1, X1 + 0.1 + 1e-6, PROBE); ys = np.arange(Y0 - 0.1, Y1 + 0.1 + 1e-6, PROBE)
    zs = np.arange(-0.1, 9.9 + 1e-6, PROBE)
    G = np.stack(np.meshgrid(xs, ys, zs, indexing="ij"), -1)
    shape = G.shape[:3]
    P = G.reshape(-1, 3)
    inside = (P[:, 0] > X0 - 0.01) & (P[:, 0] < X1 + 0.01) & (P[:, 1] > Y0 + 0.01) & (P[:, 1] < Y1 + 0.01) & (P[:, 2] > FLOOR_Z - 0.01)
    occ = np.zeros(shape, bool)
    q = p[(cls != 2)]
    ijk = np.round((q - np.array([xs[0], ys[0], zs[0]])) / PROBE).astype(int)
    ok = np.all((ijk >= 0) & (ijk < np.array(shape)), 1)
    occ[ijk[ok, 0], ijk[ok, 1], ijk[ok, 2]] = True
    from scipy.ndimage import binary_dilation
    near = binary_dilation(occ, iterations=3).reshape(-1)
    keep = inside & near
    return P, shape, (xs[0], ys[0], zs[0]), keep


def trilinear_weights(q, origin, shape, valid):
    """Indices (M,8) and weights (M,8) into the flattened probe grid, renormalised over valid probes."""
    f = (q - np.array(origin)) / PROBE
    i0 = np.floor(f).astype(np.int64)
    i0 = np.clip(i0, 0, np.array(shape) - 2)
    t = np.clip(f - i0, 0, 1)
    idx = np.zeros((len(q), 8), np.int64); w = np.zeros((len(q), 8), np.float32)
    k = 0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                ii = ((i0[:, 0] + dx) * shape[1] + (i0[:, 1] + dy)) * shape[2] + (i0[:, 2] + dz)
                ww = (t[:, 0] if dx else 1 - t[:, 0]) * (t[:, 1] if dy else 1 - t[:, 1]) * (t[:, 2] if dz else 1 - t[:, 2])
                ww = ww * valid[ii]
                idx[:, k] = ii; w[:, k] = ww; k += 1
    s = w.sum(1, keepdims=True)
    w = np.where(s > 1e-6, w / np.maximum(s, 1e-6), 0)
    return idx, w, (s[:, 0] > 1e-6)


def box_patches(size=0.5):
    P, Nn, A = [], [], []
    def plane(u0, u1, v0, v1, fn):
        nu = max(1, int(round((u1 - u0) / size))); nv = max(1, int(round((v1 - v0) / size)))
        du = (u1 - u0) / nu; dv = (v1 - v0) / nv
        for i in range(nu):
            for j in range(nv):
                pt, nn = fn(u0 + (i + 0.5) * du, v0 + (j + 0.5) * dv)
                P.append(pt); Nn.append(nn); A.append(du * dv)
    plane(X0, X1, Y0, Y1, lambda u, v: ((u, v, FLOOR_Z), (0, 0, 1)))
    plane(X0, X1, Y0, Y1, lambda u, v: ((u, v, CEIL_Z), (0, 0, -1)))
    plane(Y0, Y1, FLOOR_Z, CEIL_Z, lambda u, v: ((X0, u, v), (1, 0, 0)))
    plane(Y0, Y1, FLOOR_Z, CEIL_Z, lambda u, v: ((X1, u, v), (-1, 0, 0)))
    plane(X0, X1, FLOOR_Z, CEIL_Z, lambda u, v: ((u, Y1, v), (0, -1, 0)))
    plane(X0, X1, FLOOR_Z, CEIL_Z, lambda u, v: ((u, Y0, v), (0, 1, 0)))
    P = np.array(P); Nn = np.array(Nn, float); A = np.array(A)
    opening = np.zeros(len(P), bool)
    onY0 = Nn[:, 1] > 0.5
    for w in lt.WIN_NAMES:
        opening |= onY0 & np.asarray(lt.inside_outline(P[:, 0], P[:, 2], w)).astype(bool)
    return P, Nn, A, opening


def main():
    t0 = time.time()
    d = np.load(f"{WORK}/splats.npz"); g = np.load(f"{WORK}/geom.npz")
    p = d["pos"].astype(np.float64); cls = g["cls"]; reliable = g["reliable"]
    N = len(p)
    n, iso = final_normals(p, cls, g["n_s"], reliable)
    print("normals: iso fraction", iso.mean().round(3), "interior iso", iso[cls == 0].mean().round(3), f"{time.time() - t0:.0f}s", flush=True)
    occ = lt.load_occ()
    nt = torch.from_numpy(n); isot = torch.from_numpy(iso)

    # ---------------- window irradiance volume
    P, shape, origin, keep = probe_grid(p, cls)
    print("probes kept", int(keep.sum()), "of", len(P), flush=True)
    cubes = np.zeros((len(P), lt.N_WBASES, 6), np.float32)
    kp = np.where(keep)[0]
    B = 20000
    for a in range(0, len(kp), B):
        ii = kp[a:a + B]
        cubes[ii] = lt.window_cubes(occ, P[ii], nx=12, nz=18).numpy()
        print(f"  window probes {a + len(ii)}/{len(kp)} {time.time() - t0:.0f}s", flush=True)
    np.savez(f"{WORK}/probes.npz", P=P.astype(np.float32), shape=np.array(shape), origin=np.array(origin), keep=keep,
             win_cubes=cubes.astype(np.float16))

    # per splat: trilinear window cubes (receivers clamped just inside the room box)
    E_win = np.zeros((N, lt.N_WBASES), np.float32)
    rec = np.where(cls != 1)[0]
    for a in range(0, len(rec), 500000):
        ii = rec[a:a + 500000]
        q = p[ii].copy()
        q[:, 0] = np.clip(q[:, 0], X0 + 0.02, X1 - 0.02); q[:, 1] = np.clip(q[:, 1], Y0 + 0.02, Y1 - 0.02)
        q[:, 2] = np.clip(q[:, 2], FLOOR_Z + 0.02, 9.8)
        idx, w, okw = trilinear_weights(q, origin, shape, keep.astype(np.float32))
        cube = (torch.from_numpy(cubes[idx].astype(np.float32)) * torch.from_numpy(w)[..., None, None]).sum(1)
        E_win[ii] = lt.cube_eval(cube, nt[ii], isot[ii]).numpy()
    print("window light interpolated", f"{time.time() - t0:.0f}s", flush=True)
    # embrasure receivers traced individually to their own window
    emb = np.where(cls == 1)[0]
    for wi, w in enumerate(lt.WIN_NAMES):
        x0, x1 = WINDOWS[w][0], WINDOWS[w][1]
        sel = emb[(p[emb, 0] > x0 - 0.3) & (p[emb, 0] < x1 + 0.3)]
        for a in range(0, len(sel), 60000):
            ii = sel[a:a + 60000]
            c = lt.window_cubes(occ, p[ii], nx=6, nz=9, windows=[wi])
            E_win[ii] = lt.cube_eval(c, nt[ii], isot[ii]).numpy()
        print(f"  embrasure {w}: {len(sel)} splats {time.time() - t0:.0f}s", flush=True)

    # ---------------- house lights, per splat
    ch = g["chandeliers"]
    E_ch = np.zeros((N, 2), np.float32); E_dome = np.zeros(N, np.float32); E_cove = np.zeros(N, np.float32)
    ring = lt.dome_ring_lights(p, cls, g["dome_c"])
    print("dome ring lights found", len(ring), flush=True)
    for a in range(0, N, 400000):
        sl = slice(a, min(N, a + 400000))
        pc = torch.from_numpy(p[sl]).float()
        c = lt.point_cubes(pc, ch, rmin=0.30)                  # (M,5,6)
        e = lt.cube_eval(c, nt[sl], isot[sl])                 # (M,5)
        E_ch[sl, 0] = (e[:, [0, 1, 3, 4]]).sum(1).numpy(); E_ch[sl, 1] = e[:, 2].numpy()
        if len(ring):
            c = lt.point_cubes(pc, ring, rmin=0.30) * lt.dome_visible(pc, ring, g["dome_c"])[..., None]
            E_dome[sl] = lt.cube_eval(c, nt[sl], isot[sl]).sum(1).numpy()
    print("chandeliers + dome", f"{time.time() - t0:.0f}s", flush=True)
    up = np.where(p[:, 2] > lt.COVE_Z - 0.02)[0]
    for a in range(0, len(up), 200000):
        ii = up[a:a + 200000]
        c = lt.cove_cubes(p[ii])
        E_cove[ii] = lt.cube_eval(c, nt[ii], isot[ii]).numpy()
        print(f"  cove {a + len(ii)}/{len(up)} {time.time() - t0:.0f}s", flush=True)
    np.savez(f"{WORK}/bases.npz", n=n.astype(np.float16), iso=iso, E_win=E_win.astype(np.float16), E_ch=E_ch, E_dome=E_dome,
             E_cove=E_cove, ring=ring)

    # ---------------- patches
    Pp, Np, Ap, opening = box_patches(0.5)
    q = Pp + Np * 0.03
    qq = np.c_[np.clip(q[:, 0], X0 + 0.02, X1 - 0.02), np.clip(q[:, 1], Y0 + 0.02, Y1 - 0.02), np.clip(q[:, 2], FLOOR_Z + 0.02, 9.8)]
    idx, w, okw = trilinear_weights(qq, origin, shape, keep.astype(np.float32))
    cube = (torch.from_numpy(cubes[idx].astype(np.float32)) * torch.from_numpy(w)[..., None, None]).sum(1)
    npt = torch.from_numpy(Np).float(); isop = torch.zeros(len(Pp), dtype=torch.bool)
    Pw = lt.cube_eval(cube, npt, isop).numpy()
    qc = torch.from_numpy(q).float()
    e = lt.cube_eval(lt.point_cubes(qc, ch, rmin=0.30), npt, isop).numpy()
    Pch = np.stack([e[:, [0, 1, 3, 4]].sum(1), e[:, 2]], 1)
    if len(ring):
        Pdome = lt.cube_eval(lt.point_cubes(qc, ring, rmin=0.30) * lt.dome_visible(qc, ring, g["dome_c"])[..., None], npt, isop).sum(1).numpy()
    else:
        Pdome = np.zeros(len(Pp))
    Pcove = lt.cube_eval(lt.cove_cubes(q), npt, isop).numpy()
    np.savez(f"{WORK}/patches.npz", P=Pp, N=Np, A=Ap, opening=opening, E_win=Pw, E_ch=Pch, E_dome=Pdome, E_cove=Pcove)
    print("patches", len(Pp), "openings", int(opening.sum()), f"done {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
