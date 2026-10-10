"""python -m relight <command> [step] --config config/grand-hall.json"""
from __future__ import annotations

import argparse, gc, json, math, os, runpy, shutil, sys, time
from dataclasses import dataclass
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


def _artifact(path: str) -> dict:
    """An artifact's record for its evidence JSON (Task 4c): its exact path, SHA-256 and size. Task 5 packages a work
    artifact only when its bytes still have the SHA-256 its evidence records."""
    import hashlib
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return {"path": os.path.abspath(path).replace("\\", "/"), "sha256": h.hexdigest(), "bytes": os.path.getsize(path)}


# The container's initial environment as RunPod set it (pod/idle-stop.sh reads RUNPOD_POD_ID there too); none off Linux.
INIT_ENVIRON = "/proc/1/environ" if sys.platform.startswith("linux") else None
# The image's start.sh copy of it, shell `export NAME=value` lines: the watchdog's fallback (idle-stop.sh, `injected`).
RP_ENVIRONMENT = "/etc/rp_environment" if sys.platform.startswith("linux") else None


def _rp_environment_value(path: str, name: str) -> str | None:
    """NAME's value in a file of shell `export NAME=value` lines, read as pod/idle-stop.sh reads /etc/rp_environment:
    the first line that starts with `export NAME=`, less one leading and one trailing double quote. None when the file
    cannot be read or holds no such line."""
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            lines = f.read().splitlines()
    except OSError:
        return None
    prefix = f"export {name}="
    for line in lines:
        if line.startswith(prefix):
            value = line[len(prefix):]
            value = value[1:] if value.startswith('"') else value
            return value[:-1] if value.endswith('"') else value
    return None


def _host() -> str:
    """The host an evidence JSON is written on (R1a's Global Constraints, "Execution host", amended 10 October):
    "pod:<id>" on a RunPod pod, else "pc". The id is RUNPOD_POD_ID from this process's environment, else from the
    container's initial environment (INIT_ENVIRON: NUL-separated NAME=value entries), else from the image's shell copy
    of it (RP_ENVIRONMENT: `export NAME=value` lines), the order in which pod/idle-stop.sh looks, because the runner
    starts each job over a non-interactive SSH session that exports only the thread caps and RELIGHT_*, so a job's own
    environment usually lacks it. A runner job (RELIGHT_JOB set) whose pod id is in none of them raises RuntimeError
    rather than be recorded as the PC."""
    pod = os.environ.get("RUNPOD_POD_ID")
    if not pod and INIT_ENVIRON is not None:
        try:
            with open(INIT_ENVIRON, "rb") as f:
                entries = f.read().split(b"\0")
        except OSError:
            entries = []
        for entry in entries:
            name, _eq, value = entry.partition(b"=")
            if name == b"RUNPOD_POD_ID":
                pod = value.decode("utf-8", "replace")
                break
    if not pod and RP_ENVIRONMENT is not None:
        pod = _rp_environment_value(RP_ENVIRONMENT, "RUNPOD_POD_ID")
    if pod:
        return f"pod:{pod}"
    if os.environ.get("RELIGHT_JOB"):
        looked = ", ".join(["the environment"] + [p for p in (INIT_ENVIRON, RP_ENVIRONMENT) if p is not None])
        raise RuntimeError(f"runner job {os.environ['RELIGHT_JOB']}: RUNPOD_POD_ID is not in {looked}, so this "
                           f"evidence's host is unknown; refusing to record it as the PC")
    return "pc"


def _write_evidence(path: str, data: dict) -> None:
    """An evidence JSON, written after the artifact it describes and through a partial file renamed over the target, with
    non-finite numbers as null (so a failure never leaves a half-written or stale 'pass'). It records its host (_host),
    or keeps the host the evidence already records: record-artifacts rewrites evidence an earlier run measured. The
    partial file is flushed and fsynced before the rename, so a crash leaves the old evidence or the new, never a torn
    file; any failure removes the partial file and re-raises, the target untouched."""
    record = _finite({**data, "host": data.get("host") or _host()})
    part = path + ".part"
    try:
        with open(part, "w", encoding="utf-8") as f:
            json.dump(record, f, indent=1, allow_nan=False)
            f.flush()
            os.fsync(f.fileno())
        os.replace(part, path)
    except BaseException:
        if os.path.exists(part):
            os.remove(part)
        raise


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
    ap.add_argument("--skins", default=None)          # R1c: skin-light takes light-grids.json; records takes the geometry folder
    ap.add_argument("--skin-light", default=None)     # R1c: records' <work>/skin-light, for package v2's skins section
    ap.add_argument("--skin-package", default=None)   # R1c: the skin package folder package v2 names
    ap.add_argument("--out", default=None)            # R1c: the package's folder (default the config's out)
    ap.add_argument("--package", default=None)        # R1c: the package check reads (default the config's out)
    ap.add_argument("--vectors", default=None)        # check: where the test vectors go (default: the fixture, v1 only)
    ap.add_argument("--from", dest="source", default=None)   # refit-house promote: the staging work folder (Task 4b)
    ap.add_argument("--w-crown", dest="w_crown", type=float, default=None)   # refit-house refit: a sensitivity run's w_crown
    ap.add_argument("--tag", default=None)                    # refit-house compare | install: a refit's folder (default refit)
    args = ap.parse_args(argv)
    if os.environ.get("RELIGHT_JOB"):
        # A runner job must know its pod before it computes or replaces anything: its evidence will record the host, and
        # finding out only at the evidence write would waste the job and leave a new artifact beside old evidence.
        try:
            host = _host()
        except RuntimeError as e:
            print(f"FAIL: {e}", flush=True)
            return 1
        print(f"host: {host} (runner job {os.environ['RELIGHT_JOB']})", flush=True)
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
    _write_evidence(os.path.join(cfg.paths["evidence"], "windows.json"),
                    {"windows": list(cfg.room["windows"]), "artifact": _artifact(os.path.join(cfg.paths["work"], "windows.npz"))})
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


def _check_sun_points(common, n):
    """check-sun's two point sets: the floor grid (x and y every 5 cm from 5 cm inside the hall's box, z = FLOOR_Z +
    0.02: 88,831 points, (m, 3) float64) and the sorted indices of its SPLAT_SAMPLE finest splats, seeded with SPLAT_SEED
    from the n of the work tables. Task 5's check measures the wall-face rate on the same two sets."""
    xs = np.arange(common.X0 + 0.05, common.X1 - 0.05, 0.05); ys = np.arange(common.Y0 + 0.05, common.Y1 - 0.05, 0.05)
    X, Y = np.meshgrid(xs, ys, indexing="ij")
    floor = np.stack([X.ravel(), Y.ravel(), np.full(X.size, common.FLOOR_Z + 0.02)], 1)
    return floor, np.sort(np.random.default_rng(SPLAT_SEED).choice(n, SPLAT_SAMPLE, replace=False))


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
    pos = np.load(os.path.join(cfg.paths["work"], "npy", "splats_pos.npy"), mmap_mode="r")
    floor, pick = _check_sun_points(common, len(pos))
    sets = {"floor": floor, "splats": np.asarray(pos[pick], np.float64)}
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
    _write_evidence(os.path.join(cfg.paths["evidence"], "sun-check.json"), out)
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
    kept = _save_npz_if(os.path.join(work, "probes-coarse.npz"), out["pass"], cfg.paths["evidence"], cubes=cubes16, valid=valid,
                        origin=origin, shape=np.asarray(shape, np.int64), spacing=np.float64(spacing))
    out["artifact"] = _artifact(kept) if out["pass"] else None   # the evidence follows its artifact (Task 4c)
    _write_evidence(os.path.join(cfg.paths["evidence"], "probes-check.json"), out)
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
    kept = _save_npz_if(os.path.join(work, "sun-bounce.npz"), ok, cfg.paths["evidence"], basis=basis[:K],
                        coeffs=baked.coeffs[..., :K], floorMean=floor_mean[:K].astype(np.float32), needed=needed,
                        azimuth0=np.float64(az0), elevation0=np.float64(el0), step=np.float64(SB.STEP), gridOrigin=origin1,
                        gridShape=np.asarray(shape1, np.int64), gridSpacing=np.float64(SB.SPACING), valid=valid1,
                        real=baked.real, nodePower=node_power_grid, patchRays=room.rays, patchNormal=room.normals,
                        patchArea=room.areas)
    out["artifact"] = _artifact(kept) if ok else None            # the evidence follows its artifact (Task 4c)
    _write_evidence(os.path.join(cfg.paths["evidence"], "sun-bounce-check.json"), out)

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
    _write_evidence(os.path.join(cfg.paths["evidence"], "floor-light.json"),
                    {"shares": share, "w3Share": share["W3"], "threshold": FLOOR_W3_SHARE, "pass": lit_ok,
                     "artifact": _artifact(kept) if lit_ok else None})
    print(f"floor: D {D.shape} float32; W3 lights {share['W3']:.4f} of the floor ({'PASS' if lit_ok else 'FAIL'}: above "
          f"{FLOOR_W3_SHARE}); {'floor-light.npz written' if lit_ok else 'the failing light maps kept at ' + kept}, "
          f"{time.time() - started:.0f} s", flush=True)
    return 0 if lit_ok else 1


COMMANDS["floor"] = cmd_floor


