# Grand Hall captured-runtime contract — 2026-08-21

Status: implemented contract; staging intake and authenticated package-browser/WebGL QA have not been run. Local source-bound dev-fixture diagnostics are separate and do not establish package acceptance.

## Authority and scope

The project owner stated on 2026-08-21 that Venviewer owns the supplied capture and has written approval to use, combine, transform, and disseminate the XGRIDS and Matterport data for this project. The written instruments themselves are not stored in this repository; attach them to the project evidence store before an external release that requires documentary proof.

This contract covers the individual Trades Hall Grand Hall only. It does not infer the external facade, neighbouring rooms, same-floor adjacency, uncaptured surfaces, or a whole-venue building envelope. Existing exterior artwork and photography remain separate venue-presentation assets. They must not be mounted in, composited into, or used to repair the captured Grand Hall runtime.

## Canonical supplied visual source

The v1 browser source is the vendor-supplied SOG export at:

`scans_BIG_MODEL_TH_GH_1/lcc2-result/Grand_Hall.lcc2`

The absolute operator drop location (`C:\GRAND_HALL_BIG_MODEL_VARIATIONS`) is transient intake input and must never be emitted into an AssetVersion, RuntimePackage, audit record, log message, or client response.

The supplied variations were compared as export families before this choice was pinned. Variations `scans_BIG_MODEL_TH_GH_1`, `_2`, and `_3` contain byte-identical LCC2/SOG data; `_2` only adds an OBJ export and `_3` only adds an additional PLY export. Variations `_4`, `_5`, and `_6` likewise contain one byte-identical SPZ family with optional mesh additions, while `_7`, `_8`, and `_9` are the separate LCC/mesh export family. `_GH_1` is therefore the unambiguous minimal carrier of the selected SOG bytes rather than a different reconstruction from `_GH_2` or `_GH_3`. The SPZ and LCC/mesh families remain retained source alternatives but are not co-mounted or used to fill architecture in this runtime.

- Hierarchy manifest: 124,070 bytes
- Hierarchy SHA-256: `927a92699de222e99d2684ca2567a35ab1e523a036461e6e01236b7b77b7f659`
- Highest-detail frontier receipt: `sha256:8e7514e75aa19345dda1955f2cee3f9369339c553c2711c084cd04be4c9c1352`
- Application decision: `grand-hall-big-model-sog-fine-v1`
- Frontier policy: `authoritative-leaf-nodes-exclude-environment-v1`
- Selected depth: 5
- Selected members: 11, in receipt order
- Selected Gaussians: 6,019,684
- Selected compressed bytes: 106,479,738

The registration and serving contract is defined in `packages/api/src/lib/grand-hall-frontier-contract.ts`; the renderer's source and framing pin is `packages/web/src/lib/grand-hall-captured-source.ts`. Admission fails closed on any missing, extra, reordered, renamed, resized, re-encoded, or digest-substituted member. The private preview transport then downloads only receipt-bound objects and independently verifies response source, byte length, and SHA-256 before Spark receives each member.

## Exact ordered frontier

| Order | Relative path | Bytes | Gaussians | SHA-256 |
|---:|---|---:|---:|---|
| 1 | `data/3dgs/0_0_0_1_0_1.sog` | 9,980,174 | 556,880 | `97efa65f9aaddbd69780664c6668817125c3153469918d5f291b348ee0b6d7e1` |
| 2 | `data/3dgs/0_1_0_1_0_0.sog` | 9,500,250 | 528,394 | `2b0c0cce30cb31a34b253d5985985b3d547debe8bca1a97401eb72ab3ad3bdbf` |
| 3 | `data/3dgs/0_2_0_0_1_1.sog` | 10,575,631 | 608,233 | `b354ba55785e73a42aa4d108ac0c1fb93c333cbf5bd881e6c75149c2cecccd3e` |
| 4 | `data/3dgs/0_3_0_0_0_0.sog` | 10,376,269 | 604,745 | `e590fb5d7488071c63f10df33b31e451f3c0348c2209f1bf594015c28a1fff24` |
| 5 | `data/3dgs/0_3_0_1_0_1.sog` | 10,207,866 | 585,011 | `84b2ff813e0746d8fc8dfcc9d044dba15fef5f62ca137794c30989c04ba82a9d` |
| 6 | `data/3dgs/0_4_0_1_0_0.sog` | 9,199,768 | 514,640 | `5863e052c6f99316914df9168829543b82fb35db0118b5e02d30e4d326a79d03` |
| 7 | `data/3dgs/0_5_0_0_0_1.sog` | 8,975,642 | 504,860 | `65fd21b69a1def23cb4bd5b756da7ac03e4451a476a80a61c47b853a0366a8f1` |
| 8 | `data/3dgs/0_5_0_1_0_1.sog` | 9,708,760 | 551,142 | `d3272fee659e486190af1d2ac9427c39e5536bc85b90b5570df4b6e9e9124631` |
| 9 | `data/3dgs/0_6_0_0_0_1.sog` | 10,231,737 | 597,926 | `18e23290236bb3f220df2b59f6f255a421151c0f1da7ed633bd00d06eddf0171` |
| 10 | `data/3dgs/0_7_0_0_0_0.sog` | 9,417,293 | 524,982 | `7c4cca3644294c2955cfe9e41f387e70ce79e1aedcca132392c0493325ce4386` |
| 11 | `data/3dgs/0_7_0_0_0_1.sog` | 8,306,348 | 442,871 | `5e4409b07084ce7089e77a17d1eec0d2c4691f7a9d9e52f55ef752529d356ea9` |

