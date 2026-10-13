import os
import numpy as np, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from hallmesh import *
from PIL import Image
st = stations()
def strip(h, lo, hi, scale, name):
    segs = np.load(f'analysis/plan_{h:.1f}.npy')
    marks = [((t[0], t[1]), sid[-3:], (200, 30, 30)) for sid, (t, q) in st.items() if int(sid[-3:]) <= 49 and lo[0] <= t[0] <= hi[0] and lo[1] <= t[1] <= hi[1]]
    draw_segments(segs[:, :, :2], lo, hi, scale, f'analysis/{name}_{h:.1f}.png', grid=0.5, marks=marks, width=2)
for h in [0.3, 1.0, 1.6, 2.4, 3.3]:
    strip(h, (-3.0, -11.6), (9.0, -9.0), 100, 'winL')
    strip(h, (8.0, -11.6), (21.0, -9.0), 100, 'winR')
    strip(h, (-3.0, -0.6), (9.0, 2.2), 100, 'doorL')
    strip(h, (8.0, -0.6), (21.0, 2.2), 100, 'doorR')
