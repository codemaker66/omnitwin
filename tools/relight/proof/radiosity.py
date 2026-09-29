"""Inter-reflection on the room box: 0.5 m patches (floor, flat ceiling incl. the dome opening, four walls;
window openings reflect nothing), Jacobi radiosity, and irradiance cubes at the probe volume.
Shared by 04_fit.py (capture light) and 05_relight.py (target light)."""
import numpy as np
import torch
from common import *
import lt

F32 = torch.float32
DIRS = [(0, 1.0), (0, -1.0), (1, 1.0), (1, -1.0), (2, 1.0), (2, -1.0)]


def load_patches():
    return dict(np.load(f"{WORK}/patches.npz"))


def form_factors(P, N, A, opening):
    Pt = torch.tensor(P, dtype=F32); Nt = torch.tensor(N, dtype=F32); At = torch.tensor(A, dtype=F32)
    V = Pt[None, :, :] - Pt[:, None, :]                 # i -> j
    r2 = (V ** 2).sum(-1)
    D = V / r2.clamp(min=1e-8).sqrt()[..., None]
    ci = (Nt[:, None, :] * D).sum(-1).clamp(min=0)
    cj = (-(Nt[None, :, :] * D)).sum(-1).clamp(min=0)
    F = ci * cj * At[None, :] / (np.pi * r2 + At[None, :])
    F.fill_diagonal_(0)
    F[:, torch.tensor(opening)] = 0.0
    return F


def radiosity(F, rho, Edir, iters=40):
    """rho (P,3) albedo, Edir (P,K) or (P,K,3) direct irradiance -> radiosity B (P,K,3) = rho (Edir + F B)."""
    rho_t = torch.tensor(rho, dtype=F32)[:, None, :]
    E = torch.tensor(Edir, dtype=F32)
    if E.dim() == 2:
        E = E[..., None]
    B = rho_t * E
    for _ in range(iters):
        B = rho_t * (E + torch.einsum("ij,jkc->ikc", F, B))
    return B


def probe_indirect(Pprobe, patches, B, chunk=800):
    """Indirect ambient cubes (M, K, 3, 6) at probe points from patch radiosity B (P,K,3)."""
    Pp = torch.tensor(patches["P"], dtype=F32); Np = torch.tensor(patches["N"], dtype=F32); Ap = torch.tensor(patches["A"], dtype=F32)
    K, C = B.shape[1], B.shape[2]
    Bf = B.reshape(B.shape[0], K * C)
    out = torch.zeros((len(Pprobe), K * C, 6), dtype=F32)
    Q = torch.tensor(np.asarray(Pprobe), dtype=F32)
    for a in range(0, len(Q), chunk):
        V = Pp[None] - Q[a:a + chunk][:, None]          # probe -> patch
        r2 = (V ** 2).sum(-1)
        D = V / r2.clamp(min=1e-8).sqrt()[..., None]
        cj = (-(Np[None] * D)).sum(-1).clamp(min=0)
        w = cj * Ap[None] / (np.pi * r2 + Ap[None])     # irradiance per unit radiosity, normal to D
        for k, (comp, sgn) in enumerate(DIRS):
            out[a:a + chunk, :, k] = (w * (sgn * D[..., comp]).clamp(min=0)) @ Bf
    return out.reshape(len(Pprobe), K, C, 6)


def patch_sun(occ, pt, s):
    """Lit fraction x cosine of the direct sun (unit vector s toward the sun) on each patch (4x4 sub-samples)."""
    P, Nn = pt["P"], pt["N"]
    ax = np.argmax(np.abs(Nn), 1); a1 = (ax + 1) % 3; a2 = (ax + 2) % 3
    acc = np.zeros(len(P), np.float32)
    for u in (-0.1875, -0.0625, 0.0625, 0.1875):
        for v in (-0.1875, -0.0625, 0.0625, 0.1875):
            off = np.zeros_like(P)
            off[np.arange(len(P)), a1] = u; off[np.arange(len(P)), a2] = v
            acc += lt.sun_direct(occ, P + off + Nn * 0.02, s).numpy()
    return acc / 16.0 * np.clip(Nn @ s, 0, None)
