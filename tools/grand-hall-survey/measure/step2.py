import os
import numpy as np, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from hallmesh import *
pos, idx, uv, chunk = load_mesh()
a, b, c, n, area = triangles(pos, idx)
lo = np.array([-3.0, -12.0, -1.0]); hi = np.array([21.0, 2.5, 10.0])
sel = crop(a, b, c, lo, hi)
A, B, C = a[sel], b[sel], c[sel]
st = stations()
FLOOR = 0.045
for h in [0.3, 1.0, 1.6, 2.4, 3.3, 4.2, 5.0, 5.8, 6.5]:
    z = FLOOR + h
    segs = plane_section(A, B, C, np.array([0, 0, z]), np.array([0, 0, 1.0]))
    np.save(f'analysis/plan_{h:.1f}.npy', segs)
    marks = [((t[0], t[1]), sid[-3:], (200, 30, 30)) for sid, (t, q) in st.items() if int(sid[-3:]) <= 49]
    draw_segments(segs[:, :, :2], (-3.0, -12.0), (21.0, 2.5), 50, f'analysis/plan_{h:.1f}.png', marks=marks)
    print(h, len(segs))