The table is an audit aid, not an alternative source of truth. Code and tests must remain pinned to the API contract.

## Mandatory visual exclusions

- Do not load any coarser ancestor LOD with the fine frontier. Hierarchy levels are replacements, not additive layers.
- Do not load `data/3dgs/env.sog`.
- Do not co-mount the SOG and SPZ export families.
- Do not render the OBJ or PLY as visible architecture. A reviewed source-derived collision use may be added later on a non-rendering interaction layer.
- Do not render procedural floors, walls, domes, windows, doors, ornament clusters, architectural ink, generative modelling, image-generated fill, video-generated fill, inpainting, or outpainting for Grand Hall architecture.
- Do not fall back to generated or procedural architecture while the captured package is missing, invalid, loading, or failed.

No generative-modelling, image, or video API key is required for the architectural layer. Source-faithful camera, exposure, colour management, and explicitly non-architectural interface treatment are the only current beauty-work surfaces.

## Server-bound intake contract

The only write path for this exact source is the platform-admin-protected API capability mounted under `/admin/assets/grand-hall-frontier-intake`. It is disabled by default and must run on the API deployment that owns the explicitly selected database and private runtime bucket.

1. `POST /preflight` binds the request to the configured target ID, clean HTTPS API origin, canonical manifest digest, and frontier receipt. The API fully reads and hashes every existing canonical object before returning either `verified_existing` or an API-relative member upload capability.
2. `PUT /members/:memberIndex` accepts exactly one canonical binary member. Authentication and target/header checks run before body processing. The API hashes the complete request body, writes the fixed private key with conditional create (`If-None-Match: *`) using the intake-only credential, and fully reads the stored object back with the separate read-only credential. The operator never receives bucket names, object keys, account identifiers, or storage credentials.
3. `POST /commit` repeats a full byte-length and SHA-256 read of all eleven private objects before the first database write. Only then does one transaction acquire the Grand Hall advisory lock, create or exactly reuse eleven AssetVersion rows, create or exactly reuse one ordered immutable RuntimePackage, and write the audit entry when it creates the package. A failure rolls back the whole transaction.

The target-binding digest changes when the selected target, API origin, database connection identity, storage account, private bucket, object prefix, frontier receipt, or binding secret changes. Member uploads and commit reject a stale binding; the operator must run preflight again.

The serving credential is read-only. The intake writer receives a separate locally signed, short-lived credential triple (access-key ID, secret access key, and session token), restricted to `PutObject` on the immutable Grand Hall prefix. The write-capable parent remains only in the trusted local operator environment and its access-key ID must differ from the serving principal's access-key ID. The API passes the session token only to the intake writer, constrains its only PutObject call to conditional creation, and never issues an unconditional overwrite. The child must not have read, list, delete, or out-of-prefix authority. Remove all three child fields and disable the capability after intake; retain only the read credential for authenticated serving.

## Immutable registration and provenance

Each member is registered as a Trades Hall / Grand Hall XGRIDS SOG AssetVersion with its exact private key, filename, byte length, and SHA-256. `captureSessionId` is deliberately `null`; it must remain null unless an independently validated capture-session identity is available. Do not infer a capture date or session from filenames, filesystem timestamps, surrounding exports, or owner authority. Documentary rights evidence is likewise not asserted by the runtime receipt.

