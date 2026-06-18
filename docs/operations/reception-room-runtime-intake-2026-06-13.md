# Reception Room Runtime Intake Note

Date: 2026-06-13
Status: internal operator intake note
Scope: Trades Hall Reception Room XGRIDS / PortalCam output discovered on Blake's local workstation.

This note records source facts and the next registration path. It does not claim a verified runtime room package exists. Do not expose local workstation paths, raw object keys, or debug URLs on public/client surfaces.

## Source Bundle

Canonical source folder for this intake:

```text
F:\VENVIEWER -- TH PROJECT SPLAT OUTPUTS\lcc2-result
```

The sibling folders `New folder\lcc2-result` and `New folder (2)\lcc2-result` have the same file count, byte count, and aggregate hash as the canonical folder, so use the top-level `lcc2-result` folder as the operator source of record.

| Source | Files | Bytes | Aggregate hash |
|---|---:|---:|---|
| `lcc2-result` | 48 | 64323846 | `11f567ac16d46ac20e4565de704ac088c93b22febd02d91b4b275f297a576217` |
| `New folder\lcc2-result` | 48 | 64323846 | `11f567ac16d46ac20e4565de704ac088c93b22febd02d91b4b275f297a576217` |
| `New folder (2)\lcc2-result` | 48 | 64323846 | `11f567ac16d46ac20e4565de704ac088c93b22febd02d91b4b275f297a576217` |

## Capture Facts

From `info/report.json`:

| Field | Value |
|---|---|
| Room name | Reception Room |
| Device | PortalCam |
| Build start | 2026-06-08 16:04:14 |
| Build duration | 04:12:57 |
| Scan duration | 908.0854752063751 |
| Point cloud quantity | 2002122 |
| Report hash | `75a29580e47716e1a7d9f9ff53ff93ae7f96ea80625fb29bdcb70b270669907c` |

From `Reception Room.lcc2`:

| Field | Value |
|---|---|
| Format name | XGrids Lcc2 Splats |
| Version | 0.0.3 |
| Source | lcc |
| Data type | PortalCam |
| Splat type | `.sog` |
| Total splats | 3491322 |
| LOD splats | 2002009, 993279, 496034 |
| LCC2 hash | `f0a4c782cc0f031830404d409f5c0accdc30ed501fa562169206962ceee64f3e` |
| Manifest nodes | 75 |
| Root children | 21 |

## SOG Chunks

The source contains eight `.sog` files under `data\3dgs`. Spark 2.0 detects these files as `pcsogszip`, and Venviewer now accepts `.sog` as a supported splat extension. The LCC2 manifest is the source of truth for the bundle: the seven room chunks sum to `3491322` splats, matching `totalSplats`; `env.sog` is an environment chunk and is not included in that room total.

| File | Bytes | SHA-256 |
|---|---:|---|
| `0_0.sog` | 9017864 | `0a5b8c21327be7c747087baab237d1907e0a0277b0d019300e0d6b2e7eba0a16` |
| `0_1_0_5.sog` | 10047085 | `559dd375950966f8d1aa088a391b7105e364abc5013e7d29ea573728ab208fe1` |
| `0_1_0.sog` | 9845814 | `08c928b2556e2ba38cdf1777c806bb6b7ece249d5e7c442d20c0232ca703005c` |
| `0_15_0_0.sog` | 10279160 | `111a47f7470fc83d1dc7f0bf2e1d3aa96943dd5a453005b840597e8c491d2368` |
| `0_20_0.sog` | 8106037 | `72664ef164df58e88e018ab455f67de8c985de4e5f799fc6b45041aa804af2e4` |
| `0_6_0_0.sog` | 10368228 | `182525354cd14fa6bc8f6a54c0cbe0e39b5d5c216dd27e2cc4d44d1458ba8238` |
| `0_7_0_0.sog` | 5040628 | `3b68d24538523a559730e14d5ed1733f67d9894354e26322e20cf5f4458ccebf` |
| `env.sog` | 129565 | `1b6927a6d883634d93cc59294c77f2acc02b55da1092bdd6bd637765e8b3f7f8` |

## Local Spark Smoke

On 2026-06-13, each manifest-listed SOG was served from a temporary localhost harness and loaded with `@sparkjsdev/spark` in headless Chromium. This proves the SOG payloads are renderer-compatible on this workstation. It does not prove that a Venviewer runtime package is registered, served from object storage, visually aligned, or reviewed.

