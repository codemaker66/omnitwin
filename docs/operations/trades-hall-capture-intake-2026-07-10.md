# Trades Hall capture intake — 2026-07-10

Status: internal candidate-source classification. This record does not promote,
sign, certify, or publish a runtime asset.

## Source boundary

- Source directory was inspected read-only: `F:\E57`.
- The directory contained 9,364 files in 64 directories (83.435 GiB total).
- Staging must remain outside `F:\E57`; source files must never be renamed,
  rewritten, or timestamp-normalised in place.

## Primary source

`cloud_0.e57` is the primary capture source with high classification confidence.

- Size: 20,518,437,888 bytes.
- SHA-256: `975039d11fc04ca681f038e499f358124bbcab178ad5ce6324fa912212729cdd`.
- Container: ASTM E57 version 1.0; declared physical length equals the file size.
- Capture: 149 Matterport Pro3 sweeps from device serial `Q35340241`.
- Structured points: 6,480,000 per sweep; 965,520,000 total.
- Fields present: XYZ, invalid-state, row, column, RGB.
- Images: 894 embedded 4096 × 4096 pinhole JPEG blobs, six per sweep, linked by GUID.
- Embedded photo payload: 2,927,438,001 bytes; all 894 blobs have valid JPEG
  SOI/EOI boundaries and none were truncated by that boundary check.
- Root E57 GUID: `424ff41f6e5d41969c635fcd61be9b3f`.

These facts establish file identity and container structure. They do not establish
survey accuracy, runtime alignment, public-exposure suitability, or operational
fitness.

## Secondary vendor source

The original contents of `th obj` form a secondary vendor export with high
classification confidence: the original OBJ/MTL, 144 textures, `cloud.xyz`, plan
files, readme, and `rsmeta` share the vendor GUID naming and February 2026 source
timestamps.

`TH_OBJ_RC_ALIGNED.obj` is excluded from the source stage. Its later timestamp,
different size, and alignment-specific name identify it as a later edited
derivative.

A structural comparison confirms that classification: it has the same 237,561
vertices, 531,888 UVs, 474,049 faces, groups, and material assignments as the
original OBJ, and an identical digest when vertex lines are excluded. Its
vertices are a single rigid transform of the original (fit RMSE 5.0e-9 m), with
translation `[-6.43710656, +0.60270026, +3.88866646]` m and approximately 0.9°
rotation. This alignment may be retained as unreviewed reference evidence, but
it is not an independent source mesh.

## Derived and experimental material

The following remain outside the truth-source stage:

- `panoramas`, `cubemaps*`, `equirect*`, `brush_dataset`, and `colmap_*`;
- root-level extracted poses, scripts, diagnostic images, band/zoom/raw probes;
- `th.nwc` and `th.png`;
- the later `TH_OBJ_RC_ALIGNED.obj` derivative.

Repository scripts name these paths as generated outputs. One extraction script
also records that an earlier pose interpretation was found to be incorrect.
They may be retained as quarantined reference material, but they are not inputs
to the new candidate truth bundle.

## Staging decision

The minimal immutable candidate stage is:

1. `source/e57/cloud_0.e57`;
2. `source/matterpak/**` containing the original vendor package, excluding
   `TH_OBJ_RC_ALIGNED.obj`;
3. a freshly generated inventory, copy plan, hash ledger, and verified stage
   manifest.

The selected vendor-control subset contains 155 files / 1,759,056,988 bytes.
Its canonical sorted hash-index digest is
`06ff00550ff72865e26d32aa768121262d2237b07db712901a1e19e007436e06`.
There are no duplicate content hashes within that subset.

Key vendor-source identities:

- original OBJ: `cf7247b5343fe719dc0f1aaf6b64c667d238c69133b71c44ccd9f5c67b5878c7`;
- original MTL: `8e43085c90e40e2e76b7e221038c13bd65f17893a3d097eb12ffea5445f85d7a`;
- `cloud.xyz`: `a1e5fc55f62897e4cd08851f4e7e07e3949cc8e1894fbc6c02d029863b821144`;
- excluded aligned OBJ: `394f17f42d131669ff1667814b8801e25b576a3a37193be6bdb5c66bdb7f3fbf`.

Every copied file must be streamed to a partial path, verified by size and
SHA-256, then atomically promoted within the staging filesystem. Re-running the
stage must verify and reuse matching files. A mismatch must fail closed rather
than overwrite the staged file.

## Executed stage

The factory completed a real non-destructive stage at
`F:\VenviewerCaptureStaging\trades-hall-2026-07-10`:

- 156 selected files: one primary E57 and 155 vendor-control files;
- 22,277,494,876 staged payload bytes;
- copy-plan SHA-256:
  `d9a75df3ffaf2706d97f454cbfae9a5c47ce0719c83af7f56da391ce0def3729`;
- the E57 was resumed from its digest-addressed partial after complete
  verification; 155 vendor controls were copied and verified;
- `capture-stage-manifest.json` was written immutably.

The factory's idempotent follow-up pass wrote the matching immutable
`capture-intake-inspection.json` classification ledger and reused every
existing final target without recopying payload bytes. The protected operator
service then read both real ledgers, stat-verified all 156 contained regular
targets and exact byte sizes, and returned `staged` / `consistent` /
`intake_verified`. That fast status read does not replace the full SHA-256
verification performed by the sealed factory run.

Final ledger identities:

- inspection ledger SHA-256:
  `368a4fc7799470feadac5820485854b9093c8b7de2f5ab2fc2288f2777c815c8`;
- stage manifest SHA-256:
  `c044823c232dae518df84140c90004a1c17dc682c84885d6f36848933d72ddff`;
- remaining digest-addressed partial files: zero.

## Gates that remain open

- coordinate-control and runtime-transform review;
- derived runtime-asset generation from the staged sources;
- visual/runtime QA against the accepted transform;
- signing, registry promotion, or public exposure.

Those decisions remain subject to the existing artifact-factory, runtime QA,
and human-review gates.
