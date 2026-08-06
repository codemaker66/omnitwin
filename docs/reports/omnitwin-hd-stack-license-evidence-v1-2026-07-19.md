# OmniTwin HD stack purpose-scoped licence review V1

Date: 2026-07-19  
Review ID: `T-534`  
Status: engineering screen complete; real-source rights evidence still external  
Authority: none  
Legal advice: no

Structured evidence:
`docs/reports/omnitwin-hd-stack-license-evidence-v1-2026-07-19.json`  
Detailed primary-source matrix:
`docs/reports/omnitwin-foundry-technology-license-matrix.md`

## Outcome

The super-app can continue without a cybersecurity programme, identity
attestation, signing, cloud deployment or publication. Those topics are not
dependencies of ordinary local product engineering.

The commercially plausible core is:

1. read owned or authorised E57/OBJ/GLB/PLY, photographs and video locally;
2. use pinned permissive geometry and registration components;
3. prepare a planned exact-release gsplat 1.5.3 lane for authorised inputs by
   creating and reviewing a new pinned environment manifest;
4. package derived runtime assets with narrowly reviewed SPZ/PlayCanvas/Basis
   components;
5. render through the currently locked Three.js 0.180.0, React Three Fiber
   8.18.0 and Spark 2.0.0 stack; and
6. offer any generative enhancement only as a separate, opt-in, visibly
   labelled derivative that never becomes captured, metric, collision or
   planning truth.

This is not a blanket approval. The remaining blockers attach to particular
inputs, models or distribution modes rather than to the whole application.
In particular, this conclusion covers the integrated browser stack and newly
written local product code; it does **not** approve the existing
`infra/runpod/Dockerfile` training image.

## Product architecture that avoids the blocked paths

| Lane | Allowed initial implementation | Excluded initial implementation |
|---|---|---|
| Local intake | Read-only E57/OBJ/GLB/PLY and ordinary photo/video structure; preserve hashes and source provenance | No XGRIDS raw XBIN decoder, no proprietary-format reverse engineering and no assumption that file possession grants rights |
| Registration | COLMAP 4.1.1/global mapper; curated hloc detector/matcher/checkpoint set | No moving-main or model-zoo dependency accepted by project name alone; no standalone new GLOMAP adoption |
| HD reconstruction | Planned exact-release gsplat 1.5.3 lane requiring a new pinned local environment manifest; optional owned-depth extensions after dependency closure | Do not build or run the legacy checked-in RunPod image; no graphdeco or Mip-Splatting code in the commercial stack; no moving-main SPZ/DN-Splatter acquisition or uncleared model/data closure |
| QA and packaging | Exact SPZ, SplatTransform, SuperSplat Viewer or narrowly selected PlayCanvas code package with notices and fixture/asset exclusions | No wholesale repository bundle; no noncommercial example media; no claim that conversion cleanses the source |
| Runtime | Keep current locked Three 0.180.0 + R3F 8.18.0 + Spark 2.0.0 until an explicit upgrade review | No silent Spark 2.1, R3F 9 or Three r185 upgrade; no remote Spark demo asset promoted as product content |
| Textures/interchange | Basis Universal core with NOTICE/BOM; feature-flagged glTF Gaussian adapter | No generic “KTX is Apache” assumption: default KTX-Software includes restrictive Ericsson ETC source. Do not claim `KHR_gaussian_splatting` is ratified |
| Semantics | CUDA Splat Analyzer as approximate proposal evidence with human review | No semantic box as measurement/collision truth; Apple `gsplat-mps` stays isolated under AGPL-3.0 |
| AI visual derivative | A later independently cleared model/checkpoint/input set, stored and displayed as a separate derivative | Released ArtiFixer, MeshCoder and ScaRF default weights are not commercial lanes; the complete WorldMesh pipeline is not production-clean |
| Cloud | Provider adapter only after the asset, account and exact worker-image gates pass | The existing `infra/runpod/Dockerfile` is excluded; no upload, credentials, paid compute, provider call or publication in this review |

## Current integrated runtime

The checked-in web manifest and lock contain exactly:

| Package | Locked version | Code licence | Result |
|---|---:|---|---|
| Three.js | 0.180.0 | MIT | candidate at the existing lock; examples and user assets remain separate |
| React Three Fiber | 8.18.0 | MIT | candidate at the existing lock |
| Spark | 2.0.0 | MIT | candidate at the existing lock; upstream 2.1.0 is only an upgrade candidate |

No PlayCanvas, PDAL, OpenUSD or Cesium package is declared in the inspected
application manifests. A separate legacy cloud manifest,
`infra/runpod/Dockerfile`, pins Open3D 0.18.0, pye57 0.4.16 and gsplat
1.5.3+pt24cu124, but installs SPZ and clones DN-Splatter from moving `main` and
does not freeze the whole image's dependency/notice/source-asset closure. It is
therefore excluded from the reviewed path. The planned Open3D 0.19.0 and pye57
0.4.19 local worker still needs a new exact Python/native manifest before it can
be called reproducible or distributable.

