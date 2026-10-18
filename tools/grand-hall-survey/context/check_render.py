"""Independent checks and validation renders for the city context model (diagnostic, not part of the build).

Reads the model as published (<name>.bin and <name>.json), the build's report
(<name>.build.json, for the suppressed trees) and its rasters (_work.npz, written
by build_context.py --keep-work), and the DSM grid. Checks the mesh (cap and wall
normals, zero-area triangles, edges shared by exactly two triangles, open edges
only on the rim and the site cut, walls facing out of their solids), measures the
Glassford Street section in front of the window wall and lists what the clamp
removed. Writes checks.json, top-down and oblique renders (Lambert with a shadow
map) and a hillshade sheet of the suppressed trees into <build-dir>.

Usage: python3 check_render.py <build-dir> <dsm-dir> [--name merchant-city-v2]
Requires numpy, scipy and Pillow. The oblique renders are a slow pure-numpy rasteriser (minutes).
"""
import argparse
import gzip
import json
import math
import struct
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

ap = argparse.ArgumentParser(description="Checks and renders of the city context model (diagnostic).")
ap.add_argument("build_dir", type=Path, help="the build_context.py output directory (run with --keep-work)")
ap.add_argument("dsm_dir", type=Path, help="directory holding heights_50cm.f32 (fetch_dsm.py)")
ap.add_argument("--name", default="merchant-city-v2", help="file stem of the model (default merchant-city-v2)")
ARGS = ap.parse_args()
OUT = ARGS.build_dir
blob = (OUT / f"{ARGS.name}.bin").read_bytes()
magic, (ver, nv, ni) = blob[:4], struct.unpack("<III", blob[4:16])
assert magic == b"VVCX" and ver == 1
V = np.frombuffer(blob, "<i2", nv * 3, 16).reshape(-1, 3).astype(np.float64) / 100
I = np.frombuffer(blob, "<u4", ni, 16 + nv * 6).reshape(-1, 3).astype(np.int64)
assert len(blob) == 16 + nv * 6 + ni * 4
meta = json.loads((OUT / f"{ARGS.name}.json").read_text(encoding="utf-8"))
report = json.loads((OUT / f"{ARGS.name}.build.json").read_text(encoding="utf-8"))
runs = meta["encoding"]["runs"]
ncap = runs["caps"]["indices"][1] // 3
rep = {"vertices": nv, "triangles": len(I), "bytes": len(blob), "gzip": len(gzip.compress(blob, 9))}
GROUND = meta["bands"]["ground_disc_y"]
R0 = meta["parameters"]["radius"]
HX, HZ = meta["parameters"]["rect_half_x"], meta["parameters"]["rect_half_z"]

# ------------------------------------------------------------ normals / orientation
A, Bv, Cv = V[I[:, 0]], V[I[:, 1]], V[I[:, 2]]
N = np.cross(Bv - A, Cv - A)
area2 = np.linalg.norm(N, axis=1)
Nn = N / np.maximum(area2, 1e-12)[:, None]
caps, walls = slice(0, ncap), slice(ncap, None)
rep["caps_facing_up"] = f"{int((Nn[caps, 1] > 0.999).sum())}/{ncap}"
rep["walls_horizontal_normal"] = f"{int((np.abs(Nn[walls, 1]) < 1e-3).sum())}/{len(I) - ncap}"
rep["zero_area_triangles"] = int((area2 < 1e-6).sum())

