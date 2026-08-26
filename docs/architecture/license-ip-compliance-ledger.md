# License & IP Compliance Ledger

Status: Active operations / architecture doctrine  
Date: 2026-05-01  
Source: LICENSE-IP-001  
Depends on: Venviewer Artifact Registry, Exposure Tier, Research Ingestion Guard  
Relates to: Residual Radiance Layer, Guest Flow Replay, Lighting Context Package, RuntimePackage, Proof-of-Reality, Artifact Registry, public copy safety

## Purpose

The License & IP Compliance Ledger is Venviewer's governance record for third-party tools, libraries, research repositories, model assets, encoders, simulators, and benchmark systems before they become production dependencies, shipped runtime assets, or relied-on evidence generators.

Recent architecture work references JuPedSim, PedPy, Vadere, MILo, Gaussian Frosting, Spark 2.0, Niantic SPZ, KTX2/BasisU, Recast/Detour, ORCA/RVO2, Pathfinder, MassMotion, AnyLogic, and other neural research repositories. These are not interchangeable from a license, redistribution, acquisition-risk, or customer-evidence perspective. A technically promising tool can still be blocked for production if its license or data rights are incompatible with Venviewer's deployment model.

This doctrine is operations and architecture planning only. It does not install packages, change dependencies, implement runtime code, change public copy, rename packages, or provide legal advice.

## Scope

The ledger applies to:

- production runtime dependencies
- server-side dependencies
- offline training and reconstruction tools
- research repositories and model weights
- simulator and benchmark tools
- media/geometry/texture encoders and decoders
- generated-artifact toolchains
- datasets or capture-derived training inputs when external rights attach
- commercial tools used for comparison, review, or expert benchmarking

Internal experiments may move faster than production integration, but they still need ledger visibility when they generate artifacts, reports, metrics, or decisions that might later influence customer-facing work.

## Required Ledger Fields

Every reviewed dependency or tool should record:

The user-facing ledger column names are: dependency/tool, purpose, license, source URL, production/research/benchmark status, runtime/server/offline use, redistribution risk, attribution requirements, copyleft obligations, commercial restrictions, acquisition-risk note, and approved/blocked/research-only status.

| Field | Meaning |
|---|---|
| `dependencyTool` | Tool, package, repository, simulator, model, dataset, or service name. |
| `purpose` | Why Venviewer wants it: runtime splat rendering, flow simulation, trajectory metrics, residual training, compression, benchmark comparison, export, etc. |
| `license` | License name/version or "unknown pending review". Include dual-license or custom terms when relevant. |
| `sourceUrl` | Official repository, package page, vendor page, or license page used for review. |
| `productionResearchBenchmarkStatus` | `production`, `research`, `benchmark`, `candidate`, `blocked`, or `unknown`. |
| `runtimeServerOfflineUse` | `runtime`, `server`, `offline`, `cli`, `browser`, `wasm`, `cloud_service`, or `benchmark_only`. |
| `redistributionRisk` | Low/medium/high risk summary for shipping binaries, source, WASM, assets, model weights, or generated outputs. |
| `attributionRequirements` | Notices, license files, UI/about-page attribution, generated-artifact attribution, or report footnotes. |
| `copyleftObligations` | Source disclosure, relinkability, dynamic/static linking, modifications, or network/distribution obligations that need review. |
| `commercialRestrictions` | Non-commercial clauses, field-of-use limits, paid-license requirements, seat limits, cloud restrictions, benchmark publication limits, or vendor terms. |
| `acquisitionRiskNote` | Diligence issue that a future acquirer, investor, or enterprise buyer would ask about. |
| `approvedBlockedResearchOnlyStatus` | `approved`, `blocked`, `research_only`, `benchmark_only`, `pending_review`, `needs_commercial_license`, or `needs_isolation`. |

Recommended additional fields:

- reviewed version, package lock version, commit, or vendor release
- reviewer and review date
- generated artifact families affected
- known derivative-output concerns
- whether the tool touches customer/private data
- whether model weights or datasets have separate licenses
- whether an internal fork or patch exists

## Approval Status Vocabulary

`approved` means a dependency/tool is cleared for the specified purpose, mode, and exposure tier. Approval is scoped; approval for offline research does not imply approval for browser runtime distribution.

`blocked` means the dependency/tool must not be used for the proposed purpose.

`research_only` means the tool may be used for internal experiments, but must not ship, power public claims, or generate customer-facing deliverables without a new review.

`benchmark_only` means the tool may be used as a comparison reference or expert-review benchmark, but not embedded into Venviewer or represented as Venviewer's own validator/simulator.

`pending_review` means the license, source URL, redistribution path, or commercial terms are not yet verified.

`needs_commercial_license` means production or customer-facing use requires a paid/vendor agreement or explicit written permission.

`needs_isolation` means the tool may be usable only behind a process boundary, offline workflow, separate service, dynamic-linking model, or other architecture reviewed for license obligations.

## T-560 scoped offline evidence dependencies — 2026-08-26