def cmd_skin_light(cfg, args) -> int:
    """<work>/skin-light/<id>.records and index.json (R1c, amendment A4): every skin light texel's nine sources' direct
    light, cmd_floor's model at the skins' texel centres and normals (tools/skins' light-grids.json), as R1a records with
    the skins' own ranges; each skin's sun-reachable share on its 2 cm sun grid (windows.sun_reach), its sun grid named
    only when some texel is reachable. CPU only."""
    import importlib
    from . import codec, floorlight as FL, probes as PR, skinlight as SL
    from . import windows as W
    if args.skins is None:
        print("skin-light needs --skins <tools/skins work>/geometry/light-grids.json", flush=True)
        return 2
    common, lt, _radiosity, fit04 = _proof_modules()
    b3 = importlib.import_module("03_bases")
    started, work = time.time(), cfg.paths["work"]
    with np.load(os.path.join(work, "probes.npz")) as z:
        volume = {"cubes": z["win_cubes"], "origin": tuple(float(v) for v in z["origin"]),
                  "shape": tuple(int(v) for v in z["shape"]), "keep": z["keep"]}
    with np.load(os.path.join(work, "geom.npz")) as z:
        house = {"chandeliers": z["chandeliers"], "dome_c": z["dome_c"]}
    with np.load(os.path.join(work, "bases.npz")) as z:
        house["ring"] = z["ring"]
    box = (common.X0, common.X1, common.Y0, common.Y1, common.FLOOR_Z)
    grids = SL.skin_light_grids(args.skins)
    lights = []
    for g in grids:
        q, n = SL.grid_points(g["texelToModel"], g["size"]), g["normals"].reshape(-1, 3)
        direct = FL.patch_direct(lt, b3.trilinear_weights, volume, house, box, q, n)
        D = PR.patch_direct_by_source(direct, np.array(fit04.SKY_W))
        if not np.isfinite(D).all() or (D < 0).any():
            print(f"FAIL: {g['id']}: the direct light is not finite and non-negative", flush=True)
            return 1
        lights.append(D)
    ranges = [codec.source_range(np.concatenate([D[:, k] for D in lights])) for k in range(len(SOURCES))]
    vols, _horizons, _fresnel = windows_volumes(cfg)
    out = os.path.join(work, "skin-light")
    os.makedirs(out, exist_ok=True)
    index = {"ranges": [list(r) for r in ranges], "skins": []}
    for g, D in zip(grids, lights):
        with open(os.path.join(out, f"{g['id']}.records"), "wb") as f:
            f.write(SL.pack_skin_records(D, g["normals"].reshape(-1, 3), ranges))
        reach, sun = 0.0, None
        if g["sun"] is not None:
            P = SL.grid_points(g["sun"]["texelToModel"], g["sun"]["size"])
            reach = float(np.mean(W.sun_reach(vols, P, cfg.room["site"]["latitude"])))
            if reach > 0:
                sun = {"size": list(g["sun"]["size"]), "texelToModel": [float(x) for x in g["sun"]["texelToModel"].ravel()]}
        index["skins"].append({"id": g["id"], "group": g["group"], "lightTexel": g["lightTexel"], "size": list(g["size"]),
                               "texelToModel": [float(x) for x in g["texelToModel"].ravel()], "reachShare": reach, "sun": sun})
        print(f"skin-light {g['id']}: {g['size'][0]} x {g['size'][1]} texels, sun reach {reach:.3f}", flush=True)
    with open(os.path.join(out, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, indent=1, allow_nan=False)
    _write_evidence(os.path.join(cfg.paths["evidence"], "skin-light.json"),
                    {"skins": len(grids), "texels": int(sum(len(D) for D in lights)), "ranges": index["ranges"],
                     "seconds": round(time.time() - started, 1), "artifact": _artifact(os.path.join(out, "index.json")),
                     "records": {g["id"]: _artifact(os.path.join(out, f"{g['id']}.records"))["sha256"] for g in grids}})
    return 0


COMMANDS["skin-light"] = cmd_skin_light


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


ARTIFACTS = (("windows.npz", "windows.json"), ("probes-coarse.npz", "probes-check.json"),
             ("sun-bounce.npz", "sun-bounce-check.json"), ("floor-light.npz", "floor-light.json"))


def cmd_record_artifacts(cfg, args) -> int:
    """Each work artifact written before the commands recorded it themselves (Task 4c), added to its evidence JSON with
    its exact path, SHA-256 and size. Refuses an evidence file that records a failing run or another hash; a record it
    already holds must equal the file's in every field (path and size too), so it is rewritten identically, never
    differently."""
    for name, evidence in ARTIFACTS:
        path, ev = os.path.join(cfg.paths["work"], name), os.path.join(cfg.paths["evidence"], evidence)
        data = {}
        if os.path.exists(ev):
            with open(ev, encoding="utf-8") as f:
                data = json.load(f)
        if data.get("pass") is False:
            print(f"FAIL: {evidence} records a failing run; {name} is not recorded", flush=True)
            return 1
        record = _artifact(path)
        old = data.get("artifact")
        if old and old.get("sha256") != record["sha256"]:
            print(f"FAIL: {evidence} records {old['sha256']} but {name} is {record['sha256']}", flush=True)
            return 1
        if old and old != record:
            print(f"FAIL: {evidence} records {json.dumps(old)} but {name} is {json.dumps(record)}", flush=True)
            return 1
        data["artifact"] = record
        _write_evidence(ev, data)
        print(f"{name}: {record['sha256']} -> {evidence}", flush=True)
    return 0


COMMANDS["record-artifacts"] = cmd_record_artifacts


# ------------------------------------------------------------------------------------- records and check (Task 5)
CENTRE_CHANDELIER = 2       # 03_bases.py fills E_ch column 1 from chandelier 2 (e[:, 2]): the centre chandelier's id
SH_C0 = 0.28209479177387814  # the SOG's DC colour scale, as 01_extract.py decodes the stored colour
MULT_CHUNK = 50_000         # splats per reference.multiplier call (its probe gather holds 8 x 162 doubles per splat)
IDENTITY_GATE = {"absLog2": 0.05, "share": 0.999}                     # check 1, per tile
REGRESSION_GATE = {"median": 0.1, "p95": 0.3, "sunnyMedian": 0.25}    # check 2, |dlog2| over interior splats
TRANSFER_GATE = {"median": 0.1}                                       # check 3, per coarser tile
SKY_CHECK_GATE = {"median": 0.02, "p99": 0.1}                         # check 5 (b)
SKY_CHECK_SPLATS, SKY_CHECK_DIRECTIONS = 20_000, 48
SKY_CHECK_SUN_SEED, SKY_CHECK_MOON_SEED = SPLAT_SEED + 31, SPLAT_SEED + 37
PROOF_SETTINGS = ("night", "overcast_noon", "sunny_morning")
MOON_TEST = (139.3, 32.3)   # moon_test's Moon (R1d A8): the moonlit preset's full Moon, compass azimuth and elevation
RAY_SUN_SEED = SPLAT_SEED + 2                                         # the vectors' two random suns
GATE_MARGIN = 1e-6          # degrees: no vector direction's elevation lies this close to a window's horizon
VECTORS_SCHEMA = "venviewer.relight-vectors.v1"
VECTORS_FIXTURE = ("packages", "web", "src", "lib", "relight", "__fixtures__", "relight-vectors.json")
VECTORS_CAP = (1_000_000, 1_600, 30)    # bytes: 1,000 kB + 1.6 kB x max(0, K - 30) (re-review N4)
VECTOR_SPLATS = (("interior", (0,), 16), ("embrasure", (1,), 16), ("bulbs", (3, 4), 8), ("fixtures and cove", (6, 5), 8),
                 ("sun-reachable floor", (0,), 8), ("hidden", (2,), 8))
VECTOR_FLOOR_POINTS = (12, 12, 8)       # the window rays' floor points: lit, marched but dark, wall-face cases
STABLE_MOVE = 0.001         # metres: a sun-flagged vector splat keeps its visibility (within 1e-6) moved this far
FOLD_MIN_WEIGHT = 1e-6      # the fold's corners weigh at least this: a probe that lies on a 1 m node (the hall's grids
                            # start at z 0.02, and 4.02 - 0.02 rounds to 3.9999999999999996) has corners of weight 1e-16,
                            # which another float order would not pick; a probe inside its 1 m cell has eight of 1/8
# The work tables records reads (through the proof's store.Store and its own reads), hashed into evidence.artifacts with
# the window cookie and the lamp/daylight ratio; splats_scl too with --skins.
BUILD_TABLES = ("splats_pos", "splats_rgb", "splats_opa", "splats_tile", "geom_cls", "geom_chand_id", "bases_n", "bases_iso",
                "bases_E_win", "bases_E_ch", "bases_E_dome", "bases_E_cove", "sun_cap_E")
SKIN_TABLES = ("splats_scl",)
CENSUS = ("tools", "xgrids-lcc2", "scripts", "sog-floor-census.py")   # the repo's SOG decoder, which records and check run
# The proof's probe lookup box (store.Probes.lookup, store.py:60-62; also 03_bases.py:150-151 and 194, 03b_window_fresnel.py:
# 48 and 68): every position is clamped to 2 cm inside the hall's walls, and from 2 cm above its floor up to 9.8 m.
PROBE_LOOKUP_INSET, PROBE_LOOKUP_TOP = 0.02, 9.8


def _floats(a) -> list:
    return [float(v) for v in np.asarray(a, np.float64).ravel()]


def _abs_path(path):
    return None if path is None else os.path.abspath(path).replace("\\", "/")


@dataclass(frozen=True)
class _Proof:
    """The moved proof modules records and check read the light model through (the tests hand in stand-ins)."""
    common: object        # common.py: the frames, the sun vector, the solar position, the hall's box
    fit04: object         # 04_fit.py: BASES and direct(store, idx)
    relight05: object     # 05_relight.py: SCENARIOS, scenario_light, W, WC, cookie, exterior_masks, cove_strip
    store: object         # store.py: Store, mm, LUMW, LUT


def _load_proof() -> _Proof:
    """The proof's modules (after use_proof), torch capped at THREADS (05_relight sets 8 threads when imported)."""
    import importlib
    common, _lt, _radiosity, fit04 = _proof_modules()
    relight05 = importlib.import_module("05_relight")
    import store, torch
    torch.set_num_threads(THREADS)
    return _Proof(common=common, fit04=fit04, relight05=relight05, store=store)


def _census(cfg):
    """The repo's SOG decoder (tools/xgrids-lcc2/scripts/sog-floor-census.py, decode_tile), loaded read-only as
    01_extract.py loads it."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("census", os.path.join(cfg.paths["repo"], *CENSUS))
    census = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(census)
    return census


def _bundle_tiles(cfg) -> dict:
    """This room's served tiles as the repo's bundle file lists them (cfg.paths["bundle"], relative to the repo):
    {file: {lodLevel, sha256, bytes, ...}}, parsed as sog-floor-census.py parses it."""
    path = cfg.paths["bundle"] if os.path.isabs(cfg.paths["bundle"]) else os.path.join(cfg.paths["repo"], cfg.paths["bundle"])
    with open(path, encoding="utf-8") as f:
        text = f.read()
    decl = text.index("GeneratedRoomSplatBundle[] =")
    rooms = [r for r in json.loads(text[text.index("[", decl + 30):text.rindex("]") + 1]) if r["roomSlug"] == cfg.room["slug"]]
    if len(rooms) != 1:
        raise ValueError(f"the bundle file lists {len(rooms)} rooms {cfg.room['slug']}")
    return {t["file"]: t for t in rooms[0]["tiles"]}


def _served_tile(bundle, splats_dir, name):
    """(SHA-256, level, splat count) of a served tile: refused unless the bundle file serves this exact file."""
    import zipfile
    from . import package as PK
    path = os.path.join(splats_dir, name)
    sha = PK.sha256_file(path)
    entry = bundle.get(name)
    if entry is None or entry.get("sha256") != sha:
        raise ValueError(f"{path} ({sha}) is not the tile the bundle file serves ({entry and entry.get('sha256')})")
    with zipfile.ZipFile(path) as z:
        count = int(json.loads(z.read("meta.json"))["count"])
    return sha, entry["lodLevel"], count


def _sog_splats(census, proof, path):
    """A served tile's splats as the light model takes them: model-frame centres (n, 3) float64 (decode_tile's, through
    common.json_to_e57), captured linear colours (n, 3) float32 (the stored DC colour rounded as 01_extract.py rounds it,
    sRGB-decoded by store.LUT) and largest scales (n,) float64 (decode_tile's, the codebook already exponentiated)."""
    import io, zipfile
    from PIL import Image
    centers, scales, _quats, _opacity, meta = census.decode_tile(path)
    n = int(meta["count"])
    with zipfile.ZipFile(path) as z:
        sh0 = np.asarray(Image.open(io.BytesIO(z.read(meta["sh0"]["files"][0]))).convert("RGBA"), dtype=np.uint8).reshape(-1, 4)[:n]
    cb = np.array(meta["sh0"]["codebook"], dtype=np.float64)
    stored = np.clip(np.round((0.5 + SH_C0 * cb[sh0[:, :3]]) * 255.0), 0, 255).astype(np.uint8)
    return (np.asarray(proof.common.json_to_e57(centers), np.float64), proof.store.LUT[stored],
            np.asarray(scales, np.float64).max(1))


def _finest_tree(pos):
    """The k-d tree of the finest splats' positions (float64), built once and shared by every coarser tile's transfer."""
    from scipy.spatial import cKDTree
    return cKDTree(np.asarray(pos, np.float64))


def _transferred(tree, src, values, dst, k):
    """records.transfer of the finest splats' values (at src, whose k-d tree is `tree`) to the points dst, dst in chunks
    of windows.CHUNK: the same queries as a tree built per call, so the same values."""
    from . import records as RC
    from . import windows as W
    return np.concatenate([RC.transfer(src, values, dst[a:a + W.CHUNK], k=k, tree=tree) for a in range(0, len(dst), W.CHUNK)])


def _transferred_nearest(tree, values, dst, k):
    """(the k-neighbour blend of `values`, each point's nearest finest splat) for the points dst, from one query per
    chunk of windows.CHUNK (records.transfer_nearest): exactly _transferred(..., k) and _transferred(..., 1)."""
    from . import records as RC
    from . import windows as W
    parts = [RC.transfer_nearest(values, dst[a:a + W.CHUNK], k, tree) for a in range(0, len(dst), W.CHUNK)]
    return np.concatenate([p[0] for p in parts]), np.concatenate([p[1] for p in parts])


def _finest_light(cfg, vols, proof) -> dict:
    """Step 6 item 1, per finest-level splat in the work tables' product order: `direct` (N, 9) float32 from
    04_fit.direct (its ten bases picked by name in the records' source order, sun_cap left out; for class 1 the rows that
    03c rewrote with the room-side light, as 04_fit.direct reads them), `normals` (bases_n, e57 frame), and the model
    values the flags are made of: `cls`, `iso`, `chand` (geom_chand_id), `cove` (05_relight.cove_strip), `fixture` (in a
    chandelier with class 0), `pane` (05_relight.exterior_masks' pane haze), `reach` (windows.sun_reach for classes 0
    and 1 only) and `flags` (records.flags_for). In chunks of windows.CHUNK; numpy, no GPU."""
    from . import records as RC
    from . import windows as W
    store_mod, fit04, relight05 = proof.store, proof.fit04, proof.relight05
    columns = [list(fit04.BASES).index(name) for name in SOURCES]
    st = store_mod.Store()
    n = st.N
    chand = store_mod.mm("geom_chand_id")
    occ = relight05.cookie()
    lat = float(cfg.room["site"]["latitude"])
    out = {"direct": np.empty((n, len(SOURCES)), np.float32), "normals": np.empty((n, 3), np.float16),
           "cls": np.empty(n, np.uint8), "iso": np.empty(n, bool), "chand": np.empty(n, np.int8), "cove": np.empty(n, bool),
           "fixture": np.empty(n, bool), "pane": np.empty(n, bool), "reach": np.empty(n, bool), "flags": np.empty(n, np.uint8)}
    for sl in st.chunks(W.CHUNK):
        p, cls, C = np.asarray(st.pos[sl]), np.asarray(st.cls[sl]), st.colour(sl)
        _outside, pane = relight05.exterior_masks(p, cls, occ, np.asarray(st.opa[sl]), lambda i, C=C: C[i] @ store_mod.LUMW)
        cove = relight05.cove_strip(p, cls, C @ store_mod.LUMW)
        ch, iso = np.asarray(chand[sl]), np.asarray(st.iso[sl])
        fixture = (ch >= 0) & (cls == 0)
        reach = np.zeros(len(p), bool)
        room = (cls == 0) | (cls == 1)
        reach[room] = W.sun_reach(vols, np.asarray(p[room], np.float64), lat)
        out["direct"][sl] = fit04.direct(st, sl)[:, columns]
        out["normals"][sl] = np.asarray(st.n[sl])
        for key, value in (("cls", cls), ("iso", iso), ("chand", ch), ("cove", cove), ("fixture", fixture), ("pane", pane),
                           ("reach", reach)):
            out[key][sl] = value
        out["flags"][sl] = RC.flags_for(cls, iso, reach, ch, (CENTRE_CHANDELIER,), cove, fixture, pane)
    return out


def _skinned(flags, P, sigma, skins, name, level):
    """R1c's covers and toggles (amendment A3) on one tile's flags, each splat at its own e57 position, with the counts
    printed: covered splats per wall group and toggled splats per toggle."""
    from . import codec, package as PK, records as RC
    covers, toggles, keep = skins
    out = RC.apply_toggles(RC.apply_covers(flags, P, sigma, covers, keep), P, toggles)
    groups, bits = codec.skin_group_of(out), codec.toggle_of(out)
    covered = {g: int((groups == i).sum()) for i, g in enumerate(PK.SKIN_GROUPS)}
    print(f"  {name} (level {level}): covered {json.dumps(covered)}, toggled "
          f"{json.dumps({str(t): int((bits == t).sum()) for t in (1, 2)})}", flush=True)
    return out


def _skin_light_section(cfg, skin_light, skin_package):
    """Package v2's skins (R1c): skinlight.skins_section of the work's skin-light folder, read only once
    <evidence>/skin-light.json's artifact matches its index.json and each <id>.records its recorded SHA-256. Returns
    (section, {path: gzip bytes}, {artifact path relative to the work folder: sha256})."""
    from . import package as PK, skinlight as SL
    if not skin_light or not skin_package:
        raise ValueError("package v2 needs both --skin-light and --skin-package")
    work = os.path.abspath(cfg.paths["work"])
    rel = os.path.relpath(os.path.abspath(skin_light), work).replace("\\", "/")
    if rel == ".." or rel.startswith("../"):
        raise ValueError(f"--skin-light {skin_light} is not inside the work folder whose skin-light.json describes it")
    _path, index_sha = PK.verified(work, cfg.paths["evidence"], f"{rel}/index.json", "skin-light.json")
    with open(os.path.join(cfg.paths["evidence"], "skin-light.json"), encoding="utf-8") as f:
        recorded = json.load(f).get("records") or {}
    with open(os.path.join(skin_light, "index.json"), encoding="utf-8") as f:
        ids = [s["id"] for s in json.load(f)["skins"]]
    if sorted(ids) != sorted(recorded):
        raise ValueError("skin-light.json's records and index.json's skins name different skins")
    artifacts = {f"{rel}/index.json": index_sha}
    for sid in ids:
        got = PK.sha256_file(os.path.join(skin_light, f"{sid}.records"))
        if got != recorded[sid]:
            raise ValueError(f"{sid}.records is not the file skin-light.json records ({recorded[sid]})")
        artifacts[f"{rel}/{sid}.records"] = got
    section, files = SL.skins_section(skin_light, skin_package, list(PK.SKIN_GROUPS))
    return section, files, artifacts


def _input_hashes(cfg, skins) -> dict:
    """{path relative to the work folder, '/'-separated: SHA-256} of the work files records reads beyond the artifacts
    that evidence records (fix round 1, M1): the per-splat tables (BUILD_TABLES, and SKIN_TABLES with --skins), the
    window cookie and the lamp/daylight ratio, which is refused unless it is byte for byte the proof's measurement it was
    copied from (stage_lamp_colour)."""
    from . import package as PK
    work = cfg.paths["work"]
    names = [f"npy/{t}.npy" for t in BUILD_TABLES + (SKIN_TABLES if skins else ())] + ["occ_cookie.npz", LAMP_RATIO]
    out = {name: PK.sha256_file(os.path.join(work, *name.split("/"))) for name in names}
    source = PK.sha256_file(os.path.join(cfg.paths["proofWork"], LAMP_RATIO))
    if out[LAMP_RATIO] != source:
        raise ValueError(f"{work}/{LAMP_RATIO} ({out[LAMP_RATIO]}) is not the proof's measurement it was copied from ({source})")
    return out


def _lookup_box(common) -> dict:
    """The manifest's probes.box: the proof's probe lookup box from its own hall frame (common.X0 .. FLOOR_Z, which
    common.py reads from the config's hallE57), as store.Probes.lookup clamps (PROBE_LOOKUP_INSET, PROBE_LOOKUP_TOP)."""
    i = PROBE_LOOKUP_INSET
    return {"lo": [common.X0 + i, common.Y0 + i, common.FLOOR_Z + i], "hi": [common.X1 - i, common.Y1 - i, PROBE_LOOKUP_TOP]}


def _package_inputs(cfg, proof, tables):
    """The package's inputs besides the records (package.Inputs), each work artifact read by its exact name and only
    after its SHA-256 and size match its passing evidence (package.verified; fit.json and fit_state.npz through
    refit.json's promote, package.verified_fit), with evidence.artifacts {name: sha256}, the input tables' hashes
    (_input_hashes) among them."""
    from . import package as PK
    common, relight05 = proof.common, proof.relight05
    work, ev = cfg.paths["work"], cfg.paths["evidence"]
    artifacts = {name: PK.verified(work, ev, name, evidence_name)[1] for name, evidence_name in ARTIFACTS}
    fit, fit_hashes, refit = PK.verified_fit(work, ev)
    artifacts.update(fit_hashes)
    artifacts.update(tables)
    vols, horizons, fresnel = windows_volumes(cfg)
    with np.load(os.path.join(work, "probes-coarse.npz")) as z:
        probes = {k: z[k] for k in ("cubes", "valid", "origin", "shape", "spacing")}
    probes["box"] = _lookup_box(common)
    with np.load(os.path.join(work, "sun-bounce.npz")) as z:
        sky = {k: z[k] for k in (*PK.SKY_ARRAYS, *PK.SKY_FRAME)}
    with np.load(os.path.join(work, "floor-light.npz")) as z:
        floor = {"D": z["D"], "texelToModel": z["texelToModel"], "texel": float(cfg.room["floorTexel"])}
    with open(os.path.join(work, LAMP_RATIO), encoding="utf-8") as f:
        measured = json.load(f)["lamp_over_daylight_rgb"]
    with open(os.path.join(ev, "sun-check.json"), encoding="utf-8") as f:
        sun_check = json.load(f)
    with open(os.path.join(ev, "sun-bounce-check.json"), encoding="utf-8") as f:
        sky_check = json.load(f)
    if sun_check.get("pass") is not True:
        print("WARNING: sun-check.json does not record a passing check; the manifest's evidence.sunCheck says so", flush=True)
    capture = PK.capture_of(fit)
    site = cfg.room["site"]
    presets = json.loads(json.dumps({name: relight05.SCENARIOS[name] for name in ("night", "sunny_morning", "overcast_noon")}))
    return PK.Inputs(
        room=cfg.room["slug"], tile_to_model=np.asarray(common.T_EJ, np.float64),
        site={"latitude": float(site["latitude"]), "longitude": float(site["longitude"]), "north": common.sun_vec_e57(0, 0),
              "east": common.sun_vec_e57(90, 0), "up": [0.0, 0.0, 1.0]},
        capture=capture, lamps=PK.lamps_of(capture, measured, refit), volumes=vols, horizons=horizons, fresnel=fresnel,
        probes=probes, sky=sky, floor=floor, presets=presets,
        evidence={"sunCheck": PK.sun_check_summary(sun_check), "skyBounce": PK.sky_bounce_summary(sky_check),
                  "refit": PK.refit_summary(refit), "artifacts": artifacts})


def _build_package(cfg, out, tool, created_at, build, proof=None) -> dict:
    """The records command's work (Step 6) into the folder `out`; returns the manifest. Every work artifact is verified
    first and every input table hashed (and hashed again before the write: refused if one changed meanwhile). The finest
    level's light (_finest_light) is split into its tiles (splats_tile, in finestTiles' order), with the nine sources'
    ranges over all of it. Every other served tile (each .sog of the splats folder not in finestTiles) takes, by transfer
    from the finest splats (one k-d tree for all of them, one neighbour query per chunk: _transferred_nearest), the
    direct light of the transferNeighbours nearest (inverse distance) and the normal, class, iso, chandelier id, cove,
    fixture and pane values of the nearest; its reach is computed at its own positions for its classes 0 and 1 (a
    transferred flag would not be conservative there) and its flags again. With build["skins"], R1c's covers and toggles
    on every level; with build["skinLight"] and build["skinPackage"], package v2's skins section. Then package.write.
    proof: the proof's modules (_load_proof)."""
    from . import codec, package as PK, records as RC
    from . import windows as W
    proof = proof or _load_proof()
    started = time.time()
    tables = _input_hashes(cfg, build.get("skins"))
    inputs = _package_inputs(cfg, proof, tables)      # every artifact verified before any per-splat work
    skins = RC.load_skin_inputs(build["skins"]) if build.get("skins") else None
    v2 = build.get("skinLight") or build.get("skinPackage")
    skin_light = _skin_light_section(cfg, build.get("skinLight"), build.get("skinPackage")) if v2 else None
    census, bundle = _census(cfg), _bundle_tiles(cfg)
    light = _finest_light(cfg, inputs.volumes, proof)
    ranges = [codec.source_range(light["direct"][:, k]) for k in range(len(SOURCES))]
    npy = os.path.join(cfg.paths["work"], "npy")
    tile_of = np.load(os.path.join(npy, "splats_tile.npy"))
    pos = np.asarray(np.load(os.path.join(npy, "splats_pos.npy"), mmap_mode="r"), np.float64)
    room = (light["cls"] == 0) | (light["cls"] == 1)
    print(f"records: finest level {len(pos)} splats; the sky-body flag on {float(light['reach'][room].mean()):.5f} of classes 0 "
          f"and 1, {float(light['reach'].mean()):.5f} of all; ranges {json.dumps(ranges)}; {time.time() - started:.0f} s", flush=True)
    finest, tiles = list(cfg.room["finestTiles"]), []
    for t, name in enumerate(finest):
        sha, level, count = _served_tile(bundle, cfg.paths["splats"], name)
        rows = np.nonzero(tile_of == t)[0]
        if len(rows) != count:
            raise ValueError(f"{name} serves {count} splats but the work tables hold {len(rows)} of it")
        flags = light["flags"][rows]
        if skins is not None:
            scl = np.load(os.path.join(npy, "splats_scl.npy"), mmap_mode="r")
            flags = _skinned(flags, pos[rows], np.asarray(scl[rows], np.float64).max(1), skins, name, level)
        tiles.append(PK.Tile(name, sha, level, codec.pack_records(light["direct"][rows], light["normals"][rows], flags, ranges)))
        print(f"  {name}: level {level}, {count} splats", flush=True)
    lat, k = float(cfg.room["site"]["latitude"]), int(cfg.room["transferNeighbours"])
    tree = None
    for name in sorted(n for n in os.listdir(cfg.paths["splats"]) if n.endswith(".sog") and n not in finest):
        sha, level, count = _served_tile(bundle, cfg.paths["splats"], name)
        P, _colour, sigma = _sog_splats(census, proof, os.path.join(cfg.paths["splats"], name))
        if len(P) != count:
            raise ValueError(f"{name} decodes to {len(P)} splats, not its {count}")
        if tree is None:
            tree = _finest_tree(pos)
        direct, near = _transferred_nearest(tree, light["direct"], P, k)
        cls = light["cls"][near]
        reach = np.zeros(len(P), bool)
        own = (cls == 0) | (cls == 1)
        reach[own] = W.sun_reach(inputs.volumes, P[own], lat)
        flags = RC.flags_for(cls, light["iso"][near], reach, light["chand"][near], (CENTRE_CHANDELIER,), light["cove"][near],
                             light["fixture"][near], light["pane"][near])
        if skins is not None:
            flags = _skinned(flags, P, sigma, skins, name, level)
        tiles.append(PK.Tile(name, sha, level, codec.pack_records(direct, light["normals"][near], flags, ranges)))
        print(f"  {name}: level {level}, {count} splats by transfer, the sky-body flag on {float(reach.mean()):.4f}; "
              f"{time.time() - started:.0f} s", flush=True)
    if sorted(t.name for t in tiles) != sorted(bundle):
        raise ValueError(f"the splats folder's tiles {sorted(t.name for t in tiles)} are not the bundle's {sorted(bundle)}")
    if _input_hashes(cfg, build.get("skins")) != tables:
        raise ValueError("a work table changed while the records were computed; nothing written")
    return PK.write(out, inputs, tiles, ranges, tool=tool, created_at=created_at, build=build, skins=skin_light)


def cmd_records(cfg, args, proof=None) -> int:
    """Every served tile's records and the relight package (Task 5 Step 6) in --out, else the config's out, built only
    from committed code: the manifest's tool is the HEAD commit and createdAt its committer time (_committed_tool), so a
    second build at the same commit is byte-identical; evidence.build records the options and the host that built it
    (check 4 rebuilds only on that host). --skins <tools/skins geometry folder> adds R1c's covers and toggles;
    --skin-light <work>/skin-light with --skin-package <skin package folder> makes package v2."""
    committed = _committed_tool(cfg)
    if committed is None:
        return 1
    tool, created_at = committed
    out = args.out or cfg.paths["out"]
    build = {"skins": _abs_path(args.skins), "skinLight": _abs_path(args.skin_light), "skinPackage": _abs_path(args.skin_package),
             "host": _host()}
    started = time.time()
    manifest = _build_package(cfg, out, tool, created_at, build, proof)
    counts = [t["count"] for t in manifest["tiles"]]
    print(f"records: {len(counts)} tiles, {sum(counts)} splats; {out}: {len(manifest['files'])} files and manifest.json, "
          f"{sum(f['bytes'] for f in manifest['files'].values())} bytes; tool {tool} ({created_at}); K {manifest['sky']['k']}; "
          f"ch_centre / ch_end {manifest['capture']['weights'][7] / manifest['capture']['weights'][6]:.6f}; "
          f"{time.time() - started:.0f} s", flush=True)
    return 0


COMMANDS["records"] = cmd_records


def _check_settings(model, proof) -> dict:
    """The settings the checks and the vectors use. captured: Setting.captured. The proof's night, overcast_noon and
    sunny_morning, built as 05_relight.scenario_light builds them on the fit_state.npz it loaded: window w's weight
    W[w] x sky x col_sky, each lamp's house x Wc[lamp], the sun f_sun x col_sun toward the scenario's solar position,
    every lamp group at 1 when the scenario's lamps are lit, else 0, emitter boost 1. moon_test (R1d A8, not a preset):
    no lamp, no sky, no Sun; the Moon at the moonlit preset's place, common.sun_vec_e57(139.3, 32.3), with sunny_morning's
    sun RGB."""
    from . import reference
    common, fit04, relight05 = proof.common, proof.fit04, proof.relight05
    bases = list(fit04.BASES)
    settings = {"captured": reference.Setting.captured(model)}
    for name in PROOF_SETTINGS:
        sc = relight05.SCENARIOS[name]
        col_sky, col_sun, f_sun = relight05.scenario_light(sc)
        weights = np.zeros((len(SOURCES), 3))
        for k, source in enumerate(SOURCES):
            b = bases.index(source)
            weights[k] = (relight05.W[b] * sc["sky"] * np.asarray(col_sky, np.float64) if k < 5
                          else sc["house"] * np.asarray(relight05.WC[b], np.float64))
        sun = None if sc["sun"] is None else np.asarray(common.sun_vec_e57(*common.solar_position(*sc["sun"])), np.float64)
        level = 1.0 if sc["emit"] == "lit" else 0.0
        settings[name] = reference.Setting(
            weights=weights, sky_level=float(sc["sky"]), sky_colour=np.asarray(col_sky, np.float64),
            lamp_levels={g: level for g in reference.LAMP_GROUPS}, sun_dir=sun,
            sun_rgb=np.zeros(3) if sun is None else float(f_sun) * np.asarray(col_sun, np.float64), emitter_boost=1.0)
    settings["moon_test"] = reference.Setting(
        weights=np.zeros((len(SOURCES), 3)), sky_level=0.0, sky_colour=np.asarray(model.daylight_colour, np.float64),
        lamp_levels={g: 0.0 for g in reference.LAMP_GROUPS}, sun_dir=None, sun_rgb=np.zeros(3), emitter_boost=1.0,
        moon_dir=np.asarray(common.sun_vec_e57(*MOON_TEST), np.float64), moon_rgb=settings["sunny_morning"].sun_rgb.copy())
    return settings


def _finest_check_tables(cfg, pkg) -> dict:
    """The finest level in the work tables' product order with its records read back from the package's finest tiles
    (splats_tile, in finestTiles' order): records (N, 12) uint8, tile (N,), positions (float32, memory-mapped, as the
    bake read them), the stored colours and the chandelier ids (memory-mapped)."""
    npy = os.path.join(cfg.paths["work"], "npy")
    tile_of = np.load(os.path.join(npy, "splats_tile.npy"))
    rec = np.zeros((len(tile_of), 12), np.uint8)
    for t, name in enumerate(cfg.room["finestTiles"]):
        rows = np.nonzero(tile_of == t)[0]
        got = pkg.records(name)
        if len(got) != len(rows):
            raise ValueError(f"the package's {name} holds {len(got)} records for its {len(rows)} finest splats")
        rec[rows] = got
    return {"records": rec, "tile": tile_of, "pos": np.load(os.path.join(npy, "splats_pos.npy"), mmap_mode="r"),
            "rgb": np.load(os.path.join(npy, "splats_rgb.npy"), mmap_mode="r"),
            "chand": np.load(os.path.join(npy, "geom_chand_id.npy"), mmap_mode="r")}


def _multipliers(model, setting, ranges, records, pos, colour):
    """reference.multiplier over n splats in chunks of MULT_CHUNK: (rgb (n, 3), alpha (n,)), float64. records (n, 12) as
    the package holds them, decoded as the browser decodes them; pos (n, 3) model frame; colour (n, 3) captured linear.
    Arrays or memory maps, read a chunk at a time. The sky bodies' bounce at the probes is computed once for all chunks
    (reference.sky_cubes, as multiplier itself would per call)."""
    from . import package as PK, reference
    bodies = reference.sky_bodies(setting)
    sky = reference.sky_cubes(model, bodies) if bodies and model.volumes and model.sky is not None else None
    n = len(records)
    M, A = np.empty((n, 3)), np.empty(n)
    for a in range(0, n, MULT_CHUNK):
        b = min(n, a + MULT_CHUNK)
        direct, normals, flags = PK.decode(records[a:b], ranges)
        M[a:b], A[a:b] = reference.multiplier(direct, normals, flags, np.asarray(pos[a:b], np.float64),
                                              np.asarray(colour[a:b], np.float64), model, setting, sky_probes=sky)
    return M, A


def _abs_dlog2(a, b):
    """(|log2 a - log2 b| for every channel where both are positive, pooled; the number of values where either is not)."""
    a, b = np.asarray(a, np.float64), np.asarray(b, np.float64)
    ok = (a > 0) & (b > 0)
    return np.abs(np.log2(a[ok]) - np.log2(b[ok])), int((~ok).sum())


def _identity(M, alpha) -> dict:
    """Check 1 on one tile: the share of its non-hidden splats (alpha > 0) whose |log2 M| is within 0.05 on every channel."""
    shown = alpha > 0
    with np.errstate(divide="ignore"):
        err = np.abs(np.log2(M[shown])).max(1) if shown.any() else np.zeros(0)
    count, within = int(shown.sum()), int((err <= IDENTITY_GATE["absLog2"]).sum())
    share = within / count if count else 1.0
    finite = err[np.isfinite(err)]
    return {"splats": count, "within": within, "share": share, "worstAbsLog2": float(finite.max()) if finite.size else 0.0,
            "pass": bool(share >= IDENTITY_GATE["share"])}


def _versus_proof(M, path, rows, n) -> dict:
    """|dlog2| of the reference multipliers M at the finest splats `rows` against a 05_relight multiplier file (N x 4
    float16, product order), the proof's values taken through the spec's clamp [1/16, 8], which the reference applies;
    the share the clamp moved is recorded. A file that is not N x 4 float16 raises ValueError."""
    if os.path.getsize(path) != n * 4 * 2:
        raise ValueError(f"{path} holds {os.path.getsize(path)} bytes, not {n} x 4 float16")
    theirs = np.asarray(np.memmap(path, dtype="<f2", mode="r", shape=(n, 4))[rows, :3], np.float64)
    clamped = np.clip(theirs, 1 / 16, 8.0)
    d, non_positive = _abs_dlog2(M, clamped)
    return {"medianAbsDlog2": float(np.median(d)), "p95AbsDlog2": float(np.percentile(d, 95)),
            "clampedShare": float((clamped != theirs).mean()), "nonPositive": non_positive}


def _for_information(M, path, rows, n):
    """_versus_proof against a file recorded for information only (the original proof's multipliers): None when it is
    absent, and its error recorded rather than raised when it is not N x 4 float16."""
    if not os.path.exists(path):
        return None
    try:
        return _versus_proof(M, path, rows, n)
    except ValueError as e:
        return {"error": str(e)}


def _check_regression(cfg, model, settings, ranges, fin, colour, night) -> dict:
    """Check 2: the reference against the proof's own multipliers for the same (refit) fit, <work>/mult/<name>.f16 as
    Task 4b's promote copied them (their SHA-256 checked against refit.json), over the finest level's interior splats
    (record class 0, not in a chandelier): night and overcast_noon median |dlog2| <= 0.1 and 95th percentile <= 0.3,
    sunny_morning (whose sun bounce is the proof's full radiosity, the reference's the basis) median <= 0.25. The same
    numbers against the original proof's proofWork/mult files are recorded for information, not gated."""
    from . import codec, package as PK
    rec = fin["records"]
    rows = np.nonzero(((rec[:, 11] & codec.CLASS_MASK) == codec.CLASS_INTERIOR) & (np.asarray(fin["chand"]) < 0))[0]
    PK.verified_copies(cfg.paths["work"], cfg.paths["evidence"], tuple(f"mult/{name}.f16" for name in PROOF_SETTINGS))
    out = {"gate": REGRESSION_GATE, "interiorSplats": int(len(rows))}
    for name in PROOF_SETTINGS:
        M = night[rows] if name == "night" else \
            _multipliers(model, settings[name], ranges, rec[rows], fin["pos"][rows], colour[rows])[0]
        row = _versus_proof(M, os.path.join(cfg.paths["work"], "mult", f"{name}.f16"), rows, len(rec))
        if name == "sunny_morning":
            row["pass"] = bool(row["medianAbsDlog2"] <= REGRESSION_GATE["sunnyMedian"])
        else:
            row["pass"] = bool(row["medianAbsDlog2"] <= REGRESSION_GATE["median"] and row["p95AbsDlog2"] <= REGRESSION_GATE["p95"])
        row["originalProof"] = _for_information(M, os.path.join(cfg.paths["proofWork"], "mult", f"{name}.f16"), rows, len(rec))
        out[name] = row
    out["pass"] = all(out[name]["pass"] for name in PROOF_SETTINGS)
    return out


def _check_tiles(cfg, pkg, model, settings, ranges, fin, colour, night, census, proof):
    """Checks 1 and 3 over the served tiles. 1, captured identity: on every tile, reference.multiplier at the captured
    setting is within 0.05 stop on every channel for at least 99.9% of the non-hidden splats. 3, transfer: on every
    coarser tile, the median |dlog2| between a splat's night multiplier and its nearest finest splat's is at most 0.1.
    The coarser tiles' positions and colours are decoded from their .sog files as the records command decoded them, and
    their nearest finest splats found in one k-d tree."""
    identity, transfer = [], []
    finest = list(cfg.room["finestTiles"])
    for t, name in enumerate(finest):
        rows = np.nonzero(fin["tile"] == t)[0]
        M, A = _multipliers(model, settings["captured"], ranges, fin["records"][rows], fin["pos"][rows], colour[rows])
        identity.append({"tile": name, **_identity(M, A)})
    src, tree = np.asarray(fin["pos"], np.float64), None
    for entry in pkg.manifest["tiles"]:
        if entry["tile"] in finest:
            continue
        P, C, _sigma = _sog_splats(census, proof, os.path.join(cfg.paths["splats"], entry["tile"]))
        rec = pkg.records(entry["tile"])
        if len(rec) != len(P):
            raise ValueError(f"the package's {entry['tile']} holds {len(rec)} records for its {len(P)} splats")
        M, A = _multipliers(model, settings["captured"], ranges, rec, P, C)
        identity.append({"tile": entry["tile"], **_identity(M, A)})
        coarse = _multipliers(model, settings["night"], ranges, rec, P, C)[0]
        if tree is None:
            tree = _finest_tree(src)
        d, non_positive = _abs_dlog2(coarse, night[_transferred(tree, src, np.arange(len(src)), P, 1)])
        median = float(np.median(d)) if d.size else None
        transfer.append({"tile": entry["tile"], "level": entry["level"], "splats": int(len(P)), "medianAbsDlog2": median,
                         "nonPositive": non_positive, "pass": bool(median is not None and median <= TRANSFER_GATE["median"])})
    return ({"gate": IDENTITY_GATE, "tiles": identity, "pass": all(r["pass"] for r in identity)},
            {"gate": TRANSFER_GATE, "tiles": transfer, "pass": bool(transfer) and all(r["pass"] for r in transfer)})


def _check_sky(cfg, pkg, model, proof) -> dict:
    """Check 5, the sky bodies' bounce through the package: (a) every sky array read back from the package equals
    sun-bounce.npz's (dtype, shape and bytes); (b) for 48 random real suns and 48 random real moons, the bounce
    luminance at 20,000 finest splats seeded with SPLAT_SEED (isotropic receivers) through the package's path
    (reference.sky_cubes at the 0.5 m probes, then reference.trilinear and cube_eval) against sunbounce.sun_bounce read on
    the 1 m grid at the same points (sunbounce.trilinear_matrix), both at the splats' positions clamped into the probes'
    lookup box as every probe read is (reference.lookup_points; fix round 2): where both are positive, median |dlog2| <=
    0.02 and 99th percentile <= 0.1, and where either is not positive both are not (the resampling adds no light and
    loses none)."""
    from . import package as PK, reference, sunbounce as SB
    path, _sha = PK.verified(cfg.paths["work"], cfg.paths["evidence"], "sun-bounce.npz", "sun-bounce-check.json")
    got = PK.sky_arrays(pkg)
    with np.load(path) as z:
        differ = [k for k in PK.SKY_ARRAYS
                  if z[k].dtype != got[k].dtype or z[k].shape != got[k].shape or z[k].tobytes() != got[k].tobytes()]
    pos = np.load(os.path.join(cfg.paths["work"], "npy", "splats_pos.npy"), mmap_mode="r")
    P = np.asarray(pos[np.sort(np.random.default_rng(SPLAT_SEED).choice(len(pos), SKY_CHECK_SPLATS, replace=False))], np.float64)
    idx, wts = reference.trilinear(model, P)
    sky = model.sky
    to1 = SB.trilinear_matrix(sky.origin, sky.spacing, sky.shape, sky.valid, reference.lookup_points(model, P))
    vols = list(model.volumes.values())
    horizons = [model.horizons[name] for name in model.volumes]
    iso, normals = np.ones(len(P), bool), np.zeros((len(P), 3))

    def luminance(cubes):
        return reference.cube_eval(cubes[:, None], normals, iso)[:, 0] @ reference.LUMW

    out = {"gate": SKY_CHECK_GATE, "splats": len(P), "arrays": {"differ": differ, "pass": not differ}}
    bodies = {"sun": _random_suns(proof.common, SKY_CHECK_DIRECTIONS, SKY_CHECK_SUN_SEED),
              "moon": _random_moons(cfg, SKY_CHECK_DIRECTIONS, SKY_CHECK_MOON_SEED)}
    for body, directions in bodies.items():
        logs, disagree = [], 0
        for s in directions:
            s = np.asarray(s, np.float64)
            a = luminance((reference.sky_cubes(model, [(s, np.ones(3))])[idx] * wts[:, :, None, None]).sum(1))
            full = SB.sun_bounce(sky.table, sky.basis, vols, horizons, model.fresnel, sky.patches, vols[0].x_bearing, s)
            b = luminance((to1 @ full.reshape(full.shape[0], 18)).reshape(-1, 3, 6))
            disagree += int(((a > 0) != (b > 0)).sum())
            both = (a > 0) & (b > 0)
            logs.append(np.abs(np.log2(a[both]) - np.log2(b[both])))
        d = np.concatenate(logs)
        median, p99 = (float(np.median(d)), float(np.percentile(d, 99))) if d.size else (None, None)
        out[body] = {"directions": len(directions), "medianAbsDlog2": median, "p99AbsDlog2": p99, "zeroDisagreements": disagree,
                     "pass": bool(d.size and median <= SKY_CHECK_GATE["median"] and p99 <= SKY_CHECK_GATE["p99"] and disagree == 0)}
    out["pass"] = bool(out["arrays"]["pass"] and out["sun"]["pass"] and out["moon"]["pass"])
    return out


def _wall_face(model, proof, pos, settings) -> dict:
    """The wall-face rate (a measurement, not a sixth check): windows.wall_face_rate on check-sun's 200,000 finest splats
    and its 88,831 floor points, at the sunny morning's Sun and moon_test's Moon through the package's window volumes,
    each population's two directions pooled."""
    from . import windows as W
    floor, pick = _check_sun_points(proof.common, len(pos))
    directions = (settings["sunny_morning"].sun_dir, settings["moon_test"].moon_dir)

    def pooled(points):
        counts = [W.wall_face_rate(model.volumes, model.horizons, model.fresnel, points, s) for s in directions]
        return {"marched": sum(c["marched"] for c in counts), "wallFace": sum(c["wallFace"] for c in counts)}

    return {"splats": len(pick), **pooled(np.asarray(pos[pick], np.float64)), "floor": {"points": len(floor), **pooled(floor)}}


def _check_determinism(cfg, pkg, proof) -> dict:
    """Check 4: the package written a second time, from the inputs its own evidence.build names and with its own tool
    and createdAt, into a temporary folder on D: (in the work folder), and package.compare'd with it. Bytes are compared
    only between runs on one host (R1a's "Execution host"): a package built on another host than this one is refused
    without a rebuild."""
    import tempfile
    from . import package as PK
    m = pkg.manifest
    built, here = m["evidence"]["build"].get("host"), _host()
    if built != here:
        return {"pass": False, "builtOn": built, "checkedOn": here,
                "reason": "the package was built on another host; its bytes are compared only on the host that built it"}
    tmp = tempfile.mkdtemp(prefix="check-determinism-", dir=cfg.paths["work"])
    try:
        out = os.path.join(tmp, "package")
        _build_package(cfg, out, m["tool"], m["createdAt"], m["evidence"]["build"], proof)
        return PK.compare(pkg.folder, out)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _gates_clear(volumes, horizons, s) -> bool:
    """True when the direction's elevation lies more than GATE_MARGIN degrees from every window's horizon at its azimuth
    (windows.sun_az_el from the float32 direction, windows.horizon_at), so no gate hangs on the last bit of an arcsine."""
    from . import windows as W
    s32 = np.asarray(s, np.float32)
    for name, vol in volumes.items():
        az, el = W.sun_az_el(s32, vol.x_bearing)
        if not abs(el - W.horizon_at(horizons[name], az)) > GATE_MARGIN:
            return False
    return True


def _ray_directions(model, settings, common) -> list:
    """The vectors' nine directions (R1d A8): the sunny morning's Sun, check-sun's five suns, two random suns
    (_random_suns(common, n, RAY_SUN_SEED); one too close to a gate is replaced by the next drawn) and moon_test's Moon.
    A fixed direction too close to a gate stops the check."""
    first = [np.asarray(settings["sunny_morning"].sun_dir, np.float64)]
    first += [np.asarray(common.sun_vec_e57(*common.solar_position(*t)), np.float64) for t in CHECK_SUNS]
    moon = np.asarray(settings["moon_test"].moon_dir, np.float64)
    for s in first + [moon]:
        if not _gates_clear(model.volumes, model.horizons, s):
            raise ValueError(f"the vector direction {s.tolist()} lies within {GATE_MARGIN} degrees of a window's horizon")
    for drawn in range(2, 102):
        random = [np.asarray(s, np.float64) for s in _random_suns(common, drawn, RAY_SUN_SEED)
                  if _gates_clear(model.volumes, model.horizons, s)]
        if len(random) >= 2:
            return first + random[:2] + [moon]
    raise ValueError("no two random suns clear every window's horizon by the gate margin")


def _straddles(volumes, P, s) -> np.ndarray:
    """(N,) bool, the vectors' wall-face test for one direction (Step 7): the ray from a room point whose first sample
    the bake puts on the room side of its owner's wall face y0, between grid cells of unlike alpha. The owner is the first
    window, in order, whose ray survives (windows._rays, as windows.ray_survives); the first sample is the march's own
    (_rays' Q, in float32), its cell c = floor((Q - grid_lo) / res); the ray is listed when c.y >= iy0 =
    round((y0 - grid_lo.y) / res) and cells (c.x, iy0 - 1, c.z) and (c.x, iy0, c.z) hold unlike alpha (windows._alpha_at:
    outside the box, 0). The caller keeps the marched rays (samples > 0)."""
    from . import windows as W
    P32, s32 = np.asarray(P, np.float32), np.asarray(s, np.float32)
    out = np.zeros(len(P32), bool)
    owner, starts = np.full(len(P32), -1), {}
    for w, (name, vol) in enumerate(volumes.items()):
        _claimed, survives, Q, _start, _length = W._rays(vol, P32, s32)
        owner[(owner < 0) & survives] = w
        starts[name] = Q
    for w, (name, vol) in enumerate(volumes.items()):
        idx = np.nonzero((owner == w) & (P32[:, 1] > vol.y0))[0]
        if not idx.size:
            continue
        c = np.floor((starts[name][idx] - vol.grid_lo) / np.float32(vol.res)).astype(np.int64)
        iy0 = int(round((vol.y0 - float(vol.grid_lo[1])) / vol.res))
        unlike = W._alpha_at(vol, c[:, 0], iy0 - 1, c[:, 2]) != W._alpha_at(vol, c[:, 0], iy0, c[:, 2])
        out[idx] = (c[:, 1] >= iy0) & unlike
    return out


def _vector_splats(model, settings, fin, ranges, common) -> np.ndarray:
    """The vectors' 64 finest splats (Step 7), indices into the finest level: VECTOR_SPLATS' categories in order, each
    from one permutation of the finest splats seeded with SPLAT_SEED, a splat used once; a category of two classes takes
    half from each where it can. The sun-reachable floor splats are class-0 sun-flagged splats, not isotropic, below
    FLOOR_Z + 0.12 with a normal within 18 degrees of +z, lit at the sunny morning's Sun (visibility > 0.3). Every
    sun-flagged splat must keep its sunny-morning and moon_test visibility within 1e-6 when moved 1 mm along +x, -x,
    +y, -y, +z or -z; one that does not is passed over for the next in the seeded order."""
    from . import codec, package as PK
    from . import windows as W
    rec, pos = fin["records"], fin["pos"]
    flags = rec[:, 11]
    cls, sun = flags & codec.CLASS_MASK, (flags & codec.FLAG_SUN) > 0
    order = np.random.default_rng(SPLAT_SEED).permutation(len(rec))
    taken = np.zeros(len(rec), bool)
    directions = (settings["sunny_morning"].sun_dir, settings["moon_test"].moon_dir)
    moves = STABLE_MOVE * np.concatenate([np.zeros((1, 3)), np.eye(3), -np.eye(3)])

    def visibility(points, s):
        return W.sun_visibility(model.volumes, model.horizons, model.fresnel, points, s)

    def acceptable(idx, extra):
        P = np.asarray(pos[idx], np.float64)
        ok = np.ones(len(idx), bool)
        flagged = sun[idx]
        if flagged.any():
            moved = (P[flagged][None] + moves[:, None]).reshape(-1, 3)
            v = np.stack([visibility(moved, s) for s in directions]).reshape(len(directions), len(moves), -1)
            ok[flagged] = (np.abs(v[:, 1:] - v[:, :1]) <= 1e-6).all(axis=(0, 1))
        return ok & extra(idx, P) if extra is not None else ok

    def pick(mask, count, extra=None):
        got, candidates = [], order[mask[order]]
        for a in range(0, len(candidates), 256):
            batch = candidates[a:a + 256]
            batch = batch[~taken[batch]]
            for i in batch[acceptable(batch, extra)] if batch.size else ():
                got.append(int(i))
                taken[i] = True
                if len(got) == count:
                    return got
        return got

    def floor_lit(idx, P):
        _direct, normals, _flags = PK.decode(rec[idx], ranges)
        return (normals[:, 2] > 0.95) & (P[:, 2] < common.FLOOR_Z + 0.12) & (visibility(P, directions[0]) > 0.3)

    z = np.asarray(pos[:, 2])
    chosen = []
    for name, classes, count in VECTOR_SPLATS:
        if name == "sun-reachable floor":
            got = pick((cls == codec.CLASS_INTERIOR) & sun & ((flags & codec.FLAG_ISO) == 0) & (z < common.FLOOR_Z + 0.12),
                       count, floor_lit)
        else:
            got = []
            for i, c in enumerate(classes):
                got += pick(cls == c, count // len(classes) + (count % len(classes) if i == 0 else 0))
            if len(got) < count:
                got += pick(np.isin(cls, classes), count - len(got))
        if len(got) < count:
            raise ValueError(f"only {len(got)} of the {count} {name} vector splats qualify")
        chosen += got
    return np.array(chosen, np.int64)


def _ray_floor_points(model, directions, floor):
    """The window rays' floor points (Step 7): check-sun's floor grid in an order seeded with SPLAT_SEED, the first 12
    lit at the sunny morning (visibility > 0.3), then 12 marched but dark there (samples > 0, visibility < 0.01), then
    up to 8 that are a wall-face case at some of the nine directions (_straddles of a marched ray). Returns (points,
    how many wall-face points the grid gave)."""
    from . import windows as W
    order = np.random.default_rng(SPLAT_SEED).permutation(len(floor))
    case = np.zeros(len(floor), bool)
    for k, s in enumerate(directions):
        steps = np.zeros(len(floor), np.int32)
        v = W.sun_visibility(model.volumes, model.horizons, model.fresnel, floor, s, steps=steps)
        if k == 0:
            lit, dark = v > 0.3, (steps > 0) & (v < 0.01)
        case |= (steps > 0) & _straddles(model.volumes, floor, s)
    taken, picked = np.zeros(len(floor), bool), []
    for mask, count, name in ((lit, VECTOR_FLOOR_POINTS[0], "lit"), (dark, VECTOR_FLOOR_POINTS[1], "dark"),
                              (case, VECTOR_FLOOR_POINTS[2], None)):
        got = [int(i) for i in order[mask[order] & ~taken[order]][:count]]
        if name is not None and len(got) < count:
            raise ValueError(f"only {len(got)} {name} floor points for the window rays")
        taken[got] = True
        picked += got
    return floor[np.array(picked, np.int64)], len(picked) - VECTOR_FLOOR_POINTS[0] - VECTOR_FLOOR_POINTS[1]


def _fold(model, entries, coefficients, rgb, b64) -> dict:
    """The vectors' fold: the first probe of `entries` (the vector splats' 0.5 m corners) whose eight 1 m corners all
    weigh at least FOLD_MIN_WEIGHT (a probe inside its 1 m cell, not one on a node by rounding): its trilinear_matrix row
    in the matrix's dx, dy, dz order (index (ix ny + iy) nz + iz over the 1 m shape), the basis at those corners (float16
    [k][channel][face]), the RGB, and reference.to_probes at that probe of the first case's bounce
    (sunbounce.bounce(basis, coefficients) x rgb). No fallback: none such stops the check."""
    from . import reference, sunbounce
    sky = model.sky
    points = reference.probe_points(model)
    shape = np.asarray(sky.shape, np.int64)
    matrix = sunbounce.trilinear_matrix(sky.origin, sky.spacing, sky.shape, sky.valid, points[entries])
    for e, probe in enumerate(entries):
        i0 = np.clip(np.floor((points[probe] - np.asarray(sky.origin, np.float64)) / sky.spacing).astype(np.int64), 0, shape - 2)
        order = [int(((i0[0] + dx) * shape[1] + (i0[1] + dy)) * shape[2] + (i0[2] + dz))
                 for dx in (0, 1) for dy in (0, 1) for dz in (0, 1)]
        row = matrix.getrow(e)
        weights = dict(zip(row.indices.tolist(), row.data.tolist()))
        corners = [[index, float(weights.get(index, 0.0))] for index in order]
        if len(set(order)) == 8 and all(w >= FOLD_MIN_WEIGHT for _index, w in corners):
            S1 = sunbounce.bounce(sky.basis, coefficients) * np.asarray(rgb, np.float64)[None, :, None]
            return {"probe": int(probe), "corners": corners,
                    "basis": [{"index": index, "values": b64(np.ascontiguousarray(sky.basis[:, index], "<f2").tobytes())}
                              for index, _w in corners],
                    "rgb": _floats(rgb), "cube": _floats(reference.to_probes(model, S1)[probe])}
    raise ValueError(f"no probe among the vector splats' corners has eight 1 m corners each of weight >= {FOLD_MIN_WEIGHT} "
                     f"(FOLD_MIN_WEIGHT: a probe inside its 1 m cell, not on a node)")


def _floor_texels(cfg) -> list:
    """The vectors' eight floor texels of <work>/floor-light.npz (R1b decodes the floor PNGs there): the brightest texel
    of each source that lights the floor (one near each window, one under each lamp), in source order, each texel once,
    topped up from a draw seeded with SPLAT_SEED; refused unless every source that lights some floor texel is non-zero at
    one of them and no two sources have equal values at all eight. (The cove lights no floor texel: its light goes up into
    the ceiling's cove, so it is zero at all eight, as everywhere on the floor.)"""
    from . import package as PK
    path, _sha = PK.verified(cfg.paths["work"], cfg.paths["evidence"], "floor-light.npz", "floor-light.json")
    with np.load(path) as z:
        D = z["D"]
    h, w, n = D.shape
    picks = []
    for k in range(n):
        if D[..., k].max() > 0:
            rc = tuple(int(v) for v in np.unravel_index(int(np.argmax(D[..., k])), (h, w)))
            if rc not in picks:
                picks.append(rc)
    for i in np.random.default_rng(SPLAT_SEED).permutation(h * w):
        if len(picks) >= 8:
            break
        rc = (int(i) // w, int(i) % w)
        if rc not in picks and D[rc].max() > 0:
            picks.append(rc)
    picks = picks[:8]
    values = np.array([D[r, c] for r, c in picks], np.float64)
    lights = D.reshape(-1, n).max(0) > 0
    dark = [SOURCES[k] for k in range(n) if lights[k] and not (values[:, k] > 0).any()]
    same = [(SOURCES[a], SOURCES[b]) for a in range(n) for b in range(a + 1, n) if np.array_equal(values[:, a], values[:, b])]
    if dark or same or len(picks) < 8:
        raise ValueError(f"the floor texels do not tell the sources apart: dark {dark}, equal {same}, {len(picks)} texels")
    return [{"col": c, "row": r, "direct": _floats(D[r, c])} for r, c in picks]


def _setting_json(s) -> dict:
    from . import reference
    return {"weights": [_floats(row) for row in s.weights], "skyLevel": float(s.sky_level), "skyColour": _floats(s.sky_colour),
            "lampLevels": {g: float(s.lamp_levels[g]) for g in reference.LAMP_GROUPS}, "emitterBoost": float(s.emitter_boost),
            "sunDir": None if s.sun_dir is None else _floats(s.sun_dir), "sunRgb": _floats(s.sun_rgb),
            "moonDir": None if s.moon_dir is None else _floats(s.moon_dir), "moonRgb": _floats(s.moon_rgb)}


def _vectors(cfg, pkg, model, settings, common, fin, colour, wall_face_rate) -> tuple[bytes, dict]:
    """The test vectors (Step 7) in the shape of R1b's RelightVectorsSchema (venviewer.relight-vectors.v1): the
    manifest's slice, the four settings, the probe table on the package's global grid, the windows, the sample depths,
    the sky bodies' bounce slice, the window rays, the 64 splats with their expected multipliers and words, and eight
    floor texels; refused over 1,000 kB + 1.6 kB x max(0, K - 30). Returns (the JSON bytes, what to print)."""
    import base64
    from . import codec, package as PK, reference, sunbounce
    from . import windows as W

    def b64(data):
        return base64.b64encode(data).decode("ascii")

    m, ranges, sky = pkg.manifest, pkg.ranges(), model.sky
    names = ("captured", "night", "sunny_morning", "moon_test")
    directions = _ray_directions(model, settings, common)
    rows = _vector_splats(model, settings, fin, ranges, common)
    rec = fin["records"][rows]
    direct, normals, flags = PK.decode(rec, ranges)
    P, C = np.asarray(fin["pos"][rows], np.float64), np.asarray(colour[rows], np.float64)
    expected = {}
    for name in names:
        M, A = reference.multiplier(direct, normals, flags, P, C, model, settings[name])
        expected[name] = (M, A, codec.pack_multiplier(M, A))
    splats = [{"record": rec[i].tobytes().hex(), "position": _floats(P[i]), "colour": _floats(C[i]),
               "expected": {name: {"m": _floats(expected[name][0][i]), "alpha": float(expected[name][1][i]),
                                   "word": int(expected[name][2][i])} for name in names}} for i in range(len(rows))]
    entries = sorted({int(i) for i in reference.trilinear(model, P)[0].ravel()})
    rows_t, columns_t = sky.table.coeffs.shape[:2]
    cases, nodes = [], set()
    for s in directions:
        s32 = np.asarray(s, np.float32)
        az, el = W.sun_az_el(s32, next(iter(model.volumes.values())).x_bearing)
        corners = W.sun_corners(sky.table.az0, sky.table.el0, sky.table.step, (rows_t, columns_t), az, el)
        nodes |= {(int(j), int(i)) for j, i, _w in corners}
        cases.append({"dir": _floats(s32), "powers": _floats(reference.window_powers(model, s32)), "azimuth": az, "elevation": el,
                      "corners": [[int(j), int(i), float(w)] for j, i, w in corners],
                      "coefficients": _floats(reference.body_coefficients(model, s32))})
    fold = _fold(model, entries, np.asarray(cases[0]["coefficients"], np.float64), settings["sunny_morning"].sun_rgb, b64)
    probe_cubes = {}
    for name in ("sunny_morning", "moon_test"):
        S = reference.sky_cubes(model, reference.sky_bodies(settings[name]))
        probe_cubes[name] = [{"index": i, "cube": b64(np.ascontiguousarray(S[i], "<f4").tobytes())} for i in entries]
    depths = [W.sample_depths(vol) for vol in model.volumes.values()]
    if not all(np.array_equal(depths[0], d) for d in depths):
        raise ValueError("the windows' sample depths differ: they must share one cell size")
    floor_grid, _pick = _check_sun_points(common, len(fin["records"]))
    floor_points, wall_points = _ray_floor_points(model, directions, floor_grid)
    points = np.concatenate([P, floor_points])
    visibility, steps, pairs = np.zeros((len(points), len(directions))), np.zeros((len(points), len(directions)), np.int64), []
    for k, s in enumerate(directions):
        st = np.zeros(len(points), np.int32)
        visibility[:, k] = W.sun_visibility(model.volumes, model.horizons, model.fresnel, points, s, steps=st)
        steps[:, k] = st
        pairs += [[int(p), k] for p in np.nonzero((st > 0) & _straddles(model.volumes, points, s))[0]]
    if not pairs:
        raise ValueError("no vector point and direction is a wall-face case (R1b's window-ray test needs at least one)")
    vectors = {
        "schema": VECTORS_SCHEMA, "sources": list(SOURCES), "encoding": {"sources": m["encoding"]["sources"]},
        "capture": {key: m["capture"][key] for key in ("weights", "colours", "daylightColour")},
        "site": {key: m["site"][key] for key in ("north", "east", "up")}, "sun": {"fresnel": m["sun"]["fresnel"]},
        "windows": [{"id": w["id"], "frame": w["frame"], "alphaGz": b64(pkg.data(w["volume"])), "horizon": w["horizon"]}
                    for w in m["windows"]],
        "sampleDepths": _floats(depths[0]),
        "skyBounce": {"k": m["sky"]["k"], "azimuth0": m["sky"]["table"]["azimuth0"], "elevation0": m["sky"]["table"]["elevation0"],
                      "step": m["sky"]["table"]["step"], "size": m["sky"]["table"]["size"], "grid": m["sky"]["grid"],
                      "floorMean": m["sky"]["floorMean"], "cases": cases,
                      "nodes": [{"index": j * columns_t + i, "values": b64(np.ascontiguousarray(sky.table.coeffs[j, i], "<f4").tobytes())}
                                for j, i in sorted(nodes, key=lambda ji: ji[0] * columns_t + ji[1])],
                      "fold": fold, "probeCubes": probe_cubes},
        "windowRays": {"suns": [_floats(s) for s in directions], "points": [_floats(p) for p in points],
                       "visibility": [[float(v) for v in row] for row in visibility],
                       "steps": [[int(v) for v in row] for row in steps], "wallFace": sorted(pairs),
                       "wallFaceRate": wall_face_rate},
        "probes": {"origin": m["probes"]["origin"], "spacing": m["probes"]["spacing"], "shape": m["probes"]["shape"],
                   "box": m["probes"]["box"],
                   "entries": [{"index": i, "valid": bool(model.probe_valid[i]),
                                "cube": b64(np.ascontiguousarray(model.probes[i], "<f2").tobytes())} for i in entries]},
        "presetsFromProof": m["presetsFromProof"],
        "settings": {name: _setting_json(settings[name]) for name in names},
        "splats": splats,
        "floorTexels": _floor_texels(cfg)}
    data = json.dumps(vectors, allow_nan=False).encode("utf-8")
    k = int(m["sky"]["k"])
    cap = VECTORS_CAP[0] + VECTORS_CAP[1] * max(0, k - VECTORS_CAP[2])
    info = {"bytes": len(data), "cap": cap, "k": k, "wallFacePairs": len(pairs), "wallFaceFloorPoints": wall_points,
            "foldCorners": sum(1 for _i, w in fold["corners"] if w > 0), "probes": len(entries)}
    if len(data) > cap:
        raise ValueError(f"the vectors take {len(data)} bytes, over K {k}'s cap of {cap}: {json.dumps(info)}")
    return data, info


def _checks_path(cfg, package_arg) -> str:
    """<evidence>/checks.json for the default package (v1); checks-<package folder name>.json with --package."""
    if package_arg is None:
        return os.path.join(cfg.paths["evidence"], "checks.json")
    return os.path.join(cfg.paths["evidence"], f"checks-{os.path.basename(os.path.normpath(package_arg))}.json")


def _vectors_path(cfg, args):
    """Where check writes the test vectors: the --vectors path, else the R1b fixture for the default package, else none
    (a --package run without --vectors never touches v1's fixture)."""
    if args.vectors:
        return args.vectors
    if args.package is None:
        return os.path.join(cfg.paths["repo"], *VECTORS_FIXTURE)
    return None


def _write_checks(cfg, package_arg, results, checked_with) -> str:
    """The checks file through _write_evidence (which records the host): the six results and the commit checked with."""
    path = _checks_path(cfg, package_arg)
    _write_evidence(path, {**results, "checkedWith": checked_with})
    return path


def _write_bytes(path, data: bytes) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    part = path + ".part"
    try:
        with open(part, "wb") as f:
            f.write(data)
        os.replace(part, path)
    except BaseException:
        if os.path.exists(part):
            os.remove(part)
        raise


def cmd_check(cfg, args, proof=None) -> int:
    """The package's checks (Task 5 Step 7) on the package read back from disk (--package, default the config's out),
    run only from committed code (_committed_tool; the commit is recorded as checkedWith): 1 captured identity, 2 proof
    regression, 3 transfer, 4 determinism and 5 the sky bodies' bounce through the package, and the wall-face rate. A
    population that marches no ray stops the check before check 4's rebuild, with the numbers printed and nothing
    written. Otherwise the results go to <evidence>/checks.json for the default package and to
    checks-<package folder>.json with --package (through _write_evidence, which records the host), and into the package
    manifest's evidence (those six keys and nothing else). Then, when every check passed, the test vectors: R1b's
    fixture for the default package, the --vectors path when given, none for --package without --vectors."""
    committed = _committed_tool(cfg)
    if committed is None:
        return 1
    from . import package as PK
    proof = proof or _load_proof()
    started = time.time()
    PK.verified_fit(cfg.paths["work"], cfg.paths["evidence"])   # the fit_state.npz 05_relight loaded is the promoted refit's
    folder = os.path.abspath(args.package or cfg.paths["out"])
    pkg = PK.read(folder)
    model, ranges = PK.model_of(pkg), pkg.ranges()
    settings = _check_settings(model, proof)
    fin = _finest_check_tables(cfg, pkg)
    colour = proof.store.LUT[np.asarray(fin["rgb"])]

    def say(name, result):
        print(f"{name}: {'PASS' if result.get('pass', True) else 'FAIL'} {json.dumps(_finite(result))[:2000]} "
              f"({time.time() - started:.0f} s)", flush=True)

    print(f"check {folder}: tool {pkg.manifest['tool']}, checked with {committed[0]}", flush=True)
    results = {"skyBounceCheck": _check_sky(cfg, pkg, model, proof)}
    say("check 5, the sky bodies' bounce", results["skyBounceCheck"])
    night = _multipliers(model, settings["night"], ranges, fin["records"], fin["pos"], colour)[0]
    results["proofRegression"] = _check_regression(cfg, model, settings, ranges, fin, colour, night)
    say("check 2, proof regression", results["proofRegression"])
    results["capturedIdentity"], results["transfer"] = _check_tiles(cfg, pkg, model, settings, ranges, fin, colour, night,
                                                                    _census(cfg), proof)
    say("check 1, captured identity", results["capturedIdentity"])
    say("check 3, transfer", results["transfer"])
    results["wallFaceRate"] = _wall_face(model, proof, fin["pos"], settings)
    rate = results["wallFaceRate"]
    for population, r in (("splats", rate), ("floor", rate["floor"])):
        print(f"wall-face rate, {population}: {r['wallFace']} of {r['marched']} marched"
              f" ({r['wallFace'] / r['marched']:.4%})" if r["marched"] else f"wall-face rate, {population}: none marched", flush=True)
    if not (rate["marched"] > 0 and rate["floor"]["marched"] > 0):
        print("FAIL: a population marched no sky-body ray, so nothing bounds the GPU's rounding excuses: stopped before "
              "check 4's rebuild; no checks file, no manifest evidence, no vectors written", flush=True)
        return 1
    results["determinism"] = _check_determinism(cfg, pkg, proof)
    say("check 4, determinism", results["determinism"])
    results = _finite(results)
    passed = all(results[k]["pass"] for k in ("capturedIdentity", "proofRegression", "transfer", "determinism", "skyBounceCheck"))
    print(f"checks written to {_write_checks(cfg, args.package, results, committed[0])}", flush=True)
    PK.write_check_evidence(folder, results)
    path = _vectors_path(cfg, args)
    if path is None:
        print("vectors: not written (--package without --vectors)", flush=True)
    elif not passed:
        print("vectors: not written (a check failed)", flush=True)
    else:
        try:
            data, info = _vectors(cfg, pkg, model, settings, proof.common, fin, colour, results["wallFaceRate"])
        except ValueError as e:
            print(f"FAIL: vectors: {e}", flush=True)
            return 1
        _write_bytes(path, data)
        print(f"vectors: {path}, {info['bytes']} bytes of K {info['k']}'s cap {info['cap']}; {info['wallFacePairs']} wall-face "
              f"pairs ({info['wallFaceFloorPoints']} wall-face floor points); the fold probe's corners {info['foldCorners']}; "
              f"{info['probes']} probes", flush=True)
    print(f"check: {'PASS' if passed else 'FAIL'}, {time.time() - started:.0f} s", flush=True)
    return 0 if passed else 1


COMMANDS["check"] = cmd_check


def _committed_tool(cfg):
    """(HEAD commit, its committer time) of the repository that holds tools/relight, or None (with the reason printed)
    while tools/relight, or the repo's SOG decoder that records and check run (CENSUS), has any uncommitted change: a
    package is built and checked only from committed code, so its `tool` names exactly the code that made it (ruling P1,
    8 October; the decoder added in Task 5's fix round 1)."""
    import subprocess
    git = lambda *a: subprocess.run(["git", "-C", cfg.paths["repo"], *a], check=True, capture_output=True, text=True).stdout.strip()
    dirty = git("status", "--porcelain", "--", "tools/relight", "/".join(CENSUS))
    if dirty:
        print(f"FAIL: tools/relight or {'/'.join(CENSUS)} has uncommitted changes; commit them before building or checking a "
              f"package:\n{dirty}", flush=True)
        return None
    return git("rev-parse", "HEAD"), git("log", "-1", "--format=%cI")


if __name__ == "__main__":
    sys.exit(main())
