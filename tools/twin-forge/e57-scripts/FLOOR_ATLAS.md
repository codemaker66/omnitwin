# Floor Atlas v1

Floor Atlas fuses many world-oriented equirectangular panoramas onto one
metric floor plane. The result is a photographic orthophoto plus an exact
per-pixel contributor-count raster. A second raster preserves all geometrically
eligible pre-rejection observations. `atlas_project.py` can then read the same
surface back into each panorama's nadir using final contributor support.

This lane is experimental and has `authority: none`. The transform is a
deterministic fusion and adds no model-generated pixels, but the generic CLI
does not yet inherit an upstream capture truth record. It therefore labels
source truth `unknown_unverified` and the output
`inferred_from_unverified_sources`. It is planning-grade—not survey geometry.
Missing coverage remains missing; a zero in the contributor raster means the
delivered atlas pixel has no retained source-image support.

## Tested direct dependency set

The direct package versions observed in the focused v1 test environment are
listed in `requirements-floor-atlas-tested.txt`:

- Python 3.13
- NumPy 2.4.2
- Pillow 12.0.0
- pye57 0.4.19
- SciPy 1.17.0
- trimesh 4.11.2
- jsonschema 4.26.0

The focused suite was run in one Python 3.13 environment containing all of
these versions. Install the declared direct set before using the CLI or
verifier:

```powershell
py -3.13 -m pip install -r `
  tools/twin-forge/e57-scripts/requirements-floor-atlas-tested.txt
```

`trimesh` is exercised when `--mesh` supplies an occlusion mesh; the committed
CLI regression uses a generated GLB, not a reviewed room mesh. This
requirements file is not a full transitive lock: Python patch level, platform
wheels, image codecs, transitives, and dependency hashes remain outside it.

## Build

```powershell
py -3.13 -B tools/twin-forge/e57-scripts/floor_atlas_build.py `
  --equirect F:/E57/equirect_fixed `
  --manifest path/to/twin/manifest.json `
  --out path/to/floor-atlas-run `
  --bounds 8.4 -4.5 22 18 `
  --mm-per-px 8 `
  --z-floor 0.0 `
  --label grand-hall
```

`--bounds` is `CENTRE_X CENTRE_Y WIDTH_M HEIGHT_M` in the manifest's world
frame. Supplying an explicit, reviewed `--z-floor` is preferable. Without it,
the CLI uses the selected scanner-storey z minus 1.5 m and records that
derivation rather than presenting it as measured. `--z-floor` controls the
plane, not source-storey selection. If multiple manifest floors or scanner-z
clusters occur inside the radius, the CLI refuses until `--floor-id` or
`--storey-z` selects one explicitly.

`--manifest` accepts either the forged bundle's `nodes[]` structure or the
older E57 `poses.json` map whose numeric keys carry `translation`. The report
records which adapter was used; neither adapter upgrades source truth.

Alignment and incidence-binned colour harmonisation are off by default. They
must be explicitly requested with `--align` and `--harmonise`. Both mechanisms
pass synthetic regressions, including a clean-input no-degradation check, but
they do not yet have a digest-backed real-room A/B acceptance artifact.

## Outputs

For label `<room>`, the CLI writes:

- `<room>-atlas.png` — fused RGB orthophoto;
- `<room>-coverage.png` — human preview clipped at 12 observations;
- `<room>-counts.npy` — lossless `uint32` final contributor counts required by
  `atlas_project.py`; pixels that fall back to the ungated mean restore their
  eligible contributors explicitly;
- `<room>-retained-counts.npy` — lossless `uint32` samples retained by the
  robust gate before any all-rejected fallback;
- `<room>-eligible-counts.npy` — lossless `uint32` geometrically eligible,
  pre-rejection counts for audit;
- `<room>-atlas-report.json` — schema-versioned run record.

The run record binds the manifest, every selected panorama, optional mesh,
tool source files, tested direct requirements, schema, and five output artifacts
by SHA-256 and byte length. It also records camera centres, image dimensions,
effective fusion options, runtime package versions, node-keyed alignment
scores/refusals, and a precisely labelled Python-canonical payload digest. The
report schema is
`schemas/floor-atlas-run-v1.schema.json`.

`PASS_FLOOR_ATLAS_RUN_INTEGRITY` means the local files, linked schema, report
digest, selection, geometry, diagnostics, and sample-accounting contract agree.
It is consistency evidence, not proof of origin, capture truth, visual quality,
or human acceptance. The builder refuses any planned output that aliases a
read-only input and refuses to write inside the panorama tree.

## Focused verification

```powershell
py -3.13 -B tools/twin-forge/e57-scripts/tests/test_floor_atlas.py
py -3.13 -B tools/twin-forge/e57-scripts/tests/test_floor_atlas_build.py
py -3.13 -B tools/twin-forge/e57-scripts/tests/test_atlas_project.py
py -3.13 -B tools/twin-forge/e57-scripts/tests/test_nadir_geometry.py
py -3.13 -B tools/twin-forge/e57-scripts/tests/test_nadir_synthetic.py
py -3.13 -B tools/twin-forge/e57-scripts/tests/test_nadir_vs_extractor.py
py -3.13 -B tools/twin-forge/e57-scripts/verify_floor_atlas_run.py `
  path/to/<room>-atlas-report.json
```

## Known limits

- One run assumes one planar floor z. Steps, ramps, warped boards, and
  multi-level regions need separate surfaces or a richer geometry model.
- Camera poses, coordinate frame, panorama orientation, and floor z remain
  upstream responsibilities.
- The alignment and harmonisation opt-ins are mechanism-proven only.
- Lazy panorama loaders decode each source twice by default, three times with
  harmonisation, four times with alignment, and five times with both. The CLI
  rehashes every frozen input before emitting outputs and refuses source drift.
- The committed wire-back is a Python library, not yet an auditable batch CLI.
- No output becomes metric, visual, or evidence authority without human review
  and the Foundry's normal package/review adapters.
