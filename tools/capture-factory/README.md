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

pnpm --filter @omnitwin/capture-factory capture -- foundry-phase1 `
  --identity-review "C:\path\to\grand-hall-identity-review-v0.json" `
  --capture-stage "F:\VenviewerCaptureStaging\trades-hall-2026-07-10" `
  --colmap "F:\E57\colmap_v2" `
  --output "F:\VenviewerReconstructionWork\grand-hall-phase1" `
  --created-by "operator-id" `
  --created-at "2026-07-12T20:00:00.000Z"
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

## Grand Hall Foundry phase 1

`foundry-phase1` is a deliberately bounded, no-compute evidence command. It
requires the validated human identity-review artifact for decision B: Grand
Hall confirmed, with sweep 049 excluded as adjacent space. A missing, rejected,
or differently scoped review fails before an output directory is created.

The command accepts only:

- the Capture Factory stage whose manifest contains and authenticates
  `source/e57/cloud_0.e57`;
- exactly 300 JPEG cubefaces named `scan_000` through `scan_049`, with the six
  `back/down/front/left/right/up` faces for every sweep;
- `database.db` and the COLMAP binary model files `cameras.bin`, `images.bin`,
  `points3D.bin`, `frames.bin`, and `rigs.bin` under `sparse/0`;
- optional `sparse/project.ini`.

`database.db-wal`, `database.db-shm`, and `database.db-journal` are never
included. A nonempty WAL or any rollback journal fails closed because the
database is not a frozen input. Dense reconstruction, alternate sparse models,
output trees, and all other COLMAP files remain outside the bounded manifest.

Every accepted file is SHA-256 hashed through a mutation-detecting read. The
E57 digest must also match its existing Capture Factory stage manifest. Source
roots and every bounded path are canonicalized and rejected if they overlap the
output or traverse a symbolic link/junction/reparse point. The repository-owned
Python metadata probe and resolved interpreter are content-hashed, then invoked
with isolated Python, a minimal environment, bytecode writes disabled, shell
execution disabled, and a wall-clock deadline. Every input and both executable
components are rehashed after inspection before any artifact is emitted.

This is a trusted-local-operator boundary, not a sandbox against an attacker who
already controls the process environment or repository source. The supported
CLI and package-root API expose no Python/probe override; they resolve one
canonical interpreter from `PATH` and one canonical NumPy/pye57 user-site root,
then record the interpreter/probe digests. Operators must run from a trusted
account with trusted `PATH`/`APPDATA` state.

The final directory is built as a sibling temporary directory, its JSON files
are flushed, and it is atomically renamed only after every check succeeds. An
existing final directory is never resumed or replaced. It contains:

```text
identity-review.json
foundry-ingest-manifest-v0.json
foundry-phase1-bundle-v0.json
phase1-output-index.json
inspections/
  e57-inspection.json
  colmap-inspection.json
  raw/
    e57-probe-output.json
    colmap-probe-output.json
    alignment-probe-output.json
reports/
  colmap-to-e57-residual-report.json
  alignment-full-fit-residuals.json
  alignment-frozen-holdout-residuals.json
proposals/
  colmap-to-e57-transform.json
```

The frozen holdout is sweeps `[5, 15, 25, 35, 44]`; 44 of the 49 candidate
sweeps fit the held-out diagnostic. The full diagnostic fits and evaluates all 50 source
correspondences so the historical COLMAP-to-E57 result remains reproducible.
Sweep 049 can therefore remain diagnostic input while being explicitly
excluded from the Grand Hall room-identity selection.

The typed residual report records the E57 global metre/Z-up frame; COLMAP's
Hamilton `[w,x,y,z]` world-to-camera pose; right/down/forward camera axes;
`C=-R^Tt`; one equal weight per sweep; a proper, reflection-forbidden isotropic
Umeyama fit; column vectors and a column-major COLMAP-world-to-E57-global
matrix; linear percentiles; and no robust loss or outlier rejection. It also
records that geometric cloud overlap was not computed, independent surveyed
control is absent, E57 centres and COLMAP images share export lineage, no pixel
train/evaluation split exists because no image training or pixel evaluation ran,
and neither the identity-review sweeps nor self-consistency residuals confer
runtime or public authority.

Identity review, E57 inspection, COLMAP inspection, combined residual report,
and transform proposal use the shared phase-one schemas and domain-separated
self-digests. The bundle schema revalidates their cross-artifact hashes. Raw
probe envelopes are preserved separately so the bounded metadata evidence is
inspectable rather than reduced to summary counts.

All phase-1 transforms and residual reports are proposals, never reviewed
authority. The manifest has `legalReviewState: requires_review`. Matterport-
derived images are training-prohibited pending a written legal determination.
This command cannot train, dispatch compute, parse proprietary XGRIDS payloads,
publish, mutate sources, or call the downstream T-486 Reconstruction Foundry.

## Grand Hall offline T-486 preflight

`grand-hall-offline-review` prepares a digest-bound, tamper-evident evidence
preflight without creating a T-486 review or evidence-registration request.
The local directory is not claimed to be physically immutable or WORM:

```powershell
pnpm --filter @omnitwin/capture-factory capture -- grand-hall-offline-review `
  --phase1-package "C:\path\to\grand-hall-foundry-phase1" `
  --identity-overview "C:\path\to\identity-gate-overview.png" `
  --prepared-release "C:\path\to\trades-hall-prepared" `
  --prepared-source-manifest "C:\path\to\prepared-epoch\manifest.json" `
  --audit-report "C:\path\to\grand-hall-t507-independent-control-audit.md" `
  --audit-evidence "C:\path\to\grand-hall-t507-independent-control-evidence.json" `
  --gate-intake "C:\path\to\grand-hall-review-gate-intake.json" `
  --output "C:\path\to\grand-hall-t486-offline-preflight" `
  --created-by "operator-id" `
  --created-at "2026-07-13T10:30:00.000Z"
```

The command verifies the exact 13-file T-507 tree, every hash in the 12-file
phase-one index, every known phase-one JSON schema and semantic cross-reference,
all three successful bounded probe envelopes, the prepared release manifest and
QA contract, the exact prepared-epoch source manifest, their preparation-record
file hashes, PNG identity evidence, and the fail-closed audit/intake
classifications. It repeats those semantic and cross-epoch checks against the
copied tree before promotion and again after promotion, so validated source
bytes cannot be swapped during copying.

The result is built in a sibling temporary directory, rehashed, parsed against
`omnitwin.foundry.offline-review-package.v0`, checked for an exact file tree,
atomically promoted, and checked again. Existing final output is never resumed
or replaced.

Its subject is the frozen phase-one bundle. The prepared release and QA are
audit targets only. The current Grand Hall package has `evidenceReview=blocked`
because the complete identity-review pixels and their rights clearance are
absent. `publicApproval` is always `not_ready_offline`, `signing` is always
`not_ready_unsigned`, and authority is always `none`. The package has no T-486
decision, registered evidence reference, signature, publication or promotion
fields.