## Preferred conditional core

| Component | Exact screen | Purpose-scoped result |
|---|---|---|
| Planned pye57 0.4.19 / libE57Format 3.1.1 | MIT wrapper / Boost-1.0 core | new local read-only candidate; pin native library and Xerces closure; do not infer approval from the legacy pye57 0.4.16 cloud image; source E57 rights separate |
| PDAL 2.10.2 | BSD-3-Clause core | offline I/O candidate after plugin/build closure |
| Open3D 0.19.0 | MIT core | ICP/TSDF/QA candidate after optional ML/CUDA and environment closure |
| COLMAP 4.1.1 | BSD-style core; dependencies excluded by COPYING | preferred SfM/global-mapper candidate at an exact audited build |
| hloc 1.4 | Apache-2.0 root | allow-list exact detector, matcher, submodules and weights |
| gsplat 1.5.3 | Apache-2.0; no mandatory checkpoint | preferred Gaussian implementation; input and trained-output rights remain separate |
| Nerfstudio 1.1.5 | Apache-2.0 framework | conditional framework only; no blanket clearance for methods/plugins/data |
| PPISP 1.2.1 | Apache-2.0 code | conditional photometric-compensation candidate after exact dependency/NOTICE packaging; optional dataset remains separate |
| Niantic SPZ tag v3.0.0+adobe.32 (`21715c3b…`) / format v4 | MIT | source declares package 1.1.0, so keep all three identities explicit; conditional lossy transport; never archive/evidence master; sample assets excluded |
| SplatTransform 3.1.3 | MIT | conditional converter after exact new dependency and fixture review |
| PlayCanvas packages | MIT code | narrow package candidates; mixed repository assets excluded; not currently integrated |
| Basis Universal | Apache-2.0 core | candidate with NOTICE, modified-file notice and dependency BOM; test images excluded |

## Excluded, isolated or inspiration-only references

| Reference | Result | Reason |
|---|---|---|
| Original graphdeco Gaussian Splatting | research only | custom noncommercial research/evaluation terms |
| Mip-Splatting | research/technique only | no root licence; README adopts original 3DGS restrictions |
| Released ArtiFixer | research only | Apache code, but official checkpoint is NVIDIA One-Way Noncommercial and R&D-only |
| Released MeshCoder | research only | MIT code, but official model is CC-BY-NC-SA and dataset terms conflict; apply stricter reading |
| Released ScaRF-SLAM default | research only | GPL code plus hard-coded CC-BY-NC DA3 weight and commercial-contact ambiguity |
| WorldMesh whole pipeline | research only | MIT core does not override bundled SAM/GPL/Apple components, FLUX noncommercial weights or Mip-Splatting setup code |
| SimFoundry | inspiration only | official page supplies a paper but no source release, checkpoint or licence |
| NeuWorld | inspiration only | placeholder repo expressly says code/checkpoints are still under review; no licence |
| CL-Splats whole repository | research only | MIT original contributions coexist with inherited noncommercial 3DGS files; companion dataset has no declared licence |
| ReAct-GS whole repository | research only | project expressly uses the original noncommercial Gaussian-Splatting licence |
| WildGaussians whole repository | research only | original MIT contributions coexist with 3DGS/Mip-Splatting restrictions; checkpoints and benchmark data remain separate |
| Cross-Temporal 3DGS / GaussianUpdate | paper only | no official implementation, model or dataset release with software terms was identified |
| YouTube `vbtQ3tvi5ok` | cite/link only | explanatory PPISP interview, not reusable code or a redistributable media asset; PPISP is reviewed separately |
| Three Meshlets demo bundle | research only | code is extractable under MIT after audit, but demo assets include noncommercial/unclear material |
| KTX-Software default build | needs isolation | Ericsson-custom ETC source is included by default; top-level Apache summary is not the whole build |
| Existing `infra/runpod/Dockerfile` | excluded pending closure | stale pye57/Open3D pins plus moving-main SPZ and DN-Splatter acquisition; no frozen whole-image BOM/notices |
| CloudCompare / Blender | external tools | GPL application boundary; do not embed/link into the closed application |
| RealityScan / Unreal | external vendor tools | proprietary account, seat, service and redistribution terms; not core dependencies |

WorldMesh is the clearest example of why the split matters. Its top-level
licence says the core WorldMesh implementation is MIT, but the same file lists
SAM components, GPL-3.0 ComfyUI, Apple Depth Pro, Apache Nerfstudio and external
weights. Its setup also installs the noncommercial Mip-Splatting rasterizer.
The released repository is therefore useful architecture research, not a
production-clean container.

## XGRIDS decision

The product should support **official exports**, not raw-format reverse
engineering.

- LCC and LCC2 use bespoke non-OSI terms with attribution, flow-down,
  derivative/publication, competitive-AI-training and termination conditions.