The RuntimePackage is `internal_ready`, capture-only, ordered, and content-digest identified. Semantic mesh, collision, and point-cloud package fields are null. Generic asset registration and generic runtime-package revision routes reject both the Grand Hall target and its protected storage namespace, so they cannot bypass the all-object verification and one-transaction rule. The legacy `/assets/runtime-assets` delivery path also rejects this frontier.

Authenticated latest-package discovery and authenticated private preview both apply the same canonical eleven-member predicate. A directly inserted, historical, reordered, differently composed, rejected-evidence, or otherwise noncanonical Grand Hall package cannot be discovered or served by these routes even if its own metadata is internally self-consistent. Preview content is emitted only through the receipt-checked private transport.

## Atomic scene separation

`captured-room-source` contains only the admitted visual frontier. The renderer keeps all eleven members invisible and detached until the full set has verified and decoded to exactly 6,019,684 Gaussians. Any transfer, source, digest, size, member-count, or decoded-count failure disposes the partial set and leaves architecture blank.

One ten-minute absolute browser-load deadline starts before authenticated token acquisition and ends only after the complete eleven-member resource is atomically attached. The same abort signal spans token acquisition, metadata and all sequential member fetches, response-body reads, SHA-256 work, Spark initialization, decoded-count validation, and attachment. The ten-minute bound was budgeted for the canonical 106,479,738-byte transfer and 6,019,684-Gaussian decode; suitability on modest connections or devices remains unvalidated. Timeout aborts in-flight transport, disposes every invisible decoded or partial mesh, leaves all source pixels detached, and emits terminal failure only for the still-current room/package request. The renderer is React-keyed by the collision-free `spaceId` + `venueId` + immutable `runtimePackageId` identity, so even a same-package room or venue change remounts it, disposes the old resource, and starts a fresh pending load. Every load/retry also receives a monotonic attempt nonce; completion, failure, and cleanup must match both identity and nonce. Cleanup and retry cancel the old clock, so stale callbacks cannot verify, fail, or clear a newer room/package attempt, including a same-package retry.

`planning-overlays` is disabled for this source-only Grand Hall view. Furniture, routes, measurement, placement, and selection require a separately reviewed room-local collision/alignment artifact and cannot currently contribute pixels that might be confused with captured architecture.

The same receipt-admitted-room policy also gates the surrounding planner chrome. In this internal state, `verified` means byte/receipt admission only; it is not visual, layout, structural, or operational verification. The generic rectangular minimap, heritage inset, furniture markers, route-conflict controls, capacity and circulation estimates, layout quantities, operational simulations, cost/share/ops lenses, measurement and placement controls, and generated-furniture status are absent for Grand Hall. The cockpit retains source-inspection status and any independently linked event timeline, and explains that operational geometry is unavailable. Pending or unavailable room identity fails closed with distinct neutral copy; it is never labelled as Grand Hall or as a verified capture.

That boundary applies to navigation and failure paths as well as visible controls. Direct blueprint URLs pass through the same room-identity policy; capture-only, pending, and unavailable identities remain in 3D source inspection. A WebGL failure offers retry and neutral source-unavailable copy, never generic 2D room geometry. Keyboard history, notes, save/share/review actions, guest-flow replay, demo fixtures, phase density/guest/staff/ops metrics, clipping, x-ray, procedural fog, generic colour grading, and Mesh/Hybrid alternative labels are disabled. Runtime status is keyed to the current room and immutable package, becomes verified only after the complete eleven-member resource is attached, becomes failed on terminal admission/decode failure, clears its mounted claim when the Canvas detaches, restarts as pending before same-package retry, and rejects stale completion callbacks after a room or package change.

The exterior facade remains a separate venue-presentation concern. Exterior images such as `packages/web/public/images/venue/trades-hall-exterior.jpg` and `packages/web/public/images/brand/facade-art.webp` are not deleted by this contract; they simply have no authority inside the Grand Hall captured-room layer.

## RoomScene composition amendment — 2026-08-23

T-541 wraps this exact captured runtime in a typed `RoomSceneManifestV0`; it
does not replace or weaken T-540's byte, package, transport, or atomic-attach
rules. The manifest and compositor are defined by
`packages/types/src/room-scene-manifest.ts`,
`packages/web/src/lib/grand-hall-room-scene.ts`, and
`packages/web/src/lib/room-scene-composition.ts`.

The Grand Hall scene currently registers exactly two layers:

- `Appearance`: the eleven-member `CAPTURED` SOG frontier, with appearance
  authority only; and
