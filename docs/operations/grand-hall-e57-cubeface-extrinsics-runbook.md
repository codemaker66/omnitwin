# Grand Hall E57 cubeface-extrinsics runbook

## Purpose

Recover the six native cubeface camera orientations for exact E57 scans 40–47
without reading or using stored Image2D rotations. The result is an
authority-none camera candidate derived from same-capture coloured E57 points
and the exact T559 JPEG bytes.

This lane establishes only the internal camera convention and candidate
extrinsics for those 48 native images. It does not accept the external panorama
correspondence, room membership, masks, an E57-to-XGRIDS transform, training
eligibility, reconstruction input, runtime admission, staging, publication, or
production trust.

## Frozen method

- Reviewed method commit:
  `a0b41caa338e4cbe8d62c99ecf22de0bda2eea6d`.
- Runtime: isolated CPython 3.12.12 at the path frozen in
  `e57-cubeface-extrinsics-dependency-bootstrap-authority-none.json`.
- Runtime tree: 930 files, SHA-256
  `02892b5dcecea27f224c95042d148d69ae7411f170ba02ef0e0c12d6c7c856d7`.
- Decoder: OpenCV 4.10.0.84, one thread, OpenCL disabled. There is no Pillow
  fallback.
- Solver: deterministic row/column lattice, all 48 signed-axis candidates per
  face, all 48 exact faces, and three fresh Pye57 readers in one process.

The six scanner-local winners, expressed as right/down/forward, are:

| Face | Right | Down | Forward |
| --- | --- | --- | --- |
| 0 | `-Y` | `+X` | `+Z` |
| 1 | `-Y` | `-Z` | `+X` |
| 2 | `-X` | `-Z` | `-Y` |
| 3 | `+Y` | `-Z` | `-X` |
| 4 | `+X` | `-Z` | `+Y` |
| 5 | `-Y` | `-X` | `-Z` |

## Evidence-grade build

Run only from the exact reviewed commit with the private evidence roots on
local drives. Set these PowerShell values to the existing exact roots:

```powershell
$repo = 'C:\Users\blake\omnitwin2-grand-hall-exact-runtime'
$python = 'D:\venviewer-tools\t564-e57-cubeface-hermetic-py312-v1\Scripts\python.exe'
$builder = Join-Path $repo 'tools\twin-forge\e57-scripts\build_grand_hall_e57_cubeface_extrinsics.py'
$stage = 'F:\VenviewerCaptureStaging\trades-hall-2026-07-10'
$image2d = 'D:\venviewer-evidence\trades-hall-grand-hall-e57-image2d-v1'
$crosswalk = 'D:\venviewer-evidence\trades-hall-grand-hall-panorama-image2d-crosswalk-v1'
$subset = Join-Path $repo 'docs\operations\grand-hall-camera-metric-subset-authority-none-v1.json'
$out = 'D:\venviewer-evidence\trades-hall-grand-hall-e57-cubeface-extrinsics-v1'
$reviewed = 'a0b41caa338e4cbe8d62c99ecf22de0bda2eea6d'
$env:MKL_NUM_THREADS = '1'
$env:NUMEXPR_NUM_THREADS = '1'
$env:OMP_NUM_THREADS = '1'
$env:OPENBLAS_NUM_THREADS = '1'
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:PYTHONPATH = $null
& $python -I -B $builder --stage $stage --image2d-evidence-root $image2d --crosswalk-root $crosswalk --camera-subset $subset --out $out --repo-root $repo --reviewed-git-sha $reviewed --verify-source-hashes
```

The output is no-replace and receipt-last. A failed run must not leave the
final output directory. Never delete or replace an existing accepted evidence
pack merely to rerun the command; choose a separately reviewed versioned path.

## Independent check

Run the same command with `--check`. Check mode rehashes the 20.5 GB E57,
recomputes all three attempts, and verifies the existing pack without writing
it:

```powershell
& $python -I -B $builder --stage $stage --image2d-evidence-root $image2d --crosswalk-root $crosswalk --camera-subset $subset --out $out --repo-root $repo --reviewed-git-sha $reviewed --verify-source-hashes --check
```

## Verified machine result

Both the receipt-last build and the separate full check passed on 2026-09-01.

- Result: 744,483 bytes, SHA-256
  `27d247086fbbf85e3ec53397dd8fa79616d7ceb0a9618345d57055c0e44e71bd`.
- Receipt: 1,187 bytes, SHA-256
  `5ae120e1c37641c58f83e38e6075ac06fd0dae9e9edba038726f4416b378c22f`.
- Eight scans and 48 faces passed.
- Minimum winning luminance NCC: `0.9826238541917383`.
- Maximum winning RGB MAE: `2.5589983358427766` byte values.
- Minimum winner/runner NCC margin: `0.24957572866243183`.
- All three attempt result hashes were byte-identical.
- Every downstream permission remains `false`; authority remains `none`.

The repository preserves only the compact receipt. The 744 KB result and all
private source payloads remain local and unpushed.
