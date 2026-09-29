"""Compare renders with Matterport photographs taken from the same stations, and pick presentation exposures.
  python 07_compare.py metrics    -> work/cmp/metrics.json + comparison sheets
  python 07_compare.py exposure   -> work/exposure.json (from the linear pass A renders)
Photos: the station's 8K panorama resampled to the render's exact camera (pano_view.py). Both images are
display-referred with different, unknown tone curves, so the comparison is on a 48 x 27 grid of cells in
log2 luminance, excluding the view out of the windows and the light fixtures (A_mask render), clipped and
empty pixels. Reported: Pearson r (independent of exposure and tone curve), the residual after the best
exposure + contrast map and after exposure only (median absolute, in stops), and colour error after a
per-channel gain (median |log2 R/G| and |log2 B/G| differences)."""
import json
import os
import sys
import numpy as np
from PIL import Image
from common import *
from shots import one_x, grid
import pano_view

VIEWS = {v["name"]: v for v in json.load(open(f"{WORK}/views.json"))}
RND = f"{ROOT}/renders"; OUT = f"{WORK}/cmp"
LUMW = np.array([0.2126, 0.7152, 0.0722])
os.makedirs(OUT, exist_ok=True)


def load(path):
    a = np.asarray(Image.open(path).convert("RGB"), np.float64) / 255.0
    return srgb_to_linear(a), a


def render(job, view):
    p1 = f"{RND}/{job}/{view}.png"
    if not os.path.exists(p1):
        one_x(f"{RND}/{job}/{view}@2x.png", p1)
    return load(p1)


def photo(view):
    v = VIEWS[view]; path = f"{OUT}/photo_{view}.png"
    if not os.path.exists(path):
        im, _ = pano_view.view(v["station"], v["tgt"], v["fov"], 1920, 1080)
        im.save(path)
    return load(path)


def valid_mask(view, *srgbs):
    mlin, _ = render("A_mask", view)
    ok = (mlin[..., 0] < 0.05) & (mlin[..., 1] < 0.05)
    for s in srgbs:
        ok &= (s.max(-1) < 0.98) & (s.max(-1) > 0.03)
    return ok


def cells(lin, valid, gx=48, gy=27):
    H, W = lin.shape[:2]; ch = H // gy; cw = W // gx
    a = lin[:gy * ch, :gx * cw].reshape(gy, ch, gx, cw, 3); m = valid[:gy * ch, :gx * cw].reshape(gy, ch, gx, cw)
    s = (a * m[..., None]).sum((1, 3)); n = m.sum((1, 3))
    return s / np.maximum(n, 1)[..., None], n / (ch * cw)


def metrics(model, ph, ok):
    lm = np.log2(np.maximum(model @ LUMW, 1e-5))[ok]; lp = np.log2(np.maximum(ph @ LUMW, 1e-5))[ok]
    r = float(np.corrcoef(lm, lp)[0, 1])
    b, a = np.polyfit(lm, lp, 1)
    res = lp - (a + b * lm); res1 = lp - lm - np.median(lp - lm)
    d = np.log2(np.maximum(ph[ok], 1e-5)) - np.log2(np.maximum(model[ok], 1e-5))
    d -= np.median(d, 0)
    return dict(cells=int(ok.sum()), r=round(r, 3), slope=round(float(b), 3), mae_affine_stops=round(float(np.median(np.abs(res))), 3),
                mae_gain_only_stops=round(float(np.median(np.abs(res1))), 3),
                chroma_mae_rg_bg=[round(float(np.median(np.abs(d[:, 0] - d[:, 1]))), 3), round(float(np.median(np.abs(d[:, 2] - d[:, 1]))), 3)])


def gain_match(model_lin, ph_lin, ok_px):
    """Per-channel gain that matches the model to the photo's median over valid pixels (for display sheets)."""
    g = np.median(ph_lin[ok_px], 0) / np.maximum(np.median(model_lin[ok_px], 0), 1e-6)
    return Image.fromarray((np.clip(linear_to_srgb(model_lin * g), 0, 1) * 255 + 0.5).astype(np.uint8))


