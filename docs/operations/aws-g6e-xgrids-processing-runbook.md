# AWS G6e XGRIDS Processing Runbook

Status: operator runbook. This document does not prove that any room asset has
been processed, reviewed, signed, or loaded in Venviewer.

Last updated: 2026-08-15

Latest dry-run record:
`docs/operations/aws-g6e-xgrids-dry-run-2026-06-15.md`.

> **Export amendment (2026-08-15).** The export sections below were rewritten
> against the Reception Room forensics
> (`docs/reports/reception-room-hd-root-investigation.md`,
> `docs/reports/reception-room-hd-evidence.json`). The previous instruction —
> export one "raw" and one "processed" PLY plus a preview and a metadata JSON —
> dropped the trajectory sidecars entirely, said nothing about spherical-harmonic
> degree, and said nothing about the LCC2 level-of-detail tree. Those three
> omissions are the ones that actually cost quality and recoverability. Seven
> rooms remain unprocessed; read "Export Profile" and "Output Naming" before
> building any of them.

## Purpose

Use AWS EC2 G6e only as a temporary GPU workstation for XGRIDS / Lixel
CyberColor / PortalCam captures that are too large for Blake's local machine.

This runbook is for processing captured rooms into export artifacts, then
uploading those artifacts to R2 so they can be registered through the internal
AssetVersion and RuntimePackage workflow. It does not provision AWS, store
credentials, certify output quality, or mark T-091/T-091A done.

## Known Room Status

| Room | Current status | Processing action |
| --- | --- | --- |
| Grand Hall | Captured | Needs processing |
| Reception Room | Local processed output found | Needs upload/register/load workflow; see `docs/operations/reception-room-runtime-intake-2026-06-13.md` |
| Robert Adam Room | Captured | Needs processing |
| Saloon | Captured | Needs processing |
| Lady Convenor's Room | Splat done outside repo | Needs register/load workflow |
| North Gallery | Splat done outside repo | Needs register/load workflow |
| South Gallery | Splat done outside repo | Needs register/load workflow |

## Instance Recommendation

Use the smallest single-GPU instance that satisfies Lixel CyberColor / XGRIDS
memory requirements for the specific capture.

| Choice | Use when | Notes |
| --- | --- | --- |
| Minimum | `g6e.8xlarge` | AWS currently lists this as 1 NVIDIA L40S GPU and 256 GiB system memory. This appears sufficient for a 165 GB RAM requirement with some headroom, but confirm the software requirement first. |
| Safer | `g6e.16xlarge` | AWS currently lists this as 1 NVIDIA L40S GPU and 512 GiB system memory. Use this when the room is large, the 165 GB estimate is uncertain, or the first run fails due to memory pressure. |

Do not choose multi-GPU G6e sizes such as `g6e.12xlarge`, `g6e.24xlarge`, or
`g6e.48xlarge` unless Lixel CyberColor / XGRIDS explicitly benefits from
multiple GPUs for this processing path. More GPUs can increase cost without
helping if the software is single-GPU or mostly CPU/RAM-bound.

Before launch, verify the current instance specs and hourly cost in the EC2
console for the selected region.

## Pre-flight Checklist

Complete every item before starting an EC2 instance.

- AWS account is ready and Blake can sign in.
- AWS budget alert is set for a low ceiling appropriate to a one-off processing job.
- Region is chosen. Prefer the closest region with G6e quota and acceptable cost.
- EC2 service quota for G6e is checked in that region.
- Instance type is chosen: start with `g6e.8xlarge`; use `g6e.16xlarge` if the room or software requirement needs more headroom.
- EBS volume size is chosen. Use enough space for source capture, working files, exported assets, logs, and duplicate output copies.
- Security group is restricted.
- No public RDP or SSH beyond Blake's IP if possible.
- Key pair or access mechanism is ready.
- Capture files are already backed up outside the instance.
- R2 input and output paths are ready.
- Local notes are ready: room, capture date, software version, instance type, region, EBS size, command/settings used, and expected outputs.
- No AWS credentials, R2 credentials, or software license secrets will be placed in screenshots or pasted into public logs.

## Windows vs Linux Decision

