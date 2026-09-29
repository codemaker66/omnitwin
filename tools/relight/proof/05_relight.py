"""Scenario light and per-splat colour multipliers for the relight proof (research only).
  python 05_relight.py <scenario> [<scenario> ...]
Receivers: M = (E_target / E_capture)^gamma per channel (gamma = the capture's fitted contrast), where both
irradiances come from the same light model
(window light through the measured window cookie, direct sun, cove / chandelier / dome lights, and
inter-reflection on the room box with the fitted albedo), so M carries only the change of light.
Rules, not ratios, for the things that are not reflectors:
  * the view out of the windows (env skybox, splats beyond the glass, pane haze in empty cookie cells):
    an exterior colour transform per scenario;
  * chandelier bulbs/crystals and dome-ring lamps: lit = captured radiance with clipped highlights
    restored (x4 at the brightest), unlit = a grey-brass fixture lit by the scenario light, off = black;
  * all splats inside a chandelier volume follow the fixture rule when the lights are off.
Writes work/mult/<scenario>.f16 (raw float16, N x 4 = R, G, B multiplier, 1) and work/mult/<scenario>.json.
"""
import json
import os
import sys
import time
import numpy as np
import torch
from scipy.ndimage import maximum_filter
from common import *
import lt
from radiosity import form_factors, radiosity, probe_indirect, patch_sun, load_patches
from store import Store, Probes, eval_cubes, LUMW, mm

torch.set_num_threads(8)
SKY_W = np.array([0.15, 0.66, 1.0, 1.21], np.float32)
FIT = np.load(f"{WORK}/fit_state.npz")
W = FIT["weights"]; COLS = FIT["cols"]; WC = FIT["Wc"]; RHO = FIT["rho"]; PDIR_CAP = FIT["Pdir_cap"]
GAMMA = float(FIT["gamma"]) if "gamma" in FIT.files else 1.0     # capture contrast: C = (albedo E)^gamma
T_DAY_CAPTURE = 6500.0      # the capture's daylight was diffuse (fitted sun weight 0): its white is taken as 6500 K
EMIT_BOOST = 4.0

SCENARIOS = {
    # house lights at their captured intensities and colours; no daylight; night outside
    "night": dict(sky=0.0, sun=None, house=1.0, emit="lit", ext_rgb=(0.030, 0.042, 0.085), ext_desat=0.85),
    # clear morning, 09:00 BST (sun az 99, el 33): sun through all five ESE windows, clear-sky daylight, house lights off
    "sunny_morning": dict(sky=0.7, sky_T=9000.0, sun=(2026, 5, 31, 8, 0), sun_ratio=16.0, sun_T=4900.0, house=0.0,
                          emit="unlit", ext_rgb=(1.08, 1.04, 1.0), ext_desat=0.0),
    # overcast noon: diffuse sky only, house lights off
    "overcast_noon": dict(sky=1.2, sky_T=6500.0, sun=None, house=0.0, emit="unlit", ext_rgb=(1.0, 1.0, 1.02), ext_desat=0.35),
    # linear components (photo comparisons and the linearity check): capture = comp_sky + comp_house
    "comp_house": dict(sky=0.0, sun=None, house=1.0, emit="lit", ext_rgb=(0.0, 0.0, 0.0), ext_desat=0.0),
    "comp_sky": dict(sky=1.0, sky_T=6500.0, sun=None, house=0.0, emit="off", ext_rgb=(1.0, 1.0, 1.0), ext_desat=0.0),
    # diagnostic: the capture with its modelled light divided out (albedo under uniform white light)
    "delit": dict(delit=True),
    # Matterport day photos (overcast, house lights on, a different day): unknown daylight:house balance,
    # bracketed at half and twice the capture's (the capture itself is the 1x member)
    "day_a050": dict(sky=0.5, sky_T=6500.0, sun=None, house=1.0, emit="lit", ext_rgb=(0.5, 0.5, 0.5), ext_desat=0.0),
    "day_a200": dict(sky=2.0, sky_T=6500.0, sun=None, house=1.0, emit="lit", ext_rgb=(2.0, 2.0, 2.0), ext_desat=0.0),
    # image-space masks for the photo comparisons: red = view out of the windows, green = light fixtures
    "mask": dict(mask=True),
}


