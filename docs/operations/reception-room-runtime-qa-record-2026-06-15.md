# Reception Room Runtime QA Record

Date: 2026-06-15
Task: T-453
Schema: `RuntimeQaRecordV0Schema` in `packages/types/src/runtime-qa-record.ts`
Status: internal QA evidence record

This record captures the current Reception Room runtime package posture. It
proves a bounded internal runtime view exists for QA. It does not prove signed
room-local alignment, operational measurement, public exposure suitability, or
client-facing readiness.

## Runtime Package

| Field | Value |
| --- | --- |
| Venue | `trades-hall` |
| Room | `reception-room` |
| Runtime package | `71687e9e-c23d-4f51-b3dd-a6a82c97978d` |
| Runtime status | `internal_ready` |
| Evidence status | `unverified` |
| Internal route | `/dev/trades-hall-visual?venue=trades-hall&room=reception-room` |
| Source bundle hash | `11f567ac16d46ac20e4565de704ac088c93b22febd02d91b4b275f297a576217` |
| Source files | `48` |
| Source bytes | `64,323,846` |
| Runtime room splats | `3,491,322` |
| Served room chunks | `7` |
| Excluded environment chunks | `1` (`env.sog`) |

## Transform Posture

The current transform is an approximate view transform used to put the XGRIDS
SOG chunks into a useful internal QA camera frame.

| Field | Value |
| --- | --- |
| Posture | `approximate_view_transform` |
| Position | `[1.11, 2.57, 2.77]` |
| Rotation | `[-PI / 2, 0, 0]` |
| Scale | `0.63` |
| Signed transform artifact | none |

This transform rotates the XGRIDS/LCC2 Z-up SOG chunks into the Three.js Y-up
scene, scales them for internal inspection, and lifts the source bounds into
view. It is not a signed `ARF -> CVF`, `CVF -> RRF`, or room-local operational
transform artifact.

## Transform Registration Path

2026-06-16 update: Venviewer now has an admin-only persistence path for
reviewed runtime transform artifacts:

- `RegisterRuntimeTransformArtifactInputSchema` in `@omnitwin/types`;
- `runtime_transform_artifacts` via migration `0039_runtime_transform_artifacts`;
- `POST /admin/assets/register-runtime-transform-artifact`;
- `GET /admin/assets/runtime-transform-artifacts?runtimePackageId=...`.
- `/admin/assets/rooms` and `/dev/assets/rooms`, which surface whether the
  latest room runtime package has a reviewed transform artifact registered.

The path accepts reviewed `TransformArtifactV0` records for a runtime package
and rejects visual-only or operator-note-only transform evidence. No signed
Reception Room transform has been registered in that path yet.

2026-06-16 signed-transform operator update: the
`assets:register-runtime-transform-artifact` script now validates and registers
reviewed TransformArtifactV0 payloads through the admin API. It has no default
payload file: operators must set `RUNTIME_TRANSFORM_ARTIFACT_FILE=<path>`.
Before POST, it preflights the latest loadable runtime package for the target
room and refuses drift unless
`VENVIEWER_ALLOW_RUNTIME_TRANSFORM_PACKAGE_DRIFT=true` is set. Operators can
run the same validation and preflight without an admin token or POST by setting
`VENVIEWER_RUNTIME_TRANSFORM_DRY_RUN=true`. A live run verifies readback through
`/admin/assets/runtime-transform-artifacts` before reporting success. This is
tooling only; it does not create a signed Reception Room transform without a
reviewed payload and live operator execution.