# ------------------------------------------------------------ crack / manifold check (weld caps+walls by position)
key = np.round(V * 100).astype(np.int64)
_, weld = np.unique(key, axis=0, return_inverse=True)
weld = weld.ravel()
T = weld[I]
e = np.concatenate([T[:, [0, 1]], T[:, [1, 2]], T[:, [2, 0]]])
und = np.sort(e, axis=1)
uniq, inv, cnt = np.unique(und, axis=0, return_inverse=True, return_counts=True)
inv = inv.ravel()
fwd = (e[:, 0] < e[:, 1]).astype(np.int64)
s = np.bincount(inv, weights=fwd, minlength=len(uniq))
two = cnt == 2
rep["edges"] = int(len(uniq))
rep["edges_shared_by_2"] = int(two.sum())
rep["edges_shared_by_2_same_direction (flipped)"] = int((two & (s != 1)).sum())
rep["edges_nonmanifold(>2)"] = int((cnt > 2).sum())
bnd = uniq[cnt == 1]
WP = np.zeros((weld.max() + 1, 3))
WP[weld] = V
p0, p1 = WP[bnd[:, 0]], WP[bnd[:, 1]]
mid = (p0 + p1) / 2
on_rim = np.abs(np.hypot(p0[:, 0], p0[:, 2]) - R0) < 0.05
on_rim &= np.abs(np.hypot(p1[:, 0], p1[:, 2]) - R0) < 0.05


def on_rect(p):
    return ((np.abs(np.abs(p[:, 0]) - HX) < 0.02) & (np.abs(p[:, 2]) <= HZ + 0.02)) | \
           ((np.abs(np.abs(p[:, 2]) - HZ) < 0.02) & (np.abs(p[:, 0]) <= HX + 0.02))


on_cut = on_rect(p0) & on_rect(p1)
rim_ground = on_rim & (np.abs(p0[:, 1] - GROUND) < 0.006) & (np.abs(p1[:, 1] - GROUND) < 0.006)
other = ~(rim_ground | on_cut)
rep["boundary_edges_total"] = int(len(bnd))
rep["boundary_on_rim_at_ground"] = int(rim_ground.sum())
rep["boundary_on_site_cut"] = int(on_cut.sum())
rep["boundary_elsewhere (cracks)"] = int(other.sum())
if other.any():
    rep["crack_examples"] = mid[other][:5].round(2).tolist()


# ------------------------------------------------------------ rasteriser
def raster(sx, sy, depth, W, H, attr_w=None):
    """sx, sy, depth: (n,3). attr_w: (n,3) perspective weights (1/w) or None. Returns zbuf, tri id, l1, l2."""
    zb = np.full((H, W), np.inf, np.float32)
    tid = np.full((H, W), -1, np.int64)
    b1 = np.zeros((H, W), np.float32)
    b2 = np.zeros((H, W), np.float32)
    x0 = np.clip(np.floor(sx.min(1)).astype(int), 0, W)
    x1 = np.clip(np.ceil(sx.max(1)).astype(int) + 1, 0, W)
    y0 = np.clip(np.floor(sy.min(1)).astype(int), 0, H)
    y1 = np.clip(np.ceil(sy.max(1)).astype(int) + 1, 0, H)
    ok = (x1 > x0) & (y1 > y0)
    for t in np.nonzero(ok)[0]:
        gx, gy = np.meshgrid(np.arange(x0[t], x1[t]) + 0.5, np.arange(y0[t], y1[t]) + 0.5)
        ax, bx, cx = sx[t]
        ay, by, cy = sy[t]
        den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(den) < 1e-12:
            continue
        l0 = ((by - cy) * (gx - cx) + (cx - bx) * (gy - cy)) / den
        l1 = ((cy - ay) * (gx - cx) + (ax - cx) * (gy - cy)) / den
        l2 = 1 - l0 - l1
        ins = (l0 >= -1e-6) & (l1 >= -1e-6) & (l2 >= -1e-6)
        if not ins.any():
            continue
        if attr_w is not None:
            w0, w1, w2 = l0 * attr_w[t, 0], l1 * attr_w[t, 1], l2 * attr_w[t, 2]
            ws = w0 + w1 + w2
            l0, l1, l2 = w0 / ws, w1 / ws, w2 / ws
        z = l0 * depth[t, 0] + l1 * depth[t, 1] + l2 * depth[t, 2]
        sl = (slice(y0[t], y1[t]), slice(x0[t], x1[t]))
        upd = ins & (z < zb[sl])
        if upd.any():
            zb[sl][upd] = z[upd]
            tid[sl][upd] = t
            b1[sl][upd] = l1[upd]
            b2[sl][upd] = l2[upd]
    return zb, tid, b1, b2