def do_metrics():
    out = {}
    tests = {"mp43_night_end": ("night", ["A_capture", "A_comp_house"]),
             "mp45_night_windows": ("night", ["A_capture", "A_comp_house"]),
             "mp15_day_end": ("day", ["A_capture", "A_day_a050", "A_day_a200"]),
             "mp8_day_windows": ("day", ["A_capture", "A_day_a050", "A_day_a200"])}
    rows = []
    for view, (kind, jobs) in tests.items():
        ph_lin, ph_s = photo(view)
        mods = {j: render(j, view) for j in jobs if os.path.exists(f"{RND}/{j}/{view}@2x.png")}
        ok_px = valid_mask(view, ph_s, *[m[1] for m in mods.values()])
        pc, pf = cells(ph_lin, ok_px)
        rec = {"photo": f"{OUT}/photo_{view}.png", "valid_pixel_fraction": round(float(ok_px.mean()), 3)}
        items = [(Image.open(f"{OUT}/photo_{view}.png"), f"{view}: Matterport photo ({kind})")]
        for j, (ml, ms) in mods.items():
            mc, mf = cells(ml, ok_px)
            ok = (pf > 0.7) & (mf > 0.7)
            rec[j] = metrics(mc, pc, ok)
            items.append((gain_match(ml, ph_lin, ok_px), f"{j[2:]} (r={rec[j]['r']}, {rec[j]['mae_affine_stops']} stops)"))
        out[view] = rec
        rows.append(items)
        print(view, json.dumps(rec), flush=True)
    json.dump(out, open(f"{OUT}/metrics.json", "w"), indent=1)
    for items in rows:
        name = items[0][1].split(":")[0]
        grid(items, len(items), width=720, out=f"{OUT}/sheet_{name}.jpg", size=20)


def do_exposure():
    """Exposure per scenario so the median luminance of the three showcase views sits at a target relative
    to the capture's (1.0 by day, 0.62 at night: a night room should read darker than a day room)."""
    views = ["hero", "windows", "diagonal"]

    def med(job):
        vals = []
        for v in views:
            lin, s = render(job, v)
            mlin, _ = render("A_mask", v)
            ok = (mlin[..., 0] < 0.05) & (mlin[..., 1] < 0.05) & (s.max(-1) > 0.02)
            vals.append(np.median((lin @ LUMW)[ok]))
        return float(np.exp(np.mean(np.log(vals))))

    def grey_world(job):
        acc = []
        for v in views:
            lin, s = render(job, v)
            mlin, _ = render("A_mask", v)
            ok = (mlin[..., 0] < 0.05) & (mlin[..., 1] < 0.05) & (s.max(-1) > 0.02) & (s.max(-1) < 0.98)
            acc.append(np.exp(np.mean(np.log(np.maximum(lin[ok], 1e-4)), 0)))
        g = np.exp(np.mean(np.log(acc), 0))
        return g / g[1]
    cap_gw = grey_world("A_capture")
    base = med("A_capture")
    target = {"night": 0.62, "sunny_morning": 0.95, "overcast_noon": 0.75}
    pres = {"night": dict(tone="neutral", bloom=0.30, threshold=1.6),
            "sunny_morning": dict(tone="neutral", bloom=0.08, threshold=6.0),
            "overcast_noon": dict(tone="neutral", bloom=0.0, threshold=1.0)}
    ex = {}
    for sc, k in target.items():
        m = med(f"A_{sc}")
        e = round(float(np.clip(k * base / max(m, 1e-6), 0.25, 16.0)), 3)
        # partial camera white balance: 60% of the way from the scenario's grey-world colour back to the capture's
        wb = (cap_gw / grey_world(f"A_{sc}")) ** 0.6
        wb = (wb / wb[1]).round(4).tolist()
        ex[sc] = dict(pres[sc], exposure=e, wb=wb)
        print(sc, "median lum", round(m, 4), "capture", round(base, 4), "-> exposure", e, f"({np.log2(e):+.2f} EV)", "wb", wb)
    ex["delit"] = dict(tone="none", exposure=1.0, bloom=0.0, threshold=1.0)
    json.dump(ex, open(f"{WORK}/exposure.json", "w"), indent=1)


if __name__ == "__main__":
    {"metrics": do_metrics, "exposure": do_exposure}[sys.argv[1]]()