Do not assume the operating system until the processing software path is
confirmed.

### Windows GPU Workstation Path

Use this path if Lixel CyberColor is Windows GUI software.

- Launch a Windows Server GPU AMI that supports NVIDIA drivers for G6e.
- Connect by RDP only from Blake's IP if possible.
- Install or open Lixel / LCC / XGRIDS software.
- Confirm the NVIDIA GPU is visible before processing.
- Keep the desktop session focused on one room at a time.

### Linux CLI Path

Use this path only if XGRIDS / Lixel provides Linux CLI tools for this exact
processing/export workflow.

- Launch a compatible Linux GPU AMI.
- Connect by SSH only from Blake's IP if possible.
- Install the required NVIDIA driver/CUDA stack only if the AMI does not already include it.
- Install or mount the XGRIDS / Lixel CLI tools.
- Run a tiny validation job before moving the full room capture.

If both paths are available, prefer the path documented by XGRIDS/Lixel for
PortalCam processing rather than guessing.

## Data Staging

Use a clean directory structure per instance.

Recommended working directories:

```text
D:\venviewer\inputs\<room_slug>\
D:\venviewer\work\<room_slug>\
D:\venviewer\outputs\<room_slug>\
D:\venviewer\logs\<room_slug>\
```

Linux equivalent:

```text
/mnt/venviewer/inputs/<room_slug>/
/mnt/venviewer/work/<room_slug>/
/mnt/venviewer/outputs/<room_slug>/
/mnt/venviewer/logs/<room_slug>/
```

Rules:

- Download or upload source captures into the input directory.
- Process from the working directory, not the only copy of the raw capture.
- Export files into the output directory.
- Save processing logs, settings screenshots, and software version screenshots into the logs directory.
- Compute and record SHA-256 for each exported output before registration.
- Upload outputs to R2.
- Verify the R2 upload by listing the object and checking byte size.
- Do not delete raw capture files.
- Do not expose venue data through public buckets, public snapshots, or public links.

## R2 Paths

Input capture prefixes:

```text
r2:venviewer-training-inputs/trades-hall/rooms/<room_slug>/xgrids/
r2:venviewer-training-inputs/trades-hall/rooms/<room_slug>/matterport/
r2:venviewer-training-inputs/trades-hall/rooms/<room_slug>/raw/
```

Output prefixes:

```text
r2:venviewer-training-outputs/trades-hall/rooms/<room_slug>/master/
r2:venviewer-training-outputs/trades-hall/rooms/<room_slug>/runtime/
r2:venviewer-training-outputs/trades-hall/rooms/<room_slug>/xgrids/
r2:venviewer-training-outputs/trades-hall/rooms/<room_slug>/runpod/
```

Use `master/` for the unquantized PLY master, trajectory sidecars, point cloud
and build report — the lineage root that every runtime variant derives from.
Use `runtime/` for the SOG and SPZ runtime exports actually mounted by a runtime
package. Use `xgrids/` for the LCC2 container, mesh, previews, metadata, and
other processing artifacts.

## Export Profile

Two choices upstream of the file-format list set the ceiling on everything
downstream. Both are unrecoverable without another multi-hour rebuild.

### 1. Build at spherical-harmonic degree 3

Select the reconstruction profile that emits **SH degree 3**. In our records
that profile is labelled *Quality*; the profiles labelled *Mobile* and
*Portable* emitted DC-only **SH degree 0**.

Do not trust the profile label. Read the actual `shDegree` out of the build
report and record it before uploading anything.

SH0 discards all view-dependent colour — precisely the property the splat layer
exists to carry under D-005a (chandeliers, glazing, polished floorboards, dark
timber). The conversion is one-way: SH3 decimates to SH0 with `splat-transform`
at any later date, but SH0 can never be promoted back to SH3 without rebuilding
from the capture.

Reception Room is the cautionary record. Its runtime pointer moved from a
~2.00M-Gaussian Quality/SH3 reconstruction to a ~1.98M-Gaussian Mobile/SH0 one
as an unvalidated source substitution, and no evidence establishes which is
visually better — only that Quality carries the greater recorded appearance
capacity. See `docs/reports/reception-room-hd-root-investigation.md`.

