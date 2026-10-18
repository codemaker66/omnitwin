import sys, json; sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import numpy as np
from scipy import ndimage
from common import *
z = np.load(OUT + "/scripts/ceiling_zmap.npy"); z = np.where(np.isfinite(z), z, np.nan)
res_ = 0.05; X0, Y1 = -6.0, 14.0
def xy(r, c): return X0 + (c + 0.5) * res_, Y1 - (r + 0.5) * res_
def comps(mask, minarea=0.05):
    lab, n = ndimage.label(mask)
    out = []
    for i in range(1, n + 1):
        rr, cc = np.nonzero(lab == i)
        A = len(rr) * res_ ** 2
        if A < minarea: continue
        X, Y = xy(rr, cc)
        out.append(dict(cx=round(float(X.mean()), 3), cy=round(float(Y.mean()), 3), area=round(A, 3), x=[round(float(X.min() - res_ / 2), 2), round(float(X.max() + res_ / 2), 2)], y=[round(float(Y.min() - res_ / 2), 2), round(float(Y.max() + res_ / 2), 2)], zmed=round(float(np.nanmedian(z[rr, cc])), 3)))
    return out
zz = np.nan_to_num(z, nan=0)
inner = comps(zz > 5.545, 1.0)
print("components z>5.545 with area >= 1 m2:", inner)
sq = comps(zz > 5.69, 0.5); print("squares z>5.69:", sq)
rp = comps(zz > 5.83, 0.2); print("raised panels z>5.83:", rp)
cof = [c for c in comps((zz > 5.595) & (zz < 5.70), 0.08) if not (-4.05 < c["cx"] < -0.05 and 2.75 < c["cy"] < 12.4)]
print(len(cof), "coffers (z 5.595-5.70, outside the inner frame):")
for c in sorted(cof, key=lambda c: (round(c["cy"], 0), c["cx"])): print("  ", c, "equiv diameter %.2f" % (2 * np.sqrt(c["area"] / np.pi)))
# field levels
field = (zz > 5.49) & (zz < 5.535); print("perimeter field 5.49-5.535: area %.1f m2, median %.3f" % (field.sum() * res_ ** 2, np.nanmedian(z[field])))
band = (zz > 5.55) & (zz < 5.585); print("inner band 5.55-5.585: area %.1f m2, median %.3f" % (band.sum() * res_ ** 2, np.nanmedian(z[band])))
json.dump(dict(inner=inner, squares=sq, raised=rp, coffers=cof), open(OUT + "/scripts/ceiling_parts.json", "w"), indent=1)