```powershell
$env:RUNTIME_TRANSFORM_ARTIFACT_FILE = "docs/operations/<reviewed-transform-artifact>.json"
$env:VENVIEWER_RUNTIME_TRANSFORM_DRY_RUN = "true"
$env:RUNTIME_TRANSFORM_REPORT_FILE = "docs/operations/reception-room-runtime-transform-dry-run-report.json"
pnpm --filter @omnitwin/api run assets:register-runtime-transform-artifact

$env:RUNTIME_TRANSFORM_INSPECT_REPORT_FILE = "docs/operations/reception-room-runtime-transform-dry-run-report.json"
$env:RUNTIME_TRANSFORM_INSPECTION_FILE = "docs/operations/reception-room-runtime-transform-inspection.json"
pnpm --filter @omnitwin/api run assets:register-runtime-transform-artifact
```

Setting `RUNTIME_TRANSFORM_REPORT_FILE=<path>` writes a schema-validated
registration report for dry-run or live mode. Setting
`RUNTIME_TRANSFORM_INSPECT_REPORT_FILE=<report>` runs a read-only inspection of
that report before any payload load, token requirement, preflight, or POST.
`RUNTIME_TRANSFORM_INSPECTION_FILE=<path>` writes the inspection decision as a
separate machine-readable artifact. Report overwrite requires
`VENVIEWER_OVERWRITE_RUNTIME_TRANSFORM_REPORT=true`; inspection overwrite
requires `VENVIEWER_OVERWRITE_RUNTIME_TRANSFORM_INSPECTION=true`.

2026-06-16 update: Venviewer now has a persistent runtime QA/exposure review
path:

- `RuntimeQaRecordRegistrationSchema` in `@omnitwin/types`;
- `runtime_qa_records` via migration `0040_runtime_qa_records`;
- `POST /admin/assets/register-runtime-qa-record`;
- `GET /admin/assets/runtime-qa-records?runtimePackageId=...`;
- `/assets/runtime-packages/public-room-visual`, which now requires the latest
  persisted QA record to allow public exposure before returning a visual URL.

2026-06-16 hardening: approved-public QA records now also need a registered
`runtime_transform_artifacts` row for the same package, venue, room, and signed
transform artifact id. The persisted `runtime_qa_records.signed_transform_artifact_id`
must match the embedded QA record, and the public room visual endpoint checks
that linked transform row before returning any visual URL.

2026-06-16 runtime-QA operator update: the
`assets:register-runtime-qa-record` script now validates and registers explicit
runtime QA payloads through the admin API. It has no default payload file:
operators must set `RUNTIME_QA_RECORD_FILE=<path>`. Before POST, it preflights
the latest loadable runtime package for the target room and refuses package
drift unless `VENVIEWER_ALLOW_RUNTIME_QA_PACKAGE_DRIFT=true` is set. Dry-run
mode is available with `VENVIEWER_RUNTIME_QA_DRY_RUN=true`; unsigned internal
QA dry-runs do not need an admin token, while signed-transform QA dry-runs do
need `VENVIEWER_ADMIN_BEARER_TOKEN` so the script can verify the cited
`runtime_transform_artifacts` row. Runtime QA payloads that request
`approved_public` exposure are refused unless
`VENVIEWER_ALLOW_RUNTIME_QA_PUBLIC_EXPOSURE=true` is set.

```powershell
$env:RUNTIME_QA_RECORD_FILE = "docs/operations/reception-room-runtime-qa-record-payload-2026-06-16.json"
$env:VENVIEWER_RUNTIME_QA_DRY_RUN = "true"
$env:RUNTIME_QA_REPORT_FILE = "docs/operations/reception-room-runtime-qa-dry-run-report.json"
pnpm --filter @omnitwin/api run assets:register-runtime-qa-record
```

The current ready-to-dry-run payload is
`docs/operations/reception-room-runtime-qa-record-payload-2026-06-16.json`.
It records the existing internal QA posture only: unverified evidence,
approximate view transform, no signed transform artifact, and
`blocked_internal_only` public exposure.

