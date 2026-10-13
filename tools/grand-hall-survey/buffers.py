import json, numpy as np
def load(name, mode="position"):
    v = json.load(open(f"out/{name}.json"))
    w, h = v["pixels"]
    a = np.fromfile(f"out/{name}.{mode}.f32", dtype=np.float32).reshape(h, w, 4)
    a = a[::-1]  # GL rows start at the bottom
    return v, a
