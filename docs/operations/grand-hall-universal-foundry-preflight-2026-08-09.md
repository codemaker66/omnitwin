# Grand Hall universal Reconstruction Foundry preflight — 2026-08-09

## Scope and safety boundary

This preflight exercised only deterministic repository contracts against the
existing frozen Grand Hall ingest manifest. It did not open, copy, decode,
transform, upload, train on, or freshly hash any Matterport, E57, panorama,
MatterPak, XGRIDS, PortalCam, COLMAP, PLY, SOG, or SPZ source payload.

The source-of-record input was:

- `docs/operations/grand-hall-pilot-ingest-manifest-2026-07-19.json`
- `docs/operations/grand-hall-foundry-host-capabilities-2026-08-09.json`

The host inventory is explicit caller-supplied input rather than authenticated
environment discovery. Its Node dependency versions are package constraints,
and the local read-only E57 metadata probe and Cartesian geometry reader accept
pye57 0.4.19. A separate genuine 4 KiB ASTM E57 fixture test exercised the
reader without opening the Grand Hall source. The interpreter, native
dependencies, bridge identity, and worker-image digest remain unverified caller
assertions. No listed dependency grants processing rights or execution
authority.

That fixture path is deliberately limited to a 256 MiB container, 1,000,000
total Cartesian points, 64 scans, 79 fixed-size batches, and complete explicit
pose children. It uses bounded 65,536-record memory buffers but re-reads each
selected scan from its beginning for every batch. It is not a seekable, Grand
Hall-scale streaming reader; V0 checkpoint resume reconstructs and verifies the
bounded source prefix and is unsuitable for the recorded 965.52-million-point
Grand Hall E57. The accepted binding exposes `CompressedVectorReader.seek`, but
calling it on the tiny fixture returned libE57Format `ErrorNotImplemented`.
Each command has a deadline and pre/post whole-container hashes. Those hashes
read possible embedded-image bytes, but the bridge never invokes an image
decoder or extracts images. Its path-based hashes do not close swap-and-restore
races and are not production activation evidence.

## Reproducible command

Run from the repository root:

```powershell
$manifest = (Resolve-Path "docs/operations/grand-hall-pilot-ingest-manifest-2026-07-19.json").Path
$hostInventory = (Resolve-Path "docs/operations/grand-hall-foundry-host-capabilities-2026-08-09.json").Path
pnpm --silent --filter @omnitwin/reconstruction-foundry-cli foundry -- assess-adapters --manifest $manifest --host $hostInventory
```

The deterministic result was:

- manifest SHA-256: `sha256:63516c0b1c9583086108879659b771809c5bea4272c175c9dbb809a6c66bfd89`
- host-inventory SHA-256: `f9668158a24093570770b6c408291f121d208943773d8f2262d7c3ddf3cc8607`
- assessment SHA-256: `063e6ac9c679e17988f7d362eef6dd8e13cb8697e1c4fa3062e18292012fd7b6`
- status: `blocked`
- authority: `none`
- execution: `not_authorized`
- assets inventoried: 310
- assets with structural inspection implemented: 302
- assets with a fully exact-asset-proven deterministic processor: 0
- assets with a reviewed subset core applicable to the exact manifest asset: 0
- assets whose exact variant lacks a structural inspector: 8
- assets without a deterministic processing worker: 310
- assets stopped only on missing execution activation: 0
- production-ready assets: 0
- assets requiring legal review: 309
- legally blocked assets: 1

All 310 assets currently stop before production reconstruction-worker
execution. The E57 asset reports the narrow crop seam only as inapplicable
information and remains worker-missing because its recorded 965.52 million
points exceed the seam's 1,000,000-point cap. It also stops on rights and exact
asset compatibility. The result does not reinterpret a tiny-fixture success or
structural inspection as Grand Hall conversion support.

## Real source strategy

The first bounded candidate should use the immutable staged E57 as the metric
geometry source only after purpose-specific Matterport processing rights are
recorded. Embedded or previously extracted pixels are excluded from the first
candidate. The staged MatterPak GLB can be used as a non-authoritative geometry
comparison, not as independent measurement control. Raw XGRIDS/PortalCam XBIN
may be read only for byte identity/custody hashing; Venviewer must not decode,
inspect format-specific payloads, or process it until an official reviewed
exporter or SDK bridge is available and its terms permit this purpose.

The current panorama directories, COLMAP data, Brush output, public Reception
splats, and facade/exterior photos are not shortcuts. They remain excluded from
activation because their lineage, purpose-specific rights, independent review,
or distribution status is unresolved.

## Implemented contract path

The Foundry now has reachable, reproducible steps for:

1. V6 universal inspection, including bounded ordinary point-cloud PLY facts;
2. deterministic composition of independently admitted source roots into one
   namespaced capture bundle without duplicating source bytes;
