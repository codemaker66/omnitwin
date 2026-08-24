# Current viewer super-pipeline alignment

Audit baseline: `4c7a34bd7bbe77d16bf36c4c82354737073a497a` (`feat: add exact Grand Hall capture runtime`)
Scope: read-only review of the exact-runtime implementation against the Grand Hall visual canonical strategy

## Direct verdict

The commit is the strongest compatible starting point: it establishes an exact, authenticated, capture-only Grand Hall appearance layer and closes unsafe generic fallbacks. It does not yet implement the RoomScene compositor, structural runtime, fixed-camera lineage harness or multi-tier derivatives.

Status: **YELLOW foundation; RED against the complete continuation acceptance criteria.** Preserve the exact admission and fail-closed behaviour, then refactor the hard-coded Grand Hall path into typed, capability-driven composition.

## Implemented and preserved

- Spark `2.0.0` / Three `0.180.0` runtime.
- Immutable eleven-member Grand Hall SOG contract: 106,479,738 bytes and 6,019,684 decoded Gaussians.
- Authenticated same-server metadata/member delivery with strict headers, per-member SHA-256 verification, maximum member size and one absolute ten-minute load deadline.
- Invisible, detached decode followed by atomic full-frontier attachment; any mismatch, timeout, remount or stale callback disposes the resource and leaves architecture blank.
- Platform-admin intake that is disabled by default, target/deployed-SHA bound, read/write-principal separated, conditional-create/read-back verified and atomically registered.
- Protected Grand Hall namespace excluded from generic registration, legacy serving and unverified discovery paths.
- Source-only product policy: no procedural shell, architectural ink, furniture, planning overlays, clipping, simulation, editing or operational geometry claims.
- Exterior facade assets remain in the repository as separate venue-presentation material. They are intentionally not mounted in the individual Grand Hall runtime.

## Baseline scene architecture at `4c7a34bd`

Generic planner rooms compose procedural `RoomMesh`, `InkArchitectureLayer`, `CockpitSplatLayer`, planner overlays and generic cameras. Mesh/Splat/Hybrid transitions are eased and chunk-aware.

At baseline commit `4c7a34bd`, the protected capture-only Trades Hall Grand Hall is a hard-coded exception:

```text
PlannerScene
└── captured-room-source
    └── ExactGrandHallSplatLayer
```

`planner-layer-composition.ts` resolves `captured-only` from venue/room identity and suppresses every procedural/operational layer. This is an effective safety scaffold, not a general RoomScene contract. The visual route also contains a second, large renderer/control implementation instead of consuming one shared compositor.

## Baseline The Room Resolves

For generic rooms, real chunk arrivals drive blueprint ink → developing capture → resolved capture; permanent failures settle honestly while ink persists. For exact Grand Hall, all member callbacks occur only after atomic attachment, so the truthful sequence is blank → fully attached captured asset. No fake loader was introduced.

The target extension is per-layer load state:

```text
reviewed structural proxy
→ captured appearance
→ bounded hero layers
→ semantic and planner layers
```

Only real declared layers may participate.

## Baseline runtime findings

| Area | Baseline fact | Required target |
| --- | --- | --- |
| Transform | Z-up to Three Y-up, scale 1, source centred, lowest captured point at Y=0; inspection-only | Reviewed `TransformArtifactV0` alignment for any metric or planning use |
| Camera | Grand Hall FOV 48°, overview orbit roughly 40.6 m from target | Separate calibrated human-scale and orbit/dollhouse profiles |
| Bounds | Planner OrbitControls has distance/polar limits but does not clamp declared target/camera AABBs | Structural room-volume containment, safe spawn and portal-aware navigation |
| Collision | None; package collision, semantic and point-cloud references are null | Replaceable structural proxy, collision capsule, floor following and escape prevention |
| Cutaway | Disabled for exact Grand Hall | Structurally defined cutaway groups/proxy fading |
| Appearance | One exact fine SOG frontier | Registered masters, hero layers and direct-from-master runtime tiers |
| Performance | Sequential ~106 MB fetch; complete verified buffers retained while ~6 M Gaussians decode | Measured peak RAM/VRAM, frame/GPU timings and tier budgets |