def daylight_rgb(T):
    """Linear sRGB (G = 1) of the CIE daylight locus at correlated colour temperature T (4000-25000 K)."""
    x = (-4.6070e9 / T ** 3 + 2.9678e6 / T ** 2 + 0.09911e3 / T + 0.244063) if T <= 7000 else \
        (-2.0064e9 / T ** 3 + 1.9018e6 / T ** 2 + 0.24748e3 / T + 0.237040)
    y = -3.0 * x * x + 2.87 * x - 0.275
    M = np.array([[3.2406, -1.5372, -0.4986], [-0.9689, 1.8758, 0.0415], [0.0557, -0.2040, 1.0570]])
    rgb = M @ np.array([x / y, 1.0, (1 - x - y) / y])
    return rgb / rgb[1]


def cct_shift(T):
    r = daylight_rgb(T) / daylight_rgb(T_DAY_CAPTURE)
    return (r / r[1]).astype(np.float32)


def cookie():
    """Window cookie occupancy dilated by one cell (3 cm, glass zone) and by two cells (6 cm, curtain zone)."""
    g = np.load(f"{WORK}/occ_cookie.npz")
    occ = g["occ"].astype(np.float32)
    return (maximum_filter(occ, size=3), maximum_filter(occ, size=5)), g["occ_lo"], float(g["occ_res"])


def exterior_masks(p, cls, occ, opa=None, lum_of=None):
    """Exterior splats and pane haze: inside a window opening, behind the reveal face, clear of the measured
    solids. Near the glass (within 15 cm of the pane or beyond it): empty cell at 3 cm dilation. In front of
    the glass (the curtain and column zone): empty at 6 cm dilation and low opacity (< 0.3), so curtain
    splats that sit a few cm off their LiDAR cells stay receivers."""
    (g3, g5), lo, res = occ
    ext = cls == 2
    depth = Y0 - p[:, 1]
    cand = np.zeros(len(p), bool); near_glass = np.zeros(len(p), bool)
    for w, (x0, x1, dg, z0, z1, kind) in WINDOWS.items():
        inw = (cls == 1) & (depth > 0.12) & (depth < dg + 0.35) & np.asarray(lt.inside_outline(p[:, 0], p[:, 2], w, grow=-0.04))
        cand |= inw
        near_glass |= inw & (depth > dg - 0.15)
    idx = np.where(cand)[0]
    ijk = np.floor((p[idx] - lo) / res).astype(np.int64)
    inb = np.all((ijk >= 0) & (ijk < np.array(g3.shape)), 1)
    a3 = np.ones(len(idx), np.float32); a5 = np.ones(len(idx), np.float32)
    a3[inb] = g3[ijk[inb, 0], ijk[inb, 1], ijk[inb, 2]]; a5[inb] = g5[ijk[inb, 0], ijk[inb, 1], ijk[inb, 2]]
    o = np.asarray(opa[idx], np.float32) if opa is not None else np.zeros(len(idx), np.float32)
    lum = lum_of(idx) if lum_of is not None else np.zeros(len(idx), np.float32)
    # near the glass: empty cell, or bright haze that the cookie build mistook for glazing bars
    # (dense splats, opacity >= 0.7, stay receivers: the real bars, lit by the room at night)
    ok = np.where(near_glass[idx], (a3 < 0.3) | ((lum > 0.45) & (o < 0.7)), (a5 < 0.3) & (o < 0.3))
    pane = np.zeros(len(p), bool)
    pane[idx[ok]] = True
    if lum_of is not None and opa is not None:
        room = np.zeros(len(p), bool)
        for w in WINDOWS:
            room |= (cls == 0) & (depth > -0.8) & (depth <= 0.12) & np.asarray(lt.inside_outline(p[:, 0], p[:, 2], w, grow=-0.03))
        ri = np.where(room)[0]
        if len(ri):
            glow = (lum_of(ri) > 0.55) & (np.asarray(opa[ri], np.float32) < 0.35)
            pane[ri[glow]] = True
    return ext | pane, pane