# ------------------------------------------------------------ top-down height map (caps only)
PXS = 0.25
WT = int(2 * (R0 + 10) / PXS)


def topdown(px, pz):
    return (px + R0 + 10) / PXS, (pz + R0 + 10) / PXS        # image x = planner x, image y = planner z (down)


Ic = I[caps]
sx, sy = topdown(V[Ic][:, :, 0], V[Ic][:, :, 2])
zb, tid, _, _ = raster(sx, sy, -V[Ic][:, :, 1], WT, WT)
HM = np.where(np.isfinite(zb), -zb, np.nan)


def hm_at(x, z):
    ix = np.clip(((np.asarray(x) + R0 + 10) / PXS).astype(int), 0, WT - 1)
    iz = np.clip(((np.asarray(z) + R0 + 10) / PXS).astype(int), 0, WT - 1)
    return HM[iz, ix]


# wall outward test: 0.3 m outside the wall at mid-height must be lower than mid-height, 0.3 m inside higher
Iw = I[walls]
cen = V[Iw].mean(1)
nh = Nn[walls][:, [0, 2]]
ymid = (V[Iw][:, :, 1].min(1) + V[Iw][:, :, 1].max(1)) / 2
hout = hm_at(cen[:, 0] + 0.3 * nh[:, 0], cen[:, 2] + 0.3 * nh[:, 1])
hin = hm_at(cen[:, 0] - 0.3 * nh[:, 0], cen[:, 2] - 0.3 * nh[:, 1])
test = ~((np.abs(cen[:, 0]) <= HX + 0.4) & (np.abs(cen[:, 2]) <= HZ + 0.4))
out_ok = (np.nan_to_num(hout, nan=-99) < ymid) & (hin > ymid)
rep["walls_outward_by_heightmap_probe"] = f"{int((out_ok & test).sum())}/{int(test.sum())}"
bad_w = test & ~out_ok
if bad_w.any():
    rep["walls_probe_fail_examples (x,y,z, out h, in h)"] = np.column_stack(
        [cen[bad_w][:5], hout[bad_w][:5], hin[bad_w][:5]]).round(2).tolist()

# render top-down image
ymin, ymax = np.nanmin(HM), np.nanmax(HM)
g = np.where(np.isnan(HM), 0, 40 + 215 * (HM - ymin) / (ymax - ymin))
img = Image.fromarray(g.astype(np.uint8)).convert("RGB")
d = ImageDraw.Draw(img)
rc = [(-HX, -HZ), (HX, -HZ), (HX, HZ), (-HX, HZ), (-HX, -HZ)]
d.line([topdown(x, z) for x, z in rc], fill=(255, 140, 0), width=3)
d.line([topdown(-HX, -HZ), topdown(HX, -HZ)], fill=(230, 0, 0), width=6)       # window wall, faces -z
cr = 26.0
d.ellipse([topdown(-cr, -cr), topdown(cr, cr)], outline=(0, 160, 255), width=2)
nx, nz = float(np.array([0, 1]) @ np.array(meta["frame"]["plus_x_unit_EN"])), float(np.array([0, 1]) @ np.array(meta["frame"]["plus_z_unit_EN"]))
ax0, az0 = -230, -230
d.line([topdown(ax0, az0), topdown(ax0 + 20 * nx, az0 + 20 * nz)], fill=(255, 255, 0), width=4)
hx_, hz_ = topdown(ax0 + 20 * nx, az0 + 20 * nz)
d.ellipse([hx_ - 8, hz_ - 8, hx_ + 8, hz_ + 8], fill=(255, 255, 0))
d.text(topdown(ax0 + 25 * nx, az0 + 25 * nz + 6), "grid N", fill=(255, 255, 0))
d.line([topdown(150, 240), topdown(200, 240)], fill=(255, 255, 255), width=4)
d.text(topdown(150, 236), "50 m", fill=(255, 255, 255))
d.text((10, 10), "planner frame: +x right, +z down; red = window wall (faces -z); orange = site cut; blue = 26 m clamp", fill=(255, 255, 255))
d.text((10, 26), f"grey = cap height y {ymin:.1f} .. {ymax:.1f} m (hall floor y=0)", fill=(255, 255, 255))
img.save(OUT / "render-topdown.png")
crop = img.crop([int(c) for c in (*topdown(-90, -90), *topdown(90, 90))]).resize((1080, 1080), Image.NEAREST)
crop.save(OUT / "render-topdown-centre.png")

