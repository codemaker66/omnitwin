# Venviewer Capture Factory

The Capture Factory creates a deterministic, verified intake boundary between an
untouched capture delivery and downstream reconstruction. It never edits,
renames, deletes, or creates files under the source root.

## Commands

```powershell
pnpm --filter @omnitwin/capture-factory capture -- inspect `
  --source "F:\E57" `
  --report "F:\VenviewerCaptureStaging\trades-hall-2026-07-10\inspection.json"

pnpm --filter @omnitwin/capture-factory capture -- stage `
  --source "F:\E57" `
  --staging "F:\VenviewerCaptureStaging\trades-hall-2026-07-10"
```

`inspect` inventories every regular file, records magic-derived formats and
metadata, classifies provenance, and SHA-256 hashes every file selected for the
copy plan. `--hash-all` additionally hashes excluded and reference-only files.
Without `--report`, the deterministic JSON inspection is written to stdout.

`stage` independently repeats inspection and hashing before it copies anything.
It rejects a staging tree that overlaps the source tree. The minimal staged
shape is:

```text
source/
  e57/
    cloud_0.e57
  matterpak/
    <unaltered vendor control files>
capture-stage-manifest.json
capture-intake-inspection.json
```

Every copy first lands at
`<target>.partial-<first-16-characters-of-sha256>`. A complete matching partial
is resumed by verification and atomic rename. A mismatching controlled partial
is discarded and recopied. Existing final files are never overwritten: a
matching final is skipped, while a mismatch fails closed. The manifest is also
immutable and content-verified.

The full classification ledger is written immutably before copying starts. The
stage manifest appears only after every planned target has passed size and
SHA-256 verification. An operator can therefore distinguish `inspected` from
`staged` without re-reading the evidence drive.

## Conservative classification

- Valid ASTM E57 files are primary capture sources.
- GUID-named MatterPak OBJ/MTL/textures and standard MatterPak sidecars are
  vendor controls.
- Names containing `aligned`, `edited`, `fixed`, `repair`, `converted`, or `rc`
  are treated as edited experiments before vendor-control rules run.
- COLMAP, Brush, panorama, cubemap, and equirect trees are derived outputs.
- `poses.json`, root design references, and `equirect_fixed` are reference-only.
- Unknown provenance is excluded. The factory never guesses a file into truth.

The factory stages bytes and provenance evidence only. It does not claim survey
accuracy, reconstruct geometry, train a splat, or promote an asset to runtime.
