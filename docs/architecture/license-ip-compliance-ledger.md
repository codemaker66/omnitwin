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

This table began as a conservative starting register, not approval. Its
purpose-scoped version/status details are superseded by the T-534 section below
wherever they differ; the table is retained only as the candidate-family
inventory.

| Tool / family | Intended purpose | Initial license posture | Default status |
|---|---|---|---|
| JuPedSim | Guest Flow Replay simulation prototype | Reported LGPL-3.0 in research; verify official source and distribution implications before use. | `research_only`, `needs_isolation` |
| PedPy | Trajectory metrics for Guest Flow Replay | License pending official review. | `pending_review`, `research_only` |
| Vadere | Simulation comparison/model sanity checks | License pending official review. | `pending_review`, `benchmark_only` |
| MILo | Residual Radiance research candidate | License pending official review; neural research repositories often have non-production constraints. | `pending_review`, `research_only` |
| Gaussian Frosting | Surface-bound residual research candidate | License pending official review; generated assets and training code terms must be reviewed separately. | `pending_review`, `research_only` |
| Spark 2.0 | Production splat runtime candidate already required by D-001/T-087 | The exact integrated `@sparkjsdev/spark` 2.0.0 package is MIT; retain the pin and notice, and keep rights in every rendered asset separate. Spark 2.1.0 remains an unadopted upgrade candidate. | `candidate` at the exact integrated pin; runtime architecture remains D-001 |
| Niantic SPZ | Splat compression / asset delivery candidate | The official `nianticlabs/spz` repository is MIT at inspected commit `21715c3b7a609ea6fb7c69b8ae42181a12b59f22`, tagged `v3.0.0+adobe.32`; the same source declares package 1.1.0 and documents file-format v4, so those identities must not be collapsed. Dependency adoption, notices, provenance and source-SPZ rights remain separate. | `candidate` for exact transport-code review; not archive/evidence master |
| PlayCanvas splat-transform | Offline post-training splat cleanup, format conversion, summary stats, voxel/collision proxy generation, and diagnostic SOG/LOD export | Official npm and GitHub sources report MIT for `@playcanvas/splat-transform` 3.1.3. Production/evidence use still requires an exact dependency and asset inventory, artifact hashes, notices, and generated-output provenance. | `candidate` for internal offline conversion at the inspected release |
| PlayCanvas SuperSplat | Internal visual QA/editor for splat outputs and diagnostic camera/settings authoring | SuperSplat 2.31.1 is MIT. Any manual edit/export remains a human-authored derivative artifact whose source rights, reviewer, parameters and limitations must be recorded. | `candidate` as an isolated internal editor; not currently integrated |
| PlayCanvas SuperSplat Viewer | Internal static diagnostic viewer for `.ply`, `.sog`, `.compressed.ply`, `.meta.json`, `.lod-meta.json`, and collision/voxel artifacts | `@playcanvas/supersplat-viewer` 1.27.1 is MIT. Production embedding still needs an exact dependency/asset inventory and notices. | `candidate`; not currently integrated |
| PlayCanvas Engine | Underlying renderer for PlayCanvas/SuperSplat diagnostic tooling | `playcanvas` 2.20.6 is MIT. Do not adopt it as a second Venviewer runtime while Spark remains the selected runtime unless separately scoped. | `candidate`; not currently integrated |
| PlayCanvas React | Optional React bindings for future PlayCanvas diagnostic experiments | `@playcanvas/react` 0.11.5 is MIT. Avoid adoption unless a future task explicitly scopes a second scene stack and closes its peer dependencies. | `candidate`; not currently integrated |
| KTX2 / BasisU | Texture compression / runtime delivery candidate | Basis Universal core is Apache-2.0 with NOTICE obligations and repository test assets excluded from that grant. KTX-Software needs isolation because its default build includes Ericsson-custom-licensed ETC code. | Basis core `candidate`; KTX-Software `needs_isolation` |
| Recast/Detour | Navmesh route-finding research and future pathing | Recast/Detour is zlib-licensed; use remains assumption-bound and does not establish surveyed geometry, safety, or operational truth. | `candidate` for bounded simulation; not currently integrated |
| ORCA / RVO2 | Local collision avoidance research | The inspected RVO2 implementation is Apache-2.0; preserve notices and keep the exact implementation pinned because ORCA variants can differ. | `candidate` for bounded simulation; not currently integrated |
| Pathfinder / MassMotion / AnyLogic | Professional simulator comparison or expert benchmark | Commercial/proprietary terms expected; use only with proper license. | `benchmark_only`, `needs_commercial_license` |
| Neural research repositories | Residual, reconstruction, relighting, or appearance experiments | Varied licenses, model/data terms, and paper-code constraints. | `pending_review`, `research_only` |

## 2026-07-19 HD super-app purpose-scoped review

Review ID: `T-534`

Evidence: `docs/reports/omnitwin-hd-stack-license-evidence-v1-2026-07-19.json`

Report: `docs/reports/omnitwin-hd-stack-license-evidence-v1-2026-07-19.md`
Detailed primary-source matrix:
`docs/reports/omnitwin-foundry-technology-license-matrix.md`

