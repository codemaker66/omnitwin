# OmniTwin Foundry UX workflow

## Product promise

“Drop in what you have. Foundry will tell you what it is, what it can lawfully do, what is missing, what it will cost, and what evidence is required before anything becomes a venue twin.”

One-click is the final confirmation of a visible plan. It is not hidden shell work or automatic truth.

## Experience principles

1. Beginner mode uses plain language and recommended defaults.
2. Expert mode exposes the same graph/contracts with more controls; it does not bypass rights, provenance or QA.
3. Raw sources are visibly read-only.
4. Captured, enhanced, generated and concept modes are always distinguishable.
5. Every blocked state provides a next action and names who can resolve it.
6. Long work pauses/resumes, survives restarts and shows the last verified checkpoint.
7. Estimated cost, cap and kill switch are visible before remote execution.
8. Comparisons use synchronized cameras and disclose non-equivalent inputs.
9. A quality score never conceals a failed dimension.
10. Publish is a separate reviewed action through the existing Reconstruction Foundry.

## Primary flow

### 1. Home

Cards:

- Create venue project;
- Open local project;
- Resume interrupted project;
- Review private package;
- Capture companion.

Recent projects show local/private status, last verified stage, blocker and source availability. They do not show “complete” when only a plan exists.

### 2. Create project

Ask:

- venue/client and internal project ID;
- purpose: research, visual, planning, public or premium;
- capture state: empty, dressed, event/live, mixed;
- data owner/rights contact;
- local-only or remote-capable policy;
- expected rooms/session dates.

The purpose preselects a quality profile but remains reviewable.

### 3. Add sources

Large drop zone plus “Choose folder/file/object prefix.” The shell asks for scoped read-only access. Before scanning, show:

- source will not be moved or modified;
- approximate bytes/file count;
- metadata-only discovery versus full hashing;
- privacy/redaction policy;
- cancel button.

Accepted examples are grouped by value, not just extension: metric scans, imagery/video, calibration/trajectory/control, vendor exports, meshes/CAD, runtime assets and reference documents.

### 4. Inventory

Table columns:

- file/asset group;
- detected type and confidence;
- bytes/hash state;
- geometry, appearance, calibration and scale value;
- access state;
- rights status;
- coordinate frame;
- duplicate/parent relationship;
- action.

Summary cards:

- usable now;
- needs calibration/frame;
- needs rights review;
- inaccessible/proprietary;
- reference only;
- excluded.

An XGRIDS raw project shows timestamps/poses/event metadata as available and RGB/LiDAR/calibration as blocked; it never says “raw data recovered.”

Actions:

- confirm type;
- group session/device;
- supply terms/permission reference;
- mark reference-only;
- request full hash;
- open bounded metadata;
- exclude;
- contact vendor using a prefilled request.

### 5. Rights and access review

Use three independent traffic-light rows per asset:

- commercial product use;
- model training/fine-tuning;
- redistribution/export.

Yellow/unknown does not become green because the code licence is permissive. Show source-code, model-weight, dataset and capture-service terms separately. A legal reviewer can attach a dated decision and expiry.

### 6. Coordinate workspace

Views:

- frame graph;
- map/3D overlay;
- units/axes/handedness;
- camera/LiDAR/IMU calibration;
- proposed transforms;
- control/residual distributions.

Beginner text: “These two sources are not yet proven to occupy the same coordinate system.” Expert view shows matrices, quaternion convention, correspondences and residual strata.

Approval creates/references distinct typed TransformArtifact, residual-report and reviewer-attestation assets. A CRS conversion is a separate typed projection operation, not a hidden affine matrix. A visual nudge remains proposed unless it gains appropriate evidence.

### 7. Build plan

Graph nodes use operator concepts:

- Inspect;
- Register images;
- Align to venue;
- Build measured geometry;
- Build appearance;
- Understand rooms/features;
- Check quality;
- Package.

Selecting a node shows:

- mechanism and why selected;
- inputs/outputs;
- current evidence and expected quality gain;
- local/remote resource/time range;
- checkpoint/resume behavior;
- licence and source-rights policy;
- alternatives and likely failure modes;
- parameters in Expert mode.