Setting `RUNTIME_QA_REPORT_FILE=<path>` writes a schema-validated registration
report for dry-run or live mode. Report overwrite requires
`VENVIEWER_OVERWRITE_RUNTIME_QA_REPORT=true`. A live run verifies readback
through `/admin/assets/runtime-qa-records` before reporting success, and the
report records no bearer token. This is operator tooling only; it does not
register a Reception Room QA row, approve public exposure, or create a signed
transform without a reviewed payload and live operator execution.

2026-06-16 runtime-QA report inspection update: setting
`RUNTIME_QA_INSPECT_REPORT_FILE=<report>` runs a read-only inspection of an
existing runtime QA registration report before any QA payload load, token
requirement, API preflight, or POST. The inspection exits successfully only for
a schema-valid dry-run report whose payload runtime package is the latest
loadable package and whose runtime-package drift override is disabled. Signed
transform QA reports must also show registered signed-transform readback.
Registered reports are treated as valid audit evidence, not authorization for
another POST. Setting `RUNTIME_QA_INSPECTION_FILE=<path>` writes a separate
machine-readable inspection artifact validated by
`RuntimeQaRecordRegistrationReportInspectionSchema`; it refuses overwrite
unless `VENVIEWER_OVERWRITE_RUNTIME_QA_INSPECTION=true` is set. This mode does
not register a live QA row, approve public exposure, create a signed transform,
or call the API.

```powershell
$env:RUNTIME_QA_INSPECT_REPORT_FILE = "docs/operations/reception-room-runtime-qa-dry-run-report.json"
$env:RUNTIME_QA_INSPECTION_FILE = "docs/operations/reception-room-runtime-qa-inspection.json"
pnpm --filter @omnitwin/api run assets:register-runtime-qa-record
```

2026-06-16 local dry-run evidence: the current payload was validated against a
running local API at `http://127.0.0.1:3001`. The latest loadable runtime
package for `trades-hall/reception-room` was
`71687e9e-c23d-4f51-b3dd-a6a82c97978d`, matching the payload package id. The
non-mutating run wrote
`docs/operations/reception-room-runtime-qa-dry-run-report-2026-06-16.json`,
and read-only inspection wrote
`docs/operations/reception-room-runtime-qa-inspection-2026-06-16.json` with
status `ready_for_live_qa_registration`. This proves current-package preflight
for live QA registration only. It did not send a POST, register a QA row,
create a signed transform, or approve public exposure.

No public exposure approval record has been registered for this Reception Room
package. The public room visual endpoint must therefore continue returning the
client-safe fallback for this room.

2026-06-16 dashboard update: `/admin/assets/rooms` and `/dev/assets/rooms` now
surface the latest persisted runtime QA/exposure posture for the current runtime
package, including QA record id, public exposure decision, signed transform
artifact id, and whether that transform link is current. This is internal
operator status only; it is not a public approval record.

2026-06-16 capture-control update: Venviewer now has an admin-only
capture-control source evidence intake path:

- `CaptureControlSourceRegistrationSchema` and
  `RegisterCaptureControlSourceRecordInputSchema` in `@omnitwin/types`;
- `capture_control_source_records` via migration
  `0041_capture_control_sources`;
- `POST /admin/assets/register-capture-control-source`;
- `GET /admin/assets/capture-control-sources`.

This path can register the Reception Room landmark/control evidence needed
before a signed TransformArtifact is created. No Reception Room control source
or signed transform has been registered in this path yet.

2026-06-16 dashboard update: `/admin/assets/rooms` and `/dev/assets/rooms` now
surface capture-control posture for each room: source registration state,
latest source id, latest source QA status, transform artifact link, and whether
that link matches the latest reviewed runtime transform. This is an internal
operator review surface only. It does not claim Reception Room has a signed
room-local transform until a reviewed control source and TransformArtifact are
registered.

2026-06-16 ready-to-register visual-alignment source: the current
Reception Room approximate view transform is captured as a package-scoped
capture-control payload at
`docs/operations/reception-room-visual-alignment-capture-control-source-2026-06-16.json`.
The payload is intentionally classified as `artist_blender_alignment_refs`,
`visual_alignment_only`, and `requires_human_review`. Operators can post it
through the admin API with:

```powershell
$env:VENVIEWER_ADMIN_BEARER_TOKEN = "<admin Clerk JWT>"
pnpm --filter @omnitwin/api run assets:register-capture-control-source
```

Before live registration, operators can create and inspect a non-mutating
preflight report:

```powershell
$env:VENVIEWER_CAPTURE_CONTROL_DRY_RUN = "true"
$env:CAPTURE_CONTROL_REPORT_FILE = "docs/operations/reception-room-capture-control-dry-run-report.json"
pnpm --filter @omnitwin/api run assets:register-capture-control-source

$env:CAPTURE_CONTROL_INSPECT_REPORT_FILE = "docs/operations/reception-room-capture-control-dry-run-report.json"
$env:CAPTURE_CONTROL_INSPECTION_FILE = "docs/operations/reception-room-capture-control-inspection.json"
pnpm --filter @omnitwin/api run assets:register-capture-control-source
```

No live registration was performed by adding this payload, and it does not
create or imply a signed room-local transform.

2026-06-16 local capture-control dry-run evidence: the visual-alignment payload
was validated against a running local API at `http://127.0.0.1:3001`. The
latest loadable runtime package for `trades-hall/reception-room` was
`71687e9e-c23d-4f51-b3dd-a6a82c97978d`, matching the payload package id. The
non-mutating run wrote
`docs/operations/reception-room-capture-control-dry-run-report-2026-06-16.json`,
and read-only inspection wrote
`docs/operations/reception-room-capture-control-inspection-2026-06-16.json`
with status `ready_for_live_registration`. `VENVIEWER_ADMIN_BEARER_TOKEN` was
not present in this environment, so no live POST was attempted. This proves
current-package preflight only; it does not register a live capture-control
source, create a signed TransformArtifact, or approve public exposure.

2026-06-16 runtime composition decision update: the current package will
continue serving the seven manifest room `.sog` chunks directly through
`visualAssetUrls`, in API filename order, while excluding `env.sog`. The LCC2
file is recorded as source-manifest provenance, not as the runtime loader
authority. The typed decision artifact is
`docs/operations/reception-room-runtime-composition-decision-2026-06-16.json`
and is validated by `RuntimeCompositionDecisionV0Schema`. This closes the
operator decision about the current package composition, but it does not create
an LCC2-aware loader, conversion lane, signed transform, operational geometry,
or public exposure approval.

2026-06-16 visual QA review artifact update: the current screenshot-backed
operator review is now recorded at
`docs/operations/reception-room-visual-qa-review-2026-06-16.json` and validated
by `RuntimeVisualQaReviewV0Schema`. Its disposition is
`blocked_needs_human_review`, with `approximate_view_transform_only` and
`blocked_internal_only` public exposure. It records internal visual smoke
evidence only; it does not create a human review overlay, register a signed
transform, promote evidence status, create operational geometry, or approve
public exposure.

2026-06-16 transform readiness artifact update: the signed-transform readiness
posture is now recorded at
`docs/operations/reception-room-runtime-transform-readiness-2026-06-16.json`
and validated by `RuntimeTransformReadinessV0Schema`. The current disposition
is `blocked_visual_alignment_only` because the only package-scoped
capture-control evidence is the approximate visual alignment source. The
readiness artifact records the missing `ARF -> CVF` room-local metric alignment
and `CVF -> RRF` renderer-frame mapping requirements, but it does not create a
TransformArtifactV0 payload, register a signed transform, mutate capture-control
evidence, promote evidence status, or approve public exposure.

2026-06-16 landmark-control intake update: the first Reception Room manual
landmark/control packet is recorded at
`docs/operations/reception-room-landmark-control-intake-2026-06-16.json` and
validated by `RuntimeControlEvidencePacketV0Schema`. It names visible candidate
architectural landmarks from the runtime QA screenshots only. It records no
ARF source coordinates, no CVF target coordinates, no residuals, and no human
acceptance, so it cannot be registered as a capture-control source or used to
create a signed TransformArtifactV0.