3. an exhaustive adapter assessment that reports inspection, processor,
   dependency, vendor, rights, and activation blockers per asset;
4. a deterministic local E57 Cartesian crop core whose supplied checkpoints are
   reconstructed from the bounded source prefix before resume, with
   source/normalized-pose/frame/unit bindings, an exercised pye57 0.4.19 bridge,
   whole-container hashing but no image decoding or extraction, and authority
   `none` throughout; it applies only to the 256 MiB/1,000,000-point/64-scan
   subset and not the Grand Hall E57;
5. a deterministic metric-registration proposal contract, bounded to 4,096
   exact root/frame/unit/digest-bound correspondences with fixed fit and
   held-out partitions, that received an independent GO review for this
   contract only; overlap remains `not_computed` and no reviewed
   TransformArtifact is created;
6. browser-local review of generated E57 crop JSON, capped at 12 MiB and 50,000
   points per artifact, with two distinct compatible overlays and explicit
   decisions across source comparison, alignment, scale, crop, completeness,
   privacy, and movable objects; and
7. assembly of an architectural Room Reality Package local candidate against
   caller-supplied transform, QA, Scene Authority, provenance, and masking
   references, while explicitly recording that the catalog, exact derived
   member identities, and movable-object classification are not yet verified.

Every new artifact is deterministic, canonically serialized, self-digested,
authority `none`, and non-executable. These artifacts are mutation-evident,
not yet signed or held in an append-only immutable store. The package
vocabulary contains no furniture role and strict
schemas reject undeclared fields, but this is not semantic furniture detection:
release remains blocked until a reviewed Scene Authority decision classifies
captured movable objects. Tables, chairs, stages, bars, and other movable
layout objects belong to independently frozen Event Layout Timeline state,
never to the room package.

## Bounded registration and browser-review evidence

The registration GO is limited to the deterministic proposal contract. It does
not establish real Grand Hall correspondences, source overlap, a reviewed
transform, fusion, QA, Scene Authority, or activation.

The browser review did execute locally with two distinct compatible generated
test crops at 50,000 points each (100,000 overlaid points). Canvas render timing
was 55.1 ms average / 85.7 ms maximum on mobile and 58.45 ms average / 69.8 ms
maximum on desktop. This is P2 and not 60 fps. The browser read neither raw E57
nor source images and uploaded no artifact. All seven decisions remained a
local authority-none draft; execution, correction application,
TransformArtifact and Scene Authority creation, QA approval, package export,
and runtime activation were not authorized. This evidence did not process real
Grand Hall media and did not produce a Room Reality Package.

## Next implementation slice

The next honest executable slice is not “turn on everything.” It is:

1. approve and bind one exact local, purpose-allowed source bundle;
2. add a durable execution attempt/fence that binds the verified stage,
   manifest, rights decision, worker profile, and output directory;
3. implement a production-reachable local `inspect_sources` adapter with a
   reviewed Windows private-output custody boundary;
4. implement a bounded-memory Grand Hall-scale streaming E57 worker, then bind
   it to that exact verified stage, source-facts artifact, approved JobSpec,
   execution fence and private output custody; the current scan-re-reading
   source-path bridge is not compatible with the recorded 965.52-million-point
   source and is not that activation;
5. obtain real, independently reviewed correspondences or metric controls for
   at least two compatible derived roots, run the bounded proposal, and review
   held-out residuals, scale, axes, origin, and source overlap;
6. implement and review fusion, then register its output only as a private
   authority-none candidate;
7. review crop, completeness, privacy, movable-object masks,
   TransformArtifact, QA, and Scene Authority before any registry bridge;
8. add the separate authenticated activation boundary required by T-541.

Only after those gates should one immutable Grand Hall room-package revision be
bound to multiple materially different furniture snapshots for Day/Week
scrubbing. Reusing that same room package across phases is the expected happy
path; crossfading room packages is evidence-worthy only when a genuinely
different captured room state exists.

## Current external blockers

- No purpose-specific rights evidence presently clears the available
  Matterport/E57 image or derived-training material for production processing.
- No reviewed XGRIDS/PortalCam raw decoder/export bridge is integrated; XBIN is
  an explicit vendor-export/SDK stop.
- No production reconstruction executor connects the existing worker contracts
  to a durable, approved attempt ledger on this Windows host.
- No Grand Hall-scale streaming E57 worker or real, independently reviewed
  correspondence/control set exists. The bounded proposal has not been run on
  Grand Hall evidence, and no source overlap or fusion has been reviewed.
- No independently reviewed Grand Hall TransformArtifact, QA result,
  movable-object authority mask, and Scene Authority map forms a complete
  package review.
- No authenticated T-541 execution/activation attestation exists, so historical
  runtime delivery correctly remains unavailable and returns 404.
- There are not yet two genuinely distinct, rights-cleared Grand Hall room
  captures. Therefore room-package crossfade evidence cannot honestly be
  claimed.