### 2. Export the whole LOD pyramid; mount only the leaf frontier

LCC2 emits a **replacement** level-of-detail tree. Parents and children are
alternatives, not additive layers.

Export every level — you need the pyramid. But record which chunks constitute
the **leaf frontier**, because mounting all levels simultaneously is the single
largest measured quality fault in our estate, and it is silent:

| Step | PSNR vs reference | SSIM |
|---|---|---|
| PLY master → valid leaf frontier (SOG or SPZ) | 41.4–43.8 dB | 0.958–0.972 |
| Valid leaf frontier → all levels mounted at once | 27.7–30.2 dB | 0.912–0.931 |
| Valid leaf frontier → coarse root only | 34.0–36.3 dB | 0.914–0.935 |

Reception Room mounted all seven chunks and rendered 3,455,732 Gaussians where
its valid four-member leaf frontier holds 1,978,258 — visibly doubled and
smeared edges. Read the table as agreement, not loss: the codec step operators
worry about lands at ~42 dB, which is near-identical, while the hierarchy
misread drops 12–14 dB below it.

Record the leaf-frontier membership in the metadata JSON at export time. It is
cheap to write down at the workstation and expensive to reconstruct later.

### 3. Codec choice is not worth deliberation

SOG and SPZ from the same source agree at 42.0–44.0 dB PSNR / 0.958–0.970 SSIM —
visually indistinguishable at the tested framings. Export both when the dialog
allows it; they are small. Pin the **SPZ format version** per artifact — current
tooling emits format v4 — because the version is not recoverable by inspection
alone.

## Output Naming

Preserve LCC2 export directories exactly as emitted. Chunk names (`0_0.sog`,
`0_1_0.sog`, `env.sog`, …) are referenced by the LCC2 manifest; renaming them
breaks the hierarchy the manifest describes. Name the **directory**, not the
files inside it.

```text
<room_slug>_xgrids_portalcam_master_sh3/      PLY LOD pyramid, unquantized
  <room_slug>_xgrids_portalcam_master_sh3_coarse.ply
  <room_slug>_xgrids_portalcam_master_sh3_medium.ply
  <room_slug>_xgrids_portalcam_master_sh3_fine.ply
  <room_slug>_xgrids_portalcam_master_sh3_environment.ply
<room_slug>_xgrids_portalcam_runtime_sog/     LCC2 SOG export, as emitted
<room_slug>_xgrids_portalcam_runtime_spz/     LCC2 SPZ export, as emitted
```

Match the pyramid level names to whatever the export actually emits — Reception
Room's were coarse / medium / fine plus a separate environment chunk. If the
build emits a different set, record the real names rather than forcing them into
these three.

Standalone sidecars use exact names, replacing `<room_slug>`:

```text
<room_slug>_xgrids_portalcam_poses.json          LCC2 export trajectory (~5 Hz)
<room_slug>_xgrids_portalcam_poses.csv           project_data trajectory (~10 Hz)
<room_slug>_xgrids_portalcam_point_cloud.ply
<room_slug>_xgrids_portalcam_mesh.obj
<room_slug>_xgrids_portalcam_build_report.json
<room_slug>_xgrids_portalcam_preview.mp4
<room_slug>_xgrids_portalcam_metadata.json
```

### Export checklist

Tick every row. The set is cheap; the rebuild is not.

| Artifact | Required | Why it cannot be skipped |
| --- | --- | --- |
| PLY master, SH3, full LOD pyramid | **Yes** | The unquantized master. Canonical package gate 8 requires every runtime variant to trace to one, and D-013 permits exactly one generation of lossy encoding from it. Without this the room can never be re-encoded, only re-captured. |
| SOG runtime export | Yes | Streamed/LOD web delivery format per the canonical venue package. |
| SPZ runtime export | Yes | Compact interchange. Record the format version. |
| `poses.json` (~5 Hz) | **Yes** | Trajectory from the LCC2 export. Not regenerable — see below. |
| `poses.csv` (~10 Hz) | **Yes** | Higher-rate trajectory from `project_data`. Not regenerable — see below. |
| `point_cloud.ply` | Yes | Metric anchoring and ICP against the E57 lane. |
| Mesh (OBJ) | Yes | Structural and collision comparator only — see the caveat below. |
| Build report | **Yes** | Sole record of `shDegree`, quality level, `antialias`, and HD image count. Spark's blur compensation must be matched to the `antialias` setting; Reception Room's was `false`. |
| Preview MP4 | Optional | QA convenience. |
| 3D Tiles / USD | Skip | D-013 pins glTF for delivery and USD as a mirror. Nothing in the runtime consumes them today. Take them only if free. |

