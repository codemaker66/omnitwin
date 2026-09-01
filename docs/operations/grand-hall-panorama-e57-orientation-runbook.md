# Grand Hall panorama-to-E57 orientation runbook

## Purpose

Recover content-derived relative orientations between the eight exact external
Grand Hall panorama candidates (sweeps 041–048) and the exact native E57
Image2D cubefaces for scans 40–47. The method is source-only and pose-blind for
the visual fit: it uses exact image pixels and T564's separately recovered
native cubeface bases, not stored E57 Image2D poses, filenames, capture order,
GPano metadata, room labels, generated pixels, or a deforming image warp.

This lane produces human-review proposals only. It does not accept a
correspondence, orientation, room membership, panorama pixel mask, camera pose,
E57-to-XGRIDS transform, training/reconstruction input, runtime package,
staging action, publication, or production trust.

## Frozen method

- Reviewed method commit:
  `c0f03f9b1c49fa9645bae2430fdc1bc00c317b51`.
- Runtime: isolated CPython 3.12 worker and exact dependency wheel closure
  inherited from T560, with one thread per numerical backend and network use
  disabled by the evidence contract.
- Correspondences: T560's unique SIFT ratio matches, rebound to exact source
  pixels and deterministic per-match identities.
- Validation: deterministic, face-balanced five-fold spherical rotation
  fitting. Every fold is held out from the model that scores it.
- Chirality: both scanner conventions are fitted independently. All five folds
  must select the same convention, and the aggregate result must agree.
- Coverage: at least 100 correspondences, 100 final inliers, 100 held-out
  inliers, and at least three cubefaces with six or more final inliers each.
- Review images: exact external panorama pixels beside a rigid spherical
  reprojection of the six exact native cubefaces. Checkerboards do not deform
  either source. Magenta denotes no native sample.
- Physical composition: only the eight primary scan candidates are composed
  with T564 and exact Data3D q/t. The scan-10 alternate is deliberately visible
  but has no composed E57 physical pose.

The fit first solves the improper display convention
`O = R * diag(1, -1, 1)`. It never serializes that improper matrix as a
quaternion. The physical camera rotation is composed separately as a proper
rotation, and all eight candidate E57 camera matrices have determinant one to
within `1.1102230246251565e-15`.

## Evidence-grade build

Run only from the exact reviewed commit and with the existing immutable local
evidence roots:

```powershell
$repo = 'C:\Users\blake\omnitwin2-grand-hall-exact-runtime'
$scripts = Join-Path $repo 'tools\twin-forge\e57-scripts'
$python = 'D:\venviewer-tools\t560-crosswalk-hermetic-py312-v2\Scripts\python.exe'
$builder = Join-Path $scripts 'build_grand_hall_panorama_e57_orientation.py'
$out = 'D:\venviewer-evidence\trades-hall-grand-hall-panorama-e57-orientation-v1'
$reviewed = 'c0f03f9b1c49fa9645bae2430fdc1bc00c317b51'

$env:PYTHONPATH = $null
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:MKL_NUM_THREADS = '1'
$env:NUMEXPR_NUM_THREADS = '1'
$env:OMP_NUM_THREADS = '1'
$env:OPENBLAS_NUM_THREADS = '1'
$env:TEMP = 'D:\venviewer-tools\t565-temp'
$env:TMP = 'D:\venviewer-tools\t565-temp'

& $python -I -S -B -X pycache_prefix=NUL $builder `
  --panorama-root 'F:\downloads (some very important)\TH Panoramic' `
  --panorama-manifest (Join-Path $repo 'docs\operations\grand-hall-t554-review-pack\panoramas\panorama-review-manifest-authority-none.json') `
  --image2d-evidence-root 'D:\venviewer-evidence\trades-hall-grand-hall-e57-image2d-v1' `
  --crosswalk-root 'D:\venviewer-evidence\trades-hall-grand-hall-panorama-image2d-crosswalk-v1' `
  --t561-root 'D:\venviewer-evidence\grand-hall-t561-panorama-visual-observation-pack-v1' `
  --t561-input (Join-Path $repo 'docs\operations\grand-hall-t561-panorama-visual-observations-input-authority-none.json') `
  --cubeface-extrinsics-root 'D:\venviewer-evidence\trades-hall-grand-hall-e57-cubeface-extrinsics-v1' `
  --camera-subset (Join-Path $repo 'docs\operations\grand-hall-camera-metric-subset-authority-none-v1.json') `
  --dependency-wheel-root 'D:\venviewer-tools\t560-wheelhouse-v1' `
  --repo-root $repo `
  --out $out `
  --reviewed-git-sha $reviewed `
  --verify-source-hashes
