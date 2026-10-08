"""python -m relight <command> [step] --config config/grand-hall.json"""
from __future__ import annotations

import argparse, gc, json, math, os, runpy, shutil, sys, time
from typing import Callable

import numpy as np

from . import config, gpulock

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROOF = os.path.join(HERE, "proof")

# The proof split its archives into memory-mapped tables after 03_bases.py in a step it never saved as a
# script: work/npy/<archive>_<key>.npy for every per-splat array (store.py maps them; 03b onwards update them).
TABLE_ARCHIVES = ("splats", "geom", "bases")
LAMP_RATIO = "lamp_daylight_ratio.json"


def _save_atomic(path: str, a: np.ndarray) -> None:
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        np.save(f, a)
    os.replace(tmp, path)


def _save_npz_if(path: str, passed: bool, failed_dir: str, **arrays) -> str:
    """Write the arrays as a compressed .npz, but into work/ only when the command's checks passed. Passed: written to a
    partial name beside `path` and renamed over it once complete, so an error or a crash leaves the previous artifact
    and no partial file. Not passed: written to <failed_dir>/<stem>-FAILED.npz for diagnosis and never beside `path`,
    where a later step could mistake it for a good artifact (the previous good one stays). Returns the path written."""
    if not passed:
        os.makedirs(failed_dir, exist_ok=True)
        kept = os.path.join(failed_dir, os.path.splitext(os.path.basename(path))[0] + "-FAILED.npz")
        with open(kept, "wb") as f:
            np.savez_compressed(f, **arrays)
        return kept
    part = path + ".part"
    try:
        with open(part, "wb") as f:
            np.savez_compressed(f, **arrays)
        os.replace(part, path)
    except BaseException:
        if os.path.exists(part):
            os.remove(part)
        raise
    return path


def _finite(x):
    """A JSON-safe copy of the evidence: non-finite floats (inf, -inf, nan; Python or numpy) become None, so a gate that
    measures an infinite error at a small K is written down instead of raising at the write; numpy scalars and arrays
    become Python numbers and lists."""
    if isinstance(x, dict):
        return {k: _finite(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_finite(v) for v in x]
    if isinstance(x, np.ndarray):
        return _finite(x.tolist())
    if isinstance(x, np.bool_):
        return bool(x)
    if isinstance(x, np.integer):
        return int(x)
    if isinstance(x, (float, np.floating)):
        v = float(x)
        return v if math.isfinite(v) else None
    return x


def split_tables(cfg: config.Config) -> None:
    """work/{splats,geom,bases}.npz -> work/npy/<archive>_<key>.npy, dtypes unchanged. sun_cap_E.npy (the
    capture-period sun) is written as NaN: 03b_window_fresnel.py computes it, but store.Store maps it first."""
    work = cfg.paths["work"]
    npy = os.path.join(work, "npy")
    os.makedirs(npy, exist_ok=True)
    with np.load(os.path.join(work, "splats.npz")) as z:
        n = int(z["pos"].shape[0])
    written = []
    for stem in TABLE_ARCHIVES:
        with np.load(os.path.join(work, f"{stem}.npz")) as z:
            for key in z.files:
                a = z[key]
                if a.ndim >= 1 and a.shape[0] == n:
                    _save_atomic(os.path.join(npy, f"{stem}_{key}.npy"), a)
                    written.append(f"{stem}_{key}")
    _save_atomic(os.path.join(npy, "sun_cap_E.npy"), np.full(n, np.nan, np.float32))
    print(f"tables: {len(written)} per-splat arrays, N = {n}: {' '.join(written)}; sun_cap_E NaN until fresnel", flush=True)


def stage_lamp_colour(cfg: config.Config) -> None:
    """The proof measured the lamp/daylight colour ratio from the capture's splats in an unsaved step; 04_fit.py
    reads it from work/. Copy the proof's measurement byte for byte, after checking it holds three positive numbers."""
    src = os.path.join(cfg.paths["proofWork"], LAMP_RATIO)
    with open(src, encoding="utf-8") as f:
        rgb = json.load(f).get("lamp_over_daylight_rgb")
    if not (isinstance(rgb, list) and len(rgb) == 3
            and all(isinstance(v, (int, float)) and math.isfinite(v) and v > 0 for v in rgb)):
        raise ValueError(f"{src}: lamp_over_daylight_rgb must be three positive numbers")
    shutil.copyfile(src, os.path.join(cfg.paths["work"], LAMP_RATIO))
    print(f"lamp colour: lamp/daylight {rgb} from {src}", flush=True)


# proof step -> (script, or a step done here; needs the GPU), in the proof's data order:
# 03c and 03d read the fit's fit_state.npz, so they run after the fit. No proof step needs the GPU:
# the scripts run torch on the CPU only (no CUDA), so none of them takes the shared GPU lock.
PROOF_STEPS: dict[str, tuple[str | Callable[[config.Config], None], bool]] = {
    "extract": ("01_extract.py", False),
    "geometry": ("02_geometry.py", False),
    "occupancy": ("02b_occ_e57.py", False),
    "cookie": ("02c_cookie.py", False),
    "bases": ("03_bases.py", False),
    "tables": (split_tables, False),
    "fresnel": ("03b_window_fresnel.py", False),
    "lamp-colour": (stage_lamp_colour, False),
    "fit": ("04_fit.py", False),
    "embrasure-room": ("03c_embrasure_roomside.py", False),
    "embrasure-back": ("03d_embrasure_back.py", False),
}
COMMANDS: dict = {}


def use_proof(cfg_path: str) -> None:
    """Make the moved proof scripts importable with the given config."""
    os.environ["RELIGHT_CONFIG"] = os.path.abspath(cfg_path)
    if PROOF not in sys.path:
        sys.path.insert(0, PROOF)


def _hold_gpu(step: str):
    try:
        with open(gpulock.LOCK, encoding="utf-8") as f:
            print(f"   waiting for the GPU lock: {f.read().strip() or 'holder not written yet'}", flush=True)
    except FileNotFoundError:
        pass
    return gpulock.hold(f"relight-bake {step}")


def run_proof(step: str, cfg_path: str) -> None:
    script, gpu = PROOF_STEPS[step]
    use_proof(cfg_path)
    if callable(script):
        script(config.load(cfg_path))
        return
    path = os.path.join(PROOF, script)
    old, old_argv = os.getcwd(), sys.argv
    os.chdir(PROOF)
    sys.argv = [path]           # the scripts read sys.argv; they must not see the CLI's arguments
    try:
        if gpu:
            t0 = time.time()
            with _hold_gpu(step):
                if time.time() - t0 > 1:
                    print(f"   GPU lock taken after {time.time() - t0:.0f}s", flush=True)
                runpy.run_path(path, run_name="__main__")
        else:
            runpy.run_path(path, run_name="__main__")
    finally:
        sys.argv = old_argv
        os.chdir(old)
        gc.collect()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="relight")
    ap.add_argument("command")
    ap.add_argument("step", nargs="?")
    ap.add_argument("--config", required=True)
    ap.add_argument("--from", dest="source", default=None)   # refit-house promote: the staging work folder (Task 4b)
    ap.add_argument("--w-crown", dest="w_crown", type=float, default=None)   # refit-house refit: a sensitivity run's w_crown
    ap.add_argument("--tag", default=None)                    # refit-house compare | install: a refit's folder (default refit)
    args = ap.parse_args(argv)
    cfg_path = os.path.abspath(args.config)
    cfg = config.load(cfg_path)
    os.makedirs(cfg.paths["work"], exist_ok=True)
    os.makedirs(cfg.paths["evidence"], exist_ok=True)
    if args.command == "proof":
        if args.step not in (None, "all") and args.step not in PROOF_STEPS:
            ap.error(f"unknown proof step {args.step}; one of all, {', '.join(PROOF_STEPS)}")
        steps = list(PROOF_STEPS) if args.step in (None, "all") else [args.step]
        for step in steps:
            t0 = time.time()
            print(f"== proof {step} {time.strftime('%Y-%m-%d %H:%M:%S')}", flush=True)
            run_proof(step, cfg_path)
            print(f"== proof {step} done in {time.time() - t0:.0f}s", flush=True)
        return 0
    if args.command in COMMANDS:
        use_proof(cfg_path)
        return COMMANDS[args.command](cfg, args)
    ap.error(f"unknown command {args.command}")
    return 2