The trajectory sidecars are the ones operators skip, and they are the ones that
cannot be regenerated. Raw PortalCam frames live inside the proprietary `.xbin`
(XBAG) container and the calibration inside an encrypted `lixel.zip`; no
authorized open path to either is established. Poses are the only capture-side
geometry that survives that wall, they are kilobytes, and every future
independent registration depends on them.

**Mesh caveat.** The Reception Room "SPZ with attached mesh" export produced a
splat payload byte-identical to the ordinary SPZ package, and a mesh of 10,209
vertices / 19,747 faces, XYZ-only. It is a structural comparator, not a
high-detail visual layer, and it is not geometry authority — that stays with the
E57 lane under D-024.

**If PLY export is not offered**, the licence tier is below Basic. Do not
proceed on the assumption that the LCC2 runtime export is a substitute: it is a
lossy delivery artifact, not a master. Resolve the tier, or derive the PLY from
`.lcc` via `splat-transform` (MIT, reads LCC and LCC2 natively) and record that
derivation in the metadata as the master's provenance.

### Rights constraint

LCC and LCC2 are publicly specified but carry a custom non-OSI licence with
attribution, redistribution and derivative conditions, including a restriction
on using the data organization format to train or fine-tune AI competing with
XGRIDS. Exported PLY, mesh, SPZ, SOG and poses are usable under verified
customer and source rights; the LCC2 container itself is **provenance, not a
master**. Do not train or refine from LCC/LCC2, and do not bundle vendor SDKs,
without written XGRIDS permission and counsel. See
`docs/reports/omnitwin-foundry-splat-quality-independence-corrections.md` §2.

### Output paths

```text
r2:venviewer-training-outputs/trades-hall/rooms/<room_slug>/master/    unquantized PLY master + trajectory + point cloud + build report
r2:venviewer-training-outputs/trades-hall/rooms/<room_slug>/runtime/   SOG and SPZ runtime exports
r2:venviewer-training-outputs/trades-hall/rooms/<room_slug>/xgrids/    LCC2 container, mesh, preview, logs
```

The `master/` prefix is new as of this amendment. Assets already uploaded under
the older layout — where a processed PLY sat in `runtime/` — stay where they
are; this applies to new exports. Do not retro-move registered objects, because
`r2Key` values are recorded on existing AssetVersion rows.

Room-specific runtime prefixes for external splats that already exist outside
the repo:

```text
r2:venviewer-training-outputs/trades-hall/rooms/lady-convenors-room/runtime/
r2:venviewer-training-outputs/trades-hall/rooms/north-gallery/runtime/
r2:venviewer-training-outputs/trades-hall/rooms/south-gallery/runtime/
```

For those rooms, copy the verified external splat into the matching `runtime/`
prefix before registration. Do not register a runtime package from a chat note,
local filename, or private external URL alone. Record the final R2 key, byte
size, SHA-256, file extension, source label, and known limitations first.

## Room Processing Order

Process one room at a time.

1. Robert Adam Room or Saloon first, whichever is smaller/easier.
2. The other of Robert Adam Room or Saloon.
3. Reception Room.
4. Grand Hall last, because it is likely the largest and most important.

The first smaller room is the shakedown run. Use it to confirm the instance,
drivers, XGRIDS/Lixel workflow, export settings, checksums, and R2 upload path
before spending time on Grand Hall.

## Processing Workflow

For each room:

