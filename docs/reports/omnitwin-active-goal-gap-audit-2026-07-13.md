# Active goal gap audit — 2026-07-13

**Scope:** adversarial audit of the Reception Room HD objective and the local-first OmniTwin Foundry “super app” objective against the current repository, tests, reports, and available computer-vision evidence.

**Bottom line, corrected after the guided-workflow build:** computer vision proved a real Reception rendering defect and the corrected four-leaf frontier removes visible double-drawing. It did **not** prove new captured HD detail or physical accuracy. A loopback-only intake UI and local server now fingerprint a chosen source, guide a person through every file decision, compile digest-bound authority-none drafts, and compare blocked local/RunPod plan previews. The end-to-end super app is still incomplete: it has no in-browser source picker, durable resume/staging UI, real reconstruction worker, provider handoff, real captured-detail winner, or multi-room rollout proof.

## Post-audit correction — direct preview boundary

The audit correctly found that `/living-hall` could directly load ignored local
Reception SOG files in a production build. That boundary defect was fixed after
the audit evidence was collected:

- `LivingHallPage.tsx` now enables the direct Reception preview only when
  `import.meta.env.DEV` is true;
- `vite.config.ts` removes `dist/splats/reception` from every build output, even
  if a developer's local `public/` folder contains the evidence files;
- focused route/build-structure tests pass; and
- a test-mode production-shaped Vite build completed and reported
  `INTERNAL_RECEPTION_SPLATS_OMITTED`.

This closes the specific public-bundle bypass. It does not create or approve a
production runtime package; the immutable package, transform, QA, provenance,
and publication gates are still required.

## Post-audit progress — local companion and execution boundary

Two additional foundations were completed after the audit snapshot:

1. `tools/reconstruction-foundry` now has a real loopback-only local companion.
   One command checks exactly one chosen file or folder, shows progress and
   plain-language “not approved yet” reasons, and lets the operator download an
   in-memory receipt. It cannot change, copy, approve, upload, train on, or
   publish the source. Independent security review found no unresolved release
   issue after the audit fixes; the CLI suite passes 41 tests, and a real
   Reception preview-photo smoke ended in `ready`, exposed no absolute source
   directory, and shut down cleanly. Relative filenames remain intentionally
   visible, and downloaded evidence must be kept private.
2. `execution-dispatch.ts` now defines a provider-neutral prepare/commit edge
   for local CUDA and RunPod adapters. Exact manifest/admission/staging,
   worker/deployment, policy, confirmation, approval, cost, ledger, image, and
   capacity evidence is rebound before the one irreversible injected call.
   Real runners/HTTP clients remain absent and therefore no GPU, external
   provider, credential, or spend action can occur. The fully included Foundry
   suite passes 158 tests.

This changes guided admission and planning from “missing” to “partly proved.”
It does not make the requested end-to-end reconstruction app complete: staging
and resume UI, a durable transactional store, real attested workers, actual
local/cloud execution, cancellation/reconciliation, and a held-out HD winner
remain open.

## Post-audit correction — guided review and safe plan preview

The companion now supports the complete in-browser draft path for up to 500
files. Every file must be kept or left out; uncertain formats stay blocked;
proprietary XBIN is reference-only; exact duplicates cannot all be discarded;
and every artifact is bound to the exact receipt and current digest. The screen
then compares captured-only, pretrained-enhancement, or rights-gated training
intent against local CPU, local CUDA, and RunPod routes. Missing programs,
capacity, or provider price evidence stays `null` and visibly blocks the route.

This remains a planning surface, not a reconstruction runner. It has no worker
command, provider client, credential input, payment path, process-launch path,
or execution authority. The app itself creates no external client request, but
the operator must use a truly local or removable source; Windows may fetch or
sync bytes when a mapped, shared, or cloud-synced path is selected.

## Success-criteria matrix