def windows_volumes(cfg):
    """({name: WindowVolume}, {name: (360,) horizon}, (101,) fresnel) from <work>/windows.npz, in the config's order."""
    import numpy as np
    from . import windows as W
    names = list(cfg.room["windows"])
    with np.load(os.path.join(cfg.paths["work"], "windows.npz")) as wz:
        vols = {n: W.volume_from_arrays(n, wz[f"{n}_alpha"], wz[f"{n}_frame"]) for n in names}
        return vols, {n: wz[f"{n}_horizon"] for n in names}, wz["fresnel"]


def _cookie_volumes(cfg, quantise=True):
    import numpy as np
    import common
    from . import windows as W
    with np.load(os.path.join(cfg.paths["work"], "occ_cookie.npz")) as g:
        return W.volumes_from_occupancy(g["occ"], np.asarray(g["occ_lo"], np.float64), float(g["occ_res"]), common.WINDOWS,
                                        common.Y0, x_bearing=cfg.room["site"]["xBearingDeg"], quantise=quantise)


def cmd_windows(cfg, args) -> int:
    """<work>/windows.npz: per window {name}_alpha (uint8 x, y, z), {name}_frame (windows.FRAME_FIELDS),
    {name}_horizon (360 degrees by azimuth); fresnel (101 values for |cos| 0.00..1.00)."""
    import numpy as np
    import lt, torch
    from . import windows as W
    save = {}
    for i, (name, vol) in enumerate(_cookie_volumes(cfg).items()):
        save[f"{name}_alpha"], save[f"{name}_frame"] = W.volume_arrays(vol)
        save[f"{name}_horizon"] = np.array(W.horizon_table(
            lambda wi, az: float(lt.horizon_deg(torch.tensor([wi]), torch.tensor([az]))[0]), i), np.float32)
        print(f"{name}: {vol.alpha.shape} cells from {tuple(int(c) for c in vol.offset)}, "
              f"{int(np.count_nonzero(vol.alpha))} occupied, {vol.alpha.nbytes} bytes", flush=True)
    save["fresnel"] = np.array(W.fresnel_table(lambda c: float(lt.glass_t(c))), np.float32)
    np.savez_compressed(os.path.join(cfg.paths["work"], "windows.npz"), **save)
    print("windows.npz written", flush=True)
    return 0


COMMANDS["windows"] = cmd_windows

CHECK_SUNS = ((2026, 5, 31, 8, 0), (2026, 6, 21, 6, 0), (2026, 6, 21, 9, 0), (2026, 3, 20, 9, 0), (2026, 12, 21, 10, 30))
SPLAT_SAMPLE, SPLAT_SEED = 200_000, 20260930
GATE = {"iou": 0.85, "meanAbsDiff": 0.1, "floatAlphaMaxAbsDiff": 1e-4, "reachMissed": 0}


def _agreement(t3, twin, exact):
    """The twin against the proof's march, unrounded: lit-cell overlap and mean |dT| over the cells either lights
    (scored when there are any), largest |dT| and the share over 0.01; `exact` (float alpha) isolates the march from
    the alpha quantisation."""
    import numpy as np
    a, b = t3 > 0.3, twin > 0.3
    union = a | b
    d, de = np.abs(t3 - twin), np.abs(t3 - exact)
    return {"scored": bool(union.any()), "iou": float((a & b).sum() / max(union.sum(), 1)),
            "meanAbsDiff": float(d[union].mean()) if union.any() else 0.0,
            "maxAbsDiff": float(d.max()), "shareAbove001": float((d > 0.01).mean()),
            "lit3d": int(a.sum()), "litTwin": int(b.sum()),
            "floatAlphaMaxAbsDiff": float(de.max()), "floatAlphaShareAbove001": float((de > 0.01).mean())}


def _passes(row):
    return row["floatAlphaMaxAbsDiff"] <= GATE["floatAlphaMaxAbsDiff"] and \
        (not row["scored"] or (row["iou"] >= GATE["iou"] and row["meanAbsDiff"] <= GATE["meanAbsDiff"]))


def _step_stats(steps):
    import numpy as np
    m = steps[steps > 0]
    if not m.size:
        return {"marched": 0}
    return {"marched": int(m.size), "stepsMean": round(float(m.mean()), 3), "stepsP99": float(np.percentile(m, 99)),
            "stepsMax": int(m.max())}