# ------------------------------------------------------------ Glassford Street section (window side)
zs = np.arange(-6.0, -75.0, -0.5)
rep["section_x0_height_above_pavement"] = {f"z={z:.0f}": round(float(v) + 3.79, 1)
                                           for z, v in zip(zs[::6], hm_at(np.zeros_like(zs), zs)[::6])}
cl = []
for xs in range(-100, 101, 20):
    col = hm_at(np.full_like(zs, float(xs)), zs)
    lw = col <= GROUND + 0.01
    if not lw.any():
        cl.append((xs, None))
        continue
    k16 = int(np.argmin(np.abs(zs + 16)))
    if not lw[k16]:
        cand = np.nonzero(lw)[0]
        k16 = int(cand[np.argmin(np.abs(cand - k16))])
    a = b = k16
    while a > 0 and lw[a - 1]:
        a -= 1
    while b < len(lw) - 1 and lw[b + 1]:
        b += 1
    cl.append((xs, round(float(zs[a]), 1), round(float(zs[b]), 1), round(float((zs[a] + zs[b]) / 2), 1)))
rep["street_low_run_by_x (x, z_near, z_far, mid)"] = cl
xx, zz = np.meshgrid(np.arange(-25, 25.1, 0.5), np.arange(-30, -60, -0.5))
hh = hm_at(xx.ravel(), zz.ravel()).reshape(xx.shape)
sel = (zz <= -32) & (zz >= -56)
rep["opposite_block_z-32..-56_|x|<=25_above_pavement_pct10_50_90"] = np.round(
    np.nanpercentile(hh[sel] + 3.79, [10, 50, 90]), 1).tolist()
fz = []
for xs in np.arange(-25, 26, 5.0):
    col = hm_at(np.full_like(zs, xs), zs)
    hit = np.nonzero((col + 3.79 > 10) & (zs < -12))[0]
    fz.append((float(xs), round(float(zs[hit[0]]), 1) if len(hit) else None))
rep["opposite_facade_first_z_above_10m (x, z)"] = fz

# ------------------------------------------------------------ clamped buildings (from the build raster)
wk = np.load(OUT / "_work.npz")
y_raw, RR, PXr, PZr = wk["y_raw"], wk["RR"], wk["PX"], wk["PZ"]
incut = (np.abs(PXr) <= HX) & (np.abs(PZr) <= HZ)
m_cl = (y_raw > 0.0) & (RR < 26.0) & ~incut
lab_, n_ = ndi.label(m_cl)
cl_list = []
for k in range(1, n_ + 1):
    mk = lab_ == k
    area = mk.sum() * 0.25
    if area < 2:
        continue
    cl_list.append(dict(area_m2=round(float(area), 1),
                        centroid_xz=[round(float(PXr[mk].mean()), 1), round(float(PZr[mk].mean()), 1)],
                        x_range=[round(float(PXr[mk].min()), 1), round(float(PXr[mk].max()), 1)],
                        z_range=[round(float(PZr[mk].min()), 1), round(float(PZr[mk].max()), 1)],
                        max_above_pavement=round(float(y_raw[mk].max()) + 3.79, 1)))
cl_list.sort(key=lambda c: -c["area_m2"])
rep["clamped_regions"] = cl_list
ws = m_cl & (PZr < -HZ)
rep["clamped_cells_in_front_of_window_wall (z<-5.95)"] = dict(
    count=int(ws.sum()), min_z=round(float(PZr[ws].min()), 1) if ws.any() else None,
    max_above_pav=round(float(y_raw[ws].max() + 3.79), 1) if ws.any() else None)