2026-06-16 manual-landmarks payload-build update: the
`assets:build-capture-control-source-from-runtime-control` script now reads a
`RuntimeControlEvidencePacketV0Schema` packet and writes a capture-control
source payload only when the packet has reviewed coordinate pairs and accepted
or human-reviewed QA. The current Reception Room build report at
`docs/operations/reception-room-manual-landmarks-capture-control-build-report-2026-06-16.json`
is `blocked_current_packet`, writes no payload, and records that no live
registration, signed transform, public exposure change, or operational geometry
was created.

2026-06-16 coordinate-pair intake-request update: the
`assets:build-runtime-control-coordinate-pair-intake-request` script now emits
the source-packet-derived list of landmark measurements needed before a
reviewed coordinate-pair intake can exist. The current request at
`docs/operations/reception-room-coordinate-pair-intake-request-2026-06-16.json`
lists four required ARF to CVF landmark coordinate-pair observations and
records no coordinate values, reviewed packet, capture-control source, signed
transform, public exposure change, or operational geometry.

2026-06-16 coordinate-pair collection-pack update: the
`assets:build-runtime-control-coordinate-pair-collection-pack` script now turns
that typed request into the operator-facing Markdown collection checklist at
`docs/operations/reception-room-coordinate-pair-collection-pack-2026-06-16.md`.
The pack lists the four required landmark rows and leaves ARF source
coordinate, CVF target coordinate, residual, reviewer role, and measurement
evidence-ref fields blank for collection. It is not a reviewed intake artifact
and creates no reviewed packet, capture-control source, signed transform,
public exposure change, or operational geometry.

2026-06-16 coordinate-pair packet-build update: the
`assets:build-runtime-control-packet-from-coordinate-pairs` script now reads the
visible-candidate packet plus a separate reviewed coordinate-pair intake file
and writes a reviewed runtime-control packet only when every non-rejected
landmark has matching source and target coordinates, residuals, and
human-reviewed or accepted QA. The current build report at
`docs/operations/reception-room-coordinate-pair-packet-build-report-2026-06-16.json`
is `blocked_missing_coordinate_pair_intake`, records zero reviewed landmarks,
and writes no reviewed packet, capture-control source, signed transform, public
exposure change, or operational geometry.

2026-06-16 coordinate-pair intake-inspection update: the
`assets:inspect-runtime-control-coordinate-pair-intake` script now validates a
reviewed coordinate-pair intake file before packet build. The current inspection
at
`docs/operations/reception-room-coordinate-pair-intake-inspection-2026-06-16.json`
is `missing_intake_file`, not ready for reviewed packet build, and records no
reviewed packet, capture-control source, signed transform, public exposure
change, or operational geometry.

2026-06-16 runtime-control evidence-chain update: the
`assets:build-runtime-control-evidence-chain-status` script now summarizes the
current source packet, coordinate-pair request, intake inspection,
coordinate-pair packet-build report, manual-landmarks payload-build report, and
transform-readiness artifact as one typed chain-status report. The current
report at
`docs/operations/reception-room-runtime-control-evidence-chain-status-2026-06-16.json`
is `blocked_missing_coordinate_pair_intake`, records four required coordinate
pairs and zero reviewed coordinate pairs, and records no coordinate-pair
intake, reviewed packet, capture-control source, signed transform, public
exposure change, or operational geometry.

2026-06-16 runtime-control dashboard posture update: `/admin/assets/rooms` and
`/dev/assets/rooms` now surface that current chain status for Reception Room
runtime package `71687e9e-c23d-4f51-b3dd-a6a82c97978d`, including the evidence
ref, four required coordinate pairs, zero reviewed coordinate pairs, safe copy,
and next action. The dashboard only reports this status for that exact package;
newer or different runtime packages stay `not_recorded` until their own chain
status is regenerated. This does not create reviewed coordinate-pair intake,
a reviewed packet, a capture-control source, a signed transform, public
exposure, or operational geometry.

