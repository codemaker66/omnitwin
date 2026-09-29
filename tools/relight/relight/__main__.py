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


if __name__ == "__main__":
    sys.exit(main())
