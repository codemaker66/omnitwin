"""Back-face (window side) light on the embrasure splats, for a two-sided model of curtains, glazing bars
and reveals:  C = rho * E_room + tau * E_back  (rho: room-side reflectance, tau: light passed or
scattered from the window side). 03c gave the room-side irradiance; this adds the window-side face.
Writes work/npy/emb_idx.npy (sorted embrasure splat indices), emb_E_back_win.npy (n, 20) float16
(window light on a -y facing surface, per window x band) and emb_E_back_cap.npy (n, 3) float32 (the
capture's back-face irradiance with the fitted window weights and daylight colour)."""
import time
import numpy as np
import torch
from common import *
import lt
from store import Store, NPY

torch.set_num_threads(8)
SKY_W = np.array([0.15, 0.66, 1.0, 1.21], np.float32)


def main():
    t0 = time.time()
    st = Store()
    emb = np.concatenate([np.where(np.asarray(st.cls[sl]) == 1)[0] + sl.start for sl in st.chunks(1_000_000)])
    pe = np.asarray(st.pos[emb], np.float64)
    del st
    nb = torch.tensor([[0.0, -1.0, 0.0]], dtype=torch.float32).expand(len(emb), 3).contiguous()
    isob = torch.zeros(len(emb), dtype=torch.bool)
    occ = lt.load_occ()
    Eb = np.zeros((len(emb), lt.N_WBASES), np.float32)
    for wi, w in enumerate(lt.WIN_NAMES):
        x0, x1 = WINDOWS[w][0], WINDOWS[w][1]
        sel = np.where((pe[:, 0] > x0 - 0.3) & (pe[:, 0] < x1 + 0.3))[0]
        for a in range(0, len(sel), 60000):
            jj = sel[a:a + 60000]
            c = lt.window_cubes(occ, pe[jj], nx=6, nz=9, windows=[wi])
            Eb[jj] = lt.cube_eval(c, nb[jj], isob[jj]).numpy()
        print(f"  back-face window light {w}: {len(sel)} {time.time() - t0:.0f}s", flush=True)
    fs = np.load(f"{WORK}/fit_state.npz"); W = fs["weights"]; col_day = fs["cols"][0]
    cap = np.zeros((len(emb), 3), np.float32)
    for wi in range(5):
        cap += (Eb[:, wi * 4:(wi + 1) * 4] @ SKY_W)[:, None] * (W[wi] * col_day)[None]
    np.save(f"{NPY}/emb_idx.npy", emb)
    np.save(f"{NPY}/emb_E_back_win.npy", Eb.astype(np.float16))
    np.save(f"{NPY}/emb_E_back_cap.npy", cap)
    print("embrasure back-face light:", len(emb), "splats, capture back-irradiance median", np.median(cap, 0).round(3), f"{time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
