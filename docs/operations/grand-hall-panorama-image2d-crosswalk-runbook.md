# Grand Hall panorama/Image2D candidate-crosswalk runbook

Date: 2026-08-26
Task: T-560
Status: **local authority-none build and independent check complete**
Authority: **none**
Method commit: `b04b4d2ae5093f1e6b2016b684c69187404571f3`

This workflow compares every one of the 148 supplied Matterport panorama JPEG
byte identities with all 149 native E57 `Data3D` identities from T-559. It
computes a complete 22,052-pair retrieval matrix, performs deterministic
spherical verification only for the frozen bidirectional shortlist, and emits
human-pending candidate matches.

It does not use panorama filenames, numeric sequence, GPano metadata, stored
E57 image poses, room labels, or generated content as correspondence evidence.
Its output cannot establish room membership, camera pose or orientation,
geometry, transform, a mask, training eligibility, reconstruction truth,
runtime admission, staging authority, public evidence, or production trust.

No API key, provider account, network access, generative model, image generator,
or video generator is needed.

## Exact frozen inputs

```text
Panorama root:
F:\downloads (some very important)\TH Panoramic

Panorama manifest:
C:\Users\blake\omnitwin2-grand-hall-exact-runtime\docs\operations\grand-hall-t554-review-pack\panoramas\panorama-review-manifest-authority-none.json

Native Image2D evidence:
D:\venviewer-evidence\trades-hall-grand-hall-e57-image2d-v1

Pinned wheelhouse:
D:\venviewer-tools\t560-wheelhouse-v1

Pinned interpreter:
D:\venviewer-tools\t560-crosswalk-hermetic-py312-v2\Scripts\python.exe

Historical cubeface-basis witness:
F:\E57\equirect_ss\_equirect_v2_report.json

Completed local output:
D:\venviewer-evidence\trades-hall-grand-hall-panorama-image2d-crosswalk-v1
```

The historical cubeface report is accepted only as the exact hash-bound witness
for the reviewed face-to-ray convention. It contributes no pixels, poses,
geometry, room truth, or architectural authority.

## Stop conditions

Stop without building if any condition below is true:

- the checked-out commit is not the reviewed commit supplied to the command;
- any generator, dependency lock, or bound cubeface extractor file is untracked
  or dirty;
- `PYTHONPATH` still exists, even with an empty value;
- the pinned interpreter, wheelhouse, source manifest, source images, T-559
  pack, or basis witness is missing or differs from its frozen identity;
- the output path already exists, overlaps an input, is on `C:`, or crosses a
  link/reparse boundary;
- another process or user may mutate the source/dependency trees during the
  run; or
- anyone intends to treat a candidate as accepted correspondence or as a way
  around T-554 through T-558.

A failed command is a safe result. Do not weaken a check or edit a digest to
obtain output.

## Step 1 — open PowerShell and define the exact paths

Run each block exactly:

```powershell
Set-Location 'C:\Users\blake\omnitwin2-grand-hall-exact-runtime'

$python = 'D:\venviewer-tools\t560-crosswalk-hermetic-py312-v2\Scripts\python.exe'
$panoramas = 'F:\downloads (some very important)\TH Panoramic'
$panoramaManifest = 'C:\Users\blake\omnitwin2-grand-hall-exact-runtime\docs\operations\grand-hall-t554-review-pack\panoramas\panorama-review-manifest-authority-none.json'
$image2d = 'D:\venviewer-evidence\trades-hall-grand-hall-e57-image2d-v1'
$wheels = 'D:\venviewer-tools\t560-wheelhouse-v1'
$basis = 'F:\E57\equirect_ss\_equirect_v2_report.json'
$out = 'D:\venviewer-evidence\trades-hall-grand-hall-panorama-image2d-crosswalk-v1'
$reviewed = (git rev-parse HEAD).Trim()

Remove-Item Env:PYTHONPATH -ErrorAction SilentlyContinue
```

Do not set `PYTHONPATH` to an empty string. Remove the variable.

## Step 2 — preflight without changing source data

```powershell
@($python, $panoramas, $panoramaManifest, $image2d, $wheels, $basis) |
  ForEach-Object { "$_ : $(Test-Path -LiteralPath $_)" }

"output exists: $(Test-Path -LiteralPath $out)"
"reviewed HEAD: $reviewed"

git status --porcelain=v1 --untracked-files=all -- `
  tools/twin-forge/e57-scripts/panorama_image2d_crosswalk.py `
  tools/twin-forge/e57-scripts/build_panorama_image2d_crosswalk.py `
  tools/twin-forge/e57-scripts/e57_image2d_evidence.py `
  tools/twin-forge/e57-scripts/e57_stage_guard.py `
  tools/twin-forge/e57-scripts/requirements-panorama-image2d-crosswalk.lock.json `
  tools/twin-forge/e57-scripts/extract_equirect_v2.py
```

Every required path must print `True`, `output exists` must print `False`, the
reviewed value must be a 40-character lowercase Git SHA, and the final Git
status command must print nothing.

## Step 3 — run the isolated test boundary