- The public Web, Unity and Unreal SDK repositories have no root licence or
  affirmative commercial redistribution grant. The Unreal record changed from
  v0.9.0 to v3.0.0 on 2026-07-15 without curing that gap.
- Official manuals describe `.xbin`, poses, GNSS, logs, photos and export
  workflows; they do not grant commercial decoding, model-training or
  redistribution rights.
- SplatTransform's ability to read an LCC source is a technical capability, not
  a rights grant.

Accordingly, the initial super app may accept rights-cleared SOG/SPZ/PLY/GLB
exports. Raw XBIN and LCC/LCC2 remain an official vendor/export bridge until an
exact written purpose decision exists.

## Real-source rights still needed

The code stack is no longer the blanket blocker. For the actual Trades Hall
sources, the owner needs to supply or confirm:

1. the Matterport account/customer and order/export record that covers each
   E57/MatterPak source, including the applicable agreement version;
2. written venue permission for the intended commercial display,
   transformation and cloud-processing uses, plus model training only if that
   optional use is desired;
3. the XGRIDS purchase/account/export terms or written permission covering the
   exact PortalCam/LCC/LCC2 sources and desired derived outputs; and
4. for any later generative model, the exact model card, base-model terms,
   checkpoint digest, data provenance and intended output exposure.

Matterport's current platform agreement says the customer owns Customer Data
and Spaces as between the customer and Matterport, while also requiring the
customer to possess permission for the subject property and making the
customer responsible for Digital Assets. The actual account/order and venue
authority therefore remain the decisive evidence; a generic public agreement
cannot prove that this project owns these particular captures.

## Cloud service boundary

RunPod, Cloudflare R2 and AWS are provider contracts, not code licences.
RunPod's current terms say the customer retains ownership of customer content
but grants the service rights needed to operate it and permits aggregated,
anonymised improvement use. R2 and AWS likewise operate under account/service
agreements, while marketplace images and transferred content keep their own
terms. None of this blocks the local product. Before a real upload, record the
account owner, current terms, data region/retention, exact worker image, source
rights and cost authority. The current `infra/runpod/Dockerfile` is not that
approved exact worker image and remains excluded from this decision.

## Material drift and contradictions found

- SplatTransform moved from 3.0.0 to 3.1.3 after the prior review.
- SuperSplat moved from 2.29.0 to 2.31.1.
- COLMAP moved from 4.1.0 to 4.1.1.
- XGRIDS Unreal SDK moved from 0.9.0 to 3.0.0, still without a public root grant.
- Mip-Splatting's earlier `LICENSE.md` citation was invalid; the README carries
  the actual instruction to follow original 3DGS terms.
- 3DGRUT's official attributions explicitly list GPL-3.0 `plyfile`.
- Splat Analyzer's Apple dependency is AGPL-3.0; the CUDA lane is cleaner.
- MeshCoder dataset metadata and access-gate licence text conflict.
- Spark 2.1.0 package metadata names a nonexistent repository slug; OmniTwin's
  existing 2.0.0 pin and canonical repository are unaffected.
- The first draft paired several release labels with moving-main revisions;
  libE57Format 3.1.1, COLMAP 4.1.1, hloc v1.4, gsplat 1.5.3, Nerfstudio 1.1.5
  and SuperSplat 2.31.1 now cite their exact release commits.
- SPZ commit `21715c3b…` is tag `v3.0.0+adobe.32`, while the source declares
  package 1.1.0 and the current file format is v4; those identities are not
  interchangeable.
- A checked-in legacy RunPod manifest does pin pye57 0.4.16/Open3D 0.18.0, but
  its moving-main SPZ and DN-Splatter acquisitions prevent it from serving as
  the reviewed local pye57 0.4.19/Open3D 0.19 closure.

## Method and falsifiability

The review used exact official licence files, repository commits/tags, model
cards, dataset cards, specification terms and vendor/service agreements. A
GitHub sidebar label, paper page, public demo, permissive top-level repository
licence or converter capability was not accepted as blanket evidence.

The structured artifact covers 48 supplied or production-relevant reference
families with 125 primary-source citations (119 distinct URLs), including the
previously omitted CL-Splats, Cross-Temporal 3DGS, GaussianUpdate, ReAct-GS,
WildGaussians and YouTube reference plus the separately licensed PPISP code.

Every decision can be falsified by producing a newer exact licence, a written
vendor/customer grant, a separately cleared checkpoint/data chain or a
dependency closure that changes the relevant terms. Re-review occurs before
every upgrade, model selection, cloud upload or distributed release.

“Technique-only” in this review means only an independently implemented study
candidate without copying restricted code, weights or assets. It is not an
affirmative legal conclusion and does not resolve patents or freedom to
operate.

No package was installed, no raw source was parsed, no cloud/provider was
called, no credential or account was used, no spend occurred, and nothing was
signed, published or promoted during this review.
