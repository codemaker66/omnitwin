"""Decode the served Grand Hall SOG tiles (product order: env + 11 finest tiles) into one merged
per-splat table for the light model. Read-only on the tiles; uses the repo's Python SOG decoder
(tools/xgrids-lcc2/scripts/sog-floor-census.py, imported read-only), which matches the product's
TypeScript decoder element for element (same pixel order, same quaternion convention).

Output work/splats.npz
  pos    (N,3) f32  centre, E57 frame
  nrm    (N,3) f16  unit axis of the smallest scale, E57 frame (sign arbitrary here)
  scl    (N,3) f16  sorted scales (min, mid, max) in metres
  opa    (N,)  f16  opacity 0..1
  rgb    (N,3) u8   stored DC colour exactly as the product packs it ((0.5 + C0*dc)*255, clamped)
  tile   (N,)  u8   index into common.TILES
  counts (12,) i64
"""
import importlib.util, io, time, zipfile
import numpy as np
from PIL import Image
from common import TILES, SPLATS, WORK, REPO, T_JE, ensure_dirs

SH_C0 = 0.28209479177387814
spec = importlib.util.spec_from_file_location("census", f"{REPO}/tools/xgrids-lcc2/scripts/sog-floor-census.py")
census = importlib.util.module_from_spec(spec)
spec.loader.exec_module(census)


def main():
    ensure_dirs()
    R_je = T_JE[:3, :3]
    P, Nn, S, O, C, TI, counts = [], [], [], [], [], [], []
    for ti, name in enumerate(TILES):
        t0 = time.time()
        path = f"{SPLATS}/{name}"
        centers, scales, quats, opacity, meta = census.decode_tile(path)
        n = int(meta["count"])
        z = zipfile.ZipFile(path)
        sh0 = np.asarray(Image.open(io.BytesIO(z.read(meta["sh0"]["files"][0]))).convert("RGBA"), dtype=np.uint8).reshape(-1, 4)[:n]
        cb = np.array(meta["sh0"]["codebook"], dtype=np.float64)
        stored = np.clip(np.round((0.5 + SH_C0 * cb[sh0[:, :3]]) * 255.0), 0, 255).astype(np.uint8)
        R = census.quat_to_rot(quats)                      # columns are the local axes
        k = np.argmin(scales, axis=1)
        nrm_j = R[np.arange(n), :, k]                      # column k
        pos_e = (centers - T_JE[:3, 3]) @ R_je             # json -> e57
        nrm_e = nrm_j @ R_je
        P.append(pos_e.astype(np.float32)); Nn.append(nrm_e.astype(np.float16))
        S.append(np.sort(scales, axis=1).astype(np.float16)); O.append(opacity.astype(np.float16))
        C.append(stored); TI.append(np.full(n, ti, np.uint8)); counts.append(n)
        print(f"{name}: {n} splats in {time.time() - t0:.1f}s", flush=True)
    np.savez(f"{WORK}/splats.npz", pos=np.concatenate(P), nrm=np.concatenate(Nn), scl=np.concatenate(S),
             opa=np.concatenate(O), rgb=np.concatenate(C), tile=np.concatenate(TI), counts=np.array(counts))
    print("total", sum(counts))


if __name__ == "__main__":
    main()