Run tests only through the reviewed test entry point and from the scripts
directory:

```powershell
Push-Location 'tools\twin-forge\e57-scripts'

$env:CROSSWALK_WHEEL_ROOT = $wheels
$env:E57_EVIDENCE_TEST_TMP = 'D:\codex-t560-test-tmp'
$env:TEMP = 'D:\codex-t560-test-tmp'
$env:TMP = 'D:\codex-t560-test-tmp'

& $python -I -S -B -X pycache_prefix=NUL `
  tests\run_isolated_unittest.py `
  tests.test_build_panorama_image2d_crosswalk `
  tests.test_panorama_image2d_crosswalk -v

Pop-Location
```

Generic `python`, activation-only invocation, `python -B`, `python -m unittest`,
or omission of `-I`, `-S`, `-B`, or `-X pycache_prefix=NUL` is unsupported.
The explicit module order is intentional: the production import gate must run
before the already-bound core module. Generic discovery inserts a test path
before that gate and is correctly rejected.

## Step 4 — build the new no-replace local pack

```powershell
& $python -I -S -B -X pycache_prefix=NUL `
  tools\twin-forge\e57-scripts\build_panorama_image2d_crosswalk.py `
  --panorama-root $panoramas `
  --panorama-manifest $panoramaManifest `
  --image2d-evidence-root $image2d `
  --out $out `
  --dependency-wheel-root $wheels `
  --reviewed-git-sha $reviewed `
  --cube-basis-report $basis `
  --verify-source-hashes
```

The expected terminal line is:

```text
Authority-none crosswalk verified: 148 panoramas x 149 Data3D identities.
```

The command decodes and hashes the exact inputs, derives all features and
scores, rechecks custody and provenance, writes a hidden sibling stage, verifies
it, writes `publication-receipt.json` last, renames it to the new output path,
and verifies the final directory. Here, “publication” means only local
receipt-last completion. It does not mean upload, cloud/public publication,
registration, deployment, or runtime activation.

## Step 5 — run the independent full recomputation check

Do not reuse in-memory results from the build. Start a new process:

```powershell
& $python -I -S -B -X pycache_prefix=NUL `
  tools\twin-forge\e57-scripts\build_panorama_image2d_crosswalk.py `
  --panorama-root $panoramas `
  --panorama-manifest $panoramaManifest `
  --image2d-evidence-root $image2d `
  --out $out `
  --dependency-wheel-root $wheels `
  --reviewed-git-sha $reviewed `
  --cube-basis-report $basis `
  --verify-source-hashes `
  --check
```

This must independently recompute the complete matrix and shortlisted geometric
diagnostics, require byte-identical canonical manifests, verify the receipt and
exact file inventory, and finish with the same success line.

## Output shape and review boundary

A complete local pack contains exactly:

- `candidate-score-matrix-authority-none.json`;
- `panorama-image2d-crosswalk-authority-none.json`; and
- `publication-receipt.json`, written last.

All three files retain `authority: "none"`. Candidate rows are display aids for
original-resolution human review. They cannot select Grand Hall panoramas,
approve masks, establish camera geometry, authorize reconstruction, or admit a
runtime package.

## Worker security boundary

This is a pinned, isolated, fail-closed same-host worker, not a hostile-user
sandbox or a completely read-only filesystem. It holds all dependency paths
that existed at binding time against write/delete and allowlists Python import
origins from verified wheel members. Windows still permits new child creation
under those directories, so end-of-run re-attestation detects persistent drift.
Native DLL/config race isolation is not comprehensive. Network is unused but is
not denied by an operating-system sandbox. Do not run beside an untrusted or
concurrent writer.

## Current completion state

The implementation is frozen at the method commit shown above. The real build
ran from reviewed clean commit
`9db0eb25bf662262ced313b73de7797835ee33f2`; a separate process then recomputed
the complete result and strictly verified the existing pack. Both commands
ended with the exact 148×149 success line.

The complete pack contains three files:

- matrix: 4,773,324 bytes,
  `sha256:7fc8c34eefda10890e462180fb59c9ffb8c9d7a4bfe56afdee5c1752c8b3bc36`;
- crosswalk: 2,025,532 bytes,
  `sha256:3b0a7757395904233e5fa1436dfe68c0a0daa9539c48ef079f70dde528c82215`;
  and
- terminal receipt: 3,222 bytes,
  `sha256:219d5c79512844d3c078871433010447052e7f5e770d74a0da3acf714f62153d`.

The crosswalk records 146 unique `candidate_human_pending` rows, two
`ambiguous_human_pending` rows (`sweep_078jpg.jpg` and
`sweep_079jpg.jpg`), and zero `no_supported_candidate` rows. All 148 rows
require human review. The repository preserves only the small terminal receipt
at [`grand-hall-panorama-image2d-crosswalk-v1.json`](./grand-hall-panorama-image2d-crosswalk-v1.json);
the 6.8 MB payload remains local and unpushed. T-560 is complete only at this
authority-none candidate-evidence boundary.

Because the v1 output now exists and is no-replace, any authorized repeat build
must use a new versioned sibling rather than deleting or overwriting v1.
