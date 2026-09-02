# xgrids-xbag

Read-only tools for the XGRIDS PortalCam `.xbin` (XBAG) raw capture container.
Format facts and the reason each rule exists live in `xbag_records.py`'s
docstring; the evidence is `docs/reports/xbag-frame-decode-2026-09-02.md`.

- `xbag_records.py` — pure-Python (stdlib) parser for camera frame records:
  locate a record from its H.264 start code, index every keyframe, group the
  four cameras' co-timed frames, classify a picture as pinhole or fisheye.
- `xbag_extract.py` — CLI: `index` a capture to CSV, `extract` one access unit
  as raw H.264, optionally decode it to PNG (needs `pip install av pillow`).
- `tests/` — `python -m unittest discover -s tests -p "test_*.py"` from this
  directory. Fixtures are synthetic records; no capture file is read.

```powershell
cd tools/xgrids-xbag
python xbag_extract.py index   "F:\...\2026-05-31-101837.xbin" D:\claude\xbag\keyframes.csv
python xbag_extract.py extract "F:\...\2026-05-31-101837.xbin" 6009392 D:\claude\xbag\frame.h264 --png D:\claude\xbag\frame.png
```

Calibration is the T-566 receipt's business (see the Codex
`grand-hall-exact-runtime` branch); applying it to a decoded frame is shown in
the report, not done here.
