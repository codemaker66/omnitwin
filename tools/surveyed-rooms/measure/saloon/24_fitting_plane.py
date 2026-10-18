import sys; sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import numpy as np
from PIL import Image, ImageDraw
from cubelib import Station
def plane(sid, Xc, Y0, Y1, Z0, Z1, res, out):
    ny = int((Y1 - Y0) / res); nz = int((Z1 - Z0) / res)
    Y = Y0 + (np.arange(ny) + 0.5) * res; Z = Z1 - (np.arange(nz) + 0.5) * res
    YY, ZZ = np.meshgrid(Y, Z)
    P = np.stack([np.full_like(YY, Xc), YY, ZZ], -1).reshape(-1, 3)
    st = Station(sid); col = st.sample_points(P).reshape(nz, ny, 3)
    im = Image.fromarray((np.clip(col, 0, 1) * 255).astype(np.uint8)); d = ImageDraw.Draw(im)
    for gy in np.arange(np.ceil(Y0 * 10) / 10, Y1, 0.1):
        x = (gy - Y0) / res; d.line([(x, 0), (x, 6)], fill=(255, 255, 0))
        if abs(gy * 2 - round(gy * 2)) < 1e-6: d.text((x + 1, 8), f"{gy:.1f}", fill=(255, 255, 0))
    for gz in np.arange(np.ceil(Z0 * 10) / 10, Z1, 0.1):
        y = (Z1 - gz) / res; d.line([(0, y), (10, y)], fill=(0, 255, 255)); d.line([(ny - 10, y), (ny, y)], fill=(0, 255, 255))
        if abs(gz * 2 - round(gz * 2)) < 1e-6: d.text((12, y - 5), f"{gz:.1f}", fill=(0, 255, 255))
    im.save(out); print(out, im.size)
plane(66, -2.111, 9.2, 11.2, 3.3, 5.95, 0.005, "hr_elec_north_s66.png")
plane(63, -2.096, 3.9, 5.9, 3.3, 5.95, 0.005, "hr_elec_south_s63.png")