1. Start the EC2 instance.
2. Confirm the instance type, region, EBS volume, and security group.
3. Confirm spend alarm is active.
4. Connect by RDP or SSH from Blake's IP.
5. Open or install Lixel / LCC / XGRIDS software.
6. Confirm GPU and system RAM are visible to the software.
7. Copy/download the room capture into the input directory.
8. Confirm source capture byte size and, if available, checksum.
9. Create clean work/output/log directories for that room.
10. Select the SH degree 3 reconstruction profile. Process only that room.
11. Read `shDegree` out of the build report and confirm it is 3 before exporting.
    A profile label is not evidence. If it reads 0, rebuild — do not export an
    SH0 reconstruction as a room's master.
12. Export the full set in the export checklist: PLY master with its complete
    LOD pyramid, SOG runtime, SPZ runtime, `poses.json`, `poses.csv`, point
    cloud, mesh, and build report.
13. Record in the metadata JSON, at the workstation while the project is open:
    the LCC2 leaf-frontier chunk membership, `shDegree`, the `antialias`
    setting, the SPZ format version, and the software version. This is the
    step most likely to be skipped and least likely to be reconstructable.
14. Save logs and screenshots showing software version, export settings, and
    success/failure state.
15. Compute SHA-256 for each exported file.
16. Upload outputs to the exact R2 paths in this runbook.
17. Verify each uploaded object exists and has the expected byte size.
18. Register AssetVersion records only after R2 key, SHA-256, file size, and file extension are known.
19. Register or update the RuntimePackage only after the master and runtime AssetVersions exist.
20. Stop or terminate the instance immediately after processing and upload verification.

## Safety Rules

- Set AWS spend alarms before launch.
- Stop or terminate the GPU instance immediately after processing.
- Never leave a GPU instance running overnight unintentionally.
- Never store AWS, R2, license, or API secrets in screenshots.
- Never delete raw captures.
- Never expose venue data publicly.
- Keep R2 outputs private or signed/internal unless a separate release review approves exposure.
- Do not claim a room is processed until the exported file exists, has a logged SHA-256, is uploaded to R2, and has been visually checked.
- Do not mark T-091 or T-091A done from this workflow alone.
- Never accept an SH degree 0 reconstruction as a room's master. It is a one-way loss.
- Never treat an LCC2 runtime export as a master. It is a lossy delivery artifact.
- Never derive a runtime variant from another runtime variant. Both descend from the PLY master, one generation only.
- Never register a full LOD pyramid as the runtime set. Register the leaf frontier.
- Never skip the trajectory sidecars. Raw frames and calibration are behind a proprietary wall; poses are the only capture-side geometry that survives it.

## Post-processing Registration Steps

Use the internal admin endpoints only after the runtime asset migration is
applied and the API has the AssetVersion / RuntimePackage foundation deployed.

These examples use placeholders:

- `<API_BASE>`: internal API base URL
- `<ADMIN_TOKEN>`: admin bearer token
- `<ROOM_SLUG>`: one of `grand-hall`, `reception-room`, `robert-adam-room`,
  `saloon`, `lady-convenors-room`, `north-gallery`, or `south-gallery`
- `<CAPTURE_SESSION_ID>`: response id from the capture-session registration
- `<ASSET_VERSION_ID>`: response id from a leaf-frontier runtime splat registration
- `<SHA256>`: actual 64-character lowercase SHA-256
- `<SIZE_BYTES>`: actual file size in bytes

### 1. Register The Capture Session

```bash
curl -X POST "<API_BASE>/admin/assets/capture-session" \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "venueSlug": "trades-hall",
    "roomSlug": "<ROOM_SLUG>",
    "captureSource": "xgrids_portalcam",
    "captureDevice": "XGRIDS PortalCam",
    "captureDate": "2026-06-06",
    "operatorName": "Blake",
    "sourceProjectName": "Trades Hall <ROOM_SLUG>",
    "notes": "Captured with XGRIDS PortalCam; processing performed on AWS G6e. Human review required.",
    "status": "processed"
  }'
```

### 2. Register The Master, Then The Runtime Frontier

Register the unquantized PLY master first. It is the lineage root for every
runtime variant, and it is `staged`, not `usable` — it is archival, never
served.