| Goal | Verdict | What is directly proved | What is not proved | Single decisive next test |
|---|---|---|---|---|
| Reception Room HD improvement | **Partly proved** | `packages/web/src/pages/living-hall/reception-dolly-path.ts` loads only the four Quality fine leaves. Same-camera screenshots visibly show that removing parent levels removes doubled/smeared edges. | This recovers existing information; it adds no new captured detail. No v2.1 reprocess, vendor HD result, owned-photo model, hero micro-splat, or measured high-detail mesh has beaten the corrected baseline. The planner still uses DPR 0.75. | Register a rights-cleared 30-photo set, then build one dark-timber-door hero candidate. It must win on photos held out from training, near/mid/far moving views, seam checks, and runtime budget. |
| Computer-vision proof | **Partly proved** | The fixed-view matrix and LCC screenshots prove visible all-level ghosting, show the room/source appearance, and show “HD Enhancement — Not Activated.” `fixed-view-metrics.json` records large leaf-versus-invalid deltas and explicitly states its limits. | CV cannot turn a reconstruction into physical truth. The six fixture cameras share one optical centre; the LCC screenshots are not camera-matched or cryptographically bound to the fixed-view renders; no independent physical reference is present. | Capture one registered, rights-cleared photograph that is excluded from training. Render every candidate at its solved camera and compare masked feature crops plus moving views. |
| Exact runtime composition/loading | **Partly proved** | Web tests enforce the ordered four-member set and reject three-of-four, duplicates, or bad URLs. API tests enforce exact same-room usable assets. Playwright artifacts show the real 35.7 MB four-leaf local fixture resolving. Runtime-composition v1 validates hierarchy ancestry and totals. The post-audit fix makes the direct local route development-only and strips its evidence files from build output. | No new immutable Quality package revision has been created in an applied database, and no real API/R2 production-preview run has proved four requests and zero parent/environment requests. | In a disposable PostgreSQL environment, apply migration 0052, create the Quality revision, start the real API and production preview, and assert exactly four hash-pinned object requests, no ancestors/environment, and no public response before transform/QA approval. |
| Universal local intake: E57, OBJ, GLB, XGRIDS, photos, video | **Partly proved** | `inspect-intake`, admission, staging, and plan-only tests pass. Detection covers the named formats; every source starts quarantined. A real read-only run over the eight local Reception SOG files hashed 62,834,381 bytes twice to the same receipt digest and changed no source. | This is a CLI receipt/staging foundation, not reconstruction. Images remain context-ambiguous, video is extension-level intake, proprietary XBIN stays technically blocked, and no single real mixed E57/OBJ/GLB/XBIN/photo/video job has passed through a user interface. | Through a desktop/local-daemon prototype, select one real mixed-source folder, hash it, review every file, stage admitted bytes, restart/resume, and produce a plan without a terminal. XBIN must remain visibly blocked unless an official export is supplied. |
| Captured/measured/generated separation | **Partly proved** | `packages/types/src/omnitwin-foundry.ts` and its tests reject generated metric roles, require generated-region masks/lineage, and keep quality reports separate. Release review requires a Scene Authority Map. | No generated derivative has completed ingest-to-runtime review, no persistent Truth Mode has been demonstrated on a released asset, and no UI test proves a user cannot mistake generated appearance for measurement. | Release a synthetic fixture containing captured metric geometry and a masked generated visual layer. Prove promotion rejects generated geometry authority and Truth Mode hides the generated layer while retaining its disclosure. |
| Local-versus-cloud planning and handoff | **Partly proved** | `plan-only.ts` deterministically evaluates supplied local and remote routes and orders them lexicographically; it explicitly does not rank or select a winner. `execution-dispatch.ts` now rebinds the exact executable evidence and gates injected local-CUDA/RunPod adapters behind one-time confirmation, cloud approval/cost reservation, immutable ledger replay, and idempotent durable state. The fully included Foundry suite passes. | There is no recommendation contract that jointly evaluates input size, RAM/VRAM, expected duration, privacy, live queue state, required software, estimated cost, and operator preference. There is also no production durable store, attested local process runner, real RunPod client, secret path, provider monitoring/kill loop, local worker run, cloud job, cancellation, restart, or output-parity proof. The current adapters cannot act without injected implementations. | First add and test an authority-none recommendation contract covering all eight factors without dispatch authority. Then run one non-training frozen fixture locally and on one approved remote worker, requiring identical declared output hashes, bounded cost, successful cancel/restart, and one-time confirmation replay rejection. |
| Immutable provenance and human review | **Partly proved** | Migration 0052, the append-only revision service/API, runtime-composition v1, release evidence service, and Runtime Foundry review UI have focused green tests. Historical rows remain honestly `legacy`; new rows have deterministic content digests and cannot be updated/deleted by the new contract. | Migrations 0050–0052 are pending and `safeToApplyProduction` is false. No Quality revision, signed transform, final visual review, attestation, or public publication has been executed. | Apply the migration chain to a disposable production-shaped clone; race duplicate/conflicting creates, attempt update/delete/truncate, restart, and complete one private Quality revision plus exact evidence review. |
| Actual average-human super-app UI | **Partly proved** | A loopback-only local companion now gives a plain-language intake check, per-file guided admission editor, digest-bound draft downloads, and local CPU/local CUDA/RunPod plan comparison for one startup-selected source. Desktop/mobile layout QA, security review, 500/501 boundary tests, and a real Reception preview-photo smoke passed. | Starting still requires one PowerShell command. There is no drag/drop/folder picker, staging/resume UI, actual route dispatch, live byte/job progress, verified provider quote, cost approval, cancel/reconcile experience, or one-screen path to a processed and reviewed candidate. The latest post-audit copy/expiry refinements were not re-screenshotted. | Give a non-developer a clean machine and a mixed-source folder. They must complete intake through a private staged candidate using only the app, with no hidden operator intervention; then test one frozen non-training worker locally before any cloud action. |
| Rollout to the other rooms | **Not proved** | Contracts are room-generic, and Grand Hall has substantial read-only E57/COLMAP evidence work. | The recorded rollout gate still requires Grand Hall plus one contrasting smaller/darker room. Reception’s own photo/training pilot is not complete; T-501–T-503 remain not started. | Repeat the selected Reception protocol unchanged in Grand Hall and one darker/smaller room, varying only assets, reviewed transforms, cameras, and documented room thresholds. |

