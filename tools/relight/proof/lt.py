"""Light transport for the relight proof (CPU, torch). E57 frame, metres.

Irradiance is carried as an "ambient cube": 6 values = irradiance on surfaces with normal
[+x, -x, +y, -y, +z, -z]; E(n) = sum_k n_k^2 cube[k, sign n_k]; isotropic receivers use the mean.

Windows: rays toward a window cross the inner wall plane (y = Y0) inside the opening, then march
through the measured embrasure occupancy (3 cm cells built from the embrasure splats: glazing bars,
curtains, columns, reveals) to the glass plane. Exterior radiance is split into the opposite
facade (below the measured street horizon, horizon.json) and three sky elevation bands.
"""
import json
import math
import numpy as np
import torch
from common import *

torch.set_num_threads(12)
F32 = torch.float32

HORIZON_FILE = CFG.paths["horizon"]
SKY_BANDS = [(0.0, 35.0), (35.0, 55.0), (55.0, 90.1)]
WIN_NAMES = list(WINDOWS.keys())
COVE_Z = 4.30
COVE_OFFSET = 0.12


# ------------------------------------------------------------------ geometry helpers
def load_occ(source="cookie"):
    """'cookie': LiDAR solids minus pane returns + splat glazing bars (02c_cookie.py, default);
    'e57': raw LiDAR occupancy; 'splat': embrasure splats (hazy panes, too opaque)."""
    path = {"cookie": f"{WORK}/occ_cookie.npz", "e57": f"{WORK}/occ_e57.npz", "splat": f"{WORK}/geom.npz"}[source]
    g = np.load(path)
    occ = torch.from_numpy(g["occ"].astype(np.float32))
    dims = torch.tensor(occ.shape)
    # store -log(1-alpha) per cell; transmittance of a march = exp(-sum * step/cell)
    dens = (-torch.log1p(-occ.clamp(0, 0.995))).reshape(-1).contiguous()
    return dict(dens=dens, dims=dims, lo=torch.tensor(g["occ_lo"], dtype=F32), res=float(g["occ_res"]))


def inside_outline(x, z, w, grow=0.0):
    x0, x1, dg, z0, z1, kind = WINDOWS[w]
    x0 -= grow; x1 += grow; z0 -= grow; z1 += grow
    ins = (x > x0) & (x < x1) & (z > z0) & (z < z1)
    if kind == "arch":
        r = (x1 - x0) / 2
        xc = (x0 + x1) / 2
        zs = z1 - r
        above = z > zs
        arch_ok = (x - xc) ** 2 + (z - zs) ** 2 < r * r
        ins = ins & (~above | arch_ok)
    return ins


def glass_samples(w, nx, nz, seed=0):
    """Fixed stratified sample points on the glass plane outline of window w (shared by all receivers,
    so the Monte Carlo pattern is spatially coherent: no probe-to-probe noise)."""
    x0, x1, dg, z0, z1, kind = WINDOWS[w]
    rng = np.random.default_rng(seed + 17 * (WIN_NAMES.index(w) + 1))
    gx = (np.arange(nx) + rng.uniform(0.2, 0.8, (nz, nx))) / nx
    gz = (np.arange(nz)[:, None] + rng.uniform(0.2, 0.8, (nz, nx))) / nz
    xs = x0 + gx * (x1 - x0); zs = z0 + gz * (z1 - z0)
    xs = xs.ravel(); zs = zs.ravel()
    keep = inside_outline(xs, zs, w)
    cell_area = (x1 - x0) * (z1 - z0) / (nx * nz)
    pts = np.stack([xs[keep], np.full(keep.sum(), Y0 - dg), zs[keep]], 1)
    return pts, cell_area


def bearing_deg(D):
    return (14.3 - torch.rad2deg(torch.atan2(D[:, 1], D[:, 0]))) % 360.0


_H = None


def horizon_deg(w_idx, az):
    """Opposite-facade horizon elevation (deg) seen from window w at azimuth az (deg)."""
    global _H
    if _H is None:
        h = json.load(open(HORIZON_FILE))
        prof = {}
        for key in ("south", "centre", "north"):
            d = h[f"{key}_window_z8.5"]
            a = np.array(sorted(int(k) for k in d)); v = np.array([d[str(k)] for k in a])
            prof[key] = (a, v)
        a = prof["south"][0]
        rows = [prof["south"][1], 0.5 * (prof["south"][1] + prof["centre"][1]), prof["centre"][1],
                0.5 * (prof["centre"][1] + prof["north"][1]), prof["north"][1]]
        _H = (torch.tensor(a, dtype=F32), torch.tensor(np.stack(rows), dtype=F32))
    a, rows = _H
    t = ((az - a[0]) / (a[1] - a[0])).clamp(0, len(a) - 1.001)
    i0 = t.floor().long(); f = t - i0
    r = rows[w_idx]
    return r[..., i0] * (1 - f) + r[..., (i0 + 1).clamp(max=len(a) - 1)] * f if r.dim() == 1 else \
        r.gather(1, i0[:, None]).squeeze(1) * (1 - f) + r.gather(1, (i0 + 1).clamp(max=len(a) - 1)[:, None]).squeeze(1) * f


