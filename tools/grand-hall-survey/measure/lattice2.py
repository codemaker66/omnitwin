import os, sys, numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from buffers import load
v, P = load('rcp')
img = np.asarray(Image.open('out/rcp.png').convert('L')).astype(np.float32)
H, W = img.shape
valid = P[..., 3] > 0.5
def smooth1(a, s):
    k = np.exp(-np.arange(-3*s, 3*s+1)**2 / (2*s*s)); k /= k.sum()
    return np.convolve(a, k, 'same')
# column x px -> world X = 8.8 - (px + 0.5 - 1125)/100 ; row py -> Y = -4.9 + (620 - py - 0.5)/100
def X(px): return 8.8 - (px + 0.5 - 1125) / 100
def Y(py): return -4.9 + (620 - py - 0.5) / 100
# Horizontal period: rows bands away from dome/roses: py 150..200 (top rows) and 1040..1090 (bottom rows)
for band in [(150, 210), (1030, 1090)]:
    prof = img[band[0]:band[1], 100:2150].mean(axis=0)
    prof = prof - smooth1(prof, 20)
    ac = np.correlate(prof, prof, 'full')[len(prof)-1:]
    lags = np.arange(len(ac))
    # find first peak after lag 80
    seg = ac[80:130]; lag1 = 80 + int(np.argmax(seg))
    # refine using peak at ~10 periods
    seg10 = ac[1000:1060]; lag10 = 1000 + int(np.argmax(seg10))
    print('band', band, 'period ~', lag1, 'px; 10 periods', lag10, 'px ->', lag10 / 10 / 100, 'm')
# Vertical period: column strips away from dome/roses: px 120..180 (X ~ 18.3) and 1060..1190? (dome) no; use 2000..2080
for strip in [(120, 300), (1950, 2130)]:
    prof = img[100:1150, strip[0]:strip[1]].mean(axis=1)
    prof = prof - smooth1(prof, 20)
    ac = np.correlate(prof, prof, 'full')[len(prof)-1:]
    seg = ac[150:200]; lag2 = 150 + int(np.argmax(seg))
    seg = ac[850:920]; lag10 = 850 + int(np.argmax(seg))
    print('strip', strip, 'two-row period ~', lag2, 'px; ~10 rows', lag10, 'px')
