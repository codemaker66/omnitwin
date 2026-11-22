import sys; sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import numpy as np
from PIL import Image, ImageDraw
from cubelib import Station
def floor(sid, X0, X1, Y0, Y1, res, out, z=0.002):
    nx = int((X1 - X0) / res); ny = int((Y1 - Y0) / res)
    X = X0 + (np.arange(nx) + 0.5) * res; Y = Y1 - (np.arange(ny) + 0.5) * res
    XX, YY = np.meshgrid(X, Y)
    P = np.stack([XX, YY, np.full_like(XX, z)], -1).reshape(-1, 3)
    st = Station(sid); col = st.sample_points(P).reshape(ny, nx, 3)
    im = Image.fromarray((np.clip(col, 0, 1) * 255).astype(np.uint8)); d = ImageDraw.Draw(im)
    for gx in np.arange(np.ceil(X0 * 10) / 10, X1, 0.1):
        x = (gx - X0) / res; d.line([(x, 0), (x, 8)], fill=(255, 255, 0)); d.text((x + 1, 9), f"{gx:.1f}", fill=(255, 255, 0))
    for gy in np.arange(np.ceil(Y0 * 10) / 10, Y1, 0.1):
        y = (Y1 - gy) / res; d.line([(0, y), (8, y)], fill=(0, 255, 255)); d.text((9, y - 5), f"{gy:.1f}", fill=(0, 255, 255))
    im.save(out); print(out, im.size)
floor(58, -2.9, -1.7, 6.6, 7.6, 0.002, "hr_floor_58.png")