def cove_strip(p, cls, L):
    """Bright splats of the cove lamp line: 4.05-4.45 m up, within 0.4 m of a wall plane, captured luminance > 0.4."""
    z = p[:, 2]
    near = (np.abs(p[:, 0] - X0) < 0.4) | (np.abs(p[:, 0] - X1) < 0.4) | (np.abs(p[:, 1] - Y1) < 0.4) | (np.abs(p[:, 1] - Y0) < 0.4)
    in_opening = np.zeros(len(p), bool)            # the fanlights' glow is the view out, not the lamp line
    for w in WINDOWS:
        in_opening |= np.asarray(lt.inside_outline(p[:, 0], p[:, 2], w, grow=0.15)) & (p[:, 1] < Y0 + 0.6)
    return (cls == 0) & (z > 4.0) & (z < 4.55) & near & (L > 0.28) & ~in_opening


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def sun_samples(sc):
    """Three sun directions across +-2 minutes (softens the patch edges by about the solar disc)."""
    y, mo, d, hh, mi = sc["sun"]
    out = [sun_vec_e57(*solar_position(y, mo, d, hh, mi))]
    return out, solar_position(y, mo, d, hh, mi)


def scenario_light(sc):
    col_sky = (COLS[0] * cct_shift(sc.get("sky_T", T_DAY_CAPTURE))).astype(np.float32)
    col_sun = (COLS[0] * cct_shift(sc.get("sun_T", T_DAY_CAPTURE))).astype(np.float32)
    f_sun = sc.get("sun_ratio", 0.0) * sc["sky"] * float(np.mean(W[:5])) if sc["sun"] else 0.0
    return col_sky, col_sun, f_sun


def patch_direct(pt, sc, occ_lt, suns):
    col_sky, col_sun, f_sun = scenario_light(sc)
    E = np.zeros((len(pt["P"]), 3), np.float32)
    if sc["sky"] > 0:
        for wi in range(5):
            E += (pt["E_win"][:, wi * 4:(wi + 1) * 4] @ SKY_W)[:, None] * (W[wi] * sc["sky"] * col_sky)[None]
    if suns:
        s_acc = sum(patch_sun(occ_lt, pt, s) for s in suns) / len(suns)
        E += s_acc[:, None] * (f_sun * col_sun)[None]
    if sc["house"] > 0:
        E += sc["house"] * (PDIR_CAP[:, 6:10] @ WC[6:10])
    return E


