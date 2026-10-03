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


def cmd_check_sun(cfg, args) -> int:
    """The twin (windows.sun_visibility) against the proof's lt.sun_direct, on the brief's floor points and on
    200,000 finest-level splats, for the five check suns; and the reach flag (windows.sun_reach) on every finest
    splat, which must cover every splat 48 random real suns light. Evidence: <evidence>/sun-check.json."""
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
    # coverage: a splat that a real sun at any day and time can light (horizon, occupancy ignored) must be flagged
    lit = [np.any([W.ray_survives(v, sets["splats"], s) for v in vols.values()], axis=0)
           for s in _random_suns(common, 48, SPLAT_SEED)]
    missed = int(sum(int((on & ~flagged[pick]).sum()) for on in lit))
    ok = missed <= GATE["reachMissed"] and all(_passes(r[k]) for r in report for k in sets)
    out = {"threshold": GATE, "pass": ok,
           "points": {"floor": len(sets["floor"]), "splats": SPLAT_SAMPLE, "splatSeed": SPLAT_SEED},
           "sunReach": {"latitude": lat, "finestSplats": len(pos), "flaggedShare": float(flagged.mean()),
                        "flaggedSampleShare": float(flagged[pick].mean()), "randomSuns": len(lit),
                        "litSampleShareMean": float(np.mean([on.mean() for on in lit])), "missed": missed},
           "directions": report}
    with open(os.path.join(cfg.paths["evidence"], "sun-check.json"), "w") as f:
        json.dump(out, f, indent=1)
    print("sun reach", json.dumps(out["sunReach"]), "PASS" if ok else "FAIL", flush=True)
    return 0 if ok else 1


COMMANDS["check-sun"] = cmd_check_sun


if __name__ == "__main__":
    sys.exit(main())