The plan displays one recommended path plus meaningful alternatives. The backend recommender must show why each mechanism was included/excluded, its source-accuracy and rights prerequisites, licence/model posture, expected evidence, likely failure and falsifier. It cannot change rights, transforms, quality, JobSpec intent, approval or publication state. A human selects the plan. It does not create multiple branches that are parameter aliases.

Rights are purpose-aware at execution while global manifest approval remains deliberately all-purpose and fail-closed. Every plan stage shows its non-empty `rightsPurposes` and exact input assets. `validateFoundryJobRights(job, manifest)` explains which stage/input permission blocks dispatch—for example, allowing reviewed commercial-internal geometry inspection while refusing model training or redistribution—and no prose/UI override becomes permission.

### 8. Coverage and recapture

Spatial layers:

- camera positions/frusta;
- frozen fixed-view cameras and connected evaluation paths;
- path segments, keyframes, loops/room-graph connectivity and discontinuities;
- point/surface coverage;
- view count and angle diversity;
- blur/exposure/texture;
- alignment and geometry residual;
- semantic confidence;
- runtime loss;
- hero priority.

Clicking a red region gives an instruction card:

- stand/camera position in room coordinates and a visual marker;
- camera height;
- aim direction/target;
- lens/focal length or phone mode;
- number and arc of shots;
- lighting state;
- why the shot is needed;
- expected metric/quality change with confidence;
- “Send to Capture Companion.”

If the system proposes generated repair, it must also show the preferable real recapture when feasible.

### 9. Run

Before execution:

- immutable JobSpec digest;
- provider and resource fit;
- estimate, cap and warning threshold;
- source read-only badge;
- network policy;
- checkpoints;
- output location;
- trusted short-lived `FoundryExecutionConfirmation` requirement and expiry;
- trusted `FoundryRightsApproval`, including exact job/manifest digest, policy version, reviewer and expiry;
- for remote execute, trusted `computeApprovalId`, exact job-subject binding, owner, provider/adapter, cap and expiry;
- kill switch.

Buttons:

- Save plan;
- Run locally (non-training work only under current D-016 posture);
- Request remote approval;
- Run approved plan;
- Cancel/kill.

Every execution—including local—requires a fresh, single-use `FoundryExecutionConfirmation` distinct from plan creation and a trusted nonexpired `FoundryRightsApproval`. The confirmation binds `confirmationId`, exact `jobSubjectSha256`, `jobId`, confirmer and a short validity window. The rights decision binds the exact job and ingest-manifest digests, policy version, reviewer and decision time/expiry. A boolean, pasted object, mismatch or stale record cannot dispatch; the durable control plane atomically consumes `confirmationId` before starting work and refuses a replay. Remote compute approval is separately loaded from the trusted control-plane registry. Any expert edit changes the subject digest and invalidates all subject-bound capabilities. Progress is stage-based and evidence-based. “72%” means declared progress units, not a fabricated timer. Each completed stage shows verified output hashes. Restarted apps reconnect to durable state.

### 10. Results and comparison

Synchronized panels:

- source reference;
- vendor benchmark;
- owned reconstruction;
- hybrid;
- runtime encoding;
- optional generated derivative.

Controls lock camera ID/model, source resolution, exposure policy, resolution and crop. Path comparisons lock ordered keyframes, segment timing and connectivity. Panels disclose different training/source rights, derived-versus-original imagery, missing comparable cameras or disconnected coverage.

Tabs:

- Geometry;
- Appearance;
- Runtime;
- Semantics;
- Provenance;
- Failures.

Quality shows per-dimension pass/fail/unmeasured with evidence links. Hero fixed views and paths are saved, not improvised.

### 11. Truth Mode

Global filter:

- Captured only;
- Captured + deterministic/enhanced;
- Include generated cinematic;
- Concept/imagination.

Generated areas use an unobtrusive but persistent overlay/toggle, with model/version, mask, confidence and restrictions on inspection. Export inherits the mode. The operator cannot hide disclosure in a public derivative.

### 12. Human review

Separate review tasks:

- transform/control;
- measured/planning/collision geometry;
- appearance/fixed views;
- semantic graph;
- generated masks/heritage safety;
- runtime/device behavior;
- package provenance.

Reviewer decisions include role, time, evidence and note. Rejection returns to an exact stage/recapture action. The model cannot approve its own output.

### 13. Package

Show the composed room:

- metric/planning/collision/nav geometry;
- visual and hero layers;
- semantic/uncertainty assets;
- authority map;
- runtime variants and device targets;
- quality/profile status;
- rights/export restrictions.

Validate and create a private immutable candidate. If any required reference is missing, list it and disable release handoff.

### 14. Release handoff

Open the existing Reconstruction Foundry review:

- candidate digest;
- machine QA;
- human review;
- TransformArtifact/Scene Authority evidence;
- attestation;
- immutable publication;
- production pointer promotion.

The Foundry UI never exposes a shortcut to the legacy ungated latest-package path.

## Beginner mode

Beginner mode:

- presents one recommended graph;
- groups technical errors by action;
- explains metric versus visual quality;
- uses defaults tied to purpose;
- hides harmless parameters but never uncertainty;
- offers field instructions with visual examples;
- requires explicit confirmation at rights, transform, cost and publish gates.

Example error:

> Original PortalCam images and calibration are not available in an approved open form. You can continue with the exported visual model, align it to the E57 geometry, add new photos, or send the vendor data request. Foundry will not attempt to bypass the container.

## Expert mode

Expert mode adds:

- raw frame/transform graph;
- camera models, distortion/readout and clock offsets;
- algorithm/version/image digest;
- feature/matcher and solver settings;
- sampling/control strata;
- Gaussian conventions and runtime codec settings;
- worker argv/environment, resource traces and native logs;
- alternative DAG branches and experiment registry.

Expert edits create a new JobSpec digest, invalidate stale approval and are recorded in provenance.

## Error taxonomy

| Class | Example | Operator action |
|---|---|---|
| source unavailable | removable drive disconnected | reconnect same source or locate by digest |
| corrupt/hostile | E57/ZIP bounds invalid | quarantine record; reacquire/export |
| missing calibration | intrinsics/extrinsics absent | attach official bundle or choose photo self-calibration research lane |
| frame ambiguous | units/axes unknown | supply control or review proposed frame |
| rights blocked | model-training prohibited | exclude from training; legal/vendor review |
| resource mismatch | GPU VRAM too small | choose lower profile/provider or split job |
| budget block | estimate/cost cap reached | checkpoint; request new approval |
| reconstruction failure | low registration/loop closure | inspect failure map; recapture/change lane |
| QA failure | p95 residual or hero view fails | show failed strata and next test |
| runtime failure | VRAM/FPS/streaming gate fails | change LOD/codec/settings, never relabel source quality |

Every error has a stable code, plain summary, technical evidence artifact and safe next action.

## Pause, resume and cancellation

- Pause stops new work and asks checkpoint-capable workers to checkpoint.
- Cancel terminates the attempt; verified prior artifacts remain.
- Kill switch terminates provider work even if the UI disconnects.
- Resume shows exact worker/checkpoint/input compatibility.
- A changed source or setting creates a new attempt; it cannot resume under the old digest.
- Scratch cleanup is previewed, scoped to the project output root and never touches granted raw roots.

## Accessibility and field use

- keyboard and screen-reader labels for every control;
- color-independent quality/Truth states;
- large targets and offline field mode;
- high-contrast coverage overlays;
- units displayed and convertible without changing canonical meters;
- operation logs exportable as an accessible report;
- capture instructions cache locally and synchronize without losing original timestamps.

## UX success measures

| Outcome | Measure |
|---|---|
| beginner completes ingest-to-private-package | completion and intervention rate without terminal |
| no hidden destructive work | zero raw-source writes; permission audit |
| understandable blocks | correct next-action selection and support rate |
| honest truth | generated/captured classification comprehension |
| resumable long work | successful app/worker restart recovery |
| useful recapture | predicted versus actual quality gain |
| expert control | reproducible JobSpec and reduced manual pipeline edits |
| efficient review | time/corrections per room and escaped critical defects |

## Cross-platform acceptance

Test Windows, macOS and Linux:

- folder grants and 50–100 GB inventory;
- daemon/worker start, crash, restart and update rollback;
- Spark/WebGL/WebGPU camera/render parity;
- local CPU and supported GPU discovery;
- paths, Unicode and removable media;
- signed app/sidecars and permission prompts;
- no credentials or unrestricted paths in renderer/logs;
- package output equality for the same frozen fixture.