| File | Spark load result | Loaded splats |
|---|---|---:|
| `0_0.sog` | loaded | 496034 |
| `0_1_0.sog` | loaded | 561053 |
| `0_20_0.sog` | loaded | 432226 |
| `0_15_0_0.sog` | loaded | 602409 |
| `0_1_0_5.sog` | loaded | 577816 |
| `0_6_0_0.sog` | loaded | 599740 |
| `0_7_0_0.sog` | loaded | 222044 |
| `env.sog` | loaded | 3604 |

The standalone `New folder\mesh-files\Reception Room.ply` and `New folder (2)\mesh-files\Reception Room.obj` are mesh exports. The PLY header contains vertex/face elements only, not Gaussian splat properties, so these are not the primary splat runtime assets.

## Registration Posture

Allowed internal wording:

- Runtime source bundle found
- Candidate SOG runtime chunks
- Planning visual, human review required
- Runtime asset loaded, not yet verified/signed, only after a real served URL renders

Do not use any forbidden public/customer-facing claim wording from the SS++ Safe Claim Standards.

## Object Storage and Runtime Registration

Completed on 2026-06-13:

- Uploaded the canonical `lcc2-result` bundle to controlled object storage under the internal Trades Hall Reception Room XGRIDS prefix.
- Registered a capture session for `trades-hall` / `reception-room` with source `xgrids_portalcam`, device `PortalCam`, and processed-but-unverified posture.
- Registered `Reception Room.lcc2` as a manifest asset with SHA-256 `f0a4c782cc0f031830404d409f5c0accdc30ed501fa562169206962ceee64f3e`.
- Registered all eight `.sog` chunks as staged splat assets with the hashes listed above.
- Kept `0_1_0.sog` as the primary visual asset for package identity, but the runtime package API now serves the seven manifest room chunks as `visualAssetUrls`.
- Excluded `env.sog` from the served runtime room package because it is an environment chunk and is not included in the LCC2 room splat total.
- Registered runtime package `71687e9e-c23d-4f51-b3dd-a6a82c97978d` as `internal_ready` with evidence status `unverified`.
- Added a controlled API stream endpoint for R2-backed runtime assets so the browser loads through Venviewer rather than exposing a raw object-store URL.

Internal browser verification:

```text
Route: /dev/trades-hall-visual?venue=trades-hall&room=reception-room
Package: 71687e9e-c23d-4f51-b3dd-a6a82c97978d
Assets: 0_0.sog, 0_1_0.sog, 0_20_0.sog, 0_15_0_0.sog, 0_1_0_5.sog, 0_6_0_0.sog, 0_7_0_0.sog
Excluded asset: env.sog
Loaded splats: 3491322
Visible copy: Runtime asset loaded, not yet verified/signed
Screenshot: output/playwright/reception-room-runtime-real-sog-framed.png
```

This is an internal visual runtime smoke package using the provided Reception Room SOG chunks, not a complete reviewed Reception Room runtime package. The current route suppresses the procedural Grand Hall shell when the registered package is active and frames the loaded splat for internal visual QA. It does not establish signed visual alignment, room transforms, public exposure suitability, operational verification, legal compliance, fire approval, occupancy approval, accessibility guarantee, or survey-grade measurement.

## Current Runtime View Transform Limitations

The Reception Room runtime route currently uses a code-local, approximate view transform in `packages/web/src/lib/runtime-package-resolution.ts`:

```text
position: [1.11, 2.57, 2.77]
rotation: [-PI / 2, 0, 0]
scale: 0.63
```

The route also uses Reception Room-specific visual QA camera tuning:

```text
camera position: [0.2, 6.2, 13.4]
camera target: [0, 0.9, -4.15]
arrival position: [0.25, 7.15, 14.1]
arrival target: [0, 1.2, -4]
arrival duration: 1400ms
camera fov: 48
camera distance: 1.2-13.5
control speeds: pan 0.08, rotate 0.18, zoom 0.16
damping factor: 0.065
polar range: PI * 0.14 to PI * 0.48
target bounds: [-5.8, 0.7, -9.2] to [5.8, 2.35, 4.8]
camera bounds: [-6.8, 1.4, -11.8] to [6.8, 7.4, 14.2]
```