def march(occ, Q, D, length, step=0.015, start=0.0):
    """Transmittance along Q + t D, t in [start, length], through the embrasure occupancy."""
    lo, res, dims, dens = occ["lo"], occ["res"], occ["dims"], occ["dens"]
    M = Q.shape[0]
    tau = torch.zeros(M, dtype=F32)
    if M == 0:
        return tau
    nmax = int(math.ceil(float(length.max()) / step)) + 1
    t = torch.full((M,), float(start), dtype=F32)
    alive = t < length
    d0, d1, d2 = int(dims[0]), int(dims[1]), int(dims[2])
    hi = torch.tensor([d0 - 1, d1 - 1, d2 - 1])
    for _ in range(nmax):
        idx = alive.nonzero().squeeze(1)
        if idx.numel() == 0:
            break
        pos = Q[idx] + D[idx] * t[idx, None]
        c = ((pos - lo) / res).floor().long()
        inb = (c >= 0).all(1) & (c <= hi).all(1)
        cc = torch.minimum(c.clamp(min=0), hi)
        lin = (cc[:, 0] * d1 + cc[:, 1]) * d2 + cc[:, 2]
        tau[idx] += torch.where(inb, dens[lin], torch.zeros(idx.numel())) * (step / res)
        t[idx] += step
        alive[idx] = (t[idx] < length[idx]) & (tau[idx] < 6.0)
    return torch.exp(-tau)


def trace_to_windows(occ, P, D):
    """For rays P + t D heading to the window wall (D_y < 0): window index (-1 = wall), transmittance."""
    M = P.shape[0]
    win = torch.full((M,), -1, dtype=torch.long)
    T = torch.zeros(M, dtype=F32)
    ok = D[:, 1] < -1e-3
    in_room = P[:, 1] > Y0
    safe_dy = torch.where(ok, D[:, 1], torch.full_like(D[:, 1], -1.0))
    tq = torch.where(in_room, (Y0 - P[:, 1]) / safe_dy, torch.zeros_like(P[:, 1]))
    Q = P + D * tq[:, None]
    for wi, w in enumerate(WIN_NAMES):
        x0, x1, dg, z0, z1, kind = WINDOWS[w]
        hit = ok & (win < 0) & in_room & inside_outline(Q[:, 0], Q[:, 2], w, grow=-0.05)
        emb_start = ok & (win < 0) & ~in_room & (P[:, 0] > x0 - 0.25) & (P[:, 0] < x1 + 0.25)
        hit = hit | emb_start
        idx = hit.nonzero().squeeze(1)
        if idx.numel() == 0:
            continue
        win[idx] = wi
        yg = Y0 - dg - 0.07
        length = ((Q[idx, 1] - yg) / (-safe_dy[idx])).clamp(min=0.0)
        too_long = length > 2.2
        # receivers inside the embrasure skip their own first 4.5 cm (their own occupied cell)
        start = torch.where(in_room[idx], torch.zeros(idx.numel()), torch.full((idx.numel(),), 0.045))
        Tw = torch.zeros(idx.numel(), dtype=F32)
        for s0 in (0.0, 0.045):
            sub = (start == s0).nonzero().squeeze(1)
            if sub.numel():
                Tw[sub] = march(occ, Q[idx][sub], D[idx][sub], length[sub].clamp(max=2.2), start=s0)
        Tw[too_long] = 0.0
        # the ray must also leave through the glass inside the opening (no leaks through masonry)
        tg = (P[idx, 1] - (Y0 - dg)) / (-safe_dy[idx])
        G = P[idx] + D[idx] * tg[:, None]
        Tw = torch.where(inside_outline(G[:, 0], G[:, 2], w, grow=-0.03), Tw, torch.zeros_like(Tw))
        T[idx] = Tw
    return win, T


