# xgrids-xbag

Read-only tools for the XGRIDS PortalCam `.xbin` (XBAG) raw capture container.
Format facts and the reason each rule exists live in `xbag_records.py`'s
docstring; the evidence is `docs/reports/xbag-frame-decode-2026-09-02.md`.

- `xbag_records.py` — pure-Python (stdlib) parser for camera frame records:
  locate a record from its H.264 start code, index every keyframe, group the
  four cameras' co-timed frames, classify a picture as pinhole or fisheye.
- `xbag_extract.py` — CLI: `index` a capture to CSV, `extract` one access unit
  as raw H.264, optionally decode it to PNG (needs `pip install av pillow`).
- `xbag_colmap.py` — CLI: the XBAG-to-COLMAP bridge for a bounded zone of a
  capture (`select`, `extract`, `features`, `pairs`, `match`, `score`, `write`,
  `triangulate`, `refine`), the whole-hall additions (`select` with motion
  keyframing, `extract --workers`, the GPU path `gpu-features`, `gpu-match`,
  `gpu-import` with kornia DISK + LightGlue for the pinholes, `pairs-lens` and
  `features --only-lens fisheye` for COLMAP SIFT on the fisheyes, `rig` as an
  experiment), and `package`, which turns the refined model into the T-502
  trainer's PINHOLE-only layout (undistorted pinholes, five virtual views per
  fisheye with the operator masked, half-size copies, `splits.json`, sparse
  depth samples, `colmap_input.json`). It takes the keyframe index,
  `project_data/poses.csv` and the T-566 calibration receipt, and resolves the
  receipt's open questions (which stored lens is which calibration camera, the
  direction of every extrinsic matrix, the pose file's quaternion convention)
  by scoring all 256 readings against the verified feature matches, then
  writes `sparse/0` for the winner and checks it with COLMAP's known-pose
  triangulation. `refine` is bundle adjustment with the calibration fixed and
  a position prior per camera from the pose file; run it as loose
  triangulation, refine, tight re-triangulation, refine, and it reports how
  far the pictures moved the pose-file poses. Needs
  `pip install av pillow opencv-python pycolmap`; the evidence is
  `docs/reports/xbag-colmap-zone-2026-09-02.md`.
- `tests/` — `python -m unittest discover -s tests -p "test_*.py"` from this
  directory. Fixtures are synthetic records, poses and projected points; no
  capture file is read.

```powershell
cd tools/xgrids-xbag
python xbag_extract.py index   "F:\...\2026-05-31-101837.xbin" D:\claude\xbag\keyframes.csv
python xbag_extract.py extract "F:\...\2026-05-31-101837.xbin" 6009392 D:\claude\xbag\frame.h264 --png D:\claude\xbag\frame.png

# COLMAP dataset for the south-west quarter of the Grand Hall (metres in the capture's own frame)
python xbag_colmap.py select   --index D:\claude\xbag\keyframes.csv --poses "F:\...\project_data\poses.csv" --zone -10.6 -4.0 -19.1 -10.0 --budget 150 --out D:\zone\manifest.json
python xbag_colmap.py extract  --capture "F:\...\2026-05-31-101837.xbin" --manifest D:\zone\manifest.json --calibration t566.json --images D:\zone\images
python xbag_colmap.py features --manifest D:\zone\manifest.json --calibration t566.json --images D:\zone\images --db D:\zone\database.db
python xbag_colmap.py pairs    --manifest D:\zone\manifest.json --out D:\zone\pairs.txt
python xbag_colmap.py match    --db D:\zone\database.db --pairs D:\zone\pairs.txt
python xbag_colmap.py score    --manifest D:\zone\manifest.json --calibration t566.json --db D:\zone\database.db --pairs D:\zone\pairs.txt --out D:\zone\scores.csv
python xbag_colmap.py write    --manifest D:\zone\manifest.json --calibration t566.json --scores D:\zone\scores.csv --db D:\zone\database.db --out D:\zone\sparse\0
python xbag_colmap.py triangulate --model D:\zone\sparse\0 --db D:\zone\database.db --images D:\zone\images --out D:\zone\sparse\0-triangulated
# refinement: loose triangulation, refine, tight re-triangulation, refine (deltas are measured against sparse\0)
python xbag_colmap.py triangulate --model D:\zone\sparse\0 --db D:\zone\database.db --images D:\zone\images --out D:\zone\sparse\1-loose --max-reproj-error 16 --max-angle-error 5
python xbag_colmap.py refine      --model D:\zone\sparse\1-loose --reference D:\zone\sparse\0 --out D:\zone\sparse\2-refined
python xbag_colmap.py triangulate --model D:\zone\sparse\2-refined --db D:\zone\database.db --images D:\zone\images --out D:\zone\sparse\3-retriangulated
python xbag_colmap.py refine      --model D:\zone\sparse\3-retriangulated --reference D:\zone\sparse\0 --out D:\zone\sparse\4-final --ply D:\zone\sparse\points-final.ply
```

Calibration is the T-566 receipt's business (see the Codex
`grand-hall-exact-runtime` branch); `xbag_colmap.py` consumes the receipt JSON
as it is and records which reading of it won in `sparse/0/hypothesis.json`.