This transform rotates the XGRIDS/LCC2 Z-up SOG chunks into the Three.js Y-up scene, scales the room into the internal QA camera frame, and lifts the source bounds into view. The camera tuning starts from a high, composed interior inspection view with a cinematic FOV, a short cancellable arrival move, OrbitControls damping, slower pan/orbit/zoom response, and room-local camera/target clamps so small pointer movements do not immediately throw the viewer outside the room. It is a visual framing transform only. It is not a signed `ARF -> CVF`, `CVF -> RRF`, or room-local operational transform artifact.

2026-06-14 browser recheck: Playwright Edge at 1280 x 900 confirmed the settled first view starts inside the Reception Room, facing the room doors/columns, with the runtime package status visible as `Runtime asset loaded, not yet verified/signed (3,491,322 splats)`. This validates the QA framing fix only; metric scale, floor/wall alignment, and camera pose truth remain unverified.

2026-06-14 camera-controls tune: the route now uses a bounded runtime camera rig for registered Reception Room assets instead of a one-shot pose plus unconstrained OrbitControls. Focused tests assert the closer interior target, tighter distance limits, damping, polar limits, and bounds. Browser validation still remains visual/runtime QA only; it does not convert the approximate transform into a signed room-local transform.

2026-06-14 final camera-controls browser check: Playwright Edge at 1280 x 900 loaded the registered package with `Runtime asset loaded, not yet verified/signed (3,491,322 splats)`, no blocking responses, no request failures, no page errors, and no unexpected console output. The current start-view evidence is `output/playwright/reception-room-camera-tuned-start.png`; a small drag/orbit interaction stayed in the room and is captured at `output/playwright/reception-room-camera-tuned-after-drag.png`.

2026-06-15 camera arrival continuation: the registered Reception Room camera profile now includes a bounded 1400ms arrival pose that settles into the same reviewed QA camera target and cancels as soon as OrbitControls receives user input. Focused tests assert the arrival pose and final pose remain inside the declared camera/target bounds. Playwright Edge at 1280 x 900 loaded the registered package with no blocking responses, request failures, page errors, or unexpected console output. Current evidence: `output/playwright/reception-room-camera-arrival-settled.png` and `output/playwright/reception-room-camera-arrival-after-drag.png`. This remains presentation/QA motion only, not transform evidence.

2026-06-15 runtime QA record: added
`docs/operations/reception-room-runtime-qa-record-2026-06-15.md`, backed by
`RuntimeQaRecordV0Schema`, to capture the current internal package, served chunk
count, approximate view transform, bounded camera profile, passed QA checks, and
blocked review gates without converting the approximate view transform into a
signed room-local transform.

2026-06-16 transform registration path: added the admin storage/API path for
reviewed `TransformArtifactV0` records (`runtime_transform_artifacts`,
`/admin/assets/register-runtime-transform-artifact`, and
`/admin/assets/runtime-transform-artifacts`). This enables a future signed
Reception Room transform to be registered against package
`71687e9e-c23d-4f51-b3dd-a6a82c97978d`; it does not register or imply that
such a transform exists today.

2026-06-16 capture-control payload: the current approximate view transform now
has a ready-to-register capture-control source payload at
`docs/operations/reception-room-visual-alignment-capture-control-source-2026-06-16.json`.
It is explicitly visual-alignment-only evidence requiring human review, not a
signed TransformArtifact.

2026-06-16 visual QA review artifact: the current internal screenshot-backed
visual smoke evidence is recorded at
`docs/operations/reception-room-visual-qa-review-2026-06-16.json`, validated by
`RuntimeVisualQaReviewV0Schema`. The artifact is intentionally blocked for
approval: it records internal package loading, framing, bounded camera motion,
environment-chunk exclusion, and the composition decision, while keeping signed
transform, metric scale, floor/wall alignment, human visual review, evidence
promotion, and public exposure open.

2026-06-16 transform readiness artifact: the current path toward a signed
TransformArtifactV0 is recorded at
`docs/operations/reception-room-runtime-transform-readiness-2026-06-16.json`,
validated by `RuntimeTransformReadinessV0Schema`. The artifact is blocked as
`blocked_visual_alignment_only` because the current capture-control source is
`artist_blender_alignment_refs` with `visual_alignment_only` authority. It
lists the missing reviewed control evidence, transform candidate payload,
residual metrics, dry-run report, and inspection gates before any live signed
transform registration can be attempted.

