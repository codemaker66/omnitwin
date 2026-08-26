# Grand Hall native E57 Image2D byte-lineage evidence runbook

Date: 2026-08-26
Task: T-559
Status: **local authority-none extraction and independent check complete**
Authority: **none**

This runbook extracts the exact native JPEG blobs embedded in the verified
Trades Hall E57 and binds each blob to its exact E57 `Image2D` node and
`associatedData3DGuid`. It writes the original JPEG bytes without decoding and
re-encoding them. A full decode is still required as an integrity check.

The resulting pack is evidence of internal E57 byte lineage only. It does not
establish an external Matterport panorama crosswalk, camera orientation, pose,
room membership, architectural geometry, a panorama mask, training eligibility,
reconstruction authority, runtime authority, or production trust.

No API key, hosted service, generative model, generated fill, or network access
is part of this workflow.

## Exact source profile

The implementation accepts only the verified Grand Hall source profile:

- E57 byte length: `20,518,437,888`;
- E57 SHA-256:
  `975039d11fc04ca681f038e499f358124bbcab178ad5ce6324fa912212729cdd`;
- `data3D` records: `149`;
- `images2D` records: `894`;
- images per `data3D` record: `6`;
- image representation: exactly `pinholeRepresentation`;
- embedded blob: exactly one `jpegImage`;
- decoded dimensions: exactly `4096x4096` per JPEG; and
- aggregate native JPEG bytes: exactly `2,927,438,001`.

Each image must retain native `images2D` vector order, a unique image GUID, an
exact `Skybox 0` through `Skybox 5` name, and an
`associatedData3DGuid` that resolves to exactly one of the 149 unique
`data3D` GUIDs. Every scan must have every face exactly once.

The implementation does not read or use the stored per-image pose. Its
manifest records `storedImagePoseHandling` as
`not_read_not_used_no_authority`.

## What a completed pack proves

A passing pack proves this chain inside one exact E57 container:

`verified E57 bytes -> native Image2D vector record -> exact embedded JPEG bytes -> associatedData3DGuid -> exact data3D GUID/index`

For every JPEG, the manifest records:

- native `Image2D` index, GUID, name, and derived face index;
- exact associated `data3D` GUID and native scan index;
- representation and blob kind;
- E57 intrinsics as stored;
- decoded dimensions and colour mode;
- canonical relative output path;
- exact byte length and SHA-256; and
- the unchanged source-stage plan and E57 identities.

The pack is deliberately authority-none. The native association proves which
embedded image belongs to which E57 scan record; it does not prove what room
the image depicts or how it aligns with any separately exported panorama.

## External panorama boundary

The command never reads `F:\downloads (some very important)\TH Panoramic`.
No `sweep_*.jpg` filename, digit token, GPano field, visual resemblance, or
apparent one-based/zero-based ordering becomes E57 byte lineage.

The external panorama-to-E57 mapping remains unresolved. T-560 owns a separate
authority-none content-matching crosswalk whose outputs remain human-pending;
it must not infer correspondence from sequence, filenames, GPano metadata, or
stored image poses, and it cannot establish geometric registration or room
membership.

Later visual-scope observations remain separate from E57 identity. At the
model's 2048x1024 display resolution, authority-none agents observed Grand Hall
pixels in sweeps 001-061, 065-075, and 148-149 (74 exact source files), and
observed no Grand Hall pixels in sweeps 062-064, 076-092, and 094-147 (74 exact
source files). Numeric sweep 093 is absent from the exact 148-file inventory,
not unresolved. The audit recorded zero agent uncertainty flags, but
`nativeResolutionHumanReviewCompleted=false`.

These are not panorama-to-E57 mappings, camera-location classifications,
human `INCLUDE`/`EXCLUDE` decisions, `measured_empty`, accepted T-554 evidence,
or masks. Their authority is `none`, all 148 sources remain human-pending, and
native 8192x4096 human review plus exact masks for every human-included source
remain required. None of this changes or weakens the completed T-559 byte
lineage evidence.

## Stop conditions

Stop without publishing if any of these is true:

- the input is a mutable historical E57 rather than the verified capture stage;
- the stage identity differs from the exact source profile above;
- the output path already exists, overlaps the stage, or is inside it;
- the output is on `C:` rather than a spacious disjoint `D:` or `F:` work root;
- the operator cannot allow two complete source hashes, one before and one
  after extraction;
- any `data3D` or `Image2D` count, GUID, association, face, representation,
  blob kind, dimension, intrinsic, aggregate byte count, or JPEG decode differs
  from the strict profile;
- a symlink, junction, reparse directory, unexpected file, duplicate path, or
  non-regular file appears in the evidence root; or
- anyone intends to treat the result as pose, transform, room, mask,
  reconstruction, training, structural, collision, export, public, or runtime
  authority.

An extraction failure is a safe result. Do not weaken a check or force a
publication to obtain output.

## Step 1 - Open PowerShell and select disjoint paths

Run these lines one at a time:

```powershell
Set-Location 'C:\Users\blake\omnitwin2-grand-hall-exact-runtime'
$stage = 'F:\VenviewerCaptureStaging\trades-hall-2026-07-10'
$out = 'D:\venviewer-evidence\trades-hall-grand-hall-e57-image2d-v1'
Test-Path -LiteralPath $stage
Test-Path -LiteralPath $out
```

The stage check must print `True`. The output check must print `False`. If the
output already exists, choose a new versioned sibling; the command never
replaces existing evidence.

Keep the output on `F:` or another spacious non-`C:` work drive. The JPEG
payload alone is exactly 2,927,438,001 bytes, before manifests and filesystem
overhead.

