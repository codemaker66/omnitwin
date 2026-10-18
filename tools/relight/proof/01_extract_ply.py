"""The photo-trained hall (one master 3DGS PLY, T-639 re-aim) as the same per-splat table 01_extract.py wrote for the
vendor tiles, plus the evening state's base colour: work/splats.npz with pos, nrm, scl, opa, rgb, tile, counts and
rgb_eve (relight.plyread). The model's and the evening file's SHA-256 must equal the config's (paths.modelSha256,
paths.modelEveningSha256), so the tables are always of the file the pano lane named."""
import hashlib
import time
import numpy as np
from common import CFG, WORK, T_JE, ensure_dirs
from relight import plyread


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 24), b""):
            h.update(block)
    return h.hexdigest()


def main():
    ensure_dirs()
    for key in ("model", "modelEvening"):
        got = sha256(CFG.paths[key])
        if got != CFG.paths[key + "Sha256"]:
            raise SystemExit(f"{CFG.paths[key]}: sha256 {got}, not the configured {CFG.paths[key + 'Sha256']}")
    t0 = time.time()
    t = plyread.tables(CFG.paths["model"], T_JE, evening_dc=CFG.paths["modelEvening"])
    n = len(t["pos"])
    np.savez(f"{WORK}/splats.npz", pos=t["pos"], nrm=t["nrm"], scl=t["scl"], opa=t["opa"], rgb=t["rgb"],
             tile=t["tile"], counts=np.array([n]), rgb_eve=t["rgb_eve"])
    print(f"{CFG.paths['model']}: {n} splats, day and evening colours, in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