# sectors of the clamp ring (x, z quadrants) with what was removed
ring = m_cl
sect = {}
for name, msk in {"behind (+z>5.95)": PZr > HZ, "front (z<-5.95)": PZr < -HZ,
                  "+x side (|z|<=5.95)": (PXr > HX) & (np.abs(PZr) <= HZ), "-x side (|z|<=5.95)": (PXr < -HX) & (np.abs(PZr) <= HZ)}.items():
    mm = ring & msk
    sect[name] = dict(area_m2=round(float(mm.sum() * 0.25), 1),
                      max_above_pavement=round(float(y_raw[mm].max() + 3.79), 1) if mm.any() else None)
rep["clamp_by_sector"] = sect

# ------------------------------------------------------------ oblique render with Lambert + shadow map
az_true, alt = 120.0, 35.0
azg = math.radians(az_true + 1.861)
dEN = np.array([math.sin(azg), math.cos(azg)])
XH = np.array(meta["frame"]["plus_x_unit_EN"])
ZH = np.array(meta["frame"]["plus_z_unit_EN"])
ca = math.cos(math.radians(alt))
L = np.array([ca * (dEN @ XH), math.sin(math.radians(alt)), ca * (dEN @ ZH)])
L /= np.linalg.norm(L)
rep["sun_dir_planner"] = L.round(4).tolist()

f = -L
rt = np.cross(f, [0, 1, 0]); rt /= np.linalg.norm(rt)
up = np.cross(rt, f)
SM = 4096
ext = 300.0
su = (V @ rt + ext) / (2 * ext) * SM
sv = (V @ up + ext) / (2 * ext) * SM
sd = V @ f
smz, _, _, _ = raster(su[I], sv[I], sd[I], SM, SM)

def render_view(cam, tgt, fname, W_=1600, H_=1000, near=0.3):
    W_, H_ = 1600, 1000
    fw = tgt - cam; fw /= np.linalg.norm(fw)
    cr_ = np.cross(fw, [0, 1, 0]); cr_ /= np.linalg.norm(cr_)
    cu = np.cross(cr_, fw)
    fy = 1 / math.tan(math.radians(45) / 2)
    Vc = np.stack([(V - cam) @ cr_, (V - cam) @ cu, (V - cam) @ fw], 1)

    tris_c, tri_src = [], []
    for t, tri in enumerate(I):
        pc = Vc[tri]
        inside = pc[:, 2] > near
        if inside.all():
            tris_c.append(pc); tri_src.append(t)
        elif inside.any():
            poly = []
            for k in range(3):
                a, b = pc[k], pc[(k + 1) % 3]
                ia, ib = a[2] > near, b[2] > near
                if ia:
                    poly.append(a)
                if ia != ib:
                    tt = (near - a[2]) / (b[2] - a[2])
                    poly.append(a + tt * (b - a))
            for k in range(1, len(poly) - 1):
                tris_c.append(np.array([poly[0], poly[k], poly[k + 1]])); tri_src.append(t)
    tris_c = np.array(tris_c)
    tri_src = np.array(tri_src)
    asp = W_ / H_
    sxo = (tris_c[:, :, 0] / tris_c[:, :, 2] * fy / asp * 0.5 + 0.5) * W_
    syo = (0.5 - tris_c[:, :, 1] / tris_c[:, :, 2] * fy * 0.5) * H_
    zb, tid, b1, b2 = raster(sxo, syo, tris_c[:, :, 2], W_, H_, attr_w=1 / tris_c[:, :, 2])
    hit = tid >= 0
    tc = tris_c[tid[hit]]
    pc = tc[:, 0] * (1 - b1[hit] - b2[hit])[:, None] + tc[:, 1] * b1[hit][:, None] + tc[:, 2] * b2[hit][:, None]
    pw = cam + pc[:, 0:1] * cr_ + pc[:, 1:2] * cu + pc[:, 2:3] * fw
    nrm = Nn[tri_src[tid[hit]]]
    po = pw + nrm * 0.15
    iu = np.clip((po @ rt + ext) / (2 * ext) * SM, 0, SM - 1).astype(int)
    iv = np.clip((po @ up + ext) / (2 * ext) * SM, 0, SM - 1).astype(int)
    lit = (po @ f) <= smz[iv, iu] + 0.10
    ndl = np.clip(nrm @ L, 0, 1)
    sky = 0.30 + 0.12 * nrm[:, 1]
    shade = 0.93 * (sky + 0.75 * ndl * lit)
    col = np.zeros((H_, W_, 3))
    col[...] = np.array([0.80, 0.84, 0.90])
    tint = np.where((np.abs(nrm[:, 1]) > 0.99)[:, None], [1.0, 0.99, 0.96], [0.97, 0.97, 0.98])
    col[hit] = np.clip(shade, 0, 1)[:, None] * tint
    img = Image.fromarray((np.clip(col, 0, 1) ** (1 / 1.6) * 255).astype(np.uint8))
    d = ImageDraw.Draw(img)


    def proj(p):
        q = np.array(p) - cam
        c = np.array([q @ cr_, q @ cu, q @ fw])
        return ((c[0] / c[2] * fy / asp * 0.5 + 0.5) * W_, (0.5 - c[1] / c[2] * fy * 0.5) * H_)


    d.line([proj((x, 0.0, z)) for x, z in rc], fill=(255, 140, 0), width=2)
    d.line([proj((-HX, 0.0, -HZ)), proj((HX, 0.0, -HZ))], fill=(230, 0, 0), width=4)
    d.text((12, 12), f"camera {tuple(float(v) for v in cam)} -> {tuple(float(v) for v in tgt)}, vfov 45; sun true az {az_true:.0f} alt {alt:.0f}; Lambert + shadow map",
           fill=(20, 20, 20))
    d.text((12, 28), "orange = hall site cut at floor level y=0; red = window wall; the hall model fills the hole", fill=(20, 20, 20))
    img.save(OUT / fname)

    return lit