## Step 2 - Confirm the local read-only dependencies

```powershell
python -B -c "import pye57; from PIL import Image; print('pye57 and Pillow available')"
```

The command must print `pye57 and Pillow available`. `-B` prevents Python
bytecode-cache writes.

## Step 3 - Extract the authority-none pack

```powershell
python -B tools\twin-forge\e57-scripts\extract_e57_image2d_evidence.py `
  --stage "$stage" `
  --out "$out" `
  --verify-source-hash
```

`--verify-source-hash` is mandatory acknowledgement of the two full E57 hash
passes. The implementation:

1. loads the verified stage manifest and checks the strict source identity;
2. snapshots and hashes the complete E57 before extraction;
3. streams each native embedded JPEG blob from E57 in vector order;
4. validates SOI/EOI markers and fully decodes the JPEG without re-encoding;
5. writes the exact bytes to a new hidden staging directory beside `$out`;
6. validates all 894 records, associations, faces, dimensions, and aggregate
   bytes;
7. closes the E57 and hashes the complete source again, rejecting any metadata
   or byte drift;
8. writes the canonical manifest and terminal receipt;
9. strictly re-verifies the complete staged evidence pack; and
10. renames the completed staging directory to `$out` only after
    `publication-receipt.json` exists.

The success line is exactly shaped as:

```text
E57 Image2D evidence verified: 149 scans, 894 exact JPEGs, 2927438001 bytes.
```

The real extraction completed on 2026-08-26 with the exact success line above.
It published 896 files / 2,928,101,752 total bytes, including 894 JPEGs / exactly
2,927,438,001 JPEG bytes. The canonical manifest is 663,151 bytes at
`sha256:fd13da9638d1a1e194fb0c1acaedbe07dea15e65d9c16353d29f6542ce3ad344`.
The terminal receipt is 600 bytes at
`sha256:a19b4058ab6006744184101d0b8287f14a64390065743dc5ff63fb73fa882415`
and is preserved in the repository as
[`grand-hall-e57-image2d-evidence-v1.json`](./grand-hall-e57-image2d-evidence-v1.json).

## Step 4 - Inspect the published shape

A complete output contains exactly:

- `image2d-inventory-authority-none.json` with schema
  `venviewer.e57-image2d-evidence.v1`;
- `publication-receipt.json` with schema
  `venviewer.e57-image2d-evidence-publication.v1`; and
- 894 exact JPEGs at paths shaped as
  `images/scan_NNN/image2d_NNN_skybox_F.jpg`.

The total file count is 896. Check it without changing anything:

```powershell
(Get-ChildItem -LiteralPath $out -Recurse -File).Count
$manifest = Get-Content -LiteralPath (Join-Path $out 'image2d-inventory-authority-none.json') -Raw | ConvertFrom-Json
$manifest.authority
$manifest.summary | Format-List
$manifest.contract | Format-List
```

The first command must print `896`. `authority` must print `none`. The summary
must report 149 scans, 894 images, six faces per scan, 4096x4096 dimensions,
and exactly 2,927,438,001 extracted bytes.

The contract must keep all downstream authorities false or `none`, record
`associationMethod: exact_associatedData3DGuid`, and record
`blobDisposition: byte_exact_no_decode_reencode`.

## Step 5 - Run the independent strict check

Use the same exact stage and completed output:

```powershell
python -B tools\twin-forge\e57-scripts\extract_e57_image2d_evidence.py `
  --stage "$stage" `
  --out "$out" `
  --verify-source-hash `
  --check
```

Check mode performs another full source hash before and after verification. It
reopens the staged E57, re-derives all native GUIDs, names, associations,
intrinsics, blob lengths, and blob hashes in vector order, and requires the
published manifest to match those exact source-derived records. It parses
canonical JSON with duplicate-key and non-finite-number rejection, revalidates
the exact file inventory, hashes and fully decodes every native and published
JPEG, rechecks every GUID/face/path/intrinsic binding and aggregate byte count,
and requires the receipt to bind the exact manifest and payload. Initial and
final file-identity snapshots plus a second inventory reject concurrent file or
directory mutation during verification.

It must finish with the same 149/894/2,927,438,001 success line. The independent
check completed successfully on 2026-08-26 after another two full E57 hashes,
native source-record/blob re-derivation, complete stable-inventory
verification, and full decoding of all 894 native plus 894 published JPEGs.

## Failure and retry handling

- Do not retry into the same existing output path.
- Do not delete, modify, rename, or place evidence beside the staged E57.
- A normal failure removes its hidden staging directory. A hard process or
  machine interruption may leave a hidden `.e57-image2d-evidence-v1.stage-*`
  sibling; treat it as incomplete and authority-none. Inspect it before any
  explicit cleanup and never rename it into the final path.
- Preserve the exact error text locally. Do not paste machine-local paths or
  source data into chat.
- Do not use historical `F:\E57\equirect*` renders or stored per-image poses as
  substitutes for this native byte evidence.
- Do not push, upload, publish, deploy, register, train from, or activate the
  pack under T-559.

## Completion boundary

The implementation, completed pack, terminal receipt, and independent check
make the native authority-none evidence pack reproducible and byte-bound. The
2.93 GB payload remains local and was not pushed, uploaded, deployed,
registered, or admitted to runtime.

The external panorama crosswalk is separate T-560 work and remains
authority-none and human-pending. T-554 remains blocked on authorized human
room/scope decisions and exact original-grid masks.
T-555 through T-558 retain their existing reconstruction, registration,
candidate, and admission gates. Production trust remains `null`.