2026-06-16 landmark-control intake packet: the first manual-landmark intake
packet is recorded at
`docs/operations/reception-room-landmark-control-intake-2026-06-16.json`,
validated by `RuntimeControlEvidencePacketV0Schema`. The packet names visible
candidate landmarks from the current runtime QA screenshots but records no ARF
source coordinates, CVF target coordinates, residuals, or human acceptance. It
is therefore evidence of what to collect next, not capture-control evidence that
can unlock a signed transform.

2026-06-16 manual-landmarks capture-control payload build report: added
`assets:build-capture-control-source-from-runtime-control` and ran it against
the current landmark-control packet. The generated report at
`docs/operations/reception-room-manual-landmarks-capture-control-build-report-2026-06-16.json`
is `blocked_current_packet` and confirms no capture-control source payload was
written because the packet still lacks reviewed coordinate pairs, accepted QA,
and closed blockers.

2026-06-16 coordinate-pair packet build report: added
`assets:build-runtime-control-packet-from-coordinate-pairs` and ran it against
the current visible-only landmark-control packet without a coordinate-pair
intake file. The generated report at
`docs/operations/reception-room-coordinate-pair-packet-build-report-2026-06-16.json`
is `blocked_missing_coordinate_pair_intake`, records four non-rejected
landmarks, zero reviewed landmarks, and no residual metrics, and writes no
reviewed runtime-control packet.

2026-06-16 coordinate-pair intake request: added
`assets:build-runtime-control-coordinate-pair-intake-request` and ran it
against the current visible-only landmark-control packet. The generated request
at
`docs/operations/reception-room-coordinate-pair-intake-request-2026-06-16.json`
lists the four required ARF to CVF landmark measurements to collect and confirms
it created no coordinate-pair intake file, reviewed packet, capture-control
source, signed transform, public exposure change, or operational geometry.

2026-06-16 coordinate-pair collection pack: added
`assets:build-runtime-control-coordinate-pair-collection-pack` and generated
`docs/operations/reception-room-coordinate-pair-collection-pack-2026-06-16.md`
from the typed intake request. This is the human-readable checklist for
collecting the four requested landmark measurements; it leaves measurement
fields blank and records no reviewed coordinate-pair intake or downstream
evidence.

2026-06-16 coordinate-pair intake inspection: added
`assets:inspect-runtime-control-coordinate-pair-intake` and ran it against the
current visible-only packet without a coordinate-pair intake file. The generated
inspection at
`docs/operations/reception-room-coordinate-pair-intake-inspection-2026-06-16.json`
is `missing_intake_file`, not ready for reviewed packet build, and records no
reviewed packet, capture-control source, signed transform, public exposure
change, or operational geometry.

2026-06-16 runtime-control evidence chain status: added
`assets:build-runtime-control-evidence-chain-status` and ran it against the
current source packet, coordinate-pair request, missing-intake inspection,
blocked packet-build report, blocked payload-build report, and transform
readiness artifact. The generated report at
`docs/operations/reception-room-runtime-control-evidence-chain-status-2026-06-16.json`
is `blocked_missing_coordinate_pair_intake`, records four required coordinate
pairs, zero reviewed coordinate pairs, and confirms no coordinate-pair intake,
reviewed packet, capture-control source, signed transform, public exposure
change, or operational geometry was created.

2026-06-16 runtime-control dashboard posture: `/admin/assets/rooms` and
`/dev/assets/rooms` now surface the same chain status for the current
Reception Room runtime package `71687e9e-c23d-4f51-b3dd-a6a82c97978d`. The
dashboard displays the blocked status, evidence ref, `0 / 4` reviewed
coordinate-pair count, and next action, while deliberately keeping newer or
different packages at `not_recorded` until their own chain status is generated.
This is an internal operator review signal only and does not promote the
current visual alignment into measurement control.