2026-06-16 dashboard authority update: `/admin/assets/rooms` and
`/dev/assets/rooms` now surface capture-control source class, pose authority,
and alignment method values. The current approximate Reception Room source will
therefore show as `artist_blender_alignment_refs`, `visual_alignment_only`, and
`visual_alignment`, with the safe copy "visual-only alignment source recorded;
not measurement control." This is deliberately lower authority than measured,
fiducial, manual-landmark, or signed-transform evidence.

2026-06-16 dashboard staleness update: `/admin/assets/rooms` and
`/dev/assets/rooms` now surface capture-control `staleWhen` triggers for the
latest source record. The current approximate Reception Room source declares
`runtime_package_changed` and `scene_authority_map_changed`, so the dashboard
shows these as internal operator warnings. This does not perform live source
registration, does not create a signed transform, and does not approve public
exposure.

2026-06-16 evaluated dashboard update: `/admin/assets/rooms` and
`/dev/assets/rooms` now also distinguish static staleness policy from active
stale evidence. A capture-control source linked to an older runtime package is
surfaced as `stale_for_runtime_package` when its `staleWhen` policy includes
`runtime_package_changed`, instead of disappearing as missing evidence. This is
an internal review signal only; it does not alter the Reception Room package's
unsigned transform posture.

2026-06-16 route regression update: `/admin/assets/rooms` now has a focused
Fastify regression proving the stale capture-control response shape from
ordered route rows. The regression uses mocked rows and schema-parsed route
output; it is not live database registration and does not create a signed
Reception Room transform.

2026-06-16 operator registration update: the
`assets:register-capture-control-source` script now verifies readback after a
successful POST by checking both `/admin/assets/capture-control-sources` and
`/admin/assets/rooms`. A real operator run must now prove the source is visible
through the evidence route as the exact persisted row id returned by POST and
surfaced as the latest room capture-control source before the script reports
success. This update adds verification tooling only; it does not register the
Reception Room source in a live database.

2026-06-16 row-id readback update: `/admin/assets/rooms` now includes
`latestCaptureControlSourceRecordId`, the internal Trades Hall asset dashboard
surfaces that id, and `CAPTURE_CONTROL_REPORT_FILE` reports include the same
room-status id. The operator script refuses success if the room-status row id
does not match the capture-control row returned by POST.

2026-06-16 room-status identity update: registration reports now include the
room-status source id, source class, pose authority, and QA status readback.
The shared report schema and operator script reject readback drift from the
submitted and registered capture-control source.

2026-06-16 runtime-package preflight update: before POST, the operator script
now checks the latest loadable runtime package for the target room and refuses
to register package-scoped capture-control evidence if the payload
`runtimePackageId` has drifted. Bypassing this preflight requires
`VENVIEWER_ALLOW_CAPTURE_CONTROL_RUNTIME_PACKAGE_DRIFT=true`, intended only for
explicit audit/backfill work.

2026-06-16 dry-run update: operators can now run the same payload validation
and runtime-package preflight without mutation by setting
`VENVIEWER_CAPTURE_CONTROL_DRY_RUN=true`. The dry run does not require an admin
token because it does not POST or read admin-only evidence routes; it reports
the payload package id, latest loadable package id, and drift override state.