```bash
curl -X POST "<API_BASE>/admin/assets/register-version" \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "venueSlug": "trades-hall",
    "roomSlug": "<ROOM_SLUG>",
    "captureSessionId": "<CAPTURE_SESSION_ID>",
    "assetKind": "splat",
    "sourceType": "xgrids",
    "fileName": "<ROOM_SLUG>_xgrids_portalcam_master_sh3_fine.ply",
    "fileExt": ".ply",
    "r2Key": "r2:venviewer-training-outputs/trades-hall/rooms/<ROOM_SLUG>/master/<ROOM_SLUG>_xgrids_portalcam_master_sh3_fine.ply",
    "sha256": "<SHA256>",
    "sizeBytes": <SIZE_BYTES>,
    "mimeType": "application/octet-stream",
    "evidenceStatus": "unverified",
    "runtimeStatus": "staged",
    "notes": "Unquantized SH3 PLY master. Archival lineage root; never served. shDegree 3, antialias <ANTIALIAS>, LCC Studio <VERSION>."
  }'
```

Then register **each chunk of the leaf frontier** as its own runtime asset.
Register the frontier only — not every level of the pyramid — because the
registered set is what a runtime package will mount, and mounting parents
alongside children is the 12–14 dB fault described under "Export Profile".

```bash
curl -X POST "<API_BASE>/admin/assets/register-version" \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "venueSlug": "trades-hall",
    "roomSlug": "<ROOM_SLUG>",
    "captureSessionId": "<CAPTURE_SESSION_ID>",
    "assetKind": "splat",
    "sourceType": "xgrids",
    "fileName": "<LCC2_CHUNK_NAME>.spz",
    "fileExt": ".spz",
    "r2Key": "r2:venviewer-training-outputs/trades-hall/rooms/<ROOM_SLUG>/runtime/<ROOM_SLUG>_xgrids_portalcam_runtime_spz/<LCC2_CHUNK_NAME>.spz",
    "sha256": "<SHA256>",
    "sizeBytes": <SIZE_BYTES>,
    "mimeType": "application/octet-stream",
    "evidenceStatus": "unverified",
    "runtimeStatus": "usable",
    "notes": "Leaf-frontier member <N> of <TOTAL>. Derived in one generation from the SH3 PLY master. SPZ format v<VERSION>. Loaded only after internal visual check; not yet signed."
  }'
```