- `StructuralProxy`: a hidden-by-default `RECONSTRUCTED` QA witness showing
  the exact selected-SOG extent, the pose-centre 5th–95th-percentile envelope,
  and an unreviewed diagnostic spawn marker.

`Collision`, `HeroVolume`, `Semantic`, `Planner`, and
`CinematicDerivative` are deliberately absent. The source-envelope witness is
not a room shell, floor, wall, portal map, measured alignment, or collision
mesh, and its lines cannot substitute for captured appearance. Conversely,
captured splats cannot silently acquire geometry, navigation, planning,
collision, or export authority. When a requested layer is missing, invalid, or
not ready, composition fails closed for that layer instead of borrowing pixels
or authority from a different slot.

The Grand Hall camera surface now exposes orbit, dollhouse, and human
diagnostic modes. The default orbit view starts at transformed source-pose
position 19,890 inside the Hall and looks horizontally toward the centre of
the supplied 5th–95th-percentile pose envelope. Its source rotation convention
and optical FOV remain unvalidated, so this is a source-position-derived
inspection view rather than a matched camera. Orbit/dollhouse coordinates are
bounded to that supplied pose envelope instead of extrapolating outside the
interior-trained capture. Human mode fixes the eye-height convention at 1.65
m, pins Y to an unreviewed floor candidate, and clamps X/Z to the same
diagnostic AABB. These limits do not prevent wall crossing, establish room
containment, or certify walkability/collision. A reviewed room transform,
floor, portals, and structural shell remain prerequisites for operational
navigation.

The supplied LCC2 declares `renderingHints.sortingMethod = "depth"`. The
Grand Hall exact renderer therefore configures Spark with
`sortRadial: false`; this honors source ordering metadata without changing any
captured coordinate, colour, transform, opening, surface, or architectural
feature.

“The Room Resolves” now consumes aggregate state across every visible declared
layer, with `failed → absent → loading → ready` precedence and sanitized summed
unit counts. It cannot report the captured room as resolved until all eleven
appearance members are attached; a partial or zero-unit `ready` state is
converted to failure. Choosing the QA proxy changes the presentation witness,
not truth or captured-layer readiness.

The permanent truth vocabulary is `MEASURED`, `CAPTURED`, `RECONSTRUCTED`,
`ENHANCED_CAPTURED`, `GENERATED_CINEMATIC`, and `PROCEDURAL_PLANNER`. The fixed
layer slots are `Appearance`, `StructuralProxy`, `Collision`, `HeroVolume`,
`Semantic`, `Planner`, and `CinematicDerivative`. Their detailed contracts are
recorded in `docs/architecture/room-scene-compositor.md` and
`docs/specs/visual-asset-manifest.md`.

Owner-confirmed XGRIDS and Matterport authority is recorded separately in the
append-only `state/source_rights.json` ledger with the documentary evidence
location still marked pending. The records retain redistribution and
third-party dissemination permission. That authority removes a project-
specific data-rights blocker; it does not change truth class or override
unrelated code, SDK, research implementation, model-weight, checkpoint, or
provider licences.

## Deployment and evidence state

As of 2026-08-24, the owner has selected and authorized the dedicated staging target ID `trades-hall-grand-hall-staging` and authenticated staging-only browser/WebGL QA. The target has not been provisioned, the branch has not been pushed, and no service, database, bucket, credential, migration, upload, AssetVersion, RuntimePackage, deployment, or package activation has been created or changed by this work. Local source-bound browser/WebGL diagnostics are recorded separately in `docs/reports/visual-lineage-benchmark.md`; authenticated staging/package QA has not run.

The remaining operational gates are:

- provision the selected target's clean API origin, fresh database, and private R2 bucket;
- receive an existing platform-admin bearer token or have an authorized operator run the command;
- provision the read-only serving credential and locally sign the separate temporary PutObject-only child credential triple;
- complete the conditional-create and idempotent-retry rehearsal in a dedicated staging target;
- configure a real live `VITE_CLERK_PUBLISHABLE_KEY` through the provider secret manager before any production web build;
- deploy this code to the explicitly approved target, enable intake temporarily, and run the documented intake command;
- disable intake and remove all five target/deployment/temporary-child fields after successful registration;
- run the authorized authenticated staging/package fixed-camera visual QA without extending that authority to production; and
- separately review and sign any future room-local collision/floor alignment before metric placement is enabled.

Follow `docs/operations/grand-hall-frontier-intake-runbook.md` for the operational procedure. This contract does not certify operational geometry, public evidence, deployment, or visual acceptance.
