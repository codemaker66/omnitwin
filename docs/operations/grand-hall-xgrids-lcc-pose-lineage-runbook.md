# Grand Hall XGRIDS/LCC pose-lineage receipt

## Purpose

This lane records one deterministic, authority-none relationship between the
exact raw XGRIDS `poses.csv` sidecar and the `poses.json` sidecar shared by all
nine processed BIG packages. It does not decode the XBIN, rerun LCC, accept a
camera, or establish a metric transform.

The immutable checked receipt is:

- `docs/operations/grand-hall-xgrids-lcc-pose-lineage-authority-none-v1.json`
- schema `venviewer.grand-hall.xgrids-lcc-pose-lineage-authority-none.v1`
- bundle SHA-256
  `sha256:11d5540cf2a22cc8e3c3c2386cd5236cf1d115b2276b0eddc1a58ede2f5f2aec`

## Exact inputs

The operator supplies absolute local paths. No absolute source path is copied
into the receipt.

| Input | Frozen evidence identity |
| --- | --- |
| Raw `project_data/poses.csv` | 3,659,287 bytes; `sha256:b86bc45d15b8b5a84d61160afe3e16e7659e195557a2b8c6567039bb74d83127` |
| Reviewed processed inventory | 111,881 bytes; `sha256:f49e04740f11d1d802babcb90995b3e083d91608beba1d0310f76dddc028ebfd` |
| Each of nine processed `poses.json` sidecars | 2,561,254 bytes; `sha256:7a020e5f1cc00029ce773d1f448804fa1b7f16355412b023320975122556418d` |
| Each of nine processed `report.json` sidecars | 607 bytes; `sha256:4ebe53c9de2c59a34d5748157f3581acc929d59f75680f6b1cb15aa2944165cb` |

The raw sidecar identity comes from
`GRAND_HALL_XGRIDS_SOURCE_POLICY_V1`. This lane reads that exact sidecar but
does not rehash the 41 GB XBIN or claim a fresh full-tree preflight. The receipt
therefore fixes `fullTreeReverifiedByThisReceipt` to `false`.

The reviewed inventory remains the authority-none packaging/member identity
receipt. This lane checks its byte identity, canonical JSON, semantic inventory
digest, manifest digest, and all 18 relevant source members.

## Custody and parsing rules

The tool:

1. accepts only absolute, traversal-free, local, non-device paths;
2. rejects symbolic links, indirect real paths, hard-linked files, non-files,
   oversized files, and descriptor/path identity races;
3. reads every input through one open descriptor, checks exact length and
   trailing EOF, then checks descriptor and path metadata again;
4. hashes the exact stable bytes and compares them with the frozen identities;
5. parses raw CSV as LF-only fatal UTF-8 with exactly eight bounded decimal
   columns and strictly increasing timestamps;
6. parses processed poses as strict JSON with finite three-value translations,
   finite non-zero four-value rotation tuples, null `RGB`, null `fusionPoses`,
   and strictly increasing timestamps;
7. re-reads and re-hashes every source after all numerical work; and
8. writes the receipt with create-new/no-replace semantics. Check mode requires
   byte-exact canonical regeneration.

No source write or network operation is performed.

## Generate once

Run from the repository root. The output path must not already exist.

```powershell
pnpm --filter @omnitwin/reconstruction-foundry-cli grand-hall-xgrids-lcc-pose-lineage -- `
  --raw-root "F:\gaussian splat -- xgrids\model\The_Grand_Hall_2026-05-31-101837" `
  --processed-root "C:\GRAND_HALL_BIG_MODEL_VARIATIONS" `
  --inventory "C:\Users\blake\omnitwin2-grand-hall-exact-runtime\docs\operations\grand-hall-processed-big-inventory-v1.json" `
  --out "C:\Users\blake\omnitwin2-grand-hall-exact-runtime\docs\operations\grand-hall-xgrids-lcc-pose-lineage-authority-none-v1.json"
```

The successful initial run reports `written_no_replace`.

## Check exact regeneration

