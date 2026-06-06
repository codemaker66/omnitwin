# AWS G6e XGRIDS Processing Runbook

Status: operator runbook. This document does not prove that any room asset has
been processed, reviewed, signed, or loaded in Venviewer.

Last updated: 2026-06-06

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
| Reception Room | Captured | Needs processing |
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
r2:venviewer-training-outputs/trades-hall/rooms/<room_slug>/runtime/
r2:venviewer-training-outputs/trades-hall/rooms/<room_slug>/xgrids/
r2:venviewer-training-outputs/trades-hall/rooms/<room_slug>/runpod/
```

Use `runtime/` for the primary processed splat intended for internal runtime
loading. Use `xgrids/` for XGRIDS/Lixel processing exports, previews, metadata,
and raw exported scene artifacts.

## Output Naming

Use these file names exactly, replacing `<room_slug>`:

```text
<room_slug>_xgrids_portalcam_scene_raw.ply
<room_slug>_xgrids_portalcam_scene_processed.ply
<room_slug>_xgrids_portalcam_preview.mp4
<room_slug>_xgrids_portalcam_metadata.json
```

Exact output paths:

```text
r2:venviewer-training-outputs/trades-hall/rooms/<room_slug>/xgrids/<room_slug>_xgrids_portalcam_scene_raw.ply
r2:venviewer-training-outputs/trades-hall/rooms/<room_slug>/runtime/<room_slug>_xgrids_portalcam_scene_processed.ply
r2:venviewer-training-outputs/trades-hall/rooms/<room_slug>/xgrids/<room_slug>_xgrids_portalcam_preview.mp4
r2:venviewer-training-outputs/trades-hall/rooms/<room_slug>/xgrids/<room_slug>_xgrids_portalcam_metadata.json
```

Room-specific paths for the four captured rooms:

```text
r2:venviewer-training-outputs/trades-hall/rooms/robert-adam-room/runtime/robert-adam-room_xgrids_portalcam_scene_processed.ply
r2:venviewer-training-outputs/trades-hall/rooms/saloon/runtime/saloon_xgrids_portalcam_scene_processed.ply
r2:venviewer-training-outputs/trades-hall/rooms/reception-room/runtime/reception-room_xgrids_portalcam_scene_processed.ply
r2:venviewer-training-outputs/trades-hall/rooms/grand-hall/runtime/grand-hall_xgrids_portalcam_scene_processed.ply
```

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
10. Process only that room.
11. Export the highest-quality splat the software can produce for internal runtime inspection.
12. Export any mesh, point cloud, preview video, and metadata the software can produce.
13. Save logs and screenshots that show software version, export settings, and success/failure state.
14. Compute SHA-256 for each exported file.
15. Upload outputs to the exact R2 paths in this runbook.
16. Verify each uploaded object exists and has the expected byte size.
17. Register AssetVersion records only after R2 key, SHA-256, file size, and file extension are known.
18. Register or update the RuntimePackage only after the processed splat AssetVersion exists.
19. Stop or terminate the instance immediately after processing and upload verification.

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

## Post-processing Registration Steps

Use the internal admin endpoints only after the runtime asset migration is
applied and the API has the AssetVersion / RuntimePackage foundation deployed.

These examples use placeholders:

- `<API_BASE>`: internal API base URL
- `<ADMIN_TOKEN>`: admin bearer token
- `<ROOM_SLUG>`: `robert-adam-room`, `saloon`, `reception-room`, or `grand-hall`
- `<CAPTURE_SESSION_ID>`: response id from the capture-session registration
- `<ASSET_VERSION_ID>`: response id from the processed splat registration
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

### 2. Register The Processed Runtime Splat

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
    "fileName": "<ROOM_SLUG>_xgrids_portalcam_scene_processed.ply",
    "fileExt": ".ply",
    "r2Key": "r2:venviewer-training-outputs/trades-hall/rooms/<ROOM_SLUG>/runtime/<ROOM_SLUG>_xgrids_portalcam_scene_processed.ply",
    "sha256": "<SHA256>",
    "sizeBytes": <SIZE_BYTES>,
    "mimeType": "application/octet-stream",
    "evidenceStatus": "unverified",
    "runtimeStatus": "usable",
    "notes": "XGRIDS PortalCam/Lixel export. Runtime asset loaded only after internal visual check; not yet signed."
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
      "notes": "Internal runtime package for XGRIDS PortalCam processed splat. Human review required."
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
```

## Sources Checked

- AWS EC2 G6e product page: https://aws.amazon.com/ec2/instance-types/g6e/
- AWS EC2 accelerated computing specs: https://docs.aws.amazon.com/ec2/latest/instancetypes/ac.html

Use the EC2 console as the final source for region availability, quota, and
hourly pricing before launch.