def main(names):
    t0 = time.time()
    store = Store(); probes = Probes(); pt = load_patches()
    E_cap = mm("E_cap"); chand = mm("geom_chand_id"); scl = mm("splats_scl")
    # two-sided embrasure model (03c room side, 03d window side): C = rho E_room + tau E_back
    EMB_IDX = np.load(f"{WORK}/npy/emb_idx.npy"); EMB_BACK_WIN = mm("emb_E_back_win"); EMB_BACK_CAP = np.load(f"{WORK}/npy/emb_E_back_cap.npy")
    occ_lt = lt.load_occ(); occ_ck = cookie()
    F = form_factors(pt["P"], pt["N"], pt["A"], pt["opening"])
    os.makedirs(f"{WORK}/mult", exist_ok=True)
    for name in names:
        sc = SCENARIOS[name]
        rec = {"scenario": name, "params": dict(sc), "gamma": GAMMA}
        # written to a temp file and renamed on success: a failed allocation never leaves a zeroed multiplier
        out_path = f"{WORK}/mult/{name}.f16"; tmp_path = out_path + ".tmp"
        out = np.memmap(tmp_path, dtype=np.float16, mode="w+", shape=(store.N, 4))
        if sc.get("mask"):
            for sl in store.chunks(250_000):
                cls = np.asarray(store.cls[sl]); p = np.asarray(store.pos[sl])
                ext, _ = exterior_masks(p, cls, occ_ck, np.asarray(store.opa[sl]), lambda i, _sl=sl: store.colour(_sl)[i] @ LUMW)
                M = np.zeros((len(p), 3), np.float32)
                M[ext, 0] = 60.0; M[cls >= 3, 1] = 60.0
                out[sl, :3] = M.astype(np.float16); out[sl, 3] = 1
            out.flush(); del out; os.replace(tmp_path, out_path)
            json.dump(rec, open(f"{WORK}/mult/{name}.json", "w"), indent=1, default=str)
            print(name, "done", f"{time.time() - t0:.0f}s", flush=True)
            continue
        if sc.get("delit"):
            for sl in store.chunks(250_000):
                cls = np.asarray(store.cls[sl]); p = np.asarray(store.pos[sl])
                M = (0.75 / np.maximum(np.asarray(E_cap[sl]), 1e-4)) ** GAMMA
                ext, _ = exterior_masks(p, cls, occ_ck, np.asarray(store.opa[sl]), lambda i, _sl=sl: store.colour(_sl)[i] @ LUMW)
                M[ext | (cls >= 3)] = 1.0
                out[sl, :3] = np.clip(M, 0, 60).astype(np.float16); out[sl, 3] = 1
            out.flush(); del out; os.replace(tmp_path, out_path)
            json.dump(rec, open(f"{WORK}/mult/{name}.json", "w"), indent=1, default=str)
            print(name, "done", f"{time.time() - t0:.0f}s", flush=True)
            continue
        suns, sunpos = sun_samples(sc) if sc["sun"] else ([], None)
        if sunpos:
            rec["sun_az_el_deg"] = [round(sunpos[0], 2), round(sunpos[1], 2)]
        col_sky, col_sun, f_sun = scenario_light(sc)
        rec.update(col_sky=col_sky.tolist(), col_sun=col_sun.tolist(), f_sun=f_sun)
        Ep = patch_direct(pt, sc, occ_lt, suns)
        B = radiosity(F, RHO, Ep[:, None, :])
        It = probe_indirect(probes.P[probes.kp], pt, B).reshape(len(probes.kp), 3, 6)
        print(f"{name}: patch light + radiosity {time.time() - t0:.0f}s", flush=True)
        mstat = {k: [] for k in ("interior", "embrasure", "exterior", "emitter")}
        lit_count = 0
        for sl in store.chunks(250_000):
            p = np.asarray(store.pos[sl]); cls = np.asarray(store.cls[sl]); n, iso = store.normals(sl)
            Ec = np.asarray(E_cap[sl])
            E = np.zeros((len(p), 3), np.float32)
            if sc["sky"] > 0:
                Ew = np.asarray(store.E_win[sl], np.float32)
                for wi in range(5):
                    E += (Ew[:, wi * 4:(wi + 1) * 4] @ SKY_W)[:, None] * (W[wi] * sc["sky"] * col_sky)[None]
            s_back = None
            if suns:
                ii = np.where((cls == 0) | (cls == 1))[0]
                s_acc = np.zeros(len(p), np.float32); s_back = np.zeros(len(p), np.float32)
                # visibility averaged over the splat's footprint (centre and +-1 sigma of its largest scale in
                # its surface plane): a large floor splat straddling a patch edge takes a partial value
                smax = np.clip(np.asarray(scl[sl], np.float32)[ii, 2], 0.005, 0.15)[:, None]
                nn = n[ii]
                a = np.where(np.abs(nn[:, 2:3]) < 0.9, np.array([[0, 0, 1.0]]), np.array([[1.0, 0, 0]]))
                t1 = np.cross(nn, a); t1 /= np.maximum(np.linalg.norm(t1, axis=1, keepdims=True), 1e-6)
                t2 = np.cross(nn, t1)
                offs = [np.zeros_like(t1), t1 * smax, -t1 * smax, t2 * smax, -t2 * smax]
                for s in suns:
                    cosv = np.where(iso[ii], 0.25, np.clip(nn @ s, 0, None))
                    vis = sum(lt.sun_direct(occ_lt, p[ii] + o, s).numpy() for o in offs) / len(offs)
                    s_acc[ii] += vis * cosv
                    s_back[ii] += vis * max(0.0, -float(s[1]))      # sun on the window-side face
                s_acc /= len(suns); s_back /= len(suns)
                lit_count += int((s_acc > 0.05).sum())
                E += s_acc[:, None] * (f_sun * col_sun)[None]
            if sc["house"] > 0:
                ch = np.asarray(store.E_ch[sl])
                E += sc["house"] * (np.asarray(store.E_cove[sl])[:, None] * WC[6] + ch[:, :1] * WC[7] + ch[:, 1:] * WC[8]
                                    + np.asarray(store.E_dome[sl])[:, None] * WC[9])
            E += eval_cubes(probes, It, p, n, iso)
            M = (E / np.maximum(Ec, 1e-4)) ** GAMMA
            C = store.colour(sl); L = C @ LUMW
            # embrasure (curtains, bars, reveals): room-side reflectance rho (capped at 0.8) plus whatever the
            # capture shows beyond that, attributed to light from the window side (tau): a back-lit curtain
            # keeps its glow by day and falls to rho * room light at night
            e_loc = np.where(cls == 1)[0]
            if len(e_loc):
                # the window-side glow scales with the exterior light: sky level x colour shift of the scenario
                # (the absolute back-face irradiance is unreliable for splats on a curtain's room face, whose rays
                # to the glass cross their own fabric in the LiDAR cookie, so only the change is used)
                r_back = (sc["sky"] * col_sky / COLS[0]).astype(np.float32)
                Er_c = Ec[e_loc]
                rho = np.minimum(C[e_loc] / np.maximum(Er_c, 1e-4), 0.8)
                excess = np.maximum(C[e_loc] - rho * Er_c, 0.0)
                M[e_loc] = (rho * E[e_loc] + excess * r_back[None]) / np.maximum(C[e_loc], 1e-4)
            emit = cls >= 3
            in_ch = np.asarray(chand[sl]) >= 0
            cove = cove_strip(p, cls, L)          # the lamp line under the frieze: a fixture, not a reflector
            if sc["emit"] == "lit":
                M[emit] = (1.0 + (EMIT_BOOST - 1.0) * smoothstep(0.45, 0.9, L[emit]))[:, None]
                M[cove] = 1.0
            elif sc["emit"] == "off":
                M[emit | cove] = 0.0
            else:
                fx = emit | in_ch | cove
                chroma = np.clip(C[fx] / np.maximum(L[fx], 1e-4)[:, None], 0.5, 2.0) ** 0.4   # keep a hint of brass
                A = np.where((cls[fx] == 4)[:, None], 0.5, 0.35) * chroma
                A[cove[fx]] = 0.3                     # the lamp recess and moulding, neutral
                M[fx] = (A * E[fx]) ** GAMMA / np.maximum(C[fx], 1e-4)
            ext, pane = exterior_masks(p, cls, occ_ck, np.asarray(store.opa[sl]), lambda i, _sl=sl: store.colour(_sl)[i] @ LUMW)
            er = np.array(sc["ext_rgb"], np.float32); d = sc["ext_desat"]
            M[ext] = ((1 - d) + d * L[ext][:, None] / np.maximum(C[ext], 1e-4)) * er[None]
            M = np.clip(np.nan_to_num(M, nan=0.0, posinf=60.0), 0.0, 60.0)
            out[sl, :3] = M.astype(np.float16); out[sl, 3] = 1
            ml = M @ LUMW
            for k, m in (("interior", (cls == 0) & ~in_ch), ("embrasure", (cls == 1) & ~pane), ("exterior", ext), ("emitter", emit)):
                if m.any():
                    mstat[k].append(ml[m][::7])
        out.flush(); del out; os.replace(tmp_path, out_path)
        rec["stats"] = {"M_lum_p10_p50_p90_by_class": {k: [round(float(q), 4) for q in np.percentile(np.concatenate(v), [10, 50, 90])]
                                                        for k, v in mstat.items() if v},
                        "sunlit_splats": lit_count}
        json.dump(rec, open(f"{WORK}/mult/{name}.json", "w"), indent=1, default=str)
        print(name, json.dumps(rec["stats"]), f"{time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main(sys.argv[1:] or list(SCENARIOS))