def glass_t(cos_i):
    """Angular transmittance of clear single glazing relative to normal incidence: two Fresnel interfaces,
    Schlick reflectance with R0 = 0.04 (1.0 at normal, 0.94 at 60 deg, 0.77 at 70 deg, 0.38 at 80 deg)."""
    c = cos_i.clamp(0, 1) if torch.is_tensor(cos_i) else min(max(float(cos_i), 0.0), 1.0)
    R = 0.04 + 0.96 * (1 - c) ** 5
    return (1 - R) ** 2 / 0.9216


def add_cube(cube, D, val):
    """cube (M,6); D (M,3) direction toward the source; val (M,) irradiance normal to D."""
    cube[:, 0] += val * D[:, 0].clamp(min=0); cube[:, 1] += val * (-D[:, 0]).clamp(min=0)
    cube[:, 2] += val * D[:, 1].clamp(min=0); cube[:, 3] += val * (-D[:, 1]).clamp(min=0)
    cube[:, 4] += val * D[:, 2].clamp(min=0); cube[:, 5] += val * (-D[:, 2]).clamp(min=0)


N_WBASES = len(WIN_NAMES) * 4   # per window: facade, sky 0-35, sky 35-55, sky 55-90


def window_cubes(occ, P, nx=12, nz=18, windows=None, chunk=3000):
    """Ambient cubes (M, 20, 6) for unit exterior radiance per window x {facade, 3 sky bands}."""
    P = torch.as_tensor(P, dtype=F32)
    M = P.shape[0]
    out = torch.zeros((M, N_WBASES, 6), dtype=F32)
    wins = windows if windows is not None else list(range(len(WIN_NAMES)))
    for wi in wins:
        w = WIN_NAMES[wi]
        S, area = glass_samples(w, nx, nz)
        S = torch.tensor(S, dtype=F32)
        ns = S.shape[0]
        for a in range(0, M, chunk):
            Pc = P[a:a + chunk]
            m = Pc.shape[0]
            V = S[None, :, :] - Pc[:, None, :]
            r2 = (V ** 2).sum(-1).clamp(min=1e-4)
            D = V / r2.sqrt()[..., None]
            Df = D.reshape(-1, 3); Pf = Pc[:, None, :].expand(m, ns, 3).reshape(-1, 3)
            winid, T = trace_to_windows(occ, Pf, Df)
            T = torch.where(winid == wi, T, torch.zeros_like(T))
            domega = area * (-Df[:, 1]).clamp(min=0) / r2.reshape(-1)
            val = T * domega * glass_t(-Df[:, 1])
            el = torch.rad2deg(torch.asin(Df[:, 2].clamp(-1, 1)))
            az = bearing_deg(Df)
            hz = horizon_deg(wi, az)
            facade = el < hz
            band_id = torch.full(el.shape, -1, dtype=torch.long)
            band_id[facade] = 0
            for bi, (lo_, hi_) in enumerate(SKY_BANDS):
                band_id[~facade & (el >= lo_) & (el < hi_)] = 1 + bi
            for b in range(4):
                sel = (band_id == b).float()
                cub = torch.zeros((m * ns, 6), dtype=F32)
                add_cube(cub, Df, val * sel)
                out[a:a + m, wi * 4 + b] += cub.reshape(m, ns, 6).sum(1)
    return out


# ------------------------------------------------------------------ house lights
def point_cubes(P, L, rmin=0.25):
    """Cubes (M, K, 6) for K isotropic point lights of unit intensity."""
    P = torch.as_tensor(P, dtype=F32); L = torch.as_tensor(L, dtype=F32)
    M = P.shape[0]; K = L.shape[0]
    out = torch.zeros((M, K, 6), dtype=F32)
    for k in range(K):
        V = L[k][None] - P
        r2 = (V ** 2).sum(1).clamp(min=rmin * rmin)
        D = V / (V ** 2).sum(1).clamp(min=1e-8).sqrt()[:, None]
        cub = torch.zeros((M, 6), dtype=F32)
        add_cube(cub, D, 1.0 / r2)
        out[:, k] = cub
    return out


def dome_ring_lights(pos, cls, dome_c):
    """Dome-ring light positions from the class-4 emitter splats (angular clusters)."""
    q = pos[cls == 4]
    ang = np.degrees(np.arctan2(q[:, 1] - dome_c[1], q[:, 0] - dome_c[0])) % 360
    h, e = np.histogram(ang, bins=72, range=(0, 360))
    L = []
    for i in range(72):
        if h[i] > 0.25 * h.max() and h[i] >= h[(i - 1) % 72] and h[i] >= h[(i + 1) % 72]:
            a0 = e[i] - 5
            m = ((ang - a0) % 360) < 15
            if m.sum() > 20:
                L.append(q[m].mean(0))
    return np.array(L)