Approval in this section is limited to the local, offline, authority-none T-560
candidate-crosswalk worker. It does not approve browser/runtime embedding,
redistribution, public evidence, customer-facing output, production use, or a
different artifact family. The exact archive, wheels, installed trees, licence
files, notices, and native runtime files are enforced by
`requirements-panorama-image2d-crosswalk.lock.json`.

| Dependency/tool | Version/source | Licence evidence | Exact distribution identity | Scoped status |
|---|---|---|---|---|
| CPython standalone build | 3.12.12, python-build-standalone release `20260211` | Bound `LICENSE.txt`; SHA-256 `886a0ead2d89030ee62dbff52b04e47ab91998341295bb9c56fb952b4e081c7a` | Archive SHA-256 `93bf8e8c05ede0077b197a29c99ebdaf253497f27190097494265150b4e70ba8`; executable SHA-256 `711df14e4ef9f0890c5c84330faba821839f3f6757dbe27cbf69ac3de6852446` | `approved` only for the isolated local T-560 worker |
| NumPy | 1.26.4, official PyPI wheel | BSD-3-Clause plus bundled third-party notices; licence/notice SHA-256 `e261222a74adff28f88160dac1c5cb302d93b67e9ca989eb83bf311e11a9970a` | Wheel SHA-256 `08beddf13648eb95f8d867350f6a018a4be2e5ad54c8d8caed89ebca558b2818`; installed-tree SHA-256 `d8320b77b843433708c3452ac7493a02502f7a047925560ad3fc4cf02ffbd7db` | `approved` only for local authority-none candidate generation |
| opencv-python-headless | 4.10.0.84, official PyPI wheel | MIT and Apache-2.0 plus bundled third-party notices; licence SHA-256 `edef0fac1eb08d29d34563f724742e078da2513e196133a12c6ad9ff01e26107`; notice SHA-256 `0b33c5be17819d10ecad11360c6f2bd5a7df7c0f80a3314a81e28070d93818e2` | Wheel SHA-256 `afcf28bd1209dd58810d33defb622b325d3cbe49dcd7a43a902982c33e5fad05`; installed-tree SHA-256 `a8c682c567f1a58f03b7f7b6d21d1bd0b22889684fd3f5b881aab2212957c408` | `approved` only for local authority-none candidate generation |

The worker uses no model weights, hosted API, network service, or generated
content. Re-review is mandatory before shipping any binary, publishing an
artifact, changing versions, or widening the exposure tier.

## Policy

- Research-only tools may be used in experiments but must not be shipped, embedded, or used to support customer-facing claims without ledger review.
- LGPL and similar copyleft tools must be isolated carefully and obligations tracked. Browser/WASM distribution, static linking, bundled binaries, and modified forks require explicit review.
- Commercial benchmark tools are comparison-only unless Venviewer has the right license for the intended use.
- No research repository becomes a production dependency without license review, source URL verification, version pinning, and approval status.
- Every generated artifact should record tool name, version, source URL, license, and ledger approval reference in provenance where the tool materially affected the artifact.
- Model weights, datasets, pretrained checkpoints, and example assets need separate review when their terms differ from code license terms.
- Cloud-only or offline-only use still belongs in the ledger if it processes venue/customer data or emits evidence, metrics, runtime assets, reports, or public visuals.
- Public, partner, or investor demos must not depend on `research_only`, `pending_review`, or `blocked` tools unless explicitly disclosed and approved for that exposure tier.
- Forks and local patches must record their upstream license and the obligations created by modification.
- Attribution requirements should be treated as release requirements, not cleanup work after launch.
- The ledger should be reviewed before acquisition diligence, enterprise security review, or publication of evidence-backed case studies.

## Initial Candidate Tool Families

This table is a conservative starting register, not approval. Licenses and source URLs must be verified against official sources before use beyond internal research.