2026-06-16 report artifact update: setting
`CAPTURE_CONTROL_REPORT_FILE=<path>` writes a machine-readable registration
report for either dry-run or live registration mode. The report records payload
identity, runtime-package preflight, guardrail overrides, and, after live
registration, the registered source id plus room-status readback. It does not
record bearer tokens, create a signed transform, or alter public exposure.
The script refuses to overwrite an existing report file before preflight or
POST unless `VENVIEWER_OVERWRITE_CAPTURE_CONTROL_REPORT=true` is set.
The report shape is validated by `CaptureControlRegistrationReportSchema` in
`@omnitwin/types`, including dry-run/non-mutating and registered-readback
guards. The schema also rejects reports whose payload and preflight runtime
package ids disagree, whose registered source/QA readback drifts from the
submitted payload, or whose room-status readback is stale without the explicit
stale-readback override.

2026-06-16 report inspection update: setting
`CAPTURE_CONTROL_INSPECT_REPORT_FILE=<report>` runs a read-only inspection of
an existing report before any payload load, token requirement, API preflight, or
POST. The inspection exits successfully only for a schema-valid dry-run report
whose payload runtime package is the latest loadable package and whose drift
and stale-readback overrides are disabled. Registered reports are treated as
valid audit evidence, not authorization for another POST. Setting
`CAPTURE_CONTROL_INSPECTION_FILE=<path>` writes a separate machine-readable
inspection artifact validated by
`CaptureControlRegistrationReportInspectionSchema`; it refuses overwrite unless
`VENVIEWER_OVERWRITE_CAPTURE_CONTROL_INSPECTION=true` is set. This mode does
not register a live source, create a signed transform, or change public
exposure.

2026-06-16 stale-readback guard update: the operator script now fails closed if
the room dashboard readback marks the source `stale_for_runtime_package`.
Accepting stale readback requires the explicit
`VENVIEWER_ALLOW_STALE_CAPTURE_CONTROL_READBACK=true` override, intended only
for audit/backfill cases where stale evidence is being registered deliberately.

## Camera Profile

| Field | Value |
| --- | --- |
| Settled position | `[0.2, 6.2, 13.4]` |
| Settled target | `[0, 0.9, -4.15]` |
| Arrival position | `[0.25, 7.15, 14.1]` |
| Arrival target | `[0, 1.2, -4]` |
| Arrival duration | `1400ms` |
| FOV | `48` |
| Target bounds | `[-5.8, 0.7, -9.2]` to `[5.8, 2.35, 4.8]` |
| Camera bounds | `[-6.8, 1.4, -11.8]` to `[6.8, 7.4, 14.2]` |

## QA Checks

| Check | Status | Evidence |
| --- | --- | --- |
| Runtime package resolves | passed | `output/playwright/reception-room-camera-arrival-settled.png` |
| Served chunk count | passed | `docs/operations/reception-room-runtime-intake-2026-06-13.md` |
| Spark payload loads | passed | `output/playwright/reception-room-camera-arrival-settled.png` |
| Camera framing | passed | `output/playwright/reception-room-camera-arrival-settled.png` |
| User orbit bounds | passed | `output/playwright/reception-room-camera-arrival-after-drag.png` |
| Approximate view transform documented | passed | this record and the intake note |
| Signed transform artifact | requires human review | none recorded |
| Metric scale alignment | not checked | requires measured anchors |
| Floor/wall alignment | not checked | requires reviewed room geometry |
| LCC2 LOD graph | requires human review | current loader serves manifest room chunks directly |
| Public exposure review | blocked | requires review and signed transform evidence |

## Claim Boundary

Allowed internal wording:

- Runtime package resolves for internal QA.
- Runtime asset loaded, not yet verified or signed.
- Approximate view transform.
- Human review required.

Blocked wording:

- public-ready runtime room;
- exact venue twin;
- occupancy approval;
- legal approval;
- accessibility guarantee.

## Required Before Public Exposure

1. Signed room-local transform artifact.
2. Human visual QA review with floor, wall, and scale notes.
3. Exposure review record.
4. LCC2/LOD loader decision, or a documented decision to keep serving room
   chunks directly with known limitations.
5. Public copy review against the safe-claim guard.

Until those items exist, the Reception Room remains an internal QA runtime
package only.