The separate `packages/web/src/twin` viewer has walk/dollhouse/plan modes and mesh cutaway work, but it is not integrated with the Grand Hall compositor and does not provide a free collision controller for this scene.

## Baseline manifest and authority alignment

`venviewer.runtime-package.v1` binds ordered visual assets and nullable semantic mesh, collision and point-cloud assets, but it does not describe a compositional layer graph, truth class, rights or quality evidence. `RuntimeVenueManifestV0` already supplies typed assets, splat/mesh layers, bounds and `TransformArtifactV0`, while Foundry supplies rights, provenance, quality evidence, canonical packages and Scene Authority Maps. The current web/API runtime does not consume `RuntimeVenueManifestV0`.

The smallest coherent next contract should adapt those existing conventions into a RoomScene read model with:

- structural authority;
- captured appearance;
- hero, material and semantic layers;
- generated and runtime derivatives;
- planner layers;
- source rights, transforms and quality evidence;
- explicit truth class and independent geometry/appearance/physics/semantic authority.

Do not create a parallel fourth manifest vocabulary. Reconcile `MEASURED`, `CAPTURED`, `RECONSTRUCTED`, `ENHANCED_CAPTURED`, `GENERATED_CINEMATIC` and `PROCEDURAL_PLANNER` with existing Foundry provenance and transform semantics.

## Baseline rights record finding

`docs/operations/grand-hall-captured-runtime-contract-2026-08-21.md` records the owner's authority and the external documentary-evidence location requirement. Historical `docs/operations/grand-hall-pilot-ingest-manifest-2026-07-19.json` still contains earlier `requires_review` and restricted training/redistribution decisions. Add a new ledger revision for the owner's confirmed scope; do not rewrite the historical evidence. Unrelated research code and model-weight licences remain separate audits.

## Baseline visual diagnosis and evidence

At baseline commit `4c7a34bd`, no deterministic LCC/PLY/SOG/SPZ/Venviewer fixed-camera harness existed. There were no exact-runtime screenshots, browser/WebGL acceptance results or measured GPU/frame results. The attached product mockups are references, not runtime evidence. The T-541 delta below adds a local source-fixture diagnostic; it does not retroactively establish authenticated package acceptance.

Generative pixels remain deferred until fixed-camera lineage diagnosis identifies capture, reconstruction, encoding or renderer loss. NHT, 3DGUT, Hero Volumes, Fixer/ArtiFixer, super-resolution and relighting remain integration points or later evidence-gated tasks, not active layers.

## Verification already recorded

The commit's session log records:

- API typecheck, lint and build passed;
- API suite: 160 files / 2,870 tests, 5 intentional skips;
- focused intake matrix: 188/188;
- web application/E2E typecheck, lint and build passed;
- web suite: 329 files / 4,117 tests;
- exact renderer/editor/WebGL-boundary/visual-route/lifecycle/cockpit bundle: 168/168;
- deadline/remount bundle: 105/105; and
- `git diff --check` passed.

These are implementation records, not evidence of deployment, live R2 conditional-create behaviour, database mutation, authenticated browser rendering, WebGL acceptance, structural geometry or performance.

## Recommended continuation boundary

Keep the exact source contract, transport, loader, intake and fail-closed entry guards. Refactor hard-coded venue policy, `PlannerScene`, `ExactGrandHallSplatLayer`, the duplicate visual route, runtime camera resolution and cockpit state behind generic layer capabilities. Extend existing manifests, provenance, tests and The Room Resolves. Remove no captured-runtime work.

The reviewed successor resolves the intake credential representation gap: the environment requires the temporary access-key/secret/session-token triple, and only the intake writer receives its session token. The owner has authorized the dedicated staging target and authenticated staging-only browser QA; provisioning, push, deployment, intake, and QA remain unexecuted.

## T-541 vertical-slice delta — 2026-08-23