| Tool / family | Intended purpose | Initial license posture | Default status |
|---|---|---|---|
| JuPedSim | Guest Flow Replay simulation prototype | Reported LGPL-3.0 in research; verify official source and distribution implications before use. | `research_only`, `needs_isolation` |
| PedPy | Trajectory metrics for Guest Flow Replay | License pending official review. | `pending_review`, `research_only` |
| Vadere | Simulation comparison/model sanity checks | License pending official review. | `pending_review`, `benchmark_only` |
| MILo | Residual Radiance research candidate | License pending official review; neural research repositories often have non-production constraints. | `pending_review`, `research_only` |
| Gaussian Frosting | Surface-bound residual research candidate | License pending official review; generated assets and training code terms must be reviewed separately. | `pending_review`, `research_only` |
| Spark 2.0 | Production splat runtime candidate already required by D-001/T-087 | License/source package terms must be reviewed before wider production claims. | `pending_review` for license ledger; runtime architecture remains D-001 |
| Niantic SPZ | Splat compression / asset delivery candidate | License pending official review; asset encoder/decoder and format implementation terms may differ. | `pending_review` |
| PlayCanvas splat-transform | Offline post-training splat cleanup, format conversion, summary stats, voxel/collision proxy generation, and diagnostic SOG/LOD export | Official npm and GitHub sources report MIT for `@playcanvas/splat-transform` 2.1.0. Production/evidence use still requires Venviewer fixture review, version pinning, artifact hashes, attribution handling, and generated-output provenance. | `pending_review` for production evidence; candidate for internal post-training spike |
| PlayCanvas SuperSplat | Internal visual QA/editor for splat outputs and diagnostic camera/settings authoring | Official GitHub source reports MIT. Any manual edit/export must be treated as a human-authored derivative artifact with provenance, reviewer, parameters, and limitations. | `pending_review`, `research_only` |
| PlayCanvas SuperSplat Viewer | Internal static diagnostic viewer for `.ply`, `.sog`, `.compressed.ply`, `.meta.json`, `.lod-meta.json`, and collision/voxel artifacts | Official npm and GitHub sources report MIT for `@playcanvas/supersplat-viewer` 1.22.4. Production embedding, public exposure, and customer-deliverable use require CORS/access-control, attribution, and artifact-provenance review. | `pending_review`, `research_only` |
| PlayCanvas Engine | Underlying renderer for PlayCanvas/SuperSplat diagnostic tooling | Official npm and GitHub sources report MIT for `playcanvas` 2.18.1. Do not adopt as a second Venviewer runtime while Spark remains the runtime path unless separately scoped. | `pending_review`, `research_only` |
| PlayCanvas React | Optional React bindings for future PlayCanvas diagnostic experiments | Official npm source reports MIT for `@playcanvas/react` 0.11.3 with React/React DOM and `sync-ammo` peer surface. Avoid production dependency adoption unless a future task explicitly scopes a second scene stack. | `pending_review`, `research_only` |
| KTX2 / BasisU | Texture compression / runtime delivery candidate | License pending official review for encoder, transcoder, and bundled binaries. | `pending_review` |
| Recast/Detour | Navmesh route-finding research and future pathing | License pending official review; route-finding remains deferred from v0 evidence. | `pending_review`, `research_only` |
| ORCA / RVO2 | Local collision avoidance research | License pending official review; implementation variants may have different terms. | `pending_review`, `research_only` |
| Pathfinder / MassMotion / AnyLogic | Professional simulator comparison or expert benchmark | Commercial/proprietary terms expected; use only with proper license. | `benchmark_only`, `needs_commercial_license` |
| Neural research repositories | Residual, reconstruction, relighting, or appearance experiments | Varied licenses, model/data terms, and paper-code constraints. | `pending_review`, `research_only` |

## Generated Artifact Provenance

Any Venviewer artifact materially produced, transformed, evaluated, or validated by a third-party tool should record license-aware provenance.

Recommended provenance fields:

- `toolName`
- `toolVersion`
- `toolSourceUrl`
- `toolLicense`
- `toolLicenseUrl`
- `ledgerReviewId`
- `ledgerApprovalStatus`
- `executionMode`
- `generatedAt`
- `generatedBy`
- `sourceInputs`
- `outputArtifacts`
- `attributionRequired`
- `redistributionLimitations`
- `commercialUseLimitations`

This applies to RuntimePackages, residual assets, photometric capture reports, `.venreplay.zip` bundles, witness blocks, Truth Mode reports, Layout Evidence Packs, OpenUSD/KHR exports, and public/partner preview media.

## Integration With Artifact Registry

The Venviewer Artifact Registry should cite ledger status for artifacts whose source inputs include third-party tools, research repositories, commercial simulators, or generated model assets.

Registry fields affected:

- `sourceInputs`: cite the producing tool/version and ledger review ID.
- `knownLimitations`: include license or redistribution limits when they affect use.
- `exportSafety`: block exports when the tool status is `research_only`, `pending_review`, `blocked`, or `benchmark_only` for the requested exposure.
- `runtimeCompatibility`: include whether a runtime artifact depends on a reviewed runtime dependency.
- `exposureTier`: prevent public marketing or published case-study exposure until tool rights are clear.

## Integration With Product Evidence

### Truth Mode

Truth Mode should not normally show license details to planners, but expert/debug views should be able to explain whether a visible artifact is production-approved, research-only, or blocked from export.

### Layout Evidence Pack

Evidence packs should cite validator/simulator tool versions and license review status when those tools materially affect witness blocks or replay artifacts.

### Guest Flow Replay

JuPedSim, PedPy, Vadere, Recast/Detour, ORCA/RVO2, Pathfinder, MassMotion, and AnyLogic outputs must keep simulation tool/version/license in replay provenance. Commercial benchmark outputs must not be presented as Venviewer-native simulation evidence unless licensed and reviewed.

### Residual Radiance

MILo, Gaussian Frosting, neural texture repos, Spark/SPZ tooling, KTX2/BasisU encoders, and related model weights or datasets must be reviewed before residual assets move from research output to production runtime or customer-facing proof.

### Public Copy and Exposure

Public claims must not rely on unreviewed, research-only, or benchmark-only tools. If a capability depends on unreviewed tooling, copy should remain internal or be softened to research/prototype language until the ledger status changes.

## Non-Goals

- No dependency installation.
- No package version change.
- No runtime rendering change.
- No simulator integration.
- No legal advice.
- No replacement for legal/vendor review.
- No public copy change.
- No package rename.