lit = render_view(np.array([10.2, 12.6, 13.2]), np.array([0.0, 0.6, 0.0]), "render-oblique.png")
render_view(np.array([110.0, 120.0, 150.0]), np.array([0.0, 0.0, -20.0]), "render-overview.png")
rep["oblique_lit_fraction_of_visible"] = round(float(lit.mean()), 3)

# hillshade contact sheet of suppressed tree blobs (raw DSM, 40 m tiles)
G = 6000
rawg = np.fromfile(ARGS.dsm_dir / "heights_50cm.f32", "<f4").reshape(G, G)
tiles = []
for b in report["trees_suppressed"]["blobs"]:
    x, z = b["centre_xz"]
    de = XH[0] * x + ZH[0] * z
    dn = XH[1] * x + ZH[1] * z
    ci, cj = int(round((8.0 + dn + 1500) / 0.5)), int(round((3.0 + de + 1500) / 0.5))
    t = rawg[ci - 40:ci + 40, cj - 40:cj + 40].astype(float)
    gy, gx = np.gradient(t, 0.5)
    hs = np.clip(0.6 + 0.4 * (-gx * 0.6 + gy * 0.6) / np.sqrt(1 + gx ** 2 + gy ** 2), 0, 1)
    im = Image.fromarray((np.flipud(hs) * 255).astype(np.uint8)).resize((240, 240), Image.NEAREST).convert("RGB")
    ImageDraw.Draw(im).text((4, 4), f"({x:.0f},{z:.0f}) {b['area_m2']:.0f}m2 {b['max_above_pavement']:.0f}m", fill=(255, 0, 0))
    tiles.append(im)
sheet = Image.new("RGB", (240 * 5, 240 * ((len(tiles) + 4) // 5)), (0, 0, 0))
for k, im in enumerate(tiles):
    sheet.paste(im, ((k % 5) * 240, (k // 5) * 240))
sheet.save(OUT / "trees-suppressed-hillshade.png")

(OUT / "checks.json").write_text(json.dumps(rep, indent=1), encoding="utf-8")
print(json.dumps(rep, indent=1))