Repeat with `".sog"` for the SOG frontier. Never derive one runtime variant from
another — both descend from the PLY master, one generation only (D-013, and the
canonical package's "never transcode lossy SPZ/SOG into another lossy master").

For Lady Convenor's Room, North Gallery, or South Gallery, use the same endpoint
after the external splat is copied into R2. Set `captureSessionId` only when the
source capture session is known. If it is not known yet, leave it `null` and put
the source label and limitation in `notes`; the asset remains unverified until a
human review records the provenance.

```bash
curl -X POST "<API_BASE>/admin/assets/register-version" \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "venueSlug": "trades-hall",
    "roomSlug": "<ROOM_SLUG>",
    "captureSessionId": null,
    "assetKind": "splat",
    "sourceType": "xgrids",
    "fileName": "<ROOM_SLUG>_external_splat.ply",
    "fileExt": ".ply",
    "r2Key": "r2:venviewer-training-outputs/trades-hall/rooms/<ROOM_SLUG>/runtime/<ROOM_SLUG>_external_splat.ply",
    "externalUrl": null,
    "sha256": "<SHA256>",
    "sizeBytes": <SIZE_BYTES>,
    "mimeType": "application/octet-stream",
    "evidenceStatus": "unverified",
    "runtimeStatus": "usable",
    "notes": "External splat copied into Venviewer R2. Runtime asset loaded only after internal visual check; not yet signed."
  }'
```

### 3. Register Supporting Outputs

Register the preview and metadata as supporting AssetVersions. Keep them staged.

```bash
curl -X POST "<API_BASE>/admin/assets/register-version" \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "venueSlug": "trades-hall",
    "roomSlug": "<ROOM_SLUG>",
    "captureSessionId": "<CAPTURE_SESSION_ID>",
    "assetKind": "preview",
    "sourceType": "xgrids",
    "fileName": "<ROOM_SLUG>_xgrids_portalcam_preview.mp4",
    "fileExt": ".mp4",
    "r2Key": "r2:venviewer-training-outputs/trades-hall/rooms/<ROOM_SLUG>/xgrids/<ROOM_SLUG>_xgrids_portalcam_preview.mp4",
    "sha256": "<SHA256>",
    "sizeBytes": <SIZE_BYTES>,
    "mimeType": "video/mp4",
    "evidenceStatus": "unverified",
    "runtimeStatus": "staged",
    "notes": "Preview only; not a primary runtime splat."
  }'
```

Register the rest of the support set the same way, all `staged`, using the
`assetKind` and `fileExt` pairs the schema actually accepts
(`packages/types/src/asset-version.ts`):

| Artifact | `assetKind` | `fileExt` |
| --- | --- | --- |
| `poses.json` | `manifest` | `.json` |
| Build report | `manifest` | `.json` |
| Metadata (incl. leaf-frontier membership) | `manifest` | `.json` |
| LCC2 container | `manifest` | `.lcc2` |
| `point_cloud.ply` | `point_cloud` | `.ply` |
| Mesh | `mesh` | `.obj` |
| Preview | `preview` | `.mp4` |

**`poses.csv` cannot be registered directly.** `.csv` is absent from
`RUNTIME_FILE_EXTENSIONS`, and `assetKindAllowsExtension` rejects the request at
the boundary. Until the whitelist is extended, upload the CSV to R2 alongside
the rest and register it zipped as `assetKind: "other"`, `fileExt: ".zip"`,
naming the enclosed file in `notes`. Do not silently drop it — the 10 Hz
trajectory is the higher-rate pose source and is not regenerable.

### 4. Register Or Update The Runtime Package

Start with `draft`. Move to `internal_ready` only after the internal dev route
loads the asset through Spark and the operator has saved evidence of the
successful render. Do not use `published` until a separate review explicitly
approves it.

```bash
curl -X POST "<API_BASE>/admin/assets/register-runtime-package" \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "venueSlug": "trades-hall",
    "roomSlug": "<ROOM_SLUG>",
    "primaryVisualAssetVersionId": "<ASSET_VERSION_ID>",
    "semanticMeshAssetVersionId": null,
    "collisionAssetVersionId": null,
    "pointCloudAssetVersionId": null,
    "manifestJson": {
      "schemaVersion": "venviewer.runtime-package.v1",
      "venueSlug": "trades-hall",
      "roomSlug": "<ROOM_SLUG>",
      "packageType": "room-runtime",
      "assets": {
        "primaryVisualAssetVersionId": "<ASSET_VERSION_ID>",
        "semanticMeshAssetVersionId": null,
        "collisionAssetVersionId": null,
        "pointCloudAssetVersionId": null
      },
      "generatedAt": "2026-06-06T00:00:00.000Z",
      "notes": "Internal runtime package for the XGRIDS PortalCam leaf-frontier runtime splat. Human review required."
    },
    "evidenceStatus": "unverified",
    "runtimeStatus": "draft"
  }'
```

### 5. Internal Runtime URLs

After a RuntimePackage is registered and moved to an internal loadable status,
inspect it on the internal route:

```text
https://venviewer.com/dev/trades-hall-visual?venue=trades-hall&room=robert-adam-room
https://venviewer.com/dev/trades-hall-visual?venue=trades-hall&room=saloon
https://venviewer.com/dev/trades-hall-visual?venue=trades-hall&room=reception-room
https://venviewer.com/dev/trades-hall-visual?venue=trades-hall&room=grand-hall
https://venviewer.com/dev/trades-hall-visual?venue=trades-hall&room=lady-convenors-room
https://venviewer.com/dev/trades-hall-visual?venue=trades-hall&room=north-gallery
https://venviewer.com/dev/trades-hall-visual?venue=trades-hall&room=south-gallery
```

The internal registry status page for all room states is:

```text
https://venviewer.com/dev/assets/rooms
```

## Sources Checked

- AWS EC2 G6e product page: https://aws.amazon.com/ec2/instance-types/g6e/
- AWS EC2 accelerated computing specs: https://docs.aws.amazon.com/ec2/latest/instancetypes/ac.html

Use the EC2 console as the final source for region availability, quota, and
hourly pricing before launch.
