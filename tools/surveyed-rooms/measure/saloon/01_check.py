import sys, hashlib; sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import numpy as np
from common import *
J, raw = glb_json()
m = load_manifest()
print("glb sha256", hashlib.sha256(raw).hexdigest(), "manifest", m["contentHashes"]["mesh/dollhouse.glb"], "bytes", len(raw), "manifest bytes", m["mesh"]["bytes"])
P, I, C = load_mesh()
print("dump", len(P), "verts", len(I), "tris")
# compare per-node vertex count and world bbox from accessor min/max
nodes = J["nodes"]; acc = J["accessors"]
cnt_ok = 0; worst = 0; tot_v = 0; tot_i = 0
for ni, n in enumerate(nodes):
    if "mesh" not in n: continue
    s = np.array(n.get("scale", [1, 1, 1])); t = np.array(n.get("translation", [0, 0, 0]))
    assert "rotation" not in n and "matrix" not in n
    for p in J["meshes"][n["mesh"]]["primitives"]:
        a = acc[p["attributes"]["POSITION"]]; tot_v += a["count"]; tot_i += acc[p["indices"]]["count"]
        lo = np.array(a["min"], float); hi = np.array(a["max"], float)
        if a.get("normalized"):
            div = {5122: 32767, 5123: 65535, 5120: 127, 5121: 255}[a["componentType"]]
            lo, hi = lo / div, hi / div
        wlo, whi = lo * s + t, hi * s + t
        sel = C == ni
        dlo, dhi = P[sel].min(0), P[sel].max(0)
        if sel.sum() == a["count"]: cnt_ok += 1
        worst = max(worst, np.abs(dlo - wlo).max(), np.abs(dhi - whi).max())
print("nodes with matching vertex count", cnt_ok, "of", sum(1 for n in nodes if "mesh" in n), "| GLB totals", tot_v, "verts", tot_i // 3, "tris")
print("worst |bbox(dump) - bbox(GLB accessor min/max x node TRS)| =", round(worst * 1000, 3), "mm")
print("componentTypes", sorted(set((acc[J['meshes'][n['mesh']]['primitives'][0]['attributes']['POSITION']]['componentType'], acc[J['meshes'][n['mesh']]['primitives'][0]['attributes']['POSITION']].get('normalized', False)) for n in nodes if 'mesh' in n)))
# second dump made independently
P2 = np.fromfile(ROOT + "/research/pipeline-anatomy/mesh/positions.f32", dtype=np.float32)
print("two dumps identical:", np.array_equal(P2, P.astype(np.float32).ravel()))
