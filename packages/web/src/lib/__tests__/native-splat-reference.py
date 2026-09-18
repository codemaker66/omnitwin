"""Rebuild the small independent numerical fixture with Pillow/libwebp + NumPy.

Run from packages/web. Never changes the capture. The reference follows the
PlayCanvas SOG v2 specification and vendor_init/sog.py's full-SH3 decoder.
"""
import hashlib
import io
import json
from pathlib import Path
import zipfile
import numpy as np
from PIL import Image

source = Path("public/splats/reception/env.sog")
with zipfile.ZipFile(source) as archive:
    meta = json.loads(archive.read("meta.json"))
    def plane(name):
        return np.asarray(Image.open(io.BytesIO(archive.read(name))).convert("RGBA"), dtype=np.uint8).reshape(-1, 4)
    lower, upper = [plane(name) for name in meta["means"]["files"]]
    scales, quats, color = [plane(meta[key]["files"][0]) for key in ["scales", "quats", "sh0"]]
    centroids, labels = [plane(name) for name in meta["shN"]["files"]]
    books = {key: np.asarray(meta[key]["codebook"], dtype=np.float32) for key in ["scales", "sh0", "shN"]}
    expected = []
    for index in [0, 1, 127, 1024, meta["count"] - 1]:
        lo = np.asarray(meta["means"]["mins"])
        hi = np.asarray(meta["means"]["maxs"])
        code = lower[index, :3].astype(np.uint32) + (upper[index, :3].astype(np.uint32) << 8)
        n = lo + (hi - lo) * code / 65535
        position = (np.sign(n) * np.expm1(np.abs(n))).astype(np.float32)
        mode = int(quats[index, 3]) - 252
        kept = (quats[index, :3].astype(np.float64) / 255 - .5) * np.sqrt(2)
        q = np.insert(kept, mode, np.sqrt(max(0, 1 - np.dot(kept, kept))))
        q /= np.linalg.norm(q)
        w, x, y, z = q
        rotation = np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
                             [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
                             [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])
        scale = np.exp(books["scales"][scales[index, :3]].astype(np.float64))
        covariance = rotation @ np.diag(scale * scale) @ rotation.T
        rgba = np.rint(np.clip((.5 + .28209479177387814 * books["sh0"][color[index, :3]].astype(np.float64)) * 255, 0, 255)).astype(np.uint8).tolist() + [int(color[index, 3])]
        label = int(labels[index, 0]) + (int(labels[index, 1]) << 8)
        coeff = books["shN"][centroids[label * 15:(label + 1) * 15, :3]]
        sh = np.rint(np.clip(coeff.astype(np.float64) * 128 + 128, 0, 255)).astype(np.uint8)
        expected.append({"index": index, "position": position.tolist(), "covariance": covariance[np.triu_indices(3)].astype(np.float32).tolist(), "color": rgba, "sh": sh.ravel().tolist()})
result = {"sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(), "count": meta["count"], "shDegree": 3, "samples": expected}
Path("src/lib/__tests__/native-splat-reference.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