2026-06-17 SPZ re-export swapped in as the primary visual: the same PortalCam
capture was re-exported by XGRIDS to `.spz` (bundle
`reception-room_xgrids_lcc2_spz_visual`, manifest `Reception Room Mobile.lcc2`,
scanDuration `908.0854752063751` matching the original SOG intake). The seven
manifest room `.spz` chunks (`0_0`, `0_2_0`, `0_3_0`, `0_3_0_0`, `0_7_0_1`,
`0_8_0_0`, `0_13_0_0`) were uploaded to controlled object storage under
`venues/trades-hall/rooms/reception-room/xgrids/2026-06-15/lcc2-result-spz/data/3dgs`,
registered as `usable` / `unverified` splat asset versions, and the existing
runtime package `71687e9e-c23d-4f51-b3dd-a6a82c97978d` was upserted to point its
primary visual at `0_0.spz` while staying `internal_ready` / `unverified`.
`env.spz` is excluded as an environment chunk. The runtime API now serves the
manifest room chunks that match the package primary's extension (so a SOG
package still serves `.sog`, this SPZ package serves `.spz`); no SOG/SPZ
double-serving. Internal browser recheck at
`/dev/trades-hall-visual?venue=trades-hall&room=reception-room`: Spark loaded the
seven SPZ chunks (`3,455,732` splats) into the framed runtime view with the
status copy `Runtime asset loaded, not yet verified/signed.` and no splat-asset
load failures (only the expected unauthenticated adjunct-API `401`s). This is an
internal visual runtime smoke of the SPZ re-export. It does not add signed
room-local alignment, metric scale, floor/wall alignment, camera-pose truth,
exposure approval, or any public/customer-facing claim, and it does not complete
T-091 or T-091A. The prior SOG asset versions remain registered as provenance;
the package pointer can be reverted to the SOG primary if required.

Known limitations:

- The transform is derived from source bounds and visual framing, not from a reviewed venue control network, E57/Matterport alignment, or measured fixture anchors.
- The current package serves the seven SPZ room chunks directly as Spark runtime assets. The earlier SOG package remains provenance/backup; as of the 2026-06-17 SPZ swap, the LCC2 file is provenance for this package, not the runtime loader authority.
- The route proves renderer compatibility and registered package loading, not scale fidelity, floor-plane alignment, wall alignment, camera pose truth, or operational geometry. The current scale/camera tuning fixes the prior tiny outside-room spawn for QA and constrains normal camera movement, but it is still approximate.
- The procedural Grand Hall shell is intentionally suppressed when the registered package is active, so Mesh/Splat/Hybrid layer controls are not proof of mesh-to-splat alignment for Reception Room.
- The package evidence status remains `unverified`; exposure tier and human review must be completed before any public room showcase or customer-facing claim.

QA hardening added after the first browser smoke:

- The E2E route now has a no-auth-safe guard for Reception Room so unauthenticated `401` responses from internal adjunct APIs such as AI status and Truth Mode summary do not hide real runtime-package failures.
- A separate opt-in E2E guard can load the real registered Reception Room package when `E2E_RECEPTION_ROOM_RUNTIME_PACKAGE=true` and a local API/object-storage path is available. That test fails on runtime package or asset 4xx/5xx responses while allowing expected unauthenticated adjunct API `401` responses.
- The web Playwright config accepts `E2E_BROWSER_CHANNEL` so local QA can run on an installed system browser when the bundled Playwright Chromium is not present.

## Remaining Operator Steps

1. Revisit the runtime composition decision only when an LCC2-aware loader or conversion lane exists. The current package serves the seven manifest room `.spz` chunks directly, excludes `env.spz`, and keeps the LCC2 file as source-manifest provenance.

2. Add a signed room-local transform, orientation, bounds, and human visual QA notes for the Reception Room. The 2026-06-15 QA record documents the current approximate view transform only.

3. Complete human visual QA sign-off against the served runtime package and record alignment, cropping, scale, floor, and wall limitations. The 2026-06-16 visual QA review artifact is an internal blocked record, not approval.

4. Promote the transform readiness artifact only after reviewed control evidence and a dry-run signed-transform payload exist.

5. Use `docs/operations/reception-room-coordinate-pair-intake-request-2026-06-16.json` to collect the four required reviewed ARF to CVF landmark measurements, create a reviewed coordinate-pair intake file, then run `assets:inspect-runtime-control-coordinate-pair-intake` until it reports `ready_for_reviewed_packet_build`.

6. Rerun `assets:build-runtime-control-packet-from-coordinate-pairs` to produce a reviewed runtime-control packet, then rerun `assets:build-capture-control-source-from-runtime-control` against the reviewed packet to produce a manual-landmarks capture-control source payload before registration dry-run.

7. Keep public room showcase fallback copy until exposure tier and human review are explicitly approved.

8. Do not mark T-091 or T-091A complete until the required real-room scope, runtime switching behavior, and review records are satisfied.
