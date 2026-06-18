# AWS G6e XGRIDS Processing Lane Dry Run

Date: 2026-06-15
Status: operator dry-run record
Task: T-454

This record validates the XGRIDS / PortalCam processing lane at the runbook and
registration-contract boundary. It does not prove that an AWS instance was
launched, that a room was processed, that an R2 object exists, or that any room
asset is visually reviewed, signed, or public-ready.

## Dry Run Scope

Validated:

- the runbook has a concrete processing lane for high-RAM XGRIDS / PortalCam
  captures;
- the lane names the expected inputs, working directories, output artifacts,
  hashes, R2 destinations, provenance notes, visual QA posture, and failure
  handling;
- the registration steps map to real API routes in the current codebase;
- public claims remain blocked until a separate exposure and human-review
  gate approves them.

Not executed:

- no EC2 instance was started;
- no AWS quota, region price, or live G6e availability was checked in console;
- no XGRIDS / Lixel software was installed or run;
- no R2 object was uploaded or listed;
- no AssetVersion or RuntimePackage was registered by this dry run.

## Source Files Checked

| Source | Dry-run use |
| --- | --- |
| `docs/operations/aws-g6e-xgrids-processing-runbook.md` | Primary operator procedure. |
| `docs/operations/reception-room-runtime-intake-2026-06-13.md` | Current Reception Room exception path and known runtime limitations. |
| `packages/api/src/routes/assets.ts` | Confirms real registration and runtime package routes. |
| `packages/api/src/__tests__/assets.test.ts` | Confirms route auth, validation, room slug, and public fallback coverage. |
| `packages/web/src/api/asset-status.ts` | Confirms admin room status client reads `/admin/assets/rooms`. |
| `packages/web/src/api/runtime-packages.ts` | Confirms runtime loader reads `/assets/runtime-packages/latest`. |

## Route Contract Check

The runbook registration steps match current routes:

| Step | Runbook route | Current implementation |
| --- | --- | --- |
| Capture session registration | `POST /admin/assets/capture-session` | `packages/api/src/routes/assets.ts` |
| Asset version registration | `POST /admin/assets/register-version` | `packages/api/src/routes/assets.ts` |
| Runtime package registration | `POST /admin/assets/register-runtime-package` | `packages/api/src/routes/assets.ts` |
| Internal room status | `GET /admin/assets/rooms?venue=trades-hall` | `packages/api/src/routes/assets.ts` and `packages/web/src/api/asset-status.ts` |
| Latest runtime package | `GET /assets/runtime-packages/latest?venue=trades-hall&room=<room_slug>` | `packages/api/src/routes/assets.ts` and `packages/web/src/api/runtime-packages.ts` |
| Public room visual fallback | `GET /assets/runtime-packages/public-room-visual?venue=trades-hall&room=<room_slug>` | `packages/api/src/routes/assets.ts` |

The tests in `packages/api/src/__tests__/assets.test.ts` cover unauthenticated
admin rejection, non-admin rejection, malformed hash rejection, unsupported
room slug rejection, loadable-package primary-asset requirements, and
client-safe public fallback output.

## Artifact Inventory Check

For each room processing run, the lane requires these minimum output records
before registration:

| Required record | Why it is required |
| --- | --- |
| room slug | Prevents room-state drift across the seven Trades Hall rooms. |
| capture source and device | Keeps PortalCam/XGRIDS provenance explicit. |
| source byte size and checksum when available | Detects partial copy or wrong input bundle. |
| software name and version | Makes output reproducible enough for operator review. |
| instance type, region, EBS size, and run time | Supports cost and failure analysis. |
| exported file names and byte sizes | Prevents registering phantom artifacts. |
| SHA-256 per exported file | Required before AssetVersion registration. |
| R2 key per exported file | Required before RuntimePackage registration. |
| visual QA notes and screenshot path | Separates renderer compatibility from review approval. |
| known limitations | Blocks overclaiming and drives review gates. |

## Room Order Check

The runbook order remains valid for reducing risk:

1. Robert Adam Room or Saloon as the first shakedown room.
2. The other smaller room.
3. Reception Room, except where the existing registered internal SOG package is
   used for runtime QA only.
4. Grand Hall last because it is the largest and highest-risk room.

The Reception Room intake note is an exception record, not proof that the full
lane has been run for every room. It records a discovered local XGRIDS/LCC2 SOG
bundle, an internal package registration, and visual/runtime QA limitations.

## Failure Gates

The lane must stop before registration if any of these are true:

- the AWS budget alert is not active;
- the source capture is not backed up outside the instance;
- the selected G6e instance is not actually available in the chosen region;
- the XGRIDS / Lixel software cannot see the GPU or required system memory;
- output file byte sizes or checksums are missing;
- R2 upload cannot be listed with the expected byte size;
- the exported splat extension does not match the registered `fileExt`;
- a fixture, demo, local-only URL, or private external URL is used as the
  primary runtime source;
- visual QA has not been recorded;
- review or exposure status is being inferred from successful processing alone.

## Claim Boundary

Allowed internal status after a successful live run:

- processed runtime candidate;
- uploaded to controlled object storage;
- registered AssetVersion;
- registered RuntimePackage draft or internal-ready;
- runtime asset loaded, not yet verified/signed;
- human review required.

Forbidden until separate review evidence exists:

- surveyed;
- certified;
- approved for occupancy;
- fire approved;
- public-ready;
- production verified;
- customer-facing proof;
- exact venue twin.

## Next Live Operator Actions

1. Open the AWS console and verify current G6e quota, regional availability,
   and hourly cost before launch.
2. Launch only the selected one-room shakedown instance.
3. Record the live instance metadata, XGRIDS / Lixel software version, output
   file hashes, R2 object listings, and visual QA screenshots in a new dated
   room run record.
4. Register AssetVersion and RuntimePackage rows only after the run record has
   actual R2 keys, byte sizes, hashes, and limitations.
5. Keep T-091 open until the required real-room runtime scope and review records
   are complete.