## Verification performed in this audit

- Foundry intake/admission/staging/plan-only: 4 files, 47 tests passed.
- Foundry CLI: 1 file, 8 tests passed.
- Web exact runtime and Living Hall frontier: 2 files, 34 tests passed.
- Generated/authority/runtime-composition contracts: 3 files, 43 tests passed with no type errors.
- Runtime Foundry review UI: 1 file, 7 tests passed.
- Runtime composition/revision/API/Quality registration: 4 files, 56 tests passed after the concurrent frontier-binding integration completed.
- Real read-only intake probe: eight Reception SOG files, 62,834,381 bytes, deterministic receipt digest on two runs; every file correctly remained quarantined and non-promotable.

These checks establish code behavior. They do not establish deployed behavior, reconstruction quality, physical accuracy, rights clearance, or operator usability.

## Approach-family coverage

`docs/reports/reception-room-quality-decision-matrix.md` retains twelve materially different mechanisms:

1. runtime/LOD/DPR correction;
2. higher-capacity source and controlled export;
3. current LCC alignment reprocessing;
4. vendor HD Enhancement;
5. full PortalCam retrain after official export;
6. owned-photo reconstruction with optional licensed E57 scaffold;
7. warm-start/refinement;
8. captured hero micro-splats;
9. measured high-detail mesh overlays;
10. separated generated cinematic derivatives;
11. targeted hero recapture;
12. full open-protocol room recapture.

The portfolio is genuinely diverse. Family 1 is implemented, and the higher-capacity family-2 Quality leaves are loaded as a private/local candidate, but family 2 has not won a controlled physical-reference review. Families 3–12 remain candidates, blocked research, or planned experiments; their presence in a matrix is not execution evidence.

## Contradictions and stale claims

1. **Corrected LOD is not new HD detail.** The current change removes double drawing and coarse-only failure. Calling that an “HD enhancement” without a captured-source winner would overstate the result.
2. **CV is not physical truth.** The metrics file itself says pairwise image similarity is not source quality, identical background can inflate agreement, and the cameras do not test view dependence.
3. **A CLI plus a plan-only dossier is not a super app.** The CLI documentation explicitly says there is no execution, training, provider SDK, publication, or promotion authority.
4. **Direct-preview release-boundary finding — fixed after this audit.** At audit time, `/living-hall` directly loaded `/splats/reception/*` without a development-build guard. The post-audit correction above now makes that route development-only and strips the local Reception evidence subtree from build output. A reviewed production package still does not exist.
5. **Planner sharpness remains unresolved.** Living Hall uses DPR 1–2, while `PlannerScene.tsx` still fixes phone, tablet, and desktop DPR at 0.75. Spark blur/preblur/SH/tone/exposure are still not a pinned Reception quality profile.
6. **Task state is stale.** `docs/state/tasks.md` still marks T-500 `not-started` even though its raw audit and much of its fixed-view diagnosis exist. The T-453 narrative and the historical June composition decision still describe seven additive chunks / 3,491,322 splats; current evidence says that composition is invalid and the fixed frontier is four leaves / 2,002,009 Gaussians.
7. **The July 12 report is superseded in part.** It says LCC capture was blocked by an active-editor warning. The later `lcc-computer-vision-evidence` bundle contains safe LCC screenshots. The report needs a dated addendum, not silent historical rewriting.
8. **Architecture documents can read more complete than the implementation.** The architecture describes durable daemon/executor/checkpoint/cancel behavior, while its status says “proposed”; no such control plane is running.

## Top three implementation gaps

1. **No real captured-detail winner — highest impact, highest evidence risk.** The core customer outcome is still absent. The only implemented visual gain is a renderer/composition correction. Build the 30-photo registration gate and one held-out hero candidate before expanding architecture further.
2. **No end-to-end operator execution path — highest product risk.** Intake, planning, review, and release pieces exist separately, but a human cannot go from folder to locally/cloud-processed candidate in the app. Build the local daemon + one safe non-training worker + guided UI vertical slice before adding more provider breadth.
3. **No deployed provenance-gated, multi-room proof — high commercial/rollout risk.** The immutable revision migration is not applied, the Quality package is not registered/reviewed, `/living-hall` bypasses the gate, and no second/third room has passed the same protocol. Close the real API/R2 route and replication gate before claiming a repeatable pipeline.