def _random_suns(common, n, seed):
    """n sun directions facing the window wall at random days and times of 2026, any time of day with the sun up
    (so the northernmost summer sunrises are included), for the reach flag's coverage."""
    import datetime
    import numpy as np
    rng, out = np.random.default_rng(seed), []
    while len(out) < n:
        day = datetime.date(2026, 1, 1) + datetime.timedelta(days=int(rng.integers(0, 365)))
        minute = int(rng.integers(0, 24 * 60))
        az, el = common.solar_position(2026, day.month, day.day, minute // 60, minute % 60)
        s = common.sun_vec_e57(az, el)
        if el > 0.0 and s[1] < -1e-3:
            out.append(s)
    return out


MOON_EPOCH = (2020, 1, 1)       # the lunar draws span one nodal cycle from here, the 2024-25 major standstill inside


def _random_moons(cfg, n, seed):
    """n real moon directions (model frame, as _random_suns): moon.position, apparent and topocentric, at random
    instants over one nodal cycle (18.6 years from MOON_EPOCH), the moon up and facing the window wall."""
    import numpy as np
    from . import moon as MOON, windows as W
    site = cfg.room["site"]
    rng, out, jd0 = np.random.default_rng(seed), [], MOON.julian_day(*MOON_EPOCH)
    while len(out) < n:
        az, el, _dist = MOON.position(jd0 + rng.uniform(0.0, MOON.NODAL_CYCLE_DAYS), site["latitude"], site["longitude"])
        s = W.sun_vector(float(az), float(el), site["xBearingDeg"])
        if float(el) > 0.0 and s[1] < -W.MIN_DOWN:
            out.append(s)
    return out


def cmd_check_sun(cfg, args) -> int:
    """The twin (windows.sun_visibility) against the proof's lt.sun_direct, on the brief's floor points and on
    200,000 finest-level splats, for the five check suns; and the reach flag (windows.sun_reach) on every finest
    splat, which must cover every splat 48 random real suns, and 48 random real moons, light.
    Evidence: <evidence>/sun-check.json."""
    import json
    import numpy as np
    import common, lt
    from . import windows as W
    vols, horizons, fresnel = windows_volumes(cfg)
    exact = _cookie_volumes(cfg, quantise=False)
    xs = np.arange(common.X0 + 0.05, common.X1 - 0.05, 0.05); ys = np.arange(common.Y0 + 0.05, common.Y1 - 0.05, 0.05)
    X, Y = np.meshgrid(xs, ys, indexing="ij")
    pos = np.load(os.path.join(cfg.paths["work"], "npy", "splats_pos.npy"), mmap_mode="r")
    pick = np.sort(np.random.default_rng(SPLAT_SEED).choice(len(pos), SPLAT_SAMPLE, replace=False))
    sets = {"floor": np.stack([X.ravel(), Y.ravel(), np.full(X.size, common.FLOOR_Z + 0.02)], 1),
            "splats": np.asarray(pos[pick], np.float64)}
    occ = lt.load_occ("cookie")
    report = []
    for (y, mo, d, hh, mi) in CHECK_SUNS:
        az, el = common.solar_position(y, mo, d, hh, mi)
        s = common.sun_vec_e57(az, el)
        s32 = np.asarray(s, np.float32)
        row = {"utc": f"{y}-{mo:02d}-{d:02d}T{hh:02d}:{mi:02d}", "az": round(float(az), 2), "el": round(float(el), 2),
               "windowsAboveHorizon": [n for n, v in vols.items() if W.above_horizon(horizons[n], s32, v.x_bearing)]}
        for name, P in sets.items():
            t3 = lt.sun_direct(occ, P, s).numpy()          # the proof's march, torch on the CPU
            steps = np.zeros(len(P), np.int32)
            twin = W.sun_visibility(vols, horizons, fresnel, P, s, steps=steps)
            row[name] = {**_agreement(t3, twin, W.sun_visibility(exact, horizons, fresnel, P, s)), **_step_stats(steps)}
        report.append(row)
        print(json.dumps(row), flush=True)
    lat = float(cfg.room["site"]["latitude"])
    flagged = np.concatenate([W.sun_reach(vols, np.asarray(pos[a:a + W.CHUNK], np.float64), lat)
                              for a in range(0, len(pos), W.CHUNK)])
    # coverage: a splat that a real sun or moon at any time can light (horizon, occupancy ignored) must be flagged
    lit = [np.any([W.ray_survives(v, sets["splats"], s) for v in vols.values()], axis=0)
           for s in _random_suns(common, 48, SPLAT_SEED)]
    lit_moon = [np.any([W.ray_survives(v, sets["splats"], s) for v in vols.values()], axis=0)
                for s in _random_moons(cfg, 48, SPLAT_SEED)]
    missed = int(sum(int((on & ~flagged[pick]).sum()) for on in lit))
    missed_moon = int(sum(int((on & ~flagged[pick]).sum()) for on in lit_moon))
    ok = max(missed, missed_moon) <= GATE["reachMissed"] and all(_passes(r[k]) for r in report for k in sets)
    out = {"threshold": GATE, "pass": ok,
           "points": {"floor": len(sets["floor"]), "splats": SPLAT_SAMPLE, "splatSeed": SPLAT_SEED},
           "sunReach": {"latitude": lat, "finestSplats": len(pos), "flaggedShare": float(flagged.mean()),
                        "flaggedSampleShare": float(flagged[pick].mean()), "randomSuns": len(lit),
                        "litSampleShareMean": float(np.mean([on.mean() for on in lit])), "missed": missed,
                        "randomMoons": len(lit_moon), "litMoonSampleShareMean": float(np.mean([on.mean() for on in lit_moon])),
                        "missedMoon": missed_moon},
           "directions": report}
    with open(os.path.join(cfg.paths["evidence"], "sun-check.json"), "w") as f:
        json.dump(out, f, indent=1)
    print("sun reach", json.dumps(out["sunReach"]), "PASS" if ok else "FAIL", flush=True)
    return 0 if ok else 1


COMMANDS["check-sun"] = cmd_check_sun


THREADS = int(os.environ.get("RELIGHT_THREADS", "6"))     # torch threads for the CPU bake steps (the PC is shared)
SOURCES = ("W1", "W2", "W3", "W4", "W5", "cove", "ch_end", "ch_centre", "dome")   # the package's source order
LINEARITY_GATE = 0.02       # the capture's bounce from the per-source probes against the proof's own solve
FLOOR_LIFT = 0.02           # the floor light's points sit this far above the skin's fitted plane (m)
FLOOR_W3_SHARE = 0.9        # W3 lights more than this share of the floor's texels
SUN_HELD_OUT, SUN_HELD_SEED = 48, SPLAT_SEED + 7    # the sun-bounce gate's held-out real suns (they choose K)
SUN_CHECK_SEED = SPLAT_SEED + 13                    # an independent draw of as many, which checks the chosen K
MOON_HELD_SEED, MOON_CHECK_SEED = SPLAT_SEED + 17, SPLAT_SEED + 19   # the same for real moons (_random_moons)
SUN_STRICT_SEED, MOON_STRICT_SEED = SPLAT_SEED + 23, SPLAT_SEED + 29   # a third draw (suns, moons) that excludes the check draw too
SUN_BATCH = 24              # sun directions per radiosity solve
SUN_KMAX = 192              # the most basis volumes the sun-bounce search tries


def _proof_modules():
    """The proof's modules (after use_proof), with torch capped at THREADS: lt.py and 04_fit.py set 12 and 8 threads
    when imported."""
    import importlib
    import torch
    import common, lt, radiosity
    fit04 = importlib.import_module("04_fit")
    torch.set_num_threads(THREADS)
    return common, lt, radiosity, fit04


def cmd_probes(cfg, args) -> int:
    """<work>/probes-coarse.npz: each source's bounce (white, unit; the windows with the capture's sky weights) as
    ambient cubes on the hall box's 0.5 m grid, solved by the proof's radiosity (spec 4.2). <evidence>/probes-check.json:
    the capture's bounce rebuilt from the float16 cubes the package carries against the proof's own solve (linearity),
    median relative luminance difference at the valid probes within LINEARITY_GATE; the cubes go into work/ only once
    that check passes (a failing run keeps them as <evidence>/probes-coarse-FAILED.npz). CPU only."""
    import json, time
    from . import probes as PR
    _common, _lt, radiosity, fit04 = _proof_modules()
    from store import LUMW
    started, work = time.time(), cfg.paths["work"]
    hall, spacing = cfg.room["hallE57"], float(cfg.room["probeSpacing"])
    P, shape, origin = PR.coarse_grid(hall, spacing)
    valid = PR.valid_mask(P, hall)
    print(f"probes: {len(P)} on {tuple(int(v) for v in shape)} at {spacing} m from {origin.tolist()}, "
          f"{int(valid.sum())} valid; torch threads {THREADS}", flush=True)
    with np.load(os.path.join(work, "patches.npz")) as z:
        patches = {k: z[k] for k in z.files}
    with np.load(os.path.join(work, "fit_state.npz")) as z:
        print("fit_state.npz:", z.files, flush=True)
        rho, pdir_cap, wc = z["rho"], z["Pdir_cap"], z["Wc"]
    sky_w = np.array(fit04.SKY_W)
    cubes16 = PR.bounce_probes(radiosity, patches, rho, sky_w, P).astype(np.float16)
    if not np.isfinite(cubes16).all() or (cubes16 < 0).any():
        print("FAIL: the cubes are not finite and non-negative in float16", flush=True)
        return 1
    shipped = cubes16.astype(np.float64)
    positive = shipped[valid][shipped[valid] > 0]
    print(f"probes: cubes {cubes16.shape} float16, {time.time() - started:.0f} s; valid values "
          f"{positive.size} > 0 of {shipped[valid].size}, {float(positive.min()):.3g} .. {float(positive.max()):.3g}, "
          f"{int((positive < 6.103515625e-05).sum())} subnormal", flush=True)

    # linearity: the capture's bounce from the per-source cubes against the proof's own (04_fit's Imix, ten bases)
    with open(os.path.join(work, "fit.json"), encoding="utf-8") as f:
        fit = json.load(f)
    order = [fit["bases"].index(name) for name in SOURCES]          # by name: fit.json lists sun_cap sixth
    weighted = np.array(fit["weights"], np.float64)[order][:, None] * np.array(fit["colours"], np.float64)[order]
    capture = np.einsum("mkcf,kc->mcf", shipped, weighted)
    F = radiosity.form_factors(patches["P"], patches["N"], patches["A"], patches["opening"])
    proof_capture = np.einsum("mbcf,bc->mcf", radiosity.probe_indirect(P, patches, radiosity.radiosity(F, rho, pdir_cap))
                              .numpy().astype(np.float64), wc.astype(np.float64))
    lum_ours, lum_proof = PR.cube_luminance(capture, LUMW), PR.cube_luminance(proof_capture, LUMW)
    scored = valid & (lum_proof > 0)
    rel = np.abs(lum_ours[scored] - lum_proof[scored]) / lum_proof[scored]
    out = {"linearityMedianRel": float(np.median(rel)), "linearityP99Rel": float(np.percentile(rel, 99)),
           "linearityMaxRel": float(rel.max()), "probes": int(scored.sum()), "threshold": LINEARITY_GATE}
    out["pass"] = bool(out["linearityMedianRel"] <= LINEARITY_GATE)
    with open(os.path.join(cfg.paths["evidence"], "probes-check.json"), "w", encoding="utf-8") as f:
        json.dump(_finite(out), f, indent=1, allow_nan=False)
    kept = _save_npz_if(os.path.join(work, "probes-coarse.npz"), out["pass"], cfg.paths["evidence"], cubes=cubes16, valid=valid,
                        origin=origin, shape=np.asarray(shape, np.int64), spacing=np.float64(spacing))
    print(f"linearity: {json.dumps(out)} (capture bounce luminance median {float(np.median(lum_proof[scored])):.4g}), "
          f"{'PASS' if out['pass'] else 'FAIL'}; {'probes-coarse.npz written' if out['pass'] else 'the failing cubes kept at ' + kept}, "
          f"{time.time() - started:.0f} s", flush=True)
    return 0 if out["pass"] else 1


COMMANDS["probes"] = cmd_probes


def _lit_directions(candidates, lt, SB, occ, rays, normals, used=()):
    """The first SUN_HELD_OUT of the candidate directions (a draw of real suns or moons, up and facing the window wall)
    whose gated bounce is not zero and which are not among `used`, each as (s, proof gates, per-window patch sun);
    with the number of candidates drawn and of those skipped as reused."""
    out, drawn, skipped = [], 0, 0
    for s in candidates:
        drawn += 1
        if SB.reused(s, used):
            skipped += 1
            continue
        g = SB.proof_gates(lt, s)
        if g.any():
            e = SB.patch_sun_by_window(lt, occ, rays, normals, s)
            if float((g[:, None] * e).sum()) > 0:
                out.append((np.asarray(s, np.float64), g, e))
        if len(out) == SUN_HELD_OUT:
            break
    return out, drawn, skipped


def _score_through(SB, PR, lumw, table, basis, volumes, hz, fresnel, room, xb, to05, valid05, suns, exact05):
    """Each sun's bounce through sunbounce.sun_bounce from the stored table and volumes (its exact window powers from the
    patch rays, the unit fields mixed) against its exact bounce (exact05[h], per window, gated here by the proof's gates)
    at the valid 0.5 m probes: per-sun median |dlog2|, every scored probe's |dlog2| (one array per sun), and each sun's
    mean exact bounce (the gate's brightness)."""
    medians, logs, bright = [], [], []
    for h, (s, g, _e) in enumerate(suns):
        exact = np.einsum("w,wpcf->pcf", g.astype(np.float64), exact05[h].astype(np.float64))
        lum_exact = PR.cube_luminance(exact[valid05], lumw)
        full = SB.sun_bounce(table, basis, volumes, hz, fresnel, room, xb, s)
        d = SB.log2_errors(PR.cube_luminance((to05 @ full.reshape(full.shape[0], 18)).reshape(-1, 3, 6), lumw), lum_exact)
        medians.append(float(np.median(d))); logs.append(d); bright.append(float(lum_exact.mean()))
    return np.array(medians), logs, np.array(bright)


def _scan(SB, PR, W, lumw, lum_basis, table, powers, dirs, exact05, valid05, xb, floor05, ks):
    """Each direction (s, proof gates, patch sun) rebuilt with its exact window powers powers[h] and the table's unit
    fields, scored against its exact bounce (exact05[h] per window, gated by the proof's gates) at the valid 0.5 m probes
    where that is lit, with the first K basis volumes for every K in ks (1-based, cumulative). Returns the |dlog2| arrays
    (len(ks), lit) float32, the exact mean bounce (the gate's brightness), the azimuth and elevation, the coefficient
    vectors (every K) and the exact mean floor luminance of each direction."""
    ki = np.asarray(list(ks)) - 1
    logs, bright, az_el, cs, floor_exact = [], [], [], [], []
    for h, (s, g, _e) in enumerate(dirs):
        exact = np.einsum("w,wpcf->pcf", g.astype(np.float64), exact05[h].astype(np.float64))
        lum = PR.cube_luminance(exact[valid05], lumw)
        az, el = W.sun_az_el(np.asarray(s, np.float32), xb)
        c = SB.coefficients(table, powers[h], az, el)
        lit = lum > 0
        rec = np.cumsum(c[:, None] * lum_basis[:, lit], 0)[ki]
        d = np.full(rec.shape, np.inf)
        d[rec > 0] = np.abs(np.log2(rec[rec > 0]) - np.broadcast_to(np.log2(lum[lit]), rec.shape)[rec > 0])
        logs.append(d.astype(np.float32)); bright.append(float(lum.mean())); az_el.append((az, el)); cs.append(c)
        floor_exact.append(float(np.einsum("p,pc->c", floor05, exact[..., 4]) @ lumw))
    return logs, np.array(bright), az_el, cs, floor_exact


def _gate_by_body(SB, bodies, medians, bright, logs):
    """sunbounce.gate on the suns alone and on the moons alone (each body's brightness against its own median sun)."""
    out = {}
    for body in ("sun", "moon"):
        idx = [h for h, b in enumerate(bodies) if b == body]
        if idx:
            out[body] = SB.gate(np.asarray(medians)[idx], np.asarray(bright)[idx], np.concatenate([logs[h] for h in idx]))
    return out


def _faint(SB, bodies, az_el, rel, medians):
    """The directions under the gate's brightness share, reported (they do not decide)."""
    return [{"body": b, "az": round(float(a), 4), "el": round(float(e), 4), "bounceRel": float(r), "median": float(m)}
            for b, (a, e), r, m in zip(bodies, az_el, rel, medians) if r < SB.GATE["brightShare"]]


def _bounce_fields(radiosity, F, rho, patches, E, points):
    """(n, 5, points, 3, 6) float32: the bounce of each direction's per-window patch sun E[n] (5, patches) at the
    points, SUN_BATCH directions per radiosity solve."""
    out = []
    for b0 in range(0, len(E), SUN_BATCH):
        part = E[b0:b0 + SUN_BATCH]
        B = radiosity.radiosity(F, rho, np.concatenate([e.T for e in part], 1).astype(np.float32))
        f = radiosity.probe_indirect(points, patches, B).numpy()
        out.append(f.transpose(1, 0, 2, 3).reshape(len(part), 5, len(points), 3, 6))
    return np.concatenate(out)


def cmd_sun_bounce(cfg, args) -> int:
    """<work>/sun-bounce.npz, the sun's and the moon's bounce (sunbounce.py), factored: B_w(s) = P_w(s) R_w(s). P_w, the
    power the room's patches receive through window w (sunbounce.window_power: the proof's 16 sub-sample rays per patch
    marched by the browser twin), is exact at every evaluation and never interpolated. R_w = B_w / P_w, the window's
    bounce of a white unit sun per unit power, is what the K basis volumes (1 m probe grid, float16, each scaled to its
    largest value) and the coefficient table at the wall-facing nodes of the 4-degree sun grid over the sky band compress
    and interpolate (sunbounce.bake_table: a node without real power in a window takes the nearest real node's
    coefficients). The grid covers the sun's and the moon's band and the bounce is per unit irradiance, so one table
    serves both. K is chosen on SUN_HELD_OUT held-out real suns plus as many real moons, rebuilt from the stored values
    and scored against their exact bounce at the valid 0.5 m probes (sunbounce.choose_k): the smallest K from which
    sunbounce.GATE passes with the worst bright direction at most sunbounce.MARGIN at that K and every larger K, else the
    smallest K that passes. The same gate then scores that K, unchanged and at no other K, on two further draws of suns
    and moons: the check draw (SUN_CHECK_SEED, MOON_CHECK_SEED; every selection direction and grid node excluded) and the
    strict draw (SUN_STRICT_SEED, MOON_STRICT_SEED; those and every direction of the check draw excluded). Both must pass.
    <evidence>/sun-bounce-check.json holds the gates, per body too, the faint directions, and the power and floor
    checks (non-finite numbers written as null). The artifact goes into work/ only when every check passed; a failing run
    keeps its arrays as <evidence>/sun-bounce-FAILED.npz. CPU only."""
    import json, time
    import torch
    from . import probes as PR, sunbounce as SB, windows as W
    common, lt, radiosity, _fit04 = _proof_modules()
    from store import LUMW
    started, work = time.time(), cfg.paths["work"]
    hall, xb = cfg.room["hallE57"], float(cfg.room["site"]["xBearingDeg"])
    with np.load(os.path.join(work, "patches.npz")) as z:
        patches = {k: z[k] for k in z.files}
    with np.load(os.path.join(work, "fit_state.npz")) as z:
        rho = z["rho"]
    with np.load(os.path.join(work, "floor-light.npz")) as z:
        texel_to_model, (fh, fw) = z["texelToModel"], z["D"].shape[:2]
    vols, horizons, fresnel = windows_volumes(cfg)
    if list(vols) != list(SOURCES[:5]):
        raise ValueError(f"windows.npz holds {list(vols)}; the sources' windows are {SOURCES[:5]}")
    volumes, hz = list(vols.values()), [horizons[n] for n in vols]
    room = SB.Patches.from_arrays(patches["P"], patches["N"], patches["A"])
    az0, el0, needed = W.sun_nodes(float(cfg.room["site"]["latitude"]), SB.STEP)
    nodes = list(zip(*np.nonzero(needed)))
    node_suns = [W.sun_vector(az0 + i * SB.STEP, el0 + j * SB.STEP, xb) for j, i in nodes]
    facing = [n for n, s in enumerate(node_suns) if s[1] < -W.MIN_DOWN]
    occ = lt.load_occ()
    rays = torch.as_tensor(SB.patch_rays(patches["P"], patches["N"]), dtype=torch.float32)
    F = radiosity.form_factors(patches["P"], patches["N"], patches["A"], patches["opening"])
    P1, shape1, origin1 = PR.coarse_grid(hall, SB.SPACING)
    valid1 = PR.valid_mask(P1, hall)
    P05, shape05, origin05 = PR.coarse_grid(hall, float(cfg.room["probeSpacing"]))
    valid05 = PR.valid_mask(P05, hall)
    print(f"sun grid {needed.shape} from az {az0} el {el0} every {SB.STEP} deg: {len(nodes)} nodes, {len(facing)} facing "
          f"the wall; volumes {tuple(int(v) for v in shape1)} at {SB.SPACING} m, {int(valid1.sum())} valid; torch threads {THREADS}", flush=True)

    sel_suns, _drawn, _skipped = _lit_directions(_random_suns(common, 400, SUN_HELD_SEED), lt, SB, occ, rays, patches["N"])
    sel_moons, _drawn, _skipped = _lit_directions(_random_moons(cfg, 400, MOON_HELD_SEED), lt, SB, occ, rays, patches["N"])
    held, bodies = sel_suns + sel_moons, ["sun"] * len(sel_suns) + ["moon"] * len(sel_moons)
    split = max(float(np.abs((g[:, None] * e).sum(0) - radiosity.patch_sun(occ, patches, s)).max())
                for s, g, e in (held[0], held[1], held[len(sel_suns)]))           # two suns and a moon
    e_nodes = [SB.patch_sun_by_window(lt, occ, rays, patches["N"], node_suns[n]) for n in facing]
    print(f"{len(sel_suns)} held-out suns and {len(sel_moons)} moons; per-window split against patch_sun: max |diff| {split}; "
          f"marches {time.time() - started:.0f} s", flush=True)
    fields1 = _bounce_fields(radiosity, F, rho, patches, e_nodes, P1)
    exact05 = _bounce_fields(radiosity, F, rho, patches, [e for _s, _g, e in held], P05)
    print(f"fields: nodes {fields1.shape}, held-out {exact05.shape}, {time.time() - started:.0f} s", flush=True)

    # the nodes' window powers (ungated: the nodes are baked with every horizon open), then the unit fields' basis and table
    node_power = np.array([SB.window_power(volumes, hz, fresnel, room, node_suns[n], gated=False) for n in facing])
    baked = SB.bake_table(fields1, node_power, [nodes[n] for n in facing], needed, valid1, SUN_KMAX)
    del fields1
    kmax, rank, lam, basis = baked.basis.shape[0], baked.rank, baked.lam, baked.basis
    table = SB.Table(coeffs=baked.coeffs, az0=az0, el0=el0, step=SB.STEP)
    node_power_grid = np.zeros(needed.shape + (5,), np.float32)
    for r, n in enumerate(facing):
        node_power_grid[nodes[n]] = node_power[r]
    print(f"node powers and table: K <= {kmax} of rank {rank}, real node-windows {[int(baked.real[..., w].sum()) for w in range(5)]} "
          f"of lit {[int((node_power_grid[..., w] > 0).sum()) for w in range(5)]}; {time.time() - started:.0f} s", flush=True)

    # the gate: each held-out sun rebuilt from its exact window powers and the table's unit fields, against its exact
    # bounce at the valid 0.5 m probes
    to05 = SB.trilinear_matrix(origin1, SB.SPACING, shape1, valid1, P05[valid05])
    b64 = basis.astype(np.float64).reshape(kmax, len(P1), 18)
    lum_basis = np.stack([PR.cube_luminance((to05 @ b64[k]).reshape(-1, 3, 6), LUMW) for k in range(kmax)])
    floor_points = (texel_to_model[:3, 0] * np.arange(fw)[None, :, None] + texel_to_model[:3, 1] * np.arange(fh)[:, None, None]
                    + texel_to_model[:3, 3]).reshape(-1, 3)
    floor1 = np.asarray(SB.trilinear_matrix(origin1, SB.SPACING, shape1, valid1, floor_points).mean(0)).ravel()
    floor05 = np.asarray(SB.trilinear_matrix(origin05, float(cfg.room["probeSpacing"]), shape05, valid05, floor_points).mean(0)).ravel()
    floor_mean = np.einsum("p,kpc->kc", floor1, b64.reshape(kmax, len(P1), 3, 6)[..., 4])     # (kmax, 3)
    lumw = np.asarray(LUMW, np.float64)
    held_power = [SB.window_power(volumes, hz, fresnel, room, s) for s, _g, _e in held]        # exact, gated, at the float32 sun
    logs, brightness, held_az_el, cs, floor_exact = _scan(SB, PR, W, lumw, lum_basis, table, held_power, held, exact05, valid05,
                                                          xb, floor05, range(1, kmax + 1))
    results = []
    for k in range(kmax):
        per_k = np.array([float(np.median(d[k])) for d in logs])
        results.append(SB.gate(per_k, brightness, np.concatenate([d[k] for d in logs])))
    passing = [k + 1 for k, r in enumerate(results) if r["pass"]]
    K, k_rule = SB.choose_k(results)                                  # fixed on the selection set; the check is scored after
    rel = brightness / np.median(brightness)
    per_sun = [float(np.median(d[K - 1])) for d in logs]
    floor_err = [abs(float(np.cumsum(c[:, None] * floor_mean, 0)[K - 1] @ lumw) - fe) / fe for c, fe in zip(cs, floor_exact) if fe > 0]
    # the window power against the proof's own gated patch power at the held-out directions (the twin's agreement)
    power_err = [abs(float(p.sum()) - pe) / pe for p, pe in
                 ((p, float(g.astype(np.float64) @ (patches["A"][None, :] * e_h).sum(1))) for p, (_s, g, e_h) in zip(held_power, held))]
    # the chosen K again, each sun through sunbounce.sun_bounce (the evaluation the reference and the browser repeat)
    table_k = SB.Table(coeffs=baked.coeffs[..., :K], az0=az0, el0=el0, step=SB.STEP)
    basis_k = b64[:K].reshape(K, len(P1), 3, 6)
    medians_h, _logs_h, _bright_h = _score_through(SB, PR, LUMW, table_k, basis_k, volumes, hz, fresnel, room, xb, to05, valid05, held, exact05)
    through = float(np.abs(medians_h - np.array(per_sun)).max())      # the search keeps its log errors in float32
    # K, fixed on the selection set above, is scored once on each of two draws of suns and moons (never chosen again, and
    # never scored at any other K): the check draw, and then the strict draw, whose directions exclude every selection
    # direction, every grid node and every direction of the check draw
    def score_draw(sun_seed, moon_seed, excluded):
        suns_, drawn_s, skipped_s = _lit_directions(_random_suns(common, 400, sun_seed), lt, SB, occ, rays, patches["N"], excluded)
        moons_, drawn_m, skipped_m = _lit_directions(_random_moons(cfg, 400, moon_seed), lt, SB, occ, rays, patches["N"],
                                                     excluded + [s for s, _g, _e in suns_])
        dirs, kinds = suns_ + moons_, ["sun"] * len(suns_) + ["moon"] * len(moons_)
        exact = _bounce_fields(radiosity, F, rho, patches, [e for _s, _g, e in dirs], P05)
        medians, logs_d, bright_d = _score_through(SB, PR, LUMW, table_k, basis_k, volumes, hz, fresnel, room, xb, to05, valid05, dirs, exact)
        verdict = SB.gate(medians, bright_d, np.concatenate(logs_d))
        powers = [SB.window_power(volumes, hz, fresnel, room, s) for s, _g, _e in dirs]
        logs_k, _b, _ae, cs_d, floor_exact_d = _scan(SB, PR, W, lumw, lum_basis, table, powers, dirs, exact, valid05, xb, floor05, [K])
        del exact
        f_err = [abs(float(np.cumsum(c[:, None] * floor_mean, 0)[K - 1] @ lumw) - fe) / fe for c, fe in zip(cs_d, floor_exact_d) if fe > 0]
        through_d = float(np.abs(medians - np.array([float(np.median(d[0])) for d in logs_k])).max())
        record = {"sunSeed": sun_seed, "moonSeed": moon_seed, "suns": len(suns_), "moons": len(moons_),
                  "drawn": drawn_s + drawn_m, "skippedReused": skipped_s + skipped_m, "pass": verdict["pass"], "result": verdict,
                  "resultByBody": _gate_by_body(SB, kinds, medians, bright_d, logs_d),
                  "faint": _faint(SB, kinds, [W.sun_az_el(np.asarray(s, np.float32), xb) for s, _g, _e in dirs],
                                  bright_d / np.median(bright_d), medians),
                  "floorMean": {"medianRelErr": float(np.median(f_err)), "maxRelErr": float(max(f_err))},
                  "throughMaxDiff": through_d}
        return dirs, record

    used = [s for s, _g, _e in held] + [node_suns[n] for n in facing]
    check, independent = score_draw(SUN_CHECK_SEED, MOON_CHECK_SEED, used)
    _strict_dirs, strict_check = score_draw(SUN_STRICT_SEED, MOON_STRICT_SEED, used + [s for s, _g, _e in check])
    ok = (bool(passing) and split == 0.0 and through < 1e-6 and independent["throughMaxDiff"] < 1e-6 and independent["pass"]
          and strict_check["throughMaxDiff"] < 1e-6 and strict_check["pass"])
    out = {"gate": SB.GATE, "pass": ok, "K": K, "kRule": {"rule": k_rule, "margin": SB.MARGIN,
                                                          "smallestPassingK": passing[0] if passing else None},
           "kmax": kmax, "rank": rank, "energyAtK": float(lam[:K].sum() / lam.sum()),
           "result": results[K - 1], "splitMaxAbsDiff": split, "throughSunBounceMaxDiff": through,
           "resultByBody": _gate_by_body(SB, bodies, per_sun, brightness, [d[K - 1] for d in logs]),
           "independentCheck": independent, "strictCheck": strict_check,
           "model": {"factored": True, "realFraction": SB.REAL_FRACTION,
                     "realNodeWindows": [int(baked.real[..., w].sum()) for w in range(5)],
                     "litNodeWindows": [int((node_power_grid[..., w] > 0).sum()) for w in range(5)]},
           "grid": {"step": SB.STEP, "azimuth0": az0, "elevation0": el0, "shape": list(needed.shape),
                    "needed": int(needed.sum()), "facing": len(facing)},
           "volumes": {"spacing": SB.SPACING, "shape": [int(v) for v in shape1], "valid": int(valid1.sum())},
           "heldOut": {"sunSeed": SUN_HELD_SEED, "moonSeed": MOON_HELD_SEED, "suns": len(sel_suns), "moons": len(sel_moons),
                       "faint": _faint(SB, bodies, held_az_el, rel, per_sun)},
           "byK": [{"K": k + 1, "pass": r["pass"], "pooledMedian": r["pooledMedian"], "brightOver": r["brightOver"],
                    "worstBright": r["worstBright"]} for k, r in enumerate(results)],
           "power": {"medianRelErr": float(np.median(power_err)), "maxRelErr": float(max(power_err))},
           "floorMean": {"medianRelErr": float(np.median(floor_err)), "maxRelErr": float(max(floor_err))}}
    with open(os.path.join(cfg.paths["evidence"], "sun-bounce-check.json"), "w", encoding="utf-8") as f:
        json.dump(_finite(out), f, indent=1, allow_nan=False)
    kept = _save_npz_if(os.path.join(work, "sun-bounce.npz"), ok, cfg.paths["evidence"], basis=basis[:K],
                        coeffs=baked.coeffs[..., :K], floorMean=floor_mean[:K].astype(np.float32), needed=needed,
                        azimuth0=np.float64(az0), elevation0=np.float64(el0), step=np.float64(SB.STEP), gridOrigin=origin1,
                        gridShape=np.asarray(shape1, np.int64), gridSpacing=np.float64(SB.SPACING), valid=valid1,
                        real=baked.real, nodePower=node_power_grid, patchRays=room.rays, patchNormal=room.normals,
                        patchArea=room.areas)

    def line(name, c):
        return (f"{name} ({c['suns']} suns and {c['moons']} moons of {c['drawn']} drawn, {c['skippedReused']} reused skipped) "
                f"{json.dumps(_finite(c['result']))}, floor {json.dumps(c['floorMean'])}")
    print(f"K {K} ({k_rule}; smallest passing {passing[0] if passing else None}) of rank {rank}, "
          f"{json.dumps(_finite(results[K - 1]))}; power {json.dumps(out['power'])}; floor {json.dumps(out['floorMean'])}; "
          f"{line('check', independent)}; {line('strict check', strict_check)}; "
          f"{'PASS: sun-bounce.npz written' if ok else 'FAIL: the failing arrays kept at ' + kept}, {time.time() - started:.0f} s", flush=True)
    return 0 if ok else 1


COMMANDS["sun-bounce"] = cmd_sun_bounce


def cmd_floor(cfg, args) -> int:
    """<work>/floor-light.npz: D (h, w, 9) float32, the nine sources' direct light (white, unit; the windows with the
    capture's sky weights) at the floor skin's 5 cm texel centres 2 cm above its fitted plane, normal +z, computed as
    the proof computes its patches' direct light; texelToModel (4, 4) takes a texel centre's (col, row, 0, 1) to the
    model frame, row 0 the first PNG row (floorlight.py). The proof's patches, recomputed the same way, check it first:
    the house lights exactly, the windows within the float16 rounding of the stored window cubes. The light maps go into
    work/ only once W3 lights more than FLOOR_W3_SHARE of the texels (a failing run keeps them as
    <evidence>/floor-light-FAILED.npz). CPU only."""
    import importlib, json, time
    from . import floorlight as FL, probes as PR
    common, lt, _radiosity, fit04 = _proof_modules()
    b3 = importlib.import_module("03_bases")
    started, work = time.time(), cfg.paths["work"]
    with open(os.path.join(cfg.paths["floorSkin"], "floor-skin.json"), encoding="utf-8") as f:
        skin = json.load(f)
    if skin.get("schema") != "venviewer.floor-skin.v1" or skin.get("frame") != "capture":
        raise ValueError("floor-skin.json must be venviewer.floor-skin.v1 in the capture frame")
    grid = FL.floor_grid(skin, float(cfg.room["floorTexel"]))
    plane = FL.model_plane(skin, common.T_JE)
    points = FL.lift_to_plane(common.json_to_e57(FL.capture_centres(skin, grid)), plane, FLOOR_LIFT)
    texel_to_model = FL.texel_to_model(points)
    print(f"floor: {grid['w']} x {grid['h']} texels of {cfg.room['floorTexel']} m over {grid['width']:.3f} x "
          f"{grid['height']:.3f} m; points x {points[..., 0].min():.3f}..{points[..., 0].max():.3f}, y "
          f"{points[..., 1].min():.3f}..{points[..., 1].max():.3f}, z {points[..., 2].min():.4f}..{points[..., 2].max():.4f}; "
          f"texelToModel {np.round(texel_to_model, 6).tolist()}", flush=True)
    with np.load(os.path.join(work, "probes.npz")) as z:
        volume = {"cubes": z["win_cubes"], "origin": tuple(float(v) for v in z["origin"]),
                  "shape": tuple(int(v) for v in z["shape"]), "keep": z["keep"]}
    with np.load(os.path.join(work, "geom.npz")) as z:
        house = {"chandeliers": z["chandeliers"], "dome_c": z["dome_c"]}
    with np.load(os.path.join(work, "bases.npz")) as z:
        house["ring"] = z["ring"]
    box = (common.X0, common.X1, common.Y0, common.Y1, common.FLOOR_Z)

    with np.load(os.path.join(work, "patches.npz")) as z:
        patches = {k: z[k] for k in z.files}
    again = FL.patch_direct(lt, b3.trilinear_weights, volume, house, box, patches["P"] + patches["N"] * 0.03, patches["N"])
    ok = True
    for key in ("E_win", "E_ch", "E_dome", "E_cove"):
        ref, new = np.asarray(patches[key], np.float64), np.asarray(again[key], np.float64)
        diff = np.abs(new - ref)
        bound = 2.0 ** -11 * np.abs(ref) + 2.0 ** -24 if key == "E_win" else np.zeros_like(ref)   # float16 cubes
        within = bool((diff <= bound).all())
        ok &= within
        rel = float((diff / np.maximum(np.abs(ref), 1e-30)).max())
        print(f"patch check {key}: max |diff| {float(diff.max()):.3g}, max relative {rel:.3g}, "
              f"{'within' if within else 'OUTSIDE'} {'the float16 rounding' if key == 'E_win' else 'exact equality'}", flush=True)
    if not ok:
        print("FAIL: the floor's light model does not reproduce the proof's patches", flush=True)
        return 1

    q = points.reshape(-1, 3)
    direct = FL.patch_direct(lt, b3.trilinear_weights, volume, house, box, q, np.tile([0.0, 0.0, 1.0], (len(q), 1)))
    D = PR.patch_direct_by_source(direct, np.array(fit04.SKY_W)).reshape(grid["h"], grid["w"], len(SOURCES))
    if not np.isfinite(D).all() or (D < 0).any():
        print("FAIL: the floor's direct light is not finite and non-negative", flush=True)
        return 1
    share = {name: float((D[..., k] > 0).mean()) for k, name in enumerate(SOURCES)}
    for k, name in enumerate(SOURCES):
        print(f"  {name}: max {float(D[..., k].max()):.6g}, mean {float(D[..., k].mean()):.6g}, "
              f"non-zero on {share[name]:.4f} of the texels", flush=True)
    lit_ok = share["W3"] > FLOOR_W3_SHARE
    kept = _save_npz_if(os.path.join(work, "floor-light.npz"), lit_ok, cfg.paths["evidence"], D=D, texelToModel=texel_to_model)
    print(f"floor: D {D.shape} float32; W3 lights {share['W3']:.4f} of the floor ({'PASS' if lit_ok else 'FAIL'}: above "
          f"{FLOOR_W3_SHARE}); {'floor-light.npz written' if lit_ok else 'the failing light maps kept at ' + kept}, "
          f"{time.time() - started:.0f} s", flush=True)
    return 0 if lit_ok else 1


COMMANDS["floor"] = cmd_floor


def cmd_refit_house(cfg, args) -> int:
    """The house lights refitted (Task 4b, housefit.py). `proof` runs 04_fit.py's own model through the loop (the
    baseline: it must reproduce this work's fit.json); `refit` the refit at the table's measured w_crown (with
    bulb-intensities.json), or with --w-crown <w> a sensitivity run at that w (folder refit-wcrown-<w>); each writes
    <work>/refit/<folder>/ and never touches the fit the work uses. `compare [--tag <folder>]` checks a refit's two runs
    (refit/<folder> against refit/<folder>-run1; default the refit); `install [--tag <folder>]` puts a refit into this
    (staging) work, the default only when accepted and reproduced, a sensitivity run when its two runs agree;
    `photo-gate` holds 07_compare's night metrics (<work>/cmp/metrics.json) to the baseline's; `sensitivity` compares
    the refit with both sensitivity runs (data cost, the ch_centre share at the floor and the ceiling, the night photos
    against their run-to-run noise) and fails when the photos clearly prefer an end; `promote --from <staging work>`
    keeps this work's proof fit in <work>/fit-proof/ and copies the accepted refit, its embrasure light and its
    multipliers in, and only when every gate passed, the range-aware balance of ruling L4 included; refused, it copies
    nothing and records why. Evidence: <evidence>/refit/*.json (staging) and <evidence>/refit.json (promote, either way).
    CPU only."""
    from . import housefit as HF
    mode, work = args.step, cfg.paths["work"]
    refit_dir, ev_dir = os.path.join(work, "refit"), os.path.join(cfg.paths["evidence"], "refit")
    os.makedirs(ev_dir, exist_ok=True)
    tag = args.tag or HF.DEFAULT_TAG
    suffix = "" if tag == HF.DEFAULT_TAG else f"-{tag}"            # evidence names: compare.json, compare-<tag>.json

    def write_json(path, data):
        part = path + ".part"
        with open(part, "w", encoding="utf-8") as f:
            json.dump(_finite(data), f, indent=1, sort_keys=True, allow_nan=False)
        os.replace(part, path)

    def read_json(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)

    if mode in ("proof", "refit"):
        common, lt, radiosity, fit04 = _proof_modules()
        import torch
        import store as store_mod
        if fit04.LAMP_RATIO is None:
            print(f"FAIL: {work}/lamp_daylight_ratio.json is missing (04_fit.LAMP_RATIO)", flush=True)
            return 1
        current = read_json(os.path.join(work, "fit.json"))
        if (current.get("model") or {}).get("name") == "refit":
            print("FAIL: this work's fit.json is already the refit; both fits start from the proof fit's tables", flush=True)
            return 1
        k = HF.FitConstants.of(fit04)
        mods = {"fit04": fit04, "radiosity": radiosity, "store": store_mod, "lt": lt, "torch": torch}
        out_dir, bulbs, counts = os.path.join(refit_dir, mode), None, None
        if mode == "proof":
            model = HF.ProofModel(fit04.LAMP_RATIO)
        else:
            with np.load(os.path.join(work, "geom.npz")) as z:
                centres = np.asarray(z["chandeliers"], np.float64)
            bulbs = HF.read_bulbs(cfg.paths["emitters"], centres, common.T_JE)
            if args.w_crown is None:
                counts = HF.lamp_counts(bulbs, bulbs["crownWeight"]["wCrown"])
            else:
                counts = HF.lamp_counts(bulbs, args.w_crown)
                out_dir = os.path.join(refit_dir, HF.variant_tag(args.w_crown))
            model = HF.RefitModel(fit04.LAMP_RATIO, counts, HF.colour_priors(read_json(cfg.paths["lampColours"])))
        started = time.time()
        report = HF.run_capture_fit(model, k, mods, out_dir, write_ecap=(mode == "refit"), log=lambda line: print(line, flush=True))
        report["threads"] = THREADS
        ok = True
        if mode == "proof":
            a, b = np.asarray(current["weights"], np.float64), np.asarray(report["weights"], np.float64)
            both = (a >= 1e-6) & (b >= 1e-6)
            change = float(np.max(np.abs(b[both] - a[both]) / a[both]))
            ok = bool(change <= HF.REPRODUCE_TOLERANCE and int(both.sum()) >= 8)
            report["reproduction"] = {"maxRelWeightChange": change, "weightsCompared": int(both.sum()),
                                      "tolerance": HF.REPRODUCE_TOLERANCE, "pass": ok}
        else:
            report["bulbs"] = {"path": cfg.paths["emitters"], "sha256": bulbs["sha256"], "notLamps": bulbs["notLamps"],
                               "counts": {str(c): n for c, n in bulbs["counts"].items()}, "crowns": bulbs["crowns"],
                               "crownWeightMeasured": bulbs["crownWeight"], "wCrown": counts.w_crown,
                               "blobBalance": bulbs["blobBalance"]}
            write_json(os.path.join(out_dir, "bulb-intensities.json"),
                       HF.bulb_shares(bulbs, counts, report, HF.sha256_file(os.path.join(out_dir, "fit.json"))))
            report["bulbs"]["rangeBalance"] = bulbs["rangeBalance"]
            if args.w_crown is None:   # ruling L4: the bulb table's own check, a gate of promote
                write_json(os.path.join(ev_dir, "range-balance.json"), bulbs["rangeBalance"])
            rb = bulbs["rangeBalance"]
            print(f"range balance (L4): centre {rb['balance']} log2 against the ends, limit {rb['limit']} "
                  f"(end spreads {json.dumps(rb['endSpreads'])}): {'PASS' if rb['pass'] else 'STOP: ' + str(rb['reason'])}", flush=True)
        write_json(os.path.join(out_dir, "report.json"), report)
        print(f"refit-house {mode} -> {out_dir}: data cost {report['dataCost']:.6f}, weights {json.dumps(report['weights'])}, "
              f"{'PASS' if ok else 'FAIL'}, {time.time() - started:.0f} s", flush=True)
        return 0 if ok else 1
    if mode == "compare":
        run_a, run_b = os.path.join(refit_dir, f"{tag}-run1"), os.path.join(refit_dir, tag)
        differ = HF.same_run(run_a, run_b)
        write_json(os.path.join(ev_dir, f"compare{suffix}.json"), {"runA": run_a, "runB": run_b, "differ": differ, "pass": not differ,
                                                                  "sha256": {n: HF.sha256_file(os.path.join(run_b, n)) for n in sorted(os.listdir(run_b))}})
        print(f"refit-house compare {tag}: {'identical' if not differ else 'DIFFER: ' + ', '.join(differ)}", flush=True)
        return 0 if not differ else 1
    if mode == "install":
        compare = read_json(os.path.join(ev_dir, f"compare{suffix}.json"))
        if tag == HF.DEFAULT_TAG:
            proof = read_json(os.path.join(refit_dir, "proof", "report.json"))
            refit = read_json(os.path.join(refit_dir, tag, "report.json"))
            c = refit["describe"]["lampCounts"]
            verdict = HF.accept_fit(proof, refit, HF.LampCounts(c["endMean"], c["centreCandles"], c["crowns"], c["wCrown"]))
            verdict.update(reproduction=proof["reproduction"], runsIdentical=compare["pass"])
            verdict["pass"] = bool(verdict["pass"] and proof["reproduction"]["pass"] and compare["pass"])
            write_json(os.path.join(ev_dir, "accept.json"), verdict)
        else:
            verdict = {"tag": tag, "runsIdentical": compare["pass"], "pass": bool(compare["pass"])}   # evidence, not accepted
        if not verdict["pass"]:
            print(f"FAIL: {tag} is not installed: {json.dumps(_finite(verdict))}", flush=True)
            return 1
        snapshot = HF.snapshot_fit(work)
        src = os.path.join(refit_dir, tag)
        installed = {name: HF.copy_verified(os.path.join(src, os.path.basename(name)), os.path.join(work, name))
                     for name in ("fit.json", "fit_state.npz", "npy/E_cap.npy")}
        write_json(os.path.join(ev_dir, f"install{suffix}.json"), {"tag": tag, "snapshot": snapshot, "installed": installed})
        print(f"refit-house install {tag}: {json.dumps(installed)}", flush=True)
        return 0
    if mode == "photo-gate":
        verdict = HF.photo_gate(read_json(os.path.join(ev_dir, "photo-baseline.json")), read_json(os.path.join(work, "cmp", "metrics.json")))
        write_json(os.path.join(ev_dir, "photo-gate.json"), verdict)
        print(f"refit-house photo-gate: {json.dumps(verdict)}", flush=True)
        return 0 if verdict["pass"] else 1
    if mode == "sensitivity":
        runs = {}
        for name in (HF.DEFAULT_TAG,) + tuple(HF.variant_tag(w) for w in HF.CROWN_ENDS):
            report = read_json(os.path.join(refit_dir, name, "report.json"))
            runs[name] = {"wCrown": report["describe"]["lampCounts"]["wCrown"], "dataCost": report["dataCost"],
                          "budget": read_json(os.path.join(refit_dir, name, "fit.json"))["budget"],
                          "photo": read_json(os.path.join(ev_dir, f"photo-{name}.json"))}
        verdict = HF.crown_sensitivity(runs, read_json(os.path.join(ev_dir, f"photo-{HF.DEFAULT_TAG}-repeat.json")))
        write_json(os.path.join(ev_dir, "sensitivity.json"), verdict)
        print(f"refit-house sensitivity: {json.dumps(_finite(verdict))}", flush=True)
        if not verdict["pass"]:
            print(f"STOP: the night photographs clearly prefer w_crown {verdict['preferredEnd']}: report to the controller", flush=True)
        return 0 if verdict["pass"] else 1
    if mode == "promote":
        if args.source is None:
            print("promote needs --from <the staging work folder>", flush=True)
            return 2
        src = os.path.abspath(args.source)
        src_ev = os.path.join(os.path.dirname(src), "evidence", "refit")

        def gate(name):
            path = os.path.join(src_ev, f"{name}.json")
            return read_json(path) if os.path.exists(path) else {"pass": False, "missing": path}

        gates = {name: gate(name) for name in ("accept", "compare", "photo-gate", "sensitivity", "range-balance")}
        failed = [name for name, g in gates.items() if g.get("pass") is not True]
        refusal = None
        if failed:
            refusal = f"gates failed or missing: {', '.join(failed)}"
        elif ((read_json(os.path.join(src, "fit.json")).get("model") or {}).get("name") != "refit"
              or HF.sha256_file(os.path.join(src, "fit.json")) != HF.sha256_file(os.path.join(src, "refit", HF.DEFAULT_TAG, "fit.json"))):
            refusal = "the staging work's fit.json is not the refit at the measured w_crown (a sensitivity run is installed)"
        else:
            geometry = ("bases_n", "bases_iso", "bases_E_win", "bases_E_ch", "bases_E_dome", "bases_E_cove", "emb_idx", "emb_E_back_win")
            moved = [n for n in geometry if HF.sha256_file(os.path.join(src, "npy", f"{n}.npy")) != HF.sha256_file(os.path.join(work, "npy", f"{n}.npy"))]
            if moved:
                refusal = f"the fit-independent tables differ between the two works: {moved}"
        if refusal is not None:
            write_json(os.path.join(cfg.paths["evidence"], "refit.json"),
                       {"staging": src, "pass": False, "refusal": refusal, "gates": gates, "copied": {}})
            print(f"FAIL: nothing promoted: {refusal}", flush=True)
            return 1
        snapshot = HF.snapshot_fit(work)
        names = HF.FIT_FILES + tuple(f"mult/{s}.{e}" for s in HF.SCENARIOS for e in ("f16", "json"))
        copied = {name: HF.copy_verified(os.path.join(src, name), os.path.join(work, name)) for name in names}
        copied["bulb-intensities.json"] = HF.copy_verified(os.path.join(src, "refit", HF.DEFAULT_TAG, "bulb-intensities.json"),
                                                           os.path.join(work, "bulb-intensities.json"))
        refit = read_json(os.path.join(src, "refit", HF.DEFAULT_TAG, "report.json"))
        write_json(os.path.join(cfg.paths["evidence"], "refit.json"),
                   {"staging": src, "pass": True, "gates": gates, "snapshot": snapshot, "copied": copied, "bulbs": refit["bulbs"],
                    "weights": refit["weights"], "colours": refit["colours"], "describe": refit["describe"]})
        print(f"refit-house promote: {len(copied)} files from {src}", flush=True)
        return 0
    print("refit-house needs a mode: proof, refit, compare, install, photo-gate, sensitivity or promote", flush=True)
    return 2


COMMANDS["refit-house"] = cmd_refit_house


if __name__ == "__main__":
    sys.exit(main())