```powershell
pnpm --filter @omnitwin/reconstruction-foundry-cli grand-hall-xgrids-lcc-pose-lineage -- `
  --check `
  --raw-root "F:\gaussian splat -- xgrids\model\The_Grand_Hall_2026-05-31-101837" `
  --processed-root "C:\GRAND_HALL_BIG_MODEL_VARIATIONS" `
  --inventory "C:\Users\blake\omnitwin2-grand-hall-exact-runtime\docs\operations\grand-hall-processed-big-inventory-v1.json" `
  --out "C:\Users\blake\omnitwin2-grand-hall-exact-runtime\docs\operations\grand-hall-xgrids-lcc-pose-lineage-authority-none-v1.json"
```

The successful check reports `checked_exact_regeneration` and the frozen bundle
SHA above. A mismatch or source race exits non-zero and does not replace output.

## Recorded diagnostic evidence

### Timestamp pairing

The tool pairs every processed timestamp with the nearest raw timestamp, breaks
an exact tie toward the lower raw index, and requires raw indices to remain
strictly increasing.

- raw rows: 42,850
- processed rows and pairs: 21,417
- first/last raw indices: 1 / 42,830
- raw-index increments: five increments of 1, 21,409 of 2, and two of 3
- absolute timestamp delta: 6 ns minimum, 22,552,044 ns median,
  22,918,735.13428585 ns population mean, 47,226,050 ns nearest-rank p95,
  and 51,429,034 ns maximum
- complete pair-table digest:
  `sha256:f2d3bdd037f5124221c7f0d1669cd2a83dacbbc6c2014bf653202ef2b2e22e37`

This is strong evidence that the processed trajectory descends from the raw
capture timeline. It is still labelled a lineage candidate because this lane
does not independently establish the vendor's pose semantics.

### Rotation-tuple permutations

All 24 permutations of the four raw tuple columns are normalized and compared
with each normalized processed rotation tuple using sign-invariant quaternion
geodesic angle. Every complete residual vector has its own digest.

`wxyz` is the uniquely best component-ordering candidate. Its mean separation
from runner-up `xwzy` is 28.520149415 degrees. These labels describe a tested
component permutation only. They do not accept that either tuple is an optical
camera orientation or that its direction, axes, handedness, or body extrinsic
are known.

### Diagnostic similarity fit

The fit uses raw columns 1–3 as unaccepted source coordinates and processed `T`
as unaccepted target coordinates. Before fitting, every processed index whose
index modulo five is zero is frozen as held-out evidence.

- fit rows: 17,133
- held-out rows: 4,284
- diagnostic scale: 0.993092104965
- fit RMSE: 0.575651034 unaccepted source-coordinate units
- held-out RMSE: 0.576024118 unaccepted source-coordinate units
- held-out p95: 1.247584192 unaccepted source-coordinate units
- held-out maximum: 1.69630138 unaccepted source-coordinate units

The held-out residual is far too large for an operational venue transform. The
receipt consequently treats this result as evidence that raw and processed
positions are not directly interchangeable, not as a transform candidate for
promotion.

## What this receipt proves

- The exact raw sidecar and every processed package carry a highly specific,
  monotonic timestamped trajectory relationship.
- All nine processed packages bind the same processed pose and report bytes.
- `wxyz` is the uniquely best tested raw-component permutation relative to the
  processed tuple.
- Processed pose index 19,890 now has an exact, source-bound rotation-tuple
  candidate for a later controlled diagnostic.
- A simple raw-to-processed similarity alignment does not meet metric use.

## What it does not prove

It does not prove or accept:

- optical camera orientation, pose direction, axes, handedness, or a
  body-to-camera extrinsic;
- camera intrinsics or field of view;
- metric units or any operational coordinate transform;
- an E57/MatterPak-to-XGRIDS transform;
- exact Grand Hall membership, boundary masks, interfaces, or selection volume;
- completion of T-554, T-555, or T-557; or
- permission for training, reconstruction, provider transfer, runtime, staging,
  publication, or production trust.

Every corresponding boolean is a schema-level literal `false`. Changing one to
`true` invalidates the receipt before self-digest verification.

## Focused verification

```powershell
pnpm --filter @omnitwin/reconstruction-foundry-cli exec vitest run src/__tests__/grand-hall-xgrids-lcc-pose-lineage.test.ts
pnpm --filter @omnitwin/reconstruction-foundry-cli typecheck
pnpm --filter @omnitwin/reconstruction-foundry-cli lint
pnpm --filter @omnitwin/reconstruction-foundry-cli build
git diff --check
```