The audit baseline above describes commit `4c7a34bd` before the T-541
vertical slice. The exact loader, transport, intake contract, and
capture-only Grand Hall policy remain preserved. T-541 adds a thin typed
composition layer around them; it does not activate storage, register a
package, or generalise the entire venue runtime.

Current mapping:

| Required continuation surface | Implemented delta | Evidence boundary |
|---|---|---|
| Permanent truth/layer vocabulary | Strict Zod/TypeScript `RoomSceneManifestV0` with six truth classes, seven layer slots, explicit rights, quality evidence, registration, authority, and cross-reference checks | A declared class is not proof of accuracy or spatial authority |
| Scene composition | `RoomSceneCompositor` mounts stable groups only for declared descriptors; `resolveRoomSceneComposition` applies explicit appearance/proxy selection and no-substitution behavior | Missing or failed appearance stays missing/failed; no procedural fallback |
| Grand Hall appearance | Existing exact eleven-member atomic loader is registered as `Appearance` / `CAPTURED`, with appearance authority only | Same immutable source and receipt as T-540; no new delivery path |
| Structural development view | Hidden `StructuralProxy` / `RECONSTRUCTED` wire witness for SOG bounds, pose-centre envelope, and an unreviewed diagnostic spawn | `source_extent_not_room_shell`; not walls, floor, portals, measured alignment, or collision |
| Human scale and camera | Default orbit starts at transformed source pose 19,890 inside the Hall; orbit/dollhouse coordinates stay inside the q05/q95 captured-pose envelope; the 1.65 m-eye human mode retains its source-derived diagnostic spawn and clamp | Camera position is source-derived, but look direction/FOV remain inspection choices; human Y remains pinned to an unreviewed floor candidate; none of this prevents wall crossing or certifies containment/collision |
| The Room Resolves | Aggregate visible-layer state maps sanitized totals and fail-closed `failed → absent → loading → ready` precedence into atomic readiness, progress, failure, or absence | Appearance cannot resolve before every visible declared appearance composition member reports complete; partial/zero-unit `ready` is rejected |
| Lineage diagnosis | Dev-only fixed-camera SOG/SPZ harness pins viewport, DPR, source-pose interior camera and source transform; applies the LCC2-declared depth sort; serves immutable pre-hashed buffers; records post-render camera, colour pipeline, resolved Spark state, receipts, timings and screenshots; and atomically writes schema-validated output. Fresh v1 frames show the coherent room-wide Grand Hall to Codex | Camera orientation/FOV remain inspection-only, most numeric Spark settings are resolved inherited defaults rather than a controlled explicit profile, and human visual acceptance is separate and required before `passed` |
| Rights/provenance | Typed append-only `state/source_rights.json` records separate owner-confirmed XGRIDS and Matterport scope plus redistribution and third-party dissemination, with documentary placeholders | Unrelated code, SDK, research, model-weight, checkpoint, and provider licences remain separate |

Focused verification was rerun after the fail-closed authority and lineage
hardening; exact final command counts are recorded in the handoff and session
log. The real-key production build and
authenticated staging/package QA remain separate gates.

T-541's local vertical slice is complete at **YELLOW**. The requested
compositor/proxy/lineage slice exists, and corrected local SOG/SPZ diagnostics now show a coherent
Grand Hall rather than the rejected external-shell view. Formal human visual
acceptance remains pending, and the complete super-pipeline still lacks
reviewed room-local structure/collision, native-LCC matched-camera evidence, a
Gaussian PLY source, signed transforms, runtime tiers, staging intake,
hardware-browser acceptance, and any approved generated cinematic derivative.

The production web build additionally requires a real live
`VITE_CLERK_PUBLISHABLE_KEY`; it must be configured through the provider secret
manager, not faked or bypassed. A later staging run also requires the selected
target/API origin, split runtime-read/temporary-intake-write storage credentials,
and a process-local admin token. Authenticated staging-only browser/WebGL QA is
authorized but unexecuted. No generative
provider key is needed for the current source-faithful slice.