def dome_visible(P, L, dome_c, ceil_z=CEIL_Z, radius=3.55):
    """Ring lights sit above the flat ceiling plane: visible only through the dome opening."""
    P = torch.as_tensor(P, dtype=F32)
    vis = torch.zeros((P.shape[0], len(L)), dtype=F32)
    for k, l in enumerate(L):
        l = torch.tensor(l, dtype=F32)
        dz = l[2] - P[:, 2]
        t = ((ceil_z - P[:, 2]) / dz.clamp(min=1e-3)).clamp(0, 1)
        X = P + (l[None] - P) * t[:, None]
        r = torch.hypot(X[:, 0] - float(dome_c[0]), X[:, 1] - float(dome_c[1]))
        vis[:, k] = ((r < radius) | (P[:, 2] >= ceil_z)).float()
    return vis


def cove_sources(step=0.05):
    """Line sources along the four walls, just above the picture-rail moulding under the frieze."""
    pts = []
    inset = COVE_OFFSET
    for x in np.arange(X0 + 0.05, X1 - 0.05, step):
        pts.append((x, Y0 + inset)); pts.append((x, Y1 - inset))
    for y in np.arange(Y0 + 0.05, Y1 - 0.05, step):
        pts.append((X0 + inset, y)); pts.append((X1 - inset, y))
    S = np.array([[a, b, COVE_Z] for a, b in pts])
    return S, step


def cove_cubes(P, chunk=1500, step=0.05):
    """Upward Lambertian line emitters (unit radiant intensity per metre toward +z); nothing below
    the moulding (the rail blocks downward light)."""
    S, dl = cove_sources(step)
    S = torch.tensor(S, dtype=F32)
    P = torch.as_tensor(P, dtype=F32)
    M = P.shape[0]
    out = torch.zeros((M, 6), dtype=F32)
    idx = (P[:, 2] > COVE_Z - 0.02).nonzero().squeeze(1)
    comps = [(0, 1.0), (0, -1.0), (1, 1.0), (1, -1.0), (2, 1.0), (2, -1.0)]
    for a in range(0, idx.numel(), chunk):
        ii = idx[a:a + chunk]
        V = S[None] - P[ii][:, None]           # receiver -> source
        r2 = (V ** 2).sum(-1).clamp(min=0.03 ** 2)
        r = r2.sqrt()
        D = V / r[..., None]
        emit = (-D[..., 2]).clamp(min=0)       # source -> receiver goes upward
        val = emit * dl / r2
        cub = torch.zeros((ii.numel(), 6), dtype=F32)
        for k, (comp, sgn) in enumerate(comps):
            cub[:, k] = (val * (sgn * D[..., comp]).clamp(min=0)).sum(1)
        out[ii] = cub
    return out


# ------------------------------------------------------------------ sun
def sun_direct(occ, P, sun, chunk=300000):
    """Transmittance of the direct sun (unit vector toward the sun) to points P, through the
    window openings, embrasure occupancy and the opposite-facade horizon."""
    P = torch.as_tensor(P, dtype=F32)
    s = torch.tensor(np.asarray(sun), dtype=F32)
    M = P.shape[0]
    T = torch.zeros(M, dtype=F32)
    if float(s[1]) >= -1e-3:
        return T
    el = math.degrees(math.asin(float(s[2])))
    az = float(bearing_deg(s[None])[0])
    for a in range(0, M, chunk):
        Pc = P[a:a + chunk]
        D = s[None].expand(Pc.shape[0], 3).contiguous()
        win, Tc = trace_to_windows(occ, Pc, D)
        okw = win >= 0
        hz = horizon_deg(win.clamp(min=0), torch.full((Pc.shape[0],), az))
        T[a:a + chunk] = torch.where(okw & (el > hz), Tc, torch.zeros_like(Tc))
    return T * glass_t(abs(float(s[1])))


def cube_eval(cube, n, iso):
    """cube (M, ..., 6) torch; n (M,3) torch; iso (M,) bool -> (M, ...)."""
    extra = cube.dim() - 2
    def w(v):
        return v.reshape([-1] + [1] * extra)
    nx, ny, nz = n[:, 0], n[:, 1], n[:, 2]
    e = (w(nx.clamp(min=0) ** 2) * cube[..., 0] + w((-nx).clamp(min=0) ** 2) * cube[..., 1]
         + w(ny.clamp(min=0) ** 2) * cube[..., 2] + w((-ny).clamp(min=0) ** 2) * cube[..., 3]
         + w(nz.clamp(min=0) ** 2) * cube[..., 4] + w((-nz).clamp(min=0) ** 2) * cube[..., 5])
    return torch.where(w(iso), cube.mean(-1), e)