```

The output is no-replace and receipt-last. Never delete or replace this pack to
rerun the command; a changed method or input requires a separately reviewed,
versioned output path.

## Independent check

Run the identical command in a fresh process with `--check`. Check mode
re-verifies the exact source bindings, recomputes all nine pair derivations,
and proves the existing pack byte-for-byte without writing it:

```powershell
& $python -I -S -B -X pycache_prefix=NUL $builder `
  --panorama-root 'F:\downloads (some very important)\TH Panoramic' `
  --panorama-manifest (Join-Path $repo 'docs\operations\grand-hall-t554-review-pack\panoramas\panorama-review-manifest-authority-none.json') `
  --image2d-evidence-root 'D:\venviewer-evidence\trades-hall-grand-hall-e57-image2d-v1' `
  --crosswalk-root 'D:\venviewer-evidence\trades-hall-grand-hall-panorama-image2d-crosswalk-v1' `
  --t561-root 'D:\venviewer-evidence\grand-hall-t561-panorama-visual-observation-pack-v1' `
  --t561-input (Join-Path $repo 'docs\operations\grand-hall-t561-panorama-visual-observations-input-authority-none.json') `
  --cubeface-extrinsics-root 'D:\venviewer-evidence\trades-hall-grand-hall-e57-cubeface-extrinsics-v1' `
  --camera-subset (Join-Path $repo 'docs\operations\grand-hall-camera-metric-subset-authority-none-v1.json') `
  --dependency-wheel-root 'D:\venviewer-tools\t560-wheelhouse-v1' `
  --repo-root $repo `
  --out $out `
  --reviewed-git-sha $reviewed `
  --verify-source-hashes `
  --check
```

## Verified machine result

The receipt-last build and a separate full recomputation check both passed on
2026-09-01. The pack contains 12 files / 109,200,016 bytes, including ten
source-only PNG review aids.

- Result: 4,256,392 bytes, SHA-256
  `e191fe09cd2ca033d362a7a6fde154f1c5a02fe5d3c10978a16662e3e4da3325`.
- Receipt: 3,359 bytes, SHA-256
  `658326d6af128514ea02665ab94ab0cfe4581739c5fd4cb2f74670469de3251f`.
- Eight primaries: 6,187 / 6,343 held-out inliers
  (`97.54059593252404%`).
- All 40 primary held-out folds independently select the reflected scanner-Y
  display convention.
- Primary held-out all-match p95 errors span
  `0.5033705618769961°`–`0.7624861670195795°`.
- Primary held-out inlier p95 errors span
  `0.47453478013814687°`–`0.6991977804049688°`.

| Candidate | Matches | Final inliers | Held-out inliers | Held-out all p95 | State |
| --- | ---: | ---: | ---: | ---: | --- |
| sweep 041 ↔ scan 040 | 672 | 651 | 650 | 0.762486° | primary, human pending |
| sweep 042 ↔ scan 041 | 887 | 876 | 876 | 0.503371° | primary, human pending |
| sweep 043 ↔ scan 042 | 780 | 759 | 759 | 0.572104° | primary, human pending |
| sweep 044 ↔ scan 043 | 872 | 844 | 844 | 0.558324° | primary, human pending |
| sweep 045 ↔ scan 044 | 834 | 813 | 812 | 0.555577° | primary, human pending |
| sweep 046 ↔ scan 045 | 724 | 702 | 702 | 0.609293° | primary, human pending |
| sweep 047 ↔ scan 046 | 744 | 736 | 736 | 0.533639° | primary, human pending |
| sweep 048 ↔ scan 047 | 830 | 808 | 808 | 0.597899° | primary, human pending |
| sweep 047 ↔ scan 010 | 400 | 352 | 351 | 2.394461° | visible alternate, no physical pose, human pending |

Visual review confirms rigid agreement on the ceiling coffers and oculus,
chandeliers, portraits, fireplace, windows, timber panelling, doors, and floor.
The scan-10 alternate is a legitimate revisit with visibly different lighting
and greater parallax; it is not silently discarded or promoted. Yellow boxes
identify doorway/boundary attention areas only. They are not room masks or
architectural decisions.

## Human gates and next dependency

Every pair retains independent human gates for correspondence identity, camera
station, orientation, all-pixel room membership, and boundary masks. The exact
human options include accepting scan 46, accepting scan 10, retaining both as
unresolved revisits, rejecting both, or remaining unsure for sweep 047.

The repository preserves only the compact receipt. The 109 MB review/result
pack and all private source payloads remain local and unpushed. No source was
mutated; no generative model, network, provider, upload, staging, deployment,
publication, or production action occurred.
