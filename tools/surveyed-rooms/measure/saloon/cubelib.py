"""Sampler for the native E57 skybox faces (4096^2 per face, read-only), oriented as found by
21_cubeorient.py: world = R(q) local, q = manifest pose.q (w, x, y, z); per face (forward, right, up) in local."""
import os, sys, json
sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import numpy as np
from PIL import Image
from common import *
Image.MAX_IMAGE_PIXELS = None
CUBE = __import__("os").environ.get("E57_CUBE_FACES", "work/cube-faces/")
FACES = [((0, 0, 1), (0, -1, 0), (-1, 0, 0)), ((1, 0, 0), (0, -1, 0), (0, 0, 1)), ((0, -1, 0), (-1, 0, 0), (0, 0, 1)),
         ((-1, 0, 0), (0, 1, 0), (0, 0, 1)), ((0, 1, 0), (1, 0, 0), (0, 0, 1)), ((0, 0, -1), (0, -1, 0), (1, 0, 0))]
F = np.array([f for f, _, _ in FACES], float); Rt = np.array([r for _, r, _ in FACES], float); Up = np.array([u for _, _, u in FACES], float)
def qmat(q):
    w, x, y, z = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
class Station:
    def __init__(self, sid):
        S, m = stations()
        self.st = S[sid]; self.R = qmat(self.st["q"]); self.t = self.st["t"]
        self.files = sorted(f for f in os.listdir(CUBE + self.st["id"]) if f.endswith(".jpg"))
        self.cache = {}
        g = self.st["exposure"]["gain"]; self.gain = g * np.array(self.st["exposure"]["wb"])
    def face(self, k):
        if k not in self.cache:
            self.cache[k] = np.asarray(Image.open(CUBE + self.st["id"] + "/" + self.files[k]).convert("RGB"))
        return self.cache[k]
    def sample_dirs(self, v):
        loc = v @ self.R          # R^T v
        k = np.argmax(loc @ F.T, axis=1)
        out = np.zeros((len(v), 3), np.float32)
        for f in np.unique(k):
            m = k == f; L = loc[m]
            fw = L @ F[f]; x = (L @ Rt[f]) / fw; y = (L @ Up[f]) / fw
            img = self.face(f); n = img.shape[0]
            fx = (x + 1) / 2 * n - 0.5; fy = (1 - y) / 2 * n - 0.5
            x0 = np.clip(np.floor(fx).astype(int), 0, n - 2); y0 = np.clip(np.floor(fy).astype(int), 0, n - 2)
            tx = np.clip(fx - x0, 0, 1)[:, None]; ty = np.clip(fy - y0, 0, 1)[:, None]
            c = (img[y0, x0] * (1 - tx) + img[y0, x0 + 1] * tx) * (1 - ty) + (img[y0 + 1, x0] * (1 - tx) + img[y0 + 1, x0 + 1] * tx) * ty
            out[m] = c
        return out / 255.0
    def sample_points(self, P):
        return self.sample_dirs(P - self.t)