This review deliberately excludes cybersecurity, identity attestation,
signing, deployment and publication from ordinary super-app construction.
Those are not required to keep building local intake, reconstruction, quality
review and optional clearly separated visual derivatives. It is an engineering
screen, not legal advice or a blanket production approval.

| Product slice | Exact intended use | Purpose-scoped posture |
|---|---|---|
| Current browser runtime | Locked Three.js 0.180.0, React Three Fiber 8.18.0 and Spark 2.0.0 | MIT code at the exact pins is a `candidate`; keep notices, current lock and independently cleared splat assets. Spark 2.1.0 is only an upgrade candidate. |
| E57/point-cloud foundation | planned pye57 0.4.19/libE57Format, PDAL and Open3D 0.19 for read-only local inspection, registration and deterministic geometry work | Permissive code candidates for a new local manifest. The checked-in legacy RunPod image instead pins pye57 0.4.16/Open3D 0.18 and is not approval of this lane; E57/venue rights remain separate. |
| Camera registration | COLMAP 4.1.1/global mapper and a curated hloc detector/matcher lane | Conditional candidate. COLMAP dependencies and every hloc submodule/checkpoint are separately reviewed; standalone GLOMAP is legacy-only. |
| Splat training | a planned exact-release gsplat 1.5.3 lane requiring a new pinned local environment manifest for owned/authorised photographs, video frames and depth | Preferred conditional candidate. Apache-2.0 code does not grant input or trained-output rights. The existing RunPod Dockerfile is excluded because it contains moving-main SPZ/DN-Splatter acquisition; Nerfstudio/DN-Splatter may be allow-listed only at exact method/weight/data closures. |
| Conversion and QA | SPZ, SplatTransform 3.1.3, SuperSplat/Viewer and optional PlayCanvas packages | MIT code candidates after exact dependency, asset and notice inventory. No PlayCanvas package is currently integrated. Conversion never cleanses source restrictions. |
| Texture delivery | Basis Universal core | Apache-2.0 candidate with NOTICE and third-party BOM; exclude repository test images. KTX-Software as a whole is `needs_isolation` because the default build includes Ericsson-custom-licensed ETC code. |
| Gaussian glTF | Feature-flagged `KHR_gaussian_splatting` adapter | `pending_review`: Release Candidate only; specification text has Khronos-specific terms and does not itself grant patent/trademark rights. |
| Semantic proposals | Splat Analyzer CUDA lane using MIT app + Apache gsplat/OWLv2 | Conditional internal proposal tool only. Human review required; never collision/measurement authority. Apple `gsplat-mps` lane is AGPL-3.0 and remains isolated. |
| AI/cinematic and continual-update derivatives | Separate opt-in output family, never captured or metric truth | Released ArtiFixer, MeshCoder and ScaRF default model lanes are `research_only`/noncommercial. WorldMesh, CL-Splats, ReAct-GS and WildGaussians whole repositories are not production-clean. Cross-Temporal 3DGS, GaussianUpdate, SimFoundry and NeuWorld are paper/citation study candidates only. PPISP 1.2.1 is a separate Apache-2.0 photometric candidate after dependency/notice closure. |
| XGRIDS source | Officially exported SOG/SPZ/PLY/GLB only; raw XBIN/LCC/LCC2 stays untouched unless written rights support the exact purpose | LCC/LCC2 custom terms and SDKs do not create a permissive production lane. Raw/source/model rights are `pending_review`; no raw decoder, reverse engineering, model training or public redistribution. |
| External DCC/reconstruction | CloudCompare, Blender and RealityScan operated separately | External tools only. Do not embed/link/host as part of the closed application without a separate compliance decision. |
| Cloud handoff | RunPod/AWS compute and Cloudflare R2 storage behind provider adapters | Service-contract gate plus an exact worker-image gate. The checked-in `infra/runpod/Dockerfile` is excluded pending immutable dependency/BOM/notice closure. This does not block browser or newly written local product engineering. |
| Guest-flow support | Recast/Detour and RVO2/ORCA | zlib/Apache code candidates for assumption-bound simulation. They do not establish surveyed layout, safety or operational truth. |

The supplied-inventory references are now explicit rather than silently
omitted: CL-Splats, Cross-Temporal 3DGS, GaussianUpdate, ReAct-GS and
WildGaussians remain research/paper-study candidates under the boundaries
above; YouTube reference `vbtQ3tvi5ok` is cite/link-only media, while its PPISP
subject is reviewed separately as a conditional Apache-2.0 code candidate.

### Unresolved external evidence

The code stack is no longer a blanket blocker. The following evidence remains
external and purpose-specific:

1. the Matterport customer/order/export record for each actual E57/MatterPak
   source and the applicable agreement version;
2. written venue permission covering the intended commercial display,
   transformation, cloud processing and—only if desired—model-training uses of
   the photographs, video and scans;
3. XGRIDS purchase/account/export terms or written vendor permission for the
   exact LCC/LCC2/PortalCam sources and intended derived outputs; and
4. a model-card/checkpoint digest and dataset/input-rights record for every
   optional visual-generation model actually selected.

Until those records exist, local structure inspection and UI/product work may
continue, but external upload, commercial training, public redistribution and
authority claims stay unavailable for the affected real assets.

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
